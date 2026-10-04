// Check a ticket's shape before it is accepted: a title, the problem or feature, numbered
// acceptance criteria each answerable yes or no, the direction, and the turnpikes. This is the
// executable form of the ticket shape in skills/postmaster/trackers.md.
//
//   run ticket-check <repo> <ticket-id>                    through the adapter of the kind the repo
//                                                         uses, as scripts/run tracker-kind names it:
//                                                         local when its store exists, else the
//                                                         config's [tracker] kind
//   run ticket-check --body <body-file> [--title <title>] [--project <repo>] a body file, as an adapter's create
//                                                         takes it; the title is judged only when
//                                                         --title gives one
//   run ticket-check --splice <base-body> <sections> [--out <file>]
//                                                         <base-body> with each `##` section of
//                                                         <sections> in place of the one it names,
//                                                         or added where the shape puts it: to
//                                                         <file> when --out gives one, else stdout
//   run ticket-check --has-journey <file>                  print `journey` or `no journey`: whether
//                                                         the phrase "user journey" occurs anywhere in
//                                                         the text, case-insensitively, with whitespace
//                                                         runs (and zero-width joiners) collapsed, the
//                                                         possessive `'s`/`’s` dropped, and markup (`#`,
//                                                         `>`, `*`, `_`, backticks, apostrophes, hyphens,
//                                                         comment openers and closers) read as spaces. No headings
//                                                         are read. Fail-closed: a mention in passing
//                                                         blocks landing visibly until the journey runs
//                                                         or the user rules.
//
// What it judges, and nothing more:
//   - The title has words: the one the adapter read, or the one --title gives.
//   - `## Problem / feature`, `## Acceptance criteria`, `## Direction` and `## Turnpikes` are
//     each present once, at level two, in that order, with words under them. Headings match
//     ignoring case, a trailing colon, a closing run of # and the spacing around the slash.
//   - The acceptance criteria are a list numbered 1, 2, 3 in order, with nothing outside the
//     list but blank lines and thematic breaks. Indented lines, nested lists and lines running
//     straight on belong to the criterion above them.
//   - Each criterion is answerable yes or no, which here means three things a script can see:
//     it has words; it asks no question, so no question mark ends a sentence in it, closing
//     brackets and emphasis aside; and it is not marked to be decided later.
//   - No part is marked to be decided later: TBD or TBC anywhere, or TODO as the whole text or
//     followed by a colon. TODO as a word, as in "a TODO list", is not a mark.
//   - The turnpikes are `default`, `none` or turnpike names, as `scripts/run turnpikes resolve`
//     reads them for the target project, and every word that is not a turnpike is named. The names come from that
//     script alone, so a turnpike added there needs no change here.
// Code spans, fenced blocks and HTML comments are not read for questions, marks or headings,
// and quoted text is not read for questions. A <!-- that nothing closes is text. A heading's
// hashes must stand at the line's start as written: what follows a comment on its line is
// text, not a heading. Turnpikes are
// read from code spans too, and not from fenced blocks or HTML comments.
//
// What it does not judge: whether the description says why the change matters; whether a
// criterion is vague ("fast enough", "where possible") or can really be tested; whether the
// criteria are the right ones, or enough; what the direction says. `## Notes` and
// `## User journey` are optional and not checked. An indented code block is read as text.
//
// --splice changes nothing else: every line of <base-body> outside the sections it replaces is
// printed as it was. It is how a part the user approved is written into a ticket without
// retyping the rest. A part it would write whose name stands as a subheading inside a later
// part of the base, such as `### Direction` under `## Notes`, is refused: that heading may be the
// part at the wrong level or the user's own text, and splicing would delete it or leave two.
//
// POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml). A tracker of kind
// `other` has no adapter script: read the ticket with its own tooling and check it with --body.
//
//   exit 0  well-formed: it prints how many acceptance criteria it has, then the turnpikes as the
//           waybill carries them, `turnpikes: <names>` or `turnpikes: none`; with --splice, the body
//   exit 1  usage; a file that cannot be read; no config, or one that does not parse; a tracker kind
//           with no adapter script; the adapter could not read the ticket; scripts/run turnpikes
//           could not be run or gave no verdict; or, with --splice, a sections file that is not a
//           list of `##` sections, or a part it would write named inside a later part of the base
//   exit 2  malformed; one line per missing or malformed part on stdout, the part named first
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  BOUND_L,
  BOUND_R,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyTrim,
  pyWords,
  W_CLASS,
} from "./lib/text.ts";

