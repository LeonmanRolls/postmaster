// Container time a run would use if every launch ran in a container of its own (see ../method.md).
// Pure functions over the lane audit's derived data (`2026-10-03-lane-audit/results/runs.json`);
// `run.ts` reads the file and writes the tables. Nothing here reads a run's own records.
import {
  median,
  percentile,
  reachedSynthesis,
  roundTimes,
} from "../../2026-10-03-lane-audit/apparatus/analyze.ts";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";

/** The stages in which a coachman leg can be running. Planning includes the wait for the user's spec review. */
export const COACHMAN_STAGES = [
  "planning",
  "workhorses-running",
  "synthesis",
  "checkpoint-1",
  "review",
] as const;

/** A set of launches: how many, how long each ran, in seconds. */
export type Launches = { each: number[] };

export type RunTime = {
  run: string;
  /** workhorse lanes, from the start of implementing to the exit of the process */
  lanes: Launches;
  /** lanes with no recorded time, which are left out of `lanes` */
  lanesUnmeasured: number;
  /** each reviewer's exit less the first launch line of its round, for rounds that have both */
  reviewers: Launches;
  /** the coachman's gate runs on a lane's branch */
  gatesOnLanes: Launches;
  /** the coachman's gate runs on the synthesis */
  gatesOnSynthesis: Launches;
  /** seconds in the stages a coachman leg can run in: an upper bound on its process time */
  coachmanUpper: number;
};

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Seconds of a launch set. */
export const seconds = (l: Launches): number => sum(l.each);

/** The container time of one run, from its derived record. */
export function runTime(run: RunRecord): RunTime {
  const measured = run.lanes.flatMap((l) => (l.implementSeconds === null ? [] : [l.implementSeconds]));
  const gates = run.gates.filter((g) => g.name === "gate");
  const stageSeconds = run.stages
    .filter((s) => (COACHMAN_STAGES as readonly string[]).includes(s.stage) && s.seconds !== null)
    .reduce((a, s) => a + (s.seconds ?? 0), 0);
  return {
    run: run.id,
    lanes: { each: measured },
    lanesUnmeasured: run.lanes.length - measured.length,
    reviewers: { each: roundTimes(run).flatMap((r) => Object.values(r.seconds)) },
    gatesOnLanes: { each: gates.filter((g) => g.lane !== null).map((g) => g.seconds) },
    gatesOnSynthesis: { each: gates.filter((g) => g.lane === null).map((g) => g.seconds) },
    coachmanUpper: stageSeconds,
  };
}

/** The runs a table covers: real runs that reached synthesis, or fixture runs that did. */
export const covered = (runs: readonly RunRecord[], kind: "real" | "fixture"): RunRecord[] =>
  runs.filter((r) => r.kind === kind && !r.parked && reachedSynthesis(r));

export type Role = "lanes" | "reviewers" | "gatesOnLanes" | "gatesOnSynthesis";

export type RoleSummary = {
  launches: number;
  totalSeconds: number;
  /** across runs, the median run's seconds in this role */
  medianPerRun: number | null;
  /** across single launches */
  medianEach: number | null;
  p90Each: number | null;
  longestEach: number | null;
};

export function summarizeRole(times: readonly RunTime[], role: Role): RoleSummary {
  const each = times.flatMap((t) => t[role].each);
  return {
    launches: each.length,
    totalSeconds: sum(each),
    medianPerRun: median(times.map((t) => seconds(t[role]))),
    medianEach: median(each),
    p90Each: percentile(each, 0.9),
    longestEach: each.length === 0 ? null : Math.max(...each),
  };
}
