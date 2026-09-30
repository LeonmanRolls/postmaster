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
// Recording is best-effort like export-session.sh: a fault warns and leaves the launch's own
// exit alone. `sum` is what the closing record quotes; it never invents a figure.
//
//   exit 0  read, recorded or summed
//   exit 1  usage, an unreadable stream or dispatch
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export type UsageFigures = {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
};

export type UsageRole = "workhorse" | "reviewer" | "coachman";

export type UsageRecord = UsageFigures & {
  schema_version: 1;
  name: string;
  harness: string;
  role: UsageRole;
  lane: string;
  stream: string;
  read_error?: "session-record-unavailable";
};

type Row = Record<string, unknown>;
type UsageKey = keyof UsageFigures;

const USAGE_KEYS: UsageKey[] = ["input_tokens", "output_tokens", "cost_usd"];
const HARNESSES = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"];
const ROLES: UsageRole[] = ["workhorse", "reviewer", "coachman"];

const isObject = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const figureValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const at = (row: unknown, ...path: string[]): unknown => {
  let current: unknown = row;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
};

const firstFigure = (...candidates: unknown[]): number | undefined => {
  for (const candidate of candidates) {
    const value = figureValue(candidate);
    if (value !== undefined) return value;
  }
  return undefined;
};

const tokenFigures = (source: unknown): UsageFigures => {
  if (!isObject(source)) return {};
  const input = firstFigure(source.input_tokens, source.input, source.prompt_tokens);
  const output = firstFigure(source.output_tokens, source.output, source.completion_tokens);
  return {
    ...(input === undefined ? {} : { input_tokens: input }),
    ...(output === undefined ? {} : { output_tokens: output }),
  };
};

const costFigures = (...candidates: unknown[]): UsageFigures => {
  const cost = firstFigure(...candidates);
  return cost === undefined ? {} : { cost_usd: cost };
};

const mergeFigures = (all: UsageFigures[]): UsageFigures => {
  const total = (key: UsageKey): number | undefined => {
    const values = all.flatMap((figures) => figures[key] === undefined ? [] : [figures[key] as number]);
    return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0);
  };
  return {
    ...(total("input_tokens") === undefined ? {} : { input_tokens: total("input_tokens") }),
    ...(total("output_tokens") === undefined ? {} : { output_tokens: total("output_tokens") }),
    ...(total("cost_usd") === undefined ? {} : { cost_usd: total("cost_usd") }),
  };
};

const hasFigure = (figures: UsageFigures): boolean =>
  figures.input_tokens !== undefined || figures.output_tokens !== undefined || figures.cost_usd !== undefined;

const jsonRows = (content: string): Row[] => {
  const rows: Row[] = [];
  const stripped = content.replace(/^\s+/, "");
  if (!stripped) return rows;
  try {
    const document: unknown = JSON.parse(stripped);
    if (Array.isArray(document)) return document.filter(isObject);
    if (isObject(document) && Array.isArray(document.events)) return document.events.filter(isObject);
    if (isObject(document)) return [document];
  } catch {
    // Not one JSON document: JSONL below.
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isObject(parsed)) rows.push(parsed);
    } catch {
      // A line that is not JSON is not a usage record.
    }
  }
  return rows;
};

// Codex reports cumulative session usage on every terminal turn event: the last one carrying
// figures is the run's total, and summing turns counts every token twice. A terminal without
// usage is skipped, never read as zero. Verified against a rollout whose session total matched
// its last turn's figures to the unit.
const readCodex = (rows: Row[]): UsageFigures => {
  const terminal = rows.filter((row) =>
    row.type === "turn.completed" || row.type === "turn.failed" || row.type === "turn.interrupted");
  for (let i = terminal.length - 1; i >= 0; i--) {
    const figures = tokenFigures(terminal[i]?.usage);
    if (hasFigure(figures)) return figures;
  }
  return {};
};

// Claude reports each invocation on its own result event: usage there is per-invocation,
// while total_cost_usd is cumulative across the session. A resumed thread appends a new
// result to the same stream, so tokens are summed across results and cost is taken from the
// last one; summing cost would count every invocation twice. Verified against a live resumed
// thread whose three results read out 5, 4, 5 with costs 0.1048, 0.1940, 0.1995. A stream that
// ends without a result (killed mid-run) is summed from its assistant messages instead.
const readClaude = (rows: Row[]): UsageFigures => {
  const results = rows.filter((row) => row.type === "result");
  if (results.length > 0) {
    const last = results[results.length - 1] as Row;
    return {
      ...mergeFigures(results.map((row) => tokenFigures((row as Row).usage))),
      ...costFigures(last.total_cost_usd),
    };
  }
  return mergeFigures(rows.flatMap((row) => {
    if (row.type !== "assistant") return [];
    const message = at(row, "message");
    if (!isObject(message) || message.role !== "assistant") return [];
    return [tokenFigures(message.usage)];
  }));
};

