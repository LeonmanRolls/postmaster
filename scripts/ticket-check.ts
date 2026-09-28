// Check a ticket's shape before it is accepted: a title, the problem or feature, numbered
// acceptance criteria each answerable yes or no, the direction, and the turnpikes. This is the
// executable form of the ticket shape in skills/postmaster/trackers.md.
//
//   ticket-check.sh <repo> <ticket-id>                    through the adapter of the kind the repo
//                                                         uses, as scripts/tracker-kind.sh names it:
//                                                         local when its store exists, else the
//                                                         config's [tracker] kind
//   ticket-check.sh --body <body-file> [--title <title>]  a body file, as an adapter's create
//                                                         takes it; the title is judged only when
//                                                         --title gives one
//   ticket-check.sh --splice <base-body> <sections>       print <base-body> with each `##` section
//                                                         of <sections> in place of the one it
//                                                         names, or added where the shape puts it
//   ticket-check.sh --self-test
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
//   - The turnpikes are `default`, `none` or turnpike names, as `scripts/turnpikes.sh resolve`
//     reads them, and every word that is not a turnpike is named. The names come from that
//     script alone, so a turnpike added there needs no change here.
// Code spans, fenced blocks and HTML comments are not read for questions, marks or headings,
// and quoted text is not read for questions. A <!-- that nothing closes is text. Turnpikes are
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
//           with no adapter script; the adapter could not read the ticket; scripts/turnpikes.sh
//           could not be run or gave no verdict; or, with --splice, a sections file that is not a
//           list of `##` sections, or a part it would write named inside a later part of the base
//   exit 2  malformed; one line per missing or malformed part on stdout, the part named first
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

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
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^\s*(`{3,})[^`]*$|^\s*(~{3,})/;
const FENCED_ITEM = /^ *(?:[-*+]|\d{1,9}[.)])[ \t]+(?:(`{3,})[^`]*|(~{3,}).*)$/;
const TICKS = /`+/g;
const SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n).)+?)(?<!`)\1(?!`)/gs;
const QUOTED = /"[^"\n]*"|"[^"\n]*"/g;
const QUESTION = /[?？][*_)\]]*[.,;:]?(?=\s|$)/;
const ITEM = /^( *)(\d{1,9})[.)](?:[ \t]+(.*))?$/;
const BULLET = /^ {0,3}[-*+](?:[ \t]|$)/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
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
    return readFileSync(path, "utf8").replace(/^\ufeff/, "");
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
      const closeRe = new RegExp(`(?<!\`)${bm[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\`)`);
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
    const t = raw[k]?.replace(/\r$/, "");
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

function norm(h: string): string {
  const s = h
    .trim()
    .replace(/[ \t]+#+$/, "")
    .trim()
    .replace(/:$/, "");
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim()
    .toLowerCase();
}

interface Head {
  i: number;
  level: number;
  norm: string;
  raw: string;
}

function headsOf(lines: Array<[string, boolean]>): Head[] {
  const heads: Head[] = [];
  for (let i = 0; i < lines.length; i++) {
    const [t, code] = lines[i]!;
    const m = code ? null : HEADING.exec(t);
    if (m) {
      heads.push({ i, level: (m[1] ?? "").length, norm: norm(m[2] ?? ""), raw: t.trim() });
    }
  }
  return heads;
}

function boundsOf(heads: Head[]): Head[] {
  return heads.filter((h) => h.level <= 2 || h.norm in RANK);
}

function hasWords(lines: Array<[string, boolean]>): boolean {
  return /\w/.test(
    lines
      .map(([t]) => t)
      .join(" ")
      .replace(/_/g, ""),
  );
}

function prose(lines: Array<[string, boolean]>): string {
  return lines
    .filter(([_, code]) => !code)
    .map(([t]) => t)
    .join("\n")
    .replace(SPAN, " ");
}

function marked(p: string): string | null {
  const m1 = /\b(TBD|TBC)\b/.exec(p);
  if (m1) return m1[1]!;
  const m2 = /\b(TODO)\b\s*:/.exec(p);
  if (m2) return m2[1]!;
  const m3 = /^\W*(TODO)\W*$/.exec(p);
  if (m3) return m3[1]!;
  return null;
}

function question(p: string): string | null {
  const masked = p.replace(QUOTED, (m) => " ".repeat(m.length));
  const q = QUESTION.exec(masked);
  if (!q) return null;
  const before = p.slice(0, q.index + 1);
  const parts = before.split(/(?<=[.!?？])\s+|\n\s*/);
  return parts[parts.length - 1] ?? null;
}

function clip(s: string, n = 70): string {
  const t = s.split(/\s+/).filter(Boolean).join(" ");
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
  const r = run(turnpikesPath, ["resolve"], { input: text });
  const said = r.out.split("\n").filter(Boolean);
  if (r.code === 2 && said.length > 0) {
    for (const l of said) fault(part, l);
    return "";
  }
  if (r.code === 0 && said.length === 1 && said[0]?.startsWith("turnpikes: ")) {
    return said[0]!;
  }
  dieT(
    `turnpikes.sh resolve gave no verdict (exit ${r.code}): ${r.err.trim() || r.out.trim() || "no output"}`,
  );
}

function check(
  title: string | null,
  text: string,
  turnpikesPath: string,
): [string[], number, string] {
  const [, lines] = tokenize(text);
  const heads = headsOf(lines);
  const bounds = boundsOf(heads);
  const faults: string[] = [];
  const fault = (part: string, msg: string) => faults.push(`${part}: ${msg}`);
  if (title !== null && !/\w/.test(title.replace(/_/g, ""))) {
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
  const bounds = boundsOf(headsOf(lines));
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

// --- self-test ---------------------------------------------------------------------------------
function selfTest(): void {
  const HERE = scriptsDir(import.meta);
  const SELF = join(HERE, "ticket-check.sh");
  withTempDir((tmp) => {
    if (run("git", ["init", "-q", tmp]).code !== 0) process.exit(1);
    const st = new SelfTest();

    // Get turnpikes list
    const listR = run(join(HERE, "turnpikes.sh"), ["--list"]);
    if (listR.code !== 0) {
      console.error("self-test: turnpikes.sh --list failed");
      process.exit(1);
    }
    const LIST = listR.out;
    const listLines = LIST.trim().split("\n").filter(Boolean);
    const DEF = listLines
      .filter((l) => l.split(/\s+/)[1] === "default")
      .map((l) => l.split(/\s+/)[0])
      .join(", ");
    const N1 = listLines[0]?.split(/\s+/)[0] ?? "";
    const N2 = listLines[1]?.split(/\s+/)[0] ?? "";
    const N2UP = N2.charAt(0).toUpperCase() + N2.slice(1);
    const NOPE = "zz-not-listed";
    if (!DEF || !N2) {
      console.error("self-test: turnpikes.sh needs a default set and two turnpikes");
      process.exit(1);
    }
    if (listLines.some((l) => l.split(/\s+/)[0] === NOPE)) {
      console.error(`self-test: ${NOPE} is a turnpike; pick another unused name`);
      process.exit(1);
    }

    // Body parts
    const P =
      "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.";
    const A =
      "## Acceptance criteria\n1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n2. It exits 2 and names each missing part:\n   - the title\n   - the direction\n   1. a nested number is part of criterion 2, not a criterion\n\n   ```\n   ## Direction\n   ticket-check.sh --body draft.md   # which draft? TODO\n   ```\n3. A question or a marker in code, `a?` or `TODO`, is not read,\nand a line that runs straight on belongs to the criterion above it.\n\n   So does an indented paragraph after a blank line.";
    const D =
      "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.";
    const K = "## Turnpikes\n<!-- default, none, or turnpike names -->\n`default`";
    const N =
      "## Notes\nA heading inside a fenced block is not a section:\n\n```\n## Direction\n```";
    const T = "Check a ticket's shape";
    const NT =
      "## Notes\nContext.\n\n### Turnpikes\nWhy the default was chosen.\n\n### Out of scope\nNothing else.";
    const UJ = "## User journey\nThe user opens the board and reads the ticket.";

    function body(...parts: string[]): void {
      writeFileSync(join(tmp, "body.md"), `${parts.join("\n\n")}\n\n`);
    }
    function runCheck(title: string): { code: number; out: string } {
      const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", title], {
        env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
      });
      return { code: r.code, out: r.out + r.err };
    }

    function expect(
      label: string,
      rcWant: number,
      partsWant: string,
      why = "",
      not = "",
      title: string = T,
    ): void {
      const r = runCheck(title);
      const out = r.out;
      const rc = r.code;
      // BASE: only a failing check (exit 2) names parts; a pass prints "well-formed, ...".
      const partNames =
        (rc === 2
          ? out
              .split("\n")
              .filter((l) =>
                /^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /.test(l),
              )
              .map((l) => l.split(":")[0])
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort()
              .join(",")
          : "") || "none";
      const good =
        rc === rcWant &&
        partNames === partsWant &&
        (!why || out.includes(why)) &&
        (!not || !out.includes(not));
      if (good) st.ok(label);
      else
        st.fail(
          `${label}: wanted exit ${rcWant} naming ${partsWant}${why ? ` with "${why}"` : ""}${not ? ` and without "${not}"` : ""}, got exit ${rc} naming ${partNames}`,
          out,
        );
    }

    function named(label: string, want: string): void {
      const r = runCheck(T);
      const secondLine = r.out.split("\n")[1] ?? "";
      if (r.code === 0 && secondLine === want) st.ok(label);
      else st.fail(`${label}: wanted exit 0 and "${want}", got exit ${r.code}`, r.out);
    }

    // Stand-in adapter
    mkdirSync(join(tmp, "bin"), { recursive: true });
    copyFileSync(SELF, join(tmp, "bin", "ticket-check.sh"));
    copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, "bin", "ticket-check.ts"));
    copyFileSync(join(HERE, "turnpikes.sh"), join(tmp, "bin", "turnpikes.sh"));
    copyFileSync(join(HERE, "turnpikes.ts"), join(tmp, "bin", "turnpikes.ts"));
    copyFileSync(join(HERE, "tracker-kind.sh"), join(tmp, "bin", "tracker-kind.sh"));
    copyFileSync(join(HERE, "tracker-kind.ts"), join(tmp, "bin", "tracker-kind.ts"));
    mkdirSync(join(tmp, "bin", "lib"), { recursive: true });
    for (const f of ["paths.ts", "proc.ts", "data.ts", "selftest.ts"]) {
      copyFileSync(join(HERE, "lib", f), join(tmp, "bin", "lib", f));
    }
    writeFileSync(join(tmp, "github.toml"), '[tracker]\nkind = "github"\n');
    function adapter(script: string): void {
      writeFileSync(join(tmp, "bin", "github.sh"), `#!/usr/bin/env bash\n${script}\n`);
      chmodSync(join(tmp, "bin", "github.sh"), 0o755);
    }
    function through(): { code: number; out: string } {
      const r = run("bash", [join(tmp, "bin", "ticket-check.sh"), tmp, "7"], {
        env: {
          ...(process.env as Record<string, string>),
          POSTMASTER_CONFIG: join(tmp, "github.toml"),
        },
      });
      return { code: r.code, out: r.out + r.err };
    }
    function localsh(script: string): void {
      writeFileSync(join(tmp, "bin", "local.sh"), `#!/usr/bin/env bash\n${script}\n`);
      chmodSync(join(tmp, "bin", "local.sh"), 0o755);
    }
    const NOSTORE =
      'case $2 in store) exit 3 ;; *) echo "stand-in local.sh: $*" >&2; exit 1 ;; esac';
    localsh(NOSTORE);

    console.log("positive controls");
    body(P, A, D, K, N);
    let r = runCheck(T);
    expect("a well-formed ticket passes", 0, "none");
    st.check(
      "it counts three criteria, not the nested number or the lines under them, then prints the turnpikes",
      r.out.trim() === `well-formed, 3 acceptance criteria\nturnpikes: ${DEF}`,
      r.out,
    );
    body(P, A, D, K);
    expect("Notes and User journey are optional", 0, "none");
    const noTitle = run("bash", [SELF, "--body", join(tmp, "body.md")], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    st.check(
      "without --title only the body is judged",
      noTitle.code === 0,
      noTitle.out + noTitle.err,
    );

    body(
      "## Problem/Feature\nTickets arrive without criteria.",
      "## Acceptance Criteria:\n1) The check runs on every ticket.",
      "## Direction ##\nUse the tracker adapters.",
      "## turnpikes:\ndefault",
    );
    expect("headings match ignoring case, a colon, the slash's spacing and a closing #", 0, "none");

    body(
      P,
      "## Acceptance criteria\n1.\nThe check runs, the criterion's text on the line below its number.",
      D,
      K,
    );
    expect("a criterion's text may start on the line below its number", 0, "none");

    body(
      P,
      "## Acceptance criteria\n   1. The check runs.\n   2. It names each part.\n\n---",
      D,
      K,
    );
    expect("a list indented three spaces, and a thematic break after it", 0, "none");

    body(
      P,
      '## Acceptance criteria\n1. Setup asks "Overwrite the config?" before writing, and prints https://example.org/board?view=kanban.\n2. The CLI prompts "Continue? [y/N]" before it deletes an item.',
      D,
      K,
    );
    expect("a question mark in quotes or inside a word is not a question", 0, "none");

    body(
      P,
      "## Acceptance criteria\n1. Setup prints `Overwrite the config?\n   [y/N]` and waits for an answer.",
      D,
      K,
    );
    expect("a code span that wraps onto the next line is still code", 0, "none");

    body(
      "## Problem / feature\nThe template parser fails when a body holds `<!--` with no closer.",
      "## Acceptance criteria\n1. The check runs.\n2. The arrow in `a --> b` is kept.",
      D,
      K,
    );
    expect("a comment marker inside code hides nothing", 0, "none");

    body("## Problem / feature\nThe parser fails on <!-- when nothing closes it.", A, D, K);
    expect("a <!-- inside a line that the line does not close is text", 0, "none");

    body(
      P,
      "<!-- a comment that never closes",
      A,
      "## Direction\nNone: any approach that meets the criteria.",
      "## Turnpikes\ndefault",
    );
    expect("a <!-- at the start of a line that nothing closes is text", 0, "none");

    body(
      P,
      "## Acceptance criteria\n1. The check runs. <!-- TBD: more --> It names each part.",
      D,
      K,
    );
    expect("a comment inside a line is not read", 0, "none");

    body(P, "## Acceptance criteria\n1. ```\n   make check\n   ```\n2. The gate passes.", D, K);
    expect("a criterion that opens with a fenced block", 0, "none");

    body("## Problem / feature\n```ls``` prints nothing in an empty directory.", A, D, K);
    expect("a line opening with a three-backtick code span is not a fence", 0, "none");

    body(
      "## Problem / feature\nThe app has no TODO list.",
      "## Acceptance criteria\n1. A user can add an item to the TODO list.",
      "## Direction\nStore TODO items in the existing database.",
      K,
    );
    {
      const r2 = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", "Add a TODO list"], {
        env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
      });
      st.check("TODO as a word is not a mark", r2.code === 0, r2.out + r2.err);
    }

    writeFileSync(
      join(tmp, "body.md"),
      "## Problem / feature\r\nTickets arrive without criteria.\r\n\r\n## Acceptance criteria\r\n1. The check runs.\r\n\r\n## Direction\r\nNone.\r\n\r\n## Turnpikes\r\ndefault\r\n",
    );
    expect("a body with CRLF line endings passes", 0, "none");

    writeFileSync(
      join(tmp, "body.md"),
      Buffer.concat([
        new Uint8Array([0xef, 0xbb, 0xbf]),
        Buffer.from(`${[P, A, D, K].join("\n\n")}\n\n`),
      ]),
    );
    expect("a byte-order mark hides no heading", 0, "none");

    body(P, A, D, K);
    {
      const r2 = run(
        "bash",
        ["-c", `bash "${SELF}" --body /dev/stdin --title "${T}" < "${join(tmp, "body.md")}"`],
        {
          env: {
            ...(process.env as Record<string, string>),
            TURNPIKES: join(HERE, "turnpikes.sh"),
          },
        },
      );
      st.check("a body read from standard input", r2.code === 0, r2.out + r2.err);
    }

    const printedContent = `id: #7\ntitle: ${T}\nstate: todo\nlabels: \ncreated: 2026-09-23\n\n${[P, A, D, K].join("\n\n")}\n\n## Log\n- 2026-09-25 10:00 postmaster: does a question here count?\n`;
    writeFileSync(join(tmp, "printed.txt"), printedContent);
    adapter(`cat -- '${join(tmp, "printed.txt")}'`);
    r = through();
    st.check("a ticket read through the adapter passes, its log included", r.code === 0, r.out);

    console.log("positive controls: the turnpikes, as scripts/turnpikes.sh reads them");
    body(P, A, D, K);
    named(
      "default, in a code span under a template comment, stands for the default set",
      `turnpikes: ${DEF}`,
    );
    body(P, A, D, "## Turnpikes\nnone");
    named("none passes, and names no turnpike", "turnpikes: none");
    body(P, A, D, `## Turnpikes\n- ${N2UP}\n- \`${N1}\``);
    named("a list passes, as the turnpikes it names", `turnpikes: ${N1}, ${N2}`);
    body(P, A, D, "## Turnpikes\ndefault\n\n---", N);
    named("a thematic break in the section is not a turnpike", `turnpikes: ${DEF}`);

    console.log("negative controls: each part is named on its own");
    body(P, A, D, K, N);
    {
      const rr = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", ""], {
        env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
      });
      st.check("no title", rr.code === 2 && rr.out.includes("title: missing"), rr.out + rr.err);
    }
    // no title in adapter's read
    writeFileSync(
      join(tmp, "printed-untitled.txt"),
      printedContent.replace(/^title: .*/m, "title: "),
    );
    adapter(`cat -- '${join(tmp, "printed-untitled.txt")}'`);
    r = through();
    st.check(
      "no title in the adapter's read",
      r.code === 2 && r.out.includes("title: missing"),
      r.out,
    );

    body(A, D, K, N);
    expect("no problem or feature", 2, "problem / feature", 'no "## Problem / feature" section');
    body("## Problem / feature", A, D, K);
    expect("an empty problem or feature", 2, "problem / feature", "is empty");
    body(P, D, K, N);
    expect(
      "no acceptance criteria",
      2,
      "acceptance criteria",
      'no "## Acceptance criteria" section',
    );
    body(P, "## Acceptance criteria\n- The check runs.\n- It names each part.", D, K);
    expect("criteria that are not numbered", 2, "acceptance criteria", "not a numbered list");
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n1. It names each part.\n1. It exits 2.",
      D,
      K,
    );
    expect(
      "criteria numbered out of order",
      2,
      "acceptance criteria",
      "numbered 1, 1, 1; number them 1 to 3 in order",
    );
    body(P, "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch?", D, K);
    expect(
      "a criterion that asks a question",
      2,
      "acceptance criteria",
      "criterion 2 asks a question",
    );
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. **Should it also run at dispatch?**",
      D,
      K,
    );
    expect(
      "a question closed by emphasis",
      2,
      "acceptance criteria",
      "criterion 2 asks a question",
    );
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. It retries a few times (how many?).",
      D,
      K,
    );
    expect(
      "a question closed by a bracket",
      2,
      "acceptance criteria",
      "criterion 2 asks a question",
    );
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch？",
      D,
      K,
    );
    expect("a full-width question mark", 2, "acceptance criteria", "criterion 2 asks a question");
    body(
      P,
      "## Acceptance criteria\n1. The check runs on every ticket before it is accepted.\n   Should it also run again at dispatch?",
      D,
      K,
    );
    expect(
      "the fault quotes the sentence that asks",
      2,
      "acceptance criteria",
      'criterion 1 asks a question: "Should it also run again at dispatch?"',
    );
    body(P, "## Acceptance criteria\n1. The check runs.\n2. The retry limit is TBD.", D, K);
    expect("a criterion marked TBD", 2, "acceptance criteria", "criterion 2 is marked TBD");
    body(P, "## Acceptance criteria\n1. The check runs.\n2. TODO: decide the retry limit.", D, K);
    expect("a criterion marked TODO:", 2, "acceptance criteria", "criterion 2 is marked TODO");
    body(
      P,
      "## Acceptance criteria\n1. `<!--` opens a comment.\n2. The retry limit is TBD.\n3. `-->` closes one.",
      D,
      K,
    );
    expect(
      "comment markers in code hide no criterion",
      2,
      "acceptance criteria",
      "criterion 2 is marked TBD",
    );
    body(P, "## Acceptance criteria\n1. The check runs.\n2.", D, K);
    expect("an empty criterion", 2, "acceptance criteria", "criterion 2 is empty");
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. It names each part.\n\nAlso, the README names it,\nand the runbook.",
      D,
      K,
    );
    expect(
      "a criterion outside the numbered list",
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "Also, the README names it,"',
    );
    {
      const rr = runCheck(T);
      const countNotPart = rr.out.split("\n").filter((l) => l.includes("not part of")).length;
      st.check(
        "a paragraph outside the list is named once, not per line",
        countNotPart === 1,
        rr.out,
      );
    }
    body(P, "## Acceptance criteria\n1. The check runs.\n- It names each part.", D, K);
    expect(
      "an unnumbered criterion straight after a numbered one",
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "- It names each part."',
    );
    body(P, "## Acceptance criteria\n1. The check runs.\n### Details", D, K);
    expect(
      "a heading straight after a criterion",
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "### Details"',
    );
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n\n```\na stray block\n```\nThe retry limit is TBD.",
      D,
      K,
    );
    expect(
      "text after a stray block is not credited to the criterion above",
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "```"',
      "criterion 1 is marked",
    );
    body(P, A, A, D, K);
    expect("acceptance criteria twice", 2, "acceptance criteria", "appears 2 times");
    body(P, A, K, N);
    expect(
      "no direction, even with one inside a fenced block",
      2,
      "direction",
      'no "## Direction" section; one is needed even if',
    );
    body(P, A, "## Direction\nTBD, once the spike is done.", K);
    expect("a direction marked TBD", 2, "direction", '"## Direction" is marked TBD');
    body(P, A, "## Direction\nTODO", K);
    expect("a direction that says only TODO", 2, "direction", '"## Direction" is marked TODO');
    body(P, A, "## Direction\n<!-- None: any approach that meets the criteria. -->", K);
    expect(
      "a direction written only in a comment is empty",
      2,
      "direction",
      '"## Direction" is empty',
    );
    body(P, "<!-- a comment that starts a line", A, D, K);
    expect(
      "a comment that starts a line hides everything up to the next -->",
      2,
      "acceptance criteria,direction",
    );
    body(P, A, "### Direction\nNone: any approach that meets the criteria.", K);
    expect(
      "a direction at the wrong level",
      2,
      "direction",
      '"### Direction" is there, at the wrong level',
    );
    body(P, D, A, K);
    expect(
      "a direction before the criteria",
      2,
      "direction",
      '"## Direction" comes before "## Acceptance criteria"',
    );
    body(P, A, D, N);
    expect(
      "no turnpikes",
      2,
      "turnpikes",
      'no "## Turnpikes" section; one is needed, holding default, none, or turnpike names',
    );
    body(P, A, D, NT);
    expect(
      "a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level",
      2,
      "turnpikes",
      '"### Turnpikes" is there, at the wrong level',
    );
    body(P, A, D, "## Turnpikes\n- ```none\n  style, bug, security\n  ```");
    expect(
      "a list item that opens a fence is code, and names no turnpike",
      2,
      "turnpikes",
      "names no turnpike",
    );
    body(P, A, D, `## Turnpikes\n${N1}, ${NOPE}`);
    expect(
      "a turnpike scripts/turnpikes.sh does not list is named",
      2,
      "turnpikes",
      `"${NOPE}" is not a turnpike`,
    );
    body(P, A, D, `## Turnpikes\nnone, ${N1}`);
    expect("none listed with another turnpike", 2, "turnpikes", "none stands alone");
    body(P, A, D, "## Turnpikes");
    expect("an empty turnpikes section", 2, "turnpikes", '"## Turnpikes" is empty');
    body(P, A, D, "## Turnpikes\nTBD");
    expect("turnpikes marked TBD", 2, "turnpikes", '"## Turnpikes" is marked TBD');
    body(P, A, D, "### Turnpikes\ndefault");
    expect(
      "turnpikes at the wrong level",
      2,
      "turnpikes",
      '"### Turnpikes" is there, at the wrong level',
    );
    body(P, A, K, D);
    expect(
      "turnpikes before the direction",
      2,
      "turnpikes",
      '"## Turnpikes" comes before "## Direction"',
    );
    body(P, A, D, K, K);
    expect("turnpikes twice", 2, "turnpikes", '"## Turnpikes" appears 2 times');
    writeFileSync(join(tmp, "body.md"), "");
    expect(
      "an empty ticket names all five parts",
      2,
      "acceptance criteria,direction,problem / feature,title,turnpikes",
      "",
      "",
      "",
    );

    console.log("a turnpike is added in scripts/turnpikes.sh alone");
    mkdirSync(join(tmp, "added"), { recursive: true });
    mkdirSync(join(tmp, "broken"), { recursive: true });
    mkdirSync(join(tmp, "alone"), { recursive: true });
    for (const d of ["added", "broken", "alone"]) {
      copyFileSync(SELF, join(tmp, d, "ticket-check.sh"));
      copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, d, "ticket-check.ts"));
      mkdirSync(join(tmp, d, "lib"), { recursive: true });
      for (const f of ["paths.ts", "proc.ts", "data.ts", "selftest.ts"]) {
        copyFileSync(join(HERE, "lib", f), join(tmp, d, "lib", f));
      }
    }
    function addTurnpike(row: string, dir: string): void {
      // The port keeps the table in turnpikes.ts behind the turnpikes.sh wrapper: copy both,
      // and write the row as the table's last row, as BASE's awk did before its TURNPIKES marker.
      copyFileSync(join(HERE, "turnpikes.sh"), join(dir, "turnpikes.sh"));
      chmodSync(join(dir, "turnpikes.sh"), 0o755);
      const src = readFileSync(join(HERE, "turnpikes.ts"), "utf8");
      const out = src.replace(
        /(const TABLE = `[\s\S]*?)(`;)/,
        (_m, a: string, b: string) => `${a}\n${row}${b}`,
      );
      writeFileSync(join(dir, "turnpikes.ts"), out);
    }
    addTurnpike(
      `${NOPE}  -        ship    a check the table does not have yet`,
      join(tmp, "added"),
    );
    addTurnpike("none       -        review  nothing", join(tmp, "broken"));
    body(P, A, D, `## Turnpikes\ndefault, ${NOPE}`);
    {
      const rr = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", T], {
        env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
      });
      st.check(
        "this check names a turnpike that turnpikes.sh does not list",
        rr.code === 2 && rr.out.includes(`"${NOPE}" is not a turnpike`),
        rr.out,
      );
    }
    {
      const rr = run(
        "bash",
        [join(tmp, "added", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
        {
          env: { ...(process.env as Record<string, string>) },
        },
      );
      const secondLine = rr.out.split("\n")[1] ?? "";
      st.check(
        "the same check passes it once turnpikes.sh lists it",
        rr.code === 0 && secondLine === `turnpikes: ${DEF}, ${NOPE}`,
        rr.out,
      );
    }

    console.log("negative controls: a ticket that cannot be read is not a verdict");
    {
      const rr = run("bash", [SELF], { env: process.env as Record<string, string> });
      st.check("no arguments is a usage error", rr.code === 1, rr.out + rr.err);
    }
    {
      const rr = run("bash", [SELF, "--body", join(tmp, "nowhere.md")], {
        env: process.env as Record<string, string>,
      });
      st.check("a missing body file is refused", rr.code === 1, rr.out + rr.err);
    }
    writeFileSync(join(tmp, "other.toml"), '[tracker]\nkind = "other"\nname = "notes"\n');
    {
      const rr = run("bash", [SELF, tmp, "7"], {
        env: {
          ...(process.env as Record<string, string>),
          POSTMASTER_CONFIG: join(tmp, "other.toml"),
        },
      });
      st.check(
        "a tracker kind with no adapter script is refused, not judged",
        rr.code === 1 && rr.out.trim() === "",
        rr.out + rr.err,
      );
    }
    writeFileSync(join(tmp, "broken.toml"), "[tracker\nkind = github\n");
    {
      const rr = run("bash", [SELF, tmp, "7"], {
        env: {
          ...(process.env as Record<string, string>),
          POSTMASTER_CONFIG: join(tmp, "broken.toml"),
        },
      });
      st.check(
        "a config that does not parse is named as one",
        rr.code === 1 && rr.err.includes("does not parse"),
        rr.out + rr.err,
      );
    }
    adapter('echo "github: no board" >&2; exit 3');
    r = through();
    st.check(
      "an adapter that cannot read the ticket is exit 1, not a shape fault",
      r.code === 1 &&
        !/^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /.test(r.out),
      r.out,
    );
    body(P, A, D, K);
    {
      const rr = run(
        "bash",
        [join(tmp, "alone", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
        {
          env: process.env as Record<string, string>,
        },
      );
      st.check(
        "with no turnpikes.sh beside it, the check gives no verdict",
        rr.code === 1 && rr.out.trim() === "",
        rr.out + rr.err,
      );
    }
    {
      const rr = run(
        "bash",
        [join(tmp, "broken", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
        {
          env: process.env as Record<string, string>,
        },
      );
      st.check(
        "a turnpikes.sh whose table breaks its rules gives no verdict",
        rr.code === 1 && rr.out.trim() === "",
        rr.out + rr.err,
      );
    }
    mkdirSync(join(tmp, "silent"), { recursive: true });
    copyFileSync(SELF, join(tmp, "silent", "ticket-check.sh"));
    copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, "silent", "ticket-check.ts"));
    mkdirSync(join(tmp, "silent", "lib"), { recursive: true });
    for (const f of ["paths.ts", "proc.ts", "data.ts", "selftest.ts"]) {
      copyFileSync(join(HERE, "lib", f), join(tmp, "silent", "lib", f));
    }
    writeFileSync(join(tmp, "silent", "turnpikes.sh"), "#!/bin/sh\nexit 2\n");
    chmodSync(join(tmp, "silent", "turnpikes.sh"), 0o755);
    {
      const rr = run(
        "bash",
        [join(tmp, "silent", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
        {
          env: process.env as Record<string, string>,
        },
      );
      st.check(
        "a turnpikes.sh that fails with nothing to say gives no verdict, never a pass",
        rr.code === 1 && rr.out.trim() === "",
        rr.out + rr.err,
      );
    }

    console.log("positive controls: --splice changes the sections given and nothing else");
    function spliceRun(): { code: number; out: string } {
      const r = run("bash", [SELF, "--splice", join(tmp, "base.md"), join(tmp, "sections.md")], {
        env: process.env as Record<string, string>,
      });
      return { code: r.code, out: r.out + r.err };
    }
    function sameSplice(label: string): void {
      const want = readFileSync(join(tmp, "want.md"), "utf8");
      const r = spliceRun();
      if (r.code === 0 && r.out === want) st.ok(label);
      else st.fail(`${label} (exit ${r.code})`, r.out);
    }

    writeFileSync(join(tmp, "base.md"), `${[P, A, K].join("\n\n")}\n\n${N}\n`);
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D, K].join("\n\n")}\n\n${N}\n`);
    sameSplice("a missing direction goes between the criteria and the turnpikes");
    writeFileSync(join(tmp, "body.md"), spliceRun().out);
    expect("the spliced body passes the check", 0, "none");

    writeFileSync(join(tmp, "base.md"), `${[P, A, D].join("\n\n")}\n\n${N}\n`);
    writeFileSync(join(tmp, "sections.md"), `${K}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D, K].join("\n\n")}\n\n${N}\n`);
    sameSplice("a missing turnpikes section goes between the direction and the notes");
    writeFileSync(join(tmp, "body.md"), spliceRun().out);
    named("and the spliced body passes, with the default turnpikes", `turnpikes: ${DEF}`);

    writeFileSync(join(tmp, "base.md"), `${[P, A, UJ, D].join("\n\n")}\n\n${N}\n`);
    writeFileSync(join(tmp, "sections.md"), `${K}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, UJ, D, K].join("\n\n")}\n\n${N}\n`);
    sameSplice("turnpikes go after the direction, even when a user journey comes before it");
    writeFileSync(join(tmp, "body.md"), spliceRun().out);
    named("and that spliced body passes", `turnpikes: ${DEF}`);

    const C = "## Acceptance criteria\n1. Only this criterion.";
    writeFileSync(join(tmp, "base.md"), `${[P, A, D].join("\n\n")}\n\n${N}\n`);
    writeFileSync(join(tmp, "sections.md"), `${C}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, C, D].join("\n\n")}\n\n${N}\n`);
    sameSplice("the criteria are replaced where they stand");

    writeFileSync(join(tmp, "base.md"), `${[P, D, A].join("\n\n")}\n\n${N}\n`);
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D].join("\n\n")}\n\n${N}\n`);
    sameSplice("a direction written before the criteria moves after them");

    writeFileSync(
      join(tmp, "base.md"),
      `${[P, A, "### Direction\nAn old approach."].join("\n\n")}\n\n${N}\n`,
    );
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D].join("\n\n")}\n\n${N}\n`);
    sameSplice("a direction at the wrong level is replaced");

    const X = "## Context\nSeen twice this week.";
    writeFileSync(
      join(tmp, "base.md"),
      `${["Reported in the forum.", P, X, A].join("\n\n")}\n\n${N}\n`,
    );
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(
      join(tmp, "want.md"),
      `${["Reported in the forum.", P, X, A, D].join("\n\n")}\n\n${N}\n`,
    );
    sameSplice("text before the first heading and a section outside the shape are kept");

    writeFileSync(
      join(tmp, "base.md"),
      `${["Reported in the forum.", P, X, D, K].join("\n\n")}\n\n${N}\n`,
    );
    writeFileSync(join(tmp, "sections.md"), `${A}\n`);
    writeFileSync(
      join(tmp, "want.md"),
      `${["Reported in the forum.", P, X, A, D, K].join("\n\n")}\n\n${N}\n`,
    );
    sameSplice(
      "a missing part goes after the part before it and the sections outside the shape that follow it",
    );

    writeFileSync(join(tmp, "base.md"), `${[P, A, N].join("\n\n")}\n\n\n`);
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D, N].join("\n\n")}\n\n\n`);
    {
      const r = run("bash", [SELF, "--splice", join(tmp, "base.md"), join(tmp, "sections.md")], {
        env: process.env as Record<string, string>,
      });
      const want = readFileSync(join(tmp, "want.md"), "utf8");
      st.check(
        "blank lines at the end of the body are kept, byte for byte",
        r.code === 0 && r.out === want,
        `exit ${r.code}\n${r.out}`,
      );
    }

    console.log("negative controls: --splice refuses sections it cannot place");
    writeFileSync(join(tmp, "sections.md"), `Use the adapters.\n\n${D}\n`);
    {
      const r = spliceRun();
      st.check("text before the first heading of the sections", r.code === 1, r.out);
    }
    writeFileSync(join(tmp, "sections.md"), "### Direction\nUse the adapters.\n");
    {
      const r = spliceRun();
      st.check("a section that is not at level two", r.code === 1, r.out);
    }
    writeFileSync(join(tmp, "sections.md"), `${D}\n\n${D}\n`);
    {
      const r = spliceRun();
      st.check("the same section twice", r.code === 1, r.out);
    }
    writeFileSync(join(tmp, "base.md"), `${[P, A, D].join("\n\n")}\n\n${NT}\n`);
    writeFileSync(join(tmp, "sections.md"), `${K}\n`);
    {
      const r = spliceRun();
      st.check(
        "a ### Turnpikes in the notes is neither deleted nor left beside a new one",
        r.code === 1 && r.out.includes('"### Turnpikes" stands inside a later part'),
        r.out,
      );
    }
    writeFileSync(
      join(tmp, "base.md"),
      `${[P, A, "## Notes\nContext.\n\n### Direction\nAn old approach."].join("\n\n")}\n`,
    );
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    {
      const r = spliceRun();
      st.check(
        "a stale ### Direction in the notes is not left beside the new one",
        r.code === 1 && r.out.includes('"### Direction" stands inside a later part'),
        r.out,
      );
    }

    console.log(
      "controls: a repo whose local ticket store exists is read through local.sh, whatever the config names",
    );
    localsh(
      `case $2 in store) exit 0 ;; read) : > '${join(tmp, "local-read")}'; cat -- '${join(tmp, "printed.txt")}' ;; *) exit 1 ;; esac`,
    );
    adapter(`: > '${join(tmp, "github-read")}'; exit 1`);
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    r = through();
    st.check(
      "a repo with a store is read through local.sh, though the config names github",
      r.code === 0 && existsSync(join(tmp, "local-read")) && !existsSync(join(tmp, "github-read")),
      r.out,
    );

    localsh(`case $2 in store) exit 3 ;; *) : > '${join(tmp, "local-read")}'; exit 1 ;; esac`);
    adapter(`: > '${join(tmp, "github-read")}'; cat -- '${join(tmp, "printed.txt")}'`);
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    r = through();
    st.check(
      "a repo with no store is read through the kind the config names",
      r.code === 0 && existsSync(join(tmp, "github-read")) && !existsSync(join(tmp, "local-read")),
      r.out,
    );

    localsh(
      `case $2 in store) echo 'local: not a git repository' >&2; exit 1 ;; *) : > '${join(tmp, "local-read")}'; exit 1 ;; esac`,
    );
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    r = through();
    st.check(
      "a store that cannot be looked for stops the check, and no adapter is read",
      r.code === 1 &&
        !existsSync(join(tmp, "github-read")) &&
        !existsSync(join(tmp, "local-read")) &&
        r.out.includes("cannot look for a local store"),
      r.out,
    );
    localsh(NOSTORE);

    st.finish();
  });
}

