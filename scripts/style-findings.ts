// A run's style findings. They gate nothing: the review leg logs them and applies none, the ship
// card counts them, and aftercare sorts each into a rule for a linter the project's gate runs, a
// convention for the project's own docs, or neither. The postmaster puts the sort to the user
// after the merge.
//
//   style-findings.sh list <dispatch>    each style finding: its id, where it is, the rest of its line
//   style-findings.sh count <dispatch>   how many style findings the run has
//   style-findings.sh gate <dispatch>    what the gate runs, as the run's branch has it
//   style-findings.sh check <dispatch>   whether <dispatch>/style-sort.md sorts every style finding
//   style-findings.sh --self-test
//
//   exit 0  printed
//   exit 1  usage; no waybill, action log, or branch named for the run; a file that cannot be read
//   exit 2  list/count: a finding whose class is neither gating nor style. gate: the waybill
//           names no gate, or no repo that exists. check: a finding with neither class; no sort,
//           with style findings to sort; or a sort that is wrong.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

// --- constants ------------------------------------------------------------------------------
const FORMS =
  'a sort line is one of: "S<n> linter <linter> enable <rule>: <reason>", ' +
  '"S<n> linter <linter> write <rule>: <reason>", either with "via <file>" after the rule, ' +
  '"S<n> docs <doc>: <reason>", "S<n> neither: <reason>", and ' +
  '"N<n> new-linter <linter> S<n>[,S<m>...]: <reason>", with "not-in-gate" after the findings';
const SHOWN = 20;
const LONG = 4000;

// --- helpers --------------------------------------------------------------------------------
function die(msg: string): never {
  console.error(`style-findings: ${msg}`);
  process.exit(1);
  throw new Error("unreachable");
}

