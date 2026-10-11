// Show a harness's event stream readably: what an agent says and runs, in full and wrapped to the
// pane, never raw JSON. This is what a session host's pane shows while a launch runs
// (scripts/run host). Event formats are harness-specific, so this script belongs to the harness
// adapter beside run launch, and harnesses.md says which harness's events it knows.
//
//   run view-stream [<events-file>]                           render a stream (the file, else
//                                                           stdin), then stop
//   run view-stream --follow <file> --pid <pid> [--from <byte>] render the file as it grows,
//                                                           and stop once <pid> has exited
//                                                           and everything it wrote is shown
//
// Each event of interest is a block of lines: a session starting, with its thread id; a tool
// call, with what it was called on; what the model said; an error; the result. Messages and
// commands show in full, every line, wrapped to the pane and never cut short with an ellipsis.
// Tool output, thinking, hooks and raw streaming deltas are left out. A JSON event it does not
// know is shown by its type, once per run of the same type, so an unknown harness still reads as
// a sequence of steps. A line that is not JSON is shown as it is, less any control characters,
// which never reach the terminal from a stream. Following, each line carries the local time.
//
//   exit 0  rendered
//   exit 1  usage

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { processIsLive } from "./lib/processes.ts";
import { digitValue, PY_S_CLASS, pySplitLines, pyTrim } from "./lib/text.ts";

// --- the renderer (ported from the embedded Python) ---------------------------------------
/** A decoded JSON object: an event, or one of its parts. */
interface JsonObject {
  [key: string]: unknown;
}

// State that outlives one event. A viewer shows one stream per process, so this is the
// stream's memory: the pane width, the message Muse is still writing, what the model last
// said, the type of the last unknown event shown and the mimo sessions already named.
let width = 160;
let museSaid = "";
let lastSaid = ""; // the most recent shown says: text, so a restating result need not repeat it
let lastGeneric: string | null = null;
const mimoSessions = new Set<unknown>();

// --- values as Python prints them -------------------------------------------------------
/** Python str() where the viewer prints a value: None and booleans spell as Python spells them. */
function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

/** Python `str(v or "")`: a missing or false value prints as nothing. */
function strOrEmpty(value: unknown): string {
  if (typeof value === "string") return value;
  return value ? pyStr(value) : "";
}

/** A JSON object: neither null nor an array. */
function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Python `v or {}` for a payload part: a missing or false value reads as no facts. */
function asRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

/** A string with something in it besides whitespace. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && pyTrim(value) !== "";
}

const DUMP_SHORT: Record<number, string | undefined> = {
  8: "\\b",
  9: "\\t",
  10: "\\n",
  12: "\\f",
  13: "\\r",
  34: '\\"',
  92: "\\\\",
};

/** A string as json.dumps writes it: quoted, with the short escapes and \uXXXX for any code
 * unit outside printable ASCII. */
function dumpString(text: string): string {
  let quoted = '"';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const escaped = DUMP_SHORT[code];
    if (escaped !== undefined) quoted += escaped;
    else if (code < 0x20 || code > 0x7e) quoted += `\\u${code.toString(16).padStart(4, "0")}`;
    else quoted += text[i];
  }
  return `${quoted}"`;
}

/** Python json.dumps with its defaults (`, ` and `: ` separators, ensure_ascii): the fallback
 * that prints an event whose error carries no message. */
function pyDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return dumpString(value);
  if (Array.isArray(value)) return `[${value.map(pyDumps).join(", ")}]`;
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${pyDumps(key)}: ${pyDumps(item)}`,
    );
    return `{${pairs.join(", ")}}`;
  }
  return "null";
}

/** The whole cents in mantissa * 2**shift dollars, rounded half to even. */
function centsOf(mantissa: bigint, shift: number): bigint {
  const scaled = mantissa * 100n;
  let cents: bigint;
  if (shift >= 0) {
    cents = scaled << BigInt(shift);
  } else {
    const divisor = 1n << BigInt(-shift);
    const quotient = scaled / divisor;
    const remainder = scaled % divisor;
    // Past the half, or exactly on it with an odd quotient, rounds up.
    if (2n * remainder > divisor || (2n * remainder === divisor && quotient % 2n !== 0n)) {
      cents = quotient + 1n;
    } else {
      cents = quotient;
    }
  }
  return cents;
}

/** C printf "%.2f", exactly: the exact binary value rounded half to even at cents, however large.
 * toFixed looks the same until an exact half (0.125 prints 0.12) or a huge cost (never exponent). */
function fmtCost(n: number): string {
  // The double's bits: a sign, an 11-bit exponent and a 52-bit fraction.
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, n);
  const high = bits.getUint32(0);
  const low = bits.getUint32(4);
  const negative = (high & 0x80000000) !== 0;
  const exponent = (high >>> 20) & 0x7ff;
  const fraction = BigInt(high & 0xfffff) * 2n ** 32n + BigInt(low);
  // The value is mantissa * 2**shift; only a normal number has the implicit leading 1.
  const mantissa = exponent === 0 ? fraction : 2n ** 52n + fraction;
  const shift = exponent === 0 ? -1074 : exponent - 1075;
  const digits = centsOf(mantissa, shift).toString();
  const dollars = digits.length > 2 ? digits.slice(0, -2) : "0";
  const cents = digits.padStart(3, "0").slice(-2);
  return `${negative ? "-" : ""}${dollars}.${cents}`;
}

// --- facts an event names ---------------------------------------------------------------
/** The first line of a value, cut to the pane with an ellipsis. Facts such as an error message
 * are shown this way; what the model said and ran is never cut. */
function firstLine(value: unknown): string {
  if (value === null || value === undefined) return "";
  const lines = pySplitLines(pyTrim(pyStr(value)));
  const first = lines.length > 0 ? lines[0]! : "";
  const chars = [...first];
  return chars.length <= width ? first : `${chars.slice(0, width - 1).join("")}…`;
}

const TOOL_KEYS = [
  "command",
  "cmd",
  "file_path",
  "path",
  "pattern",
  "url",
  "query",
  "description",
  "prompt",
];

/** `name: input`, the input being the first of TOOL_KEYS that holds text. */
function toolLine(name: unknown, rawInput: unknown): string {
  const input = asRecord(rawInput);
  for (const key of TOOL_KEYS) {
    const value = input[key];
    if (isNonBlankString(value)) return `${pyStr(name)}: ${value}`;
  }
  return pyStr(name);
}

/** The text of a content value: a string as it is, or the text of each block of a list, one
 * per line. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block !== null && typeof block === "object")
      .map((block) => strOrEmpty((block as JsonObject).text))
      .join("\n");
  }
  return "";
}

// --- one adapter per harness ------------------------------------------------------------
// The event vocabulary. QUIET holds the event types that show nothing. MIMO_TYPES are the
// types by which an event that carries a sessionID is known as mimo's. GENERIC stands for an
// event that no adapter knows, so that it is shown by its type.
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

const MIMO_TYPES = ["step_start", "step_finish", "text", "tool_use", "error"];

const GENERIC = Symbol("generic");

/** What rendering one event gives: its lines, nothing, or GENERIC when no adapter knows it. */
type Rendered = string | string[] | null | typeof GENERIC;

const LSTRIP_RE = new RegExp(`^[${PY_S_CLASS}]+`, "u");
const READ_FILE_RE = /^Read text file `([^`]+)`/u;

const RESULT_JSON_KEYS = ["command", "cmd", "file_path", "path"];

/** The command or the path that a result's JSON object names: the first of RESULT_JSON_KEYS
 * that holds text, filed under the slot a tool call prints it from. */
function namedInput(blob: JsonObject): { slot: "command" | "path"; value: string } | null {
  for (const key of RESULT_JSON_KEYS) {
    const value = blob[key];
    if (isNonBlankString(value)) {
      return { slot: key === "command" || key === "cmd" ? "command" : "path", value };
    }
  }
  return null;
}

/** The JSON object that `text` holds; no facts when it holds none. */
function parseJsonObject(text: string): JsonObject {
  let blob: unknown = null;
  try {
    blob = JSON.parse(text);
  } catch {
    blob = null;
  }
  return asRecord(blob);
}

function museToolInput(payload: JsonObject): Record<string, string> {
  // What a Muse tool.result names as its input. edit_facts carries the path of a write or
  // edit. A bash result's text is a JSON object whose "command" is what ran; a read_file
  // result's text opens with "Read text file `path`". The rest of that text is tool output
  // and never reaches the pane.
  const input: Record<string, string> = {};
  const editFacts = asRecord(payload.edit_facts);
  for (const key of TOOL_KEYS) {
    const value = editFacts[key];
    if (isNonBlankString(value)) input[key] = value;
  }
  const text = payload.text;
  if (typeof text === "string") {
    const body = text.replace(LSTRIP_RE, "");
    if (body.startsWith("{")) {
      const named = namedInput(parseJsonObject(body));
      if (named !== null) input[named.slot] ??= named.value;
    } else {
      const match = READ_FILE_RE.exec(body);
      if (match?.[1]) input.path ??= match[1];
    }
  }
  return input;
}

/** The line a Muse tool.result shows: the tool and its input, marked when it failed. */
function museToolLine(payload: JsonObject): string {
  const facts = asRecord(payload.correlation_facts);
  const name = facts.tool_name ? pyStr(facts.tool_name) : "tool";
  const line = toolLine(name, museToolInput(payload));
  return (facts.outcome ?? "success") === "success" ? line : `tool error: ${line}`;
}

function muse(event: JsonObject): string[] | null {
  // muse (muse exec --json): each record names its payload_type, and its stream is the session
  const payloadType = pyStr(event.payload_type);
  const payload = asRecord(event.payload);
  if (payloadType === "run.output.delta") {
    museSaid += strOrEmpty(payload.text);
    return null;
  }
  if (payloadType.startsWith("run.terminal.")) {
    museSaid = ""; // the result line carries this text
    const said = pyTrim(strOrEmpty(payload.text));
    const terminal = payload.terminal
      ? pyStr(payload.terminal)
      : (payloadType.split(".").pop() ?? payloadType);
    return [`result: ${terminal}${said ? ` · ${said}` : ""}`];
  }
  const lines: string[] = [];
  const endsMessage = payloadType === "run.model.configured" || payloadType === "tool.result";
  if (endsMessage && pyTrim(museSaid) !== "") {
    // A tool call ends the message: flush what the model said since the last one. Task
    // lifecycle and bookkeeping never flush, so noise between deltas cannot split a message.
    lines.push(`says: ${pyTrim(museSaid)}`);
    museSaid = "";
  }
  if (payloadType === "run.model.configured") {
    lines.push(`session ${pyStr(asRecord(event.stream).id)} · ${pyStr(payload.model_id)}`);
  } else if (payloadType === "tool.result") {
    lines.push(museToolLine(payload));
  }
  // else: task lifecycle and bookkeeping are not pane output
  return lines.length > 0 ? lines : null;
}

function mimo(event: JsonObject): string[] | null {
  // mimo (mimo run --format json): every event carries its sessionID and a part
  const type = event.type;
  const part = asRecord(event.part);
  const lines: string[] = [];
  const sessionId = event.sessionID;
  if (sessionId && !mimoSessions.has(sessionId)) {
    mimoSessions.add(sessionId);
    lines.push(`session ${pyStr(sessionId)}`);
  }
  if (type === "text" && pyTrim(strOrEmpty(part.text)) !== "") {
    lines.push(`says: ${strOrEmpty(part.text)}`);
  } else if (type === "tool_use") {
    const state = asRecord(part.state);
    lines.push(
      state.status === "error"
        ? `tool error: ${pyStr(part.tool)}`
        : toolLine(part.tool, state.input),
    );
  } else if (type === "step_finish" && part.reason === "stop") {
    lines.push("done");
  } else if (type === "error") {
    const error = asRecord(event.error);
    lines.push(`error: ${firstLine(asRecord(error.data).message || error.name || pyDumps(error))}`);
  }
  return lines.length > 0 ? lines : null;
}

// claude (claude -p --output-format stream-json)

function claudeSystem(event: JsonObject): string | null {
  const subtype = event.subtype;
  if (subtype === "init") return `session ${pyStr(event.session_id)} · ${pyStr(event.model)}`;
  if (subtype === "compact_boundary") return "context compacted";
  return null;
}

/** What an assistant message says and runs, and the tool calls a user message reports failed.
 * Thinking and tool results that succeeded are left out. */
function claudeMessage(role: "assistant" | "user", message: JsonObject): string[] | null {
  const lines: string[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  for (const entry of content) {
    if (entry === null || typeof entry !== "object") continue;
    const block = entry as JsonObject;
    const kind = block.type;
    if (role === "assistant" && kind === "text" && pyTrim(strOrEmpty(block.text)) !== "") {
      const said = strOrEmpty(block.text);
      lines.push(`says: ${said}`);
      lastSaid = pyTrim(said);
    } else if (role === "assistant" && kind === "tool_use") {
      lines.push(toolLine(block.name, block.input));
    } else if (role === "user" && kind === "tool_result" && block.is_error) {
      lines.push(`tool error: ${firstLine(contentText(block.content))}`);
    }
  }
  return lines.length > 0 ? lines : null;
}

/** The result line: how the run ended, then its turns, its cost and what it says. */
function claudeResult(event: JsonObject): string {
  const parts: string[] = [
    pyStr(event.subtype || event.status || (event.is_error ? "error" : "done")),
  ];
  const turns = event.num_turns;
  if (typeof turns === "number" && Number.isInteger(turns)) parts.push(`${turns} turns`);
  else if (typeof turns === "boolean") parts.push(`${turns ? 1 : 0} turns`);
  const cost = event.total_cost_usd;
  const dollars = typeof cost === "boolean" ? (cost ? 1 : 0) : cost;
  if (typeof dollars === "number") parts.push(`$${fmtCost(dollars)}`);
  if (event.result) {
    const result = pyStr(event.result);
    if (pyTrim(result) !== lastSaid) parts.push(result); // a restating result need not repeat it
  }
  return `result: ${parts.join(" · ")}`;
}

// codex (codex exec --json)

function codexItemStarted(item: JsonObject): string | null {
  if (item.type !== "command_execution") return null;
  const command = strOrEmpty(item.command);
  return pyTrim(command) !== "" ? `shell: ${command}` : null;
}

function codexItemCompleted(item: JsonObject): string | null {
  switch (item.type) {
    case "agent_message": {
      const said = strOrEmpty(item.text);
      return pyTrim(said) !== "" ? `says: ${said}` : null;
    }
    case "command_execution": {
      const exitCode = item.exit_code;
      const succeeded = exitCode === 0 || exitCode === false;
      const missing = exitCode === null || exitCode === undefined;
      return succeeded || missing
        ? null
        : `shell exit ${pyStr(exitCode)}: ${strOrEmpty(item.command)}`;
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .filter(isRecord)
        .map((change) => strOrEmpty(change.path))
        .filter((path) => pyTrim(path) !== "");
      return paths.length > 0 ? `edit: ${paths.join(", ")}` : null;
    }
    case "mcp_tool_call":
      return `tool: ${pyStr(item.server)}.${pyStr(item.tool)}`;
    case "web_search":
      return `search: ${firstLine(item.query)}`;
    case "error":
      return `error: ${firstLine(item.message)}`;
    default:
      return null;
  }
}

function codexTurnCompleted(event: JsonObject): string {
  const usage = asRecord(event.usage);
  const tokensIn = "input_tokens" in usage ? pyStr(usage.input_tokens) : "?";
  const tokensOut = "output_tokens" in usage ? pyStr(usage.output_tokens) : "?";
  return `turn done · ${tokensIn} tokens in, ${tokensOut} out`;
}

// pi (pi --mode json)

/** What the model said when an assistant message ends. */
function piMessageEnd(event: JsonObject): string | null {
  const message = asRecord(event.message);
  if (message.role !== "assistant") return null;
  const content = Array.isArray(message.content) ? message.content : [];
  const said = contentText(
    content.filter(
      (block) =>
        block !== null && typeof block === "object" && (block as JsonObject).type === "text",
    ),
  );
  return pyTrim(said) !== "" ? `says: ${said}` : null;
}

/** The lines one event shows, by the harness whose event it is. */
function render(event: JsonObject): Rendered {
  if ("payload_type" in event) return muse(event);
  if ("sessionID" in event && MIMO_TYPES.includes(event.type as string)) {
    return mimo(event);
  }
  const type = event.type;
  if (typeof type === "string" && QUIET.has(type)) return null;
  switch (type) {
    // claude
    case "system":
      return claudeSystem(event);
    case "assistant":
    case "user":
      return isRecord(event.message) ? claudeMessage(type, event.message) : GENERIC;
    case "result":
      return claudeResult(event);
    case "rate_limit_event": {
      const status = asRecord(event.rate_limit_info).status;
      return (status ?? "allowed") === "allowed" ? null : `rate limit: ${pyStr(status)}`;
    }
    // codex
    case "thread.started":
      return `session ${pyStr(event.thread_id)}`;
    case "item.started":
      return codexItemStarted(asRecord(event.item));
    case "item.completed":
      return codexItemCompleted(asRecord(event.item));
    case "turn.completed":
      return codexTurnCompleted(event);
    case "turn.failed":
      return `turn failed: ${firstLine(asRecord(event.error).message)}`;
    case "error":
      return `error: ${firstLine(event.message || pyDumps(event))}`;
    // pi
    case "session":
      return `session ${pyStr(event.id)}`;
    case "tool_execution_start":
      return toolLine(event.toolName, event.args);
    case "tool_execution_end":
      return event.isError ? `tool error: ${pyStr(event.toolName)}` : null;
    case "message_end":
      return piMessageEnd(event);
    case "agent_end":
      return "done";
    case "auto_retry_start":
      return `retrying: ${firstLine(strOrEmpty(event.errorMessage))}`;
    case "auto_compaction_start":
      return "compacting context";
    default:
      return GENERIC;
  }
}

const UNKNOWN_TEXT_KEYS = ["text", "message", "content", "result", "name", "tool_name", "command"];

/** An event no adapter knows, shown by its type and the first text it holds, once per run of
 * the same type, so an unknown harness still reads as a sequence of steps. */
function generic(event: JsonObject): string | null {
  const type = pyStr(event.type || event.event || "event");
  if (type === lastGeneric) return null;
  lastGeneric = type;
  for (const key of UNKNOWN_TEXT_KEYS) {
    const value = event[key];
    if (isNonBlankString(value)) return `${type}: ${firstLine(value)}`;
  }
  return type;
}

// --- fitting text to the pane -----------------------------------------------------------
// Preserve line breaks, strip terminal controls.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu;

function visibleText(s: string): string {
  return s.replace(/\r\n/gu, "\n").replace(/\r/gu, "").replace(/\t/gu, "    ").replace(CONTROL, "");
}

// Terminal cells, as unicodedata counts them: combining() != 0 takes none, east_asian_width W
// or F takes two. Generated from python3 unicodedata 15.0.0; regen by ranging 0..0x10FFFF over
// both predicates and merging runs. Note U+093E and friends are combining class 0 and take a
// cell, so a mark class is not the predicate: these ranges are.
const COMBINING: Array<readonly [number, number]> = [
  [0x300, 0x34e],
  [0x350, 0x36f],
  [0x483, 0x487],
  [0x591, 0x5bd],
  [0x5bf, 0x5bf],
  [0x5c1, 0x5c2],
  [0x5c4, 0x5c5],
  [0x5c7, 0x5c7],
  [0x610, 0x61a],
  [0x64b, 0x65f],
  [0x670, 0x670],
  [0x6d6, 0x6dc],
  [0x6df, 0x6e4],
  [0x6e7, 0x6e8],
  [0x6ea, 0x6ed],
  [0x711, 0x711],
  [0x730, 0x74a],
  [0x7eb, 0x7f3],
  [0x7fd, 0x7fd],
  [0x816, 0x819],
  [0x81b, 0x823],
  [0x825, 0x827],
  [0x829, 0x82d],
  [0x859, 0x85b],
  [0x898, 0x89f],
  [0x8ca, 0x8e1],
  [0x8e3, 0x8ff],
  [0x93c, 0x93c],
  [0x94d, 0x94d],
  [0x951, 0x954],
  [0x9bc, 0x9bc],
  [0x9cd, 0x9cd],
  [0x9fe, 0x9fe],
  [0xa3c, 0xa3c],
  [0xa4d, 0xa4d],
  [0xabc, 0xabc],
  [0xacd, 0xacd],
  [0xb3c, 0xb3c],
  [0xb4d, 0xb4d],
  [0xbcd, 0xbcd],
  [0xc3c, 0xc3c],
  [0xc4d, 0xc4d],
  [0xc55, 0xc56],
  [0xcbc, 0xcbc],
  [0xccd, 0xccd],
  [0xd3b, 0xd3c],
  [0xd4d, 0xd4d],
  [0xdca, 0xdca],
  [0xe38, 0xe3a],
  [0xe48, 0xe4b],
  [0xeb8, 0xeba],
  [0xec8, 0xecb],
  [0xf18, 0xf19],
  [0xf35, 0xf35],
  [0xf37, 0xf37],
  [0xf39, 0xf39],
  [0xf71, 0xf72],
  [0xf74, 0xf74],
  [0xf7a, 0xf7d],
  [0xf80, 0xf80],
  [0xf82, 0xf84],
  [0xf86, 0xf87],
  [0xfc6, 0xfc6],
  [0x1037, 0x1037],
  [0x1039, 0x103a],
  [0x108d, 0x108d],
  [0x135d, 0x135f],
  [0x1714, 0x1715],
  [0x1734, 0x1734],
  [0x17d2, 0x17d2],
  [0x17dd, 0x17dd],
  [0x18a9, 0x18a9],
  [0x1939, 0x193b],
  [0x1a17, 0x1a18],
  [0x1a60, 0x1a60],
  [0x1a75, 0x1a7c],
  [0x1a7f, 0x1a7f],
  [0x1ab0, 0x1abd],
  [0x1abf, 0x1ace],
  [0x1b34, 0x1b34],
  [0x1b44, 0x1b44],
  [0x1b6b, 0x1b73],
  [0x1baa, 0x1bab],
  [0x1be6, 0x1be6],
  [0x1bf2, 0x1bf3],
  [0x1c37, 0x1c37],
  [0x1cd0, 0x1cd2],
  [0x1cd4, 0x1ce0],
  [0x1ce2, 0x1ce8],
  [0x1ced, 0x1ced],
  [0x1cf4, 0x1cf4],
  [0x1cf8, 0x1cf9],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20dc],
  [0x20e1, 0x20e1],
  [0x20e5, 0x20f0],
  [0x2cef, 0x2cf1],
  [0x2d7f, 0x2d7f],
  [0x2de0, 0x2dff],
  [0x302a, 0x302f],
  [0x3099, 0x309a],
  [0xa66f, 0xa66f],
  [0xa674, 0xa67d],
  [0xa69e, 0xa69f],
  [0xa6f0, 0xa6f1],
  [0xa806, 0xa806],
  [0xa82c, 0xa82c],
  [0xa8c4, 0xa8c4],
  [0xa8e0, 0xa8f1],
  [0xa92b, 0xa92d],
  [0xa953, 0xa953],
  [0xa9b3, 0xa9b3],
  [0xa9c0, 0xa9c0],
  [0xaab0, 0xaab0],
  [0xaab2, 0xaab4],
  [0xaab7, 0xaab8],
  [0xaabe, 0xaabf],
  [0xaac1, 0xaac1],
  [0xaaf6, 0xaaf6],
  [0xabed, 0xabed],
  [0xfb1e, 0xfb1e],
  [0xfe20, 0xfe2f],
  [0x101fd, 0x101fd],
  [0x102e0, 0x102e0],
  [0x10376, 0x1037a],
  [0x10a0d, 0x10a0d],
  [0x10a0f, 0x10a0f],
  [0x10a38, 0x10a3a],
  [0x10a3f, 0x10a3f],
  [0x10ae5, 0x10ae6],
  [0x10d24, 0x10d27],
  [0x10eab, 0x10eac],
  [0x10efd, 0x10eff],
  [0x10f46, 0x10f50],
  [0x10f82, 0x10f85],
  [0x11046, 0x11046],
  [0x11070, 0x11070],
  [0x1107f, 0x1107f],
  [0x110b9, 0x110ba],
  [0x11100, 0x11102],
  [0x11133, 0x11134],
  [0x11173, 0x11173],
  [0x111c0, 0x111c0],
  [0x111ca, 0x111ca],
  [0x11235, 0x11236],
  [0x112e9, 0x112ea],
  [0x1133b, 0x1133c],
  [0x1134d, 0x1134d],
  [0x11366, 0x1136c],
  [0x11370, 0x11374],
  [0x11442, 0x11442],
  [0x11446, 0x11446],
  [0x1145e, 0x1145e],
  [0x114c2, 0x114c3],
  [0x115bf, 0x115c0],
  [0x1163f, 0x1163f],
  [0x116b6, 0x116b7],
  [0x1172b, 0x1172b],
  [0x11839, 0x1183a],
  [0x1193d, 0x1193e],
  [0x11943, 0x11943],
  [0x119e0, 0x119e0],
  [0x11a34, 0x11a34],
  [0x11a47, 0x11a47],
  [0x11a99, 0x11a99],
  [0x11c3f, 0x11c3f],
  [0x11d42, 0x11d42],
  [0x11d44, 0x11d45],
  [0x11d97, 0x11d97],
  [0x11f41, 0x11f42],
  [0x16af0, 0x16af4],
  [0x16b30, 0x16b36],
  [0x16ff0, 0x16ff1],
  [0x1bc9e, 0x1bc9e],
  [0x1d165, 0x1d169],
  [0x1d16d, 0x1d172],
  [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244],
  [0x1e000, 0x1e006],
  [0x1e008, 0x1e018],
  [0x1e01b, 0x1e021],
  [0x1e023, 0x1e024],
  [0x1e026, 0x1e02a],
  [0x1e08f, 0x1e08f],
  [0x1e130, 0x1e136],
  [0x1e2ae, 0x1e2ae],
  [0x1e2ec, 0x1e2ef],
  [0x1e4ec, 0x1e4ef],
  [0x1e8d0, 0x1e8d6],
  [0x1e944, 0x1e94a],
];
const WIDE: Array<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x2ffb],
  [0x3000, 0x303e],
  [0x3041, 0x3096],
  [0x3099, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x318e],
  [0x3190, 0x31e3],
  [0x31f0, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0x4dbf],
  [0x4e00, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18d00, 0x18d08],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c],
  [0x1fa80, 0x1fa88],
  [0x1fa90, 0x1fabd],
  [0x1fabf, 0x1fac5],
  [0x1face, 0x1fadb],
  [0x1fae0, 0x1fae8],
  [0x1faf0, 0x1faf8],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/** Whether `cp` lies in one of the sorted, disjoint `ranges`: a binary search. */
