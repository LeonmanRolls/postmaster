// Rounds in which a run's finding lines name no serious finding and the run's own card or
// escalation lines state one (see ../method.md, "Where the finding lines are a floor"). Each entry
// was read by hand from the run's record once, and the figure is the run's own. The rule is the
// same for all: a round with no serious finding line takes the figure the run's record states;
// a round whose record says it was clean or void stays 0.
export type Supplement = {
  /** the round and the number of serious findings the run's own record states for it */
  rounds: Record<number, number>;
  source: string;
};

export const SUPPLEMENT: Record<string, Supplement> = {
  "38": {
    rounds: { 5: 8 },
    source: "the review checkpoint: round 5 held 3 P1 and 5 P2; no finding line names round 5",
  },
  "109": {
    rounds: { 7: 3, 11: 4 },
    source:
      "the review checkpoint, as read for the criteria-design count: rounds 7 and 11 have no finding lines",
  },
  "124": {
    rounds: { 5: 6, 6: 9, 7: 8, 8: 4, 9: 4, 10: 5, 11: 5, 12: 2, 13: 5, 14: 4, 15: 3, 16: 3, 17: 4, 18: 5 },
    source:
      "the review checkpoint's table of verified findings per round; the finding lines name no round from 5 to 18",
  },
  "202": {
    rounds: { 8: 1, 9: 2 },
    source: "the escalation lines of rounds 8 and 9; the run logged no finding lines after round 7",
  },
  "268": {
    rounds: { 5: 7, 6: 1, 7: 1 },
    source:
      "the review card's loop outcome: round 5 verified 4 P1 and 3 P2, round 6 one serious finding, round 7 one",
  },
};

/** The run's serious findings by round with the supplement filling the rounds that have no line. */
export function withSupplement(
  runId: string,
  byRound: readonly number[],
): { best: number[]; filled: number[] } {
  const best = [...byRound];
  const filled: number[] = [];
  const entry = SUPPLEMENT[runId];
  if (!entry) return { best, filled };
  for (const [round, count] of Object.entries(entry.rounds)) {
    const at = Number(round) - 1;
    if (at >= 0 && at < best.length && best[at] === 0) {
      best[at] = count;
      filled.push(Number(round));
    }
  }
  return { best, filled: filled.sort((a, b) => a - b) };
}
