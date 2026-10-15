// The whole menu of a project's own code: every exported function, hook, component, constant, class
// and type in the folders a ticket touches and in the packages it shares, so that a ticket's clerk
// knows the helpers the project already has while it plans, before it designs a new one.
//
//   run code-index <repo> <folder-or-glob>... [--match <draft>] [--max <n>] [--out <file>] [--tests]
//
// A folder is walked for TypeScript and JavaScript files (ts, tsx, js, jsx, mjs, cjs), leaving out
// node_modules, build output, declaration files, and test, mock and story files unless `--tests`
// is given. A glob such as `packages/*/src` is expanded from the repo root. The name, a one-line
// signature, the first sentence of the comment above it and the line it sits on are listed.
//
// Without `--match` every export is printed. With `--match <draft>` the output is a menu: the
// exports ranked against the words of the draft, the best `--max` (60) and then those whose names
// share a word the draft keeps repeating, each with the words it matched, and after them a map of
// every export, by file. The menu carries the draft's vocabulary key. See scripts/api-index.ts,
// which does the same for libraries, and skills/clerk/clerk.md for what the clerk does with the
// menus.
//
// Lines are tab separated: symbol, kind, signature, doc, where, matched.
//
//   exit 0  printed or written
//   exit 1  no exports found in the folders
//   exit 2  usage
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { scanLines } from "./lib/api-extract.ts";
import {
  type IndexEntry,
  draftText,
  formatList,
  rank,
  vocabulary,
  vocabularyKey,
} from "./lib/index-match.ts";

const USAGE =
  "usage: run code-index <repo> <folder-or-glob>... [--match <draft>] [--max <n>] [--out <file>] [--tests]";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".worktrees",
  ".postmaster",
  ".next",
  ".turbo",
  ".output",
  ".wrangler",
  ".cache",
  "out",
]);
const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;
const TEST_RE = /(?:\.test\.|\.spec\.|\.stories\.|(?:^|\/)__tests__\/|(?:^|\/)__mocks__\/)/u;
const NAME = "[A-Za-z_$][A-Za-z0-9_$]*";
const EXPORT = {
  fn: new RegExp(
    `^export[ \\t]+(?:default[ \\t]+)?(?:async[ \\t]+)?function[ \\t]*\\*?[ \\t]*(${NAME})`,
    "u",
  ),
  cnst: new RegExp(`^export[ \\t]+(?:declare[ \\t]+)?(?:const|let|var)[ \\t]+(${NAME})`, "u"),
  cls: new RegExp(
    `^export[ \\t]+(?:default[ \\t]+)?(?:abstract[ \\t]+)?class[ \\t]+(${NAME})`,
    "u",
  ),
  decl: new RegExp(
    `^export[ \\t]+(?:declare[ \\t]+)?(?:const[ \\t]+)?(type|interface|enum)[ \\t]+(${NAME})`,
    "u",
  ),
  list: /^export[ \t]*(?:type[ \t]*)?\{([^}]*)\}/u,
  listOpen: /^export[ \t]*(?:type[ \t]*)?\{[^}]*$/u,
};

interface Options {
  readonly repo: string;
  readonly folders: readonly string[];
  readonly match?: string;
  readonly max: number;
  readonly out?: string;
  readonly tests: boolean;
}

export function parseArgs(argv: readonly string[]): Options | string {
  const pos: string[] = [];
  const flags = new Map<string, string>();
  let tests = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--tests") {
      tests = true;
    } else if (["--match", "--max", "--out"].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      flags.set(a, v);
      i += 1;
    } else if (a.startsWith("--")) {
      return `unknown option ${a}`;
    } else {
      pos.push(a);
    }
  }
  if (pos.length < 2) return USAGE;
  const max = Number(flags.get("--max") ?? "60");
  if (!Number.isInteger(max) || max < 1) return "--max is a whole number of at least 1";
  return {
    repo: resolve(pos[0] as string),
    folders: pos.slice(1),
    match: flags.get("--match"),
    max,
    out: flags.get("--out"),
    tests,
  };
}

function walk(path: string, out: string[]): void {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    out.push(path);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(path).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    walk(join(path, name), out);
  }
}

/** The paths a pattern names, one `*` per path segment at most matching any run of characters but a slash. */
export function expandPattern(repo: string, pattern: string): string[] {
  let bases = [""];
  for (const segment of pattern.split("/").filter((s) => s !== "")) {
    const next: string[] = [];
    if (!segment.includes("*")) {
      for (const b of bases) next.push(join(b, segment));
    } else {
      const re = new RegExp(
        `^${segment.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*")}$`,
        "u",
      );
      for (const b of bases) {
        let names: string[] = [];
        try {
          names = readdirSync(join(repo, b));
        } catch {
          continue;
        }
        for (const name of names.sort()) if (re.test(name)) next.push(join(b, name));
      }
    }
    bases = next;
  }
  return bases.map((b) => join(repo, b));
}

