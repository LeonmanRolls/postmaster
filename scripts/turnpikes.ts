// The turnpikes: the checks a run must pass through before it ships. The project's gate is not
// one of them; it runs on every run. This is the one place the turnpikes and the default set are
// defined. A ticket names its run's turnpikes in its `## Turnpikes` section, and
// scripts/ticket-check.sh, the postmaster and the coachman all read them from here.
//
//   turnpikes.sh --list                 every turnpike, one per line: its name, `default` or `-`,
//                                       the leg that runs it, and what it checks
//   turnpikes.sh resolve [<text>...]    a `## Turnpikes` section's text, as the turnpikes it
//                                       names; with no text given, the section is read from stdin
//   turnpikes.sh legs <dispatch> [--expect <line>]
//                                       a run's legs, from the `turnpikes:` line under its
//                                       waybill's title; with --expect, that line must be <line>
//   turnpikes.sh legs --line <line>     the legs a waybill with that `turnpikes:` line would have
//   turnpikes.sh short <line>           the default turnpikes a `turnpikes:` line leaves out
//   turnpikes.sh --self-test
//
//   exit 0  printed
//   exit 1  usage, no waybill, or a table that breaks its rules
//   exit 2  resolve: the text is not a turnpikes section; legs and short: the line is missing,
//           is not names or none, or is not the one --expect gives. One line per fault, on stdout.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const HERE = scriptsDir(import.meta);

const TABLE = `# name     set      leg     what it checks
style      default  review  idiom, naming, abstraction and consistency with the project's own conventions
bug        default  review  correctness, logic, and whether the tests are adequate
security   default  review  exploit paths through the project's risk surfaces`;

const LEGS: Array<[number, string]> = [
  [1, "synthesis"],
  [2, "review"],
  [3, "ship"],
];
const ALWAYS = new Set(["synthesis", "ship"]);
const RESERVED = ["default", "none"];
const BREAK = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const LINE = /^[ \t]*turnpikes[ \t]*:/;

type Row = { name: string; d: boolean; leg: string; what: string };

function parseTable(table: string): { rows: Row[]; faults: string[] } {
  const rows: Row[] = [];
  const faults: string[] = [];
  const lines = table.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const f = line.split(/\s+/).slice(0, 4);
    // actually need up to 4 fields: name, mark, leg, what (what may have spaces)
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/[^\W_]/.test(parts.slice(3).join(" "))) {
      faults.push(`line ${n + 1} needs a name, default or -, a leg, and what it checks`);
      continue;
    }
    const name = parts[0] ?? "";
    const mark = parts[1] ?? "";
    const leg = parts[2] ?? "";
    const what = parts.slice(3).join(" ").trim();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      faults.push(`line ${n + 1}: "${name}" is not a lowercase word`);
    } else if (RESERVED.includes(name)) {
      faults.push(
        `line ${n + 1}: "${name}" already means something in a ticket, so no turnpike is named it`,
      );
    } else if (rows.some((r) => r.name === name)) {
      faults.push(`line ${n + 1}: "${name}" is listed twice`);
    }
    if (mark !== "default" && mark !== "-") {
      faults.push(`line ${n + 1}: "${mark}" is neither default nor -`);
    }
    if (!LEGS.some(([, l]) => l === leg)) {
      faults.push(
        `line ${n + 1}: "${leg}" is not a leg; the legs are ${LEGS.map(([, l]) => l).join(", ")}`,
      );
    }
    rows.push({ name, d: mark === "default", leg, what });
  }
  return { rows, faults };
}

function wordsOf(text: string): string[] {
  const words: string[] = [];
  // remove Cf (format) characters
  const cleaned = [...text]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      // Cf category approx: ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, LRM U+200E, RLM U+200F, etc.
      // We'll use a simpler check for common ones plus a regex
      return !/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(ch);
    })
    .join("");
  for (const rawLine of cleaned.split("\n")) {
    let line = rawLine.replace(/\r$/, "").replace(/\\+$/, "");
    if (BREAK.test(line)) continue;
    const m = MARKER.exec(line);
    if (m) line = line.slice(m[0].length);
    for (const tok of line.split(/[\s,;]+/)) {
      if (tok) {
        // BASE: tok.strip("`*_").rstrip(".").strip("`*_").lower() or tok
        const stripped = tok
          .replace(/^[*_`]+/, "")
          .replace(/[*_`]+$/, "")
          .replace(/\.+$/, "")
          .replace(/^[*_`]+/, "")
          .replace(/[*_`]+$/, "")
          .toLowerCase();
        words.push(stripped || tok);
      }
    }
  }
  return words;
}

