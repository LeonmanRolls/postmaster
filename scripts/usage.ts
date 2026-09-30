#!/usr/bin/env bun
import { readFile, readdir, rename, writeFile, lstat, unlink } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type UsageFigures = {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
};

export type UsageRecord = UsageFigures & {
  schema_version: 1;
  harness: string;
  role: "workhorse" | "reviewer" | "coachman";
  lane: string;
  stream: string;
  read_error?: "session-record-unavailable";
};

type ObjectValue = Record<string, unknown>;
type UsageKey = keyof UsageFigures;

const USAGE_KEYS: UsageKey[] = ["input_tokens", "output_tokens", "cost_usd"];
const HARNESS_NAMES = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"];

const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue
    : undefined;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const reportedFigures = (source: unknown): UsageFigures => {
  const row = object(source);
  if (!row) return {};
  return {
    ...(numberValue(row.input_tokens) === undefined ? {} : { input_tokens: row.input_tokens as number }),
    ...(numberValue(row.output_tokens) === undefined ? {} : { output_tokens: row.output_tokens as number }),
  };
};

const reportedPiFigures = (source: unknown): UsageFigures => {
  const row = object(source);
  if (!row) return {};
  return {
    ...(numberValue(row.input) === undefined ? {} : { input_tokens: row.input as number }),
    ...(numberValue(row.output) === undefined ? {} : { output_tokens: row.output as number }),
  };
};

const costFigure = (source: unknown): UsageFigures => {
  const cost = numberValue(source);
  return cost === undefined ? {} : { cost_usd: cost };
};

const mergeFigures = (figures: UsageFigures[]): UsageFigures => {
  const total = (key: UsageKey): number | undefined => {
    const values = figures.flatMap((figures) => figures[key] === undefined ? [] : [figures[key]!]);
    return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0);
  };
  return {
    ...(total("input_tokens") === undefined ? {} : { input_tokens: total("input_tokens") }),
    ...(total("output_tokens") === undefined ? {} : { output_tokens: total("output_tokens") }),
    ...(total("cost_usd") === undefined ? {} : { cost_usd: total("cost_usd") }),
  };
};

const jsonLines = (content: string): unknown[] => content.split(/\r?\n/).flatMap((line) => {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line) as unknown];
  } catch {
    return [];
  }
});

const documentRecords = async (path: string): Promise<unknown[]> => {
  const content = await readFile(path, "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return jsonLines(content);
  }
};

const linesFromFile = async (path: string): Promise<unknown[]> =>
  jsonLines(await readFile(path, "utf8"));

const mapFigures = (records: unknown[], select: (record: ObjectValue) => UsageFigures | undefined) =>
  records.flatMap((value) => {
    const row = object(value);
    const figures = row && select(row);
    return figures ? [figures] : [];
  });

const codexUsage = (records: unknown[]): UsageFigures => mergeFigures(mapFigures(records, (event) => {
  if (!["turn.completed", "turn.failed", "turn.interrupted"].includes(String(event.type))) return undefined;
  return reportedFigures(event.usage);
}));

const grokUsage = (records: unknown[]): UsageFigures => mergeFigures(mapFigures(records, (event) => {
  if (event.type !== "end" || event.usage_is_incomplete === true) return undefined;
  const usage = reportedFigures(event.usage);
  return {
    ...usage,
    ...(event.cost_is_partial === true ? {} : costFigure(event.total_cost_usd)),
  };
}));

const agyUsage = (records: unknown[]): UsageFigures => {
  const results = records.flatMap((value) => {
    const event = object(value);
    if (!event || (event.event !== "result" && event.type !== "result")) return [];
    return [object(event.result)?.usage ?? event.usage];
  });
  return results.length === 0 ? {} : reportedFigures(results.at(-1));
};

const claudeUsage = (records: unknown[]): UsageFigures => {
  const usage = mapFigures(records, (event) => {
    if (event.type !== "assistant") return undefined;
    const message = object(event.message);
    if (message?.role !== "assistant") return undefined;
    return reportedFigures(message.usage);
  });
  const costs = mapFigures(records, (event) =>
    event.type === "result" ? costFigure(event.total_cost_usd) : undefined);
  return mergeFigures([...usage, ...costs]);
};

const piUsage = (records: unknown[]): UsageFigures => mergeFigures(mapFigures(records, (event) => {
  if (event.type !== "message_end") return undefined;
  const message = object(event.message);
  if (message?.role !== "assistant") return undefined;
  const usage = object(message.usage);
  return {
    ...reportedPiFigures(usage),
    ...costFigure(object(usage?.cost)?.total),
  };
}));

const findMuseUsage = (value: unknown): UsageFigures[] => {
  if (Array.isArray(value)) return value.flatMap(findMuseUsage);
  const row = object(value);
  if (!row) return [];
  const payload = object(row.payload);
  const event = object(payload?.event);
  const kind = event?.kind ?? (payload?.kind === "model_completed" ? payload.kind : undefined);
  const current = kind === "model_completed" ? [reportedFigures(event?.usage ?? payload?.usage)] : [];
  if (kind === "goal_usage_attribution" || event?.kind === "goal_usage_attribution") {
    return Object.values(row).filter((child) => child !== row.payload).flatMap(findMuseUsage);
  }
  return [...current, ...Object.values(row).flatMap(findMuseUsage)];
};

