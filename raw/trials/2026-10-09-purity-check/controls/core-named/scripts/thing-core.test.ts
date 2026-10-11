// Control, negative for the name part of the scope: a test of a *-core.ts module is not a helper.
import { expect, test } from "bun:test";

test("reads the environment", () => {
  expect(process.env.HOME).toBeDefined();
});
