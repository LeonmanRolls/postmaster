import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Lane = Readonly<{ name: string; head: string }>;
type Output = Readonly<{ stdout: string; stderr: string; code: number }>;
type Report = Readonly<{
  schema: string;
  base: string;
  synthesis: Readonly<{ base: string; head: string }>;
  oracle: string | null;
  lanes: readonly Lane[];
  algorithm: Readonly<{ wordsPerRun: number }>;
  exclusions: Readonly<{
    oraclePaths: readonly string[];
    byRange: Readonly<{
      synthesis: readonly Readonly<{ path: string; reason: string }>[];
    }>;
  }>;
  kinds: Readonly<Record<string, KindReport>>;
}>;
type KindReport = Readonly<{
  totalRuns: number;
  laneOnly: readonly Readonly<{ name: string; runs: number; share: Ratio }>[];
  shared: Readonly<{ runs: number; share: Ratio }>;
  neither: Readonly<{ runs: number; share: Ratio }>;
}>;
type Ratio = Readonly<{ numerator: number; denominator: number }>;
type ScenarioOutput = Readonly<{ line: string; report: Report; recordPath: string }>;

const SCRIPT = fileURLToPath(new URL("./synthesis-shares.ts", import.meta.url));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMP_ROOT = join(REPO_ROOT, "node_modules", ".cache");
const IDENTITY = [
  "-c",
  "user.name=brindlewick",
  "-c",
  "user.email=332054101+brindlewick@users.noreply.github.com",
];

const git = (directory: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(
    ["git", ...IDENTITY, "-c", "core.hooksPath=/dev/null", "-C", directory, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  return result.exitCode === 0
    ? stdout.trim()
    : (() => {
        throw new Error(stderr || `git ${args.join(" ")} exited ${result.exitCode}`);
      })();
};

const initializeRepo = (directory: string): string => {
  git(directory, ["init", "--quiet", "--initial-branch=main"]);
  git(directory, ["config", "user.name", "brindlewick"]);
  git(directory, ["config", "user.email", "332054101+brindlewick@users.noreply.github.com"]);
  git(directory, ["config", "core.hooksPath", "/dev/null"]);
  git(directory, ["commit", "--quiet", "--allow-empty", "-m", "fixture base"]);
  return git(directory, ["rev-parse", "HEAD"]);
};

const writeFiles = (directory: string, files: Readonly<Record<string, string>>): void =>
  Object.entries(files).forEach(([path, contents]) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  });

const commitFiles = (
  directory: string,
  parent: string,
  message: string,
  files: Readonly<Record<string, string>>,
): string => {
  git(directory, ["checkout", "--quiet", "--detach", parent]);
  writeFiles(directory, files);
  git(directory, ["add", "--all"]);
  git(directory, ["commit", "--quiet", "-m", message]);
  return git(directory, ["rev-parse", "HEAD"]);
};

const renameWithAddedText = (
  directory: string,
  parent: string,
  message: string,
  phrase: string,
  from: string = "old.ts",
  to: string = "renamed.ts",
): string => {
  git(directory, ["checkout", "--quiet", "--detach", parent]);
  git(directory, ["mv", from, to]);
  const target = join(directory, to);
  writeFileSync(target, `${readFileSync(target, "utf8")}${phrase}\n`, "utf8");
  git(directory, ["add", "--all"]);
  git(directory, ["commit", "--quiet", "-m", message]);
  return git(directory, ["rev-parse", "HEAD"]);
};

const makeWorkspace = (): string => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEMP_ROOT, "synthesis-shares-"));
};

const runScript = (
  directory: string,
  base: string,
  synthesis: string,
  lanes: readonly Lane[],
  oracle: string | null = null,
): Output => {
  const dispatch = join(directory, ".postmaster", "runs", "fixture");
  mkdirSync(dispatch, { recursive: true });
  const args = [
    process.execPath,
    "--no-env-file",
    "--config=/dev/null",
    SCRIPT,
    "--base",
    base,
    "--synthesis",
    synthesis,
    ...lanes.flatMap(({ name, head }) => ["--lane", `${name}=${head}`]),
    ...(oracle ? ["--oracle", oracle] : []),
    "--record",
    dispatch,
  ];
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    code: result.exitCode,
  };
};

