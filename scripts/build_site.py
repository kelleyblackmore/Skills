#!/usr/bin/env python3
"""Build the GitHub Pages site from skills/ into _site/.

pip install -r requirements-site.txt
python3 scripts/build_site.py            # writes _site/
python3 -m http.server -d _site          # preview
"""

import hashlib
import html
import json
import os
import re
import shutil
import subprocess  # nosec B404
import sys
import zipfile
from pathlib import Path

import markdown
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import TextLexer, get_lexer_for_filename
from pygments.util import ClassNotFound

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "skills"
SITE_SRC = ROOT / "site"
OUT = ROOT / "_site"
REPO_URL = "https://github.com/kelleyblackmore/Skills"
BRANCH = "develop"
MD_EXTENSIONS = ["pymdownx.superfences", "pymdownx.highlight", "tables", "toc", "sane_lists"]
MD_CONFIG = {"pymdownx.highlight": {"guess_lang": False, "css_class": "highlight"}}
INDEX_SCHEMA = 1
# Fixed timestamp so a skill's ZIP only changes when its files do.
ZIP_DATE = (2020, 1, 1, 0, 0, 0)


def split_frontmatter(text):
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    fields = {}
    for line in text[4:end].splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields, text[end + 5 :]


def skill_files(skill_dir):
    """Every file in a skill, SKILL.md included, skipping hidden files and caches."""
    return sorted(
        p
        for p in skill_dir.rglob("*")
        if p.is_file()
        and not any(
            part.startswith(".") or part == "__pycache__" for part in p.relative_to(skill_dir).parts
        )
    )


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def publish_skill(name, description, skill_dir):
    """Copy a skill's files to raw/, zip it to zips/, and return its skills.json entry."""
    files = []
    zip_path = OUT / "zips" / f"{name}.zip"
    zip_path.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in skill_files(skill_dir):
            rel = path.relative_to(skill_dir).as_posix()
            data = path.read_bytes()
            executable = bool(path.stat().st_mode & 0o111)

            raw = OUT / "raw" / name / rel
            raw.parent.mkdir(parents=True, exist_ok=True)
            raw.write_bytes(data)

            info = zipfile.ZipInfo(f"{name}/{rel}", ZIP_DATE)
            info.external_attr = (0o755 if executable else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)

            files.append(
                {"path": rel, "sha256": sha256(data), "size": len(data), "executable": executable}
            )

    digest = sha256("".join(f["path"] + f["sha256"] for f in files).encode())
    return {
        "name": name,
        "description": description,
        "version": digest[:12],
        "page": f"{name}/",
        "zip": {"path": f"zips/{name}.zip", "sha256": sha256(zip_path.read_bytes())},
        "files": files,
    }


def current_commit():
    if sha := os.environ.get("GITHUB_SHA"):
        return sha
    git = shutil.which("git")
    if git is None:
        return None
    # Fixed argument list, absolute git path, no shell.
    out = subprocess.run(  # noqa: S603  # nosec B603
        [git, "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=False
    )
    return out.stdout.strip() or None


def render_md(text):
    return markdown.markdown(text, extensions=MD_EXTENSIONS, extension_configs=MD_CONFIG)


def render_code(path):
    try:
        lexer = get_lexer_for_filename(path.name.removesuffix(".example"))
    except ClassNotFound:
        lexer = TextLexer()
    return highlight(path.read_text(), lexer, HtmlFormatter(cssclass="highlight"))


def file_anchor(rel):
    return "file-" + re.sub(r"[^a-z0-9]+", "-", rel.lower()).strip("-")


def link_local_files(body, rels):
    """Point links like href="references/x.md" at the file's section on the page."""

    def repl(m):
        target = m[1]
        return f'href="#{file_anchor(target)}"' if target in rels else m[0]

    return re.sub(r'href="([^"#:]+)"', repl, body)


def page(title, description, body, depth):
    prefix = "../" * depth
    template = (SITE_SRC / "template.html").read_text()
    return (
        template.replace("{{title}}", html.escape(title))
        .replace("{{description}}", html.escape(description))
        .replace("{{prefix}}", prefix)
        .replace("{{repo}}", REPO_URL)
        .replace("{{body}}", body)
    )


def build_skill(skill_dir):
    fields, body_md = split_frontmatter((skill_dir / "SKILL.md").read_text())
    name = fields["name"]
    description = fields["description"]

    extra = [p for p in skill_files(skill_dir) if p.name != "SKILL.md" or p.parent != skill_dir]
    rels = {p.relative_to(skill_dir).as_posix() for p in extra}

    skill_html = link_local_files(render_md(body_md), rels)
    tree_url = f"{REPO_URL}/tree/{BRANCH}/skills/{name}"

    parts = [
        '<nav class="crumbs"><a href="../">All skills</a> / ' + html.escape(name) + "</nav>",
        f'<p class="lede">{html.escape(description)}</p>',
        '<div class="install"><span>Install</span>'
        "<code>mkdir -p ~/.claude/skills &amp;&amp; "
        f"ln -s &quot;$PWD/skills/{name}&quot; ~/.claude/skills/{name}</code>"
        f'<a href="../zips/{name}.zip">Download ZIP</a>'
        f'<a href="{tree_url}">View on GitHub</a></div>',
        f'<article class="doc">{skill_html}</article>',
    ]
    if extra:
        parts.append('<h2 class="files-title">Files</h2><ul class="files-index">')
        parts += [
            f'<li><a href="#{file_anchor(r)}">{html.escape(r)}</a></li>' for r in sorted(rels)
        ]
        parts.append("</ul>")
        for path in extra:
            rel = path.relative_to(skill_dir).as_posix()
            content = render_md(path.read_text()) if path.suffix == ".md" else render_code(path)
            raw = f"{REPO_URL}/blob/{BRANCH}/skills/{name}/{rel}"
            parts.append(
                f'<section class="file" id="{file_anchor(rel)}">'
                f'<header><code>{html.escape(rel)}</code><a href="{raw}">source</a></header>'
                f'<div class="doc">{content}</div></section>'
            )

    out_dir = OUT / name
    out_dir.mkdir(parents=True)
    (out_dir / "index.html").write_text(page(name, description, "\n".join(parts), depth=1))
    return publish_skill(name, description, skill_dir)


def first_sentence(text):
    return text.split(". ", 1)[0].rstrip(".") + "."


def build_index(skills):
    cards = "\n".join(
        f'<a class="card" href="{s["name"]}/"><h2>{html.escape(s["name"])}</h2>'
        f"<p>{html.escape(first_sentence(s['description']))}</p></a>"
        for s in skills
    )
    intro = (SITE_SRC / "intro.md").read_text()
    body = f'<div class="doc intro">{render_md(intro)}</div><div class="cards">{cards}</div>'
    (OUT / "index.html").write_text(
        page("Agent Skills", "Reusable instructions for AI coding agents.", body, depth=0)
    )


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copy(SITE_SRC / "style.css", OUT / "style.css")
    (OUT / "pygments.css").write_text(
        HtmlFormatter(style="friendly").get_style_defs(".highlight")
        + "\n@media (prefers-color-scheme: dark) {\n"
        + HtmlFormatter(style="github-dark").get_style_defs(".highlight")
        + "\n}\n"
    )
    (OUT / ".nojekyll").write_text("")

    skills = [build_skill(d) for d in sorted(SKILLS_DIR.iterdir()) if d.is_dir()]
    build_index(skills)
    index = {"schema": INDEX_SCHEMA, "repository": REPO_URL, "commit": current_commit()}
    index["skills"] = skills
    (OUT / "skills.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"built {len(skills)} skill pages into {OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