function inRanges(ranges: Array<readonly [number, number]>, cp: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [first, last] = ranges[mid]!;
    if (cp < first) high = mid - 1;
    else if (cp > last) low = mid + 1;
    else return true;
  }
  return false;
}

/** Terminal cells: wide characters take two, combining marks none. */
export function cellWidth(s: string): number {
  let cells = 0;
  for (const char of s) {
    const cp = char.codePointAt(0)!;
    if (!inRanges(COMBINING, cp)) cells += inRanges(WIDE, cp) ? 2 : 1;
  }
  return cells;
}

/** `line` as it is when it fits the pane, else split into pieces that each fit it. */
function fit(line: string): string[] {
  // A wrapped line that still exceeds the pane holds wide characters (textwrap counts
  // code points): split it on cell boundaries. Only overflow lines reach here, so plain
  // text keeps textwrap's word breaks and wide text breaks anywhere, as it should.
  if (cellWidth(line) <= width) return [line];
  const pieces: string[] = [];
  let piece = "";
  let pieceCells = 0;
  for (const char of line) {
    const charCells = cellWidth(char);
    if (piece !== "" && pieceCells + charCells > width) {
      pieces.push(piece);
      piece = "";
      pieceCells = 0;
    }
    piece += char;
    pieceCells += charCells;
  }
  pieces.push(piece);
  return pieces;
}

