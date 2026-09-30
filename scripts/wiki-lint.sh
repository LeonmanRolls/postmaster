#!/usr/bin/env bash
# Health-check the wiki, so its rules are run rather than remembered. Deterministic checks
# belong in a script; a check written as prose is re-derived, and mis-derived, on every pass.
#
#   wiki-lint.sh [<repo>]      default: the repo this script lives in
#   wiki-lint.sh --self-test   prove each check fails on its own fault, and a clean tree passes
#
# Reports every fault and fixes none: a standing contradicting its own records means either
# the standing or the reading is wrong, and which is a judgement for a person.
#
# Besides front matter, standings, citations, links and orphans, it enforces
# the two page-content rules the schema states: no private-shaped filesystem
# path or host name, through the scrub, and no page line of forty characters
# or more repeating a line under raw/.
#
#   exit 0  clean
#   exit 1  faults found, one per line on stdout
#   exit 2  usage, no wiki to check, or a page scan that could not finish
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
SELFTEST=0
case ${1:-} in
  --self-test) SELFTEST=1; REPO=$(dirname "$HERE") ;;
  "") REPO=$(dirname "$HERE") ;;
  -*) echo "usage: wiki-lint.sh [<repo>] | --self-test" >&2; exit 2 ;;
  *) REPO=$1 ;;
esac

lint() {  # lint <repo>; prints faults, returns 1 if any
  WIKI_LINT_SCRUB=$HERE/scrub-check.sh python3 - "$1" <<'PY'
import os, pathlib, re, subprocess, sys

repo = pathlib.Path(sys.argv[1]).resolve()
wiki, raw = repo / "wiki", repo / "raw"
if not wiki.is_dir():
    print("no wiki/ in %s" % repo); sys.exit(2)

faults = []
def fault(p, msg):
    faults.append("%s: %s" % (p.relative_to(repo) if p != repo else p, msg))

pages = sorted(p for p in wiki.rglob("*.md"))
by_stem = {p.stem: p for p in pages}

def front_matter(text):
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    return dict(re.findall(r"^([a-z_]+):\s*(.*)$", text[3:end], re.M))

def prose(text):
    # Notation is documented in backticks: `[@papers/<slug>]` is an example of a citation,
    # not one. Fenced blocks and inline code spans are examples, so they are not scanned.
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return re.sub(r"`[^`]*`", "", text)

STANDINGS = {"claimed", "supported", "mixed", "refuted", "settled"}
OWN_EVIDENCE = ("runs", "trials")          # what this fleet did; papers and articles are not

for p in pages:
    raw_text = p.read_text()
    text = prose(raw_text)
    fm = front_matter(raw_text)
    if fm is None:
        fault(p, "no front matter"); continue
    for key in ("title", "type", "updated"):
        if key not in fm:
            fault(p, "front matter has no %s" % key)

    if fm.get("type") == "concept":
        st = fm.get("standing")
        if st is None:
            fault(p, "concept with no standing")
        elif st not in STANDINGS:
            fault(p, "standing %r is not one of %s" % (st, ", ".join(sorted(STANDINGS))))
        sources = re.findall(r"([a-z]+)/([^,\]\s]+)", fm.get("sources", ""))
        for kind, ident in sources:
            if not (raw / kind / ident).exists():
                fault(p, "source %s/%s in front matter does not resolve under raw/" % (kind, ident))
        own = [k for k, _ in sources if k in OWN_EVIDENCE]
        if st in STANDINGS - {"claimed"} and not own:
            fault(p, "standing %s rests on no run or trial; outside work alone cannot move a standing" % st)
        elif st == "supported" and len(own) < 3:
            fault(p, "standing supported rests on %d run(s) or trial(s); three are needed" % len(own))

    # citations resolve to something under raw/
    for m in re.finditer(r"\[@([a-z]+)/([^\]\s]+)", text):
        kind, ident = m.group(1), m.group(2).rstrip("/.,;)")
        if not (raw / kind / ident).exists():
            fault(p, "citation [@%s/%s] does not resolve under raw/" % (kind, ident))

    # wikilinks resolve to a page
    for m in re.finditer(r"\[\[([^\]]+)\]\]", text):
        if m.group(1) not in by_stem:
            fault(p, "wikilink [[%s]] has no page" % m.group(1))

    # relative markdown links resolve
    for m in re.finditer(r"\]\(([^)#]+)\)", text):
        t = m.group(1)
        if t.startswith(("http://", "https://", "mailto:")):
            continue
        if not (p.parent / t).exists():
            fault(p, "link to %s does not resolve" % t)

# schema.md's Writing rule, mechanically: no private-shaped path or host name.
# The scrub is the shape authority, so only its private-path and private-host
# kinds fault a page; documenting the rule's own examples stays possible. The
# scrub needs a repository, so outside one this check degrades to nothing.
# The checkout is the target's own, never the caller's: discovering it from
# the caller's directory would skip the scan whenever the caller stands
# outside a repository. A target that is not a checkout either keeps the
# caller's discovery, for the fixtures the self-test runs from this repo.
def git_top(path):
    found = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=path,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False)
    return found if found.returncode == 0 else None
