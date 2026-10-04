// The landing's deterministic checks. The runbooks call this script instead of restating its
// predicates in prose; what it prints is the answer, and prose carries only what an agent must
// judge, such as putting a non-pass to the user.
//
//   run landing already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha>
//       --card-head <sha> [--local-ticket <branch>] [--pr-merge <sha> --pr-head <sha>]
//       whether the ticket branch already landed. `landed` when the default branch contains
//       the ticket's HEAD and that HEAD is not the run's BASE, or when the provider reports
//       the pull request merged at the card's HEAD: --pr-merge names the merge commit it
//       reports, --pr-head the head it reports the pull request merged at, the merge is on
//       the default branch, and the reported head equals the card's HEAD. No content is
//       compared: a squash or rebase merge counts only as one the provider reports, with
//       both SHAs from its report, never from the local ticket ref, so a pruned or deleted
//       branch still answers. `unpushed` when --local-ticket names the local branch, it is
//       at the card's HEAD, and the ticket ref is behind that HEAD: push, re-fetch, and ask
//       again. `re-verify`, never `landed`, when the ticket ref and the card's HEAD
//       otherwise differ, or when a reported merge names another head: a reported
//       head that does not resolve locally names another head too, since the card's
//       HEAD resolved. Otherwise `not-landed`.
//   run landing anything-to-land --repo <repo> --default <branch> --ticket <ref> --base <sha>
//       whether the branch holds anything to land. `nothing-to-land` when the ticket's diff
//       against BASE is empty (its HEAD is BASE, whatever the default branch holds), or when
//       the default branch contains its HEAD. Otherwise `land`: a squash merge the provider
//       did not report is out of scope, and the pull request shows a person what landed.
//   run landing fresh --repo <repo> --default <branch> --ticket <ref>
//       --dispatch <dispatch> --wt <synthesis-wt>
//       whether the ticket is fresh to land. Prints `fresh` when the ticket branch contains
//       the current default branch, the worktree is at the ticket's head, and `run verify
//       results` shows the gate passing at that head. Otherwise one fault line each for the
//       head the worktree is not at, the default branch the ticket lacks, and the gate
//       that is not passing.
//   run landing results <dispatch> <synthesis-wt>
//       every recorded check's result at the worktree's HEAD, one `name: result` line each,
//       as the cards carry them. This is the one place the vocabulary mapping lives:
//       `no result logged` reads as `not run`, and the `at ...` suffix is dropped.
//   run landing card-block <dispatch> <synthesis-wt> <checkpoint>
//       the card's checked sections rendered from their sources as one exact block of
//       text: `## Checks` with one `- <name>: <result>` bullet per recorded check in
//       recorded order, then `## Open findings` with one `- [<severity>] <id>` bullet
//       per open checkpoint finding in file order, then `## Not re-reviewed` with one
//       `- [<severity>] <id>` bullet per user-applied finding in file order; an empty
//       section renders as `none`. The checkpoint gives each finding one bullet
//       `- [<severity>] <id>: <state>` with the state `open`, `closed round <n>`,
//       `dismissed: <reason>`, or `applied on user word, not re-reviewed`; a `-`, `*`
//       or `+` bullet starting `[`, or a numbered or bare line shaped as a finding
//       (`[` plus severity digit, an id, then a colon or end of line), that is not
//       such a finding is an input fault. A fence marker line is an input fault too.
//       The review leg writes this block into the card verbatim. Prints the block.
//   run landing card-results <dispatch> <synthesis-wt> <checkpoint> <card>
//   run landing card-findings <dispatch> <synthesis-wt> <checkpoint> <card>
//       whether the card holds the block `card-block` renders, as an exact, contiguous
//       byte string, found once. Nothing is parsed: a card holding `<!--` anywhere is an
//       input fault, and otherwise a card whose block differs in any way, or that holds
//       it never or more than once, is an input fault, never `match`. A card quoting
//       `<!--` escapes it, for example as `&lt;!--`. A copy inside a
//       code fence is text a reader sees, so it counts like any other copy.
//   run landing card-open <checkpoint>
//       the checkpoint's open P1 and P2 findings, one `- [<severity>] <id>` bullet
//       each, or `none`. Open P3 residue prints `none`: it lands.
//   run landing journey <dispatch> <synthesis-wt> <waybill>
//       whether the journey holds landing. Whether the waybill mentions a user journey
//       is asked of `run ticket-check --has-journey`, the flow's one reading of a ticket.
//       `clear` when no check's source names `web-journey`, or when the report exists and
//       the journey check passed. `blocked` when the waybill mentions one, a check uses
//       `web-journey`, and the report is missing or the check did not run: missing
//       evidence, not a result to weigh. `judge` when the waybill mentions none, or the
//       journey check failed with its report written: the postmaster weighs it like any
//       other non-pass.
//   run landing switch-offs --repo <repo> --default <branch> --ticket <ref>
//       every switch-off comment and check-settings change the ticket's head adds over the
//       merge base of the ticket and the default branch. Only real comments count: strings,
//       template-literal text and regex literals are not comments, and only TypeScript's,
//       the linter's (eslint and oxlint spellings) and Biome's forms switch anything off. A
//       settings file anywhere in the tree (the tsconfig*, jsconfig*, oxlint, eslint, biome,
//       prettier and bunfig names, plus package.json when its scripts or a tool's settings
//       block changes) is one entry with its diff when its content changes. Prints a status
//       line — `clear`, `held` or `no reason` — then the `## Switch-offs` section: one line
//       per added comment with its file, line, form, rules, reason and identity, one line
//       per added settings file with its diff, or `none`. What the merge base already holds
//       is not added, so a switch-off that main has is never listed, and removing a
//       switch-off is not listed either. An identity the project's ledger at the repo holds
//       an `approved` switch-off line for is marked `(approved)` and does not hold the
//       branch; a `refused` line does not clear it.
//   exit 0  already-landed, anything-to-land, results, card-block, card-open: the answer,
//           printed; card-results, card-findings: `match`; journey: `clear` or `judge`;
//           fresh: `fresh`; switch-offs: `clear`, every added entry approved or none added
//   exit 1  usage; a resolving input that does not resolve (--default, --base,
//           --card-head, --local-ticket, --pr-merge, and --ticket without a
//           report: --pr-head answers `re-verify` instead); a file that cannot
//           be read; checks
//           that cannot be recorded-read; `run verify results`, `journey-path` or
//           `run ticket-check --has-journey` failing; a checkpoint whose structure cannot
//           be read (a duplicate id, a finding-shaped line that is not a finding, an
//           unreadable state, a fence marker line, or a quoted line); a card holding an
//           HTML comment or not holding the rendered block exactly once; switch-offs: a
//           ticket or default that does not resolve, no merge base, a diff that fails
//   exit 2  fresh: the faults, one line each; journey: `blocked`; switch-offs: `held`,
//           every unapproved entry carries its reason
//   exit 3  switch-offs: `no reason`, an unapproved entry has no reason beside it
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  D_CLASS,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyRstrip,
  pySplitLines,
  pyTrim,
  pyWords,
} from "./lib/text.ts";

