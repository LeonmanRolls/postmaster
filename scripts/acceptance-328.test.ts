// Oracle for #328, committed before the change: the upkeep pass corrects stale
// claims inside the verifiers' folders only, commits its corrections on a branch
// of its own, and they land by the project's own route once the user says so; a
// clean pass proposes only the index's new confirmation commit. Pins only what
// runs without a model: the correcting pass behind a stub session, the landing
// of planted pass branches, the index confirmation rule, both pass-prompt
// renderings, and the usage exits. A live correcting pass over the trial app
// stays hand-verified and out of this file: the correcting instructions ran once
// by hand during implementation, and the artifacts with their comparison sit in
// the run record. Every case drives git or scripts/run as a subprocess.
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, writeRepoFile } from "./acceptance-323.ts";
import { makeSandbox, RUN } from "./acceptance-318.ts";
import { upkeepCorrectPromptOrThrow, writeStubCorrectingSession } from "./acceptance-328.ts";
import type { Sandbox } from "./acceptance-344.ts";
import { makeEnv, summaryLine } from "./acceptance-344.ts";
import {
  bareOrigin,
  branchHasFile,
  cleanup,
  cleanupTemplate,
  freshApp,
  headOf,
  HELPER_GOOD,
  makeDispatch,
  parentsOf,
  plantBranch,
  PR_URL,
  readActions,
  stubGh,
  verifierFiles,
  withBinOnPath,
} from "./acceptance-325.ts";
import { run, type RunResult } from "./lib/proc.ts";

afterAll(() => {
  cleanupTemplate();
});

/** Assert a driven command's exit code, quoting its output when it differs. */
function expectCode(r: RunResult, code: number): void {
  if (r.code !== code) {
    throw new Error(`exited ${r.code}, expected ${code}: ${(r.err || r.out).trim()}`);
  }
}

const OLD_USAGE =
  'stderr is "usage: todo add <text> | todo list | todo done <id>" and the exit code is 2';
const NEW_USAGE =
  'stderr is "usage: todo add <text> | todo list | todo done <id> | todo remove <id>..." ' +
  "and the exit code is 2";

const ADD = "verify-app/features/add.md";
const LIST = "verify-app/features/list.md";
const DONE = "verify-app/features/done.md";
const USAGE_PAGE = "verify-app/features/usage.md";
const STORE = "verify-app/features/store.md";
const MAP = "verify-app/features/README.md";

/** The sandbox index before any pass: a Files: line, no confirmation yet. */
const MAP_HEAD = "# map\n\nAn index of the features.\n\nFiles: README.md\n";

/** The index after a pass drove head: the confirmation beside the Files:. */
function mapWith(head: string): string {
  return `${MAP_HEAD}Confirmed: ${head}\n`;
}

/** A corrected feature page: the sandbox page plus the correction. */
const CORRECTED_PAGE =
  "# feature\n\nA recipe with stated results.\n\nCorrected to what the app does.\n";

/** One stale claim the pass corrected, in report order. */
function correctedClaim(
  name: string,
  page: string,
  stated: string,
  found: string,
  change: string,
): string {
  return [
    `## Claim: ${name}`,
    `Page: ${page}`,
    "Verdict: stale",
    `Stated: ${stated}`,
    `Found: ${found}`,
    `Corrected: ${change}`,
    "",
  ].join("\n");
}

/** One stale claim the pass left alone, in report order. */
function staleClaim(name: string, page: string, stated: string, found: string): string {
  return [
    `## Claim: ${name}`,
    `Page: ${page}`,
    "Verdict: stale",
    `Stated: ${stated}`,
    `Found: ${found}`,
    "",
  ].join("\n");
}

/** One clean feature section, in report order. */
function cleanFeature(page: string): string {
  return [`## Feature: ${page}`, "Outcome: clean", ""].join("\n");
}

/** A pass over five pages with two stale claims, both corrected. */
const REPORT_CORRECTED = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  cleanFeature(ADD).trimEnd(),
  "",
  `## Feature: ${LIST}`,
  "Outcome: changed",
  "",
  correctedClaim(
    "list: an argument is a usage error",
    LIST,
    OLD_USAGE,
    NEW_USAGE,
    "reworded the usage line on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  `## Feature: ${DONE}`,
  "Outcome: changed",
  "",
  correctedClaim(
    "done: mark",
    DONE,
    "list after holds one task with id 1, text buy milk and done true",
    "list after holds the task and a lastId of 1",
    "reworded the stored row on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  cleanFeature(USAGE_PAGE).trimEnd(),
  "",
  cleanFeature(STORE).trimEnd(),
  "",
].join("\n");

/** The negative control: every feature driven, nothing stale, nothing unchecked. */
const REPORT_CLEAN = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  ...[ADD, LIST, DONE, USAGE_PAGE, STORE].flatMap((page) => [
    `## Feature: ${page}`,
    "Outcome: clean",
    "",
  ]),
].join("\n");

