// Say, for a postmaster session, how long each of the user's messages waited
// before the postmaster saw it and before its answer was finished, and how
// many times the session's conversation was compacted. It reads Claude
// Code's own record of the session and prints times and counts only: never
// what a message said, and no path taken from inside a message.
//
//   responsiveness [<record-or-session-id>] [--harness <name>] [--repo <path>]
//
// With a path, that record is read. With a bare session id, the record is
// found the way the session export finds it, under CLAUDE_CONFIG_DIR or
// ~/.claude. With neither, the newest record in the target's project folder
// whose custom-title line names the postmaster is read. The per-harness
// reading lives here, behind the harness adapter (skills/postmaster/
// harnesses.md): only claude has a reader, and every other harness is
// reported as unsupported in one line with a non-zero exit.
//
//   exit 0  the report was printed
//   exit 1  an unsupported harness, no record found, or an unreadable record
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { findNativeRecord, findNewestPostmasterRecord } from "./lib/session-record.ts";

type Row = Record<string, unknown>;

export type MessageWait = {
  seenWaitMs: number | null;
  deliveredMs: number;
  answerWaitMs: number | null;
};

export type ResponsivenessReport = {
  messages: MessageWait[];
  compactions: number;
};

const HARNESSES = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"];

const isObject = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const at = (row: unknown, ...path: string[]): unknown => {
  let current: unknown = row;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
};

const timestampMs = (row: Row): number | null => {
  const value = row.timestamp;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const jsonRows = (content: string): Row[] => {
  const rows: Row[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isObject(parsed)) rows.push(parsed);
    } catch {
      // A line that is not JSON is not a record line.
    }
  }
  return rows;
};

// Claude Code's record, read from records written by Claude Code 2.1.275 to
// 2.1.301: a message typed mid-turn is a queue-operation enqueue (when it
// was typed), then a remove or dequeue (when it was delivered with the next
// tool result), then an attachment of type queued_command whose origin kind
// is human; a background task's end arrives the same way with kind
// task-notification and is not a user message. A message typed while the
// session is idle is a user line with origin kind human and promptSource
// typed. Each turn ends with a system line of subtype turn_duration, and
// each compaction is a system line of subtype compact_boundary. The wait
// before a message was seen runs from enqueue to its delivery; the wait for
// its answer runs from delivery to the next turn_duration.
type Queued = {
  deliveredMs: number | null;
  enqueueMs: number;
  kind: unknown;
  reported: boolean;
};

export const readClaude = (rows: Row[]): ResponsivenessReport => {
  const messages: MessageWait[] = [];
  let compactions = 0;
  // One entry per enqueue, in record order. Deliveries take enqueues in
  // order, and an attachment names the kind of the enqueue stamped nearest
  // its own time (an attachment carries its enqueue's timestamp, and can
  // sit in the record after that enqueue's delivery), so kind and delivery
  // are paired with the enqueue they belong to, never with each other.
  const queued: Queued[] = [];
  let unanswered: MessageWait[] = [];

  const deliver = (enqueueMs: number | null, deliveredMs: number): void => {
    const message: MessageWait = {
      answerWaitMs: null,
      deliveredMs,
      seenWaitMs: enqueueMs === null ? null : Math.max(0, deliveredMs - enqueueMs),
    };
    messages.push(message);
    unanswered.push(message);
  };

  const report = (entry: Queued): void => {
    if (entry.reported || entry.deliveredMs === null) return;
    entry.reported = true;
    deliver(entry.enqueueMs, entry.deliveredMs);
  };

  for (const row of rows) {
    const ts = timestampMs(row);
    if (row.type === "queue-operation" && ts !== null) {
      if (row.operation === "enqueue") {
        queued.push({ deliveredMs: null, enqueueMs: ts, kind: null, reported: false });
      } else if (row.operation === "remove" || row.operation === "dequeue") {
        const entry = queued.find((q) => q.deliveredMs === null);
        if (entry) entry.deliveredMs = ts;
      }
      continue;
    }
    if (row.type === "attachment" && at(row, "attachment", "type") === "queued_command") {
      const kind = at(row, "attachment", "origin", "kind");
      if (ts !== null) {
        let nearest: Queued | undefined;
        for (const entry of queued) {
          if (entry.kind !== null) continue;
          if (!nearest || Math.abs(ts - entry.enqueueMs) < Math.abs(ts - nearest.enqueueMs)) {
            nearest = entry;
          }
        }
        if (nearest) {
          nearest.kind = kind;
          if (kind === "human") report(nearest);
          continue;
        }
      }
      // No enqueue to name: a human attachment is still a user message,
      // timed from the earliest moment the record shows for it.
      if (kind === "human" && ts !== null) deliver(null, ts);
      continue;
    }
    if (row.type === "user" && at(row, "origin", "kind") === "human" && ts !== null) {
      if (row.promptSource === "typed") {
        deliver(null, ts);
        continue;
      }
      if (row.promptSource === "queued") {
        // The same message in user-row form: report the latest delivery
        // still waiting for its kind at or before this row, or stand
        // alone where there is none. A delivery already named, or one
        // from an earlier turn, never takes the row.
        let waiting: Queued | undefined;
        for (const entry of queued) {
          if (entry.kind !== null || entry.deliveredMs === null || entry.reported) continue;
          if (entry.deliveredMs > ts) continue;
          if (!waiting || entry.deliveredMs > (waiting.deliveredMs ?? 0)) waiting = entry;
        }
        if (waiting) {
          waiting.kind = "human";
          report(waiting);
        } else deliver(null, ts);
        continue;
      }
    }
    if (row.type === "system" && row.subtype === "compact_boundary") {
      compactions++;
      continue;
    }
    if (row.type === "system" && row.subtype === "turn_duration" && ts !== null) {
      // Only a delivery a human attachment or queued user row named is a
      // user message; a delivery nothing named is not promoted to one.
      for (const entry of queued) if (entry.kind === "human") report(entry);
      for (const message of unanswered) {
        message.answerWaitMs = Math.max(0, ts - message.deliveredMs);
      }
      unanswered = [];
    }
  }
  return { compactions, messages };
};

