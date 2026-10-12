// Scores every reader session found under a results folder and tabulates it.
//
//   bun --no-env-file --config=/dev/null tabulate.ts --trial <trial folder> [--readers <folder>]
//     [--take <n>]
//
// Reads <trial>/questions/<module>/{questions.json,answers.json} and, for each model, module and
// arrangement under the readers folder (default <trial>/readers), every s<i>.json (the session's
// whole result: usage, duration, cost) and its s<i>.answers.json. A session is valid when its
// answers were read out of its reply and at least half of them are something other than
// "undetermined"; an invalid session is listed and left out of every figure. With --take n, the
// first n valid sessions of each arrangement, in the order of their numbers, are used.
//
// Prints tab-separated tables:
//   1. one row per model, module, arrangement and question type ("all" is every question): the
//      sessions, the answers right out of those asked, the share and its Wilson 95% interval;
//   2. one row per model, module and arrangement: the mean reading effort of a session (prompt
//      tokens, output tokens, thinking tokens, seconds, dollars);
//   3. one row per model and module for each pair of arrangements: the difference in the share
//      right, in percentage points, over the questions, and the ratio of the mean output tokens,
//      each with its bootstrap 95% interval.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Answers, type Question, scoreRun, type Scored, wilson } from "./reading.ts";

export type Effort = Readonly<{
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  seconds: number;
  dollars: number;
}>;

