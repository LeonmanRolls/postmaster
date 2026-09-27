#!/usr/bin/env bash
# Check a ticket's shape before it is accepted: a title, the problem or feature, numbered
# acceptance criteria each answerable yes or no, the direction, and the turnpikes. This is the
# executable form of the ticket shape in skills/postmaster/trackers.md.
#
#   ticket-check.sh <repo> <ticket-id>                    through the adapter of the kind the repo
#                                                         uses, as scripts/tracker-kind.sh names it:
#                                                         local when its store exists, else the
#                                                         config's [tracker] kind
#   ticket-check.sh --body <body-file> [--title <title>]  a body file, as an adapter's create
#                                                         takes it; the title is judged only when
#                                                         --title gives one
#   ticket-check.sh --splice <base-body> <sections>       print <base-body> with each `##` section
#                                                         of <sections> in place of the one it
#                                                         names, or added where the shape puts it
#   ticket-check.sh --self-test
#
# What it judges, and nothing more:
#   - The title has words: the one the adapter read, or the one --title gives.
#   - `## Problem / feature`, `## Acceptance criteria`, `## Direction` and `## Turnpikes` are
#     each present once, at level two, in that order, with words under them. Headings match
#     ignoring case, a trailing colon, a closing run of # and the spacing around the slash.
#   - The acceptance criteria are a list numbered 1, 2, 3 in order, with nothing outside the
#     list but blank lines and thematic breaks. Indented lines, nested lists and lines running
#     straight on belong to the criterion above them.
#   - Each criterion is answerable yes or no, which here means three things a script can see:
#     it has words; it asks no question, so no question mark ends a sentence in it, closing
#     brackets and emphasis aside; and it is not marked to be decided later.
#   - No part is marked to be decided later: TBD or TBC anywhere, or TODO as the whole text or
#     followed by a colon. TODO as a word, as in "a TODO list", is not a mark.
#   - The turnpikes are `default`, `none` or turnpike names, as `scripts/turnpikes.sh resolve`
#     reads them, and every word that is not a turnpike is named. The names come from that
#     script alone, so a turnpike added there needs no change here.
# Code spans, fenced blocks and HTML comments are not read for questions, marks or headings,
# and quoted text is not read for questions. A <!-- that nothing closes is text. Turnpikes are
# read from code spans too, and not from fenced blocks or HTML comments.
#
# What it does not judge: whether the description says why the change matters; whether a
# criterion is vague ("fast enough", "where possible") or can really be tested; whether the
# criteria are the right ones, or enough; what the direction says. `## Notes` and
# `## User journey` are optional and not checked. An indented code block is read as text.
#
# --splice changes nothing else: every line of <base-body> outside the sections it replaces is
# printed as it was. It is how a part the user approved is written into a ticket without
# retyping the rest. A part it would write whose name stands as a subheading inside a later
# part of the base, such as `### Direction` under `## Notes`, is refused: that heading may be the
# part at the wrong level or the user's own text, and splicing would delete it or leave two.
#
# POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml). A tracker of kind
# `other` has no adapter script: read the ticket with its own tooling and check it with --body.
#
#   exit 0  well-formed: it prints how many acceptance criteria it has, then the turnpikes as the
#           waybill carries them, `turnpikes: <names>` or `turnpikes: none`; with --splice, the body
#   exit 1  usage; a file that cannot be read; no config, or one that does not parse; a tracker kind
#           with no adapter script; the adapter could not read the ticket; scripts/turnpikes.sh
#           could not be run or gave no verdict; or, with --splice, a sections file that is not a
#           list of `##` sections, or a part it would write named inside a later part of the base
#   exit 2  malformed; one line per missing or malformed part on stdout, the part named first
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
usage() { echo "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test" >&2; exit 1; }

