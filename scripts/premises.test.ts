// Tests beside scripts/premises.ts: the premises check between Verified at and the base.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "premises.sh");

let tmp = "";
let repo = "";

function git(...args: string[]) {
  return run("git", ["-C", repo, ...args]);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "premises-test-"));
  repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", repo]);
  run("git", ["-C", repo, "config", "user.name", "test"]);
  run("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  // Create a file with known content.
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts", "example.ts"), "line1\nline2\nline3\nline4\nline5\n", "utf8");
  run("git", ["-C", repo, "add", "."]);
  run("git", ["-C", repo, "commit", "-q", "-m", "initial"]);
  const v = run("git", ["-C", repo, "rev-parse", "HEAD"]);
  const verified = v.out.trim().slice(0, 7);
  // Move the content down ten lines (adding blank lines at top).
  writeFileSync(
    join(repo, "scripts", "example.ts"),
    "\n\n\n\n\n\n\n\n\n\nline1\nline2\nline3\nline4\nline5\n",
    "utf8",
  );
  run("git", ["-C", repo, "add", "."]);
  run("git", ["-C", repo, "commit", "-q", "-m", "moved"]);
  // Record the base after the move (same content, different position).
  const baseMoved = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
  // Change the content.
  writeFileSync(
    join(repo, "scripts", "example.ts"),
    "line1\nCHANGED\nline3\nline4\nline5\n",
    "utf8",
  );
  run("git", ["-C", repo, "add", "."]);
  run("git", ["-C", repo, "commit", "-q", "-m", "changed"]);
  const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
  // Write ticket bodies.
  const movedTicket = [
    "## Problem / feature",
    "Test.",
    "",
    "## Acceptance criteria",
    "1. Something is true.",
    "",
    "## Direction",
    "None.",
    "",
    "## Turnpikes",
    "none",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- **C1** Run it. **At the base:** nothing.",
    "",
    "### Technical notes",
    "",
    `- See \`scripts/example.ts#L1-L5\`. (C1)`,
    "",
    `### Verified at ${verified}`,
    "",
    "- The file exists.",
    "",
  ].join("\n");
  writeFileSync(join(tmp, "moved.md"), movedTicket, "utf8");
  // A ticket citing lines that changed.
  const changedTicket = [
    "## Problem / feature",
    "Test.",
    "",
    "## Acceptance criteria",
    "1. Something is true.",
    "",
    "## Direction",
    "None.",
    "",
    "## Turnpikes",
    "none",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- **C1** Run it. **At the base:** nothing.",
    "",
    "### Technical notes",
    "",
    "- See `scripts/example.ts#L1-L2`. (C1)",
    "",
    `### Verified at ${verified}`,
    "",
    "- The file exists.",
    "",
  ].join("\n");
  writeFileSync(join(tmp, "changed.md"), changedTicket, "utf8");
  // A ticket citing a missing file.
  const missingTicket = [
    "## Problem / feature",
    "Test.",
    "",
    "## Acceptance criteria",
    "1. Something is true.",
    "",
    "## Direction",
    "None.",
    "",
    "## Turnpikes",
    "none",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- **C1** Run it. **At the base:** nothing.",
    "",
    "### Technical notes",
    "",
    "- See `scripts/gone.ts`. (C1)",
    "",
    `### Verified at ${verified}`,
    "",
    "- The file exists.",
    "",
  ].join("\n");
  writeFileSync(join(tmp, "missing.md"), missingTicket, "utf8");
  // A ticket citing untouched content.
  writeFileSync(join(repo, "scripts", "stable.ts"), "stable1\nstable2\n", "utf8");
  run("git", ["-C", repo, "add", "."]);
  run("git", ["-C", repo, "commit", "-q", "-m", "stable"]);
  const verified2 = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim().slice(0, 7);
  const sameTicket = [
    "## Problem / feature",
    "Test.",
    "",
    "## Acceptance criteria",
    "1. Something is true.",
    "",
    "## Direction",
    "None.",
    "",
    "## Turnpikes",
    "none",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- **C1** Run it. **At the base:** nothing.",
    "",
    "### Technical notes",
    "",
    "- See `scripts/stable.ts#L1-L2`. (C1)",
    "",
    `### Verified at ${verified2}`,
    "",
    "- The file exists.",
    "",
  ].join("\n");
  writeFileSync(join(tmp, "same.md"), sameTicket, "utf8");
  // Record the base for the tests.
  writeFileSync(join(tmp, "base.txt"), base, "utf8");
  writeFileSync(join(tmp, "base-moved.txt"), baseMoved, "utf8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("premises", () => {
  test("a range that moved down ten lines gives moved, exit 0", () => {
    const base = readFileSync(join(tmp, "base-moved.txt"), "utf8").trim();
    const r = run(SELF, [repo, base, join(tmp, "moved.md")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("moved");
  });

  test("a range whose text changed gives changed, exit 2", () => {
    const base = readFileSync(join(tmp, "base.txt"), "utf8").trim();
    const r = run(SELF, [repo, base, join(tmp, "changed.md")]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("changed");
  });

  test("a file that is gone gives missing, exit 2", () => {
    const base = readFileSync(join(tmp, "base.txt"), "utf8").trim();
    const r = run(SELF, [repo, base, join(tmp, "missing.md")]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("missing");
  });

  test("untouched content gives same, exit 0", () => {
    const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
    const r = run(SELF, [repo, base, join(tmp, "same.md")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("same");
  });

  test("an unknown verified commit makes every place unknown, exit 0", () => {
    const body = [
      "## Problem / feature",
      "Test.",
      "",
      "## Acceptance criteria",
      "1. Something is true.",
      "",
      "## Direction",
      "None.",
      "",
      "## Turnpikes",
      "none",
      "",
      "## For the agents",
      "",
      "### Checks",
      "",
      "- **C1** Run it. **At the base:** nothing.",
      "",
      "### Technical notes",
      "",
      "- See `scripts/example.ts`. (C1)",
      "",
      "### Verified at 0000000",
      "",
      "- The file exists.",
      "",
    ].join("\n");
    const f = join(tmp, "unknown.md");
    writeFileSync(f, body, "utf8");
    const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
    const r = run(SELF, [repo, base, f]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unknown");
  });
});
