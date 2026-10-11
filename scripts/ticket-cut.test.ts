// Tests beside scripts/ticket-cut.ts: the usage contract and the pass-through.
// The cut shapes are pinned by the #407 oracle through the same command.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "run");

describe("usage", () => {
  test("no file exits 1 and prints usage", () => {
    const r = run(SELF, ["ticket-cut"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage: run ticket-cut <ticket-file>");
  });

  test("an unreadable file exits 1 and names it", () => {
    const r = run(SELF, ["ticket-cut", join(tmpdir(), "ticket-cut-no-such-file.md")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot read");
  });
});

describe("pass-through", () => {
  test("a ticket with no agents part prints unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-cut-"));
    try {
      const text = "# T\n\n## Problem / feature\n\nP.\n";
      const path = join(dir, "plain.md");
      writeFileSync(path, text, "utf8");
      const r = run(SELF, ["ticket-cut", path]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an agents part with neither section prints unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-cut-"));
    try {
      const text = "# T\n\n## For the agents\n\n### Checks\n\n- **C1** One.\n";
      const path = join(dir, "checks.md");
      writeFileSync(path, text, "utf8");
      const r = run(SELF, ["ticket-cut", path]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("large and odd inputs", () => {
  test("a ticket over the pipe buffer prints whole through a pipe", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-cut-"));
    try {
      const filler = "Filler line for size padding 0123456789abcdef.\n".repeat(3000);
      const text =
        `# T\n\n## Problem / feature\n\n${filler}\n## For the agents\n\n` +
        "### Checks\n\n- **C1** One.\n\n### Technical notes\n\nDropped.\n\n### Verified at abc1234\n\n- V.\n";
      const path = join(dir, "big.md");
      writeFileSync(path, text, "utf8");
      const r = run(SELF, ["ticket-cut", path]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("### Technical notes");
      expect(r.out).toContain("Filler line");
      expect(r.out.length).toBeGreaterThan(65536);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a CRLF ticket is cut like its LF twin", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-cut-"));
    try {
      const lf =
        "# T\n\n## For the agents\n\n### Checks\n\n- **C1** One.\n\n" +
        "### Technical notes\n\nDropped.\n\n### Verified at abc1234\n\n- V.\n";
      const path = join(dir, "crlf.md");
      writeFileSync(path, lf.replace(/\n/gu, "\r\n"), "utf8");
      const r = run(SELF, ["ticket-cut", path]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("### Technical notes");
      expect(r.out).not.toContain("\r");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
