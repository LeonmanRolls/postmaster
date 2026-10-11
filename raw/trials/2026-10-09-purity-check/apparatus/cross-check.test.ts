import { expect, test } from "bun:test";
import { minus } from "./cross-check.ts";

test("minus counts repeats", () => {
  expect(minus(["a", "a", "b"], ["a"])).toEqual(["a", "b"]);
  expect(minus(["a"], ["a", "a"])).toEqual([]);
  expect(minus([], ["a"])).toEqual([]);
});
