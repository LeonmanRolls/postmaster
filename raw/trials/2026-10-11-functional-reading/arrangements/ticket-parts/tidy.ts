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
  TECH_NOTES_RE,
  agentsIndex,
  fenceMap,
  isFence,
  type Level3Section,
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

// --- types ------------------------------------------------------------------------------------
export interface Finding {
  line: number;
  kind: string;
  text: string;
}

export interface Report {
  findings: Finding[];
  notes: string[];
}

// A criterion or a decision: the line it starts on (1-based), its id and its whole text.
interface Item {
  line: number;
  id: number;
  text: string;
}

// An item whose lines are still being read.
interface OpenItem {
  line: number;
  id: number;
  parts: string[];
}

// One entry of the Checks list: its line (1-based) and the criterion id it is labelled with.
interface CheckLabel {
  line: number;
  id: number;
}

// The sections of the agents' part that later steps read; each is undefined when the ticket has none.
interface AgentsSections {
  checks: Level3Section | undefined;
  techNotes: Level3Section | undefined;
}

// Says whether a line index of the whole text lies in a fenced block of the agents' part.
type FenceTest = (at: number) => boolean;

// --- widths -----------------------------------------------------------------------------------
// How many characters of the offending text a finding quotes, by kind of finding.
const CODE_SPAN_WIDTH = 50;
const LINK_WIDTH = 80;
const RULE_MATCH_WIDTH = 60;
const DRAFT_WIDTH = 60;
const NOTE_WIDTH = 50;

// --- patterns ---------------------------------------------------------------------------------
// Inline code and links: the sentence count masks them and the plain-part rules read around them.
const TICK = "`";
const URL_RE = /https?:\/\/[^ \t)\]>]+/gu;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/u;

