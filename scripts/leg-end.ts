// End a leg: check its hand-off, close the run-log section, log the hand-off,
// and write every end marker the leg is owed, so none of them can be left out.
// The last leg is owed .card-ready beside .leg-<n>-done; any earlier leg is
// owed .leg-<n>-done alone. The markers go last, .card-ready first, so a leg
// interrupted between them is missing its done marker rather than its card.
//
//   run leg-end <dispatch> <leg> <detail...>
//
//   exit 0  the hand-off passed and every marker is written
//   exit 1  usage, no dispatch, the legs cannot be read, or a step failed
//   exit 2  the hand-off is incomplete; handoff-check names what is missing
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);

function fail(msg: string): number {
  console.error(`leg-end: ${msg}`);
  return 1;
}

/** The run's last leg number, from its legs, or null when they cannot be read. */
export function lastLeg(dispatch: string): number | null {
  const legs = run(join(HERE, "run"), ["turnpikes", "legs", dispatch]);
  if (legs.code !== 0) {
    if (legs.err) process.stderr.write(legs.err);
    if (legs.out) process.stdout.write(legs.out);
    return null;
  }
  const lines = legs.out.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const first = (lines[lines.length - 1] ?? "").trim().split(/[ \t]+/u)[0] ?? "";
  if (!/^[1-9][0-9]*$/u.test(first)) return null;
  return Number(first);
}

export function endLeg(dispatch: string, leg: string, detail: string): number {
  if (!/^[1-9][0-9]*$/u.test(leg)) return fail(`a leg is a whole number from 1: ${leg}`);
  const handoff = join(dispatch, `handoff-${leg}.md`);
  const check = run(join(HERE, "run"), ["handoff-check", handoff]);
  if (check.out) process.stdout.write(check.out);
  if (check.err) process.stderr.write(check.err);
  if (check.code !== 0) return check.code === 2 ? 2 : 1;
  const last = lastLeg(dispatch);
  if (last === null) return fail(`the run's legs cannot be read`);
  const close = run(join(HERE, "run"), ["run-log", dispatch, "--close"]);
  if (close.out) process.stdout.write(close.out);
  if (close.err) process.stderr.write(close.err);
  if (close.code !== 0) return fail("the run-log section could not be closed");
  const logged = run(join(HERE, "run"), [
    "log-action",
    dispatch,
    "coachman",
    "handoff",
    `handoff-${leg}.md`,
    detail,
  ]);
  if (logged.out) process.stdout.write(logged.out);
  if (logged.err) process.stderr.write(logged.err);
  if (logged.code !== 0) return fail("the handoff could not be logged");
  const markers =
    Number(leg) === last ? [".card-ready", `.leg-${leg}-done`] : [`.leg-${leg}-done`];
  for (const marker of markers) {
    try {
      writeFileSync(join(dispatch, marker), "");
    } catch (e) {
      return fail(`${marker} could not be written (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  console.log(`leg ${leg} ended: ${markers.join(", ")}`);
  return 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.length < 3 || (argv[0] ?? "").startsWith("-")) {
    console.error("usage: run leg-end <dispatch> <leg> <detail...>");
    process.exit(1);
  }
  process.exit(endLeg(argv[0] as string, argv[1] as string, argv.slice(2).join(" ")));
}
