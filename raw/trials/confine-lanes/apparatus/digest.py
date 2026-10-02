#!/usr/bin/env python3
"""Digest one lane's events stream: each tool call with its input and outcome, then the final
message, scrubbed for publication. No stream is kept whole.

  digest.py <harness> <events.jsonl> <trial-root> [<more text to replace>=<replacement>]...

The trial root becomes <trial>, the home directory ~, and each extra pair is replaced as given
(a host name, a plan's provider id). Output and inputs are cut to a line each.
"""
import json, os, sys

harness, path, root = sys.argv[1], sys.argv[2], sys.argv[3]
pairs = [(root, "<trial>"), (os.path.expanduser("~"), "~")]
for extra in sys.argv[4:]:
    old, _, new = extra.partition("=")
    pairs.append((old, new))


def scrub(text, width=170):
    text = " ".join(str(text).split())
    for old, new in pairs:
        text = text.replace(old, new)
    return text if len(text) <= width else text[:width - 1] + "…"


calls, final = [], ""
pending = {}
for line in open(path, errors="replace"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if harness == "codex" and e.get("type") == "item.completed":
        it = e["item"]
        if it.get("type") == "command_execution":
            calls.append(("shell", it.get("command"), "exit %s" % it.get("exit_code"), it.get("aggregated_output", "")))
        elif it.get("type") == "file_change":
            calls.append(("file_change", ", ".join(c["path"] for c in it.get("changes", [])), it.get("status"), ""))
        elif it.get("type") == "agent_message":
            final = it.get("text", "")
    elif harness == "claude":
        if e.get("type") == "assistant":
            for c in e["message"].get("content", []):
                if c.get("type") == "tool_use":
                    pending[c["id"]] = (c["name"], json.dumps(c.get("input", {})))
        elif e.get("type") == "user" and isinstance(e["message"].get("content"), list):
            for c in e["message"]["content"]:
                if c.get("type") == "tool_result":
                    name, inp = pending.pop(c.get("tool_use_id"), ("?", ""))
                    out = c.get("content")
                    if isinstance(out, list):
                        out = " ".join(x.get("text", "") for x in out if isinstance(x, dict))
                    calls.append((name, inp, "error" if c.get("is_error") else "ok", out))
        elif e.get("type") == "result":
            final = e.get("result") or ""
    elif harness == "mimo":
        if e.get("type") == "tool_use":
            st = e["part"].get("state", {})
            calls.append((e["part"].get("tool"), json.dumps(st.get("input", {})), st.get("status"),
                          st.get("output") or st.get("error") or ""))
        elif e.get("type") == "text":
            final = e["part"].get("text", "")
    elif harness == "pi":
        if e.get("type") == "tool_execution_start":
            pending[e.get("toolCallId")] = (e.get("toolName"), json.dumps(e.get("args", {})))
        elif e.get("type") == "tool_execution_end":
            name, inp = pending.pop(e.get("toolCallId"), (e.get("toolName"), ""))
            r = e.get("result") or {}
            out = " ".join(c.get("text", "") for c in (r.get("content") or []) if isinstance(c, dict))
            calls.append((name, inp, "error" if e.get("isError") else "ok", out))
        elif e.get("type") == "message_end" and (e.get("message") or {}).get("role") == "assistant":
            m = e["message"]
            final = " ".join(c.get("text", "") for c in m.get("content", []) if isinstance(c, dict) and c.get("type") == "text") \
                or m.get("errorMessage") or final
    elif harness == "muse":
        pt, p = e.get("payload_type", ""), e.get("payload") or {}
        if pt == "tool.result":
            # A shell result's text is JSON with the command, its exit and its output; a file
            # tool's is a line of prose that names the path.
            facts, text = p.get("correlation_facts") or {}, p.get("text") or ""
            try:
                t = json.loads(text)
            except ValueError:
                t = None
            if isinstance(t, dict):
                inp, out = t.get("command", ""), "exit %s: %s" % (t.get("exit_code"), t.get("output", ""))
            else:
                inp, out = "", text
            calls.append((facts.get("tool_name", "tool"), inp, facts.get("outcome", ""), out))
        elif pt.startswith("run.terminal"):
            final = p.get("text") or pt

for i, (name, inp, outcome, out) in enumerate(calls, 1):
    print("%2d %s %s -> %s | %s" % (i, name, scrub(inp, 120), outcome, scrub(out)))
print("final:", scrub(final, 600))
