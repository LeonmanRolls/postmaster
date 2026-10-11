// Switch-offs a run adds: comments that switch off a check, and changes to the
// settings of the project's checks, compared file by file between the ticket head
// and its merge base with the default branch. Only real comments count, so comment
// discovery comes from a parser library's own comment list (the vendored
// @babel/parser, the ticket's D11 exception): strings, template text and regex
// literals are told apart by the language's grammar, never guessed. Each tool
// reads its own line: TypeScript the last line of a block comment, the linter
// the first non-empty one, Biome any line carrying the whole directive. Probed
// against Oxlint 1.86, tsc 7 and Biome 2.5 wherever the ticket's first-line note
// would miss what a tool honors. A file the parser cannot read fails loud,
// never clear: the check refuses to report over input it cannot read by the
// grammar, as it refuses unreadable blobs.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { run } from "./proc.ts";
import { pyRstrip, pySplitLines, pyTrim, pyWords } from "./text.ts";
import { parse } from "./vendor/babel-parser.js";
import type { BabelComment, BabelNode, BabelOptions } from "./vendor/babel-parser.js";

const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

export interface SwitchOffComment {
  id: string;
  path: string;
  line: number;
  form: string;
  rules: string;
  reason: string | null;
  approved: boolean;
}

export interface SwitchOffSetting {
  id: string;
  path: string;
  change: "added" | "changed" | "deleted";
  diff: string;
  approved: boolean;
}

export type SwitchOffStatus = "clear" | "held" | "no reason" | "refused";

export interface SwitchOffReport {
  status: SwitchOffStatus;
  comments: SwitchOffComment[];
  settings: SwitchOffSetting[];
  output: string;
}

export interface SwitchComment {
  line: number;
  endLine: number;
  raw: string;
  start: number;
  end: number;
}

/** The length of the JS line break at this offset: CRLF counts once, and a lone
 * CR, U+2028 or U+2029 breaks like LF does, as the parser counts them. */
function breakLen(text: string, i: number): number {
  const ch = text[i];
  if (ch === "\n" || ch === "\u2028" || ch === "\u2029") return 1;
  if (ch === "\r") return text[i + 1] === "\n" ? 2 : 1;
  return 0;
}

/** The comments in source text, from the parser's own comment list for the
 * file, with their start, end and kind: strings, template literals and regex
 * literals are told apart by the language's grammar. The path picks the
 * grammar (TypeScript for ts/tsx/mts/cts, JavaScript with JSX otherwise). A
 * file the parser cannot read throws, and the check fails loud on it, never
 * clear. */
export function scanComments(text: string, path: string): SwitchComment[] {
  return parseSource(text, path).comments;
}

interface ParsedFile {
  comments: SwitchComment[];
  blocks: { start: number; end: number }[];
  statements: { start: number; end: number }[];
}

const TS_PLUGINS = [
  "typescript",
  "decorators-legacy",
  "explicitResourceManagement",
  "importAttributes",
  "importAssertions",
];
const TSX_PLUGINS = [...TS_PLUGINS.slice(0, 1), "jsx", ...TS_PLUGINS.slice(1)];
const JS_PLUGINS = [
  "jsx",
  "decorators-legacy",
  "explicitResourceManagement",
  "importAttributes",
  "importAssertions",
];

/** The parser options for a path: the file's own grammar, tolerant flags so
 * sloppy-but-parseable shapes still list their comments, and recovery where
 * the parser offers it. What still throws fails loud at the call. Only
 * `.tsx` takes the `jsx` plugin among the TypeScript extensions: in `.ts`,
 * `.mts` and `.cts` the tools read `<T>x` as an assertion, and JSX would
 * swallow the comments after one. */
function parserOptions(path: string): BabelOptions {
  if (path.endsWith(".tsx")) return { plugins: [...TSX_PLUGINS], ...parserCommon() };
  if (/\.(?:ts|mts|cts)$/u.test(path)) return { plugins: [...TS_PLUGINS], ...parserCommon() };
  return { plugins: [...JS_PLUGINS], ...parserCommon() };
}

function parserCommon(): Omit<BabelOptions, "plugins"> {
  return {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
  };
}

/** Node types whose range is delimited by braces: a window ends at the
 * innermost one around the comment. A braced shape missing here extends the
 * window past it, which errs toward asking. */
const BRACED = new Set([
  "BlockStatement",
  "StaticBlock",
  "ClassBody",
  "ObjectExpression",
  "ObjectPattern",
  "TSModuleBlock",
  "TSInterfaceBody",
  "TSEnumBody",
  "TSTypeLiteral",
]);

function isBabelNode(value: unknown): value is BabelNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<BabelNode>;
  return (
    typeof node.type === "string" && typeof node.start === "number" && typeof node.end === "number"
  );
}

/** Every braced range in the tree, by plain field walk: no grammar is guessed
 * here, the parser already built the nodes. */
function collectBlocks(node: BabelNode, out: { start: number; end: number }[]): void {
  if (BRACED.has(node.type)) out.push({ start: node.start, end: node.end });
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isBabelNode(item)) collectBlocks(item, out);
    } else if (isBabelNode(value)) {
      collectBlocks(value, out);
    }
  }
}

