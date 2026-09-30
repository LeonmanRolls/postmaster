# Workhorse spec: 170 The coachman writes one spec that every workhorse implements, and the user reviews it once

## Summary

Change planning so the coachman writes and commits one template-level spec per ticket, gets the user's approval (or changes and a second review, or a stop), then gives that same approved spec to each isolated workhorse.

## Technical context

- **Language and version**: Bash and Python in heredocs; Markdown documentation.
- **Dependencies used or added**: Existing shell and Python tools only.
- **Testing**: Run the project's `scripts/verify.sh run .` command for the default turnpike; add self-test controls for one-spec review, a changes round, approval, stop, fixture sign-off and a run dispatched before this change. Run and score a fixture run before merge.
- **Constraints**: Preserve old-run behavior through the run's pinned tool, keep lanes isolated, use the workhorse-spec template, and keep the spec at the level of requirements, consequential decisions and tests.

## Direction check

- The coachman writes and commits one spec in the synthesis worktree before implementation. The user sees one review package and chooses approval, changes in their own words, or stop. A changes round revises that spec and pauses for review again. Fixture runs retain postmaster sign-off.
- On approval, each workhorse receives the same approved spec in its own worktree and never sees another lane's work. Workhorses write no specs.
- Keep the spec to the workhorse-spec template's level: what to build, consequential decisions and tests, without prescribing implementation code.
- Make `spec-decisions.sh`, the review package, `.spec-review-ready`, stage timings and action logging represent one spec per run. A run dispatched before this change continues under its pinned tool and per-workhorse spec contract.
- Add self-test controls for one-spec packaging, a changes round, approval, stop, fixture sign-off and a pre-change run. Update the planning-stage wiki record with the change and evidence for useful implementation diversity, including lane shares from #158.
- Work only in this assigned worktree, do not push or read other branches, and keep new paths project-relative. Deterministic behavior belongs in scripts, with positive and negative controls for counts.

## Structure

- `skills/postmaster/coachman.md` — have the coachman author, review and hand off one spec; launch workhorses only after approval.
- `skills/postmaster/postmaster.md` — review one spec, record approval/changes/stop, and preserve fixture sign-off.
- `skills/postmaster/workhorse-spec-template.md` — identify the coachman as author while retaining the template's detail level.
- `scripts/spec-decisions.sh` — record and count one run-level decision and each review round.
- `scripts/log-action.sh` and `scripts/run-times.sh` — record and time the one-spec planning flow.
- `scripts/runs-status.sh` and `scripts/runs-watch.sh` — keep the one-package readiness marker and its user-wait control aligned.
- `scripts/fixture.sh` — cover fixture-run sign-off and score the updated planning contract.
- `wiki/concepts/planning-stage.md`, `wiki/concepts/workhorse-spec.md` and `wiki/index.md` — align the planning claim, workhorse-spec role and index summary; record what lane-share evidence would show useful diversity.

## Decisions

- Use the synthesis worktree's `WORKHORSE-SPEC.md` as the one coachman-authored, committed spec; copy the approved file into each lane's own worktree as its shared input.
- Record approval, changes with the user's words, or stop as the run-level outcomes. A fixture's postmaster records approval under the existing fixture rule.
- Rely on the dispatch's pinned tool to preserve the per-workhorse workflow for runs started before this change; cover that boundary with a legacy-run self-test fixture instead of migrating old artifacts.
- Extend the existing review package, readiness marker, decision script and action log rather than introducing a second review system.
- Keep the spec at the workhorse-spec template level and leave implementation details to each lane.
- Use existing gate, script self-test and fixture-run conventions to verify the change; add no dependencies.

## Tasks

- [ ] T001 [AC1] [AC2] Update `skills/postmaster/coachman.md`, `skills/postmaster/postmaster.md` and `scripts/spec-decisions.sh` for one coachman-authored spec, one user review, changes rounds and run stop; retain postmaster fixture sign-off.
- [ ] T002 [AC3] [AC4] Update `skills/postmaster/workhorse-spec-template.md` and the workhorse brief so each lane gets the same approved spec in its own worktree, writes no spec and retains implementation choices.
- [ ] T003 [AC5] [AC6] Update review packaging, `.spec-review-ready`, stage timing and action logging in `scripts/log-action.sh`, `scripts/run-times.sh`, `scripts/runs-status.sh` and `scripts/runs-watch.sh`; add controls for one spec, changes, approval, stop, fixture sign-off and a pre-change run.
- [ ] T004 [AC7] Update `wiki/concepts/planning-stage.md`, `wiki/concepts/workhorse-spec.md` and `wiki/index.md` to record the change and how lane shares from #158 and later runs can show useful implementation diversity.
