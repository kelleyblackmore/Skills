import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  type Skill,
  type SkillIndex,
  type SkillState,
  conflictingFiles,
  downloadSkill,
  expandHome,
  fetchIndex,
  skillState,
  writeSkill,
} from "./core.js";

const REMOTE_SCHEME = "agent-skills-remote";

interface Settings {
  indexUrl: string;
  projectFolders: string[];
  userFolders: string[];
}

function settings(): Settings {
  const cfg = vscode.workspace.getConfiguration("agentSkills");
  return {
    indexUrl: cfg.get<string>("indexUrl", "https://kelleyblackmore.github.io/Skills/skills.json"),
    projectFolders: cfg.get<string[]>("projectFolders", [".claude/skills", ".github/skills"]),
    userFolders: cfg.get<string[]>("userFolders", ["~/.claude/skills", "~/.agents/skills"]),
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class SkillItem extends vscode.TreeItem {
  constructor(
    readonly skill: Skill,
    state: SkillState | undefined,
  ) {
    super(skill.name, vscode.TreeItemCollapsibleState.None);
    this.tooltip = new vscode.MarkdownString(`**${skill.name}**\n\n${skill.description}`);
    this.contextValue = `skill.${state ?? "unknown"}`;
    if (state === "current") {
      this.description = "in project";
      this.iconPath = new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    } else if (state === "differs") {
      this.description = "update available";
      this.iconPath = new vscode.ThemeIcon(
        "arrow-circle-up",
        new vscode.ThemeColor("charts.yellow"),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("book");
    }
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(command ? "warning" : "info");
    if (command) this.command = command;
  }
}

class SkillsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private index: SkillIndex | undefined;
  private error: string | undefined;

  async load(force = false): Promise<SkillIndex> {
    if (this.index && !force) return this.index;
    try {
      this.index = await fetchIndex(settings().indexUrl);
      this.error = undefined;
      return this.index;
    } catch (err) {
      this.error = message(err);
      throw err;
    } finally {
      this.changed.fire();
    }
  }

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!this.index) {
      try {
        await this.load();
      } catch {
        // Rendered below from this.error.
      }
    }
    if (!this.index) {
      return [
        new MessageItem(`Could not load skills: ${this.error ?? "unknown error"}`, {
          command: "agentSkills.refresh",
          title: "Retry",
        }),
      ];
    }
    const project = vscode.workspace.workspaceFolders?.[0];
    const firstFolder = settings().projectFolders[0];
    const root = project && firstFolder ? path.join(project.uri.fsPath, firstFolder) : undefined;
    return Promise.all(
      this.index.skills.map(
        async (skill) => new SkillItem(skill, root ? await skillState(root, skill) : undefined),
      ),
    );
  }
}

/** In-memory documents for the "remote" side of a diff. */
class RemoteContent implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();

  set(uri: vscode.Uri, text: string): void {
    this.docs.set(uri.toString(), text);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? "";
  }
}

/** A tree item, a skill name passed as a command argument, or ask with a quick pick. */
type SkillArg = SkillItem | string | undefined;

async function pickSkill(provider: SkillsProvider, arg: SkillArg): Promise<Skill | undefined> {
  if (arg instanceof SkillItem) return arg.skill;
  const index = await provider.load();
  if (typeof arg === "string") {
    const found = index.skills.find((s) => s.name === arg);
    if (!found) throw new Error(`no skill named "${arg}" in ${settings().indexUrl}`);
    return found;
  }
  const choice = await vscode.window.showQuickPick(
    index.skills.map((s) => ({ label: s.name, detail: s.description, skill: s })),
    { placeHolder: "Choose a skill", matchOnDetail: true },
  );
  return choice?.skill;
}

async function pickProject(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Add the skill to which folder?" });
}

async function showChanges(
  remote: RemoteContent,
  skill: Skill,
  roots: string[],
  conflicts: Map<string, string[]>,
  contents: Map<string, Uint8Array>,
): Promise<void> {
  for (const root of roots) {
    for (const rel of conflicts.get(root) ?? []) {
      const local = vscode.Uri.file(path.join(root, skill.name, ...rel.split("/")));
      const incoming = vscode.Uri.from({ scheme: REMOTE_SCHEME, path: `/${skill.name}/${rel}` });
      remote.set(incoming, new TextDecoder().decode(contents.get(rel)));
      await vscode.commands.executeCommand(
        "vscode.diff",
        local,
        incoming,
        `${skill.name}/${rel}: yours ↔ latest`,
        { preview: false },
      );
    }
  }
}

