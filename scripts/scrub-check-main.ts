#!/usr/bin/env bun
// Range and file scanner for content a run is about to publish.
import { spawn, spawnSync } from "node:child_process";
import { PY_S_CLASS, pyLower, pyWords } from "./lib/text.ts";
import {
  childLines,
  codePointOffset,
  decodeBytes,
  detectLine,
  keyBlockStep,
  RefusedError,
  refuseUnlessText,
  repositoryRoot,
  resolveCommit,
  runGit,
  scanLine,
  StreamScanner,
  streamLines,
} from "./scrub-core.ts";
import { errorText, fail, findingRow, logFinding, safePath } from "./scrub-report.ts";

const USAGE =
  "usage: scrub-check.sh <base> <head> | --files <path>... | --files-inert <path>... | --pr-description <file> | --spans <path>... | --findings <base> <head> | --safe-path <path>... | --log-detection <rule> <file> <line> [<commit>] | --help";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const disabled = new Set(pyWords((process.env.SCRUB_CHECK_DISABLE ?? "").replaceAll(",", " ")));

interface FindingRow {
  commit: string;
  path: string;
  line: number;
  rule: string;
  content?: string;
  via?: string;
  logOnly?: boolean;
}

async function citationContext(path: string): Promise<string> {
  if (!pyLower(path).endsWith(".md")) return "";
  let frontmatter = false;
  let title = false;
  let source = false;
  try {
    for await (const line of streamLines(path)) {
      if (!frontmatter) {
        if (line.number === 1 && line.text.trim() === "---") frontmatter = true;
        else return "";
        continue;
      }
      if (line.text.trim() === "---") break;
      if (new RegExp(`^[${PY_S_CLASS}]*title[${PY_S_CLASS}]*:`, "iu").test(line.text)) title = true;
      if (
        new RegExp(`^[${PY_S_CLASS}]*(?:url|doi|retrieved|arxiv)[${PY_S_CLASS}]*:`, "iu").test(
          line.text,
        )
      )
        source = true;
    }
  } catch (error) {
    if (error instanceof RefusedError) fail("scrub-check", error.message);
    fail("scrub-check", `could not read ${safePath(path)}`);
  }
  return title && source ? "title: citation\nurl: citation" : "";
}

function outRows(rows: FindingRow[], machine: boolean): number {
  rows.sort(
    (a, b) =>
      a.commit.localeCompare(b.commit) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
  for (const row of rows) {
    if (machine)
      console.log(
        JSON.stringify({ commit: row.commit, path: row.path, line: row.line, rule: row.rule }),
      );
    else console.log(`${row.commit}:${findingRow(row.path, row.line, row.rule)}`);
  }
  return rows.length ? 1 : 0;
}

// The one line feed: thread key-block state and the marker scanner together,
// so every caller that walks lines in order decides key material the same
// way. (The range walker cannot use it: its key lines come from a blob
// pre-pass, since a hunk shows only added lines.)
interface KeyFeed {
  keyState: boolean;
  scanner: StreamScanner;
}

function feedKeyLine(
  feed: KeyFeed,
  number: number,
  text: string,
  opts: { markers?: boolean; context?: string } = {},
): ReturnType<StreamScanner["feed"]> {
  const step = keyBlockStep(text, feed.keyState);
  feed.keyState = step.inBlock;
  return feed.scanner.feed(number, text, { ...opts, keyBlock: step.flagged });
}

async function keyBlockLines(commit: string, path: string, root: string): Promise<Set<number>> {
  const child = runGit(["show", `${commit}:${path}`], root);
  if (!child.stdout) fail("scrub-check", "the requested history could not be read");
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  const result = new Set<number>();
  let inBlock = false;
  let number = 0;
  for await (const raw of childLines(child.stdout)) {
    number++;
    refuseUnlessText(raw, path);
    const step = keyBlockStep(raw, inBlock);
    inBlock = step.inBlock;
    if (step.flagged) result.add(number);
  }
  const code = await closed;
  if (code !== 0) fail("scrub-check", "the requested history could not be read");
  return result;
}

function parseHunk(line: string): number | null {
  const match = /^@@ [^ ]+ \+([0-9]+)(?:,[0-9]+)? @@/u.exec(line);
  return match ? Number(match[1]) : null;
}

function parseDiffPath(line: string): string {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" "');
    if (end === -1 || !rest.endsWith('"')) return "";
    return rest.slice(end + 3, -1);
  }
  // No-prefix form repeats the name twice; the halves are identical.
  if (rest.length % 2 === 1) {
    const half = (rest.length - 1) / 2;
    if (rest[half] === " " && rest.slice(0, half) === rest.slice(half + 1))
      return rest.slice(0, half);
  }
  const at = rest.lastIndexOf(" b/");
  return at === -1 ? "" : rest.slice(at + 3);
}