// --- entry -------------------------------------------------------------------------------------
const TURNPIKES = join(scriptsDir(import.meta), "turnpikes.sh");
const argv = process.argv.slice(2);
const mode = argv[0] ?? "";

if (mode === "--self-test") {
  selfTest();
} else if (mode === "--body") {
  if (argv.length === 2 || (argv.length === 4 && argv[2] === "--title")) {
    try {
      const text = loadText(argv[1]!);
      const title = argv.length === 4 ? argv[3]! : null;
      const [faults, count, named] = check(title, text, TURNPIKES);
      if (faults.length > 0) {
        console.log(faults.join("\n"));
        process.exit(2);
      }
      console.log(`well-formed, ${count} acceptance criteria`);
      console.log(named);
      process.exit(0);
    } catch (e) {
      if (e instanceof DieError) {
        process.stderr.write(`ticket-check: ${e.msg}\n`);
        process.exit(e.code);
      }
      throw e;
    }
  }
  console.error(
    "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test",
  );
  process.exit(1);
} else if (mode === "--splice") {
  if (argv.length !== 3) {
    console.error(
      "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test",
    );
    process.exit(1);
  }
  try {
    const baseText = loadText(argv[1]!);
    const sectionsText = loadText(argv[2]!);
    process.stdout.write(splice(baseText, sectionsText, TURNPIKES));
    process.exit(0);
  } catch (e) {
    if (e instanceof DieError) {
      process.stderr.write(`ticket-check: ${e.msg}\n`);
      process.exit(e.code);
    }
    throw e;
  }
} else if (mode === "" || mode.startsWith("-")) {
  console.error(
    "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test",
  );
  process.exit(1);
} else {
  // <repo> <ticket-id> through adapter
  if (argv.length !== 2) {
    console.error(
      "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test",
    );
    process.exit(1);
  }
  try {
    const HERE = scriptsDir(import.meta);
    const kindR = run(join(HERE, "tracker-kind.sh"), [mode]);
    if (kindR.code !== 0) {
      // BASE left tracker-kind.sh's stderr to flow through; run() captures it, so forward it.
      process.stderr.write(kindR.err);
      process.exit(1);
    }
    const kind = kindR.out.trim();
    const id = argv[1]!;
    let readOut = "";
    let readCode = 0;
    if (kind === "github") {
      const r = run(join(HERE, "github.sh"), [mode, "read", id]);
      readOut = r.out;
      readCode = r.code;
    } else if (kind === "plane") {
      const r = run(join(HERE, "plane.sh"), ["read", id]);
      readOut = r.out;
      readCode = r.code;
    } else if (kind === "local") {
      const r = run(join(HERE, "local.sh"), [mode, "read", id]);
      readOut = r.out;
      readCode = r.code;
    } else {
      console.error(
        `ticket-check: tracker kind '${kind}' has no adapter script; read the ticket with its own tooling (trackers.md, other), write its body to a file, and run: ticket-check.sh --body <file> --title <title>`,
      );
      process.exit(1);
    }
    if (readCode !== 0) {
      console.error(`ticket-check: the ${kind} adapter could not read ${id} (exit ${readCode})`);
      process.exit(1);
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
      process.exit(2);
    }
    console.log(`well-formed, ${count} acceptance criteria`);
    console.log(named);
    process.exit(0);
  } catch (e) {
    if (e instanceof DieError) {
      process.stderr.write(`ticket-check: ${e.msg}\n`);
      process.exit(e.code);
    }
    throw e;
  }
}
