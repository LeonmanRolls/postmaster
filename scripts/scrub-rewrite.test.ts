import { afterEach, expect, test } from "bun:test";
import { readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupScratch,
  commit,
  email,
  gitAt,
  initRepo,
  runScript,
  scratchDir,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

function addThenDelete(removeFile = false): { repo: string; base: string; tree: string } {
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "notes.txt"), email());
  commit(repo, "add temporary note");
  if (removeFile) gitAt(repo, ["rm", "-q", "notes.txt"]);
  else writeFileSync(join(repo, "notes.txt"), "clean\n");
  commit(repo, "remove temporary note");
  return { repo, base, tree: gitAt(repo, ["rev-parse", "HEAD^{tree}"]) };
}

test("C17 rewrite removes an earlier-only finding and preserves the final tree", () => {
  const { repo, base, tree } = addThenDelete();
  const rewritten = runScript("scrub-rewrite", [base], repo);
  expect(rewritten.status).toBe(0);
  expect(rewritten.stdout.trim().split("\n")).toHaveLength(1);
  expect(rewritten.stdout).toContain(":notes.txt:1: email removed");
  expect(rewritten.stdout.includes(email())).toBe(false);
  expect(gitAt(repo, ["rev-parse", "HEAD^{tree}"])).toBe(tree);
  const clean = runScript("scrub-check", [base, "HEAD"], repo);
  expect(clean.status).toBe(0);
  expect(clean.stdout).toBe("");
});

test("C17 rewrite also drops an introduced file later deleted from the branch", () => {
  const { repo, base, tree } = addThenDelete(true);
  const rewritten = runScript("scrub-rewrite", [base], repo);
  expect(rewritten.status).toBe(0);
  expect(rewritten.stdout.trim().split("\n")).toHaveLength(1);
  expect(gitAt(repo, ["rev-parse", "HEAD^{tree}"])).toBe(tree);
  expect(runScript("scrub-check", [base, "HEAD"], repo).status).toBe(0);
});

test("C18 rewrite refuses any finding in a commit already pushed and preserves HEAD", () => {
  const { repo, base } = addThenDelete();
  const bare = join(scratchDir(), "remote.git");
  gitAt(repo, ["init", "-q", "--bare", bare]);
  gitAt(repo, ["remote", "add", "origin", bare]);
  gitAt(repo, ["push", "-qu", "origin", "main"]);
  gitAt(repo, ["fetch", "-q", "origin"]);
  const head = gitAt(repo, ["rev-parse", "HEAD"]);
  const refused = runScript("scrub-rewrite", [base], repo);
  expect(refused.status).toBe(2);
  expect(refused.stdout + refused.stderr).toContain("already pushed");
  expect(refused.stdout + refused.stderr).not.toContain(email());
  expect(gitAt(repo, ["rev-parse", "HEAD"])).toBe(head);
});

test("rewrite still removes the finding when SCRUB_CHECK_DISABLE hides email", () => {
  // Review round 1: the rewrite's scan inherited SCRUB_CHECK_DISABLE and silently kept history.
  const { repo, base, tree } = addThenDelete();
  const rewritten = runScript("scrub-rewrite", [base], repo, { SCRUB_CHECK_DISABLE: "email" });
  expect(rewritten.status).toBe(0);
  expect(rewritten.stdout).toContain(":notes.txt:1: email removed");
  expect(gitAt(repo, ["rev-parse", "HEAD^{tree}"])).toBe(tree);
  expect(runScript("scrub-check", [base, "HEAD"], repo).status).toBe(0);
});

test("rewrite refuses to write through a symlinked path", () => {
  // Review round 1: the snapshot write followed a link out of the worktree.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  const target = `${email()}\nsecond-line`;
  symlinkSync(target, join(repo, "P"));
  commit(repo, "add link");
  gitAt(repo, ["rm", "-q", "P"]);
  commit(repo, "drop link");
  const refused = runScript("scrub-rewrite", [base], repo);
  expect(refused.status).toBe(2);
  expect(refused.stdout + refused.stderr).toContain("symlink");
  expect(refused.stdout + refused.stderr).not.toContain(email());
  expect(readdirSync(repo)).not.toContain(target);
});

test("rewrite refusal redacts a value carried in a parenthesized file name", () => {
  // Review round 4: the manual-reword refusal printed the raw path, showing
  // the finding's value on stderr against the ticket's rule 10.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, `(${email()}`), "clean\n");
  commit(repo, "add parenthesized name");
  const refused = runScript("scrub-rewrite", [base], repo);
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain("needs a manual reword");
  expect(refused.stdout + refused.stderr).not.toContain(email());
});

test("rewrite keeps untouched commits byte-identical, with or without a trailing newline", () => {
  // Review round 4: show --format=%B appends one newline past the stored
  // message, so every recreated commit gained a newline and a new id.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "plain.txt"), "plain\n");
  gitAt(repo, ["add", "-A"]);
  gitAt(repo, ["commit", "-q", "-m", "normal ancestor"]);
  const normal = gitAt(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "odd.txt"), "odd\n");
  gitAt(repo, ["add", "-A"]);
  const tree = gitAt(repo, ["write-tree"]);
  writeFileSync(join(repo, "msg.txt"), "no trailing newline");
  const bare = gitAt(repo, ["commit-tree", tree, "-p", "HEAD", "-F", "msg.txt"]);
  gitAt(repo, ["update-ref", "refs/heads/main", bare]);
  gitAt(repo, ["reset", "-q", "--hard", bare]);
  writeFileSync(join(repo, "notes.txt"), email());
  commit(repo, "add temporary note");
  writeFileSync(join(repo, "notes.txt"), "clean\n");
  commit(repo, "remove temporary note");
  const rewritten = runScript("scrub-rewrite", [base], repo);
  expect(rewritten.status).toBe(0);
  expect(gitAt(repo, ["log", "--format=%H", "--grep=normal ancestor", "HEAD"])).toBe(normal);
  expect(gitAt(repo, ["log", "--format=%H", "--grep=no trailing newline", "HEAD"])).toBe(bare);
});
