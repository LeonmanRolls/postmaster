// Show a harness's event stream readably: what an agent says and runs, in full and wrapped to the
// pane, never raw JSON. This is what a session host's pane shows while a launch runs
// (scripts/host.sh). Event formats are harness-specific, so this script belongs to the harness
// adapter beside launch.sh, and harnesses.md says which harness's events it knows.
//
//   view-stream.sh < <events-file>                           render a stream, then stop
//   view-stream.sh --follow <file> --pid <pid> [--from <byte>] render the file as it grows,
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
import { digitValue, PY_S_CLASS, pySplitLines, pyTrim } from "./lib/text.ts";

// --- the renderer (ported from the embedded Python) ---------------------------------------
interface Ev {
  [key: string]: unknown;
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

/** Python json.dumps with its defaults (`, ` and `: ` separators, ensure_ascii): the fallback
 * that prints an event whose error carries no message. */
function pyDumps(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    let out = '"';
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      const short = DUMP_SHORT[c];
      if (short !== undefined) out += short;
      else if (c < 0x20 || c > 0x7e) out += `\\u${c.toString(16).padStart(4, "0")}`;
      else out += v[i];
    }
    return `${out}"`;
  }
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(", ")}]`;
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${pyDumps(k)}: ${pyDumps(val)}`,
    );
    return `{${pairs.join(", ")}}`;
  }
  return "null";
}

/** C printf "%.2f", exactly: the exact binary value rounded half to even at cents, however large.
 * toFixed looks the same until an exact half (0.125 prints 0.12) or a huge cost (never exponent). */
function fmtCost(n: number): string {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, n);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const neg = (hi & 0x80000000) !== 0;
  const exp = (hi >>> 20) & 0x7ff;
  const frac = BigInt(hi & 0xfffff) * 2n ** 32n + BigInt(lo);
  const mant = exp === 0 ? frac : 2n ** 52n + frac;
  const shift = exp === 0 ? -1074 : exp - 1075;
  const num = mant * 100n;
  let cents: bigint;
  if (shift >= 0) {
    cents = num << BigInt(shift);
  } else {
    const div = 1n << BigInt(-shift);
    const q = num / div;
    const r = num % div;
    if (2n * r > div || (2n * r === div && q % 2n !== 0n)) cents = q + 1n;
    else cents = q;
  }
  const digits = cents.toString();
  const dollars = digits.length > 2 ? digits.slice(0, -2) : "0";
  const frac2 = digits.padStart(3, "0").slice(-2);
  return `${neg ? "-" : ""}${dollars}.${frac2}`;
}

let width = 160;

