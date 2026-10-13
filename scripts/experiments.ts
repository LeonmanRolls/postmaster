// One command keeps a project's experiments: it starts one, moves the date
// to look at it, concludes it with its result, lists them with what is due
// first, and prints the rows the live page shows.
//
//   run experiments start --project <repo> --question <q> --level <a> --level <b>
//                 [--level ...] --measure <m> --look <date>
//   run experiments move --project <repo> <id> --look <date>
//   run experiments conclude --project <repo> <id> --result <r> [--evidence <addr>]
//   run experiments list --project <repo> [--today <date>]
//   run experiments push-docs --project <repo>
//
//   exit 0  started, moved, concluded, listed or printed; start, move and
//           conclude print the experiment's id
//   exit 1  usage; a refusal, with the record untouched; a corrupt record;
//           the lock held past its wait
//
// The record is the project's .postmaster/experiments.jsonl, append-only, one
// event per change, found from the repository's top level as the run root is.
// One change runs at a time, through a lock beside the record.
// Each change is logged through the project's ledger. Dates are UTC calendar
// days; an experiment is due when it is running and its date to look has come.
// A level is one side of what the experiment compares.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ensureIgnore,
  isDie,
  isSymlink,
  projectRoot,
  settingsDir,
} from "./lib/effective-config.ts";
import { argvDecoded, run } from "./lib/proc.ts";
import { logProjectEvent } from "./log-action.ts";

const USAGE =
  "usage: run experiments start --project <repo> --question <q> --level <a> --level <b>" +
  " [--level ...] --measure <m> --look <date>" +
  " | run experiments move --project <repo> <id> --look <date>" +
  " | run experiments conclude --project <repo> <id> --result <r> [--evidence <addr>]" +
  " | run experiments list --project <repo> [--today <date>]" +
  " | run experiments push-docs --project <repo>";

// --- core: the record, today's date in, rows out --------------------------------
// Reading the record and the clock stays at the edge; everything here takes
// its inputs as arguments and returns its result.

export type ExperimentEvent =
  | {
      ev: "start";
      id: string;
      question: string;
      levels: string[];
      measure: string;
      started: string;
      look: string;
    }
  | { ev: "move"; id: string; look: string }
  | { ev: "conclude"; id: string; result: string; evidence: string | null; ended: string };

export interface Experiment {
  id: string;
  question: string;
  levels: string[];
  started: string;
  measure: string;
  look: string;
  state: "running" | "concluded";
  result: string | null;
  evidence: string | null;
  ended: string | null;
}

export interface StartInput {
  question: string;
  levels: string[];
  measure: string;
  look: string;
}

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u;
const ID_RE = /^e([1-9][0-9]*)$/u;

/** parseDate <s>: the day itself when s is a real UTC calendar date, else null. */
export function parseDate(s: string): string | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

function idNum(id: string): number {
  const m = ID_RE.exec(id);
  return m?.[1] === undefined ? 0 : Number(m[1]);
}

/** nextId <rows>: the next experiment id, one past the highest in use. */
export function nextId(rows: Experiment[]): string {
  let max = 0;
  for (const r of rows) max = Math.max(max, idNum(r.id));
  return `e${max + 1}`;
}

/** replay <events>: the rows the record's events leave, or the corruption. */
export function replay(events: ExperimentEvent[]): { rows: Experiment[]; error: string | null } {
  const byId = new Map<string, Experiment>();
  for (const e of events) {
    if (e.ev === "start") {
      if (byId.has(e.id)) return { rows: [], error: `record is corrupt: ${e.id} starts twice` };
      byId.set(e.id, {
        id: e.id,
        question: e.question,
        levels: [...e.levels],
        started: e.started,
        measure: e.measure,
        look: e.look,
        state: "running",
        result: null,
        evidence: null,
        ended: null,
      });
    } else if (e.ev === "move") {
      const r = byId.get(e.id);
      if (r === undefined)
        return { rows: [], error: `record is corrupt: ${e.id} moves before it starts` };
      if (r.state !== "running")
        return { rows: [], error: `record is corrupt: ${e.id} moves after it concludes` };
      r.look = e.look;
    } else {
      const r = byId.get(e.id);
      if (r === undefined)
        return { rows: [], error: `record is corrupt: ${e.id} concludes before it starts` };
      if (r.state !== "running")
        return { rows: [], error: `record is corrupt: ${e.id} concludes twice` };
      r.state = "concluded";
      r.result = e.result;
      r.evidence = e.evidence;
      r.ended = e.ended;
    }
  }
  return { rows: [...byId.values()], error: null };
}

