#!/usr/bin/env bash
# The session host: where a launch runs and how the user watches it. Herdr wherever a Herdr
# server answers, tmux where it does not, and a detached background process with neither.
# skills/postmaster/hosts.md records each form per host; this script is their executable
# form, and the two change together.
#
#   host.sh detect                        herdr, tmux or none, on stdout
#   host.sh name <dispatch> [<role>]      the run's name from its waybill, then " · <role>"
#   host.sh run <name> <cwd> [--out <file>] [--err <file>] [--append] [--marker <file>]
#               [--pidfile <file>] -- <command...>
#   host.sh stop <worktree>               stop every launch still running in a worktree, and
#                                         everything each one started
#   host.sh close <worktree>              close its space (Herdr) and its windows (tmux)
#   host.sh spawn <handle> <cwd> [--label <text>] -- <command...>   an interactive session;
#                                         the handle becomes a Herdr agent name
#   host.sh send <handle> <file> [--wait [<seconds>]]   submit the file's text to that session,
#                                         and with --wait block until it settles (default 600)
#   host.sh wait <handle> [<seconds>]     block until it settles, when nothing was just sent
#   host.sh read <handle> [<lines>]       print what it shows (default 120 lines)
#   host.sh --self-test                   stub hosts on PATH; never touches a live server
#   host.sh --live-test                   the ticket's controls, against the hosts on this machine
#
# run: <command> is the same headless command a caller would otherwise background with `&`. It
# runs from the directory host.sh was called in, with the caller's environment and an empty
# stdin, in a session of its own with no terminal; its stdout goes to --out, added to with
# --append, and its stderr to --err, which holds only this launch's errors. --marker is removed
# as it starts and touched when it exits,
# whatever its exit, and also when host.sh cannot start it, with the reason in --err. --pidfile
# gets its pid, which is also its process group: `kill -- -<pid>` stops all of it. <cwd> is the
# directory the launch belongs to, usually its worktree: in Herdr the launch runs in a new tab of
# that worktree's space, opened with `herdr worktree open` under the repository's space if it is
# not open yet; in tmux in a window of session postmaster-<repo>; with no host, detached from
# the caller. A reviewer's scratch clone (cut-scratch.sh --clone) opens as a space of its own in
# Herdr, and in tmux joins the session of the repository it was cut from. <name> labels the space when host.sh opens it, the tab or window and the pane's
# title, and names the thread where the harness can (POSTMASTER_LAUNCH_NAME, read by launch.sh).
# Pass it as "$(host.sh name <dispatch> <role>)", so a ticket's title never passes through a
# shell. A pane shows the stream through view-stream.sh. A launch carries its own pane's
# identity (HERDR_PANE_ID and the like, or TMUX_PANE), never its caller's. If the host cannot
# place it, it runs in the background. While it runs it is registered under
# POSTMASTER_HOST_STATE (default ~/.postmaster/host), whatever its host, so stop and close see it.
#
# stop: a launch's processes are its process group and everything they started, whatever session
# that moved to, as a harness that runs each tool command in a session of its own does. They are
# found by process id and parent, never by a command line; frozen first, so nothing forks
# between the listing and the signal; sent TERM; and sent KILL if still there after
# POSTMASTER_HOST_STOP_WAIT seconds. The process that ran stop, and those above it, never are.
#
# POSTMASTER_HOST=herdr|tmux|none overrides detection; nothing needs setting to get the default.
# POSTMASTER_HOST_CLAIM_WAIT (20) is how long a new pane has to start its launch,
# POSTMASTER_HOST_CLOSE_WAIT (15) how long close waits for a launch that is just ending, and
# POSTMASTER_HOST_STOP_WAIT (20) how long stop waits after TERM before it sends KILL.
#
#   exit 0  detected, named, started, stopped, closed, sent, settled or read
#   exit 1  usage, or nothing could be started
#   exit 2  close refused: a launch still runs in the worktree, or its space holds something
#           host.sh did not open; or stop left something of a launch running, named
#   exit 3  spawn, send, wait or read with no host that keeps an interactive session; or a send
#           or wait that did not settle, stopped at an approval or a question, or showed no turn
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
SELF=$HERE/$(basename "$0")
SOURCE=custom:postmaster        # Herdr source for a launch's agent state
META=custom:postmaster-meta     # Herdr source for its name and ownership tokens
STATE=${POSTMASTER_HOST_STATE:-$HOME/.postmaster/host}   # where running launches are registered
PANE_IDS="HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID TMUX_PANE"   # which pane a process is in
PLACE_ENV=()                    # --env KEY=VALUE for the pane host.sh opens next (spawn)

die()  { echo "host: $*" >&2; exit 1; }
warn() { echo "host: $*" >&2; }
has()  { command -v "$1" >/dev/null 2>&1; }
limit() { local s=$1; shift; if has timeout; then timeout "$s" "$@"; else "$@"; fi; }
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }   # quote for any shell
clean() { printf '%s' "$1" | tr -d '\000-\037\177'; }   # a label or title, without control characters
count() {  # count <value> <what>: a whole number, so no arithmetic ever sees anything else
  case $1 in ''|*[!0-9]*) die "$2 must be a whole number, not '$1'" ;; esac
  printf '%d\n' "$((10#$1))"
}
json() {  # json <python expression over d, the parsed stdin>; prints it, '' for None
  python3 -c 'import json, sys
d = json.load(sys.stdin)
v = eval(sys.argv[1])
print("" if v is None else v)' "$1"
}

herdr_up() { has herdr && limit 5 herdr workspace list >/dev/null 2>&1; }

detect() {
  local forced=${POSTMASTER_HOST:-}
  case $forced in
    none) echo none; return ;;
    ""|auto|herdr|tmux) ;;
    *) warn "POSTMASTER_HOST=$forced is not herdr, tmux, none or auto; detecting" ;;
  esac
  if [ "$forced" = tmux ]; then
    has tmux && { echo tmux; return; }
    warn "POSTMASTER_HOST=tmux, but tmux is not on PATH; detecting"
  fi
  herdr_up && { echo herdr; return; }
  [ "$forced" = herdr ] && warn "POSTMASTER_HOST=herdr, but no Herdr server answers; detecting"
  has tmux && { echo tmux; return; }
  echo none
}

clone_origin() {  # clone_origin <dir>: for a reviewer's scratch clone, the repository it was cut from
  local k; k=$("$HERE/cut-scratch.sh" --kind "$1" 2>/dev/null) && [ "${k%% *}" = clone ] && printf '%s\n' "${k#clone }"
}
repo_of() {  # repo_of <dir>: the main checkout's path, a scratch clone's origin, or nothing outside a repository
  local common
  clone_origin "$1" && return 0
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  case $common in */.git) dirname "$common" ;; *) printf '%s\n' "$common" ;; esac
}
tmux_session() {  # tmux_session <dir>: postmaster-<repo>, with the characters tmux refuses replaced
  local repo; repo=$(repo_of "$1") || repo=$1
  printf 'postmaster-%s\n' "$(basename "$repo" | tr '.:' '__')"
}
handle_of() {  # handle_of <text>: a Herdr agent name, [a-z][a-z0-9_-]{0,31}, and the tmux window's.
  # Longer text keeps its start and gains a checksum of the whole, so two long names differ.
  local h sum
  h=$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9_-' '-')
  case $h in [a-z]*) ;; *) h=p$h ;; esac
  if [ ${#h} -gt 32 ]; then
    sum=$(printf '%s' "$1" | cksum | cut -d' ' -f1)
    h=$(printf '%s-%08x' "${h:0:23}" "$sum")
  fi
  printf '%s\n' "$h"
}

name_cmd() {  # name <dispatch> [<role>]: the `name:` of the waybill's Dispatch section, else the run
  local d=${1:?usage: host.sh name <dispatch> [<role or lane>]} role=${2:-} n
  n=$(python3 - "$d/brief.md" <<'PY'
import re, sys
try:
    lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
except OSError:
    sys.exit(0)
inside = False
for line in lines:
    if line.startswith("## "):
        inside = line.strip() == "## Dispatch"
    elif inside and line.startswith("name:"):
        print(re.sub(r"\s{2,}\(.*\)$", "", line[5:]).strip())      # a template's trailing note
        break
PY
)
  [ -n "$n" ] || n=$(basename "$d")
  clean "$n${role:+ · $role}"; echo
}

# --- the registry of running launches ------------------------------------------------------
# One file per launch, named for its process group, holding the directory it was placed in and
# its name. A launch is running while any process of its group is alive; the file of one that
# is not is removed by whoever reads it next.
reg_add() { mkdir -p "$STATE/launches" 2>/dev/null && printf '%s\n%s\n' "$2" "$3" > "$STATE/launches/$1"; }
reg_live() {  # reg_live <dir>: "<group>\t<name>" per launch still running that was placed in <dir>
  local f pg cwd name
  for f in "$STATE"/launches/*; do
    [ -f "$f" ] || continue
    pg=${f##*/}
    case $pg in ''|*[!0-9]*) continue ;; esac
    if ! kill -0 -- "-$pg" 2>/dev/null && ! kill -0 "$pg" 2>/dev/null; then rm -f -- "$f"; continue; fi
    { IFS= read -r cwd; IFS= read -r name; } < "$f"
    [ "$cwd" = "$1" ] && printf '%s\t%s\n' "$pg" "$name"
  done
}

