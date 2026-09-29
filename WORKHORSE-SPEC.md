# Workhorse spec: 132 hotfix workflow for postmaster faults

## Summary

Add a named hotfix skill and deterministic script that take a postmaster fault through a controlled fix and merge, then report and apply only that fix to in-flight runs that need it.

## Technical context

- **Language and version**: Bash with Python 3.11+ for structured data and git/run inspection.
- **Dependencies used or added**: Existing git, tracker, logging, and verification scripts; no new dependencies.
- **Testing**: `scripts/hotfix.sh --self-test`, the declared repository gate, and the ticket's verify command.
- **Constraints**: Do not merge main into a run branch. Apply a fix commit only between legs, skip branches with overlapping edits, log each project action with `scripts/log-action.sh`, and respect `ship.merge_authority`.

## Direction check

- Keep the operator workflow in a skill that is linkable by the existing skill installer, and put deterministic classification and application in `scripts/`.
- Start the fix worktree from `origin/main`; require a failing control before a passing control and a PR title beginning `#<ticket>,`.
- Merge only under the configured `ship.merge_authority`, then pull the main checkout and classify each in-flight run against the fix.
- Keep run propagation scoped to the fix commit. Use the run's next stop between legs and include the main-fix note in both the commit message and next-leg prompt.
- Log each action at the time it happens in both the run and project ledgers through `scripts/log-action.sh`.
- Preserve the user rule for overlapping changes: leave that branch untouched, report it, and let the second merger resolve the conflict.
- Make no edits outside this worktree and do not push from this workhorse session.

## Structure

- `skills/postmaster/hotfix/SKILL.md`: operator workflow for a postmaster fault.
- `scripts/hotfix.sh`: controlled fix, run classification, and between-leg application commands, including self-tests.
- `skills/postmaster/SKILL.md`: make the hotfix skill discoverable from the postmaster skill.
- `WORKHORSE-SPEC.md`: this plan, committed before implementation.
- `WORKHORSE-SUMMARY.md`: final implementation, checks, decisions, and acceptance verdict.

## Decisions

- Use an explicit `report` / `apply` script interface so classification can be reviewed before changing any run branch.
- Resolve merge authority from the existing machine configuration and stop before merge when the person must say the merge word.
- Treat the commit identifier and run records as the source for propagation; never pull or merge unrelated main changes into run branches.
- Make the self-test exercise both a run requiring the fix commit and a run that does not, through the same report command.

## Tasks

- [ ] T001 [AC1] Add `skills/postmaster/hotfix/SKILL.md` with the controlled fault-to-merge workflow.
- [ ] T002 [AC1] Add deterministic fix preparation, checks, merge-authority handling, and main-checkout pull support to `scripts/hotfix.sh`.
- [ ] T003 [AC2] Classify every in-flight run by checkout, branch-copy, or already-read runbook propagation in `scripts/hotfix.sh`.
- [ ] T004 [AC3] Apply the fix commit alone at a run's next between-leg stop and include the required notes.
- [ ] T005 [AC4] Detect overlapping branch edits, leave those branches untouched, and name them in the report.
- [ ] T006 [AC5] Log hotfix and propagation actions with `scripts/log-action.sh` and add a same-command positive/negative control.
- [ ] T007 [AC1-AC5] Link the new skill from `skills/postmaster/SKILL.md` and verify skill references, self-tests, and the project gate.
