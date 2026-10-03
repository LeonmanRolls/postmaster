# Workhorse spec: 227 Teardown closes a run's spaces when its logs hold review findings lists

## Summary

`host.sh close-run` and `host.sh stop-run` exit 2 with no message whenever a run's `logs/` holds a review findings list, because `runWorktreePaths` opens every `review-r<digit>*.json` file as a review state file. This run narrows the match to the state files the flow writes (`review-r<n>.json`), gives every refusal in `runWorktreePaths` a message, and adds the three checks as host controls.

## Technical context

- **Language and version**: TypeScript run in place by Bun (>= 1.4.2), behind thin `scripts/*.sh` wrappers.
- **Dependencies used or added**: none.
- **Testing**: `host.sh close-run <dispatch>` and `host.sh stop-run <dispatch>` against run records in temporary folders; new controls in `scripts/host-self-test.ts`, run by `scripts/host.test.ts`; the gate `bun run check` from the worktree root.
- **Constraints**: the ticket's direction (narrow the pattern, message the two silent refusals, nothing else in teardown changes); the project's rules (this repo is scripts plus runbooks, deterministic work lives in `scripts/`); the new control uses no GNU-only option and runs on Linux and on macOS 13 or newer.

## Direction check

- Narrow the pattern to the state files the flow writes, `review-r<n>.json`: `runWorktreePaths` opens only those as review state; findings lists, usage files, event streams and `--last` files are never opened as state.
- Give the two silent refusals a message: a non-mapping state file and a non-mapping `actions.jsonl` line each refuse with a message, and every other refusal in `runWorktreePaths` prints one too, so exit 2 is never silent.
- Nothing else in teardown changes: both commands keep their behavior apart from which files count as review state and the new messages; both are covered because both call `runWorktreePaths`.
- The three checks become host controls, each against a record in a temporary folder, positive and negative through the identical command.
- Portable control: shell and TypeScript only, no GNU-only option.

## Structure

- `scripts/host.ts`: the review-state match and the refusal messages in `runWorktreePaths`.
- `scripts/host-self-test.ts`: the new controls in `runControls`, beside the other run-wide teardown controls.
- `scripts/host.test.ts`: the section row and header total kept true.
- No new files.

## Decisions

- A review state file is exactly `review-r<n>.json` with `<n>` one or more digits: the file the flow writes per review round (`review-r<round>.json`). `review-r1-bug-mimo-findings.json`, `review-r1-bug-mimo-usage.json`, `review-r<n>-<lens>-<lane>.jsonl` streams and `--last` files never match.
- A refused state file's message names the file; a refused `actions.jsonl` line's message names `actions.jsonl` and the 1-based line number of the offending line. Exact phrasing follows the existing `hostError` message style.
- What stays as it is: a present file that does not parse as JSON is skipped, not refused; a mapping state file whose `reviewers` is not a list is skipped; a missing `logs/` folder or `actions.jsonl` is a life stage, not corruption; every other refusal keeps its exit and only gains a message where it had none.
- The positive control proves the reviewers came from the state file: its `actions.jsonl` carries no `review-launch` line, so reviewer worktrees in the result can only come from `review-r1.json`.
- The identical command: the negative controls (AC2, AC3) run the same `close-run` and `stop-run` invocations as the positive (AC1), against the same record shape with one file changed.
- The controls live in the shared sequential fixture (`runControls`) as a new section beside the other teardown controls, each building its record under the fixture root; `scripts/host.test.ts` gains the section row and its header total stays true.

## Showing each criterion

For each acceptance criterion, its full wording from the ticket and the check that shows it working the way it will really be used.

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
|---|---|---|---|
| AC1 | `host.sh close-run <dispatch>` and `host.sh stop-run <dispatch>` read the reviewers from the review state file of each round (`review-r<n>.json`) and from nothing else in `logs/`, so a findings list or a usage file beside it changes nothing. Check: against a run record whose `logs/` holds `review-r1.json`, `review-r1-bug-mimo-findings.json` (a list) and `review-r1-bug-mimo-usage.json`, both commands exit 0 and name the reviewer worktrees from `review-r1.json`. | Build a run record in a temporary folder: `brief.md` with a `## Dispatch` section naming a synthesis worktree under `.worktrees/`, `run.json` and `manifest.json` naming a lane, `logs/review-r1.json` a mapping whose `reviewers` names a lens/lane pair, `logs/review-r1-bug-mimo-findings.json` a list, `logs/review-r1-bug-mimo-usage.json` a mapping, `actions.jsonl` with no `review-launch` line; create the reviewer worktree directory so it is processed. Run `host.sh close-run <dispatch>` and `host.sh stop-run <dispatch>`. | Both commands exit 0, and each names the reviewer worktree from `review-r1.json` (`<ticket>-rev-<lens>-<lane>`). |
| AC2 | A review state file that is not a mapping is still refused, and the refusal says which file. Check, with the identical command: the same run record with `review-r1.json` replaced by a list exits 2 and prints a message naming `review-r1.json`. | The same record with `logs/review-r1.json` replaced by a list. Run the identical `close-run` and `stop-run` commands. | Both commands exit 2, and each prints a message naming `review-r1.json`. |
| AC3 | Every other refusal in `runWorktreePaths` prints a message too, so that an exit 2 is never silent. Check: a non-mapping line in `actions.jsonl` exits 2 and the message names `actions.jsonl` and the line number. | The same record with `actions.jsonl` holding a non-mapping line. Run the identical `close-run` and `stop-run` commands. | Both commands exit 2, and each prints a message naming `actions.jsonl` and the 1-based line number. |
| AC4 | The host controls (`scripts/host-self-test.ts`, run by `scripts/host.test.ts`) hold the three checks above, each against a record in a temporary folder, with the positive and the negative control through the identical command. | Run `bun test scripts/host.test.ts` from the worktree root on the finished branch. | Green, with the three checks present as controls in `runControls`, each against a record in a temporary folder, and the section counts and header total in `host.test.ts` true. |

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Reproduce the refusal: build the AC1 record in a temporary folder and run `scripts/host.sh close-run` and `scripts/host.sh stop-run` on it, observing the silent exit 2 before any code change.
- [ ] T002 [AC1] Narrow the review-state match in `scripts/host.ts` (`runWorktreePaths`) to `review-r<n>.json`, so findings lists and usage files are never opened as state.
- [ ] T003 [AC2] [AC3] Give the non-mapping state file and non-mapping `actions.jsonl` line refusals in `scripts/host.ts` (`runWorktreePaths`) messages naming the file (and the 1-based line number), and a message to every other refusal there that lacks one.
- [ ] T004 [AC1] [AC2] [AC3] [AC4] Add the three checks as controls in `scripts/host-self-test.ts` (`runControls`), each against a record in a temporary folder with the positive and the negative control through the identical command, and keep the section row and header total in `scripts/host.test.ts` true.
- [ ] T005 [AC1] [AC2] [AC3] [AC4] Run the AC1–AC3 checks against the finished code, then the full gate (`bun run check`) and `<tool>/scripts/verify.sh run .` from the worktree root, and fix what fails.