top = git_top(str(repo))
if top is None:
    top = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False)
if pages and top.returncode == 0:
    scrub = os.environ.get("WIKI_LINT_SCRUB", "")
    if not scrub or not pathlib.Path(scrub).is_file():
        print("wiki-lint: no scrub to check pages with")
        sys.exit(2)
    # Pages go to the scrub as repository-relative paths: absolute ones would
    # redact the checkout's own location out of every diagnostic.
    top_path = pathlib.Path(top.stdout.strip())
    rel_args = []
    for page in pages:
        try:
            rel_args.append(str(page.relative_to(top_path)))
        except ValueError:
            rel_args.append(str(page))
    # The lint logs only what it reports: the scan runs with the
    # detections log emptied, and each path or host fault is logged under
    # its page through --log-detection. Quoted raw/ lines are lint faults,
    # not detections, and are never logged.
    child = subprocess.run(
        [scrub, "--files-inert", *rel_args], cwd=top.stdout.strip(),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False,
        env=dict(os.environ, POSTMASTER_DETECTIONS_LOG=""))
    if child.returncode not in (0, 1):
        print("wiki-lint: the page scan could not finish")
        sys.exit(2)
    for ln in child.stdout.splitlines():
        m = re.match(r"^(.*):(\d+): (\S+)$", ln)
        if m is None or m.group(3) not in ("private-path", "private-host"):
            continue
        try:
            rel = (top_path / m.group(1)).relative_to(repo)
        except ValueError:
            rel = m.group(1)
        faults.append("%s: line %s: %s (schema.md: name a target by its repository name only)"
                      % (rel, m.group(2), m.group(3)))
        logged = subprocess.run(
            [scrub, "--log-detection", m.group(3), str(rel), m.group(2)],
            cwd=top.stdout.strip(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            check=False)
        if logged.returncode != 0:
            print("wiki-lint: the detections log could not be written")
            sys.exit(2)

# Compile, do not transcribe: no page line of forty characters or more
# repeats a line under raw/. Shorter spans are headings, citations and
# front matter, not quotations. raw/ may hold binary evidence, so it is
# decoded tolerantly; a wiki page that does not decode already fails above.
def text_lines(handle, strict):
    """Yield (number, line) numbered as whole-file splitlines numbers them.

    Binary iteration splits on \\n only, and no other splitlines boundary
    can span a \\n, so per-chunk splitlines yields exactly the whole-file
    lines. Strict decodes like a page read; tolerant like a raw read.
    """
    number = 0
    for chunk in handle:
        text = chunk.decode("utf-8", errors="strict" if strict else "replace")
        for ln in text.splitlines():
            number += 1
            yield number, ln

# Both sides stream. Page lines of forty characters or more are the only
# ones that can quote, and pages are author-scale, so they are collected
# first; then one batched pass over raw/ confirms them in file order,
# stopping once every candidate has its first hit. Memory is bounded by
# the pages plus the longest raw line, never the evidence.
wanted = {}
for p in pages:
    with open(p, "rb") as handle:
        for number, ln in text_lines(handle, True):
            if len(ln) >= 40:
                wanted.setdefault(ln, []).append((p, number))
repeats = []
if wanted and raw.is_dir():
    pending = dict(wanted)
    for f in sorted(p for p in raw.rglob("*") if p.is_file()):
        if not pending:
            break
        try:
            handle = open(f, "rb")
        except OSError:
            continue
        with handle:
            for number, ln in text_lines(handle, False):
                if len(ln) >= 40 and "\0" not in ln and ln in pending:
                    for p, pnumber in pending.pop(ln):
                        repeats.append((p, pnumber, str(f.relative_to(repo)), number))
                if not pending:
                    break
repeats.sort(key=lambda hit: (hit[0], hit[1]))
if repeats:
    # A raw filename or a page filename may itself carry a shaped value, so
    # both are redacted before they reach a diagnostic. Without a scrub
    # there is no safe way to name them, and the lint fails rather than
    # printing either raw.
    scrub = os.environ.get("WIKI_LINT_SCRUB", "")
    if not scrub or not pathlib.Path(scrub).is_file():
        print("wiki-lint: no scrub to check pages with")
        sys.exit(2)
    distinct = list(dict.fromkeys(
        [hit[2] for hit in repeats]
        + [str(hit[0].relative_to(repo)) for hit in repeats]))
    red = subprocess.run(
        [scrub, "--safe-path", *distinct], cwd=top.stdout.strip() if top.returncode == 0 else None,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False)
    if red.returncode != 0:
        print("wiki-lint: the page scan could not finish")
        sys.exit(2)
    lines = red.stdout.splitlines()
    if len(lines) != len(distinct):
        print("wiki-lint: the page scan could not finish")
        sys.exit(2)
    redacted = dict(zip(distinct, lines))
    for p, number, rawrel, rawline in repeats:
        faults.append("%s: line %d repeats %s:%s (compile, do not transcribe)"
                      % (redacted[str(p.relative_to(repo))], number,
                         redacted[rawrel], rawline))

# orphans: every page reachable from the index
index = wiki / "index.md"
if not index.exists():
    fault(wiki, "no index.md")
else:
    seen, queue = set(), [index.resolve()]
    while queue:
        cur = queue.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for m in re.finditer(r"\]\(([^)#]+)\)", prose(cur.read_text())):
            t = m.group(1)
            if t.startswith(("http://", "https://", "mailto:")):
                continue
            nxt = (cur.parent / t).resolve()
            if nxt.suffix == ".md" and nxt.exists():
                queue.append(nxt)
    for p in pages:
        if p.resolve() not in seen:
            fault(p, "orphan: not reachable from index.md")

# a trial must be repeatable, a capture must say where it came from
if raw.is_dir():
    trials = raw / "trials"
    for d in sorted(trials.glob("*")) if trials.is_dir() else []:
        if d.is_dir() and not (d / "method.md").exists():
            fault(d, "trial has no method.md, so it cannot be repeated")
    for kind in ("papers", "articles"):
        base = raw / kind
        for d in sorted(base.glob("*")) if base.is_dir() else []:
            if not d.is_dir():
                continue
            src = d / "source.md"
            if not src.exists():
                fault(d, "capture has no source.md"); continue
            sfm = front_matter(src.read_text()) or {}
            for key in ("url", "retrieved"):
                if not sfm.get(key, "").strip():
                    fault(src, "source.md has no %s" % key)

for f in faults:
    print(f)
sys.exit(1 if faults else 0)
PY
}

