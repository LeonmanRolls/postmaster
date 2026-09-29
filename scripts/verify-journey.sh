#!/usr/bin/env bash
# The default check for a web app's User journey. A script cannot click through prose, so the walk
# is the agent's: it follows each step in a browser, through the project's own browser library,
# and writes a report. This script holds that report to the ticket: every step of the ticket's
# `## User journey`, in the ticket's order, marked did or did not, with a screenshot beside the
# report, in its directory or below it, so a walk leaves nothing in the worktree it walked.
#
#   verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>]
#   verify-journey.sh --path [<worktree>] [--dir <dir>]   where the report for <worktree>'s HEAD goes
#   verify-journey.sh --format                            the report's format, for a brief
#   verify-journey.sh --self-test
#
# The steps are the items of the section's list, or its sentences where it has none; a fenced
# block is not a step. A step matches a report heading when the two are the same words, ignoring
# case, spacing and a closing full stop. The report for a commit is <dir>/<its full sha>.md, so a
# walk counts only for the commit it walked. <dir> is --dir, else the journey directory of the
# checks scripts/verify.sh arm copied ($POSTMASTER_VERIFY/spec.json, else
# .postmaster/verify/spec.json), else .postmaster/verify/journey. <worktree> defaults to the
# current directory, and the ticket to the one arm copied beside the checks. A ticket that is a
# waybill is read from its `## Ticket` heading to its `## Project profile` heading.
#
#   exit 0  every step is in the report, in order, marked did, with its screenshot beside it
#   exit 1  a step is marked did not
#   exit 3  not run: no User journey, no report for this commit, or a step not walked, with no
#           verdict or with no screenshot; each is named, and the reason is the last line
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
HERE=$(cd "$(dirname "$0")" && pwd -P)
usage() { echo "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test" >&2; exit 1; }

format() {
  cat <<'EOF'
Walk the ticket's User journey in a browser, through the project's own browser library, at the
commit you are reporting on. Write the report to the path `verify.sh journey-path` prints for
that commit. For each step, in the ticket's order: a `## ` heading holding the step as the
ticket words it; under it a line `did`, or `did not: <what happened instead>`; then a line
`screenshot: <path>`, the path, relative to the report, of a screenshot of that step saved in the
report's directory or below it. Steps of your own may follow the ticket's.
EOF
}

journey() {  # journey path <worktree> <dir> | judge <worktree> <ticket> <report>
  python3 -I - "$@" <<'PY'
import json, os, pathlib, re, subprocess, sys

mode, wt = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
ITEM = re.compile(r"^\s*(?:\d{1,9}[.)]|[-*+])\s+(.*)$")
HEADING = re.compile(r"^##\s+(.*?)\s*#*\s*$")

def not_run(msg):
    print("not run: " + msg); sys.exit(3)

def spec_dir():
    return pathlib.Path(os.environ.get("POSTMASTER_VERIFY") or wt / ".postmaster" / "verify")

def report_path(given_dir):
    r = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True)
    if r.returncode != 0:
        print("verify-journey: %s is not a git worktree with a commit" % wt, file=sys.stderr); sys.exit(1)
    d = given_dir
    if not d:
        try:
            d = json.load(open(spec_dir() / "spec.json")).get("journey_dir")
        except (OSError, ValueError):
            d = None
    return pathlib.Path(d or wt / ".postmaster" / "verify" / "journey") / (r.stdout.strip() + ".md")

def norm(s):
    return re.sub(r"\s+", " ", s).strip().rstrip(".").strip().casefold()

def ticket_lines(text):
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if re.match(r"^##\s+Ticket\s*$", l)), None)
    if start is None:
        return lines
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^##\s+Project profile\s*$", lines[i])), len(lines))
    return lines[start + 1:end]

