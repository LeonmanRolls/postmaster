import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const SCRIPT = join(HERE, "ticket-ready.sh");
const LOCAL = join(HERE, "local.sh");
const BODY = `## Problem / feature
A list item cannot be fixed after it is filed.

## Acceptance criteria
1. The ready check accepts this ticket after it is signed off.
2. It names each reason the ticket is not ready.

## Direction
None: any approach that meets the criteria.

## Turnpikes
default

## For the agents

### Checks
- **C1** The command reports a ready ticket.
- **C2** It reports missing readiness reasons.

### Technical notes
- The check reads a ticket through the local adapter. (C1, C2)

### Verified at 0000000000000000000000000000000000000000
The fixture commit is the verified base.
`;
const DRAFT = `DRAFT: waiting for the user's sign-off

${BODY}`;

let temp = "";
let repo = "";
let config = "";
let ticketBody = "";

function cli(args: string[], moreEnv: Record<string, string> = {}) {
  const r = run("bash", [SCRIPT, ...args], {
    env: { ...process.env, POSTMASTER_CONFIG: config, ...moreEnv },
  });
  return { code: r.code, out: `${r.out}${r.err}` };
}

function adapter(...args: string[]) {
  return run("bash", [LOCAL, repo, ...args]);
}

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  repo = join(temp, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"]);
  config = join(temp, "config.toml");
  writeFileSync(config, '[tracker]\nkind = "local"\n');
  ticketBody = join(temp, "ticket.md");
  writeFileSync(ticketBody, BODY);
  expect(adapter("store", "init").code).toBe(0);
  expect(adapter("create", "Fix the list", ticketBody).code).toBe(0);
  expect(adapter("create", "Fix the list", ticketBody).code).toBe(0);
  expect(adapter("create", "Remove", join(HERE, "../fixtures/tickets/remove/ticket.md")).code).toBe(0);
  writeFileSync(join(temp, "draft.md"), DRAFT);
  expect(adapter("create", "Draft", join(temp, "draft.md")).code).toBe(0);
  writeFileSync(join(temp, "invalid.md"), "A malformed ticket body.\n");
  expect(adapter("create", "Several failures", join(temp, "invalid.md")).code).toBe(0);
  expect(adapter("label", "1", "add", "ready").code).toBe(0);
  expect(adapter("label", "3", "add", "ready").code).toBe(0);
  expect(adapter("label", "4", "add", "ready").code).toBe(0);
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("ticket readiness", () => {
  test("a two-part ticket with a ready label passes both ticket checks", () => {
    const r = cli([repo, "1"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ready: 1");
  });

  test("missing mark, missing agent part and draft line are each reported", () => {
    const missingMark = cli([repo, "2"]);
    expect(missingMark.code).toBe(2);
    expect(missingMark.out).toContain("ready label is missing");

    const missingParts = cli([repo, "3"]);
    expect(missingParts.code).toBe(2);
    expect(missingParts.out).toContain("parts:");

    const draft = cli([repo, "4"]);
    expect(draft.code).toBe(2);
    expect(draft.out).toContain("parts: line 1: draft:");
  });

  test("all failing reasons print, and an unknown ticket is an error", () => {
    const r = cli([repo, "5"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("ready label is missing");
    expect(r.out).toContain("ticket:");
    expect(r.out).toContain("parts:");
    const missing = cli([repo, "999"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("could not read 999");
  });

  test("mark refuses an invalid draft without adding the ready label", () => {
    expect(adapter("label", "3", "remove", "ready").code).toBe(0);
    const r = cli(["mark", repo, "3", "--body", join(HERE, "../fixtures/tickets/remove/ticket.md")]);
    expect(r.code).toBe(2);
    expect(adapter("read", "3").out).not.toContain("labels: ready");
  });

  test("mark writes body and title, adds the label, records turnpikes, and queues the ticket", () => {
    const r = cli(["mark", repo, "2", "--body", ticketBody, "--title", "Fix the list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("marked ready and queued");
    expect(cli([repo, "2"]).code).toBe(0);
    const ticket = adapter("read", "2").out;
    expect(ticket).toContain("title: Fix the list");
    expect(ticket).toContain("labels: ready");
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger).toContain('"action":"note"');
    expect(ledger).toContain('"detail":"turnpikes: style, bug, security"');
    expect(cli(["pending", repo]).out).toContain("2");
  });

  test("opening a ready ticket removes its mark", () => {
    const r = cli(["unmark", repo, "1"]);
    expect(r.code).toBe(0);
    expect(cli([repo, "1"]).out).toContain("ready label is missing");
  });

  test("the other-tracker body and label-list path applies the same checks", () => {
    const body = join(temp, "other.md");
    const labels = join(temp, "labels.txt");
    writeFileSync(body, BODY);
    writeFileSync(labels, "ready\n");
    const pass = cli(["--body", body, "--labels", labels, "--title", "Other ticket", "--project", repo]);
    expect(pass.code).toBe(0);
    writeFileSync(labels, "");
    const fail = cli(["--body", body, "--labels", labels, "--title", "Other ticket", "--project", repo]);
    expect(fail.code).toBe(2);
    expect(fail.out).toContain("ready label is missing");
  });
});
