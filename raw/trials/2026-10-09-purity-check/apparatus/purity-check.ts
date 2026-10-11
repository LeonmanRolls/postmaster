// The purity check of trial 4 (#366). It flags the places in a script's core and in the shared
// helpers that read the environment or the clock, or reach files, processes or the operating
// system. It does not decide whether a function is pure.
//
//   bun --no-env-file --config=/dev/null purity-check.ts --root <dir> [--scope core|all] [--count|--files]
//
// <dir> holds a `scripts/` folder. Scope `core`, the default, is the modules named `*-core.ts`
// anywhere under scripts/ and the non-test modules under scripts/lib/. Scope `all` is every
// non-test module under scripts/, used only to show what the scope leaves out.
//
// Output: a first line starting with `#`, then one tab-separated line per flagged place,
//   path  line  col  rule  kind  page  text
// `page` is `yes` when the page's own list finds the place (process.env, Date.now and imports of
// fs, child_process and os) and `no` when only the names added by the ticket find it.
// `--count` prints the number of flagged places alone; `--files` prints each module read with
// its count, so a module with nothing flagged shows as 0.
//
// What is flagged, one place per import declaration and per read or call: process.env,
// import.meta.env and Bun.env; Date.now, performance.now and `new Date()` with no argument;
// static and dynamic imports and require calls of fs, fs/promises, child_process and os, with or
// without the `node:` prefix; Bun.file, Bun.write, Bun.spawn, Bun.spawnSync and Bun.$.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

type Kind = "env" | "clock" | "file" | "process" | "os";
type Scope = "core" | "all";
type TokenKind = "id" | "punct" | "str" | "num" | "regex" | "tpl";

type Token = Readonly<{ kind: TokenKind; text: string; pos: number; end: number }>;

type Flag = Readonly<{
  pos: number;
  end: number;
  rule: string;
  kind: Kind;
  page: boolean;
  typeOnly: boolean;
  text: string;
}>;

type Place = Flag & Readonly<{ path: string; line: number; col: number; endLine: number }>;

export const MEMBER_RULES: ReadonlyMap<string, Kind> = new Map([
  ["process.env", "env"],
  ["Bun.env", "env"],
  ["Date.now", "clock"],
  ["performance.now", "clock"],
  ["Bun.file", "file"],
  ["Bun.write", "file"],
  ["Bun.spawn", "process"],
  ["Bun.spawnSync", "process"],
  ["Bun.$", "process"],
]);
export const PAGE_MEMBERS: ReadonlySet<string> = new Set(["process.env", "Date.now"]);

export const MODULE_KINDS: ReadonlyMap<string, Kind> = new Map([
  ["fs", "file"],
  ["fs/promises", "file"],
  ["child_process", "process"],
  ["os", "os"],
]);
export const PAGE_MODULES: ReadonlySet<string> = new Set(["fs", "child_process", "os"]);

const REGEX_KEYWORDS: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isIdStart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z_$#]/u.test(c) || c > "\u007f");
const isIdPart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z0-9_$]/u.test(c) || c > "\u007f");
const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

const lineEnd = (src: string, from: number): number => {
  const e = src.indexOf("\n", from);
  return e < 0 ? src.length : e;
};

const regexAllowedAfter = (prev: Token | undefined): boolean => {
  if (prev === undefined) return true;
  if (prev.kind === "id") return REGEX_KEYWORDS.has(prev.text);
  if (prev.kind !== "punct") return false;
  return ![")", "]", "}", "++", "--"].includes(prev.text);
};

/** End of a regular expression literal starting at `from`, or -1 when the line holds none. */
const regexEnd = (src: string, from: number): number => {
  let j = from + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") j += 2;
    else {
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (isIdPart(src[j])) j++;
        return j;
      }
      j++;
    }
  }
  return -1;
};