/** isDue <row> <today>: running, on or past its date to look. */
export function isDue(row: Experiment, today: string): boolean {
  return row.state === "running" && row.look <= today;
}

/** orderRows <rows> <today>: due first, then running by date, then concluded newest first. */
export function orderRows(rows: Experiment[], today: string): Experiment[] {
  const rank = (r: Experiment): number => (r.state === "concluded" ? 2 : isDue(r, today) ? 0 : 1);
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const ea = a.ended ?? "";
      const eb = b.ended ?? "";
      if (ea !== eb) return eb < ea ? -1 : 1;
    } else if (a.look !== b.look) {
      return a.look < b.look ? -1 : 1;
    }
    return idNum(a.id) - idNum(b.id);
  });
}

function formatOne(r: Experiment, today: string): string {
  const head = [
    r.id,
    r.state,
    ...(r.state === "running" && isDue(r, today) ? ["due"] : []),
    `look=${r.look}`,
    `started=${r.started}`,
    ...(r.ended === null ? [] : [`ended=${r.ended}`]),
  ].join(" ");
  const lines = [
    head,
    `  question: ${r.question}`,
    `  levels: ${r.levels.join(" | ")}`,
    `  measure: ${r.measure}`,
  ];
  if (r.state === "concluded" && r.result !== null) lines.push(`  result: ${r.result}`);
  if (r.evidence !== null) lines.push(`  evidence: ${r.evidence}`);
  return lines.join("\n");
}

/** formatList <rows> <today>: one block per experiment, in display order. */
export function formatList(rows: Experiment[], today: string): string {
  if (rows.length === 0) return "no experiments\n";
  return `${orderRows(rows, today)
    .map((r) => formatOne(r, today))
    .join("\n\n")}\n`;
}

/** pushDocs <rows>: every row as one JSON object keyed by id, for the page's store. */
export function pushDocs(rows: Experiment[]): string {
  const docs: Record<string, Omit<Experiment, "id">> = {};
  const ordered = [...rows].sort((a, b) => idNum(a.id) - idNum(b.id));
  for (const r of ordered) {
    docs[r.id] = {
      question: r.question,
      levels: r.levels,
      started: r.started,
      measure: r.measure,
      look: r.look,
      state: r.state,
      result: r.result,
      evidence: r.evidence,
      ended: r.ended,
    };
  }
  return `${JSON.stringify(docs, null, 2)}\n`;
}

type Applied = { event: ExperimentEvent; error: null } | { event: null; error: string };

/** applyStart <rows> <input> <today>: the start event, or why it is refused. */
export function applyStart(rows: Experiment[], input: StartInput, today: string): Applied {
  if (input.question.trim() === "") return { event: null, error: "a question is required" };
  if (input.levels.length < 2 || input.levels.some((l) => l.trim() === "")) {
    return { event: null, error: "two levels at least are required" };
  }
  if (input.measure.trim() === "") return { event: null, error: "a measure is required" };
  if (parseDate(input.look) === null) return { event: null, error: `bad date: ${input.look}` };
  return {
    event: {
      ev: "start",
      id: nextId(rows),
      question: input.question,
      levels: input.levels,
      measure: input.measure,
      started: today,
      look: input.look,
    },
    error: null,
  };
}

/** applyMove <rows> <id> <look>: the move event, or why it is refused. */
export function applyMove(rows: Experiment[], id: string, look: string): Applied {
  const r = rows.find((x) => x.id === id);
  if (r === undefined) return { event: null, error: `no such experiment: ${id}` };
  if (r.state !== "running") return { event: null, error: `already concluded: ${id}` };
  if (parseDate(look) === null) return { event: null, error: `bad date: ${look}` };
  return { event: { ev: "move", id, look }, error: null };
}

