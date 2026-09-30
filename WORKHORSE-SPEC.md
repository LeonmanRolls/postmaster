# Workhorse spec: #102 Strip the caller's Claude and Herdr identity from every launch

## Summary

`scripts/host.sh run` hands a launch its caller's whole environment, so a lane or leg started
from a Claude Code session inherits that session's identity (and can message it or skip its own
session record) and, on tmux or no host, inherits the caller's Herdr socket as well. This
workhorse strips those identity variables in the single place `runner()` builds a launch's
environment, keeps every other caller variable (including `POSTMASTER_*` and harness
configuration) and the lane's env file, and pins each acceptance criterion in `host.sh
--self-test` with a positive and a negative control.

## Technical context

- **Language and version**: Bash with Python in heredocs, as the rest of `scripts/host.sh`.
- **Dependencies used or added**: none.
- **Testing**:
  - `scripts/host.sh --self-test` — every criterion, with a positive and a negative control.
  - The project's gate from the worktree root (`bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`) — shows: the project's gate passes.
  - `scripts/launch.sh --self-test` unchanged and still green: the lane env file path is launch.sh's and must keep working.
- **Constraints**: a security fix in the direction's sense — strip identity, change no launch
  form, no runbook contract, and no harness adapter. Deterministic checks go in `scripts/`, not
  prose (AGENTS.md design rule 3). Every count needs a positive and a negative control through
  the identical command (AGENTS.md design rule 5). Nothing harness-specific in the flow
  (design rule 2): the strip is a deny-list of identity names and one prefix, not a harness
  allow-list. A script path in `skills/postmaster/` goes through `<tool>` (AGENTS.md).

## Direction check

| Constraint (source) | How this plan meets it |
|---|---|
| Strip the caller's Claude and Herdr identity from the environment of every agent the flow launches (ticket direction) | One filter in `runner()`, the only place `host.sh run` (lane, leg, reviewer, and the bg fallback) hands a caller environment to a command. `spawn` already copies only `POSTMASTER_*` into a new pane (`PLACE_ENV` / tmux `-e`) and never the caller's identity; it is not changed. |
| A security fix (ticket direction) | Deny-list of identity names and `CLAUDE_CODE_*`; no new capability, no allow-list that could drop needed harness configuration. |
| Nothing harness-specific in the flow (AGENTS.md rule 2) | The strip names Claude Code session identity because that is the named threat; it is a fixed set of names plus one prefix, not a per-harness branch. Herdr identity is host identity (`hosts.md`), already host-specific in `runner()` and stays there. |
| Deterministic work goes in `scripts/` (AGENTS.md rule 3) | The strip and every control live in `scripts/host.sh`. Prose is only the header and `skills/postmaster/hosts.md`, which change with the script. |
| Every count needs a control (AGENTS.md rule 5) | Each of AC1–AC4 gets a positive and a negative control through the same probe or stub command; AC5 is those controls. |
| A prompt lives in argv (AGENTS.md rule 4) | Unchanged: no process selection or prompt handling is touched. |
| Every action logged (AGENTS.md rule 6) | No project actions from this change; no new log-action calls. |
| Prefer editing existing files (session guidance) | Only `scripts/host.sh` and `skills/postmaster/hosts.md` change; no new source files. |
| Fix an open PR's gaps on that PR's branch (AGENTS.md) | This is ticket work the ticket itself names, not a gap in an open PR. |

No departure from the ticket's direction or the project's rules.

## Structure

- `scripts/host.sh`
  - `runner()` environment filter: drop list and prefix; herdr/tmux keep lists.
  - Header comment: document what a launch's environment carries and what it never carries.
  - `self_test()` and `test_setup()`: extend `probe.sh` and the herdr stub pane environment;
    add the controls below.
- `skills/postmaster/hosts.md`
  - "Run, on every host" and the herdr/tmux rows: a launch's environment is the caller's
    minus its Claude Code session identity and minus its Herdr identity; in a Herdr pane only
    that pane's own Herdr variables; with tmux or no host, none.

Nothing else. `scripts/launch.sh` already applies the lane env file after `host.sh` hands over
the environment and already restores `POSTMASTER_EVENT_STREAM` around it.

## Complexity tracking

No departures.

## Decisions

1. **Strip Claude identity by name and by prefix, not by the ticket's example list alone.**
   Drop exact `CLAUDECODE` and `CLAUDE_PID`, and every `CLAUDE_CODE_*`. That covers
   `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`,
   `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` as named, and any later
   session variable Claude Code adds under that prefix. Keep harness configuration:
   `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*` and every other non-identity name still
   reach the launch (AC3). A fixed name list alone would leave the next session variable in;
   an allow-list would drop harness configuration the ticket requires to survive.

2. **Herdr connection variables are always dropped from the caller and re-injected only in a
   Herdr pane.** Drop `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH` from the caller's
   environment on every host (they are already only correctly replaced in herdr mode). In
   herdr mode keep injecting the runner's own (the pane's) `HERDR_PANE_ID`, `HERDR_TAB_ID`,
   `HERDR_WORKSPACE_ID`, `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`. In tmux and
   none/bg modes inject none of them. This is AC2 exactly: pane's own in a Herdr pane, none
   otherwise. Pane ids (`PANE_IDS`) and `TMUX`/`TMUX_PANE` keep the behaviour they already
   have.

3. **The filter lives only in `runner()`.** That is the single hand-over of a caller
   environment (`dump_env` for bg, `read_env` from the FIFO for a pane). `spawn` never copies
   the caller's environment into the new session — only `POSTMASTER_*` via `PLACE_ENV` and
   tmux `-e` — so stripping `run` covers every agent the flow launches. `spawn` is not
   changed; a host server whose own environment carries identity is the host's environment,
   not the caller's, and outside this ticket.

4. **AC4 is checked with a stub that models Claude's session-record contract, not a live
   `claude`.** The self-test PATH holds only stubs (the script's own rule: never a live
   server). The stub writes a session record under the thread id its stream names only when
   no Claude identity is in its environment, and a `--resume` continues that record; with
   identity present it writes no record of its own (the #67 / PR #93 failure). The positive
   control launches that stub through `host.sh run` from a caller that sets identity and
   checks the record and the resume; the negative control runs the identical stub command
   directly with identity present and checks no record. That pins host.sh's side of the real
   behaviour; it does not re-prove Claude's.

5. **The lane's env file clause of AC3 is controlled at the host boundary and already covered
   in `launch.sh`.** `host.sh`'s filter is a deny-list applied before any command runs, so a
   file `launch.sh` later sources cannot be emptied by it. The host self-test adds a probe
   that sources an env file the way `launch.sh` does and reports its values after a `host.sh
   run`, so the composition is visible in this script's suite; `scripts/launch.sh
   --self-test` already has `a lane's env file reaches the harness's environment` and keeps
   it.

6. **The controls are added beside the existing environment controls** (the `probe.sh` runs
   under "run, no host", the Herdr stub run, and the tmux run), reusing `hs` and `field` so
   each criterion is measured the same way as the pane-identity checks already there.

## Tasks

- [ ] T001 [P] [AC1] In `scripts/host.sh` `runner()`, drop `CLAUDECODE`, `CLAUDE_PID` and every `CLAUDE_CODE_*` from the caller's environment on every host mode (herdr, tmux, none and the bg fallback).
- [ ] T002 [P] [AC2] In `scripts/host.sh` `runner()`, drop `HERDR_ENV`, `HERDR_SOCKET_PATH` and `HERDR_BIN_PATH` from the caller's environment on every host; re-inject the pane's own only in herdr mode (with the existing pane ids); inject none of them on tmux or no host.
- [ ] T003 [P] [AC3] Keep every other caller variable in `scripts/host.sh` `runner()`, including `POSTMASTER_*` and harness configuration (`CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*`); extend `probe.sh` in `test_setup()` to report them and the identity names.
- [ ] T004 [AC3] Extend `scripts/host.sh` `self_test()` so a `host.sh run` still delivers a sourced env file's values the way `scripts/launch.sh` composes them (positive), and the identity strip does not remove them (negative: identity absent, env file values present).
- [ ] T005 [AC1] Add `scripts/host.sh` `self_test()` controls, for herdr, tmux and no host: the identical `probe.sh` command run directly with identity set reads those names non-zero (positive) and run through `host.sh run` with the same identity in the caller reads them zero (negative).
- [ ] T006 [AC2] Add `scripts/host.sh` `self_test()` controls: in a Herdr pane the launch carries only that pane's own `HERDR_*` (not the caller's), and on tmux and no host it carries none, through the same probe.
- [ ] T007 [AC4] Add a stub `claude` and a session-store directory in `scripts/host.sh` `test_setup()`/`self_test()`: without Claude identity it writes a record under the thread id its stream names and a resume continues it; with identity it writes no record. Control both through `host.sh run` (positive) and directly with identity present (negative).
- [ ] T008 [AC5] Run `scripts/host.sh --self-test` until every new control is green with its positive and negative pair; run the project's gate from the worktree root and record both in the summary.
- [ ] T009 [AC1] [AC2] [AC3] Update `scripts/host.sh`'s header and `skills/postmaster/hosts.md` so they state what a launch's environment carries and what it never carries, matching the filter (paths in `hosts.md` through `<tool>`).
