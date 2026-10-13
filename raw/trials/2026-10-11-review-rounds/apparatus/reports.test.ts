import { describe, expect, test } from "bun:test";
import { lineFor, matchReport, parseReportJson, reportText } from "./reports.ts";

const json = JSON.stringify([
  {
    file: "a.ts",
    line: 10,
    target: "a.ts:10",
    summary: "Guard it",
    body: "When x, [the doc](https://e.org) says y.",
  },
  { file: "b.ts", line: 40, target: "b.ts:40", summary: "Other", body: "" },
]);

describe("a reviewer's report", () => {
  test("items are read from an array and from an object with findings", () => {
    expect(parseReportJson(json)).toHaveLength(2);
    expect(
      parseReportJson(JSON.stringify({ findings: [{ file: "a", summary: "s" }] })),
    ).toHaveLength(1);
  });
  test("a report that is not JSON holds no items (negative control)", () => {
    expect(parseReportJson("not json")).toEqual([]);
    expect(parseReportJson("{}")).toEqual([]);
  });
  test("an item is matched by its target, else by its file within three lines", () => {
    const items = parseReportJson(json);
    expect(matchReport(items, "a.ts:10", null)?.summary).toBe("Guard it");
    expect(matchReport(items, "b.ts:42", { file: "b.ts", first: 42, last: 42 })?.summary).toBe(
      "Other",
    );
    expect(matchReport(items, "b.ts:60", { file: "b.ts", first: 60, last: 60 })).toBeNull();
  });
  test("the text is the summary and the body without its links", () => {
    expect(reportText(parseReportJson(json)[0] as never)).toBe("Guard it: When x, the doc says y.");
  });
  test("a hand-read report gives the line that holds the target and the next", () => {
    expect(lineFor("intro\n- a.ts:10 the thing\n  more words\nend", "a.ts:10")).toBe(
      "- a.ts:10 the thing more words",
    );
    expect(lineFor("nothing here", "a.ts:10")).toBe("");
  });
});
