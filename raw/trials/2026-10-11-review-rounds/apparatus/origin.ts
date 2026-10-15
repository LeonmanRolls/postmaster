// How a later finding relates to the history of the lines it names (see ../rule.md). Everything
// here is pure: the edge in `trace.ts` reads git and calls these with what it read.

export type Place = { file: string; first: number; last: number };

/**
 * The file and lines a finding's target names: `scripts/a.ts:663`, `scripts/a.ts:51-56`,
 * `scripts/a.ts:L5-L99`. A target that is a sentence, or names no line, is null.
 */
export function parseTarget(target: string): Place | null {
  const m = /^([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+):L?([0-9]+)(?:[-–,]L?([0-9]+))?(?:\b.*)?$/u.exec(
    target.trim(),
  );
  if (!m) return null;
  const first = Number(m[2]);
  const last = m[3] ? Number(m[3]) : first;
  if (first < 1 || last < first || last - first > 400) return null;
  return { file: m[1] as string, first, last };
}

export type OwnCommit = {
  sha: string;
  /** committer time, seconds since the epoch */
  time: number;
  parents: number;
  /** a pick of work already on main: not the run's own */
  onMain: boolean;
};

export type Launches = Map<number, number>;

/** A commit's phase relative to the run's review rounds. */
export type Phase = { kind: "change" } | { kind: "fix"; round: number } | { kind: "later" };

/**
 * Where an own commit falls: the change (made at or before round 1 was launched), a fix of round k
 * (after round k was launched and at or before round k+1 was), or later (after the last launch).
 * `launches` maps a round to the time its first reviewer was launched.
 */
export function phaseOf(time: number, launches: Launches): Phase {
  const rounds = [...launches.keys()].sort((a, b) => a - b);
  const first = rounds[0];
  if (first === undefined || time <= (launches.get(first) as number)) return { kind: "change" };
  for (let i = 0; i < rounds.length; i += 1) {
    const next = rounds[i + 1];
    if (next === undefined) return { kind: "later" };
    if (time <= (launches.get(next) as number)) return { kind: "fix", round: rounds[i] as number };
  }
  return { kind: "later" };
}

/**
 * The snapshot a round reviewed: the last own commit made at or before its launch, in the order
 * the commits are given (oldest first). Null where none is, and the run's base is the snapshot.
 */
export function snapshotOf(own: readonly OwnCommit[], launch: number): string | null {
  let found: string | null = null;
  for (const c of own) {
    if (c.onMain) continue;
    if (c.time <= launch) found = c.sha;
  }
  return found;
}

export type BlameLine = {
  sha: string;
  origLine: number;
  finalLine: number;
  file: string;
  /** the line as it stands at the snapshot */
  content: string;
};

/** The lines of `git blame --porcelain` output, one entry per line blamed. */
export function parseBlame(porcelain: string): BlameLine[] {
  const out: BlameLine[] = [];
  const files = new Map<string, string>();
  let current: { sha: string; origLine: number; finalLine: number } | null = null;
  for (const line of porcelain.split("\n")) {
    const head = /^([0-9a-f]{40}) ([0-9]+) ([0-9]+)(?: [0-9]+)?$/u.exec(line);
    if (head) {
      current = { sha: head[1] as string, origLine: Number(head[2]), finalLine: Number(head[3]) };
      continue;
    }
    const name = /^filename (.+)$/u.exec(line);
    if (name && current) {
      files.set(current.sha, name[1] as string);
      continue;
    }
    if (line.startsWith("\t") && current) {
      out.push({ ...current, file: files.get(current.sha) ?? "", content: line.slice(1) });
      current = null;
    }
  }
  return out;
}

/** A line's identity across later snapshots: the commit that wrote it, its file and line there. */
export const identity = (b: BlameLine): string => `${b.sha}:${b.file}:${b.origLine}`;

export type Origin =
  | { kind: "fix"; round: number; sha: string }
  | { kind: "change"; sha: string }
  | { kind: "base"; sha: string }
  | { kind: "unplaced"; why: string };

export type Group =
  | "held-open"
  | "made-by-last-fix"
  | "made-by-older-fix"
  | "missed-lens-reviewed"
  | "missed-not-asked"
  | "outside"
  | "unplaced";

export type OriginFacts = {
  round: number;
  origin: Origin;
  /** the lines were named by an earlier serious finding of the run */
  placedBefore: boolean;
  /** a reviewer of the finding's lens ran in a round before this one */
  lensReviewedBefore: boolean;
};

/** The first group of `rule.md` that applies. */
export function groupOf(f: OriginFacts): Group {
  if (f.origin.kind === "unplaced") return "unplaced";
  if (f.origin.kind === "fix") {
    return f.origin.round === f.round - 1 ? "made-by-last-fix" : "made-by-older-fix";
  }
  if (f.placedBefore) return "held-open";
  if (f.origin.kind === "base") return "outside";
  return f.lensReviewedBefore ? "missed-lens-reviewed" : "missed-not-asked";
}

/**
 * The origin class over a finding's lines: a line a fix of an earlier round wrote beats the
 * change's, which beats the base's. `classify` says what a commit is to this run.
 */
export function originOf(
  lines: readonly BlameLine[],
  round: number,
  classify: (sha: string) => Phase | "base",
): Origin {
  if (lines.length === 0) return { kind: "unplaced", why: "no line blamed" };
  let change: string | null = null;
  let base: string | null = null;
  let fix: { round: number; sha: string } | null = null;
  for (const l of lines) {
    const c = classify(l.sha);
    if (c === "base") base = base ?? l.sha;
    else if (c.kind === "fix" && c.round < round) {
      if (fix === null || c.round > fix.round) fix = { round: c.round, sha: l.sha };
    } else if (c.kind === "change") change = change ?? l.sha;
    else base = base ?? l.sha;
  }
  if (fix) return { kind: "fix", ...fix };
  if (change) return { kind: "change", sha: change };
  return { kind: "base", sha: base as string };
}
