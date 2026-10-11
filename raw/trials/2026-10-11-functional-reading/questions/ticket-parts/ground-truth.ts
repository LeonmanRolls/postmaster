// Ground truth for the ticket-parts reading test.
//
//   bun --no-env-file --config=/dev/null <this file> <path to a copy of scripts/ticket-parts.ts>
//
// Prints one JSON object, question id to answer, in the order of spec.json (which sits beside this
// file; a copy of it is embedded at the bottom of this file and used when it is not there). Every
// answer comes from running the module: either its exported functions, loaded in a
// child process so that a hang or a crash cannot take this process down, or the module itself run as
// a command (`ticket-parts <file> [args]`). A `change` question first copies the module to a
// temporary file beside it, replaces the value of the one constant it names (written
// `const NAME = <literal>;` on one line, with or without `export`), runs, and deletes that file.
//
// A computation that fails or does not finish gives the string "ERROR: <reason>" for that question
// only. No answer depends on the clock, the environment or any file but spec.json, the module and
// the temporary input files this script writes and removes.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUN = process.execPath;
const BUN_FLAGS = ["--no-env-file", "--config=/dev/null"];
const SELF = import.meta.path;
const TIMEOUT_MS = 20000;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface Finding {
  line: number;
  kind: string;
  text: string;
}
interface Report {
  findings: Finding[];
  notes: string[];
}
interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Extract {
  // what to read: from a report ("findings" or "notes"), from a command run ("status", "stdout",
  // "stderr"), the raw value, or a tuple of further extracts applied to the same result
  of?: "findings" | "notes" | "status" | "stdout" | "stderr" | "value" | "null_or_count";
  tuple?: Extract[];
  kind?: string | string[]; // findings: keep these kinds
  line?: number; // findings: keep this line
  prefix?: string; // notes: keep those starting with this
  // findings: kind | line | text | "kind: text" | "line:kind" | "len:last3" | "line:len:last3" |
  // "line:kind:len:last3" | formatted ("line N: kind: text")
  map?: string;
  capture?: string; // regular expression with one group, applied to each item; misses are dropped
  int?: boolean; // with capture: the captured text is turned into an integer
  as?: "list" | "count" | "first"; // shape of the answer (default list; first: "none" if empty)
}

interface Spec {
  type?: string;
  run: "analyze" | "countSentences" | "cli" | "export" | "fixed" | "tuple";
  text?: string;
  lines?: string[];
  final?: boolean;
  file?: string; // cli: the name of the input file written before the run (omitted: none is written)
  args?: string[]; // cli: the command-line arguments
  name?: string; // export: the exported name
  value?: Json; // fixed: the answer
  parts?: Spec[]; // tuple: the answer is the array of the answers of these, run on the same module
  change?: { constant: string; value: Json; literal: string };
  extract?: Extract;
}

// --- the pure part: reading an answer out of a result -----------------------------------------
function inputText(spec: Spec): string {
  if (spec.text !== undefined) return spec.text;
  if (spec.lines !== undefined) return spec.lines.join("\n");
  throw new Error("spec has neither text nor lines");
}

function mapFinding(f: Finding, how: string | undefined): string | number {
  switch (how ?? "formatted") {
    case "kind":
      return f.kind;
    case "line":
      return f.line;
    case "text":
      return f.text;
    case "kind: text":
      return `${f.kind}: ${f.text}`;
    case "line:kind":
      return `${f.line}:${f.kind}`;
    case "len:last3":
      return `${Array.from(f.text).length}:${Array.from(f.text).slice(-3).join("")}`;
    case "line:len:last3":
      return `${f.line}:${Array.from(f.text).length}:${Array.from(f.text).slice(-3).join("")}`;
    case "line:kind:len:last3":
      return `${f.line}:${f.kind}:${Array.from(f.text).length}:${Array.from(f.text).slice(-3).join("")}`;
    case "formatted":
      return `line ${f.line}: ${f.kind}: ${f.text}`;
    default:
      throw new Error(`unknown map ${how}`);
  }
}

