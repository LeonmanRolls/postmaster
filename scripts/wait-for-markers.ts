import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const args = process.argv.slice(2);
const here = scriptDir(import.meta.url);
const self = join(here, "wait-for-markers.sh");
let failures = 0;
function ok(label: string): void {
  writeOut(`  ok   ${label}`);
}
function fail(label: string, result?: { code: number; stdout: string; stderr: string }): void {
  writeOut(`  FAIL ${label}${result ? ` (exit ${result.code})` : ""}`);
  if (result) for (const line of `${result.stdout}${result.stderr}`.trim().split("\n")) writeOut(`         ${line}`);
  failures++;
}
function has(text: string, part: string): boolean {
  return text.includes(part);
}
function globRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
function count(dir: string, glob: string): number {
  const matcher = globRegex(glob);
  try {
    return (readdirSync(dir) as string[]).filter((name: string) => matcher.test(name)).length;
  } catch {
    return 0;
  }
}
async function waitFor(
  dir: string,
  glob: string,
  wanted: number,
  timeout: number,
): Promise<{ code: number; output: string }> {
  const control = join(dir, `.wait-for-markers-control.${process.pid}`);
  try {
    writeFileSync(control, "");
  } catch {
    /* The planted file remains absent and proves a read failure. */
  }
  const positive = count(dir, basename(control));
  const negative = count(dir, `.wait-for-markers-impossible-${process.pid}-*`);
  try {
    rmSync(control, { force: true });
  } catch {
    /* The directory may be read-only. */
  }
  if (positive !== 1 || negative !== 0)
    return {
      code: 1,
      output: `wait-for-markers: reader failed its control (positive=${positive} negative=${negative})`,
    };
  let left = timeout;
  while (count(dir, glob) < wanted) {
    if (left <= 0) {
      const matches = (readdirSync(dir) as string[]).filter((name: string) => globRegex(glob).test(name));
      return {
        code: 3,
        output: `WAIT-TIMEOUT after ${timeout}s: ${matches.length} of ${wanted} markers matching ${glob}${matches.length ? `\n${matches.map((m: string) => `  present: ${join(dir, m)}`).join("\n")}` : ""}`,
      };
    }
    const nap = Math.min(left, 20);
    await Bun.sleep(nap * 1000);
    left -= nap;
  }
  return { code: 0, output: `all ${wanted} markers present` };
}

