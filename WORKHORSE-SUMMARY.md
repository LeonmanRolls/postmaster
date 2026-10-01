# Workhorse summary: #179

## Commits

- `6261673` Add the approved shared workhorse spec.
- `d4c4097` Add criterion checks to the workhorse spec template.
- `9edd71f` Add the workhorse summary evidence checker and its tests.
- `6cbb325` Require workhorses to show criterion evidence.
- `36f86f7` Clarify the workhorse evidence review steps.
- `26d0e55` Resolve summary evidence paths safely.
- This summary is committed last.

## Checks

- Gate command `/home/brindlewick/.postmaster/tool-pins/653ba2e8f9b13c985809773f41b04a58bb10532c/scripts/verify.sh run .`, exit 0. It printed:
  `gate: pass, exit 0, 746s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && bun test scripts/usage.test.ts && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done && bun test scripts/run-clash.test.ts && bun install --frozen-lockfile && bun test ./scripts ./lint && bun run lint'`
  `verify.sh run . exit: 0`
- `bun test scripts/summary-evidence.test.ts`: exit 0; 4 tests passed.
- `bun test ./scripts ./lint`: exit 0; 88 tests passed, 329 expectations across six files.
- `bun run lint`: exit 0.
- `scripts/skill-refs.sh`: exit 0; `scripts/skill-refs.sh --fix`: exit 0; the final skill reference check passed in the gate.
- Fixture `remove` checks AC1–AC8: patched copy exit 0 for each criterion; unchanged copy exit 2 for each, because `remove` is absent. Each command, output and exit is recorded in the criterion transcripts.
- Draft summary evidence check with `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts .postmaster/verify/WORKHORSE-SUMMARY-draft.md .`: exit 0.
- `git check-ignore` on every final evidence path: exit 0; all ten paths printed as ignored.
- Five damaged-summary checks (missing criterion, missing artifact, parent traversal, symlink escape and empty evidence entry): exit 2 each, naming the criterion and defect.
- `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts .postmaster/verify/ac7-not-shown-summary.md .`: exit 0; one `not shown` entry accepted.
- Render-gate clause source check with `rg`: exit 0.
- Final `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .`: exit 0; transcript is in `.postmaster/verify/criterion-checks/ac4-draft-command.md`.

## Evidence

1. .postmaster/verify/criterion-checks/ac1-template.md
   - .postmaster/verify/fixture/remove-spec.md
   - .postmaster/verify/fixture/remove-check-results.md
2. .postmaster/verify/criterion-checks/ac2-contract.md
3. .postmaster/verify/criterion-checks/ac3-browser-contract.md
4. .postmaster/verify/criterion-checks/ac4-draft-command.md
5. .postmaster/verify/criterion-checks/ac5-ignore.md
6. .postmaster/verify/criterion-checks/ac6-negative-controls.md
7. .postmaster/verify/criterion-checks/ac7-not-shown.md
8. .postmaster/verify/criterion-checks/ac8-tests.md

## Decisions

- Kept `summary-evidence.ts` standalone. It imports no `scripts/lib/` module, so no #109 port files were copied and `scripts/verify.sh` was left unchanged, per Decisions 3 and 9.
- Used the approved spec's current criterion wording and check table, not the older wording in the armed ticket copy. The checker matches acceptance criteria by number, as Decision 1 specifies.
- Kept the existing planning flow and did not implement #170's single coachman-authored spec.

## What I did not do

- I did not run a landing fixture run. Per Decision 11, the postmaster runs and scores it after this branch; the score does not inspect summary evidence.
- I did not perform a browser walk. This repository has no user surface or web fixture; the browser contract awaits a web-target run as the approved AC3 check says.
- I did not read the fixture ticket's hidden tests.

## Verdict

- AC1: met; the template has the reviewed check table and the fixture remove checks pass on the patched copy while failing on the unpatched copy.
- AC2: met in the workhorse contract; the postmaster still needs to verify lane briefs and evidence copies in the required landing fixture run.
- AC3: met in the generic browser clauses; live browser use awaits a web-target run because this repository has no user surface.
- AC4: met; the final summary evidence command exits 0 and its transcript is cited.
- AC5: met; each criterion has a cited artifact and `git check-ignore` prints every evidence path.
- AC6: met; the checker passes valid evidence and rejects all five required damaged shapes, including both path escapes.
- AC7: met; a `not shown` reason for a missing browser backend passes validation, and the render gate remains in place.
- AC8: met; all four requested test cases pass.
