#!/usr/bin/env bash
# oracle-182.sh: blind acceptance tests for #182, at the ticket's own interface.
#
# Written by the leg-1 coachman before launching any workhorse, committed on the
# ticket branch before any implementation. It drives the worktree's own scripts the
# way they will really be run (fixture.sh new/score, run-meta.sh record/efforts,
# launch.sh review/form) against scratch repos, stub harnesses and a scratch machine
# config, and asserts the ticket's five acceptance criteria: the fixture fact (AC1),
# lowered recorded efforts for fixture runs (AC2), review at the recorded effort
# (AC3), the waybill's efforts line and score's check of it (AC4), and the identical
# command controls (AC5). It reads no implementation and pins no wording of its own:
# the marker's literal, the warning's text and the score check's name are the lanes'.
#
#   ./oracle-182.sh   run from the repo root; exit 0 when the worktree meets the
#   ticket, 1 otherwise, one PASS/FAIL line per assertion.
set -uo pipefail

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
[ -x "$HERE/scripts/fixture.sh" ] || { echo "oracle: run from the repo root" >&2; exit 1; }
fail=0
pass() { echo "PASS $1"; }
nope() { echo "FAIL $1"; fail=1; }
say() { echo "  $*"; }

S=$(mktemp -d /tmp/oracle-182-XXXXXX)
trap 'rm -rf "$S"' EXIT

# --- hermetic setup: home, stubs, config, pins -----------------------------------
export HOME="$S/home"
mkdir -p "$HOME"
git config --global user.name "oracle" >/dev/null
git config --global user.email "oracle@test" >/dev/null
git config --global init.defaultBranch "main" >/dev/null

STUBS="$S/stubs"
export ORACLE_STUB_LOG="$S/stub.log"
mkdir -p "$STUBS"
for h in codex claude mimo muse; do
  printf '#!/bin/bash\necho "%s $*" >> "$ORACLE_STUB_LOG"\nif [ "${1:-}" = "--version" ]; then echo "stub-%s 0.0"; fi\nexit 0\n' "$h" "$h" > "$STUBS/$h"
  chmod +x "$STUBS/$h"
done
export PATH="$STUBS:$PATH"

cat > "$S/config.toml" <<'EOF'
[lanes.sollane]
harness = "codex"
model = "gpt-6-sol-test"
effort = "max"

[lanes.claudelane]
harness = "claude"
model = "claude-opus-test"
effort = "max"

[lanes.mimolane]
harness = "mimo"
model = "testplan/mimo-v2.6-pro"
effort = "high"

[lanes.muselane]
harness = "muse"
model = "muse-spark-test"
effort = "max"

[lanes.plainlane]
harness = "codex"
model = "gpt-6-plain-test"

[lanes.weirdlane]
harness = "no-such-harness-xyz"
model = "m9-test"
effort = "max"

[team]
workhorses = ["sollane", "mimolane"]
reviewers = ["sollane", "mimolane"]
coachman = { harness = "muse", model = "muse-spark-coach-test", effort = "max" }
coachman_fallback = { harness = "claude", model = "claude-coach-test", effort = "max" }
postmaster = { harness = "codex", model = "gpt-6-pm-test", effort = "max" }

[team.coachman_legs]
synthesis = { harness = "muse", model = "muse-spark-leg-test", effort = "max" }
EOF
export POSTMASTER_CONFIG="$S/config.toml"
export POSTMASTER_TOOL_PINS="$S/pins"

TICKET=undo
cd "$HERE"

# --- AC1: the fixture fact --------------------------------------------------------
say "AC1: fixture.sh new leaves the fact in the copy"
if scripts/fixture.sh new "$S/copy1" "$TICKET" >/dev/null 2>&1; then pass "ac1-new-copy1"; else nope "ac1-new-copy1"; fi
if scripts/fixture.sh new "$S/copy2" "$TICKET" >/dev/null 2>&1; then pass "ac1-new-copy2"; else nope "ac1-new-copy2"; fi
M1="$S/copy1/.postmaster/fixture"
M2="$S/copy2/.postmaster/fixture"
[ -f "$M1" ] && pass "ac1-marker-exists" || nope "ac1-marker-exists"
if git -C "$S/copy1" ls-tree -r --name-only HEAD 2>/dev/null | grep -qxF .postmaster/fixture; then
  pass "ac1-marker-tracked-in-first-commit"
