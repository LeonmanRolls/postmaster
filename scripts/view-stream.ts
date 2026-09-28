// Show a harness's event stream readably: one line per event of interest, never raw JSON. This is
// what a session host's pane shows while a launch runs (scripts/host.sh). Event formats are
// harness-specific, so this script belongs to the harness adapter beside launch.sh, and
// harnesses.md says which harness's events it knows.
//
//   view-stream.sh < <events-file>                           render a stream, then stop
//   view-stream.sh --follow <file> --pid <pid> [--from <byte>] render the file as it grows,
//                                                           and stop once <pid> has exited
//                                                           and everything it wrote is shown
//   view-stream.sh --self-test
//
// Each event of interest is one line: a session starting, with its thread id; a tool call, with
// what it was called on; what the model said; an error; the result. Tool output, thinking,
// hooks and streaming deltas are left out. A JSON event it does not know is shown by its type,
// once per run of the same type, so an unknown harness still reads as a sequence of steps. A
// line that is not JSON is shown as it is, less any control characters, which never reach the
// terminal from a stream. Following, each line carries the local time.
//
//   exit 0  rendered
//   exit 1  usage, or the self-test failed

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

// --- the renderer (ported from the embedded Python) ---------------------------------------
interface Ev {
  [key: string]: unknown;
}

const QUIET = new Set([
  // claude
  "stream_event",
  // codex
  "turn.started",
  "item.updated",
  // pi
  "agent_start",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "tool_execution_update",
  "auto_compaction_end",
  "auto_retry_end",
]);

const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

let width = 160;

function short(s: unknown, n?: number): string {
  const str = s === null || s === undefined ? "" : String(s);
  const first = str.trim().split("\n")[0] ?? "";
  const lim = n ?? width;
  return first.length <= lim ? first : `${first.slice(0, lim - 1)}…`;
}

function toolLine(name: unknown, inp: unknown): string {
  const input = inp !== null && typeof inp === "object" && !Array.isArray(inp) ? (inp as Ev) : {};
  for (const key of [
    "command",
    "cmd",
    "file_path",
    "path",
    "pattern",
    "url",
    "query",
    "description",
    "prompt",
  ]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return `${String(name)}: ${short(v)}`;
  }
  return String(name);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b !== null && typeof b === "object")
      .map((b) => String((b as Ev).text ?? ""))
      .join(" ");
  }
  return "";
}

const mimoSessions = new Set<string>();

function muse(e: Ev): string | string[] | null {
  const pt = String(e.payload_type ?? "");
  const p = (e.payload as Ev) ?? {};
  if (pt === "run.model.configured") {
    const stream = (e.stream as Ev) ?? {};
    return `session ${stream.id} · ${p.model_id}`;
  }
  if (pt === "tool.result") {
    const facts = (p.correlation_facts as Ev) ?? {};
    const name = facts.tool_name || "tool";
    if (facts.outcome !== undefined && facts.outcome !== null && facts.outcome !== "success") {
      return `tool error: ${String(name)}`;
    }
    return toolLine(name, p.edit_facts ?? {});
  }
  if (pt.startsWith("run.terminal.")) {
    const said = String(p.text ?? "").trim();
    return `result: ${p.terminal || pt.split(".").pop()}${said ? ` · ${short(said)}` : ""}`;
  }
  return null;
}

function mimo(e: Ev): string[] | null {
  const t = e.type;
  const part = (e.part as Ev) ?? {};
  const out: string[] = [];
  const sid = e.sessionID;
  if (sid && !mimoSessions.has(String(sid))) {
    mimoSessions.add(String(sid));
    out.push(`session ${sid}`);
  }
  if (t === "text" && String(part.text ?? "").trim()) {
    out.push(`says: ${short(part.text)}`);
  } else if (t === "tool_use") {
    const state = (part.state as Ev) ?? {};
    out.push(
      state.status === "error"
        ? `tool error: ${String(part.tool)}`
        : toolLine(part.tool, state.input),
    );
  } else if (t === "step_finish" && part.reason === "stop") {
    out.push("done");
  } else if (t === "error") {
    const err = (e.error as Ev) ?? {};
    const data = (err.data as Ev) ?? {};
    out.push(`error: ${short(data.message || err.name || JSON.stringify(err))}`);
  }
  return out.length > 0 ? out : null;
}

