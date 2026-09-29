#!/usr/bin/env bash
# One script for a coachman leg's launch, resume and takeover: it clears and lands the leg's
# markers, starts or appends the leg's stream as harnesses.md requires, records how the
# attempt ended, and names the postmaster's next action. The runbooks call this and never
# write a marker, a redirect or a stream path themselves; no decision reads error text.
#
#   leg.sh launch  <dispatch> <leg-number> <leg-name> <repo> [--prompt <file>]
#   leg.sh resume  <dispatch> <leg-number> <leg-name> <repo> <thread-id> [--prompt <file>]
#   leg.sh takeover <dispatch> <leg-number> <leg-name> <repo> [--prompt <file>]
#   leg.sh outcome <dispatch> <leg-number>         the recorded outcome, as JSON
#   leg.sh answer  <dispatch> <leg-number>         what to do when the user answers
#   leg.sh waiting add <runs> <ticket> <question-file>
#   leg.sh waiting remove <runs> <ticket>
#   leg.sh waiting list <runs>
#   leg.sh --self-test
#
# launch, resume and takeover return as host.sh run does: once the attempt has started.
# They wrap host.sh run and launch.sh; this script computes every marker and stream path,
# so a runbook never does. The outcome is recorded under
# <dispatch>/logs/coachman-leg-<n>-outcome.json when the attempt ends, from mechanical
# signals only: launch.sh's refused/started side-channel, the done marker, the thread id
# in the stream, host cap notices, and a known wall indicator list checked here once.
# runs-status.sh reports the next action from that record; postmaster.md does not read .err.
#
# Outcomes: refused | no-thread | walled | spent | finished
# on_answer: deliver-prompt | relaunch | none
#   refused   launch.sh refused before the harness started (config, env file, resume form)
#   no-thread the harness started and the stream holds no thread id
#   walled    a quota, provider or host cap wall — taken over on the fallback, or the user
#             when the leg already runs on the fallback
#   spent     the harness started and the stream holds a thread id, with no hand-off
#   finished  the leg's done marker is present
#
# The waiting list is <runs>/postmaster/ESCALATION.md, written only through `waiting`.
#
#   exit 0  started, recorded, printed, or the list was written
#   exit 1  usage, or the attempt could not be started
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
TOOL=$(CDPATH= cd -P -- "$HERE/.." && pwd -P)

die() { echo "leg: $*" >&2; exit 1; }

# --- paths for one leg ---------------------------------------------------------------------
leg_paths() {  # leg_paths <dispatch> <leg-number>: sets STREAM ERR EXITED DONE OUTCOME
  local d=$1 n=$2
  case $n in ''|*[!0-9]*) die "leg number must be a whole number, not '$n'" ;; esac
  [ "$n" -ge 1 ] || die "leg number must be 1 or more"
  STREAM=$d/logs/coachman-leg-$n-events.jsonl
  ERR=$d/logs/coachman-leg-$n.err
  EXITED=$d/.leg-$n-exited
  DONE=$d/.leg-$n-done
  OUTCOME=$d/logs/coachman-leg-$n-outcome.json
  WALLED_STREAM=$d/logs/coachman-leg-$n-walled-events.jsonl
}

worktree_of() {  # worktree_of <dispatch> <repo>
  local d=$1 repo=$2 ticket
  ticket=$(basename "$d")
  printf '%s/.worktrees/%s\n' "$repo" "$ticket"
}

leg_name_of() {  # leg_name_of <dispatch> <leg-number>: the recorded name, default coachman
  python3 - "$1" "$2" <<'PY'
import json, os, sys
d, n = sys.argv[1], sys.argv[2]
name = "coachman"
try:
    m = json.load(open(os.path.join(d, "manifest.json")))
    legs = m.get("coachman", {}).get("legs", {})
    entry = legs.get(str(n)) or legs.get(n) or {}
    name = entry.get("name") or name
except (OSError, AttributeError, ValueError, TypeError, json.JSONDecodeError):
    pass
print(name)
PY
}

