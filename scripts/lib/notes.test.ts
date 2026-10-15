// Tests beside scripts/lib/notes.ts. The notes are an invented project's: an "acme" shop with a
// wiki of its own, so no real project is named.
import { describe, expect, test } from "bun:test";
import {
  BUDGET_WORDS,
  PARTS,
  type RouteBlock,
  overBudget,
  parseNotes,
  parseRef,
  renderPart,
  renderRouted,
  routedFor,
} from "./notes.ts";
import type { Declaration, Rule } from "./rule-sources.ts";

const everywhere = (): boolean => true;

const NOTES = [
  "# Acme notes",
  "",
  "Background only: who owns what.",
  "",
  "<!-- route: waybill -->",
  "Serve the run's own app on port 4300 before the browser suite.",
  "",
  "<!-- route: waybill, implement; scope: apps/shop/** -->",
  "The shop's text sizes are the design styles only.",
  "",
  "<!-- rules: .review/config.json; format: json-rules; gate: high, medium -->",
  "Some words about the rules, kept for people.",
  "",
  "<!-- rules: source:acme-wiki/standards/ts.md; format: headings; gate: Must, Default; advisory: Guideline; parts: style; level: 2 -->",
  "<!-- reads: source:acme-wiki/INDEX.md, STYLEGUIDE.md; parts: clerk, bug -->",
  "<!-- route: background -->",
  "A note for people only.",
].join("\n");

describe("a notes file", () => {
  const parsed = parseNotes(NOTES);

  test("reads without a problem", () => {
    expect(parsed.problems).toEqual([]);
  });

  test("each annotation becomes a block, in file order", () => {
    expect(parsed.blocks.map((b) => b.kind)).toEqual(["route", "route", "rules", "rules", "reads"]);
  });

  test("a route block carries its parts, its scope and its text up to the next annotation", () => {
    const [a, b] = parsed.blocks as RouteBlock[];
    expect(a.parts).toEqual(["waybill"]);
    expect(a.scope).toEqual([]);
    expect(a.text).toBe("Serve the run's own app on port 4300 before the browser suite.");
    expect(b.parts).toEqual(["waybill", "implement"]);
    expect(b.scope).toEqual(["apps/shop/**"]);
  });

  test("a rules annotation reads its declaration, with the parts defaulting to implement and style", () => {
    const rules = parsed.blocks.filter((b) => b.kind === "rules");
    expect(rules).toHaveLength(2);
    const [first, second] = rules;
    if (first.kind !== "rules" || second.kind !== "rules") throw new Error("not rules");
    expect(first.decl.ref).toBe(".review/config.json");
    expect(first.decl.format).toBe("json-rules");
    expect(first.decl.gate).toEqual(["high", "medium"]);
    expect(first.decl.key).toBe("rules");
    expect(first.decl.fields.label).toBe("severity");
    expect(first.parts).toEqual(["implement", "style"]);
    expect(second.parts).toEqual(["style"]);
    expect(second.decl.level).toBe(2);
    expect(second.decl.advisory).toEqual(["Guideline"]);
  });

  test("a reads annotation lists its files and its parts", () => {
    const reads = parsed.blocks.find((b) => b.kind === "reads");
    if (reads?.kind !== "reads") throw new Error("no reads");
    expect(reads.refs).toEqual(["source:acme-wiki/INDEX.md", "STYLEGUIDE.md"]);
    expect(reads.parts).toEqual(["clerk", "bug"]);
  });

  test("text before the first annotation, after a rules annotation and routed to background is kept for people", () => {
    expect(parsed.background.map((b) => b.text)).toEqual([
      "# Acme notes\n\nBackground only: who owns what.",
      "Some words about the rules, kept for people.",
      "A note for people only.",
    ]);
  });
});

describe("what a part receives", () => {
  const parsed = parseNotes(NOTES);
  const reaches = (area: string) => (scope: readonly string[]) =>
    scope.length === 0 || scope.some((s) => s.startsWith(area));

  test("a part receives the blocks routed to it, in file order", () => {
    expect(routedFor(parsed, "waybill", everywhere)).toHaveLength(2);
    expect(routedFor(parsed, "implement", everywhere)).toHaveLength(1);
    expect(routedFor(parsed, "security", everywhere)).toEqual([]);
  });

  test("a scoped block reaches only an area that can reach its scope", () => {
    expect(routedFor(parsed, "waybill", reaches("apps/shop"))).toHaveLength(2);
    expect(routedFor(parsed, "waybill", reaches("apps/docs"))).toHaveLength(1);
  });

  test("the routed text is the blocks separated by a blank line", () => {
    expect(renderRouted(routedFor(parsed, "waybill", everywhere))).toBe(
      "Serve the run's own app on port 4300 before the browser suite.\n\nThe shop's text sizes are the design styles only.",
    );
  });
});