const runScenario = (
  directory: string,
  base: string,
  synthesis: string,
  lanes: readonly Lane[],
  oracle: string | null = null,
): ScenarioOutput => {
  const output = runScript(directory, base, synthesis, lanes, oracle);
  if (output.code !== 0) throw new Error(output.stderr);
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
  const recordPath = join(directory, ".postmaster", "runs", "fixture", "shares.json");
  return {
    line: output.stdout.trim(),
    report: JSON.parse(readFileSync(recordPath, "utf8")) as Report,
    recordPath,
  };
};

const ratio = (numerator: number, denominator: number): Ratio => ({ numerator, denominator });
const laneShare = (name: string, runs: number, denominator: number) => ({
  name,
  runs,
  share: ratio(runs, denominator),
});
const bucket = (runs: number, denominator: number) => ({ runs, share: ratio(runs, denominator) });
const expectedKind = (
  totalRuns: number,
  laneOnly: readonly ReturnType<typeof laneShare>[],
  sharedRuns: number,
  neitherRuns: number,
): KindReport => ({
  totalRuns,
  laneOnly,
  shared: bucket(sharedRuns, totalRuns),
  neither: bucket(neitherRuns, totalRuns),
});

const withWorkspace = (run: (directory: string) => void): void => {
  const directory = makeWorkspace();
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("a synthesis taken wholly from one lane is read back exactly", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const phrase = "violet maple harbor candle swift planet";
    const alpha = commitFiles(directory, base, "alpha work", { "feature.ts": `${phrase}\n` });
    const beta = commitFiles(directory, base, "beta work", {
      "other.ts": "copper field quiet winter circle branch\n",
    });
    const synthesis = commitFiles(directory, base, "synthesis", { "feature.ts": `${phrase}\n` });
    const result = runScenario(directory, base, synthesis, [
      { name: "beta", head: beta },
      { name: "alpha", head: alpha },
    ]);

    expect(result.line).toBe(
      "SHARES: code runs=1 lane:alpha=1/1 lane:beta=0/1 shared=0/1 neither=0/1 | docs runs=0 lane:alpha=n/a lane:beta=n/a shared=n/a neither=n/a",
    );
    expect(result.report.kinds.code).toEqual(
      expectedKind(1, [laneShare("alpha", 1, 1), laneShare("beta", 0, 1)], 0, 0),
    );
    expect(result.report.kinds.docs).toEqual(
      expectedKind(0, [laneShare("alpha", 0, 0), laneShare("beta", 0, 0)], 0, 0),
    );
    expect(result.report.algorithm.wordsPerRun).toBe(6);
  }));

test("a synthesis split between both lanes is counted by lane and file kind", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const codeText = "amber branch meadow silver comet maple";
    const docsText = "quiet harbor lantern velvet canyon orbit";
    const alpha = commitFiles(directory, base, "alpha work", { "alpha.ts": `${codeText}\n` });
    const beta = commitFiles(directory, base, "beta work", { "beta.md": `${docsText}\n` });
    const synthesis = commitFiles(directory, base, "synthesis", {
      "alpha.ts": `${codeText}\n`,
      "beta.md": `${docsText}\n`,
    });
    const result = runScenario(directory, base, synthesis, [
      { name: "alpha", head: alpha },
      { name: "beta", head: beta },
    ]);

    expect(result.line).toBe(
      "SHARES: code runs=1 lane:alpha=1/1 lane:beta=0/1 shared=0/1 neither=0/1 | docs runs=1 lane:alpha=0/1 lane:beta=1/1 shared=0/1 neither=0/1",
    );
    expect(result.report.kinds.code).toEqual(
      expectedKind(1, [laneShare("alpha", 1, 1), laneShare("beta", 0, 1)], 0, 0),
    );
    expect(result.report.kinds.docs).toEqual(
      expectedKind(1, [laneShare("alpha", 0, 1), laneShare("beta", 1, 1)], 0, 0),
    );
  }));

test("identical text in both lanes is shared", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const phrase = "silver forest ember valley river meadow";
    const alpha = commitFiles(directory, base, "alpha work", { "shared.ts": `${phrase}\n` });
    const beta = commitFiles(directory, base, "beta work", { "shared.ts": `${phrase}\n` });
    const synthesis = commitFiles(directory, base, "synthesis", { "shared.ts": `${phrase}\n` });
    const result = runScenario(directory, base, synthesis, [
      { name: "alpha", head: alpha },
      { name: "beta", head: beta },
    ]);

    expect(result.report.kinds.code).toEqual(
      expectedKind(1, [laneShare("alpha", 0, 1), laneShare("beta", 0, 1)], 1, 0),
    );
    expect(result.line).toBe(
      "SHARES: code runs=1 lane:alpha=0/1 lane:beta=0/1 shared=1/1 neither=0/1 | docs runs=0 lane:alpha=n/a lane:beta=n/a shared=n/a neither=n/a",
    );
  }));

