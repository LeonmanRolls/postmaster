// Tests beside scripts/lib/stages.ts: the run's expected stage order.
import { describe, expect, test } from "bun:test";
import { expectedStages, hasReviewLeg, STAGES } from "./stages.ts";

describe("expectedStages", () => {
  test("a synthesis run with a review leg walks every stage to done", () => {
    expect(expectedStages(true, "synthesis")).toEqual([
      "dispatched",
      "bootstrapped",
      "workhorses-running",
      "synthesis",
      "checkpoint-1",
      "review",
      "shipping",
      "shipped",
      "done",
    ]);
  });

  test("a run with no review leg passes no review stage", () => {
    expect(expectedStages(false, "synthesis")).toEqual([
      "dispatched",
      "bootstrapped",
      "workhorses-running",
      "synthesis",
      "checkpoint-1",
      "shipping",
      "shipped",
      "done",
    ]);
  });

  test("a single-thread run passes no workhorses-running stage", () => {
    expect(expectedStages(true, "single-thread")).toEqual([
      "dispatched",
      "bootstrapped",
      "synthesis",
      "checkpoint-1",
      "review",
      "shipping",
      "shipped",
      "done",
    ]);
  });

  test("abandoned is a stage but never an expected one", () => {
    expect(STAGES.split(" ")).toContain("abandoned");
    expect(expectedStages(true, "synthesis")).not.toContain("abandoned");
  });
});

describe("hasReviewLeg", () => {
  test("reads the review leg from turnpikes legs output", () => {
    expect(hasReviewLeg("1 synthesis\n2 review style bug security\n")).toBe(true);
    expect(hasReviewLeg("1 synthesis\n")).toBe(false);
    expect(hasReviewLeg("")).toBe(false);
  });
});
