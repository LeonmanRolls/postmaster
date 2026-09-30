#!/usr/bin/env bun
// Read what a launch cost from its harness's own event stream or session record, keep it in
// the run's records per role and lane, and sum it for the closing record. The per-harness
// reading lives here, behind the harness adapter (skills/postmaster/harnesses.md): this script
// is that reading's executable form. A figure the harness did not report is omitted and never
// written as zero; a harness that reports nothing is named as reporting nothing.
//
//   usage.ts read <events> <harness> [<session>]
//   usage.ts record <events> <harness> <name> <dispatch> --role <role> --lane <lane>
//   usage.ts sum <dispatch>
//
// Roles are workhorse, reviewer and coachman. A lane is the workhorse's or reviewer's lane
// name, or the coachman leg. Recording is best-effort like export-session.sh: a fault warns
// and leaves the launch's own exit alone. `sum` is what the closing record quotes; it never
// invents a figure.
//
//   exit 0  read, recorded or summed
//   exit 1  usage, an unreadable stream or dispatch
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type Figures = { input_tokens?: number; output_tokens?: number; cost_usd?: number };
type Row = Record<string, unknown>;

function die(message: string, code = 1): never {
  console.error("usage: " + message);
  process.exit(code);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && typeof value !== "boolean") return value;
  return undefined;
}

function take(dst: Figures, key: keyof Figures, value: unknown): void {
  const v = num(value);
  if (v !== undefined && dst[key] === undefined) dst[key] = v;
}

function add(dst: Figures, key: keyof Figures, value: unknown): void {
  const v = num(value);
  if (v === undefined) return;
  dst[key] = (dst[key] as number | undefined) === undefined ? v : (dst[key] as number) + v;
}

function loadRecords(path: string): Row[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    die(`cannot read ${path}: ${(e as Error).message}`);
  }
  const rows: Row[] = [];
  const stripped = text.replace(/^\s+/, "");
  if (!stripped) return rows;
  // A session export is one JSON document with an events list; an events stream is JSONL.
  try {
    const doc = JSON.parse(stripped);
    if (Array.isArray(doc)) return doc.filter((r): r is Row => r && typeof r === "object");
    if (doc && typeof doc === "object" && Array.isArray((doc as Row).events)) {
      for (const item of (doc as { events: unknown[] }).events) {
        if (item && typeof item === "object") rows.push(item as Row);
      }
      return rows;
    }
    if (doc && typeof doc === "object") return [doc as Row];
  } catch {
    // not one JSON document: JSONL below
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") rows.push(obj as Row);
    } catch {
      // a line that is not JSON is not a usage record
    }
  }
  return rows;
}

function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Row)[key];
  }
  return cur;
}

function payloadOf(record: Row): Row {
  for (const path of [["envelope", "payload"], ["payload"]]) {
    const p = dig(record, ...path);
    if (p && typeof p === "object") return p as Row;
  }
  return record;
}

function readClaude(rows: Row[]): Figures {
  // Claude reports the run on its result event: usage there, and total_cost_usd as cost.
  const out: Figures = {};
  const result: Figures = {};
  const perMessage: Figures = {};
  for (const r of rows) {
    const t = r.type;
    if (t === "result") {
      const u = r.usage;
      if (u && typeof u === "object") {
        take(result, "input_tokens", (u as Row).input_tokens);
        take(result, "output_tokens", (u as Row).output_tokens);
      }
      take(result, "cost_usd", r.total_cost_usd);
    } else if (t === "assistant") {
      const u = dig(r, "message", "usage");
      if (u && typeof u === "object") {
        add(perMessage, "input_tokens", (u as Row).input_tokens);
        add(perMessage, "output_tokens", (u as Row).output_tokens);
      }
    }
  }
  // The result is the run's own report. A stream that ends without one is summed from its
  // assistant messages instead.
  const from = result.input_tokens !== undefined || result.output_tokens !== undefined || result.cost_usd !== undefined
    ? result
    : perMessage;
  Object.assign(out, from);
  return out;
}