test("text written by the coachman alone is attributed to neither lane", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const alpha = commitFiles(directory, base, "alpha work", {
      "alpha.ts": "bright copper river sleeps beyond quiet mountains\n",
    });
    const beta = commitFiles(directory, base, "beta work", {
      "beta.ts": "gentle silver clouds drift across open fields\n",
    });
    const synthesis = commitFiles(directory, base, "synthesis", {
      "coachman.md": "velvet lantern dances under midnight winter\n",
    });
    const result = runScenario(directory, base, synthesis, [
      { name: "alpha", head: alpha },
      { name: "beta", head: beta },
    ]);

    expect(result.report.kinds.docs).toEqual(
      expectedKind(1, [laneShare("alpha", 0, 1), laneShare("beta", 0, 1)], 0, 1),
    );
    expect(result.line).toBe(
      "SHARES: code runs=0 lane:alpha=n/a lane:beta=n/a shared=n/a neither=n/a | docs runs=1 lane:alpha=0/1 lane:beta=0/1 shared=0/1 neither=1/1",
    );
  }));

test("oracle, lane records, lockfiles, and generated paths are excluded exactly", () =>
  withWorkspace((directory) => {
    const emptyBase = initializeRepo(directory);
    const base = commitFiles(directory, emptyBase, "base file", {
      "lib.ts": "first base line content here\n",
    });
    const oracle = commitFiles(directory, base, "oracle fixture", {
      "oracle-answer.ts": "orchid comet valley bronze window spring\n",
      "lib.ts": "first base line content here\noracle appended helper line here\n",
    });
    const changed = {
      ".gitattributes": "generated.ts generated\nlinguist.ts linguist-generated\n",
      "kept.ts": "bright copper river sleeps beyond quiet\n",
      "lib.ts": "first base line content here\nlane appended feature line here\n",
      "oracle-answer.ts": "orchid comet valley bronze window spring\n",
      "WORKHORSE-SUMMARY.md": "amber forest quiet river candle comet\n",
      "WORKHORSE-BLOCKED.md": "silver meadow winter planet harbor velvet\n",
      "nested/WORKHORSE-SUMMARY.md": "nested spec words count here today\n",
      "acceptance-probe.ts": "acceptance probe words count here today\n",
      "bun.lock": "lockfile orchid comet valley bronze window\n",
      "uv.lock": "uv lock orchid comet valley bronze\n",
      "generated.ts": "velvet lantern dances under midnight winter\n",
      "linguist.ts": "quiet harbor lantern velvet canyon orbit\n",
    };
    const alpha = commitFiles(directory, base, "alpha work", changed);
    const synthesis = commitFiles(directory, base, "synthesis", changed);
    const result = runScenario(
      directory,
      base,
      synthesis,
      [
        { name: "alpha", head: alpha },
        { name: "beta", head: base },
      ],
      oracle,
    );

    expect(result.report.kinds.code).toEqual(
      expectedKind(1, [laneShare("alpha", 1, 1), laneShare("beta", 0, 1)], 0, 0),
    );
    expect(result.report.kinds.docs.totalRuns).toBe(0);
    expect([...result.report.exclusions.oraclePaths].toSorted()).toEqual([
      "lib.ts",
      "oracle-answer.ts",
    ]);
    expect(result.report.exclusions.byRange.synthesis.map(({ path }) => path).toSorted()).toEqual([
      "WORKHORSE-BLOCKED.md",
      "WORKHORSE-SUMMARY.md",
      "acceptance-probe.ts",
      "bun.lock",
      "generated.ts",
      "lib.ts",
      "linguist.ts",
      "nested/WORKHORSE-SUMMARY.md",
      "oracle-answer.ts",
      "uv.lock",
    ]);
  }));

