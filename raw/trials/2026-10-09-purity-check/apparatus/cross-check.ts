// Runs the token version (purity-check.ts) and the syntax-tree version (purity-ast.ts, through
// Oxlint) over the same modules and compares the places they flag, by file, line and rule.
//
//   bun --no-env-file --config=/dev/null cross-check.ts --root <dir> [--scope core|all]
//
// Prints a first line starting with `#`, then one `only-token` or `only-ast` line per place one
// version flags and the other does not. Exit 0 when the two agree on every module, 1 when not.
// The Oxlint binary is the repository's own development dependency, found from this file.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { modulesUnder, placesIn } from "./purity-check.ts";

const HERE = import.meta.dir;
const OXLINT = resolve(HERE, "../../../../node_modules/.bin/oxlint");
const CONFIG = join(HERE, "ast.oxlintrc.json");

type Diagnostic = { message: string; filename: string; labels: { span: { line: number } }[] };

/** The multiset of `path:line:rule` keys, as sorted lines. */
const keys = (rows: readonly string[]): string[] => [...rows].sort();

/** Lines present in `a` and not in `b`, counting repeats. */
export function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  const out: string[] = [];
  for (const k of a) {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else out.push(k);
  }
  return out;
}

function astRows(root: string, modules: readonly string[]): string[] {
  if (modules.length === 0) return [];
  const run = spawnSync(
    OXLINT,
    ["-c", CONFIG, "--disable-nested-config", "-f", "json", ...modules],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] };
  return parsed.diagnostics.map((d) => `${d.filename}:${d.labels[0]?.span.line}:${d.message}`);
}

type Scope = "core" | "all";

/** Both versions over the in-scope modules under `root`, and the places only one of them flags. */
export function compare(root: string, scope: Scope) {
  const modules = modulesUnder(root, scope);
  const token = keys(
    modules.flatMap((path) =>
      placesIn(path, readFileSync(join(root, path), "utf8")).map(
        (p) => `${p.path}:${p.line}:${p.rule}${p.typeOnly ? " (type only)" : ""}`,
      ),
    ),
  );
  const ast = keys(astRows(root, modules));
  return {
    modules: modules.length,
    token,
    ast,
    onlyToken: minus(token, ast),
    onlyAst: minus(ast, token),
  };
}

function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg("--root");
  const scope = arg("--scope") === "all" ? "all" : "core";
  if (root === undefined) {
    console.error("usage: cross-check.ts --root <dir> [--scope core|all]");
    return 2;
  }
  const r = compare(root, scope);
  console.log(
    `# scope=${scope} modules=${r.modules} token=${r.token.length} ast=${r.ast.length} only-token=${r.onlyToken.length} only-ast=${r.onlyAst.length}`,
  );
  for (const k of r.onlyToken) console.log(`only-token\t${k}`);
  for (const k of r.onlyAst) console.log(`only-ast\t${k}`);
  return r.onlyToken.length + r.onlyAst.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