function shape(items: Json[], as: Extract["as"]): Json {
  switch (as ?? "list") {
    case "count":
      return items.length;
    case "first":
      return items.length > 0 ? items[0]! : "none";
    case "list":
      return items;
    default:
      throw new Error(`unknown shape ${as}`);
  }
}

function capture(items: string[], re: string | undefined, int: boolean | undefined): Json[] {
  if (re === undefined) return items;
  const rx = new RegExp(re, "u");
  const out: Json[] = [];
  for (const s of items) {
    const m = rx.exec(s);
    if (m && m[1] !== undefined) out.push(int ? Number(m[1]) : m[1]);
  }
  return out;
}

function extract(raw: unknown, x: Extract): Json {
  if (x.tuple) return x.tuple.map((t) => extract(raw, t));
  const of = x.of ?? "value";
  if (of === "value") return raw as Json;
  if (of === "null_or_count") {
    const rep = raw as Report | null;
    return rep === null ? -1 : rep.findings.length;
  }
  if (of === "findings" || of === "notes") {
    const rep = raw as Report | null;
    if (rep === null) throw new Error("the report is null");
    if (of === "notes") {
      let notes = rep.notes;
      if (x.prefix !== undefined) notes = notes.filter((n) => n.startsWith(x.prefix!));
      return shape(capture(notes, x.capture, x.int), x.as);
    }
    let fs = rep.findings;
    if (x.kind !== undefined) {
      const kinds = Array.isArray(x.kind) ? x.kind : [x.kind];
      fs = fs.filter((f) => kinds.includes(f.kind));
    }
    if (x.line !== undefined) fs = fs.filter((f) => f.line === x.line);
    const mapped = fs.map((f) => mapFinding(f, x.map));
    const items =
      x.capture === undefined ? mapped : capture(mapped.map(String), x.capture, x.int);
    return shape(items as Json[], x.as);
  }
  const cli = raw as CliResult;
  if (of === "status") return cli.status;
  if (of === "stdout" || of === "stderr") {
    const text = of === "stdout" ? cli.stdout : cli.stderr;
    const lines = text.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    // stderr with no shape asked for is its text without the final line feed
    if (of === "stderr" && x.as === undefined && x.capture === undefined) return lines.join("\n");
    return shape(capture(lines, x.capture, x.int), x.as);
  }
  throw new Error(`unknown extract ${of}`);
}

// --- the edge: running the module -------------------------------------------------------------
function child(modulePath: string, payload: Json): unknown {
  const r = spawnSync(BUN, [...BUN_FLAGS, SELF, "--call", modulePath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 1 << 24,
  });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    throw new Error(code === "ETIMEDOUT" ? "timeout" : String(r.error.message).split("\n")[0]);
  }
  if (r.status !== 0) {
    const errLines = String(r.stderr).trim().split("\n");
    const first = errLines.find((l) => /^(\w*Error|error)\b/u.test(l)) ?? errLines[0] ?? "";
    throw new Error(`call failed: ${first.slice(0, 120)}`);
  }
  const outLines = String(r.stdout).trim().split("\n");
  const parsed = JSON.parse(outLines[outLines.length - 1]!) as { ok: unknown };
  return parsed.ok;
}

function runCli(modulePath: string, spec: Spec): CliResult {
  const dir = mkdtempSync(join(tmpdir(), "ticket-parts-gt-"));
  const written: string[] = [];
  try {
    if (spec.file !== undefined) {
      const p = join(dir, spec.file);
      writeFileSync(p, inputText(spec));
      written.push(p);
    }
    const r = spawnSync(BUN, [...BUN_FLAGS, modulePath, ...(spec.args ?? [])], {
      cwd: dir,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 1 << 24,
    });
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      throw new Error(code === "ETIMEDOUT" ? "timeout" : String(r.error.message).split("\n")[0]);
    }
    return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
  } finally {
    // best effort: a failed clean-up must not hide the answer
    for (const p of written) {
      try {
        unlinkSync(p);
      } catch {
        // already gone
      }
    }
    try {
      rmdirSync(dir);
    } catch {
      // not empty or already gone
    }
  }
}

