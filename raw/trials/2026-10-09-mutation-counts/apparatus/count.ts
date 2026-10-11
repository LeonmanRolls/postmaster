// Both mutation counts over one tree of modules, from a folder or from a commit.
//
//   bun --no-env-file --config=/dev/null count.ts --oxlint <bin> --work <folder>
//       (--tree <folder> | --repo <repo> --commit <sha>) [--label <name>] [--out <folder>]
//       [--first-roots param,import,module,global,this,captured]
//
// The first count is every change to something the function did not create; the second is every
// change at all. Prints one row per module and a total, tab separated:
//   label  module  functions  lines  first  every
// With --out it also writes places.tsv and files.tsv beside it. The same command counts the
// controls, the main branch and the review snapshots; only --tree or --commit differs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CountPolicy, DEFAULT_POLICY, FIRST_COUNT_ROOTS, type Root } from "./mutation-core.ts";
import { type PlaceRow, fileRow, placeRows } from "./mutation-tally.ts";
import { exportScripts, listModules, runRule, tsv } from "./run-rule.ts";

const argValue = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const need = (argv: readonly string[], name: string): string => {
  const v = argValue(argv, name);
  if (v === undefined) throw new Error(`missing ${name}`);
  return v;
};

export const policyFrom = (list: string | undefined): CountPolicy =>
  list === undefined
    ? DEFAULT_POLICY
    : { first: new Set(list.split(",").filter((s) => s !== "") as Root[]) };

const main = (argv: readonly string[]): void => {
  const oxlint = need(argv, "--oxlint");
  const work = need(argv, "--work");
  const policy = policyFrom(argValue(argv, "--first-roots"));
  const commit = argValue(argv, "--commit");
  const label = argValue(argv, "--label") ?? commit ?? "tree";
  let tree = argValue(argv, "--tree");
  if (tree === undefined) {
    tree = join(work, `tree-${commit ?? "none"}`);
    exportScripts(need(argv, "--repo"), need(argv, "--commit"), tree);
  }
  const files = listModules(tree);
  const output = runRule(tree, files, oxlint, work);

  const rows = files.map((f) => fileRow(f, output.get(f) as never, policy));
  console.log(["label", "module", "functions", "lines", "first", "every"].join("\t"));
  for (const r of rows)
    console.log([label, r.file, r.functions, r.lines, r.first, r.every].join("\t"));
  const sum = (pick: (r: (typeof rows)[number]) => number): number =>
    rows.reduce((n, r) => n + pick(r), 0);
  console.log(
    [
      label,
      "TOTAL",
      sum((r) => r.functions),
      sum((r) => r.lines),
      sum((r) => r.first),
      sum((r) => r.every),
    ].join("\t"),
  );

  const out = argValue(argv, "--out");
  if (out !== undefined) {
    mkdirSync(out, { recursive: true });
    const places: PlaceRow[] = files.flatMap((f) => placeRows(f, output.get(f) as never, policy));
    writeFileSync(
      join(out, "places.tsv"),
      tsv([
        [
          "label",
          "module",
          "line",
          "col",
          "function",
          "fn_start",
          "fn_end",
          "op",
          "how",
          "root",
          "alias",
          "first",
          "fn_tags",
          "module_tags",
          "target",
          "source_line",
        ],
        ...places.map((p) => [
          label,
          p.file,
          p.line,
          p.col,
          p.fnName,
          p.fnStart,
          p.fnEnd,
          p.op,
          p.how,
          p.root,
          p.alias ? 1 : 0,
          p.first ? 1 : 0,
          p.fnTags.join(","),
          p.moduleTags.join(","),
          p.target,
          p.src,
        ]),
      ]),
    );
    writeFileSync(
      join(out, "files.tsv"),
      tsv([
        [
          "label",
          "module",
          "lines",
          "nonblank",
          "functions",
          "first",
          "every",
          "lines_in_first",
          "lines_in_every",
          "by_root",
        ],
        ...rows.map((r) => [
          label,
          r.file,
          r.lines,
          r.nonblank,
          r.functions,
          r.first,
          r.every,
          r.linesInFirst,
          r.linesInEvery,
          Object.entries(r.byRoot)
            .sort()
            .map(([k, n]) => `${k}=${n}`)
            .join(" "),
        ]),
      ]),
    );
  }
};

if (import.meta.main) main(process.argv.slice(2));
export { FIRST_COUNT_ROOTS };
