import { afterEach, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cleanupScratch, commit, email, gitAt, initRepo, runScript } from "./scrub-test-kit.ts";

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

test("tree check passes raw blobs a merge repeats from the base", () => {
  // Merging main repeats main's raw delta against the first parent; blobs
  // identical to the range base already landed and are not new content.
  const repo = initRepo();
  writeFileSync(join(repo, "seed.txt"), "branch point\n");
  commit(repo, "seed");
  gitAt(repo, ["switch", "-q", "-c", "feature"]);
  writeFileSync(join(repo, "clean.txt"), "nothing sensitive here\n");
  commit(repo, "add clean file");
  gitAt(repo, ["switch", "-q", "main"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(join(repo, "raw", "capture.jsonl"), `{"note": "hello ${email()}"}\n`);
  commit(repo, "add capture");
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  gitAt(repo, ["switch", "-q", "feature"]);
  gitAt(repo, ["merge", "--no-ff", "-m", "merge main", "main"]);
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(0);
  expect(checked.stdout).toBe("");
});

test("tree check still flags a merge's own new raw blob", () => {
  // An evil merge smuggles new content into a repeated file; its blob
  // differs from the base, so the base comparison must not skip it.
  const repo = initRepo();
  writeFileSync(join(repo, "seed.txt"), "branch point\n");
  commit(repo, "seed");
  gitAt(repo, ["switch", "-q", "-c", "feature"]);
  writeFileSync(join(repo, "clean.txt"), "nothing sensitive here\n");
  commit(repo, "add clean file");
  gitAt(repo, ["switch", "-q", "main"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(join(repo, "raw", "capture.jsonl"), '{"note": "clean"}\n');
  commit(repo, "add capture");
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  gitAt(repo, ["switch", "-q", "feature"]);
  gitAt(repo, ["merge", "--no-commit", "--no-ff", "main"]);
  writeFileSync(join(repo, "raw", "capture.jsonl"), `{"note": "hello ${email()}"}\n`);
  gitAt(repo, ["add", "-A"]);
  gitAt(repo, ["commit", "-q", "-m", "merge main"]);
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/capture.jsonl:1: email");
});

test("tree check finds encrypted reasoning nested past any depth", () => {
  // Review round 3: the traversal gave up past 64 levels and passed the gate.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  let row = '{"encrypted_content": "sssh-secret"}';
  for (let i = 0; i < 70; i++) row = `{"w": ${row}}`;
  writeFileSync(join(repo, "raw", "deep.jsonl"), `${row}\n`);
  commit(repo, "add deep record");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/deep.jsonl:1: encrypted-reasoning");
});

test("tree check flags pretty-printed reasoning spanning lines", () => {
  // Review round 9 (bug-36): the detector only parsed whole lines, so a
  // pretty-printed record passed the gate. Same fix as promote's, one
  // shared whole-file entry, so the two cannot split again.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: live }, null, 2);
  writeFileSync(join(repo, "raw", "pretty.jsonl"), `${pretty}\n`);
  writeFileSync(
    join(repo, "raw", "single.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  commit(repo, "add records");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/pretty.jsonl:1: encrypted-reasoning");
  expect(checked.stdout).toContain("raw/single.jsonl:1: encrypted-reasoning");
});

test("tree check flags reasoning embedded in a prose line", () => {
  // Review round 10 (bug-53): the detector only recognised whole lines that
  // parse as JSON, so a prose line embedding a reasoning record passed.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  const line = `note: {"type":"reasoning","encrypted_content":"${live}"} done`;
  writeFileSync(join(repo, "raw", "prose.jsonl"), `${line}\n`);
  commit(repo, "add record");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/prose.jsonl:1: encrypted-reasoning");
});

test("tree check flags raw content even when SCRUB_CHECK_DISABLE is set", () => {
  // Review round 3: ambient DISABLE silenced the tree scan in-process.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(join(repo, "raw", "record.jsonl"), `{"note": "hello ${email()}"}\n`);
  commit(repo, "add raw record");
  const checked = runScript("tree-check", [base, "HEAD"], repo, {
    SCRUB_CHECK_DISABLE: "email",
  });
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/record.jsonl:1: email");
  expect(checked.stdout + checked.stderr).not.toContain(email());
});

test("tree check passes a promoter-scrubbed placeholder and logs live reasoning", () => {
  // Review round 4: the placeholder kept its field, so a promoted record the
  // promoter accepted still failed the gate; and neither script logged the
  // reasoning finding, so TELL and the card never saw it.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(
    join(repo, "raw", "scrubbed.jsonl"),
    '{"encrypted_content": "<redacted:encrypted-reasoning>"}\n',
  );
  writeFileSync(
    join(repo, "raw", "live.jsonl"),
    `${JSON.stringify({ encrypted_content: ["sealed", "text"].join("") })}\n`,
  );
  commit(repo, "add scrubbed and live records");
  const log = join(repo, "detections.jsonl");
  const checked = runScript("tree-check", [base, "HEAD"], repo, {
    POSTMASTER_DETECTIONS_LOG: log,
  });
  expect(checked.status).toBe(1);
  expect(checked.stdout).not.toContain("scrubbed.jsonl");
  expect(checked.stdout).toContain("raw/live.jsonl:1: encrypted-reasoning");
  const rows = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { rule: string; file: string });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.rule).toBe("encrypted-reasoning");
  expect(rows[0]?.file).toBe("raw/live.jsonl");
});

test("tree check flags reasoning whatever the record type's case", () => {
  // Review round 5: the detector compared the type exact-case while the
  // promoter lowercases it, so Thinking/signature passed the gate.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(
    join(repo, "raw", "mixed.jsonl"),
    `${JSON.stringify({ type: "Thinking", signature: ["live", "sig"].join("-") })}\n`,
  );
  commit(repo, "add mixed-case record");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/mixed.jsonl:1: encrypted-reasoning");
});

test("tree check flags reasoning inside prose-embedded JSON", () => {
  // Review round 5: the detector skipped strings that were not pure JSON
  // while the promoter splices embedded objects out of them.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(
    join(repo, "raw", "embedded.jsonl"),
    `${JSON.stringify({ note: `says {"encrypted_content": "${["live", "seal"].join("-")}"} aloud` })}\n`,
  );
  commit(repo, "add embedded record");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/embedded.jsonl:1: encrypted-reasoning");
});

