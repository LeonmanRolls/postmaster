// Which rule of the review loop each run's pinned commit carried (see ../method.md).
//
//   bun --no-env-file --config=/dev/null loop-rule.ts --results <dir> --repo <checkout> \
//       --scripted <commit> --rise <commit>
//
// Writes <dir>/loop-rule.json. `--scripted` is the commit that made the loop's decision a script
// with a cap of three rounds, `--rise` the one that made it go on until a round finds more than
// the one before. A pinned commit carries a change when that change is among its ancestors. Two
// controls run first and stop the script when they fail: a boundary commit holds itself, and its
// parent does not hold it.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRow } from "./inventory.ts";
import { type LoopRule, ruleOf } from "./rise.ts";

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** 0 is true, 1 false, anything else (an object git does not have) unknown. */
const holds = (repo: string, change: string, commit: string): boolean | null => {
  const r = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", change, commit], {
    encoding: "utf8",
  });
  if (r.status === 0) return true;
  return r.status === 1 ? false : null;
};

const resolve = (repo: string, name: string): string => {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--verify", `${name}^{commit}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`no commit ${name} in ${repo}`);
  return r.stdout.trim();
};

const main = (args: string[]): void => {
  const dir = arg(args, "--results");
  const repo = arg(args, "--repo");
  const scripted = arg(args, "--scripted");
  const rise = arg(args, "--rise");
  if (!dir || !repo || !scripted || !rise) {
    throw new Error(
      "usage: loop-rule.ts --results <dir> --repo <checkout> --scripted <commit> --rise <commit>",
    );
  }
  const boundaries = { scripted: resolve(repo, scripted), rise: resolve(repo, rise) };
  const controls = {
    scriptedHoldsItself: holds(repo, boundaries.scripted, boundaries.scripted),
    scriptedParentHoldsIt: holds(repo, boundaries.scripted, `${boundaries.scripted}^`),
    riseHoldsItself: holds(repo, boundaries.rise, boundaries.rise),
    riseParentHoldsIt: holds(repo, boundaries.rise, `${boundaries.rise}^`),
  };
  if (
    controls.scriptedHoldsItself !== true ||
    controls.riseHoldsItself !== true ||
    controls.scriptedParentHoldsIt !== false ||
    controls.riseParentHoldsIt !== false
  ) {
    throw new Error(`a control failed: ${JSON.stringify(controls)}`);
  }
  const rows = (JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")) as { runs: RunRow[] })
    .runs;
  const runs = rows.map((r) => {
    const pin = r.pin ?? null;
    const rule: LoopRule | null =
      pin === null
        ? null
        : ruleOf(holds(repo, boundaries.scripted, pin), holds(repo, boundaries.rise, pin));
    return { run: r.run, pin, rule };
  });
  writeFileSync(
    join(dir, "loop-rule.json"),
    `${JSON.stringify({ boundaries, controls, runs }, null, 1)}\n`,
  );
  const known = runs.filter((r) => r.rule !== null).length;
  console.error(
    `${known} of ${runs.length} runs have a rule; controls ${JSON.stringify(controls)}`,
  );
};

main(process.argv.slice(2));
