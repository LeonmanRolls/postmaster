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
# It looks at once, then every postmaster.poll_seconds (default 120) from the config
# (POSTMASTER_CONFIG overrides the path). A run needs the postmaster when its NEXT is anything
# but WAIT (a leg at work), USER (already put to the user) or - (closed). A run listed in
# <runs>/postmaster/held, one ticket per line, never does: hold a run by writing its ticket
# there exactly as the RUN column shows it, and release it by removing the line. A held line
# that matches no run warns on stderr. The held list and the config are read on every look,
# so a hold takes effect without restarting the watcher. A missing config, or a poll interval
# that is not usable, gets the default, 120 seconds, which it says; an unset one is silent.
#
# With --timeout, a look that finds nothing for that many seconds prints the table and exits 3;
# the timeout counts the seconds it has slept, so a clock set forward does not end the wait
# early. A count or a timeout is at most 9 digits. Without --timeout it waits until a run needs
# the postmaster.
#
#   exit 0  a run needs the postmaster: the table, then one `needs <run> <NEXT>` line each
#   exit 3  --timeout passed with nothing to act on: the table
#   exit 1  usage, no such root, the held list cannot be read, or a timeout
#           that is not a whole number
#
# Controls: every NEXT that must wake the postmaster names its run on exit 0 (positive), and
# WAIT, USER, -, and a held run leave it waiting until its timeout (negative).
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = --help ] || [ "${1:-}" = -h ]; then usage; exit 0; fi

waking_runs() {  # waking_runs: `needs <run> <NEXT>` per waking run; the table on stdin, held lines in $POSTMASTER_HELD_LINES
  awk '
  BEGIN {
    n = split(ENVIRON["POSTMASTER_HELD_LINES"], lines, "\n")
    for (i = 1; i <= n; i++) {
      line = lines[i]
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line != "") hold[line] = 1
    }
  }
  $1 == "POSTMASTER" { next }
  $1 == "RUN" && $NF == "NEXT" { next }
  NF < 2 { next }
  { seen[$1] = 1 }
  $NF == "USER" || $NF == "WAIT" || $NF == "-" { next }
  $1 in hold { next }
  { print "needs " $1 " " $NF }
  END {
    for (h in hold) if (!(h in seen)) print "runs-watch: held \"" h "\" matches no run" > "/dev/stderr"
  }
  '
}

poll_seconds() {  # poll_seconds: the config's postmaster.poll_seconds, or the default, 120
  python3 - "$CONFIG" <<'PY'
import sys, tomllib
path = sys.argv[1]
try:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
except FileNotFoundError:
    print("runs-watch: no config at %s; the poll interval is the default, 120s" % path, file=sys.stderr)
    print(120); raise SystemExit(0)
except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError) as e:
    print("runs-watch: cannot read %s (%s); the poll interval is the default, 120s" % (path, e), file=sys.stderr)
    print(120); raise SystemExit(0)
pm = cfg.get("postmaster", {})
if not isinstance(pm, dict):
    print("runs-watch: postmaster is %r, not a table; the poll interval is the default, 120s" % (pm,), file=sys.stderr)
    print(120); raise SystemExit(0)
if "poll_seconds" not in pm:
    print(120); raise SystemExit(0)
ps = pm["poll_seconds"]
if isinstance(ps, bool) or not isinstance(ps, int) or not 1 <= ps <= 999999999:
    print("runs-watch: postmaster.poll_seconds is %r, not a whole number of seconds from 1 to 999999999; the poll interval is the default, 120s" % (ps,), file=sys.stderr)
    print(120); raise SystemExit(0)
print(ps)
PY
}