/** One claim corrected and one the project broke, so the pass left it alone. */
const REPORT_PARTIAL = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  cleanFeature(ADD).trimEnd(),
  "",
  `## Feature: ${LIST}`,
  "Outcome: changed",
  "",
  staleClaim(
    "list: an argument is a usage error",
    LIST,
    OLD_USAGE,
    "the app exits 3 with no output at all: todo list is broken",
  ).trimEnd(),
  "",
  `## Feature: ${DONE}`,
  "Outcome: changed",
  "",
  correctedClaim(
    "done: mark",
    DONE,
    "list after holds one task with id 1, text buy milk and done true",
    "list after holds the task and a lastId of 1",
    "reworded the stored row on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  cleanFeature(USAGE_PAGE).trimEnd(),
  "",
  cleanFeature(STORE).trimEnd(),
  "",
].join("\n");

/** Nothing stale, but one claim the pass could not check. */
const REPORT_UNCHECKED = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  cleanFeature(ADD).trimEnd(),
  "",
  cleanFeature(LIST).trimEnd(),
  "",
  cleanFeature(DONE).trimEnd(),
  "",
  `## Feature: ${USAGE_PAGE}`,
  "Outcome: blocked",
  "",
  "## Claim: usage: --help",
  `Page: ${USAGE_PAGE}`,
  "Verdict: unchecked",
  "Stated: --help is an unknown word and gives exit 2",
  "Because: the helper is missing: control-todo run is not on PATH",
  "",
  cleanFeature(STORE).trimEnd(),
  "",
].join("\n");

/** An unchecked claim carrying a correction, which no pass can prove. */
const REPORT_BAD_CORRECTION = REPORT_UNCHECKED.replace(
  "Because: the helper is missing: control-todo run is not on PATH\n",
  "Because: the helper is missing: control-todo run is not on PATH\nCorrected: reinstalled the helper\n",
);

/** A pass over two verifiers under one shared index, one claim corrected. */
const REPORT_MULTI = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verifier/cli",
  "",
  "## Verifier: web",
  "Folder: verifier/web",
  "",
  "## Feature: verifier/cli/features/add.md",
  "Outcome: changed",
  "",
  correctedClaim(
    "add: one task",
    "verifier/cli/features/add.md",
    "stdout is added 1",
    "stdout is added 2",
    "reworded the id on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  "## Feature: verifier/cli/features/list.md",
  "Outcome: clean",
  "",
  "## Feature: verifier/web/features/home.md",
  "Outcome: clean",
  "",
].join("\n");

/** Write the pass's report into the sandbox and return its path. */
function writeReport(dir: string, text: string): string {
  const path = join(dir, "UPKEEP.md");
  writeFileSync(path, text);
  return path;
}

/** A dir holding files the stub copies over the session worktree. */
function writeOverlay(dir: string, files: Record<string, string>): string {
  const overlay = join(dir, "overlay");
  for (const [rel, text] of Object.entries(files)) writeRepoFile(overlay, rel, text);
  return overlay;
}

/** Run the correcting pass the way the user starts it by hand. */
function runPass(
  sandbox: Sandbox,
  env: Record<string, string | undefined>,
  extra: string[] = [],
): RunResult {
  return run(
    RUN,
    [
      "verifier",
      "upkeep",
      sandbox.repo,
      "--run",
      sandbox.dispatch,
      "--timeout",
      "120",
      "--correct",
      ...extra,
    ],
    { env },
  );
}

/** A sandbox holding two verifiers under a shared index, one bullet each. */
function makeTwoVerifierSandbox(): Sandbox {
  const sandbox = makeSandbox("multi");
  writeRepoFile(
    sandbox.repo,
    "verifier/web/README.md",
    "# web verifier\n\nDrives the web pages.\n",
  );
  writeRepoFile(sandbox.repo, "verifier/web/features/README.md", "# map\n");
  writeRepoFile(sandbox.repo, "verifier/web/features/home.md", "# home\n\nA page.\n");
  const index = readFileSync(join(sandbox.repo, "verifier/README.md"), "utf8");
  writeRepoFile(
    sandbox.repo,
    "verifier/README.md",
    `${index}- the web pages (web) verifier goes in verifier/web/. Files: README.md\n`,
  );
  commitAll(sandbox.repo, "web verifier");
  return sandbox;
}

const APP_ADD = "verify-app/features/add.md";
const APP_MAP = "verify-app/features/README.md";

/** The scratch app with committed verifiers: the base a planted pass branch corrects. */
function appWithVerifiers(): { dir: string; repo: string } {
  const { dir, repo } = freshApp();
  for (const [rel, text] of Object.entries(verifierFiles("verify-app", HELPER_GOOD))) {
    writeRepoFile(repo, rel, text);
  }
  commitAll(repo, "verifiers");
  return { dir, repo };
}

