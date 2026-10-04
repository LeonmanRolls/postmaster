# Workhorse summary

## Built

- `ee357ee` Add configurable single-thread dispatch mode.
- `dd03253` Exercise mode-specific fixture behavior.
- `16e7b83` Format mode dispatch and fixture checks.
- `56c9d9f` Parse waybill mode without whitespace escapes.
- `56d4f13` Record rootless gate blocker; superseded and removed by `8329557` after the ruling.
- `8329557` Remove superseded confinement blocker.

## Checks

Final pinned verification, run on the final code immediately before writing this summary:

- `$TOOL/scripts/run verify run .` — exit 2.
  - `gate: fail, exit 1, 1424s: bun run check`
  - `coachman-contract: pass, exit 0, 8s: scripts/run coachman-contract --self-test`
  - The gate ran 2,912 tests: 2,911 passed and the only failure was the mapping-sensitive `probe-confine` root-owned-chain test. The full output and exits are in `.postmaster/verify/final-verify.txt`; the gate log is `.postmaster/verify/logs/gate.log`.

Other verification commands and exits:

- `bun install --frozen-lockfile` — exit 0.
- `bun test scripts/setup.test.ts scripts/run-meta.test.ts` — exit 0, 116 passed.
- `bun test scripts/fixture.test.ts` — exit 0, 109 passed.
- `bunx biome format --write scripts/fixture.test.ts scripts/fixture.ts scripts/run-meta.test.ts scripts/run-meta.ts scripts/setup.test.ts` — exit 0; formatted five changed files.
- `scripts/run skill-refs --fix && scripts/run skill-refs` — exit 0.
- `rg -n "feature at the boundary|changes after its first commit|check cannot pass as written|Do not depart from a ticket check" skills/postmaster/coachman.md` — exit 0; transcript `.postmaster/verify/runbook-policy.txt`.
- `bun test scripts/run-meta.test.ts` — exit 0, 116 passed.
- `bun test scripts/lib/text.test.ts` — exit 0, 9 passed.
- `bunx tsc --noEmit` — exit 0.
- `bunx biome format scripts/run-meta.ts` — exit 0.
- `bunx oxlint scripts/run-meta.ts` — exit 0.
- `git diff --check` — exit 0.
- `bun test scripts/probe-confine.test.ts` in the lane's confined environment — exit 1, 15 passed and the root-owned-chain test failed. The coachman's unconfined run is recorded below.
- Coachman's unconfined `bun test scripts/probe-confine.test.ts`, as reported in the ruling for code commit `56d4f13d4b809774f80f80935f0b9ad26a80a062` — exit 0, 16 passed.
- Earlier `$TOOL/scripts/run verify run .` attempts: exit 3 when the worktree lacked installed `tsc`; exit 2 when the formatter found drift; exit 2 when the text guard also found the mode parser's `\\S` escape. Dependencies and formatting were fixed, and the parser was changed and retested. The final verifier above then had only the mapping-sensitive confinement failure.

## Evidence

1. `.postmaster/verify/logs/gate.log`
2. `.postmaster/verify/run-meta-targeted.txt`
3. `.postmaster/verify/run-meta-targeted.txt`
4. `.postmaster/verify/run-meta-targeted.txt`
5. `.postmaster/verify/run-meta-targeted.txt`
6. `.postmaster/verify/logs/gate.log`
7. `.postmaster/verify/logs/gate.log`
8. `.postmaster/verify/logs/gate.log`
9. `.postmaster/verify/runbook-policy.txt`
  - `.postmaster/verify/logs/gate.log`
10. `.postmaster/verify/runbook-policy.txt`
11. `.postmaster/verify/logs/gate.log`
12. `.postmaster/verify/logs/gate.log`
13. `.postmaster/verify/logs/gate.log`
14. `.postmaster/verify/logs/gate.log`
15. `.postmaster/verify/logs/gate.log`
16. `.postmaster/verify/run-meta-targeted.txt`
17. `.postmaster/verify/logs/gate.log`
18. `.postmaster/verify/logs/gate.log`
  - `.postmaster/verify/final-verify.txt`
  - `.postmaster/verify/summary-evidence.txt`

## Within-brief decisions

- Used `team.mode` with `synthesis`, `single-thread` and `alternate`; an absent setting resolves to `synthesis`.
- Added the `run-meta mode` read verb. `--mode` accepts `synthesis` or `single-thread`, takes precedence over the setting, and records source and setting at dispatch.
- In `alternate`, selected the opposite of the project's latest written run mode; a missing prior run or a legacy run without a mode is treated as synthesis, so the next mode is single-thread. A user-selected mode is recorded as the latest run.
- Kept the existing workhorse configuration for synthesis and review fallback. Single-thread records no lanes and writes in the synthesis stage.
- Used the fixture todo command as the acceptance boundary: `todo remove 2`, checking its printed result and persisted state.

## What I did not do and why

- No browser evidence applies: the fixture app is command-line only and this project has no browser suite.
- I did not alter `scripts/probe-confine.test.ts` or system ownership. The final gate ran under the lane's user namespace and failed only its root-owned-chain probe. The coachman's unconfined run of `bun test scripts/probe-confine.test.ts` on code commit `56d4f13d4b809774f80f80935f0b9ad26a80a062` passed all 16 tests. The test file is untouched; the diff from base in `scripts/probe-confine.ts` and `scripts/lib/` is empty.
- I did not push, publish, or contact the tracker.

## Verdicts

1. Met — setup lists and validates the mode setting.
2. Met — a missing setting records synthesis and its setting source.
3. Met — alternate uses the project's latest written mode and handles legacy runs.
4. Met — a ticket's mode wins, invalid modes are refused, and the selected mode counts as latest.
5. Met — the record and read verb expose mode, source and setting.
6. Met — single-thread records no workhorse lanes or artifacts.
7. Met — the blind CLI acceptance test is the first change commit and is red at base, green at head.
8. Met — fixture acceptance tests exercise the public todo command and stored state without importing `src/`.
9. Met — the runbook requires test-only follow-up commits with a reason.
10. Met — the runbook escalates an unpassable or contradictory ticket check for the postmaster's ruling.
11. Met — single-thread verification repeats before checkpoint until the ticket checks pass.
12. Met — single-thread skips `workhorses-running`; the scorer rejects either mode's incorrect stage sequence.
13. Met — both modes retain the same reviewers, lenses, review decisions, gate and card headings.
14. Met — fixture review briefs contain no mode name.
15. Met — run records, actions and cards identify the mode.
16. Met — `run-meta check` rejects a waybill/record mode mismatch and accepts legacy records with neither.
17. Met — scorer negative controls reject workhorse activity in single-thread and missing activity in synthesis.
18. Met — the fixture suite scores synthesis and single-thread records clean; the single-thread hidden-tests result is merged and has no lane suffix.
