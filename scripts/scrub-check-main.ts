#!/usr/bin/env bun
// Range and file scanner for content a run is about to publish.
import { spawnSync } from "node:child_process";
import { PY_S_CLASS, pyLower, pyWords } from "./lib/text.ts";
import {
  childLines,
  codePointOffset,
  decodeBytes,
  detectLine,
  git,
  keyBlockStep,
  logFinding,
  repositoryRoot,
  resolveCommit,
  runGit,
  safePath,
  scanLine,
  StreamScanner,
  streamLines,
} from "./scrub-core.ts";

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

function safeError(message: string): never {
  console.error(`scrub-check: ${message}`);
  process.exit(2);
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
  } catch {
    safeError(`could not read ${safePath(path)}`);
  }
  return title && source ? "title: citation\nurl: citation" : "";
}

async function citationContextAt(commit: string, path: string, root: string): Promise<string> {
  if (!pyLower(path).endsWith(".md")) return "";
  const child = runGit(["show", `${commit}:${path}`], root);
  if (!child.stdout) return "";
  let frontmatter = false;
  let ended = false;
  let title = false;
  let source = false;
  const closed = new Promise<number>((resolve) =>
    child.once("close", (code) => resolve(code ?? 1)),
  );
  try {
    for await (const text of childLines(child.stdout)) {
      if (ended) continue;
      if (!frontmatter) {
        if (text.trim() === "---") frontmatter = true;
        else ended = true;
        continue;
      }
      if (text.trim() === "---") {
        ended = true;
        continue;
      }
      if (new RegExp(`^[${PY_S_CLASS}]*title[${PY_S_CLASS}]*:`, "iu").test(text)) title = true;
      if (
        new RegExp(`^[${PY_S_CLASS}]*(?:url|doi|retrieved|arxiv)[${PY_S_CLASS}]*:`, "iu").test(text)
      )
        source = true;
    }
  } catch {
    return "";
  }
  const status = await closed;
  if (status !== 0) safeError("the requested history could not be read");
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
    else console.log(`${row.commit}:${safePath(row.path)}:${row.line}: ${row.rule}`);
  }
  return rows.length ? 1 : 0;
}

async function keyBlockLines(commit: string, path: string, root: string): Promise<Set<number>> {
  const child = runGit(["show", `${commit}:${path}`], root);
  if (!child.stdout) safeError("the requested history could not be read");
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  const result = new Set<number>();
  let inBlock = false;
  let number = 0;
  for await (const line of childLines(child.stdout)) {
    number++;
    const step = keyBlockStep(line, inBlock);
    inBlock = step.inBlock;
    if (step.flagged) result.add(number);
  }
  const code = await closed;
  if (code !== 0) safeError("the requested history could not be read");
  return result;
}

function parseHunk(line: string): number | null {
  const match = /^@@ [^ ]+ \+([0-9]+)(?:,[0-9]+)? @@/u.exec(line);
  return match ? Number(match[1]) : null;
}

async function scanCommitDiff(root: string, parent: string, commit: string): Promise<FindingRow[]> {
  const added = git(
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "--no-renames",
      "-z",
      parent,
      commit,
      "--",
    ],
    root,
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const nameRows: FindingRow[] = [];
  for (let i = 0; i + 1 < added.length; i += 2) {
    if (added[i] !== "A") continue;
    const path = added[i + 1]!;
    for (const finding of detectLine(path))
      nameRows.push({ commit, path, line: 0, rule: finding.rule, content: path });
  }
  const child = runGit(
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--text",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--unified=0",
      "--no-prefix",
      parent,
      commit,
      "--",
    ],
    root,
  );
  if (!child.stdout) safeError("the requested history could not be read");
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  const rows: FindingRow[] = nameRows;
  let path = "";
  let newFile = false;
  let lineNumber: number | null = null;
  let scanner = new StreamScanner();
  let keyLines: Set<number> | null = null;
  let keyState = false;
  let context = "";
  for await (const line of childLines(child.stdout)) {
    if (line.startsWith("diff --git ")) {
      for (const marker of scanner.flush())
        rows.push({
          commit,
          path,
          line: marker.line ?? Math.max(1, (lineNumber ?? 1) - 1),
          rule: "marker",
        });
      scanner = new StreamScanner();
      path = "";
      lineNumber = null;
      newFile = false;
      keyLines = null;
      keyState = false;
      context = "";
      continue;
    }
    if (line.startsWith("--- ") && lineNumber === null) {
      newFile = line.slice(4) === "/dev/null";
      continue;
    }
    if (line.startsWith("+++ ") && lineNumber === null) {
      path = line.slice(4);
      if (path !== "/dev/null") context = await citationContextAt(commit, path, root);
      continue;
    }
    if (line.startsWith("@@ ")) {
      lineNumber = parseHunk(line);
      continue;
    }
    if (lineNumber === null || !line.startsWith("+")) continue;
    const text = line.slice(1);
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
  for (const marker of scanner.flush())
    rows.push({
      commit,
      path,
      line: marker.line ?? Math.max(1, (lineNumber ?? 1) - 1),
      rule: "marker",
    });
  const code = await closed;
  if (code !== 0) safeError("the requested history could not be read");
  return rows;
}