function readCodex(rows: Row[]): Figures {
  // Codex reports one usage object per turn.completed; the launch is their sum.
  const out: Figures = {};
  for (const r of rows) {
    if (r.type !== "turn.completed") continue;
    const u = r.usage;
    if (!u || typeof u !== "object") continue;
    add(out, "input_tokens", (u as Row).input_tokens);
    add(out, "output_tokens", (u as Row).output_tokens);
  }
  return out;
}

function readMimo(rows: Row[]): Figures {
  // MiMo Code puts tokens and cost on each step_finish part.
  const out: Figures = {};
  for (const r of rows) {
    if (r.type !== "step_finish") continue;
    const part = r.part;
    if (!part || typeof part !== "object") continue;
    const tokens = (part as Row).tokens;
    if (tokens && typeof tokens === "object") {
      add(out, "input_tokens", (tokens as Row).input);
      add(out, "output_tokens", (tokens as Row).output);
    }
    add(out, "cost_usd", (part as Row).cost);
  }
  return out;
}

function readMuse(rows: Row[]): Figures {
  // Muse Code reports model tokens in the session record's goal_usage_attribution, not in the
  // event stream (a tool result's original_output_tokens is tool output, not model usage).
  const out: Figures = {};
  for (const r of rows) {
    const p = payloadOf(r);
    const ev = p.event && typeof p.event === "object" ? (p.event as Row) : p;
    if (!ev || typeof ev !== "object" || ev.kind !== "goal_usage_attribution") continue;
    const rec = ev.record;
    let q: unknown = rec && typeof rec === "object" ? (rec as Row).quantity : undefined;
    if (!q || typeof q !== "object") q = ev.quantity;
    if (!q || typeof q !== "object") continue;
    if ((q as Row).reported === false) continue;
    add(out, "input_tokens", (q as Row).input_tokens);
    add(out, "output_tokens", (q as Row).output_tokens);
  }
  return out;
}

function readPi(rows: Row[]): Figures {
  // Pi carries usage on the assistant message (and on its own usage rows).
  const out: Figures = {};
  for (const r of rows) {
    if (r.type === "usage") {
      for (const candidate of [r.usage, dig(r, "row", "usage")]) {
        if (!candidate || typeof candidate !== "object") continue;
        const u = candidate as Row;
        const before = JSON.stringify(out);
        take(out, "input_tokens", u.input_tokens ?? u.input);
        take(out, "output_tokens", u.output_tokens ?? u.output);
        const cost = u.cost;
        take(out, "cost_usd", cost && typeof cost === "object" ? (cost as Row).total : cost);
        if (JSON.stringify(out) !== before) break;
      }
      continue;
    }
    if (r.type !== "message_end" && r.type !== "turn_end") continue;
    const m = r.message;
    if (!m || typeof m !== "object" || (m as Row).role !== "assistant") continue;
    const u = (m as Row).usage;
    if (!u || typeof u !== "object") continue;
    add(out, "input_tokens", (u as Row).input_tokens ?? (u as Row).input);
    add(out, "output_tokens", (u as Row).output_tokens ?? (u as Row).output);
    const cost = (u as Row).cost;
    add(out, "cost_usd", cost && typeof cost === "object" ? (cost as Row).total : cost);
  }
  return out;
}

function readAgy(rows: Row[]): Figures {
  // Gemini-family streams repeat one request's usageMetadata on its chunks; the last of each
  // run of identical figures is that request's report.
  const out: Figures = {};
  let last: string | null = null;
  for (const r of rows) {
    const um = r.usageMetadata ?? dig(r, "response", "usageMetadata") ?? dig(r, "message", "usageMetadata");
    if (!um || typeof um !== "object") continue;
    const pair = JSON.stringify([(um as Row).promptTokenCount, (um as Row).candidatesTokenCount]);
    if (pair === last) continue;
    last = pair;
    add(out, "input_tokens", (um as Row).promptTokenCount);
    add(out, "output_tokens", (um as Row).candidatesTokenCount);
  }
  return out;
}

