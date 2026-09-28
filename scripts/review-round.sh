#!/usr/bin/env bash
# A review round's bookkeeping: its time limit, collecting it, recording and stopping the
# reviewers that do not finish in time, and tearing its scratches down with nothing of the
# round still running in them.
#
#   review-round.sh start    <dispatch> <round>
#   review-round.sh wait     <dispatch> <round> <repo> [<lens>:<lane>...]
#   review-round.sh teardown <dispatch> <round> <repo> [<lens>:<lane>...]
#   review-round.sh --self-test
#
# start clears the round's markers and fixes its deadline: now plus the round's time limit,
# review.round_timeout_seconds in the config recorded in <dispatch>/run.json, from 1 to 86400,
# or 2400 where it sets none or one that cannot be used, which it says. The deadline is kept in
# <dispatch>/logs/review-r<round>.json on a clock that stops while the machine sleeps, so a
# wait run again keeps it, and a wait left over from an earlier start of the round stands down.
#
# A reviewer is <lens>:<lane>, separated by spaces, commas or newlines, and a name is letters,
# digits, dots, underscores and dashes. Its marker is <dispatch>/logs/review-r<round>-<lens>-<lane>.done
# and its scratch <repo>/.worktrees/<TICKET>-rev-<lens>-<lane>, <TICKET> being the dispatch
# directory's name. wait records the reviewers it is given; wait and teardown given none take
# those.
#
# wait blocks until every reviewer's marker is in (scripts/wait-for-markers.sh), or until the
# deadline. At the deadline it records each reviewer with no marker as DEGRADED, with timeout
# as its cause, in run-log.md and a degrade line, then stops it with scripts/host.sh stop, which
# ends the launch and everything it started. One it cannot stop is named STILL RUNNING.
#
# teardown takes each scratch in turn: host.sh stop, host.sh close, then scripts/cut-scratch.sh
# --remove, which takes away a scratch of either kind and nothing else, each only once the one
# before has succeeded, and logs teardown for it. A scratch worktree a reviewer switched onto a
# branch of its own is detached first, and the branch kept; the run's own branches, <TICKET>
# and wb/<TICKET>-*, never are. A scratch already gone is skipped; one it cannot stop, close or
# remove is left in place and named with the reason, and so is a reviewer it had to stop
# before its marker landed.
#
#   exit 0  wait: every marker is in · start and teardown: done
#   exit 3  wait: the deadline passed; each reviewer with no marker is recorded and stopped
#   exit 4  wait: the deadline passed, but a record could not be written, which is a fault in a
#           control (controls.md)
#   exit 1  usage; the round was not started, or the machine restarted or the round was started
#           again since the wait began; a marker no reviewer of the round lands; teardown: a
#           scratch left in place
#
# Controls: the markers are read through wait-for-markers.sh, which proves its reader both
# ways. The processes are stopped through host.sh stop, never here, and never by working
# directory or command line.
set -uo pipefail
unset CDPATH
HERE=$(cd "$(dirname "$0")" && pwd -P)
DEFAULT_LIMIT=2400 MAX_LIMIT=86400
USAGE='usage: review-round.sh start <dispatch> <round> | wait|teardown <dispatch> <round> <repo> [<lens>:<lane>...] | --self-test'
die() { echo "review-round: $*" >&2; exit 1; }

state() {  # state <what> <state-file> [args]: the round's state file, read and written in one place
  python3 - "$@" <<'PY'
import json, math, os, re, subprocess, sys, tempfile, time

what, path, args = sys.argv[1], sys.argv[2], sys.argv[3:]

def boot():
    try:
        return open("/proc/sys/kernel/random/boot_id").read().strip()
    except OSError:
        pass
    try:
        return subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""

def load():
    try:
        return json.load(open(path))
    except FileNotFoundError:
        sys.exit("review-round: round not started: no %s; start runs before the round's launches" % path)
    except ValueError as e:
        sys.exit("review-round: %s cannot be read: %s" % (path, e))

def save(st):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "w") as f:
        json.dump(st, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)

