import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { citationsFromText, checkPremises } from "./premises.ts";

let root = "";
let repo = "";
let verified = "";
let base = "";

function git(...args: string[]): string {
  const result = run("git", ["-C", repo, ...args]);
  if (result.code !== 0) throw new Error(result.err || result.out);
  return result.out.trim();
}

function commitFile(content: string, message: string): string {
  writeFileSync(join(repo, "scripts", "sample.ts"), content);
  git("add", ".");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function waybill(sha = verified): string {
  const path = join(root, "brief.md");
  writeFileSync(
    path,
    `# Waybill\n\n## For the agents\n\n### Technical notes\n\n- [sample](https://github.com/example/repo/blob/${sha}/scripts/sample.ts#L2-L3)\n- \`scripts/sample.ts#L2-L3\`\n\n### Verified at ${sha}\n\n- Sample premise.\n`,
  );
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "premises-test-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["-C", repo, "config", "user.name", "brindlewick"]);
  run("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "332054101+brindlewick@users.noreply.github.com",
  ]);
  verified = commitFile("before\nfirst cited line\nsecond cited line\nafter\n", "verified");
  base = verified;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("premise citations", () => {
  test("reads file links and paths from the agents' part once", () => {
    const text = `## Problem / feature\nNot a code link.\n\n## For the agents\n\n- [file](https://github.com/a/b/blob/abc/scripts/sample.ts#L2-L3)\n- \`scripts/sample.ts#L2-L3\`\n`;
    expect(citationsFromText(text)).toHaveLength(1);
    const citation = citationsFromText(text)[0];
    expect(citation?.path).toBe("scripts/sample.ts");
    expect(citation?.start).toBe(2);
    expect(citation?.end).toBe(3);
  });

  test("prints same when the cited text is at the cited lines", () => {
    const result = checkPremises(repo, waybill(), base);
    expect(result.result).toBe("same");
    expect(result.entries.map((entry) => entry.state)).toEqual(["same"]);
  });

  test("prints moved when the cited text moves down ten lines", () => {
    base = commitFile(
      `${"inserted\n".repeat(10)}before\nfirst cited line\nsecond cited line\nafter\n`,
      "move citation",
    );
    const result = checkPremises(repo, waybill(), base);
    expect(result.result).toBe("moved");
    expect(result.entries[0]?.state).toBe("moved");
  });

  test("prints changed when the cited text changes", () => {
    base = commitFile("before\nfirst changed line\nsecond cited line\nafter\n", "change citation");
    const result = checkPremises(repo, waybill(), base);
    expect(result.result).toBe("changed");
    expect(result.entries[0]?.state).toBe("changed");
  });

  test("prints missing when the cited file is gone", () => {
    git("rm", "scripts/sample.ts");
    git("commit", "-q", "-m", "remove cited file");
    base = git("rev-parse", "HEAD");
    const result = checkPremises(repo, waybill(), base);
    expect(result.result).toBe("missing");
    expect(result.entries[0]?.state).toBe("missing");
  });

  test("prints unknown when the ticket's verified commit is unavailable", () => {
    const result = checkPremises(repo, waybill("1234567890abcdef"), base);
    expect(result.verified).toBe("1234567890abcdef");
    expect(result.result).toBe("unknown");
    expect(result.entries[0]?.state).toBe("unknown");
  });
});
