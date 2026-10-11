// Refuse a Bun below the tool's minimum before a script loads. scripts/run runs this in
// its own process ahead of the script's, so a Bun too old to load the scripts still stops
// here with the two versions named. The minimum is engines.bun in the tool's own
// package.json: one number to change when it moves, read from the manifest the tool
// already names it in, never copied into this file.
//
//   run bun-min <package.json>       (the start command's form; also scripts/run bun-min)
//
//   exit 0  the running Bun meets the minimum, or the manifest names no version
//   exit 1  it is below the minimum (the message on stderr), or engines.bun holds a
//           version-shaped range with no version in it
//   exit 2  usage
import { readFileSync } from "node:fs";

/** The first `X.Y.Z` a range like `>=1.4.2` names, or null when it names none. */
export function minimumOf(range: string): string | null {
  // ASCII: a version is ASCII digits, dots and a suffix, never text from elsewhere.
  const m = /(\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?)/u.exec(range);
  return m === null ? null : m[1]!;
}

/** Numeric order, so 1.10.0 is above 1.4.2 and 1.4.1 is below 1.4.2: every part compared
 * as a number, a missing part counting as 0, a pre-release suffix ignored. Either side
 * naming no digits reports null. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parts(a);
  const pb = parts(b);
  if (pa === null || pb === null) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parts(version: string): number[] | null {
  // ASCII: a version's parts are ASCII digits.
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(version.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** The one version message: names what is needed and what was found. */
export function bunVersionMessage(name: string, minimum: string, found: string): string {
  return `run: ${name} needs Bun ${minimum} or newer, found Bun ${found}`;
}

function main(argv: string[]): number {
  if (argv.length !== 1) {
    console.error("usage: run bun-min <package.json>");
    return 2;
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(argv[0]!, "utf-8"));
  } catch {
    console.error(`run: cannot read ${argv[0]}`);
    return 1;
  }
  const engines =
    pkg !== null && typeof pkg === "object" ? (pkg as Record<string, unknown>)["engines"] : null;
  const range =
    engines !== null && typeof engines === "object"
      ? (engines as Record<string, unknown>)["bun"]
      : null;
  if (range === null || range === undefined) return 0;
  const name =
    pkg !== null && typeof pkg === "object"
      ? String((pkg as Record<string, unknown>)["name"] ?? "this tool")
      : "this tool";
  const minimum = minimumOf(typeof range === "string" ? range : "");
  if (minimum === null) {
    console.error("run: engines.bun names no version");
    return 1;
  }
  const found = Bun.version;
  const cmp = compareVersions(found, minimum);
  if (cmp === null) {
    console.error(`run: Bun reports a version with no digits: ${found}`);
    return 1;
  }
  if (cmp < 0) {
    console.error(bunVersionMessage(name, minimum, found));
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