def steps(lines):
    start = next((i for i, l in enumerate(lines) if re.match(r"^##\s+User journey\s*$", l, re.I)), None)
    if start is None:
        return None
    body, fence = [], None
    for l in lines[start + 1:]:
        if fence is None and re.match(r"^#{1,2}\s", l):
            break
        m = FENCE.match(l)
        if m and fence is None:
            fence = m.group(1)
        elif m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
            fence = None
        elif fence is None:
            body.append(l)
    if any(ITEM.match(l) for l in body):
        items, cur = [], None
        for l in body:
            m = ITEM.match(l)
            if m:
                cur = [m.group(1)]; items.append(cur)
            elif l.strip() and cur is not None:
                cur.append(l.strip())
        return [" ".join(i).strip() for i in items if " ".join(i).strip()]
    text = " ".join(l.strip() for l in body if l.strip())
    masked = re.sub(r"`[^`]*`", lambda m: "x" * len(m.group(0)), text)
    out, last = [], 0
    for m in re.finditer(r"[.!?][\"')\]]*(?=\s|$)", masked):
        out.append(text[last:m.end()].strip()); last = m.end()
    if text[last:].strip():
        out.append(text[last:].strip())
    return [s for s in out if s]

if mode == "path":
    print(report_path(sys.argv[3])); sys.exit(0)

ticket, report = sys.argv[3], sys.argv[4]
if not ticket:
    ticket = str(spec_dir() / "ticket.md")
try:
    text = open(ticket, encoding="utf-8", errors="replace").read()
except OSError:
    not_run("no ticket at %s; scripts/verify.sh arm copies the run's there" % ticket)
want = steps(ticket_lines(text))
if want is None:
    not_run("the ticket has no User journey")
if not want:
    not_run("the ticket's User journey has no steps")
report = pathlib.Path(report) if report else report_path(None)
try:
    got = open(report, encoding="utf-8", errors="replace").read().splitlines()
except OSError:
    not_run("no journey report at %s: walk the journey in a browser and write it there" % report)

sections = []
for l in got:
    m = HEADING.match(l)
    if m:
        sections.append((m.group(1), []))
    elif sections:
        sections[-1][1].append(l)

did_not, missing, at = [], [], 0
for n, step in enumerate(want, 1):
    k = next((k for k in range(at, len(sections)) if norm(sections[k][0]) == norm(step)), None)
    if k is None:
        missing.append("step %d not walked: %s" % (n, step)); continue
    at = k + 1
    body = sections[k][1]
    verdict = next((re.match(r"^\s*(did not|did)\b:?\s*(.*)$", l, re.I) for l in body
                    if re.match(r"^\s*(did not|did)\b", l, re.I)), None)
    shot = next((re.match(r"^\s*screenshot:\s*(.+?)\s*$", l, re.I).group(1) for l in body
                 if re.match(r"^\s*screenshot:\s*\S", l, re.I)), None)
    if verdict is None:
        missing.append("step %d has no verdict, did or did not: %s" % (n, step)); continue
    if verdict.group(1).lower() == "did not":
        did_not.append("step %d did not: %s%s" % (n, step, (" (" + verdict.group(2) + ")") if verdict.group(2) else "")); continue
    path = pathlib.Path(shot) if shot else None
    if path is not None and not path.is_absolute():
        path = report.parent / path
    beside = path is not None and os.path.realpath(path).startswith(os.path.realpath(report.parent) + os.sep)
    if not beside or not path.is_file() or path.stat().st_size == 0:
        missing.append("step %d has no screenshot beside the report%s: %s" % (n, (" at " + str(path)) if path else "", step))

for line in did_not + missing:
    print(line)
if did_not:
    print("%d of %d steps did not do what the ticket says" % (len(did_not), len(want))); sys.exit(1)
if missing:
    print("not run: %d of %d steps have no complete record in %s" % (len(missing), len(want), report)); sys.exit(3)
print("all %d steps walked, each did what the ticket says" % len(want))
PY
}