held_lines() {  # held_lines <postmaster-dir>: the held tickets, one per line; nothing when no held file
  python3 - "$1" <<'PY'
import os, sys
d = sys.argv[1]
try:
    names = os.listdir(d)
except FileNotFoundError:
    if os.path.lexists(d):
        print("runs-watch: cannot read %s (dangling link)" % d, file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(0)
except OSError as e:
    print("runs-watch: cannot read %s (%s)" % (d, e), file=sys.stderr)
    raise SystemExit(1)
if "held" not in names:
    raise SystemExit(0)
p = os.path.join(d, "held")
if not os.path.isfile(p):
    print("runs-watch: cannot read %s (not a regular file)" % p, file=sys.stderr)
    raise SystemExit(1)
try:
    with open(p) as f:
        sys.stdout.write(f.read())
except (OSError, ValueError) as e:
    print("runs-watch: cannot read %s (%s)" % (p, e), file=sys.stderr)
    raise SystemExit(1)
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
    "remount review 2 .leg-2-exited RESUME incomplete coachman" \
    "read review 2 .checkpoint-review-ready READ"
  do
    set -- $spec; name=$1 stage=$2 leg=$3 marker=$4 want=$5 outcome=${6:-} role=${7:-}
    root="$tmp/pos-$name"; mkdir -p "$root"; mkrun "$root" "$name" "$stage" "$leg" "$marker"
    if [ -n "$outcome" ]; then
      printf '{"outcome":"%s","role":"%s"}\n' "$outcome" "$role" > "$root/$name/logs/coachman-leg-$leg-attempts.jsonl"
    fi
    watch "$root"
    [ $rc -eq 0 ] && has "needs $name $want" && has "NEXT" \
      && ok "NEXT $want names $name" \
      || fail "NEXT $want names $name"
  done
  root="$tmp/pos-inspect"; mkdir -p "$root"; mkrun "$root" inspect review 2; age "$root" inspect
  watch "$root"
  [ $rc -eq 0 ] && has "needs inspect INSPECT" \
    && ok "NEXT INSPECT names inspect" || fail "NEXT INSPECT names inspect"
  root="$tmp/pos-late"; mkdir -p "$root"; mkrun "$root" late review 2
  "$self" --timeout 10 "$root" > "$tmp/late.out" 2>&1 &
  w=$!; sleep 2; : > "$root/late/.escalation-ready"; wait "$w"; rc=$?
  out=$(cat "$tmp/late.out")
  [ $rc -eq 0 ] && has "needs late RULE" && ! has "the poll interval is the default" \
    && ok "a run that becomes actionable mid-wait is named" \
    || fail "a run that becomes actionable mid-wait is named"
  root="$tmp/pos-multi"; mkdir -p "$root"
  mkrun "$root" first review 2 .escalation-ready
  mkrun "$root" second shipping 3 .card-ready
  watch "$root"
  [ $rc -eq 0 ] && has "needs first RULE" && has "needs second GATE" && has "NEXT" \
    && ok "every waking run is named" || fail "every waking run is named"
  root="$tmp/pos-prompt"; mkdir -p "$root"; mkrun "$root" prompt review 2
  t0=$(date +%s)
  "$self" --timeout 30 "$root" > "$tmp/prompt.out" 2>&1 &
  w=$!; sleep 2; : > "$root/prompt/.escalation-ready"; wait "$w"; rc=$?
  took=$(( $(date +%s) - t0 ))
  out=$(cat "$tmp/prompt.out")
  [ $rc -eq 0 ] && has "needs prompt RULE" && [ "$took" -le 15 ] \
    && ok "a usable poll interval wakes promptly" \
    || fail "a usable poll interval wakes promptly"

  echo "negative controls: WAIT, USER, - and a held run leave it waiting"
  root="$tmp/neg-wait"; mkdir -p "$root"; mkrun "$root" wait review 2
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && has "wait " && has "WAIT" && ! has "needs " \
    && ok "a leg at work is left waiting until the timeout" \
    || fail "a leg at work is left waiting until the timeout"
  root="$tmp/neg-user"; mkdir -p "$root"; mkrun "$root" user review 2 .waiting-on-user .leg-2-exited
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && has "user " && has ".waiting-on-user" && ! has "needs " \
    && ok "a run put to the user is left waiting until the timeout" \
    || fail "a run put to the user is left waiting until the timeout"
  root="$tmp/neg-closed"; mkdir -p "$root"; mkrun "$root" closed done 3 .leg-3-done
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && has "closed " && has ".leg-3-done" && ! has "needs " \
    && ok "a closed run is left waiting until the timeout" \
    || fail "a closed run is left waiting until the timeout"
  root="$tmp/neg-held"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"
  watch "$root"
  [ $rc -eq 3 ] && has "NEXT" && has "held " && has ".escalation-ready" && ! has "needs " && ! has "matches no run" \
    && ok "a run on the held list never needs the postmaster" \
    || fail "a run on the held list never needs the postmaster"
  root="$tmp/neg-heldhash"; mkdir -p "$root"; mkrun "$root" 121 review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf '#121\n' > "$root/postmaster/held"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs 121 RULE" && has "held \"#121\" matches no run" \
    && ok "a #ticket held line warns that it matches no run" || fail "a #ticket held line warns that it matches no run"
  root="$tmp/neg-heldtypo"; mkdir -p "$root"; mkrun "$root" wait review 2
  mkdir -p "$root/postmaster"; printf '999\n' > "$root/postmaster/held"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "wait " && has "held \"999\" matches no run" && ! has "needs " \
    && ok "a held line for no run warns" || fail "a held line for no run warns"
  root="$tmp/neg-mixed"; mkdir -p "$root"
  mkrun "$root" free review 2 .card-ready
  mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"
  watch "$root"
  [ $rc -eq 0 ] && has "needs free GATE" && has "held " && has ".escalation-ready" && ! has "needs held" \
    && ok "a held run is left out of the names even beside a waking run" \
    || fail "a held run is left out of the names even beside a waking run"
  root="$tmp/neg-heldlink"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; ln -s "$tmp/no-such-target" "$root/postmaster/held"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "cannot read" && ! has "needs " \
    && ok "a dangling held link is refused" || fail "a dangling held link is refused"
  root="$tmp/neg-helddir"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster/held"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "cannot read" && ! has "needs " \
    && ok "a held list that is a directory is refused" || fail "a held list that is a directory is refused"
  root="$tmp/neg-heldperm"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"; chmod 000 "$root/postmaster/held"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "cannot read" && ! has "needs " \
    && ok "an unreadable held list is refused" || fail "an unreadable held list is refused"
  chmod 644 "$root/postmaster/held"
  root="$tmp/neg-heldlock"; mkdir -p "$root"; mkrun "$root" held review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"; chmod 000 "$root/postmaster"
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "cannot read" && ! has "needs " \
    && ok "an unlistable postmaster dir is refused" || fail "an unlistable postmaster dir is refused"
  chmod 755 "$root/postmaster"
  root="$tmp/neg-bsroot"; mkdir -p "$root"; mkrun "$root" heldrun review 2 .escalation-ready
  mkdir -p "$root/postmaster"; printf 'heldrun\n' > "$root/postmaster/held"
  bsroot="$tmp/neg-bs\\q"; mv "$root" "$bsroot"
  out=$("$self" --timeout 0 "$bsroot" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "NEXT" && has "heldrun " && ! has "needs " && ! has "warning" \
    && ok "a run root with a backslash still holds its held runs" || fail "a run root with a backslash still holds its held runs"
  root="$tmp/neg-none"; mkdir -p "$root"; mkrun "$root" alone done 1
  out=$("$self" --timeout 0 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "NEXT" && has "alone " && ! has "needs " \
    && ok "an empty timeout still looks once, prints the table and exits 3" \
    || fail "an empty timeout still looks once, prints the table and exits 3"

  echo "config: a missing or unusable poll interval falls back to the default"
  root="$tmp/cfg-missing"; mkdir -p "$root"; mkrun "$root" wait review 2
  out=$(POSTMASTER_CONFIG="$tmp/nowhere.toml" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "NEXT" && has "wait " && ! has "needs " && has "the poll interval is the default, 120s" \
    && ok "a missing config still runs on the default, and says so" \
    || fail "a missing config still runs on the default, and says so"
  printf '[postmaster]\npoll_seconds = "soon"\n' > "$tmp/bad.toml"
  out=$(POSTMASTER_CONFIG="$tmp/bad.toml" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "NEXT" && has "wait " && has "the poll interval is the default, 120s" \
    && ok "an unusable poll interval falls back to the default, and says so" \
    || fail "an unusable poll interval falls back to the default, and says so"
  printf '[postmaster]\npoll_seconds = 0\n' > "$tmp/zero.toml"
  out=$(POSTMASTER_CONFIG="$tmp/zero.toml" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "wait " && has "the poll interval is the default, 120s" \
    && ok "a zero poll interval falls back to the default, and says so" \
    || fail "a zero poll interval falls back to the default, and says so"
  python3 -c "open('$tmp/badutf8.toml','wb').write(b'\xff\xfe\x00bad\x80')"
  out=$(POSTMASTER_CONFIG="$tmp/badutf8.toml" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && has "wait " && has "the poll interval is the default, 120s" && ! has "Traceback" \
    && ok "a config that is not UTF-8 falls back to the default, and says so" \
    || fail "a config that is not UTF-8 falls back to the default, and says so"
  printf '[postmaster]\npoll_seconds = 8\n' > "$tmp/slow.toml"
  t0=$(date +%s)
  out=$(POSTMASTER_CONFIG="$tmp/slow.toml" "$self" --timeout 2 "$root" 2>&1); rc=$?
  took=$(( $(date +%s) - t0 ))
  [ $rc -eq 3 ] && has "wait " && [ "$took" -le 5 ] \
    && ok "a timeout shorter than the poll interval still ends on time" \
    || fail "a timeout shorter than the poll interval still ends on time"

  echo "usage"
  out=$("$self" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "usage:" && ! has "NEXT" \
    && ok "no run root is refused with the usage" || fail "no run root is refused with the usage"
  out=$("$self" --timeout soon "$tmp/neg-wait" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "not a whole number" \
    && ok "a timeout that is not a number is refused" || fail "a timeout that is not a number is refused"
  out=$("$self" --timeout "" "$tmp/neg-wait" 2>&1); rc=$?
  [ $rc -eq 1 ] && has "not a whole number" \
    && ok "an empty timeout is refused" || fail "an empty timeout is refused"
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
      [ -n "$2" ] || { echo "runs-watch: '' is not a whole number of seconds" >&2; exit 1; }
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

pm="$ROOT/postmaster"
left=${TIMEOUT:-}

while :; do
  POLL=$(poll_seconds) || exit 1
  HELD_LIST=$(held_lines "$pm") || exit 1
  table=$("$HERE/runs-status.sh" "$ROOT") || { echo "runs-watch: runs-status.sh failed on $ROOT" >&2; exit 1; }
  needs=$(printf '%s\n' "$table" | POSTMASTER_HELD_LINES="$HELD_LIST" waking_runs)
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