const SCRIPTS = scriptsDir(import.meta);
const VERIFY = join(SCRIPTS, "run");
const TICKET_CHECK = join(SCRIPTS, "run");

// The bash revision unsets these for the whole script; the port drops them on every git,
// verify and ticket-check call instead.
const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

class LandingFailure extends Error {
  constructor(
    readonly text: string,
    readonly code: number,
  ) {
    super(text);
  }
}

function die(msg: string): never {
  throw new LandingFailure(`landing: ${msg}`, 1);
}

function usage(msg: string): never {
  throw new LandingFailure(msg, 1);
}

// --- patterns ---------------------------------------------------------------------------
// Every pattern is built from lib/text.ts atoms: PY_S_CLASS for BASE `\s`, D_CLASS for
// BASE `\d`, PY_DOT for BASE `.`, END_OF_STRING for BASE `$`. The ASCII ranges ([a-z],
// [A-Za-z0-9], [P123]) are BASE's literal classes, not case tricks: the one
// case-insensitive atom, the finding severity BASE spells `[Pp]`, is matched around
// and folded with pyLower (see isFindingShaped), never with an i flag, which would
// widen the ASCII id classes to Kelvin K and the long s (differenced).
export const RESULT_LINE = new RegExp(`^([a-z][a-z0-9-]*): (${PY_DOT}*)${END_OF_STRING}`, "u");
export const RESULT_WORD = new RegExp("^(pass|fail|not run),", "u");
export const FENCE_MARK = new RegExp(
  `^[${PY_S_CLASS}]*(?:(?:[-*+]|[${D_CLASS}]{1,9}[.)])[${PY_S_CLASS}]+)?(\`{3,}|~{3,})`,
  "u",
);
export const QUOTE_LINE = new RegExp(`^[${PY_S_CLASS}]*>`, "u");
export const FINDING_RE = new RegExp(
  `^[${PY_S_CLASS}]*[-*][${PY_S_CLASS}]+\\[(P[123])\\][${PY_S_CLASS}]+` +
    `([A-Za-z0-9][A-Za-z0-9_.+-]*)[${PY_S_CLASS}]*:[${PY_S_CLASS}]*` +
    `(${PY_DOT}+?)[${PY_S_CLASS}]*${END_OF_STRING}`,
  "u",
);
export const CLOSED_RE = new RegExp(`^closed round ([${D_CLASS}]+)${END_OF_STRING}`, "u");
export const DISMISSED_RE = new RegExp(
  `^dismissed:[${PY_S_CLASS}]*(${PY_DOT}+?)[${PY_S_CLASS}]*${END_OF_STRING}`,
  "u",
);
export const USER_APPLIED = "applied on user word, not re-reviewed";
export const FINDING_BULLET = new RegExp(`^[${PY_S_CLASS}]*[-*+][${PY_S_CLASS}]*\\[`, "u");
export const FINDING_SHAPE_HEAD = new RegExp(
  `^[${PY_S_CLASS}]*(?:[${D_CLASS}]{1,9}[.)][${PY_S_CLASS}]*)?\\[`,
  "u",
);
const SEV_DIGIT = new RegExp(`^[${D_CLASS}]${END_OF_STRING}`, "u");
export const FINDING_SHAPE_TAIL = new RegExp(
  `^\\][${PY_S_CLASS}]*[A-Za-z0-9][A-Za-z0-9_.+-]*` +
    `([${PY_S_CLASS}]*:|[${PY_S_CLASS}]*${END_OF_STRING})`,
  "u",
);

/** Whether a non-finding line is shaped as a numbered or bare finding: BASE's second
 * finding-shaped pattern, matched around the severity. The severity letter folds with
 * pyLower (only P and p fold to p, differenced full-range) and the severity digit is
 * one Unicode decimal; the head admits a single `[` anchor, so the split is exact. */
export function isFindingShaped(line: string): boolean {
  const head = FINDING_SHAPE_HEAD.exec(line);
  if (head === null) return false;
  const rest = line.slice(head[0].length);
  const [letter, digit] = [...rest];
  if (letter === undefined || digit === undefined) return false;
  if (pyLower(letter) !== "p" || !SEV_DIGIT.test(digit)) return false;
  return FINDING_SHAPE_TAIL.test(rest.slice(letter.length + digit.length));
}

export type FindingState = "open" | "closed" | "dismissed" | "user-applied";

/** BASE finding_state: the state a finding's words name, or null when unreadable. */
export function findingState(words: string): FindingState | null {
  if (words === "open") return "open";
  if (CLOSED_RE.test(words)) return "closed";
  if (DISMISSED_RE.test(words)) return "dismissed";
  if (words === USER_APPLIED) return "user-applied";
  return null;
}

