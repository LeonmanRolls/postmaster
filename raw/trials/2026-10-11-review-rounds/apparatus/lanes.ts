// Each reviewer lane's time and yield in each round of each run (see ../method.md, "Stop
// signals"). Run folders are only read.
//
//   bun --no-env-file --config=/dev/null lanes.ts --project <repo> --legacy <dir> \
//       --runs results/runs.json --findings results/findings.json --cut <iso> --out <file>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseActions, parseReviewRef } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import { privacyFaults, readReviewDone } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import { LANES } from "./rounds.ts";
import type { TracedFinding } from "./trace.ts";

export type LaneRound = {
  run: string;
  round: number;
  lane: string;
  /** lenses the lane ran in the round */
  lenses: string[];
  /** minutes from its launch to its last exit, summed over its lenses; null where a time is missing */
  minutes: number | null;
  /** serious findings of the round that name the lane */
  named: number;
  /** of those, findings that name no other lane */
  alone: number;
};

/** The lanes and lenses of a round from its launch lines, with each launch's time in seconds. */
export function launchesOf(
  actions: ReturnType<typeof parseActions>["actions"],
): Array<{ round: number; lens: string; lane: string; at: number }> {
  const out: Array<{ round: number; lens: string; lane: string; at: number }> = [];
  for (const a of actions) {
    if (a.action !== "review-launch") continue;
    const ref = parseReviewRef(a.detail);
    if (ref.round === null || ref.lens === null) continue;
    if (!(LANES as readonly string[]).includes(a.target) || a.target === "coachman") continue;
    out.push({ round: ref.round, lens: ref.lens, lane: a.target, at: Date.parse(a.ts) / 1000 });
  }
  return out;
}

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

type RunRowLite = {
  run: string;
  layout: "project" | "legacy";
  rounds: number;
  reviewEndedAt: string | null;
};

const main = (args: string[]): void => {
  const project = arg(args, "--project");
  const legacy = arg(args, "--legacy");
  const runsFile = arg(args, "--runs");
  const findingsFile = arg(args, "--findings");
  const cut = arg(args, "--cut");
  const after = arg(args, "--after");
  const out = arg(args, "--out");
  if (!project || !runsFile || !findingsFile || !cut || !out) {
    throw new Error(
      "usage: lanes.ts --project <repo> [--legacy <dir>] --runs f --findings f --cut <iso> [--after <iso>] --out f",
    );
  }
  const runs = (JSON.parse(readFileSync(runsFile, "utf8")) as { runs: RunRowLite[] }).runs.filter(
    (r) =>
      r.rounds > 0 &&
      r.reviewEndedAt !== null &&
      r.reviewEndedAt <= cut &&
      (!after || r.reviewEndedAt > after),
  );
  const findings = (JSON.parse(readFileSync(findingsFile, "utf8")) as { findings: TracedFinding[] })
    .findings;
  const rows: LaneRound[] = [];
  for (const r of runs) {
    const dir =
      r.layout === "project"
        ? join(project, ".postmaster", "runs", r.run)
        : join(legacy ?? "", r.run);
    if (!existsSync(join(dir, "actions.jsonl"))) continue;
    const { actions } = parseActions(readFileSync(join(dir, "actions.jsonl"), "utf8"));
    const launches = launchesOf(actions);
    const done = readReviewDone(dir);
    const keys = new Set(launches.map((l) => `${l.round}|${l.lane}`));
    for (const key of keys) {
      const [roundText, lane] = key.split("|") as [string, string];
      const round = Number(roundText);
      const mine = launches.filter((l) => l.round === round && l.lane === lane);
      let minutes: number | null = 0;
      for (const l of mine) {
        const d = done.find((x) => x.round === round && x.lens === l.lens && x.lane === lane);
        if (!d) {
          minutes = null;
          break;
        }
        minutes += Math.max(0, (Date.parse(d.done) / 1000 - l.at) / 60);
      }
      const here = findings.filter(
        (f) => f.run === r.run && f.round === round && f.lanes.includes(lane),
      );
      rows.push({
        run: r.run,
        round,
        lane,
        lenses: [...new Set(mine.map((m) => m.lens))].sort(),
        minutes: minutes === null ? null : Math.round(minutes * 10) / 10,
        named: here.length,
        alone: here.filter((f) => f.lanes.length === 1).length,
      });
    }
  }
  const text = `${JSON.stringify({ cut, after: after ?? null, rows }, null, 1)}\n`;
  const faults = privacyFaults(text);
  if (faults.length > 0)
    throw new Error(`the output holds ${faults.join(" and ")}; nothing written`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, text);
  console.error(`${rows.length} lane rounds`);
};

if (import.meta.main) main(process.argv.slice(2));
