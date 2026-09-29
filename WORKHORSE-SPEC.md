# Workhorse spec: #159 Score fixture lane branches

## Summary

Extend fixture scoring to run the existing hidden-test command against every harvested lane branch, reporting pass, fail, missing, or build-failure outcomes beside the merged result, with self-test controls for passing, failing, and missing branches.

## Technical context

- **Language and version**: Bash, with Python in heredocs where the existing script uses it.
- **Dependencies used or added**: Existing shell utilities and repository scripts; no new dependencies.
- **Testing**: `scripts/fixture.sh --self-test` for the lane outcome controls; the project gate from the ticket profile, including all listed script self-tests.
- **Constraints**: Reuse `fixture.sh hidden` for each harvested lane branch; leave lane-visible behavior unchanged; a missing or unbuildable lane must never count as a pass.

## Direction check

- Ticket direction: call the existing `fixture.sh hidden` flow for each harvested lane branch, preserving the inputs and behavior visible to lanes.
- Project rule 3: keep deterministic fixture-scoring logic and its self-test in `scripts/fixture.sh` rather than adding prose-only procedure.
- Project rule 5: use positive and negative self-test controls for lane pass/fail, plus a missing-branch control through the same scoring path.
- Project rule 6: route any project action logging added by the implementation through `scripts/log-action.sh`; avoid adding unlogged project actions.
- Worktree and identity rules: make the change only in this worktree, use brindlewick as commit author and committer, and do not push.

## Structure

- `scripts/fixture.sh`: score each harvested lane branch with the existing hidden-test command, report lane outcomes and counts, and add self-test controls.
- `WORKHORSE-SPEC.md`: this plan, committed before implementation.
- `WORKHORSE-SUMMARY.md`: final implementation, verification record, decisions, and acceptance verdicts, written and committed last after approval.

## Decisions

- Treat a missing harvested branch and a branch that fails to build as explicit non-pass outcomes in the score report; preserve the hidden-test pass and fail counts for branches that build.
- Keep the merged-result score and add lane scores alongside it, using the existing `fixture.sh hidden` behavior as the sole hidden-test runner.
- Keep the test controls within the existing `fixture.sh --self-test` path unless inspection during implementation shows the script uses a different established self-test entry point.

## Tasks

- [ ] T001 [P] [AC1] Extend `scripts/fixture.sh score` to run hidden tests against each harvested lane branch and report lane counts beside the merged result.
- [ ] T002 [P] [AC2] Report missing lane branches and lane build failures explicitly as non-passes in `scripts/fixture.sh`.
- [ ] T003 [P] [AC3] Add passing, failing, and missing lane-branch controls to the `scripts/fixture.sh` self-test.
