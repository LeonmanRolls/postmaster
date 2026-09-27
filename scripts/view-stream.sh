#!/usr/bin/env bash
# Show a harness's event stream readably: one line per event of interest, never raw JSON. This is
# what a session host's pane shows while a launch runs (scripts/host.sh). Event formats are
# harness-specific, so this script belongs to the harness adapter beside launch.sh, and
# harnesses.md says which harness's events it knows.
#
#   view-stream.sh < <events-file>                           render a stream, then stop
#   view-stream.sh --follow <file> --pid <pid> [--from <byte>] render the file as it grows,
#                                                           and stop once <pid> has exited
#                                                           and everything it wrote is shown
#   view-stream.sh --self-test
#
# Each event of interest is one line: a session starting, with its thread id; a tool call, with
# what it was called on; what the model said; an error; the result. Tool output, thinking,
# hooks and streaming deltas are left out. A JSON event it does not know is shown by its type,
# once per run of the same type, so an unknown harness still reads as a sequence of steps. A
# line that is not JSON is shown as it is, less any control characters, which never reach the
# terminal from a stream. Following, each line carries the local time.
#
#   exit 0  rendered
#   exit 1  usage, or the self-test failed
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

# The program is passed with -c, not on stdin: stdin is the stream it renders.
read -r -d '' PROG <<'PY'
import json, os, re, shutil, sys, time

args = sys.argv[1:]
follow = pid = None
start = 0
while args:
    a = args.pop(0)
    if a == "--follow": follow = args.pop(0)
    elif a == "--pid": pid = int(args.pop(0))
    elif a == "--from": start = int(args.pop(0))
    else:
        print("view-stream: unknown argument: %s" % a, file=sys.stderr); sys.exit(1)
if follow and pid is None:
    print("view-stream: --follow needs --pid", file=sys.stderr); sys.exit(1)

width = max(40, shutil.get_terminal_size((170, 24)).columns - 10) if follow else 160

def short(s, n=None):
    s = " ".join(str(s).strip().splitlines()[:1]) if s is not None else ""
    n = n or width
    return s if len(s) <= n else s[: n - 1] + "…"

