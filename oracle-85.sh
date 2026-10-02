#!/usr/bin/env bash
# Oracle for #85: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's diff, committed as the
# first commit on the ticket branch. It checks properties the ticket names, never
# one phrasing of them: no self-test pipes output into grep -q under pipefail;
# the old pipe form races SIGPIPE on this machine while the herestring form does
# not; and the host.sh and review-round.sh self-tests pass repeated runs while
# four other self-tests run alongside.
#
#   oracle-85.sh [static|race|load]   run from the repo root; exit 0 when the
#                                    worktree meets the ticket, 1 otherwise,
#                                    one line per probe. No argument runs all.
#                                    ORACLE_LOAD_N sets the load rounds (5).
#
# AC1 (causes in the PR text), AC3 (timing controls keep their teeth) and AC4
# (waits end on events) have no generic probe; they are verified by reading plus
# targeted execution at synthesis, and recorded on the checkpoint card.
set -uo pipefail

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
[ -f "$HERE/scripts/host.sh" ] || { echo "oracle: run from the repo root: scripts/host.sh not found" >&2; exit 1; }
grep -qP 'x' <<<"x" 2>/dev/null || { echo "oracle: grep -P (PCRE) is required" >&2; exit 1; }
LOGDIR=${ORACLE_LOG:-$(mktemp -d)}
mkdir -p "$LOGDIR"
fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=1; }

# P1 (AC5): no self-test pipes output into grep -q.
# A literal | into grep with a -q flag (any bundle) or --quiet. Four main-logic
# occurrences are allowlisted below, pinned to their exact file, line and
# content: they are not self-tests. A pin goes stale (and fails loudly, naming
# the line) when its line moves or changes; update the pin then, never broaden
# it to a fragment, which would also exempt a forbidden pipe sharing its line.
# The reproducer that landed is a Python heredoc with no shell pipe line, so it
# needs no exemption. A search-grep failure fails the probe: an unrun probe is
# never a pass.
probe_static() {
  local search_rc
  grep -rPn '(?<!\|)\|(?!\|)\s*e?grep\s+(-[A-Za-z]*q[A-Za-z]*|--quiet)([^A-Za-z]|$)' "$HERE/scripts" 2>/dev/null \
    | grep -v -x -F \
      -e "$HERE/scripts/link-skills.sh:94:  if printf '%s\n' \"\$p\" | grep -q '^in-the-way'; then" \
      -e "$HERE/scripts/probe-trackers.sh:18:elif ! gh auth status 2>&1 | grep -qE \"Token scopes:.*'project'\"; then" \
      -e "$HERE/scripts/host.sh:1582:  printf '%s\n' \"\$help\" | sed -n 's/^ *kinds: //p' | tr '|' '\n' | grep -qxF \"\$1\"" \
      -e "$HERE/scripts/log-action.sh:91:  [ -z \"\$control\" ] || printf '%s\n' \"\$kinds\" | grep -qxF -- \"\$control\" \\" \
    > "$LOGDIR/p1.out"; search_rc=${PIPESTATUS[0]}
  if [ "$search_rc" -gt 1 ]; then
    nope P1-no-pipe-grep-q "probe engine failed (search grep exit $search_rc)"
  elif [ -s "$LOGDIR/p1.out" ]; then
    local sites n
    sites=$(sed "s|$HERE/||; s|^\([^:]*:[0-9]*\):.*|\1|" "$LOGDIR/p1.out" | tr '\n' ' ')
    n=$(wc -l < "$LOGDIR/p1.out")
    nope P1-no-pipe-grep-q "$n self-test pipe(s) into grep -q remain: ${sites:0:1200}"
  else
    pass P1-no-pipe-grep-q "no self-test pipes into grep -q"
  fi
}

# P2 (AC5 control): the old pipe form races SIGPIPE here, the herestring form
# never does. If the old form never fails, the race does not reproduce on this
# machine and the control is vacuous.
probe_race() {
  local i rc old_bad=0 new_bad=0 n=${ORACLE_RACE_N:-10}
  for i in $(seq 1 "$n"); do
    bash -c 'set -o pipefail; seq 1 1000000 | grep -q 5' >/dev/null 2>&1; rc=$?
    [ $rc -eq 0 ] || old_bad=$((old_bad + 1))
    bash -c 'set -o pipefail; out=$(seq 1 1000000); grep -q 5 <<<"$out"' >/dev/null 2>&1; rc=$?
    [ $rc -eq 0 ] || new_bad=$((new_bad + 1))
  done
  if [ "$old_bad" -gt 0 ] && [ "$new_bad" -eq 0 ]; then
    pass P2-race-reproduces "old form failed $old_bad/$n, herestring form 0/$n"
  else
    nope P2-race-reproduces "old form failed $old_bad/$n, herestring form failed $new_bad/$n"
  fi
}

# P3 (AC2, scaled): host.sh and review-round.sh self-tests pass N rounds each
# while four other self-tests run alongside. The full 50-run proof is run once
# on the synthesis; this ranks lanes on the same shape.
probe_load() {
  local n=${ORACLE_LOAD_N:-5} i rc bad=0
  local bg_pids=()
  for i in $(seq 1 "$n"); do
    for s in launch verify ticket-check style-findings; do
      setsid bash -c "cd \"$HERE\" && while true; do scripts/$s.sh --self-test >/dev/null 2>&1; done" & bg_pids+=($!)
    done
    sleep 2  # let the load start before the target runs
    (cd "$HERE" && scripts/host.sh --self-test >"$LOGDIR/host-$i.log" 2>&1); rc=$?
    [ $rc -eq 0 ] || { bad=$((bad + 1)); echo "oracle: round $i host.sh exit $rc, see $LOGDIR/host-$i.log" >&2; }
    (cd "$HERE" && scripts/review-round.sh --self-test >"$LOGDIR/rr-$i.log" 2>&1); rc=$?
    [ $rc -eq 0 ] || { bad=$((bad + 1)); echo "oracle: round $i review-round.sh exit $rc, see $LOGDIR/rr-$i.log" >&2; }
    for p in "${bg_pids[@]}"; do
      kill -KILL -- "-$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')" 2>/dev/null || true
    done
    bg_pids=()
  done
  if [ "$bad" -eq 0 ]; then
    pass P3-timing-under-load "$n/$n rounds green under load (logs in $LOGDIR)"
  else
    nope P3-timing-under-load "$bad target run(s) failed over $n rounds (logs in $LOGDIR)"
  fi
}

case "${1:-all}" in
  static) probe_static ;;
  race) probe_race ;;
  load) probe_load ;;
  all) probe_static; probe_race; probe_load ;;
  *) echo "usage: oracle-85.sh [static|race|load|all]" >&2; exit 2 ;;
esac
[ "$fail" -eq 0 ]
