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
// The pairing is a pure function of each turn's records. Nothing is
// matched by order, and no pool is shared between turns: a turn's records
// are grouped once, and each group yields its conclusions on its own.
//
// - A delivery whose key an attachment names pairs with that attachment,
//   exactly (the keyed pairs).
// - E1: an attachment's stamp is its enqueue time. An attachment with no
//   enqueue within 16 ms of its stamp stands alone: its answer runs from
//   its stamp and its seen wait is unknown.
// - E2: where a turn holds exactly one waiting candidate (not keyed, not
//   standalone) and exactly one unidentified delivery, they belong
//   together. Task, channel, peer and kindless candidates wait too, so a
//   delivery is never handed to a human message past another candidate.
// - E3: a queued user row's own time is its delivery time, and nothing
//   more is concluded from it. Rows beyond a turn's human candidates are
//   messages of their own with unknown waits; a turn with no human
//   candidate takes each row as a message delivered at its own time.
// - Everything else is unknown: several candidates or deliveries in one
//   turn, a delivery in another turn, a keyed delivery no attachment
//   claims.

const MAX_ATTACHMENT_SKEW_MS = 16;

type Candidate = {
  deliveredMs: number | null;
  kind: unknown;
  keyed: boolean;
  standalone: boolean;
  stamp: number;
};

type TurnGroup = {
  deliveries: number[];
  humanCandidates: number;
  rows: number[];
  waiting: Candidate[];
};

export const readClaude = (rows: Row[]): ResponsivenessReport => {
  const enqueues: number[] = [];
  const keyedDeliveries = new Map<string, number>();
  const keylessDeliveries: number[] = [];
  const attachments: { key: string | null; kind: unknown; ts: number }[] = [];
  const queuedRows: number[] = [];
  const typedRows: number[] = [];
  const turns: number[] = [];
  let compactions = 0;

  for (const row of rows) {
    const ts = timestampMs(row);
    if (row.type === "queue-operation" && ts !== null) {
      if (row.operation === "enqueue") {
        enqueues.push(ts);
      } else if (row.operation === "remove" || row.operation === "dequeue") {
        // A row written because the queued message was cleared on
        // cancel or dropped by a hook is not a delivery.
        if (row.reason === "cleared_on_cancel" || row.reason === "dropped_by_hook") continue;
        const key = [row.commandUuid, row.deliveryId].find(
          (v): v is string => typeof v === "string" && v !== "",
        );
        if (key === undefined) keylessDeliveries.push(ts);
        else keyedDeliveries.set(key, ts);
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
      if (row.promptSource === "queued") queuedRows.push(ts);
      else if (row.promptSource === "typed" || row.promptSource === undefined) typedRows.push(ts);
      continue;
    }
    if (row.type === "system" && row.subtype === "compact_boundary") {
      compactions++;
      continue;
    }
    if (row.type === "system" && row.subtype === "turn_duration" && ts !== null) turns.push(ts);
  }
  turns.sort((a, b) => a - b);
  // The turn a stamp belongs to: the first turn end at or after it, or
  // one past the last turn. Binary search over the sorted ends.
  const turnOf = (ts: number): number => {
    let lo = 0;
    let hi = turns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((turns[mid] ?? Number.POSITIVE_INFINITY) < ts) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const candidates: Candidate[] = attachments.map((attachment) => {
    const keyedMs = attachment.key === null ? undefined : keyedDeliveries.get(attachment.key);
    const standalone = !enqueues.some(
      (enqueue) => Math.abs(enqueue - attachment.ts) <= MAX_ATTACHMENT_SKEW_MS,
    );
    return {
      deliveredMs: keyedMs ?? (standalone ? attachment.ts : null),
      keyed: keyedMs !== undefined,
      kind: attachment.kind,
      standalone,
      stamp: attachment.ts,
    };
  });

  // Group one turn's records once; each group concludes on its own.
  const groups = new Map<number, TurnGroup>();
  const groupOf = (turn: number): TurnGroup => {
    const found = groups.get(turn);
    if (found) return found;
    const made: TurnGroup = { deliveries: [], humanCandidates: 0, rows: [], waiting: [] };
    groups.set(turn, made);
    return made;
  };
  for (const candidate of candidates) {
    const stampTurn = turnOf(candidate.stamp);
    const group = groupOf(stampTurn);
    if (candidate.kind === "human") group.humanCandidates++;
    if (!candidate.keyed && !candidate.standalone) group.waiting.push(candidate);
    // A keyed delivery lands in its own turn: the message it concludes
    // counts there too, so its queued row in that turn adds nothing.
    if (candidate.kind === "human" && candidate.keyed && candidate.deliveredMs !== null) {
      const deliveryTurn = turnOf(candidate.deliveredMs);
      if (deliveryTurn !== stampTurn) groupOf(deliveryTurn).humanCandidates++;
    }
  }
  for (const ts of keylessDeliveries) groupOf(turnOf(ts)).deliveries.push(ts);
  for (const ts of queuedRows) groupOf(turnOf(ts)).rows.push(ts);

  // E2, per turn: exactly one waiting candidate and exactly one
  // unidentified delivery in that turn belong together.
  for (const group of groups.values()) {
    const candidate = group.waiting[0];
    const delivery = group.deliveries[0];
    if (
      group.waiting.length === 1 &&
      group.deliveries.length === 1 &&
      candidate &&
      delivery !== undefined &&
      delivery >= candidate.stamp
    ) {
      candidate.deliveredMs = delivery;
    }
  }

  const messages: MessageWait[] = [];
  for (const ts of typedRows) {
    messages.push({
      answerUnknown: false,
      answerWaitMs: null,
      deliveredMs: ts,
      seenUnknown: false,
      seenWaitMs: null,
    });
  }
  for (const group of groups.values()) {
    if (group.humanCandidates === 0) {
      // No candidate in this turn can be these rows' other form: each
      // row is a message delivered at its own time (E3).
      for (const ts of group.rows) {
        messages.push({
          answerUnknown: false,
          answerWaitMs: null,
          deliveredMs: ts,
          seenUnknown: true,
          seenWaitMs: null,
        });
      }
    } else {
      // Rows up to the turn's human candidates are those messages'
      // other form and add nothing; any beyond them are messages whose
      // waits nothing identifies.
      for (let extra = group.rows.length - group.humanCandidates; extra > 0; extra--) {
        messages.push({
          answerUnknown: true,
          answerWaitMs: null,
          deliveredMs: null,
          seenUnknown: true,
          seenWaitMs: null,
        });
      }
    }
  }
  for (const candidate of candidates) {
    if (candidate.kind !== "human") continue;
    const seenUnknown =
      candidate.deliveredMs === null || (candidate.standalone && !candidate.keyed);
    messages.push({
      answerUnknown: candidate.deliveredMs === null,
      answerWaitMs: null,
      deliveredMs: candidate.deliveredMs,
      seenUnknown,
      seenWaitMs: seenUnknown ? null : Math.max(0, (candidate.deliveredMs ?? 0) - candidate.stamp),
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
    const endIndex = turnOf(message.deliveredMs);
    const end = endIndex < turns.length ? turns[endIndex] : undefined;
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
