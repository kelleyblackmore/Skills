# Agent Skills

Reusable instructions that tell AI coding agents how to do a job the way we
want it done: git hygiene, secure coding, CI, containers, and infrastructure.

Each skill is a folder with a `SKILL.md` (frontmatter + instructions), plus
optional references, templates, and scripts. They work with Claude Code and
any agent that can read Markdown instructions.

**Use one** by symlinking it into your agent's skills directory:

```bash
git clone https://github.com/kelleyblackmore/Skills ~/src/skills
mkdir -p ~/.claude/skills
ln -s ~/src/skills/skills/git-workflow ~/.claude/skills/git-workflow
```
