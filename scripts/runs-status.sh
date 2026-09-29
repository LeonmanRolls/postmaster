#!/usr/bin/env bash
# One line per run under a project's run root: the run, its stage and leg from the manifest,
# the markers present, minutes since anything in it changed, and what the postmaster does
# next. It refreshes the postmaster/waiting index from run markers on every poll. A pending escalation
# from the postmaster to the user is printed first, since it is what everything else may
# be waiting on.
#
#   runs-status.sh <project-run-root>        e.g. <project>/.postmaster/runs
#   runs-status.sh --self-test
#
#   next   USER      the postmaster has put this run's question to the user and waits for the
#                    answer (.waiting-on-user)
#          RULE      an escalation is waiting (.escalation-ready)
#          GATE      the ship card is complete (.card-ready)
#          DISPATCH  the current leg is done (.leg-<n>-done): the next leg, or after the last,
#                    the postmaster's close
#          ASK       a recorded refusal, pre-thread exit, or wall on the fallback needs a user
#          TAKEOVER  a primary coachman hit a recorded wall: start the fallback
#          RESUME    a leg exited with a thread id and no hand-off: resume it
#          READ      a checkpoint card is waiting to be read (.checkpoint-*-ready)
#          INSPECT   no marker, nothing changed for 30 minutes, run not done
#          WAIT      a leg is running and its files are moving
#          -         the manifest says done or abandoned
#
# Idle time ignores the marker files themselves, so touching a marker never hides a stall.
#
#   exit 0  listed (an empty root lists nothing)
#   exit 1  usage, or no such root
set -uo pipefail

status() {  # status <root>
  python3 - "$1" <<'PY'
import sys, os, json, time, glob, tempfile
root = sys.argv[1]; now = time.time()
pm_esc = os.path.join(root, "postmaster", "ESCALATION.md")
if os.path.isfile(pm_esc):
    print("POSTMASTER     escalation to the user is pending: %s" % pm_esc)
rows = []
waiting = []
for run in sorted(os.listdir(root)):
    d = os.path.join(root, run)
    if not os.path.isdir(d) or run == "postmaster": continue
    stage, leg = "no manifest", "?"
    mp = os.path.join(d, "manifest.json")
    if os.path.isfile(mp):
        try:
            m = json.load(open(mp)); stage = str(m.get("stage", "?")); leg = str(m.get("leg", "?"))
        except Exception:
            stage = "manifest unreadable"
    markers = sorted(os.path.basename(p)
                     for pat in (".*-ready", ".leg-*-done", ".leg-*-exited", ".waiting-on-user")
                     for p in glob.glob(os.path.join(d, pat)))
    if ".waiting-on-user" in markers and stage not in ("done", "abandoned"):
        waiting.append(run)
    newest = 0
    for dp, dn, fn in os.walk(d):
        for f in fn:
            if f.startswith("."): continue
            try: newest = max(newest, os.path.getmtime(os.path.join(dp, f)))
            except OSError: pass
    idle_min = int((now - newest) / 60) if newest else -1
    done = ".leg-%s-done" % leg in markers
    exited = ".leg-%s-exited" % leg in markers
    active = os.path.isdir(os.path.join(d, ".leg-%s-active" % leg))
    outcome, role = "", ""
    try:
        attempt_path = os.path.join(d, "logs", "coachman-leg-%s-attempts.jsonl" % leg)
        with open(attempt_path, encoding="utf-8") as f:
            records = [json.loads(line) for line in f if line.strip()]
        if records:
            outcome = records[-1].get("outcome", "")
            role = records[-1].get("role", "")
    except (OSError, ValueError, TypeError):
        pass
    if stage in ("done", "abandoned"): nxt = "-"
    elif ".waiting-on-user" in markers: nxt = "USER"
    elif ".escalation-ready" in markers: nxt = "RULE"
    elif ".card-ready" in markers: nxt = "GATE"
    elif active: nxt = "WAIT"
    elif outcome == "finished": nxt = "DISPATCH"
    elif outcome in ("refused", "pre-thread"): nxt = "ASK"
    elif outcome == "walled" and role == "coachman": nxt = "TAKEOVER"
    elif outcome == "walled" and role == "coachman_fallback": nxt = "ASK"
    elif outcome == "incomplete": nxt = "RESUME"
    elif done: nxt = "DISPATCH"
    elif exited: nxt = "INSPECT"
    elif any(mk.startswith(".checkpoint-") for mk in markers): nxt = "READ"
    elif idle_min >= 30: nxt = "INSPECT"
    else: nxt = "WAIT"
    rows.append((run, stage, leg, ",".join(markers) or "-", idle_min, nxt))
pm_dir = os.path.join(root, "postmaster")
os.makedirs(pm_dir, exist_ok=True)
waiting_path = os.path.join(pm_dir, "waiting")
fd, waiting_tmp = tempfile.mkstemp(prefix=".waiting.", dir=pm_dir)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write("".join(name + "\n" for name in waiting))
os.replace(waiting_tmp, waiting_path)
print("%-14s %-16s %-4s %-44s %6s  %s" % ("RUN", "STAGE", "LEG", "MARKERS", "IDLE", "NEXT"))
for r in rows:
    print("%-14s %-16s %-4s %-44s %5sm  %s" % r)
PY
}

