// Check a ticket in the two-part shape (skills/clerk/ticket-template.md): the plain part, which the
// user signs off, is plain, and the part for the agents follows from it.
//
//   scripts/run ticket-parts <body-file> [--final]
//
// The plain part is everything above the first `## For the agents` heading. The agents' part is
// everything below it. A first non-empty line that starts `DRAFT:` is ignored, unless --final.
//
// Findings, one per line as `line N: <kind>: <text>`, printed first:
//   in the plain part (it must read to a person who does not know the code)
//     code        a backtick, or a fenced block
//     file        a file name with an extension (ts, tsx, js, mjs, cjs, json, jsonl, toml, md, sh,
//                 py, yml, yaml, lock, txt)
//     path        a path that starts scripts/, skills/, docs/, src/, wiki/, lib/, tests/,
//                 .postmaster/, .worktrees/, .github/, ~/ or an absolute /home, /tmp, /usr, /etc,
//                 /var or /opt path. Plain words such as and/or and yes/no are not paths.
//     flag        a token that starts -- and a letter
//     line        #L<digits>, or the words line or lines and a number
//     codelink    a link containing /blob/, /tree/, /commit/ or raw.githubusercontent. Links to
//                 issues and pull requests are fine.
//     call        a name followed by ()
//     identifier  a snake_case identifier
//     mark        a decision whose mark is not (proposed) or (given by the user)
//   in the agents' part (it must follow from the plain part)
//     part        no ### Checks, ### Technical notes or ### Verified at <hex sha>; or no numbered
//                 acceptance criteria in the plain part
//     check       the Checks list is not one item for each acceptance criterion, each labelled
//                 with its id in bold, - **C3** ..., in order C1 to CN. The list marker and the
//                 bold are free; the label, the count and the order are not.
//     note        a technical note (a top-level bullet) with no tag group such as (C9, D5), or any
//                 tag group in the agents' part that cites an id that does not exist. A tag group
//                 is only a parenthesised comma-separated list of ids like C1 or D12. Tags inside
//                 a fenced block or an inline code span are examples, not citations.
//     decision    a decision that no tag group in the agents' part cites; or one declared twice
//   with --final
//     draft       the first non-empty line starts DRAFT:
//
// Notes, printed after the findings and never failing: the words in the plain part; the numbers of
// criteria, decisions and technical notes; each criterion or decision long enough to be more
// than one idea (the limits are below); and, when more than five criteria are counted, a note
// saying so and what to do instead. The last criterion is not counted when it asks for a fixture
// run; the counts note still counts every criterion.
//
// The ticket reads one file and contacts nothing.
//
//   exit 0  fit; the notes are printed
//   exit 1  findings
//   exit 2  not usable: usage, an unreadable file, or no `## For the agents` heading
import { readFileSync } from "node:fs";
import {
  type Level3Section,
  TECH_NOTES_RE,
  agentsIndex,
  fenceMap,
  isFence,
  level3Sections,
  normalizeTicket,
  verifiedAtSha,
  verifiedSection,
} from "./lib/ticket-sections.ts";

// --- limits -----------------------------------------------------------------------------------
// Soft limits for the notes. They were set from the items of a real two-part draft: 14 criteria of
// 10 to 33 words and one sentence each, and 16 decisions of 33 to 61 words in three sentences.
// At these numbers most of those items pass and only the longest print.
export const MAX_CRITERION_WORDS = 30;
export const MAX_CRITERION_SENTENCES = 2;
export const MAX_DECISION_WORDS = 60;
// A ticket has at most five acceptance criteria. Above five the check warns, in a note that never
// fails, so the clerk leaves work out or splits the ticket by outcome.
export const MAX_CRITERIA = 5;

export interface Finding {
  readonly line: number;
  readonly kind: string;
  readonly text: string;
}

export interface Report {
  readonly findings: readonly Finding[];
  readonly notes: readonly string[];
}

interface Item {
  readonly line: number;
  readonly id: number;
  readonly text: string;
}

function finding(line: number, kind: string, text: string): Finding {
  return { line, kind, text };
}

// --- text helpers -----------------------------------------------------------------------------
const TICK = "`";

function clip(s: string, n = 70): string {
  const one = s.replace(/[ \t\n]+/gu, " ").trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
}

