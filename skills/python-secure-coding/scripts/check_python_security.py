#!/usr/bin/env python3
"""Check a Python project against the python-secure-coding skill.

Run from the project root:

    check_python_security.py                  # all checks
    check_python_security.py --only python    # just the version check
    check_python_security.py --python .venv/bin/python --ignore pip

Checks: latest Python version, outdated packages, ruff, bandit, pip-audit.
Exits non-zero if any check fails. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess  # fixed tool commands, no shell  # nosec B404
import sys
import tomllib
import urllib.request
from pathlib import Path

CHECKS = ("python", "packages", "ruff", "bandit", "audit")
EXCLUDE_DIRS = (".venv", "venv", ".tox", ".nox", "build", "dist", "node_modules", ".git")
EOL_API = "https://endoflife.date/api/v1/products/python/"
CPYTHON_REPO = "https://github.com/python/cpython"
PYPI_JSON = "https://pypi.org/pypi/{}/json"
RUFF_DEFAULT_SELECT = "E,W,F,I,B,S,UP,SIM,PTH,RUF,N,C4,PL"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    # Argument list from this script, never a shell string.
    return subprocess.run(cmd, capture_output=True, text=True, check=False, **kwargs)  # noqa: S603  # nosec B603


def tool(name: str) -> list[str] | None:
    """Command prefix for a CLI tool: on PATH, else via uvx."""
    if shutil.which(name):
        return [name]
    if shutil.which("uvx"):
        return ["uvx", name]
    return None


def version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(p) for p in text.split("."))


# --- latest Python -----------------------------------------------------------


def latest_python() -> str | None:
    try:
        # Fixed https URL.
        with urllib.request.urlopen(EOL_API, timeout=10) as resp:  # nosec B310
            releases = json.load(resp)["result"]["releases"]
        return max((r["latest"]["name"] for r in releases), key=version_tuple)
    except (OSError, ValueError, KeyError):
        pass
    if shutil.which("git"):
        out = run(["git", "ls-remote", "--tags", CPYTHON_REPO, "v3.*"], timeout=30).stdout
        tags = re.findall(r"refs/tags/v(3\.\d+\.\d+)$", out, re.MULTILINE)
        if tags:
            return max(tags, key=version_tuple)
    return None


def python_pins(root: Path) -> list[tuple[str, str]]:
    """(where, minor version) for every place the project pins Python."""
    pins: list[tuple[str, str]] = []
    minor = r"3\.(\d+)"

    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        data = tomllib.loads(pyproject.read_text())
        req = data.get("project", {}).get("requires-python", "")
        if m := re.search(minor, req):
            pins.append(("pyproject requires-python", f"3.{m[1]}"))
        tool_cfg = data.get("tool", {})
        if m := re.fullmatch(r"py3(\d+)", tool_cfg.get("ruff", {}).get("target-version", "")):
            pins.append(("pyproject ruff target-version", f"3.{m[1]}"))
        if m := re.match(minor, str(tool_cfg.get("mypy", {}).get("python_version", ""))):
            pins.append(("pyproject mypy python_version", f"3.{m[1]}"))
        poetry_py = tool_cfg.get("poetry", {}).get("dependencies", {}).get("python", "")
        if m := re.search(minor, str(poetry_py)):
            pins.append(("pyproject poetry python", f"3.{m[1]}"))

    pv = root / ".python-version"
    if pv.is_file() and (m := re.match(minor, pv.read_text().strip())):
        pins.append((".python-version", f"3.{m[1]}"))

    patterns = {
        "Dockerfile*": r"FROM\s+(?:\S+/)?python:" + minor,
        ".github/workflows/*.y*ml": r"python-version:\s*['\"]?" + minor,
        ".gitlab-ci.yml": r"image:\s*['\"]?(?:\S+/)?python:" + minor,
        "tox.ini": r"py3(\d+)",
    }
    for glob, pattern in patterns.items():
        for path in sorted(root.glob(glob)):
            for m in re.finditer(pattern, path.read_text(errors="ignore")):
                pins.append((str(path.relative_to(root)), f"3.{m[1]}"))
    return pins


def check_python(root: Path, project_python: str) -> bool:
    latest = latest_python()
    if not latest:
        print("  could not determine the latest Python release (no network?)")
        return False
    latest_minor = ".".join(latest.split(".")[:2])
    print(f"  latest stable Python: {latest}")

    ok = True
    pins = python_pins(root)
    if not pins:
        print("  no Python version pinned (add requires-python / .python-version)")
        ok = False
    for where, ver in pins:
        if version_tuple(ver) < version_tuple(latest_minor):
            print(f"  OLD  {where}: {ver} (latest {latest_minor})")
            ok = False
        else:
            print(f"  ok   {where}: {ver}")

    out = run([project_python, "-c", "import platform; print(platform.python_version())"])
    if out.returncode == 0:
        current = out.stdout.strip()
        if version_tuple(current) < version_tuple(latest):
            print(f"  OLD  interpreter {project_python}: {current} (latest {latest})")
            ok = False
        else:
            print(f"  ok   interpreter {project_python}: {current}")
    return ok


# --- packages ----------------------------------------------------------------


def pypi_latest(name: str) -> str | None:
    try:
        # Fixed https URL; name comes from the project's own requirements file.
        url = PYPI_JSON.format(name)
        with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310  # nosec B310
            return json.load(resp)["info"]["version"]
    except (OSError, ValueError, KeyError):
        return None


def check_pins(root: Path, ignore: set[str]) -> bool:
    """Exact pins in requirements*.txt must be the latest release."""
    ok = True
    for req in sorted(root.glob("requirements*.txt")):
        for line in req.read_text().splitlines():
            m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)", line)
            if not m or m[1].lower() in ignore:
                continue
            latest = pypi_latest(m[1])
            if latest is None:
                print(f"  ??   {req.name}: {m[1]} (PyPI lookup failed)")
                ok = False
            elif latest != m[2]:
                print(f"  OLD  {req.name}: {m[1]}=={m[2]} -> {latest}")
                ok = False
    return ok


def check_packages(root: Path, project_python: str, ignore: set[str]) -> bool:
    pins_ok = check_pins(root, ignore)
    out = run([project_python, "-m", "pip", "list", "--outdated", "--format=json"], timeout=300)
    if out.returncode != 0 and shutil.which("uv"):
        out = run(
            ["uv", "pip", "list", "--outdated", "--format=json", "--python", project_python],
            timeout=300,
        )
    if out.returncode != 0:
        print(f"  could not list packages: {out.stderr.strip()[:300]}")
        return False

    outdated = [p for p in json.loads(out.stdout or "[]") if p["name"].lower() not in ignore]
    for p in outdated:
        print(f"  OLD  {p['name']} {p['version']} -> {p['latest_version']}")
    if not outdated:
        print(f"  all installed packages in {project_python} are at their latest versions")
    return pins_ok and not outdated


# --- ruff, bandit, pip-audit -------------------------------------------------


def run_tool(name: str, args: list[str]) -> bool:
    prefix = tool(name)
    if not prefix:
        print(f"  {name} not installed (pip install {name}, or install uv for uvx)")
        return False
    out = run(prefix + args, timeout=600)
    text = (out.stdout + out.stderr).strip()
    if text:
        print("  " + text.replace("\n", "\n  "))
    return out.returncode == 0


def has_ruff_config(root: Path) -> bool:
    if (root / "ruff.toml").is_file() or (root / ".ruff.toml").is_file():
        return True
    pyproject = root / "pyproject.toml"
    return pyproject.is_file() and "ruff" in tomllib.loads(pyproject.read_text()).get("tool", {})


def check_ruff(root: Path) -> bool:
    args = ["check", str(root)]
    if not has_ruff_config(root):
        print(f"  no ruff config; using the skill's rules ({RUFF_DEFAULT_SELECT})")
        args += ["--select", RUFF_DEFAULT_SELECT]
    lint = run_tool("ruff", args)
    fmt = run_tool("ruff", ["format", "--check", str(root)])
    return lint and fmt


def check_bandit(root: Path) -> bool:
    args = ["-r", str(root), "-q", "-x", ",".join(str(root / d) for d in EXCLUDE_DIRS)]
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "bandit" in tomllib.loads(pyproject.read_text()).get("tool", {}):
        args = ["-c", str(pyproject), *args]
    return run_tool("bandit", args)


def check_audit(root: Path, project_python: str) -> bool:
    reqs = sorted(root.glob("requirements*.txt"))
    if reqs:
        return all(run_tool("pip-audit", ["-r", str(r)]) for r in reqs)
    out = run([project_python, "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"])
    if out.returncode != 0:
        print(f"  cannot locate site-packages for {project_python}")
        return False
    return run_tool("pip-audit", ["--path", out.stdout.strip()])


# --- main --------------------------------------------------------------------


def default_python(root: Path) -> str:
    for venv in (".venv", "venv"):
        candidate = root / venv / "bin" / "python"
        if candidate.exists():
            return str(candidate)
    return sys.executable


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=".", help="project root (default: .)")
    parser.add_argument("--python", help="project interpreter (default: .venv, else this one)")
    parser.add_argument("--only", choices=CHECKS, action="append", help="run only these checks")
    parser.add_argument(
        "--ignore", action="append", default=[], help="package to skip in the outdated check"
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    project_python = args.python or default_python(root)
    ignore = {name.lower() for name in args.ignore}

    checks = {
        "python": lambda: check_python(root, project_python),
        "packages": lambda: check_packages(root, project_python, ignore),
        "ruff": lambda: check_ruff(root),
        "bandit": lambda: check_bandit(root),
        "audit": lambda: check_audit(root, project_python),
    }
    failed = []
    for name in args.only or CHECKS:
        print(f"[{name}]")
        if not checks[name]():
            failed.append(name)

    print()
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
