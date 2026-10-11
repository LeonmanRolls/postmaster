// The count of check C1: how many findings sit in a function the first count flags, by run, beside
// how many would by chance if findings fell on lines at random in the same files.
//
//   bun --no-env-file --config=/dev/null summarise-join.ts <findings-join.tsv>
//
// Findings that cite a runbook or no line, and a module the tree does not hold, are listed apart and
// are in no share. Prints the table, then the same figures as key and value lines.
import { readFileSync } from "node:fs";

type Row = Record<string, string>;

export const rowsOf = (text: string): Row[] => {
  const [h, ...lines] = text.split("\n").filter((l) => l !== "");
  const head = (h ?? "").split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i] ?? "", v])));
};

/** P(X >= k) for X the number of successes among independent trials with the given chances. */
export const tailAtLeast = (chances: readonly number[], k: number): number => {
  let dist = [1];
  for (const p of chances) {
    const next = Array.from({ length: dist.length + 1 }, () => 0);
    dist.forEach((q, i) => {
      next[i] = (next[i] ?? 0) + q * (1 - p);
      next[i + 1] = (next[i + 1] ?? 0) + q * p;
    });
    dist = next;
  }
  return dist.slice(k).reduce((a, b) => a + b, 0);
};

type Group = {
  n: number;
  here: number;
  within: number;
  every: number;
  ef: number;
  ew: number;
  ee: number;
  pf: number[];
};

const empty = (): Group => ({ n: 0, here: 0, within: 0, every: 0, ef: 0, ew: 0, ee: 0, pf: [] });

export const summarise = (
  rows: readonly Row[],
): { text: string; summary: Record<string, string> } => {
  const scoped = rows.filter((r) => r.kind === "ts-line" && r.in_scope === "yes");
  const apart = rows.filter((r) => !(r.kind === "ts-line" && r.in_scope === "yes"));
  const by = new Map<string, Group>();
  const total = empty();
  for (const r of scoped) {
    for (const g of [
      by.get(r.run ?? "") ?? by.set(r.run ?? "", empty()).get(r.run ?? "")!,
      total,
    ]) {
      g.n++;
      if (Number(r.first_here) > 0) g.here++;
      if (Number(r.first_within) > 0) g.within++;
      if (Number(r.every_here) > 0) g.every++;
      g.ef += Number(r.file_share_first);
      g.ew += Number(r.file_share_within_first);
      g.ee += Number(r.file_share_every);
      g.pf.push(Number(r.file_share_first));
    }
  }
  const f1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
  const out: string[] = [];
  out.push(
    "run\tfindings\tin a flagged function\tflagged or around one\tin a function of the second count\texpected by chance: first\tnested\tsecond",
  );
  for (const [run, g] of [...by.entries()].sort()) {
    out.push(
      `${run}\t${g.n}\t${g.here}\t${g.within}\t${g.every}\t${f1(g.ef)}\t${f1(g.ew)}\t${f1(g.ee)}`,
    );
  }
  out.push(
    `all\t${total.n}\t${total.here}\t${total.within}\t${total.every}\t${f1(total.ef)}\t${f1(total.ew)}\t${f1(total.ee)}`,
  );
  const kinds = new Map<string, number>();
  for (const r of apart) {
    const k = r.kind === "ts-line" ? "a module the tree does not hold" : (r.kind ?? "");
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  out.push(`apart: ${[...kinds.entries()].map(([k, n]) => `${n} cite ${k}`).join(", ") || "none"}`);
  const tail = total.n === 0 ? 1 : tailAtLeast(total.pf, total.here);
  out.push(
    `chance of ${total.here} or more in a flagged function if each finding fell on a random line of its file: ${f1(tail * 100)}%`,
  );
  const summary: Record<string, string> = {
    findings: String(total.n),
    in_flagged: String(total.here),
    flagged_or_around: String(total.within),
    second_count: String(total.every),
    apart: String(apart.length),
    test2_none: total.here === 0 ? "met" : "not met",
  };
  out.push("");
  out.push("summary");
  for (const [k, v] of Object.entries(summary)) out.push(`${k}\t${v}`);
  return { text: out.join("\n"), summary };
};

if (import.meta.main) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error("usage: summarise-join.ts <findings-join.tsv>");
    process.exit(2);
  }
  console.log(summarise(rowsOf(readFileSync(path, "utf8"))).text);
}
