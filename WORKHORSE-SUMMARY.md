# Workhorse summary: #202 reach checks

## Changes

- `aede4c9 #202, Check lane reach at run boundaries` adds the reach reader, point checks, restore logic, runbook steps, and card section.
- `409ed7a #202, Preserve clean fixture scores` adds fixture scoring and C16/C17 controls.
- `2f89be8 #202, Preserve symlinks during reach restore` moves synthesis symlinks without following their targets.
- `b4c00b4 #202, Score harness records as contract changes` updates the contract self-test for the harness record.
- `8a9a764 #202, Use explicit character sets in reach parsing` formats changed files and makes shell and JSON character handling pass the source guard.

## Checks

The final pinned verifier printed:

```text
gate: fail, exit 1, 1025s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/202-luna/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 7s: scripts/coachman-contract.sh --self-test

exit=2
```

Transcript: `.postmaster/verify/final-verify.txt`. The gate log records 2,740 passing tests and one failure: `probe-confine.test.ts` expects `/bin/sh` to be on a root-owned path, but this environment reports the path and its parents as `nobody:nogroup`. I left that unrelated security check unchanged.

Other checks:

- `bun test scripts/reach.test.ts scripts/review-decide.test.ts`: exit 0, 62 passed (`.postmaster/verify/c1-c15.txt`).
- `bun test scripts/reach.test.ts`: exit 0, 27 passed (`.postmaster/verify/c1-c15-exact.txt`).
- `bun test scripts/fixture.test.ts`: exit 0, 91 passed (`.postmaster/verify/c16-c17.txt`).
- `bun test scripts/lib/text.test.ts`: exit 0, 9 passed (`.postmaster/verify/text-guard.txt`).
- `scripts/coachman-contract.sh --self-test`: exit 0, 34 passed (`.postmaster/verify/coachman-contract.txt`).
- `scripts/skill-refs.sh`: exit 0 (`.postmaster/verify/skill-refs.txt`).
- `scripts/wiki-lint.sh`: exit 0 (`.postmaster/verify/wiki-lint.txt`).
- `git diff --check`: exit 0 (`.postmaster/verify/diff-check.txt`).
- `bun install --frozen-lockfile`: exit 0 (`.postmaster/verify/install.txt`).
- Biome formatting commands: exit 0 (`.postmaster/verify/format.txt`, `.postmaster/verify/format-final.txt`).
- Draft summary evidence check: exit 0 (`.postmaster/verify/draft-summary-check.txt`).
- Earlier `bun run check` attempts exited 127 before dependencies were installed, then 1 for formatting, then 1 for the source guard and the environment path test. The formatter and source guard issues were fixed; the final verifier log has only the environment path failure (`.postmaster/verify/gate-missing-tools.txt`, `.postmaster/verify/gate-format.txt`, `.postmaster/verify/gate.txt`).

## Decisions

- Followed the approved decisions D1–D18.
- New synthesis symlinks are moved into the run's reach records as symlinks, preserving their paths without moving their targets.
- Unknown or unreadable lane streams remain `not checked`; they are never treated as clean.

## Not done

- No fixture run plants a reach, as D16 requires; the tests cover those cases.
- I did not change or override the unrelated root-owned-path check because this environment reports the path as owned by `nobody:nogroup`; weakening that check would hide the environment's actual ownership.
- I did not add reach prevention or cleanup, which is out of scope, and did not push the branch, as the lane instructions prohibit pushing.

## Evidence

1. `.postmaster/verify/c1-c15.txt`
2. `.postmaster/verify/c1-c15.txt`
3. `.postmaster/verify/c1-c15.txt`
4. `.postmaster/verify/c1-c15.txt`
5. `.postmaster/verify/c1-c15.txt`
6. `.postmaster/verify/c1-c15.txt`
7. `.postmaster/verify/c1-c15.txt`
8. `.postmaster/verify/c1-c15.txt`
9. `.postmaster/verify/c1-c15.txt`
10. `.postmaster/verify/c1-c15.txt`
11. `.postmaster/verify/c1-c15.txt`
12. `.postmaster/verify/c1-c15.txt`
13. `.postmaster/verify/c1-c15.txt`
14. `.postmaster/verify/c1-c15.txt`
15. `.postmaster/verify/c1-c15-exact.txt`
    - `.postmaster/verify/text-guard.txt`
    - `.postmaster/verify/summary-evidence.txt`
16. `.postmaster/verify/c16-c17.txt`
17. `.postmaster/verify/c16-c17.txt`

## Verdicts

1. Met — workhorse, round, and card checks run at their specified points.
2. Met — each point logs its result, including clean results.
3. Met — the main checkout check lists every changed and new path.
4. Met — the check reports a non-default branch and ignores the default branch moving forward.
5. Met — supported lane records are read and outside-folder paths are classified.
6. Met — each round compares this run's refs and synthesis worktree with its saved state.
7. Met — writes are findings; reads and refused attempts are notes.
8. Met — workhorse findings and unexplained main checkout changes are escalated before synthesis.
9. Met — a reach escalation waits for the user's ruling.
10. Met — a reviewer's finding voids that reviewer's verdict.
11. Met — round changes are saved and restored before fixes.
12. Met — a reviewer write outside this run's folders is escalated to the user.
13. Met — other findings appear on the card without stopping the run.
14. Met — the reach card section is assembled from logged checks and includes skipped points.
15. Met — the reach tests cover positive and negative controls for the specified cases.
16. Met — the fixture suite scores a clean reach run successfully.
17. Met — fixture scoring rejects a finding, a skipped point, or a supported lane marked `not checked`.
