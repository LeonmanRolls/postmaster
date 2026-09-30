# Workhorse summary: 102 Keep the caller's Claude and Herdr identity out of the agents it launches

## Commits

- `0e740be` — initial spec draft, superseded during review.
- `7e2617a` — approved shared spec.
- `fb5a7e0` — environment filter, host self-test controls and host documentation.

## Built

- `scripts/host.sh` removes the caller's exact Claude Code session identity names and the `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*` and `CLAUDE_CODE_CHILD_*` families at the shared runner boundary. Other `CLAUDE_CODE_*` configuration remains.
- It drops all caller `HERDR_*` variables in every mode. Herdr launches get only the pane's six current Herdr values; tmux and background launches get none.
- The self-test exercises Herdr, tmux and no-host launches, caller and pane environment, `launch.sh` env-file sourcing, and a stub Claude session record and resume.
- `skills/postmaster/hosts.md` documents the environment rule and how to extend the identity filter and controls.

## Checks

- `gate [default:gate]` — `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` — exit 0. It printed: `gate: pass, exit 0, 795s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`.
- `scripts/host.sh --self-test` — initial run exit 1 due to a test comparing the Claude launch pane against a separate probe pane; corrected the assertion and reran successfully, exit 0.
- `scripts/launch.sh --self-test` — exit 0.
- `scripts/skill-refs.sh` — exit 0.
- `bash -n scripts/host.sh && git diff --check` — exit 0.

## Decisions

- Used the approved exact Claude identity names and three identity families, preserving unrelated `CLAUDE_CODE_*` configuration and provider settings.
- Removed every caller `HERDR_*` name, then re-injected the six known Herdr pane variables only in Herdr mode.
- Used the approved stub Claude control. It writes a session record only with a clean identity environment and resumes by the streamed thread id. The lane env-file control runs through `launch.sh` after the host handoff.
- Left `spawn` and launch forms unchanged; `spawn` does not hand the caller's environment to a headless command.

## Not done

- No live Claude session was started. The approved spec requires a stub control and notes it does not re-prove Claude's own behavior.
- No live Herdr or tmux service was touched; host behavior was exercised through the self-test stubs.
- No push, pull request or merge was made, per the ticket brief.

## Acceptance verdict

- AC1: Met. The self-test confirms caller Claude session identity is absent from launches in Herdr, tmux and no-host modes.
- AC2: Met. Caller Herdr variables are removed; only the active pane's six values remain in Herdr, and none reach tmux or no-host launches.
- AC3: Met. Caller settings, harness configuration and values from the lane env file reach the Claude stub in all three modes.
- AC4: Met by the approved stub control. The emitted thread id names the stored session record and resume continues that record.
- AC5: Met. The self-test has positive and negative controls for the identity and environment criteria across Herdr, tmux and no-host modes.
