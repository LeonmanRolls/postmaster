// Tests beside scripts/lib/rule-sources.ts. The data is invented: an "acme" project whose rules sit
// in a JSON list and in a markdown styleguide, so nothing here names a real project.
import { describe, expect, test } from "bun:test";
import {
  type Declaration,
  assign,
  batches,
  clipWords,
  digest,
  gates,
  readHeadingRules,
  readJsonRules,
  readRules,
  scopeApplies,
  staticPrefix,
} from "./rule-sources.ts";

const JSON_DECL: Declaration = {
  ref: "acme/rules.json",
  format: "json-rules",
  gate: ["high", "medium"],
  advisory: [],
  level: 3,
  key: "rules",
  fields: { id: "id", text: "rule", label: "severity", scope: "scope" },
};

const HEAD_DECL: Declaration = {
  ref: "acme/style.md",
  format: "headings",
  gate: ["Must", "Default"],
  advisory: ["Guideline"],
  level: 3,
  key: "rules",
  fields: { id: "id", text: "rule", label: "severity", scope: "scope" },
};

const RULES_JSON = JSON.stringify({
  ignorePatterns: "**/*.gen.ts",
  rules: [
    { id: "no-any", rule: "Never use any.", scope: ["**/*.ts"], severity: "high" },
    { id: "type-attr", rule: "Buttons need a type.", scope: "apps/**/*.tsx", severity: "medium" },
    { id: "small-files", rule: "Keep files short.", severity: "low" },
  ],
});

describe("gates", () => {
  test("a gating label gates, in any case", () => {
    expect(gates("high", JSON_DECL)).toBe(true);
    expect(gates("HIGH", JSON_DECL)).toBe(true);
  });

  test("a label the declaration does not name does not gate", () => {
    expect(gates("low", JSON_DECL)).toBe(false);
  });

  test("no label never gates", () => {
    expect(gates("", JSON_DECL)).toBe(false);
  });

  test("advisory wins over gate", () => {
    expect(gates("Guideline", { gate: ["Guideline"], advisory: ["guideline"] })).toBe(false);
  });
});

describe("a JSON rule list", () => {
  test("reads each rule with its label, scope and gate flag", () => {
    const read = readJsonRules(RULES_JSON, JSON_DECL);
    expect(read.problems).toEqual([]);
    expect(read.rules.map((r) => [r.id, r.label, r.gate])).toEqual([
      ["no-any", "high", true],
      ["type-attr", "medium", true],
      ["small-files", "low", false],
    ]);
  });

  test("a scope may be one glob or a list; no scope reads as everywhere", () => {
    const [a, b, c] = readJsonRules(RULES_JSON, JSON_DECL).rules;
    expect(a.scope).toEqual(["**/*.ts"]);
    expect(b.scope).toEqual(["apps/**/*.tsx"]);
    expect(c.scope).toEqual([]);
  });

  test("other field names and another list key are read as declared", () => {
    const doc = JSON.stringify({ checks: [{ name: "r1", body: "Do it.", level: "must" }] });
    const decl = {
      ...JSON_DECL,
      key: "checks",
      gate: ["must"],
      fields: { id: "name", text: "body", label: "level", scope: "where" },
    };
    const read = readJsonRules(doc, decl);
    expect(read.rules).toHaveLength(1);
    expect(read.rules[0].gate).toBe(true);
  });

  test("a bare list at the top reads when its key is not an object", () => {
    const read = readJsonRules(JSON.stringify([{ id: "x", rule: "Be good." }]), JSON_DECL);
    expect(read.rules.map((r) => r.id)).toEqual(["x"]);
  });

  test("a rule with no id or no text is a problem, and the rest still read", () => {
    const doc = JSON.stringify({ rules: [{ rule: "No id." }, { id: "y", rule: "Fine." }, 5] });
    const read = readJsonRules(doc, JSON_DECL);
    expect(read.rules.map((r) => r.id)).toEqual(["y"]);
    expect(read.problems).toHaveLength(2);
    expect(read.problems[0]).toContain('rule 1 needs "id" and "rule"');
    expect(read.problems[1]).toContain("rule 3 is not an object");
  });

  test("text that is not JSON, and a missing list, are problems", () => {
    expect(readJsonRules("{", JSON_DECL).problems[0]).toContain("not JSON");
    expect(readJsonRules("{}", JSON_DECL).problems[0]).toContain('no list of rules at "rules"');
  });

  test("a long rule text is clipped to a line", () => {
    const long = Array(100).fill("word").join(" ");
    const read = readJsonRules(JSON.stringify({ rules: [{ id: "l", rule: long }] }), JSON_DECL);
    expect(read.rules[0].text.endsWith(" ...")).toBe(true);
    expect(read.rules[0].text.split(" ").length).toBe(61);
  });
});

const STYLE_MD = [
  "# Acme style",
  "",
  "Intro text.",
  "",
  "### Name booleans with a prefix (Default)",
  "",
  "A boolean is named isX, hasX or canX.",
  "",
  "More detail.",
  "",
  "### Keep immutability",
  "",
  "Tier: Must",
  "",
  "Do not mutate arguments.",
  "",
  "### Prefer short files (Guideline)",
  "",
  "Under five hundred lines.",
  "",
  "```md",
  "### An example heading (Must)",
  "```",
  "",
  "## A level two heading",
  "",
  "### Unlabelled rule",
  "",
  "Say why.",
].join("\n");

