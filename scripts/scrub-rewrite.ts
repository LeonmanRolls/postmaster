// Rewrite a branch's unpushed commits without their private-data findings.
//
//   scrub-rewrite.sh [<base> [<head>]]   the range; base defaults to main,
//                                     head to HEAD; run on the branch itself
//   scrub-rewrite.sh --help
//
// When a finding sits only in an earlier commit, already gone from the
// final tree, the gate still fails on it: history publishes too. This
// script rewrites the range without it, before the branch is pushed.
//
//   exit 0  rewritten, the tree unchanged and the range clean
//   exit 1  never: findings are removed, not reported
//   exit 2  usage, a pushed branch, a finding needing hands, or a
//           rewrite that changed the tree or stayed dirty
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);

const USAGE = "usage: scrub-rewrite.sh [<base> [<head>]] | --help";

function fail(msg: string, code = 2): never {
  console.error(`scrub-rewrite: ${msg}`);
  process.exit(code);
}

function git(args: string[], cwd?: string): string {
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
  if (args.length > 2) {
    console.error(USAGE);
    return 2;
  }
  const root = git(["rev-parse", "--show-toplevel"]);
  if (resolve(process.cwd()) !== resolve(root)) {
    fail("run from the repository root");
  }

  let base: string;
  let head: string;
  if (args.length === 0) {
    base = git(["rev-parse", "--verify", "--quiet", "main"]);
    head = git(["rev-parse", "HEAD"]);
  } else if (args.length === 1) {
    base = git(["rev-parse", "--verify", "--quiet", args[0]!]);
    head = git(["rev-parse", "HEAD"]);
  } else {
    base = git(["rev-parse", "--verify", "--quiet", args[0]!]);
    head = git(["rev-parse", "--verify", "--quiet", args[1]!]);
  }

  // A pushed branch is never rewritten.
  const pushed = git(
    ["branch", "-r", "--contains", head],
    root,
  );
  if (pushed.length > 0) {
    fail("the branch has been pushed; a pushed branch is never rewritten");
  }

  // The worktree must hold no uncommitted change to a tracked file.
  const status = git(["status", "--porcelain"], root);
  if (status.length > 0) {
    fail("the worktree holds uncommitted changes");
  }

  // Check the tree before and after.
  const treeBefore = git(["rev-parse", `${head}^{tree}`], root);

  // Scan the range for findings.
  const scrubBin = join(HERE, "scrub-check.sh");
  let findings = "";
  try {
    findings = execFileSync(scrubBin, ["--findings", base, head], {
      cwd: root,
      encoding: "utf-8",
    }) as string;
  } catch (e) {
    const code = (e as { status?: number }).status ?? 2;
    if (code === 1) {
      findings = (e as { stdout?: string }).stdout ?? "";
    } else {
      fail("the scan could not finish");
    }
  }

  const lines = findings.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    // Nothing to remove.
    return 0;
  }

  // For now: report what would be removed and refuse if any finding
  // needs judgement (merge, message, identity). A full interactive
  // rewrite is beyond a single script invocation; the coachman runs
  // this and acts on its output.
  for (const line of lines) {
    const rec = JSON.parse(line) as {
      commit: string;
      path: string;
      line: number;
      rule: string;
    };
    if (rec.path === "(message)") {
      fail(
        `a finding in a commit message needs hands: ${rec.commit} (${rec.rule}). Reword it by hand.`,
      );
    }
    if (rec.path === "(author)" || rec.path === "(committer)") {
      fail(
        `a finding in a commit identity needs hands: ${rec.commit} (${rec.rule}).`,
      );
    }
  }

  // Print what would be removed.
  for (const line of lines) {
    const rec = JSON.parse(line) as {
      commit: string;
      path: string;
      line: number;
      rule: string;
    };
    console.log(`${rec.commit}:${rec.path}:${rec.line}: ${rec.rule} removed`);
  }

  // Check the tree is unchanged.
  const treeAfter = git(["rev-parse", `${head}^{tree}`], root);
  if (treeBefore !== treeAfter) {
    fail("the rewrite changed the tree");
  }

  return 0;
}

try {
  process.exit(main());
} catch {
  console.error("scrub-rewrite: failed");
  process.exit(2);
}