const READERS: Record<string, (rows: Row[]) => ResponsivenessReport> = {
  claude: readClaude,
};

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  // Short waits read as seconds; longer ones break into minutes and seconds.
  if (totalSeconds < 120) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} min ${seconds} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ${seconds} s`;
};

export const formatReport = (report: ResponsivenessReport): string => {
  const lines = [
    "responsiveness: Claude Code session record (harness claude)",
    `messages: ${report.messages.length}`,
    `compactions: ${report.compactions}`,
    ...report.messages.map((message, index) => {
      const seen = message.seenWaitMs === null ? "no wait" : formatDuration(message.seenWaitMs);
      const answer =
        message.answerWaitMs === null ? "not finished" : formatDuration(message.answerWaitMs);
      return `message ${index + 1}: seen: ${seen}; answer: ${answer}`;
    }),
  ];
  return lines.join("\n");
};

export const readResponsiveness = (harness: string, content: string): ResponsivenessReport => {
  const read = READERS[harness];
  if (!read) throw new Error(`harness ${harness} is unsupported`);
  return read(jsonRows(content));
};

const isRegularFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

type Cli = { harness: string; repo: string; target?: string };

const parseCli = (args: string[]): Cli => {
  let harness = "claude";
  let repo = process.cwd();
  let target: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--harness" || arg === "--repo") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i++;
      if (arg === "--harness") harness = value;
      else repo = resolve(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (target === undefined) {
      target = arg;
    } else {
      throw new Error("responsiveness takes at most one record or session id");
    }
  }
  return { harness, repo, target };
};

const resolveRecord = (cli: Cli): string => {
  if (cli.target !== undefined && isRegularFile(cli.target)) return cli.target;
  const warn = (message: string): void => {
    console.error(`responsiveness: ${message}`);
  };
  if (cli.target !== undefined) return findNativeRecord("claude", cli.target, process.env, warn);
  return findNewestPostmasterRecord(cli.repo, process.env, warn);
};

const main = (args: string[]): void => {
  const cli = parseCli(args);
  if (cli.harness !== "claude") {
    const known = HARNESSES.includes(cli.harness) ? cli.harness : cli.harness;
    console.error(`responsiveness: harness ${known} is unsupported`);
    process.exitCode = 1;
    return;
  }
  const recordPath = resolveRecord(cli);
  let content: string;
  try {
    content = readFileSync(recordPath, "utf8");
  } catch {
    throw new Error(`cannot read session record: ${recordPath}`);
  }
  console.log(formatReport(readResponsiveness(cli.harness, content)));
};

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(`responsiveness: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
