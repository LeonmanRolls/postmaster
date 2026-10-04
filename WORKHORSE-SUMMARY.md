# Workhorse summary

## Built

- `756d0a0 Add shipped run aftercare command` adds aftercare, its tests, and the Stage G integration.
- `58501da Format aftercare command and tests` formats the implementation.
- `5f2f011 Use explicit text classes in aftercare` removes unsupported regular-expression shorthand.

The command saves and removes a shipped run's recorded work folders, reports work not held by a branch, closes associated windows and a registered preview, records each action, completes closing steps in order, and releases the pinned tool when no run still uses it. The runbooks name the oracle scratch folder, and the command is listed in the coachman contract and controls.

## Checks

- `gate` — `bun run check` — exit 1 (2,725 passed, 1 failed). The probe-confine test expects `/bin/sh` to have a root-owned path chain; this environment's chain is owned by `nobody:nogroup`. Details are in `.postmaster/verify/logs/gate.log` and `.postmaster/verify/final-verify.txt`.
- `coachman-contract` — `scripts/coachman-contract.sh --self-test` — exit 0.
- Final `<tool>/scripts/verify.sh run .` — exit 2 because the gate failed; the contract check passed. See `.postmaster/verify/final-verify.txt`.
- `bun test scripts/aftercare.test.ts` — exit 0, 15 tests passed.
- `bun test scripts/lib/confine.test.ts` — exit 0, 9 tests passed.
- `scripts/skill-refs.sh` — exit 0.
- `bash scripts/coachman-contract.sh "$PWD" 40d50ce 5f2f011` — exit 1 as expected; the detector names the four contract files changed by this branch.
- `bun install --frozen-lockfile` — exit 0.
- `bunx biome format --write` — exit 0.
- `bunx oxlint scripts/aftercare.ts` — exit 0.
- `git diff --check` — exit 0.

## Evidence

1. `.postmaster/verify/aftercare-C1-C14-C17.txt`, `.postmaster/verify/aftercare-C1-in-progress.txt`, `.postmaster/verify/aftercare-C1-cancelled.txt`
2. `.postmaster/verify/aftercare-C2-shipping.txt`, `.postmaster/verify/aftercare-C2-no-exit.txt`, `.postmaster/verify/aftercare-C2-style-unsorted.txt`
3. `.postmaster/verify/aftercare-C3-C15.txt`, `.postmaster/verify/aftercare-C3-missing-words.txt`
4. `.postmaster/verify/aftercare-C4-C5.txt`, `.postmaster/verify/aftercare-C4-plain-folder.txt`
5. `.postmaster/verify/aftercare-C4-C5.txt`, `.postmaster/verify/aftercare-C5-detached-commit.txt`
6. `.postmaster/verify/aftercare-C6-novel.txt`, `.postmaster/verify/aftercare-C6-held.txt`, `.postmaster/verify/aftercare-C6-base.txt`, `.postmaster/verify/aftercare-C6-deleted.txt`, `.postmaster/verify/aftercare-C6-moved.txt`
7. `.postmaster/verify/aftercare-C7-C14-resume.txt`
8. `.postmaster/verify/aftercare-C8-preview.txt`, `.postmaster/verify/aftercare-C8-no-preview.txt`, `.postmaster/verify/aftercare-C8-unregistered-preview.txt`
9. `.postmaster/verify/aftercare-C1-C14-C17.txt`, `.postmaster/verify/aftercare-C14-rerun.txt`
10. `.postmaster/verify/aftercare-C13-ledger.txt`, `.postmaster/verify/aftercare-C7-C14-resume.txt`
11. `.postmaster/verify/aftercare-C1-C14-C17.txt`, `.postmaster/verify/aftercare-C11-pin-in-use.txt`
12. `.postmaster/verify/aftercare-C2-shipping.txt`, `.postmaster/verify/aftercare-C4-plain-folder.txt`, `.postmaster/verify/aftercare-C7-C14-resume.txt`, `.postmaster/verify/aftercare-C12-contract.txt`, `.postmaster/verify/aftercare-C12-abandoned.txt`, `.postmaster/verify/aftercare-C12-silent-close-run.txt`, `.postmaster/verify/aftercare-C12-unreadable-ticket.txt`
13. `.postmaster/verify/aftercare-C13-ledger.txt`
14. `.postmaster/verify/aftercare-C14-rerun.txt`, `.postmaster/verify/aftercare-C7-C14-resume.txt`
15. `.postmaster/verify/aftercare-C3-C15.txt`, `.postmaster/verify/aftercare-C6-novel.txt`, `.postmaster/verify/aftercare-C7-C14-resume.txt`
16. `.postmaster/verify/aftercare-C16.txt`, `.postmaster/verify/coachman-contract-diff.txt`
17. `.postmaster/verify/aftercare-C1-C14-C17.txt`
   - `.postmaster/verify/final-verify.txt` records the final project verifier result.
   - `.postmaster/verify/summary-evidence-final.txt` records validation of this evidence list.

## Decisions

- Followed the approved decisions D1–D14 in the spec.
- For C17, used the realistic end-to-end run record required by the lane instructions because this lane cannot dispatch a fixture run. No other within-brief question required an independent decision.

## Not done

- The full project gate did not pass because the environment's `/bin` ownership chain fails the existing root-owned-chain probe. I left unrelated code and machine ownership unchanged.
- I did not dispatch a fixture or run `fixture.sh score`; the lane instructions require the realistic run record as the C17 demonstration instead.

## Verdict

1. Met
2. Met
3. Met
4. Met
5. Met
6. Met
7. Met
8. Met
9. Met
10. Met
11. Met
12. Met
13. Met
14. Met
15. Met
16. Met
17. Met — demonstrated on the realistic run record specified for this lane.
