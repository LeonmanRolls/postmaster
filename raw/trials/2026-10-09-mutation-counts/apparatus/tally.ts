// The marks of check C2: the first reader's marks on 30 places, the estimate of how many of the
// population are not hazards, and the second reader's agreement on 10 of them.
//
//   bun --no-env-file --config=/dev/null tally.ts <folder>
//
// The folder holds main-first-count-places.tsv (the population), first-reader.tsv (item, module,
// line, col, mark, question, reason), second-reader.tsv (item, mark, question, reason) and
// second-reader-map.tsv (second_item, module, line, first_item; first_item is "control" for a place
// made up to test the reader). Prints the report, and the same figures as key and value lines at
// its end, which is what check-controls.ts compares.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agreementOf, estimateOf, shuffled, tallyMarks } from "./mutation-tally.ts";

type Row = Record<string, string>;

export const rowsOf = (text: string): Row[] => {
  const [h, ...lines] = text.split("\n").filter((l) => l !== "");
  const head = (h ?? "").split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i] ?? "", v])));
};

export type Inputs = Readonly<{ population: Row[]; first: Row[]; second: Row[]; map: Row[] }>;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const f1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const f2 = (x: number): string => (Math.round(x * 100) / 100).toFixed(2);

/** What a place in the population lands on, with an alias counted as what it is an alias of. */
const rootOf = (r: Row): string => r.root ?? "?";

