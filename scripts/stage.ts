// Move a run to a stage. This is the one way a run's stage changes, so every change is logged,
// and the run's timings (scripts/run-times.sh) are computed from those log lines rather than
// written by hand.
//
//   stage.sh <dispatch> <stage> [actor]   actor defaults to coachman
//   stage.sh --list                       the stages, in order
//
// It logs a `stage` action naming the stage left and how long it lasted, changes only the
// manifest's `stage` field, and appends the same line to run-log.md. Setting the stage a run is
// already in does nothing, so a resumed or remounted leg can set it again safely. Setting a
// terminal stage (done, abandoned) also appends the run's full stage timings to run-log.md.
// Only the postmaster sets a terminal stage, or moves a run out of one: it closes a run after
// the last leg, and abandons one on the user's word. A run is at most two legs: the last one
// carries it to `shipping` with the ship card, and the postmaster sets `shipped` after the
// merge and `done` when it closes. `review` is entered only by a run with a review leg. A
// run dispatched before this change keeps its three legs and the stages they enter. The actor
// is the caller's own word, so this holds a coachman to its runbook; it cannot stop a process
// that names itself the postmaster.
//
//   exit 0  the stage was set, or already was
//   exit 1  usage, no manifest, an unreadable manifest, or the log could not be written
//   exit 2  not one of the stages
//   exit 3  the run is done or abandoned, and only the postmaster moves it on
//   exit 4  a terminal stage, or shipped on a contract 2 run, set by any actor but the postmaster
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { pyRstrip } from "./lib/text.ts";

export const STAGES =
  "dispatched bootstrapped planning workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned";
const STAGE_LIST = STAGES.split(" ");

// Lines with their endings kept, as str.splitlines(keepends=True) cuts
// them: every Python boundary ends a line, and the file round-trips.
function keependsLines(text: string): string[] {
  const m =
    text.match(
      /[^\r\n\x0b\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|\n|\r|\x0b|\f|\x1c|\x1d|\x1e|\x85|\u2028|\u2029|$)/gu,
    ) ?? [];
  return m.filter((l) => l !== "");
}

// Refresh the final usage sum after the last launch has exited: the sum
// into run-log.md, and the ship card's ## Cost block rewritten around it.
function closeUsage(d: string): number {
  const here = scriptsDir(import.meta);
  const s = run("bun", [join(here, "usage.ts"), "sum", d]);
  let logStatus = 0;
  let summary: string;
  if (s.code === 0) {
    summary = s.out + s.err;
    if (run("bash", [join(here, "run-log.sh"), d, "final cost block:", summary]).code !== 0)
      logStatus = 1;
  } else {
    const combined = s.out + s.err;
    summary = combined === "" ? "usage sum failed" : combined;
    if (
      run("bash", [join(here, "run-log.sh"), d, "final cost block unreadable:", summary]).code !== 0
    )
      logStatus = 1;
  }
  const cardPath = join(d, "card.md");
  try {
    if (!statSync(cardPath).isFile()) return logStatus;
  } catch {
    return logStatus;
  }
  let text: string;
  try {
    text = readFileSync(cardPath, "utf8");
  } catch (e) {
    console.error(
      `stage: cannot refresh the ship card's cost block: ${e instanceof Error ? e.message : e}`,
    );
    return 1;
  }
  const block = `## Cost\n\n\`\`\`\n${summary.replace(/\n+$/u, "")}\n\`\`\`\n`;
  const lines = keependsLines(text);
  const start = lines.findIndex((l) => l.replace(/[\r\n]+$/u, "") === "## Cost");
  let next: string;
  if (start === -1) {
    next = `${pyRstrip(text)}\n\n${block}`;
  } else {
    const tail = lines.slice(start + 1);
    const endAt = tail.findIndex((l) => l.startsWith("## "));
    const rest = endAt === -1 ? "" : tail.slice(endAt).join("");
    next = `${lines.slice(0, start).join("")}${block}\n${rest}`;
  }
  const temporary = mkstempSync(d, ".card-cost-");
  try {
    writeFileSync(temporary, next);
    renameSync(temporary, cardPath);
  } catch {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* best effort */
    }
    return 1;
  }
  return logStatus;
}

/** Its run.json records coachman contract 2, exactly: anything missing, unreadable or
 * otherwise gets the old behavior. An exact int only — 2.0 parses to 2 but is not one. */
