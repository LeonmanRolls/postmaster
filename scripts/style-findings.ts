// A run's style findings. They gate nothing: the review leg logs them and applies none, the ship
// card counts them, and aftercare sorts each into a rule for a linter the project's gate runs, a
// convention for the project's own docs, or neither. The postmaster puts the sort to the user
// after the merge.
//
//   run style-findings list <dispatch>    each style finding: its id, where it is, the rest of its line
//   run style-findings count <dispatch>   how many style findings the run has
//   run style-findings gate <dispatch>    what the gate runs, as the run's branch has it
//   run style-findings check <dispatch>   whether <dispatch>/style-sort.md sorts every style finding
//
//   exit 0  printed
//   exit 1  usage; no waybill, action log, or branch named for the run; a file that cannot be read
//   exit 2  list/count: a finding whose class is neither gating nor style. gate: the waybill
//           names no gate, or no repo that exists. check: a finding with neither class; no sort,
//           with style findings to sort; or a sort that is wrong.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { run } from "./lib/proc.ts";
import { thrownCode, thrownMessage } from "./lib/thrown.ts";
import {
  BOUND_R,
  DOT_ALL,
  digitValue,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyTrim,
  pyWords,
  W_CLASS,
} from "./lib/text.ts";

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
    return readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  } catch (e) {
    if (thrownCode(e) === "ENOENT") die(`no ${what} at ${path}`);
    die(`cannot read ${path}: ${thrownMessage(e) ?? "error"}`);
  }
}