const GENERIC = Symbol("generic");
let lastGeneric: string | null = null;

function render(e: Ev): string | string[] | null | typeof GENERIC {
  if ("payload_type" in e) return muse(e);
  if (
    "sessionID" in e &&
    ["step_start", "step_finish", "text", "tool_use", "error"].includes(String(e.type))
  ) {
    return mimo(e);
  }
  const t = e.type;
  if (typeof t === "string" && QUIET.has(t)) return null;
  // claude
  if (t === "system") {
    const st = e.subtype;
    if (st === "init") return `session ${e.session_id} · ${e.model}`;
    if (st === "compact_boundary") return "context compacted";
    return null;
  }
  if ((t === "assistant" || t === "user") && typeof e.message === "object" && e.message !== null) {
    const msg = e.message as Ev;
    const lines: string[] = [];
    for (const b of (msg.content as unknown[]) ?? []) {
      if (b === null || typeof b !== "object") continue;
      const blk = b as Ev;
      const k = blk.type;
      if (t === "assistant" && k === "text" && String(blk.text ?? "").trim()) {
        lines.push(`says: ${short(blk.text)}`);
      } else if (t === "assistant" && k === "tool_use") {
        lines.push(toolLine(blk.name, blk.input));
      } else if (t === "user" && k === "tool_result" && blk.is_error) {
        lines.push(`tool error: ${short(textOf(blk.content))}`);
      }
    }
    return lines.length > 0 ? lines.join(" | ") : null;
  }
  if (t === "result") {
    const parts: string[] = [String(e.subtype || e.status || (e.is_error ? "error" : "done"))];
    if (typeof e.num_turns === "number") parts.push(`${e.num_turns} turns`);
    if (typeof e.total_cost_usd === "number") {
      parts.push(`$${(e.total_cost_usd as number).toFixed(2)}`);
    }
    if (e.result) parts.push(short(e.result, 100));
    return `result: ${parts.join(" · ")}`;
  }
  if (t === "rate_limit_event") {
    const info = (e.rate_limit_info as Ev) ?? {};
    const status = info.status;
    return status === undefined || status === null || status === "allowed"
      ? null
      : `rate limit: ${String(status)}`;
  }
  // codex
  if (t === "thread.started") return `session ${e.thread_id}`;
  if (t === "item.started" || t === "item.completed") {
    const it = (e.item as Ev) ?? {};
    const k = it.type;
    if (t === "item.started") {
      return k === "command_execution" ? `shell: ${short(it.command)}` : null;
    }
    if (k === "agent_message") return `says: ${short(it.text)}`;
    if (k === "command_execution") {
      const code = it.exit_code;
      return code === 0 || code === undefined || code === null
        ? null
        : `shell exit ${String(code)}: ${short(it.command)}`;
    }
    if (k === "file_change") {
      return (
        "edit: " +
        ((it.changes as unknown[]) ?? [])
          .filter((c) => c !== null && typeof c === "object")
          .map((c) => String((c as Ev).path))
          .join(", ")
      );
    }
    if (k === "mcp_tool_call") return `tool: ${it.server}.${it.tool}`;
    if (k === "web_search") return `search: ${short(it.query)}`;
    if (k === "error") return `error: ${short(it.message)}`;
    return null;
  }
  if (t === "turn.completed") {
    const u = (e.usage as Ev) ?? {};
    return `turn done · ${u.input_tokens ?? "?"} tokens in, ${u.output_tokens ?? "?"} out`;
  }
  if (t === "turn.failed") {
    const err = (e.error as Ev) ?? {};
    return `turn failed: ${short(err.message)}`;
  }
  if (t === "error") return `error: ${short(e.message ?? JSON.stringify(e))}`;
  // pi
  if (t === "session") return `session ${e.id}`;
  if (t === "tool_execution_start") return toolLine(e.toolName, e.args);
  if (t === "tool_execution_end") {
    return e.isError ? `tool error: ${String(e.toolName)}` : null;
  }
  if (t === "message_end") {
    const m = (e.message as Ev) ?? {};
    if (m.role !== "assistant") return null;
    const said = textOf(
      ((m.content as unknown[]) ?? []).filter(
        (b) => b !== null && typeof b === "object" && (b as Ev).type === "text",
      ),
    );
    return said.trim() ? `says: ${short(said)}` : null;
  }
  if (t === "agent_end") return "done";
  if (t === "auto_retry_start") return `retrying: ${short(e.errorMessage ?? "")}`;
  if (t === "auto_compaction_start") return "compacting context";
  return GENERIC;
}

