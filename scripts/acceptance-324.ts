// Oracle helpers for #324: one session makes a verifier for each surface given.
// The upkeep line below is this oracle's own expectation, deliberately not
// imported from the change: the tests fail when the prompt stops carrying it.
export const UPKEEP_LINE =
  "A change which adds, changes or removes a feature updates that feature's page in the same change.";
