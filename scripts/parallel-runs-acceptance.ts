// Acceptance oracle for parallel runs: nothing in skills/, AGENTS.md, README.md or the
// wiki still says two runs must not change the same files. Runs go in parallel up to
// `team.max_runs`, and whichever merges second resolves the conflicts at its merge.
// Five checks name one stale sentence each from before that change, matched
// case-insensitively after newlines are folded (carriage returns stripped first, so
// CRLF never hides one),
// and five match the claim itself in every file in scope (`overlapping file surfaces`,
// `never two runs on`, `not change/touch/edit the same files`): a new sentence in one
// of these phrasings trips the same guard. Further paraphrases are beyond a grep oracle.
// Six presence checks hold the sections that survive: step 6 still exists as the
// Order-them step under Stage A and orders by dependencies within its own lines (a
// word-boundary match, so `independence` never satisfies it), the `team.max_runs`
// hard-rule limit stays verbatim in its section, and the concurrency note is
// rewritten, not deleted, keeping second-resolves and never-rebase. The replacement
// wording beyond those pins is judged by reading, not by this script.
//
//   parallel-runs-acceptance.sh [repo-root]   default: the repo this script lives in
//
//   exit 0  no stale claim remains
//   exit 1  stale claims, one per line on stdout: <file>: <what is still claimed>
//   exit 2  usage, a file that cannot be read, or a tree that cannot be fully swept
//
// The beside-script test fails on a tree that still carries the old claims, at its
// live-tree step; that failure is the control proving the checks bite on the real
// files, not only fixtures.
import { lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { casefold } from "./lib/text.ts";

function usage(): never {
  console.error("usage: parallel-runs-acceptance.sh [repo-root]");
  process.exit(2);
}

/** Fold newlines and tabs to single spaces, so a reflow alone never passes. */
function fold(s: string): string {
  return s.replace(/[\n\t]/gu, " ").replace(/ {2,}/gu, " ");
}

/** The file folded for sweeping, carriage returns stripped first so CRLF never hides one. */
function flat(path: string): string {
  return fold(readFileSync(path, "utf8").replace(/\r/gu, ""));
}

/** The file's text, or "" when it cannot be read: the shell's awk reads "" then. */
function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export interface AcceptResult {
  code: number;
  out: string;
  err: string;
}

const STALE: Array<readonly [string, string]> = [
  ["step 6 orders by file surfaces", "then the file surfaces"],
  [
    "two tickets on one module do not run together",
    "Two tickets touching the same route table, transport interface or shared module do not run at the same time",
  ],
  ["never two runs on overlapping file surfaces", "never two runs on overlapping file surfaces"],
  [
    "parallel runs are safe only on disjoint files",
    "Parallel runs are safe when their tickets touch disjoint files",
  ],
  [
    "prefer sequencing colliding tickets",
    "Prefer sequencing those tickets, or accept conflict resolution at each gated merge;",
  ],
  ["check file surfaces before mass-launching", "check the file surfaces before mass-launching"],
];
const CLAIMS = [
  "overlapping file surfaces",
  "never two runs on",
  "not change the same files",
  "not touch the same files",
  "not edit the same files",
];
// grep -qi -F is a case-insensitive fixed-string match: both sides folded once.
const STALE_FOLDED = STALE.map(([label, s]) => [label, casefold(s)] as const);
const CLAIMS_FOLDED = CLAIMS.map((c) => casefold(c));

function sweep(file: string, folded: string, out: string[]): void {
  for (const [label, sentence] of STALE_FOLDED) {
    if (folded.includes(sentence)) out.push(`${file}: still says ${label}`);
  }
  for (const claim of CLAIMS_FOLDED) {
    if (folded.includes(claim))
      out.push(`${file}: still says two runs must not change the same files`);
  }
}

// --- the scope: every regular file under skills/ and wiki/, symlinks followed ---------------
interface Scope {
  files: string[];
  error: string | null;
}

/** The directory's physical path, as `cd -P -- dir && pwd -P` prints it:
 * symlinks resolved, `.` and `..` gone, no trailing slash, a leading `//`
 * kept. Bun's realpathSync mistakes `\` for a separator, so this resolves
 * component by component. Throws when there is no such directory. */
function physicalDir(path: string): string {
  const abs = path.startsWith("/") ? path : `${process.cwd()}/${path}`;
  let dbl = abs.startsWith("//") && !abs.startsWith("///");
  const parts = abs.split("/");
  const out: string[] = [];
  let links = 0;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;
    i++;
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    const probe = out.length === 0 ? `/${part}` : `/${out.join("/")}/${part}`;
    let lst;
    try {
      lst = lstatSync(probe);
    } catch {
      throw new Error(`no such directory: ${path}`);
    }
    if (lst.isSymbolicLink()) {
      links++;
      if (links > 40) throw new Error(`too many levels of symbolic links: ${path}`);
      let target: string;
      try {
        target = readlinkSync(probe);
      } catch {
        throw new Error(`no such directory: ${path}`);
      }
      if (target.startsWith("/")) {
        out.length = 0;
        dbl = target.startsWith("//") && !target.startsWith("///");
      }
      parts.splice(i, 0, ...target.split("/"));
      continue;
    }
    out.push(part);
  }
  const resolved = out.length === 0 ? (dbl ? "//" : "/") : `${dbl ? "//" : "/"}${out.join("/")}`;
  try {
    if (!statSync(resolved).isDirectory()) throw new Error(`no such directory: ${path}`);
  } catch {
    throw new Error(`no such directory: ${path}`);
  }
  return resolved;
}

