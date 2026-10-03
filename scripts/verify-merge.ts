// Scan the merge a ship leg just made: its message and its resolution.
//
//   verify-merge.sh <repo> [<merge>]   scan merge (default HEAD) against
//                                      its first parent; run from anywhere
//   verify-merge.sh --help
//
// The branch gate scans the branch's range, but the stage-3 merge onto
// the default branch lands two things no branch range holds: the merge
// commit's own message, and its resolution of the two sides. This holds
// both to the same checks the gate ran: the scrub over <merge>^1 <merge>,
// and the tree check over the same range. It prints no values.
//
//   exit 0  the merge is clean
//   exit 1  findings, one per line on stdout
//   exit 2  usage, not a repository, an unresolvable merge, a merge that
//           is not a merge commit, or a scan that could not finish
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const USAGE = "usage: verify-merge.sh <repo> [<merge>] | --help";

function fail(msg: string, code = 2): never {
  console.error(`verify-merge: ${msg}`);
  process.exit(code);
}

function git(args: string[], cwd: string): string {
  try {
    return (execFileSync("git", args, { cwd, encoding: "utf-8" }) as string).trim();
  } catch {
    fail("Git could not read the requested history");
  }
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args.length < 1 || args.length > 2) {
    console.error(USAGE);
    return 2;
  }
  const repo = resolve(args[0]!);
  const merge = args[1] ?? "HEAD";
  try {
    execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], {
      stdio: "ignore",
    });
  } catch {
    fail(`not a repository: ${args[0]}`);
  }
  let mergeSha: string;
  try {
    mergeSha = (execFileSync(
      "git",
      ["-C", repo, "rev-parse", "--verify", "--quiet", `${merge}^{commit}`],
      { encoding: "utf-8" },
    ) as string).trim();
  } catch {
    fail(`not a commit: ${merge}`);
  }
  const parents = git(
    ["-C", repo, "rev-list", "--parents", "-n", "1", mergeSha],
    repo,
  ).split(/\s+/u);
  if (parents.length !== 3) fail(`not a merge commit: ${merge}`);
  const base = parents[1]!;

  // A test hook must not green this scan.
  delete process.env.SCRUB_CHECK_DISABLE;

  const scrubBin = join(HERE, "scrub-check.sh");
  const treeBin = join(HERE, "tree-check.sh");
  let scrubCode = 0;
  let treeCode = 0;
  try {
    execFileSync(scrubBin, [base, mergeSha], {
      cwd: repo,
      encoding: "utf-8",
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (e) {
    scrubCode = (e as { status?: number }).status ?? 2;
  }
  try {
    execFileSync(treeBin, [base, mergeSha], {
      cwd: repo,
      encoding: "utf-8",
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (e) {
    treeCode = (e as { status?: number }).status ?? 2;
  }
  if (scrubCode === 2 || treeCode === 2) {
    console.error("verify-merge: a scan that could not finish fails the merge");
    return 2;
  }
  return scrubCode === 1 || treeCode === 1 ? 1 : 0;
}

try {
  process.exit(main());
} catch {
  console.error("verify-merge: scan failed");
  process.exit(2);
}