/** Every statement-like range in the tree, by node-name suffix: a next-line
 * window ends no earlier than the statement or braced node holding its first
 * covered line. A name this misses only takes the braced end instead, and the
 * maximum below keeps the covered line itself; either way the window errs
 * toward asking. */
const STATEMENT = /(?:Statement|Declaration)$/u;

function collectStatements(node: BabelNode, out: { start: number; end: number }[]): void {
  if (STATEMENT.test(node.type)) out.push({ start: node.start, end: node.end });
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isBabelNode(item)) collectStatements(item, out);
    } else if (isBabelNode(value)) {
      collectStatements(value, out);
    }
  }
}

/** The comments and braced ranges of one file's text. Throws on input the
 * parser cannot read cleanly, recovered errors included: recovery invents
 * structure that can hide a directive, so a recovered parse is unparseable
 * here, and the check reports that loud, never clear. A file without ESM
 * syntax is also read as a script, as Oxlint reads it, so Annex B comments
 * (`<!--`, line-start `-->`) reach the list from either parse. */
export function parseSource(text: string, path: string): ParsedFile {
  const file = cleanParse(text, parserOptions(path), path);
  const comments: SwitchComment[] = [];
  const seen = new Set<number>();
  const take = (c: BabelComment): void => {
    if (seen.has(c.start)) return;
    seen.add(c.start);
    comments.push(toComment(text, path, c));
  };
  for (const c of file.comments ?? []) take(c);
  if (file.program["sourceType"] === "script") {
    const scripted = cleanParse(text, { ...parserOptions(path), sourceType: "script" }, path);
    for (const c of scripted.comments ?? []) take(c);
  }
  const blocks: { start: number; end: number }[] = [];
  collectBlocks(file.program, blocks);
  const statements: { start: number; end: number }[] = [];
  collectStatements(file.program, statements);
  return { comments, blocks, statements };
}

/** One parse that must come back clean: a throw or a recovered error fails
 * loud at the call. */
function cleanParse(
  text: string,
  options: BabelOptions,
  path: string,
): { comments: BabelComment[] | null; program: BabelNode } {
  let file;
  try {
    file = parse(text, options);
  } catch {
    throw new Error(`cannot parse ${path}: refusing to report clear over unparseable input`);
  }
  if (file.errors.length > 0) {
    throw new Error(`cannot parse ${path}: refusing to report clear over unparseable input`);
  }
  return file;
}

function toComment(text: string, path: string, c: BabelComment): SwitchComment {
  if (c.loc === null) {
    throw new Error(`cannot place a comment in ${path}: refusing to report over it`);
  }
  return {
    line: c.loc.start.line,
    endLine: c.loc.end.line,
    raw: pyRstrip(text.slice(c.start, c.end)),
    start: c.start,
    end: c.end,
  };
}

/** What a comment switches off, and how far. `line` covers its own line, `next`
 * the following one, `open` a block to its matching `close`, `file` the whole
 * file. */
export interface SwitchDirective {
  form: string;
  scope: "line" | "next" | "open" | "close" | "file";
  tool: "ts" | "linter" | "biome";
  rules: string;
  reason: string | null;
}

/** One superset rule per tool: a comment that names a directive word, in any
 * spelling or case, counts as a switch-off. The tools match loosely (tsc by
 * prefix, Biome joining word and category), so the check matches looser:
 * every spelling a tool honors is listed, and a spelling no tool honors only
 * asks a needless question. Position still rules — a mid-line mention names
 * no directive — and Biome still needs its category and reason, which switch
 * nothing off when missing. Case is ASCII only, like the tools': the match
 * runs over asciiLower, never the i flag or toLowerCase, which would fold
 * non-ASCII lookalikes no tool honors. */
const TS_RE = /^@(ts-ignore|ts-expect-error|ts-nocheck)/u;
const LINTER_RE = /^(eslint|oxlint)-(disable-line|disable-next-line|disable|enable)/u;
const BIOME_RE = /^(biome-ignore-all|biome-ignore-start|biome-ignore-end|biome-ignore)/u;

/** ASCII-only lowercase for directive words: A-Z shift one step, everything
 * else passes through, so the length never changes and a match over the
 * lowered text slices the original. */
function asciiLower(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : ch;
  }
  return out;
}

/** Split source text on JS line breaks only: LF, CRLF (once), CR, U+2028 and
 * U+2029. Python's wider set would split where the scanner counts no break
 * (VT, FF and the separators are whitespace or invalid there) and misalign
 * every covered line below one. */
function splitJsLines(text: string): string[] {
  const parts = text.split(/\r\n|[\n\r\u2028\u2029]/u);
  if (
    parts.length > 0 &&
    parts[parts.length - 1] === "" &&
    /(?:\r\n|[\n\r\u2028\u2029])$/u.test(text)
  )
    parts.pop();
  return parts;
}

function tsDirective(match: RegExpExecArray, line: string): SwitchDirective {
  const rest = pyTrim(line.slice(match[0].length));
  const reason = pyTrim(rest.replace(/^(?:--|:)[ \t]*/u, ""));
  return {
    form: match[1]!,
    scope: match[1] === "ts-nocheck" ? "file" : "next",
    tool: "ts",
    rules: "every rule",
    reason: reason === "" ? null : reason,
  };
}

