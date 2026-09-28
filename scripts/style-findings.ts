#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const tool = dirname(here);
const SHOWN = 20;
const LONG = 4000;
const TICK = String.fromCharCode(96);
const posix = {
  join: (...parts: string[]) => join(...parts).replace(/\\/g, "/"),
  normalize: (path: string) => normalize(path).replace(/\\/g, "/"),
  basename,
  dirname: (path: string) => (dirname(path) === "." ? "" : dirname(path)),
};
const FORMS =
  'a sort line is one of: "S<n> linter <linter> enable <rule>: <reason>", "S<n> linter <linter> write <rule>: <reason>", either with "via <file>" after the rule, "S<n> docs <doc>: <reason>", "S<n> neither: <reason>", and "N<n> new-linter <linter> S<n>[,S<m>...]: <reason>", with "not-in-gate" after the findings';
type Finding = { id: string; target: string; rest: string };
type Cell = { mode: string; sha: string };
type CommandLine = { where: string; words: string[] };
type TextFile = { where: string; text: string };
type Rule = { prereqs: string[]; recipe: string[] };
type SortShape = { id: string; head: string[]; reason: string };
type Check = { line: number; id: string; kind: "linter" | "new"; linter: string; extra: string | boolean | null };
type Proposal = { id: string; key: string; via: string | null; fresh: [string[], boolean] | null };

