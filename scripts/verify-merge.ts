#!/usr/bin/env bun
// Checks the merge commit's message, resolution and private project tree.
import { resolve } from "node:path";
import { run } from "./lib/proc.ts";
import { git, resolveCommit } from "./scrub-core.ts";
import { pyWords } from "./lib/text.ts";

const USAGE = "usage: verify-merge.sh <repo> [<merge>] | --help";
function fail(message: string): never {
  console.error(`verify-merge: ${message}`);
  process.exit(2);
}

async function main(args: string[]): Promise<number> {
  if (args[0] === "--help" && args.length === 1) {
    console.error(USAGE);
    return 0;
  }
  if (args.length < 1 || args.length > 2) fail(USAGE);
  const root = resolve(args[0]!);
  const merge = resolveCommit(args[1] ?? "HEAD", root);
  const row = pyWords(
    git(["rev-list", "--parents", "-n", "1", merge], root).toString("ascii").trim(),
  );
  if (row.length !== 3) fail("the requested commit is not a two-parent merge");
  const base = row[1]!;
  const scrub = resolve(import.meta.dir, "scrub-check.sh");
  const tree = resolve(import.meta.dir, "tree-check.sh");
  const env = { SCRUB_CHECK_DISABLE: undefined };
  const scan = run(scrub, [base, merge], { cwd: root, env });
  const treeScan = run(tree, [base, merge], { cwd: root, env });
  if (scan.out) process.stdout.write(scan.out);
  if (treeScan.out) process.stdout.write(treeScan.out);
  if ([scan.code, treeScan.code].some((code) => code === 2 || (code !== 0 && code !== 1)))
    fail("a merge scan could not finish");
  return scan.code === 1 || treeScan.code === 1 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch {
    console.error("verify-merge: merge scan could not finish");
    process.exit(2);
  }
}