/** Python repr() for the delegation-verdict slot: single quotes unless the text holds a
 * lone single quote, with backslash, control and quote escapes. A verdict is one line,
 * so only the escapes a one-line verdict can carry are spelled. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let body = "";
  for (const ch of s) {
    if (ch === "\\") body += "\\\\";
    else if (ch === "\n") body += "\\n";
    else if (ch === "\r") body += "\\r";
    else if (ch === "\t") body += "\\t";
    else if (ch === quote) body += `\\${quote}`;
    else {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < 0x20 || cp === 0x7f) body += `\\x${cp.toString(16).padStart(2, "0")}`;
      else body += ch;
    }
  }
  return `${quote}${body}${quote}`;
}

// --- git and files ----------------------------------------------------------------------
function gitOut(repo: string, args: string[]): { code: number; out: string } {
  const r = run("git", ["-C", repo, ...args], { env: UNSET_GIT });
  return { code: r.code, out: pyTrim(r.out) };
}

function revOf(repo: string, ref: string): { code: number; out: string } {
  return gitOut(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
}

function commitOf(repo: string, ref: string, what: string): string {
  const r = revOf(repo, ref);
  if (r.code !== 0 || r.out === "") die(`${what} does not resolve to a commit: ${ref}`);
  return r.out;
}

function contains(repo: string, maybeAncestor: string, ref: string): boolean {
  const r = run("git", ["-C", repo, "merge-base", "--is-ancestor", maybeAncestor, ref], {
    env: UNSET_GIT,
  });
  if (r.code !== 0 && r.code !== 1) die(`cannot test ancestry of ${maybeAncestor} in ${ref}`);
  return r.code === 0;
}

/** The paths whose content differs, by NUL-split name list. Rename detection stays off:
 * it names a rename by its new path one way and its old path the other. Submodule
 * differences are never ignored: the argv flag beats even per-submodule ignore config,
 * where -c would lose to it. A bumped gitlink is a path the ticket changed. */
function changed(repo: string, old: string, nw: string): Set<string> {
  const r = run(
    "git",
    ["-C", repo, "diff", "--no-renames", "--ignore-submodules=none", "--name-only", "-z", old, nw],
    { env: UNSET_GIT },
  );
  if (r.code !== 0) die(`cannot diff ${old} against ${nw}: ${pyTrim(r.err)}`);
  return new Set(r.out.split("\0").filter((p) => p !== ""));
}

function strerror(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return e instanceof Error ? e.message : String(e);
}

function load(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    die(`cannot read ${path}: ${strerror(e)}`);
  }
}

// --- results and checkpoints -------------------------------------------------------------
type CheckResult = [string, string];

/** [(name, result)]: run verify results with the mapping read. Only exit 1 fails the
 * read; any other exit still parses the lines, as BASE does. */
function recordedResults(dispatch: string, wt: string): CheckResult[] {
  const r = run(VERIFY, ["verify", "results", dispatch, wt], { env: UNSET_GIT });
  if (r.code === 1)
    die(`run verify results failed: ${pyTrim(r.err) || pyTrim(r.out) || "no output"}`);
  const out: CheckResult[] = [];
  for (const line of pySplitLines(r.out)) {
    const m = RESULT_LINE.exec(line);
    if (!m) die(`cannot read a results line: ${line}`);
    const rest = m[2] ?? "";
    if (rest.startsWith("no result logged")) out.push([m[1] ?? "", "not run"]);
    else {
      const w = RESULT_WORD.exec(rest);
      if (!w) die(`cannot read a results line: ${line}`);
      out.push([m[1] ?? "", w[1] ?? ""]);
    }
  }
  if (out.length === 0) die("run verify results reported no checks");
  return out;
}

/** No fence semantics: a marker line is an input fault. */
function refuseFences(text: string, which: string): void {
  for (const line of pySplitLines(text)) {
    if (FENCE_MARK.test(line)) die(`${which}: fence marker line: ${pyTrim(line)}`);
  }
}

/** Nothing is unquoted: a quoted line is an input fault. */
function refuseQuotes(text: string, which: string): void {
  for (const line of pySplitLines(text)) {
    if (QUOTE_LINE.test(line)) die(`${which}: quoted line: ${pyTrim(line)}`);
  }
}

/** Neither the card nor the checkpoint needs a comment. */
function refuseComments(text: string, which: string): void {
  if (text.includes("<!--")) die(`${which}: contains an HTML comment`);
}

interface CheckpointFinding {
  sev: string;
  fid: string;
  state: FindingState;
}

/** [(sev, fid, state)] in file order; malformed input dies. */
function checkpointStates(path: string): CheckpointFinding[] {
  const text = load(path);
  refuseComments(text, "checkpoint");
  refuseFences(text, "checkpoint");
  refuseQuotes(text, "checkpoint");
  const out: CheckpointFinding[] = [];
  for (const line of pySplitLines(text)) {
    const m = FINDING_RE.exec(line);
    if (!m) {
      if (FINDING_BULLET.test(line) || isFindingShaped(line)) {
        die(`checkpoint: not a finding: ${pyTrim(line)}`);
      }
      continue;
    }
    const sev = m[1] ?? "";
    const fid = m[2] ?? "";
    const words = m[3] ?? "";
    if (out.some((f) => f.fid === fid)) die(`checkpoint: ${fid}: listed twice`);
    const state = findingState(words);
    if (state === null) die(`checkpoint: ${fid}: unreadable state: ${words}`);
    out.push({ sev, fid, state });
  }
  return out;
}