export type Session = Readonly<{
  model: string;
  module: string;
  arrangement: string;
  sample: string;
  valid: boolean;
  scored: readonly Scored[];
  effort: Effort;
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

/** A session is valid when its answers were read and at least half of them are not a bail-out. */
export function isValid(answers: Answers | null, questionCount: number): boolean {
  if (answers === null) return false;
  const given = Object.values(answers).filter(
    (v) => !(typeof v === "string" && v.trim().toLowerCase() === "undetermined"),
  );
  return given.length * 2 >= questionCount;
}

/** The first n valid sessions of each model, module and arrangement, in the order of their numbers. */
export function takeValid(sessions: readonly Session[], n: number | undefined): Session[] {
  const kept = new Map<string, number>();
  return sessions.filter((s) => {
    if (!s.valid) return false;
    const key = [s.model, s.module, s.arrangement].join("\t");
    const count = kept.get(key) ?? 0;
    if (n !== undefined && count >= n) return false;
    kept.set(key, count + 1);
    return true;
  });
}

type Cell = {
  row: Omit<Row, "right" | "asked" | "sessions">;
  right: number;
  asked: number;
  ids: Set<string>;
};

/** Right and asked, per model, module, arrangement and question type, with "all" beside the types. */
export function tally(sessions: readonly Session[]): Row[] {
  const cells = new Map<string, Cell>();
  for (const s of sessions) {
    for (const type of new Set([...s.scored.map((q) => q.type), "all"])) {
      const key = [s.model, s.module, s.arrangement, type].join("\t");
      const cell: Cell = cells.get(key) ?? {
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

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

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

/** The ratio of the mean of b to the mean of a, and its bootstrap 95% interval over sessions. */
export function ratioOfMeans(
  a: readonly number[],
  b: readonly number[],
  seed = 1,
  resamples = 2000,
): Readonly<{ ratio: number; lo: number; hi: number }> {
  if (a.length === 0 || b.length === 0 || mean(a) === 0) return { ratio: 0, lo: 0, hi: 0 };
  const next = lcg(seed);
  const draw = (xs: readonly number[]): number =>
    mean(Array.from({ length: xs.length }, () => xs[Math.floor(next() * xs.length)] ?? 0));
  const ratios = Array.from({ length: resamples }, () => draw(b) / draw(a)).sort((x, y) => x - y);
  return {
    ratio: mean(b) / mean(a),
    lo: ratios[Math.floor(0.025 * resamples)] ?? 0,
    hi: ratios[Math.floor(0.975 * resamples) - 1] ?? 0,
  };
}

const pct = (x: number): string => (100 * x).toFixed(1);
const num = (x: number): string => x.toFixed(2);

export type Loaded = Readonly<{ valid: Session[]; invalid: Session[] }>;

export function load(trial: string, readers: string): Loaded {
  const all: Session[] = [];
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
        const files = readdirSync(dir).filter((f) => f.endsWith(".answers.json"));
        for (const file of files.sort(
          (x, y) => Number(x.slice(1, x.indexOf("."))) - Number(y.slice(1, y.indexOf("."))),
        )) {
          const answers = JSON.parse(readFileSync(join(dir, file), "utf8")) as Answers | null;
          const raw = JSON.parse(
            readFileSync(join(dir, file.replace(".answers.json", ".json")), "utf8"),
          ) as {
            usage?: {
              output_tokens?: number;
              output_tokens_details?: { thinking_tokens?: number };
            };
            duration_ms?: number;
            total_cost_usd?: number;
          };
          all.push({
            model,
            module,
            arrangement,
            sample: file.replace(".answers.json", ""),
            valid: isValid(answers, questions.length),
            scored: scoreRun(answers, truth, questions),
            effort: {
              promptTokens:
                (raw.usage?.input_tokens ?? 0) +
                (raw.usage?.cache_creation_input_tokens ?? 0) +
                (raw.usage?.cache_read_input_tokens ?? 0),
              outputTokens: raw.usage?.output_tokens ?? 0,
              thinkingTokens: raw.usage?.output_tokens_details?.thinking_tokens ?? 0,
              seconds: (raw.duration_ms ?? 0) / 1000,
              dollars: raw.total_cost_usd ?? 0,
            },
          });
        }
      }
    }
  }
  return { valid: all.filter((s) => s.valid), invalid: all.filter((s) => !s.valid) };
}

function main(): void {
  const at = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const trial = at("--trial");
  if (trial === undefined) {
    console.error("usage: tabulate.ts --trial <trial folder> [--readers <folder>] [--take <n>]");
    process.exit(2);
  }
  const takeArg = at("--take");
  const { valid, invalid } = load(trial, at("--readers") ?? join(trial, "readers"));
  const sessions = takeValid(valid, takeArg === undefined ? undefined : Number(takeArg));
  const order = (r: Row): string => [r.model, r.module, r.type, r.arrangement].join();
  console.log("model\tmodule\tarrangement\ttype\tsessions\tright\tasked\tshare\tlo\thi");
  for (const r of tally(sessions).sort((x, y) => order(x).localeCompare(order(y)))) {
    const [lo, hi] = wilson(r.right, r.asked);
    const cols = [r.model, r.module, r.arrangement, r.type, r.sessions, r.right, r.asked];
    console.log([...cols, pct(r.right / r.asked), pct(lo), pct(hi)].join("\t"));
  }
  console.log(
    "\nmodel\tmodule\tarrangement\tsessions\tprompt_tokens\toutput_tokens\tthinking_tokens\tseconds\tdollars",
  );
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = [s.model, s.module, s.arrangement].join("\t");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const [key, group] of [...groups].sort()) {
    const m = (pick: (e: Effort) => number): string => num(mean(group.map((s) => pick(s.effort))));
    const cols = [
      key,
      group.length,
      m((e) => e.promptTokens),
      m((e) => e.outputTokens),
      m((e) => e.thinkingTokens),
    ];
    console.log([...cols, m((e) => e.seconds), m((e) => e.dollars)].join("\t"));
  }
  console.log(
    "\nmodel\tmodule\tfrom\tto\tquestions\tshare_difference_points\tlo\thi\ttokens_ratio\tlo\thi",
  );
  const keys = new Set(sessions.map((s) => `${s.model}\t${s.module}`));
  for (const key of [...keys].sort()) {
    const [model = "", module = ""] = key.split("\t");
    const mine = sessions.filter((s) => s.model === model && s.module === module);
    const tokens = (arrangement: string): number[] =>
      mine.filter((s) => s.arrangement === arrangement).map((s) => s.effort.outputTokens);
    for (const [from, to] of [
      ["original", "functional"],
      ["original", "tidy"],
      ["tidy", "functional"],
    ] as const) {
      const d = pairedDifference(perQuestion(mine, from), perQuestion(mine, to));
      const t = ratioOfMeans(tokens(from), tokens(to));
      const cols = [model, module, from, to, d.n, pct(d.mean), pct(d.lo), pct(d.hi)];
      console.log([...cols, num(t.ratio), num(t.lo), num(t.hi)].join("\t"));
    }
  }
  if (invalid.length > 0) {
    console.log("\ninvalid sessions (left out):");
    for (const s of invalid) console.log([s.model, s.module, s.arrangement, s.sample].join("\t"));
  }
}

if (import.meta.main) main();
