#!/usr/bin/env bun
// How much of a synthesis came from each lane, measured in runs of six words in git.
//
//   bun --no-env-file --config=<tool>/scripts/bunfig.empty.toml scripts/synthesis-shares.ts <repo> \
//     --base <sha> --lane <name>=<head-sha> [--lane <name>=<head-sha> ...] \
//     --synthesis <from-sha>..<to-sha> [--oracle <sha>] [--json] [--record <dispatch>]
//
// The lines a diff adds are split into words at whitespace; every six consecutive words make
// one run. A run of the synthesis is counted once per occurrence, and falls in exactly one
// group: the only lane whose own diff holds that run, `shared` when two or more do, or
// `neither` when none does (text the coachman wrote itself). Matching is exact. Counts are
// split into code and docs by file type. Left out on every side: the files the oracle commit
// added, the lane records at a worktree's root, lockfiles and generated files.
//
//   --json           print the record as JSON on stdout after the SHARES line
//   --record DIR     write DIR/shares.json for a later audit to read without this script
//
//   exit 0  measured
//   exit 1  usage, a missing commit, a merge in the synthesis range, or a git failure
//
// The coachman runs this from the target's worktree with bun --no-env-file and --config=
// naming scripts/bunfig.empty.toml (an empty config the tool owns), and git --no-ext-diff
// --no-textconv, so nothing the target configures runs or is loaded. Use the --config=
// equals form: bun treats `--config FILE` as the script path.

const K = 6;

const LANE_RECORDS = ["WORKHORSE-SPEC.md", "WORKHORSE-SUMMARY.md", "WORKHORSE-BLOCKED.md"];
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
];
const DOCS_SUFFIXES = [".md", ".mdx", ".rst", ".adoc", ".txt"];

export type Kind = "code" | "docs";

export type LaneCounts = {
  readonly total: number;
  readonly shared: number;
  readonly neither: number;
  readonly lanes: Readonly<Record<string, number>>;
};

export type SharePct = {
  readonly total: number;
  readonly shared: string;
  readonly neither: string;
  readonly lanes: Readonly<Record<string, string>>;
};

export type CountsByKind = {
  readonly all: LaneCounts;
  readonly code: LaneCounts;
  readonly docs: LaneCounts;
};

export type SharesByKind = {
  readonly all: SharePct;
  readonly code: SharePct;
  readonly docs: SharePct;
};

export type LaneRef = { readonly name: string; readonly head: string };

export type Exclusions = {
  readonly oracleFiles: readonly string[];
  readonly laneRecords: readonly string[];
  readonly lockfiles: readonly string[];
  readonly generated: readonly string[];
};

export type MeasureRecord = {
  readonly base: string;
  readonly lanes: readonly LaneRef[];
  readonly synthesis: { readonly from: string; readonly to: string };
  readonly oracle: string | null;
  readonly k: number;
  readonly exclusions: Exclusions;
  readonly counts: CountsByKind;
  readonly shares: SharesByKind;
};

// --- pure core ------------------------------------------------------------------------------

export const words = (text: string): string[] => text.split(/\s+/).filter((w) => w.length > 0);

export const runsOfWords = (text: string, k: number = K): string[] => {
  const ws = words(text);
  return ws.length < k
    ? []
    : Array.from({ length: ws.length - k + 1 }, (_, i) => ws.slice(i, i + k).join(" "));
};

export const kindOf = (path: string): Kind =>
  DOCS_SUFFIXES.some((s) => path.endsWith(s)) ? "docs" : "code";

export const basename = (path: string): string => path.split("/").pop() ?? "";

// Lane records sit at a worktree's root and are named exactly; a nested file of the same
// name is product. Lockfiles are left out wherever they sit.
export const isLaneRecord = (path: string): boolean => LANE_RECORDS.includes(path);
export const isLockfile = (path: string): boolean => LOCKFILES.includes(basename(path));

export type Skip = (path: string) => boolean;

export const parseAddedLines = (diff: string, skip: Skip): Readonly<Record<string, readonly string[]>> => {
  // Mutation of this fold's local accumulator only: an immutable update per added line is
  // O(n^2) on a large diff, and the map never escapes except as the finished value.
  const files = new Map<string, string[]>();
  let path = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      path = raw.startsWith("b/") ? raw.slice(2) : "";
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++") && path && !skip(path)) {
      const got = files.get(path);
      if (got) got.push(line.slice(1));
      else files.set(path, [line.slice(1)]);
    }
  }
  return Object.fromEntries(files);
};

export const runsByPath = (
  added: Readonly<Record<string, readonly string[]>>,
  k: number = K,
): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(added).map(([path, lines]) => [path, runsOfWords(lines.join("\n"), k)]),
  );

export const laneRunSet = (
  added: Readonly<Record<string, readonly string[]>>,
  k: number = K,
): ReadonlySet<string> =>
  new Set(Object.values(added).flatMap((lines) => runsOfWords(lines.join("\n"), k)));

