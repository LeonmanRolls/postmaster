import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { formatLaneResults, hiddenCounts, laneNames } from "./fixture-lanes.ts";

const TOOL = resolve(import.meta.dir, "..");
const FIXTURE_APP = join(TOOL, "fixtures/app");
const FIXTURE_SH = join(TOOL, "scripts/fixture.sh");
const TICKET = "remove";
const TICKET_ID = "159";
const COMMIT_NAME = "brindlewick";
const COMMIT_EMAIL = "332054101+brindlewick@users.noreply.github.com";

function command(args: string[], cwd?: string, env?: Record<string, string | undefined>): string {
  const result = Bun.spawnSync(args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} exited ${result.exitCode}:\n${output}`);
  }
  return result.stdout.toString().trim();
}

function trackedFiles(root: string): string[] {
  return command(["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
}

function copyFixtureApp(destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const relative of trackedFiles(FIXTURE_APP)) {
    const source = join(FIXTURE_APP, relative);
    const target = join(destination, relative);
    mkdirSync(dirname(target), { recursive: true });
    if (lstatSync(source).isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
    } else {
      copyFileSync(source, target);
    }
  }
}

function git(repo: string, ...args: string[]): string {
  return command(["git", "-C", repo, ...args]);
}

function commit(repo: string, message: string): void {
  git(repo, "add", "-A");
  git(repo, "-c", `user.name=${COMMIT_NAME}`, "-c", `user.email=${COMMIT_EMAIL}`, "commit", "-q", "-m", message);
}

type RepoOptions = { solvedMain: boolean; lanes: string[] };

function makeRepo(root: string, options: RepoOptions): { repo: string; base: string } {
  const repo = join(root, "repo");
  copyFixtureApp(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", COMMIT_NAME);
  git(repo, "config", "user.email", COMMIT_EMAIL);
  commit(repo, "Initial fixture app");
  const base = git(repo, "rev-parse", "HEAD");

  for (const lane of options.lanes) {
    const branch = `wb/${TICKET_ID}-${lane}`;
    if (lane === "pass") {
      git(repo, "checkout", "-q", "-b", branch, "main");
      git(repo, "apply", join(TOOL, `fixtures/tickets/${TICKET}/reference.patch`));
      commit(repo, "Implement the fixture ticket");
      git(repo, "checkout", "-q", "main");
    } else if (lane === "build") {
      git(repo, "checkout", "-q", "-b", branch, "main");
      unlinkSync(join(repo, "package.json"));
      commit(repo, "Remove the package manifest");
      git(repo, "checkout", "-q", "main");
    } else {
      git(repo, "branch", branch, "main");
    }
  }

  if (options.solvedMain) {
    git(repo, "apply", join(TOOL, `fixtures/tickets/${TICKET}/reference.patch`));
    commit(repo, "Merge the fixture solution");
  }
  return { repo, base };
}

function makeDispatch(repo: string, base: string, lanes: string[]): string {
  const dispatch = join(repo, ".postmaster/runs", TICKET_ID);
  mkdirSync(join(dispatch, "audit"), { recursive: true });
  const manifest = {
    stage: "dispatched",
    leg: 1,
    base,
    lanes: Object.fromEntries(lanes.map((lane) => [lane, { outcome: "harvested" }])),
    coachman: { legs: {} },
  };
  writeFileSync(join(dispatch, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const ticket = readFileSync(join(TOOL, `fixtures/tickets/${TICKET}/ticket.md`), "utf8").trimEnd();
  const workhorses = lanes.map((lane) => `${lane}=bash/model`).join(", ");
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: ${TICKET_ID}\n\n## Ticket\n\n${ticket}\n\n## Team\nworkhorses: ${workhorses}\n`,
  );
  const toolCommit = git(TOOL, "rev-parse", "HEAD");
  writeFileSync(join(dispatch, "run.json"), `${JSON.stringify({ postmaster: { commit: toolCommit } })}\n`);

  const action = join(TOOL, "scripts/log-action.sh");
  command([action, dispatch, "postmaster", "dispatch", TICKET_ID, "fixture test"]);
  const stages = command([join(TOOL, "scripts/stage.sh"), "--list"]).split(/\r?\n/).filter(Boolean);
  for (const stage of stages.slice(1, stages.indexOf("done") + 1)) {
    command([join(TOOL, "scripts/stage.sh"), dispatch, stage, "postmaster"]);
  }

  writeFileSync(join(dispatch, "leg-1-prompt.txt"), "fixture leg\n");
  writeFileSync(
    join(dispatch, "handoff-1.md"),
    ["Decisions", "Deferred findings", "Verified by execution", "Unverified", "Branches and lanes", "Open questions", "Next leg"]
      .map((section) => `## ${section}\n\nRecorded.\n`)
      .join("\n"),
  );
  writeFileSync(join(dispatch, ".leg-1-done"), "");
  writeFileSync(join(dispatch, ".leg-1-exited"), "");
  writeFileSync(join(dispatch, "card.md"), `# Ship card: ${TICKET_ID}\n\nRecorded.\n`);
  return dispatch;
}

