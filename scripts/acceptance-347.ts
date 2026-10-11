// Oracle helpers for #347: the coachman takes in each workhorse's work only
// once none is running or waiting, and only at the commit its checks ran on.
// Each test builds a scratch repository with a synthesis worktree .worktrees/T
// on branch T at BASE and two workhorse worktrees, then drives the real
// scripts (host, verify, walls, take-in, synthesis-shares) as subprocesses;
// nothing here imports the change.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export const LANES = ["luna", "mimo"] as const;

export interface RunFixture {
  dir: string;
  repo: string;
  dispatch: string;
  base: string;
  worktree: (lane: string) => string;
  branch: (lane: string) => string;
}

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

export function initRepo(repo: string): void {
  const r = run("git", ["init", "-q", "-b", "main", repo]);
  if (r.code !== 0) throw new Error(`git init: ${r.err.trim() || r.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
}

export function writeRepoFile(repo: string, rel: string, text: string): void {
  const target = join(repo, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

export function commitAll(repo: string, message: string): void {
  gitOrThrow(repo, "add", ".");
  gitOrThrow(repo, "commit", "-q", "-m", message);
}

/** A scratch run T: BASE commit, dispatch with two lanes, synthesis and workhorse worktrees. */
export function makeRun(dir: string): RunFixture {
  const root = realpathSync(dir);
  const repo = join(root, "repo");
  initRepo(repo);
  writeRepoFile(repo, "app.txt", "v1\n");
  commitAll(repo, "base");
  const base = gitOrThrow(repo, "rev-parse", "HEAD").trim();
  const dispatch = join(root, "runs", "T");
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeFileSync(join(dispatch, "actions.jsonl"), "");
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage: "workhorses-running", leg: 1, base, lanes: { luna: { thread_id: "t-luna" }, mimo: { thread_id: "t-mimo" } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(dispatch, "checks.json"),
    `${JSON.stringify({ repo, checks: [{ name: "probe", source: "test", kind: "project", command: "true", shows: "the probe passes" }] }, null, 2)}\n`,
  );
  writeFileSync(join(dispatch, "brief.md"), "# Waybill: T\n\n## Ticket\n\ntest\n");
  gitOrThrow(repo, "worktree", "add", join(repo, ".worktrees", "T"), "-b", "T", base);
  for (const lane of LANES) {
    gitOrThrow(
      repo,
      "worktree",
      "add",
      join(repo, ".worktrees", `T-${lane}`),
      "-b",
      `wb/T-${lane}`,
      base,
    );
  }
  return {
    dir: root,
    repo,
    dispatch,
    base,
    worktree: (lane: string) => join(repo, ".worktrees", `T-${lane}`),
    branch: (lane: string) => `wb/T-${lane}`,
  };
}

/** Commit a file on a lane's branch; return the branch's new HEAD. */
export function laneCommit(fx: RunFixture, lane: string, name: string, text: string): string {
  const wt = fx.worktree(lane);
  writeRepoFile(wt, name, text);
  commitAll(wt, `${lane}: ${name}`);
  return gitOrThrow(fx.repo, "rev-parse", fx.branch(lane)).trim();
}

export function branchHead(fx: RunFixture, lane: string): string {
  return gitOrThrow(fx.repo, "rev-parse", fx.branch(lane)).trim();
}

/** Arm a lane's worktree and run the run's checks on it; the probe passes. */
export function checkLane(fx: RunFixture, lane: string): void {
  const wt = fx.worktree(lane);
  const a = run(RUN, ["verify", "arm", wt, fx.dispatch]);
  if (a.code !== 0) throw new Error(`verify arm ${lane}: ${a.err.trim() || a.out.trim()}`);
  const r = run(RUN, ["verify", "run", wt, fx.dispatch]);
  if (r.code !== 0)
    throw new Error(`verify run ${lane}: exit ${r.code}: ${r.err.trim() || r.out.trim()}`);
}

export function touchDone(fx: RunFixture, lane: string): void {
  writeFileSync(join(fx.dispatch, "logs", `${lane}.done`), "");
}

export function setOutcome(fx: RunFixture, lane: string, outcome: string): void {
  const p = join(fx.dispatch, "manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8")) as {
    lanes: Record<string, Record<string, string>>;
  };
  m.lanes[lane]!.outcome = outcome;
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

export function logAction(
  fx: RunFixture,
  actor: string,
  action: string,
  target: string,
  detail: string,
): void {
  const r = run(RUN, ["log-action", fx.dispatch, actor, action, target, detail]);
  if (r.code !== 0) throw new Error(`log-action ${action}: ${r.err.trim() || r.out.trim()}`);
}

export interface Action {
  action: string;
  target: string;
  detail: string;
}

export function readActions(fx: RunFixture): Action[] {
  const text = readFileSync(join(fx.dispatch, "actions.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Action);
}

export function takeIn(fx: RunFixture, ...args: string[]) {
  return run(RUN, ["take-in", fx.dispatch, ...args]);
}

/** A host registry and host choice confined to the fixture, for launch tests. */
export function hostEnv(fx: RunFixture): Record<string, string> {
  return { POSTMASTER_HOST: "none", POSTMASTER_HOST_STATE: join(fx.dir, "host") };
}