const museUsage = async (sessionRecord: string | undefined): Promise<UsageFigures> => {
  if (!sessionRecord) return {};
  return mergeFigures(findMuseUsage(await documentRecords(sessionRecord)));
};

const mimoUsage = (records: unknown[]): UsageFigures => mergeFigures(mapFigures(records, (event) => {
  if (event.type !== "step_finish") return undefined;
  const part = object(event.part);
  return {
    ...reportedPiFigures(part?.tokens),
    ...costFigure(part?.cost),
  };
}));

export const readHarnessUsage = async (
  harness: string,
  eventsPath: string,
  sessionRecord?: string,
): Promise<UsageFigures> => {
  if (!HARNESS_NAMES.includes(harness)) throw new Error(`unknown harness: ${harness}`);
  if (harness === "muse") return museUsage(sessionRecord);
  const records = await linesFromFile(eventsPath);
  switch (harness) {
    case "codex": return codexUsage(records);
    case "grok": return grokUsage(records);
    case "agy": return agyUsage(records);
    case "claude": return claudeUsage(records);
    case "pi": return piUsage(records);
    case "mimo": return mimoUsage(records);
    default: return {};
  }
};

const safeName = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);

const museSessionId = (records: unknown[]): string | undefined => {
  for (const value of records) {
    const stream = object(object(value)?.stream);
    const id = stream?.kind === "session" && typeof stream.id === "string" ? stream.id : undefined;
    if (id && safeName(id)) return id;
  }
  return undefined;
};

const isReported = (record: UsageRecord) => USAGE_KEYS.some((key) => record[key] !== undefined);

export const makeUsageRecord = async (input: {
  harness: string;
  role: UsageRecord["role"];
  lane: string;
  eventsPath: string;
  sessionDir?: string;
}): Promise<UsageRecord> => {
  const { harness, role, lane, eventsPath, sessionDir } = input;
  if (!HARNESS_NAMES.includes(harness)) throw new Error(`unknown harness: ${harness}`);
  if (!safeName(lane)) throw new Error("lane must be a safe name");
  if (!["workhorse", "reviewer", "coachman"].includes(role)) throw new Error("unknown role");

  const streamPath = resolve(eventsPath);
  const logsPath = dirname(streamPath);
  if (basename(logsPath) !== "logs" || !safeName(basename(streamPath))) {
    throw new Error("events stream must be a direct file in the run's logs directory");
  }
  const logsStat = await lstat(logsPath);
  const streamStat = await lstat(streamPath);
  if (logsStat.isSymbolicLink() || !logsStat.isDirectory() || streamStat.isSymbolicLink() || !streamStat.isFile()) {
    throw new Error("events stream and logs directory must be regular paths");
  }

  let figures: UsageFigures = {};
  let readError: UsageRecord["read_error"];
  if (harness === "muse") {
    if (!sessionDir) {
      readError = "session-record-unavailable";
    } else {
      const sessionDirectory = resolve(sessionDir);
      const sessionDirectoryStat = await lstat(sessionDirectory).catch(() => undefined);
      const sessionId = museSessionId(await linesFromFile(streamPath));
      if (!sessionDirectoryStat?.isDirectory() || sessionDirectoryStat.isSymbolicLink() || !sessionId) {
        readError = "session-record-unavailable";
      } else {
        const sessionPath = join(sessionDirectory, `${sessionId}.json`);
        const sessionStat = await lstat(sessionPath).catch(() => undefined);
        if (!sessionStat?.isFile() || sessionStat.isSymbolicLink()) {
          readError = "session-record-unavailable";
        } else {
          figures = await readHarnessUsage(harness, streamPath, sessionPath);
        }
      }
    }
  } else {
    figures = await readHarnessUsage(harness, streamPath);
  }

  return {
    schema_version: 1,
    harness,
    role,
    lane,
    stream: basename(streamPath),
    ...figures,
    ...(readError ? { read_error: readError } : {}),
  };
};

export const writeUsageRecord = async (input: Parameters<typeof makeUsageRecord>[0]) => {
  const record = await makeUsageRecord(input);
  const streamPath = resolve(input.eventsPath);
  const destination = `${streamPath}.usage.json`;
  const existing = await lstat(destination).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error("usage record destination is not a regular file");
  }
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return record;
};

