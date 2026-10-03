import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupScratch, email, initRepo, marker, runScript, scratchDir, token } from "./scrub-test-kit.ts";

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
  const clean = runScript("scrub-check", ["--files", join(repo, "raw/copied", "record.jsonl")], repo);
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
  ];
  writeFileSync(join(source, "trace.jsonl"), `${lines.join("\n")}\n`);
  const copied = runScript("raw-promote", [source, "raw/trace"], repo);
  expect(copied.status).toBe(0);
  expect(copied.stdout.trim().split("\n").filter((line) => line.includes("encrypted-reasoning scrubbed"))).toHaveLength(4);
  const promoted = readFileSync(join(repo, "raw/trace", "trace.jsonl"), "utf8").trim().split("\n");
  expect(promoted).toHaveLength(lines.length);
  const parsed = promoted.map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(parsed[0]!.signature).toBe("<redacted:encrypted-reasoning>");
  expect(parsed[1]!.data).toBe("<redacted:encrypted-reasoning>");
  expect(parsed[2]!.encrypted_content).toBe("<redacted:encrypted-reasoning>");
  expect(JSON.parse(parsed[3]!.nested as string)).toEqual({ encrypted_content: "<redacted:encrypted-reasoning>" });
  expect(promoted.join("\n").includes("sealedtext")).toBe(false);
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
