# Workhorse spec: 110 Keep project gates from reading run worktrees

## Summary

Run the postmerge project gate from a temporary checkout of the merged default branch outside the target repository so project tools cannot read any run's working copies.

## Technical context

- **Language and version**: Bash with Python 3.11, matching the existing flow scripts.
- **Dependencies used or added**: Existing git, Python, and project check dependencies; no new dependencies.
- **Testing**: `scripts/verify.sh --self-test` for isolated gate behavior and its negative control; `scripts/wiki-lint.sh` for the recorded rationale; `scripts/fixture.sh --self-test` and a scored fixture run for the fixture gate.
- **Constraints**: Keep the flow generic and deterministic, do not ask projects to ignore `.worktrees/`, and run the main gate without exposing it to run worktrees.

## Direction check

- The ticket requires the flow to keep project tools from seeing run worktrees. The postmerge gate will use a temporary checkout outside the project directory, so worktrees from this run and concurrent runs remain outside the gate's input tree.
- The project rules require generic behavior, deterministic script behavior, and a control for every count. The checkout location and gate command will be derived from the target and run record; a self-test will prove both a passing isolated gate and a failing gate when the same check reads a copy under `.worktrees/`.
- The project rules require every project action to be logged. The postmerge gate result will be recorded through the existing verification action path.
- The project requires this rationale in the wiki. The implementation will add a concise concept page and its index entry.

## Structure

- `WORKHORSE-SPEC.md`: this plan.
- `scripts/verify.sh`: run the recorded gate against a temporary checkout of the merged default branch and self-test the positive and negative controls.
- `skills/postmaster/postmaster.md`: run the isolated postmerge gate after removing this run's working copies.
- `scripts/fixture.sh`: exercise the postmerge gate behavior in fixture scoring and its self-test.
- `wiki/index.md` and `wiki/concepts/main-gate-isolation.md`: record the reason for isolating the postmerge gate from run worktrees.

## Complexity tracking

None.

## Decisions

- Use a temporary detached checkout outside the project directory for the postmerge gate. A checkout under the target's `.worktrees/` would still be visible to project tools that walk that directory; waiting only for this run's teardown would leave concurrent runs visible.
- Keep the existing in-project worktree layout for lane isolation. Moving every run checkout would widen the change across launch, review, host, cleanup, and recovery behavior.
- Use a generated project whose check fails when a marker exists under `.worktrees/` as the self-test control. The same command must fail from the project root with the marker and pass from the isolated main checkout.

## Tasks

- [ ] T001 [P] [AC1] Add a postmerge gate command in `scripts/verify.sh` that checks the merged default branch from a temporary checkout outside the project directory and records the result.
- [ ] T002 [P] [AC2] Add `wiki/concepts/main-gate-isolation.md` and link it from `wiki/index.md`, explaining why the postmerge gate runs outside the project directory.
- [ ] T003 [AC1] Update `skills/postmaster/postmaster.md` Stage G to run the isolated postmerge gate after this run's working copies are removed.
- [ ] T004 [AC3] Extend `scripts/verify.sh --self-test` with a fail-on-copy project, a passing isolated-gate control, and a negative control that fails when the same check reads a copy under `.worktrees/`.
- [ ] T005 [AC4] Extend `scripts/fixture.sh` scoring and self-test to prove the fixture app gate passes against merged main while run worktrees remain outside its checkout.
