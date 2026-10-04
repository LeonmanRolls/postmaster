# WORKHORSE-BLOCKED

## Blocking check

The frozen gate `bun run check`, launched by `$TOOL/scripts/run verify run .`, failed. The verifier reported gate exit 1 after 1,559 seconds; `scripts/run coachman-contract --self-test` passed. The gate found a mode-parser guard issue, which is fixed in commit `56c9d9f` and passes `bun test scripts/lib/text.test.ts` (9 passed) and `bun test scripts/run-meta.test.ts` (116 passed).

The remaining failure is `scripts/probe-confine.test.ts`: `isSecureBwrapPath("/bin/sh")` returned false where the existing test expects true. Re-running that test directly still fails (15 passed, 1 failed). The process UID is 1001, while `/`, `/usr`, and `/usr/bin` are owned by UID 65534 in this environment, so the test's root-owned-path premise does not hold. Evidence: `.postmaster/verify/probe-confine-targeted.txt` and `.postmaster/verify/filesystem-owner.txt`.

## Required change

Run the frozen gate in an environment where the system path has the root-owned chain the confinement test requires, or provide an approved root-owned test fixture. I did not alter system ownership or weaken the confinement check.

## Branch state

Branch `wb/270-luna`, based on `393f263a61c7291f2720d1fa76ad6a2b982adda1`. Implementation commits: `ee357ee`, `dd03253`, `16e7b83`, and `56c9d9f`. The parser correction and its targeted checks are complete. The full gate was not rerun after that correction because the remaining gate failure was independently reproduced as an environment ownership blocker. The pinned verifier transcript is `.postmaster/verify/final-verify.txt`.