class DieError extends Error {
  constructor(
    public readonly msg: string,
    public readonly code: number = 1,
  ) {
    super(msg);
  }
}
function dieT(msg: string): never {
  throw new DieError(msg, 1);
}

// --- regex constants ---------------------------------------------------------------------------
export const HEADING = new RegExp(
  "^ {0,3}(#{1,6})(?:[ \t]+(" + PY_DOT + "*?))?[ \t]*" + END_OF_STRING + "",
  "u",
);
export const FENCE = new RegExp("^ {0,3}(`{3,})[^`]*" + END_OF_STRING + "|^ {0,3}(~{3,})", "u");
export const FENCED_ITEM = new RegExp(
  "^ {0,3}(?:[-*+]|\\p{Nd}{1,9}[.)])[ \t]+(?:(`{3,})[^`]*|(~{3,})" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
const HASH_AT_START = /^ {0,3}#+/u;
const TICKS = /`+/gu;
const SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n).)+?)(?<!`)\1(?!`)/gsu;
const QUOTED = /"[^"\n]*"|"[^"\n]*"/gu;
export const QUESTION = new RegExp(
  "[?？][*_)\\]]*[.,;:]?(?=[" + PY_S_CLASS + "]|" + END_OF_STRING + ")",
  "u",
);
export const ITEM = new RegExp(
  "^( *)(\\p{Nd}{1,9})[.)](?:[ \t]+(" + PY_DOT + "*))?" + END_OF_STRING + "",
  "u",
);
const BULLET = /^ {0,3}[-*+](?:[ \t]|$)/u;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
export const MARK1 = new RegExp(BOUND_L + "(TBD|TBC)" + BOUND_R + "", "u");
export const MARK2 = new RegExp(BOUND_L + "(TODO)" + BOUND_R + "[" + PY_S_CLASS + "]*:", "u");
export const MARK3 = new RegExp(
  "^[^" + W_CLASS + "]*(TODO)[^" + W_CLASS + "]*" + END_OF_STRING + "",
  "u",
);
export const QSPLIT = new RegExp(
  "(?<=[.!?？]+)[" + PY_S_CLASS + "]+|\\n[" + PY_S_CLASS + "]*",
  "u",
);
const PARTS: Array<[string, string]> = [
  ["problem / feature", "Problem / feature"],
  ["acceptance criteria", "Acceptance criteria"],
  ["direction", "Direction"],
  ["turnpikes", "Turnpikes"],
];
const RANK: Record<string, number> = {
  "problem / feature": 0,
  "acceptance criteria": 1,
  direction: 2,
  turnpikes: 3,
  notes: 4,
  "user journey": 5,
};

function loadText(path: string): string {
  try {
    return readFileSync(path, "utf8").replace(/^\ufeff/u, "");
  } catch (e: any) {
    dieT(`cannot read ${path}: ${e?.message ?? e}`);
  }
}

function uncomment(
  t: string,
  inside: boolean,
  k: number,
  last: [number, number],
): [string, boolean] {
  const out: string[] = [];
  let i = 0;
  let ins = inside;
  for (;;) {
    if (ins) {
      const j = t.indexOf("-->", i);
      if (j < 0) return [out.join(""), true];
      i = j + 3;
      ins = false;
      continue;
    }
    const c = t.indexOf("<!--", i);
    TICKS.lastIndex = i;
    const bm = TICKS.exec(t);
    const bStart = bm?.index ?? -1;
    if (bm && (c < 0 || bStart < c)) {
      const closeRe = new RegExp(
        `(?<!\`)${bm[0].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?!\`)`,
        "u",
      );
      const after = t.slice(bm.index + bm[0].length);
      const cm = closeRe.exec(after);
      const end = cm ? bm.index + bm[0].length + cm.index + cm[0].length : bm.index + bm[0].length;
      out.push(t.slice(i, end));
      i = end;
    } else if (c < 0) {
      out.push(t.slice(i));
      return [out.join(""), false];
    } else if (!t.slice(0, c).trim() && k <= last[0] && c + 4 <= last[1]) {
      out.push(t.slice(i, c));
      i = c + 4;
      ins = true;
    } else if (t.indexOf("-->", c + 4) >= 0) {
      out.push(t.slice(i, c));
      i = t.indexOf("-->", c + 4) + 3;
    } else {
      out.push(t.slice(i, c + 4));
      i = c + 4;
    }
  }
}