run_py() {  # run_py body <file> <title> | printed <adapter-read-output> | splice <base> <sections>
  TURNPIKES="$HERE/turnpikes.sh" python3 - "$@" <<'PY'
import os, re, subprocess, sys

HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$")
FENCE = re.compile(r"^\s*(`{3,})[^`]*$|^\s*(~{3,})")
FENCED_ITEM = re.compile(r"^ *(?:[-*+]|\d{1,9}[.)])[ \t]+(?:(`{3,})[^`]*|(~{3,}).*)$")  # 1. ``` opens a fence
TICKS = re.compile(r"`+")
SPAN = re.compile(r"(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n).)+?)(?<!`)\1(?!`)", re.S)
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”')
QUESTION = re.compile(r"[?？][*_)\]]*[.,;:]?(?=\s|$)")
ITEM = re.compile(r"^( *)(\d{1,9})[.)](?:[ \t]+(.*))?$")
BULLET = re.compile(r"^ {0,3}[-*+](?:[ \t]|$)")
BREAK = re.compile(r"^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$")
PARTS = [("problem / feature", "Problem / feature"),
         ("acceptance criteria", "Acceptance criteria"),
         ("direction", "Direction"),
         ("turnpikes", "Turnpikes")]
RANK = {"problem / feature": 0, "acceptance criteria": 1, "direction": 2, "turnpikes": 3, "notes": 4,
        "user journey": 5}

def die(msg):
    print("ticket-check: " + msg, file=sys.stderr); sys.exit(1)

def load(path):
    try:
        return open(path, encoding="utf-8-sig", errors="replace").read()
    except OSError as e:
        die("cannot read %s: %s" % (path, e.strerror))

def uncomment(t, inside, k, last):
    # One line without its HTML comments, code spans left alone. A comment that starts a line
    # runs to the next -->, on any line after it (`last` is where the body's last --> starts);
    # one inside a line must close on that line. A <!-- that nothing closes is text.
    out, i = [], 0
    while True:
        if inside:
            j = t.find("-->", i)
            if j < 0:
                return "".join(out), True
            i, inside = j + 3, False
            continue
        c, b = t.find("<!--", i), TICKS.search(t, i)
        if b and (c < 0 or b.start() < c):
            close = re.compile(r"(?<!`)%s(?!`)" % b.group(0)).search(t, b.end())
            end = close.end() if close else b.end()
            out.append(t[i:end]); i = end
        elif c < 0:
            out.append(t[i:]); return "".join(out), False
        elif not t[:c].strip() and (k, c + 4) <= last:
            out.append(t[i:c]); i, inside = c + 4, True
        elif "-->" in t[c + 4:]:
            out.append(t[i:c]); i = t.index("-->", c + 4) + 3
        else:
            out.append(t[i:c + 4]); i = c + 4

def tokenize(text):  # the lines as written, and as read: (text without comments, inside a fence)
    raw = text.split("\n")
    last = max(((k, t.rfind("-->")) for k, t in enumerate(raw) if "-->" in t), default=(-1, -1))
    lines, fence, inside = [], None, False
    for k, t in enumerate(raw):
        if fence:
            lines.append((t, True))
            s = t.strip()
            if len(s) >= len(fence) and s == fence[0] * len(s):
                fence = None
            continue
        m = None if inside else FENCE.match(t)
        item = None if inside or m else FENCED_ITEM.match(t)
        if m:
            fence = m.group(1) or m.group(2); lines.append((t, True))
        elif item:  # the criterion's own line is read, and the fence it opens is code
            fence = item.group(1) or item.group(2); lines.append((t, False))
        else:
            t, inside = uncomment(t, inside, k, last); lines.append((t, False))
    return raw, lines

def norm(h):
    h = re.sub(r"[ \t]+#+$", "", h.strip()).strip().rstrip(":")
    return re.sub(r"\s+", " ", re.sub(r"\s*/\s*", " / ", h)).strip().lower()

def heads_of(lines):  # (line, level, normalised text, as written)
    heads = []
    for i, (t, code) in enumerate(lines):
        m = None if code else HEADING.match(t)
        if m:
            heads.append((i, len(m.group(1)), norm(m.group(2) or ""), t.strip()))
    return heads

def bounds_of(heads):
    # A section ends at the next heading of level one or two, or at any heading naming a part of
    # the shape, so a part written at the wrong level is not read as the text of the part above it.
    return [h for h in heads if h[1] <= 2 or h[2] in RANK]

def has_words(lines):
    return bool(re.search(r"[^\W_]", " ".join(t for t, _ in lines)))

def prose(lines):  # the text a reader is asked to judge: no fenced blocks, no code spans
    return SPAN.sub(" ", "\n".join(t for t, code in lines if not code))

def marked(p):
    m = re.search(r"\b(TBD|TBC)\b", p) or re.search(r"\b(TODO)\b\s*:", p) or re.fullmatch(r"\W*(TODO)\W*", p)
    return m.group(1) if m else None

def question(p):  # the sentence that asks a question, if one does; quoted text is not read
    q = QUESTION.search(QUOTED.sub(lambda m: " " * len(m.group(0)), p))
    return re.split(r"(?<=[.!?？])\s+|\n\s*", p[:q.start() + 1])[-1] if q else None

def clip(s, n=70):
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n - 3] + "..."

def criteria(fault, part, body):
    items, strays = [], []  # items: [number, lines]; strays: the first line of each block outside the list
    cur = base = owner = None
    blank = prev_code = in_stray = False
    for t, code in body:
        if code:
            if not prev_code:  # a fence opens: it belongs to the criterion above it, or to nothing
                owner = cur if cur is not None and (t[:1].isspace() or not blank) else None
                if owner is None:
                    if not in_stray:
                        strays.append(t.strip())
                    cur, in_stray = None, True
            if owner is not None:
                owner[1].append((t, True))
            prev_code, blank = True, False
            continue
        prev_code = False
        if not t.strip() or BREAK.match(t):
            blank, in_stray = True, False
            continue
        m = ITEM.match(t)
        if m and len(m.group(1)) <= (3 if base is None else base + 2):
            if base is None:
                base = len(m.group(1))
            cur = [int(m.group(2)), [(m.group(3) or "", False)]]
            items.append(cur); blank = in_stray = False
            continue
        if cur is not None and (t[:1].isspace() or not (blank or BULLET.match(t) or HEADING.match(t))):
            cur[1].append((t, False)); blank = False
            continue
        if not in_stray:
            strays.append(t.strip())
        cur, blank, in_stray = None, False, True
    if not items:
        fault(part, "not a numbered list")
        return 0
    for s in strays:
        fault(part, 'not part of a numbered criterion: "%s"' % clip(s))
    numbers = [n for n, _ in items]
    if numbers != list(range(1, len(items) + 1)):
        fault(part, "numbered %s; number them 1 to %d in order" % (", ".join(map(str, numbers)), len(items)))
    for pos, (_, ls) in enumerate(items, 1):
        if not has_words(ls):
            fault(part, "criterion %d is empty" % pos); continue
        p = prose(ls)
        mark, asks = marked(p), question(p)
        if mark:
            fault(part, "criterion %d is marked %s" % (pos, mark))
        if asks:
            fault(part, 'criterion %d asks a question: "%s"' % (pos, clip(asks)))
    return len(items)

def turnpikes(fault, part, body):  # the section's turnpikes, read by scripts/turnpikes.sh, which defines them
    # A list item that opens a fence is code with it, as a plain fence is.
    text = "\n".join(t for t, code in body if not code and not FENCED_ITEM.match(t))
    try:
        r = subprocess.run([os.environ["TURNPIKES"], "resolve"], input=text, capture_output=True,
                           encoding="utf-8", errors="replace")
    except OSError as e:
        die("cannot run %s: %s" % (os.environ["TURNPIKES"], e.strerror))
    said = r.stdout.splitlines()
    if r.returncode == 2 and said:
        for l in said:
            fault(part, l)
        return ""
    if r.returncode == 0 and len(said) == 1 and said[0].startswith("turnpikes: "):
        return said[0]
    # Anything else is no verdict: a turnpikes.sh that breaks never lets a ticket through.
    die("turnpikes.sh resolve gave no verdict (exit %d): %s"
        % (r.returncode, r.stderr.strip() or r.stdout.strip() or "no output"))

