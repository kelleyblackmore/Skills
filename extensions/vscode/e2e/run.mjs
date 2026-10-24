// End-to-end test: launch a real VS Code with the extension, serve a locally built site,
// run "Add to Project" for a skill, and check the files land in the project.
//   python3 ../../scripts/build_site.py && npm run build && npm run e2e
// Needs a display on Linux (CI wraps it in xvfb-run).
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, "..");
const siteDir = path.resolve(process.env.SKILLS_SITE_DIR ?? path.join(extensionDir, "../../_site"));

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = path.join(siteDir, rel);
  if (!file.startsWith(siteDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.writeHead(200).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-skills-e2e-"));
await mkdir(path.join(workspace, ".vscode"));
await writeFile(
  path.join(workspace, ".vscode", "settings.json"),
  JSON.stringify({ "agentSkills.indexUrl": `http://127.0.0.1:${port}/skills.json` }),
);

try {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "stable",
    extensionDevelopmentPath: extensionDir,
    extensionTestsPath: path.join(here, "suite.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust"],
  });
} finally {
  server.close();
}
