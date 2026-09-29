#!/usr/bin/env bash
# Wait until a run under a project's run root needs the postmaster, then print runs-status.sh's
# table, name each run that needs it with its NEXT, and exit. This is the loop Stage D keeps in
# the background: it reads runs, sleeps and prints, and nothing else. A session that improvises
# this look loses it on a restart and fires on runs it must leave alone.
#
#   runs-watch.sh <project-run-root> [--timeout <seconds>]
#   runs-watch.sh --help
#   runs-watch.sh --self-test
#
# It looks every postmaster.poll_seconds (default 120) from the config (POSTMASTER_CONFIG
# overrides the path), starting at once, so a run already waiting is named without a wait. A run
# needs the postmaster when its NEXT is anything but WAIT (a leg at work), USER (already put to
# the user) or - (closed). A run listed in <runs>/postmaster/held, one ticket per line, never
# does: hold a run by writing its ticket there, release it by removing the line. The held list
# and the config are read on every look, so a hold takes effect without restarting the watcher.
#
# With --timeout, a look that finds nothing for that many seconds prints the table and exits 3;
# the timeout counts the seconds it has slept, so a clock set forward does not end the wait
# early. A count or a timeout is at most 9 digits. Without --timeout it waits until a run needs
# the postmaster.
#
#   exit 0  a run needs the postmaster: the table, then one `needs <run> <NEXT>` line each
#   exit 3  --timeout passed with nothing to act on: the table
#   exit 1  usage, no such root, or a poll interval or timeout that is not a whole number
#
# Controls: every NEXT that must wake the postmaster names its run on exit 0 (positive), and
# WAIT, USER, -, and a held run leave it waiting until its timeout (negative).
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = --help ] || [ "${1:-}" = -h ]; then usage; exit 0; fi

waking_runs() {  # waking_runs <held-file>: `needs <run> <NEXT>` per waking run; the table on stdin
  awk -v held="$1" '
  BEGIN {
    while ((getline line < held) > 0) {
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line != "") hold[line] = 1
    }
  }
  $1 == "POSTMASTER" { next }
  $1 == "RUN" && $NF == "NEXT" { next }
  $NF == "USER" || $NF == "WAIT" || $NF == "-" { next }
  NF < 2 { next }
  $1 in hold { next }
  { print "needs " $1 " " $NF }
  '
}

