// Own the planning stage's spec decisions: one file per package, one stanza per lane.
//
//   spec-decisions.sh <dispatch> fresh
//   spec-decisions.sh <dispatch> record <lane> <decision> <commit> [<words>...]
//   spec-decisions.sh <dispatch> count
//   spec-decisions.sh --self-test
//
// fresh starts a new package's <dispatch>/spec-decisions.md, so no stanza survives across
// packages. record appends one stanza and logs the spec-review line through
// scripts/log-action.sh as it happens; it refuses a lane the manifest does not name, a
// second stanza for one lane, a decision outside approved|changes|dropped, a missing
// commit, words on an approval, and a changes or dropped with no words. count prints the
// run-wide numbers Spec review step 3 branches on:
//   approved <n>   manifest lanes approved in the manifest or this package, each lane once
//   changes <m>    manifest lanes with a changes stanza in this package
// count never over-counts: a stanza for an unnamed lane, or an approval with a blank
// commit, contributes nothing.
// The stanza is written before the log line, so a failed log never loses a decision, and a
// decisions file this script did not shape is refused rather than miscounted.
//
//   exit 0  done; fresh and record print nothing, count prints the two lines
//   exit 1  usage, no such dispatch, unreadable manifest, missing decisions file
//   exit 2  a refusal: a bad decision, commit or words, a duplicate lane, a malformed stanza
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";
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

function record(d: string, lane: string, decision: string, commit: string, rest: string[]): void {
  // The shell joins the words argv with spaces, then splits and rejoins: one space apart.
  const words = pyWords(rest.join(" ")).join(" ");
  if (!isDir(d)) die(`spec-decisions: no such dir: ${d}`, 1);
  if (!isOneWord(lane)) die("spec-decisions: a lane is one word", 2);
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
  const lanes = readManifest(d);
  if (!hasOwn(lanes, lane)) die(`spec-decisions: ${lane} is not a lane in the manifest`, 2);
  if (parseDecisions(f).some((e) => e.lane === lane))
    die(`spec-decisions: ${lane} is already decided in this package`, 2);
  try {
    appendFileSync(f, `## ${lane}\ndecision: ${decision}\ncommit: ${commit}\nwords: ${words}\n\n`);
  } catch (e: unknown) {
    die(`spec-decisions: cannot write ${f} (${errMsg(e)})`, 1);
  }
  const logged = run(join(HERE, "log-action.sh"), [d, "postmaster", "spec-review", lane, detail]);
  if (logged.code !== 0)
    die("spec-decisions: stanza kept but the log line failed; log it by hand", 1);
}

function count(d: string): void {
  if (!isDir(d)) die(`spec-decisions: no such dir: ${d}`, 1);
  const lanes = readManifest(d);
  const approved = new Set<string>();
  for (const [lane, info] of Object.entries(lanes))
    if (isDict(info) && info.outcome === "approved") approved.add(lane);
  const f = join(d, "spec-decisions.md");
  if (!isFile(f)) die("spec-decisions: no decisions file: run fresh first", 1);
  const changed = new Set<string>();
  for (const e of parseDecisions(f)) {
    if (!hasOwn(lanes, e.lane)) continue;
    if (e.decision === "approved" && e.commit !== "") approved.add(e.lane);
    if (e.decision === "changes") changed.add(e.lane);
  }
  console.log(`approved ${approved.size}`);
  console.log(`changes ${changed.size}`);
}

function usage(): never {
  console.error("usage: spec-decisions.sh <dispatch> fresh|record|count | --self-test");
  console.error(
    "       spec-decisions.sh <dispatch> record <lane> <decision> <commit> [<words>...]",
  );
  process.exit(1);
  throw new Error("unreachable");
}

// --- entry --------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  selfTest();
} else if (argv[0] === undefined || argv[0] === "" || argv[0].startsWith("-")) {
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
    if (rest.length < 3) usage();
    record(d, rest[0]!, rest[1]!, rest[2]!, rest.slice(3));
  } else if (verb === "count") {
    if (rest.length !== 0) usage();
    count(d);
  } else {
    usage();
  }
}

