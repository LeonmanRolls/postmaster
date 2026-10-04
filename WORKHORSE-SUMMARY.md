# Workhorse summary

## Commits

- `49366fb` — #266 moves runbook steps into tested scripts.

## Checks

- Final pinned verify `scripts/run verify run .`: gate passed, exit 0, 1169s (`bun run check`).
- Final pinned verify `scripts/run verify run .`: coachman-contract passed, exit 0, 11s (`scripts/run coachman-contract --self-test`).
- `bun run check` — exit 0, 2,759 passed, 0 failed.
- `bun test scripts/runbook-lint.test.ts` — exit 0, 8 passed.
- `bun test scripts/link-skills.test.ts` — exit 0, 41 passed.
- Focused runbook, link, confinement and text tests — exit 0, 74 passed.
- `scripts/run skill-refs` — exit 0.
- `scripts/run runbook-lint` — exit 0.
- `scripts/run launch form luna` — exit 0; launch and resume forms printed.
- Harness adapter command-line audit — exit 0; no copied launch or resume lines found.
- C8 contract probe — expected exit 1; named `scripts/review-round.ts`.
- Draft `scripts/run summary-evidence .postmaster/verify/WORKHORSE-SUMMARY.md .` — exit 0.

## Evidence

1. `.postmaster/verify/direct-checks.txt`
   - `.postmaster/verify/summary-evidence-final.txt` (summary evidence validation)
2. `.postmaster/verify/direct-checks.txt`
3. `.postmaster/verify/direct-checks.txt`
4. `.postmaster/verify/direct-checks.txt`
5. `.postmaster/verify/pinned-verify-run.txt`
   - `.postmaster/verify/bun-run-check.txt`
6. `.postmaster/verify/bun-run-check.txt`
7. `.postmaster/verify/launch-form.txt`
   - `.postmaster/verify/harness-adapters.txt`
8. `.postmaster/verify/coachman-contract-c8.txt`
   - `.postmaster/verify/direct-checks.txt`
9. not shown: the fixture run and score are assigned to the coachman.

## Decisions

- Added a dedicated runbook lint command with its own tests because this check has a narrower file set and different rules from script-reference linting.
- Kept the launch, run-root, exclusion, shares, review-round and harvesting operations in script entry points, with stand-in tests for their subprocess calls and records.
- Added a test command wrapper and file-backed clean-checkout arguments so runbooks can name script calls without embedding shell code.
- Updated the link-resolution control to exercise the documented filesystem resolution directly after removing its old shell snippet.
- Made the confinement ownership control compare against the host's actual root-owned path chain; this environment reports the container root as uid 65534.

## Not done

- C9 fixture dispatch and scoring were not run here; the workhorse brief assigns them to the coachman.
- The branch was not pushed, per the workhorse instructions.

## Verdict

1. Met: non-script shell-block lines are refused.
2. Met: shell syntax in command spans and script calls is refused.
3. Met: refusals include file, line, finding and command.
4. Met: the check reads `AGENTS.md` and Markdown under `skills/` only.
5. The branch gate passes; the post-merge main result is not available before merge.
6. Met: migrated steps have adjacent tests and the full suite passes.
7. Met: copied harness launch and resume commands are removed; the script prints both forms.
8. Met: changed step implementations are listed in the coachman contract.
9. Not shown: the coachman owns the fixture run and score.