def check(title, text):
    raw, lines = tokenize(text)
    heads = heads_of(lines)
    bounds = bounds_of(heads)
    faults = []
    def fault(part, msg):
        faults.append("%s: %s" % (part, msg))
    if title is not None and not re.search(r"[^\W_]", title):
        fault("title", "missing")
    at, count, named = {}, 0, ""
    for key, name in PARTS:
        found = [h for h in bounds if h[1] == 2 and h[2] == key]
        if not found:
            near = [h for h in heads if h[2] == key]
            msg = 'no "## %s" section' % name
            if near:
                msg += '; "%s" is there, at the wrong level' % near[0][3]
            elif key == "direction":
                msg += '; one is needed even if it says "None: any approach that meets the criteria"'
            elif key == "turnpikes":
                msg += "; one is needed, holding default, none, or turnpike names"
            fault(key, msg)
            continue
        if len(found) > 1:
            fault(key, '"## %s" appears %d times' % (name, len(found)))
        i = at[key] = found[0][0]
        body = lines[i + 1:next((b[0] for b in bounds if b[0] > i), len(lines))]
        if not has_words(body):
            fault(key, '"## %s" is empty' % name)
        elif key == "acceptance criteria":
            count = criteria(fault, key, body)
        elif marked(prose(body)):
            fault(key, '"## %s" is marked %s' % (name, marked(prose(body))))
        elif key == "turnpikes":
            named = turnpikes(fault, key, body)
    for j, (key, name) in enumerate(PARTS):
        after = [n for k, n in PARTS[:j] if k in at and key in at and at[k] > at[key]]
        if after:
            fault(key, '"## %s" comes before "## %s"; the order is %s' % (name, after[0], ", ".join(n for _, n in PARTS)))
    return faults, count, named

def chunks(text):  # the lines before the first section, and each section's lines as written
    raw, lines = tokenize(text)
    if raw and raw[-1] == "":
        raw, lines = raw[:-1], lines[:-1]
    bounds = bounds_of(heads_of(lines))
    starts = [b[0] for b in bounds] + [len(raw)]
    return raw[:starts[0]], [(b, raw[b[0]:starts[k + 1]]) for k, b in enumerate(bounds)]

def splice(base_text, sections_text):
    pre, secs = chunks(base_text)
    lead, given = chunks(sections_text)
    if any(t.strip() for t in lead):
        die("the sections file has text before its first heading")
    if not given:
        die("the sections file has no ## sections")
    for b, _ in given:
        if b[1] != 2:
            die('"%s" in the sections file is not a ## heading' % b[3])
    if len({b[2] for b, _ in given}) != len(given):
        die("the sections file names a section twice")
    # A part's name as a subheading inside a later part may be the part at the wrong level or the
    # user's own text; splicing would delete it or leave two, so the user settles which first.
    heading = {b[2]: b[3] for b, _ in given}
    top = -1
    for b, _ in secs:
        rank = RANK.get(b[2])
        if b[1] == 2 and rank is not None:
            top = max(top, rank)
        elif b[1] > 2 and b[2] in heading and rank is not None and rank < top:
            die('"%s" stands inside a later part; splicing "%s" would delete it or leave two, '
                "so move or rename it first" % (b[3], heading[b[2]]))
    out = [(b[2], c, False) for b, c in secs]
    for b, c in given:
        out = [s for s in out if s[0] != b[2]]
        rank = RANK.get(b[2])
        if rank is None:
            at = len(out)
        else:  # after the last part ranked before it and any unranked sections after that part
            before = [k for k, s in enumerate(out) if RANK.get(s[0], rank) < rank]
            if before:
                at = before[-1] + 1
                while at < len(out) and RANK.get(out[at][0]) is None:
                    at += 1
            else:
                at = next((k for k, s in enumerate(out) if RANK.get(s[0], -1) > rank), len(out))
        while c and not c[-1].strip():
            c = c[:-1]
        out.insert(at, (b[2], c, True))
    lines = list(pre)
    for k, (_, c, new) in enumerate(out):
        if new and lines and lines[-1].strip():
            lines.append("")
        lines.extend(c)
        if new and k + 1 < len(out):
            lines.append("")
    return "\n".join(lines) + "\n"

mode = sys.argv[1]
if mode == "splice":
    sys.stdout.write(splice(load(sys.argv[2]), load(sys.argv[3])))
    sys.exit(0)
text = load(sys.argv[2])
title = sys.argv[3] if len(sys.argv) > 3 else None
if mode == "printed":  # an adapter's read: `key: value` lines, a blank line, then the body
    head, _, text = text.partition("\n\n")
    title = next((l[len("title:"):] for l in head.split("\n") if l.startswith("title:")), "")
faults, count, named = check(title, text)
if faults:
    print("\n".join(faults)); sys.exit(2)
print("well-formed, %d acceptance criteria" % count)
print(named)
PY
}

workdir() {  # a temporary directory for this run, removed on exit or interrupt
  WORK=$(mktemp -d) || exit 1
  trap 'rm -r -- "$WORK" </dev/null 2>/dev/null' EXIT
  trap 'exit 130' INT; trap 'exit 143' TERM
}
copy_in() {  # copy_in <file> <name>; read it once, so a pipe or /dev/stdin works too
  { [ -r "$1" ] && [ ! -d "$1" ] && cat -- "$1" > "$WORK/$2"; } || { echo "ticket-check: cannot read $1" >&2; exit 1; }
}

through_adapter() {  # through_adapter <repo> <id>; checks the ticket as the repo's tracker adapter reads it
  local kind rc
  kind=$("$HERE/tracker-kind.sh" "$1") || return 1   # it says why on stderr
  case $kind in
    github) "$HERE/github.sh" "$1" read "$2" > "$WORK/read.txt" ;;
    plane)  "$HERE/plane.sh" read "$2" > "$WORK/read.txt" ;;
    local)  "$HERE/local.sh" "$1" read "$2" > "$WORK/read.txt" ;;
    *) echo "ticket-check: tracker kind '$kind' has no adapter script; read the ticket with its own tooling (trackers.md, other), write its body to a file, and run: ticket-check.sh --body <file> --title <title>" >&2
       return 1 ;;
  esac
  rc=$?
  [ $rc -eq 0 ] || { echo "ticket-check: the $kind adapter could not read $2 (exit $rc)" >&2; return 1; }
  run_py printed "$WORK/read.txt"
}

