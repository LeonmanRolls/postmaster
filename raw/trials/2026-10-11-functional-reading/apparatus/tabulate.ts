// Scores every reader session found under a results folder and tabulates it.
//
//   bun --no-env-file --config=/dev/null tabulate.ts --trial <trial folder> [--readers <folder>]
//
// Reads <trial>/questions/<module>/{questions.json,answers.json} and, for each model, module and
// arrangement under the readers folder (default <trial>/readers), every s<i>.answers.json. Prints
// tab-separated rows: one per model, module, arrangement and question type ("all" is every
// question), with the sessions, the answers right out of those asked, the share and its Wilson
// 95% interval. Then one row per model and module with the paired difference between two
// arrangements, in percentage points, over the questions, and its bootstrap 95% interval.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Answers, type Question, scoreRun, type Scored, wilson } from "./reading.ts";

export type Session = Readonly<{
  model: string;
  module: string;
  arrangement: string;
  sample: string;
  scored: readonly Scored[];
}>;

export type Row = Readonly<{
  model: string;
  module: string;
  arrangement: string;
  type: string;
  sessions: number;
  right: number;
  asked: number;
}>;

/** Right and asked, per model, module, arrangement and question type, with "all" beside the types. */
export function tally(sessions: readonly Session[]): Row[] {
  const cells = new Map<
    string,
    {
      row: Omit<Row, "right" | "asked" | "sessions">;
      right: number;
      asked: number;
      ids: Set<string>;
    }
  >();
  for (const s of sessions) {
    for (const type of new Set([...s.scored.map((q) => q.type), "all"])) {
      const key = [s.model, s.module, s.arrangement, type].join("\t");
      const cell = cells.get(key) ?? {
        row: { model: s.model, module: s.module, arrangement: s.arrangement, type },
        right: 0,
        asked: 0,
        ids: new Set<string>(),
      };
      const inType = s.scored.filter((q) => type === "all" || q.type === type);
      cell.right += inType.filter((q) => q.correct).length;
      cell.asked += inType.length;
      cell.ids.add(s.sample);
      cells.set(key, cell);
    }
  }
  return [...cells.values()].map((c) => ({
    ...c.row,
    sessions: c.ids.size,
    right: c.right,
    asked: c.asked,
  }));
}

/** The share of sessions that got each question right, for one arrangement. */
export function perQuestion(
  sessions: readonly Session[],
  arrangement: string,
): Map<string, number> {
  const right = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const s of sessions.filter((x) => x.arrangement === arrangement)) {
    for (const q of s.scored) {
      seen.set(q.id, (seen.get(q.id) ?? 0) + 1);
      right.set(q.id, (right.get(q.id) ?? 0) + (q.correct ? 1 : 0));
    }
  }
  return new Map([...seen].map(([id, n]) => [id, (right.get(id) ?? 0) / n]));
}

/** A small seeded generator, so a bootstrap can be repeated. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The mean of b minus a over the questions both have, and its percentile bootstrap 95% interval. */
export function pairedDifference(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  seed = 1,
  resamples = 2000,
): Readonly<{ n: number; mean: number; lo: number; hi: number }> {
  const diffs = [...a.keys()]
    .filter((id) => b.has(id))
    .map((id) => (b.get(id) ?? 0) - (a.get(id) ?? 0));
  const n = diffs.length;
  if (n === 0) return { n, mean: 0, lo: 0, hi: 0 };
  const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const next = lcg(seed);
  const means = Array.from({ length: resamples }, () =>
    mean(Array.from({ length: n }, () => diffs[Math.floor(next() * n)] ?? 0)),
  ).sort((x, y) => x - y);
  return {
    n,
    mean: mean(diffs),
    lo: means[Math.floor(0.025 * resamples)] ?? 0,
    hi: means[Math.floor(0.975 * resamples) - 1] ?? 0,
  };
}

const pct = (x: number): string => (100 * x).toFixed(1);

function load(trial: string, readers: string): Session[] {
  const out: Session[] = [];
  for (const model of readdirSync(readers)) {
    for (const module of readdirSync(join(readers, model))) {
      const qdir = join(trial, "questions", module);
      if (!existsSync(join(qdir, "questions.json"))) continue;
      const questions = JSON.parse(
        readFileSync(join(qdir, "questions.json"), "utf8"),
      ) as Question[];
      const truth = JSON.parse(readFileSync(join(qdir, "answers.json"), "utf8")) as Answers;
      for (const arrangement of readdirSync(join(readers, model, module))) {
        const dir = join(readers, model, module, arrangement);
        for (const file of readdirSync(dir)
          .filter((f) => f.endsWith(".answers.json"))
          .sort()) {
          const answers = JSON.parse(readFileSync(join(dir, file), "utf8")) as Answers | null;
          out.push({
            model,
            module,
            arrangement,
            sample: file.replace(".answers.json", ""),
            scored: scoreRun(answers, truth, questions),
          });
        }
      }
    }
  }
  return out;
}

function main(): void {
  const at = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const trial = at("--trial");
  if (trial === undefined) {
    console.error("usage: tabulate.ts --trial <trial folder> [--readers <folder>]");
    process.exit(2);
  }
  const sessions = load(trial, at("--readers") ?? join(trial, "readers"));
  console.log("model\tmodule\tarrangement\ttype\tsessions\tright\tasked\tshare\tlo\thi");
  for (const r of tally(sessions).sort((x, y) =>
    [x.model, x.module, x.type, x.arrangement]
      .join()
      .localeCompare([y.model, y.module, y.type, y.arrangement].join()),
  )) {
    const [lo, hi] = wilson(r.right, r.asked);
    console.log(
      [
        r.model,
        r.module,
        r.arrangement,
        r.type,
        r.sessions,
        r.right,
        r.asked,
        pct(r.right / r.asked),
        pct(lo),
        pct(hi),
      ].join("\t"),
    );
  }
  console.log("\nmodel\tmodule\tfrom\tto\tquestions\tdifference_points\tlo\thi");
  const keys = new Set(sessions.map((s) => `${s.model}\t${s.module}`));
  for (const key of [...keys].sort()) {
    const [model = "", module = ""] = key.split("\t");
    const mine = sessions.filter((s) => s.model === model && s.module === module);
    const base = perQuestion(mine, "original");
    for (const to of ["functional", "tidy"]) {
      const d = pairedDifference(base, perQuestion(mine, to));
      console.log(
        [model, module, "original", to, d.n, pct(d.mean), pct(d.lo), pct(d.hi)].join("\t"),
      );
    }
    const d = pairedDifference(perQuestion(mine, "tidy"), perQuestion(mine, "functional"));
    console.log(
      [model, module, "tidy", "functional", d.n, pct(d.mean), pct(d.lo), pct(d.hi)].join("\t"),
    );
  }
}

if (import.meta.main) main();
