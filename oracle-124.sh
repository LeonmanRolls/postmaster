#!/usr/bin/env bash
# Oracle for #124: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's diff, committed as the
# first commit on the ticket branch. The legs-output expectations are the blind
# part. The dispatch fixtures were updated at synthesis to the decided run
# format both lanes converged on (an explicit new-run marker, absent on runs
# dispatched before the change); the synthesis took run.json coachman_contract.
# The legs --line cases need no fixture and are format-independent.
#
#   oracle-124.sh            run from the repo root; exit 0 when the worktree's
#                            script meets the ticket, 1 otherwise
set -uo pipefail
BASE_SHA=6e9f87cc776c0769ab099400087ca3a33a9ca770
NEW=scripts/turnpikes.sh
[ -f "$NEW" ] || { echo "oracle: run from the repo root: $NEW not found" >&2; exit 1; }
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
BASE_SCRIPT=$tmp/turnpikes-base.sh
git show "$BASE_SHA:scripts/turnpikes.sh" > "$BASE_SCRIPT" 2>/dev/null \
  || { echo "oracle: cannot read BASE $BASE_SHA:scripts/turnpikes.sh" >&2; exit 1; }
waybill() {  # waybill <dispatch> <the turnpikes: line> [new|old: run.json contract, default new]
  mkdir -p "$1"
  { printf '# Waybill: T-1\n%s\n\n## Ticket\n## Problem / feature\nA change.\n\n' "$2"
    printf '## Dispatch\nname: #1, A change\ndispatch: %s\ntool: /t\n' "$1"; } > "$1/brief.md"
  if [ "${3:-new}" = new ]; then printf '{"coachman_contract": 2}\n' > "$1/run.json"; fi
}
waybill "$tmp/default" "turnpikes: style, bug, security"
waybill "$tmp/one" "turnpikes: style"
waybill "$tmp/none" "turnpikes: none"
waybill "$tmp/old" "turnpikes: style, bug, security" old
waybill "$tmp/old-one" "turnpikes: none" old
fails=0
check() {  # check <label> <script> <dispatch> <want, \n-separated> <want-pass: 1|0>
  local got= rc=0
  got=$(bash "$2" legs "$3" 2>&1) || rc=$?
  local pass=0; [ "$rc" -eq 0 ] && [ "$got" = "$(printf '%b' "$4")" ] && pass=1
  if [ "$pass" -eq "$5" ]; then printf 'ok   %s\n' "$1"
  else printf 'FAIL %s (wanted %s):\n--- wanted output ---\n%b\n--- got (exit %s) ---\n%s\n' \
      "$1" "$([ "$5" -eq 1 ] && echo pass || echo fail)" "$4" "$rc" "$got"; fails=$((fails+1)); fi
}
check_line() {  # check_line <label> <script> <turnpikes line> <want> <want-pass>
  local got= rc=0
  got=$(bash "$2" legs --line "$3" 2>&1) || rc=$?
  local pass=0; [ "$rc" -eq 0 ] && [ "$got" = "$(printf '%b' "$4")" ] && pass=1
  if [ "$pass" -eq "$5" ]; then printf 'ok   %s\n' "$1"
  else printf 'FAIL %s (wanted %s):\n--- wanted output ---\n%b\n--- got (exit %s) ---\n%s\n' \
      "$1" "$([ "$5" -eq 1 ] && echo pass || echo fail)" "$4" "$rc" "$got"; fails=$((fails+1)); fi
}
D12='1 synthesis\n2 review style bug security'
D1='1 synthesis\n2 review style'
D0='1 synthesis'
L12='1 synthesis\n2 review style bug security\n3 ship'
L0='1 synthesis\n3 ship'
echo "new script: fresh runs list no ship leg"
check "AC1+AC5: default turnpikes list synthesis and review only" "$NEW" "$tmp/default" "$D12" 1
check "AC5: one review turnpike still lists synthesis and review only" "$NEW" "$tmp/one" "$D1" 1
check "AC3+AC5: no turnpikes list synthesis only" "$NEW" "$tmp/none" "$D0" 1
check_line "AC5: legs --line lists the current two-leg schedule" "$NEW" "turnpikes: security" '1 synthesis\n2 review security' 1
check_line "AC5: legs --line lists the current one-leg schedule" "$NEW" "turnpikes: none" "$D0" 1
echo "new script: a run dispatched before the change keeps its three legs"
check "AC5: a legacy run with review keeps all three legs" "$NEW" "$tmp/old" "$L12" 1
check "AC5: a legacy run without review keeps synthesis and ship" "$NEW" "$tmp/old-one" "$L0" 1
echo "BASE script: the new-schedule cases fail (negative control)"
check "BASE still lists a ship leg for default turnpikes" "$BASE_SCRIPT" "$tmp/default" "$D12" 0
check "BASE still lists a ship leg for no turnpikes" "$BASE_SCRIPT" "$tmp/none" "$D0" 0
echo
if [ "$fails" -eq 0 ]; then echo "oracle: all cases behaved"; exit 0; fi
echo "oracle: $fails case(s) misbehaved"; exit 1
