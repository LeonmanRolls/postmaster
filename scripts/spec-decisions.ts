// Own the planning stage's spec decisions: one file per package, one stanza for the run's
// one spec. A decisions file in the per-lane shape a run from before the one-spec change
// left behind is still counted, so an older run's file is never misread.
//
//   run spec-decisions <dispatch> fresh
//   run spec-decisions <dispatch> record <decision> <commit> [<words>...]
//   run spec-decisions <dispatch> count
//
// fresh starts a new package's <dispatch>/spec-decisions.md, so no stanza survives across
// packages. record appends one `## spec` stanza and logs the spec-review line through
// scripts/run log-action as it happens, with the target `spec`; it refuses a second stanza,
// a decision outside approved|changes|dropped, a missing commit, words on an approval, and
// a changes or dropped with no words. count prints the numbers Spec review branches on:
//   approved 0|1   1 when this package's `## spec` stanza is an approval with a commit
//   changes 0|1    1 when it is a changes
// When the file holds no `## spec` stanza and is in the per-lane shape, count instead
// prints the pre-change numbers: manifest lanes approved in the manifest or this package,
// each lane once, and manifest lanes with a changes stanza in this package. So does a
// file that holds a `## spec` stanza, alone or beside others, when the manifest names
// a lane `spec`: that is a pre-change file for that lane. Any other mix is refused
// rather than miscounted. count never
// over-counts: an approval with a blank commit, or a stanza for a lane the manifest does
// not name, contributes nothing.
// The stanza is written before the log line, so a failed log never loses a decision, and a
// decisions file this script did not shape is refused rather than miscounted.
//
//   exit 0  done; fresh and record print nothing, count prints the two lines
//   exit 1  usage, no such dispatch, unreadable manifest, missing decisions file
//   exit 2  a refusal: a bad decision, commit or words, a duplicate stanza, a malformed stanza
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";
import { PY_S_CLASS, pySplitLines, pyTrim, pyWords } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);

// --- helpers --------------------------------------------------------------------------------
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

function isDict(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Python's read_text(encoding="utf-8"): undecodable bytes are an error, not U+FFFD.
function readStrict(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

// Python's `any(c.isspace() for c in s)`: text.ts spells the 29-char class.
const HAS_WS = new RegExp(`[${PY_S_CLASS}]`, "u");

function isOneWord(s: string): boolean {
  return s !== "" && !HAS_WS.test(s);
}

// --- the decisions file -----------------------------------------------------------------------
interface Stanza {
  lane: string;
  decision: string;
  commit: string;
  words: string;
}

// The shell's PARSER.parse: blank lines skipped, `## <lane>` headers open stanzas,
// `decision:|commit:|words:` lines fill them, each exactly once. Messages quote the raw
// line, before stripping; lane and field checks run after the whole file reads.
function parseDecisions(path: string): Stanza[] {
  let text: string;
  try {
    text = readStrict(path);
  } catch (e: unknown) {
    die(`spec-decisions: cannot read ${path} (${errMsg(e)})`, 1);
  }
  const lanes: string[] = [];
  const fields: Array<Map<string, string>> = [];
  for (const raw of pySplitLines(text)) {
    const line = pyTrim(raw);
    if (line === "") continue;
    if (line.startsWith("## ")) {
      const lane = pyTrim(line.slice(3));
      if (lane === "") die(`spec-decisions: malformed stanza header: ${raw}`, 2);
      lanes.push(lane);
      fields.push(new Map());
      continue;
    }
    const cur = fields.length > 0 ? fields[fields.length - 1]! : null;
    const colon = line.indexOf(":");
    if (cur === null || colon < 0) die(`spec-decisions: malformed stanza line: ${raw}`, 2);
    const key = pyTrim(line.slice(0, colon));
    const value = pyTrim(line.slice(colon + 1));
    if ((key !== "decision" && key !== "commit" && key !== "words") || cur.has(key))
      die(`spec-decisions: malformed stanza line: ${raw}`, 2);
    cur.set(key, value);
  }
  return lanes.map((lane, i) => {
    const f = fields[i]!;
    if (f.size !== 3) die(`spec-decisions: incomplete stanza for ${lane}`, 2);
    const decision = f.get("decision")!;
    if (decision !== "approved" && decision !== "changes" && decision !== "dropped")
      die(`spec-decisions: bad decision for ${lane}`, 2);
    return { lane, decision, commit: f.get("commit")!, words: f.get("words")! };
  });
}

// The shortcut's disambiguator: true only when the manifest parses to lanes
// naming a lane `spec`. A missing or unreadable manifest is not a legacy
// lane manifest, so the shortcut stands without one.
function manifestNamesSpecLane(d: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readStrict(join(d, "manifest.json")));
  } catch {
    return false;
  }
  if (!isDict(manifest)) return false;
  const lanes: unknown = hasOwn(manifest, "lanes") ? manifest.lanes : {};
  return isDict(lanes) && hasOwn(lanes, "spec");
}

