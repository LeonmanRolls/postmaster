import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

/** The names the install guard shims on an armed PATH: the managers,
 * npx, bunx under its documented name, and corepack, which always refuses. */
export const GUARD_SHIM_NAMES = ["npm", "pnpm", "yarn", "bun", "npx", "bunx", "corepack"] as const;

/** Create the run's guard bin dir with its manager shims, idempotently.
 * Returns the bin dir. A dangling or wrong link is repaired; anything in the
 * way that is not a link throws, and the caller dies, since a lane that
 * reads as guarded but is not would install unguarded. */
export function ensureGuardBin(dispatch: string, tool: string): string {
  const bin = join(dispatch, "guard", "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(tool, "scripts", "install-guard-shim");
  for (const name of GUARD_SHIM_NAMES) {
    const link = join(bin, name);
    // Missing reads null, a non-link reads false, and a link reads its
    // target without touching it, so a dangling link repairs instead of
    // throwing EEXIST.
    const current = ((): string | false | null => {
      try {
        return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : false;
      } catch {
        return null;
      }
    })();
    if (current === false) throw new Error(`cannot arm the install guard: ${link} is in the way`);
    if (current === shim) continue;
    if (current !== null) rmSync(link, { force: true });
    symlinkSync(shim, link);
  }
  return bin;
}
