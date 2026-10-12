// The run's stages, in the order a run passes through them. The stage command
// and the fixture score read this one definition: the refusal names the same
// skipped stage the score would fail on.
import { pySplitLines, pyWords } from "./text.ts";

export const STAGES =
  "dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned";

export const STAGE_LIST: readonly string[] = STAGES.split(" ");

/**
 * The stages a run passes through, up to done: the stage list without
 * abandoned, without review when the run's legs have no review leg, and
 * without workhorses-running in a single-thread run, where the coachman
 * writes the change itself in the synthesis stage.
 */
export function expectedStages(hasReview: boolean, mode: string): string[] {
  return STAGE_LIST.slice(0, STAGE_LIST.indexOf("done") + 1).filter(
    (s) =>
      (s !== "review" || hasReview) && (s !== "workhorses-running" || mode !== "single-thread"),
  );
}

/** Whether `turnpikes legs` output lists a review leg. */
export function hasReviewLeg(legsOut: string): boolean {
  return pySplitLines(legsOut).some((line) => {
    const words = pyWords(line);
    return words.length > 1 && words[1] === "review";
  });
}
