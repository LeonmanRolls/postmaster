// The one check for private data: a single rule table serving the gate,
// the wiki scrub and the history rewrite. It scans everything a change
// would publish: the added lines of every commit from its base to its
// head, so a line added and then deleted is still found; the names of
// added files; each commit message; the lines each merge commit
// introduces beyond every parent; and, through --pr-description, the
// pull request's description before it is opened.
//
//   scrub-check.sh <base> <head>    the range
//   scrub-check.sh --files <path>... worktree files, streamed
//   scrub-check.sh --files-inert <path>... markers inert
//   scrub-check.sh --pr-description <file> pull request text
//   scrub-check.sh --spans <path>... machine protocol for the wiki scrub
//   scrub-check.sh --findings <base> <head> machine protocol for the rewrite
//   scrub-check.sh --safe-path <path>... print each path redacted
//   scrub-check.sh --log-detection <rule> <file> <line> [<commit>]
//   scrub-check.sh --help
//
// One suspect per line on stdout as <commit>:<path>:<line>: <kind>.
// A matched value is never printed. Exit 0 clean, 1 suspects, 2 usage.
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function gitBuf(args: string[], cwd?: string): Buffer {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  }) as Buffer;
}
import {
  EMPTY_TREE,
  type Finding,
  KEY_BLOCK_MAX_BLOB,
  KEY_BLOCK_PREFILTER,
  findings,
  getDisabled,
  keyBlockIter,
  keyBlockLines,
} from "./lib/scrub/rules.ts";
import { decodeBytes, scanUnits, homeSpanOf } from "./lib/scrub/decode.ts";
import { LineScanner, safePath } from "./lib/scrub/scan.ts";

const USAGE =
  "usage: scrub-check.sh <base> <head> | --files <path>... | " +
  "--files-inert <path>... | --pr-description <file> | --spans <path>... | " +
  "--findings <base> <head> | --safe-path <path>... | " +
  "--log-detection <rule> <file> <line> [<commit>] | --help";

function notice(message: string, code = 2): never {
  console.error(`scrub-check: ${message}`);
  process.exit(code);
}

function git(args: string[], cwd?: string): Buffer {
  try {
    return gitBuf(args, cwd);
  } catch {
    notice("Git could not read the requested history");
  }
}

function repositoryRoot(): string {
  const raw = git(["rev-parse", "--show-toplevel"]).toString("utf-8").trim();
  const root = resolve(raw);
  if (resolve(process.cwd()) !== root) notice("run from the repository root");
  return root;
}