thread_id_of() {  # thread_id_of <stream> <harness>: the first thread id the stream carries
  python3 - "$1" "$2" <<'PY'
import json, sys
path, harness = sys.argv[1], sys.argv[2]
def find_id(value):
    if isinstance(value, dict):
        if harness == "muse":
            stream = value.get("stream")
            if isinstance(stream, dict) and stream.get("kind") == "session" and isinstance(stream.get("id"), str):
                return stream["id"]
        if harness == "pi" and value.get("type") == "session" and isinstance(value.get("id"), str):
            return value["id"]
        keys = {
            "codex": ("thread_id",),
            "grok": ("thread_id", "session_id", "sessionId", "conversationId", "uuid"),
            "agy": ("conversationId", "conversation_id"),
            "claude": ("session_id",),
            "pi": (),
            "muse": (),
            "mimo": ("sessionID", "session_id"),
        }.get(harness, ("thread_id", "session_id", "sessionId", "conversationId", "sessionID", "id"))
        for key in keys:
            if isinstance(value.get(key), str) and value[key]:
                return value[key]
        for item in value.values():
            found = find_id(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_id(item)
            if found:
                return found
    return None
try:
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                found = find_id(json.loads(line))
            except ValueError:
                continue
            if found:
                print(found)
                raise SystemExit(0)
except OSError:
    pass
PY
}

harness_of() {  # harness_of <dispatch> <name>: the recorded harness for a lane or role
  python3 - "$1" "$2" <<'PY'
import json, os, sys
d, name = sys.argv[1], sys.argv[2]
try:
    run = json.load(open(os.path.join(d, "run.json")))
    cfg = run.get("config") or {}
except (OSError, AttributeError, ValueError, TypeError, json.JSONDecodeError):
    cfg = {}
spec = {}
if name == "coachman":
    spec = ((cfg.get("team") or {}).get("coachman_legs") or {}).get("synthesis") or (cfg.get("team") or {}).get("coachman") or {}
elif name == "coachman_fallback":
    spec = (cfg.get("team") or {}).get("coachman_fallback") or {}
else:
    spec = (cfg.get("lanes") or {}).get(name) or {}
print((spec.get("harness") if isinstance(spec, dict) else "") or "claude")
PY
}

# --- outcome ------------------------------------------------------------------------------
# Classified once, from mechanical signals. Wall indicators are checked here and nowhere
# else; nothing downstream reads .err.
WALL_INDICATORS='host: memory cap reached|host: process cap reached|402 Payment Required|usage limit|usage-limit|quota wall|spawn misfire|stale session lock'

classify() {  # classify <dispatch> <leg-number> <attempt> <state> <exit>: prints outcome JSON
  python3 - "$1" "$2" "$3" "$4" "$5" "$WALL_INDICATORS" <<'PY'
import json, os, re, sys

d, n, attempt, state, rc_s, wall_re = sys.argv[1:7]
rc = int(rc_s)
stream = os.path.join(d, "logs", "coachman-leg-%s-events.jsonl" % n)
err = os.path.join(d, "logs", "coachman-leg-%s.err" % n)
done = os.path.join(d, ".leg-%s-done" % n)

def thread_id(path):
    if not os.path.isfile(path):
        return None
    keys = ("thread_id", "session_id", "sessionId", "conversationId", "sessionID", "id")
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(rec, dict):
                    continue
                stream = rec.get("stream")
                if isinstance(stream, dict) and stream.get("kind") == "session" and isinstance(stream.get("id"), str):
                    return stream["id"]
                if rec.get("type") == "session" and isinstance(rec.get("id"), str):
                    return rec["id"]
                for key in keys:
                    v = rec.get(key)
                    if isinstance(v, str) and v:
                        return v
                for item in rec.values():
                    if isinstance(item, dict):
                        for key in keys:
                            v = item.get(key)
                            if isinstance(v, str) and v:
                                return v
    except OSError:
        pass
    return None

def wall():
    try:
        text = open(err, encoding="utf-8", errors="replace").read()
    except OSError:
        return False
    return re.search(wall_re, text) is not None

tid = thread_id(stream)
if os.path.isfile(done):
    outcome, on_answer = "finished", "none"
elif state == "refused":
    outcome, on_answer = "refused", "deliver-prompt"
elif wall():
    outcome, on_answer = "walled", "none"
elif not tid:
    outcome, on_answer = "no-thread", "relaunch"
else:
    outcome, on_answer = "spent", "none"
print(json.dumps({
    "outcome": outcome,
    "attempt": attempt,
    "state": state,
    "thread_id": tid,
    "on_answer": on_answer,
    "exit": rc,
}, sort_keys=True))
PY
}

record_outcome() {  # record_outcome <dispatch> <leg-number> <attempt> <state> <exit>
  local d=$1 n=$2 attempt=$3 state=$4 rc=$5 json
  leg_paths "$d" "$n"
  json=$(classify "$d" "$n" "$attempt" "$state" "$rc") || die "cannot classify the outcome of leg $n"
  mkdir -p "$d/logs" || die "cannot create $d/logs"
  printf '%s\n' "$json" > "$OUTCOME" || die "cannot write $OUTCOME"
  # The prompt this attempt carried, so a refused one can be delivered after the user answers.
  python3 - "$OUTCOME" "${PROMPT_FOR_OUTCOME:-}" <<'PY'
import json, os, sys
path, prompt = sys.argv[1], sys.argv[2]
try:
    rec = json.load(open(path))
except (OSError, ValueError):
    raise SystemExit(0)
if prompt:
    rec["prompt"] = prompt
with open(path, "w") as f:
    json.dump(rec, f, sort_keys=True)
    f.write("\n")
PY
  printf '%s\n' "$json"
}

# --- the attempt host.sh runs ---------------------------------------------------------------
_attempt() {  # _attempt <launch|resume|takeover> <dispatch> <leg-number> <leg-name> <worktree> <thread-id|-> --prompt <file>
  local attempt=$1 d=$2 n=$3 leg_name=$4 wt=$5 thread=$6
  shift 6
  local prompt=""
  while [ $# -gt 0 ]; do
    case $1 in
      --prompt) [ $# -ge 2 ] || die "--prompt needs a file"; prompt=$2; shift ;;
      *) die "unknown option for _attempt: $1" ;;
    esac
    shift
  done
  [ -n "$prompt" ] || die "_attempt needs --prompt"
  leg_paths "$d" "$n"
  mkdir -p "$d/logs" || die "cannot create $d/logs"
  local name state_file rc
  name=$(leg_name_of "$d" "$n")
  state_file=$OUTCOME.state
  rm -f -- "$state_file" "$OUTCOME"
  PROMPT_FOR_OUTCOME=$prompt
  export POSTMASTER_OUTCOME_FILE=$state_file
  local launch_rc=0
  case $attempt in
    launch)
      "$HERE/launch.sh" launch coachman "$wt" "$prompt" --leg "$leg_name" --run "$d"
      launch_rc=$? ;;
    resume)
      "$HERE/launch.sh" resume "$name" "$wt" "$thread" "$prompt" --leg "$leg_name" --run "$d"
      launch_rc=$? ;;
    takeover)
      "$HERE/launch.sh" launch coachman_fallback "$wt" "$prompt" --run "$d"
      launch_rc=$? ;;
    *) die "unknown attempt: $attempt" ;;
  esac
  rc=$launch_rc
  local state=started
  if [ -f "$state_file" ]; then
    state=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("state","started"))' "$state_file" 2>/dev/null || echo started)
    case $state in refused|started) ;; *) state=started ;; esac
    rm -f -- "$state_file"
  else
    # No side-channel: treat a clean refusal exit as refused, anything else as started.
    [ "$rc" -eq 1 ] && [ ! -s "$STREAM" ] && state=refused || state=started
  fi
  unset POSTMASTER_OUTCOME_FILE
  record_outcome "$d" "$n" "$attempt" "$state" "$rc" >/dev/null
  exit "$rc"
}

