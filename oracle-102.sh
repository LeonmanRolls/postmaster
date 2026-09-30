#!/usr/bin/env bash
# Oracle for #102: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's spec or diff,
# committed as the first commit on the ticket branch. It launches trivial
# commands through the worktree's own scripts/host.sh run on each of the
# three hosts and checks the environment the launch sees: none of the
# caller's Claude Code session variables (AC1), none of the caller's Herdr
# variables (AC2), everything else intact (AC3). The live claude probe
# checks the session record and resume (AC4). The self-test probe runs
# host.sh --self-test and checks it covers each criterion (AC5).
#
#   oracle-102.sh [env|selftest|live|all|full]   run from the repo root;
#     env       AC1-AC3 on herdr, tmux and none (default with all)
#     selftest  AC5: self-test green and naming each criterion's variables
#     live      AC4: headless claude through host.sh run writes its record
#               under the streamed thread id, and a resume continues it
#     all       env + selftest (the cheap lane-ranking set)
#     full      env + selftest + live
#   Exit 0 when the worktree meets the ticket, 1 otherwise, one line per
#   probe. ORACLE_WAIT sets the marker wait in seconds (120); ORACLE_LIVE_WAIT
#   the live wait (600). The live probe writes two tiny sessions into the
#   user's real ~/.claude store, like any claude run, and needs working
#   claude credentials.
#
# Verified by reading plus targeted execution at synthesis, and recorded on
# the checkpoint card: the lane's env file reaching the launch (AC3), which
# the run's own mimo lane is the live positive control for; and whether
# each self-test check carries a positive and a negative control (AC5),
# which no blind grep can judge.
set -uo pipefail

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
HS="$HERE/scripts/host.sh"
[ -x "$HS" ] || { echo "oracle: run from the repo root: scripts/host.sh not found" >&2; exit 1; }
LOGDIR=${ORACLE_LOG:-$(mktemp -d)}
mkdir -p "$LOGDIR"
WAIT=${ORACLE_WAIT:-120}
LIVE_WAIT=${ORACLE_LIVE_WAIT:-600}
LEAK=oracle-leak-9z          # caller-identity sentinel: must never reach a launch
PASSV=oracle-passthru-9z     # pass-through sentinel: must always reach a launch
fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=1; }

# The caller's Claude Code session identity, as the approved spec lists it:
# exact names plus one synthetic probe per identity family (SESSION_*,
# MESSAGING_*, CHILD_*), so a family the filter misses fails. Config under
# the same prefix is NOT here: AC3 keeps it, and PASS_NAMES asserts it arrives.
# (Written blind with a wider set; narrowed to this list by the postmaster's
# spec ruling, before any implementation was read. Review restored
# CLAUDE_CODE_TOOL_USE_ID: the blind probe found it set in a calling session,
# and nothing configures a harness with its caller's tool-use id.)
CLAUDE_STRIP="CLAUDECODE CLAUDE_PID CLAUDE_CODE_SESSION_ID CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_TOOL_USE_ID CLAUDE_CODE_SESSION_PROBE_X CLAUDE_CODE_MESSAGING_PROBE_X CLAUDE_CODE_CHILD_PROBE_X"
HERDR_STRIP="HERDR_SOCKET_PATH HERDR_BIN_PATH HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID"
# Pass-through: a POSTMASTER_ setting, a generic caller variable, a harness's
# own configuration (config directory and endpoint), and configuration under
# the CLAUDE_CODE_ prefix, which the identity strip must not take.
PASS_NAMES="POSTMASTER_ORACLE_MARK MARK_CALLER_VAR CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY"

wait_marker() { # <marker> <seconds>
  local i=0
  while [ "$i" -lt "$2" ]; do
    [ -f "$1" ] && return 0
    sleep 2; i=$((i + 2))
  done
  [ -f "$1" ]
}

# close_probe <runout>: best-effort close of one probe's own placement, from
# the exact handle its run printed. host.sh close/stop take a worktree and
# refuse while this run's own coachman is registered there, so the oracle
# closes only what it opened. Never fails the probe: litter, not a verdict.
close_probe() {
  local runout=$1 h
  case $runout in
    host=tmux*)
      h=$(printf '%s' "$runout" | sed -n 's/.*window=\([^ ]*\).*/\1/p')
      [ -n "$h" ] && tmux kill-window -t "$h" >/dev/null 2>&1 ;;
    host=herdr*)
      h=$(printf '%s' "$runout" | sed -n 's/.*tab=\([^ ]*\).*/\1/p')
      [ -n "$h" ] && herdr tab close "$h" >/dev/null 2>&1 ;;
  esac
  return 0
}