else nope "ac1-marker-tracked-in-first-commit"; fi
[ "$(awk 'END{print NR}' "$M1" 2>/dev/null)" = "1" ] && pass "ac1-marker-one-line" || nope "ac1-marker-one-line"
[ -s "$M1" ] && pass "ac1-marker-nonempty" || nope "ac1-marker-nonempty"
if cmp -s "$M1" "$M2"; then pass "ac1-marker-identical-across-copies"; else nope "ac1-marker-identical-across-copies"; fi
if grep -qF "copy1" "$M1" 2>/dev/null; then nope "ac1-marker-names-no-copy"; else pass "ac1-marker-names-no-copy"; fi
if grep -qF "$S" "$M1" 2>/dev/null; then nope "ac1-marker-names-no-path"; else pass "ac1-marker-names-no-path"; fi
if git -C "$HERE" ls-files fixtures/app 2>/dev/null | sed 's|^fixtures/app/||' | grep -q fixture; then
  nope "ac1-template-ships-no-marker"
else pass "ac1-template-ships-no-marker"; fi
git -C "$S/copy1" ls-tree -r --name-only HEAD 2>/dev/null | grep -vxF .postmaster/fixture | sort > "$S/got.txt"
git -C "$HERE/fixtures/app" ls-files -z --cached --others --exclude-standard 2>/dev/null \
  | tr '\0' '\n' | grep -v '^$' | sort > "$S/want.txt"
if diff -q "$S/want.txt" "$S/got.txt" >/dev/null 2>&1; then
  pass "ac1-first-commit-is-app-plus-marker"
else nope "ac1-first-commit-is-app-plus-marker"; fi
mv "$S/copy1" "$S/neutral-name"

# --- AC2: dispatch records lowered efforts for fixture runs -----------------------
say "AC2: run-meta.sh records the config"
CFG_SHA_BEFORE=$(sha256sum "$S/config.toml" | cut -d' ' -f1)
mkdir -p "$S/disp-fixture"
if scripts/run-meta.sh "$S/disp-fixture" "$S/neutral-name" >"$S/meta.out" 2>"$S/meta.err"; then
  pass "ac2-record-fixture"
else nope "ac2-record-fixture"; fi
FR="$S/disp-fixture/run.json"
[ "$(jq -r '.config.lanes.sollane.effort // "MISSING"' "$FR" 2>/dev/null)" = "low" ] \
  && pass "ac2-fixture-codex-low" || nope "ac2-fixture-codex-low"
[ "$(jq -r '.config.lanes.claudelane.effort // "MISSING"' "$FR" 2>/dev/null)" = "low" ] \
  && pass "ac2-fixture-claude-low" || nope "ac2-fixture-claude-low"
[ "$(jq -r '.config.lanes.mimolane.effort // "MISSING"' "$FR" 2>/dev/null)" = "low" ] \
  && pass "ac2-fixture-mimo-low" || nope "ac2-fixture-mimo-low"
[ "$(jq -r '.config.lanes.muselane.effort // "MISSING"' "$FR" 2>/dev/null)" = "minimal" ] \
  && pass "ac2-fixture-muse-minimal" || nope "ac2-fixture-muse-minimal"
if jq -e '.config.lanes.plainlane | has("effort") | not' "$FR" >/dev/null 2>&1; then
  pass "ac2-fixture-effortless-stays-effortless"
else nope "ac2-fixture-effortless-stays-effortless"; fi
[ "$(jq -r '.config.lanes.weirdlane.effort // "MISSING"' "$FR" 2>/dev/null)" = "max" ] \
  && pass "ac2-fixture-unmapped-keeps-effort" || nope "ac2-fixture-unmapped-keeps-effort"