poll_seconds() {  # poll_seconds: the config's postmaster.poll_seconds, or 120
  python3 - "$CONFIG" <<'PY'
import sys, tomllib
path = sys.argv[1]
try:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
except FileNotFoundError:
    print(120); raise SystemExit(0)
except (OSError, tomllib.TOMLDecodeError) as e:
    print("runs-watch: cannot read %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
ps = cfg.get("postmaster", {}).get("poll_seconds", 120)
if not isinstance(ps, int) or isinstance(ps, bool) or ps < 1:
    print("runs-watch: postmaster.poll_seconds must be a whole number of seconds, 1 or more: %r" % (ps,), file=sys.stderr)
    raise SystemExit(1)
print(ps)
PY
}

if [ "${1:-}" = --self-test ]; then
  self=$(CDPATH= cd -P -- "$(dirname "$0")" && pwd -P)/$(basename "$0")
  tmp=$(mktemp -d) || exit 1
  trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  printf '[postmaster]\npoll_seconds = 1\n' > "$tmp/config.toml"
  POSTMASTER_CONFIG="$tmp/config.toml"; export POSTMASTER_CONFIG
  fails=0 rc=0 out=""
  ok()   { printf '  ok   %s\n' "$1"; }
  fail() { printf '  FAIL %s (exit %s)\n' "$1" "$rc"; printf '%s\n' "$out" | sed 's/^/         /'; fails=$((fails+1)); }
  has()  { case $out in *"$1"*) true ;; *) false ;; esac; }
  watch() { out=$("$self" --timeout 2 "$1" 2>&1); rc=$?; }
  mkrun() {  # mkrun <root> <name> <stage> <leg> [marker...]
    local d="$1/$2" stage=$3 leg=$4 m; shift 4
    mkdir -p "$d/logs"
    printf '{"stage": "%s", "leg": %s}\n' "$stage" "$leg" > "$d/manifest.json"
    : > "$d/run-log.md"
    for m in "$@"; do : > "$d/$m"; done
  }
  age() {  # age <root> <name>: nothing in the run has changed for an hour
    python3 -c 'import os, sys, time
t = time.time() - 3600
for dp, dn, fn in os.walk(sys.argv[1]):
    for f in fn:
        os.utime(os.path.join(dp, f), (t, t))' "$1/$2"
  }

  echo "positive controls: each NEXT that needs the postmaster names its run"
  for spec in \
    "rule review 2 .escalation-ready RULE" \
    "gate shipping 3 .card-ready GATE" \
    "dispatch review 2 .leg-2-done DISPATCH" \
    "remount review 2 .leg-2-exited REMOUNT" \
    "read review 2 .checkpoint-review-ready READ"
  do
    set -- $spec; name=$1 stage=$2 leg=$3 marker=$4 want=$5
    root="$tmp/pos-$name"; mkdir -p "$root"; mkrun "$root" "$name" "$stage" "$leg" "$marker"
    watch "$root"
    [ $rc -eq 0 ] && has "needs $name $want" && has "NEXT" \
      && ok "NEXT $want names $name" \
      || fail "NEXT $want names $name"
  done
  root="$tmp/pos-inspect"; mkdir -p "$root"; mkrun "$root" inspect review 2; age "$root" inspect
  watch "$root"
  [ $rc -eq 0 ] && has "needs inspect INSPECT" \
    && ok "NEXT INSPECT names inspect" || fail "NEXT INSPECT names inspect"

  echo "negative controls: WAIT, USER, - and a held run leave it waiting"
  root="$tmp/neg-wait"; mkdir -p "$root"; mkrun "$root" wait review 2
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && ! has "needs " \
    && ok "a leg at work is left waiting until the timeout" \
    || fail "a leg at work is left waiting until the timeout"
  root="$tmp/neg-user"; mkdir -p "$root"; mkrun "$root" user review 2 .waiting-on-user .leg-2-exited
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && ! has "needs " \
    && ok "a run put to the user is left waiting until the timeout" \
    || fail "a run put to the user is left waiting until the timeout"
  root="$tmp/neg-closed"; mkdir -p "$root"; mkrun "$root" closed done 3 .leg-3-done
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && ! has "needs " \
    && ok "a closed run is left waiting until the timeout" \
    || fail "a closed run is left waiting until the timeout"
  root="$tmp/neg-held"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && ! has "needs " \
    && ok "a run on the held list never needs the postmaster" \
    || fail "a run on the held list never needs the postmaster"
  root="$tmp/neg-mixed"; mkdir -p "$root"
  mkrun "$root" free review 2 .card-ready
  mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"
  watch "$root"
  [ $rc -eq 0 ] && has "needs free GATE" && ! has "needs held" \
    && ok "a held run is left out of the names even beside a waking run" \
    || fail "a held run is left out of the names even beside a waking run"
  root="$tmp/neg-none"; mkdir -p "$root"; mkrun "$root" alone done 1
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "NEXT" && ! has "needs " \
    && ok "an empty timeout still looks once, prints the table and exits 3" \
    || fail "an empty timeout still looks once, prints the table and exits 3"

  echo "usage"
  out=$("$self" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "usage:" && ! has "NEXT" \
    && ok "no run root is refused with the usage" || fail "no run root is refused with the usage"
  out=$("$self" --timeout soon "$tmp/neg-wait" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "not a whole number" \
    && ok "a timeout that is not a number is refused" || fail "a timeout that is not a number is refused"
  out=$("$self" --timeout 2 "$tmp/nowhere" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "no such root" \
    && ok "a run root that does not exist is refused" || fail "a run root that does not exist is refused"
  out=$("$self" --help 2>&1); rc=$?
  [ $rc -eq 0 ] && has "runs-watch.sh" && has "held" \
    && ok "--help prints the usage" || fail "--help prints the usage"

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

ROOT="" TIMEOUT="" CONFIG=${POSTMASTER_CONFIG:-${HOME:-}/.postmaster/config.toml}
while [ $# -gt 0 ]; do
  case $1 in
    --timeout)
      [ $# -ge 2 ] || { echo "usage: runs-watch.sh <project-run-root> [--timeout <seconds>] | --help | --self-test" >&2; exit 1; }
      TIMEOUT=$2; shift ;;
    -*) echo "usage: runs-watch.sh <project-run-root> [--timeout <seconds>] | --help | --self-test" >&2; exit 1 ;;
    *) [ -z "$ROOT" ] || { echo "usage: runs-watch.sh <project-run-root> [--timeout <seconds>] | --help | --self-test" >&2; exit 1; }
       ROOT=$1 ;;
  esac
  shift
done
[ -n "$ROOT" ] || { echo "usage: runs-watch.sh <project-run-root> [--timeout <seconds>] | --help | --self-test" >&2; exit 1; }
if [ -n "$TIMEOUT" ]; then
  case $TIMEOUT in *[!0-9]*) echo "runs-watch: '$TIMEOUT' is not a whole number of seconds" >&2; exit 1 ;; esac
  t=${TIMEOUT#"${TIMEOUT%%[!0]*}"}
  [ ${#t} -le 9 ] || { echo "runs-watch: '$TIMEOUT' is more than 9 digits" >&2; exit 1; }
  TIMEOUT=$((10#$TIMEOUT))
fi
ROOT=$(CDPATH= cd -P -- "$ROOT" 2>/dev/null && pwd -P) || { echo "runs-watch: no such root: $ROOT" >&2; exit 1; }
POLL=$(poll_seconds) || exit 1
[ "$POLL" -ge 1 ] 2>/dev/null || { echo "runs-watch: postmaster.poll_seconds must be a whole number of seconds, 1 or more" >&2; exit 1; }

held="$ROOT/postmaster/held"
left=${TIMEOUT:-}

while :; do
  table=$("$HERE/runs-status.sh" "$ROOT") || { echo "runs-watch: runs-status.sh failed on $ROOT" >&2; exit 1; }
  needs=$(printf '%s\n' "$table" | waking_runs "$held")
  if [ -n "$needs" ]; then
    printf '%s\n' "$table"
    printf '%s\n' "$needs"
    exit 0
  fi
  if [ -n "${TIMEOUT:-}" ] && [ "$left" -le 0 ]; then
    printf '%s\n' "$table"
    exit 3
  fi
  if [ -n "${TIMEOUT:-}" ]; then
    nap=$(( left < POLL ? left : POLL ))
  else
    nap=$POLL
  fi
  sleep "$nap"
  if [ -n "${TIMEOUT:-}" ]; then left=$(( left - nap )); fi
done