case ${1:-} in
  --self-test) ;;
  --body)
    [ $# -eq 2 ] || { [ $# -eq 4 ] && [ "$3" = --title ]; } || usage
    workdir; copy_in "$2" body.md
    if [ $# -eq 4 ]; then run_py body "$WORK/body.md" "$4"; else run_py body "$WORK/body.md"; fi; exit $? ;;
  --splice)
    [ $# -eq 3 ] || usage
    workdir; copy_in "$2" base.md; copy_in "$3" sections.md
    run_py splice "$WORK/base.md" "$WORK/sections.md"; exit $? ;;
  ""|-*) usage ;;
  *) [ $# -eq 2 ] || usage
     workdir; through_adapter "$1" "$2"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
SELF="$HERE/ticket-check.sh"
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
git init -q "$tmp" || exit 1   # a repository with no local store, for the checks by id
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }

# The turnpikes as scripts/turnpikes.sh lists them, so a turnpike added there changes no control
# here: the default set, two names in table order, and a name the table does not have.
LIST=$("$HERE/turnpikes.sh" --list) || { echo "self-test: turnpikes.sh --list failed" >&2; exit 1; }
DEF=$(printf '%s\n' "$LIST" | awk '$2 == "default" {print $1}' | paste -sd, - | sed 's/,/, /g')
N1=$(printf '%s\n' "$LIST" | awk 'NR == 1 {print $1}'); N2=$(printf '%s\n' "$LIST" | awk 'NR == 2 {print $1}')
N2UP=$(printf '%s' "$N2" | awk '{print toupper(substr($0, 1, 1)) substr($0, 2)}')
[ -n "$DEF" ] && [ -n "$N2" ] || { echo "self-test: turnpikes.sh needs a default set and two turnpikes" >&2; exit 1; }
NOPE=zz-not-listed
printf '%s\n' "$LIST" | awk '{print $1}' | grep -qx "$NOPE" && { echo "self-test: $NOPE is a turnpike; pick another unused name" >&2; exit 1; }

# The parts of a well-formed body. Each negative control leaves one out or breaks one.
P='## Problem / feature
A ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.'
A='## Acceptance criteria
1. The check exits 0 on a well-formed ticket and prints how many criteria it has.
2. It exits 2 and names each missing part:
   - the title
   - the direction
   1. a nested number is part of criterion 2, not a criterion

   ```
   ## Direction
   ticket-check.sh --body draft.md   # which draft? TODO
   ```
3. A question or a marker in code, `a?` or `TODO`, is not read,
and a line that runs straight on belongs to the criterion above it.

   So does an indented paragraph after a blank line.'
D='## Direction
<!-- a template comment is not read: TBD -->
None: any approach that meets the criteria.'
K='## Turnpikes
<!-- default, none, or turnpike names -->
`default`'
N='## Notes
A heading inside a fenced block is not a section:

```
## Direction
```'
T="Check a ticket's shape"
NT='## Notes
Context.

### Turnpikes
Why the default was chosen.

### Out of scope
Nothing else.'
UJ='## User journey
The user opens the board and reads the ticket.'
body() { printf '%s\n\n' "$@" > "$tmp/body.md"; }
run() { out=$("$SELF" --body "$tmp/body.md" --title "$1" 2>&1); rc=$?; }  # run <title>

expect() {  # expect <label> <exit> <parts named, comma-separated, or none> [<text a line must hold>] [<text no line may hold>]
  local label=$1 rc_want=$2 parts_want=$3 why=${4:-} not=${5:-} parts=""
  [ "$rc" -eq 2 ] && parts=$(printf '%s\n' "$out" | grep -E '^(title|problem / feature|acceptance criteria|direction|turnpikes): ' | sed 's/: .*//' | LC_ALL=C sort -u | paste -sd, -)
  [ -n "$parts" ] || parts=none
  if [ "$rc" -eq "$rc_want" ] && [ "$parts" = "$parts_want" ] \
     && { [ -z "$why" ] || printf '%s\n' "$out" | grep -qF -- "$why"; } \
     && { [ -z "$not" ] || ! printf '%s\n' "$out" | grep -qF -- "$not"; }; then
    ok "$label"
  else
    fail "$label: wanted exit $rc_want naming $parts_want${why:+ with \"$why\"}${not:+ and without \"$not\"}, got exit $rc naming $parts" "$out"
  fi
}

named() {  # named <label> <the turnpikes line a passing check prints, whole>
  if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | sed -n 2p)" = "$2" ]; then ok "$1"; else fail "$1: wanted exit 0 and \"$2\", got exit $rc" "$out"; fi
}

# A stand-in adapter beside a copy of this script, so the path through a tracker runs without one.
mkdir "$tmp/bin" && cp "$SELF" "$HERE/turnpikes.sh" "$tmp/bin/"
printf '[tracker]\nkind = "github"\n' > "$tmp/github.toml"
adapter() { printf '#!/usr/bin/env bash\n%s\n' "$1" > "$tmp/bin/github.sh"; chmod +x "$tmp/bin/github.sh"; }
through() { out=$(POSTMASTER_CONFIG="$tmp/github.toml" "$tmp/bin/ticket-check.sh" "$tmp" 7 2>&1); rc=$?; }
cp "$HERE/tracker-kind.sh" "$tmp/bin/"
localsh() { printf '#!/usr/bin/env bash\n%s\n' "$1" > "$tmp/bin/local.sh"; chmod +x "$tmp/bin/local.sh"; }
NOSTORE="case \$2 in store) exit 3 ;; *) echo \"stand-in local.sh: \$*\" >&2; exit 1 ;; esac"
localsh "$NOSTORE"   # the repo has no local store, unless a control says so