/** Splits TypeScript source into code tokens. Comments and the text of strings, templates and
 * regular expressions are never code, so they are skipped; the expressions inside a template
 * are code and are tokenized. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const n = src.length;
  const exprDepths: number[] = [];
  let depth = 0;
  let i = src.startsWith("#!") ? lineEnd(src, 0) : 0;
  const add = (kind: TokenKind, text: string, pos: number, end: number): void => {
    out.push({ kind, text, pos, end });
  };
  const readTemplate = (from: number): number => {
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "`") {
        add("tpl", "", j, j + 1);
        return j + 1;
      } else if (c === "$" && src[j + 1] === "{") {
        add("punct", "${", j, j + 2);
        exprDepths.push(depth);
        depth++;
        return j + 2;
      } else j++;
    }
    return n;
  };
  while (i < n) {
    const c = src[i] as string;
    const c2 = src[i + 1];
    if (isSpace(c)) i++;
    else if (c === "/" && c2 === "/") i = lineEnd(src, i);
    else if (c === "/" && c2 === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      add("str", src.slice(i + 1, j), i, j + 1);
      i = j + 1;
    } else if (c === "`") i = readTemplate(i + 1);
    else if (c === "{") {
      depth++;
      add("punct", c, i, i + 1);
      i++;
    } else if (c === "}") {
      depth--;
      add("punct", c, i, i + 1);
      i++;
      if (exprDepths.length > 0 && exprDepths[exprDepths.length - 1] === depth) {
        exprDepths.pop();
        i = readTemplate(i);
      }
    } else if (c === "/" && regexAllowedAfter(out[out.length - 1]) && regexEnd(src, i) > 0) {
      const e = regexEnd(src, i);
      add("regex", "", i, e);
      i = e;
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (isIdPart(src[j])) j++;
      add("id", src.slice(i, j), i, j);
      i = j;
    } else if (isDigit(c) || (c === "." && isDigit(c2))) {
      let j = i + 1;
      while (isIdPart(src[j]) || (src[j] === "." && isDigit(src[j + 1]))) j++;
      add("num", src.slice(i, j), i, j);
      i = j;
    } else if (c === "." && src.startsWith("...", i)) {
      add("punct", "...", i, i + 3);
      i += 3;
    } else if (c === "?" && c2 === "." && !isDigit(src[i + 2])) {
      add("punct", "?.", i, i + 2);
      i += 2;
    } else if ((c === "+" || c === "-") && c2 === c) {
      add("punct", c + c, i, i + 2);
      i += 2;
    } else {
      add("punct", c, i, i + 1);
      i++;
    }
  }
  return out;
}

const isPunct = (t: Token | undefined, ...texts: string[]): boolean =>
  t !== undefined && t.kind === "punct" && texts.includes(t.text);
const isId = (t: Token | undefined, text?: string): boolean =>
  t !== undefined && t.kind === "id" && (text === undefined || t.text === text);

/** The name read from the token at `k`: `.name`, `?.name` or `["name"]`, with the last token's index. */
const memberAfter = (
  t: readonly Token[],
  k: number,
): { name: string; last: number } | undefined => {
  const dot = t[k + 1];
  const name = t[k + 2];
  if (isPunct(dot, ".", "?.") && name !== undefined && name.kind === "id") {
    return { name: name.text, last: k + 2 };
  }
  if (isPunct(dot, "[") && name !== undefined && name.kind === "str" && isPunct(t[k + 3], "]")) {
    return { name: name.text, last: k + 3 };
  }
  return undefined;
};

const squash = (s: string): string => s.replace(/\s+/gu, " ").trim();

