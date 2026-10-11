import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyFiles } from "./raw-promote-main.ts";
import {
  cleanupScratch,
  commit,
  email,
  gitAt,
  initRepo,
  marker,
  runScript,
  scratchDir,
  token,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

test("C19 promotion replaces findings in the copy and leaves the source byte-for-byte unchanged", () => {
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const input = `${email()}\n${token()}\n`;
  writeFileSync(join(source, "record.jsonl"), input);
  const before = readFileSync(join(source, "record.jsonl"));
  const copied = runScript("raw-promote", [source, "raw/copied"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout.trim().split("\n")).toHaveLength(2);
  expect(copied.stdout).toContain("email scrubbed");
  expect(copied.stdout).toContain("token scrubbed");
  expect(readFileSync(join(source, "record.jsonl"))).toEqual(before);
  const promoted = readFileSync(join(repo, "raw/copied", "record.jsonl"), "utf8");
  expect(promoted).toContain("<redacted:email>");
  expect(promoted).toContain("<redacted:token>");
  const clean = runScript(
    "scrub-check",
    ["--files", join(repo, "raw/copied", "record.jsonl")],
    repo,
  );
  expect(clean.status).toBe(0);
  expect(clean.stdout).toBe("");
  expect(copied.stdout.includes(email()) || copied.stdout.includes(token())).toBe(false);
});

test("C20 promotion removes all encrypted reasoning forms, including one nested in a string", () => {
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const lines = [
    JSON.stringify({ type: "thinking", signature: ["sig", "nature"].join("") }),
    JSON.stringify({ type: "redacted_thinking", data: ["cipher", "text"].join("") }),
    JSON.stringify({ encrypted_content: ["sealed", "text"].join("") }),
    JSON.stringify({ nested: JSON.stringify({ encrypted_content: ["nested", "seal"].join("") }) }),
    JSON.stringify({
      note: ["says {", '"encrypted', '_content"', ": ", '"prose', 'seal"', "} aloud"].join(""),
    }),
  ];
  writeFileSync(join(source, "trace.jsonl"), `${lines.join("\n")}\n`);
  const copied = runScript("raw-promote", [source, "raw/trace"], repo);
  expect(copied.status).toBe(0);
  expect(
    copied.stdout
      .trim()
      .split("\n")
      .filter((line) => line.includes("encrypted-reasoning scrubbed")),
  ).toHaveLength(5);
  const promoted = readFileSync(join(repo, "raw/trace", "trace.jsonl"), "utf8")
    .trim()
    .split("\n");
  expect(promoted).toHaveLength(lines.length);
  const parsed = promoted.map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(parsed[0]!.signature).toBe("<redacted:encrypted-reasoning>");
  expect(parsed[1]!.data).toBe("<redacted:encrypted-reasoning>");
  expect(parsed[2]!.encrypted_content).toBe("<redacted:encrypted-reasoning>");
  expect(JSON.parse(parsed[3]!.nested as string)).toEqual({
    encrypted_content: "<redacted:encrypted-reasoning>",
  });
  expect(parsed[4]!.note as string).toContain("<redacted:encrypted-reasoning>");
  expect(promoted.join("\n").includes("sealedtext")).toBe(false);
  expect(promoted.join("\n").includes("proseseal")).toBe(false);
});

test("promotion strips pretty-printed reasoning spanning lines, one-line form unchanged", () => {
  // Review round 9 (bug-36): both sides only recognised whole lines that
  // parse as JSON, so a pretty-printed record sailed through promote and
  // the tree check alike.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const live = ["sealed", "blob"].join("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: live }, null, 2);
  expect(pretty.includes("\n")).toBe(true);
  writeFileSync(join(source, "pretty.jsonl"), `${pretty}\n`);
  const single = JSON.stringify({ encrypted_content: live });
  writeFileSync(join(source, "single.jsonl"), `${single}\n`);
  const copied = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout).toContain("encrypted-reasoning scrubbed");
  const fixedPretty = readFileSync(join(repo, "raw/fixed", "pretty.jsonl"), "utf8");
  expect(fixedPretty.includes(live)).toBe(false);
  expect(fixedPretty).toContain("<redacted:encrypted-reasoning>");
  const fixedSingle = readFileSync(join(repo, "raw/fixed", "single.jsonl"), "utf8");
  expect(fixedSingle.includes(live)).toBe(false);
  expect(JSON.parse(fixedSingle).encrypted_content).toBe("<redacted:encrypted-reasoning>");
});

test("promotion strips BOM-prefixed reasoning pretty-printed and one-line", () => {
  // Review round 11 (bug-60): the mark rides ahead of the record on both
  // sides, so the promoter must scrub what the detector flags.
  const repo = initRepo();
  const source = join(scratchDir(), "bom-source");
  mkdirSync(source);
  const live = ["sealed", "blob"].join("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: live }, null, 2);
  writeFileSync(join(source, "pretty.jsonl"), `\uFEFF${pretty}\n`);
  const single = JSON.stringify({ encrypted_content: live });
  writeFileSync(join(source, "single.jsonl"), `\uFEFF${single}\n`);
  const copied = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout).toContain("encrypted-reasoning scrubbed");
  const fixedPretty = readFileSync(join(repo, "raw/fixed", "pretty.jsonl"), "utf8");
  expect(fixedPretty.includes(live)).toBe(false);
  const fixedSingle = readFileSync(join(repo, "raw/fixed", "single.jsonl"), "utf8");
  expect(fixedSingle.includes(live)).toBe(false);
  expect(JSON.parse(fixedSingle).encrypted_content).toBe("<redacted:encrypted-reasoning>");
});

test("promotion strips reasoning embedded in a prose line", () => {
  // Review round 10 (bug-53): the per-line transform only recognised whole
  // lines that parse as JSON, so a prose line embedding a reasoning record
  // was copied whole.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const live = ["sealed", "blob"].join("");
  const line = `note: {"type":"reasoning","encrypted_content":"${live}"} done`;
  writeFileSync(join(source, "prose.jsonl"), `${line}\n`);
  const copied = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout).toContain("encrypted-reasoning scrubbed");
  const fixed = readFileSync(join(repo, "raw/fixed", "prose.jsonl"), "utf8");
  expect(fixed.includes(live)).toBe(false);
  expect(fixed).toContain("<redacted:encrypted-reasoning>");
  expect(fixed.startsWith("note: ")).toBe(true);
});