const validateRecord = (value: unknown, source: string): UsageRecord => {
  const row = object(value);
  const role = row?.role;
  if (!row || row.schema_version !== 1 || typeof row.harness !== "string" || !HARNESS_NAMES.includes(row.harness)
    || !["workhorse", "reviewer", "coachman"].includes(String(role))
    || typeof row.lane !== "string" || typeof row.stream !== "string") {
    throw new Error(`invalid usage record: ${source}`);
  }
  const figures: UsageFigures = {};
  for (const key of USAGE_KEYS) {
    if (row[key] !== undefined) {
      const figure = numberValue(row[key]);
      if (figure === undefined) throw new Error(`invalid ${key} in usage record: ${source}`);
      figures[key] = figure;
    }
  }
  return {
    schema_version: 1,
    harness: row.harness,
    role: role as UsageRecord["role"],
    lane: row.lane,
    stream: row.stream,
    ...figures,
    ...(row.read_error === "session-record-unavailable" ? { read_error: row.read_error } : {}),
  };
};

const formatInteger = (value: number) => Number.isInteger(value) ? String(value) : String(value);
const formatCost = (value: number) => {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
  return `$${String(rounded)}`;
};
const formatCoverage = (records: UsageRecord[], key: UsageKey, format: (value: number) => string) => {
  const reported = records.flatMap((record) => record[key] === undefined ? [] : [record[key]!]);
  if (reported.length === 0) return "not reported";
  const suffix = reported.length === records.length ? "" : ` (${reported.length} of ${records.length} launches)`;
  return `${format(reported.reduce((sum, value) => sum + value, 0))}${suffix}`;
};

const formatCostCoverage = (records: UsageRecord[]) => {
  const reported = records.flatMap((record) => record.cost_usd === undefined ? [] : [record.cost_usd]);
  if (reported.length === 0) return "cost not reported";
  const suffix = reported.length === records.length ? "" : ` (${reported.length} of ${records.length} launches)`;
  return `${formatCost(reported.reduce((sum, value) => sum + value, 0))}${suffix}`;
};

export const sumUsageRecords = (records: UsageRecord[]): string => {
  if (records.length === 0) return "cost: no launch usage records";
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = `${record.role}\0${record.lane}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const lines = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const harnesses = [...new Set(group.map((record) => record.harness))].sort().join(", ");
    const label = group.length === 1 ? "launch" : "launches";
    const suffix = group.some((record) => record.read_error)
      ? `; usage unreadable for ${group.filter((record) => record.read_error).length} ${label}`
      : "";
    return `cost: ${group[0]!.role} ${group[0]!.lane} (${harnesses}): `
      + `${formatCoverage(group, "input_tokens", formatInteger)} in, `
      + `${formatCoverage(group, "output_tokens", formatInteger)} out, `
      + `${formatCostCoverage(group)}${suffix}`;
  });
  const harnesses = [...new Set(records.map((record) => record.harness))].sort();
  const harnessLines = harnesses.flatMap((harness) => {
    const owned = records.filter((record) => record.harness === harness);
    if (owned.some(isReported)) return [];
    const unreadable = owned.filter((record) => record.read_error).length;
    if (unreadable > 0) {
      const label = unreadable === 1 ? "launch" : "launches";
      return [`cost: harness ${harness} usage unreadable for ${unreadable} ${label}`];
    }
    return [`cost: harness ${harness} reports nothing`];
  });
  return [...lines, ...harnessLines].join("\n");
};

export const sumDispatch = async (dispatch: string): Promise<string> => {
  const root = resolve(dispatch);
  const logs = join(root, "logs");
  const rootStat = await lstat(root);
  const logsStat = await lstat(logs);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || logsStat.isSymbolicLink() || !logsStat.isDirectory()) {
    throw new Error("dispatch and logs must be regular directories");
  }
  const files = (await readdir(logs)).filter((file) => file.endsWith(".usage.json")).sort();
  const records = await Promise.all(files.map(async (file) => {
    const path = join(logs, file);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`usage record is not a regular file: ${file}`);
    return validateRecord(JSON.parse(await readFile(path, "utf8")) as unknown, file);
  }));
  return sumUsageRecords(records);
};

const readCommand = async (args: string[]) => {
  if (args.length !== 2 && args.length !== 3) throw new Error("usage: read <harness> <events> [session-record]");
  const usage = await readHarnessUsage(args[0]!, args[1]!, args[2]);
  console.log(JSON.stringify(usage));
};

const recordCommand = async (args: string[]) => {
  if (args.length !== 4 && args.length !== 5) {
    throw new Error("usage: record <harness> <role> <lane> <events> [session-dir]");
  }
  const [harness, role, lane, eventsPath, sessionDir] = args;
  const record = await writeUsageRecord({
    harness: harness!,
    role: role as UsageRecord["role"],
    lane: lane!,
    eventsPath: eventsPath!,
    ...(sessionDir ? { sessionDir } : {}),
  });
  if (record.read_error) throw new Error("session record is unavailable; usage record saved without figures");
};

const main = async (args: string[]) => {
  const [command, ...rest] = args;
  if (command === "read") return readCommand(rest);
  if (command === "record") return recordCommand(rest);
  if (command === "sum") {
    if (rest.length !== 1) throw new Error("usage: sum <dispatch>");
    console.log(await sumDispatch(rest[0]!));
    return;
  }
  throw new Error("usage: usage.ts read|record|sum ...");
};

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`usage: ${message}`);
    process.exitCode = 1;
  });
}
