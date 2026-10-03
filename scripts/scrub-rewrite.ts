#!/usr/bin/env bun
// Rewrites unpushed history without findings that have already left the tip tree.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { git, repositoryRoot, resolveCommit, safePath } from "./scrub-core.ts";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const USAGE = "usage: scrub-rewrite.sh [<base> [<head>]] | --help";

interface Item { commit: string; path: string; line: number; rule: string }
interface CommitRow { commit: string; parents: string[] }
interface SuspectLine { sourceCommit: string; path: string; line: number; text: string }

class RewriteError extends Error {}
function fail(message: string): never { throw new RewriteError(`scrub-rewrite: ${message}`); }

function runCommand(command: string, args: string[], cwd: string, env: Record<string, string | undefined> = {}, input?: string) {
  return run(command, args, { cwd, env, ...(input === undefined ? {} : { input }) });
}

function fileTextAt(commit: string, path: string, root: string): string | null {
  const result = runCommand("git", ["show", `${commit}:${path}`], root);
  return result.code === 0 ? result.out : null;
}

function sourceLine(commit: string, path: string, line: number, root: string): string | null {
  const text = fileTextAt(commit, path, root);
  return text === null ? null : text.split(/\r?\n/u)[line - 1] ?? null;
}

function pushed(commit: string, root: string): boolean {
  const result = runCommand("git", ["for-each-ref", "--format=%(refname)", "--contains", commit, "refs/remotes"], root);
  return result.code !== 0 || result.out.trim().length > 0;
}

function headHasLine(path: string, text: string, root: string): boolean {
  const current = fileTextAt("HEAD", path, root);
  return current !== null && current.split(/\r?\n/u).some((line) => line === text);
}

function parseFindings(root: string, base: string, head: string): Item[] {
  const checker = resolve(import.meta.dir, "scrub-check.ts");
  const result = runCommand(process.execPath, ["--no-env-file", `--config=${resolve(import.meta.dir, "../bunfig.toml")}`, checker, "--findings", base, head], root, { POSTMASTER_DETECTIONS_LOG: "" });
  if (result.code !== 0 && result.code !== 1) fail("the range could not be scanned");
  try { return result.out.trim() ? result.out.trim().split("\n").map((line) => JSON.parse(line) as Item) : []; }
  catch { fail("the scanner returned unreadable findings"); }
}

function commitsInRange(root: string, base: string, head: string): CommitRow[] {
  const args = base === EMPTY_TREE ? ["rev-list", "--parents", "--reverse", "--topo-order", head] : ["rev-list", "--parents", "--reverse", "--topo-order", `${base}..${head}`];
  return git(args, root).toString("ascii").trim().split("\n").filter(Boolean).map((line) => {
    const [commit, ...parents] = pyWords(line);
    return { commit: commit!, parents };
  });
}

function ancestorSets(commits: CommitRow[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const row of commits) {
    const ancestors = new Set<string>([row.commit]);
    for (const parent of row.parents) {
      ancestors.add(parent);
      for (const ancestor of result.get(parent) ?? []) ancestors.add(ancestor);
    }
    result.set(row.commit, ancestors);
  }
  return result;
}

function treeHasPath(commit: string, path: string, root: string): boolean {
  return runCommand("git", ["cat-file", "-e", `${commit}:${path}`], root).code === 0;
}

function countLines(text: string, value: string): number {
  return text.split(/\r?\n/u).filter((line) => line === value).length;
}

function removeBranchCopies(text: string, values: Map<string, number>, baseHasPath: boolean): { text: string; changed: boolean; empty: boolean } {
  const ending = text.match(/\r?\n/u)?.[0] ?? "\n";
  const trailing = text.endsWith("\n");
  const lines = text.split(/\r?\n/u);
  if (trailing) lines.pop();
  const seen = new Map<string, number>();
  let changed = false;
  const kept = lines.filter((line) => {
    const originalCount = values.get(line);
    if (originalCount === undefined) return true;
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    if (count > originalCount) { changed = true; return false; }
    return true;
  });
  const empty = kept.length === 0 && !baseHasPath;
  const rewritten = kept.join(ending) + (trailing && kept.length ? ending : "");
  return { text: rewritten, changed, empty };
}

function safeHistoryName(path: string): string {
  const id = createHash("sha256").update(path).digest("hex").slice(0, 20);
  return `scrubbed-history-${id}.txt`;
}

