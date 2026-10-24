// Contract test: the extension can read and install everything scripts/build_site.py publishes.
// Runs when SKILLS_SITE_DIR points at a built _site/ (CI builds it first); skipped otherwise.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { type Fetch, downloadSkill, fetchIndex, skillState, writeSkill } from "../core.js";

const siteDir = process.env["SKILLS_SITE_DIR"];
const BASE = "https://skills.test/";

const fromDisk: Fetch = async (url) => {
  const rel = decodeURIComponent(new URL(url).pathname.slice(1));
  try {
    return new Response(await readFile(path.join(siteDir ?? "", rel)));
  } catch {
    return new Response("not found", { status: 404 });
  }
};

describe("published site", { skip: siteDir ? false : "SKILLS_SITE_DIR not set" }, () => {
  it("serves an index the extension accepts, and every skill installs cleanly", async () => {
    const index = await fetchIndex(`${BASE}skills.json`, fromDisk);
    assert.ok(index.skills.length > 0);
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-skills-site-"));
    for (const skill of index.skills) {
      const contents = await downloadSkill(`${BASE}skills.json`, skill, fromDisk);
      await writeSkill(root, skill, contents);
      assert.equal(await skillState(root, skill), "current", skill.name);
    }
  });
});