// MiMo Code puts per-step tokens and cost on each step_finish part; the launch is their sum.
const readMimo = (rows: Row[]): UsageFigures =>
  mergeFigures(rows.flatMap((row) => {
    if (row.type !== "step_finish") return [];
    const part = at(row, "part");
    if (!isObject(part)) return [];
    return [{ ...tokenFigures(part.tokens), ...costFigures(part.cost) }];
  }));

// Muse Code reports model tokens in the session record's model_completed events, not in the
// event stream. goal_usage_attribution repeats those values per call; reading both would count
// every token twice, so the reader takes model_completed alone. Verified against a recorded
// export whose model_completed sum matched its reported attributions exactly.
const readMuse = (rows: Row[]): UsageFigures => {
  const events = rows.flatMap((row) => {
    const payload = at(row, "envelope", "payload") ?? row.payload ?? row;
    const event = at(payload, "event");
    return isObject(event) ? [event] : [];
  });
  return mergeFigures(events.flatMap((event) =>
    event.kind === "model_completed" ? [tokenFigures(event.usage)] : []));
};

// Pi carries usage on the assistant message of message_end.
const readPi = (rows: Row[]): UsageFigures =>
  mergeFigures(rows.flatMap((row) => {
    if (row.type !== "message_end") return [];
    const message = at(row, "message");
    if (!isObject(message) || message.role !== "assistant") return [];
    const usage = at(message, "usage");
    if (!isObject(usage)) return [];
    return [{ ...tokenFigures(usage), ...costFigures(at(usage, "cost", "total"), usage.cost) }];
  }));

// Grok's terminal end event carries the run's usage; chunk-level usage is ignored so a
// repeated report is never counted twice. The last end carrying a figure wins; an end without
// one is skipped, never read as zero.
const readGrok = (rows: Row[]): UsageFigures => {
  const ends = rows.filter((row) => row.type === "end");
  for (let i = ends.length - 1; i >= 0; i--) {
    const last = ends[i] as Row;
    const figures = {
      ...tokenFigures(at(last, "usage") ?? at(last, "token_usage")),
      ...costFigures(at(last, "total_cost_usd"), at(at(last, "usage"), "cost_usd")),
    };
    if (hasFigure(figures)) return figures;
  }
  return {};
};

// Antigravity reports cumulative session usage on each result event; the last one carrying
// a figure wins, in usageMetadata or usage shape. A result without one is skipped, never zero.
const readAgy = (rows: Row[]): UsageFigures => {
  const results = rows.filter((row) => row.event === "result" || row.type === "result");
  for (let i = results.length - 1; i >= 0; i--) {
    const figures = agyFigures(results[i] as Row);
    if (hasFigure(figures)) return figures;
  }
  return {};
};

const agyFigures = (last: Row): UsageFigures => {
  const inner = at(last, "result") ?? last;
  const metadata = at(inner, "usageMetadata");
  if (isObject(metadata)) {
    const input = firstFigure(metadata.promptTokenCount);
    const output = firstFigure(metadata.candidatesTokenCount);
    return {
      ...(input === undefined ? {} : { input_tokens: input }),
      ...(output === undefined ? {} : { output_tokens: output }),
    };
  }
  return tokenFigures(at(inner, "usage") ?? at(last, "usage"));
};

const READERS: Record<string, (rows: Row[]) => UsageFigures> = {
  codex: readCodex,
  grok: readGrok,
  agy: readAgy,
  claude: readClaude,
  pi: readPi,
  muse: readMuse,
  mimo: readMimo,
};

export const readHarnessUsage = (harness: string, eventsContent: string, sessionContent?: string): UsageFigures => {
  const read = READERS[harness];
  if (!read) throw new Error(`unknown harness: ${harness}`);
  if (harness === "muse") {
    return sessionContent === undefined ? {} : read(jsonRows(sessionContent));
  }
  return read(jsonRows(eventsContent));
};

const safeName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);

const regularFile = (path: string): boolean => {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};

const regularDir = (path: string): boolean => {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};

const museSessionId = (rows: Row[]): string | undefined => {
  for (const row of rows) {
    const stream = at(row, "stream");
    if (!isObject(stream) || stream.kind !== "session") continue;
    if (typeof stream.id === "string" && safeName(stream.id)) return stream.id;
  }
  return undefined;
};

