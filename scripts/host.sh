#!/usr/bin/env bash
# The session host: where a launch runs and how the user watches it. Herdr wherever a Herdr
# server answers, tmux where it does not, and a detached background process with neither.
# skills/postmaster/hosts.md records each form per host; this script is their executable
# form, and the two change together.
#
#   host.sh detect                        herdr, tmux or none, on stdout
#   host.sh name <dispatch>               the run's ticket name
#   host.sh name <dispatch> coachman <leg-name> <leg-number>
#   host.sh name <dispatch> workhorse <lane>
#   host.sh name <dispatch> review <lane> <lens> <round>
#   host.sh name <dispatch> postmaster
#   host.sh name <dispatch> role <text...>                          any other launch, by its role alone
#   host.sh run <name> <cwd> [--under <dispatch>] [--role lane|coachman|reviewer] [--run <dispatch>]
#               [--out <file>] [--err <file>] [--append] [--marker <file>]
#               [--pidfile <file>] -- <command...>
#   host.sh stop <worktree>               stop every launch still running in a worktree, and
#                                         everything each one started
#   host.sh close <worktree>              close its tabs/space (Herdr) and its windows (tmux)
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
# the caller. A run launch's <cwd>, including a reviewer's scratch clone, is its tab's working
# directory inside the run's synthesis-worktree space in Herdr. In tmux a scratch clone joins
# the session of the repository it was cut from. <name> labels the tab or window and the pane's
# title, and names the thread where the harness can (POSTMASTER_LAUNCH_NAME, read by launch.sh).
# If --out is set, its absolute path also reaches launch.sh as POSTMASTER_EVENT_STREAM so that a
# run can retain the harness's durable session beside that event stream.
# Pass a role-specific `host.sh name` result as the launch name and pass the dispatch separately,
# so the ticket title labels only the run space and never passes through a shell. A pane shows
# the stream through view-stream.sh. A launch carries its own pane's
# identity (HERDR_PANE_ID and the like, or TMUX_PANE), never its caller's. If the host cannot
# place it, it runs in the background. On Linux with a working systemd user manager, the command
# and its descendants run in a transient scope with MemoryMax, MemorySwapMax=0 and TasksMax;
# otherwise it runs uncapped and records that in --err. While it runs it is registered under
# POSTMASTER_HOST_STATE (default ~/.postmaster/host), whatever its host, so stop and close see it.
# The record names its group leader by start time and boot, so a pid another process reuses,
# after a reboot or within one, is never taken for the launch.
#
# stop: a launch's processes are its process group and everything they started, whatever session
# that moved to, as a harness that runs each tool command in a session of its own does. They are
# found by process id and parent, never by a command line; frozen first, so nothing forks
# between the listing and the signal; sent TERM; and sent KILL if still there after
# POSTMASTER_HOST_STOP_WAIT seconds. The process that ran stop, and those above it, never are.
# Before it signals anything it checks the whole set, and refuses, leaving everything running,
# if the set holds a systemd manager, the Herdr server or a Herdr client, the moshi-hook daemon,
# code-server, the tmux server, sshd, a process that is neither in a verified launch's group nor
# descended from one, or more than POSTMASTER_HOST_STOP_MAX processes.
#
# POSTMASTER_HOST=herdr|tmux|none overrides detection; nothing needs setting to get the default.
# POSTMASTER_HOST_CLAIM_WAIT (20) is how long a new pane has to start its launch,
# POSTMASTER_HOST_CLOSE_WAIT (15) how long close waits for a launch that is just ending, and
# POSTMASTER_HOST_STOP_WAIT (20) how long stop waits after TERM before it sends KILL, and
# POSTMASTER_HOST_STOP_MAX (512) the most processes one stop may signal.
#
#   exit 0  detected, named, started, stopped, closed, sent, settled or read
#   exit 1  usage, or nothing could be started
#   exit 2  close refused: a launch still runs in the worktree, or an affected pane or space
#           holds something host.sh did not open; or stop left something of a launch running,
#           named, or refused a set of processes it could not vouch for, saying why
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

dispatch_info() {  # dispatch_info <dispatch>: ticket name and synthesis worktree from its waybill
  python3 - "$1/brief.md" <<'PY'
import json, re, sys
name = worktree = ""
try:
    lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
except OSError:
    lines = []
inside = False
for line in lines:
    if line.startswith("## "):
        inside = line.strip() == "## Dispatch"
    elif inside and line.startswith("name:"):
        name = re.sub(r"\s{2,}\(.*\)$", "", line[5:]).strip()
    elif inside and line.startswith("synthesis worktree:"):
        worktree = line.split(":", 1)[1].strip()
print(json.dumps({"name": name, "synthesis_worktree": worktree}))
PY
}

name_cmd() {  # name <dispatch> [coachman|workhorse|review|postmaster|role ...]
  local d=${1:?usage: host.sh name <dispatch> [coachman <leg-name> <leg-number> | workhorse <lane> | review <lane> <lens> <round> | postmaster | role <text...>]}
  local result
  shift
  result=$(python3 - "$d" "$HERE" "$@" <<'PY'
import json, os, re, subprocess, sys
d, tool, *args = sys.argv[1:]
try:
    brief = open(os.path.join(d, "brief.md"), encoding="utf-8", errors="replace").read().splitlines()
except OSError:
    brief = []
ticket = ""
inside = False
for line in brief:
    if line.startswith("## "):
        inside = line.strip() == "## Dispatch"
    elif inside and line.startswith("name:"):
        ticket = re.sub(r"\s{2,}\(.*\)$", "", line[5:]).strip()
        break
ticket = ticket or os.path.basename(d)
if not args:
    print(ticket)
    raise SystemExit(0)
def as_dict(value):  # stores are third-party text: anything not a mapping is no store at all
    return value if isinstance(value, dict) else {}
try:
    run = as_dict(json.load(open(os.path.join(d, "run.json"), encoding="utf-8")))
except (OSError, json.JSONDecodeError):
    run = {}
config = as_dict(run.get("config"))
lanes = as_dict(config.get("lanes"))
team = as_dict(config.get("team"))
def shown(model):  # a model id as a label part: the provider prefix never tells launches apart
    return str(model).rsplit("/", 1)[-1]
# The strict front end: every argument below passes through exactly one of these,
# each refusing cleanly, and no branch labels from a value one did not return.
def need_manifest_leg():
    try:
        raw = json.load(open(os.path.join(d, "manifest.json"))).get("leg", 0)
    except (OSError, AttributeError, ValueError, TypeError, json.JSONDecodeError):
        raise SystemExit("host: cannot resolve the coachman leg from manifest.json")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise SystemExit("host: cannot resolve the coachman leg from manifest.json")
    return raw
def need_lane_model(lane, role):
    spec = lanes.get(lane)
    if not isinstance(spec, dict) or not spec.get("model"):
        raise SystemExit("host: no recorded model for %s lane %s" % (role, lane))
    return spec
def need_coachman_model(leg_name):
    spec = as_dict(team.get("coachman_legs")).get(leg_name) or team.get("coachman")
    if not isinstance(spec, dict) or not spec.get("model"):
        raise SystemExit("host: no recorded model for coachman leg " + leg_name)
    return spec
def need_lens(lens):
    if lens not in ("style", "bug", "security"):
        raise SystemExit("host: review lens must be style, bug or security")
    return lens
def need_leg_name(name):
    if not name:
        raise SystemExit("host: coachman leg name must not be empty")
    known = set()
    legs = subprocess.run([os.path.join(tool, "turnpikes.sh"), "legs", d], capture_output=True, text=True)
    if legs.returncode == 0:
        for line in legs.stdout.splitlines():
            fields = line.split()
            if len(fields) > 1:
                known.add(fields[1])
    if name not in known:
        raise SystemExit("host: unknown coachman leg " + name)
    return name
def need_leg_number(text):
    if not re.fullmatch(r"[0-9]+", text or ""):
        raise SystemExit("host: coachman leg number must be a whole number")
    try:
        n = int(text)
    except ValueError:
        raise SystemExit("host: coachman leg number must be a whole number") from None
    if n < 1:
        raise SystemExit("host: coachman leg number must be 1 or more")
    return n
def need_round(text):
    if not re.fullmatch(r"[0-9]+", text or ""):
        raise SystemExit("host: review round must be a whole number")
    try:
        n = int(text)
    except ValueError:
        raise SystemExit("host: review round must be a whole number") from None
    if n < 1:
        raise SystemExit("host: review round must be 1 or more")
    if not os.path.isfile(os.path.join(d, "logs", "review-r%d.json" % n)):
        raise SystemExit("host: unknown review round %d" % n)
    return n
if len(args) == 1 and args[0] == "coachman":
    n = need_manifest_leg()
    legs = subprocess.run([os.path.join(tool, "turnpikes.sh"), "legs", d], capture_output=True, text=True)
    name = ""
    if legs.returncode == 0:
        for line in legs.stdout.splitlines():
            fields = line.split()
            if len(fields) > 1 and fields[0] == str(n):
                name = fields[1]
                break
    if not name:
        raise SystemExit("host: cannot resolve leg %d from the waybill's turnpikes" % n)
    # Resolved names re-validate below; the second listing is cheap and keeps the invariant total.
    args = ["coachman", name, str(n)]
elif len(args) == 1 and args[0] in lanes:
    lane = args[0]
    workhorses = team.get("workhorses")
    if not isinstance(workhorses, list):
        workhorses = []
    args = ["workhorse", lane] if lane in workhorses else args
elif len(args) == 1:
    legacy = re.fullmatch(r"([^\s]+) (style|bug|security) review", args[0])
    if legacy:
        lane, lens = legacy.groups()
        rounds = []
        try:
            for file in os.listdir(os.path.join(d, "logs")):
                match = re.fullmatch(r"review-r([0-9]+)\.json", file)
                if match:
                    rounds.append(int(match.group(1)))
        except OSError:
            pass
        args = ["review", lane, lens, str(max(rounds) if rounds else 1)]
mode = args[0]
parts = []
if mode == "postmaster" and len(args) == 1:
    parts = ["postmaster"]
elif mode == "coachman" and len(args) == 3:
    leg_name = need_leg_name(args[1])
    leg_int = need_leg_number(args[2])
    spec = need_coachman_model(leg_name)
    parts = ["coachman", shown(spec["model"]), "leg " + str(leg_int)]
elif mode == "workhorse" and len(args) == 2:
    spec = need_lane_model(args[1], "workhorse")
    parts = [args[1], "workhorse", shown(spec["model"])]
elif mode == "review" and len(args) == 4:
    lane = args[1]
    spec = need_lane_model(lane, "reviewer")
    parts = [lane, need_lens(args[2]) + " review", shown(spec["model"]), "r" + str(need_round(args[3]))]
elif mode == "role" and len(args) >= 2:
    parts = list(args[1:])
else:
    raise SystemExit("host: invalid launch identity; use coachman, workhorse, review, postmaster or role")
print(" · ".join(parts))
PY
) || return 1
  clean "$result"; echo
}

