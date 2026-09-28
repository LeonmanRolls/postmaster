# Workhorse summary: #112 Show full headless agent messages and commands in panes

## Built

- `968d5f6` Specify full pane stream rendering for #112.
- `506fb31` Render full messages and commands in panes for #112.
- `3340398` Isolate the verify journey path self-test for #112 gate.

`scripts/view-stream.sh` now preserves message and command text, wraps it to the display width, and renders the command and final message from Muse Code records. The Muse fixture is a focused excerpt from a constrained headless run. It includes a tool result whose JSON text contains both the command and output; the pane shows the command and omits the output. The pane-view documentation now describes wrapped text.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` ran just before this summary and exited 2. Its check line was:

```text
gate: fail, exit 1, 268s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

  The gate reached `host.sh --self-test` and failed its known load-sensitive control, “its runner and the launch killed outright: the marker still lands.” The isolated `scripts/host.sh --self-test` passed afterward.

- `bash -n scripts/view-stream.sh`: exit 0.
- `scripts/view-stream.sh --self-test`: exit 0.
- `scripts/front-door-acceptance.sh --self-test`: exit 0.
- `scripts/style-findings.sh --self-test`: exit 0.
- `scripts/host.sh --self-test`: exit 0.
- `git diff --check`: exit 0.
- A constrained Muse Code headless run that issued one `printf 'MUSE_COMMAND_SAMPLE'` command and returned a two-line message: exit 0. The captured event payloads form `scripts/fixtures/view-stream/muse.jsonl`.

## Baseline controls

Each control was run through `git show bb782a973e69427c820ce16a676718e87f51995b:scripts/view-stream.sh`; each renderer invocation exited 0 while printing truncated output:

- Multiline message: `says: The command printed 3 entries.` The second line, `More detail.`, was absent.
- 200-character command: `shell: ` followed by 159 `x` characters and `…` on one line.
- Recorded Muse stream:

```text
bash
result: completed · MUSE_MESSAGE_FIRST_LINE
```

  The command and second message line were absent.

## Decisions

- Follow mode wraps to the terminal width; stream reading without follow mode keeps a 160-column width. Python's standard library handles wrapping, with no new dependencies.
- Muse's committed trial notes contain event summaries, not complete JSONL. The fixture therefore uses the actual `muse exec --json` event payloads captured in a constrained run.
- The first gate attempt exposed that `verify.sh --self-test` inherited the gate runner's `POSTMASTER_VERIFY` while checking a separate fake worktree. The added one-line test adjustment clears that variable for the fake-worktree path check.
- The workhorse spec did not include that gate-test adjustment; it was added after the first gate run to let the required check exercise the fake worktree correctly.

## Not done

- A live Herdr or Moshi pane was not opened. The brief assigns that check to the coachman after synthesis. The `--follow` self-test exercised a growing stream and a command longer than a simulated 60-column pane.
- No push was made, as the ticket directs.

## Verdict

- AC1: Met. Message lines are retained and wrapped, with no ellipsis truncation.
- AC2: Met. Command text is retained and wrapped, including long commands.
- AC3: Met. The recorded Muse stream displays its command and full two-line reply.
- AC4: Met. Tool output remains out of the pane; the Muse fixture checks this alongside existing noise controls.
- AC5: Met. Multiline, over-width and recorded Muse controls pass after the change and each showed the old output when run through the BASE renderer.
- AC6: Implemented for live panes. The simulated `--follow` controls pass; a live Herdr/Moshi run remains for the coachman to verify.
