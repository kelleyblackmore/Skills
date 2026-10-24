# Agent Skills

Reusable instructions that tell AI coding agents how to do a job the way we
want it done: git hygiene, secure coding, CI, containers, and infrastructure.

Each skill is a folder with a `SKILL.md` (frontmatter + instructions), plus
optional references, templates, and scripts. They work with Claude Code and
any agent that can read Markdown instructions.

**One click:** install the [Agent Skills extension](https://github.com/kelleyblackmore/Skills/tree/develop/extensions/vscode)
for VS Code, Cursor or Windsurf and use **Add to Project** in its sidebar.

**Claude desktop / claude.ai:** use **Download ZIP** on a skill's page, then upload it under
Skills in Claude's settings.

**Or by hand**, symlink a skill into your agent's skills directory:

```bash
git clone https://github.com/kelleyblackmore/Skills ~/src/skills
mkdir -p ~/.claude/skills
ln -s ~/src/skills/skills/git-workflow ~/.claude/skills/git-workflow
```
