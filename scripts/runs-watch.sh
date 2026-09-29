#!/usr/bin/env bash
# Take the steps that need no judgment, and wait until a run under a project's run root needs
# the postmaster. Then print runs-status.sh's table, name each run that needs it with its NEXT,
# and exit. This is the loop Stage D keeps in the background. A session that improvises this
# look loses it on a restart and fires on runs it must leave alone.
#
#   runs-watch.sh <project-run-root> [--timeout <seconds>]
#   runs-watch.sh --help
#   runs-watch.sh --self-test
#
# Mechanical steps this script takes itself, logging each through log-action.sh with "the
# watcher took it" in the detail:
#
#   DISPATCH  the leg is done and its hand-off passes handoff-check.sh: dispatch the next leg
#             turnpikes.sh legs lists (Stage C). A hand-off that fails, a turnpikes.sh legs
#             that exits non-zero, no next leg after the ship leg, or a launch it cannot
#             complete are steps it could not complete: they wake the postmaster.
#   REMOUNT   the leg's process ended on a transient provider error the harness adapter names
#             (launch.sh transient): resume it on its own thread with the remount prompt, at
#             most three times per leg (the count is in <run>/.leg-<n>-watch-resumes and
#             survives a restart). A fourth such end, a non-transient end (quota, wall, launch
#             refusal, no thread id), or a resume it cannot complete wakes the postmaster.
#
# Everything that needs judgment still wakes the postmaster: RULE (an escalation), GATE (a
# ship card), READ (a checkpoint card), INSPECT (a stall), and any step the watcher could not
# complete. USER (already put to the user), WAIT (a leg at work) and - (closed) never do.
#
# It looks at once, then every postmaster.poll_seconds (default 120) from the config
# (POSTMASTER_CONFIG overrides the path). A run listed in <runs>/postmaster/held, one ticket
# per line, never is touched: hold a run by writing its ticket there exactly as the RUN column
# shows it, and release it by removing the line. A held line that matches no run warns on
# stderr. The held list and the config are read on every look, so a hold takes effect without
# restarting the watcher. A missing config, or a poll interval that is not usable, gets the
# default, 120 seconds, which it says; an unset one is silent.
#
# With --timeout, a look that finds nothing for that many seconds prints the table and exits 3;
# the timeout counts the seconds it has slept, so a clock set forward does not end the wait
# early. A count or a timeout is at most 9 digits. Without --timeout it waits until a run needs
# the postmaster. Taking a step does not reset the timeout.
#
# POSTMASTER_WATCH_TAKE stages the launch of a dispatch or a resume. When set it is called as
# $POSTMASTER_WATCH_TAKE dispatch|resume <run-dir> <leg> [<next-leg>] and its stdout is the
# thread id (dispatch); exit 0 says the step was taken. Unset, the real host.sh/launch.sh runs.
# The self-test stubs it so no agent thread is ever started.
#
#   exit 0  a run needs the postmaster: the table, then one `needs <run> <NEXT>` line each
#   exit 3  --timeout passed with nothing to act on: the table
#   exit 1  usage, no such root, the held list cannot be read, or a timeout
#           that is not a whole number
#
# Controls: every step it takes (dispatch taken, resume taken) and every NEXT that must wake
# the postmaster names its run on exit 0 (positive), and WAIT, USER, -, and a held run leave
# it waiting until its timeout (negative). A held run is left alone entirely: no step, no
# count, no wake.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

