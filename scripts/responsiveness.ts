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
  seenUnknown: boolean;
  deliveredMs: number | null;
  answerWaitMs: number | null;
  answerUnknown: boolean;
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
// each compaction is a system line of subtype compact_boundary. What the
// reader may conclude from each shape, and where the wait is unknown
// instead of guessed, is the pairing specification approved for this
// reader; the reader below is that table in code.
type Enqueue = { consumed: boolean; ts: number };

type Candidate = {
  deliveredMs: number | null;
  enqueueMs: number | null;
  evidenceMs: number;
  keyedDelivery: boolean;
  kind: unknown;
  rowMatched: boolean;
  standalone: boolean;
};

// The reader is table-driven from the pairing specification the user
// approved (pairing-spec.md in the run's dispatch): what each record
// shape may conclude, and "unknown" wherever no key links two records.
// An attachment's stamp is its enqueue time (E1); a queued user row's
// time is its delivery time (E3); and where exactly one candidate in a
// turn still waits for a delivery and exactly one unidentified delivery
// stands in that turn, they belong together (E2), a task candidate
// counting for that rule so a task delivery never takes a human
// message's place.
export const readClaude = (rows: Row[]): ResponsivenessReport => {
  const enqueues: Enqueue[] = [];
  const deliveries: { key: string | null; ts: number }[] = [];
  const attachments: { key: string | null; kind: unknown; ts: number }[] = [];
  const userRows: { source: unknown; ts: number }[] = [];
  const turns: number[] = [];
  let compactions = 0;

  for (const row of rows) {
    const ts = timestampMs(row);
    if (row.type === "queue-operation" && ts !== null) {
      if (row.operation === "enqueue") {
        enqueues.push({ consumed: false, ts });
      } else if (row.operation === "remove" || row.operation === "dequeue") {
        // A row written because the queued message was cleared on
        // cancel or dropped by a hook is not a delivery.
        if (row.reason === "cleared_on_cancel" || row.reason === "dropped_by_hook") continue;
        const key = [row.commandUuid, row.deliveryId].find(
          (v): v is string => typeof v === "string" && v !== "",
        );
        deliveries.push({ key: key ?? null, ts });
      }
      continue;
    }
    if (
      row.type === "attachment" &&
      at(row, "attachment", "type") === "queued_command" &&
      ts !== null
    ) {
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
  turns.sort((a, b) => a - b);
  const turnOf = (ts: number): number => {
    const found = turns.findIndex((t) => t >= ts);
    return found === -1 ? turns.length : found;
  };

  // An attachment is stamped with its enqueue's time: every measured
  // record sits within 16 ms, so no enqueue further away is its own.
  const MAX_ATTACHMENT_SKEW_MS = 16;
  const claimedKeys = new Set(attachments.map((a) => a.key).filter((k) => k !== null));
  const keyedDeliveries = new Map<string, number>();
  const unidentified: number[] = [];
  for (const delivery of deliveries) {
    if (delivery.key !== null && claimedKeys.has(delivery.key)) {
      keyedDeliveries.set(delivery.key, delivery.ts);
    } else if (delivery.key === null) unidentified.push(delivery.ts);
    // A keyed delivery no attachment claims belongs to no concluded
    // message: it never enters the E2 pool.
  }

  const candidates: Candidate[] = [];
  const orderedAttachments = [
    ...attachments.filter((a) => a.key !== null),
    ...attachments.filter((a) => a.key === null),
  ];
  for (const attachment of orderedAttachments) {
    let nearest: Enqueue | undefined;
    for (const entry of enqueues) {
      if (entry.consumed) continue;
      if (Math.abs(attachment.ts - entry.ts) > MAX_ATTACHMENT_SKEW_MS) continue;
      if (!nearest || Math.abs(attachment.ts - entry.ts) < Math.abs(attachment.ts - nearest.ts)) {
        nearest = entry;
      }
    }
    if (nearest) nearest.consumed = true;
    const keyed = attachment.key === null ? undefined : keyedDeliveries.get(attachment.key);
    candidates.push({
      deliveredMs: keyed ?? null,
      enqueueMs: attachment.ts,
      evidenceMs: attachment.ts,
      keyedDelivery: keyed !== undefined,
      kind: attachment.kind,
      rowMatched: false,
      standalone: !nearest,
    });
  }
  // A standalone attachment's stamp is the earliest moment the record
  // shows for its message, and its answer runs from there.
  for (const candidate of candidates) {
    if (candidate.standalone && candidate.deliveredMs === null) {
      candidate.deliveredMs = candidate.evidenceMs;
    }
  }

  type Simple = { deliveredMs: number; sortMs: number };
  const simple: Simple[] = [];
  for (const userRow of userRows) {
    if (userRow.source === "typed" || userRow.source === undefined) {
      simple.push({ deliveredMs: userRow.ts, sortMs: userRow.ts });
      continue;
    }
    if (userRow.source === "queued") {
      // A row joins the earliest human candidate it can be the delivery
      // form of: one still waiting for a delivery, or a standalone
      // attachment, in its own turn or the turn it was enqueued in. A
      // candidate whose delivery is already known absorbs nothing.
      const waiting = (c: Candidate): boolean =>
        c.kind === "human" &&
        !c.rowMatched &&
        c.evidenceMs <= userRow.ts &&
        (c.deliveredMs === null || (c.standalone && !c.keyedDelivery));
      const match =
        candidates.find((c) => waiting(c) && turnOf(c.evidenceMs) === turnOf(userRow.ts)) ??
        candidates.find(waiting);
      if (match) {
        match.rowMatched = true;
        if (match.deliveredMs === null || match.standalone) {
          match.deliveredMs = userRow.ts;
          // The row is that delivery in its second form: spend it, so
          // E2 cannot hand the same delivery to another candidate.
          let spent = unidentified.findIndex((ts) => ts === userRow.ts);
          if (spent === -1) {
            spent = unidentified.findIndex((ts) => turnOf(ts) === turnOf(userRow.ts));
          }
          if (spent !== -1) unidentified.splice(spent, 1);
        }
      } else if (
        candidates.some((c) => c.kind === "human" && !c.rowMatched && c.evidenceMs <= userRow.ts)
      ) {
        // The row repeats a message already counted with its delivery
        // known: it is that message's second form and adds nothing.
        const counted = candidates.find(
          (c) => c.kind === "human" && !c.rowMatched && c.evidenceMs <= userRow.ts,
        );
        if (counted) counted.rowMatched = true;
      } else {
        candidates.push({
          deliveredMs: userRow.ts,
          enqueueMs: null,
          evidenceMs: userRow.ts,
          keyedDelivery: false,
          kind: "human",
          rowMatched: true,
          standalone: true,
        });
      }
    }
  }

  // E2, per turn: exactly one candidate still waiting and exactly one
  // unidentified delivery in that turn belong together.
  const turnIds = new Set([
    ...candidates.map((c) => turnOf(c.evidenceMs)),
    ...unidentified.map(turnOf),
  ]);
  for (const turn of turnIds) {
    const waiting = candidates.filter(
      (c) => c.deliveredMs === null && turnOf(c.evidenceMs) === turn,
    );
    const standing = unidentified.filter((ts) => turnOf(ts) === turn);
    if (
      waiting.length === 1 &&
      standing.length === 1 &&
      waiting[0] &&
      (standing[0] ?? 0) >= waiting[0].evidenceMs
    ) {
      waiting[0].deliveredMs = standing[0] ?? null;
    }
  }

  const messages: MessageWait[] = [];
  for (const s of simple) {
    messages.push({
      answerUnknown: false,
      answerWaitMs: null,
      deliveredMs: s.deliveredMs,
      seenUnknown: false,
      seenWaitMs: null,
    });
  }
  const humanCandidates = candidates
    .filter((c) => c.kind === "human")
    .sort((a, b) => (a.deliveredMs ?? a.evidenceMs) - (b.deliveredMs ?? b.evidenceMs));
  for (const candidate of humanCandidates) {
    const seenUnknown =
      (candidate.standalone && !candidate.keyedDelivery) || candidate.deliveredMs === null;
    messages.push({
      answerUnknown: candidate.deliveredMs === null,
      answerWaitMs: null,
      deliveredMs: candidate.deliveredMs,
      seenUnknown,
      seenWaitMs: seenUnknown
        ? null
        : Math.max(0, (candidate.deliveredMs ?? 0) - (candidate.enqueueMs ?? 0)),
    });
  }
  const order = new Map(messages.map((m, i) => [m, i] as const));
  messages.sort((a, b) => {
    const ka = a.deliveredMs ?? Number.POSITIVE_INFINITY;
    const kb = b.deliveredMs ?? Number.POSITIVE_INFINITY;
    return ka - kb || (order.get(a) ?? 0) - (order.get(b) ?? 0);
  });
  for (const message of messages) {
    if (message.deliveredMs === null) continue;
    const end = turns.find((t) => t >= (message.deliveredMs ?? 0));
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
      const seen = message.seenUnknown
        ? "unknown"
        : message.seenWaitMs === null
          ? "no wait"
          : formatDuration(message.seenWaitMs);
      const answer = message.answerUnknown
        ? "unknown"
        : message.answerWaitMs === null
          ? "not finished"
          : formatDuration(message.answerWaitMs);
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