// --- self-test ----------------------------------------------------------------------------------
function selfTest(): void {
  withTempDir((tmp) => {
    const d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
    mkdirSync(d, { recursive: true });
    const SELF = join(HERE, "spec-decisions.sh");
    const st = new SelfTest();
    const decisions = join(d, "spec-decisions.md");
    const actions = join(d, "actions.jsonl");

    const manifest = (lanesJson: string): void => {
      writeFileSync(join(d, "manifest.json"), `{"lanes": {${lanesJson}}}\n`);
    };
    // The shell's stanzas(): grep -c '^## '.
    const stanzas = (): number => {
      try {
        return readFileSync(decisions, "utf8")
          .split("\n")
          .filter((l) => l.startsWith("## ")).length;
      } catch {
        return 0;
      }
    };
    // The shell's logged(): tail -1 of the action log.
    const logged = (): string => {
      const lines = readFileSync(actions, "utf8")
        .split("\n")
        .filter((l) => l !== "");
      return lines.length > 0 ? lines[lines.length - 1]! : "";
    };
    const actionsText = (): string => {
      try {
        return readFileSync(actions, "utf8");
      } catch {
        return "";
      }
    };
    // The shell's $(...): trailing newlines stripped.
    const strip = (s: string): string => s.replace(/\n+$/u, "");
    const approvedLines = (): number =>
      readFileSync(decisions, "utf8")
        .split("\n")
        .filter((l) => l.includes("decision: approved")).length;
    const go = (...args: string[]) => run("bash", [SELF, ...args]);

    console.log("positive controls");
    let r = go(d, "fresh");
    if (r.code === 0 && isFile(decisions) && statSync(decisions).size === 0)
      st.ok("fresh starts an empty decisions file");
    else st.fail(`fresh starts an empty decisions file (exit ${r.code})`, r.err);

    manifest('"alpha": {}');
    r = go(d, "record", "alpha", "approved", "abc123");
    if (r.code === 0 && stanzas() === 1 && logged().includes('"detail":"approved abc123"'))
      st.ok("record writes the stanza and logs the spec-review line");
    else st.fail(`record writes the stanza and logs the spec-review line (exit ${r.code})`, r.err);

    go(d, "fresh");
    if (statSync(decisions).size === 0) st.ok("fresh truncates a decided file");
    else st.fail("fresh truncates a decided file");

    manifest('"alpha": {"outcome": "approved"}, "beta": {}');
    go(d, "fresh");
    r = go(d, "record", "beta", "approved", "def456");
    const c4 = go(d, "count");
    if (
      r.code === 0 &&
      c4.code === 0 &&
      strip(c4.out) === "approved 2\nchanges 0" &&
      approvedLines() === 1
    )
      st.ok(
        "package 1 approves A and changes B, package 2 approves B: two approvals where the file alone reads one",
      );
    else
      st.fail(
        `package 1 approves A and changes B, package 2 approves B: two approvals where the file alone reads one (exit ${r.code}/${c4.code})`,
        `${strip(c4.out)} ${c4.err}`,
      );

    manifest('"alpha": {"outcome": "approved"}, "beta": {}');
    go(d, "fresh");
    r = go(d, "record", "beta", "dropped", "def456", "we only need one lane");
    const c5 = go(d, "count");
    if (r.code === 0 && c5.code === 0 && strip(c5.out) === "approved 1\nchanges 0")
      st.ok("one approval and one drop across two packages reads as the under-two path");
    else
      st.fail(
        `one approval and one drop across two packages reads as the under-two path (exit ${r.code}/${c5.code})`,
        `${strip(c5.out)} ${c5.err}`,
      );

    manifest('"alpha": {}, "beta": {}');
    go(d, "fresh");
    go(d, "record", "alpha", "approved", "abc123");
    r = go(d, "record", "beta", "changes", "def456", "narrow", "the", "scope");
    const c6 = go(d, "count");
    if (
      r.code === 0 &&
      c6.code === 0 &&
      strip(c6.out) === "approved 1\nchanges 1" &&
      logged().includes('"detail":"changes def456 narrow the scope"')
    )
      st.ok("an approval and a changes read as one approval with one outstanding");
    else
      st.fail(
        `an approval and a changes read as one approval with one outstanding (exit ${r.code}/${c6.code})`,
        `${strip(c6.out)} ${c6.err}`,
      );

    manifest('"alpha": {"outcome": "approved"}');
    go(d, "fresh");
    go(d, "record", "alpha", "approved", "abc123");
    const c7 = go(d, "count");
    if (c7.code === 0 && strip(c7.out) === "approved 1\nchanges 0")
      st.ok("a lane approved in both places counts once");
    else
      st.fail(
        `a lane approved in both places counts once (exit ${c7.code})`,
        `${strip(c7.out)} ${c7.err}`,
      );

    manifest('"alpha": {}, "beta": {}');
    go(d, "fresh");
    go(d, "record", "alpha", "approved", "abc123");
    r = go(d, "record", "beta2", "approved", "def456");
    const typoErr = r.err;
    const typoRc = r.code;
    const c8 = go(d, "count");
    if (
      typoRc === 2 &&
      typoErr.includes("not a lane in the manifest") &&
      c8.code === 0 &&
      strip(c8.out) === "approved 1\nchanges 0"
    )
      st.ok("a mistyped lane is refused, and the typo scenario reads one approval");
    else
      st.fail(
        `a mistyped lane is refused, and the typo scenario reads one approval (exit ${typoRc}/${c8.code})`,
        `${strip(c8.out)} ${c8.err}`,
      );

    manifest('"alpha": {}');
    writeFileSync(
      decisions,
      "## alpha\ndecision: approved\ncommit: abc123\nwords: \n\n## alpha\ndecision: changes\ncommit: def456\nwords: narrower\n\n",
    );
    r = go(d, "count");
    if (r.code === 0 && strip(r.out) === "approved 1\nchanges 1")
      st.ok("a duplicate stanza for one lane counts once");
    else
      st.fail(
        `a duplicate stanza for one lane counts once (exit ${r.code})`,
        `${strip(r.out)} ${r.err}`,
      );

    manifest('"alpha": {}, "beta": {}');
    writeFileSync(
      decisions,
      "## alpha\ndecision: approved\ncommit: \nwords: \n\n## beta\ndecision: approved\ncommit: def456\nwords: \n\n",
    );
    r = go(d, "count");
    if (r.code === 0 && strip(r.out) === "approved 1\nchanges 0")
      st.ok("an approved stanza with a blank commit contributes nothing");
    else
      st.fail(
        `an approved stanza with a blank commit contributes nothing (exit ${r.code})`,
        `${strip(r.out)} ${r.err}`,
      );

    console.log("negative controls");
    manifest('"beta": {}');
    go(d, "fresh");
    const before = stanzas();
    const linesBefore = actionsText();
    r = go(d, "record", "alpha", "ok", "abc123");
    if (
      r.code === 2 &&
      stanzas() === before &&
      actionsText() === linesBefore &&
      r.err.includes("a decision is approved, changes or dropped")
    )
      st.ok("a decision outside the triple is refused, and nothing is written");
    else
      st.fail(
        `a decision outside the triple is refused, and nothing is written (exit ${r.code})`,
        r.err,
      );

    r = go(d, "record", "beta", "changes", "def456");
    if (r.code === 2 && r.err.includes("carries the user's words"))
      st.ok("a changes with no words is refused");
    else st.fail(`a changes with no words is refused (exit ${r.code})`, r.err);

    r = go(d, "record", "beta", "approved", "def456", "nice", "work");
    if (r.code === 2 && r.err.includes("carries no words"))
      st.ok("an approval with words is refused");
    else st.fail(`an approval with words is refused (exit ${r.code})`, r.err);

    r = go(d, "record", "beta", "approved");
    if (r.code === 1 && r.err.includes("usage:")) st.ok("a missing commit is a usage error");
    else st.fail(`a missing commit is a usage error (exit ${r.code})`, r.err);

    go(d, "record", "beta", "approved", "def456");
    r = go(d, "record", "beta", "dropped", "def456", "out");
    if (r.code === 2 && stanzas() === 1 && r.err.includes("already decided"))
      st.ok("a second stanza for one lane is refused");
    else st.fail(`a second stanza for one lane is refused (exit ${r.code})`, r.err);

    rmSync(decisions);
    r = go(d, "record", "beta", "approved", "def456");
    if (r.code === 1 && r.err.includes("run fresh first"))
      st.ok("a record with no package file is refused");
    else st.fail(`a record with no package file is refused (exit ${r.code})`, r.err);

    r = go(d, "count");
    if (r.code === 1 && r.err.includes("run fresh first"))
      st.ok("a count with no package file is refused");
    else st.fail(`a count with no package file is refused (exit ${r.code})`, r.err);

    writeFileSync(decisions, "## beta\ndecision: approved\n");
    r = go(d, "count");
    if (r.code === 2 && r.err.includes("incomplete stanza"))
      st.ok("a hand-mangled stanza is refused, not miscounted");
    else st.fail(`a hand-mangled stanza is refused, not miscounted (exit ${r.code})`, r.err);

    rmSync(join(d, "manifest.json"));
    r = go(d, "count");
    if (r.code === 1 && r.err.includes("cannot read")) st.ok("a count with no manifest is refused");
    else st.fail(`a count with no manifest is refused (exit ${r.code})`, r.err);

    r = go(join(tmp, "nowhere"), "count");
    if (r.code === 1 && r.err.includes("no such dir"))
      st.ok("a dispatch that does not exist is refused");
    else st.fail(`a dispatch that does not exist is refused (exit ${r.code})`, r.err);

    st.finish();
  });
}
