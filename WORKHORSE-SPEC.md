# Workhorse spec: 102 Keep the caller's Claude and Herdr identity out of the agents it launches

## Summary

Remove caller Claude Code session variables and Herdr variables from each child environment built by `scripts/host.sh`, while retaining other caller and lane environment and preserving only the active Herdr pane's own Herdr variables.

## Technical context

- **Language and version**: Bash; `scripts/host.sh` includes a Python-backed self-test.
- **Dependencies used or added**: Existing Bash, Python 3 and the self-test's stub host commands; no new dependencies.
- **Testing**: `scripts/host.sh --self-test` will exercise caller identity removal, Herdr pane ownership, retained caller and lane environment, and a stub Claude session/resume with positive and negative controls. `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` will run the project's full check set.
- **Constraints**: Keep the change inside this worktree and on `scripts/host.sh`; never push, open a pull request or merge. This launch ends after the spec commit, before implementation.

## Direction check

The ticket directs this change to strip the caller's Claude and Herdr identity variables from every agent launch. The implementation will filter the caller environment at `host.sh`'s common runner boundary, before the child process is executed. It will remove `CLAUDECODE` and `CLAUDE_CODE_*` in every host mode, and remove caller `HERDR_*` variables in every mode. In a Herdr pane it will then add back only the existing Herdr pane environment values sourced from that pane; tmux and background launches will receive no Herdr variables.

The repository's design rules require deterministic behavior and controls in scripts, preserve harness adapters and their configuration, pass prompts in argv, and carry positive and negative controls for counts. The change will stay in the host environment boundary, leave launch forms and prompts unchanged, and add paired controls to `host.sh --self-test`. It introduces no project-specific path or setting: the filter uses variable-name patterns, and all fixture data stays under the self-test's temporary directory. It will preserve variables outside the identity names, including `POSTMASTER_` settings, `CLAUDE_CONFIG_DIR`, endpoint variables such as `ANTHROPIC_BASE_URL`, and the lane env file's values, which `launch.sh` adds after the host handoff. The self-test will not act on a real project, and it adds no project action that needs run-ledger logging.

## Structure

- `scripts/host.sh`: filter identity variables while constructing each child environment, preserve current Herdr pane variables from the pane itself, and expand `--self-test` with environment and session/resume controls.

## Decisions

- Match Claude Code session state as `CLAUDECODE` plus the `CLAUDE_CODE_*` namespace, while retaining `CLAUDE_CONFIG_DIR` and unrelated endpoint and harness configuration.
- Treat every `HERDR_*` variable received from the caller as session identity. In Herdr mode, pass only the six existing pane values (`HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`) from the pane runner's own environment. In tmux and background modes, pass none.
- Test caller identity values with harmless fixture markers. Add a stub Claude command that writes its session record under the ID it emits and resumes that same record, plus a negative control that demonstrates the fixture's inherited-identity failure. This keeps `--self-test` independent of a live Claude service.
- The attempted fetch found no `origin/wb/102-luna` ref; use the supplied base commit `ffe37821779aa7cc77275860573a8fdd43cd6e2d` as the worktree baseline.

## Tasks

- [ ] T001 [P] [AC1] Filter `CLAUDECODE` and `CLAUDE_CODE_*` from the child environment in every runner mode in `scripts/host.sh`.
- [ ] T002 [P] [AC2] Remove all caller `HERDR_*` values and restore only the active pane's six existing Herdr values in Herdr mode; verify none reach tmux or background launches in `scripts/host.sh`.
- [ ] T003 [P] [AC3] Extend `scripts/host.sh --self-test` to prove unrelated caller variables, `POSTMASTER_` settings, harness configuration and lane env-file values still reach the launch.
- [ ] T004 [AC4] Add a stub Claude launch/resume control in `scripts/host.sh --self-test` that checks the stream's session ID matches its stored record and that resume continues that ID.
- [ ] T005 [AC5] Add positive and negative controls to `scripts/host.sh --self-test` for every acceptance criterion across Herdr, tmux and no-host modes.
