# Workhorse spec: #85 Self-test controls that fail at random: host.sh and review-round.sh timing, and grep -q under pipefail

## Summary

Make the affected self-test controls deterministic by waiting for the events they assert and by avoiding early-exit grep pipelines under `pipefail`.

## Technical context

- **Language and version**: Bash, with Python used by some shell scripts.
- **Dependencies used or added**: Existing shell utilities only; no dependencies added.
- **Testing**: Run each affected self-test, the timing controls 50 times with four other self-tests running concurrently, negative controls for the timing guarantees, the `grep -q` race control, and the project's declared gate through `scripts/verify.sh`.
- **Constraints**: Change controls rather than the guarantees they check; wait for concrete events under generous upper bounds; do not use fixed sleeps to decide a control; do not use `grep -q` in a breakable pipeline under `pipefail`; work only in this worktree and do not push.

## Direction check

The changes will be limited to self-test controls and their supporting assertions in `scripts/`. Timing checks will wait for the pid file, process state, marker, or other event they depend on, with a generous timeout. Output checks will use input forms that do not create a producer/consumer SIGPIPE race. Script behavior outside self-tests will remain unchanged unless inspection proves the guarantee itself is faulty. Validation will include repeated concurrent runs and negative controls.

## Structure

- `WORKHORSE-SPEC.md`
- `scripts/host.sh`
- `scripts/review-round.sh`
- Self-test scripts containing the affected `grep -q` pipeline form.
- `WORKHORSE-SUMMARY.md`

## Decisions

- The affected `grep -q` checks will be identified by searching self-test code in this worktree, then changed only where the pipeline can fail through `pipefail`.
- Event waits will use the narrowest observable event available in each control and a generous upper bound, rather than increasing a fixed sleep.
- Concurrency and negative-control evidence will be recorded in the final summary; no temporary fault will be committed.

## Tasks

- [ ] T001 [P] [AC1] Trace and record the timing dependencies in `scripts/host.sh` and `scripts/review-round.sh` self-tests.
- [ ] T002 [P] [AC4] Replace fixed-window timing assertions in `scripts/host.sh` and `scripts/review-round.sh` self-tests with event-driven waits and upper bounds.
- [ ] T003 [P] [AC5] Replace affected `grep -q` self-test pipelines across `scripts/` with non-breaking input checks and add a control that distinguishes the old race from the new form.
- [ ] T004 [AC2] Run both timing controls 50 consecutive times while four other script self-tests run concurrently, and record the results.
- [ ] T005 [AC3] Demonstrate that each timing control fails when its asserted guarantee is broken, without committing the fault.
- [ ] T006 [AC1] Record the identified timing causes and corresponding waits in `WORKHORSE-SUMMARY.md`.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] Run the declared verification command and record its output, command exits, decisions, and criterion verdicts in `WORKHORSE-SUMMARY.md`.
