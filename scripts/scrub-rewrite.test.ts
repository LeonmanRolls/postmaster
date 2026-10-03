import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
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