function readGrok(rows: Row[]): Figures {
  // Grok's streaming-json carries usage under usage or token_usage, OpenAI-compatible names.
  const out: Figures = {};
  let last: string | null = null;
  for (const r of rows) {
    const u = r.usage ?? r.token_usage ?? dig(r, "message", "usage");
    if (!u || typeof u !== "object") continue;
    const row = u as Row;
    const pair = JSON.stringify([row.input_tokens ?? row.prompt_tokens, row.output_tokens ?? row.completion_tokens]);
    if (pair === last || pair === "[null,null]") continue;
    last = pair;
    add(out, "input_tokens", row.input_tokens ?? row.prompt_tokens);
    add(out, "output_tokens", row.output_tokens ?? row.completion_tokens);
    take(out, "cost_usd", row.cost_usd ?? row.total_cost_usd);
  }
  return out;
}

const readers: Record<string, (rows: Row[]) => Figures> = {
  claude: readClaude,
  codex: readCodex,
  mimo: readMimo,
  muse: readMuse,
  pi: readPi,
  agy: readAgy,
  grok: readGrok,
};

function readFigures(eventsPath: string, harness: string, sessionPath?: string): Figures {
  const read = readers[harness];
  if (!read) die(`unknown harness: ${harness}`);
  const figures = read(loadRecords(eventsPath));
  if (sessionPath) {
    const more = read(loadRecords(sessionPath));
    for (const key of Object.keys(more) as (keyof Figures)[]) {
      const value = more[key];
      if (value === undefined) continue;
      const prior = figures[key];
      // The stream and the session record can both carry the same report. Keep the larger
      // single reading rather than adding a figure twice.
      figures[key] = prior === undefined ? value : Math.max(prior, value);
    }
  }
  return figures;
}

function readCmd(argv: string[]): void {
  if (argv.length < 2 || argv.length > 3) die("read <events> <harness> [<session>]");
  const [events, harness, session] = argv;
  if (!existsSync(events)) die(`no such events stream: ${events}`);
  if (session !== undefined && !existsSync(session)) die(`no such session record: ${session}`);
  console.log(JSON.stringify(readFigures(events, harness, session)));
}

function recordCmd(argv: string[]): void {
  let role = "";
  let lane = "";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role" || a === "--lane") {
      const value = argv[++i];
      if (value === undefined) die(`record: ${a} needs a value`);
      if (a === "--role") role = value;
      else lane = value;
    } else {
      rest.push(a);
    }
  }
  if (rest.length !== 4) die("record <events> <harness> <name> <dispatch> --role <role> --lane <lane>");
  const [events, harness, name, dispatchRaw] = rest;
  if (!role || !lane) die("record needs --role and --lane from the launch site");
  if (!["workhorse", "reviewer", "coachman"].includes(role)) {
    die("record: role must be workhorse, reviewer or coachman");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) die("name must be a lane or role name");
  if (!existsSync(events)) die(`no such events stream: ${events}`);
  if (!existsSync(dispatchRaw)) die(`no such dispatch directory: ${dispatchRaw}`);
  const logs = join(dispatchRaw, "logs");
  mkdirSync(logs, { recursive: true });
  let stem = basename(events);
  if (stem.endsWith(".jsonl")) stem = stem.slice(0, -".jsonl".length);
  const outPath = join(logs, stem + "-usage.json");
  const figures = readFigures(events, harness);
  // Where the harness reports usage only in its session record (muse), the exported session
  // under <dispatch>/sessions/<name>/ is the reading. Merge it rather than adding it twice.
  const sessions = join(dispatchRaw, "sessions", name);
  if (existsSync(sessions)) {
    for (const entry of readdirSync(sessions)) {
      const path = join(sessions, entry);
      const more = readFigures(events, harness, path);
      for (const key of Object.keys(more) as (keyof Figures)[]) {
        const value = more[key];
        if (value === undefined) continue;
        const prior = figures[key];
        figures[key] = prior === undefined ? value : Math.max(prior, value);
      }
    }
  }
  const record: Record<string, unknown> = { name, role, lane, harness, stream: "logs/" + basename(events) };
  for (const key of ["input_tokens", "output_tokens", "cost_usd"] as const) {
    if (figures[key] !== undefined) record[key] = figures[key];
  }
  const tmp = join(logs, "." + basename(outPath) + ".tmp");
  writeFileSync(tmp, JSON.stringify(record) + "\n");
  renameSync(tmp, outPath);
}

