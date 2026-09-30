# Workhorse spec: #179 Criterion evidence and iterative verification

## Summary

Add per-criterion demonstrations to the workhorse spec and make the workhorse loop through real-use evidence and passing checks before its final summary, with the summary audit validating evidence files under `.postmaster/verify/`.

## Technical context

- **Language and version**: TypeScript run by Bun for the new evidence validator; existing Bash and Python for `scripts/verify.sh`; Markdown for the runbook and template.
- **Dependencies used or added**: No new dependencies. Use Bun's existing runtime and test runner.
- **Testing**: `bun test scripts/workhorse-evidence.test.ts`; `bun test ./scripts ./lint`; `scripts/verify.sh --self-test`; the project's full gate from the waybill; and a fixture run created and scored on this branch as required for a coachman-contract change. The fixture is CLI-only, so the browser path will be checked through the generated brief contract and the existing render gate; this repo has no web fixture.
- **Constraints**: Keep blind acceptance tests hidden from lanes. Keep lane evidence under `.postmaster/verify/`, which the root `.gitignore` already ignores. Use the project's own browser library from a shell command in the lane worktree, avoid shared browser servers, and report browser evidence as not shown when the lane harness has no browser backend. Add no web fixture or harness-specific behavior to the generic workhorse contract.

## Direction check

- The ticket requires a real-use loop for every criterion and every check. The coachman brief will require build, exercise, repair and repeat until every criterion is shown and checks pass; a genuinely stuck lane records its blocker. Running `<tool>/scripts/verify.sh run .` remains the final verification step immediately before writing the summary.
- For a user surface, the brief will require a shell-driven browser walk through the target project's browser library for each surface-touching criterion, regardless of whether the ticket has a `User journey`, with a screenshot for every step. Without a ticket journey, the lane records the steps it walked in its summary. The current project has no UI fixture, as the ticket notes.
- For CLI tools and scripts, the brief will require changed commands to run with realistic input in their normal form and preserve command, output and exit in a transcript.
- Each criterion's summary entry will have evidence paths under `.postmaster/verify/`, or an explicit `not shown` reason. The validator will reject missing criteria, empty evidence, paths outside that directory, and paths that do not exist. The coachman will read each lane's evidence and treat a shown claim without valid evidence as a lane defect.
- Keep the workhorse spec and summary contracts intact apart from the requested criterion demonstration and evidence sections. Do not change spec ownership or reveal blind acceptance tests.
- The new deterministic validator will use a functional core with filesystem access at the command edge. Its tests will be beside it in `scripts/workhorse-evidence.test.ts`.

## Structure

- `skills/postmaster/workhorse-spec-template.md`: add a section recording, for every acceptance criterion, its real-use command and input and expected output, or its user-surface steps and expected visible result.
- `skills/postmaster/coachman.md`: expand the workhorse capability and brief contract with the implementation loop, real-use CLI transcripts, browser steps and screenshots, no-journey reporting, unavailable-browser handling, summary evidence requirements, and coachman evidence review.
- `scripts/workhorse-evidence.ts`: validate that every ticket criterion has an evidence path that exists under `.postmaster/verify/`, or an explicit `not shown` line with a reason.
- `scripts/workhorse-evidence.test.ts`: cover complete evidence, a criterion missing evidence, a referenced file that does not exist, and a `not shown` reason.
- `scripts/verify.sh`: run the evidence validator as part of `summary` and update its summary self-test fixtures for the required criterion records.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Add a TypeScript evidence validator and connect it to the existing summary command. | The summary must be held to a deterministic, testable structure while preserving the existing check-result audit. | Prose-only review cannot ensure every criterion has an existing artifact or a stated reason it was not shown. |

## Decisions

