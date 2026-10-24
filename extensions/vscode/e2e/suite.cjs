// Runs inside the VS Code extension host (loaded by e2e/run.mjs).
const assert = require("node:assert/strict");
const { stat } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const ext = vscode.extensions.getExtension("kelleyblackmore.agent-skills");
  assert.ok(ext, "extension is installed");
  await ext.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "agentSkills.refresh",
    "agentSkills.addToProject",
    "agentSkills.installForUser",
  ]) {
    assert.ok(commands.includes(id), `${id} is registered`);
  }

  const project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(project, "a workspace folder is open");

  await vscode.commands.executeCommand("agentSkills.addToProject", "git-workflow");

  for (const folder of [".claude/skills", ".github/skills"]) {
    const skillDir = path.join(project, folder, "git-workflow");
    await stat(path.join(skillDir, "SKILL.md"));
    const script = await stat(path.join(skillDir, "scripts", "check-commit-msg.sh"));
    if (process.platform !== "win32")
      assert.equal(script.mode & 0o111, 0o111, "script is executable");
  }
  console.log("e2e: git-workflow added to .claude/skills and .github/skills");
}

module.exports = { run };