# --- start an attempt through the host ------------------------------------------------------
start_attempt() {  # start_attempt <attempt> <dispatch> <leg-number> <leg-name> <repo> <thread-id|-> <prompt> <append>
  local attempt=$1 d=$2 n=$3 leg_name=$4 repo=$5 thread=$6 prompt=$7 append=$8
  local wt name
  leg_paths "$d" "$n"
  wt=$(worktree_of "$d" "$repo")
  [ -d "$wt" ] || die "no such worktree: $wt"
  [ -f "$prompt" ] && [ -s "$prompt" ] || die "prompt file missing, unreadable or empty: $prompt"
  mkdir -p "$d/logs" || die "cannot create $d/logs"
  name=$("$HERE/host.sh" name "$d" coachman "$leg_name" "$n") || die "cannot name the launch"
  if [ "$attempt" = takeover ]; then
    [ -f "$STREAM" ] && mv -f -- "$STREAM" "$WALLED_STREAM" 2>/dev/null || :
  fi
  # Clear the outcome of a previous attempt so a reader never sees a stale one.
  rm -f -- "$OUTCOME" "$OUTCOME.state"
  local host_args=(
    run "$name" "$wt"
    --under "$d" --role coachman --run "$d"
    --out "$STREAM" --err "$ERR" --marker "$EXITED"
    -- "$HERE/leg.sh" _attempt "$attempt" "$d" "$n" "$leg_name" "$wt" "$thread" --prompt "$prompt"
  )
  [ "$append" = 1 ] && host_args=( "${host_args[0]}" "${host_args[1]}" "${host_args[2]}" --append "${host_args[@]:3}" )
  "$HERE/host.sh" "${host_args[@]}"
}