const emptyLaneCounts = (laneNames: readonly string[]): LaneCounts => ({
  total: 0,
  shared: 0,
  neither: 0,
  lanes: Object.fromEntries(laneNames.map((n) => [n, 0])),
});

const bump = (c: LaneCounts, key: string): LaneCounts =>
  key === "shared" || key === "neither"
    ? { ...c, total: c.total + 1, [key]: c[key] + 1 }
    : {
        ...c,
        total: c.total + 1,
        lanes: { ...c.lanes, [key]: (c.lanes[key] ?? 0) + 1 },
      };

export const classify = (
  run: string,
  laneSets: Readonly<Record<string, ReadonlySet<string>>>,
): string => {
  const hits = Object.entries(laneSets)
    .filter(([, set]) => set.has(run))
    .map(([name]) => name);
  if (hits.length === 0) return "neither";
  if (hits.length === 1) return hits[0] as string;
  return "shared";
};

export const attribute = (
  synthesisRuns: Readonly<Record<string, readonly string[]>>,
  laneSets: Readonly<Record<string, ReadonlySet<string>>>,
  laneNames: readonly string[],
): CountsByKind => {
  const start: CountsByKind = {
    all: emptyLaneCounts(laneNames),
    code: emptyLaneCounts(laneNames),
    docs: emptyLaneCounts(laneNames),
  };
  return Object.entries(synthesisRuns).reduce((acc, [path, runs]) => {
    const kind = kindOf(path);
    return runs.reduce((a, run) => {
      const group = classify(run, laneSets);
      return {
        ...a,
        all: bump(a.all, group),
        [kind]: bump(a[kind], group),
      };
    }, acc);
  }, start);
};

export const pct = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${Math.round((100 * part) / whole)}%`;

export const sharesOf = (c: LaneCounts): SharePct => ({
  total: c.total,
  shared: pct(c.shared, c.total),
  neither: pct(c.neither, c.total),
  lanes: Object.fromEntries(Object.entries(c.lanes).map(([n, v]) => [n, pct(v, c.total)])),
});

export const sharesByKind = (counts: CountsByKind): SharesByKind => ({
  all: sharesOf(counts.all),
  code: sharesOf(counts.code),
  docs: sharesOf(counts.docs),
});

export const formatShares = (counts: CountsByKind, laneNames: readonly string[]): string => {
  const part = (label: string, c: LaneCounts): string =>
    [
      label,
      `n=${c.total}`,
      ...laneNames.map((n) => `${n}=${pct(c.lanes[n] ?? 0, c.total)}`),
      `shared=${pct(c.shared, c.total)}`,
      `neither=${pct(c.neither, c.total)}`,
    ].join(" ");
  return [part("all", counts.all), part("code", counts.code), part("docs", counts.docs)].join(" | ");
};

export const sharesLine = (counts: CountsByKind, laneNames: readonly string[]): string =>
  `SHARES: ${formatShares(counts, laneNames)}`;

export const makeSkip = (
  oracleFiles: ReadonlySet<string>,
  generated: ReadonlySet<string>,
): Skip => (path: string) =>
  oracleFiles.has(path) || isLaneRecord(path) || isLockfile(path) || generated.has(path);

// --- edges: git, argv, files ----------------------------------------------------------------

export type Run = {
  readonly repo: string;
  readonly base: string;
  readonly lanes: readonly LaneRef[];
  readonly synthesis: { readonly from: string; readonly to: string };
  readonly oracle: string | null;
};

class GitError extends Error {}

const git = (repo: string, ...args: string[]): string => {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    const err = new TextDecoder().decode(p.stderr);
    throw new GitError(`git ${args[0]} exited ${p.exitCode}${err ? `: ${err.trim()}` : ""}`);
  }
  return new TextDecoder().decode(p.stdout);
};

const diffArgs = (a: string, b: string): string[] => [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--unified=0",
  a,
  b,
];

const filesAddedBy = (repo: string, commit: string | null): ReadonlySet<string> =>
  commit
    ? new Set(
        git(repo, "show", "--name-only", "--format=", commit)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
    : new Set<string>();

const generatedPaths = (repo: string, paths: readonly string[]): readonly string[] => {
  if (paths.length === 0) return [];
  const out = git(repo, "check-attr", "linguist-generated", "generated", "--", ...paths);
  const marked = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^(.*?): (linguist-generated|generated): (.*)$/);
    if (m && m[3] === "set") marked.add(m[1] as string);
  }
  return [...marked].sort();
};

const missingCommits = (repo: string, commits: readonly string[]): readonly string[] =>
  commits.filter((c) => {
    const p = Bun.spawnSync(["git", "-C", repo, "cat-file", "-e", `${c}^{commit}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return p.exitCode !== 0;
  });

const hasMerge = (repo: string, from: string, to: string): boolean =>
  git(repo, "rev-list", "--merges", `${from}..${to}`).trim().length > 0;