# stop_pidfile <pidfile>: TERM then KILL one recorded pid. host.sh stop is the
# thorough form, but it refuses to run from inside the worktree, which is where
# this script runs from; the pidfile's single pid is enough for a stuck probe.
stop_pidfile() {
  local pid
  [ -f "$1" ] || return 0
  pid=$(cat "$1" 2>/dev/null) || return 0
  case $pid in ''|*[!0-9]*) return 0 ;; esac
  kill -0 "$pid" 2>/dev/null || return 0
  kill "$pid" 2>/dev/null
  local i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 5 ]; do sleep 1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  return 0
}

ORACLE_LAUNCHES=""   # "pidfile:marker" pairs, reaped at exit when unlanded
track_launch() { ORACLE_LAUNCHES="$ORACLE_LAUNCHES $1:$2"; }
cleanup_launches() {
  local pair pidfile marker
  for pair in $ORACLE_LAUNCHES; do
    pidfile=${pair%%:*}; marker=${pair#*:}
    [ -f "$marker" ] || stop_pidfile "$pidfile"
  done
}
trap cleanup_launches EXIT

# probe_env <host>: run `env` through host.sh run with a caller environment
# carrying sentinel identity variables, and check what the launch saw.
probe_env() {
  local host=$1 tag
  tag="P-env-$host"
  local t out err marker runout
  t=$(mktemp -d); out=$t/out; err=$t/err; marker=$t/done
  local caller_env=()
  case $host in
    herdr) ;;
    tmux|none) caller_env+=(POSTMASTER_HOST=$host) ;;
    *) nope "$tag" "unknown host $host"; return ;;
  esac
  caller_env+=(CLAUDECODE=$LEAK-s0 CLAUDE_PID=$LEAK-s1
    CLAUDE_CODE_SESSION_ID=$LEAK-s2 CLAUDE_CODE_CHILD_SESSION=$LEAK-s3
    CLAUDE_CODE_ENTRYPOINT=$LEAK-s4 CLAUDE_CODE_EXECPATH=$LEAK-s5
    CLAUDE_CODE_SESSION_ATTENDED=$LEAK-s6 CLAUDE_CODE_MESSAGING_SOCKET=$LEAK-s7
    CLAUDE_CODE_MESSAGING_TOKEN=$LEAK-s8 CLAUDE_CODE_TOOL_USE_ID=$LEAK-s9
    CLAUDE_CODE_SESSION_PROBE_X=$LEAK-s10
    CLAUDE_CODE_MESSAGING_PROBE_X=$LEAK-s11 CLAUDE_CODE_CHILD_PROBE_X=$LEAK-s12)
  case $host in
    herdr)
      # The six stay real so host.sh can place the launch; this synthetic
      # non-six sentinel is what catches a broken HERDR_* family match on the
      # host that matters. Nothing reads it for placement.
      caller_env+=(HERDR_CUSTOM=$LEAK-h6) ;;
    tmux|none)
      caller_env+=(HERDR_SOCKET_PATH=$LEAK-h0 HERDR_BIN_PATH=$LEAK-h1 HERDR_ENV=$LEAK-h2
        HERDR_PANE_ID=$LEAK-h3 HERDR_TAB_ID=$LEAK-h4 HERDR_WORKSPACE_ID=$LEAK-h5) ;;
  esac
  caller_env+=(POSTMASTER_ORACLE_MARK=$PASSV MARK_CALLER_VAR=$PASSV
    CLAUDE_CONFIG_DIR=$PASSV-claude ANTHROPIC_BASE_URL=$PASSV-endpoint ANTHROPIC_AUTH_TOKEN=$PASSV-token
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=$PASSV-ceiling CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=$PASSV-survey)
  runout=$(cd "$HERE" && env "${caller_env[@]}" \
    "$HS" run "oracle-102-$host" "$HERE" --out "$out" --err "$err" --marker "$marker" -- env 2>"$t/run.err");
  local rc=$?
  [ $rc -eq 0 ] || { nope "$tag" "host.sh run exited $rc: $(cat "$t/run.err")"; close_probe "$runout"; return; }
  case "$runout" in host="$host"*) ;; *) nope "$tag" "launch did not place on $host: $runout $(cat "$t/run.err")"; close_probe "$runout"; return ;; esac
  wait_marker "$marker" "$WAIT" || { nope "$tag" "no marker in ${WAIT}s"; close_probe "$runout"; return; }
  [ -s "$out" ] || { nope "$tag" "empty launch environment"; close_probe "$runout"; return; }
  local bad=0 detail=""
  if grep -q "$LEAK" "$out"; then
    bad=1; detail="caller identity leaked: $(grep "$LEAK" "$out" | cut -d= -f1 | tr '\n' ' ')"
  fi
  local n
  for n in $CLAUDE_STRIP; do
    if grep -q "^$n=" "$out"; then bad=1; detail="$detail caller $n present;";
    fi
  done
  case $host in
    tmux|none)
      for n in $HERDR_STRIP; do
        if grep -q "^$n=" "$out"; then bad=1; detail="$detail caller $n present;"; fi
      done
      if grep -q "^HERDR_" "$out"; then bad=1; detail="$detail HERDR_* present on $host;"; fi
      ;;
    herdr)
      local launched_pane launched_tab
      launched_pane=$(grep "^HERDR_PANE_ID=" "$out" | cut -d= -f2)
      launched_tab=$(grep "^HERDR_TAB_ID=" "$out" | cut -d= -f2)
      if [ -z "$launched_pane" ] || [ "$launched_pane" = "${HERDR_PANE_ID:-}" ]; then
        bad=1; detail="$detail pane id is not the pane's own;"
      fi
      if [ -z "$launched_tab" ] || [ "$launched_tab" = "${HERDR_TAB_ID:-}" ]; then
        bad=1; detail="$detail tab id is not the pane's own;"
      fi
      if grep -q "^HERDR_CUSTOM=" "$out"; then bad=1; detail="$detail caller HERDR_CUSTOM present;"; fi
      ;;
  esac
  case $host in
    tmux)
      grep -q "^TMUX_PANE=.\+" "$out" || { bad=1; detail="$detail no pane TMUX_PANE;"; }
      ;;
    none)
      grep -q "^TMUX_PANE=" "$out" && { bad=1; detail="$detail TMUX_PANE present on none;"; }
      ;;
  esac
  for n in $PASS_NAMES; do
    grep -q "^$n=$PASSV" "$out" || { bad=1; detail="$detail $n did not pass through;"; }
  done
  close_probe "$runout"
  if [ "$bad" -eq 0 ]; then
    rm -rf "$t"   # the dump held the whole launch environment; a pass keeps no copy
    pass "$tag" "no caller identity, pass-through intact"
  else
    nope "$tag" "$detail (env in $out)"
  fi
}