/** The card's checked sections, byte-exact. */
function renderBlock(dispatch: string, wt: string, checkpoint: string): string {
  const checks = recordedResults(dispatch, wt);
  const states = checkpointStates(checkpoint);
  const b1 = checks.map(([name, result]) => `- ${name}: ${result}`).join("\n") || "none";
  const b2 =
    states
      .filter((f) => f.state === "open")
      .map((f) => `- [${f.sev}] ${f.fid}`)
      .join("\n") || "none";
  const b3 =
    states
      .filter((f) => f.state === "user-applied")
      .map((f) => `- [${f.sev}] ${f.fid}`)
      .join("\n") || "none";
  return `## Checks\n\n${b1}\n\n## Open findings\n\n${b2}\n\n## Not re-reviewed\n\n${b3}\n`;
}

/** match iff the card holds the block once. */
function checkBlock(dispatch: string, wt: string, checkpoint: string, card: string): number {
  const text = load(card);
  refuseComments(text, "card");
  const n = text.split(renderBlock(dispatch, wt, checkpoint)).length - 1;
  if (n === 0) die("card: does not hold the expected block");
  if (n > 1) die("card: holds the expected block more than once");
  console.log("match");
  return 0;
}

// --- switch-offs ------------------------------------------------------------------

/** One comment found in source text: its 1-based start line and the comment as
 * written, delimiters included. Strings, template-literal text and regex literals
 * are not comments. */
export interface SwitchComment {
  line: number;
  raw: string;
}

/** The tokens after which a `/` starts a regex rather than dividing. The last
 * significant token in code decides; identifiers and values divide. */
const REGEX_AFTER = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "~",
  "<",
  ">",
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "throw",
]);

/** The comments in source text, told apart from strings, template literals (with
 * `${}` scanned as code) and regex literals. A small scanner, because runtime
 * imports are Bun's built-ins and Node's standard modules: no parser at run time. */
export function scanComments(text: string): SwitchComment[] {
  const out: SwitchComment[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let last = "";
  const frames: { tpl: boolean; interp: boolean; brace: number }[] = [
    { tpl: false, interp: false, brace: 0 },
  ];
  while (i < n) {
    const f = frames[frames.length - 1]!;
    const ch = text[i]!;
    if (f.tpl) {
      if (ch === "\\") {
        if (text[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (ch === "`") {
        frames.pop();
        last = "value";
        i++;
        continue;
      }
      if (ch === "$" && text[i + 1] === "{") {
        frames.push({ tpl: false, interp: true, brace: 0 });
        i += 2;
        continue;
      }
      if (ch === "\n") line++;
      i++;
      continue;
    }
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const start = line;
      const s = i;
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      out.push({ line: start, raw: text.slice(s, i).replace(/[ \t]+$/u, "") });
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const start = line;
      const s = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line++;
        i++;
      }
      i = i < n ? i + 2 : i;
      out.push({ line: start, raw: pyRstrip(text.slice(s, i)) });
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n && text[i] !== ch) {
        if (text[i] === "\n") break;
        if (text[i] === "\\") {
          i++;
          if (i < n && text[i] === "\n") line++;
          i++;
          continue;
        }
        i++;
      }
      if (i < n && text[i] === ch) i++;
      last = "value";
      continue;
    }
    if (ch === "`") {
      frames.push({ tpl: true, interp: false, brace: 0 });
      i++;
      continue;
    }
    if (ch === "/") {
      if (REGEX_AFTER.has(last)) {
        i++;
        let cls = false;
        let closed = false;
        while (i < n && text[i] !== "\n") {
          const r = text[i]!;
          if (r === "\\") {
            i += 2;
            continue;
          }
          if (r === "[") cls = true;
          else if (r === "]") cls = false;
          else if (r === "/" && !cls) {
            i++;
            while (i < n && /[a-z]/iu.test(text[i]!)) i++;
            closed = true;
            break;
          }
          i++;
        }
        last = closed ? "value" : "/";
        continue;
      }
      last = "/";
      i++;
      continue;
    }
    if (ch === "{") {
      if (f.interp) f.brace++;
      last = "{";
      i++;
      continue;
    }
    if (ch === "}") {
      if (f.interp && f.brace === 0) {
        frames.pop();
        last = "value";
        i++;
        continue;
      }
      if (f.interp) f.brace--;
      last = "}";
      i++;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch)) {
      const s = i;
      while (i < n && /[A-Za-z0-9_$]/u.test(text[i]!)) i++;
      last = text.slice(s, i);
      continue;
    }
    if (/[0-9]/u.test(ch)) {
      while (i < n && /[0-9a-fA-FxXoObB._]/u.test(text[i]!)) i++;
      last = "value";
      continue;
    }
    last = ch;
    i++;
  }
  return out;
}

/** What a comment switches off, and how far. `line` covers its own line, `next`
 * the following one, `open` a block to its matching `close`, `file` the whole
 * file; `line-enable` closes a line directive and is never a switch-off. */
export interface SwitchOff {
  form: string;
  scope: "line" | "next" | "open" | "close" | "file" | "line-enable";
  tool: "ts" | "eslint" | "oxlint" | "biome";
  rules: string;
  reason: string;
}

const LINTER_RE =
  /^(eslint|oxlint)-(disable-line|disable-next-line|enable-line|enable-next-line|disable|enable)(?![A-Za-z0-9_-])/u;
const BIOME_RE =
  /^(biome-ignore-all|biome-ignore-start|biome-ignore-end|biome-ignore)(?![A-Za-z0-9_-])/u;
const TS_RE = /^@(ts-ignore|ts-expect-error|ts-nocheck)(?![A-Za-z0-9_-])/u;

/** Parse one comment as a switch-off directive, or null when it is not one (or,
 * for Biome, when it carries no `category: reason`, which switches nothing off).
 * A reason is the text after ` -- ` in a linter comment (or after a leading
 * `--`), any text after a TypeScript directive (a leading `--` or `:` dropped),
 * and the text after the colon in Biome's. Empty or blank text is no reason. */