/** The corrections a pass branch carries: one page reworded, the index confirmed. */
function appCorrections(repo: string): Record<string, string> {
  const head = headOf(repo, "main");
  return {
    [APP_ADD]: `${readFileSync(join(repo, APP_ADD), "utf8")}\nCorrected to what the app does.\n`,
    [APP_MAP]: `${readFileSync(join(repo, APP_MAP), "utf8")}Confirmed: ${head}\n`,
  };
}

/** A pass report over the scratch app's three pages, one claim corrected. */
const APP_REPORT = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  "## Feature: verify-app/features/add.md",
  "Outcome: changed",
  "",
  "## Claim: add: one task",
  "Page: verify-app/features/add.md",
  "Verdict: stale",
  "Stated: stdout is added 1",
  "Found: stdout is added 2",
  "Corrected: reworded the id on the page and drove the recipe again: holds",
  "",
  "## Feature: verify-app/features/done.md",
  "Outcome: clean",
  "",
  "## Feature: verify-app/features/list.md",
  "Outcome: clean",
  "",
].join("\n");

const APP_ACCEPT =
  "accept: upkeep lands upkeep corrections for cli (verify-app); " +
  "corrected: 1 of 1 stale, unchecked: 0";

function runCheckReport(
  repo: string,
  branch: string,
  dispatch: string,
  report: string,
  extra: string[] = [],
): RunResult {
  return run(RUN, [
    "verifier",
    "check",
    repo,
    branch,
    "--run",
    dispatch,
    "--report",
    report,
    ...extra,
  ]);
}

function runLandReport(
  repo: string,
  branch: string,
  dispatch: string,
  report: string,
  extra: string[] = [],
  env?: Record<string, string | undefined>,
): RunResult {
  return run(
    RUN,
    ["verifier", "land", repo, branch, "--run", dispatch, "--report", report, ...extra],
    env === undefined ? {} : { env },
  );
}