if [ "$SELFTEST" -eq 0 ]; then
  lint "$REPO"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
# One negative control (the real wiki passes), one control that well-formed additions pass,
# and one positive control per check, each asserting it failed for its own reason rather
# than for some other fault the fixture happened to introduce.
tmp=$(mktemp -d) || exit 2
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT

fresh() {  # reset the scratch copy to the repo's current wiki and raw
  rm -r -- "$tmp/wiki" "$tmp/raw" </dev/null 2>/dev/null
  cp -r "$REPO/wiki" "$tmp/wiki"
  if [ -d "$REPO/raw" ]; then cp -r "$REPO/raw" "$tmp/raw"; else mkdir "$tmp/raw"; fi
}
page() {  # page <name> <front matter lines, \n-separated>; linked from the index
  printf -- '---\n%b---\n\nBody.\n' "$2" > "$tmp/wiki/concepts/$1.md"
  printf '\n- [%s](concepts/%s.md)\n' "$1" "$1" >> "$tmp/wiki/index.md"
}
concept() {  # concept <name> <standing> <sources>
  page "$1" "title: $1\ntype: concept\nstanding: $2\nsources: [$3]\nupdated: 2026-01-01\n"
}
trial() {  # trial <slug>; a repeatable trial
  mkdir -p "$tmp/raw/trials/$1"; printf -- 'Method.\n' > "$tmp/raw/trials/$1/method.md"
}
capture() {  # capture <kind> <slug> <front matter lines, \n-separated>
  mkdir -p "$tmp/raw/$1/$2"; printf -- '---\n%b---\n' "$3" > "$tmp/raw/$1/$2/source.md"
}
GOOD_SOURCE='url: https://example.org/paper\nretrieved: 2026-01-01\ntitle: A paper\n'
# Hermetic logging: the gate runs self-tests with a detections log set,
# and fixture findings must never land in it.
export POSTMASTER_DETECTIONS_LOG=

