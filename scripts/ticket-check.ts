#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const self = join(here, "ticket-check.sh");
const scriptDirPath = process.env.POSTMASTER_TICKET_SCRIPT_DIR ?? here;
const turnpikesPath = process.env.POSTMASTER_TURNPIKES ?? join(scriptDirPath, "turnpikes.sh");
const tick = String.fromCharCode(96);
const headingRe = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const itemRe = /^( *)(\d{1,9})[.)](?:[ \t]+(.*))?$/;
const bulletRe = /^ {0,3}[-*+](?:[ \t]|$)/;
const breakRe = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const fenceRe = new RegExp("^\\s*(" + tick + "{3,})[^" + tick + "]*$|^\\s*(~{3,})");
const fencedItemRe = new RegExp(
  "^ *(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:" + "(" + tick + "{3,})[^" + tick + "]*|(~{3,}).*)$",
);
const ticksRe = new RegExp(tick + "+", "g");
const spanRe = new RegExp(
  "(?<!" + tick + ")(" + tick + "+)(?!" + tick + ")(?:(?!\\n[ \\t]*\\n).)+?(?<!" + tick + ")\\1(?!" + tick + ")",
  "gs",
);
const quoteRe = /"[^"\n]*"|“[^”\n]*”/g;
const questionRe = /[?？][*_)\]]*[.,;:]?(?=\s|$)/u;
const partDefs = [
  ["problem / feature", "Problem / feature"],
  ["acceptance criteria", "Acceptance criteria"],
  ["direction", "Direction"],
  ["turnpikes", "Turnpikes"],
] as const;
const rank: Record<string, number> = {
  "problem / feature": 0,
  "acceptance criteria": 1,
  direction: 2,
  turnpikes: 3,
  notes: 4,
  "user journey": 5,
};
type ReadLine = [text: string, code: boolean];
type Heading = [line: number, level: number, normal: string, written: string];
class ExitFault extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string): never {
  throw new ExitFault(message);
}
function hasWords(lines: ReadLine[]): boolean {
  return /[\p{L}\p{N}]/u.test(lines.map(([line]) => line).join(" "));
}
function uncomment(text: string, inComment: boolean, lineIndex: number, last: [number, number]): [string, boolean] {
  const output: string[] = [];
  let i = 0;
  while (true) {
    if (inComment) {
      const end = text.indexOf("-->", i);
      if (end < 0) return [output.join(""), true];
      i = end + 3;
      inComment = false;
      continue;
    }
    const comment = text.indexOf("<!--", i),
      code = ticksRe.exec(text.slice(i));
    if (code && (comment < 0 || code.index! < comment)) {
      const open = i + code.index!,
        closer = new RegExp("(?<!" + tick + ")" + code[0] + "(?!" + tick + ")");
      const tail = text.slice(open + code[0].length),
        found = closer.exec(tail);
      const end = found ? open + code[0].length + found.index + found[0].length : open + code[0].length;
      output.push(text.slice(i, end));
      i = end;
      ticksRe.lastIndex = 0;
    } else if (comment < 0) {
      output.push(text.slice(i));
      return [output.join(""), false];
    } else if (
      !text.slice(0, comment).trim() &&
      (lineIndex < last[0] || (lineIndex === last[0] && comment + 4 <= last[1]))
    ) {
      output.push(text.slice(i, comment));
      i = comment + 4;
      inComment = true;
    } else {
      const close = text.indexOf("-->", comment + 4);
      if (close >= 0) {
        output.push(text.slice(i, comment));
        i = close + 3;
      } else {
        output.push(text.slice(i, comment + 4));
        i = comment + 4;
      }
    }
  }
}
function tokenize(text: string): [string[], ReadLine[]] {
  const raw = text.split("\n");
  let last: [number, number] = [-1, -1];
  raw.forEach((line, k) => {
    const pos = line.lastIndexOf("-->");
    if (pos >= 0 && k > last[0]) last = [k, pos];
  });
  const lines: ReadLine[] = [];
  let fence: string | null = null,
    inComment = false;
  for (let k = 0; k < raw.length; k++) {
    const original = raw[k]!;
    if (fence) {
      lines.push([original, true]);
      const s = original.trim();
      if (s.length >= fence.length && s === fence[0]!.repeat(s.length)) fence = null;
      continue;
    }
    const m = inComment ? null : fenceRe.exec(original);
    const item = inComment || m ? null : fencedItemRe.exec(original);
    if (m) {
      fence = m[1] ?? m[2] ?? "";
      lines.push([original, true]);
    } else if (item) {
      fence = item[1] ?? item[2] ?? "";
      lines.push([original, false]);
    } else {
      const [line, inside] = uncomment(original, inComment, k, last);
      inComment = inside;
      lines.push([line, false]);
    }
  }
  return [raw, lines];
}
function normHeading(text: string): string {
  const clean = text
    .trim()
    .replace(/[ \t]+#+$/, "")
    .trim()
    .replace(/:$/, "");
  return clean
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function headingsOf(lines: ReadLine[]): Heading[] {
  const heads: Heading[] = [];
  lines.forEach(([text, code], line) => {
    const m = code ? null : headingRe.exec(text);
    if (m) heads.push([line, m[1]!.length, normHeading(m[2] ?? ""), text.trim()]);
  });
  return heads;
}
function boundsOf(heads: Heading[]): Heading[] {
  return heads.filter((heading) => heading[1] <= 2 || heading[2] in rank);
}
function prose(lines: ReadLine[]): string {
  const text = lines
    .filter(([, code]) => !code)
    .map(([line]) => line)
    .join("\n");
  return text.replace(spanRe, " ");
}
function marked(text: string): string | null {
  const startWord = "(?<![\\p{L}\\p{N}_])",
    endWord = "(?![\\p{L}\\p{N}_])";
  const match =
    new RegExp(startWord + "(TBD|TBC)" + endWord, "u").exec(text) ??
    new RegExp(startWord + "(TODO)" + endWord + "\\s*:", "u").exec(text) ??
    /^\W*(TODO)\W*$/u.exec(text);
  return match?.[1] ?? null;
}
function question(text: string): string | null {
  const withoutQuotes = text.replace(quoteRe, (value) => " ".repeat(value.length));
  const match = questionRe.exec(withoutQuotes);
  if (!match) return null;
  return (
    text
      .slice(0, match.index + 1)
      .split(/(?<=[.!?？])\s+|\n\s*/)
      .at(-1) ?? null
  );
}
function clip(text: string, limit = 70): string {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  return flat.length <= limit ? flat : flat.slice(0, limit - 3) + "...";
}
function criteria(fault: (part: string, message: string) => void, part: string, body: ReadLine[]): number {
  const items: Array<[number, ReadLine[]]> = [],
    strays: string[] = [];
  let current: [number, ReadLine[]] | null = null,
    base: number | null = null,
    owner: [number, ReadLine[]] | null = null;
  let blank = false,
    previousCode = false,
    inStray = false;
  for (const [line, code] of body) {
    if (code) {
      if (!previousCode) {
        owner = current && (line.startsWith(" ") || !blank) ? current : null;
        if (!owner) {
          if (!inStray) strays.push(line.trim());
          current = null;
          inStray = true;
        }
      }
      if (owner) owner[1].push([line, true]);
      previousCode = true;
      blank = false;
      continue;
    }
    previousCode = false;
    if (!line.trim() || breakRe.test(line)) {
      blank = true;
      inStray = false;
      continue;
    }
    const m = itemRe.exec(line);
    if (m && m[1]!.length <= (base === null ? 3 : base + 2)) {
      if (base === null) base = m[1]!.length;
      current = [Number(m[2]), [[m[3] ?? "", false]]];
      items.push(current);
      blank = false;
      inStray = false;
      continue;
    }
    if (current && (line.startsWith(" ") || (!blank && !bulletRe.test(line) && !headingRe.test(line)))) {
      current[1].push([line, false]);
      blank = false;
      continue;
    }
    if (!inStray) strays.push(line.trim());
    current = null;
    blank = false;
    inStray = true;
  }
  if (!items.length) {
    fault(part, "not a numbered list");
    return 0;
  }
  for (const stray of strays) fault(part, 'not part of a numbered criterion: "' + clip(stray) + '"');
  const numbers = items.map(([number]) => number);
  if (numbers.some((number, i) => number !== i + 1))
    fault(part, "numbered " + numbers.join(", ") + "; number them 1 to " + numbers.length + " in order");
  items.forEach(([, lines], i) => {
    if (!hasWords(lines)) {
      fault(part, "criterion " + (i + 1) + " is empty");
      return;
    }
    const text = prose(lines),
      mark = marked(text),
      asks = question(text);
    if (mark) fault(part, "criterion " + (i + 1) + " is marked " + mark);
    if (asks) fault(part, "criterion " + (i + 1) + ' asks a question: "' + clip(asks) + '"');
  });
  return items.length;
}
function turnpikes(fault: (part: string, message: string) => void, part: string, body: ReadLine[]): string {
  const text = body
    .filter(([line, code]) => !code && !fencedItemRe.test(line))
    .map(([line]) => line)
    .join("\n");
  const result = command(turnpikesPath, ["resolve"], { input: text });
  const lines = result.stdout.split(/\r?\n/).filter((line, i, all) => line || i < all.length - 1);
  if (result.code === 2 && lines.length) {
    for (const line of lines) fault(part, line);
    return "";
  }
  if (result.code === 0 && lines.length === 1 && lines[0]!.startsWith("turnpikes: ")) return lines[0]!;
  die(
    "turnpikes.sh resolve gave no verdict (exit " +
      result.code +
      "): " +
      (result.stderr.trim() || result.stdout.trim() || "no output"),
  );
}
function check(title: string | null, text: string): [string[], number, string] {
  const [, lines] = tokenize(text),
    heads = headingsOf(lines),
    bounds = boundsOf(heads);
  const faults: string[] = [],
    at: Record<string, number> = {};
  let count = 0,
    named = "";
  const fault = (part: string, message: string) => faults.push(part + ": " + message);
  if (title !== null && !/[\p{L}\p{N}]/u.test(title)) fault("title", "missing");
  for (const [key, name] of partDefs) {
    const found = bounds.filter((heading) => heading[1] === 2 && heading[2] === key);
    if (!found.length) {
      const near = heads.filter((heading) => heading[2] === key);
      let message = 'no "## ' + name + '" section';
      if (near.length) message += '; "' + near[0]![3] + '" is there, at the wrong level';
      else if (key === "direction")
        message += '; one is needed even if it says "None: any approach that meets the criteria"';
      else if (key === "turnpikes") message += "; one is needed, holding default, none, or turnpike names";
      fault(key, message);
      continue;
    }
    if (found.length > 1) fault(key, '"## ' + name + '" appears ' + found.length + " times");
    const i = found[0]![0];
    at[key] = i;
    const next = bounds.find((heading) => heading[0] > i)?.[0] ?? lines.length;
    const body = lines.slice(i + 1, next);
    if (!hasWords(body)) fault(key, '"## ' + name + '" is empty');
    else if (key === "acceptance criteria") count = criteria(fault, key, body);
    else if (marked(prose(body))) fault(key, '"## ' + name + '" is marked ' + marked(prose(body)));
    else if (key === "turnpikes") named = turnpikes(fault, key, body);
  }
  for (let j = 0; j < partDefs.length; j++) {
    const [key, name] = partDefs[j]!;
    const previous = partDefs.slice(0, j).find(([prior]) => prior in at && key in at && at[prior]! > at[key]!);
    if (previous)
      fault(
        key,
        '"## ' +
          name +
          '" comes before "## ' +
          previous[1] +
          '"; the order is ' +
          partDefs.map((part) => part[1]).join(", "),
      );
  }
  return [faults, count, named];
}
function chunks(text: string): [string[], Array<{ heading: Heading; lines: string[] }>] {
  let raw = text.split("\n");
  const [, readable] = tokenize(text);
  if (raw.at(-1) === "") {
    raw = raw.slice(0, -1);
    readable.pop();
  }
  const bounds = boundsOf(headingsOf(readable));
  const starts = [...bounds.map((heading) => heading[0]), raw.length];
  return [
    raw.slice(0, starts[0]),
    bounds.map((heading, k) => ({ heading, lines: raw.slice(heading[0], starts[k + 1]) })),
  ];
}
function splice(baseText: string, sectionsText: string): string {
  const [pre, sections] = chunks(baseText),
    [lead, given] = chunks(sectionsText);
  if (lead.some((line) => line.trim())) die("the sections file has text before its first heading");
  if (!given.length) die("the sections file has no ## sections");
  for (const part of given)
    if (part.heading[1] !== 2) die('"' + part.heading[3] + '" in the sections file is not a ## heading');
  if (new Set(given.map((part) => part.heading[2])).size !== given.length)
    die("the sections file names a section twice");
  const headingNames = new Map(given.map((part) => [part.heading[2], part.heading[3]]));
  let top = -1;
  for (const part of sections) {
    const [, level, normal, written] = part.heading,
      sectionRank = rank[normal];
    if (level === 2 && sectionRank !== undefined) top = Math.max(top, sectionRank);
    else if (level > 2 && headingNames.has(normal) && sectionRank !== undefined && sectionRank < top)
      die(
        '"' +
          written +
          '" stands inside a later part; splicing "' +
          headingNames.get(normal) +
          '" would delete it or leave two, so move or rename it first',
      );
  }
  let output = sections.map((part) => [part.heading[2], part.lines, false] as [string, string[], boolean]);
  for (const part of given) {
    const key = part.heading[2];
    output = output.filter((section) => section[0] !== key);
    const sectionRank = rank[key];
    let at: number;
    if (sectionRank === undefined) at = output.length;
    else {
      const before = output.flatMap((section, index) =>
        (rank[section[0]] ?? sectionRank) < sectionRank ? [index] : [],
      );
      if (before.length) {
        at = before.at(-1)! + 1;
        while (at < output.length && rank[output[at]![0]] === undefined) at++;
      } else at = output.findIndex((section) => (rank[section[0]] ?? -1) > sectionRank);
      if (at < 0) at = output.length;
    }
    const lines = [...part.lines];
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    output.splice(at, 0, [key, lines, true]);
  }
  const lines = [...pre];
  output.forEach(([, section, isNew], index) => {
    if (isNew && lines.length && lines.at(-1)!.trim()) lines.push("");
    lines.push(...section);
    if (isNew && index + 1 < output.length) lines.push("");
  });
  return lines.join("\n") + "\n";
}
function readText(path: string): string {
  try {
    return new TextDecoder("utf-8").decode(readFileSync(path)).replace(/\r\n?/g, "\n");
  } catch (error) {
    const detail = String((error as { message?: string }).message ?? error).replace(/^Error: /, "");
    die("cannot read " + path + ": " + detail);
  }
}
function printCheck(title: string | null, body: string): number {
  const [faults, count, named] = check(title, body);
  if (faults.length) {
    process.stdout.write(faults.join("\n") + "\n");
    return 2;
  }
  writeOut("well-formed, " + count + " acceptance criteria");
  writeOut(named);
  return 0;
}
function throughAdapter(repo: string, id: string): number {
  const tracker = command(join(scriptDirPath, "tracker-kind.sh"), [repo]);
  if (tracker.code !== 0) {
    if (tracker.stderr) process.stderr.write(tracker.stderr);
    return 1;
  }
  const kind = tracker.stdout.trim(),
    adapter = join(scriptDirPath, kind + ".sh");
  if (!["github", "plane", "local"].includes(kind)) {
    writeError(
      "ticket-check: tracker kind '" +
        kind +
        "' has no adapter script; read the ticket with its own tooling (trackers.md, other), write its body to a file, and run: ticket-check.sh --body <file> --title <title>",
    );
    return 1;
  }
  const args = kind === "plane" ? ["read", id] : [repo, "read", id];
  const result = command(adapter, args);
  if (result.code !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    writeError("ticket-check: the " + kind + " adapter could not read " + id + " (exit " + result.code + ")");
    return 1;
  }
  const value = result.stdout,
    boundary = value.indexOf("\n\n");
  const head = boundary < 0 ? value : value.slice(0, boundary);
  const body = boundary < 0 ? "" : value.slice(boundary + 2);
  const title =
    head
      .split("\n")
      .find((line) => line.startsWith("title:"))
      ?.slice(6) ?? "";
  return printCheck(title, body);
}
function usage(): never {
  die(
    "usage: ticket-check.sh <repo> <ticket-id> | --body <body-file> [--title <title>] | --splice <base-body> <sections> | --self-test",
  );
}
function run(args: string[]): number {
  try {
    if (args[0] === "--self-test") return args.length === 1 ? selfTestSync() : usage();
    if (args[0] === "--body") {
      if (args.length !== 2 && !(args.length === 4 && args[2] === "--title")) usage();
      const body = readText(args[1]!);
      return printCheck(args.length === 4 ? args[3]! : null, body);
    }
    if (args[0] === "--splice") {
      if (args.length !== 3) usage();
      process.stdout.write(splice(readText(args[1]!), readText(args[2]!)));
      return 0;
    }
    if (!args.length || args[0]!.startsWith("-") || args.length !== 2) usage();
    return throughAdapter(args[0]!, args[1]!);
  } catch (error) {
    if (error instanceof ExitFault) {
      writeError("ticket-check: " + error.message);
      return error.code;
    }
    writeError("ticket-check: " + String(error).replace(/^Error: /, ""));
    return 1;
  }
}
function selfTestSync(): number {
  const tmp = makeTemp("ticket-check-test-");
  command("git", ["init", "-q", tmp]);
  let fails = 0;
  const checkControl = (label: string, good: boolean, detail = "") => {
    writeOut((good ? "  ok   " : "  FAIL ") + label);
    if (!good) {
      for (const line of detail.split("\n")) writeOut("         " + line);
      fails++;
    }
  };
  const invoke = (args: string[], env: Record<string, string | undefined> = {}) => command(self, args, { env });
  const bodyPath = join(tmp, "body.md");
  const bodyText = (...parts: string[]) => parts.join("\n\n") + "\n\n";
  const writeBody = (text: string) => writeFileSync(bodyPath, text);
  const runBody = (text: string, title: string | null = "Check a ticket's shape") => {
    writeBody(text);
    return title === null ? invoke(["--body", bodyPath]) : invoke(["--body", bodyPath, "--title", title]);
  };
  const expect = (
    label: string,
    result: ReturnType<typeof command>,
    code: number,
    partsWanted: string,
    has = "",
    not = "",
  ) => {
    const parts =
      result.code === 2
        ? [
            ...new Set(
              result.stdout.split("\n").flatMap((line) => {
                const m = /^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /.exec(line);
                return m ? [m[1]!] : [];
              }),
            ),
          ]
            .sort()
            .join(",") || "none"
        : "none";
    checkControl(
      label,
      result.code === code &&
        parts === partsWanted &&
        (!has || (result.stdout + result.stderr).includes(has)) &&
        (!not || !(result.stdout + result.stderr).includes(not)),
      "wanted exit " +
        code +
        " naming " +
        partsWanted +
        ", got exit " +
        result.code +
        " naming " +
        parts +
        (has ? "\nexpected text: " + has : "") +
        "\n" +
        result.stdout +
        result.stderr,
    );
  };
  const named = (label: string, result: ReturnType<typeof command>, line: string) =>
    checkControl(
      label,
      result.code === 0 && result.stdout.split("\n")[1] === line,
      "wanted " + line + ", got " + result.stdout,
    );
  const P =
    "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.";
  const A = [
    "## Acceptance criteria",
    "1. The check exits 0 on a well-formed ticket and prints how many criteria it has.",
    "2. It exits 2 and names each missing part:",
    "   - the title",
    "   - the direction",
    "   1. a nested number is part of criterion 2, not a criterion",
    "",
    "   " + tick.repeat(3),
    "   ## Direction",
    "   ticket-check.sh --body draft.md   # which draft? TODO",
    "   " + tick.repeat(3),
    "3. A question or a marker in code, " + tick + "a?" + tick + " or " + tick + "TODO" + tick + ", is not read,",
    "and a line that runs straight on belongs to the criterion above it.",
    "and a line that runs straight on belongs to the criterion above it.",
    "",
    "   So does an indented paragraph after a blank line.",
  ].join("\n");
  const D = "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.";
  const K = "## Turnpikes\n<!-- default, none, or turnpike names -->\n" + tick + "default" + tick;
  const N =
    "## Notes\nA heading inside a fenced block is not a section:\n\n" +
    tick.repeat(3) +
    "\n## Direction\n" +
    tick.repeat(3);
  const T = "Check a ticket's shape";
  const NT = "## Notes\nContext.\n\n### Turnpikes\nWhy the default was chosen.\n\n### Out of scope\nNothing else.";
  const UJ = "## User journey\nThe user opens the board and reads the ticket.";
  const listResult = command(turnpikesPath, ["--list"]);
  if (listResult.code !== 0) die("self-test: turnpikes.sh --list failed");
  const table = listResult.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length);
  const defaultNames = table.filter((cols) => cols[1] === "default").map((cols) => cols[0]);
  const n1 = table[0]?.[0] ?? "",
    n2 = table[1]?.[0] ?? "";
  const noName = "zz-not-listed";
  if (!defaultNames.length || !n2 || table.some((cols) => cols[0] === noName))
    die("self-test: turnpikes.sh needs its controls");
  const defaults = defaultNames.join(", ");
  const n2Upper = n2[0]!.toUpperCase() + n2.slice(1);
  const valid = bodyText(P, A, D, K, N);
  const expectBody = (
    label: string,
    text: string,
    title: string | null,
    code: number,
    parts: string,
    has = "",
    not = "",
  ) => expect(label, runBody(text, title), code, parts, has, not);

  writeOut("positive controls");
  let result = runBody(valid);
  expect("a well-formed ticket passes", result, 0, "none");
  checkControl(
    "it counts three criteria, not the nested number or the lines under them, then prints the turnpikes",
    result.stdout === "well-formed, 3 acceptance criteria\nturnpikes: " + defaults + "\n",
    result.stdout,
  );
  expectBody("Notes and User journey are optional", bodyText(P, A, D, K), T, 0, "none");
  expect("without --title only the body is judged", runBody(bodyText(P, A, D, K), null), 0, "none");
  expectBody(
    "headings match ignoring case, a colon, the slash's spacing and a closing #",
    bodyText(
      "## Problem/Feature\nTickets arrive without criteria.",
      "## Acceptance Criteria:\n1) The check runs on every ticket.",
      "## Direction ##\nUse the tracker adapters.",
      "## turnpikes:\ndefault",
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a criterion's text may start on the line below its number",
    bodyText(P, "## Acceptance criteria\n1.\nThe check runs, the criterion's text on the line below its number.", D, K),
    T,
    0,
    "none",
  );
  expectBody(
    "a list indented three spaces, and a thematic break after it",
    bodyText(P, "## Acceptance criteria\n   1. The check runs.\n   2. It names each part.\n\n---", D, K),
    T,
    0,
    "none",
  );
  expectBody(
    "a question mark in quotes or inside a word is not a question",
    bodyText(
      P,
      '## Acceptance criteria\n1. Setup asks "Overwrite the config?" before writing, and prints https://example.org/board?view=kanban.\n2. The CLI prompts "Continue? [y/N]" before it deletes an item.',
      D,
      K,
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a code span that wraps onto the next line is still code",
    bodyText(
      P,
      "## Acceptance criteria\n1. Setup prints " +
        tick +
        "Overwrite the config?\n   [y/N]" +
        tick +
        " and waits for an answer.",
      D,
      K,
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a comment marker inside code hides nothing",
    bodyText(
      "## Problem / feature\nThe template parser fails when a body holds " + tick + "<!--" + tick + " with no closer.",
      "## Acceptance criteria\n1. The check runs.\n2. The arrow in " + tick + "a --> b" + tick + " is kept.",
      D,
      K,
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a <!-- inside a line that the line does not close is text",
    bodyText("## Problem / feature\nThe parser fails on <!-- when nothing closes it.", A, D, K),
    T,
    0,
    "none",
  );
  expectBody(
    "a <!-- at the start of a line that nothing closes is text",
    bodyText(
      P,
      "<!-- a comment that never closes",
      A,
      "## Direction\nNone: any approach that meets the criteria.",
      "## Turnpikes\ndefault",
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a comment inside a line is not read",
    bodyText(P, "## Acceptance criteria\n1. The check runs. <!-- TBD: more --> It names each part.", D, K),
    T,
    0,
    "none",
  );
  expectBody(
    "a criterion that opens with a fenced block",
    bodyText(
      P,
      "## Acceptance criteria\n1. " +
        tick.repeat(3) +
        "\n   make check\n   " +
        tick.repeat(3) +
        "\n2. The gate passes.",
      D,
      K,
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "a line opening with a three-backtick code span is not a fence",
    bodyText(
      "## Problem / feature\n" + tick.repeat(3) + "ls" + tick.repeat(3) + " prints nothing in an empty directory.",
      A,
      D,
      K,
    ),
    T,
    0,
    "none",
  );
  expectBody(
    "TODO as a word is not a mark",
    bodyText(
      "## Problem / feature\nThe app has no TODO list.",
      "## Acceptance criteria\n1. A user can add an item to the TODO list.",
      "## Direction\nStore TODO items in the existing database.",
      K,
    ),
    "Add a TODO list",
    0,
    "none",
  );
  const crlf = bodyText(P, A, D, K).replace(/\n/g, "\r\n");
  expectBody("a body with CRLF line endings passes", crlf, T, 0, "none");
  expectBody("a byte-order mark hides no heading", "\ufeff" + bodyText(P, A, D, K), T, 0, "none");
  writeBody(valid);
  const stdinResult = command(self, ["--body", "/dev/stdin", "--title", T], { input: valid });
  expect("a body read from standard input", stdinResult, 0, "none");

  const printedPath = join(tmp, "printed.txt"),
    bins = join(tmp, "bin");
  mkdirSync(bins);
  writeFileSync(
    printedPath,
    "id: #7\ntitle: " +
      T +
      "\nstate: todo\nlabels: \ncreated: 2026-09-23\n\n" +
      bodyText(P, A, D, K) +
      "## Log\n- 2026-09-25 10:00 postmaster: does a question here count?\n",
  );
  writeFileSync(join(bins, "tracker-kind.sh"), "#!/bin/sh\nprintf 'github\\n'\n");
  writeFileSync(join(bins, "github.sh"), "#!/bin/sh\ncat -- '" + printedPath + "'\n");
  writeFileSync(join(bins, "local.sh"), "#!/bin/sh\nexit 3\n");
  writeFileSync(join(bins, "plane.sh"), "#!/bin/sh\nexit 1\n");
  for (const file of ["tracker-kind.sh", "github.sh", "local.sh", "plane.sh"])
    command("chmod", ["+x", join(bins, file)]);
  result = invoke([tmp, "7"], { POSTMASTER_TICKET_SCRIPT_DIR: bins, POSTMASTER_TURNPIKES: turnpikesPath });
  expect("a ticket read through the adapter passes, its log included", result, 0, "none");

  const githubConfig = join(tmp, "github.toml");
  writeFileSync(githubConfig, '[tracker]\nkind = "github"\n');
  writeFileSync(join(bins, "tracker-kind.sh"), "#!/bin/sh\nexec bun '" + join(here, "tracker-kind.ts") + '\' "$@"\n');
  command("chmod", ["+x", join(bins, "tracker-kind.sh")]);
  const localRead = join(tmp, "local-read"),
    githubRead = join(tmp, "github-read");
  writeFileSync(
    join(bins, "local.sh"),
    '#!/bin/sh\ncase "$2" in store) exit 3 ;; read) : > \'' + localRead + "'; cat -- '" + printedPath + "' ;; esac\n",
  );
  writeFileSync(join(bins, "github.sh"), "#!/bin/sh\n: > '" + githubRead + "'; exit 1\n");
  command("chmod", ["+x", join(bins, "local.sh"), join(bins, "github.sh")]);
  const storePath = join(tmp, ".git", "postmaster", "tickets");
  mkdirSync(storePath, { recursive: true });
  result = invoke([tmp, "7"], {
    POSTMASTER_CONFIG: githubConfig,
    POSTMASTER_TICKET_SCRIPT_DIR: bins,
    POSTMASTER_TURNPIKES: turnpikesPath,
  });
  checkControl(
    "a repo with a store is read through local.sh, though the config names github",
    result.code === 0 && existsSync(localRead) && !existsSync(githubRead),
    result.stdout + result.stderr,
  );
  removeTree(storePath);
  try {
    unlinkSync(localRead);
  } catch {
    /* It was not written on a failed adapter. */
  }
  try {
    unlinkSync(githubRead);
  } catch {
    /* It was not written on a failed adapter. */
  }
  writeFileSync(join(bins, "github.sh"), "#!/bin/sh\n: > '" + githubRead + "'; cat -- '" + printedPath + "'\n");
  command("chmod", ["+x", join(bins, "github.sh")]);
  result = invoke([tmp, "7"], {
    POSTMASTER_CONFIG: githubConfig,
    POSTMASTER_TICKET_SCRIPT_DIR: bins,
    POSTMASTER_TURNPIKES: turnpikesPath,
  });
  checkControl(
    "a repo with no store is read through the kind the config names",
    result.code === 0 && existsSync(githubRead) && !existsSync(localRead),
    result.stdout + result.stderr,
  );
  const noRepo = makeTemp("ticket-check-not-a-repository-");
  try {
    unlinkSync(localRead);
  } catch {
    /* It was not written on a failed adapter. */
  }
  try {
    unlinkSync(githubRead);
  } catch {
    /* It was not written on a failed adapter. */
  }
  result = invoke([noRepo, "7"], {
    POSTMASTER_CONFIG: githubConfig,
    POSTMASTER_TICKET_SCRIPT_DIR: bins,
    POSTMASTER_TURNPIKES: turnpikesPath,
  });
  checkControl(
    "a store that cannot be looked for stops the check, and no adapter is read",
    result.code === 1 &&
      !existsSync(localRead) &&
      !existsSync(githubRead) &&
      result.stderr.includes("cannot look for a local store"),
    result.stdout + result.stderr,
  );

  writeOut("positive controls: the turnpikes, as scripts/turnpikes.sh reads them");
  named(
    "default, in a code span under a template comment, stands for the default set",
    runBody(bodyText(P, A, D, K), T),
    "turnpikes: " + defaults,
  );
  named("none passes, and names no turnpike", runBody(bodyText(P, A, D, "## Turnpikes\nnone"), T), "turnpikes: none");
  named(
    "a list passes, as the turnpikes it names",
    runBody(bodyText(P, A, D, "## Turnpikes\n- " + n2Upper + "\n- " + tick + n1 + tick), T),
    "turnpikes: " + n1 + ", " + n2,
  );
  named(
    "a thematic break in the section is not a turnpike",
    runBody(bodyText(P, A, D, "## Turnpikes\ndefault\n\n---", N), T),
    "turnpikes: " + defaults,
  );

  writeOut("negative controls: each part is named on its own");
  expect("no title", runBody(bodyText(P, A, D, K, N), ""), 2, "title", "title: missing");
  const untitled = printedPath + "-untitled";
  writeFileSync(untitled, readFileSync(printedPath, "utf8").replace("title: " + T, "title: "));
  writeFileSync(join(bins, "github.sh"), "#!/bin/sh\ncat -- '" + untitled + "'\n");
  command("chmod", ["+x", join(bins, "github.sh")]);
  expect(
    "no title in the adapter's read",
    invoke([tmp, "7"], {
      POSTMASTER_TICKET_SCRIPT_DIR: bins,
      POSTMASTER_TURNPIKES: turnpikesPath,
    }),
    2,
    "title",
    "title: missing",
  );
  const badCases: Array<[string, string, string, string, string?]> = [
    ["no problem or feature", bodyText(A, D, K, N), "problem / feature", 'no "## Problem / feature" section'],
    ["an empty problem or feature", bodyText("## Problem / feature", A, D, K), "problem / feature", "is empty"],
    ["no acceptance criteria", bodyText(P, D, K, N), "acceptance criteria", 'no "## Acceptance criteria" section'],
    [
      "criteria that are not numbered",
      bodyText(P, "## Acceptance criteria\n- The check runs.\n- It names each part.", D, K),
      "acceptance criteria",
      "not a numbered list",
    ],
    [
      "criteria numbered out of order",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n1. It names each part.\n1. It exits 2.", D, K),
      "acceptance criteria",
      "numbered 1, 1, 1; number them 1 to 3 in order",
    ],
    [
      "a criterion that asks a question",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch?", D, K),
      "acceptance criteria",
      "criterion 2 asks a question",
    ],
    [
      "a question closed by emphasis",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. **Should it also run at dispatch?**", D, K),
      "acceptance criteria",
      "criterion 2 asks a question",
    ],
    [
      "a question closed by a bracket",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. It retries a few times (how many?).", D, K),
      "acceptance criteria",
      "criterion 2 asks a question",
    ],
    [
      "a full-width question mark",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch？", D, K),
      "acceptance criteria",
      "criterion 2 asks a question",
    ],
    [
      "the fault quotes the sentence that asks",
      bodyText(
        P,
        "## Acceptance criteria\n1. The check runs on every ticket before it is accepted.\n   Should it also run again at dispatch?",
        D,
        K,
      ),
      "acceptance criteria",
      'criterion 1 asks a question: "Should it also run again at dispatch?"',
    ],
    [
      "a criterion marked TBD",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. The retry limit is TBD.", D, K),
      "acceptance criteria",
      "criterion 2 is marked TBD",
    ],
    [
      "a criterion marked TODO:",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2. TODO: decide the retry limit.", D, K),
      "acceptance criteria",
      "criterion 2 is marked TODO",
    ],
    [
      "comment markers in code hide no criterion",
      bodyText(
        P,
        "## Acceptance criteria\n1. " +
          tick +
          "<!--" +
          tick +
          " opens a comment.\n2. The retry limit is TBD.\n3. " +
          tick +
          "-->" +
          tick +
          " closes one.",
        D,
        K,
      ),
      "acceptance criteria",
      "criterion 2 is marked TBD",
    ],
    [
      "an empty criterion",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n2.", D, K),
      "acceptance criteria",
      "criterion 2 is empty",
    ],
    [
      "a criterion outside the numbered list",
      bodyText(
        P,
        "## Acceptance criteria\n1. The check runs.\n2. It names each part.\n\nAlso, the README names it,\nand the runbook.",
        D,
        K,
      ),
      "acceptance criteria",
      'not part of a numbered criterion: "Also, the README names it,"',
    ],
    [
      "an unnumbered criterion straight after a numbered one",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n- It names each part.", D, K),
      "acceptance criteria",
      'not part of a numbered criterion: "- It names each part."',
    ],
    [
      "a heading straight after a criterion",
      bodyText(P, "## Acceptance criteria\n1. The check runs.\n### Details", D, K),
      "acceptance criteria",
      'not part of a numbered criterion: "### Details"',
    ],
    [
      "text after a stray block is not credited to the criterion above",
      bodyText(
        P,
        "## Acceptance criteria\n1. The check runs.\n\n" +
          tick.repeat(3) +
          "\na stray block\n" +
          tick.repeat(3) +
          "\nThe retry limit is TBD.",
        D,
        K,
      ),
      "acceptance criteria",
      'not part of a numbered criterion: "' + tick.repeat(3) + '"',
      "criterion 1 is marked",
    ],
    ["acceptance criteria twice", bodyText(P, A, A, D, K), "acceptance criteria", "appears 2 times"],
    [
      "no direction, even with one inside a fenced block",
      bodyText(P, A, K, N),
      "direction",
      'no "## Direction" section; one is needed even if',
    ],
    [
      "a direction marked TBD",
      bodyText(P, A, "## Direction\nTBD, once the spike is done.", K),
      "direction",
      '"## Direction" is marked TBD',
    ],
    [
      "a direction that says only TODO",
      bodyText(P, A, "## Direction\nTODO", K),
      "direction",
      '"## Direction" is marked TODO',
    ],
    [
      "a direction written only in a comment is empty",
      bodyText(P, A, "## Direction\n<!-- None: any approach that meets the criteria. -->", K),
      "direction",
      '"## Direction" is empty',
    ],
    [
      "a comment that starts a line hides everything up to the next -->",
      bodyText(P, "<!-- a comment that starts a line", A, D, K),
      "acceptance criteria,direction",
      "",
    ],
    [
      "a direction at the wrong level",
      bodyText(P, A, "### Direction\nNone: any approach that meets the criteria.", K),
      "direction",
      '"### Direction" is there, at the wrong level',
    ],
    [
      "a direction before the criteria",
      bodyText(P, D, A, K),
      "direction",
      '"## Direction" comes before "## Acceptance criteria"',
    ],
    [
      "no turnpikes",
      bodyText(P, A, D, N),
      "turnpikes",
      'no "## Turnpikes" section; one is needed, holding default, none, or turnpike names',
    ],
    [
      "a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level",
      bodyText(P, A, D, NT),
      "turnpikes",
      '"### Turnpikes" is there, at the wrong level',
    ],
    [
      "a list item that opens a fence is code, and names no turnpike",
      bodyText(P, A, D, "## Turnpikes\n- " + tick.repeat(3) + "none\n  style, bug, security\n  " + tick.repeat(3)),
      "turnpikes",
      "names no turnpike",
    ],
    [
      "a turnpike scripts/turnpikes.sh does not list is named",
      bodyText(P, A, D, "## Turnpikes\n" + n1 + ", " + noName),
      "turnpikes",
      '"' + noName + '" is not a turnpike',
    ],
    [
      "none listed with another turnpike",
      bodyText(P, A, D, "## Turnpikes\nnone, " + n1),
      "turnpikes",
      "none stands alone",
    ],
    ["an empty turnpikes section", bodyText(P, A, D, "## Turnpikes"), "turnpikes", '"## Turnpikes" is empty'],
    ["turnpikes marked TBD", bodyText(P, A, D, "## Turnpikes\nTBD"), "turnpikes", '"## Turnpikes" is marked TBD'],
    [
      "turnpikes at the wrong level",
      bodyText(P, A, D, "### Turnpikes\ndefault"),
      "turnpikes",
      '"### Turnpikes" is there, at the wrong level',
    ],
    ["turnpikes before the direction", bodyText(P, A, K, D), "turnpikes", '"## Turnpikes" comes before "## Direction"'],
    ["turnpikes twice", bodyText(P, A, D, K, K), "turnpikes", '"## Turnpikes" appears 2 times'],
  ];
  for (const [label, text, parts, has, not] of badCases) expectBody(label, text, T, 2, parts, has, not);
  expectBody(
    "an empty ticket names all five parts",
    "",
    "",
    2,
    "acceptance criteria,direction,problem / feature,title,turnpikes",
  );

  writeOut("a turnpike is added in scripts/turnpikes.sh alone");
  const customTurnpikes = join(tmp, "turnpikes-added.sh");
  writeFileSync(
    customTurnpikes,
    '#!/bin/sh\ncase "$1" in --list) printf \'style default review x\\nbug default review y\\nsecurity default review z\\n' +
      noName +
      " - review added\\n' ;; resolve) printf 'turnpikes: style, bug, security, " +
      noName +
      "\\n' ;; esac\n",
    { mode: 0o755 },
  );
  expectBody(
    "this check names a turnpike that turnpikes.sh does not list",
    bodyText(P, A, D, "## Turnpikes\ndefault, " + noName),
    T,
    2,
    "turnpikes",
    '"' + noName + '" is not a turnpike',
  );
  named(
    "the same check passes it once turnpikes.sh lists it",
    invoke(["--body", bodyPath, "--title", T], { POSTMASTER_TURNPIKES: customTurnpikes }),
    "turnpikes: " + defaults + ", " + noName,
  );

  writeOut("negative controls: a ticket that cannot be read is not a verdict");
  checkControl("no arguments is a usage error", invoke([]).code === 1);
  checkControl("a missing body file is refused", invoke(["--body", join(tmp, "nowhere.md")]).code === 1);
  const otherConfig = join(tmp, "other.toml");
  writeFileSync(otherConfig, '[tracker]\nkind = "other"\nname = "notes"\n');
  result = invoke([tmp, "7"], { POSTMASTER_CONFIG: otherConfig });
  checkControl("a tracker kind with no adapter script is refused, not judged", result.code === 1 && !result.stdout);
  const brokenConfig = join(tmp, "broken.toml");
  writeFileSync(brokenConfig, "[tracker\nkind = github\n");
  result = invoke([tmp, "7"], { POSTMASTER_CONFIG: brokenConfig });
  checkControl(
    "a config that does not parse is named as one",
    result.code === 1 && result.stderr.includes("does not parse"),
    result.stderr,
  );

  writeFileSync(join(bins, "github.sh"), "#!/bin/sh\necho 'github: no board' >&2\nexit 3\n");
  command("chmod", ["+x", join(bins, "github.sh")]);
  result = invoke([tmp, "7"], { POSTMASTER_TICKET_SCRIPT_DIR: bins });
  checkControl(
    "an adapter that cannot read the ticket is exit 1, not a shape fault",
    result.code === 1 && !/^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /m.test(result.stdout),
    result.stdout + result.stderr,
  );
  result = invoke(["--body", bodyPath, "--title", T], { POSTMASTER_TURNPIKES: join(tmp, "missing-turnpikes.sh") });
  checkControl("with no turnpikes.sh beside it, the check gives no verdict", result.code === 1 && !result.stdout);
  const brokenTurnpikes = join(tmp, "broken-turnpikes.sh");
  writeFileSync(
    brokenTurnpikes,
    "#!/bin/sh\ncase \"$1\" in --list) exit 0 ;; resolve) printf 'none - review broken\\n'; exit 0 ;; esac\n",
    { mode: 0o755 },
  );
  result = invoke(["--body", bodyPath, "--title", T], { POSTMASTER_TURNPIKES: brokenTurnpikes });
  checkControl("a turnpikes.sh whose table breaks its rules gives no verdict", result.code === 1 && !result.stdout);
  const silentTurnpikes = join(tmp, "silent-turnpikes.sh");
  writeFileSync(silentTurnpikes, "#!/bin/sh\nexit 2\n", { mode: 0o755 });
  result = invoke(["--body", bodyPath, "--title", T], { POSTMASTER_TURNPIKES: silentTurnpikes });
  checkControl(
    "a turnpikes.sh that fails with nothing to say gives no verdict, never a pass",
    result.code === 1 && !result.stdout,
  );

  writeOut("positive controls: --splice changes the sections given and nothing else");
  const basePath = join(tmp, "base.md"),
    sectionsPath = join(tmp, "sections.md");
  const spliceRun = (base: string, sections: string) => {
    writeFileSync(basePath, base);
    writeFileSync(sectionsPath, sections);
    return invoke(["--splice", basePath, sectionsPath]);
  };
  const same = (label: string, result_: ReturnType<typeof command>, want: string) =>
    checkControl(label, result_.code === 0 && result_.stdout === want, result_.stdout);
  let base = bodyText(P, A, K) + N + "\n",
    sections = D + "\n";
  let expected = bodyText(P, A, D, K) + N + "\n";
  same("a missing direction goes between the criteria and the turnpikes", spliceRun(base, sections), expected);
  writeBody(expected);
  expect("the spliced body passes the check", invoke(["--body", bodyPath, "--title", T]), 0, "none");
  base = bodyText(P, A, D) + N + "\n";
  sections = K + "\n";
  expected = bodyText(P, A, D, K) + N + "\n";
  same("a missing turnpikes section goes between the direction and the notes", spliceRun(base, sections), expected);
  named("and the spliced body passes, with the default turnpikes", runBody(expected, T), "turnpikes: " + defaults);
  base = bodyText(P, A, UJ, D) + N + "\n";
  sections = K + "\n";
  expected = bodyText(P, A, UJ, D, K) + N + "\n";
  same(
    "turnpikes go after the direction, even when a user journey comes before it",
    spliceRun(base, sections),
    expected,
  );
  named("and that spliced body passes", runBody(expected, T), "turnpikes: " + defaults);
  const C = "## Acceptance criteria\n1. Only this criterion.";
  base = bodyText(P, A, D) + N + "\n";
  sections = C + "\n";
  expected = bodyText(P, C, D) + N + "\n";
  same("the criteria are replaced where they stand", spliceRun(base, sections), expected);
  base = bodyText(P, D, A) + N + "\n";
  sections = D + "\n";
  expected = bodyText(P, A, D) + N + "\n";
  same("a direction written before the criteria moves after them", spliceRun(base, sections), expected);
  base = bodyText(P, A, "### Direction\nAn old approach.") + N + "\n";
  sections = D + "\n";
  expected = bodyText(P, A, D) + N + "\n";
  same("a direction at the wrong level is replaced", spliceRun(base, sections), expected);
  const X = "## Context\nSeen twice this week.";
  base = bodyText("Reported in the forum.", P, X, A) + N + "\n";
  sections = D + "\n";
  expected = bodyText("Reported in the forum.", P, X, A, D) + N + "\n";
  same("text before the first heading and a section outside the shape are kept", spliceRun(base, sections), expected);
  base = bodyText("Reported in the forum.", P, X, D, K) + N + "\n";
  sections = A + "\n";
  expected = bodyText("Reported in the forum.", P, X, A, D, K) + N + "\n";
  same(
    "a missing part goes after the part before it and the sections outside the shape that follow it",
    spliceRun(base, sections),
    expected,
  );
  base = bodyText(P, A, N) + "\n";
  sections = D + "\n";
  expected = bodyText(P, A, D, N) + "\n";
  result = spliceRun(base, sections);
  same("blank lines at the end of the body are kept, byte for byte", result, expected);

  writeOut("negative controls: --splice refuses sections it cannot place");
  const badSplices: Array<[string, string, string, string]> = [
    [
      "text before the first heading of the sections",
      bodyText(P, A, D, K),
      "Use the adapters.\n\n" + D + "\n",
      "text before",
    ],
    [
      "a section that is not at level two",
      bodyText(P, A, D, K),
      "### Direction\nUse the adapters.\n",
      "not a ## heading",
    ],
    ["the same section twice", bodyText(P, A, D, K), D + "\n\n" + D + "\n", "names a section twice"],
    [
      "a ### Turnpikes in the notes is neither deleted nor left beside a new one",
      bodyText(P, A, D, NT),
      K,
      '"### Turnpikes" stands inside a later part',
    ],
    [
      "a stale ### Direction in the notes is not left beside the new one",
      bodyText(P, A, "## Notes\nContext.\n\n### Direction\nAn old approach."),
      D,
      '"### Direction" stands inside a later part',
    ],
  ];
  for (const [label, baseText, sectionText, has] of badSplices) {
    result = spliceRun(baseText, sectionText);
    checkControl(label, result.code === 1 && result.stderr.includes(has), result.stdout + result.stderr);
  }
  removeTree(noRepo);
  removeTree(tmp);
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
process.exit(run(process.argv.slice(2)));