async function selfTest(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "wait-for-markers-"));
  const dir = join(temp, "logs");
  mkdirSync(dir);
  const run = (d: string, glob: string, countArg: string, timeout: string, env?: Record<string, string | undefined>) =>
    command(self, [d, glob, countArg, timeout], { env });
  try {
    writeOut("positive controls");
    writeFileSync(join(dir, "review-r1-bug-one.done"), "");
    writeFileSync(join(dir, "review-r1-bug-two.done"), "");
    let result = run(dir, "review-r1-*.done", "2", "5");
    if (result.code === 0 && result.stdout.trim() === "all 2 markers present")
      ok("markers already in are collected at once");
    else fail("markers already in are collected at once", result);
    spawn("sh", ["-c", `sleep 1; touch '${join(dir, "review-r2-bug-one.done")}'`], { stdio: "ignore" });
    result = run(dir, "review-r2-*.done", "1", "3");
    if (result.code === 0 && result.stdout.trim() === "all 1 markers present")
      ok("a marker that lands during the wait is collected by the timeout");
    else fail("a marker that lands during the wait is collected by the timeout", result);
    for (let i = 1; i <= 9; i++) writeFileSync(join(dir, `review-r5-bug-${i}.done`), "");
    result = run(dir, "review-r5-*.done", "010", "1");
    if (result.code === 3 && has(result.stdout, "9 of 10 markers"))
      ok("a count with a leading zero is decimal: 010 is ten, which nine markers do not meet");
    else fail("a count with a leading zero is decimal: 010 is ten, which nine markers do not meet", result);

    writeOut("negative controls");
    writeFileSync(join(dir, "review-r3-bug-one.done"), "");
    writeFileSync(join(dir, "review-r4-bug-two.done"), "");
    result = run(dir, "review-r3-*.done", "2", "1");
    if (
      result.code === 3 &&
      has(result.stdout, "WAIT-TIMEOUT after 1s: 1 of 2 markers matching review-r3-*.done") &&
      has(result.stdout, `present: ${join(dir, "review-r3-bug-one.done")}`) &&
      !has(result.stdout, "review-r4")
    )
      ok("a missing marker times out, and another round's marker is not counted");
    else fail("a missing marker times out, and another round's marker is not counted", result);
    const started = Date.now();
    result = run(dir, "review-r3-*.done", "2", "2");
    if (result.code === 3 && Date.now() - started >= 2000)
      ok("the timeout is kept to the second, not the next 20-second look");
    else fail("the timeout is kept to the second, not the next 20-second look", result);
    const clockDir = join(temp, "clock");
    mkdirSync(clockDir);
    const fakeDate = join(clockDir, "date");
    writeFileSync(
      fakeDate,
      `#!/bin/sh\nf='${join(clockDir, "n")}'\nn=$(cat "$f" 2>/dev/null || echo 0); echo $((n + 1)) > "$f"\nexec /bin/date "$@" -d "@$(( $(/bin/date +%s) + n * 3600 ))"\n`,
    );
    chmodSync(fakeDate, 0o755);
    const startClock = Date.now();
    result = run(dir, "review-r3-*.done", "2", "2", { PATH: `${clockDir}:${process.env.PATH ?? ""}` });
    if (result.code === 3 && Date.now() - startClock >= 2000)
      ok("a clock that jumps ahead does not end the wait early");
    else fail("a clock that jumps ahead does not end the wait early", result);
    result = run(dir, "review-r1-*.done", "two", "5");
    if (result.code === 1 && !has(result.stdout + result.stderr, "markers present"))
      ok("a count that is not a number is refused, not read as every marker in");
    else fail("a count that is not a number is refused, not read as every marker in", result);
    result = run(dir, "review-r1-*.done", "2", "soon");
    if (result.code === 1) ok("a timeout that is not a number is refused");
    else fail("a timeout that is not a number is refused", result);
    result = run(dir, "review-r1-*.done", "2", "9999999999999999999");
    if (result.code === 1 && has(result.stderr, "more than 9 digits"))
      ok("a timeout past 9 digits is refused, never wrapped round to a past deadline");
    else fail("a timeout past 9 digits is refused, never wrapped round to a past deadline", result);
    result = run(join(temp, "nowhere"), "review-r1-*.done", "2", "1");
    if (result.code === 1 && has(result.stderr, "no such dir")) ok("a directory that does not exist is refused");
    else fail("a directory that does not exist is refused", result);
    if ((process.getuid?.() ?? -1) !== 0) {
      chmodSync(dir, 0o555);
      result = run(dir, "review-r1-*.done", "2", "1");
      chmodSync(dir, 0o755);
      if (result.code === 1 && has(result.stderr, "reader failed its control (positive=0"))
        ok("a reader that cannot see its own planted marker stops the wait");
      else fail("a reader that cannot see its own planted marker stops the wait", result);
    } else writeOut("  skip a reader that cannot see its own planted marker (root writes anywhere)");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  if (failures === 0) {
    writeOut("self-test: all controls behaved");
    process.exit(0);
  }
  writeOut(`self-test: ${failures} control(s) misbehaved`);
  process.exit(1);
}

if (args[0] === "--self-test") {
  if (args.length !== 1) {
    writeError("usage: wait-for-markers.sh <dir> <glob> <count> <timeout-seconds> | --self-test");
    process.exit(1);
  }
  await selfTest();
}
if (args.length !== 4) {
  writeError("usage: wait-for-markers.sh <dir> <glob> <count> <timeout-seconds> | --self-test");
  process.exit(1);
}
const [dirArg, glob, countArg, timeoutArg] = args;
function number(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const decimal = value.replace(/^0+/, "") || "0";
  if (decimal.length > 9) return NaN;
  return Number(decimal);
}
const wanted = number(countArg);
const timeout = number(timeoutArg);
for (const value of [countArg, timeoutArg]) {
  const parsed = number(value);
  if (parsed === null) {
    writeError(`wait-for-markers: '${value}' is not a whole number of markers or seconds`);
    process.exit(1);
  }
  if (Number.isNaN(parsed)) {
    writeError(`wait-for-markers: '${value}' is more than 9 digits`);
    process.exit(1);
  }
}
let dir: string;
try {
  dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error();
} catch {
  writeError(`wait-for-markers: no such dir: ${dirArg}`);
  process.exit(1);
}
const result = await waitFor(dir, glob, wanted!, timeout!);
if (result.code === 0) writeOut(result.output);
else if (result.code === 3) {
  writeOut(result.output);
  process.exit(3);
} else {
  writeError(result.output);
  process.exit(1);
}