/** Walk one path as find -L would: a dangling link is silently skipped, a loop,
// an unreadable directory or a missing top makes the tree unsweepable. Ancestor
// canonical paths (not a global visited set) catch loops, so a directory
// reached twice by different paths is still walked twice. */
function walkInto(
  path: string,
  top: boolean,
  files: string[],
  ancestry: Set<string>,
): string | null {
  let st;
  try {
    st = statSync(path);
  } catch (e: any) {
    if (!top && e?.code === "ENOENT") return null;
    return `${path}: ${e?.message ?? e}`;
  }
  if (st.isDirectory()) {
    let key: string;
    try {
      key = physicalDir(path);
    } catch (e: any) {
      return `${path}: ${e?.message ?? e}`;
    }
    if (ancestry.has(key)) return `${path}: file system loop detected`;
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch (e: any) {
      return `${path}: ${e?.message ?? e}`;
    }
    ancestry.add(key);
    for (const entry of entries) {
      const err = walkInto(`${path}/${entry}`, false, files, ancestry);
      if (err !== null) {
        ancestry.delete(key);
        return err;
      }
    }
    ancestry.delete(key);
    return null;
  }
  if (st.isFile()) files.push(path);
  return null;
}

function walkScope(root: string): Scope {
  const files: string[] = [];
  for (const top of [`${root}/skills`, `${root}/wiki`]) {
    const err = walkInto(top, true, files, new Set<string>());
    if (err !== null) return { files: [], error: err };
  }
  files.sort();
  return { files: [...new Set(files)], error: null };
}

// --- the surviving sections -----------------------------------------------------------------
const STEP6_RE = /^6\. /u;
const NUMSTEP_RE = /^[0-9]+\. /u;
// grep -qiE '\bdependenc(y|ies)\b': grep's \b is an ASCII word boundary.
const DEPENDENC_RE = /(?<![A-Za-z0-9_])dependenc(y|ies)(?![A-Za-z0-9_])/iu;

/** Step 6's lines: from the `6.` item under `## Stage A` to the next step or heading. */
function step6Lines(post: string): string[] {
  const step: string[] = [];
  let sect = false;
  let on = false;
  for (const line of post.split("\n")) {
    if (line.startsWith("## Stage A")) {
      sect = true;
      continue;
    }
    if (sect && line.startsWith("## ")) break;
    if (sect && STEP6_RE.test(line)) on = true;
    if (on && NUMSTEP_RE.test(line) && !STEP6_RE.test(line)) break;
    if (on) step.push(line);
  }
  return step;
}

/** A `## ` section's body: from its heading to the next `## ` heading. */
function sectionBody(text: string, head: string): string[] {
  const body: string[] = [];
  let on = false;
  for (const line of text.split("\n")) {
    if (line.startsWith(head)) {
      on = true;
      continue;
    }
    if (on && line.startsWith("## ")) break;
    if (on) body.push(line);
  }
  return body;
}

