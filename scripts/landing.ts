// The landing's deterministic checks. The runbooks call this script instead of restating its
// predicates in prose; what it prints is the answer, and prose carries only what an agent must
// judge, such as putting a non-pass to the user.
//
//   landing.sh already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha>
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
//   landing.sh anything-to-land --repo <repo> --default <branch> --ticket <ref> --base <sha>
//       whether the branch holds anything to land. `nothing-to-land` when the ticket's diff
//       against BASE is empty (its HEAD is BASE, whatever the default branch holds), or when
//       the default branch contains its HEAD. Otherwise `land`: a squash merge the provider
//       did not report is out of scope, and the pull request shows a person what landed.
//   landing.sh fresh --repo <repo> --default <branch> --ticket <ref>
//       --dispatch <dispatch> --wt <synthesis-wt>
//       whether the ticket is fresh to land. Prints `fresh` when the ticket branch contains
//       the current default branch, the worktree is at the ticket's head, and `verify.sh
//       results` shows the gate passing at that head. Otherwise one fault line each for the
//       head the worktree is not at, the default branch the ticket lacks, and the gate
//       that is not passing.
//   landing.sh results <dispatch> <synthesis-wt>
//       every recorded check's result at the worktree's HEAD, one `name: result` line each,
//       as the cards carry them. This is the one place the vocabulary mapping lives:
//       `no result logged` reads as `not run`, and the `at ...` suffix is dropped.
//   landing.sh card-block <dispatch> <synthesis-wt> <checkpoint>
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
//   landing.sh card-results <dispatch> <synthesis-wt> <checkpoint> <card>
//   landing.sh card-findings <dispatch> <synthesis-wt> <checkpoint> <card>
//       whether the card holds the block `card-block` renders, as an exact, contiguous
//       byte string, found once. Nothing is parsed: a card holding `<!--` anywhere is an
//       input fault, and otherwise a card whose block differs in any way, or that holds
//       it never or more than once, is an input fault, never `match`. A card quoting
//       `<!--` escapes it, for example as `&lt;!--`. A copy inside a
//       code fence is text a reader sees, so it counts like any other copy.
//   landing.sh card-open <checkpoint>
//       the checkpoint's open P1 and P2 findings, one `- [<severity>] <id>` bullet
//       each, or `none`. Open P3 residue prints `none`: it lands.
//   landing.sh journey <dispatch> <synthesis-wt> <waybill>
//       whether the journey holds landing. Whether the waybill mentions a user journey
//       is asked of `ticket-check.sh --has-journey`, the flow's one reading of a ticket.
//       `clear` when no check's source names `web-journey`, or when the report exists and
//       the journey check passed. `blocked` when the waybill mentions one, a check uses
//       `web-journey`, and the report is missing or the check did not run: missing
//       evidence, not a result to weigh. `judge` when the waybill mentions none, or the
//       journey check failed with its report written: the postmaster weighs it like any
//       other non-pass.
//
//   exit 0  already-landed, anything-to-land, results, card-block, card-open: the answer,
//           printed; card-results, card-findings: `match`; journey: `clear` or `judge`;
//           fresh: `fresh`
//   exit 1  usage; a resolving input that does not resolve (--default, --base,
//           --card-head, --local-ticket, --pr-merge, and --ticket without a
//           report: --pr-head answers `re-verify` instead); a file that cannot
//           be read; checks
//           that cannot be recorded-read; `verify.sh results`, `journey-path` or
//           `ticket-check.sh --has-journey` failing; a checkpoint whose structure cannot
//           be read (a duplicate id, a finding-shaped line that is not a finding, an
//           unreadable state, a fence marker line, or a quoted line); a card holding an
//           HTML comment or not holding the rendered block exactly once
//   exit 2  fresh: the faults, one line each; journey: `blocked`
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { safePath } from "./scrub-core.ts";
import {
  D_CLASS,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pySplitLines,
  pyTrim,
} from "./lib/text.ts";

const SCRIPTS = scriptsDir(import.meta);
const VERIFY = join(SCRIPTS, "verify.sh");
const TICKET_CHECK = join(SCRIPTS, "ticket-check.sh");

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

