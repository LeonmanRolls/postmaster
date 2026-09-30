import { existsSync } from "node:fs";
import { resolve } from "node:path";

type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runGit(repo: string, args: string[]): GitResult {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repo, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

export function findClashes(
  ticketId: string,
  runPath: string,
  runPathExists: boolean,
  localBranches: readonly string[],
): string[] {
  const clashes = runPathExists ? [`run directory ${runPath}`] : [];
  for (const branch of localBranches) {
    if (branch === ticketId || branch.startsWith(`wb/${ticketId}-`)) {
      clashes.push(`branch ${branch}`);
    }
  }
  return clashes;
}

function usage(): number {
  console.error("usage: bun scripts/run-clash.ts <repo> <ticket-id>");
  return 1;
}

function main(args: string[]): number {
  if (args.length !== 2) return usage();
  const [repo, ticketId] = args;
  if (!ticketId || ticketId.includes("/") || ticketId === "." || ticketId === "..") {
    return usage();
  }

  let inside;
  try {
    inside = runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    console.error(`run-clash: could not run git: ${String(error)}`);
    return 1;
  }
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    console.error(`run-clash: not a git worktree: ${repo}`);
    return 1;
  }

  const validBranch = runGit(repo, ["check-ref-format", `refs/heads/${ticketId}`]);
  if (validBranch.exitCode !== 0) {
    return usage();
  }

  let listed;
  try {
    listed = runGit(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  } catch (error) {
    console.error(`run-clash: could not list local branches: ${String(error)}`);
    return 1;
  }
  if (listed.exitCode !== 0) {
    const detail = listed.stderr.trim();
    console.error(`run-clash: could not list local branches${detail ? `: ${detail}` : ""}`);
    return 1;
  }

  const runPath = resolve(repo, ".postmaster", "runs", ticketId);
  const clashes = findClashes(
    ticketId,
    runPath,
    existsSync(runPath),
    listed.stdout.split("\n").filter(Boolean),
  );

  if (clashes.length === 0) {
    console.log(`run-clash: ticket id ${ticketId} is free`);
    return 0;
  }

  console.log(`run-clash: ticket id ${ticketId} is unavailable`);
  for (const clash of clashes) console.log(`run-clash: existing ${clash}`);
  console.log(
    "run-clash: ask the user to archive or rename the old run, or choose another id; the postmaster does not rename or remove anything",
  );
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