export const makeUsageRecord = (input: {
  harness: string;
  name: string;
  role: string;
  lane: string;
  eventsPath: string;
  dispatch: string;
}): UsageRecord => {
  const { harness, name, role, lane, eventsPath, dispatch } = input;
  if (!HARNESSES.includes(harness)) throw new Error(`unknown harness: ${harness}`);
  if (!ROLES.includes(role as UsageRole)) throw new Error("role must be workhorse, reviewer or coachman");
  if (!safeName(name)) throw new Error("name must be a lane or role name");
  if (!safeName(lane)) throw new Error("lane must be a safe name");
  if (!regularFile(eventsPath)) throw new Error(`no such events stream: ${eventsPath}`);
  if (!regularDir(dispatch)) throw new Error(`no such dispatch directory: ${dispatch}`);

  const eventsContent = readFileSync(eventsPath, "utf8");
  let figures: UsageFigures = {};
  let readError: UsageRecord["read_error"];
  if (harness === "muse") {
    const sessionId = museSessionId(jsonRows(eventsContent));
    const sessionPath = sessionId === undefined ? undefined : join(dispatch, "sessions", name, `${sessionId}.json`);
    if (sessionPath === undefined || !regularFile(sessionPath)) {
      readError = "session-record-unavailable";
    } else {
      figures = readHarnessUsage(harness, eventsContent, readFileSync(sessionPath, "utf8"));
    }
  } else {
    figures = readHarnessUsage(harness, eventsContent);
  }
  return {
    schema_version: 1,
    name,
    harness,
    role: role as UsageRole,
    lane,
    stream: `logs/${basename(eventsPath)}`,
    ...figures,
    ...(readError ? { read_error: readError } : {}),
  };
};

export const recordPath = (dispatch: string, eventsPath: string): string => {
  let stem = basename(eventsPath);
  if (stem.endsWith(".jsonl")) stem = stem.slice(0, -".jsonl".length);
  return join(dispatch, "logs", `${stem}-usage.json`);
};

export const writeUsageRecord = (input: Parameters<typeof makeUsageRecord>[0]): UsageRecord => {
  const record = makeUsageRecord(input);
  const logs = join(input.dispatch, "logs");
  mkdirSync(logs, { recursive: true });
  if (!regularDir(logs)) throw new Error("logs is not a regular directory");
  const destination = recordPath(input.dispatch, input.eventsPath);
  if (!regularFile(destination) && lstatSync(destination, { throwIfNoEntry: false }) !== undefined) {
    throw new Error("usage record destination is not a regular file");
  }
  const temporary = join(logs, `.${basename(destination)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
  return record;
};

const validateRecord = (value: unknown): UsageRecord | undefined => {
  if (!isObject(value)) return undefined;
  if (value.schema_version !== 1 || typeof value.harness !== "string" || !HARNESSES.includes(value.harness)) return undefined;
  if (!ROLES.includes(value.role as UsageRole)) return undefined;
  if (typeof value.name !== "string" || typeof value.lane !== "string" || typeof value.stream !== "string") return undefined;
  const figures: UsageFigures = {};
  for (const key of USAGE_KEYS) {
    if (value[key] === undefined) continue;
    const figure = figureValue(value[key]);
    if (figure === undefined) return undefined;
    figures[key] = figure;
  }
  return {
    schema_version: 1,
    name: value.name,
    harness: value.harness,
    role: value.role as UsageRole,
    lane: value.lane,
    stream: value.stream,
    ...figures,
    ...(value.read_error === "session-record-unavailable" ? { read_error: value.read_error } : {}),
  };
};

// Money prints as a plain decimal, never scientific: fixed places with trailing zeros
// trimmed. A reported nonzero cost must never print as $0, so precision extends past 9
// places until a digit survives.
const formatMoney = (value: number): string => {
  if (value === 0) return "$0";
  let decimals = 9;
  let text = "0";
  while (text === "0" && decimals <= 100) {
    text = value.toFixed(decimals).replace(/\.?0+$/, "");
    decimals++;
  }
  return `$${text}`;
};

const formatCoverage = (records: UsageRecord[], key: UsageKey): string => {
  const reported = records.flatMap((record) => record[key] === undefined ? [] : [record[key] as number]);
  if (reported.length === 0) return key === "cost_usd" ? "cost not reported" : "not reported";
  const total = reported.reduce((sum, value) => sum + value, 0);
  const shown = key === "cost_usd" ? formatMoney(total) : String(total);
  return reported.length === records.length ? shown : `${shown} (${reported.length} of ${records.length} launches)`;
};

export const sumUsageRecords = (records: UsageRecord[]): string => {
  if (records.length === 0) return "cost: no launch usage records";
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = `${record.role} ${record.lane}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const lines = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => {
      const first = group[0] as UsageRecord;
      const harnesses = [...new Set(group.map((record) => record.harness))].sort().join(", ");
      const unreadable = group.filter((record) => record.read_error).length;
      const suffix = unreadable === 0 ? "" : `; usage unreadable for ${unreadable} ${unreadable === 1 ? "launch" : "launches"}`;
      return `cost: ${first.role} ${first.lane} (${harnesses}): `
        + `${formatCoverage(group, "input_tokens")} in, `
        + `${formatCoverage(group, "output_tokens")} out, `
        + `${formatCoverage(group, "cost_usd")}${suffix}`;
    });
  const harnessLines = [...new Set(records.map((record) => record.harness))].sort().flatMap((harness) => {
    const owned = records.filter((record) => record.harness === harness);
    if (owned.some((record) => USAGE_KEYS.some((key) => record[key] !== undefined))) return [];
    const unreadable = owned.filter((record) => record.read_error).length;
    if (unreadable > 0) return [`cost: harness ${harness} usage unreadable for ${unreadable} ${unreadable === 1 ? "launch" : "launches"}`];
    return [`cost: harness ${harness} reports nothing`];
  });
  return [...lines, ...harnessLines].join("\n");
};

