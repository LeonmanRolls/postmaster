// The tables of the record, computed from the derived data (see ../method.md). Pure: it takes the
// rows `inventory.ts` and `trace.ts` wrote and returns numbers and rows. `render.ts` prints them.
import { mean, median, quantile, spearman, sum } from "./stats.ts";

export type RunInput = {
  run: string;
  mode: "single-thread" | "synthesis";
  shape: "one-part" | "two-part" | null;
  rounds: number;
  /** serious findings in each round, the finding lines and the run's own figure where lines are missing */
  best: number[];
  /** from the finding lines alone */
  lines: number[];
  criteria: number | null;
  decisions: number | null;
  checks: number | null;
  notes: number | null;
  chars: number | null;
  changeLines: number | null;
  changeFiles: number | null;
  fixLines: number | null;
  dispatchedAt: string | null;
};

/**
 * The lines and files of the change a run made before its first review, from the commits traced to
 * it. Null where none could be traced: a size that is not known is not a size of nothing.
 */
export function changeSize(
  commits: ReadonlyArray<{
    phase: string;
    onMain: boolean;
    added: number;
    deleted: number;
    paths: readonly string[];
  }>,
): { lines: number; files: number } | null {
  const change = commits.filter((c) => c.phase === "change" && !c.onMain);
  if (change.length === 0) return null;
  return {
    lines: sum(change.map((c) => c.added + c.deleted)),
    files: new Set(change.flatMap((c) => c.paths)).size,
  };
}

/** The three groups the runs fall in by how their ticket was prepared and what mode they ran in. */
export type Era =
  | "A one-part ticket, several workhorses"
  | "B two-part ticket, several workhorses"
  | "C two-part ticket, single thread";

export function eraOf(r: Pick<RunInput, "mode" | "shape">): Era {
  if (r.mode === "single-thread") return "C two-part ticket, single thread";
  return r.shape === "two-part"
    ? "B two-part ticket, several workhorses"
    : "A one-part ticket, several workhorses";
}

export type RoundsSummary = {
  n: number;
  total: number;
  median: number;
  mean: number;
  max: number;
  twoOrFewer: number;
  three: number;
  fourOrFive: number;
  sixOrMore: number;
  /** rounds in the runs of six or more */
  inLong: number;
  firstRoundMedian: number;
};

export function roundsSummary(runs: readonly RunInput[]): RoundsSummary {
  const rs = runs.map((r) => r.rounds);
  return {
    n: runs.length,
    total: sum(rs),
    median: median(rs),
    mean: mean(rs),
    max: rs.length === 0 ? 0 : Math.max(...rs),
    twoOrFewer: rs.filter((x) => x <= 2).length,
    three: rs.filter((x) => x === 3).length,
    fourOrFive: rs.filter((x) => x === 4 || x === 5).length,
    sixOrMore: rs.filter((x) => x >= 6).length,
    inLong: sum(rs.filter((x) => x >= 6)),
    firstRoundMedian: median(runs.map((r) => r.best[0] ?? 0)),
  };
}

export type Structure = {
  /** rounds up to and including the last that holds a serious finding */
  working: number;
  /** rounds after it: the clean rounds that confirm the last fixes */
  confirming: number;
  /** runs whose last round still held a serious finding */
  endedOnFinding: number;
  /** runs by the number of rounds after their last serious finding */
  byConfirming: Record<number, number>;
  noFindingRoundOne: number;
};

export function structure(runs: readonly RunInput[]): Structure {
  let working = 0;
  let confirming = 0;
  let endedOnFinding = 0;
  let noFindingRoundOne = 0;
  const byConfirming: Record<number, number> = {};
  for (const r of runs) {
    let last = 0;
    r.best.forEach((n, i) => {
      if (n > 0) last = i + 1;
    });
    const after = r.rounds - last;
    working += last;
    confirming += after;
    if (after === 0) endedOnFinding += 1;
    byConfirming[after] = (byConfirming[after] ?? 0) + 1;
    if ((r.best[0] ?? 0) === 0) noFindingRoundOne += 1;
  }
  return { working, confirming, endedOnFinding, byConfirming, noFindingRoundOne };
}

export type Correlation = { feature: string; n: number; rounds: number; first: number };

const pairs = (
  runs: readonly RunInput[],
  pick: (r: RunInput) => number | null,
): { x: number[]; rounds: number[]; first: number[] } => {
  const x: number[] = [];
  const rounds: number[] = [];
  const first: number[] = [];
  for (const r of runs) {
    const v = pick(r);
    if (v === null) continue;
    x.push(v);
    rounds.push(r.rounds);
    first.push(r.best[0] ?? 0);
  }
  return { x, rounds, first };
};

/** Spearman's rho of rounds, and of the first round's serious findings, against each feature. */
export function correlations(runs: readonly RunInput[]): Correlation[] {
  const features: Array<[string, (r: RunInput) => number | null]> = [
    ["acceptance criteria", (r) => r.criteria],
    ["decisions", (r) => r.decisions],
    ["checks", (r) => r.checks],
    ["technical notes", (r) => r.notes],
    ["ticket length, characters", (r) => r.chars],
    ["lines changed before review", (r) => r.changeLines],
    ["files changed before review", (r) => r.changeFiles],
    ["serious findings in round 1", (r) => r.best[0] ?? 0],
  ];
  return features.map(([feature, pick]) => {
    const p = pairs(runs, pick);
    return {
      feature,
      n: p.x.length,
      rounds: spearman(p.x, p.rounds),
      first: spearman(p.x, p.first),
    };
  });
}

export type BandRow = {
  band: string;
  n: number;
  median: number;
  atLeastFive: number;
  firstMedian: number;
  max: number;
};

/** Runs grouped by a band of one feature, with their rounds. */
export function bands(
  runs: readonly RunInput[],
  bandOf: (r: RunInput) => string | null,
  order: readonly string[],
): BandRow[] {
  const out: BandRow[] = [];
  for (const band of order) {
    const v = runs.filter((r) => bandOf(r) === band);
    if (v.length === 0) continue;
    const rs = v.map((r) => r.rounds);
    out.push({
      band,
      n: v.length,
      median: median(rs),
      atLeastFive: rs.filter((x) => x >= 5).length,
      firstMedian: median(v.map((r) => r.best[0] ?? 0)),
      max: Math.max(...rs),
    });
  }
  return out;
}

export const criteriaBand = (r: RunInput): string | null =>
  r.criteria === null
    ? null
    : r.criteria <= 3
      ? "1 to 3"
      : r.criteria <= 5
        ? "4 to 5"
        : r.criteria <= 8
          ? "6 to 8"
          : "9 or more";

export const CRITERIA_BANDS = ["1 to 3", "4 to 5", "6 to 8", "9 or more"] as const;

export const changeBand = (r: RunInput): string | null =>
  r.changeLines === null
    ? null
    : r.changeLines < 400
      ? "under 400"
      : r.changeLines < 1000
        ? "400 to 999"
        : r.changeLines < 2500
          ? "1,000 to 2,499"
          : "2,500 or more";

export const CHANGE_BANDS = ["under 400", "400 to 999", "1,000 to 2,499", "2,500 or more"] as const;

export { median, quantile };