fails=0
expect() {  # expect <pass|fail> <label> [<text the fault must contain>]
  out=$(lint "$tmp"); rc=$?
  got=$( [ $rc -eq 0 ] && echo pass || echo fail )
  why=""
  if [ "$got" = fail ] && [ -n "${3:-}" ] && ! printf '%s\n' "$out" | grep -qF -- "$3"; then
    why=", but not for the expected reason"
  fi
  if [ "$got" = "$1" ] && [ -z "$why" ]; then printf '  ok   %s\n' "$2"
  else
    printf '  FAIL %s: wanted %s, got %s%s\n' "$2" "$1" "$got" "$why"
    printf '%s\n' "$out" | sed 's/^/         /'; fails=$((fails+1))
  fi
}

echo "negative controls"
fresh; expect pass "the unmodified wiki passes"
fresh; trial t1; capture papers p1 "$GOOD_SOURCE"; concept ok settled "trials/t1, papers/p1"
expect pass "a settled concept on a trial, with a well-formed capture, passes"

echo "positive controls: each check fails on its own fault"
fresh; printf -- '# no front matter\n' > "$tmp/wiki/concepts/bare.md"
printf '\n- [bare](concepts/bare.md)\n' >> "$tmp/wiki/index.md"
expect fail "a page without front matter" "no front matter"

fresh; page nostanding 'title: x\ntype: concept\nupdated: 2026-01-01\n'
expect fail "a concept with no standing" "concept with no standing"

fresh; concept badstanding probable ""
expect fail "a standing that is not one of the five" "is not one of"

fresh; concept badsource claimed "runs/no-such-run"
expect fail "a front-matter source that does not resolve" "in front matter does not resolve"

fresh; capture papers p1 "$GOOD_SOURCE"; concept paperonly settled "papers/p1"
expect fail "a standing moved by outside work alone" "rests on no run or trial"

fresh; trial t1; concept thin supported "trials/t1"
expect fail "supported on fewer than three runs or trials" "three are needed"

fresh; concept cites claimed ""; printf 'See [@runs/no-such-run].\n' >> "$tmp/wiki/concepts/cites.md"
expect fail "a citation that does not resolve" "does not resolve under raw/"

fresh; concept wl claimed ""; printf 'See [[no-such-page]].\n' >> "$tmp/wiki/concepts/wl.md"
expect fail "a wikilink with no page" "has no page"

fresh; printf '\n[a dangling link](nowhere.md)\n' >> "$tmp/wiki/index.md"
expect fail "a relative link that does not resolve" "link to nowhere.md"

fresh; printf -- '---\ntitle: o\ntype: concept\nstanding: claimed\nupdated: 2026-01-01\n---\n' > "$tmp/wiki/concepts/orphan.md"
expect fail "an orphan page" "orphan"

fresh; mkdir -p "$tmp/raw/trials/t2"
expect fail "a trial with no method.md" "no method.md"

fresh; mkdir -p "$tmp/raw/articles/a1"
expect fail "a capture with no source.md" "has no source.md"

fresh; capture papers p2 'retrieved: 2026-01-01\n'
expect fail "a source.md with no url" "has no url"

fresh; capture papers p3 'url: https://example.org/x\n'
expect fail "a source.md with no retrieval date" "has no retrieved"

fresh; concept quoted claimed ""
QUOTE_LINE='The staging relay counted four hundred thirteen spans on the quiet Tuesday run.'
printf '%s\n' "$QUOTE_LINE" > "$tmp/raw/evidence.txt"
printf '%s\n' "$QUOTE_LINE" >> "$tmp/wiki/concepts/quoted.md"
expect fail "a page line quoting raw/" "repeats raw/"

fresh; concept bigquote claimed ""
BIGQ='The staging relay counted four hundred sixteen spans on the Friday run.'
python3 -c "
lines = ['bulk evidence filler line %d for the streaming control' % i for i in range(250000)]
lines[125000] = '$BIGQ'
open('$tmp/raw/big-evidence.txt', 'w').write('\n'.join(lines) + '\n')
"
printf '%s\n' "$BIGQ" >> "$tmp/wiki/concepts/bigquote.md"
limited=$(bash -c "ulimit -v 65536 || exit 99; exec bash \"$HERE/wiki-lint.sh\" \"$tmp\"" 2>&1); code=$?
if [ "$code" -eq 99 ]; then
  printf '  ok   a large raw file streams under a small address space: skipped, no address-space limit on this machine\n'
