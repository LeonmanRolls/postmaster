// Check that a ticket says what the libraries, SDKs and services it touches already do, so that no
// mechanism is built for something they provide: the agents' part of a ticket in the two-part
// shape (skills/clerk/ticket-template.md) has a `### Existing capabilities` section in the form
// the template gives.
//
//   scripts/run ticket-capabilities <body-file>
//
// The section holds either one line, `None: <why>`, for a change that touches nothing outside the
// repository, or one entry for each library, SDK or service the change touches or that a decision
// would wrap, replace or work around. An entry is a top-level bullet that names the thing in bold
// and carries, in this order, `Offers:`, `Uses:` and `Custom:`. `Offers:` cites a source: a
// documentation link, or a file and line of the installed version, such as `types.ts:120`. The
// entry carries a tag group such as (C1, D2), which ticket-parts reads and checks.
//
// Findings, one per line as `line N: capabilities: <text>`:
//   - the agents' part has no `### Existing capabilities` section;
//   - the section has neither a `None:` line nor an entry, or has both;
//   - a `None:` line gives no reason;
//   - an entry has no bold name, lacks a label, has the labels out of order, has an empty part,
//     cites no source in its `Offers:` part, or has no tag group.
//
// A ticket reads one file and contacts nothing. Whether the sources say what the entry says is
// the clerk's to have checked and the user's to be able to follow; this command checks the form.
//
//   exit 0  fit; the entry count is printed
//   exit 1  findings
//   exit 2  not usable: usage, an unreadable file, or no `## For the agents` heading
import { readFileSync } from "node:fs";
import { agentsIndex, fenceMap, level3Sections, normalizeTicket } from "./lib/ticket-sections.ts";

export interface Finding {
  line: number;
  text: string;
}

export interface Report {
  findings: Finding[];
  entries: number;
}

const TICK = "`";
const SECTION_RE = /^existing capabilities$/iu;
const BULLET_RE = /^[-*][ \t]+/u;
const NAME_RE = /^[-*][ \t]+\*\*[^*]+\*\*/u;
const NONE_RE = /^(?:[-*][ \t]+)?None:(.*)$/u;
const TAG_RE = /\((?:[CD][0-9]+)(?:[ \t]*,[ \t]*[CD][0-9]+)*\)/u;
const URL_RE = /https?:\/\/[^ \t)\]>]+/u;
// A file and a line of the installed version: a name with an extension, a colon and a number.
const FILE_LINE_RE = /[\p{L}\p{N}_./@-]+\.[\p{L}]+:[0-9]+/u;
const LABELS = ["Offers:", "Uses:", "Custom:"] as const;

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

function words(s: string): number {
  return s.split(/[ \t\n]+/u).filter((w) => w !== "").length;
}

function clip(s: string, n = 60): string {
  const one = s.replace(/[ \t\n]+/gu, " ").trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
}

// The position of a label that starts a word and is followed by its colon, outside a code span.
function labelAt(text: string, label: string, from: number): number {
  let at = text.indexOf(label, from);
  while (at >= 0) {
    const before = at === 0 ? " " : text[at - 1];
    if (!/[\p{L}\p{N}_]/u.test(before)) return at;
    at = text.indexOf(label, at + 1);
  }
  return -1;
}

function checkEntry(text: string, line: number, add: (line: number, msg: string) => void): void {
  const head = text.split("\n")[0];
  if (!NAME_RE.test(head)) add(line, "entry has no name in bold: start it with - **name**");
  const flat = blankCode(text.split("\n").join(" "));
  const at: number[] = [];
  let from = 0;
  let missing = false;
  for (const label of LABELS) {
    const p = labelAt(flat, label, from);
    if (p < 0) {
      add(line, `entry lacks ${label}`);
      missing = true;
      at.push(-1);
    } else {
      at.push(p);
      from = p + label.length;
    }
  }
  if (!missing) {
    for (let k = 0; k < LABELS.length; k++) {
      const start = at[k] + LABELS[k].length;
      const end = k + 1 < LABELS.length ? at[k + 1] : flat.length;
      const part = flat.slice(start, end).replace(TAG_RE, " ");
      const min = k === 0 ? 3 : 1;
      if (words(part) < min) add(line, `entry has an empty ${LABELS[k]} part`);
    }
    // The source is read from the raw text: a path and line sits in a code span, as the template
    // writes it.
    const raw = text.split("\n").join(" ");
    const rawAt = labelAt(raw, LABELS[0], 0);
    const rawEnd = labelAt(raw, LABELS[1], rawAt + 1);
    const offers = rawAt >= 0 ? raw.slice(rawAt, rawEnd >= 0 ? rawEnd : raw.length) : "";
    if (!URL_RE.test(offers) && !FILE_LINE_RE.test(offers)) {
      add(line, "entry cites no source in Offers: give a documentation link or a file and line");
    }
  }
  if (!TAG_RE.test(flat)) add(line, "entry has no tag group such as (C1, D2)");
}

// null when the text has no `## For the agents` heading.
export function analyze(text: string): Report | null {
  const lines = text.split("\n");
  const ai = agentsIndex(lines);
  if (ai < 0) return null;
  const findings: Finding[] = [];
  const add = (line: number, msg: string): void => {
    findings.push({ line, text: msg });
  };
  const section = level3Sections(lines, ai + 1).find((s) => SECTION_RE.test(s.title));
  if (!section) {
    add(ai + 1, 'no "### Existing capabilities" section under "## For the agents"');
    return { findings, entries: 0 };
  }
  const from = section.at + 1;
  const fenced = fenceMap(lines, from, section.end);
  const isFenced = (i: number): boolean => fenced[i - from];
  const none: Array<{ line: number; reason: string }> = [];
  const heads: number[] = [];
  for (let i = from; i < section.end; i++) {
    if (isFenced(i)) continue;
    const none1 = NONE_RE.exec(lines[i]);
    if (none1) {
      none.push({ line: i + 1, reason: none1[1] });
    } else if (BULLET_RE.test(lines[i])) {
      heads.push(i);
    }
  }
  for (const n of none) {
    if (words(n.reason) < 3) add(n.line, "None: needs a reason in a few words");
  }
  if (none.length > 0 && heads.length > 0) {
    add(none[0].line, "the section has a None: line and entries; keep one or the other");
  }
  if (none.length === 0 && heads.length === 0) {
    add(
      section.at + 1,
      "the section has no entry and no None: line; name each library or service, or write None:",
    );
  }
  for (let j = 0; j < heads.length; j++) {
    const start = heads[j];
    const end = heads[j + 1] ?? section.end;
    const parts: string[] = [];
    for (let i = start; i < end; i++) {
      if (!isFenced(i)) parts.push(lines[i]);
    }
    checkEntry(parts.join("\n").trimEnd(), start + 1, add);
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, entries: heads.length };
}

const USAGE = "usage: run ticket-capabilities <body-file>";

function main(argv: string[]): number {
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(argv[0], "utf8");
  } catch (e) {
    console.error(
      `ticket-capabilities: cannot read ${argv[0]}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }
  const report = analyze(normalizeTicket(text));
  if (!report) {
    console.error('ticket-capabilities: no "## For the agents" section');
    return 2;
  }
  for (const f of report.findings)
    console.log(`line ${f.line}: capabilities: ${clip(f.text, 120)}`);
  if (report.findings.length === 0) console.log(`existing capabilities: ${report.entries} entries`);
  return report.findings.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
