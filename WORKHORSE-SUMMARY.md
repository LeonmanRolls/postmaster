# Workhorse summary: 105 Label a run's launches in Herdr by role, lane and model, not the ticket title again

## Commits

1. `05bd727` — workhorse spec: run-level ticket labels, launch labels by role and lane.
2. `58a9157` — label launches by role, lane and model; the ticket once on the run's space.
   `scripts/host.sh` (`name_cmd`, `waybill_get`, `run_name`, `coachman_model`, `herdr_place`,
   `run --under`, self-test and live-test), `skills/postmaster/hosts.md`,
   `postmaster.md`, `coachman.md`, `SKILL.md` in step with it.
3. `53869ec` — keep verify's self-test off the gate's armed spec.

## Checks

From `/home/brindlewick/postmaster/scripts/verify.sh run .`, run just before this summary:

- `gate` [default:gate]: **pass, exit 0**, 305s: `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`

Other commands, with their exit:

- `scripts/host.sh --self-test` — exit 0 (run several times; one load flake of the known
  `#85` control, `its runner and the launch killed outright`, which passes on a quiet machine).
- `scripts/host.sh --live-test` — exit 0, all controls behaved, including the `--under` ones
  on this machine's Herdr (run space carries the ticket, launch tabs do not, the security
  clone is a tab under the run, no empty shell tab).
- `scripts/verify.sh --self-test` — exit 0, also with `POSTMASTER_VERIFY` set as the gate sets
  it (the case `53869ec` fixes).
- `scripts/review-round.sh --self-test` — exit 0 (three repeats, after one gate-time flake).
- `scripts/skill-refs.sh` — exit 0.
- `bash -n scripts/host.sh` and `bash -n scripts/verify.sh` — exit 0.

## Decisions

- **`name` is two shapes.** `name <dispatch>` is the run's name (the waybill's Dispatch
  `name:`, the ticket). `name <dispatch> <part>...` is the launch's name: parts joined with
  ` · `, never the ticket. Callers pass role, lane, model, leg or round as parts, matching
  the ticket's examples.
- **The coachman's model is never typed.** When the first part is `coachman` and the rest is
  empty or starts with `leg`, `name` inserts the model from `run.json`'s recorded config or
  the waybill Team line (`Muse/Spark/max` shows as `Muse Spark`). An explicit part after
  `coachman` is taken as the model and nothing is inserted twice.
- **The run level is the synthesis worktree's space**, labelled `name <dispatch>`. Every
  launch of a run is a tab there (`run --under <dispatch>`), whatever worktree or clone its
  `<cwd>` is. Workhorse and reviewer worktrees no longer get a space of their own when
  placed under a run; `stop` and `close` stay registry-based and still work on them.
- **The security clone under a run is a tab**, not a top-level space: `herdr_place` skips
  `workspace create` for a clone when `--under` is set and places it in the run's space.
  With no `--under`, a clone still opens as a space of its own, as before.
- **No empty shell tab.** A space `host.sh` opens gives its root tab to the first launch
  (renamed to the launch's name). A root that would be unused — a repo space opened only so
  a worktree nests, or a spawn that needs its own cwd and `--env` — is closed.
- **Postmaster label is `postmaster`**, not `<project> · postmaster`: the project's space
  already carries the project name.
- **`verify.sh`'s self-test unsets `POSTMASTER_VERIFY`.** `verify.sh run` arms each check
  with that variable; without the unset, `journey-path` resolved against the gate's own
  armed spec and the self-test always failed once host.sh's flake did not fire first. That
  one-line fix is in this branch so the gate can pass; it is not part of the labelling
  work and could be dropped to its own ticket if the coachman prefers.

## What I did not do

- Criterion 6's phone check is the user's on a live run. My part is done: `--self-test` has
  the label controls and `--live-test` passes on this machine with the new labels and the
  clone under the run.
- No wiki page. Lanes do not read the wiki; the coachman or a later ticket records what
  Moshi shows for these labels.
- `host.sh`'s forms are unchanged for callers: `detect`, `name`, `run`, `stop`, `close`,
  `spawn`, `send`, `wait`, `read`, `--self-test`, `--live-test`. `run` gained `--under`;
  every runbook call site that launches under a run passes it.

## Acceptance criteria

1. **Met.** A launch under its run is labelled by role, lane, model, leg or round
   (`coachman · Muse Spark · leg 2`, `luna · workhorse`, `mimo · bug review r2`). Self-test
   controls for a coachman leg, a workhorse, each review lens with its round, and the
   postmaster, each checking the label leads with the role and holds no part of the ticket.
2. **Met.** The ticket number and title appear once, on the run's space. Self-test: "the
   run's level carries the ticket"; a launch label never holds the title.
3. **Met.** The security clone's launch is a tab under its run in Herdr (`--under`), never a
   top-level space. Self-test and live-test both say so.
4. **Met.** A space `host.sh` opens for a run shows no empty shell tab beside its launches.
   Self-test counts the run's tabs; live-test asks Herdr for `tab_count`.
5. **Met.** `host.sh --self-test` has those controls plus the run-level ticket control.
6. **Ready for the user.** `--live-test` passes on this machine with the new labels and
   placement; the user confirms the phone sidebar on a live run.
