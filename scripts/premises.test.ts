// Tests beside scripts/premises.ts: the verdicts between Verified at and base,
// the unknown cases, and the command's exits.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { citationsFromText, parseRange } from "./premises.ts";

const SELF = join(import.meta.dir, "run");

let root = "";
let repo = "";
let verified = "";

function git(...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(r.err || r.out);
  return (r.out ?? "").trim();
}

function commitFile(path: string, content: string, message: string): string {
  writeFileSync(join(repo, path), content);
  git("add", ".");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function ticketBody(sha: string, cites: string): string {
  const path = join(root, "ticket.md");
  writeFileSync(
    path,
    [
      "## Problem / feature",
      "",
      "The list view shows entries unsorted.",
      "",
      "## For the agents",
      "",
      "### Checks",
      "",
      "- **C1** x → y. **At the base:** z.",
      "",
      "### Technical notes",
      "",
      ...cites.split("\n"),
      "",
      `### Verified at ${sha}`,
      "",
      "- The list renders as cited.",
      "",
    ].join("\n"),
  );
  return path;
}

function cli(args: string[]): { code: number; out: string } {
  const r = run("bash", [SELF, "premises", ...args]);
  return { code: r.code, out: `${r.out ?? ""}${r.err ?? ""}` };
}

const LINK = (sha: string, path: string, range: string) =>
  `[cited](https://github.com/example/fixture/blob/${sha}/${path}#${range})`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "premises-test-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["-C", repo, "config", "user.name", "premises-test"]);
  run("git", ["-C", repo, "config", "user.email", "premises-test@example.invalid"]);
  const lines = Array.from({ length: 30 }, (_, i) => `filler line ${i + 1}`);
  lines[4] = "THE CITED MARKER LINE";
  verified = commitFile("docs/a.md", `${lines.join("\n")}\n`, "verified");
  commitFile("docs/b.md", "untouched helper\n", "helpers");
  verified = git("rev-parse", "HEAD~1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cite extraction", () => {
  test("reads links and paths from the agents' part once", () => {
    const text = [
      "## Problem / feature",
      "Not a code link.",
      "",
      "## For the agents",
      "",
      "- [file](https://github.com/a/b/blob/abc1234/scripts/sample.ts#L2-L3)",
      "- `scripts/sample.ts#L2-L3`",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites).toHaveLength(1);
    expect(cites[0]?.path).toBe("scripts/sample.ts");
    expect(cites[0]?.start).toBe(2);
    expect(cites[0]?.end).toBe(3);
  });

  test("reads cites below a variant-case agents heading, as readiness accepts", () => {
    const text = [
      "## FOR THE AGENTS",
      "",
      "- [file](https://github.com/a/b/blob/abc1234/scripts/sample.ts#L2-L3)",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites).toHaveLength(1);
    expect(cites[0]?.path).toBe("scripts/sample.ts");
  });

  test("a fenced ## line does not end the agents part", () => {
    const text = [
      "## For the agents",
      "",
      "```",
      "## Example",
      "```",
      "",
      "- [file](https://github.com/a/b/blob/abc1234/scripts/sample.ts#L2-L3)",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites).toHaveLength(1);
    expect(cites[0]?.path).toBe("scripts/sample.ts");
  });

  test("a User journey section does not hide later citations", () => {
    const text = [
      "## For the agents",
      "",
      "### Technical notes",
      "",
      "- [a](https://github.com/a/b/blob/abc1234/scripts/a.ts#L1)",
      "",
      "## User journey",
      "",
      "- [b](https://github.com/a/b/blob/abc1234/scripts/b.ts#L2)",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites.map((c) => c.path)).toEqual(["scripts/a.ts", "scripts/b.ts"]);
  });

  test("reads a bare path and the other range forms", () => {
    const text = [
      "## For the agents",
      "",
      "- See `docs/a.md`, `docs/b.md#L1` and `docs/c.md#L2-`.",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites.map((c) => c.path)).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);
    expect(cites[1]?.start).toBe(1);
    expect(cites[2]?.start).toBe(2);
  });

  test("parseRange reads every range form", () => {
    expect(parseRange("#L5-L9")).toEqual({ start: 5, end: 9 });
    expect(parseRange("L5")).toEqual({ start: 5 });
    expect(parseRange("5-9")).toEqual({ start: 5, end: 9 });
    expect(parseRange("L5-")).toEqual({ start: 5 });
    expect(parseRange("nope")).toEqual({});
  });

  test("nothing outside the agents' part is a cite", () => {
    const text = [
      "## Problem / feature",
      "See `docs/a.md` and [x](https://github.com/a/b/blob/abc1234/docs/a.md#L1-L1).",
      "",
    ].join("\n");
    expect(citationsFromText(text)).toHaveLength(0);
  });

  test("the agents' part ends at the next level-two heading", () => {
    const text = [
      "## For the agents",
      "",
      "- See `docs/a.md`.",
      "",
      "### Verified at abc1234",
      "",
      "## Project profile",
      "docs to read first: `docs/b.md`",
      "",
      "## Team",
      "workhorses: `docs/c.md`",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites.map((c) => c.path)).toEqual(["docs/a.md"]);
  });

  test("a cite before trailing punctuation keeps its path and range", () => {
    const text = [
      "## For the agents",
      "",
      "- See [a](https://github.com/a/b/blob/abc1234/docs/a.md#L2-L3), [b](https://github.com/a/b/blob/abc1234/docs/b.md.) and `docs/c.md`.",
      "",
    ].join("\n");
    const cites = citationsFromText(text);
    expect(cites.map((c) => c.path)).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);
    expect(cites[0]?.start).toBe(2);
    expect(cites[0]?.end).toBe(3);
    expect(cites[1]?.source).toBe("link");
  });
});

