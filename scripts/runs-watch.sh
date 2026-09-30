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
#             (launch.sh transient, reading only the current launch's stream lines past the
#             skip in <run>/watcher.json): resume it on its own thread with the remount
#             prompt, at most three times per leg (the count is beside the skip and survives
#             a restart). A fourth such end, a non-transient end (quota, wall, launch refusal,
#             no thread id), or a resume it cannot complete wakes the postmaster.
#
# Everything that needs judgment still wakes the postmaster: RULE (an escalation), GATE (a
# ship card), READ (a checkpoint card), INSPECT (a stall), and any step the watcher could not
# complete. USER (already put to the user), WAIT (a leg at work) and - (closed) never do.
#
# It looks at once, then every postmaster.poll_seconds (default 120) from the config
# (POSTMASTER_CONFIG overrides the path). A run listed in <runs>/postmaster/held, one ticket
# per line, is never touched: hold a run by writing its ticket there exactly as the RUN column
# shows it, and release it by removing the line. A held line that matches no run warns on
# stderr. The held list and the config are read on every look, and the held list is re-read
# immediately before every mutation, so a hold takes effect without restarting the watcher.
# A hold that lands mid-step aborts the step: silently before its first mutation, and by
# waking the postmaster with the partial state after one.
# A missing config, or a poll interval that is not usable, gets the default, 120 seconds,
# which it says; an unset one is silent.
#
# With --timeout, a look that finds nothing for that many seconds prints the table and exits 3;
# the timeout counts the seconds it has slept, so a clock set forward does not end the wait
# early. A count or a timeout is at most 9 digits. Without --timeout it waits until a run needs
# the postmaster. Taking a step does not reset the timeout.
#
# POSTMASTER_WATCH_TEST_MODE stages the host boundary for the self-test: with it set to 1,
# launches are recorded under POSTMASTER_WATCH_TEST_CALLS instead of started, the stream is
# faked, and the marker is cleared but never landed, so no agent thread is ever started.
# POSTMASTER_WATCH_TEST_FAIL=dispatch|resume makes that launch fail; =1 on
# POSTMASTER_WATCH_TEST_REFUSE lands a launch refusal instead: =1 a bare refusal,
# =2 a refusal under an uncapped host notice; =1 on
# POSTMASTER_WATCH_TEST_NO_THREAD fakes a stream with no thread id.
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
  sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'
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

is_held_run() {  # is_held_run <run> <postmaster-dir>: refresh the held list immediately before a step
  local held=$1 lines
  lines=$(held_lines "$2") || return 2
  printf '%s\n' "$lines" | awk -v wanted="$held" '
    { line=$0; gsub(/^[ \t]+|[ \t]+$/, "", line); if (line == wanted) found=1 }
    END { exit(found ? 0 : 1) }
  '
}

ACTION_ERROR=""
NEEDS=""
mark_needs() {  # mark_needs <run> <NEXT> [reason]
  local run=$1 next=$2 reason=${3:-}
  NEEDS="${NEEDS}${NEEDS:+$'\n'}needs $run $next"
  [ -z "$reason" ] || printf 'runs-watch: %s %s: %s\n' "$run" "$next" "$reason" >&2
}

repo_from_brief() {  # repo_from_brief <dispatch>: the repo in the waybill's own Project profile, the last one, after the ticket
  python3 - "$1/brief.md" <<'PY'
import re, sys
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        waybill = f.read()
except OSError:
    raise SystemExit(0)
starts = [m.end() for m in re.finditer(r"^## Project profile[ \t]*$", waybill, re.M)]
if not starts:
    raise SystemExit(0)
body = waybill[starts[-1]:]
end = re.search(r"^## ", body, re.M)
m = re.search(r"^repo:[ \t]*(\S.*?)(?:[ \t]{2,}\S.*)?[ \t]*$", body[:end.start()] if end else body, re.M)
if m:
    print(m.group(1).strip())
PY
}

repo_from_checks() {  # repo_from_checks <dispatch>: the repo the run recorded at dispatch
  python3 - "$1/checks.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    raise SystemExit(0)
repo = d.get("repo") if isinstance(d, dict) else None
if isinstance(repo, str) and repo.strip():
    print(repo.strip())
PY
}

