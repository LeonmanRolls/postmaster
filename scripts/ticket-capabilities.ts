// Check that a ticket says what the libraries, SDKs and services it touches already do, so that no
// mechanism is built for something they provide: the agents' part of a ticket in the two-part
// shape (skills/clerk/ticket-template.md) has a `### Existing capabilities` section in the form
// the template gives.
//
//   scripts/run ticket-capabilities <body-file> [--candidates <menu>]...
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
// With `--candidates`, the command also checks the menus that `run api-index` and `run code-index`
// made with `--match <draft>`, the clerk's view of everything the libraries and the project's own
// code offer. A menu must have been made from the draft as it stands now (its vocabulary key
// matches), so that the clerk planned with the whole index in front of it. An entry whose `Custom:`
// part is not "none" must also carry a `Searched:` part naming the settings, methods or helpers
// that were looked for, so that "the library cannot do this" rests on a look. The section does not
// list what a menu holds: the clerk needs to know it while it plans, not to repeat it. Findings
// added:
//   - a menu made without --match, or from an older draft;
//   - an entry with a Custom: part and no Searched: part that names a setting, method or helper.
//
// A ticket reads its files and contacts nothing. Whether the sources say what the entry says is
// the clerk's to have checked and the user's to be able to follow; this command checks the form
// and that the menus the clerk planned from are the draft's own.
//
//   exit 0  fit; the entry count is printed
//   exit 1  findings
//   exit 2  not usable: usage, an unreadable file, or no `## For the agents` heading
import { readFileSync } from "node:fs";
import {
  type ParsedList,
  draftText,
  parseList,
  vocabulary,
  vocabularyKey,
} from "./lib/index-match.ts";
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
const NONE_PART_RE = /^none(?![\p{L}\p{N}])/iu;
const SEARCHED = "Searched:";
// A setting, method or helper named in the text: a code span, or a name with an underscore or a hump.
const NAMED_RE = /`[^`]+`|[A-Za-z_$][A-Za-z0-9_$]*(?:_|[a-z][A-Z])[A-Za-z0-9_$]*/u;

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

function checkEntry(
  text: string,
  line: number,
  add: (line: number, msg: string) => void,
  strict: boolean,
): void {
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
    // A `Searched:` part follows `Custom:` and is not part of it.
    const searchedAt = labelAt(flat, SEARCHED, at[2] + LABELS[2].length);
    for (let k = 0; k < LABELS.length; k++) {
      const start = at[k] + LABELS[k].length;
      const end = k + 1 < LABELS.length ? at[k + 1] : searchedAt >= 0 ? searchedAt : flat.length;
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
    if (strict) {
      const customEnd = searchedAt >= 0 ? searchedAt : flat.length;
      const custom = flat
        .slice(at[2] + LABELS[2].length, customEnd)
        .replace(TAG_RE, " ")
        .trim();
      // raw and flat have the same length, so a position in one is the same place in the other
      const searched = searchedAt >= 0 ? raw.slice(searchedAt + SEARCHED.length) : "";
      if (!NONE_PART_RE.test(custom) && !NAMED_RE.test(searched)) {
        add(
          line,
          "entry has a Custom: part and no Searched: part naming the settings, methods or helpers looked for",
        );
      }
    }
  }
  if (!TAG_RE.test(flat)) add(line, "entry has no tag group such as (C1, D2)");
}

export interface CandidateList {
  readonly name: string;
  readonly list: ParsedList;
}

// null when the text has no `## For the agents` heading.
export function analyze(text: string, candidates: readonly CandidateList[] = []): Report | null {
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
  const strict = candidates.length > 0;
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
    checkEntry(parts.join("\n").trimEnd(), start + 1, add, strict);
  }
  if (strict) {
    const key = vocabularyKey(vocabulary(draftText(text)));
    for (const c of candidates) {
      if (c.list.vocabularyKey === null) {
        add(
          section.at + 1,
          `${c.name} was made without --match <draft>: make it again with the draft`,
        );
      } else if (c.list.vocabularyKey !== key) {
        add(
          section.at + 1,
          `${c.name} was made from an older draft: run api-index or code-index again with --match <draft>, read it, and revise the section`,
        );
      }
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, entries: heads.length };
}

const USAGE = "usage: run ticket-capabilities <body-file> [--candidates <menu>]...";

function main(argv: string[]): number {
  const files: string[] = [];
  const listPaths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--candidates") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        console.error(USAGE);
        return 2;
      }
      listPaths.push(v);
      i += 1;
    } else if (argv[i].startsWith("-")) {
      console.error(USAGE);
      return 2;
    } else {
      files.push(argv[i]);
    }
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
      `ticket-capabilities: cannot read ${files[0]}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }
  const lists: CandidateList[] = [];
  for (const p of listPaths) {
    try {
      lists.push({ name: p, list: parseList(readFileSync(p, "utf8")) });
    } catch (e) {
      console.error(
        `ticket-capabilities: cannot read ${p}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 2;
    }
  }
  const report = analyze(normalizeTicket(text), lists);
  if (!report) {
    console.error('ticket-capabilities: no "## For the agents" section');
    return 2;
  }
  for (const f of report.findings)
    console.log(`line ${f.line}: capabilities: ${clip(f.text, 160)}`);
  if (report.findings.length === 0) {
    console.log(
      `existing capabilities: ${report.entries} entries${lists.length > 0 ? `, ${lists.length} menus made from this draft` : ""}`,
    );
  }
  return report.findings.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