const parseLane = (raw: string): LaneRef | null => {
  const i = raw.indexOf("=");
  if (i <= 0 || i === raw.length - 1) return null;
  return { name: raw.slice(0, i), head: raw.slice(i + 1) };
};

const parseRange = (raw: string): { from: string; to: string } | null => {
  const i = raw.indexOf("..");
  if (i <= 0 || i === raw.length - 2) return null;
  return { from: raw.slice(0, i), to: raw.slice(i + 2) };
};

export const measure = (run: Run, skip: Skip): CountsByKind => {
  const synthesis = runsByPath(
    parseAddedLines(git(run.repo, ...diffArgs(run.synthesis.from, run.synthesis.to)), skip),
  );
  const laneSets = Object.fromEntries(
    run.lanes.map((lane) => [
      lane.name,
      laneRunSet(parseAddedLines(git(run.repo, ...diffArgs(run.base, lane.head)), skip)),
    ]),
  );
  return attribute(synthesis, laneSets, run.lanes.map((l) => l.name));
};

const buildRecord = (run: Run, counts: CountsByKind, exclusions: Exclusions): MeasureRecord => ({
  base: run.base,
  lanes: run.lanes,
  synthesis: run.synthesis,
  oracle: run.oracle,
  k: K,
  exclusions,
  counts,
  shares: sharesByKind(counts),
});

const usage = (msg?: string): number => {
  if (msg) console.error(`synthesis-shares: ${msg}`);
  console.error(
    "usage: synthesis-shares.ts <repo> --base <sha> --lane <name>=<head> [--lane ...] --synthesis <from>..<to> [--oracle <sha>] [--json] [--record <dispatch>]",
  );
  return 1;
};

export const main = (argv: readonly string[]): number => {
  const args = [...argv];
  if (args.length === 0) return usage();
  const repo = args.shift() as string;
  let base = "";
  let synthesisRaw = "";
  let oracle: string | null = null;
  let recordDir: string | null = null;
  let wantJson = false;
  const laneRaws: string[] = [];
  while (args.length > 0) {
    const a = args.shift() as string;
    if (a === "--json") wantJson = true;
    else if (a === "--base" && args.length) base = args.shift() as string;
    else if (a === "--synthesis" && args.length) synthesisRaw = args.shift() as string;
    else if (a === "--oracle" && args.length) oracle = args.shift() as string;
    else if (a === "--record" && args.length) recordDir = args.shift() as string;
    else if (a === "--lane" && args.length) laneRaws.push(args.shift() as string);
    else return usage(`unknown or incomplete argument ${a}`);
  }
  if (!base || !synthesisRaw || laneRaws.length === 0) {
    return usage("need --base, --lane and --synthesis");
  }
  const lanes = laneRaws.map(parseLane);
  if (lanes.some((l) => l === null)) return usage("--lane takes name=head-sha");
  const range = parseRange(synthesisRaw);
  if (!range) return usage("--synthesis takes from..to");
  const resolved = lanes as LaneRef[];
  const pinned = [
    base,
    ...resolved.map((l) => l.head),
    range.from,
    range.to,
    ...(oracle ? [oracle] : []),
  ];
  const gone = missingCommits(repo, pinned);
  if (gone.length > 0) {
    console.error(`synthesis-shares: repository lacks pinned commits ${gone.join(", ")}`);
    return 1;
  }
  if (hasMerge(repo, range.from, range.to)) {
    console.error("synthesis-shares: the synthesis range holds a merge commit");
    return 1;
  }
  const oracleFiles = filesAddedBy(repo, oracle);
  const keepAll: Skip = () => false;
  const allPaths = [
    ...Object.keys(parseAddedLines(git(repo, ...diffArgs(range.from, range.to)), keepAll)),
    ...resolved.flatMap((lane) =>
      Object.keys(parseAddedLines(git(repo, ...diffArgs(base, lane.head)), keepAll)),
    ),
  ];
  const generated = new Set(generatedPaths(repo, [...new Set(allPaths)]));
  const skip = makeSkip(oracleFiles, generated);
  const run: Run = { repo, base, lanes: resolved, synthesis: range, oracle };
  const counts = measure(run, skip);
  const exclusions: Exclusions = {
    oracleFiles: [...oracleFiles].sort(),
    laneRecords: [...LANE_RECORDS],
    lockfiles: [...LOCKFILES],
    generated: [...generated].sort(),
  };
  const record = buildRecord(run, counts, exclusions);
  const laneNames = resolved.map((l) => l.name);
  console.log(sharesLine(counts, laneNames));
  if (wantJson) console.log(JSON.stringify(record, null, 2));
  if (recordDir) {
    Bun.write(`${recordDir.replace(/\/$/, "")}/shares.json`, JSON.stringify(record, null, 2) + "\n");
  }
  return 0;
};

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