// textwrap's ASCII whitespace set: only these split words (U+00A0 and friends never break).
const WORDSEP_SIMPLE = /([\t\n\x0b\x0c\r ]+)/u;

/** Code points, as Python len() counts them. */
function cpLen(s: string): number {
  return [...s].length;
}

function cpSlice(s: string, end: number): [string, string] {
  const chars = [...s];
  return [chars.slice(0, end).join(""), chars.slice(end).join("")];
}

/** Python textwrap.wrap with main's settings: content width, a two-space continuation indent,
 * whitespace kept, long words broken, no hyphen breaks. */
function textWrap(text: string, lineWidth: number, indent: string): string[] {
  // The chunks are held in reverse, so the next one to place is popped off the end.
  const chunks = text.split(WORDSEP_SIMPLE).filter((c) => c !== "");
  chunks.reverse();
  const lines: string[] = [];
  while (chunks.length > 0) {
    const curLine: string[] = [];
    let curLen = 0;
    const lineIndent = lines.length > 0 ? indent : "";
    const room = lineWidth - cpLen(lineIndent);
    // Take whole chunks for as long as they fit.
    while (chunks.length > 0) {
      const length = cpLen(chunks[chunks.length - 1]!);
      if (curLen + length <= room) {
        curLine.push(chunks.pop()!);
        curLen += length;
      } else break;
    }
    // A chunk longer than a whole line is broken to fill what is left of this one.
    if (chunks.length > 0 && cpLen(chunks[chunks.length - 1]!) > room) {
      const spaceLeft = room < 1 ? 1 : room - curLen;
      const chunk = chunks[chunks.length - 1]!;
      const [head, tail] = cpSlice(chunk, spaceLeft);
      curLine.push(head);
      chunks[chunks.length - 1] = tail;
      curLen = curLine.reduce((a, c) => a + cpLen(c), 0);
    }
    if (curLine.length > 0) lines.push(lineIndent + curLine.join(""));
  }
  return lines;
}

