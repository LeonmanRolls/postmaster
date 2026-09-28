#!/usr/bin/env bash
# Show a harness's event stream readably: what an agent says and runs, in full and wrapped to the
# pane, never raw JSON. This is
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
# Each event of interest is a block of lines: a session starting, with its thread id; a tool
# call, with what it was called on; what the model said; an error; the result. Messages and
# commands show in full, every line, wrapped to the pane and never cut short. Tool output,
# thinking, hooks and raw streaming deltas are left out. A JSON event it does not know is
# shown by its type, once per run of the same type, so an unknown harness still reads as a
# sequence of steps. A line that is not JSON is shown as it is, less any control characters,
# which never reach the terminal from a stream. Following, each line carries the local time.
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

def wrap(s, n=None):
    # Every line of s, word-wrapped to n columns. Explicit newlines stay; a token longer than
    # the pane is broken across lines. Nothing is ever cut short with an ellipsis.
    s = "" if s is None else str(s)
    n = n or width
    out = []
    for para in s.splitlines() or [""]:
        line = ""
        for word in para.split(" "):
            while word:
                if not line:
                    if len(word) <= n:
                        line, word = word, ""
                    else:
                        out.append(word[:n])
                        word = word[n:]
                elif len(line) + 1 + len(word) <= n:
                    line, word = line + " " + word, ""
                elif len(word) <= n:
                    out.append(line)
                    line = ""
                else:
                    room = n - len(line) - 1
                    if room <= 0:
                        out.append(line)
                        line = ""
                    else:
                        out.append(line + " " + word[:room])
                        word = word[room:]
                        line = ""
        out.append(line)
    return "\n".join(out)