echo "positive controls"
body "$P" "$A" "$D" "$K" "$N"; run "$T"
expect "a well-formed ticket passes" 0 none
[ "$out" = "well-formed, 3 acceptance criteria
turnpikes: $DEF" ] && ok "it counts three criteria, not the nested number or the lines under them, then prints the turnpikes" \
  || fail "it counts three criteria, not the nested number or the lines under them, then prints the turnpikes" "$out"
body "$P" "$A" "$D" "$K"; run "$T"
expect "Notes and User journey are optional" 0 none
out=$("$SELF" --body "$tmp/body.md" 2>&1); rc=$?
expect "without --title only the body is judged" 0 none
body "## Problem/Feature
Tickets arrive without criteria." "## Acceptance Criteria:
1) The check runs on every ticket." "## Direction ##
Use the tracker adapters." "## turnpikes:
default"; run "$T"
expect "headings match ignoring case, a colon, the slash's spacing and a closing #" 0 none
body "$P" "## Acceptance criteria
1.
The check runs, the criterion's text on the line below its number." "$D" "$K"; run "$T"
expect "a criterion's text may start on the line below its number" 0 none
body "$P" '## Acceptance criteria
   1. The check runs.
   2. It names each part.

---' "$D" "$K"; run "$T"
expect "a list indented three spaces, and a thematic break after it" 0 none
body "$P" '## Acceptance criteria
1. Setup asks "Overwrite the config?" before writing, and prints https://example.org/board?view=kanban.
2. The CLI prompts "Continue? [y/N]" before it deletes an item.' "$D" "$K"; run "$T"
expect "a question mark in quotes or inside a word is not a question" 0 none
body "$P" '## Acceptance criteria
1. Setup prints `Overwrite the config?
   [y/N]` and waits for an answer.' "$D" "$K"; run "$T"
expect "a code span that wraps onto the next line is still code" 0 none
body '## Problem / feature
The template parser fails when a body holds `<!--` with no closer.' '## Acceptance criteria
1. The check runs.
2. The arrow in `a --> b` is kept.' "$D" "$K"; run "$T"
expect "a comment marker inside code hides nothing" 0 none
body '## Problem / feature
The parser fails on <!-- when nothing closes it.' "$A" "$D" "$K"; run "$T"
expect "a <!-- inside a line that the line does not close is text" 0 none
body "$P" '<!-- a comment that never closes' "$A" "## Direction
None: any approach that meets the criteria." "## Turnpikes
default"; run "$T"
expect "a <!-- at the start of a line that nothing closes is text" 0 none
body "$P" "## Acceptance criteria
1. The check runs. <!-- TBD: more --> It names each part." "$D" "$K"; run "$T"
expect "a comment inside a line is not read" 0 none
body "$P" '## Acceptance criteria
1. ```
   make check
   ```
2. The gate passes.' "$D" "$K"; run "$T"
expect "a criterion that opens with a fenced block" 0 none
body '## Problem / feature
```ls``` prints nothing in an empty directory.' "$A" "$D" "$K"; run "$T"
expect "a line opening with a three-backtick code span is not a fence" 0 none
body '## Problem / feature
The app has no TODO list.' '## Acceptance criteria
1. A user can add an item to the TODO list.' '## Direction
Store TODO items in the existing database.' "$K"; run "Add a TODO list"
expect "TODO as a word is not a mark" 0 none
printf '%s\r\n' "## Problem / feature" "Tickets arrive without criteria." "" "## Acceptance criteria" "1. The check runs." "" "## Direction" "None." "" "## Turnpikes" "default" > "$tmp/body.md"; run "$T"
expect "a body with CRLF line endings passes" 0 none
{ printf '\xef\xbb\xbf'; printf '%s\n\n' "$P" "$A" "$D" "$K"; } > "$tmp/body.md"; run "$T"
expect "a byte-order mark hides no heading" 0 none
body "$P" "$A" "$D" "$K"
out=$("$SELF" --body /dev/stdin --title "$T" < "$tmp/body.md" 2>&1); rc=$?
expect "a body read from standard input" 0 none
{ printf 'id: #7\ntitle: %s\nstate: todo\nlabels: \ncreated: 2026-09-23\n\n' "$T"; printf '%s\n\n' "$P" "$A" "$D" "$K"
  printf '## Log\n- 2026-09-25 10:00 postmaster: does a question here count?\n'; } > "$tmp/printed.txt"
adapter "cat -- '$tmp/printed.txt'"; through
expect "a ticket read through the adapter passes, its log included" 0 none

