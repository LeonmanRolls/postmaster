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
  line: number;
  kind: string;
  text: string;
}

export interface Report {
  findings: Finding[];
  notes: string[];
}

interface Item {
  line: number;
  id: number;
  text: string;
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
function blankCode(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === TICK) {
      const j = line.indexOf(TICK, i + 1);
      if (j < 0) {
        out += line.slice(i);
        break;
      }
      out += " ".repeat(j - i + 1);
      i = j + 1;
    } else {
      out += line[i];
      i += 1;
    }
  }
  return out;
}

const URL_RE = /https?:\/\/[^ \t)\]>]+/gu;

// The number of sentences in an item's text: ends of a sentence are . ! or ? followed by a capital
// letter, an opening bracket or the end. Links, inline code, abbreviations and decimals are masked.
export function countSentences(text: string): number {
  let t = text.replace(URL_RE, (m) => `link${m.match(/[.,;:!?]+$/u)?.[0] ?? ""}`);
  t = blankCode(t);
  t = t.replace(/(?<![\p{L}\p{N}])(?:e\.g|i\.e|etc|vs|approx)\./giu, "x");
  t = t.replace(/([0-9])\.([0-9])/gu, "$1$2");
  t = t.trim();
  if (t === "") return 0;
  const ends = t.match(/[.!?]+["')\]*]*(?=[ \t\n]+[\p{Lu}([*"'#]|[ \t\n]*$)/gu);
  let n = ends ? ends.length : 0;
  if (!/[.!?]["')\]*]*$/u.test(t)) n += 1;
  return n;
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

function overlaps(spans: Array<[number, number]>, a: number, b: number): boolean {
  return spans.some(([x, y]) => a < y && x < b);
}

function plainLineFindings(line: string, n: number, out: Finding[]): void {
  const tick = line.indexOf(TICK);
  if (tick >= 0) {
    const close = line.indexOf(TICK, tick + 1);
    out.push({
      line: n,
      kind: "code",
      text: clip(close > tick ? line.slice(tick, close + 1) : line.slice(tick), 50),
    });
  }
  for (const m of line.matchAll(URL_RE)) {
    const url = m[0];
    if (/\/(?:blob|tree|commit)\//u.test(url) || url.includes("raw.githubusercontent")) {
      out.push({ line: n, kind: "codelink", text: clip(url, 80) });
    }
    const anchor = url.match(/#L[0-9]+(?:-L[0-9]+)?/u);
    if (anchor) out.push({ line: n, kind: "line", text: anchor[0] });
  }
  const rest = line.replace(URL_RE, (m) => " ".repeat(m.length));
  const claimed: Array<[number, number]> = [];
  for (const [kind, re] of PLAIN_RULES) {
    for (const m of rest.matchAll(re)) {
      const a = m.index ?? 0;
      const b = a + m[0].length;
      if (overlaps(claimed, a, b)) continue;
      claimed.push([a, b]);
      out.push({ line: n, kind, text: clip(m[0], 60) });
    }
  }
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
function collectItems(lines: string[], from: number, to: number, startRe: RegExp): Item[] {
  const items: Item[] = [];
  let cur: { line: number; id: number; parts: string[] } | null = null;
  const close = (): void => {
    if (cur) items.push({ line: cur.line, id: cur.id, text: cur.parts.join(" ").trim() });
    cur = null;
  };
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const start = startRe.exec(line);
    if (start) {
      close();
      cur = { line: i + 1, id: Number(start[1]), parts: [line] };
    } else if (ANY_MARKER_RE.test(line) || HEADING_RE.test(line)) {
      close();
    } else if (cur) {
      cur.parts.push(line);
    }
  }
  close();
  return items;
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
// null when the ticket has no `## For the agents` heading.
export function analyze(text: string, final: boolean): Report | null {
  const lines = text.split("\n");
  const ai = agentsIndex(lines);
  if (ai < 0) return null;
  const findings: Finding[] = [];
  const notes: string[] = [];
  const add = (line: number, kind: string, msg: string): void => {
    findings.push({ line, kind, text: msg });
  };

  // The draft marker.
  const first = lines.findIndex((l) => l.trim() !== "");
  const draft = first >= 0 && lines[first].startsWith("DRAFT:");
  if (draft && final) add(first + 1, "draft", clip(lines[first], 60));

  // The plain part.
  let inFence = false;
  let plainWords = 0;
  for (let i = 0; i < ai; i++) {
    const line = lines[i];
    if (draft && i === first) continue;
    if (isFence(line)) {
      if (!inFence) add(i + 1, "code", "fenced block");
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    plainLineFindings(line, i + 1, findings);
    if (!HEADING_RE.test(line)) plainWords += wordCount(line);
  }
  const critAt = lines.findIndex((l, i) => i < ai && CRITERIA_RE.test(l));
  let critEnd = ai;
  if (critAt >= 0) {
    const next = lines.findIndex((l, i) => i > critAt && i < ai && /^##[ \t]/u.test(l));
    if (next >= 0) critEnd = next;
  }
  const criteria = critAt >= 0 ? collectItems(lines, critAt + 1, critEnd, CRITERION_RE) : [];
  const decisions = collectItems(lines, 0, ai, DECISION_RE);
  for (const d of decisions) {
    const head = lines[d.line - 1];
    if (!MARK_RE.test(head)) {
      const m = /^[-*][ \t]+\*\*D[0-9]+([^*]*)\*\*/u.exec(head);
      const shown = m && m[1].trim() !== "" ? m[1].trim() : "none";
      add(d.line, "mark", `D${d.id} has the mark ${shown}; use (proposed) or (given by the user)`);
    }
  }
  const declared = new Map<number, number>();
  for (const d of decisions) {
    const seen = declared.get(d.id);
    if (seen !== undefined)
      add(d.line, "decision", `D${d.id} is declared twice (lines ${seen} and ${d.line})`);
    else declared.set(d.id, d.line);
  }
  const N = criteria.length;
  if (N === 0)
    add(critAt >= 0 ? critAt + 1 : 1, "part", "the plain part has no numbered acceptance criteria");

  // The agents' part.
  const aStart = ai + 1;
  const fenced = fenceMap(lines, aStart, lines.length);
  const isFenced = (i: number): boolean => fenced[i - aStart];
  // The level-3 sections of the agents' part, read the shared way: the cut reads them too.
  const subs = level3Sections(lines, aStart);
  const sub = (re: RegExp): { title: string; at: number; end: number } | undefined =>
    subs.find((s) => re.test(s.title));
  const checks = sub(/^checks$/iu);
  const techNotes = sub(TECH_NOTES_RE);
  const verified = verifiedSection(lines, ai);
  const where = ai + 1;
  if (!checks) add(where, "part", 'no "### Checks" section under "## For the agents"');
  if (!techNotes) add(where, "part", 'no "### Technical notes" section under "## For the agents"');
  if (!verified) add(where, "part", 'no "### Verified at <sha>" section under "## For the agents"');
  else if (verifiedAtSha(verified.title) === "")
    add(verified.at + 1, "part", '"### Verified at" needs a commit of 7 to 40 hex characters');

  // The checks: one for each criterion, labelled C1 to CN, in order.
  if (checks && N > 0) {
    const labels: Array<{ line: number; id: number }> = [];
    let k = 0;
    for (let i = checks.at + 1; i < checks.end; i++) {
      if (isFenced(i) || !ANY_MARKER_RE.test(lines[i])) continue;
      k += 1;
      const m = CHECK_LABEL_RE.exec(lines[i]);
      if (!m) {
        add(
          i + 1,
          "check",
          `item ${k} has no criterion id; start it with its id in bold, such as "- **C${k}**"`,
        );
        continue;
      }
      labels.push({ line: i + 1, id: Number(m[1]) });
    }
    const seen = new Map<number, number>();
    let clean = true;
    for (const l of labels) {
      if (l.id < 1 || l.id > N) {
        add(l.line, "check", `C${l.id} has no criterion: the plain part has ${N}`);
        clean = false;
      } else if (seen.has(l.id)) {
        add(l.line, "check", `C${l.id} appears twice (lines ${seen.get(l.id)} and ${l.line})`);
        clean = false;
      } else {
        seen.set(l.id, l.line);
      }
    }
    for (let c = 1; c <= N; c++) {
      if (!seen.has(c)) {
        add(checks.at + 1, "check", `no check for C${c}`);
        clean = false;
      }
    }
    if (clean && k === labels.length) {
      const bad = labels.findIndex((l, j) => l.id !== j + 1);
      if (bad >= 0)
        add(
          labels[bad].line,
          "check",
          `C${labels[bad].id} is out of order; expected C${bad + 1} here`,
        );
    }
  }

  // The tags: every group cites an id that exists, every note carries one, every decision is cited.
  const cited = new Set<number>();
  for (let i = aStart; i < lines.length; i++) {
    if (isFenced(i)) continue;
    for (const m of blankCode(lines[i]).matchAll(TAG_RE)) {
      for (const id of m[1].split(",").map((s) => s.trim())) {
        const num = Number(id.slice(1));
        if (id[0] === "D") {
          if (declared.has(num)) cited.add(num);
          else add(i + 1, "note", `${m[0]} cites ${id}, which does not exist`);
        } else if (num < 1 || num > N) {
          add(i + 1, "note", `${m[0]} cites ${id}, which does not exist`);
        }
      }
    }
  }
  // The technical notes: top-level bullets, each with its continuation lines.
  const noteHeads: number[] = [];
  if (techNotes) {
    for (let i = techNotes.at + 1; i < techNotes.end; i++) {
      if (!isFenced(i) && BULLET_RE.test(lines[i])) noteHeads.push(i);
    }
  }
  const noteCount = noteHeads.length;
  for (let j = 0; j < noteHeads.length; j++) {
    const from = noteHeads[j];
    const to = noteHeads[j + 1] ?? (techNotes ? techNotes.end : from + 1);
    let tagged = false;
    for (let i = from; i < to; i++) {
      if (!isFenced(i) && TAG_ONE_RE.test(blankCode(lines[i]))) tagged = true;
    }
    if (!tagged) {
      add(
        from + 1,
        "note",
        `technical note has no tag group such as (C9, D5): ${clip(lines[from].replace(BULLET_RE, ""), 50)}`,
      );
    }
  }
  for (const d of decisions) {
    if (declared.get(d.id) === d.line && !cited.has(d.id)) {
      add(d.line, "decision", `D${d.id} is not cited by any tag group in the agents' part`);
    }
  }

  // The notes.
  notes.push(`plain part: ${plainWords} words`);
  notes.push(`criteria ${N}, decisions ${decisions.length}, technical notes ${noteCount}`);
  const counted = N - (isFixtureLine(criteria[N - 1]) ? 1 : 0);
  if (counted > MAX_CRITERIA) {
    notes.push(
      `more than five criteria: ${counted}: leave work out or split the ticket by outcome`,
    );
  }
  for (const c of criteria) {
    const body = stripItemHead(c);
    const words = wordCount(body);
    const sentences = countSentences(body);
    if (words > MAX_CRITERION_WORDS || sentences > MAX_CRITERION_SENTENCES) {
      notes.push(
        `criterion ${c.id} (line ${c.line}): ${words} words, ${sentences} sentences: may be more than one idea`,
      );
    }
  }
  for (const d of decisions) {
    const words = wordCount(stripItemHead(d));
    if (words > MAX_DECISION_WORDS) {
      notes.push(`decision D${d.id} (line ${d.line}): ${words} words: may be more than one idea`);
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, notes };
}

// --- entry ------------------------------------------------------------------------------------
const USAGE = "usage: run ticket-parts <body-file> [--final]";

function main(argv: string[]): number {
  let final = false;
  const files: string[] = [];
  for (const a of argv) {
    if (a === "--final") final = true;
    else if (a.startsWith("-")) {
      console.error(USAGE);
      return 2;
    } else files.push(a);
  }
  if (files.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(files[0], "utf8");
  } catch (e) {
    console.error(
      `ticket-parts: cannot read ${files[0]}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }
  const report = analyze(normalizeTicket(text), final);
  if (!report) {
    console.error('ticket-parts: no "## For the agents" section');
    return 2;
  }
  for (const f of report.findings) console.log(`line ${f.line}: ${f.kind}: ${f.text}`);
  for (const n of report.notes) console.log(n);
  return report.findings.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
