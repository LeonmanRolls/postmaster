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
interface Ev {
  [key: string]: unknown;
}

type Shown = string | string[] | null;

/** What the renderer remembers from one event to the next. */
interface State {
  readonly museSaid: string;
  /** the most recent shown says: text, so a restating result need not repeat it */
  readonly lastSaid: string;
  readonly mimoSessions: readonly unknown[];
  readonly lastGeneric: string | null;
}

const INITIAL_STATE: State = { museSaid: "", lastSaid: "", mimoSessions: [], lastGeneric: null };

interface Rendered {
  readonly state: State;
  readonly out: Shown | typeof GENERIC;
}

/** Python str() where the viewer prints a value: None and booleans spell as Python spells them. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

/** Python `str(v or "")`: a missing or false value prints as nothing. */
function strOrEmpty(v: unknown): string {
  if (typeof v === "string") return v;
  return v ? pyStr(v) : "";
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

function dumpUnit(unit: string): string {
  const c = unit.charCodeAt(0);
  const escape = DUMP_SHORT[c];
  if (escape !== undefined) return escape;
  if (c < 0x20 || c > 0x7e) return `\\u${c.toString(16).padStart(4, "0")}`;
  return unit;
}

/** Python json.dumps with its defaults (`, ` and `: ` separators, ensure_ascii): the fallback
 * that prints an event whose error carries no message. */
function pyDumps(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `"${v.split("").map(dumpUnit).join("")}"`;
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(", ")}]`;
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${pyDumps(k)}: ${pyDumps(val)}`,
    );
    return `{${pairs.join(", ")}}`;
  }
  return "null";
}

function roundedCents(num: bigint, shift: number): bigint {
  if (shift >= 0) return num << BigInt(shift);
  const div = 1n << BigInt(-shift);
  const q = num / div;
  const r = num % div;
  const roundsUp = 2n * r > div || (2n * r === div && q % 2n !== 0n);
  return roundsUp ? q + 1n : q;
}

/** C printf "%.2f", exactly: the exact binary value rounded half to even at cents, however large.
 * toFixed looks the same until an exact half (0.125 prints 0.12) or a huge cost (never exponent). */
function fmtCost(n: number): string {
  // the 64 bits of the double: one sign bit, eleven of exponent, fifty-two of fraction
  const bits = new BigUint64Array(new Float64Array([n]).buffer)[0]!;
  const neg = (bits & (1n << 63n)) !== 0n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & (2n ** 52n - 1n);
  const mant = exp === 0 ? frac : 2n ** 52n + frac;
  const shift = exp === 0 ? -1074 : exp - 1075;
  const cents = roundedCents(mant * 100n, shift);
  const digits = cents.toString();
  const dollars = digits.length > 2 ? digits.slice(0, -2) : "0";
  const frac2 = digits.padStart(3, "0").slice(-2);
  return `${neg ? "-" : ""}${dollars}.${frac2}`;
}

function short(s: unknown, width: number): string {
  if (s === null || s === undefined) return "";
  const lines = pySplitLines(pyTrim(pyStr(s)));
  const first = lines[0] ?? "";
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

function hasText(v: unknown): v is string {
  return typeof v === "string" && pyTrim(v) !== "";
}

function toolLine(name: unknown, inp: unknown): string {
  const input = asRecord(inp);
  for (const key of TOOL_KEYS) {
    const v = input[key];
    if (hasText(v)) return `${pyStr(name)}: ${v}`;
  }
  return pyStr(name);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b !== null && typeof b === "object")
      .map((b) => strOrEmpty((b as Ev).text))
      .join("\n");
  }
  return "";
}