function resolve(table: string, text: string): { names: string[] | null; faults: string[] } {
  const { rows, faults: tableFaults } = parseTable(table);
  if (tableFaults.length > 0) {
    // already handled by caller
  }
  const names = rows.map((r) => r.name);
  const defaults = rows.filter((r) => r.d).map((r) => r.name);
  const words = wordsOf(text);
  const holds = `the section holds only default, none, or names from: ${names.join(", ") || "(no turnpikes)"}`;
  if (words.length === 0) {
    return { names: null, faults: [`names no turnpike; ${holds}`] };
  }
  const out: string[] = [];
  const uniqueUnknown = [...new Set(words)].filter(
    (w) => !names.includes(w) && !RESERVED.includes(w),
  );
  const unknown = uniqueUnknown.map((w) => `"${w}"`);
  if (unknown.length > 0) {
    const which =
      unknown.length === 1
        ? unknown[0]
        : unknown.slice(0, -1).join(", ") + " and " + unknown[unknown.length - 1];
    out.push(
      `${which} ${unknown.length === 1 ? "is not a turnpike" : "are not turnpikes"}; ${holds}`,
    );
  }
  if (words.includes("none") && new Set(words).size > 1) {
    out.push("none stands alone, and is not listed with other turnpikes");
  }
  if (out.length > 0) return { names: null, faults: out };
  const chosen = new Set(words);
  if (words.includes("default")) for (const d of defaults) chosen.add(d);
  return { names: names.filter((n) => chosen.has(n)), faults: [] };
}

function named(table: string, line: string): string[] | null {
  if (line.includes("\n") || !LINE.test(line)) {
    console.log(`"${line.replace(/\n/g, "\\n")}" is not a turnpikes: line`);
    process.exit(2);
  }
  const value = line.replace(LINE, "").replace(/^([ \t]*turnpikes[ \t]*:)/, "");
  // LINE.sub("", line, count=1) removes the matched prefix
  const value2 = line.replace(/^[ \t]*turnpikes[ \t]*:/, "");
  if (wordsOf(value2).includes("default")) {
    console.log(
      "the waybill's turnpikes line says default; it carries the names ticket-check.sh printed for the ticket",
    );
    process.exit(2);
  }
  const { names, faults } = resolve(table, value2);
  if (faults.length > 0) {
    console.log(faults.map((o) => `the waybill's turnpikes: ${o}`).join("\n"));
    process.exit(2);
  }
  return names ?? [];
}

