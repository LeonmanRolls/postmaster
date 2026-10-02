#!/usr/bin/env python3
"""A stand-in for an OpenAI-compatible provider that issues a fixed list of tool calls.

  stub.py <port> <trial-root> <lane-name> <log-file> <steps.json>

<steps.json> is a list of [tool, {arguments}], with @ROOT@ and @LANE@ filled in. Each request is
answered with the next step, chosen by how many tool results the conversation already holds,
and after the last step with a short text that ends the turn. Every request body is appended to
<log-file>, one JSON line each, and the stub exits once it has ended the turn. No model is involved: the harness's own tools carry out the
steps, so what a confinement stops is shown at no model cost and the same way every time.
"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

port, root, lane, log, steps = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
STEPS = json.loads(open(steps).read().replace("@ROOT@", root).replace("@LANE@", lane))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        with open(log, "a") as f:
            f.write(json.dumps(body) + "\n")
        done = sum(1 for m in body.get("messages", []) if m.get("role") == "tool")
        names = {t.get("function", {}).get("name") for t in body.get("tools", [])}
        if done < len(STEPS) and STEPS[done][0] in names:
            name, args = STEPS[done]
            delta = {"role": "assistant", "content": None, "tool_calls": [{"index": 0, "id": "call_%d" % done,
                     "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
            finish = "tool_calls"
        else:
            delta = {"role": "assistant", "content": "Done: %d of %d steps issued." % (done, len(STEPS))}
            finish = "stop"
        chunks = [
            {"id": "stub", "object": "chat.completion.chunk", "created": 0, "model": "stub",
             "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
            {"id": "stub", "object": "chat.completion.chunk", "created": 0, "model": "stub",
             "choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
             "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}},
        ]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for c in chunks:
            self.wfile.write(b"data: " + json.dumps(c).encode() + b"\n\n")
        self.wfile.write(b"data: [DONE]\n\n")
        if finish == "stop":
            threading.Timer(2.0, server.shutdown).start()


server = HTTPServer(("127.0.0.1", port), Handler)
server.serve_forever()