function runSpec(modulePath: string, spec: Spec): Json {
  if (spec.run === "fixed") return spec.value as Json;
  if (spec.run === "tuple") return (spec.parts ?? []).map((p) => runSpec(modulePath, p));
  let raw: unknown;
  switch (spec.run) {
    case "analyze":
      raw = child(modulePath, { op: "analyze", text: inputText(spec), final: spec.final === true });
      break;
    case "countSentences":
      raw = child(modulePath, { op: "countSentences", text: inputText(spec) });
      break;
    case "export":
      raw = child(modulePath, { op: "export", name: spec.name });
      break;
    case "cli":
      raw = runCli(modulePath, spec);
      break;
    default:
      throw new Error(`unknown run ${String(spec.run)}`);
  }
  return extract(raw, spec.extract ?? { of: "value" });
}

// A copy of the module beside it with one constant's value replaced; the copy is deleted after.
function withConstant<T>(
  modulePath: string,
  id: string,
  change: { constant: string; literal: string },
  use: (copy: string) => T,
): T {
  const src = readFileSync(modulePath, "utf8");
  // `const NAME = <literal>;` on one line, with or without `export`, and a comment may follow it
  const re = new RegExp(`^((?:export )?const ${change.constant} = ).*?;([ \\t]*//.*)?$`, "gmu");
  const found = src.match(re) ?? [];
  if (found.length !== 1) {
    throw new Error(`constant ${change.constant} is declared ${found.length} times`);
  }
  const out = src.replace(
    re,
    (_m, head: string, tail: string | undefined) => `${head}${change.literal};${tail ?? ""}`,
  );
  const base = basename(modulePath).replace(/\.ts$/u, "");
  const copy = join(dirname(modulePath), `${base}.gt-${process.pid}-${id}.ts`);
  writeFileSync(copy, out);
  try {
    return use(copy);
  } finally {
    try {
      unlinkSync(copy);
    } catch {
      // already gone
    }
  }
}

function answer(modulePath: string, id: string, spec: Spec): Json {
  try {
    if (spec.change) {
      return withConstant(modulePath, id, spec.change, (copy) => runSpec(copy, spec));
    }
    return runSpec(modulePath, spec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `ERROR: ${msg.split("\n")[0]!.slice(0, 120)}`;
  }
}

// --- entry ------------------------------------------------------------------------------------
async function callMode(modulePath: string): Promise<void> {
  const payload = JSON.parse(readFileSync(0, "utf8")) as {
    op: string;
    text?: string;
    final?: boolean;
    name?: string;
  };
  const mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  let ok: unknown;
  if (payload.op === "analyze") {
    ok = (mod.analyze as (t: string, f: boolean) => unknown)(payload.text!, payload.final === true);
  } else if (payload.op === "countSentences") {
    ok = (mod.countSentences as (t: string) => unknown)(payload.text!);
  } else if (payload.op === "export") {
    ok = mod[payload.name!];
  } else {
    throw new Error(`unknown op ${payload.op}`);
  }
  console.log(JSON.stringify({ ok: ok === undefined ? null : ok }));
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "--call") {
    await callMode(resolve(argv[1]!));
    return 0;
  }
  if (argv.length !== 1) {
    console.error("usage: ground-truth.ts <path to a copy of the module>");
    return 2;
  }
  const modulePath = resolve(argv[0]!);
  const beside = join(dirname(SELF), "spec.json");
  const specs = JSON.parse(existsSync(beside) ? readFileSync(beside, "utf8") : EMBEDDED_SPEC) as Record<
    string,
    Spec
  >;
  const out: Record<string, Json> = {};
  for (const [id, spec] of Object.entries(specs)) out[id] = answer(modulePath, id, spec);
  console.log(JSON.stringify(out));
  return 0;
}

