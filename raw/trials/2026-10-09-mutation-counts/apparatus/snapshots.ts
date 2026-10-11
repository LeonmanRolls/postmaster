// Both counts at every commit a finding names, and each finding joined to the function that holds
// its line (checks C1 and C3 of #372). One run of the rule per commit serves both.
//
//   bun --no-env-file --config=/dev/null snapshots.ts --oxlint <bin> --work <folder> --out <folder>
//       --findings <findings.tsv> (--repo <repo> [--main <sha>] | --tree <folder>)
//
// With --repo each commit in the findings is exported from the repository, and --main adds a row for
// the main branch. With --tree the one folder stands for every finding's commit, which is how the
// controls run. Writes counts-by-commit.tsv and findings-join.tsv to --out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, inFirstCount } from "./mutation-core.ts";
import {
  type FileRow,
  type Finding,
  type RuleOutput,
  fileRow,
  joinFinding,
  parseLocation,
  placeRows,
  roundLabel,
} from "./mutation-tally.ts";
import { exportScripts, listModules, runRule, tsv } from "./run-rule.ts";
import { policyFrom } from "./count.ts";

const argValue = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const need = (argv: readonly string[], name: string): string => {
  const v = argValue(argv, name);
  if (v === undefined) throw new Error(`missing ${name}`);
  return v;
};

export const readFindings = (text: string): Finding[] => {
  const [head, ...rows] = text.split("\n").filter((l) => l !== "");
  const names = (head ?? "").split("\t");
  return rows.map((r) => {
    const cells = Object.fromEntries(r.split("\t").map((v, i) => [names[i] ?? String(i), v]));
    return {
      key: cells.key ?? "",
      run: cells.run ?? "",
      round: cells.round ?? "",
      sev: cells.sev ?? "",
      location: cells.location ?? "",
      snapshot: cells.snapshot ?? "",
      description: cells.description ?? "",
    };
  });
};

const ROOTS = ["param", "import", "module", "global", "this", "captured", "local", "temp"] as const;

const main = (argv: readonly string[]): void => {
  const oxlint = need(argv, "--oxlint");
  const work = need(argv, "--work");
  const out = need(argv, "--out");
  const policy = policyFrom(argValue(argv, "--first-roots"));
  const findings = readFindings(readFileSync(need(argv, "--findings"), "utf8"));
  const treeArg = argValue(argv, "--tree");
  const mainSha = argValue(argv, "--main");

  const snapshots = [...new Set(findings.map((f) => f.snapshot))];
  const commits =
    treeArg !== undefined ? ["controls"] : [...snapshots, ...(mainSha ? [mainSha] : [])];

  const countRows: (string | number)[][] = [
    [
      "commit",
      "label",
      "modules",
      "lines",
      "functions",
      "first",
      ...ROOTS.slice(0, 6),
      "every",
      "local",
      "temp",
    ],
  ];
  const joinRows: (string | number)[][] = [
    [
      "key",
      "run",
      "round",
      "sev",
      "location",
      "snapshot",
      "kind",
      "in_scope",
      "holder",
      "holder_lines",
      "tied",
      "first_here",
      "first_within",
      "every_here",
      "every_within",
      "places_here",
      "holder_tags",
      "file_share_first",
      "file_share_within_first",
      "file_share_every",
      "description",
    ],
  ];

  for (const commit of commits) {
    let tree = treeArg;
    if (tree === undefined) {
      tree = join(work, `tree-${commit}`);
      exportScripts(need(argv, "--repo"), commit, tree);
    }
    const files = listModules(tree);
    const output = runRule(tree, files, oxlint, work);
    const rows: FileRow[] = files.map((f) => fileRow(f, output.get(f) as RuleOutput, policy));
    const tot = (pick: (r: FileRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
    const byRoot = (root: string): number =>
      tot((r) => (r.byRoot[root] ?? 0) + (r.byRoot[`${root}~`] ?? 0));
    countRows.push([
      commit,
      treeArg !== undefined
        ? "controls"
        : commit === mainSha
          ? "main"
          : roundLabel(findings, commit),
      files.length,
      tot((r) => r.lines),
      tot((r) => r.functions),
      tot((r) => r.first),
      ...ROOTS.slice(0, 6).map(byRoot),
      tot((r) => r.every),
      byRoot("local"),
      byRoot("temp"),
    ]);
    const byFile = new Map(rows.map((r) => [r.file, r]));

    for (const f of findings.filter((x) => treeArg !== undefined || x.snapshot === commit)) {
      const loc = parseLocation(f.location);
      const base = [f.key, f.run, f.round, f.sev, f.location, f.snapshot, loc.kind];
      const data = loc.kind === "ts-line" ? output.get(loc.file) : undefined;
      if (data === undefined) {
        // the columns between in_scope and description are empty for a finding with no function
        const empties = (joinRows[0] as unknown[]).length - base.length - 2;
        joinRows.push([
          ...base,
          loc.kind === "ts-line" ? "no" : "n/a",
          ...Array.from({ length: empties }, () => ""),
          f.description,
        ]);
        continue;
      }
      const j = joinFinding(data, loc.line, policy);
      const row = byFile.get(loc.file) as FileRow;
      const here = placeRows(loc.file, data, policy).filter((p) => j.holders.includes(p.fn));
      joinRows.push([
        ...base,
        "yes",
        j.holderName,
        j.holderLines,
        j.holders.length,
        j.firstHere,
        j.firstWithin,
        j.everyHere,
        j.everyWithin,
        here
          .map(
            (p) =>
              `${p.line}:${p.root}${p.alias ? "~" : ""}:${p.how}${inFirstCount(p.root, policy) ? "" : "(second only)"}`,
          )
          .join(" "),
        j.holderTags.join(","),
        (row.linesInFirst / Math.max(1, row.nonblank)).toFixed(4),
        (row.linesWithinFirst / Math.max(1, row.nonblank)).toFixed(4),
        (row.linesInEvery / Math.max(1, row.nonblank)).toFixed(4),
        f.description,
      ]);
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "counts-by-commit.tsv"), tsv(countRows));
  writeFileSync(join(out, "findings-join.tsv"), tsv(joinRows));
  console.log(`${commits.length} commits, ${joinRows.length - 1} findings`);
};

if (import.meta.main) main(process.argv.slice(2));
export { DEFAULT_POLICY };
