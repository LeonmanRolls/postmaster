#!/usr/bin/env bash
# One line per run under a project's run root: the run, its stage and leg from the manifest,
# the markers present, minutes since anything in it changed, and what the postmaster does
# next. This is the postmaster's poll; it reads files and nothing else. A pending escalation
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
#          ASK       the leg's attempt ended in a way that goes to the user: a refusal, a start
#                    with no thread id, or a wall on the fallback. Put the question to the user
#                    (waiting add + .waiting-on-user); `leg.sh answer` names what happens then
#          TAKEOVER  the leg's attempt was walled and the leg is not on the fallback: take it
#                    over with `leg.sh takeover`
#          RESUME    the leg's attempt was spent: resume it with `leg.sh resume`
#          REMOUNT   the current leg's process exited with no outcome record: legacy, handle
#                    as ASK/TAKEOVER/RESUME from the attempt's own state
#          READ      a checkpoint card is waiting to be read (.checkpoint-*-ready)
#          INSPECT   no marker, nothing changed for 30 minutes, run not done
#          WAIT      a leg is running and its files are moving
#          -         the manifest says done or abandoned
#
# The ASK/TAKEOVER/RESUME mapping comes from <dispatch>/logs/coachman-leg-<n>-outcome.json,
# recorded by scripts/leg.sh when the attempt ended. Nothing here reads a leg's .err.
#
# Idle time ignores the marker files themselves, so touching a marker never hides a stall.
#
#   exit 0  listed (an empty root lists nothing)
#   exit 1  usage, or no such root
set -uo pipefail

status() {  # status <root>
  python3 - "$1" <<'PY'
import sys, os, json, time, glob
root = sys.argv[1]; now = time.time()
pm_esc = os.path.join(root, "postmaster", "ESCALATION.md")
if os.path.isfile(pm_esc):
    print("POSTMASTER     escalation to the user is pending: %s" % pm_esc)
rows = []
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
    newest = 0
    for dp, dn, fn in os.walk(d):
        for f in fn:
            if f.startswith("."): continue
            try: newest = max(newest, os.path.getmtime(os.path.join(dp, f)))
            except OSError: pass
    idle_min = int((now - newest) / 60) if newest else -1
    done = ".leg-%s-done" % leg in markers
    exited = ".leg-%s-exited" % leg in markers
    def next_from_outcome():
        """ASK, TAKEOVER or RESUME from the leg's outcome record; None when there is none."""
        path = os.path.join(d, "logs", "coachman-leg-%s-outcome.json" % leg)
        try:
            rec = json.load(open(path))
        except (OSError, ValueError, TypeError):
            return None
        if not isinstance(rec, dict):
            return None
        outcome = rec.get("outcome")
        if outcome == "spent":
            return "RESUME"
        if outcome == "walled":
            on_fallback = False
            try:
                mpath = os.path.join(d, "manifest.json")
                m = json.load(open(mpath))
                entry = (m.get("coachman") or {}).get("legs", {}).get(str(leg)) or \
                        (m.get("coachman") or {}).get("legs", {}).get(leg) or {}
                on_fallback = entry.get("name") == "coachman_fallback"
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            return "ASK" if on_fallback else "TAKEOVER"
        if outcome in ("refused", "no-thread"):
            return "ASK"
        return None
    if stage in ("done", "abandoned"): nxt = "-"
    elif ".waiting-on-user" in markers: nxt = "USER"
    elif ".escalation-ready" in markers: nxt = "RULE"
    elif ".card-ready" in markers: nxt = "GATE"
    elif done: nxt = "DISPATCH"
    elif exited:
        nxt = next_from_outcome() or "REMOUNT"
    elif any(mk.startswith(".checkpoint-") for mk in markers): nxt = "READ"
    elif idle_min >= 30: nxt = "INSPECT"
    else: nxt = "WAIT"
    rows.append((run, stage, leg, ",".join(markers) or "-", idle_min, nxt))
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
outcome() {  # outcome <name> <leg> <outcome> [leg-name]: the outcome record leg.sh writes
  local d="$tmp/root/$1" n=$2 o=$3 name=${4:-coachman}
  mkdir -p "$d/logs"
  printf '{"outcome": "%s", "attempt": "launch", "on_answer": "none", "exit": 1}\n' "$o" \
    > "$d/logs/coachman-leg-$n-outcome.json"
  if [ "$name" != coachman ]; then
    python3 - "$d/manifest.json" "$n" "$name" <<'PY'
import json, sys
path, n, name = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(path))
legs = m.setdefault("coachman", {}).setdefault("legs", {})
legs[str(n)] = {"name": name}
json.dump(m, open(path, "w"))
PY
  fi
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
run remount review 2 .leg-2-exited
run read review 2 .checkpoint-review-ready
run inspect review 2; age inspect
run wait review 2
run user review 2 .waiting-on-user .leg-2-exited
run closed done 3 .leg-3-done .leg-3-exited
run earlier review 2 .leg-1-done
run usergate shipping 3 .card-ready .waiting-on-user
run userclosed done 3 .waiting-on-user
run stall review 2; age stall; : > "$tmp/root/stall/.leg-1-done"
run askref review 2 .leg-2-exited; outcome askref 2 refused
run askno review 2 .leg-2-exited; outcome askno 2 no-thread
run take review 2 .leg-2-exited; outcome take 2 walled
run takefb review 2 .leg-2-exited; outcome takefb 2 walled coachman_fallback
run resume review 2 .leg-2-exited; outcome resume 2 spent
run askuser review 2 .leg-2-exited .waiting-on-user; outcome askuser 2 refused
mkdir -p "$tmp/root/postmaster"

echo "positive controls"
expect "an escalation waiting is RULE" rule RULE
expect "a complete ship card is GATE" gate GATE
expect "the current leg done is DISPATCH" dispatch DISPATCH
expect "the current leg gone with nothing written is REMOUNT" remount REMOUNT
expect "a checkpoint card waiting is READ" read READ
expect "nothing changed for an hour is INSPECT" inspect INSPECT
expect "a leg at work is WAIT" wait WAIT
expect "a run waiting on the user is USER, whatever else it holds" user USER
expect "a closed run is -" closed "-"
expect "a refused attempt is ASK: put it to the user" askref ASK
expect "a start with no thread id is ASK: put it to the user" askno ASK
expect "a wall on the coachman is TAKEOVER" take TAKEOVER
expect "a wall on the fallback is ASK: the user decides" takefb ASK
expect "a spent attempt is RESUME" resume RESUME

echo "negative controls"
expect "an earlier leg's done marker dispatches nothing" earlier WAIT
expect "a ship card put to the user waits on the user, not the gate" usergate USER
expect "a closed run stays closed with a stale marker" userclosed "-"
expect "touching a marker does not hide a stall" stall INSPECT
expect "a refusal already put to the user waits, it does not ASK again" askuser USER
[ -z "$(next_of postmaster)" ] && ok "the postmaster's own directory is not a run" \
  || fail "the postmaster's own directory is not a run"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