const LOG_FORMAT = "%x00SCRUB COMMIT %H %P%x00%n%an <%ae>%n%cn <%ce>%n%B%x00SCRUB END MESSAGE%x00";
const COMMIT_SENTINEL = "\0SCRUB COMMIT ";
const MESSAGE_SENTINEL = "\0SCRUB END MESSAGE\0";

interface LogSection {
  commit: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
  patch: string[];
}

function logArgs(range: string[], merges: boolean): string[] {
  const args = [
    "-c",
    "core.quotePath=false",
    "log",
    "--reverse",
    `--format=${LOG_FORMAT}`,
    "-p",
    "--text",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    "--unified=0",
    "--no-prefix",
  ];
  if (merges) args.push("--merges", "--diff-merges=first-parent");
  args.push(...range, "--");
  return args;
}

async function* logSections(
  root: string,
  range: string[],
  merges: boolean,
): AsyncGenerator<LogSection> {
  const child = runGit(logArgs(range, merges), root);
  if (!child.stdout) fail("scrub-check", "the requested history could not be read");
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  let commit = "";
  let parents: string[] = [];
  let author = "";
  let committer = "";
  let message = "";
  let patch: string[] = [];
  let state = -1;
  const emit = (): LogSection | null =>
    commit ? { commit, parents, author, committer, message, patch } : null;
  for await (const line of childLines(child.stdout)) {
    if (line.startsWith(COMMIT_SENTINEL) && line.endsWith("\0")) {
      const prev = emit();
      const inner = line.slice(COMMIT_SENTINEL.length, -1);
      const [sha, ...rest] = inner.split(" ");
      commit = sha!;
      parents = rest.filter(Boolean);
      author = "";
      committer = "";
      message = "";
      patch = [];
      state = 0;
      if (prev) yield prev;
      continue;
    }
    if (!commit) continue;
    if (state === 0) {
      author = line;
      state = 1;
      continue;
    }
    if (state === 1) {
      committer = line;
      state = 2;
      continue;
    }
    if (state === 2) {
      const at = line.indexOf(MESSAGE_SENTINEL);
      if (at === -1) {
        message += `${line}\n`;
        continue;
      }
      message += line.slice(0, at);
      state = 3;
      continue;
    }
    patch.push(line);
  }
  const last = emit();
  const code = await closed;
  if (code !== 0) fail("scrub-check", "the requested history could not be read");
  if (last) yield last;
}

class CatBatch {
  private child: ReturnType<typeof spawn> | null = null;
  private buffer: Uint8Array = Buffer.alloc(0);
  private iterator: AsyncIterator<Uint8Array> | null = null;

  constructor(private root: string) {}

  private async ensure(): Promise<void> {
    if (this.child) return;
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (!child.stdout || !child.stdin)
      fail("scrub-check", "the requested history could not be read");
    this.child = child;
    const stdout = child.stdout as unknown as AsyncIterable<Uint8Array>;
    this.iterator = stdout[Symbol.asyncIterator]();
  }

  private async fill(need: number): Promise<void> {
    while (this.buffer.length < need) {
      const next = await this.iterator!.next();
      if (next.done) fail("scrub-check", "the requested history could not be read");
      const chunk = Buffer.from(next.value);
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    }
  }

  private async takeLine(): Promise<string> {
    for (;;) {
      const at = this.buffer.indexOf(0x0a);
      if (at !== -1) {
        const line = Buffer.from(this.buffer.slice(0, at)).toString("utf8");
        this.buffer = this.buffer.slice(at + 1);
        return line;
      }
      await this.fill(this.buffer.length + 1);
    }
  }

  async content(rev: string, path: string): Promise<Buffer | null> {
    await this.ensure();
    const child = this.child!;
    if (!child.stdin) fail("scrub-check", "the requested history could not be read");
    child.stdin.write(`${rev}:${path}\n`);
    const header = await this.takeLine();
    if (header.endsWith(" missing")) return null;
    const size = Number(header.split(" ")[2]);
    if (!Number.isInteger(size) || size < 0)
      fail("scrub-check", "the requested history could not be read");
    await this.fill(size + 1);
    const body = Buffer.from(this.buffer.slice(0, size));
    this.buffer = this.buffer.slice(size + 1);
    return header.split(" ")[1] === "blob" ? body : null;
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.iterator = null;
    if (!child) return;
    const proc = child as unknown as { exitCode?: number | null };
    if (proc.exitCode !== null && proc.exitCode !== undefined) return;
    child.stdin?.end();
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
  }
}