function generic(e: Ev): string | null {
  const t = String(e.type ?? e.event ?? "event");
  if (t === lastGeneric) return null;
  lastGeneric = t;
  for (const key of ["text", "message", "content", "result", "name", "tool_name", "command"]) {
    const v = e[key];
    if (typeof v === "string" && v.trim()) return `${t}: ${short(v)}`;
  }
  return t;
}

function show(line: string, stamp: boolean): void {
  const raw = line.replace(/[\r\n]+$/, "");
  if (!raw.trim()) return;
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    e = null;
  }
  let out: string | string[] | null;
  if (e !== null && typeof e === "object" && !Array.isArray(e)) {
    const rendered = render(e as Ev);
    if (rendered === GENERIC) {
      out = generic(e as Ev);
    } else {
      lastGeneric = null;
      out = rendered;
    }
  } else {
    out = short(raw);
  }
  const items = Array.isArray(out) ? out : out ? [out] : [];
  for (const one of items) {
    console.log(
      (stamp ? `${new Date().toTimeString().slice(0, 8)} ` : "") + one.replace(CONTROL, ""),
    );
  }
}

function alive(p: number): boolean {
  // A zombie has exited; nothing has reaped it yet. It is not alive for follow's purposes.
  try {
    const stat = readFileSync(`/proc/${p}/stat`, "utf8");
    const state = stat.split(") ")[1]?.[0];
    if (state === "Z") return false;
  } catch {
    // no /proc entry: the process is gone
    return false;
  }
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return err.code === "EPERM";
  }
}

function view(args: string[]): number {
  let follow: string | null = null;
  let pid: number | null = null;
  let start = 0;
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === "--follow") follow = args.shift() ?? null;
    else if (a === "--pid") pid = parseInt(args.shift() ?? "", 10);
    else if (a === "--from") start = parseInt(args.shift() ?? "", 10);
    else {
      console.error(`view-stream: unknown argument: ${a}`);
      return 1;
    }
  }
  if (follow && pid === null) {
    console.error("view-stream: --follow needs --pid");
    return 1;
  }
  width = follow ? Math.max(40, (process.stdout.columns ?? 170) - 10) : 160;

  if (!follow) {
    // read stdin line by line
    const _chunks: string[] = [];
    const fd = 0;
    const buf = Buffer.alloc(65536);
    let pending = "";
    for (;;) {
      let n = 0;
      try {
        n = readSync(fd, buf, 0, buf.length, null);
      } catch {
        break;
      }
      if (n === 0) break;
      pending += buf.toString("utf8", 0, n);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) show(l, false);
    }
    if (pending) show(pending, false);
    return 0;
  }

  // follow mode
  const deadline = Date.now() + 30000;
  while (!existsSync(follow)) {
    if (!alive(pid!) || Date.now() > deadline) return 0;
    sleep(200);
  }
  const fd = openSync(follow, "r");
  try {
    // seek to start
    const stat = statSync(follow);
    let pos = Math.min(start, stat.size);
    let buf = "";
    for (;;) {
      const chunk = Buffer.alloc(65536);
      let n = 0;
      try {
        n = readSync(fd, chunk, 0, chunk.length, pos);
      } catch {
        n = 0;
      }
      if (n > 0) {
        pos += n;
        buf += chunk.toString("utf8", 0, n);
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl < 0) break;
          show(buf.slice(0, nl + 1), true);
          buf = buf.slice(nl + 1);
        }
        continue;
      }
      if (!alive(pid!)) {
        // whatever landed between the last read and the exit
        const rest = readRemaining(fd, pos);
        for (const line of (buf + rest).split("\n")) {
          if (line) show(line, true);
        }
        break;
      }
      sleep(200);
    }
  } finally {
    closeSync(fd);
  }
  return 0;
}