/** Every flagged place in one module's source, in source order. */
export function flagSource(src: string): Flag[] {
  const t = tokenize(src);
  const flags: Flag[] = [];
  const add = (from: Token, to: Token, rule: string, kind: Kind, page: boolean, typeOnly = false) =>
    flags.push({
      pos: from.pos,
      end: to.end,
      rule,
      kind,
      page,
      typeOnly,
      text: squash(src.slice(from.pos, to.end)),
    });
  for (let k = 0; k < t.length; k++) {
    const a = t[k] as Token;
    if (a.kind === "str") {
      const prev = t[k - 1];
      const spec = a.text.startsWith("node:") ? a.text.slice(5) : a.text;
      const kind = MODULE_KINDS.get(spec);
      if (kind === undefined) continue;
      let start: Token | undefined;
      if (isId(prev, "from")) {
        for (let m = k - 2; m >= 0 && !isPunct(t[m], ";"); m--) {
          if (isId(t[m], "import") || isId(t[m], "export")) {
            start = t[m];
            break;
          }
        }
      } else if (isId(prev, "import")) start = prev;
      else if (isPunct(prev, "(") && (isId(t[k - 2], "import") || isId(t[k - 2], "require"))) {
        start = t[k - 2];
      }
      if (start === undefined) continue;
      const startAt = t.indexOf(start);
      const typeOnly = isId(t[startAt + 1], "type") && !isId(t[startAt + 2], "from");
      const closing = isPunct(prev, "(") && isPunct(t[k + 1], ")") ? (t[k + 1] as Token) : a;
      add(start, closing, `import:${spec}`, kind, PAGE_MODULES.has(spec), typeOnly);
      continue;
    }
    if (a.kind !== "id") continue;
    const prev = t[k - 1];
    if (isPunct(prev, ".", "?.")) continue;
    if (a.text === "new" && isId(t[k + 1], "Date")) {
      if (!isPunct(t[k + 2], "(")) add(a, t[k + 1] as Token, "new Date()", "clock", false);
      else if (isPunct(t[k + 3], ")")) add(a, t[k + 3] as Token, "new Date()", "clock", false);
      continue;
    }
    if (a.text === "import" && isPunct(t[k + 1], ".") && isId(t[k + 2], "meta")) {
      const env = memberAfter(t, k + 2);
      if (env?.name === "env") add(a, t[env.last] as Token, "import.meta.env", "env", false);
      continue;
    }
    const member = memberAfter(t, k);
    if (member === undefined) continue;
    const rule = `${a.text}.${member.name}`;
    const kind = MEMBER_RULES.get(rule);
    if (kind !== undefined) add(a, t[member.last] as Token, rule, kind, PAGE_MEMBERS.has(rule));
  }
  return flags;
}

/** Whether a path, relative to the root and written with forward slashes, is in the check's scope. */
export function inScope(path: string, scope: Scope): boolean {
  if (!path.startsWith("scripts/") || !path.endsWith(".ts") || path.endsWith(".test.ts")) {
    return false;
  }
  return scope === "all" || path.startsWith("scripts/lib/") || path.endsWith("-core.ts");
}

const lineStarts = (src: string): number[] => {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
};

/** 1-based line and column of an offset, by binary search over the line starts. */
export function locate(starts: readonly number[], pos: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: pos - (starts[lo] as number) + 1 };
}

/** Flagged places of one module, with line and column. */
export function placesIn(path: string, src: string): Place[] {
  const starts = lineStarts(src);
  return flagSource(src).map((f) => ({
    ...f,
    path,
    ...locate(starts, f.pos),
    endLine: locate(starts, f.end - 1).line,
  }));
}

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git"]);

const walk = (dir: string, out: string[]): void => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (SKIPPED_FOLDERS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
};

/** The in-scope modules under root/scripts, as paths relative to root with forward slashes. */
export function modulesUnder(root: string, scope: Scope): string[] {
  const files: string[] = [];
  walk(join(root, "scripts"), files);
  return files.map((f) => relative(root, f).split(sep).join("/")).filter((p) => inScope(p, scope));
}

const tsv = (p: Place): string =>
  [
    p.path,
    p.line,
    p.col,
    p.rule + (p.typeOnly ? " (type only)" : ""),
    p.kind,
    p.page ? "yes" : "no",
    p.text,
  ].join("\t");

function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg("--root");
  const scope = (arg("--scope") ?? "core") as Scope;
  if (root === undefined || (scope !== "core" && scope !== "all")) {
    console.error("usage: purity-check.ts --root <dir> [--scope core|all] [--count|--files]");
    return 2;
  }
  const modules = modulesUnder(root, scope);
  const perModule = modules.map((path) => ({
    path,
    places: placesIn(path, readFileSync(join(root, path), "utf8")),
  }));
  const places = perModule.flatMap((m) => m.places);
  if (argv.includes("--count")) console.log(places.length);
  else if (argv.includes("--files")) {
    for (const m of perModule) console.log(`${m.path}\t${m.places.length}`);
  } else {
    console.log(`# scope=${scope} modules=${modules.length} flagged=${places.length}`);
    for (const p of places) console.log(tsv(p));
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