function linterDirective(match: RegExpExecArray, rest: string): SwitchDirective {
  const what = match[2]!;
  const scope: SwitchDirective["scope"] =
    what === "disable"
      ? "open"
      : what === "enable"
        ? "close"
        : what === "disable-line"
          ? "line"
          : "next";
  let reason: string | null = null;
  if (rest.startsWith("-- ")) {
    reason = pyTrim(rest.slice(3));
    rest = "";
  } else {
    const k = rest.indexOf(" -- ");
    if (k >= 0) {
      reason = pyTrim(rest.slice(k + 4));
      rest = pyTrim(rest.slice(0, k));
    }
  }
  if (reason === "") reason = null;
  return {
    form: `${match[1]}-${what}`,
    scope,
    tool: "linter",
    rules: rest === "" ? "every rule" : pyWords(rest.replace(/,/gu, " ")).join(", "),
    reason,
  };
}

function biomeDirective(match: RegExpExecArray, line: string): SwitchDirective | null {
  const rest = pyTrim(line.slice(match[0].length));
  const colon = rest.indexOf(":");
  if (colon < 0) return null;
  const rules = pyTrim(rest.slice(0, colon));
  const reason = pyTrim(rest.slice(colon + 1));
  if (rules === "" || reason === "") return null;
  const what = match[1]!;
  return {
    form: what,
    scope:
      what === "biome-ignore"
        ? "next"
        : what === "biome-ignore-all"
          ? "file"
          : what === "biome-ignore-start"
            ? "open"
            : "close",
    tool: "biome",
    rules,
    reason,
  };
}

