# Workhorse spec: 105 Label a run's launches in Herdr by role, lane and model, not the ticket title again

## Summary

A launch's tab and pane label must name only what tells it apart (role, lane, model, leg or
round), while the ticket number and title appear once on the run level that holds the launch.
This workhorse splits `host.sh name` into a run name and a launch name, nests every launch of
a run as a tab under one run space labelled with the ticket (including the security clone),
and keeps that space free of empty shell tabs.

## Technical context

- **Language and version**: bash + python3 heredocs, as the rest of `scripts/host.sh`.
- **Dependencies used or added**: none; existing Herdr/tmux/none host paths.
- **Testing**: `scripts/host.sh --self-test` (label controls per launch kind and run level,
  placement controls for nesting and empty tabs), `scripts/host.sh --live-test`, then the
  project gate via `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: `host.sh`'s forms stay callable as `hosts.md` names them; runbook call
  sites and `hosts.md` change in the same commit; script paths in runbooks go through
  `<tool>`; ticket titles never pass through a shell; each tree level names only what it adds.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Project's space its name | unchanged: `herdr workspace create --cwd <repo> --label <repo name>` |
| Run its ticket | the run space (synthesis worktree space) is labelled `$(host.sh name <dispatch>)`, the waybill's Dispatch name |
| Each launch its role, lane and model | `$(host.sh name <dispatch> <parts>...)` joins only those parts; the ticket is never prefixed |
| Ticket number and title once, on the run level | launch labels drop the ticket; the run space keeps it |
| Security clone under its run | `run --under <dispatch>` places a clone launch as a tab in the run space, never its own top-level space |
| No empty shell tab in a run's space | a space `host.sh` opens for a run uses its root pane for the first launch, or closes that root tab when the launch is a later tab |
| Deterministic work in scripts | name joining, team model lookup and placement live in `host.sh` |
| A prompt lives in argv, never as a process selector | unchanged |
| Every count needs a control | self-test positive and negative controls per label kind and for nesting |

## Structure

- `scripts/host.sh` — `name_cmd` (run vs launch names, team model for coachman), `run_cmd`
  (`--under`), `herdr_place` (run space, clone under it, no empty root tab), `self_test`,
  `live_test`.
- `skills/postmaster/hosts.md` — `name` and `run` forms, tree shape, label rule.
- `skills/postmaster/postmaster.md` — coachman launch/resume name and `--under`.
- `skills/postmaster/coachman.md` — workhorse and review names and `--under`.
- `skills/postmaster/SKILL.md` — postmaster spawn label.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `run --under <dispatch>` | one run space must hold launches from several worktrees and from a clone | labelling each worktree space with the ticket still repeats the ticket per launch and leaves the clone at top level |

## Decisions

- `name <dispatch>` is the run name; `name <dispatch> <parts>...` is the launch name (parts
  joined by ` · `). Callers pass role/lane/model/leg as parts, matching the ticket's examples.
- When the first part is `coachman` and the rest is empty or starts with `leg`, `name`
  inserts the coachman's model from the waybill Team line / `run.json`, so the model is never
  typed at a call site.
- The run level is the synthesis worktree's space (`synthesis worktree:` in the waybill),
  labelled with the ticket. Every launch of the run is a tab in that space (`--under`).
- Workhorse and reviewer worktrees no longer get a space of their own when placed with
  `--under`; their tabs carry their cwd. `close`/`stop` on those worktrees stay registry-based.
- The postmaster's spawn label is `postmaster` (optionally with its model), not
  `<project> · postmaster`, because the project's space already carries the project name.
- Review labels follow the ticket example: `mimo · bug review r2` (lane · lens review rN).

## Tasks

- [ ] T001 [AC1] [AC2] [AC5] `name_cmd`: run name vs launch name; self-test controls for
      coachman leg, workhorse, each review lens with its round, postmaster, and the run level
      (`scripts/host.sh`).
- [ ] T002 [AC3] [AC4] `run --under <dispatch>`: run space labelled with the ticket, every
      launch a tab under it including the security clone; no empty shell tab
      (`scripts/host.sh`).
- [ ] T003 [AC1] [AC2] [AC3] Update `hosts.md`, `postmaster.md`, `coachman.md`, `SKILL.md`
      call sites and tree shape in the same commit as the script change.
- [ ] T004 [AC5] Extend `--self-test` and `--live-test` for the new labels and placement.
- [ ] T005 [AC6] Make labels verifiable without Moshi: self-test controls plus `--live-test`
      passing on this machine.
