// Turn the faults a run met in postmaster itself into tickets on postmaster's own tracker, once
// the run has closed. A run never fixes postmaster: each fault is logged as it happens, as a
// `tool-fault` action (scripts/log-action.sh), and this script collects them afterwards.
//
//   tool-faults.sh harvest <dispatch>
//   tool-faults.sh comment <dispatch> <id> [<ticket>]
//   tool-faults.sh file <dispatch> <id>
//   tool-faults.sh decline <dispatch> <id> <word>
//
//   exit 0  done; harvest prints a line for the run, then one per fault, then any notes
//   exit 1  usage; no such dispatch, fault or draft; a run still open; the tracker could not
//           be read or refused a write; or the log could not be written
//   exit 2  comment or file refused: a changed draft is not safe to publish, a draft fails
//           scripts/ticket-check.sh, a fault to comment on has no ticket, or one to file has one

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import {
  casefold,
  END_OR_BEFORE_NL,
  isDigit,
  isDigitChar,
  literalI,
  NAME_L,
  NAME_R,
  PY_DOT,
  PY_M_END,
  PY_M_START,
  PY_S_CLASS,
  pyRstrip,
  pySplitLines,
  pyTrim,
  pyWords,
  WORD_CHAR_RE,
  WORD_CLASS,
  WORD_RUN_RE,
} from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
// text.ts: BOUND_R — BASE's trailing \b after the run id.
export const DONE_RE =
  /^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)(?![\p{L}\p{N}_])/u;

// text.ts: BOUND_R — harvest-output normalizer for the test suite's
// BASE-vs-port comparisons (run ids end at a Unicode boundary).
// File-scope so the pattern-parity suite diffs these exact objects.
export const TICKET_RE = /^#?\p{Nd}+$/u; // text.ts: BASE fullmatches #?\d+ in Unicode.
export const STATE_RE = new RegExp(`${PY_M_START}state: ([^${PY_S_CLASS}]+)`, "mu");
export const RURL_M1 =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\p{Nd}+)?\/+([^\n]*?)(?:\.git)?\/?$/u;
export const RURL_M2 = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)([^\n]*?)(?:\.git)?\/?$/u;

export function fidBoundaryRe(fid: string): RegExp {
  // text.ts: BASE's [\w-] lookarounds are Unicode; \w needs the \p spelling.
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])${fid.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}_-])`,
    "u",
  );
}

// text.ts: BASE's re.M ^/$ split \n only; its \S and dots are Python's.
export const PROFILE_HEAD_RE = new RegExp(
  `${PY_M_START}## Project profile[ \\t]*${PY_M_END}`,
  "gmu",
);
export const PROFILE_END_RE = new RegExp(`${PY_M_START}## `, "mu");
export const CONTROLS_VALUE_RE = /^[\p{L}\p{N}_-]+$/u; // text.ts: BASE's [\w-] is Unicode.
export const PROFILE_REPO_RE = new RegExp(
  `${PY_M_START}repo:[ \\t]*([^${PY_S_CLASS}]${PY_DOT}*?)(?:[ \\t]{2,}[^${PY_S_CLASS}]${PY_DOT}*)?[ \\t]*${PY_M_END}`,
  "mu",
);
const ASKING = new Set(["new", "asked", "unchecked", "kept"]);

function dieTF(msg: string, code = 1): never {
  console.error(`tool-faults: ${msg}`);
  process.exit(code);
  throw new Error("unreachable");
}

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function newId(): string {
  while (true) {
    const rid = randomBytes(5).toString("hex");
    // ASCII: rid is machine hex (token_hex), so \d never meets Unicode.
    if (/\d/.test(rid)) return rid;
  }
}

function seen(n: number): string {
  return n === 1 ? "once" : `${n} times`;
}

function gitCmd(where: string, ...args: string[]): string {
  const r = run("git", ["-C", where, ...args]);
  // text.ts: BASE's git() strips Python whitespace.
  return r.code === 0 ? pyTrim(r.out) : "";
}

function whyR(r: { code: number; out: string; err: string }): string {
  // text.ts: BASE's why() is strip().splitlines()[-1].
  const lines = pySplitLines(pyTrim(r.err || r.out));
  return lines.length > 0 ? lines[lines.length - 1]! : `exit ${r.code}`;
}

function readLog(logPath: string): { entries: Array<Record<string, unknown>>; bad: number[] } {
  const entries: Array<Record<string, unknown>> = [];
  const bad: number[] = [];
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return { entries, bad };
  }
  const _str = Buffer.isBuffer(text) ? text.toString("utf-8") : String(text);
  // decode with replacement
  const decoded = Buffer.from(text as any).toString("utf-8");
  const lines = decoded.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? "";
    // text.ts: BASE skips lines blank under Python strip (split stays \n:
    // only a newline ends a line, on both sides).
    if (!pyTrim(line)) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object") entries.push(e as Record<string, unknown>);
      else bad.push(n + 1);
    } catch {
      bad.push(n + 1);
    }
  }
  return { entries, bad };
}

export function fields(e: Record<string, unknown>): Record<string, string> {
  const f = e.fault;
  return f && typeof f === "object" ? (f as Record<string, string>) : {};
}

function tidy(text: string): string {
  // text.ts: BASE's " ".join(text.split()) splits Python whitespace.
  return pyWords(text).join(" ");
}

function clip(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]+$/u, "")}...`;
}

// --- run helpers -------------------------------------------------------------------------------

export interface RunR {
  code: number;
  out: string;
  err: string;
}

function runCmd(argv: string[]): RunR {
  const r = run(argv[0]!, argv.slice(1));
  return { code: r.code, out: r.out, err: r.err };
}

// --- state helpers -----------------------------------------------------------------------------

function closedCheck(d: string, ongoing: boolean): void {
  if (ongoing) return;
  let stage: string;
  try {
    const m = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
    stage = m.stage ?? "";
  } catch {
    dieTF(`${d} has no manifest to read`);
  }
  if (stage !== "done" && stage !== "abandoned") {
    dieTF(`the run is still open (stage ${stage}); its faults are harvested when it closes`);
  }
}

function loadState(statePath: string): Record<string, any> {
  try {
    const st = JSON.parse(readFileSync(statePath, "utf8"));
    return st && typeof st === "object" ? st : {};
  } catch {
    return {};
  }
}

function saveState(statePath: string, st: Record<string, any>): void {
  const tmp = mkstempSync(dirname(statePath), "tmp");
  writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`);
  renameSync(tmp, statePath);
}

function postmasterRun(runJsonPath: string): Record<string, any> {
  try {
    const pm = JSON.parse(readFileSync(runJsonPath, "utf8")).postmaster;
    return pm && typeof pm === "object" ? pm : {};
  } catch {
    return {};
  }
}

function ownIds(st: Record<string, any>, runJsonPath: string): Set<string> {
  const commit = String(postmasterRun(runJsonPath).commit || "");
  const ids = new Set<string>();
  for (const r of st.runs || []) {
    if (r.run_id) ids.add(String(r.run_id));
  }
  if (commit) {
    ids.add(commit);
    ids.add(commit.slice(0, 12));
  }
  return ids;
}

function metaStr(runJsonPath: string): string {
  const pm = postmasterRun(runJsonPath);
  if (!pm.commit) return "";
  return `, which ran postmaster ${String(pm.commit).slice(0, 12)}${pm.uncommitted_changes ? " with uncommitted changes" : ""}`;
}

// --- whose repository is whose ------------------------------------------------------------------

function ownCheckout(): boolean {
  const top = gitCmd(TOOL, "rev-parse", "--show-toplevel");
  if (!top) return false;
  try {
    return realpathSync(top) === realpathSync(TOOL);
  } catch {
    return false;
  }
}

