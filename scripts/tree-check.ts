#!/usr/bin/env bun
// Checks the private run folder and new raw records in a project change.
import {
  childLines,
  git,
  keyBlockStep,
  RefusedError,
  refuseUnlessText,
  resolveCommit,
  runGit,
  StreamScanner,
} from "./scrub-core.ts";
import { pyWords } from "./lib/text.ts";
import {
  firstNonWsChar,
  hasReasoning,
  maybeWholeJson,
  parseWholeJson,
  WHOLE_JSON_CAP,
} from "./scrub-reasoning.ts";
import { errorText, fail, findingRow, logFinding, safePath } from "./scrub-report.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const USAGE = "usage: run tree-check [<base> [<head>]] | --findings <base> <head> | --help";
// Read lazily, like the core's set: main sheds the test hook first.
let DISABLED: Set<string> | null = null;
function disabled(rule: string): boolean {
  DISABLED ??= new Set(
    (process.env.SCRUB_CHECK_DISABLE ?? "").replaceAll(",", " ").split(" ").filter(Boolean),
  );
  return DISABLED.has(rule);
}

interface BlobRow {
  line: number;
  rule: string;
  // A spanning record flags at line 1 in text; the listing expands it to
  // every line so a line-based consumer removes the whole record.
  span?: number;
}

async function scanBlob(
  root: string,
  object: string,
  path: string,
  commit: string,
): Promise<BlobRow[]> {
  const child = runGit(["show", object], root);
  if (!child.stdout) fail("tree-check", "the tree could not be read");
  // The close listener goes on before the first read: a small blob's git
  // exits before the drain ends, and a listener attached after misses it.
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  const scanner = new StreamScanner();
  const rows: BlobRow[] = [];
  let line = 0;
  let inBlock = false;
  // The whole-file accumulation the promoter's re-read mirrors: kept only
  // while the blob can still parse whole, and bounded by the shared cap.
  let whole: string[] | null = [];
  let wholeSize = 0;
  let firstNonWs = "";
  let anyParseFail = false;
  for await (const raw of childLines(child.stdout)) {
    line++;
    refuseUnlessText(raw, path);
    const text = raw;
    if (whole !== null) {
      if (!firstNonWs) {
        const found = firstNonWsChar(text);
        if (found) {
          firstNonWs = found;
          if (firstNonWs !== "{" && firstNonWs !== "[") whole = null;
        }
      }
      if (whole !== null) {
        wholeSize += text.length + 1;
        if (wholeSize > WHOLE_JSON_CAP) whole = null;
        else whole.push(text);
      }
    }
    if (!disabled("encrypted-reasoning")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (hasReasoning(parsed)) {
          rows.push({ line, rule: "encrypted-reasoning" });
          logFinding("encrypted-reasoning", path, line, commit);
        }
      } catch {
        anyParseFail = true;
        // A prose line can embed reasoning JSON without parsing whole; the
        // shared string walk visits the same spans the promoter scrubs.
        if (hasReasoning(text)) {
          rows.push({ line, rule: "encrypted-reasoning" });
          logFinding("encrypted-reasoning", path, line, commit);
        }
      }
    }
    const key = keyBlockStep(text, inBlock);
    inBlock = key.inBlock;
    const result = scanner.feed(line, text, { keyBlock: key.flagged });
    for (const f of result.findings) {
      rows.push({ line, rule: f.rule });
      if (f.rule !== "marker") logFinding(f.rule, path, line, commit);
    }
    for (const f of result.suppressed) logFinding(f.rule, path, line, commit, "marker");
    for (const _marker of result.markers) rows.push({ line, rule: "marker" });
  }
  if (
    !disabled("encrypted-reasoning") &&
    whole !== null &&
    maybeWholeJson(line, firstNonWs, anyParseFail)
  ) {
    // Review round 9 (bug-36): the same whole-file entry the promoter
    // scrubs through. A spanning record flags at line 1, where it starts.
    const parsed = parseWholeJson(whole.join("\n"));
    if (parsed !== undefined && hasReasoning(parsed)) {
      rows.push({ line: 1, rule: "encrypted-reasoning", span: line });
      logFinding("encrypted-reasoning", path, 1, commit);
    }
  }
  for (const _marker of scanner.flush()) rows.push({ line: line || 1, rule: "marker" });
  const status = await closed;
  if (status !== 0) fail("tree-check", "the tree could not be read");
  return rows;
}

