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
#   exit 0  clean
#   exit 1  faults found, one per line on stdout
#   exit 2  usage, or no wiki to check
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
  python3 - "$1" <<'PY'
import pathlib, re, sys

repo = pathlib.Path(sys.argv[1])
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

fails=0
expect() {  # expect <pass|fail> <label> [<text the fault must contain>]
  out=$(lint "$tmp"); rc=$?
  got=$( [ $rc -eq 0 ] && echo pass || echo fail )
  why=""
  if [ "$got" = fail ] && [ -n "${3:-}" ] && ! grep -qF -- "$3" <<<"$out"; then
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

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
