// Trace each serious finding of the runs to the commit that wrote its lines (see ../rule.md).
//
//   bun --no-env-file --config=/dev/null trace.ts --repo <checkout> --project <repo> \
//       --legacy <dir> --runs results/runs.json --cut <iso> --out results/findings.json
//
// `--repo` is a checkout of this repository whose history holds every run's branch, `--project`
// and `--legacy` are where the run folders are, as for `inventory.ts`. Run folders are only read.
// The output holds the finding's place, the commit classes and the group, and the finding's
// text scrubbed of anything that names the machine.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseActions, parseReviewRef } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import { privacyFaults, scrub } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import {
  type BlameLine,
  type Group,
  groupOf,
  identity,
  type Launches,
  type Origin,
  type OwnCommit,
  originOf,
  type Phase,
  parseBlame,
  parseTarget,
  phaseOf,
  snapshotOf,
} from "./origin.ts";
import { lineFor, matchReport, parseReportJson, type ReportItem, reportText } from "./reports.ts";
import { type Finding, findingsOf, redactSamples } from "./rounds.ts";

export type TracedFinding = {
  run: string;
  round: number;
  severity: "P1" | "P2";
  target: string;
  lenses: string[];
  lanes: string[];
  text: string;
  /** where the text came from: the finding line, a reviewer's own report, or nowhere */
  textSource: "line" | "report" | "none";
  file: string | null;
  first: number | null;
  last: number | null;
  snapshot: string | null;
  /** the first lines of the cited range as they stand at the snapshot */
  code: string[];
  origin: { kind: Origin["kind"]; round?: number; sha?: string; why?: string };
  /** the target of the earlier finding whose lines this one names again, where there is one */
  placedBefore: string | null;
  /** the targets of the findings whose fix wrote these lines, where an apply line names them */
  fixOf: string[];
  relog: boolean;
  group: Group | null;
};

/** What was found of one run's history: the controls read these. */
export type RunMeta = {
  run: string;
  merged: boolean;
  /** the run's own commits, with the phase each falls in and the round its subject names */
  commits: Array<{
    sha: string;
    phase: string;
    named: number | null;
    onMain: boolean;
    added: number;
    deleted: number;
    paths: string[];
  }>;
  /** the round each launch time was read for, as an ISO time */
  launches: Record<string, string>;
  /** rounds up to the last that have no launch time */
  launchesMissing: number[];
  /** the commits the run's `apply` lines name, with the time of each line */
  applies: Array<{ sha: string; at: string }>;
};

type Git = (args: string[]) => { ok: boolean; out: string };

const gitIn =
  (repo: string): Git =>
  (args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 << 20 });
    return { ok: r.status === 0, out: r.stdout ?? "" };
  };

type Merge = { sha: string; p1: string; p2: string; time: number; subject: string };

/** The first-parent merges of origin/main with two parents, newest first. */
function loadMerges(git: Git): Merge[] {
  const r = git(["log", "origin/main", "--first-parent", "--merges", "--format=%H\t%P\t%ct\t%s"]);
  const out: Merge[] = [];
  for (const line of r.out.split("\n")) {
    const [sha, parents, time, subject] = line.split("\t");
    const ps = (parents ?? "").split(" ");
    if (sha && ps.length === 2) {
      out.push({
        sha,
        p1: ps[0] as string,
        p2: ps[1] as string,
        time: Number(time),
        subject: subject ?? "",
      });
    }
  }
  return out;
}