run_repo() {  # run_repo <dispatch>: the target repo, from the waybill or the recorded checks
  local repo
  repo=$(repo_from_brief "$1" 2>/dev/null)
  case $repo in /*) printf '%s\n' "$repo"; return 0 ;; esac
  repo=$(repo_from_checks "$1" 2>/dev/null)
  case $repo in /*) printf '%s\n' "$repo"; return 0 ;; esac
  return 1
}

leg_job() {  # leg_job <number>: the one-line job from coachman.md's legs table
  python3 - "$HERE/../skills/postmaster/coachman.md" "$1" <<'PY'
import pathlib, re, sys
path, number = pathlib.Path(sys.argv[1]), sys.argv[2]
for line in path.read_text().splitlines():
    if not line.startswith("|"): continue
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) != 4 or cells[0] != number: continue
    name, covers, ends = (re.sub(r"`", "", value) for value in cells[1:])
    print("Your %s leg covers %s; it ends with %s." % (name, covers, ends))
    raise SystemExit(0)
raise SystemExit(1)
PY
}

manifest_leg() {  # manifest_leg <dispatch> <number> <thread-id-or-empty>: set the active leg and its coachman record
  python3 - "$1/manifest.json" "$2" "$3" <<'PY'
import json, os, pathlib, sys, tempfile
path, number, thread = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
try: manifest = json.loads(path.read_text())
except (OSError, ValueError) as e:
    print("runs-watch: cannot read %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
if not isinstance(manifest, dict):
    print("runs-watch: %s is not a JSON object" % path, file=sys.stderr); raise SystemExit(1)
try:
    coachman = manifest.setdefault("coachman", {})
    legs = coachman.setdefault("legs", {})
    entry = legs.setdefault(number, {})
    if not all(isinstance(x, dict) for x in (coachman, legs, entry)):
        raise ValueError("coachman.legs is not an object")
    manifest["leg"] = int(number)
    entry["name"] = "coachman"
    if thread: entry["thread_id"] = thread
    else: entry.pop("thread_id", None)
except (AttributeError, TypeError, ValueError) as e:
    print("runs-watch: cannot update %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
fd, tmp = tempfile.mkstemp(dir=str(path.parent)); os.close(fd)
try:
    with open(tmp, "w") as f: json.dump(manifest, f, indent=2); f.write("\n")
    os.replace(tmp, path)
except OSError as e:
    try: os.unlink(tmp)
    except OSError: pass
    print("runs-watch: cannot write %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
PY
}

resume_count() {  # resume_count <dispatch> <leg>: prints the persisted automatic-remount count
  python3 - "$1/watcher.json" "$2" <<'PY'
import json, pathlib, sys
path, leg = pathlib.Path(sys.argv[1]), sys.argv[2]
if not path.exists(): print(0); raise SystemExit(0)
try:
    data = json.loads(path.read_text())
    counts = data.get("resume_attempts", {})
    value = counts.get(leg, 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0: raise ValueError("invalid count")
except (OSError, ValueError, AttributeError, TypeError) as e:
    print("runs-watch: cannot read %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
print(value)
PY
}

stream_skip() {  # stream_skip <dispatch> <leg>: the stream lines an earlier launch wrote, to skip when classifying
  python3 - "$1/watcher.json" "$2" <<'PY'
import json, pathlib, sys
path, leg = pathlib.Path(sys.argv[1]), sys.argv[2]
if not path.exists(): print(0); raise SystemExit(0)
try:
    data = json.loads(path.read_text())
    skips = data.get("stream_skip", {})
    value = skips.get(leg, 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0: raise ValueError("invalid skip")
except (OSError, ValueError, AttributeError, TypeError) as e:
    print("runs-watch: cannot read %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
print(value)
PY
}

set_resume_count() {  # set_resume_count <dispatch> <leg> <count> [skip]: atomically persist the count and the stream lines the next launch starts after
  python3 - "$1/watcher.json" "$2" "$3" "${4:-}" <<'PY'
import json, os, pathlib, sys, tempfile
path, leg, skip_arg = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[4]
count = int(sys.argv[3])
try:
    skip = None
    if skip_arg != "":
        skip = int(skip_arg)
        if skip < 0: raise ValueError("negative skip")
    data = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(data, dict): raise ValueError("not an object")
    counts = data.setdefault("resume_attempts", {})
    if not isinstance(counts, dict): raise ValueError("resume_attempts is not an object")
    data["resume_attempts"][leg] = count
    if skip is not None:
        skips = data.setdefault("stream_skip", {})
        if not isinstance(skips, dict): raise ValueError("stream_skip is not an object")
        data["stream_skip"][leg] = skip
except (OSError, ValueError, TypeError) as e:
    print("runs-watch: cannot update %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
fd, tmp = tempfile.mkstemp(dir=str(path.parent)); os.close(fd)
try:
    with open(tmp, "w") as f: json.dump(data, f, indent=2); f.write("\n")
    os.replace(tmp, path)
except OSError as e:
    try: os.unlink(tmp)
    except OSError: pass
    print("runs-watch: cannot write %s: %s" % (path, e), file=sys.stderr); raise SystemExit(1)
PY
}

watch_host() {  # watch_host <dispatch|resume> <name> <cwd> <dispatch-dir> <out> <err> <marker> <append 0|1> -- <launch command>
  local kind=$1 name=$2 cwd=$3 dispatch=$4 out=$5 err=$6 marker=$7 append=$8 callfile
  shift 8
  local command=(run "$name" "$cwd" --role coachman --run "$dispatch")
  [ "$append" = 0 ] || command+=(--append)
  command+=(--out "$out" --err "$err" --marker "$marker" -- "$@")
  if [ "${POSTMASTER_WATCH_TEST_MODE:-}" = 1 ]; then
    [ -n "${POSTMASTER_WATCH_TEST_CALLS:-}" ] || return 1
    local leg_key=${marker##*.leg-}
    leg_key=${leg_key%-exited}
    callfile=$POSTMASTER_WATCH_TEST_CALLS/$kind-$(basename "$dispatch")-$leg_key
    mkdir -p "${POSTMASTER_WATCH_TEST_CALLS:-}" "$(dirname "$out")" "$(dirname "$err")" || return 1
    {
      printf 'kind=%s\nname=%s\ncwd=%s\ndispatch=%s\nout=%s\nerr=%s\nmarker=%s\nappend=%s\nhost_command=' \
        "$kind" "$name" "$cwd" "$dispatch" "$out" "$err" "$marker" "$append"
      printf '%q ' "${command[@]}"; printf '\ncommand='
      printf '%q ' "$@"; printf '\n'
    } > "$callfile"
    rm -f -- "$marker"
    # host.sh run empties --err at every launch, resume included: --append
    # keeps only --out ("Its streams are emptied once ... --err holds only
    # this launch's errors"). The double does the same: .err always holds
    # one launch, so no stale line can survive into the refusal check.
    : > "$err"
    if [ "${POSTMASTER_WATCH_TEST_FAIL:-}" = "$kind" ]; then
      printf 'host: simulated %s failure\n' "$kind" > "$err"
      : > "$marker"
      return 1
    fi
    if [ "${POSTMASTER_WATCH_TEST_REFUSE:-}" = 1 ]; then
      printf 'launch: simulated refusal\n' > "$err"
      : > "$marker"
      return 0
    fi
    if [ "${POSTMASTER_WATCH_TEST_REFUSE:-}" = 2 ]; then
      printf 'host: launch running uncapped (no supported per-launch limits available)\nlaunch: simulated refusal\n' > "$err"
      : > "$marker"
      return 0
    fi
    if [ "$kind" = dispatch ]; then
      if [ "${POSTMASTER_WATCH_TEST_NO_THREAD:-}" = 1 ]; then
        printf '%s\n' '{"type":"result","message":"no session id"}' > "$out"
      else
        printf '%s\n' '{"session_id":"watch-fixture-thread"}' > "$out"
      fi
    else
      printf '%s\n' '{"type":"assistant","message":"continued"}' >> "$out"
    fi
    return 0
  fi
  "$HERE/host.sh" "${command[@]}"
}

no_thread_error() {  # no_thread_error <leg> <marker> <limit> <err> <out> [adapter-out]: the wake reason when no thread id was harvested
  local extra=${6:-}
  if [ -e "$2" ]; then
    printf 'the launch produced no thread id for leg %s; read %s and %s%s' "$1" "$4" "$5" "${extra:+ ($extra)}"
  else
    printf 'the launch produced no thread id within %ss for leg %s and may still be running; read %s and %s%s' "$3" "$1" "$4" "$5" "${extra:+ ($extra)}"
  fi
}

stream_lines() {  # stream_lines <events-file>: the stream's line count, counting an unterminated last line, which wc -l misses
  [ -f "$1" ] && [ -r "$1" ] || { echo 0; return 0; }
  awk 'END{print NR+0}' < "$1"
}

refusal_in() {  # refusal_in <err-file>: the launch: refusal line this launch wrote, if any
  # host.sh empties --err at every launch, resume included, so the whole file
  # is this attempt's: no offset, and no stale line can be in it.
  [ -f "$1" ] || return 1
  sed -n '/^launch:/{p;q;}' "$1"
}

harvest_thread_id() {  # harvest_thread_id <events-file> <marker> <limit>: print the thread id once the stream carries it
  local out=$1 marker=$2 limit=$3 i=0 adapter_out adapter_rc
  while [ $i -lt "$limit" ]; do
    adapter_out=$("$HERE/launch.sh" thread-id "$out" 2>&1)
    adapter_rc=$?
    if [ $adapter_rc -eq 0 ] && [ -n "$adapter_out" ]; then printf '%s\n' "$adapter_out"; return 0; fi
    if [ -e "$marker" ]; then return 1; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

prepare_dispatch() {  # prepare_dispatch <dispatch> <run> <current leg>: dispatch next leg or report why it could not
  local d=$1 run=$2 current=$3 list next job repo worktree prompt host_name out err marker number leg listed
  ACTION_ERROR=""
  if ! list=$("$HERE/turnpikes.sh" legs "$d" 2>&1); then
    ACTION_ERROR="turnpikes.sh legs failed: $list"; return 1
  fi
  # The manifest leg is validated before anything uses it: it must be a canonical
  # integer and one of the run's listed legs. Anything else is reported as corrupt
  # and the run is skipped — never dispatched from, and never allowed near
  # arithmetic that would abort the whole watcher. resume_transient twins the
  # integer check: its awk listed-leg match is numeric, so "02" would match leg
  # 2 there, and only the canonical check reports it corrupt on both paths.
  case $current in ''|*[!0-9]*|0[0-9]*)
    ACTION_ERROR="manifest leg '$current' is not a canonical integer; the run is corrupt"; return 1 ;;
  esac
  listed=$(printf '%s\n' "$list" | awk -v n="$current" '$1 == n { print $2; exit }')
  [ -n "$listed" ] || { ACTION_ERROR="manifest leg $current is not a listed leg; the run is corrupt"; return 1; }
  next=$(printf '%s\n' "$list" | awk -v n="$current" '$1 ~ /^[0-9]+$/ && $1 + 0 > n { print $1 "\t" $2; exit }')
  if [ -z "$next" ]; then ACTION_ERROR="no later leg is listed; Stage G remains with the postmaster"; return 1; fi
  IFS=$'\t' read -r number leg <<< "$next"
  local handoff="$d/handoff-$current.md" check
  check=$("$HERE/handoff-check.sh" "$handoff" 2>&1)
  local check_rc=$?
  if [ $check_rc -ne 0 ]; then ACTION_ERROR="handoff check failed for $handoff (exit $check_rc): $check"; return 1; fi
  repo=$(run_repo "$d") || { ACTION_ERROR="neither the waybill nor the recorded checks name an absolute repo path"; return 1; }
  worktree=$repo/.worktrees/$run
  [ -d "$worktree" ] || { ACTION_ERROR="the synthesis worktree is missing: $worktree"; return 1; }
  job=$(leg_job "$number") || { ACTION_ERROR="coachman.md has no job for leg $number"; return 1; }
  # The Stage C name form names the new leg outright; a host.sh without role labels answers ticket and role.
  host_name=$("$HERE/host.sh" name "$d" coachman "$leg" "$number" 2>&1) || { ACTION_ERROR="host.sh name failed: $host_name"; return 1; }
  prompt="$d/leg-$number-prompt.txt"
  local time_file="${prompt}.tmp.$$"
  local held_rc
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then return 3; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 1; fi
  {
    printf 'You are the coachman for leg %s of %s.\n' "$number" "$run"
    printf 'Read %s/brief.md, then %s/skills/postmaster/coachman.md, then %s/handoff-%s.md.\n' \
      "$d" "$(dirname "$HERE")" "$d" "$current"
    printf '%s\n' "$job"
  } > "$time_file" || { ACTION_ERROR="cannot write the leg prompt: $prompt"; return 1; }
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then rm -f -- "$time_file"; return 3; fi
  if [ $held_rc -ne 1 ]; then rm -f -- "$time_file"; ACTION_ERROR="cannot re-read the held list"; return 1; fi
  mv -f -- "$time_file" "$prompt" || { ACTION_ERROR="cannot install the leg prompt: $prompt"; return 1; }
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then ACTION_ERROR="held mid-step after installing the leg $number prompt; the manifest and the launch are unchanged"; return 1; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 1; fi
  if ! manifest_leg "$d" "$number" ""; then ACTION_ERROR="could not record leg $number in manifest.json"; return 1; fi
  out="$d/logs/coachman-leg-$number-events.jsonl"
  err="$d/logs/coachman-leg-$number.err"
  marker="$d/.leg-$number-exited"
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then ACTION_ERROR="held mid-step after recording leg $number in manifest.json with no launch and no thread"; return 1; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 1; fi
  if ! watch_host dispatch "$host_name" "$worktree" "$d" "$out" "$err" "$marker" 0 \
      "$HERE/launch.sh" launch coachman "$worktree" "$prompt" --leg "$leg" --run "$d"; then
    ACTION_ERROR="host.sh could not start coachman leg $number; read $err"; return 1
  fi
  local thread="" limit=30 adapter_out
  [ "${POSTMASTER_WATCH_TEST_MODE:-}" != 1 ] || limit=1
  if ! thread=$(harvest_thread_id "$out" "$marker" "$limit"); then
    adapter_out=$("$HERE/launch.sh" thread-id "$out" 2>&1) || true
    ACTION_ERROR=$(no_thread_error "$number" "$marker" "$limit" "$err" "$out" "$adapter_out")
    return 1
  fi
  if ! manifest_leg "$d" "$number" "$thread"; then ACTION_ERROR="could not record thread id for leg $number"; return 1; fi
  if [ "$number" -gt $((current + 1)) ]; then
    if ! "$HERE/log-action.sh" "$d" postmaster note "$run" "turnpikes omit the review leg; the watcher followed the listed legs"; then
      ACTION_ERROR="could not log the omitted review leg"; return 1
    fi
  fi
  if ! "$HERE/log-action.sh" "$d" postmaster dispatch coachman "leg $number, thread $thread; the watcher took it"; then
    ACTION_ERROR="could not log dispatch of leg $number"; return 1
  fi
  return 0
}

resume_transient() {  # resume_transient <dispatch> <run> <leg number>
  local d=$1 run=$2 number=$3 err="$1/logs/coachman-leg-$3.err" out="$1/logs/coachman-leg-$3-events.jsonl"
  local info name thread classifier classifier_rc count skip repo worktree host_name prompt stamp held_rc list leg
  ACTION_ERROR=""
  if ! list=$("$HERE/turnpikes.sh" legs "$d" 2>&1); then ACTION_ERROR="turnpikes.sh legs failed: $list"; return 2; fi
  case $number in ''|*[!0-9]*|0[0-9]*)
    ACTION_ERROR="manifest leg '$number' is not a canonical integer; the run is corrupt"; return 2 ;;
  esac
  leg=$(printf '%s\n' "$list" | awk -v n="$number" '$1 == n { print $2; exit }')
  [ -n "$leg" ] || { ACTION_ERROR="turnpikes.sh legs has no entry for current leg $number"; return 2; }
  info=$(python3 - "$d/manifest.json" "$number" <<'PY'
import json, sys
try:
    m=json.load(open(sys.argv[1])); entry=m.get("coachman",{}).get("legs",{}).get(sys.argv[2],{})
    print("%s\t%s" % (entry.get("name", ""), entry.get("thread_id", "")))
except (OSError, ValueError, AttributeError, TypeError): raise SystemExit(1)
PY
  ) || { ACTION_ERROR="cannot read coachman leg $number from manifest.json"; return 2; }
  IFS=$'\t' read -r name thread <<< "$info"
  case $name in coachman|coachman_fallback) ;; *) ACTION_ERROR="leg $number has no recorded coachman name"; return 2 ;; esac
  [ -n "$thread" ] || { ACTION_ERROR="leg $number has no recorded thread id"; return 2; }
  skip=$(stream_skip "$d" "$number") || { ACTION_ERROR="the stream skip for leg $number is unreadable"; return 2; }
  classifier=$("$HERE/launch.sh" transient "$err" "$out" "$skip" 2>&1)
  classifier_rc=$?
  if [ $classifier_rc -ne 0 ]; then ACTION_ERROR="the leg is not eligible for automatic resume (adapter: ${classifier:-exit $classifier_rc}); read $err and the stream tail"; return 2; fi
  count=$(resume_count "$d" "$number") || { ACTION_ERROR="the remount count for leg $number is unreadable"; return 2; }
  if [ "$count" -ge 3 ]; then ACTION_ERROR="leg $number ended on a transient provider error after three watcher resumes"; return 2; fi
  repo=$(run_repo "$d") || { ACTION_ERROR="neither the waybill nor the recorded checks name an absolute repo path"; return 2; }
  worktree=$repo/.worktrees/$run
  [ -d "$worktree" ] || { ACTION_ERROR="the synthesis worktree is missing: $worktree"; return 2; }
  host_name=$("$HERE/host.sh" name "$d" coachman "$leg" "$number" 2>&1) || { ACTION_ERROR="host.sh name failed: $host_name"; return 2; }
  prompt="$d/leg-$number-resume-$(date -u +%Y%m%dT%H%M%SZ).txt"
  while [ -e "$prompt" ]; do
    is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
    if [ $held_rc -eq 0 ]; then return 3; fi
    if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 2; fi
    sleep 1
    prompt="$d/leg-$number-resume-$(date -u +%Y%m%dT%H%M%SZ).txt"
  done
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then return 3; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 2; fi
  printf 'Continue leg %s; your last written state is in the dispatch directory and the worktree.\n' "$number" > "$prompt" \
    || { ACTION_ERROR="cannot write the remount prompt: $prompt"; return 2; }
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then ACTION_ERROR="held mid-step after writing the remount prompt for leg $number; no count, no launch"; return 2; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 2; fi
  if [ -f "$out" ]; then skip=$(stream_lines "$out"); else skip=0; fi
  if ! set_resume_count "$d" "$number" "$((count + 1))" "$skip"; then ACTION_ERROR="cannot persist the remount count for leg $number"; return 2; fi
  is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
  if [ $held_rc -eq 0 ]; then ACTION_ERROR="held mid-step after persisting resume $((count + 1)) for leg $number with no launch"; return 2; fi
  if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot re-read the held list"; return 2; fi
  local launch_args=("$HERE/launch.sh" resume "$name" "$worktree" "$thread" "$prompt" --run "$d")
  [ "$name" != coachman ] || launch_args+=(--leg "$leg")
  # The launch's outcome, the way the dispatch path harvests its own thread
  # id: a host that started the process does not mean the launch took it.
  # .err holds only this launch's errors, so the whole file is read.
  local refusal
  if ! watch_host resume "$host_name" "$worktree" "$d" "$out" "$err" "$d/.leg-$number-exited" 1 "${launch_args[@]}"; then
    ACTION_ERROR="host.sh could not resume leg $number; read $err"; return 2
  fi
  refusal=$(refusal_in "$err" 2>/dev/null || true)
  if [ -n "$refusal" ]; then
    # A refused resume is a refusal, not a success: the count is restored, no
    # success line is written, the refusal is logged, and the run is named in
    # this look. A refusal is deterministic, never retried on its own.
    if ! set_resume_count "$d" "$number" "$count" "$skip"; then ACTION_ERROR="cannot restore the remount count for leg $number"; return 2; fi
    if ! "$HERE/log-action.sh" "$d" postmaster refuse coachman "leg $number, thread $thread, $refusal; the attempt was refused"; then
      ACTION_ERROR="could not log refusal of leg $number"; return 2
    fi
    ACTION_ERROR="launch.sh refused the resume of leg $number ($refusal); read $err"; return 2
  fi
  if ! "$HERE/log-action.sh" "$d" postmaster resume coachman "leg $number, thread $thread, $classifier, resume $((count + 1)) of 3; the watcher took it"; then
    ACTION_ERROR="could not log resume of leg $number"; return 2
  fi
  return 0
}

process_table() {  # process_table <runs-root> <table>: take mechanical steps and fill NEEDS for the postmaster
  local root=$1 table=$2 row run leg next rc held_rc
  ROOT=$root; NEEDS=""
  while IFS= read -r row; do
    run=$(printf '%s\n' "$row" | awk '{print $1}')
    [ -n "$run" ] && [ "$run" != RUN ] && [ "$run" != POSTMASTER ] || continue
    next=$(printf '%s\n' "$row" | awk '{print $NF}')
    leg=$(python3 - "$ROOT/$run/manifest.json" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get("leg", ""))
except Exception: print("")
PY
    )
    is_held_run "$run" "$ROOT/postmaster"; held_rc=$?
    if [ $held_rc -eq 0 ]; then continue; fi
    if [ $held_rc -ne 1 ]; then ACTION_ERROR="cannot read the held list"; return 1; fi
    case $next in
      DISPATCH)
        prepare_dispatch "$ROOT/$run" "$run" "$leg"; rc=$?
        case $rc in 0|3) ;; *) mark_needs "$run" DISPATCH "$ACTION_ERROR" ;; esac ;;
      REMOUNT)
        resume_transient "$ROOT/$run" "$run" "$leg"; rc=$?
        if [ $rc -eq 0 ]; then :
        elif [ $rc -eq 3 ]; then :
        else mark_needs "$run" REMOUNT "$ACTION_ERROR"; fi ;;
      WAIT|USER|-) ;;
      *) mark_needs "$run" "$next" ;;
    esac
  done <<< "$table"
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
  auto_run() {  # auto_run <root> <name> <leg> <thread-id-or-empty>: dispatch-shaped fixture with a recorded claude config
    local root=$1 name=$2 leg=$3 thread=$4 d="$1/$2" repo="$1-project"
    mkdir -p "$d/logs" "$d/audit" "$d/render" "$root/postmaster" "$repo/.worktrees/$name"
    : > "$d/run-log.md"; : > "$d/actions.jsonl"; : > "$root/ledger.jsonl"
    cat > "$d/brief.md" <<EOF
# Waybill: $name
turnpikes: style, bug, security

## Ticket
## Project profile
repo: $repo

## Dispatch
name: #1, Watcher fixture
EOF
    python3 - "$d/manifest.json" "$d/run.json" "$leg" "$thread" <<'PY'
import json, pathlib, sys
manifest, record, leg, thread = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
entry = {"name": "coachman"}
if thread: entry["thread_id"] = thread
manifest.write_text(json.dumps({"stage": "review", "leg": leg, "coachman": {"legs": {str(leg): entry}}}, indent=2) + "\n")
config = {"lanes": {}, "team": {"coachman": {"harness": "claude", "model": "coach-test"}}}
record.write_text(json.dumps({"config": config}, indent=2) + "\n")
PY
  }
  handoff() {  # handoff <dispatch> <leg>: a hand-off with every required section
    local d=$1 n=$2
    printf '## Decisions\nsettled\n## Deferred findings\nnone\n## Verified by execution\nnone\n## Unverified\nnone\n## Branches and lanes\nnone\n## Open questions\nnone\n## Next leg\nnone\n' > "$d/handoff-$n.md"
  }
  watch_stub() {  # watch_stub <root> [dispatch|resume failure|no-thread]: runs the watcher with only its host boundary replaced
    local root=$1 mode=${2:-} extra=""
    case $mode in
      "dispatch failure") extra="POSTMASTER_WATCH_TEST_FAIL=dispatch" ;;
      "resume failure") extra="POSTMASTER_WATCH_TEST_FAIL=resume" ;;
      "dispatch refusal") extra="POSTMASTER_WATCH_TEST_REFUSE=1" ;;
      "resume refusal") extra="POSTMASTER_WATCH_TEST_REFUSE=1" ;;
      "uncapped resume refusal") extra="POSTMASTER_WATCH_TEST_REFUSE=2" ;;
      "no thread") extra="POSTMASTER_WATCH_TEST_NO_THREAD=1" ;;
    esac
    out=$(env POSTMASTER_WATCH_TEST_MODE=1 POSTMASTER_WATCH_TEST_CALLS="$tmp/calls" $extra "$self" --timeout 0 "$root" 2>&1); rc=$?
  }
  watch_stub_wait() {  # watch_stub_wait <root>: several polls under a standing refusal
    out=$(env POSTMASTER_WATCH_TEST_MODE=1 POSTMASTER_WATCH_TEST_CALLS="$tmp/calls" \
      POSTMASTER_WATCH_TEST_REFUSE=1 "$self" --timeout 3 "$1" 2>&1); rc=$?
  }
  action_count() {  # action_count <dispatch> <action>
    python3 - "$1/actions.jsonl" "$2" <<'PY'
import json, pathlib, sys
p=pathlib.Path(sys.argv[1]); action=sys.argv[2]
if not p.exists(): print(0); raise SystemExit(0)
print(sum(1 for line in p.read_text().splitlines() if json.loads(line).get("action") == action))
PY
  }

  echo "positive controls: each NEXT that needs the postmaster names its run"
  for spec in \
    "rule review 2 .escalation-ready RULE" \
    "gate shipping 3 .card-ready GATE" \
    "spec planning 1 .spec-review-ready SPEC" \
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

  echo "thread harvest: the wait for a slow stream"
  printf '%s\n' '{"type":"setup"}' > "$tmp/slow.jsonl"
  ( sleep 2; printf '%s\n' '{"type":"thread.started","thread_id":"slow-thread"}' >> "$tmp/slow.jsonl" ) &
  slow=$!
  got=$(harvest_thread_id "$tmp/slow.jsonl" "$tmp/no-marker" 10); rc_harvest=$?
  wait "$slow"
  [ $rc_harvest -eq 0 ] && [ "$got" = slow-thread ] \
    && ok "an id that lands after the launch is harvested, not missed" \
    || fail "an id that lands after the launch is harvested, not missed"
  : > "$tmp/never.jsonl"; : > "$tmp/dead.marker"
  got=$(harvest_thread_id "$tmp/never.jsonl" "$tmp/dead.marker" 30); rc_harvest=$?
  [ $rc_harvest -eq 1 ] && [ -z "$got" ] \
    && ok "no id with the marker landed stops the wait" \
    || fail "no id with the marker landed stops the wait"
  got=$(no_thread_error 2 "$tmp/dead.marker" 30 "$tmp/e.err" "$tmp/e.out")
  [ "$got" = "the launch produced no thread id for leg 2; read $tmp/e.err and $tmp/e.out" ] \
    && ok "a landed marker wakes without a running process" \
    || fail "a landed marker wakes without a running process"
  got=$(no_thread_error 2 "$tmp/no-marker" 30 "$tmp/e.err" "$tmp/e.out")
  [ "$got" = "the launch produced no thread id within 30s for leg 2 and may still be running; read $tmp/e.err and $tmp/e.out" ] \
    && ok "a missing marker wakes saying the launch may still be running" \
    || fail "a missing marker wakes saying the launch may still be running"
  printf 'a\nb' > "$tmp/unterminated.jsonl"
  printf 'a\nb\n' > "$tmp/terminated.jsonl"
  : > "$tmp/empty.jsonl"
  [ "$(stream_lines "$tmp/unterminated.jsonl")" = 2 ] \
    && [ "$(stream_lines "$tmp/terminated.jsonl")" = 2 ] \
    && [ "$(stream_lines "$tmp/empty.jsonl")" = 0 ] \
    && [ "$(stream_lines "$tmp/no-such.jsonl")" = 0 ] \
    && ok "the skip counts lines, including an unterminated last line" \
    || fail "the skip counts lines, including an unterminated last line"

  echo "watcher steps: dispatch and remount controls"
  mkdir -p "$tmp/calls"
  root="$tmp/auto-dispatch"; auto_run "$root" dispatch 1 ""; handoff "$root/dispatch" 1
  : > "$root/dispatch/.leg-1-done"; : > "$root/dispatch/.leg-1-exited"
  watch_stub "$root"
  python3 - "$root/dispatch/manifest.json" "$root/dispatch/actions.jsonl" <<'PY'
import json, sys
m=json.load(open(sys.argv[1])); rows=[json.loads(x) for x in open(sys.argv[2])]
e=[x for x in rows if x.get("action")=="dispatch"]
assert m["leg"] == 2
assert m["coachman"]["legs"]["2"] == {"name":"coachman", "thread_id":"watch-fixture-thread"}
assert len(e)==1 and "watcher took it" in e[0]["detail"] and "watch-fixture-thread" in e[0]["detail"]
PY
  rc_test=$?
  [ $rc -eq 3 ] && [ $rc_test -eq 0 ] && [ -f "$tmp/calls/dispatch-dispatch-2" ] \
    && grep -qF -- '--role coachman --run' "$tmp/calls/dispatch-dispatch-2" \
    && grep -qF 'launch.sh launch coachman' "$tmp/calls/dispatch-dispatch-2" \
    && grep -qF -- '--leg review --run' "$tmp/calls/dispatch-dispatch-2" \
    && grep -qF 'Your review leg covers stage 2' "$root/dispatch/leg-2-prompt.txt" \
    && grep -qF 'name=' "$tmp/calls/dispatch-dispatch-2" \
    && grep -qF 'coachman' "$tmp/calls/dispatch-dispatch-2" \
    && ok "a checked hand-off dispatches the listed leg, records its thread, and logs watcher ownership without launching an agent in the control" \
    || fail "a checked hand-off dispatches the listed leg, records its thread, and logs watcher ownership without launching an agent in the control"
  root="$tmp/auto-skip-review"; auto_run "$root" skip-review 1 ""; handoff "$root/skip-review" 1
  sed -i 's/^turnpikes:.*/turnpikes: none/' "$root/skip-review/brief.md"
  : > "$root/skip-review/.leg-1-done"; : > "$root/skip-review/.leg-1-exited"
  watch_stub "$root"
  python3 - "$root/skip-review/manifest.json" "$root/skip-review/actions.jsonl" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); rows=[json.loads(x) for x in open(sys.argv[2])]