def tool_line(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    for key in ("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt"):
        v = inp.get(key)
        if isinstance(v, str) and v.strip():
            return "%s: %s" % (name, short(v))
    return str(name)

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""

QUIET = {
    # claude
    "stream_event",
    # codex
    "turn.started", "item.updated",
    # pi
    "agent_start", "turn_start", "turn_end", "message_start", "message_update",
    "tool_execution_update", "auto_compaction_end", "auto_retry_end",
}

def render(e):
    t = e.get("type")
    if t in QUIET:
        return None
    # claude (claude -p --output-format stream-json)
    if t == "system":
        st = e.get("subtype")
        if st == "init":
            return "session %s · %s" % (e.get("session_id"), e.get("model"))
        if st == "compact_boundary":
            return "context compacted"
        return None
    if t in ("assistant", "user") and isinstance(e.get("message"), dict):
        lines = []
        for b in e["message"].get("content") or []:
            if not isinstance(b, dict):
                continue
            k = b.get("type")
            if t == "assistant" and k == "text" and str(b.get("text", "")).strip():
                lines.append("says: " + short(b["text"]))
            elif t == "assistant" and k == "tool_use":
                lines.append(tool_line(b.get("name"), b.get("input")))
            elif t == "user" and k == "tool_result" and b.get("is_error"):
                lines.append("tool error: " + short(text_of(b.get("content"))))
        return " | ".join(lines) or None
    if t == "result":
        parts = [e.get("subtype") or e.get("status") or ("error" if e.get("is_error") else "done")]
        if isinstance(e.get("num_turns"), int):
            parts.append("%d turns" % e["num_turns"])
        if isinstance(e.get("total_cost_usd"), (int, float)):
            parts.append("$%.2f" % e["total_cost_usd"])
        if e.get("result"):
            parts.append(short(e["result"], 100))
        return "result: " + " · ".join(parts)
    if t == "rate_limit_event":
        status = (e.get("rate_limit_info") or {}).get("status")
        return None if status in (None, "allowed") else "rate limit: %s" % status
    # codex (codex exec --json)
    if t == "thread.started":
        return "session %s" % e.get("thread_id")
    if t in ("item.started", "item.completed"):
        it = e.get("item") or {}
        k = it.get("type")
        if t == "item.started":
            return "shell: " + short(it.get("command")) if k == "command_execution" else None
        if k == "agent_message":
            return "says: " + short(it.get("text"))
        if k == "command_execution":
            code = it.get("exit_code")
            return None if code in (0, None) else "shell exit %s: %s" % (code, short(it.get("command")))
        if k == "file_change":
            return "edit: " + ", ".join(str(c.get("path")) for c in it.get("changes") or [] if isinstance(c, dict))
        if k == "mcp_tool_call":
            return "tool: %s.%s" % (it.get("server"), it.get("tool"))
        if k == "web_search":
            return "search: " + short(it.get("query"))
        if k == "error":
            return "error: " + short(it.get("message"))
        return None
    if t == "turn.completed":
        u = e.get("usage") or {}
        return "turn done · %s tokens in, %s out" % (u.get("input_tokens", "?"), u.get("output_tokens", "?"))
    if t == "turn.failed":
        return "turn failed: " + short((e.get("error") or {}).get("message"))
    if t == "error":
        return "error: " + short(e.get("message") or json.dumps(e))
    # pi (pi --mode json)
    if t == "session":
        return "session %s" % e.get("id")
    if t == "tool_execution_start":
        return tool_line(e.get("toolName"), e.get("args"))
    if t == "tool_execution_end":
        return "tool error: %s" % e.get("toolName") if e.get("isError") else None
    if t == "message_end":
        m = e.get("message") or {}
        if m.get("role") != "assistant":
            return None
        said = text_of([b for b in m.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"])
        return "says: " + short(said) if said.strip() else None
    if t == "agent_end":
        return "done"
    if t == "auto_retry_start":
        return "retrying: " + short(e.get("errorMessage") or "")
    if t == "auto_compaction_start":
        return "compacting context"
    return GENERIC

GENERIC = object()
last_generic = [None]

def generic(e):
    t = str(e.get("type") or e.get("event") or "event")
    if t == last_generic[0]:
        return None
    last_generic[0] = t
    for key in ("text", "message", "content", "result", "name", "tool_name", "command"):
        v = e.get(key)
        if isinstance(v, str) and v.strip():
            return "%s: %s" % (t, short(v))
    return t

CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")    # nothing a stream says reaches the terminal as a control

def show(line, stamp):
    line = line.rstrip("\r\n")
    if not line.strip():
        return
    try:
        e = json.loads(line)
    except ValueError:
        e = None
    if isinstance(e, dict):
        out = render(e)
        if out is GENERIC:
            out = generic(e)
        else:
            last_generic[0] = None
    else:
        out = short(line)
    if out:
        print((time.strftime("%H:%M:%S ") if stamp else "") + CONTROL.sub("", out), flush=True)

if not follow:
    for line in sys.stdin:
        show(line, False)
    sys.exit(0)

def alive(p):
    try:
        os.kill(p, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

deadline = time.time() + 30
while not os.path.exists(follow):             # the launch creates it; give it a moment
    if not alive(pid) or time.time() > deadline:
        sys.exit(0)
    time.sleep(0.2)
with open(follow, "r", errors="replace") as f:
    f.seek(start)
    buf = ""
    while True:
        chunk = f.readline()
        if chunk:
            buf += chunk
            if buf.endswith("\n"):
                show(buf, True); buf = ""
            continue
        if not alive(pid):
            rest = f.read()                   # whatever landed between the last read and the exit
            for line in (buf + rest).splitlines():
                show(line, True)
            break
        time.sleep(0.2)
PY
view() { python3 -c "$PROG" "$@"; }   # view [--follow <file> --pid <pid> [--from <byte>]]

case ${1:-} in
  --self-test) ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  *) view "$@"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; printf '%s\n' "${2:-}" | sed 's/^/         /'; fails=$((fails+1)); }
rendered() { printf '%s\n' "$1" | view; }
shows() {  # shows <label> <event> <exact line wanted>
  local got; got=$(rendered "$2")
  [ "$got" = "$3" ] && ok "$1" || fail "$1" "wanted: $3"$'\n'"got:    $got"
}
silent() {  # silent <label> <event>
  local got; got=$(rendered "$2")
  [ -z "$got" ] && ok "$1" || fail "$1" "got: $got"
}

echo "positive controls: each event of interest is one readable line"
# claude events, trimmed from a recorded claude -p --output-format stream-json run
shows "claude: a session starts, with its thread id and model" \
  '{"type":"system","subtype":"init","session_id":"a99db1c7-9178","model":"claude-haiku-4-5","tools":["Bash"]}' \
  'session a99db1c7-9178 · claude-haiku-4-5'
shows "claude: a tool call, with what it ran" \
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -a","description":"List files"}}]}}' \
  'Bash: ls -a'
shows "claude: what the model said, first line only" \
  '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed 3 entries.\nMore detail."}]}}' \
  'says: The command printed 3 entries.'
shows "claude: a failed tool call" \
  '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"No such file"}]}}' \
  'tool error: No such file'
shows "claude: the result, with turns and cost" \
  '{"type":"result","subtype":"success","num_turns":2,"total_cost_usd":0.0060272,"result":"The command printed 3 entries."}' \
  'result: success · 2 turns · $0.01 · The command printed 3 entries.'
shows "codex: a session starts" '{"type":"thread.started","thread_id":"0199a213-81c0"}' 'session 0199a213-81c0'
shows "codex: a shell command" \
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}' \
  'shell: bash -lc ls'