async function scanTextBlock(commit: string, place: string, raw: string): Promise<FindingRow[]> {
  const rows: FindingRow[] = [];
  let keyState = false;
  const scanner = new StreamScanner();
  const lines = raw.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const key = keyBlockStep(text, keyState);
    keyState = key.inBlock;
    const result = scanner.feed(i + 1, text, { keyBlock: key.flagged, markers: false });
    for (const finding of result.findings)
      rows.push({ commit, path: place, line: i + 1, rule: finding.rule });
  }
  for (const marker of scanner.flush())
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
    if (treeExists.status !== 0) safeError("the requested history could not be read");
    return false;
  }
  const child = runGit(["show", `${commit}:${path}`], root);
  if (!child.stdout) safeError("the requested history could not be read");
  let found = false;
  for await (const line of childLines(child.stdout)) if (line === expected) found = true;
  const code = await new Promise<number>((resolve) =>
    child.once("close", (value) => resolve(value ?? 1)),
  );
  if (code !== 0) safeError("the requested history could not be read");
  return found;
}

async function scanIdentities(root: string, commit: string): Promise<FindingRow[]> {
  const raw = git(["show", "-s", "--format=%an <%ae>%n%cn <%ce>", commit], root)
    .toString("utf8")
    .split(/\r?\n/u);
  const names: Array<[string, string]> = [
    ["(author)", raw[0] ?? ""],
    ["(committer)", raw[1] ?? ""],
  ];
  const rows: FindingRow[] = [];
  for (const [place, text] of names) {
    const found = await scanTextBlock(commit, place, text);
    rows.push(...found);
  }
  return rows;
}

async function rangeScan(
  root: string,
  base: string,
  head: string,
  machine: boolean,
): Promise<number> {
  const revArgs =
    base === EMPTY_TREE
      ? ["rev-list", "--parents", "--reverse", head]
      : ["rev-list", "--parents", "--reverse", `${base}..${head}`];
  const commits = git(revArgs, root)
    .toString("ascii")
    .trim()
    .split(/\n/u)
    .filter(Boolean)
    .map((line) => {
      const [commit, ...parents] = pyWords(line);
      return { commit: commit!, parents };
    });
  const rows: FindingRow[] = [];
  const reported = new Set<string>();
  for (const { commit, parents } of commits) {
    const message = git(["show", "-s", "--format=%B", commit], root).toString("utf8");
    if (!disabled.has("messages")) {
      const messageRows = await scanTextBlock(commit, "(message)", message);
      rows.push(...messageRows);
      for (const row of messageRows)
        if (row.rule !== "marker") logFinding(row.rule, row.path, row.line, commit);
    }
    const identityRows = await scanIdentities(root, commit);
    rows.push(...identityRows);
    for (const row of identityRows) logFinding(row.rule, row.path, row.line, commit);
    if (parents.length > 1) continue;
    const parent = parents[0] ?? EMPTY_TREE;
    const found = await scanCommitDiff(root, parent, commit);
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
  for (const { commit, parents } of commits) {
    if (parents.length < 2 || disabled.has("merges")) continue;
    const first = parents[0]!;
    const found = await scanCommitDiff(root, first, commit);
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
  return outRows(rows, machine);
}

async function scanFiles(paths: string[], inert = false, spans = false): Promise<number> {
  if (paths.length === 0) safeError(USAGE);
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
    let scanner = new StreamScanner();
    let keyState = false;
    let lastLine = 0;
    try {
      for await (const line of streamLines(path)) {
        lastLine = line.number;
        const step = keyBlockStep(line.text, keyState);
        keyState = step.inBlock;
        const result = scanner.feed(line.number, line.text, {
          markers: !inert,
          keyBlock: step.flagged,
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
      for (const marker of scanner.flush())
        rows.push({
          path,
          line: marker.line ?? (lastLine || 1),
          rule: "marker",
          start: marker.start,
          end: marker.end,
          text: "",
          index,
        });
    } catch {
      safeError(`could not read ${safePath(path)}`);
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
    else console.log(`${safePath(row.path)}:${row.line}: ${row.rule}`);
  }
  return spans ? 0 : rows.length ? 1 : 0;
}

async function prDescription(path: string): Promise<number> {
  const rows: Array<{ line: number; rule: string }> = [];
  try {
    for await (const line of streamLines(path)) {
      const result = scanLine(line.text, { markers: false });
      for (const f of result.findings) {
        rows.push({ line: line.number, rule: f.rule });
        logFinding(f.rule, "(pr-description)", line.number, "");
      }
    }
  } catch {
    safeError(`could not read ${safePath(path)}`);
  }
  rows.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  for (const row of rows) console.log(`(pr-description):${row.line}: ${row.rule}`);
  return rows.length ? 1 : 0;
}

function logOne(args: string[]): number {
  if (args.length < 3 || args.length > 4) safeError(USAGE);
  const [rule, file, line, commit = ""] = args;
  if (!rule || !file || !/^[0-9]+$/u.test(line ?? "") || !/^(?:[0-9a-f]{40})?$/u.test(commit))
    safeError("invalid detection record");
  try {
    logFinding(rule, file, Number(line), commit);
  } catch {
    safeError("could not write detections log");
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
  safeError(USAGE);
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch {
    console.error("scrub-check: scan failed");
    process.exit(2);
  }
}

export { scanLine, streamLines, detectLine, safePath, decodeBytes, codePointOffset };