describe("C1: the correcting pass puts its corrections on a branch of its own", () => {
  test("a stub pass commits corrections and the index move, leaving the default branch alone", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, {
        [LIST]: CORRECTED_PAGE,
        [DONE]: CORRECTED_PAGE,
        [MAP]: mapWith(head),
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 0);
      expect(r.out).toContain("branch upkeep");
      expect(r.out).toContain("role coachman");
      expect(r.out).toContain(`stale: list: an argument is a usage error (${LIST})`);
      expect(r.out).toContain(`corrected: list: an argument is a usage error (${LIST})`);
      expect(r.out).toContain(`corrected: done: mark (${DONE})`);
      expect(r.out).toContain("corrections: 2 of 2 stale corrected");
      expect(r.out).toContain("every claim holds");
      expect(r.out).toContain("features driven: 5, stale: 2, unchecked: 0");
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      expect(readFileSync(promptFile, "utf8")).toMatch(/cannot ask anyone anything/iu);
      expect(headOf(sandbox.repo, "main")).toBe(before);
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep")
        .trim()
        .split("\n")
        .sort();
      expect(diff).toEqual([DONE, LIST, MAP].sort());
      expect(branchHasFile(sandbox.repo, "upkeep", "UPKEEP.md")).toBe(false);
      expect(gitOrThrow(sandbox.repo, "show", `upkeep:${MAP}`)).toContain(`Confirmed: ${head}`);
      const wt = summaryLine(r.out, "worktree");
      expect(wt).not.toBe("");
      expect(existsSync(join(wt, "UPKEEP.md"))).toBe(true);
      expect(gitOrThrow(wt, "status", "--porcelain", "UPKEEP.md").trim()).toBe("?? UPKEEP.md");
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("verifier-upkeep");
      expect(actions).toContain("corrections: 2 of 2 stale corrected");
      expect(actions).toContain("every claim holds");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("C5: the user starts the pass by hand at any time", () => {
  test("a second pass cuts its own branch and proposes again", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CLEAN);
      const overlay = writeOverlay(sandbox.dir, { [MAP]: mapWith(head) });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const first = runPass(sandbox, env);
      expectCode(first, 0);
      expect(first.out).toContain("branch upkeep");
      const second = runPass(sandbox, env);
      expectCode(second, 0);
      expect(second.out).toContain("branch upkeep-2");
      expect(second.out).toContain("every claim holds");
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep-2").trim();
      expect(diff).toBe(MAP);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("C4: a clean pass proposes only the index's new commit", () => {
  test("no failing claim listed, every claim holds, and the branch moves only the index", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CLEAN);
      const overlay = writeOverlay(sandbox.dir, { [MAP]: mapWith(head) });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 0);
      expect(r.out).toContain("every claim holds");
      expect(r.out).toContain("features driven: 5, stale: 0, unchecked: 0");
      expect(r.out).toContain("corrections: 0 of 0 stale corrected");
      const lines = r.out.split("\n");
      expect(lines.filter((l) => l.startsWith("stale:"))).toEqual([]);
      expect(lines.filter((l) => l.startsWith("unchecked:"))).toEqual([]);
      expect(lines.filter((l) => l.startsWith("corrected:"))).toEqual([]);
      expect(headOf(sandbox.repo, "main")).toBe(before);
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep").trim();
      expect(diff).toBe(MAP);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("the pass changes nothing outside the verifiers' folder", () => {
  test("a session that commits past the folder fails the pass naming the file", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, {
        [LIST]: CORRECTED_PAGE,
        [DONE]: CORRECTED_PAGE,
        [MAP]: mapWith(head),
        "notes.txt": "a scratch note at the top\n",
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
        ORACLE_ADD: "notes.txt",
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/outside/u);
      expect(r.err).toMatch(/notes\.txt/u);
      expect(headOf(sandbox.repo, "main")).toBe(before);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("a corrected claim carries its page's change", () => {
  test("a correction the branch never made fails the pass naming the page", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, { [MAP]: mapWith(head) });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/verify-app\/features\/list\.md/u);
      expect(r.out).not.toContain("every claim holds");
      expect(headOf(sandbox.repo, "main")).toBe(before);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a fix the session never committed fails the pass naming the file", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, {
        [LIST]: CORRECTED_PAGE,
        [DONE]: CORRECTED_PAGE,
        [MAP]: mapWith(head),
        "notes.txt": "a scratch note at the top\n",
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/notes\.txt/u);
      expect(r.out).not.toContain("every claim holds");
      expect(headOf(sandbox.repo, "main")).toBe(before);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("the pass moves the index to the commit it drove", () => {
  test("an index left on its old commit fails the pass naming the index", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      expect(head).not.toBe("");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, { [LIST]: CORRECTED_PAGE, [DONE]: CORRECTED_PAGE });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/names no confirmed commit/u);
      expect(r.err).toMatch(/verify-app\/features\/README\.md/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("an index naming another commit fails the pass naming the driven commit", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_CORRECTED);
      const overlay = writeOverlay(sandbox.dir, {
        [LIST]: CORRECTED_PAGE,
        [DONE]: CORRECTED_PAGE,
        [MAP]: mapWith("0".repeat(40)),
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toContain(`not the driven commit ${head}`);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("a pass that cannot correct everything", () => {
  test("uncorrected claims exit 1 with the partial corrections on the branch", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_PARTIAL);
      const overlay = writeOverlay(sandbox.dir, {
        [DONE]: CORRECTED_PAGE,
        [MAP]: mapWith(head),
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const before = headOf(sandbox.repo, "main");
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.out).toContain("corrections: 1 of 2 stale corrected");
      expect(r.out).not.toContain("every claim holds");
      expect(r.out).toContain(`stale: list: an argument is a usage error (${LIST})`);
      expect(r.out).toContain(`corrected: done: mark (${DONE})`);
      expect(r.out).not.toContain("corrected: list: an argument is a usage error");
      expect(headOf(sandbox.repo, "main")).toBe(before);
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep")
        .trim()
        .split("\n")
        .sort();
      expect(diff).toEqual([DONE, MAP].sort());
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("unchecked claims exit 1 while the index still moves", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_UNCHECKED);
      const overlay = writeOverlay(sandbox.dir, { [MAP]: mapWith(head) });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.out).toContain(`unchecked: usage: --help (${USAGE_PAGE})`);
      expect(r.out).not.toContain("every claim holds");
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep").trim();
      expect(diff).toBe(MAP);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a correction on an unchecked claim is refused", () => {
    const sandbox = makeSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_BAD_CORRECTION);
      const overlay = writeOverlay(sandbox.dir, { [MAP]: mapWith(head) });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/carries a correction/u);
      expect(r.err).toMatch(/usage: --help/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("each verifier is confirmed in the shared index", () => {
  test("one wrapped bullet and one single-line bullet both confirm", () => {
    const sandbox = makeTwoVerifierSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_MULTI);
      const overlay = writeOverlay(sandbox.dir, {
        "verifier/cli/features/add.md": CORRECTED_PAGE,
        "verifier/README.md":
          "- the command line (cli) verifier goes in verifier/cli/. Files: README.md\n" +
          `  Confirmed: ${head}\n` +
          `- the web pages (web) verifier goes in verifier/web/. Files: README.md. Confirmed: ${head}\n`,
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 0);
      expect(r.out).toContain("features driven: 3, stale: 1, unchecked: 0");
      expect(r.out).toContain("corrections: 1 of 1 stale corrected");
      expect(r.out).toContain("every claim holds");
      const diff = gitOrThrow(sandbox.repo, "diff", "--name-only", "main...upkeep")
        .trim()
        .split("\n")
        .sort();
      expect(diff).toEqual(["verifier/README.md", "verifier/cli/features/add.md"].sort());
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a verifier missing from the confirmation fails the pass naming its folder", () => {
    const sandbox = makeTwoVerifierSandbox();
    try {
      writeStubCorrectingSession(sandbox.bin);
      const head = headOf(sandbox.repo, "HEAD");
      const report = writeReport(sandbox.dir, REPORT_MULTI);
      const overlay = writeOverlay(sandbox.dir, {
        "verifier/cli/features/add.md": CORRECTED_PAGE,
        "verifier/README.md":
          `- the command line (cli) verifier goes in verifier/cli/. Files: README.md. Confirmed: ${head}\n` +
          "- the web pages (web) verifier goes in verifier/web/. Files: README.md\n",
      });
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runPass(sandbox, env);
      expectCode(r, 1);
      expect(r.err).toMatch(/names no confirmed commit/u);
      expect(r.err).toMatch(/verifier\/web/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("C3: the landing refuses a pass branch that reaches outside the folder", () => {
  const cases: Array<{ file: string; change: (text: string) => string }> = [
    { file: "AGENTS.md", change: (t) => `${t}\nExtra line.\n` },
    {
      file: "biome.json",
      change: (t) => t.replace('"indentWidth": 2', '"indentWidth": 4'),
    },
    { file: "src/cli.ts", change: (t) => `${t}\n// scratch\n` },
  ];

  for (const { file, change } of cases) {
    test(`a pass branch changing ${file} is refused, naming it`, () => {
      const { dir, repo } = appWithVerifiers();
      try {
        const report = writeReport(dir, APP_REPORT);
        const dispatch = makeDispatch(dir, "postmaster");
        const mainHead = headOf(repo, "main");
        const before = readFileSync(join(repo, file), "utf8");
        const after = change(before);
        expect(after).not.toBe(before);
        plantBranch(
          repo,
          "upkeep",
          { ...appCorrections(repo), [file]: after },
          `corrections plus ${file}`,
        );
        const r = runCheckReport(repo, "upkeep", dispatch, report);
        expect(r.code).toBe(1);
        expect(r.out).toBe(
          `refuse: upkeep lands nothing: outside the verifiers' folder: ${file}\n`,
        );
        expect(headOf(repo, "main")).toBe(mainHead);
      } finally {
        cleanup(dir);
      }
    });
  }

  test("a pass branch touching only the folder, gate green, is accepted", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const r = runCheckReport(repo, "upkeep", dispatch, report);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`${APP_ACCEPT}\n`);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.action).toBe("note");
      expect(actions[0]?.target).toBe("upkeep");
      expect(actions[0]?.detail).toBe(APP_ACCEPT);
    } finally {
      cleanup(dir);
    }
  });
});

const SHARED_ADD = "verifier/cli/features/add.md";
const SHARED_INDEX = "verifier/README.md";

/** The scratch app with a shared-shape verifier only: no verify-app folder. */
function appWithSharedVerifier(): { dir: string; repo: string } {
  const { dir, repo } = freshApp();
  for (const [rel, text] of Object.entries(verifierFiles("verifier/cli", HELPER_GOOD))) {
    writeRepoFile(repo, rel, text);
  }
  writeRepoFile(
    repo,
    SHARED_INDEX,
    "# verifiers\n\n- the command line (cli) verifier goes in verifier/cli/. Files: README.md\n",
  );
  commitAll(repo, "verifiers");
  return { dir, repo };
}

/** The corrections a shared-shape pass branch carries: one page, the index. */
function sharedCorrections(repo: string): Record<string, string> {
  const head = headOf(repo, "main");
  return {
    [SHARED_ADD]: `${readFileSync(join(repo, SHARED_ADD), "utf8")}\nCorrected to what the app does.\n`,
    [SHARED_INDEX]: `${readFileSync(join(repo, SHARED_INDEX), "utf8")} Confirmed: ${head}\n`,
  };
}

/** A pass report over the shared-shape verifier, one claim corrected. */
const SHARED_REPORT = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verifier/cli",
  "",
  `## Feature: ${SHARED_ADD}`,
  "Outcome: changed",
  "",
  correctedClaim(
    "add: one task",
    SHARED_ADD,
    "stdout is added 1",
    "stdout is added 2",
    "reworded the id on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  "## Feature: verifier/cli/features/done.md",
  "Outcome: clean",
  "",
  "## Feature: verifier/cli/features/list.md",
  "Outcome: clean",
  "",
].join("\n");

const SHARED_ACCEPT =
  "accept: upkeep lands upkeep corrections for cli (verifier/cli); " +
  "corrected: 1 of 1 stale, unchecked: 0";

/** A pass report over both shapes, one claim corrected on each. */
const BOTH_REPORT = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  "## Verifier: cli-shared",
  "Folder: verifier/cli",
  "",
  "## Feature: verify-app/features/add.md",
  "Outcome: changed",
  "",
  correctedClaim(
    "add: one task",
    "verify-app/features/add.md",
    "stdout is added 1",
    "stdout is added 2",
    "reworded the id on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  "## Feature: verify-app/features/done.md",
  "Outcome: clean",
  "",
  "## Feature: verify-app/features/list.md",
  "Outcome: clean",
  "",
  `## Feature: ${SHARED_ADD}`,
  "Outcome: changed",
  "",
  correctedClaim(
    "shared: one task",
    SHARED_ADD,
    "stdout is added 1",
    "stdout is added 2",
    "reworded the id on the page and drove the recipe again: holds",
  ).trimEnd(),
  "",
  "## Feature: verifier/cli/features/done.md",
  "Outcome: clean",
  "",
  "## Feature: verifier/cli/features/list.md",
  "Outcome: clean",
  "",
].join("\n");

const BOTH_ACCEPT =
  "accept: upkeep lands upkeep corrections for cli (verify-app), cli-shared (verifier/cli); " +
  "corrected: 2 of 2 stale, unchecked: 0";

describe("the landing judges every shape the repo holds", () => {
  test("a verifier/-only pass branch lands with no --folder", () => {
    const { dir, repo } = appWithSharedVerifier();
    try {
      const report = writeReport(dir, SHARED_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", sharedCorrections(repo), "corrections");
      const r = runCheckReport(repo, "upkeep", dispatch, report);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`${SHARED_ACCEPT}\n`);
    } finally {
      cleanup(dir);
    }
  });

  test("a both-shapes pass branch lands with no --folder", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      for (const [rel, text] of Object.entries(verifierFiles("verifier/cli", HELPER_GOOD))) {
        writeRepoFile(repo, rel, text);
      }
      writeRepoFile(
        repo,
        SHARED_INDEX,
        "# verifiers\n\n- the command line (cli) verifier goes in verifier/cli/. Files: README.md\n",
      );
      commitAll(repo, "shared verifier");
      const report = writeReport(dir, BOTH_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "upkeep",
        { ...appCorrections(repo), ...sharedCorrections(repo) },
        "corrections",
      );
      const r = runCheckReport(repo, "upkeep", dispatch, report);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`${BOTH_ACCEPT}\n`);
    } finally {
      cleanup(dir);
    }
  });

  test("an explicit --folder still narrows the landing to one shape", () => {
    const { dir, repo } = appWithSharedVerifier();
    try {
      const report = writeReport(dir, SHARED_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", sharedCorrections(repo), "corrections");
      const r = runCheckReport(repo, "upkeep", dispatch, report, ["--folder", "verify-app"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("refuse: upkeep lands nothing: outside the verifiers' folder: ");
      expect(r.out).toContain(SHARED_ADD);
      expect(r.out).toContain(SHARED_INDEX);
    } finally {
      cleanup(dir);
    }
  });

  test("project code under an absent shape refuses naming the file", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      writeRepoFile(repo, "verifier/src/code.ts", "export const code = 1;\n");
      commitAll(repo, "project code under verifier/");
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "upkeep",
        { ...appCorrections(repo), ["verifier/src/code.ts"]: "export const code = 2;\n" },
        "corrections plus project code",
      );
      const r = runCheckReport(repo, "upkeep", dispatch, report);
      expect(r.code).toBe(1);
      expect(r.out).toContain("refuse: upkeep lands nothing: outside the verifiers' folder: ");
      expect(r.out).toContain("verifier/src/code.ts");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C2: after the user's word the corrections land by the route", () => {
  test("without the word, land waits and the default branch stays", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "user");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const before = headOf(repo, "main");
      const r = runLandReport(repo, "upkeep", dispatch, report, ["--landing", "local"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(
        `${APP_ACCEPT}\nwaiting: upkeep is ready to merge into main; ` +
          "waiting for the user's word\n",
      );
      expect(headOf(repo, "main")).toBe(before);
      expect(gitOrThrow(repo, "show", `main:${APP_ADD}`)).not.toContain(
        "Corrected to what the app does",
      );
    } finally {
      cleanup(dir);
    }
  });

  test("on the word, land merges without fast-forwarding", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const before = headOf(repo, "main");
      const upkeepHead = headOf(repo, "upkeep");
      const r = runLandReport(repo, "upkeep", dispatch, report, ["--landing", "local"]);
      expect(r.code).toBe(0);
      expect(r.out.startsWith(`${APP_ACCEPT}\n`)).toBe(true);
      expect(r.out).toContain("merge: upkeep into main (");
      expect(parentsOf(repo, "main")).toEqual([before, upkeepHead]);
      expect(gitOrThrow(repo, "show", `main:${APP_ADD}`)).toContain(
        "Corrected to what the app does",
      );
    } finally {
      cleanup(dir);
    }
  });

  test("after landing, a second pass drives the corrected claims and holds", () => {
    const app = appWithVerifiers();
    // Physical first, as the pass sandboxes do: the tmp dir may itself be a
    // symlink (macOS /var), and the session's guard compares canonical paths.
    const dir = realpathSync(app.dir);
    const repo = join(dir, "app");
    try {
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const landed = runLandReport(repo, "upkeep", dispatch, report, ["--landing", "local"]);
      expectCode(landed, 0);
      expect(landed.out).toContain("merge: upkeep into main (");
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      writeStubCorrectingSession(bin);
      const passDispatch = join(dir, "pass-dispatch");
      mkdirSync(passDispatch, { recursive: true });
      writeFileSync(
        join(passDispatch, "run.json"),
        JSON.stringify({
          config: { team: { coachman: { harness: "claude", model: "stub-model" } } },
        }),
      );
      writeFileSync(
        join(passDispatch, "brief.md"),
        [
          "# Waybill: oracle",
          "",
          "## Dispatch",
          "name: #0, oracle",
          `synthesis worktree: ${repo}`,
          "",
        ].join("\n"),
      );
      const head = headOf(repo, "main");
      const clean = [
        "# Upkeep pass",
        "",
        "## Verifier: cli",
        "Folder: verify-app",
        "",
        "## Feature: verify-app/features/add.md",
        "Outcome: clean",
        "",
        "## Feature: verify-app/features/done.md",
        "Outcome: clean",
        "",
        "## Feature: verify-app/features/list.md",
        "Outcome: clean",
        "",
      ].join("\n");
      const second = writeReport(dir, clean);
      const map = readFileSync(join(repo, APP_MAP), "utf8").replace(
        /Confirmed: [0-9a-f]+\n?/u,
        `Confirmed: ${head}\n`,
      );
      expect(map).toContain(`Confirmed: ${head}`);
      const overlay = writeOverlay(dir, { [APP_MAP]: map });
      const env = makeEnv(
        { dir, repo, bin, dispatch: passDispatch },
        { POSTMASTER_HOST: "none", ORACLE_REPORT: second, ORACLE_OVERLAY: overlay },
      );
      const r = runPass({ dir, repo, bin, dispatch: passDispatch }, env);
      try {
        expectCode(r, 0);
      } catch (e) {
        const wt = join(dir, "app-upkeep");
        const listing = [dir, wt]
          .map((p) => {
            try {
              return `${p}:\n${readdirSync(p).join("\n")}`;
            } catch {
              return `${p}: (missing)`;
            }
          })
          .join("\n");
        let worktrees: string;
        try {
          worktrees = gitOrThrow(repo, "worktree", "list");
        } catch (e2) {
          worktrees = `git worktree list failed: ${(e2 as Error).message}`;
        }
        throw new Error(`${(e as Error).message}\n${listing}\n${worktrees}`);
      }
      expect(r.out).toContain("branch upkeep-2");
      expect(r.out).toContain("every claim holds");
      const diff = gitOrThrow(repo, "diff", "--name-only", "main...upkeep-2").trim();
      expect(diff).toBe(APP_MAP);
    } finally {
      cleanup(dir);
    }
  });

  test("with an origin, land pushes and opens one pull request, then waits for the word", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const bare = bareOrigin(dir);
      gitOrThrow(repo, "remote", "add", "origin", bare);
      const { bin, state } = stubGh(dir);
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const before = headOf(repo, "main");
      const r = runLandReport(repo, "upkeep", dispatch, report, [], withBinOnPath(bin));
      expect(r.code).toBe(0);
      expect(r.out).toBe(
        `${APP_ACCEPT}\npull-request: pushed upkeep to origin and opened ${PR_URL} against main; ` +
          "waiting for the user's word that it merged\n",
      );
      expect(headOf(repo, "main")).toBe(before);
      expect(headOf(bare, "upkeep")).toBe(headOf(repo, "upkeep"));
      const args = readFileSync(join(state, "args"), "utf8");
      for (const word of ["pr", "create", "--base", "main", "--head", "upkeep"]) {
        expect(args).toContain(word);
      }
      expect(args).toContain("Upkeep pass for app");
      expect(args).toContain(APP_ACCEPT);
      expect(readFileSync(join(state, "cwd"), "utf8").trim()).toBe(realpathSync(repo));
    } finally {
      cleanup(dir);
    }
  });
});

describe("upkeep-prompt --correct: the correcting instructions", () => {
  test("the interactive form corrects, proves, confirms and commits", () => {
    const sandbox = makeSandbox();
    try {
      const out = upkeepCorrectPromptOrThrow(sandbox.repo);
      expect(out).toMatch(/correct/iu);
      expect(out).toMatch(/never change the project's code/iu);
      expect(out).toMatch(/drive the recipe again/iu);
      expect(out).toMatch(/Corrected:/u);
      expect(out).toMatch(/Confirmed:/u);
      expect(out).toMatch(/commit/iu);
      expect(out).toMatch(/UPKEEP\.md/u);
      expect(out).toMatch(/health check/iu);
      expect(out).toMatch(/ask the user only what you cannot observe/iu);
      expect(out).toMatch(/name of the file that holds it/iu);
      expect(out).not.toMatch(/only reports/u);
      expect(out).not.toMatch(/never change the verifiers/u);
      expect(out).not.toContain("HANDOVER.md");
      expect(out).not.toContain("{{");
      expect(out).toContain(ADD);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("the headless form cannot ask, and hands over an unasked list", () => {
    const sandbox = makeSandbox();
    try {
      const out = upkeepCorrectPromptOrThrow(sandbox.repo, ["--headless"]);
      expect(out).toMatch(/cannot ask anyone anything/iu);
      expect(out).toMatch(/unasked/iu);
      expect(out).toMatch(/never invent a value/iu);
      expect(out).toMatch(/Corrected:/u);
      expect(out).toMatch(/Confirmed:/u);
      expect(out).toMatch(/drive the recipe again/iu);
      expect(out).toMatch(/UPKEEP\.md/u);
      expect(out).not.toContain("HANDOVER.md");
      expect(out).not.toContain("{{");
      expect(out).toContain(ADD);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a repo without verifiers exits 2", () => {
    const sandbox = makeSandbox();
    const bare = join(sandbox.dir, "bare");
    try {
      initRepo(bare);
      writeRepoFile(bare, "README.md", "# bare\n");
      commitAll(bare, "first");
      const r = run(RUN, ["verifier", "upkeep-prompt", bare, "--correct"]);
      expectCode(r, 2);
      expect(r.err).toMatch(/no verifiers/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("the stub guard canonicalizes both spellings", () => {
  test("a logical ORACLE_ROOT over a physical checkout passes", () => {
    // The macOS shape, reproducible anywhere with a symlink: the root
    // arrives through the link while the checkout resolves physical.
    const real = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-328-link-")));
    const logical = `${real}-link`;
    try {
      symlinkSync(real, logical);
      const bin = join(real, "bin");
      mkdirSync(bin, { recursive: true });
      writeStubCorrectingSession(bin);
      const report = join(real, "UPKEEP-src.md");
      writeFileSync(report, "# Upkeep pass\n");
      const wt = join(real, "wt");
      mkdirSync(wt, { recursive: true });
      const r = run(join(bin, "claude"), [], {
        cwd: wt,
        env: { ORACLE_ROOT: logical, ORACLE_REPORT: report },
      });
      expect(r.code).toBe(0);
      expect(readFileSync(join(wt, "UPKEEP.md"), "utf8")).toBe("# Upkeep pass\n");
    } finally {
      rmSync(logical, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  test("upkeep --correct without --run exits 2 and prints usage", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "upkeep", sandbox.repo, "--correct"]);
      expectCode(r, 2);
      expect(r.err).toMatch(/upkeep needs --run/u);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("check with both --handover and --report exits 2", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const handover = join(dir, "HANDOVER.md");
      writeFileSync(handover, "# Handover\n");
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      const r = run(RUN, [
        "verifier",
        "check",
        repo,
        "upkeep",
        "--run",
        dispatch,
        "--handover",
        handover,
        "--report",
        report,
      ]);
      expectCode(r, 2);
      expect(r.err).toMatch(/not both/u);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      cleanup(dir);
    }
  });

  test("check --report with a missing report file exits 2", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const r = runCheckReport(repo, "upkeep", dispatch, join(dir, "missing.md"));
      expectCode(r, 2);
      expect(r.err).toMatch(/no report to read/u);
    } finally {
      cleanup(dir);
    }
  });

  test("check --report with an empty report refuses naming the missing verifier", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const report = writeReport(dir, "# Upkeep pass\n\nNo sections.\n");
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "upkeep", appCorrections(repo), "corrections");
      const r = runCheckReport(repo, "upkeep", dispatch, report);
      expect(r.code).toBe(1);
      expect(r.out).toBe("refuse: upkeep lands nothing: the report names no verifier\n");
    } finally {
      cleanup(dir);
    }
  });

  test("upkeep-report rejects --correct", () => {
    const sandbox = makeSandbox();
    try {
      const report = writeReport(sandbox.dir, REPORT_CLEAN);
      const r = run(RUN, [
        "verifier",
        "upkeep-report",
        sandbox.repo,
        "--run",
        sandbox.dispatch,
        "--report",
        report,
        "--correct",
      ]);
      expectCode(r, 2);
      expect(r.err).toMatch(/unknown flag/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("land --report on the default branch exits 2", () => {
    const { dir, repo } = appWithVerifiers();
    try {
      const report = writeReport(dir, APP_REPORT);
      const dispatch = makeDispatch(dir, "postmaster");
      const r = runLandReport(repo, "main", dispatch, report);
      expectCode(r, 2);
      expect(r.err).toMatch(/needs a verifier branch/u);
    } finally {
      cleanup(dir);
    }
  });
});
