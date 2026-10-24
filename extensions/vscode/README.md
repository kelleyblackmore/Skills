# Agent Skills for VS Code, Cursor and Windsurf

Browse the skills from [kelleyblackmore/Skills](https://github.com/kelleyblackmore/Skills) and
add one to your project, or to your user profile, with one click.

## Use it

Open the **Agent Skills** view in the activity bar. Each skill has three buttons:

| Button                           | What it does                                                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add to Project** (`+`)         | Copies the skill into the open project, into every folder in `agentSkills.projectFolders` (default `.claude/skills` and `.github/skills`). Commit it so teammates and cloud agents (Devin, Copilot coding agent, Cursor and Claude Code cloud agents) get it too. |
| **Install for Me** (person icon) | Copies the skill into your home folder (default `~/.claude/skills` and `~/.agents/skills`) so it applies to every project.                                                                                                                                        |
| **Open Skill Page**              | Opens the skill's page on the skills site.                                                                                                                                                                                                                        |

Skills already in the project show **in project**. When the published version differs from
your copy, it shows **update available**; adding it again asks before overwriting changed files
and can show a diff of each one first.

The same actions are in the command palette (**Skills: Add to Project**, **Skills: Install for
Me**), and the commands take a skill name, so you can bind one to a key:

```json
{ "key": "ctrl+alt+g", "command": "agentSkills.addToProject", "args": "git-workflow" }
```

## Where each tool reads skills

| Folder            | Read by                    |
| ----------------- | -------------------------- |
| `.claude/skills/` | Claude Code, Cursor, Devin |
| `.github/skills/` | VS Code Copilot            |
| `.agents/skills/` | Cursor, Devin              |

Change `agentSkills.projectFolders` / `agentSkills.userFolders` to match the tools you use.

## Settings

| Setting                      | Default                                                |
| ---------------------------- | ------------------------------------------------------ |
| `agentSkills.indexUrl`       | `https://kelleyblackmore.github.io/Skills/skills.json` |
| `agentSkills.projectFolders` | `[".claude/skills", ".github/skills"]`                 |
| `agentSkills.userFolders`    | `["~/.claude/skills", "~/.agents/skills"]`             |

## Security

- The index must be served over HTTPS (plain HTTP is allowed only on `localhost`, for previewing
  a locally built site).
- Every file is checked against the SHA-256 and size in the index before anything is written; a
  mismatch aborts the install.
- Skill names and file paths are validated, and writes are confined to `<folder>/<skill>/`.
- It never writes through a symlinked skill folder (for example one linked to a clone of the
  skills repo), and never deletes files.
- It does not run anything from a skill. Skills do contain instructions your agent will follow,
  so only point `indexUrl` at a source you trust.
- Disabled in Restricted Mode (untrusted workspaces).

## Install

Until it is published to the VS Code Marketplace and Open VSX, download `agent-skills.vsix` from
the [latest release](https://github.com/kelleyblackmore/Skills/releases) or the CI run artifacts,
then run **Extensions: Install from VSIX…** in VS Code, Cursor or Windsurf.

## Develop

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run package                     # builds agent-skills.vsix

# End-to-end in a real VS Code (Linux needs a display, e.g. xvfb-run):
python3 ../../scripts/build_site.py
SKILLS_SITE_DIR=../../_site npm test
npm run build && npm run e2e
```

`@azure/msal-node` is overridden in `package.json` to clear advisory GHSA-xcx6-jx8p-x3h5, which
`vsce` pulls in through `@azure/identity`. Only `vsce publish --azure-credential` uses that
package. Remove the override once `@azure/identity` accepts the fixed version.