// <<EMBEDDED SPEC (written by the script that builds this folder)
const EMBEDDED_SPEC = "{\n  \"q01\": {\n    \"type\": \"trace\",\n    \"call\": \"countSentences(text) in the module\",\n    \"run\": \"countSentences\",\n    \"text\": \"Ask the devs. Then see E.g. Apples, i.e. Pears (approx. 2.5 kg)! Read `a. B` at https://example.com/x.html. Done?`x`Yes. \",\n    \"extract\": {\n      \"of\": \"value\"\n    }\n  },\n  \"q02\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"Run reach.sh first.\",\n      \"```\",\n      \"Use scripts/x.sh in a block.\",\n      \"```\",\n      \"Then run --force twice.\",\n      \"  ```text\",\n      \"Example --verbose and a_b.\",\n      \"\",\n      \"## Acceptance criteria\",\n      \"- Run reach.md after.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"line:kind\"\n    }\n  },\n  \"q03\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"`scripts/run.ts`, then see line 12 and Line 4, not online 5 or line7, use --force#L5 or a--b.\",\n      \"An empty `` span, `y` and run().\",\n      \"A wide `x   y` span, then more.\",\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"kind: text\"\n    }\n  },\n  \"q04\": {\n    \"type\": \"change\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It reads the file.\",\n      \"2. It prints the findings.\",\n      \"3. It prints the notes.\",\n      \"4. A fixture run is dispatched from this branch.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C2** Run it.\",\n      \"- **C3** Run it.\",\n      \"- **C4** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3, C4)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"change\": {\n      \"constant\": \"MAX_CRITERIA\",\n      \"value\": 2,\n      \"literal\": \"2\"\n    },\n    \"extract\": {\n      \"of\": \"notes\",\n      \"prefix\": \"more\",\n      \"as\": \"list\"\n    }\n  },\n  \"q05\": {\n    \"type\": \"state\",\n    \"call\": \"the array of the answers of 3 runs, in order\",\n    \"run\": \"tuple\",\n    \"parts\": [\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts --final t.md --final\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"DRAFT: waiting for the user to sign it off.\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it.\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"--final\",\n          \"t.md\",\n          \"--final\"\n        ],\n        \"extract\": {\n          \"of\": \"status\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts --final t.md --final\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"DRAFT: waiting for the user to sign it off.\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it.\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"--final\",\n          \"t.md\",\n          \"--final\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"as\": \"count\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts --final t.md --final\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"DRAFT: waiting for the user to sign it off.\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it.\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"--final\",\n          \"t.md\",\n          \"--final\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"as\": \"first\"\n        }\n      }\n    ]\n  },\n  \"q06\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, true) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"DRAFT: this ticket is not signed off yet, so nobody should build from it as it is.\",\n      \"## Problem\",\n      \"`0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz` is a long span.\",\n      \"See https://github.com/o/r/blob/main/0123456789012345678901234567890123456789012345678901234567890123456789 now.\",\n      \"Open scripts/01234567890123456789012345678901234567890123456789012345678901234567890123456789 now.\",\n      \"Edit abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijklmnopq.ts now.\",\n      \"See https://github.com/o/r/pull/12#L4 and https://raw.githubusercontent.com/o/r/m/x, too.\",\n      \"Also https://github.com/o/r/tree/main/x and https://github.com/o/r/commit/abc1234 and https://github.com/o/r/issues/5.\",\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": true,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"line:kind:len:last3\"\n    }\n  },\n  \"q07\": {\n    \"type\": \"control-trivial\",\n    \"call\": \"the module's exported MAX_DECISION_WORDS\",\n    \"run\": \"export\",\n    \"name\": \"MAX_DECISION_WORDS\"\n  },\n  \"q08\": {\n    \"type\": \"state\",\n    \"call\": \"the array of the answers of 3 runs, in order\",\n    \"run\": \"tuple\",\n    \"parts\": [\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"\",\n          \"   \",\n          \"DRAFT: not signed off yet, so do not build from it.\",\n          \"# Title of the ticket\",\n          \"#hashtag counts as words\",\n          \"Mentions issue # 12 here.\",\n          \"Some\\ttabbed words\\there.\",\n          \"```\",\n          \"ignored words inside a fence\",\n          \"```\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works well.\",\n          \"\",\n          \"## Decisions\",\n          \"- **D1 (proposed)** First choice.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it. (D1)\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"status\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"\",\n          \"   \",\n          \"DRAFT: not signed off yet, so do not build from it.\",\n          \"# Title of the ticket\",\n          \"#hashtag counts as words\",\n          \"Mentions issue # 12 here.\",\n          \"Some\\ttabbed words\\there.\",\n          \"```\",\n          \"ignored words inside a fence\",\n          \"```\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works well.\",\n          \"\",\n          \"## Decisions\",\n          \"- **D1 (proposed)** First choice.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it. (D1)\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"as\": \"first\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"\",\n          \"   \",\n          \"DRAFT: not signed off yet, so do not build from it.\",\n          \"# Title of the ticket\",\n          \"#hashtag counts as words\",\n          \"Mentions issue # 12 here.\",\n          \"Some\\ttabbed words\\there.\",\n          \"```\",\n          \"ignored words inside a fence\",\n          \"```\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works well.\",\n          \"\",\n          \"## Decisions\",\n          \"- **D1 (proposed)** First choice.\",\n          \"## For the agents\",\n          \"### Checks\",\n          \"- **C1** Run it. (D1)\",\n          \"### Technical notes\",\n          \"- A note. (C1)\",\n          \"### Verified at 0123abc\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"capture\": \"^plain part: ([0-9]+) words$\",\n          \"int\": true,\n          \"as\": \"first\"\n        }\n      }\n    ]\n  },\n  \"q09\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"Names: Node.js, README.MD, App.jsx, v1.5, a.b.c.ts, dir/foo.ts, reach_me.ts.\",\n      \"Calls: run(), 1x(), x.y(), f (), run_all().\",\n      \"Idents: snake_case, snake_case_, _private_name, a__b, MAX_SAFE, x_1.\",\n      \"Paths: ./lib/z, my-docs/y, a/tmp/b, lib/ok, ~/n, (src/q), Scripts/x, lib/--dry-run.\",\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"text\"\n    }\n  },\n  \"q10\": {\n    \"type\": \"change\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It prints one line per finding.\",\n      \"2. It prints the notes after the findings.\",\n      \"3. It exits with status one.\",\n      \"4. It reads the file\",\n      \"   from the arguments.\",\n      \"5. It refuses a file that has no heading.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C2** Run it.\",\n      \"- **C3** Run it.\",\n      \"- **C4** Run it.\",\n      \"- **C5** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3, C4, C5)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"change\": {\n      \"constant\": \"MAX_CRITERION_WORDS\",\n      \"value\": 6,\n      \"literal\": \"6\"\n    },\n    \"extract\": {\n      \"of\": \"notes\",\n      \"capture\": \"^(criterion [0-9]+ \\\\(line [0-9]+\\\\): [0-9]+ words, [0-9]+ sentences): may be more than one idea$\",\n      \"as\": \"list\"\n    }\n  },\n  \"q11\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. One.\",\n      \"2. Two.\",\n      \"## Decisions\",\n      \"- **D1 (proposed)** First.\",\n      \"- **D2 (proposed)** Second.\",\n      \"- **D1 (given by the user)** First again.\",\n      \"```\",\n      \"- **D3 (proposed)** In a fence.\",\n      \"```\",\n      \"## Out of scope\",\n      \"1. Nothing else.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C2** Two. (D3)\",\n      \"- **C1** One. (D2)\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"kind\": [\n        \"decision\",\n        \"check\"\n      ],\n      \"map\": \"kind: text\"\n    }\n  },\n  \"q12\": {\n    \"type\": \"trace\",\n    \"call\": \"the array of the answers of 3 runs, in order\",\n    \"run\": \"tuple\",\n    \"parts\": [\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"##For the agents\",\n          \"### For the agents\",\n          \"## For the agents:\",\n          \"## For the  agents\",\n          \" ## For the agents\",\n          \"Some words here.\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"\",\n          \"### Checks\",\n          \"- **C1** Run it.\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"status\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"##For the agents\",\n          \"### For the agents\",\n          \"## For the agents:\",\n          \"## For the  agents\",\n          \" ## For the agents\",\n          \"Some words here.\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"\",\n          \"### Checks\",\n          \"- **C1** Run it.\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"as\": \"count\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"lines\": [\n          \"##For the agents\",\n          \"### For the agents\",\n          \"## For the agents:\",\n          \"## For the  agents\",\n          \" ## For the agents\",\n          \"Some words here.\",\n          \"\",\n          \"## Acceptance criteria\",\n          \"1. It works.\",\n          \"\",\n          \"### Checks\",\n          \"- **C1** Run it.\"\n        ],\n        \"args\": [\n          \"t.md\"\n        ],\n        \"extract\": {\n          \"of\": \"stderr\",\n          \"as\": \"count\"\n        }\n      }\n    ]\n  },\n  \"q13\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## Decisions\",\n      \"- **D1 (proposed):** First.\",\n      \"- **D2 (given by the user)**  Second.\",\n      \"- **D3 (Proposed)** Third.\",\n      \"- **D4(proposed)** Fourth.\",\n      \"* **D5** Fifth.\",\n      \"-**D6** Sixth, with no space after the dash.\",\n      \"Compare - **D7** with the other route.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it. (D1, D2, D3, D4, D5)\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"kind\": \"mark\",\n      \"map\": \"text\",\n      \"capture\": \"has the mark (.*?); use\"\n    }\n  },\n  \"q14\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"Refer to ## Acceptance criteria\",\n      \"##Acceptance criteria\",\n      \"## Acceptance criteria (draft)\",\n      \"## Acceptance criteria\",\n      \"1. One.\",\n      \"2. Two.\",\n      \"3. Three.\",\n      \"## Out of scope\",\n      \"1. Nothing else.\",\n      \"## FOR THE AGENTS  \",\n      \"### Checks\",\n      \"- **C1** One.\",\n      \"```\",\n      \"- **C2** inside a fence\",\n      \"```\",\n      \"- **C2** Two.\",\n      \"- **C2** Two again.\",\n      \"- **C3** Three.\",\n      \"  - **C9** an indented sub-item.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"tuple\": [\n        {\n          \"of\": \"findings\",\n          \"kind\": \"check\",\n          \"map\": \"formatted\"\n        },\n        {\n          \"of\": \"notes\",\n          \"prefix\": \"criteria \",\n          \"as\": \"first\"\n        }\n      ]\n    }\n  },\n  \"q15\": {\n    \"type\": \"change\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Problem\",\n      \"Use `merge_authority` for it.\",\n      \"Or use ~other_one~ for it.\",\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C0** Zero.\",\n      \"- An item with no label.\",\n      \"### Technical notes\",\n      \"- A note about `(C9)` in code. (C1)\",\n      \"- A note about ~(C8)~ in tildes. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"change\": {\n      \"constant\": \"TICK\",\n      \"value\": \"~\",\n      \"literal\": \"\\\"~\\\"\"\n    },\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"line:kind\"\n    }\n  },\n  \"q16\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"#### Technical notes\",\n      \"- A note. (C1)\",\n      \"## Other\",\n      \"### Verified at 0123abc (main)\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"map\": \"line:kind\"\n    }\n  },\n  \"q17\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. The tool prints the findings first, one on each line,\",\n      \"*Both* are printed in order, so that a person can read them\",\n      \"2.5 seconds is the usual time for it, and then the notes follow on the next line.\",\n      \"   - a detail line with a few more words in it, as in step 7. which is long\",\n      \"   and one more line, as long as the ## Decisions part below, to make it longer still.\",\n      \"2. The tool prints each finding on its own line, then prints the notes after them, and finally exits with a status that tells a person whether the ticket is fit.\",\n      \"3. The tool reads the file named in section 4. of the guide, prints each finding on its own line, then exits with a status that tells a person if it fits.\",\n      \"5. Two short. One short.\",\n      \"- Alpha. Beta. Gamma.\",\n      \"6. Three short. Two short. One short\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C2** Run it.\",\n      \"- **C3** Run it.\",\n      \"- **C4** Run it.\",\n      \"- **C5** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3, C4, C5)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"notes\",\n      \"capture\": \"^(criterion [^ ]+|more than five criteria: [0-9]+)\",\n      \"as\": \"list\"\n    }\n  },\n  \"q18\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. One.\",\n      \"2. Two.\",\n      \"3. Three.\",\n      \"## For the agents\",\n      \"### Run the checks\",\n      \"- **C1** One.\",\n      \"### Checks (draft)\",\n      \"- **C3** Three.\",\n      \"### Checks\",\n      \"2. **C2** Two.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"findings\",\n      \"kind\": \"check\",\n      \"map\": \"formatted\"\n    }\n  },\n  \"q19\": {\n    \"type\": \"change\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It lists E.g. Apples, i.e. Pears, etc. Then ask the devs. Then it stops.\",\n      \"2. See https://example.com/a.b for more. Done.\",\n      \"3. Is it done? Yes (really).\",\n      \"4. It reads `a. B` only\",\n      \"5. It takes 2.5 s. Then it stops\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C2** Run it.\",\n      \"- **C3** Run it.\",\n      \"- **C4** Run it.\",\n      \"- **C5** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3, C4, C5)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"change\": {\n      \"constant\": \"MAX_CRITERION_SENTENCES\",\n      \"value\": 1,\n      \"literal\": \"1\"\n    },\n    \"extract\": {\n      \"of\": \"notes\",\n      \"capture\": \"^(criterion [^ ]+|more than five criteria: [0-9]+)\",\n      \"as\": \"list\"\n    }\n  },\n  \"q20\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. One.\",\n      \"## Decisions\",\n      \"- **D1 (proposed)** First.\",\n      \"- **D2 (proposed)** Second.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** One.\",\n      \"- **C3** Three.\",\n      \"- **C2** Two.\",\n      \"### Technical notes\",\n      \"- First note has (c1), (C) and (D 2) but no tag.\",\n      \"- Second note `` then (C1) and `x`.\",\n      \"- Third note, written like `(C1)` in code.\",\n      \"- Fourth note, over two lines\",\n      \"*and* cited on the second - at last. (D1)\",\n      \"- Fifth note, with `x`(C1)`y` between spans\",\n      \"(D2) on a line of its own at column zero.\",\n      \"* Sixth note cites (D7) and (C0).\",\n      \"- Seventh note ` (C1) with a lone tick.\",\n      \"- Eighth note:\",\n      \"```\",\n      \"(C1)\",\n      \"```\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"tuple\": [\n        {\n          \"of\": \"findings\",\n          \"map\": \"line:kind\"\n        },\n        {\n          \"of\": \"notes\",\n          \"prefix\": \"criteria \",\n          \"as\": \"first\"\n        }\n      ]\n    }\n  },\n  \"q21\": {\n    \"type\": \"trace\",\n    \"call\": \"the array of the answers of 2 runs, in order\",\n    \"run\": \"tuple\",\n    \"parts\": [\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md --final\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"text\": \"\\ufeff DRAFT: not signed off.\\r\\n## Acceptance criteria\\r\\n1. It works.\\r\\n## For the agents\\r\\n### Checks\\r\\n- **C1** Run it.\\r\\n### Technical notes\\r\\n- A note. (C1)\\r\\n### Verified at 0123abc\",\n        \"args\": [\n          \"t.md\",\n          \"--final\"\n        ],\n        \"extract\": {\n          \"of\": \"status\"\n        }\n      },\n      {\n        \"call\": \"file t.md holds the input; the module run as a command: ticket-parts t.md --final\",\n        \"run\": \"cli\",\n        \"file\": \"t.md\",\n        \"text\": \"\\ufeff DRAFT: not signed off.\\r\\n## Acceptance criteria\\r\\n1. It works.\\r\\n## For the agents\\r\\n### Checks\\r\\n- **C1** Run it.\\r\\n### Technical notes\\r\\n- A note. (C1)\\r\\n### Verified at 0123abc\",\n        \"args\": [\n          \"t.md\",\n          \"--final\"\n        ],\n        \"extract\": {\n          \"of\": \"stdout\",\n          \"as\": \"count\"\n        }\n      }\n    ]\n  },\n  \"q22\": {\n    \"type\": \"state\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"- **D1** Use merge_authority from scripts/x.\",\n      \"- **D1 (proposed)** Again.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"tuple\": [\n        {\n          \"of\": \"findings\",\n          \"line\": 1,\n          \"map\": \"kind\"\n        },\n        {\n          \"of\": \"notes\",\n          \"prefix\": \"criteria \",\n          \"as\": \"first\"\n        }\n      ]\n    }\n  },\n  \"q23\": {\n    \"type\": \"control-undetermined\",\n    \"call\": \"a fixed answer: the module and glossary do not determine it\",\n    \"run\": \"fixed\",\n    \"value\": \"undetermined\"\n  },\n  \"q24\": {\n    \"type\": \"change\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It works.\",\n      \"## Decisions\",\n      \"- **D1 (proposed)** Use the route. Why: it is easy.\",\n      \"- **D2 (given by the user)** Use the route 2. Why: it is simple.\",\n      \"- **D3 (proposed)** Keep it short.\",\n      \"\",\n      \"  and then add more words here.\",\n      \"- **D4 (proposed)** Keep it.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it. (D1, D2, D3, D4)\",\n      \"### Technical notes\",\n      \"- A note. (C1)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"change\": {\n      \"constant\": \"MAX_DECISION_WORDS\",\n      \"value\": 7,\n      \"literal\": \"7\"\n    },\n    \"extract\": {\n      \"of\": \"notes\",\n      \"capture\": \"^(decision D[0-9]+ \\\\(line [0-9]+\\\\): [0-9]+ words): may be more than one idea$\",\n      \"as\": \"list\"\n    }\n  },\n  \"q25\": {\n    \"type\": \"trace\",\n    \"call\": \"analyze(text, false) in the module; text is the input joined with LF\",\n    \"run\": \"analyze\",\n    \"lines\": [\n      \"## Acceptance criteria\",\n      \"1. It reads the file.\",\n      \"2. It prints the findings.\",\n      \"3. It prints the notes.\",\n      \"4. It exits with a status.\",\n      \"5. It refuses a file with no heading.\",\n      \"6. It sets nothing on the disk.\",\n      \"7. A Fixture Run of this change's branch\",\n      \"   scores cleanly against the fixture.\",\n      \"## For the agents\",\n      \"### Checks\",\n      \"- **C1** Run it.\",\n      \"- **C2** Run it.\",\n      \"- **C3** Run it.\",\n      \"- **C4** Run it.\",\n      \"- **C5** Run it.\",\n      \"- **C6** Run it.\",\n      \"- **C7** Run it.\",\n      \"### Technical notes\",\n      \"- A note. (C1, C2, C3, C4, C5, C6, C7)\",\n      \"### Verified at 0123abc\"\n    ],\n    \"final\": false,\n    \"extract\": {\n      \"of\": \"notes\",\n      \"prefix\": \"more\",\n      \"as\": \"list\"\n    }\n  },\n  \"q26\": {\n    \"type\": \"change\",\n    \"call\": \"the array of the answers of 2 runs, in order\",\n    \"run\": \"tuple\",\n    \"change\": {\n      \"constant\": \"USAGE\",\n      \"value\": \"use: ticket-parts FILE\",\n      \"literal\": \"\\\"use: ticket-parts FILE\\\"\"\n    },\n    \"parts\": [\n      {\n        \"call\": \"no input file; the module run as a command: ticket-parts --final t.md u.md\",\n        \"run\": \"cli\",\n        \"args\": [\n          \"--final\",\n          \"t.md\",\n          \"u.md\"\n        ],\n        \"extract\": {\n          \"of\": \"status\"\n        }\n      },\n      {\n        \"call\": \"no input file; the module run as a command: ticket-parts --final t.md u.md\",\n        \"run\": \"cli\",\n        \"args\": [\n          \"--final\",\n          \"t.md\",\n          \"u.md\"\n        ],\n        \"extract\": {\n          \"of\": \"stderr\"\n        }\n      }\n    ]\n  }\n}\n";
// EMBEDDED SPEC>>

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
