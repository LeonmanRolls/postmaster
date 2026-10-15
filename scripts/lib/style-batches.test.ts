// Tests beside scripts/lib/style-batches.ts. The rules are an invented project's.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RuleRow,
  batchText,
  lanePrompt,
  readStyleRules,
  writeStyleBatches,
} from "./style-batches.ts";

let tmp = "";
let seq = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "style-batches-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const row = (n: number, parts: string[] = ["implement", "style"]): RuleRow => ({
  id: `rule-${n}`,
  text: `Rule number ${n}.`,
  label: n % 2 === 0 ? "high" : "low",
  scope: [],
  source: "acme/rules.json",
  at: `acme/rules.json#rule-${n}`,
  gate: n % 2 === 0,
  parts,
});

function dispatchWith(rows: RuleRow[] | null): string {
  seq += 1;
  const dispatch = join(tmp, `run-${seq}`);
  mkdirSync(join(dispatch, "rules"), { recursive: true });
  if (rows !== null) writeFileSync(join(dispatch, "rules", "rules.json"), JSON.stringify(rows));
  return dispatch;
}

describe("the rules the style lens checks", () => {
  test("a run with no bundled rules has none", () => {
    expect(readStyleRules(dispatchWith(null))).toEqual([]);
  });

  test("only rules routed to the style part are read, in source order", () => {
    const d = dispatchWith([row(1), row(2, ["implement"]), row(3, ["style"])]);
    expect(readStyleRules(d).map((r) => r.id)).toEqual(["rule-1", "rule-3"]);
  });
});

describe("a batch file", () => {
  const text = batchText(1, 3, [row(2), row(3)]);

  test("names its place among the batches", () => {
    expect(text.startsWith("# Style rules, batch 2 of 3\n")).toBe(true);
  });

  test("tells the lane to answer every rule and what a gating rule means", () => {
    expect(text).toContain("For each rule, report each violation as a finding");
    expect(text).toContain("write `<rule id>: clean`");
    expect(text).toContain("Skip no rule.");
    expect(text).toContain("A rule marked [gates] is a gating finding when broken");
  });

  test("lists each rule with its label, whether it gates, its text and where it is", () => {
    expect(text).toContain("- rule-2 (high) [gates]: Rule number 2. (acme/rules.json#rule-2)");
    expect(text).toContain("- rule-3 (low) [advisory]: Rule number 3. (acme/rules.json#rule-3)");
  });

  test("a rule with no label has no parentheses", () => {
    const bare = batchText(0, 1, [{ ...row(1), label: "" }]);
    expect(bare).toContain("- rule-1 [advisory]: Rule number 1.");
  });
});

describe("a lane's prompt", () => {
  test("points at the brief first and then at the lane's batches", () => {
    const p = lanePrompt("/run/1", [
      "/run/1/rules/style-batch-1.md",
      "/run/1/rules/style-batch-3.md",
    ]);
    expect(p.startsWith("Read /run/1/review-style-brief.md and execute it.")).toBe(true);
    expect(p).toContain(
      "every written rule in /run/1/rules/style-batch-1.md and /run/1/rules/style-batch-3.md",
    );
    expect(p).toContain('write "<rule id>: clean"');
    expect(p).toContain("Do not modify any file you are reviewing.");
  });
});

describe("writing the batches", () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(i + 1));

  test("cuts the rules into batches of a dozen and deals them to the lanes in turn", () => {
    const d = dispatchWith(rows);
    const out = writeStyleBatches(d, "1", ["luna", "haiku"]);
    expect([...out.keys()]).toEqual(["luna", "haiku"]);
    for (const k of [1, 2, 3])
      expect(existsSync(join(d, "rules", `style-batch-${k}.md`))).toBe(true);
    expect(existsSync(join(d, "rules", "style-batch-4.md"))).toBe(false);
    const luna = readFileSync(out.get("luna") as string, "utf8");
    const haiku = readFileSync(out.get("haiku") as string, "utf8");
    expect(luna).toContain("style-batch-1.md and");
    expect(luna).toContain("style-batch-3.md");
    expect(luna).not.toContain("style-batch-2.md");
    expect(haiku).toContain("style-batch-2.md");
    expect(readFileSync(join(d, "rules", "style-batch-3.md"), "utf8")).toContain("batch 3 of 3");
  });

  test("the prompt for a lane is named for the round and the lane", () => {
    const d = dispatchWith(rows);
    const out = writeStyleBatches(d, "2", ["luna", "haiku"]);
    expect(out.get("luna")).toBe(join(d, "review-r2-style-luna-prompt.txt"));
  });

  test("every rule lands in exactly one batch file", () => {
    const d = dispatchWith(rows);
    writeStyleBatches(d, "1", ["luna"]);
    const all = [1, 2, 3]
      .map((k) => readFileSync(join(d, "rules", `style-batch-${k}.md`), "utf8"))
      .join("\n");
    for (const r of rows) expect(all.split(`- ${r.id} (`).length - 1).toBe(1);
  });

  test("a lane with no batch is left out, and reviews as before", () => {
    const d = dispatchWith([row(1), row(2)]);
    const out = writeStyleBatches(d, "1", ["luna", "haiku"]);
    expect([...out.keys()]).toEqual(["luna"]);
    expect(existsSync(join(d, "review-r1-style-haiku-prompt.txt"))).toBe(false);
  });

  test("the size of a batch can be set", () => {
    const d = dispatchWith([row(1), row(2), row(3)]);
    const out = writeStyleBatches(d, "1", ["luna", "haiku"], 1);
    expect(existsSync(join(d, "rules", "style-batch-3.md"))).toBe(true);
    expect(out.size).toBe(2);
  });

  test("no rules, or no lanes, writes nothing", () => {
    const none = dispatchWith(null);
    expect(writeStyleBatches(none, "1", ["luna"]).size).toBe(0);
    expect(existsSync(join(none, "rules", "style-batch-1.md"))).toBe(false);
    const noLanes = dispatchWith(rows);
    expect(writeStyleBatches(noLanes, "1", []).size).toBe(0);
    expect(existsSync(join(noLanes, "rules", "style-batch-1.md"))).toBe(false);
  });
});
