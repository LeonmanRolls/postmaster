# Fixtures for #329: rise-survey copies

Slices of real run records, for the #329 oracle (`scripts/acceptance-329.test.ts`).
Each `<run>/actions.jsonl` holds that run's `finding`, `review-launch` and
`degrade` lines, all rounds, verbatim; the oracle filters to the rounds up to
the stop. Reports under `<run>/logs/` are the reviewers' reports to the stop
round. `ticket-body.md` is the run's ticket, verbatim.

Source runs in the main checkout's `.postmaster/runs/`: 202 (stop after
round 5), 216 (round 3), 268 (round 8), 335 (round 6), 342 (round 2), and
the controls 202 after round 4 and 218 after round 3. The stop snapshots
the ticket gives: 202r5 `665a99f9d9c08e69c101d7fbfa927afc79b4f231`,
216r3 `26ba0d01b12af281b118322f42634d6b55b69d2c`, 268r8
`a0a2e66cb0635443f20e51a145bf017b69c23fa6`, 335r6
`ad29bc3cb9765ed7dc1887cab67b5da4c5526bae`, 342r2
`f15ebea26c508ff3a601e8f7802c54404efc59dd`.

Deliberate quirks, verified against the sources:

- Copies hold the three line kinds only. The sources' `apply` lines would
  fault review-decide on the 202r5 and 335r6 slices (they name prose and
  targets with no finding line), so applies stay out, as the ticket's copy
  definition says.
- No `gate` lines: the copy definition lists three kinds, and the 268r8
  and 335r6 stops have no `review round <k>` gate line in their records,
  so the oracle passes the ticket's snapshots with `--snapshot`.
- No `note`, `escalate` or `review-harvest` lines: the step's rounds file
  must exclude them, and the oracle injects some to prove the filter.
- 216's old-spelling launches (`bug r7`) and 268's round-6 opus degrades
  (`security round 6 attempt 1: ...`) keep their spelling; the step reads
  their rounds leniently. 335's round-9 finding line is malformed
  (severity `r9`) and is cut with its round, past every stop.
- 218 has no ticket file in its record, so its fixture has none; it is a
  control and no survey runs on it.

Regen: from the main checkout, keep every `finding`, `review-launch` and
`degrade` line of each source's `actions.jsonl` (all rounds, byte-identical
order), copy `ticket-body.md` where one exists, and copy every
`logs/review-r<N>-(style|bug|security)-<lane>-(last.md|findings.json|findings.md)`
with N at or below the run's stop. Then confirm the oracle's review-decide
controls still print the ticket's C1 lines.

Scrubbed: the slices carry made-up values wherever the sources' real ones
would trip the private-data check. Machine home paths read `/home/user`,
session ids read `ses_000N`, example addresses read `user@example.invalid`,
two quoted test phrases in 216's finding details are reworded past the
health rule without touching the finding grammar, the ticket's ssh/scp
phrasing is reworded past the host rule, and one `.local` code identifier
in a finding body reads `.value`. Reports and tickets are pass-through for
the oracle, which asserts their paths, not their words.
