# Workhorse summary: 102 Keep the caller's Claude and Herdr identity out of the agents it launches

## Commits on this branch

- `e9d76bf` Shared workhorse spec for #102, revision 2: strip by name and family (the approved spec this workhorse implemented from)
- `c1545d9` Keep the caller's Claude and Herdr identity out of every launch environment
- `8070010` Control the identity strip on every host, and record it in hosts.md

(Also on the branch, from the coachman rather than this workhorse: `8c388bc` this lane's
first draft of the spec, `0fca2f5` the shared spec that replaced it.)

## What was built

`scripts/host.sh`'s `runner()` now builds a launch's environment as a deny-list: the
caller's Claude Code session identity and every `HERDR_*` of the caller's are dropped before
the command starts. In a Herdr pane only that pane's own six `HERDR_*` are injected; on tmux
or with no host none are. Every other caller variable still arrives, including
`POSTMASTER_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*` and configuration under
the `CLAUDE_CODE_` prefix outside the stripped families. The header and
`skills/postmaster/hosts.md` name the strip and how to extend it.

`--self-test` pins each criterion with a positive and a negative control on herdr, tmux and
no host, including a stub `claude` that models the session-record contract (identity present
→ no record of its own; identity absent → a record under the streamed thread id, and a
resume continues it).

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
printed, just before this summary was written:

```
gate: pass, exit 0, 798s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One line per check named in the waybill:

| check | command | exit |
|---|---|---|
| gate | the command printed above (every script parses, skill-refs and wiki-lint clean, 40 script self-tests) | 0 |

Other commands run on this branch, with their exits:

| command | exit |
|---|---|
| `bash -n scripts/host.sh` | 0 |
| `scripts/host.sh --self-test` | 0 (all controls behaved) |
| `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` | 0 (gate, 798s) |

## Decisions taken within the brief

1. **Strip Claude identity by exact name and identity family, not the whole `CLAUDE_CODE_*`
   prefix.** The approved shared spec settled this; the implementation follows it. Exact
   names `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`,
   `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ATTENDED`,
   `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, plus the families
   `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_CODE_CHILD_*`. A synthetic
   `CLAUDE_CODE_SESSION_FUTURE` in the controls shows the families catch a name the ticket
   does not list. Configuration under the prefix that is not in those families
   (`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) is kept,
   and a control asserts it arrives.
2. **Treat every caller `HERDR_*` as identity.** Dropped from the caller on every host; the
   pane's own six are the only ones injected, and only in herdr mode.
3. **The filter lives only in `runner()`.** That is the single hand-over of a caller
   environment (`dump_env` for the bg fallback, `read_env` from the FIFO for a pane).
   `spawn` already copies only `POSTMASTER_*` into a new session and was not changed.
4. **AC4 is checked with a stub, not a live `claude`.** The self-test never touches a live
   server. The stub models the session-record contract the fourth criterion pins; it does
   not re-prove Claude's own behaviour.
5. **The lane's env file clause of AC3 is controlled at the host boundary.** The probe
   sources an env file the way `launch.sh` does, after the host hand-off, and a control
   asserts its values arrive. `launch.sh --self-test` keeps its own env-file control and
   stays green as part of the gate.

## What was not done, and why

- **`host.sh spawn` was not changed.** The ticket's criteria name `host.sh run`, and the
  approved spec records that spawn never copies the caller's environment into the new
  session. A host server whose own environment carries identity is the host's environment,
  not the caller's.
- **`scripts/launch.sh` was not changed.** It already applies the lane env file after the
  host hand-off and already restores `POSTMASTER_EVENT_STREAM` around that source. The gate
  runs its self-test and it passed.
- **No `--live-test` run against a real `claude` or a live Herdr server.** The brief's named
  check is the gate, which runs `--self-test` only. The real-claude behaviour is what #67's
  trial observed; this change pins host.sh's side of it.

## Verdict on the acceptance criteria

1. **A lane or leg launched through `scripts/host.sh run` carries none of its caller's Claude
   Code session variables, with Herdr, with tmux and with no host.** Met. The filter drops
   the exact names and the three families on every mode; controls assert it on all three
   hosts, with a direct run of the same probe as the positive control.
2. **A launch carries no Herdr variable of its caller's: in a Herdr pane only that pane's
   own, and with tmux or no host none.** Met. All caller `HERDR_*` are dropped; herdr mode
   injects the pane's own six (the stub sets them to distinct values and the controls read
   those, not the caller's); tmux and none inject none.
3. **Every other variable of the caller's still reaches the launch, `POSTMASTER_` settings
   and a harness's own configuration included, and so does the lane's env file.** Met. The
   strip is a deny-list; controls assert `POSTMASTER_LAUNCH_NAME`, `POSTMASTER_EVENT_STREAM`,
   `CALLER_VAR`, `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_BASE_URL`,
   `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` and `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` arrive,
   and that a sourced env file's values arrive.
4. **A headless claude lane launched from a Claude Code session writes its session record
   under the thread id its stream names, and a resume of that thread continues it.** Met as
   host.sh's side of it. The stub, run through `host.sh run` from a caller that sets
   identity, writes a record under the streamed thread id and a resume continues it; the
   same stub run directly with identity writes no record. That is the #67 failure and its
   fix, pinned as a control.
5. **`scripts/host.sh --self-test` checks each criterion above with a positive and a negative
   control.** Met. Each of the four criteria has both, on herdr, tmux and no host; the
   self-test exits 0 and the gate including it passes.
