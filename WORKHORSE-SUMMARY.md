# Workhorse summary

## Commits

- `f4b338a` Detect switch-offs before landing
- `edc346e` Require user approval before landing
- `8d7a77a` Record fixture check blocker

## Built

- Detect newly added TypeScript, ESLint/Oxlint and Biome switch-off comments with a scanner that excludes strings, template text, regex literals and non-code files.
- Compare comments and supported check settings against the merge base, report reasons and settings diffs, and distinguish missing reasons from effective switch-offs.
- Show the final switch-off list on the ship card; require and record the user's approval or refusal in the run actions and project ledger before landing.
- Update Stage F and the coachman's card-writing instructions while preserving the checked card block for runs pinned before this change.

## Checks

The final `/home/brindlewick/.postmaster/tool-pins/af47492a8c1932f622a1e2e6baedf3813ff3dd30/scripts/run verify run .` output was:

```text
gate: fail, exit 1, 1141s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/268-luna/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 10s: scripts/run coachman-contract --self-test

exit: 2
```

- `gate` — `bun run check` — exit 1 (1141s; 2751 pass, 1 fail). The failure is `scripts/probe-confine.test.ts`, `a bwrap is vetted only on a root-owned chain`; the coachman reported a separate full `bun test scripts/ lint/` run on this exact tree at 2752 pass, 0 fail and ruled the gate failure transient. Log: `.postmaster/verify/logs/gate.log`.
- `coachman-contract` — `scripts/run coachman-contract --self-test` — exit 0 (10s).
- Overall final `verify run .` — exit 2. Transcript: `.postmaster/verify/final-verify-run.txt`.
- `bun test scripts/lib/switch-offs.test.ts` — exit 0, 12 pass.
- `bun test scripts/landing.test.ts` — exit 0, 119 pass.
- `bun test scripts/log-action.test.ts` — exit 0, 64 pass.
- `bash .postmaster/verify/c10-history.sh` — exit 0, 92 merges: 85 clear, 7 withheld, 0 unexpected.
- Draft `summary-evidence` check — exit 0. Transcript: `.postmaster/verify/summary-evidence-draft-check.txt`.
- C11 fixture boundary attempt — exit 1; no fixture repository created. Transcript: `.postmaster/verify/c11-fixture-boundary.txt`.
- Final `summary-evidence WORKHORSE-SUMMARY.md .` — exit 0. Transcript: `.postmaster/verify/summary-evidence.txt`.

## Evidence

1. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
   - `.postmaster/verify/summary-evidence.txt`
2. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
3. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
4. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
5. `.postmaster/verify/c5-landing-backward-compat.txt`
   - `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
6. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
7. `.postmaster/verify/c7-log-action.txt`
   - `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
8. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
9. `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
10. `.postmaster/verify/c10-history.txt`
    - `.postmaster/verify/c1-c4-c7-c9-switch-offs.txt`
11. not shown: fixture dispatch and scoring run at synthesis by the coachman; a workhorse lane cannot dispatch runs

## Decisions

- Count `reason-required` as withheld in C10's seven non-clear historical merges; retain its distinct status in the transcript.
- Keep test scratch inside the worktree and set `GIT_CEILING_DIRECTORIES` under `.postmaster/verify` so tests can use isolated repositories without writing elsewhere. Adjust the two test fixtures that had hardcoded external temporary paths.
- Use the worktree's `scripts/run` for the C10 sweep because the pinned runner predates the new `landing switch-offs` mode.
- Follow the coachman's ruling that fixture dispatch and scoring run at synthesis; do not create a fixture repository from this lane.

## Not done

- C11 fixture dispatch and scoring are left to the coachman at synthesis because a workhorse lane cannot dispatch runs. The existing boundary transcript is `.postmaster/verify/c11-fixture-boundary.txt`.

## Verdicts

1. Met.
2. Met.
3. Met.
4. Met.
5. Met.
6. Met by the Stage F instructions and checks for both landing routes.
7. Met.
8. Met.
9. Met.
10. Met: the historical sweep reports 85 clear and seven withheld.
11. not shown: fixture dispatch and scoring run at synthesis by the coachman; a workhorse lane cannot dispatch runs
