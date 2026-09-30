# Workhorse spec: #159 A fixture run scores each lane's own branch against the hidden tests

Shared spec written by the coachman from the two lane specs, per the user's word in planning round 1. Both lanes implement from this same file, in blinkers as before.

## Summary

`fixture.sh score` runs the ticket's hidden tests only against the merged result on main. Extend it to run the same hidden suite against each lane's harvested branch and report each lane's pass and fail counts beside the merged result's, with self-test controls for a lane that passes, one that fails, and one that is missing.

## Technical context

- **Language and version**: bash entry point with the scoring logic in the Python 3 heredoc inside `scripts/fixture.sh` (the existing `py` function); self-test in bash in the same file.
- **Dependencies used or added**: none. Reuses `fixture.sh`'s own hidden-test helper and the same branch-export path `score` already uses; `bun` and `npm` are already required by `score`.
- **Testing**: `scripts/fixture.sh --self-test` (the new lane controls live there); then the project gate from the ticket profile via the tool's `scripts/verify.sh run .`.
- **Constraints**: reuse `fixture.sh hidden` for each lane branch; nothing the lanes see changes; a missing or unbuildable lane is reported as such, never as a pass.

## Direction check

- Reuse `fixture.sh hidden` for each lane branch: the same hidden-test helper the `hidden` subcommand exposes runs once per exported lane branch. No second test path.
- Nothing the lanes see changes: only `scripts/fixture.sh` is touched (the `score` path, that file's header comment, and its `--self-test`). No runbook, no waybill template, no fixture app, no ticket files.
- Every count needs a control: a lane that passes (positive), one that fails (negative), one that is missing (absent), plus a failed-to-build lane for AC2's other non-pass state. All score through the same `score_run` command.
- Deterministic work goes in `scripts/`: lane discovery, export and reporting are code in `fixture.sh`, not prose for a coachman to re-derive.
- A run is scored from its records: lane names come from the run's own records and the kept lane branches; `score` asks the lanes and the harnesses nothing.

## Structure

- `scripts/fixture.sh`
  - Header comment: `score` also reports each lane's hidden counts beside the merged result.
  - `py` score path: resolve the run's ticket id; discover the run's lane names; export each lane's harvested branch the way `score` exports main and run the hidden-test helper on that tree; append each lane's status beside the merged counts on the hidden-tests line.
  - `--self-test`: lane branches and the records that name them, plus assertions that a passing, a failing, a missing and an unbuildable lane are reported correctly and that the last two never read as a pass.

## Decisions

1. **What "harvested branch" means.** The `wb/<TICKET>-<lane>` tip the coachman keeps as a local archive. Score reads that ref; it does not parse a harvest SHA out of audit prose. A lane whose archive branch is gone is AC2's missing case.
2. **Which lanes are scored.** The union of the lane names in the run's own records (its manifest, audit and waybill) and the kept `wb/<TICKET>-*` refs: a lane named in the records but without a branch is reported missing, and a kept branch with no name in the records is still scored. Neither direction is silently dropped.
3. **Ticket id for the branch prefix.** The `# Waybill: <TICKET>` line, else the dispatch directory's basename.
4. **Report shape.** Beside the merged counts on the hidden-tests line, e.g. `… on main; one: 5 pass, 0 fail; two: missing`. The existing seven-line stdout contract stays: the lane counts extend the hidden-tests line, they add no new check line.
5. **Status vocabulary.** A lane that runs its suite reports `N pass, M fail`, even when every test fails. A lane with no branch reports `missing`. A lane whose branch cannot be scored reports `failed to build`. Those words, not pass counts.
6. **Lane results do not change the score's verdict.** The ok/FAIL on the hidden-tests line and the score's exit code still judge the merged result alone; the lane counts are measurement beside it.
7. **A failed-to-build control ships with the three AC3 controls.** AC2 names that state; leaving it untested would leave a "never as a pass" path without a control.

## Tasks

- [ ] T001 [P] [AC1] Extend the `score` path in `scripts/fixture.sh` to export each lane's `wb/<TICKET>-<lane>` branch and run the hidden-test helper on it, appending `; <lane>: <status>` beside the merged result's counts.
- [ ] T002 [AC2] In the same score path, report a lane with no ref as `missing` and a lane whose export or hidden suite cannot run as `failed to build`, never as pass counts.
- [ ] T003 [AC3] Add self-test controls in `scripts/fixture.sh --self-test` for a lane branch that passes, one that fails, and one that is missing, each asserted on the hidden-tests line through `score_run`.
- [ ] T004 [AC2] Add a self-test control for a lane branch that fails to build, asserted the same way and never as a pass.
- [ ] T005 [AC1] Update the `score` description in the `scripts/fixture.sh` header comment to mention the per-lane hidden counts beside the merged result.