class StyleError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string): never {
  throw new StyleError(message);
}
function read(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "ENOENT") die(`no ${what} at ${path}`);
    die(`cannot read ${what}: ${e.message || path}`);
  }
}
function plain(word: string): string {
  return word.replace(/^[\x60*_"']+|[\x60*_"']+$/g, "");
}
function named(name: string, text: string): boolean {
  const escaped = name.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "i").test(text);
}
function stripJs(text: string): string {
  text = text.replace(/\/\*.*?\*\//gs, " ");
  return text
    .split("\n")
    .filter((line) => !/^\s*\*/.test(line))
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}
function configText(text: string, path: string): string {
  if (/\.[cm]?[jt]s$/.test(path)) return stripJs(text);
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)[#;].*$/, "$1"))
    .join("\n");
}
function findings(dispatch: string): [Finding[], string[]] {
  const path = posix.join(dispatch, "actions.jsonl");
  const latest = new Map<string, { kind: string; rest: string }>();
  const faults: string[] = [];
  for (const [index, line] of read(path, "action log").split("\n").entries()) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      die(`${path} line ${index + 1} is not JSON`);
    }
    if (!e || typeof e !== "object" || e.action !== "finding") continue;
    const match = /^(\S+)(?:\s+(.*))?$/.exec(String(e.detail ?? "").trim());
    const detail = match ? [match[1]!, match[2] ?? ""] : [];
    if (!detail[0] || !["gating", "style"].includes(detail[0])) {
      faults.push(
        "actions.jsonl line " +
          (index + 1) +
          ": a finding whose detail opens with " +
          (detail[0] ? `"${detail[0]}"` : "nothing") +
          ", not gating or style",
      );
      continue;
    }
    const target = String(e.target ?? "");
    latest.delete(target);
    latest.set(target, { kind: detail[0], rest: detail[1] ?? "" });
  }
  const style = [...latest].filter(([, item]) => item.kind === "style");
  return [style.map(([target, item], i) => ({ id: `S${i + 1}`, target, rest: item.rest })), faults];
}
const MARK = "(?:\\*\\*|__)?";
function field(line: string, key: string, stops: string[]): string | null {
  const start = new RegExp(`^\\s*(?:[-*+]\\s+)?${MARK}${key}${MARK}\\s*:${MARK}(.*)$`, "i").exec(line);
  if (!start) return null;
  const next = new RegExp(`\\s+${MARK}(?:${stops.join("|")})${MARK}\\s*:${MARK}(?=\\s|$)`, "i").exec(start[1]!);
  let value = (next ? start[1]!.slice(0, next.index) : start[1]!).trim();
  if (value.startsWith(TICK) && value.endsWith(TICK) && value.length > 1) value = value.slice(1, -1).trim();
  return value;
}
function profile(dispatch: string): { repo: string | null; gate: string | null } {
  const lines = read(posix.join(dispatch, "brief.md"), "waybill").split("\n");
  const heads = lines.flatMap((line, i) => (/^ {0,3}##[ \t]+project profile[ \t:#]*\r?$/i.test(line) ? [i] : []));
  let repo: string | null = null;
  let gate: string | null = null;
  for (const line of heads.length ? lines.slice(heads.at(-1)! + 1) : []) {
    if (/^ {0,3}#{1,2}(?:[ \t]|\r?$)/.test(line)) break;
    repo ??= field(line, "repo", ["default branch", "BASE"]);
    gate ??= field(line, "gate", ["build", "browser suite"]);
  }
  return { repo: repo || null, gate: gate && gate.toLowerCase() !== "none" ? gate : null };
}
function git(repo: string, ...args: string[]): string | null {
  const result = command("git", ["-C", repo, ...args], { timeout: 120_000 });
  return result.code === 0 ? result.stdout : null;
}
class Tree {
  blobs = new Map<string, Cell>();
  dirs = new Set<string>([""]);
  cache = new Map<string, string | null>();
  constructor(
    readonly repo: string,
    branch: string,
  ) {
    const sha = (git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`) ?? "").trim();
    if (!sha) die(`no branch ${branch} in ${repo}: the gate is read as the run's branch has it`);
    const listing = git(repo, "ls-tree", "-r", "-z", "--full-tree", sha) ?? "";
    for (const ent of listing.split("\0")) {
      const [meta, path] = ent.split("\t", 2);
      const fields = meta?.split(/\s+/) ?? [];
      if (!path || fields.length !== 3 || fields[1] !== "blob") continue;
      this.blobs.set(path, { mode: fields[0]!, sha: fields[2]! });
      let d = posix.dirname(path);
      while (!this.dirs.has(d)) {
        this.dirs.add(d);
        d = posix.dirname(d);
      }
    }
  }
  path(cwd: string, path: string): string | null {
    if (!path || path.startsWith("/") || path.startsWith("~")) return null;
    const value = posix.normalize(posix.join(cwd, path));
    return value === "." ? "" : value === ".." || value.startsWith("../") ? null : value;
  }
  file(cwd: string, path: string): string | null {
    let p = this.path(cwd, path);
    if (!p || !this.blobs.has(p)) return null;
    const cell = this.blobs.get(p)!;
    if (cell.mode === "120000") {
      p = this.path(posix.dirname(p), (git(this.repo, "cat-file", "blob", cell.sha) ?? "").trim());
      if (!p || !this.blobs.has(p) || this.blobs.get(p)!.mode === "120000") return null;
    }
    return p;
  }
  dir(cwd: string, path: string): string | null {
    const p = this.path(cwd, path);
    return p && this.dirs.has(p) ? p : null;
  }
  read(path: string): string | null {
    if (!this.cache.has(path)) {
      const cell = this.blobs.get(path);
      const result = cell
        ? command("git", ["-C", this.repo, "cat-file", "blob", cell.sha], { timeout: 120_000 })
        : null;
      const data = result?.code === 0 ? result.stdout : null;
      this.cache.set(
        path,
        data && data.length <= 512 * 1024 && !data.slice(0, 8192).includes("\0") ? data.replace(/^\uFEFF/, "") : null,
      );
    }
    return this.cache.get(path) ?? null;
  }
  glob(cwd: string, pattern: string): string[] {
    const q = this.path(cwd, pattern);
    if (q === null) return [];
    if (!/[*?[]/.test(q)) return this.blobs.has(q) ? [q] : [];
    const regex = globRegex(q);
    return [...this.blobs.keys()].filter((path) => regex.test(path)).sort();
  }
  up(cwd: string, names: string[]): string | null {
    let d = cwd;
    while (true) {
      for (const name of names) {
        const p = d ? posix.join(d, name) : name;
        if (this.blobs.has(p)) return p;
      }
      if (!d) return null;
      d = posix.dirname(d);
    }
  }
}
function globRegex(pattern: string): RegExp {
  let body = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") i++;
      body += ".*";
    } else if (c === "?") body += ".";
    else if (c === "[" && pattern.indexOf("]", i + 1) !== -1) {
      const end = pattern.indexOf("]", i + 1);
      body += pattern.slice(i, end + 1);
      i = end;
    } else body += c.replace(/[.+^$(){}|\\]/g, "\\$&");
  }
  return new RegExp(`^${body}$`);
}
const PUNCT = new Set(";&|()<>");
const SHELL_WORDS = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "do",
  "else",
  "elif",
  "while",
  "until",
  "time",
  "exec",
  "builtin",
  "nohup",
]);
const INERT = new Set(
  "echo printf : true false exit return test [ [[ export set unset read shift local declare typeset trap wait sleep cat tee head tail wc sort uniq date pwd which type hash touch rm cp mv mkdir rmdir ln chmod chown ls fi done esac popd".split(
    " ",
  ),
);
const INTERPRETERS = new Set(
  "bash sh zsh dash ksh source . node nodejs python python3 bun deno tsx ts-node ruby perl".split(" "),
);
const BUILTINS: Record<string, Set<string>> = {
  pnpm: new Set(
    "add install i update up upgrade remove rm uninstall link ln unlink import rebuild rb prune fetch patch patch-commit exec dlx create run publish pack audit list ls outdated why root bin config c env setup store init deploy licenses server doctor".split(
      " ",
    ),
  ),
  yarn: new Set(
    "add install remove up upgrade run exec dlx workspace workspaces info why pack npm plugin set config version node bin cache dedupe explain init link unlink patch rebuild stage unplug global publish".split(
      " ",
    ),
  ),
  bun: new Set(
    "run test x repl exec install i add a remove rm update outdated link unlink publish patch patch-commit pm build init create c upgrade completions discord help audit why info".split(
      " ",
    ),
  ),
};
const RUNNERS: Record<string, string[]> = {
  "pre-commit": [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  prek: [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  lefthook: ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook.toml", "lefthook.json"],
  "lint-staged": [
    ".lintstagedrc",
    ".lintstagedrc.json",
    ".lintstagedrc.yaml",
    ".lintstagedrc.yml",
    ".lintstagedrc.js",
    ".lintstagedrc.cjs",
    ".lintstagedrc.mjs",
    "lint-staged.config.js",
    "lint-staged.config.cjs",
    "lint-staged.config.mjs",
  ],
  tox: ["tox.ini"],
  nox: ["noxfile.py"],
};
function uncomment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || " \t;&|()".includes(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}
function subst(line: string): string {
  line = line.replace(/\$\(MAKE\)|\$\{MAKE\}/g, "make").replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^{}]*)\}/g, "$1");
  for (let i = 0; i < 10; i++) {
    const next = line.replace(/\$\(([^()]*)\)/g, "$1");
    if (next === line) break;
    line = next;
  }
  return line.replace(/\$\{[^{}]*\}/g, "_").replace(/\x60/g, " ");
}
function lex(line: string): Array<{ kind: "cmd" | "sep"; value: string[] | string }> {
  line = subst(uncomment(line));
  const tokens: string[] = [];
  let word = "",
    quote = "",
    escaped = false;
  const flush = () => {
    if (word) tokens.push(word);
    word = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (escaped) {
      word += c;
      escaped = false;
    } else if (c === "\\" && quote !== "'") escaped = true;
    else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === "'" || c === '"') quote = c;
    else if (" \t\r".includes(c)) flush();
    else if (PUNCT.has(c)) {
      flush();
      let p = c;
      while (i + 1 < line.length && line[i + 1] === c && "&|<>".includes(c)) p += line[++i]!;
      tokens.push(p);
    } else word += c;
  }
  flush();
  const out: Array<{ kind: "cmd" | "sep"; value: string[] | string }> = [];
  let words: string[] = [];
  let skip = false;
  for (const token of tokens) {
    if (skip) {
      skip = false;
      continue;
    }
    if ([...token].every((c) => PUNCT.has(c))) {
      if (token.includes("<") || token.includes(">")) {
        skip = true;
        continue;
      }
      if (words.length) out.push({ kind: "cmd", value: words });
      words = [];
      out.push({ kind: "sep", value: token });
    } else words.push(token);
  }
  if (words.length) out.push({ kind: "cmd", value: words });
  return out;
}
function unwrap(words: string[]): string[] {
  const n = words.length;
  let i = 0;
  const past = (j: number, valued: string[] = []) => {
    while (j < n && words[j]!.startsWith("-") && words[j] !== "--") j += valued.includes(words[j]!) ? 2 : 1;
    return j < n && words[j] === "--" ? j + 1 : j;
  };
  while (i < n) {
    const w = words[i]!;
    const b = posix.basename(w);
    const next = words[i + 1] ?? "";
    if (SHELL_WORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(w)) i++;
    else if (b === "command") {
      if (next === "-v" || next === "-V") return [];
      i++;
    } else if (b === "env") i = past(i + 1, ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);
    else if (["cross-env", "cross-env-shell", "stdbuf", "nice"].includes(b)) i = past(i + 1, ["-n", "--adjustment"]);
    else if (b === "timeout") i = past(i + 1, ["-s", "--signal", "-k", "--kill-after"]) + 1;
    else if (["npx", "pnpx", "bunx"].includes(b)) i = past(i + 1, ["-p", "--package"]);
    else if (["dotenv", "dotenvx"].includes(b)) {
      const sep = words.indexOf("--", i);
      i = sep >= 0 ? sep + 1 : past(i + 1, ["-e", "-f", "-c", "-v"]);
      if (words[i] === "run") i++;
    } else if (["uv", "poetry", "pipenv", "hatch", "pdm", "rye"].includes(b) && next === "run")
      i = past(i + 2, ["--with", "--env", "-e", "--python", "-p"]);
    else if (b === "bundle" && next === "exec") i += 2;
    else if (b === "xargs") i = past(i + 1, ["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"]);
    else break;
  }
  return words.slice(i);
}
type JustRecipe = { deps: string[]; body: string[] };
function parseJust(text: string): {
  recipes: Map<string, JustRecipe>;
  vars: Map<string, string>;
  first: string | null;
} {
  const recipes = new Map<string, JustRecipe>();
  const vars = new Map<string, string>();
  let first: string | null = null;
  let current: JustRecipe | null = null;
  for (const line of text.split("\n")) {
    if (current && (/^[ \t]/.test(line) || !line.trim())) {
      if (line.trim()) current.body.push(line.trim());
      continue;
    }
    current = null;
    const s = line.trim();
    if (!s || /^(#|\[|set |import |mod )/.test(s)) continue;
    let m = /^alias\s+([\w-]+)\s*:=\s*([\w-]+)/.exec(s);
    if (m) {
      recipes.set(m[1]!, recipes.get(m[1]!) ?? { deps: [m[2]!], body: [] });
      continue;
    }
    m = /^(?:export\s+)?([A-Za-z_][\w-]*)\s*:=\s*(.*)$/.exec(s);
    if (m) {
      vars.set(m[1]!, m[2]!.replace(/^['"]|['"]$/g, ""));
      continue;
    }
    m = /^@?([A-Za-z_][\w-]*)\b[^:]*:(?!=)(.*)$/.exec(s);
    if (m) {
      current = { deps: m[2]!.replace(/\([^)]*\)/g, "").match(/[A-Za-z_][\w-]*/g) ?? [], body: [] };
      recipes.set(m[1]!, current);
      first ??= m[1]!;
    }
  }
  return { recipes, vars, first };
}
class Makefile {
  vars: Map<string, string>;
  rules = new Map<string, Rule>();
  fixed: Set<string>;
  first: string | null = null;
  goal: string | null = null;
  constructor(
    readonly tree: Tree,
    readonly path: string,
    readonly cwd: string,
    sets: Map<string, string>,
  ) {
    this.vars = new Map(sets);
    this.fixed = new Set(sets.keys());
    this.read(path, 0);
    this.goal = this.expand(this.vars.get(".DEFAULT_GOAL") ?? "").trim() || this.first;
  }
  expand(input: string, depth = 0): string {
    if (depth > 10 || !input.includes("$")) return input;
    return input.replace(/\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}/g, (match, a: string, b: string) => {
      const name = a || b;
      return this.vars.has(name) ? this.expand(this.vars.get(name)!, depth + 1) : name === "MAKE" ? "make" : match;
    });
  }
  recipe(line: string): string {
    return this.expand(line.replace(/^\s*[@+-]*/, "")).replace(/\$\$/g, "$");
  }
  read(path: string, depth: number): void {
    const text = this.tree.read(path) ?? "";
    let current: string[] | null = null;
    let define = false;
    for (const raw of text.replace(/\\\r?\n/g, " ").split("\n")) {
      if (define) {
        define = !/^\s*endef\b/.test(raw);
        continue;
      }
      if (raw.startsWith("\t")) {
        for (const target of current ?? []) this.rules.get(target)?.recipe.push(raw.slice(1));
        continue;
      }
      const s = raw.replace(/(?<!\\)#.*$/, "").trim();
      if (!s || /^(ifeq|ifneq|ifdef|ifndef|else|endif)\b/.test(s)) continue;
      if (/^(?:(?:export|override)\s+)*define\b/.test(s)) {
        define = true;
        current = null;
        continue;
      }
      let m = /^(?:-include|sinclude|include)\s+(.*)$/.exec(s);
      if (m) {
        if (depth < 10)
          for (const inc of this.expand(m[1]!).split(/\s+/).filter(Boolean))
            for (const p of this.tree.glob(this.cwd, inc)) this.read(p, depth + 1);
        current = null;
        continue;
      }
      m = /^(?:(?:export|override)\s+)*([A-Za-z0-9_.-]+)\s*(:{1,3}=|[?+!]?=)\s*(.*)$/.exec(s);
      if (m) {
        const [, name, op, value] = m as RegExpExecArray;
        if (!this.fixed.has(name!) && op !== "!=") {
          if (op === "?=") this.vars.set(name!, this.vars.get(name!) ?? value!);
          else if (op === "+=") this.vars.set(name!, `${this.vars.get(name!) ?? ""} ${value!}`.trim());
          else this.vars.set(name!, op!.startsWith(":") ? this.expand(value!) : value!);
        }
        current = null;
        continue;
      }
      m = /^([^:=]+?)\s*::?(?![:=])(.*)$/.exec(s);
      if (!m || /^\s*(?:(?:export|override)\s+)*[A-Za-z0-9_.-]+\s*(:{1,3}=|[?+!]?=)/.test(m[2]!)) {
        current = null;
        continue;
      }
      const [prereqs, inline = ""] = m[2]!.split(";", 2);
      current = this.expand(m[1]!).split(/\s+/).filter(Boolean);
      for (const target of current) {
        let rule = this.rules.get(target);
        if (!rule) {
          rule = { prereqs: [], recipe: [] };
          this.rules.set(target, rule);
        }
        rule.prereqs.push(
          ...this.expand(prereqs!)
            .split(/\s+/)
            .filter((p) => p && p !== "|"),
        );
        if (inline.trim()) rule.recipe.push(inline.trim());
        if (!this.first && !target.startsWith(".") && !target.includes("%")) this.first = target;
      }
    }
  }
}
class Reach {
  cmds: CommandLine[] = [];
  texts: TextFile[] = [];
  lines: TextFile[] = [];
  seen = new Set<string>();
  warnings: string[] = [];
  pkgs = new Map<string, Record<string, unknown>>();
  makes = new Map<string, Makefile>();
  justs = new Map<string, ReturnType<typeof parseJust>>();
  constructor(
    readonly tree: Tree,
    gate: string,
  ) {
    this.shell("gate", gate, "");
  }
  shell(where: string, text: string, cwd: string, keepCd = false): void {
    for (const raw of text.replace(/\\\r?\n/g, " ").split("\n")) {
      const line = uncomment(raw).trim();
      if (!line) continue;
      this.lines.push({ where, text: line });
      if (line.length <= LONG) {
        const after = this.scan(where, line, cwd);
        if (keepCd) cwd = after;
      }
    }
  }
  scan(where: string, line: string, cwd: string): string {
    const saved: string[] = [];
    for (const part of lex(line)) {
      if (part.kind === "sep") {
        if (part.value === "(") saved.push(cwd);
        else if (part.value === ")" && saved.length) cwd = saved.pop()!;
        continue;
      }
      const words = part.value as string[];
      const result = this.command(where, words, cwd);
      cwd = result.cwd;
      if (result.nested) for (const word of words) if (/\s/.test(word)) this.scan(where, word, cwd);
    }
    return cwd;
  }
  command(where: string, words: string[], cwd: string): { cwd: string; nested: boolean } {
    const w = unwrap(words);
    if (!w.length) return { cwd, nested: !words.length };
    const head = posix.basename(w[0]!);
    const rest = w.slice(1);
    if (head === "cd" || head === "pushd") {
      const arg = rest.find((item) => !item.startsWith("-"));
      return { cwd: this.tree.dir(cwd, arg ?? "") ?? cwd, nested: false };
    }
    if (INERT.has(head)) return { cwd, nested: false };
    this.cmds.push({ where, words: w });
    if (["npm", "pnpm", "yarn", "bun"].includes(head)) this.manager(where, head, rest, cwd);
    else if (["npm-run-all", "npm-run-all2", "run-s", "run-p"].includes(head))
      for (const arg of rest.filter((a) => !a.startsWith("-"))) this.scriptsLike(arg, cwd);
    else if (head === "make" || head === "gmake") this.make(rest, cwd);
    else if (head === "just") this.just(rest, cwd);
    else if (head === "turbo" || head === "lerna") this.tasks(rest, cwd);
    else if (RUNNERS[head]) this.configs(head, cwd);
    for (const arg of rest) if (arg.startsWith("npm:")) this.scriptsLike(arg.slice(4), cwd);
    if (INTERPRETERS.has(head)) {
      for (const arg of rest) {
        const path = arg.startsWith("-") ? null : this.tree.file(cwd, arg);
        if (path) {
          this.file(path, cwd);
          break;
        }
      }
    } else if (w[0]!.includes("/")) {
      const path = this.tree.file(cwd, w[0]!);
      if (path) this.file(path, cwd);
    }
    const inlineCode =
      ["node", "nodejs", "python", "python3", "bun", "deno", "ruby", "perl"].includes(head) &&
      ["-e", "--eval", "-p", "--print"].includes(rest[0] ?? "");
    return { cwd, nested: !inlineCode };
  }
  package(dir: string): Record<string, unknown> {
    if (!this.pkgs.has(dir)) {
      const path = dir ? `${dir}/package.json` : "package.json";
      let value: unknown = {};
      if (this.tree.blobs.has(path)) {
        try {
          value = JSON.parse(this.tree.read(path) ?? "");
        } catch {
          this.warnings.push(`${path} does not parse, so no script of it was followed`);
        }
      }
      this.pkgs.set(
        dir,
        value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
      );
    }
    return this.pkgs.get(dir)!;
  }
  scripts(dir: string): Record<string, string> {
    const scripts = this.package(dir).scripts;
    return scripts && typeof scripts === "object"
      ? (Object.fromEntries(Object.entries(scripts).filter(([, value]) => typeof value === "string")) as Record<
          string,
          string
        >)
      : {};
  }
  berry(): boolean {
    const version = /^yarn@(\d+)/.exec(String(this.package("").packageManager ?? ""));
    return Boolean((version && Number(version[1]) >= 2) || this.tree.blobs.has(".yarnrc.yml"));
  }
  workspaces(): string[] {
    const globs: string[] = [];
    const raw = this.package("").workspaces;
    const ws = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { packages?: unknown }).packages : raw;
    if (Array.isArray(ws)) globs.push(...ws.filter((g): g is string => typeof g === "string"));
    if (this.tree.blobs.has("lerna.json")) {
      try {
        const value = JSON.parse(this.tree.read("lerna.json") ?? "").packages;
        if (Array.isArray(value)) globs.push(...value.filter((g: unknown): g is string => typeof g === "string"));
      } catch {}
    }
    let inside = false;
    for (const line of (this.tree.read("pnpm-workspace.yaml") ?? "").split("\n")) {
      if (/^packages\s*:/.test(line)) inside = true;
      else if (inside && /^\s+-\s*/.test(line))
        globs.push(
          line
            .replace(/^\s+-\s*|\s+#.*$/g, "")
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        );
      else if (inside && line.trim() && !/^\s/.test(line)) inside = false;
    }
    const keep = globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/\/+$/, ""));
    const drop = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1).replace(/\/+$/, ""));
    const dirs = new Set(
      [...this.tree.blobs.keys()].filter((p) => posix.basename(p) === "package.json").map((p) => posix.dirname(p)),
    );
    dirs.delete("");
    return [...dirs].filter((d) => keep.some((g) => matchGlob(d, g)) && !drop.some((g) => matchGlob(d, g))).sort();
  }
  selects(sel: string, dir: string): boolean {
    let s = sel
      .trim()
      .replace(/^\.\.\.|\.\.\.$/g, "")
      .replace(/[{}]/g, "");
    if (s.startsWith("./")) s = s.slice(2);
    const name = String(this.package(dir).name ?? "");
    return [dir, posix.basename(dir), name].includes(s) || matchGlob(dir, s) || Boolean(name && matchGlob(name, s));
  }
  packages(ws: "all" | string[] | null, cwd: string): string[] {
    if (ws === null) {
      const p = this.tree.up(cwd, ["package.json"]);
      return p ? [posix.dirname(p)] : [];
    }
    const dirs = this.workspaces();
    const selected = ws === "all" ? dirs : dirs.filter((d) => ws.some((s) => this.selects(s, d)));
    return selected.length ? selected : dirs;
  }
  manager(where: string, pm: string, args: string[], initialCwd: string): void {
    let ws: "all" | string[] | null = null;
    let cwd = initialCwd;
    let i = 0;
    while (i < args.length && args[i]!.startsWith("-")) {
      const [key, value0] = args[i]!.split("=", 2);
      const equal = args[i]!.includes("=");
      const takes =
        ["-C", "--dir", "--prefix", "--cwd", "--filter", "-F"].includes(key!) ||
        (["-w", "--workspace"].includes(key!) && pm !== "pnpm");
      const value = equal ? value0! : (args[i + 1] ?? "");
      if (["-r", "--recursive", "-ws", "--workspaces"].includes(key!)) ws = "all";
      else if (["-C", "--dir", "--prefix", "--cwd"].includes(key!)) cwd = this.tree.dir(cwd, value) ?? cwd;
      else if (takes) ws = [...(Array.isArray(ws) ? ws : []), value];
      i += takes && !equal ? 2 : 1;
    }
    if (i >= args.length) return;
    const sub = args[i]!;
    const after = args.slice(i + 1);
    if (after.some((a) => ["-ws", "--workspaces"].includes(a))) ws = "all";
    const names = after.filter((a) => !a.startsWith("-"));
    if (["run", "run-script", "rum", "urn"].includes(sub)) {
      if (names[0]) this.run(pm, names[0], ws, cwd);
    } else if (pm === "npm" && ["test", "t", "tst", "start", "stop", "restart"].includes(sub)) {
      this.run(pm, ({ t: "test", tst: "test" } as Record<string, string>)[sub] ?? sub, ws, cwd);
    } else if (
      [
        ["npm", "exec"],
        ["npm", "x"],
        ["pnpm", "exec"],
        ["pnpm", "dlx"],
        ["yarn", "exec"],
        ["yarn", "dlx"],
        ["bun", "x"],
      ].some(([a, b]) => pm === a && sub === b)
    ) {
      let j = 0;
      while (j < after.length && after[j]!.startsWith("-") && after[j] !== "--") j++;
      this.command(where, after[j] === "--" ? after.slice(j + 1) : after.slice(j), cwd);
    } else if (pm === "yarn" && sub === "workspaces" && names[0] === "foreach") {
      const left = after.slice(after.includes("run") ? after.indexOf("run") + 1 : 1).filter((a) => !a.startsWith("-"));
      if (left[0]) this.run(pm, left[0], "all", cwd);
    } else if (pm === "yarn" && sub === "workspace" && names.length > 1) {
      const left = names[1] === "run" ? names.slice(2) : names.slice(1);
      if (left[0]) this.run(pm, left[0], [names[0]!], cwd);
    } else if (pm !== "npm" && !BUILTINS[pm]!.has(sub)) this.run(pm, sub, ws, cwd);
  }
  run(pm: string, name: string, ws: "all" | string[] | null, cwd: string): void {
    const dirs = this.packages(ws, cwd);
    for (const dir of dirs) if (name in this.scripts(dir)) this.script(dir, name, pm);
    if (pm === "bun" && ws === null && !dirs.some((dir) => name in this.scripts(dir))) {
      const path = this.tree.file(cwd, name);
      if (path) this.file(path, cwd);
    }
  }
  script(dir: string, name: string, pm: string): void {
    const scripts = this.scripts(dir);
    const hooks = pm === "yarn" && this.berry() ? [] : [`pre${name}`, `post${name}`];
    for (const current of [...hooks.slice(0, 1), name, ...hooks.slice(1)]) {
      const key = `script\0${dir}\0${current}`;
      if (current in scripts && !this.seen.has(key)) {
        this.seen.add(key);
        this.shell(`${dir ? `${dir}/` : ""}package.json scripts.${current}`, scripts[current]!, dir);
      }
    }
  }
  scriptsLike(pattern: string, cwd: string): void {
    let expr = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]!;
      if (c === "*" && pattern[i + 1] === "*") {
        expr += ".*";
        i++;
      } else if (c === "*") expr += "[^:]*";
      else if (c === "?") expr += "[^:]";
      else expr += c.replace(/[.+^$(){}|\\]/g, "\\$&");
    }
    const re = new RegExp(`^${expr}$`);
    for (const dir of this.packages(null, cwd))
      for (const name of Object.keys(this.scripts(dir)).sort()) if (re.test(name)) this.script(dir, name, "npm");
  }
  tasks(args: string[], cwd: string): void {
    const selections: string[] = [];
    const names: string[] = [];
    for (let i = 0; i < args.length && args[i] !== "--"; i++) {
      const [key, value] = args[i]!.split("=", 2);
      if (["--filter", "-F", "--scope"].includes(key!)) {
        selections.push(value ?? args[i + 1] ?? "");
        if (value === undefined) i++;
      } else if (!args[i]!.startsWith("-")) names.push(args[i]!);
    }
    const runNames = names[0] === "run" ? names.slice(1) : names[0] === "exec" ? [] : names;
    for (const name of runNames)
      this.run(
        "npm",
        name.startsWith("//#") ? name.slice(3) : name,
        name.startsWith("//#") ? null : selections.length ? selections : "all",
        cwd,
      );
  }
  make(args: string[], cwd: string): void {
    let dir = cwd;
    const files: string[] = [];
    const targets: string[] = [];
    const sets = new Map<string, string>();
    const valued = new Set(
      "-C --directory -f --file --makefile -I --include-dir -o --old-file --assume-old -W --what-if --new-file --assume-new --eval".split(
        " ",
      ),
    );
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      let [key, value] = arg.split("=", 2);
      if (valued.has(arg) && i + 1 < args.length) value = args[++i]!;
      else if (
        ["-j", "--jobs", "-l", "--load-average", "--max-load"].includes(arg) &&
        /^\d+(\.\d+)?$/.test(args[i + 1] ?? "")
      ) {
        i++;
        continue;
      } else if (/^-[Cf].+/.test(arg) && !arg.startsWith("--")) {
        key = arg.slice(0, 2);
        value = arg.slice(2);
      } else if (!arg.startsWith("-") && !arg.includes("=")) {
        targets.push(arg);
        continue;
      }
      if (["-C", "--directory"].includes(key!)) dir = this.tree.dir(dir, value ?? "") ?? dir;
      else if (["-f", "--file", "--makefile"].includes(key!)) files.push(value ?? "");
      else if (arg.includes("=") && !arg.startsWith("-")) sets.set(key!, value ?? "");
    }
    let path: string | null = null;
    for (const file of files.length ? files : ["GNUmakefile", "makefile", "Makefile"]) {
      path = this.tree.file(dir, file);
      if (path) break;
    }
    if (!path) return;
    const key = `${path}\0${dir}\0${[...sets].sort().join(",")}`;
    let mk = this.makes.get(key);
    if (!mk) {
      mk = new Makefile(this.tree, path, dir, sets);
      this.makes.set(key, mk);
    }
    for (const target of targets.length ? targets : mk.goal ? [mk.goal] : []) this.target(mk, target, dir);
  }
  target(mk: Makefile, target: string, dir: string): void {
    const key = `make\0${mk.path}\0${dir}\0${target}`;
    const rule = mk.rules.get(target);
    if (this.seen.has(key) || !rule) return;
    this.seen.add(key);
    for (const prereq of rule.prereqs) this.target(mk, prereq, dir);
    for (const line of rule.recipe) this.shell(`${mk.path} ${target}`, mk.recipe(line), dir);
  }
  just(args: string[], cwd: string): void {
    let jf: string | null = null;
    let wd: string | null = null;
    const names: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const [key, value0] = args[i]!.split("=", 2);
      if (["-f", "--justfile", "-d", "--working-directory"].includes(key!)) {
        const value = value0 ?? args[++i] ?? "";
        if (["-f", "--justfile"].includes(key!)) jf = value;
        else wd = value;
      } else if (key === "--set") i++;
      else if (!args[i]!.startsWith("-")) names.push(args[i]!);
    }
    const path = jf ? this.tree.file(cwd, jf) : this.tree.up(cwd, ["justfile", "Justfile", ".justfile", "JUSTFILE"]);
    if (!path) return;
    if (!this.justs.has(path)) this.justs.set(path, parseJust(this.tree.read(path) ?? ""));
    const parsed = this.justs.get(path)!;
    const dir = (wd ? this.tree.dir(cwd, wd) : null) ?? posix.dirname(path);
    const selected = names.filter((name) => parsed.recipes.has(name));
    for (const name of selected.length ? selected : parsed.first ? [parsed.first] : []) this.recipe(path, name, dir);
  }
  recipe(path: string, name: string, dir: string): void {
    const key = `just\0${path}\0${name}`;
    const parsed = this.justs.get(path)!;
    const recipe = parsed.recipes.get(name);
    if (!recipe || this.seen.has(key)) return;
    this.seen.add(key);
    for (const dep of recipe.deps) this.recipe(path, dep, dir);
    for (const body of recipe.body) {
      const line = body.replace(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, (_m, n: string) => parsed.vars.get(n) ?? _m);
      this.shell(`${path} ${name}`, line.replace(/^[@-]+/, ""), dir);
    }
  }
  configs(head: string, cwd: string): void {
    const found: TextFile[] = [];
    for (const name of RUNNERS[head] ?? []) {
      const path = this.tree.up(cwd, [name]);
      if (path) found.push({ where: path, text: configText(this.tree.read(path) ?? "", path) });
    }
    if (head === "lint-staged") {
      const path = this.tree.up(cwd, ["package.json"]);
      if (path) {
        const config = this.package(posix.dirname(path))["lint-staged"];
        if (config) found.push({ where: `${path} lint-staged`, text: JSON.stringify(config) });
      }
    }
    for (const item of found) {
      const key = `config\0${item.where}`;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.texts.push(item);
        this.lines.push(
          ...item.text
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => ({ where: item.where, text: line.trim() })),
        );
      }
    }
  }
  file(path: string, cwd: string): void {
    const key = `file\0${path}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const text = this.tree.read(path);
    if (text !== null) this.shell(path, /\.[cm]?[jt]sx?$/.test(path) ? stripJs(text) : text, cwd, true);
  }
  runs(linter: string): string | null {
    for (const { where, words } of this.cmds)
      if (words.some((word) => !/\s/.test(word) && named(linter, word))) return where;
    for (const { where, text } of this.texts) if (named(linter, text)) return where;
    return null;
  }
}
function matchGlob(value: string, pattern: string): boolean {
  return globRegex(pattern).test(value);
}
function hasLinter(tree: Tree, linter: string): string | null {
  const own = new RegExp(`^\\.?${linter.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")}(rc)?([._-].*)?$`, "i");
  for (const path of [...tree.blobs.keys()].sort()) if (own.test(posix.basename(path))) return path;
  const manifests =
    /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|tox\.ini|requirements[^/]*\.txt|Pipfile|Gemfile|go\.mod|Cargo\.toml|composer\.json|\.pre-commit-config\.ya?ml|\.tool-versions|mise\.toml)$/;
  for (const path of [...tree.blobs.keys()].sort())
    if (manifests.test(path) && named(linter, configText(tree.read(path) ?? "", path))) return path;
  return null;
}
function states(dispatch: string): Map<string, string> {
  const result = new Map<string, string>();
  const ledger = posix.join(posix.dirname(posix.normalize(dispatch)), "ledger.jsonl");
  let rows: string[];
  try {
    rows = readFileSync(ledger, "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n");
  } catch {
    return result;
  }
  for (const row of rows) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(row);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    const action = e.action;
    const detail = String(e.detail ?? "");
    const run = String(e.run ?? "?");
    if (action === "ticket-create" && detail.startsWith("style proposal: "))
      result.set(detail.slice(16).trim(), `filed ${String(e.target ?? "?")} in ${run}`);
    else if (action === "note" && detail.startsWith("style proposal declined: "))
      result.set(detail.slice(25).split(": ", 1)[0]!.trim(), `declined in ${run}`);
    else if (action === "note" && detail.startsWith("style proposal asked: ")) {
      const key = detail.slice(22).trim();
      if (!/^(filed|declined)/.test(result.get(key) ?? "")) result.set(key, `asked in ${run}`);
    }
  }
  return result;
}
function shape(line: string): SortShape | null {
  const m = /^(?:[-*+][ \t]+)?(S\d+|N\d+)[ \t]+(.+?):(?:[ \t]+(.*))?$/.exec(line);
  if (!m) return null;
  const id = m[1]!;
  const head = m[2]!.split(/\s+/);
  const ok = id.startsWith("S")
    ? (head[0] === "linter" &&
        ["enable", "write"].includes(head[2] ?? "") &&
        (head.length === 4 || (head.length === 6 && head[4] === "via"))) ||
      (head.length === 2 && head[0] === "docs") ||
      (head.length === 1 && head[0] === "neither")
    : head.length >= 3 && head[0] === "new-linter";
  return ok ? { id, head, reason: (m[3] ?? "").trim() } : null;
}
function forms(path: string): number {
  for (const line of read(path, "file").split("\n"))
    if (line.trim()) writeOut((shape(line.trim()) ? "ok  " : "bad ") + line.trim());
  return 0;
}
function branchTree(dispatch: string, repo: string): Tree {
  return new Tree(repo, basename(posix.normalize(dispatch)));
}
function gateCommand(dispatch: string): number {
  const { repo, gate } = profile(dispatch);
  if (!gate || !repo || !existsSync(repo)) {
    writeOut(
      !gate
        ? "the waybill's Project profile names no gate"
        : `the waybill's Project profile names no repo that exists${repo ? `: ${repo}` : ""}`,
    );
    return 2;
  }
  const reach = new Reach(branchTree(dispatch, repo), gate);
  for (const warning of reach.warnings) writeError(`style-findings: ${warning}`);
  const shown = new Map<string, number>();
  for (const line of reach.lines) {
    const count = (shown.get(line.where) ?? 0) + 1;
    shown.set(line.where, count);
    if (count <= SHOWN)
      writeOut(`${line.where}: ${line.text.length > 200 ? `${line.text.slice(0, 197)}...` : line.text}`);
  }
  for (const [where, count] of shown)
    if (count > SHOWN) writeOut(`${where}: ${count - SHOWN} more lines, read and not shown`);
  return 0;
}
function checkCommand(dispatch: string): number {
  const sort = posix.join(dispatch, "style-sort.md");
  const [style, faults] = findings(dispatch);
  const ids = style.map((item) => item.id);
  if (!existsSync(sort)) {
    if (faults.length || style.length) {
      writeOut(
        [
          ...faults,
          `no style-sort.md in ${dispatch}, and ${style.length} style finding${style.length === 1 ? "" : "s"} to sort`,
        ].join("\n"),
      );
      return 2;
    }
    writeOut("no style findings, so nothing to sort");
    return 0;
  }
  const onS = new Map<string, number[]>();
  const onN = new Map<string, number[]>();
  const firstNew = new Map<string, [number, string]>();
  const props: Proposal[] = [];
  const checks: Check[] = [];
  let badShape = false;
  for (const [index, raw] of read(sort, "sort").split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const got = shape(line);
    if (!got) {
      faults.push(`line ${index + 1} is not a sort line: ${line}`);
      badShape = true;
      continue;
    }
    const { id, head, reason } = got;
    if (!reason) faults.push(`line ${index + 1}: ${id} has no reason`);
    if (id.startsWith("S")) {
      onS.set(id, [...(onS.get(id) ?? []), index + 1]);
      if (!ids.includes(id)) faults.push(`line ${index + 1}: ${id} is not a style finding of this run`);
      if (head[0] === "linter") {
        const linter = plain(head[1]!);
        const via = head.length === 6 ? plain(head[5]!) : null;
        checks.push({ line: index + 1, id, kind: "linter", linter, extra: via });
        props.push({ id, key: `linter ${linter.toLowerCase()} ${head[2]} ${plain(head[3]!)}`, via, fresh: null });
      } else
        props.push({ id, key: head[0] === "docs" ? `docs ${plain(head[1]!)}` : "neither", via: null, fresh: null });
      continue;
    }
    onN.set(id, [...(onN.get(id) ?? []), index + 1]);
    const rest = head.slice(2);
    const marked = rest.at(-1) === "not-in-gate";
    const covers = (marked ? rest.slice(0, -1) : rest)
      .join(" ")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (!covers.length) faults.push(`line ${index + 1}: ${id} names no finding the linter would enforce`);
    for (const covered of covers)
      if (!ids.includes(covered))
        faults.push(`line ${index + 1}: ${id} names ${covered}, which is not a style finding of this run`);
    const linter = plain(head[1]!);
    const was = firstNew.get(linter.toLowerCase());
    if (!was) firstNew.set(linter.toLowerCase(), [index + 1, id]);
    else
      faults.push(
        `line ${index + 1}: ${id} proposes ${linter} again, as ${was[1]} on line ${was[0]} does: propose it once, for every finding it would enforce`,
      );
    checks.push({ line: index + 1, id, kind: "new", linter, extra: marked });
    props.push({ id, key: `new-linter ${linter.toLowerCase()}`, via: null, fresh: [covers, marked] });
  }
  for (const id of ids) if (!onS.has(id)) faults.push(`${id} is not sorted`);
  for (const [id, lines] of [...onS, ...onN])
    if (lines.length > 1) faults.push(`${id} is sorted twice, on lines ${lines.join(", ")}`);
  if (checks.length) {
    const { repo, gate } = profile(dispatch);
    if (!repo || !existsSync(repo)) {
      faults.push(
        ...checks.map(
          (item) =>
            `line ${item.line}: ${item.id} names ${item.linter}, and the waybill's Project profile names no repo that exists to check it against`,
        ),
      );
    } else {
      const tree = branchTree(dispatch, repo);
      const reach = gate ? new Reach(tree, gate) : null;
      for (const warning of reach?.warnings ?? []) writeError(`style-findings: ${warning}`);
      for (const item of checks) {
        if (item.kind === "linter" && typeof item.extra === "string" && item.extra) {
          const path = tree.file("", item.extra);
          if (!path)
            faults.push(
              `line ${item.line}: ${item.id} names ${item.linter} via ${item.extra}, which the run's branch does not have`,
            );
          else if (!named(item.linter, configText(tree.read(path) ?? "", path)))
            faults.push(
              `line ${item.line}: ${item.id} names ${item.linter} via ${item.extra}, which does not name ${item.linter}`,
            );
        } else if (item.kind === "linter" && !reach)
          faults.push(
            `line ${item.line}: ${item.id} names ${item.linter}, and the waybill's Project profile has no gate to check it against`,
          );
        else if (item.kind === "linter" && !reach!.runs(item.linter))
          faults.push(
            `line ${item.line}: ${item.id} names ${item.linter}, which ${TICK}gate${TICK} does not show the gate running: if the gate runs it some way ${TICK}gate${TICK} does not follow, add via and the file that runs it after the rule; if it does not, sort the finding docs or neither, and propose ${item.linter} on a new-linter line`,
          );
        else if (item.kind === "new") {
          const at = reach?.runs(item.linter);
          const own = hasLinter(tree, item.linter);
          if (at)
            faults.push(
              `line ${item.line}: ${item.id} proposes ${item.linter}, which the gate already runs (${at}): sort its findings as linter lines`,
            );
          else if (own && !item.extra)
            faults.push(
              `line ${item.line}: ${item.id} proposes ${item.linter}, which the project already has (${own}): if the gate runs it, sort its findings as linter lines, with via if ${TICK}gate${TICK} does not show it; if the gate does not, add not-in-gate after the findings`,
            );
        }
      }
    }
  }
  if (faults.length) {
    writeOut([...faults, ...(badShape ? [FORMS] : [])].join("\n"));
    return 2;
  }
  const groups = new Map<string, { ids: string[]; via: string[]; fresh: [string[], boolean] | null }>();
  const order: string[] = [];
  const history = states(dispatch);
  for (const item of props) {
    let group = groups.get(item.key);
    if (!group) {
      group = { ids: [], via: [], fresh: item.fresh };
      groups.set(item.key, group);
      order.push(item.key);
    }
    group.ids.push(item.id);
    if (item.via && !group.via.includes(item.via)) group.via.push(item.via);
  }
  const rank: Record<string, number> = { linter: 0, docs: 1, "new-linter": 2, neither: 3 };
  for (const key of order.sort((a, b) => rank[a.split(" ")[0]!]! - rank[b.split(" ")[0]!]! || a.localeCompare(b))) {
    const group = groups.get(key)!;
    const notes = group.fresh ? [`for ${group.fresh[0].join(" ")}`] : [];
    notes.push(...group.via.map((path) => `via ${path}`));
    if (group.fresh?.[1]) notes.push("not in the gate");
    if (key !== "neither" && history.has(key)) notes.push(history.get(key)!);
    writeOut(`${group.ids.join(" ")}: ${key}${notes.length ? ` [${notes.join("; ")}]` : ""}`);
  }
  const countKind = (kind: string) => props.filter((p) => p.id.startsWith("S") && p.key.split(" ")[0] === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  writeOut(
    `sorted ${plural(style.length, "style finding", "style findings")}: ${countKind("linter")} to a linter, ${countKind("docs")} to the docs, ${countKind("neither")} to neither; ${plural(firstNew.size, "new linter", "new linters")} proposed`,
  );
  return 0;
}
function main(args: string[]): number {
  const [cmd, dispatch] = args;
  if (cmd === "forms" && dispatch) return forms(dispatch);
  if (cmd === "--self-test" && args.length === 1) return selfTest();
  if (!cmd || !dispatch)
    throw new StyleError("usage: style-findings.sh list|count|gate|check <dispatch> | --self-test", 1);
  if (!["list", "count", "gate", "check"].includes(cmd))
    throw new StyleError("usage: style-findings.sh list|count|gate|check <dispatch> | --self-test", 1);
  try {
    if (!existsSync(dispatch)) throw new StyleError(`no dispatch directory at ${dispatch}`, 1);
  } catch {
    throw new StyleError(`no dispatch directory at ${dispatch}`, 1);
  }
  if (cmd === "list" || cmd === "count") {
    const [style, faults] = findings(dispatch);
    if (faults.length) {
      writeOut(faults.join("\n"));
      return 2;
    }
    if (cmd === "count") writeOut(String(style.length));
    else for (const item of style) writeOut([item.id, item.target, item.rest].filter(Boolean).join(" "));
    return 0;
  }
  if (cmd === "gate") return gateCommand(dispatch);
  return checkCommand(dispatch);
}
function selfTest(): number {
  const temp = mkdtempSync(join(here, ".style-findings-self-test-"));
  const self = join(here, "style-findings.ts");
  const skill = join(tool, "skills/postmaster");
  const runs = join(temp, "runs", "proj");
  const npm = join(temp, "npm");
  const makeRepo = join(temp, "make");
  const mono = join(temp, "mono");
  const other = join(temp, "other");
  const failures: string[] = [];
  let _controls = 0;
  const out = (text: string) => writeOut(text);
  const test = (label: string, good: boolean, detail = "") => {
    _controls++;
    if (good) out(`  ok   ${label}`);
    else {
      out(`  FAIL ${label}`);
      if (detail) for (const line of detail.split(/\r?\n/)) out(`         ${line}`);
      failures.push(label);
    }
  };
  const gitRun = (dir: string, ...args: string[]) =>
    command("git", [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "init.defaultBranch=main",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      dir,
      ...args,
    ]);
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const repoAt = (dir: string, branches: string[]) => {
    mkdirSync(dir, { recursive: true });
    const init = gitRun(dir, "init", "-q");
    put(join(dir, "seed"), "fixture\n");
    gitRun(dir, "add", "-A");
    gitRun(dir, "commit", "-q", "-m", "fixture");
    for (const branch of branches) gitRun(dir, "branch", branch);
    if (init.code !== 0) throw new Error(`could not initialize fixture ${dir}`);
  };
  const waybill = (dispatch: string, repo: string, gate: string, gateLine = "") => {
    mkdirSync(dispatch, { recursive: true });
    put(
      join(dispatch, "brief.md"),
      "# Waybill: T\n\n## Ticket\n## Problem / feature\nA change.\n\n## Project profile\ngate: make decoy\n\n## Project profile\nrepo: " +
        repo +
        "          default branch: main       BASE: abc123\n" +
        (gateLine || `gate: ${gate}  build: none    browser suite: none`) +
        "\ndocs to read first: AGENTS.md\n\n## Dispatch\ndispatch: " +
        dispatch +
        "\nturnpikes: style, bug, security\n",
    );
  };
  const logged = (dispatch: string, ...args: string[]) =>
    command(join(here, "log-action.sh"), [dispatch, "coachman", ...args]);
  const addFindings = (dispatch: string, count: number) => {
    for (let i = 1; i <= count; i++)
      logged(dispatch, "finding", `src/f${i}.ts:${i}`, `style P3 r1 style luna reading: finding ${i}`);
  };
  const sortFile = (dispatch: string, ...lines: string[]) =>
    put(join(dispatch, "style-sort.md"), `${lines.join("\n")}\n`);
  const invoke = (args: string[]) => command("bun", [self, ...args], { timeout: 120_000 });
  const exact = (
    label: string,
    result: { code: number; stdout: string; stderr: string },
    code: number,
    stdout: string,
  ) =>
    test(
      label,
      result.code === code && result.stdout.trimEnd() === stdout,
      `wanted exit ${code} and:\n${stdout}\ngot exit ${result.code} and:\n${result.stdout}${result.stderr}`,
    );
  const has = (
    label: string,
    result: { code: number; stdout: string; stderr: string },
    code: number,
    want: string,
    not = "",
  ) => {
    const output = result.stdout + result.stderr;
    test(label, result.code === code && output.includes(want) && (!not || !output.includes(not)), output);
  };
  try {
    out("positive controls: a run's style findings");
    mkdirSync(runs, { recursive: true });
    mkdirSync(join(npm, "scripts"), { recursive: true });
    put(
      join(npm, "package.json"),
      `${JSON.stringify(
        {
          devDependencies: { eslint: "9.0.0" },
          scripts: {
            check:
              "tsc --noEmit && npm run lint && run-s 'test:*' && npm run format:check && npm run quoted && touch gate-ran",
            precheck: "node scripts/versions.js && ./node_modules/.bin/helper",
            lint: "cross-env NODE_ENV=ci biome check . && pnpm typos # oxfmt is not run yet",
            typos: "typos . > scripts/typos.txt",
            "test:unit": "bun test && bun build ./src/index.ts",
            "test:unit:slow": "jest",
            "format:check": "prettier --check . || (echo 'run npm run format, to fix what eslint finds' && exit 1)",
            quoted: "sh -c 'tsc --noEmit # stylua later'",
            format: "eslint --fix .",
            build: "hadolint Dockerfile",
            "build:types": "tsc -p types",
            nbsp: "node -e \"console.log('a b : c')\" && dprint check",
            test: "vitest",
            docs: "markdownlint docs",
          },
        },
        null,
        2,
      )}\n`,
    );
    put(
      join(npm, "scripts/versions.js"),
      '/**\n * xo would be stricter\n */\n// oxlint would catch more here\nrequire("child_process").execSync("stylelint src") // knip later\n',
    );
    put(join(npm, "scripts/typos.txt"), "jscpd is written here, and nothing runs it\n");
    put(join(npm, "node_modules/.bin/helper"), "#!/bin/sh\nstandard --fix .\n");
    chmodSync(join(npm, "node_modules/.bin/helper"), 0o755);
    put(join(npm, ".gitignore"), "node_modules/\n");
    repoAt(npm, ["T-1", "T-2", "T-6", "T-7", "T-8", "T-16", "T-20", "T-21", "T-28"]);
    mkdirSync(join(makeRepo, "scripts", "mk", "web"), { recursive: true });
    put(
      join(makeRepo, "Makefile"),
      `${[
        "SHELLCHECK ?= shellcheck",
        "LINTER :::= yamllint",
        ".PHONY: check lint docs test",
        "check: lint docs test",
        "lint:",
        "\t@$(SHELLCHECK) scripts/*.sh",
        "\t$(LINTER) .",
        "ifdef CI",
        "\t$(MAKE) -C web lint",
        "endif",
        "\ttouch make-ran",
        "docs:",
        "\t-markdownlint docs",
        "test:",
        "\t./scripts/test.sh",
        "fmt:",
        "\truff format .",
        "include mk/*.mk",
      ].join("\n")}\n`,
    );
    put(join(makeRepo, "mk/extra.mk"), "docs: spell\nspell:\n\tcspell .\n");
    put(join(makeRepo, "web/Makefile"), "lint:\n\t./ci.sh\n");
    put(join(makeRepo, "web/ci.sh"), "#!/bin/sh\nstylelint .\n");
    put(join(makeRepo, "ci.sh"), "#!/bin/sh\nprettier --check .\n");
    put(join(makeRepo, "scripts/test.sh"), "#!/bin/sh\n# pylint is not run here\nbats test\n");
    repoAt(makeRepo, ["T-4", "T-24", "T-27"]);
    mkdirSync(join(mono, "packages/web"), { recursive: true });
    mkdirSync(join(mono, "packages/docs"), { recursive: true });
    put(
      join(mono, "package.json"),
      '{"name":"mono","workspaces":["packages/*"],"scripts":{"check":"npm run lint --workspaces && turbo run typecheck && pnpm -r test && npm -w packages/docs run spell","lint":"tsc"}}\n',
    );
    put(
      join(mono, "packages/web/package.json"),
      '{"name":"web","scripts":{"lint":"eslint .","typecheck":"tsc -b","test":"vitest","fmt":"dprint check"}}\n',
    );
    put(
      join(mono, "packages/docs/package.json"),
      '\uFEFF{"name":"@x/docs","scripts":{"spell":"cspell .","lint":"markdownlint ."}}\n',
    );
    repoAt(mono, ["T-10", "T-11"]);
    mkdirSync(join(other, "scripts"), { recursive: true });
    put(
      join(other, "justfile"),
      "default: check\n\ncheck: lint\n    cargo test\n\nlint:\n    cargo clippy -- -D warnings\n\nfmt:\n    cargo fmt --check\n",
    );
    put(join(other, "scripts/lint.sh"), "ruff check .\n");
    put(join(other, "scripts/lint.js"), 'require("child_process").execSync("stylelint x")\n');
    put(join(other, "scripts/check.ts"), `execSync(${TICK}eslint ${String.fromCharCode(36)}{dir}${TICK})\n`);
    put(join(other, "scripts/check.sh"), "shellcheck *.sh\n");
    put(
      join(other, ".pre-commit-config.yaml"),
      "repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    hooks:\n      - id: ruff\n  # - id: mypy\n",
    );
    put(
      join(other, "scripts/big.sh"),
      `${Array.from({ length: 60 }, (_, i) => `echo step ${i + 1}`)
        .concat("vale .")
        .join("\n")}\n`,
    );
    put(join(other, "README.md"), "A readme that names no linter.\n");
    put(
      join(other, "package.json"),
      '{"packageManager":"yarn@4.1.0","scripts":{"check":"yarn lint","prelint":"sort-package-json --check","lint":"eslint ."}}\n',
    );
    repoAt(other, ["T-12", "T-13", "T-14", "T-18", "T-23", "T-25", "T-26"]);
    const d = join(runs, "T-1");
    waybill(d, npm, "npm run check");
    logged(d, "dispatch", "luna", "thread-1");
    logged(d, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a list named map");
    logged(
      d,
      "finding",
      "src/b.ts:40",
      "gating P1 r1 style,bug luna,sol execution: an off-by-one the style lens found",
    );
    logged(d, "finding", "src/c.ts:7", "style P3 r2 bug sol reading: a let never reassigned, reported under bug");
    logged(d, "apply", "abc1234", "src/b.ts:40");
    const none = join(runs, "T-2");
    waybill(none, npm, "npm run check");
    logged(
      none,
      "finding",
      "src/b.ts:40",
      "gating P2 r1 bug luna reading: style is named here, and the finding is gating",
    );
    exact("a run with two style findings counts two", invoke(["count", d]), 0, "2");
    exact(
      "they are listed in the order logged, whichever lens found them, and not the gating one the style lens found",
      invoke(["list", d]),
      0,
      "S1 src/a.ts:12 P3 r1 style luna reading: a list named map\nS2 src/c.ts:7 P3 r2 bug sol reading: a let never reassigned, reported under bug",
    );
    const back = join(runs, "T-19");
    mkdirSync(back, { recursive: true });
    logged(back, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a name");
    logged(
      back,
      "finding",
      "src/a.ts:12:5",
      "style P3 r1 style luna reading: another name on that line, with a column",
    );
    logged(back, "finding", "src/a.ts:12", "gating P2 r2 bug sol reading: argued back to gating");
    exact(
      "a finding argued back to gating is no style finding, and one at a column of that line stays one",
      invoke(["list", back]),
      0,
      "S1 src/a.ts:12:5 P3 r1 style luna reading: another name on that line, with a column",
    );
    out("negative controls: a run's style findings");
    exact("a run whose findings are all gating counts none", invoke(["count", none]), 0, "0");
    exact("and lists none", invoke(["list", none]), 0, "");
    const before = readFileSync(join(d, "actions.jsonl"), "utf8").trimEnd().split("\n").length;
    const refused = command(join(here, "log-action.sh"), [
      d,
      "coachman",
      "finding",
      "src/x.ts:1",
      "P2 r1 bug luna reading: no class",
    ]);
    test(
      "log-action.sh refuses a finding with no class, and writes nothing",
      refused.code === 1 &&
        readFileSync(join(d, "actions.jsonl"), "utf8").trimEnd().split("\n").length === before &&
        refused.stderr.includes("gating or style"),
      refused.stderr,
    );
    const bad = join(runs, "T-3");
    mkdirSync(bad, { recursive: true });
    writeFileSync(
      join(bad, "actions.jsonl"),
      `${readFileSync(join(d, "actions.jsonl"), "utf8")}{"action":"finding","target":"src/x.ts:1","detail":"advisory P3 r1 style luna reading: old words"}\n`,
    );
    has(
      "a finding logged with another class is named, and nothing is counted",
      invoke(["count", bad]),
      2,
      'actions.jsonl line 6: a finding whose detail opens with "advisory", not gating or style',
    );
    has("no action log is refused, never read as no findings", invoke(["count", runs]), 1, "no action log at");

    out("positive controls: what the gate runs");
    const gateNpm = invoke(["gate", d]);
    for (const want of [
      "gate: npm run check",
      "package.json scripts.precheck: node scripts/versions.js",
      "package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos",
      "package.json scripts.typos: typos . > scripts/typos.txt",
      "package.json scripts.test:unit: bun test",
      "package.json scripts.format:check: prettier",
      'scripts/versions.js: require("child_process").execSync("stylelint src")',
    ])
      has(`the gate reaches: ${want}`, gateNpm, 0, want);
    const m = join(runs, "T-4");
    waybill(m, makeRepo, "make -j$(nproc) -j 4 check");
    const gateMake = invoke(["gate", m]);
    for (const want of [
      "Makefile lint: shellcheck scripts/*.sh",
      "Makefile lint: yamllint .",
      "web/Makefile lint: ./ci.sh",
      "web/ci.sh: stylelint .",
      "Makefile lint: touch make-ran",
      "Makefile docs: markdownlint docs",
      "Makefile spell: cspell .",
      "scripts/test.sh: bats test",
    ])
      has(`a make gate reaches: ${want}`, gateMake, 0, want);
    let t = join(runs, "T-24");
    waybill(t, makeRepo, "make -j 4");
    has(
      "make -j 4 runs the default goal, not a target named 4",
      invoke(["gate", t]),
      0,
      "Makefile lint: shellcheck scripts/*.sh",
    );
    t = join(runs, "T-27");
    waybill(t, makeRepo, "make -j$(nproc) fmt");
    has(
      "a substitution in a make flag leaves the target named",
      invoke(["gate", t]),
      0,
      "Makefile fmt: ruff format .",
      "shellcheck",
    );
    t = join(runs, "T-10");
    waybill(t, mono, "npm run check");
    const gateMono = invoke(["gate", t]);
    for (const want of [
      "packages/web/package.json scripts.lint: eslint .",
      "packages/docs/package.json scripts.lint: markdownlint .",
      "packages/web/package.json scripts.typecheck: tsc -b",
      "packages/web/package.json scripts.test: vitest",
      "packages/docs/package.json scripts.spell: cspell .",
    ])
      has(`workspaces reached by --workspaces, turbo, pnpm -r and -w: ${want}`, gateMono, 0, want);
    t = join(runs, "T-11");
    waybill(t, mono, "cd packages/web && npm run lint");
    has(
      "a cd before npm run takes the script from that package",
      invoke(["gate", t]),
      0,
      "packages/web/package.json scripts.lint: eslint .",
      "scripts.lint: tsc",
    );
    t = join(runs, "T-12");
    waybill(t, other, "just");
    has(
      "just runs its first recipe, and each recipe's prerequisites",
      invoke(["gate", t]),
      0,
      "justfile lint: cargo clippy -- -D warnings",
      "cargo fmt",
    );
    t = join(runs, "T-13");
    waybill(
      t,
      other,
      "env CI=1 ./scripts/lint.sh && cross-env CI=1 node scripts/lint.js && node -r ts-node/register scripts/check.ts && bash -euo pipefail scripts/check.sh",
    );
    const wrappers = invoke(["gate", t]);
    for (const want of [
      "scripts/lint.sh: ruff check .",
      'scripts/lint.js: require("child_process").execSync("stylelint x")',
      `scripts/check.ts: execSync(${TICK}eslint ${String.fromCharCode(36)}{dir}${TICK})`,
      "scripts/check.sh: shellcheck *.sh",
    ])
      has(`past env, cross-env and an interpreter's flags: ${want}`, wrappers, 0, want);
    t = join(runs, "T-14");
    waybill(t, other, "pre-commit run --all-files");
    has(
      "pre-commit's config is reached, less its comments",
      invoke(["gate", t]),
      0,
      ".pre-commit-config.yaml: - id: ruff",
      "mypy",
    );
    t = join(runs, "T-7");
    waybill(t, npm, "npm run build:types && npm run lint");
    has(
      "a build: inside the gate is part of it",
      invoke(["gate", t]),
      0,
      "package.json scripts.build:types: tsc -p types",
    );
    t = join(runs, "T-8");
    waybill(t, npm, "npm run nbsp");
    has(
      "a no-break space in a quoted word is read, not recursed into",
      invoke(["gate", t]),
      0,
      "package.json scripts.nbsp:",
    );
    t = join(runs, "T-20");
    waybill(t, npm, "", `- **gate:** ${TICK}npm run lint${TICK}  **build:** none    browser suite: none`);
    has(
      "a gate in bold and backticks, on a bullet, is read",
      invoke(["gate", t]),
      0,
      "package.json scripts.lint: cross-env",
    );
    t = join(runs, "T-21");
    waybill(t, npm, "", "gate : npm run lint  build: none");
    has("a gate written gate :, is read", invoke(["gate", t]), 0, "package.json scripts.lint: cross-env");
    t = join(runs, "T-28");
    mkdirSync(t, { recursive: true });
    put(
      join(t, "brief.md"),
      `## Project profile\n- **repo:** ${TICK}${npm}${TICK}  default branch: main\n- **gate:** ${TICK}npm run lint${TICK}\n`,
    );
    has("a repo in backticks is read", invoke(["gate", t]), 0, "package.json scripts.lint: cross-env");
    t = join(runs, "T-23");
    waybill(t, other, "sh scripts/big.sh");
    const longGate = invoke(["gate", t]);
    has("a long file is shown in part", longGate, 0, "scripts/big.sh: 41 more lines, read and not shown", "vale");
    addFindings(t, 1);
    sortFile(t, "S1 linter vale enable Vale.Spelling: the file's last line runs vale");
    has("and read whole", invoke(["check", t]), 0, "S1: linter vale enable Vale.Spelling");
    t = join(runs, "T-26");
    waybill(t, other, "npm run lint");
    has(
      "npm runs a script's pre script",
      invoke(["gate", t]),
      0,
      "package.json scripts.prelint: sort-package-json --check",
    );
    out("negative controls: what the gate runs");
    for (const unwanted of [
      "scripts.format: ",
      "scripts.docs",
      "scripts.build: ",
      "scripts.test: ",
      "test:unit:slow",
      "jest",
      "vitest",
      "hadolint",
      "oxfmt",
      "oxlint",
      "xo",
      "knip",
      "standard",
      "jscpd",
      "decoy",
    ])
      has(`the gate does not reach ${unwanted}`, gateNpm, 0, "gate: npm run check", unwanted);
    for (const unwanted of ["ruff", "pylint", "prettier", "decoy", "Makefile 4"])
      has(`a make gate does not reach ${unwanted}`, gateMake, 0, "Makefile lint:", unwanted);
    has("a workspace script nothing runs is not reached", gateMono, 0, "packages/web", "dprint");
    t = join(runs, "T-25");
    waybill(t, other, "yarn check");
    has(
      "Yarn 2 and later run no pre script",
      invoke(["gate", t]),
      0,
      "package.json scripts.lint: eslint .",
      "sort-package-json",
    );
    test(
      "nothing the gate runs was run",
      !existsSync(join(npm, "gate-ran")) &&
        !existsSync(join(makeRepo, "make-ran")) &&
        !existsSync(join(temp, "gate-ran")) &&
        !existsSync(join(temp, "make-ran")),
    );
    const g = join(runs, "T-5");
    waybill(g, npm, "");
    has(
      "a waybill that names no gate is refused",
      invoke(["gate", g]),
      2,
      "the waybill's Project profile names no gate",
    );
    const missingBranch = join(runs, "T-99");
    waybill(missingBranch, npm, "npm run check");
    has(
      "a run with no branch of its name is refused, never read from the checkout",
      invoke(["gate", missingBranch]),
      1,
      "no branch T-99 in",
    );

    out("positive controls: the sort");
    sortFile(
      d,
      "# Style sort: T-1",
      "",
      "- S2 linter biome enable style/useConst: biome flags a let that is never reassigned",
      "- S1 docs AGENTS.md: the project names a collection by what it holds, and nothing says so",
    );
    exact(
      "a sort of every finding passes, and prints its proposals and counts",
      invoke(["check", d]),
      0,
      "S2: linter biome enable style/useConst\nS1: docs AGENTS.md\nsorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 0 new linters proposed",
    );
    const five = join(runs, "T-6");
    waybill(five, npm, "npm run check");
    addFindings(five, 5);
    sortFile(
      five,
      "S1 linter biome enable style/useConst: biome flags a let never reassigned",
      "S2 linter biome enable style/useConst: the same rule",
      "S3 neither: quoting needs a shell linter, proposed below",
      "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks",
      "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one",
      "N1 new-linter shellcheck S3: the gate runs no shell linter",
    );
    const good = readFileSync(join(five, "style-sort.md"), "utf8").trimEnd();
    exact(
      "findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal",
      invoke(["check", five]),
      0,
      "S1 S2: linter biome enable style/useConst\nS5: linter biome write plugin::no-needless-return\nS4: docs CONTRIBUTING.md\nN1: new-linter shellcheck [for S3]\nS3: neither\nsorted 5 style findings: 3 to a linter, 1 to the docs, 1 to neither; 1 new linter proposed",
    );
    const redo = (label: string, code: number, want: string, update: (text: string) => string, not = "") => {
      const changed = `${update(good)}\n`;
      put(join(five, "style-sort.md"), changed);
      const result = invoke(["check", five]);
      const output = result.stdout + result.stderr;
      test(
        label,
        result.code === code && output.includes(want) && (!not || !output.includes(not)),
        `${output}\nchanged sort file:\n${readFileSync(join(five, "style-sort.md"), "utf8")}`,
      );
    };
    redo("a linter run by a file the gate runs counts as run", 0, "S1: linter stylelint enable", (text) =>
      text.replace("biome enable style/useConst", "stylelint enable declaration-no-important"),
    );
    redo("a linter's case and markup are set aside", 0, "S1 S2: linter biome enable style/useConst", (text) =>
      text.replace("linter biome", `linter ${TICK}Biome${TICK}`),
    );
    redo(
      "a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate",
      0,
      "N1: new-linter eslint [for S3; not in the gate]",
      (text) => text.replace("new-linter shellcheck S3:", "new-linter eslint S3 not-in-gate:"),
    );
    sortFile(
      five,
      "S1 linter shellcheck enable SC2086: a make gate runs shellcheck",
      "S2 neither: x",
      "S3 neither: x",
      "S4 neither: x",
      "S5 neither: x",
    );
    put(join(m, "actions.jsonl"), readFileSync(join(five, "actions.jsonl"), "utf8"));
    put(join(m, "style-sort.md"), readFileSync(join(five, "style-sort.md"), "utf8"));
    has("a linter a make target runs counts as run", invoke(["check", m]), 0, "S1: linter shellcheck enable SC2086");
    const via = join(runs, "T-18");
    waybill(via, other, "tsc");
    addFindings(via, 1);
    sortFile(
      via,
      "S1 linter ruff enable E501 via .pre-commit-config.yaml: pre-commit runs ruff, and this gate calls it some other way",
    );
    has(
      "a linter named via a file of the branch that names it",
      invoke(["check", via]),
      0,
      "S1: linter ruff enable E501 [via .pre-commit-config.yaml]",
    );
    exact(
      "a run with no style findings and no sort has nothing to sort",
      invoke(["check", none]),
      0,
      "no style findings, so nothing to sort",
    );
    const zero = join(runs, "T-22");
    mkdirSync(zero, { recursive: true });
    addFindings(zero, 2);
    sortFile(zero, "S1 neither: one", "S2 neither: two");
    exact(
      "a sort with no linter and no docs line counts none of either",
      invoke(["check", zero]),
      0,
      "S1 S2: neither\nsorted 2 style findings: 0 to a linter, 0 to the docs, 2 to neither; 0 new linters proposed",
    );
    put(join(zero, "style-sort.md"), "\uFEFFS1 neither: one\nS2 neither: two\n");
    has("a sort that opens with a byte-order mark is read", invoke(["check", zero]), 0, "S1 S2: neither");
    const led = join(temp, "runs", "led");
    const past = join(led, "T-15");
    const now = join(led, "T-16");
    mkdirSync(past, { recursive: true });
    waybill(now, npm, "npm run check");
    addFindings(now, 2);
    logged(past, "ticket-create", "80", "style proposal: linter biome enable style/useConst");
    logged(past, "ticket-create", "81", "linter biome enable style/useConst, filed another way");
    logged(past, "note", "T-15", "style proposal declined: docs AGENTS.md: not now");
    logged(past, "note", "T-15", "style proposal asked: new-linter shellcheck");
    sortFile(now, "S1 linter biome enable style/useConst: a", "S2 docs AGENTS.md: b", "N1 new-linter shellcheck S2: c");
    exact(
      "each proposal carries what the project's ledger last records of it, from any run",
      invoke(["check", now]),
      0,
      "S1: linter biome enable style/useConst [filed 80 in T-15]\nS2: docs AGENTS.md [declined in T-15]\nN1: new-linter shellcheck [for S2; asked in T-15]\nsorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 1 new linter proposed",
    );
    out("negative controls: the sort, each fault named");
    redo("a finding left out", 2, "S4 is not sorted", (text) => text.replace(/^S4 docs.*\n/m, ""));
    redo("a finding sorted twice", 2, "S2 is sorted twice, on lines 2, 7", (text) => `${text}\nS2 neither: again`);
    redo(
      "an id that is no style finding",
      2,
      "line 7: S9 is not a style finding",
      (text) => `${text}\nS9 neither: no such finding`,
    );
    redo("a line with no reason", 2, "line 3: S3 has no reason", (text) =>
      text.replace(/^S3 neither: .*$/m, "S3 neither:"),
    );
    redo("a kind that is not one of the three", 2, "line 4 is not a sort line", (text) =>
      text.replace(/^S4 docs/m, "S4 convention"),
    );
    redo("a linter line with no enable or write", 2, "line 1 is not a sort line", (text) =>
      text.replace("biome enable", "biome"),
    );
    redo(
      "prose between the lines",
      2,
      "line 7 is not a sort line: These are",
      (text) => `${text}\nThese are the findings.`,
    );
    redo(
      "and the forms are then given",
      2,
      'a sort line is one of: "S<n> linter',
      (text) => `${text}\nThese are the findings.`,
    );
    redo(
      "a linter only an echoed hint would reach",
      2,
      `S1 names eslint, which ${TICK}gate${TICK} does not show`,
      (text) => text.replace("biome enable style/useConst", "eslint enable prefer-const"),
    );
    redo("a linter only a comment names", 2, `S1 names oxlint, which ${TICK}gate${TICK} does not show`, (text) =>
      text.replace("biome enable style/useConst", "oxlint enable prefer-const"),
    );
    redo("a linter only a shell comment names", 2, `S1 names oxfmt, which ${TICK}gate${TICK} does not show`, (text) =>
      text.replace("biome enable style/useConst", "oxfmt enable x"),
    );
    redo(
      "a linter only a comment in a quoted command names",
      2,
      `S1 names stylua, which ${TICK}gate${TICK} does not show`,
      (text) => text.replace("biome enable style/useConst", "stylua enable x"),
    );
    redo(
      "a linter only bun's own build would reach",
      2,
      `S1 names hadolint, which ${TICK}gate${TICK} does not show`,
      (text) => text.replace("biome enable style/useConst", "hadolint enable DL3008"),
    );
    redo("a new linter the gate already runs", 2, "N1 proposes BIOME, which the gate already runs", (text) =>
      text.replace("new-linter shellcheck", "new-linter BIOME"),
    );
    redo(
      "a new linter the project already has",
      2,
      "N1 proposes eslint, which the project already has (package.json)",
      (text) => text.replace("new-linter shellcheck", "new-linter eslint"),
    );
    redo(
      "a new linter proposed twice",
      2,
      "N2 proposes shellcheck again, as N1 on line 6 does",
      (text) => `${text}\nN2 new-linter shellcheck S4: again`,
    );
    redo("a new linter for no such finding", 2, "N1 names S9, which is not a style finding", (text) =>
      text.replace("shellcheck S3", "shellcheck S3,S9"),
    );
    redo("a new linter for no finding at all", 2, "N1 names no finding the linter would enforce", (text) =>
      text.replace("new-linter shellcheck S3:", "new-linter shellcheck not-in-gate:"),
    );
    sortFile(via, "S1 linter ruff enable E501 via README.md: a file that does not name it");
    has(
      "a via file that does not name the linter",
      invoke(["check", via]),
      2,
      "S1 names ruff via README.md, which does not name ruff",
    );
    sortFile(via, "S1 linter ruff enable E501 via ruff.toml: a file the branch does not have");
    has(
      "a via file the branch does not have",
      invoke(["check", via]),
      2,
      "S1 names ruff via ruff.toml, which the run's branch does not have",
    );
    rmSync(join(five, "style-sort.md"));
    has(
      "no sort at all, with findings to sort",
      invoke(["check", five]),
      2,
      `no style-sort.md in ${five}, and 5 style findings to sort`,
    );
    waybill(five, npm, "");
    put(join(five, "style-sort.md"), `${good}\n`);
    has(
      "a linter line with no gate to check it against",
      invoke(["check", five]),
      2,
      "S1 names biome, and the waybill's Project profile has no gate",
    );
    put(join(none, "style-sort.md"), readFileSync(join(five, "style-sort.md"), "utf8"));
    has("a sort for a run with no style findings", invoke(["check", none]), 2, "S1 is not a style finding of this run");
    has("no dispatch directory is a usage error", invoke(["check", join(temp, "nowhere")]), 1, "no dispatch directory");

    out("the gate is read as the run's branch has it");
    put(
      join(npm, "package.json"),
      readFileSync(join(npm, "package.json"), "utf8").replace("cross-env NODE_ENV=ci biome check .", "eslint ."),
    );
    gitRun(npm, "add", "-A");
    gitRun(npm, "commit", "-q", "-m", "switch to eslint");
    gitRun(npm, "branch", "T-17");
    t = join(runs, "T-17");
    waybill(t, npm, "npm run lint");
    has(
      "a branch cut after a change reads the change",
      invoke(["gate", t]),
      0,
      "package.json scripts.lint: eslint .",
      "biome",
    );
    waybill(d, npm, "npm run lint");
    has(
      "a run's own branch reads as it was, whatever the checkout now holds",
      invoke(["gate", d]),
      0,
      "package.json scripts.lint: cross-env NODE_ENV=ci biome check .",
      "scripts.lint: eslint",
    );
    out("the runbooks agree with this script");
    const skillDocs = command("find", [skill, "-maxdepth", "1", "-name", "*.md", "-print"]);
    const docs = skillDocs.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const subcommands = [
      ...new Set([...docs.matchAll(/style-findings\.sh ([a-z-]+)/g)].map((match) => match[1]!)),
    ].sort();
    test(
      "the runbooks name list, count, gate and check, and no other subcommand",
      subcommands.join(" ") === "check count gate list",
      subcommands.join(" "),
    );
    const missingSubcommand = invoke(["sort", d]);
    test(
      "and a subcommand the script lacks would be caught",
      missingSubcommand.code === 1 && missingSubcommand.stderr.includes("usage: style-findings.sh"),
    );
    const coachman = readFileSync(join(skill, "coachman.md"), "utf8");
    const postmaster = readFileSync(join(skill, "postmaster.md"), "utf8");
    const formStart = coachman.indexOf("**Sort the style findings.**");
    const formTail = coachman.slice(formStart);
    const fence = TICK.repeat(3);
    const formOpen = formTail.indexOf(fence);
    const formStartLine = formTail.indexOf("\n", formOpen) + 1;
    const formEnd = formTail.indexOf(fence, formStartLine);
    let formsText = formTail.slice(formStartLine, formEnd);
    for (const [pattern, replacement] of [
      [/<n>/g, "1"],
      [/<m>/g, "2"],
      [/\[,S2\.\.\.\]/g, ""],
      [/<linter>/g, "biome"],
      [/<rule>/g, "style/useConst"],
      [/<doc>/g, "AGENTS.md"],
      [/<file>/g, "biome.json"],
      [/<reason>/g, "a reason"],
    ] as Array<[RegExp, string]>)
      formsText = formsText.replace(pattern, replacement);
    put(join(temp, "forms"), formsText);
    const formResult = invoke(["forms", join(temp, "forms")]);
    test(
      "every form coachman.md gives is a sort line",
      formResult.code === 0 &&
        (formResult.stdout.match(/^ok {2}/gm) ?? []).length >= 7 &&
        !/^bad /m.test(formResult.stdout),
      formResult.stdout,
    );
    put(join(temp, "forms"), "S1 lint biome enable style/useConst: a reason\n");
    const badForm = invoke(["forms", join(temp, "forms")]);
    test(
      "and a form that is not one would be caught",
      badForm.code === 0 && badForm.stdout.includes("bad S1 lint biome"),
    );
    const flatten = (text: string) => text.replace(/\s+/g, " ");
    for (const want of [
      "converge on a prescribed one-line fix for a gating finding",
      `is a finding about the LANE: log a ${TICK}note${TICK}`,
      "for style, how many findings go to the ship card's Style residue, as",
    ])
      test(`coachman.md says: ${want}`, flatten(coachman).includes(want));
    for (const want of [
      "Check the style sort too, once the last leg's process has exited",
      `--title "<title>"${TICK}, and log ${TICK}ticket-check${TICK}`,
      `log a ${TICK}note${TICK} with ${TICK}style proposal asked: <proposal>${TICK} for each draft shown`,
      "and carry on with the stream",
    ])
      test(`postmaster.md says: ${want}`, flatten(postmaster).includes(want));
    const stepStart = postmaster.indexOf("5. **Put the style sort to the user");
    const stepEnd = postmaster.indexOf("6. ", stepStart);
    test("and the style sort is no escalation", !postmaster.slice(stepStart, stepEnd).includes("ESCALATION.md"));
    put(join(temp, "old.md"), "When the lanes converge on a prescribed one-line fix, apply it and re-review.\n");
    test(
      "and the rule's old wording would be caught",
      !flatten(readFileSync(join(temp, "old.md"), "utf8")).includes("one-line fix for a gating finding"),
    );

    out("the cleanup asks nothing at a terminal");
    const readonly = join(temp, "ro", "a", "f");
    put(readonly, "");
    chmodSync(readonly, 0o444);
    rmSync(join(temp, "ro"), { recursive: true, force: true });
    test("at a terminal it removes a file git made read-only, and asks nothing", !existsSync(join(temp, "ro")));
    const readonly2 = join(temp, "ro2", "f");
    put(readonly2, "");
    chmodSync(readonly2, 0o444);
    const pty = command("script", ["-q", "-e", "-c", `rm -r -- ${join(temp, "ro2")}`, "/dev/null"], { timeout: 3000 });
    test("one that reads the terminal would ask instead, and remove nothing", existsSync(readonly2) && pty.code !== 0);
  } catch (error) {
    const value = error instanceof Error ? (error.stack ?? error.message) : String(error);
    failures.push(`self-test setup: ${value}`);
    writeOut("  FAIL self-test setup");
    for (const line of value.split(/\r?\n/)) writeOut(`         ${line}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(failures.length ? `self-test: ${failures.length} control(s) misbehaved` : "self-test: all controls behaved");
  return failures.length ? 1 : 0;
}
try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof StyleError) {
    if (error.code === 1) writeError(`style-findings: ${error.message}`);
    else writeOut(error.message);
    process.exit(error.code);
  }
  writeError(`style-findings: ${String(error)}`);
  process.exit(1);
}
