# WORKHORSE-BLOCKED

## Check C22: provider-wall fixture run

The fixture must be a standalone repository. scripts/fixture.sh new refuses a destination
inside this worktree's git repository, as recorded in
.postmaster/verify/C22-fixture-boundary.txt. The lane instructions prohibit creating files
outside this worktree, so the required fixture dispatch and score could not be run here. C22
remains unshown.

Proposed next step: have the coachman run C22 from this branch in its permitted standalone
fixture location, with the workhorse and reviewer wall stubs and the fixture postmaster's
go-on rulings described by the check.

## Gate: bun run check

The final run is recorded in .postmaster/verify/bun-run-check-final.txt: 2,733 tests passed
and 1 failed. The remaining failure is scripts/probe-confine.test.ts:226, which expects
/bin/sh to pass the root-owned-path check. This environment does not satisfy that test's
ownership precondition. The failure is outside this ticket.

Proposed next step: run the gate in an environment where the test's /bin/sh ownership
precondition holds. No unrelated confinement test or implementation change is proposed here.

## Branch state

- 8948294 Record provider usage walls
- 8e42d61 Poll review walls during the round

The source changes are committed on wb/237-luna; nothing was pushed. The focused launch,
wall, status, watcher, reviewer, coachman-contract, and skill-reference checks passed. The
full gate and C22 fixture check remain as described above.
