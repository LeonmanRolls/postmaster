// Run a script from a run's pinned copy of the tool, in that copy's own form. A copy pinned
// before the entry change has no scripts/run and serves each script as scripts/<name>.sh;
// a copy pinned after serves scripts/run <name>. The supervising tool never guesses which
// form a pin has: it asks this.
import { constants, accessSync } from "node:fs";
import { join } from "node:path";
import { run, type RunResult } from "./proc.ts";

/** True when the copy carries the scripts/run entry. */
export function hasEntry(copy: string): boolean {
  try {
    accessSync(join(copy, "scripts", "run"), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run `<name>` from `copy` in that copy's own form. A copy with the entry runs
 * `scripts/run <name> [args]`; a copy without runs `scripts/<name>.sh [args]`. */
export function runFromPin(copy: string, name: string, args: string[]): RunResult {
  const scripts = join(copy, "scripts");
  if (hasEntry(copy)) return run(join(scripts, "run"), [name, ...args]);
  return run(join(scripts, `${name}.sh`), args);
}

/** The command runFromPin would run, for messages and checks. */
export function pinCommand(copy: string, name: string): string {
  return hasEntry(copy)
    ? join(copy, "scripts", "run") + ` ${name}`
    : join(copy, "scripts", `${name}.sh`);
}