assert m["leg"] == 3 and m["coachman"]["legs"]["3"]["thread_id"] == "watch-fixture-thread"
assert any(x.get("action")=="note" and "omit the review leg" in x.get("detail","") for x in rows)
assert any(x.get("action")=="dispatch" and "watcher took it" in x.get("detail","") for x in rows)
PY
  rc_test=$?
  [ $rc -eq 3 ] && [ $rc_test -eq 0 ] && [ -f "$tmp/calls/dispatch-skip-review-3" ] \
    && grep -qF -- '--leg ship --run' "$tmp/calls/dispatch-skip-review-3" \
    && ok "the watcher follows a legs list without review and records the omission" \
    || fail "the watcher follows a legs list without review and records the omission"
  root="$tmp/auto-repo-fallback"; auto_run "$root" repo-fallback 1 ""; handoff "$root/repo-fallback" 1
  sed -i '/^repo: /d' "$root/repo-fallback/brief.md"
  python3 - "$root" "$root/repo-fallback/checks.json" <<'PY'
import json, sys
json.dump({"repo": sys.argv[1] + "-project", "head": "fixture", "checks": []},
          open(sys.argv[2], "w"))
PY
  : > "$root/repo-fallback/.leg-1-done"; : > "$root/repo-fallback/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && [ -f "$tmp/calls/dispatch-repo-fallback-2" ] \
    && [ "$(action_count "$root/repo-fallback" dispatch)" -eq 1 ] \
    && ok "a waybill with no repo path dispatches from the recorded checks" \
    || fail "a waybill with no repo path dispatches from the recorded checks"
  root="$tmp/auto-no-repo"; auto_run "$root" no-repo 1 ""; handoff "$root/no-repo" 1
  sed -i '/^repo: /d' "$root/no-repo/brief.md"
  : > "$root/no-repo/.leg-1-done"; : > "$root/no-repo/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs no-repo DISPATCH" && [ ! -e "$tmp/calls/dispatch-no-repo-2" ] \
    && ok "a run with no repo anywhere wakes and launches nothing" \
    || fail "a run with no repo anywhere wakes and launches nothing"
  root="$tmp/auto-one-line"; auto_run "$root" one-line 1 ""; handoff "$root/one-line" 1
  sed -i "s|^repo: \(.*\)|repo: \1          default branch: main       BASE: fixture|" "$root/one-line/brief.md"
  : > "$root/one-line/.leg-1-done"; : > "$root/one-line/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && [ -f "$tmp/calls/dispatch-one-line-2" ] \
    && [ "$(action_count "$root/one-line" dispatch)" -eq 1 ] \
    && ok "a one-line profile dispatches from the repo field alone" \
    || fail "a one-line profile dispatches from the repo field alone"
  root="$tmp/auto-early-profile"; auto_run "$root" early-profile 1 ""; handoff "$root/early-profile" 1
  python3 - "$root/early-profile/brief.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text().replace("## Ticket\n", "## Ticket\n## Problem\nx\n## Project profile\nrepo: /tmp/nowhere-shadow\n\n", 1)
