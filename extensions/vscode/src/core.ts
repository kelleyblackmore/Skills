// Fetching, validating and installing skills. No VS Code imports, so it is unit-testable.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SkillFile {
  path: string;
  sha256: string;
  size: number;
  executable: boolean;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  page: string;
  zip: { path: string; sha256: string };
  files: SkillFile[];
}

export interface SkillIndex {
  schema: 1;
  repository: string;
  commit: string | null;
  skills: Skill[];
}

export type SkillState = "missing" | "current" | "differs";

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

// Each repetition must start with "-", so matching is linear; names are length-checked first.
// eslint-disable-next-line security/detect-unsafe-regex -- see above
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export class SkillError extends Error {}

function fail(message: string): never {
  throw new SkillError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Record<string, unknown>, key: string, where: string): string {
  // eslint-disable-next-line security/detect-object-injection -- key is a literal from this module
  const value = obj[key];
  if (typeof value !== "string" || value === "")
    fail(`${where}: "${key}" must be a non-empty string`);
  return value;
}

/** A relative POSIX path that cannot escape the skill folder or touch hidden/system paths. */
export function isSafeRelativePath(p: string): boolean {
  if (p === "" || p.startsWith("/") || p.includes("\\") || p.includes(":") || p.includes("\0")) {
    return false;
  }
  return p
    .split("/")
    .every((seg) => seg !== "" && seg !== "." && seg !== ".." && !seg.startsWith("."));
}

function parseFile(raw: unknown, where: string): SkillFile {
  if (!isRecord(raw)) fail(`${where}: file entry must be an object`);
  const filePath = str(raw, "path", where);
  if (!isSafeRelativePath(filePath)) fail(`${where}: unsafe file path "${filePath}"`);
  const sha256 = str(raw, "sha256", where);
  if (!SHA256_RE.test(sha256)) fail(`${where}: bad sha256 for ${filePath}`);
  const { size, executable } = raw;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
    fail(`${where}: bad size for ${filePath}`);
  }
  if (typeof executable !== "boolean") fail(`${where}: bad executable flag for ${filePath}`);
  return { path: filePath, sha256, size, executable };
}

function parseSkill(raw: unknown, i: number): Skill {
  if (!isRecord(raw)) fail(`skills[${String(i)}] must be an object`);
  const name = str(raw, "name", `skills[${String(i)}]`);
  if (name.length > 64 || !NAME_RE.test(name)) fail(`skills[${String(i)}]: invalid name "${name}"`);
  const where = `skill ${name}`;
  const zip = raw["zip"];
  if (!isRecord(zip)) fail(`${where}: "zip" must be an object`);
  const files = raw["files"];
  if (!Array.isArray(files) || files.length === 0)
    fail(`${where}: "files" must be a non-empty array`);
  const parsed = files.map((f) => parseFile(f, where));
  const paths = new Set(parsed.map((f) => f.path));
  if (paths.size !== parsed.length) fail(`${where}: duplicate file paths`);
  if (!paths.has("SKILL.md")) fail(`${where}: missing SKILL.md`);
  return {
    name,
    description: str(raw, "description", where),
    version: str(raw, "version", where),
    page: str(raw, "page", where),
    zip: { path: str(zip, "path", where), sha256: str(zip, "sha256", where) },
    files: parsed,
  };
}

export function parseIndex(raw: unknown): SkillIndex {
  if (!isRecord(raw)) fail("index must be a JSON object");
  if (raw["schema"] !== 1) fail(`unsupported index schema ${JSON.stringify(raw["schema"])}`);
  const skills = raw["skills"];
  if (!Array.isArray(skills)) fail('"skills" must be an array');
  const parsed = skills.map(parseSkill);
  if (new Set(parsed.map((s) => s.name)).size !== parsed.length) fail("duplicate skill names");
  const commit = raw["commit"];
  return {
    schema: 1,
    repository: str(raw, "repository", "index"),
    commit: typeof commit === "string" ? commit : null,
    skills: parsed,
  };
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS anywhere; plain HTTP only on this machine, for previewing a locally built site. */
function requireHttps(url: string): URL {
  const parsed = new URL(url);
  const local = parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) fail(`only https URLs are allowed: ${url}`);
  return parsed;
}