export function parseSwitchOff(raw: string): SwitchOff | null {
  let body: string;
  let block = false;
  if (raw.startsWith("//")) {
    body = raw.slice(2);
  } else if (raw.startsWith("/*")) {
    block = true;
    body = raw.endsWith("*/") ? raw.slice(2, -2) : raw.slice(2);
  } else {
    return null;
  }
  body = body.trim();
  if (block) body = body.replace(/^\*+[ \t]*/u, "").trim();

  const ts = TS_RE.exec(body);
  if (ts !== null) {
    const rest = body.slice(ts[0].length).trim();
    const reason = rest.replace(/^(?:--|:)[ \t]*/u, "").trim();
    return {
      form: ts[1]!,
      scope: ts[1] === "ts-nocheck" ? "file" : "next",
      tool: "ts",
      rules: "every rule",
      reason,
    };
  }
  const lint = LINTER_RE.exec(body);
  if (lint !== null) {
    const what = lint[2]!;
    const scope: SwitchOff["scope"] =
      what === "disable"
        ? "open"
        : what === "enable"
          ? "close"
          : what === "disable-line"
            ? "line"
            : what === "disable-next-line"
              ? "next"
              : "line-enable";
    let rest = body.slice(lint[0].length).trim();
    let reason = "";
    if (rest.startsWith("-- ")) {
      reason = rest.slice(3).trim();
      rest = "";
    } else {
      const k = rest.indexOf(" -- ");
      if (k >= 0) {
        reason = rest.slice(k + 4).trim();
        rest = rest.slice(0, k).trim();
      }
    }
    return {
      form: `${lint[1]}-${what}`,
      scope,
      tool: lint[1] as "eslint" | "oxlint",
      rules: rest === "" ? "every rule" : rest,
      reason,
    };
  }
  const biome = BIOME_RE.exec(body);
  if (biome !== null) {
    const rest = body.slice(biome[0].length).trim();
    const colon = rest.indexOf(":");
    if (colon < 0) return null;
    const rules = rest.slice(0, colon).trim();
    const reason = rest.slice(colon + 1).trim();
    if (rules === "" || reason === "") return null;
    const what = biome[1]!;
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
  return null;
}

/** The identity of an added switch-off: its file, its comment text and, for a
 * line or next-line form, the trimmed text of the line it covers. The line
 * number is for the listing only: an approval holds wherever the comment moves.
 * Settings use the file's content object id at the head instead. */
function switchOffId(kind: "comment" | "settings", parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
  return `${kind}:${hex}`;
}

interface SwitchEntry {
  kind: "comment" | "settings";
  file: string;
  line: number;
  form: string;
  rules: string;
  reason: string;
  hasReason: boolean;
  raw: string;
  covered: string;
  scope: SwitchOff["scope"];
  tool: SwitchOff["tool"] | "";
  id: string;
}

/** Every directive comment in one file's text: the listed switch-offs and the
 * closes (eslint-enable, oxlint-enable, biome-ignore-end), which are never
 * listed but end the blocks an open starts. */
function commentSwitches(file: string, text: string): SwitchEntry[] {
  const lines = pySplitLines(text);
  const out: SwitchEntry[] = [];
  for (const c of scanComments(text)) {
    const off = parseSwitchOff(c.raw);
    if (off === null) continue;
    let covered = "";
    if (off.scope === "line") covered = lines[c.line - 1] ?? "";
    else if (off.scope === "next") covered = lines[c.line] ?? "";
    const trimmed = pyTrim(covered);
    out.push({
      kind: "comment",
      file,
      line: c.line,
      form: off.form,
      rules: off.rules,
      reason: off.reason,
      hasReason: off.reason !== "",
      raw: c.raw,
      covered: trimmed,
      scope: off.scope,
      tool: off.tool,
      id: switchOffId("comment", [file, c.raw, trimmed]),
    });
  }
  return out;
}

const LISTED_SCOPES = new Set<SwitchOff["scope"]>(["line", "next", "open", "file"]);

/** The switch-offs the head adds over the base, file by file: a head that holds
 * more of an identity than the base does. Removing the close that ended a block
 * widens it, so the block's open counts as added then. */
function addedSwitches(base: SwitchEntry[], head: SwitchEntry[]): SwitchEntry[] {
  const baseListed = base.filter((e) => LISTED_SCOPES.has(e.scope));
  const headListed = head.filter((e) => LISTED_SCOPES.has(e.scope));
  const have = new Map<string, number>();
  for (const e of baseListed) have.set(e.id, (have.get(e.id) ?? 0) + 1);
  const seen = new Set<string>();
  const added: SwitchEntry[] = [];
  for (const e of headListed) {
    const left = have.get(e.id) ?? 0;
    if (left > 0) {
      have.set(e.id, left - 1);
      continue;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    added.push(e);
  }
  const closes = (xs: SwitchEntry[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const e of xs) if (e.scope === "close") m.set(e.id, (m.get(e.id) ?? 0) + 1);
    return m;
  };
  const headClose = closes(head);
  const gone = new Set<string>();
  for (const [id, count] of closes(base)) {
    if (count > (headClose.get(id) ?? 0)) gone.add(id);
  }
  if (gone.size > 0) {
    const stacks = new Map<string, string[]>();
    const events = base
      .filter((e) => e.scope === "open" || e.scope === "close")
      .sort((a, b) => a.line - b.line);
    for (const e of events) {
      const stack = stacks.get(e.tool) ?? [];
      if (e.scope === "open") {
        stack.push(e.id);
      } else {
        const open = stack.pop();
        if (open !== undefined && gone.has(e.id) && !added.some((a) => a.id === open)) {
          const at = head.find((h) => h.id === open);
          if (at !== undefined) added.push(at);
        }
      }
      stacks.set(e.tool, stack);
    }
  }
  return added.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

/** The settings files a check reads, by basename anywhere in the tree. */
function settingsKind(path: string): "plain" | "package" | null {
  const base = path.split("/").pop() ?? path;
  if (base === "package.json") return "package";
  if (
    /^tsconfig.*\.json$/u.test(base) ||
    /^jsconfig.*\.json$/u.test(base) ||
    base === ".oxlintrc.json" ||
    base.startsWith(".eslintrc") ||
    base.startsWith("eslint.config.") ||
    base === ".eslintignore" ||
    /^biome\.jsonc?$/u.test(base) ||
    base.startsWith(".prettierrc") ||
    base.startsWith("prettier.config.") ||
    base === ".prettierignore" ||
    base === "bunfig.toml"
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
      parsed = JSON.parse((a ?? b)!);
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
    pa = JSON.parse(a);
    pb = JSON.parse(b);
  } catch {
    return true;
  }
  if (pa === null || typeof pa !== "object" || Array.isArray(pa)) return true;
  if (pb === null || typeof pb !== "object" || Array.isArray(pb)) return true;
  const oa = pa as Record<string, unknown>;
  const ob = pb as Record<string, unknown>;
  return ["scripts", "eslintConfig", "prettier"].some((k) => canonJson(oa[k]) !== canonJson(ob[k]));
}

function blobAt(repo: string, rev: string, path: string): string | null {
  const r = run("git", ["-C", repo, "cat-file", "blob", `${rev}:${path}`], { env: UNSET_GIT });
  if (r.code !== 0) return null;
  return r.out;
}

function blobShaAt(repo: string, rev: string, path: string): string | null {
  const r = gitOut(repo, ["rev-parse", "--verify", "--quiet", `${rev}:${path}`]);
  if (r.code !== 0 || r.out === "") return null;
  return r.out.split("\n")[0]!;
}

/** Every approval in the project's ledger: an approved switch-off line's
 * identity, whatever run it was recorded for. */
function approvalIds(repo: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
  } catch {
    return out;
  }
  for (const line of pySplitLines(text)) {
    if (pyTrim(line) === "") continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["action"] !== "switch-off") continue;
    if (typeof r["target"] !== "string" || typeof r["detail"] !== "string") continue;
    if ((pyWords(r["detail"])[0] ?? "") !== "approved") continue;
    out.add(r["target"]);
  }
  return out;
}

function switchOffs(o: string[]): number {
  if (o.length !== 6 || o[0] !== "--repo" || o[2] !== "--default" || o[4] !== "--ticket") {
    usage(SWITCH_USAGE);
  }
  const repo = o[1]!;
  const head = commitOf(repo, o[5]!, "--ticket");
  const tip = commitOf(repo, o[3]!, "--default");
  const mb = gitOut(repo, ["merge-base", tip, head]);
  if (mb.code !== 0 || mb.out === "") die(`no merge base of ${o[3]} and ${o[5]}`);
  const base = mb.out.split("\n")[0]!;
  const paths = [...changed(repo, base, head)].sort();
  const comments: SwitchEntry[] = [];
  interface SettingsEntry {
    file: string;
    id: string;
    diff: string;
  }
  const settings: SettingsEntry[] = [];
  for (const file of paths) {
    const kind = settingsKind(file);
    if (kind !== null) {
      const atBase = blobAt(repo, base, file);
      const atHead = blobAt(repo, head, file);
      const differs =
        kind === "package" ? packageSettingsDiffer(atBase, atHead) : atBase !== atHead;
      if (differs) {
        const sha = blobShaAt(repo, head, file) ?? "absent";
        const d = run("git", ["-C", repo, "diff", "--no-renames", base, head, "--", file], {
          env: UNSET_GIT,
        });
        if (d.code !== 0) die(`cannot diff ${file}: ${pyTrim(d.err)}`);
        settings.push({ file, id: switchOffId("settings", [file, sha]), diff: d.out });
      }
    }
    if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(file)) {
      const atBase = blobAt(repo, base, file);
      const atHead = blobAt(repo, head, file);
      const baseList = atBase === null ? [] : commentSwitches(file, atBase);
      const headList = atHead === null ? [] : commentSwitches(file, atHead);
      comments.push(...addedSwitches(baseList, headList));
    }
  }
  const approved = approvalIds(repo);
  const marked = (id: string): string => (approved.has(id) ? " (approved)" : "");
  const linesOut: string[] = [];
  for (const c of comments) {
    linesOut.push(
      `- comment ${c.file}:${c.line} ${c.form} ${c.rules} -- reason: ` +
        `${c.hasReason ? c.reason : "missing"} (id ${c.id})${marked(c.id)}`,
    );
  }
  settings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const s of settings) {
    linesOut.push(
      "",
      `- settings ${s.file} (id ${s.id})${marked(s.id)}`,
      "```diff",
      s.diff.replace(/\n+$/u, ""),
      "```",
    );
  }
  const openComments = comments.filter((c) => !approved.has(c.id));
  const openSettings = settings.filter((s) => !approved.has(s.id));
  let status: string;
  let code: number;
  if (openComments.length === 0 && openSettings.length === 0) {
    status = "clear";
    code = 0;
  } else if (openComments.some((c) => !c.hasReason)) {
    status = "no reason";
    code = 3;
  } else {
    status = "held";
    code = 2;
  }
  console.log(status);
  process.stdout.write(`## Switch-offs\n\n${linesOut.length > 0 ? linesOut.join("\n") : "none"}\n`);
  return code;
}

