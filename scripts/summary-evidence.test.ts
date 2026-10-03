// Tests beside scripts/summary-evidence.ts. The script cases run it the way the coachman
// does at harvest — `scripts/run summary-evidence
// <summary> <worktree>` — against a throwaway worktree with an armed ticket, so a clean pass
// and every refusal are shown through the identical command. The core cases call the pure
// functions directly.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  criteriaFromCheckOutput,
  evidencePaths,
  extractTicketBody,
  formatProblem,
  parseEvidenceEntries,
  probeEvidencePath,
  validateEvidence,
} from "./summary-evidence";

const script = join(import.meta.dir, "run");

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
  const items = Array.from(
    { length: count },
    (_, i) => `${i + 1}. Criterion ${i + 1} happens.`,
  ).join("\n");
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
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "POSTMASTER_VERIFY") env[k] = v;
  }
  const r = spawnSync(script, ["summary-evidence", summary, worktree, ...extra], {
    encoding: "utf8",
    env,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const ticketCheck = join(import.meta.dir, "run");

describe("pure core", () => {
  test("a waybill is read from ## Ticket to ## Project profile", () => {
    const body = extractTicketBody(
      `# brief\n\n## Ticket\n${TICKET}\n## Project profile\nrepo: x\n`,
    );
    expect(body).toContain("## Acceptance criteria");
    expect(body).not.toContain("Project profile");
  });

  test("commented and fenced lines are not read for entries", () => {
    const entries = parseEvidenceEntries(
      "## Evidence\n<!--\n1. `.postmaster/verify/a.md`\n-->\nExample only:\n```markdown\n2. `.postmaster/verify/a.md`\n```\n3. `.postmaster/verify/a.md`\n",
    );
    expect(entries.map((e) => e.criterion)).toEqual([3]);
  });

  test("a numbered line indented past the entries' base continues its entry", () => {
    const entries = parseEvidenceEntries(
      "## Evidence\n1. `.postmaster/verify/a.md`\n   1. a nested restatement\n",
    );
    expect(entries.map((e) => e.criterion)).toEqual([1]);
  });

  test("bare slash prose is not a path", () => {
    expect(evidencePaths(["Shown and/or verified"])).toEqual([]);
    expect(evidencePaths(["no browser or CLI/iOS backend"])).toEqual([]);
    expect(evidencePaths(["- .postmaster/verify/a.md"])).toEqual([".postmaster/verify/a.md"]);
  });

  test("a code span is prose until it names the verify directory", () => {
    expect(evidencePaths(["no `CLI/iOS` backend"])).toEqual([]);
    expect(evidencePaths(["`.postmaster/verify/a.md` from `scripts/x.ts`"])).toEqual([
      ".postmaster/verify/a.md",
    ]);
  });

  test("adjacent comments on one line are all stripped", () => {
    const entries = parseEvidenceEntries(
      "## Evidence <!-- a --><!-- b -->\n1. `.postmaster/verify/a.md`\n",
    );
    expect(entries.map((e) => e.criterion)).toEqual([1]);
  });

  test("evidence paths come from code spans or bare tokens, comma-separated or bulleted", () => {
    expect(evidencePaths(["`.postmaster/verify/a.md`, `.postmaster/verify/b.md`"])).toEqual([
      ".postmaster/verify/a.md",
      ".postmaster/verify/b.md",
    ]);
    expect(evidencePaths(["- .postmaster/verify/a.md"])).toEqual([".postmaster/verify/a.md"]);
    expect(evidencePaths(["see .postmaster/verify/a.md."])).toEqual([".postmaster/verify/a.md"]);
    expect(evidencePaths(["shown"])).toEqual([]);
  });

  test("entries keep their criterion numbers and continuation lines", () => {
    const entries = parseEvidenceEntries(
      "## Evidence\nAn intro line.\n1. `.postmaster/verify/a.md`\n2. not shown: x\n",
    );
    expect(entries.map((e) => e.criterion)).toEqual([1, 2]);
  });

  test("a path outside .postmaster/verify is refused, once by .. and once by a symlink", () => {
    const wt = freshWorktree("pure-paths");
    const verify = join(wt, ".postmaster", "verify");
    writeFileSync(join(wt, "outside.md"), "no\n");
    expect(probeEvidencePath(wt, verify, ".postmaster/verify/ok.md")).toEqual({
      path: ".postmaster/verify/ok.md",
      status: "ok",
    });
    expect(probeEvidencePath(wt, verify, ".postmaster/verify/../outside.md").status).toBe(
      "outside",
    );
    symlinkSync(join(wt, "outside.md"), join(verify, "escape.md"));
    expect(probeEvidencePath(wt, verify, ".postmaster/verify/escape.md").status).toBe("outside");
    expect(probeEvidencePath(wt, verify, ".postmaster/verify/missing.md").status).toBe("missing");
    mkdirSync(join(verify, "sub"));
    expect(probeEvidencePath(wt, verify, ".postmaster/verify/sub").status).toBe("not-file");
  });

  test("problems name the criterion and what is wrong", () => {
    const wt = freshWorktree("pure-problems");
    const problems = validateEvidence(
      [1, 2],
      [{ criterion: 1, lines: ["`.postmaster/verify/missing.md`"] }],
      wt,
    );
    expect(problems.map(formatProblem)).toEqual([
      "criterion 1 evidence does not exist: .postmaster/verify/missing.md",
      "criterion 2 is missing from the evidence section",
    ]);
  });
});

describe("the script", () => {
  test("a summary with evidence for every criterion holds", () => {
    const wt = freshWorktree("all");
    const summary = writeSummary(wt, evidenceAll(3));
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria");
  });

  test("a criterion missing from the evidence section is a problem", () => {
    const wt = freshWorktree("missing");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2 is missing from the evidence section");
  });

  test("evidence that does not exist is a problem", () => {
    const wt = freshWorktree("absent");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. \`.postmaster/verify/ghost.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2 evidence does not exist: .postmaster/verify/ghost.md");
  });

  test("a not shown line with its reason is valid for its criterion", () => {
    const wt = freshWorktree("not-shown");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown: the harness has no browser backend\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria (1 not shown)");
  });

  test("a criterion claimed shown with no evidence is a problem", () => {
    const wt = freshWorktree("bare");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. shown\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2 has no evidence path or not shown reason");
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
    const dots = runCheck(viaDots, wt);
    expect(dots.code).toBe(2);
    expect(dots.out).toContain(
      "criterion 1 evidence is outside .postmaster/verify/: .postmaster/verify/../outside.md",
    );
    const viaLink = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/escape.md\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "link.md",
    );
    const link = runCheck(viaLink, wt);
    expect(link.code).toBe(2);
    expect(link.out).toContain(
      "criterion 1 evidence is outside .postmaster/verify/: .postmaster/verify/escape.md",
    );
  });

  test("an entry for a criterion the ticket does not have is a problem", () => {
    const wt = freshWorktree("extra");
    const summary = writeSummary(wt, `${evidenceAll(3)}\n4. \`.postmaster/verify/ok.md\`\n`);
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 4 is not in the ticket");
  });

  test("a criterion with two entries is a problem", () => {
    const wt = freshWorktree("dupe");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. \`.postmaster/verify/ok.md\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 2 has more than one evidence entry");
  });

  test("a summary with no evidence section names each missing criterion", () => {
    const wt = freshWorktree("nosection");
    const summary = writeSummary(wt, "# Summary\n\nNo evidence section here.\n");
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 1 is missing from the evidence section");
    expect(out).toContain("criterion 3 is missing from the evidence section");
  });

  test("an intro line before the first entry is tolerated", () => {
    const wt = freshWorktree("intro");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\nEvidence for the three criteria.\n${evidenceAll(3).split("\n").slice(3).join("\n")}\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria");
  });

  test("a not shown line with no reason, or mixed with paths, is a problem", () => {
    const wt = freshWorktree("reason");
    const empty = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown:\n3. \`.postmaster/verify/ok.md\`\n`,
      "empty.md",
    );
    const r1 = runCheck(empty, wt);
    expect(r1.code).toBe(2);
    expect(r1.out).toContain("criterion 2 has an empty not shown reason");
    const mixed = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown: x, see \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "mixed.md",
    );
    const r2 = runCheck(mixed, wt);
    expect(r2.code).toBe(2);
    expect(r2.out).toContain("criterion 2 mixes not shown with evidence paths");
  });

  test("a not shown reason may contain slashes", () => {
    const wt = freshWorktree("slash-reason");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown: no browser or CLI/iOS backend\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria (1 not shown)");
  });

  test("bare slash prose beside a bare path invents no path", () => {
    const wt = freshWorktree("slash-prose");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. Shown and/or verified via .postmaster/verify/ok.md\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria");
  });

  test("hidden evidence satisfies nothing", () => {
    const wt = freshWorktree("hidden");
    const fenced = writeSummary(
      wt,
      `# Summary\n\n## Evidence\nExample only:\n\`\`\`markdown\n1. \`.postmaster/verify/ok.md\`\n\`\`\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "fenced.md",
    );
    const r1 = runCheck(fenced, wt);
    expect(r1.code).toBe(2);
    expect(r1.out).toContain("criterion 1 is missing from the evidence section");
    const commented = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n<!--\n1. \`.postmaster/verify/ok.md\`\n-->\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "commented.md",
    );
    const r2 = runCheck(commented, wt);
    expect(r2.code).toBe(2);
    expect(r2.out).toContain("criterion 1 is missing from the evidence section");
  });

  test("a code-formatted term with a slash is prose, in a reason or beside a path", () => {
    const wt = freshWorktree("codespan-prose");
    const reason = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n2. not shown: no \`CLI/iOS\` backend\n3. \`.postmaster/verify/ok.md\`\n`,
      "reason.md",
    );
    const r1 = runCheck(reason, wt);
    expect(r1.code).toBe(0);
    expect(r1.out).toContain("evidence shape holds for 3 criteria (1 not shown)");
    const beside = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\` from \`scripts/summary-evidence.ts\`\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "beside.md",
    );
    const r2 = runCheck(beside, wt);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain("evidence shape holds for 3 criteria");
  });

  test("a not shown on a continuation line is prose, neither a pass nor a mix", () => {
    const wt = freshWorktree("continuation");
    const shown = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n   not shown: also checked by hand\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "shown.md",
    );
    const r1 = runCheck(shown, wt);
    expect(r1.code).toBe(0);
    expect(r1.out).toContain("evidence shape holds for 3 criteria");
    expect(r1.out).not.toContain("not shown)");
    const pathless = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. Shown working\n   not shown: n/a\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "pathless.md",
    );
    const r2 = runCheck(pathless, wt);
    expect(r2.code).toBe(2);
    expect(r2.out).toContain("criterion 1 has no evidence path or not shown reason");
  });

  test("a stray numbered line past a part-naming subheading is not a criterion", () => {
    const ticket = `# A thing

## Problem / feature
Things need doing.

## Acceptance criteria
1. The first thing happens.
2. The second thing happens.
3. The third thing happens.
### Direction
9. Stray numbered line.

## Direction
None.
## Turnpikes
default
`;
    const wt = freshWorktree("subheading", ticket);
    const summary = writeSummary(wt, evidenceAll(3));
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria");
  });

  test("--ticket holds the summary to the run's criteria, not the armed copy", () => {
    const wt = freshWorktree("ticket-flag", ticketWith(1));
    const ticket = join(wt, "ticket-two.md");
    writeFileSync(ticket, ticketWith(2));
    const summary = writeSummary(wt, evidenceAll(1));
    expect(runCheck(summary, wt).code).toBe(0);
    const held = runCheck(summary, wt, ["--ticket", ticket]);
    expect(held.code).toBe(2);
    expect(held.out).toContain("criterion 2 is missing from the evidence section");
  });

  test("--ticket reads a waybill's ticket part", () => {
    const wt = freshWorktree("waybill", ticketWith(1));
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

  test("a bare path beside a code citation is checked too", () => {
    const wt = freshWorktree("second-citation");
    const missing = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\` .postmaster/verify/ghost.md\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "missing.md",
    );
    const r1 = runCheck(missing, wt);
    expect(r1.code).toBe(2);
    expect(r1.out).toContain("criterion 1 evidence does not exist: .postmaster/verify/ghost.md");
    const escaping = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\` .postmaster/verify/../outside.md\n2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
      "escaping.md",
    );
    const r2 = runCheck(escaping, wt);
    expect(r2.code).toBe(2);
    expect(r2.out).toContain(
      "criterion 1 evidence is outside .postmaster/verify/: .postmaster/verify/../outside.md",
    );
  });

  test("an entry indented up to two past the base starts, as for criteria", () => {
    const wt = freshWorktree("indented-entry");
    const summary = writeSummary(
      wt,
      `# Summary\n\n## Evidence\n1. \`.postmaster/verify/ok.md\`\n  2. \`.postmaster/verify/ok.md\`\n3. \`.postmaster/verify/ok.md\`\n`,
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 3 criteria");
  });

  test("a fence body opened by an entry line holds no evidence", () => {
    const wt = freshWorktree("fenced-item");
    const summary = writeSummary(
      wt,
      "# Summary\n\n## Evidence\n1. ```\n.postmaster/verify/ok.md\n```\n",
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("criterion 1 has no evidence path or not shown reason");
  });
});