[ "$(jq -r '.config.team.coachman.effort // "MISSING"' "$FR" 2>/dev/null)" = "minimal" ] \
  && pass "ac2-fixture-coachman-minimal" || nope "ac2-fixture-coachman-minimal"
[ "$(jq -r '.config.team.coachman_fallback.effort // "MISSING"' "$FR" 2>/dev/null)" = "low" ] \
  && pass "ac2-fixture-fallback-low" || nope "ac2-fixture-fallback-low"
[ "$(jq -r '.config.team.postmaster.effort // "MISSING"' "$FR" 2>/dev/null)" = "low" ] \
  && pass "ac2-fixture-postmaster-low" || nope "ac2-fixture-postmaster-low"
[ "$(jq -r '.config.team.coachman_legs.synthesis.effort // "MISSING"' "$FR" 2>/dev/null)" = "minimal" ] \
  && pass "ac2-fixture-leg-minimal" || nope "ac2-fixture-leg-minimal"
mkdir -p "$S/disp-warn"
scripts/run-meta.sh "$S/disp-warn" "$S/neutral-name" >"$S/warn.out" 2>"$S/warn.err"
if grep -qF "no-such-harness-xyz" "$S/warn.err" 2>/dev/null; then
  pass "ac2-fixture-warns-on-stderr"
else nope "ac2-fixture-warns-on-stderr"; fi
[ "$(sha256sum "$S/config.toml" | cut -d' ' -f1)" = "$CFG_SHA_BEFORE" ] \
  && pass "ac2-machine-config-untouched" || nope "ac2-machine-config-untouched"

mkdir -p "$S/plain" && git -C "$S/plain" init -q -b main \
  && git -C "$S/plain" commit -q --allow-empty -m first
mkdir -p "$S/disp-ticket"
if scripts/run-meta.sh "$S/disp-ticket" "$S/plain" >"$S/meta-t.out" 2>"$S/meta-t.err"; then
  pass "ac2-record-ticket"
else nope "ac2-record-ticket"; fi
TR="$S/disp-ticket/run.json"
scripts/project-settings.sh effective "$S/plain" "$S/config.toml" > "$S/eff.json" 2>/dev/null
jq -S '.config' "$TR" > "$S/got-config.json" 2>/dev/null
jq -S '.' "$S/eff.json" > "$S/want-config.json" 2>/dev/null
if diff -q "$S/want-config.json" "$S/got-config.json" >/dev/null 2>&1; then
  pass "ac2-ticket-records-effective-unchanged"
else nope "ac2-ticket-records-effective-unchanged"; fi
mkdir -p "$S/disp-quiet"
scripts/run-meta.sh "$S/disp-quiet" "$S/plain" >"$S/quiet.out" 2>"$S/quiet.err"
[ ! -s "$S/quiet.err" ] && pass "ac2-ticket-quiet-on-stderr" || nope "ac2-ticket-quiet-on-stderr"

mkdir -p "$S/some-fixture-thing" && git -C "$S/some-fixture-thing" init -q -b main \
  && git -C "$S/some-fixture-thing" commit -q --allow-empty -m first
mkdir -p "$S/disp-nametrap"
scripts/run-meta.sh "$S/disp-nametrap" "$S/some-fixture-thing" >/dev/null 2>&1
[ "$(jq -r '.config.lanes.sollane.effort // "MISSING"' "$S/disp-nametrap/run.json" 2>/dev/null)" = "max" ] \
  && pass "ac1-name-is-not-the-fact" || nope "ac1-name-is-not-the-fact"