# --- waiting on the user --------------------------------------------------------------------
waiting_file() { printf '%s/postmaster/ESCALATION.md\n' "$1"; }

waiting_add() {  # waiting_add <runs> <ticket> <question-file>
  local runs=$1 ticket=$2 qfile=$3 f
  [ -f "$qfile" ] || die "no such question file: $qfile"
  f=$(waiting_file "$runs")
  mkdir -p "$(dirname "$f")" || die "cannot create $(dirname "$f")"
  python3 - "$f" "$ticket" "$qfile" <<'PY'
import pathlib, re, sys
path, ticket, qfile = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
question = pathlib.Path(qfile).read_text(encoding="utf-8", errors="replace").strip()
text = path.read_text(encoding="utf-8") if path.is_file() else ""
blocks = re.split(r"(?m)^## ", text)
head = blocks[0] if blocks else ""
rest = [b for b in blocks[1:] if b.strip()]
rest = [b for b in rest if not b.splitlines()[0].strip() == ticket]
rest.append(ticket + "\n" + question + "\n")
path.write_text(head + "".join("## " + b if not b.endswith("\n") else "## " + b for b in rest), encoding="utf-8")
# Normalize: ensure each block starts with ## 
text = path.read_text(encoding="utf-8")
parts = re.split(r"(?m)^## ", text)
out = [parts[0]]
for b in parts[1:]:
    out.append("## " + b if not b.startswith("## ") else b)
path.write_text("".join(out), encoding="utf-8")
PY
}

waiting_remove() {  # waiting_remove <runs> <ticket>
  local runs=$1 ticket=$2 f
  f=$(waiting_file "$runs")
  [ -f "$f" ] || return 0
  python3 - "$f" "$ticket" <<'PY'
import pathlib, re, sys
path, ticket = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
parts = re.split(r"(?m)^## ", text)
keep = [parts[0]]
for b in parts[1:]:
    if b.splitlines()[0].strip() != ticket:
        keep.append("## " + b)
out = "".join(keep)
path.write_text(out if out.strip() else "", encoding="utf-8")
if not out.strip():
    path.unlink()
PY
}

waiting_list() {  # waiting_list <runs>
  local f
  f=$(waiting_file "$1")
  [ -f "$f" ] && cat "$f"
  return 0
}

# --- answer ---------------------------------------------------------------------------------
answer_cmd() {  # answer_cmd <dispatch> <leg-number>
  local d=$1 n=$2
  leg_paths "$d" "$n"
  [ -f "$OUTCOME" ] || die "no outcome recorded for leg $n"
  python3 - "$OUTCOME" <<'PY'
import json, sys
rec = json.load(open(sys.argv[1]))
on = rec.get("on_answer") or "none"
prompt = rec.get("prompt") or ""
if on == "deliver-prompt" and prompt:
    print("deliver-prompt %s" % prompt)
elif on == "deliver-prompt":
    print("deliver-prompt")
else:
    print(on)
PY
}