function originalCommitMetadata(commit: string, root: string): { authorName: string; authorEmail: string; authorDate: string; committerName: string; committerEmail: string; committerDate: string; message: string } {
  const fields = git(["show", "-s", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI", commit], root).toString("utf8").replace(/\n$/u, "").split("\0");
  if (fields.length !== 6) fail("the original history could not be read");
  return {
    authorName: fields[0]!, authorEmail/*split*/: fields[1]!, authorDate: fields[2]!,
    committerName: fields[3]!, committerEmail/*split*/: fields[4]!, committerDate: fields[5]!,
    message: git(["show", "-s", "--format=%B", commit], root).toString("utf8"),
  };
}

function createCommit(root: string, tree: string, parents: string[], original: string, indexFile: string): string {
  const metadata = originalCommitMetadata(original, root);
  const args = ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])];
  const result = runCommand("git", args, root, {
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: metadata.authorName,
    GIT_AUTHOR_EMAIL: metadata.authorEmail,
    GIT_AUTHOR_DATE: metadata.authorDate,
    GIT_COMMITTER_NAME: metadata.committerName,
    GIT_COMMITTER_EMAIL: metadata.committerEmail,
    GIT_COMMITTER_DATE: metadata.committerDate,
  }, metadata.message);
  if (result.code !== 0 || !/^[0-9a-f]{40}\n?$/u.test(result.out)) fail("a rewritten commit could not be created");
  return result.out.trim();
}

