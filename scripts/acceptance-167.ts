// Helpers for the #167 oracle: made-up Claude Code session records in the
// record's exact shape, driven through scripts/run responsiveness as a
// subprocess; nothing here imports the change.
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beside } from "./lib/paths.ts";
import { run, type RunResult } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");
export const PLANTED = "PLANTED-SECRET-167-do-not-print";

export const iso = (offsetSeconds: number): string =>
  new Date(Date.parse("2026-01-01T00:00:00.000Z") + offsetSeconds * 1000).toISOString();

type Row = Record<string, unknown>;

export const queuedHuman = (enqueue: number, remove: number, turnEnd: number): Row[] => [
  {
    content: PLANTED,
    operation: "enqueue",
    sessionId: "madeup-session",
    timestamp: iso(enqueue),
    type: "queue-operation",
  },
  {
    content: PLANTED,
    operation: "remove",
    sessionId: "madeup-session",
    timestamp: iso(remove),
    type: "queue-operation",
  },
  {
    attachment: {
      origin: { kind: "human" },
      prompt: PLANTED,
      type: "queued_command",
    },
    sessionId: "madeup-session",
    timestamp: iso(enqueue),
    type: "attachment",
  },
  {
    durationMs: (turnEnd - remove) * 1000,
    sessionId: "madeup-session",
    subtype: "turn_duration",
    timestamp: iso(turnEnd),
    type: "system",
  },
];

export const queuedTask = (enqueue: number, remove: number): Row[] => [
  {
    content: PLANTED,
    operation: "enqueue",
    sessionId: "madeup-session",
    timestamp: iso(enqueue),
    type: "queue-operation",
  },
  {
    content: PLANTED,
    operation: "remove",
    sessionId: "madeup-session",
    timestamp: iso(remove),
    type: "queue-operation",
  },
  {
    attachment: {
      origin: { kind: "task-notification" },
      prompt: PLANTED,
      type: "queued_command",
    },
    sessionId: "madeup-session",
    timestamp: iso(enqueue),
    type: "attachment",
  },
];

export const idleTyped = (typed: number, turnEnd: number): Row[] => [
  {
    message: { content: PLANTED, role: "user" },
    origin: { kind: "human" },
    promptSource: "typed",
    sessionId: "madeup-session",
    timestamp: iso(typed),
    type: "user",
  },
  {
    durationMs: (turnEnd - typed) * 1000,
    sessionId: "madeup-session",
    subtype: "turn_duration",
    timestamp: iso(turnEnd),
    type: "system",
  },
];

export const compaction = (at: number): Row => ({
  sessionId: "madeup-session",
  subtype: "compact_boundary",
  timestamp: iso(at),
  type: "system",
});

export const customTitle = (title: string): Row => ({
  customTitle: title,
  sessionId: "madeup-session",
  type: "custom-title",
});

export const writeRecord = (dir: string, name: string, rows: Row[]): string => {
  const path = join(dir, name);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return path;
};

export const encodeProject = (repo: string): string => repo.replace(/[^a-zA-Z0-9]/g, "-");

export const writeClaudeRecord = (
  configDir: string,
  repo: string,
  sessionId: string,
  rows: Row[],
  mtimeSeconds?: number,
): string => {
  const folder = join(configDir, "projects", encodeProject(repo));
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${sessionId}.jsonl`);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  if (mtimeSeconds !== undefined) {
    const when = new Date(mtimeSeconds * 1000);
    utimesSync(path, when, when);
  }
  return path;
};

export const runResponsiveness = (
  args: string[],
  env?: Record<string, string | undefined>,
): RunResult => run(RUN, ["responsiveness", ...args], env ? { env } : {});