# Remember the tabs this host creates inside shared run spaces. A later `close <worktree>` can
# then close that checkout's tabs without closing the ticket space or a tab opened by the user.
herdr_record_placement() {  # herdr_record_placement <space> <tab> <pane> <cwd>
  mkdir -p "$STATE/placements" 2>/dev/null || return 1
  python3 - "$STATE/placements" "$1" "$2" "$3" "$4" <<'PY'
import hashlib, json, os, sys, tempfile
directory, workspace, tab, pane, cwd = sys.argv[1:]
name = hashlib.sha256(tab.encode("utf-8")).hexdigest() + ".json"
fd, temporary = tempfile.mkstemp(prefix=".placement-", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump({"workspace": workspace, "tab": tab, "pane": pane, "cwd": os.path.realpath(cwd)}, stream)
        stream.write("\n")
    os.replace(temporary, os.path.join(directory, name))
except BaseException:
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
PY
}

# A dispatch's synthesis worktree is its Herdr run space. Every launch gets a tab of its
# own with its own checkout as the working directory, the first one included: the root tab
# Herdr creates with the run space belongs to the space, not to the launch, so the first
# launch closes it once its own tab exists. A security-review clone therefore stays under
# the run, in a tab rooted at the clone.
# Best-effort rollback for a failed first placement: close the root tab this launch
# just created, so a failure before the launch lands leaves nothing behind. A racing
# first launch may own the space by now, but the root tab is still this launch's to
# close; when it is the sole tab, Herdr destroys the childless space with it
# (probed 2026-09-29), which is the rollback — sole means no racing launch has
# placed a tab. Warns instead of failing: the caller is already failing, and Herdr
# may be too sick to close.
rollback_root_tab() {  # rollback_root_tab <root-tab-id>
  herdr tab close "$1" >/dev/null 2>&1 \
    || warn "could not roll back the run space's root tab $1 after a failed placement; close it by hand"
}
# Best-effort rollback for a failure after the launch tab exists: close the tab
# just created, by its id, which this launch knows is its own even when the
# tag failed. Unlike close_placements it needs no token: the id is enough, and
# the untagged tab is exactly what must go. Warns instead of failing.
rollback_launch_tab() {  # rollback_launch_tab <tab-id>
  herdr tab close "$1" >/dev/null 2>&1 \
    || warn "could not roll back launch tab $1 after a failed placement; close it by hand"
}
herdr_run_place() {  # herdr_run_place <name> <cwd> <dispatch>: prints "<space> <tab> <pane>"
  local name=$1 cwd=$2 dispatch=$3 info runname runpath list src root rname runspace="" out tab pane roottab rootpane
  info=$(dispatch_info "$dispatch") || return 1
  runname=$(clean "$(printf '%s' "$info" | json 'd.get("name")')")
  runpath=$(printf '%s' "$info" | json 'd.get("synthesis_worktree")')
  [ -n "$runname" ] && [ -n "$runpath" ] && [ -d "$runpath" ] || return 1
  list=$(herdr worktree list --cwd "$runpath" 2>/dev/null) || return 1
  IFS=$'\t' read -r src root rname runspace < <(printf '%s' "$list" | python3 -c '
import json, os, sys
d = json.load(sys.stdin)["result"]
runpath = os.path.realpath(sys.argv[1])
w = next((w for w in d.get("worktrees") or [] if os.path.realpath(w["path"]) == runpath), {})
print("\t".join([d.get("source", {}).get("source_workspace_id") or "-",
                 d.get("source", {}).get("repo_root") or "-",
                 d.get("source", {}).get("repo_name") or "-",
                 w.get("open_workspace_id") or "-" ]))' "$runpath")
  [ "$src" = - ] && src=""
  [ "$root" = - ] && root=""
  [ "$rname" = - ] && rname=""
  [ "$runspace" = - ] && runspace=""
  if [ -z "$src" ]; then
    [ -n "$root" ] && [ -n "$rname" ] || return 1
    out=$(herdr workspace create --cwd "$root" --label "$rname" --no-focus) || return 1
    src=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
  fi
  if [ -z "$runspace" ]; then
    out=$(herdr worktree open --workspace "$src" --path "$runpath" --label "$runname" --no-focus) || return 1
    runspace=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
    roottab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
    rootpane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
    [ -n "$runspace" ] && [ -n "$roottab" ] && [ -n "$rootpane" ] || return 1
    # Mark it at once, then roll back on any failure below: a failed first
    # placement leaves nothing behind, and when the rollback fails too, what
    # survives is still a marked space close can shut.
    herdr workspace report-metadata "$runspace" --source "$META" --token postmaster=opened >/dev/null 2>&1 \
      || { rollback_root_tab "$roottab"; return 1; }
    herdr pane report-metadata "$rootpane" --source "$META" --title "$name" --token postmaster=launch >/dev/null 2>&1 \
      || { rollback_root_tab "$roottab"; return 1; }
    out=$(herdr tab create --workspace "$runspace" --cwd "$cwd" --label "$name" --no-focus) \
      || { rollback_root_tab "$roottab"; return 1; }
    tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
    pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
    [ -n "$tab" ] && [ -n "$pane" ] || { rollback_root_tab "$roottab"; return 1; }
    # Its close is cosmetic: when it fails the launch still runs in the right tab,
    # and the warning names the tab left behind. Never fail a launch over it.
    herdr tab close "$roottab" >/dev/null 2>&1 \
      || warn "could not close the run space's root tab $roottab; leaving it beside the launch tab"
  else
    out=$(herdr tab create --workspace "$runspace" --cwd "$cwd" --label "$name" --no-focus) || return 1
    tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
    pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
  fi
  # An id-less create in a later launch names nothing to roll back: without ids
  # there is nothing to close, and sweeping untagged panes would risk a racing
  # launch's. The first launch never reaches this line without ids.
  [ -n "$runspace" ] && [ -n "$tab" ] && [ -n "$pane" ] || return 1
  herdr tab rename "$tab" "$name" >/dev/null 2>&1 \
    || { rollback_launch_tab "$tab"; return 1; }
  herdr pane report-metadata "$pane" --source "$META" --title "$name" --token postmaster=launch >/dev/null 2>&1 \
    || { rollback_launch_tab "$tab"; return 1; }
  # A placement the record refuses still shuts: its tab is tagged, so close
  # vouches for the space without the record. A control pins it.
  herdr_record_placement "$runspace" "$tab" "$pane" "$cwd" || return 1
  printf '%s %s %s\n' "$runspace" "$tab" "$pane"
}

# --- the registry of running launches ------------------------------------------------------
# One file per launch, named for its process group: the directory it was placed in, its name,
# `start <t>` for its group leader's start time (field 22 of /proc/<pid>/stat, or what ps prints
# where there is no /proc) and `boot <id>` for the boot it started in. A pid is reused, after a
# reboot and within one, so a record stands for a launch only while that same leader is alive in
# that same boot. Once the leader has exited, its runner writes `member <pid> <t>` for each
# process still in its group, and the record stands for those that still match. A record that
# stands for nothing is removed by whoever reads it next. One written before the start and boot
# lines existed is kept only if it was written in this boot by a leader that had already started,
# and it is then rewritten with them.
REGISTRY='import os, subprocess, sys, time
PROC = os.path.isdir("/proc/self")

def run(*argv):
    r = subprocess.run(argv, capture_output=True, text=True, env=dict(os.environ, LC_ALL="C"))
    return r.stdout if r.returncode == 0 else ""

def boot_id():
    try:
        with open("/proc/sys/kernel/random/boot_id") as f:
            return f.read().strip()
    except OSError:
        return " ".join(run("sysctl", "-n", "kern.boottime").split())

def boot_time():
    """When this boot started, in seconds since the epoch, or None."""
    try:
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("btime "):
                    return int(line.split()[1])
    except OSError:
        pass
    words = run("sysctl", "-n", "kern.boottime").replace(",", " ").split()
    return int(words[words.index("sec") + 2]) if "sec" in words else None

def start_of(pid):
    """The start time of a live process, as the registry records it, or None."""
    if PROC:
        try:
            with open("/proc/%d/stat" % pid) as f:
                rest = f.read().rpartition(")")[2].split()
        except OSError:
            return None
        return rest[19] if rest and rest[0] != "Z" else None
    f = run("ps", "-o", "stat=,lstart=", "-p", str(pid)).split()
    return " ".join(f[1:6]) if len(f) >= 6 and not f[0].startswith("Z") else None

def processes():
    """pid -> (group, start) for every live process."""
    t = {}
    if PROC:
        for p in os.listdir("/proc"):
            if p.isdigit():
                try:
                    with open("/proc/%s/stat" % p) as f:
                        rest = f.read().rpartition(")")[2].split()
                except OSError:
                    continue
                if rest and rest[0] != "Z":
                    t[int(p)] = (int(rest[2]), rest[19])
    else:
        for line in run("ps", "-A", "-o", "pid=,pgid=,stat=,lstart=").splitlines():
            f = line.split()
            if len(f) >= 8 and f[0].isdigit() and f[1].isdigit() and not f[2].startswith("Z"):
                t[int(f[0])] = (int(f[1]), " ".join(f[3:8]))
    return t

def started_at(start):
    """When a process with this start time started, in seconds since the epoch, or None."""
    if start.isdigit():
        booted = boot_time()
        return None if booted is None else booted + int(start) / os.sysconf("SC_CLK_TCK")
    try:
        return time.mktime(time.strptime(start, "%a %b %d %H:%M:%S %Y"))
    except ValueError:
        return None

def load(path):
    with open(path) as f:
        lines = f.read().split("\n")
    rec = {"dir": lines[0], "name": lines[1] if len(lines) > 1 else "", "start": None, "boot": None, "members": []}
    for line in lines[2:]:
        key, _, value = line.partition(" ")
        if key == "start":
            rec["start"] = value
        elif key == "boot":
            rec["boot"] = value
        elif key == "member":
            pid, _, start = value.partition(" ")
            if pid.isdigit() and start:
                rec["members"].append((int(pid), start))
    return rec

def save(path, rec):
    new = path + ".new"
    with open(new, "w") as f:
        f.write("%s\n%s\nstart %s\nboot %s\n" % (rec["dir"], rec["name"], rec["start"] or "", rec["boot"] or ""))
        for pid, start in rec["members"]:
            f.write("member %d %s\n" % (pid, start))
    os.replace(new, path)

def drop(path):
    try:
        os.unlink(path)
    except OSError:
        pass

def roots(path, group, rec, procs, boot):
    """What the record still stands for: group|<pid>|<start> while its leader lives, else
    tree|<pid>|<start> for each recorded member that does; None when it stands for nothing."""
    if rec["start"] is None and rec["boot"] is None:        # written before start and boot were
        booted = boot_time()
        try:
            written = os.stat(path).st_mtime
        except OSError:
            return None
        if group not in procs or booted is None or written < booted:
            return None
        began = started_at(procs[group][1])
        if began is None or began > written + 2:             # the pid is newer than the record
            return None
        rec["start"], rec["boot"] = procs[group][1], boot
        save(path, rec)
    if not rec["boot"] or rec["boot"] != boot:
        return None
    if group in procs and rec["start"] and procs[group][1] == rec["start"]:
        return ["group|%d|%s" % (group, rec["start"])]
    out = ["tree|%d|%s" % (p, s) for p, s in rec["members"] if p in procs and procs[p][1] == s]
    return out or None

cmd, reg = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""
if cmd == "add":                                  # add <registry> <group> <dir> <name>
    group = int(sys.argv[3])
    os.makedirs(reg, exist_ok=True)
    save(os.path.join(reg, str(group)), {"dir": sys.argv[4], "name": sys.argv[5],
         "start": start_of(group) or "", "boot": boot_id(), "members": []})
elif cmd == "members":                            # members <registry> <group>: its leader has exited
    group = int(sys.argv[3])
    path = os.path.join(reg, str(group))
    try:
        rec = load(path)
    except OSError:
        sys.exit(0)
    rec["members"] = sorted((p, v[1]) for p, v in processes().items() if v[0] == group)
    save(path, rec) if rec["members"] else drop(path)
elif cmd == "scan":                               # scan <registry> <dir>
    boot, procs = boot_id(), processes()
    try:
        names = sorted(os.listdir(reg))
    except OSError:
        names = []
    for n in names:
        if not n.isdigit():
            continue
        path = os.path.join(reg, n)
        try:
            rec = load(path)
        except OSError:
            continue
        r = roots(path, int(n), rec, procs, boot)
        if r is None:
            drop(path)
        elif rec["dir"] == sys.argv[3]:
            print("\t".join([n, rec["name"]] + r))
elif cmd == "start":                              # the self-test: start <pid>
    print(start_of(int(sys.argv[2])) or "")
elif cmd == "started":                            # started <pid>: when, in seconds since the epoch
    at = started_at(start_of(int(sys.argv[2])) or "")
    print("" if at is None else int(at))
elif cmd == "boot":
    print(boot_id())
elif cmd == "booted":
    print(boot_time() or "")'
fixture_guard() {  # while a self-test runs, the registry is its fixture and never the live one
  [ -z "${POSTMASTER_HOST_FIXTURE:-}" ] && return 0
  case $STATE/ in "$POSTMASTER_HOST_FIXTURE"/*) return 0 ;; esac
  warn "refusing the registry at $STATE: a self-test uses only its fixture, $POSTMASTER_HOST_FIXTURE"
  return 1
}
reg_add() {  # reg_add <group> <dir> <name>
  fixture_guard || return 1
  python3 -c "$REGISTRY" add "$STATE/launches" "$1" "$2" "$3"
}
reg_members() {  # reg_members <group>: its leader has exited; note what is left of its group, or drop it
  fixture_guard || return 1
  python3 -c "$REGISTRY" members "$STATE/launches" "$1"
}
reg_scan() {  # reg_scan <dir>: "<group>\t<name>\t<root>..." per launch placed in <dir> that checks out
  fixture_guard || return 1
  python3 -c "$REGISTRY" scan "$STATE/launches" "$1"
}
reg_live() {  # reg_live <dir>: "<group>\t<name>" per launch still running that was placed in <dir>
  local out
  out=$(reg_scan "$1") || return 1
  [ -z "$out" ] || printf '%s\n' "$out" | cut -f1,2
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
      out=$(herdr workspace create --cwd "$root" --label "$rname" --no-focus ${PLACE_ENV[@]+"${PLACE_ENV[@]}"}) || return 1
      src=$(printf '%s' "$out" | json 'd["result"]["workspace"]["workspace_id"]')
      # This is the first pane of the project space. Use it for a project-level launch such as
      # the postmaster, instead of leaving an empty shell beside the launch tab.
      if [ "$where" = repo ] || [ "$wkind" = main ]; then
        tab=$(printf '%s' "$out" | json 'd["result"]["tab"]["tab_id"]')
        pane=$(printf '%s' "$out" | json 'd["result"]["root_pane"]["pane_id"]')
      fi
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
  herdr tab rename "$tab" "$name" >/dev/null 2>&1
  herdr pane report-metadata "$pane" --source "$META" --title "$name" --token postmaster=launch >/dev/null 2>&1
  printf '%s %s %s\n' "$space" "$tab" "$pane"
}

# --- launch plumbing ----------------------------------------------------------------------
# A launch is handed to its runner through a private directory: the fields as files, the argv
# NUL-separated, and for a pane the caller's environment through a FIFO, so it is never written
# to disk or put on any command line. Whoever creates <spec>/claimed first runs it; the runner
# removes the spec once it has read it.
SPEC_FIELDS="name cwd rundir state out err marker pidfile append role memory tasks capmode systemd_run systemctl setsid unit"
write_spec() {  # write_spec <spec> <name> <cwd> <out> <err> <marker> <pidfile> <append> <role> <memory> <tasks> <capmode> <systemd-run> <systemctl> <setsid> <unit> <argv...>
  local s=$1; shift
  printf '%s' "$1" > "$s/name"; printf '%s' "$2" > "$s/cwd"; printf '%s' "$PWD" > "$s/rundir"
  printf '%s' "$STATE" > "$s/state"; printf '%s' "$3" > "$s/out"; printf '%s' "$4" > "$s/err"
  printf '%s' "$5" > "$s/marker"; printf '%s' "$6" > "$s/pidfile"; printf '%s' "$7" > "$s/append"
  printf '%s' "$8" > "$s/role"; printf '%s' "$9" > "$s/memory"; printf '%s' "${10}" > "$s/tasks"
  printf '%s' "${11}" > "$s/capmode"; printf '%s' "${12}" > "$s/systemd_run"; printf '%s' "${13}" > "$s/systemctl"
  printf '%s' "${14}" > "$s/setsid"; printf '%s' "${15}" > "$s/unit"
  shift 15
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
if sys.argv[1] != "capped": os.setsid()
try:
    os.execvpe(sys.argv[2], sys.argv[2:], env)
except OSError as e:
    sys.stderr.write("host: cannot run %s: %s\n" % (sys.argv[2], e.strerror)); os._exit(127)'

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

# --- per-launch limits --------------------------------------------------------------------
launch_limits() {  # launch_limits <role> <dispatch-or-empty> <live-config>: memory and task caps
  python3 - "$1" "$2" "$3" <<'PY'
import json, os, re, sys, tomllib

role, dispatch, config_path = sys.argv[1:]
memory_default, tasks_default = "8G", 512
try:
    if dispatch:
        with open(os.path.join(dispatch, "run.json"), encoding="utf-8") as f:
            top = json.load(f)
        if not isinstance(top, dict):
            print("host: run.json must hold an object", file=sys.stderr); sys.exit(1)
        config = top.get("config", {})
    elif os.path.isfile(config_path):
        with open(config_path, "rb") as f:
            config = tomllib.load(f)
    else:
        config = {}
except (OSError, json.JSONDecodeError, tomllib.TOMLDecodeError) as e:
    print("host: cannot read launch limits: %s" % type(e).__name__, file=sys.stderr)
    sys.exit(1)

if not isinstance(config, dict):
    print("host: config must be a table", file=sys.stderr); sys.exit(1)
limits = config.get("limits", {})
if not isinstance(limits, dict):
    print("host: limits must be a table", file=sys.stderr); sys.exit(1)
role_limits = limits.get(role, {}) if role != "default" else {}
if not isinstance(role_limits, dict):
    print("host: limits.%s must be a table" % role, file=sys.stderr); sys.exit(1)
memory = role_limits.get("memory_max", limits.get("memory_max", memory_default))
tasks = role_limits.get("tasks_max", limits.get("tasks_max", tasks_default))
if not isinstance(memory, str) or not re.fullmatch(r"[1-9][0-9]*(?:K|M|G|T)", memory):
    print("host: memory_max must be a positive whole number followed by K, M, G or T", file=sys.stderr)
    sys.exit(1)
if isinstance(tasks, bool) or not isinstance(tasks, int) or not 1 <= tasks <= 2147483647:
    print("host: tasks_max must be a whole number from 1 to 2147483647", file=sys.stderr)
    sys.exit(1)
print("%s\t%d" % (memory, tasks))
PY
}

systemd_capability() {  # print the verified systemd-run, systemctl and setsid paths, or nothing
  local runbin ctlbin sidbin sleepbin unit probe cg mem swap tasks oom i verified=0
  [ "$(uname -s 2>/dev/null)" = Linux ] || return 1
  runbin=$(command -v systemd-run) || return 1
  ctlbin=$(command -v systemctl) || return 1
  sidbin=$(command -v setsid) || return 1
  sleepbin=$(command -v sleep) || return 1
  [ -r /sys/fs/cgroup/cgroup.controllers ] || return 1
  grep -qw memory /sys/fs/cgroup/cgroup.controllers || return 1
  grep -qw pids /sys/fs/cgroup/cgroup.controllers || return 1
  limit 2 "$ctlbin" --user show-environment >/dev/null 2>&1 || return 1
  unit="postmaster-cap-probe-${BASHPID:-$$}-${RANDOM}.scope"
  limit 2 "$runbin" --user --scope --quiet --unit="$unit" \
    --property=MemoryMax=128M --property=MemorySwapMax=0 --property=TasksMax=32 --property=OOMPolicy=kill \
    -- "$sleepbin" 0.35 >/dev/null 2>&1 &
  probe=$!
  for i in {1..30}; do
    cg=$(limit 1 "$ctlbin" --user show "$unit" --property=ControlGroup --value 2>/dev/null) || cg=""
    case $cg in /*) ;; *) cg="" ;; esac
    if [ -n "$cg" ] && [ -r "/sys/fs/cgroup$cg/memory.max" ] && [ -r "/sys/fs/cgroup$cg/pids.max" ]; then
      mem=$(cat "/sys/fs/cgroup$cg/memory.max" 2>/dev/null)
      swap=$(cat "/sys/fs/cgroup$cg/memory.swap.max" 2>/dev/null)
      tasks=$(cat "/sys/fs/cgroup$cg/pids.max" 2>/dev/null)
      oom=$(cat "/sys/fs/cgroup$cg/memory.oom.group" 2>/dev/null)
      [ "$mem" = 134217728 ] && [ "$swap" = 0 ] && [ "$tasks" = 32 ] && [ "$oom" = 1 ] && verified=1
      break
    fi
    kill -0 "$probe" 2>/dev/null || break
    sleep 0.025
  done
  wait "$probe" >/dev/null 2>&1 || return 1
  [ "$verified" -eq 1 ] || return 1
  printf '%s\t%s\t%s\n' "$runbin" "$ctlbin" "$sidbin"
}

watch_cap_events() {  # watch_cap_events <systemctl> <unit> <event-file> <runner-pid>
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import os, select, subprocess, sys, time

systemctl, unit, event_file, runner = sys.argv[1:]
def alive(pid):
    try: os.kill(int(pid), 0); return True
    except (ProcessLookupError, ValueError): return False
def show(prop):
    try:
        p = subprocess.run([systemctl, "--user", "show", unit, "--property=" + prop, "--value"],
                           capture_output=True, text=True, timeout=0.4)
        return p.stdout.strip() if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""
def events(path):
    try:
        return dict((k, int(v)) for k, v in (line.split() for line in open(path)))
    except (OSError, ValueError):
        return {}
def note(kind):
    with open(event_file, "w", encoding="ascii") as f:
        f.write(kind + "\n")
    try:
        subprocess.run([systemctl, "--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        pass

deadline = time.monotonic() + 5
cgroup = ""
while time.monotonic() < deadline and alive(runner):
    cgroup = show("ControlGroup")
    if cgroup.startswith("/") and ".." not in cgroup.split("/"):
        break
    time.sleep(0.025)
if not cgroup.startswith("/") or ".." in cgroup.split("/"):
    sys.exit(0)
# POSTMASTER_CGROUP_ROOT points the watcher at a fixture tree for tests; unset,
# it reads the live controllers. Only the launch environment sets it, which a
# lane cannot reach back into, so a launch cannot blind its own watcher.
cgroot = os.environ.get("POSTMASTER_CGROUP_ROOT") or "/sys/fs/cgroup"
root = cgroot + cgroup
pids_path = os.path.join(root, "pids.events")
mem_path = os.path.join(root, "memory.events")
def tripped():
    if events(pids_path).get("max", 0): return "process"
    # Memory trips on this cgroup's OOM decision, not on pressure and not on any
    # victim here: `max` fires hundreds of times while reclaim succeeds (a healthy
    # cache-heavy launch brushing the cap), and `oom_kill` counts victims of any
    # OOM killer including a host-wide one, which would blame MemoryMax for the
    # machine running out. `oom` fires exactly when this cgroup's usage reached
    # its limit and allocation was about to fail. A refused fork has no reclaim
    # analogue, so the process cap keeps `max`.
    mem = events(mem_path)
    if mem.get("oom", 0): return "memory"
    return ""
# The events files wake a poller when their counters change, so the watch
# blocks in the kernel instead of waking on a timer: a trip is read within
# milliseconds however long the launch runs, and a launch that exits right
# after its trip is still caught while its cgroup outlives it. The first read
# is the baseline; every wake re-reads, since a wake promises only change, not
# a trip; the timeout re-reads too, for a trip that lands between the baseline
# and the registration.
kind = tripped()
po = select.poll()
try:
    pfd = open(pids_path); mfd = open(mem_path)
    # An events file stays ready to poll until it is read again through the
    # same descriptor: read each once to arm it, and again after every wake,
    # or the poll returns at once forever and the watcher spins.
    pfd.read(); mfd.read()
    po.register(pfd, select.POLLPRI | select.POLLERR)
    po.register(mfd, select.POLLPRI | select.POLLERR)
    byfd = {pfd.fileno(): pfd, mfd.fileno(): mfd}
    armed = True
except OSError:
    armed = False
while not kind and os.path.isdir(root) and alive(runner):
    if armed:
        for fd, _ in po.poll(100):
            try:
                byfd[fd].seek(0); byfd[fd].read()
            except OSError:
                pass
    else: time.sleep(0.1)
    kind = tripped()
if not kind:
    kind = tripped()
if kind:
    note(kind)
PY
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
  local name=${1:-} cwd=${2:-} under="" out="" err="" marker="" pidfile="" append=0 bad=""
  local role=default dispatch="" memory tasks cap_mode=uncapped systemd_run="" systemctl="" setsid="" unit="" caps="" paths=""
  [ $# -ge 2 ] && shift 2 || set --
  while [ $# -gt 0 ]; do
    case $1 in
      --under|--role|--run|--out|--err|--marker|--pidfile)
        [ $# -ge 2 ] || { bad="$1 needs a value"; break; }
        case $1 in
          --under) under=$2 ;;
          --role) role=$2 ;;
          --run) dispatch=$2 ;;
          --out) out=$2 ;;
          --err) err=$2 ;;
          --marker) marker=$2 ;;
          --pidfile) pidfile=$2 ;;
        esac
        shift ;;
      --append) append=1 ;;
      --) shift; break ;;
      *) bad="unknown option for run: $1 (the command goes after --)"; set --; break ;;
    esac
    shift
  done
  abs() { case $1 in ""|/*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
  out=$(abs "$out"); err=$(abs "$err"); marker=$(abs "$marker"); pidfile=$(abs "$pidfile"); dispatch=$(abs "$dispatch")
  FAIL_ERR=$err FAIL_MARKER=$marker
  [ -z "$bad" ] || launch_failed "$bad"
  [ -n "$name" ] && [ -n "$cwd" ] || launch_failed "usage: host.sh run <name> <cwd> [options] -- <command...>"
  [ $# -gt 0 ] || launch_failed "run needs a command after --"
  [ -d "$cwd" ] || launch_failed "no such directory: $cwd"
  case $role in default|lane|coachman|reviewer) ;; *) launch_failed "unknown launch role: $role" ;; esac
  caps=$(launch_limits "$role" "$dispatch" "${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}" 2>&1) \
    || launch_failed "could not resolve launch limits: ${caps#host: }"
  IFS=$'\t' read -r memory tasks <<< "$caps"
  paths=$(systemd_capability) && {
    IFS=$'\t' read -r systemd_run systemctl setsid <<< "$paths"
    cap_mode=systemd
  } || {
    warn "launch '$name' running uncapped: per-launch cgroup limits are unavailable"
  }
  [ "$cap_mode" != systemd ] || unit="postmaster-host-$$-$RANDOM-$RANDOM.scope"
  local claim_wait
  claim_wait=$(count "${POSTMASTER_HOST_CLAIM_WAIT:-20}" POSTMASTER_HOST_CLAIM_WAIT) || launch_failed "no launch: POSTMASTER_HOST_CLAIM_WAIT"
  cwd=$(CDPATH= cd -P -- "$cwd" && pwd -P); name=$(clean "$name")
  [ -n "$pidfile" ] && rm -f -- "$pidfile"          # never an earlier launch's pid
  [ -n "$marker" ] && rm -f -- "$marker"            # or its marker

  local spec host where="" rpid=""
  spec=$(mktemp -d "${TMPDIR:-/tmp}/postmaster-host.XXXXXX") || launch_failed "cannot make a spec directory"
  write_spec "$spec" "$name" "$cwd" "$out" "$err" "$marker" "$pidfile" "$append" \
    "$role" "$memory" "$tasks" "$cap_mode" "$systemd_run" "$systemctl" "$setsid" "$unit" "$@"
  host=$(detect)
  case $host in
    herdr)
      local placed space tab pane
      if [ -n "$under" ]; then
        placed=$(herdr_run_place "$name" "$cwd" "$under")
      else
        placed=$(herdr_place "$name" "$cwd")
      fi
      if [ -n "$placed" ]; then
        read -r space tab pane <<< "$placed"
        mkfifo "$spec/env" && start_env_writer "$spec/env"
        if herdr pane run "$pane" " cd -- $(q "$cwd") && $(q "$SELF") _run herdr $(q "$spec")" >/dev/null 2>&1; then
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
  local name cwd rundir out err marker pidfile append role memory tasks cap_mode systemd_run systemctl setsid unit
  local argv=() envs=() kv k last="" capwatch="" cap_event="" event_file="$spec.cap"
  name=$(cat "$spec/name"); cwd=$(cat "$spec/cwd"); rundir=$(cat "$spec/rundir"); STATE=$(cat "$spec/state")
  out=$(cat "$spec/out"); err=$(cat "$spec/err"); marker=$(cat "$spec/marker")
  pidfile=$(cat "$spec/pidfile"); append=$(cat "$spec/append")
  role=$(cat "$spec/role"); memory=$(cat "$spec/memory"); tasks=$(cat "$spec/tasks"); cap_mode=$(cat "$spec/capmode")
  systemd_run=$(cat "$spec/systemd_run"); systemctl=$(cat "$spec/systemctl"); setsid=$(cat "$spec/setsid"); unit=$(cat "$spec/unit")
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
  local drop="POSTMASTER_LAUNCH_NAME POSTMASTER_EVENT_STREAM $PANE_IDS" keep=""
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
  [ -z "$out" ] || childenv+=("POSTMASTER_EVENT_STREAM=$out")

  # Its streams are emptied once and then only ever appended to, so a second writer on the same
  # file, such as a resume started too soon, cannot overwrite what the first wrote. --append
  # keeps what --out held; --err holds only this launch's errors.
  local o=/dev/null e=/dev/null from=0 cpid rc=0 vpid="" rpid="" t0
  [ "$mode" != bg ] && { o=/dev/stdout; e=/dev/stderr; }
  [ -n "$out" ] && { o=$out; [ "$append" = 1 ] || : > "$out"; }
  [ -n "$err" ] && { e=$err; : > "$err"; }
  [ "$append" = 1 ] && [ -f "$out" ] && from=$(wc -c < "$out" | tr -d ' ')
  t0=$(date +%s)
  rm -f -- "$event_file"
  if [ "$cap_mode" = systemd ]; then
    ( CDPATH= cd -- "$rundir" && exec "$setsid" "$systemd_run" --user --scope --quiet --unit="$unit" \
        --property="MemoryMax=$memory" --property=MemorySwapMax=0 --property="TasksMax=$tasks" --property=OOMPolicy=kill \
        -- python3 -c "$START_CHILD" capped "${argv[@]}" 3< <(printf '%s\0' "${childenv[@]}") ) \
      >> "$o" 2>> "$e" < /dev/null &
  else
    launch_notice "launch running uncapped (no supported per-launch limits available)"
    ( CDPATH= cd -- "$rundir" && exec python3 -c "$START_CHILD" uncapped "${argv[@]}" 3< <(printf '%s\0' "${childenv[@]}") ) \
      >> "$o" 2>> "$e" < /dev/null &
  fi
  cpid=$!
  # The marker's watcher and the registry record come before the pidfile, since run returns to
  # its caller the moment the pidfile holds a pid: a caller that stops or kills the launch then
  # finds it registered, and its marker still lands.
  trap 'kill -TERM -- "-$cpid" 2>/dev/null || kill -TERM "$cpid" 2>/dev/null' HUP INT TERM
  [ "$mode" != bg ] && [ -n "$marker" ] && watch_exit "$cpid" "$marker"
  if [ "$cap_mode" = systemd ]; then
    watch_cap_events "$systemctl" "$unit" "$event_file" "$cpid" & capwatch=$!
  fi
  reg_add "$cpid" "$cwd" "$name"
  [ -n "$pidfile" ] && printf '%s\n' "$cpid" > "$pidfile"

  if [ "$mode" != bg ]; then
    printf '\033]0;%s\007' "$name"                 # the terminal title, for a pane with an agent
    [ "$mode" = tmux ] && tmux select-pane -t "${TMUX_PANE:-}" -T "$name" >/dev/null 2>&1
    printf '%s\nstarted %s in %s\n' "$name" "$(date '+%H:%M:%S')" "$rundir"
    [ -n "$out" ] && printf 'events: %s\n' "$out"
    printf '%s\n' "----"
    if [ -n "$out" ]; then "$HERE/view-stream.sh" --follow "$out" --pid "$cpid" --from "$from" & vpid=$!; fi
    [ "$mode" = herdr ] && [ -n "${HERDR_PANE_ID:-}" ] && { herdr_report "$cpid" "$name" & rpid=$!; }
    [ "$mode" = tmux ] && tmux set-option -w -t "${TMUX_PANE:-}" @postmaster_state running >/dev/null 2>&1
  fi

  while :; do
    wait "$cpid"; rc=$?
    kill -0 "$cpid" 2>/dev/null || break            # a trapped signal interrupts wait, not the launch
  done
  [ -z "$capwatch" ] || wait "$capwatch" 2>/dev/null || :
  if [ "$cap_mode" = systemd ]; then
    cap_event=$(cat "$event_file" 2>/dev/null)
    if [ -z "$cap_event" ]; then
      # systemctl's Result can lag an OOM kill, reading success or nothing for a
      # while after the scope is dead; poll briefly while the scope is not yet
      # settled so a fast OOM is still named. success with the scope still
      # active is transient, not a verdict; a settled scope breaks at once,
      # so a launch that never tripped pays for one query only.
      local tries=0 result="" active="" verdict=""
      while [ "$tries" -lt 40 ]; do
        # By name, not by line: --value prints properties in its own order no
        # matter the --property order, so positional parsing would silently swap.
        verdict=$("$systemctl" --user show "$unit" --property=Result --property=ActiveState 2>/dev/null)
        result=$(printf '%s\n' "$verdict" | sed -n 's/^Result=//p'); active=$(printf '%s\n' "$verdict" | sed -n 's/^ActiveState=//p')
        if [ "$result" = oom-kill ]; then cap_event=memory; break; fi
        case $active in inactive|failed) break ;; esac
        tries=$((tries + 1)); sleep 0.05
      done
    fi
    case $cap_event in
      process) launch_notice "process cap reached (TasksMax=$tasks)" ;;
      memory) launch_notice "memory cap reached (MemoryMax=$memory)" ;;
    esac
    "$systemctl" --user reset-failed "$unit" >/dev/null 2>&1 || :
  fi
  [ -n "$marker" ] && touch "$marker"
  trap - HUP INT TERM
  reg_members "$cpid"                              # what the leader left in its group, or nothing
  rm -f -- "$event_file"
  [ "$mode" = bg ] && return 0

  [ -n "$vpid" ] && wait "$vpid" 2>/dev/null
  [ -n "$rpid" ] && wait "$rpid" 2>/dev/null
  [ "$mode" = tmux ] && tmux set-option -w -t "${TMUX_PANE:-}" @postmaster_state done >/dev/null 2>&1
  printf '%s\nexit %s at %s after %ss%s\n' "----" "$rc" "$(date '+%H:%M:%S')" "$(( $(date +%s) - t0 ))" \
    "${marker:+, marker $marker}"
  return 0
}

launch_notice() {  # launch_notice <text>: append a host finding to .err and show it in a pane
  [ -n "${err:-}" ] && printf 'host: %s\n' "$1" >> "$err" 2>/dev/null
  [ "${mode:-bg}" = bg ] || printf 'host: %s\n' "$1" >&2
}

# --- stop and close -----------------------------------------------------------------------
worktree_arg() {  # worktree_arg <dir> <what>: its real path, or die
  [ -n "${1:-}" ] || die "usage: host.sh $2 <worktree>"
  [ -d "$1" ] || die "no such directory: $1"
  (CDPATH= cd -P -- "$1" && pwd -P)
}

stop_cmd() {  # stop <worktree>: every launch still running in it, and all it started, whatever its host
  local path line f n=0 scan roots=() patience most out rc
  path=$(worktree_arg "${1:-}" stop) || exit 1
  case $(pwd -P)/ in "$path"/*) die "not stopping the launches in $path from inside it: that stops this session too" ;; esac
  patience=$(count "${POSTMASTER_HOST_STOP_WAIT:-20}" POSTMASTER_HOST_STOP_WAIT) || exit 1
  most=$(count "${POSTMASTER_HOST_STOP_MAX:-512}" POSTMASTER_HOST_STOP_MAX) || exit 1
  scan=$(reg_scan "$path") || exit 1
  [ -n "$scan" ] || { echo "no launch is running in $path"; return 0; }
  while IFS= read -r line; do
    IFS=$'\t' read -r -a f <<< "$line"
    roots+=("${f[@]:2}"); n=$((n + 1))
  done <<< "$scan"
  out=$(stop_tree "$patience" "$most" "${roots[@]}"); rc=$?
  case $rc in
    0) echo "stopped $n launch(es) in $path: ${out%%$'\t'*} process(es)" ;;
    2) warn "stopped $n launch(es) in $path, but these still run: ${out#*$'\t'}"; return 2 ;;
    3) warn "refused to stop the launches in $path, and left them running: ${out#*$'\t'}"; return 2 ;;
    *) warn "could not stop the launches in $path: $out"; return 1 ;;
  esac
}
# stop_tree <seconds> <most> <root>...: each root is group|<pid>|<start> for a launch whose leader
# lives, or tree|<pid>|<start> for a process its leader left, as reg_scan prints them. Prints
# "<processes>\t<survivors>" and exits 2 if any survive, or "refused\t<why>" and exits 3 when the
# set it would signal holds something it must never touch, having signalled none of it.
stop_tree() {
  python3 - "$@" <<'PY'
import os, signal, subprocess, sys, time

grace, most = float(sys.argv[1]), int(sys.argv[2])
roots = []
for r in sys.argv[3:]:
    kind, _, rest = r.partition("|")
    pid, _, start = rest.partition("|")
    if kind in ("group", "tree") and pid.isdigit() and start:
        roots.append((kind, int(pid), start))

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

def args_of(pid):
    """A process's command line, for recognising what must never be signalled."""
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            return f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
    except OSError:
        if os.path.isdir("/proc/self"):
            return ""
    return subprocess.run(["ps", "-o", "args=", "-p", str(pid)], capture_output=True, text=True,
                          env=dict(os.environ, LC_ALL="C")).stdout.strip()

def protected(pid, name):
    """What a process is when stop must never signal it, else None."""
    words = args_of(pid).split()
    tail = words[1:]
    if pid == 1:
        return "the init process"
    if name == "systemd":
        return "a systemd manager"
    if name == "herdr" and (not tail or "server" in tail or any(w.startswith("--session") for w in tail)):
        return "the Herdr server or a Herdr client"
    if name == "moshi-hook" and "serve" in tail:
        return "the moshi-hook daemon"
    if any("code-server" in w for w in words):
        return "code-server"
    if name.startswith("tmux") and ("server" in name or not tail):
        return "the tmux server"
    if name == "sshd":
        return "sshd"
    return None

def tree(t, spare):
    """Every live member of the verified launches' groups, every live process a verified root
    names, and every live process descended from one of those."""
    live = {p for p, v in t.items() if not v[3]} - spare
    hit = {p for p in live if t[p][1] in groups} | (seeds & live)
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

def belongs(t, p):
    """Whether a process is in a verified launch's group or descends from a verified root."""
    q, seen = p, set()
    while q in t and q not in seen and q not in (0, 1):
        if q in seeds or t[q][1] in groups:
            return True
        seen.add(q)
        q = t[q][0]
    return False

def refuse(why, frozen):
    if frozen:                              # found only after the first freeze: undo it
        sig(frozen, signal.SIGCONT)
        why += "; the %d processes frozen before it was found were resumed" % len(frozen)
    print("refused\t%s" % why)
    sys.exit(3)

def check(t, batch, total, frozen):
    """Refuse the whole stop, before any of the batch is signalled, if it is not only ours."""
    if len(total) > most:
        refuse("%d processes, more than POSTMASTER_HOST_STOP_MAX (%d)" % (len(total), most), frozen)
    for p in sorted(batch):
        what = protected(p, t[p][4])
        if what:
            refuse("%d/%s is %s" % (p, t[p][4], what), frozen)
        if not belongs(t, p):
            refuse("%d/%s is not a process of these launches" % (p, t[p][4]), frozen)

t = table()
spare, p = {0, 1}, os.getpid()
while p in t and p not in spare:            # this process and every process above it
    spare.add(p)
    p = t[p][0]
# A root counts only if its process is still the one the registry recorded: same pid, same start.
ok = [(kind, pid) for kind, pid, start in roots if pid in t and t[pid][2] == start and not t[pid][3]]
groups = {pid for kind, pid in ok if kind == "group"}
seeds = {pid for kind, pid in ok}
frozen = set()
for _ in range(20):
    new = tree(t, spare) - frozen
    if not new:
        break
    check(t, new, frozen | new, frozen)
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

close_cmd() {  # close <worktree>: refuse while a launch runs there; then its tabs, space and windows
  local path live i=0 rc=0 patience
  path=$(worktree_arg "${1:-}" close) || exit 1
  patience=$(count "${POSTMASTER_HOST_CLOSE_WAIT:-15}" POSTMASTER_HOST_CLOSE_WAIT) || exit 1
  while live=$(reg_live "$path") || exit 1; [ -n "$live" ]; do   # one whose marker just landed ends a moment later
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
herdr_close_placements() {  # herdr_close_placements <worktree>: close mapped launch tabs for this checkout
  local target file placement space tab pane panes ownership
  target=$1
  [ -d "$STATE/placements" ] || return 0
  for file in "$STATE"/placements/*.json; do
    [ -f "$file" ] || continue
    placement=$(python3 - "$file" "$target" <<'PY'
import json, os, sys
try:
    item = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    raise SystemExit(0)
if os.path.realpath(item.get("cwd", "")) == os.path.realpath(sys.argv[2]):
    print("\t".join((item.get("workspace", ""), item.get("tab", ""), item.get("pane", ""))))
PY
)
    [ -n "$placement" ] || continue
    IFS=$'\t' read -r space tab pane <<< "$placement"
    [ -n "$space" ] && [ -n "$tab" ] && [ -n "$pane" ] || { warn "invalid launch placement in $file; left it open"; return 2; }
    panes=$(herdr pane list --workspace "$space" 2>/dev/null) || { warn "could not inspect launch tab $tab in space $space; left it open"; return 2; }
    ownership=$(printf '%s' "$panes" | python3 -c '
import json, os, re, sys
try:
    panes = json.load(sys.stdin)["result"]["panes"]
except (ValueError, KeyError, TypeError):
    raise SystemExit(2)
herdr_tab = re.compile(r"w[A-Za-z0-9]+:t[0-9A-Za-z]+")
def placed(v):
    return isinstance(v, str) and herdr_tab.fullmatch(v) is not None
pane = next((p for p in panes if p.get("pane_id") == sys.argv[1]), None)
if pane is None:
    print("missing")
elif (pane.get("tokens") or {}).get("postmaster") != "launch":
    print("unowned")
elif not placed(pane.get("tab_id")):
    print("idless")
elif any(not placed(p.get("tab_id")) for p in panes):
    print("mixed")
elif all((p.get("tokens") or {}).get("postmaster") == "launch"
         for p in panes if p.get("tab_id") == sys.argv[2]):
    print("owned")
else:
    print("split")' "$pane" "$tab") || { warn "could not verify ownership of launch tab $tab; left it open"; return 2; }
    case $ownership in
      missing) rm -f -- "$file"; continue ;;
      owned) ;;
      # A tab closes only when every pane in it carries the launch token, as a
      # space does: a split tab keeps the user's pane. A tab the list cannot
      # fully place refuses too: a row counts as placed only when its tab_id
      # is a string of the shape Herdr sends (w…:t…), and anything else is
      # unattributable. Where the recorded pane itself carries no attributable
      # tab, only that pane closes, never the tab, whose sharers are unknown.
      split) warn "launch tab $tab in space $space holds panes host.sh did not open; left it open"; return 2 ;;
      mixed) warn "launch tab $tab in space $space holds panes host.sh cannot place; left it open"; return 2 ;;
      idless)
        herdr pane close "$pane" >/dev/null 2>&1 || { warn "herdr could not close launch pane $pane; left it open"; return 2; }
        rm -f -- "$file"
        echo "host=herdr: closed launch pane $pane"
        continue ;;
      *) warn "launch tab $tab in space $space is no longer owned by host.sh; left it open"; return 2 ;;
    esac
    herdr tab close "$tab" >/dev/null 2>&1 || { warn "herdr could not close launch tab $tab; left it open"; return 2; }
    rm -f -- "$file"
    echo "host=herdr: closed launch tab $tab"
  done
}
herdr_forget_space() {  # herdr_forget_space <workspace>: discard placements after closing their space
  local file workspace
  [ -d "$STATE/placements" ] || return 0
  for file in "$STATE"/placements/*.json; do
    [ -f "$file" ] || continue
    workspace=$(python3 - "$file" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("workspace", ""))
except (OSError, ValueError):
    pass
PY
)
    [ "$workspace" = "$1" ] && rm -f -- "$file"
  done
}
close_herdr() {
  local list space kind info actual_path verdict
  herdr_close_placements "$1" || return $?
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
  info=$(herdr workspace get "$space" 2>/dev/null) || { warn "could not inspect space $space; left it open"; return 2; }
  actual_path=$(printf '%s' "$info" | json 'd["result"]["workspace"].get("worktree",{}).get("checkout_path") or d["result"]["workspace"].get("worktree",{}).get("path")')
  [ -n "$actual_path" ] && [ "$(CDPATH= cd -P -- "$actual_path" 2>/dev/null && pwd -P)" = "$1" ] || return 0
  verdict=$(python3 -c '
import json, sys
ws = json.loads(sys.argv[1])["result"]["workspace"]
if (ws.get("tokens") or {}).get("postmaster") != "opened":
    print("space %s was not opened by host.sh" % ws["workspace_id"]); sys.exit(0)
for p in json.loads(sys.argv[2])["result"]["panes"]:
    if (p.get("tokens") or {}).get("postmaster") != "launch":
        print("pane %s in space %s was not opened by host.sh" % (p["pane_id"], ws["workspace_id"])); sys.exit(0)
print("ok")' "$info" "$(herdr pane list --workspace "$space" 2>/dev/null)" 2>/dev/null)
  [ "$verdict" = ok ] || { warn "${verdict:-could not read space $space}; left open"; return 2; }
  herdr workspace close "$space" >/dev/null || die "herdr could not close space $space"
  herdr_forget_space "$space"
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
  # A fixture registry, and a guard that refuses any other, so no test ever reads, prunes or
  # stops from the live one.
  STATE=$tmp/state; export POSTMASTER_HOST_STATE=$STATE POSTMASTER_HOST_FIXTURE=$tmp
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
printf 'from=%s|name=%s|pane=%s|tmuxpane=%s|var=%s|events=%s|sid=%s|pid=%s|pgid=%s|tty=%s\n' "$PWD" "${POSTMASTER_LAUNCH_NAME:-}" \
  "${HERDR_PANE_ID:-unset}" "${TMUX_PANE:-unset}" "${CALLER_VAR:-unset}" "${POSTMASTER_EVENT_STREAM:-unset}" "$(python3 -c 'import os; print(os.getsid(0))')" "$$" \
  "$(python3 -c 'import os; print(os.getpgid(0))')" "$tty"
echo x >> "${COUNT:-/dev/null}"
sleep "${EMIT_SLEEP:-0}"
EOF
  chmod +x "$tmp/caller/fixed.sh" "$tmp/caller/probe.sh"
  # A waybill whose title is written to break any shell it is typed into.
  cat > "$tmp/run-1/brief.md" <<EOF
# Waybill: 1
turnpikes: style, bug, security

## Ticket
name: not this one

## Dispatch
name: #1, Stop \`touch $tmp/canary\` \$(touch $tmp/canary) "breaking" a shell
dispatch: $tmp/run-1
synthesis worktree: $repo/.worktrees/T-1-luna
EOF
  mkdir -p "$tmp/run-1/logs"
  printf '{"leg":2}\n' > "$tmp/run-1/manifest.json"
  printf '{"attempt":"test"}\n' > "$tmp/run-1/logs/review-r2.json"
  cat > "$tmp/run-1/run.json" <<'EOF'
{"config":{"lanes":{"luna":{"harness":"codex","model":"gpt-6-luna"},"mimo":{"harness":"mimo","model":"xiaomi-token-plan-sgp/mimo-v2.6-pro"},"opus":{"harness":"claude","model":"claude-opus-5-5"},"bare":{"harness":"codex"}},"team":{"workhorses":["luna"],"coachman":{"harness":"muse","model":"muse-spark-1.3-contributor"},"coachman_legs":{"review":{"harness":"claude","model":"claude-opus-5-5"}}}}}
EOF
  # A waybill as resolve never writes one: turnpikes.sh refuses a top line of `default`.
  mkdir -p "$tmp/run-2/logs"
  sed -e 's/^turnpikes: .*/turnpikes: default/' -e "s|^dispatch: .*|dispatch: $tmp/run-2|" "$tmp/run-1/brief.md" > "$tmp/run-2/brief.md"
  cp "$tmp/run-1/manifest.json" "$tmp/run-1/run.json" "$tmp/run-2/"
  printf '{"attempt":"test"}\n' > "$tmp/run-2/logs/review-r2.json"
  # A dispatch whose manifest records no leg, and one with no manifest at all.
  mkdir -p "$tmp/run-3" "$tmp/run-4"
  sed -e "s|^dispatch: .*|dispatch: $tmp/run-3|" "$tmp/run-1/brief.md" > "$tmp/run-3/brief.md"
  cp "$tmp/run-1/run.json" "$tmp/run-3/"
  printf '{"leg":0}\n' > "$tmp/run-3/manifest.json"
  sed -e "s|^dispatch: .*|dispatch: $tmp/run-4|" "$tmp/run-1/brief.md" > "$tmp/run-4/brief.md"
  cp "$tmp/run-1/run.json" "$tmp/run-4/"
  # A store with a wrong-typed lane, workhorse list and coachman models.
  mkdir -p "$tmp/run-5"
  sed -e "s|^dispatch: .*|dispatch: $tmp/run-5|" "$tmp/run-1/brief.md" > "$tmp/run-5/brief.md"
  printf '{"leg":2}\n' > "$tmp/run-5/manifest.json"
  cat > "$tmp/run-5/run.json" <<'EOF'
{"config":{"lanes":{"weird":"x"},"team":{"workhorses":7,"coachman":{"harness":"muse"},"coachman_legs":{"review":{"harness":"claude"}}}}}
EOF
  # A run file that is valid JSON but no mapping at all.
  mkdir -p "$tmp/run-6"
  sed -e "s|^dispatch: .*|dispatch: $tmp/run-6|" "$tmp/run-1/brief.md" > "$tmp/run-6/brief.md"
  printf '{"leg":2}\n' > "$tmp/run-6/manifest.json"
  printf '[]\n' > "$tmp/run-6/run.json"
  # Manifest legs that are not integers, and one that is not JSON.
  for r in 7 8 9; do
    mkdir -p "$tmp/run-$r"
    sed -e "s|^dispatch: .*|dispatch: $tmp/run-$r|" "$tmp/run-1/brief.md" > "$tmp/run-$r/brief.md"
    cp "$tmp/run-1/run.json" "$tmp/run-$r/"
  done
  printf '{"leg": true}\n' > "$tmp/run-7/manifest.json"
  printf '{"leg": 2.5}\n' > "$tmp/run-8/manifest.json"
  printf '{"leg": 2,\n' > "$tmp/run-9/manifest.json"
  RUN_NAME=$("$SELF" name "$tmp/run-1")
  NAME=$("$SELF" name "$tmp/run-1" workhorse luna)
  COACHMAN_LABEL=$("$SELF" name "$tmp/run-1" coachman review 2)
  STYLE_LABEL=$("$SELF" name "$tmp/run-1" review mimo style 2)
  BUG_LABEL=$("$SELF" name "$tmp/run-1" review mimo bug 2)
  SECURITY_LABEL=$("$SELF" name "$tmp/run-1" review opus security 2)
  POSTMASTER_LABEL=$("$SELF" name "$tmp/run-1" postmaster)
  LEGACY_COACHMAN_LABEL=$("$SELF" name "$tmp/run-1" coachman)
  LEGACY_WORKHORSE_LABEL=$("$SELF" name "$tmp/run-1" luna)
  LEGACY_REVIEW_LABEL=$("$SELF" name "$tmp/run-1" "mimo bug review")
  ROLE_LABEL=$("$SELF" name "$tmp/run-1" role "preview server")
}
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1" "${3:-}"; fi; }   # check <label> <test> [<detail>]
marker() {  # marker <file> [<seconds>]: wait for a marker to land
  local i=0; while [ ! -e "$1" ] && [ $i -lt $(( ${2:-30} * 5 )) ]; do sleep 0.2; i=$((i + 1)); done; [ -e "$1" ]
}
field() { tr '|' '\n' < "$1" | sed -n "s/^$2=//p" | head -1; }   # field <probe output> <key>
title_absent() { [[ "$1" != *"#1"* && "$1" != *"Stop"* && "$1" != *"touch"* && "$1" != *"canary"* && "$1" != *"breaking"* && "$1" != *"shell"* ]]; }
err_stream_equal() { cmp -s "$1" <(sed -e '/^host: launch running uncapped (no supported per-launch limits available)$/d' "$2"); }
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
  echo "launch labels and run identity"
  check "the run level carries the ticket number and title" \
    '[[ "$RUN_NAME" == "#1, Stop"* && "$RUN_NAME" == *"breaking"* ]]' "$RUN_NAME"
  check "a coachman label leads with its role, then model and leg" \
    '[ "$COACHMAN_LABEL" = "coachman · claude-opus-5-5 · leg 2" ] && title_absent "$COACHMAN_LABEL"' "$COACHMAN_LABEL"
  check "a workhorse label leads with its lane and role, then model" \
    '[ "$NAME" = "luna · workhorse · gpt-6-luna" ] && title_absent "$NAME"' "$NAME"
  check "the style reviewer label includes its model and round" \
    '[ "$STYLE_LABEL" = "mimo · style review · mimo-v2.6-pro · r2" ] && title_absent "$STYLE_LABEL"' "$STYLE_LABEL"
  check "the bug reviewer label includes its model and round" \
    '[ "$BUG_LABEL" = "mimo · bug review · mimo-v2.6-pro · r2" ] && title_absent "$BUG_LABEL"' "$BUG_LABEL"
  check "a provider-prefixed model id shows its basename, so the round survives the ellipsis" \
    'case "$BUG_LABEL" in *xiaomi*|*/*) false ;; *) true ;; esac' "$BUG_LABEL"
  check "the security reviewer label includes its model and round" \
    '[ "$SECURITY_LABEL" = "opus · security review · claude-opus-5-5 · r2" ] && title_absent "$SECURITY_LABEL"' "$SECURITY_LABEL"
  check "the project-level postmaster label leads with its role and has no ticket" \
    '[ "$POSTMASTER_LABEL" = postmaster ] && title_absent "$POSTMASTER_LABEL"' "$POSTMASTER_LABEL"
  check "any other launch is named by its role alone" \
    '[ "$ROLE_LABEL" = "preview server" ] && title_absent "$ROLE_LABEL"' "$ROLE_LABEL"
  check "the old coachman name form resolves the same per-leg model as the typed form" \
    '[ "$LEGACY_COACHMAN_LABEL" = "$COACHMAN_LABEL" ] && title_absent "$LEGACY_COACHMAN_LABEL"' "$LEGACY_COACHMAN_LABEL"
  check "the old workhorse name form still adds its role and model" \
    '[ "$LEGACY_WORKHORSE_LABEL" = "luna · workhorse · gpt-6-luna" ] && title_absent "$LEGACY_WORKHORSE_LABEL"' "$LEGACY_WORKHORSE_LABEL"
  check "the old review name form still adds its model and current round" \
    '[ "$LEGACY_REVIEW_LABEL" = "mimo · bug review · mimo-v2.6-pro · r2" ] && title_absent "$LEGACY_REVIEW_LABEL"' "$LEGACY_REVIEW_LABEL"
  check "an unrecorded lane is refused, never labelled bare or empty" \
    '! "$SELF" name "$tmp/run-1" workhorse nobody >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" workhorse nobody 2>/dev/null)" ]'
  check "a lane with no recorded model is refused, not labelled without it" \
    '! "$SELF" name "$tmp/run-1" workhorse bare >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" workhorse bare 2>/dev/null)" ] && ! "$SELF" name "$tmp/run-1" review bare bug 2 >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" review bare bug 2 2>/dev/null)" ]'
  check "a review round that never ran is refused, never labelled" \
    '! "$SELF" name "$tmp/run-1" review mimo bug 999 >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" review mimo bug 999 2>/dev/null)" ]'
  check "round 0 is refused: rounds are 1-based" \
    '! "$SELF" name "$tmp/run-1" review mimo bug 0 >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" review mimo bug 0 2>/dev/null)" ]'
  check "a non-ASCII round is refused with a clean error, not a traceback" \
    '[ "$("$SELF" name "$tmp/run-1" review mimo bug "²" 2>&1 >/dev/null)" = "host: review round must be a whole number" ] && [ -z "$("$SELF" name "$tmp/run-1" review mimo bug "²" 2>/dev/null)" ]'
  check "a non-ASCII leg number is refused the same way" \
    '[ "$("$SELF" name "$tmp/run-1" coachman review "²" 2>&1 >/dev/null)" = "host: coachman leg number must be a whole number" ] && [ -z "$("$SELF" name "$tmp/run-1" coachman review "²" 2>/dev/null)" ]'
  check "the two-argument coachman form is refused, never labelled without its leg" \
    '! "$SELF" name "$tmp/run-1" coachman review >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" coachman review 2>/dev/null)" ]'
  check "the old coachman form is refused when the waybill's turnpikes do not resolve" \
    '! "$SELF" name "$tmp/run-2" coachman >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-2" coachman 2>/dev/null)" ]'
  check "and when the manifest records no leg, or there is no manifest" \
    '! "$SELF" name "$tmp/run-3" coachman >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-3" coachman 2>/dev/null)" ] && ! "$SELF" name "$tmp/run-4" coachman >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-4" coachman 2>/dev/null)" ]'
  check "a round past the integer conversion limit is refused cleanly" \
    'LONG=$(python3 -c '\''print("9"*5000)'\''); [ "$("$SELF" name "$tmp/run-1" review mimo bug "$LONG" 2>&1 >/dev/null)" = "host: review round must be a whole number" ] && [ -z "$("$SELF" name "$tmp/run-1" review mimo bug "$LONG" 2>/dev/null)" ]'
  check "a leg past it is refused the same way" \
    'LONG=$(python3 -c '\''print("9"*5000)'\''); [ "$("$SELF" name "$tmp/run-1" coachman review "$LONG" 2>&1 >/dev/null)" = "host: coachman leg number must be a whole number" ] && [ -z "$("$SELF" name "$tmp/run-1" coachman review "$LONG" 2>/dev/null)" ]'
  check "an empty or unknown leg name is refused, never silently generic" \
    '! "$SELF" name "$tmp/run-1" coachman "" 2 >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" coachman "" 2 2>/dev/null)" ] && ! "$SELF" name "$tmp/run-1" coachman nonsense 2 >/dev/null 2>&1 && [ -z "$("$SELF" name "$tmp/run-1" coachman nonsense 2 2>/dev/null)" ]'
  check "while a known leg without an override still takes the generic coachman model" \
    '[ "$("$SELF" name "$tmp/run-1" coachman synthesis 1)" = "coachman · muse-spark-1.3-contributor · leg 1" ]'
  check "an empty leg number is refused, never labelled without its leg" \
    '[ "$("$SELF" name "$tmp/run-1" coachman review "" 2>&1 >/dev/null)" = "host: coachman leg number must be a whole number" ] && [ -z "$("$SELF" name "$tmp/run-1" coachman review "" 2>/dev/null)" ]'
  check "leg 0 is refused like round 0" \
    '[ "$("$SELF" name "$tmp/run-1" coachman synthesis 0 2>&1 >/dev/null)" = "host: coachman leg number must be 1 or more" ] && [ -z "$("$SELF" name "$tmp/run-1" coachman synthesis 0 2>/dev/null)" ]'
  check "a coachman with no recorded model is refused, override, generic or legacy" \
    '[ "$("$SELF" name "$tmp/run-5" coachman synthesis 1 2>&1 >/dev/null)" = "host: no recorded model for coachman leg synthesis" ] && [ "$("$SELF" name "$tmp/run-5" coachman review 2 2>&1 >/dev/null)" = "host: no recorded model for coachman leg review" ] && [ "$("$SELF" name "$tmp/run-5" coachman 2>&1 >/dev/null)" = "host: no recorded model for coachman leg review" ]'
  check "a manifest leg that is not an integer is refused, never coerced" \
    '[ "$("$SELF" name "$tmp/run-7" coachman 2>&1 >/dev/null)" = "host: cannot resolve the coachman leg from manifest.json" ] && [ "$("$SELF" name "$tmp/run-8" coachman 2>&1 >/dev/null)" = "host: cannot resolve the coachman leg from manifest.json" ]'
  check "a manifest that is not JSON is refused" \
    '[ "$("$SELF" name "$tmp/run-9" coachman 2>&1 >/dev/null)" = "host: cannot resolve the coachman leg from manifest.json" ]'
  check "a malformed store is refused cleanly, never a traceback" \
    '[ "$("$SELF" name "$tmp/run-5" workhorse weird 2>&1 >/dev/null)" = "host: no recorded model for workhorse lane weird" ] && [ "$("$SELF" name "$tmp/run-5" weird 2>&1 >/dev/null)" = "host: invalid launch identity; use coachman, workhorse, review, postmaster or role" ] && [ "$("$SELF" name "$tmp/run-6" workhorse luna 2>&1 >/dev/null)" = "host: no recorded model for workhorse lane luna" ]'
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
st = json.load(open(path)) if os.path.exists(path) else {"n": 0, "spaces": {}, "panes": {}, "tabs": {}, "open": {}, "agents": [], "tab_n": {}}
def save(): json.dump(st, open(path, "w"))
def new(prefix): st["n"] += 1; return "%s%d" % (prefix, st["n"])
# Live Herdr numbers tabs 1-9,A-Z (observed to tF); past Z this assumes plain base-36.
def b36(n):
    s = ""
    while n: n, r = divmod(n, 36); s = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[r] + s
    return s
