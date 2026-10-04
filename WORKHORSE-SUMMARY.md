# WORKHORSE-SUMMARY

## Built

- `8948294 Record provider usage walls`
- `8e42d61 Poll review walls during the round`
- `719497b Record fixture and gate blockers` (the temporary blocker report was resolved and removed by `19d715b Remove resolved blocker report`)

The branch records supported terminal provider limit errors before host markers land, keeps their exact message and parsed reset, notifies and pauses runs until go-on rulings, and carries approved walls as degraded work. Reviewer walls close a round as degraded and are tried again in the next round. Status, watcher dispatch, coachman harvest, runbooks, and the coachman contract now account for walls.

## Checks

The final pinned command was `/home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .`. It printed `gate: fail, exit 1, 1051s: bun run check` and `coachman-contract: pass, exit 0, 8s: scripts/coachman-contract.sh --self-test`, then exited 2. The command transcript is `.postmaster/verify/verify-final.txt`; the full gate log is `.postmaster/verify/logs/gate.log`.

- `gate` — `bun run check`, exit 1: 2,733 tests passed and 1 failed. The only failure is `scripts/probe-confine.test.ts:226`, whose `/bin/sh` ownership assertion is an artifact of this confined lane's user namespace. Per the ruling, I left confinement code and tests untouched; the coachman should verify this case unconfined at harvest.
- `coachman-contract` — `scripts/coachman-contract.sh --self-test`, exit 0: 34 passed, 0 failed.
- `bun test scripts/launch.test.ts -t "provider wall records|launch records provider walls"` — exit 0 (`.postmaster/verify/C01-C04-launch.txt`).
- `bun test scripts/runs-watch.test.ts` — exit 0 (`.postmaster/verify/C05-C07-C14-C20-watch.txt`).
- `bun test scripts/walls.test.ts` — exit 0 (`.postmaster/verify/C06-C09-C13-C16-walls.txt`).
- `bun test scripts/runs-status.test.ts` — exit 0 (`.postmaster/verify/C08-C10-status.txt`).
- `bun test scripts/review-round.test.ts` — exit 0 (`.postmaster/verify/C11-C12-C21-review.txt`).
- `scripts/skill-refs.sh` — exit 0 (`.postmaster/verify/skill-refs.txt`).
- Runbook wording check, `rg -n -i "unruly wall|provider wall|walled reviewer|fixture run has no user|WALL:|go-on|walls.sh open" skills/postmaster/coachman.md skills/postmaster/postmaster.md skills/postmaster/harnesses.md` — exit 0 (`.postmaster/verify/C13-C18-runbooks.txt`).
- `scripts/fixture.sh new .postmaster/verify/fixture-237-luna remove` — exit 1; the fixture runner refused a destination inside this worktree. The fixture run is dispatched and scored at landing per the ruling (`.postmaster/verify/C22-fixture-boundary.txt`).
- The first pinned verification attempt — exit 1 before checks ran because the blocker-file deletion was uncommitted (`.postmaster/verify/verify-before-clean-tree.txt`).
- Draft summary evidence check — exit 0 (`.postmaster/verify/summary-draft-check.txt`).
- Final summary evidence check, `bun --no-env-file --config=/dev/null /home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .` — exit 0; evidence shape holds for 22 criteria, 1 not shown (`.postmaster/verify/summary-evidence.txt`).

## Evidence

C22's worktree boundary is recorded in `.postmaster/verify/C22-fixture-boundary.txt`. The final evidence-shape check is recorded in `.postmaster/verify/summary-evidence.txt`.

1. `.postmaster/verify/C01-C04-launch.txt`
2. `.postmaster/verify/C01-C04-launch.txt`
3. `.postmaster/verify/C01-C04-launch.txt`
4. `.postmaster/verify/C01-C04-launch.txt`
5. `.postmaster/verify/C05-C07-C14-C20-watch.txt`
6. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
7. `.postmaster/verify/C05-C07-C14-C20-watch.txt`
8. `.postmaster/verify/C08-C10-status.txt`
9. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
10. `.postmaster/verify/C08-C10-status.txt`
11. `.postmaster/verify/C11-C12-C21-review.txt`
12. `.postmaster/verify/C11-C12-C21-review.txt`
13. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
    - `.postmaster/verify/C13-C18-runbooks.txt`
14. `.postmaster/verify/C05-C07-C14-C20-watch.txt`
    - `.postmaster/verify/C13-C18-runbooks.txt`
15. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
    - `.postmaster/verify/C13-C18-runbooks.txt`
16. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
    - `.postmaster/verify/C13-C18-runbooks.txt`
17. `.postmaster/verify/C13-C18-runbooks.txt`
18. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
    - `.postmaster/verify/C13-C18-runbooks.txt`
19. `.postmaster/verify/C06-C09-C13-C16-walls.txt`
20. `.postmaster/verify/C05-C07-C14-C20-watch.txt`
21. `.postmaster/verify/C11-C12-C21-review.txt`
22. not shown: the fixture run is dispatched and scored at landing, outside any lane's worktree

## Decisions

- D1: a workhorse wall pauses harvest until ruled.
- D2: recognize walls from the provider's final error record only.
- D3: use the shared wall-token list, even when the error describes another limit-related failure.
- D4: resolve a time-only reset to its first occurrence no earlier than five minutes before the stop.
- D5: parse only the provider reset shapes named in the spec; unknown shapes have no reset time.
- D6: implement go-on only; rest, reset-now, and substitute remain separate work.
- D7: fixture postmasters record told and go-on themselves.
- D8: block every subsequent leg and landing while a wall lacks a ruling.
- Reset parsing takes the later of two recognized reset times, accepts UTC or an IANA zone, and treats abbreviations such as PST as unreadable. A reviewer wall is keyed by lane and lens for its round; repeated walls are separate records. A go-on is carried once, and the latest ruling before carry takes effect.

## What I did not do and why

- I did not dispatch or score C22 in this lane. The fixture requires a standalone repository outside the lane worktree; the user ruled this belongs at landing. The boundary transcript is `.postmaster/verify/C22-fixture-boundary.txt`.
- I did not change confinement code or tests. The `/bin/sh` ownership failure is specific to the confined lane context; the coachman is to verify it unconfined at harvest.
- I did not push the branch.

## Verdicts

1. Met — focused launch tests cover supported walls and exclusions.
2. Met — wall records retain the exact message and reset details.
3. Met — non-wall, stopped, and delivered-result endings are excluded.
4. Met — unsupported harnesses remain on the existing path.
5. Met — watcher tests cover grouped, once-only notice of new walls.
6. Met — wall display tests cover role, message, and local reset date.
7. Met — held-run notification is covered.
8. Met — untold walls take status priority, except a newer user question.
9. Met — existing questions remain beside wall questions.
10. Met — a wall pause is not reported as stalled.
11. Met — a wall closes the review round as degraded.
12. Met — a walled reviewer is launched in a later round and can wall again.
13. Met — harvest waits for other workhorse markers and escalates before synthesis.
14. Met — open walls block later dispatch and landing.
15. Met — the postmaster runbook maps clear go-on words to a ruling, including rulings before pause.
16. Met — carry records go-on walls as degraded with their provider message.
17. Met — unclear words produce a renewed question without a ruling.
18. Met — refused rulings record nothing and leave the run paused.
19. Met — go-on is refused when it would remove the last workhorse that could produce work.
20. Met — pre-pause rulings carry at harvest; pause rulings resume on the watcher's next look.
21. Met — a repeated reviewer wall has a new record and needs a new ruling.
22. Not shown — the fixture run is dispatched and scored at landing per the user's ruling.
