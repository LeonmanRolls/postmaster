// Tests for fixture-lanes.ts: the pure core, and the score controls the ticket names.
//
//   bun --no-env-file test scripts/fixture-lanes.test.ts
//
// The controls run the real `fixture.sh score` and read the hidden-tests line back. A lane that
// passes, one that fails, one that is missing and one that fails to build; and a run whose merged
// result alone decides the verdict. They use the fixture app and the `remove` ticket's hidden
// suite, the same ones score uses.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  branchName,
  formatLane,
  formatLanes,
  hiddenStatusFromOutput,
  laneNamesFromAuditFiles,
  laneNamesFromBranches,
  laneNamesFromManifestLanes,
  laneNamesFromWorkhorses,
  mergeLaneNames,
  parseHiddenCounts,
  sortLaneEntries,
  statusText,
  ticketIdFromWaybill,
  type LaneStatus,
} from "./fixture-lanes.ts";

const SCRIPTS = import.meta.dir;
const TOOL = join(SCRIPTS, "..");
const FIXTURE_SH = join(SCRIPTS, "fixture.sh");
const APP = join(TOOL, "fixtures", "app");
const TICKETS = join(TOOL, "fixtures", "tickets");
const FIXTURE_TICKET = "remove";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function sh(cmd: string[], cwd?: string, env: Record<string, string> = gitEnv): { code: number | null; out: string } {
  const proc = Bun.spawnSync({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const out = (proc.stdout ? new TextDecoder().decode(proc.stdout) : "") +
    (proc.stderr ? new TextDecoder().decode(proc.stderr) : "");
  return { code: proc.exitCode, out };
}

function ticketBody(name: string): string {
  const text = readFileSync(join(TICKETS, name, "ticket.md"), "utf8");
  return text.split("\n").slice(1).join("\n").replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
}

// A finished-enough run for score to print its hidden-tests line: a repo whose main holds the
// merged result, and a dispatch whose waybill carries the fixture ticket's criteria verbatim.
type Record = { root: string; repo: string; dispatch: string; ticketId: string };

function makeRecord(root: string, opts: {
  ticketId: string;
  main: "reference" | "app";
  lanes: Array<{ lane: string; branch: "reference" | "app" | "empty" | "none" }>;
}): Record {
  const repo = join(root, "repo");
  const dispatch = join(repo, ".postmaster", "runs", opts.ticketId);
  mkdirSync(dispatch, { recursive: true });
  cpSync(APP, repo, { recursive: true });
  let r = sh(["git", "init", "-q", "-b", "main"], repo);
  if (r.code !== 0) throw new Error(`git init: ${r.out}`);
  r = sh(["git", "add", "-A"], repo);
  if (r.code !== 0) throw new Error(`git add: ${r.out}`);
  r = sh(["git", "commit", "-q", "-m", "Initial commit"], repo);
  if (r.code !== 0) throw new Error(`git commit: ${r.out}`);
  const base = sh(["git", "rev-parse", "HEAD"], repo).out.trim();

  for (const { lane, branch } of opts.lanes) {
    const ref = branchName(opts.ticketId, lane);
    if (branch === "none") continue;
    if (branch === "empty") {
      r = sh(["git", "checkout", "-q", "--orphan", ref], repo);
      if (r.code !== 0) throw new Error(`orphan ${ref}: ${r.out}`);
      r = sh(["git", "rm", "-rf", "-q", "--ignore-unmatch", "."], repo);
      writeFileSync(join(repo, "README.md"), "no app here\n");
      sh(["git", "add", "-A"], repo);
      r = sh(["git", "commit", "-q", "--allow-empty", "-m", "empty"], repo);
      if (r.code !== 0) throw new Error(`commit ${ref}: ${r.out}`);
      r = sh(["git", "checkout", "-q", "main"], repo);
      if (r.code !== 0) throw new Error(`back to main: ${r.out}`);
      continue;
    }
    r = sh(["git", "checkout", "-q", "-b", ref, base], repo);
    if (r.code !== 0) throw new Error(`branch ${ref}: ${r.out}`);
    if (branch === "reference") {
      r = sh(["git", "apply", join(TICKETS, FIXTURE_TICKET, "reference.patch")], repo);
      if (r.code !== 0) throw new Error(`apply reference on ${ref}: ${r.out}`);
      r = sh(["git", "add", "-A"], repo);
      if (r.code !== 0) throw new Error(`add ${ref}: ${r.out}`);
      r = sh(["git", "commit", "-q", "-m", "Implement the ticket"], repo);
      if (r.code !== 0) throw new Error(`commit ${ref}: ${r.out}`);
    }
    r = sh(["git", "checkout", "-q", "main"], repo);
    if (r.code !== 0) throw new Error(`back to main: ${r.out}`);
  }

  if (opts.main === "reference") {
    r = sh(["git", "apply", join(TICKETS, FIXTURE_TICKET, "reference.patch")], repo);
    if (r.code !== 0) throw new Error(`apply reference on main: ${r.out}`);
    r = sh(["git", "add", "-A"], repo);
    r = sh(["git", "commit", "-q", "-m", "Merge the ticket"], repo);
    if (r.code !== 0) throw new Error(`commit main: ${r.out}`);
  }

  const lanesJson: Record<string, unknown> = {};
  for (const { lane, branch } of opts.lanes) {
    lanesJson[lane] = { outcome: branch === "none" ? "stalled" : "harvested" };
  }
  writeFileSync(join(dispatch, "manifest.json"), JSON.stringify({
    stage: "done",
    leg: 1,
    base,
    lanes: lanesJson,
    coachman: { legs: {} },
  }, null, 2));
  writeFileSync(join(dispatch, "run.json"), JSON.stringify({ written: true }));
  writeFileSync(join(dispatch, "brief.md"), [
    `# Waybill: ${opts.ticketId}`,
    "",
    "## Ticket",
    "",
    ticketBody(FIXTURE_TICKET),
    "",
    "## Project profile",
    `repo: ${repo}`,
    "",
  ].join("\n"));
  return { root, repo, dispatch, ticketId: opts.ticketId };
}

function hiddenTestsLine(scoreOut: string): string {
  const line = scoreOut.split(/\r?\n/).find((l) => /hidden-tests/.test(l) && /^(ok|FAIL)/.test(l));
  if (!line) throw new Error(`no hidden-tests line in:\n${scoreOut}`);
  return line;
}

function laneStatusOn(line: string, lane: string): string {
  const m = new RegExp(`(?:^|; )${lane.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ([^;]+)`).exec(line);
  return m ? m[1].trim() : "";
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "fixture-lanes-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("pure core", () => {
  test("ticketIdFromWaybill reads the header, else nothing", () => {
    expect(ticketIdFromWaybill("# Waybill: 7\n\nturnpikes: none\n")).toBe("7");
    expect(ticketIdFromWaybill("# Waybill: T-1\n")).toBe("T-1");
    expect(ticketIdFromWaybill("no waybill here\n")).toBeNull();
    expect(ticketIdFromWaybill("## Ticket\n# Waybill: 1\n")).toBeNull();
  });

  test("laneNamesFromManifestLanes lists the keys, sorted", () => {
    expect(laneNamesFromManifestLanes({ one: {}, two: {} })).toEqual(["one", "two"]);
    expect(laneNamesFromManifestLanes({ b: {}, a: {} })).toEqual(["a", "b"]);
    expect(laneNamesFromManifestLanes(null)).toEqual([]);
    expect(laneNamesFromManifestLanes([])).toEqual([]);
    expect(laneNamesFromManifestLanes("nope")).toEqual([]);
    expect(laneNamesFromManifestLanes({ "": {} })).toEqual([]);
  });

  test("laneNamesFromAuditFiles keeps plain names and drops the spec copies", () => {
    expect(laneNamesFromAuditFiles(["one.md", "two.md", "one-spec.md", "one-spec-final.md", "one-verify"])).toEqual(["one", "two"]);
    expect(laneNamesFromAuditFiles(["alpha.md", "notes.txt"])).toEqual(["alpha"]);
    expect(laneNamesFromAuditFiles([])).toEqual([]);
  });

  test("laneNamesFromWorkhorses takes the name before =, from the Team section only", () => {
    expect(laneNamesFromWorkhorses("## Team\nworkhorses: one=codex/m1/max, two=mimo/m2/\n\n## Next\n")).toEqual(["one", "two"]);
    expect(laneNamesFromWorkhorses("## Team\nreviewers: one, two\n")).toEqual([]);
    expect(laneNamesFromWorkhorses("## Team\nworkhorses: solo=h/x/\n")).toEqual(["solo"]);
    expect(laneNamesFromWorkhorses("")).toEqual([]);
    expect(laneNamesFromWorkhorses("## Ticket\nA quoted line:\nworkhorses: phantom=h/x\n\n## Notes\n")).toEqual([]);
    expect(laneNamesFromWorkhorses("## Team\nreviewers: one\nworkhorses: one=h/x, two=m/y\n")).toEqual(["one", "two"]);
    expect(laneNamesFromWorkhorses("## Team\n\nworkhorses: solo=h/x/\n")).toEqual(["solo"]);
    expect(laneNamesFromWorkhorses("## Team\r\nworkhorses: solo=h/x/\r\n")).toEqual(["solo"]);
    expect(laneNamesFromWorkhorses("## Team\nworkhorses: one=h/x\n## Next\nworkhorses: phantom=h/x\n")).toEqual(["one"]);
  });

  test("laneNamesFromBranches reads wb/<ticket>-*, with or without refs/heads/", () => {
    expect(laneNamesFromBranches(["refs/heads/wb/7-one", "refs/heads/wb/7-two", "refs/heads/main"], "7")).toEqual(["one", "two"]);
    expect(laneNamesFromBranches(["wb/7-one", "wb/7-"], "7")).toEqual(["one"]);
    expect(laneNamesFromBranches(["refs/heads/wb/8-one"], "7")).toEqual([]);
    expect(laneNamesFromBranches([], "7")).toEqual([]);
  });

  test("mergeLaneNames unions and sorts", () => {
    expect(mergeLaneNames(["b", "a"], ["a", "c"], [])).toEqual(["a", "b", "c"]);
    expect(mergeLaneNames([], [])).toEqual([]);
  });

  test("branchName is the harvested archive name", () => {
    expect(branchName("7", "one")).toBe("wb/7-one");
    expect(branchName("T-1", "luna")).toBe("wb/T-1-luna");
  });

  test("parseHiddenCounts reads a fixture.sh hidden line", () => {
    expect(parseHiddenCounts("ok   hidden-tests  remove: 5 pass, 0 fail")).toEqual({ passed: 5, failed: 0 });
    expect(parseHiddenCounts("FAIL hidden-tests  remove: 0 pass, 3 fail")).toEqual({ passed: 0, failed: 3 });
    expect(parseHiddenCounts("FAIL hidden-tests  remove: bun test exit 2")).toBeNull();
    expect(parseHiddenCounts("")).toBeNull();
    expect(parseHiddenCounts("note: last time 5 pass, 0 fail\nFAIL hidden-tests  remove: bun test exit 2\n")).toBeNull();
  });

  test("hiddenStatusFromOutput: counts, or failed to build", () => {
    expect(hiddenStatusFromOutput("ok   hidden-tests  remove: 5 pass, 0 fail")).toEqual({ kind: "counts", passed: 5, failed: 0 });
    expect(hiddenStatusFromOutput("FAIL hidden-tests  remove: 1 pass, 2 fail")).toEqual({ kind: "counts", passed: 1, failed: 2 });
    expect(hiddenStatusFromOutput("FAIL hidden-tests  remove: bun test exit 2")).toEqual({ kind: "failed-to-build" });
    expect(hiddenStatusFromOutput("fixture: no package.json in /tmp/x")).toEqual({ kind: "failed-to-build" });
    expect(hiddenStatusFromOutput("")).toEqual({ kind: "failed-to-build" });
  });

  test("statusText never calls missing or failed to build a pass", () => {
    expect(statusText({ kind: "missing" })).toBe("missing");
    expect(statusText({ kind: "failed-to-build" })).toBe("failed to build");
    expect(statusText({ kind: "counts", passed: 0, failed: 3 })).toBe("0 pass, 3 fail");
    expect(statusText({ kind: "missing" })).not.toMatch(/pass/);
    expect(statusText({ kind: "failed-to-build" })).not.toMatch(/pass/);
    expect(statusText({ kind: "missing" })).not.toMatch(/\bfail\b/);
  });

  test("formatLane and formatLanes put each lane beside the others in name order", () => {
    expect(formatLane("one", { kind: "counts", passed: 5, failed: 0 })).toBe("one: 5 pass, 0 fail");
    expect(formatLane("two", { kind: "missing" })).toBe("two: missing");
    const entries: Array<[string, LaneStatus]> = [
      ["two", { kind: "missing" }],
      ["one", { kind: "counts", passed: 5, failed: 0 }],
    ];
    expect(formatLanes(sortLaneEntries(entries))).toBe("one: 5 pass, 0 fail; two: missing");
  });
});

describe("score controls", () => {
  test("a lane that passes, one that fails, one that is missing, one that fails to build", async () => {
    const rec = makeRecord(join(scratch, "clean"), {
      ticketId: "7",
      main: "reference",
      lanes: [
        { lane: "pass", branch: "reference" },
        { lane: "fail", branch: "app" },
        { lane: "gone", branch: "none" },
        { lane: "broke", branch: "empty" },
      ],
    });
    const run = Bun.spawnSync({
      cmd: [FIXTURE_SH, "score", rec.dispatch, rec.repo],
      env: { ...gitEnv, POSTMASTER_CONFIG: join(scratch, "no-config.toml") },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const out = (run.stdout ? new TextDecoder().decode(run.stdout) : "") +
      (run.stderr ? new TextDecoder().decode(run.stderr) : "");
    const line = hiddenTestsLine(out);
    expect(line).toMatch(/^ok\s+hidden-tests\s+remove, from the waybill: \d+ pass, 0 fail on main/);

    const pass = laneStatusOn(line, "pass");
    expect(pass).toMatch(/^\d+ pass, 0 fail$/);
    expect(pass).not.toBe("0 pass, 0 fail");

    const fail = laneStatusOn(line, "fail");
    expect(fail).toMatch(/^\d+ pass, \d+ fail$/);
    expect(fail).not.toMatch(/^(\d+) pass, 0 fail$/);

    const gone = laneStatusOn(line, "gone");
    expect(gone).toBe("missing");
    expect(gone).not.toMatch(/pass/);

    const broke = laneStatusOn(line, "broke");
    expect(broke).toBe("failed to build");
    expect(broke).not.toMatch(/pass/);
  }, 300_000);

  test("the verdict follows the merged result alone", async () => {
    // Merged main is the unmodified app, so hidden-tests fails; the pass lane still reports counts.
    const rec = makeRecord(join(scratch, "verdict"), {
      ticketId: "7",
      main: "app",
      lanes: [{ lane: "pass", branch: "reference" }],
    });
    const run = Bun.spawnSync({
      cmd: [FIXTURE_SH, "score", rec.dispatch, rec.repo],
      env: { ...gitEnv, POSTMASTER_CONFIG: join(scratch, "no-config.toml") },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const out = (run.stdout ? new TextDecoder().decode(run.stdout) : "") +
      (run.stderr ? new TextDecoder().decode(run.stderr) : "");
    const line = hiddenTestsLine(out);
    expect(line).toMatch(/^FAIL\s+hidden-tests\s+remove, from the waybill: .* on main/);
    expect(laneStatusOn(line, "pass")).toMatch(/^\d+ pass, 0 fail$/);
    expect(run.exitCode).toBe(2);
  }, 300_000);
});
