// The old-Bun job's driver: every script the start command can run, started through it
// with no arguments under a Bun below engines.bun, must stop in the start command with
// the version message and nothing on stdout. Run it directly (`bun scripts/old-bun.ts`)
// with the older Bun first on PATH: under a Bun that meets the minimum it refuses to run,
// so the enumeration never fires bare scripts by accident.
//
//   bun scripts/old-bun.ts
//
//   exit 0  every script stopped on the version message
//   exit 1  a script ran, printed to stdout, or named some other message
//   exit 2  this Bun meets engines.bun, so the refusal cannot be shown
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bunVersionMessage, compareVersions, minimumOf } from "./lib/bun-min.ts";

/** Every name the start command resolves: the .ts files beside it and in its lib folder,
 * tests aside, as the bare name `run` takes (it finds lib's files without the folder). */
export function scriptNames(dir: string): string[] {
  const names = new Set<string>();
  for (const sub of ["", "lib"]) {
    for (const e of readdirSync(join(dir, sub))) {
      if (e.endsWith(".ts") && !e.endsWith(".test.ts")) names.add(e.slice(0, -3));
    }
  }
  return [...names].sort();
}

/** One script's verdict under an old Bun: stopped on the version message, or not. */
export function verdict(
  name: string,
  status: number | null,
  stdout: string,
  stderr: string,
  expected: string,
): string | null {
  if (status === null || status === 0) {
    return `${name}: exited ${status === null ? "not at all" : "0"}, so the script ran past the version check`;
  }
  if (stdout !== "") return `${name}: printed to stdout instead of only the version message`;
  if (stderr.trim() !== expected) {
    return `${name}: stderr was ${JSON.stringify(stderr.trim())}, not the version message`;
  }
  return null;
}

function main(argv: string[]): number {
  if (argv.length !== 0) {
    console.error("usage: bun scripts/old-bun.ts");
    return 2;
  }
  // Started through the start command during a drive: the check let this file load, which
  // the drive exists to catch. Stop here rather than driving a drive.
  if (process.env.POSTMASTER_OLD_BUN_DRIVE !== undefined) {
    console.error("old-bun: started through run during a drive");
    return 2;
  }
  const dir = import.meta.dir;
  const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf-8")) as {
    name?: string;
    engines?: { bun?: string };
  };
  const minimum = minimumOf(pkg.engines?.bun ?? "");
  if (minimum === null) {
    console.error("old-bun: package.json's engines.bun names no version");
    return 1;
  }
  const found = Bun.version;
  const cmp = compareVersions(found, minimum);
  if (cmp !== null && cmp >= 0) {
    console.error(`old-bun: needs a Bun below ${minimum} to show the refusal; found Bun ${found}`);
    return 2;
  }
  const expected = bunVersionMessage(pkg.name ?? "this tool", minimum, found);
  const runCmd = join(dir, "run");
  const faults: string[] = [];
  const names = scriptNames(dir);
  const childEnv = { ...process.env, POSTMASTER_OLD_BUN_DRIVE: "1" };
  for (const name of names) {
    const r = spawnSync("bash", [runCmd, name], { encoding: "utf-8", env: childEnv });
    const fault = verdict(name, r.status, r.stdout, r.stderr, expected);
    if (fault !== null) faults.push(fault);
  }
  for (const f of faults) console.error(`FAIL: ${f}`);
  console.log(`${names.length - faults.length} of ${names.length} scripts refused on Bun ${found}`);
  return faults.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