function resolveCommit(ref: string): string {
  if (!ref || ref.startsWith("-")) notice("a commit ref is required");
  const raw = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`])
    .toString("ascii")
    .trim();
  if (!/^[0-9a-f]{40}$/u.test(raw)) notice("the repository did not return a full commit id");
  return raw;
}

function logDetection(
  rule: string,
  file: string,
  line: number,
  commit: string,
  via = "",
): void {
  const target = process.env.POSTMASTER_DETECTIONS_LOG ?? "";
  if (!target) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString().replace(/\.\d+Z$/u, "Z"),
    rule,
    file: safePath(file),
    line,
    commit,
  };
  if (via) entry.via = via;
  try {
    appendFileSync(target, `${JSON.stringify(entry)}\n`);
  } catch {
    notice("the detections log could not be written");
  }
}

function gitPath(raw: string): string {
  let path = raw.replace(/\r?\n$/u, "");
  if (path.startsWith('"')) {
    try {
      // C-style quoted path from git.
      path = JSON.parse(path.replace(/\\([\\"nrt])/gu, (_m, c: string) => {
        if (c === "n") return "\n";
        if (c === "r") return "\r";
        if (c === "t") return "\t";
        return c;
      }));
    } catch {
      path = raw.replace(/\r?\n$/u, "");
    }
  }
  if (path.startsWith("b/")) path = path.slice(2);
  return path;
}

function commitsWithParents(base: string, head: string): Array<[string, string[]]> {
  const raw = git(["rev-list", "--parents", "--reverse", `${base}..${head}`])
    .toString("ascii");
  const items: Array<[string, string[]]> = [];
  for (const line of raw.split("\n")) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length === 0 || parts[0] === "") continue;
    if (!parts.every((p) => /^[0-9a-f]{40}$/u.test(p)))
      notice("the repository did not return full commit ids");
    items.push([parts[0]!, parts.slice(1)]);
  }
  return items;
}

function scanMessage(commit: string): Array<[string, number, string]> {
  if (getDisabled().has("messages")) return [];
  const raw = git(["show", "-s", "--format=%B", commit]);
  const text = raw.toString("utf-8");
  const blocks = keyBlockLines(text);
  const out: Array<[string, number, string]> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const number = i + 1;
    const line = lines[i]!;
    const seen = new Set<string>();
    const units = scanUnits(line).units;
    for (const [unit, mapping] of units) {
      for (const [start, end, kind] of findings(unit)) {
        const [hs, he] = homeSpanOf(mapping, start, end);
        const key = `${kind}:${hs}:${he}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(["(message)", number, kind]);
      }
    }
    if (
      blocks.has(number) &&
      !getDisabled().has("token") &&
      units[0]![0].trim()
    ) {
      const [unit0, map0] = units[0]!;
      const [hs, he] = homeSpanOf(map0, 0, unit0.length);
      const key = `token:${hs}:${he}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(["(message)", number, "token"]);
      }
    }
  }
  return out;
}

interface DiffSuspect {
  path: string;
  line: number;
  kind: string;
  text: string;
}


// The scan is synchronous for simplicity: read the diff into memory
// line-by-line via a sync spawn. For very large diffs this is still
// bounded by the longest line in the scanner.
function scanCommitDiffSync(
  root: string,
  parent: string,
  commit: string,
): { found: DiffSuspect[]; quiet: DiffSuspect[] } {
  let out: Buffer;
  try {
    out = gitBuf([
      "diff",
      "--text",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--unified=0",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      parent,
      commit,
      "--",
    ], root);
  } catch {
    notice("Git could not read the requested history");
  }
  const found: DiffSuspect[] = [];
  const quiet: DiffSuspect[] = [];
  let path = "";
  let lineNumber: number | null = null;
  let newFile = false;
  let scanner: LineScanner | null = null;
  let texts: Record<number, string> = {};
  let keptLen = 0;
  let faultLen = 0;
  let suppLen = 0;
  let blocks: Set<number> | null = null;

  const drain = (): void => {
    if (!scanner) return;
    for (const [num, , , kind] of scanner.kept.slice(keptLen)) {
      found.push({ path, line: num, kind, text: texts[num] ?? "" });
    }
    keptLen = scanner.kept.length;
    for (const [num] of scanner.faults.slice(faultLen)) {
      found.push({ path, line: num, kind: "marker", text: texts[num] ?? "" });
    }
    faultLen = scanner.faults.length;
    for (const [num, , , kind] of scanner.suppressed.slice(suppLen)) {
      quiet.push({ path, line: num, kind, text: texts[num] ?? "" });
    }
    suppLen = scanner.suppressed.length;
  };
  const endFile = (): void => {
    if (scanner) {
      scanner.flush();
      drain();
    }
    scanner = null;
    texts = {};
    keptLen = 0;
    faultLen = 0;
    suppLen = 0;
    blocks = null;
  };

  const lines = out.toString("utf-8").split("\n");
  for (const raw of lines) {
    const content = raw.replace(/\r$/u, "");
    if (content.startsWith("diff --git ")) {
      endFile();
      path = "";
      lineNumber = null;
      newFile = false;
    } else if (content.startsWith("--- ") && lineNumber === null) {
      newFile = content.slice(4) === "/dev/null";
    } else if (content.startsWith("+++ ") && lineNumber === null) {
      path = gitPath(content.slice(4));
      lineNumber = null;
      if (newFile && path !== "/dev/null") {
        for (const [, , kind] of findings(path)) {
          found.push({ path, line: 0, kind, text: path });
        }
      }
    } else if (content.startsWith("@@ ")) {
      const m = /\+([0-9]+)(?:,[0-9]+)?\s+@@/u.exec(content);
      lineNumber = m ? parseInt(m[1]!, 10) : null;
    } else if (lineNumber !== null && content.startsWith("+")) {
      if (!scanner) scanner = new LineScanner();
      const text = content.slice(1);
      texts[lineNumber] = text;
      if (blocks === null && KEY_BLOCK_PREFILTER.test(text)) {
        blocks = blobBlockLines(root, commit, path);
      }
      scanner.feed(lineNumber, text, blocks !== null && blocks.has(lineNumber));
      drain();
      for (const n of Object.keys(texts).map(Number)) {
        if (n < lineNumber - 1) delete texts[n];
      }
      lineNumber += 1;
    }
  }
  endFile();
  return { found, quiet };
}

function blobBlockLines(root: string, commit: string, path: string): Set<number> {
  try {
    const size = parseInt(
      gitBuf(["cat-file", "-s", `${commit}:${path}`], root)
        .toString("ascii")
        .trim(),
      10,
    );
    if (size > KEY_BLOCK_MAX_BLOB) return new Set();
    const shown = gitBuf(["show", `${commit}:${path}`], root);
    return keyBlockLines(shown.toString("utf-8"));
  } catch {
    return new Set();
  }
}

function changedNames(raw: string): string[] {
  return raw.split("\0").filter((p) => p.length > 0);
}

function lineDigest(text: string): string {
  // Simple hash for line comparison.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(h);
}

function addedLines(root: string, parent: string, merge: string, path: string): Array<[number, string]> {
  let out: Buffer;
  try {
    out = gitBuf([
      "diff",
      "--text",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--unified=0",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      parent,
      merge,
      "--",
      path,
    ], root);
  } catch {
    notice("Git could not read the requested history");
  }
  const result: Array<[number, string]> = [];
  let lineNumber: number | null = null;
  for (const raw of out.toString("utf-8").split("\n")) {
    const content = raw.replace(/\r$/u, "");
    if (content.startsWith("@@ ")) {
      const m = /\+([0-9]+)(?:,[0-9]+)?\s+@@/u.exec(content);
      lineNumber = m ? parseInt(m[1]!, 10) : null;
    } else if (lineNumber !== null && content.startsWith("+")) {
      result.push([lineNumber, content.slice(1)]);
      lineNumber += 1;
    }
  }
  return result;
}

function scanMergeDiff(
  root: string,
  parents: string[],
  merge: string,
): { found: DiffSuspect[]; quiet: DiffSuspect[] } {
  const [first, ...others] = parents;
  const changed = new Set(
    changedNames(
      git(["diff", "--name-only", "-z", first!, merge, "--"], root).toString("utf-8"),
    ),
  );
  for (const other of others) {
    const names = new Set(
      changedNames(
        git(["diff", "--name-only", "-z", other, merge, "--"], root).toString("utf-8"),
      ),
    );
    for (const n of [...changed]) {
      if (!names.has(n)) changed.delete(n);
    }
  }
  const found: DiffSuspect[] = [];
  const quiet: DiffSuspect[] = [];
  let created: Set<string> | null = null;
  for (const parent of parents) {
    const names = new Set(
      changedNames(
        git(
          ["diff", "--name-only", "-z", "--diff-filter=A", parent, merge, "--"],
          root,
        ).toString("utf-8"),
      ),
    );
    created = created === null ? names : new Set([...created].filter((n: string) => names.has(n)));
  }
  for (const path of [...(created ?? [])].sort()) {
    for (const [, , kind] of findings(path)) {
      found.push({ path, line: 0, kind, text: path });
    }
  }
  for (const path of [...changed].sort()) {
    const held = others.map((other) => {
      const lines = new Set<string>();
      for (const [, text] of addedLines(root, other, merge, path)) {
        lines.add(lineDigest(text));
      }
      return lines;
    });
    const scanner = new LineScanner();
    const texts: Record<number, string> = {};
    let keptLen = 0;
    let faultLen = 0;
    let suppLen = 0;
    let prevFed: number | null = null;
    let blocks: Set<number> | null = null;
    for (const [number, text] of addedLines(root, first!, merge, path)) {
      if (!held.every((lines) => lines.has(lineDigest(text)))) continue;
      texts[number] = text;
      for (const n of Object.keys(texts).map(Number)) {
        if (n !== number && n !== prevFed) delete texts[n];
      }
      if (blocks === null && KEY_BLOCK_PREFILTER.test(text)) {
        blocks = blobBlockLines(root, merge, path);
      }
      scanner.feed(number, text, blocks !== null && blocks.has(number));
      for (const [num, , , kind] of scanner.kept.slice(keptLen)) {
        found.push({ path, line: num, kind, text: texts[num] ?? "" });
      }
      keptLen = scanner.kept.length;
      for (const [num] of scanner.faults.slice(faultLen)) {
        found.push({ path, line: num, kind: "marker", text: texts[num] ?? "" });
      }
      faultLen = scanner.faults.length;
      for (const [num, , , kind] of scanner.suppressed.slice(suppLen)) {
        quiet.push({ path, line: num, kind, text: texts[num] ?? "" });
      }
      suppLen = scanner.suppressed.length;
      prevFed = number;
    }
    scanner.flush();
    for (const [num] of scanner.faults.slice(faultLen)) {
      found.push({ path, line: num, kind: "marker", text: texts[num] ?? "" });
    }
  }
  return { found, quiet };
}

function runScan(root: string, base: string, head: string, machine = false): number {
  const items = commitsWithParents(base, head);
  const suspects: Array<[string, string, number, string]> = [];
  const reported = new Set<string>();
  for (const [commit, parents] of items) {
    if (parents.length > 1) continue;
    const parent = parents[0] ?? EMPTY_TREE;
    for (const [path, line, kind] of scanMessage(commit)) {
      suspects.push([commit, path, line, kind]);
      logDetection(kind, path, line, commit);
    }
    const { found, quiet } = scanCommitDiffSync(root, parent, commit);
    for (const { path, line, kind, text } of found) {
      suspects.push([commit, path, line, kind]);
      if (kind !== "marker") logDetection(kind, path, line, commit);
      reported.add(`${kind}:${path}:${text}`);
    }
    for (const { path, line, kind, text } of quiet) {
      const key = `${kind}:${path}:${text}`;
      if (reported.has(key)) continue;
      reported.add(key);
      logDetection(kind, path, line, commit, "marker");
    }
  }
  for (const [commit, parents] of items) {
    if (parents.length <= 1) continue;
    for (const [path, line, kind] of scanMessage(commit)) {
      suspects.push([commit, path, line, kind]);
      logDetection(kind, path, line, commit);
    }
    if (getDisabled().has("merges")) continue;
    const { found, quiet } = scanMergeDiff(root, parents, commit);
    for (const { path, line, kind, text } of found) {
      const key = `${kind}:${path}:${text}`;
      if (reported.has(key)) continue;
      reported.add(key);
      suspects.push([commit, path, line, kind]);
      if (kind !== "marker") logDetection(kind, path, line, commit);
    }
    for (const { path, line, kind, text } of quiet) {
      const key = `${kind}:${path}:${text}`;
      if (reported.has(key)) continue;
      reported.add(key);
      logDetection(kind, path, line, commit, "marker");
    }
  }
  suspects.sort();
  for (const [commit, path, line, kind] of suspects) {
    if (machine) {
      console.log(JSON.stringify({ commit, path, line, rule: kind }));
    } else {
      console.log(`${commit}:${safePath(path)}:${line}: ${kind}`);
    }
  }
  return suspects.length > 0 ? 1 : 0;
}

function runFiles(root: string, paths: string[], markers = true): number {
  void root;
  const suspects: Array<[string, number, string]> = [];
  for (const rawPath of paths) {
    let buf: Buffer;
    try {
      buf = readFileSync(rawPath);
    } catch {
      notice(`could not read ${safePath(rawPath)}`);
    }
    const scanner = new LineScanner(findings, markers);
    const blocks = new Set<number>();
    for (const [n, flag] of keyBlockIter(
      decodeBytes(buf).split("\n"),
    )) {
      if (flag) blocks.add(n);
    }
    const text = decodeBytes(buf);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const number = i + 1;
      const line = lines[i]!.replace(/\r$/u, "");
      scanner.feed(number, line, blocks.has(number));
      for (const [num, , , kind] of scanner.kept) {
        if (suspects.some(([p, n, k]) => p === rawPath && n === num && k === kind)) continue;
        suspects.push([rawPath, num, kind]);
        logDetection(kind, rawPath, num, "");
      }
      scanner.kept.length = 0;
      for (const [num] of scanner.faults) {
        if (suspects.some(([p, n, k]) => p === rawPath && n === num && k === "marker")) continue;
        suspects.push([rawPath, num, "marker"]);
      }
      scanner.faults.length = 0;
      for (const [num, , , kind] of scanner.suppressed) {
        logDetection(kind, rawPath, num, "", "marker");
      }
      scanner.suppressed.length = 0;
    }
    scanner.flush();
    for (const [num] of scanner.faults) {
      suspects.push([rawPath, num, "marker"]);
    }
  }
  suspects.sort();
  for (const [path, line, kind] of suspects) {
    console.log(`${safePath(path)}:${line}: ${kind}`);
  }
  return suspects.length > 0 ? 1 : 0;
}

function runSpans(root: string, paths: string[]): number {
  void root;
  for (let index = 0; index < paths.length; index++) {
    const rawPath = paths[index]!;
    let buf: Buffer;
    try {
      buf = readFileSync(rawPath);
    } catch {
      notice(`could not read ${safePath(rawPath)}`);
    }
    const scanner = new LineScanner();
    const blocks = new Set<number>();
    for (const [n, flag] of keyBlockIter(decodeBytes(buf).split("\n"))) {
      if (flag) blocks.add(n);
    }
    const text = decodeBytes(buf);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const number = i + 1;
      const line = lines[i]!.replace(/\r$/u, "");
      scanner.feed(number, line, blocks.has(number));
      for (const [num, start, end, kind] of scanner.kept) {
        console.log(`${index}:${num}:${start}:${end}:${kind}`);
        logDetection(kind, rawPath, num, "");
      }
      scanner.kept.length = 0;
      for (const [num, start, end] of scanner.faults) {
        console.log(`${index}:${num}:${start}:${end}:marker`);
      }
      scanner.faults.length = 0;
      for (const [num, , , kind] of scanner.suppressed) {
        logDetection(kind, rawPath, num, "", "marker");
      }
      scanner.suppressed.length = 0;
    }
    scanner.flush();
    for (const [num, start, end] of scanner.faults) {
      console.log(`${index}:${num}:${start}:${end}:marker`);
    }
  }
  return 0;
}

function runPrDescription(root: string, path: string): number {
  void root;
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    notice(`could not read ${safePath(path)}`);
  }
  const suspects: Array<[number, string]> = [];
  const blocks = new Set<number>();
  for (const [n, flag] of keyBlockIter(decodeBytes(buf).split("\n"))) {
    if (flag) blocks.add(n);
  }
  const text = decodeBytes(buf);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const number = i + 1;
    const line = lines[i]!.replace(/\r$/u, "");
    const seen = new Set<string>();
    const units = scanUnits(line).units;
    for (const [unit, mapping] of units) {
      for (const [start, end, kind] of findings(unit)) {
        const [hs, he] = homeSpanOf(mapping, start, end);
        const key = `${kind}:${hs}:${he}`;
        if (seen.has(key)) continue;
        seen.add(key);
        suspects.push([number, kind]);
        logDetection(kind, "(pr-description)", number, "");
      }
    }
    if (
      blocks.has(number) &&
      !getDisabled().has("token") &&
      units[0]![0].trim()
    ) {
      const [unit0, map0] = units[0]!;
      const [hs, he] = homeSpanOf(map0, 0, unit0.length);
      const key = `token:${hs}:${he}`;
      if (!seen.has(key)) {
        seen.add(key);
        suspects.push([number, "token"]);
        logDetection("token", "(pr-description)", number, "");
      }
    }
  }
  suspects.sort();
  for (const [line, kind] of suspects) {
    console.log(`(pr-description):${line}: ${kind}`);
  }
  return suspects.length > 0 ? 1 : 0;
}

function runSafePaths(root: string, paths: string[]): number {
  void root;
  for (const p of paths) {
    console.log(safePath(p));
  }
  return 0;
}

function runLogDetection(args: string[]): number {
  if (args.length !== 3 && args.length !== 4) notice(USAGE);
  const [rule, file, line] = args;
  const commit = args[3] ?? "";
  const RULES = [
    "account-id",
    "assistant-attribution",
    "dotenv",
    "email",
    "key",
    "private-host",
    "private-path",
    "token",
  ];
  if (!RULES.includes(rule!))
    notice(`--log-detection names a rule, one of: ${RULES.join(", ")}`);
  if (!file) notice("--log-detection names the file the finding was reported in");
  const number = parseInt(line!, 10);
  if (Number.isNaN(number))
    notice("--log-detection takes the finding's line number");
  if (number < 0)
    notice("--log-detection takes the finding's line number, 0 for a name");
  if (commit && !/^[0-9a-f]{40}$/u.test(commit))
    notice("--log-detection takes a full commit id or nothing");
  logDetection(rule!, file, number, commit);
  return 0;
}

function main(args: string[]): number {
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  const disabled = getDisabled();
  if (disabled.size > 0) {
    console.error(
      `scrub-check: disabled for testing: ${[...disabled].sort().join(" ")}`,
    );
  }
  const root = repositoryRoot();
  if (args[0] === "--files") {
    if (args.length < 2) notice(USAGE);
    return runFiles(root, args.slice(1));
  }
  if (args[0] === "--files-inert") {
    if (args.length < 2) notice(USAGE);
    return runFiles(root, args.slice(1), false);
  }
  if (args[0] === "--spans") {
    if (args.length < 2) notice(USAGE);
    return runSpans(root, args.slice(1));
  }
  if (args[0] === "--findings") {
    if (args.length !== 3) notice(USAGE);
    const base = resolveCommit(args[1]!);
    const head = resolveCommit(args[2]!);
    return runScan(root, base, head, true);
  }
  if (args[0] === "--pr-description") {
    if (args.length !== 2) notice(USAGE);
    return runPrDescription(root, args[1]!);
  }
  if (args[0] === "--safe-path") {
    if (args.length < 2) notice(USAGE);
    return runSafePaths(root, args.slice(1));
  }
  if (args[0] === "--log-detection") {
    return runLogDetection(args.slice(1));
  }
  if (args.length !== 2 || args.some((a) => a.startsWith("--"))) notice(USAGE);
  const base = resolveCommit(args[0]!);
  const head = resolveCommit(args[1]!);
  return runScan(root, base, head);
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  if (e instanceof Error && e.message.startsWith("scrub-check:")) {
    process.exit(2);
  }
  console.error("scrub-check: scan failed");
  process.exit(2);
}
