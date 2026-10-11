// Put the counts of the control inputs beside what each is expected to read.
//
//   bun --no-env-file --config=/dev/null check-controls.ts <controls folder> <count.ts --out folder>
//       <snapshots.ts --out folder>
//
// Exits 1 when any control reads other than expected, so a drift in the rule cannot pass quietly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { edgeTags } from "./edge-tags.ts";
import { summarise } from "./summarise-join.ts";
import { readInputs, report } from "./tally.ts";

export const readTsv = (text: string): Record<string, string>[] => {
  const [head, ...rows] = text.split("\n").filter((l) => l !== "");
  const names = (head ?? "").split("\t");
  return rows.map((r) =>
    Object.fromEntries(r.split("\t").map((v, i) => [names[i] ?? String(i), v])),
  );
};

export type Reading = Readonly<{
  name: string;
  expected: string;
  observed: string;
  ok: boolean;
  why: string;
}>;

/** Each expected row against the observed one with the same key; an absent observation fails. */
export const compare = (
  expected: readonly Record<string, string>[],
  observed: ReadonlyMap<string, string>,
  key: string,
  value: (row: Record<string, string>) => string,
): Reading[] =>
  expected.map((row) => {
    const name = row[key] ?? "";
    const want = value(row);
    const got = observed.get(name) ?? "(not read)";
    return { name, expected: want, observed: got, ok: want === got, why: row.why ?? "" };
  });

const main = (controls: string, out: string, joined: string): number => {
  const read = (p: string): Record<string, string>[] => readTsv(readFileSync(p, "utf8"));
  const files = read(join(out, "files.tsv"));
  const places = read(join(out, "places.tsv"));
  const counts = new Map(files.map((r) => [r.module ?? "", `${r.first} ${r.every}`]));
  const byCount = compare(
    read(join(controls, "expected.tsv")),
    counts,
    "module",
    (r) => `${r.first} ${r.every}`,
  );

  const tagsOf = new Map<string, string>();
  for (const p of places) {
    if (p.module !== "scripts/lib/tags.ts") continue;
    tagsOf.set(p.function ?? "", p.fn_tags ?? "");
  }
  const byTags = compare(
    read(join(controls, "expected-tags.tsv")),
    tagsOf,
    "function",
    (r) => r.tags ?? "",
  );

  const joinRows = read(join(joined, "findings-join.tsv"));
  const dash = (v: string | undefined): string => (v === undefined || v === "" ? "-" : v);
  const seen = new Map(
    joinRows.map((r) => [
      r.key ?? "",
      [r.kind, r.in_scope, r.first_here, r.first_within, r.every_here].map(dash).join(" "),
    ]),
  );
  const byJoin = compare(read(join(controls, "expected-findings.tsv")), seen, "key", (r) =>
    [r.kind, r.in_scope, r.first_here, r.first_within, r.every_here].map(dash).join(" "),
  );

  // the marks tally, run on three mark lists with the command that tallies the real marks
  const tallies = new Map<string, Record<string, string>>();
  for (const name of ["all-hazard", "none-hazard", "split"]) {
    tallies.set(name, report(readInputs(join(controls, "marks", name))).summary);
  }
  const byTally = read(join(controls, "expected-marks.tsv")).map((row) => {
    const got = tallies.get(row.case ?? "")?.[row.key ?? ""] ?? "(not read)";
    return {
      name: `${row.case} ${row.key}`,
      expected: row.value ?? "",
      observed: got,
      ok: got === row.value,
      why: row.why ?? "",
    };
  });

  // the count of findings in flagged functions, on all the control findings and on the clean one alone
  const summaries = new Map<string, Record<string, string>>([
    ["all", summarise(joinRows).summary],
    ["clean-only", summarise(joinRows.filter((r) => r.key === "control/in-clean")).summary],
    ["edge-tags", edgeTags(places).summary],
  ]);
  const bySummary = read(join(controls, "expected-summary.tsv")).map((row) => {
    const got = summaries.get(row.case ?? "")?.[row.key ?? ""] ?? "(not read)";
    return {
      name: `${row.case} ${row.key}`,
      expected: row.value ?? "",
      observed: got,
      ok: got === row.value,
      why: row.why ?? "",
    };
  });

  console.log("module\texpected first every\tobserved first every\tok\twhy");
  for (const r of byCount)
    console.log([r.name, r.expected, r.observed, r.ok ? "yes" : "NO", r.why].join("\t"));
  console.log("\nfunction\texpected tags\tobserved tags\tok");
  for (const r of byTags)
    console.log([r.name, r.expected, r.observed, r.ok ? "yes" : "NO"].join("\t"));
  console.log(
    "\nfinding\texpected kind, in scope, first here, first within, every here\tobserved\tok\twhy",
  );
  for (const r of byJoin)
    console.log([r.name, r.expected, r.observed, r.ok ? "yes" : "NO", r.why].join("\t"));
  console.log("\nfindings in flagged functions\texpected\tobserved\tok\twhy");
  for (const r of bySummary)
    console.log([r.name, r.expected, r.observed, r.ok ? "yes" : "NO", r.why].join("\t"));
  console.log("\nmarks tally\texpected\tobserved\tok\twhy");
  for (const r of byTally)
    console.log([r.name, r.expected, r.observed, r.ok ? "yes" : "NO", r.why].join("\t"));
  const all = [...byCount, ...byTags, ...byJoin, ...bySummary, ...byTally];
  const agree = all.filter((r) => r.ok).length;
  console.log(`\ncontrols: ${agree} of ${all.length} read as expected`);
  return agree === all.length ? 0 : 1;
};

if (import.meta.main) {
  const [controls, out, joined] = process.argv.slice(2);
  if (controls === undefined || out === undefined || joined === undefined) {
    console.error(
      "usage: check-controls.ts <controls folder> <count output folder> <snapshots output folder>",
    );
    process.exit(2);
  }
  process.exit(main(controls, out, joined));
}