function readRemaining(fd: number, pos: number): string {
  const parts: Uint8Array[] = [];
  for (;;) {
    const chunk = Buffer.alloc(65536);
    let n = 0;
    try {
      n = readSync(fd, chunk, 0, chunk.length, pos);
    } catch {
      break;
    }
    if (n === 0) break;
    parts.push(chunk.subarray(0, n));
    pos += n;
  }
  return Buffer.concat(parts).toString("utf8");
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--self-test") {
  // fall through to self-test below
} else if (argv[0] === "-h" || argv[0] === "--help") {
  const selfSrc = readFileSync(join(scriptsDir(import.meta), "view-stream.ts"), "utf8");
  for (const l of selfSrc.split("\n").slice(1, 20)) console.log(l.replace(/^\/\/ ?/, ""));
  process.exit(0);
} else {
  process.exit(view(argv));
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "view-stream.sh");
withTempDir((tmp) => {
  const st = new SelfTest();
  // Reset the mimo session tracker between controls: each `shows` call is a fresh process in bash.
  const rendered = (event: string): string => {
    mimoSessions.clear();
    lastGeneric = null;
    const r = spawnSync(self, [], { input: `${event}\n`, encoding: "utf8" });
    return r.stdout.replace(/\n+$/, "");
  };
  const shows = (label: string, event: string, want: string): void => {
    const got = rendered(event);
    if (got === want) st.ok(label);
    else st.fail(label, `wanted: ${want}\ngot:    ${got}`);
  };
  const silent = (label: string, event: string): void => {
    const got = rendered(event);
    if (got === "") st.ok(label);
    else st.fail(label, `got: ${got}`);
  };

  console.log("positive controls: each event of interest is one readable line");
  shows(
    "claude: a session starts, with its thread id and model",
    '{"type":"system","subtype":"init","session_id":"a99db1c7-9178","model":"claude-haiku-4-5","tools":["Bash"]}',
    "session a99db1c7-9178 · claude-haiku-4-5",
  );
  shows(
    "claude: a tool call, with what it ran",
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -a","description":"List files"}}]}}',
    "Bash: ls -a",
  );
  shows(
    "claude: what the model said, first line only",
    '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed 3 entries.\\nMore detail."}]}}',
    "says: The command printed 3 entries.",
  );
  shows(
    "claude: a failed tool call",
    '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"No such file"}]}}',
    "tool error: No such file",
  );
  shows(
    "claude: the result, with turns and cost",
    '{"type":"result","subtype":"success","num_turns":2,"total_cost_usd":0.0060272,"result":"The command printed 3 entries."}',
    "result: success · 2 turns · $0.01 · The command printed 3 entries.",
  );
  shows(
    "codex: a session starts",
    '{"type":"thread.started","thread_id":"0199a213-81c0"}',
    "session 0199a213-81c0",
  );
  shows(
    "codex: a shell command",
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}',
    "shell: bash -lc ls",
  );
  shows(
    "codex: what the model said",
    '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Done."}}',
    "says: Done.",
  );
  shows(
    "pi: a session starts",
    '{"type":"session","version":3,"id":"01a0c7e8-5863","cwd":"/w"}',
    "session 01a0c7e8-5863",
  );
  shows(
    "pi: a tool call",
    '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"command":"ls"}}',
    "bash: ls",
  );
  shows(
    "pi: what the model said",
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}',
    "says: All done.",
  );
  shows(
    "muse: a session starts, with its thread id and model",
    '{"stream":{"kind":"session","id":"01a0e16d-17e8"},"payload_type":"run.model.configured","payload":{"model_id":"muse-spark-1.3-contributor","source":"startup"}}',
    "session 01a0e16d-17e8 · muse-spark-1.3-contributor",
  );
  shows(
    "muse: a tool call, with what it changed",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"write_file","outcome":"success"},"edit_facts":{"path":"proof.txt","added":1}}}',
    "write_file: proof.txt",
  );
  shows(
    "muse: a failed tool call",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"shell","outcome":"error"}}}',
    "tool error: shell",
  );
  shows(
    "muse: the result, with what the model said",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"DONE"}}',
    "result: completed · DONE",
  );
  shows(
    "muse: a failed run",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.failed","payload":{"terminal":"failed","text":""}}',
    "result: failed",
  );
  shows(
    "mimo: a session starts, with its thread id, and a first step says nothing more",
    '{"type":"step_start","sessionID":"ses_ffe5f1e2","part":{"type":"step-start"}}',
    "session ses_ffe5f1e2",
  );
  shows(
    "mimo: a tool call, with what it touched",
    '{"type":"tool_use","sessionID":"ses_ffe5f1e2","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"file_path":"proof.txt","content":"PELICAN"}}}}',
    "session ses_ffe5f1e2\nwrite: proof.txt",
  );
  shows(
    "mimo: what the model said",
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"DONE"}}',
    "session ses_1\nsays: DONE",
  );
  shows(
    "mimo: a failed tool call",
    '{"type":"tool_use","sessionID":"ses_1","part":{"tool":"bash","state":{"status":"error","input":{"command":"false"}}}}',
    "session ses_1\ntool error: bash",
  );
  {
    mimoSessions.clear();
    lastGeneric = null;
    const r = spawnSync(self, [], {
      input:
        '{"type":"step_start","sessionID":"ses_2","part":{}}\n{"type":"text","sessionID":"ses_2","part":{"text":"DONE"}}\n{"type":"step_finish","sessionID":"ses_2","part":{"reason":"tool-calls"}}\n{"type":"step_finish","sessionID":"ses_2","part":{"reason":"stop"}}\n',
      encoding: "utf8",
    });
    const got = r.stdout.replace(/\n+$/, "");
    if (got === "session ses_2\nsays: DONE\ndone")
      st.ok("mimo: a session is named once, and only its last step says done");
    else st.fail("mimo: a session is named once, and only its last step says done", got);
  }
  shows(
    "a line that is not JSON is shown as it is",
    "plain text from a wrapper",
    "plain text from a wrapper",
  );
  shows(
    "an unknown event shows its type",
    '{"type":"heartbeat","message":"still here"}',
    "heartbeat: still here",
  );
  shows(
    "escape sequences in what a model said never reach the terminal",
    '{"type":"assistant","message":{"content":[{"type":"text","text":"hi \\u001b]0;title\\u0007 there"}]}}',
    "says: hi ]0;title there",
  );
  shows("nor in a line that is not JSON", "plain \x1b[2Jtext\x07", "plain [2Jtext");

  console.log("negative controls: noise renders nothing");
  silent(
    "claude: a hook event",
    '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}',
  );
  silent(
    "claude: thinking",
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}',
  );
  silent(
    "claude: a tool result that succeeded",
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"a\\nb"}]}}',
  );
  silent(
    "claude: a rate-limit event that allowed the call",
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  );
  silent("codex: reasoning", '{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}');
  silent(
    "pi: a streaming delta",
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Al"}}',
  );
  silent(
    "muse: a task's lifecycle record",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"task.lifecycle.started","payload":{"kind":"task_lifecycle"}}',
  );
  silent(
    "muse: a streaming delta, whose text the result carries",
    '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.output.delta","payload":{"text":"DO"}}',
  );
  silent(
    "pi: the user's own message ending",
    '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}',
  );
  {
    mimoSessions.clear();
    lastGeneric = null;
    const input = `${Array.from({ length: 50 }, (_, i) => `{"type":"delta","n":${i + 1}}`).join("\n")}\n`;
    const r = spawnSync(self, [], { input, encoding: "utf8" });
    const got = r.stdout.replace(/\n+$/, "");
    if (got === "delta") st.ok("fifty unknown events of one type show as one line");
    else st.fail("fifty unknown events of one type show as one line", got);
  }
  {
    mimoSessions.clear();
    lastGeneric = null;
    const stream = [
      '{"type":"system","subtype":"hook_started"}',
      '{"type":"system","subtype":"init","session_id":"s1","model":"m"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/w/a.ts"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\\"json\\": true}"}]}}',
      '{"type":"result","subtype":"success","num_turns":1}',
    ].join("\n");
    const r = spawnSync(self, [], { input: `${stream}\n`, encoding: "utf8" });
    const got = r.stdout;
    if (got.includes("{")) st.fail("a whole stream renders with no raw JSON in it", got);
    else if (got.split("\n").filter((l) => l !== "").length === 3)
      st.ok("a whole stream renders with no raw JSON in it");
    else st.fail("a whole stream renders with no raw JSON in it", got);
  }

  console.log("following a file that grows");
  {
    const f = join(tmp, "events.jsonl");
    writeFileSync(f, "");
    // Orphan the writer so it is not our child: spawnSync would block reaping and leave a
    // zombie that follow would read as still running.
    const wscript = join(tmp, "writer.sh");
    writeFileSync(
      wscript,
      `#!/usr/bin/env bash
for i in 1 2 3; do
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step %d"}]}}\\n' "$i" >> "$1"
  sleep 0.3
done
printf '{"type":"result","subtype":"success"}' >> "$1"
`,
    );
    run("chmod", ["+x", wscript]);
    const wr = run("bash", ["-c", `"${wscript}" "${f}" & echo $!`]);
    const writerPid = parseInt(wr.out.trim(), 10);
    const r = spawnSync(self, ["--follow", f, "--pid", String(writerPid)], {
      encoding: "utf8",
      timeout: 30000,
    });
    const out = r.stdout;
    const n = out
      .split("\n")
      .filter((l) =>
        /^[0-9]{2}:[0-9]{2}:[0-9]{2} (says: step [123]|result: success)$/.test(l),
      ).length;
    if (n === 4) st.ok("every line is shown, with its time, and the unterminated last line too");
    else st.fail("every line is shown, with its time, and the unterminated last line too", out);
  }
  {
    const f = join(tmp, "append.jsonl");
    writeFileSync(f, "old line\n");
    const from = Buffer.byteLength("old line\n");
    const wscript2 = join(tmp, "writer2.sh");
    writeFileSync(wscript2, `#!/usr/bin/env bash\nprintf 'new line\\n' >> "$1"\n`);
    run("chmod", ["+x", wscript2]);
    const wr = run("bash", ["-c", `"${wscript2}" "${f}" & echo $!`]);
    const writerPid = parseInt(wr.out.trim(), 10);
    const r = spawnSync(self, ["--follow", f, "--pid", String(writerPid), "--from", String(from)], {
      encoding: "utf8",
      timeout: 30000,
    });
    const out = r.stdout;
    if (out.includes("old line")) st.fail("--from skips what was there before", out);
    else if (out.includes("new line")) st.ok("--from skips what was there before");
    else st.fail("--from skips what was there before", out);
  }

  st.finish();
});
