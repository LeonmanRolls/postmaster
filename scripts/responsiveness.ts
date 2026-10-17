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
type Enqueue = { deliveredMs: number | null; kind: unknown; messaged: boolean; ts: number };

export const readClaude = (rows: Row[]): ResponsivenessReport => {
  // Two passes. The first collects the record's queue operations,
  // attachments, user rows and turn ends. The second pairs them: a
  // delivery carrying a commandUuid or deliveryId belongs to the
  // attachment naming that key (its source_uuid or delivery_id), whose
  // timestamp is the enqueue time, so keyed messages pair exactly;
  // deliveries without a key take the remaining enqueues in order, and
  // a keyless attachment names the kind of the enqueue stamped nearest
  // its own time. Only a delivery a human attachment or a queued user
  // row named is a user message; a delivery nothing named is not
  // promoted to one.
  const enqueues: Enqueue[] = [];
  const unkeyedDeliveries: number[] = [];
  const keyedDeliveries = new Map<string, number>();
  const attachments: { key: string | null; kind: unknown; ts: number }[] = [];
  const userRows: { source: unknown; ts: number }[] = [];
  const turns: number[] = [];
  let compactions = 0;

  for (const row of rows) {
    const ts = timestampMs(row);
    if (row.type === "queue-operation" && ts !== null) {
      if (row.operation === "enqueue") {
        enqueues.push({ deliveredMs: null, kind: null, messaged: false, ts });
      } else if (row.operation === "remove" || row.operation === "dequeue") {
        const key = [row.commandUuid, row.deliveryId].find(
          (v): v is string => typeof v === "string" && v !== "",
        );
        if (key === undefined) unkeyedDeliveries.push(ts);
        else keyedDeliveries.set(key, ts);
      }
      continue;
    }
    if (row.type === "attachment" && at(row, "attachment", "type") === "queued_command" && ts !== null) {
      const key = [at(row, "attachment", "source_uuid"), at(row, "attachment", "delivery_id")].find(
        (v): v is string => typeof v === "string" && v !== "",
      );
      attachments.push({
        key: key ?? null,
        kind: at(row, "attachment", "origin", "kind"),
        ts,
      });
      continue;
    }
    if (row.type === "user" && at(row, "origin", "kind") === "human" && ts !== null) {
      userRows.push({ source: row.promptSource, ts });
      continue;
    }
    if (row.type === "system" && row.subtype === "compact_boundary") {
      compactions++;
      continue;
    }
    if (row.type === "system" && row.subtype === "turn_duration" && ts !== null) turns.push(ts);
  }

  const messages: MessageWait[] = [];
  const addMessage = (enqueueMs: number | null, deliveredMs: number): void => {
    messages.push({
      answerWaitMs: null,
      deliveredMs,
      seenWaitMs: enqueueMs === null ? null : Math.max(0, deliveredMs - enqueueMs),
    });
  };
  const nearestEnqueue = (ts: number, free: (e: Enqueue) => boolean): Enqueue | undefined => {
    let nearest: Enqueue | undefined;
    for (const entry of enqueues) {
      if (!free(entry)) continue;
      if (!nearest || Math.abs(ts - entry.ts) < Math.abs(ts - nearest.ts)) nearest = entry;
    }
    return nearest;
  };

  // Keyed attachments pair with their own delivery first, and consume
  // the enqueue they were stamped for, so that enqueue's slot is never
  // handed to a keyless delivery.
  const keylessAttachments: typeof attachments = [];
  for (const attachment of attachments) {
    const deliveredMs = attachment.key === null ? undefined : keyedDeliveries.get(attachment.key);
    if (deliveredMs === undefined) {
      keylessAttachments.push(attachment);
      continue;
    }
    const consumed = nearestEnqueue(attachment.ts, (e) => e.kind === null && !e.messaged);
    if (consumed) {
      consumed.kind = attachment.kind;
      consumed.deliveredMs = deliveredMs;
      consumed.messaged = attachment.kind === "human";
    }
    if (attachment.kind === "human") addMessage(attachment.ts, deliveredMs);
  }

  // Keyless attachments name each enqueue's kind before any keyless
  // delivery is handed out: a delivery takes the enqueues an attachment
  // named, in order, so an enqueue nothing named (an orphan with no
  // delivery of its own) never spends a later message's delivery.
  // Deliveries left over take the unnamed enqueues in order, for the
  // messages a queued user row names below.
  for (const attachment of keylessAttachments) {
    const entry = nearestEnqueue(attachment.ts, (e) => e.kind === null);
    if (!entry) {
      // No enqueue to name: a human attachment is still a user message,
      // timed from the earliest moment the record shows for it.
      if (attachment.kind === "human") addMessage(null, attachment.ts);
      continue;
    }
    entry.kind = attachment.kind;
  }
  const named = enqueues.filter((e) => e.kind !== null && e.deliveredMs === null);
  const unnamed = enqueues.filter((e) => e.kind === null && e.deliveredMs === null);
  for (const deliveredMs of unkeyedDeliveries) {
    const entry = named.shift() ?? unnamed.shift();
    if (entry) entry.deliveredMs = deliveredMs;
  }
  for (const entry of enqueues) {
    if (entry.kind === "human" && entry.deliveredMs !== null && !entry.messaged) {
      entry.messaged = true;
      addMessage(entry.ts, entry.deliveredMs);
    }
  }

  for (const userRow of userRows) {
    if (userRow.source === "typed") {
      addMessage(null, userRow.ts);
      continue;
    }
    if (userRow.source === "queued") {
      // The same message in user-row form: report the latest enqueue
      // delivered in this turn, still waiting for its kind, or stand
      // alone where there is none. A delivery from an earlier turn
      // never takes the row.
      const turnStart = turns.filter((t) => t <= userRow.ts).pop() ?? null;
      let waiting: Enqueue | undefined;
      for (const entry of enqueues) {
        if (entry.kind !== null || entry.deliveredMs === null || entry.messaged) continue;
        if (entry.deliveredMs > userRow.ts) continue;
        if (turnStart !== null && entry.deliveredMs <= turnStart) continue;
        if (!waiting || entry.deliveredMs > (waiting.deliveredMs ?? 0)) waiting = entry;
      }
      if (waiting) {
        waiting.messaged = true;
        addMessage(waiting.ts, waiting.deliveredMs ?? userRow.ts);
      } else addMessage(null, userRow.ts);
    }
  }

  messages.sort((a, b) => a.deliveredMs - b.deliveredMs);
  turns.sort((a, b) => a - b);
  for (const message of messages) {
    const end = turns.find((t) => t >= message.deliveredMs);
    message.answerWaitMs = end === undefined ? null : Math.max(0, end - message.deliveredMs);
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