async function fetchBytes(url: string, maxBytes: number, fetchImpl: Fetch): Promise<Uint8Array> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) fail(`GET ${url} failed: HTTP ${String(res.status)}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > maxBytes) fail(`GET ${url}: response too large`);
  return data;
}

export async function fetchIndex(indexUrl: string, fetchImpl: Fetch = fetch): Promise<SkillIndex> {
  requireHttps(indexUrl);
  const data = await fetchBytes(indexUrl, MAX_INDEX_BYTES, fetchImpl);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    fail(`${indexUrl} is not valid JSON`);
  }
  return parseIndex(json);
}

/** URL of a skill file, relative to the index: <base>/raw/<skill>/<path>. */
export function fileUrl(indexUrl: string, skill: Skill, file: SkillFile): string {
  const rel = ["raw", skill.name, ...file.path.split("/")].map(encodeURIComponent).join("/");
  return new URL(rel, requireHttps(indexUrl)).toString();
}

/** Download every file of a skill and verify each against the index's size and hash. */
export async function downloadSkill(
  indexUrl: string,
  skill: Skill,
  fetchImpl: Fetch = fetch,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const file of skill.files) {
    const data = await fetchBytes(fileUrl(indexUrl, skill, file), MAX_FILE_BYTES, fetchImpl);
    if (data.byteLength !== file.size || sha256(data) !== file.sha256) {
      fail(`${skill.name}/${file.path} does not match the index checksum; refusing to install`);
    }
    out.set(file.path, data);
  }
  return out;
}

export function expandHome(folder: string, home: string): string {
  if (folder === "~") return home;
  if (folder.startsWith("~/")) return path.join(home, folder.slice(2));
  return folder;
}

/** Resolve a file inside <root>/<skill>, refusing anything that would land outside it. */
function resolveInside(root: string, skillName: string, rel: string): string {
  const skillDir = path.resolve(root, skillName);
  const target = path.resolve(skillDir, ...rel.split("/"));
  if (!target.startsWith(skillDir + path.sep))
    fail(`refusing to write outside ${skillDir}: ${rel}`);
  return target;
}

async function readIfExists(file: string): Promise<Uint8Array | undefined> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Paths whose local copy under <root>/<skill> is missing or differs from the index. */
export async function changedFiles(root: string, skill: Skill): Promise<string[]> {
  const changed: string[] = [];
  for (const file of skill.files) {
    const local = await readIfExists(resolveInside(root, skill.name, file.path));
    if (local === undefined || sha256(local) !== file.sha256) changed.push(file.path);
  }
  return changed;
}

export async function skillState(root: string, skill: Skill): Promise<SkillState> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
    await lstat(path.join(root, skill.name));
  } catch {
    return "missing";
  }
  return (await changedFiles(root, skill)).length === 0 ? "current" : "differs";
}

/** Local files that exist and would be overwritten with different content. */
export async function conflictingFiles(root: string, skill: Skill): Promise<string[]> {
  const conflicts: string[] = [];
  for (const rel of await changedFiles(root, skill)) {
    if ((await readIfExists(resolveInside(root, skill.name, rel))) !== undefined)
      conflicts.push(rel);
  }
  return conflicts;
}

/**
 * Refuse if the skill folder, or any existing folder between it and `dir`, is a symlink.
 * Folders that do not exist yet are fine: mkdir creates them as real directories.
 */
async function assertNoSymlinks(skillDir: string, dir: string): Promise<void> {
  const rel = path.relative(skillDir, dir);
  let current = skillDir;
  for (const seg of ["", ...(rel === "" ? [] : rel.split(path.sep))]) {
    current = seg === "" ? current : path.join(current, seg);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
      if ((await lstat(current)).isSymbolicLink()) {
        fail(`${current} is a symlink; refusing to write through it`);
      }
    } catch (err) {
      if (err instanceof SkillError) throw err;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

/**
 * Write a downloaded skill to <root>/<skill>. Files not in the index are left alone.
 *
 * Every folder on the way to each file must be a real directory, not a symlink (a
 * symlinked skill folder is usually a link to a clone of the skills repo; a symlinked
 * subfolder could point anywhere). Each file goes to a new randomly named temp file,
 * created exclusively so an existing file or symlink is never followed, then renamed
 * into place.
 */
export async function writeSkill(
  root: string,
  skill: Skill,
  contents: Map<string, Uint8Array>,
): Promise<void> {
  const skillDir = path.resolve(root, skill.name);
  for (const file of skill.files) {
    const data = contents.get(file.path);
    if (data === undefined) fail(`missing downloaded content for ${file.path}`);
    const target = resolveInside(root, skill.name, file.path);
    await assertNoSymlinks(skillDir, path.dirname(target));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(8).toString("hex")}.agent-skills-tmp`;
    let created = false;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
      await writeFile(tmp, data, { mode: file.executable ? 0o755 : 0o644, flag: "wx" });
      created = true;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from resolveInside() or a validated skill name
      await rename(tmp, target);
      created = false;
    } finally {
      if (created) await rm(tmp, { force: true });
    }
  }
}
