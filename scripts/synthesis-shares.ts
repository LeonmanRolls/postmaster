import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { jsWords } from "./lib/text.ts";

const WORDS_PER_RUN = 6;
const DOC_SUFFIXES = [".md", ".mdx", ".rst", ".adoc", ".txt"] as const;
const ROOT_RECORDS = ["WORKHORSE-SUMMARY.md", "WORKHORSE-BLOCKED.md"] as const;
const GENERATED_NAMES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
] as const;
const GENERATED_ATTRIBUTES = ["generated", "linguist-generated"] as const;
const NEGATIVE_ATTRIBUTE_VALUES = ["unspecified", "unset", "false"] as const;
// The audit's excluded-path pattern (measure.py EXCLUDED): lane records and blind-test
// material, wherever they sit.
// /u would newly fold non-ASCII letters into these names, which main's /i never does.
// ASCII: the excluded audit names are ASCII literals matched ASCII-case-insensitively.
const AUDIT_EXCLUDED = /(WORKHORSE-SUMMARY\.md|BASE-CONTROLS|oracle|acceptance)/i;

type Kind = "code" | "docs";
type LaneInput = Readonly<{ name: string; commit: string }>;
type Inputs = Readonly<{
  base: string;
  synthesis: string;
  lanes: readonly LaneInput[];
  oracle: string | null;
  record: string | null;
}>;
type FileWords = Readonly<{ path: string; words: readonly string[] }>;
type ChangedFile = Readonly<{ path: string; diffPaths: readonly string[] }>;
type Exclusion = Readonly<{ path: string; reason: string }>;
type RangeFiles = Readonly<{
  files: readonly FileWords[];
  exclusions: readonly Exclusion[];
  binaryPaths: readonly string[];
}>;
type LaneFiles = Readonly<{ name: string; head: string; files: RangeFiles }>;
type Ratio = Readonly<{ numerator: number; denominator: number }>;
type LaneShare = Readonly<{ name: string; runs: number; share: Ratio }>;
type Bucket = Readonly<{ runs: number; share: Ratio }>;
type KindShare = Readonly<{
  totalRuns: number;
  laneOnly: readonly LaneShare[];
  shared: Bucket;
  neither: Bucket;
}>;
type Report = Readonly<{
  schema: "postmaster.synthesis-shares.v1";
  base: string;
  synthesis: Readonly<{ base: string; head: string }>;
  oracle: string | null;
  lanes: readonly Readonly<{ name: string; head: string }>[];
  algorithm: Readonly<{
    wordsPerRun: number;
    splitOn: "whitespace";
    match: "exact case and punctuation";
    countedUnit: "added-line six-word run occurrence";
  }>;
  exclusions: Readonly<{
    oraclePaths: readonly string[];
    byRange: Readonly<{
      synthesis: readonly Exclusion[];
      lanes: readonly Readonly<{ name: string; files: readonly Exclusion[] }>[];
    }>;
    binaryPaths: Readonly<{
      synthesis: readonly string[];
      lanes: readonly Readonly<{ name: string; files: readonly string[] }>[];
    }>;
  }>;
  kinds: Readonly<Record<Kind, KindShare>>;
}>;

const USAGE = `Usage: <tool>/scripts/run synthesis-shares \\
  --base <commit> [--synthesis <commit>] [--lane <name>=<commit> ...] \\
  [--oracle <commit>] [--record <dispatch-dir>]

The command reads committed Git diffs in the current repository. Without
--synthesis the measured synthesis is HEAD there. --record writes
<dispatch-dir>/shares.json once, refuses to overwrite an existing record, and
appends the SHARES line to that dispatch's run log.`;

const fail = (message: string): never => {
  throw new Error(message);
};

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const gitResult = (
  repo: string,
  args: readonly string[],
  extraEnv: Record<string, string | undefined> = {},
): Readonly<{ code: number; stdout: string; stderr: string }> => {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = Bun.spawnSync(
    ["git", "-c", "core.attributesFile=/dev/null", "--no-pager", "-C", repo, ...args],
    { stdout: "pipe", stderr: "pipe", env },
  );
  return {
    code: result.exitCode,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
  };
};

const gitText = (repo: string, args: readonly string[]): string => {
  const result = gitResult(repo, args);
  return result.code === 0
    ? result.stdout
    : fail(`git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`);
};

const parseLane = (value: string): LaneInput => {
  const [name, ...commitParts] = value.split("=");
  const commit = commitParts.join("=");
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name ?? "") && commit.length > 0
    ? { name, commit }
    : fail(`invalid --lane value '${value}'; expected <name>=<commit>`);
};

