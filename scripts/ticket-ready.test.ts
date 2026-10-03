// Tests beside scripts/ticket-ready.ts: readiness is both ticket checks plus a ready mark.
// The test store holds tickets (a)–(d) as the ticket's Checks section describes them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "ticket-ready.sh");
const LOCAL = join(import.meta.dir, "local.sh");
const HERE = import.meta.dir;

// A two-part ticket that passes both checks.
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

const REMOVE_TICKET = readFileSync(join(HERE, "..", "fixtures", "tickets", "remove", "ticket.md"), "utf8");

let tmp = "";
let repo = "";
let configPath = "";
let envKeys: Array<[string, string | undefined]> = [];

function invoke(...args: string[]) {
  return run(SELF, args);
}

function local(...args: string[]) {
  return run(LOCAL, args);
}

function setLabels(n: string, labels: string) {
  // Set labels by writing the meta file through local label commands.
  for (const l of labels.split(",").filter(Boolean)) {
    local(repo, "label", n, "add", l.trim());
  }
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ticket-ready-test-"));
  repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", repo]);
  run("git", ["-C", repo, "config", "user.name", "test"]);
  run("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  run("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init"]);
  // Init the local store.
  const init = local(repo, "store", "init");
  if (init.code !== 0) throw new Error(`store init failed: ${init.err}`);

  // A minimal config so tracker-kind finds local (the store exists).
  configPath = join(tmp, "config.toml");
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

  // (a) two-part, ready label.
  const bodyA = join(tmp, "a.md");
  writeFileSync(bodyA, TWO_PART, "utf8");
  const ca = local(repo, "create", "A ticket", bodyA);
  if (ca.code !== 0) throw new Error(`create a failed: ${ca.err}`);

  // (b) same body, no label, titled "Fix the list".
  const bodyB = join(tmp, "b.md");
  writeFileSync(bodyB, TWO_PART, "utf8");
  const cb = local(repo, "create", "Fix the list", bodyB);
  if (cb.code !== 0) throw new Error(`create b failed: ${cb.err}`);

  // (c) the one-part fixture ticket remove, ready label.
  const bodyC = join(tmp, "c.md");
  writeFileSync(bodyC, REMOVE_TICKET, "utf8");
  const cc = local(repo, "create", "Remove tasks by id", bodyC);
  if (cc.code !== 0) throw new Error(`create c failed: ${cc.err}`);

  // (d) two-part with DRAFT first line, ready label.
  const bodyD = join(tmp, "d.md");
  writeFileSync(bodyD, `DRAFT: not approved, do not implement from this file\n${TWO_PART}`, "utf8");
  const cd = local(repo, "create", "Draft ticket", bodyD);
  if (cd.code !== 0) throw new Error(`create d failed: ${cd.err}`);

  // Label (a) and (c) and (d) ready.
  local(repo, "label", "1", "add", "ready");
  local(repo, "label", "3", "add", "ready");
  local(repo, "label", "4", "add", "ready");
});

afterAll(() => {
  for (const [k, v] of envKeys) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("ticket-ready check on the test store", () => {
  test("(a) two-part with ready label exits 0", () => {
    const r = invoke(repo, "1");
    expect(r.code).toBe(0);
  });

  test("(b) same body without the label exits 2 naming the missing mark", () => {
    const r = invoke(repo, "2");
    expect(r.code).toBe(2);
    expect(r.out).toContain("no ready label");
  });

  test("(c) one-part fixture ticket with ready label exits 2 naming the parts finding", () => {
    const r = invoke(repo, "3");
    expect(r.code).toBe(2);
    expect(r.out).toContain("ticket-parts");
  });

  test("(d) draft line with ready label exits 2 naming the draft line", () => {
    const r = invoke(repo, "4");
    expect(r.code).toBe(2);
    expect(r.out).toContain("DRAFT");
  });

  test("an unknown id exits 1", () => {
    const r = invoke(repo, "99");
    expect(r.code).toBe(1);
  });

  test("a ticket failing several ways shows every reason", () => {
    // (b) has no label; if we also make it draft, both reasons show.
    const bodyBD = join(tmp, "bd.md");
    writeFileSync(bodyBD, `DRAFT: x\n${TWO_PART}`, "utf8");
    const c = local(repo, "create", "Bad", bodyBD);
    const n = c.out.trim();
    const r = invoke(repo, n);
    expect(r.code).toBe(2);
    expect(r.out).toContain("no ready label");
    expect(r.out).toContain("DRAFT");
  });
});

describe("ticket-ready mark", () => {
  test("mark on (c) exits 2 and adds no label", () => {
    const before = local(repo, "read", "3").out;
    const r = run(SELF, ["mark", repo, "3"]);
    expect(r.code).toBe(2);
    const after = local(repo, "read", "3").out;
    // Label list should not have gained another ready.
    const beforeLabels = before.split("\n").find((l) => l.startsWith("labels:")) ?? "";
    const afterLabels = after.split("\n").find((l) => l.startsWith("labels:")) ?? "";
    expect(afterLabels).toBe(beforeLabels);
  });

  test("mark on a clean unready ticket adds the label and writes a note", () => {
    // (b) is clean but unready.
    const r = run(SELF, ["mark", repo, "2"]);
    expect(r.code).toBe(0);
    const read = local(repo, "read", "2").out;
    expect(read).toContain("ready");
    // The ledger has a note with the turnpikes line.
    const ledger = join(repo, ".postmaster", "runs", "ledger.jsonl");
    const text = readFileSync(ledger, "utf8");
    expect(text).toContain("turnpikes");
  });

  test("unmark removes the label and the readiness check names the missing mark", () => {
    const r = run(SELF, ["unmark", repo, "1"]);
    expect(r.code).toBe(0);
    const check = invoke(repo, "1");
    expect(check.code).toBe(2);
    expect(check.out).toContain("no ready label");
    // Re-mark for later tests.
    run(SELF, ["mark", repo, "1"]);
  });
});