/** The source files under the folders and globs, relative to the repo, in a stable order. */
export function sourceFiles(repo: string, folders: readonly string[], tests: boolean): string[] {
  const roots: string[] = [];
  for (const f of folders) {
    if (f.includes("*")) {
      roots.push(...expandPattern(repo, f));
    } else {
      roots.push(resolve(repo, f));
    }
  }
  const all: string[] = [];
  for (const r of roots) walk(r, all);
  const seen = new Set<string>();
  const files: string[] = [];
  for (const abs of all) {
    const rel = relative(repo, abs);
    if (seen.has(rel) || !SOURCE_RE.test(rel) || rel.endsWith(".d.ts")) continue;
    if (!tests && TEST_RE.test(rel)) continue;
    seen.add(rel);
    files.push(rel);
  }
  return files.sort();
}

function kindOf(name: string, file: string, base: string): string {
  if (/^use[A-Z]/u.test(name)) return "hook";
  if (/^[A-Z].*[a-z]/u.test(name) && file.endsWith("x") && base !== "type") return "component";
  return base;
}

function signatureOf(code: string): string {
  const one = code
    .replace(/[ \t]+/gu, " ")
    .trim()
    .replace(/[;,{]+$/u, "")
    .trim();
  return one.length > 140 ? `${one.slice(0, 137)}...` : one;
}

/** The exports of one file. */
export function exportsOf(text: string, file: string): IndexEntry[] {
  const lines = scanLines(text, true);
  const out: IndexEntry[] = [];
  const add = (
    symbol: string,
    kind: string,
    line: { no: number; doc: string },
    code: string,
  ): void => {
    out.push({ symbol, kind, signature: signatureOf(code), doc: line.doc, file, line: line.no });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as (typeof lines)[number];
    const code = line.code.trim();
    if (!code.startsWith("export")) continue;
    let m: RegExpExecArray | null;
    if ((m = EXPORT.fn.exec(code)))
      add(m[1] as string, kindOf(m[1] as string, file, "function"), line, code);
    else if ((m = EXPORT.cnst.exec(code)))
      add(m[1] as string, kindOf(m[1] as string, file, "const"), line, code);
    else if ((m = EXPORT.cls.exec(code))) add(m[1] as string, "class", line, code);
    else if ((m = EXPORT.decl.exec(code))) add(m[2] as string, m[1] as string, line, code);
    else if (EXPORT.list.test(code) || EXPORT.listOpen.test(code)) {
      let joined = code;
      let j = i;
      while (!joined.includes("}") && j + 1 < lines.length) {
        j += 1;
        joined += ` ${(lines[j] as (typeof lines)[number]).code.trim()}`;
      }
      const body = /\{([^}]*)\}/u.exec(joined);
      for (const part of (body?.[1] ?? "").split(",")) {
        const pieces = part
          .trim()
          .replace(/^type[ \t]+/u, "")
          .split(/[ \t]+as[ \t]+/u);
        const name = (pieces[pieces.length - 1] ?? "").trim();
        if (name !== "" && name !== "default") add(name, "re-export", line, code);
      }
    }
  }
  return out;
}

function main(argv: string[]): number {
  const o = parseArgs(argv);
  if (typeof o === "string") {
    console.error(o === USAGE ? o : `code-index: ${o}\n${USAGE}`);
    return 2;
  }
  const files = sourceFiles(o.repo, o.folders, o.tests);
  const entries: IndexEntry[] = [];
  for (const f of files) entries.push(...exportsOf(readFileSync(join(o.repo, f), "utf8"), f));
  if (entries.length === 0) {
    console.error(
      `code-index: no exports found in ${o.folders.join(", ")} (${files.length} source files)`,
    );
    return 1;
  }
  const title = `code-index ${o.folders.join(" ")} (${files.length} source files)`;
  let rows: Array<{ entry: IndexEntry; matched?: readonly string[] }> = entries.map((entry) => ({
    entry,
  }));
  let key: string | undefined;
  if (o.match !== undefined) {
    let draft: string;
    try {
      draft = readFileSync(o.match, "utf8");
    } catch (e) {
      console.error(
        `code-index: cannot read ${o.match}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 2;
    }
    const vocab = vocabulary(draftText(draft));
    key = vocabularyKey(vocab);
    rows = rank(entries, vocab, o.max).map((c) => ({ entry: c.entry, matched: c.matched }));
  }
  const text = formatList(
    { title, vocabularyKey: key, total: entries.length },
    rows,
    o.match !== undefined ? entries : undefined,
  );
  if (o.out === undefined) {
    process.stdout.write(text);
    return 0;
  }
  mkdirSync(dirname(resolve(o.out)), { recursive: true });
  writeFileSync(o.out, text);
  console.log(
    `code-index: ${files.length} files, ${entries.length} exports${o.match !== undefined ? `, ${rows.length} candidates` : ""}, written to ${o.out}`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