function tokenize(text: string): [string[], Array<[string, boolean]>] {
  const raw = text.split("\n");
  let lastK = -1,
    lastIdx = -1;
  for (let k = 0; k < raw.length; k++) {
    const idx = raw[k]?.lastIndexOf("-->");
    if (idx >= 0) {
      lastK = k;
      lastIdx = idx;
    }
  }
  const last: [number, number] = [lastK, lastIdx];
  const lines: Array<[string, boolean]> = [];
  let fence: string | null = null;
  let inside = false;
  for (let k = 0; k < raw.length; k++) {
    // A CRLF body keeps its \r in raw (splice prints the body byte for byte); the analysis
    // line is stripped, so the regexes below see a line as BASE's `.`-matches-\r did.
    const t = raw[k]?.replace(/\r$/u, "");
    if (fence) {
      lines.push([t, true]);
      const s = t.trim();
      if (s.length >= fence.length && s === fence[0]?.repeat(s.length)) fence = null;
      continue;
    }
    const m = inside ? null : FENCE.exec(t);
    const item = inside || m ? null : FENCED_ITEM.exec(t);
    if (m) {
      fence = m[1] || m[2] || null;
      lines.push([t, true]);
    } else if (item) {
      fence = item[1] || item[2] || null;
      lines.push([t, false]);
    } else {
      const [ct, ci] = uncomment(t, inside, k, last);
      inside = ci;
      lines.push([ct, false]);
    }
  }
  return [raw, lines];
}

