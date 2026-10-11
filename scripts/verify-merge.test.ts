import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  cleanupScratch,
  commit,
  gitAt,
  initRepo,
  phone,
  runScript,
  scratchDir,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

function mergedChange(value: string, conflict = false): string {
  const repo = initRepo();
  gitAt(repo, ["switch", "-q", "-c", "side"]);
  writeFileSync(
    join(repo, conflict ? "base.txt" : "private-note.txt"),
    `${conflict ? "side" : value}\n`,
  );
  commit(repo, "side change");
  gitAt(repo, ["switch", "-q", "main"]);
  writeFileSync(
    join(repo, conflict ? "base.txt" : "ordinary.txt"),
    conflict ? "main change\n" : "main change\n",
  );
  commit(repo, "main change");
  if (conflict) {
    const merge = spawnSync("git", ["merge", "--no-ff", "--no-commit", "side"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(merge.status).not.toBe(0);
    writeFileSync(join(repo, "base.txt"), `phone ${value}\n`);
    gitAt(repo, ["add", "base.txt"]);
    gitAt(repo, ["commit", "-q", "-m", "merge resolution"]);
  } else {
    gitAt(repo, ["merge", "--no-ff", "-q", "-m", "merge resolution", "side"]);
  }
  return repo;
}

test("verify-merge checks a clean merge resolution", () => {
  const repo = mergedChange("ordinary");
  const result = runScript("verify-merge", [repo], repo);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("verify-merge rejects a merge resolution that adds private data", () => {
  const repo = mergedChange(phone(), true);
  const parents = gitAt(repo, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
  expect(parents).toHaveLength(3);
  const result = runScript("verify-merge", [repo], repo);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(":base.txt:1: phone");
  expect(result.stdout).not.toContain(phone());
  expect(result.stderr).toBe("");
});

test("verify-merge logs its findings to the named dispatch", () => {
  // Review round 5: the merge scans ran with no detections log, so a
  // merge-only finding printed but TELL and the card never saw it.
  const repo = mergedChange(phone(), true);
  const dispatch = scratchDir();
  const result = runScript("verify-merge", [repo, "HEAD", "--dispatch", dispatch], repo);
  expect(result.status).toBe(1);
  const rows = readFileSync(join(dispatch, "detections.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { rule: string; file: string });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.rule).toBe("phone");
  expect(rows[0]?.file).toBe("base.txt");
});

function localRouteScans(text: string): boolean {
  const start = text.indexOf("For `landing: local`");
  const end = text.indexOf("- An unknown landing route");
  if (start === -1 || end === -1 || end < start) return false;
  const section = text.slice(start, end);
  return section.includes("verify-merge") && section.includes("--dispatch");
}

test("verify-merge is called by the local landing route", () => {
  // Review round 11 (bug-56): the check existed but no runbook step
  // called it, so local-route conflict resolutions landed unscanned.
  const pm = readFileSync(join(import.meta.dir, "../skills/postmaster/postmaster.md"), "utf8");
  expect(localRouteScans(pm)).toBe(true);
  // Negative control: the pre-fix wording names the merge but no scan.
  const old =
    "For `landing: local`, obey. Merge the ticket branch with `git merge --no-ff`; " +
    "never rebase. Log `merge`.\n- An unknown landing route is a dispatch fault.";
  expect(localRouteScans(old)).toBe(false);
});