function money(total: number): string {
  return Number.isInteger(total) ? `$${total}` : `$${total.toFixed(4)}`;
}

function figure(group: Group, fig: keyof Figures, label: string): string {
  const values = group.figures[fig];
  const launches = group.launches;
  if (values.length === 0) return fig === "cost_usd" ? "cost not reported" : `${label} not reported`;
  const total = values.reduce((a, b) => a + b, 0);
  const shown = fig === "cost_usd" ? money(total) : `${Number.isInteger(total) ? total : total} ${label}`;
  return values.length === launches ? shown : `${shown} (${values.length} of ${launches} launches)`;
}

type Group = {
  harnesses: string[];
  launches: number;
  figures: Record<keyof Figures, number[]>;
};

function sumCmd(argv: string[]): void {
  if (argv.length !== 1) die("sum <dispatch>");
  const dispatch = argv[0];
  const logs = join(dispatch, "logs");
  if (!existsSync(logs)) die(`no such dispatch directory: ${dispatch}`);
  const rows: Row[] = [];
  for (const entry of readdirSync(logs).sort()) {
    if (!entry.endsWith("-usage.json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(logs, entry), "utf8"));
      if (rec && typeof rec === "object") rows.push(rec as Row);
    } catch {
      console.log(`cost: ${entry} could not be read`);
    }
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  for (const rec of rows) {
    const role = String(rec.role ?? "workhorse");
    const lane = String(rec.lane ?? rec.name ?? "?");
    const harness = String(rec.harness ?? "?");
    const key = `${role}\u0000${lane}`;
    let g = groups.get(key);
    if (!g) {
      g = { harnesses: [], launches: 0, figures: { input_tokens: [], output_tokens: [], cost_usd: [] } };
      groups.set(key, g);
      order.push(key);
    }
    if (!g.harnesses.includes(harness)) g.harnesses.push(harness);
    g.launches += 1;
    for (const fig of ["input_tokens", "output_tokens", "cost_usd"] as const) {
      const v = num(rec[fig]);
      if (v !== undefined) g.figures[fig].push(v);
    }
  }
  const nothing: string[] = [];
  for (const rec of rows) {
    const has = ["input_tokens", "output_tokens", "cost_usd"].some((f) => num(rec[f]) !== undefined);
    if (!has) {
      const h = rec.harness ? String(rec.harness) : null;
      if (h && !nothing.includes(h)) nothing.push(h);
    }
  }
  for (const key of order) {
    const [role, lane] = key.split("\u0000");
    const g = groups.get(key)!;
    const parts = [
      figure(g, "input_tokens", "in"),
      figure(g, "output_tokens", "out"),
      figure(g, "cost_usd", "cost"),
    ];
    console.log(`cost: ${role} ${lane} (${g.harnesses.join(",")}): ${parts.join(", ")}`);
  }
  for (const h of nothing) console.log(`cost: harness ${h} reports nothing`);
  if (rows.length === 0) console.log("cost: no launch recorded usage");
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === "read") readCmd(argv.slice(1));
else if (cmd === "record") recordCmd(argv.slice(1));
else if (cmd === "sum") sumCmd(argv.slice(1));
else {
  die("usage: usage.ts read <events> <harness> [<session>] | record <events> <harness> <name> <dispatch> --role <role> --lane <lane> | sum <dispatch>");
}