if what == "start":                         # start <state> <run.json> <default> <max>
    run_json, default, most = args[0], int(args[1]), int(args[2])
    def fall(why):
        print("review-round: %s; the round's time limit is the default, %ds" % (why, default), file=sys.stderr)
        return default, "the default"
    try:
        cfg = json.load(open(run_json)).get("config")
        review = cfg.get("review") if isinstance(cfg, dict) else None
        v = review.get("round_timeout_seconds") if isinstance(review, dict) else None
        if v is None:
            limit, source = default, "the default"
        elif isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= most:
            limit, source = v, "review.round_timeout_seconds in run.json"
        else:
            limit, source = fall("review.round_timeout_seconds in %s is %r, not a whole number of seconds from 1 to %d" % (run_json, v, most))
    except FileNotFoundError:
        limit, source = fall("no run.json at %s" % run_json)
    except (OSError, ValueError, AttributeError) as e:
        limit, source = fall("%s cannot be read (%s)" % (run_json, e))
    save({"attempt": os.urandom(8).hex(), "boot": boot(), "limit": limit, "source": source,
          "deadline": time.monotonic() + limit, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          "reviewers": []})
    print(limit, source, sep="\t")

elif what == "check":                        # check <state>: attempt, seconds left, limit, source
    st = load()
    if st.get("boot") and boot() and st["boot"] != boot():
        sys.exit("review-round: the machine has restarted since the round started, so none of its reviewers runs; start the round again")
    print(st["attempt"], max(0, math.ceil(st["deadline"] - time.monotonic())), st["limit"], st["source"], sep="\t")

elif what in ("reviewers", "pairs"):         # reviewers <state> [<lens>:<lane>...]: record them, or read them;
    st = load() if what == "reviewers" else {}  # pairs - <lens>:<lane>...: read the ones given, and record nothing
    given = [x for a in args for x in re.split(r"[\s,]+", a) if x]
    if given:
        pairs, bad = [], []
        for x in given:
            m = re.fullmatch(r"([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)", x)
            if not m or {"", ".", ".."} & set(m.groups()):
                bad.append(x)
            elif list(m.groups()) not in pairs:
                pairs.append(list(m.groups()))
        if bad:
            sys.exit("review-round: not a <lens>:<lane>: %s" % ", ".join(bad))
        st["reviewers"] = pairs
        if what == "reviewers":
            save(st)
    if not st.get("reviewers"):
        sys.exit("review-round: no reviewers given, and none recorded for this round")
    for lens, lane in st["reviewers"]:
        print(lens, lane, sep="\t")
PY
}