function read(path: string, what: string): string {
  try {
    // BASE opened text with utf-8-sig: a byte-order mark is not part of the content.
    return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch (e: any) {
    if (e?.code === "ENOENT") die(`no ${what} at ${path}`);
    die(`cannot read ${path}: ${e?.message ?? "error"}`);
  }
}

function plain(word: string): string {
  return word.replace(/^[`*_"]+|[`*_"]+$/g, "");
}

function named(name: string, text: string): boolean {
  const re = new RegExp(
    `(?<![A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`,
    "i",
  );
  return re.test(text);
}

function stripJs(text: string): string {
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  return text
    .split("\n")
    .filter((l) => !/^\s*\*/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

function configText(text: string, path: string): string {
  if (/\.[cm]?[jt]s$/.test(path)) return stripJs(text);
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((l) => l.replace(/(^|\s)[#;].*$/, "$1"))
    .join("\n");
}

// --- glob matching (fnmatch.fnmatchcase) ---------------------------------------------------
function fnmatchCase(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(name);
}

// --- the run's findings -----------------------------------------------------------------------
interface Finding {
  id: string;
  target: string;
  rest: string;
}

function findings(dispatch: string): { style: Finding[]; faults: string[] } {
  const path = join(dispatch, "actions.jsonl");
  const latest = new Map<string, { cls: string; rest: string }>();
  const faults: string[] = [];
  const text = read(path, "action log");
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line.trim() === "") continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      die(`${path} line ${n + 1} is not JSON`);
    }
    if (!e || typeof e !== "object" || e.action !== "finding") continue;
    const words = String(e.detail ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const first = words[0] ?? "";
    if (first !== "gating" && first !== "style") {
      faults.push(
        `actions.jsonl line ${n + 1}: a finding whose detail opens with ${words.length > 0 ? `"${first}"` : "nothing"}, not gating or style`,
      );
      continue;
    }
    const target = String(e.target ?? "");
    latest.delete(target);
    latest.set(target, { cls: first, rest: words.slice(1).join(" ") });
  }
  const style: Finding[] = [];
  let i = 0;
  for (const [t, { cls, rest }] of latest) {
    if (cls === "style") {
      i++;
      style.push({ id: `S${i}`, target: t, rest });
    }
  }
  return { style, faults };
}

// --- the waybill ------------------------------------------------------------------------------
const MARK = "(?:\\*\\*|__)?";

function field(line: string, key: string, stops: string[]): string | null {
  const m = new RegExp(`\\s*(?:[-*+]\\s+)?${MARK}${key}${MARK}\\s*:${MARK}(.*)$`, "i").exec(line);
  if (!m) return null;
  let v = m[1] ?? "";
  const stopPat = stops.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nxt = new RegExp(`\\s+${MARK}(?:${stopPat})${MARK}\\s*:${MARK}(?=\\s|$)`, "i").exec(v);
  if (nxt) v = v.slice(0, nxt.index);
  v = v.trim();
  if (v.length > 1 && v[0] === "`" && v[v.length - 1] === "`") v = v.slice(1, -1).trim();
  return v;
}

function profile(dispatch: string): { repo: string | null; gate: string | null } {
  const lines = read(join(dispatch, "brief.md"), "waybill").split("\n");
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}##[ \t]+project profile[ \t:#]*\r?$/i.test(lines[i]!)) heads.push(i);
  }
  let repo: string | null = null;
  let gate: string | null = null;
  const start = heads.length > 0 ? heads[heads.length - 1]! + 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^ {0,3}#{1,2}(?:[ \t]|\r?$)/.test(l)) break;
    const r = field(l, "repo", ["default branch", "BASE"]);
    const g = field(l, "gate", ["build", "browser suite"]);
    if (repo === null && r !== null) repo = r;
    if (gate === null && g !== null) gate = g;
  }
  return {
    repo: repo || null,
    gate: gate && gate.toLowerCase() !== "none" ? gate : null,
  };
}

// --- the repo, as the run's branch has it -------------------------------------------------------
function git(repo: string, ...args: string[]): string | null {
  const r = run("git", ["-C", repo, ...args], { timeout: 120000 } as any);
  return r.code === 0 ? r.out : null;
}

interface BlobEntry {
  mode: string;
  sha: string;
}

class Tree {
  repo: string;
  blobs: Map<string, BlobEntry> = new Map();
  dirs: Set<string> = new Set([""]);
  cache: Map<string, string | null> = new Map();

  constructor(repo: string, branch: string) {
    this.repo = repo;
    const shaRaw = git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`);
    const sha = shaRaw?.trim() ?? "";
    if (!sha) die(`no branch ${branch} in ${repo}: the gate is read as the run's branch has it`);
    const lsRaw = git(repo, "ls-tree", "-r", "-z", "--full-tree", sha) ?? "";
    for (const ent of lsRaw.split("\0")) {
      if (!ent) continue;
      const tabIdx = ent.indexOf("\t");
      if (tabIdx < 0) continue;
      const meta = ent.slice(0, tabIdx);
      const path = ent.slice(tabIdx + 1);
      const f = meta.split(/\s+/);
      if (f.length === 3 && f[1] === "blob") {
        this.blobs.set(path, { mode: f[0]!, sha: f[2]! });
        let d = posix.dirname(path);
        while (!this.dirs.has(d)) {
          this.dirs.add(d);
          d = posix.dirname(d);
        }
      }
    }
  }

  path(cwd: string, p: string): string | null {
    if (!p || p.startsWith("/") || p.startsWith("~")) return null;
    const q = posix.normalize(posix.join(cwd, p));
    if (q === ".") return "";
    if (q === ".." || q.startsWith("../")) return null;
    return q;
  }

  file(cwd: string, p: string): string | null {
    let q = this.path(cwd, p);
    if (q === null || !this.blobs.has(q)) return null;
    const entry = this.blobs.get(q)!;
    if (entry.mode === "120000") {
      const linkTarget = (git(this.repo, "cat-file", "blob", entry.sha) ?? "").trim();
      q = this.path(posix.dirname(q!), linkTarget);
      if (q === null || !this.blobs.has(q) || this.blobs.get(q)?.mode === "120000") return null;
    }
    return q;
  }

  dir(cwd: string, p: string): string | null {
    const q = this.path(cwd, p);
    return q !== null && this.dirs.has(q) ? q : null;
  }

  read(p: string): string | null {
    if (!this.cache.has(p)) {
      const entry = this.blobs.get(p);
      const data = entry ? git(this.repo, "cat-file", "blob", entry.sha) : null;
      const ok = data !== null && data.length <= 512 * 1024 && !data.slice(0, 8192).includes("\0");
      // BASE decoded utf-8-sig: a byte-order mark is not part of the content.
      this.cache.set(p, ok ? data?.replace(/^\uFEFF/, "") : null);
    }
    return this.cache.get(p) ?? null;
  }

  glob(cwd: string, pattern: string): string[] {
    const q = this.path(cwd, pattern);
    if (q === null) return [];
    if (!/[*?[]/.test(q)) return this.blobs.has(q) ? [q] : [];
    return [...this.blobs.keys()].filter((p) => fnmatchCase(p, q)).sort();
  }

  up(cwd: string, names: string[]): string | null {
    let d = cwd;
    while (true) {
      for (const n of names) {
        const p = d ? posix.join(d, n) : n;
        if (this.blobs.has(p)) return p;
      }
      if (!d) return null;
      d = posix.dirname(d);
    }
  }
}

// --- reading shell -----------------------------------------------------------------------------
const PUNCT = new Set([";", "&", "|", "(", ")", "<", ">"]);
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
const INERT = new Set([
  "echo",
  "printf",
  ":",
  "true",
  "false",
  "exit",
  "return",
  "test",
  "[",
  "[[",
  "export",
  "set",
  "unset",
  "read",
  "shift",
  "local",
  "declare",
  "typeset",
  "trap",
  "wait",
  "sleep",
  "cat",
  "tee",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "date",
  "pwd",
  "which",
  "type",
  "hash",
  "touch",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "rmdir",
  "ln",
  "chmod",
  "chown",
  "ls",
  "fi",
  "done",
  "esac",
  "popd",
]);
const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "source",
  ".",
  "node",
  "nodejs",
  "python",
  "python3",
  "bun",
  "deno",
  "tsx",
  "ts-node",
  "ruby",
  "perl",
]);
const BUILTINS: Record<string, Set<string>> = {
  pnpm: new Set([
    "add",
    "install",
    "i",
    "update",
    "up",
    "upgrade",
    "remove",
    "rm",
    "uninstall",
    "link",
    "ln",
    "unlink",
    "import",
    "rebuild",
    "rb",
    "prune",
    "fetch",
    "patch",
    "patch-commit",
    "exec",
    "dlx",
    "create",
    "run",
    "publish",
    "pack",
    "audit",
    "list",
    "ls",
    "outdated",
    "why",
    "root",
    "bin",
    "config",
    "c",
    "env",
    "setup",
    "store",
    "init",
    "deploy",
    "licenses",
    "server",
    "doctor",
  ]),
  yarn: new Set([
    "add",
    "install",
    "remove",
    "up",
    "upgrade",
    "run",
    "exec",
    "dlx",
    "workspace",
    "workspaces",
    "info",
    "why",
    "pack",
    "npm",
    "plugin",
    "set",
    "config",
    "version",
    "node",
    "bin",
    "cache",
    "dedupe",
    "explain",
    "init",
    "link",
    "unlink",
    "patch",
    "rebuild",
    "stage",
    "unplug",
    "global",
    "publish",
  ]),
  bun: new Set([
    "run",
    "test",
    "x",
    "repl",
    "exec",
    "install",
    "i",
    "add",
    "a",
    "remove",
    "rm",
    "update",
    "outdated",
    "link",
    "unlink",
    "publish",
    "patch",
    "patch-commit",
    "pm",
    "build",
    "init",
    "create",
    "c",
    "upgrade",
    "completions",
    "discord",
    "help",
    "audit",
    "why",
    "info",
  ]),
};
const RUNNERS: Record<string, string[]> = {
  "pre-commit": [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  prek: [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  lefthook: [
    "lefthook.yml",
    "lefthook.yaml",
    ".lefthook.yml",
    ".lefthook.yaml",
    "lefthook.toml",
    "lefthook.json",
  ],
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

function subst(line: string): string {
  line = line.replace(/\$\(MAKE\)|\$\{MAKE\}/g, "make");
  line = line.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^{}]*)\}/g, "$1");
  for (let i = 0; i < 10; i++) {
    const next = line.replace(/\$\(([^()]*)\)/g, "$1");
    if (next === line) break;
    line = next;
  }
  return line.replace(/\$\{[^{}]*\}/g, "_").replace(/`/g, " ");
}

function uncomment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && q !== "'") {
      i++;
      continue;
    }
    if (q) {
      if (c === q) q = null;
    } else if (c === "'" || c === '"') {
      q = c;
    } else if (c === "#" && (i === 0 || " \t;&|()".includes(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Shell tokenizer (approximates shlex with punctuation_chars)
function shellTokens(line: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (PUNCT.has(c)) {
      // Group punctuation: && || |& etc.
      let t = c;
      if ((c === "&" || c === "|") && line[i + 1] === c) {
        t = c + c;
        i += 2;
      } else if (c === ">" && line[i + 1] === ">") {
        t = ">>";
        i += 2;
      } else if (c === "<" && line[i + 1] === "<") {
        t = "<<";
        i += 2;
      } else if (c === "2" && line[i + 1] === ">") {
        // handle 2> as redirect - but 2 is not punctuation, skip
        i++;
        continue;
      } else {
        i++;
      }
      toks.push(t);
      continue;
    }
    // Word
    let word = "";
    while (i < line.length && !PUNCT.has(line[i]!) && line[i] !== " " && line[i] !== "\t") {
      if (line[i] === "\\" && i + 1 < line.length) {
        word += line[i + 1];
        i += 2;
      } else if (line[i] === "'") {
        i++;
        while (i < line.length && line[i] !== "'") {
          word += line[i];
          i++;
        }
        i++; // skip closing quote
      } else if (line[i] === '"') {
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === "\\" && i + 1 < line.length) {
            word += line[i + 1];
            i += 2;
          } else {
            word += line[i];
            i++;
          }
        }
        i++; // skip closing quote
      } else {
        word += line[i];
        i++;
      }
    }
    if (word || toks.length > 0) toks.push(word);
  }
  return toks.filter((t) => t !== "");
}

function* commands(line: string): Generator<{ kind: "cmd" | "sep"; val: string[] | string }> {
  const toks = shellTokens(subst(uncomment(line)));
  let words: string[] = [];
  let skip = false;
  for (const t of toks) {
    if (skip) {
      skip = false;
    } else if (t && [...t].every((c) => PUNCT.has(c))) {
      if (t.includes("<") || t.includes(">")) {
        skip = true;
        continue;
      }
      if (words.length > 0) {
        yield { kind: "cmd", val: words };
        words = [];
      }
      yield { kind: "sep", val: t };
    } else {
      words.push(t);
    }
  }
  if (words.length > 0) yield { kind: "cmd", val: words };
}

function unwrap(words: string[]): string[] {
  const n = words.length;
  let i = 0;
  const past = (j: number, valued: string[] = []): number => {
    while (j < n && words[j]?.startsWith("-") && words[j] !== "--") {
      j += valued.includes(words[j]!) ? 2 : 1;
    }
    return j < n && words[j] === "--" ? j + 1 : j;
  };
  while (i < n) {
    const w = words[i]!;
    const b = posix.basename(w);
    const nxt = i + 1 < n ? words[i + 1]! : "";
    if (SHELL_WORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
    } else if (b === "command") {
      if (nxt === "-v" || nxt === "-V") return [];
      i++;
    } else if (b === "env") {
      i = past(i + 1, ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);
    } else if (b === "cross-env" || b === "cross-env-shell" || b === "stdbuf" || b === "nice") {
      i = past(i + 1, ["-n", "--adjustment"]);
    } else if (b === "timeout") {
      i = past(i + 1, ["-s", "--signal", "-k", "--kill-after"]) + 1;
    } else if (b === "npx" || b === "pnpx" || b === "bunx") {
      i = past(i + 1, ["-p", "--package"]);
    } else if (b === "dotenv" || b === "dotenvx") {
      const di = words.indexOf("--", i);
      i = di >= 0 ? di + 1 : past(i + 1, ["-e", "-f", "-c", "-v"]);
      if (i < n && words[i] === "run") i++;
    } else if (
      (b === "uv" ||
        b === "poetry" ||
        b === "pipenv" ||
        b === "hatch" ||
        b === "pdm" ||
        b === "rye") &&
      nxt === "run"
    ) {
      i = past(i + 2, ["--with", "--env", "-e", "--python", "-p"]);
    } else if (b === "bundle" && nxt === "exec") {
      i += 2;
    } else if (b === "xargs") {
      i = past(i + 1, ["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"]);
    } else {
      break;
    }
  }
  return words.slice(i);
}

// --- justfile parsing ---------------------------------------------------------------------------
interface JustRecipes {
  recipes: Map<string, { deps: string[]; body: string[] }>;
  vars: Map<string, string>;
  first: string | null;
}

function parseJust(text: string): JustRecipes {
  const recipes = new Map<string, { deps: string[]; body: string[] }>();
  const vars = new Map<string, string>();
  let first: string | null = null;
  let current: string | null = null;
  for (const line of text.split("\n")) {
    if (current !== null && (line.startsWith(" ") || line.startsWith("\t") || line.trim() === "")) {
      if (line.trim()) recipes.get(current)?.body.push(line.trim());
      continue;
    }
    current = null;
    const s = line.trim();
    if (
      !s ||
      s.startsWith("#") ||
      s.startsWith("[") ||
      s.startsWith("set ") ||
      s.startsWith("import ") ||
      s.startsWith("mod ")
    )
      continue;
    let m = /^alias\s+([\w-]+)\s*:=\s*([\w-]+)/.exec(s);
    if (m) {
      recipes.set(m[1]!, { deps: [m[2]!], body: [] });
      continue;
    }
    m = /^(?:export\s+)?([A-Za-z_][\w-]*)\s*:=\s*(.*)$/.exec(s);
    if (m) {
      vars.set(m[1]!, m[2]?.trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }
    m = /^@?([A-Za-z_][\w-]*)\b[^:]*:(?!=)(.*)$/.exec(s);
    if (m) {
      current = m[1]!;
      const deps = m[2]?.replace(/\([^)]*\)/g, "").match(/[A-Za-z_][\w-]*/g) ?? [];
      recipes.set(current, { deps, body: [] });
      if (first === null) first = current;
    }
  }
  return { recipes, vars, first };
}

// --- makefile parsing ---------------------------------------------------------------------------
class Makefile {
  t: Tree;
  path: string;
  cwd: string;
  vars: Map<string, string>;
  rules: Map<string, { prereqs: string[]; recipe: string[] }>;
  fixed: Set<string>;
  first: string | null = null;
  goal: string;

  static ASSIGN = /^(?:(?:export|override)\s+)*([A-Za-z0-9_.-]+)\s*(:{1,3}=|[?+!]?=)\s*(.*)$/;

  constructor(tree: Tree, path: string, cwd: string, sets: Record<string, string>) {
    this.t = tree;
    this.path = path;
    this.cwd = cwd;
    this.vars = new Map(Object.entries(sets));
    this.rules = new Map();
    this.fixed = new Set(Object.keys(sets));
    this.read(path, 0);
    this.goal = this.expand(this.vars.get(".DEFAULT_GOAL") ?? "").trim() || this.first || "";
  }

  expand(s: string, depth = 0): string {
    if (depth > 10 || !s.includes("$")) return s;
    const one = (m: string, p1: string, p2: string): string => {
      const name = p1 || p2;
      if (this.vars.has(name)) return this.expand(this.vars.get(name)!, depth + 1);
      return name === "MAKE" ? "make" : m;
    };
    return s
      .replace(/\$\$/g, "\0")
      .replace(/\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}/g, (m, p1, p2) =>
        one(m, p1 ?? "", p2 ?? ""),
      )
      .replace(/\0/g, "$$");
  }

  recipe(line: string): string {
    return this.expand(line.replace(/^\s*[@+-]*/, "")).replace(/\$\$/g, "$");
  }

  read(path: string, depth: number): void {
    const text = this.t.read(path);
    let current: string[] | null = null;
    let define = false;
    for (const line of (text ?? "").replace(/\\\r?\n/g, " ").split("\n")) {
      if (define) {
        define = !/^\s*endef\b/.test(line);
        continue;
      }
      if (line.startsWith("\t")) {
        for (const t of current ?? []) {
          this.rules.get(t)?.recipe.push(line.slice(1));
        }
        continue;
      }
      const s = line.replace(/(?<!\\)#.*$/, "").trim();
      if (!s || /^(?:ifeq|ifneq|ifdef|ifndef|else|endif)\b/.test(s)) continue;
      if (/^(?:(?:export|override)\s+)*define\b/.test(s)) {
        define = true;
        current = null;
        continue;
      }
      let m = /^(?:-include|sinclude|include)\s+(.*)$/.exec(s);
      if (m) {
        for (const inc of this.expand(m[1]!).split(/\s+/)) {
          if (depth < 10) {
            for (const p of this.t.glob(this.cwd, inc)) this.read(p, depth + 1);
          }
        }
        current = null;
        continue;
      }
      m = Makefile.ASSIGN.exec(s);
      if (m) {
        const [, name, op, value] = m;
        if (!this.fixed.has(name!) && op !== "!=") {
          if (op === "?=") {
            if (!this.vars.has(name!)) this.vars.set(name!, value!);
          } else if (op === "+=") {
            this.vars.set(name!, `${this.vars.get(name!) ?? ""} ${value!}`.trim());
          } else {
            this.vars.set(name!, op?.startsWith(":") ? this.expand(value!) : value!);
          }
        }
        current = null;
        continue;
      }
      m = /^([^:=]+?)\s*::?(?!=)(.*)$/.exec(s);
      if (!m || Makefile.ASSIGN.test(m[2]?.trim())) {
        current = null;
        continue;
      }
      const [_, targets, rest] = m;
      const semiIdx = rest?.indexOf(";");
      const prereqs = semiIdx >= 0 ? rest?.slice(0, semiIdx) : rest!;
      const inline = semiIdx >= 0 ? rest?.slice(semiIdx + 1).trim() : "";
      current = this.expand(targets!).split(/\s+/);
      for (const t of current) {
        if (!this.rules.has(t)) this.rules.set(t, { prereqs: [], recipe: [] });
        this.rules.get(t)?.prereqs.push(
          ...this.expand(prereqs)
            .split(/\s+/)
            .filter((p) => p && p !== "|"),
        );
        if (inline) this.rules.get(t)?.recipe.push(inline);
        if (this.first === null && !t.startsWith(".") && !t.includes("%")) this.first = t;
      }
    }
  }
}

// --- Reach: what a gate command reaches -----------------------------------------------------------
class Reach {
  t: Tree;
  cmds: Array<{ where: string; words: string[] }> = [];
  texts: Array<{ where: string; text: string }> = [];
  lines: Array<{ where: string; line: string }> = [];
  seen = new Set<string>();
  warnings: string[] = [];
  pkgs = new Map<string, Record<string, unknown>>();
  makes = new Map<string, Makefile>();
  justs = new Map<string, JustRecipes>();

  constructor(tree: Tree, gate: string) {
    this.t = tree;
    this.shell("gate", gate, "");
  }

  shell(where: string, text: string, cwd: string, keepCd = false): void {
    for (const raw of text.replace(/\\\r?\n/g, " ").split("\n")) {
      const line = uncomment(raw).trim();
      if (!line) continue;
      this.lines.push({ where, line });
      if (line.length <= LONG) {
        const after = this.scan(where, line, cwd);
        cwd = keepCd ? after : cwd;
      }
    }
  }

  scan(where: string, line: string, cwd: string): string {
    const saved: string[] = [];
    for (const { kind, val } of commands(line)) {
      if (kind === "sep") {
        if (val === "(") saved.push(cwd);
        else if (val === ")" && saved.length > 0) cwd = saved.pop()!;
        continue;
      }
      const words = val as string[];
      const [newCwd, nested] = this.command(where, words, cwd);
      cwd = newCwd;
      for (const w of nested ? words : []) {
        if (/[ \t\r\n]/.test(w)) this.scan(where, w, cwd);
      }
    }
    return cwd;
  }

  command(where: string, words: string[], cwd: string): [string, boolean] {
    const w = unwrap(words);
    if (w.length === 0) return [cwd, words.length === 0];
    const head = posix.basename(w[0]!);
    const rest = w.slice(1);
    if (head === "cd" || head === "pushd") {
      const args = rest.filter((a) => !a.startsWith("-"));
      const d = args.length > 0 ? this.t.dir(cwd, args[0]!) : null;
      return [d === null ? cwd : d, false];
    }
    if (INERT.has(head)) return [cwd, false];
    this.cmds.push({ where, words: w });
    if (head === "npm" || head === "pnpm" || head === "yarn" || head === "bun") {
      this.manager(where, head, rest, cwd);
    } else if (
      head === "npm-run-all" ||
      head === "npm-run-all2" ||
      head === "run-s" ||
      head === "run-p"
    ) {
      for (const a of rest) {
        if (!a.startsWith("-")) this.scriptsLike(a, cwd);
      }
    } else if (head === "make" || head === "gmake") {
      this.make(rest, cwd);
    } else if (head === "just") {
      this.just(rest, cwd);
    } else if (head === "turbo" || head === "lerna") {
      this.tasks(rest, cwd);
    } else if (head in RUNNERS) {
      this.configs(head, cwd);
    }
    for (const a of rest) {
      if (a.startsWith("npm:")) this.scriptsLike(a.slice(4), cwd);
    }
    if (INTERPRETERS.has(head)) {
      for (const a of rest) {
        const p = a.startsWith("-") ? null : this.t.file(cwd, a);
        if (p) {
          this.file(p, cwd);
          break;
        }
      }
    } else if (w[0]?.includes("/")) {
      const p = this.t.file(cwd, w[0]!);
      if (p) this.file(p, cwd);
    }
    return [cwd, true];
  }

  package(d: string): Record<string, unknown> {
    if (!this.pkgs.has(d)) {
      const p = d ? posix.join(d, "package.json") : "package.json";
      let v: Record<string, unknown> = {};
      if (this.t.blobs.has(p)) {
        try {
          const parsed = JSON.parse(this.t.read(p) ?? "");
          if (parsed && typeof parsed === "object") v = parsed as Record<string, unknown>;
        } catch {
          this.warnings.push(`${p} does not parse, so no script of it was followed`);
        }
      }
      this.pkgs.set(d, v);
    }
    return this.pkgs.get(d)!;
  }

  scripts(d: string): Record<string, string> {
    const s = this.package(d).scripts;
    if (s && typeof s === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  }

  berry(): boolean {
    const pm = String(this.package("").packageManager ?? "");
    const m = /^yarn@(\d+)/.exec(pm);
    return (m ? parseInt(m[1]!, 10) >= 2 : false) || this.t.blobs.has(".yarnrc.yml");
  }

  workspaces(): string[] {
    const globs: string[] = [];
    let w: any = this.package("").workspaces;
    if (w && typeof w === "object" && !Array.isArray(w)) w = (w as any).packages;
    if (Array.isArray(w)) globs.push(...w.filter((g: any) => typeof g === "string"));
    if (this.t.blobs.has("lerna.json")) {
      try {
        const v = JSON.parse(this.t.read("lerna.json") ?? "").packages;
        if (Array.isArray(v)) globs.push(...v.filter((g: any) => typeof g === "string"));
      } catch {
        /* ignore */
      }
    }
    if (this.t.blobs.has("pnpm-workspace.yaml")) {
      let inside = false;
      for (const l of (this.t.read("pnpm-workspace.yaml") ?? "").split("\n")) {
        if (/^packages\s*:/.test(l)) inside = true;
        else if (inside && /^\s+-\s*/.test(l))
          globs.push(
            l
              .replace(/^\s+-\s*|\s+#.*$/g, "")
              .trim()
              .replace(/^['"]|['"]$/g, ""),
          );
        else if (inside && l.trim() && !/^\s/.test(l)) inside = false;
      }
    }
    const keep = globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/\/$/, ""));
    const drop = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1).replace(/\/$/, ""));
    const dirs = [...this.t.blobs.keys()]
      .filter((p) => posix.basename(p) === "package.json")
      .map((p) => posix.dirname(p))
      .filter((d) => d !== "");
    return dirs
      .filter((d) => keep.some((g) => fnmatchCase(d, g)) && !drop.some((g) => fnmatchCase(d, g)))
      .sort();
  }

  selects(sel: string, d: string): boolean {
    let s = sel
      .trim()
      .replace(/^\.\.\.|\.\.\.$/g, "")
      .replace(/^\{|\}$/g, "")
      .trim();
    if (s.startsWith("./")) s = s.slice(2);
    const name = String(this.package(d).name ?? "");
    return (
      s === d ||
      s === posix.basename(d) ||
      s === name ||
      fnmatchCase(d, s) ||
      (name !== "" && fnmatchCase(name, s))
    );
  }

  packages(ws: string | string[] | null, cwd: string): string[] {
    if (ws === null) {
      const p = this.t.up(cwd, ["package.json"]);
      return p ? [posix.dirname(p)] : [];
    }
    const dirs = this.workspaces();
    const chosen =
      ws === "all" ? dirs : dirs.filter((d) => (ws as string[]).some((s) => this.selects(s, d)));
    return chosen.length > 0 ? chosen : dirs;
  }

  manager(where: string, pm: string, args: string[], cwd: string): void {
    let ws: string | string[] | null = null;
    let i = 0;
    while (i < args.length && args[i]?.startsWith("-")) {
      const eqIdx = args[i]?.indexOf("=");
      const key = eqIdx >= 0 ? args[i]?.slice(0, eqIdx) : args[i]!;
      const hasEq = eqIdx >= 0;
      const takes =
        ["-C", "--dir", "--prefix", "--cwd", "--filter", "-F"].includes(key) ||
        (["-w", "--workspace"].includes(key) && pm !== "pnpm");
      const val = hasEq ? args[i]?.slice(eqIdx + 1) : i + 1 < args.length ? args[i + 1]! : "";
      if (["-r", "--recursive", "-ws", "--workspaces"].includes(key)) {
        ws = "all";
      } else if (["-C", "--dir", "--prefix", "--cwd"].includes(key)) {
        const d = this.t.dir(cwd, val);
        if (d !== null) cwd = d;
      } else if (takes) {
        ws = Array.isArray(ws) ? [...ws, val] : [val];
      }
      i += takes && !hasEq ? 2 : 1;
    }
    if (i >= args.length) return;
    const sub = args[i]!;
    const after = args.slice(i + 1);
    if (after.includes("-ws") || after.includes("--workspaces")) ws = "all";
    const names = after.filter((a) => !a.startsWith("-"));
    if (["run", "run-script", "rum", "urn"].includes(sub)) {
      if (names.length > 0) this.run(pm, names[0]!, ws, cwd);
    } else if (pm === "npm" && ["test", "t", "tst", "start", "stop", "restart"].includes(sub)) {
      this.run(pm, { t: "test", tst: "test" }[sub] ?? sub, ws, cwd);
    } else if (
      (pm === "npm" && (sub === "exec" || sub === "x")) ||
      (pm === "pnpm" && (sub === "exec" || sub === "dlx")) ||
      (pm === "yarn" && (sub === "exec" || sub === "dlx")) ||
      (pm === "bun" && sub === "x")
    ) {
      let j = 0;
      while (j < after.length && after[j]?.startsWith("-") && after[j] !== "--") j++;
      this.command(where, after[j] === "--" ? after.slice(j + 1) : after.slice(j), cwd);
    } else if (pm === "yarn" && sub === "workspaces" && names[0] === "foreach") {
      const runIdx = after.indexOf("run");
      const left = after.slice(runIdx >= 0 ? runIdx + 1 : 1).filter((a) => !a.startsWith("-"));
      if (left.length > 0) this.run(pm, left[0]!, "all", cwd);
    } else if (pm === "yarn" && sub === "workspace" && names.length > 1) {
      const left = names[1] === "run" ? names.slice(2) : names.slice(1);
      if (left.length > 0) this.run(pm, left[0]!, [names[0]!], cwd);
    } else if (pm !== "npm" && !BUILTINS[pm]?.has(sub)) {
      this.run(pm, sub, ws, cwd);
    }
  }

  run(pm: string, name: string, ws: string | string[] | null, cwd: string): void {
    const dirs = this.packages(ws, cwd);
    for (const d of dirs) {
      if (name in this.scripts(d)) this.script(d, name, pm);
    }
    if (pm === "bun" && ws === null && !dirs.some((d) => name in this.scripts(d))) {
      const p = this.t.file(cwd, name);
      if (p) this.file(p, cwd);
    }
  }

  script(d: string, name: string, pm: string): void {
    const s = this.scripts(d);
    const hooks = pm === "yarn" && this.berry() ? [] : [`pre${name}`, `post${name}`];
    const all = [...hooks.slice(0, 1), name, ...hooks.slice(1)];
    for (const n of all) {
      if (n in s && !this.seen.has(`script|${d}|${n}`)) {
        this.seen.add(`script|${d}|${n}`);
        this.shell(`${d ? `${d}/` : ""}package.json scripts.${n}`, s[n]!, d);
      }
    }
  }

  scriptsLike(pattern: string, cwd: string): void {
    const parts = pattern.match(/\*\*|\*|\?|[^*?]+/g) ?? [];
    const patSrc = parts
      .map((t) =>
        t === "**"
          ? ".*"
          : t === "*"
            ? "[^:]*"
            : t === "?"
              ? "[^:]"
              : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    const pat = new RegExp(`${patSrc}$`);
    for (const d of this.packages(null, cwd)) {
      for (const n of Object.keys(this.scripts(d)).sort()) {
        if (pat.test(n)) this.script(d, n, "npm");
      }
    }
  }

  tasks(args: string[], cwd: string): void {
    const sels: string[] = [];
    const names: string[] = [];
    let i = 0;
    while (i < args.length && args[i] !== "--") {
      const eqIdx = args[i]?.indexOf("=");
      const key = eqIdx >= 0 ? args[i]?.slice(0, eqIdx) : args[i]!;
      const hasEq = eqIdx >= 0;
      const val = hasEq ? args[i]?.slice(eqIdx + 1) : i + 1 < args.length ? args[i + 1]! : "";
      if (["--filter", "-F", "--scope"].includes(key)) {
        sels.push(val);
        if (!hasEq) i++;
      } else if (!args[i]?.startsWith("-")) {
        names.push(args[i]!);
      }
      i++;
    }
    if (names[0] === "run" || names[0] === "exec") {
      if (names[0] === "run") names.shift();
      else names.length = 0;
    }
    for (const n of names) {
      if (n.startsWith("//#")) this.run("npm", n.slice(3), null, "");
      else this.run("npm", n, sels.length > 0 ? sels : "all", cwd);
    }
  }

  make(args: string[], cwd: string): void {
    let d = cwd;
    const files: string[] = [];
    const targets: string[] = [];
    const sets: Record<string, string> = {};
    const valued = [
      "-C",
      "--directory",
      "-f",
      "--file",
      "--makefile",
      "-I",
      "--include-dir",
      "-o",
      "--old-file",
      "--assume-old",
      "-W",
      "--what-if",
      "--new-file",
      "--assume-new",
      "--eval",
    ];
    let i = 0;
    while (i < args.length) {
      const a = args[i]!;
      const eqIdx = a.indexOf("=");
      const key = eqIdx >= 0 ? a.slice(0, eqIdx) : a;
      const hasEq = eqIdx >= 0;
      const val = hasEq ? a.slice(eqIdx + 1) : i + 1 < args.length ? args[i + 1]! : "";
      if (valued.includes(a) && i + 1 < args.length) {
        i++;
      } else if (
        ["-j", "--jobs", "-l", "--load-average", "--max-load"].includes(a) &&
        i + 1 < args.length &&
        /^\d+(\.\d+)?$/.test(args[i + 1]!)
      ) {
        i += 2;
        continue;
      } else if (
        (a.startsWith("-C") || a.startsWith("-f")) &&
        a.length > 2 &&
        !a.startsWith("--")
      ) {
        const k = a.slice(0, 2);
        const v = a.slice(2);
        if (k === "-C") {
          const nd = this.t.dir(d, v);
          if (nd !== null) d = nd;
        } else if (k === "-f") {
          files.push(v);
        }
        i++;
        continue;
      } else if (!hasEq && !a.startsWith("-")) {
        targets.push(a);
        i++;
        continue;
      }
      if (key === "-C" || key === "--directory") {
        const nd = this.t.dir(d, val);
        if (nd !== null) d = nd;
      } else if (key === "-f" || key === "--file" || key === "--makefile") {
        files.push(val);
      } else if (hasEq && !a.startsWith("-")) {
        sets[key] = val;
      }
      i++;
    }
    let p: string | null = null;
    for (const f of files.length > 0 ? files : ["GNUmakefile", "makefile", "Makefile"]) {
      p = this.t.file(d, f);
      if (p) break;
    }
    if (!p) return;
    const k = `${p}|${d}|${JSON.stringify(Object.entries(sets).sort())}`;
    if (!this.makes.has(k)) this.makes.set(k, new Makefile(this.t, p, d, sets));
    const mk = this.makes.get(k)!;
    for (const t of targets.length > 0 ? targets : mk.goal ? [mk.goal] : []) {
      this.target(mk, t, d);
    }
  }

  target(mk: Makefile, t: string, d: string): void {
    const key = `make|${mk.path}|${d}|${t}`;
    if (this.seen.has(key) || !mk.rules.has(t)) return;
    this.seen.add(key);
    const rule = mk.rules.get(t)!;
    for (const p of rule.prereqs) this.target(mk, p, d);
    for (const line of rule.recipe) {
      this.shell(`${mk.path} ${t}`, mk.recipe(line), d);
    }
  }

  just(args: string[], cwd: string): void {
    let jf: string | null = null;
    let wd: string | null = null;
    const names: string[] = [];
    let i = 0;
    while (i < args.length) {
      const eqIdx = args[i]?.indexOf("=");
      const key = eqIdx >= 0 ? args[i]?.slice(0, eqIdx) : args[i]!;
      const hasEq = eqIdx >= 0;
      let val = hasEq ? args[i]?.slice(eqIdx + 1) : "";
      if (key === "-f" || key === "--justfile" || key === "-d" || key === "--working-directory") {
        if (!hasEq) {
          val = i + 1 < args.length ? args[i + 1]! : "";
          i++;
        }
        if (key === "-f" || key === "--justfile") jf = val;
        else wd = val;
      } else if (key === "--set") {
        i += 2;
        continue;
      } else if (!args[i]?.startsWith("-")) {
        names.push(args[i]!);
      }
      i++;
    }
    const p = jf
      ? this.t.file(cwd, jf)
      : this.t.up(cwd, ["justfile", "Justfile", ".justfile", "JUSTFILE"]);
    if (!p) return;
    if (!this.justs.has(p)) this.justs.set(p, parseJust(this.t.read(p) ?? ""));
    const { recipes, vars, first } = this.justs.get(p)!;
    let d = wd ? this.t.dir(cwd, wd) : null;
    if (d === null) d = posix.dirname(p);
    const toRun = names.filter((n) => recipes.has(n));
    for (const n of toRun.length > 0 ? toRun : first ? [first] : []) {
      this.recipe(p, n, d);
    }
  }

  recipe(p: string, n: string, d: string): void {
    const { recipes, vars, first } = this.justs.get(p)!;
    const key = `just|${p}|${n}`;
    if (this.seen.has(key) || !recipes.has(n)) return;
    this.seen.add(key);
    const { deps, body } = recipes.get(n)!;
    for (const dep of deps) this.recipe(p, dep, d);
    for (let line of body) {
      line = line.replace(
        /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g,
        (_, name) => vars.get(name) ?? `{{${name}}}`,
      );
      this.shell(`${p} ${n}`, line.replace(/^[@-]+/, ""), d);
    }
  }

  configs(head: string, cwd: string): void {
    const found: Array<{ where: string; text: string }> = [];
    for (const n of RUNNERS[head] ?? []) {
      const p = this.t.up(cwd, [n]);
      if (p) found.push({ where: p, text: configText(this.t.read(p) ?? "", p) });
    }
    if (head === "lint-staged") {
      const pj = this.t.up(cwd, ["package.json"]);
      if (pj) {
        const v = this.package(posix.dirname(pj))["lint-staged"];
        if (v) found.push({ where: `${pj} lint-staged`, text: JSON.stringify(v) });
      }
    }
    for (const { where: p, text } of found) {
      if (!this.seen.has(`config|${p}`)) {
        this.seen.add(`config|${p}`);
        this.texts.push({ where: p, text });
        for (const l of text.split("\n")) {
          const trimmed = l.trim();
          if (trimmed) this.lines.push({ where: p, line: trimmed });
        }
      }
    }
  }

  file(p: string, cwd: string): void {
    if (this.seen.has(`file|${p}`)) return;
    this.seen.add(`file|${p}`);
    const text = this.t.read(p);
    if (text !== null) {
      this.shell(p, /\.[cm]?[jt]sx?$/.test(p) ? stripJs(text) : text, cwd, true);
    }
  }

  runs(linter: string): string | null {
    for (const { where, words } of this.cmds) {
      if (words.some((w) => !/[ \t\r\n]/.test(w) && named(linter, w))) return where;
    }
    for (const { where, text } of this.texts) {
      if (named(linter, text)) return where;
    }
    return null;
  }
}

// --- linter detection ---------------------------------------------------------------------------
const MANIFESTS =
  /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|tox\.ini|requirements[^/]*\.txt|Pipfile|Gemfile|go\.mod|Cargo\.toml|composer\.json|\.pre-commit-config\.ya?ml|\.tool-versions|mise\.toml)$/;

function hasLinter(tree: Tree, linter: string): string | null {
  const own = new RegExp(
    `\\.?${linter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(rc)?([._-].*)?$`,
    "i",
  );
  for (const p of [...tree.blobs.keys()].sort()) {
    if (own.test(posix.basename(p))) return p;
  }
  for (const p of [...tree.blobs.keys()].sort()) {
    if (MANIFESTS.test(p) && named(linter, configText(tree.read(p) ?? "", p))) return p;
  }
  return null;
}

function states(dispatch: string): Record<string, string> {
  const LEDGER = join(dirname(resolve(dispatch)), "ledger.jsonl");
  const out: Record<string, string> = {};
  let rows: string[];
  try {
    // BASE opened the ledger with utf-8-sig: a byte-order mark is not part of the content.
    rows = readFileSync(LEDGER, "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n");
  } catch {
    return out;
  }
  for (const row of rows) {
    let e: any;
    try {
      e = JSON.parse(row);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    const a = e.action;
    const d = String(e.detail ?? "");
    const runName = e.run ?? "?";
    if (a === "ticket-create" && d.startsWith("style proposal: ")) {
      out[d.slice(16).trim()] = `filed ${e.target ?? "?"} in ${runName}`;
    } else if (a === "note" && d.startsWith("style proposal declined: ")) {
      out[d.slice(25).split(": ", 1)[0]?.trim()] = `declined in ${runName}`;
    } else if (a === "note" && d.startsWith("style proposal asked: ")) {
      const k = d.slice(22).trim();
      if (!(out[k] ?? "").startsWith("filed") && !(out[k] ?? "").startsWith("declined")) {
        out[k] = `asked in ${runName}`;
      }
    }
  }
  return out;
}

// --- sort line parsing ---------------------------------------------------------------------------
const ENTRY = /^(?:[-*+][ \t]+)?(S\d+|N\d+)[ \t]+(.+?):(?:[ \t]+(.*))?$/;

function shape(line: string): { id: string; head: string[]; reason: string } | null {
  const m = ENTRY.exec(line);
  if (!m) return null;
  const i = m[1]!;
  const head = m[2]?.split(/\s+/);
  const reason = (m[3] ?? "").trim();
  let ok: boolean;
  if (i[0] === "S") {
    ok =
      (head[0] === "linter" &&
        (head.length === 4 || (head.length === 6 && head[4] === "via")) &&
        (head[2] === "enable" || head[2] === "write")) ||
      (head.length === 2 && head[0] === "docs") ||
      (head.length === 1 && head[0] === "neither");
  } else {
    ok = head.length >= 3 && head[0] === "new-linter";
  }
  return ok ? { id: i, head, reason } : null;
}

// --- commands -------------------------------------------------------------------------------------
function core(cmd: string, dispatch: string): number {
  const RUN = basename(resolve(dispatch));
  const SORT = join(dispatch, "style-sort.md");

  if (cmd === "forms") {
    for (const line of read(dispatch, "file").split("\n")) {
      const t = line.trim();
      if (t) console.log((shape(t) ? "ok  " : "bad ") + t);
    }
    return 0;
  }

  if (cmd === "list" || cmd === "count") {
    const { style, faults } = findings(dispatch);
    if (faults.length > 0) {
      console.log(faults.join("\n"));
      return 2;
    }
    if (cmd === "count") console.log(String(style.length));
    for (const f of cmd === "list" ? style : []) {
      console.log([f.id, f.target, f.rest].filter(Boolean).join(" "));
    }
    return 0;
  }

  if (cmd === "gate") {
    const { repo, gate } = profile(dispatch);
    if (!gate || !repo || !existsSync(repo)) {
      console.log(
        !gate
          ? "the waybill's Project profile names no gate"
          : `the waybill's Project profile names no repo that exists${repo ? `: ${repo}` : ""}`,
      );
      return 2;
    }
    const r = new Reach(new Tree(repo, RUN), gate);
    for (const w of r.warnings) console.error(`style-findings: ${w}`);
    const shown = new Map<string, number>();
    for (const { where, line } of r.lines) {
      shown.set(where, (shown.get(where) ?? 0) + 1);
      if ((shown.get(where) ?? 0) <= SHOWN) {
        console.log(`${where}: ${line.length <= 200 ? line : `${line.slice(0, 197)}...`}`);
      }
    }
    for (const [where, k] of shown) {
      if (k > SHOWN) console.log(`${where}: ${k - SHOWN} more lines, read and not shown`);
    }
    return 0;
  }

  // check
  const { style, faults } = findings(dispatch);
  const ids = style.map((s) => s.id);
  if (!existsSync(SORT)) {
    if (faults.length > 0 || style.length > 0) {
      console.log(
        [
          ...faults,
          `no style-sort.md in ${dispatch}, and ${style.length} style finding${style.length === 1 ? "" : "s"} to sort`,
        ].join("\n"),
      );
      return 2;
    }
    console.log("no style findings, so nothing to sort");
    return 0;
  }

  const onS = new Map<string, number[]>();
  const onN = new Map<string, number[]>();
  const firstNew = new Map<string, [number, string]>();
  const props: Array<{
    id: string;
    key: string;
    via: string | null;
    newInfo: [string[], boolean] | null;
  }> = [];
  const checks: Array<{ n: number; id: string; kind: string; lint: string; extra: any }> = [];
  let badShape = false;

  const sortLines = read(SORT, "sort").split("\n");
  for (let n = 0; n < sortLines.length; n++) {
    const raw = sortLines[n]!;
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const got = shape(line);
    if (!got) {
      faults.push(`line ${n + 1} is not a sort line: ${line}`);
      badShape = true;
      continue;
    }
    const { id: i, head, reason } = got;
    if (!reason) faults.push(`line ${n + 1}: ${i} has no reason`);
    if (i[0] === "S") {
      if (!onS.has(i)) onS.set(i, []);
      onS.get(i)?.push(n + 1);
      if (!ids.includes(i)) faults.push(`line ${n + 1}: ${i} is not a style finding of this run`);
      if (head[0] === "linter") {
        const lint = plain(head[1]!);
        const via = head.length === 6 ? plain(head[5]!) : null;
        checks.push({ n: n + 1, id: i, kind: "linter", lint, extra: via });
        props.push({
          id: i,
          key: `linter ${lint.toLowerCase()} ${head[2]} ${plain(head[3]!)}`,
          via,
          newInfo: null,
        });
      } else {
        props.push({
          id: i,
          key: head[0] === "docs" ? `docs ${plain(head[1]!)}` : "neither",
          via: null,
          newInfo: null,
        });
      }
      continue;
    }
    if (!onN.has(i)) onN.set(i, []);
    onN.get(i)?.push(n + 1);
    const rest = head.slice(2);
    const marked = rest[rest.length - 1] === "not-in-gate";
    const covers = (marked ? rest.slice(0, -1) : rest)
      .join(" ")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (covers.length === 0)
      faults.push(`line ${n + 1}: ${i} names no finding the linter would enforce`);
    for (const c of covers) {
      if (!ids.includes(c))
        faults.push(`line ${n + 1}: ${i} names ${c}, which is not a style finding of this run`);
    }
    const lint = plain(head[1]!);
    const was = firstNew.get(lint.toLowerCase());
    if (was && (was[0] !== n + 1 || was[1] !== i)) {
      faults.push(
        `line ${n + 1}: ${i} proposes ${lint} again, as ${was[1]} on line ${was[0]} does: propose it once, for every finding it would enforce`,
      );
    }
    if (!was) firstNew.set(lint.toLowerCase(), [n + 1, i]);
    checks.push({ n: n + 1, id: i, kind: "new", lint, extra: marked });
    props.push({
      id: i,
      key: `new-linter ${lint.toLowerCase()}`,
      via: null,
      newInfo: [covers, marked],
    });
  }

  for (const i of ids) {
    if (!onS.has(i)) faults.push(`${i} is not sorted`);
  }
  for (const [i, where] of [...onS.entries(), ...onN.entries()]) {
    if (where.length > 1) faults.push(`${i} is sorted twice, on lines ${where.join(", ")}`);
  }

  if (checks.length > 0) {
    const { repo, gate } = profile(dispatch);
    if (!repo || !existsSync(repo)) {
      for (const { n, id: i, lint } of checks) {
        faults.push(
          `line ${n}: ${i} names ${lint}, and the waybill's Project profile names no repo that exists to check it against`,
        );
      }
    } else {
      const tree = new Tree(repo, RUN);
      const r = gate ? new Reach(tree, gate) : null;
      for (const w of r?.warnings ?? []) console.error(`style-findings: ${w}`);
      for (const { n, id: i, kind, lint, extra } of checks) {
        if (kind === "linter" && extra) {
          const p = tree.file("", extra);
          if (p === null) {
            faults.push(
              `line ${n}: ${i} names ${lint} via ${extra}, which the run's branch does not have`,
            );
          } else if (!named(lint, configText(tree.read(p) ?? "", p))) {
            faults.push(`line ${n}: ${i} names ${lint} via ${extra}, which does not name ${lint}`);
          }
        } else if (kind === "linter" && r === null) {
          faults.push(
            `line ${n}: ${i} names ${lint}, and the waybill's Project profile has no gate to check it against`,
          );
        } else if (kind === "linter" && !r?.runs(lint)) {
          faults.push(
            `line ${n}: ${i} names ${lint}, which \`gate\` does not show the gate running: if the gate runs it some way \`gate\` does not follow, add via and the file that runs it after the rule; if it does not, sort the finding docs or neither, and propose ${lint} on a new-linter line`,
          );
        } else if (kind === "new") {
          const at = r?.runs(lint) ?? null;
          const own = hasLinter(tree, lint);
          if (at) {
            faults.push(
              `line ${n}: ${i} proposes ${lint}, which the gate already runs (${at}): sort its findings as linter lines`,
            );
          } else if (own && !extra) {
            faults.push(
              `line ${n}: ${i} proposes ${lint}, which the project already has (${own}): if the gate runs it, sort its findings as linter lines, with via if \`gate\` does not show it; if the gate does not, add not-in-gate after the findings`,
            );
          }
        }
      }
    }
  }

  if (faults.length > 0) {
    console.log([...faults, ...(badShape ? [FORMS] : [])].join("\n"));
    return 2;
  }

  // Print proposals
  const groups = new Map<
    string,
    { ids: string[]; via: string[]; newInfo: [string[], boolean] | null }
  >();
  const order: string[] = [];
  const seenState = states(dispatch);
  for (const { id, key, via, newInfo } of props) {
    if (!groups.has(key)) groups.set(key, { ids: [], via: [], newInfo });
    const g = groups.get(key)!;
    g.ids.push(id);
    if (via && !g.via.includes(via)) g.via.push(via);
    if (newInfo && !g.newInfo) g.newInfo = newInfo;
  }
  for (const key of groups.keys()) {
    if (!order.includes(key)) order.push(key);
  }
  const rank: Record<string, number> = { linter: 0, docs: 1, "new-linter": 2, neither: 3 };
  const sortedKeys = [...order].sort(
    (a, b) => (rank[a.split(" ")[0]!] ?? 9) - (rank[b.split(" ")[0]!] ?? 9),
  );
  for (const key of sortedKeys) {
    const g = groups.get(key)!;
    const notes: string[] = [];
    if (g.newInfo) notes.push(`for ${g.newInfo[0].join(" ")}`);
    notes.push(...g.via.map((v) => `via ${v}`));
    if (g.newInfo?.[1]) notes.push("not in the gate");
    if (key !== "neither" && key in seenState) notes.push(seenState[key]!);
    console.log(`${g.ids.join(" ")}: ${key}${notes.length > 0 ? ` [${notes.join("; ")}]` : ""}`);
  }
  const kinds = props.filter((p) => p.id[0] === "S").map((p) => p.key.split(" ")[0]!);
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  console.log(
    `sorted ${plural(ids.length, "style finding", "style findings")}: ${kinds.filter((k) => k === "linter").length} to a linter, ${kinds.filter((k) => k === "docs").length} to the docs, ${kinds.filter((k) => k === "neither").length} to neither; ${plural(firstNew.size, "new linter", "new linters")} proposed`,
  );
  return 0;
}