usage() {
  sed -n '2,54p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = --help ] || [ "${1:-}" = -h ]; then usage; exit 0; fi

classify_runs() {  # classify_runs: `kind run leg next` per run; the table on stdin, held lines in $POSTMASTER_HELD_LINES
  # kind is skip (WAIT/USER/-), held, dispatch (a mechanical Stage C), resume (a mechanical
  # remount), or wake (judgment). A held run is never more than held: no step touches it.
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
  NF < 3 { next }
  {
    seen[$1] = 1
    run = $1; leg = $3; nxt = $NF
  }
  $1 in hold { print "held " run " " leg " " nxt; next }
  nxt == "USER" || nxt == "WAIT" || nxt == "-" { print "skip " run " " leg " " nxt; next }
  nxt == "DISPATCH" { print "dispatch " run " " leg " " nxt; next }
  nxt == "REMOUNT" { print "resume " run " " leg " " nxt; next }
  { print "wake " run " " leg " " nxt }
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

# --- taking the mechanical steps ------------------------------------------------------------
# The repo path is the one the run recorded at dispatch (checks.json). A run that has none is
# a step the watcher cannot complete.

repo_of() {  # repo_of <run-dir>: the target repo checks.json recorded, or nothing
  python3 - "$1" <<'PY'
import json, sys
p = sys.argv[1] + "/checks.json"
try:
    d = json.load(open(p))
except (OSError, ValueError):
    raise SystemExit(0)
repo = d.get("repo") if isinstance(d, dict) else None
if isinstance(repo, str) and repo.strip():
    print(repo.strip())
PY
}

leg_job() {  # leg_job <leg-name>: the one line the legs table gives for the job (coachman.md)
  case $1 in
    synthesis) echo "stage 0, stage 1, checkpoint 1" ;;
    review)    echo "stage 2: the waybill's review turnpikes as lenses in one loop, every round to clean" ;;
    ship)      echo "stage 3 and stage 4: gates, preview, QA, the card, the merge on the word, the style sort, teardown" ;;
    *)         echo "$1" ;;
  esac
}

update_manifest() {  # update_manifest <run-dir> <leg> <thread-id> <name>: set coachman.legs.<n> and leg
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, sys
path, leg, thread, name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    m = json.load(open(path + "/manifest.json"))
except (OSError, ValueError) as e:
    print("runs-watch: cannot read %s/manifest.json (%s)" % (path, e), file=sys.stderr); raise SystemExit(1)
legs = m.setdefault("coachman", {}).setdefault("legs", {})
slot = legs.setdefault(str(leg), {})
if thread:
    slot["thread_id"] = thread
slot["name"] = name
m["leg"] = int(leg) if str(leg).isdigit() else leg
try:
    with open(path + "/manifest.json", "w") as f:
        json.dump(m, f); f.write("\n")
except OSError as e:
    print("runs-watch: cannot write %s/manifest.json (%s)" % (path, e), file=sys.stderr); raise SystemExit(1)
PY
}

read_slot() {  # read_slot <run-dir> <leg> <field>: manifest coachman.legs.<leg>.<field>, or nothing
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, leg, field = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    m = json.load(open(path + "/manifest.json"))
except (OSError, ValueError):
    raise SystemExit(0)
slot = ((m.get("coachman") or {}).get("legs") or {}).get(str(leg)) or {}
v = slot.get(field)
if isinstance(v, str) and v:
    print(v)
PY
}