else
  { [ "$code" -eq 1 ] && printf '%s\n' "$limited" | grep -qF 'repeats raw/big-evidence.txt'; } \
    && printf '  ok   a large raw file streams under a small address space\n' \
    || { printf '  FAIL a large raw file streams under a small address space: exit %s\n' "$code"; fails=$((fails+1)); }
fi

fresh; concept haspath claimed ""
HP=$(printf '/home/%s' fixture-user)
printf 'See %s-413/notes.txt for the log.\n' "$HP" >> "$tmp/wiki/concepts/haspath.md"
expect fail "a page carrying a private path" "private-path"

fresh; concept markedpath claimed ""
MP=$(printf '/home/%s' fixture-user)
ALLOW_P='private-data:allo'
printf 'See %s-413/notes.txt for the log.  <!-- %sw private-path -- made-up -->\n' "$MP" "$ALLOW_P" >> "$tmp/wiki/concepts/markedpath.md"
expect fail "a marked path still faults, markers inert on pages" "private-path"

fresh; concept hashhost claimed ""
HN='metrics.interna'
printf 'See https://%sl:8443/up for the dashboard.\n' "$HN" >> "$tmp/wiki/concepts/hashhost.md"
expect fail "a page carrying a private hostname" "private-host"

fresh; concept quotefile claimed ""
QL2='The quiet relay logged four hundred fourteen spans on the Wednesday run.'
QE='contact-relay-413'; QH='quiet-relay-413'; QT='net'
printf '%s\n' "$QL2" > "$tmp/raw/$QE@$QH.$QT.txt"
printf '%s\n' "$QL2" >> "$tmp/wiki/concepts/quotefile.md"
out=$(lint "$tmp" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'repeats raw/' \
  && printf '%s\n' "$out" | grep -qF '[redacted]'; } \
  && printf '  ok   a raw filename carrying a value is redacted\n' \
  || { printf '  FAIL a raw filename carrying a value is redacted\n'; fails=$((fails+1)); }
if printf '%s\n' "$out" | grep -qF -- "$QE@$QH.$QT"; then
  printf '  FAIL a redacted filename prints no value\n'; fails=$((fails+1))
else printf '  ok   a redacted filename prints no value\n'; fi

fresh
QP2='The staging relay tallied four hundred fifteen spans on the Thursday run.'
QE2='contact-relay-414'; QH2='quiet-relay-414'; QT2='net'
printf -- '---\ntitle: qp\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n' > "$tmp/wiki/concepts/$QE2@$QH2.$QT2.md"
printf '\n- [qp](concepts/%s@%s.%s.md)\n' "$QE2" "$QH2" "$QT2" >> "$tmp/wiki/index.md"
printf '%s\n' "$QP2" > "$tmp/raw/evidence2.txt"
printf '%s\n' "$QP2" >> "$tmp/wiki/concepts/$QE2@$QH2.$QT2.md"
out=$(lint "$tmp" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'repeats raw/' \
  && printf '%s\n' "$out" | grep -qF '[redacted]'; } \
  && printf '  ok   a shaped page filename is redacted in quote faults\n' \
  || { printf '  FAIL a shaped page filename is redacted in quote faults\n'; fails=$((fails+1)); }
if printf '%s\n' "$out" | grep -qF -- "$QE2@$QH2.$QT2"; then
  printf '  FAIL a redacted page name prints no value\n'; fails=$((fails+1))
else printf '  ok   a redacted page name prints no value\n'; fi

# Both shapes below are assembled from pieces so this source carries no
# matchable form of its own fixtures.
shaped_parent=/tmp/clau''de-413-wikilint
rm -r -- "$shaped_parent" </dev/null 2>/dev/null
mkdir -p "$shaped_parent/repo" && cp -r "$REPO/wiki" "$shaped_parent/repo/wiki" \
  && mkdir -p "$shaped_parent/repo/raw"
( cd "$shaped_parent/repo" && git init -q -b main . )
printf -- '---\ntitle: shaped\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n' \
  > "$shaped_parent/repo/wiki/concepts/shaped.md"