/** The local time of day, as HH:MM:SS. */
function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** The lines `text` takes in the pane: each source line wrapped, the stamp ahead of each. */
function wrapped(text: string, stamp: boolean): string[] {
  // Content wraps to width in terminal cells; the timestamp rides outside it, so a
  // followed line is at most width + 9, inside the pane. Continuation lines indent.
  const prefix = stamp ? `${timestamp()} ` : "";
  // The indent stays below the width: textwrap never returns once the indent reaches
  // it, which a ten-column pane would otherwise cause.
  const indent = "  ".slice(0, Math.max(0, width - 1));
  const lines: string[] = [];
  for (const sourceLine of visibleText(text).split("\n")) {
    const parts = textWrap(sourceLine, width, indent);
    for (const part of parts.length > 0 ? parts : [""]) {
      lines.push(...fit(part));
    }
  }
  // A blank line keeps the stamp without its trailing space, so that no line ends in one.
  return lines.map((line) => (line !== "" ? prefix + line : prefix.slice(0, -1)));
}

// --- showing lines ----------------------------------------------------------------------
const TRAILING_NL = /[\r\n]+$/u;

/** What one non-blank input line stands for: its event rendered, or the line as it is when it
 * is not a JSON object. */
function renderLine(text: string): string | string[] | null {
  let event: unknown = null;
  try {
    event = JSON.parse(text);
  } catch {
    event = null;
  }
  let out: string | string[] | null;
  if (isRecord(event)) {
    const rendered = render(event);
    if (rendered === GENERIC) {
      out = generic(event);
    } else {
      lastGeneric = null;
      out = rendered;
    }
  } else {
    out = firstLine(text);
  }
  return out;
}