function short(s: unknown, n?: number): string {
  if (s === null || s === undefined) return "";
  const lines = pySplitLines(pyTrim(pyStr(s)));
  const first = lines.length > 0 ? lines[0]! : "";
  const lim = n ?? width;
  const chars = [...first];
  return chars.length <= lim ? first : `${chars.slice(0, lim - 1).join("")}…`;
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

function toolLine(name: unknown, inp: unknown): string {
  const input = asRecord(inp);
  for (const key of TOOL_KEYS) {
    const v = input[key];
    if (typeof v === "string" && pyTrim(v) !== "") return `${pyStr(name)}: ${v}`;
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

/** Python `v or {}` for a payload part: a missing or false value reads as no facts. */
function asRecord(v: unknown): Ev {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Ev) : {};
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

function museFacts(p: Ev): Record<string, string> {
  // What a Muse tool.result names as its input. edit_facts carries the path of a write or
  // edit. A bash result's text is a JSON object whose "command" is what ran; a read_file
  // result's text opens with "Read text file `path`". The rest of that text is tool output
  // and never reaches the pane.
  const inp: Record<string, string> = {};
  const ef = p.edit_facts;
  if (ef !== null && typeof ef === "object" && !Array.isArray(ef)) {
    for (const key of TOOL_KEYS) {
      const v = (ef as Ev)[key];
      if (typeof v === "string" && pyTrim(v) !== "") inp[key] = v;
    }
  }
  const text = p.text;
  if (typeof text === "string") {
    const t = text.replace(LSTRIP_RE, "");
    if (t.startsWith("{")) {
      let blob: unknown = null;
      try {
        blob = JSON.parse(t);
      } catch {
        blob = null;
      }
      if (blob !== null && typeof blob === "object" && !Array.isArray(blob)) {
        for (const key of ["command", "cmd", "file_path", "path"]) {
          const v = (blob as Ev)[key];
          if (typeof v === "string" && pyTrim(v) !== "") {
            const slot = key === "command" || key === "cmd" ? "command" : "path";
            inp[slot] ??= v;
            break;
          }
        }
      }
    } else {
      const m = READ_FILE_RE.exec(t);
      if (m?.[1]) inp.path ??= m[1];
    }
  }
  return inp;
}

let museSaid = "";

function muse(e: Ev): string[] | null {
  // muse (muse exec --json): each record names its payload_type, and its stream is the session
  const pt = pyStr(e.payload_type);
  const p = asRecord(e.payload);
  if (pt === "run.output.delta") {
    museSaid += strOrEmpty(p.text);
    return null;
  }
  if (pt.startsWith("run.terminal.")) {
    museSaid = ""; // the result line carries this text
    const said = pyTrim(strOrEmpty(p.text));
    const term = p.terminal ? pyStr(p.terminal) : (pt.split(".").pop() ?? pt);
    return [`result: ${term}${said ? ` · ${said}` : ""}`];
  }
  const out: string[] = [];
  if ((pt === "run.model.configured" || pt === "tool.result") && pyTrim(museSaid) !== "") {
    // A tool call ends the message: flush what the model said since the last one. Task
    // lifecycle and bookkeeping never flush, so noise between deltas cannot split a message.
    out.push(`says: ${pyTrim(museSaid)}`);
    museSaid = "";
  }
  if (pt === "run.model.configured") {
    out.push(`session ${pyStr(asRecord(e.stream).id)} · ${pyStr(p.model_id)}`);
  } else if (pt === "tool.result") {
    const facts = asRecord(p.correlation_facts);
    const name = facts.tool_name ? pyStr(facts.tool_name) : "tool";
    const outcome = facts.outcome;
    const line = toolLine(name, museFacts(p));
    out.push(
      outcome === null || outcome === undefined || outcome === "success"
        ? line
        : `tool error: ${line}`,
    );
  }
  // else: task lifecycle and bookkeeping are not pane output
  return out.length > 0 ? out : null;
}

function flushSaid(stamp: boolean): void {
  // The stream ended mid-message: nothing left to flush the buffer, and nothing more can
  // arrive to split it, so print what the model said since the last tool call.
  if (pyTrim(museSaid) !== "") {
    for (const ln of wrapped(`says: ${pyTrim(museSaid)}`, stamp)) console.log(ln);
    museSaid = "";
  }
}

let lastSaid = ""; // the most recent shown says: text, so a restating result need not repeat it

const mimoSessions = new Set<unknown>();

function mimo(e: Ev): string[] | null {
  // mimo (mimo run --format json): every event carries its sessionID and a part
  const t = e.type;
  const part = asRecord(e.part);
  const out: string[] = [];
  const sid = e.sessionID;
  if (sid && !mimoSessions.has(sid)) {
    mimoSessions.add(sid);
    out.push(`session ${pyStr(sid)}`);
  }
  if (t === "text" && pyTrim(strOrEmpty(part.text)) !== "") {
    out.push(`says: ${strOrEmpty(part.text)}`);
  } else if (t === "tool_use") {
    const state = asRecord(part.state);
    out.push(
      state.status === "error"
        ? `tool error: ${pyStr(part.tool)}`
        : toolLine(part.tool, state.input),
    );
  } else if (t === "step_finish" && part.reason === "stop") {
    out.push("done");
  } else if (t === "error") {
    const err = asRecord(e.error);
    out.push(`error: ${short(asRecord(err.data).message || err.name || pyDumps(err))}`);
  }
  return out.length > 0 ? out : null;
}

const GENERIC = Symbol("generic");
let lastGeneric: string | null = null;

const MIMO_TYPES = ["step_start", "step_finish", "text", "tool_use", "error"];

function render(e: Ev): string | string[] | null | typeof GENERIC {
  if ("payload_type" in e) return muse(e);
  if ("sessionID" in e && MIMO_TYPES.includes(e.type as string)) {
    return mimo(e);
  }
  const t = e.type;
  if (typeof t === "string" && QUIET.has(t)) return null;
  // claude (claude -p --output-format stream-json)
  if (t === "system") {
    const st = e.subtype;
    if (st === "init") return `session ${pyStr(e.session_id)} · ${pyStr(e.model)}`;
    if (st === "compact_boundary") return "context compacted";
    return null;
  }
  if (
    (t === "assistant" || t === "user") &&
    e.message !== null &&
    typeof e.message === "object" &&
    !Array.isArray(e.message)
  ) {
    const msg = e.message as Ev;
    const lines: string[] = [];
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      if (b === null || typeof b !== "object") continue;
      const blk = b as Ev;
      const k = blk.type;
      if (t === "assistant" && k === "text" && pyTrim(strOrEmpty(blk.text)) !== "") {
        const said = strOrEmpty(blk.text);
        lines.push(`says: ${said}`);
        lastSaid = pyTrim(said);
      } else if (t === "assistant" && k === "tool_use") {
        lines.push(toolLine(blk.name, blk.input));
      } else if (t === "user" && k === "tool_result" && blk.is_error) {
        lines.push(`tool error: ${short(textOf(blk.content))}`);
      }
    }
    return lines.length > 0 ? lines : null;
  }
  if (t === "result") {
    const parts: string[] = [pyStr(e.subtype || e.status || (e.is_error ? "error" : "done"))];
    const turns = e.num_turns;
    if (typeof turns === "number" && Number.isInteger(turns)) parts.push(`${turns} turns`);
    else if (typeof turns === "boolean") parts.push(`${turns ? 1 : 0} turns`);
    const cost = e.total_cost_usd;
    const dollars = typeof cost === "boolean" ? (cost ? 1 : 0) : cost;
    if (typeof dollars === "number") parts.push(`$${fmtCost(dollars)}`);
    if (e.result) {
      const result = pyStr(e.result);
      if (pyTrim(result) !== lastSaid) parts.push(result); // a restating result need not repeat it
    }
    return `result: ${parts.join(" · ")}`;
  }
  if (t === "rate_limit_event") {
    const status = asRecord(e.rate_limit_info).status;
    return status === null || status === undefined || status === "allowed"
      ? null
      : `rate limit: ${pyStr(status)}`;
  }
  // codex (codex exec --json)
  if (t === "thread.started") return `session ${pyStr(e.thread_id)}`;
  if (t === "item.started" || t === "item.completed") {
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
        .filter((c) => c !== null && typeof c === "object" && !Array.isArray(c))
        .map((c) => strOrEmpty((c as Ev).path))
        .filter((p) => pyTrim(p) !== "");
      return paths.length > 0 ? `edit: ${paths.join(", ")}` : null;
    }
    if (k === "mcp_tool_call") return `tool: ${pyStr(it.server)}.${pyStr(it.tool)}`;
    if (k === "web_search") return `search: ${short(it.query)}`;
    if (k === "error") return `error: ${short(it.message)}`;
    return null;
  }
  if (t === "turn.completed") {
    const u = asRecord(e.usage);
    const tokIn = "input_tokens" in u ? pyStr(u.input_tokens) : "?";
    const tokOut = "output_tokens" in u ? pyStr(u.output_tokens) : "?";
    return `turn done · ${tokIn} tokens in, ${tokOut} out`;
  }
  if (t === "turn.failed") return `turn failed: ${short(asRecord(e.error).message)}`;
  if (t === "error") return `error: ${short(e.message || pyDumps(e))}`;
  // pi (pi --mode json)
  if (t === "session") return `session ${pyStr(e.id)}`;
  if (t === "tool_execution_start") return toolLine(e.toolName, e.args);
  if (t === "tool_execution_end") {
    return e.isError ? `tool error: ${pyStr(e.toolName)}` : null;
  }
  if (t === "message_end") {
    const m = asRecord(e.message);
    if (m.role !== "assistant") return null;
    const content = Array.isArray(m.content) ? m.content : [];
    const said = textOf(
      content.filter((b) => b !== null && typeof b === "object" && (b as Ev).type === "text"),
    );
    return pyTrim(said) !== "" ? `says: ${said}` : null;
  }
  if (t === "agent_end") return "done";
  if (t === "auto_retry_start") return `retrying: ${short(strOrEmpty(e.errorMessage))}`;
  if (t === "auto_compaction_start") return "compacting context";
  return GENERIC;
}

function generic(e: Ev): string | null {
  const t = pyStr(e.type || e.event || "event");
  if (t === lastGeneric) return null;
  lastGeneric = t;
  for (const key of ["text", "message", "content", "result", "name", "tool_name", "command"]) {
    const v = e[key];
    if (typeof v === "string" && pyTrim(v) !== "") return `${t}: ${short(v)}`;
  }
  return t;
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

function inRanges(ranges: Array<readonly [number, number]>, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Terminal cells: wide characters take two, combining marks none. */
export function cellWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (!inRanges(COMBINING, cp)) w += inRanges(WIDE, cp) ? 2 : 1;
  }
  return w;
}

function fit(line: string): string[] {
  // A wrapped line that still exceeds the pane holds wide characters (textwrap counts
  // code points): split it on cell boundaries. Only overflow lines reach here, so plain
  // text keeps textwrap's word breaks and wide text breaks anywhere, as it should.
  if (cellWidth(line) <= width) return [line];
  const chunks: string[] = [];
  let cur = "";
  let curW = 0;
  for (const c of line) {
    const w = cellWidth(c);
    if (cur !== "" && curW + w > width) {
      chunks.push(cur);
      cur = "";
      curW = 0;
    }
    cur += c;
    curW += w;
  }
  chunks.push(cur);
  return chunks;
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
function textWrap(text: string, w: number, indent: string): string[] {
  const chunks = text.split(WORDSEP_SIMPLE).filter((c) => c !== "");
  chunks.reverse();
  const lines: string[] = [];
  while (chunks.length > 0) {
    const curLine: string[] = [];
    let curLen = 0;
    const ind = lines.length > 0 ? indent : "";
    const lw = w - cpLen(ind);
    while (chunks.length > 0) {
      const l = cpLen(chunks[chunks.length - 1]!);
      if (curLen + l <= lw) {
        curLine.push(chunks.pop()!);
        curLen += l;
      } else break;
    }
    if (chunks.length > 0 && cpLen(chunks[chunks.length - 1]!) > lw) {
      const spaceLeft = lw < 1 ? 1 : lw - curLen;
      const chunk = chunks[chunks.length - 1]!;
      const [head, tail] = cpSlice(chunk, spaceLeft);
      curLine.push(head);
      chunks[chunks.length - 1] = tail;
      curLen = curLine.reduce((a, c) => a + cpLen(c), 0);
    }
    if (curLine.length > 0) lines.push(ind + curLine.join(""));
  }
  return lines;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function wrapped(s: string, stamp: boolean): string[] {
  // Content wraps to width in terminal cells; the timestamp rides outside it, so a
  // followed line is at most width + 9, inside the pane. Continuation lines indent.
  const prefix = stamp ? `${timestamp()} ` : "";
  // The indent stays below the width: textwrap never returns once the indent reaches
  // it, which a ten-column pane would otherwise cause.
  const indent = "  ".slice(0, Math.max(0, width - 1));
  const lines: string[] = [];
  for (const sourceLine of visibleText(s).split("\n")) {
    const parts = textWrap(sourceLine, width, indent);
    for (const part of parts.length > 0 ? parts : [""]) {
      lines.push(...fit(part));
    }
  }
  return lines.map((ln) => (ln !== "" ? prefix + ln : prefix === "" ? "" : prefix.slice(0, -1)));
}

const TRAILING_NL = /[\r\n]+$/u;

function show(line: string, stamp: boolean): void {
  const stripped = line.replace(TRAILING_NL, "");
  if (pyTrim(stripped) === "") return;
  let e: unknown = null;
  try {
    e = JSON.parse(stripped);
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
    out = short(stripped);
  }
  const items = Array.isArray(out) ? out : out ? [out] : [];
  for (const one of items) {
    for (const ln of wrapped(one, stamp)) console.log(ln);
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

const INT_SIGN_BODY = /^([+-]?)(.+)$/u;
const UNDERSCORE = /_/gu;

/** A COLUMNS value the way os.get_terminal_size reads it: full int() syntax (surrounding
 * whitespace, a sign, underscores, non-ASCII digits), and only a positive value counts. */
function parseColumns(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = INT_SIGN_BODY.exec(pyTrim(raw));
  if (!m || m[1] === "-" || m[2]!.startsWith("_") || m[2]!.endsWith("_") || m[2]!.includes("__")) {
    return null;
  }
  let digits: string;
  try {
    digits = digitValue(m[2]!.replace(UNDERSCORE, ""));
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

/** Incremental UTF-8 decoding over whole decode() calls: a trailing partial sequence (at most
 * three bytes) is held for the next feed, so a multibyte character split across reads decodes
 * whole. Only strict prefixes of a sequence hold; everything decoded now reads the same with
 * more bytes after it, so this is streaming decode exactly. Invalid bytes become U+FFFD. */
function utf8Stream(): { feed: (bytes: Uint8Array, final: boolean) => string } {
  const dec = new TextDecoder("utf-8");
  let carry = new Uint8Array(0);
  const feed = (bytes: Uint8Array, final: boolean): string => {
    const raw = new Uint8Array(carry.length + bytes.length);
    raw.set(carry, 0);
    raw.set(bytes, carry.length);
    if (final) {
      carry = new Uint8Array(0);
      return dec.decode(raw);
    }
    let hold = 0;
    for (let i = Math.max(0, raw.length - 3); i < raw.length; i++) {
      const b = raw[i]!;
      if (b < 0x80 || b >= 0xc0) {
        const need = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
        hold = raw.length - i < need ? raw.length - i : 0;
      }
    }
    carry = raw.slice(raw.length - hold);
    return dec.decode(raw.slice(0, raw.length - hold));
  };
  return { feed };
}

const LINE_BOUNDARY = /\r\n|[\n\r]/u;

/** Split off every complete line the way a text-mode file's readline reads them: universal
 * newlines, so CR and CRLF end a line too. A trailing CR may still pair with the next chunk's
 * LF, so it stays pending. (Stdin iteration splits on LF only; that branch does not use this.) */
function popCompleteLines(buf: string): [string[], string] {
  let hold = "";
  if (buf.endsWith("\r")) {
    hold = "\r";
    buf = buf.slice(0, -1);
  }
  const parts = buf.split(LINE_BOUNDARY);
  const rest = (parts.pop() ?? "") + hold;
  return [parts, rest];
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
  if (follow) {
    const columns = termColumns();
    // Content keeps a 40-column floor where the pane fits it; in a narrower pane the
    // timestamp's 9 columns come out of the content, so a followed line stays inside.
    width = Math.min(Math.max(40, columns - 10), Math.max(1, columns - 9));
  } else {
    width = 160;
  }

  if (!follow) {
    const utf8 = utf8Stream();
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
      pending += utf8.feed(buf.subarray(0, n), false);
      // Stdin iteration splits on LF only: a CR rides inside the line until show() strips it
      // (trailing) or drops it (mid-line, via visible_text).
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const l of parts) show(l, false);
    }
    pending += utf8.feed(new Uint8Array(0), true);
    if (pending !== "") show(pending, false);
    flushSaid(false);
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
    const utf8 = utf8Stream();
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
        buf += utf8.feed(chunk.subarray(0, n), false);
        const [lines, rest] = popCompleteLines(buf);
        buf = rest;
        for (const l of lines) show(l, true);
        continue;
      }
      if (!alive(pid!)) {
        // whatever landed between the last read and the exit
        const tail = utf8.feed(readRemaining(fd, pos), true);
        for (const line of pySplitLines(buf + tail)) {
          show(line, true);
        }
        flushSaid(true);
        break;
      }
      sleep(200);
    }
  } finally {
    closeSync(fd);
  }
  return 0;
}

function readRemaining(fd: number, pos: number): Uint8Array {
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
  return Buffer.concat(parts);
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (import.meta.main) {
  if (argv[0] === "-h" || argv[0] === "--help") {
    const selfSrc = readFileSync(join(scriptsDir(import.meta), "view-stream.ts"), "utf8");
    for (const l of selfSrc.split("\n").slice(0, 18)) console.log(l.replace(/^\/\/ ?/u, ""));
    process.exit(0);
  } else {
    process.exit(view(argv));
  }
}
