# Workhorse summary

## Built

- `5ff52cc93202641c89167232e6c4000304de9c8b` — #265, Report fixture run timings.
- `1c9fdd14254b1f2d7cbdff378f0c473a9168e52e` — #265, Parse score timing output safely.

## Checks

- `/home/brindlewick/.postmaster/tool-pins/5037e7143f214713baf83ecf090a0bba08b34ff7/scripts/run verify run .` — exit 2; output is in `.postmaster/verify/run-verify.txt`.
- Gate, `bun run check` — exit 1 after 1,272 seconds; 2,784 passed and one test failed. `scripts/probe-confine.test.ts` expects a root-owned executable chain, but this environment has `/bin` and `/bin/sh` owned by `nobody:nogroup`.
- Coachman contract, `scripts/run coachman-contract --self-test` — exit 0.
- `bun test scripts/fixture.test.ts` — exit 0, 105 passed; acceptance output is in `.postmaster/verify/fixture-timing-checks.txt`.
- `bun test scripts/lib/text.test.ts` — exit 0, 9 passed.
- `bunx --package typescript@7.0.2 tsc --noEmit` — exit 0; the final gate's TypeScript step also passed.
- `bunx biome format --write scripts/fixture.ts` — exit 0.
- `bun install --frozen-lockfile` — exit 0.
- `git diff --check` — exit 0.
- `stat -c '%n %U:%G %a' /bin /bin/sh /usr/bin/dash` — exit 0; confirms the ownership behind the confinement test failure.
- `/home/brindlewick/.postmaster/tool-pins/5037e7143f214713baf83ecf090a0bba08b34ff7/scripts/run summary-evidence .postmaster/verify/WORKHORSE-SUMMARY-draft.md .` — exit 0.
- `/home/brindlewick/.postmaster/tool-pins/5037e7143f214713baf83ecf090a0bba08b34ff7/scripts/run summary-evidence WORKHORSE-SUMMARY.md .` — exit 0; output is in `.postmaster/verify/summary-evidence.txt`.

## Evidence

1. `.postmaster/verify/fixture-timing-checks.txt`
   - `.postmaster/verify/summary-evidence.txt`
2. `.postmaster/verify/fixture-timing-checks.txt`
3. `.postmaster/verify/fixture-timing-checks.txt`
4. `.postmaster/verify/fixture-timing-checks.txt`
5. `.postmaster/verify/fixture-timing-checks.txt`
6. not shown: `fixture new` requires a standalone repository outside this worktree, and the run's instructions prohibit edits outside the worktree, so no branch-tool fixture run was dispatched.

## Within-brief decisions

- Report only waits strictly longer than 10 minutes and totals strictly longer than one hour.
- Sort workhorse and reviewer timings slowest first; put `mimo` first on a tie. Name missing completion markers without inferring a duration.
- If `run-times` has no stage data, say the run could not be timed and preserve the existing score verdict.

## Not done

- C6's branch-tool fixture run was not run because it requires creating a standalone repository outside the permitted worktree.
- The ticket's historical floor, short and long-wait run copies were not present in `.postmaster/verify`. The acceptance transcript uses whole-repository fixture copies with controlled timestamps and preserved file times to exercise those cases.

## Verdict

1. Met on the controlled fixture copies: score prints the `run-times` stage table, each stage's wait and the total, and reports when stage data is absent.
2. Met on the controlled fixture copies: score prints workhorse and per-round reviewer times, slowest first, and names missing markers.
3. Met on the controlled fixture copies: waits above 10 minutes are named.
4. Met on the controlled fixture copies: totals above one hour are named.
5. Met on the controlled fixture copies: timing alerts do not alter score checks or exit status.
6. Not met: no fixture run was dispatched with this branch as the tool.