function show(line: string, stamp: boolean): void {
  const stripped = line.replace(TRAILING_NL, "");
  if (pyTrim(stripped) === "") return;
  const out = renderLine(stripped);
  const items = Array.isArray(out) ? out : out ? [out] : [];
  for (const one of items) {
    for (const ln of wrapped(one, stamp)) console.log(ln);
  }
}

function flushSaid(stamp: boolean): void {
  // The stream ended mid-message: nothing left to flush the buffer, and nothing more can
  // arrive to split it, so print what the model said since the last tool call.
  if (pyTrim(museSaid) !== "") {
    for (const ln of wrapped(`says: ${pyTrim(museSaid)}`, stamp)) console.log(ln);
    museSaid = "";
  }
}

// --- reading the stream -----------------------------------------------------------------
// Reading sizes and waits: how much one read takes, how often a followed file is polled and
// how long it is waited for before it exists.
const READ_CHUNK_BYTES = 65536;
const POLL_MS = 200;
const FILE_WAIT_MS = 30000;

/** How many bytes at the end of `raw` begin a UTF-8 sequence that is not complete yet. */
function partialSequenceLength(raw: Uint8Array): number {
  // Only the last three bytes can hold the start of a cut-off sequence, and the last byte
  // that is not a continuation byte says how long its sequence is.
  let held = 0;
  for (let i = Math.max(0, raw.length - 3); i < raw.length; i++) {
    const byte = raw[i]!;
    if (byte < 0x80 || byte >= 0xc0) {
      const need = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      held = raw.length - i < need ? raw.length - i : 0;
    }
  }
  return held;
}