describe("the verdicts", () => {
  test("same: the cited text is at the cited lines, exit 0", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("premise 1: docs/a.md#L5-L5 same");
    expect(r.out).toContain(`PREMISES verified=${verified} base=${verified} result=same count=1`);
  });

  test("same: a variant-case Verified at line still anchors, exit 0", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    writeFileSync(body, readFileSync(body, "utf8").replace("### Verified at", "### VERIFIED AT"));
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`PREMISES verified=${verified} base=${verified} result=same count=1`);
  });

  test("moved: the cited text ten lines down, exit 0", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `filler line ${i + 1}`);
    lines[4] = "THE CITED MARKER LINE";
    const moved = commitFile(
      "docs/a.md",
      `${Array(10).fill("inserted").join("\n")}\n${lines.join("\n")}\n`,
      "move",
    );
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, moved]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("moved");
    expect(r.out).toContain("L15-L15");
    expect(r.out).toContain("result=moved");
  });

  test("changed: edited text, exit 2", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `filler line ${i + 1}`);
    lines[4] = "THE CITED MARKER LINE, EDITED";
    const changed = commitFile("docs/a.md", `${lines.join("\n")}\n`, "change");
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, changed]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("changed");
    expect(r.out).toContain("result=changed");
  });

  test("missing: a deleted file, exit 2", () => {
    git("rm", "-q", "docs/a.md");
    git("commit", "-q", "-m", "remove");
    const missing = git("rev-parse", "HEAD");
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, missing]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("missing");
    expect(r.out).toContain("result=missing");
  });

  test("unknown: a Verified at commit the repository lacks, exit 0", () => {
    const body = ticketBody(
      "0000000000000000000000000000000000000000",
      `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`,
    );
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unknown");
    expect(r.out).toContain("result=unknown");
  });

  test("unknown: cited lines out of range, exit 0", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L99-L99")}.`);
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unknown");
  });

  test("unknown: a base commit the repository lacks, exit 0", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, "nosuchrev"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unknown");
    expect(r.out).toContain("the base commit is unknown to the repository");
    expect(r.out).toContain("result=unknown");
  });

  test("an empty base is refused, exit 1", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L5")}.`);
    const r = cli([repo, body, ""]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("the base commit is empty");
  });

  test("unknown: a range ending past the last line, exit 0", () => {
    const body = ticketBody(verified, `- Renders per ${LINK(verified, "docs/a.md", "L5-L99")}.`);
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unknown");
    expect(r.out).toContain("out of range at the Verified at commit");
  });

  test("prose in code spans is skipped, not failed", () => {
    const body = ticketBody(
      verified,
      "- Set `team.clerk` beside `run launch form clerk` and `ready`.",
    );
    const r = cli([repo, body, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("result=same count=0");
  });

  test("no agents' part means no premises", () => {
    const path = join(root, "plain.md");
    writeFileSync(path, "## Problem / feature\n\nJust words.\n");
    const r = cli([repo, path, verified]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("result=same count=0");
  });
});

describe("usage", () => {
  test("no arguments and an unreadable ticket exit 1", () => {
    expect(cli([]).code).toBe(1);
    expect(cli([repo]).code).toBe(1);
    expect(cli([repo, join(root, "nope.md"), verified]).code).toBe(1);
  });
});
