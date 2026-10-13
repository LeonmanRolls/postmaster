// The rule the review loop ran under, and what the rule in force would have done with a run's
// serious findings per round (see ../method.md). Pure: it takes counts and returns decisions.
import { eraOf, type RunInput } from "./analysis.ts";
import { mean, median, sum } from "./stats.ts";

export type LoopRule = "until-clean" | "scripted-cap" | "rise";

export const LOOP_RULES: ReadonlyArray<{ rule: LoopRule; label: string }> = [
  {
    rule: "until-clean",
    label: "Goes on until a round finds nothing, a cap of three rounds, before 29 September",
  },
  {
    rule: "scripted-cap",
    label:
      "Another round only after a round with a verified P1 or P2, a cap of three rounds (#80, from 29 September)",
  },
  {
    rule: "rise",
    label:
      "Goes on while a round finds no more than the one before, a rise stops it for a ruling, no cap (#316, from 9 October)",
  },
];

/** The rule a pinned commit carried, from whether it holds each of the two changes. */
export function ruleOf(holdsScripted: boolean | null, holdsRise: boolean | null): LoopRule | null {
  if (holdsScripted === null || holdsRise === null) return null;
  if (holdsRise) return "rise";
  return holdsScripted ? "scripted-cap" : "until-clean";
}

/** The first round, counted from 2, that logged more serious findings than the round before. */
export function firstRise(counts: readonly number[]): number | null {
  for (let i = 1; i < counts.length; i++) {
    if ((counts[i] ?? 0) > (counts[i - 1] ?? 0)) return i + 1;
  }
  return null;
}

export type RiseRun = { run: string; rounds: number; best: readonly number[] };

export type RiseReplay = {
  runs: number;
  rounds: number;
  /** runs with at least one round that logged more than the round before */
  rose: number;
  neverRose: number;
  /** the round of each rising run's first rise, ascending */
  firstRounds: number[];
  /** rounds that came after a run's first rise, summed */
  roundsAfterFirstRise: number;
  roundsMedianRose: number;
  roundsMedianNever: number;
  /** runs of six rounds or more, and how many of them rose */
  long: number;
  longRose: number;
};

export function riseReplay(runs: readonly RiseRun[]): RiseReplay {
  const risen = runs.map((r) => ({ r, at: firstRise(r.best) }));
  const rose = risen.filter((x) => x.at !== null);
  const never = risen.filter((x) => x.at === null);
  return {
    runs: runs.length,
    rounds: runs.reduce((a, r) => a + r.rounds, 0),
    rose: rose.length,
    neverRose: never.length,
    firstRounds: rose.map((x) => x.at as number).sort((a, b) => a - b),
    roundsAfterFirstRise: rose.reduce((a, x) => a + x.r.rounds - (x.at as number), 0),
    roundsMedianRose: median(rose.map((x) => x.r.rounds)),
    roundsMedianNever: median(never.map((x) => x.r.rounds)),
    long: runs.filter((r) => r.rounds >= 6).length,
    longRose: rose.filter((x) => x.r.rounds >= 6).length,
  };
}

export type RuleRow = {
  rule: LoopRule;
  runs: number;
  rounds: number;
  median: number;
  most: number;
  /** runs that went past three rounds */
  pastThree: number;
  /** serious findings in round 1, median */
  roundOneMedian: number;
};

/** The runs under each rule, those with no known rule left out. */
export function byRule(
  runs: ReadonlyArray<{ run: string; rounds: number; best?: readonly number[] }>,
  ruleOfRun: ReadonlyMap<string, LoopRule>,
): RuleRow[] {
  return LOOP_RULES.map(({ rule }) => {
    const mine = runs.filter((r) => ruleOfRun.get(r.run) === rule);
    const ours = mine.map((r) => r.rounds);
    return {
      rule,
      runs: ours.length,
      rounds: ours.reduce((a, x) => a + x, 0),
      median: median(ours),
      most: ours.length > 0 ? Math.max(...ours) : Number.NaN,
      pastThree: ours.filter((x) => x > 3).length,
      roundOneMedian: median(mine.map((r) => r.best?.[0] ?? 0)),
    };
  });
}

export type Warning = {
  runs: number;
  rounds: number;
  /** runs with at least `threshold` serious findings in round 1 */
  flagged: number;
  flaggedRounds: number;
  /** runs of six rounds or more, and how many of them were flagged */
  long: number;
  longFlagged: number;
  roundsMedianFlagged: number;
  roundsMedianNot: number;
};

/** What round 1's serious findings say of the run's length. */
export function roundOneWarning(runs: readonly RiseRun[], threshold: number): Warning {
  const flag = runs.filter((r) => (r.best[0] ?? 0) >= threshold);
  const not = runs.filter((r) => (r.best[0] ?? 0) < threshold);
  const long = runs.filter((r) => r.rounds >= 6);
  return {
    runs: runs.length,
    rounds: sum(runs.map((r) => r.rounds)),
    flagged: flag.length,
    flaggedRounds: sum(flag.map((r) => r.rounds)),
    long: long.length,
    longFlagged: long.filter((r) => (r.best[0] ?? 0) >= threshold).length,
    roundsMedianFlagged: median(flag.map((r) => r.rounds)),
    roundsMedianNot: median(not.map((r) => r.rounds)),
  };
}

export type GroupRuleRow = {
  label: string;
  runs: number;
  rounds: number;
  roundsMedian: number;
  roundsMean: number;
  roundOneMedian: number;
  seriousMedian: number;
  criteriaMedian: number;
  linesMedian: number;
  perCriterionMedian: number;
  perThousandLinesMedian: number;
};

/** The three groups with group A split at the commit that made the decision a script. */
export function groupRows(
  inputs: readonly RunInput[],
  ruleOfRun: ReadonlyMap<string, LoopRule>,
): GroupRuleRow[] {
  const isA = (r: RunInput): boolean => eraOf(r).startsWith("A");
  const sets: Array<[string, RunInput[]]> = [
    ["A, all", inputs.filter(isA)],
    [
      "A, before 29 September",
      inputs.filter((r) => isA(r) && ruleOfRun.get(r.run) === "until-clean"),
    ],
    [
      "A, from 29 September",
      inputs.filter((r) => isA(r) && ruleOfRun.get(r.run) !== "until-clean"),
    ],
    ["B", inputs.filter((r) => eraOf(r).startsWith("B"))],
    ["C", inputs.filter((r) => eraOf(r).startsWith("C"))],
  ];
  const known = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x !== null);
  return sets.map(([label, rs]) => {
    const total = (r: RunInput): number => sum(r.best);
    return {
      label,
      runs: rs.length,
      rounds: sum(rs.map((r) => r.rounds)),
      roundsMedian: median(rs.map((r) => r.rounds)),
      roundsMean: mean(rs.map((r) => r.rounds)),
      roundOneMedian: median(rs.map((r) => r.best[0] ?? 0)),
      seriousMedian: median(rs.map(total)),
      criteriaMedian: median(known(rs.map((r) => r.criteria))),
      linesMedian: median(known(rs.map((r) => r.changeLines))),
      perCriterionMedian: median(known(rs.map((r) => (r.criteria ? total(r) / r.criteria : null)))),
      perThousandLinesMedian: median(
        known(rs.map((r) => (r.changeLines ? (1000 * total(r)) / r.changeLines : null))),
      ),
    };
  });
}
