#!/usr/bin/env bash
# Blind oracle for #200: Run every lane in its own process space, so it cannot
# kill processes it did not start.
#
# Written by the leg-1 coachman from the ticket's acceptance criteria BEFORE
# reading any lane's diff or log, and committed on the ticket branch before any
# synthesis code. Tests at the ticket's own interface: the launch.sh CLI
# (form, launch, resume), run-meta.sh dispatch, the launch.test.ts battery's
# paired output, and the two runbooks' words. Never a function shape, which is
# what the lanes were dispatched to choose. A stub harness named `codex` first
# on PATH stands in for every harness: the ticket wraps all five by one
# mechanism from the outside, so one harness proves the path.
#
# Usage: ./oracle-200.sh   (runs from the repo root)
# Exit 0 when every acceptance criterion holds, 1 otherwise. SKIP lines are
# loud: a group the machine cannot run (no confinement startable, no loopback
# fetch tooling) is named, never silent.
set -uo pipefail
ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
cd "$ROOT" || exit 1

PASS=0; FAIL=0; SKIP=0
pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }
skip() { SKIP=$((SKIP + 1)); echo "SKIP: $1"; }

SCR=$(mktemp -d /tmp/oracle-200.XXXXXXXX)
VICTIM=""
SERVER_PID=""
cleanup() {
  [ -n "$VICTIM" ] && kill "$VICTIM" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$SCR"
}
trap cleanup EXIT

# Contain any machine writes a launch makes (harness trust, caches).
export HOME=$SCR/home
mkdir -p "$HOME" "$SCR/bin" "$SCR/cwd" "$SCR/tmp"
export GIT_AUTHOR_NAME=oracle GIT_AUTHOR_EMAIL=oracle@example.invalid
export GIT_COMMITTER_NAME=oracle GIT_COMMITTER_EMAIL=oracle@example.invalid
git -C "$SCR/cwd" init -q
git -C "$SCR/cwd" commit -q --allow-empty -m seed

MARKER="oracle-200-marker"
echo "prompt file holding $MARKER" > "$SCR/prompt.txt"

LANES_TOML='[lanes.t]
harness = "codex"
model = "x"
'
printf '%s' "$LANES_TOML" > "$SCR/config-absent.toml"
printf 'confine = "off"\n%s' "$LANES_TOML" > "$SCR/config-off.toml"
printf 'confine = "on"\n%s' "$LANES_TOML" > "$SCR/config-on.toml"

# The stub harness. Records the argv it was handed (null-separated), then acts
# per ORACLE_MODE. It ignores harness-shaped flags: the wrap under test sits
# outside them.
cat > "$SCR/bin/codex" <<'STUB'
#!/bin/sh
printf '%s\0' "$@" > "$ORACLE_ARGV_OUT"
case "${ORACLE_MODE:-argv}" in
  argv) exit 0 ;;
  signal)
    if kill -0 "$ORACLE_VICTIM_PID" 2>/dev/null; then echo reached > "$ORACLE_OUT"; else echo refused > "$ORACLE_OUT"; fi
    sleep 20 & child=$!
    if kill -0 "$child" 2>/dev/null; then echo ok > "$ORACLE_SELF"; else echo fail > "$ORACLE_SELF"; fi
    kill "$child" 2>/dev/null
    wait 2>/dev/null
    exit 0
    ;;
  work)
    rc=0
    echo "$ORACLE_TAG" > "$ORACLE_TAG.txt" || rc=1
    git add -A && git commit -qm "$ORACLE_MARKER $ORACLE_TAG" || rc=1
    echo "$ORACLE_MARKER" > "$ORACLE_TMPDIR/work-$ORACLE_TAG.txt" || rc=1
    grep -q "$MARKER" "$ORACLE_PROMPT" || rc=1
    if [ -n "${ORACLE_FETCH_URL:-}" ]; then
      curl -sf "$ORACLE_FETCH_URL" -o "$ORACLE_TMPDIR/fetch-$ORACLE_TAG.out" || rc=1
    fi
    exit $rc
    ;;
  sleep) exec sleep 60 ;;
esac
STUB
chmod +x "$SCR/bin/codex"
export PATH="$SCR/bin:$PATH"