describe("a markdown rule file", () => {
  const read = readHeadingRules(STYLE_MD, HEAD_DECL);

  test("each heading at the level is a rule, in order", () => {
    expect(read.problems).toEqual([]);
    expect(read.rules.map((r) => r.id)).toEqual([
      "name-booleans-with-a-prefix",
      "keep-immutability",
      "prefer-short-files",
      "unlabelled-rule",
    ]);
  });

  test("the label is the trailing word in the heading or a Tier line below it", () => {
    expect(read.rules.map((r) => r.label)).toEqual(["Default", "Must", "Guideline", ""]);
  });

  test("Must and Default gate, Guideline and no label do not", () => {
    expect(read.rules.map((r) => r.gate)).toEqual([true, true, false, false]);
  });

  test("the text is the title and the first paragraph, and a Tier line is not text", () => {
    expect(read.rules[0].text).toBe(
      "Name booleans with a prefix. A boolean is named isX, hasX or canX.",
    );
    expect(read.rules[1].text).toBe("Keep immutability. Do not mutate arguments.");
  });

  test("a heading inside a fenced block is an example, not a rule", () => {
    expect(read.rules.some((r) => r.id.includes("example"))).toBe(false);
  });

  test("each rule says where it is", () => {
    expect(read.rules[0].at).toBe("acme/style.md:5");
    expect(read.rules[1].at).toBe("acme/style.md:11");
  });

  test("a file with no heading at the level is a problem", () => {
    const none = readHeadingRules("# Only a title\n\ntext", HEAD_DECL);
    expect(none.rules).toEqual([]);
    expect(none.problems[0]).toContain("no headings at level 3");
  });

  test("another heading level is read when declared", () => {
    const two = readHeadingRules("## One (Must)\n\nBody.", { ...HEAD_DECL, level: 2 });
    expect(two.rules.map((r) => r.id)).toEqual(["one"]);
  });

  test("readRules picks the reader by format", () => {
    expect(readRules(RULES_JSON, JSON_DECL).rules).toHaveLength(3);
    expect(readRules(STYLE_MD, HEAD_DECL).rules).toHaveLength(4);
  });
});

describe("scope", () => {
  test("the static prefix is the path before the first wildcard", () => {
    expect(staticPrefix("apps/**/*.tsx")).toEqual(["apps"]);
    expect(staticPrefix("apps/portal/**")).toEqual(["apps", "portal"]);
    expect(staticPrefix("**/*.ts")).toEqual([]);
    expect(staticPrefix("./packages/ensjs/**")).toEqual(["packages", "ensjs"]);
    expect(staticPrefix("src/main.ts")).toEqual(["src", "main.ts"]);
  });

  test("a rule with no scope, or a ticket with no area, applies everywhere", () => {
    expect(scopeApplies([], ["apps/portal/**"])).toBe(true);
    expect(scopeApplies(["apps/**/*.tsx"], [])).toBe(true);
  });

  test("a scope applies when its prefix and the area's share a path", () => {
    expect(scopeApplies(["apps/**/*.tsx"], ["apps/portal/**"])).toBe(true);
    expect(scopeApplies(["apps/portal/**"], ["apps/**"])).toBe(true);
    expect(scopeApplies(["**/*.ts"], ["packages/x/**"])).toBe(true);
  });

  test("a scope in another folder does not apply", () => {
    expect(scopeApplies(["packages/ensjs/**"], ["apps/portal/**"])).toBe(false);
    expect(scopeApplies(["apps/manager/**"], ["apps/portal/**"])).toBe(false);
  });

  test("any scope glob or any area glob may match", () => {
    expect(scopeApplies(["packages/a/**", "apps/**"], ["apps/portal/**"])).toBe(true);
    expect(scopeApplies(["packages/a/**"], ["docs/**", "packages/a/src/**"])).toBe(true);
  });
});

describe("digest and batches", () => {
  const rules = readJsonRules(RULES_JSON, JSON_DECL).rules;

  test("a digest is one line for each rule", () => {
    expect(digest(rules).split("\n")).toEqual([
      "- no-any (high): Never use any.",
      "- type-attr (medium): Buttons need a type.",
      "- small-files (low): Keep files short.",
    ]);
  });

  test("a rule with no label has no parentheses", () => {
    const bare = readHeadingRules(STYLE_MD, HEAD_DECL).rules[3];
    expect(digest([bare])).toBe("- unlabelled-rule: Unlabelled rule. Say why.");
  });

  test("batches keep the order and the size", () => {
    expect(batches(rules, 2).map((b) => b.map((r) => r.id))).toEqual([
      ["no-any", "type-attr"],
      ["small-files"],
    ]);
  });

  test("a size under one reads as one", () => {
    expect(batches(rules, 0)).toHaveLength(3);
  });

  test("no rules is no batches", () => {
    expect(batches([], 12)).toEqual([]);
  });

  test("batches are dealt to the lanes in turn", () => {
    expect(assign(5, ["luna", "haiku"])).toEqual({ luna: [0, 2, 4], haiku: [1, 3] });
    expect(assign(1, ["luna", "haiku"])).toEqual({ luna: [0], haiku: [] });
    expect(assign(2, [])).toEqual({});
  });

  test("clipWords leaves a short text alone", () => {
    expect(clipWords("a  b\nc")).toBe("a b c");
  });
});