function readManifest(d: string): Record<string, unknown> {
  const path = join(d, "manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readStrict(path));
  } catch (e: unknown) {
    die(`spec-decisions: cannot read ${path} (${errMsg(e)})`, 1);
  }
  // The shell calls manifest.get without a dict check, so a manifest that is not an
  // object dies on an uncaught AttributeError: exit 1 either way, no stable message.
  if (!isDict(manifest)) die("spec-decisions: manifest lanes must be an object", 1);
  const lanes: unknown = hasOwn(manifest, "lanes") ? manifest.lanes : {};
  if (!isDict(lanes)) die("spec-decisions: manifest lanes must be an object", 1);
  return lanes;
}

// --- verbs --------------------------------------------------------------------------------------
function fresh(d: string): void {
  if (!isDir(d)) die(`spec-decisions: no such dir: ${d}`, 1);
  const f = join(d, "spec-decisions.md");
  try {
    writeFileSync(f, "");
  } catch (e: unknown) {
    die(`spec-decisions: cannot write ${f} (${errMsg(e)})`, 1);
  }
}

function record(d: string, decision: string, commit: string, rest: string[]): void {
  // The shell joins the words argv with spaces, then splits and rejoins: one space apart.
  const words = pyWords(rest.join(" ")).join(" ");
  if (!isDir(d)) die(`spec-decisions: no such dir: ${d}`, 1);
  if (decision !== "approved" && decision !== "changes" && decision !== "dropped")
    die("spec-decisions: a decision is approved, changes or dropped", 2);
  if (!isOneWord(commit)) die("spec-decisions: a commit is one word", 2);
  let detail: string;
  if (decision === "approved") {
    if (words !== "") die("spec-decisions: an approval carries no words", 2);
    detail = `approved ${commit}`;
  } else {
    if (words === "") die(`spec-decisions: a ${decision} carries the user's words`, 2);
    detail = `${decision} ${commit} ${words}`;
  }
  const f = join(d, "spec-decisions.md");
  if (!isFile(f)) die("spec-decisions: no decisions file: run fresh first", 1);
  if (parseDecisions(f).length > 0)
    die("spec-decisions: a decision is already recorded in this package", 2);
  try {
    appendFileSync(f, `## spec\ndecision: ${decision}\ncommit: ${commit}\nwords: ${words}\n\n`);
  } catch (e: unknown) {
    die(`spec-decisions: cannot write ${f} (${errMsg(e)})`, 1);
  }
  const logged = run(join(HERE, "run"), [
    "log-action",
    d,
    "postmaster",
    "spec-review",
    "spec",
    detail,
  ]);
  if (logged.code !== 0)
    die("spec-decisions: stanza kept but the log line failed; log it by hand", 1);
}

function count(d: string): void {
  if (!isDir(d)) die(`spec-decisions: no such dir: ${d}`, 1);
  const f = join(d, "spec-decisions.md");
  if (!isFile(f)) die("spec-decisions: no decisions file: run fresh first", 1);
  const entries = parseDecisions(f);
  const one = entries.find((e) => e.lane === "spec");
  // A singleton `## spec` stanza is run-level only when the manifest names no
  // lane `spec`: a legacy lane of that name counts the legacy way, beside the
  // manifest's own outcomes, or approvals already recorded go uncounted.
  if (one !== undefined && entries.length === 1 && !manifestNamesSpecLane(d)) {
    const approved = one.decision === "approved" && one.commit !== "" ? 1 : 0;
    const changed = one.decision === "changes" ? 1 : 0;
    console.log(`approved ${approved}`);
    console.log(`changes ${changed}`);
    return;
  }
  // A run from before the one-spec change: one stanza per lane, counted as before.
  // A `## spec` stanza beside others is that shape, not a mix, when the manifest
  // names a lane `spec`; any other mix is refused rather than miscounted.
  const lanes = readManifest(d);
  if (one !== undefined && !hasOwn(lanes, "spec"))
    die("spec-decisions: a run-level decision file has more than one stanza", 2);
  const approved = new Set<string>();
  for (const [lane, info] of Object.entries(lanes))
    if (isDict(info) && info.outcome === "approved") approved.add(lane);
  const changed = new Set<string>();
  for (const e of entries) {
    if (!hasOwn(lanes, e.lane)) continue;
    if (e.decision === "approved" && e.commit !== "") approved.add(e.lane);
    if (e.decision === "changes") changed.add(e.lane);
  }
  console.log(`approved ${approved.size}`);
  console.log(`changes ${changed.size}`);
}

function usage(): never {
  console.error("usage: run spec-decisions <dispatch> fresh|record|count");
  console.error("       run spec-decisions <dispatch> record <decision> <commit> [<words>...]");
  process.exit(1);
  throw new Error("unreachable");
}

// --- entry --------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === undefined || argv[0] === "" || argv[0].startsWith("-")) {
  usage();
} else {
  if (argv.length < 2) usage();
  const d = argv[0]!;
  const verb = argv[1]!;
  const rest = argv.slice(2);
  if (verb === "fresh") {
    if (rest.length !== 0) usage();
    fresh(d);
  } else if (verb === "record") {
    if (rest.length < 2) usage();
    record(d, rest[0]!, rest[1]!, rest.slice(2));
  } else if (verb === "count") {
    if (rest.length !== 0) usage();
    count(d);
  } else {
    usage();
  }
}