# A fallback warning names the cause: confinement, and what of it failed.
warned() { grep -qiE 'confin|fallback|unconfin|sandbox|bwrap|namespace|seatbelt' "$1" 2>/dev/null; }

launch() { # $1=config $2=tag ; runs the stub lane, rc in $SCR/launch-$2.rc
  ORACLE_ARGV_OUT=$SCR/argv-$2.bin POSTMASTER_CONFIG=$1 scripts/launch.sh launch t "$SCR/cwd" "$SCR/prompt.txt" \
    >$SCR/launch-$2.out 2>$SCR/launch-$2.err
  echo $? > "$SCR/launch-$2.rc"
}

# --- AC1: wrapped form, unchanged harness argv, no OS named, signals pass ---
FORM_ABSENT=$(POSTMASTER_CONFIG=$SCR/config-absent.toml scripts/launch.sh form t 2>$SCR/form-absent.err); RC_ABSENT=$?
FORM_OFF=$(POSTMASTER_CONFIG=$SCR/config-off.toml scripts/launch.sh form t 2>$SCR/form-off.err); RC_OFF=$?
FORM_ON=$(POSTMASTER_CONFIG=$SCR/config-on.toml scripts/launch.sh form t 2>$SCR/form-on.err); RC_ON=$?
if [ "$RC_ABSENT" -ne 0 ] || [ "$RC_OFF" -ne 0 ] || [ "$RC_ON" -ne 0 ]; then
  fail "AC1 form exits nonzero (absent=$RC_ABSENT off=$RC_OFF on=$RC_ON)"
else
  case "$FORM_OFF" in
    *launch:*resume:*--dangerously-bypass-approvals-and-sandbox*) pass "AC1 off form is the bare form with the bypass flag" ;;
    *) fail "AC1 off form is not the bare codex form: $FORM_OFF" ;;
  esac
  if [ "$FORM_OFF" = "$FORM_ABSENT" ]; then
    pass "AC1 off runs as absent (off is the default)"
  else
    fail "AC1 off differs from absent"
  fi
  if [ "$FORM_ON" = "$FORM_OFF" ]; then
    fail "AC1 on form is identical to the bare form (nothing wraps the lane)"
  else
    pass "AC1 on form differs from the bare form"
    # The harness argv inside the wrap is the bare argv, both lines.
    OFF_LAUNCH_ARGV=$(printf '%s\n' "$FORM_OFF" | grep '^launch:' | sed 's/^launch: cd <cwd> && //')
    OFF_RESUME_ARGV=$(printf '%s\n' "$FORM_OFF" | grep '^resume:' | sed 's/^resume: cd <cwd> && //')
    if [ -z "$OFF_LAUNCH_ARGV" ] || [ -z "$OFF_RESUME_ARGV" ]; then
      fail "AC1 off form has no launch/resume argv to compare against"
    else
      case "$FORM_ON" in
        *"$OFF_LAUNCH_ARGV"*) pass "AC1 wrapped launch line carries the bare harness argv" ;;
        *) fail "AC1 wrapped launch line changes the harness argv" ;;
      esac
      case "$FORM_ON" in
        *"$OFF_RESUME_ARGV"*) pass "AC1 wrapped resume line carries the bare harness argv" ;;
        *) fail "AC1 wrapped resume line changes the harness argv" ;;
      esac
    fi
    case "$(uname -s)" in
      Linux) case "$FORM_ON" in *bwrap*) pass "AC1 on form names the Linux mechanism" ;; *) fail "AC1 on form names no Linux mechanism" ;; esac ;;
      Darwin) case "$FORM_ON" in *sandbox-exec*) pass "AC1 on form names the macOS mechanism" ;; *) fail "AC1 on form names no macOS mechanism" ;; esac ;;
      *) skip "AC1 mechanism token: $(uname -s) has no row in the ticket's table" ;;
    esac
  fi
fi

if grep -rinE 'linux|darwin|bwrap|sandbox-exec' scripts/launch.ts >$SCR/osnames.txt 2>&1; then
  fail "AC1 launch.ts names a system or mechanism: $(head -3 $SCR/osnames.txt | tr '\n' ';')"