probe_env_all() {
  # The herdr probe keeps the real six so host.sh can place the launch, plus
  # one synthetic non-six sentinel; the tmux and none probes fake the six,
  # since placement needs none of them.
  probe_env herdr
  probe_env tmux
  probe_env none
}

# probe_selftest (AC5): the self-test passes, its per-criterion controls ran on
# every host, and the strip names live in the controls' own section. A grep
# over the whole script cannot show that: the names also appear in the filter,
# the header and the stubs, so the assertions could be deleted and it would
# still pass. Control quality (a positive and a negative control per
# criterion) is judged by reading at synthesis.
probe_selftest() {
  local tag="P-selftest"
  (cd "$HERE" && "$HS" --self-test >"$LOGDIR/selftest.log" 2>&1) || {
    nope "$tag" "host.sh --self-test exits nonzero (log in $LOGDIR/selftest.log)"; return; }
  local missing="" ac host v
  for ac in AC1 AC2 AC3 AC4; do
    for host in herdr tmux none; do
      grep -q "$ac $host" "$LOGDIR/selftest.log" || missing="$missing $ac/$host"
    done
  done
  local section
  section=$(sed -n '/run environment identity/,/finish self-test/p' "$HS")
  [ -n "$section" ] || missing="$missing identity-section"
  for v in $CLAUDE_STRIP; do
    case $v in *_PROBE_X) continue ;; esac   # the oracle's own family probes
    grep -q "$v" <<<"$section" || missing="$missing $v"
  done
  for v in CLAUDE_CODE_SESSION_EXTRA CLAUDE_CODE_MESSAGING_EXTRA CLAUDE_CODE_CHILD_EXTRA HERDR_CUSTOM; do
    grep -q "$v" <<<"$section" || missing="$missing $v"
  done
  for v in $HERDR_STRIP POSTMASTER_CUSTOM ANTHROPIC_BASE_URL; do
    grep -q "$v" <<<"$section" || missing="$missing $v"
  done
  if [ -n "$missing" ]; then
    nope "$tag" "self-test ran short of:$missing (log in $LOGDIR/selftest.log)"
  else
    pass "$tag" "self-test green, AC1-AC4 ran on every host, strip names in the controls"
  fi
}

claude_sid() { grep -o '"session_id":"[^"]*"' "$1" 2>/dev/null | head -1 | cut -d'"' -f4; }