test("three lanes are counted by name, with any overlap grouped as shared", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const sharedText = "silver forest ember valley river meadow";
    const gammaText = "quiet harbor lantern velvet canyon orbit";
    const alpha = commitFiles(directory, base, "alpha work", { "shared.ts": `${sharedText}\n` });
    const beta = commitFiles(directory, base, "beta work", { "shared.ts": `${sharedText}\n` });
    const gamma = commitFiles(directory, base, "gamma work", { "gamma.ts": `${gammaText}\n` });
    const synthesis = commitFiles(directory, base, "synthesis", {
      "shared.ts": `${sharedText}\n`,
      "gamma.ts": `${gammaText}\n`,
    });
    const result = runScenario(directory, base, synthesis, [
      { name: "gamma", head: gamma },
      { name: "beta", head: beta },
      { name: "alpha", head: alpha },
    ]);

    expect(result.report.kinds.code).toEqual(
      expectedKind(
        2,
        [laneShare("alpha", 0, 2), laneShare("beta", 0, 2), laneShare("gamma", 1, 2)],
        1,
        0,
      ),
    );
    expect(result.report.lanes).toEqual([
      { name: "alpha", head: alpha },
      { name: "beta", head: beta },
      { name: "gamma", head: gamma },
    ]);
  }));

test("a rename contributes only its changed added lines", () =>
  withWorkspace((directory) => {
    const initial = initializeRepo(directory);
    const base = commitFiles(directory, initial, "base file", {
      "old.ts":
        "baseline words remain in their original file across this rename with enough unchanged content to detect it\n",
    });
    const phrase = "quiet harbor lantern velvet canyon orbit";
    const alpha = renameWithAddedText(directory, base, "alpha rename", phrase);
    const synthesis = renameWithAddedText(directory, base, "synthesis rename", phrase);
    const result = runScenario(directory, base, synthesis, [
      { name: "alpha", head: alpha },
      { name: "beta", head: base },
    ]);

    expect(result.report.kinds.code).toEqual(
      expectedKind(1, [laneShare("alpha", 1, 1), laneShare("beta", 0, 1)], 0, 0),
    );
  }));

test("a rename of an oracle-touched file stays excluded", () =>
  withWorkspace((directory) => {
    const emptyBase = initializeRepo(directory);
    const base = commitFiles(directory, emptyBase, "base file", {
      "lib.ts":
        "alpha beta gamma delta epsilon zeta eta theta\none two three four five six seven eight\nred green blue yellow purple orange pink gray\n",
    });
    const oracle = commitFiles(directory, base, "oracle fixture", {
      "lib.ts":
        "alpha beta gamma delta epsilon zeta eta theta\none two three four five six seven eight\nred green blue yellow purple orange pink gray\noracle hidden helper words alpha beta\n",
    });
    const synthesis = renameWithAddedText(
      directory,
      base,
      "synthesis rename",
      "synthesis edit line here today now",
      "lib.ts",
      "util.ts",
    );
    const result = runScenario(directory, base, synthesis, [{ name: "alpha", head: base }], oracle);

    expect(result.report.kinds.code.totalRuns).toBe(0);
    expect(result.report.exclusions.byRange.synthesis).toEqual([
      { path: "util.ts", reason: "touched by the oracle commit" },
    ]);
  }));

test("a merge in the synthesis range is refused", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const side = commitFiles(directory, base, "side work", {
      "side.ts": "side words for the merge commit fixture\n",
    });
    const main = commitFiles(directory, base, "main work", {
      "main.ts": "main words for the merge commit fixture\n",
    });
    git(directory, ["checkout", "--quiet", "--detach", main]);
    git(directory, ["merge", "--quiet", "--no-ff", "-m", "merge side", side]);
    const merged = git(directory, ["rev-parse", "HEAD"]);
    const output = runScript(directory, base, merged, [{ name: "alpha", head: side }]);

    expect(output.code).not.toBe(0);
    expect(output.stderr).toContain("merge");
  }));

test("the record pins commits and is written once", () =>
  withWorkspace((directory) => {
    const base = initializeRepo(directory);
    const phrase = "maple orchard river silver candle meadow";
    const alpha = commitFiles(directory, base, "alpha work", { "file.ts": `${phrase}\n` });
    const synthesis = commitFiles(directory, base, "synthesis", { "file.ts": `${phrase}\n` });
    const result = runScenario(directory, base, synthesis, [{ name: "alpha", head: alpha }]);
    const original = readFileSync(result.recordPath, "utf8");
    const second = runScript(directory, base, synthesis, [{ name: "alpha", head: alpha }]);

    expect(result.report.schema).toBe("postmaster.synthesis-shares.v1");
    expect(result.report.base).toBe(base);
    expect(result.report.synthesis).toEqual({ base, head: synthesis });
    expect(result.report.lanes).toEqual([{ name: "alpha", head: alpha }]);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("EEXIST");
    expect(readFileSync(result.recordPath, "utf8")).toBe(original);
  }));