function blobId(root: string, rev: string, path: string): string | null {
  try {
    const id = git(["rev-parse", "--verify", `${rev}:${path}`], root)
      .toString("ascii")
      .trim();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

// Statuses whose new blob must scan, shared by the committed and staged
// intakes so they cannot split again. A and M carry new content; T
// (typechange) carries a new blob behind the same path. D removes
// content, so there is nothing to scan. U has no staged blob and git
// blocks the commit, so there is nothing to scan and nothing to
// refuse. R and C never appear (--no-renames is pinned, --find-copies
// is never passed), and X and B are not produced; the rename test
// pins the flags by failing if a rename ever surfaces as R. Both
// intakes use --name-status, so only single letters occur and the
// two-letter unmerged forms never appear.
// Review round 11 (bug-58).
function scansNewBlob(status: string): boolean {
  return status === "A" || status === "M" || status === "T";
}

function commitPaths(
  root: string,
  parent: string,
  commit: string,
): Array<{ status: string; path: string }> {
  const raw = git(
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
  const result: Array<{ status: string; path: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) result.push({ status: raw[i]!, path: raw[i + 1]! });
  return result;
}

interface TreeRow {
  commit: string;
  path: string;
  line: number;
  rule: string;
  span?: number;
}

export async function checkTree(
  root: string,
  base: string,
  head: string,
  findings = false,
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
  const privatePaths = new Map<string, string>();
  const rawScans: Array<{ commit: string; path: string }> = [];
  for (const { commit, parents } of commits) {
    const compare = parents.length ? parents : [EMPTY_TREE];
    for (const parent of compare) {
      for (const item of commitPaths(root, parent, commit)) {
        if (item.path.startsWith(".postmaster/") && item.path !== ".postmaster/project.toml")
          privatePaths.set(item.path, commit);
        // Additions and modifications alike: an edit can smuggle reasoning
        // into a record the promoter already wrote.
        if (scansNewBlob(item.status) && item.path.startsWith("raw/")) {
          // A merge repeats the other side's delta against each parent; a blob
          // identical to the range base already landed and is not new content.
          // Unresolvable blobs scan, so the comparison only skips known-same.
          const commitId = blobId(root, commit, item.path);
          const baseId = base === EMPTY_TREE ? null : blobId(root, base, item.path);
          if (commitId === null || baseId === null || commitId !== baseId)
            rawScans.push({ commit, path: item.path });
        }
      }
    }
  }
  const staged = git(
    ["-c", "core.quotePath=false", "diff", "--cached", "--name-status", "--no-renames", "-z", "--"],
    root,
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (let i = 0; i + 1 < staged.length; i += 2) {
    const status = staged[i]!;
    const path = staged[i + 1]!;
    if (path.startsWith(".postmaster/") && path !== ".postmaster/project.toml")
      privatePaths.set(path, "staged");
    if (scansNewBlob(status) && path.startsWith("raw/")) rawScans.push({ commit: "", path });
  }
  // One detection, two renderings: text rows print as before and the
  // findings listing carries the same rows structured, so a history
  // rewrite (#423) plans from exactly what the detector reports.
  // Review round 11 (bug-59).
  const rows: TreeRow[] = [];
  for (const [path, commit] of privatePaths)
    rows.push({
      commit: commit === "staged" ? "" : commit,
      path,
      line: 0,
      rule: "private-record",
    });
  for (const { commit, path } of rawScans) {
    const nameFindings = await import("./scrub-core.ts").then((m) => m.detectLine(path));
    for (const finding of nameFindings) {
      rows.push({ commit, path, line: 0, rule: finding.rule });
      logFinding(finding.rule, path, 0, commit);
    }
    const object = commit ? `${commit}:${path}` : `:${path}`;
    for (const row of await scanBlob(root, object, path, commit))
      rows.push({ commit, path, line: row.line, rule: row.rule, span: row.span });
  }
  if (findings) {
    const listed: Array<{ commit: string; path: string; line: number; rule: string }> = [];
    for (const row of rows) {
      // A spanning record expands to every line it covers: a history
      // rewrite (#423) removes lines, and removing one line of a record
      // would leave the value behind in pieces.
      const last = row.span ?? row.line;
      for (let line = row.line; line <= last; line++)
        listed.push({ commit: row.commit, path: row.path, line, rule: row.rule });
    }
    listed.sort((a, b) =>
      `${a.commit}\0${a.path}\0${a.line}\0${a.rule}` <
      `${b.commit}\0${b.path}\0${b.line}\0${b.rule}`
        ? -1
        : 1,
    );
    for (const row of listed) console.log(JSON.stringify(row));
    return listed.length ? 1 : 0;
  }
  const failures = rows.map((row) =>
    row.rule === "private-record"
      ? `${safePath(row.path)}: ${row.commit ? "committed under .postmaster/" : "staged"}`
      : findingRow(row.path, row.line, row.rule),
  );
  failures.sort();
  for (const line of failures) console.log(line);
  return failures.length ? 1 : 0;
}

async function main(args: string[]): Promise<number> {
  // A production entrypoint: shed the test hook before the first scan.
  delete process.env.SCRUB_CHECK_DISABLE;
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args[0] === "--findings" && args.length === 3) {
    const root = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    return checkTree(
      root,
      args[1] === EMPTY_TREE ? EMPTY_TREE : resolveCommit(args[1]!, root),
      resolveCommit(args[2]!, root),
      true,
    );
  }
  if (args.length > 2) fail("tree-check", USAGE);
  const root = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const base = args[0] ? resolveCommit(args[0], root) : resolveCommit("origin/main", root);
  const head = args[1] ? resolveCommit(args[1], root) : resolveCommit("HEAD", root);
  return checkTree(root, base, head);
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof RefusedError) {
      console.error(errorText("tree-check", error.message));
      process.exit(2);
    }
    console.error("tree-check: the tree could not be read");
    process.exit(2);
  }
}
