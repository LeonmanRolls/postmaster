// Tests beside scripts/lib/rule-discovery.ts. The repos are invented.
import { describe, expect, test } from "bun:test";
import { findRuleSources, instructionFilesAbove, ruleSourceLine } from "./rule-discovery.ts";

const has =
  (...present: string[]) =>
  (path: string): boolean =>
    present.includes(path);

describe("the rule sources of a repo", () => {
  test("a repo with none has none", () => {
    expect(findRuleSources(has(), [])).toEqual([]);
  });

  test("each conventional file found is named with what it usually is", () => {
    const found = findRuleSources(
      has("STYLEGUIDE.md", "REVIEW.md", ".greptile/config.json", "biome.json"),
      [],
    );
    expect(found).toEqual([
      { kind: "styleguide", path: "STYLEGUIDE.md" },
      { kind: "review-bot", path: "REVIEW.md" },
      { kind: "review-bot", path: ".greptile/config.json" },
      { kind: "linter", path: "biome.json" },
    ]);
  });

  test("a workflow whose name says it reviews is a review bot", () => {
    const found = findRuleSources(has(), ["ci.yml", "claude-review.yml", "Code-Review.yaml"]);
    expect(found).toEqual([
      { kind: "review-bot", path: ".github/workflows/claude-review.yml" },
      { kind: "review-bot", path: ".github/workflows/Code-Review.yaml" },
    ]);
  });

  test("agent-instruction folders are found too", () => {
    expect(findRuleSources(has(".cursor/rules"), [])).toEqual([
      { kind: "agent-instructions", path: ".cursor/rules" },
    ]);
  });

  test("the line lists kind and path for each, on one line", () => {
    const found = findRuleSources(has("STYLEGUIDE.md", "ruff.toml"), []);
    expect(ruleSourceLine(found)).toBe("rule_sources=styleguide:STYLEGUIDE.md linter:ruff.toml");
    expect(ruleSourceLine([])).toBe("rule_sources=");
  });
});

describe("instruction files above a project", () => {
  test("those in the folders above, nearest first", () => {
    const found = instructionFilesAbove(
      "/people/ada/Code/acme/shop",
      "/people/ada",
      has("/people/ada/Code/acme/CLAUDE.md", "/people/ada/Code/AGENTS.md"),
    );
    expect(found).toEqual(["/people/ada/Code/acme/CLAUDE.md", "/people/ada/Code/AGENTS.md"]);
  });

  test("never the project's own folder, and never the home folder or above it", () => {
    const found = instructionFilesAbove(
      "/people/ada/Code/acme/shop",
      "/people/ada",
      has("/people/ada/Code/acme/shop/AGENTS.md", "/people/ada/CLAUDE.md", "/people/CLAUDE.md"),
    );
    expect(found).toEqual([]);
  });

  test("it stops after the given number of folders", () => {
    const found = instructionFilesAbove(
      "/a/b/c/d/e",
      "/",
      has("/a/b/c/CLAUDE.md", "/a/b/CLAUDE.md"),
      2,
    );
    expect(found).toEqual(["/a/b/c/CLAUDE.md"]);
  });

  test("it stops at the root", () => {
    expect(instructionFilesAbove("/x", "/home", has("/CLAUDE.md"))).toEqual([]);
  });
});