const noMarks = (entry: string): string => pyTrim(entry.replace(/^[/* \t]+/u, ""));

/** The directives in a `//` comment: at most one, since one line leads with
 * one directive. TypeScript honors extra slashes after the opener (`///`
 * and more); the linter and Biome do not, and neither honors a star run
 * here. Whether ESLint honors `///` is unprobed; the strip stays
 * TypeScript-only until a probe says otherwise. */
function parseLineComment(body: string): SwitchDirective[] {
  const line = pyTrim(body);
  if (line === "") return [];
  const tsLine = pyTrim(body.replace(/^\/+/u, ""));
  const ts = TS_RE.exec(asciiLower(tsLine));
  if (ts !== null) return [tsDirective(ts, tsLine)];
  const lint = LINTER_RE.exec(asciiLower(line));
  if (lint !== null) return [linterDirective(lint, pyTrim(line.slice(lint[0].length)))];
  const biome = BIOME_RE.exec(asciiLower(line));
  if (biome !== null) {
    const off = biomeDirective(biome, line);
    if (off !== null) return [off];
  }
  return [];
}

/** The directives in a block comment: up to one per tool, since each tool
 * reads its own line. TypeScript reads the last line, slashes and stars
 * dropped; the linter's directive starts the first non-empty line, with
 * rules and reason running across the block's lines; Biome matches any line
 * carrying directive, category and reason together. All three rules are
 * probed against tsc, Oxlint 1.86 and Biome 2.5, and each differs from the
 * ticket's first-line note where the tool honors what that note would
 * miss. */
function parseBlockComment(body: string): SwitchDirective[] {
  const out: SwitchDirective[] = [];
  const lines = splitJsLines(body).map((entry) => pyTrim(entry));
  if (lines.every((entry) => entry === "")) return out;
  const tsLine = noMarks(lines[lines.length - 1]!);
  const ts = TS_RE.exec(asciiLower(tsLine));
  if (ts !== null) out.push(tsDirective(ts, tsLine));
  const fi = lines.findIndex((entry) => entry !== "");
  const first = fi < 0 ? "" : lines[fi]!;
  const lint = first === "" ? null : LINTER_RE.exec(asciiLower(first));
  if (lint !== null) {
    const rest = pyTrim(`${first.slice(lint[0].length)} ${lines.slice(fi + 1).join(" ")}`);
    out.push(linterDirective(lint, rest));
  }
  for (const entry of lines) {
    const cand = noMarks(entry);
    const biome = BIOME_RE.exec(asciiLower(cand));
    if (biome === null) continue;
    const off = biomeDirective(biome, cand);
    if (off !== null) out.push(off);
  }
  return out;
}

/** Parse one comment as a switch-off directive, or null when it is not one.
 * A reason is the text after ` -- ` in a linter comment (or after a leading
 * `--`), any text after a TypeScript directive (a leading `--` or `:`
 * dropped), and the text after the colon in Biome's; for Biome a missing
 * category or reason is null, which switches nothing off. Empty or blank
 * text is no reason. */
export function parseSwitchOff(raw: string): SwitchDirective | null {
  return parseAllDirectives(raw)[0] ?? null;
}

/** Every directive a comment carries, one per tool at most (Biome lines each
 * at most one). A block comment can honestly hold two tools' directives on
 * two lines, and both suppress; the single-shot parse above is its first. */
function parseAllDirectives(raw: string): SwitchDirective[] {
  if (raw.startsWith("//")) return parseLineComment(raw.slice(2));
  if (raw.startsWith("<!--")) return parseLineComment(raw.slice(4));
  if (raw.startsWith("-->")) return parseLineComment(raw.slice(3));
  if (!raw.startsWith("/*")) return [];
  const body = raw.endsWith("*/") ? raw.slice(2, -2) : raw.slice(2);
  return parseBlockComment(body);
}

interface PlacedDirective extends SwitchDirective {
  line: number;
  end: number;
  startOff: number;
  raw: string;
}

function placeDirectives(comments: SwitchComment[]): PlacedDirective[] {
  const out: PlacedDirective[] = [];
  for (const c of comments) {
    for (const off of parseAllDirectives(c.raw)) {
      out.push({ ...off, line: c.line, end: c.endLine, startOff: c.start, raw: c.raw });
    }
  }
  return out;
}

function maskedLines(text: string, comments: SwitchComment[]): string[] {
  const masked = text.split("");
  for (const c of comments) {
    for (let i = c.start; i < c.end; i++) {
      const ch = masked[i];
      if (ch !== "\n" && ch !== "\r" && ch !== "\u2028" && ch !== "\u2029") masked[i] = " ";
    }
  }
  return splitJsLines(masked.join("")).map((line) => pyTrim(line));
}

/** The offset where each 0-based line starts, on JS line breaks. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; ) {
    const b = breakLen(text, i);
    if (b > 0) {
      starts.push(i + b);
      i += b;
    } else {
      i++;
    }
  }
  return starts;
}

/** The conservative window a line or next-line identity holds: the masked code
 * from the given 1-based line through the line holding the block end offset,
 * or to the end of the file where no block closes around it. Blank lines
 * stay in: the tools treat a blank between the directive and its code
 * differently, so a blank-line edit asks again. The window errs wide on
 * purpose: no tool's coverage rule is predicted, and a window wider than
 * the coverage is correct by design. */
function blockWindow(code: string[], starts: number[], from: number, blockEnd: number): string[] {
  const out: string[] = [];
  for (let k = from - 1; k < code.length; k++) {
    if (starts[k]! >= blockEnd) break;
    out.push(code[k]!);
  }
  return out;
}

/** The end of the innermost braced node around the offset, or infinity where
 * none closes around it (top level): the window then runs to the file end. */
function enclosingBlockEnd(blocks: { start: number; end: number }[], offset: number): number {
  let best: number | null = null;
  for (const b of blocks) {
    if (b.start <= offset && offset < b.end && (best === null || b.end < best)) best = b.end;
  }
  return best ?? Number.POSITIVE_INFINITY;
}

/** The floor under a next-line window: the end of the statement or braced
 * node holding the first code line after the comment, whichever reaches
 * further, and at least that line itself. Blank and comment-only lines are
 * skipped, since a directive covers past them. */
function holderEndAfter(
  text: string,
  code: string[],
  starts: number[],
  parsed: ParsedFile,
  endLine: number,
): number {
  let after = -1;
  for (let k = endLine; k < code.length; k++) {
    if (code[k] !== "") {
      after = k;
      break;
    }
  }
  if (after < 0) return Number.NEGATIVE_INFINITY;
  const a0 = starts[after]!;
  const a1 = after + 1 < starts.length ? starts[after + 1]! : text.length;
  return Math.max(
    a1,
    enclosingBlockEnd(parsed.blocks, a0),
    enclosingBlockEnd(parsed.statements, a0),
  );
}

/** The approval identity of a switch-off: its file, its comment text, its place
 * among identical twins, and, for a line or next-line form, the conservative
 * window after it (masked code to the end of its enclosing block, to the end
 * of the file where no block closes); for a block or file form, the code it
 * covers and the close that ends it. Whether the run added it is judged
 * separately, by file, text and place among identical comments, so a merge
 * that moves lines asks nothing new. A window wider than the tool's coverage
 * is correct by design: any later edit in it asks again. Settings use the
 * file's content object id at the head instead. */
function switchOffId(kind: "comment" | "settings", parts: string[]): string {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
  return `${kind}:${hex}`;
}

interface SwitchEntry {
  file: string;
  line: number;
  form: string;
  rules: string;
  reason: string | null;
  id: string;
  raw: string;
  span: string;
}

const LISTED_SCOPES = new Set<SwitchDirective["scope"]>(["line", "next", "open", "file"]);

/** The rule names a linter open or close lists, or null for a bare one. The
 * parser normalizes separators already, so the names split on commas. */
function linterRuleSet(d: PlacedDirective): Set<string> | null {
  if (d.rules === "every rule") return null;
  return new Set(
    d.rules
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r !== ""),
  );
}

interface BlockEnd {
  closes: { raw: string; line: number }[];
  end?: { raw: string; line: number };
}

/** Every listed switch-off in one file's text, each with its identity. The
 * linter's opens match closes by rule set, on one machine for both
 * spellings, since probes show Oxlint 1.86 honors either spelling against
 * either: a bare close ends bare opens only, a named close removes its
 * rules from every named open, and one close can narrow several opens.
 * (A bare close after a named open, and a named close after a bare open,
 * are both no-ops there; matching any close to any open would end blocks
 * the tool still honors.) Biome keeps stack pairing. Every close that
 * narrows an open joins its identity, so removing one counts the open as
 * added. */
function fileSwitches(file: string, text: string): SwitchEntry[] {
  const parsed = parseSource(text, file);
  const code = maskedLines(text, parsed.comments);
  const starts = lineStarts(text);
  const placed = placeDirectives(parsed.comments);
  const ends = new Map<number, BlockEnd>();
  const endOf = (index: number): BlockEnd => {
    let e = ends.get(index);
    if (!e) {
      e = { closes: [] };
      ends.set(index, e);
    }
    return e;
  };
  const bareOpens: number[] = [];
  const namedOpens: { index: number; rules: Set<string> }[] = [];
  const biomeStack: number[] = [];
  placed.forEach((d, index) => {
    if (d.scope !== "open" && d.scope !== "close") return;
    if (d.tool === "linter") {
      const rules = linterRuleSet(d);
      if (d.scope === "open") {
        if (rules === null) bareOpens.push(index);
        else namedOpens.push({ index, rules });
        return;
      }
      const close = { raw: d.raw, line: d.line };
      if (rules === null) {
        for (const open of bareOpens.splice(0)) {
          const e = endOf(open);
          e.closes.push(close);
          e.end = close;
        }
        return;
      }
      for (const open of namedOpens) {
        let narrowed = false;
        for (const r of rules) if (open.rules.delete(r)) narrowed = true;
        if (!narrowed) continue;
        const e = endOf(open.index);
        e.closes.push(close);
        if (open.rules.size === 0 && e.end === undefined) e.end = close;
      }
      return;
    }
    if (d.scope === "open") {
      biomeStack.push(index);
    } else {
      const open = biomeStack.pop();
      if (open === undefined) return;
      const e = endOf(open);
      e.closes.push({ raw: d.raw, line: d.line });
      e.end = { raw: d.raw, line: d.line };
    }
  });
  const out: SwitchEntry[] = [];
  const twins = new Map<string, number>();
  placed.forEach((d, index) => {
    if (!LISTED_SCOPES.has(d.scope)) return;
    let covered: string[];
    let tail = [""];
    if (d.scope === "line") {
      covered = blockWindow(code, starts, d.line, enclosingBlockEnd(parsed.blocks, d.startOff));
    } else if (d.scope === "next") {
      const blockEnd = enclosingBlockEnd(parsed.blocks, d.startOff);
      const floor = holderEndAfter(text, code, starts, parsed, d.end);
      covered = blockWindow(code, starts, d.end, Math.max(blockEnd, floor));
    } else if (d.scope === "file") {
      covered = code.filter((entry) => entry !== "");
    } else {
      const e = ends.get(index);
      const end = e?.end;
      tail = [
        ...(e?.closes.map((c) => c.raw) ?? []),
        ...(end === undefined ? ["to end of file"] : []),
      ];
      const stop = end === undefined ? code.length : Math.max(d.line, end.line);
      covered = code.slice(d.line - 1, stop).filter((entry) => entry !== "");
    }
    const span = [...covered, ...tail].join("\n");
    const twinKey = `${d.raw}\0${span}`;
    const occurrence = twins.get(twinKey) ?? 0;
    twins.set(twinKey, occurrence + 1);
    out.push({
      file,
      line: d.line,
      form: d.form,
      rules: d.rules,
      reason: d.reason,
      id: switchOffId("comment", [file, d.raw, String(occurrence), ...covered, ...tail]),
      raw: d.raw,
      span,
    });
  });
  return out;
}

function git(repo: string, args: string[]): string {
  const r = run("git", ["-C", repo, ...args], { env: UNSET_GIT });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

function commitOfRef(repo: string, ref: string): string {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

function isSource(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path);
}

/** Every path in the tree at a revision with its mode. Quoting is off and
 * entries split on NUL, so a name holding whitespace or quotes still parses:
 * the entry's meta holds no tab, and the path is everything past the first. */
function treeModes(repo: string, rev: string): Map<string, string> {
  const out = new Map<string, string>();
  const entries = git(repo, ["-c", "core.quotePath=false", "ls-tree", "-rz", "--full-tree", rev])
    .split("\0")
    .filter((entry) => entry !== "");
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    if (tab < 0) throw new Error(`cannot read tree of ${rev}: refusing to report over it`);
    const mode = entry.slice(0, tab).split(" ")[0];
    if (mode === undefined || mode === "") {
      throw new Error(`cannot read tree of ${rev}: refusing to report over it`);
    }
    out.set(entry.slice(tab + 1), mode);
  }
  return out;
}

function changedPaths(repo: string, base: string, head: string): string[] {
  return git(repo, ["diff", "--no-renames", "--name-only", "-z", base, head])
    .split("\0")
    .filter((path) => path !== "");
}

function blobAt(repo: string, rev: string, path: string): string | null {
  const r = run("git", ["-C", repo, "cat-file", "blob", `${rev}:${path}`], { env: UNSET_GIT });
  if (r.code !== 0) return null;
  return r.out;
}

/** The tree path a scan reads for a path: through one symlink, since the
 * tools read the target's content under the link's name. A link that dangles,
 * leaves the tree or chains to another link fails loud: scanning the link's
 * own text would report over content no tool sees. */
function resolveLink(repo: string, rev: string, path: string, modes: Map<string, string>): string {
  if (modes.get(path) !== "120000") return path;
  const link = blobAt(repo, rev, path);
  if (link === null) throw new Error(`cannot read ${path} at ${rev}: refusing to report over it`);
  const target = link.replace(/\r?\n$/u, "");
  if (target.startsWith("/")) {
    throw new Error(`cannot resolve symlink ${path} at ${rev}: target ${target} leaves the tree`);
  }
  const resolved = posix.normalize(posix.join(posix.dirname(path), target));
  if (resolved === ".." || resolved.startsWith("../")) {
    throw new Error(`cannot resolve symlink ${path} at ${rev}: target ${target} leaves the tree`);
  }
  const mode = modes.get(resolved);
  if (mode === undefined) {
    throw new Error(
      `cannot resolve symlink ${path} at ${rev}: target ${target} is not in the tree`,
    );
  }
  if (mode === "120000") {
    throw new Error(`cannot resolve symlink ${path} at ${rev}: target ${target} is itself a link`);
  }
  return resolved;
}

/** tryResolveLink resolves, or null where the link does not: for comparing an
 * unchanged link's target across revisions, where either side may dangle. */
function tryResolveLink(
  repo: string,
  rev: string,
  path: string,
  modes: Map<string, string>,
): string | null {
  try {
    return resolveLink(repo, rev, path, modes);
  } catch {
    return null;
  }
}

/** Links the diff did not touch whose targets changed content between the
 * revisions: the tools read the target under the link's name, so a
 * target-only change is the link's change. A link dangling at both ends is
 * stable, not changed: it carries no content for any tool to read. */
function changedAliases(
  repo: string,
  base: string,
  head: string,
  before: Map<string, string>,
  after: Map<string, string>,
  changed: Set<string>,
  wanted: (path: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [path, mode] of after) {
    if (mode !== "120000" || changed.has(path) || !wanted(path)) continue;
    if (before.get(path) !== "120000") continue;
    const oldAt = tryResolveLink(repo, base, path, before);
    const newAt = tryResolveLink(repo, head, path, after);
    const oldText = oldAt === null ? null : blobAt(repo, base, oldAt);
    const newText = newAt === null ? null : blobAt(repo, head, newAt);
    if (oldText !== newText) out.push(path);
  }
  return out;
}

function blobShaAt(
  repo: string,
  rev: string,
  path: string,
  modes?: Map<string, string>,
): string | null {
  const at = modes === undefined ? path : resolveLink(repo, rev, path, modes);
  const r = run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${rev}:${at}`], {
    env: UNSET_GIT,
  });
  if (r.code !== 0 || r.out === "") return null;
  return pySplitLines(r.out)[0] ?? null;
}

/** The switch-offs the head adds over the base, file by file. A comment is the
 * run's addition when the head holds more of it than the base does, judged
 * by file, comment text and place among identical comments, or when the
 * code in its span changed under a comment the base already had: a run that
 * edits inside a main switch-off's window is asked, while one that edits
 * past its block is not. An unchanged link whose target changed counts as
 * changed itself, under the link's name. */
function addedSwitches(repo: string, base: string, head: string): SwitchEntry[] {
  const before = treeModes(repo, base);
  const after = treeModes(repo, head);
  const changed = changedPaths(repo, base, head);
  const aliases = new Set(
    changedAliases(repo, base, head, before, after, new Set(changed), isSource),
  );
  const paths = [...changed.filter(isSource), ...aliases];
  const oldSpans = new Map<string, string[]>();
  for (const path of paths) {
    if (!before.has(path)) continue;
    const at = aliases.has(path)
      ? tryResolveLink(repo, base, path, before)
      : resolveLink(repo, base, path, before);
    if (at === null) continue;
    const source = blobAt(repo, base, at);
    if (source === null)
      throw new Error(
        `cannot read ${path} at ${base}: refusing to report clear over unreadable input`,
      );
    for (const entry of fileSwitches(path, source)) {
      const key = `${entry.file}\0${entry.raw}`;
      const spans = oldSpans.get(key) ?? [];
      spans.push(entry.span);
      oldSpans.set(key, spans);
    }
  }

  const found: SwitchEntry[] = [];
  const seen = new Map<string, number>();
  for (const path of paths) {
    if (!after.has(path)) continue;
    const at = resolveLink(repo, head, path, after);
    const source = blobAt(repo, head, at);
    if (source === null)
      throw new Error(
        `cannot read ${path} at ${head}: refusing to report clear over unreadable input`,
      );
    for (const entry of fileSwitches(path, source)) {
      const key = `${entry.file}\0${entry.raw}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const old = (oldSpans.get(key) ?? [])[index];
      if (old === undefined || old !== entry.span) found.push(entry);
    }
  }
  return found;
}

