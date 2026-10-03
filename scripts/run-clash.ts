// Refuse a ticket id that already names a run directory or a branch.
//
//   scripts/run run-clash <repo> <ticket-id>
//
// Stage B names a run's directory and branches after its ticket id and would otherwise make
// them without looking. A re-run, or a local ticket whose number an earlier GitHub issue used,
// silently reuses the old run and then fails at `git worktree add`. This check is read-only:
// it names what already exists and leaves the old run to the user (archive it, rename it, or
// pick another id). The postmaster renames or removes nothing itself.
//
// What is checked, and only this: <repo>/.postmaster/runs/<ticket-id>/ (a directory, a file,
// or a symlink, dangling or not),
// local branch <ticket-id>, and local branches matching wb/<ticket-id>-*. Not a leftover
// worktree directory, not remote-tracking branches. Near-misses are out: ticket 7 does not
// refuse 70 or wb/70-lane.
//
//   exit 0  free: nothing names this id
//   exit 1  usage, <repo> is not a git repository, or the run path cannot be checked
//   exit 2  one or more clashes; each is named

import { lstatSync } from "node:fs";
import { resolve } from "node:path";

export type Clash = { kind: "run-directory"; path: string } | { kind: "branch"; name: string };

export const ADVICE =
  "the user decides what happens to the old run: archive it, rename it, or pick another id";

export const USAGE = "usage: scripts/run run-clash <repo> <ticket-id>";

export function isUsableTicketId(id: string): boolean {
  return id.length > 0 && !id.includes("/") && id !== "." && id !== "..";
}

export function runDirPath(repo: string, ticketId: string): string {
  return resolve(repo, ".postmaster", "runs", ticketId);
}

export function isTicketBranch(ticketId: string, branch: string): boolean {
  return branch === ticketId;
}

export function isWbBranch(ticketId: string, branch: string): boolean {
  return branch.startsWith(`wb/${ticketId}-`);
}

const HEADS_PREFIX = "refs/heads/";

export function parseBranchNames(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(HEADS_PREFIX)) continue;
    names.push(line.slice(HEADS_PREFIX.length));
  }
  return names;
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

type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

// Git's own location variables, as a hook or rebase --exec can export them. They override
// -C, so every git child runs without them; the same seven run local and run verify unset.
export const GIT_LOCATION_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

export function stripGitLocationEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || GIT_LOCATION_ENV.includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function runGit(repo: string, args: string[]): GitResult {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repo, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: stripGitLocationEnv(process.env),
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function isOccupied(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

function refuseId(ticketId: string): number {
  console.error(`run-clash: unusable ticket id: ${JSON.stringify(ticketId)}`);
  console.error(`run-clash: ${USAGE}`);
  return 1;
}

function main(argv: string[]): number {
  const [repo, ticketId] = argv;
  if (argv.length !== 2 || repo === undefined || ticketId === undefined) {
    console.error(`run-clash: ${USAGE}`);
    return 1;
  }
  if (!isUsableTicketId(ticketId)) {
    return refuseId(ticketId);
  }
  let inside;
  try {
    inside = runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    console.error(`run-clash: could not run git: ${String(error)}`);
    return 1;
  }
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    console.error(`run-clash: not a git repository: ${repo}`);
    return 1;
  }
  if (runGit(repo, ["check-ref-format", `refs/heads/${ticketId}`]).exitCode !== 0) {
    return refuseId(ticketId);
  }
  let listed;
  try {
    listed = runGit(repo, ["for-each-ref", "--format=%(refname)", "refs/heads"]);
  } catch (error) {
    console.error(`run-clash: could not list local branches: ${String(error)}`);
    return 1;
  }
  if (listed.exitCode !== 0) {
    const detail = listed.stderr.trim();
    console.error(`run-clash: could not list local branches${detail ? `: ${detail}` : ""}`);
    return 1;
  }
  const dir = runDirPath(repo, ticketId);
  let occupied: boolean;
  try {
    occupied = isOccupied(dir);
  } catch (error) {
    console.error(`run-clash: could not check run directory: ${String(error)}`);
    return 1;
  }
  const clashes = collectClashes({
    ticketId,
    runDirExists: occupied,
    runDirPath: dir,
    branches: parseBranchNames(listed.stdout),
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
