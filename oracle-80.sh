#!/usr/bin/env bash
# Oracle for #80: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's diff, committed as the
# first commit on the ticket branch. It checks properties the ticket names, never
# one phrasing of them: a decision script the runbook newly calls, whose self-test
# passes and whose fixtures span P1/P2/P3, rounds and the cap; the loop-ending rule
# rewritten around verified P1/P2 findings with the old sentence gone; P1/P2/P3
# defined one line each; P3s unfixed from round 2 on and carried with their round;
# the three-round cap and the repeated-class escalation kept; the checkpoint card
# saying which round ended the loop and why; and the wiki recording the user's rule
# in the user's words, with the backstop.
#
#   oracle-80.sh            run from the repo root; exit 0 when the worktree meets
#                           the ticket, 1 otherwise, one line per probe
#
set -uo pipefail

BASE_SHA=7e6a7151661ee61511ca908fdc0fa76459410e7c
COACH=skills/postmaster/coachman.md
LOOP=wiki/concepts/review-loop.md
CONV=wiki/concepts/review-convergence.md
[ -f "$COACH" ] || { echo "oracle: run from the repo root: $COACH not found" >&2; exit 1; }

fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=1; }

# --- the decision script (AC5): discovered, never named -----------------------
# A script the ticket does not name is interface the lanes chose. The oracle finds
# it as a script under scripts/ changed vs BASE that the runbook newly calls.
CHANGED=$(git diff --name-only "$BASE_SHA" HEAD -- scripts/ 2>/dev/null || true)
BASE_CALLS=$(git show "$BASE_SHA:$COACH" 2>/dev/null | grep -o '<tool>/scripts/[a-z0-9-]*\.sh' | sort -u || true)
NEW_CALLS=$(grep -o '<tool>/scripts/[a-z0-9-]*\.sh' "$COACH" | sort -u | comm -23 - <(printf '%s\n' "$BASE_CALLS") || true)
DECISION=""
for c in $NEW_CALLS; do
  f=${c#'<tool>/'}                       # scripts/<name>.sh
  if printf '%s\n' "$CHANGED" | grep -qxF "$f"; then DECISION="$DECISION $f"; fi
done
DECISION=${DECISION# }

if [ -n "$DECISION" ]; then
  pass P1-decision-script "runbook newly calls:$DECISION (changed vs BASE)"
else
  nope P1-decision-script "no changed scripts/*.sh newly called from $COACH (changed: $(echo $CHANGED | tr '\n' ' '))"
fi

# P2: every discovered script parses and its self-test passes.
if [ -z "$DECISION" ]; then
  nope P2-self-test "no decision script to test"
else
  ok=1
  for s in $DECISION; do
    bash -n "$s" 2>/dev/null || { ok=0; nope P2-self-test "$s does not parse"; continue; }
    if [ -x "$s" ] || head -1 "$s" | grep -q '^#!'; then :; fi
    if bash "$s" --self-test >/tmp/oracle-80-selftest.log 2>&1; then :; else ok=0; nope P2-self-test "$s --self-test exits nonzero"; fi
  done
  [ "$ok" = 1 ] && pass P2-self-test "self-test green for:$DECISION"
fi

# P3: the script decides from the round's finding and apply lines (AC5).
if [ -z "$DECISION" ]; then
  nope P3-reads-lines "no decision script to read"
else
  ok=1
  for s in $DECISION; do
    grep -q 'finding' "$s" && grep -q 'apply' "$s" || { ok=0; nope P3-reads-lines "$s never names finding/apply lines"; }
  done
  [ "$ok" = 1 ] && pass P3-reads-lines "names finding and apply lines:$DECISION"
fi

# P4: its fixtures span the severities, the rounds and the cap (AC5, cases of AC2/AC6).
if [ -z "$DECISION" ]; then
  nope P4-fixture-span "no decision script to read"
else
  ok=1
  for s in $DECISION; do
    for tok in P1 P2 P3; do
      grep -q -w "$tok" "$s" || { ok=0; nope P4-fixture-span "$s never names $tok"; }
    done
    grep -q -w -i cap "$s" || { ok=0; nope P4-fixture-span "$s never names the cap"; }
    grep -q -w -i round "$s" || { ok=0; nope P4-fixture-span "$s never names a round"; }
  done
  [ "$ok" = 1 ] && pass P4-fixture-span "P1/P2/P3, round and cap all named:$DECISION"
fi

# --- what ends the loop (AC2) --------------------------------------------------
# Round 2 runs whenever round 1 applied a fix, in whatever words, on one line.
if grep -q -i -E 'round 1[^.]{0,60}applied[^.]{0,40}fix' "$COACH"; then
  pass P5-round2-trigger "round 1 applied a fix brings round 2"
else
  nope P5-round2-trigger "no line ties round 2 to round 1 having applied a fix"
fi

# The old end condition is gone; the new one names P1 and P2.
if grep -q 'zero new verified gating findings' "$COACH"; then
  nope P6-end-rule "old sentence 'zero new verified gating findings' still present"
elif grep -q -w P1 "$COACH" && grep -q -w P2 "$COACH"; then
  pass P6-end-rule "old sentence gone, P1 and P2 named"
else
  nope P6-end-rule "old sentence gone but P1/P2 not both named"
fi

# A P1/P2 fix that does not verify closed is logged as a finding of its severity.
if grep -q -i 'verify closed' "$COACH"; then
  pass P7-unclosed-fix "names a fix that does not verify closed"
else
  nope P7-unclosed-fix "no 'verify closed' in $COACH"
fi

# --- round 2 on: P3s unfixed, carried with lens and round (AC3, AC7) -----------
if grep -q -i -E 'unfixed|not fixed' "$COACH"; then
  pass P8a-p3-unfixed "P3 findings go unfixed from round 2 on"
else
  nope P8a-p3-unfixed "neither 'unfixed' nor 'not fixed' in $COACH"
fi
if grep -q -i -E 'P3.{0,60}round|round.{0,60}P3' "$COACH" \
  && grep -q 'lens and originating round' "$COACH" \
  && grep -q 'includes its originating round' "$COACH"; then
  pass P8b-p3-round "a P3 is carried with its lens and round at both destinations"
else
  nope P8b-p3-round "no lines carry a P3 with its lens and round at both destinations"
fi

# --- one-line severity definitions (AC4) ---------------------------------------
p1only=$(grep -w P1 "$COACH" | grep -v -w P2 | grep -v -w P3 | wc -l)
p2only=$(grep -w P2 "$COACH" | grep -v -w P1 | grep -v -w P3 | wc -l)
p3only=$(grep -w P3 "$COACH" | grep -v -w P1 | grep -v -w P2 | wc -l)
if [ "$p1only" -ge 1 ] && [ "$p2only" -ge 1 ] && [ "$p3only" -ge 1 ]; then
  pass P9-definitions "P1, P2, P3 each on a line of their own ($p1only/$p2only/$p3only)"
else
  nope P9-definitions "dedicated lines P1/P2/P3: $p1only/$p2only/$p3only, want >=1 each"
fi

# --- the backstop stays (AC6) --------------------------------------------------
if grep -q '3 rounds' "$COACH" && grep -q 'REPEATED CLASS' "$COACH"; then
  pass P10-backstop "three-round cap and repeated-class escalation kept"
else
  nope P10-backstop "cap ('3 rounds') or repeated-class rule no longer in $COACH"
fi

# --- the checkpoint card (AC7) -------------------------------------------------
if grep -q -i 'ended the loop' "$COACH" && grep -q 'lists the P3 findings the loop carried to' "$COACH"; then
  pass P11-card "card says which round ended the loop and why, and lists the P3 findings it carried"
else
  nope P11-card "no 'ended the loop' with the carried P3 list in $COACH"
fi

# --- the wiki (AC8) ------------------------------------------------------------
if grep -q -w -i backstop "$LOOP" && grep -q -w P1 "$LOOP"; then
  pass P12a-loop-page "review-loop.md names P1 and the backstop"
else
  nope P12a-loop-page "review-loop.md lacks 'backstop' or 'P1'"
fi
if grep -q 'no more P1 and P2s' "$CONV"; then
  pass P12b-decision "review-convergence.md quotes the user's rule in the user's words"
else
  nope P12b-decision "review-convergence.md lacks 'no more P1 and P2s'"
fi

exit "$fail"