case "${1:-}" in
  --self-test) ;;
  --format) [ $# -eq 1 ] || usage; format; exit 0 ;;
  --path)
    shift; WT=. DIR=""
    while [ $# -gt 0 ]; do
      case $1 in --dir) [ $# -ge 2 ] || usage; DIR=$2; shift 2 ;; -*) usage ;; *) WT=$1; shift ;; esac
    done
    journey path "$WT" "$DIR"; exit $? ;;
  *)
    WT=. TICKET="" REPORT=""
    while [ $# -gt 0 ]; do
      case $1 in
        --ticket) [ $# -ge 2 ] || usage; TICKET=$2; shift 2 ;;
        --report) [ $# -ge 2 ] || usage; REPORT=$2; shift 2 ;;
        -*) usage ;;
        *) WT=$1; shift ;;
      esac
    done
    [ -d "$WT" ] || { echo "verify-journey: no such directory: $WT" >&2; exit 1; }
    journey judge "$WT" "$TICKET" "$REPORT"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(cd "$(mktemp -d)" && pwd -P) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
SELF="$HERE/verify-journey.sh"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
expect() {  # expect <label> <exit> <ticket> <report or ''> [<text the output must hold>]
  local out rc
  if [ -n "$4" ]; then out=$("$SELF" "$wt" --ticket "$3" --report "$4" 2>&1); else out=$("$SELF" "$wt" --ticket "$3" 2>&1); fi
  rc=$?
  if [ "$rc" -eq "$2" ] && { [ -z "${5:-}" ] || grep -qF -- "$5" <<<"$out"; }; then ok "$1"; else fail "$1 (exit $rc)" "$out"; fi
}

wt="$tmp/app"; mkdir -p "$wt"
git -C "$wt" init -q -b main && git -C "$wt" -c user.name=t -c user.email=t@t commit -q --allow-empty -m first
mkdir -p "$tmp/shots"; printf 'png' > "$tmp/shots/1.png"; printf 'png' > "$tmp/shots/2.png"; : > "$tmp/shots/empty.png"

cat > "$tmp/prose.md" <<'EOF'
# Waybill: T-1

## Ticket
## User journey
On the board, the user taps `Add task` and types `buy milk.` into the box.
They press Enter and see the task at the top of the list!

```
$ this fenced block is not a step.
```

## Project profile
repo: /somewhere
EOF
cat > "$tmp/list.md" <<'EOF'
## User journey
1. The user opens the board.
2. They tap `Add task`
   and type a title.