/** Incremental UTF-8 decoding over whole decode() calls: a trailing partial sequence (at most
 * three bytes) is held for the next feed, so a multibyte character split across reads decodes
 * whole. Only strict prefixes of a sequence hold; everything decoded now reads the same with
 * more bytes after it, so this is streaming decode exactly. Invalid bytes become U+FFFD. */
function utf8Stream(): { feed: (bytes: Uint8Array, final: boolean) => string } {
  const decoder = new TextDecoder("utf-8");
  let carry = new Uint8Array(0);
  const feed = (bytes: Uint8Array, final: boolean): string => {
    const raw = new Uint8Array(carry.length + bytes.length);
    raw.set(carry, 0);
    raw.set(bytes, carry.length);
    if (final) {
      carry = new Uint8Array(0);
      return decoder.decode(raw);
    }
    const held = partialSequenceLength(raw);
    carry = raw.slice(raw.length - held);
    return decoder.decode(raw.slice(0, raw.length - held));
  };
  return { feed };
}

const LINE_BOUNDARY = /\r\n|[\n\r]/u;

/** Split off every complete line the way a text-mode file's readline reads them: universal
 * newlines, so CR and CRLF end a line too. A trailing CR may still pair with the next chunk's
 * LF, so it stays pending. (Stdin iteration splits on LF only; that branch does not use this.) */
function popCompleteLines(pending: string): [string[], string] {
  let heldCr = "";
  if (pending.endsWith("\r")) {
    heldCr = "\r";
    pending = pending.slice(0, -1);
  }
  const lines = pending.split(LINE_BOUNDARY);
  const rest = (lines.pop() ?? "") + heldCr;
  return [lines, rest];
}

/** Everything in the file from byte `pos` to its end. */
function readRemaining(fd: number, pos: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let n = 0;
    try {
      n = readSync(fd, chunk, 0, chunk.length, pos);
    } catch {
      break;
    }
    if (n === 0) break;
    chunks.push(chunk.subarray(0, n));
    pos += n;
  }
  return Buffer.concat(chunks);
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// --- the command line -------------------------------------------------------------------
const INT_SIGN_BODY = /^([+-]?)(.+)$/u;
const UNDERSCORE = /_/gu;

/** A COLUMNS value the way os.get_terminal_size reads it: full int() syntax (surrounding
 * whitespace, a sign, underscores, non-ASCII digits), and only a positive value counts. */
function parseColumns(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = INT_SIGN_BODY.exec(pyTrim(raw));
  if (!match) return null;
  const sign = match[1];
  const body = match[2]!;
  if (sign === "-" || body.startsWith("_") || body.endsWith("_") || body.includes("__")) {
    return null;
  }
  let digits: string;
  try {
    digits = digitValue(body.replace(UNDERSCORE, ""));
  } catch {
    return null;
  }
  const n = Number(digits);
  return n > 0 ? n : null;
}