# --- AC3: review runs at the recorded effort --------------------------------------
say "AC3: launch.sh review takes the run's recorded effort"
REV_N=0
run_review() { # <lane> <dispatch>: stubbed review; prints base; sets REVIEW_RC.
  local lane="$1" disp="$2" d base
  REV_N=$((REV_N + 1))
  d="$S/rev-$REV_N"
  mkdir -p "$d" && git -C "$d" init -q -b main
  echo one > "$d/f.txt" && git -C "$d" add -A && git -C "$d" commit -q -m one
  echo two > "$d/f.txt" && git -C "$d" commit -q -am two
  base=$(git -C "$d" rev-parse HEAD~1)
  : > "$ORACLE_STUB_LOG"
  scripts/launch.sh review "$lane" "$d" "$base" --run "$disp" >"$S/review.out" 2>"$S/review.err"
  REVIEW_RC=$?
  REVIEW_BASE="$base"
}
run_review sollane "$S/disp-fixture"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF 'model_reasoning_effort="low"' "$ORACLE_STUB_LOG"; then
  pass "ac3-codex-fixture-low"
else nope "ac3-codex-fixture-low"; fi
run_review sollane "$S/disp-ticket"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF 'model_reasoning_effort="max"' "$ORACLE_STUB_LOG" \
  && ! grep -qF 'model_reasoning_effort="none"' "$ORACLE_STUB_LOG"; then
  pass "ac3-codex-ticket-max"
else nope "ac3-codex-ticket-max"; fi
run_review claudelane "$S/disp-fixture"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF "/code-review low $REVIEW_BASE...HEAD" "$ORACLE_STUB_LOG" \
  && grep -qF -- "--effort low" "$ORACLE_STUB_LOG"; then
  pass "ac3-claude-fixture-low"
else nope "ac3-claude-fixture-low"; fi
run_review claudelane "$S/disp-ticket"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF "/code-review max $REVIEW_BASE...HEAD" "$ORACLE_STUB_LOG" \
  && grep -qF -- "--effort max" "$ORACLE_STUB_LOG" \
  && ! grep -qF -- "--effort low" "$ORACLE_STUB_LOG"; then
  pass "ac3-claude-ticket-max"
else nope "ac3-claude-ticket-max"; fi
run_review mimolane "$S/disp-fixture"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF -- "--variant low" "$ORACLE_STUB_LOG" \
  && ! grep -qF -- "--variant high" "$ORACLE_STUB_LOG"; then
  pass "ac3-mimo-fixture-low"
else nope "ac3-mimo-fixture-low"; fi
run_review mimolane "$S/disp-ticket"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF -- "--variant high" "$ORACLE_STUB_LOG" \
  && ! grep -qF -- "--variant low" "$ORACLE_STUB_LOG"; then
  pass "ac3-mimo-ticket-high"
else nope "ac3-mimo-ticket-high"; fi
run_review plainlane "$S/disp-fixture"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF 'model_reasoning_effort="max"' "$ORACLE_STUB_LOG"; then
  pass "ac3-effortless-fixture-top"
else nope "ac3-effortless-fixture-top"; fi
run_review plainlane "$S/disp-ticket"
if [ "$REVIEW_RC" -eq 0 ] && grep -qF 'model_reasoning_effort="max"' "$ORACLE_STUB_LOG"; then
  pass "ac3-effortless-ticket-top"
else nope "ac3-effortless-ticket-top"; fi
run_review muselane "$S/disp-fixture"
[ "$REVIEW_RC" -eq 3 ] && pass "ac3-no-form-exits-3" || nope "ac3-no-form-exits-3"

# --- AC4: the waybill names the efforts; score checks them ------------------------
say "AC4: run-meta.sh efforts prints the waybill line; fixture.sh score checks it"
EFFORTS_FIX=$(scripts/run-meta.sh efforts "$S/disp-fixture" 2>/dev/null)
EFFORTS_FIX_RC=$?
[ "$EFFORTS_FIX_RC" -eq 0 ] && pass "ac4-efforts-fixture-exit" || nope "ac4-efforts-fixture-exit"
[ "$(printf '%s\n' "$EFFORTS_FIX" | wc -l)" = "1" ] \
  && pass "ac4-efforts-one-line" || nope "ac4-efforts-one-line"
