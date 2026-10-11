// The last step before the ship card: take the default branch into the ticket
// branch, so a card checked soon after it is raised is found up to date. The
// runbook fetches the default remote as Stage F does, then calls this step,
// runs the gate where the verdict says to, and calls again until the card may
// be raised. One call takes one deterministic step: it merges at most once,
// logs each merge it starts, and prints the card's report only with a verdict
// that raises the card. Conflict resolution and judging a red gate stay the
// coachman's: this step reports them and leaves them.
//
//   run merge-default --repo <repo> --default <ref> --ticket <branch>
//       --dispatch <dispatch> --wt <wt>
//
// The flags are landing fresh's, and the question is fresh's: the branch holds
// the current default branch, the worktree is at the ticket's head, and the
// gate passed at that head. The count of merges is read from the run's action
// log, never remembered: coachman merge lines since the last postmaster resume,
// so the count starts again when the postmaster sends a card back. Two merges
// per attempt at most; then the card goes out whatever main has done since.
//
//   exit 0  CARD or CARD-ANYWAY with the card's ## Merge section, pasted as its
//           own section and never retyped: the card may be raised
//   exit 1  usage; a ref that does not resolve; the worktree unreadable; a
//           merge in progress; uncommitted tracked changes; landing fresh
//           failing; an action log the merges cannot be counted from; a merge
//           the log would not take
//   exit 2  MERGED, CONFLICT, GATE-NEEDED, GATE-FAILED or HEAD: act as the
//           verdict says, then call this step again
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { PY_DOT, PY_S_CLASS } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const RUN = join(HERE, "run");
const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};
/** Merges per attempt: the first plus one more, then the card whatever main did. */
const BUDGET = 2;
const USAGE =
  "usage: run merge-default --repo <repo> --default <ref> --ticket <branch> " +
  "--dispatch <dispatch> --wt <wt>";

class MergeDefaultFailure extends Error {
  constructor(
    readonly text: string,
    readonly code: number,
  ) {
    super(text);
  }
}

function die(msg: string): never {
  throw new MergeDefaultFailure(`merge-default: ${msg}`, 1);
}

function usage(): never {
  throw new MergeDefaultFailure(USAGE, 1);
}

export interface PorcelainState {
  unmerged: boolean;
  dirtyTracked: boolean;
}

/** The worktree's tracked state from status --porcelain --no-renames -z, one
 * NUL entry each. Untracked entries never count: they cannot corrupt a merge
 * commit, and the gate refuses them before any result is recorded. */
export function parsePorcelainZ(out: string): PorcelainState {
  let unmerged = false;
  let dirtyTracked = false;
  for (const entry of out.split("\0")) {
    if (entry === "") continue;
    const xy = entry.slice(0, 2);
    if (xy === "??") continue;
    if (xy[0] === "U" || xy[1] === "U" || xy === "AA" || xy === "DD") unmerged = true;
    else dirtyTracked = true;
  }
  return { unmerged, dirtyTracked };
}

export interface MergeDetail {
  main: string;
  branch: string;
  conflict: string[];
}

/** A merge line this step logged: main=<sha> into <branch>[ conflict=<files>].
 * Hand-logged prose matches nothing and counts without parsing. The branch is
 * non-space like verify's on= claim; the files split on the space they join. */
const MERGE_DETAIL_RE = new RegExp(
  `^main=([0-9a-f]{40}) into ([^${PY_S_CLASS}]+)(?: conflict=(${PY_DOT}*))?$`,
  "u",
);

export function parseMergeDetail(detail: string): MergeDetail | null {
  const m = MERGE_DETAIL_RE.exec(detail);
  if (!m) return null;
  return {
    main: m[1] ?? "",
    branch: m[2] ?? "",
    conflict: (m[3] ?? "").split(" ").filter((p) => p !== ""),
  };
}

export interface StepAction {
  actor: string;
  action: string;
  detail: string;
}

export interface AttemptMerges {
  count: number;
  lastMain: string | null;
  hand: string[];
}

/** The merges this attempt made: every coachman merge line since the last
 * postmaster resume, which is what restarts the count. Prose lines count
 * without parsing; only main= lines say which main and which hand files. */
export function countAttemptMerges(actions: StepAction[]): AttemptMerges {
  let resumeIdx = -1;
  actions.forEach((a, i) => {
    if (a.action === "resume" && a.actor === "postmaster") resumeIdx = i;
  });
  const merges = actions.filter(
    (a, i) => i > resumeIdx && a.actor === "coachman" && a.action === "merge",
  );
  let lastMain: string | null = null;
  const hand = new Set<string>();
  for (const m of merges) {
    const d = parseMergeDetail(m.detail);
    if (!d) continue;
    lastMain = d.main;
    for (const f of d.conflict) hand.add(f);
  }
  return { count: merges.length, lastMain, hand: [...hand].sort() };
}

function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

export interface ReportInput {
  ref: string;
  holds: string;
  /** The current default tip when the branch does not hold it, else null. */
  tip: string | null;
  count: number;
  hand: string[];
}