export function isCurrent(d: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(join(d, "run.json"), "utf8");
  } catch {
    return false;
  }
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
  const contract = (record as Record<string, unknown>).coachman_contract;
  if (typeof contract !== "number" || !Number.isInteger(contract) || contract !== 2) {
    return false;
  }
  return /"coachman_contract"[ \t\n\r]*:[ \t\n\r]*2(?![0-9.eE])/u.test(raw);
}

export function setStage(d: string, newStage: string, actor: string): number {
  const HERE = scriptsDir(import.meta);

  if (!STAGE_LIST.includes(newStage)) {
    console.error(`stage: '${newStage}' is not a stage; one of: ${STAGES}`);
    return 2;
  }
  if (newStage === "done" || newStage === "abandoned") {
    if (actor !== "postmaster") {
      console.error(`stage: only the postmaster sets ${newStage}`);
      return 4;
    }
  }
  if (newStage === "shipped" && actor !== "postmaster" && isCurrent(d)) {
    console.error("stage: only the postmaster sets shipped on a contract 2 run");
    return 4;
  }
  const manifestPath = join(d, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`stage: no manifest at ${manifestPath}`);
    return 1;
  }

  // Compute the plan
  let old: string | null = null;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    old = m.stage ?? null;
  } catch {
    console.error(`stage: ${manifestPath} does not parse`);
    return 1;
  }

  if (old === newStage) {
    console.log(`stage: already ${newStage}`);
    return 0;
  }
  if ((old === "done" || old === "abandoned") && actor !== "postmaster") {
    console.error(`stage: the run is ${old}; only the postmaster moves it on`);
    return 3;
  }

  // Find when the stage being left was entered
  let since: string | null = null;
  const logPath = join(d, "actions.jsonl");
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (
          (e.action === "stage" && e.target === old) ||
          (e.action === "dispatch" && since === null)
        ) {
          since = e.ts;
        }
      } catch {}
    }
  }

  let took = "";
  if (since) {
    const now = Math.floor(Date.now() / 1000);
    const iso = since.endsWith("Z") ? since : `${since.replace(" ", "T")}Z`;
    const sinceSec = Math.floor(new Date(iso).getTime() / 1000);
    const sec = Math.max(0, now - sinceSec);
    const h = Math.floor(sec / 3600);
    const rem = sec % 3600;
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    const dur = h
      ? `${h}h ${String(m).padStart(2, "0")}m`
      : m
        ? `${m}m ${String(s).padStart(2, "0")}s`
        : `${s}s`;
    took = ` after ${dur}`;
  }

  // Log the change first
  const logResult = run("bash", [
    join(HERE, "log-action.sh"),
    d,
    actor,
    "stage",
    newStage,
    `from ${old ?? "none"}${took}`,
  ]);
  if (logResult.code !== 0) {
    console.error("stage: could not log the change");
    return 1;
  }

  // Write the manifest
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    m.stage = newStage;
    const tmp = mkstempSync(d, "tmp");
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`);
    renameSync(tmp, manifestPath);
  } catch {
    console.error("stage: logged, but could not write the manifest");
    return 1;
  }

  // Append to run-log.md
  run("bash", [join(HERE, "run-log.sh"), d, `stage ${newStage}, from ${old ?? "none"}${took}`]);

  // Terminal stage: append timings
  if (newStage === "done" || newStage === "abandoned") {
    const timesResult = run("bash", [join(HERE, "run-times.sh"), d]);
    const timingBlock = `\nStage timings, from actions.jsonl:\n\n\`\`\`\n${timesResult.out}\`\`\`\n`;
    try {
      appendFileSync(join(d, "run-log.md"), timingBlock);
    } catch {
      /* ignore */
    }
    if (closeUsage(d) !== 0) {
      console.error("stage: the run closed, but its final cost block could not be written");
    }
  }

  console.log(`stage: ${old ?? "none"} -> ${newStage}${took}`);
  return 0;
}

// --- entry ------------------------------------------------------------------------------
function main(argv: string[]): number {
  if (argv[0] === "--list") {
    for (const s of STAGE_LIST) console.log(s);
    return 0;
  }
  if (argv[0] === "" || argv[0] === undefined || argv[0].startsWith("-")) {
    console.error("usage: stage.sh <dispatch> <stage> [actor] | --list");
    return 1;
  }
  if (argv.length < 2) {
    console.error("usage: stage.sh <dispatch> <stage> [actor]");
    return 1;
  }
  return setStage(argv[0] as string, argv[1] as string, (argv[2] as string) ?? "coachman");
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
