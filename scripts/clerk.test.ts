import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const CLERK = join(HERE, "clerk.sh");
const LOCAL = join(HERE, "local.sh");
const READY = join(HERE, "ticket-ready.sh");
const BODY = `## Problem / feature
The list does not show what the user asked for.

## Acceptance criteria
1. The reader checks whether the code meets the user's request.
2. The reader names any important behavior the request leaves uncovered.

## Direction
Keep the list readable.

## Turnpikes
default

## For the agents

### Checks
- **C1** The reader reports checks and guesses.

### Technical notes
- The list lives in src/list.ts. (C1)

### Verified at 0000000000000000000000000000000000000000
The fixture base is verified.
`;

const CLAUDE_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$POSTMASTER_READER_CAPTURE"
if [ "\${POSTMASTER_READER_FAIL:-}" = 1 ]; then exit 7; fi
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"reader-claude","model":"claude-test"}' '{"type":"result","subtype":"success","result":"Checks: criteria covered.\\nGuesses: none."}'
`;

const CODEX_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$POSTMASTER_READER_CAPTURE"
last=""
previous=""
for value in "$@"; do
  if [ "$previous" = -o ]; then last=$value; fi
  previous=$value
done
[ -n "$last" ] || exit 8
printf '%s\\n' 'Checks: criteria covered.' 'Guesses: none.' > "$last"
printf '%s\\n' '{"type":"thread.started","thread_id":"reader-codex"}' '{"type":"item.completed","item":{"type":"agent_message","text":"Checks: criteria covered.\\nGuesses: none."}}'
`;

let temp = "";
let repo = "";
let config = "";
let bin = "";
let home = "";
let bodyPath = "";
let draft = "";
let capture = "";

function cli(args: string[], extra: Record<string, string | undefined> = {}) {
  const result = run("bash", [CLERK, ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      POSTMASTER_CONFIG: config,
      POSTMASTER_HOST: "none",
      POSTMASTER_READER_CAPTURE: capture,
      ...extra,
    },
  });
  return { code: result.code, out: result.out, err: result.err };
}

function local(...args: string[]) {
  return run("bash", [LOCAL, repo, ...args]);
}

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "clerk-"));
  repo = join(temp, "repo");
  home = join(temp, "home");
  bin = join(temp, "bin");
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"]);
  config = join(temp, "config.toml");
  writeFileSync(config, `[tracker]\nkind = "local"\n\n[team]\nworkhorses = ["codex_lane", "claude_lane"]\nclerk = { harness = "claude", model = "claude-clerk", effort = "high" }\n\n[lanes.codex_lane]\nharness = "codex"\nmodel = "codex-reader"\n\n[lanes.claude_lane]\nharness = "claude"\nmodel = "claude-reader"\n`);
  writeFileSync(join(bin, "claude"), CLAUDE_STUB, { mode: 0o755 });
  writeFileSync(join(bin, "codex"), CODEX_STUB, { mode: 0o755 });
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "codex"), 0o755);
  bodyPath = join(temp, "ticket.md");
  writeFileSync(bodyPath, BODY);
  expect(local("store", "init").code).toBe(0);
  expect(local("create", "Fix the list", bodyPath).code).toBe(0);
  expect(local("create", "Fix the list", bodyPath).code).toBe(0);
  expect(local("label", "1", "add", "ready").code).toBe(0);
  expect(local("label", "2", "add", "ready").code).toBe(0);
  draft = join(temp, "draft.md");
  writeFileSync(draft, `DRAFT: waiting for sign-off\n\n${BODY}`);
  capture = join(temp, "reader-argv.txt");
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("booking clerk brief", () => {
  test("the shared brief names the ticket and removes an old ready mark", () => {
    const result = cli(["brief", repo, "1"]);
    expect(result.code).toBe(0);
    const brief = readFileSync(result.out.trim(), "utf8");
    expect(brief).toContain("# Booking clerk brief: #1, Fix the list");
    expect(brief).toContain("Runbook: ");
    expect(brief).toContain("/skills/clerk/clerk.md");
    expect(local("read", "1").out).toContain("labels: \n");
    const readiness = run("bash", [READY, repo, "1"], { env: { ...process.env, POSTMASTER_CONFIG: config } });
    expect(readiness.code).toBe(2);
    expect(readiness.out).toContain("ready label is missing");
  });

  test("headless start asks the user to start /clerk and writes no run", () => {
    const result = cli(["start", repo, "2"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("start /clerk 2");
    const brief = readFileSync(join(repo, ".postmaster", "clerk", "2.brief.md"), "utf8");
    expect(brief).toContain("Ticket id: 2");
    expect(brief).toContain("# Booking clerk brief: #2, Fix the list");
    expect(existsSync(join(repo, ".postmaster", "runs", "2"))).toBe(false);
    expect(run("git", ["-C", repo, "branch", "--list", "2"]).out.trim()).toBe("");
  });

  test("the interactive form carries the Herdr tab's ticket name", () => {
    const result = run("bash", [join(HERE, "launch.sh"), "form", "clerk", "--project", repo, "--interactive", "--name", "#2, Fix the list"], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}`, POSTMASTER_CONFIG: config },
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain(String.raw`--name \#2\,\ Fix\ the\ list`);
  });
});

describe("fresh reader", () => {
  test("Claude clerk uses a Codex reader and prints its checks and guesses", () => {
    const result = cli(["reader", "claude-clerk", draft, repo]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Checks: criteria covered.");
    expect(result.out).toContain("Guesses: none.");
    expect(result.out).toContain("reader: codex_lane (codex-reader)");
    const prompt = readFileSync(capture, "utf8");
    expect(prompt).toContain("The list does not show what the user asked for.");
    expect(prompt).toContain(`Code worktree: ${repo}`);
    expect(prompt).not.toContain("The list lives in src/list.ts");
  }, 30000);

  test("Codex clerk uses a Claude reader and prints its checks and guesses", () => {
    const result = cli(["reader", "codex-reader", draft, repo]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Checks: criteria covered.");
    expect(result.out).toContain("Guesses: none.");
    expect(result.out).toContain("reader: claude_lane (claude-reader)");
    const prompt = readFileSync(capture, "utf8");
    expect(prompt).toContain("The list does not show what the user asked for.");
    expect(prompt).toContain(`Code worktree: ${repo}`);
    expect(prompt).not.toContain("The list lives in src/list.ts");
  }, 30000);

  test("no lane on another model and a failed reader both refuse with a reason", () => {
    const original = readFileSync(config, "utf8");
    writeFileSync(config, original.replace('workhorses = ["codex_lane", "claude_lane"]', 'workhorses = ["claude_lane"]'));
    const noLane = cli(["reader", "claude-reader", draft, repo]);
    expect(noLane.code).toBe(1);
    expect(noLane.err).toContain("no configured lane uses a model other than the clerk's model");
    writeFileSync(config, original);
    const failed = cli(["reader", "codex-reader", draft, repo], { POSTMASTER_READER_FAIL: "1" });
    expect(failed.code).not.toBe(0);
    expect(`${failed.err}${failed.out}`).toContain("fresh reader claude_lane exited without a final message");
  }, 30000);
});