// --- modes --------------------------------------------------------------------------------
const TOP_USAGE =
  "usage: run landing already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha> " +
  "--card-head <sha> [--local-ticket <branch>] [--pr-merge <sha> --pr-head <sha>] | anything-to-land " +
  "--repo <repo> --default <branch> --ticket <ref> --base <sha> | fresh --repo <repo> --default <branch> " +
  "--ticket <ref> --dispatch <dispatch> --wt <synthesis-wt> | results <dispatch> <synthesis-wt> | " +
  "card-block <dispatch> <synthesis-wt> <checkpoint> | card-results <dispatch> <synthesis-wt> " +
  "<checkpoint> <card> | card-findings <dispatch> <synthesis-wt> <checkpoint> <card> | " +
  "card-open <checkpoint> | journey <dispatch> <synthesis-wt> <waybill> | switch-offs " +
  "--repo <repo> --default <branch> --ticket <ref>";
const ALREADY_USAGE =
  "usage: run landing already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha> " +
  "--card-head <sha> [--local-ticket <branch>] [--pr-merge <sha> --pr-head <sha>]";
const ANYTHING_USAGE =
  "usage: run landing anything-to-land --repo <repo> --default <branch> --ticket <ref> --base <sha>";
const FRESH_USAGE =
  "usage: run landing fresh --repo <repo> --default <branch> --ticket <ref> --dispatch <dispatch> " +
  "--wt <synthesis-wt>";