test("promotion refuses a quoted marker beside a finding instead of truncating", () => {
  // Review round 10 (bug-51): the strip deleted from the marker to the end
  // of the line even when the marker was a quoted example, so the copy lost
  // real trailing content while promotion succeeded. Now the example faults
  // like any marker that cannot cover its line, and nothing is copied.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const line = `"call ${email()}: ${marker("email")}" for details`;
  writeFileSync(join(source, "quoted.txt"), `${line}\n`);
  const refused = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(refused.status).toBe(1);
  expect(refused.stdout).toContain("marker");
  expect(refused.stdout + refused.stderr).not.toContain(email());
  expect(() => readFileSync(join(repo, "raw/fixed", "quoted.txt"))).toThrow();
});

test("promotion preserves a quoted marker example beside an outside finding", () => {
  // Review round 10 (bug-51): with the finding outside the string the marker
  // is inert text, so the copy redacts the finding and keeps the example
  // and everything after it.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const line = `"see ${marker("email")}" contact ${email()} today`;
  writeFileSync(join(source, "quoted.txt"), `${line}\n`);
  const copied = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(copied.status).toBe(0);
  const fixed = readFileSync(join(repo, "raw/fixed", "quoted.txt"), "utf8");
  expect(fixed.includes(email())).toBe(false);
  expect(fixed).toContain("today");
  expect(fixed).toContain("private-data");
});

test("C21 promotion rescans clean, refuses repeats and copies nothing on a marker fault", () => {
  const repo = initRepo();
  const source = join(scratchDir(), "good");
  mkdirSync(source);
  writeFileSync(join(source, "note.txt"), email());
  const copied = runScript("raw-promote", [source, "raw/good"], repo);
  expect(copied.status).toBe(0);
  const repeated = runScript("raw-promote", [source, "raw/good"], repo);
  expect(repeated.status).toBe(2);
  expect(repeated.stdout + repeated.stderr).not.toContain(email());
  expect(repeated.stdout + repeated.stderr).toContain("destination already exists");

  const bad = join(scratchDir(), "bad");
  mkdirSync(bad);
  writeFileSync(join(bad, "fault.txt"), `${email()} ${marker("phone")}\n`);
  const fault = runScript("raw-promote", [bad, "raw/fault"], repo);
  expect(fault.status).toBe(1);
  expect(fault.stdout).toContain("marker");
  expect(fault.stdout + fault.stderr).not.toContain(email());
  expect(() => readFileSync(join(repo, "raw/fault", "fault.txt"))).toThrow();
});

test("promotion scrubs even when SCRUB_CHECK_DISABLE is set", () => {
  // Review round 3: ambient DISABLE turned the scrub into a straight copy.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  writeFileSync(join(source, "note.txt"), `hello ${email()}\n`);
  const copied = runScript("raw-promote", [source, "raw/disabled"], repo, {
    SCRUB_CHECK_DISABLE: "email",
  });
  expect(copied.status).toBe(0);
  expect(copied.stdout).toContain("email scrubbed");
  expect(readFileSync(join(repo, "raw/disabled", "note.txt"), "utf8")).not.toContain(email());
});