export function norm(h: string): string {
  // text.ts: BASE norm strips like Python, spaces slashes, squashes \s-runs, lowers.
  const s = pyTrim(pyTrim(pyTrim(h).replace(/[ \t]+#+$/u, "")).replace(/:$/u, ""));
  const slashed = s.replace(new RegExp("[" + PY_S_CLASS + "]*/[" + PY_S_CLASS + "]*", "gu"), " / ");
  return pyLower(pyTrim(slashed.replace(new RegExp("[" + PY_S_CLASS + "]+", "gu"), " ")));
}

interface Head {
  i: number;
  level: number;
  norm: string;
  raw: string;
}

function headsOf(raw: string[], lines: Array<[string, boolean]>): Head[] {
  const heads: Head[] = [];
  for (let i = 0; i < lines.length; i++) {
    const [t, code] = lines[i]!;
    const m = code ? null : HEADING.exec(t);
    // The hashes must stand at the line's start as written: a same-line remainder after
    // a comment is text, not a heading, even once the comment is gone.
    if (m && HASH_AT_START.test(raw[i] ?? "")) {
      heads.push({ i, level: (m[1] ?? "").length, norm: norm(m[2] ?? ""), raw: t.trim() });
    }
  }
  return heads;
}

function boundsOf(heads: Head[]): Head[] {
  return heads.filter((h) => h.level <= 2 || h.norm in RANK);
}

function hasWords(lines: Array<[string, boolean]>): boolean {
  // As the title check: Python's [^\W_] is Unicode, \w is not, so the port
  // names the categories.
  return /[\p{L}\p{N}]/u.test(lines.map(([t]) => t).join(" "));
}

function prose(lines: Array<[string, boolean]>): string {
  return lines
    .filter(([_, code]) => !code)
    .map(([t]) => t)
    .join("\n")
    .replace(SPAN, " ");
}

function marked(p: string): string | null {
  const m1 = MARK1.exec(p);
  if (m1) return m1[1]!;
  const m2 = MARK2.exec(p);
  if (m2) return m2[1]!;
  const m3 = MARK3.exec(p);
  if (m3) return m3[1]!;
  return null;
}

function question(p: string): string | null {
  const masked = p.replace(QUOTED, (m) => " ".repeat(m.length));
  const q = QUESTION.exec(masked);
  if (!q) return null;
  const before = p.slice(0, q.index + 1);
  const parts = before.split(QSPLIT);
  return parts[parts.length - 1] ?? null;
}

export function clip(s: string, n = 70): string {
  // text.ts: BASE clip is " ".join(s.split()).
  const t = pyWords(s).join(" ");
  return t.length <= n ? t : `${t.slice(0, n - 3)}...`;
}

function criteriaCheck(
  fault: (part: string, msg: string) => void,
  part: string,
  body: Array<[string, boolean]>,
): number {
  const items: Array<[number, Array<[string, boolean]>]> = [];
  const strays: string[] = [];
  let cur: [number, Array<[string, boolean]>] | null = null;
  let base: number | null = null;
  let owner: [number, Array<[string, boolean]>] | null = null;
  let blank = false,
    prevCode = false,
    inStray = false;
  for (const [t, code] of body) {
    if (code) {
      if (!prevCode) {
        owner = cur !== null && (t.startsWith(" ") || !blank) ? cur : null;
        if (owner === null) {
          if (!inStray) strays.push(t.trim());
          cur = null;
          inStray = true;
        }
      }
      if (owner) owner[1].push([t, true]);
      prevCode = true;
      blank = false;
      continue;
    }
    prevCode = false;
    if (!t.trim() || BREAK.test(t)) {
      blank = true;
      inStray = false;
      continue;
    }
    const m = ITEM.exec(t);
    if (m && (m[1] ?? "").length <= (base === null ? 3 : base + 2)) {
      if (base === null) base = (m[1] ?? "").length;
      cur = [parseInt(m[2] ?? "0", 10), [[m[3] ?? "", false]]];
      items.push(cur);
      blank = false;
      inStray = false;
      continue;
    }
    if (cur !== null && (t.startsWith(" ") || !(blank || BULLET.test(t) || HEADING.test(t)))) {
      cur[1].push([t, false]);
      blank = false;
      continue;
    }
    if (!inStray) strays.push(t.trim());
    cur = null;
    blank = false;
    inStray = true;
  }
  if (items.length === 0) {
    fault(part, "not a numbered list");
    return 0;
  }
  for (const s of strays) fault(part, `not part of a numbered criterion: "${clip(s)}"`);
  const numbers = items.map(([n]) => n);
  const expected = items.map((_, i) => i + 1);
  if (numbers.join(",") !== expected.join(",")) {
    fault(part, `numbered ${numbers.join(", ")}; number them 1 to ${items.length} in order`);
  }
  for (let pos = 0; pos < items.length; pos++) {
    const ls = items[pos]?.[1];
    if (!hasWords(ls)) {
      fault(part, `criterion ${pos + 1} is empty`);
      continue;
    }
    const p = prose(ls);
    const mark = marked(p);
    const asks = question(p);
    if (mark) fault(part, `criterion ${pos + 1} is marked ${mark}`);
    if (asks) fault(part, `criterion ${pos + 1} asks a question: "${clip(asks)}"`);
  }
  return items.length;
}

function turnpikesCheck(
  fault: (part: string, msg: string) => void,
  part: string,
  body: Array<[string, boolean]>,
  turnpikesPath: string,
): string {
  const text = body
    .filter(([t, code]) => !code && !FENCED_ITEM.test(t))
    .map(([t]) => t)
    .join("\n");
  const r = run(turnpikesPath, ["turnpikes", "resolve"], { input: text });
  const said = r.out.split("\n").filter(Boolean);
  if (r.code === 2 && said.length > 0) {
    for (const l of said) fault(part, l);
    return "";
  }
  if (r.code === 0 && said.length === 1 && said[0]?.startsWith("turnpikes: ")) {
    return said[0]!;
  }
  dieT(
    `run turnpikes resolve gave no verdict (exit ${r.code}): ${r.err.trim() || r.out.trim() || "no output"}`,
  );
}

function check(
  title: string | null,
  text: string,
  turnpikesPath: string,
): [string[], number, string] {
  const [raw, lines] = tokenize(text);
  const heads = headsOf(raw, lines);
  const bounds = boundsOf(heads);
  const faults: string[] = [];
  const fault = (part: string, msg: string) => faults.push(`${part}: ${msg}`);
  // [^\W_] in Python matches a Unicode word character but underscore; \w stays
  // ASCII even under /u, so the port names the categories: letters and numbers.
  if (title !== null && !/[\p{L}\p{N}]/u.test(title)) {
    fault("title", "missing");
  }
  const at: Record<string, number> = {};
  let count = 0,
    named = "";
  for (const [key, name] of PARTS) {
    const found = bounds.filter((h) => h.level === 2 && h.norm === key);
    if (found.length === 0) {
      const near = heads.filter((h) => h.norm === key);
      let msg = `no "## ${name}" section`;
      if (near.length > 0) {
        msg += `; "${near[0]?.raw}" is there, at the wrong level`;
      } else if (key === "direction") {
        msg += '; one is needed even if it says "None: any approach that meets the criteria"';
      } else if (key === "turnpikes") {
        msg += "; one is needed, holding default, none, or turnpike names";
      }
      fault(key, msg);
      continue;
    }
    if (found.length > 1) {
      fault(key, `"## ${name}" appears ${found.length} times`);
    }
    const i = (at[key] = found[0]?.i);
    const nextBound = bounds.find((b) => b.i > i);
    const body = lines.slice(i + 1, nextBound ? nextBound.i : lines.length);
    if (!hasWords(body)) {
      fault(key, `"## ${name}" is empty`);
    } else if (key === "acceptance criteria") {
      count = criteriaCheck(fault, key, body);
    } else {
      const mk = marked(prose(body));
      if (mk) fault(key, `"## ${name}" is marked ${mk}`);
      else if (key === "turnpikes") {
        named = turnpikesCheck(fault, key, body, turnpikesPath);
      }
    }
  }
  for (let j = 0; j < PARTS.length; j++) {
    const [key, name] = PARTS[j]!;
    const after = PARTS.slice(0, j).filter(([k]) => k in at && key in at && at[k]! > at[key]!);
    if (after.length > 0) {
      fault(
        key,
        `"## ${name}" comes before "## ${after[0]?.[1]}"; the order is ${PARTS.map(([, n]) => n).join(", ")}`,
      );
    }
  }
  return [faults, count, named];
}

// --- splice ------------------------------------------------------------------------------------
function chunks(text: string): [string[], Array<[Head, string[]]>] {
  let [raw, lines] = tokenize(text);
  if (raw.length > 0 && raw[raw.length - 1] === "") {
    raw = raw.slice(0, -1);
    lines = lines.slice(0, -1);
  }
  const bounds = boundsOf(headsOf(raw, lines));
  const starts = bounds.map((b) => b.i).concat([raw.length]);
  const secs = bounds.map((b, k) => [b, raw.slice(b.i, starts[k + 1])] as [Head, string[]]);
  return [raw.slice(0, starts[0] ?? 0), secs];
}

function splice(baseText: string, sectionsText: string, _turnpikesPath: string): string {
  const [pre, secs] = chunks(baseText);
  const [lead, given] = chunks(sectionsText);
  if (lead.some((t) => t.trim())) dieT("the sections file has text before its first heading");
  if (given.length === 0) dieT("the sections file has no ## sections");
  for (const [b] of given) {
    if (b.level !== 2) dieT(`"${b.raw}" in the sections file is not a ## heading`);
  }
  const names = new Set(given.map(([b]) => b.norm));
  if (names.size !== given.length) dieT("the sections file names a section twice");
  const heading: Record<string, string> = {};
  for (const [b] of given) heading[b.norm] = b.raw;
  let top = -1;
  for (const [b] of secs) {
    const rank = RANK[b.norm];
    if (b.level === 2 && rank !== undefined) {
      top = Math.max(top, rank);
    } else if (b.level > 2 && b.norm in heading && rank !== undefined && rank < top) {
      dieT(
        `"${b.raw}" stands inside a later part; splicing "${heading[b.norm]}" would delete it or leave two, so move or rename it first`,
      );
    }
  }
  let out: Array<[string, string[], boolean]> = secs.map(([b, c]) => [b.norm, c, false]);
  for (const [b, c] of given) {
    out = out.filter((s) => s[0] !== b.norm);
    const rank = RANK[b.norm];
    let at: number;
    if (rank === undefined) {
      at = out.length;
    } else {
      const before = out
        .map((s, k) => [k, RANK[s[0] ?? ""] ?? rank] as const)
        .filter(([_, r]) => r < rank);
      if (before.length > 0) {
        at = before[before.length - 1]?.[0] + 1;
        while (at < out.length && RANK[out[at]?.[0] ?? ""] === undefined) at++;
      } else {
        at = out.findIndex((s) => (RANK[s[0] ?? ""] ?? -1) > rank);
        if (at < 0) at = out.length;
      }
    }
    const trimmed = [...c];
    while (trimmed.length > 0 && !trimmed[trimmed.length - 1]?.trim()) trimmed.pop();
    out.splice(at, 0, [b.norm, trimmed, true]);
  }
  const linesOut = [...pre];
  for (let k = 0; k < out.length; k++) {
    const [, c, isNew] = out[k]!;
    if (isNew && linesOut.length > 0 && linesOut[linesOut.length - 1]?.trim()) {
      linesOut.push("");
    }
    linesOut.push(...c);
    if (isNew && k + 1 < out.length) linesOut.push("");
  }
  return `${linesOut.join("\n")}\n`;
}

export const JOURNEY_MARKUP = new RegExp(
  "<!--|-->|[#> *_`'\u2019\u2013\u2014\u2010\u2011-]+",
  "gu",
);
export const JOURNEY_SPACE = new RegExp("[" + PY_S_CLASS + "\u200b\u2060\u00ad]+", "gu");

export function hasJourney(text: string): boolean {
  // Fail-closed: the phrase anywhere counts, whatever shapes it.
  const bare = text.replace(new RegExp("['\u2019][sS]" + BOUND_R, "gu"), ""); // the possessive reads as the bare phrase
  const flat = bare.replace(JOURNEY_MARKUP, " ").replace(JOURNEY_SPACE, " ");
  return pyLower(flat).includes("user journey");
}

// --- printed mode ------------------------------------------------------------------------------
function _checkPrinted(text: string, turnpikesPath: string): number {
  const sep = text.indexOf("\n\n");
  const head = sep >= 0 ? text.slice(0, sep) : text;
  const body = sep >= 0 ? text.slice(sep + 2) : "";
  const titleLine = head.split("\n").find((l) => l.startsWith("title:"));
  const title = titleLine ? titleLine.slice(6) : "";
  const [faults, count, named] = check(title, body, turnpikesPath);
  if (faults.length > 0) {
    console.log(faults.join("\n"));
    return 2;
  }
  console.log(`well-formed, ${count} acceptance criteria`);
  console.log(named);
  return 0;
}

// --- entry -------------------------------------------------------------------------------------
const TURNPIKES = join(scriptsDir(import.meta), "run");

const USAGE =
  "usage: run ticket-check <repo> <ticket-id> | --body <body-file> [--title <title>] [--project <repo>]" +
  " | --splice <base-body> <sections> [--out <file>] | --has-journey <file>";

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function main(argv: string[]): number {
  const mode = argv[0] ?? "";
  if (mode === "--body") {
    if (argv.length >= 2) {
      let title: string | null = null;
      let hasTitle = false;
      let project = "";
      let hasProject = false;
      const rest = argv.slice(2);
      let ok = true;
      for (let i = 0; i < rest.length; i += 2) {
        const flag = rest[i];
        const val = rest[i + 1];
        if (val === undefined) {
          ok = false;
          break;
        }
        if (flag === "--title") {
          title = val;
          hasTitle = true;
        } else if (flag === "--project") {
          project = val;
          hasProject = true;
        } else {
          ok = false;
          break;
        }
      }
      if (ok) {
        if (hasProject) {
          if (!isDir(project)) {
            console.error(`ticket-check: no such project directory: ${project}`);
            return 1;
          }
          process.env.POSTMASTER_PROJECT = realpathSync(project);
        }
        try {
          const text = loadText(argv[1]!);
          const [faults, count, named] = check(hasTitle ? title : null, text, TURNPIKES);
          if (faults.length > 0) {
            console.log(faults.join("\n"));
            return 2;
          }
          console.log(`well-formed, ${count} acceptance criteria`);
          console.log(named);
          return 0;
        } catch (e) {
          if (e instanceof DieError) {
            process.stderr.write(`ticket-check: ${e.msg}\n`);
            return e.code;
          }
          throw e;
        }
      }
    }
    usage();
  }
  if (mode === "--splice") {
    const wantsOut = argv.length === 5 && argv[3] === "--out";
    if (argv.length !== 3 && !wantsOut) {
      usage();
    }
    try {
      const baseText = loadText(argv[1]!);
      const sectionsText = loadText(argv[2]!);
      const spliced = splice(baseText, sectionsText, TURNPIKES);
      if (wantsOut) writeFileSync(argv[4]!, spliced);
      else process.stdout.write(spliced);
      return 0;
    } catch (e) {
      if (e instanceof DieError) {
        process.stderr.write(`ticket-check: ${e.msg}\n`);
        return e.code;
      }
      throw e;
    }
  }
  if (mode === "--has-journey") {
    if (argv.length !== 2) {
      usage();
    }
    try {
      const text = loadText(argv[1]!);
      console.log(hasJourney(text) ? "journey" : "no journey");
      return 0;
    } catch (e) {
      if (e instanceof DieError) {
        process.stderr.write(`ticket-check: ${e.msg}\n`);
        return e.code;
      }
      throw e;
    }
  }
  if (mode === "" || mode.startsWith("-")) {
    usage();
  }
  // <repo> <ticket-id> through adapter
  if (argv.length !== 2) {
    usage();
  }
  if (!isDir(mode)) {
    console.error(`ticket-check: no such project directory: ${mode}`);
    return 1;
  }
  process.env.POSTMASTER_PROJECT = realpathSync(mode);
  try {
    const HERE = scriptsDir(import.meta);
    const kindR = run(join(HERE, "run"), ["tracker-kind", mode]);
    if (kindR.code !== 0) {
      // BASE left run tracker-kind's stderr to flow through; run() captures it, so forward it.
      process.stderr.write(kindR.err);
      return 1;
    }
    const kind = kindR.out.trim();
    const id = argv[1]!;
    let readOut = "";
    let readCode = 0;
    if (kind === "github") {
      const r = run(join(HERE, "run"), ["github", mode, "read", id]);
      readOut = r.out;
      readCode = r.code;
    } else if (kind === "plane") {
      const r = run(join(HERE, "run"), ["plane", "read", id]);
      readOut = r.out;
      readCode = r.code;
    } else if (kind === "local") {
      const r = run(join(HERE, "run"), ["local", mode, "read", id]);
      readOut = r.out;
      readCode = r.code;
    } else {
      console.error(
        `ticket-check: tracker kind '${kind}' has no adapter script; read the ticket with its own tooling (trackers.md, other), write its body to a file, and run: run ticket-check --body <file> --title <title>`,
      );
      return 1;
    }
    if (readCode !== 0) {
      console.error(`ticket-check: the ${kind} adapter could not read ${id} (exit ${readCode})`);
      return 1;
    }
    const [faults, count, named] = check(
      (() => {
        const head = readOut.indexOf("\n\n");
        const h = head >= 0 ? readOut.slice(0, head) : readOut;
        const tl = h.split("\n").find((l) => l.startsWith("title:"));
        return tl ? tl.slice(6) : "";
      })(),
      (() => {
        const head = readOut.indexOf("\n\n");
        return head >= 0 ? readOut.slice(head + 2) : "";
      })(),
      TURNPIKES,
    );
    if (faults.length > 0) {
      console.log(faults.join("\n"));
      return 2;
    }
    console.log(`well-formed, ${count} acceptance criteria`);
    console.log(named);
    return 0;
  } catch (e) {
    if (e instanceof DieError) {
      process.stderr.write(`ticket-check: ${e.msg}\n`);
      return e.code;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
