// The review rounds of a run, counted from its own records (see ../method.md). Everything here is
// pure: it takes the text or the names an edge function read and returns numbers. The line parsers
// are the lane audit's, reused unchanged from ../../2026-10-03-lane-audit/apparatus/parse.ts.
import {
  type Action,
  parseFinding,
  parseReviewRef,
} from "../../2026-10-03-lane-audit/apparatus/parse.ts";

/**
 * The lanes a finding line may name as a source: the audit's six, and the two a run's config named
 * from 9 October.
 */
export const LANES = ["luna", "mimo", "sol", "astra", "opus", "coachman", "haiku", "sonnet"] as const;

export type Finding = {
  ts: string;
  /** the `file:line` the coachman wrote, or the sentence it wrote in its place */
  target: string;
  round: number | null;
  class: "gating" | "style" | null;
  severity: "P1" | "P2" | "P3" | null;
  lanes: string[];
  lenses: string[];
  dismissed: boolean;
  verified: "execution" | "reading" | null;
  /** a gating P1 or P2 the coachman did not dismiss */
  serious: boolean;
  /** what the line says after its sources, where it says anything; empty otherwise */
  text: string;
};

/**
 * What a finding line says about the defect: the text after the first colon, else the hyphenated
 * slug the oldest runs wrote after the way it was verified, else nothing.
 */
export function findingText(detail: string): string {
  const colon = /: +(.+)$/u.exec(detail);
  if (colon) return (colon[1] as string).trim();
  const slug = /verified-by-(?:execution|reading)(?:-and-(?:execution|reading))? +(\S+)$/u.exec(detail);
  return slug ? (slug[1] as string).replace(/-/gu, " ") : "";
}

/**
 * Every `finding` line of a run's action log, read with the audit's parser and two corrections for
 * shapes older than the audit's window. A line that names no class and opens with its severity
 * (`P2 round1 bug+luna: …`, run #108, written before the class word existed) is gating, as every
 * finding was then. A line with no severity whose target holds one (`O1 P1 PEM body survives
 * scrub`, run #135 rounds 4 and 5) takes the target's.
 */
export function findingsOf(actions: readonly Action[]): Finding[] {
  return actions
    .filter((a) => a.action === "finding")
    .map((a) => {
      const f = parseFinding(a.detail, LANES);
      const targetSeverity = /\b(P[123])\b/u.exec(a.target);
      const severity = f.severity ?? (targetSeverity ? (targetSeverity[1] as "P1" | "P2" | "P3") : null);
      const legacyGating = f.class === null && /^P[123]\b/u.test(a.detail);
      const cls = legacyGating ? "gating" : f.class;
      return {
        ts: a.ts,
        target: a.target,
        round: f.round,
        class: cls,
        severity,
        lanes: f.lanes,
        lenses: f.lenses,
        dismissed: f.dismissed,
        verified: f.verified,
        serious: cls === "gating" && (severity === "P1" || severity === "P2") && !f.dismissed,
        text: findingText(a.detail),
      };
    });
}

export type SeriousCounts = {
  byRound: Map<number, number>;
  /** serious findings whose line names no round: in the total and in no round */
  noRound: number;
  total: number;
};

/** The serious findings of a run, in the round each line names. */
export function seriousByRound(findings: readonly Finding[]): SeriousCounts {
  const byRound = new Map<number, number>();
  let noRound = 0;
  let total = 0;
  for (const f of findings) {
    if (!f.serious) continue;
    total += 1;
    if (f.round === null) noRound += 1;
    else byRound.set(f.round, (byRound.get(f.round) ?? 0) + 1);
  }
  return { byRound, noRound, total };
}

/** The highest round any review launch, review harvest or finding line names; 0 where none does. */
export function roundsInActions(actions: readonly Action[]): number {
  let max = 0;
  for (const a of actions) {
    let round: number | null = null;
    if (a.action === "finding") round = parseFinding(a.detail, LANES).round;
    else if (a.action === "review-launch" || a.action === "review-harvest") {
      round = parseReviewRef(a.detail).round;
    }
    if (round !== null && round > max) max = round;
  }
  return max;
}

/**
 * The highest round a file name in the run's folder or its `logs/` names: `review-r<N>-…` and
 * `review-r<N>.json`. A round past the cap ran on the user's ruling and logged no launch line in
 * some runs, so its files are the other record of it.
 */
export function roundsInFileNames(names: readonly string[]): number {
  let max = 0;
  for (const name of names) {
    const m = /^review-r([0-9]+)(?:-|\.)/u.exec(name);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  return max;
}

/**
 * Rounds from 2 to one before the last in which no serious finding is logged. A round after round
 * 2 runs only when the round before it logged a verified P1 or P2 finding, or the user ruled that
 * it should, so a run with such a round holds a finding line that was not written. Round 1 is not
 * listed: a round 2 also runs after a round 1 that applied a fix to a P3.
 */
export function silentRounds(rounds: number, byRound: ReadonlyMap<number, number>): number[] {
  const out: number[] = [];
  for (let r = 2; r < rounds; r += 1) if ((byRound.get(r) ?? 0) === 0) out.push(r);
  return out;
}

const SHIPPING_STAGES = new Set(["shipping", "shipped", "done"]);

/** When the review leg ended: the first stage line that names shipping, shipped or done. */
export function reviewEndedAt(actions: readonly Action[]): string | null {
  const row = actions.find((a) => a.action === "stage" && SHIPPING_STAGES.has(a.target));
  return row ? row.ts : null;
}

/** When the run was dispatched: its first `dispatch` line, else its first line. */
export function dispatchedAt(actions: readonly Action[]): string | null {
  const row = actions.find((a) => a.action === "dispatch") ?? actions[0];
  return row ? row.ts : null;
}