function commonDir(where: string): string {
  const out = gitCmd(where, "rev-parse", "--git-common-dir");
  if (!out || out.includes("\n")) return "";
  try {
    return realpathSync(join(where, out));
  } catch {
    return "";
  }
}

export function remoteUrl(where: string): [string, string] | null {
  const url = gitCmd(where, "remote", "get-url", "origin");
  if (!url) return null;
  // text.ts: BASE's port is \d (Unicode); its dots bar only \n.
  const m1 = url.match(RURL_M1);
  const m2 = url.match(RURL_M2);
  const m = m1 || m2;
  // LOWER: BASE's own .lower() on the host, ported exactly, never folded.
  if (m?.[2]) return [m[1]?.toLowerCase(), m[2]!];
  return ["", url.replace(/\/+$/u, "")];
}

function sameRepo(repo: string): boolean {
  if (!ownCheckout()) return false;
  const a = commonDir(repo);
  const b = commonDir(TOOL);
  if (a && a === b) return true;
  const ra = remoteUrl(repo);
  const rb = remoteUrl(TOOL);
  return !!(ra && rb && ra[0] && ra[0] === rb[0] && casefold(ra[1]) === casefold(rb[1]));
}

export function profileRepo(waybill: string): string | null {
  const starts: number[] = [];
  PROFILE_HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROFILE_HEAD_RE.exec(waybill)) !== null) starts.push(m.index + m[0].length);
  if (starts.length === 0) return null;
  const body = waybill.slice(starts[starts.length - 1]!);
  const endM = PROFILE_END_RE.exec(body);
  const searchIn = endM ? body.slice(0, endM.index) : body;
  const rm = PROFILE_REPO_RE.exec(searchIn);
  // text.ts: BASE strips the group Python-style before expanduser.
  return rm ? resolve(pyTrim(rm[1]!).replace(/^~(?=\/|$)/u, homedir())) : null;
}

// --- what may be published ----------------------------------------------------------------------

