// The draws of check C2: 30 of the first count's places on the main branch, then 10 of those 30.
//
//   bun --no-env-file --config=/dev/null draw.ts <places.tsv of count.ts> <out folder> [seed1 [seed2]]
//
// The population is every row of the main branch's places.tsv that the first count holds, sorted by
// module, line, column, target and method. The first draw takes 30 with the first seed (default 372),
// the second takes 10 of those 30, in the order they were drawn, with the second seed (default 373).
// Writes population.tsv (all of them), sample-30.tsv (item numbers 1 to 30 in draw order) and
// sample-10.tsv (the 10, with the item number each has in the 30).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sample } from "./mutation-core.ts";
import { tsv } from "./run-rule.ts";

type Row = Record<string, string>;

export const readRows = (text: string): { head: string[]; rows: Row[] } => {
  const [h, ...lines] = text.split("\n").filter((l) => l !== "");
  const head = (h ?? "").split("\t");
  const rows = lines.map((l) =>
    Object.fromEntries(l.split("\t").map((v, i) => [head[i] ?? "", v])),
  );
  return { head, rows };
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const population = (rows: readonly Row[]): Row[] =>
  rows
    .filter((r) => r.first === "1")
    .sort(
      (a, b) =>
        byText(a.module ?? "", b.module ?? "") ||
        Number(a.line) - Number(b.line) ||
        Number(a.col) - Number(b.col) ||
        byText(a.target ?? "", b.target ?? "") ||
        byText(a.how ?? "", b.how ?? ""),
    );

const main = (placesPath: string, out: string, seed1: number, seed2: number): void => {
  const { head, rows } = readRows(readFileSync(placesPath, "utf8"));
  const pop = population(rows);
  const first = sample(pop, 30, seed1);
  const numbered = first.map((r, i) => ({ ...r, item: String(i + 1) }));
  const second = sample(numbered, 10, seed2);
  const cols = ["item", ...head];
  const table = (list: readonly Row[]): (string | number)[][] => [
    cols,
    ...list.map((r) => cols.map((c) => r[c] ?? "")),
  ];
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "population.tsv"),
    tsv([head, ...pop.map((r) => head.map((c) => r[c] ?? ""))]),
  );
  writeFileSync(join(out, "sample-30.tsv"), tsv(table(numbered)));
  writeFileSync(join(out, "sample-10.tsv"), tsv(table(second)));
  console.log(`population ${pop.length}, first draw ${first.length}, second draw ${second.length}`);
};

if (import.meta.main) {
  const [places, out, s1, s2] = process.argv.slice(2);
  if (places === undefined || out === undefined) {
    console.error("usage: draw.ts <places.tsv> <out folder> [seed1 [seed2]]");
    process.exit(2);
  }
  main(places, out, Number(s1 ?? 372), Number(s2 ?? 373));
}