function wordCount(s: string): number {
  return s.split(/[ \t\n]+/u).filter((w) => w !== "").length;
}

// Blank the inline code spans of a line, keeping its length, so that an example is not read as text.
// Split at the ticks, the text between a pair of them sits at an odd place. A last tick with no
// partner is left as written.
function blankCode(line: string): string {
  const parts = line.split(TICK);
  const last = parts.length - 1;
  const blanked = parts.map((part, k) => {
    if (k % 2 === 0) return part;
    return k === last ? TICK + part : " ".repeat(part.length + 2);
  });
  return blanked.join("");
}

const URL_RE = /https?:\/\/[^ \t)\]>]+/gu;

// The number of sentences in an item's text: ends of a sentence are . ! or ? followed by a capital
// letter, an opening bracket or the end. Links, inline code, abbreviations and decimals are masked.
export function countSentences(text: string): number {
  const noLinks = text.replace(URL_RE, (m) => `link${m.match(/[.,;:!?]+$/u)?.[0] ?? ""}`);
  const noCode = blankCode(noLinks);
  const noAbbreviations = noCode.replace(/(?<![\p{L}\p{N}])(?:e\.g|i\.e|etc|vs|approx)\./giu, "x");
  const noDecimals = noAbbreviations.replace(/([0-9])\.([0-9])/gu, "$1$2");
  const masked = noDecimals.trim();
  if (masked === "") return 0;
  const ends = masked.match(/[.!?]+["')\]*]*(?=[ \t\n]+[\p{Lu}([*"'#]|[ \t\n]*$)/gu);
  const stops = ends ? ends.length : 0;
  const unfinished = !/[.!?]["')\]*]*$/u.test(masked);
  return unfinished ? stops + 1 : stops;
}

// --- plain-part rules -------------------------------------------------------------------------
const PATH_RE =
  /(?<![\p{L}\p{N}_./~-])(?:(?:scripts|skills|docs|src|wiki|lib|tests|\.postmaster|\.worktrees|\.github)\/|~\/|\/(?:home|tmp|usr|etc|var|opt)\/)[^ \t)\]>,;"']*/gu;
const FILE_RE =
  /(?<![\p{L}\p{N}_])[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.(?:tsx|ts|mjs|cjs|jsonl|json|js|toml|md|sh|py|yaml|yml|lock|txt)(?![\p{L}\p{N}_])/giu;
const CALL_RE = /(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*\(\)/gu;
const IDENT_RE = /(?<![\p{L}\p{N}_])\p{L}[\p{L}\p{N}]*(?:_[\p{L}\p{N}]+)+(?![\p{L}\p{N}_])/gu;
const FLAG_RE = /(?<![\p{L}\p{N}-])--\p{L}[\p{L}\p{N}-]*/gu;
const LINE_ANCHOR_RE = /#L[0-9]+(?:-L[0-9]+)?/gu;
const LINE_WORD_RE = /(?<![\p{L}\p{N}_])lines?[ \t]+[0-9]+/giu;
const PLAIN_RULES: Array<[string, RegExp]> = [
  ["path", PATH_RE],
  ["file", FILE_RE],
  ["call", CALL_RE],
  ["identifier", IDENT_RE],
  ["flag", FLAG_RE],
  ["line", LINE_ANCHOR_RE],
  ["line", LINE_WORD_RE],
];

// One match of one rule: what it matched, and where in the line.
interface RuleMatch {
  readonly kind: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function overlaps(spans: readonly RuleMatch[], a: number, b: number): boolean {
  return spans.some((s) => a < s.end && s.start < b);
}

// Every match of every rule in the text: the rules in their order, each rule's matches left to right.
function ruleMatches(text: string): RuleMatch[] {
  return PLAIN_RULES.flatMap(([kind, re]) =>
    [...text.matchAll(re)].map((m) => {
      const start = m.index ?? 0;
      return { kind, text: m[0], start, end: start + m[0].length };
    }),
  );
}

// A match that overlaps one kept before it is dropped, so a path is not also a file name.
function withoutOverlaps(matches: readonly RuleMatch[]): RuleMatch[] {
  const keepIfClear = (kept: RuleMatch[], m: RuleMatch): RuleMatch[] =>
    overlaps(kept, m.start, m.end) ? kept : [...kept, m];
  return matches.reduce(keepIfClear, []);
}

function codeFindings(line: string, n: number): Finding[] {
  const tick = line.indexOf(TICK);
  if (tick < 0) return [];
  const close = line.indexOf(TICK, tick + 1);
  const span = close > tick ? line.slice(tick, close + 1) : line.slice(tick);
  return [finding(n, "code", clip(span, 50))];
}

function linkFindings(line: string, n: number): Finding[] {
  return [...line.matchAll(URL_RE)].flatMap((m) => {
    const url = m[0];
    const isCodeLink =
      /\/(?:blob|tree|commit)\//u.test(url) || url.includes("raw.githubusercontent");
    const anchor = url.match(/#L[0-9]+(?:-L[0-9]+)?/u);
    const codeLink = isCodeLink ? [finding(n, "codelink", clip(url, 80))] : [];
    const lineAnchor = anchor ? [finding(n, "line", anchor[0])] : [];
    return [...codeLink, ...lineAnchor];
  });
}

function plainLineFindings(line: string, n: number): Finding[] {
  const rest = line.replace(URL_RE, (m) => " ".repeat(m.length));
  const claimed = withoutOverlaps(ruleMatches(rest));
  const ruleFindings = claimed.map((m) => finding(n, m.kind, clip(m.text, 60)));
  return [...codeFindings(line, n), ...linkFindings(line, n), ...ruleFindings];
}

// --- parsing ----------------------------------------------------------------------------------
const CRITERIA_RE = /^##[ \t]+acceptance criteria[ \t]*$/iu;
const ANY_MARKER_RE = /^(?:[-*]|[0-9]+\.)[ \t]+/u;
const HEADING_RE = /^#{1,6}[ \t]/u;
const CRITERION_RE = /^([0-9]+)\.[ \t]+/u;
const DECISION_RE = /^[-*][ \t]+\*\*D([0-9]+)/u;
const MARK_RE = /^[-*][ \t]+\*\*D([0-9]+) \((?:proposed|given by the user)\)\*\*/u;
const TAG_RE = /\(((?:[CD][0-9]+)(?:[ \t]*,[ \t]*[CD][0-9]+)*)\)/gu;
const TAG_ONE_RE = /\(((?:[CD][0-9]+)(?:[ \t]*,[ \t]*[CD][0-9]+)*)\)/u;
const BULLET_RE = /^[-*][ \t]+/u;
const CHECK_LABEL_RE = /^(?:[-*]|[0-9]+\.)[ \t]+\**C([0-9]+)(?![\p{L}\p{N}])/u;

// The items that start at column 0 with startRe, from line index `from` up to `to`: each runs until
// the next list marker or heading at column 0.
function collectItems(lines: readonly string[], from: number, to: number, startRe: RegExp): Item[] {
  const region = lines.slice(from, to);
  const endsItem = (line: string): boolean =>
    startRe.test(line) || ANY_MARKER_RE.test(line) || HEADING_RE.test(line);
  return region.flatMap((head, k) => {
    const start = startRe.exec(head);
    if (!start) return [];
    const following = region.slice(k + 1);
    const stop = following.findIndex(endsItem);
    const continuation = stop < 0 ? following : following.slice(0, stop);
    const text = [head, ...continuation].join(" ").trim();
    return [{ line: from + k + 1, id: Number(start[1]), text }];
  });
}

function stripItemHead(item: Item): string {
  return item.text
    .replace(/^[0-9]+\.[ \t]+/u, "")
    .replace(/^[-*][ \t]+\*\*D[0-9]+[^*]*\*\*/u, "")
    .trim();
}

// The last criterion is set aside when it asks for a fixture run: its text says "fixture run" and
// "scores clean", in any case. No other criterion is set aside, and at most one is: a fixture line
// worded otherwise, or not last, is counted, so a mistake adds a warning and never hides one.
function isFixtureLine(criterion: Item | undefined): boolean {
  if (criterion === undefined) return false;
  // LOWER: lowered for an ASCII phrase match; a miss only adds a warning
  const text = stripItemHead(criterion).toLowerCase();
  return text.includes("fixture run") && text.includes("scores clean");
}

// --- the check --------------------------------------------------------------------------------
// The integers from `from` up to, and not including, `to`.
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
}

// Whether the line at an index of the ticket is inside a fenced block of the agents' part.
type IsFenced = (i: number) => boolean;

// The index of the marker line: the first non-empty line, when it starts DRAFT:. Otherwise -1.
function draftMarkerAt(lines: readonly string[]): number {
  const first = lines.findIndex((l) => l.trim() !== "");
  return first >= 0 && lines[first].startsWith("DRAFT:") ? first : -1;
}

function draftFindings(lines: readonly string[], marker: number, final: boolean): Finding[] {
  if (!final || marker < 0) return [];
  return [finding(marker + 1, "draft", clip(lines[marker], 60))];
}

// What reading the plain part has found so far, and whether the line reached is inside a fence.
interface PlainScan {
  readonly inFence: boolean;
  readonly findings: readonly Finding[];
  readonly words: number;
}

// The scan after one more line of the plain part. A fence line opens or closes a fenced block, and
// an opening one is a finding. A line outside a block is checked, and its words counted unless it
// is a heading.
function scanPlainLine(scan: PlainScan, line: string, n: number): PlainScan {
  if (isFence(line)) {
    const opening = scan.inFence ? [] : [finding(n, "code", "fenced block")];
    return { ...scan, inFence: !scan.inFence, findings: [...scan.findings, ...opening] };
  }
  if (scan.inFence) return scan;
  return {
    ...scan,
    findings: [...scan.findings, ...plainLineFindings(line, n)],
    words: scan.words + (HEADING_RE.test(line) ? 0 : wordCount(line)),
  };
}

// The plain part is the lines above the agents heading, except the marker line.
function readPlainPart(lines: readonly string[], ai: number, marker: number): PlainScan {
  const start: PlainScan = { inFence: false, findings: [], words: 0 };
  const readLine = (scan: PlainScan, line: string, i: number): PlainScan =>
    i === marker ? scan : scanPlainLine(scan, line, i + 1);
  return lines.slice(0, ai).reduce(readLine, start);
}

// The numbered criteria run from their heading to the next `##` heading of the plain part.
function readCriteria(lines: readonly string[], critAt: number, ai: number): Item[] {
  if (critAt < 0) return [];
  const next = lines.findIndex((l, i) => i > critAt && i < ai && /^##[ \t]/u.test(l));
  const critEnd = next >= 0 ? next : ai;
  return collectItems(lines, critAt + 1, critEnd, CRITERION_RE);
}

function noCriteriaFindings(critAt: number, N: number): Finding[] {
  if (N > 0) return [];
  const at = critAt >= 0 ? critAt + 1 : 1;
  return [finding(at, "part", "the plain part has no numbered acceptance criteria")];
}

// The line a decision id is first declared on, or undefined when it is not declared.
function declaredAt(decisions: readonly Item[], id: number): number | undefined {
  return decisions.find((d) => d.id === id)?.line;
}

function markFindings(lines: readonly string[], decisions: readonly Item[]): Finding[] {
  return decisions.flatMap((d) => {
    const head = lines[d.line - 1];
    if (MARK_RE.test(head)) return [];
    const m = /^[-*][ \t]+\*\*D[0-9]+([^*]*)\*\*/u.exec(head);
    const shown = m && m[1].trim() !== "" ? m[1].trim() : "none";
    const text = `D${d.id} has the mark ${shown}; use (proposed) or (given by the user)`;
    return [finding(d.line, "mark", text)];
  });
}

function duplicateDecisionFindings(decisions: readonly Item[]): Finding[] {
  return decisions.flatMap((d) => {
    const seen = declaredAt(decisions, d.id);
    if (seen === undefined || seen === d.line) return [];
    return [
      finding(d.line, "decision", `D${d.id} is declared twice (lines ${seen} and ${d.line})`),
    ];
  });
}

function verifiedFindings(where: number, verified: Level3Section | undefined): Finding[] {
  if (!verified) {
    return [finding(where, "part", 'no "### Verified at <sha>" section under "## For the agents"')];
  }
  if (verifiedAtSha(verified.title) === "") {
    const text = '"### Verified at" needs a commit of 7 to 40 hex characters';
    return [finding(verified.at + 1, "part", text)];
  }
  return [];
}

// A finding at the agents heading for each section it lacks.
function sectionFindings(
  where: number,
  checks: Level3Section | undefined,
  techNotes: Level3Section | undefined,
  verified: Level3Section | undefined,
): Finding[] {
  const noChecks = checks
    ? []
    : [finding(where, "part", 'no "### Checks" section under "## For the agents"')];
  const noTechNotes = techNotes
    ? []
    : [finding(where, "part", 'no "### Technical notes" section under "## For the agents"')];
  return [...noChecks, ...noTechNotes, ...verifiedFindings(where, verified)];
}

// An item of the Checks list: its line, its place in the list, and the criterion id it starts with.
interface CheckItem {
  readonly line: number;
  readonly place: number;
  readonly id: number | null;
}

// The list items of the Checks section outside fenced blocks, numbered from 1.
function readCheckItems(
  lines: readonly string[],
  checks: Level3Section,
  isFenced: IsFenced,
): CheckItem[] {
  const itemLines = range(checks.at + 1, checks.end).filter(
    (i) => !isFenced(i) && ANY_MARKER_RE.test(lines[i]),
  );
  return itemLines.map((i, k) => {
    const label = CHECK_LABEL_RE.exec(lines[i]);
    return { line: i + 1, place: k + 1, id: label ? Number(label[1]) : null };
  });
}

// The checks: one for each criterion, labelled C1 to CN, in order.
function checkListFindings(
  lines: readonly string[],
  checks: Level3Section | undefined,
  N: number,
  isFenced: IsFenced,
): Finding[] {
  if (!checks || N === 0) return [];
  const items = readCheckItems(lines, checks, isFenced);

  const unlabelled = items
    .filter((item) => item.id === null)
    .map((item) => {
      const text = `item ${item.place} has no criterion id; start it with its id in bold, such as "- **C${item.place}**"`;
      return finding(item.line, "check", text);
    });
  const labels = items.flatMap((item) =>
    item.id === null ? [] : [{ line: item.line, id: item.id }],
  );

  // A label that names no criterion, or one that an earlier label already named.
  const misplaced = labels.flatMap((l, j) => {
    if (l.id < 1 || l.id > N) {
      return [finding(l.line, "check", `C${l.id} has no criterion: the plain part has ${N}`)];
    }
    const earlier = labels.slice(0, j).find((e) => e.id === l.id);
    if (earlier) {
      const text = `C${l.id} appears twice (lines ${earlier.line} and ${l.line})`;
      return [finding(l.line, "check", text)];
    }
    return [];
  });
  const missing = range(1, N + 1)
    .filter((c) => !labels.some((l) => l.id === c))
    .map((c) => finding(checks.at + 1, "check", `no check for C${c}`));

  // Order is judged only of a list that is otherwise clean.
  const clean = misplaced.length === 0 && missing.length === 0 && unlabelled.length === 0;
  const bad = labels.findIndex((l, j) => l.id !== j + 1);
  const outOfOrder =
    clean && bad >= 0
      ? [
          finding(
            labels[bad].line,
            "check",
            `C${labels[bad].id} is out of order; expected C${bad + 1} here`,
          ),
        ]
      : [];
  return [...unlabelled, ...misplaced, ...missing, ...outOfOrder];
}

// One id of one tag group: the line the group is on, the group as written, and the id with its
// letter and number.
interface Citation {
  readonly line: number;
  readonly group: string;
  readonly id: string;
  readonly letter: string;
  readonly num: number;
}

function citationsOnLine(text: string, n: number): Citation[] {
  const groups = [...blankCode(text).matchAll(TAG_RE)];
  return groups.flatMap((group) =>
    group[1].split(",").map((part) => {
      const id = part.trim();
      return { line: n, group: group[0], id, letter: id[0], num: Number(id.slice(1)) };
    }),
  );
}

// Every id cited by a tag group in the agents' part, outside the fenced blocks.
function citationsIn(lines: readonly string[], aStart: number, isFenced: IsFenced): Citation[] {
  return range(aStart, lines.length)
    .filter((i) => !isFenced(i))
    .flatMap((i) => citationsOnLine(lines[i], i + 1));
}

// A decision id exists when the plain part declares it; a criterion id when it is one of 1 to N.
function citesExisting(c: Citation, decisions: readonly Item[], N: number): boolean {
  return c.letter === "D" ? decisions.some((d) => d.id === c.num) : c.num >= 1 && c.num <= N;
}

function danglingTagFindings(
  citations: readonly Citation[],
  decisions: readonly Item[],
  N: number,
): Finding[] {
  return citations
    .filter((c) => !citesExisting(c, decisions, N))
    .map((c) => finding(c.line, "note", `${c.group} cites ${c.id}, which does not exist`));
}

// A technical note runs from its bullet to the next bullet, or to the end of its section.
interface NoteSpan {
  readonly from: number;
  readonly to: number;
}

function technicalNoteSpans(
  lines: readonly string[],
  techNotes: Level3Section | undefined,
  isFenced: IsFenced,
): NoteSpan[] {
  if (!techNotes) return [];
  const heads = range(techNotes.at + 1, techNotes.end).filter(
    (i) => !isFenced(i) && BULLET_RE.test(lines[i]),
  );
  return heads.map((from, j) => ({ from, to: heads[j + 1] ?? techNotes.end }));
}

function untaggedNoteFindings(
  lines: readonly string[],
  spans: readonly NoteSpan[],
  isFenced: IsFenced,
): Finding[] {
  const hasTag = (i: number): boolean => !isFenced(i) && TAG_ONE_RE.test(blankCode(lines[i]));
  return spans
    .filter((span) => !range(span.from, span.to).some(hasTag))
    .map((span) => {
      const shown = clip(lines[span.from].replace(BULLET_RE, ""), 50);
      const text = `technical note has no tag group such as (C9, D5): ${shown}`;
      return finding(span.from + 1, "note", text);
    });
}

function uncitedDecisionFindings(
  decisions: readonly Item[],
  citations: readonly Citation[],
): Finding[] {
  const isCited = (d: Item): boolean => citations.some((c) => c.letter === "D" && c.num === d.id);
  return decisions
    .filter((d) => declaredAt(decisions, d.id) === d.line)
    .filter((d) => !isCited(d))
    .map((d) =>
      finding(d.line, "decision", `D${d.id} is not cited by any tag group in the agents' part`),
    );
}

function criterionNotes(criteria: readonly Item[]): string[] {
  return criteria.flatMap((c) => {
    const body = stripItemHead(c);
    const words = wordCount(body);
    const sentences = countSentences(body);
    if (words > MAX_CRITERION_WORDS || sentences > MAX_CRITERION_SENTENCES) {
      return [
        `criterion ${c.id} (line ${c.line}): ${words} words, ${sentences} sentences: may be more than one idea`,
      ];
    }
    return [];
  });
}

function decisionNotes(decisions: readonly Item[]): string[] {
  return decisions.flatMap((d) => {
    const words = wordCount(stripItemHead(d));
    if (words > MAX_DECISION_WORDS) {
      return [`decision D${d.id} (line ${d.line}): ${words} words: may be more than one idea`];
    }
    return [];
  });
}

// The counts, then the advice on criteria and decisions that are long.
function advisoryNotes(
  plainWords: number,
  criteria: readonly Item[],
  decisions: readonly Item[],
  noteCount: number,
): string[] {
  const N = criteria.length;
  const counted = N - (isFixtureLine(criteria[N - 1]) ? 1 : 0);
  const tooMany =
    counted > MAX_CRITERIA
      ? [`more than five criteria: ${counted}: leave work out or split the ticket by outcome`]
      : [];
  return [
    `plain part: ${plainWords} words`,
    `criteria ${N}, decisions ${decisions.length}, technical notes ${noteCount}`,
    ...tooMany,
    ...criterionNotes(criteria),
    ...decisionNotes(decisions),
  ];
}

// null when the ticket has no `## For the agents` heading.
export function analyze(text: string, final: boolean): Report | null {
  const lines = text.split("\n");
  const ai = agentsIndex(lines);
  if (ai < 0) return null;

  // The draft marker.
  const marker = draftMarkerAt(lines);

  // The plain part.
  const plain = readPlainPart(lines, ai, marker);
  const critAt = lines.findIndex((l, i) => i < ai && CRITERIA_RE.test(l));
  const criteria = readCriteria(lines, critAt, ai);
  const decisions = collectItems(lines, 0, ai, DECISION_RE);
  const N = criteria.length;

  // The agents' part.
  const aStart = ai + 1;
  const fenced = fenceMap(lines, aStart, lines.length);
  const isFenced = (i: number): boolean => fenced[i - aStart];
  // The level-3 sections of the agents' part, read the shared way: the cut reads them too.
  const subs = level3Sections(lines, aStart);
  const sub = (re: RegExp): Level3Section | undefined => subs.find((s) => re.test(s.title));
  const checks = sub(/^checks$/iu);
  const techNotes = sub(TECH_NOTES_RE);
  const verified = verifiedSection(lines, ai);
  const where = ai + 1;

  // The tags: every group cites an id that exists, every note carries one, every decision is cited.
  const citations = citationsIn(lines, aStart, isFenced);
  // The technical notes: top-level bullets, each with its continuation lines.
  const noteSpans = technicalNoteSpans(lines, techNotes, isFenced);

  // The findings in the order the checks run: those on one line keep that order through the sort.
  const findings = [
    ...draftFindings(lines, marker, final),
    ...plain.findings,
    ...markFindings(lines, decisions),
    ...duplicateDecisionFindings(decisions),
    ...noCriteriaFindings(critAt, N),
    ...sectionFindings(where, checks, techNotes, verified),
    ...checkListFindings(lines, checks, N, isFenced),
    ...danglingTagFindings(citations, decisions, N),
    ...untaggedNoteFindings(lines, noteSpans, isFenced),
    ...uncitedDecisionFindings(decisions, citations),
  ].toSorted((a, b) => a.line - b.line);

  // The notes.
  const notes = advisoryNotes(plain.words, criteria, decisions, noteSpans.length);
  return { findings, notes };
}

// --- entry ------------------------------------------------------------------------------------
const USAGE = "usage: run ticket-parts <body-file> [--final]";

interface Invocation {
  readonly final: boolean;
  readonly file: string;
}

// What the arguments ask for, or null when they are not usable: an unknown flag, or not one file.
function parseArgs(argv: readonly string[]): Invocation | null {
  const unknownFlag = argv.some((a) => a !== "--final" && a.startsWith("-"));
  const files = argv.filter((a) => a !== "--final" && !a.startsWith("-"));
  if (unknownFlag || files.length !== 1) return null;
  return { final: argv.includes("--final"), file: files[0] };
}

// The file's text, or the error that stopped it being read.
type FileRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: unknown };

// What the command prints on each stream, and the status it exits with.
interface Outcome {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const USAGE_OUTCOME: Outcome = { code: 2, stdout: [], stderr: [USAGE] };

function outcomeOf(read: FileRead, invocation: Invocation): Outcome {
  if (!read.ok) {
    const reason = read.error instanceof Error ? read.error.message : String(read.error);
    const message = `ticket-parts: cannot read ${invocation.file}: ${reason}`;
    return { code: 2, stdout: [], stderr: [message] };
  }
  const report = analyze(normalizeTicket(read.text), invocation.final);
  if (!report) {
    return { code: 2, stdout: [], stderr: ['ticket-parts: no "## For the agents" section'] };
  }
  const findingLines = report.findings.map((f) => `line ${f.line}: ${f.kind}: ${f.text}`);
  return {
    code: report.findings.length > 0 ? 1 : 0,
    stdout: [...findingLines, ...report.notes],
    stderr: [],
  };
}

// The edge: the one place the file is read.
function readTicketFile(file: string): FileRead {
  try {
    return { ok: true, text: readFileSync(file, "utf8") };
  } catch (error) {
    return { ok: false, error };
  }
}

// The edge: reads the file, prints what outcomeOf decided, and returns the exit status.
function main(argv: string[]): number {
  const invocation = parseArgs(argv);
  const outcome =
    invocation === null ? USAGE_OUTCOME : outcomeOf(readTicketFile(invocation.file), invocation);
  for (const line of outcome.stderr) console.error(line);
  for (const line of outcome.stdout) console.log(line);
  return outcome.code;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