/** The settings files a check reads, by basename anywhere in the tree. */
function settingsKind(path: string): "plain" | "package" | null {
  const name = basename(path);
  if (name === "package.json") return "package";
  if (
    /^tsconfig.*\.json$/u.test(name) ||
    /^jsconfig.*\.json$/u.test(name) ||
    name === ".oxlintrc.json" ||
    name === ".oxlintrc.jsonc" ||
    name === "oxlint.config.ts" ||
    name === "oxlint.config.mts" ||
    name.startsWith(".eslintrc") ||
    name.startsWith("eslint.config.") ||
    name === ".eslintignore" ||
    name === ".gitignore" ||
    name === "biome.json" ||
    name === "biome.jsonc" ||
    name === ".biome.json" ||
    name === ".biome.jsonc" ||
    name.startsWith(".prettierrc") ||
    name.startsWith("prettier.config.") ||
    name === ".prettierignore" ||
    name === "bunfig.toml"
  ) {
    return "plain";
  }
  return null;
}

/** Stable JSON for comparing parsed blocks: object keys in order. */
function canonJson(v: unknown): string {
  if (v === undefined) return "<undefined>";
  if (Array.isArray(v)) return `[${v.map(canonJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Whether a package.json change touches what a check runs or a tool's settings:
 * its scripts, eslintConfig or prettier block, not a dependency. Text that does
 * not parse compares whole, so an unreadable file is never waved through. */
export function packageSettingsDiffer(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    if (a === null && b === null) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse((a ?? b)!) as unknown;
    } catch {
      return true;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return true;
    const o = parsed as Record<string, unknown>;
    return ["scripts", "eslintConfig", "prettier"].some((k) => o[k] !== undefined);
  }
  if (a === b) return false;
  let pa: unknown;
  let pb: unknown;
  try {
    pa = JSON.parse(a) as unknown;
    pb = JSON.parse(b) as unknown;
  } catch {
    return true;
  }
  if (pa === null || typeof pa !== "object" || Array.isArray(pa)) return true;
  if (pb === null || typeof pb !== "object" || Array.isArray(pb)) return true;
  const oa = pa as Record<string, unknown>;
  const ob = pb as Record<string, unknown>;
  return ["scripts", "eslintConfig", "prettier"].some((k) => canonJson(oa[k]) !== canonJson(ob[k]));
}

interface SettingsEntry {
  file: string;
  change: "added" | "changed" | "deleted";
  id: string;
  diff: string;
}

function settingsChanges(repo: string, base: string, head: string): SettingsEntry[] {
  const before = treeModes(repo, base);
  const after = treeModes(repo, head);
  const changed = changedPaths(repo, base, head);
  const aliases = new Set(
    changedAliases(repo, base, head, before, after, new Set(changed), (path) => {
      return settingsKind(path) !== null;
    }),
  );
  const candidates = [...changed.filter((path) => settingsKind(path) !== null), ...aliases].sort();
  const result: SettingsEntry[] = [];
  for (const path of candidates) {
    const kind = settingsKind(path)!;
    const isAlias = aliases.has(path);
    let oldAt: string | null = null;
    let newAt: string | null = null;
    if (before.has(path)) {
      oldAt = isAlias
        ? tryResolveLink(repo, base, path, before)
        : resolveLink(repo, base, path, before);
    }
    if (after.has(path)) {
      newAt = resolveLink(repo, head, path, after);
    }
    const oldText = oldAt === null ? null : blobAt(repo, base, oldAt);
    const newText = newAt === null ? null : blobAt(repo, head, newAt);
    const differs =
      kind === "package" ? packageSettingsDiffer(oldText, newText) : oldText !== newText;
    if (!differs) continue;
    const change = !before.has(path) ? "added" : !after.has(path) ? "deleted" : "changed";
    const diff = settingsDiffText(repo, base, head, path, oldAt, newAt, isAlias);
    const sha = blobShaAt(repo, head, path, after) ?? "absent";
    result.push({
      file: path,
      change,
      id: switchOffId("settings", [path, sha]),
      diff,
    });
  }
  return result;
}

/** The diff shown for a settings entry: the path's own diff, except an
 * unchanged link shows its target's diff instead, since the link path
 * itself has none. The headers name the target the bytes come from; an
 * unresolvable side renders as an added or deleted file. */
function settingsDiffText(
  repo: string,
  base: string,
  head: string,
  path: string,
  oldAt: string | null,
  newAt: string | null,
  isAlias: boolean,
): string {
  const target = isAlias ? (newAt ?? oldAt) : path;
  if (target === null) {
    throw new Error(`git diff ${path}: alias has no resolvable side`);
  }
  const d = run(
    "git",
    [
      "-C",
      repo,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--no-renames",
      base,
      head,
      "--",
      `:(literal)${target}`,
    ],
    { env: UNSET_GIT },
  );
  if (d.code !== 0) throw new Error(`git diff ${path}: ${d.err.trim()}`);
  return d.out.replace(/\n+$/u, "");
}

interface LoggedApproval {
  action: string;
  actor: string;
  target: string;
  detail: string;
  run: string;
}

/** The user's word per switch-off identity, from the run's record: the line must
 * sit in the run's actions and the project's ledger alike, be the postmaster's
 * word for this run, and open with approved or refused plus the user's words.
 * Anything else is ignored with a warning, never silently obeyed and never
 * fatal to the listing. Where the record holds both words for one identity,
 * refused wins: a refusal stands until the entry itself changes. */
function approvals(
  dispatch: string,
  warn: (message: string) => void,
): Map<string, "approved" | "refused"> {
  const root = resolve(dispatch);
  const runId = basename(root);
  const actionPath = join(root, "actions.jsonl");
  if (!existsSync(actionPath)) throw new Error(`no actions.jsonl in ${root}`);
  const ledgerPath = join(dirname(root), "ledger.jsonl");
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
  const ledgerKeys = new Set(pySplitLines(ledgerText).filter((line) => pyTrim(line) !== ""));
  const result = new Map<string, "approved" | "refused">();
  for (const line of pySplitLines(readFileSync(actionPath, "utf8"))) {
    if (pyTrim(line) === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      warn(`ignoring a line that is not JSON in ${actionPath}`);
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const rec = parsed as Partial<LoggedApproval>;
    if (rec.action !== "switch-off") continue;
    if (
      typeof rec.actor !== "string" ||
      typeof rec.target !== "string" ||
      typeof rec.detail !== "string" ||
      typeof rec.run !== "string"
    ) {
      warn(`ignoring a malformed switch-off line in ${actionPath}`);
      continue;
    }
    if (rec.actor !== "postmaster" || rec.run !== runId) continue;
    if (!ledgerKeys.has(line)) {
      warn(`ignoring a switch-off line missing from the ledger in ${actionPath}`);
      continue;
    }
    const words = pyWords(rec.detail);
    const decision = words[0] === "approved" ? "approved" : words[0] === "refused" ? "refused" : "";
    if (decision === "" || words.length < 3) {
      warn(`ignoring a malformed switch-off line in ${actionPath}`);
      continue;
    }
    if (decision === "refused" || !result.has(rec.target)) result.set(rec.target, decision);
  }
  return result;
}

export function renderSwitchOffs(
  comments: SwitchOffComment[],
  settings: SwitchOffSetting[],
): string {
  const lines: string[] = [];
  for (const item of comments) {
    lines.push(
      `- comment ${item.path}:${item.line} ${item.form} ${item.rules} -- reason: ` +
        `${item.reason ?? "missing"} (id ${item.id})${item.approved ? " (approved)" : ""}`,
    );
  }
  const ordered = [...settings].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const item of ordered) {
    lines.push(
      `- settings ${item.path} (${item.change}) (id ${item.id})${item.approved ? " (approved)" : ""}`,
    );
    const longestFence = Math.max(
      0,
      ...[...item.diff.matchAll(/`+/gu)].map((match) => match[0].length),
    );
    const fence = "`".repeat(Math.max(3, longestFence + 1));
    lines.push(`${fence}diff`);
    lines.push(item.diff === "" ? "(no textual diff)" : item.diff);
    lines.push(fence);
  }
  return `## Switch-offs\n\n${lines.length > 0 ? lines.join("\n") : "none"}\n`.replace(
    /<!--/gu,
    "&lt;!--",
  );
}

