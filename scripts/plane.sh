#!/usr/bin/env bash
# Plane work items as tickets, through Plane's REST API. One Plane project per target repo,
# matched by the project identifier that prefixes every work item id (PM-12): the same prefix
# scripts/discover-project.sh reads off the target's commit messages, so a project that has
# shipped one ticket needs nothing configured.
#
#   plane.sh projects                                identifier, id and name of every project
#   plane.sh create <IDENT> <title> <body-file>      new work item in the todo state; prints its id
#   plane.sh read <IDENT-n> [--body]                 title, state, labels, body, comments; with
#                                                    --body, the body alone
#   plane.sh edit <IDENT-n> <body-file> <base-file>  replace its description; the title stays
#   plane.sh state <IDENT-n> <state>                 todo | in-progress | blocked | done | cancelled
#   plane.sh comment <IDENT-n> <actor> <text>        one comment, dated to the minute, actor first
#   plane.sh list <IDENT> [state]                    one line per work item: id, state, title
#   plane.sh --self-test                             the converters and edit's checks, offline
#
# The instance and workspace come from [tracker] in ~/.postmaster/config.toml (url and
# workspace; POSTMASTER_CONFIG overrides the path). The key is PLANE_API_KEY in the
# environment, else in the file [tracker] env_file names (default ~/.postmaster/plane.env),
# loaded first. The key never enters the config or this repo.
#
# The flow's states map onto Plane's state groups: todo is the first state in the unstarted
# group (backlog if none), in-progress is started, done is completed, cancelled is cancelled.
# Plane has no blocked group, so blocked is a label named `blocked`, added without moving the
# state and removed by the next state change.
#
# Bodies are the ticket shape in markdown. The script renders them to the HTML Plane stores and
# back to markdown on read: headings, paragraphs, line breaks, rules, nested numbered and bullet
# lists, code blocks with their language, bold, inline code and links. create and edit refuse a
# body that would not read back with the same words and structure. edit refuses a description
# holding anything read does not show as Plane stores it, such as emphasis, a table, an image or
# an HTML comment. It also refuses a work item whose body no longer matches the base file, the
# body as `read --body` printed it when the change was drafted.
#
#   exit 0  ok
#   exit 1  usage, config or key missing, the API refused or was unreachable, unknown
#           project or id, or a body create or edit refuses
#   exit 2  invalid state
#   exit 4  the work item changed since the base was read
set -uo pipefail
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
die() { echo "plane: $*" >&2; exit 1; }
[ $# -ge 1 ] || die "usage: plane.sh projects|create|edit|read|state|comment|list ... | --self-test"
if [ "$1" != --self-test ]; then
  [ -f "$CONFIG" ] || die "no config at $CONFIG (POSTMASTER_CONFIG overrides the path)"
  python3 -c 'import tomllib' 2>/dev/null || die "python3 with tomllib (3.11 or newer) is needed to read the config"
  ENV_FILE=$(python3 -c '
import sys, tomllib
t = tomllib.load(open(sys.argv[1], "rb")).get("tracker", {})
print(t.get("env_file") or "~/.postmaster/plane.env")' "$CONFIG") || die "cannot read $CONFIG"
  f=${ENV_FILE/#\~/$HOME}
  if [ -z "${PLANE_API_KEY:-}" ] && [ -f "$f" ]; then set -a; . "$f"; set +a; fi
  [ -n "${PLANE_API_KEY:-}" ] || die "no PLANE_API_KEY in the environment or in $f (skills/postmaster/trackers.md, plane)"
fi

exec python3 - "$0" "$CONFIG" "$@" <<'PY'
import datetime, html, json, os, re, sys
import urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser

SCRIPT, CONFIG, args = sys.argv[1], sys.argv[2], sys.argv[3:]
cmd = args[0]

def die(msg, code=1):
    print("plane: " + msg, file=sys.stderr); sys.exit(code)

# --- html -> markdown --------------------------------------------------------------------------
# A small tree, rendered block by block. The tags the renderers below handle are the tags read
# shows; edit refuses a description holding any other.

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SPACED = {"td", "th", "tr", "table", "tbody", "thead", "div", "blockquote", "label", "dd", "dt", "figcaption"}
HEADINGS = {"h%d" % k for k in range(1, 7)}
BR = "\x01"  # a hard break inside rendered inline text

class Node:
    def __init__(self, tag, attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

class Tree(HTMLParser):
    def __init__(self, h):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root"); self.stack = [self.root]; self.tags = set(); self.comments = 0
        self.feed(h or ""); self.close()
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        if tag == "li":  # an open item ends where the next item of its list starts
            for k in range(len(self.stack) - 1, 0, -1):
                if self.stack[k].tag in ("ol", "ul"):
                    break
                if self.stack[k].tag == "li":
                    del self.stack[k:]; break
        elif tag in BLOCK and self.stack[-1].tag == "p":
            self.stack.pop()
        node = Node(tag, attrs); self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.tags.add(tag); self.stack[-1].children.append(Node(tag, attrs))
    def handle_endtag(self, tag):
        for k in range(len(self.stack) - 1, 0, -1):
            if self.stack[k].tag == tag:
                del self.stack[k:]; return
    def handle_data(self, data):
        self.stack[-1].children.append(data)
    def handle_comment(self, data):
        self.comments += 1

def text_of(n):
    if isinstance(n, str):
        return n
    return "\n" if n.tag == "br" else "".join(text_of(c) for c in n.children)

def has_block(n):
    return any(isinstance(c, Node) and (c.tag in BLOCK or c.tag == "li" or has_block(c)) for c in n.children)

def flatten(children):  # an unknown tag holding blocks is transparent: its blocks stand in its place
    out = []
    for c in children:
        if isinstance(c, Node) and c.tag not in BLOCK and c.tag not in INLINE and c.tag != "li" and has_block(c):
            out.extend(flatten(c.children))
        else:
            out.append(c)
    return out

def md_inline(nodes):
    out = []
    for n in nodes:
        if isinstance(n, str):
            out.append(n)
        elif n.tag in INLINE:
            out.append(INLINE[n.tag](n))
        else:  # an unknown tag keeps its text
            sep = " " if n.tag in SPACED else ""
            out.append(sep + md_inline(n.children) + sep)
    return "".join(out)

def md_strong(n):
    inner = md_inline(n.children); core = inner.strip()
    if not core:
        return inner
    return "%s**%s**%s" % (inner[:len(inner) - len(inner.lstrip())], core, inner[len(inner.rstrip()):])

def md_code(n):
    code = " ".join(text_of(n).split())
    if not code:
        return ""
    ticks = "`" * (max((len(r) for r in re.findall(r"`+", code)), default=0) + 1)
    pad = " " if code[0] == "`" or code[-1] == "`" else ""
    return ticks + pad + code + pad + ticks

def md_link(n):
    text = " ".join(md_inline(n.children).split())
    href = (n.attrs.get("href") or "").strip()
    if not href:
        return text
    href = href.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
    return "[%s](%s)" % (text or href, href)

INLINE = {"strong": md_strong, "b": md_strong, "code": md_code, "a": md_link, "br": lambda n: BR}

def para_lines(nodes):  # a paragraph's lines; every line but the last ends in a hard break
    segs = [s.strip() for s in re.sub(r"\s+", " ", md_inline(nodes)).split(BR)]
    segs = [s for s in segs if s]
    return [s + "\\" for s in segs[:-1]] + segs[-1:]

def md_heading(n):
    text = " ".join(md_inline(n.children).replace(BR, " ").split())
    return ["#" * int(n.tag[1]) + (" " + text if text else "")]

def code_lang(n):
    code = next((c for c in n.children if isinstance(c, Node) and c.tag == "code"), None)
    classes = ("%s %s" % ((code.attrs.get("class") or "") if code else "", n.attrs.get("class") or "")).split()
    return next((c[len("language-"):] for c in classes if c.startswith("language-")), "")

def code_text(n):
    text = text_of(n)
    return text[:-1] if text.endswith("\n") else text

def md_pre(n):
    text = code_text(n)
    longest = max((len(r) for r in re.findall(r"^[ \t]*(`{3,})", text, re.M)), default=0)
    fence = "`" * max(3, longest + 1)
    return [fence + code_lang(n)] + (text.split("\n") if text else []) + [fence]

def list_start(n):
    try:
        return int(n.attrs.get("start") or 1) if n.tag == "ol" else 1
    except ValueError:
        return 1

def md_list(n, alt=False):  # alt: the other marker, so two lists in a row stay two lists
    ordered, number = n.tag == "ol", list_start(n)
    delim = (")" if alt else ".") if ordered else ("*" if alt else "-")
    lines = []
    for li in (c for c in n.children if isinstance(c, Node) and c.tag == "li"):
        marker = "%d%s " % (number, delim) if ordered else delim + " "
        number += 1
        body = md_blocks(li.children, in_item=True)
        if not body:
            lines.append(marker.rstrip()); continue
        lines.append(marker + body[0])
        lines.extend(" " * len(marker) + l if l else "" for l in body[1:])
    return lines

BLOCK = {**{h: md_heading for h in HEADINGS}, "p": lambda n: para_lines(n.children), "pre": md_pre,
         "hr": lambda n: ["---"], "ol": md_list, "ul": md_list}
RENDERED = set(BLOCK) | set(INLINE) | {"li"}  # what read turns into markdown; edit refuses any other tag

def md_blocks(children, in_item=False):
    blocks, run = [], []  # blocks: (tag, lines, alternate marker)
    def flush():
        lines = para_lines(run) if run else []
        run.clear()
        if lines:
            blocks.append(("p", lines, False))
    for c in flatten(children):
        if isinstance(c, str) or c.tag not in BLOCK:
            run.append(c); continue
        flush()
        alt = c.tag in ("ol", "ul") and bool(blocks) and blocks[-1][0] == c.tag and not blocks[-1][2]
        lines = md_list(c, alt) if c.tag in ("ol", "ul") else BLOCK[c.tag](c)
        if lines:
            blocks.append((c.tag, lines, alt))
    flush()
    out = []
    for k, (tag, lines, _) in enumerate(blocks):
        # in an item, a list follows its paragraph or another list directly; everything else
        # is one blank line apart
        if k and not (in_item and tag in ("ol", "ul") and blocks[k - 1][0] in ("p", "ol", "ul")):
            out.append("")
        out.extend(lines)
    return out

def html_to_text(h):
    return "\n".join(md_blocks(Tree(h).root.children)).strip("\n")

# --- markdown -> html --------------------------------------------------------------------------

ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$")
THEMATIC = re.compile(r"^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$")
BULLET = re.compile(r"^( {0,3})([-*+])(?:([ \t]+)(.*))?$")
ORDERED = re.compile(r"^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*))?$")
FENCE = re.compile(r"^( *)(`{3,}|~{3,})(.*)$")
COMMENT = re.compile(r"^ {0,3}<!--")
LINK = re.compile(r"\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)")
BOLD = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")

def indent(line):
    return len(line) - len(line.lstrip(" "))

def fence_at(line, top=True):  # (indent, fence, info) when the line opens a fenced block
    m = FENCE.match(line)
    if not m or (top and len(m.group(1)) > 3) or (m.group(2)[0] == "`" and "`" in m.group(3)):
        return None
    return len(m.group(1)), m.group(2), m.group(3).strip()

def closes(fence, line):
    s = line.strip()
    return len(s) >= len(fence) and s == fence[0] * len(s)

def item_at(line):  # the list item a line starts, or None
    if THEMATIC.match(line):
        return None
    m = BULLET.match(line)
    if m:
        lead, marker, space, rest = m.group(1), m.group(2), m.group(3) or "", m.group(4) or ""
        kind, delim, number = "ul", m.group(2), 1
    else:
        m = ORDERED.match(line)
        if not m:
            return None
        lead, marker, space, rest = m.group(1), m.group(2) + m.group(3), m.group(4) or "", m.group(5) or ""
        kind, delim, number = "ol", m.group(3), int(m.group(2))
    if rest and len(space) > 4:
        rest = " " * (len(space) - 1) + rest
    width = len(space) if rest and len(space) <= 4 else 1
    return {"kind": kind, "delim": delim, "number": number, "col": len(lead) + len(marker) + width, "rest": rest}

def comment_block(lines, i):  # the line after a whole-line HTML comment, or None if it never closes
    for j in range(i, len(lines)):
        if "-->" in lines[j]:
            return j + 1
    return None

def starts_block(lines, i):
    line = lines[i]
    return bool(ATX.match(line) or THEMATIC.match(line) or fence_at(line) or item_at(line)
                or (COMMENT.match(line) and comment_block(lines, i)))

def code_spans(text):  # the text with each code span swapped for a placeholder, and the spans
    out, spans, k = [], [], 0
    while k < len(text):
        if text[k] != "`":
            out.append(text[k]); k += 1; continue
        n = len(text) - k - len(text[k:].lstrip("`"))
        m = re.compile(r"(?<!`)`{%d}(?!`)" % n).search(text, k + n)
        if not m:
            out.append(text[k:k + n]); k += n; continue
        code = text[k + n:m.start()]
        if len(code) > 1 and code[0] == code[-1] == " " and code.strip():
            code = code[1:-1]
        out.append("\x02%d\x03" % len(spans)); spans.append(code); k = m.end()
    return "".join(out), spans

def inline(text):
    text, spans = code_spans(text)
    esc = lambda s: html.escape(s, quote=False)
    def bold(s):
        out, pos = [], 0
        for m in BOLD.finditer(s):
            out += [esc(s[pos:m.start()]), "<strong>%s</strong>" % esc(m.group(1))]; pos = m.end()
        return "".join(out) + esc(s[pos:])
    out, pos = [], 0
    for m in LINK.finditer(text):
        out += [bold(text[pos:m.start()]), '<a href="%s">%s</a>' % (html.escape(m.group(2)), bold(m.group(1)))]
        pos = m.end()
    out.append(bold(text[pos:]))
    return re.sub("\x02(\\d+)\x03", lambda m: "<code>%s</code>" % esc(spans[int(m.group(1))]), "".join(out))

def item_lines(lines, i, st):  # one list item's lines, relative to its content column
    col, body = st["col"], [st["rest"]]
    fence, blank, i = fence_at(st["rest"], False), False, i + 1
    while i < len(lines):
        l = lines[i]; ind = indent(l)
        if fence:  # a code block in an item runs to its closing fence, however it is indented
            body.append(l[min(ind, col):]); blank, i = False, i + 1
            if closes(fence[1], l):
                fence = None
            continue
        if not l.strip():
            body.append(""); blank, i = True, i + 1; continue
        if ind >= col:
            rel = l[col:]
        elif item_at(l):
            break
        elif not blank and not starts_block(lines, i):
            rel = l.strip()  # a line running straight on belongs to the item above
        elif ind >= 1 and not (ATX.match(l) or THEMATIC.match(l)):
            rel = l[ind:]    # so does an indented line after a blank line
        else:
            break
        body.append(rel); blank, i = False, i + 1
        fence = fence_at(rel, False)
    while body and not body[-1].strip():
        body.pop()
    return body, i

def list_html(lines, i):  # an item keeps the blank lines after it, so they do not end the list
    first = item_at(lines[i]); items = []
    while i < len(lines):
        st = item_at(lines[i])
        if not st or (st["kind"], st["delim"]) != (first["kind"], first["delim"]):
            break
        body, i = item_lines(lines, i, st)
        items.append(body)
    start = ' start="%d"' % first["number"] if first["kind"] == "ol" and first["number"] != 1 else ""
    lis = "".join("<li>%s</li>" % "".join(html_blocks(body)) for body in items)
    return "<%s%s>%s</%s>" % (first["kind"], start, lis, first["kind"]), i

def html_blocks(lines):
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1; continue
        if COMMENT.match(line) and comment_block(lines, i):  # hidden, as GitHub hides it
            i = comment_block(lines, i); continue
        f = fence_at(line)
        if f:
            code, i = [], i + 1
            while i < len(lines) and not closes(f[1], lines[i]):
                code.append(lines[i][min(f[0], indent(lines[i])):]); i += 1
            i += 1
            lang = f[2].split()[0] if f[2] else ""
            cls = ' class="language-%s"' % html.escape(lang) if lang else ""
            out.append("<pre><code%s>%s</code></pre>" % (cls, html.escape("".join(l + "\n" for l in code), quote=False)))
            continue
        m = ATX.match(line)
        if m:
            level, text = len(m.group(1)), re.sub(r"(^|[ \t]+)#+$", "", m.group(2) or "").strip()
            out.append("<h%d>%s</h%d>" % (level, inline(text), level)); i += 1; continue
        if THEMATIC.match(line):
            out.append("<hr>"); i += 1; continue
        if item_at(line):
            block, i = list_html(lines, i); out.append(block); continue
        para, i = [line.strip()], i + 1
        while i < len(lines) and lines[i].strip() and not starts_block(lines, i):
            para.append(lines[i].strip()); i += 1
        text = "".join(l[:-1] + BR if l.endswith("\\") and k < len(para) - 1 else l + " " for k, l in enumerate(para))
        out.append("<p>%s</p>" % inline(text.strip()).replace(BR, "<br>"))
    return out

def md_to_html(md):
    lines = [re.sub(r"^[ \t]+", lambda m: m.group(0).expandtabs(4), l)
             for l in md.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(html_blocks(lines))

# --- the same words and structure --------------------------------------------------------------
# Two descriptions compare as token lists: words, and markers for headings, paragraphs, lists
# with their depth and kind, code blocks and inline markup. Soft wraps and marker spelling vanish.

def href_key(h):
    return h.strip().replace("%28", "(").replace("%29", ")").replace("%20", " ")

def shape(h):
    toks = []
    def inline_toks(nodes):
        for n in nodes:
            if isinstance(n, str):
                toks.extend(n.split())
            elif n.tag in ("strong", "b"):
                mark = len(toks); toks.append("<b>"); inline_toks(n.children)
                if len(toks) == mark + 1:
                    del toks[mark:]
                else:
                    toks.append("</b>")
            elif n.tag == "code":
                if text_of(n).split():
                    toks.append("<code %s>" % " ".join(text_of(n).split()))
            elif n.tag == "a" and (n.attrs.get("href") or "").strip():
                toks.append("<a %s>" % href_key(n.attrs["href"])); inline_toks(n.children); toks.append("</a>")
            elif n.tag == "br":
                toks.append("<br>")
            else:
                inline_toks(n.children)
    def para(nodes, open_="<p>", close="</p>"):
        mark = len(toks); inline_toks(nodes); inner = toks[mark:]; del toks[mark:]
        while inner and inner[0] == "<br>":
            inner.pop(0)
        while inner and inner[-1] == "<br>":
            inner.pop()
        if inner or open_ != "<p>":
            toks.extend([open_] + inner + [close])
    def blocks(children):
        run = []
        for c in flatten(children):
            if isinstance(c, str) or c.tag not in BLOCK:
                run.append(c); continue
            if run:
                para(run); run = []
            if c.tag == "p":
                para(c.children)
            elif c.tag in HEADINGS:
                mark = len(toks); inline_toks(c.children)
                inner = [t for t in toks[mark:] if t != "<br>"]; del toks[mark:]
                toks.extend(["<%s>" % c.tag] + inner + ["</%s>" % c.tag])
            elif c.tag == "pre":
                toks.extend(["<pre %s>" % code_lang(c), code_text(c), "</pre>"])
            elif c.tag == "hr":
                toks.append("<hr>")
            else:
                items = [x for x in c.children if isinstance(x, Node) and x.tag == "li"]
                stray = [x for x in c.children if not (isinstance(x, Node) and x.tag == "li") and (not isinstance(x, str) or x.strip())]
                if not items and not stray:
                    continue
                toks.append("<%s start=%d>" % (c.tag, list_start(c)) if c.tag == "ol" else "<ul>")
                for li in items:
                    toks.append("<li>"); blocks(li.children); toks.append("</li>")
                if stray:
                    para(stray, "<stray>", "</stray>")
                toks.append("</%s>" % c.tag)
        if run:
            para(run)
    blocks(Tree(h).root.children)
    return toks

NAMES = {"p": "a paragraph", "li": "a list item", "ul": "a bullet list", "ol": "a numbered list",
         "pre": "a code block", "hr": "a rule", "br": "a line break", "b": "bold text", "a": "a link",
         "code": "inline code", "stray": "text outside the list's items"}

def token_name(toks, n):
    if n >= len(toks):
        return "nothing more"
    t = toks[n]
    if not t.startswith("<"):
        return '"%s"' % t
    tag, _, detail = t[1:-1].partition(" ")
    end = tag.startswith("/"); tag = tag.lstrip("/")
    name = "a level-%s heading" % tag[1] if tag in HEADINGS else NAMES.get(tag, tag)
    if detail and not end:
        name += {"ol": " (%s)" % detail, "a": " to %s" % detail, "code": ' "%s"' % detail,
                 "pre": " in %s" % detail}.get(tag, "")
    return ("the end of " + name) if end else name

def first_difference(a, b):  # None, or where token list b first departs from a
    n = next((k for k, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    if n == len(a) == len(b):
        return None
    words = [t for t in a[:n] if not t.startswith("<")][-5:]
    where = 'after "%s"' % " ".join(words) if words else "at the start"
    return "%s, %s becomes %s" % (where, token_name(a, n), token_name(b, n))

def readback(md, read=None):  # the HTML md renders to, and where it would not read back as written
    out = md_to_html(md)
    return out, first_difference(shape(out), shape(md_to_html((read or html_to_text)(out))))

def norm_text(t):
    lines = [l.rstrip() for l in t.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)

def plan_edit(stored, base, body):
    """What edit does, without I/O: (0, html) to write, or (exit code, reason) to refuse."""
    if not body.strip():
        return 1, "the body file is empty"
    tree = Tree(stored)
    lost = ["<%s>" % t for t in sorted(tree.tags - RENDERED)] + (["an HTML comment"] if tree.comments else [])
    if lost:
        return 1, ("its description holds %s, which read does not render, so writing it back would "
                   "lose it; the user edits it in Plane" % ", ".join(lost))
    diff = first_difference(shape(stored), shape(md_to_html(html_to_text(stored))))
    if diff:
        return 1, "read does not show its description as Plane stores it (%s); the user edits it in Plane" % diff
    if norm_text(html_to_text(stored)) != norm_text(base):
        return 4, "it changed since the base was read"
    out, diff = readback(body)
    if diff:
        return 1, "the body would not read back as written (%s)" % diff
    return 0, out

# --- self-test ---------------------------------------------------------------------------------

def self_test():
    import difflib, subprocess, tempfile
    fails = [0]
    def check(label, good, detail=""):
        print(("  ok   " if good else "  FAIL ") + label)
        if not good:
            for l in str(detail).splitlines() or [""]:
                print("         " + l)
            fails[0] += 1
    def delta(a, b):
        return "\n".join(difflib.unified_diff(a.split("\n"), b.split("\n"), lineterm="")) or "(no difference)"
    def criteria(h):  # top-level items of the list under "## Acceptance criteria"
        kids = [c for c in Tree(h).root.children if isinstance(c, Node)]
        for k, c in enumerate(kids[:-1]):
            if c.tag == "h2" and " ".join(text_of(c).split()) == "Acceptance criteria" and kids[k + 1].tag == "ol":
                return sum(1 for x in kids[k + 1].children if isinstance(x, Node) and x.tag == "li")
        return 0

    # the well-formed body of scripts/ticket-check.sh's self-test
    body = "\n\n".join([
        "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.",
        "## Acceptance criteria\n"
        "1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n"
        "2. It exits 2 and names each missing part:\n"
        "   - the title\n"
        "   - the direction\n"
        "   1. a nested number is part of criterion 2, not a criterion\n"
        "\n"
        "   ```\n"
        "   ## Direction\n"
        "   ticket-check.sh --body draft.md   # which draft? TODO\n"
        "   ```\n"
        "3. A question or a marker in code, `a?` or `TODO`, is not read,\n"
        "and a line that runs straight on belongs to the criterion above it.\n"
        "\n"
        "   So does an indented paragraph after a blank line.",
        "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.",
        "## Turnpikes\n<!-- default, none, or turnpike names -->\n`default`",
        "## Notes\nA heading inside a fenced block is not a section:\n\n```\n## Direction\n```"]) + "\n"
    editor = ('<h2 class="editor-heading-block">Acceptance criteria</h2>'
              '<ol class="list-decimal pl-7 space-y-[--list-spacing-y] tight" data-tight="true">'
              '<li class="not-prose space-y-2"><p class="editor-paragraph-block">The check runs.</p></li>'
              '<li class="not-prose space-y-2"><p class="editor-paragraph-block">It names each part.</p></li>'
              '</ol><p class="editor-paragraph-block"></p>')

    print("positive controls")
    out, diff = readback(body)
    check("the ticket-check fixture reads back with the same words and structure", diff is None, diff)
    once = html_to_text(out)
    check("it keeps exactly 3 top-level criteria, and one Direction heading",
          criteria(md_to_html(once)) == 3 and md_to_html(once).count("<h2>Direction</h2>") == 1, once)
    check("a line running straight on stays in its criterion, and a comment stays hidden",
          "3. A question or a marker in code, `a?` or `TODO`, is not read, and a line that runs straight on" in once
          and "template comment" not in out, once)
    h = md_to_html("1. Runs:\n   ```\n## not a heading\n\nnot indented\n   ```\n2. Names.")
    check("a code block in a criterion keeps its less indented lines",
          h.count("<ol") == 1 and h.count("<li>") == 2
          and "<li><p>Runs:</p><pre><code>## not a heading\n\nnot indented\n</code></pre></li>" in h, h)
    h = md_to_html("## Direction ##\n\nuse ``a`b`` and `` `x `` here\\\nnext line")
    check("the writer drops a heading's closing #s and a code span's padding, and keeps a hard break",
          h == "<h2>Direction</h2>\n<p>use <code>a`b</code> and <code>`x</code> here<br>next line</p>", h)
    twice = html_to_text(md_to_html(once))
    check("a second cycle gives the same text", twice == once, delta(once, twice))
    text = html_to_text(editor)
    check("Plane editor lists read as one line per item", "1. The check runs.\n2. It names each part." in text, text)
    h = md_to_html("1. A\n\n2. B\n\n3. C")
    check("blank lines between items leave one list of three", h.count("<ol") == 1 and h.count("<li>") == 3, h)
    nested = "<ul><li><p>a</p><ol><li><p>b</p></li><li><p>c</p></li></ol></li><li><p>d</p></li></ul>"
    text = html_to_text(nested)
    check("nested lists read back indented", text == "- a\n  1. b\n  2. c\n- d", text)
    check("and render to the same structure", first_difference(shape(nested), shape(md_to_html(text))) is None,
          first_difference(shape(nested), shape(md_to_html(text))))
    code = '<pre><code class="language-python">print("x")\n</code></pre>'
    text = html_to_text(code)
    check("a code block keeps its language",
          text == '```python\nprint("x")\n```' and 'class="language-python"' in md_to_html(text), text)
    links = ('<p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a>, '
             '<a href="mailto:a@example.org">mail</a> and <a href="/docs/x">docs</a>.</p>')
    text = html_to_text(links)
    check("links survive: an href with parentheses, mailto and a relative one",
          first_difference(shape(links), shape(md_to_html(text))) is None and "Foo_%28bar%29" in text, text)
    misc = ('<p>one<br>two</p><hr><ol start="3"><li><p>c</p></li></ol>'
            '<ul><li><p>x</p></li></ul><ul><li><p>y</p></li></ul>')
    text = html_to_text(misc)
    check("line breaks, rules, a list's start and two lists in a row survive",
          first_difference(shape(misc), shape(md_to_html(text))) is None
          and "one\\\ntwo" in text and "---" in text and "3. c" in text and "- x" in text and "* y" in text, text)
    base = html_to_text(editor)
    code_, out = plan_edit(editor, base + "\n", base + "\n\n## Direction\n\nNone: any approach that meets the criteria.\n")
    check("edit writes stored editor HTML back with the approved part added and the list kept",
          code_ == 0 and "<h2>Direction</h2>" in out and out.count("<li>") == 2, (code_, out))

    print("negative controls")
    bad = '<p>x <em>y</em></p><table><tr><td>z</td></tr></table><img src="a.png"><!-- c -->'
    code_, why = plan_edit(bad, html_to_text(bad), "## Direction\n\nNone.")
    check("edit refuses markup read does not render, and names it",
          code_ == 1 and all(s in why for s in ("<em>", "<table>", "<img>", "an HTML comment")), why)
    code_, why = plan_edit("<p>1. not a list</p>", "1. not a list", "x")
    check("edit refuses a description read does not show as stored", code_ == 1 and "as Plane stores it" in why, why)
    code_, why = plan_edit(editor, base + "\n\nAn edit made in Plane since.", "x")
    check("edit refuses a work item that changed since the base was read", code_ == 4, (code_, why))
    code_, why = plan_edit(editor, base, " \n\n")
    check("edit refuses an empty body", code_ == 1 and "empty" in why, (code_, why))
    lost = first_difference(shape(md_to_html("1. A\n2. B\n3. C")), shape(md_to_html("1. A\n2. B")))
    check("the read-back check reports a lost list item", lost is not None and "a list item" in lost, lost)
    flat = first_difference(shape(md_to_html("1. A\n   - x\n   - y")), shape(md_to_html("1. A\n- x\n- y")))
    check("the read-back check reports a flattened list", flat is not None and "a bullet list" in flat, flat)
    _, diff = readback("1. A\n   - x\n   - y\n", read=lambda h: html_to_text(h).replace("\n   - ", "\n- "))
    check("a body a reader would flatten is refused", diff is not None and "a bullet list" in diff, diff)
    with tempfile.TemporaryDirectory() as d:
        cfg, bf = os.path.join(d, "config.toml"), os.path.join(d, "body.md")
        open(cfg, "w").write('[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n')
        open(bf, "w").write(body)
        r = subprocess.run([SCRIPT, "edit", "PM-1", "A title", bf], capture_output=True, text=True,
                           env=dict(os.environ, POSTMASTER_CONFIG=cfg, PLANE_API_KEY="self-test"))
        check("the old edit form, with a title, is a usage error before any request",
              r.returncode == 1 and "usage:" in r.stderr and "GET" not in r.stderr, r.stderr)
    print()
    if fails[0] == 0:
        print("self-test: all controls behaved"); return 0
    print("self-test: %d control(s) misbehaved" % fails[0]); return 1

if cmd == "--self-test":
    sys.exit(self_test())

# --- the API -----------------------------------------------------------------------------------

import tomllib

STATES = ["todo", "in-progress", "blocked", "done", "cancelled"]
GROUPS_FOR = {"todo": ["unstarted", "backlog"], "in-progress": ["started"],
              "done": ["completed"], "cancelled": ["cancelled"]}
STATE_FOR_GROUP = {"backlog": "todo", "unstarted": "todo", "triage": "todo",
                   "started": "in-progress", "completed": "done", "cancelled": "cancelled"}
BLOCKED = "blocked"

cfg = tomllib.load(open(CONFIG, "rb")).get("tracker", {})
BASE = str(cfg.get("url", "")).rstrip("/"); WS = str(cfg.get("workspace", ""))
if not BASE or not WS:
    die("[tracker] url and workspace are needed in %s (skills/postmaster/trackers.md, plane)" % CONFIG)
KEY = os.environ["PLANE_API_KEY"]

def api(method, path, body=None, params=None):
    url = "%s/api/v1/%s" % (BASE, path)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "X-Api-Key": KEY, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die("%s %s: HTTP %d %s" % (method, path, e.code, e.read().decode(errors="replace")[:300]))
    except urllib.error.URLError as e:
        die("%s %s: %s" % (method, path, e.reason))

def pages(path, params=None):
    params = dict(params or {}); params["per_page"] = 100
    while True:
        page = api("GET", path, params=params)
        yield from page.get("results", [])
        if not page.get("next_page_results"):
            return
        params["cursor"] = page["next_cursor"]

def usage(text):
    die("usage: plane.sh " + text)

def parse_id(tid):
    m = re.fullmatch(r"([A-Za-z][A-Za-z0-9]*)-(\d+)", tid)
    if not m:
        die("not a work item id: %s (expected IDENT-n)" % tid)
    return m.group(1).upper(), int(m.group(2))

def project_for(ident):
    ident = ident.upper()
    for p in pages("workspaces/%s/projects/" % WS):
        if str(p.get("identifier", "")).upper() == ident:
            return p
    die("no project with identifier %s in workspace %s" % (ident, WS))

def states_of(pid):
    return list(pages("workspaces/%s/projects/%s/states/" % (WS, pid)))

def labels_of(pid):
    return list(pages("workspaces/%s/projects/%s/labels/" % (WS, pid)))

def state_id_for(states, flow_state):
    for group in GROUPS_FOR[flow_state]:
        found = sorted((s for s in states if s.get("group") == group), key=lambda s: s.get("sequence", 0))
        if found:
            return found[0]["id"]
    die("project has no state in group %s for %s" % (" or ".join(GROUPS_FOR[flow_state]), flow_state))

def ref(x):  # a related object arrives as an id or, when expanded, as an object with one
    return x["id"] if isinstance(x, dict) else x

def flow_state(item, states, labels):
    label_names = {l["id"]: l["name"] for l in labels}
    if any(label_names.get(ref(l), "").lower() == BLOCKED for l in item.get("labels") or []):
        return "blocked"
    group = next((s.get("group") for s in states if s["id"] == ref(item.get("state"))), None)
    return STATE_FOR_GROUP.get(group, group or "unknown")

def item_for(tid):
    ident, n = parse_id(tid)
    item = api("GET", "workspaces/%s/work-items/%s-%d/" % (WS, ident, n))
    return ident, item

def read_file(path):
    try:
        return open(path, encoding="utf-8-sig").read()
    except OSError as e:
        die("cannot read %s: %s" % (path, e.strerror))

# --- commands ----------------------------------------------------------------------------------

if cmd == "projects":
    for p in pages("workspaces/%s/projects/" % WS):
        print("%s\t%s\t%s" % (p.get("identifier", ""), p["id"], p.get("name", "")))

elif cmd == "create":
    if len(args) != 4: usage("create <IDENT> <title> <body-file>")
    ident, title, body = args[1], args[2], read_file(args[3])
    out, diff = readback(body)
    if diff:
        die("the body would not read back as written (%s)" % diff)
    proj = project_for(ident)
    todo = state_id_for(states_of(proj["id"]), "todo")
    made = api("POST", "workspaces/%s/projects/%s/work-items/" % (WS, proj["id"]),
               {"name": title, "description_html": out, "state": todo})
    print("%s-%s" % (proj["identifier"], made["sequence_id"]))

elif cmd == "edit":
    if len(args) != 4 or not os.path.isfile(args[2]):
        usage("edit <IDENT-n> <body-file> <base-file> (edit takes no title and never changes one)")
    body, base = read_file(args[2]), read_file(args[3])
    if not body.strip():
        die("the body file %s is empty" % args[2])
    ident, item = item_for(args[1])
    tid = "%s-%s" % (ident, item["sequence_id"])
    code, result = plan_edit(item.get("description_html") or "", base, body)
    if code == 4:
        die("%s changed since %s was read; read it again" % (tid, args[3]), 4)
    if code:
        die("%s: %s" % (tid, result))
    api("PATCH", "workspaces/%s/projects/%s/work-items/%s/" % (WS, ref(item["project"]), item["id"]),
        {"description_html": result})
    print("%s: edited" % tid)

elif cmd == "read":
    rest = [a for a in args[1:] if a != "--body"]
    if len(rest) != 1 or len(args) > 3: usage("read <IDENT-n> [--body]")
    ident, item = item_for(rest[0])
    if "--body" in args:
        print(html_to_text(item.get("description_html")))
        sys.exit(0)
    pid = ref(item["project"])
    states, labels = states_of(pid), labels_of(pid)
    names = {l["id"]: l["name"] for l in labels}
    print("id: %s-%s" % (ident, item["sequence_id"]))
    print("title: %s" % item.get("name", ""))
    print("state: %s" % flow_state(item, states, labels))
    print("labels: %s" % ", ".join(names.get(ref(l), "?") for l in item.get("labels") or []))
    print("created: %s" % str(item.get("created_at", ""))[:10])
    print()
    print(html_to_text(item.get("description_html")))
    comments = list(pages("workspaces/%s/projects/%s/work-items/%s/comments/" % (WS, pid, item["id"])))
    if comments:
        print("\n## Log")
        for c in sorted(comments, key=lambda c: c.get("created_at", "")):
            print("- " + " ".join(html_to_text(c.get("comment_html")).split()))

elif cmd == "state":
    if len(args) != 3: usage("state <IDENT-n> <state>")
    ident, item = item_for(args[1]); new = args[2]
    if new not in STATES:
        die("invalid state %s (one of: %s)" % (new, ", ".join(STATES)), 2)
    pid = ref(item["project"])
    labels = labels_of(pid)
    current = [ref(l) for l in item.get("labels") or []]
    blocked_ids = [l["id"] for l in labels if l["name"].lower() == BLOCKED]
    if new == "blocked":
        if not blocked_ids:
            blocked_ids = [api("POST", "workspaces/%s/projects/%s/labels/" % (WS, pid), {"name": BLOCKED})["id"]]
        patch = {"labels": sorted(set(current) | {blocked_ids[0]})}
    else:
        patch = {"state": state_id_for(states_of(pid), new)}
        if set(current) & set(blocked_ids):
            patch["labels"] = [l for l in current if l not in blocked_ids]
    api("PATCH", "workspaces/%s/projects/%s/work-items/%s/" % (WS, pid, item["id"]), patch)
    print("%s-%s: %s" % (ident, item["sequence_id"], new))

elif cmd == "comment":
    if len(args) < 4: usage("comment <IDENT-n> <actor> <text>")
    ident, item = item_for(args[1]); actor = args[2]; text = " ".join(args[3:])
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    line = "%s %s: %s" % (stamp, actor, text)
    api("POST", "workspaces/%s/projects/%s/work-items/%s/comments/" % (WS, ref(item["project"]), item["id"]),
        {"comment_html": "<p>%s</p>" % html.escape(line, quote=False)})
    print("%s-%s: %s" % (ident, item["sequence_id"], line))

elif cmd == "list":
    if len(args) not in (2, 3): usage("list <IDENT> [state]")
    want = args[2] if len(args) == 3 else None
    if want and want not in STATES:
        die("invalid state %s (one of: %s)" % (want, ", ".join(STATES)), 2)
    proj = project_for(args[1])
    states, labels = states_of(proj["id"]), labels_of(proj["id"])
    items = list(pages("workspaces/%s/projects/%s/work-items/" % (WS, proj["id"])))
    for it in sorted(items, key=lambda i: i.get("sequence_id", 0)):
        st = flow_state(it, states, labels)
        if want is None or st == want:
            print("%s-%s\t%s\t%s" % (proj["identifier"], it["sequence_id"], st, it.get("name", "")))

else:
    usage("projects|create|edit|read|state|comment|list ... | --self-test")
PY