function citationText(content: Buffer): string {
  const lines = content.toString("utf8").split("\n");
  if ((lines[0] ?? "").trim() !== "---") return "";
  let title = false;
  let source = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    if (new RegExp(`^[${PY_S_CLASS}]*title[${PY_S_CLASS}]*:`, "iu").test(line)) title = true;
    if (
      new RegExp(`^[${PY_S_CLASS}]*(?:url|doi|retrieved|arxiv)[${PY_S_CLASS}]*:`, "iu").test(line)
    )
      source = true;
  }
  return title && source ? "title: citation\nurl: citation" : "";
}

async function scanPatchSection(
  commit: string,
  patch: string[],
  cite: (path: string) => Promise<string>,
  root: string,
): Promise<FindingRow[]> {
  const nameRows: FindingRow[] = [];
  const rows: FindingRow[] = [];
  let path = "";
  let diffPath = "";
  let newFile = false;
  let lineNumber: number | null = null;
  let scanner = new StreamScanner();
  let keyLines: Set<number> | null = null;
  let context = "";
  const pushNameRows = (name: string): void => {
    for (const finding of detectLine(name))
      nameRows.push({ commit, path: name, line: 0, rule: finding.rule, content: name });
  };
  const flushEmptyName = (): void => {
    // An added empty file has no +++ line; its name comes from the header.
    if (newFile && !path && diffPath) pushNameRows(diffPath);
  };
  for (const line of patch) {
    if (line.startsWith("diff --git ")) {
      for (const marker of scanner.flush())
        rows.push({
          commit,
          path,
          line: marker.line ?? Math.max(1, (lineNumber ?? 1) - 1),
          rule: "marker",
        });
      flushEmptyName();
      scanner = new StreamScanner();
      path = "";
      diffPath = parseDiffPath(line);
      lineNumber = null;
      newFile = false;
      keyLines = null;
      context = "";
      continue;
    }
    if (line.startsWith("new file mode")) {
      newFile = true;
      continue;
    }
    if (line.startsWith("--- ") && lineNumber === null) {
      continue;
    }
    if (line.startsWith("+++ ") && lineNumber === null) {
      path = line.slice(4);
      if (newFile && path !== "/dev/null") pushNameRows(path);
      if (path !== "/dev/null") context = await cite(path);
      continue;
    }
    if (line.startsWith("@@ ")) {
      lineNumber = parseHunk(line);
      continue;
    }
    if (lineNumber === null || !line.startsWith("+")) continue;
    const text = line.slice(1);
    refuseUnlessText(text, path);
    if (
      keyLines === null &&
      (/^[A-Za-z0-9+/=]{20,}$/u.test(text.trim()) ||
        /PRIVATE KEY|Private-MAC:|SSH2 ENCRYPTED/u.test(text))
    ) {
      keyLines = await keyBlockLines(commit, path, root);
    }
    const isKey = keyLines?.has(lineNumber) ?? false;
    const result = scanner.feed(lineNumber, text, { keyBlock: isKey, context });
    for (const f of result.findings) {
      rows.push({ commit, path, line: lineNumber, rule: f.rule, content: text });
    }
    for (const f of result.suppressed)
      rows.push({
        commit,
        path,
        line: lineNumber,
        rule: f.rule,
        content: text,
        via: "marker",
        logOnly: true,
      });
    for (const marker of result.markers)
      rows.push({ commit, path, line: marker.line ?? lineNumber, rule: "marker" });
    lineNumber++;
  }
  flushEmptyName();
  for (const marker of scanner.flush())
    rows.push({
      commit,
      path,
      line: marker.line ?? Math.max(1, (lineNumber ?? 1) - 1),
      rule: "marker",
    });
  return [...nameRows, ...rows];
}

async function scanTextBlock(commit: string, place: string, raw: string): Promise<FindingRow[]> {
  const rows: FindingRow[] = [];
  const feed: KeyFeed = { keyState: false, scanner: new StreamScanner() };
  const lines = raw.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const result = feedKeyLine(feed, i + 1, text, { markers: false });
    for (const finding of result.findings)
      rows.push({ commit, path: place, line: i + 1, rule: finding.rule });
  }
  for (const marker of feed.scanner.flush())
    rows.push({ commit, path: place, line: lines.length, rule: "marker" });
  return rows;
}