function isRecord(v: unknown): v is Ev {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Python `v or {}` for a payload part: a missing or false value reads as no facts. */
function asRecord(v: unknown): Ev {
  return isRecord(v) ? v : {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

const LSTRIP_RE = new RegExp(`^[${PY_S_CLASS}]+`, "u");
const READ_FILE_RE = /^Read text file `([^`]+)`/u;

function editFacts(ef: unknown): Record<string, string> {
  if (!isRecord(ef)) return {};
  const entries = TOOL_KEYS.flatMap((key): [string, string][] => {
    const v = ef[key];
    return hasText(v) ? [[key, v]] : [];
  });
  return Object.fromEntries(entries);
}

function blobFacts(blob: unknown): Record<string, string> {
  if (!isRecord(blob)) return {};
  const [first] = ["command", "cmd", "file_path", "path"].flatMap((key) => {
    const v = blob[key];
    return hasText(v) ? [{ key, text: v }] : [];
  });
  if (first === undefined) return {};
  const slot = first.key === "command" || first.key === "cmd" ? "command" : "path";
  return { [slot]: first.text };
}

function textFacts(text: unknown): Record<string, string> {
  if (typeof text !== "string") return {};
  const t = text.replace(LSTRIP_RE, "");
  if (t.startsWith("{")) return blobFacts(parseJson(t));
  const m = READ_FILE_RE.exec(t);
  return m?.[1] ? { path: m[1] } : {};
}

function museFacts(p: Ev): Record<string, string> {
  // What a Muse tool.result names as its input. edit_facts carries the path of a write or
  // edit. A bash result's text is a JSON object whose "command" is what ran; a read_file
  // result's text opens with "Read text file `path`". The rest of that text is tool output
  // and never reaches the pane. What edit_facts names comes first: the text only fills gaps.
  return { ...textFacts(p.text), ...editFacts(p.edit_facts) };
}

function museLines(pt: string, p: Ev, e: Ev): string[] {
  if (pt === "run.model.configured") {
    return [`session ${pyStr(asRecord(e.stream).id)} · ${pyStr(p.model_id)}`];
  }
  if (pt === "tool.result") {
    const facts = asRecord(p.correlation_facts);
    const name = facts.tool_name ? pyStr(facts.tool_name) : "tool";
    const outcome = facts.outcome;
    const line = toolLine(name, museFacts(p));
    const failed = !(outcome === null || outcome === undefined || outcome === "success");
    return [failed ? `tool error: ${line}` : line];
  }
  // else: task lifecycle and bookkeeping are not pane output
  return [];
}

function muse(state: State, e: Ev): Rendered {
  // muse (muse exec --json): each record names its payload_type, and its stream is the session
  const pt = pyStr(e.payload_type);
  const p = asRecord(e.payload);
  if (pt === "run.output.delta") {
    return { state: { ...state, museSaid: state.museSaid + strOrEmpty(p.text) }, out: null };
  }
  if (pt.startsWith("run.terminal.")) {
    const said = pyTrim(strOrEmpty(p.text));
    const term = p.terminal ? pyStr(p.terminal) : (pt.split(".").at(-1) ?? pt);
    return {
      state: { ...state, museSaid: "" }, // the result line carries this text
      out: [`result: ${term}${said ? ` · ${said}` : ""}`],
    };
  }
  // A tool call ends the message: flush what the model said since the last one. Task
  // lifecycle and bookkeeping never flush, so noise between deltas cannot split a message.
  const flushes =
    (pt === "run.model.configured" || pt === "tool.result") && pyTrim(state.museSaid) !== "";
  const flushed = flushes ? [`says: ${pyTrim(state.museSaid)}`] : [];
  const out = [...flushed, ...museLines(pt, p, e)];
  return {
    state: flushes ? { ...state, museSaid: "" } : state,
    out: out.length > 0 ? out : null,
  };
}

function mimoLines(e: Ev, width: number): string[] {
  const t = e.type;
  const part = asRecord(e.part);
  if (t === "text" && pyTrim(strOrEmpty(part.text)) !== "") {
    return [`says: ${strOrEmpty(part.text)}`];
  }
  if (t === "tool_use") {
    const call = asRecord(part.state);
    return [
      call.status === "error" ? `tool error: ${pyStr(part.tool)}` : toolLine(part.tool, call.input),
    ];
  }
  if (t === "step_finish" && part.reason === "stop") return ["done"];
  if (t === "error") {
    const err = asRecord(e.error);
    return [`error: ${short(asRecord(err.data).message || err.name || pyDumps(err), width)}`];
  }
  return [];
}

function mimo(state: State, e: Ev, width: number): Rendered {
  // mimo (mimo run --format json): every event carries its sessionID and a part
  const sid = e.sessionID;
  const isNew = Boolean(sid) && !state.mimoSessions.includes(sid);
  const named = isNew ? [`session ${pyStr(sid)}`] : [];
  const out = [...named, ...mimoLines(e, width)];
  return {
    state: isNew ? { ...state, mimoSessions: [...state.mimoSessions, sid] } : state,
    out: out.length > 0 ? out : null,
  };
}

const GENERIC = Symbol("generic");

const MIMO_TYPES = ["step_start", "step_finish", "text", "tool_use", "error"];

function systemLine(e: Ev): string | null {
  const st = e.subtype;
  if (st === "init") return `session ${pyStr(e.session_id)} · ${pyStr(e.model)}`;
  if (st === "compact_boundary") return "context compacted";
  return null;
}

function isSaid(t: unknown, blk: Ev): boolean {
  return t === "assistant" && blk.type === "text" && pyTrim(strOrEmpty(blk.text)) !== "";
}

function claudeBlock(t: unknown, blk: Ev, width: number): string[] {
  const k = blk.type;
  if (isSaid(t, blk)) return [`says: ${strOrEmpty(blk.text)}`];
  if (t === "assistant" && k === "tool_use") return [toolLine(blk.name, blk.input)];
  if (t === "user" && k === "tool_result" && blk.is_error) {
    return [`tool error: ${short(textOf(blk.content), width)}`];
  }
  return [];
}

function claudeMessage(state: State, t: unknown, msg: Ev, width: number): Rendered {
  const content = Array.isArray(msg.content) ? msg.content : [];
  const blocks = content.filter((b): b is Ev => b !== null && typeof b === "object");
  const lines = blocks.flatMap((blk) => claudeBlock(t, blk, width));
  const last = blocks.filter((blk) => isSaid(t, blk)).at(-1);
  const lastSaid = last === undefined ? state.lastSaid : pyTrim(strOrEmpty(last.text));
  return { state: { ...state, lastSaid }, out: lines.length > 0 ? lines : null };
}

function turnsPart(turns: unknown): string | null {
  if (typeof turns === "number" && Number.isInteger(turns)) return `${turns} turns`;
  if (typeof turns === "boolean") return `${turns ? 1 : 0} turns`;
  return null;
}

function costPart(cost: unknown): string | null {
  const dollars = typeof cost === "boolean" ? (cost ? 1 : 0) : cost;
  return typeof dollars === "number" ? `$${fmtCost(dollars)}` : null;
}

function resultPart(result: unknown, lastSaid: string): string | null {
  if (!result) return null;
  const text = pyStr(result);
  return pyTrim(text) !== lastSaid ? text : null; // a restating result need not repeat it
}

function claudeResult(e: Ev, lastSaid: string): string {
  const status = pyStr(e.subtype || e.status || (e.is_error ? "error" : "done"));
  const parts = [
    status,
    turnsPart(e.num_turns),
    costPart(e.total_cost_usd),
    resultPart(e.result, lastSaid),
  ];
  return `result: ${parts.filter((part) => part !== null).join(" · ")}`;
}

function codexItem(t: unknown, e: Ev, width: number): string | null {
  const it = asRecord(e.item);
  const k = it.type;
  if (t === "item.started") {
    if (k !== "command_execution") return null;
    const command = strOrEmpty(it.command);
    return pyTrim(command) !== "" ? `shell: ${command}` : null;
  }
  if (k === "agent_message") {
    const said = strOrEmpty(it.text);
    return pyTrim(said) !== "" ? `says: ${said}` : null;
  }
  if (k === "command_execution") {
    const code = it.exit_code;
    return code === 0 || code === false || code === null || code === undefined
      ? null
      : `shell exit ${pyStr(code)}: ${strOrEmpty(it.command)}`;
  }
  if (k === "file_change") {
    const changes = Array.isArray(it.changes) ? it.changes : [];
    const paths = changes
      .filter(isRecord)
      .map((c) => strOrEmpty(c.path))
      .filter((p) => pyTrim(p) !== "");
    return paths.length > 0 ? `edit: ${paths.join(", ")}` : null;
  }
  if (k === "mcp_tool_call") return `tool: ${pyStr(it.server)}.${pyStr(it.tool)}`;
  if (k === "web_search") return `search: ${short(it.query, width)}`;
  if (k === "error") return `error: ${short(it.message, width)}`;
  return null;
}

function piMessage(e: Ev): string | null {
  const m = asRecord(e.message);
  if (m.role !== "assistant") return null;
  const content = Array.isArray(m.content) ? m.content : [];
  const said = textOf(
    content.filter((b) => b !== null && typeof b === "object" && (b as Ev).type === "text"),
  );
  return pyTrim(said) !== "" ? `says: ${said}` : null;
}

/** The events that change nothing the renderer remembers. GENERIC is any the viewer does not know. */
function renderPlain(t: unknown, e: Ev, lastSaid: string, width: number): Shown | typeof GENERIC {
  // claude (claude -p --output-format stream-json), what is left of it
  if (t === "result") return claudeResult(e, lastSaid);
  if (t === "rate_limit_event") {
    const status = asRecord(e.rate_limit_info).status;
    return status === null || status === undefined || status === "allowed"
      ? null
      : `rate limit: ${pyStr(status)}`;
  }
  // codex (codex exec --json)
  if (t === "thread.started") return `session ${pyStr(e.thread_id)}`;
  if (t === "item.started" || t === "item.completed") return codexItem(t, e, width);
  if (t === "turn.completed") {
    const u = asRecord(e.usage);
    const tokIn = "input_tokens" in u ? pyStr(u.input_tokens) : "?";
    const tokOut = "output_tokens" in u ? pyStr(u.output_tokens) : "?";
    return `turn done · ${tokIn} tokens in, ${tokOut} out`;
  }
  if (t === "turn.failed") return `turn failed: ${short(asRecord(e.error).message, width)}`;
  if (t === "error") return `error: ${short(e.message || pyDumps(e), width)}`;
  // pi (pi --mode json)
  if (t === "session") return `session ${pyStr(e.id)}`;
  if (t === "tool_execution_start") return toolLine(e.toolName, e.args);
  if (t === "tool_execution_end") {
    return e.isError ? `tool error: ${pyStr(e.toolName)}` : null;
  }
  if (t === "message_end") return piMessage(e);
  if (t === "agent_end") return "done";
  if (t === "auto_retry_start") return `retrying: ${short(strOrEmpty(e.errorMessage), width)}`;
  if (t === "auto_compaction_start") return "compacting context";
  return GENERIC;
}

function render(state: State, e: Ev, width: number): Rendered {
  if ("payload_type" in e) return muse(state, e);
  if ("sessionID" in e && MIMO_TYPES.includes(e.type as string)) {
    return mimo(state, e, width);
  }
  const t = e.type;
  if (typeof t === "string" && QUIET.has(t)) return { state, out: null };
  // claude (claude -p --output-format stream-json)
  if (t === "system") return { state, out: systemLine(e) };
  const message = e.message;
  if ((t === "assistant" || t === "user") && isRecord(message)) {
    return claudeMessage(state, t, message, width);
  }
  return { state, out: renderPlain(t, e, state.lastSaid, width) };
}

function generic(state: State, e: Ev, width: number): { state: State; out: string | null } {
  const t = pyStr(e.type || e.event || "event");
  if (t === state.lastGeneric) return { state, out: null };
  const next = { ...state, lastGeneric: t };
  for (const key of ["text", "message", "content", "result", "name", "tool_name", "command"]) {
    const v = e[key];
    if (hasText(v)) return { state: next, out: `${t}: ${short(v, width)}` };
  }
  return { state: next, out: t };
}

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

function searchRanges(
  ranges: Array<readonly [number, number]>,
  cp: number,
  lo: number,
  hi: number,
): boolean {
  if (lo > hi) return false;
  const mid = (lo + hi) >> 1;
  const [a, b] = ranges[mid]!;
  if (cp < a) return searchRanges(ranges, cp, lo, mid - 1);
  if (cp > b) return searchRanges(ranges, cp, mid + 1, hi);
  return true;
}

function inRanges(ranges: Array<readonly [number, number]>, cp: number): boolean {
  return searchRanges(ranges, cp, 0, ranges.length - 1);
}

function cellsOf(cp: number): number {
  if (inRanges(COMBINING, cp)) return 0;
  return inRanges(WIDE, cp) ? 2 : 1;
}

/** Terminal cells: wide characters take two, combining marks none. */
export function cellWidth(s: string): number {
  return [...s].reduce((cells, c) => cells + cellsOf(c.codePointAt(0)!), 0);
}

interface Cut {
  readonly chunks: string[];
  readonly cur: string;
  readonly curW: number;
}

function fit(line: string, width: number): string[] {
  // A wrapped line that still exceeds the pane holds wide characters (textwrap counts
  // code points): split it on cell boundaries. Only overflow lines reach here, so plain
  // text keeps textwrap's word breaks and wide text breaks anywhere, as it should.
  if (cellWidth(line) <= width) return [line];
  const cut = [...line].reduce<Cut>(
    (so, c) => {
      const w = cellWidth(c);
      if (so.cur !== "" && so.curW + w > width) {
        return { chunks: [...so.chunks, so.cur], cur: c, curW: w };
      }
      return { chunks: so.chunks, cur: so.cur + c, curW: so.curW + w };
    },
    { chunks: [], cur: "", curW: 0 },
  );
  return [...cut.chunks, cut.cur];
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

/** What textWrap has so far: the lines it has closed, and the one it is filling. */
interface Wrapping {
  readonly lines: string[];
  /** the chunks on the line being filled */
  readonly open: string[];
  /** their length in code points */
  readonly openLen: number;
}

/** The line being filled, closed: with its indent unless it is the first, and not at all when empty. */
function closeLine(wrapping: Wrapping, indent: string): Wrapping {
  if (wrapping.open.length === 0) return wrapping;
  const ind = wrapping.lines.length > 0 ? indent : "";
  return { lines: [...wrapping.lines, ind + wrapping.open.join("")], open: [], openLen: 0 };
}

/** Put one chunk on the line being filled, closing lines as it needs. */
function place(wrapping: Wrapping, chunk: string, w: number, indent: string): Wrapping {
  const ind = wrapping.lines.length > 0 ? indent : "";
  const room = w - cpLen(ind);
  const size = cpLen(chunk);
  if (wrapping.openLen + size <= room) {
    return { ...wrapping, open: [...wrapping.open, chunk], openLen: wrapping.openLen + size };
  }
  if (size > room) {
    // longer than a whole line: fill what is left of this one, and go on with the rest
    const spaceLeft = room < 1 ? 1 : room - wrapping.openLen;
    const [head, tail] = cpSlice(chunk, spaceLeft);
    const filled = { ...wrapping, open: [...wrapping.open, head] };
    return place(closeLine(filled, indent), tail, w, indent);
  }
  return place(closeLine(wrapping, indent), chunk, w, indent);
}

/** Python textwrap.wrap with main's settings: content width, a two-space continuation indent,
 * whitespace kept, long words broken, no hyphen breaks. */
function textWrap(text: string, w: number, indent: string): string[] {
  const chunks = text.split(WORDSEP_SIMPLE).filter((c) => c !== "");
  const filled = chunks.reduce<Wrapping>((so, chunk) => place(so, chunk, w, indent), {
    lines: [],
    open: [],
    openLen: 0,
  });
  return closeLine(filled, indent).lines;
}

function wrapped(s: string, prefix: string, width: number): string[] {
  // Content wraps to width in terminal cells; the timestamp rides outside it, so a
  // followed line is at most width + 9, inside the pane. Continuation lines indent.
  // The indent stays below the width: textwrap never returns once the indent reaches
  // it, which a ten-column pane would otherwise cause.
  const indent = "  ".slice(0, Math.max(0, width - 1));
  const lines = visibleText(s)
    .split("\n")
    .flatMap((sourceLine) => {
      const parts = textWrap(sourceLine, width, indent);
      return (parts.length > 0 ? parts : [""]).flatMap((part) => fit(part, width));
    });
  return lines.map((ln) => (ln !== "" ? prefix + ln : prefix === "" ? "" : prefix.slice(0, -1)));
}

const TRAILING_NL = /[\r\n]+$/u;

function itemsOf(out: Shown): string[] {
  if (Array.isArray(out)) return out;
  return out ? [out] : [];
}

function showLine(state: State, line: string, width: number): { state: State; items: string[] } {
  const stripped = line.replace(TRAILING_NL, "");
  if (pyTrim(stripped) === "") return { state, items: [] };
  const e = parseJson(stripped);
  if (!isRecord(e)) return { state, items: itemsOf(short(stripped, width)) };
  const rendered = render(state, e, width);
  if (rendered.out === GENERIC) {
    const other = generic(rendered.state, e, width);
    return { state: other.state, items: itemsOf(other.out) };
  }
  return { state: { ...rendered.state, lastGeneric: null }, items: itemsOf(rendered.out) };
}

const INT_SIGN_BODY = /^([+-]?)(.+)$/u;
const UNDERSCORE = /_/gu;

function decimalDigits(s: string): string | null {
  try {
    return digitValue(s);
  } catch {
    return null;
  }
}

/** A COLUMNS value the way os.get_terminal_size reads it: full int() syntax (surrounding
 * whitespace, a sign, underscores, non-ASCII digits), and only a positive value counts. */
function parseColumns(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = INT_SIGN_BODY.exec(pyTrim(raw));
  if (!m || m[1] === "-" || m[2]!.startsWith("_") || m[2]!.endsWith("_") || m[2]!.includes("__")) {
    return null;
  }
  const digits = decimalDigits(m[2]!.replace(UNDERSCORE, ""));
  if (digits === null) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

function followWidth(columns: number): number {
  // Content keeps a 40-column floor where the pane fits it; in a narrower pane the
  // timestamp's 9 columns come out of the content, so a followed line stays inside.
  return Math.min(Math.max(40, columns - 10), Math.max(1, columns - 9));
}

interface Decoded {
  readonly text: string;
  readonly carry: Uint8Array;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function heldBytes(raw: Uint8Array): number {
  const from = Math.max(0, raw.length - 3);
  const leads = Array.from(raw.subarray(from)).flatMap((b, k) =>
    b < 0x80 || b >= 0xc0 ? [{ b, at: from + k }] : [],
  );
  const last = leads.at(-1);
  if (last === undefined) return 0;
  const need = last.b < 0x80 ? 1 : last.b < 0xe0 ? 2 : last.b < 0xf0 ? 3 : 4;
  const have = raw.length - last.at;
  return have < need ? have : 0;
}

/** Incremental UTF-8 decoding over whole decode() calls: a trailing partial sequence (at most
 * three bytes) is held for the next feed, so a multibyte character split across reads decodes
 * whole. Only strict prefixes of a sequence hold; everything decoded now reads the same with
 * more bytes after it, so this is streaming decode exactly. Invalid bytes become U+FFFD. */
function utf8Stream(carry: Uint8Array, bytes: Uint8Array, final: boolean): Decoded {
  const raw = Buffer.concat([carry, bytes]);
  if (final) return { text: decodeUtf8(raw), carry: new Uint8Array(0) };
  const split = raw.length - heldBytes(raw);
  return { text: decodeUtf8(raw.subarray(0, split)), carry: raw.subarray(split) };
}

const LINE_BOUNDARY = /\r\n|[\n\r]/u;

/** Split off every complete line the way a text-mode file's readline reads them: universal
 * newlines, so CR and CRLF end a line too. A trailing CR may still pair with the next chunk's
 * LF, so it stays pending. (Stdin iteration splits on LF only; that branch does not use this.) */
function popCompleteLines(buf: string): [string[], string] {
  const endsInCr = buf.endsWith("\r");
  const parts = (endsInCr ? buf.slice(0, -1) : buf).split(LINE_BOUNDARY);
  const rest = (parts.at(-1) ?? "") + (endsInCr ? "\r" : "");
  return [parts.slice(0, -1), rest];
}

/** Split off every complete line, and what trails the last LF. Stdin iteration splits on LF
 * only: a CR rides inside the line until show() strips it (trailing) or drops it (mid-line,
 * via visible_text). */
function splitOnLf(text: string): [string[], string] {
  const parts = text.split("\n");
  return [parts.slice(0, -1), parts.at(-1) ?? ""];
}

interface Options {
  readonly follow: string | null;
  readonly pid: number | null;
  readonly start: number;
  readonly file: string | null;
}

function parseArgs(args: readonly string[], at: number, options: Options): Options | string {
  if (at >= args.length) return options;
  const a = args[at]!;
  const value = args[at + 1];
  if (a === "--follow") return parseArgs(args, at + 2, { ...options, follow: value ?? null });
  if (a === "--pid") return parseArgs(args, at + 2, { ...options, pid: parseInt(value ?? "", 10) });
  if (a === "--from") {
    return parseArgs(args, at + 2, { ...options, start: parseInt(value ?? "", 10) });
  }
  if (a.startsWith("-")) return `view-stream: unknown argument: ${a}`;
  if (options.file === null) return parseArgs(args, at + 1, { ...options, file: a });
  return `view-stream: one stream at a time, not ${options.file} and ${a}`;
}

type Plan =
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "read"; readonly file: string | null }
  | {
      readonly kind: "follow";
      readonly file: string;
      readonly pid: number;
      readonly start: number;
    };

function planFor(args: readonly string[]): Plan {
  const parsed = parseArgs(args, 0, { follow: null, pid: null, start: 0, file: null });
  if (typeof parsed === "string") return { kind: "usage", message: parsed };
  const { follow, pid, start, file } = parsed;
  if (!follow) return { kind: "read", file };
  if (pid === null) return { kind: "usage", message: "view-stream: --follow needs --pid" };
  if (file !== null) {
    return {
      kind: "usage",
      message: "view-stream: the stream is --follow's file; take a second argument for it",
    };
  }
  return { kind: "follow", file: follow, pid, start };
}

function helpLines(source: string): string[] {
  return source
    .split("\n")
    .slice(0, 18)
    .map((l) => l.replace(/^\/\/ ?/u, ""));
}

// --- the edges: what prints, reads a file, the clock or the environment, or waits ---------
function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function printWrapped(items: readonly string[], stamp: boolean, width: number): void {
  for (const one of items) {
    const prefix = stamp ? `${timestamp()} ` : "";
    for (const ln of wrapped(one, prefix, width)) console.log(ln);
  }
}

function show(state: State, line: string, stamp: boolean, width: number): State {
  const shown = showLine(state, line, width);
  printWrapped(shown.items, stamp, width);
  return shown.state;
}

function showLines(state: State, lines: readonly string[], stamp: boolean, width: number): State {
  return lines.reduce((so, line) => show(so, line, stamp, width), state);
}

function flushSaid(state: State, stamp: boolean, width: number): void {
  // The stream ended mid-message: nothing left to flush the buffer, and nothing more can
  // arrive to split it, so print what the model said since the last tool call.
  if (pyTrim(state.museSaid) !== "") {
    printWrapped([`says: ${pyTrim(state.museSaid)}`], stamp, width);
  }
}

function alive(p: number): boolean {
  return processIsLive(p);
}

/** shutil.get_terminal_size((170, 24)).columns: a valid COLUMNS wins, even over a live pane. */
function termColumns(): number {
  return parseColumns(process.env.COLUMNS) ?? process.stdout.columns ?? 170;
}

function openRead(file: string): { readonly fd: number } | { readonly error: unknown } {
  try {
    return { fd: openSync(file, "r") };
  } catch (error) {
    return { error };
  }
}

/** The next bytes of the file from `position` (null: from where the last read stopped), or
 * null when there are none now, whether the file ends there or the read fails. */
function readChunkEdge(fd: number, position: number | null): Uint8Array | null {
  const chunk = Buffer.alloc(65536);
  try {
    const n = readSync(fd, chunk, 0, chunk.length, position);
    return n > 0 ? chunk.subarray(0, n) : null;
  } catch {
    return null;
  }
}

function readRemaining(fd: number, pos: number, parts: Uint8Array[] = []): Uint8Array {
  const chunk = readChunkEdge(fd, pos);
  if (chunk === null) return Buffer.concat(parts);
  return readRemaining(fd, pos + chunk.length, [...parts, chunk]);
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/** What a read loop carries from one read to the next. */
interface Reading {
  /** the bytes of a character not yet whole */
  readonly carry: Uint8Array;
  /** the text of a line not yet ended */
  readonly pending: string;
  readonly state: State;
}

function startReading(): Reading {
  return { carry: new Uint8Array(0), pending: "", state: INITIAL_STATE };
}

/** Show the stream on fd as it arrives, and its unfinished last line when it ends. The loop is
 * a tail call: Bun runs it in constant stack, however long the stream. */
function drain(fd: number, width: number, reading: Reading): State {
  const chunk = readChunkEdge(fd, null);
  if (chunk === null) {
    const tail = utf8Stream(reading.carry, new Uint8Array(0), true);
    const last = reading.pending + tail.text;
    const state = last !== "" ? showLines(reading.state, [last], false, width) : reading.state;
    flushSaid(state, false, width);
    return state;
  }
  const decoded = utf8Stream(reading.carry, chunk, false);
  const [lines, rest] = splitOnLf(reading.pending + decoded.text);
  const state = showLines(reading.state, lines, false, width);
  return drain(fd, width, { carry: decoded.carry, pending: rest, state });
}

function readStream(file: string | null, width: number): number {
  if (file === null) {
    drain(0, width, startReading());
    return 0;
  }
  const opened = openRead(file);
  if ("error" in opened) {
    console.error(`view-stream: cannot read ${file}: ${String(opened.error)}`);
    return 1;
  }
  drain(opened.fd, width, startReading());
  closeSync(opened.fd);
  return 0;
}

function fileAppears(file: string, pid: number, deadline: number): boolean {
  if (existsSync(file)) return true;
  if (!alive(pid) || Date.now() > deadline) return false;
  sleep(200);
  return fileAppears(file, pid, deadline);
}

function follow(fd: number, pid: number, width: number, pos: number, reading: Reading): State {
  const chunk = readChunkEdge(fd, pos);
  if (chunk !== null) {
    const decoded = utf8Stream(reading.carry, chunk, false);
    const [lines, rest] = popCompleteLines(reading.pending + decoded.text);
    const state = showLines(reading.state, lines, true, width);
    return follow(fd, pid, width, pos + chunk.length, {
      carry: decoded.carry,
      pending: rest,
      state,
    });
  }
  if (!alive(pid)) {
    // whatever landed between the last read and the exit
    const tail = utf8Stream(reading.carry, readRemaining(fd, pos), true);
    const lines = pySplitLines(reading.pending + tail.text);
    const state = showLines(reading.state, lines, true, width);
    flushSaid(state, true, width);
    return state;
  }
  sleep(200);
  return follow(fd, pid, width, pos, reading);
}

function followFile(file: string, pid: number, start: number, width: number): number {
  const deadline = Date.now() + 30000;
  if (!fileAppears(file, pid, deadline)) return 0;
  const fd = openSync(file, "r");
  try {
    // seek to start
    const stat = statSync(file);
    follow(fd, pid, width, Math.min(start, stat.size), startReading());
  } finally {
    closeSync(fd);
  }
  return 0;
}

function view(args: string[]): number {
  const plan = planFor(args);
  if (plan.kind === "usage") {
    console.error(plan.message);
    return 1;
  }
  if (plan.kind === "follow") {
    // follow mode
    return followFile(plan.file, plan.pid, plan.start, followWidth(termColumns()));
  }
  return readStream(plan.file, 160);
}

// --- entry ------------------------------------------------------------------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "-h" || argv[0] === "--help") {
    const selfSrc = readFileSync(join(scriptsDir(import.meta), "view-stream.ts"), "utf8");
    for (const l of helpLines(selfSrc)) console.log(l);
    process.exit(0);
  } else {
    process.exit(view(argv));
  }
}