case "$EFFORTS_FIX" in efforts:\ *) pass "ac4-efforts-prefix" ;; *) nope "ac4-efforts-prefix" ;; esac
# The spec pins the pair set, not the separator, so split on commas and spaces alike.
printf '%s\n' "$EFFORTS_FIX" | sed 's/^efforts: *//' | tr ', ' '\n' | grep -v '^$' | sort > "$S/eff-got.txt"
printf '%s\n' \
  "claudelane=low" "coachman=minimal" "coachman.synthesis=minimal" "coachman_fallback=low" \
  "mimolane=low" "muselane=minimal" "sollane=low" "weirdlane=max" \
  | sort > "$S/eff-want.txt"
if diff -q "$S/eff-want.txt" "$S/eff-got.txt" >/dev/null 2>&1; then
  pass "ac4-efforts-fixture-pairs"
else nope "ac4-efforts-fixture-pairs"; fi
if printf '%s\n' "$EFFORTS_FIX" | grep -q postmaster; then
  nope "ac4-efforts-leaves-postmaster-out"
else pass "ac4-efforts-leaves-postmaster-out"; fi
EFFORTS_TICK=$(scripts/run-meta.sh efforts "$S/disp-ticket" 2>/dev/null)
EFFORTS_TICK_RC=$?
[ "$EFFORTS_TICK_RC" -eq 0 ] && pass "ac4-efforts-ticket-exit" || nope "ac4-efforts-ticket-exit"
printf '%s\n' "$EFFORTS_TICK" | sed 's/^efforts: *//' | tr ', ' '\n' | grep -v '^$' | sort > "$S/efft-got.txt"
printf '%s\n' \
  "claudelane=max" "coachman=max" "coachman.synthesis=max" "coachman_fallback=max" \
  "mimolane=high" "muselane=max" "sollane=max" "weirdlane=max" \
  | sort > "$S/efft-want.txt"
if diff -q "$S/efft-want.txt" "$S/efft-got.txt" >/dev/null 2>&1; then
  pass "ac4-efforts-ticket-pairs"
else nope "ac4-efforts-ticket-pairs"; fi

write_brief() { # <dir> <efforts-line> <team-effort>: minimal waybill for score.
  cat > "$1/brief.md" <<EOF
# Waybill: oracle
turnpikes: style, bug, security

## Ticket
oracle brief

## Team
workhorses: sollane=codex/gpt-6-sol-test/$3, mimolane=mimo/testplan/mimo-v2.6-pro/low
reviewers: sollane, mimolane
coachman: muse/muse-spark-coach-test/minimal
$2

## Dispatch
name: oracle
EOF
  cp "$FR" "$1/run.json"
  echo "oracle card" > "$1/card.md"
}
for d in score-ok score-badline score-badteam; do mkdir -p "$S/$d"; done
write_brief "$S/score-ok" "$EFFORTS_FIX" "low"
write_brief "$S/score-badline" "$(printf '%s\n' "$EFFORTS_FIX" | sed 's/sollane=low/sollane=max/')" "low"
write_brief "$S/score-badteam" "$EFFORTS_FIX" "max"
mkdir -p "$S/scorerepo" && git -C "$S/scorerepo" init -q -b main \
  && git -C "$S/scorerepo" commit -q --allow-empty -m first
