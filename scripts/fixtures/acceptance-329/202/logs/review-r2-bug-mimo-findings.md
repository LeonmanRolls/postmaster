# Bug findings, round 2, lane mimo (hand-read)

Raw report: the final text part of
`/home/brindlewick/postmaster/.postmaster/runs/202/logs/review-r2-bug-mimo.jsonl`
(`normalize` refuses it: the report cites `reach.ts:1537` outside its filed
findings; read by hand per the runbook). The lane ran the suite (50/50 in
`reach.test.ts` at the time) and checked five non-bugs by reading; severities
are the lane's words (medium/low).

## bug-mimo-r2-1: A rider claims unrelated file changes

- target: scripts/reach.ts:1484
- location: `roundChanges` owners: a file change is owned when the lane wrote
  that path or is a rider (owns any ref/head move via a git write touch)
- severity: medium (lane's word)
- summary: If lane A merges the ticket branch while lane B's unexplained
  tracked edit lands in the same round, the edit is attributed to A,
  `unassignedTracked` stays false, and B's verdict is not voided. D4 says a
  change no record explains voids every verdict. Untracked new files are a
  lesser variant (finding on the rider instead of C13's note).
- evidence: by reading, with the #200-shaped merge as the working control.
- fix direction (lane's): only ride when the move produced the file (name the
  files in `before..after`), or leave file changes unowned unless a record
  names that path.

## bug-mimo-r2-2: `reason` is not card-escaped

- target: scripts/landing.ts (reachBlock reason interpolation)
- location: `reachBlock` escapes the path but interpolates `event.reason` raw;
  unexplained round changes put a path in `reason` (`reach.ts:1537`)
- severity: medium (lane's word)
- summary: A synthesis-worktree file named `weird<!--x.txt` (or an unexplained
  change naming a hostile ref) makes `card-block` output unshippable: the card
  check refuses `<!--`. The existing hostile-filename test covers only
  main-checkout paths through `reachPath`, not `reason`.
- evidence: by reading.
- fix direction (lane's): run `escapeCardPath` on `reason` and anything else
  free-form before it hits the card.

## bug-mimo-r2-3: Fixture score treats `void` like a reach finding

- target: scripts/fixture.ts (checkReach)
- location: fails on `event.kind === "finding" || event.kind === "void"`
- severity: low (lane's word)
- summary: C17 lists exactly three failure modes (a reach finding, a missing
  point, `not checked` on a supported reader); a `void` is not a finding, so a
  record that voided every reviewer with no finding should not FAIL reach.
- evidence: by reading.

## Notes (not filed by the lane)

- `commandTouches` takes `code` and never uses it.
- `splitShell` does not split single `&`; the spec lists only `;`, `&&`, `||`,
  `|`, `$(…)`; `touch /repo/x &` may misclassify.
- `1>` / `&>>` are not in the redirect operator list; a write via
  `echo x 1>/repo/x` would read as a path operand.