def tool_line(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    for key in ("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt"):
        v = inp.get(key)
        if isinstance(v, str) and v.strip():
            return "%s: %s" % (name, v)
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

def muse_facts(p):
    # What a Muse tool.result names as its input. edit_facts carries the path of a write or
    # edit. A bash result's text is a JSON object whose "command" is what ran; a read_file
    # result's text opens with "Read text file `path`". The rest of that text is tool output
    # and never reaches the pane.
    inp = {}
    ef = p.get("edit_facts")
    if isinstance(ef, dict):
        for key in ("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt"):
            v = ef.get(key)
            if isinstance(v, str) and v.strip():
                inp[key] = v
    text = p.get("text")
    if isinstance(text, str):
        t = text.lstrip()
        if t.startswith("{"):
            try:
                blob = json.loads(t)
            except ValueError:
                blob = None
            if isinstance(blob, dict):
                for key in ("command", "cmd", "file_path", "path"):
                    v = blob.get(key)
                    if isinstance(v, str) and v.strip():
                        inp.setdefault("command" if key in ("command", "cmd") else "path", v)
                        break
        else:
            m = re.match(r"Read text file `([^`]+)`", t)
            if m:
                inp.setdefault("path", m.group(1))
    return inp

muse_said = [""]

def muse(e):
    # muse (muse exec --json): each record names its payload_type, and its stream is the session
    pt, p = str(e.get("payload_type")), e.get("payload") or {}
    if pt == "run.output.delta":
        muse_said[0] += str(p.get("text") or "")
        return None
    out = []
    if pt.startswith("run.terminal."):
        muse_said[0] = ""   # the result line carries this text
        said = str(p.get("text") or "").strip()
        out.append("result: %s%s" % (p.get("terminal") or pt.split(".")[-1], " · " + said if said else ""))
        return out
    if muse_said[0].strip():
        out.append("says: " + muse_said[0].strip())
        muse_said[0] = ""
    if pt == "run.model.configured":
        out.append("session %s · %s" % ((e.get("stream") or {}).get("id"), p.get("model_id")))
    elif pt == "tool.result":
        facts = p.get("correlation_facts") or {}
        name = facts.get("tool_name") or "tool"
        if facts.get("outcome") not in (None, "success"):
            out.append("tool error: %s" % name)
        else:
            out.append(tool_line(name, muse_facts(p)))
    # else: task lifecycle and bookkeeping, and a delta already handled above
    return out or None

mimo_sessions = set()

def mimo(e):
    # mimo (mimo run --format json): every event carries its sessionID and a part
    t, part = e.get("type"), e.get("part") or {}
    out = []
    sid = e.get("sessionID")
    if sid and sid not in mimo_sessions:
        mimo_sessions.add(sid)
        out.append("session %s" % sid)
    if t == "text" and str(part.get("text", "")).strip():
        out.append("says: " + str(part.get("text") or ""))
    elif t == "tool_use":
        state = part.get("state") or {}
        out.append("tool error: %s" % part.get("tool") if state.get("status") == "error"
                   else tool_line(part.get("tool"), state.get("input")))
    elif t == "step_finish" and part.get("reason") == "stop":
        out.append("done")
    elif t == "error":
        err = e.get("error") or {}
        out.append("error: " + str((err.get("data") or {}).get("message") or err.get("name") or json.dumps(err)))
    return out or None

def render(e):
    if "payload_type" in e:
        return muse(e)
    if "sessionID" in e and e.get("type") in ("step_start", "step_finish", "text", "tool_use", "error"):
        return mimo(e)
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
                lines.append("says: " + str(b["text"]))
            elif t == "assistant" and k == "tool_use":
                lines.append(tool_line(b.get("name"), b.get("input")))
            elif t == "user" and k == "tool_result" and b.get("is_error"):
                lines.append("tool error: " + text_of(b.get("content")))
        return " | ".join(lines) or None
    if t == "result":
        parts = [e.get("subtype") or e.get("status") or ("error" if e.get("is_error") else "done")]
        if isinstance(e.get("num_turns"), int):
            parts.append("%d turns" % e["num_turns"])
        if isinstance(e.get("total_cost_usd"), (int, float)):
            parts.append("$%.2f" % e["total_cost_usd"])
        if e.get("result"):
            parts.append(str(e["result"]))
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
            return "shell: " + str(it.get("command") or "") if k == "command_execution" else None
        if k == "agent_message":
            return "says: " + str(it.get("text") or "")
        if k == "command_execution":
            code = it.get("exit_code")
            return None if code in (0, None) else "shell exit %s: %s" % (code, it.get("command") or "")
        if k == "file_change":
            return "edit: " + ", ".join(str(c.get("path")) for c in it.get("changes") or [] if isinstance(c, dict))
        if k == "mcp_tool_call":
            return "tool: %s.%s" % (it.get("server"), it.get("tool"))
        if k == "web_search":
            return "search: " + str(it.get("query") or "")
        if k == "error":
            return "error: " + str(it.get("message") or "")
        return None
    if t == "turn.completed":
        u = e.get("usage") or {}
        return "turn done · %s tokens in, %s out" % (u.get("input_tokens", "?"), u.get("output_tokens", "?"))
    if t == "turn.failed":
        return "turn failed: " + str((e.get("error") or {}).get("message") or "")
    if t == "error":
        return "error: " + str(e.get("message") or json.dumps(e))
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
        return "says: " + said if said.strip() else None
    if t == "agent_end":
        return "done"
    if t == "auto_retry_start":
        return "retrying: " + str(e.get("errorMessage") or "")
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
            return "%s: %s" % (t, v)
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
        out = line
    for one in (out if isinstance(out, list) else [out] if out else []):
        for row in (wrap(str(one)).splitlines() or [""]):
            print((time.strftime("%H:%M:%S ") if stamp else "") + CONTROL.sub("", row), flush=True)

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
shows "claude: what the model said, every line" \
  '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed 3 entries.\nMore detail."}]}}' \
  "$(printf 'says: The command printed 3 entries.\nMore detail.')"
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
shows "muse: a session starts, with its thread id and model" \
  '{"stream":{"kind":"session","id":"01a0e16d-17e8"},"payload_type":"run.model.configured","payload":{"model_id":"muse-spark-1.3-contributor","source":"startup"}}' \
  'session 01a0e16d-17e8 · muse-spark-1.3-contributor'
shows "muse: a tool call, with what it changed" \
  '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"write_file","outcome":"success"},"edit_facts":{"path":"proof.txt","added":1}}}' \
  'write_file: proof.txt'
shows "muse: a failed tool call" \
  '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"shell","outcome":"error"}}}' \
  'tool error: shell'
shows "muse: the result, with what the model said" \
  '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"DONE"}}' \
  'result: completed · DONE'
shows "muse: a failed run" '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.failed","payload":{"terminal":"failed","text":""}}' 'result: failed'
shows "mimo: a session starts, with its thread id, and a first step says nothing more" \
  '{"type":"step_start","sessionID":"ses_ffe5f1e2","part":{"type":"step-start"}}' 'session ses_ffe5f1e2'
shows "mimo: a tool call, with what it touched" \
  '{"type":"tool_use","sessionID":"ses_ffe5f1e2","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"file_path":"proof.txt","content":"PELICAN"}}}}' \
  "$(printf 'session ses_ffe5f1e2\nwrite: proof.txt')"
shows "mimo: what the model said" '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"DONE"}}' "$(printf 'session ses_1\nsays: DONE')"
shows "mimo: a failed tool call" '{"type":"tool_use","sessionID":"ses_1","part":{"tool":"bash","state":{"status":"error","input":{"command":"false"}}}}' \
  "$(printf 'session ses_1\ntool error: bash')"
got=$(printf '%s\n' '{"type":"step_start","sessionID":"ses_2","part":{}}' '{"type":"text","sessionID":"ses_2","part":{"text":"DONE"}}' \
  '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"tool-calls"}}' '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"stop"}}' | view)
[ "$got" = "$(printf 'session ses_2\nsays: DONE\ndone')" ] && ok "mimo: a session is named once, and only its last step says done" \
  || fail "mimo: a session is named once, and only its last step says done" "$got"
shows "a line that is not JSON is shown as it is" 'plain text from a wrapper' 'plain text from a wrapper'
shows "an unknown event shows its type" '{"type":"heartbeat","message":"still here"}' 'heartbeat: still here'
shows "escape sequences in what a model said never reach the terminal" \
  '{"type":"assistant","message":{"content":[{"type":"text","text":"hi \u001b]0;title\u0007 there"}]}}' 'says: hi ]0;title there'
shows "nor in a line that is not JSON" "$(printf 'plain \033[2Jtext\a')" 'plain [2Jtext'

echo "full text: every line of a message and every command, wrapped to the pane, never cut short"
shows "a message of several lines shows every line" \
  '{"type":"text","sessionID":"ses_ml","part":{"type":"text","text":"First line of the reply.\nSecond line of the reply.\nThird line of the reply."}}' \
  "$(printf 'session ses_ml\nsays: First line of the reply.\nSecond line of the reply.\nThird line of the reply.')"
# A line longer than the pane (160 in this mode): wrapped, never an ellipsis, nothing lost.
long=$(printf 'x%.0s' $(seq 1 200))
got=$(rendered "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"$long\"}]}}")
case $got in *'…'*) fail "a line longer than the pane wraps and is never cut with an ellipsis" "$got" ;;
  *)
    total=$(printf '%s' "$got" | tr -cd 'x' | wc -c | tr -d ' ')
    wide=$(printf '%s\n' "$got" | awk 'length > 160 {n++} END {print n+0}')
    if [ "$total" -eq 200 ] && [ "$wide" -eq 0 ]; then
      ok "a line longer than the pane wraps and is never cut with an ellipsis"
    else
      fail "a line longer than the pane wraps and is never cut with an ellipsis" \
        "x's shown: $total (want 200), lines over 160: $wide — got: $got"
    fi ;;