const parseInputs = (args: readonly string[]): Inputs => {
  const read = (
    rest: readonly string[],
    current: Inputs = {
      base: "",
      synthesis: "",
      lanes: [],
      oracle: null,
      record: null,
    },
  ): Inputs => {
    if (rest.length === 0) return current;
    const [flag, value, ...tail] = rest;
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return fail(`${flag} needs a value\n\n${USAGE}`);
    }
    if (flag === "--base") {
      return current.base
        ? fail("--base may be supplied only once")
        : read(tail, { ...current, base: value });
    }
    if (flag === "--synthesis") {
      return current.synthesis
        ? fail("--synthesis may be supplied only once")
        : read(tail, { ...current, synthesis: value });
    }
    if (flag === "--oracle") {
      return current.oracle
        ? fail("--oracle may be supplied only once")
        : read(tail, { ...current, oracle: value });
    }
    if (flag === "--record") {
      return current.record
        ? fail("--record may be supplied only once")
        : read(tail, { ...current, record: value });
    }
    if (flag === "--lane") {
      const lane = parseLane(value);
      return current.lanes.some((item) => item.name === lane.name)
        ? fail(`lane '${lane.name}' is named more than once`)
        : read(tail, { ...current, lanes: [...current.lanes, lane] });
    }
    return fail(`unknown option '${flag}'\n\n${USAGE}`);
  };

  const inputs = read(args);
  return inputs.base ? inputs : fail(`--base is required\n\n${USAGE}`);
};

