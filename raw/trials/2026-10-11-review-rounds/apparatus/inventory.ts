// Read every run of this repository's tickets and write one row per run (see ../method.md).
//
//   bun --no-env-file --config=/dev/null inventory.ts --project <repo> --legacy <dir> \
//       --cut <iso> --out <file>
//
// `--project` is the repository whose `.postmaster/runs` holds the runs, `--legacy` the older shared
// folder where the first week's runs live. A run's folder is only read. The output holds counts,
// times and names of lanes: no path, no thread, no session and no text of a finding.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseActions } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import { privacyFaults, readTeam } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import {
  dispatchedAt,
  findingsOf,
  reviewEndedAt,
  roundsInActions,
  roundsInFileNames,
  seriousByRound,
  silentRounds,
} from "./rounds.ts";
import { withSupplement } from "./supplement.ts";
import { type TicketFeatures, ticketFeatures, ticketOfWaybill } from "./ticket.ts";

export type RunRow = {
  run: string;
  layout: "project" | "legacy";
  dispatchedAt: string | null;
  /** when the review leg ended (the stage line that names shipping), null while it is running */
  reviewEndedAt: string | null;
  /** the postmaster commit the run was dispatched from, 8 characters */
  pin: string | null;
  mode: "single-thread" | "synthesis";
  workhorses: string[];
  reviewers: string[];
  security: string[];
  manifestStage: string | null;
  rounds: number;
  roundsInActions: number;
  roundsInFiles: number;
  /** serious findings in each round, from the finding lines; index 0 is round 1 */
  seriousByRound: number[];
  seriousNoRound: number;
  seriousTotal: number;
  /** the same with the rounds that have no finding line filled from the run's own record */
  seriousBest: number[];
  /** the rounds so filled */
  filledRounds: number[];
  /** rounds 2 to rounds-1 in which no serious finding line is logged */
  silentRounds: number[];
  findingLines: number;
  ticketSource: "ticket-body" | "waybill" | "none";
  ticket: TicketFeatures | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
};

/** The run folders under one root that hold an action log and are named by a ticket number alone. */
export function runFolders(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => /^[0-9]+$/u.test(n))
    .filter((n) => statSync(join(root, n)).isDirectory())
    .filter((n) => existsSync(join(root, n, "actions.jsonl")))
    .sort((a, b) => Number(a) - Number(b));
}

export function readRunRow(dir: string, run: string, layout: RunRow["layout"]): RunRow {
  const { actions } = parseActions(readText(join(dir, "actions.jsonl")));
  const findings = findingsOf(actions);
  const counts = seriousByRound(findings);
  const names = [
    ...(existsSync(dir) ? readdirSync(dir) : []),
    ...(existsSync(join(dir, "logs")) ? readdirSync(join(dir, "logs")) : []),
  ];
  const inActions = roundsInActions(actions);
  const inFiles = roundsInFileNames(names);
  const rounds = Math.max(inActions, inFiles);
  const runJson = readJson(join(dir, "run.json"));
  const manifest = readJson(join(dir, "manifest.json"));
  const team = readTeam(dir);
  const pinFull =
    isRecord(runJson) && isRecord(runJson.postmaster) && typeof runJson.postmaster.commit === "string"
      ? runJson.postmaster.commit
      : null;
  const body = readText(join(dir, "ticket-body.md"));
  const brief = readText(join(dir, "brief.md"));
  const text = body !== "" ? body : ticketOfWaybill(brief);
  const byRound: number[] = [];
  for (let r = 1; r <= rounds; r += 1) byRound.push(counts.byRound.get(r) ?? 0);
  const supplemented = withSupplement(run, byRound);
  return {
    run,
    layout,
    dispatchedAt: dispatchedAt(actions),
    reviewEndedAt: reviewEndedAt(actions),
    pin: pinFull ? pinFull.slice(0, 8) : null,
    mode: isRecord(runJson) && runJson.mode === "single-thread" ? "single-thread" : "synthesis",
    workhorses: team?.workhorses ?? [],
    reviewers: team?.reviewers ?? [],
    security: team?.lensReviewers.security ?? [],
    manifestStage:
      isRecord(manifest) && typeof manifest.stage === "string" ? manifest.stage : null,
    rounds,
    roundsInActions: inActions,
    roundsInFiles: inFiles,
    seriousByRound: byRound,
    seriousNoRound: counts.noRound,
    seriousTotal: counts.total,
    seriousBest: supplemented.best,
    filledRounds: supplemented.filled,
    silentRounds: silentRounds(rounds, counts.byRound),
    findingLines: findings.length,
    ticketSource: body !== "" ? "ticket-body" : text !== "" ? "waybill" : "none",
    ticket: text !== "" ? ticketFeatures(text) : null,
  };
}

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const main = (args: string[]): void => {
  const project = arg(args, "--project");
  const legacy = arg(args, "--legacy");
  const cut = arg(args, "--cut");
  const out = arg(args, "--out");
  if (!project || !cut || !out) {
    throw new Error("usage: inventory.ts --project <repo> [--legacy <dir>] --cut <iso> --out <file>");
  }
  const rows: RunRow[] = [];
  for (const [root, layout] of [
    [join(project, ".postmaster", "runs"), "project"],
    [legacy ?? "", "legacy"],
  ] as const) {
    if (root === "") continue;
    for (const run of runFolders(root)) rows.push(readRunRow(join(root, run), run, layout));
  }
  // A ticket number can name a run in both places; the project's own folder is the newer.
  const seen = new Map<string, RunRow>();
  for (const r of rows) if (!seen.has(r.run) || r.layout === "project") seen.set(r.run, r);
  const result = {
    cut,
    runs: [...seen.values()].sort((a, b) => Number(a.run) - Number(b.run)),
  };
  const text = `${JSON.stringify(result, null, 1)}\n`;
  const faults = privacyFaults(text);
  if (faults.length > 0) throw new Error(`the output holds ${faults.join(" and ")}; nothing written`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, text);
  console.error(`${result.runs.length} runs read`);
};

if (import.meta.main) main(process.argv.slice(2));
