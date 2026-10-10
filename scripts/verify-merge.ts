#!/usr/bin/env bun
// Checks the merge commit's message, resolution and private project tree.
import { join, resolve } from "node:path";
import { run } from "./lib/proc.ts";
import { git, resolveCommit } from "./scrub-core.ts";
import { fail } from "./scrub-report.ts";
import { pyWords } from "./lib/text.ts";

const USAGE = "usage: run verify-merge <repo> [<merge>] [--dispatch <dir>] | --help";

async function main(args: string[]): Promise<number> {
  if (args[0] === "--help" && args.length === 1) {
    console.error(USAGE);
    return 0;
  }
  let dispatch = "";
  let flag = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dispatch") {
      flag = true;
      dispatch = args[i + 1] ?? "";
      i++;
    } else positional.push(args[i]!);
  }
  if (!positional.length || positional.length > 2 || (flag && !dispatch))
    fail("verify-merge", USAGE);
  const root = resolve(positional[0]!);
  const merge = resolveCommit(positional[1] ?? "HEAD", root);
  const row = pyWords(
    git(["rev-list", "--parents", "-n", "1", merge], root).toString("ascii").trim(),
  );
  if (row.length !== 3) fail("verify-merge", "the requested commit is not a two-parent merge");
  const base = row[1]!;
  const runner = resolve(import.meta.dir, "run");
  // The merge scans log to the dispatch when one is named, so merge-only
  // findings reach TELL and the card like any other finding.
  const env: Record<string, string | undefined> = { SCRUB_CHECK_DISABLE: undefined };
  if (dispatch) env.POSTMASTER_DETECTIONS_LOG = join(dispatch, "detections.jsonl");
  const scan = run(runner, ["scrub-check", base, merge], { cwd: root, env });
  const treeScan = run(runner, ["tree-check", base, merge], { cwd: root, env });
  if (scan.out) process.stdout.write(scan.out);
  if (treeScan.out) process.stdout.write(treeScan.out);
  if ([scan.code, treeScan.code].some((code) => code === 2 || (code !== 0 && code !== 1)))
    fail("verify-merge", "a merge scan could not finish");
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