echo "positive controls: the turnpikes, as scripts/turnpikes.sh reads them"
body "$P" "$A" "$D" "$K"; run "$T"
named "default, in a code span under a template comment, stands for the default set" "turnpikes: $DEF"
body "$P" "$A" "$D" "## Turnpikes
none"; run "$T"
named "none passes, and names no turnpike" "turnpikes: none"
body "$P" "$A" "$D" "## Turnpikes
- $N2UP
- \`$N1\`"; run "$T"
named "a list passes, as the turnpikes it names" "turnpikes: $N1, $N2"
body "$P" "$A" "$D" "## Turnpikes
default

---" "$N"; run "$T"
named "a thematic break in the section is not a turnpike" "turnpikes: $DEF"

echo "negative controls: each part is named on its own"
body "$P" "$A" "$D" "$K" "$N"; run ""
expect "no title" 2 title "title: missing"
sed 's/^title: .*/title: /' "$tmp/printed.txt" > "$tmp/printed-untitled.txt"
adapter "cat -- '$tmp/printed-untitled.txt'"; through
expect "no title in the adapter's read" 2 title "title: missing"
body "$A" "$D" "$K" "$N"; run "$T"
expect "no problem or feature" 2 "problem / feature" 'no "## Problem / feature" section'
body "## Problem / feature" "$A" "$D" "$K"; run "$T"
expect "an empty problem or feature" 2 "problem / feature" "is empty"
body "$P" "$D" "$K" "$N"; run "$T"
expect "no acceptance criteria" 2 "acceptance criteria" 'no "## Acceptance criteria" section'
body "$P" "## Acceptance criteria
- The check runs.
- It names each part." "$D" "$K"; run "$T"
expect "criteria that are not numbered" 2 "acceptance criteria" "not a numbered list"
body "$P" "## Acceptance criteria
1. The check runs.
1. It names each part.
1. It exits 2." "$D" "$K"; run "$T"
expect "criteria numbered out of order" 2 "acceptance criteria" "numbered 1, 1, 1; number them 1 to 3 in order"
body "$P" "## Acceptance criteria
1. The check runs.
2. Should it also run at dispatch?" "$D" "$K"; run "$T"
expect "a criterion that asks a question" 2 "acceptance criteria" "criterion 2 asks a question"
body "$P" "## Acceptance criteria
1. The check runs.
2. **Should it also run at dispatch?**" "$D" "$K"; run "$T"
expect "a question closed by emphasis" 2 "acceptance criteria" "criterion 2 asks a question"
body "$P" "## Acceptance criteria
1. The check runs.
2. It retries a few times (how many?)." "$D" "$K"; run "$T"
expect "a question closed by a bracket" 2 "acceptance criteria" "criterion 2 asks a question"
body "$P" "## Acceptance criteria
1. The check runs.
2. Should it also run at dispatch？" "$D" "$K"; run "$T"
expect "a full-width question mark" 2 "acceptance criteria" "criterion 2 asks a question"
body "$P" "## Acceptance criteria
1. The check runs on every ticket before it is accepted.
   Should it also run again at dispatch?" "$D" "$K"; run "$T"
expect "the fault quotes the sentence that asks" 2 "acceptance criteria" 'criterion 1 asks a question: "Should it also run again at dispatch?"'
body "$P" "## Acceptance criteria
1. The check runs.
2. The retry limit is TBD." "$D" "$K"; run "$T"
expect "a criterion marked TBD" 2 "acceptance criteria" "criterion 2 is marked TBD"
body "$P" "## Acceptance criteria
1. The check runs.
2. TODO: decide the retry limit." "$D" "$K"; run "$T"
expect "a criterion marked TODO:" 2 "acceptance criteria" "criterion 2 is marked TODO"
body "$P" '## Acceptance criteria
1. `<!--` opens a comment.
2. The retry limit is TBD.
3. `-->` closes one.' "$D" "$K"; run "$T"
expect "comment markers in code hide no criterion" 2 "acceptance criteria" "criterion 2 is marked TBD"
body "$P" "## Acceptance criteria
1. The check runs.
2." "$D" "$K"; run "$T"
expect "an empty criterion" 2 "acceptance criteria" "criterion 2 is empty"
body "$P" "## Acceptance criteria
1. The check runs.
2. It names each part.

Also, the README names it,
and the runbook." "$D" "$K"; run "$T"
expect "a criterion outside the numbered list" 2 "acceptance criteria" 'not part of a numbered criterion: "Also, the README names it,"'
[ "$(printf '%s\n' "$out" | grep -c 'not part of')" -eq 1 ] && ok "a paragraph outside the list is named once, not per line" \
  || fail "a paragraph outside the list is named once, not per line" "$out"
body "$P" "## Acceptance criteria
1. The check runs.
- It names each part." "$D" "$K"; run "$T"
expect "an unnumbered criterion straight after a numbered one" 2 "acceptance criteria" 'not part of a numbered criterion: "- It names each part."'
body "$P" "## Acceptance criteria
1. The check runs.
### Details" "$D" "$K"; run "$T"
expect "a heading straight after a criterion" 2 "acceptance criteria" 'not part of a numbered criterion: "### Details"'
body "$P" '## Acceptance criteria
1. The check runs.

```
a stray block
```
The retry limit is TBD.' "$D" "$K"; run "$T"
expect "text after a stray block is not credited to the criterion above" 2 "acceptance criteria" \
  'not part of a numbered criterion: "```"' "criterion 1 is marked"
body "$P" "$A" "$A" "$D" "$K"; run "$T"
expect "acceptance criteria twice" 2 "acceptance criteria" "appears 2 times"
body "$P" "$A" "$K" "$N"; run "$T"
expect "no direction, even with one inside a fenced block" 2 direction 'no "## Direction" section; one is needed even if'
body "$P" "$A" "## Direction
TBD, once the spike is done." "$K"; run "$T"
expect "a direction marked TBD" 2 direction '"## Direction" is marked TBD'
body "$P" "$A" "## Direction
TODO" "$K"; run "$T"
expect "a direction that says only TODO" 2 direction '"## Direction" is marked TODO'
body "$P" "$A" "## Direction
<!-- None: any approach that meets the criteria. -->" "$K"; run "$T"
expect "a direction written only in a comment is empty" 2 direction '"## Direction" is empty'
body "$P" '<!-- a comment that starts a line' "$A" "$D" "$K"; run "$T"
expect "a comment that starts a line hides everything up to the next -->" 2 "acceptance criteria,direction"
body "$P" "$A" "### Direction
None: any approach that meets the criteria." "$K"; run "$T"
expect "a direction at the wrong level" 2 direction '"### Direction" is there, at the wrong level'
body "$P" "$D" "$A" "$K"; run "$T"
expect "a direction before the criteria" 2 direction '"## Direction" comes before "## Acceptance criteria"'
body "$P" "$A" "$D" "$N"; run "$T"
expect "no turnpikes" 2 turnpikes 'no "## Turnpikes" section; one is needed, holding default, none, or turnpike names'
body "$P" "$A" "$D" "$NT"; run "$T"
expect "a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level" 2 turnpikes \
  '"### Turnpikes" is there, at the wrong level'
body "$P" "$A" "$D" '## Turnpikes
- ```none
  style, bug, security
  ```'; run "$T"