# --- public commands ------------------------------------------------------------------------
cmd_launch() {
  local d=$1 n=$2 leg_name=$3 repo=$4; shift 4
  local prompt=""
  while [ $# -gt 0 ]; do
    case $1 in
      --prompt) [ $# -ge 2 ] || die "--prompt needs a file"; prompt=$2; shift ;;
      *) die "unknown option for launch: $1" ;;
    esac
    shift
  done
  leg_paths "$d" "$n"
  [ -n "$prompt" ] || prompt=$d/leg-$n-prompt.txt
  start_attempt launch "$d" "$n" "$leg_name" "$repo" - "$prompt" 0
}

cmd_resume() {
  local d=$1 n=$2 leg_name=$3 repo=$4 thread=$5; shift 5
  local prompt=""
  while [ $# -gt 0 ]; do
    case $1 in
      --prompt) [ $# -ge 2 ] || die "--prompt needs a file"; prompt=$2; shift ;;
      *) die "unknown option for resume: $1" ;;
    esac
    shift
  done
  [ -n "$thread" ] || die "resume needs a thread id"
  leg_paths "$d" "$n"
  if [ -z "$prompt" ]; then
    prompt=$d/leg-$n-resume-$(date -u +%Y%m%dT%H%M%SZ).txt
    printf 'Continue leg %s; your last written state is in the dispatch directory and the worktree.\n' "$n" > "$prompt"
  fi
  start_attempt resume "$d" "$n" "$leg_name" "$repo" "$thread" "$prompt" 1
}