esac
longcmd=$(printf 'z%.0s' $(seq 1 200))
got=$(rendered "$(printf '{"type":"tool_use","sessionID":"ses_c","part":{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"%s"}}}}' "$longcmd")")
case $got in *'…'*) fail "a command longer than the pane wraps and is never cut with an ellipsis" "$got" ;;
  *)
    total=$(printf '%s' "$got" | tr -cd 'z' | wc -c | tr -d ' ')
    wide=$(printf '%s\n' "$got" | awk 'length > 160 {n++} END {print n+0}')
    if [ "$total" -eq 200 ] && [ "$wide" -eq 0 ] && [ "$(printf '%s\n' "$got" | wc -l | tr -d ' ')" -ge 2 ]; then
      ok "a command longer than the pane wraps and is never cut with an ellipsis"
    else
      fail "a command longer than the pane wraps and is never cut with an ellipsis" \
        "z's shown: $total (want 200), lines over 160: $wide — got: $got"
    fi ;;
esac
# Recorded Muse Code stream (shapes from a coachman's --json events): a bash command inside
# tool.result text, a multi-line message in run.output.delta, a read_file path, and the result.
cat > "$tmp/muse.jsonl" <<'EOF'
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"run.model.configured","payload":{"model_id":"muse-spark-1.3-contributor","source":"startup"}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"bash","outcome":"success"},"text":"{\n  \"chunk_id\": \"exec-1-1\",\n  \"command\": \"ls -la .worktrees/1 && git -C .worktrees/1 status --short\",\n  \"description\": \"Inspect the tree\",\n  \"exit_code\": 0,\n  \"output\": \"total 0\\n\"\n}"}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"run.output.delta","payload":{"text":"The tree is clean.\nOne file is modified."}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"run.output.delta","payload":{"text":" Continuing."}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"read_file","outcome":"success"},"text":"Read text file `proof.txt`.\n1|PELICAN\n"}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"edit_file","outcome":"success"},"edit_facts":{"path":"notes.md","added":2,"removed":0},"text":"edited\n"}}
{"stream":{"kind":"session","id":"01a0e5a3"},"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"Continuing. Done."}}
EOF
got=$(view < "$tmp/muse.jsonl")
want=$(printf '%s\n' \
  'session 01a0e5a3 · muse-spark-1.3-contributor' \
  'bash: ls -la .worktrees/1 && git -C .worktrees/1 status --short' \
  'says: The tree is clean.' \
  'One file is modified. Continuing.' \
  'read_file: proof.txt' \
  'edit_file: notes.md' \
  'result: completed · Continuing. Done.')
[ "$got" = "$want" ] && ok "a recorded Muse Code stream shows its command and its message" \
  || fail "a recorded Muse Code stream shows its command and its message" "wanted:"$'\n'"$want"$'\n'"got:"$'\n'"$got"
case $got in *'total 0'*|*'PELICAN'*) fail "tool output stays out of a Muse pane" "$got" ;;
  *) ok "tool output stays out of a Muse pane" ;; esac

echo "negative controls: noise renders nothing"
silent "claude: a hook event" '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}'
silent "claude: thinking" '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}'
silent "claude: a tool result that succeeded" '{"type":"user","message":{"content":[{"type":"tool_result","content":"a\nb"}]}}'
silent "claude: a rate-limit event that allowed the call" '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}'
silent "codex: reasoning" '{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}'
silent "pi: a streaming delta" '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Al"}}'
silent "muse: a task's lifecycle record" '{"stream":{"kind":"session","id":"s1"},"payload_type":"task.lifecycle.started","payload":{"kind":"task_lifecycle"}}'
silent "muse: a streaming delta, whose text the result carries" '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.output.delta","payload":{"text":"DO"}}'
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