async function commitHasExactLine(
  root: string,
  commit: string,
  path: string,
  expected: string,
): Promise<boolean> {
  const exists = spawnSync("git", ["cat-file", "-e", `${commit}:${path}`], {
    cwd: root,
    stdio: "ignore",
  });
  if (exists.status !== 0) {
    const treeExists = spawnSync("git", ["cat-file", "-e", `${commit}^{tree}`], {
      cwd: root,
      stdio: "ignore",
    });
    if (treeExists.status !== 0) fail("scrub-check", "the requested history could not be read");
    return false;
  }
  const child = runGit(["show", `${commit}:${path}`], root);
  if (!child.stdout) fail("scrub-check", "the requested history could not be read");
  // The close listener goes on before the first read: a small blob's git
  // exits before the drain ends, and a listener attached after misses it.
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  let found = false;
  for await (const line of childLines(child.stdout)) if (line === expected) found = true;
  const code = await closed;
  if (code !== 0) fail("scrub-check", "the requested history could not be read");
  return found;
}

async function rangeScan(
  root: string,
  base: string,
  head: string,
  machine: boolean,
): Promise<number> {
  // Two streaming passes and one batch reader: a census once spawned four
  // processes per commit, and thousands of spawns balloon virtual memory
  // until every later spawn crawls. The log streams carry the same bytes
  // the per-commit calls read.
  const range = base === EMPTY_TREE ? [head] : [`${base}..${head}`];
  const batch = new CatBatch(root);
  const cite = async (commit: string, path: string): Promise<string> => {
    if (!pyLower(path).endsWith(".md")) return "";
    const content = await batch.content(commit, path);
    if (!content) return "";
    return citationText(content);
  };
  const rows: FindingRow[] = [];
  const reported = new Set<string>();
  try {
    for await (const section of logSections(root, range, false)) {
      const commit = section.commit;
      if (!disabled.has("messages")) {
        const messageRows = await scanTextBlock(commit, "(message)", section.message);
        rows.push(...messageRows);
        for (const row of messageRows)
          if (row.rule !== "marker") logFinding(row.rule, row.path, row.line, commit);
      }
      const names: Array<[string, string]> = [
        ["(author)", section.author],
        ["(committer)", section.committer],
      ];
      for (const [place, text] of names) {
        const found = await scanTextBlock(commit, place, text);
        rows.push(...found);
        for (const row of found) logFinding(row.rule, row.path, row.line, commit);
      }
      if (section.parents.length > 1) continue;
      const found = await scanPatchSection(
        commit,
        section.patch,
        (path) => cite(commit, path),
        root,
      );
      for (const row of found) {
        const id = `${row.rule}\0${row.path}\0${row.content ?? ""}`;
        if (row.logOnly) logFinding(row.rule, row.path, row.line, commit, row.via);
        else {
          rows.push(row);
          if (row.rule !== "marker") logFinding(row.rule, row.path, row.line, commit);
          reported.add(id);
        }
      }
    }
    for await (const section of logSections(root, range, true)) {
      const commit = section.commit;
      const parents = section.parents;
      if (parents.length < 2 || disabled.has("merges")) continue;
      const found = await scanPatchSection(
        commit,
        section.patch,
        (path) => cite(commit, path),
        root,
      );
      for (const row of found) {
        // A resolution line already introduced by another parent was scanned at its original commit.
        let shared = false;
        for (const parent of parents.slice(1)) {
          if (row.line === 0) {
            const exists = spawnSync("git", ["cat-file", "-e", `${parent}:${row.path}`], {
              cwd: root,
              stdio: "ignore",
            });
            if (exists.status === 0) {
              shared = true;
              break;
            }
          } else if (row.content !== undefined) {
            if (await commitHasExactLine(root, parent, row.path, row.content)) {
              shared = true;
              break;
            }
          }
        }
        const id = `${row.rule}\0${row.path}\0${row.content ?? ""}`;
        if (!shared && !reported.has(id)) {
          if (row.logOnly) logFinding(row.rule, row.path, row.line, commit, row.via);
          else {
            rows.push(row);
            if (row.rule !== "marker") logFinding(row.rule, row.path, row.line, commit);
            reported.add(id);
          }
        }
      }
    }
  } finally {
    await batch.close();
  }
  return outRows(rows, machine);
}