const RESULTS_USAGE = "usage: run landing results <dispatch> <synthesis-wt>";
const BLOCK_USAGE = "usage: run landing card-block <dispatch> <synthesis-wt> <checkpoint>";
const CRESULTS_USAGE =
  "usage: run landing card-results <dispatch> <synthesis-wt> <checkpoint> <card>";
const CFINDINGS_USAGE =
  "usage: run landing card-findings <dispatch> <synthesis-wt> <checkpoint> <card>";
const OPEN_USAGE = "usage: run landing card-open <checkpoint>";
const JOURNEY_USAGE = "usage: run landing journey <dispatch> <synthesis-wt> <waybill>";
const SWITCH_USAGE =
  "usage: run landing switch-offs --repo <repo> --default <branch> --ticket <ref>";

function alreadyLanded(o: string[]): number {
  if (
    ![10, 12, 14, 16].includes(o.length) ||
    o[0] !== "--repo" ||
    o[2] !== "--default" ||
    o[4] !== "--ticket" ||
    o[6] !== "--base" ||
    o[8] !== "--card-head"
  ) {
    usage(ALREADY_USAGE);
  }
  let i = 10;
  let local: string | null = null;
  let prMerge: string | null = null;
  let prHead: string | null = null;
  if (o.length > i && o[i] === "--local-ticket") {
    local = o[i + 1]!;
    i += 2;
  }
  if (o.length > i && o[i] === "--pr-merge") {
    if (o.length <= i + 3 || o[i + 2] !== "--pr-head") usage(ALREADY_USAGE);
    prMerge = o[i + 1]!;
    prHead = o[i + 3]!;
    i += 4;
  }
  if (i !== o.length) usage(ALREADY_USAGE);
  const repo = o[1]!;
  const def = o[3]!;
  const ticket = o[5]!;
  const base = commitOf(o[1]!, o[7]!, "--base");
  const card = commitOf(repo, o[9]!, "--card-head");
  commitOf(repo, def, "--default");
  const t = revOf(repo, ticket);
  const head = t.code === 0 && t.out !== "" ? t.out : null;
  if (head === null && prMerge === null) {
    // A pruned branch with a report still answers.
    die(`--ticket does not resolve to a commit: ${ticket}`);
  }
  if (head !== null && head !== card) {
    if (
      local !== null &&
      commitOf(repo, local, "--local-ticket") === card &&
      contains(repo, head, card)
    ) {
      console.log("unpushed");
      return 0;
    }
    console.log("re-verify");
    return 0;
  }
  if (prMerge !== null) {
    // The provider's report decides, never the local ref.
    const merge = commitOf(repo, prMerge, "--pr-merge");
    // AI1: --card-head resolved already, so a reported head that does not resolve
    // names another head; an ambiguous abbreviation fails closed here too.
    const reported = revOf(repo, prHead ?? "");
    if (reported.code !== 0 || reported.out === "" || reported.out !== card) {
      console.log("re-verify");
      return 0;
    }
    console.log(contains(repo, merge, def) ? "landed" : "not-landed");
    return 0;
  }
  if (head !== null && contains(repo, head, def) && head !== base) console.log("landed");
  else console.log("not-landed");
  return 0;
}

function anythingToLand(o: string[]): number {
  if (
    o.length !== 8 ||
    o[0] !== "--repo" ||
    o[2] !== "--default" ||
    o[4] !== "--ticket" ||
    o[6] !== "--base"
  ) {
    usage(ANYTHING_USAGE);
  }
  const repo = o[1]!;
  const def = o[3]!;
  const ticket = o[5]!;
  const base = commitOf(repo, o[7]!, "--base");
  const head = commitOf(repo, ticket, "--ticket");
  commitOf(repo, def, "--default");
  if (changed(repo, base, head).size === 0 || contains(repo, head, def)) {
    console.log("nothing-to-land");
  } else {
    console.log("land");
  }
  return 0;
}

function fresh(o: string[]): number {
  if (
    o.length !== 10 ||
    o[0] !== "--repo" ||
    o[2] !== "--default" ||
    o[4] !== "--ticket" ||
    o[6] !== "--dispatch" ||
    o[8] !== "--wt"
  ) {
    usage(FRESH_USAGE);
  }
  const repo = o[1]!;
  const def = o[3]!;
  const ticket = o[5]!;
  const dispatch = o[7]!;
  const wt = o[9]!;
  const head = commitOf(repo, ticket, "--ticket");
  const tip = commitOf(repo, def, "--default");
  const h = gitOut(wt, ["rev-parse", "HEAD"]);
  if (h.code !== 0 || h.out === "") die(`cannot read the worktree HEAD: ${wt}`);
  const here = h.out;
  const faults: string[] = [];
  if (here !== head) {
    faults.push(
      `head: the worktree is at ${here.slice(0, 12)}, the ticket at ${head.slice(0, 12)}`,
    );
  }
  if (!contains(repo, tip, head)) {
    faults.push("stale: the ticket branch does not contain the default branch");
  }
  const got = new Map<string, string>(recordedResults(dispatch, wt));
  if (!got.has("gate")) die("the record names no gate");
  if (got.get("gate") !== "pass") {
    faults.push(`gate: ${got.get("gate")} at ${here.slice(0, 12)}`);
  }
  if (faults.length > 0) {
    console.log(faults.join("\n"));
    return 2;
  }
  console.log("fresh");
  return 0;
}