expect "a list item that opens a fence is code, and names no turnpike" 2 turnpikes "names no turnpike"
body "$P" "$A" "$D" "## Turnpikes
$N1, $NOPE"; run "$T"
expect "a turnpike scripts/turnpikes.sh does not list is named" 2 turnpikes "\"$NOPE\" is not a turnpike"
body "$P" "$A" "$D" "## Turnpikes
none, $N1"; run "$T"
expect "none listed with another turnpike" 2 turnpikes "none stands alone"
body "$P" "$A" "$D" "## Turnpikes"; run "$T"
expect "an empty turnpikes section" 2 turnpikes '"## Turnpikes" is empty'
body "$P" "$A" "$D" "## Turnpikes
TBD"; run "$T"
expect "turnpikes marked TBD" 2 turnpikes '"## Turnpikes" is marked TBD'
body "$P" "$A" "$D" "### Turnpikes
default"; run "$T"
expect "turnpikes at the wrong level" 2 turnpikes '"### Turnpikes" is there, at the wrong level'
body "$P" "$A" "$K" "$D"; run "$T"
expect "turnpikes before the direction" 2 turnpikes '"## Turnpikes" comes before "## Direction"'
body "$P" "$A" "$D" "$K" "$K"; run "$T"
expect "turnpikes twice" 2 turnpikes '"## Turnpikes" appears 2 times'
: > "$tmp/body.md"; run ""
expect "an empty ticket names all five parts" 2 "acceptance criteria,direction,problem / feature,title,turnpikes"

echo "a turnpike is added in scripts/turnpikes.sh alone"
mkdir "$tmp/added" "$tmp/broken" "$tmp/alone"
for d in added broken alone; do cp "$SELF" "$tmp/$d/"; done
add() { awk -v row="$1" '/^TURNPIKES$/ { print row } { print }' "$HERE/turnpikes.sh" > "$2/turnpikes.sh"; chmod +x "$2/turnpikes.sh"; }
add "$NOPE  -        ship    a check the table does not have yet" "$tmp/added"
add "none       -        review  nothing" "$tmp/broken"
body "$P" "$A" "$D" "## Turnpikes
default, $NOPE"
out=$("$SELF" --body "$tmp/body.md" --title "$T" 2>&1); rc=$?
expect "this check names a turnpike that turnpikes.sh does not list" 2 turnpikes "\"$NOPE\" is not a turnpike"
out=$("$tmp/added/ticket-check.sh" --body "$tmp/body.md" --title "$T" 2>&1); rc=$?
named "the same check passes it once turnpikes.sh lists it" "turnpikes: $DEF, $NOPE"

echo "negative controls: a ticket that cannot be read is not a verdict"
"$SELF" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "no arguments is a usage error" || fail "no arguments is a usage error (exit $rc)"
"$SELF" --body "$tmp/nowhere.md" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a missing body file is refused" || fail "a missing body file is refused (exit $rc)"
printf '[tracker]\nkind = "other"\nname = "notes"\n' > "$tmp/other.toml"
out=$(POSTMASTER_CONFIG="$tmp/other.toml" "$SELF" "$tmp" 7 2>/dev/null); rc=$?
[ $rc -eq 1 ] && [ -z "$out" ] && ok "a tracker kind with no adapter script is refused, not judged" \
  || fail "a tracker kind with no adapter script is refused, not judged (exit $rc)" "$out"
