# Workhorse spec: #165 Close finished host launches and run worktree spaces

## Summary

Close completed tabs and all run-created worktree spaces by using host-recorded ownership, while ensuring every launch belongs to its run's space and user-created panes survive.

## Technical context

- **Language and version**: Bash, with Python 3 used by existing script self-tests where needed.
- **Dependencies used or added**: Existing Herdr and tmux interfaces; no new dependencies planned.
- **Testing**: `scripts/host.sh --self-test` and the ticket's full `scripts/verify.sh run .` check; host controls exercise Herdr and tmux lifecycle behavior.
- **Constraints**: Keep launch output in existing event and log files. Close only tabs/panes recorded as opened by `host.sh`; never identify owned tabs from labels or prompt text. Do not push.

## Direction check

- Close finished host launches using ownership recorded by `host.sh`, and let a resumed leg reuse its launch tab.
- Require a run-space identity for launches and propagate it to reviewer launches.
- At Stage G and abandon, close spaces for every worktree created by the run, including lane worktrees and review clones that Git does not list as worktrees.
- Preserve user-created panes and tabs, and prove the lifecycle with positive and negative controls for both supported hosts.
- Work only in this worktree, commit incrementally, and leave pushing to the user.

## Structure

- `scripts/host.sh`: record launch ownership, reuse/close launch tabs, enforce run-space nesting, and extend lifecycle self-tests.
- `scripts/launch.sh` and `scripts/review-round.sh`: carry the run-space identity through ordinary, resumed, and direct reviewer launches.
- `scripts/stage.sh` and the teardown path it invokes: enumerate and close spaces for all run-created worktrees and review scratch clones.
- Relevant host/launch runbook documentation, if implementation changes its interface or lifecycle contract.

## Complexity tracking

## Decisions

- Use stable launch identities and host-recorded identifiers for reuse and close operations; labels and prompt text are not ownership signals.
- Track the run-created worktree paths as they are made so teardown can include scratch clones absent from `git worktree list`.
- Keep existing event streams and logs as the durable launch output; host cleanup removes only the live viewing tab or space.
- Run the requested verification suite, then record its exact output and all decisions in `WORKHORSE-SUMMARY.md`.

## Tasks

- [ ] T001 [P] [AC1] Record launch identity and close finished owned tabs while reusing the same tab on resume in `scripts/host.sh`.
- [ ] T002 [P] [AC2] Limit close operations to host-recorded tabs or panes opened by this run in `scripts/host.sh`.
- [ ] T003 [P] [AC3] Close every run-created worktree space at Stage G and abandon, including lane and review scratch worktrees, in `scripts/stage.sh` and its teardown path.
- [ ] T004 [AC4] Require and propagate the run-space identity for lane, coachman, and direct reviewer launches in `scripts/host.sh`, `scripts/launch.sh`, and `scripts/review-round.sh`.
- [ ] T005 [AC5] Add positive and negative lifecycle controls for resumed launches, review rounds, teardown, and user-created panes under Herdr and tmux in `scripts/host.sh`.
- [ ] T006 [AC1] [AC3] [AC4] Update host lifecycle documentation if the implementation changes its interface or contract.