export const TOKEN = /[~<>\p{L}\p{N}_.@+/-]+/gu;
// text.ts: \w is [\p{L}\p{N}_], \d is \p{Nd}, \b is the lookaround pair, all /u.
// text.ts: PY_S_CLASS — BASE's tail runs on Python \s, not JS \s.
export const URL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])[A-Za-z][A-Za-z0-9+.-]{0,30}:\\/\\/[^${PY_S_CLASS})\\]>'"\`]+`,
  "gu",
);
export const EMAIL_RE =
  /(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;
export const IPV4_RE = /(?<![\p{L}\p{N}_.])\p{Nd}{1,3}(?:\.\p{Nd}{1,3}){3}(?![\p{L}\p{N}_.])/gu;
export const KEY_RE = /(?<![\p{L}\p{N}_-])[A-Z][A-Z0-9]{1,9}-\p{Nd}+(?![\p{L}\p{N}_-])/gu;
export const FILELIKE = /[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.[A-Za-z][\p{L}\p{N}_]{1,7}/u;
export const FAULT_ID_RE = /(?<![\p{L}\p{N}_])tf-[0-9a-f]{8}(?![\p{L}\p{N}_])/gu;
export const HEX_RE = /(?<![\p{L}\p{N}_])(?=[0-9a-f]*\p{Nd})[0-9a-f]{7,40}(?![\p{L}\p{N}_])/gu;
export const MARK_RE = /\[(?:path|project|ticket text|ticket|code|link|address|withheld)\]/gu;
export const WORD_RE = new RegExp(`[${WORD_CLASS}]+(?:'[${WORD_CLASS}]+)*`, "gu");
export const WTOK_RE = /[\p{L}\p{N}_]+/gu;
export const TICKS_RE = /`([^`\n]+)`/gu;
// ASCII: publish strips \x01/\x02 from input first, so only our own
// decimal holds reach this; BASE's twin matches the same ASCII.
// ASCII: placeholders are machine counters, and publish strips \x01/\x02 first.
const HELD_RE = /\x01(\d+)\x02/gu;
const N = 4;

function wordsOf(text: string): string[] {
  return [...text.matchAll(WORD_RE)].map((m) => casefold(m[0]!));
}

function gramsOf(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + N <= ws.length; i++) {
    out.add(ws.slice(i, i + N).join("\x00"));
  }
  return out;
}

export class Safe {
  vocab: Set<string>;
  grams: Set<string>;
  tokens: Set<string>;
  paths: Set<string>;
  files: Set<string>;
  urls: Set<string>;
  keys: Set<string>;
  ids: Set<string>;
  names: RegExp | null;
  waybillWords: Set<string>;
  waybillGrams: Set<string>;

  constructor(ids: Iterable<string> = [], d: string, ongoing: boolean) {
    const files: string[] = [];
    for (const sub of ["scripts", "skills", "wiki"]) {
      const dir = join(TOOL, sub);
      if (existsSync(dir)) {
        for (const p of walkFiles(dir)) files.push(p);
      }
    }
    try {
      for (const p of readdirSync(TOOL)) {
        if (p.endsWith(".md")) files.push(join(TOOL, p));
      }
    } catch {
      /* empty */
    }
    files.push(join(TOOL, "config.example.toml"));
    const texts: string[] = [];
    for (const p of files) {
      try {
        texts.push(readFileSync(p, "utf-8"));
      } catch {
        /* empty */
      }
    }
    const own = texts.join("\n");
    const ws = wordsOf(own);
    this.vocab = new Set(ws);
    this.grams = gramsOf(ws);
    this.tokens = new Set([...own.matchAll(WTOK_RE)].map((m) => casefold(m[0]!)));
    const toks = [...own.matchAll(TOKEN)].map((m) => m[0]!);
    this.paths = new Set(toks.filter((t) => t.includes("/")).map((t) => casefold(t)));
    this.files = new Set(
      toks.filter((t) => FILELIKE.test(t) && FILELIKE.exec(t)?.[0] === t).map((t) => casefold(t)),
    );
    for (const p of files) this.files.add(casefold(basename(p)));
    this.urls = new Set(
      [...own.matchAll(URL_RE)].map((m) => casefold(m[0]!).replace(/[.,;:]+$/u, "")),
    );
    this.keys = new Set([...own.matchAll(KEY_RE)].map((m) => m[0]!));
    this.ids = new Set(ids);
    let waybill = "";
    try {
      waybill = readFileSync(join(d, "brief.md"), "utf-8");
    } catch {
      /* empty */
    }
    const repo = profileRepo(waybill);
    const names = new Set<string>();
    if (repo && existsSync(repo) && sameRepo(repo)) {
      waybill = "";
    } else {
      // <project>/.postmaster/runs/<TICKET>: the project root's name, not "runs".
      const parent = dirname(d);
      const grand = dirname(parent);
      const root =
        basename(parent) === "runs" && basename(grand) === ".postmaster" ? dirname(grand) : parent;
      names.add(basename(root));
      if (!ongoing) names.add(basename(d));
      if (!ongoing) {
        // text.ts: \d is \p{Nd}, $ is END_OR_BEFORE_NL (BASE re.match, not fullmatch).
        const km = basename(d).match(
          // text.ts: END_OR_BEFORE_NL — BASE's match-anchored $ on the dir name.
          new RegExp(`^([A-Za-z][A-Za-z0-9]*)[-_]\\p{Nd}+${END_OR_BEFORE_NL}`, "u"),
        );
        if (km) names.add(km[1]!);
      }
      if (repo) {
        names.add(basename(repo));
        const r = existsSync(repo) ? remoteUrl(repo) : null;
        if (r?.[0]) {
          const parts = r[1].split("/").slice(-2);
          for (const p of parts) names.add(p);
        } else if (r) {
          names.add(basename(r[1]));
        }
      }
    }
    const sortedNames = [...names]
      .filter((n) => [...n].length >= 2 && !isDigit(n) && !this.vocab.has(casefold(n)))
      .sort((a, b) => b.length - a.length);
    // text.ts: [^\W_] is NAME_L/R (double negation: L+N, never _),
    // re.I is iu + literalI.
    this.names =
      sortedNames.length > 0
        ? new RegExp(`${NAME_L}(${sortedNames.map((n) => literalI(n)).join("|")})${NAME_R}`, "giu")
        : null;
    const wws = wordsOf(waybill);
    this.waybillWords = new Set(wws.filter((w) => !this.vocab.has(w)));
    this.waybillGrams = new Set([...gramsOf(wws)].filter((g) => !this.grams.has(g)));
  }

  ownPath(p: string): string | null {
    let q = p.startsWith("./") ? p.slice(2) : p;
    try {
      if (q.startsWith("/")) {
        const real = realpathSync(q);
        const root = realpathSync(TOOL);
        if (!real.startsWith(`${root}/`)) return null;
        q = real.slice(root.length + 1);
      }
      if (q && !q.startsWith("~") && !q.split("/").includes("..") && existsSync(join(TOOL, q))) {
        return posix.normalize(q);
      }
    } catch {
      return null;
    }
    return this.paths.has(casefold(p)) ? p : null;
  }

  publish(text: string): string {
    const held: string[] = [];
    const hold = (s: string): string => {
      held.push(s);
      return `\x01${held.length - 1}\x02`;
    };

    let t = text.replace(/\x01/gu, "").replace(/\x02/gu, "");
    t = t.replace(MARK_RE, (m) => hold(m));
    t = t.replace(FAULT_ID_RE, (m) => hold(m));
    t = t.replace(URL_RE, (m) =>
      hold(this.urls.has(casefold(m).replace(/[.,;:]+$/u, "")) ? m : "[link]"),
    );
    t = t.replace(EMAIL_RE, () => hold("[address]"));
    t = t.replace(IPV4_RE, () => hold("[address]"));
    t = t.replace(TOKEN, (tok) => {
      const core = tok.replace(/[.,:]+$/u, "");
      if (core.includes("/") && WORD_CHAR_RE.test(core)) {
        return hold(this.ownPath(core) || "[path]") + tok.slice(core.length);
      }
      if (FILELIKE.test(core) && FILELIKE.exec(core)?.[0] === core) {
        return hold(this.files.has(casefold(core)) ? core : "[path]") + tok.slice(core.length);
      }
      return tok;
    });
    t = t.replace(HEX_RE, (m) => (this.ids.has(m) ? hold(m) : m));
    t = t.replace(KEY_RE, (m) => hold(this.keys.has(m) ? m : "[ticket]"));
    if (this.names) {
      t = t.replace(this.names, () => hold("[project]"));
    }
    // waybill 4-gram word runs
    const spans = [...t.matchAll(WORD_RE)].map((m) => ({
      start: m.index!,
      end: m.index! + m[0].length,
      word: casefold(m[0]!),
    }));
    const hide = new Set<number>();
    for (let i = 0; i + N <= spans.length; i++) {
      const g = spans
        .slice(i, i + N)
        .map((s) => s.word)
        .join("\x00");
      if (this.waybillGrams.has(g)) {
        for (let j = i; j < i + N; j++) hide.add(j);
      }
    }
    const runs: Array<[number, number]> = [];
    for (const i of [...hide].sort((a, b) => a - b)) {
      if (runs.length > 0 && runs[runs.length - 1]?.[1] === i - 1) {
        runs[runs.length - 1]![1] = i;
      } else {
        runs.push([i, i]);
      }
    }
    for (let ri = runs.length - 1; ri >= 0; ri--) {
      const [a, b] = runs[ri]!;
      t = t.slice(0, spans[a]?.start) + hold("[ticket text]") + t.slice(spans[b]?.end);
    }
    // text.ts: BASE's isdigit is isDigit/isDigitChar (lengths in code points).
    t = t.replace(TICKS_RE, (_m, inner: string) => {
      const replaced = inner.replace(WTOK_RE, (tok) => {
        return this.tokens.has(casefold(tok)) || ([...tok].length < 7 && isDigit(tok))
          ? tok
          : hold("[code]");
      });
      return `\`${replaced}\``;
    });
    t = t.replace(WTOK_RE, (tok) => {
      if (this.tokens.has(casefold(tok)) || ([...tok].length < 7 && isDigit(tok))) return tok;
      const looks =
        isDigit(tok) ||
        tok.includes("_") ||
        [...tok].some((ch) => isDigitChar(ch)) ||
        /[a-z][A-Z]/u.test(tok);
      return looks ? hold("[code]") : tok;
    });
    t = t.replace(WORD_RE, (w) => {
      const cf = casefold(w);
      if (this.vocab.has(cf)) return w;
      // LOWER: BASE's own w.lower() on both sides, ported exactly, never folded.
      if (this.waybillWords.has(cf) || !/^[\x00-\x7f]*$/u.test(w) || w !== w.toLowerCase()) {
        return hold("[withheld]");
      }
      return w;
    });
    return t.replace(HELD_RE, (_m, idx: string) => held[parseInt(idx, 10)]!);
  }

  key(failed: string): string {
    let t = failed.replace(TOKEN, (m) => {
      if (m.includes("/") && WORD_CHAR_RE.test(m)) {
        return ` ${this.ownPath(m.replace(/[.,:]+$/u, "")) || "path"} `;
      }
      return m;
    });
    if (this.names) {
      t = t.replace(this.names, " project ");
    }
    t = casefold(t).replace(FAULT_ID_RE, " id ").replace(HEX_RE, " id ");
    t = t.replace(/\p{Nd}+/gu, " n "); // text.ts: BASE re.sub(r"\d+") is Unicode.
    return [...t.matchAll(WORD_RUN_RE)].map((m) => m[0]).join(" ");
  }
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walkFiles(p));
      else if (e.isFile()) out.push(p);
    }
  } catch {
    /* empty */
  }
  return out;
}

// --- the run's faults ----------------------------------------------------------------------------