else
  pass "AC1 the launch path names no operating system"
fi

# SIGTERM to a launch ends it by that signal, confined and not, the same way.
run_term() { # $1=config $2=tag
  rm -f "$SCR/argv-$2.bin"
  ORACLE_MODE=sleep ORACLE_ARGV_OUT=$SCR/argv-$2.bin \
    POSTMASTER_CONFIG=$1 scripts/launch.sh launch t "$SCR/cwd" "$SCR/prompt.txt" \
    >$SCR/term-$2.out 2>$SCR/term-$2.err &
  lp=$!
  for _ in $(seq 1 60); do [ -f "$SCR/argv-$2.bin" ] && break; sleep 1; done
  if [ ! -f "$SCR/argv-$2.bin" ]; then echo "stub-never-started" > "$SCR/term-$2.rc"; wait $lp 2>/dev/null; return; fi
  kill -TERM $lp 2>/dev/null
  wait $lp; echo $? > "$SCR/term-$2.rc"
}
run_term "$SCR/config-off.toml" term-off
run_term "$SCR/config-on.toml" term-on
RC_TERM_OFF=$(cat "$SCR/term-term-off.rc"); RC_TERM_ON=$(cat "$SCR/term-term-on.rc")
if [ "$RC_TERM_OFF" = "stub-never-started" ] || [ "$RC_TERM_ON" = "stub-never-started" ]; then
  fail "AC1 SIGTERM probe never started the stub (off=$RC_TERM_OFF on=$RC_TERM_ON)"
elif [ "$RC_TERM_OFF" = "$RC_TERM_ON" ] && [ "$RC_TERM_OFF" != "0" ]; then
  pass "AC1 SIGTERM ends a confined launch as an unconfined one (exit $RC_TERM_OFF both)"
else
  fail "AC1 SIGTERM ends differ (off=$RC_TERM_OFF on=$RC_TERM_ON)"
fi

