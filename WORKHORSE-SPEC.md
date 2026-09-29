# Workhorse spec: 163 Define the coachman contract

## Summary

Define the coachman contract and its implementation locations in one versioned contract index, detect contract changes between git revisions with exact part and line reports, and use that result to decide initial and repeated fixture runs.

## Technical context

- **Language and version**: Bash scripts with Python 3 for structured parsing, consistent with this repository.
- **Dependencies used or added**: Existing git and Python 3; no new dependencies.
- **Testing**: Contract detector self-test for all positive and negative controls, fixture/waybill workflow self-tests, and the project's full verify command.
- **Constraints**: Keep the contract precise at part-level rather than file-level; fixture repeats are based only on the contract detector's result for the merge from main; retain independent fixture gating for changes to the contract.

## Direction check

- The contract definition will be centralized in `docs/coachman-contract.md`, including markers and their writers, the waybill fields, turnpikes, stages/legs, and leg completion rules, with implementation locations listed for each part.
- Contract-sensitive passages in runbooks and implementations will be explicitly delimited so prose elsewhere in the same files remains out of scope.
- The detector will compare a base and head revision, report each changed contract part with file and line, and have controls for the required contract and non-contract cases.
- Dispatch will record the initial detector result on the waybill. The final card will evaluate the final branch, and a main merge will repeat a clean fixture only when the merge diff contains a contract change.
- `AGENTS.md` will point to the centralized definition rather than restating it.

## Structure

- `WORKHORSE-SPEC.md`: this plan, committed before implementation.
- `docs/coachman-contract.toml`: canonical contract definition and mapping to implementation sites.
- `scripts/coachman-contract.sh`: base/head detector and self-test controls.
- `skills/postmaster/postmaster.md`: dispatch record, final-branch fixture condition, and merge-repeat decision.
- `skills/postmaster/coachman.md` and `skills/postmaster/SKILL.md`: contract-marked runbook sections and the waybill shape.
- `scripts/host.sh`, `scripts/stage.sh`, `scripts/runs-status.sh`, `scripts/turnpikes.sh`, and `scripts/handoff-check.sh`: implementation markers, stages, turnpike and completion details as needed by the canonical mapping.
- `scripts/fixture.sh`: fixture workflow integration or focused self-test coverage as needed.
- `AGENTS.md`: pointer to the canonical contract definition.

## Complexity tracking

## Decisions

- Use a dedicated, versioned TOML contract definition with explicit implementation mappings, rather than a file-level detector, so wording changes in mixed-purpose runbooks do not trigger a fixture run.
- Use Python's standard-library TOML reader so the detector consumes the canonical definitions without a new dependency.
- Use explicit contract markers around the covered implementation passages, allowing the detector to identify exactly which part and lines changed.
- Treat a merge from main as a repeat trigger only when the contract detector reports a change in the merge's introduced diff.
- Keep fixture execution at the final branch and have the waybill record whether the change is expected to require it.

## Tasks

- [ ] T001 [P] [AC1] Add the canonical contract definition and map every covered part to its implementation files and passages in `docs/coachman-contract.toml`.
- [ ] T002 [P] [AC1] Mark contract passages in `skills/postmaster/coachman.md`, `skills/postmaster/SKILL.md`, `skills/postmaster/postmaster.md`, and relevant scripts, and replace the restated contract sentence in `AGENTS.md` with a pointer.
- [ ] T003 [P] [AC2] Implement base/head contract detection with per-part file and line reporting in `scripts/coachman-contract.sh`.
- [ ] T004 [AC3] Record the initial fixture requirement at dispatch and use final-branch detection for the card and main-merge repeat decision in `skills/postmaster/postmaster.md` and the relevant scripts.
- [ ] T005 [AC4] Add self-test controls for contract changes, non-contract changes, and merge repeat decisions in `scripts/coachman-contract.sh` and relevant existing self-tests.
- [ ] T006 [AC5] Point `AGENTS.md` to the canonical contract definition without restating its details.
- [ ] T007 [AC1] Run the required full verify gate, record its output and decisions in `WORKHORSE-SUMMARY.md`, and commit the completed summary.
