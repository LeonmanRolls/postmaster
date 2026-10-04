# Workhorse summary

## Built and commits

- `01be03a` Make process checks portable across macOS and Linux
- `4f9c4d0` Make fixture scoring portable across macOS and Linux
- `289e7fb` Quote coachman shell argument lists
- `12feca0` Type Bun APIs used by portability checks
- `ffcc2ea` Align portability checks with existing script tests
- `b699180` Keep portability parsing within the ASCII guard
- `d6774ae` Match review sample test to array normalization

## Checks

- Pinned verifier, `scripts/verify.sh run .`: `gate: fail, exit 1, 1029s: bun run check`; `coachman-contract: pass, exit 0, 7s: scripts/coachman-contract.sh --self-test`; overall exit 2. The gate ran 2,723 tests across 57 files: 2,722 passed and one failed. The only failure is the existing bwrap root-owned-chain probe in `scripts/probe-confine.test.ts`. This container reports `/`, `/bin` and `/bin/sh` as owned by `65534:65534`. The failure is recorded in `.postmaster/verify/verify-final.txt` and `.postmaster/verify/logs/gate.log`.
- `bun install --frozen-lockfile`: exit 0 (`.postmaster/verify/dependencies.txt`).
- `POSTMASTER_PROC_ROOT=<missing path> bun test scripts/lib/process-state.test.ts`: 4 passed, exit 0 (`.postmaster/verify/process-state.txt`).
- Forced `scripts/host.test.ts`: 35 passed, exit 0 (`.postmaster/verify/host-forced-final.txt`).
- Forced `scripts/view-stream.test.ts`: exit 0 (`.postmaster/verify/view-stream-forced.txt`).
- Forced `scripts/runs-status.test.ts`: exit 0 (`.postmaster/verify/runs-status-forced.txt`).
- `bun test scripts/synthesis-shares.test.ts`: 11 passed, exit 0 (`.postmaster/verify/synthesis-shares.txt`).
- Fixture scoring checks for no jq, platform header, failed score and privacy: 4 passed, exit 0 (`.postmaster/verify/fixture-score.txt`).
- Coachman shell-block checks: 2 passed, exit 0. Zsh was unavailable, so the specified shell comparison was skipped (`.postmaster/verify/coachman-shell.txt`).
- Real tmux no-Bun pane check: exit 0 (`.postmaster/verify/tmux-c15.txt`). Registry stop and close probes: each exit 0 (`.postmaster/verify/c6-registry.txt`, `.postmaster/verify/c7-registry.txt`).
- Runbook reference check and review sample test: exit 0 (`.postmaster/verify/skill-refs.txt`, `.postmaster/verify/review-findings-runbook.txt`).
- Reverted-fix controls failed as expected: C6 exit 1, C7 exit 1, C8 exit 1, C10 exit 1, C11 exit 1, C12 exit 1, C13 exit 1, C15 exit 2; see the corresponding `c*-reverted.txt` transcripts.
- `scripts/fixture.sh new "$PWD/.postmaster/verify/linux-fixture" remove`: exit 1. The fixture tool refuses a destination inside this Git repository because a fixture repo must stand alone. The attempt created no files (`.postmaster/verify/c16-new-attempt.txt`).
- Draft summary evidence validation: exit 0, 17 criteria with one marked not shown (`.postmaster/verify/summary-evidence-draft.txt`).
- Final summary evidence validation: exit 0 (`.postmaster/verify/summary-evidence-final.txt`).

## Evidence

1. `.postmaster/verify/process-state.txt`
   - Summary evidence validation: `.postmaster/verify/summary-evidence-final.txt`
2. `.postmaster/verify/host-forced-final.txt`
3. `.postmaster/verify/host-forced-final.txt`
4. `.postmaster/verify/host-forced-final.txt`
5. `.postmaster/verify/view-stream-forced.txt`
6. `.postmaster/verify/c6-registry.txt` and `.postmaster/verify/c6-reverted.txt`
7. `.postmaster/verify/c7-registry.txt` and `.postmaster/verify/c7-reverted.txt`
8. `.postmaster/verify/host-forced-final.txt` and `.postmaster/verify/c8-locale-reverted.txt`
9. `.postmaster/verify/runs-status-forced.txt`
10. `.postmaster/verify/synthesis-shares.txt` and `.postmaster/verify/c10-reverted.txt`
11. `.postmaster/verify/fixture-score.txt` and `.postmaster/verify/c11-reverted.txt`
12. `.postmaster/verify/fixture-score.txt`, `.postmaster/verify/c12-platform.txt` and `.postmaster/verify/c12-reverted.txt`
13. `.postmaster/verify/fixture-score.txt`, `.postmaster/verify/c13-platform.txt` and `.postmaster/verify/c13-reverted.txt`
14. `.postmaster/verify/coachman-shell.txt`
15. `.postmaster/verify/host-forced-final.txt`, `.postmaster/verify/tmux-c15.txt` and `.postmaster/verify/c15-reverted.txt`
16. `.postmaster/verify/fixture-score.txt` and `.postmaster/verify/c16-new-attempt.txt`
17. not shown: a post-merge Mac score is required before its unedited output can be posted on the ticket.

## Decisions

- No additional scope decisions; followed the accepted decisions D1–D12.
- Zsh is not installed, so the test used the specified skip behavior. Zsh execution is not shown here.
- Did not place a standalone fixture repo outside this worktree. The fixture tool refuses a destination under this Git repository, and this lane must not write outside its worktree.
- Left the existing bwrap ownership probe unchanged because the container does not meet its root-owned filesystem precondition.

## Not done

- A live fixture dispatch from this branch could not be created within the worktree. The fixture scoring test shows a clean Linux score and platform line, but it uses a recorded test run rather than a live dispatch.
- The post-merge Mac fixture run and its unedited score comment are not shown.
- The actual zsh comparison is not shown because zsh is unavailable.
- The full gate remains red on the container's root-owned-chain precondition; the check was not weakened.

## Verdict

1. Met: forced process checks distinguish live, zombie and absent processes and retain start times.
2. Met: the live zombie watcher and background-runner controls pass.
3. Met: the forced-path test accepts a live launch and rejects a runner that exits before reading its spec.
4. Met: Herdr and tmux tests keep active panes or windows open and close them after completion.
5. Met: forced stream following continues until the writer ends.
6. Met: the registry stop probe finds and stops the recorded live launch; the reverted parser control fails.
7. Met: close refuses while the registry launch lives and succeeds after stop; the reverted parser control fails.
8. Met: forced host leg-attempt controls pass; reverting locale normalization fails.
9. Met: forced run-status tests retain WAIT for a live step.
10. Met: generated attributes are excluded using the Git-compatible temporary-index path.
11. Met: fixture score tests pass without jq and fail without npm.
12. Met: Linux score output starts with the system and tool version line; the reverted control fails.
13. Met: the privacy probe finds none of the supplied home, user, login or host values; the reverted control fails.
14. Not shown on zsh: bash tests pass and the required skip is reported because zsh is unavailable.
15. Met: the Herdr no-Bun stub and real tmux no-Bun pane checks pass; the reverted control fails.
16. Not met yet: Linux score formatting passes the recorded-run fixture test, but a live branch fixture run and the required post-merge Mac score are not shown.
17. Not shown: no post-merge Mac score exists to post as a ticket comment.

Overall: implementation checks for criteria 1–13 and 15 pass. Criteria 14, 16 and 17 remain unshown as stated above. The pinned gate also has the unrelated container ownership failure recorded under Checks.
