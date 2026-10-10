// Oracle for #318, committed before the change: an upkeep pass drives a project's
// verifiers again and lists each claim that no longer holds with what it found
// instead, each claim it could not check as unchecked, and records per verifier
// the project files its claims depend on. Pins only what runs without a model:
// the report verdict behind a stub session and a stub tmux, both pass-prompt
// renderings, the Files: recording rule, and the usage exits. A live pass over
// the trial app stays hand-verified and out of this file: the pass instructions
// ran once during implementation against the patched copy, and the report with
// its comparison against walk-after-remove.out sits in the run record. Every
// case drives git or scripts/run as a subprocess.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, initRepo, writeRepoFile } from "./acceptance-323.ts";
import {
  makeSandbox,
  RUN,
  upkeepPromptOrThrow,
  writeStubSession,
  writeStubTmux,
} from "./acceptance-318.ts";
import type { Sandbox } from "./acceptance-344.ts";
import { makeEnv, summaryLine, writeStubMuse } from "./acceptance-344.ts";
import { run, type RunResult } from "./lib/proc.ts";

/** Assert a driven command's exit code, quoting its stderr when it differs. */
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

/** One stale claim section, in report order. */
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

const ADD = "verify-app/features/add.md";
const LIST = "verify-app/features/list.md";
const DONE = "verify-app/features/done.md";
const USAGE_PAGE = "verify-app/features/usage.md";
const STORE = "verify-app/features/store.md";

/** A pass over five pages: one stale claim with its finding, one unchecked, one unasked. */
const REPORT_STALE = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  `## Feature: ${ADD}`,
  "Outcome: clean",
  "",
  `## Feature: ${LIST}`,
  "Outcome: changed",
  "",
  "## Claim: list: an argument is a usage error",
  `Page: ${LIST}`,
  "Verdict: stale",
  `Stated: ${OLD_USAGE}`,
  `Found: ${NEW_USAGE}`,
  "",
  `## Feature: ${DONE}`,
  "Outcome: clean",
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
  `## Feature: ${STORE}`,
  "Outcome: clean",
  "",
  "## Unasked: the file holding the staging token",
  "Needed: the drive of usage.md needs a login the working copy does not show",
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

/** The fifteen claims walk-after-remove.out marks FAIL, by their names there. */
const FIFTEEN: Array<{ name: string; page: string; stated: string; found: string }> = [
  {
    name: "add: one task",
    page: ADD,
    stated: "list after holds one task with id 1, text buy milk and done false",
    found: "list after holds the task and a lastId of 1",
  },
  { name: "list: an argument is a usage error", page: LIST, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "list: --json is a usage error", page: LIST, stated: OLD_USAGE, found: NEW_USAGE },
  {
    name: "done: mark",
    page: DONE,
    stated: "list after holds one task with id 1, text buy milk and done true",
    found: "list after holds the task and a lastId of 1",
  },
  { name: "done: id form 01", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "done: id form 1.5", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "done: id form -1", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "done: id form 1e3", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "done: id form one", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "done: two ids", page: DONE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "usage: no arguments", page: USAGE_PAGE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "usage: help", page: USAGE_PAGE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "usage: blank add", page: USAGE_PAGE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "usage: --help", page: USAGE_PAGE, stated: OLD_USAGE, found: NEW_USAGE },
  { name: "usage: --version", page: USAGE_PAGE, stated: OLD_USAGE, found: NEW_USAGE },
];

/** The positive control: fifteen stale claims in, fifteen stale lines out. */
const REPORT_15 = [
  "# Upkeep pass",
  "",
  "## Verifier: cli",
  "Folder: verify-app",
  "",
  ...[ADD, LIST, DONE, USAGE_PAGE].flatMap((page) => [
    `## Feature: ${page}`,
    "Outcome: changed",
    "",
    ...FIFTEEN.filter((c) => c.page === page).flatMap((c) =>
      staleClaim(c.name, c.page, c.stated, c.found).split("\n"),
    ),
  ]),
  `## Feature: ${STORE}`,
  "Outcome: clean",
  "",
].join("\n");

const MULTI_ADD = "verifier/cli/features/add.md";
const MULTI_LIST = "verifier/cli/features/list.md";

/** Write a report into the sandbox and run the verdict over it. */
function reportRun(sandbox: Sandbox, text: string, extraArgs: string[] = []): RunResult {
  const file = join(sandbox.dir, "UPKEEP.md");
  writeFileSync(file, text);
  return run(RUN, [
    "verifier",
    "upkeep-report",
    sandbox.repo,
    "--run",
    sandbox.dispatch,
    "--report",
    file,
    ...extraArgs,
  ]);
}