function controlsList(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(join(TOOL, "skills/postmaster/controls.md"), "utf-8");
  } catch {
    return out;
  }
  // text.ts: BASE walks splitlines() and strips Python-style.
  for (const line of pySplitLines(text)) {
    const cells = pyTrim(line)
      .replace(/^\||\|$/gu, "")
      .split("|")
      .map((c) => pyTrim(c));
    if (cells.length >= 2) {
      const m = cells[0]?.match(/^`(?:<tool>\/)?([^`]+)`$/u);
      if (m && CONTROLS_VALUE_RE.test(cells[1]!)) {
        out[m[1]!] = cells[1]!;
      }
    }
  }
  return out;
}

interface FaultGroup {
  id: string;
  file: string;
  entries: Array<Record<string, unknown>>;
  at: number;
  control: string;
  workarounds: string[];
  escalated: boolean;
}

/** BASE's fault id: `tf-` plus the first 8 hex digits of sha256 over the
 * target file, a newline, and the failure's key. */
export function faultId(file: string, key: string): string {
  return `tf-${sha256hex(`${file}\n${key}`).slice(0, 8)}`;
}

export function faultsOf(
  entries: Array<Record<string, unknown>>,
  safe: Safe,
  first: number,
): FaultGroup[] {
  const listed = controlsList();
  const groups = new Map<string, FaultGroup>();
  let k = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.action !== "tool-fault") continue;
    k++;
    if (k <= first) continue;
    const file = String(e.target || "");
    const fid = faultId(file, safe.key(String(fields(e).failed || "")));
    let g = groups.get(fid);
    if (!g) {
      g = { id: fid, file, entries: [], at: i, control: "", workarounds: [], escalated: false };
      groups.set(fid, g);
    }
    g.entries.push(e);
  }
  const result: FaultGroup[] = [];
  for (const g of groups.values()) {
    const es = g.entries;
    g.control = es.map((e) => fields(e).control).find((c) => c) || listed[g.file] || "";
    g.workarounds = es.map((e) => fields(e).workaround).filter((w): w is string => !!w);
    g.escalated = entries.slice(g.at + 1).some((e) => {
      return e.action === "escalate" && safe.ownPath(String(e.target || "")) === g?.file;
    });
    result.push(g);
  }
  return result;
}

export function doneOf(entries: Array<Record<string, unknown>>): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const e of entries) {
    const m = DONE_RE.exec(String(e.detail || ""));
    if (
      m &&
      e.actor === "postmaster" &&
      ["ticket-create", "ticket-comment", "note"].includes(String(e.action))
    ) {
      const state = m[2] === "filed" ? "filed" : m[2] === "seen again" ? "commented" : "declined";
      out.set(`${m[1]}!${m[3]}`, [state, e.action === "note" ? "" : String(e.target || "")]);
    }
  }
  return out;
}

// --- postmaster's own tracker -------------------------------------------------------------------

class Unreached extends Error {}

class GitHub {
  call(...args: string[]): RunR {
    return runCmd([join(HERE, "github.sh"), TOOL, ...args]);
  }
  search(text: string): Array<[string, string, string]> {
    const r = this.call("search", text);
    if (r.code !== 0) throw new Unreached(`github.sh search: ${whyR(r)}`);
    // text.ts: BASE walks stdout.splitlines().
    return pySplitLines(r.out)
      .filter(Boolean)
      .map((l) => {
        const parts = l.split("\t");
        return [parts[0]!, parts[1]!, parts.slice(2).join("\t")] as [string, string, string];
      })
      .filter((t) => t[0] && t[1]);
  }
  read(number: string): string {
    const r = this.call("read", number.replace(/^#/u, ""));
    if (r.code !== 0) throw new Unreached(`github.sh read ${number}: ${whyR(r)}`);
    return r.out;
  }
}

function reach(): { tracker: GitHub | null; reason: string } {
  if (!ownCheckout()) {
    return { tracker: null, reason: "postmaster here is not a git checkout of its own" };
  }
  const r = remoteUrl(TOOL);
  if (r?.[0] !== "github.com") {
    return { tracker: null, reason: "postmaster's checkout has no origin on GitHub" };
  }
  const a = runCmd([join(HERE, "github.sh"), TOOL, "access"]);
  if (a.code !== 0) {
    return { tracker: null, reason: `github.sh access: ${whyR(a)}` };
  }
  if (a.out.trim() !== "ADMIN") {
    return {
      tracker: null,
      reason: `the user does not own postmaster's repository (github.sh access: ${a.out.trim()})`,
    };
  }
  return { tracker: new GitHub(), reason: "" };
}

function lookup(
  t: GitHub,
  fid: string,
  file: string,
): { known: [string, string] | null; like: string[] } {
  for (const [number, state] of t.search(fid)) {
    const body = t.read(number);
    if (fidBoundaryRe(fid).test(body)) {
      return { known: [number, state], like: [] };
    }
  }
  const prefix = `Tool fault in ${file}:`;
  const like = t
    .search(prefix.slice(0, -1))
    .filter(([_number, _state, title]) => title.startsWith(prefix))
    .map(([number]) => number);
  return { known: null, like };
}

// --- the drafts ---------------------------------------------------------------------------------

function draft(g: FaultGroup, rid: string, safe: Safe, runJsonPath: string): [string, string] {
  const es = g.entries;
  const file = safe.publish(g.file);
  const failed = tidy(safe.publish(String(fields(es[0]!).failed || "")));
  const fixes = [...new Set(es.map((e) => tidy(safe.publish(String(fields(e).fix || "")))))];
  const roles = safe.publish([...new Set(es.map((e) => String(e.actor || "")))].join(" and "));
  const title = `Tool fault in ${file}: ${clip(failed.replace(/\.$/u, ""), 90)} [${g.id}]`;
  const facts: string[] = [
    `A run met a fault in \`${file}\`: ${failed}${failed.endsWith(".") || failed.endsWith("!") || failed.endsWith("?") ? "" : "."}`,
  ];
  if (g.control) facts.push(`It is a fault in a control (${g.control}), which stops the leg.`);
  if (g.workarounds.length > 0) facts.push("The run worked around it.");
  if (g.escalated) facts.push("The run stopped and escalated.");
  facts.push(`It was seen ${seen(es.length)} in run ${rid}${metaStr(runJsonPath)}.`);
  let direction: string[];
  if (fixes.length === 1) {
    direction = [`The fix the ${roles} that met it proposed: ${fixes[0]}`];
  } else {
    direction = [
      `The fixes proposed by the ${roles} that met it:`,
      "",
      ...fixes.map((f) => `- ${f}`),
    ];
  }
  const body = [
    "## Problem / feature",
    facts.join(" "),
    "",
    "## Acceptance criteria",
    "1. The fault above no longer happens.",
    "2. A control that fails on this fault, and passes with the fix, is part of the change.",
    "",
    "## Direction",
    ...direction,
    "",
    "## Turnpikes",
    "default",
    "",
    "## Notes",
    `Filed from run ${rid} by \`scripts/tool-faults.sh\`. The run's own records keep the full evidence: ` +
      "what ran, the error and the diagnosis. This ticket carries only the file, the failure and the " +
      "proposed fix. The postmaster's contract checker decides from the final branch whether a " +
      `fixture run is required; this ticket's wording does not decide it.`,
    "",
    `Tool fault id: \`${g.id}\`.`,
  ];
  return [title, `${body.join("\n")}\n`];
}

export function digest(titlePath: string, bodyPath: string): string {
  return sha256hex(
    Buffer.concat([readFileSync(titlePath), Buffer.from("\0"), readFileSync(bodyPath)]),
  );
}

function checked(titlePath: string, bodyPath: string, safe: Safe, sha: string): string {
  // text.ts: BASE strips the title and walks the body by splitlines().
  const title = pyTrim(readFileSync(titlePath, "utf-8"));
  const body = readFileSync(bodyPath, "utf-8");
  if (digest(titlePath, bodyPath) !== sha) {
    const bad: Array<[string, string]> = [];
    if (safe.publish(title) !== title) bad.push(["title", title]);
    for (const l of pySplitLines(body)) {
      if (safe.publish(l) !== l) bad.push(["body", l]);
    }
    if (bad.length > 0) {
      return (
        "not safe to publish:\n" +
        bad.map(([w, t]) => `  ${w}: ${t}\n  made safe: ${safe.publish(t)}`).join("\n")
      );
    }
  }
  const r = runCmd([join(HERE, "ticket-check.sh"), "--body", bodyPath, "--title", title]);
  // text.ts: BASE rstrips the failure tail Python-style.
  return r.code === 0 ? "" : `the draft fails scripts/ticket-check.sh:\n${pyRstrip(r.out + r.err)}`;
}

// --- the commands -------------------------------------------------------------------------------

interface FaultState {
  run_id: string;
  id: string;
  file: string;
  control: string;
  count: number;
  state: string;
  ticket: string;
  ticket_state?: string;
  like: string[];
  sha: string;
  draft: string;
}

