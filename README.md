# Skills

Agent skills: reusable instructions that tell AI coding agents how to do a
specific job the way we want it done. Each skill is a folder with a `SKILL.md`
(YAML frontmatter + Markdown), compatible with Claude Code / Agent Skills.

## Skills

| Skill | What it covers |
|---|---|
| [git-workflow](skills/git-workflow/SKILL.md) | Branching from `develop`, pre-commit, small clean commit messages, pushing to open MRs, keeping pipelines green |

## Layout

```
skills/
  <skill-name>/
    SKILL.md          # required: frontmatter (name, description) + instructions
    references/       # optional: longer docs the skill links to
    scripts/          # optional: helper scripts the skill runs
templates/SKILL.md    # starting point for a new skill
scripts/              # repo tooling (validation)
```

## Using the skills

Claude Code, per user:

```bash
git clone https://github.com/kelleyblackmore/Skills ~/src/skills
mkdir -p ~/.claude/skills
ln -s ~/src/skills/skills/git-workflow ~/.claude/skills/git-workflow
```

Per project: copy or symlink a skill folder into the project's `.claude/skills/`.

Other agents: point the agent's instructions file (`AGENTS.md`, etc.) at the
skill's `SKILL.md`.

## Adding a skill

1. `cp -r templates skills/<skill-name>` and edit `SKILL.md`.
   `name` must match the folder name (lowercase, hyphens).
2. Write the `description` around *when* to use the skill; that's what agents
   match on.
3. Add the skill to the table above.
4. `pre-commit run --all-files` must pass.

## Development

```bash
pip install pre-commit
pre-commit install   # installs pre-commit and commit-msg hooks
```

Work happens on `develop` (or branches off it); MRs target `develop`.
CI runs pre-commit and checks commit messages on every PR.