/** The card's ## Merge section: which main the branch holds and each file the
 * merge needed the coachman's hand in. Printed only with CARD and CARD-ANYWAY. */
export function buildReport(o: ReportInput): string {
  const holdsLine =
    o.tip === null
      ? o.count === 0
        ? `Holds main ${o.holds} (${o.ref}); no merge was needed`
        : `Holds main ${o.holds} (${o.ref}), merged ${times(o.count)} in this step`
      : `Holds main ${o.holds} (${o.ref} then); current ${o.ref} is ${o.tip}, ` +
        "not held, and the card was raised anyway";
  const handLine = o.hand.length > 0 ? o.hand.join(" ") : "none";
  return `## Merge\n${holdsLine}\nResolved by hand: ${handLine}\n`;
}

function gitOut(where: string, args: string[]): { code: number; out: string } {
  const r = run("git", ["-C", where, ...args], { env: UNSET_GIT });
  return { code: r.code, out: r.out.trim() };
}

function commitOf(repo: string, ref: string, what: string): string {
  const r = gitOut(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (r.code !== 0 || r.out === "") die(`${what} does not resolve to a commit: ${ref}`);
  return r.out;
}

function firstLine(s: string): string {
  return (s.split("\n")[0] ?? "").trim();
}

/** The run's merge and resume lines in log order. A missing log is an empty
 * one: the step can run before anything was logged. A line that does not parse
 * fails closed only when it could hide a merge or a resume. */
function readStepActions(dispatch: string): StepAction[] {
  const f = join(dispatch, "actions.jsonl");
  let lines: string[];
  try {
    lines = readFileSync(f, "utf8").split("\n");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    die(`cannot read ${f}`);
  }
  const out: StepAction[] = [];
  lines.forEach((line, n) => {
    if (line === "") return;
    let e: unknown = null;
    try {
      e = JSON.parse(line) as unknown;
    } catch {
      e = null;
    }
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      if (line.includes('"merge"') || line.includes('"resume"')) {
        die(`line ${n + 1} of ${f} does not parse, so the merges made cannot be counted`);
      }
      return;
    }
    const r = e as Record<string, unknown>;
    out.push({
      actor: String(r.actor ?? ""),
      action: String(r.action ?? ""),
      detail: String(r.detail ?? ""),
    });
  });
  return out;
}

function mergeBase(repo: string, head: string, tip: string): string | null {
  const r = gitOut(repo, ["merge-base", head, tip]);
  return r.code === 0 && r.out !== "" ? r.out : null;
}

function unmergedPaths(wt: string): string[] {
  const r = run("git", ["-C", wt, "diff", "--name-only", "-z", "--diff-filter=U"], {
    env: UNSET_GIT,
  });
  if (r.code !== 0) die("cannot list the conflicted files");
  return r.out
    .split("\0")
    .filter((p) => p !== "")
    .sort();
}

function logMerge(dispatch: string, ticket: string, detail: string): boolean {
  const r = run(RUN, ["log-action", dispatch, "coachman", "merge", ticket, detail], {
    env: UNSET_GIT,
  });
  return r.code === 0;
}

function cardOut(verdict: string, report: string): void {
  console.log(verdict);
  console.log("");
  process.stdout.write(report);
}

