---
name: python-secure-coding
description: Secure coding rules for Python projects. Use whenever writing, reviewing, or changing Python code, adding or upgrading dependencies, or setting up a Python project, Dockerfile, or CI. Requires the latest stable Python version, the latest package versions, ruff linting and formatting, bandit security scanning, and pip-audit vulnerability checks, all passing before work is reported done.
---

# Python Secure Coding

## Hard rules

1. **Latest stable Python.** New and touched projects target the newest stable
   CPython release (latest minor, latest patch).
2. **Latest packages.** Every dependency you add or touch is at its latest
   release. Never write a version number from memory: look it up.
3. **Linters pass.** `ruff check` and `ruff format --check` are clean.
4. **Bandit passes.** No unresolved findings. No blanket `# nosec`.
5. **No known vulnerabilities.** `pip-audit` is clean.
6. **Secure patterns.** Follow `references/secure-patterns.md`; no `eval`,
   `shell=True`, `pickle` on untrusted data, unsafe YAML, string-built SQL, etc.

Run this skill's `scripts/check_python_security.py` from the project root to check 1–5 in
one pass. Work isn't done until it exits 0.

## 1. Python version

Find the latest stable release at the time of the change, don't assume it:

```bash
python3 scripts/check_python_security.py --only python
# or by hand:
curl -s https://endoflife.date/api/v1/products/python/ | python3 -m json.tool | head -40
git ls-remote --tags https://github.com/python/cpython 'v3.*' \
  | grep -oE 'v3\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

Then make every place that pins Python agree on that version:

| File | Setting |
|---|---|
| `pyproject.toml` | `requires-python = ">=3.X"`, `[tool.ruff] target-version = "py3X"`, `[tool.mypy] python_version = "3.X"` |
| `.python-version` | `3.X` (or `3.X.Y`) |
| `Dockerfile` | `FROM python:3.X-slim` (pin a digest in production) |
| CI | `python-version: "3.X"` / `image: python:3.X` |
| `tox.ini` / `noxfile.py` | `py3X` |

If a dependency doesn't support the newest minor yet, use the newest minor it
does support, and say so in the MR description with the blocking package.
Never stay on an end-of-life version.

After bumping, run `ruff check --select UP --fix` to modernise syntax for the
new target.

## 2. Packages

**Adding a dependency** – look up its latest version first:

```bash
pip index versions <package>          # or: uv pip install --dry-run <package>
```

Check it's the real package (exact name, maintained, sensible download count)
to avoid typosquats. Prefer the standard library when it covers the need.

**Upgrading** – use the project's own tool so lock files stay consistent:

| Tool | Upgrade everything |
|---|---|
| uv | `uv lock --upgrade && uv sync` |
| poetry | `poetry update` (and raise caret bounds in `pyproject.toml` if they block the latest) |
| pip-tools | `pip-compile --upgrade` |
| plain pip | `pip list --outdated`, then update `requirements*.txt` pins |
| pre-commit hooks | `pre-commit autoupdate` |

Then run the test suite. If a major version breaks something, fix the code
for the new API; only hold a package back with a comment naming the blocker.

Never edit lock files by hand. Commit dependency upgrades separately from
feature work (`build: upgrade dependencies`).

## 3. Linters

Use **ruff** for lint + format, with security rules enabled. Copy the
settings in `assets/pyproject-snippet.toml` if the project has none. Minimum:

```toml
[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "S", "UP", "SIM", "PTH", "RUF", "N", "C4", "PL"]
```

```bash
ruff check .
ruff format --check .
mypy .        # if the project uses type checking
```

Fix the code, don't silence the rule. Suppress only a proven false positive,
with the specific code, never a bare `# noqa`.

If ruff warns that the target Python is "under development", the version is
newer than ruff fully supports: upgrade ruff first; if it's already the
latest, keep the target and accept the warning.

## 4. Bandit

```bash
bandit -c pyproject.toml -r . -q
```

- Fix every finding. Treat MEDIUM/HIGH as blockers; fix LOW too unless it's a
  proven false positive.
- Suppress only a proven false positive, on that line, with the test ID.
  Never bare `# nosec`, never skip tests globally to get green.
- Ruff's `S` rules are the same checks and don't read `# nosec`, so a
  suppressed line needs both. Put the reason in a comment above (bandit
  treats words after `nosec` as test IDs and warns):
  ```python
  # cmd is built from constants above; no shell, no user input.
  subprocess.run(cmd, check=True)  # noqa: S603  # nosec B603
  ```
- Excluding test directories, or skipping `B101` (assert) for tests only, is
  fine via `[tool.bandit]` in `pyproject.toml`.

## 5. Vulnerability audit

```bash
pip-audit                       # current environment
pip-audit -r requirements.txt   # a requirements file
```

Upgrade any package with a known vulnerability to a fixed version. If no fix
exists, tell the user the CVE, the package, and whether the vulnerable code
path is reachable.

## 6. Wire it into pre-commit and CI

Add the hooks in `assets/pre-commit-snippet.yaml` to `.pre-commit-config.yaml`,
then `pre-commit autoupdate` so every `rev` is the latest. CI must run the same
checks (pre-commit + `pip-audit` + tests) on the latest Python.

## Checklist before reporting done

- [ ] Python version is the latest stable in every pin (or blocker documented)
- [ ] Added/touched packages are at their latest versions; lock file regenerated
- [ ] `ruff check` and `ruff format --check` clean
- [ ] `bandit` clean, any `# nosec` / `# noqa` has an ID and a reason above it
- [ ] `pip-audit` clean
- [ ] Code follows `references/secure-patterns.md`
- [ ] Tests pass
