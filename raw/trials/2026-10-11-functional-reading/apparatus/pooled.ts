// Pools the modules of the trial. Not part of what was fixed before the readers ran: it is made
// afterwards, and the record says so.
//
//   bun --no-env-file --config=/dev/null pooled.ts --trial <trial folder> --readers <folder>
//     [--take <n>]
//
// For each pair of arrangements, prints the geometric mean over the modules of the ratio of mean
// output tokens (to over from), and the mean over every question of every module of the difference in
// the share answered right (to minus from), each with a bootstrap 95% interval. The token ratio
// resamples sessions within each module and arrangement; the share difference resamples questions.
import { pairedDifference, lcg, load, perQuestion, takeValid, type Session } from "./tabulate.ts";

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

const tokens = (sessions: readonly Session[], module: string, arrangement: string): number[] =>
  sessions
    .filter((s) => s.module === module && s.arrangement === arrangement)
    .map((s) => s.effort.outputTokens);

/** The geometric mean over modules of mean(to) / mean(from), and its bootstrap 95% interval. */
export function pooledRatio(
  from: ReadonlyMap<string, readonly number[]>,
  to: ReadonlyMap<string, readonly number[]>,
  seed = 1,
  resamples = 2000,
): Readonly<{ modules: number; ratio: number; lo: number; hi: number }> {
  const modules = [...from.keys()].filter((m) => to.has(m));
  const geo = (
    a: ReadonlyMap<string, readonly number[]>,
    b: ReadonlyMap<string, readonly number[]>,
  ) => Math.exp(mean(modules.map((m) => Math.log(mean(b.get(m) ?? []) / mean(a.get(m) ?? [])))));
  if (modules.length === 0) return { modules: 0, ratio: 0, lo: 0, hi: 0 };
  const next = lcg(seed);
  const draw = (xs: readonly number[]): number[] =>
    Array.from({ length: xs.length }, () => xs[Math.floor(next() * xs.length)] ?? 0);
  const ratios = Array.from({ length: resamples }, () => {
    const a = new Map(modules.map((m) => [m, draw(from.get(m) ?? [])]));
    const b = new Map(modules.map((m) => [m, draw(to.get(m) ?? [])]));
    return geo(a, b);
  }).sort((x, y) => x - y);
  return {
    modules: modules.length,
    ratio: geo(from, to),
    lo: ratios[Math.floor(0.025 * resamples)] ?? 0,
    hi: ratios[Math.floor(0.975 * resamples) - 1] ?? 0,
  };
}

function main(): void {
  const at = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const trial = at("--trial");
  const readers = at("--readers");
  if (trial === undefined || readers === undefined) {
    console.error("usage: pooled.ts --trial <trial folder> --readers <folder> [--take <n>]");
    process.exit(2);
  }
  const takeArg = at("--take");
  const sessions = takeValid(
    load(trial, readers).valid,
    takeArg === undefined ? undefined : Number(takeArg),
  );
  const modules = [...new Set(sessions.map((s) => s.module))].sort();
  console.log(
    "from\tto\tmodules\ttokens_ratio\tlo\thi\tshare_difference_points\tlo\thi\tquestions",
  );
  for (const [from, to] of [
    ["original", "functional"],
    ["original", "tidy"],
    ["tidy", "functional"],
  ] as const) {
    const t = pooledRatio(
      new Map(modules.map((m) => [m, tokens(sessions, m, from)])),
      new Map(modules.map((m) => [m, tokens(sessions, m, to)])),
    );
    const key = (m: string, shares: ReadonlyMap<string, number>) =>
      new Map([...shares].map(([id, v]) => [`${m}/${id}`, v]));
    const merge = (arrangement: string) =>
      new Map(
        modules.flatMap((m) => [
          ...key(
            m,
            perQuestion(
              sessions.filter((s) => s.module === m),
              arrangement,
            ),
          ),
        ]),
      );
    const d = pairedDifference(merge(from), merge(to));
    const pct = (x: number): string => (100 * x).toFixed(1);
    const f = (x: number): string => x.toFixed(2);
    console.log(
      [
        from,
        to,
        t.modules,
        f(t.ratio),
        f(t.lo),
        f(t.hi),
        pct(d.mean),
        pct(d.lo),
        pct(d.hi),
        d.n,
      ].join("\t"),
    );
  }
}

if (import.meta.main) main();