scripts/fixture.sh score "$S/score-ok" "$S/scorerepo" >"$S/score-ok.out" 2>"$S/score-ok.err"
scripts/fixture.sh score "$S/score-badline" "$S/scorerepo" >"$S/score-badline.out" 2>"$S/score-badline.err"
scripts/fixture.sh score "$S/score-badteam" "$S/scorerepo" >"$S/score-badteam.out" 2>"$S/score-badteam.err"
OK_N=$(grep -c '^ok  ' "$S/score-ok.out" 2>/dev/null || true)
BADLINE_N=$(grep -c '^ok  ' "$S/score-badline.out" 2>/dev/null || true)
BADTEAM_N=$(grep -c '^ok  ' "$S/score-badteam.out" 2>/dev/null || true)
# Report lines are "ok   <name>" (three spaces) or "FAIL <name>" (one space).
TOTAL_OK=$(grep -cE '^(ok  |FAIL )' "$S/score-ok.out" 2>/dev/null || true)
TOTAL_BADLINE=$(grep -cE '^(ok  |FAIL )' "$S/score-badline.out" 2>/dev/null || true)
TOTAL_BADTEAM=$(grep -cE '^(ok  |FAIL )' "$S/score-badteam.out" 2>/dev/null || true)
[ "$TOTAL_OK" = "$TOTAL_BADLINE" ] && [ "$TOTAL_OK" = "$TOTAL_BADTEAM" ] && [ "$TOTAL_OK" -gt 0 ] \
  && pass "ac4-score-same-checks" || nope "ac4-score-same-checks"
[ "$BADLINE_N" -eq "$((OK_N - 1))" ] \
  && pass "ac4-score-fails-line-mismatch" || nope "ac4-score-fails-line-mismatch"
[ "$BADTEAM_N" -eq "$((OK_N - 1))" ] \
  && pass "ac4-score-fails-team-mismatch" || nope "ac4-score-fails-team-mismatch"

# --- AC5: identical commands, both records ----------------------------------------
say "AC5: launch.sh form names the recorded effort"
scripts/launch.sh form sollane --run "$S/disp-fixture" >"$S/form-sol-fix.out" 2>&1
[ "$(grep -cF 'model_reasoning_effort=\"low\"' "$S/form-sol-fix.out")" = "2" ] \
  && pass "ac5-form-sol-fixture-low" || nope "ac5-form-sol-fixture-low"
scripts/launch.sh form sollane --run "$S/disp-ticket" >"$S/form-sol-tick.out" 2>&1
if [ "$(grep -cF 'model_reasoning_effort=\"max\"' "$S/form-sol-tick.out")" = "2" ] \
  && ! grep -qF 'model_reasoning_effort=\"none\"' "$S/form-sol-tick.out"; then
  pass "ac5-form-sol-ticket-max"
else nope "ac5-form-sol-ticket-max"; fi
scripts/launch.sh form mimolane --run "$S/disp-fixture" >"$S/form-mimo-fix.out" 2>&1
[ "$(grep -cF -- '--variant low' "$S/form-mimo-fix.out")" = "2" ] \
  && pass "ac5-form-mimo-fixture-low" || nope "ac5-form-mimo-fixture-low"
scripts/launch.sh form mimolane --run "$S/disp-ticket" >"$S/form-mimo-tick.out" 2>&1
if [ "$(grep -cF -- '--variant high' "$S/form-mimo-tick.out")" = "2" ] \
  && ! grep -qF -- '--variant low' "$S/form-mimo-tick.out"; then
  pass "ac5-form-mimo-ticket-high"
else nope "ac5-form-mimo-ticket-high"; fi
scripts/launch.sh form coachman --leg synthesis --run "$S/disp-fixture" >"$S/form-coach-fix.out" 2>&1
[ "$(grep -cF -- '--reasoning-effort minimal' "$S/form-coach-fix.out")" = "2" ] \
  && pass "ac5-form-coachman-fixture-minimal" || nope "ac5-form-coachman-fixture-minimal"
scripts/launch.sh form coachman --leg synthesis --run "$S/disp-ticket" >"$S/form-coach-tick.out" 2>&1
if [ "$(grep -cF -- '--reasoning-effort max' "$S/form-coach-tick.out")" = "2" ] \
  && ! grep -qF -- '--reasoning-effort minimal' "$S/form-coach-tick.out"; then
  pass "ac5-form-coachman-ticket-max"
else nope "ac5-form-coachman-ticket-max"; fi
say "AC5 review legs are the AC3 probes above, through the identical commands"

echo "oracle-182: $([ "$fail" -eq 0 ] && echo ALL PASS || echo FAILURES PRESENT)"
exit "$fail"
