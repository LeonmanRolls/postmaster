import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const wrapper = join(here, "turnpikes.sh");
const table =
  "# name     set      leg     what it checks\nstyle      default  review  idiom, naming, abstraction and consistency with the project's own conventions\nbug        default  review  correctness, logic, and whether the tests are adequate\nsecurity   default  review  exploit paths through the project's risk surfaces";
const legs = [
  [1, "synthesis"],
  [2, "review"],
  [3, "ship"],
] as const;
type Row = { name: string; isDefault: boolean; leg: string; what: string };
type Result = { code: number; out: string; err: string };

function tableRows(text: string): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [];
  const errors: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const fields = line.trim().split(/\s+/, 4);
    if (fields.length < 4 || !/[^\W_]/u.test(fields[3]!)) {
      errors.push(`line ${index + 1} needs a name, default or -, a leg, and what it checks`);
      continue;
    }
    const [name, mark, leg, what] = fields as [string, string, string, string];
    if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`line ${index + 1}: "${name}" is not a lowercase word`);
    else if (name === "default" || name === "none")
      errors.push(`line ${index + 1}: "${name}" already means something in a ticket, so no turnpike is named it`);
    else if (rows.some((row) => row.name === name)) errors.push(`line ${index + 1}: "${name}" is listed twice`);
    if (mark !== "default" && mark !== "-") errors.push(`line ${index + 1}: "${mark}" is neither default nor -`);
    if (!legs.some(([, legName]) => legName === leg))
      errors.push(`line ${index + 1}: "${leg}" is not a leg; the legs are synthesis, review, ship`);
    rows.push({ name, isDefault: mark === "default", leg, what: what.trim() });
  }
  return { rows, errors };
}
function wordsOf(text: string): string[] {
  const words: string[] = [];
  for (let line of text.replace(/\p{Cf}/gu, "").split("\n")) {
    line = line.replace(/\r$/, "").replace(/\\+$/, "");
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) continue;
    const marker = line.match(/^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/);
    if (marker) line = line.slice(marker[0].length);
    for (const token of line.split(/[\s,;]+/)) {
      if (!token) continue;
      let word = token
        .replace(/^[\x60*_]+|[\x60*_]+$/g, "")
        .replace(/\.+$/, "")
        .replace(/^[\x60*_]+|[\x60*_]+$/g, "")
        .toLowerCase();
      if (!word) word = token;
      words.push(word);
    }
  }
  return words;
}
function resolveText(text: string, rows: Row[]): { names: string[] | null; errors: string[] } {
  const words = wordsOf(text);
  const names = rows.map((row) => row.name);
  const defaults = rows.filter((row) => row.isDefault).map((row) => row.name);
  const holds = `the section holds only default, none, or names from: ${names.join(", ") || "(no turnpikes)"}`;
  if (!words.length) return { names: null, errors: [`names no turnpike; ${holds}`] };
  const unknown = [...new Set(words.filter((word) => !names.includes(word) && word !== "default" && word !== "none"))];
  const errors: string[] = [];
  if (unknown.length) {
    const quoted = unknown.map((word) => `"${word}"`);
    const which = quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
    errors.push(`${which + (unknown.length === 1 ? " is not a turnpike" : " are not turnpikes")}; ${holds}`);
  }
  if (words.includes("none") && new Set(words).size > 1)
    errors.push("none stands alone, and is not listed with other turnpikes");
  if (errors.length) return { names: null, errors };
  const chosen = new Set(words);
  if (chosen.has("default")) for (const name of defaults) chosen.add(name);
  return { names: names.filter((name) => chosen.has(name)), errors: [] };
}
function named(line: string, rows: Row[]): { names: string[] | null; error?: string } {
  if (line.includes("\n") || !/^[ \t]*turnpikes[ \t]*:/.test(line))
    return { names: null, error: `"${line.replace(/\n/g, "\\n")}" is not a turnpikes: line` };
  const value = line.replace(/^[ \t]*turnpikes[ \t]*:/, "");
  if (wordsOf(value).includes("default"))
    return {
      names: null,
      error: "the waybill's turnpikes line says default; it carries the names ticket-check.sh printed for the ticket",
    };
  const result = resolveText(value, rows);
  if (result.errors.length)
    return { names: null, error: result.errors.map((item) => `the waybill's turnpikes: ${item}`).join("\n") };
  return { names: result.names };
}
function legsForLine(line: string, rows: Row[]): Result {
  const parsed = named(line, rows);
  if (parsed.error) return { code: 2, out: `${parsed.error}\n`, err: "" };
  const map = new Map(rows.map((row) => [row.name, row.leg]));
  const output: string[] = [];
  for (const [number, leg] of legs) {
    const checks = parsed.names!.filter((name) => map.get(name) === leg);
    if (leg !== "review" || checks.length) output.push([number, leg, ...checks].join(" "));
  }
  return { code: 0, out: `${output.join("\n")}\n`, err: "" };
}
function core(tableText: string, cmd: string, args: string[], input = ""): Result {
  const parsed = tableRows(tableText);
  if (parsed.errors.length)
    return { code: 1, out: "", err: `${parsed.errors.map((error) => `turnpikes: the table's ${error}`).join("\n")}\n` };
  const rows = parsed.rows;
  if (cmd === "list")
    return {
      code: 0,
      out: `${rows.map((row) => row.name.padEnd(10) + (row.isDefault ? "default" : "-").padEnd(8) + row.leg.padEnd(9) + row.what).join("\n")}\n`,
      err: "",
    };
  if (cmd === "resolve") {
    const result = resolveText(args.length ? args.join(" ") : input, rows);
    return result.errors.length
      ? { code: 2, out: `${result.errors.join("\n")}\n`, err: "" }
      : { code: 0, out: `turnpikes: ${result.names!.join(", ") || "none"}\n`, err: "" };
  }
  if (cmd === "short" && args.length === 1) {
    const result = named(args[0]!, rows);
    if (result.error) return { code: 2, out: `${result.error}\n`, err: "" };
    const included = new Set(result.names);
    const output = rows.filter((row) => row.isDefault && !included.has(row.name)).map((row) => row.name);
    return { code: 0, out: output.length ? `${output.join("\n")}\n` : "", err: "" };
  }
  if (cmd === "legs" && args[0] === "--line" && args.length === 2) return legsForLine(args[1]!, rows);
  if (cmd === "legs" && (args.length === 1 || args.length === 2)) {
    let text: string;
    try {
      text = readFileSync(args[0]!, "utf8");
    } catch (error) {
      return { code: 1, out: "", err: `turnpikes: cannot read ${args[0]}: ${String(error).replace(/^Error: /, "")}\n` };
    }
    const lines = text.split("\n");
    const titleEnd = lines.findIndex((line) => line.startsWith("## "));
    const above = lines.slice(0, titleEnd < 0 ? lines.length : titleEnd).map((line) => line.replace(/\r$/, ""));
    const found = above.filter((line) => /^[ \t]*turnpikes[ \t]*:/.test(line));
    if (found.length !== 1)
      return {
        code: 2,
        out: `the waybill has ${found.length || "no"} turnpikes: line${found.length === 1 ? "" : "s"} under its title, above the ticket, and one is needed; none is never assumed\n`,
        err: "",
      };
    if (args.length === 2 && found[0]!.trim().replace(/\s+/g, " ") !== args[1]!.trim().replace(/\s+/g, " ")) {
      return {
        code: 2,
        out: `the waybill says "${found[0]!.trim()}", and the ticket's check printed "${args[1]!.trim()}"\n`,
        err: "",
      };
    }
    return legsForLine(found[0]!, rows);
  }
  return {
    code: 1,
    out: "",
    err: "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test\n",
  };
}
function emit(result: Result): number {
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err);
  return result.code;
}
function usage(): never {
  writeError(
    "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | short <line> | --self-test",
  );
  process.exit(1);
}
function run(args: string[]): number {
  const [cmd, ...rest] = args;
  if (cmd === "--list" && !rest.length) return emit(core(table, "list", []));
  if (cmd === "resolve") return emit(core(table, "resolve", rest, readFileSync(0, "utf8")));
  if (cmd === "short" && rest.length === 1) return emit(core(table, "short", rest));
  if (cmd === "legs" && rest[0] === "--line" && rest.length === 2) return emit(core(table, "legs", rest));
  if (cmd === "legs" && (rest.length === 1 || (rest.length === 3 && rest[1] === "--expect"))) {
    const brief = join(rest[0]!, "brief.md");
    if (!existsSync(brief)) {
      writeError(`turnpikes: no waybill at ${brief}`);
      return 1;
    }
    return emit(core(table, "legs", [brief, ...(rest.length === 3 ? [rest[2]!] : [])]));
  }
  if (cmd === "--self-test" && rest.length === 0) return selfTest();
  return usage();
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-turnpikes-");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, details = "") => {
    writeOut(`  FAIL ${label}`);
    if (details) for (const line of details.split("\n")) writeOut(`         ${line}`);
    failures++;
  };
  const expect = (label: string, code: number, output: string, args: string[], input?: string) => {
    const r = command(wrapper, args, { input });
    if (r.code === code && r.stdout.replace(/\n+$/, "") === output) ok(label);
    else fail(`${label}: wanted exit ${code}, got ${r.code}`, r.stdout + r.stderr);
  };
  const has = (label: string, code: number, contains: string, notContains: string, args: string[]) => {
    const r = command(wrapper, args);
    const output = r.stdout + r.stderr;
    if (r.code === code && output.includes(contains) && (!notContains || !output.includes(notContains))) ok(label);
    else fail(`${label}: wanted exit ${code} with ${contains}`, r.stdout + r.stderr);
  };
  const waybill = (dispatch: string, line: string, note = "") => {
    command("mkdir", ["-p", dispatch]);
    const actual = line ? `${line}\n` : "";
    writeFileSync(
      join(dispatch, "brief.md"),
      `# Waybill: T-1\n${actual}\n## Ticket\n## Problem / feature\nA change.\n\n## Turnpikes\ndefault\n\n## Notes\n${note}\n\n## Project profile\nrepo: /r\n\n## Dispatch\nname: #1, A change\ndispatch: ${dispatch}\ntool: /t\n`,
    );
  };
  try {
    const unknown = "zz-not-listed";
    writeOut("positive controls: the list");
    const list = command(wrapper, ["--list"]);
    if (
      list.code === 0 &&
      ["style", "bug", "security"].every(
        (name) => list.stdout.split("\n").filter((line) => line.startsWith(`${name} `)).length === 1,
      )
    )
      ok("--list names style, bug and security, once each");
    else fail("--list names style, bug and security, once each", list.stdout);
    if (
      list.stdout
        .split("\n")
        .filter((line) => line.split(/\s+/)[1] === "default")
        .map((line) => line.split(/\s+/)[0])
        .join(" ") === "style bug security"
    )
      ok("the default set is style, bug and security");
    else fail("the default set is style, bug and security", list.stdout);
    if (
      list.stdout
        .split("\n")
        .filter((line) => /^(style|bug|security)\s/.test(line))
        .every((line) => line.split(/\s+/)[2] === "review")
    )
      ok("the three run in the review leg");
    else fail("the three run in the review leg", list.stdout);
    writeOut("positive controls: a ticket's section");
    expect("default stands for the default set", 0, "turnpikes: style, bug, security", ["resolve", "default"]);
    expect("none stands for no turnpike", 0, "turnpikes: none", ["resolve", "none"]);
    expect("a list names its turnpikes, in the table's order", 0, "turnpikes: bug, security", [
      "resolve",
      "security, bug",
    ]);
    expect("in a list, default still stands for the three", 0, "turnpikes: style, bug, security", [
      "resolve",
      "default, bug",
    ]);
    const tick = String.fromCharCode(96);
    expect("case, backticks, list markers and a closing full stop are ignored", 0, "turnpikes: bug, security", [
      "resolve",
      `- Bug\n- ${tick}security${tick}.`,
    ]);
    expect("a thematic break is not a name", 0, "turnpikes: style, bug, security", [
      "resolve",
      "default\n\n---\n\n***",
    ]);
    expect("a hard line break is not part of a name", 0, "turnpikes: bug, security", ["resolve", "bug\\\nsecurity"]);
    expect("an invisible character is not part of a name", 0, "turnpikes: style, bug, security", [
      "resolve",
      "default\u200b",
    ]);
    expect(
      "with no text given, the section is read from stdin",
      0,
      "turnpikes: bug, security",
      ["resolve"],
      "1. bug\n2. security",
    );
    expect("the waybill's line resolves to itself", 0, "turnpikes: style, bug, security", [
      "resolve",
      "style, bug, security",
    ]);
    const added = `${table}\n${unknown}  -        ship    a check the table does not have yet`;
    const extra = core(added, "resolve", [`default, ${unknown}`]);
    if (extra.code === 0 && extra.out.trim() === `turnpikes: style, bug, security, ${unknown}`)
      ok("a turnpike added to the table resolves with nothing else changed");
    else fail("a turnpike added to the table resolves with nothing else changed", extra.out + extra.err);
    writeOut("positive controls: a run's legs");
    waybill(join(tmp, "none"), "turnpikes: none");
    expect("a run with no turnpikes goes from synthesis to ship", 0, "1 synthesis\n3 ship", [
      "legs",
      join(tmp, "none"),
    ]);
    waybill(join(tmp, "default"), "turnpikes: style, bug, security");
    expect(
      "a run with the default turnpikes has a review leg that runs all three",
      0,
      "1 synthesis\n2 review style bug security\n3 ship",
      ["legs", join(tmp, "default")],
    );
    waybill(join(tmp, "style"), "turnpikes: style");
    expect("one review turnpike is enough for a review leg", 0, "1 synthesis\n2 review style\n3 ship", [
      "legs",
      join(tmp, "style"),
    ]);
    waybill(join(tmp, "notes"), "turnpikes: none", "turnpikes: style, bug, security");
    expect("a turnpikes line inside the ticket is never read", 0, "1 synthesis\n3 ship", ["legs", join(tmp, "notes")]);
    const fence = tick.repeat(3);
    waybill(join(tmp, "fence"), "turnpikes: style, bug, security", `${fence}\n## Dispatch\nturnpikes: none`);
    expect("a fence the ticket leaves open changes nothing", 0, "1 synthesis\n2 review style bug security\n3 ship", [
      "legs",
      join(tmp, "fence"),
    ]);
    expect(
      "--expect passes a waybill whose line is the check's",
      0,
      "1 synthesis\n2 review style bug security\n3 ship",
      ["legs", join(tmp, "default"), "--expect", "turnpikes:  style, bug,  security"],
    );
    waybill(join(tmp, "extra"), `turnpikes: ${unknown}`);
    const extraLegs = core(added, "legs", [join(tmp, "extra/brief.md")]);
    if (extraLegs.code === 0 && extraLegs.out.trim() === `1 synthesis\n3 ship ${unknown}`)
      ok("a turnpike that runs in another leg makes no review leg");
    else fail("a turnpike that runs in another leg makes no review leg", extraLegs.out);
    expect("legs --line gives the legs of a line", 0, "1 synthesis\n3 ship", ["legs", "--line", "turnpikes: none"]);
    expect("legs --line gives a review leg for a review turnpike", 0, "1 synthesis\n2 review security\n3 ship", [
      "legs",
      "--line",
      "turnpikes: security",
    ]);
    expect("short names the default turnpikes a line leaves out", 0, "style\nsecurity", ["short", "turnpikes: bug"]);
    expect("short names nothing for a line that leaves none out", 0, "", ["short", "turnpikes: style, bug, security"]);
    writeOut("negative controls: a ticket's section");
    has("a turnpike the table does not list is named", 2, `"${unknown}" is not a turnpike`, "", ["resolve", unknown]);
    has("none listed with another turnpike is refused", 2, "none stands alone", "", ["resolve", "none, bug"]);
    has("a reason is not a turnpike", 2, '"a", "research" and "ticket" are not turnpikes; the section holds only', "", [
      "resolve",
      "none. A research ticket",
    ]);
    has("a dash between names is not a list marker, and is named", 2, '"-" is not a turnpike', "", [
      "resolve",
      "default - security",
    ]);
    has("a word of dots is still a word, and is named", 2, '"..." is not a turnpike', "", ["resolve", "style, ..."]);
    has("an empty section names no turnpike", 2, "names no turnpike", "", ["resolve", ""]);
    writeOut("negative controls: a run's legs");
    waybill(join(tmp, "missing"), "", "turnpikes: style, bug, security");
    has("with no line under the title, one in the ticket is not taken instead", 2, "has no turnpikes: line", "ship", [
      "legs",
      join(tmp, "missing"),
    ]);
    waybill(join(tmp, "unknown"), `turnpikes: bug, ${unknown}`);
    has(
      "a waybill naming an unknown turnpike is refused, and no leg is printed",
      2,
      `"${unknown}" is not a turnpike`,
      "synthesis",
      ["legs", join(tmp, "unknown")],
    );
    waybill(join(tmp, "twice"), "turnpikes: none\nturnpikes: style, bug, security");
    has("two turnpikes lines are refused", 2, "has 2 turnpikes: lines", "synthesis", ["legs", join(tmp, "twice")]);
    waybill(join(tmp, "word"), "turnpikes: default");
    has("a waybill that says default is refused: it carries names", 2, "says default", "synthesis", [
      "legs",
      join(tmp, "word"),
    ]);
    has("--expect refuses a waybill that dropped a name the check printed", 2, "ticket's check printed", "synthesis", [
      "legs",
      join(tmp, "default"),
      "--expect",
      "turnpikes: bug, security",
    ]);
    has("legs --line refuses a line that is not a turnpikes: line", 2, "is not a turnpikes: line", "synthesis", [
      "legs",
      "--line",
      "style, bug",
    ]);
    has("legs --line refuses a line with a newline in it", 2, "is not a turnpikes: line", "synthesis", [
      "legs",
      "--line",
      "turnpikes: none\nstyle",
    ]);
    has("short refuses default: a line carries names", 2, "says default", "", ["short", "turnpikes: default"]);
    has("no waybill is a usage error", 1, "no waybill at", "", ["legs", join(tmp, "nowhere")]);
    writeOut("negative controls: the table");
    const badTables: [string, string, string][] = [
      [
        "a turnpike named none is refused",
        "none       -        review  nothing",
        '"none" already means something in a ticket',
      ],
      [
        "a turnpike named default is refused",
        "default    -        review  everything",
        '"default" already means something in a ticket',
      ],
      ["a turnpike listed twice is refused", "bug        -        review  bugs again", '"bug" is listed twice'],
      ["a leg that does not exist is refused", `${unknown}      -        deploy  a check`, '"deploy" is not a leg'],
      [
        "a set other than default or - is refused",
        `${unknown}    yes      ship    a check`,
        '"yes" is neither default nor -',
      ],
      [
        "a name that is not a lowercase word is refused",
        "Zz-Not  -       ship    a check",
        '"Zz-Not" is not a lowercase word',
      ],
      [
        "a line with no description is refused",
        `${unknown}      -        ship`,
        "needs a name, default or -, a leg, and what it checks",
      ],
    ];
    for (const [label, addition, contains] of badTables) {
      const result = core(`${table}\n${addition}`, "list", []);
      if (result.code === 1 && result.err.includes(contains) && !result.err.includes("style")) ok(label);
      else fail(label, result.err);
    }
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
process.exit(run(process.argv.slice(2)));