function applySnapshot(root: string, row: CommitRow, ancestors: Set<string>, lines: SuspectLine[], namePaths: Map<string, Set<string>>, base: string, indexFile: string): string {
  const loaded = runCommand("git", ["read-tree", "--reset", "-u", `${row.commit}^{tree}`], root, { GIT_INDEX_FILE: indexFile });
  if (loaded.code !== 0) fail("the original tree could not be read");
  const changedPaths = new Set<string>();
  const byPath = new Map<string, Map<string, number>>();
  for (const finding of lines) {
    if (!ancestors.has(finding.sourceCommit)) continue;
    const baseCount = countLines(fileTextAt(base, finding.path, root) ?? "", finding.text);
    const values = byPath.get(finding.path) ?? new Map<string, number>();
    values.set(finding.text, Math.max(values.get(finding.text) ?? 0, baseCount));
    byPath.set(finding.path, values);
  }
  for (const [path, values] of byPath) {
    const original = fileTextAt(row.commit, path, root);
    if (original === null) continue;
    const baseHasPath = treeHasPath(base, path, root);
    const changed = removeBranchCopies(original, values, baseHasPath);
    if (!changed.changed) continue;
    const target = join(root, path);
    if (changed.empty) unlinkSync(target);
    else writeFileSync(target, changed.text, "utf8");
    changedPaths.add(path);
  }
  for (const [path, sourceCommits] of namePaths) {
    if (![...sourceCommits].some((commit) => ancestors.has(commit))) continue;
    if (!treeHasPath(row.commit, path, root)) continue;
    const target = safeHistoryName(path);
    if (existsSync(join(root, target))) fail("the history rewrite needs a manual path resolution");
    renameSync(join(root, path), join(root, target));
    changedPaths.add(path);
    changedPaths.add(target);
  }
  if (changedPaths.size) {
    const staged = runCommand("git", ["add", "-A", "--", ...changedPaths], root, { GIT_INDEX_FILE: indexFile });
    if (staged.code !== 0) fail("the rewritten tree could not be staged");
  }
  const tree = runCommand("git", ["write-tree"], root, { GIT_INDEX_FILE: indexFile });
  if (tree.code !== 0 || !/^[0-9a-f]{40}\n?$/u.test(tree.out)) fail("the rewritten tree could not be written");
  return tree.out.trim();
}

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { console.error(USAGE); return 0; }
  if (args.length > 2) fail(USAGE);
  const root = repositoryRoot();
  const base = args[0] === EMPTY_TREE ? EMPTY_TREE : resolveCommit(args[0] ?? "origin/main", root);
  const head = resolveCommit(args[1] ?? "HEAD", root);
  if (head !== resolveCommit("HEAD", root)) fail("the rewrite head must be the checked out commit");
  if (resolve(".") !== root) fail("run from the repository root");
  if (git(["status", "--porcelain", "--untracked-files=no"], root).toString("utf8").trim()) fail("the tracked worktree must be clean");
  const branch = runCommand("git", ["symbolic-ref", "-q", "HEAD"], root);
  if (branch.code !== 0 || !branch.out.trim()) fail("the rewrite requires a checked out branch");
  const rows = commitsInRange(root, base, head);
  if (!rows.length) return 0;
  const found = parseFindings(root, base, head);
  if (!found.length) return 0;
  const rowByCommit = new Map(rows.map((row) => [row.commit, row]));
  const findingsByCommit = new Map<string, Item[]>();
  for (const item of found) {
    const commit = rowByCommit.get(item.commit);
    if (!commit) fail("a finding is outside the rewrite range");
    if (commit.parents.length > 1) fail(`a finding in merge ${item.commit} needs a manual merge`);
    if (item.path.startsWith("(")) fail(`a finding in ${item.path} needs a manual reword`);
    if (pushed(item.commit, root)) fail(`commit ${item.commit} is already pushed`);
    (findingsByCommit.get(item.commit) ?? findingsByCommit.set(item.commit, []).get(item.commit)!).push(item);
  }
  const originalTree = git(["rev-parse", `${head}^{tree}`], root).toString("ascii").trim();
  const suspects: SuspectLine[] = [];
  const namePaths = new Map<string, Set<string>>();
  for (const item of found) {
    if (item.line === 0) {
      (namePaths.get(item.path) ?? namePaths.set(item.path, new Set()).get(item.path)!).add(item.commit);
      if (treeHasPath(head, item.path, root)) fail(`the file name ${safePath(item.path)} remains in the final tree`);
      continue;
    }
    const text = sourceLine(item.commit, item.path, item.line, root);
    if (text === null) fail("the finding could not be read");
    if (headHasLine(item.path, text, root)) fail(`a finding in ${safePath(item.path)} remains in the final tree`);
    suspects.push({ sourceCommit: item.commit, path: item.path, line: item.line, text });
  }
  const ancestors = ancestorSets(rows);
  const indexFile = join(root, ".postmaster", "verify", `scrub-index-${randomBytes(8).toString("hex")}`);
  mkdirSync(dirname(indexFile), { recursive: true });
  const rewritten = new Map<string, string>();
  try {
    for (const row of rows) {
      const oldParents = row.parents.length ? row.parents : [EMPTY_TREE];
      const newParents = oldParents.map((parent) => rewritten.get(parent) ?? parent);
      const tree = applySnapshot(root, row, ancestors.get(row.commit)!, suspects, namePaths, base, indexFile);
      const parentTree = newParents.length ? git(["rev-parse", `${newParents[0]}^{tree}`], root).toString("ascii").trim() : EMPTY_TREE;
      const oldTree = git(["rev-parse", `${row.commit}^{tree}`], root).toString("ascii").trim();
      const oldParentTree = oldParents[0] === EMPTY_TREE ? EMPTY_TREE : git(["rev-parse", `${oldParents[0]}^{tree}`], root).toString("ascii").trim();
      if (oldTree === oldParentTree) fail(`commit ${row.commit} is an intentional empty commit`);
      if (tree === parentTree && findingsByCommit.has(row.commit)) rewritten.set(row.commit, newParents[0]!);
      else rewritten.set(row.commit, createCommit(root, tree, newParents, row.commit, indexFile));
    }
    const newHead = rewritten.get(head);
    if (!newHead) fail("the rewritten head could not be found");
    const changedRef = runCommand("git", ["update-ref", branch.out.trim(), newHead, head], root);
    if (changedRef.code !== 0) fail("the branch could not be updated");
    const reset = runCommand("git", ["reset", "--hard", newHead], root);
    if (reset.code !== 0) {
      runCommand("git", ["update-ref", branch.out.trim(), head, newHead], root);
      fail("the branch could not be checked out");
    }
    if (git(["rev-parse", "HEAD^{tree}"], root).toString("ascii").trim() !== originalTree) {
      runCommand("git", ["update-ref", branch.out.trim(), head, newHead], root);
      runCommand("git", ["reset", "--hard", head], root);
      fail("the history rewrite changed the final tree");
    }
    const remaining = parseFindings(root, base, "HEAD");
    if (remaining.length) {
      runCommand("git", ["update-ref", branch.out.trim(), head, newHead], root);
      runCommand("git", ["reset", "--hard", head], root);
      fail("the rewritten history still has findings");
    }
  } catch (error) {
    const current = runCommand("git", ["rev-parse", "HEAD"], root).out.trim();
    if (current !== head && current === rewritten.get(head)) {
      runCommand("git", ["update-ref", branch.out.trim(), head, current], root);
      runCommand("git", ["reset", "--hard", head], root);
    } else {
      runCommand("git", ["reset", "--hard", head], root);
    }
    if (error instanceof RewriteError) throw error;
    fail("history rewrite failed; the branch was restored");
  } finally {
    try { unlinkSync(indexFile); } catch { /* index may not have been created */ }
  }
  for (const item of found) console.log(`${item.commit}:${safePath(item.path)}:${item.line}: ${item.rule} removed`);
  return 0;
}

if (import.meta.main) {
  try { process.exit(await main(process.argv.slice(2))); }
  catch (error) {
    console.error(error instanceof RewriteError ? error.message : "scrub-rewrite: history rewrite failed");
    process.exit(2);
  }
}