describe("what is wrong", () => {
  const problems = (text: string): string[] => [...parseNotes(text).problems];

  test("a route to no part, or to a part that does not exist", () => {
    expect(problems("<!-- route: -->\ntext")).toEqual(["line 1: route names no part of the flow"]);
    expect(problems("<!-- route: cook -->\ntext")[0]).toContain('"cook" is not a part of the flow');
  });

  test("a route block with no text", () => {
    expect(problems("<!-- route: waybill -->\n\n<!-- route: clerk -->\nx")).toEqual([
      "line 1: route block has no text",
    ]);
  });

  test("a scope with braces", () => {
    expect(problems("<!-- route: clerk; scope: apps/{a,b}/** -->\nx")[0]).toContain("has braces");
  });

  test("rules with no file, no format or no gate", () => {
    const text =
      "<!-- rules: ; format: headings; gate: Must -->\n<!-- rules: a.json; gate: high -->\n<!-- rules: b.json; format: json-rules -->";
    const found = problems(text);
    expect(found).toContain("line 1: rules names no file");
    expect(found).toContain("line 2: rules needs format: json-rules or headings");
    expect(found).toContain("line 3: rules needs gate: the labels that gate");
  });

  test("rules with a level out of range, and a fields entry that is not id, text, label or scope", () => {
    const found = problems(
      "<!-- rules: a.md; format: headings; gate: Must; level: 9; fields: color=red -->",
    );
    expect(found.some((p) => p.includes("level is a heading level from 1 to 6"))).toBe(true);
    expect(found.some((p) => p.includes("fields wants id=, text=, label= or scope="))).toBe(true);
  });

  test("reads with no file or no parts", () => {
    expect(problems("<!-- reads: ; parts: clerk -->")).toContain("line 1: reads names no file");
    expect(problems("<!-- reads: a.md -->")).toContain(
      "line 1: reads needs parts: the parts that open the files",
    );
  });

  test("an annotation inside a fenced block is an example, not an annotation", () => {
    const parsed = parseNotes("```\n<!-- route: waybill -->\nx\n```");
    expect(parsed.blocks).toEqual([]);
    expect(parsed.problems).toEqual([]);
  });

  test("another HTML comment is text", () => {
    const parsed = parseNotes("<!-- todo: tidy -->\nsome note");
    expect(parsed.blocks).toEqual([]);
    expect(parsed.background[0].text).toContain("some note");
  });
});

describe("references and budgets", () => {
  test("a source reference names a registered source and a path in it", () => {
    expect(parseRef("source:acme-wiki/standards/ts.md")).toEqual({
      kind: "source",
      name: "acme-wiki",
      path: "standards/ts.md",
    });
  });

  test("anything else is a path in the repo", () => {
    expect(parseRef("STYLEGUIDE.md")).toEqual({ kind: "repo", path: "STYLEGUIDE.md" });
    expect(parseRef("source:nopath")).toEqual({ kind: "repo", path: "source:nopath" });
  });

  test("every part has a budget", () => {
    expect(Object.keys(BUDGET_WORDS).sort()).toEqual([...PARTS].sort());
  });

  test("a part over its budget is named with its count; an area cannot hide it", () => {
    const long = Array(BUDGET_WORDS.bug + 1)
      .fill("word")
      .join(" ");
    const parsed = parseNotes(`<!-- route: bug; scope: apps/shop/** -->\n${long}`);
    expect(overBudget(parsed)).toEqual([
      { part: "bug", words: BUDGET_WORDS.bug + 1, budget: BUDGET_WORDS.bug },
    ]);
    expect(overBudget(parseNotes(NOTES))).toEqual([]);
  });
});

describe("a part as one document", () => {
  const decl: Declaration = {
    ref: "acme/rules.json",
    format: "json-rules",
    gate: ["high"],
    advisory: [],
    level: 3,
    key: "rules",
    fields: { id: "id", text: "rule", label: "severity", scope: "scope" },
  };
  const rule: Rule = {
    id: "no-any",
    text: "Never use any.",
    label: "high",
    scope: [],
    source: "acme/rules.json",
    at: "acme/rules.json#no-any",
    gate: true,
  };
  const block = (
    parseNotes("<!-- route: clerk -->\nRead the docs first.").blocks as RouteBlock[]
  )[0];

  test("a part with nothing is empty", () => {
    expect(renderPart({ part: "bug", blocks: [], rules: [], reads: [], where: "here" })).toBe("");
  });

  test("the routed text comes first, then the rules, then the files to open", () => {
    const text = renderPart({
      part: "style",
      blocks: [block],
      rules: [{ rule, decl }],
      reads: [{ ref: "source:acme/INDEX.md", path: "/copies/INDEX.md" }],
      where: "copies in this run",
    });
    const at = (s: string): number => text.indexOf(s);
    expect(at("Read the docs first.")).toBe(0);
    expect(at("Written rules to check.")).toBeGreaterThan(0);
    expect(at("- no-any (high): Never use any.")).toBeGreaterThan(at("Written rules to check."));
    expect(at("Open these when they apply to the change (copies in this run):")).toBeGreaterThan(
      at("- no-any"),
    );
    expect(text).toContain("- /copies/INDEX.md (source:acme/INDEX.md)");
  });

  test("the lane that writes the code is told a rule that gates binds, and how to break one", () => {
    const text = renderPart({
      part: "implement",
      blocks: [],
      rules: [{ rule, decl }],
      reads: [],
      where: "",
    });
    expect(text).toContain("Written rules to follow.");
    expect(text).toContain("break one only with a comment at the line that says why");
    expect(text).toContain("list the deviation in the hand-off");
  });

  test("a part that judges is told a violation that gates is fixed in round 1", () => {
    const text = renderPart({
      part: "style",
      blocks: [],
      rules: [{ rule, decl }],
      reads: [],
      where: "",
    });
    expect(text).toContain("it is fixed in round 1, not deferred");
    expect(text).toContain("Labels that gate: high (acme/rules.json).");
  });

  test("two sources are named once each in the line of labels that gate", () => {
    const other: Declaration = { ...decl, ref: "acme/wiki.md", format: "headings", gate: ["Must"] };
    const text = renderPart({
      part: "style",
      blocks: [],
      rules: [
        { rule, decl },
        { rule: { ...rule, id: "x", source: "acme/wiki.md" }, decl: other },
        { rule: { ...rule, id: "y" }, decl },
      ],
      reads: [],
      where: "",
    });
    expect(text).toContain("Labels that gate: high (acme/rules.json); Must (acme/wiki.md).");
  });
});