scratch() { printf '%s/.worktrees/%s-rev-%s-%s' "$REPO" "$TICKET" "$1" "$2"; }
unswitch() {  # unswitch <scratch>: detach a scratch worktree a reviewer switched onto a branch of its own
  local b
  "$HERE/cut-scratch.sh" --kind "$1" >/dev/null 2>&1 && return 0          # a scratch as it was cut
  b=$(git -C "$1" symbolic-ref -q --short HEAD 2>/dev/null) || return 0    # not on a branch: --remove decides
  case $b in "$TICKET"|wb/"$TICKET"-*) return 0 ;; esac                     # the run's own branch: never touched
  git -C "$1" checkout -q --detach 2>/dev/null \
    && echo "a reviewer had switched it onto branch $b; detached, and the branch kept"
}
record() {  # record <run-log text> <log-action args...>: both, or say which could not be written
  local text=$1; shift
  "$HERE/run-log.sh" "$D" "$text" || { echo "NOT RECORDED in run-log.md: $text"; UNRECORDED=1; }
  "$HERE/log-action.sh" "$D" coachman "$@" || { echo "NOT RECORDED in actions.jsonl: $*"; UNRECORDED=1; }
}
read_reviewers() {  # read_reviewers <reviewers|pairs> [<lens>:<lane>...]: fills LENSES and LANES, one reviewer per index
  local how=$1 out lens lane; shift
  if [ "$how" = pairs ] && [ $# -gt 0 ]; then out=$(state pairs - "$@") || exit 1
  else out=$(state reviewers "$STATE" "$@") || exit 1; fi
  LENSES=() LANES=()
  while IFS=$'\t' read -r lens lane; do LENSES+=("$lens"); LANES+=("$lane"); done <<< "$out"
}

round_start() {
  local out lim src
  mkdir -p "$LOGS" || die "cannot make $LOGS"
  rm -f "$LOGS"/review-r"$R"-*.done
  out=$(state start "$STATE" "$D/run.json" "$DEFAULT_LIMIT" "$MAX_LIMIT") || die "could not start round $R"
  IFS=$'\t' read -r lim src <<< "$out"
  echo "review-round: round $R started, markers cleared, time limit ${lim}s ($src)"
}

round_wait() {
  local out attempt left lim src n i rc lens lane s f expected="" strays="" reported now stops=()
  out=$(state check "$STATE") || exit 1
  IFS=$'\t' read -r attempt left lim src <<< "$out"
  read_reviewers reviewers "$@"
  n=${#LENSES[@]}
  echo "review-round: round $R, $n reviewers, ${left}s left of its ${lim}s limit ($src)"
  "$HERE/wait-for-markers.sh" "$LOGS" "review-r$R-*.done" "$n" "$left"; rc=$?
  case $rc in 0|3) ;; *) die "the wait ended with exit $rc, so nothing is recorded" ;; esac
  MISSING=()
  for ((i = 0; i < n; i++)); do
    f="review-r$R-${LENSES[i]}-${LANES[i]}.done"
    expected="$expected $f "
    [ -e "$LOGS/$f" ] || MISSING+=("$i")
  done
  if [ ${#MISSING[@]} -eq 0 ]; then
    [ $rc -eq 3 ] && echo "review-round: every marker was in by the time the reviewers were named; none timed out"
    exit 0
  fi
  if [ $rc -eq 0 ]; then
    for f in "$LOGS"/review-r"$R"-*.done; do
      case $expected in *" ${f##*/} "*) ;; *) [ -e "$f" ] && strays="$strays ${f##*/}" ;; esac
    done
    die "the count was made up by markers no reviewer of round $R lands:$strays"
  fi
  now=$(state check "$STATE") || exit 1
  [ "${now%%$'\t'*}" = "$attempt" ] || die "round $R was started again while this wait ran; it stands down, and records and stops nothing"

  # The deadline passed: record each reviewer with no marker, then stop it.
  UNRECORDED=0 reported=$((n - ${#MISSING[@]}))
  record "round $R: WAIT-TIMEOUT after ${lim}s; $reported of $n reviewers reported" \
    note "r$R" "WAIT-TIMEOUT after ${lim}s: $reported of $n reviewers reported"
  for i in "${MISSING[@]}"; do
    lens=${LENSES[i]} lane=${LANES[i]}
    echo "TIMEOUT $lens $lane: DEGRADED, timeout"
    record "$lane $lens: DEGRADED, timeout" degrade "$lane" "$lens r$R: timeout"
  done
  for i in "${MISSING[@]}"; do                      # every stop at once: each may wait out its grace
    s=$(scratch "${LENSES[i]}" "${LANES[i]}")
    if [ -d "$s" ]; then "$HERE/host.sh" stop "$s" > "$LOGS/.stop-r$R-$i" 2>&1 & stops+=("$!"); else stops+=(""); fi
  done
  for i in "${!MISSING[@]}"; do
    rc=0; [ -z "${stops[i]}" ] || { wait "${stops[i]}"; rc=$?; }
    lens=${LENSES[MISSING[i]]} lane=${LANES[MISSING[i]]} s=$(scratch "$lens" "$lane")
    out=$(cat "$LOGS/.stop-r$R-${MISSING[i]}" 2>/dev/null); rm -f "$LOGS/.stop-r$R-${MISSING[i]}"
    if [ -z "${stops[i]}" ]; then
      echo "  no scratch at $s"
    elif [ $rc -eq 0 ]; then
      echo "  $out"
      case $out in "no launch is running"*) ;; *) record "$lane $lens: at the time limit, $out" note "$s" "r$R $lens $lane: at the time limit, $out" ;; esac
    else
      echo "  STILL RUNNING in $s: $out"
      record "$lane $lens: still running after the time limit, $out" note "$s" "r$R $lens $lane: still running after the time limit, $out"
    fi
  done
  [ "$UNRECORDED" -eq 0 ] || exit 4
  exit 3
}

round_teardown() {
  local i s out rc why finished lens lane removed=0 kept=0 gone=0
  read_reviewers pairs "$@"
  for ((i = 0; i < ${#LENSES[@]}; i++)); do
    lens=${LENSES[i]} lane=${LANES[i]} s=$(scratch "$lens" "$lane")
    [ -d "$s" ] || { echo "no scratch at $s"; gone=$((gone + 1)); continue; }
    why="" finished=no
    [ -e "$LOGS/review-r$R-$lens-$lane.done" ] && finished=yes   # before the stop, which lands it
    case $CALLER/ in "$(CDPATH= cd -P -- "$s" && pwd -P)"/*) why="the shell that ran this works in it; run teardown from outside it" ;; esac
    if [ -n "$why" ]; then
      :
    elif ! out=$("$HERE/host.sh" stop "$s" 2>&1); then
      why="it could not be stopped: $out"
    else
      case $out in
        "no launch is running"*) ;;
        *) if [ $finished = yes ]; then out="$out, left behind by a reviewer that had finished"
           else out="$out; its reviewer had not finished"; fi
           echo "$s: $out"
           record "$lane $lens: at teardown, $out" note "$s" "r$R: at teardown, $out" ;;
      esac
      out=$("$HERE/host.sh" close "$s" 2>&1); rc=$?
      if [ $rc -ne 0 ]; then
        why="its space was not closed: $out"
      else
        out=$(unswitch "$s")
        [ -z "$out" ] || { echo "$s: $out"; record "${s##*/}: $out" note "$s" "r$R: $out"; }
        out=$("$HERE/cut-scratch.sh" --remove "$REPO" "$s" 2>&1) || why="it was not removed: $out"
      fi
    fi
    if [ -z "$why" ]; then
      echo "removed $s"; removed=$((removed + 1))
      "$HERE/log-action.sh" "$D" coachman teardown "$s" "review scratch, round $R" \
        || echo "NOT RECORDED in actions.jsonl: teardown $s"
    else
      why=$(printf '%s' "$why" | tr '\n' ' ')
      echo "LEFT IN PLACE $s: $why"; kept=$((kept + 1))
      record "${s##*/}: left in place at teardown, $why" note "$s" "r$R: left in place at teardown, $why"
    fi
  done
  "$HERE/run-log.sh" "$D" "round $R: removed $removed of ${#LENSES[@]} scratches$( [ "$gone" -eq 0 ] || echo ", $gone already gone")$( [ "$kept" -eq 0 ] || echo ", $kept left in place")" \
    || echo "NOT RECORDED in run-log.md: round $R teardown"
  [ "$kept" -eq 0 ]
  exit $?
}

if [ "${1:-}" != --self-test ]; then
  case ${1:-} in
    start) [ $# -eq 3 ] || die "$USAGE" ;;
    wait|teardown) [ $# -ge 4 ] || die "$USAGE" ;;
    *) die "$USAGE" ;;
  esac
  CMD=$1
  D=$(cd "$2" 2>/dev/null && pwd -P) || die "no such dispatch directory: $2"
  case $3 in ''|0*|*[!0-9]*) die "a round is a whole number from 1: $3" ;; esac
  [ ${#3} -le 6 ] || die "a round is a whole number from 1: $3"
  R=$3 TICKET=${D##*/} LOGS="$D/logs" STATE="$D/logs/review-r$3.json"
  if [ "$CMD" = start ]; then round_start; exit 0; fi
  REPO=$(cd "$4" 2>/dev/null && pwd -P) || die "no such repo: $4"
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $4"
  shift 4
  CALLER=$(pwd -P)                                    # a scratch its caller works in is never removed
  cd / || die "cannot leave the working directory"   # nor one it works in itself
  case $CMD in wait) round_wait "$@" ;; teardown) round_teardown "$@" ;; esac
  exit 1
fi

# --- self-test ----------------------------------------------------------------------------
# Reviewers launched for real through host.sh with no session host, into real scratches, with
# stub herdr and tmux first on PATH so nothing reaches a live server. A slow reviewer keeps a
# child in a session of its own, as a harness runs a tool command.
self="$HERE/$(basename "$0")"
tmp=$(mktemp -d) && tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'for f in "$tmp"/pids/*; do [ -s "$f" ] && kill -KILL "$(cat "$f")" 2>/dev/null; done; chmod -R u+w "$tmp" 2>/dev/null; rm -r -- "$tmp" 2>/dev/null' EXIT
repo="$tmp/repo" d="$tmp/runs/proj/T-1"
mkdir -p "$d/logs" "$tmp/bin" "$tmp/host" "$tmp/pids" "$tmp/elsewhere" || exit 1
git init -q -b main "$repo" && git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m first || exit 1
for h in herdr tmux; do printf '#!/bin/sh\nexit 1\n' > "$tmp/bin/$h"; chmod +x "$tmp/bin/$h"; done
export PATH="$tmp/bin:$PATH" POSTMASTER_HOST=none POSTMASTER_HOST_STATE="$tmp/host" POSTMASTER_HOST_STOP_WAIT=2 POSTMASTER_HOST_CLOSE_WAIT=1
cat > "$tmp/reviewer.sh" <<'SH'
#!/bin/sh
# reviewer.sh <fast|slow|leaves> <pidfile>: a stand-in reviewer
case $1 in
  fast) exit 0 ;;
  leaves) sleep 300 & echo $! > "$2"; exit 0 ;;   # finishes, but leaves a process of its launch running
  slow) python3 -c 'import os; os.setsid(); os.execvp("sleep", ["sleep", "300"])' & echo $! > "$2"; exec sleep 300 ;;