/** The checks whose source names web-journey. BASE iterates the checks value and reads
 * str(source).split(":")[-1]; only a string source can end at web-journey (every other
 * JSON spelling renders without a trailing web-journey), and dicts and strings iterate
 * to non-dict items that match nothing, while other scalars are not iterable. */
function journeyNames(dispatch: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(`${dispatch}/checks.json`, "utf8")) as unknown;
  } catch {
    die(`cannot read ${dispatch}/checks.json`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    die(`cannot read ${dispatch}/checks.json`);
  }
  const rec = parsed as Record<string, unknown>;
  if (!("checks" in rec)) die(`cannot read ${dispatch}/checks.json`);
  const checks = rec["checks"];
  let items: unknown[];
  if (Array.isArray(checks)) items = checks;
  else if (typeof checks === "object" && checks !== null) items = Object.keys(checks);
  else if (typeof checks === "string") items = [...checks];
  else die(`cannot read ${dispatch}/checks.json`);
  const names: string[] = [];
  for (const c of items) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) continue;
    const cc = c as Record<string, unknown>;
    const source = cc["source"];
    const last = typeof source === "string" ? source.split(":").pop() : undefined;
    if (last === "web-journey" && typeof cc["name"] === "string") names.push(cc["name"]);
  }
  return names;
}

function journey(dispatch: string, wt: string, waybill: string): number {
  const names = journeyNames(dispatch);
  if (names.length === 0) {
    console.log("clear: no check uses web-journey");
    return 0;
  }
  const t = run(TICKET_CHECK, ["ticket-check", "--has-journey", waybill], { env: UNSET_GIT });
  const said = pyTrim(t.out);
  if (t.code !== 0 || (said !== "journey" && said !== "no journey")) {
    if (t.code !== 0) {
      die(
        `ticket-check --has-journey gave no verdict: ${pyTrim(t.err) || pyTrim(t.out) || "no output"}`,
      );
    }
    die(`ticket-check --has-journey gave no verdict: said ${pyRepr(said)}`);
  }
  if (said === "no journey") {
    console.log(
      `judge: no user journey mentioned; ${names.join(", ")} judged like any other non-pass`,
    );
    return 0;
  }
  const v = run(VERIFY, ["verify", "journey-path", wt, dispatch], { env: UNSET_GIT });
  if (v.code !== 0 || pyTrim(v.out) === "") {
    die(`run verify journey-path failed: ${pyTrim(v.err) || "no output"}`);
  }
  const report = pySplitLines(pyTrim(v.out))[0] ?? "";
  let missing: boolean;
  try {
    missing = readFileSync(report).length === 0;
  } catch {
    missing = true;
  }
  if (missing) {
    console.log(`blocked: ${names.join(", ")}: no journey report at ${report}`);
    return 2;
  }
  const got = new Map<string, string>(recordedResults(dispatch, wt));
  const judges: string[] = [];
  for (const name of names) {
    const result = got.get(name) ?? "not run";
    if (result === "not run") {
      console.log(`blocked: ${name}: not run; the journey has no evidence`);
      return 2;
    }
    if (result === "fail") judges.push(name);
  }
  if (judges.length > 0) {
    console.log(`judge: ${judges.join(", ")} failed with its report at ${report}; weigh it`);
    return 0;
  }
  console.log(`clear: ${names.join(", ")} walked: report at ${report}`);
  return 0;
}

function main(argv: string[]): number {
  try {
    const mode = argv[0];
    if (mode === "already-landed") return alreadyLanded(argv.slice(1));
    if (mode === "anything-to-land") return anythingToLand(argv.slice(1));
    if (mode === "fresh") return fresh(argv.slice(1));
    if (mode === "results") {
      if (argv.length !== 3) usage(RESULTS_USAGE);
      for (const [name, result] of recordedResults(argv[1]!, argv[2]!)) {
        console.log(`${name}: ${result}`);
      }
      return 0;
    }
    if (mode === "card-block") {
      if (argv.length !== 4) usage(BLOCK_USAGE);
      process.stdout.write(renderBlock(argv[1]!, argv[2]!, argv[3]!));
      return 0;
    }
    if (mode === "card-results" || mode === "card-findings") {
      if (argv.length !== 5) usage(mode === "card-results" ? CRESULTS_USAGE : CFINDINGS_USAGE);
      return checkBlock(argv[1]!, argv[2]!, argv[3]!, argv[4]!);
    }
    if (mode === "card-open") {
      if (argv.length !== 2) usage(OPEN_USAGE);
      const out = checkpointStates(argv[1]!)
        .filter((f) => f.state === "open" && (f.sev === "P1" || f.sev === "P2"))
        .map((f) => `- [${f.sev}] ${f.fid}`);
      console.log(out.length > 0 ? out.join("\n") : "none");
      return 0;
    }
    if (mode === "journey") {
      if (argv.length !== 4) usage(JOURNEY_USAGE);
      return journey(argv[1]!, argv[2]!, argv[3]!);
    }
    if (mode === "switch-offs") {
      if (argv.length !== 7) usage(SWITCH_USAGE);
      return switchOffs(argv.slice(1));
    }
    usage(TOP_USAGE);
  } catch (e) {
    if (e instanceof LandingFailure) {
      process.stderr.write(`${e.text}\n`);
      return e.code;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
