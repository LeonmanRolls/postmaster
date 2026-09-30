#!/usr/bin/env bash
# Acceptance oracle for parallel runs: nothing in skills/, AGENTS.md, README.md or the
# wiki still says two runs must not change the same files. Runs go in parallel up to
# `team.max_runs`, and whichever merges second resolves the conflicts at its merge.
# Five checks name one stale sentence each from before that change, matched
# case-insensitively after newlines are folded (carriage returns stripped first, so
# CRLF never hides one),
# and five match the claim itself in every file in scope (`overlapping file surfaces`,
# `never two runs on`, `not change/touch/edit the same files`): a new sentence in one
# of these phrasings trips the same guard. Further paraphrases are beyond a grep oracle.
# Six presence checks hold the sections that survive: step 6 still exists as the
# Order-them step under Stage A and orders by dependencies within its own lines (a
# word-boundary match, so `independence` never satisfies it), the `team.max_runs`
# hard-rule limit stays verbatim in its section, and the concurrency note is
# rewritten, not deleted, keeping second-resolves and never-rebase. The replacement
# wording beyond those pins is judged by reading, not by this script.
#
#   parallel-runs-acceptance.sh [repo-root]   default: the repo this script lives in
#   parallel-runs-acceptance.sh --self-test   prove each check fails on its own fault alone,
#                                             a clean tree passes, and the live tree passes
#
#   exit 0  no stale claim remains
#   exit 1  stale claims, one per line on stdout: <file>: <what is still claimed>
#   exit 2  usage, a file that cannot be read, or a tree that cannot be fully swept
#
# The self-test fails on a tree that still carries the old claims, at its live-tree step;
# that failure is the control proving the checks bite on the real files, not only fixtures.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(dirname "$HERE")
usage() { echo "usage: parallel-runs-acceptance.sh [repo-root] | --self-test" >&2; exit 2; }

flat() { tr -d '\r' < "$1" | tr '\n\t' '  ' | sed 's/  */ /g'; }   # fold newlines so a reflow alone never passes

# stale <flat-text> <file> <label> <sentence...>: fault when the sentence is still claimed
fails=0
stale() {
  local text=$1 file=$2 label=$3; shift 3
  if printf '%s' "$text" | grep -qi -F -- "$*"; then
    printf '%s: still says %s\n' "$file" "$label"
    fails=$((fails + 1))
  fi
}

# gone <file> <label>: fault when a section that must survive is missing
gone() {
  printf '%s: no longer %s\n' "$1" "$2"
  fails=$((fails + 1))
}

# sweep <file> <flat-text>: the six stale sentences plus the claim itself in its
# plain phrasings, matched case-insensitively. Further paraphrases are beyond a
# grep oracle.
sweep() {
  local f=$1 text=$2 claim
  stale "$text" "$f" 'step 6 orders by file surfaces' \
    'then the file surfaces'
  stale "$text" "$f" 'two tickets on one module do not run together' \
    'Two tickets touching the same route table, transport interface or shared module do not run at the same time'
  stale "$text" "$f" 'never two runs on overlapping file surfaces' \
    'never two runs on overlapping file surfaces'
  stale "$text" "$f" 'parallel runs are safe only on disjoint files' \
    'Parallel runs are safe when their tickets touch disjoint files'
  stale "$text" "$f" 'prefer sequencing colliding tickets' \
    'Prefer sequencing those tickets, or accept conflict resolution at each gated merge;'
  stale "$text" "$f" 'check file surfaces before mass-launching' \
    'check the file surfaces before mass-launching'
  for claim in 'overlapping file surfaces' 'never two runs on' 'not change the same files' \
      'not touch the same files' 'not edit the same files'; do
    stale "$text" "$f" 'two runs must not change the same files' "$claim"
  done
}

