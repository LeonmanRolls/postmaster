import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const wrapper = join(here, "view-stream.sh");
const generic = Symbol("generic");
type Event = Record<string, any>;
type Display = string | string[] | null | typeof generic;
type State = { mimoSessions: Set<string>; lastGeneric: string | null; width: number };
const quiet = new Set([
  "stream_event",
  "turn.started",
  "item.updated",
  "agent_start",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "tool_execution_update",
  "auto_compaction_end",
  "auto_retry_end",
]);
function cleanControls(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code > 31 && (code < 127 || code > 159);
    })
    .join("");
}
function short(value: unknown, width: number): string {
  const text = value === null || value === undefined ? "" : (String(value).trim().split(/\r?\n/)[0] ?? "");
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}
function toolLine(name: unknown, input: unknown, width: number): string {
  const data = input && typeof input === "object" && !Array.isArray(input) ? (input as Event) : {};
  for (const key of ["command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return `${String(name)}: ${short(value, width)}`;
  }
  return String(name);
}
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => (part && typeof part === "object" ? ((part as Event).text ?? "") : "")).join(" ");
  return "";
}
function render(event: Event, state: State): Display {
  if ("payload_type" in event) {
    const kind = String(event.payload_type);
    const payload = event.payload || {};
    if (kind === "run.model.configured") return `session ${event.stream?.id} · ${payload.model_id}`;
    if (kind === "tool.result") {
      const facts = payload.correlation_facts || {};
      const name = facts.tool_name || "tool";
      if (facts.outcome !== undefined && facts.outcome !== "success") return `tool error: ${name}`;
      return toolLine(name, payload.edit_facts || {}, state.width);
    }
    if (kind.startsWith("run.terminal.")) {
      const said = String(payload.text || "").trim();
      return `result: ${payload.terminal || kind.split(".").at(-1)}${said ? ` · ${short(said, state.width)}` : ""}`;
    }
    return null;
  }
  if (event.sessionID && ["step_start", "step_finish", "text", "tool_use", "error"].includes(event.type)) {
    const out: string[] = [];
    const sid = String(event.sessionID);
    if (!state.mimoSessions.has(sid)) {
      state.mimoSessions.add(sid);
      out.push(`session ${sid}`);
    }
    const part = event.part || {};
    if (event.type === "text" && String(part.text ?? "").trim()) out.push(`says: ${short(part.text, state.width)}`);
    else if (event.type === "tool_use") {
      const input = part.state?.input;
      out.push(part.state?.status === "error" ? `tool error: ${part.tool}` : toolLine(part.tool, input, state.width));
    } else if (event.type === "step_finish" && part.reason === "stop") out.push("done");
    else if (event.type === "error") {
      const error = event.error || {};
      out.push(`error: ${short(error.data?.message || error.name || JSON.stringify(error), state.width)}`);
    }
    return out.length ? out : null;
  }
  const type = event.type;
  if (quiet.has(type)) return null;
  if (type === "system") {
    if (event.subtype === "init") return `session ${event.session_id} · ${event.model}`;
    if (event.subtype === "compact_boundary") return "context compacted";
    return null;
  }
  if ((type === "assistant" || type === "user") && event.message && typeof event.message === "object") {
    const output: string[] = [];
    for (const block of event.message.content || []) {
      if (!block || typeof block !== "object") continue;
      if (type === "assistant" && block.type === "text" && String(block.text ?? "").trim())
        output.push(`says: ${short(block.text, state.width)}`);
      else if (type === "assistant" && block.type === "tool_use")
        output.push(toolLine(block.name, block.input, state.width));
      else if (type === "user" && block.type === "tool_result" && block.is_error)
        output.push(`tool error: ${short(textOf(block.content), state.width)}`);
    }
    return output.length ? output.join(" | ") : null;
  }
  if (type === "result") {
    const parts = [event.subtype || event.status || (event.is_error ? "error" : "done")];
    if (Number.isInteger(event.num_turns)) parts.push(`${event.num_turns} turns`);
    if (typeof event.total_cost_usd === "number") parts.push(`$${event.total_cost_usd.toFixed(2)}`);
    if (event.result) parts.push(short(event.result, 100));
    return `result: ${parts.join(" · ")}`;
  }
  if (type === "rate_limit_event") {
    const status = event.rate_limit_info?.status;
    return status === undefined || status === "allowed" ? null : `rate limit: ${status}`;
  }
  if (type === "thread.started") return `session ${event.thread_id}`;
  if (type === "item.started" || type === "item.completed") {
    const item = event.item || {};
    const kind = item.type;
    if (type === "item.started")
      return kind === "command_execution" ? `shell: ${short(item.command, state.width)}` : null;
    if (kind === "agent_message") return `says: ${short(item.text, state.width)}`;
    if (kind === "command_execution")
      return item.exit_code === 0 || item.exit_code == null
        ? null
        : `shell exit ${item.exit_code}: ${short(item.command, state.width)}`;
    if (kind === "file_change")
      return `edit: ${(item.changes || [])
        .filter((change: unknown) => change && typeof change === "object")
        .map((change: Event) => String(change.path))
        .join(", ")}`;
    if (kind === "mcp_tool_call") return `tool: ${item.server}.${item.tool}`;
    if (kind === "web_search") return `search: ${short(item.query, state.width)}`;
    if (kind === "error") return `error: ${short(item.message, state.width)}`;
    return null;
  }
  if (type === "turn.completed") {
    const usage = event.usage || {};
    return `turn done · ${usage.input_tokens ?? "?"} tokens in, ${usage.output_tokens ?? "?"} out`;
  }
  if (type === "turn.failed") return `turn failed: ${short(event.error?.message, state.width)}`;
  if (type === "error") return `error: ${short(event.message || JSON.stringify(event), state.width)}`;
  if (type === "session") return `session ${event.id}`;
  if (type === "tool_execution_start") return toolLine(event.toolName, event.args, state.width);
  if (type === "tool_execution_end") return event.isError ? `tool error: ${event.toolName}` : null;
  if (type === "message_end") {
    const message = event.message || {};
    if (message.role !== "assistant") return null;
    const said = textOf(
      (message.content || []).filter(
        (block: unknown) => block && typeof block === "object" && (block as Event).type === "text",
      ),
    );
    return said.trim() ? `says: ${short(said, state.width)}` : null;
  }
  if (type === "agent_end") return "done";
  if (type === "auto_retry_start") return `retrying: ${short(event.errorMessage || "", state.width)}`;
  if (type === "auto_compaction_start") return "compacting context";
  return generic;
}
function makeState(following: boolean): State {
  const columns = process.stdout.columns ?? 170;
  return { mimoSessions: new Set(), lastGeneric: null, width: following ? Math.max(40, columns - 10) : 160 };
}
function genericLine(event: Event, state: State): string | null {
  const type = String(event.type || event.event || "event");
  if (type === state.lastGeneric) return null;
  state.lastGeneric = type;
  for (const key of ["text", "message", "content", "result", "name", "tool_name", "command"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return `${type}: ${short(value, state.width)}`;
  }
  return type;
}
function clockStamp(): string {
  const now = new Date();
  return `${[now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":")} `;
}
function show(line: string, stamp: boolean, state: State): void {
  line = line.replace(/[\r\n]+$/, "");
  if (!line.trim()) return;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    event = null;
  }
  let output: Display;
  if (event && typeof event === "object" && !Array.isArray(event)) {
    output = render(event as Event, state);
    if (output === generic) output = genericLine(event as Event, state);
    else state.lastGeneric = null;
  } else output = short(line, state.width);
  for (const item of Array.isArray(output) ? output : output ? [output] : []) {
    process.stdout.write(`${(stamp ? clockStamp() : "") + cleanControls(item)}\n`);
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== "ESRCH";
  }
}
async function follow(path: string, pid: number, start: number): Promise<number> {
  const deadline = Date.now() + 30000;
  while (!existsSync(path)) {
    if (!alive(pid) || Date.now() > deadline) return 0;
    await Bun.sleep(200);
  }
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return 0;
  }
  const decoder = new TextDecoder();
  const state = makeState(true);
  let position = start;
  let pending = "";
  try {
    while (true) {
      let size = 0;
      try {
        size = statSync(path).size;
      } catch {
        break;
      }
      if (size > position) {
        const length = Math.min(65536, size - position);
        const bytes = new Uint8Array(length);
        const count = readSync(fd, bytes, 0, length, position);
        position += count;
        pending += decoder.decode(bytes.subarray(0, count), { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          show(pending.slice(0, newline + 1), true, state);
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
        continue;
      }
      if (!alive(pid)) {
        pending += decoder.decode();
        if (pending) show(pending, true, state);
        break;
      }
      await Bun.sleep(200);
    }
  } finally {
    closeSync(fd);
  }
  return 0;
}
async function run(args: string[]): Promise<number> {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : 1;
  if (args[0] === "-h" || args[0] === "--help") {
    writeOut("Show a harness's event stream readably: one line per event of interest, never raw JSON.");
    writeOut("Usage: view-stream.sh < <events-file> | --follow <file> --pid <pid> [--from <byte>] | --self-test");
    return 0;
  }
  let file = "";
  let pid: number | null = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--follow" && args[i + 1]) file = args[++i]!;
    else if (args[i] === "--pid" && args[i + 1]) pid = Number(args[++i]);
    else if (args[i] === "--from" && args[i + 1]) start = Number(args[++i]);
    else {
      writeError(`view-stream: unknown argument: ${args[i]}`);
      return 1;
    }
  }
  if (file && pid === null) {
    writeError("view-stream: --follow needs --pid");
    return 1;
  }
  if (file) return follow(file, pid!, start);
  const state = makeState(false);
  const input = readFileSync(0, "utf8");
  for (const line of input.split(/(?<=\n)/)) show(line, false, state);
  return 0;
}
async function selfTest(): Promise<number> {
  const tmp = makeTemp("postmaster-view-stream-");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, details = "") => {
    writeOut(`  FAIL ${label}`);
    if (details) for (const line of details.split("\n")) writeOut(`         ${line}`);
    failures++;
  };
  const input = (event: string) => command(wrapper, [], { input: `${event}\n` });
  const shows = (label: string, event: string, want: string) => {
    const result = input(event);
    const got = result.stdout.replace(/\n+$/, "");
    if (result.code === 0 && got === want) ok(label);
    else fail(label, `wanted: ${want}\ngot:    ${got}`);
  };
  const silent = (label: string, event: string) => {
    const result = input(event);
    if (result.code === 0 && !result.stdout) ok(label);
    else fail(label, result.stdout);
  };
  try {
    writeOut("positive controls: each event of interest is one readable line");
    shows(
      "claude: a session starts, with its thread id and model",
      '{"type":"system","subtype":"init","session_id":"a99db1c7-9178","model":"claude-haiku-4-5"}',
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
    shows("codex: a session starts", '{"type":"thread.started","thread_id":"0199a213-81c0"}', "session 0199a213-81c0");
    shows(
      "codex: a shell command",
      '{"type":"item.started","item":{"type":"command_execution","command":"bash -lc ls"}}',
      "shell: bash -lc ls",
    );
    shows(
      "codex: what the model said",
      '{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}',
      "says: Done.",
    );
    shows("pi: a session starts", '{"type":"session","id":"01a0c7e8-5863"}', "session 01a0c7e8-5863");
    shows("pi: a tool call", '{"type":"tool_execution_start","toolName":"bash","args":{"command":"ls"}}', "bash: ls");
    shows(
      "pi: what the model said",
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}',
      "says: All done.",
    );
    shows(
      "muse: a session starts, with its thread id and model",
      '{"stream":{"id":"01a0e16d-17e8"},"payload_type":"run.model.configured","payload":{"model_id":"muse-spark-1.3-contributor"}}',
      "session 01a0e16d-17e8 · muse-spark-1.3-contributor",
    );
    shows(
      "muse: a tool call, with what it changed",
      '{"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"write_file","outcome":"success"},"edit_facts":{"path":"proof.txt","added":1}}}',
      "write_file: proof.txt",
    );
    shows(
      "muse: a failed tool call",
      '{"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"shell","outcome":"error"}}}',
      "tool error: shell",
    );
    shows(
      "muse: the result, with what the model said",
      '{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"DONE"}}',
      "result: completed · DONE",
    );
    shows(
      "muse: a failed run",
      '{"payload_type":"run.terminal.failed","payload":{"terminal":"failed","text":""}}',
      "result: failed",
    );
    shows(
      "mimo: a session starts, with its thread id, and a first step says nothing more",
      '{"type":"step_start","sessionID":"ses_ffe5f1e2","part":{"type":"step-start"}}',
      "session ses_ffe5f1e2",
    );
    shows(
      "mimo: a tool call, with what it touched",
      '{"type":"tool_use","sessionID":"ses_ffe5f1e2","part":{"tool":"write","state":{"status":"completed","input":{"file_path":"proof.txt"}}}}',
      "session ses_ffe5f1e2\nwrite: proof.txt",
    );
    shows(
      "mimo: what the model said",
      '{"type":"text","sessionID":"ses_1","part":{"text":"DONE"}}',
      "session ses_1\nsays: DONE",
    );
    shows(
      "mimo: a failed tool call",
      '{"type":"tool_use","sessionID":"ses_1","part":{"tool":"bash","state":{"status":"error","input":{"command":"false"}}}}',
      "session ses_1\ntool error: bash",
    );
    const multi = [
      '{"type":"step_start","sessionID":"ses_2","part":{}}',
      '{"type":"text","sessionID":"ses_2","part":{"text":"DONE"}}',
      '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"tool-calls"}}',
      '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"stop"}}',
    ].join("\n");
    const multiResult = command(wrapper, [], { input: `${multi}\n` });
    if (multiResult.stdout.trimEnd() === "session ses_2\nsays: DONE\ndone")
      ok("mimo: a session is named once, and only its last step says done");
    else fail("mimo: a session is named once, and only its last step says done", multiResult.stdout);
    shows("a line that is not JSON is shown as it is", "plain text from a wrapper", "plain text from a wrapper");
    shows("an unknown event shows its type", '{"type":"heartbeat","message":"still here"}', "heartbeat: still here");
    shows(
      "escape sequences in what a model said never reach the terminal",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi \\u001b]0;title\\u0007 there"}]}}',
      "says: hi ]0;title there",
    );
    shows("nor in a line that is not JSON", "plain \u001b[2Jtext\u0007", "plain [2Jtext");
    writeOut("negative controls: noise renders nothing");
    silent("claude: a hook event", '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}');
    silent("claude: thinking", '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}');
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
      "muse: a task lifecycle record",
      '{"payload_type":"task.lifecycle.started","payload":{"kind":"task_lifecycle"}}',
    );
    silent(
      "muse: a streaming delta, whose text the result carries",
      '{"payload_type":"run.output.delta","payload":{"text":"DO"}}',
    );
    silent(
      "pi: the user's own message ending",
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}',
    );
    const repeated = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: "delta", n: i + 1 })).join("\n");
    const repeatResult = command(wrapper, [], { input: `${repeated}\n` });
    if (repeatResult.stdout.trimEnd() === "delta") ok("fifty unknown events of one type show as one line");
    else fail("fifty unknown events of one type show as one line", repeatResult.stdout);
    const stream = [
      '{"type":"system","subtype":"hook_started"}',
      '{"type":"system","subtype":"init","session_id":"s1","model":"m"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/w/a.ts"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\\"json\\": true}"}]}}',
      '{"type":"result","subtype":"success","num_turns":1}',
    ].join("\n");
    const streamResult = command(wrapper, [], { input: `${stream}\n` });
    if (!streamResult.stdout.includes("{") && streamResult.stdout.trimEnd().split("\n").length === 3)
      ok("a whole stream renders with no raw JSON in it");
    else fail("a whole stream renders with no raw JSON in it", streamResult.stdout);
    writeOut("following a file that grows");
    const eventFile = join(tmp, "events.jsonl");
    writeFileSync(eventFile, "");
    const eventPath = JSON.stringify(eventFile);
    const childCode =
      'const fs=await import("node:fs/promises");for(let i=1;i<=3;i++){await Bun.sleep(300);await fs.appendFile(' +
      eventPath +
      ',JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"step "+i}]}})+"\\n")}await fs.appendFile(' +
      eventPath +
      ',JSON.stringify({type:"result",subtype:"success"}))';
    const writer = Bun.spawn(["bun", "-e", childCode], { stdout: "ignore", stderr: "ignore" });
    const follower = Bun.spawn(
      ["bun", wrapper.replace(/\.sh$/, ".ts"), "--follow", eventFile, "--pid", String(writer.pid)],
      { stdout: "pipe", stderr: "pipe" },
    );
    const followedText = new Response(follower.stdout).text();
    await writer.exited;
    await follower.exited;
    const followed = await followedText;
    const found = followed
      .split(/\r?\n/)
      .filter((line) => /^\d{2}:\d{2}:\d{2} (says: step [123]|result: success)$/.test(line)).length;
    if (found === 4) ok("every line is shown, with its time, and the unterminated last line too");
    else fail("every line is shown, with its time, and the unterminated last line too", followed);
    const appendFile = join(tmp, "append.jsonl");
    writeFileSync(appendFile, "old line\n");
    const from = readFileSync(appendFile).byteLength;
    const appendCode =
      'await Bun.sleep(200);const fs=await import("node:fs/promises");await fs.appendFile(' +
      JSON.stringify(appendFile) +
      ',"new line\\n")';
    const appendChild = Bun.spawn(["bun", "-e", appendCode], { stdout: "ignore", stderr: "ignore" });
    const appendFollower = Bun.spawn(
      [
        "bun",
        wrapper.replace(/\.sh$/, ".ts"),
        "--follow",
        appendFile,
        "--pid",
        String(appendChild.pid),
        "--from",
        String(from),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const appendedText = new Response(appendFollower.stdout).text();
    await appendChild.exited;
    await appendFollower.exited;
    const appended = await appendedText;
    if (!appended.includes("old line") && appended.includes("new line")) ok("--from skips what was there before");
    else fail("--from skips what was there before", appended);
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
process.exit(await run(process.argv.slice(2)));