function plain(word: string): string {
  return word.replace(/^[`*_"]+|[`*_"]+$/gu, "");
}

function named(name: string, text: string): boolean {
  const re = new RegExp(
    `(?<![A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9_-])`,
    "iu",
  );
  return re.test(text);
}

export const JSTARS = new RegExp("^[" + PY_S_CLASS + "]*\\*", "u");
export const JSCOM = new RegExp(
  "(^|[" + PY_S_CLASS + "])\\/\\/(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const SHCOM = new RegExp(
  "(^|[" + PY_S_CLASS + "])[#;](" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const JALIAS = new RegExp(
  "^alias[" +
    PY_S_CLASS +
    "]+([" +
    W_CLASS +
    "-]+)[" +
    PY_S_CLASS +
    "]*:=[" +
    PY_S_CLASS +
    "]*([" +
    W_CLASS +
    "-]+)",
  "u",
);
export const JVAR = new RegExp(
  "^(?:export[" +
    PY_S_CLASS +
    "]+)?([A-Za-z_][" +
    W_CLASS +
    "-]*)[" +
    PY_S_CLASS +
    "]*:=[" +
    PY_S_CLASS +
    "]*(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
export const JRECIPE = new RegExp(
  "^@?([A-Za-z_][" +
    W_CLASS +
    "-]*)" +
    BOUND_R +
    "[^:]*:(?!=)(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
export const JDEPS = new RegExp("[A-Za-z_][" + W_CLASS + "-]*", "gu");
export const MAKEINC = new RegExp(
  "^(?:-include|sinclude|include)[" + PY_S_CLASS + "]+(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const RULE = new RegExp(
  "^([^:=]+?)[" + PY_S_CLASS + "]*::?(?!=)(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const YPKGS = new RegExp("^packages[" + PY_S_CLASS + "]*:", "u");
export const YITEM = new RegExp("^[" + PY_S_CLASS + "]+-[" + PY_S_CLASS + "]*", "u");
export const YOUT = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]+-[" +
    PY_S_CLASS +
    "]*|[" +
    PY_S_CLASS +
    "]+#(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "gu",
);
export const YIND = new RegExp("^[" + PY_S_CLASS + "]", "u");
export const MVER = /^\p{Nd}+(\.\p{Nd}+)?$/u;
export const MUSTACHE = new RegExp(
  "\\{\\{[" + PY_S_CLASS + "]*([A-Za-z_][" + W_CLASS + "-]*)[" + PY_S_CLASS + "]*\\}\\}",
  "gu",
);
export const COVERSPLIT = new RegExp("[," + PY_S_CLASS + "]+" + "", "u");
export const YARNRE = /^yarn@(\p{Nd}+)/u;
export const MENDEF = new RegExp("^[" + PY_S_CLASS + "]*endef" + BOUND_R + "", "u");
export const MIFCOND = new RegExp("^(?:ifeq|ifneq|ifdef|ifndef|else|endif)" + BOUND_R + "", "u");
export const MDEFINE = new RegExp(
  "^(?:(?:export|override)[" + PY_S_CLASS + "]+)*define" + BOUND_R + "",
  "u",
);

function stripJs(text: string): string {
  // text.ts: [\s\S] is every char in both languages; DOT_ALL spells it bare.
  text = text.replace(new RegExp("/\\*" + DOT_ALL + "*?" + "\\*/", "gu"), " ");
  return text
    .split("\n")
    .filter((l) => !JSTARS.test(l))
    .map((l) => l.replace(JSCOM, "$1"))
    .join("\n");
}

function configText(text: string, path: string): string {
  if (/\.[cm]?[jt]s$/u.test(path)) return stripJs(text);
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((l) => l.replace(SHCOM, "$1"))
    .join("\n");
}

// --- glob matching (fnmatch.fnmatchcase) ---------------------------------------------------
function fnmatchCase(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*")
        .replace(/\?/gu, ".") +
      "$",
    "u",
  );
  return re.test(name);
}

// --- the run's findings -----------------------------------------------------------------------
interface Finding {
  id: string;
  target: string;
  rest: string;
}

export function findings(dispatch: string): { style: Finding[]; faults: string[] } {
  const path = join(dispatch, "actions.jsonl");
  const latest = new Map<string, { cls: string; rest: string }>();
  const faults: string[] = [];
  const text = read(path, "action log");
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line.trim() === "") continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      die(`${path} line ${n + 1} is not JSON`);
    }
    if (!e || typeof e !== "object" || e.action !== "finding") continue;
    // text.ts: BASE words = str(detail).split(None, 1); first-word + rest.
    const words = pyWords(String(e.detail ?? ""));
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

export function field(line: string, key: string, stops: string[]): string | null {
  // text.ts: BASE re.match(r"\s*(?:[-*+]\s+)?MARK key MARK\s*:MARK(.*)$", re.I).
  const m = new RegExp(
    `[${PY_S_CLASS}]*(?:[-*+][${PY_S_CLASS}]+)?${MARK}${key}${MARK}[${PY_S_CLASS}]*:${MARK}(${PY_DOT}*)${END_OF_STRING}`,
    "iu",
  ).exec(line);
  if (!m) return null;
  let v = m[1] ?? "";
  const stopPat = stops.map((s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const nxt = new RegExp(
    `[${PY_S_CLASS}]+${MARK}(?:${stopPat})${MARK}[${PY_S_CLASS}]*:${MARK}(?=[${PY_S_CLASS}]|${END_OF_STRING})`,
    "iu",
  ).exec(v);
  if (nxt) v = v.slice(0, nxt.index);
  v = pyTrim(v);
  if (v.length > 1 && v[0] === "`" && v[v.length - 1] === "`") v = pyTrim(v.slice(1, -1));
  return v;
}

function profile(dispatch: string): { repo: string | null; gate: string | null } {
  const lines = read(join(dispatch, "brief.md"), "waybill").split("\n");
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}##[ \t]+project profile[ \t:#]*\r?$/iu.test(lines[i]!)) heads.push(i);
  }
  let repo: string | null = null;
  let gate: string | null = null;
  const start = heads.length > 0 ? heads[heads.length - 1]! + 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^ {0,3}#{1,2}(?:[ \t]|\r?$)/u.test(l)) break;
    const r = field(l, "repo", ["default branch", "BASE"]);
    const g = field(l, "gate", ["build", "browser suite"]);
    if (repo === null && r !== null) repo = r;
    if (gate === null && g !== null) gate = g;
  }
  return {
    repo: repo || null,
    gate: gate && pyLower(gate) !== "none" ? gate : null,
  };
}

// --- the repo, as the run's branch has it -------------------------------------------------------
function git(repo: string, ...args: string[]): string | null {
  const r = run("git", ["-C", repo, ...args], { timeout: 120000 });
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
      // ASCII: git ls-tree --format prints mode, blob-sha and path tab-separated in ASCII.
      const f = meta.split(/\s+/u);
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
      this.cache.set(p, ok ? data?.replace(/^\uFEFF/u, "") : null);
    }
    return this.cache.get(p) ?? null;
  }

  glob(cwd: string, pattern: string): string[] {
    const q = this.path(cwd, pattern);
    if (q === null) return [];
    if (!/[*?[]/u.test(q)) return this.blobs.has(q) ? [q] : [];
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
  line = line.replace(/\$\(MAKE\)|\$\{MAKE\}/gu, "make");
  line = line.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^{}]*)\}/gu, "$1");
  for (let i = 0; i < 10; i++) {
    const next = line.replace(/\$\(([^()]*)\)/gu, "$1");
    if (next === line) break;
    line = next;
  }
  return line.replace(/\$\{[^{}]*\}/gu, "_").replace(/`/gu, " ");
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
    if (SHELL_WORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(w)) {
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
    // text.ts: BASE strips justfile lines with Python whitespace.
    if (
      current !== null &&
      (line.startsWith(" ") || line.startsWith("\t") || pyTrim(line) === "")
    ) {
      if (pyTrim(line)) recipes.get(current)?.body.push(pyTrim(line));
      continue;
    }
    current = null;
    const s = pyTrim(line);
    if (
      !s ||
      s.startsWith("#") ||
      s.startsWith("[") ||
      s.startsWith("set ") ||
      s.startsWith("import ") ||
      s.startsWith("mod ")
    )
      continue;
    let m = JALIAS.exec(s);
    if (m) {
      recipes.set(m[1]!, { deps: [m[2]!], body: [] });
      continue;
    }
    m = JVAR.exec(s);
    if (m) {
      vars.set(m[1]!, m[2]?.trim().replace(/^['"]|['"]$/gu, ""));
      continue;
    }
    m = JRECIPE.exec(s);
    if (m) {
      current = m[1]!;
      const deps = m[2]?.replace(/\([^)]*\)/gu, "").match(JDEPS) ?? [];
      recipes.set(current, { deps, body: [] });
      if (first === null) first = current;
    }
  }
  return { recipes, vars, first };
}

// --- makefile parsing ---------------------------------------------------------------------------
export class Makefile {
  t: Tree;
  path: string;
  cwd: string;
  vars: Map<string, string>;
  rules: Map<string, { prereqs: string[]; recipe: string[] }>;
  fixed: Set<string>;
  first: string | null = null;
  goal: string;

  // text.ts: BASE ASSIGN splits Python whitespace; values bar only LF.
  static ASSIGN = new RegExp(
    "^(?:(?:export|override)[" +
      PY_S_CLASS +
      "]+)*([A-Za-z0-9_.-]+)[" +
      PY_S_CLASS +
      "]*(:{1,3}=|[?+!]?=)[" +
      PY_S_CLASS +
      "]*(" +
      PY_DOT +
      "*)" +
      END_OF_STRING +
      "",
    "u",
  );

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
      .replace(/\$\$/gu, "\0")
      .replace(/\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}/gu, (m, p1, p2) =>
        one(m, p1 ?? "", p2 ?? ""),
      )
      .replace(/\0/gu, "$$");
  }

  recipe(line: string): string {
    return this.expand(line.replace(new RegExp("^[" + PY_S_CLASS + "]*[@+-]*", "u"), "")).replace(
      /\$\$/gu,
      "$",
    );
  }

  read(path: string, depth: number): void {
    const text = this.t.read(path);
    let current: string[] | null = null;
    let define = false;
    for (const line of (text ?? "").replace(/\\\r?\n/gu, " ").split("\n")) {
      if (define) {
        define = !MENDEF.test(line);
        continue;
      }
      if (line.startsWith("\t")) {
        for (const t of current ?? []) {
          this.rules.get(t)?.recipe.push(line.slice(1));
        }
        continue;
      }
      const s = line.replace(/(?<!\\)#.*$/u, "").trim();
      if (!s || MIFCOND.test(s)) continue;
      if (MDEFINE.test(s)) {
        define = true;
        current = null;
        continue;
      }
      let m = MAKEINC.exec(s);
      if (m) {
        for (const inc of pyWords(this.expand(m[1]!))) {
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
            this.vars.set(name!, pyTrim(`${this.vars.get(name!) ?? ""} ${value!}`));
          } else {
            this.vars.set(name!, op?.startsWith(":") ? this.expand(value!) : value!);
          }
        }
        current = null;
        continue;
      }
      m = RULE.exec(s);
      if (!m || Makefile.ASSIGN.test(pyTrim(m[2] ?? ""))) {
        current = null;
        continue;
      }
      const [_, targets, rest] = m;
      const semiIdx = rest?.indexOf(";");
      const prereqs = semiIdx >= 0 ? rest?.slice(0, semiIdx) : rest!;
      const inline = semiIdx >= 0 ? pyTrim(rest?.slice(semiIdx + 1) ?? "") : "";
      current = pyWords(this.expand(targets!));
      for (const t of current) {
        if (!this.rules.has(t)) this.rules.set(t, { prereqs: [], recipe: [] });
        this.rules.get(t)?.prereqs.push(...pyWords(this.expand(prereqs)).filter((p) => p !== "|"));
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
    for (const raw of text.replace(/\\\r?\n/gu, " ").split("\n")) {
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
        if (/[ \t\r\n]/u.test(w)) this.scan(where, w, cwd);
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
    const m = YARNRE.exec(pm);
    return (m ? Number(digitValue(m[1]!)) >= 2 : false) || this.t.blobs.has(".yarnrc.yml");
  }

  workspaces(): string[] {
    const globs: string[] = [];
    let w: unknown = this.package("").workspaces;
    if (w && typeof w === "object" && !Array.isArray(w))
      w = (w as Record<string, unknown>).packages;
    if (Array.isArray(w))
      globs.push(...w.filter((g: unknown): g is string => typeof g === "string"));
    if (this.t.blobs.has("lerna.json")) {
      try {
        const v: unknown = (JSON.parse(this.t.read("lerna.json") ?? "") as Record<string, unknown>)
          .packages;
        if (Array.isArray(v))
          globs.push(...v.filter((g: unknown): g is string => typeof g === "string"));
      } catch {
        /* ignore */
      }
    }
    if (this.t.blobs.has("pnpm-workspace.yaml")) {
      let inside = false;
      for (const l of (this.t.read("pnpm-workspace.yaml") ?? "").split("\n")) {
        if (YPKGS.test(l)) inside = true;
        else if (inside && YITEM.test(l))
          globs.push(
            l
              .replace(YOUT, "")
              .trim()
              .replace(/^['"]|['"]$/gu, ""),
          );
        else if (inside && l.trim() && !YIND.test(l)) inside = false;
      }
    }
    const keep = globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/\/$/u, ""));
    const drop = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1).replace(/\/$/u, ""));
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
      .replace(/^\.\.\.|\.\.\.$/gu, "")
      .replace(/^\{|\}$/gu, "")
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
    const parts = pattern.match(/\*\*|\*|\?|[^*?]+/gu) ?? [];
    const patSrc = parts
      .map((t) =>
        t === "**"
          ? ".*"
          : t === "*"
            ? "[^:]*"
            : t === "?"
              ? "[^:]"
              : t.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      )
      .join("");
    const pat = new RegExp(`${patSrc}$`, "u");
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
        MVER.test(args[i + 1]!)
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
    const { recipes, first } = this.justs.get(p)!;
    let d = wd ? this.t.dir(cwd, wd) : null;
    if (d === null) d = posix.dirname(p);
    const toRun = names.filter((n) => recipes.has(n));
    for (const n of toRun.length > 0 ? toRun : first ? [first] : []) {
      this.recipe(p, n, d);
    }
  }

  recipe(p: string, n: string, d: string): void {
    const { recipes, vars } = this.justs.get(p)!;
    const key = `just|${p}|${n}`;
    if (this.seen.has(key) || !recipes.has(n)) return;
    this.seen.add(key);
    const { deps, body } = recipes.get(n)!;
    for (const dep of deps) this.recipe(p, dep, d);
    for (let line of body) {
      line = line.replace(MUSTACHE, (_, name) => vars.get(name) ?? `{{${name}}}`);
      this.shell(`${p} ${n}`, line.replace(/^[@-]+/u, ""), d);
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
      this.shell(p, /\.[cm]?[jt]sx?$/u.test(p) ? stripJs(text) : text, cwd, true);
    }
  }

  runs(linter: string): string | null {
    for (const { where, words } of this.cmds) {
      if (words.some((w) => !/[ \t\r\n]/u.test(w) && named(linter, w))) return where;
    }
    for (const { where, text } of this.texts) {
      if (named(linter, text)) return where;
    }
    return null;
  }
}

// --- linter detection ---------------------------------------------------------------------------
const MANIFESTS =
  /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|tox\.ini|requirements[^/]*\.txt|Pipfile|Gemfile|go\.mod|Cargo\.toml|composer\.json|\.pre-commit-config\.ya?ml|\.tool-versions|mise\.toml)$/u;

function hasLinter(tree: Tree, linter: string): string | null {
  const own = new RegExp(
    `\\.?${linter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(rc)?([._-].*)?$`,
    "iu",
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
      .replace(/^\uFEFF/u, "")
      .split("\n");
  } catch {
    return out;
  }
  for (const row of rows) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(row) as Record<string, unknown>;
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
const ENTRY = new RegExp(
  "^(?:[-*+][ \t]+)?(S\\p{Nd}+|N\\p{Nd}+)[ \t]+(" +
    PY_DOT +
    "+?):(?:[ \t]+(" +
    PY_DOT +
    "*))?" +
    END_OF_STRING +
    "",
  "u",
);

export function shape(line: string): { id: string; head: string[]; reason: string } | null {
  const m = ENTRY.exec(line);
  if (!m) return null;
  const i = m[1]!;
  const head = pyWords(m[2] ?? "");
  const reason = pyTrim(m[3] ?? "");
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
export function core(cmd: string, dispatch: string): number {
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
  const checks: Array<
    | { n: number; id: string; kind: "linter"; lint: string; extra: string | null }
    | { n: number; id: string; kind: "new"; lint: string; extra: boolean }
  > = [];
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
          key: `linter ${pyLower(lint)} ${head[2]} ${plain(head[3]!)}`,
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
    const covers = (marked ? rest.slice(0, -1) : rest).join(" ").split(COVERSPLIT).filter(Boolean);
    if (covers.length === 0)
      faults.push(`line ${n + 1}: ${i} names no finding the linter would enforce`);
    for (const c of covers) {
      if (!ids.includes(c))
        faults.push(`line ${n + 1}: ${i} names ${c}, which is not a style finding of this run`);
    }
    const lint = plain(head[1]!);
    const was = firstNew.get(pyLower(lint));
    if (was && (was[0] !== n + 1 || was[1] !== i)) {
      faults.push(
        `line ${n + 1}: ${i} proposes ${lint} again, as ${was[1]} on line ${was[0]} does: propose it once, for every finding it would enforce`,
      );
    }
    if (!was) firstNew.set(pyLower(lint), [n + 1, i]);
    checks.push({ n: n + 1, id: i, kind: "new", lint, extra: marked });
    props.push({
      id: i,
      key: `new-linter ${pyLower(lint)}`,
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
if (import.meta.main) {
  if (sub === "list" || sub === "count" || sub === "gate" || sub === "check") {
    if (argv.length !== 2) {
      console.error("usage: run style-findings list|count|gate|check <dispatch>");
      process.exit(1);
    }
    const d = argv[1]!;
    if (!existsSync(d)) {
      console.error(`style-findings: no dispatch directory at ${d}`);
      process.exit(1);
    }
    process.exit(core(sub, d));
  } else {
    console.error("usage: run style-findings list|count|gate|check <dispatch>");
    process.exit(1);
  }
}
