# Workhorse summary

## Commits

- `692a5d4d60ec8b786bc7854237d72c864c5be344` — `#227, Fix teardown record discovery and refusals`

## What changed

- Teardown now discovers reviewers only from exact review-round record names. Findings lists and other files in `logs/` no longer contribute reviewers or stop teardown.
- A round record with a parsed non-mapping value and a parsed non-mapping action-log line now produce a one-line refusal naming the full record path. Action-log refusals include the 1-based line number.
- Added five host controls for ticket checks C1–C5 and corrected the host test section total to 326. Documented the record-naming refusal in `skills/postmaster/hosts.md`.

## Checks

Final pinned verifier output:

- `gate`: `bun run check` — exit 1; 2,710 passed and 1 failed. The failure is `scripts/probe-confine.test.ts`, “a bwrap is vetted only on a root-owned chain”: inside this lane's user namespace `/`, `/bin` and `/bin/sh` appear owned by nobody. The coachman reported running `bun test scripts/probe-confine.test.ts` unconfined in this same worktree: 16 passed, 0 failed, with those paths root-owned. Per the user's ruling, this is an execution-environment artifact; the test and its ownership rules were left unchanged, and the full gate was not rerun.
- `coachman-contract`: `scripts/coachman-contract.sh --self-test` — exit 0; 34 passed.
- Final verifier command: `PATH="$PWD/node_modules/.bin:$PATH" /home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .` — exit 2 (gate exit 1; coachman-contract exit 0).

Other commands and results:

- `bun test scripts/host.test.ts` — exit 0; 34 passed, 0 failed.
- In a scratch copy with the pre-change `scripts/host.ts` from `3441b479e8c7c8b6a860a86fedf00da34d587b9a`, `bun test scripts/host.test.ts` — exit 1; 32 passed and the wrapper reported 2 failures. C1–C4 failed, C5 passed, and no existing control failed.
- `PATH="$PWD/node_modules/.bin:$PATH" tsc --noEmit && bunx oxlint && bunx biome format scripts types lint package.json tsconfig.json biome.json .oxlintrc.json` — exit 0; Oxlint reported existing warnings.
- Pre-change `scripts/host.sh stop-run <R>` and `scripts/host.sh close-run <R>` reproduction — each exit 2 with no output.
- Initial `bun run check` before dependencies were installed — exit 127 (`tsc` not found). The next check attempt exited 1 because Biome requested formatting; the files were formatted before the final test and verifier runs.
- `bun install --frozen-lockfile` — exit 0.
- Draft `summary-evidence.ts` validation — exit 0.

The final verifier transcript and test log are `.postmaster/verify/227-verify-final.txt` and `.postmaster/verify/logs/gate.log`.

## Evidence

1. `.postmaster/verify/227-host-tests.txt`
   - `.postmaster/verify/227-repro.txt`
2. `.postmaster/verify/227-host-tests.txt`
3. `.postmaster/verify/227-host-tests.txt`
4. `.postmaster/verify/227-host-tests.txt`
5. `.postmaster/verify/227-host-tests.txt`
6. `.postmaster/verify/227-host-tests.txt`
   - `.postmaster/verify/227-base-host-tests.txt`
   - `.postmaster/verify/227-summary-evidence.txt`

## Decisions

- Followed D1 by matching only `REVIEW_ROUND_FILE` names (`review-r` followed by one or more digits and `.json`).
- For D2 and D3, used `run review record is not a mapping: <full path>` and `run action log line is not a mapping: <full path> line <number>`. The line number counts every split line, including blank and unreadable lines.
- Followed D4 by stopping at the first refusal and naming only that record.
- Followed D5 by leaving the two unrelated space-closing failures out of scope.
- Followed D6 by testing preserved skips and existing refusal messages as well as the new refusals.
- Used lowercase `detail` in review-launch action fixtures, as the coachman's note specifies.
- Counted the host self-test suite as 326 controls after adding five controls to its prior 321.
- Applied the user's ruling that the final gate failure is confined-namespace ownership behavior. I did not rerun the full gate.

## Not done

- No fixture run was needed because the coachman's steps did not change.
- The new tests use stub `herdr` and `tmux`; no live Herdr or tmux was contacted.
- No push was made, as instructed.

## Verdict

1. Met. Both teardown commands select exactly the existing worktrees named by round and action-log records, independent of other files in `logs/`.
2. Met. A parsed non-mapping round record stops teardown and names its full path.
3. Met. Unreadable records and unusable reviewer entries remain skipped without a refusal.
4. Met. A parsed non-mapping action-log line stops teardown and names its full path and 1-based line; skipped lines remain skipped.
5. Met. Existing record refusals retain their exact messages.
6. Met. Controls cover criteria 1–5, pass on the implementation, and the changed C1–C4 controls fail against the pre-change implementation while all pre-existing controls continue to pass.