def newtab(ws): st.setdefault("tab_n", {}); st["tab_n"][ws] = st["tab_n"].get(ws, 0) + 1; return "%s:t%s" % (ws, b36(st["tab_n"][ws]))
def opt(name): return a[a.index(name) + 1] if name in a else None
def tokens(): return dict(a[i + 1].split("=", 1) for i in range(len(a) - 1) if a[i] == "--token")
def out(obj): print(json.dumps({"id": "stub", "result": obj}))
def error(code): print(json.dumps({"error": {"code": code, "message": code}}), file=sys.stderr); sys.exit(1)
def flag(name): return os.path.exists(os.path.join(S, name))
def git(*args): return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()
def main_of(d):
    c = git("-C", d, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.realpath(os.path.dirname(c)) if c else None
def space(label, cwd=None):
    ws = new("w"); tab, pane = newtab(ws), new("p")
    st["spaces"][ws] = {"label": label, "tokens": {}, "panes": [pane], "tabs": [tab], "path": os.path.realpath(cwd) if cwd else None}
    st["panes"][pane] = {"ws": ws, "tab": tab, "cwd": cwd, "tokens": {}}
    st["tabs"][tab] = {"ws": ws, "pane": pane, "cwd": cwd, "label": label}
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
    r = space(opt("--label"), opt("--cwd")); cwd = os.path.realpath(opt("--cwd"))
    if main_of(cwd) == cwd: st["open"][cwd] = r["workspace"]["workspace_id"]
    save(); out(r)
elif cmd == "worktree open":
    r = space(opt("--label"), opt("--path")); st["open"][os.path.realpath(opt("--path"))] = r["workspace"]["workspace_id"]
    save(); out(r)
elif cmd == "tab create":
    if flag("tabcreate.empty"): out({"tab": {"tab_id": None}, "root_pane": {"pane_id": None}}); sys.exit(0)
    ws = opt("--workspace"); tab, pane = newtab(ws), new("p"); cwd = opt("--cwd"); label = opt("--label")
    st["spaces"][ws]["panes"].append(pane); st["spaces"][ws]["tabs"].append(tab)
    st["panes"][pane] = {"ws": ws, "tab": tab, "cwd": cwd, "tokens": {}}
    st["tabs"][tab] = {"ws": ws, "pane": pane, "cwd": cwd, "label": label}
    save(); out({"tab": {"tab_id": tab}, "root_pane": {"pane_id": pane}})
elif cmd == "tab rename":
    if flag("tabrename.fail-once"): os.remove(os.path.join(S, "tabrename.fail-once")); sys.exit(1)
    st["tabs"][a[2]]["label"] = a[3]; save()
elif cmd == "workspace report-metadata":
    if flag("wsmeta.fail-once"): os.remove(os.path.join(S, "wsmeta.fail-once")); sys.exit(1)
    st["spaces"][a[2]]["tokens"] = tokens(); save()
elif cmd == "pane report-metadata":
    npath = os.path.join(S, "panemeta.n")
    n = int(open(npath).read()) if os.path.exists(npath) else 0
    open(npath, "w").write(str(n + 1))
    if flag("panemeta.fail-once"): os.remove(os.path.join(S, "panemeta.fail-once")); sys.exit(1)
    failn = os.path.join(S, "panemeta.fail-nth")
    if os.path.exists(failn) and n + 1 == int(open(failn).read().strip() or "0"):
        os.remove(failn); sys.exit(1)
    st["panes"][a[2]]["tokens"] = tokens(); save()
elif cmd == "workspace get":
    w = st["spaces"][a[2]]; out({"workspace": {"workspace_id": a[2], "label": w["label"], "tokens": w["tokens"], "worktree": {"path": w.get("path"), "checkout_path": w.get("path")}}})
elif cmd == "pane list":
    out({"panes": [{"pane_id": p, "tab_id": None if flag("panes.notabids") else st["panes"][p].get("tab"), "tokens": st["panes"][p]["tokens"]} for p in st["spaces"][opt("--workspace")]["panes"]]})
elif cmd == "tab list":
    ws = opt("--workspace"); out({"tabs": [{"tab_id": t, "label": st["tabs"][t]["label"], "cwd": st["tabs"][t]["cwd"]} for t in st["spaces"][ws]["tabs"]]})
elif cmd == "tab close":
    if flag("tabclose.fail"): sys.exit(1)
    tab = a[2]; t = st["tabs"].pop(tab, None)
    if t:
        ws, pane = t["ws"], t["pane"]
        st["spaces"][ws]["tabs"].remove(tab); st["spaces"][ws]["panes"].remove(pane); st["panes"].pop(pane, None)
        if not st["spaces"][ws]["tabs"]:
            # Closing a sole tab destroys a childless space on live Herdr, plain or
            # nested (probed 2026-09-29). A space with a worktree nested under it
            # refuses the close instead (probed 2026-09-28); no control closes a
            # tab there, so the stub does not model it.
            w = st["spaces"].pop(ws, None)
            if w:
                for pane in w["panes"]: st["panes"].pop(pane, None)
                for cwd, opened in list(st["open"].items()):
                    if opened == ws: st["open"].pop(cwd, None)
        save()
elif cmd == "pane close":
    pane = a[2]; p = st["panes"].pop(pane, None)
    if p:
        ws = p["ws"]
        st["spaces"][ws]["panes"].remove(pane)
        # Closing a sole pane destroys its tab, and a last tab its space, on
        # live Herdr (probed 2026-09-29), like closing a sole tab.
        for tab in [t for t in st["spaces"][ws]["tabs"]
                    if not any((q.get("tab") or t) == t for q in st["panes"].values() if q.get("ws") == ws)]:
            st["spaces"][ws]["tabs"].remove(tab); st["tabs"].pop(tab, None)
        if not st["spaces"][ws]["tabs"]:
            w = st["spaces"].pop(ws, None)
            if w:
                for q in w["panes"]: st["panes"].pop(q, None)
                for cwd, opened in list(st["open"].items()):
                    if opened == ws: st["open"].pop(cwd, None)
        save()
elif cmd == "workspace close":
    ws = a[2]; w = st["spaces"].pop(ws, None)
    if w:
        for tab in w["tabs"]: st["tabs"].pop(tab, None)
        for pane in w["panes"]: st["panes"].pop(pane, None)
        for cwd, opened in list(st["open"].items()):
            if opened == ws: st["open"].pop(cwd, None)
        save()
elif cmd == "pane get": out({"pane": {"pane_id": a[2], "agent": None}})
elif cmd == "pane run":
    pane, text, ws = a[2], a[3], st["panes"][a[2]]["ws"]
    # A tab keeps the working directory it was created with: running a pane never
    # retargets it, so the stub must not either. The tab a launch runs in is the
    # one the create and open calls above named, which is what the controls read.
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
  mkdir -p "$tmp/capsys"
  for p in "$tmp/sys"/*; do [ -e "$p" ] && ln -s "$p" "$tmp/capsys/$(basename "$p")"; done
  for t in systemd-run systemctl setsid uname; do
    p=$(command -v "$t" 2>/dev/null) && [ ! -e "$tmp/capsys/$t" ] && ln -s "$p" "$tmp/capsys/$t"
  done
  CAPSYS=$tmp/capsys
  hs() {  # hs <PATH> [VAR=value ...] -- <host.sh arguments>: host.sh in a clean environment
    local p=$1 vars=(); shift
    while [ "$1" != -- ]; do vars+=("$1"); shift; done; shift
    env -i HOME="$HOME" PATH="$p" STUB="$tmp/stub" TMPDIR="$tmp" POSTMASTER_CONFIG="$tmp/live-limits.toml" POSTMASTER_HOST_STATE="$tmp/state" \
      POSTMASTER_HOST_FIXTURE="$tmp" POSTMASTER_HOST_CLAIM_WAIT=3 POSTMASTER_HOST_CLOSE_WAIT=1 \
      ${vars[@]+"${vars[@]}"} "$SELF" "$@"
  }
  cat > "$tmp/live-limits.toml" <<'EOF'
[limits]
memory_max = "8G"
tasks_max = 512
EOF
  mkdir -p "$tmp/cap-dispatch"
  cat > "$tmp/cap-dispatch/run.json" <<'EOF'
{"config":{"limits":{"memory_max":"8G","tasks_max":512,"lane":{"memory_max":"64M","tasks_max":16},"coachman":{"memory_max":"128M","tasks_max":32},"reviewer":{"tasks_max":24}}}}
EOF
  cap_launch() {  # cap_launch <host-impl> <PATH> <prefix> -- <command...>
    local impl=$1 path=$2 prefix=$3; shift 3
    local role_args=()
    [ "$impl" != "$SELF" ] || role_args=(--role lane --run "$tmp/cap-dispatch")
    [ "$1" = -- ] && shift
    env -i HOME="$HOME" PATH="$path" STUB="$tmp/stub" TMPDIR="$tmp" POSTMASTER_HOST=none \
      POSTMASTER_HOST_STATE="$tmp/state" POSTMASTER_HOST_FIXTURE="$tmp" POSTMASTER_HOST_CLAIM_WAIT=3 \
      POSTMASTER_HOST_CLOSE_WAIT=1 POSTMASTER_CONFIG="$tmp/live-limits.toml" \
      XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
      CHILD_PIDS="$tmp/logs/$prefix.pids" LAUNCH_GROUP_RECORD="$tmp/logs/$prefix.group" \
      BRUSH_FILE="$tmp/brush-data.bin" POSTMASTER_CGROUP_ROOT="${CAPCGROOT:-}" \
      "$impl" run "$NAME" "$repo/.worktrees/T-1-luna" \
      --out "$tmp/logs/$prefix.out" --err "$tmp/logs/$prefix.err" --marker "$tmp/logs/$prefix.done" \
      --pidfile "$tmp/logs/$prefix.pid" "${role_args[@]}" -- "$@"
  }
  cat > "$tmp/caller/healthy.sh" <<'EOF'
#!/usr/bin/env bash
printf 'healthy stdout\n'
printf 'healthy stderr\n' >&2
if [ -n "${LAUNCH_GROUP_RECORD:-}" ]; then
  printf '%s %s\n' "$$" "$(ps -o pgid= -p "$$" | tr -d ' ')" > "$LAUNCH_GROUP_RECORD"
fi
sleep 1.5
# The completion line: a launch killed mid-sleep matches a direct run's early
# streams, so the isolation checks compare whole streams including this one.
printf 'healthy done\n'
EOF
  cat > "$tmp/caller/fork-cap.py" <<'EOF'
#!/usr/bin/env python3
import os, signal, sys, time
kids = []
def cleanup(*_):
    for pid in kids:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
    sys.exit(124)
signal.signal(signal.SIGTERM, cleanup)
path = os.environ["CHILD_PIDS"]
while len(kids) < 64:
    try: pid = os.fork()
    except BlockingIOError:
        time.sleep(0.01); continue
    if pid == 0: os.execl("/bin/sleep", "sleep", "30")
    kids.append(pid)
    with open(path, "a", encoding="ascii") as f: f.write(str(pid) + "\n")
while True: time.sleep(1)
EOF
  cat > "$tmp/caller/fork-exit.py" <<'EOF'
#!/usr/bin/env python3
import os, signal, sys, time
kids = []
while len(kids) < 64:
    try: pid = os.fork()
    except BlockingIOError: break
    if pid == 0: os.execl("/bin/sleep", "sleep", "30")
    kids.append(pid)
# The lane gives up after the trip: pause past any watcher wake, then clean up
# its children and exit promptly, naming the cap it reached on the way out.
time.sleep(1)
for pid in kids:
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
sys.exit(2)
EOF
  cat > "$tmp/caller/memory-cap.py" <<'EOF'
#!/usr/bin/env python3
import time
blocks = []
while True:
    block = bytearray(1 << 20)
    for offset in range(0, len(block), 4096): block[offset] = 1
    blocks.append(block)
    time.sleep(0.02)
EOF
  cat > "$tmp/caller/brush-cache.py" <<'EOF'
#!/usr/bin/env python3
import mmap, os, sys
f = open(os.environ["BRUSH_FILE"], "rb")
m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
s = 0
for off in range(0, len(m), 4096):
    s += m[off]
print("brushed %d pages, checksum %d" % (len(m) // 4096, s % 256))
# Pressure proof: our own cgroup must have throttled on the way past the cap,
# or this control ran without the pressure it claims to survive.
cg = open("/proc/self/cgroup").read().split(":")[-1].strip()
mx = 0
for line in open("/sys/fs/cgroup" + cg + "/memory.events"):
    k, _, v = line.partition(" ")
    if k == "max": mx = int(v)
if not mx:
    print("brush ran without memory pressure", file=sys.stderr); sys.exit(99)
EOF
  cat > "$tmp/caller/brush-steady.py" <<'EOF'
#!/usr/bin/env python3
import os, sys, time
# Brushes the memory cap with reclaimable cache for the seconds given: one pass
# past the cap, then a fresh stretch of the file every 50 ms that the cgroup must
# reclaim room for, so its memory.events keeps changing and nothing trips.
fd = os.open(os.environ["BRUSH_FILE"], os.O_RDONLY)
os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
size, chunk, off = os.fstat(fd).st_size, 1 << 20, 0
def read(n):
    global off
    for _ in range(n):
        if off >= size: off = 0
        os.pread(fd, chunk, off); off += chunk
read(96)
end = time.monotonic() + float(sys.argv[1])
while time.monotonic() < end:
    read(4); time.sleep(0.05)
EOF
  cat > "$tmp/caller/watcher-cpu.py" <<'EOF'
#!/usr/bin/env python3
# Finds a capped launch's cap watcher by ancestry from the launch's published
# pid, waits until the launch's cgroup has met its memory cap, then reads the
# watcher's CPU time and the cgroup's memory.events max count across a window.
# Prints "<cpu seconds> <max events in the window>", or "none" with no watcher.
import os, sys, time
pidfile, window = sys.argv[1], float(sys.argv[2])
def stat(p): return open("/proc/%s/stat" % p).read().rsplit(")", 1)[1].split()
def cpu(p): s = stat(p); return (int(s[11]) + int(s[12])) / os.sysconf("SC_CLK_TCK")
deadline = time.monotonic() + 10
cpid = ""
while not cpid and time.monotonic() < deadline:
    try: cpid = open(pidfile).read().strip()
    except OSError: time.sleep(0.05)
launcher = stat(cpid)[1]
events = "/sys/fs/cgroup" + open("/proc/%s/cgroup" % cpid).read().split(":")[-1].strip() + "/memory.events"
def maxcount():
    for line in open(events):
        k, _, v = line.partition(" ")
        if k == "max": return int(v)
    return 0
watcher = None
while watcher is None and time.monotonic() < deadline:
    for p in filter(str.isdigit, os.listdir("/proc")):
        try:
            argv = open("/proc/%s/cmdline" % p, "rb").read().split(b"\0")[:-1]
            if argv[1:2] != [b"-"] or argv[-1] != cpid.encode(): continue
            q = p
            for _ in range(3):
                q = stat(q)[1]
                if q == launcher: watcher = p; break
        except (OSError, IndexError):
            continue
        if watcher: break
    else:
        time.sleep(0.05)
if watcher is None:
    print("none"); sys.exit(1)
while maxcount() == 0 and time.monotonic() < deadline: time.sleep(0.05)
c0, m0 = cpu(watcher), maxcount()
time.sleep(window)
c1, m1 = cpu(watcher), maxcount()
print("%.2f %d" % (c1 - c0, m1 - m0))
EOF
  chmod +x "$tmp/caller/healthy.sh" "$tmp/caller/fork-cap.py" "$tmp/caller/fork-exit.py" "$tmp/caller/memory-cap.py" "$tmp/caller/brush-cache.py" \
    "$tmp/caller/brush-steady.py" "$tmp/caller/watcher-cpu.py"
  head -c 134217728 /dev/zero > "$tmp/brush-data.bin"
  reset() { rm -f -- "$tmp"/stub/*; }
  calls() { cat "$tmp/stub/$1.calls" 2>/dev/null; }
  T=$'\t'
  local got got2 rc a b c space pane live panepid o1 o2 close_result close_rc

  echo "detect"
  check "a Herdr server that answers is the host" '[ "$(hs "$STUBS" -- detect)" = herdr ]'
  touch "$tmp/stub/herdr.down"
  check "with no Herdr server answering, tmux is" '[ "$(hs "$STUBS" -- detect)" = tmux ]'
  reset
  check "with neither on PATH, none" '[ "$(hs "$SYS" -- detect)" = none ]'
  check "POSTMASTER_HOST=none wins over a live Herdr" '[ "$(hs "$STUBS" POSTMASTER_HOST=none -- detect)" = none ]'
  check "POSTMASTER_HOST=tmux wins over a live Herdr" '[ "$(hs "$STUBS" POSTMASTER_HOST=tmux -- detect)" = tmux ]'

  echo "name: from the waybill, so no title is typed into a shell"
  check "a role-first launch name comes from the recorded lane model" \
    '[ "$NAME" = "luna · workhorse · gpt-6-luna" ] && title_absent "$NAME"' "$NAME"
  check "a waybill without one falls back to the run's directory" '[ "$(hs "$SYS" -- name "$tmp/logs")" = logs ]'
  check "and a role name with no waybill is still only its parts" '[ "$(hs "$SYS" -- name "$tmp/logs" role "verify x")" = "verify x" ]'
  printf '## Dispatch\nname: #2, a bell\a and an escape\033]0;x\007 · y\n' > "$tmp/logs/brief.md"
  check "control characters never reach a label" '[ "$(hs "$SYS" -- name "$tmp/logs")" = "#2, a bell and an escape]0;x · y" ]'
  rm -f "$tmp/logs/brief.md"

  echo "run, no host: the same headless command, backgrounded"
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  got=$(cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --out ../logs/n1.out --err ../logs/n1.err \
        --marker ../logs/n1.done -- ./fixed.sh)
  check "it says it ran in the background" '[ "$got" = host=none ]' "$got"
  marker "$tmp/logs/n1.done"
  check "the command's output matches a direct run, and uncapped execution is disclosed" \
    'cmp -s "$tmp/direct.out" "$tmp/logs/n1.out" && err_stream_equal "$tmp/direct.err" "$tmp/logs/n1.err" && grep -qFx "host: launch running uncapped (no supported per-launch limits available)" "$tmp/logs/n1.err"'
  check "and the title's shell syntax never ran" '[ ! -e "$tmp/canary" ]'
  touch "$tmp/logs/n2.done"
  (cd "$tmp/caller" && hs "$SYS" EMIT_SLEEP=2 -- run "$NAME" "$repo" --marker ../logs/n2.done -- ./fixed.sh >/dev/null)
  check "an earlier launch's marker is gone once run returns" '[ ! -e "$tmp/logs/n2.done" ]'
  check "and it lands again when this one exits, whatever its exit" 'marker "$tmp/logs/n2.done" 20'
  (cd "$tmp/caller" && hs "$SYS" CALLER_VAR=v POSTMASTER_EVENT_STREAM=caller-events HERDR_PANE_ID=caller-pane TMUX_PANE=%9 -- run "$NAME" "$repo/.worktrees/T-1-luna" \
     --out ../logs/n3.out --marker ../logs/n3.done --pidfile ../logs/n3.pid -- ./probe.sh >/dev/null)
  marker "$tmp/logs/n3.done"
  check "it runs from the caller's directory, with the caller's environment and its name" \
    '[ "$(field "$tmp/logs/n3.out" from)" = "$tmp/caller" ] && [ "$(field "$tmp/logs/n3.out" var)" = v ] && [ "$(field "$tmp/logs/n3.out" name)" = "$NAME" ]' "$(cat "$tmp/logs/n3.out")"
  check "the exact --out path reaches the launch as POSTMASTER_EVENT_STREAM" \
    '[ "$(field "$tmp/logs/n3.out" events)" = "$tmp/caller/../logs/n3.out" ]' "$(cat "$tmp/logs/n3.out")"
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
    '[ "$(head -1 "$tmp/logs/n4.out")" = before ] && [ "$(wc -l < "$tmp/logs/n4.out")" -eq 4 ] && err_stream_equal "$tmp/direct.err" "$tmp/logs/n4.err" && grep -qFx "host: launch running uncapped (no supported per-launch limits available)" "$tmp/logs/n4.err"'
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

  echo "stop: a record counts only while its own leader lives, in this boot, and nothing unvouched is signalled"
  running() { local st; st=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$st" ] && [ "${st#[TZ]}" = "$st" ]; }
  reg() { python3 -c "$REGISTRY" "$@"; }
  setmtime() { python3 -c 'import os, sys; t = int(sys.argv[2]); os.utime(sys.argv[1], (t, t))' "$1" "$2"; }
  sol=$repo/.worktrees/T-1-sol; L=$tmp/state/launches; boot=$(reg boot); mkdir -p "$L"
  stop_sol() { hs "$SYS" POSTMASTER_HOST_STOP_WAIT=1 "$@" -- stop "$sol" 2>&1; }
  python3 -c 'import os; os.setsid(); os.execvp("sleep", ["sleep", "60"])' >/dev/null 2>&1 & u=$!   # a group leader no launch started
  a=0; while [ -z "$(reg start "$u")" ] && [ $a -lt 20 ]; do sleep 0.1; a=$((a + 1)); done
  printf '%s\n%s\nstart 1\nboot %s\n' "$sol" "not this" "$boot" > "$L/$u"
  got=$(stop_sol); rc=$?
  check "a record whose leader has another start time is removed, and stop signals nothing" \
    '[ $rc -eq 0 ] && [ "$got" = "no launch is running in $sol" ] && running "$u" && [ ! -e "$L/$u" ]' "$got"
  printf '%s\n%s\nstart %s\nboot another-boot\n' "$sol" "not this" "$(reg start "$u")" > "$L/$u"
  got=$(stop_sol); rc=$?
  check "a record from another boot is removed, and stop signals nothing" \
    '[ $rc -eq 0 ] && running "$u" && [ ! -e "$L/$u" ]' "$got"
  printf '%s\n%s\n' "$sol" "not this" > "$L/$u"; setmtime "$L/$u" $(( $(reg booted) - 60 ))
  got=$(stop_sol); rc=$?
  check "a record from before this change, written before this boot, is removed" \
    '[ $rc -eq 0 ] && running "$u" && [ ! -e "$L/$u" ]' "$got"
  printf '%s\n%s\n' "$sol" "not this" > "$L/$u"; setmtime "$L/$u" $(( $(reg started "$u") - 30 ))
  got=$(stop_sol); rc=$?
  check "a record from before this change, naming a pid that started after it was written, is removed" \
    '[ $rc -eq 0 ] && running "$u" && [ ! -e "$L/$u" ]' "$got"
  printf '%s\n%s\n' "$sol" "legacy" > "$L/$u"
  hs "$SYS" -- close "$sol" >/dev/null 2>&1; rc=$?
  check "a record from before this change, written by a leader already running, is kept and rewritten" \
    '[ $rc -eq 2 ] && grep -qx "start $(reg start "$u")" "$L/$u" && grep -qx "boot $boot" "$L/$u"' "$(cat "$L/$u" 2>/dev/null)"
  kill "$u" 2>/dev/null; rm -f "$L/$u"

  cat > "$tmp/caller/leaves.sh" <<'EOF'
#!/usr/bin/env bash
sleep 60 & echo $! > "$TREE/left.pid"
EOF
  chmod +x "$tmp/caller/leaves.sh"
  (cd "$tmp/caller" && hs "$SYS" TREE="$tmp/tree" -- run "$NAME" "$sol" --marker ../logs/k2.done -- ./leaves.sh >/dev/null)
  marker "$tmp/logs/k2.done" 10
  a=0; while ! grep -qs '^member ' "$L"/* && [ $a -lt 30 ]; do sleep 0.1; a=$((a + 1)); done
  lp=$(cat "$tmp/tree/left.pid" 2>/dev/null)
  check "a leader that exits leaving a process behind: its record names that process" \
    '[ -n "$lp" ] && grep -qsx "member $lp $(reg start "$lp")" "$L"/*' "$(cat "$L"/* 2>/dev/null)"
  got=$(stop_sol); rc=$?
  check "and stop ends that process" '[ $rc -eq 0 ] && ! alive "$lp"' "$got"

  ln -s "$(command -v python3)" "$tmp/sys/moshi-hook"; ln -s "$(command -v python3)" "$tmp/sys/systemd"
  cat > "$tmp/caller/guarded.sh" <<'EOF'
#!/usr/bin/env bash
# A launch with a process that looks like one stop must never touch.
"$LOOKS_LIKE" -c 'import time; time.sleep(60)' $ARGS & echo $! > "$TREE/guarded.pid"
sleep 60 & wait
EOF
  chmod +x "$tmp/caller/guarded.sh"
  local spec look args why
  for spec in "moshi-hook serve|the moshi-hook daemon" "systemd --user|a systemd manager"; do
    look=${spec%% *}; args=${spec#* }; args=${args%%|*}; why=${spec#*|}
    rm -f "$tmp/tree/guarded.pid" "$tmp/logs/k3.done"
    (cd "$tmp/caller" && hs "$SYS" TREE="$tmp/tree" LOOKS_LIKE="$look" ARGS="$args" -- \
       run "$NAME" "$sol" --marker ../logs/k3.done --pidfile ../logs/k3.pid -- ./guarded.sh >/dev/null)
    a=0; while [ ! -s "$tmp/tree/guarded.pid" ] && [ $a -lt 50 ]; do sleep 0.1; a=$((a + 1)); done; sleep 0.3
    got=$(stop_sol); rc=$?
    check "stop refuses a tree holding $why, and leaves it all running" \
      '[ $rc -eq 2 ] && case $got in *"$why"*) true ;; *) false ;; esac && running "$(cat "$tmp/tree/guarded.pid")" && running "$(cat "$tmp/logs/k3.pid")" && [ ! -e "$tmp/logs/k3.done" ]' "$got"
    kill -- "-$(cat "$tmp/logs/k3.pid")" 2>/dev/null; marker "$tmp/logs/k3.done" 10
  done

  cat > "$tmp/caller/wide.sh" <<'EOF'
#!/usr/bin/env bash
for i in 1 2 3 4; do sleep 60 & done
wait
EOF
  chmod +x "$tmp/caller/wide.sh"
  (cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$sol" --marker ../logs/k4.done --pidfile ../logs/k4.pid -- ./wide.sh >/dev/null)
  sleep 0.5
  got=$(stop_sol POSTMASTER_HOST_STOP_MAX=3); rc=$?
  check "stop refuses a tree larger than POSTMASTER_HOST_STOP_MAX, and leaves it running" \
    '[ $rc -eq 2 ] && case $got in *"more than POSTMASTER_HOST_STOP_MAX (3)"*) true ;; *) false ;; esac && running "$(cat "$tmp/logs/k4.pid")" && [ ! -e "$tmp/logs/k4.done" ]' "$got"
  got=$(stop_sol); rc=$?
  check "within the bound, the same tree is stopped" '[ $rc -eq 0 ] && marker "$tmp/logs/k4.done" 10' "$got"

  got=$(hs "$SYS" POSTMASTER_HOST_STATE="$tmp.elsewhere" -- stop "$sol" 2>&1); rc=$?
  check "while a self-test runs, a registry outside its fixture is refused" \
    '[ $rc -eq 1 ] && case $got in *"refusing the registry"*) true ;; *) false ;; esac && [ ! -e "$tmp.elsewhere" ]' "$got"

  echo "run, Herdr (stub): a pane in the worktree's space, nested under the repository's"
  echo "run, Herdr (stub): launches under the ticket-labeled run space"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" CALLER_VAR=v HERDR_PANE_ID=caller-pane -- run "$NAME" "$repo/.worktrees/T-1-luna" \
        --under "$tmp/run-1" \
        --out ../logs/h1.out --err ../logs/h1.err --marker ../logs/h1.done -- ./probe.sh)
  check "it says where it ran" 'case $got in "host=herdr space=w"*" pane=p"*) true ;; *) false ;; esac' "$got"
  space=${got#*space=}; space=${space%% *}; pane=${got##*pane=}
  check "a repository with no space gets one first, labelled with its name" \
    'calls herdr | grep -qxF "workspace${T}create${T}--cwd${T}$repo${T}--label${T}$rname${T}--no-focus"'
  check "the run worktree opens as a space under it, labelled with the ticket" \
    'calls herdr | grep -qxF "worktree${T}open${T}--workspace${T}w1${T}--path${T}$repo/.worktrees/T-1-luna${T}--label${T}$RUN_NAME${T}--no-focus"'
  check "host.sh marks the space it opened as its own" 'python3 -c "import json,sys; sys.exit(json.load(open(\"$tmp/stub/herdr.json\"))[\"spaces\"][\"$space\"][\"tokens\"] != {\"postmaster\": \"opened\"})"'
  check "the run space carries the ticket while its first tab carries only the launch label" \
    'python3 -c "import json,sys; s=json.load(open(sys.argv[1])); w=s[\"spaces\"][sys.argv[2]]; t=s[\"tabs\"][w[\"tabs\"][0]]; sys.exit(not (w[\"label\"] == sys.argv[3] and t[\"label\"] == sys.argv[4] and t[\"cwd\"] == sys.argv[5]))" "$tmp/stub/herdr.json" "$space" "$RUN_NAME" "$NAME" "$repo/.worktrees/T-1-luna" && title_absent "$NAME" && [ ! -e "$tmp/canary" ]' "$RUN_NAME / $NAME"
  check "the first launch uses the run space's only tab, with no empty shell beside it" \
    'python3 -c "import json,sys; s=json.load(open(sys.argv[1])); tabs=s[\"spaces\"][sys.argv[2]][\"tabs\"]; sys.exit(0 if len(tabs)==1 and s[\"tabs\"][tabs[0]][\"label\"]==sys.argv[3] else 1)" "$tmp/stub/herdr.json" "$space" "$NAME"'
  check "the first launch's tab is created with its own checkout, not the root tab" \
    'calls herdr | grep -qxF "tab${T}create${T}--workspace${T}$space${T}--cwd${T}$repo/.worktrees/T-1-luna${T}--label${T}$NAME${T}--no-focus"'
  check "and the run space's root tab is closed once that tab exists" \
    '[ "$(calls herdr | grep -c "^tab${T}close")" -eq 1 ]'
  marker "$tmp/logs/h1.done"
  check "the launch ran in that pane, with that pane's identity" '[ "$(field "$tmp/logs/h1.out" pane)" = "$pane" ]' "$(cat "$tmp/logs/h1.out")"
  check "and with its caller's environment, handed over by host.sh" '[ "$(field "$tmp/logs/h1.out" var)" = v ] && [ "$(field "$tmp/logs/h1.out" from)" = "$tmp/caller" ]'
  sleep 1
  check "the pane shows the name and the rendered stream, not raw JSON" \
    'grep -qF "$NAME" "$tmp/stub/pane-$pane.out" && grep -qE "^[0-9:]{8} session probe-1 · m$" "$tmp/stub/pane-$pane.out" && ! grep -q "{" "$tmp/stub/pane-$pane.out"' "$(cat "$tmp/stub/pane-$pane.out" 2>/dev/null)"
  check "and reports the launch working, then releases it" \
    'calls herdr | grep -q "^pane${T}report-agent${T}$pane${T}.*--state${T}working" && calls herdr | grep -q "^pane${T}release-agent${T}$pane${T}"'
  got2=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/h2.done -- ./fixed.sh)
  check "a second launch is a tab in the same run space" \
    '[ "$(calls herdr | grep -c "^worktree${T}open")" -eq 1 ] && calls herdr | grep -q "^tab${T}create${T}--workspace${T}$space${T}"' "$got2"
  marker "$tmp/logs/h2.done"
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  (cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --out ../logs/h3.out --err ../logs/h3.err --marker ../logs/h3.done -- ./fixed.sh >/dev/null)
  marker "$tmp/logs/h3.done"
  check "the command streams and marker are what a background run writes, with any cap notice" 'cmp -s "$tmp/direct.out" "$tmp/logs/h3.out" && err_stream_equal "$tmp/direct.err" "$tmp/logs/h3.err"'
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
  check "a space host.sh opened, its launches done, is closed" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  hs "$STUBS" -- close "$repo" >/dev/null 2>&1; rc=$?
  check "the repository's own checkout is refused" '[ $rc -eq 2 ]'
python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-rev-luna" <<'PY'
import json, os, sys
st = json.load(open(sys.argv[1])); st["n"] += 1; ws, p = "w%d" % st["n"], "p%d" % st["n"]
# A space the user opened, holding nothing now but a tab host.sh added, its launch done.
st["spaces"][ws] = {"label": "the user's", "tokens": {}, "panes": [p], "tabs": [], "path": os.path.realpath(sys.argv[2])}
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

  echo "a security-review clone, Herdr (stub): a launch tab under its run"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$SECURITY_LABEL" "$clone" --under "$tmp/run-1" --marker ../logs/c1.done -- ./fixed.sh)
  space=${got#*space=}; space=${space%% *}
  tab=${got#*tab=}; tab=${tab%% *}
  runspace=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["open"].get(sys.argv[2], ""))' "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")
  check "the clone has no workspace of its own; its launch is a tab under the ticket" \
    'python3 -c "import json,sys; s=json.load(open(sys.argv[1])); ws=sys.argv[2]; clone=sys.argv[3]; run=sys.argv[4]; label=sys.argv[5]; tabs=s[\"spaces\"][run][\"tabs\"]; found=[t for t in s[\"tabs\"].values() if t[\"ws\"]==run and t[\"cwd\"]==clone]; sys.exit(not (ws==run and clone not in s[\"open\"] and s[\"spaces\"][run][\"label\"]==sys.argv[6] and len(tabs)==1 and len(found)==1 and found[0][\"label\"]==label))" "$tmp/stub/herdr.json" "$space" "$clone" "$runspace" "$SECURITY_LABEL" "$RUN_NAME"' "$(calls herdr)"
  check "the clone's tab is created with the clone as its directory, not the root tab" \
    'calls herdr | grep -qxF "tab${T}create${T}--workspace${T}$runspace${T}--cwd${T}$clone${T}--label${T}$SECURITY_LABEL${T}--no-focus"' "$(calls herdr)"
  check "and the run space's root tab is closed once that tab exists" \
    '[ "$(calls herdr | grep -c "^tab${T}close")" -eq 1 ]' "$(calls herdr)"
  check "the run workspace is the only workspace host.sh creates for the clone launch" \
    '[ "$(calls herdr | grep -c "^workspace${T}create")" -eq 1 ] && calls herdr | grep -qxF "worktree${T}open${T}--workspace${T}w1${T}--path${T}$repo/.worktrees/T-1-luna${T}--label${T}$RUN_NAME${T}--no-focus"' "$(calls herdr)"
  check "the clone run tab has the security lane label, not the ticket name" \
    'title_absent "$SECURITY_LABEL" && calls herdr | grep -qxF "tab${T}rename${T}$tab${T}$SECURITY_LABEL"' "$(calls herdr)"
  marker "$tmp/logs/c1.done"
  got2=$(cd "$tmp/caller" && hs "$STUBS" -- run "$SECURITY_LABEL" "$clone" --under "$tmp/run-1" --marker ../logs/c2.done -- ./fixed.sh)
  check "a second launch there is a new tab in the same space" \
    '[ "$(calls herdr | grep -c "^worktree${T}open")" -eq 1 ] && calls herdr | grep -q "^tab${T}create${T}--workspace${T}$runspace${T}"' "$got2"
  marker "$tmp/logs/c2.done"
  closes_before=$(calls herdr | grep -c "^tab${T}close")
  close_result=$(hs "$STUBS" -- close "$clone" 2>&1); close_rc=$?
  check "closing a scratch clone succeeds after its launches finish" '[ $close_rc -eq 0 ]' "$close_result"
  check "closing it removes both owned tabs" \
    '[ "$(calls herdr | grep -c "^tab${T}close")" -eq $((closes_before + 2)) ] && ! python3 -c "import json,sys; s=json.load(open(sys.argv[1])); sys.exit(not any(t[\"cwd\"]==sys.argv[2] for t in s[\"tabs\"].values()))" "$tmp/stub/herdr.json" "$clone"' \
    "$(calls herdr) / $(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print([(t,x.get("cwd")) for t,x in s["tabs"].items()])' "$tmp/stub/herdr.json")"
  check "closing a scratch clone issues no workspace close for the run space" \
    '! calls herdr | grep -qx "workspace${T}close${T}$runspace"' \
    "$(calls herdr)"
  check "and the run space is gone with its last tab" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  check "closing the synthesis worktree after its space is gone succeeds quietly" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  git clone -q "$repo" "$tmp/plain" >/dev/null 2>&1
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$tmp/plain" --marker ../logs/c3.done -- ./fixed.sh)
  space=${got#*space=}; space=${space%% *}
  marker "$tmp/logs/c3.done"
  hs "$STUBS" -- close "$tmp/plain" >/dev/null 2>&1; rc=$?
  check "a plain clone is no scratch: it opens as a repository, and close refuses its space" \
    'calls herdr | grep -qxF "workspace${T}create${T}--cwd${T}$tmp/plain${T}--label${T}plain${T}--no-focus" && [ $rc -eq 2 ] && ! calls herdr | grep -qx "workspace${T}close${T}$space"' "$(calls herdr)"

  echo "a split launch tab, Herdr (stub)"
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/g1.done -- ./fixed.sh)
  marker "$tmp/logs/g1.done"
  python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[2]]
t1 = st["spaces"][ws]["tabs"][0]
# The user splits the launch tab: a second, untagged pane in it.
st["panes"]["pU"] = {"ws": ws, "tab": t1, "cwd": "/home/user", "tokens": {}}
st["spaces"][ws]["panes"].append("pU")
json.dump(st, open(sys.argv[1], "w"))
PY
  got2=$(hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" 2>&1); rc=$?
  check "a tab the user has split is refused, and the tab stays open" \
    '[ $rc -eq 2 ] && printf "%s" "$got2" | grep -q "holds panes" && python3 -c "import json,sys; s=json.load(open(sys.argv[1])); ws=s[\"open\"][sys.argv[2]]; sys.exit(not s[\"spaces\"][ws][\"tabs\"])" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna"' "$got2"
  check "and the user's pane survives it" \
    'python3 -c "import json,sys; sys.exit(\"pU\" not in json.load(open(sys.argv[1]))[\"panes\"])" "$tmp/stub/herdr.json"'
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/g2.done -- ./fixed.sh)
  marker "$tmp/logs/g2.done"
  python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[2]]
t1 = st["spaces"][ws]["tabs"][0]
# A second pane of the run's own in the launch tab: tagged like the first.
st["panes"]["pR"] = {"ws": ws, "tab": t1, "cwd": sys.argv[2], "tokens": {"postmaster": "launch"}}
st["spaces"][ws]["panes"].append("pR")
json.dump(st, open(sys.argv[1], "w"))
PY
  check "a tab holding only the run's panes still closes" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/g3.done -- ./fixed.sh)
  marker "$tmp/logs/g3.done"
  python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[2]]
t1 = st["spaces"][ws]["tabs"][0]
# A sibling row the list cannot place: no tab on its record.
st["panes"]["pU"] = {"ws": ws, "cwd": "/home/user", "tokens": {}}
st["spaces"][ws]["panes"].append("pU")
json.dump(st, open(sys.argv[1], "w"))
PY
  got2=$(hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" 2>&1); rc=$?
  check "a tab the list cannot fully place is refused, and the tab stays open" \
    '[ $rc -eq 2 ] && printf "%s" "$got2" | grep -q "cannot place" && python3 -c "import json,sys; s=json.load(open(sys.argv[1])); ws=s[\"open\"][sys.argv[2]]; sys.exit(not s[\"spaces\"][ws][\"tabs\"])" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna"' "$got2"
  check "and the unplaced pane survives it" \
    'python3 -c "import json,sys; sys.exit(\"pU\" not in json.load(open(sys.argv[1]))[\"panes\"])" "$tmp/stub/herdr.json"'
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/g4.done -- ./fixed.sh)
  marker "$tmp/logs/g4.done"
  python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[2]]
t1 = st["spaces"][ws]["tabs"][0]
st["panes"]["pU"] = {"ws": ws, "tab": t1, "cwd": "/home/user", "tokens": {}}
st["spaces"][ws]["panes"].append("pU")
json.dump(st, open(sys.argv[1], "w"))
PY
  touch "$tmp/stub/panes.notabids"
  got2=$(hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" 2>&1); rc=$?
  rm -f "$tmp/stub/panes.notabids"
  check "a split tab in an id-less response loses only the run's pane" \
    'python3 -c "import json,sys; s=json.load(open(sys.argv[1])); ws=s[\"open\"][sys.argv[2]]; t1=s[\"spaces\"][ws][\"tabs\"][0]; ps=[p for p,x in s[\"panes\"].items() if x.get(\"tab\")==t1]; sys.exit(set(ps)!=set([\"pU\"]))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna"' "$got2"
  check "and the space refusal still stands" '[ $rc -eq 2 ]'
  i=0
  for spec in 'an empty string|""' 'false|false' 'zero|0' 'a list|["t1"]' 'a malformed string|"t1"' 'a trailing newline|"w1:t1\n"'; do
    i=$((i + 1)); spelling=${spec%%|*}; literal=${spec#*|}
    reset
    got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/h1-$i.done -- ./fixed.sh)
    marker "$tmp/logs/h1-$i.done"
    python3 - "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" "$literal" <<'PY'
import json, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[2]]
# A sibling row the list cannot place: its tab is the spelling under test.
st["panes"]["pU"] = {"ws": ws, "tab": json.loads(sys.argv[3]), "cwd": "/home/user", "tokens": {}}
st["spaces"][ws]["panes"].append("pU")
json.dump(st, open(sys.argv[1], "w"))
PY
    got2=$(hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" 2>&1); rc=$?
    check "a tab_id spelled as $spelling refuses the close, leaving tab and pane in place" \
      '[ $rc -eq 2 ] && printf "%s" "$got2" | grep -q "cannot place" && python3 -c "import json,sys; s=json.load(open(sys.argv[1])); ws=s[\"open\"][sys.argv[2]]; sys.exit(not s[\"spaces\"][ws][\"tabs\"])" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna" && python3 -c "import json,sys; sys.exit(\"pU\" not in json.load(open(sys.argv[1]))[\"panes\"])" "$tmp/stub/herdr.json"' "$got2"
  done
  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/h1-ok.done -- ./fixed.sh)
  marker "$tmp/logs/h1-ok.done"
  n0=$(calls herdr | grep -c "^tab${T}close" || true); m0=$(calls herdr | grep -c "^pane${T}close" || true)
  hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null
  check "a well-formed id still closes a tab holding only the run's panes" \
    '[ $(calls herdr | grep -c "^tab${T}close" || true) -eq $((n0 + 1)) ] && [ $(calls herdr | grep -c "^pane${T}close" || true) -eq $m0 ] && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'

  reset
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/b1.done -- ./fixed.sh)
  marker "$tmp/logs/b1.done"
  python3 - "$tmp/stub/herdr.json" "$tmp/state/placements" "$repo/.worktrees/T-1-luna" <<'PY'
import glob, json, os, sys
st = json.load(open(sys.argv[1])); ws = st["open"][sys.argv[3]]
# Retab the launch as the tenth tab: rename its tab id to the base-36 shape
# live Herdr issues, in the stub state and the recorded placement alike.
old = st["spaces"][ws]["tabs"][-1]
new = "%s:tA" % ws
st["spaces"][ws]["tabs"] = [new if t == old else t for t in st["spaces"][ws]["tabs"]]
st["tabs"][new] = st["tabs"].pop(old)
for r in st["panes"].values():
    if r.get("tab") == old: r["tab"] = new
st.setdefault("tab_n", {})[ws] = 10
for f in glob.glob(os.path.join(sys.argv[2], "*.json")):
    d = json.load(open(f))
    if d.get("cwd") == os.path.realpath(sys.argv[3]) and d.get("tab") == old:
        d["tab"] = new; json.dump(d, open(f, "w"))
json.dump(st, open(sys.argv[1], "w"))
PY
  n0=$(calls herdr | grep -c "^tab${T}close" || true); m0=$(calls herdr | grep -c "^pane${T}close" || true)
  hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null
  check "a tA tab holding only the run's panes closes" \
    '[ $(calls herdr | grep -c "^tab${T}close" || true) -eq $((n0 + 1)) ] && [ $(calls herdr | grep -c "^pane${T}close" || true) -eq $m0 ] && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'

  echo "first-launch failure paths, Herdr (stub)"
  reset
  touch "$tmp/stub/tabclose.fail"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --out ../logs/f1.out --err ../logs/f1.err --marker ../logs/f1.done -- ./fixed.sh 2>../logs/f1.hosterr)
  check "a root-tab close that fails still lands the launch, with a warning" \
    'marker "$tmp/logs/f1.done" && grep -q "could not close the run space" "$tmp/logs/f1.hosterr"' "$got"
  rm -f "$tmp/stub/tabclose.fail"
  check "and close still finishes afterwards: the leftover tab is owned" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/tabcreate.empty"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f2.done -- ./fixed.sh)
  rm -f "$tmp/stub/tabcreate.empty"
  check "a tab create that returns no ids rolls the run space back" \
    '[ "$got" = host=none ] && [ "$(calls herdr | grep -c "^tab${T}close")" -eq 1 ] && marker "$tmp/logs/f2.done"' "$got"
  check "and no run space survives the rollback" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/panemeta.fail-once"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f3.done -- ./fixed.sh)
  check "a root-pane tag that fails rolls the run space back instead of landing" \
    '[ "$got" = host=none ] && [ "$(calls herdr | grep -c "^tab${T}close")" -eq 1 ] && marker "$tmp/logs/f3.done"' "$got"
  check "and no run space survives it" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/panemeta.fail-once" "$tmp/stub/tabcreate.empty"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f4.done -- ./fixed.sh)
  rm -f "$tmp/stub/tabcreate.empty"
  check "a failed tag plus a failed create still leaves nothing behind" \
    '[ "$got" = host=none ] && marker "$tmp/logs/f4.done"' "$got"
  check "and no run space survives the double fault" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/wsmeta.fail-once"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f5.done -- ./fixed.sh)
  check "a failed mark write rolls the run space back instead of orphaning it" \
    '[ "$got" = host=none ] && [ "$(calls herdr | grep -c "^tab${T}close")" -eq 1 ] && marker "$tmp/logs/f5.done"' "$got"
  check "and no run space survives it" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/tabclose.fail" "$tmp/stub/tabcreate.empty"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f6.done -- ./fixed.sh 2>../logs/f6.hosterr)
  rm -f "$tmp/stub/tabclose.fail" "$tmp/stub/tabcreate.empty"
  check "a rollback that fails too still warns instead of failing silently" \
    '[ "$got" = host=none ] && marker "$tmp/logs/f6.done" && grep -q "could not roll back the run space" "$tmp/logs/f6.hosterr"' "$got"
  check "and close still shuts the marked space it leaves behind" \
    'hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/tabrename.fail-once"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f7.done -- ./fixed.sh)
  check "a tab rename that fails rolls the launch tab back" \
    '[ "$got" = host=none ] && [ "$(calls herdr | grep -c "^tab${T}close")" -eq 2 ] && marker "$tmp/logs/f7.done"' "$got"
  check "and no run space survives it" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  echo 2 > "$tmp/stub/panemeta.fail-nth"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f8.done -- ./fixed.sh)
  check "a launch-pane tag that fails rolls the launch tab back" \
    '[ "$got" = host=none ] && [ "$(calls herdr | grep -c "^tab${T}close")" -eq 2 ] && marker "$tmp/logs/f8.done"' "$got"
  check "and no run space survives it" \
    '[ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  mkdir -p "$tmp/poison" && : > "$tmp/poison/placements"
  got=$(cd "$tmp/caller" && hs "$STUBS" POSTMASTER_HOST_STATE="$tmp/poison" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f9.done -- ./fixed.sh)
  check "a placement the record refuses falls back with its tab tagged" \
    '[ "$got" = host=none ] && marker "$tmp/logs/f9.done"' "$got"
  check "and close still shuts its space without the record" \
    'hs "$STUBS" POSTMASTER_HOST_STATE="$tmp/poison" -- close "$repo/.worktrees/T-1-luna" >/dev/null && [ -z "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[\"open\"].get(sys.argv[2], \"\"))" "$tmp/stub/herdr.json" "$repo/.worktrees/T-1-luna")" ]'
  reset
  touch "$tmp/stub/tabrename.fail-once" "$tmp/stub/tabclose.fail"
  got=$(cd "$tmp/caller" && hs "$STUBS" -- run "$NAME" "$repo/.worktrees/T-1-luna" --under "$tmp/run-1" --marker ../logs/f10.done -- ./fixed.sh 2>../logs/f10.hosterr)
  rm -f "$tmp/stub/tabclose.fail"
  check "a launch-tab rollback that fails too still warns instead of failing silently" \
    '[ "$got" = host=none ] && marker "$tmp/logs/f10.done" && grep -q "could not roll back launch tab" "$tmp/logs/f10.hosterr"' "$got"
  hs "$STUBS" -- close "$repo/.worktrees/T-1-luna" >/dev/null 2>&1; rc=$?
  check "and close correctly refuses the untagged tab it leaves behind" '[ $rc -eq 2 ]'

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
  hs "$STUBS" POSTMASTER_CONFIG=/elsewhere/config.toml -- spawn postmaster-repo "$repo/.worktrees/T-1-luna" --label "$POSTMASTER_LABEL" -- claude --model m >/dev/null
  check "Herdr: spawn starts the agent in a tab of the repository's own space" \
    'calls herdr | grep -qx "tab${T}rename${T}w1:t1${T}postmaster" && calls herdr | grep -qx "agent${T}start${T}postmaster-repo${T}--kind${T}claude${T}--pane${T}p2${T}--${T}--model${T}m"' "$(calls herdr)"
  check "with the caller's POSTMASTER_ settings in its pane" 'calls herdr | grep "^workspace${T}create" | grep -qF -- "--env${T}POSTMASTER_CONFIG=/elsewhere/config.toml"'
  check "the postmaster takes the project's first tab, leaving no empty shell beside it" \
    'python3 -c "import json,sys; s=json.load(open(sys.argv[1])); w=s[\"open\"][sys.argv[2]]; tabs=s[\"spaces\"][w][\"tabs\"]; sys.exit(0 if len(tabs)==1 and s[\"tabs\"][tabs[0]][\"label\"]==\"postmaster\" else 1)" "$tmp/stub/herdr.json" "$repo"'
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

  echo "uncapped fallback: cap mechanism absent from PATH"
  (cd "$tmp/caller" && ./healthy.sh > "$tmp/direct-healthy.out" 2> "$tmp/direct-healthy.err")
  got=$(cap_launch "$SELF" "$SYS" uncapped -- "$tmp/caller/healthy.sh" 2>/dev/null)
  check "without the cap tools, the launch still completes and .err says uncapped" \
    'marker "$tmp/logs/uncapped.done" 10 && grep -qFx "host: launch running uncapped (no supported per-launch limits available)" "$tmp/logs/uncapped.err" && cmp -s "$tmp/direct-healthy.out" "$tmp/logs/uncapped.out" && err_stream_equal "$tmp/direct-healthy.err" "$tmp/logs/uncapped.err"' "$got"

  if systemd_capability >/dev/null 2>&1; then
    echo "per-launch caps: systemd user scope controls"
    cap_impl=${POSTMASTER_HOST_TEST_IMPL:-$SELF}
    fork_other=$(cap_launch "$cap_impl" "$CAPSYS" fork-other -- "$tmp/caller/healthy.sh" 2>/dev/null)
    check "a capped launch publishes its pid while the command is still running" \
      '[ -s "$tmp/logs/fork-other.pid" ] && [ ! -e "$tmp/logs/fork-other.done" ]' "$fork_other"
    fork_got=$(cap_launch "$cap_impl" "$CAPSYS" fork -- timeout --signal=TERM --kill-after=1 2 python3 "$tmp/caller/fork-cap.py" 2>/dev/null)
    marker "$tmp/logs/fork.done" 10
    marker "$tmp/logs/fork-other.done" 10
    no_live_pids() {
      local pid st
      while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        st=$(ps -o stat= -p "$pid" 2>/dev/null) || st=""
        [ -z "$st" ] || [ "${st#Z}" != "$st" ] || return 1
      done < "$1"
    }
    check "a fork runaway is stopped at TasksMax, leaves its marker and no children" \
      'grep -qFx "host: process cap reached (TasksMax=16)" "$tmp/logs/fork.err" && [ -e "$tmp/logs/fork.done" ] && no_live_pids "$tmp/logs/fork.pids"' "$fork_got"
    check "the bounded fork fixture leaves no live child processes" \
      'no_live_pids "$tmp/logs/fork.pids"' "$(cat "$tmp/logs/fork.pids" 2>/dev/null)"
    check "a healthy launch completes while the fork cap is reached" \
      'marker "$tmp/logs/fork-other.done" 1 && cmp -s "$tmp/direct-healthy.out" "$tmp/logs/fork-other.out" && err_stream_equal "$tmp/direct-healthy.err" "$tmp/logs/fork-other.err" && [ "$(cut -d" " -f2 "$tmp/logs/fork-other.group")" = "$(cat "$tmp/logs/fork-other.pid")" ]' "$fork_other"
    exit_got=$(cap_launch "$cap_impl" "$CAPSYS" fork-exit -- timeout --signal=TERM --kill-after=1 4 python3 "$tmp/caller/fork-exit.py" 2>/dev/null)
    marker "$tmp/logs/fork-exit.done" 10
    check "a launch that exits after tripping the process cap still names the cap" \
      'grep -qFx "host: process cap reached (TasksMax=16)" "$tmp/logs/fork-exit.err" && [ -e "$tmp/logs/fork-exit.done" ]' "$exit_got"

    memory_other=$(cap_launch "$cap_impl" "$CAPSYS" memory-other -- "$tmp/caller/healthy.sh" 2>/dev/null)
    memory_got=$(cap_launch "$cap_impl" "$CAPSYS" memory -- timeout --signal=TERM --kill-after=1 2 python3 "$tmp/caller/memory-cap.py" 2>/dev/null)
    marker "$tmp/logs/memory.done" 10
    marker "$tmp/logs/memory-other.done" 10
    check "an allocation runaway is stopped at MemoryMax and leaves its marker" \
      'grep -qFx "host: memory cap reached (MemoryMax=64M)" "$tmp/logs/memory.err" && [ -e "$tmp/logs/memory.done" ]' "$memory_got"
    check "a healthy launch completes while the memory cap is reached" \
      'marker "$tmp/logs/memory-other.done" 1 && cmp -s "$tmp/direct-healthy.out" "$tmp/logs/memory-other.out" && err_stream_equal "$tmp/direct-healthy.err" "$tmp/logs/memory-other.err" && [ "$(cut -d" " -f2 "$tmp/logs/memory-other.group")" = "$(cat "$tmp/logs/memory-other.pid")" ]' "$memory_other"
    mkdir -p "$tmp/capshim"
    for t in "$CAPSYS"/*; do
      [ -e "$t" ] || continue
      [ "$(basename "$t")" = systemctl ] && continue
      ln -s "$t" "$tmp/capshim/$(basename "$t")"
    done
    shimctl=$(command -v systemctl)
    cat > "$tmp/capshim/systemctl" <<EOF
#!/usr/bin/env bash
# A watcher-blind backend whose first verdict reads success-with-active and
# whose second prints the properties in reverse order: the verdict must poll
# past the transient one and read the OOM by name, not by line.
if [[ "\$*" == *postmaster-host-* && "\$*" == *ControlGroup* ]]; then exit 0; fi
if [[ "\$*" == *postmaster-host-* && "\$*" == *Result* ]]; then
  echo x >> "$tmp/logs/shim-queries.log"
  n=\$(wc -l < "$tmp/logs/shim-queries.log")
  if [ "\$n" -eq 1 ]; then echo "Result=success"; echo "ActiveState=active"; exit 0; fi
  if [ "\$n" -eq 2 ]; then echo "ActiveState=failed"; echo "Result=oom-kill"; exit 0; fi
fi
exec "$shimctl" "\$@"
EOF
    chmod +x "$tmp/capshim/systemctl"
    rm -f "$tmp/logs/shim-queries.log"; touch "$tmp/logs/shim-queries.log"
    shim_got=$(cap_launch "$cap_impl" "$tmp/capshim" shim-oom -- timeout --signal=TERM --kill-after=1 6 python3 "$tmp/caller/memory-cap.py" 2>/dev/null)
    marker "$tmp/logs/shim-oom.done" 15
    check "a transient success verdict does not hide an OOM, and the verdict reads properties by name" \
      'grep -qFx "host: memory cap reached (MemoryMax=64M)" "$tmp/logs/shim-oom.err" && [ "$(wc -l < "$tmp/logs/shim-queries.log")" -eq 2 ]' "$shim_got"
    python3 -c "import os; fd=os.open('$tmp/brush-data.bin',os.O_RDONLY); os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED); os.close(fd)"
    brush_got=$(cap_launch "$cap_impl" "$CAPSYS" brush -- timeout --signal=TERM --kill-after=1 30 python3 "$tmp/caller/brush-cache.py" 2>/dev/null)
    marker "$tmp/logs/brush.done" 20
    check "a launch that brushes the memory cap with reclaimable cache completes unnamed" \
      'grep -q "brushed .* pages" "$tmp/logs/brush.out" && [ -e "$tmp/logs/brush.done" ] && [ ! -s "$tmp/logs/brush.err" ]' "$brush_got"
    spin_got=$(cap_launch "$cap_impl" "$CAPSYS" spin -- timeout --signal=TERM --kill-after=1 30 python3 "$tmp/caller/brush-steady.py" 5 2>/dev/null)
    spin_cpu=$(python3 "$tmp/caller/watcher-cpu.py" "$tmp/logs/spin.pid" 3 2>&1)
    spin_s=${spin_cpu%% *}; spin_n=${spin_cpu##* }
    marker "$tmp/logs/spin.done" 20
    # A spinning watcher burns most of a core; one that sleeps between changes
    # wakes at most a hundred times a second, the kernel's notify rate.
    check "a cap watcher sleeps while its launch's memory.events changes: under a tenth of a core" \
      '[ "$spin_n" -gt 0 ] 2>/dev/null && python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) < 0.3 else 1)" "$spin_s" && [ -e "$tmp/logs/spin.done" ] && [ ! -s "$tmp/logs/spin.err" ]' \
      "cpu s, max events in 3 s: $spin_cpu; $spin_got"
    mkdir -p "$tmp/capshim2"
    for t in "$CAPSYS"/*; do
      [ -e "$t" ] || continue
      [ "$(basename "$t")" = systemctl ] && continue
      ln -s "$t" "$tmp/capshim2/$(basename "$t")"
    done
    shimctl2=$(command -v systemctl)
    cat > "$tmp/capshim2/systemctl" <<EOF
#!/usr/bin/env bash
# A fallback-blind backend: every verdict reads settled success, while the
# watcher resolves the real cgroup. An OOM named here was named by the watcher.
if [[ "\$*" == *postmaster-host-* && "\$*" == *ControlGroup* ]]; then
  echo x >> "$tmp/logs/shim2-cg.log"
fi
if [[ "\$*" == *postmaster-host-* && "\$*" == *Result* ]]; then
  echo x >> "$tmp/logs/shim2-result.log"
  echo "Result=success"; echo "ActiveState=inactive"; exit 0
fi
exec "$shimctl2" "\$@"
EOF
    chmod +x "$tmp/capshim2/systemctl"
    rm -f "$tmp/logs/shim2-cg.log" "$tmp/logs/shim2-result.log"
    touch "$tmp/logs/shim2-cg.log" "$tmp/logs/shim2-result.log"
    wmem_got=$(cap_launch "$cap_impl" "$tmp/capshim2" watcher-mem -- timeout --signal=TERM --kill-after=1 6 python3 "$tmp/caller/memory-cap.py" 2>/dev/null)
    marker "$tmp/logs/watcher-mem.done" 15
    check "with the fallback blinded, an OOM is still named: the watcher notes it" \
      'grep -qFx "host: memory cap reached (MemoryMax=64M)" "$tmp/logs/watcher-mem.err" && [ "$(wc -l < "$tmp/logs/shim2-cg.log")" -ge 1 ] && [ "$(wc -l < "$tmp/logs/shim2-result.log")" -eq 0 ]' "$wmem_got"
    mkdir -p "$tmp/fakecgroup/fixture"
    printf 'max 0\n' > "$tmp/fakecgroup/fixture/pids.events"
    mkdir -p "$tmp/capshim3"
    for t in "$CAPSYS"/*; do
      [ -e "$t" ] || continue
      [ "$(basename "$t")" = systemctl ] && continue
      ln -s "$t" "$tmp/capshim3/$(basename "$t")"
    done
    shimctl3=$(command -v systemctl)
    cat > "$tmp/capshim3/systemctl" <<EOF
#!/usr/bin/env bash
# A fixture-cgroup backend: the watcher resolves this path and reads the
# counter shapes the control stages there, while verdict queries delegate.
if [[ "\$*" == *postmaster-host-* && "\$*" == *ControlGroup* ]]; then echo "/fixture"; exit 0; fi
exec "$shimctl3" "\$@"
EOF
    chmod +x "$tmp/capshim3/systemctl"
    CAPCGROOT=$tmp/fakecgroup
    printf 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 1\noom_group_kill 0\n' > "$tmp/fakecgroup/fixture/memory.events"
    hostshape_got=$(cap_launch "$cap_impl" "$tmp/capshim3" hostshape -- "$tmp/caller/healthy.sh" 2>/dev/null)
    marker "$tmp/logs/hostshape.done" 10
    check "a host-wide OOM shape (oom_kill without oom) is not blamed on MemoryMax" \
      'cmp -s "$tmp/direct-healthy.out" "$tmp/logs/hostshape.out" && cmp -s "$tmp/direct-healthy.err" "$tmp/logs/hostshape.err" && [ -e "$tmp/logs/hostshape.done" ]' "$hostshape_got"
    printf 'low 0\nhigh 0\nmax 18\noom 1\noom_kill 0\noom_group_kill 0\n' > "$tmp/fakecgroup/fixture/memory.events"
    oomshape_got=$(cap_launch "$cap_impl" "$tmp/capshim3" oomshape -- "$tmp/caller/healthy.sh" 2>/dev/null)
    marker "$tmp/logs/oomshape.done" 10
    check "a cgroup OOM shape (oom set) still names the memory cap" \
      'grep -qFx "host: memory cap reached (MemoryMax=64M)" "$tmp/logs/oomshape.err" && [ -e "$tmp/logs/oomshape.done" ]' "$oomshape_got"
    unset CAPCGROOT
    kill_got=$(cap_launch "$cap_impl" "$CAPSYS" kill-healthy -- "$tmp/caller/healthy.sh" 2>/dev/null)
    sleep 0.3; kill -KILL "$(cat "$tmp/logs/kill-healthy.pid")" 2>/dev/null
    marker "$tmp/logs/kill-healthy.done" 10
    check "a launch killed mid-sleep is told apart: its streams no longer match a completed run" \
      '[ -e "$tmp/logs/kill-healthy.done" ] && ! cmp -s "$tmp/direct-healthy.out" "$tmp/logs/kill-healthy.out"' "$kill_got"
    check "a capped launch's .err never carries the uncapped notice" \
      '[ -s "$tmp/logs/fork-other.err" ] && [ -s "$tmp/logs/memory-other.err" ] && ! grep -qF "launch running uncapped" "$tmp/logs/fork-other.err" "$tmp/logs/memory-other.err"'
  else
    echo "per-launch cap controls skipped: no working systemd user scope"
  fi
  printf '[limits]\ntasks_max = 0\n' > "$tmp/badlimits.toml"
  got=$(cd "$tmp/caller" && hs "$SYS" POSTMASTER_CONFIG="$tmp/badlimits.toml" -- run "$NAME" "$repo" \
    --err ../logs/badlim.err --marker ../logs/badlim.done -- ./fixed.sh 2>&1); rc=$?
  check "limits that fail validation refuse the launch, the marker lands and .err says why" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/badlim.done" ] && grep -q "tasks_max must be" "$tmp/logs/badlim.err"' "$got"
  mkdir -p "$tmp/bad-dispatch"
  printf '{"config": [1, 2, 3]}' > "$tmp/bad-dispatch/run.json"
  got=$(cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo" --role lane --run "$tmp/bad-dispatch" \
    --err ../logs/badcfg.err --marker ../logs/badcfg.done -- ./fixed.sh 2>&1); rc=$?
  check "a dispatch whose config is no table refuses the launch cleanly, with no traceback" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/badcfg.done" ] && grep -q "config must be a table" "$tmp/logs/badcfg.err" && ! grep -qi "traceback" "$tmp/logs/badcfg.err"' "$got"
  mkdir -p "$tmp/bad-top"
  printf '[1, 2, 3]' > "$tmp/bad-top/run.json"
  got=$(cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo" --role lane --run "$tmp/bad-top" \
    --err ../logs/badtop.err --marker ../logs/badtop.done -- ./fixed.sh 2>&1); rc=$?
  check "a dispatch whose run.json holds no object refuses the launch cleanly, with no traceback" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/badtop.done" ] && grep -q "run.json must hold an object" "$tmp/logs/badtop.err" && ! grep -qi "traceback" "$tmp/logs/badtop.err"' "$got"
  got=$(cd "$tmp/caller" && hs "$SYS" -- run "$NAME" "$repo" --role bogus \
    --err ../logs/badrole.err --marker ../logs/badrole.done -- ./fixed.sh 2>&1); rc=$?
  check "an unknown launch role refuses the launch, the marker lands and .err says why" \
    '[ $rc -eq 1 ] && [ -e "$tmp/logs/badrole.done" ] && grep -q "unknown launch role" "$tmp/logs/badrole.err"' "$got"
  check "every role resolves from the dispatch run, inheriting each value it does not set" \
    '[ "$(launch_limits lane "$tmp/cap-dispatch" "$tmp/live-limits.toml")" = "$(printf "64M\t16")" ] && [ "$(launch_limits coachman "$tmp/cap-dispatch" "$tmp/live-limits.toml")" = "$(printf "128M\t32")" ] && [ "$(launch_limits reviewer "$tmp/cap-dispatch" "$tmp/live-limits.toml")" = "$(printf "8G\t24")" ] && [ "$(launch_limits default "$tmp/cap-dispatch" "$tmp/live-limits.toml")" = "$(printf "8G\t512")" ] && [ "$(launch_limits lane "" "$tmp/live-limits.toml")" = "$(printf "8G\t512")" ]'

  finish self-test
}

live_test() {
  test_setup                                          # its registry is the fixture's too
  opened=() tsession=""
  trap 'for (( i=${#opened[@]}-1; i>=0; i-- )); do herdr workspace close "${opened[i]}" >/dev/null 2>&1; done
        [ -n "$tsession" ] && tmux kill-session -t "=$tsession" >/dev/null 2>&1
        rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  openspace() { herdr worktree list --cwd "$1" 2>/dev/null | python3 -c 'import json, sys
d = json.load(sys.stdin)
print(([w.get("open_workspace_id") for w in d["result"]["worktrees"] if w["path"] == sys.argv[1]] or [None])[0] or "")' "$1" 2>/dev/null; }
  local got wt rs space pane tab tab8 info seen i screen rev rspace cspace before run_tabs label space8 close_result close_rc
  ( cd "$tmp/caller" && ./fixed.sh > "$tmp/direct.out" 2> "$tmp/direct.err" )
  echo "detected here: $(detect)"

  if herdr_up; then
    echo "Herdr, the positive control"
    got=$(cd "$tmp/caller" && "$SELF" run "$POSTMASTER_LABEL" "$repo" --marker ../logs/p0.done -- ./fixed.sh)
    rs=$(openspace "$repo")
    [ -n "$rs" ] && opened+=("$rs")
    check "the project space's first tab is the role-labeled postmaster, with no empty shell" \
      '[ -n "$rs" ] && [ "$(herdr workspace get "$rs" | json "d[\"result\"][\"workspace\"][\"label\"]")" = "$rname" ] && [ "$(herdr tab list --workspace "$rs" | json "len(d[\"result\"][\"tabs\"])" )" = 1 ] && [ "$(herdr tab list --workspace "$rs" | json "d[\"result\"][\"tabs\"][0][\"label\"]")" = "$POSTMASTER_LABEL" ]' "$got"
    check "the postmaster launch marker lands" 'marker "$tmp/logs/p0.done" 60'
    wt=$repo/.worktrees/T-1-luna
    got=$(cd "$tmp/caller" && EMIT_SLEEP=8 "$SELF" run "$COACHMAN_LABEL" "$wt" --under "$tmp/run-1" --out ../logs/l1.out --err ../logs/l1.err --marker ../logs/l1.done -- ./fixed.sh)
    space=$(printf '%s' "$got" | sed -n 's/.*space=\([^ ]*\).*/\1/p'); pane=${got##*pane=}; tab=$(printf '%s' "$got" | sed -n 's/.*tab=\([^ ]*\).*/\1/p')
    [ -n "$space" ] && opened+=("$space")
    check "the launch runs in Herdr" 'case $got in host=herdr*) true ;; *) false ;; esac' "$got"
    check "in the ticket's synthesis-worktree run space" '[ -n "$space" ] && [ "$(openspace "$wt")" = "$space" ]'
    info=$(herdr workspace get "$space" 2>/dev/null)
    check "that space is a linked worktree of the repository, whose own space is its parent" \
      '[ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"worktree\"][\"is_linked_worktree\"]")" = True ] && [ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"worktree\"][\"repo_root\"]")" = "$repo" ] && [ "$(herdr worktree list --cwd "$wt" | json "d[\"result\"][\"source\"].get(\"source_workspace_id\")")" = "$rs" ]' "$info"
    check "the run space carries the ticket and the first tab only the coachman label" \
      '[ "$(printf "%s" "$info" | json "d[\"result\"][\"workspace\"][\"label\"]")" = "$RUN_NAME" ] && [ "$(herdr tab get "$tab" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$COACHMAN_LABEL" ] && title_absent "$COACHMAN_LABEL" && [ ! -e "$tmp/canary" ]'
    check "the run space has one launch tab and no starter shell tab" \
      '[ "$(herdr tab list --workspace "$space" | json "len(d[\"result\"][\"tabs\"])" )" = 1 ] && [ "$(herdr tab list --workspace "$space" | json "d[\"result\"][\"tabs\"][0][\"label\"]")" = "$COACHMAN_LABEL" ]'
    seen="" i=0
    while [ $i -lt 30 ]; do
      seen=$(herdr pane get "$pane" 2>/dev/null | json '"%s|%s" % (d["result"]["pane"].get("agent_status"), d["result"]["pane"].get("terminal_title_stripped"))')
      [ "$seen" = "working|$COACHMAN_LABEL" ] && break
      sleep 0.25; i=$((i + 1))
    done
    check "while it runs, the pane is working and its terminal title is the coachman label" '[ "$seen" = "working|$COACHMAN_LABEL" ]' "$seen"
    check "its marker lands" 'marker "$tmp/logs/l1.done" 60'
    check "its command streams are what a direct run writes" 'cmp -s "$tmp/direct.out" "$tmp/logs/l1.out" && err_stream_equal "$tmp/direct.err" "$tmp/logs/l1.err"'
    sleep 1; screen=$(herdr pane read "$pane" --source recent-unwrapped --lines 40 2>/dev/null)
    check "the pane shows rendered events, not raw JSON" \
      'printf "%s" "$screen" | grep -q "says: step one" && printf "%s" "$screen" | grep -q "result: success" && ! printf "%s" "$screen" | grep -qF "{\"type\""' "$screen"
    check "and the launch is released when it ends" \
      '[ "$(herdr pane get "$pane" | json "d[\"result\"][\"pane\"].get(\"agent_status\")")" != working ]'
    got=$(cd "$tmp/caller" && "$SELF" run "$NAME" "$repo/.worktrees/T-1-sol" --under "$tmp/run-1" --out ../logs/l8.out --marker ../logs/l8.done -- ./probe.sh)
    marker "$tmp/logs/l8.done" 30
    space8=${got#*space=}; space8=${space8%% *}; pane8=${got##*pane=}
    tab8=${got#*tab=}; tab8=${tab8%% *}
    check "the workhorse tab is under the same run and its harness name is role-first" \
      '[ "$space8" = "$space" ] && [ "$(herdr tab get "$tab8" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$NAME" ] && [ "$(field "$tmp/logs/l8.out" name)" = "$NAME" ]' "$(cat "$tmp/logs/l8.out" 2>/dev/null)"
    (cd "$tmp/caller" && "$SELF" run "$NAME" "$wt" --under "$tmp/run-1" --out ../logs/l6.out --marker ../logs/l6.done -- ./probe.sh >/dev/null)
    check "the launch has no terminal, and a group of its own" \
      'marker "$tmp/logs/l6.done" 30 && [ "$(field "$tmp/logs/l6.out" tty)" = no ] && [ "$(field "$tmp/logs/l6.out" pgid)" = "$(field "$tmp/logs/l6.out" pid)" ]' "$(cat "$tmp/logs/l6.out" 2>/dev/null)"
    got=$(cd "$tmp/caller" && "$SELF" run "$NAME" "$wt" --under "$tmp/run-1" --marker ../logs/l5.done --pidfile ../logs/l5.pid -- sleep 120)
    sleep 2; herdr tab close "$(printf '%s' "$got" | sed -n 's/.*tab=\([^ ]*\).*/\1/p')" >/dev/null 2>&1
    check "closing a launch's pane mid-run stops it, and its marker still lands" \
      'marker "$tmp/logs/l5.done" 10 && ! kill -0 "$(cat "$tmp/logs/l5.pid")" 2>/dev/null' "$got"
    rev=$repo/.worktrees/T-1-rev-luna
    got=$(cd "$tmp/caller" && "$SELF" run "$STYLE_LABEL" "$rev" --under "$tmp/run-1" --marker ../logs/l2.done -- ./fixed.sh)
    tab=${got#*tab=}; tab=${tab%% *}
    check "a style review launches as a tab in the run space" \
      '[ "$(printf "%s" "$got" | sed -n "s/.*space=\([^ ]*\).*/\1/p")" = "$space" ] && [ -z "$(openspace "$rev")" ] && [ "$(herdr tab get "$tab" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$STYLE_LABEL" ] && marker "$tmp/logs/l2.done" 60' "$got"
    got=$(cd "$tmp/caller" && "$SELF" run "$BUG_LABEL" "$rev" --under "$tmp/run-1" --marker ../logs/l9.done -- ./fixed.sh)
    tab=${got#*tab=}; tab=${tab%% *}
    check "a bug review's round label is visible in the same run space" \
      '[ "$(printf "%s" "$got" | sed -n "s/.*space=\([^ ]*\).*/\1/p")" = "$space" ] && [ "$(herdr tab get "$tab" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$BUG_LABEL" ] && marker "$tmp/logs/l9.done" 60' "$got"
    got=$(cd "$tmp/caller" && "$SELF" run "$SECURITY_LABEL" "$clone" --under "$tmp/run-1" --marker ../logs/l7.done -- ./fixed.sh)
    tab=${got#*tab=}; tab=${tab%% *}
    check "the security-review clone opens as a tab under its run, with no top-level space" \
      '[ "$(printf "%s" "$got" | sed -n "s/.*space=\([^ ]*\).*/\1/p")" = "$space" ] && [ -z "$(openspace "$clone")" ] && [ "$(herdr tab get "$tab" | json "d[\"result\"][\"tab\"][\"label\"]")" = "$SECURITY_LABEL" ] && marker "$tmp/logs/l7.done" 60' "$got"
    close_result=$("$SELF" close "$clone" 2>&1); close_rc=$?
    check "closing the clone removes its tab but leaves the run space open" \
      '[ $close_rc -eq 0 ] && [ "$(openspace "$wt")" = "$space" ] && ! herdr tab get "$tab" >/dev/null 2>&1' "$close_result"
    "$SELF" close "$repo" >/dev/null 2>&1; i=$?
    check "close refuses the repository's own space" '[ $i -eq 2 ]'
    check "close shuts the run's space after its worktree is done" '"$SELF" close "$wt" >/dev/null && [ -z "$(openspace "$wt")" ]'
    check "closing a review scratch does not close a different run" '"$SELF" close "$rev" >/dev/null'

    echo "no host, the negative control"
    wt=$repo/.worktrees/T-1-sol
    before=$(herdr workspace list | json 'len(d["result"]["workspaces"])')
    got=$(cd "$tmp/caller" && POSTMASTER_HOST=none "$SELF" run "$NAME" "$wt" --under "$tmp/run-1" --out ../logs/l3.out --err ../logs/l3.err --marker ../logs/l3.done -- ./fixed.sh)
    check "the same launch runs in the background" '[ "$got" = host=none ]' "$got"
    check "no space opens for it" '[ -z "$(openspace "$wt")" ] && [ "$(herdr workspace list | json "len(d[\"result\"][\"workspaces\"])")" = "$before" ]'
    check "its marker lands" 'marker "$tmp/logs/l3.done" 60'
    check "its command streams are the same" 'cmp -s "$tmp/direct.out" "$tmp/logs/l3.out" && err_stream_equal "$tmp/direct.err" "$tmp/logs/l3.err"'
  else
    echo "Herdr: no server answers here; its controls are skipped"
  fi

  if has tmux; then
    echo "tmux"
    wt=$repo/.worktrees/T-1-sol
    got=$(cd "$tmp/caller" && POSTMASTER_HOST=tmux "$SELF" run "$NAME" "$wt" --under "$tmp/run-1" --out ../logs/l4.out --err ../logs/l4.err --marker ../logs/l4.done -- ./fixed.sh)
    tsession=$(printf '%s' "$got" | sed -n 's/.*session=\([^ ]*\).*/\1/p')
    check "the launch runs in a window of session postmaster-<repo>, named for it" \
      '[ "$tsession" = "postmaster-$rname" ] && tmux list-windows -t "=$tsession" -F "#{window_name}" | grep -qxF "$NAME"' "$got"
    check "its marker lands" 'marker "$tmp/logs/l4.done" 60'
    check "its command streams are the same" 'cmp -s "$tmp/direct.out" "$tmp/logs/l4.out" && err_stream_equal "$tmp/direct.err" "$tmp/logs/l4.err"'
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
  *) echo "usage: host.sh detect | name | run [--under <dispatch>] [--role lane|coachman|reviewer] [--run <dispatch>] | stop | close | spawn | send | wait | read | --self-test | --live-test (see the header)" >&2; exit 1 ;;
esac
