# Workhorse spec: #122 Watcher takes mechanical steps

## Summary

Extend `runs-watch.sh` to dispatch valid next legs and resume legs ended by named transient provider errors, while leaving judgment calls for the postmaster and recording each action.

## Technical context

- **Language and version**: Bash with Python 3 for structured run data.
- **Dependencies used or added**: Existing project scripts and harness CLIs; no new dependencies.
- **Testing**: `scripts/runs-watch.sh --self-test`, `scripts/launch.sh --self-test`, and the project gate.
- **Constraints**: Held runs are untouched. The watcher uses the recorded run config, existing host and launch adapters, durable stream and error files, and the standard action log. Transient error names and thread-id parsing stay in the harness adapter.

## Direction check

- The watcher takes only the mechanical dispatch and transient-remount steps; escalation, cards, walls, refusals, inspection, and incomplete steps wake the postmaster.
- Harness-specific matching and stream parsing live behind `launch.sh` and are documented beside its forms in `harnesses.md`.
- Counts and dispatch metadata stay under the run directory and survive watcher restarts.
- The held list is checked before taking a step; held runs receive no marker or state changes.
- Self-test controls invoke the same watcher decision and action paths while replacing host launches with a recording stub, so they never start agent threads.
- No new script is added, so the gate's self-test list does not change.
- Runbook script paths continue to use `<tool>`.

## Structure

- `scripts/runs-watch.sh`: inspect each run, take eligible steps, report judgment cases, and test each behavior with controls.
- `scripts/launch.sh`: expose harness-adapted thread-id and transient-error inspection for a run and leg.
- `skills/postmaster/harnesses.md`: record adapter outputs and the named transient provider errors.
- `skills/postmaster/postmaster.md`: update Stage D to describe watcher-owned actions and postmaster-owned decisions.

## Decisions

- Store resume attempts in a run-local watcher state file, keyed by leg, instead of the coachman manifest. This keeps the count durable without racing updates to fields owned by a coachman.
- Retry only explicitly named transient provider errors; a quota or provider wall and a launch refusal remain postmaster decisions.
- Treat missing metadata, failed hand-off checks, failed leg lookup, failed host launches, and unavailable thread ids as incomplete watcher steps that wake the postmaster.
- Keep the watcher in `runs-watch.sh` and add adapter subcommands to `launch.sh`; no new script or gate entry is needed.

## Tasks

- [x] T001 [P] [AC1] Add hand-off validation, next-leg prompt construction, host launch, manifest updates, and `dispatch` logging in `scripts/runs-watch.sh`.
- [x] T002 [P] [AC2] Add durable per-leg retry limits and adapter-driven transient-error remounts in `scripts/runs-watch.sh` and `scripts/launch.sh`.
- [x] T003 [P] [AC2] Document thread-id and transient-error adapter behavior in `skills/postmaster/harnesses.md`.
- [x] T004 [AC3] Keep decision cases and incomplete watcher steps visible to the postmaster; update Stage D in `skills/postmaster/postmaster.md`.
- [x] T005 [AC4] Check held runs before every state change or launch in `scripts/runs-watch.sh`.
- [x] T006 [AC5] Add positive and negative controls for watcher actions and wake cases in `scripts/runs-watch.sh --self-test` and adapter controls in `scripts/launch.sh --self-test`.