/** Whether a merge's subject names the ticket, other than as the pull request's own number. */
export function mergeNames(subject: string, ticket: string): boolean {
  const rest = subject.replace(/^Merge pull request #[0-9]+:?\s*/u, "");
  return new RegExp(`(?:^|[^0-9])#${ticket}(?![0-9])`, "u").test(rest);
}

type RunSide = {
  dir: string;
  layout: "project" | "legacy";
};

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** When each round's first reviewer was launched, from launch lines and prompt files, in seconds. */
function launchTimes(
  dir: string,
  actions: ReturnType<typeof parseActions>["actions"],
  findings: Finding[],
): Launches {
  const launches: Launches = new Map();
  const put = (round: number, secs: number): void => {
    const have = launches.get(round);
    if (have === undefined || secs < have) launches.set(round, secs);
  };
  for (const a of actions) {
    if (a.action !== "review-launch") continue;
    const ref = parseReviewRef(a.detail);
    if (ref.round !== null) put(ref.round, Date.parse(a.ts) / 1000);
  }
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const m = /^review-r([0-9]+)-.*prompt\.txt$/u.exec(name);
      if (m) put(Number(m[1]), statSync(join(dir, name)).mtimeMs / 1000);
    }
  }
  // A round with neither is bounded above by its first finding line.
  for (const f of findings) {
    if (f.round !== null && !launches.has(f.round)) put(f.round, Date.parse(f.ts) / 1000 - 1);
  }
  return launches;
}

type RunGit = {
  own: OwnCommit[];
  base: string;
  subjectOf: Map<string, string>;
  stats: Map<string, { added: number; deleted: number; paths: string[] }>;
  /** the run's own commits that are on the branch, by full sha */
  merge: Merge | null;
};

function resolveRun(
  git: Git,
  merges: Merge[],
  ticket: string,
  dir: string,
  applyShas: string[],
  dispatchSecs: number,
): RunGit | null {
  const manifest = (() => {
    try {
      return JSON.parse(readText(join(dir, "manifest.json"))) as { base?: string };
    } catch {
      return {};
    }
  })();
  // The merges that name the ticket and came after the run began, oldest first: a research or
  // earlier pull request for the same ticket number is before the run and is not the run's.
  const candidates = merges
    .filter((m) => mergeNames(m.subject, ticket) && m.time >= dispatchSecs)
    .slice()
    .reverse();
  // The candidate whose branch holds the most of the run's applied fix commits; the oldest wins a tie.
  const resolved = applyShas
    .map((s) => git(["rev-parse", "--verify", `${s}^{commit}`]))
    .filter((r) => r.ok)
    .map((r) => r.out.trim());
  let merge: Merge | null = null;
  let best = -1;
  for (const m of candidates) {
    const held = resolved.filter((c) => git(["merge-base", "--is-ancestor", c, m.p2]).ok).length;
    if (held > best) {
      best = held;
      merge = m;
    }
  }
  let p1: string;
  let p2: string;
  if (merge) {
    p1 = merge.p1;
    p2 = merge.p2;
  } else {
    const tip = ["refs/heads/", "refs/remotes/origin/"]
      .map((p) => git(["rev-parse", "--verify", `${p}${ticket}`]))
      .find((r) => r.ok);
    if (!tip) return null;
    p1 = "origin/main";
    p2 = tip.out.trim();
  }
  const cherry = git(["cherry", p1, p2]);
  const onMain = new Set<string>();
  for (const line of cherry.out.split("\n")) {
    const m = /^- ([0-9a-f]{40})$/u.exec(line);
    if (m) onMain.add(m[1] as string);
  }
  // The author time, which a rebase or a pick keeps, and not the committer time, which it resets.
  const log = git(["log", "--reverse", "--topo-order", "--format=%H %at %P", `${p1}..${p2}`]);
  const subjects = git(["log", "--format=%H\t%s", `${p1}..${p2}`]);
  const subjectOf = new Map<string, string>();
  for (const line of subjects.out.split("\n")) {
    const [sha, subject] = line.split("\t");
    if (sha) subjectOf.set(sha, subject ?? "");
  }
  const own: OwnCommit[] = [];
  for (const line of log.out.split("\n")) {
    const parts = line.split(" ");
    if (parts.length < 3 || !parts[0]) continue;
    own.push({
      sha: parts[0],
      time: Number(parts[1]),
      parents: parts.length - 2,
      onMain: onMain.has(parts[0]),
    });
  }
  const stats = new Map<string, { added: number; deleted: number; paths: string[] }>();
  const numstat = git(["log", "--no-merges", "--numstat", "--format=@%H", `${p1}..${p2}`]);
  let at: { added: number; deleted: number; paths: string[] } | null = null;
  for (const line of numstat.out.split("\n")) {
    if (line.startsWith("@")) {
      at = { added: 0, deleted: 0, paths: [] };
      stats.set(line.slice(1), at);
      continue;
    }
    const m = /^([0-9]+|-)\t([0-9]+|-)\t(.+)$/u.exec(line);
    if (m && at) {
      at.added += m[1] === "-" ? 0 : Number(m[1]);
      at.deleted += m[2] === "-" ? 0 : Number(m[2]);
      at.paths.push(m[3] as string);
    }
  }
  const base = manifest.base ?? p1;
  return { own, base, merge, subjectOf, stats };
}

