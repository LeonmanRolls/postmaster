# Workhorse summary

## What was built

- `7eb24dd` enforces the Bun minimum before a script loads.
- `555e12b` adds macOS coverage, a skip inventory and checker, cross-platform test fixes, and pull request check gating.

## Checks

- `gate: pass, exit 0, 1169s: bun run check` (from the final pinned verification run).
- `coachman-contract: pass, exit 0, 11s: scripts/run coachman-contract --self-test` (from the final pinned verification run).
- `bun test scripts/landing.test.ts scripts/lib/bun-version.test.ts scripts/test-check.test.ts scripts/probe-confine.test.ts scripts/lib/text.test.ts scripts/coachman-contract.test.ts`: exit 0, 174 passed.
- `scripts/run host-self-test`: exit 0, all controls behaved.
- `bun test scripts/landing.test.ts --test-name-pattern "pull-request checks"`: exit 0, 5 passed.
- `bun test scripts/bun-version.test.ts`: exit 0, 3 passed.
- `grep -n -i python README.md skills/postmaster/trackers.md`: exit 1, expected no matches.
- `git diff --check`: exit 0.
- Pinned `summary-evidence` check of the draft: exit 0, evidence shape holds for 12 criteria (1 not shown).

## Evidence

1. not shown: this lane has no Mac runner; the macOS job is configured and awaits pull request CI.
2. `.postmaster/verify/gate-final.txt`
3. `.postmaster/verify/changed-unit-tests.txt`
4. `.postmaster/verify/gate-final.txt`
   - `.postmaster/verify/changed-unit-tests.txt`
5. `.postmaster/verify/workflow-jobs.txt`
6. `.postmaster/verify/workflow-jobs.txt`
7. `.postmaster/verify/workflow-jobs.txt`
8. `.postmaster/verify/bun-version-tests.txt`
9. `.postmaster/verify/pull-request-check-tests.txt`
10. `.postmaster/verify/changed-unit-tests.txt`
    - `.postmaster/verify/gate-final.txt`
11. `.postmaster/verify/readme-support.txt`
12. `.postmaster/verify/c12-python-free.txt`
    - `.postmaster/verify/summary-evidence.txt` (summary validation)

## Decisions

- Kept expected missing-tool and system-specific skips in `scripts/test-skips.json` with a reason and supported systems.
- Listed the confinement no-row fallback skip for Linux and macOS; it skips when the host has no confinement row.
- Made the root-owned path test check actual filesystem ownership so it works in mapped Linux containers and on standard runners.
- Made the pull request check reader consume GitHub CLI JSON statuses for passed, pending, and failed states, then verify the PR head again after reading them.
- Used the real Bun 1.3.14 release in the old-Bun workflow job.

## What was not run

- The macOS and Bun 1.3.14 workflow jobs await pull request CI; this lane has no Mac and does not push.
- The coachman-contract fixture run belongs to branch verification after handoff.
- Real pull request checks cannot be queried until the branch is pushed and a pull request exists.

## Verdict

1. Not shown on a Mac in this lane; the macOS job is configured and awaits CI.
2. Met on Linux; the checker and inventory are included in the full check.
3. Met by skip inventory checker tests and the passing full gate.
4. Met by hidden-skip checker tests and the passing full gate.
5. Workflow is configured; pull request execution is pending.
6. The Bash 3.2 assertion is configured; Mac execution is pending.
7. The Bun 1.3.14 guard job is configured; pull request execution is pending.
8. Met by Bun version tests, including refusal before the target script loads.
9. Met by pull request check status tests; real PR checks await a pull request run.
10. Stage F is updated to return failed checks to the current leg with the job name and link; the local gate passes.
11. Met.
12. Met.
