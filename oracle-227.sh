#!/usr/bin/env bash
# Oracle for #227: blind acceptance tests at the ticket's interface, written before any
# lane's diff was read. Run from the repository root: ./oracle-227.sh
#
# Each check builds a run record in a temporary folder and runs the real
# host.sh close-run and stop-run on it: AC1 with a findings list and a usage
# file beside the review state file, AC2 with the state file replaced by a
# list, AC3 with a non-mapping line in actions.jsonl. The refusal output is
# one `host: ...` line, so naming is asserted by substring.
set -uo pipefail
fails=0
ok() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

[ -f scripts/host.sh ] || {
  fail "oracle-227: run from the repo root: scripts/host.sh not found"
  exit 1
}

tmp=$(mktemp -d) || exit 1
trap 'rm -rf -- "$tmp" 2>/dev/null' EXIT
export POSTMASTER_HOST_CLOSE_WAIT=2

D=$tmp/dispatch
mkdir -p "$tmp/repo/.worktrees/T-1" "$tmp/repo/.worktrees/T-1-mimo" \
  "$tmp/repo/.worktrees/T-1-rev-bug-mimo" "$D/logs"
printf '## Dispatch\nname: T-1\nsynthesis worktree: %s\n' \
  "$tmp/repo/.worktrees/T-1" >"$D/brief.md"
printf '{"config":{"team":{"workhorses":["mimo"]}}}\n' >"$D/run.json"
printf '{"lanes":{"mimo":{}}}\n' >"$D/manifest.json"
printf '{"reviewers":[["bug","mimo"]]}\n' >"$D/logs/review-r1.json"
printf '[{"target":"x.ts:1","severity":"P2","summary":"s"}]\n' \
  >"$D/logs/review-r1-bug-mimo-findings.json"
printf '{"tokens":10,"model":"m"}\n' >"$D/logs/review-r1-bug-mimo-usage.json"
printf '{"action":"note","target":"x"}\n' >"$D/actions.jsonl"

# AC1: a findings list and a usage file beside the state file change nothing.
# actions.jsonl carries no review-launch line, so the reviewer worktree in the
# output proves it was read from review-r1.json.
out=$(scripts/host.sh close-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 0 ] && ok "AC1: close-run exits 0" || fail "AC1: close-run exits 0 (got $rc): $out"
printf '%s' "$out" | grep -qF "T-1-rev-bug-mimo" &&
  ok "AC1: close-run names the reviewer worktree" ||
  fail "AC1: close-run names the reviewer worktree; got: $out"
out=$(scripts/host.sh stop-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 0 ] && ok "AC1: stop-run exits 0" || fail "AC1: stop-run exits 0 (got $rc): $out"
printf '%s' "$out" | grep -qF "T-1-rev-bug-mimo" &&
  ok "AC1: stop-run names the reviewer worktree" ||
  fail "AC1: stop-run names the reviewer worktree; got: $out"

# AC2: a state file that is not a mapping is refused, naming the file.
printf '[{"target":"x.ts:1"}]\n' >"$D/logs/review-r1.json"
out=$(scripts/host.sh close-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 2 ] && ok "AC2: close-run exits 2" || fail "AC2: close-run exits 2 (got $rc): $out"
printf '%s' "$out" | grep -qF "review-r1.json" &&
  ok "AC2: close-run names review-r1.json" ||
  fail "AC2: close-run names review-r1.json; got: $out"
out=$(scripts/host.sh stop-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 2 ] && ok "AC2: stop-run exits 2" || fail "AC2: stop-run exits 2 (got $rc): $out"
printf '%s' "$out" | grep -qF "review-r1.json" &&
  ok "AC2: stop-run names review-r1.json" ||
  fail "AC2: stop-run names review-r1.json; got: $out"

# AC3: a non-mapping actions.jsonl line is refused, naming file and line.
# The bad line sits on line 2, after one valid mapping line.
printf '{"reviewers":[["bug","mimo"]]}\n' >"$D/logs/review-r1.json"
printf '{"action":"note","target":"x"}\n[1]\n' >"$D/actions.jsonl"
out=$(scripts/host.sh close-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 2 ] && ok "AC3: close-run exits 2" || fail "AC3: close-run exits 2 (got $rc): $out"
printf '%s' "$out" | grep -qF "actions.jsonl" &&
  ok "AC3: close-run names actions.jsonl" ||
  fail "AC3: close-run names actions.jsonl; got: $out"
printf '%s' "$out" | grep -qF "2" &&
  ok "AC3: close-run names line 2" ||
  fail "AC3: close-run names line 2; got: $out"
out=$(scripts/host.sh stop-run "$D" 2>&1)
rc=$?
[ "$rc" -eq 2 ] && ok "AC3: stop-run exits 2" || fail "AC3: stop-run exits 2 (got $rc): $out"
printf '%s' "$out" | grep -qF "actions.jsonl" &&
  ok "AC3: stop-run names actions.jsonl" ||
  fail "AC3: stop-run names actions.jsonl; got: $out"
printf '%s' "$out" | grep -qF "2" &&
  ok "AC3: stop-run names line 2" ||
  fail "AC3: stop-run names line 2; got: $out"

echo
[ "$fails" -eq 0 ] && {
  echo "oracle-227: all controls behaved"
  exit 0
}
echo "oracle-227: $fails control(s) misbehaved"
exit 1