async function scanFiles(paths: string[], inert = false, spans = false): Promise<number> {
  if (paths.length === 0) fail("scrub-check", USAGE);
  const rows: Array<{
    path: string;
    line: number;
    rule: string;
    start?: number;
    end?: number;
    text?: string;
    index: number;
  }> = [];
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index]!;
    const context = await citationContext(path);
    const feed: KeyFeed = { keyState: false, scanner: new StreamScanner() };
    let lastLine = 0;
    try {
      for await (const line of streamLines(path)) {
        lastLine = line.number;
        const result = feedKeyLine(feed, line.number, line.text, {
          markers: !inert,
          context,
        });
        for (const f of result.findings) {
          rows.push({
            path,
            line: line.number,
            rule: f.rule,
            start: f.start,
            end: f.end,
            text: line.text,
            index,
          });
          logFinding(f.rule, path, line.number, "");
        }
        for (const f of result.suppressed) logFinding(f.rule, path, line.number, "", "marker");
        for (const marker of result.markers)
          rows.push({
            path,
            line: marker.line ?? line.number,
            rule: "marker",
            start: marker.start,
            end: marker.end,
            text: line.text,
            index,
          });
      }
      for (const marker of feed.scanner.flush())
        rows.push({
          path,
          line: marker.line ?? (lastLine || 1),
          rule: "marker",
          start: marker.start,
          end: marker.end,
          text: "",
          index,
        });
    } catch (error) {
      if (error instanceof RefusedError) fail("scrub-check", error.message);
      fail("scrub-check", `could not read ${safePath(path)}`);
    }
  }
  rows.sort(
    (a, b) =>
      a.index - b.index ||
      a.line - b.line ||
      (a.start ?? 0) - (b.start ?? 0) ||
      a.rule.localeCompare(b.rule),
  );
  for (const row of rows) {
    if (spans)
      console.log(
        `${row.index}:${row.line}:${codePointOffset(row.text ?? "", row.start ?? 0)}:${codePointOffset(row.text ?? "", row.end ?? 0)}:${row.rule}`,
      );
    else console.log(findingRow(row.path, row.line, row.rule));
  }
  return spans ? 0 : rows.length ? 1 : 0;
}

async function prDescription(path: string): Promise<number> {
  const rows: Array<{ line: number; rule: string }> = [];
  const feed: KeyFeed = { keyState: false, scanner: new StreamScanner() };
  try {
    for await (const line of streamLines(path)) {
      const result = feedKeyLine(feed, line.number, line.text, { markers: false });
      for (const f of result.findings) {
        rows.push({ line: line.number, rule: f.rule });
        logFinding(f.rule, "(pr-description)", line.number, "");
      }
    }
  } catch (error) {
    if (error instanceof RefusedError) fail("scrub-check", error.message);
    fail("scrub-check", `could not read ${safePath(path)}`);
  }
  rows.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  for (const row of rows) console.log(`(pr-description):${row.line}: ${row.rule}`);
  return rows.length ? 1 : 0;
}

function logOne(args: string[]): number {
  if (args.length < 3 || args.length > 4) fail("scrub-check", USAGE);
  const [rule, file, line, commit = ""] = args;
  if (!rule || !file || !/^[0-9]+$/u.test(line ?? "") || !/^(?:[0-9a-f]{40})?$/u.test(commit))
    fail("scrub-check", "invalid detection record");
  try {
    logFinding(rule, file, Number(line), commit);
  } catch {
    fail("scrub-check", "could not write detections log");
  }
  return 0;
}

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args[0] === "--files" || args[0] === "--files-inert")
    return scanFiles(args.slice(1), args[0] === "--files-inert");
  if (args[0] === "--spans") return scanFiles(args.slice(1), false, true);
  if (args[0] === "--pr-description" && args.length === 2) return prDescription(args[1]!);
  if (args[0] === "--safe-path" && args.length > 1) {
    for (const path of args.slice(1)) console.log(safePath(path));
    return 0;
  }
  if (args[0] === "--log-detection") return logOne(args.slice(1));
  const root = repositoryRoot();
  if (args[0] === "--findings" && args.length === 3)
    return rangeScan(
      root,
      args[1] === EMPTY_TREE ? EMPTY_TREE : resolveCommit(args[1]!, root),
      resolveCommit(args[2]!, root),
      true,
    );
  if (args.length === 2 && !args.some((arg) => arg.startsWith("--")))
    return rangeScan(
      root,
      args[0] === EMPTY_TREE ? EMPTY_TREE : resolveCommit(args[0]!, root),
      resolveCommit(args[1]!, root),
      false,
    );
  fail("scrub-check", USAGE);
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof RefusedError) {
      console.error(errorText("scrub-check", error.message));
      process.exit(2);
    }
    console.error("scrub-check: scan failed");
    process.exit(2);
  }
}

export { scanLine, streamLines, detectLine, decodeBytes, codePointOffset };
export { safePath } from "./scrub-report.ts";
