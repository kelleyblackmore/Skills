# Skills

Agent skills: reusable instructions that tell AI coding agents how to do a
specific job the way we want it done. Each skill is a folder with a `SKILL.md`
(YAML frontmatter + Markdown), compatible with Claude Code / Agent Skills.

## Skills

| Skill | What it covers |
|---|---|
| [git-workflow](skills/git-workflow/SKILL.md) | Branching from `develop`, pre-commit, small clean commit messages, pushing to open MRs, keeping pipelines green |
| [python-secure-coding](skills/python-secure-coding/SKILL.md) | Latest Python and packages, ruff, bandit, pip-audit, secure coding patterns |
| [js-ts-secure-coding](skills/js-ts-secure-coding/SKILL.md) | Latest Node LTS and packages, ESLint security rules, strict TypeScript, npm audit, secure patterns |
| [secure-dockerfiles](skills/secure-dockerfiles/SKILL.md) | Pinned latest base images, multi-stage, non-root, no secrets in layers, hadolint, Trivy |
| [ci-pipelines](skills/ci-pipelines/SKILL.md) | Standard CI stages, SHA-pinned actions, least-privilege tokens, OIDC, actionlint, zizmor |
| [terraform-security](skills/terraform-security/SKILL.md) | Latest Terraform/OpenTofu and providers, tflint, checkov, remote state, secure resource defaults |
| [go-secure-coding](skills/go-secure-coding/SKILL.md) | Latest Go and modules, golangci-lint with gosec, govulncheck, race detector, secure Go patterns |
| [rust-secure-coding](skills/rust-secure-coding/SKILL.md) | Latest Rust and crates, clippy with strict lints, cargo-audit, cargo-deny, minimal unsafe |
| [kubernetes-security](skills/kubernetes-security/SKILL.md) | Restricted pod security, pinned images, limits, least-privilege RBAC, default-deny network, kubeconform, kube-linter |
| [secrets-management](skills/secrets-management/SKILL.md) | No secrets in git, gitleaks in pre-commit and CI, runtime loading, OIDC, leaked-secret response |
| [code-review](skills/code-review/SKILL.md) | Reviewing PRs/MRs: what to check, verifying findings, severity labels, writing actionable comments |

Browse them at **https://kelleyblackmore.github.io/Skills/**.

**One-click install:** the [Agent Skills extension](extensions/vscode/README.md) for VS Code,
Cursor and Windsurf adds a skill to the open project (or your home folder) from a sidebar.

## Layout

```
skills/
  <skill-name>/
    SKILL.md          # required: frontmatter (name, description) + instructions
    references/       # optional: longer docs the skill links to
    scripts/          # optional: helper scripts the skill runs
templates/SKILL.md    # starting point for a new skill
scripts/              # repo tooling (validation, site build)
site/                 # GitHub Pages template, styles, intro
extensions/vscode/    # Agent Skills extension for VS Code, Cursor, Windsurf
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

## Site

The GitHub Pages site is generated from `skills/` by `scripts/build_site.py`
and deployed by `.github/workflows/pages.yml` on every push to `develop`.
Alongside the pages it publishes:

- `skills.json`: an index of every skill with each file's path, size and SHA-256
  (what the extension reads)
- `raw/<skill>/<file>`: the skill files themselves
- `zips/<skill>.zip`: one ZIP per skill, ready to upload to Claude desktop / claude.ai

```bash
pip install -r requirements-site.txt
python3 scripts/build_site.py
python3 -m http.server -d _site
```