p.write_text(text)
PY
  : > "$root/early-profile/.leg-1-done"; : > "$root/early-profile/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && [ -f "$tmp/calls/dispatch-early-profile-2" ] \
    && ok "a ticket-text profile does not shadow the waybill's own" \
    || fail "a ticket-text profile does not shadow the waybill's own"

  echo "corrupt manifests: reported once, never dispatched from, never fatal"
  for bad in 0 true null 2.0 '[]'; do
    case $bad in 0) s=0;; true) s=True;; null) s=None;; 2.0) s=2.0;; '[]') s='[]';; esac
    root="$tmp/auto-corrupt-$s"; auto_run "$root" bad 1 ""; handoff "$root/bad" "$s"
    python3 - "$root/bad/manifest.json" "$bad" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["leg"] = json.loads(sys.argv[2])
json.dump(m, open(p, "w"), indent=2)
PY
    : > "$root/bad/.leg-$s-done"; : > "$root/bad/.leg-$s-exited"
    mkrun "$root" good review 2 .escalation-ready
    watch_stub "$root"
    still_bad=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["leg"]))' "$root/bad/manifest.json")
    launched=$(find "$tmp/calls" -name 'dispatch-bad-*' | head -1)
    [ $rc -eq 0 ] && has "needs bad DISPATCH" && has "manifest leg" \
      && has "needs good RULE" && [ "$still_bad" = "$bad" ] && [ -z "$launched" ] \
      && ok "corrupt manifest leg $bad is reported, never dispatched, never fatal" \
      || fail "corrupt manifest leg $bad is reported, never dispatched, never fatal"
  done
  echo "leading-zero legs: reported corrupt on the dispatch path, never dispatched from, never fatal"
  for bad in 02 08; do
    root="$tmp/auto-corrupt-$bad"; auto_run "$root" badleg 1 ""; handoff "$root/badleg" "$bad"
    python3 - "$root/badleg/manifest.json" "$bad" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["leg"] = sys.argv[2]