## Notes
Not a step.
EOF
report() {  # report <file> <heading> <verdict> <shot> [<heading> <verdict> <shot>]...
  local f=$1; shift; : > "$f"
  while [ $# -ge 3 ]; do printf '## %s\n%s\nscreenshot: %s\n\n' "$1" "$2" "$3" >> "$f"; shift 3; done
}
S1='On the board, the user taps `Add task` and types `buy milk.` into the box.'
S2='They press Enter and see the task at the top of the list!'
report "$tmp/good.md" "$S1" did shots/1.png "$S2" did shots/2.png
report "$tmp/loose.md" "on the board,  the user taps \`Add task\` and types \`buy milk.\` into the box" did shots/1.png "$S2" did shots/2.png "A check of my own" "did not: it is only mine" shots/1.png
report "$tmp/didnot.md" "$S1" did shots/1.png "$S2" "did not: the list stayed empty" shots/2.png
report "$tmp/missing.md" "$S1" did shots/1.png
report "$tmp/order.md" "$S2" did shots/2.png "$S1" did shots/1.png
report "$tmp/noshot.md" "$S1" did shots/1.png "$S2" did shots/none.png
report "$tmp/emptyshot.md" "$S1" did shots/1.png "$S2" did shots/empty.png
report "$tmp/noverdict.md" "$S1" did shots/1.png "$S2" "looked fine" shots/2.png
report "$tmp/listgood.md" "The user opens the board." did shots/1.png "They tap \`Add task\` and type a title." did shots/2.png

echo "positive controls"
expect "a complete report passes"                                            0 "$tmp/prose.md" "$tmp/good.md" "all 2 steps walked"
expect "case, spacing, a closing stop and steps of its own do not matter"    0 "$tmp/prose.md" "$tmp/loose.md" "all 2 steps walked"
expect "a list's items are its steps, continuation lines included"           0 "$tmp/list.md" "$tmp/listgood.md" "all 2 steps walked"
p=$("$SELF" --path "$wt" --dir "$tmp/j"); [ "$p" = "$tmp/j/$(git -C "$wt" rev-parse HEAD).md" ] && ok "the report's path names the commit" || fail "the report's path names the commit" "$p"
# good.md gives its screenshots relative to the report, so a copy of it elsewhere is found but
# incomplete until they sit beside it.
mkdir -p "$tmp/j" "$tmp/spec" && cp "$tmp/good.md" "$p"
printf '{"journey_dir": "%s"}\n' "$tmp/j" > "$tmp/spec/spec.json"
out=$(cd "$wt" && POSTMASTER_VERIFY="$tmp/spec" "$SELF" --ticket "$tmp/prose.md" 2>&1); rc=$?
[ $rc -eq 3 ] && grep -qF "no screenshot beside the report" <<<"$out" && ok "the report for HEAD is found through the armed checks" || fail "the report for HEAD is found through the armed checks (exit $rc)" "$out"
mkdir -p "$tmp/j/shots" && cp "$tmp/shots/1.png" "$tmp/shots/2.png" "$tmp/j/shots/"
out=$(cd "$wt" && POSTMASTER_VERIFY="$tmp/spec" "$SELF" --ticket "$tmp/prose.md" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "and passes once its screenshots are beside it" || fail "and passes once its screenshots are beside it (exit $rc)" "$out"
grep -qF 'did not: <what happened instead>' <<<"$("$SELF" --format)" && ok "the format says how a step is marked" || fail "the format says how a step is marked"

echo "negative controls"
expect "a step marked did not fails, and says what happened"   1 "$tmp/prose.md" "$tmp/didnot.md" "the list stayed empty"
expect "a step not in the report is not run"                   3 "$tmp/prose.md" "$tmp/missing.md" "step 2 not walked"
expect "steps out of order are not run"                        3 "$tmp/prose.md" "$tmp/order.md" "not walked"
expect "a missing screenshot is not run"                       3 "$tmp/prose.md" "$tmp/noshot.md" "no screenshot beside the report"
expect "an empty screenshot is not run"                        3 "$tmp/prose.md" "$tmp/emptyshot.md" "no screenshot beside the report"
mkdir -p "$tmp/r"; report "$tmp/r/outside.md" "$S1" did "$tmp/shots/1.png" "$S2" did ../shots/2.png
expect "a screenshot outside the report's directory is not run"  3 "$tmp/prose.md" "$tmp/r/outside.md" "step 1 has no screenshot beside the report"
expect "a step with no verdict is not run"                     3 "$tmp/prose.md" "$tmp/noverdict.md" "has no verdict"
expect "no report is not run"                                  3 "$tmp/prose.md" "$tmp/none.md" "no journey report at"
printf '## Problem / feature\nNo journey here.\n' > "$tmp/nojourney.md"
expect "a ticket with no User journey is not run"              3 "$tmp/nojourney.md" "$tmp/good.md" "has no User journey"
printf '## User journey\n\n## Notes\nx\n' > "$tmp/emptyjourney.md"
expect "a User journey with no steps is not run"               3 "$tmp/emptyjourney.md" "$tmp/good.md" "has no steps"
git -C "$wt" -c user.name=t -c user.email=t@t commit -q --allow-empty -m second
out=$(cd "$wt" && POSTMASTER_VERIFY="$tmp/spec" "$SELF" --ticket "$tmp/prose.md" 2>&1); rc=$?
[ $rc -eq 3 ] && grep -qF "no journey report at" <<<"$out" && ok "a walk of an earlier commit does not count for a later one" || fail "a walk of an earlier commit does not count for a later one (exit $rc)" "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
