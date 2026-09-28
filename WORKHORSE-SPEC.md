# Workhorse spec: #121 Keep the postmaster watcher running

## Summary

Add a side-effect-free polling script that waits for actionable runs, and document how the postmaster keeps it running and restarts it across supported harnesses.

## Technical context

- **Language and version**: Bash with embedded Python 3, following the existing script conventions.
- **Dependencies used or added**: Existing `runs-status.sh`, Python 3, and the standard shell tools; no new dependencies.
- **Testing**: `scripts/runs-watch.sh --self-test` covers actionable NEXT values, ignored values, held runs and timeout output. The project gate is run through `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: Runtime behavior reads run state, sleeps and prints only. Runbook script paths use `<tool>/scripts/...`. Never select processes by prompt text. Do not push.

## Direction check

- Put the repeatable wait loop in `scripts/runs-watch.sh`; do not add a session-specific polling loop.
- Keep the watcher passive: it reports actionable runs and leaves every action to the postmaster.
- Use `runs-status.sh` as the source of the displayed table and NEXT values.
- Keep harness-specific behavior in `skills/postmaster/harnesses.md`, and use the existing host wrapper to detach the watcher from the conversation.
- Add positive and negative self-test controls through the same decision path.
- Follow the repository instructions on branch isolation, incremental commits, `<tool>` script references, and the final summary. No direction departures are planned.

## Structure

- Add `scripts/runs-watch.sh` with wait, timeout, held-run filtering, help and self-test behavior.
- Update `skills/postmaster/postmaster.md` Stage D with the background/restart and hold/release instructions.
- Update `skills/postmaster/harnesses.md` with watcher startup guidance for each supported postmaster harness and the manual-poll fallback.
- Add this spec before implementation and `WORKHORSE-SUMMARY.md` as the final commit.

## Complexity tracking

No departures from the ticket direction or repository rules.

## Decisions

- Read the hold list at `<runs>/postmaster/held`, one exact ticket name per line; ignore blank lines and surrounding whitespace.
- Read `postmaster.poll_seconds` from the configured postmaster TOML file, using 120 seconds when it is absent or invalid.
- Treat `WAIT`, `USER`, and `-` as non-actionable. A held ticket remains non-actionable regardless of its NEXT value.
- Return on the first actionable poll with the last `runs-status.sh` table and one name/NEXT line per actionable unheld run. On timeout, print the last table and exit 3.
- Use `<tool>/scripts/host.sh run` so the watcher outlives the harness call; if the harness cannot start that wrapper, keep supervision in the conversation with `runs-status.sh` polling.
- Exercise short intervals and timeouts by calling the watch loop with test-only arguments internally; do not add a production polling-interval override.

## Tasks

- [ ] T001 [P] [AC1] Add `scripts/runs-watch.sh` to poll `runs-status.sh`, honor the configured polling interval, report actionable runs, and exit 0.
- [ ] T002 [P] [AC2] Filter `WAIT`, `USER`, closed `-`, and tickets listed in `<runs>/postmaster/held` in `scripts/runs-watch.sh`.
- [ ] T003 [P] [AC3] Implement `--timeout <seconds>` in `scripts/runs-watch.sh`, printing the last status table and exiting 3 when no run needs action.
- [ ] T004 [AC4] Add `scripts/runs-watch.sh --self-test` positive controls for all six named actionable NEXT values and negative controls for `WAIT`, `USER`, `-`, and a held run.
- [ ] T005 [P] [AC5] Update Stage D in `skills/postmaster/postmaster.md` to keep the watcher in the background, act on its report, restart it immediately, and define holding/releasing a run through the held list.
- [ ] T006 [P] [AC6] Update `skills/postmaster/harnesses.md` with detached watcher startup guidance for every interactive postmaster harness and the foreground polling fallback.
