# Workhorse spec: 75 A ticket id that already names a run or a branch is refused

## Summary

Stage B names a run directory and its branches after the ticket id and creates them without
looking, so a re-run or a local ticket whose number an earlier GitHub issue used silently
reuses the old run and then fails at `git worktree add`. This workhorse adds one script that
refuses that id before Stage B writes anything, names every clash, and leaves the old run to
the user; Stage B runs the script and puts any refusal to them.

## Technical context

- **Language and version**: bash (`#!/usr/bin/env bash`, `set -uo pipefail`), as every other
  `scripts/*.sh` in this repo. No Python needed for an existence check and a branch list.
- **Dependencies used or added**: none. `git` and the shell, already required.
- **Testing**: `bash -n scripts/run-clash.sh`; `scripts/run-clash.sh --self-test` (AC3);
  a throwaway git repo under `mktemp -d` used as both a clean pass and each planted clash;
  the project gate via
  `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
  from the worktree root (AC4's prose is read-checked; the gate covers the script and every
  path the runbooks name).
- **Constraints**: the ticket's direction is a check in a script, run at Stage B before the run
  directory is made; on a clash the user decides (archive the old run, rename it, or pick
  another id) and the postmaster renames or removes nothing. Local ids stay plain numbers
  (#11). Moving a repository between tracker kinds stays out of scope. Project rules: a
  deterministic check lives in `scripts/`; every count has a positive and a negative control
  through the identical command; a script path in `skills/postmaster/` goes through `<tool>`.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| A check in a script, not prose | New `scripts/run-clash.sh` holds the check; `postmaster.md` only calls it |
| Run at Stage B before the run directory is made | A new Stage B step before the create-directory step (and before the `.git/info/exclude` write, so nothing in Stage B has written yet) |
| On a clash the user decides | The refusal names what exists and lists archive / rename / pick another id; Stage B stops and asks |
| The postmaster renames or removes nothing itself | Stage B text says so explicitly |
| Local ids stay plain numbers | The script takes the id as given; no id scheme change |
| Moving between tracker kinds is out of scope | Not touched |
| Deterministic work goes in `scripts/` | The check is entirely in `run-clash.sh` |
| Every count needs a control | Self-test: clean pass (zero clashes) and each planted clash (non-zero), same argv |
| Script paths in runbooks go through `<tool>` | Stage B cites `<tool>/scripts/run-clash.sh` |
| Prefer a script to a hand-rolled step (`SKILL.md`) | Stage B gains a script call, not a checklist item |

No departure from the ticket's direction or the project's own rules.

## Structure

| Path | Change |
|---|---|
| `scripts/run-clash.sh` | new. `run-clash.sh <repo> <ticket-id>` and `--self-test` |
| `skills/postmaster/postmaster.md` | Stage B: new clash-check step before the run directory is created; later steps renumbered; refusal goes to the user |
| `README.md` | one line in the script list beside the other run checks |

## Complexity tracking

None.

## Decisions

1. **Script name `run-clash.sh`.** Beside `run-meta.sh` / `run-log.sh` / `run-times.sh`: it is
   about a run's identity clashing with what is already in the project. `*-check.sh` was
   considered (`ticket-check`, `handoff-check`) but those check an artifact's shape; this one
   reports a clash.
2. **CLI is `<repo> <ticket-id>`.** Matches `ticket-check.sh <repo> <id>`. The run root is
   `<repo>/.postmaster/runs/` as `postmaster.md` defines it; the script derives it and does
   not take a second path.
3. **What is checked, exactly the acceptance criteria:** `<runs>/<TICKET>/` (or a file at
   that path), local branch `<TICKET>`, and local branches matching `wb/<TICKET>-*`. Not a
   leftover worktree directory, not remote branches: `git worktree add -b` fails on a local
   branch clash, and the silent reuse is the run directory. Near-misses are out: ticket `7`
   must not refuse `70` or `wb/70-lane`.
4. **Exit codes:** `0` free; `1` usage or `<repo>` is not a git repository; `2` one or more
   clashes. Mirrors `check-target.sh` (0 usable, 1 cannot look, 2 must ask).
5. **Output:** on success one line naming the id as free; on clash one line per clash, naming
   the full run-directory path or the branch name, so the postmaster can put each to the user
   and the self-test can assert names. A closing line offers the three user choices.
6. **Ticket id shape:** empty, or containing `/`, is refused as usage. It becomes a single
   path component and a branch name; a traversal would make the check meaningless. Local ids
   are plain numbers and GitHub ids are issue numbers, so this does not constrain real ids.
7. **Stage B placement:** a new numbered step after the base pre-flight and before
   exclude-worktrees / create-run-directory. That satisfies "before Stage B writes anything"
   as well as "before the run directory is made". Later steps renumber; nothing in-repo cites
   a Stage B step number today.
8. **Logging:** the script does not log. `ticket-check.sh` does not log either; the postmaster
   logs the action. Stage B already logs what it does; a `note` naming the refusal is enough
   and is not required by the acceptance criteria.
9. **Gate list:** the waybill's gate names the 40 scripts that had a self-test at BASE and is
   not a file in this repo. The new script's `--self-test` is AC3 and will be run and recorded
   in `WORKHORSE-SUMMARY.md`; `bash -n scripts/*.sh` in the gate still parses it.
10. **No wiki page.** `wiki/concepts/local-tracker.md` already names this cost. A wiki claim
    needs promoted evidence; this change is the mechanism, not a finding from a run.

## Tasks

- [ ] T001 [P] [AC1] [AC2] Write `scripts/run-clash.sh`: refuse and name `<repo>/.postmaster/runs/<ticket-id>/` when it exists, and refuse and name local branch `<ticket-id>` and every `wb/<ticket-id>-*`; exit 0 free, 1 usage/not a repo, 2 clash.
- [ ] T002 [AC3] Self-test in `scripts/run-clash.sh --self-test`: a clean pass, each refusal (run directory, ticket branch, `wb/` branch, several at once) naming what it refused, and a near-miss control (ticket `7` against `70` / `wb/70-*`) through the identical command.
- [ ] T003 [AC4] In `skills/postmaster/postmaster.md` Stage B, run `<tool>/scripts/run-clash.sh <repo> <TICKET>` before the run directory is made; put any refusal to the user (archive, rename, or pick another id); state that the postmaster renames or removes nothing itself; renumber the later steps; list `scripts/run-clash.sh` in `README.md`.