const resolveCommit = (repo: string, value: string, label: string): string => {
  const resolved = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/iu.test(value)
    ? gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`]).trim()
    : fail(`${label} must be a full commit ID`);
  return resolved;
};

const isAncestor = (repo: string, base: string, head: string, label: string): void => {
  const result = gitResult(repo, ["merge-base", "--is-ancestor", base, head]);
  if (result.code !== 0) {
    fail(
      result.code === 1
        ? `${label} commit ${head} is not descended from base ${base}`
        : `git merge-base --is-ancestor ${base} ${head} failed: ${result.stderr.trim()}`,
    );
  }
};

const changedFiles = (repo: string, base: string, head: string): readonly ChangedFile[] => {
  const entries = gitText(repo, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--name-status",
    "-z",
    base,
    head,
  ])
    .split("\0")
    .filter(Boolean);
  const parse = (
    rest: readonly string[],
    files: readonly ChangedFile[] = [],
  ): readonly ChangedFile[] => {
    const [status, firstPath, ...tail] = rest;
    if (status === undefined || firstPath === undefined) return files;
    if (status.startsWith("R") || status.startsWith("C")) {
      const [newPath, ...next] = tail;
      return newPath === undefined
        ? files
        : parse(next, [...files, { path: newPath, diffPaths: [firstPath, newPath] }]);
    }
    return parse(tail, [...files, { path: firstPath, diffPaths: [firstPath] }]);
  };
  return parse(entries);
};

const oraclePaths = (repo: string, oracle: string): readonly string[] =>
  gitText(repo, ["show", "--name-only", "--format=", "-z", oracle]).split("\0").filter(Boolean);

const isRootRecord = (path: string): boolean =>
  ROOT_RECORDS.includes(path as (typeof ROOT_RECORDS)[number]);
const isKnownGeneratedName = (path: string): boolean =>
  GENERATED_NAMES.includes(basename(path) as (typeof GENERATED_NAMES)[number]);

const generatedPaths = (
  repo: string,
  commit: string,
  paths: readonly string[],
): ReadonlySet<string> => {
  if (paths.length === 0) return new Set();
  const index = mkstempSync(tmpdir(), "postmaster-attributes-index-");
  let output: string;
  try {
    const env = { GIT_INDEX_FILE: index };
    const readTree = gitResult(repo, ["read-tree", commit], env);
    if (readTree.code !== 0)
      fail(`git read-tree ${commit} exited ${readTree.code}: ${readTree.stderr.trim()}`);
    const attributes = gitResult(
      repo,
      ["check-attr", "--cached", "-z", ...GENERATED_ATTRIBUTES, "--", ...paths],
      env,
    );
    if (attributes.code !== 0)
      fail(`git check-attr --cached exited ${attributes.code}: ${attributes.stderr.trim()}`);
    output = attributes.stdout;
  } finally {
    try {
      unlinkSync(index);
    } catch {}
  }
  // Mutation of this parse's local list only: one batched check-attr call per range
  // instead of one git spawn per file, and the list never escapes except as the set.
  const fields = output.split("\0");
  const hits: string[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index] as string;
    const value = fields[index + 2] as string;
    if (!NEGATIVE_ATTRIBUTE_VALUES.includes(value as (typeof NEGATIVE_ATTRIBUTE_VALUES)[number])) {
      hits.push(path);
    }
  }
  return new Set(hits);
};

const staticExclusionReason = (
  paths: readonly string[],
  oraclePaths: readonly string[],
): string | null =>
  paths.some((candidate) => oraclePaths.includes(candidate))
    ? "touched by the oracle commit"
    : paths.some(isRootRecord)
      ? "lane record at the worktree root"
      : paths.some(isKnownGeneratedName)
        ? "generated lockfile"
        : paths.some((candidate) => AUDIT_EXCLUDED.test(candidate))
          ? "matches the audit's excluded-path pattern"
          : null;

const exclusionReason = (
  paths: readonly string[],
  path: string,
  oraclePaths: readonly string[],
  generated: ReadonlySet<string>,
): string | null =>
  staticExclusionReason(paths, oraclePaths) ??
  (generated.has(path) ? "marked generated by .gitattributes" : null);

const diffForPaths = (repo: string, base: string, head: string, paths: readonly string[]): string =>
  gitText(repo, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--unified=0",
    "--output-indicator-new=>",
    "--no-color",
    base,
    head,
    "--",
    ...paths.map((path) => `:(literal)${path}`),
  ]);

const wordsInAddedLines = (
  repo: string,
  base: string,
  head: string,
  paths: readonly string[],
): readonly string[] => {
  const output = diffForPaths(repo, base, head, paths);
  const addedLines = output
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.slice(1));
  const joined = addedLines.join("\n").trim();
  return joined ? jsWords(joined) : [];
};

const hasBinaryPatch = (
  repo: string,
  base: string,
  head: string,
  paths: readonly string[],
): boolean =>
  diffForPaths(repo, base, head, paths)
    .split("\n")
    .some((line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"));

const collectRange = (
  repo: string,
  base: string,
  head: string,
  oraclePaths: readonly string[],
): RangeFiles => {
  const changed = changedFiles(repo, base, head);
  const generated = generatedPaths(
    repo,
    head,
    changed.map(({ path }) => path),
  );
  const inspected = changed.map(({ path, diffPaths }) => ({
    path,
    diffPaths,
    reason: exclusionReason(diffPaths, path, oraclePaths, generated),
  }));
  const exclusions = inspected
    .filter(
      (item): item is { path: string; diffPaths: readonly string[]; reason: string } =>
        item.reason !== null,
    )
    .map(({ path, reason }) => ({ path, reason }));
  const included = inspected.filter((item) => item.reason === null);
  const files = included.map(({ path, diffPaths }) => ({
    path,
    words: wordsInAddedLines(repo, base, head, diffPaths),
  }));
  const binaryPaths = included
    .filter(({ diffPaths }) => hasBinaryPatch(repo, base, head, diffPaths))
    .map(({ path }) => path);
  return { files, exclusions, binaryPaths };
};

const wordRuns = (words: readonly string[]): readonly string[] =>
  words.flatMap((_, index) =>
    index + WORDS_PER_RUN <= words.length
      ? [JSON.stringify(words.slice(index, index + WORDS_PER_RUN))]
      : [],
  );

const kindOf = (path: string): Kind =>
  DOC_SUFFIXES.some((suffix) => path.endsWith(suffix)) ? "docs" : "code";

const runsForKind = (files: readonly FileWords[], kind: Kind): readonly string[] =>
  files.filter((file) => kindOf(file.path) === kind).flatMap((file) => wordRuns(file.words));

const ratio = (runs: number, total: number): Ratio => ({ numerator: runs, denominator: total });

const measureKind = (synthesis: RangeFiles, lanes: readonly LaneFiles[], kind: Kind): KindShare => {
  const synthesisRuns = runsForKind(synthesis.files, kind);
  const laneRuns = lanes.map((lane) => ({
    name: lane.name,
    runs: new Set(runsForKind(lane.files.files, kind)),
  }));
  const matches = synthesisRuns.map((run) =>
    laneRuns.filter((lane) => lane.runs.has(run)).map(({ name }) => name),
  );
  const totalRuns = synthesisRuns.length;
  const laneOnly = laneRuns.map(({ name }) => {
    const runs = matches.filter((matched) => matched.length === 1 && matched[0] === name).length;
    return { name, runs, share: ratio(runs, totalRuns) };
  });
  const sharedRuns = matches.filter((matched) => matched.length > 1).length;
  const neitherRuns = matches.filter((matched) => matched.length === 0).length;
  return {
    totalRuns,
    laneOnly,
    shared: { runs: sharedRuns, share: ratio(sharedRuns, totalRuns) },
    neither: { runs: neitherRuns, share: ratio(neitherRuns, totalRuns) },
  };
};

const sortLanes = (lanes: readonly LaneInput[]): readonly LaneInput[] =>
  lanes.toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

const rangeExclusions = (synthesis: RangeFiles, lanes: readonly LaneFiles[]) => ({
  synthesis: synthesis.exclusions,
  lanes: lanes.map(({ name, files }) => ({ name, files: files.exclusions })),
});

const rangeBinaries = (synthesis: RangeFiles, lanes: readonly LaneFiles[]) => ({
  synthesis: synthesis.binaryPaths,
  lanes: lanes.map(({ name, files }) => ({ name, files: files.binaryPaths })),
});

const buildReport = (repo: string, inputs: Inputs): Report => {
  const base = resolveCommit(repo, inputs.base, "--base");
  const synthesisHead = resolveCommit(repo, inputs.synthesis, "--synthesis");
  const oracle = inputs.oracle ? resolveCommit(repo, inputs.oracle, "--oracle") : null;
  const lanes = sortLanes(
    inputs.lanes.map(({ name, commit }) => ({
      name,
      commit: resolveCommit(repo, commit, `lane '${name}'`),
    })),
  );
  isAncestor(repo, base, synthesisHead, "synthesis");
  lanes.forEach(({ name, commit }) => isAncestor(repo, base, commit, `lane '${name}'`));
  if (oracle !== null) isAncestor(repo, base, oracle, "oracle");
  const merges = gitText(repo, ["rev-list", "--merges", `${base}..${synthesisHead}`]).trim();
  if (merges.length > 0) {
    fail(`synthesis range contains merge commit(s): ${merges.split("\n").join(", ")}`);
  }

  const oracleTouched = oracle ? oraclePaths(repo, oracle) : [];
  const synthesis = collectRange(repo, base, synthesisHead, oracleTouched);
  const laneFiles = lanes.map(({ name, commit }) => ({
    name,
    head: commit,
    files: collectRange(repo, base, commit, oracleTouched),
  }));
  const kinds = {
    code: measureKind(synthesis, laneFiles, "code"),
    docs: measureKind(synthesis, laneFiles, "docs"),
  };
  return {
    schema: "postmaster.synthesis-shares.v1",
    base,
    synthesis: { base, head: synthesisHead },
    oracle,
    lanes: lanes.map(({ name, commit }) => ({ name, head: commit })),
    algorithm: {
      wordsPerRun: WORDS_PER_RUN,
      splitOn: "whitespace",
      match: "exact case and punctuation",
      countedUnit: "added-line six-word run occurrence",
    },
    exclusions: {
      oraclePaths: oracleTouched,
      byRange: rangeExclusions(synthesis, laneFiles),
      binaryPaths: rangeBinaries(synthesis, laneFiles),
    },
    kinds,
  };
};

const formatRatio = ({ numerator, denominator }: Ratio): string =>
  denominator === 0 ? "n/a" : `${numerator}/${denominator}`;

const formatKind = (kind: Kind, shares: KindShare): string =>
  [
    `${kind} runs=${shares.totalRuns}`,
    ...shares.laneOnly.map(({ name, share }) => `lane:${name}=${formatRatio(share)}`),
    `shared=${formatRatio(shares.shared.share)}`,
    `neither=${formatRatio(shares.neither.share)}`,
  ].join(" ");

const sharesLine = (report: Report): string =>
  `SHARES: ${formatKind("code", report.kinds.code)} | ${formatKind("docs", report.kinds.docs)}`;

const writeRecord = (dispatch: string, report: Report): void => {
  const directory = resolve(dispatch);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    fail(`record directory does not exist: ${directory}`);
  }
  const path = join(directory, "shares.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
};

const main = (): number => {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  try {
    const root = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const parsed = parseInputs(args);
    const normalized = {
      ...parsed,
      synthesis:
        parsed.synthesis === ""
          ? gitText(process.cwd(), ["rev-parse", "HEAD"]).trim()
          : parsed.synthesis,
      record:
        parsed.record && (isAbsolute(parsed.record) ? parsed.record : resolve(root, parsed.record)),
    };
    const report = buildReport(root, normalized);
    const line = sharesLine(report);
    if (normalized.record !== null) writeRecord(normalized.record, report);
    console.log(line);
    if (normalized.record !== null) {
      const logged = run(join(scriptsDir(import.meta), "run"), [
        "run-log",
        normalized.record,
        line,
      ]);
      if (logged.code !== 0) {
        process.stderr.write(
          `synthesis-shares: the SHARES line was not recorded in the run log: ${logged.err.trim()}\n`,
        );
        return 1;
      }
    }
    return 0;
  } catch (error) {
    console.error(`synthesis-shares: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

// The process exit status is a CLI edge effect; measurement functions above remain pure.
process.exit(main());
