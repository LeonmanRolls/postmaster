import { describe, expect, test } from "bun:test";
import { parseItems, sampleIds, splitOnOpen } from "./adjudicate.ts";
import { parseMarks } from "./marks.ts";

describe("the adjudication sample", () => {
  test("the same seed draws the same ids, without repeats, and a different seed another set", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `1.2.${i + 1}`);
    const a = sampleIds(ids, 10, 400);
    expect(a).toEqual(sampleIds(ids, 10, 400));
    expect(new Set(a).size).toBe(10);
    expect(sampleIds(ids, 10, 7)).not.toEqual(a);
  });
  test("a sample larger than the list is the whole list", () => {
    expect(sampleIds(["1.2.1", "1.2.2"], 5, 1)).toEqual(["1.2.1", "1.2.2"]);
  });
  test("the findings where one reader says yes and the other does not are the split", () => {
    const a = parseMarks(
      "1.2.1\tyes\tno\tstate\tx\n1.2.2\tno\tno\tstate\tx\n1.2.3\tyes\tno\tinput\tx",
    ).marks;
    const b = parseMarks(
      "1.2.1\tno\tno\tstate\tx\n1.2.2\tno\tno\tstate\tx\n1.2.3\tyes\tno\tinput\tx",
    ).marks;
    expect(splitOnOpen(a, b)).toEqual(["1.2.1"]);
  });
  test("items are read by their column names", () => {
    const rows = parseItems("id\trun\tround\ttarget\ttext\n1.2.1\t1\t2\ta.ts:1\tthe text\n");
    expect(rows[0]).toEqual({
      id: "1.2.1",
      run: "1",
      round: "2",
      target: "a.ts:1",
      text: "the text",
    });
  });
});