/** shutil.get_terminal_size((170, 24)).columns: a valid COLUMNS wins, even over a live pane. */
function termColumns(): number {
  return parseColumns(process.env.COLUMNS) ?? process.stdout.columns ?? 170;
}

/** The content width of a followed pane that is `columns` wide. */
function followWidth(columns: number): number {
  // Content keeps a 40-column floor where the pane fits it; in a narrower pane the
  // timestamp's 9 columns come out of the content, so a followed line stays inside.
  return Math.min(Math.max(40, columns - 10), Math.max(1, columns - 9));
}

/** What the command line asks for: a whole stream, or a file followed while a process lives. */
type Invocation =
  | { kind: "stream"; file: string | null }
  | { kind: "follow"; path: string; pid: number; start: number };

/** Read the arguments, taking them off `args`. Null after a usage error has been reported. */
function parseArgs(args: string[]): Invocation | null {
  let follow: string | null = null;
  let pid: number | null = null;
  let start = 0;
  let file: string | null = null;
  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--follow") follow = args.shift() ?? null;
    else if (arg === "--pid") pid = parseInt(args.shift() ?? "", 10);
    else if (arg === "--from") start = parseInt(args.shift() ?? "", 10);
    else if (arg.startsWith("-")) {
      console.error(`view-stream: unknown argument: ${arg}`);
      return null;
    } else if (file === null) {
      file = arg;
    } else {
      console.error(`view-stream: one stream at a time, not ${file} and ${arg}`);
      return null;
    }
  }
  if (!follow) return { kind: "stream", file };
  if (pid === null) {
    console.error("view-stream: --follow needs --pid");
    return null;
  }
  if (file !== null) {
    console.error("view-stream: the stream is --follow's file; take a second argument for it");
    return null;
  }
  return { kind: "follow", path: follow, pid, start };
}

/** Render a whole stream, the file or else stdin, then stop. */
function renderStream(file: string | null): number {
  const utf8 = utf8Stream();
  let fd = 0;
  if (file !== null) {
    try {
      fd = openSync(file, "r");
    } catch (error) {
      console.error(`view-stream: cannot read ${file}: ${String(error)}`);
      return 1;
    }
  }
  const readBuffer = Buffer.alloc(READ_CHUNK_BYTES);
  let pending = "";
  for (;;) {
    let n = 0;
    try {
      n = readSync(fd, readBuffer, 0, readBuffer.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    pending += utf8.feed(readBuffer.subarray(0, n), false);
    // Stdin iteration splits on LF only: a CR rides inside the line until show() strips it
    // (trailing) or drops it (mid-line, via visible_text).
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) show(line, false);
  }
  pending += utf8.feed(new Uint8Array(0), true);
  if (pending !== "") show(pending, false);
  flushSaid(false);
  if (file !== null) closeSync(fd);
  return 0;
}

/** Wait for the followed file to appear. False when the process exits or 30 s pass first. */
function waitForFile(path: string, pid: number): boolean {
  const deadline = Date.now() + FILE_WAIT_MS;
  while (!existsSync(path)) {
    if (!processIsLive(pid) || Date.now() > deadline) return false;
    sleep(POLL_MS);
  }
  return true;
}

/** Show an open file as it grows, from byte `start`, until `pid` has exited and everything it
 * wrote is shown. */
function followOpenFile(fd: number, path: string, pid: number, start: number): void {
  const utf8 = utf8Stream();
  // seek to start
  let pos = Math.min(start, statSync(path).size);
  let pending = "";
  for (;;) {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let n = 0;
    try {
      n = readSync(fd, chunk, 0, chunk.length, pos);
    } catch {
      n = 0;
    }
    if (n > 0) {
      pos += n;
      pending += utf8.feed(chunk.subarray(0, n), false);
      const [lines, rest] = popCompleteLines(pending);
      pending = rest;
      for (const line of lines) show(line, true);
      continue;
    }
    if (!processIsLive(pid)) {
      // whatever landed between the last read and the exit
      const tail = utf8.feed(readRemaining(fd, pos), true);
      for (const line of pySplitLines(pending + tail)) {
        show(line, true);
      }
      flushSaid(true);
      break;
    }
    sleep(POLL_MS);
  }
}

/** Render a file as it grows, and stop once `pid` has exited and everything it wrote is shown. */
function followStream(path: string, pid: number, start: number): number {
  // follow mode
  if (!waitForFile(path, pid)) return 0;
  const fd = openSync(path, "r");
  try {
    followOpenFile(fd, path, pid, start);
  } finally {
    closeSync(fd);
  }
  return 0;
}

function view(args: string[]): number {
  const invocation = parseArgs(args);
  if (invocation === null) return 1;
  if (invocation.kind === "stream") {
    width = 160;
    return renderStream(invocation.file);
  }
  width = followWidth(termColumns());
  return followStream(invocation.path, invocation.pid, invocation.start);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

/** The usage text: the first 18 lines of this file's header comment, less their markers. */
function printHelp(): void {
  const source = readFileSync(join(scriptsDir(import.meta), "view-stream.ts"), "utf8");
  for (const line of source.split("\n").slice(0, 18)) console.log(line.replace(/^\/\/ ?/u, ""));
}

if (import.meta.main) {
  if (argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  process.exit(view(argv));
}