# --- Herdr placement ----------------------------------------------------------------------
# herdr_place <name> <cwd> [repo]: find or open the space for <cwd> and a pane in it. With
# `repo`, the pane goes in the repository's own space whatever worktree <cwd> is. Prints
# "<space> <tab> <pane>".
herdr_place() {
  local name=$1 cwd=$2 where=${3:-worktree} top list src="" root="" rname wpath wkind wopen out space tab pane="" opened=0
  top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || top=""
  if [ -n "$top" ] && list=$(herdr worktree list --cwd "$cwd" 2>/dev/null); then
    IFS=$'\t' read -r src root rname wpath wkind wopen < <(printf '%s' "$list" | python3 -c '
import json, os, sys
d = json.load(sys.stdin)["result"]
s = d.get("source") or {}
top = os.path.realpath(sys.argv[1])
w = next((w for w in d.get("worktrees") or [] if os.path.realpath(w["path"]) == top), {})
print("\t".join([s.get("source_workspace_id") or "-", s.get("repo_root") or "-", s.get("repo_name") or "-",
                 w.get("path") or "-", "linked" if w.get("is_linked_worktree") else "main",
                 w.get("open_workspace_id") or "-"]))' "$top")
    [ "$src" = - ] && src=""; [ "$root" = - ] && root=""; [ "${wopen:-}" = - ] && wopen=""
  fi
  if [ -z "$root" ] || [ "${wpath:--}" = - ] || { [ -z "${wopen:-}" ] && clone_origin "$top" >/dev/null; }; then
    # Not a checkout Herdr can read, or a reviewer's scratch clone, which Herdr reads as a
    # repository of its own: a space of the launch's own.
    out=$(herdr workspace create --cwd "$cwd" --label "$name" --no-focus ${PLACE_ENV[@]+"${PLACE_ENV[@]}"}) || return 1
    space=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
    tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
    pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
    opened=1
  else
    if [ -z "$src" ]; then   # the repository has no space yet: open it, so the worktree nests
      out=$(herdr workspace create --cwd "$root" --label "$rname" --no-focus) || return 1
      src=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
    fi
    if [ "$where" = repo ] || [ "$wkind" = main ]; then space=$src
    elif [ -n "$wopen" ]; then space=$wopen
    else
      out=$(herdr worktree open --workspace "$src" --path "$wpath" --label "$name" --no-focus) || return 1
      space=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
      tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
      pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
      herdr tab rename "$tab" "$name" >/dev/null 2>&1
      opened=1
    fi
    if [ -z "$pane" ]; then
      out=$(herdr tab create --workspace "$space" --cwd "$cwd" --label "$name" --no-focus ${PLACE_ENV[@]+"${PLACE_ENV[@]}"}) || return 1
      tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
      pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
    fi
  fi
  [ -n "$space" ] && [ -n "$tab" ] && [ -n "$pane" ] || return 1
  # Ownership, so `close` never closes what host.sh did not open.
  [ "$opened" = 1 ] && herdr workspace report-metadata "$space" --source "$META" --token postmaster=opened >/dev/null 2>&1
  herdr pane report-metadata "$pane" --source "$META" --title "$name" --token postmaster=launch >/dev/null 2>&1
  printf '%s %s %s\n' "$space" "$tab" "$pane"
}

# --- launch plumbing ----------------------------------------------------------------------
# A launch is handed to its runner through a private directory: the fields as files, the argv
# NUL-separated, and for a pane the caller's environment through a FIFO, so it is never written
# to disk or put on any command line. Whoever creates <spec>/claimed first runs it; the runner
# removes the spec once it has read it.
SPEC_FIELDS="name cwd rundir state out err marker pidfile append"
write_spec() {  # write_spec <spec> <name> <cwd> <out> <err> <marker> <pidfile> <append> <argv...>
  local s=$1; shift
  printf '%s' "$1" > "$s/name"; printf '%s' "$2" > "$s/cwd"; printf '%s' "$PWD" > "$s/rundir"
  printf '%s' "$STATE" > "$s/state"; printf '%s' "$3" > "$s/out"; printf '%s' "$4" > "$s/err"
  printf '%s' "$5" > "$s/marker"; printf '%s' "$6" > "$s/pidfile"; printf '%s' "$7" > "$s/append"
  shift 7
  printf '%s\0' "$@" > "$s/argv"
}
drop_spec() {  # drop_spec <spec>: its files, then the directory
  local f
  for f in $SPEC_FIELDS argv env; do rm -f -- "$1/$f"; done
  rmdir -- "$1/claimed" "$1" 2>/dev/null
}
dump_env() { python3 -c 'import os, sys
for k, v in os.environb.items(): sys.stdout.buffer.write(k + b"=" + v + b"\0")'; }

start_env_writer() {  # start_env_writer <fifo>: hand this environment to whoever opens the FIFO,
  # from a process of its own that gives up after 120 s, so the caller never waits on it
  python3 -c 'import os, sys, time
if os.fork(): os._exit(0)
os.setsid()
fd = os.open(os.devnull, os.O_RDWR)
for n in (0, 1, 2): os.dup2(fd, n)
path, data = sys.argv[1], b"".join(k + b"=" + v + b"\0" for k, v in os.environb.items())
deadline = time.time() + 120
while True:
    try:
        out = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
        break
    except OSError:                          # no reader yet, or the spec is gone
        if time.time() > deadline or not os.path.exists(path): os._exit(0)
        time.sleep(0.1)
os.set_blocking(out, True)
while data: data = data[os.write(out, data):]' "$1" </dev/null >/dev/null 2>&1
}
read_env() {  # read_env <fifo>: the caller's environment NUL-separated, then an OK sentinel;
  # nothing but the environment, without the sentinel, if no writer arrives within 30 s
  python3 -c 'import os, signal, sys
signal.signal(signal.SIGALRM, lambda *a: os._exit(1))
signal.alarm(30)
with open(sys.argv[1], "rb") as f: data = f.read()
signal.alarm(0)
sys.stdout.buffer.write(data + b"POSTMASTER_ENV_OK=1\0")' "$1"
}
start_runner_bg() {  # start_runner_bg <spec>: the runner in a session of its own; prints its pid
  python3 -c 'import os, sys
pid = os.fork()
if pid:
    print(pid); sys.stdout.flush(); os._exit(0)
os.setsid()
fd = os.open(os.devnull, os.O_RDWR)
for n in (0, 1, 2): os.dup2(fd, n)
os.execv(sys.argv[1], sys.argv[1:])' "$SELF" _run bg "$1"
}
# The launch itself: a session of its own, so no terminal and no share in the pane's signals,
# and its environment read from fd 3 rather than taken as arguments.
START_CHILD='import os, sys
env = {}
with os.fdopen(3, "rb") as f:
    for kv in f.read().split(b"\0"):
        k, eq, v = kv.partition(b"=")
        if eq: env[k] = v
os.setsid()
try:
    os.execvpe(sys.argv[1], sys.argv[1:], env)
except OSError as e:
    sys.stderr.write("host: cannot run %s: %s\n" % (sys.argv[1], e.strerror)); os._exit(127)'

watch_exit() {  # watch_exit <pid> <marker>: touch the marker once <pid> is gone, from outside the
  # pane, so it lands even when the pane is closed and takes its runner with it
  python3 -c 'import os, sys, time
if os.fork(): os._exit(0)
os.setsid()
pid, marker = int(sys.argv[1]), sys.argv[2]
while True:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        break
    except PermissionError:
        pass
    time.sleep(0.5)
with open(marker, "a"):
    os.utime(marker)' "$1" "$2" </dev/null >/dev/null 2>&1
}

herdr_report() {  # herdr_report <pid> <name>: the pane's launch working while <pid> runs, released after
  # It reports at once, whatever Herdr detects in the pane later. A closing idle report is
  # ignored once an agent has run in the pane, so the end is a release, under the same label.
  local cpid=$1 name=$2
  herdr pane report-agent "$HERDR_PANE_ID" --source "$SOURCE" --agent headless --state working >/dev/null 2>&1
  herdr pane report-metadata "$HERDR_PANE_ID" --source "$META" --title "$name" --display-agent "$name" \
    --token postmaster=launch --token state=running --token pgid="$cpid" >/dev/null 2>&1
  while kill -0 "$cpid" 2>/dev/null; do sleep 0.25; done
  herdr pane release-agent "$HERDR_PANE_ID" --source "$SOURCE" --agent headless >/dev/null 2>&1
  herdr pane report-metadata "$HERDR_PANE_ID" --source "$META" --title "$name" --display-agent "$name" \
    --token postmaster=launch --token state=done --token pgid="$cpid" >/dev/null 2>&1
}

# --- run ----------------------------------------------------------------------------------
FAIL_ERR="" FAIL_MARKER=""
launch_failed() {  # launch_failed <reason>: what a backgrounded launch left when nothing ran, the
  # reason in --err and the marker, so a wait on it ends and a reader finds why
  [ -n "$FAIL_ERR" ] && printf 'host: %s\n' "$1" >> "$FAIL_ERR" 2>/dev/null
  [ -n "$FAIL_MARKER" ] && touch "$FAIL_MARKER" 2>/dev/null
  die "$1"
}

run_cmd() {
  local name=${1:-} cwd=${2:-} out="" err="" marker="" pidfile="" append=0 bad=""
  [ $# -ge 2 ] && shift 2 || set --
  while [ $# -gt 0 ]; do
    case $1 in
      --out|--err|--marker|--pidfile)
        [ $# -ge 2 ] || { bad="$1 needs a file"; break; }
        case $1 in --out) out=$2 ;; --err) err=$2 ;; --marker) marker=$2 ;; --pidfile) pidfile=$2 ;; esac
        shift ;;
      --append) append=1 ;;
      --) shift; break ;;
      *) bad="unknown option for run: $1 (the command goes after --)"; set --; break ;;
    esac
    shift
  done
  abs() { case $1 in ""|/*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
  out=$(abs "$out"); err=$(abs "$err"); marker=$(abs "$marker"); pidfile=$(abs "$pidfile")
  FAIL_ERR=$err FAIL_MARKER=$marker
  [ -z "$bad" ] || launch_failed "$bad"
  [ -n "$name" ] && [ -n "$cwd" ] || launch_failed "usage: host.sh run <name> <cwd> [options] -- <command...>"
  [ $# -gt 0 ] || launch_failed "run needs a command after --"
  [ -d "$cwd" ] || launch_failed "no such directory: $cwd"
  local claim_wait
  claim_wait=$(count "${POSTMASTER_HOST_CLAIM_WAIT:-20}" POSTMASTER_HOST_CLAIM_WAIT) || launch_failed "no launch: POSTMASTER_HOST_CLAIM_WAIT"
  cwd=$(CDPATH= cd -P -- "$cwd" && pwd -P); name=$(clean "$name")
  [ -n "$pidfile" ] && rm -f -- "$pidfile"          # never an earlier launch's pid
  [ -n "$marker" ] && rm -f -- "$marker"            # or its marker

  local spec host where="" rpid=""
  spec=$(mktemp -d "${TMPDIR:-/tmp}/postmaster-host.XXXXXX") || launch_failed "cannot make a spec directory"
  write_spec "$spec" "$name" "$cwd" "$out" "$err" "$marker" "$pidfile" "$append" "$@"
  host=$(detect)
  case $host in
    herdr)
      local placed space tab pane
      if placed=$(herdr_place "$name" "$cwd"); then
        read -r space tab pane <<< "$placed"
        mkfifo "$spec/env" && start_env_writer "$spec/env"
        if herdr pane run "$pane" " $(q "$SELF") _run herdr $(q "$spec")" >/dev/null 2>&1; then
          where="host=herdr space=$space tab=$tab pane=$pane"
        fi
      fi
      [ -n "$where" ] || warn "Herdr could not place '$name'; running it in the background" ;;
    tmux)
      local session win
      session=$(tmux_session "$cwd")
      mkfifo "$spec/env" && start_env_writer "$spec/env"
      if tmux has-session -t "=$session" 2>/dev/null; then
        win=$(tmux new-window -d -P -F '#{window_id}' -t "=$session:" -n "$name" -c "$cwd" \
              bash -c '"$0" _run tmux "$1"; exec "${SHELL:-/bin/sh}"' "$SELF" "$spec" 2>/dev/null)
      else
        win=$(tmux new-session -d -P -F '#{window_id}' -s "$session" -n "$name" -c "$cwd" \
              bash -c '"$0" _run tmux "$1"; exec "${SHELL:-/bin/sh}"' "$SELF" "$spec" 2>/dev/null)
      fi
      if [ -n "$win" ]; then
        tmux set-option -w -t "$win" @postmaster_cwd "$cwd" >/dev/null 2>&1
        tmux set-option -w -t "$win" automatic-rename off >/dev/null 2>&1
        where="host=tmux session=$session window=$win"
      else
        warn "tmux could not open a window for '$name'; running it in the background"
      fi ;;
  esac

  if [ -n "$where" ]; then
    local i=0
    while [ ! -d "$spec/claimed" ] && [ -d "$spec" ] && [ $i -lt $((claim_wait * 4)) ]; do sleep 0.25; i=$((i + 1)); done
    if mkdir "$spec/claimed" 2>/dev/null; then   # the pane never started it: nothing ran yet
      warn "the $host pane did not start '$name' within ${claim_wait}s; running it in the background"
      where=""
    fi
  else
    mkdir "$spec/claimed" 2>/dev/null
  fi
  if [ -z "$where" ]; then
    rpid=$(start_runner_bg "$spec")
    where="host=none"
  fi
  # The runner removes the spec once it has read it and writes the pid file as it starts the
  # command, so a caller can use either once this returns. A background runner that died before
  # taking the spec started nothing, and says so the way any failed launch does.
  local i=0
  while [ -d "$spec" ] && [ $i -lt 120 ]; do
    if [ -n "$rpid" ] && ! kill -0 "$rpid" 2>/dev/null; then break; fi
    sleep 0.25; i=$((i + 1))
  done
  if [ -d "$spec" ] && [ -n "$rpid" ] && ! kill -0 "$rpid" 2>/dev/null; then
    drop_spec "$spec"; launch_failed "'$name' did not start in the background"
  fi
  if [ -n "$pidfile" ] && [ ! -d "$spec" ]; then
    i=0; while [ ! -s "$pidfile" ] && [ $i -lt 40 ]; do sleep 0.25; i=$((i + 1)); done
  fi
  echo "$where"
}

# The runner: _run <herdr|tmux|bg> <spec>. In a pane it claims the launch first; in the
# background the caller has already claimed it.
runner() {
  local mode=$1 spec=$2
  if [ "$mode" != bg ]; then
    mkdir "$spec/claimed" 2>/dev/null || { echo "host: this launch was started elsewhere; nothing to do here."; return 0; }
  fi
  local name cwd rundir out err marker pidfile append argv=() envs=() kv k last=""
  name=$(cat "$spec/name"); cwd=$(cat "$spec/cwd"); rundir=$(cat "$spec/rundir"); STATE=$(cat "$spec/state")
  out=$(cat "$spec/out"); err=$(cat "$spec/err"); marker=$(cat "$spec/marker")
  pidfile=$(cat "$spec/pidfile"); append=$(cat "$spec/append")
  FAIL_ERR=$err FAIL_MARKER=$marker
  while IFS= read -r -d '' kv; do argv+=("$kv"); done < "$spec/argv"
  if [ "$mode" = bg ]; then
    while IFS= read -r -d '' kv; do envs+=("$kv"); done < <(dump_env)
  else
    while IFS= read -r -d '' kv; do envs+=("$kv"); done < <(read_env "$spec/env")
    [ ${#envs[@]} -gt 0 ] && last=${envs[${#envs[@]}-1]}
    if [ "$last" != POSTMASTER_ENV_OK=1 ]; then
      drop_spec "$spec"
      echo "host: the caller's environment never arrived, so '$name' did not start"
      [ -n "$err" ] && printf "host: the caller's environment never arrived, so '%s' did not start\n" "$name" >> "$err"
      [ -n "$marker" ] && touch "$marker"
      return 1
    fi
    unset "envs[${#envs[@]}-1]"
  fi
  drop_spec "$spec"

  # The launch's environment is its caller's, except for identity: which pane it is in comes
  # from where it actually runs, so nothing it reports lands in its caller's pane.
  local drop="POSTMASTER_LAUNCH_NAME $PANE_IDS" keep=""
  case $mode in
    herdr) drop="$drop HERDR_ENV HERDR_SOCKET_PATH HERDR_BIN_PATH"; keep="HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_ENV HERDR_SOCKET_PATH HERDR_BIN_PATH" ;;
    tmux)  drop="$drop TMUX"; keep="TMUX TMUX_PANE" ;;
  esac
  local childenv=()
  for kv in ${envs[@]+"${envs[@]}"}; do
    k=${kv%%=*}
    case " $drop " in *" $k "*) continue ;; esac
    childenv+=("$kv")
  done
  for k in $keep; do [ -n "${!k+x}" ] && childenv+=("$k=${!k}"); done
  childenv+=("POSTMASTER_LAUNCH_NAME=$name")

  # Its streams are emptied once and then only ever appended to, so a second writer on the same
  # file, such as a resume started too soon, cannot overwrite what the first wrote. --append
  # keeps what --out held; --err holds only this launch's errors.
  local o=/dev/null e=/dev/null from=0 cpid rc=0 vpid="" rpid="" t0
  [ "$mode" != bg ] && { o=/dev/stdout; e=/dev/stderr; }
  [ -n "$out" ] && { o=$out; [ "$append" = 1 ] || : > "$out"; }
  [ -n "$err" ] && { e=$err; : > "$err"; }
  [ "$append" = 1 ] && [ -f "$out" ] && from=$(wc -c < "$out" | tr -d ' ')
  t0=$(date +%s)
  ( CDPATH= cd -- "$rundir" && exec python3 -c "$START_CHILD" "${argv[@]}" 3< <(printf '%s\0' "${childenv[@]}") ) \
    >> "$o" 2>> "$e" < /dev/null &
  cpid=$!
  [ -n "$pidfile" ] && printf '%s\n' "$cpid" > "$pidfile"
  reg_add "$cpid" "$cwd" "$name"
  trap 'kill -TERM -- "-$cpid" 2>/dev/null || kill -TERM "$cpid" 2>/dev/null' HUP INT TERM

  if [ "$mode" != bg ]; then
    printf '\033]0;%s\007' "$name"                 # the terminal title, for a pane with an agent
    [ "$mode" = tmux ] && tmux select-pane -t "${TMUX_PANE:-}" -T "$name" >/dev/null 2>&1
    printf '%s\nstarted %s in %s\n' "$name" "$(date '+%H:%M:%S')" "$rundir"
    [ -n "$out" ] && printf 'events: %s\n' "$out"
    printf '%s\n' "----"
    [ -n "$marker" ] && watch_exit "$cpid" "$marker"
    if [ -n "$out" ]; then "$HERE/view-stream.sh" --follow "$out" --pid "$cpid" --from "$from" & vpid=$!; fi
    [ "$mode" = herdr ] && [ -n "${HERDR_PANE_ID:-}" ] && { herdr_report "$cpid" "$name" & rpid=$!; }
    [ "$mode" = tmux ] && tmux set-option -w -t "${TMUX_PANE:-}" @postmaster_state running >/dev/null 2>&1
  fi

  while :; do
    wait "$cpid"; rc=$?
    kill -0 "$cpid" 2>/dev/null || break            # a trapped signal interrupts wait, not the launch
  done
  [ -n "$marker" ] && touch "$marker"
  trap - HUP INT TERM
  kill -0 -- "-$cpid" 2>/dev/null || rm -f -- "$STATE/launches/$cpid"
  [ "$mode" = bg ] && return 0

  [ -n "$vpid" ] && wait "$vpid" 2>/dev/null
  [ -n "$rpid" ] && wait "$rpid" 2>/dev/null
  [ "$mode" = tmux ] && tmux set-option -w -t "${TMUX_PANE:-}" @postmaster_state done >/dev/null 2>&1
  printf '%s\nexit %s at %s after %ss%s\n' "----" "$rc" "$(date '+%H:%M:%S')" "$(( $(date +%s) - t0 ))" \
    "${marker:+, marker $marker}"
  return 0
}

# --- stop and close -----------------------------------------------------------------------
worktree_arg() {  # worktree_arg <dir> <what>: its real path, or die
  [ -n "${1:-}" ] || die "usage: host.sh $2 <worktree>"
  [ -d "$1" ] || die "no such directory: $1"
  (CDPATH= cd -P -- "$1" && pwd -P)
}

stop_cmd() {  # stop <worktree>: every launch still running in it, and all it started, whatever its host
  local path pg name n=0 live groups="" patience out rc
  path=$(worktree_arg "${1:-}" stop) || exit 1
  case $(pwd -P)/ in "$path"/*) die "not stopping the launches in $path from inside it: that stops this session too" ;; esac
  patience=$(count "${POSTMASTER_HOST_STOP_WAIT:-20}" POSTMASTER_HOST_STOP_WAIT) || exit 1
  live=$(reg_live "$path")
  [ -n "$live" ] || { echo "no launch is running in $path"; return 0; }
  while IFS=$'\t' read -r pg name; do groups="$groups $pg"; n=$((n + 1)); done <<< "$live"
  out=$(stop_tree "$patience" $groups); rc=$?
  case $rc in
    0) echo "stopped $n launch(es) in $path: ${out%%$'\t'*} process(es)" ;;
    2) warn "stopped $n launch(es) in $path, but these still run: ${out#*$'\t'}"; return 2 ;;
    *) warn "could not stop the launches in $path: $out"; return 1 ;;
  esac
}
stop_tree() {  # stop_tree <seconds> <group>...: prints "<processes>\t<survivors>"; exits 2 if any survive
  python3 - "$@" <<'PY'
import os, signal, subprocess, sys, time

grace, groups = float(sys.argv[1]), {int(g) for g in sys.argv[2:]}

def table():
    """pid -> (ppid, group, start, zombie, name), from /proc where there is one, else from ps."""
    t = {}
    if os.path.isdir("/proc/self"):
        for pid in os.listdir("/proc"):
            if pid.isdigit():
                try:
                    with open("/proc/%s/stat" % pid) as f:
                        raw = f.read()
                except OSError:
                    continue
                head, _, rest = raw.rpartition(")")
                f = rest.split()   # state ppid pgrp session ... starttime is the 20th after the name
                t[int(pid)] = (int(f[1]), int(f[2]), f[19], f[0] == "Z", head.partition("(")[2])
    else:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,pgid=,stat=,lstart=,comm="],
                             capture_output=True, text=True, env=dict(os.environ, LC_ALL="C")).stdout
        for line in out.splitlines():
            f = line.split(None, 9)
            if len(f) == 10 and f[0].isdigit() and f[1].isdigit() and f[2].isdigit():
                t[int(f[0])] = (int(f[1]), int(f[2]), " ".join(f[4:9]), f[3].startswith("Z"), f[9])
    if os.getpid() not in t:
        print("cannot list processes"); sys.exit(1)
    return t

def tree(t, spare):
    """Every live member of the launches' groups, and every live process descended from one."""
    live = {p for p, v in t.items() if not v[3]} - spare
    hit = {p for p in live if t[p][1] in groups}
    kids = {}
    for p, v in t.items():
        kids.setdefault(v[0], []).append(p)
    todo = list(hit)
    while todo:
        for k in kids.get(todo.pop(), ()):
            if k in live and k not in hit:
                hit.add(k)
                todo.append(k)
    return hit

def sig(pids, s):
    for p in pids:
        try:
            os.kill(p, s)
        except OSError:
            pass

def left(t, spare, known):
    """What is still there: a process signalled before, same pid and start, or one of the tree."""
    return {p for p, st in known.items() if p in t and t[p][2] == st and not t[p][3]} | tree(t, spare)

t = table()
spare, p = {0, 1}, os.getpid()
while p in t and p not in spare:            # this process and every process above it
    spare.add(p)
    p = t[p][0]
frozen = set()
for _ in range(20):
    new = tree(t, spare) - frozen
    if not new:
        break
    sig(new, signal.SIGSTOP)
    frozen |= new
    t = table()
known = {p: t[p][2] for p in frozen if p in t}
sig(known, signal.SIGTERM)
sig(known, signal.SIGCONT)
end = time.time() + grace
while time.time() < end and left(table(), spare, known):
    time.sleep(0.25)
end = time.time() + 5
while True:
    t = table()
    rest = left(t, spare, known)
    if not rest or time.time() >= end:
        break
    sig(rest, signal.SIGKILL)               # KILL ends a stopped process too
    known.update({p: t[p][2] for p in rest})
    time.sleep(0.25)
print("%d\t%s" % (len(known), " ".join("%d/%s" % (p, t[p][4]) for p in sorted(rest))))
sys.exit(2 if rest else 0)
PY
}

close_cmd() {  # close <worktree>: refuse while a launch runs there; then its windows and its space
  local path live i=0 rc=0 patience
  path=$(worktree_arg "${1:-}" close) || exit 1
  patience=$(count "${POSTMASTER_HOST_CLOSE_WAIT:-15}" POSTMASTER_HOST_CLOSE_WAIT) || exit 1
  while live=$(reg_live "$path"); [ -n "$live" ]; do   # one whose marker just landed ends a moment later
    if [ $i -ge "$patience" ]; then
      warn "a launch is still running in $path: $(printf '%s\n' "$live" | cut -f2 | tr '\n' ';' | sed 's/;$//')"
      return 2
    fi
    sleep 1; i=$((i + 1))
  done
  if has tmux; then close_tmux "$path" || rc=$?; fi
  if herdr_up; then close_herdr "$path" || rc=$?; fi
  [ $rc -eq 0 ] && echo "closed what host.sh opened for $path"
  return $rc
}
close_tmux() {
  local session w cwd n=0
  session=$(tmux_session "$1")
  tmux has-session -t "=$session" 2>/dev/null || return 0
  while IFS=$'\t' read -r w cwd; do
    [ -n "$w" ] && [ "$cwd" = "$1" ] && tmux kill-window -t "$w" 2>/dev/null && n=$((n + 1))
  done < <(tmux list-windows -t "=$session" -F '#{window_id}	#{@postmaster_cwd}' 2>/dev/null)
  [ $n -gt 0 ] && echo "host=tmux: closed $n window(s)"
  return 0
}
close_herdr() {
  local list space kind verdict
  list=$(herdr worktree list --cwd "$1" 2>/dev/null) || return 0
  read -r space kind < <(printf '%s' "$list" | python3 -c '
import json, os, sys
d = json.load(sys.stdin)["result"]
p = os.path.realpath(sys.argv[1])
w = next((w for w in d.get("worktrees") or [] if os.path.realpath(w["path"]) == p), {})
print(w.get("open_workspace_id") or "-", "linked" if w.get("is_linked_worktree") else "main")' "$1")
  [ "$space" = - ] && return 0
  [ "$kind" = main ] && ! clone_origin "$1" >/dev/null \
    && { warn "$1 is a repository's own checkout; its space is never closed"; return 2; }
  verdict=$(python3 -c '
import json, sys
ws = json.loads(sys.argv[1])["result"]["workspace"]
if (ws.get("tokens") or {}).get("postmaster") != "opened":
    print("space %s was not opened by host.sh" % ws["workspace_id"]); sys.exit(0)
for p in json.loads(sys.argv[2])["result"]["panes"]:
    if (p.get("tokens") or {}).get("postmaster") != "launch":
        print("pane %s in space %s was not opened by host.sh" % (p["pane_id"], ws["workspace_id"])); sys.exit(0)
print("ok")' "$(herdr workspace get "$space" 2>/dev/null)" "$(herdr pane list --workspace "$space" 2>/dev/null)" 2>/dev/null)
  [ "$verdict" = ok ] || { warn "${verdict:-could not read space $space}; left open"; return 2; }
  herdr workspace close "$space" >/dev/null || die "herdr could not close space $space"
  echo "host=herdr: closed space $space"
}

# --- interactive sessions -----------------------------------------------------------------
no_session_host() {
  echo "host: no Herdr or tmux here to keep an interactive session; run it headless as a native session (hosts.md, none)" >&2
  exit 3
}
is_kind() {  # is_kind <name>: an agent kind this Herdr can start, from its own help (which exits 2)
  local help; help=$(herdr agent 2>&1)
  printf '%s\n' "$help" | sed -n 's/^ *kinds: //p' | tr '|' '\n' | grep -qxF "$1"
}
tmux_target() {  # tmux_target <handle>: the one window with that name, in any session
  local hits
  hits=$(tmux list-windows -a -F '#{window_id}	#{window_name}' 2>/dev/null | awk -F'\t' -v h="$1" '$2 == h {print $1}')
  [ -n "$hits" ] || die "no tmux window named $1"
  [ "$(printf '%s\n' "$hits" | wc -l | tr -d ' ')" -eq 1 ] || die "more than one tmux window is named $1"
  printf '%s\n' "$hits"
}

spawn_cmd() {
  local handle=${1:-} cwd=${2:-} label="" v err code placed space tab pane kind cmd a session win
  [ -n "$handle" ] && [ -n "$cwd" ] || die "usage: host.sh spawn <handle> <cwd> [--label <text>] -- <command...>"
  shift 2
  while [ $# -gt 0 ]; do
    case $1 in --label) label=${2:?--label needs text}; shift ;; --) shift; break ;; *) die "unknown option for spawn: $1" ;; esac
    shift
  done
  [ $# -gt 0 ] || die "spawn needs a command after --"
  [ -d "$cwd" ] || die "no such directory: $cwd"
  cwd=$(CDPATH= cd -P -- "$cwd" && pwd -P); label=$(clean "${label:-$handle}"); handle=$(handle_of "$handle")
  # The caller's own settings for the flow reach the session, as they reach every launch.
  local tmux_env=()
  PLACE_ENV=()
  for v in $(compgen -e | grep '^POSTMASTER_'); do PLACE_ENV+=(--env "$v=${!v}"); tmux_env+=(-e "$v=${!v}"); done
  case $(detect) in
    herdr)
      herdr agent get "$handle" >/dev/null 2>&1 && die "a live Herdr agent is already named $handle; spawn under another handle"
      placed=$(herdr_place "$label" "$cwd" repo) || die "Herdr could not open a tab for $handle"
      read -r space tab pane <<< "$placed"
      kind=$(basename "$1")
      if is_kind "$kind"; then
        shift
        if ! err=$(herdr agent start "$handle" --kind "$kind" --pane "$pane" -- "$@" 2>&1 >/dev/null); then
          code=$(printf '%s' "$err" | json 'd["error"]["code"]' 2>/dev/null)
          case $code in
            agent_not_ready) warn "$handle is asking something before it takes a message; the user answers it in space $space, then send" ;;
            *) die "herdr could not start $handle: ${code:-$err}" ;;
          esac
        fi
      else
        cmd=""; for a in "$@"; do cmd="$cmd $(q "$a")"; done
        herdr pane run "$pane" "$cmd" >/dev/null || die "herdr could not start $handle"
        herdr agent rename "$pane" "$handle" >/dev/null 2>&1
      fi
      echo "host=herdr space=$space tab=$tab pane=$pane handle=$handle" ;;
    tmux)
      [ "$(tmux list-windows -a -F '#{window_name}' 2>/dev/null | grep -cxF "$handle")" -eq 0 ] \
        || die "a tmux window is already named $handle; spawn under another handle"
      session=$(tmux_session "$cwd")
      if tmux has-session -t "=$session" 2>/dev/null; then
        win=$(tmux new-window -d -P -F '#{window_id}' -t "=$session:" ${tmux_env[@]+"${tmux_env[@]}"} -n "$handle" -c "$cwd" "$@")
      else
        win=$(tmux new-session -d -P -F '#{window_id}' -s "$session" ${tmux_env[@]+"${tmux_env[@]}"} -n "$handle" -c "$cwd" "$@")
      fi
      [ -n "$win" ] || die "tmux could not start $handle"
      tmux set-option -w -t "$win" automatic-rename off >/dev/null 2>&1
      echo "host=tmux session=$session window=$win handle=$handle" ;;
    none) no_session_host ;;
  esac
}

send_cmd() {  # send <handle> <file> [--wait [<seconds>]]
  local handle=${1:-} file=${2:-} waitfor="" err code st t buf=postmaster-send-$$
  [ -n "$handle" ] && [ -n "$file" ] || die "usage: host.sh send <handle> <file> [--wait [<seconds>]]"
  if [ "${3:-}" = --wait ]; then waitfor=$(count "${4:-600}" seconds) || exit 1; fi
  handle=$(handle_of "$handle")
  [ -f "$file" ] || die "no such file: $file"
  case $(detect) in
    herdr)
      # Sending and waiting are one call: a separate `agent wait` straight after a prompt can
      # return the previous turn's settled state before the new turn has started.
      if [ -z "$waitfor" ]; then
        herdr agent prompt "$handle" "$(cat "$file")" >/dev/null || die "herdr could not prompt $handle"
      elif ! err=$(herdr agent prompt "$handle" "$(cat "$file")" --wait --timeout "$((waitfor * 1000))" 2>&1 >/dev/null); then
        code=$(printf '%s' "$err" | json 'd["error"]["code"]' 2>/dev/null)
        case $code in
          agent_prompt_stalled) warn "the message went in, but Herdr saw no turn start; read the session before sending it again"; exit 3 ;;
          agent_blocked) warn "$handle is at an approval or a question; the user answers it in Herdr first"; exit 3 ;;
          timeout) echo "sent; $handle did not settle within ${waitfor}s"; exit 3 ;;
          *) die "herdr could not prompt $handle: ${code:-$err}" ;;
        esac
      else
        st=$(herdr agent get "$handle" 2>/dev/null | json 'd["result"]["agent"]["agent_status"]' 2>/dev/null)
        [ "$st" = blocked ] && { echo "sent; $handle stopped at an approval or a question: the user answers it in Herdr"; exit 3; }
      fi ;;
    tmux)
      t=$(tmux_target "$handle") || exit 1
      tmux load-buffer -b "$buf" "$file" && tmux paste-buffer -p -d -b "$buf" -t "$t" || die "tmux could not paste into $handle"
      sleep 0.5
      tmux send-keys -t "$t" Enter     # a separate key after the paste, never part of it
      [ -n "$waitfor" ] && { wait_cmd "$handle" "$waitfor" >/dev/null || { echo "sent; $handle did not settle within ${waitfor}s"; exit 3; }; } ;;
    none) no_session_host ;;
  esac
  echo "sent $(wc -c < "$file" | tr -d ' ') bytes to $handle${waitfor:+, and it settled}"
}

wait_cmd() {  # wait <handle> [<seconds>]
  local handle=${1:-} secs t quiet last="" now same=0 end st
  [ -n "$handle" ] || die "usage: host.sh wait <handle> [<seconds>]"
  secs=$(count "${2:-600}" seconds) || exit 1
  handle=$(handle_of "$handle")
  case $(detect) in
    herdr)
      herdr agent wait "$handle" --timeout "$((secs * 1000))" >/dev/null || { echo "$handle did not settle within ${secs}s"; return 3; }
      st=$(herdr agent get "$handle" 2>/dev/null | json 'd["result"]["agent"]["agent_status"]' 2>/dev/null)
      [ "$st" = blocked ] && { echo "$handle stopped at an approval or a question: the user answers it in Herdr"; return 3; }
      echo "$handle settled" ;;
    tmux)
      # Settled when the screen has not changed for QUIET seconds.
      quiet=$(count "${POSTMASTER_HOST_QUIET:-10}" POSTMASTER_HOST_QUIET) || exit 1
      t=$(tmux_target "$handle") || exit 1
      end=$(( $(date +%s) + secs ))
      while [ "$(date +%s)" -lt "$end" ]; do
        now=$(tmux capture-pane -p -t "$t" 2>/dev/null) || die "tmux cannot read $handle"
        if [ "$now" = "$last" ]; then same=$((same + 1)); else same=0; last=$now; fi
        [ $same -ge "$quiet" ] && { echo "$handle settled"; return 0; }
        sleep 1
      done
      echo "$handle did not settle within ${secs}s"; return 3 ;;
    none) no_session_host ;;
  esac
}

read_cmd() {  # read <handle> [<lines>]
  local handle=${1:-} lines t
  [ -n "$handle" ] || die "usage: host.sh read <handle> [<lines>]"
  lines=$(count "${2:-120}" lines) || exit 1
  handle=$(handle_of "$handle")
  case $(detect) in
    herdr) herdr agent read "$handle" --source recent-unwrapped --lines "$lines" ;;
    tmux) t=$(tmux_target "$handle") || exit 1; tmux capture-pane -p -J -S "-$lines" -t "$t" ;;
    none) no_session_host ;;
  esac
}

# --- tests --------------------------------------------------------------------------------
test_setup() {  # a scratch repository with worktrees, and the commands the tests launch
  tmp=$(mktemp -d) || exit 1
  fails=0
  repo=$tmp/hosttest-$$
  git init -q -b main "$repo" && git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m first || exit 1
  local w; for w in T-1-luna T-1-sol; do git -C "$repo" worktree add -q ".worktrees/$w" -b "wb/$w" || exit 1; done
  git -C "$repo" worktree add -q --detach .worktrees/T-1-rev-luna || exit 1
  repo=$(CDPATH= cd -P -- "$repo" && pwd -P); rname=$(basename "$repo")
  clone=$repo/.worktrees/T-1-rev-security-opus   # a reviewer's scratch clone
  "$HERE/cut-scratch.sh" "$repo" "$repo" "$clone" "$(git -C "$repo" rev-parse HEAD)" --clone main >/dev/null 2>&1 || exit 1
  mkdir -p "$tmp/caller" "$tmp/logs" "$tmp/run-1"
  cat > "$tmp/caller/fixed.sh" <<'EOF'
#!/usr/bin/env bash
printf '{"type":"system","subtype":"init","session_id":"fixed-1","model":"m"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step one"}]}}\n'
printf 'a line on stderr\n' >&2
sleep "${EMIT_SLEEP:-0}"
printf '{"type":"result","subtype":"success","num_turns":1}\n'
exit 3
EOF
  cat > "$tmp/caller/probe.sh" <<'EOF'
#!/usr/bin/env bash
printf '{"type":"system","subtype":"init","session_id":"probe-1","model":"m"}\n'
if (: < /dev/tty) 2>/dev/null; then tty=yes; else tty=no; fi
printf 'from=%s|name=%s|pane=%s|tmuxpane=%s|var=%s|sid=%s|pid=%s|pgid=%s|tty=%s\n' "$PWD" "${POSTMASTER_LAUNCH_NAME:-}" \
  "${HERDR_PANE_ID:-unset}" "${TMUX_PANE:-unset}" "${CALLER_VAR:-unset}" "$(python3 -c 'import os; print(os.getsid(0))')" "$$" \
  "$(python3 -c 'import os; print(os.getpgid(0))')" "$tty"
echo x >> "${COUNT:-/dev/null}"
sleep "${EMIT_SLEEP:-0}"
EOF
  chmod +x "$tmp/caller/fixed.sh" "$tmp/caller/probe.sh"
  # A waybill whose title is written to break any shell it is typed into.
  cat > "$tmp/run-1/brief.md" <<EOF
# Waybill: 1

## Ticket
name: not this one

## Dispatch
name: #1, Stop \`touch $tmp/canary\` \$(touch $tmp/canary) "breaking" a shell
dispatch: $tmp/run-1
EOF
  NAME=$("$SELF" name "$tmp/run-1" luna)
}
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1" "${3:-}"; fi; }   # check <label> <test> [<detail>]
marker() {  # marker <file> [<seconds>]: wait for a marker to land
  local i=0; while [ ! -e "$1" ] && [ $i -lt $(( ${2:-30} * 5 )) ]; do sleep 0.2; i=$((i + 1)); done; [ -e "$1" ]
}
field() { tr '|' '\n' < "$1" | sed -n "s/^$2=//p" | head -1; }   # field <probe output> <key>
finish() {
  echo
  [ "$fails" -eq 0 ] && { echo "$1: all controls behaved"; return 0; }
  echo "$1: $fails control(s) misbehaved"; return 1
}

self_test() {
  # Stub hosts on a curated PATH, so no control can reach a live Herdr or tmux server. A stub
  # pane or window runs what it is given with only a server's environment, never the caller's,
  # so the environment a launch sees has to have come through host.sh.
  test_setup
  trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  mkdir -p "$tmp/bin" "$tmp/sys" "$tmp/stub"
  local t p
  for t in bash sh python3 git env cat mkdir rmdir rm mkfifo mktemp sleep date touch wc tr sed awk \
           dirname basename grep head tail cut sort cmp ls seq timeout find cksum ps; do
    p=$(command -v "$t" 2>/dev/null) && [ ! -e "$tmp/sys/$t" ] && ln -s "$p" "$tmp/sys/$t"
  done
  cat > "$tmp/bin/herdr" <<'EOF'
#!/usr/bin/env python3
import fcntl, json, os, subprocess, sys
S = os.environ["STUB"]; a = sys.argv[1:]
with open(os.path.join(S, "herdr.calls"), "a") as f: f.write("\t".join(a) + "\n")
if os.path.exists(os.path.join(S, "herdr.down")): sys.exit(1)
if a == ["agent"]: print("herdr agent commands:\n  kinds: pi|claude|codex"); sys.exit(2)
lock = open(os.path.join(S, "herdr.lock"), "w"); fcntl.flock(lock, fcntl.LOCK_EX)
path = os.path.join(S, "herdr.json")
st = json.load(open(path)) if os.path.exists(path) else {"n": 0, "spaces": {}, "panes": {}, "open": {}, "agents": []}
def save(): json.dump(st, open(path, "w"))
def new(prefix): st["n"] += 1; return "%s%d" % (prefix, st["n"])
def opt(name): return a[a.index(name) + 1] if name in a else None
def tokens(): return dict(a[i + 1].split("=", 1) for i in range(len(a) - 1) if a[i] == "--token")
def out(obj): print(json.dumps({"id": "stub", "result": obj}))
def error(code): print(json.dumps({"error": {"code": code, "message": code}}), file=sys.stderr); sys.exit(1)
def flag(name): return os.path.exists(os.path.join(S, name))
def git(*args): return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()
def main_of(d):
    c = git("-C", d, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.realpath(os.path.dirname(c)) if c else None
def space(label):
    ws, tab, pane = new("w"), new("t"), new("p")
    st["spaces"][ws] = {"label": label, "tokens": {}, "panes": [pane]}; st["panes"][pane] = {"ws": ws, "tokens": {}}
    return {"workspace": {"workspace_id": ws}, "tab": {"tab_id": tab}, "root_pane": {"pane_id": pane}}
cmd = " ".join(a[:2])
if cmd == "workspace list": out({"workspaces": [{"workspace_id": w} for w in st["spaces"]]})
elif cmd == "worktree list":
    cwd = opt("--cwd"); root = main_of(cwd)
    if not root: sys.exit(1)
    wts = []
    for block in git("-C", cwd, "worktree", "list", "--porcelain").split("\n\n"):
        p = os.path.realpath(block.splitlines()[0].split(" ", 1)[1])
        w = {"path": p, "is_linked_worktree": p != root}
        if p in st["open"]: w["open_workspace_id"] = st["open"][p]
        wts.append(w)
    src = {"repo_root": root, "repo_name": os.path.basename(root)}
    if root in st["open"]: src["source_workspace_id"] = st["open"][root]
    out({"source": src, "worktrees": wts})
elif cmd == "workspace create":
    r = space(opt("--label")); cwd = os.path.realpath(opt("--cwd"))
    if main_of(cwd) == cwd: st["open"][cwd] = r["workspace"]["workspace_id"]
    save(); out(r)
elif cmd == "worktree open":
    r = space(opt("--label")); st["open"][os.path.realpath(opt("--path"))] = r["workspace"]["workspace_id"]
    save(); out(r)
elif cmd == "tab create":
    ws = opt("--workspace"); tab, pane = new("t"), new("p")
    st["spaces"][ws]["panes"].append(pane); st["panes"][pane] = {"ws": ws, "tokens": {}}
    save(); out({"tab": {"tab_id": tab}, "root_pane": {"pane_id": pane}})
elif cmd == "workspace report-metadata": st["spaces"][a[2]]["tokens"] = tokens(); save()
elif cmd == "pane report-metadata": st["panes"][a[2]]["tokens"] = tokens(); save()
elif cmd == "workspace get":
    out({"workspace": {"workspace_id": a[2], "tokens": st["spaces"][a[2]]["tokens"]}})
elif cmd == "pane list":
    out({"panes": [{"pane_id": p, "tokens": st["panes"][p]["tokens"]} for p in st["spaces"][opt("--workspace")]["panes"]]})
elif cmd == "pane get": out({"pane": {"pane_id": a[2], "agent": None}})
elif cmd == "pane run":
    pane, text, ws = a[2], a[3], st["panes"][a[2]]["ws"]
    fcntl.flock(lock, fcntl.LOCK_UN)
    if flag("pane.dead"): sys.exit(0)                     # accepted, never run
    late = "sleep 5; " if flag("pane.late") else ""
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/"), "STUB": S, "HERDR_ENV": "1",
           "HERDR_PANE_ID": pane, "HERDR_TAB_ID": "tab-of-" + pane, "HERDR_WORKSPACE_ID": ws}
    proc = subprocess.Popen(["bash", "-c", late + text], env=env, stdin=subprocess.DEVNULL, start_new_session=True,
                            stdout=open(os.path.join(S, "pane-%s.out" % pane), "ab"), stderr=subprocess.STDOUT)
    open(os.path.join(S, "pane-%s.pid" % pane), "w").write(str(proc.pid))
elif cmd == "agent get":
    if a[2] not in st["agents"]: error("agent_not_found")
    out({"agent": {"name": a[2], "agent_status": "blocked" if flag("agent.blocked") else "idle"}})
elif cmd == "agent start":
    if a[2] in st["agents"]: error("agent_name_taken")
    st["agents"].append(a[2]); save()
    if flag("agent.notready"): error("agent_not_ready")
elif cmd == "agent read": print("stub screen of " + a[2])
EOF
  cat > "$tmp/bin/tmux" <<'EOF'
#!/usr/bin/env python3
import fcntl, json, os, subprocess, sys
S = os.environ["STUB"]; a = sys.argv[1:]
with open(os.path.join(S, "tmux.calls"), "a") as f: f.write("\t".join(a) + "\n")
lock = open(os.path.join(S, "tmux.lock"), "w"); fcntl.flock(lock, fcntl.LOCK_EX)
path = os.path.join(S, "tmux.json")
st = json.load(open(path)) if os.path.exists(path) else {"n": 0, "sessions": [], "windows": {}}
def save(): json.dump(st, open(path, "w"))
def opt(name): return a[a.index(name) + 1] if name in a else None
def launch(session):
    st["n"] += 1; win = "@%d" % st["n"]
    st["windows"][win] = {"session": session, "name": opt("-n"), "opts": {}}
    save(); fcntl.flock(lock, fcntl.LOCK_UN)
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/"), "STUB": S,
           "TMUX": "/stub/tmux,1,0", "TMUX_PANE": "%%%d" % st["n"]}
    env.update(a[i + 1].split("=", 1) for i in range(len(a) - 1) if a[i] == "-e")
    open(os.path.join(S, "win-%d.env" % st["n"]), "w").write("\n".join("%s=%s" % kv for kv in sorted(env.items())))
    try:
        subprocess.Popen(a[a.index("-c") + 2:], env=env, stdin=subprocess.DEVNULL, start_new_session=True,
                         stdout=open(os.path.join(S, "win-%d.out" % st["n"]), "ab"), stderr=subprocess.STDOUT)
    except OSError:
        pass                                    # a window whose command is missing dies at once
    print(win)
fmt = opt("-F") or ""
if a[0] == "has-session": sys.exit(0 if opt("-t").lstrip("=") in st["sessions"] else 1)
elif a[0] == "new-session": st["sessions"].append(opt("-s")); launch(opt("-s"))
elif a[0] == "new-window": launch(opt("-t").lstrip("=").rstrip(":"))
elif a[0] == "set-option":
    t = opt("-t"); w = t if t in st["windows"] else "@" + t.lstrip("%")
    if w in st["windows"]: st["windows"][w]["opts"][a[-2]] = a[-1]; save()
elif a[0] == "list-windows":
    for w, v in st["windows"].items():
        if "-a" in a: print("%s\t%s" % (w, v["name"]) if "#{window_id}" in fmt else v["name"])
        elif v["session"] == opt("-t").lstrip("="): print("%s\t%s" % (w, v["opts"].get("@postmaster_cwd", "")))
elif a[0] == "capture-pane": print("stub screen")
EOF
  chmod +x "$tmp/bin/herdr" "$tmp/bin/tmux"
  SYS=$tmp/sys; STUBS=$tmp/bin:$tmp/sys
  hs() {  # hs <PATH> [VAR=value ...] -- <host.sh arguments>: host.sh in a clean environment
    local p=$1 vars=(); shift
    while [ "$1" != -- ]; do vars+=("$1"); shift; done; shift
    env -i HOME="$HOME" PATH="$p" STUB="$tmp/stub" TMPDIR="$tmp" POSTMASTER_HOST_STATE="$tmp/state" \
      POSTMASTER_HOST_CLAIM_WAIT=3 POSTMASTER_HOST_CLOSE_WAIT=1 ${vars[@]+"${vars[@]}"} "$SELF" "$@"
  }
  reset() { rm -f -- "$tmp"/stub/*; }
  calls() { cat "$tmp/stub/$1.calls" 2>/dev/null; }
  T=$'\t'
  local got got2 rc a b c space pane lunaspace live panepid o1 o2

  echo "detect"
  check "a Herdr server that answers is the host" '[ "$(hs "$STUBS" -- detect)" = herdr ]'
  touch "$tmp/stub/herdr.down"
  check "with no Herdr server answering, tmux is" '[ "$(hs "$STUBS" -- detect)" = tmux ]'
  reset
  check "with neither on PATH, none" '[ "$(hs "$SYS" -- detect)" = none ]'
  check "POSTMASTER_HOST=none wins over a live Herdr" '[ "$(hs "$STUBS" POSTMASTER_HOST=none -- detect)" = none ]'
  check "POSTMASTER_HOST=tmux wins over a live Herdr" '[ "$(hs "$STUBS" POSTMASTER_HOST=tmux -- detect)" = tmux ]'

  echo "name: from the waybill, so no title is typed into a shell"
  check "it is the Dispatch section's name, then the role" \
    '[ "$NAME" = "#1, Stop \`touch $tmp/canary\` \$(touch $tmp/canary) \"breaking\" a shell · luna" ]' "$NAME"
  check "a waybill without one falls back to the run's directory" '[ "$(hs "$SYS" -- name "$tmp/logs" coachman)" = "logs · coachman" ]'
  printf '## Dispatch\nname: #2, a bell\a and an escape\033]0;x\007 · y\n' > "$tmp/logs/brief.md"
  check "control characters never reach a label" '[ "$(hs "$SYS" -- name "$tmp/logs")" = "#2, a bell and an escape]0;x · y" ]'
  rm -f "$tmp/logs/brief.md"

  echo "run, no host: the same headless command, backgrounded"
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  got=$(cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --out ../logs/n1.out --err ../logs/n1.err \
        --marker ../logs/n1.done -- ./fixed.sh)
  check "it says it ran in the background" '[ "$got" = host=none ]' "$got"
  marker "$tmp/logs/n1.done"
  check "stdout and stderr are byte for byte a direct run's" 'cmp -s "$tmp/direct.out" "$tmp/logs/n1.out" && cmp -s "$tmp/direct.err" "$tmp/logs/n1.err"'
  check "and the title's shell syntax never ran" '[ ! -e "$tmp/canary" ]'
  touch "$tmp/logs/n2.done"
  (cd "$tmp/caller" && hs "$SYS" EMIT_SLEEP=2 -- run "$NAME" "$repo" --marker ../logs/n2.done -- ./fixed.sh >/dev/null)
  check "an earlier launch's marker is gone once run returns" '[ ! -e "$tmp/logs/n2.done" ]'
  check "and it lands again when this one exits, whatever its exit" 'marker "$tmp/logs/n2.done" 20'
  (cd "$tmp/caller" && hs "$SYS" CALLER_VAR=v HERDR_PANE_ID=caller-pane TMUX_PANE=%9 -- run "$NAME" "$repo/.worktrees/T-1-luna" \
     --out ../logs/n3.out --marker ../logs/n3.done --pidfile ../logs/n3.pid -- ./probe.sh >/dev/null)
  marker "$tmp/logs/n3.done"
  check "it runs from the caller's directory, with the caller's environment and its name" \
    '[ "$(field "$tmp/logs/n3.out" from)" = "$tmp/caller" ] && [ "$(field "$tmp/logs/n3.out" var)" = v ] && [ "$(field "$tmp/logs/n3.out" name)" = "$NAME" ]' "$(cat "$tmp/logs/n3.out")"
  check "but never with its caller's pane" '[ "$(field "$tmp/logs/n3.out" pane)" = unset ] && [ "$(field "$tmp/logs/n3.out" tmuxpane)" = unset ]' "$(cat "$tmp/logs/n3.out")"
  check "it is a session of its own: its group is its pid, not the caller's session" \
    '[ "$(field "$tmp/logs/n3.out" pgid)" = "$(field "$tmp/logs/n3.out" pid)" ] && [ "$(field "$tmp/logs/n3.out" sid)" = "$(field "$tmp/logs/n3.out" pid)" ]'
  check "--pidfile holds the launch's pid" '[ "$(cat "$tmp/logs/n3.pid")" = "$(field "$tmp/logs/n3.out" pid)" ]'
  (cd "$tmp/caller" && hs "$SYS" EMIT_SLEEP=3 -- run "$NAME" "$repo" --pidfile ../logs/n5.pid --marker ../logs/n5.done -- ./fixed.sh >/dev/null)
  check "and it is there, for a live process, the moment run returns" '[ -s "$tmp/logs/n5.pid" ] && kill -0 "$(cat "$tmp/logs/n5.pid")" 2>/dev/null'
  marker "$tmp/logs/n5.done"
  printf 'before\n' > "$tmp/logs/n4.out"; printf 'old error\n' > "$tmp/logs/n4.err"
  (cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo" --out ../logs/n4.out --err ../logs/n4.err --append --marker ../logs/n4.done -- ./fixed.sh >/dev/null)
  marker "$tmp/logs/n4.done"
  check "--append keeps what the stream held, and --err holds only this launch's errors" \
    '[ "$(head -1 "$tmp/logs/n4.out")" = before ] && [ "$(wc -l < "$tmp/logs/n4.out")" -eq 4 ] && [ "$(cat "$tmp/logs/n4.err")" = "a line on stderr" ]'
  hs "$SYS" -- run "$NAME" "$repo" --marker "$tmp/logs/n6.done" ./fixed.sh >/dev/null 2>&1; rc=$?
  check "a command without -- is refused, and its marker lands" '[ $rc -eq 1 ] && [ -e "$tmp/logs/n6.done" ]'
  hs "$SYS" -- run "$NAME" "$tmp/nowhere" --err "$tmp/logs/n7.err" --marker "$tmp/logs/n7.done" -- ./fixed.sh >/dev/null 2>&1; rc=$?
  check "a directory that does not exist: refused, the marker lands and --err says why" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/n7.done" ] && grep -q "no such directory" "$tmp/logs/n7.err"'
  got=$(hs "$SYS" POSTMASTER_HOST_CLAIM_WAIT=2.5 -- run "$NAME" "$repo" --marker "$tmp/logs/n8.done" -- ./fixed.sh 2>&1); rc=$?
  check "a count that is not a whole number is refused, and never reaches the tests" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/n8.done" ] && ! printf "%s" "$got" | grep -q "controls"' "$got"
  got=$(hs "$STUBS" -- wait postmaster-x 10m 2>&1); rc=$?
  check "the same for wait" '[ $rc -eq 1 ] && ! printf "%s" "$got" | grep -q "controls"' "$got"

  echo "stop: everything a launch started, and nothing else"
  mkdir -p "$tmp/tree"
  cat > "$tmp/caller/tree.sh" <<'EOF'
#!/usr/bin/env bash
# A launch with a child in a session of its own, as a harness runs a tool command, and a child
# deaf to TERM. It notes the TERM it gets.
trap 'echo term >> "$TREE/term"; exit 0' TERM
python3 -c 'import os; os.setsid(); os.execvp("sleep", ["sleep", "120"])' & echo $! > "$TREE/escapee.pid"
sh -c 'trap "" TERM; while :; do sleep 1; done' & echo $! > "$TREE/deaf.pid"
sleep 120 & wait
EOF
  chmod +x "$tmp/caller/tree.sh"
  alive() { local st; st=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$st" ] && [ "${st#Z}" = "$st" ]; }
  (cd "$tmp/caller" && hs "$SYS" TREE="$tmp/tree" -- run "$NAME" "$repo/.worktrees/T-1-luna" --marker ../logs/k1.done -- ./tree.sh >/dev/null)
  a=0; while { [ ! -s "$tmp/tree/escapee.pid" ] || [ ! -s "$tmp/tree/deaf.pid" ]; } && [ $a -lt 50 ]; do sleep 0.1; a=$((a + 1)); done
  sleep 0.5
  (cd "$repo/.worktrees/T-1-luna" && exec sleep 60) & b=$!    # works in the worktree, but no launch started it
  got=$(hs "$SYS" POSTMASTER_HOST_STOP_WAIT=2 -- stop "$repo/.worktrees/T-1-luna" 2>&1); rc=$?
  check "stop reaches a child the launch runs in a session of its own" \
    '[ $rc -eq 0 ] && [ -s "$tmp/tree/escapee.pid" ] && ! alive "$(cat "$tmp/tree/escapee.pid")"' "$got"
  check "the launch got TERM first, and a child deaf to it is killed after the wait" \
    '[ -s "$tmp/tree/term" ] && [ -s "$tmp/tree/deaf.pid" ] && ! alive "$(cat "$tmp/tree/deaf.pid")"' "$got"
  check "its marker lands" 'marker "$tmp/logs/k1.done" 10'
  check "a process that works in the worktree but that no launch started is left alone" 'alive "$b"'
  kill "$b" 2>/dev/null; wait "$b" 2>/dev/null

  echo "run, Herdr (stub): a pane in the worktree's space, nested under the repository's"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" CALLER_VAR=v HERDR_PANE_ID=caller-pane -- run "$NAME" "$repo/.worktrees/T-1-luna" \
        --out ../logs/h1.out --err ../logs/h1.err --marker ../logs/h1.done -- ./probe.sh)
  check "it says where it ran" 'case $got in "host=herdr space=w"*" pane=p"*) true ;; *) false ;; esac' "$got"
  space=${got#*space=}; space=${space%% *}; pane=${got##*pane=}
  check "a repository with no space gets one first, labelled with its name" \
    'calls herdr | grep -qxF "workspace${T}create${T}--cwd${T}$repo${T}--label${T}$rname${T}--no-focus"'
  check "the worktree opens as a space under it, labelled with the launch's name" \
    'calls herdr | grep -qxF "worktree${T}open${T}--workspace${T}w1${T}--path${T}$repo/.worktrees/T-1-luna${T}--label${T}$NAME${T}--no-focus"'
  check "host.sh marks the space it opened as its own" 'python3 -c "import json,sys; sys.exit(json.load(open(\"$tmp/stub/herdr.json\"))[\"spaces\"][\"$space\"][\"tokens\"] != {\"postmaster\": \"opened\"})"'
  marker "$tmp/logs/h1.done"
  check "the launch ran in that pane, with that pane's identity" '[ "$(field "$tmp/logs/h1.out" pane)" = "$pane" ]' "$(cat "$tmp/logs/h1.out")"
  check "and with its caller's environment, handed over by host.sh" '[ "$(field "$tmp/logs/h1.out" var)" = v ] && [ "$(field "$tmp/logs/h1.out" from)" = "$tmp/caller" ]'
  sleep 1
  check "the pane shows the name and the rendered stream, not raw JSON" \
    'grep -qF "$NAME" "$tmp/stub/pane-$pane.out" && grep -qE "^[0-9:]{8} session probe-1 · m$" "$tmp/stub/pane-$pane.out" && ! grep -q "{" "$tmp/stub/pane-$pane.out"' "$(cat "$tmp/stub/pane-$pane.out" 2>/dev/null)"
  check "and reports the launch working, then releases it" \
    'calls herdr | grep -q "^pane${T}report-agent${T}$pane${T}.*--state${T}working" && calls herdr | grep -q "^pane${T}release-agent${T}$pane${T}"'
  got2=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --marker ../logs/h2.done -- ./fixed.sh)
  check "a second launch in the same worktree is a new tab in the same space" \
    '[ "$(calls herdr | grep -c "^worktree${T}open")" -eq 1 ] && calls herdr | grep -q "^tab${T}create${T}--workspace${T}$space${T}"' "$got2"
  marker "$tmp/logs/h2.done"
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  (cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --out ../logs/h3.out --err ../logs/h3.err --marker ../logs/h3.done -- ./fixed.sh >/dev/null)
  marker "$tmp/logs/h3.done"
  check "the stream and the marker are what a background run writes" 'cmp -s "$tmp/direct.out" "$tmp/logs/h3.out" && cmp -s "$tmp/direct.err" "$tmp/logs/h3.err"'
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --marker ../logs/h6.done --pidfile ../logs/h6.pid -- sleep 60)
  panepid=$(cat "$tmp/stub/pane-${got##*pane=}.pid")
  kill -HUP -- "-$panepid" 2>/dev/null
  check "a pane closed mid-run: the launch stops, and its marker lands" \
    'marker "$tmp/logs/h6.done" 10 && ! kill -0 "$(cat "$tmp/logs/h6.pid")" 2>/dev/null'
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --marker ../logs/h7.done --pidfile ../logs/h7.pid -- sleep 60)
  panepid=$(cat "$tmp/stub/pane-${got##*pane=}.pid")
  kill -KILL -- "-$panepid" 2>/dev/null; kill -KILL -- "-$(cat "$tmp/logs/h7.pid")" 2>/dev/null
  check "its runner and the launch killed outright: the marker still lands" 'marker "$tmp/logs/h7.done" 10'
  touch "$tmp/stub/pane.dead"
  got=$(cd "$tmp/caller" && hs "$STUBS" COUNT="$tmp/logs/h4.count" -- run "$NAME" "$repo/.worktrees/T-1-sol" --out ../logs/h4.out --marker ../logs/h4.done -- ./probe.sh 2>/dev/null)
  marker "$tmp/logs/h4.done"
  check "a pane that never starts the launch: it runs in the background instead" '[ "$got" = host=none ] && [ "$(wc -l < "$tmp/logs/h4.count")" -eq 1 ]' "$got"
  rm -f "$tmp/stub/pane.dead"; touch "$tmp/stub/pane.late"
  got=$(cd "$tmp/caller" && hs "$STUBS" POSTMASTER_HOST_CLAIM_WAIT=1 COUNT="$tmp/logs/h5.count" -- run "$NAME" "$repo/.worktrees/T-1-sol" --marker ../logs/h5.done -- ./probe.sh 2>/dev/null)
  marker "$tmp/logs/h5.done"; sleep 6
  check "a pane that starts it late: it still runs exactly once" '[ "$got" = host=none ] && [ "$(wc -l < "$tmp/logs/h5.count")" -eq 1 ]' "$(cat "$tmp/logs/h5.count" 2>/dev/null)"
  rm -f "$tmp/stub/pane.late"
  check "no launch leaves its hand-over directory behind" '[ -z "$(find "$tmp" -maxdepth 1 -name "postmaster-host.*")" ]'

  echo "stop and close, Herdr (stub)"
  lunaspace=$(python3 -c "import json; print(json.load(open('$tmp/stub/herdr.json'))['open']['$repo/.worktrees/T-1-luna'])")
  check "a space host.sh opened, its launches done, is closed" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && calls herdr | grep -qx "workspace${T}close${T}$lunaspace"'
  hs "$STUBS" -- close "$repo" >/dev/null 2>&1; rc=$?
  check "the repository's own checkout is refused" '[ $rc -eq 2 ]'
  python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-rev-luna" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); st["n"] += 1; ws, p = "w%d" % st["n"], "p%d" % st["n"]
# A space the user opened, holding nothing now but a tab host.sh added, its launch done.
st["spaces"][ws] = {"label": "the user's", "tokens": {}, "panes": [p]}
st["panes"][p] = {"ws": ws, "tokens": {"postmaster": "launch", "state": "done"}}
st["open"][sys.argv[2]] = ws; json.dump(st, open(sys.argv[1], "w"))
PY
  hs "$STUBS" -- close "$repo/.worktrees/T-1-rev-luna" >/dev/null 2>&1; rc=$?
  check "a space host.sh did not open is refused, and left open" '[ $rc -eq 2 ] && ! calls herdr | grep -q "^workspace${T}close${T}w$(python3 -c "import json; print(json.load(open(\"$tmp/stub/herdr.json\"))[\"n\"])")$"'
  touch "$tmp/stub/pane.dead"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-sol" --marker ../logs/s1.done -- sleep 60 2>/dev/null)
  rm -f "$tmp/stub/pane.dead"
  got2=$(hs "$STUBS" -- close "$repo/.worktrees/T-1-sol" 2>&1); rc=$?
  check "a launch that fell back to the background still holds its worktree: close refuses" '[ "$got" = host=none ] && [ $rc -eq 2 ]' "$got / $got2"
  (cd "$repo/.worktrees/T-1-sol" && hs "$STUBS" -- stop "$repo/.worktrees/T-1-sol" >/dev/null 2>&1); rc=$?
  check "stop refuses to run from inside the worktree it would stop" '[ $rc -eq 1 ] && [ ! -e "$tmp/logs/s1.done" ]'
  hs "$STUBS" -- stop "$repo/.worktrees/T-1-sol" >/dev/null
  check "stop ends it, and its marker lands" 'marker "$tmp/logs/s1.done" 10'
  check "then close closes the space" 'hs "$STUBS" -- close "$repo/.worktrees/T-1-sol" >/dev/null'

  echo "a reviewer's scratch clone, Herdr (stub): a space of its own, which close shuts"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$clone" --marker ../logs/c1.done -- ./fixed.sh)
  space=${got#*space=}; space=${space%% *}
  check "it opens as a space of the launch's own, labelled with its name, and no other" \
    'calls herdr | grep -qxF "workspace${T}create${T}--cwd${T}$clone${T}--label${T}$NAME${T}--no-focus" && [ "$(calls herdr | grep -c "^workspace${T}create")" -eq 1 ]' "$(calls herdr)"
  check "host.sh marks that space as its own" 'python3 -c "import json,sys; sys.exit(json.load(open(\"$tmp/stub/herdr.json\"))[\"spaces\"][\"$space\"][\"tokens\"] != {\"postmaster\": \"opened\"})"'
  marker "$tmp/logs/c1.done"
  got2=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$clone" --marker ../logs/c2.done -- ./fixed.sh)
  check "a second launch there is a new tab in the same space" \
    '[ "$(calls herdr | grep -c "^workspace${T}create")" -eq 1 ] && calls herdr | grep -q "^tab${T}create${T}--workspace${T}$space${T}"' "$got2"
  marker "$tmp/logs/c2.done"
  check "close shuts it" 'hs "$STUBS" -- close "$clone" >/dev/null && calls herdr | grep -qx "workspace${T}close${T}$space"'
  git clone -q "$repo" "$tmp/plain" >/dev/null 2>&1
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$tmp/plain" --marker ../logs/c3.done -- ./fixed.sh)
  space=${got#*space=}; space=${space%% *}
  marker "$tmp/logs/c3.done"
  hs "$STUBS" -- close "$tmp/plain" >/dev/null 2>&1; rc=$?
  check "a plain clone is no scratch: it opens as a repository, and close refuses its space" \
    'calls herdr | grep -qxF "workspace${T}create${T}--cwd${T}$tmp/plain${T}--label${T}plain${T}--no-focus" && [ $rc -eq 2 ] && ! calls herdr | grep -qx "workspace${T}close${T}$space"' "$(calls herdr)"

  echo "run, stop and close, tmux (stub)"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" POSTMASTER_HOST=tmux CALLER_VAR=v -- run "$NAME" "$repo/.worktrees/T-1-sol" --out ../logs/t1.out --marker ../logs/t1.done -- ./probe.sh)
  marker "$tmp/logs/t1.done"
  check "a first launch opens session postmaster-<repo>, a window named for it" \
    'calls tmux | grep -q "^new-session${T}-d${T}-P${T}-F${T}#{window_id}${T}-s${T}postmaster-$rname${T}-n${T}$NAME${T}"' "$got"
  check "the launch ran with that window's pane and its caller's environment" '[ "$(field "$tmp/logs/t1.out" tmuxpane)" = %1 ] && [ "$(field "$tmp/logs/t1.out" var)" = v ]' "$(cat "$tmp/logs/t1.out")"
  (cd "$tmp/caller" && hs "$STUBS" POSTMASTER_HOST=tmux -- run "$NAME" "$repo/.worktrees/T-1-sol" --marker ../logs/t2.done -- sleep 60 >/dev/null)
  check "the next is a window in the same session" 'calls tmux | grep -q "^new-window${T}-d${T}-P${T}-F${T}#{window_id}${T}-t${T}=postmaster-$rname:${T}"'
  hs "$STUBS" POSTMASTER_HOST=tmux -- close "$repo/.worktrees/T-1-sol" >/dev/null 2>&1; rc=$?
  check "close refuses while a launch still runs in the worktree" '[ $rc -eq 2 ] && [ "$(calls tmux | grep -c "^kill-window")" -eq 0 ]'
  hs "$STUBS" POSTMASTER_HOST=tmux -- stop "$repo/.worktrees/T-1-sol" >/dev/null; marker "$tmp/logs/t2.done" 10
  check "once it is stopped, close kills that worktree's windows" \
    'hs "$STUBS" POSTMASTER_HOST=tmux -- close "$repo/.worktrees/T-1-sol" >/dev/null && [ "$(calls tmux | grep -c "^kill-window")" -eq 2 ]'
  (cd "$tmp/caller" && hs "$STUBS" POSTMASTER_HOST=tmux -- run "$NAME" "$clone" --marker ../logs/t3.done -- ./fixed.sh >/dev/null)
  marker "$tmp/logs/t3.done"
  check "a reviewer's scratch clone gets a window in the session of the repository it was cut from" \
    'python3 -c "import json,sys; st = json.load(open(\"$tmp/stub/tmux.json\")); sys.exit(not any(w[\"session\"] == \"postmaster-$rname\" and w[\"opts\"].get(\"@postmaster_cwd\") == \"$clone\" for w in st[\"windows\"].values()) or len(st[\"sessions\"]) != 1)"'
  check "and close kills it" \
    'hs "$STUBS" POSTMASTER_HOST=tmux -- close "$clone" >/dev/null && [ "$(calls tmux | grep -c "^kill-window")" -eq 3 ]'

  echo "interactive sessions"
  hs "$SYS" -- spawn postmaster-repo "$repo" -- claude >/dev/null 2>&1; a=$?
  hs "$SYS" -- send postmaster-repo "$tmp/caller/fixed.sh" >/dev/null 2>&1; b=$?
  hs "$SYS" -- read postmaster-repo >/dev/null 2>&1; c=$?
  check "with no host, spawn, send and read say so, exit 3" '[ $a -eq 3 ] && [ $b -eq 3 ] && [ $c -eq 3 ]'
  reset
  hs "$STUBS" POSTMASTER_CONFIG=/elsewhere/config.toml -- spawn postmaster-repo "$repo/.worktrees/T-1-luna" --label "repo · postmaster" -- claude --model m >/dev/null
  check "Herdr: spawn starts the agent in a tab of the repository's own space" \
    'calls herdr | grep -q "^tab${T}create${T}--workspace${T}w1${T}--cwd${T}$repo/.worktrees/T-1-luna${T}--label${T}repo · postmaster${T}--no-focus" && calls herdr | grep -qx "agent${T}start${T}postmaster-repo${T}--kind${T}claude${T}--pane${T}p5${T}--${T}--model${T}m"' "$(calls herdr)"
  check "with the caller's POSTMASTER_ settings in its pane" 'calls herdr | grep "^tab${T}create" | grep -qF -- "--env${T}POSTMASTER_CONFIG=/elsewhere/config.toml"'
  hs "$STUBS" -- spawn postmaster-repo "$repo" -- claude >/dev/null 2>&1; rc=$?
  check "a handle a live agent already has is refused" '[ $rc -eq 1 ] && [ "$(calls herdr | grep -c "^agent${T}start${T}postmaster-repo")" -eq 1 ]'
  touch "$tmp/stub/agent.notready"
  hs "$STUBS" -- spawn postmaster-other "$repo" -- claude >/dev/null 2>&1; rc=$?
  rm -f "$tmp/stub/agent.notready"
  check "a harness asking something on first start: spawn says so, and does not fail" '[ $rc -eq 0 ]'
  hs "$STUBS" -- spawn "My.Project postmaster" "$repo" -- claude >/dev/null
  check "a handle becomes a Herdr agent name: lowercase, no dots or spaces" 'calls herdr | grep -q "^agent${T}start${T}my-project-postmaster${T}"'
  o1=$("$SELF" _handle "postmaster-acme-platform-service-billing"); o2=$("$SELF" _handle "postmaster-acme-platform-service-payments")
  check "two long names that share a start get two handles, each always the same, none over 32" \
    '[ "$o1" != "$o2" ] && [ "$o1" = "$("$SELF" _handle "postmaster-acme-platform-service-billing")" ] && [ ${#o1} -le 32 ] && [ ${#o2} -le 32 ]' "$o1 / $o2"
  printf 'Read the brief.' > "$tmp/msg.txt"
  hs "$STUBS" -- send postmaster-repo "$tmp/msg.txt" >/dev/null
  check "Herdr: send submits the file's text as the agent's prompt" 'calls herdr | grep -qx "agent${T}prompt${T}postmaster-repo${T}Read the brief."'
  hs "$STUBS" -- send postmaster-repo "$tmp/msg.txt" --wait 30 >/dev/null
  check "Herdr: send --wait sends and waits in one call, never a prompt then a wait" \
    'calls herdr | grep -qx "agent${T}prompt${T}postmaster-repo${T}Read the brief.${T}--wait${T}--timeout${T}30000" && ! calls herdr | grep -q "^agent${T}wait"'
  touch "$tmp/stub/agent.blocked"
  hs "$STUBS" -- send postmaster-repo "$tmp/msg.txt" --wait 30 >/dev/null 2>&1; a=$?
  hs "$STUBS" -- wait postmaster-repo 5 >/dev/null 2>&1; b=$?
  rm -f "$tmp/stub/agent.blocked"
  check "a turn that stops at an approval or a question is not settled: exit 3" '[ $a -eq 3 ] && [ $b -eq 3 ]'
  hs "$STUBS" -- wait postmaster-repo 5 >/dev/null; hs "$STUBS" -- read postmaster-repo 7 >/dev/null
  check "Herdr: wait and read go to the agent by its handle" \
    'calls herdr | grep -qx "agent${T}wait${T}postmaster-repo${T}--timeout${T}5000" && calls herdr | grep -qx "agent${T}read${T}postmaster-repo${T}--source${T}recent-unwrapped${T}--lines${T}7"'
  hs "$STUBS" POSTMASTER_HOST=tmux POSTMASTER_CONFIG=/elsewhere/config.toml -- spawn postmaster-repo "$repo" -- claude >/dev/null
  check "tmux: spawn passes the caller's POSTMASTER_ settings to the window" 'grep -qx "POSTMASTER_CONFIG=/elsewhere/config.toml" "$tmp/stub/win-1.env"'
  hs "$STUBS" POSTMASTER_HOST=tmux -- send postmaster-repo "$tmp/msg.txt" >/dev/null
  a=$(calls tmux | awk -F'\t' '$1 ~ /^(load-buffer|paste-buffer|send-keys)$/ {printf "%s%s ", $1, ($1 == "paste-buffer" && $2 == "-p") ? "(-p)" : ""}')
  check "tmux: send pastes bracketed, then presses Enter as its own key" '[ "$a" = "load-buffer paste-buffer(-p) send-keys " ]' "$a"
  hs "$STUBS" POSTMASTER_HOST=tmux POSTMASTER_HOST_QUIET=2 -- wait postmaster-repo 20 >/dev/null; a=$?
  hs "$STUBS" POSTMASTER_HOST=tmux -- read postmaster-repo 7 >/dev/null
  check "tmux: wait settles on a quiet screen, and read takes the lines asked for" \
    '[ $a -eq 0 ] && calls tmux | grep -qx "capture-pane${T}-p${T}-J${T}-S${T}-7${T}-t${T}@1"'

  finish self-test
}

live_test() {
  test_setup
  export POSTMASTER_HOST_STATE=$tmp/state
  opened=() tsession=""
  trap 'for (( i=${#opened[@]}-1; i>=0; i-- )); do herdr workspace close "${opened[i]}" >/dev/null 2>&1; done
        [ -n "$tsession" ] && tmux kill-session -t "=$tsession" >/dev/null 2>&1
        rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  openspace() { herdr worktree list --cwd "$1" 2>/dev/null | python3 -c 'import json, sys
d = json.load(sys.stdin)
print(([w.get("open_workspace_id") for w in d["result"]["worktrees"] if w["path"] == sys.argv[1]] or [None])[0] or "")' "$1" 2>/dev/null; }
  local got wt rs space pane tab info seen i screen rev rspace cspace before
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  echo "detected here: $(detect)"

  if herdr_up; then
    echo "Herdr, the positive control"
    rs=$(herdr workspace create --cwd "$repo" --label "$rname" --no-focus | json 'd["result"]["workspace"]["workspace_id"]')
    [ -n "$rs" ] && opened+=("$rs")
    wt=$repo/.worktrees/T-1-luna
    got=$(cd "$tmp/caller" && EMIT_SLEEP=8 "$SELF" run "$NAME" "$wt" --out ../logs/l1.out --err ../logs/l1.err --marker ../logs/l1.done -- ./fixed.sh)
    space=$(printf '%s' "$got" | sed -n 's/.*space=\([^ ]*\).*/\1/p'); pane=${got##*pane=}; tab=$(printf '%s' "$got" | sed -n 's/.*tab=\([^ ]*\).*/\1/p')
    [ -n "$space" ] && opened+=("$space")
    check "the launch runs in Herdr" 'case $got in host=herdr*) true ;; *) false ;; esac' "$got"
    check "in a pane of its own worktree's space" '[ -n "$space" ] && [ "$(openspace "$wt")" = "$space" ]'
    info=$(herdr workspace get "$space" 2>/dev/null)
    check "that space is a linked worktree of the repository, whose own space is its parent" \
      '[ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"worktree\"][\"is_linked_worktree\"]")" = True ] && [ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"worktree\"][\"repo_root\"]")" = "$repo" ] && [ "$(herdr worktree list --cwd "$wt" | json "d[\"result\"][\"source\"].get(\"source_workspace_id\")")" = "$rs" ]' "$info"
    check "the space and the tab carry the launch's name, shell syntax and all, as written" \
      '[ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"label\"]")" = "$NAME" ] && [ "$(herdr tab get "$tab" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$NAME" ] && [ ! -e "$tmp/canary" ]'
    seen="" i=0
    while [ $i -lt 30 ]; do
      seen=$(herdr pane get "$pane" 2>/dev/null | json '"%s|%s" % (d["result"]["pane"].get("agent_status"), d["result"]["pane"].get("terminal_title_stripped"))')
      [ "$seen" = "working|$NAME" ] && break
      sleep 0.25; i=$((i + 1))
    done
    check "while it runs, the pane is working and its terminal title is the name" '[ "$seen" = "working|$NAME" ]' "$seen"
    check "its marker lands" 'marker "$tmp/logs/l1.done" 60'
    check "its stream and errors are what a direct run writes" 'cmp -s "$tmp/direct.out" "$tmp/logs/l1.out" && cmp -s "$tmp/direct.err" "$tmp/logs/l1.err"'
    sleep 1; screen=$(herdr pane read "$pane" --source recent-unwrapped --lines 40 2>/dev/null)
    check "the pane shows rendered events, not raw JSON" \
      'printf "%s" "$screen" | grep -q "says: step one" && printf "%s" "$screen" | grep -q "result: success" && ! printf "%s" "$screen" | grep -qF "{\"type\""' "$screen"
    check "and the launch is released when it ends" \
      '[ "$(herdr pane get "$pane" | json "d[\"result\"][\"pane\"].get(\"agent_status\")")" != working ]'
    (cd "$tmp/caller" && "$SELF" run "$NAME" "$wt" --out ../logs/l6.out --marker ../logs/l6.done -- ./probe.sh >/dev/null)
    check "the launch has no terminal, and a group of its own" \
      'marker "$tmp/logs/l6.done" 30 && [ "$(field "$tmp/logs/l6.out" tty)" = no ] && [ "$(field "$tmp/logs/l6.out" pgid)" = "$(field "$tmp/logs/l6.out" pid)" ]' "$(cat "$tmp/logs/l6.out" 2>/dev/null)"
    got=$(cd "$tmp/caller" && "$SELF" run "$NAME" "$wt" --marker ../logs/l5.done --pidfile ../logs/l5.pid -- sleep 120)
    sleep 2; herdr tab close "$(printf '%s' "$got" | sed -n 's/.*tab=\([^ ]*\).*/\1/p')" >/dev/null 2>&1
    check "closing a launch's pane mid-run stops it, and its marker still lands" \
      'marker "$tmp/logs/l5.done" 10 && ! kill -0 "$(cat "$tmp/logs/l5.pid")" 2>/dev/null' "$got"
    rev=$repo/.worktrees/T-1-rev-luna
    got=$(cd "$tmp/caller" && "$SELF" run "$NAME review" "$rev" --marker ../logs/l2.done -- ./fixed.sh)
    rspace=$(printf '%s' "$got" | sed -n 's/.*space=\([^ ]*\).*/\1/p'); [ -n "$rspace" ] && opened+=("$rspace")
    check "a detached reviewer scratch opens as a space too" '[ -n "$rspace" ] && [ "$(openspace "$rev")" = "$rspace" ] && marker "$tmp/logs/l2.done" 60' "$got"
    got=$(cd "$tmp/caller" && "$SELF" run "$NAME security review" "$clone" --marker ../logs/l7.done -- ./fixed.sh)
    cspace=$(printf '%s' "$got" | sed -n 's/.*space=\([^ ]*\).*/\1/p'); [ -n "$cspace" ] && opened+=("$cspace")
    check "a reviewer's scratch clone opens as a space of its own" \
      '[ -n "$cspace" ] && [ "$(openspace "$clone")" = "$cspace" ] && [ "$(herdr workspace get "$cspace" | json "d[\"result\"][\"workspace\"][\"label\"]")" = "$NAME security review" ] && marker "$tmp/logs/l7.done" 60' "$got"
    check "and close shuts it" '"$SELF" close "$clone" >/dev/null && [ -z "$(openspace "$clone")" ]'
    "$SELF" close "$repo" >/dev/null 2>&1; i=$?
    check "close refuses the repository's own space" '[ $i -eq 2 ]'
    check "close shuts the worktree's space, and only that" '"$SELF" close "$wt" >/dev/null && [ -z "$(openspace "$wt")" ] && [ "$(openspace "$rev")" = "$rspace" ]'
    check "and the reviewer's" '"$SELF" close "$rev" >/dev/null && [ -z "$(openspace "$rev")" ]'

    echo "no host, the negative control"
    wt=$repo/.worktrees/T-1-sol
    before=$(herdr workspace list | json 'len(d["result"]["workspaces"])')
    got=$(cd "$tmp/caller" && POSTMASTER_HOST=none "$SELF" run "$NAME" "$wt" --out ../logs/l3.out --err ../logs/l3.err --marker ../logs/l3.done -- ./fixed.sh)
    check "the same launch runs in the background" '[ "$got" = host=none ]' "$got"
    check "no space opens for it" '[ -z "$(openspace "$wt")" ] && [ "$(herdr workspace list | json "len(d[\"result\"][\"workspaces\"])")" = "$before" ]'
    check "its marker lands" 'marker "$tmp/logs/l3.done" 60'
    check "its stream and errors are the same" 'cmp -s "$tmp/direct.out" "$tmp/logs/l3.out" && cmp -s "$tmp/direct.err" "$tmp/logs/l3.err"'
  else
    echo "Herdr: no server answers here; its controls are skipped"
  fi

  if has tmux; then
    echo "tmux"
    wt=$repo/.worktrees/T-1-sol
    got=$(cd "$tmp/caller" && POSTMASTER_HOST=tmux "$SELF" run "$NAME" "$wt" --out ../logs/l4.out --err ../logs/l4.err --marker ../logs/l4.done -- ./fixed.sh)
    tsession=$(printf '%s' "$got" | sed -n 's/.*session=\([^ ]*\).*/\1/p')
    check "the launch runs in a window of session postmaster-<repo>, named for it" \
      '[ "$tsession" = "postmaster-$rname" ] && tmux list-windows -t "=$tsession" -F "#{window_name}" | grep -qxF "$NAME"' "$got"
    check "its marker lands" 'marker "$tmp/logs/l4.done" 60'
    check "its stream and errors are the same" 'cmp -s "$tmp/direct.out" "$tmp/logs/l4.out" && cmp -s "$tmp/direct.err" "$tmp/logs/l4.err"'
    check "close kills the worktree's window" 'POSTMASTER_HOST=tmux "$SELF" close "$wt" >/dev/null && ! tmux list-windows -t "=$tsession" -F "#{window_name}" 2>/dev/null | grep -qxF "$NAME"'
  else
    echo "tmux: not on PATH; its controls are skipped"
  fi

  finish "live test"
}

case ${1:-} in
  detect) detect ;;
  name) shift; name_cmd "$@" ;;
  run) shift; run_cmd "$@" ;;
  stop) shift; stop_cmd "$@" ;;
  close) shift; close_cmd "$@" ;;
  spawn) shift; spawn_cmd "$@" ;;
  send) shift; send_cmd "$@" ;;
  wait) shift; wait_cmd "$@" ;;
  read) shift; read_cmd "$@" ;;
  _run) runner "$2" "$3" ;;
  _handle) handle_of "$2" ;;
  --self-test) self_test ;;
  --live-test) live_test ;;
  *) echo "usage: host.sh detect | name | run | stop | close | spawn | send | wait | read | --self-test | --live-test (see the header)" >&2; exit 1 ;;
esac
