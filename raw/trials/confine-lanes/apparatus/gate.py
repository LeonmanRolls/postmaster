#!/usr/bin/env python3
"""Did the lane's own run of the gate pass? Read from its events stream.

  gate.py <harness> <events.jsonl>

Prints `pass`, `fail` or `none` for the last command the lane ran whose text holds
`npm run check`, by that command's exit status where the harness records one, and otherwise by
the status the lane echoed after it.
"""
import json, re, sys

harness, path = sys.argv[1], sys.argv[2]
verdict, pending = "none", {}
ECHOED = re.compile(r"(?:check|CHECK)[^\n=:]*[=: ]\s*(\d+)")


def by_echo(text):
    m = ECHOED.findall(text or "")
    return None if not m else ("pass" if m[-1] == "0" else "fail")


for line in open(path, errors="replace"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if harness == "codex" and e.get("type") == "item.completed" and e["item"].get("type") == "command_execution":
        if "npm run check" in e["item"].get("command", ""):
            verdict = "pass" if e["item"].get("exit_code") == 0 else "fail"
    elif harness == "claude":
        if e.get("type") == "assistant":
            for c in e["message"].get("content", []):
                if c.get("type") == "tool_use" and "npm run check" in json.dumps(c.get("input", {})):
                    pending[c["id"]] = True
        elif e.get("type") == "user" and isinstance(e["message"].get("content"), list):
            for c in e["message"]["content"]:
                if c.get("type") == "tool_result" and pending.pop(c.get("tool_use_id"), False):
                    out = c.get("content")
                    if isinstance(out, list):
                        out = " ".join(x.get("text", "") for x in out if isinstance(x, dict))
                    verdict = "fail" if c.get("is_error") else (by_echo(out) or verdict)
    elif harness == "mimo" and e.get("type") == "tool_use":
        st = e["part"].get("state", {})
        if "npm run check" in json.dumps(st.get("input", {})):
            code = (st.get("metadata") or {}).get("exit")
            verdict = by_echo(st.get("output")) or ("pass" if code == 0 else "fail")
    elif harness == "muse" and e.get("payload_type") == "tool.result":
        try:
            t = json.loads((e.get("payload") or {}).get("text") or "")
        except ValueError:
            continue
        if isinstance(t, dict) and "npm run check" in t.get("command", ""):
            verdict = by_echo(t.get("output")) or ("pass" if t.get("exit_code") == 0 else "fail")
    elif harness == "pi" and e.get("type") == "tool_execution_end":
        r = e.get("result") or {}
        out = " ".join(c.get("text", "") for c in (r.get("content") or []) if isinstance(c, dict))
        m = re.search(r"npm run check exit (\d+)", out)
        if m:
            verdict = "pass" if m.group(1) == "0" else "fail"
print(verdict)
