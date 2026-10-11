// Draw a seeded sample of the findings the two readers mark differently on `ticket_open`, with
// both readers' reasons, for the session to read and decide (see ../rule.md, "The second reader").
//
//   bun --no-env-file --config=/dev/null adjudicate.ts --readers <dir> --items <items.tsv> \
//       --n 24 --seed 400 --out <file>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Mark, parseMarks } from "./marks.ts";
import { rng } from "./stats.ts";

export type ItemRow = {
  id: string;
  run: string;
  round: string;
  target: string;
  text: string;
};

/** The rows of `items.tsv`. */
export function parseItems(tsv: string): ItemRow[] {
  const lines = tsv.split("\n").filter((l) => l !== "");
  const head = (lines[0] ?? "").split("\t");
  const col = (name: string): number => head.indexOf(name);
  return lines.slice(1).map((l) => {
    const c = l.split("\t");
    return {
      id: c[col("id")] ?? "",
      run: c[col("run")] ?? "",
      round: c[col("round")] ?? "",
      target: c[col("target")] ?? "",
      text: c[col("text")] ?? "",
    };
  });
}

/** A seeded sample of `n` ids from a sorted list, without repeats. */
export function sampleIds(ids: readonly string[], n: number, seed: number): string[] {
  const pool = [...ids].sort();
  const next = rng(seed);
  const out: string[] = [];
  while (out.length < n && pool.length > 0) {
    const at = Math.floor(next() * pool.length);
    out.push(pool.splice(at, 1)[0] as string);
  }
  return out.sort();
}

/** The ids where one reader says `yes` to ticket_open and the other does not. */
export function splitOnOpen(a: readonly Mark[], b: readonly Mark[]): string[] {
  const bById = new Map(b.map((m) => [m.id, m]));
  return a
    .filter((m) => {
      const o = bById.get(m.id);
      return o !== undefined && (m.ticketOpen === "yes") !== (o.ticketOpen === "yes");
    })
    .map((m) => m.id);
}

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const main = (args: string[]): void => {
  const dir = arg(args, "--readers");
  const itemsFile = arg(args, "--items");
  const out = arg(args, "--out");
  if (!dir || !itemsFile || !out)
    throw new Error("usage: adjudicate.ts --readers dir --items f --out f");
  const n = Number(arg(args, "--n") ?? "24");
  const seed = Number(arg(args, "--seed") ?? "400");
  const read = (prefix: string): Mark[] =>
    readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".tsv"))
      .sort()
      .flatMap((f) => parseMarks(readFileSync(join(dir, f), "utf8")).marks);
  const a = read("reader-a-");
  const b = read("reader-b-");
  const split = splitOnOpen(a, b);
  const picked = sampleIds(split, n, seed);
  const items = new Map(parseItems(readFileSync(itemsFile, "utf8")).map((i) => [i.id, i]));
  const am = new Map(a.map((m) => [m.id, m]));
  const bm = new Map(b.map((m) => [m.id, m]));
  const lines = [
    "# A sample of the findings the readers mark differently on `ticket_open`",
    "",
    `${split.length} findings differ between yes and not yes; ${picked.length} are drawn with seed ${seed}.`,
    "",
  ];
  for (const id of picked) {
    const it = items.get(id);
    const x = am.get(id) as Mark;
    const y = bm.get(id) as Mark;
    lines.push(
      `## ${id}`,
      `Round ${it?.round}, \`${it?.target}\`.`,
      `Text: ${it?.text}`,
      `- A: **${x.ticketOpen}**, ${x.kind}: ${x.reason}`,
      `- B: **${y.ticketOpen}**, ${y.kind}: ${y.reason}`,
      "",
    );
  }
  writeFileSync(out, `${lines.join("\n")}\n`);
};

if (import.meta.main) main(process.argv.slice(2));
