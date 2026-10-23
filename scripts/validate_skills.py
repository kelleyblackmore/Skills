#!/usr/bin/env python3
"""Validate every skills/<name>/SKILL.md has well-formed frontmatter."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_NAME = 64
MAX_DESCRIPTION = 1024


def parse_frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields


def check_skill(skill_dir):
    errors = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: missing SKILL.md"]

    fields = parse_frontmatter(skill_md.read_text(encoding="utf-8"))
    if fields is None:
        return [f"{skill_md}: missing or unterminated --- frontmatter"]

    name = fields.get("name", "")
    description = fields.get("description", "")
    if not name:
        errors.append(f"{skill_md}: frontmatter needs 'name'")
    elif name != skill_dir.name:
        errors.append(f"{skill_md}: name '{name}' must match directory '{skill_dir.name}'")
    elif not NAME_RE.match(name) or len(name) > MAX_NAME:
        errors.append(f"{skill_md}: name must be lowercase-hyphenated, <= {MAX_NAME} chars")

    if not description:
        errors.append(f"{skill_md}: frontmatter needs 'description'")
    elif len(description) > MAX_DESCRIPTION:
        errors.append(f"{skill_md}: description is {len(description)} chars, max {MAX_DESCRIPTION}")

    return errors


def main():
    skill_dirs = sorted(p for p in SKILLS_DIR.iterdir() if p.is_dir())
    if not skill_dirs:
        print("no skills found under skills/", file=sys.stderr)
        return 1

    errors = [e for d in skill_dirs for e in check_skill(d)]
    for error in errors:
        print(error, file=sys.stderr)
    if not errors:
        print(f"{len(skill_dirs)} skill(s) OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
