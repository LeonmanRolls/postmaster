// What a change to how a ticket is prepared would have removed from the recorded rounds (see
// ../method.md, "Rounds a change would have removed"). Pure: it takes the run's rounds, its serious
// findings with their causes and marks, and a choice of findings, and returns rounds.

export type LeverFinding = {
  run: string;
  round: number;
  target: string;
  /** targets of the findings whose fix wrote these lines */
  fixOf: string[];
  /** the target of an earlier finding whose lines this one names again */
  placedBefore: string | null;
};

export type LeverRun = {
  run: string;
  rounds: number;
  /** serious findings in each round, the lines and the run's own figure where lines are missing */
  best: number[];
};

/**
 * The findings that would not have existed if the chosen ones had not: the chosen, and each later
 * finding in lines a fix of a removed finding wrote, or in lines a removed finding named, taken
 * to a fixed point round by round.
 */
export function withDescendants(
  findings: readonly LeverFinding[],
  chosen: ReadonlySet<LeverFinding>,
): Set<LeverFinding> {
  const out = new Set<LeverFinding>(chosen);
  const rounds = [...new Set(findings.map((f) => f.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    const gone = new Map<string, Set<string>>();
    for (const f of out) {
      if (f.round >= r) continue;
      gone.set(f.run, (gone.get(f.run) ?? new Set()).add(f.target));
    }
    for (const f of findings) {
      if (f.round !== r || out.has(f)) continue;
      const targets = gone.get(f.run);
      if (!targets) continue;
      if (
        f.fixOf.some((t) => targets.has(t)) ||
        (f.placedBefore !== null && targets.has(f.placedBefore))
      ) {
        out.add(f);
      }
    }
  }
  return out;
}

/**
 * The rounds a run would have taken without the removed findings, counted per round: the run ends
 * one round after its last round that still holds a serious finding, and takes the rounds it took
 * where its last round's findings all remain.
 */
export function roundsWithout(run: LeverRun, removedByRound: readonly number[]): number {
  const left = run.best.map((n, i) => Math.max(0, n - (removedByRound[i] ?? 0)));
  let last = 0;
  let originalLast = 0;
  left.forEach((n, i) => {
    if (n > 0) last = i + 1;
  });
  run.best.forEach((n, i) => {
    if (n > 0) originalLast = i + 1;
  });
  if (last === originalLast) return run.rounds;
  return Math.min(run.rounds, last + 1);
}

export type LeverEffect = {
  findings: number;
  runs: number;
  roundsRemoved: number;
  perRun: Array<{ run: string; before: number; after: number }>;
};

/** The effect of removing the chosen findings, with those they led to, on the runs' rounds. */
export function leverEffect(
  runs: readonly LeverRun[],
  findings: readonly LeverFinding[],
  chosen: ReadonlySet<LeverFinding>,
  cascade = true,
): LeverEffect {
  const gone = cascade ? withDescendants(findings, chosen) : new Set(chosen);
  const perRun: LeverEffect["perRun"] = [];
  let roundsRemoved = 0;
  let touched = 0;
  for (const run of runs) {
    const removed = Array.from({ length: run.rounds }, () => 0);
    for (const f of gone)
      if (f.run === run.run && f.round >= 1 && f.round <= run.rounds) removed[f.round - 1] += 1;
    if (removed.every((n) => n === 0)) continue;
    touched += 1;
    const after = roundsWithout(run, removed);
    roundsRemoved += run.rounds - after;
    perRun.push({ run: run.run, before: run.rounds, after });
  }
  return { findings: gone.size, runs: touched, roundsRemoved, perRun };
}
