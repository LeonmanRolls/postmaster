import { describe, expect, test } from "bun:test";
import { mergeNames } from "./trace.ts";

describe("which merge names a ticket", () => {
  test("a ticket number in the title, not the pull request's own number", () => {
    expect(mergeNames("Merge pull request #398: #233, Oxlint refuses explicit any", "233")).toBe(
      true,
    );
    expect(mergeNames("Merge pull request #398: #233, Oxlint refuses explicit any", "398")).toBe(
      false,
    );
    expect(
      mergeNames("Merge pull request #167: Run the bug review through each skill (#38)", "38"),
    ).toBe(true);
  });
  test("a longer number that starts the same does not match (negative control)", () => {
    expect(mergeNames("Merge pull request #380: #372, Research: counts", "38")).toBe(false);
    expect(mergeNames("Merge pull request #388: #335, A project's own settings", "33")).toBe(false);
  });
});