shows "codex: what the model said" '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Done."}}' 'says: Done.'
shows "pi: a session starts" '{"type":"session","version":3,"id":"01a0c7e8-5863","cwd":"/w"}' 'session 01a0c7e8-5863'
shows "pi: a tool call" '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"command":"ls"}}' 'bash: ls'
shows "pi: what the model said" \
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}' 'says: All done.'
shows "a line that is not JSON is shown as it is" 'plain text from a wrapper' 'plain text from a wrapper'
shows "an unknown event shows its type" '{"type":"heartbeat","message":"still here"}' 'heartbeat: still here'
shows "escape sequences in what a model said never reach the terminal" \
  '{"type":"assistant","message":{"content":[{"type":"text","text":"hi \u001b]0;title\u0007 there"}]}}' 'says: hi ]0;title there'
shows "nor in a line that is not JSON" "$(printf 'plain \033[2Jtext\a')" 'plain [2Jtext'

echo "negative controls: noise renders nothing"
silent "claude: a hook event" '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}'
silent "claude: thinking" '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}'
silent "claude: a tool result that succeeded" '{"type":"user","message":{"content":[{"type":"tool_result","content":"a\nb"}]}}'
silent "claude: a rate-limit event that allowed the call" '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}'
silent "codex: reasoning" '{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}'
silent "pi: a streaming delta" '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Al"}}'
silent "pi: the user's own message ending" '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}'
got=$(for i in $(seq 1 50); do printf '{"type":"delta","n":%d}\n' "$i"; done | view)
[ "$got" = delta ] && ok "fifty unknown events of one type show as one line" || fail "fifty unknown events of one type show as one line" "$got"
stream=$(printf '%s\n' \
  '{"type":"system","subtype":"hook_started"}' \
  '{"type":"system","subtype":"init","session_id":"s1","model":"m"}' \
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/w/a.ts"}}]}}' \
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\"json\": true}"}]}}' \
  '{"type":"result","subtype":"success","num_turns":1}')
got=$(printf '%s\n' "$stream" | view)
case $got in *'{'*) fail "a whole stream renders with no raw JSON in it" "$got" ;;
  *) [ "$(printf '%s\n' "$got" | wc -l | tr -d ' ')" -eq 3 ] && ok "a whole stream renders with no raw JSON in it" \
       || fail "a whole stream renders with no raw JSON in it" "$got" ;; esac

echo "following a file that grows"
f="$tmp/events.jsonl"; : > "$f"
( for i in 1 2 3; do printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step %d"}]}}\n' "$i" >> "$f"; sleep 0.3; done
  printf '{"type":"result","subtype":"success"}' >> "$f" ) &     # the last line has no newline
writer=$!
out=$(view --follow "$f" --pid "$writer")
n=$(printf '%s\n' "$out" | grep -c -E '^[0-9]{2}:[0-9]{2}:[0-9]{2} (says: step [123]|result: success)$')
[ "$n" -eq 4 ] && ok "every line is shown, with its time, and the unterminated last line too" || fail "every line is shown, with its time, and the unterminated last line too" "$out"
printf 'old line\n' > "$tmp/append.jsonl"; from=$(wc -c < "$tmp/append.jsonl" | tr -d ' ')
( printf 'new line\n' >> "$tmp/append.jsonl" ) & w=$!
out=$(view --follow "$tmp/append.jsonl" --pid "$w" --from "$from")
case $out in *"old line"*) fail "--from skips what was there before" "$out" ;;
  *"new line"*) ok "--from skips what was there before" ;; *) fail "--from skips what was there before" "$out" ;; esac

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