json.dump(m, open(p, "w"), indent=2)
PY
    : > "$root/badleg/.leg-$bad-done"; : > "$root/badleg/.leg-$bad-exited"
    mkrun "$root" good review 2 .escalation-ready
    watch_stub "$root"
    still_bad=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["leg"]))' "$root/badleg/manifest.json")
    launched=$(find "$tmp/calls" -name 'dispatch-badleg-*' | head -1)
    [ $rc -eq 0 ] && has "needs badleg DISPATCH" && has "not a canonical integer" \
      && has "needs good RULE" && [ "$still_bad" = "\"$bad\"" ] && [ -z "$launched" ] \
      && ok "leading-zero leg $bad is reported corrupt, never dispatched, never fatal" \
      || fail "leading-zero leg $bad is reported corrupt, never dispatched, never fatal"
  done
  echo "leading-zero legs: reported corrupt on the remount path, never resumed, never fatal"
  for bad in 02 08; do
    root="$tmp/auto-corrupt-remount-$bad"; auto_run "$root" badremount 1 "thread-badremount"
    python3 - "$root/badremount/manifest.json" "$bad" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["leg"] = sys.argv[2]
json.dump(m, open(p, "w"), indent=2)
PY
    printf '%s\n' 'model stream idle timeout' > "$root/badremount/logs/coachman-leg-$bad.err"
    : > "$root/badremount/logs/coachman-leg-$bad-events.jsonl"; : > "$root/badremount/.leg-$bad-exited"
    mkrun "$root" good review 2 .escalation-ready
    watch_stub "$root"
    launched=$(find "$tmp/calls" -name 'resume-badremount-*' | head -1)
    [ $rc -eq 0 ] && has "needs badremount REMOUNT" && has "not a canonical integer" \
      && has "needs good RULE" && [ -z "$launched" ] \
      && [ ! -e "$root/badremount/watcher.json" ] \
      && ok "leading-zero leg $bad on a remount is reported corrupt, never resumed, never fatal" \
      || fail "leading-zero leg $bad on a remount is reported corrupt, never resumed, never fatal"
  done

  root="$tmp/auto-resume"; auto_run "$root" resume 1 "prior-thread"
  printf '%s\n' 'Model stream idle timeout' > "$root/resume/logs/coachman-leg-1.err"
  : > "$root/resume/logs/coachman-leg-1-events.jsonl"; : > "$root/resume/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && has "resume " \
    && [ "$(action_count "$root/resume" resume)" -eq 1 ] \
    && grep -qF 'watcher took it' "$root/resume/actions.jsonl" \
    && grep -qF 'resume 1 of 3' "$root/resume/actions.jsonl" \
    && grep -qF 'Continue leg 1; your last written state is in the dispatch directory and the worktree.' "$root/resume/leg-1-resume-"*.txt \
    && grep -qF -- '--role coachman --run' "$tmp/calls/resume-resume-1" \
    && grep -qF -- '--append' "$tmp/calls/resume-resume-1" \
    && grep -qF 'launch.sh resume coachman' "$tmp/calls/resume-resume-1" \
    && grep -qF 'prior-thread' "$tmp/calls/resume-resume-1" \
    && [ ! -e "$root/resume/.leg-1-exited" ] \
    && ok "a named transient end resumes the recorded thread with the remount prompt and logs it without launching an agent in the control" \
    || fail "a named transient end resumes the recorded thread with the remount prompt and logs it without launching an agent in the control"
  for attempt in 2 3; do
    printf '%s\n' 'model_stream_idle_timeout' > "$root/resume/logs/coachman-leg-1.err"
    : > "$root/resume/.leg-1-exited"
    watch_stub "$root"
    got=$(python3 - "$root/resume/watcher.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])
PY
    )
    [ $rc -eq 3 ] && [ "$got" = "$attempt" ] && [ "$(action_count "$root/resume" resume)" -eq "$attempt" ] \
      && ok "transient end $attempt is resumed and its per-leg count persists" \
      || fail "transient end $attempt is resumed and its per-leg count persists"
  done
  printf '%s\n' 'model stream idle timeout' > "$root/resume/logs/coachman-leg-1.err"
  : > "$root/resume/.leg-1-exited"
  watch_stub "$root"
  got=$(python3 - "$root/resume/watcher.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])
PY
  )
  [ $rc -eq 0 ] && has "needs resume REMOUNT" && [ "$got" = 3 ] \
    && [ "$(action_count "$root/resume" resume)" -eq 3 ] \
    && ok "the fourth transient end wakes the postmaster without incrementing or resuming" \
    || fail "the fourth transient end wakes the postmaster without incrementing or resuming"
  root="$tmp/auto-stale"; auto_run "$root" stale 1 "thread-stale"
  printf '%s\n' 'model stream idle timeout' > "$root/stale/logs/coachman-leg-1.err"
  printf '%s\n' '{"type":"error","message":"model stream idle timeout"}' > "$root/stale/logs/coachman-leg-1-events.jsonl"
  : > "$root/stale/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && [ "$(action_count "$root/stale" resume)" -eq 1 ] \
    || fail "an old transient error in the stream does not resume a later unrelated failure (setup: no first resume)"
  printf '%s\n' 'AssertionError: something the lane did wrong' > "$root/stale/logs/coachman-leg-1.err"
  : > "$root/stale/.leg-1-exited"
  watch_stub "$root"
  got=$(python3 - "$root/stale/watcher.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])
PY
  )
  [ $rc -eq 0 ] && has "needs stale REMOUNT" && [ "$got" = 1 ] \
    && [ "$(action_count "$root/stale" resume)" -eq 1 ] \
    && ok "an old transient error in the stream does not resume a later unrelated failure" \
    || fail "an old transient error in the stream does not resume a later unrelated failure"
  root="$tmp/auto-unterm"; auto_run "$root" unterm 1 "thread-unterm"
  printf '%s\n' 'model stream idle timeout' > "$root/unterm/logs/coachman-leg-1.err"
  printf '{"type":"assistant","message":"hi"}\n{"type":"error","message":"model stream idle timeout"}' > "$root/unterm/logs/coachman-leg-1-events.jsonl"
  : > "$root/unterm/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 3 ] && [ "$(action_count "$root/unterm" resume)" -eq 1 ] \
    || fail "an unterminated old error stays out of the new classification (setup: no first resume)"
  # The stub always appends; a resumed launch that dies silent appends nothing. Restore the
  # lane's exact shape to model it: the old error last and unterminated, nothing after.
  printf '{"type":"assistant","message":"hi"}\n{"type":"error","message":"model stream idle timeout"}' > "$root/unterm/logs/coachman-leg-1-events.jsonl"
  printf '%s\n' 'AssertionError: something the lane did wrong' > "$root/unterm/logs/coachman-leg-1.err"
  : > "$root/unterm/.leg-1-exited"
  watch_stub "$root"
  got=$(python3 - "$root/unterm/watcher.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print("%s/%s" % (d["resume_attempts"]["1"], d["stream_skip"]["1"]))
PY
  )
  [ $rc -eq 0 ] && has "needs unterm REMOUNT" && [ "$got" = 1/2 ] \
    && [ "$(action_count "$root/unterm" resume)" -eq 1 ] \
    && ok "an unterminated old error stays out of the new classification" \
    || fail "an unterminated old error stays out of the new classification (got $got)"
  for spec in "gateway 529 overloaded" "drop read: connection reset by peer"; do
    set -- $spec; name=$1; message=${spec#* }
    root="$tmp/auto-$name"; auto_run "$root" "$name" 1 "thread-$name"
    printf '%s\n' "$message" > "$root/$name/logs/coachman-leg-1.err"
    : > "$root/$name/logs/coachman-leg-1-events.jsonl"; : > "$root/$name/.leg-1-exited"
    watch_stub "$root"
    [ $rc -eq 3 ] && [ "$(action_count "$root/$name" resume)" -eq 1 ] \
      && [ -f "$tmp/calls/resume-$name-1" ] \
      && ok "a $name failure is resumed as a named transient end" \
      || fail "a $name failure is resumed as a named transient end"
  done

  echo "postmaster wake controls: provider walls and launch refusals"
  for spec in "wall quota exceeded: provider capacity reached" "provider provider wall: model capacity exhausted" "refusal launch: resume needs a thread id"; do
    set -- $spec; name=$1; message=${spec#* }
    root="$tmp/wake-$name"; auto_run "$root" "$name" 1 "thread-$name"
    printf '%s\n' "$message" > "$root/$name/logs/coachman-leg-1.err"
    : > "$root/$name/logs/coachman-leg-1-events.jsonl"; : > "$root/$name/.leg-1-exited"
    watch_stub "$root"
    [ $rc -eq 0 ] && has "needs $name REMOUNT" && [ ! -e "$root/$name/watcher.json" ] \
      && [ ! -e "$tmp/calls/resume-$name-1" ] \
      && ok "$name remains with the postmaster and is not retried" \
      || fail "$name remains with the postmaster and is not retried"
  done
  root="$tmp/wake-other-error"; auto_run "$root" other-error 1 "thread-other"
  printf '%s\n' 'AssertionError: something the lane did wrong' > "$root/other-error/logs/coachman-leg-1.err"
  : > "$root/other-error/logs/coachman-leg-1-events.jsonl"; : > "$root/other-error/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs other-error REMOUNT" \
    && [ ! -e "$root/other-error/watcher.json" ] \
    && [ ! -e "$tmp/calls/resume-other-error-1" ] \
    && ok "an unlisted provider error stays with the postmaster" \
    || fail "an unlisted provider error stays with the postmaster"
  root="$tmp/wake-no-thread-remount"; auto_run "$root" no-thread-remount 1 ""
  printf '%s\n' 'model stream idle timeout' > "$root/no-thread-remount/logs/coachman-leg-1.err"
  : > "$root/no-thread-remount/logs/coachman-leg-1-events.jsonl"; : > "$root/no-thread-remount/.leg-1-exited"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs no-thread-remount REMOUNT" \
    && [ ! -e "$root/no-thread-remount/watcher.json" ] \
    && [ ! -e "$tmp/calls/resume-no-thread-remount-1" ] \
    && ok "a transient end with no recorded thread id stays with the postmaster" \
    || fail "a transient end with no recorded thread id stays with the postmaster"

  echo "postmaster wake controls: incomplete watcher steps"
  root="$tmp/wake-handoff"; auto_run "$root" handoff 1 ""; : > "$root/handoff/.leg-1-done"; : > "$root/handoff/.leg-1-exited"
  printf '## Decisions\nmissing the other required sections\n' > "$root/handoff/handoff-1.md"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs handoff DISPATCH" && [ ! -e "$tmp/calls/dispatch-handoff-2" ] \
    && ok "a failed hand-off check wakes the postmaster and launches nothing" \
    || fail "a failed hand-off check wakes the postmaster and launches nothing"
  root="$tmp/wake-legs"; auto_run "$root" legs 1 ""; : > "$root/legs/.leg-1-done"; : > "$root/legs/.leg-1-exited"
  sed -i 's/^turnpikes:.*/not a turnpikes line/' "$root/legs/brief.md"; handoff "$root/legs" 1
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs legs DISPATCH" && [ ! -e "$tmp/calls/dispatch-legs-2" ] \
    && ok "a failed turnpikes lookup wakes the postmaster and launches nothing" \
    || fail "a failed turnpikes lookup wakes the postmaster and launches nothing"
  root="$tmp/wake-close"; auto_run "$root" close 3 "thread-close"; handoff "$root/close" 3
  sed -i 's/^turnpikes:.*/turnpikes: none/' "$root/close/brief.md"
  : > "$root/close/.leg-3-done"; : > "$root/close/.leg-3-exited"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs close DISPATCH" && [ ! -e "$tmp/calls/dispatch-close-4" ] \
    && ok "a done ship leg with nothing after it wakes for the close" \
    || fail "a done ship leg with nothing after it wakes for the close"
  root="$tmp/wake-dispatch"; auto_run "$root" dispatch-failure 1 ""; handoff "$root/dispatch-failure" 1
  : > "$root/dispatch-failure/.leg-1-done"; : > "$root/dispatch-failure/.leg-1-exited"
  watch_stub "$root" "dispatch failure"
  [ $rc -eq 0 ] && has "needs dispatch-failure DISPATCH" \
    && [ -e "$root/dispatch-failure/.leg-2-exited" ] \
    && ok "a refused host dispatch wakes the postmaster" \
    || fail "a refused host dispatch wakes the postmaster"
  root="$tmp/wake-launch-refusal"; auto_run "$root" launch-refusal 1 ""; handoff "$root/launch-refusal" 1
  : > "$root/launch-refusal/.leg-1-done"; : > "$root/launch-refusal/.leg-1-exited"
  watch_stub "$root" "dispatch refusal"
  [ $rc -eq 0 ] && has "needs launch-refusal DISPATCH" \
    && [ -e "$root/launch-refusal/.leg-2-exited" ] \
    && [ ! -e "$root/launch-refusal/watcher.json" ] \
    && ok "a launch.sh refusal wakes the postmaster" \
    || fail "a launch.sh refusal wakes the postmaster"
  root="$tmp/wake-no-thread"; auto_run "$root" no-thread 1 ""; handoff "$root/no-thread" 1
  : > "$root/no-thread/.leg-1-done"; : > "$root/no-thread/.leg-1-exited"
  watch_stub "$root" "no thread"
  python3 - "$root/no-thread/manifest.json" "$root/no-thread/actions.jsonl" <<'PY'
import json, sys
m=json.load(open(sys.argv[1])); rows=[json.loads(x) for x in open(sys.argv[2])]
assert m["leg"] == 2
assert "thread_id" not in m["coachman"]["legs"]["2"]
assert not [x for x in rows if x.get("action")=="dispatch"]
PY
  rc_test=$?
  [ $rc -eq 0 ] && [ $rc_test -eq 0 ] && has "needs no-thread DISPATCH" \
    && has "may still be running" \
    && [ -f "$tmp/calls/dispatch-no-thread-2" ] \
    && ok "a launch with no readable thread id wakes with the launch already started and unrecorded" \
    || fail "a launch with no readable thread id wakes with the launch already started and unrecorded"
  root="$tmp/wake-resume"; auto_run "$root" resume-failure 1 "thread-resume"
  printf '%s\n' 'model stream idle timeout' > "$root/resume-failure/logs/coachman-leg-1.err"
  : > "$root/resume-failure/logs/coachman-leg-1-events.jsonl"; : > "$root/resume-failure/.leg-1-exited"
  watch_stub "$root" "resume failure"
  [ $rc -eq 0 ] && has "needs resume-failure REMOUNT" \
    && [ "$(action_count "$root/resume-failure" resume)" -eq 0 ] \
    && ok "a refused remount wakes the postmaster" \
    || fail "a refused remount wakes the postmaster"
  root="$tmp/wake-resume-refusal"; auto_run "$root" resume-refusal 1 "thread-resume-refusal"
  printf '%s\n' 'model stream idle timeout' > "$root/resume-refusal/logs/coachman-leg-1.err"
  : > "$root/resume-refusal/logs/coachman-leg-1-events.jsonl"; : > "$root/resume-refusal/.leg-1-exited"
  watch_stub "$root" "resume refusal"
  refused_count=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])' "$root/resume-refusal/watcher.json")
  [ $rc -eq 0 ] && has "needs resume-refusal REMOUNT" \
    && has "launch: simulated refusal" \
    && [ "$(action_count "$root/resume-refusal" refuse)" -eq 1 ] \
    && [ "$(action_count "$root/resume-refusal" resume)" -eq 0 ] \
    && ! grep -q 'watcher took it' "$root/resume-refusal/actions.jsonl" \
    && [ "$refused_count" = 0 ] \
    && ok "a refused resume wakes in the same look with a refusal record, the count unchanged, and no success line" \
    || fail "a refused resume wakes in the same look with a refusal record, the count unchanged, and no success line"
  root="$tmp/wake-resume-refusal-uncapped"; auto_run "$root" refusal-uncapped 1 "thread-refusal-uncapped"
  printf '%s\n' 'host: launch running uncapped (no supported per-launch limits available)' 'model stream idle timeout' > "$root/refusal-uncapped/logs/coachman-leg-1.err"
  : > "$root/refusal-uncapped/logs/coachman-leg-1-events.jsonl"; : > "$root/refusal-uncapped/.leg-1-exited"
  watch_stub "$root" "uncapped resume refusal"
  refused_count=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])' "$root/refusal-uncapped/watcher.json")
  [ $rc -eq 0 ] && has "needs refusal-uncapped REMOUNT" \
    && has "launch: simulated refusal" \
    && [ "$(action_count "$root/refusal-uncapped" refuse)" -eq 1 ] \
    && [ "$(action_count "$root/refusal-uncapped" resume)" -eq 0 ] \
    && [ "$refused_count" = 0 ] \
    && ok "a two-line refusal after a two-line .err is found in the same look" \
    || fail "a two-line refusal after a two-line .err is found in the same look"
  root="$tmp/wake-resume-refusal-shrink"; auto_run "$root" refusal-shrink 1 "thread-refusal-shrink"
  printf '%s\n' 'model stream idle timeout' 'host: launch running uncapped (no supported per-launch limits available)' 'model stream idle timeout' > "$root/refusal-shrink/logs/coachman-leg-1.err"
  : > "$root/refusal-shrink/logs/coachman-leg-1-events.jsonl"; : > "$root/refusal-shrink/.leg-1-exited"
  watch_stub "$root" "uncapped resume refusal"
  refused_count=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])' "$root/refusal-shrink/watcher.json")
  [ $rc -eq 0 ] && has "needs refusal-shrink REMOUNT" \
    && has "launch: simulated refusal" \
    && [ "$(action_count "$root/refusal-shrink" refuse)" -eq 1 ] \
    && [ "$(action_count "$root/refusal-shrink" resume)" -eq 0 ] \
    && [ "$refused_count" = 0 ] \
    && ok "a two-line refusal after a three-line .err is found in the same look" \
    || fail "a two-line refusal after a three-line .err is found in the same look"
  root="$tmp/wake-resume-refusal-many"; auto_run "$root" refusal-many 1 "thread-refusal-many"
  printf '%s\n' 'model stream idle timeout' > "$root/refusal-many/logs/coachman-leg-1.err"
  : > "$root/refusal-many/logs/coachman-leg-1-events.jsonl"; : > "$root/refusal-many/.leg-1-exited"
  watch_stub_wait "$root"
  [ $rc -eq 0 ] && has "needs refusal-many REMOUNT" \
    && [ "$(action_count "$root/refusal-many" refuse)" -ge 1 ] \
    && [ "$(action_count "$root/refusal-many" resume)" -eq 0 ] \
    && [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])' "$root/refusal-many/watcher.json")" = 0 ] \
    && ok "a standing refusal is named every look without spending a remount" \
    || fail "a standing refusal is named every look without spending a remount"
  root="$tmp/wake-log"; auto_run "$root" log-failure 1 ""; handoff "$root/log-failure" 1
  : > "$root/log-failure/.leg-1-done"; : > "$root/log-failure/.leg-1-exited"
  rm -- "$root/log-failure/actions.jsonl"; mkdir "$root/log-failure/actions.jsonl"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs log-failure DISPATCH" \
    && [ -f "$tmp/calls/dispatch-log-failure-2" ] \
    && ok "a dispatch whose action cannot be logged wakes the postmaster" \
    || fail "a dispatch whose action cannot be logged wakes the postmaster"
  root="$tmp/wake-resume-log"; auto_run "$root" resume-log 1 "thread-resume-log"
  printf '%s\n' 'model stream idle timeout' > "$root/resume-log/logs/coachman-leg-1.err"
  : > "$root/resume-log/logs/coachman-leg-1-events.jsonl"; : > "$root/resume-log/.leg-1-exited"
  rm -- "$root/resume-log/actions.jsonl"; mkdir "$root/resume-log/actions.jsonl"
  watch_stub "$root"
  [ $rc -eq 0 ] && has "needs resume-log REMOUNT" \
    && [ -f "$tmp/calls/resume-resume-log-1" ] \
    && [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resume_attempts"]["1"])' "$root/resume-log/watcher.json")" = 1 ] \
    && ok "a resume whose action cannot be logged wakes the postmaster" \
    || fail "a resume whose action cannot be logged wakes the postmaster"

  echo "negative controls: held runs are left untouched"
  root="$tmp/held-dispatch"; auto_run "$root" held-dispatch 1 ""; handoff "$root/held-dispatch" 1
  : > "$root/held-dispatch/.leg-1-done"; : > "$root/held-dispatch/.leg-1-exited"
  printf 'held-dispatch\n' > "$root/postmaster/held"
  watch_stub "$root"
  [ $rc -eq 3 ] && ! has "needs " && [ ! -e "$tmp/calls/dispatch-held-dispatch-2" ] \
    && [ ! -e "$root/held-dispatch/leg-2-prompt.txt" ] \
    && [ ! -e "$root/held-dispatch/watcher.json" ] \
    && [ -e "$root/held-dispatch/.leg-1-done" ] && [ -e "$root/held-dispatch/.leg-1-exited" ] \
    && [ "$(action_count "$root/held-dispatch" dispatch)" -eq 0 ] \
    && [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["leg"])' "$root/held-dispatch/manifest.json")" = 1 ] \
    && ok "a held dispatch run keeps its manifest, markers, log, and files unchanged" \
    || fail "a held dispatch run keeps its manifest, markers, log, and files unchanged"
  root="$tmp/held-resume"; auto_run "$root" held-resume 1 "thread-held"
  printf '%s\n' 'model stream idle timeout' > "$root/held-resume/logs/coachman-leg-1.err"
  : > "$root/held-resume/logs/coachman-leg-1-events.jsonl"; : > "$root/held-resume/.leg-1-exited"
  printf 'held-resume\n' > "$root/postmaster/held"
  watch_stub "$root"
  [ $rc -eq 3 ] && ! has "needs " && [ ! -e "$tmp/calls/resume-held-resume-1" ] \
    && [ ! -e "$root/held-resume/watcher.json" ] \
    && [ -e "$root/held-resume/.leg-1-exited" ] \
    && [ "$(action_count "$root/held-resume" resume)" -eq 0 ] \
    && ok "a held remount run keeps its count, marker, and log unchanged" \
    || fail "a held remount run keeps its count, marker, and log unchanged"

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
  printf '%s\n' "$table" | POSTMASTER_HELD_LINES="$HELD_LIST" waking_runs >/dev/null
  process_table "$ROOT" "$table" || { echo "runs-watch: could not read the held list" >&2; exit 1; }
  table=$("$HERE/runs-status.sh" "$ROOT") || { echo "runs-watch: runs-status.sh failed on $ROOT" >&2; exit 1; }
  if [ -n "$NEEDS" ]; then
    printf '%s\n' "$table"
    printf '%s\n' "$NEEDS"
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