if [ "${1:-}" != --self-test ]; then
  [ $# -eq 1 ] || { echo "usage: runs-status.sh <project-run-root> | --self-test" >&2; exit 1; }
  ROOT=$(CDPATH= cd -P -- "$1" 2>/dev/null && pwd -P) || { echo "runs-status: no such root: $1" >&2; exit 1; }
  status "$ROOT"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
# Every NEXT state from a run built to show it, and the cases that must not be taken for one.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }
run() {  # run <name> <stage> <leg> [marker...]: a run directory with a manifest and markers
  local d="$tmp/root/$1" stage=$2 leg=$3 m; shift 3
  mkdir -p "$d/logs"; printf '{"stage": "%s", "leg": %s}\n' "$stage" "$leg" > "$d/manifest.json"
  : > "$d/run-log.md"
  for m in "$@"; do : > "$d/$m"; done
}
record() {  # record <name> <outcome> <role>: one attempt result, as the leg script writes it
  printf '{"outcome":"%s","role":"%s"}\n' "$2" "$3" > "$tmp/root/$1/logs/coachman-leg-2-attempts.jsonl"
}
age() {  # age <name>: nothing in the run has changed for an hour
  python3 -c 'import os, sys, time
t = time.time() - 3600
for dp, dn, fn in os.walk(sys.argv[1]):
    for f in fn:
        os.utime(os.path.join(dp, f), (t, t))' "$tmp/root/$1"
}
next_of() { status "$tmp/root" | awk -v r="$1" '$1 == r { print $NF }'; }
expect() {  # expect <label> <run> <next>
  local got; got=$(next_of "$2")
  [ "$got" = "$3" ] && ok "$1" || fail "$1 (got '$got', wanted '$3')"
}

run rule review 2 .escalation-ready
run gate shipping 3 .card-ready
run dispatch review 2 .leg-2-done .leg-2-exited
record dispatch finished coachman
run refused review 2 .leg-2-exited; record refused refused coachman
run prethread review 2 .leg-2-exited; record prethread pre-thread coachman
run wall review 2 .leg-2-exited; record wall walled coachman
run fallbackwall review 2 .leg-2-exited; record fallbackwall walled coachman_fallback
run remount review 2 .leg-2-exited; record remount incomplete coachman
run read review 2 .checkpoint-review-ready
run inspect review 2; age inspect
run wait review 2
run user review 2 .waiting-on-user .leg-2-exited
run closed done 3 .leg-3-done .leg-3-exited
run earlier review 2 .leg-1-done
run usergate shipping 3 .card-ready .waiting-on-user
run userclosed done 3 .waiting-on-user
run refusedanswer review 2 .waiting-on-user .leg-2-exited; record refusedanswer refused coachman
run wallanswer review 2 .waiting-on-user .leg-2-exited; record wallanswer walled coachman_fallback
run incompleteanswer review 2 .waiting-on-user .leg-2-exited; record incompleteanswer incomplete coachman
run finishedclosed done 2 .leg-2-done .leg-2-exited; record finishedclosed finished coachman
run active review 2; record active refused coachman; mkdir "$tmp/root/active/.leg-2-active"
run unknown review 2 .leg-2-exited; record unknown mystery coachman
run wallunknown review 2 .leg-2-exited; record wallunknown walled unknown
run stall review 2; age stall; : > "$tmp/root/stall/.leg-1-done"
mkdir -p "$tmp/root/postmaster"

echo "positive controls"
expect "an escalation waiting is RULE" rule RULE
expect "a complete ship card is GATE" gate GATE
expect "the current leg done is DISPATCH" dispatch DISPATCH
expect "a refused launch is ASK" refused ASK
expect "an exit before a thread id is ASK" prethread ASK
expect "a wall on the primary coachman is TAKEOVER" wall TAKEOVER
expect "a wall on the fallback coachman is ASK" fallbackwall ASK
expect "an incomplete thread is RESUME" remount RESUME
expect "a checkpoint card waiting is READ" read READ
expect "nothing changed for an hour is INSPECT" inspect INSPECT
expect "a leg at work is WAIT" wait WAIT
expect "a run waiting on the user is USER, whatever else it holds" user USER
expect "a closed run is -" closed "-"
expect "a refusal stays USER while the user question is open" refusedanswer USER
expect "a fallback wall stays USER while the user question is open" wallanswer USER
expect "an incomplete thread waits on the user ahead of its outcome" incompleteanswer USER
expect "a closed run ignores a stale finished attempt" finishedclosed "-"
expect "a live attempt waits even when its previous outcome asked the user" active WAIT
waiting=$(cat "$tmp/root/postmaster/waiting")
[ "$waiting" = $'incompleteanswer\nrefusedanswer\nuser\nusergate\nwallanswer' ] && ok "the waiting index lists waiting runs" || fail "the waiting index lists waiting runs (got '$waiting')"

echo "negative controls"
expect "an earlier leg's done marker dispatches nothing" earlier WAIT
expect "a ship card put to the user waits on the user, not the gate" usergate USER
expect "a closed run stays closed with a stale marker" userclosed "-"
expect "an unknown outcome is inspected instead of resumed" unknown INSPECT
expect "a wall without a known role is inspected" wallunknown INSPECT
expect "touching a marker does not hide a stall" stall INSPECT
[ -z "$(next_of postmaster)" ] && ok "the postmaster's own directory is not a run" \
  || fail "the postmaster's own directory is not a run"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