resume_count() {  # resume_count <run-dir> <leg>: watcher resumes so far for this leg (default 0)
  local f="$1/.leg-$2-watch-resumes" n
  [ -f "$f" ] || { echo 0; return 0; }
  n=$(tr -cd '0-9' < "$f"); n=${n:-0}
  n=${n#"${n%%[!0]*}"}; [ -n "$n" ] || n=0
  [ ${#n} -le 9 ] || n=0
  echo "$n"
}

bump_resume_count() {  # bump_resume_count <run-dir> <leg>: count one watcher resume
  local f="$1/.leg-$2-watch-resumes" n
  n=$(resume_count "$1" "$2")
  printf '%s\n' "$((n + 1))" > "$f"
}

take_launch() {  # take_launch <kind> <run-dir> <leg> [<next-leg-number>]: the launch itself; stdout is the thread id
  # POSTMASTER_WATCH_TAKE stages this. Unset, host.sh runs launch.sh in the run's worktree.
  # <leg> is always the leg number the files and markers name; --leg takes the leg's name.
  if [ -n "${POSTMASTER_WATCH_TAKE:-}" ]; then
    "$POSTMASTER_WATCH_TAKE" "$@" 2>/dev/null
    return $?
  fi
  local kind=$1 d=$2 leg=$3 next=${4:-} repo wt name legname tid
  repo=$(repo_of "$d") || return 1
  [ -n "$repo" ] && [ -d "$repo" ] || return 1
  wt="$repo/.worktrees/$(basename "$d")"
  [ -d "$wt" ] || return 1
  case $kind in
    dispatch)
      local n=$next
      [ -n "$n" ] || return 1
      legname=$(leg_name_of "$d" "$n"); [ -n "$legname" ] || return 1
      name=$("$HERE/host.sh" name "$d" coachman 2>/dev/null) || name="$(basename "$d") · coachman"
      "$HERE/host.sh" run "$name" "$wt" \
        --role coachman --run "$d" \
        --out "$d/logs/coachman-leg-$n-events.jsonl" \
        --err "$d/logs/coachman-leg-$n.err" \
        --marker "$d/.leg-$n-exited" \
        -- "$HERE/launch.sh" launch coachman "$wt" "$d/leg-$n-prompt.txt" --leg "$legname" --run "$d" \
        >/dev/null 2>>"$d/logs/coachman-leg-$n.err" || return 1
      # The thread id lands in the stream's first events; give it a moment.
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        tid=$("$HERE/launch.sh" thread-id "$d/logs/coachman-leg-$n-events.jsonl" 2>/dev/null) && [ -n "$tid" ] && { echo "$tid"; return 0; }
        sleep 1
      done
      return 1 ;;
    resume)
      local thread rname stamp
      thread=$(read_slot "$d" "$leg" thread_id) || return 1
      rname=$(read_slot "$d" "$leg" name); rname=${rname:-coachman}
      [ -n "$thread" ] || return 1
      stamp=$(date -u +%Y%m%dT%H%M%SZ)
      # The remount prompt is already written to leg-<n>-resume-<stamp>.txt by try_resume.
      "$HERE/host.sh" run "$("$HERE/host.sh" name "$d" "$rname" 2>/dev/null || echo "$(basename "$d") · $rname")" "$wt" \
        --role coachman --run "$d" --append \
        --out "$d/logs/coachman-leg-$leg-events.jsonl" \
        --err "$d/logs/coachman-leg-$leg.err" \
        --marker "$d/.leg-$leg-exited" \
        -- "$HERE/launch.sh" resume "$rname" "$wt" "$thread" "$d/leg-$leg-resume-$stamp.txt" --leg "$(leg_name_of "$d" "$leg")" --run "$d" \
        >/dev/null 2>>"$d/logs/coachman-leg-$leg.err" || return 1
      echo "$thread"
      return 0 ;;
  esac
  return 1
}

leg_name_of() {  # leg_name_of <run-dir> <leg>: the leg's name from turnpikes.sh legs
  local n
  n=$("$HERE/turnpikes.sh" legs "$1" 2>/dev/null | awk -v k="$2" '$1 == k { print $2; exit }')
  echo "${n:-}"
}

try_dispatch() {  # try_dispatch <run-dir> <leg>: Stage C for the next leg; 0 taken, 1 wake
  local d=$1 leg=$2 next_num next_name prev
  [ -f "$d/handoff-$leg.md" ] || return 1
  "$HERE/handoff-check.sh" "$d/handoff-$leg.md" >/dev/null 2>&1 || return 1
  local legs
  legs=$("$HERE/turnpikes.sh" legs "$d" 2>/dev/null) || return 1
  next_num=$(printf '%s\n' "$legs" | awk -v k="$leg" '$1 > k { print $1; exit }')
  [ -n "$next_num" ] || return 1   # after the ship leg: Stage G is the postmaster's
  next_name=$(printf '%s\n' "$legs" | awk -v k="$next_num" '$1 == k { print $2; exit }')
  [ -n "$next_name" ] || return 1
  prev=$leg
  local prompt="$d/leg-$next_num-prompt.txt" tid
  {
    printf 'You are the coachman for leg %s of %s. Read `%s/brief.md`, then `%s/skills/postmaster/coachman.md`' \
      "$next_num" "$(basename "$d")" "$d" "$HERE/.."
    if [ "$next_num" != 1 ]; then printf ', then `%s/handoff-%s.md`' "$d" "$prev"; fi
    printf '. %s\n' "$(leg_job "$next_name")"
  } > "$prompt"
  tid=$(take_launch dispatch "$d" "$leg" "$next_num") || return 1
  [ -n "$tid" ] || return 1
  update_manifest "$d" "$next_num" "$tid" coachman || return 1
  "$HERE/log-action.sh" "$d" postmaster dispatch "$next_name" \
    "the watcher took it: leg $next_num thread $tid" >/dev/null 2>&1 || true
  return 0
}

try_resume() {  # try_resume <run-dir> <leg>: a transient remount; 0 taken, 1 wake
  local d=$1 leg=$2 count errf stream
  errf="$d/logs/coachman-leg-$leg.err"
  stream="$d/logs/coachman-leg-$leg-events.jsonl"
  # No thread id anywhere is a leg that never started: not a resume, a wake.
  local thread
  thread=$(read_slot "$d" "$leg" thread_id)
  [ -n "$thread" ] || return 1
  "$HERE/launch.sh" transient "$errf" "$stream" >/dev/null 2>&1 || return 1
  count=$(resume_count "$d" "$leg")
  [ "$count" -lt 3 ] || return 1
  local stamp prompt tid
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  prompt="$d/leg-$leg-resume-$stamp.txt"
  printf 'Continue leg %s; your last written state is in the dispatch directory and the worktree\n' "$leg" > "$prompt"
  tid=$(take_launch resume "$d" "$leg") || return 1
  bump_resume_count "$d" "$leg"
  # The step is taken: the exited marker goes with it, or the next look remounts a leg that
  # is already running. host.sh clears it as the launch starts and touches it when it exits.
  rm -f "$d/.leg-$leg-exited"
  "$HERE/log-action.sh" "$d" postmaster resume "$(leg_name_of "$d" "$leg")" \
    "the watcher took it: leg $leg thread ${tid:-$thread} resume $((count + 1)) of 3" >/dev/null 2>&1 || true
  return 0
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
  # The take-step stub: never starts an agent thread. It records its argv and prints a thread id.
  mkdir -p "$tmp/bin"
  printf '#!/bin/sh\necho "$*" >> "%s"\necho "stub-thread-1"\nexit 0\n' "$tmp/stub.log" > "$tmp/bin/take"
  printf '#!/bin/sh\necho "$*" >> "%s"\nexit 1\n' "$tmp/stub.log" > "$tmp/bin/take-fail"
  chmod +x "$tmp/bin/take" "$tmp/bin/take-fail"
  STUB_OK="$tmp/bin/take" STUB_FAIL="$tmp/bin/take-fail"
  : > "$tmp/stub.log"
  handoff() {  # handoff <file>: a hand-off that passes handoff-check.sh
    cat > "$1" <<'H'
## Decisions
None.
## Deferred findings
None.
## Verified by execution
None.
## Unverified
None.
## Branches and lanes
None.
## Open questions
None.
## Next leg
Start here.
H
  }
  waybill() {  # waybill <run-dir> <turnpikes-line>
    printf '# Waybill: T\n%s\n\n## Ticket\nA ticket.\n' "$2" > "$1/brief.md"
  }

  echo "positive controls: each NEXT that needs the postmaster names its run"
  # The DISPATCH and REMOUNT fixtures carry no hand-off and no thread id, so the watcher
  # cannot take those steps and must name them: that is AC3, not a bare naming.
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

  echo "watcher steps: the mechanical ones are taken and logged, and only then does it wait"
  # Dispatch taken: done marker, a hand-off that checks out, a next leg, stub succeeds.
  root="$tmp/step-dispatch"; mkdir -p "$root"
  mkrun "$root" dp review 1 .leg-1-done
  handoff "$root/dp/handoff-1.md"; waybill "$root/dp" "turnpikes: style"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  slog=$(cat "$tmp/stub.log"); alog=$(cat "$root/dp/actions.jsonl" 2>/dev/null)
  [ $rc -eq 3 ] && case $slog in *"dispatch $root/dp 1 2"*) true ;; *) false ;; esac \
    && case $alog in *'"action":"dispatch"'*"the watcher took it"*) true ;; *) false ;; esac \
    && case $alog in *"leg 2 thread stub-thread-1"*) true ;; *) false ;; esac \
    && ! has "needs " \
    && ok "a dispatch the watcher takes logs the watcher and leaves the postmaster asleep" \
    || fail "a dispatch the watcher takes logs the watcher and leaves the postmaster asleep"}
  legnow=$(python3 -c "import json;print(json.load(open('$root/dp/manifest.json'))['leg'])" 2>/dev/null)
  [ "$legnow" = 2 ] && ok "a taken dispatch sets the manifest's leg" || fail "a taken dispatch sets the manifest's leg (got $legnow)"
  [ -f "$root/dp/leg-2-prompt.txt" ] && ok "a taken dispatch writes the next leg's prompt" \
    || fail "a taken dispatch writes the next leg's prompt"

  # Resume taken: exited marker, thread id, a transient provider error, stub succeeds.
  root="$tmp/step-resume"; mkdir -p "$root"
  mkrun "$root" rs review 2 .leg-2-exited
  python3 -c "import json;p='$root/rs/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf 'API Error: model stream idle timeout\n' > "$root/rs/logs/coachman-leg-2.err"
  waybill "$root/rs" "turnpikes: style"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  slog=$(cat "$tmp/stub.log"); alog=$(cat "$root/rs/actions.jsonl" 2>/dev/null)
  [ $rc -eq 3 ] && case $slog in *"resume $root/rs 2"*) true ;; *) false ;; esac \
    && case $alog in *'"action":"resume"'*"the watcher took it"*) true ;; *) false ;; esac \
    && ! has "needs " \
    && ok "a resume the watcher takes logs the watcher and leaves the postmaster asleep" \
    || fail "a resume the watcher takes logs the watcher and leaves the postmaster asleep"
  rcount=$(cat "$root/rs/.leg-2-watch-resumes" 2>/dev/null)
  [ "$rcount" = 1 ] && ok "a taken resume counts itself in the dispatch directory" \
    || fail "a taken resume counts itself in the dispatch directory (got $rcount)"

  echo "watcher steps: anything it cannot complete, and anything that needs judgment, wakes"
  # Hand-off check fails.
  root="$tmp/wake-handoff"; mkdir -p "$root"
  mkrun "$root" hf review 1 .leg-1-done
  waybill "$root/hf" "turnpikes: none"
  : > "$root/hf/handoff-1.md"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs hf DISPATCH" && [ ! -s "$tmp/stub.log" ] \
    && ok "a hand-off that does not check out wakes, and takes no step" \
    || fail "a hand-off that does not check out wakes, and takes no step"
  # turnpikes.sh legs refuses (no turnpikes: line).
  root="$tmp/wake-turnpikes"; mkdir -p "$root"
  mkrun "$root" tp review 1 .leg-1-done
  handoff "$root/tp/handoff-1.md"
  printf '# Waybill: T\n\n## Ticket\nA ticket.\n' > "$root/tp/brief.md"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs tp DISPATCH" && [ ! -s "$tmp/stub.log" ] \
    && ok "a turnpikes.sh legs that exits non-zero wakes, and takes no step" \
    || fail "a turnpikes.sh legs that exits non-zero wakes, and takes no step"
  # No next leg: after the ship leg, Stage G is the postmaster's.
  root="$tmp/wake-close"; mkdir -p "$root"
  mkrun "$root" cl shipping 3 .leg-3-done
  handoff "$root/cl/handoff-3.md"; waybill "$root/cl" "turnpikes: none"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs cl DISPATCH" && [ ! -s "$tmp/stub.log" ] \
    && ok "a done ship leg with nothing after it wakes for the close" \
    || fail "a done ship leg with nothing after it wakes for the close"
  # A launch that is refused.
  root="$tmp/wake-refuse"; mkdir -p "$root"
  mkrun "$root" rf review 1 .leg-1-done
  handoff "$root/rf/handoff-1.md"; waybill "$root/rf" "turnpikes: none"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_FAIL" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs rf DISPATCH" && [ -s "$tmp/stub.log" ] \
    && ok "a launch the watcher cannot start wakes" \
    || fail "a launch the watcher cannot start wakes"
  # A non-transient REMOUNT: a quota wall.
  root="$tmp/wake-wall"; mkdir -p "$root"
  mkrun "$root" wl review 2 .leg-2-exited
  python3 -c "import json;p='$root/wl/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf '402 Payment Required: out of credit\n' > "$root/wl/logs/coachman-leg-2.err"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs wl REMOUNT" && [ ! -s "$tmp/stub.log" ] \
    && ok "a quota wall wakes, and is never resumed" \
    || fail "a quota wall wakes, and is never resumed"
  # A launch refusal in .err.
  root="$tmp/wake-lrefuse"; mkdir -p "$root"
  mkrun "$root" lr review 2 .leg-2-exited
  python3 -c "import json;p='$root/lr/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf "launch: harness 'claude' is not on PATH\n" > "$root/lr/logs/coachman-leg-2.err"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs lr REMOUNT" && [ ! -s "$tmp/stub.log" ] \
    && ok "a launch refusal wakes, and is never resumed" \
    || fail "a launch refusal wakes, and is never resumed"
  # No thread id: the leg never started.
  root="$tmp/wake-nothread"; mkdir -p "$root"
  mkrun "$root" nt review 2 .leg-2-exited
  printf 'API Error: model stream idle timeout\n' > "$root/nt/logs/coachman-leg-2.err"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs nt REMOUNT" && [ ! -s "$tmp/stub.log" ] \
    && ok "a leg with no thread id wakes, and is never resumed" \
    || fail "a leg with no thread id wakes, and is never resumed"
  # The fourth transient end: the count is already three.
  root="$tmp/wake-fourth"; mkdir -p "$root"
  mkrun "$root" ft review 2 .leg-2-exited
  python3 -c "import json;p='$root/ft/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf 'API Error: model stream idle timeout\n' > "$root/ft/logs/coachman-leg-2.err"
  printf '3\n' > "$root/ft/.leg-2-watch-resumes"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs ft REMOUNT" && [ ! -s "$tmp/stub.log" ] \
    && ok "a fourth transient end wakes, and is not resumed" \
    || fail "a fourth transient end wakes, and is not resumed"
  # INSPECT, RULE, GATE and READ still wake (each already has a positive above).
  # A resume that cannot start.
  root="$tmp/wake-resume-fail"; mkdir -p "$root"
  mkrun "$root" rfail review 2 .leg-2-exited
  python3 -c "import json;p='$root/rfail/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf 'API Error: model stream idle timeout\n' > "$root/rfail/logs/coachman-leg-2.err"
  waybill "$root/rfail" "turnpikes: none"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_FAIL" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 0 ] && has "needs rfail REMOUNT" && [ -s "$tmp/stub.log" ] \
    && ok "a resume the watcher cannot start wakes" \
    || fail "a resume the watcher cannot start wakes"

  echo "watcher steps: a held run is left alone entirely"
  root="$tmp/held-alone"; mkdir -p "$root"
  mkrun "$root" held review 2 .leg-2-done .escalation-ready
  handoff "$root/held/handoff-2.md"; waybill "$root/held" "turnpikes: none"
  mkdir -p "$root/postmaster"; printf 'held\n' > "$root/postmaster/held"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && [ ! -s "$tmp/stub.log" ] && [ ! -f "$root/held/actions.jsonl" ] && ! has "needs " \
    && ok "a held run is left alone: no step, no count, no wake" \
    || fail "a held run is left alone: no step, no count, no wake stub: $(cat "$tmp/stub.log")"
  root="$tmp/held-resume"; mkdir -p "$root"
  mkrun "$root" held2 review 2 .leg-2-exited
  python3 -c "import json;p='$root/held2/manifest.json';m=json.load(open(p));m['coachman']={'legs':{'2':{'thread_id':'T-9','name':'coachman'}}};json.dump(m,open(p,'w'))"
  printf 'API Error: model stream idle timeout\n' > "$root/held2/logs/coachman-leg-2.err"
  mkdir -p "$root/postmaster"; printf 'held2\n' > "$root/postmaster/held"
  : > "$tmp/stub.log"
  out=$(POSTMASTER_WATCH_TAKE="$STUB_OK" "$self" --timeout 2 "$root" 2>&1); rc=$?
  [ $rc -eq 3 ] && [ ! -s "$tmp/stub.log" ] && [ ! -f "$root/held2/.leg-2-watch-resumes" ] && ! has "needs " \
    && ok "a held run is never resumed and its count never moves" \
    || fail "a held run is never resumed and its count never moves"

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
  classes=$(printf '%s\n' "$table" | POSTMASTER_HELD_LINES="$HELD_LIST" classify_runs) || {
    echo "runs-watch: cannot classify the runs under $ROOT" >&2; exit 1
  }
  needs=""
  wake() { needs="${needs}needs $1 $3
"; }
  # Take the mechanical steps first. A step that cannot be completed wakes the postmaster
  # with the same NEXT the table showed; a step that is taken is silent, and the loop goes on.
  while read -r kind run leg nxt; do
    [ -n "$kind" ] || continue
    case $kind in
      dispatch)
        if try_dispatch "$ROOT/$run" "$leg"; then
          :
        else
          wake "$run" "$leg" "$nxt"
        fi ;;
      resume)
        if try_resume "$ROOT/$run" "$leg"; then
          :
        else
          wake "$run" "$leg" "$nxt"
        fi ;;
      wake)
        wake "$run" "$leg" "$nxt" ;;
    esac
  done <<EOF
$classes
EOF
  if [ -n "$needs" ]; then
    table=$("$HERE/runs-status.sh" "$ROOT") || table="(runs-status.sh failed)"
    printf '%s\n' "$table"
    printf '%s' "$needs"
    exit 0
  fi
  if [ -n "${TIMEOUT:-}" ] && [ "$left" -le 0 ]; then
    table=$("$HERE/runs-status.sh" "$ROOT") || table="(runs-status.sh failed)"
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