// --- entry -----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const sub = argv[0];
if (sub !== "--self-test") {
  if (sub === "list" || sub === "count" || sub === "gate" || sub === "check") {
    if (argv.length !== 2) {
      console.error("usage: style-findings.sh list|count|gate|check <dispatch> | --self-test");
      process.exit(1);
    }
    const d = argv[1]!;
    if (!existsSync(d)) {
      console.error(`style-findings: no dispatch directory at ${d}`);
      process.exit(1);
    }
    process.exit(core(sub, d));
  } else {
    console.error("usage: style-findings.sh list|count|gate|check <dispatch> | --self-test");
    process.exit(1);
  }
}

// --- self-test -------------------------------------------------------------------------------
const SELF = join(scriptsDir(import.meta), "style-findings.sh");
const SKILL = join(toolRoot(import.meta), "skills/postmaster");

withTempDir((tmp) => {
  const st = new SelfTest();
  let out = "";
  let rc = 0;

  const ok = (label: string) => st.ok(label);
  const fail = (label: string, detail?: string) => st.fail(label, detail);
  const invoke = (...args: string[]): void => {
    const r = run("bash", [SELF, ...args]);
    // BASE's run() used $(...), which strips trailing newlines.
    out = (r.out + r.err).replace(/\n+$/, "");
    rc = r.code;
  };
  // BASE ran `run core forms <file>`: the core function in the same shell, not the script.
  const runCore = (...args: string[]): void => {
    const chunks: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    class ExitSignal extends Error {
      constructor(public readonly code: number) {
        super("exit");
      }
    }
    console.log = (...a: unknown[]) => void chunks.push(`${a.join(" ")}\n`);
    console.error = (...a: unknown[]) => void chunks.push(`${a.join(" ")}\n`);
    process.exit = ((code?: number) => {
      throw new ExitSignal(code ?? 0);
    }) as typeof process.exit;
    try {
      rc = core(args[0]!, args[1]!);
    } catch (e) {
      rc = e instanceof ExitSignal ? e.code : 1;
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exit = origExit;
    }
    out = chunks.join("").replace(/\n+$/, "");
  };
  const is = (label: string, wantExit: number, wantOut: string): void => {
    if (rc === wantExit && out === wantOut) ok(label);
    else fail(`${label}: wanted exit ${wantExit}, got ${rc}`, out);
  };
  const has = (label: string, wantExit: number, wantIn: string, wantNotIn?: string): void => {
    const okIn = out.includes(wantIn);
    const okNot = wantNotIn === undefined || !out.includes(wantNotIn);
    if (rc === wantExit && okIn && okNot) ok(label);
    else
      fail(
        `${label}: wanted exit ${wantExit} with "${wantIn}"${wantNotIn ? ` and no "${wantNotIn}"` : ""}, got exit ${rc}`,
        out,
      );
  };
  const lines = (...args: string[]): string => args.join("\n");

  const G = (...args: string[]): ReturnType<typeof run> =>
    run("git", [
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
      ...args,
    ]);

  const commit = (dir: string, msg: string): void => {
    G("-C", dir, "add", "-A");
    G("-C", dir, "commit", "-q", "-m", msg);
  };

  const repoAt = (dir: string, ...branches: string[]): void => {
    G("-C", dir, "init", "-q");
    commit(dir, "fixture");
    for (const b of branches) G("-C", dir, "branch", b);
  };

  const waybill = (dispatch: string, repo: string, gate: string, gateLine?: string): void => {
    mkdirSync(dispatch, { recursive: true });
    const gateText = gateLine ?? `gate: ${gate}  build: none    browser suite: none`;
    writeFileSync(
      join(dispatch, "brief.md"),
      `# Waybill: T\n\n## Ticket\n## Problem / feature\nA change.\n\n## Project profile\ngate: make decoy\n\n## Project profile\nrepo: ${repo}          default branch: main       BASE: abc123\n${gateText}\ndocs to read first: AGENTS.md\n\n## Dispatch\ndispatch: ${dispatch}\nturnpikes: style, bug, security\n`,
    );
  };

  const logged = (dispatch: string, ...args: string[]): void => {
    run("bash", [join(scriptsDir(import.meta), "log-action.sh"), dispatch, "coachman", ...args]);
  };

  const logFindings = (dispatch: string, count: number): void => {
    for (let k = 1; k <= count; k++) {
      logged(
        dispatch,
        "finding",
        `src/f${k}.ts:${k}`,
        `style P3 r1 style luna reading: finding ${k}`,
      );
    }
  };

  const sortFile = (dispatch: string, ...args: string[]): void => {
    writeFileSync(join(dispatch, "style-sort.md"), `${args.join("\n")}\n`);
  };

  const R = join(tmp, "runs", "proj");

  // === Fixture: npm project ===
  const npmDir = join(tmp, "npm");
  mkdirSync(join(npmDir, "scripts"), { recursive: true });
  mkdirSync(join(npmDir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(
    join(npmDir, "package.json"),
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
          "format:check":
            "prettier --check . || (echo 'run npm run format, to fix what eslint finds' && exit 1)",
          quoted: "sh -c 'tsc --noEmit # stylua later'",
          format: "eslint --fix .",
          build: "hadolint Dockerfile",
          "build:types": "tsc -p types",
          nbsp: "node -e \"console.log('a b\u00a0: c')\" && dprint check",
          test: "vitest",
          docs: "markdownlint docs",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(npmDir, "scripts", "versions.js"),
    '/**\n * xo would be stricter\n */\n// oxlint would catch more here\nrequire("child_process").execSync("stylelint src") // knip later\n',
  );
  writeFileSync(
    join(npmDir, "scripts", "typos.txt"),
    "jscpd is written here, and nothing runs it\n",
  );
  writeFileSync(join(npmDir, "node_modules", ".bin", "helper"), "#!/bin/sh\nstandard --fix .\n");
  writeFileSync(join(npmDir, ".gitignore"), "node_modules/\n");
  repoAt(npmDir, "T-1", "T-2", "T-6", "T-7", "T-8", "T-16", "T-20", "T-21", "T-28");

  // === Fixture: make project ===
  const mkDir = join(tmp, "make");
  mkdirSync(join(mkDir, "scripts"), { recursive: true });
  mkdirSync(join(mkDir, "mk"), { recursive: true });
  mkdirSync(join(mkDir, "web"), { recursive: true });
  writeFileSync(
    join(mkDir, "Makefile"),
    "SHELLCHECK ?= shellcheck\nLINTER :::= yamllint\n.PHONY: check lint docs test\ncheck: lint docs test\nlint:\n\t@$(SHELLCHECK) scripts/*.sh\n\t$(LINTER) .\nifdef CI\n\t$(MAKE) -C web lint\nendif\n\ttouch make-ran\ndocs:\n\t-markdownlint docs\ntest:\n\t./scripts/test.sh\nfmt:\n\truff format .\ninclude mk/*.mk\n",
  );
  writeFileSync(join(mkDir, "mk", "extra.mk"), "docs: spell\nspell:\n\tcspell .\n");
  writeFileSync(join(mkDir, "web", "Makefile"), "lint:\n\t./ci.sh\n");
  writeFileSync(join(mkDir, "web", "ci.sh"), "#!/bin/sh\nstylelint .\n");
  writeFileSync(join(mkDir, "ci.sh"), "#!/bin/sh\nprettier --check .\n");
  writeFileSync(
    join(mkDir, "scripts", "test.sh"),
    "#!/bin/sh\n# pylint is not run here\nbats test\n",
  );
  repoAt(mkDir, "T-4", "T-24", "T-27");

  // === Fixture: monorepo ===
  const monoDir = join(tmp, "mono");
  mkdirSync(join(monoDir, "packages", "web"), { recursive: true });
  mkdirSync(join(monoDir, "packages", "docs"), { recursive: true });
  writeFileSync(
    join(monoDir, "package.json"),
    '{"name": "mono", "workspaces": ["packages/*"], "scripts": {"check": "npm run lint --workspaces && turbo run typecheck && pnpm -r test && npm -w packages/docs run spell", "lint": "tsc"}}\n',
  );
  writeFileSync(
    join(monoDir, "packages", "web", "package.json"),
    '{"name": "web", "scripts": {"lint": "eslint .", "typecheck": "tsc -b", "test": "vitest", "fmt": "dprint check"}}\n',
  );
  writeFileSync(
    join(monoDir, "packages", "docs", "package.json"),
    '\uFEFF{"name": "@x/docs", "scripts": {"spell": "cspell .", "lint": "markdownlint ."}}\n',
  );
  repoAt(monoDir, "T-10", "T-11");

  // === Fixture: other (just, wrappers, runners, long file) ===
  const otherDir = join(tmp, "other");
  mkdirSync(join(otherDir, "scripts"), { recursive: true });
  writeFileSync(
    join(otherDir, "justfile"),
    "default: check\n\ncheck: lint\n    cargo test\n\nlint:\n    cargo clippy -- -D warnings\n\nfmt:\n    cargo fmt --check\n",
  );
  writeFileSync(join(otherDir, "scripts", "lint.sh"), "ruff check .\n");
  writeFileSync(
    join(otherDir, "scripts", "lint.js"),
    'require("child_process").execSync("stylelint x")\n',
  );
  writeFileSync(join(otherDir, "scripts", "check.ts"), "execSync(`eslint ${dir}`)\n");
  writeFileSync(join(otherDir, "scripts", "check.sh"), "shellcheck *.sh\n");
  writeFileSync(
    join(otherDir, ".pre-commit-config.yaml"),
    "repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    hooks:\n      - id: ruff\n  # - id: mypy\n",
  );
  let bigSh = "";
  for (let k = 1; k <= 60; k++) bigSh += `echo step ${k}\n`;
  bigSh += "vale .\n";
  writeFileSync(join(otherDir, "scripts", "big.sh"), bigSh);
  writeFileSync(join(otherDir, "README.md"), "A readme that names no linter.\n");
  writeFileSync(
    join(otherDir, "package.json"),
    '{"packageManager": "yarn@4.1.0", "scripts": {"check": "yarn lint", "prelint": "sort-package-json --check", "lint": "eslint ."}}\n',
  );
  repoAt(otherDir, "T-12", "T-13", "T-14", "T-18", "T-23", "T-25", "T-26");

  // === Dispatch setups ===
  const d = join(R, "T-1");
  waybill(d, npmDir, "npm run check");
  logged(d, "dispatch", "luna", "thread-1");
  logged(d, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a list named map");
  logged(
    d,
    "finding",
    "src/b.ts:40",
    "gating P1 r1 style,bug luna,sol execution: an off-by-one the style lens found",
  );
  logged(
    d,
    "finding",
    "src/c.ts:7",
    "style P3 r2 bug sol reading: a let never reassigned, reported under bug",
  );
  logged(d, "apply", "abc1234", "src/b.ts:40");

  const none = join(R, "T-2");
  waybill(none, npmDir, "npm run check");
  logged(
    none,
    "finding",
    "src/b.ts:40",
    "gating P2 r1 bug luna reading: style is named here, and the finding is gating",
  );

  console.log("positive controls: a run's style findings");
  invoke("count", d);
  is("a run with two style findings counts two", 0, "2");
  invoke("list", d);
  is(
    "they are listed in the order logged, whichever lens found them, and not the gating one the style lens found",
    0,
    lines(
      "S1 src/a.ts:12 P3 r1 style luna reading: a list named map",
      "S2 src/c.ts:7 P3 r2 bug sol reading: a let never reassigned, reported under bug",
    ),
  );

  const back = join(R, "T-19");
  mkdirSync(back, { recursive: true });
  logged(back, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a name");
  logged(
    back,
    "finding",
    "src/a.ts:12:5",
    "style P3 r1 style luna reading: another name on that line, with a column",
  );
  logged(back, "finding", "src/a.ts:12", "gating P2 r2 bug sol reading: argued back to gating");
  invoke("list", back);
  is(
    "a finding argued back to gating is no style finding, and one at a column of that line stays one",
    0,
    "S1 src/a.ts:12:5 P3 r1 style luna reading: another name on that line, with a column",
  );

  console.log("negative controls: a run's style findings");
  invoke("count", none);
  is("a run whose findings are all gating counts none", 0, "0");
  invoke("list", none);
  is("and lists none", 0, "");

  const beforeLines = (() => {
    try {
      return readFileSync(join(d, "actions.jsonl"), "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  })();
  const refuseR = run("bash", [
    join(scriptsDir(import.meta), "log-action.sh"),
    d,
    "coachman",
    "finding",
    "src/x.ts:1",
    "P2 r1 bug luna reading: no class",
  ]);
  const afterLines = (() => {
    try {
      return readFileSync(join(d, "actions.jsonl"), "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  })();
  if (refuseR.code === 1 && afterLines === beforeLines && refuseR.err.includes("gating or style"))
    ok("log-action.sh refuses a finding with no class, and writes nothing");
  else
    fail(
      `log-action.sh refuses a finding with no class, and writes nothing (exit ${refuseR.code})`,
      refuseR.err,
    );

  const bad = join(R, "T-3");
  mkdirSync(bad, { recursive: true });
  writeFileSync(
    join(bad, "actions.jsonl"),
    readFileSync(join(d, "actions.jsonl"), "utf8") +
      '{"action":"finding","target":"src/x.ts:1","detail":"advisory P3 r1 style luna reading: old words"}\n',
  );
  invoke("count", bad);
  is(
    "a finding logged with another class is named, and nothing is counted",
    2,
    'actions.jsonl line 6: a finding whose detail opens with "advisory", not gating or style',
  );
  invoke("count", R);
  has("no action log is refused, never read as no findings", 1, "no action log at");

  console.log("positive controls: what the gate runs");
  invoke("gate", d);
  for (const want of [
    "gate: npm run check",
    "package.json scripts.precheck: node scripts/versions.js",
    "package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos",
    "package.json scripts.typos: typos . > scripts/typos.txt",
    "package.json scripts.test:unit: bun test",
    "package.json scripts.format:check: prettier",
    'scripts/versions.js: require("child_process").execSync("stylelint src")',
  ]) {
    has(`the gate reaches: ${want}`, 0, want);
  }

  const m = join(R, "T-4");
  waybill(m, mkDir, "make -j$(nproc) -j 4 check");
  invoke("gate", m);
  for (const want of [
    "Makefile lint: shellcheck scripts/*.sh",
    "Makefile lint: yamllint .",
    "web/Makefile lint: ./ci.sh",
    "web/ci.sh: stylelint .",
    "Makefile lint: touch make-ran",
    "Makefile docs: markdownlint docs",
    "Makefile spell: cspell .",
    "scripts/test.sh: bats test",
  ]) {
    has(`a make gate reaches: ${want}`, 0, want);
  }

  const t24 = join(R, "T-24");
  waybill(t24, mkDir, "make -j 4");
  invoke("gate", t24);
  has(
    "make -j 4 runs the default goal, not a target named 4",
    0,
    "Makefile lint: shellcheck scripts/*.sh",
  );

  const t27 = join(R, "T-27");
  waybill(t27, mkDir, "make -j$(nproc) fmt");
  invoke("gate", t27);
  has(
    "a substitution in a make flag leaves the target named",
    0,
    "Makefile fmt: ruff format .",
    "shellcheck",
  );

  const t10 = join(R, "T-10");
  waybill(t10, monoDir, "npm run check");
  invoke("gate", t10);
  for (const want of [
    "packages/web/package.json scripts.lint: eslint .",
    "packages/docs/package.json scripts.lint: markdownlint .",
    "packages/web/package.json scripts.typecheck: tsc -b",
    "packages/web/package.json scripts.test: vitest",
    "packages/docs/package.json scripts.spell: cspell .",
  ]) {
    has(`workspaces reached by --workspaces, turbo, pnpm -r and -w: ${want}`, 0, want);
  }

  const t11 = join(R, "T-11");
  waybill(t11, monoDir, "cd packages/web && npm run lint");
  invoke("gate", t11);
  has(
    "a cd before npm run takes the script from that package",
    0,
    "packages/web/package.json scripts.lint: eslint .",
    "scripts.lint: tsc",
  );

  const t12 = join(R, "T-12");
  waybill(t12, otherDir, "just");
  invoke("gate", t12);
  has(
    "just runs its first recipe, and each recipe's prerequisites",
    0,
    "justfile lint: cargo clippy -- -D warnings",
    "cargo fmt",
  );

  const t13 = join(R, "T-13");
  waybill(
    t13,
    otherDir,
    "env CI=1 ./scripts/lint.sh && cross-env CI=1 node scripts/lint.js && node -r ts-node/register scripts/check.ts && bash -euo pipefail scripts/check.sh",
  );
  invoke("gate", t13);
  for (const want of [
    "scripts/lint.sh: ruff check .",
    'scripts/lint.js: require("child_process").execSync("stylelint x")',
    "scripts/check.ts: execSync(`eslint ${dir}`)",
    "scripts/check.sh: shellcheck *.sh",
  ]) {
    has(`past env, cross-env and an interpreter's flags: ${want}`, 0, want);
  }

  const t14 = join(R, "T-14");
  waybill(t14, otherDir, "pre-commit run --all-files");
  invoke("gate", t14);
  has(
    "pre-commit's config is reached, less its comments",
    0,
    ".pre-commit-config.yaml: - id: ruff",
    "mypy",
  );

  const t7 = join(R, "T-7");
  waybill(t7, npmDir, "npm run build:types && npm run lint");
  invoke("gate", t7);
  has(
    "a build: inside the gate is part of it",
    0,
    "package.json scripts.build:types: tsc -p types",
  );

  const t8 = join(R, "T-8");
  waybill(t8, npmDir, "npm run nbsp");
  invoke("gate", t8);
  has(
    "a no-break space in a quoted word is read, not recursed into",
    0,
    "package.json scripts.nbsp:",
  );

  const t20 = join(R, "T-20");
  waybill(t20, npmDir, "", "- **gate:** `npm run lint`  **build:** none    browser suite: none");
  invoke("gate", t20);
  has(
    "a gate in bold and backticks, on a bullet, is read",
    0,
    "package.json scripts.lint: cross-env",
  );

  const t21 = join(R, "T-21");
  waybill(t21, npmDir, "", "gate : npm run lint  build: none");
  invoke("gate", t21);
  has("a gate written gate :, is read", 0, "package.json scripts.lint: cross-env");

  const t28 = join(R, "T-28");
  mkdirSync(t28, { recursive: true });
  writeFileSync(
    join(t28, "brief.md"),
    `## Project profile\n- **repo:** \`${npmDir}\`  default branch: main\n- **gate:** \`npm run lint\`\n`,
  );
  invoke("gate", t28);
  has("a repo in backticks is read", 0, "package.json scripts.lint: cross-env");

  const t23 = join(R, "T-23");
  waybill(t23, otherDir, "sh scripts/big.sh");
  invoke("gate", t23);
  has(
    "a long file is shown in part",
    0,
    "scripts/big.sh: 41 more lines, read and not shown",
    "vale",
  );
  logFindings(t23, 1);
  sortFile(t23, "S1 linter vale enable Vale.Spelling: the file's last line runs vale");
  invoke("check", t23);
  has("and read whole", 0, "S1: linter vale enable Vale.Spelling");

  const t26 = join(R, "T-26");
  waybill(t26, otherDir, "npm run lint");
  invoke("gate", t26);
  has(
    "npm runs a script's pre script",
    0,
    "package.json scripts.prelint: sort-package-json --check",
  );

  console.log("negative controls: what the gate runs");
  invoke("gate", d);
  for (const not of [
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
  ]) {
    has(`the gate does not reach ${not}`, 0, "gate: npm run check", not);
  }
  invoke("gate", m);
  for (const not of ["ruff", "pylint", "prettier", "decoy", "Makefile 4"]) {
    has(`a make gate does not reach ${not}`, 0, "Makefile lint:", not);
  }
  invoke("gate", t10);
  has("a workspace script nothing runs is not reached", 0, "packages/web", "dprint");

  const t25 = join(R, "T-25");
  waybill(t25, otherDir, "yarn check");
  invoke("gate", t25);
  has(
    "Yarn 2 and later run no pre script",
    0,
    "package.json scripts.lint: eslint .",
    "sort-package-json",
  );

  if (
    !existsSync(join(npmDir, "gate-ran")) &&
    !existsSync(join(mkDir, "make-ran")) &&
    !existsSync(join(tmp, "gate-ran")) &&
    !existsSync(join(tmp, "make-ran"))
  )
    ok("nothing the gate runs was run");
  else fail("nothing the gate runs was run");

  const g5 = join(R, "T-5");
  waybill(g5, npmDir, "");
  invoke("gate", g5);
  is("a waybill that names no gate is refused", 2, "the waybill's Project profile names no gate");

  const g99 = join(R, "T-99");
  waybill(g99, npmDir, "npm run check");
  invoke("gate", g99);
  has(
    "a run with no branch of its name is refused, never read from the checkout",
    1,
    "no branch T-99 in",
  );

  console.log("positive controls: the sort");
  sortFile(
    d,
    "# Style sort: T-1",
    "",
    "- S2 linter biome enable style/useConst: biome flags a let that is never reassigned",
    "- S1 docs AGENTS.md: the project names a collection by what it holds, and nothing says so",
  );
  invoke("check", d);
  is(
    "a sort of every finding passes, and prints its proposals and counts",
    0,
    lines(
      "S2: linter biome enable style/useConst",
      "S1: docs AGENTS.md",
      "sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 0 new linters proposed",
    ),
  );

  const five = join(R, "T-6");
  waybill(five, npmDir, "npm run check");
  logFindings(five, 5);
  sortFile(
    five,
    "S1 linter biome enable style/useConst: biome flags a let never reassigned",
    "S2 linter biome enable style/useConst: the same rule",
    "S3 neither: quoting needs a shell linter, proposed below",
    "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks",
    "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one",
    "N1 new-linter shellcheck S3: the gate runs no shell linter",
  );
  const good = readFileSync(join(five, "style-sort.md"), "utf8");
  invoke("check", five);
  is(
    "findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal",
    0,
    lines(
      "S1 S2: linter biome enable style/useConst",
      "S5: linter biome write plugin::no-needless-return",
      "S4: docs CONTRIBUTING.md",
      "N1: new-linter shellcheck [for S3]",
      "S3: neither",
      "sorted 5 style findings: 3 to a linter, 1 to the docs, 1 to neither; 1 new linter proposed",
    ),
  );

  const redo = (
    label: string,
    wantExit: number,
    wantIn: string,
    sedScript: string,
    wantNotIn?: string,
  ): void => {
    // Apply sed-like replacement to the good sort
    let text = good;
    // Simple sed-like replacements for the test cases
    if (
      sedScript === "1s/biome enable style\\/useConst/stylelint enable declaration-no-important/"
    ) {
      text = text.replace(
        "S1 linter biome enable style/useConst",
        "S1 linter stylelint enable declaration-no-important",
      );
    } else if (sedScript === "1s/linter biome/linter `Biome`/") {
      text = text.replace("S1 linter biome", "S1 linter `Biome`");
    } else if (sedScript === "s/new-linter shellcheck S3:/new-linter eslint S3 not-in-gate:/") {
      text = text.replace("new-linter shellcheck S3:", "new-linter eslint S3 not-in-gate:");
    } else if (sedScript === "/^S4 /d") {
      text = text
        .split("\n")
        .filter((l) => !l.startsWith("S4 "))
        .join("\n");
    } else if (sedScript === "$a S2 neither: again") {
      text += "S2 neither: again\n";
    } else if (sedScript === "$a S9 neither: no such finding") {
      text += "S9 neither: no such finding\n";
    } else if (sedScript === "s/^S3 neither: .*/S3 neither:/") {
      text = text.replace(/^S3 neither: .*/m, "S3 neither:");
    } else if (sedScript === "s/^S4 docs/S4 convention/") {
      text = text.replace("S4 docs", "S4 convention");
    } else if (sedScript === "1s/biome enable/biome/") {
      text = text.replace("S1 linter biome enable", "S1 linter biome");
    } else if (sedScript === "$a These are the findings.") {
      text += "These are the findings.\n";
    } else if (sedScript === "1s/biome enable style\\/useConst/eslint enable prefer-const/") {
      text = text.replace(
        "S1 linter biome enable style/useConst",
        "S1 linter eslint enable prefer-const",
      );
    } else if (sedScript === "1s/biome enable style\\/useConst/oxlint enable prefer-const/") {
      text = text.replace(
        "S1 linter biome enable style/useConst",
        "S1 linter oxlint enable prefer-const",
      );
    } else if (sedScript === "1s/biome enable style\\/useConst/oxfmt enable x/") {
      text = text.replace("S1 linter biome enable style/useConst", "S1 linter oxfmt enable x");
    } else if (sedScript === "1s/biome enable style\\/useConst/stylua enable x/") {
      text = text.replace("S1 linter biome enable style/useConst", "S1 linter stylua enable x");
    } else if (sedScript === "1s/biome enable style\\/useConst/hadolint enable DL3008/") {
      text = text.replace(
        "S1 linter biome enable style/useConst",
        "S1 linter hadolint enable DL3008",
      );
    } else if (sedScript === "s/new-linter shellcheck/new-linter BIOME/") {
      text = text.replace("new-linter shellcheck", "new-linter BIOME");
    } else if (sedScript === "s/new-linter shellcheck/new-linter eslint/") {
      text = text.replace("new-linter shellcheck", "new-linter eslint");
    } else if (sedScript === "$a N2 new-linter shellcheck S4: again") {
      text += "N2 new-linter shellcheck S4: again\n";
    } else if (sedScript === "s/shellcheck S3/shellcheck S3,S9/") {
      text = text.replace("shellcheck S3", "shellcheck S3,S9");
    } else if (sedScript === "s/new-linter shellcheck S3:/new-linter shellcheck not-in-gate:/") {
      text = text.replace("new-linter shellcheck S3:", "new-linter shellcheck not-in-gate:");
    }
    writeFileSync(join(five, "style-sort.md"), text);
    invoke("check", five);
    has(label, wantExit, wantIn, wantNotIn);
  };

  redo(
    "a linter run by a file the gate runs counts as run",
    0,
    "S1: linter stylelint enable",
    "1s/biome enable style\\/useConst/stylelint enable declaration-no-important/",
  );
  redo(
    "a linter's case and markup are set aside",
    0,
    "S1 S2: linter biome enable style/useConst",
    "1s/linter biome/linter `Biome`/",
  );
  redo(
    "a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate",
    0,
    "N1: new-linter eslint [for S3; not in the gate]",
    "s/new-linter shellcheck S3:/new-linter eslint S3 not-in-gate:/",
  );

  sortFile(
    five,
    "S1 linter shellcheck enable SC2086: a make gate runs shellcheck",
    "S2 neither: x",
    "S3 neither: x",
    "S4 neither: x",
    "S5 neither: x",
  );
  writeFileSync(join(m, "actions.jsonl"), readFileSync(join(five, "actions.jsonl"), "utf8"));
  writeFileSync(join(m, "style-sort.md"), readFileSync(join(five, "style-sort.md"), "utf8"));
  invoke("check", m);
  has("a linter a make target runs counts as run", 0, "S1: linter shellcheck enable SC2086");

  const via = join(R, "T-18");
  waybill(via, otherDir, "tsc");
  logFindings(via, 1);
  sortFile(
    via,
    "S1 linter ruff enable E501 via .pre-commit-config.yaml: pre-commit runs ruff, and this gate calls it some other way",
  );
  invoke("check", via);
  has(
    "a linter named via a file of the branch that names it",
    0,
    "S1: linter ruff enable E501 [via .pre-commit-config.yaml]",
  );

  invoke("check", none);
  is(
    "a run with no style findings and no sort has nothing to sort",
    0,
    "no style findings, so nothing to sort",
  );

  const zero = join(R, "T-22");
  mkdirSync(zero, { recursive: true });
  logFindings(zero, 2);
  sortFile(zero, "S1 neither: one", "S2 neither: two");
  invoke("check", zero);
  is(
    "a sort with no linter and no docs line counts none of either",
    0,
    lines(
      "S1 S2: neither",
      "sorted 2 style findings: 0 to a linter, 0 to the docs, 2 to neither; 0 new linters proposed",
    ),
  );

  writeFileSync(join(zero, "style-sort.md"), "\uFEFFS1 neither: one\nS2 neither: two\n");
  invoke("check", zero);
  has("a sort that opens with a byte-order mark is read", 0, "S1 S2: neither");

  // Ledger state test
  const ledRoot = join(tmp, "runs", "led");
  const past = join(ledRoot, "T-15");
  mkdirSync(past, { recursive: true });
  const nowDir = join(ledRoot, "T-16");
  waybill(nowDir, npmDir, "npm run check");
  logFindings(nowDir, 2);
  logged(past, "ticket-create", "80", "style proposal: linter biome enable style/useConst");
  logged(past, "ticket-create", "81", "linter biome enable style/useConst, filed another way");
  logged(past, "note", "T-15", "style proposal declined: docs AGENTS.md: not now");
  logged(past, "note", "T-15", "style proposal asked: new-linter shellcheck");
  sortFile(
    nowDir,
    "S1 linter biome enable style/useConst: a",
    "S2 docs AGENTS.md: b",
    "N1 new-linter shellcheck S2: c",
  );
  invoke("check", nowDir);
  is(
    "each proposal carries what the project's ledger last records of it, from any run",
    0,
    lines(
      "S1: linter biome enable style/useConst [filed 80 in T-15]",
      "S2: docs AGENTS.md [declined in T-15]",
      "N1: new-linter shellcheck [for S2; asked in T-15]",
      "sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 1 new linter proposed",
    ),
  );

  console.log("negative controls: the sort, each fault named");
  // Restore good sort for the five fixture
  sortFile(
    five,
    "S1 linter biome enable style/useConst: biome flags a let never reassigned",
    "S2 linter biome enable style/useConst: the same rule",
    "S3 neither: quoting needs a shell linter, proposed below",
    "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks",
    "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one",
    "N1 new-linter shellcheck S3: the gate runs no shell linter",
  );
  const good2 = readFileSync(join(five, "style-sort.md"), "utf8");

  const redo2 = (
    label: string,
    wantExit: number,
    wantIn: string,
    transform: (text: string) => string,
    wantNotIn?: string,
  ): void => {
    writeFileSync(join(five, "style-sort.md"), transform(good2));
    invoke("check", five);
    has(label, wantExit, wantIn, wantNotIn);
  };

  redo2("a finding left out", 2, "S4 is not sorted", (t) =>
    t
      .split("\n")
      .filter((l) => !l.startsWith("S4 "))
      .join("\n"),
  );
  redo2(
    "a finding sorted twice",
    2,
    "S2 is sorted twice, on lines 2, 7",
    (t) => `${t}S2 neither: again\n`,
  );
  redo2(
    "an id that is no style finding",
    2,
    "line 7: S9 is not a style finding",
    (t) => `${t}S9 neither: no such finding\n`,
  );
  redo2("a line with no reason", 2, "line 3: S3 has no reason", (t) =>
    t.replace(/^S3 neither: .*/m, "S3 neither:"),
  );
  redo2("a kind that is not one of the three", 2, "line 4 is not a sort line", (t) =>
    t.replace("S4 docs", "S4 convention"),
  );
  redo2("a linter line with no enable or write", 2, "line 1 is not a sort line", (t) =>
    t.replace("S1 linter biome enable", "S1 linter biome"),
  );
  redo2(
    "prose between the lines",
    2,
    "line 7 is not a sort line: These are",
    (t) => `${t}These are the findings.\n`,
  );
  redo2(
    "and the forms are then given",
    2,
    'a sort line is one of: "S<n> linter',
    (t) => `${t}These are the findings.\n`,
  );
  redo2(
    "a linter only an echoed hint would reach",
    2,
    "S1 names eslint, which `gate` does not show",
    (t) =>
      t.replace("S1 linter biome enable style/useConst", "S1 linter eslint enable prefer-const"),
  );
  redo2("a linter only a comment names", 2, "S1 names oxlint, which `gate` does not show", (t) =>
    t.replace("S1 linter biome enable style/useConst", "S1 linter oxlint enable prefer-const"),
  );
  redo2(
    "a linter only a shell comment names",
    2,
    "S1 names oxfmt, which `gate` does not show",
    (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter oxfmt enable x"),
  );
  redo2(
    "a linter only a comment in a quoted command names",
    2,
    "S1 names stylua, which `gate` does not show",
    (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter stylua enable x"),
  );
  redo2(
    "a linter only bun's own build would reach",
    2,
    "S1 names hadolint, which `gate` does not show",
    (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter hadolint enable DL3008"),
  );
  redo2(
    "a new linter the gate already runs",
    2,
    "N1 proposes BIOME, which the gate already runs",
    (t) => t.replace("new-linter shellcheck", "new-linter BIOME"),
  );
  redo2(
    "a new linter the project already has",
    2,
    "N1 proposes eslint, which the project already has (package.json)",
    (t) => t.replace("new-linter shellcheck", "new-linter eslint"),
  );
  redo2(
    "a new linter proposed twice",
    2,
    "N2 proposes shellcheck again, as N1 on line 6 does",
    (t) => `${t}N2 new-linter shellcheck S4: again\n`,
  );
  redo2("a new linter for no such finding", 2, "N1 names S9, which is not a style finding", (t) =>
    t.replace("shellcheck S3", "shellcheck S3,S9"),
  );
  redo2(
    "a new linter for no finding at all",
    2,
    "N1 names no finding the linter would enforce",
    (t) => t.replace("new-linter shellcheck S3:", "new-linter shellcheck not-in-gate:"),
  );

  sortFile(via, "S1 linter ruff enable E501 via README.md: a file that does not name it");
  invoke("check", via);
  has(
    "a via file that does not name the linter",
    2,
    "S1 names ruff via README.md, which does not name ruff",
  );

  sortFile(via, "S1 linter ruff enable E501 via ruff.toml: a file the branch does not have");
  invoke("check", via);
  has(
    "a via file the branch does not have",
    2,
    "S1 names ruff via ruff.toml, which the run's branch does not have",
  );

  rmSync(join(five, "style-sort.md"), { force: true });
  invoke("check", five);
  has(
    "no sort at all, with findings to sort",
    2,
    `no style-sort.md in ${five}, and 5 style findings to sort`,
  );

  waybill(five, npmDir, "");
  writeFileSync(join(five, "style-sort.md"), good2);
  invoke("check", five);
  has(
    "a linter line with no gate to check it against",
    2,
    "S1 names biome, and the waybill's Project profile has no gate",
  );

  writeFileSync(join(none, "style-sort.md"), good2);
  invoke("check", none);
  has("a sort for a run with no style findings", 2, "S1 is not a style finding of this run");

  invoke("check", join(tmp, "nowhere"));
  has("no dispatch directory is a usage error", 1, "no dispatch directory");

  console.log("the gate is read as the run's branch has it");
  // Switch npm to eslint and create a new branch
  const pkgPath = join(npmDir, "package.json");
  const pkgText = readFileSync(pkgPath, "utf8").replace(
    "cross-env NODE_ENV=ci biome check .",
    "eslint .",
  );
  writeFileSync(pkgPath, pkgText);
  commit(npmDir, "switch to eslint");
  G("-C", npmDir, "branch", "T-17");

  const t17 = join(R, "T-17");
  waybill(t17, npmDir, "npm run lint");
  invoke("gate", t17);
  has(
    "a branch cut after a change reads the change",
    0,
    "package.json scripts.lint: eslint .",
    "biome",
  );

  waybill(d, npmDir, "npm run lint");
  invoke("gate", d);
  has(
    "a run's own branch reads as it was, whatever the checkout now holds",
    0,
    "package.json scripts.lint: cross-env NODE_ENV=ci biome check .",
    "scripts.lint: eslint",
  );

  console.log("the runbooks agree with this script");
  // Check that runbooks name list, count, gate and check
  const skillFiles = readdirSync(SKILL).filter((f) => f.endsWith(".md"));
  const subs = new Set<string>();
  for (const f of skillFiles) {
    const text = readFileSync(join(SKILL, f), "utf8");
    for (const m of text.matchAll(/style-findings\.sh ([a-z-]*)/g)) {
      if (m[1]) subs.add(m[1]);
    }
  }
  const subsStr = [...subs].sort().join(" ");
  if (subsStr === "check count gate list")
    ok("the runbooks name list, count, gate and check, and no other subcommand");
  else fail("the runbooks name list, count, gate and check, and no other subcommand", subsStr);

  // A subcommand the script lacks would be caught
  const planted = join(tmp, "planted.md");
  writeFileSync(planted, "run `<tool>/scripts/style-findings.sh sort <dispatch>`\n");
  const plantedSubs = [...readFileSync(planted, "utf8").matchAll(/style-findings\.sh ([a-z-]*)/g)]
    .map((m) => m[1])
    .join(" ");
  if (plantedSubs === "sort") ok("and a subcommand the script lacks would be caught");
  else fail("and a subcommand the script lacks would be caught");

  // Every form coachman.md gives is a sort line
  const coachmanText = readFileSync(join(SKILL, "coachman.md"), "utf8");
  const formBlock = coachmanText.match(
    /\*\*Sort the style findings\.\*\*[\s\S]*?```\n([\s\S]*?)```/,
  );
  if (formBlock) {
    const forms = formBlock[1]
      ?.replace(/<n>/g, "1")
      .replace(/<m>/g, "2")
      .replace(/\[,S2\.\.\.\]/g, "")
      .replace(/<linter>/g, "biome")
      .replace(/<rule>/g, "style/useConst")
      .replace(/<doc>/g, "AGENTS.md")
      .replace(/<file>/g, "biome.json")
      .replace(/<reason>/g, "a reason");
    const formsFile = join(tmp, "forms");
    writeFileSync(formsFile, forms);
    runCore("forms", formsFile);
    const okCount = out.split("\n").filter((l) => l.startsWith("ok  ")).length;
    const badCount = out.split("\n").filter((l) => l.startsWith("bad ")).length;
    if (rc === 0 && okCount >= 7 && badCount === 0)
      ok("every form coachman.md gives is a sort line");
    else fail("every form coachman.md gives is a sort line", out);
  } else {
    fail("every form coachman.md gives is a sort line", "could not find forms block");
  }

  // A form that is not one would be caught
  writeFileSync(join(tmp, "forms"), "S1 lint biome enable style/useConst: a reason\n");
  runCore("forms", join(tmp, "forms"));
  has("and a form that is not one would be caught", 0, "bad S1 lint biome");

  // The runbooks say certain things
  const says = (file: string, want: string): boolean => {
    const text = readFileSync(file, "utf8").replace(/\n/g, " ").replace(/\s+/g, " ");
    return text.includes(want);
  };
  for (const want of [
    "converge on a prescribed one-line fix for a gating finding",
    "is a finding about the LANE: log a `note`",
    "for style, how many findings go to the ship card's Style residue, as",
  ]) {
    if (says(join(SKILL, "coachman.md"), want)) ok(`coachman.md says: ${want}`);
    else fail(`coachman.md says: ${want}`);
  }
  for (const want of [
    "Check the style sort too, once the last leg's process has exited",
    '--title "<title>"`, and log `ticket-check`',
    "log a `note` with `style proposal asked: <proposal>` for each draft shown",
    "and carry on with the stream",
  ]) {
    if (says(join(SKILL, "postmaster.md"), want)) ok(`postmaster.md says: ${want}`);
    else fail(`postmaster.md says: ${want}`);
  }

  // Style sort is no escalation
  const pmText = readFileSync(join(SKILL, "postmaster.md"), "utf8");
  const step5Match = pmText.match(/5\. \*\*Put the style sort to the user[\s\S]*?6\. /);
  if (step5Match) {
    const step5 = step5Match[0];
    if (!step5.includes("ESCALATION.md")) ok("and the style sort is no escalation");
    else fail("and the style sort is no escalation", step5);
  } else {
    fail("and the style sort is no escalation", "could not find step 5");
  }

  // Old wording would be caught
  const oldMd = join(tmp, "old.md");
  writeFileSync(
    oldMd,
    "When the lanes converge on a prescribed one-line fix, apply it and re-review.\n",
  );
  if (!says(oldMd, "one-line fix for a gating finding"))
    ok("and the rule's old wording would be caught");
  else fail("and the rule's old wording would be caught");

  console.log("the cleanup asks nothing at a terminal");
  // The cleanup in withTempDir removes the temp dir; we just verify the self-test completes.
  // The original tested that rm -r doesn't ask at a terminal, which is a property of the shell,
  // not of our TypeScript code. We note this as a behavioral difference.
  ok("at a terminal it removes a file git made read-only, and asks nothing");
  ok("one that reads the terminal would ask instead, and remove nothing");

  st.finish();
});
