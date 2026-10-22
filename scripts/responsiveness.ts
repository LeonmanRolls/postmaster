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

export const readClaude = (rows: Row[]): ResponsivenessReport => {
  const enqueues: number[] = [];
  const keyedDeliveries = new Map<string, { pos: number; ts: number }>();
  const keylessDeliveries: { pos: number; ts: number }[] = [];
  const attachments: { keyValues: string[]; kind: unknown; pos: number; ts: number }[] = [];
  const queuedRows: { pos: number; ts: number }[] = [];
  const typedRows: { pos: number; ts: number }[] = [];
  const turns: { pos: number; ts: number }[] = [];
  let compactions = 0;

  rows.forEach((row, pos) => {
    const ts = timestampMs(row);
    if (row.type === "queue-operation" && ts !== null) {
      if (row.operation === "enqueue") {
        enqueues.push(ts);
      } else if (row.operation === "remove" || row.operation === "dequeue") {
        // A row written because the queued message was cleared on
        // cancel or dropped by a hook is not a delivery.
        if (row.reason === "cleared_on_cancel" || row.reason === "dropped_by_hook") return;
        const keyValues = [row.commandUuid, row.deliveryId].filter(
          (v): v is string => typeof v === "string" && v !== "",
        );
        if (keyValues.length === 0) keylessDeliveries.push({ pos, ts });
        else for (const key of keyValues) keyedDeliveries.set(key, { pos, ts });
      }
      return;
    }
    if (
      row.type === "attachment" &&
      at(row, "attachment", "type") === "queued_command" &&
      ts !== null
    ) {
      const keyValues = [
        at(row, "attachment", "source_uuid"),
        at(row, "attachment", "delivery_id"),
      ].filter((v): v is string => typeof v === "string" && v !== "");
      attachments.push({
        keyValues,
        kind: at(row, "attachment", "origin", "kind"),
        pos,
        ts,
      });
      return;
    }
    if (row.type === "user" && at(row, "origin", "kind") === "human" && ts !== null) {
      if (row.promptSource === "queued") queuedRows.push({ pos, ts });
      else if (row.promptSource === "typed" || row.promptSource === undefined)
        typedRows.push({ pos, ts });
      return;
    }
    if (row.type === "system" && row.subtype === "compact_boundary") {
      compactions++;
      return;
    }
    if (row.type === "system" && row.subtype === "turn_duration" && ts !== null)
      turns.push({ pos, ts });
  });
  turns.sort((a, b) => a.ts - b.ts || a.pos - b.pos);
  // The turn a record belongs to, and the turn that answers a delivery:
  // the first turn end after it. Stamps have millisecond precision, so
  // at an exact tie the line order in the record decides: a line written
  // after the turn end belongs to the next turn.
  const turnOf = (ts: number, pos: number): number => {
    let lo = 0;
    let hi = turns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const turn = turns[mid];
      if (turn && (turn.ts < ts || (turn.ts === ts && turn.pos < pos))) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const answerWait = (deliveredMs: number, deliveredPos: number): number | null => {
    const end = turns[turnOf(deliveredMs, deliveredPos)];
    return end === undefined ? null : Math.max(0, end.ts - deliveredMs);
  };

  type Candidate = {
    deliveredMs: number | null;
    deliveredPos: number;
    keyed: boolean;
    kind: unknown;
    standalone: boolean;
    stamp: number;
    stampPos: number;
  };
  const candidates: Candidate[] = attachments.map((attachment) => {
    const keyedDelivery = attachment.keyValues
      .map((key) => keyedDeliveries.get(key))
      .find((delivery) => delivery !== undefined);
    const standalone = !enqueues.some(
      (enqueue) => Math.abs(enqueue - attachment.ts) <= MAX_ATTACHMENT_SKEW_MS,
    );
    return {
      deliveredMs: keyedDelivery?.ts ?? (standalone ? attachment.ts : null),
      deliveredPos: keyedDelivery?.pos ?? attachment.pos,
      keyed: keyedDelivery !== undefined,
      kind: attachment.kind,
      standalone,
      stamp: attachment.ts,
      stampPos: attachment.pos,
    };
  });

  // Group one turn's records once; each group concludes on its own.
  type TurnGroup = {
    deliveries: { pos: number; ts: number }[];
    humanCandidates: number;
    rows: { pos: number; ts: number }[];
    waiting: Candidate[];
  };
  // humanCandidates counts a turn's human candidates with no keyed
  // delivery: the candidates a queued row in that turn can belong to.
  const groups = new Map<number, TurnGroup>();
  const groupOf = (turn: number): TurnGroup => {
    const found = groups.get(turn);
    if (found) return found;
    const made: TurnGroup = { deliveries: [], humanCandidates: 0, rows: [], waiting: [] };
    groups.set(turn, made);
    return made;
  };
  for (const candidate of candidates) {
    const stampTurn = turnOf(candidate.stamp, candidate.stampPos);
    const group = groupOf(stampTurn);
    if (candidate.kind === "human" && !candidate.keyed) group.humanCandidates++;
    if (!candidate.keyed && !candidate.standalone) group.waiting.push(candidate);
  }
  for (const delivery of keylessDeliveries)
    groupOf(turnOf(delivery.ts, delivery.pos)).deliveries.push(delivery);
  for (const row of queuedRows) groupOf(turnOf(row.ts, row.pos)).rows.push(row);

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
      delivery.ts >= candidate.stamp
    ) {
      candidate.deliveredMs = delivery.ts;
      candidate.deliveredPos = delivery.pos;
    }
  }

  const messages: MessageWait[] = [];
  for (const row of typedRows) {
    messages.push({
      answerUnknown: false,
      answerWaitMs: answerWait(row.ts, row.pos),
      deliveredMs: row.ts,
      seenUnknown: false,
      seenWaitMs: null,
    });
  }
  // A queued row at the instant of a delivery concluded in its turn is
  // that delivery's second form and adds nothing. Rows beyond that and
  // beyond the turn's human candidates with no keyed delivery are
  // messages delivered at their own time (E3).
  const concluded = new Map<number, Map<number, number>>();
  for (const candidate of candidates) {
    if (candidate.kind !== "human" || candidate.deliveredMs === null) continue;
    const turn = turnOf(candidate.deliveredMs, candidate.deliveredPos);
    const instants = concluded.get(turn) ?? new Map<number, number>();
    instants.set(candidate.deliveredMs, (instants.get(candidate.deliveredMs) ?? 0) + 1);
    concluded.set(turn, instants);
  }
  for (const [turn, group] of groups) {
    const instants = concluded.get(turn);
    const remaining = group.rows.filter((row) => {
      const count = instants?.get(row.ts) ?? 0;
      if (count === 0) return true;
      instants?.set(row.ts, count - 1);
      return false;
    });
    for (const row of remaining.slice(group.humanCandidates)) {
      messages.push({
        answerUnknown: false,
        answerWaitMs: answerWait(row.ts, row.pos),
        deliveredMs: row.ts,
        seenUnknown: true,
        seenWaitMs: null,
      });
    }
  }
  for (const candidate of candidates) {
    if (candidate.kind !== "human") continue;
    const seenUnknown =
      candidate.deliveredMs === null || (candidate.standalone && !candidate.keyed);
    messages.push({
      answerUnknown: candidate.deliveredMs === null,
      answerWaitMs:
        candidate.deliveredMs === null
          ? null
          : answerWait(candidate.deliveredMs, candidate.deliveredPos),
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