/** [(name, result)]: verify.sh results with the mapping read. Only exit 1 fails the
 * read; any other exit still parses the lines, as BASE does. */
function recordedResults(dispatch: string, wt: string): CheckResult[] {
  const r = run(VERIFY, ["results", dispatch, wt], { env: UNSET_GIT });
  if (r.code === 1)
    die(`verify.sh results failed: ${pyTrim(r.err) || pyTrim(r.out) || "no output"}`);
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
  if (out.length === 0) die("verify.sh results reported no checks");
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

interface PrivateFinding { rule: string; file: string; line: number; commit: string }
type PrivateResolution = "removed" | "marked" | "scrubbed";

function privateFindingKey(row: PrivateFinding): string {
  return JSON.stringify([row.rule, row.file, row.line, row.commit]);
}

function jsonLines(path: string): Record<string, unknown>[] {
  let source: string;
  try { source = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    die("private-data record could not be read");
  }
  const records: Record<string, unknown>[] = [];
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || Array.isArray(value)) die("private-data record is invalid");
      records.push(value as Record<string, unknown>);
    } catch { die("private-data record is invalid"); }
  }
  return records;
}

function privateFinding(record: Record<string, unknown>): PrivateFinding {
  if (typeof record.rule !== "string" || typeof record.file !== "string" || typeof record.line !== "number" || typeof record.commit !== "string") {
    die("private-data record is invalid");
  }
  return { rule: record.rule, file: safePath(record.file), line: record.line, commit: record.commit };
}

export function privateDataBlock(dispatch: string): string {
  const detections = jsonLines(join(dispatch, "detections.jsonl"));
  const resolutions = jsonLines(join(dispatch, "detections-resolved.jsonl"));
  const found = new Map<string, PrivateFinding>();
  for (const record of detections) {
    const finding = privateFinding(record);
    found.set(privateFindingKey(finding), finding);
  }
  const resolved = new Map<string, PrivateResolution>();
  for (const record of resolutions) {
    const finding = privateFinding(record);
    const key = privateFindingKey(finding);
    if (!found.has(key)) die("private-data resolution has no finding");
    const resolution = record.resolution;
    if (resolution !== "removed" && resolution !== "marked" && resolution !== "scrubbed") die("private-data resolution is invalid");
    const previous = resolved.get(key);
    if (previous && previous !== resolution) die("private-data finding has conflicting resolutions");
    resolved.set(key, resolution);
  }
  const lines = [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, finding]) => {
    const resolution = resolved.get(key);
    if (!resolution) die("private-data finding has no resolution");
    const label = resolution === "marked" ? "marked as made-up" : resolution;
    return `- ${finding.rule} at ${finding.file}:${finding.line} (${finding.commit.slice(0, 12)}) - ${label}`;
  });
  const census = jsonLines(join(dispatch, "private-data-census.jsonl"));
  const censusRules = new Map<string, number>();
  const censusVerdicts = new Map<string, number>();
  const censusPlaces = new Set<string>();
  for (const record of census) {
    if (typeof record.rule !== "string" || (record.verdict !== "made-up" && record.verdict !== "real") || typeof record.file !== "string" || typeof record.line !== "number" || typeof record.commit !== "string") {
      die("private-data census is invalid");
    }
    const key = JSON.stringify([record.file, record.line, record.commit]);
    if (censusPlaces.has(key)) die("private-data census repeats a suspect");
    censusPlaces.add(key);
    censusRules.set(record.rule, (censusRules.get(record.rule) ?? 0) + 1);
    censusVerdicts.set(record.verdict, (censusVerdicts.get(record.verdict) ?? 0) + 1);
  }
  if (census.length > 50) die("private-data census exceeds 50 suspects");
  const censusBlock = census.length
    ? `\n## Main history census\n\n- suspects: ${census.length}\n- made-up: ${censusVerdicts.get("made-up") ?? 0}\n- real: ${censusVerdicts.get("real") ?? 0}\n\n${[...censusRules.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => `- ${count} suspect(s): ${rule}`).join("\n")}\n`
    : "";
  const benchmark = "\n## Personal-data held-out checks\n\n- heldout: 33/33 found, 2/27 raised\n- heldout2: 25/37 found, 4/23 raised\n";
  const portDecisions = "\n## Port decisions\n\n- D1: the scan runs inside this project's gate.\n- D8: untold findings take priority in the status poll.\n- D9: the steps are in stages current runs use.\n- D19: a finding is told once, even when the gate sees it again.\n";
  return `## Private data findings\n\n${lines.join("\n") || "none"}\n${censusBlock}${benchmark}${portDecisions}`;
}

