// Oracle for #169, committed before the change: on Claude Code the
// postmaster hands its steps to helpers, and keeps only talking, deciding
// and starting them. Every test spawns `scripts/run` as a subprocess and
// never imports the change. Timeouts are scaled down from the ticket's 30s
// to keep the test fast; the controls are the same shape. Covered: C1b
// (the closed list of scripts the postmaster runs itself, plus
// runbook-lint), C4a (hold then watch exit 3 naming nothing; release then
// watch names at its first look), C4c (a hold from an earlier session is
// released when the next starts; a hand-written line stays), C5 (a second
// hold is refused and the first stays). Not covered: C1a, C2, C3, C4b (the
// live interactive session, at verification), C6 (its contract exit holds
// vacuously at the base; the fixture run scores at landing through Stage F).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SELF,
  configFor,
  heldLines,
  hold,
  mkRun,
  release,
  releaseStale,
  scratch,
  selfScripts,
  sessionToken,
  statusNext,
  watch,
} from "./acceptance-169.ts";
import { run } from "./lib/proc.ts";

const ALLOWED_SELF = ["log-action", "runs-hold", "host", "runs-watch", "wait-for-markers"];

function heldRoot(dir: string, ticket: string): { cfg: string; root: string } {
  const cfg = configFor(dir);
  const root = join(dir, "runs");
  mkdirSync(join(root, "postmaster"), { recursive: true });
  mkRun(root, ticket, null);
  return { cfg, root };
}

describe("C1b: the postmaster itself runs only the closed list", () => {
  test("no tool script beyond the allowed ones outside the helper briefs", () => {
    const md = readFileSync(
      join(import.meta.dir, "..", "skills", "postmaster", "postmaster.md"),
      "utf8",
    );
    const extra = selfScripts(md).filter((name) => !ALLOWED_SELF.includes(name));
    expect(extra).toEqual([]);
  });

  test("runbook-lint exits 0", () => {
    expect(run(SELF, ["runbook-lint"]).code).toBe(0);
  });
});

describe("C4a: a held run is left alone, a released run is named", () => {
  test("hold then watch exits 3 naming nothing; release then watch names at its first look", () => {
    const dir = scratch("c4a");
    try {
      const { cfg, root } = heldRoot(dir, "T-1");
      const h = hold(root, cfg, "T-1", "stage-f");
      expect(h.code).toBe(0);
      const lines = heldLines(root);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^T-1 helper=stage-f session=\S+$/u); // ASCII: the session token is ASCII hex
      const early = watch(root, cfg, "2");
      expect(early.code).toBe(3);
      expect(`${early.out}${early.err}`).not.toContain("needs T-1");
      const r = release(root, cfg, "T-1");
      expect(r.code).toBe(0);
      // Timeout 0 is exactly one look: the release names it at its first.
      const late = watch(root, cfg, "0");
      expect(late.code).toBe(0);
      expect(`${late.out}${late.err}`).toContain("needs T-1 GATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unheld run is named (positive control)", () => {
    const dir = scratch("c4a-control");
    try {
      const { cfg, root } = heldRoot(dir, "T-1");
      expect(statusNext(root, cfg, "T-1")).toBe("GATE");
      const r = watch(root, cfg, "0");
      expect(r.code).toBe(0);
      expect(`${r.out}${r.err}`).toContain("needs T-1 GATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C4c: a hold from an earlier session is released at the next start", () => {
  test("release-stale drops the helper hold and keeps the hand-written line", () => {
    const dir = scratch("c4c");
    try {
      const { cfg, root } = heldRoot(dir, "T-1");
      writeFileSync(join(root, "postmaster", "held"), "T-9\n");
      expect(hold(root, cfg, "T-1", "stage-f").code).toBe(0);
      const before = sessionToken(root);
      const r = releaseStale(root, cfg);
      expect(r.code).toBe(0);
      expect(heldLines(root)).toEqual(["T-9"]);
      expect(sessionToken(root)).not.toBe(before);
      expect(hold(root, cfg, "T-1", "stage-g").code).toBe(0);
      expect(heldLines(root)).toEqual(["T-9", `T-1 helper=stage-g session=${sessionToken(root)}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C5: a second hold on the run is refused", () => {
  test("a second helper hold is refused and the first stays", () => {
    const dir = scratch("c5");
    try {
      const { cfg, root } = heldRoot(dir, "T-1");
      expect(hold(root, cfg, "T-1", "first").code).toBe(0);
      const second = hold(root, cfg, "T-1", "second");
      expect(second.code).not.toBe(0);
      expect(`${second.out}${second.err}`).toMatch(/already held/u);
      const lines = heldLines(root);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^T-1 helper=first session=\S+$/u); // ASCII: the session token is ASCII hex
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a hold on a hand-held run is refused and the hand line stays", () => {
    const dir = scratch("c5-hand");
    try {
      const { cfg, root } = heldRoot(dir, "T-1");
      writeFileSync(join(root, "postmaster", "held"), "T-1\n");
      const h = hold(root, cfg, "T-1", "stage-f");
      expect(h.code).not.toBe(0);
      expect(`${h.out}${h.err}`).toMatch(/already held/u);
      expect(heldLines(root)).toEqual(["T-1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