export function inspectSwitchOffs(options: {
  repo: string;
  defaultRef: string;
  ticketRef: string;
  dispatch?: string;
}): SwitchOffReport {
  const repo = resolve(options.repo);
  const defaultHead = commitOfRef(repo, options.defaultRef);
  const ticketHead = commitOfRef(repo, options.ticketRef);
  let base: string;
  try {
    base = git(repo, ["merge-base", defaultHead, ticketHead]).trim();
  } catch {
    throw new Error(`no merge base of ${options.defaultRef} and ${options.ticketRef}`);
  }
  if (base === "")
    throw new Error(`no merge base of ${options.defaultRef} and ${options.ticketRef}`);
  const comments = addedSwitches(repo, base, ticketHead);
  const settings = settingsChanges(repo, base, ticketHead);
  const warnings: string[] = [];
  const logged =
    options.dispatch === undefined
      ? new Map<string, "approved" | "refused">()
      : approvals(options.dispatch, (message) => warnings.push(message));
  for (const message of warnings) console.error(`switch-offs: ${message}`);
  const listedComments: SwitchOffComment[] = comments.map((entry) => ({
    id: entry.id,
    path: entry.file,
    line: entry.line,
    form: entry.form,
    rules: entry.rules,
    reason: entry.reason,
    approved: logged.get(entry.id) === "approved",
  }));
  const listedSettings: SwitchOffSetting[] = settings.map((entry) => ({
    id: entry.id,
    path: entry.file,
    change: entry.change,
    diff: entry.diff,
    approved: logged.get(entry.id) === "approved",
  }));
  const open = [
    ...listedComments.map((entry) => entry.id),
    ...listedSettings.map((entry) => entry.id),
  ].filter((id) => logged.get(id) !== "approved");
  const refused = open.some((id) => logged.get(id) === "refused");
  const missingReason = listedComments.some((entry) => entry.reason === null);
  const status: SwitchOffStatus = refused
    ? "refused"
    : missingReason
      ? "no reason"
      : open.length > 0
        ? "held"
        : "clear";
  return {
    status,
    comments: listedComments,
    settings: listedSettings,
    output: renderSwitchOffs(listedComments, listedSettings),
  };
}
