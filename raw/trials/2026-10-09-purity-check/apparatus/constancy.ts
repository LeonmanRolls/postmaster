// Whether the purity check flags the same places at every snapshot of a run, ignoring line numbers.
// A run's snapshots are the heads its review rounds read, before and after each round's fixes.
//
//   bun --no-env-file --config=/dev/null constancy.ts --findings <findings.tsv> --places <places.tsv>
//
// <places.tsv> is the output of `snapshots.ts --places`. One line per run: its snapshots, how many
// have the same set of (file, rule, text) as its first, and how many places that set holds. The
// last lines compare the first snapshots of two different runs, which must differ: a comparison
// that cannot read differently would read the same for every run.
import { readFileSync } from "node:fs";
import { snapshotsOf } from "./snapshots.ts";

type Row = Readonly<{ run: string; round: string; snapshot: string }>;

/** The places of one snapshot as sorted `file|rule|text` keys, line and column left out. */
export function keysBySnapshot(tsv: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of tsv.trim().split("\n").slice(1)) {
    const [snapshot = "", path = "", , , rule = "", , , text = ""] = line.split("\t");
    out.set(snapshot, [...(out.get(snapshot) ?? []), `${path}|${rule}|${text}`]);
  }
  for (const keys of out.values()) keys.sort();
  return out;
}

export function sameSet(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  return (a ?? []).join("\n") === (b ?? []).join("\n");
}

function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const findings = arg("--findings");
  const places = arg("--places");
  if (findings === undefined || places === undefined) {
    console.error("usage: constancy.ts --findings <findings.tsv> --places <places.tsv>");
    return 2;
  }
  const keys = keysBySnapshot(readFileSync(places, "utf8"));
  const byRun = new Map<string, Row[]>();
  for (const row of snapshotsOf(readFileSync(findings, "utf8"))) {
    byRun.set(row.run, [...(byRun.get(row.run) ?? []), row]);
  }
  const firsts: Row[] = [];
  for (const [run, rows] of byRun) {
    const [first] = rows;
    if (first === undefined) continue;
    firsts.push(first);
    const same = rows.filter((r) => sameSet(keys.get(r.snapshot), keys.get(first.snapshot)));
    console.log(
      `run ${run}\tsnapshots ${rows.length}\tidentical to the first ${same.length}\tplaces ${keys.get(first.snapshot)?.length ?? 0}`,
    );
  }
  for (let i = 0; i < firsts.length; i++) {
    for (let j = i + 1; j < firsts.length; j++) {
      const a = firsts[i] as Row;
      const b = firsts[j] as Row;
      const verdict = sameSet(keys.get(a.snapshot), keys.get(b.snapshot)) ? "identical" : "differ";
      console.log(`control: first snapshot of run ${a.run} against run ${b.run}\t${verdict}`);
    }
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
