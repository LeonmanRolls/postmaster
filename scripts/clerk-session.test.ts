// Tests beside scripts/clerk-session.ts: the brief verb and the ready verb.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "clerk-session.sh");
const LOCAL = join(import.meta.dir, "local.sh");

const TWO_PART = [
  "## Problem / feature",
  "Something is wrong and the user wants it fixed.",
  "",
  "## Acceptance criteria",
  "1. The first thing is true when the work is done.",
  "2. The second thing is true when the work is done.",
  "",
  "## Decisions",
  "- **D1 (proposed)** The first choice. Why: the reason. Instead of: the other way.",
  "",
  "## Out of scope",
  "- Nothing else.",
  "",
  "## Direction",
  "None: any approach that meets the criteria.",
  "",
  "## Turnpikes",
  "none",
  "",
  "## For the agents",
  "",
  "*Everything above is what the user signed off.*",
  "",
  "### Checks",
  "",
  "- **C1** Run it and see one. **At the base:** nothing.",
  "- **C2** Run it and see two. **At the base:** nothing.",
  "",
  "### Technical notes",
  "",
  "- The first note. (C1, D1)",
  "- The second note. (C2, D1)",
  "",
  "### Verified at 0123abc",
  "",
  "- A premise, checked.",
  "",
].join("\n");

let tmp = "";
let repo = "";
let envKeys: Array<[string, string | undefined]> = [];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "clerk-session-test-"));
  repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", repo]);
  run("git", ["-C", repo, "config", "user.name", "test"]);
  run("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  run("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init"]);
  run(LOCAL, [repo, "store", "init"]);
  const configPath = join(tmp, "config.toml");
  writeFileSync(
    configPath,
    `[tracker]\nkind = "local"\n[team]\nclerk = { harness = "claude", model = "test" }\n`,
    "utf8",
  );
  envKeys = [
    ["POSTMASTER_CONFIG", process.env.POSTMASTER_CONFIG],
    ["POSTMASTER_PROJECT", process.env.POSTMASTER_PROJECT],
  ];
  process.env.POSTMASTER_CONFIG = configPath;
  // Create a ticket.
  const bodyPath = join(tmp, "body.md");
  writeFileSync(bodyPath, TWO_PART, "utf8");
  const c = run(LOCAL, [repo, "create", "Fix the list", bodyPath]);
  if (c.code !== 0) throw new Error(`create failed: ${c.err}`);
  // Label it ready so we can test the brief removes it.
  run(LOCAL, [repo, "label", "1", "add", "ready"]);
});

afterAll(() => {
  for (const [k, v] of envKeys) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("clerk-session brief", () => {
  test("writes a brief naming the ticket, repo, tool, base and skill", () => {
    const r = run(SELF, ["brief", repo, "1"]);
    expect(r.code).toBe(0);
    const briefPath = r.out.trim();
    expect(existsSync(briefPath)).toBe(true);
    const text = readFileSync(briefPath, "utf8");
    expect(text).toContain("# Booking clerk brief");
    expect(text).toContain("Fix the list");
    expect(text).toContain(repo);
    expect(text).toContain("skills/clerk");
    expect(text).toContain("Standing preferences");
  });

  test("removes the ready label from a ready ticket", () => {
    const read = run(LOCAL, [repo, "read", "1"]);
    const labelsLine = read.out.split("\n").find((l) => l.startsWith("labels:")) ?? "";
    expect(labelsLine).not.toContain("ready");
  });

  test("records the session so a second clerk is not started", () => {
    const sessionFile = join(repo, ".postmaster", "clerk", "1.session");
    expect(existsSync(sessionFile)).toBe(true);
  });
});

describe("clerk-session ready", () => {
  test("ready marks the ticket and writes the note", () => {
    const r = run(SELF, ["ready", repo, "1"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ready");
    const read = run(LOCAL, [repo, "read", "1"]);
    expect(read.out).toContain("ready");
    const ledger = join(repo, ".postmaster", "runs", "ledger.jsonl");
    expect(existsSync(ledger)).toBe(true);
    const text = readFileSync(ledger, "utf8");
    expect(text).toContain("turnpikes");
  });
});
