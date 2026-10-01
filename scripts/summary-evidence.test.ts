// Tests beside scripts/summary-evidence.ts. Each case runs the script the way the coachman does
// at harvest — `bun scripts/summary-evidence.ts <summary> <worktree>` — against a throwaway
// worktree with an armed ticket, so a clean pass and every refusal are shown through the
// identical command.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkEvidence,
  checkPath,
  extractTicketBody,
  parseCriteria,
  parseEvidence,
  parseEvidenceEntry,
  formatProblem,
} from "./summary-evidence";

const script = join(import.meta.dir, "summary-evidence.ts");

const TICKET = `# A thing

## Problem / feature
Things need doing.

## Acceptance criteria
1. The first thing happens.
2. The second thing happens, with a detail
   that runs on under it.
3. The third thing happens.

## Direction
None.
## Turnpikes
default
`;

function ticketWith(count: number): string {
  const items = Array.from({ length: count }, (_, i) => `${i + 1}. Criterion ${i + 1} happens.`).join(
    "\n",
  );
  return `# A thing

## Problem / feature
Things need doing.

## Acceptance criteria
${items}

## Direction
None.
## Turnpikes
default
`;
}

function evidenceAll(count: number, file = "ok.md"): string {
  const items = Array.from(
    { length: count },
    (_, i) => `${i + 1}. \`.postmaster/verify/${file}\``,
  ).join("\n");
  return `# Summary

## Evidence
${items}
`;
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "summary-evidence-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function freshWorktree(name: string, ticketText = TICKET): string {
  const wt = join(root, name);
  mkdirSync(join(wt, ".postmaster", "verify"), { recursive: true });
  writeFileSync(join(wt, ".postmaster", "verify", "ticket.md"), ticketText);
  writeFileSync(join(wt, ".postmaster", "verify", "ok.md"), "transcript\n");
  return wt;
}

function writeSummary(wt: string, text: string, name = "WORKHORSE-SUMMARY.md"): string {
  const p = join(wt, name);
  writeFileSync(p, text);
  return p;
}

function runCheck(summary: string, worktree: string, extra: string[] = []) {
  const r = spawnSync("bun", [script, summary, worktree, ...extra], { encoding: "utf8" });
  return {
    code: r.status ?? -1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

describe("pure core", () => {
  test("a waybill is read from ## Ticket to ## Project profile", () => {
    const body = extractTicketBody(`# brief\n\n## Ticket\n${TICKET}\n## Project profile\nrepo: x\n`);
    expect(body).toContain("## Acceptance criteria");
    expect(body).not.toContain("Project profile");
  });

  test("criteria are numbered 1 to n, and continuation lines belong to the item above", () => {
    expect(parseCriteria(TICKET)).toEqual([1, 2, 3]);
    const items = parseEvidence("## Evidence\n1. `.postmaster/verify/a.md`\n2. `.postmaster/verify/b.md`\n");
    expect(items.get(1)).toEqual({ kind: "paths", paths: [".postmaster/verify/a.md"] });
  });

  test("an entry is paths, a not shown line, or bare", () => {
    expect(parseEvidenceEntry("`.postmaster/verify/a.md`, `.postmaster/verify/b.md`")).toEqual({
      kind: "paths",
      paths: [".postmaster/verify/a.md", ".postmaster/verify/b.md"],
    });
    expect(parseEvidenceEntry("not shown: no browser backend")).toEqual({
      kind: "not-shown",
      reason: "no browser backend",
    });
    expect(parseEvidenceEntry("shown")).toEqual({ kind: "bare" });
  });

  test("a path outside .postmaster/verify is refused, once by .. and once by a symlink", () => {
    const wt = freshWorktree("pure-paths");
    writeFileSync(join(wt, "outside.md"), "no\n");
    expect(checkPath(wt, ".postmaster/verify/ok.md")).toEqual({ ok: true });
    expect(checkPath(wt, ".postmaster/verify/../outside.md")).toEqual({
      ok: false,
      reason: "outside .postmaster/verify",
    });
    const link = join(wt, ".postmaster", "verify", "escape.md");
    symlinkSync(join(wt, "outside.md"), link);
    expect(checkPath(wt, ".postmaster/verify/escape.md")).toEqual({
      ok: false,
      reason: "outside .postmaster/verify",
    });
    expect(checkPath(wt, ".postmaster/verify/missing.md")).toEqual({
      ok: false,
      reason: "does not exist",
    });
  });

  test("problems name the criterion and what is wrong", () => {
    const wt = freshWorktree("pure-problems");
    const problems = checkEvidence(
      [1, 2],
      new Map([
        [1, { kind: "paths", paths: [".postmaster/verify/missing.md"] } as const],
      ]),
      wt,
    );
    expect(problems.map(formatProblem)).toEqual([
      "criterion 1: .postmaster/verify/missing.md: does not exist",
      "criterion 2: no evidence entry",
    ]);
  });
});

describe("the script", () => {
  test("a summary with evidence for every criterion holds", () => {
    const wt = freshWorktree("all");
    const summary = writeSummary(wt, evidenceAll(3));
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("the summary holds");
  });

  test("a criterion missing a criterion's evidence is a problem", () => {
    const wt = freshWorktree("missing");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2: no evidence entry");
  });

  test("evidence that does not exist is a problem", () => {
    const wt = freshWorktree("absent");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. \`.postmaster/verify/ghost.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2: .postmaster/verify/ghost.md: does not exist");
  });

  test("a not shown line is valid evidence for its criterion", () => {
    const wt = freshWorktree("not-shown");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown: the harness has no browser backend\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("the summary holds");
  });

  test("a criterion claimed shown with no evidence is a problem", () => {
    const wt = freshWorktree("bare");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. shown\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2: claimed shown with no evidence and no not shown line");
  });

  test("a path outside .postmaster/verify is a problem, once by .. and once by a symlink", () => {
    const wt = freshWorktree("escape");
    writeFileSync(join(wt, "outside.md"), "no\n");
    symlinkSync(join(wt, "outside.md"), join(wt, ".postmaster", "verify", "escape.md"));
    const viaDots = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/../outside.md\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "dots.md",
    );
    expect(runCheck(viaDots, wt)).toEqual({
      code: 2,
      out: "criterion 1: .postmaster/verify/../outside.md: outside .postmaster/verify\nthe summary does not hold: 1 problem(s)\n",
    });
    const viaLink = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/escape.md\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "link.md",
    );
    const r = runCheck(viaLink, wt);
    expect(r.code).toBe(2);
    expect(r.out).toContain("criterion 1: .postmaster/verify/escape.md: outside .postmaster/verify");
  });

  test("--ticket reads a waybill's ticket part", () => {
    const wt = freshWorktree("waybill", ticketWith(1));
    writeFileSync(join(wt, ".postmaster", "verify", "ok.md"), "x\n");
    const waybill = join(wt, "brief.md");
    writeFileSync(waybill, `# brief\n\n## Ticket\n${ticketWith(2)}\n## Project profile\nrepo: x\n`);
    const summary = writeSummary(wt, evidenceAll(2));
    expect(runCheck(summary, wt, ["--ticket", waybill]).code).toBe(0);
    expect(existsSync(join(wt, ".postmaster", "verify", "ticket.md"))).toBe(true);
  });

  test("usage and an unreadable input exit 1", () => {
    const wt = freshWorktree("usage");
    expect(runCheck(join(wt, "nope.md"), wt).code).toBe(1);
    expect(runCheck(join(wt, "nope.md"), wt, ["--ticket"]).code).toBe(1);
  });
});