function runScore(dispatch: string, repo: string, tempRoot: string): { code: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bash", FIXTURE_SH, "score", dispatch, repo], {
    env: { ...process.env, TMPDIR: tempRoot },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("fixture lane scoring", () => {
  test("collects run lanes and retained branches in name order", () => {
    const names = laneNames(
      { lanes: { "manifest-only": { outcome: "harvested" }, luna: {} } },
      ["audit-only.md", "luna-spec.md", "luna-spec-final.md"],
      "## Team\nworkhorses: waybill-only=codex/model, luna=codex/model\n\n## Dispatch\n",
      ["wb/159-branch-only", "wb/160-other-ticket"],
      "159",
    );
    expect(names).toEqual(["audit-only", "branch-only", "luna", "manifest-only", "waybill-only"]);
  });

  test("reads hidden-test counts and formats non-pass states explicitly", () => {
    expect(hiddenCounts("ok   hidden-tests  remove: 8 pass, 0 fail\n")).toEqual({ pass: 8, fail: 0 });
    expect(hiddenCounts("FAIL hidden-tests remove: 0 pass, 8 fail\n")).toEqual({ pass: 0, fail: 8 });
    expect(hiddenCounts("fixture: no package.json in /tmp/app\n")).toBeUndefined();
    expect(
      formatLaneResults([
        { lane: "missing", kind: "missing" },
        { lane: "build", kind: "failed to build" },
        { lane: "pass", kind: "counts", pass: 8, fail: 0 },
      ]),
    ).toBe("build: failed to build; missing: missing; pass: 8 pass, 0 fail");
  });

  test("score reports passing, failing, missing and unbuildable lane branches without changing main's verdict", () => {
    mkdirSync(join(TOOL, ".postmaster"), { recursive: true });
    const tempRoot = mkdtempSync(join(TOOL, ".postmaster/fixture-lanes-test-"));
    try {
      const repoSetup = makeRepo(tempRoot, { solvedMain: true, lanes: ["pass", "fail", "build"] });
      const dispatch = makeDispatch(repoSetup.repo, repoSetup.base, ["pass", "fail", "missing", "build"]);
      const result = runScore(dispatch, repoSetup.repo, tempRoot);
      const hiddenLine = result.stdout.split(/\r?\n/).find((line) => line.includes("hidden-tests")) ?? "";

      expect(result.code).toBe(0);
      expect(hiddenLine).toMatch(/^ok\s+hidden-tests/);
      expect(hiddenLine).toMatch(/on main; build: failed to build; fail: \d+ pass, \d+ fail; missing: missing; pass: \d+ pass, 0 fail$/);
      const failed = /fail: (\d+) pass, (\d+) fail/.exec(hiddenLine);
      expect(failed).not.toBeNull();
      expect(Number(failed?.[2])).toBeGreaterThan(0);

      const unsolvedRoot = join(tempRoot, "unsolved");
      mkdirSync(unsolvedRoot);
      const unsolved = makeRepo(unsolvedRoot, { solvedMain: false, lanes: ["pass"] });
      const unsolvedDispatch = makeDispatch(unsolved.repo, unsolved.base, ["pass"]);
      const unsolvedResult = runScore(unsolvedDispatch, unsolved.repo, tempRoot);
      const unsolvedHiddenLine = unsolvedResult.stdout.split(/\r?\n/).find((line) => line.includes("hidden-tests")) ?? "";

      expect(unsolvedResult.code).toBe(2);
      expect(unsolvedHiddenLine).toMatch(/^FAIL\s+hidden-tests/);
      expect(unsolvedHiddenLine).toMatch(/on main; pass: \d+ pass, 0 fail$/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