/** applyConclude <rows> <id> <result> <evidence>: the conclude event, or why not. */
export function applyConclude(
  rows: Experiment[],
  id: string,
  result: string,
  evidence: string | null,
  today: string,
): Applied {
  const r = rows.find((x) => x.id === id);
  if (r === undefined) return { event: null, error: `no such experiment: ${id}` };
  if (r.state !== "running") return { event: null, error: `already concluded: ${id}` };
  if (result.trim() === "") return { event: null, error: "a result is required" };
  return { event: { ev: "conclude", id, result, evidence, ended: today }, error: null };
}

// --- edge -------------------------------------------------------------------------------------

const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

function fail(message: string): never {
  console.error(`experiments: ${message}`);
  process.exit(1);
}

const LOCK_TIMEOUT_MS = 30000;
const LOCK_STALE_MS = 10000;
const LOCK_POLL_MS = 50;

let heldDir: string | null = null;
let heldToken: string | null = null;
let lockHookSet = false;

/** releaseLock: give the record lock back when it is still ours. */
export function releaseLock(): void {
  if (heldDir === null) return;
  try {
    const owner = readFileSync(join(heldDir, "owner"), "utf8").trim();
    if (owner === heldToken) rmSync(heldDir, { recursive: true, force: true });
  } catch {
    // best effort: a stale lock is stolen, never fatal
  }
  heldDir = null;
  heldToken = null;
}

function releaseOnExit(): void {
  if (lockHookSet) return;
  lockHookSet = true;
  process.on("exit", () => {
    releaseLock();
  });
}

export interface LockOpts {
  timeoutMs?: number;
  staleMs?: number;
  pollMs?: number;
}

/**
 * lockStep <age> <elapsed> <staleMs> <timeoutMs>: what a waiter does about a
 * held lock: steal it when stale, refuse past the timeout, else wait. An age
 * of -1 is a lock that vanished mid-check.
 */
export function lockStep(
  age: number,
  elapsed: number,
  staleMs: number,
  timeoutMs: number,
): "steal" | "wait" | "refuse" {
  if (age >= 0 && age > staleMs) return "steal";
  if (elapsed > timeoutMs) return "refuse";
  return "wait";
}

/**
 * acquireLock <root>: hold the experiments record lock across processes, so a
 * read, its validation and its append run as one mutation. The lock is not
 * reentrant: a second acquire in one process waits like any other. A lock
 * older than the stale age is a crashed holder's and is stolen; a live one is
 * waited on to the timeout, then refused. Fail paths exit through the process
 * exit hook, which releases what they hold.
 */
export function acquireLock(root: string, opts: LockOpts = {}): void {
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const pollMs = opts.pollMs ?? LOCK_POLL_MS;
  try {
    mkdirSync(join(root, ".postmaster"), { recursive: true });
  } catch {
    fail(`cannot lock the experiments record under ${root}`);
  }
  const dir = join(root, ".postmaster", "experiments.lock");
  releaseOnExit();
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      try {
        writeFileSync(join(dir, "owner"), `${token}\n`);
      } catch {
        // held without a token; the release skips it and it goes stale
      }
      heldDir = dir;
      heldToken = token;
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        fail(`cannot lock the experiments record under ${root}`);
      }
    }
    let age = -1;
    try {
      age = Date.now() - statSync(dir).mtimeMs;
    } catch {
      age = -1;
    }
    const step = lockStep(age, Date.now() - start, staleMs, timeoutMs);
    if (step === "steal") {
      // A second waiter may be stealing the same lock: back off a random beat,
      // then steal only what is still stale. A steal landing in the same beat
      // can still double-take; that needs a crashed holder with two waiters in
      // one beat, and the record's replay refuses the damage loudly.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(Math.random() * 200));
      let again = -1;
      try {
        again = Date.now() - statSync(dir).mtimeMs;
      } catch {
        again = -1;
      }
      if (lockStep(again, Date.now() - start, staleMs, timeoutMs) !== "steal") continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // lost the steal race; loop and queue again
      }
      continue;
    }
    if (step === "refuse") {
      fail("the experiments record is locked by another change; try again");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
}

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