function harvestCmd(d: string, ongoing: boolean): void {
  closedCheck(d, ongoing);
  const logPath = join(d, "actions.jsonl");
  const statePath = join(d, "tool-faults.json");
  const draftsDir = join(d, "tool-faults");
  const { entries, bad } = readLog(logPath);
  const lines = entries.filter((e) => e.action === "tool-fault").length;
  const st = loadState(statePath);
  let runs: Array<Record<string, any>> = st.runs || [];
  if (runs.length === 0 || (ongoing && lines > (st.lines || 0))) {
    runs = [
      ...runs,
      {
        run_id: newId(),
        first: runs.length > 0 ? st.lines || 0 : 0,
        // ASCII: toISOString is machine ASCII; BASE formats the same stamp.
        harvested: new Date().toISOString().replace(/\.\d+Z$/u, "Z"),
      },
    ];
    st.runs = runs;
    saveState(statePath, st);
  }
  const rid = runs[runs.length - 1]?.run_id as string;
  const first = runs[runs.length - 1]?.first as number;
  const safe = new Safe(ownIds(st, join(d, "run.json")), d, ongoing);
  const groups = faultsOf(entries, safe, first);
  const done = doneOf(entries);
  const prior = new Map<string, any>();
  for (const x of st.faults || []) {
    prior.set(`${x.run_id}!${x.id}`, x);
  }
  const anyNew = groups.some((g) => !done.has(`${g.id}!${rid}`));
  const { tracker: t, reason } = anyNew ? reach() : { tracker: null, reason: "" };
  const rows: string[] = [];
  const found: FaultState[] = [];
  const notes: string[] = bad.map(
    (n) => `  line ${n} of actions.jsonl is not a log line, and was left out`,
  );
  for (const g of groups) {
    const fid = g.id;
    const was = prior.get(`${rid}!${fid}`) || {};
    const x: FaultState = {
      run_id: rid,
      id: fid,
      file: g.file,
      control: g.control,
      count: g.entries.length,
      state: "",
      ticket: "",
      like: [],
      sha: "",
      draft: "",
    };
    const doneKey = `${fid}!${rid}`;
    if (done.has(doneKey)) {
      const [state, ticket] = done.get(doneKey)!;
      x.state = state;
      x.ticket = ticket;
    } else if (!t) {
      x.state = "kept";
    } else {
      try {
        const { known: k, like } = lookup(t, fid, safe.publish(g.file));
        x.like = like;
        if (k) {
          x.state = "known";
          x.ticket = k[0];
          x.ticket_state = k[1];
        } else {
          x.state = was.state === "new" || was.state === "asked" ? "asked" : "new";
        }
      } catch (e) {
        x.state = "unchecked";
        notes.push(
          `  ${fid}: the tracker could not be read: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    const folder = join(draftsDir, rid);
    const titlePath = join(folder, `${fid}.title`);
    const bodyPath = join(folder, `${fid}.md`);
    if (existsSync(titlePath) && existsSync(bodyPath)) {
      x.sha = was.sha || "";
    } else {
      mkdirSync(folder, { recursive: true });
      const [title, body] = draft(g, rid, safe, join(d, "run.json"));
      writeFileSync(titlePath, `${title}\n`);
      writeFileSync(bodyPath, body);
      x.sha = digest(titlePath, bodyPath);
    }
    x.draft = join("tool-faults", rid, `${fid}.md`);
    let what =
      x.state + (x.ticket ? ` ${x.ticket}` : "") + (x.ticket_state ? ` (${x.ticket_state})` : "");
    if (x.like.length > 0) what += `, like ${x.like.join(" ")}`;
    if (ASKING.has(x.state)) what += `  ${x.draft}`;
    rows.push(
      `${fid}  ${g.file}  ${g.control ? `control (${g.control})  ` : ""}${seen(x.count)}  ${what}`,
    );
    if (!["commented", "filed", "declined"].includes(x.state)) {
      if (g.control && !g.escalated) {
        notes.push(
          `  ${fid}: a fault in a control, and the log has no escalate naming its file after it`,
        );
      }
      if (g.control) {
        for (const w of g.workarounds) {
          notes.push(`  ${fid}: a fault in a control, worked around: ${w}`);
        }
      }
    }
    if (ASKING.has(x.state)) {
      const problem = checked(titlePath, bodyPath, safe, x.sha);
      if (problem) {
        notes.push(`  ${fid}: ${problem.replace(/\n/gu, "\n    ")}`);
      }
    }
    found.push(x);
  }
  st.faults = [...(st.faults || []).filter((x: any) => x.run_id !== rid), ...found];
  st.lines = lines;
  saveState(statePath, st);
  const tally: Record<string, number> = {};
  for (const x of found) {
    tally[x.state] = (tally[x.state] || 0) + 1;
  }
  if (groups.length === 0) {
    console.log(`run ${rid}: no tool faults`);
  } else {
    const where =
      (t ? "postmaster's own tracker, on GitHub" : `no tracker of postmaster's own: ${reason}`) ||
      "every fault dealt with";
    console.log(`run ${rid}: ${groups.length} fault${groups.length === 1 ? "" : "s"}; ${where}`);
    console.log(rows.join("\n"));
  }
  if (notes.length > 0) {
    console.log(notes.join("\n"));
  }
  const tallyStr = Object.entries(tally)
    .sort()
    .map(([s, n]) => `, ${n} ${s}`)
    .join("");
  const r = runCmd([
    join(HERE, "log-action.sh"),
    d,
    "postmaster",
    "note",
    rid,
    `tool faults harvested: ${groups.length}${tallyStr}`,
  ]);
  if (r.code !== 0) {
    dieTF(`the log could not be written: ${whyR(r)}`);
  }
}

function begin(
  fid: string,
  d: string,
  ongoing: boolean,
): { st: Record<string, any>; x: any; entries: Array<Record<string, unknown>> } {
  closedCheck(d, ongoing);
  const statePath = join(d, "tool-faults.json");
  const st = loadState(statePath);
  const xs = (st.faults || []).filter((x: any) => x.id === fid);
  if (xs.length === 0) {
    dieTF(`no fault ${fid} in ${statePath}; harvest first`);
  }
  const { entries } = readLog(join(d, "actions.jsonl"));
  const d2 = doneOf(entries).get(`${fid}!${xs[xs.length - 1].run_id}`);
  if (d2) {
    console.log(`${fid}: already ${d2.filter(Boolean).join(" ")}`);
    process.exit(0);
  }
  return { st, x: xs[xs.length - 1], entries };
}

function settle(
  st: Record<string, any>,
  x: any,
  state: string,
  ticket: string,
  statePath: string,
): void {
  x.state = state;
  x.ticket = ticket;
  saveState(statePath, st);
}

function trackerOrDie(): GitHub {
  const { tracker: t, reason } = reach();
  if (!t) dieTF(`no tracker of postmaster's own: ${reason}`);
  return t;
}

function commentCmd(fid: string, ticket: string, d: string, ongoing: boolean): void {
  const statePath = join(d, "tool-faults.json");
  const { st, x, entries } = begin(fid, d, ongoing);
  const t = trackerOrDie();
  const safe = new Safe(ownIds(st, join(d, "run.json")), d, ongoing);
  const first = (st.runs || []).find((r: any) => r.run_id === x.run_id)?.first || 0;
  const g = faultsOf(entries, safe, first).find((g) => g.id === fid);
  if (!g) {
    dieTF(`the run's log no longer gives ${fid}; harvest it again`);
  }
  let number: string;
  let state: string;
  try {
    if (ticket) {
      if (!TICKET_RE.test(ticket)) {
        dieTF(`not a ticket number: ${ticket}`);
      }
      number = `#${ticket.replace(/^#/u, "")}`;
      const body = t.read(number);
      const m = body.match(STATE_RE);
      state = m ? m[1]! : "";
    } else {
      const { known: k } = lookup(t, fid, safe.publish(g?.file));
      if (!k) {
        dieTF(
          `${fid} has no ticket on postmaster's tracker, so it is new: file it, or decline it`,
          2,
        );
      }
      number = k[0];
      state = k[1];
    }
  } catch (e) {
    if (e instanceof Unreached) dieTF(`the tracker could not be read: ${e.message}`);
    throw e;
  }
  let text = `tool fault ${fid} seen again: ${seen(g?.entries.length)} in run ${x.run_id}${metaStr(join(d, "run.json"))}.`;
  if (["closed", "done", "cancelled"].includes(state)) text += " This ticket is closed.";
  const r = t.call("comment", number.replace(/^#/u, ""), "postmaster", text);
  if (r.code !== 0) {
    dieTF(`the tracker refused the comment: ${whyR(r)}`);
  }
  const lr = runCmd([
    join(HERE, "log-action.sh"),
    d,
    "postmaster",
    "ticket-comment",
    number,
    `tool fault ${fid} seen again in run ${x.run_id}, on postmaster's own tracker`,
  ]);
  if (lr.code !== 0) dieTF(`the log could not be written: ${whyR(lr)}`);
  settle(st, x, "commented", number, statePath);
  console.log(`${fid}: commented on ${number}`);
}

function fileCmd(fid: string, d: string, ongoing: boolean): void {
  const statePath = join(d, "tool-faults.json");
  const { st, x } = begin(fid, d, ongoing);
  const folder = join(d, "tool-faults", x.run_id);
  const titlePath = join(folder, `${fid}.title`);
  const bodyPath = join(folder, `${fid}.md`);
  if (!existsSync(titlePath) || !existsSync(bodyPath)) {
    dieTF(`no draft for ${fid} in ${folder}`);
  }
  const t = trackerOrDie();
  const safe = new Safe(ownIds(st, join(d, "run.json")), d, ongoing);
  try {
    const { known: k } = lookup(t, fid, safe.publish(x.file));
    if (k) {
      dieTF(`${fid} is already ${k[0]} on postmaster's tracker: comment on it instead`, 2);
    }
  } catch (e) {
    if (e instanceof Unreached)
      dieTF(`the tracker could not be read, so nothing is filed: ${e.message}`);
    throw e;
  }
  const problem = checked(titlePath, bodyPath, safe, x.sha || "");
  if (problem) {
    dieTF(`${fid} is not filed: ${problem}`, 2);
  }
  const title = readFileSync(titlePath, "utf-8").trim();
  const r = t.call("create", title, bodyPath);
  // text.ts: BASE takes strip().splitlines()[-1] and .isdigit()s it.
  const made = pySplitLines(pyTrim(r.out)).filter(Boolean).pop() || "";
  if (![0, 5].includes(r.code) || !isDigit(made)) {
    dieTF(`the tracker refused the ticket: ${whyR(r)}`);
  }
  const lr = runCmd([
    join(HERE, "log-action.sh"),
    d,
    "postmaster",
    "ticket-create",
    `#${made}`,
    `tool fault ${fid} filed in run ${x.run_id}, on postmaster's own tracker`,
  ]);
  if (lr.code !== 0) dieTF(`the log could not be written: ${whyR(lr)}`);
  settle(st, x, "filed", `#${made}`, statePath);
  console.log(
    `${fid}: filed as #${made}${r.code === 5 ? "; it is not on the board, so add it there" : ""}`,
  );
}

function declineCmd(fid: string, word: string, d: string, ongoing: boolean): void {
  const statePath = join(d, "tool-faults.json");
  const { st, x } = begin(fid, d, ongoing);
  const lr = runCmd([
    join(HERE, "log-action.sh"),
    d,
    "postmaster",
    "note",
    fid,
    `tool fault ${fid} declined in run ${x.run_id}, by the user: ${word}`,
  ]);
  if (lr.code !== 0) dieTF(`the log could not be written: ${whyR(lr)}`);
  settle(st, x, "declined", "", statePath);
  console.log(`${fid}: declined`);
}

// --- entry ---------------------------------------------------------------------------------------
// Round-10 pattern parity, fixture side: the case list and the BASE-side
// program live at module level so --dump-parity-cases can print them for
// fixture regen (scripts/fixtures/tool-faults-parity.json). The tests beside
// this script run the same cases against the committed truth.

export interface PatCase {
  id: string;
  op: "search" | "fullmatch" | "findall" | "profile" | "remote";
  pyPat: string;
  pyFlags: string;
  s: string;
}

// Split for the same reason the harvest vectors split: whole, these
// would sit in this file, hence in the tool's own tokens, and the
// harvest control's matching vectors would keep by membership instead
// of exercising their patterns.
const S_AR3 = "١٢" + "٣";
const S_HXAB = "abcdefab" + "٣";
const NAMES_PY = "(?<![^\\W_])(harbor|illegal|straße)(?![^\\W_])";

export function parityCases(tmp: string): PatCase[] {
  const P = (
    id: string,
    op: PatCase["op"],
    pyPat: string,
    pyFlags: string,
    s: string,
  ): PatCase => ({
    id,
    op,
    pyPat,
    pyFlags,
    s,
  });
  const cases: PatCase[] = [
    P(
      "done",
      "search",
      "^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\\b",
      "",
      "tool fault tf-abcdef12 filed in run abc123",
    ),
    P(
      "done",
      "search",
      "^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\\b",
      "",
      "tool fault tf-abcdef12 seen again in run 123",
    ),
    P(
      "done",
      "search",
      "^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\\b",
      "",
      "tool fault tf-abcdef12 declined in run abc123xyz",
    ),
    P(
      "done",
      "search",
      "^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\\b",
      "",
      "tool fault tf-abcdef12 filed in run abc123é",
    ),
    P(
      "done",
      "search",
      "^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\\b",
      "",
      "xtool fault tf-abcdef12 filed in run abc",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "open https://example.com/x now",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "see https://a.com/x\x1cy here",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "see https://a.com/x\u0085y here",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "see https://a.com/x\ufeffy here",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "get ftp://h/x ok",
    ),
    P(
      "url",
      "search",
      "\\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\\s)\\]>'\"`]+",
      "",
      "open ßhttp://x.com/a now",
    ),
    P(
      "email",
      "search",
      "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
      "",
      "mailed to ü@internal.example today",
    ),
    P(
      "email",
      "search",
      "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
      "",
      "ping admin@exämple.com now",
    ),
    P(
      "email",
      "search",
      "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
      "",
      "mail qzxvndr@例え.テスト ok",
    ),
    P(
      "email",
      "search",
      "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
      "",
      "ask josé@acme-corp.com please",
    ),
    P(
      "email",
      "search",
      "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
      "",
      "mail u@example.com ok",
    ),
    P("email", "search", "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+", "", "note aü@b.co here"),
    P("ipv4", "search", "(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?![\\w.])", "", "ping 10.0.0.1 now"),
    P(
      "ipv4",
      "search",
      "(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?![\\w.])",
      "",
      `ping ${S_AR3}.${S_AR3}.${S_AR3}.${S_AR3} now`,
    ),
    P(
      "ipv4",
      "search",
      "(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?![\\w.])",
      "",
      "ping 1.2.3.9999 now",
    ),
    P(
      "ipv4",
      "search",
      "(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?![\\w.])",
      "",
      "ping é10.0.0.1 now",
    ),
    P(
      "ipv4",
      "search",
      "(?<![\\w.])\\d{1,3}(?:\\.\\d{1,3}){3}(?![\\w.])",
      "",
      "ping 10.0.0.1é now",
    ),
    P("key", "search", "(?<![\\w-])[A-Z][A-Z0-9]{1,9}-\\d+(?![\\w-])", "", "see PM-12 here"),
    P(
      "key",
      "search",
      "(?<![\\w-])[A-Z][A-Z0-9]{1,9}-\\d+(?![\\w-])",
      "",
      "see ü" + "PM-12 and more",
    ),
    P("key", "search", "(?<![\\w-])[A-Z][A-Z0-9]{1,9}-\\d+(?![\\w-])", "", "see PM-١٢ here"),
    P("key", "search", "(?<![\\w-])[A-Z][A-Z0-9]{1,9}-\\d+(?![\\w-])", "", "see PM-12x here"),
    P("key", "search", "(?<![\\w-])[A-Z][A-Z0-9]{1,9}-\\d+(?![\\w-])", "", "see P-1 here"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "data.txt"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "data." + "ßx"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "secret." + "éxt"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "data." + "日本"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "dx.aé9"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "a.b_c-d.e2"),
    P("filelike", "fullmatch", "[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]\\w{1,7}", "", "notafile"),
    P("faultid", "search", "\\btf-[0-9a-f]{8}\\b", "", "see tf-abcdef12 here"),
    P("faultid", "search", "\\btf-[0-9a-f]{8}\\b", "", `again étf-${"1234" + "5678"} broke`),
    P("faultid", "search", "\\btf-[0-9a-f]{8}\\b", "", "see tf-abcdef12é here"),
    P("faultid", "search", "\\btf-[0-9a-f]{8}\\b", "", "see TF-ABCDEF12 here"),
    P("faultid", "search", "\\btf-[0-9a-f]{8}\\b", "", "see tf-abcdef1 here"),
    P("hex", "search", "\\b(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b", "", "hash abcdef1 done"),
    // The lookahead's \d is provably inert (its satisfying digit always
    // kills the trailing \b), so the \p{Nd} spelling is exactness by
    // construction; these vectors lock the agreed match-or-nothing.
    P("hex", "search", "\\b(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b", "", `hash ${S_HXAB}! done`),
    P("hex", "search", "\\b(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b", "", "hash abcdefab done"),
    P("hex", "search", "\\b(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b", "", `hash ${"ßabc" + "def1"} done`),
    P("hex", "search", "\\b(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b", "", `id ${"123" + "4567"} ok`),
    P(
      "mark",
      "search",
      "\\[(?:path|project|ticket text|ticket|code|link|address|withheld)\\]",
      "",
      "a [code] b",
    ),
    P(
      "mark",
      "search",
      "\\[(?:path|project|ticket text|ticket|code|link|address|withheld)\\]",
      "",
      "a [bogus] b",
    ),
    P("word", "fullmatch", "[^\\W\\d_]+(?:'[^\\W\\d_]+)*", "", "l'homme"),
    P("word", "fullmatch", "[^\\W\\d_]+(?:'[^\\W\\d_]+)*", "", "½x"),
    P("word", "fullmatch", "[^\\W\\d_]+(?:'[^\\W\\d_]+)*", "", "1a"),
    P("word", "fullmatch", "[^\\W\\d_]+(?:'[^\\W\\d_]+)*", "", "a'b'c"),
    P("word", "findall", "[^\\W\\d_]+", "", "ab 12 c3 _x Aé㈠"),
    P("word", "findall", "[^\\W\\d_]+", "", "a1b₂c3"),
    P("wtok", "findall", "\\w+", "", "a_b ٣ x-y ½"),
    P("ticks", "findall", "`([^`\\n]+)`", "", "`a`b`c`"),
    P("ticks", "findall", "`([^`\\n]+)`", "", "``"),
    P("token", "fullmatch", "[~<>\\w.@+/-]+", "", "a/b.c_d@e~f<g>h+i:j"),
    P("token", "fullmatch", "[~<>\\w.@+/-]+", "", "a b"),
    P("token", "fullmatch", "[~<>\\w.@+/-]+", "", "héllo/x"),
    P("names", "search", NAMES_PY, "i", "see harbor here"),
    P("names", "search", NAMES_PY, "i", "see _harbor fail"),
    P("names", "search", NAMES_PY, "i", "see harbor_ fail"),
    P("names", "search", NAMES_PY, "i", "see éharbor fail"),
    P("names", "search", NAMES_PY, "i", "see harboré fail"),
    P("names", "search", NAMES_PY, "i", "see HARBOR here"),
    P("names", "search", NAMES_PY, "i", "see İllegal here"),
    P("names", "search", NAMES_PY, "i", "see ıllegal here"),
    P("names", "search", NAMES_PY, "i", "see straße here"),
    P("names", "search", NAMES_PY, "i", "see STRAẞE here"),
    P("names", "search", NAMES_PY, "i", "see 1harbor fail"),
    P("ticket", "fullmatch", "#?\\d+", "", "12"),
    P("ticket", "fullmatch", "#?\\d+", "", "#12"),
    P("ticket", "fullmatch", "#?\\d+", "", S_AR3),
    P("ticket", "fullmatch", "#?\\d+", "", `#${S_AR3}`),
    P("ticket", "fullmatch", "#?\\d+", "", "1a"),
    P("ticket", "fullmatch", "#?\\d+", "", "##12"),
    P("state", "search", "^state: (\\S+)", "m", "state: OPEN"),
    P("state", "search", "^state: (\\S+)", "m", "x\nstate: OPEN"),
    P("state", "search", "^state: (\\S+)", "m", "x\rstate: OPEN"),
    P("state", "search", "^state: (\\S+)", "m", "state: closed\ufeff"),
    P("state", "search", "^state: (\\S+)", "m", "state: \u0085x"),
    P("state", "search", "^state: (\\S+)", "m", "state: "),
    P("fid", "search", "(?<![\\w-])tf-abcdef12(?![\\w-])", "", "see tf-abcdef12 here"),
    P("fid", "search", "(?<![\\w-])tf-abcdef12(?![\\w-])", "", "see étf-abcdef12 here"),
    P("fid", "search", "(?<![\\w-])tf-abcdef12(?![\\w-])", "", "see tf-abcdef12é here"),
    P("fid", "search", "(?<![\\w-])tf-abcdef12(?![\\w-])", "", "see -tf-abcdef12- here"),
    P("controls", "fullmatch", "[\\w-]+", "", "kind-name_2"),
    P("controls", "fullmatch", "[\\w-]+", "", "héllo"),
    P("controls", "fullmatch", "[\\w-]+", "", "has space"),
    P(
      "rurl1",
      "search",
      "^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$",
      "",
      `https://host:${S_AR3}/path`,
    ),
    P(
      "rurl1",
      "search",
      "^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$",
      "",
      "https://user@host:8080/a/b",
    ),
    P(
      "rurl1",
      "search",
      "^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$",
      "",
      "https://host/path/",
    ),
    P(
      "rurl1",
      "search",
      "^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$",
      "",
      "https://host/path.git",
    ),
    P(
      "rurl1",
      "search",
      "^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$",
      "",
      "https://host:abc/path",
    ),
    P(
      "rurl2",
      "search",
      "^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\\.git)?/*$",
      "",
      "git@host:path/to.git",
    ),
    P("rurl2", "search", "^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\\.git)?/*$", "", "host:path"),
    P("rurl2", "search", "^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\\.git)?/*$", "", "a:b:c"),
    P("rurl2", "search", "^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\\.git)?/*$", "", "x://y"),
    P("phead", "findall", "^## Project profile[ \\t]*$", "m", "## Project profile\n"),
    P("phead", "findall", "^## Project profile[ \\t]*$", "m", "x\n## Project profile  \n"),
    P("phead", "findall", "^## Project profile[ \\t]*$", "m", "## Project profile\r\n"),
    P("phead", "findall", "^## Project profile[ \\t]*$", "m", "## Other\n## Project profile\n"),
    P("pend", "search", "^## ", "m", "x\n## y"),
    P("pend", "search", "^## ", "m", "x\r## y"),
    P("pend", "search", "^## ", "m", "## y"),
    P("prepo", "search", "^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$", "m", "repo: ~/x\n"),
    P(
      "prepo",
      "search",
      "^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$",
      "m",
      "repo: /a/b  comment here\n",
    ),
    P(
      "prepo",
      "search",
      "^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$",
      "m",
      "repo: \x1cfoo\n",
    ),
    P("prepo", "search", "^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$", "m", "x\rrepo: /a\n"),
    P("prepo", "search", "^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$", "m", "repo: ~/x\r\n"),
  ];
  // profile_repo / remote differentials: BASE's functions inlined in the
  // program above. Relative results are resolved on the BASE side (the
  // port absolutizes where BASE keeps Path-relative: a carded P3 outside
  // this suite, as are ~user tails and multi-slash remote tails).
  for (const s of [
    "## Project profile\nrepo: /tmp/ppp\n",
    "## Project profile\nrepo: ~/ppp\n",
    "## Project profile\nrepo: /a/b  see ticket\n",
    "## Project profile\r\nrepo: /a\r\n",
    "## Project profile\nrepo: \x1cfoo\n",
    "## Project profile\nx\rrepo: /a\n",
    "## Project profile\nrepo: /a\u0085\n",
    "no sections here",
    "## Project profile\nnothing\n",
    "## Project profile\nrepo: /first\n## Project profile\nrepo: /second\n",
    "## Project profile\nrepo: /a\n## Next\nrepo: /b\n",
  ])
    cases.push(P("profile", "profile", "", "", s));
  const mkRemote = (name: string, url: string | null): string => {
    const d = join(tmp, `pat-${name}`);
    mkdirSync(d, { recursive: true });
    run("git", ["-C", d, "init", "-q"]);
    if (url !== null) run("git", ["-C", d, "remote", "add", "origin", url]);
    return d;
  };
  for (const [name, url] of [
    ["remArPort", `https://h:${S_AR3}/p`],
    ["remFoldHost", "https://Straße:8080/p"],
    ["remStd", "https://User@Host:8080/a/b"],
    ["remScp", "git@host:path/to.git"],
    ["remBare", "host:path"],
    ["remDotGit", "https://host/path.git"],
    ["remSlash", "https://host/path/"],
    ["remNone", null],
  ] as Array<[string, string | null]>)
    cases.push(P("remote", "remote", "", "", mkRemote(name, url)));
  return cases;
}

const PARITY_PROG: string = [
  "import json, os, re, subprocess, sys",
  "out = []",
  "def base_profile(s):",
  "    starts = [m.end() for m in re.finditer(r'^## Project profile[ \\t]*$', s, re.M)]",
  "    if not starts: return None",
  "    body = s[starts[-1]:]",
  "    end = re.search(r'^## ', body, re.M)",
  "    m = re.search(r'^repo:[ \\t]*(\\S.*?)(?:[ \\t]{2,}\\S.*)?[ \\t]*$', body[:end.start()] if end else body, re.M)",
  "    return os.path.abspath(os.path.expanduser(m.group(1).strip())) if m else None",
  "def base_remote(where):",
  "    r0 = subprocess.run(['git', '-C', where, 'remote', 'get-url', 'origin'], capture_output=True, text=True)",
  "    url = r0.stdout.strip() if r0.returncode == 0 else ''",
  "    if not url: return None",
  "    m = (re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\\d+)?/+(.*?)(?:\\.git)?/*$', url) or re.match(r'^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\\.git)?/*$', url))",
  "    return [m.group(1).lower(), m.group(2)] if m and m.group(2) else ['', url.rstrip('/')]",
  "for c in json.load(sys.stdin):",
  "    try:",
  "        fl = 0",
  "        if 'i' in c['pyFlags']: fl |= re.I",
  "        if 'm' in c['pyFlags']: fl |= re.M",
  "        if c['op'] == 'profile': r = base_profile(c['s'])",
  "        elif c['op'] == 'remote': r = base_remote(c['s'])",
  "        elif c['op'] == 'search':",
  "            m = re.search(c['pyPat'], c['s'], fl)",
  "            r = [m.group(0)] + [g if g is not None else '' for g in m.groups()] if m else []",
  "        elif c['op'] == 'fullmatch':",
  "            r = bool(re.fullmatch(c['pyPat'], c['s'], fl))",
  "        else:",
  "            f = re.findall(c['pyPat'], c['s'], fl)",
  "            r = [[g if g is not None else '' for g in t] if isinstance(t, tuple) else t for t in f]",
  "        out.append({'ok': True, 'r': r})",
  "    except Exception as e:",
  "        out.append({'ok': False, 'r': '%s: %s' % (type(e).__name__, e)})",
  "print(json.dumps(out))",
].join("\n");

const argv = process.argv.slice(2);
function usageDie(): never {
  console.error(usage);
  process.exit(1);
  throw new Error("unreachable");
}
const usage =
  "usage: tool-faults.sh harvest <dispatch> | comment <dispatch> <id> [<ticket>] | file <dispatch> <id> | decline <dispatch> <id> <the user's word>";

if (import.meta.main) {
  if (argv[0] === "--dump-parity-cases") {
    // Hidden: fixture regen only, not flow. Prints {cases, prog} for
    // scripts/fixtures/tool-faults-parity.json (see its _note to regen).
    // The dir argument is the scratch the remote cases' git repos live in;
    // regen runs the BASE side there before deleting it.
    if (argv.length !== 2 || !argv[1]) {
      console.error("usage: tool-faults.sh --dump-parity-cases <scratch-dir>");
      process.exit(2);
    }
    mkdirSync(argv[1], { recursive: true });
    console.log(JSON.stringify({ cases: parityCases(argv[1]), prog: PARITY_PROG }));
    process.exit(0);
  } else {
    if (!argv[0]) usageDie();
    const dispatch = argv[1];
    if (!dispatch) usageDie();
    if (!existsSync(dispatch) || !statSync(dispatch).isDirectory()) {
      dieTF(`no such dispatch directory: ${dispatch}`);
    }
    const d = resolve(dispatch);
    const ongoing = basename(d) === "postmaster";

    if (argv[0] === "harvest") {
      if (argv.length !== 2) usageDie();
      harvestCmd(d, ongoing);
    } else if (argv[0] === "comment") {
      if (argv.length < 3 || argv.length > 4) usageDie();
      const fid = argv[2]!;
      if (!/^tf-[0-9a-f]{8}$/u.test(fid)) dieTF(`not a fault id: ${fid}`);
      commentCmd(fid, argv[3] || "", d, ongoing);
    } else if (argv[0] === "file") {
      if (argv.length !== 3) usageDie();
      const fid = argv[2]!;
      if (!/^tf-[0-9a-f]{8}$/u.test(fid)) dieTF(`not a fault id: ${fid}`);
      fileCmd(fid, d, ongoing);
    } else if (argv[0] === "decline") {
      if (argv.length < 4) usageDie();
      const fid = argv[2]!;
      if (!/^tf-[0-9a-f]{8}$/u.test(fid)) dieTF(`not a fault id: ${fid}`);
      declineCmd(fid, argv.slice(3).join(" "), d, ongoing);
    } else {
      usageDie();
    }
    process.exit(0);
  }
}