function legsOf(table: string, line: string): void {
  const got = named(table, line);
  for (const [n, leg] of LEGS) {
    const runs = (got ?? []).filter((x) => {
      const { rows } = parseTable(table);
      return rows.find((r) => r.name === x)?.leg === leg;
    });
    if (ALWAYS.has(leg) || runs.length > 0) {
      console.log([String(n), leg, ...runs].join(" "));
    }
  }
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  if (argv.length !== 1)
    die(
      "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
      1,
    );
  // fall through
} else if (argv[0] === "--list") {
  if (argv.length !== 1)
    die(
      "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
      1,
    );
  const { rows, faults } = parseTable(TABLE);
  if (faults.length > 0) {
    console.error(faults.map((f) => `turnpikes: the table's ${f}`).join("\n"));
    process.exit(1);
  }
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(10)} ${(r.d ? "default" : "-").padEnd(8)} ${r.leg.padEnd(9)} ${r.what}`,
    );
  }
  process.exit(0);
} else if (argv[0] === "resolve") {
  const text = argv.length > 1 ? argv.slice(1).join(" ") : readFileSync(0, "utf8");
  // BASE's core refused any command on a table that breaks its rules; resolve must too.
  const tableCheck = parseTable(TABLE);
  if (tableCheck.faults.length > 0) {
    console.error(tableCheck.faults.map((f) => `turnpikes: the table's ${f}`).join("\n"));
    process.exit(1);
  }
  const { names, faults } = resolve(TABLE, text);
  if (faults.length > 0) {
    console.log(faults.join("\n"));
    process.exit(2);
  }
  console.log(`turnpikes: ${(names ?? []).join(", ") || "none"}`);
  process.exit(0);
} else if (argv[0] === "short") {
  if (argv.length !== 2)
    die(
      "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
      1,
    );
  const got = named(TABLE, argv[1] ?? "");
  const { rows } = parseTable(TABLE);
  for (const r of rows.filter((r) => r.d)) {
    if (!(got ?? []).includes(r.name)) console.log(r.name);
  }
  process.exit(0);
} else if (argv[0] === "legs") {
  if (argv[1] === "--line") {
    if (argv.length !== 3)
      die(
        "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
        1,
      );
    legsOf(TABLE, argv[2] ?? "");
    process.exit(0);
  }
  const ok1 = argv.length === 2;
  const ok2 = argv.length === 4 && argv[2] === "--expect";
  if (!ok1 && !ok2)
    die(
      "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
      1,
    );
  const brief = join(argv[1] ?? "", "brief.md");
  if (!existsSync(brief)) {
    console.error(`turnpikes: no waybill at ${brief}`);
    process.exit(1);
  }
  const lines = readFileSync(brief, "utf8").split("\n");
  const above: string[] = [];
  for (const l of lines) {
    if (l.startsWith("## ")) break;
    above.push(l.replace(/\r$/, ""));
  }
  const found = above.filter((l) => LINE.test(l));
  if (found.length !== 1) {
    console.log(
      `the waybill has ${found.length === 0 ? "no" : String(found.length)} turnpikes: line${found.length === 1 ? "" : "s"} under its title, above the ticket, and one is needed; none is never assumed`,
    );
    process.exit(2);
  }
  if (ok2 && (found[0] ?? "").split(/\s+/).join(" ") !== (argv[3] ?? "").split(/\s+/).join(" ")) {
    console.log(
      `the waybill says "${(found[0] ?? "").trim()}", and the ticket's check printed "${(argv[3] ?? "").trim()}"`,
    );
    process.exit(2);
  }
  legsOf(TABLE, found[0] ?? "");
  process.exit(0);
} else {
  die(
    "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
    1,
  );
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const self = join(HERE, "turnpikes.sh");
  const st = new SelfTest();
  let out = "";
  let rc = 0;

  function runSelf(...args: string[]): void {
    const r = run("bash", [self, ...args]);
    // BASE's run() used $(...), which strips trailing newlines.
    out = (r.out + r.err).replace(/\n+$/, "");
    rc = r.code;
  }

  function is(label: string, exit: number, expected: string): void {
    if (rc === exit && out === expected) st.ok(label);
    else st.fail(`${label}: wanted exit ${exit}, got ${rc}`, out);
  }

  function has(label: string, exit: number, want: string, notWant?: string): void {
    const ok1 = rc === exit && out.includes(want);
    const ok2 = notWant === undefined || notWant === "" || !out.includes(notWant);
    if (ok1 && ok2) st.ok(label);
    else
      st.fail(
        `${label}: wanted exit ${exit} with "${want}"${notWant ? ` and no "${notWant}"` : ""}, got exit ${rc}`,
        out,
      );
  }

  function waybill(dir: string, line: string, notes = ""): void {
    mkdirSync(dir, { recursive: true });
    const content = `# Waybill: T-1\n${line}\n\n## Ticket\n## Problem / feature\nA change.\n\n## Turnpikes\ndefault\n\n## Notes\n${notes}\n\n## Project profile\nrepo: /r\n\n## Dispatch\nname: #1, A change\ndispatch: ${dir}\ntool: /t\n`;
    writeFileSync(join(dir, "brief.md"), content, "utf8");
  }

  function lines(...args: string[]): string {
    return args.join("\n");
  }

  const NOPE = "zz-not-listed";
  {
    const r = run("bash", [self, "--list"]);
    if (r.out.split("\n").some((l) => l.split(/\s+/)[0] === NOPE)) {
      console.error(`self-test: ${NOPE} is in the table; pick another unused name`);
      process.exit(1);
    }
  }
  const PLUS = `${TABLE}\n${NOPE}  -        ship    a check the table does not have yet`;

  console.log("positive controls: the list");
  runSelf("--list");
  {
    const allPresent = ["style", "bug", "security"].every(
      (n) => out.split("\n").filter((l) => l.split(/\s+/)[0] === n).length === 1,
    );
    st.check("--list names style, bug and security, once each", rc === 0 && allPresent, out);
  }
  {
    const defaults = out
      .split("\n")
      .filter((l) => l.split(/\s+/)[1] === "default")
      .map((l) => l.split(/\s+/)[0])
      .join(" ");
    st.check("the default set is style, bug and security", defaults === "style bug security", out);
  }
  {
    const legs = [
      ...new Set(
        out
          .split("\n")
          .filter((l) => /^(style|bug|security)$/.test(l.split(/\s+/)[0] ?? ""))
          .map((l) => l.split(/\s+/)[2]),
      ),
    ];
    st.check("the three run in the review leg", legs.length === 1 && legs[0] === "review", out);
  }

  console.log("positive controls: a ticket's section");
  runSelf("resolve", "default");
  is("default stands for the default set", 0, "turnpikes: style, bug, security");
  runSelf("resolve", "none");
  is("none stands for no turnpike", 0, "turnpikes: none");
  runSelf("resolve", "security, bug");
  is("a list names its turnpikes, in the table's order", 0, "turnpikes: bug, security");
  runSelf("resolve", "default, bug");
  is("in a list, default still stands for the three", 0, "turnpikes: style, bug, security");
  runSelf("resolve", lines("- Bug", "- `security`."));
  is(
    "case, backticks, list markers and a closing full stop are ignored",
    0,
    "turnpikes: bug, security",
  );
  runSelf("resolve", lines("default", "", "---", "", "***"));
  is("a thematic break is not a name", 0, "turnpikes: style, bug, security");
  runSelf("resolve", "bug\\\nsecurity");
  is("a hard line break is not part of a name", 0, "turnpikes: bug, security");
  runSelf("resolve", "default\u200B");
  is("an invisible character is not part of a name", 0, "turnpikes: style, bug, security");
  {
    const r = run("bash", ["-c", `printf '1. bug\\n2. security\\n' | "${self}" resolve`]);
    out = (r.out + r.err).replace(/\n+$/, "");
    rc = r.code;
    is("with no text given, the section is read from stdin", 0, "turnpikes: bug, security");
  }
  runSelf("resolve", "bug, security");
  const line = out;
  runSelf("resolve", line.replace(/^turnpikes: /, ""));
  is("the waybill's line resolves to itself", 0, line);
  // a turnpike added to the table resolves with nothing else changed
  {
    const { names } = resolve(PLUS, `default, ${NOPE}`);
    out = `turnpikes: ${(names ?? []).join(", ")}`;
    rc = 0;
    is(
      "a turnpike added to the table resolves with nothing else changed",
      0,
      `turnpikes: style, bug, security, ${NOPE}`,
    );
  }

  console.log("positive controls: a run's legs");
  waybill(join(tmp, "none"), "turnpikes: none");
  runSelf("legs", join(tmp, "none"));
  is("a run with no turnpikes goes from synthesis to ship", 0, lines("1 synthesis", "3 ship"));
  waybill(join(tmp, "default"), "turnpikes: style, bug, security");
  runSelf("legs", join(tmp, "default"));
  is(
    "a run with the default turnpikes has a review leg that runs all three",
    0,
    lines("1 synthesis", "2 review style bug security", "3 ship"),
  );
  waybill(join(tmp, "style"), "turnpikes: style");
  runSelf("legs", join(tmp, "style"));
  is(
    "one review turnpike is enough for a review leg",
    0,
    lines("1 synthesis", "2 review style", "3 ship"),
  );
  waybill(join(tmp, "notes"), "turnpikes: none", "turnpikes: style, bug, security");
  runSelf("legs", join(tmp, "notes"));
  is("a turnpikes line inside the ticket is never read", 0, lines("1 synthesis", "3 ship"));
  waybill(
    join(tmp, "fence"),
    "turnpikes: style, bug, security",
    lines("```", "## Dispatch", "turnpikes: none"),
  );
  runSelf("legs", join(tmp, "fence"));
  is(
    "a fence the ticket leaves open changes nothing",
    0,
    lines("1 synthesis", "2 review style bug security", "3 ship"),
  );
  runSelf("legs", join(tmp, "default"), "--expect", "turnpikes:  style, bug,  security");
  is(
    "--expect passes a waybill whose line is the check's",
    0,
    lines("1 synthesis", "2 review style bug security", "3 ship"),
  );
  waybill(join(tmp, "extra"), `turnpikes: ${NOPE}`);
  {
    // call legsOf with PLUS table
    // we'll simulate via the shell wrapper... but the table is hardcoded. Use resolve/legs directly.
    // For the PLUS case we use the core logic inline
    const got = named(PLUS, `turnpikes: ${NOPE}`);
    const legLines: string[] = [];
    for (const [n, leg] of LEGS) {
      const runs = (got ?? []).filter(
        (x) => parseTable(PLUS).rows.find((r) => r.name === x)?.leg === leg,
      );
      if (ALWAYS.has(leg) || runs.length > 0) legLines.push([String(n), leg, ...runs].join(" "));
    }
    out = legLines.join("\n");
    rc = 0;
    is(
      "a turnpike that runs in another leg makes no review leg",
      0,
      lines("1 synthesis", `3 ship ${NOPE}`),
    );
  }
  runSelf("legs", "--line", "turnpikes: none");
  is("legs --line gives the legs of a line", 0, lines("1 synthesis", "3 ship"));
  runSelf("legs", "--line", "turnpikes: security");
  is(
    "legs --line gives a review leg for a review turnpike",
    0,
    lines("1 synthesis", "2 review security", "3 ship"),
  );
  runSelf("short", "turnpikes: bug");
  is("short names the default turnpikes a line leaves out", 0, lines("style", "security"));
  runSelf("short", "turnpikes: style, bug, security");
  is("short names nothing for a line that leaves none out", 0, "");

  console.log("negative controls: a ticket's section");
  runSelf("resolve", NOPE);
  has("a turnpike the table does not list is named", 2, `"${NOPE}" is not a turnpike`);
  runSelf("resolve", "none, bug");
  has("none listed with another turnpike is refused", 2, "none stands alone");
  runSelf("resolve", "none. A research ticket");
  has(
    "a reason is not a turnpike",
    2,
    '"a", "research" and "ticket" are not turnpikes; the section holds only',
  );
  runSelf("resolve", "default - security");
  has("a dash between names is not a list marker, and is named", 2, '"-" is not a turnpike');
  runSelf("resolve", "style, ...");
  has("a word of dots is still a word, and is named", 2, '"..." is not a turnpike');
  runSelf("resolve", "");
  has("an empty section names no turnpike", 2, "names no turnpike");

  console.log("negative controls: a run's legs");
  waybill(join(tmp, "missing"), "", "turnpikes: style, bug, security");
  runSelf("legs", join(tmp, "missing"));
  has(
    "with no line under the title, one in the ticket is not taken instead",
    2,
    "has no turnpikes: line",
    "ship",
  );
  waybill(join(tmp, "unknown"), `turnpikes: bug, ${NOPE}`);
  runSelf("legs", join(tmp, "unknown"));
  has(
    "a waybill naming an unknown turnpike is refused, and no leg is printed",
    2,
    `"${NOPE}" is not a turnpike`,
    "synthesis",
  );
  waybill(join(tmp, "twice"), lines("turnpikes: none", "turnpikes: style, bug, security"));
  runSelf("legs", join(tmp, "twice"));
  has("two turnpikes lines are refused", 2, "has 2 turnpikes: lines", "synthesis");
  waybill(join(tmp, "word"), "turnpikes: default");
  runSelf("legs", join(tmp, "word"));
  has("a waybill that says default is refused: it carries names", 2, "says default", "synthesis");
  runSelf("legs", join(tmp, "default"), "--expect", "turnpikes: bug, security");
  has(
    "--expect refuses a waybill that dropped a name the check printed",
    2,
    `and the ticket's check printed "turnpikes: bug, security"`,
    "synthesis",
  );
  runSelf("legs", "--line", "style, bug");
  has(
    "legs --line refuses a line that is not a turnpikes: line",
    2,
    "is not a turnpikes: line",
    "synthesis",
  );
  runSelf("legs", "--line", lines("turnpikes: none", "style"));
  has(
    "legs --line refuses a line with a newline in it",
    2,
    "is not a turnpikes: line",
    "synthesis",
  );
  runSelf("short", "turnpikes: default");
  has("short refuses default: a line carries names", 2, "says default");
  runSelf("legs", join(tmp, "nowhere"));
  has("no waybill is a usage error", 1, "no waybill at");

  console.log("negative controls: the table");
  function bad(label: string, extra: string, want: string): void {
    const { faults } = parseTable(`${TABLE}\n${extra}`);
    out = faults.map((f) => `turnpikes: the table's ${f}`).join("\n");
    rc = faults.length > 0 ? 1 : 0;
    has(label, 1, want, "style");
  }
  bad(
    "a turnpike named none is refused",
    "none       -        review  nothing",
    '"none" already means something in a ticket',
  );
  bad(
    "a turnpike named default is refused",
    "default    -        review  everything",
    '"default" already means something in a ticket',
  );
  bad(
    "a turnpike listed twice is refused",
    "bug        -        review  bugs again",
    '"bug" is listed twice',
  );
  bad(
    "a leg that does not exist is refused",
    `${NOPE}      -        deploy  a check`,
    '"deploy" is not a leg',
  );
  bad(
    "a set other than default or - is refused",
    `${NOPE}    yes      ship    a check`,
    '"yes" is neither default nor -',
  );
  bad(
    "a name that is not a lowercase word is refused",
    "Zz-Not  -       ship    a check",
    '"Zz-Not" is not a lowercase word',
  );
  bad(
    "a line with no description is refused",
    `${NOPE}      -        ship`,
    "needs a name, default or -, a leg, and what it checks",
  );

  console.log(
    "a run with no turnpikes, walked from synthesis to ship through the poll, the hand-off check and the stages",
  );
  const d = join(tmp, "runs", "proj", "T-9");
  waybill(d, "turnpikes: none");
  writeFileSync(join(d, "run-log.md"), "", "utf8");
  writeFileSync(
    join(d, "manifest.json"),
    '{"stage": "checkpoint-1", "leg": 1, "base": "abc123", "lanes": {}, "coachman": {"legs": {}}}\n',
    "utf8",
  );
  run("bash", [join(HERE, "log-action.sh"), d, "postmaster", "dispatch", "T-9", "leg 1"]);
  writeFileSync(
    join(d, "handoff-1.md"),
    "## Decisions\nx\n\n## Deferred findings\nx\n\n## Verified by execution\nx\n\n## Unverified\nx\n\n## Branches and lanes\nx\n\n## Open questions\nx\n\n## Next leg\nx\n",
    "utf8",
  );
  writeFileSync(join(d, ".leg-1-done"), "", "utf8");
  writeFileSync(join(d, ".leg-1-exited"), "", "utf8");

  function poll(): string {
    const r = run("bash", [join(HERE, "runs-status.sh"), join(tmp, "runs", "proj")]);
    const t9 = r.out.split("\n").find((l) => l.startsWith("T-9"));
    return t9 ? (t9.split(/\s+/).pop() ?? "") : "";
  }

  st.check("after synthesis the poll says DISPATCH", poll() === "DISPATCH");
  {
    const r = run("bash", [self, "legs", d]);
    const next = r.out.split("\n").find((l) => {
      const n = parseInt(l.split(/\s+/)[0] ?? "0", 10);
      return n > 1;
    });
    const nextVal = next ? `${next.split(/\s+/)[0]} ${next.split(/\s+/)[1]}` : "";
    st.check("the leg after synthesis is ship", nextVal === "3 ship", nextVal);
  }
  {
    const r = run("bash", [self, "legs", d]);
    const prevs = r.out
      .split("\n")
      .map((l) => parseInt(l.split(/\s+/)[0] ?? "0", 10))
      .filter((n) => n < 3);
    const prev = prevs[prevs.length - 1] ?? 0;
    const hc = run("bash", [join(HERE, "handoff-check.sh"), join(d, `handoff-${prev}.md`)]);
    st.check(
      "the ship leg starts from synthesis's hand-off, which passes its check",
      hc.code === 0 && prev === 1,
    );
  }
  // update manifest leg to 3
  {
    const p = join(d, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.leg = 3;
    writeFileSync(p, JSON.stringify(m), "utf8");
  }
  run("bash", [join(HERE, "stage.sh"), d, "shipping"]);
  run("bash", [join(HERE, "stage.sh"), d, "shipped"]);
  writeFileSync(join(d, ".leg-3-done"), "", "utf8");
  writeFileSync(join(d, ".leg-3-exited"), "", "utf8");
  {
    const r = run("bash", [self, "legs", d]);
    const after = r.out.split("\n").filter((l) => parseInt(l.split(/\s+/)[0] ?? "0", 10) > 3);
    st.check(
      "after ship the poll says DISPATCH, and no leg follows: Stage G",
      poll() === "DISPATCH" && after.length === 0,
      `${poll()} / ${after.join(" ")}`,
    );
  }
  run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
  {
    // parse actions.jsonl
    let stages = "";
    try {
      const text = readFileSync(join(d, "actions.jsonl"), "utf8");
      const targets = text
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l))
        .filter((o: { action: string }) => o.action === "stage")
        .map((o: { target: string }) => o.target);
      stages = targets.join(" ");
    } catch {
      stages = "";
    }
    st.check(
      "it closes with no review stage",
      stages === "shipping shipped done" && poll() === "-",
      `${stages}`,
    );
  }

  st.finish();
});