cmd_takeover() {
  local d=$1 n=$2 leg_name=$3 repo=$4; shift 4
  local prompt=""
  while [ $# -gt 0 ]; do
    case $1 in
      --prompt) [ $# -ge 2 ] || die "--prompt needs a file"; prompt=$2; shift ;;
      *) die "unknown option for takeover: $1" ;;
    esac
    shift
  done
  leg_paths "$d" "$n"
  if [ -z "$prompt" ]; then
    prompt=$d/leg-$n-takeover.txt
    local ticket prev tool=$TOOL
    ticket=$(basename "$d")
    if [ "$n" -gt 1 ]; then prev=", then $d/handoff-$((n-1)).md"; else prev=""; fi
    cat > "$prompt" <<PREOF
You take over leg $n of $ticket mid-way. Read \`$d/brief.md\`,
\`$tool/skills/postmaster/coachman.md\`$prev, then \`run-log.md\` and
\`actions.jsonl\` for what this leg did before you, then the synthesis worktree's \`git log\` and
\`git status\`. Treat every uncommitted change as unverified. Log \`handoff-accept\` and finish
the leg.
PREOF
  fi
  start_attempt takeover "$d" "$n" "$leg_name" "$repo" - "$prompt" 0
}

usage() {
  echo "usage: leg.sh launch|resume|takeover <dispatch> <leg-number> <leg-name> <repo> [<thread-id>] [--prompt <file>]" >&2
  echo "       leg.sh outcome|answer <dispatch> <leg-number>" >&2
  echo "       leg.sh waiting add|remove|list ..." >&2
  echo "       leg.sh --self-test" >&2
  exit 1
}

[ $# -ge 1 ] || usage
if [ "$1" = --self-test ] || [ "$1" = _self-test ]; then
  :
elif [ "$1" = _attempt ]; then
  shift; _attempt "$@"; exit $?
elif [ "$1" = launch ]; then
  shift; [ $# -ge 4 ] || usage; cmd_launch "$@"; exit $?
elif [ "$1" = resume ]; then
  shift; [ $# -ge 5 ] || usage; cmd_resume "$@"; exit $?
elif [ "$1" = takeover ]; then
  shift; [ $# -ge 4 ] || usage; cmd_takeover "$@"; exit $?
elif [ "$1" = outcome ]; then
  shift; [ $# -eq 2 ] || usage
  leg_paths "$1" "$2"; [ -f "$OUTCOME" ] || die "no outcome recorded for leg $2"; cat "$OUTCOME"; exit 0
elif [ "$1" = answer ]; then
  shift; [ $# -eq 2 ] || usage; answer_cmd "$@"; exit 0
elif [ "$1" = waiting ]; then
  shift
  case ${1:-} in
    add) shift; [ $# -eq 3 ] || usage; waiting_add "$@" ;;
    remove) shift; [ $# -eq 2 ] || usage; waiting_remove "$@" ;;
    list) shift; [ $# -eq 1 ] || usage; waiting_list "$@" ;;
    *) usage ;;
  esac
  exit 0
else
  usage
fi

# --- self-test ------------------------------------------------------------------------------
# Every outcome gets a positive and a negative control, through the identical classify call.
# The two shapes the ticket names — an env file that fails to load, and a resume refused after
# the leg has a thread id — are built as fixtures and classified like any other attempt.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }

mkleg() {  # mkleg <name> <n>: a dispatch directory with logs/
  mkdir -p "$tmp/$1/logs"
}

put() {  # put <name> <n> <file> <content>
  printf '%s' "$4" > "$tmp/$1/logs/coachman-leg-$2-$3"
}

putdone() { : > "$tmp/$1/.leg-$2-done"; }

cls() {  # cls <name> <n> <attempt> <state> <exit>: prints {outcome,on_answer,thread_id}
  classify "$tmp/$1" "$2" "$3" "$4" "$5" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["outcome"], d["on_answer"], d.get("thread_id") or "-")'
}

expect() {  # expect <label> <got> <want>
  [ "$2" = "$3" ] && ok "$1" || fail "$1 (got '$2', wanted '$3')"
}

echo "positive controls"
# refused: launch.sh said no before the harness started
mkleg refused 1
expect "a refusal is refused, and delivers the carried prompt" \
  "$(cls refused 1 launch refused 1)" "refused deliver-prompt -"
# no-thread: the harness started, the stream holds no thread id
mkleg nothread 2
printf '{"type":"text","text":"hello"}\n' > "$tmp/nothread/logs/coachman-leg-2-events.jsonl"
expect "a start with no thread id is no-thread, and relaunches" \
  "$(cls nothread 2 launch started 1)" "no-thread relaunch -"
# walled before any event: no thread id, but a wall indicator in .err
mkleg wallpre 3
printf 'provider: 402 Payment Required\n' > "$tmp/wallpre/logs/coachman-leg-3.err"
expect "a wall before the first event is walled, not no-thread" \
  "$(cls wallpre 3 launch started 1)" "walled none -"
# walled after the first event: thread id present, wall in .err
mkleg wallpost 4
printf '{"session_id":"ses_walled"}\n' > "$tmp/wallpost/logs/coachman-leg-4-events.jsonl"
printf 'quota wall\n' > "$tmp/wallpost/logs/coachman-leg-4.err"
expect "a wall after the first event is walled" \
  "$(cls wallpost 4 resume started 1)" "walled none ses_walled"
# walled by host cap
mkleg capwall 5
printf 'host: memory cap reached (MemoryMax=8G)\n' > "$tmp/capwall/logs/coachman-leg-5.err"
expect "a host cap wall is walled" \
  "$(cls capwall 5 launch started 137)" "walled none -"
# spent: thread id present, no done marker
mkleg spent 6
printf '{"session_id":"ses_spent"}\n' > "$tmp/spent/logs/coachman-leg-6-events.jsonl"
expect "a thread id with no hand-off is spent" \
  "$(cls spent 6 resume started 0)" "spent none ses_spent"
# finished: done marker present
mkleg fin 7
printf '{"session_id":"ses_fin"}\n' > "$tmp/fin/logs/coachman-leg-7-events.jsonl"
putdone fin 7
expect "a done marker is finished" \
  "$(cls fin 7 launch started 0)" "finished none ses_fin"

echo "negative controls"
mkleg nref 1
printf '{"session_id":"ses_x"}\n' > "$tmp/nref/logs/coachman-leg-1-events.jsonl"
putdone nref 1
expect "a done marker beats a refused state that somehow stuck" \
  "$(cls nref 1 launch refused 0)" "finished none ses_x"
mkleg nthread 2
printf 'host: memory cap reached\n' > "$tmp/nthread/logs/coachman-leg-2.err"
printf '{"session_id":"ses_y"}\n' > "$tmp/nthread/logs/coachman-leg-2-events.jsonl"
expect "a wall beats a thread id when the wall is what ended it" \
  "$(cls nthread 2 resume started 1)" "walled none ses_y"
mkleg nspent 3
printf 'nothing here\n' > "$tmp/nspent/logs/coachman-leg-3.err"
printf '{"type":"text"}\n' > "$tmp/nspent/logs/coachman-leg-3-events.jsonl"
expect "ordinary stderr is not a wall" \
  "$(cls nspent 3 launch started 0)" "no-thread relaunch -"
mkleg nfin 4
printf '{"session_id":"ses_z"}\n' > "$tmp/nfin/logs/coachman-leg-4-events.jsonl"
expect "no done marker is not finished" \
  "$(cls nfin 4 launch started 0)" "spent none ses_z"
mkleg nnone 5
expect "no state and no stream is spent only when a thread id appears; here it is no-thread" \
  "$(cls nnone 5 launch started 0)" "no-thread relaunch -"

echo "the shapes the ticket names"
# An env file that fails to load: launch.sh refuses, so the state is refused.
mkleg envfail 1
printf '{"state": "refused"}\n' > "$tmp/envfail/logs/coachman-leg-1-outcome.json.state"
expect "an env file that fails to load classifies as refused" \
  "$(cls envfail 1 launch refused 1)" "refused deliver-prompt -"
# A resume refused after the leg has a thread id: the stream still holds the old thread.
mkleg resref 2
printf '{"session_id":"ses_old"}\n' > "$tmp/resref/logs/coachman-leg-2-events.jsonl"
expect "a resume refused after a thread id is refused and delivers the carried prompt" \
  "$(cls resref 2 resume refused 1)" "refused deliver-prompt ses_old"

echo "answer"
mkleg ans 1
printf '{"session_id":"ses_a"}\n' > "$tmp/ans/logs/coachman-leg-1-events.jsonl"
classify "$tmp/ans" 1 resume refused 1 | python3 -c '
import json,sys,os
rec=json.load(sys.stdin); rec["prompt"]="/tmp/p.txt"
json.dump(rec, open(sys.argv[1],"w"))' "$tmp/ans/logs/coachman-leg-1-outcome.json"
got=$(leg_paths "$tmp/ans" 1; answer_cmd "$tmp/ans" 1)
expect "answer on a refused resume names deliver-prompt and the file" "$got" "deliver-prompt /tmp/p.txt"
mkleg ans2 2
printf '{"type":"text"}\n' > "$tmp/ans2/logs/coachman-leg-2-events.jsonl"
classify "$tmp/ans2" 2 launch started 1 | python3 -c '
import json,sys
rec=json.load(sys.stdin)
json.dump(rec, open(sys.argv[1],"w"))' "$tmp/ans2/logs/coachman-leg-2-outcome.json"
got=$(leg_paths "$tmp/ans2" 2; answer_cmd "$tmp/ans2" 2)
expect "answer on no-thread names relaunch" "$got" "relaunch"

echo "waiting"
runs=$tmp/runs; mkdir -p "$runs"
printf 'What about the merge?\n' > "$tmp/q1.txt"
printf 'Ship or not?\n' > "$tmp/q2.txt"
"$HERE/leg.sh" waiting add "$runs" T-1 "$tmp/q1.txt"
"$HERE/leg.sh" waiting add "$runs" T-2 "$tmp/q2.txt"
got=$("$HERE/leg.sh" waiting list "$runs" | grep -c '^## ')
expect "two waiting runs are listed" "$got" "2"
"$HERE/leg.sh" waiting add "$runs" T-1 "$tmp/q2.txt"
got=$("$HERE/leg.sh" waiting list "$runs" | grep -c '^## ')
expect "adding a ticket already waiting replaces its question, and does not duplicate" "$got" "2"
got=$("$HERE/leg.sh" waiting list "$runs" | awk '/^## T-1$/{getline; print}')
expect "the replaced question is the new one" "$got" "Ship or not?"
"$HERE/leg.sh" waiting remove "$runs" T-1
got=$("$HERE/leg.sh" waiting list "$runs" | grep -c '^## ')
expect "removing one leaves the other" "$got" "1"
"$HERE/leg.sh" waiting remove "$runs" T-2
got=$("$HERE/leg.sh" waiting list "$runs" | grep -c '^## ' || true)
expect "removing the last empties the list" "$got" "0"
[ ! -f "$runs/postmaster/ESCALATION.md" ] && ok "an empty waiting list removes the file" \
  || fail "an empty waiting list removes the file"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