printf '[tracker\nkind = github\n' > "$tmp/broken.toml"
out=$(POSTMASTER_CONFIG="$tmp/broken.toml" "$SELF" "$tmp" 7 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q 'does not parse' && ok "a config that does not parse is named as one" \
  || fail "a config that does not parse is named as one (exit $rc)" "$out"
adapter 'echo "github: no board" >&2; exit 3'; through
[ $rc -eq 1 ] && ! printf '%s\n' "$out" | grep -qE '^(title|problem / feature|acceptance criteria|direction|turnpikes): ' \
  && ok "an adapter that cannot read the ticket is exit 1, not a shape fault" \
  || fail "an adapter that cannot read the ticket is exit 1, not a shape fault (exit $rc)" "$out"
body "$P" "$A" "$D" "$K"
out=$("$tmp/alone/ticket-check.sh" --body "$tmp/body.md" --title "$T" 2>/dev/null); rc=$?
[ $rc -eq 1 ] && [ -z "$out" ] && ok "with no turnpikes.sh beside it, the check gives no verdict" \
  || fail "with no turnpikes.sh beside it, the check gives no verdict (exit $rc)" "$out"
out=$("$tmp/broken/ticket-check.sh" --body "$tmp/body.md" --title "$T" 2>/dev/null); rc=$?
[ $rc -eq 1 ] && [ -z "$out" ] && ok "a turnpikes.sh whose table breaks its rules gives no verdict" \
  || fail "a turnpikes.sh whose table breaks its rules gives no verdict (exit $rc)" "$out"
mkdir "$tmp/silent"; cp "$SELF" "$tmp/silent/"; printf '#!/bin/sh\nexit 2\n' > "$tmp/silent/turnpikes.sh"; chmod +x "$tmp/silent/turnpikes.sh"
out=$("$tmp/silent/ticket-check.sh" --body "$tmp/body.md" --title "$T" 2>/dev/null); rc=$?
[ $rc -eq 1 ] && [ -z "$out" ] && ok "a turnpikes.sh that fails with nothing to say gives no verdict, never a pass" \
  || fail "a turnpikes.sh that fails with nothing to say gives no verdict, never a pass (exit $rc)" "$out"

echo "positive controls: --splice changes the sections given and nothing else"
splice() { out=$("$SELF" --splice "$tmp/base.md" "$tmp/sections.md" 2>&1); rc=$?; }
same() {  # same <label>; the last splice printed exactly want.md
  if [ "$rc" -eq 0 ] && [ "$out" = "$(cat "$tmp/want.md")" ]; then ok "$1"
  else fail "$1 (exit $rc)" "$(diff <(printf '%s\n' "$out") "$tmp/want.md")"; fi
}
{ printf '%s\n\n' "$P" "$A" "$K"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$D" "$K"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "a missing direction goes between the criteria and the turnpikes"
printf '%s\n' "$out" > "$tmp/body.md"; run "$T"
expect "the spliced body passes the check" 0 none
{ printf '%s\n\n' "$P" "$A" "$D"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$K" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$D" "$K"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "a missing turnpikes section goes between the direction and the notes"
printf '%s\n' "$out" > "$tmp/body.md"; run "$T"
named "and the spliced body passes, with the default turnpikes" "turnpikes: $DEF"
{ printf '%s\n\n' "$P" "$A" "$UJ" "$D"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$K" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$UJ" "$D" "$K"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "turnpikes go after the direction, even when a user journey comes before it"
printf '%s\n' "$out" > "$tmp/body.md"; run "$T"
named "and that spliced body passes" "turnpikes: $DEF"
C='## Acceptance criteria
1. Only this criterion.'
{ printf '%s\n\n' "$P" "$A" "$D"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$C" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$C" "$D"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "the criteria are replaced where they stand"
{ printf '%s\n\n' "$P" "$D" "$A"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$D"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "a direction written before the criteria moves after them"
{ printf '%s\n\n' "$P" "$A" "### Direction
An old approach."; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$D"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "a direction at the wrong level is replaced"
X='## Context
Seen twice this week.'
{ printf '%s\n\n' "Reported in the forum." "$P" "$X" "$A"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"
{ printf '%s\n\n' "Reported in the forum." "$P" "$X" "$A" "$D"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "text before the first heading and a section outside the shape are kept"
{ printf '%s\n\n' "Reported in the forum." "$P" "$X" "$D" "$K"; printf '%s\n' "$N"; } > "$tmp/base.md"; printf '%s\n' "$A" > "$tmp/sections.md"
{ printf '%s\n\n' "Reported in the forum." "$P" "$X" "$A" "$D" "$K"; printf '%s\n' "$N"; } > "$tmp/want.md"; splice
same "a missing part goes after the part before it and the sections outside the shape that follow it"
{ printf '%s\n\n' "$P" "$A" "$N"; printf '\n'; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"
{ printf '%s\n\n' "$P" "$A" "$D" "$N"; printf '\n'; } > "$tmp/want.md"
"$SELF" --splice "$tmp/base.md" "$tmp/sections.md" > "$tmp/got.md" 2>&1; rc=$?
[ $rc -eq 0 ] && cmp -s "$tmp/got.md" "$tmp/want.md" && ok "blank lines at the end of the body are kept, byte for byte" \
  || fail "blank lines at the end of the body are kept, byte for byte (exit $rc)" "$(diff "$tmp/got.md" "$tmp/want.md" | cat -A)"

echo "negative controls: --splice refuses sections it cannot place"
printf 'Use the adapters.\n\n%s\n' "$D" > "$tmp/sections.md"; splice
[ $rc -eq 1 ] && ok "text before the first heading of the sections" || fail "text before the first heading of the sections (exit $rc)" "$out"
printf '### Direction\nUse the adapters.\n' > "$tmp/sections.md"; splice
[ $rc -eq 1 ] && ok "a section that is not at level two" || fail "a section that is not at level two (exit $rc)" "$out"
printf '%s\n\n%s\n' "$D" "$D" > "$tmp/sections.md"; splice
[ $rc -eq 1 ] && ok "the same section twice" || fail "the same section twice (exit $rc)" "$out"
{ printf '%s\n\n' "$P" "$A" "$D"; printf '%s\n' "$NT"; } > "$tmp/base.md"; printf '%s\n' "$K" > "$tmp/sections.md"; splice
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF '"### Turnpikes" stands inside a later part' \
  && ok "a ### Turnpikes in the notes is neither deleted nor left beside a new one" \
  || fail "a ### Turnpikes in the notes is neither deleted nor left beside a new one (exit $rc)" "$out"
{ printf '%s\n\n' "$P" "$A" "## Notes
Context.

### Direction
An old approach." ; } > "$tmp/base.md"; printf '%s\n' "$D" > "$tmp/sections.md"; splice
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF '"### Direction" stands inside a later part' \
  && ok "a stale ### Direction in the notes is not left beside the new one" \
  || fail "a stale ### Direction in the notes is not left beside the new one (exit $rc)" "$out"

echo "controls: a repo whose local ticket store exists is read through local.sh, whatever the config names"
localsh "case \$2 in store) exit 0 ;; read) : > '$tmp/local-read'; cat -- '$tmp/printed.txt' ;; *) exit 1 ;; esac"
adapter ": > '$tmp/github-read'; exit 1"; rm -f "$tmp/local-read" "$tmp/github-read"; through
[ $rc -eq 0 ] && [ -e "$tmp/local-read" ] && [ ! -e "$tmp/github-read" ] \
  && ok "a repo with a store is read through local.sh, though the config names github" \
  || fail "a repo with a store is read through local.sh, though the config names github (exit $rc)" "$out"
localsh "case \$2 in store) exit 3 ;; *) : > '$tmp/local-read'; exit 1 ;; esac"
adapter ": > '$tmp/github-read'; cat -- '$tmp/printed.txt'"; rm -f "$tmp/local-read" "$tmp/github-read"; through
[ $rc -eq 0 ] && [ -e "$tmp/github-read" ] && [ ! -e "$tmp/local-read" ] \
  && ok "a repo with no store is read through the kind the config names" \
  || fail "a repo with no store is read through the kind the config names (exit $rc)" "$out"
localsh "case \$2 in store) echo 'local: not a git repository' >&2; exit 1 ;; *) : > '$tmp/local-read'; exit 1 ;; esac"
rm -f "$tmp/local-read" "$tmp/github-read"; through
[ $rc -eq 1 ] && [ ! -e "$tmp/github-read" ] && [ ! -e "$tmp/local-read" ] && printf '%s\n' "$out" | grep -qF "cannot look for a local store" \
  && ok "a store that cannot be looked for stops the check, and no adapter is read" \
  || fail "a store that cannot be looked for stops the check, and no adapter is read (exit $rc)" "$out"
localsh "$NOSTORE"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