printf '\n- [shaped](concepts/shaped.md)\n' >> "$shaped_parent/repo/wiki/index.md"
SHP=$(printf '/home/%s' fixture-user)
printf 'See %s-413/notes.txt for the log.\n' "$SHP" >> "$shaped_parent/repo/wiki/concepts/shaped.md"
out=$( ( cd "$shaped_parent/repo" && lint "$shaped_parent/repo" ) 2>/dev/null); code=$?
rm -r -- "$shaped_parent" </dev/null 2>/dev/null
{ [ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'wiki/concepts/shaped.md: line'; } \
  && printf '  ok   a page fault names its repo-relative path\n' \
  || { printf '  FAIL a page fault names its repo-relative path\n'; fails=$((fails+1)); }
if printf '%s\n' "$out" | grep -qF '[redacted]'; then
  printf '  FAIL a checkout under a shaped path stays readable\n'; fails=$((fails+1))
else printf '  ok   a checkout under a shaped path stays readable\n'; fi

mkdir -p "$tmp/stubbin" && cp "$HERE/wiki-lint.sh" "$tmp/stubbin/"
printf '#!/usr/bin/env bash\nexit 127\n' > "$tmp/stubbin/scrub-check.sh"
chmod +x "$tmp/stubbin/scrub-check.sh"
fresh
out=$(bash "$tmp/stubbin/wiki-lint.sh" "$tmp" 2>/dev/null); code=$?
[ "$code" -eq 2 ] \
  && printf '  ok   a missing scanner fails the lint\n' \
  || { printf '  FAIL a missing scanner fails the lint: exit %s\n' "$code"; fails=$((fails+1)); }

elsewhere=$tmp/outside-fixture
rm -r -- "$elsewhere" </dev/null 2>/dev/null
mkdir -p "$elsewhere" && cp -r "$REPO/wiki" "$elsewhere/wiki" && mkdir -p "$elsewhere/raw"
( cd "$elsewhere" && git init -q -b main . )
printf -- '---\ntitle: away\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n' \
  > "$elsewhere/wiki/concepts/away.md"
printf '\n- [away](concepts/away.md)\n' >> "$elsewhere/wiki/index.md"
AWP=$(printf '/home/%s' fixture-user)
printf 'See %s-413/notes.txt for the log.\n' "$AWP" >> "$elsewhere/wiki/concepts/away.md"
out=$( ( cd /tmp && lint "$elsewhere" ) 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'private-path'; } \
  && printf '  ok   a target outside the caller checkout still scans\n' \
  || { printf '  FAIL a target outside the caller checkout still scans: exit %s\n' "$code"; fails=$((fails+1)); }

echo "detection controls: the lint logs what it reports, nothing else"
fresh; concept logpath claimed ""
LP=$(printf '/home/%s' fixture-user)
printf 'See %s-413/notes.txt for the log.\n' "$LP" >> "$tmp/wiki/concepts/logpath.md"
rm -f "$tmp/wl.jsonl"
out=$(POSTMASTER_DETECTIONS_LOG="$tmp/wl.jsonl" lint "$tmp" 2>/dev/null); code=$?
[ "$code" -eq 1 ] \
  && printf '  ok   a logged page fault still fails\n' \
  || { printf '  FAIL a logged page fault still fails: exit %s\n' "$code"; fails=$((fails+1)); }
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"), e[0].get("line"), repr(e[0].get("commit")))' "$tmp/wl.jsonl" 2>/dev/null)
[ "$entry" = "1 private-path wiki/concepts/logpath.md 10 ''" ] \
  && printf '  ok   a page fault is logged once, under its page\n' \
  || { printf '  FAIL a page fault is logged once, under its page: %s\n' "$entry"; fails=$((fails+1)); }
fresh; concept mailto claimed ""
ME='contact-relay-413'; MH='quiet-relay-413'; MT='net'
printf 'Reach the relay at %s@%s.%s for pings.\n' "$ME" "$MH" "$MT" >> "$tmp/wiki/concepts/mailto.md"
rm -f "$tmp/wl2.jsonl"
out=$(POSTMASTER_DETECTIONS_LOG="$tmp/wl2.jsonl" lint "$tmp" 2>/dev/null); code=$?
[ "$code" -eq 0 ] \
  && printf '  ok   a page carrying only an address passes\n' \
  || { printf '  FAIL a page carrying only an address passes: exit %s\n%s\n' "$code" "$out"; fails=$((fails+1)); }
[ ! -e "$tmp/wl2.jsonl" ] \
  && printf '  ok   an unreported finding is never logged\n' \
  || { printf '  FAIL an unreported finding is never logged\n'; fails=$((fails+1)); }

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
