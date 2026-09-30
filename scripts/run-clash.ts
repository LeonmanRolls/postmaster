#!/usr/bin/env bun
// Refuse a ticket id that already names a run directory or a branch.
//
//   bun scripts/run-clash.ts <repo> <ticket-id>
//
// Stage B names a run's directory and branches after its ticket id and would otherwise make
// them without looking. A re-run, or a local ticket whose number an earlier GitHub issue used,
// silently reuses the old run and then fails at `git worktree add`. This check is read-only:
// it names what already exists and leaves the old run to the user (archive it, rename it, or
// pick another id). The postmaster renames or removes nothing itself.
//
// What is checked, and only this: <repo>/.postmaster/runs/<ticket-id>/ (a directory or a file),
// local branch <ticket-id>, and local branches matching wb/<ticket-id>-*. Not a leftover
// worktree directory, not remote-tracking branches. Near-misses are out: ticket 7 does not
// refuse 70 or wb/70-lane.
//
//   exit 0  free: nothing names this id
//   exit 1  usage, or <repo> is not a git repository
//   exit 2  one or more clashes; each is named

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type Clash =
  | { kind: "run-directory"; path: string }
  | { kind: "branch"; name: string };

export const ADVICE =
  "the user decides what happens to the old run: archive it, rename it, or pick another id";

export function isUsableTicketId(id: string): boolean {
  return id.length > 0 && !id.includes("/");
}

export function runDirPath(repo: string, ticketId: string): string {
  return join(repo, ".postmaster", "runs", ticketId);
}

export function isTicketBranch(ticketId: string, branch: string): boolean {
  return branch === ticketId;
}

export function isWbBranch(ticketId: string, branch: string): boolean {
  return branch.startsWith(`wb/${ticketId}-`);
}

export function collectClashes(opts: {
  ticketId: string;
  runDirExists: boolean;
  runDirPath: string;
  branches: string[];
}): Clash[] {
  const clashes: Clash[] = [];
  if (opts.runDirExists) {
    clashes.push({ kind: "run-directory", path: opts.runDirPath });
  }
  for (const name of opts.branches) {
    if (isTicketBranch(opts.ticketId, name) || isWbBranch(opts.ticketId, name)) {
      clashes.push({ kind: "branch", name });
    }
  }
  return clashes;
}

export function formatFree(ticketId: string): string {
  return `run-clash: free ${ticketId}`;
}

export function formatClash(clash: Clash): string {
  return clash.kind === "run-directory"
    ? `run-clash: run directory already exists: ${clash.path}`
    : `run-clash: branch already exists: ${clash.name}`;
}

export function formatReport(clashes: Clash[]): string[] {
  return [...clashes.map(formatClash), `run-clash: ${ADVICE}`];
}

export const USAGE = "usage: bun scripts/run-clash.ts <repo> <ticket-id>";

function isGitRepo(repo: string): boolean {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return r.status === 0 && r.stdout.trim() === "true";
}

function listLocalBranches(repo: string): string[] {
  const r = spawnSync(
    "git",
    ["-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr.trim() || "git for-each-ref failed");
  }
  return r.stdout.split("\n").filter((line) => line.length > 0);
}

function main(argv: string[]): number {
  const [repo, ticketId] = argv;
  if (argv.length !== 2 || repo === undefined || ticketId === undefined) {
    console.error(`run-clash: ${USAGE}`);
    return 1;
  }
  if (!isUsableTicketId(ticketId)) {
    console.error(`run-clash: unusable ticket id: ${JSON.stringify(ticketId)}`);
    console.error(`run-clash: ${USAGE}`);
    return 1;
  }
  if (!isGitRepo(repo)) {
    console.error(`run-clash: not a git repository: ${repo}`);
    return 1;
  }
  const dir = runDirPath(repo, ticketId);
  const clashes = collectClashes({
    ticketId,
    runDirExists: existsSync(dir),
    runDirPath: dir,
    branches: listLocalBranches(repo),
  });
  if (clashes.length === 0) {
    console.log(formatFree(ticketId));
    return 0;
  }
  for (const line of formatReport(clashes)) {
    console.log(line);
  }
  return 2;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