export function accept(root: string): AcceptResult {
  for (const f of [
    "AGENTS.md",
    "README.md",
    "skills/postmaster/postmaster.md",
    "skills/postmaster/coachman.md",
  ]) {
    try {
      readFileSync(`${root}/${f}`);
    } catch {
      return { code: 2, out: "", err: `parallel-runs-acceptance: cannot read ${root}/${f}\n` };
    }
  }
  const out: string[] = [];
  for (const f of ["AGENTS.md", "README.md"]) {
    let text: string;
    try {
      text = casefold(flat(`${root}/${f}`));
    } catch {
      return { code: 2, out: "", err: `parallel-runs-acceptance: cannot read ${root}/${f}\n` };
    }
    sweep(f, text, out);
  }
  const scope = walkScope(root);
  if (scope.error !== null) {
    return {
      code: 2,
      out: "",
      err: `parallel-runs-acceptance: cannot fully sweep ${root}/skills and ${root}/wiki\n${scope.error}\n`,
    };
  }
  const prefix = `${root}/`;
  for (const full of scope.files) {
    const f = full.startsWith(prefix) ? full.slice(prefix.length) : full;
    let text: string;
    try {
      text = casefold(flat(full));
    } catch {
      return { code: 2, out: "", err: `parallel-runs-acceptance: cannot read ${root}/${f}\n` };
    }
    sweep(f, text, out);
  }
  const post = readText(`${root}/skills/postmaster/postmaster.md`);
  const step6 = step6Lines(post);
  const step6flat = fold(step6.join("\n"));
  if (step6.length === 0 || !step6flat.includes("Order them")) {
    out.push("skills/postmaster/postmaster.md: no longer orders tickets in an Order-them step");
  } else if (!DEPENDENC_RE.test(step6flat)) {
    out.push("skills/postmaster/postmaster.md: no longer orders step 6 by dependencies");
  }
  const rulesflat = fold(sectionBody(post, "## Hard rules").join("\n"));
  if (!rulesflat.includes("- Never launch more runs than `team.max_runs`.")) {
    out.push("skills/postmaster/postmaster.md: no longer limits runs with team.max_runs");
  }
  const note = sectionBody(
    readText(`${root}/skills/postmaster/coachman.md`),
    "## Concurrency note",
  );
  if (note.length === 0) {
    out.push("skills/postmaster/coachman.md: no longer keeps a concurrency note");
  } else {
    const noteflat = casefold(fold(note.join("\n")));
    if (!noteflat.includes("merges second")) {
      out.push(
        "skills/postmaster/coachman.md: no longer says the second merger resolves the conflicts",
      );
    }
    if (!noteflat.includes("never rebase")) {
      out.push("skills/postmaster/coachman.md: no longer says merge, never rebase");
    }
  }
  return { code: out.length === 0 ? 0 : 1, out: out.map((l) => `${l}\n`).join(""), err: "" };
}

function printAccept(r: AcceptResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
/** This script's arguments as invoked: bun swallows one `--` right after the
 * script path, so the raw command line is re-read and everything past the
 * script entry is taken. Without /proc, or when the entry is not found,
 * bun's view stands. */
function rawArgv(): string[] {
  try {
    const raw = readFileSync("/proc/self/cmdline");
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0) {
        parts.push(new TextDecoder().decode(raw.subarray(start, i)));
        start = i + 1;
      }
    }
    const here = import.meta.path;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === here || resolve(parts[i]!) === here) return parts.slice(i + 1);
    }
  } catch {
    /* fall through to bun's view */
  }
  return process.argv.slice(2);
}

const ROOT = toolRoot(import.meta);
const argv = rawArgv();

if (import.meta.main) {
  if (argv[0] === undefined) {
    if (argv.length !== 0) usage();
    printAccept(accept(ROOT));
  } else if (argv[0] === "" || argv[0].startsWith("-")) {
    usage();
  } else {
    if (argv.length !== 1) usage();
    printAccept(accept(argv[0]));
  }
}