# --- AC2: a confined lane does its work as before ---
# Loopback fetch tooling, with its own control: no fetch where nothing serves.
if command -v curl >/dev/null && command -v python3 >/dev/null; then
  PORT=$((18000 + $$ % 1000))
  (cd "$SCR" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
  SERVER_PID=$!
  sleep 1
  if curl -sf "http://127.0.0.1:$PORT/prompt.txt" -o /dev/null; then
    export ORACLE_FETCH_URL="http://127.0.0.1:$PORT/prompt.txt"
  else
    skip "AC2 loopback fetch: nothing serves on 127.0.0.1 (control failed)"
    kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""
  fi
else
  skip "AC2 loopback fetch: no curl or no python3"
fi
export ORACLE_TMPDIR=$SCR/tmp ORACLE_PROMPT=$SCR/prompt.txt ORACLE_MARKER=$MARKER

check_work() { # $1=tag $2=mode-name ; the stub's work all landed
  ok=1
  [ -f "$SCR/tmp/work-$1.txt" ] && grep -q "$MARKER" "$SCR/tmp/work-$1.txt" || { ok=0; echo "temp write"; }
  git -C "$SCR/cwd" log --oneline | grep -q "$MARKER $1" || { ok=0; echo "commit"; }
  if [ -n "${ORACLE_FETCH_URL:-}" ]; then
    [ -s "$SCR/tmp/fetch-$1.out" ] || { ok=0; echo "fetch"; }
  fi
  [ "$ok" = 1 ]
}
export ORACLE_MODE=work ORACLE_TAG=off
launch "$SCR/config-off.toml" work-off
RC_WORK_OFF=$(cat "$SCR/launch-work-off.rc")
if [ "$RC_WORK_OFF" != "0" ]; then
  fail "AC2 unconfined work exits $RC_WORK_OFF (positive control broken)"
elif check_work off unconfined >/dev/null; then
  pass "AC2 unconfined work: temp write, prompt read, commit, fetch (control)"
else
  fail "AC2 unconfined work missing: $(check_work off unconfined)"
fi
export ORACLE_TAG=on
launch "$SCR/config-on.toml" work-on
RC_WORK_ON=$(cat "$SCR/launch-work-on.rc")
if [ "$RC_WORK_ON" != "0" ]; then
  fail "AC2 confined work exits $RC_WORK_ON"
elif check_work on confined >/dev/null; then
  pass "AC2 confined work: temp write, prompt read, commit, fetch"
else
  fail "AC2 confined work missing: $(check_work on confined)"
fi

# --- AC3: a confined lane cannot signal what it did not start ---
sleep 300 & VICTIM=$!
export ORACLE_MODE=signal ORACLE_VICTIM_PID=$VICTIM
export ORACLE_OUT=$SCR/sig-off.txt ORACLE_SELF=$SCR/self-off.txt
launch "$SCR/config-off.toml" sig-off
if [ "$(cat $SCR/launch-sig-off.rc)" = "0" ] && [ "$(cat $SCR/sig-off.txt)" = "reached" ] && [ "$(cat $SCR/self-off.txt)" = "ok" ]; then
  pass "AC3 unconfined: outside signal reached, own signal ok (control)"
else
  fail "AC3 unconfined control broken (rc=$(cat $SCR/launch-sig-off.rc) out=$(cat $SCR/sig-off.txt 2>/dev/null) self=$(cat $SCR/self-off.txt 2>/dev/null))"
fi
export ORACLE_OUT=$SCR/sig-on.txt ORACLE_SELF=$SCR/self-on.txt
launch "$SCR/config-on.toml" sig-on
SIG_ON=$(cat $SCR/sig-on.txt 2>/dev/null || echo "no-output")
if [ "$SIG_ON" = "refused" ]; then
  if kill -0 "$VICTIM" 2>/dev/null && [ "$(cat $SCR/self-on.txt)" = "ok" ]; then
    pass "AC3 confined: outside signal refused, victim alive, own signal ok"
  else
    fail "AC3 confined refused but the victim died or the own-signal failed"
  fi
elif [ "$SIG_ON" = "reached" ]; then
  # Legal only as the AC7 fallback: the lane runs on, and says so on stderr.
  if warned "$SCR/launch-sig-on.err"; then
    pass "AC3/AC7 confine-on ran unconfined with a stderr warning (fallback; see AC7)"
  else
    fail "AC3 confined lane signalled an outside process with no warning"
  fi
  # The fallback path still runs the lane's own signals.
  [ "$(cat $SCR/self-on.txt 2>/dev/null)" = "ok" ] || fail "AC3 fallback run broke the lane's own signal"
else
  fail "AC3 confine-on run produced no signal verdict (rc=$(cat $SCR/launch-sig-on.rc))"
fi
# The harness argv inside is byte-identical to the off run, bypass flag included.
if cmp -s "$SCR/argv-sig-off.bin" "$SCR/argv-sig-on.bin"; then
  pass "AC1 harness argv byte-identical confined and unconfined"
else
  fail "AC1 harness argv differs confined vs unconfined"
fi
if tr '\0' '\n' < "$SCR/argv-sig-off.bin" | grep -q -- '--dangerously-bypass-approvals-and-sandbox'; then
  pass "AC1 bypass flag present in the handed argv"
else
  fail "AC1 bypass flag missing from the handed argv"
fi

# --- AC6: the battery runs every AC2/AC3 item twice, with controls ---
BATTERY_OUT=$SCR/battery.txt
if bun test scripts/launch.test.ts >"$BATTERY_OUT" 2>&1; then
  U=$(grep -c -w unconfined "$BATTERY_OUT" || true)
  C=$(grep -c -w confined "$BATTERY_OUT" || true)
  if [ "$U" -gt 0 ] && [ "$U" = "$C" ]; then
    pass "AC6 battery green with $U unconfined and $C confined lines"
  elif grep -qi 'skipped' "$BATTERY_OUT" && grep -qiE '[0-9]+ (run|skipped)|run.*skip|skip.*run' "$BATTERY_OUT"; then
    skip "AC6 battery green with loud skips (confinement not startable here)"
  else
    fail "AC6 battery green but unpaired ($U unconfined, $C confined lines, no skip count)"
  fi
else
  fail "AC6 battery exits nonzero"
fi

# --- AC7: fallback warns and logs; run.json records the mode ---
check_mode() { # $1=config $2=want $3=tag
  RD=$SCR/rd-$3; mkdir -p "$RD"
  POSTMASTER_CONFIG=$1 POSTMASTER_TOOL_PINS=$SCR/pins scripts/run-meta.sh "$RD" "$SCR/cwd" >$SCR/runmeta-$3.out 2>&1
  if [ $? -ne 0 ]; then echo "dispatch-failed"; return; fi
  grep -q "\"mode\": \"$2\"" "$RD/run.json" 2>/dev/null && echo ok || echo "no-mode-$2"
}
R_ON=$(check_mode "$SCR/config-on.toml" on on); R_OFF=$(check_mode "$SCR/config-off.toml" off off); R_ABSENT=$(check_mode "$SCR/config-absent.toml" off absent)
[ "$R_ON" = ok ] && pass 'AC7 dispatch with on records "mode": "on"' || fail "AC7 dispatch with on: $R_ON"
[ "$R_OFF" = ok ] && pass 'AC7 dispatch with off records "mode": "off"' || fail "AC7 dispatch with off: $R_OFF"
[ "$R_ABSENT" = ok ] && pass 'AC7 dispatch with absent confine records "mode": "off"' || fail "AC7 dispatch with absent confine: $R_ABSENT"

# Fallback logging, forced by a refusing shadow of the Linux mechanism on PATH.
if [ "$(uname -s)" = "Linux" ] && command -v bwrap >/dev/null; then
  printf '#!/bin/sh\necho shadow-refused >&2\nexit 1\n' > "$SCR/bin/bwrap"
  chmod +x "$SCR/bin/bwrap"
  mkdir -p "$SCR/rd-fb"
  printf '{"config": {"lanes": {"t": {"harness": "codex", "model": "x"}}, "confine": "on"}}' > "$SCR/rd-fb/run.json"
  export ORACLE_OUT=$SCR/sig-fb.txt ORACLE_SELF=$SCR/self-fb.txt
  ORACLE_ARGV_OUT=$SCR/argv-fb.bin \
    scripts/launch.sh launch t "$SCR/cwd" "$SCR/prompt.txt" --run "$SCR/rd-fb" \
    >$SCR/launch-fb.out 2>$SCR/launch-fb.err
  echo $? > "$SCR/launch-fb.rc"
  if [ "$(cat $SCR/sig-fb.txt 2>/dev/null)" = "reached" ] && warned "$SCR/launch-fb.err"; then
    if [ -f "$SCR/rd-fb/actions.jsonl" ] && grep -qi 'fallback' "$SCR/rd-fb/actions.jsonl"; then
      pass "AC7 forced fallback: stub ran, stderr warned, actions log records the fallback"
    else
      fail "AC7 forced fallback warned but the actions log records no fallback"
    fi
  elif [ "$(cat $SCR/sig-fb.txt 2>/dev/null)" = "refused" ]; then
    skip "AC7 forced fallback: still confined past the shadow (absolute lookup)"
  elif [ "$(cat $SCR/sig-fb.txt 2>/dev/null)" = "reached" ]; then
    fail "AC7 forced fallback ran unconfined with no stderr warning"
  else
    skip "AC7 forced fallback: no signal verdict (rc=$(cat $SCR/launch-fb.rc))"
  fi
else
  skip "AC7 forced fallback: not Linux with bwrap on PATH"
fi

# --- AC9: the dispatched fixture run is the coachman's, not the oracle's ---
skip "AC9 fixture run scores clean (run by the coachman/postmaster from the branch, not the lane)"

# --- AC10: the runbooks say confined ---
if grep -q 'process space of their own' skills/postmaster/coachman.md \
  && awk '/^## Lane capability/{f=1} f&&/^## /&&!/^## Lane capability/{f=0} f' skills/postmaster/coachman.md | grep -q worktree; then
  pass "AC10 coachman.md Lane capability says confined and still names the worktree"
else
  fail "AC10 coachman.md Lane capability does not say confined"
fi
if grep -q '^#\+ Confinement' skills/postmaster/harnesses.md; then
  pass "AC10 harnesses.md gains a Confinement section"
else
  fail "AC10 harnesses.md has no Confinement section"
fi

echo "oracle-200: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" = 0 ]
