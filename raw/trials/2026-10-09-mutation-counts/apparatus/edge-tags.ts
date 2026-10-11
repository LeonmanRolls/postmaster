// How many places of the first count lie in code that touches the environment, the clock, files or
// processes, so that the page's exemption for edge code can be read off (decision D1 of the ticket).
//
//   bun --no-env-file --config=/dev/null edge-tags.ts <places.tsv of count.ts>
//
// A place is "in an edge function" when its own function's text holds a tagged event, nested
// functions included, and "in an edge module" when the module holds one anywhere. A place at a
// module's top level takes the module's tags for its function. Counts the places the first count
// holds, by root and by tag.
import { readFileSync } from "node:fs";

type Row = Record<string, string>;

export const rowsOf = (text: string): Row[] => {
  const [h, ...lines] = text.split("\n").filter((l) => l !== "");
  const head = (h ?? "").split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i] ?? "", v])));
};

export const edgeTags = (
  rows: readonly Row[],
): { text: string; summary: Record<string, string> } => {
  const first = rows.filter((r) => r.first === "1");
  const tagged = (r: Row, col: string): boolean => (r[col] ?? "") !== "";
  const inFn = first.filter((r) => tagged(r, "fn_tags"));
  const inMod = first.filter((r) => tagged(r, "module_tags"));
  const out: string[] = [];
  out.push(`places of the first count: ${first.length}`);
  out.push(
    `in an edge function: ${inFn.length}; in no edge function: ${first.length - inFn.length}`,
  );
  out.push(`in an edge module: ${inMod.length}; in no edge module: ${first.length - inMod.length}`);
  out.push("");
  out.push("root\tplaces\tedge function\tedge module");
  const roots = [...new Set(first.map((r) => r.root ?? ""))].sort();
  for (const root of roots) {
    const g = first.filter((r) => r.root === root);
    out.push(
      `${root}\t${g.length}\t${g.filter((r) => tagged(r, "fn_tags")).length}\t${g.filter((r) => tagged(r, "module_tags")).length}`,
    );
  }
  out.push("");
  out.push("root\tname given a value\tproperty assigned\tin-place call\tdelete\tObject.assign");
  const ops = ["rebind", "prop", "call", "delete", "assign"];
  for (const root of roots) {
    const g = first.filter((r) => r.root === root);
    out.push(`${root}\t${ops.map((op) => g.filter((r) => r.op === op).length).join("\t")}`);
  }
  out.push("");
  out.push("tag\tplaces in a function with it\tplaces in a module with it");
  for (const tag of ["env", "clock", "files", "proc", "os"]) {
    const has =
      (col: string) =>
      (r: Row): boolean =>
        (r[col] ?? "").split(",").includes(tag);
    out.push(
      `${tag}\t${first.filter(has("fn_tags")).length}\t${first.filter(has("module_tags")).length}`,
    );
  }
  const summary: Record<string, string> = {
    first: String(first.length),
    edge_function: String(inFn.length),
    no_edge_function: String(first.length - inFn.length),
    edge_module: String(inMod.length),
    no_edge_module: String(first.length - inMod.length),
    ...Object.fromEntries(
      ops.map((op) => [`op_${op}`, String(first.filter((r) => r.op === op).length)]),
    ),
  };
  out.push("");
  out.push("summary");
  for (const [k, v] of Object.entries(summary)) out.push(`${k}\t${v}`);
  return { text: out.join("\n"), summary };
};

if (import.meta.main) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error("usage: edge-tags.ts <places.tsv>");
    process.exit(2);
  }
  console.log(edgeTags(rowsOf(readFileSync(path, "utf8"))).text);
}