accept() {  # accept <root>: the checks; stdout the faults, exit 0/1/2
  local root=$1 f
  for f in AGENTS.md README.md skills/postmaster/postmaster.md skills/postmaster/coachman.md; do
    [ -r "$root/$f" ] || { echo "parallel-runs-acceptance: cannot read $root/$f" >&2; return 2; }
  done
  fails=0
  local step6 step6flat note noteflat rules rulesflat scope scope_err text
  # Every stale sentence is swept in every file in scope, not only the file it
  # was removed from: a verbatim copy planted in AGENTS.md, README.md or any
  # regular file under skills/ or wiki/ (symlinks followed), whatever its
  # suffix, trips the same guard. A tree that cannot be fully swept is exit 2,
  # not a clean result.
  for f in AGENTS.md README.md; do
    text=$(flat "$root/$f") || return 2
    sweep "$f" "$text"
  done
  scope_err=$(mktemp) || return 2
  scope=$(find -L "$root/skills" "$root/wiki" -type f -print 2>"$scope_err" | sort -u)
  if [ -s "$scope_err" ]; then
    echo "parallel-runs-acceptance: cannot fully sweep $root/skills and $root/wiki" >&2
    cat "$scope_err" >&2
    rm -f "$scope_err"
    return 2
  fi
  rm -f "$scope_err"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    f=${f#"$root"/}   # strip in the shell: $root may hold sed delimiters
    text=$(flat "$root/$f") || return 2
    sweep "$f" "$text"
  done <<EOF
$scope
EOF
  # Step 6 survives as the Order-them step under Stage A, ordering by dependencies
  # within its own lines: the range runs from the `6.` item to the next step or
  # heading, folded, so a reflow inside the step neither passes a gutted step nor
  # faults a kept one, and unrelated text elsewhere cannot satisfy it.
  step6=$(awk '/^## Stage A/{sect=1; next} sect && /^## /{exit} sect && /^6\. /{on=1} on && /^[0-9][0-9]*\. / && !/^6\. /{exit} on{print}' \
    "$root/skills/postmaster/postmaster.md")
  step6flat=$(printf '%s' "$step6" | tr '\n\t' '  ' | sed 's/  */ /g')
  if [ -z "$step6" ] || ! printf '%s' "$step6flat" | grep -q -F 'Order them'; then
    gone skills/postmaster/postmaster.md 'orders tickets in an Order-them step'
  elif ! printf '%s' "$step6flat" | grep -qiE '\bdependenc(y|ies)\b'; then
    gone skills/postmaster/postmaster.md 'orders step 6 by dependencies'
  fi
  # The `team.max_runs` limit stays as its hard-rule sentence within the Hard rules
  # section, matched on the folded section so a rewrap of the bullet neither
  # passes a relocated string nor faults a kept one, and a quotation of the
  # sentence outside its section does not satisfy it.
  rules=$(awk '/^## Hard rules/{on=1; next} on && /^## /{exit} on{print}' \
    "$root/skills/postmaster/postmaster.md")
  rulesflat=$(printf '%s' "$rules" | tr '\n\t' '  ' | sed 's/  */ /g')
  printf '%s' "$rulesflat" | grep -q -F -- '- Never launch more runs than `team.max_runs`.' \
    || gone skills/postmaster/postmaster.md 'limits runs with team.max_runs'
  # The concurrency note survives as a section that still says the run merging
  # second resolves the conflicts by merge, never rebase: a heading over a gutted
  # body does not satisfy it.
  note=$(awk '/^## Concurrency note/{on=1; next} on && /^## /{exit} on{print}' \
    "$root/skills/postmaster/coachman.md")
  if [ -z "$note" ]; then
    gone skills/postmaster/coachman.md 'keeps a concurrency note'
  else
    noteflat=$(printf '%s' "$note" | tr '\n\t' '  ' | sed 's/  */ /g')
    printf '%s' "$noteflat" | grep -qi -F 'merges second' \
      || gone skills/postmaster/coachman.md 'says the second merger resolves the conflicts'
    printf '%s' "$noteflat" | grep -qi -F 'never rebase' \
      || gone skills/postmaster/coachman.md 'says merge, never rebase'
  fi
  [ "$fails" -eq 0 ]
}

case ${1:-} in
  --self-test) [ $# -eq 1 ] || usage ;;
  -*) usage ;;
  "") [ $# -eq 0 ] || usage; accept "$ROOT"; exit $? ;;
  *) [ $# -eq 1 ] || usage; accept "$1"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 2
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
has() {  # has <name> <output> <line>
  printf '%s\n' "$2" | grep -qxF -- "$3" && printf '  ok   %s\n' "$1" \
    || { printf '  FAIL %s: no line "%s" in:\n%s\n' "$1" "$3" "$2"; fails=$((fails + 1)); }
}

mkdir -p "$tmp/clean/skills/postmaster" "$tmp/clean/wiki/concepts"
cat > "$tmp/clean/skills/postmaster/postmaster.md" <<'EOF'
## Stage A: the stream becomes tickets
6. **Order them.** Dependencies first: a ticket that needs another's change waits for it to land. Record the order and the reason in `<runs>/postmaster/plan.md`, current state only.
## Hard rules
- Never launch more runs than `team.max_runs`.
EOF
cat > "$tmp/clean/skills/postmaster/coachman.md" <<'EOF'
## Concurrency note (several runs on one project)
Runs go in parallel up to `team.max_runs`. When two runs change the same files, the one that merges second resolves the conflicts at its merge; merge, never rebase.
EOF
cat > "$tmp/clean/skills/postmaster/SKILL.md" <<'EOF'
You get the machine ready, choose a target, and start the postmaster.
EOF
cat > "$tmp/clean/skills/postmaster/harnesses.md" <<'EOF'
The launch keeps them, as a claude lane reads the same files.
EOF
cat > "$tmp/clean/AGENTS.md" <<'EOF'
| **postmaster** | decomposes a stream into tickets | `skills/postmaster/postmaster.md` |
Several models implement the same ticket independently, in separate worktrees.
EOF
cat > "$tmp/clean/README.md" <<'EOF'
Get one ticket implemented by several models at once, then judged before it lands.
EOF
cat > "$tmp/clean/wiki/concepts/review-loop.md" <<'EOF'
When the passes ran in sequence, each lens saw only its own output.
The overlap between independent reviewers estimates what an inspection left.
EOF

alone() {  # alone <name> <file> <want-line> <fault...>: the check fires on its fault alone
  local name=$1 file=$2 want=$3 out rc; shift 3
  rm -rf "$tmp/one" && cp -r "$tmp/clean" "$tmp/one"
  printf '%s\n' "$*" >> "$tmp/one/$file"
  out=$(accept "$tmp/one"); rc=$?
  [ "$rc" -eq 1 ] && [ "$out" = "$want" ] && printf '  ok   %s\n' "$name" \
    || { printf '  FAIL %s: exit %s with:\n%s\n' "$name" "$rc" "$out"; fails=$((fails + 1)); }
}

without() {  # without <name> <file> <want-line> <sed-expr>: the presence check fires alone
  local name=$1 file=$2 want=$3 out rc; shift 3
  rm -rf "$tmp/one" && cp -r "$tmp/clean" "$tmp/one"
  sed -i "$1" "$tmp/one/$file"
  out=$(accept "$tmp/one"); rc=$?
  [ "$rc" -eq 1 ] && [ "$out" = "$want" ] && printf '  ok   %s\n' "$name" \
    || { printf '  FAIL %s: exit %s with:\n%s\n' "$name" "$rc" "$out"; fails=$((fails + 1)); }
}

echo "each check fires on its own fault alone"
alone 'step 6 file surfaces' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: still says step 6 orders by file surfaces' \
  '6. **Order them.** Dependencies first; then the file surfaces.'
alone 'two tickets one module' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: still says two tickets on one module do not run together' \
  'Two tickets touching the same route table, transport interface or shared module do not run at the same time.'
alone 'disjoint files' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: still says parallel runs are safe only on disjoint files' \
  'Parallel runs are safe when their tickets touch disjoint files.'
alone 'prefer sequencing' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: still says prefer sequencing colliding tickets' \
  'Prefer sequencing those tickets, or accept conflict resolution at each gated merge;'
alone 'check surfaces' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: still says check file surfaces before mass-launching' \
  'check the file surfaces before mass-launching.'
alone 'AGENTS general claim' AGENTS.md \
  'AGENTS.md: still says two runs must not change the same files' \
  'Two runs must not change the same files.'
alone 'README general claim' README.md \
  'README.md: still says two runs must not change the same files' \
  'Two runs do not touch the same files.'
alone 'wiki general claim' wiki/concepts/review-loop.md \
  'wiki/concepts/review-loop.md: still says two runs must not change the same files' \
  'Two runs must not edit the same files.'
alone 'SKILL general claim' skills/postmaster/SKILL.md \
  'skills/postmaster/SKILL.md: still says two runs must not change the same files' \
  'The old overlapping file surfaces rule is gone.'
without 'step 6 kept' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer orders tickets in an Order-them step' \
  '/Order them/d'
without 'max_runs kept' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer limits runs with team.max_runs' \
  '/team.max_runs/d'
without 'step 6 dependencies' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer orders step 6 by dependencies' \
  's/Dependencies first:/Order kept:/'
without 'note kept' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: no longer keeps a concurrency note' \
  '/Concurrency note/d'
without 'step 6 independence' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer orders step 6 by dependencies' \
  's/Dependencies first:/Order kept for independence of lanes:/'
without 'step 6 unrelated text' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer orders tickets in an Order-them step' \
  's/^6\. \*\*Order them\.\*\* Dependencies first:/Order them whenever. Dependencies are fine:/'
without 'max_runs relocated' skills/postmaster/postmaster.md \
  'skills/postmaster/postmaster.md: no longer limits runs with team.max_runs' \
  's/- Never launch more runs than `team.max_runs`./- Never launch runs without a ticket./; $a See also team.max_runs in the example config.'
without 'note body resolves' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: no longer says the second merger resolves the conflicts' \
  's/merges second/resolves things/'
without 'note body rebase' skills/postmaster/coachman.md \
  'skills/postmaster/coachman.md: no longer says merge, never rebase' \
  's/never rebase/always rebase/'
alone 'skills txt claim' skills/NOTES.txt \
  'skills/NOTES.txt: still says two runs must not change the same files' \
  'Two runs must not change the same files.'
alone 'wiki yml claim' wiki/_config.yml \
  'wiki/_config.yml: still says two runs must not change the same files' \
  'Two runs must not edit the same files.'
alone 'AGENTS known sentence' AGENTS.md \
  'AGENTS.md: still says prefer sequencing colliding tickets' \
  'Prefer sequencing those tickets, or accept conflict resolution at each gated merge;'
alone 'README known sentence' README.md \
  'README.md: still says check file surfaces before mass-launching' \
  'check the file surfaces before mass-launching.'
alone 'wiki known sentence' wiki/concepts/review-loop.md \
  'wiki/concepts/review-loop.md: still says parallel runs are safe only on disjoint files' \
  'Parallel runs are safe when their tickets touch disjoint files.'
alone 'capitalised claim' skills/postmaster/SKILL.md \
  'skills/postmaster/SKILL.md: still says two runs must not change the same files' \
  'Two Runs Must Not Change The Same Files.'
# The hard-rule clause carries two general phrasings inside it, so it fires three checks.
rm -rf "$tmp/one" && cp -r "$tmp/clean" "$tmp/one"
printf '%s\n' '- Never launch more runs than `team.max_runs`, and never two runs on overlapping file surfaces.' \
  >> "$tmp/one/skills/postmaster/postmaster.md"
out=$(accept "$tmp/one"); rc=$?
[ "$rc" -eq 1 ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" -eq 3 ] \
  && printf '%s\n' "$out" | grep -qxF 'skills/postmaster/postmaster.md: still says never two runs on overlapping file surfaces' \
  && [ "$(printf '%s\n' "$out" | grep -c -xF 'skills/postmaster/postmaster.md: still says two runs must not change the same files')" -eq 2 ] \
  && printf '  ok   hard-rule clause fires its check and the general one twice\n' \
  || { printf '  FAIL hard-rule clause: exit %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }
# A capitalised hard-rule clause fires the same three checks.
rm -rf "$tmp/one" && cp -r "$tmp/clean" "$tmp/one"
printf '%s\n' 'Never Two Runs On Overlapping File Surfaces.' \
  >> "$tmp/one/skills/postmaster/SKILL.md"
out=$(accept "$tmp/one"); rc=$?
[ "$rc" -eq 1 ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" -eq 3 ] \
  && printf '%s\n' "$out" | grep -qxF 'skills/postmaster/SKILL.md: still says never two runs on overlapping file surfaces' \
  && [ "$(printf '%s\n' "$out" | grep -c -xF 'skills/postmaster/SKILL.md: still says two runs must not change the same files')" -eq 2 ] \
  && printf '  ok   capitalised clause fires its check and the general one twice\n' \
  || { printf '  FAIL capitalised clause: exit %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

echo "all faults together"
rm -rf "$tmp/stale" && cp -r "$tmp/clean" "$tmp/stale"
printf '%s\n' '6. **Order them.** Dependencies first; then the file surfaces. Two tickets touching the same route table, transport interface or shared module do not run at the same time.' \
  '- Never launch more runs than `team.max_runs`, and never two runs on overlapping file surfaces.' \
  >> "$tmp/stale/skills/postmaster/postmaster.md"
printf '%s\n' 'Parallel runs are safe when their tickets touch disjoint files.' \
  'Prefer sequencing those tickets, or accept conflict resolution at each gated merge;' \
  'check the file surfaces before mass-launching.' \
  >> "$tmp/stale/skills/postmaster/coachman.md"
printf '%s\n' 'Two runs must not change the same files.' >> "$tmp/stale/AGENTS.md"
printf '%s\n' 'Two runs do not touch the same files.' >> "$tmp/stale/README.md"
printf '%s\n' 'Two runs must not edit the same files.' >> "$tmp/stale/wiki/concepts/review-loop.md"
out=$(accept "$tmp/stale"); rc=$?
[ "$rc" -eq 1 ] && printf '  ok   stale tree exits 1\n' \
  || { printf '  FAIL stale tree exits %s, want 1\n' "$rc"; fails=$((fails + 1)); }
[ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" -eq 11 ] && printf '  ok   stale tree lists 11 faults\n' \
  || { printf '  FAIL stale tree lists:\n%s\n' "$out"; fails=$((fails + 1)); }
has 'stale step 6 surfaces' "$out" 'skills/postmaster/postmaster.md: still says step 6 orders by file surfaces'
has 'stale two tickets' "$out" 'skills/postmaster/postmaster.md: still says two tickets on one module do not run together'
has 'stale hard rule' "$out" 'skills/postmaster/postmaster.md: still says never two runs on overlapping file surfaces'
has 'stale disjoint' "$out" 'skills/postmaster/coachman.md: still says parallel runs are safe only on disjoint files'
has 'stale sequencing' "$out" 'skills/postmaster/coachman.md: still says prefer sequencing colliding tickets'
has 'stale check surfaces' "$out" 'skills/postmaster/coachman.md: still says check file surfaces before mass-launching'
has 'stale postmaster general' "$out" 'skills/postmaster/postmaster.md: still says two runs must not change the same files'
has 'stale AGENTS general' "$out" 'AGENTS.md: still says two runs must not change the same files'
has 'stale README general' "$out" 'README.md: still says two runs must not change the same files'
has 'stale wiki general' "$out" 'wiki/concepts/review-loop.md: still says two runs must not change the same files'

out=$(accept "$tmp/clean"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && printf '  ok   clean tree passes\n' \
  || { printf '  FAIL clean tree exits %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

out=$(accept "$tmp/nowhere" 2>&1); rc=$?
[ "$rc" -eq 2 ] && printf '  ok   missing tree exits 2\n' \
  || { printf '  FAIL missing tree exits %s\n' "$rc"; fails=$((fails + 1)); }

"$0" "$tmp/clean" extra >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && printf '  ok   an extra argument exits 2\n' \
  || { printf '  FAIL an extra argument exits %s\n' "$rc"; fails=$((fails + 1)); }
"$0" --self-test extra >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && printf '  ok   --self-test with an extra argument exits 2\n' \
  || { printf '  FAIL --self-test with an extra argument exits %s\n' "$rc"; fails=$((fails + 1)); }

rm -rf "$tmp/crlf" && cp -r "$tmp/clean" "$tmp/crlf"
printf 'Prefer sequencing those tickets, or accept\r\nconflict resolution at each gated merge;\r\n' >> "$tmp/crlf/skills/postmaster/coachman.md"
out=$(accept "$tmp/crlf"); rc=$?
[ "$rc" -eq 1 ] && [ "$out" = 'skills/postmaster/coachman.md: still says prefer sequencing colliding tickets' ] \
  && printf '  ok   a CRLF stale sentence is still caught\n' \
  || { printf '  FAIL a CRLF stale sentence: exit %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

rm -rf "$tmp/locked" && cp -r "$tmp/clean" "$tmp/locked" && chmod 000 "$tmp/locked/skills/postmaster/postmaster.md"
out=$(accept "$tmp/locked" 2>&1); rc=$?
chmod 644 "$tmp/locked/skills/postmaster/postmaster.md"
[ "$rc" -eq 2 ] && printf '  ok   an unreadable file exits 2, not a clean result\n' \
  || { printf '  FAIL an unreadable file exits %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

rm -rf "$tmp/lockeddir" && cp -r "$tmp/clean" "$tmp/lockeddir" \
  && mkdir "$tmp/lockeddir/skills/hidden" \
  && printf 'Two runs must not change the same files.\n' > "$tmp/lockeddir/skills/hidden/evil.md" \
  && chmod 000 "$tmp/lockeddir/skills/hidden"
out=$(accept "$tmp/lockeddir" 2>&1); rc=$?
chmod 755 "$tmp/lockeddir/skills/hidden"
[ "$rc" -eq 2 ] && printf '  ok   an unreadable subtree exits 2, not a clean result\n' \
  || { printf '  FAIL an unreadable subtree exits %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

rm -rf "$tmp/reflow" && cp -r "$tmp/clean" "$tmp/reflow"
cat > "$tmp/reflow/skills/postmaster/postmaster.md" <<'EOF'
## Stage A: the stream becomes tickets
6. **Order them.**
   Read the stream.
   Count the tickets.
   Name the owners.
   Check the board.
   Note the risks.
   Ask the room.
   Dependencies first: a ticket that needs another's change waits for it to land.
## Hard rules
- Never launch more runs than `team.max_runs`.
EOF
out=$(accept "$tmp/reflow" 2>"$tmp/reflow.err"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$tmp/reflow.err" ] \
  && printf '  ok   a reflowed step 6 still passes, silently\n' \
  || { printf '  FAIL a reflowed step 6: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/reflow.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/split" && cp -r "$tmp/clean" "$tmp/split"
cat > "$tmp/split/skills/postmaster/postmaster.md" <<'EOF'
## Stage A: the stream becomes tickets
6. **Order
them.** Dependencies first: a ticket that needs another's change waits for it to land.
## Hard rules
- Never launch more runs than `team.max_runs`.
EOF
out=$(accept "$tmp/split" 2>"$tmp/split.err"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$tmp/split.err" ] \
  && printf '  ok   a split Order-them still passes, silently\n' \
  || { printf '  FAIL a split Order-them: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/split.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/piped" && mkdir "$tmp/piped" && cp -r "$tmp/clean" "$tmp/piped/we|ird"
printf 'Two runs must not change the same files.\n' >> "$tmp/piped/we|ird/skills/postmaster/SKILL.md"
out=$(accept "$tmp/piped/we|ird" 2>"$tmp/piped.err"); rc=$?
[ "$rc" -eq 1 ] && [ "$out" = 'skills/postmaster/SKILL.md: still says two runs must not change the same files' ] \
  && [ ! -s "$tmp/piped.err" ] && printf '  ok   a root path with a pipe still sweeps, silently\n' \
  || { printf '  FAIL a root path with a pipe: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/piped.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/reflowrule" && cp -r "$tmp/clean" "$tmp/reflowrule"
sed -i 's/- Never launch more runs than `team.max_runs`./- Never launch more runs than\n  `team.max_runs`./' \
  "$tmp/reflowrule/skills/postmaster/postmaster.md"
out=$(accept "$tmp/reflowrule" 2>"$tmp/reflowrule.err"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$tmp/reflowrule.err" ] \
  && printf '  ok   a rewrapped hard rule still passes, silently\n' \
  || { printf '  FAIL a rewrapped hard rule: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/reflowrule.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/quoted" && cp -r "$tmp/clean" "$tmp/quoted"
cat > "$tmp/quoted/skills/postmaster/postmaster.md" <<'EOF'
## Stage A: the stream becomes tickets
6. **Order them.** Dependencies first: a ticket that needs another's change waits for it to land.
## Hard rules
- Never launch runs without a ticket.
## Notes
Quoting the old rule: - Never launch more runs than `team.max_runs`.
EOF
out=$(accept "$tmp/quoted" 2>"$tmp/quoted.err"); rc=$?
[ "$rc" -eq 1 ] && [ "$out" = 'skills/postmaster/postmaster.md: no longer limits runs with team.max_runs' ] \
  && [ ! -s "$tmp/quoted.err" ] && printf '  ok   a hard rule quoted outside its section still faults\n' \
  || { printf '  FAIL a hard rule quoted outside its section: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/quoted.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/movedin" && cp -r "$tmp/clean" "$tmp/movedin"
cat > "$tmp/movedin/skills/postmaster/postmaster.md" <<'EOF'
## Stage A: the stream becomes tickets
6. **Order them.** Dependencies first: a ticket that needs another's change waits for it to land.
## Hard rules
- Never merge without a ticket.
- Never launch more runs than `team.max_runs`.
EOF
out=$(accept "$tmp/movedin" 2>"$tmp/movedin.err"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$tmp/movedin.err" ] \
  && printf '  ok   a hard rule moved within its section still passes, silently\n' \
  || { printf '  FAIL a hard rule moved within its section: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/movedin.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/flink" && cp -r "$tmp/clean" "$tmp/flink"
printf 'Two runs must not change the same files.\n' > "$tmp/flink/claim.txt"
ln -s ../claim.txt "$tmp/flink/skills/evil-link.md"
out=$(accept "$tmp/flink" 2>"$tmp/flink.err"); rc=$?
[ "$rc" -eq 1 ] && [ "$out" = 'skills/evil-link.md: still says two runs must not change the same files' ] \
  && [ ! -s "$tmp/flink.err" ] && printf '  ok   a claim behind a file symlink faults\n' \
  || { printf '  FAIL a claim behind a file symlink: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/flink.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/dlink" && cp -r "$tmp/clean" "$tmp/dlink"
mkdir "$tmp/dlink/realdir" && printf 'Two runs must not change the same files.\n' > "$tmp/dlink/realdir/evil.md"
ln -s ../realdir "$tmp/dlink/wiki/sub"
out=$(accept "$tmp/dlink" 2>"$tmp/dlink.err"); rc=$?
[ "$rc" -eq 1 ] && [ "$out" = 'wiki/sub/evil.md: still says two runs must not change the same files' ] \
  && [ ! -s "$tmp/dlink.err" ] && printf '  ok   a claim behind a directory symlink faults\n' \
  || { printf '  FAIL a claim behind a directory symlink: exit %s out:\n%s\nerr:\n%s\n' "$rc" "$out" "$(cat "$tmp/dlink.err")"; fails=$((fails + 1)); }

rm -rf "$tmp/eloop" && cp -r "$tmp/clean" "$tmp/eloop" && ln -s loop "$tmp/eloop/skills/loop"
out=$(accept "$tmp/eloop" 2>&1); rc=$?
[ "$rc" -eq 2 ] && printf '  ok   a symlink loop exits 2, not a clean result\n' \
  || { printf '  FAIL a symlink loop exits %s with:\n%s\n' "$rc" "$out"; fails=$((fails + 1)); }

out=$(accept "$ROOT"); rc=$?
[ "$rc" -eq 0 ] && printf '  ok   live tree passes\n' \
  || { printf '  LIVE tree still carries stale claims (expected before the fix):\n%s\n' "$out"; fails=$((fails + 1)); }

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