describe("criteria from ticket-check.sh", () => {
  test("pins the well-formed line the checker reads", () => {
    // If run ticket-check changes this line, this test fails here, not in a lane's run.
    const dir = mkdtempSync(join(tmpdir(), "pin-"));
    try {
      const file = join(dir, "ticket.md");
      writeFileSync(file, ticketWith(3));
      const r = spawnSync(ticketCheck, ["ticket-check", "--body", file, "--project", dir], {
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect((r.stdout ?? "").split("\n")[0] ?? "").toBe("well-formed, 3 acceptance criteria");
      expect(criteriaFromCheckOutput(r.stdout ?? "")).toEqual([1, 2, 3]);
      expect(
        criteriaFromCheckOutput(
          "acceptance criteria: numbered 1, 3; number them 1 to 2 in order\n",
        ),
      ).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a ticket the reader refuses is reported with its message and exits 2", () => {
    const ticket = `# A thing

## Problem / feature
Things need doing.

## Acceptance criteria
1. The first thing happens.
3. The third thing happens.

## Direction
None.
## Turnpikes
default
`;
    const wt = freshWorktree("refused", ticket);
    const summary = writeSummary(wt, evidenceAll(3));
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(2);
    expect(out).toContain("acceptance criteria: numbered 1, 3; number them 1 to 2 in order");
  });

  test("a missing ticket file exits 1", () => {
    const wt = freshWorktree("no-ticket");
    rmSync(join(wt, ".postmaster", "verify", "ticket.md"));
    const summary = writeSummary(wt, evidenceAll(3));
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(1);
    expect(out).toContain("cannot read ticket");
  });

  const readerShapes: { name: string; criteria: string; count: number }[] = [
    {
      name: "a bare ## heading ends the criteria",
      criteria: "1. The first thing happens.\n##\n2. The second thing happens.\n",
      count: 1,
    },
    {
      name: "an unclosed comment opener is text",
      criteria:
        "1. The parser fails on <!-- when nothing closes it.\n2. The second thing happens.\n",
      count: 2,
    },
    {
      name: "a list item opening a fence",
      criteria: "1. ```\n   make check\n   ```\n2. The gate passes.\n",
      count: 2,
    },
    {
      name: "items indented past the base",
      criteria:
        "1. The first thing happens.\n 2. The second thing happens.\n  3. The third thing happens.\n",
      count: 3,
    },
    {
      name: "an opener in a code span",
      criteria: "1. Handles `<!--` markers here.\n2. The second thing happens.\n",
      count: 2,
    },
  ];

  for (const { name, criteria, count } of readerShapes) {
    test(`the reader's count holds through the checker: ${name}`, () => {
      const ticket = `# A thing

## Problem / feature
Things need doing.

## Acceptance criteria
${criteria}
## Direction
None.
## Turnpikes
default
`;
      const wt = freshWorktree(`reader-${count}-${name.length}`, ticket);
      const summary = writeSummary(wt, evidenceAll(count));
      const { code, out } = runCheck(summary, wt);
      expect(code).toBe(0);
      expect(out).toContain(`evidence shape holds for ${count} criteria`);
    });
  }

  test("an all-not-shown summary with its transcript kept holds green", () => {
    const wt = freshWorktree("all-not-shown", ticketWith(2));
    writeFileSync(join(wt, ".postmaster", "verify", "check.md"), "summary-evidence transcript\n");
    const summary = writeSummary(
      wt,
      "# Summary\n\n## Evidence\n1. not shown: the harness has no browser backend\n2. not shown: the harness has no browser backend\n",
    );
    const { code, out } = runCheck(summary, wt);
    expect(code).toBe(0);
    expect(out).toContain("evidence shape holds for 2 criteria (2 not shown)");
  });
});