export const report = (inp: Inputs): { text: string; summary: Record<string, string> } => {
  const N = inp.population.length;
  const marks = inp.first.map((r) => r.mark ?? "");
  const t = tallyMarks(marks, N);
  const out: string[] = [];
  const sum: Record<string, string> = {};

  out.push(`population: ${N} places of the first count`);
  out.push(
    `first reader: ${t.n} marked: ${t.hazard} hazard, ${t.harmless} harmless, ${t.unclear} unclear`,
  );
  sum.population = String(N);
  sum.hazard = String(t.hazard);
  sum.harmless = String(t.harmless);
  sum.unclear = String(t.unclear);

  const line = (label: string, e: typeof t.notHazardHarmless): string =>
    `${label}: ${e.hits} of ${e.n} (${pct(e.share)}, Wilson 95% ${pct(e.low)} to ${pct(e.high)}) -> about ${Math.round(e.estimate)} of ${N} places` +
    ` (interval ${Math.round(e.estimateLow)} to ${Math.round(e.estimateHigh)})`;
  out.push(line("not hazards, harmless alone", t.notHazardHarmless));
  out.push(line("not hazards, harmless and unclear", t.notHazardAll));
  sum.not_hazard_harmless = String(Math.round(t.notHazardHarmless.estimate));
  sum.not_hazard_all = String(Math.round(t.notHazardAll.estimate));
  const verdict = (e: typeof t.notHazardHarmless): string =>
    e.estimateLow > 20
      ? "above 20 even at the low end"
      : e.estimate > 20
        ? "above 20 at the estimate"
        : "20 or fewer";
  out.push(
    `test 1 (more than about twenty not hazards): harmless alone ${verdict(t.notHazardHarmless)}; harmless and unclear ${verdict(t.notHazardAll)}`,
  );
  sum.test1 = verdict(t.notHazardAll);

  // composition of the sample against the population, by what the change lands on
  const roots = [...new Set(inp.population.map(rootOf))].sort();
  const key = (r: Row): string => `${r.module}:${r.line}:${r.col}`;
  const byKey = new Map(inp.population.map((r) => [key(r), r]));
  out.push("");
  out.push("root\tpopulation\tsample\thazard\tharmless\tunclear");
  for (const root of roots) {
    const sampled = inp.first.filter((r) => rootOf(byKey.get(key(r)) ?? {}) === root);
    const c = (m: string): number => sampled.filter((r) => r.mark === m).length;
    out.push(
      `${root}\t${inp.population.filter((r) => rootOf(r) === root).length}\t${sampled.length}\t${c("hazard")}\t${c("harmless")}\t${c("unclear")}`,
    );
  }

  // the page's exemption for edge code: places in functions that touch the environment, the clock,
  // files or processes against the rest, and what is left of the population without them
  const edgeOf = (r: Row): boolean => (byKey.get(key(r))?.fn_tags ?? "") !== "";
  const edge = inp.first.filter(edgeOf);
  const rest = inp.first.filter((r) => !edgeOf(r));
  const restPop = inp.population.filter((r) => (r.fn_tags ?? "") === "").length;
  const restHits = rest.filter((r) => r.mark === "harmless").length;
  const restEst = estimateOf(restHits, rest.length, restPop);
  out.push("");
  out.push(
    `in an edge function: ${edge.length} of the sample (${edge.filter((r) => r.mark === "hazard").length} hazard); in none: ${rest.length} (${rest.filter((r) => r.mark === "hazard").length} hazard)`,
  );
  out.push(
    `with edge functions exempt, ${restPop} places remain: harmless ${restHits} of ${rest.length} (Wilson 95% ${pct(restEst.low)} to ${pct(restEst.high)}) -> about ${Math.round(restEst.estimate)} not hazards (interval ${Math.round(restEst.estimateLow)} to ${Math.round(restEst.estimateHigh)})`,
  );
  sum.edge_n = String(edge.length);
  sum.edge_hazard = String(edge.filter((r) => r.mark === "hazard").length);
  sum.nonedge_n = String(rest.length);
  sum.nonedge_hazard = String(rest.filter((r) => r.mark === "hazard").length);
  sum.nonedge_population = String(restPop);
  sum.nonedge_not_hazard = String(Math.round(restEst.estimate));

  // the second reader on the 10 drawn places, and on the made-up controls
  const firstMark = new Map(inp.first.map((r) => [r.item, r.mark ?? ""]));
  const pairs = inp.map
    .filter((m) => m.first_item !== "control")
    .map((m) => ({
      second: m,
      a: firstMark.get(m.first_item ?? "") ?? "(none)",
      b: inp.second.find((s) => s.item === m.second_item)?.mark ?? "(none)",
    }));
  const ag = agreementOf(
    pairs.map((p) => p.a),
    pairs.map((p) => p.b),
  );
  out.push("");
  out.push(
    `second reader on the drawn places: the same mark on ${ag.same} of ${ag.n} (${pct(ag.same / Math.max(1, ag.n))}, Wilson 95% ${pct(ag.low)} to ${pct(ag.high)}), kappa ${f2(ag.kappa)}`,
  );
  sum.same = String(ag.same);
  sum.of = String(ag.n);
  sum.kappa = f2(ag.kappa);
  for (const p of pairs.filter((x) => x.a !== x.b)) {
    out.push(`  differ: ${p.second.module}:${p.second.line} first ${p.a}, second ${p.b}`);
  }
  const second2 = pairs.filter((p) => p.b === "hazard").length;
  sum.second_hazards = String(second2);
  out.push(
    `  hazards among the ${ag.n}: first reader ${pairs.filter((p) => p.a === "hazard").length}, second reader ${second2}`,
  );

  for (const m of inp.map.filter((x) => x.first_item === "control")) {
    const mark = inp.second.find((s) => s.item === m.second_item)?.mark ?? "(none)";
    const expected = (m.module ?? "").includes("order-summary") ? "hazard" : "harmless";
    out.push(`reader control ${m.module}: expected ${expected}, read ${mark}`);
    sum[`control_${expected}`] = mark;
  }

  // the statistics, against themselves and against chance
  const a = pairs.map((p) => p.a);
  const self = agreementOf(a, a);
  const shuf = agreementOf(a, shuffled(a, 372));
  out.push("");
  out.push(
    `control for the statistic: a mark list against itself reads ${self.same} of ${self.n}, kappa ${f2(self.kappa)}; against a seeded shuffle of itself ${shuf.same} of ${shuf.n}, kappa ${f2(shuf.kappa)}`,
  );
  sum.self_same = String(self.same);
  sum.self_kappa = f2(self.kappa);
  const e0 = estimateOf(0, 30, N);
  sum.zero_hazard_estimate = String(Math.round(e0.estimate));

  out.push("");
  out.push("summary");
  for (const [k, v] of Object.entries(sum)) out.push(`${k}\t${v}`);
  void f1;
  return { text: out.join("\n"), summary: sum };
};

export const readInputs = (dir: string): Inputs => {
  const r = (n: string): Row[] => rowsOf(readFileSync(join(dir, n), "utf8"));
  return {
    population: r("main-first-count-places.tsv"),
    first: r("first-reader.tsv"),
    second: r("second-reader.tsv"),
    map: r("second-reader-map.tsv"),
  };
};

if (import.meta.main) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("usage: tally.ts <folder>");
    process.exit(2);
  }
  console.log(report(readInputs(dir)).text);
}
