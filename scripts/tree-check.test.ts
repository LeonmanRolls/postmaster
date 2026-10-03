import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupScratch, commit, gitAt, initRepo, runScript } from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

test("C22 tree check rejects run records even when later deleted and allows shared settings", () => {
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, ".postmaster"));
  writeFileSync(join(repo, ".postmaster", "run.json"), "{}\n");
  commit(repo, "add run record");
  gitAt(repo, ["rm", "-q", ".postmaster/run.json"]);
  commit(repo, "remove run record");
  const removed = runScript("tree-check", [base, "HEAD"], repo);
  expect(removed.status).toBe(1);
  expect(removed.stdout).toContain(".postmaster/run.json");

  const stagedRepo = initRepo();
  mkdirSync(join(stagedRepo, ".postmaster"));
  writeFileSync(join(stagedRepo, ".postmaster", "settings.toml"), "[local]\n");
  gitAt(stagedRepo, ["add", ".postmaster/settings.toml"]);
  const staged = runScript("tree-check", ["HEAD", "HEAD"], stagedRepo);
  expect(staged.status).toBe(1);
  expect(staged.stdout).toContain(".postmaster/settings.toml");

  const sharedRepo = initRepo();
  mkdirSync(join(sharedRepo, ".postmaster"));
  writeFileSync(join(sharedRepo, ".postmaster", "project.toml"), "[shared]\n");
  gitAt(sharedRepo, ["add", ".postmaster/project.toml"]);
  const shared = runScript("tree-check", ["HEAD", "HEAD"], sharedRepo);
  expect(shared.status).toBe(0);
  expect(shared.stdout).toBe("");
});

test("C22 merge commits are checked against each parent", () => {
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  gitAt(repo, ["switch", "-q", "-c", "run-data"]);
  mkdirSync(join(repo, ".postmaster"));
  writeFileSync(join(repo, ".postmaster", "detections.jsonl"), "{}\n");
  commit(repo, "add private run data");
  gitAt(repo, ["switch", "-q", "main"]);
  writeFileSync(join(repo, "ordinary.txt"), "main change\n");
  commit(repo, "main change");
  gitAt(repo, ["merge", "--no-ff", "-m", "merge private run data", "run-data"]);
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain(".postmaster/detections.jsonl");
});