esac
SH
chmod +x "$tmp/reviewer.sh"
fails=0 out="" rc=0 took=0 n=0
ok()    { printf '  ok   %s\n' "$1"; }
fail()  { printf '  FAIL %s (exit %s)\n' "$1" "$rc"; printf '%s\n' "$out" | sed 's/^/         /'; fails=$((fails+1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }   # check <label> <condition>
run()   { local t0; t0=$(date +%s); out=$("$self" "$@" 2>&1); rc=$?; took=$(( $(date +%s) - t0 )); }
has()   { case $out in *"$1"*) true ;; *) false ;; esac; }
lines() { grep -c -- "$1" "$d/actions.jsonl" 2>/dev/null || true; }
alive() { local st; st=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$st" ] && [ "${st#Z}" = "$st" ]; }
limit() { printf '{"config": {"review": {"round_timeout_seconds": %s}}}\n' "$1" > "$d/run.json"; }
cut()   { git -C "$repo" worktree add -q --detach "$repo/.worktrees/T-1-rev-$1-$2" HEAD || exit 1; }
launch() {  # launch <round> <lens> <lane> <fast|slow|leaves>: through host.sh, as the round does
  n=$((n + 1))
  ( cd "$tmp" && "$HERE/host.sh" run "T-1 · $3 $2 review" "$repo/.worktrees/T-1-rev-$2-$3" \
      --role reviewer --run "$d" \
      --marker "$d/logs/review-r$1-$2-$3.done" --pidfile "$tmp/pids/launch.$n" -- "$tmp/reviewer.sh" "$4" "$tmp/pids/child.$n" ) >/dev/null \
    || { echo "  (could not launch $2 $3)"; return 1; }
  [ "$4" = fast ] && return 0
  local i=0; while [ ! -s "$tmp/pids/child.$n" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  [ -s "$tmp/pids/child.$n" ] || { echo "  (the $4 reviewer never started)"; return 1; }
}

echo "positive controls"
limit 3; cut bug one; cut bug two
run start "$d" 1
check "start clears the round's markers and fixes its limit from run.json" \
  '[ $rc -eq 0 ] && has "time limit 3s (review.round_timeout_seconds in run.json)" && [ -s "$d/logs/review-r1.json" ]'
launch 1 bug one fast; launch 1 bug two slow; slow=$(cat "$tmp/pids/launch.$n") child=$(cat "$tmp/pids/child.$n")
run wait "$d" 1 "$repo" "bug:one bug:two"; wait_out=$out wait_rc=$rc
check "at the deadline, wait exits 3 and names the reviewer with no marker" \
  '[ $rc -eq 3 ] && has "WAIT-TIMEOUT" && has "TIMEOUT bug two: DEGRADED, timeout" && ! has "TIMEOUT bug one"'
check "run-log.md records it as <lane> <lens>: DEGRADED, timeout" 'grep -q " two bug: DEGRADED, timeout$" "$d/run-log.md"'
check "a degrade line records it, with the lens, the round and the cause" \
  'grep -q "\"action\":\"degrade\",\"target\":\"two\",\"detail\":\"bug r1: timeout\"" "$d/actions.jsonl" && [ "$(lines "\"action\":\"degrade\"")" -eq 1 ]'
check "host.sh stop ends it, and its child in a session of its own" '! alive "$slow" && ! alive "$child"'
run teardown "$d" 1 "$repo"
check "teardown takes the reviewers the wait recorded, and removes each scratch" \
  '[ $rc -eq 0 ] && [ ! -e "$repo/.worktrees/T-1-rev-bug-one" ] && [ ! -e "$repo/.worktrees/T-1-rev-bug-two" ] && [ "$(lines "\"action\":\"teardown\"")" -eq 2 ]'

limit 4; cut bug three
run start "$d" 2; launch 2 bug three slow; slow=$(cat "$tmp/pids/launch.$n")
timeout 1 "$self" wait "$d" 2 "$repo" bug:three >/dev/null 2>&1   # the harness's cap ends the wait
sleep 1
run wait "$d" 2 "$repo"
check "a wait run again keeps the round's deadline rather than starting a new one" \
  '[ $rc -eq 3 ] && [ "$took" -le 3 ] && has "TIMEOUT bug three" && ! alive "$slow"'
run teardown "$d" 2 "$repo" bug:three

limit 60; cut style one
run start "$d" 3; launch 3 style one leaves; left=$(cat "$tmp/pids/child.$n")
run wait "$d" 3 "$repo" style:one
check "when every marker is in, wait exits 0 and records nothing" '[ $rc -eq 0 ] && [ "$(lines "\"action\":\"degrade\"")" -eq 2 ]'
git -C "$repo/.worktrees/T-1-rev-style-one" switch -q -c probe
run teardown "$d" 3 "$repo" style:one
check "teardown stops what a finished reviewer's launch left running, and says so" \
  '[ $rc -eq 0 ] && ! alive "$left" && has "left behind by a reviewer that had finished"'
check "a scratch a reviewer switched onto a branch is still removed, and the branch kept" \
  '[ ! -e "$repo/.worktrees/T-1-rev-style-one" ] && has "switched it onto branch probe" && git -C "$repo" rev-parse -q --verify refs/heads/probe >/dev/null'

echo "negative controls"
out=$wait_out rc=$wait_rc
check "a reviewer that reported is neither recorded nor stopped" '! has "TIMEOUT bug one" && ! grep -q "one bug: DEGRADED" "$d/run-log.md"'
limit 2; cut bug four
run start "$d" 4; launch 4 bug four slow; slow=$(cat "$tmp/pids/launch.$n")
"$self" wait "$d" 4 "$repo" bug:four > "$tmp/stale.out" 2>&1 & stale=$!
sleep 0.5; limit 60; run start "$d" 4
wait "$stale"; rc=$?; out=$(cat "$tmp/stale.out")
check "a wait from an earlier start of the round stands down, and records and stops nothing" \
  '[ $rc -eq 1 ] && has "started again" && alive "$slow" && ! grep -q "four bug: DEGRADED" "$d/run-log.md"'
( cd "$repo/.worktrees/T-1-rev-bug-four" && "$self" teardown "$d" 4 "$repo" bug:four > "$tmp/inside.out" 2>&1; exit $? ); rc=$?; out=$(cat "$tmp/inside.out")
check "teardown from inside a scratch leaves it in place, and stops nothing" \
  '[ $rc -eq 1 ] && has "LEFT IN PLACE" && [ -e "$repo/.worktrees/T-1-rev-bug-four" ] && alive "$slow"'
run teardown "$d" 4 "$repo" bug:four
check "from outside, teardown stops the unfinished reviewer first, says so, then removes it" \
  '[ $rc -eq 0 ] && ! alive "$slow" && has "its reviewer had not finished" && [ ! -e "$repo/.worktrees/T-1-rev-bug-four" ]'
cut bug seven
run teardown "$d" 12 "$repo" bug:seven
check "teardown given its reviewers needs no start, as at the cut, and records none for the round" \
  '[ $rc -eq 0 ] && [ ! -e "$repo/.worktrees/T-1-rev-bug-seven" ] && [ ! -e "$d/logs/review-r12.json" ]'
mkdir -p "$repo/.worktrees/T-1-rev-bug-five"
run teardown "$d" 4 "$repo" bug:five
check "a directory that is no scratch is left in place" '[ $rc -eq 1 ] && has "it was not removed" && [ -d "$repo/.worktrees/T-1-rev-bug-five" ]'
git -C "$repo" worktree add -q -b wb/T-1-luna "$repo/.worktrees/T-1-rev-style-two" HEAD
run teardown "$d" 4 "$repo" style:two
check "a worktree on the run's own branch is never detached or removed" \
  '[ $rc -eq 1 ] && has "LEFT IN PLACE" && [ "$(git -C "$repo/.worktrees/T-1-rev-style-two" symbolic-ref -q --short HEAD)" = wb/T-1-luna ]'
touch "$d/logs/review-r6-bug-one.done" "$d/logs/review-r6-style-one.done"
python3 -c 'import json,sys,time; json.dump({"attempt":"a","boot":"","limit":1,"source":"t","deadline":time.monotonic()+1,"reviewers":[]}, open(sys.argv[1],"w"))' "$d/logs/review-r6.json"
run wait "$d" 6 "$repo" "bug:one,bug:two"
check "a marker another reviewer landed never stands in for a missing one" '[ $rc -eq 1 ] && has "review-r6-style-one.done"'
python3 -c 'import json,sys,time; json.dump({"attempt":"a","boot":"another-boot","limit":1,"source":"t","deadline":time.monotonic()+60,"reviewers":[]}, open(sys.argv[1],"w"))' "$d/logs/review-r7.json"
[ -e /proc/sys/kernel/random/boot_id ] && { run wait "$d" 7 "$repo" bug:one
  check "a round started before the machine restarted is not waited on" '[ $rc -eq 1 ] && has "restarted"'; }
run wait "$d" 8 "$repo" bug:one
check "a round that was never started is not waited on" '[ $rc -eq 1 ] && has "round not started"'
for v in '"7"' 0 -3 true 1.5 86401; do
  limit "$v"; run start "$d" 9
  check "a limit of $v is not used: the default, and the warning says why" '[ $rc -eq 0 ] && has "time limit 2400s (the default)" && has "not a whole number of seconds from 1 to 86400"'
done
rm -f "$d/run.json"; run start "$d" 9
check "no run.json gets the default, and says so" '[ $rc -eq 0 ] && has "no run.json" && has "time limit 2400s"'
limit 1; cut bug six; run start "$d" 10
if [ "$(id -u)" -ne 0 ]; then
  chmod a-w "$d/actions.jsonl"; run wait "$d" 10 "$repo" bug:six; chmod u+w "$d/actions.jsonl"
  check "a timeout whose degrade line cannot be written exits 4, and says what was not recorded" '[ $rc -eq 4 ] && has "NOT RECORDED in actions.jsonl"'
else
  echo "  skip a record that cannot be written (root writes anywhere)"
fi
run teardown "$d" 10 "$repo" bug:six
run start "$d" 11
for args in "wait $d 11 $repo bug" "wait $d 11 $repo bug:../x" "wait $d 0 $repo bug:one" "wait $tmp/nowhere 1 $repo bug:one" \
            "wait $d 11 $tmp/elsewhere bug:one" "stop $d 11 $repo bug:one" "start $d"; do
  run $args
  check "refused: review-round.sh ${args//$tmp/<tmp>}" '[ $rc -eq 1 ]'
done
run wait "$d" 11 "$repo" "bug:one
bug:one security:two"
check "reviewers on several lines, one given twice, are each waited on once" '[ $rc -eq 3 ] && has "round 11, 2 reviewers"'

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
