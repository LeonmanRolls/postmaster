// The manual dispatch's test-file runner: the workflow binds its `files` input
// through `env:` as FILES, never interpolating it into the shell, and this
// script splits it on whitespace, accepts only entries that are tracked test
// files of this repository, and runs `bun test` with the argument list built
// from the validated entries, never from the raw string. Anything else fails
// before any test runs.
//
//   FILES="scripts/reach.test.ts scripts/launch.test.ts" bun scripts/manual-test-files.ts
//
//   exit 0  the named tests ran and passed
//   exit 1  a name was refused, FILES named nothing, git failed, or the tests failed
import { spawnSync } from "node:child_process";

/** The FILES value split on whitespace; empty pieces dropped. */
export function splitFiles(raw: string): string[] {
  // ASCII: splitting wider than ASCII only adds refusals; entries must match tracked paths exactly.
  return raw.split(/\s+/u).filter((s) => s.length > 0);
}

/** True when the entry names a test file this repository runs. */
export function isTestFile(entry: string): boolean {
  return entry.endsWith(".test.ts");
}

/** The entries, when each is tracked and a test file; throws naming the first refusal. */
export function validateFiles(entries: string[], tracked: Set<string>): string[] {
  if (entries.length === 0) throw new Error("FILES names no files");
  for (const entry of entries) {
    if (!tracked.has(entry))
      throw new Error(`refusing ${JSON.stringify(entry)}: not a tracked file`);
    if (!isTestFile(entry))
      throw new Error(`refusing ${JSON.stringify(entry)}: tracked but not a test file`);
  }
  return entries;
}

/** The paths git tracks under cwd; throws when git fails, so a missing repo refuses. */
export function trackedFiles(cwd: string): Set<string> {
  const ls = spawnSync("git", ["ls-files"], { cwd, encoding: "utf-8" });
  if (ls.status !== 0) throw new Error(`git ls-files failed: ${(ls.stderr ?? "").trim()}`);
  return new Set(ls.stdout.split("\n").filter((s) => s.length > 0));
}

/** Validate FILES against the tracked files under cwd, then run the tests. */
export function main(env: Record<string, string | undefined>, cwd: string): number {
  let files: string[];
  try {
    files = validateFiles(splitFiles(env.FILES ?? ""), trackedFiles(cwd));
  } catch (err) {
    console.error(`manual-test-files: ${(err as Error).message}`);
    return 1;
  }
  const ran = spawnSync("bun", ["test", ...files], { cwd, stdio: "inherit" });
  return ran.status ?? 1;
}

if (import.meta.main) process.exit(main(process.env, process.cwd()));
