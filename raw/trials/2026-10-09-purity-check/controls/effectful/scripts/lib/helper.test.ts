// Control, negative: a test beside the helper. Tests are not helpers, so the check leaves them
// out of its scope, though this one reads the environment and the clock.
import { expect, test } from "bun:test";
import { stamp } from "./helper.ts";

test("stamp reads the environment", () => {
  process.env.NAME = "x";
  expect(stamp()).toContain("x");
  expect(Date.now()).toBeGreaterThan(0);
});
