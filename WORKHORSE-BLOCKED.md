# Workhorse blocked

## Blocking check

[#268, A run cannot add a comment that switches off a check without the user's word](https://github.com/brindlewick/postmaster/issues/268) requires C11: create a fixture repository from this branch, dispatch it, and score the run. The pinned `fixture new` command refuses a destination inside this Git repository because a fixture repo must stand alone. Its refusal is recorded in `.postmaster/verify/c11-fixture-boundary.txt`.

The lane instruction permits edits only inside this worktree. A successful C11 fixture would require writing a separate repository outside it, so the check cannot be completed under the current boundary.

## Proposed resolution

Authorize a standalone fixture destination outside this worktree, or run C11 in a separately authorized isolated repository. Then run `fixture new`, dispatch the fixture, and run `fixture score` without changing the approved check.

## Branch state

- Branch: `wb/268-luna`.
- Implementation commits: `f4b338a` Detect switch-offs before landing; `edc346e` Require user approval before landing.
- Final verifier: the coachman contract check passed; the gate reported 2,751 passing tests and one failure in the root-owned-chain check in `probe-confine.test.ts`. The verifier exited 2 because the gate exited 1. Details are in `.postmaster/verify/final-verify-run.txt` and `.postmaster/verify/logs/gate.log`.
- No fixture repository was created outside the worktree, and C11 remains unmet.
