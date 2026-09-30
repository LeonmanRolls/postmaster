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
#          SPEC      a spec review package is waiting (.spec-review-ready): the postmaster puts
#                    each workhorse's spec to the user, one at a time
#          DISPATCH  the current leg is done (.leg-<n>-done): the next leg, or after the last,
#                    the postmaster's close
#          REMOUNT   the current leg's process exited (.leg-<n>-exited) with no hand-off,
#                    escalation, card or spec package: resume it, or relaunch it on the fallback
#                    after a wall
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
    if stage in ("done", "abandoned"): nxt = "-"
    elif ".waiting-on-user" in markers: nxt = "USER"
    elif ".escalation-ready" in markers: nxt = "RULE"
    elif ".card-ready" in markers: nxt = "GATE"
    elif ".spec-review-ready" in markers: nxt = "SPEC"
    elif done: nxt = "DISPATCH"
    elif exited: nxt = "REMOUNT"
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
run spec planning 1 .spec-review-ready .leg-1-exited
run dispatch review 2 .leg-2-done .leg-2-exited
run remount review 2 .leg-2-exited
run read review 2 .checkpoint-review-ready
run inspect review 2; age inspect
run wait review 2
run user review 2 .waiting-on-user .leg-2-exited
run closed done 3 .leg-3-done .leg-3-exited
run earlier review 2 .leg-1-done
run usergate shipping 3 .card-ready .waiting-on-user
run userspec planning 1 .spec-review-ready .waiting-on-user
run userclosed done 3 .waiting-on-user
run stall review 2; age stall; : > "$tmp/root/stall/.leg-1-done"
mkdir -p "$tmp/root/postmaster"

echo "positive controls"
expect "an escalation waiting is RULE" rule RULE
expect "a complete ship card is GATE" gate GATE
expect "a spec review package waiting is SPEC" spec SPEC
expect "the current leg done is DISPATCH" dispatch DISPATCH
expect "the current leg gone with nothing written is REMOUNT" remount REMOUNT
expect "a checkpoint card waiting is READ" read READ
expect "nothing changed for an hour is INSPECT" inspect INSPECT
expect "a leg at work is WAIT" wait WAIT
expect "a run waiting on the user is USER, whatever else it holds" user USER
expect "a closed run is -" closed "-"

echo "negative controls"
expect "an earlier leg's done marker dispatches nothing" earlier WAIT
expect "a ship card put to the user waits on the user, not the gate" usergate USER
expect "a spec package put to the user waits on the user, not the package" userspec USER
expect "a closed run stays closed with a stale marker" userclosed "-"
expect "touching a marker does not hide a stall" stall INSPECT
[ -z "$(next_of postmaster)" ] && ok "the postmaster's own directory is not a run" \
  || fail "the postmaster's own directory is not a run"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