function main(argv: string[]): number {
  const o = argv;
  if (
    o.length !== 10 ||
    o[0] !== "--repo" ||
    o[2] !== "--default" ||
    o[4] !== "--ticket" ||
    o[6] !== "--dispatch" ||
    o[8] !== "--wt"
  ) {
    usage();
  }
  const repo = o[1] ?? "";
  const def = o[3] ?? "";
  const ticket = o[5] ?? "";
  const dispatch = o[7] ?? "";
  const wt = o[9] ?? "";
  const head = commitOf(repo, ticket, "--ticket");
  const tip = commitOf(repo, def, "--default");
  const h = gitOut(wt, ["rev-parse", "HEAD"]);
  if (h.code !== 0 || h.out === "") die(`cannot read the worktree HEAD: ${wt}`);
  const here = h.out;
  const here12 = here.slice(0, 12);
  const tip12 = tip.slice(0, 12);
  const mh = gitOut(wt, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
  if (mh.code === 0 && mh.out !== "") {
    die(`${wt} has a merge in progress: resolve it, commit the merge, then call this step again`);
  }
  const st = run("git", ["-C", wt, "status", "--porcelain", "--no-renames", "-z"], {
    env: UNSET_GIT,
  });
  if (st.code !== 0) die(`cannot read the worktree status: ${wt}`);
  const state = parsePorcelainZ(st.out);
  if (state.unmerged) {
    die(`${wt} has a merge in progress: resolve it, commit the merge, then call this step again`);
  }
  if (state.dirtyTracked) {
    die(`${wt} has uncommitted tracked changes: commit or remove them, then call this step again`);
  }
  const fresh = run(RUN, ["landing", "fresh", ...o], { env: UNSET_GIT });
  if (fresh.code === 1) {
    die(`landing fresh failed: ${firstLine(fresh.err) || firstLine(fresh.out) || "no output"}`);
  }
  if (fresh.code !== 0 && fresh.code !== 2) {
    die(`landing fresh exited ${fresh.code}: ${firstLine(fresh.err) || "no output"}`);
  }
  const lines = fresh.out.split("\n").filter((l) => l !== "");
  const headLine = lines.find((l) => l.startsWith("head:")) ?? null;
  const stale = lines.some((l) => l.startsWith("stale:"));
  const gateLine = lines.find((l) => l.startsWith("gate:")) ?? null;
  if (fresh.code === 0 && (headLine !== null || stale || gateLine !== null)) {
    die(`landing fresh answered fresh with fault lines: ${lines.join("; ")}`);
  }
  const merges = countAttemptMerges(readStepActions(dispatch));
  if (headLine !== null) {
    const hm = /^head: the worktree is at ([0-9a-f]+), the ticket at ([0-9a-f]+)$/u.exec(headLine);
    const where = hm ? `the worktree is at ${hm[1]}, the ticket at ${hm[2]}` : headLine;
    console.log(`HEAD: ${where}; move the worktree to the ticket head, then call this step again`);
    return 2;
  }
  if (stale) {
    if (merges.count >= BUDGET) {
      const holds =
        merges.lastMain ??
        mergeBase(repo, head, tip) ??
        die(
          `the branch is stale after ${
            merges.count
          } merges but no logged main says which main it holds`,
        );
      cardOut(
        `CARD-ANYWAY: the branch holds main ${holds} but ${def} moved to ${tip}; ${merges.count} merges made, the card may be raised anyway`,
        buildReport({ ref: def, holds, tip, count: merges.count, hand: merges.hand }),
      );
      return 0;
    }
    const sym = gitOut(wt, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (sym.code !== 0 || sym.out === "") {
      die(`the worktree is not on a branch: check out ${ticket}, then call this step again`);
    }
    if (sym.out !== ticket) {
      die(
        `the worktree is on ${sym.out}, not ${ticket}: check out ${ticket}, then call this step again`,
      );
    }
    const msg = `Merge ${def} ${tip12} into ${ticket}`;
    const m = run("git", ["-C", wt, "merge", "--no-ff", "-m", msg, tip], { env: UNSET_GIT });
    if (m.code === 0) {
      const detail = `main=${tip} into ${ticket}`;
      if (!logMerge(dispatch, ticket, detail)) {
        die(
          `merged ${def} ${tip12} into ${ticket} but the merge was not logged: log it with run log-action ${dispatch} coachman merge ${ticket} "${detail}", then call this step again`,
        );
      }
      console.log(
        `MERGED ${tip}: merged ${def} ${tip12} into ${ticket}; run the gate at the merged head, then call this step again`,
      );
      return 2;
    }
    const still = gitOut(wt, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
    if (still.code !== 0 || still.out === "") {
      die(`the merge failed: ${firstLine(m.err) || firstLine(m.out) || `exit ${m.code}`}`);
    }
    const files = unmergedPaths(wt);
    const detail =
      files.length > 0
        ? `main=${tip} into ${ticket} conflict=${files.join(" ")}`
        : `main=${tip} into ${ticket}`;
    if (!logMerge(dispatch, ticket, detail)) {
      die(
        `the merge conflicts but the conflict was not logged: log it with run log-action ${dispatch} coachman merge ${ticket} "${detail}", resolve by hand, commit the merge, then call this step again`,
      );
    }
    console.log(
      `CONFLICT ${tip}: ${
        files.length > 0 ? files.join(" ") : "no conflicted files listed"
      }; resolve by hand, commit the merge, then call this step again`,
    );
    return 2;
  }
  if (gateLine !== null) {
    const gm = /^gate: (.+) at ([0-9a-f]+)$/u.exec(gateLine);
    const result = gm ? (gm[1] ?? "") : "";
    if (gm && result === "not run") {
      console.log(
        `GATE-NEEDED: the branch holds main ${tip} but the gate has not run at ${here12}; run the gate, then call this step again`,
      );
      return 2;
    }
    if (gm && result === "fail") {
      console.log(
        `GATE-FAILED gate: the gate failed at ${here12}; fix what this ticket's change meeting main's caused, else stop for a ruling naming the failure`,
      );
      return 2;
    }
    console.log(
      `GATE-FAILED gate: ${gm ? `the gate is ${result} at ${here12}` : gateLine}; fix what this ticket's change meeting main's caused, else stop for a ruling naming the failure`,
    );
    return 2;
  }
  cardOut(
    `CARD: the branch holds main ${tip} with the gate passed at ${here12}; the card may be raised`,
    buildReport({ ref: def, holds: tip, tip: null, count: merges.count, hand: merges.hand }),
  );
  return 0;
}

try {
  if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
  }
} catch (e) {
  if (e instanceof MergeDefaultFailure) {
    process.stderr.write(`${e.text}\n`);
    process.exit(e.code);
  }
  throw e;
}
