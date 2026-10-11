// Applies the rules that method.md fixed before any arrangement was read, module by module and
// mode by mode, to the first five valid sessions of each arrangement.
//
//   bun --no-env-file --config=/dev/null verdicts.ts --trial <trial folder> --readers <folder> --mode <careful|quick>
//
// Careful mode: easier when the interval of the ratio of mean output tokens (to over from) lies
// below 1 and the share right is not lower by more than 5 points; harder when that interval lies
// above 1 or the share right is lower by more than 5 points; otherwise no difference.
// Quick mode: easier when the interval of the paired difference in the share right lies above zero,
// harder when it lies below zero, otherwise no difference. Intervals are the bootstrap 95% ones of
// tabulate.ts. The numbers are printed unrounded to three places, so a bound at 1.00 reads as it is.
import { load, pairedDifference, perQuestion, ratioOfMeans, takeValid } from "./tabulate.ts";

export type Verdict = "easier" | "harder" | "no difference";

export function verdict(
  mode: "careful" | "quick",
  share: Readonly<{ mean: number; lo: number; hi: number }>,
  ratio: Readonly<{ lo: number; hi: number }>,
): Verdict {
  if (mode === "quick") return share.lo > 0 ? "easier" : share.hi < 0 ? "harder" : "no difference";
  if (ratio.lo > 1 || share.mean < -0.05) return "harder";
  return ratio.hi < 1 && share.mean >= -0.05 ? "easier" : "no difference";
}

function main(): void {
  const at = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const trial = at("--trial");
  const readers = at("--readers");
  const mode = at("--mode");
  if (trial === undefined || readers === undefined || (mode !== "careful" && mode !== "quick")) {
    console.error("usage: verdicts.ts --trial <folder> --readers <folder> --mode careful|quick");
    process.exit(2);
  }
  const sessions = takeValid(load(trial, readers).valid, 5);
  const modules = [...new Set(sessions.map((s) => s.module))].sort();
  console.log("module\tfrom\tto\tshare_diff_points\tlo\thi\ttokens_ratio\tlo\thi\tverdict");
  for (const module of modules) {
    const mine = sessions.filter((s) => s.module === module);
    const tokens = (a: string): number[] =>
      mine.filter((s) => s.arrangement === a).map((s) => s.effort.outputTokens);
    for (const [from, to] of [
      ["original", "functional"],
      ["original", "tidy"],
      ["tidy", "functional"],
    ] as const) {
      const d = pairedDifference(perQuestion(mine, from), perQuestion(mine, to));
      const r = ratioOfMeans(tokens(from), tokens(to));
      const f = (x: number): string => x.toFixed(3);
      const p = (x: number): string => (100 * x).toFixed(1);
      const cols = [module, from, to, p(d.mean), p(d.lo), p(d.hi), f(r.ratio), f(r.lo), f(r.hi)];
      console.log([...cols, verdict(mode, d, r)].join("\t"));
    }
  }
}

if (import.meta.main) main();