test("promotion refuses a marker whose strip would break a JSON row", () => {
  // Review round 3: stripping the marker ate the closing syntax, exit 0.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  writeFileSync(join(source, "row.jsonl"), `{"note": "${email()} ${marker("email")}"}\n`);
  const refused = runScript("raw-promote", [source, "raw/marks"], repo);
  expect(refused.status).toBe(1);
  expect(refused.stdout).toContain("marker");
  expect(refused.stdout + refused.stderr).not.toContain(email());
  expect(() => readFileSync(join(repo, "raw/marks", "row.jsonl"))).toThrow();
});

test("promotion refuses a destination under a symlinked directory", () => {
  // Review round 1: a symlinked raw/archive let the copy escape the repository.
  const repo = initRepo();
  const outside = join(scratchDir(), "outside");
  mkdirSync(outside);
  mkdirSync(join(repo, "raw"));
  symlinkSync(outside, join(repo, "raw/archive"));
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  writeFileSync(join(source, "note.txt"), "clean line\n");
  const refused = runScript("raw-promote", [source, "raw/archive/record"], repo);
  expect(refused.status).toBe(2);
  expect(refused.stdout + refused.stderr).toContain("symlink");
  expect(readdirSync(outside)).toEqual([]);
});

test("promotion replaces a dotenv value that repeats its name, and the copy scans clean", async () => {
  // Review round 8: the span mis-hit redacted the name, and the surviving
  // secret passed the rescan, --files and tree-check alike.
  const repo = initRepo();
  const name = ["pass", "word"].join("");
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const dirty = join(source, "record.txt");
  writeFileSync(dirty, `${name}=${name}\n`);
  expect(await verifyFiles([dirty])).not.toHaveLength(0);
  const filesDirty = runScript("scrub-check", ["--files", dirty], repo);
  expect(filesDirty.status).toBe(1);
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "raw", "before"), { recursive: true });
  writeFileSync(join(repo, "raw", "before", "record.txt"), `${name}=${name}\n`);
  commit(repo, "dirty dotenv record");
  const treeDirty = runScript("tree-check", [base, "HEAD"], repo);
  expect(treeDirty.status).toBe(1);
  const copied = runScript("raw-promote", [source, "raw/fixed"], repo);
  expect(copied.status).toBe(0);
  const copy = join(repo, "raw/fixed", "record.txt");
  expect(readFileSync(copy, "utf8")).toBe(`${name}=<redacted:dotenv>\n`);
  expect(await verifyFiles([copy])).toHaveLength(0);
  const filesClean = runScript("scrub-check", ["--files", "raw/fixed/record.txt"], repo);
  expect(filesClean.status).toBe(0);
  const mid = gitAt(repo, ["rev-parse", "HEAD"]);
  commit(repo, "promoted dotenv record");
  const treeClean = runScript("tree-check", [mid, "HEAD"], repo);
  expect(treeClean.status).toBe(0);
});

test("promotion logs its reasoning redactions and the copy passes the tree check", () => {
  // Review round 4: the promoter never logged its encrypted-reasoning
  // redactions, and the tree check flagged the placeholder it writes, so a
  // promotion that returned success still failed the gate.
  const repo = initRepo();
  const base = gitAt(repo, ["rev-parse", "HEAD"]);
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  writeFileSync(
    join(source, "trace.jsonl"),
    `${JSON.stringify({ encrypted_content: ["sealed", "text"].join("") })}\n`,
  );
  const log = join(scratchDir(), "detections.jsonl");
  const copied = runScript("raw-promote", [source, "raw/trace"], repo, {
    POSTMASTER_DETECTIONS_LOG: log,
  });
  expect(copied.status).toBe(0);
  const rows = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { rule: string });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.rule).toBe("encrypted-reasoning");
  commit(repo, "promote scrubbed trace");
  const checked = runScript("tree-check", [base, "HEAD"], repo);
  expect(checked.status).toBe(0);
  expect(checked.stdout).toBe("");
});

test("promotion redacts the whole private-domain email, local part included", () => {
  // Review round 15 (bug-95): the host-only span left alice@ in the copy,
  // rescanning clean. The email span survives now, so nothing remains.
  const repo = initRepo();
  const source = join(scratchDir(), "source");
  mkdirSync(source);
  const mailbox = ["alice", "@corp.", "internal"].join("");
  const localPart = ["alice", "@"].join("");
  const domainPart = ["corp.", "internal"].join("");
  writeFileSync(join(source, "note.md"), `contact ${mailbox} for x\n`);
  const copied = runScript("raw-promote", [source, "raw/copied"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout).toContain("email scrubbed");
  const promoted = readFileSync(join(repo, "raw/copied", "note.md"), "utf8");
  expect(promoted).not.toContain(localPart);
  expect(promoted).not.toContain(domainPart);
  const clean = runScript("scrub-check", ["--files", join(repo, "raw/copied", "note.md")], repo);
  expect(clean.status).toBe(0);
  expect(clean.stdout).toBe("");
});