interface Parsed {
  form: string;
  project: string;
  positionals: string[];
  question: string | null;
  levels: string[];
  measure: string | null;
  look: string | null;
  result: string | null;
  evidence: string | null;
  today: string | null;
}

const VALUE_FLAGS = new Set([
  "--project",
  "--question",
  "--level",
  "--measure",
  "--look",
  "--result",
  "--evidence",
  "--today",
]);

function parseArgs(argv: string[]): Parsed {
  const form = argv[0];
  if (
    form !== "start" &&
    form !== "move" &&
    form !== "conclude" &&
    form !== "list" &&
    form !== "push-docs"
  ) {
    usage();
  }
  const p: Parsed = {
    form,
    project: "",
    positionals: [],
    question: null,
    levels: [],
    measure: null,
    look: null,
    result: null,
    evidence: null,
    today: null,
  };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) {
      p.positionals.push(a);
      continue;
    }
    if (!VALUE_FLAGS.has(a)) usage();
    const v = rest[i + 1];
    if (v === undefined) usage();
    i++;
    switch (a) {
      case "--project":
        p.project = v;
        break;
      case "--question":
        p.question = v;
        break;
      case "--level":
        p.levels.push(v);
        break;
      case "--measure":
        p.measure = v;
        break;
      case "--look":
        p.look = v;
        break;
      case "--result":
        p.result = v;
        break;
      case "--evidence":
        p.evidence = v;
        break;
      case "--today":
        p.today = v;
        break;
      default:
        usage();
    }
  }
  if (p.project === "") usage();
  // Each form takes its own flags: a flag from another form is a usage error,
  // and a missing value is a refusal that names it.
  const only = (flags: string[]): void => {
    const seen = new Set<string>();
    if (p.question !== null) seen.add("--question");
    if (p.levels.length > 0) seen.add("--level");
    if (p.measure !== null) seen.add("--measure");
    if (p.look !== null) seen.add("--look");
    if (p.result !== null) seen.add("--result");
    if (p.evidence !== null) seen.add("--evidence");
    if (p.today !== null) seen.add("--today");
    for (const s of seen) {
      if (!flags.includes(s)) usage();
    }
  };
  if (form === "start") {
    if (p.positionals.length > 0) usage();
    only(["--question", "--level", "--measure", "--look"]);
    if (p.question === null) fail("start needs --question");
    if (p.levels.length === 0) fail("start needs --level twice at least");
    if (p.measure === null) fail("start needs --measure");
    if (p.look === null) fail("start needs --look");
  } else if (form === "move") {
    if (p.positionals.length !== 1) usage();
    only(["--look"]);
    if (p.look === null) fail("move needs --look");
  } else if (form === "conclude") {
    if (p.positionals.length !== 1) usage();
    only(["--result", "--evidence"]);
    if (p.result === null) fail("conclude needs --result");
    if (p.evidence !== null && p.evidence.trim() === "") fail("evidence must not be empty");
  } else if (form === "list") {
    if (p.positionals.length > 0) usage();
    only(["--today"]);
  } else {
    if (p.positionals.length > 0) usage();
    only([]);
  }
  return p;
}

