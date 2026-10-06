#!/usr/bin/env bun
// Checks the private run folder and new raw records in a project change.
import {
  childLines,
  decodeChildText,
  git,
  keyBlockStep,
  resolveCommit,
  runGit,
  StreamScanner,
} from "./scrub-core.ts";
import { pyWords } from "./lib/text.ts";
import { hasReasoning } from "./scrub-reasoning.ts";
import { fail, findingRow, logFinding, safePath } from "./scrub-report.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const USAGE = "usage: tree-check.sh [<base> [<head>]] | --help";
// Read lazily, like the core's set: main sheds the test hook first.
let DISABLED: Set<string> | null = null;
function disabled(rule: string): boolean {
  DISABLED ??= new Set(
    (process.env.SCRUB_CHECK_DISABLE ?? "").replaceAll(",", " ").split(" ").filter(Boolean),
  );
  return DISABLED.has(rule);
}

async function scanBlob(
  root: string,
  object: string,
  path: string,
  commit: string,
): Promise<string[]> {
  const child = runGit(["show", object], root);
  if (!child.stdout) fail("tree-check", "the tree could not be read");
  // The close listener goes on before the first read: a small blob's git
  // exits before the drain ends, and a listener attached after misses it.
  const closed = new Promise<number>((resolve) => {
    child.once("close", (value) => resolve(value ?? 1));
    child.once("error", () => resolve(1));
  });
  const scanner = new StreamScanner();
  const failures: string[] = [];
  let line = 0;
  let inBlock = false;
  for await (const raw of childLines(child.stdout)) {
    line++;
    const text = decodeChildText(raw);
    if (!disabled("encrypted-reasoning")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (hasReasoning(parsed)) {
          failures.push(findingRow(path, line, "encrypted-reasoning"));
          logFinding("encrypted-reasoning", path, line, commit);
        }
      } catch {
        /* non-JSON raw records are scanned as text */
      }
    }
    const key = keyBlockStep(text, inBlock);
    inBlock = key.inBlock;
    const result = scanner.feed(line, text, { keyBlock: key.flagged });
    for (const f of result.findings) {
      failures.push(findingRow(path, line, f.rule));
      if (f.rule !== "marker") logFinding(f.rule, path, line, commit);
    }
    for (const f of result.suppressed) logFinding(f.rule, path, line, commit, "marker");
    for (const marker of result.markers) failures.push(findingRow(path, line, "marker"));
  }
  for (const marker of scanner.flush()) failures.push(findingRow(path, line || 1, "marker"));
  const status = await closed;
  if (status !== 0) fail("tree-check", "the tree could not be read");
  return failures;
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

export async function checkTree(root: string, base: string, head: string): Promise<number> {
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
        if ((item.status === "A" || item.status === "M") && item.path.startsWith("raw/"))
          rawScans.push({ commit, path: item.path });
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
    if ((status === "A" || status === "M") && path.startsWith("raw/"))
      rawScans.push({ commit: "", path });
  }
  const failures: string[] = [];
  for (const [path, commit] of privatePaths)
    failures.push(
      `${safePath(path)}: ${commit === "staged" ? "staged" : "committed under .postmaster/"}`,
    );
  for (const { commit, path } of rawScans) {
    const nameFindings = await import("./scrub-core.ts").then((m) => m.detectLine(path));
    for (const finding of nameFindings) {
      failures.push(findingRow(path, 0, finding.rule));
      logFinding(finding.rule, path, 0, commit);
    }
    const object = commit ? `${commit}:${path}` : `:${path}`;
    failures.push(...(await scanBlob(root, object, path, commit)));
  }
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
  if (args.length > 2) fail("tree-check", USAGE);
  const root = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const base = args[0] ? resolveCommit(args[0], root) : resolveCommit("origin/main", root);
  const head = args[1] ? resolveCommit(args[1], root) : resolveCommit("HEAD", root);
  return checkTree(root, base, head);
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch {
    console.error("tree-check: the tree could not be read");
    process.exit(2);
  }
}
