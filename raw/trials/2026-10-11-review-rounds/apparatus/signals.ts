// What a review loop could see at the end of a round, and whether it predicts that the next round
// finds nothing (see ../method.md, "Stop signals"). Pure: it takes a run's per-round counts, its
// traced findings and its commits, and returns facts, transitions and simulated stops.
import { sum } from "./stats.ts";

export type FindingFact = {
  round: number;
  severity: "P1" | "P2";
  lanes: string[];
  file: string | null;
  group: string | null;
};

export type CommitFact = {
  phase: string;
  added: number;
  deleted: number;
  paths: string[];
  onMain: boolean;
};

export type RunFacts = {
  run: string;
  rounds: number;
  /** the two reviewer lanes of the bug and style lenses, where the run had two */
  pair: [string, string] | null;
  /** serious findings in each round, the lines and the run's own figure where lines are missing */
  best: number[];
  findings: FindingFact[];
  commits: CommitFact[];
};

export type PathKind = "test" | "doc" | "code";

export function pathKind(path: string): PathKind {
  if (
    /\.test\.[A-Za-z]+$/u.test(path) ||
    path.endsWith("-test.sh") ||
    /(^|\/)tests?\//u.test(path)
  ) {
    return "test";
  }
  if (/\.(md|txt)$/u.test(path) || /^(wiki|docs|raw)\//u.test(path)) return "doc";
  return "code";
}

export type RoundFact = {
  round: number;
  /** serious findings in the round, from the best column */
  n: number;
  /** the serious findings traced to a place */
  traced: number;
  /** every serious finding of the round was traced */
  complete: boolean;
  p1: number;
  lanes: string[];
  /** findings named by two or more lanes */
  corroborated: number;
  /** findings in lines an earlier round's fix wrote */
  madeByFix: number;
  /** findings in the change, not named before */
  missed: number;
  /** findings in a file that had a serious finding in an earlier round */
  sameFile: number;
  /** lines the round's own fix commits changed, in all files, and in code only */
  fixLines: number;
  fixCodeLines: number;
  fixCommits: number;
  /** findings named by the first lane of the pair, by the second, and by both */
  first: number;
  second: number;
  both: number;
};

/**
 * What two independent lanes leave unseen, by the Chapman form of the capture-recapture estimate:
 * the estimated number of findings present less the number either lane named. Null where the
 * run had no pair of lanes.
 */
export function unseenEstimate(f: Pick<RoundFact, "first" | "second" | "both">): number {
  const present = ((f.first + 1) * (f.second + 1)) / (f.both + 1) - 1;
  return present - (f.first + f.second - f.both);
}

/** The facts of each round of a run, known when the round has ended and its fixes are in. */
export function roundFacts(run: RunFacts): RoundFact[] {
  const out: RoundFact[] = [];
  const filesBefore = new Set<string>();
  for (let r = 1; r <= run.rounds; r += 1) {
    const here = run.findings.filter((f) => f.round === r);
    const fix = run.commits.filter((c) => c.phase === `fix:${r}` && !c.onMain);
    const lines = (cs: CommitFact[], onlyCode: boolean): number =>
      sum(
        cs.map((c) => {
          if (!onlyCode) return c.added + c.deleted;
          return c.paths.some((p) => pathKind(p) === "code") ? c.added + c.deleted : 0;
        }),
      );
    out.push({
      round: r,
      n: run.best[r - 1] ?? 0,
      traced: here.length,
      complete: here.length === (run.best[r - 1] ?? 0),
      p1: here.filter((f) => f.severity === "P1").length,
      lanes: [...new Set(here.flatMap((f) => f.lanes))].sort(),
      corroborated: here.filter((f) => f.lanes.length >= 2).length,
      madeByFix: here.filter(
        (f) => f.group === "made-by-last-fix" || f.group === "made-by-older-fix",
      ).length,
      missed: here.filter((f) => f.group?.startsWith("missed")).length,
      sameFile: here.filter((f) => f.file !== null && filesBefore.has(f.file)).length,
      fixLines: lines(fix, false),
      fixCodeLines: lines(fix, true),
      fixCommits: fix.length,
      first: run.pair
        ? here.filter((f) => f.lanes.includes((run.pair as [string, string])[0])).length
        : 0,
      second: run.pair
        ? here.filter((f) => f.lanes.includes((run.pair as [string, string])[1])).length
        : 0,
      both: run.pair
        ? here.filter(
            (f) =>
              f.lanes.includes((run.pair as [string, string])[0]) &&
              f.lanes.includes((run.pair as [string, string])[1]),
          ).length
        : 0,
    });
    for (const f of here) if (f.file !== null) filesBefore.add(f.file);
  }
  return out;
}

export type Transition = {
  run: string;
  /** the round that has ended */
  round: number;
  /** serious findings in the next round, which ran */
  next: number;
  clean: boolean;
  facts: RoundFact;
  prev: RoundFact | null;
};

/** Every point at which a loop went on: round r ended and round r+1 ran. */
export function transitions(runs: readonly RunFacts[]): Transition[] {
  const out: Transition[] = [];
  for (const run of runs) {
    const facts = roundFacts(run);
    for (let r = 1; r < run.rounds; r += 1) {
      const next = run.best[r] ?? 0;
      out.push({
        run: run.run,
        round: r,
        next,
        clean: next === 0,
        facts: facts[r - 1] as RoundFact,
        prev: r >= 2 ? (facts[r - 2] as RoundFact) : null,
      });
    }
  }
  return out;
}

export type Signal = {
  id: string;
  says: string;
  /** whether the signal is true at the end of the round, from what is known then */
  holds: (t: Transition) => boolean;
  /** the signal needs per-finding places, which a round filled from a card does not have */
  needsTrace: boolean;
};

/** The signals tried, fixed before the runs that finished after the first set were read. */
export const SIGNALS: Signal[] = [
  {
    id: "one",
    says: "the round has one serious finding",
    holds: (t) => t.facts.n === 1,
    needsTrace: false,
  },
  {
    id: "fewer",
    says: "fewer serious findings than the round before",
    holds: (t) => t.prev !== null && t.facts.n < t.prev.n,
    needsTrace: false,
  },
  {
    id: "rise",
    says: "as many or more serious findings than the round before",
    holds: (t) => t.prev !== null && t.facts.n >= t.prev.n,
    needsTrace: false,
  },
  {
    id: "tiny-fix",
    says: "the round's fixes changed 30 lines or fewer",
    holds: (t) => t.facts.fixLines <= 30,
    needsTrace: false,
  },
  {
    id: "no-code-fix",
    says: "the round's fixes changed no code, only words and tests",
    holds: (t) => t.facts.fixCommits > 0 && t.facts.fixCodeLines === 0,
    needsTrace: false,
  },
  {
    id: "no-p1",
    says: "no serious finding of the round is a P1",
    holds: (t) => t.facts.p1 === 0,
    needsTrace: true,
  },
  {
    id: "single-lane",
    says: "one lane alone named the round's findings, none was corroborated",
    holds: (t) => t.facts.lanes.length === 1 && t.facts.corroborated === 0,
    needsTrace: true,
  },
  {
    id: "from-fixes",
    says: "at least half the round's findings are in lines an earlier fix wrote",
    holds: (t) => t.facts.traced > 0 && t.facts.madeByFix * 2 >= t.facts.traced,
    needsTrace: true,
  },
  {
    id: "same-file",
    says: "a finding of the round is in a file an earlier round's serious finding was in",
    holds: (t) => t.facts.sameFile > 0,
    needsTrace: true,
  },
  {
    id: "overlap-leaves-little",
    says: "the two lanes' overlap estimates fewer than one more serious finding present",
    holds: (t) => t.facts.first + t.facts.second > 0 && unseenEstimate(t.facts) < 1,
    needsTrace: true,
  },
  {
    id: "all-missed",
    says: "every finding of the round was in the change and not named before",
    holds: (t) => t.facts.traced > 0 && t.facts.missed === t.facts.traced,
    needsTrace: true,
  },
  // Added after the first look at the 61 runs' counts, and so tried on the later set alone:
  {
    id: "five-plus",
    says: "five or more serious findings in the round (added after the first look)",
    holds: (t) => t.facts.n >= 5,
    needsTrace: false,
  },
];

export type SignalRow = {
  id: string;
  says: string;
  /** transitions where the signal holds */
  flagged: number;
  /** of those, where the next round found nothing */
  flaggedClean: number;
  /** transitions where it does not hold, and the next round found nothing */
  otherClean: number;
  other: number;
};

/** For each signal, how often the next round found nothing where it holds and where it does not. */
export function signalRows(ts: readonly Transition[]): SignalRow[] {
  return SIGNALS.map((s) => {
    const usable = ts.filter((t) => !s.needsTrace || t.facts.complete);
    const yes = usable.filter((t) => s.holds(t));
    const no = usable.filter((t) => !s.holds(t));
    return {
      id: s.id,
      says: s.says,
      flagged: yes.length,
      flaggedClean: yes.filter((t) => t.clean).length,
      otherClean: no.filter((t) => t.clean).length,
      other: no.length,
    };
  });
}

export type StopRule = {
  id: string;
  says: string;
  /** applied at the end of round r with the facts of rounds 1..r; true means stop here */
  stops: (facts: readonly RoundFact[], r: number) => boolean;
};

/** The stopping rules tried, fixed before the later set was read. */
export const RULES: StopRule[] = [
  {
    id: "one-and-tiny",
    says: "stop when the round has at most one serious finding and its fixes changed 30 lines or fewer",
    stops: (f, r) => (f[r - 1]?.n ?? 9) <= 1 && (f[r - 1]?.fixLines ?? 999) <= 30,
  },
  {
    id: "one-or-fewer-and-falling",
    says: "stop when the round has at most one serious finding and fewer than the round before",
    stops: (f, r) => r >= 2 && (f[r - 1]?.n ?? 9) <= 1 && (f[r - 1]?.n ?? 9) < (f[r - 2]?.n ?? 0),
  },
  {
    id: "words-only",
    says: "stop when the round's fixes changed no code, only words and tests",
    stops: (f, r) => (f[r - 1]?.fixCommits ?? 0) > 0 && (f[r - 1]?.fixCodeLines ?? 1) === 0,
  },
  {
    id: "second-round-small",
    says: "stop after round 2 when it had at most two serious findings",
    stops: (f, r) => r === 2 && (f[1]?.n ?? 9) <= 2,
  },
];

export type Simulation = {
  rule: string;
  runs: number;
  /** runs in which the rule fires before the run's own last round */
  fires: number;
  roundsSaved: number;
  /** serious findings in the rounds the rule would have skipped */
  seriousSkipped: number;
  /** runs where the rounds it would have skipped held no serious finding */
  cleanSkips: number;
  /** rounds that hold no serious finding and come after the last that does: the most any rule could save */
  confirmingRounds: number;
};

/** Apply a stopping rule to each run's facts and count what it would have saved and skipped. */
export function simulate(rule: StopRule, runs: readonly RunFacts[]): Simulation {
  let fires = 0;
  let roundsSaved = 0;
  let seriousSkipped = 0;
  let cleanSkips = 0;
  let confirming = 0;
  for (const run of runs) {
    const facts = roundFacts(run);
    let last = 0;
    run.best.forEach((n, i) => {
      if (n > 0) last = i + 1;
    });
    confirming += run.rounds - last;
    for (let r = 1; r < run.rounds; r += 1) {
      if (!rule.stops(facts, r)) continue;
      fires += 1;
      roundsSaved += run.rounds - r;
      const skipped = sum(run.best.slice(r));
      seriousSkipped += skipped;
      if (skipped === 0) cleanSkips += 1;
      break;
    }
  }
  return {
    rule: rule.id,
    runs: runs.length,
    fires,
    roundsSaved,
    seriousSkipped,
    cleanSkips,
    confirmingRounds: confirming,
  };
}

export type FixYieldRow = {
  /** the round whose fix commits these are; the last row pools round 5 and after */
  round: string;
  commits: number;
  /** commits with a serious finding in their lines in the next round */
  nextRound: number;
  /** commits with one in any later round */
  anyLater: number;
  /** serious findings in the next round of the runs that went on, for these rounds */
  nextRoundFindings: number;
};

/**
 * How often a round's fix commits get a serious finding in lines they wrote, in the next round or
 * later. A commit that changed no line is not counted. `origin` names a finding's origin commit
 * by its first 8 characters, for findings whose lines a fix wrote.
 */
export function fixYield(
  commits: ReadonlyArray<{
    run: string;
    sha: string;
    phase: string;
    added: number;
    deleted: number;
    onMain: boolean;
  }>,
  findings: ReadonlyArray<{
    run: string;
    round: number;
    originKind: string;
    originSha: string | null;
  }>,
  runs: ReadonlyArray<{ run: string; rounds: number; best: readonly number[] }> = [],
): FixYieldRow[] {
  const hits = new Map<string, Set<number>>();
  for (const f of findings) {
    if (f.originKind !== "fix" || f.originSha === null) continue;
    const key = `${f.run}|${f.originSha}`;
    hits.set(key, (hits.get(key) ?? new Set()).add(f.round));
  }
  const rows = new Map<string, FixYieldRow>();
  for (const c of commits) {
    if (c.onMain || !c.phase.startsWith("fix:") || c.added + c.deleted === 0) continue;
    const k = Number(c.phase.slice(4));
    const label = k >= 5 ? "5 and after" : String(k);
    const row = rows.get(label) ?? {
      round: label,
      commits: 0,
      nextRound: 0,
      anyLater: 0,
      nextRoundFindings: 0,
    };
    const rounds = hits.get(`${c.run}|${c.sha}`) ?? new Set<number>();
    row.commits += 1;
    if (rounds.has(k + 1)) row.nextRound += 1;
    if ([...rounds].some((r) => r > k)) row.anyLater += 1;
    rows.set(label, row);
  }
  for (const r of runs) {
    for (let k = 1; k < r.rounds; k += 1) {
      const row = rows.get(k >= 5 ? "5 and after" : String(k));
      if (row) row.nextRoundFindings += r.best[k] ?? 0;
    }
  }
  return ["1", "2", "3", "4", "5 and after"].flatMap((l) =>
    rows.has(l) ? [rows.get(l) as FixYieldRow] : [],
  );
}

export type OverlapCheck = {
  /** runs with a pair of reviewer lanes that named a serious finding in round 1 */
  runs: number;
  /** of those, runs where the two lanes named no finding in common */
  noOverlap: number;
  /** findings either lane named in round 1 */
  found: number;
  /** what the Chapman estimate says the pair left unseen after round 1, summed over runs */
  estimatedUnseen: number;
  /** of that sum, the part from runs where the two lanes named nothing in common */
  estimatedUnseenNoOverlap: number;
  /** findings in the change that no round named before and a later round did */
  laterMissed: number;
};

/**
 * What the two reviewer lanes' overlap in round 1 says was left, against what later rounds found
 * in the change that round 1 had not named. The estimate is the Chapman form of the
 * capture-recapture estimate, per run.
 */
export function overlapCheck(
  runs: ReadonlyArray<{
    pair: [string, string] | null;
    findings: ReadonlyArray<{ round: number; lanes: string[]; group: string | null }>;
  }>,
): OverlapCheck {
  let n = 0;
  let noOverlap = 0;
  let found = 0;
  let unseen = 0;
  let unseenNone = 0;
  let later = 0;
  for (const r of runs) {
    if (!r.pair) continue;
    const [a, b] = r.pair;
    const first = r.findings.filter((f) => f.round === 1);
    const na = first.filter((f) => f.lanes.includes(a)).length;
    const nb = first.filter((f) => f.lanes.includes(b)).length;
    if (na + nb === 0) continue;
    const m = first.filter((f) => f.lanes.includes(a) && f.lanes.includes(b)).length;
    n += 1;
    if (m === 0) noOverlap += 1;
    found += na + nb - m;
    const u = unseenEstimate({ first: na, second: nb, both: m });
    unseen += u;
    if (m === 0) unseenNone += u;
    later += r.findings.filter((f) => f.round >= 2 && (f.group ?? "").startsWith("missed")).length;
  }
  return {
    runs: n,
    noOverlap,
    found,
    estimatedUnseen: unseen,
    estimatedUnseenNoOverlap: unseenNone,
    laterMissed: later,
  };
}

/**
 * Minutes from one round's first launch to the next round's, for each pair of consecutive rounds:
 * the reviewers, the coachman's judging and fixing, the gate and any wait for the user.
 */
export function roundGaps(launches: Readonly<Record<string, string>>): number[] {
  const rounds = Object.keys(launches)
    .map(Number)
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i + 1 < rounds.length; i += 1) {
    const here = rounds[i] as number;
    const next = rounds[i + 1] as number;
    if (next !== here + 1) continue;
    const a = Date.parse(launches[String(here)] as string);
    const b = Date.parse(launches[String(next)] as string);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) out.push((b - a) / 60000);
  }
  return out;
}