describe("upkeep-report: the verdict from a finished pass", () => {
  test("lists each stale claim with what it found instead, and the unchecked claim never as stale", () => {
    const sandbox = makeSandbox();
    try {
      const r = reportRun(sandbox, REPORT_STALE);
      expectCode(r, 1);
      expect(r.out).toContain(
        [
          `stale: list: an argument is a usage error (${LIST})`,
          `  stated: ${OLD_USAGE}`,
          `  found: ${NEW_USAGE}`,
        ].join("\n"),
      );
      expect(r.out).toContain(
        [
          `unchecked: usage: --help (${USAGE_PAGE})`,
          "  because: the helper is missing: control-todo run is not on PATH",
        ].join("\n"),
      );
      expect(r.out).not.toContain("stale: usage: --help");
      expect(r.out).toContain("unasked: the file holding the staging token");
      expect(r.out).toContain("  needed: the drive of usage.md needs a login");
      expect(r.out).toContain("features driven: 5, stale: 1, unchecked: 1");
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("features driven: 5, stale: 1, unchecked: 1");
      const logged = actions
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { target: string; detail: string });
      expect(logged[logged.length - 1]?.target).toBe(join(sandbox.dir, "UPKEEP.md"));
      const details = logged.map((line) => line.detail);
      expect(details).toContain(`stale: list: an argument is a usage error (${LIST})`);
      expect(details).toContain(`  stated: ${OLD_USAGE}`);
      expect(details).toContain(`  found: ${NEW_USAGE}`);
      expect(details).toContain(`unchecked: usage: --help (${USAGE_PAGE})`);
      expect(details).toContain("unasked: the file holding the staging token");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a clean pass exits 0 with no stale or unchecked lines", () => {
    const sandbox = makeSandbox();
    try {
      const r = reportRun(sandbox, REPORT_CLEAN);
      expectCode(r, 0);
      expect(r.out).toContain("features driven: 5, stale: 0, unchecked: 0");
      const lines = r.out.split("\n");
      expect(lines.filter((l) => l.startsWith("stale:"))).toEqual([]);
      expect(lines.filter((l) => l.startsWith("unchecked:"))).toEqual([]);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("fifteen stale claims in, fifteen stale lines out, each named once", () => {
    const sandbox = makeSandbox();
    try {
      const r = reportRun(sandbox, REPORT_15);
      expectCode(r, 1);
      const lines = r.out.split("\n").filter((l) => l.startsWith("stale:"));
      expect(lines.length).toBe(15);
      for (const c of FIFTEEN) {
        expect(r.out).toContain(`stale: ${c.name} (${c.page})`);
      }
      expect(r.out).toContain("features driven: 5, stale: 15, unchecked: 0");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a report missing a feature page is refused naming the page", () => {
    const sandbox = makeSandbox();
    try {
      const missing = REPORT_CLEAN.replace(`## Feature: ${STORE}\nOutcome: clean\n`, "");
      expect(missing).not.toContain(STORE);
      const r = reportRun(sandbox, missing);
      expectCode(r, 1);
      expect(r.err).toMatch(/store\.md/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a stale claim without Found is refused naming the claim", () => {
    const sandbox = makeSandbox();
    try {
      const broken = REPORT_STALE.replace(`Found: ${NEW_USAGE}\n`, "");
      const r = reportRun(sandbox, broken);
      expectCode(r, 1);
      expect(r.err).toMatch(/list: an argument is a usage error/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a claim named twice is refused", () => {
    const sandbox = makeSandbox();
    try {
      const doubled = `${REPORT_STALE}\n## Claim: usage: --help\nPage: ${USAGE_PAGE}\nVerdict: unchecked\nStated: x\nBecause: y\n`;
      const r = reportRun(sandbox, doubled);
      expectCode(r, 1);
      expect(r.err).toMatch(/twice/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a changed feature with no stale claim is refused", () => {
    const sandbox = makeSandbox();
    try {
      const empty = REPORT_15.replace(
        `## Feature: ${ADD}\nOutcome: changed\n`,
        `## Feature: ${ADD}\nOutcome: clean\n`,
      ).replace(
        staleClaim("add: one task", ADD, FIFTEEN[0]?.stated ?? "", FIFTEEN[0]?.found ?? ""),
        "",
      );
      const changed = empty.replace(
        `## Feature: ${STORE}\nOutcome: clean\n`,
        `## Feature: ${STORE}\nOutcome: changed\n`,
      );
      const r = reportRun(sandbox, changed);
      expectCode(r, 1);
      expect(r.err).toMatch(/store\.md/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("--folder names the verifiers explicitly", () => {
    const sandbox = makeSandbox();
    try {
      const r = reportRun(sandbox, REPORT_CLEAN, ["--folder", "verify-app"]);
      expectCode(r, 0);
      expect(r.out).toContain("features driven: 5, stale: 0, unchecked: 0");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a multi-verifier report reads its own pages", () => {
    const sandbox = makeSandbox("multi");
    try {
      const text = [
        "# Upkeep pass",
        "",
        "## Verifier: cli",
        "Folder: verifier/cli",
        "",
        `## Feature: ${MULTI_ADD}`,
        "Outcome: changed",
        "",
        staleClaim("add: one task", MULTI_ADD, "stdout is added 1", "stdout is added 2").trimEnd(),
        "",
        `## Feature: ${MULTI_LIST}`,
        "Outcome: clean",
        "",
      ].join("\n");
      const r = reportRun(sandbox, text);
      expectCode(r, 1);
      expect(r.out).toContain(`stale: add: one task (${MULTI_ADD})`);
      expect(r.out).toContain("features driven: 2, stale: 1, unchecked: 0");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("upkeep with no host: the headless pass", () => {
  test("runs headless to a verdict with the headless instructions", () => {
    const sandbox = makeSandbox();
    try {
      writeStubSession(sandbox.bin);
      const file = join(sandbox.dir, "UPKEEP.md");
      writeFileSync(file, REPORT_STALE);
      const env = makeEnv(sandbox, { POSTMASTER_HOST: "none", ORACLE_REPORT: file });
      const r = run(
        RUN,
        ["verifier", "upkeep", sandbox.repo, "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 1);
      expect(r.out).toContain("branch upkeep");
      expect(r.out).toContain("role coachman");
      expect(r.out).toContain(`stale: list: an argument is a usage error (${LIST})`);
      expect(r.out).toContain(`  found: ${NEW_USAGE}`);
      expect(r.out).toContain("features driven: 5, stale: 1, unchecked: 1");
      const report = summaryLine(r.out, "report");
      expect(report).not.toBe("");
      expect(existsSync(report)).toBe(true);
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      const prompt = readFileSync(promptFile, "utf8");
      expect(prompt).toMatch(/cannot ask anyone anything/iu);
      expect(prompt).toMatch(/unasked/iu);
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("verifier-upkeep");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a clean report exits 0", () => {
    const sandbox = makeSandbox();
    try {
      writeStubSession(sandbox.bin);
      const file = join(sandbox.dir, "UPKEEP.md");
      writeFileSync(file, REPORT_CLEAN);
      const env = makeEnv(sandbox, { POSTMASTER_HOST: "none", ORACLE_REPORT: file });
      const r = run(
        RUN,
        ["verifier", "upkeep", sandbox.repo, "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 0);
      expect(r.out).toContain("features driven: 5, stale: 0, unchecked: 0");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("upkeep with a host: the interactive pass", () => {
  function coachmanConfig(sandbox: Sandbox): string {
    const path = join(sandbox.dir, "config.toml");
    writeFileSync(path, '[team]\ncoachman = { harness = "muse", model = "probe-model" }\n');
    return path;
  }

  test("spawns the coachman interactive form in postmaster-<repo> and collects the report", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const file = join(sandbox.dir, "UPKEEP.md");
      writeFileSync(file, REPORT_STALE);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
        ORACLE_SESSION_WORK: "1",
        ORACLE_REPORT: file,
      });
      const r = run(
        RUN,
        ["verifier", "upkeep", sandbox.repo, "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 1);
      expect(r.out).toContain("branch upkeep");
      expect(r.out).toContain("handle verifier-app-upkeep");
      expect(r.out).toContain(`stale: list: an argument is a usage error (${LIST})`);
      expect(r.out).toContain("features driven: 5, stale: 1, unchecked: 1");
      const calls = readFileSync(log, "utf8");
      expect(calls).toContain("new-session");
      expect(calls).toContain("postmaster-app");
      expect(calls).toContain("muse");
      expect(calls).toContain("probe-model");
      expect(calls).toContain("load-buffer");
      const wt = summaryLine(r.out, "worktree");
      expect(wt).not.toBe("");
      expect(calls).toContain(`cd -- '${wt}'`);
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      expect(readFileSync(promptFile, "utf8")).toMatch(
        /ask the user only what you cannot observe/iu,
      );
      const streams = readdirSync(join(sandbox.dispatch, "logs")).filter((f) =>
        f.endsWith("-events.jsonl"),
      );
      expect(streams).toEqual([]);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a session still running at the limit is left open, with no headless launch", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
      });
      const r = run(
        RUN,
        ["verifier", "upkeep", sandbox.repo, "--run", sandbox.dispatch, "--timeout", "2"],
        { env },
      );
      expectCode(r, 1);
      expect(r.err).toMatch(/left open/iu);
      expect(readFileSync(log, "utf8")).toContain("new-session");
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toMatch(/still running after 2 seconds/u);
      const streams = readdirSync(join(sandbox.dispatch, "logs")).filter((f) =>
        f.endsWith("-events.jsonl"),
      );
      expect(streams).toEqual([]);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a spawn that fails stops the upkeep and cleans up", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
        ORACLE_TMUX_FAIL_NEW: "1",
      });
      const r = run(
        RUN,
        ["verifier", "upkeep", sandbox.repo, "--run", sandbox.dispatch, "--timeout", "30"],
        { env },
      );
      expectCode(r, 1);
      expect(r.err).toMatch(/could not start/iu);
      const branches = run("git", ["-C", sandbox.repo, "branch", "--list", "upkeep"]);
      expect(branches.out.trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("upkeep-prompt: the pass instructions", () => {
  test("the interactive form asks only what cannot be observed, and takes secrets by file name", () => {
    const sandbox = makeSandbox();
    try {
      const out = upkeepPromptOrThrow(sandbox.repo);
      expect(out).toMatch(/ask the user only what you cannot observe/iu);
      expect(out).toMatch(/name of the file that holds it/iu);
      expect(out).toMatch(/never the value/iu);
      expect(out).not.toMatch(/cannot ask anyone anything/iu);
      expect(out).toMatch(/UPKEEP\.md/u);
      expect(out).toMatch(/health check/iu);
      expect(out).toMatch(/Outcome: clean/iu);
      expect(out).toMatch(/changed/iu);
      expect(out).toMatch(/blocked/iu);
      expect(out).not.toContain("HANDOVER.md");
      expect(out).toContain(ADD);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("the headless form cannot ask, and hands over an unasked list", () => {
    const sandbox = makeSandbox();
    try {
      const out = upkeepPromptOrThrow(sandbox.repo, ["--headless"]);
      expect(out).toMatch(/cannot ask anyone anything/iu);
      expect(out).toMatch(/unasked/iu);
      expect(out).toMatch(/never invent a value/iu);
      expect(out).toMatch(/UPKEEP\.md/u);
      expect(out).not.toContain("HANDOVER.md");
      expect(out).toMatch(/health check/iu);
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
      const r = run(RUN, ["verifier", "upkeep-prompt", bare]);
      expectCode(r, 2);
      expect(r.err).toMatch(/no verifiers/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("the index records the files each verifier depends on", () => {
  test("the single-surface instructions carry the Files: rule", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "prompt", sandbox.repo, "cli"]);
      expectCode(r, 0);
      expect(r.out).toMatch(/Files:/u);
      expect(r.out).toMatch(/whose change can break/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("the multi-surface instructions carry the Files: rule per verifier", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "prompt", sandbox.repo, "cli", "web"]);
      expectCode(r, 0);
      expect(r.out).toMatch(/Files:/u);
      expect(r.out).toMatch(/whose change can break/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  test("upkeep without --run exits 2 and prints usage", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "upkeep", sandbox.repo]);
      expectCode(r, 2);
      expect(r.err).toMatch(/upkeep needs --run/u);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("upkeep on a repo without verifiers exits 2 and cuts nothing", () => {
    const sandbox = makeSandbox();
    const bare = join(sandbox.dir, "bare");
    try {
      initRepo(bare);
      writeRepoFile(bare, "README.md", "# bare\n");
      commitAll(bare, "first");
      const r = run(RUN, [
        "verifier",
        "upkeep",
        bare,
        "--run",
        sandbox.dispatch,
        "--timeout",
        "30",
      ]);
      expectCode(r, 2);
      expect(r.err).toMatch(/no verifiers/u);
      const branches = run("git", ["-C", bare, "branch", "--list", "upkeep"]);
      expect(branches.out.trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("upkeep-report without --report exits 2 and prints usage", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "upkeep-report", sandbox.repo, "--run", sandbox.dispatch]);
      expectCode(r, 2);
      expect(r.err).toMatch(/needs --report/u);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("upkeep-report with a missing report file exits 2", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, [
        "verifier",
        "upkeep-report",
        sandbox.repo,
        "--run",
        sandbox.dispatch,
        "--report",
        join(sandbox.dir, "missing.md"),
      ]);
      expectCode(r, 2);
      expect(r.err).toMatch(/no report to read/u);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});