test("tree check scans modified raw blobs like added ones", () => {
  // Review round 5: only additions were scanned, so an edit smuggling
  // reasoning into an existing record passed the gate.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  writeFileSync(join(repo, "raw", "record.jsonl"), '{"note": "clean"}\n');
  commit(repo, "add clean record");
  appendFileSync(
    join(repo, "raw", "record.jsonl"),
    `${JSON.stringify({ type: "thinking", signature: ["added", "later"].join("-") })}\n`,
  );
  commit(repo, "edit the record");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/record.jsonl:2: encrypted-reasoning");
});

test("tree check scans a raw file whose git type changes", () => {
  // Review round 11 (bug-58): the intake took only A and M, so a raw/
  // symlink replaced by a regular file (status T) passed both gates.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  symlinkSync("/nonexistent-target", join(repo, "raw", "record.jsonl"));
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "link the record");
  unlinkSync(join(repo, "raw", "record.jsonl"));
  const live = ["sealed", "blob"].join("");
  writeFileSync(
    join(repo, "raw", "record.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "replace the link with a record");
  expect(gitAt(repo, ["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"])).toMatch(
    /^T\traw\/record\.jsonl$/mu,
  );
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/record.jsonl:1: encrypted-reasoning");
});

test("tree check scans a staged raw file whose git type changes", () => {
  // Review round 11 (bug-58): the staged intake had the same A/M-only
  // filter as the committed one; both take T through one predicate.
  const repo = initRepo();
  mkdirSync(join(repo, "raw"));
  symlinkSync("/nonexistent-target", join(repo, "raw", "record.jsonl"));
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "link the record");
  unlinkSync(join(repo, "raw", "record.jsonl"));
  const live = ["sealed", "blob"].join("");
  writeFileSync(
    join(repo, "raw", "record.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(repo, ["add", "raw/record.jsonl"]);
  const checked = runScript("tree-check", ["HEAD", "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/record.jsonl:1: encrypted-reasoning");
});

test("tree check scans a renamed raw file through its added side", () => {
  // Review round 11 (bug-58): with rename detection off a rename is D+A
  // and the added side carries the blob; R itself never appears.
  const repo = initRepo();
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  writeFileSync(join(repo, "raw", "old.jsonl"), `${JSON.stringify({ encrypted_content: live })}\n`);
  gitAt(repo, ["add", "raw/old.jsonl"]);
  const added = commit(repo, "add the record");
  gitAt(repo, ["mv", "raw/old.jsonl", "raw/new.jsonl"]);
  commit(repo, "rename the record");
  const renamed = runScript("tree-check", [added, "HEAD"], repo);
  expect(renamed.status).toBe(1);
  expect(renamed.stdout).toContain("raw/new.jsonl:1: encrypted-reasoning");
});

test("tree check passes a raw file deleted with no new blob", () => {
  // Review round 11 (bug-58): D removes content, so there is nothing to
  // scan; the deletion itself is clean (the addition still flags).
  const repo = initRepo();
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  writeFileSync(
    join(repo, "raw", "record.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(repo, ["add", "raw/record.jsonl"]);
  const added = commit(repo, "add the record");
  gitAt(repo, ["rm", "-q", "raw/record.jsonl"]);
  commit(repo, "delete the record");
  const deleted = runScript("tree-check", [added, "HEAD"], repo);
  expect(deleted.status).toBe(0);
  expect(deleted.stdout).toBe("");
});

test("tree check leaves an unmerged staged path alone", () => {
  // Review round 11 (bug-58): U has no staged blob and git blocks the
  // commit, so there is nothing to scan and nothing to refuse.
  const repo = initRepo();
  mkdirSync(join(repo, "raw"));
  writeFileSync(join(repo, "raw", "record.jsonl"), '{"note": "clean"}\n');
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "add the record");
  gitAt(repo, ["switch", "-q", "-c", "side"]);
  writeFileSync(join(repo, "raw", "record.jsonl"), '{"note": "side"}\n');
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "side edit");
  gitAt(repo, ["switch", "-q", "main"]);
  writeFileSync(join(repo, "raw", "record.jsonl"), '{"note": "main"}\n');
  gitAt(repo, ["add", "raw/record.jsonl"]);
  commit(repo, "main edit");
  try {
    gitAt(repo, ["merge", "--no-ff", "--no-commit", "side"]);
  } catch {
    // The conflict is the fixture.
  }
  expect(gitAt(repo, ["ls-files", "-u"])).toContain("raw/record.jsonl");
  const checked = runScript("tree-check", ["HEAD", "HEAD"], repo);
  expect(checked.status).toBe(0);
  expect(checked.stdout).toBe("");
});

interface FindingRow {
  commit: string;
  path: string;
  line: number;
  rule: string;
}

function findingRows(output: string): FindingRow[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FindingRow);
}

test("tree check --findings emits structured rows with commits", () => {
  // Review round 11 (bug-59): a history rewrite (#423) plans from this
  // listing, so it carries the commit each finding belongs to, like
  // scrub-check's.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  writeFileSync(
    join(repo, "raw", "record.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(repo, ["add", "raw/record.jsonl"]);
  const added = commit(repo, "add the record");
  const listed = runScript("tree-check", ["--findings", base, "HEAD"], repo);
  expect(listed.status).toBe(1);
  expect(findingRows(listed.stdout)).toEqual([
    { commit: added, path: "raw/record.jsonl", line: 1, rule: "encrypted-reasoning" },
  ]);

  const stagedRepo = initRepo();
  mkdirSync(join(stagedRepo, "raw"));
  writeFileSync(
    join(stagedRepo, "raw", "record.jsonl"),
    `${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(stagedRepo, ["add", "raw/record.jsonl"]);
  const staged = runScript("tree-check", ["--findings", "HEAD", "HEAD"], stagedRepo);
  expect(staged.status).toBe(1);
  expect(findingRows(staged.stdout)).toEqual([
    { commit: "", path: "raw/record.jsonl", line: 1, rule: "encrypted-reasoning" },
  ]);
});

test("tree check --findings expands whole-file reasoning to every line", () => {
  // Review round 11 (bug-59): a spanning record flags at line 1 in text,
  // but a history rewrite (#423) removes lines, so the listing names each
  // of them.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: live }, null, 2);
  writeFileSync(join(repo, "raw", "pretty.jsonl"), `${pretty}\n`);
  gitAt(repo, ["add", "raw/pretty.jsonl"]);
  const added = commit(repo, "add the record");
  const count = pretty.split("\n").length;
  expect(count).toBeGreaterThan(1);
  const listed = runScript("tree-check", ["--findings", base, "HEAD"], repo);
  expect(listed.status).toBe(1);
  expect(findingRows(listed.stdout)).toEqual(
    Array.from({ length: count }, (_, i) => ({
      commit: added,
      path: "raw/pretty.jsonl",
      line: i + 1,
      rule: "encrypted-reasoning",
    })),
  );
});

test("tree check --findings names run records under .postmaster/", () => {
  // Review round 11 (bug-59): path findings list at line 0, and a history
  // rewrite (#423) refuses them loudly instead of renaming private content.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, ".postmaster"));
  writeFileSync(join(repo, ".postmaster", "run.json"), "{}\n");
  gitAt(repo, ["add", ".postmaster/run.json"]);
  const added = commit(repo, "add a run record");
  const listed = runScript("tree-check", ["--findings", base, "HEAD"], repo);
  expect(listed.status).toBe(1);
  expect(findingRows(listed.stdout)).toEqual([
    { commit: added, path: ".postmaster/run.json", line: 0, rule: "private-record" },
  ]);
});

test("tree check flags UTF-8 BOM records pretty-printed and one-line", () => {
  // Review round 11 (bug-60): the gate read the BOM as the first
  // character, so a BOM-prefixed spanning record skipped the whole entry.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw"));
  const live = ["sealed", "blob"].join("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: live }, null, 2);
  writeFileSync(join(repo, "raw", "pretty.jsonl"), `\uFEFF${pretty}\n`);
  writeFileSync(
    join(repo, "raw", "single.jsonl"),
    `\uFEFF${JSON.stringify({ encrypted_content: live })}\n`,
  );
  gitAt(repo, ["add", "raw/pretty.jsonl", "raw/single.jsonl"]);
  commit(repo, "add BOM records");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(1);
  expect(checked.stdout).toContain("raw/pretty.jsonl:1: encrypted-reasoning");
  expect(checked.stdout).toContain("raw/single.jsonl:1: encrypted-reasoning");
});

test("tree check refuses UTF-16 BOM records loudly by name, exit 2", () => {
  // Review round 11 (bug-60): only the UTF-8 mark is skipped; the UTF-16
  // forms stay closed input, refused like any other encoding.
  const little = Buffer.from(`{"note": "encoded"}\n`, "utf16le");
  const big = Buffer.from(little);
  for (let i = 0; i + 1 < big.length; i += 2) {
    const lo = big[i]!;
    big[i] = big[i + 1]!;
    big[i + 1] = lo;
  }
  for (const bytes of [
    Buffer.concat([Buffer.from([0xff, 0xfe]), little]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), big]),
  ]) {
    const repo = initRepo();
    const base = gitAt(repo, ["rev-parse", "HEAD"]);
    mkdirSync(join(repo, "raw"));
    writeFileSync(join(repo, "raw", "record.jsonl"), bytes);
    gitAt(repo, ["add", "raw/record.jsonl"]);
    commit(repo, "add an encoded record");
    const refused = runScript("tree-check", [base, "HEAD"], repo);
    expect(refused.status).toBe(2);
    expect(refused.stdout + refused.stderr).toContain("raw/record.jsonl");
  }
});