- Keep the evidence format in `WORKHORSE-SUMMARY.md` criterion-by-criterion, using transcript paths for CLI work and journey-report plus screenshot paths for browser work. Use `not shown: <reason>` when evidence cannot be produced.
- Read the ticket's numbered acceptance criteria from the ticket copy made by `scripts/verify.sh arm`; do not infer the expected criterion count from lane-authored summary text.
- Constrain referenced files to the worktree's `.postmaster/verify/` directory. The existing root ignore rule already covers this path, so no ignore-file change is needed.
- Do not add a web fixture in this ticket. The branch's fixture run will exercise the CLI transcript path; the workhorse brief contract and coachman's render gate cover the browser path until a web fixture exists.
- Preserve the current planning and spec-authoring flow. The template section describes the evidence plan for each criterion; this ticket does not implement #170's coachman-authored single-spec flow.

## Criterion demonstrations

For this ticket, show each change through the repository's real workhorse path: the text included in the brief, the validator invoked during summary review, and the fixture lane's CLI commands and retained transcripts. The repository has no user surface, so criterion 3's generic browser behavior is demonstrated by the brief contract rather than a browser walk in this repository.

| Criterion | Method and input | Expected result |
|---|---|---|
| AC1 | Read `skills/postmaster/workhorse-spec-template.md` and inspect the section against each numbered criterion in a waybill. | The template asks for a real-use command, input and expected output, or user-surface steps and expected visible result, for every criterion. |
| AC2 | Inspect the generated workhorse brief and run the CLI fixture lane through an intentionally failing criterion/check followed by a correction and rerun. | The brief specifies the build/exercise/fix loop, the lane continues until the criteria and checks pass, reports a genuine blocker, and runs `verify.sh run .` last before its summary. |
| AC3 | Inspect the generated brief for a web-target waybill with a `User journey` and one without; the repository itself has no web fixture. | Both briefs require browser use through the target project's own library for each surface-touching criterion, a screenshot per step, and a summary journey when the ticket has no journey. A harness with no browser backend records `not shown` and the reason for coachman render review. |
| AC4 | Run the fixture app's changed CLI commands with realistic input in their normal form and retain each command's output and exit in its transcript. | The lane's transcript records the command, output and exit for the CLI behavior it claims. |
| AC5 | Run the fixture lane and inspect `WORKHORSE-SUMMARY.md` and the referenced files under `.postmaster/verify/`. | Every criterion names its transcript or journey report and screenshots, or says `not shown` with a reason; the artifacts remain ignored by git and readable by the coachman. |
| AC6 | Run `scripts/verify.sh summary` against a fixture lane summary and inspect the coachman's evidence-review instructions. | Missing criterion evidence and nonexistent artifact paths fail validation; the coachman reads each lane's evidence and counts an unsupported shown claim against that lane. |
| AC7 | Inspect the codex workhorse brief and its summary evidence entry, then run the fixture's existing coachman render gate. | The lane records browser evidence as `not shown` because codex has no browser backend, and coachman render review remains available. |
| AC8 | Run `bun test scripts/workhorse-evidence.test.ts`. | Tests pass for complete evidence, missing criterion evidence, nonexistent evidence and a `not shown` line. |

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
 task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Add the criterion demonstration section to `skills/postmaster/workhorse-spec-template.md`.
- [ ] T002 [P] [AC2] Specify the build, exercise, repair and rerun loop and the final `verify.sh run .` step in `skills/postmaster/coachman.md`.
- [ ] T003 [P] [AC3] Specify per-criterion browser walks, screenshots, no-journey reporting and unavailable-backend handling in `skills/postmaster/coachman.md`.
- [ ] T004 [P] [AC4] Specify normal-form CLI execution and retained transcripts in `skills/postmaster/coachman.md`.
- [ ] T005 [P] [AC5] Specify criterion-by-criterion summary artifacts under `.postmaster/verify/` in `skills/postmaster/coachman.md`.
- [ ] T006 [AC6] Add `scripts/workhorse-evidence.ts`, integrate it into `scripts/verify.sh summary`, and direct the coachman to inspect evidence in `skills/postmaster/coachman.md`.
- [ ] T007 [P] [AC7] Preserve the render gate and require an explicit `not shown` reason when a lane has no browser backend in `skills/postmaster/coachman.md`.
- [ ] T008 [AC8] Add `scripts/workhorse-evidence.test.ts` for complete, missing, nonexistent and not-shown criterion evidence, and update `scripts/verify.sh` summary self-test fixtures.