export type ApplyRow = { sha: string; targets: string[] };

function readApplies(actions: ReturnType<typeof parseActions>["actions"]): ApplyRow[] {
  return actions
    .filter((a) => a.action === "apply" && /^[0-9a-f]{6,40}$/u.test(a.target))
    .map((a) => ({
      sha: a.target,
      targets: a.detail.split(/[\s,;]+/u).filter((t) => /\.[A-Za-z0-9]+:[0-9]/u.test(t)),
    }));
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

function traceRun(
  git: Git,
  merges: Merge[],
  side: RunSide,
  run: string,
): { findings: TracedFinding[]; meta: RunMeta | null } {
  const { actions } = parseActions(readText(join(side.dir, "actions.jsonl")));
  const all = findingsOf(actions).filter((f) => f.serious && f.round !== null);
  const applies = readApplies(actions);
  const dispatchSecs = Date.parse(actions[0]?.ts ?? "") / 1000;
  const rg = resolveRun(
    git,
    merges,
    run,
    side.dir,
    applies.map((a) => a.sha),
    dispatchSecs,
  );
  const launches = launchTimes(side.dir, actions, all);
  if (process.env.TRACE_DEBUG === run) {
    const iso = (t: number): string => new Date(t * 1000).toISOString().slice(5, 16);
    console.error(
      `debug ${run}: merge=${rg?.merge?.sha.slice(0, 8) ?? "none"} own=${rg?.own.length ?? 0} base=${rg?.base.slice(0, 8)}`,
    );
    console.error(`  launches ${[...launches].map(([r, t]) => `${r}@${iso(t)}`).join(" ")}`);
    for (const c of rg?.own ?? []) {
      console.error(
        `  ${c.sha.slice(0, 8)} ${iso(c.time)} p${c.parents}${c.onMain ? " main" : ""}`,
      );
    }
  }
  const lensRounds = new Set<string>();
  for (const a of actions) {
    if (a.action === "review-launch" || a.action === "review-harvest") {
      const ref = parseReviewRef(a.detail);
      if (ref.lens && ref.round !== null) lensRounds.add(`${ref.lens}:${ref.round}`);
    }
  }
  for (const f of all)
    for (const l of f.lenses) if (f.round !== null) lensRounds.add(`${l}:${f.round}`);
  const cache = new Map<string, BlameLine[] | null>();
  const blame = (
    snapshot: string,
    file: string,
    first: number,
    last: number,
  ): BlameLine[] | null => {
    const key = `${snapshot}|${file}|${first}|${last}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const r = git(["blame", "--porcelain", "-M", "-L", `${first},${last}`, snapshot, "--", file]);
    const lines = r.ok ? parseBlame(r.out) : null;
    cache.set(key, lines);
    return lines;
  };
  const ownByShort = new Map<string, OwnCommit>();
  for (const c of rg?.own ?? []) ownByShort.set(c.sha, c);
  const classify = (sha: string): Phase | "base" => {
    const c = ownByShort.get(sha);
    if (!c || c.onMain) return "base";
    return phaseOf(c.time, launches);
  };
  const appliedBy = new Map<string, string[]>();
  for (const a of applies) {
    const full = [...ownByShort.keys()].find((s) => s.startsWith(a.sha));
    if (full) appliedBy.set(full, a.targets);
  }
  const reportCache = new Map<number, { items: ReportItem[]; markdown: string[] }>();
  const reportsOf = (round: number): { items: ReportItem[]; markdown: string[] } => {
    const have = reportCache.get(round);
    if (have) return have;
    const items: ReportItem[] = [];
    const markdown: string[] = [];
    const logs = join(side.dir, "logs");
    if (existsSync(logs)) {
      for (const name of readdirSync(logs)) {
        if (!new RegExp(`^review-r${round}-.*-findings\\.(json|md)$`, "u").test(name)) continue;
        const text = readText(join(logs, name));
        if (name.endsWith(".json")) items.push(...parseReportJson(text));
        else markdown.push(text);
      }
    }
    const made = { items, markdown };
    reportCache.set(round, made);
    return made;
  };
  const out: TracedFinding[] = [];
  const named = new Map<string, { target: string; round: number }>();
  const ordered = all
    .map((f, i) => ({ f, i }))
    .sort((x, y) => (x.f.round as number) - (y.f.round as number) || x.i - y.i);
  const seenTargets = new Map<string, number>();
  for (const { f } of ordered) {
    const round = f.round as number;
    const place = parseTarget(f.target);
    const launch = launches.get(round);
    const snapshot =
      rg && launch !== undefined ? (snapshotOf(rg.own, launch) ?? rg.base) : (rg?.base ?? null);
    let origin: Origin = { kind: "unplaced", why: "no run history" };
    let lines: BlameLine[] = [];
    if (!place) origin = { kind: "unplaced", why: "target names no line" };
    else if (!snapshot) origin = { kind: "unplaced", why: "no snapshot" };
    else {
      const b = blame(snapshot, place.file, place.first, place.last);
      if (!b) origin = { kind: "unplaced", why: "file or line not in the snapshot" };
      else {
        lines = b;
        origin = originOf(b, round, classify);
      }
    }
    // placed before: a line of this finding already named by an earlier serious finding
    let placedBefore: string | null = null;
    for (const l of lines) {
      const hit = named.get(identity(l));
      if (hit && hit.round < round) {
        placedBefore = hit.target;
        break;
      }
    }
    const fixOf: string[] = [];
    if (origin.kind === "fix" && origin.sha) {
      for (const t of appliedBy.get(origin.sha) ?? []) fixOf.push(t);
    }
    const relogFirst = seenTargets.get(f.target);
    const relog = relogFirst !== undefined && relogFirst < round;
    if (!seenTargets.has(f.target)) seenTargets.set(f.target, round);
    const lensReviewedBefore =
      f.lenses.length === 0 ||
      f.lenses.some((l) =>
        [...lensRounds].some((k) => k.startsWith(`${l}:`) && Number(k.split(":")[1]) < round),
      );
    const group =
      round >= 2
        ? groupOf({ round, origin, placedBefore: placedBefore !== null, lensReviewedBefore })
        : null;
    for (const l of lines) {
      if (!named.has(identity(l))) named.set(identity(l), { target: f.target, round });
    }
    let text = f.text;
    let textSource: "line" | "report" | "none" = text !== "" ? "line" : "none";
    if (text === "") {
      const reports = reportsOf(round);
      const item = matchReport(reports.items, f.target, place);
      const fromMd = reports.markdown.map((m) => lineFor(m, f.target)).find((l) => l !== "") ?? "";
      const found = item ? reportText(item) : fromMd;
      if (found !== "") {
        text = found;
        textSource = "report";
      }
    }
    out.push({
      run,
      round,
      severity: f.severity as "P1" | "P2",
      target: scrub(f.target, 120),
      lenses: f.lenses,
      lanes: f.lanes,
      text: redactSamples(scrub(text, 420)),
      textSource,
      file: place?.file ?? null,
      first: place?.first ?? null,
      last: place?.last ?? null,
      snapshot: snapshot ? snapshot.slice(0, 8) : null,
      code: lines.slice(0, 3).map((l) => redactSamples(scrub(l.content, 160))),
      origin: {
        kind: origin.kind,
        ...(origin.kind === "fix" ? { round: origin.round, sha: origin.sha.slice(0, 8) } : {}),
        ...(origin.kind === "change" || origin.kind === "base"
          ? { sha: origin.sha.slice(0, 8) }
          : {}),
        ...(origin.kind === "unplaced" ? { why: origin.why } : {}),
      },
      placedBefore: placedBefore ? scrub(placedBefore, 120) : null,
      fixOf: fixOf.map((t) => scrub(t, 120)),
      relog,
      group,
    });
  }
  const iso = (t: number): string => new Date(t * 1000).toISOString().replace(".000Z", "Z");
  const roundNamed = (subject: string): number | null => {
    const m = /\bround[ -]?([0-9]+)\b|\br([0-9]+)\b/iu.exec(subject);
    return m ? Number(m[1] ?? m[2]) : null;
  };
  const maxRound = Math.max(0, ...ordered.map((o) => o.f.round as number));
  const missing: number[] = [];
  for (let r = 1; r <= maxRound; r += 1) if (!launches.has(r)) missing.push(r);
  const meta: RunMeta = {
    run,
    merged: rg?.merge != null,
    commits: (rg?.own ?? []).map((c) => {
      const ph = c.onMain ? ({ kind: "later" } as Phase) : phaseOf(c.time, launches);
      return {
        sha: c.sha.slice(0, 8),
        phase: ph.kind === "fix" ? `fix:${ph.round}` : ph.kind,
        named: roundNamed(rg?.subjectOf.get(c.sha) ?? ""),
        onMain: c.onMain,
        added: rg?.stats.get(c.sha)?.added ?? 0,
        deleted: rg?.stats.get(c.sha)?.deleted ?? 0,
        paths: rg?.stats.get(c.sha)?.paths ?? [],
      };
    }),
    launches: Object.fromEntries([...launches].map(([r, t]) => [String(r), iso(t)])),
    launchesMissing: missing,
    applies: actions
      .filter((a) => a.action === "apply" && /^[0-9a-f]{6,40}$/u.test(a.target))
      .map((a) => ({ sha: a.target.slice(0, 8), at: a.ts })),
  };
  return { findings: out, meta };
}

const main = (args: string[]): void => {
  const repo = arg(args, "--repo");
  const project = arg(args, "--project");
  const legacy = arg(args, "--legacy");
  const runsFile = arg(args, "--runs");
  const cut = arg(args, "--cut");
  const out = arg(args, "--out");
  const only = arg(args, "--only");
  const after = arg(args, "--after");
  if (!repo || !project || !runsFile || !cut || !out) {
    throw new Error(
      "usage: trace.ts --repo <checkout> --project <repo> [--legacy <dir>] --runs <runs.json> --cut <iso> --out <file> [--only a,b]",
    );
  }
  const inventory = JSON.parse(readFileSync(runsFile, "utf8")) as { runs: RunRowLite[] };
  const set = inventory.runs
    .filter((r) => r.rounds > 0 && r.reviewEndedAt !== null && r.reviewEndedAt <= cut)
    .filter((r) => !after || (r.reviewEndedAt as string) > after)
    .filter((r) => !only || only.split(",").includes(r.run));
  const git = gitIn(resolve(repo));
  const merges = loadMerges(git);
  const rows: TracedFinding[] = [];
  const metas: RunMeta[] = [];
  for (const r of set) {
    const dir =
      r.layout === "project"
        ? join(project, ".postmaster", "runs", r.run)
        : join(legacy ?? "", r.run);
    const traced = traceRun(git, merges, { dir, layout: r.layout }, r.run);
    rows.push(...traced.findings);
    if (traced.meta) metas.push(traced.meta);
    console.error(`${r.run}: ${traced.findings.length} serious findings`);
  }
  const text = `${JSON.stringify({ cut, after: after ?? null, runIds: set.map((r) => r.run), runs: metas, findings: rows }, null, 1)}\n`;
  const faults = privacyFaults(text);
  if (faults.length > 0)
    throw new Error(`the output holds ${faults.join(" and ")}; nothing written`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, text);
};

if (import.meta.main) main(process.argv.slice(2));