# probe_live (AC4): a headless claude launched through host.sh run from a
# caller carrying Claude Code session variables writes its session record
# under the thread id its stream names, and a resume continues that thread.
probe_live() {
  local tag="P-live-claude"
  command -v claude >/dev/null 2>&1 || { nope "$tag" "claude not on PATH"; return; }
  local t sid
  t=$(mktemp -d)
  POSTMASTER_HOST=none \
    CLAUDECODE=$LEAK-s0 CLAUDE_CODE_SESSION_ID=$LEAK-s1 \
    CLAUDE_CODE_CHILD_SESSION=$LEAK-s2 CLAUDE_CODE_ENTRYPOINT=$LEAK-s3 \
    CLAUDE_CODE_MESSAGING_SOCKET=$LEAK-s4 CLAUDE_CODE_MESSAGING_TOKEN=$LEAK-s5 \
    CLAUDE_CODE_EXECPATH=$LEAK-s6 CLAUDE_CODE_SESSION_ATTENDED=$LEAK-s7 \
    CLAUDE_PID=$LEAK-s8 CLAUDE_CODE_TOOL_USE_ID=$LEAK-s9 \
    "$HS" run "oracle-102-live" "$HERE" --out "$t/stream1" --err "$t/err1" --marker "$t/done1" \
    --pidfile "$t/pid1" \
    -- claude -p "Reply with exactly: ORACLE-LIVE-ONE" --output-format stream-json --verbose --dangerously-skip-permissions \
    >"$t/run1.out" 2>&1 || { nope "$tag" "launch failed: $(cat "$t/run1.out" "$t/err1" 2>/dev/null)"; return; }
  track_launch "$t/pid1" "$t/done1"
  wait_marker "$t/done1" "$LIVE_WAIT" || { nope "$tag" "first turn: no marker in ${LIVE_WAIT}s"; stop_pidfile "$t/pid1"; return; }
  sid=$(claude_sid "$t/stream1")
  [ -n "$sid" ] || { nope "$tag" "first turn: no session_id in stream"; return; }
  grep -q '"type":"assistant"' "$t/stream1" || { nope "$tag" "first turn: no assistant message"; return; }
  local record store
  store=${CLAUDE_CONFIG_DIR:-$HOME/.claude}   # the launch keeps it, so claude writes there
  record=$(ls "$store"/projects/*/"$sid.jsonl" 2>/dev/null | head -1)
  [ -n "$record" ] && [ -s "$record" ] || { nope "$tag" "no session record for streamed $sid"; return; }
  POSTMASTER_HOST=none \
    CLAUDECODE=$LEAK-s0 CLAUDE_CODE_SESSION_ID=$LEAK-s1 \
    CLAUDE_CODE_CHILD_SESSION=$LEAK-s2 CLAUDE_CODE_ENTRYPOINT=$LEAK-s3 \
    CLAUDE_CODE_MESSAGING_SOCKET=$LEAK-s4 CLAUDE_CODE_MESSAGING_TOKEN=$LEAK-s5 \
    CLAUDE_CODE_EXECPATH=$LEAK-s6 CLAUDE_CODE_SESSION_ATTENDED=$LEAK-s7 \
    CLAUDE_PID=$LEAK-s8 CLAUDE_CODE_TOOL_USE_ID=$LEAK-s9 \
    "$HS" run "oracle-102-resume" "$HERE" --out "$t/stream2" --err "$t/err2" --marker "$t/done2" \
    --pidfile "$t/pid2" \
    -- claude -p --resume "$sid" "Reply with exactly: ORACLE-LIVE-TWO" --output-format stream-json --verbose --dangerously-skip-permissions \
    >"$t/run2.out" 2>&1 || { nope "$tag" "resume launch failed: $(cat "$t/run2.out" "$t/err2" 2>/dev/null)"; return; }
  track_launch "$t/pid2" "$t/done2"
  wait_marker "$t/done2" "$LIVE_WAIT" || { nope "$tag" "resume: no marker in ${LIVE_WAIT}s"; stop_pidfile "$t/pid2"; return; }
  local sid2
  sid2=$(claude_sid "$t/stream2")
  [ "$sid2" = "$sid" ] || { nope "$tag" "resume continued $sid2, not $sid"; return; }
  grep -q '"type":"assistant"' "$t/stream2" || { nope "$tag" "resume: no assistant message"; return; }
  rm -rf "$t"
  pass "$tag" "record under $sid and resume continued it"
}

case "${1:-all}" in
  env) probe_env_all ;;
  selftest) probe_selftest ;;
  live) probe_live ;;
  all) probe_env_all; probe_selftest ;;
  full) probe_env_all; probe_selftest; probe_live ;;
  *) echo "usage: oracle-102.sh [env|selftest|live|all|full]" >&2; exit 2 ;;
esac
[ "$fail" -eq 0 ]
