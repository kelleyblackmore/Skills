#!/usr/bin/env python3
"""Build the GitHub Pages site from skills/ into _site/.

pip install -r requirements-site.txt
python3 scripts/build_site.py            # writes _site/
python3 -m http.server -d _site          # preview
"""

import html
import re
import shutil
import sys
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


def split_frontmatter(text):
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    fields = {}
    for line in text[4:end].splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields, text[end + 5 :]


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

    extra = sorted(
        p
        for p in skill_dir.rglob("*")
        if p.is_file()
        and p.name != "SKILL.md"
        and not any(part.startswith(".") or part == "__pycache__" for part in p.parts)
    )
    rels = {p.relative_to(skill_dir).as_posix() for p in extra}

    skill_html = link_local_files(render_md(body_md), rels)
    tree_url = f"{REPO_URL}/tree/{BRANCH}/skills/{name}"

    parts = [
        '<nav class="crumbs"><a href="../">All skills</a> / ' + html.escape(name) + "</nav>",
        f'<p class="lede">{html.escape(description)}</p>',
        '<div class="install"><span>Install</span>'
        f"<code>ln -s &quot;$PWD/skills/{name}&quot; ~/.claude/skills/{name}</code>"
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
    return name, description


def first_sentence(text):
    return text.split(". ", 1)[0].rstrip(".") + "."


def build_index(skills):
    cards = "\n".join(
        f'<a class="card" href="{name}/"><h2>{html.escape(name)}</h2>'
        f"<p>{html.escape(first_sentence(desc))}</p></a>"
        for name, desc in skills
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
    print(f"built {len(skills)} skill pages into {OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