/** The repository's top level, where .postmaster/ lives. */
function gitToplevel(raw: string): string {
  const root = projectRoot(raw);
  const g = run("git", ["-C", root, "rev-parse", "--show-toplevel"], { env: UNSET_GIT });
  if (g.code !== 0) fail(`not a git repository: ${raw}`);
  return g.out.trim();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** One validated event, or the line's corruption. */
function parseEvent(
  line: string,
  n: number,
): { event: ExperimentEvent; error: null } | { event: null; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(line) as unknown;
  } catch {
    return { event: null, error: `record is corrupt: line ${n} is not JSON` };
  }
  const o = asRecord(v);
  const bad = `record is corrupt: line ${n} is not an experiment event`;
  if (o === null || typeof o["ev"] !== "string" || typeof o["id"] !== "string") {
    return { event: null, error: bad };
  }
  if (!ID_RE.test(o["id"])) return { event: null, error: bad };
  if (o["ev"] === "start") {
    const question = nonEmpty(o["question"]);
    const measure = nonEmpty(o["measure"]);
    const levels = Array.isArray(o["levels"]) ? o["levels"] : null;
    const started = typeof o["started"] === "string" ? parseDate(o["started"]) : null;
    const look = typeof o["look"] === "string" ? parseDate(o["look"]) : null;
    if (
      question === null ||
      measure === null ||
      levels === null ||
      levels.length < 2 ||
      levels.some((l) => nonEmpty(l) === null) ||
      started === null ||
      look === null
    ) {
      return { event: null, error: bad };
    }
    return {
      event: {
        ev: "start",
        id: o["id"],
        question,
        levels: levels as string[],
        measure,
        started,
        look,
      },
      error: null,
    };
  }
  if (o["ev"] === "move") {
    const look = typeof o["look"] === "string" ? parseDate(o["look"]) : null;
    if (look === null) return { event: null, error: bad };
    return { event: { ev: "move", id: o["id"], look }, error: null };
  }
  if (o["ev"] === "conclude") {
    const result = nonEmpty(o["result"]);
    const evidence =
      o["evidence"] === null || o["evidence"] === undefined ? null : nonEmpty(o["evidence"]);
    const ended = typeof o["ended"] === "string" ? parseDate(o["ended"]) : null;
    if (
      result === null ||
      ended === null ||
      (o["evidence"] !== null && o["evidence"] !== undefined && evidence === null)
    ) {
      return { event: null, error: bad };
    }
    return { event: { ev: "conclude", id: o["id"], result, evidence, ended }, error: null };
  }
  return { event: null, error: bad };
}

function readRecord(path: string): ExperimentEvent[] {
  if (isSymlink(path)) fail(`${path} must be a file inside the project, not a symlink`);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const events: ExperimentEvent[] = [];
  let n = 0;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    n++;
    const parsed = parseEvent(line, n);
    if (parsed.error !== null) fail(parsed.error);
    events.push(parsed.event);
  }
  return events;
}

function main(): void {
  const argv = argvDecoded();
  const p = parseArgs(argv);
  let root: string;
  try {
    root = gitToplevel(p.project);
  } catch (e) {
    if (isDie(e)) fail(e.message);
    throw e;
  }
  try {
    settingsDir(root);
  } catch (e) {
    if (isDie(e)) fail(e.message);
    throw e;
  }
  acquireLock(root);
  const record = join(root, ".postmaster", "experiments.jsonl");
  const replayed = replay(readRecord(record));
  if (replayed.error !== null) fail(replayed.error);
  const rows = replayed.rows;
  const today = new Date().toISOString().slice(0, 10);

  if (p.form === "list") {
    const at = p.today ?? today;
    if (parseDate(at) === null) fail(`bad date: ${p.today}`);
    process.stdout.write(formatList(rows, at));
    releaseLock();
    return;
  }
  if (p.form === "push-docs") {
    process.stdout.write(pushDocs(rows));
    releaseLock();
    return;
  }

  let applied: Applied;
  let detail: string[];
  if (p.form === "start") {
    applied = applyStart(
      rows,
      { question: p.question!, levels: p.levels, measure: p.measure!, look: p.look! },
      today,
    );
    detail = ["start", `look=${p.look}`];
  } else if (p.form === "move") {
    applied = applyMove(rows, p.positionals[0]!, p.look!);
    detail = ["move", `look=${p.look}`];
  } else {
    applied = applyConclude(rows, p.positionals[0]!, p.result!, p.evidence, today);
    detail = ["conclude"];
  }
  if (applied.error !== null) fail(applied.error);
  try {
    ensureIgnore(root, true);
  } catch (e) {
    if (isDie(e)) fail(e.message);
    throw e;
  }
  if (isSymlink(record)) {
    fail(`${record} must be a file inside the project, not a symlink`);
  }
  // The ledger first: a logging failure then leaves the record untouched, so a
  // retry repeats the change instead of duplicating it. A record failure after
  // the log leaves a spare ledger line, which a retry doubles harmlessly.
  if (logProjectEvent(root, "postmaster", "experiment", applied.event.id, detail) !== 0) {
    process.exit(1);
  }
  appendFileSync(record, `${JSON.stringify(applied.event)}\n`);
  releaseLock();
  console.log(applied.event.id);
}

if (import.meta.main) {
  main();
}
