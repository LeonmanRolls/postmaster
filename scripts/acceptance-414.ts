// Support for the #414 oracle (scripts/acceptance-414.test.ts): a stand-in
// suite that reports its files and never ends, a fixture test that awaits a
// child past its own limit, and the concurrent-starts case of the host
// self-test as text.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repository root: this helper lives in scripts/. */
export function repoRoot(): string {
  return join(import.meta.dir, "..");
}

/** True inside a nested run this oracle started itself: the oracle skips
 * there, so a nested full suite never nests again. */
export function nestedThisRun(): boolean {
  return process.env.ACCEPTANCE_414_NESTED === "1";
}

/** Remove scratch directories, best-effort each. */
export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

/** A stand-in suite: prints two test-file report blocks in bun's shape, then
 * hangs with a leftover `sleep 60` behind a foreground `sleep 300`, so the
 * stuck-run stop has a stray to name. Runs with no arguments. */
export function makeStandinSuite(): { dir: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-414-standin-"));
  const script = join(dir, "standin.sh");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      "printf 'standin-a.test.ts:\\n(pass) a works [1ms]\\n\\nstandin-b.test.ts:\\n(pass) b works [1ms]\\n\\n'",
      "sleep 60 &",
      "sleep 300",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { dir, script };
}

/** A test that awaits a `sleep 30` child under a two-second limit, as C4
 * names it: its failure must list the child with pid, command and state. */
export function makeTimeoutFixture(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-414-timeout-"));
  const file = join(dir, "timeout.test.ts");
  // No assertion: the test never reaches one, and that is the point.
  writeFileSync(
    file,
    [
      'import { test } from "bun:test";',
      'import { spawn } from "node:child_process";',
      'test("awaits a child that never ends in time", async () => {',
      '  const child = spawn("sleep", ["30"]);',
      '  await new Promise((resolve) => child.once("exit", resolve));',
      "}, 2000);",
      "",
    ].join("\n"),
  );
  return { dir, file };
}

const RACE_START = 'prompt = join(legD, "race.txt")';
const RACE_END = "delta=${callsAfterRace - callsBeforeRace}";

/** The concurrent-starts case of the host self-test, from the stale lock it
 * leaves to the assertion that the harness ran once. The C1 fix changes this
 * case and no production behavior, so the oracle pins its mechanism here. */
export function raceCaseBlock(): string {
  const text = readFileSync(join(repoRoot(), "scripts/host-self-test.ts"), "utf8");
  const start = text.indexOf(RACE_START);
  const end = start < 0 ? -1 : text.indexOf(RACE_END, start);
  if (start < 0 || end < 0)
    throw new Error("acceptance-414: the concurrent-starts case moved its anchors");
  return text.slice(start, end + RACE_END.length);
}