/** Download, confirm any overwrites, and write the skill into every root. */
async function install(
  provider: SkillsProvider,
  remote: RemoteContent,
  skill: Skill,
  roots: string[],
  where: string,
): Promise<boolean> {
  const { indexUrl } = settings();
  const contents = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading ${skill.name}…` },
    () => downloadSkill(indexUrl, skill),
  );

  const conflicts = new Map<string, string[]>();
  for (const root of roots) {
    const files = await conflictingFiles(root, skill);
    if (files.length > 0) conflicts.set(root, files);
  }
  if (conflicts.size > 0) {
    const count = [...conflicts.values()].reduce((n, f) => n + f.length, 0);
    for (;;) {
      const choice = await vscode.window.showWarningMessage(
        `${skill.name}: ${String(count)} existing file(s) ${where} differ from the latest version and will be overwritten.`,
        { modal: true },
        "Show Changes",
        "Overwrite",
      );
      if (choice === "Show Changes") {
        await showChanges(remote, skill, roots, conflicts, contents);
        continue;
      }
      if (choice !== "Overwrite") return false;
      break;
    }
  }

  for (const root of roots) await writeSkill(root, skill, contents);
  provider.refresh();
  return true;
}

async function addToProject(provider: SkillsProvider, remote: RemoteContent, item: SkillArg) {
  const project = await pickProject();
  if (!project) {
    void vscode.window.showWarningMessage("Open a folder first to add a skill to a project.");
    return;
  }
  const skill = await pickSkill(provider, item);
  if (!skill) return;
  const folders = settings().projectFolders;
  const roots = folders.map((f) => path.join(project.uri.fsPath, f));
  if (!(await install(provider, remote, skill, roots, "in this project"))) return;

  const firstFolder = folders[0];
  // Not awaited: the command is done once the files are written.
  void vscode.window
    .showInformationMessage(
      `Added ${skill.name} to ${folders.join(", ")}. Commit it so teammates and cloud agents get it too.`,
      "Open SKILL.md",
    )
    .then(async (open) => {
      if (!open || !firstFolder) return;
      const doc = path.join(project.uri.fsPath, firstFolder, skill.name, "SKILL.md");
      await vscode.window.showTextDocument(vscode.Uri.file(doc));
    });
}

async function installForUser(provider: SkillsProvider, remote: RemoteContent, item: SkillArg) {
  const skill = await pickSkill(provider, item);
  if (!skill) return;
  const folders = settings().userFolders;
  const roots = folders.map((f) => expandHome(f, os.homedir()));
  if (await install(provider, remote, skill, roots, "in your home folder")) {
    void vscode.window.showInformationMessage(`Installed ${skill.name} to ${folders.join(", ")}.`);
  }
}

async function openPage(item: SkillArg): Promise<void> {
  if (!(item instanceof SkillItem)) return;
  const { indexUrl } = settings();
  await vscode.env.openExternal(vscode.Uri.parse(new URL(item.skill.page, indexUrl).toString()));
}

function guard(fn: (item: SkillArg) => Promise<void>) {
  return async (item: SkillArg) => {
    try {
      await fn(item);
    } catch (err) {
      void vscode.window.showErrorMessage(`Agent Skills: ${message(err)}`);
    }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SkillsProvider();
  const remote = new RemoteContent();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("agentSkills.list", provider),
    vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, remote),
    vscode.commands.registerCommand(
      "agentSkills.refresh",
      guard(async () => {
        await provider.load(true);
      }),
    ),
    vscode.commands.registerCommand(
      "agentSkills.addToProject",
      guard((item) => addToProject(provider, remote, item)),
    ),
    vscode.commands.registerCommand(
      "agentSkills.installForUser",
      guard((item) => installForUser(provider, remote, item)),
    ),
    vscode.commands.registerCommand("agentSkills.openPage", guard(openPage)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("agentSkills")) void provider.load(true).catch(() => undefined);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.refresh();
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up; subscriptions are disposed by VS Code.
}