// What the sentence count masks, and what ends a sentence.
const ABBREVIATION_RE = /(?<![\p{L}\p{N}])(?:e\.g|i\.e|etc|vs|approx)\./giu;
const DECIMAL_RE = /([0-9])\.([0-9])/gu;
const SENTENCE_END_RE = /[.!?]+["')\]*]*(?=[ \t\n]+[\p{Lu}([*"'#]|[ \t\n]*$)/gu;
const FINAL_STOP_RE = /[.!?]["')\]*]*$/u;

// A ticket that is not yet approved says so on its first non-empty line.
const DRAFT_MARKER = "DRAFT:";

// The rules for the plain part, in the order PLAIN_RULES runs them. Each names the kind it finds.
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
// A link that points at code, and the line anchor a link may carry.
const CODE_LINK_RE = /\/(?:blob|tree|commit)\//u;
const URL_ANCHOR_RE = /#L[0-9]+(?:-L[0-9]+)?/u;

// The shape of a ticket: headings, list items and tag groups.
const CRITERIA_RE = /^##[ \t]+acceptance criteria[ \t]*$/iu;
const LEVEL2_HEADING_RE = /^##[ \t]/u;
const HEADING_RE = /^#{1,6}[ \t]/u;
const ANY_MARKER_RE = /^(?:[-*]|[0-9]+\.)[ \t]+/u;
const BULLET_RE = /^[-*][ \t]+/u;
const CRITERION_RE = /^([0-9]+)\.[ \t]+/u;
const DECISION_RE = /^[-*][ \t]+\*\*D([0-9]+)/u;
const MARK_RE = /^[-*][ \t]+\*\*D([0-9]+) \((?:proposed|given by the user)\)\*\*/u;
const DECISION_MARK_TEXT_RE = /^[-*][ \t]+\*\*D[0-9]+([^*]*)\*\*/u;
const CHECKS_TITLE_RE = /^checks$/iu;
const CHECK_LABEL_RE = /^(?:[-*]|[0-9]+\.)[ \t]+\**C([0-9]+)(?![\p{L}\p{N}])/u;
// TAG_RE finds every tag group on a line, so it is global; TAG_ONE_RE is the same pattern for
// test(), which a global pattern would make remember where it stopped.
const TAG_RE = /\(((?:[CD][0-9]+)(?:[ \t]*,[ \t]*[CD][0-9]+)*)\)/gu;
const TAG_ONE_RE = /\(((?:[CD][0-9]+)(?:[ \t]*,[ \t]*[CD][0-9]+)*)\)/u;
// What an item's text starts with: the number of a criterion, or the bold id and mark of a decision.
const CRITERION_HEAD_RE = /^[0-9]+\.[ \t]+/u;
const DECISION_HEAD_RE = /^[-*][ \t]+\*\*D[0-9]+[^*]*\*\*/u;

// --- text helpers -----------------------------------------------------------------------------
// Collapse runs of white space, then cut to `max` characters, ending in "..." when it was cut.
function clip(text: string, max: number): string {
  const collapsed = text.replace(/[ \t\n]+/gu, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 3)}...` : collapsed;
}

function wordCount(text: string): number {
  return text.split(/[ \t\n]+/u).filter((word) => word !== "").length;
}

// Blank the inline code spans of a line, keeping its length, so that an example is not read as text.
function blankCode(line: string): string {
  let blanked = "";
  let pos = 0;
  while (pos < line.length) {
    if (line[pos] === TICK) {
      const closeAt = line.indexOf(TICK, pos + 1);
      if (closeAt < 0) {
        // No closing backtick: the rest of the line is kept as it is.
        blanked += line.slice(pos);
        break;
      }
      blanked += " ".repeat(closeAt - pos + 1);
      pos = closeAt + 1;
    } else {
      blanked += line[pos];
      pos += 1;
    }
  }
  return blanked;
}

// The number of sentences in an item's text: ends of a sentence are . ! or ? followed by a capital
// letter, an opening bracket or the end. Links, inline code, abbreviations and decimals are masked.
export function countSentences(text: string): number {
  let masked = text.replace(
    URL_RE,
    (url) => `link${url.match(TRAILING_PUNCTUATION_RE)?.[0] ?? ""}`,
  );
  masked = blankCode(masked);
  masked = masked.replace(ABBREVIATION_RE, "x");
  masked = masked.replace(DECIMAL_RE, "$1$2");
  masked = masked.trim();
  if (masked === "") return 0;
  const ends = masked.match(SENTENCE_END_RE);
  let count = ends ? ends.length : 0;
  // A last sentence with no final stop is still a sentence.
  if (!FINAL_STOP_RE.test(masked)) count += 1;
  return count;
}

// --- plain-part rules -------------------------------------------------------------------------
function overlaps(spans: Array<[number, number]>, from: number, to: number): boolean {
  return spans.some(([spanFrom, spanTo]) => from < spanTo && spanFrom < to);
}

// A backtick: the span from it to the next one, or the rest of the line when none closes it.
function reportCodeSpan(line: string, lineNumber: number, out: Finding[]): void {
  const open = line.indexOf(TICK);
  if (open < 0) return;
  const close = line.indexOf(TICK, open + 1);
  const span = close > open ? line.slice(open, close + 1) : line.slice(open);
  out.push({ line: lineNumber, kind: "code", text: clip(span, CODE_SPAN_WIDTH) });
}

// A link that points at code, or at a line of it. Links to issues and pull requests are fine.
function reportLinks(line: string, lineNumber: number, out: Finding[]): void {
  for (const match of line.matchAll(URL_RE)) {
    const url = match[0];
    if (CODE_LINK_RE.test(url) || url.includes("raw.githubusercontent")) {
      out.push({ line: lineNumber, kind: "codelink", text: clip(url, LINK_WIDTH) });
    }
    const anchor = url.match(URL_ANCHOR_RE);
    if (anchor) out.push({ line: lineNumber, kind: "line", text: anchor[0] });
  }
}

// The rules of PLAIN_RULES over the line with its links blanked. A match that overlaps one already
// reported is dropped, so a path that ends in a file name is one finding and not two.
function reportRuleMatches(line: string, lineNumber: number, out: Finding[]): void {
  const rest = line.replace(URL_RE, (url) => " ".repeat(url.length));
  const claimed: Array<[number, number]> = [];
  for (const [kind, rule] of PLAIN_RULES) {
    for (const match of rest.matchAll(rule)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (overlaps(claimed, from, to)) continue;
      claimed.push([from, to]);
      out.push({ line: lineNumber, kind, text: clip(match[0], RULE_MATCH_WIDTH) });
    }
  }
}

// The findings of one line of the plain part, pushed onto `out`.
function plainLineFindings(line: string, lineNumber: number, out: Finding[]): void {
  reportCodeSpan(line, lineNumber, out);
  reportLinks(line, lineNumber, out);
  reportRuleMatches(line, lineNumber, out);
}

// --- parsing ----------------------------------------------------------------------------------
// The items that start at column 0 with startRe, from line index `from` up to `to`: each runs until
// the next list marker or heading at column 0.
function collectItems(lines: string[], from: number, to: number, startRe: RegExp): Item[] {
  const items: Item[] = [];
  let open: OpenItem | null = null;
  const finishOpenItem = (): void => {
    if (open) items.push({ line: open.line, id: open.id, text: open.parts.join(" ").trim() });
    open = null;
  };
  for (let at = from; at < to; at++) {
    const line = lines[at];
    const head = startRe.exec(line);
    if (head) {
      finishOpenItem();
      open = { line: at + 1, id: Number(head[1]), parts: [line] };
    } else if (ANY_MARKER_RE.test(line) || HEADING_RE.test(line)) {
      finishOpenItem();
    } else if (open) {
      open.parts.push(line);
    }
  }
  finishOpenItem();
  return items;
}

function stripItemHead(item: Item): string {
  return item.text.replace(CRITERION_HEAD_RE, "").replace(DECISION_HEAD_RE, "").trim();
}

// The last criterion is set aside when it asks for a fixture run: its text says "fixture run" and
// "scores clean", in any case. No other criterion is set aside, and at most one is: a fixture line
// worded otherwise, or not last, is counted, so a mistake adds a warning and never hides one.
function asksForFixtureRun(criterion: Item | undefined): boolean {
  if (criterion === undefined) return false;
  // LOWER: lowered for an ASCII phrase match; a miss only adds a warning
  const text = stripItemHead(criterion).toLowerCase();
  return text.includes("fixture run") && text.includes("scores clean");
}

// --- the check --------------------------------------------------------------------------------
// `analyze` is a run of steps, each of which reports onto the list of findings it is handed.
function addFinding(findings: Finding[], line: number, kind: string, text: string): void {
  findings.push({ line, kind, text });
}

// The index of the first non-empty line when it starts DRAFT:, otherwise -1.
function draftLineIndex(lines: string[]): number {
  const first = lines.findIndex((line) => line.trim() !== "");
  return first >= 0 && lines[first].startsWith(DRAFT_MARKER) ? first : -1;
}

// Walk the plain part, the lines before the agents' heading, and report what a person who does not
// know the code would stumble on. Returns its words: headings, fenced blocks and the DRAFT marker
// line are not counted.
function scanPlainPart(lines: string[], end: number, draftAt: number, findings: Finding[]): number {
  let insideFence = false;
  let words = 0;
  for (let at = 0; at < end; at++) {
    const line = lines[at];
    if (at === draftAt) continue;
    if (isFence(line)) {
      // A block is one finding, at its opening fence.
      if (!insideFence) addFinding(findings, at + 1, "code", "fenced block");
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    plainLineFindings(line, at + 1, findings);
    if (!HEADING_RE.test(line)) words += wordCount(line);
  }
  return words;
}

// The index of the `## Acceptance criteria` heading in the plain part, or -1.
function criteriaHeadingIndex(lines: string[], agentsAt: number): number {
  return lines.findIndex((line, at) => at < agentsAt && CRITERIA_RE.test(line));
}

// The numbered criteria under that heading, up to the next level-2 heading or the agents' heading.
function collectCriteria(lines: string[], headingAt: number, agentsAt: number): Item[] {
  if (headingAt < 0) return [];
  let end = agentsAt;
  const nextHeading = lines.findIndex(
    (line, at) => at > headingAt && at < agentsAt && LEVEL2_HEADING_RE.test(line),
  );
  if (nextHeading >= 0) end = nextHeading;
  return collectItems(lines, headingAt + 1, end, CRITERION_RE);
}

// A decision's mark is one of two. Anything else is a finding that shows what was written instead.
function checkDecisionMarks(lines: string[], decisions: Item[], findings: Finding[]): void {
  for (const decision of decisions) {
    const head = lines[decision.line - 1];
    if (MARK_RE.test(head)) continue;
    const written = DECISION_MARK_TEXT_RE.exec(head)?.[1].trim();
    const shown = written || "none";
    const text = `D${decision.id} has the mark ${shown}; use (proposed) or (given by the user)`;
    addFinding(findings, decision.line, "mark", text);
  }
}

// The line each decision id is declared on. An id declared a second time is a finding.
function declareDecisions(decisions: Item[], findings: Finding[]): Map<number, number> {
  const declared = new Map<number, number>();
  for (const decision of decisions) {
    const firstLine = declared.get(decision.id);
    if (firstLine !== undefined) {
      const text = `D${decision.id} is declared twice (lines ${firstLine} and ${decision.line})`;
      addFinding(findings, decision.line, "decision", text);
    } else declared.set(decision.id, decision.line);
  }
  return declared;
}

// The sections the agents' part needs. Each one missing is a finding at the agents' heading; a
// Verified-at title with no commit is a finding at that section's own line.
function findAgentsSections(
  lines: string[],
  agentsAt: number,
  findings: Finding[],
): AgentsSections {
  // The level-3 sections of the agents' part, read the shared way: the cut reads them too.
  const sections = level3Sections(lines, agentsAt + 1);
  const checks = sections.find((section) => CHECKS_TITLE_RE.test(section.title));
  const techNotes = sections.find((section) => TECH_NOTES_RE.test(section.title));
  const verified = verifiedSection(lines, agentsAt);
  const headingLine = agentsAt + 1;
  if (!checks) {
    addFinding(findings, headingLine, "part", 'no "### Checks" section under "## For the agents"');
  }
  if (!techNotes) {
    const text = 'no "### Technical notes" section under "## For the agents"';
    addFinding(findings, headingLine, "part", text);
  }
  if (!verified) {
    const text = 'no "### Verified at <sha>" section under "## For the agents"';
    addFinding(findings, headingLine, "part", text);
  } else if (verifiedAtSha(verified.title) === "") {
    const text = '"### Verified at" needs a commit of 7 to 40 hex characters';
    addFinding(findings, verified.at + 1, "part", text);
  }
  return { checks, techNotes };
}

// The items of the Checks list, and how many there are. An item with no label is a finding.
function readCheckLabels(
  lines: string[],
  checks: Level3Section,
  isFenced: FenceTest,
  findings: Finding[],
): { labels: CheckLabel[]; itemCount: number } {
  const labels: CheckLabel[] = [];
  let itemCount = 0;
  for (let at = checks.at + 1; at < checks.end; at++) {
    if (isFenced(at) || !ANY_MARKER_RE.test(lines[at])) continue;
    itemCount += 1;
    const label = CHECK_LABEL_RE.exec(lines[at]);
    if (!label) {
      const hint = `start it with its id in bold, such as "- **C${itemCount}**"`;
      addFinding(findings, at + 1, "check", `item ${itemCount} has no criterion id; ${hint}`);
      continue;
    }
    labels.push({ line: at + 1, id: Number(label[1]) });
  }
  return { labels, itemCount };
}

// The checks: one for each criterion, labelled C1 to CN, in order.
function checkCheckLabels(
  lines: string[],
  checks: Level3Section,
  criteriaCount: number,
  isFenced: FenceTest,
  findings: Finding[],
): void {
  const { labels, itemCount } = readCheckLabels(lines, checks, isFenced, findings);
  const seen = new Map<number, number>();
  let clean = true;
  for (const label of labels) {
    if (label.id < 1 || label.id > criteriaCount) {
      const text = `C${label.id} has no criterion: the plain part has ${criteriaCount}`;
      addFinding(findings, label.line, "check", text);
      clean = false;
    } else if (seen.has(label.id)) {
      const text = `C${label.id} appears twice (lines ${seen.get(label.id)} and ${label.line})`;
      addFinding(findings, label.line, "check", text);
      clean = false;
    } else {
      seen.set(label.id, label.line);
    }
  }
  for (let id = 1; id <= criteriaCount; id++) {
    if (!seen.has(id)) {
      addFinding(findings, checks.at + 1, "check", `no check for C${id}`);
      clean = false;
    }
  }
  // The order is judged only when every item is labelled and nothing else is wrong, so that one
  // mistake is not reported twice.
  if (clean && itemCount === labels.length) {
    const wrongAt = labels.findIndex((label, position) => label.id !== position + 1);
    if (wrongAt >= 0) {
      const wrong = labels[wrongAt];
      const text = `C${wrong.id} is out of order; expected C${wrongAt + 1} here`;
      addFinding(findings, wrong.line, "check", text);
    }
  }
}

// The decisions that a tag group cites, from the unfenced lines of the agents' part. A group that
// cites an id that does not exist is a finding. Tags in an inline code span are examples.
function citedDecisions(
  lines: string[],
  agentsStart: number,
  isFenced: FenceTest,
  declared: Map<number, number>,
  criteriaCount: number,
  findings: Finding[],
): Set<number> {
  const cited = new Set<number>();
  for (let at = agentsStart; at < lines.length; at++) {
    if (isFenced(at)) continue;
    for (const group of blankCode(lines[at]).matchAll(TAG_RE)) {
      for (const id of group[1].split(",").map((part) => part.trim())) {
        const idNumber = Number(id.slice(1));
        const isDecision = id[0] === "D";
        const exists = isDecision
          ? declared.has(idNumber)
          : idNumber >= 1 && idNumber <= criteriaCount;
        if (!exists) {
          addFinding(findings, at + 1, "note", `${group[0]} cites ${id}, which does not exist`);
        } else if (isDecision) {
          cited.add(idNumber);
        }
      }
    }
  }
  return cited;
}

// The technical notes: top-level bullets, each with its continuation lines. A note must carry a tag
// group on one of its lines. Returns how many notes there are.
function checkTechnicalNotes(
  lines: string[],
  techNotes: Level3Section | undefined,
  isFenced: FenceTest,
  findings: Finding[],
): number {
  if (!techNotes) return 0;
  const noteStarts: number[] = [];
  for (let at = techNotes.at + 1; at < techNotes.end; at++) {
    if (!isFenced(at) && BULLET_RE.test(lines[at])) noteStarts.push(at);
  }
  for (let note = 0; note < noteStarts.length; note++) {
    const from = noteStarts[note];
    const to = noteStarts[note + 1] ?? techNotes.end;
    let tagged = false;
    for (let at = from; at < to; at++) {
      if (!isFenced(at) && TAG_ONE_RE.test(blankCode(lines[at]))) tagged = true;
    }
    if (!tagged) {
      const shown = clip(lines[from].replace(BULLET_RE, ""), NOTE_WIDTH);
      const text = `technical note has no tag group such as (C9, D5): ${shown}`;
      addFinding(findings, from + 1, "note", text);
    }
  }
  return noteStarts.length;
}

// A decision that no tag group cites is a finding at the decision. Only the first declaration of an
// id is judged, since a second one is already a finding.
function checkDecisionsCited(
  decisions: Item[],
  declared: Map<number, number>,
  cited: Set<number>,
  findings: Finding[],
): void {
  for (const decision of decisions) {
    if (declared.get(decision.id) === decision.line && !cited.has(decision.id)) {
      const text = `D${decision.id} is not cited by any tag group in the agents' part`;
      addFinding(findings, decision.line, "decision", text);
    }
  }
}

// The notes: advice that never fails the check.
function buildNotes(
  plainWords: number,
  criteria: Item[],
  decisions: Item[],
  noteCount: number,
): string[] {
  const notes: string[] = [];
  notes.push(`plain part: ${plainWords} words`);
  notes.push(
    `criteria ${criteria.length}, decisions ${decisions.length}, technical notes ${noteCount}`,
  );
  const counted = criteria.length - (asksForFixtureRun(criteria.at(-1)) ? 1 : 0);
  if (counted > MAX_CRITERIA) {
    notes.push(
      `more than five criteria: ${counted}: leave work out or split the ticket by outcome`,
    );
  }
  for (const criterion of criteria) {
    const body = stripItemHead(criterion);
    const words = wordCount(body);
    const sentences = countSentences(body);
    if (words > MAX_CRITERION_WORDS || sentences > MAX_CRITERION_SENTENCES) {
      notes.push(
        `criterion ${criterion.id} (line ${criterion.line}): ${words} words, ${sentences} sentences: may be more than one idea`,
      );
    }
  }
  for (const decision of decisions) {
    const words = wordCount(stripItemHead(decision));
    if (words > MAX_DECISION_WORDS) {
      notes.push(
        `decision D${decision.id} (line ${decision.line}): ${words} words: may be more than one idea`,
      );
    }
  }
  return notes;
}

// null when the ticket has no `## For the agents` heading.
export function analyze(text: string, final: boolean): Report | null {
  const lines = text.split("\n");
  const agentsAt = agentsIndex(lines);
  if (agentsAt < 0) return null;
  const findings: Finding[] = [];

  // The draft marker.
  const draftAt = draftLineIndex(lines);
  if (draftAt >= 0 && final) {
    addFinding(findings, draftAt + 1, "draft", clip(lines[draftAt], DRAFT_WIDTH));
  }

  // The plain part.
  const plainWords = scanPlainPart(lines, agentsAt, draftAt, findings);
  const criteriaAt = criteriaHeadingIndex(lines, agentsAt);
  const criteria = collectCriteria(lines, criteriaAt, agentsAt);
  const decisions = collectItems(lines, 0, agentsAt, DECISION_RE);
  checkDecisionMarks(lines, decisions, findings);
  const declared = declareDecisions(decisions, findings);
  const criteriaCount = criteria.length;
  if (criteriaCount === 0) {
    const reportAt = criteriaAt >= 0 ? criteriaAt + 1 : 1;
    addFinding(findings, reportAt, "part", "the plain part has no numbered acceptance criteria");
  }

  // The agents' part.
  const agentsStart = agentsAt + 1;
  const fenced = fenceMap(lines, agentsStart, lines.length);
  const isFenced: FenceTest = (at) => fenced[at - agentsStart];
  const { checks, techNotes } = findAgentsSections(lines, agentsAt, findings);
  if (checks && criteriaCount > 0) {
    checkCheckLabels(lines, checks, criteriaCount, isFenced, findings);
  }

  // The tags: every group cites an id that exists, every note carries one, every decision is cited.
  const cited = citedDecisions(lines, agentsStart, isFenced, declared, criteriaCount, findings);
  const noteCount = checkTechnicalNotes(lines, techNotes, isFenced, findings);
  checkDecisionsCited(decisions, declared, cited, findings);

  const notes = buildNotes(plainWords, criteria, decisions, noteCount);
  findings.sort((earlier, later) => earlier.line - later.line);
  return { findings, notes };
}

// --- entry ------------------------------------------------------------------------------------
const USAGE = "usage: run ticket-parts <body-file> [--final]";

// The exit codes, as the header describes them.
const EXIT_FIT = 0;
const EXIT_FINDINGS = 1;
const EXIT_UNUSABLE = 2;

// The one file and the --final flag, or null when the arguments are not exactly that.
function parseArgs(argv: string[]): { file: string; final: boolean } | null {
  let final = false;
  const files: string[] = [];
  for (const arg of argv) {
    if (arg === "--final") final = true;
    else if (arg.startsWith("-")) return null;
    else files.push(arg);
  }
  return files.length === 1 ? { file: files[0], final } : null;
}

function printReport(report: Report): void {
  for (const finding of report.findings) {
    console.log(`line ${finding.line}: ${finding.kind}: ${finding.text}`);
  }
  for (const note of report.notes) console.log(note);
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return EXIT_UNUSABLE;
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch (error) {
    console.error(
      `ticket-parts: cannot read ${args.file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_UNUSABLE;
  }
  const report = analyze(normalizeTicket(text), args.final);
  if (!report) {
    console.error('ticket-parts: no "## For the agents" section');
    return EXIT_UNUSABLE;
  }
  printReport(report);
  return report.findings.length > 0 ? EXIT_FINDINGS : EXIT_FIT;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
