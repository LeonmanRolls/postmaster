# Workhorse spec: 102 Keep the caller's Claude and Herdr identity out of the agents it launches

Shared spec: written by the coachman from the two lane drafts, per the user's
word. Implement from this file.

## Summary

`scripts/host.sh run` hands a launch its caller's whole environment, so a lane
or leg started from a Claude Code session inherits that session's identity and,
on tmux or no host, the caller's Herdr variables too. Strip those identity
variables where `runner()` builds a launch's environment, keep every other
caller variable and the lane's env file, and pin each acceptance criterion in
`host.sh --self-test` with a positive and a negative control.

## Technical context

- **Language and version**: Bash with Python in heredocs, as the rest of `scripts/host.sh`.
- **Dependencies used or added**: none.
- **Testing**: `scripts/host.sh --self-test` — every criterion, each with a
  positive and a negative control, on herdr, tmux and no host. The project's
  gate from the worktree root. `scripts/launch.sh --self-test` stays green:
  the lane env file path is launch.sh's and must keep working.
- **Constraints**: a security fix — strip identity, change no launch form, no
  runbook contract, no harness adapter. Deterministic checks in `scripts/`, not
  prose. Every count needs a positive and a negative control through the
  identical command. Nothing repo-specific: the filter is a fixed set of exact
  names plus identity families. A script path in `skills/postmaster/` goes through `<tool>`.

## Direction check

The ticket directs stripping the caller's Claude and Herdr identity variables
from the environment of every agent the flow launches. The filter sits in
`runner()`, the single place a caller environment is handed to a command, and
is a deny-list of exact identity names plus identity families — never an
allow-list, and never the whole `CLAUDE_CODE_*` prefix, both of which would
drop configuration the ticket requires to survive. Launch forms, prompts and
harness adapters are untouched. No departure from the ticket's direction or
the project's rules.

## Structure

- `scripts/host.sh`
  - `runner()` environment filter: drop list and prefix; herdr/tmux keep lists.
  - Header comment: what a launch's environment carries and what it never carries.
  - `self_test()`: reused probe and stub commands plus the new controls.
- `skills/postmaster/hosts.md`
  - State the rule beside the launch description: the caller's environment
    minus its Claude Code session identity and minus its Herdr identity; in a
    Herdr pane only that pane's own Herdr variables; with tmux or no host, none.
    Name the stripped list and how to add to it.

Nothing else. `scripts/launch.sh` already applies the lane env file after the
host handoff.

## Decisions

1. **Strip the session's identity by exact name and identity family, not the
   whole `CLAUDE_CODE_*` prefix.** The prefix also carries configuration a
   launch needs, which AC3 keeps. Drop the exact names `CLAUDECODE`,
   `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`,
   `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`,
   `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_MESSAGING_SOCKET` and
   `CLAUDE_CODE_MESSAGING_TOKEN`, plus the identity families
   `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*` and `CLAUDE_CODE_CHILD_*`,
   so a new variable in those families is caught. Keep configuration under the
   prefix, such as `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` and
   `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, and provider or auth settings; and as
   before `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*`, `POSTMASTER_*`
   and every other non-identity name.
2. **Treat every caller `HERDR_*` as identity.** Drop them all from the
   caller's environment on every host. In herdr mode re-inject only the pane's
   own six (`HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_ENV`,
   `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`) from the runner's own environment.
   On tmux and no host inject none. Pane-id and `TMUX` handling otherwise keeps
   the behaviour it already has.
3. **The filter lives only in `runner()`.** That covers every `host.sh run`
   launch on every host including the bg fallback. `spawn` is not changed: it
   never copies the caller's environment into the new session.
4. **AC4 is checked with a stub, not a live `claude`.** The self-test never
   touches a live server. The stub writes a session record under the thread id
   its stream names only when no Claude identity is in its environment, and a
   resume continues that record; with identity present it writes no record of
   its own (the #67 / PR #93 failure). That pins host.sh's side of the real
   behaviour; it does not re-prove Claude's.
5. **The lane's env file clause of AC3 is controlled at the host boundary.**
   The deny-list runs before any command, so a file `launch.sh` later sources
   cannot be emptied by it; the host self-test probes that composition, and
   `launch.sh --self-test` keeps its own env-file control.

## Tasks

- [x] T001 [P] [AC1] In `scripts/host.sh` `runner()`, drop the exact identity names `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN` and the families `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_CODE_CHILD_*` from the caller's environment on every host mode.
- [x] T002 [P] [AC2] In `scripts/host.sh` `runner()`, drop all caller `HERDR_*`; re-inject the pane's own six only in herdr mode; inject none on tmux or no host.
- [x] T003 [P] [AC3] Keep every other caller variable (`POSTMASTER_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*`, and configuration under the `CLAUDE_CODE_` prefix such as `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) reaching the launch in `scripts/host.sh`, with a control that such a configuration variable arrives; and probe that a sourced env file's values still arrive after a `host.sh run`.
- [x] T004 [AC4] Add a stub `claude` in `scripts/host.sh` `self_test()`: without Claude identity it writes a record under the streamed thread id and a resume continues it; with identity it writes no record.
- [x] T005 [AC5] Give every criterion a positive and a negative control in `scripts/host.sh --self-test` on herdr, tmux and no host; run the self-test and the project's gate green.
- [x] T006 [AC1] [AC2] [AC3] Update `scripts/host.sh`'s header and `skills/postmaster/hosts.md` to state what a launch's environment carries and what it never carries, naming the stripped list and how to add to it.
