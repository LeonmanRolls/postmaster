# Workhorse spec: #124 The review leg ends with the run ready for the user's merge, with no separate ship leg

## Summary

New runs will finish in synthesis or review by writing the complete ready-to-merge card and hand-off, while a contract version in `run.json` preserves the three-leg schedule and ship behavior of runs already dispatched.

## Technical context

- **Language and version**: Bash and Python 3, run in place.
- **Dependencies used or added**: Existing project scripts and `gh` for a GitHub pull request; no new dependencies.
- **Testing**: `turnpikes.sh --self-test`, `runs-status.sh --self-test`, `stage.sh --self-test`, `run-meta.sh --self-test`, the changed runbook reference check, fixture run and score, and the required project gate.
- **Constraints**: Keep the coachman contract versioned; current runs have one or two legs, old runs retain synthesis, optional review, and ship. The coachman never merges a current run. The postmaster verifies the card and follows the project's landing route.

## Direction check

- The final active leg owns the ready-to-merge card and hand-off, then touches its own completion marker; no current run launches a ship leg.
- The card is assembled from final-HEAD checks, project browser suite and QA when present, turnpike records, open findings, all run-created branches, and the review link.
- A current run without a review turnpike completes its final card in synthesis.
- The postmaster verifies the current card, opens a pull request for projects that land through pull requests, or obtains the configured merge word and performs a local merge; after merge it runs existing aftercare and teardown.
- `run.json` identifies the coachman contract. Missing version data means legacy, preserving runs dispatched before this change.
- Self-tests cover two-leg, one-leg, and pre-change three-leg flows; fixture scoring remains required because this changes the coachman contract.

## Structure

- `scripts/run-meta.sh`: record the active coachman contract version at dispatch.
- `scripts/turnpikes.sh`: produce current one- or two-leg schedules and legacy three-leg schedules for older runs.
- `scripts/runs-status.sh`: exercise current one- and two-leg final-card states and legacy three-leg progression.
- `scripts/stage.sh`: add the current ready-to-merge stage while retaining legacy shipping stages.
- `skills/postmaster/coachman.md`: move card preparation to the last active leg and retain the legacy ship path.
- `skills/postmaster/postmaster.md`: verify current cards, follow pull-request or local-merge landing, and retain legacy stage handling.
- `skills/postmaster/SKILL.md`, `README.md`: document the landing route and two-leg contract.

## Decisions

- Contract version 2 identifies new runs; a missing version is treated as legacy so existing `run.json` files keep their original schedule.
- The waybill states whether the target lands through a pull request or a local merge, from project instructions or the user's launch card. An unknown route is settled before dispatch rather than guessed from the presence of a remote.
- Pull-request projects are merged by the user in their normal review surface. Local-merge projects use the existing `ship.merge_authority` choice; the postmaster performs the local merge after the required word or grant.
- Workhorse branches are not pushed by a workhorse. The postmaster pushes the run branch when opening a pull request.

## Tasks

- [x] T001 [AC5] Add a versioned current-versus-legacy leg contract in `scripts/run-meta.sh` and `scripts/turnpikes.sh`.
- [x] T002 [AC1] Make final synthesis and review produce the ready-to-merge card, final hand-off, and leg marker in `skills/postmaster/coachman.md`.
- [x] T003 [AC2] Put final-HEAD checks, browser QA, turnpikes, findings, branch states, and review link on the final card in `skills/postmaster/coachman.md`.
- [x] T004 [AC3] Route a no-review run from synthesis to the final card in `skills/postmaster/coachman.md`.
- [x] T005 [AC4] Verify the current hand-off and card, follow the pull-request or local-merge route, then retain aftercare and teardown in `skills/postmaster/postmaster.md`.
- [x] T006 [AC5] Update run polling, stages, front-door profile, and README for current runs while preserving legacy runs in `scripts/runs-status.sh`, `scripts/stage.sh`, `skills/postmaster/SKILL.md`, and `README.md`.
- [x] T007 [AC6] Add one-, two-, and legacy three-leg controls to changed script self-tests in `scripts/run-meta.sh`, `scripts/turnpikes.sh`, `scripts/runs-status.sh`, and `scripts/stage.sh`.
- [ ] T008 [AC1] Keep the contract change mergeable only after the fixture run and score clean.