export const sumDispatch = (dispatch: string): string => {
  if (!regularDir(dispatch)) throw new Error(`no such dispatch directory: ${dispatch}`);
  const logs = join(dispatch, "logs");
  if (!regularDir(logs)) throw new Error(`no such logs directory: ${logs}`);
  const unreadable: string[] = [];
  const records = readdirSync(logs).sort().flatMap((file) => {
    if (!file.endsWith("-usage.json")) return [];
    const path = join(logs, file);
    if (!regularFile(path)) {
      unreadable.push(`cost: ${file} could not be read`);
      return [];
    }
    try {
      const record = validateRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
      if (!record) unreadable.push(`cost: ${file} could not be read`);
      return record ? [record] : [];
    } catch {
      unreadable.push(`cost: ${file} could not be read`);
      return [];
    }
  });
  return [...unreadable, sumUsageRecords(records)].join("\n");
};

const readCommand = (args: string[]): void => {
  if (args.length < 2 || args.length > 3) throw new Error("usage: read <events> <harness> [<session>]");
  const [eventsPath, harness, sessionPath] = args as [string, string, string?];
  if (!regularFile(eventsPath)) throw new Error(`no such events stream: ${eventsPath}`);
  if (sessionPath !== undefined && !regularFile(sessionPath)) throw new Error(`no such session record: ${sessionPath}`);
  const sessionContent = sessionPath === undefined ? undefined : readFileSync(sessionPath, "utf8");
  console.log(JSON.stringify(readHarnessUsage(harness, readFileSync(eventsPath, "utf8"), sessionContent)));
};

const recordCommand = (args: string[]): void => {
  let role = "";
  let lane = "";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--role" || arg === "--lane") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`record: ${arg} needs a value`);
      i++;
      if (arg === "--role") role = value;
      else lane = value;
    } else {
      rest.push(arg);
    }
  }
  if (rest.length !== 4) throw new Error("usage: record <events> <harness> <name> <dispatch> --role <role> --lane <lane>");
  const [eventsPath, harness, name, dispatch] = rest as [string, string, string, string];
  if (!role || !lane) throw new Error("record needs --role and --lane from the launch site");
  const record = writeUsageRecord({ harness, name, role, lane, eventsPath, dispatch });
  // The record is saved, so this is exit 0: a nonzero exit would tell the launch site the
  // usage was not recorded. The read_error field and the sum's unreadable line carry the state.
  if (record.read_error) console.error("usage: session record is unavailable; usage record saved without figures");
};

const main = (args: string[]): void => {
  const [command, ...rest] = args;
  if (command === "read") return readCommand(rest);
  if (command === "record") return recordCommand(rest);
  if (command === "sum") {
    if (rest.length !== 1) throw new Error("usage: sum <dispatch>");
    console.log(sumDispatch(rest[0] as string));
    return;
  }
  throw new Error("usage: usage.ts read <events> <harness> [<session>] | record <events> <harness> <name> <dispatch> --role <role> --lane <lane> | sum <dispatch>");
};

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(`usage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