function checkPrivateDataCard(dispatch: string, card: string): number {
  const text = load(card);
  refuseComments(text, "card");
  const expected = privateDataBlock(dispatch);
  const count = text.split(expected).length - 1;
  if (count !== 1) die("card: private-data findings do not match the run record");
  const scanned = run(join(SCRIPTS, "scrub-check.sh"), ["--pr-description", card], {
    env: { POSTMASTER_DETECTIONS_LOG: join(dispatch, "detections.jsonl") },
  });
  if (scanned.code !== 0) die("card: private-data scan is not clean");
  console.log("match");
  return 0;
}

// --- modes --------------------------------------------------------------------------------
const TOP_USAGE =
  "usage: landing.sh already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha> " +
  "--card-head <sha> [--local-ticket <branch>] [--pr-merge <sha> --pr-head <sha>] | anything-to-land " +
  "--repo <repo> --default <branch> --ticket <ref> --base <sha> | fresh --repo <repo> --default <branch> " +
  "--ticket <ref> --dispatch <dispatch> --wt <synthesis-wt> | results <dispatch> <synthesis-wt> | " +
  "private-data-block <dispatch> | private-data-card <dispatch> <card> | " +
  "card-block <dispatch> <synthesis-wt> <checkpoint> | card-results <dispatch> <synthesis-wt> " +
  "<checkpoint> <card> | card-findings <dispatch> <synthesis-wt> <checkpoint> <card> | " +
  "card-open <checkpoint> | journey <dispatch> <synthesis-wt> <waybill>";
const ALREADY_USAGE =
  "usage: landing.sh already-landed --repo <repo> --default <branch> --ticket <ref> --base <sha> " +
  "--card-head <sha> [--local-ticket <branch>] [--pr-merge <sha> --pr-head <sha>]";
const ANYTHING_USAGE =
  "usage: landing.sh anything-to-land --repo <repo> --default <branch> --ticket <ref> --base <sha>";
const FRESH_USAGE =
  "usage: landing.sh fresh --repo <repo> --default <branch> --ticket <ref> --dispatch <dispatch> " +
  "--wt <synthesis-wt>";
const RESULTS_USAGE = "usage: landing.sh results <dispatch> <synthesis-wt>";
const BLOCK_USAGE = "usage: landing.sh card-block <dispatch> <synthesis-wt> <checkpoint>";
const CRESULTS_USAGE =
  "usage: landing.sh card-results <dispatch> <synthesis-wt> <checkpoint> <card>";
const CFINDINGS_USAGE =
  "usage: landing.sh card-findings <dispatch> <synthesis-wt> <checkpoint> <card>";
const OPEN_USAGE = "usage: landing.sh card-open <checkpoint>";
const JOURNEY_USAGE = "usage: landing.sh journey <dispatch> <synthesis-wt> <waybill>";

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
  const t = run(TICKET_CHECK, ["--has-journey", waybill], { env: UNSET_GIT });
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
  const v = run(VERIFY, ["journey-path", wt, dispatch], { env: UNSET_GIT });
  if (v.code !== 0 || pyTrim(v.out) === "") {
    die(`verify.sh journey-path failed: ${pyTrim(v.err) || "no output"}`);
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
    if (mode === "private-data-block") {
      if (argv.length !== 2) usage("usage: landing.sh private-data-block <dispatch>");
      process.stdout.write(privateDataBlock(argv[1]!));
      return 0;
    }
    if (mode === "private-data-card") {
      if (argv.length !== 3) usage("usage: landing.sh private-data-card <dispatch> <card>");
      return checkPrivateDataCard(argv[1]!, argv[2]!);
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
