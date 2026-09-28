# Workhorse summary: 112 Full messages and commands on a pane

## Commits

- `956b544` `#112, workhorse spec: full messages and commands on a pane` — `WORKHORSE-SPEC.md` alone, before any code.
- `68cfbaa` `#112, show full messages and commands on a pane, wrapped, and Muse's too` — `scripts/view-stream.sh` wraps every line instead of cutting the first, and renders Muse commands and messages; pane-view prose in `skills/postmaster/harnesses.md`, `skills/postmaster/hosts.md`, `README.md`.
- `2d2aa66` `#112, tick the workhorse spec's tasks`
- (this commit) `WORKHORSE-SUMMARY.md`, and T005 ticked in the spec.

## What it does

`short()` in `scripts/view-stream.sh` took only the first line of a message or command and
ellipsized it at the pane width. It is now `wrap()`: every line, word-wrapped to the pane
(`width`, unchanged: terminal columns − 10 when following, 160 otherwise), hard-breaking any
token longer than the pane, and never an ellipsis. `show()` wraps each rendered item and strips
control characters per physical line, so a multi-line message keeps its newlines.

Muse Code's `--json` stream carries a command inside a bash `tool.result`'s `text` JSON
(`"command"`), a path in `edit_facts` or in `Read text file \`…\``, and message text only as
`run.output.delta` chunks plus the `run.terminal.*` text. `muse_facts()` pulls the command or
path for `tool_line`; deltas are buffered and flushed as `says:` when the next non-delta Muse
event arrives (a tool call ends the message). A `run.terminal.*` does not flush as `says:` —
its text sits on the result line — so the final message is not shown twice. A lone delta with
nothing after it prints nothing, which keeps the existing "streaming delta, whose text the
result carries" control honest. Tool output (`tool.result` text, `task.lifecycle.output`
chunks) never reaches the pane.

The self-test gained a multi-line message control, a line longer than the pane, a command
longer than the pane, and a recorded Muse Code stream (event shapes from a real coachman
`--json` log) with a "tool output stays out" control. The old "first line only" control now
expects every line.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .`, run just before this summary:

```
gate: fail, exit 1, 373s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
  self-test: 1 control(s) misbehaved
  log: /home/brindlewick/postmaster/.worktrees/112-mimo/.postmaster/verify/logs/gate.log
```

The single misbehaved control on that run was `review-round.sh`'s
`a wait run again keeps the round's deadline rather than starting a new one (exit 3)` — a
timing control. Four full gate runs under the load of the other runs in flight failed on
either that control or `host.sh`'s `its runner and the launch killed outright: the marker
still lands`, which the brief names as known to fail about one run in six under load (#85).
Neither script is touched by this change; `review-round.sh`'s control fails the same way on
the BASE file (`git show bb782a9…:scripts/review-round.sh`, run in place, exit 1 on the same
control). Every other self-test in the gate, including `view-stream.sh`, behaved every time.

Other commands run, with exit:

- `scripts/view-stream.sh --self-test` — exit 0, all controls behaved (run alone and inside every gate run).
- `scripts/skill-refs.sh` — exit 0.
- `scripts/wiki-lint.sh` — exit 0.
- `for f in scripts/*.sh; do bash -n "$f"; done` — exit 0.
- Each of the other 28 gate self-tests alone — exit 0 (host.sh and review-round.sh flaked only in full-gate runs under load).
- New controls against BASE (`git show bb782a973e69427c820ce16a676718e87f51995b:scripts/view-stream.sh`, piped the same events):
  - multi-line message — BASE printed only `says: First line of the reply.` (dropped the rest).
  - 200-character message line — BASE printed `says: xxx…` cut with an ellipsis.
  - recorded Muse Code stream — BASE printed `bash`, `read_file`, `edit_file: notes.md`, `result: completed · Continuing. Done.` (no command, no message).
  All three fail on BASE's behaviour, as criterion 5 requires.

## Decisions

1. **Muse message boundaries.** No per-message commit on Muse's stdout stream; deltas are
   flushed as `says:` when a non-delta event arrives, and `run.terminal.*` shows its text on
   the result line instead. See the spec's Decisions for the full record.
2. **Muse command source.** The bash command is the `command` field inside `tool.result`'s
   JSON `text` (seen in recorded coachman streams); `edit_facts.path` for writes and edits;
   `Read text file \`path\`` for reads. No invented event or field names.
3. **Wrapping.** Greedy word wrap at `width`, hard-break tokens longer than the pane. Explicit
   newlines stay. Timestamps, when following, stay on every physical line.
4. **Result lines** keep their shape and their text, wrapped not truncated (`short(s, 100)`
   is gone).
5. **The "first line only" self-test** was updated rather than kept: the ticket changes that
   behaviour.

## Not done

- Criterion 6 (a live run's panes) is the coachman's to verify after synthesis. What shows it
  holds: `host.sh run` invokes this same `view-stream.sh --follow` on the launch's events file
  (`scripts/host.sh:498`); the self-test's follow-mode controls cover the `--follow` path;
  and a recorded Muse Code stream through the renderer (above) shows a command and a message
  in full. A live pane cannot be opened from this worktree.
- No change to `review-round.sh` or `host.sh`: their timing flakes are pre-existing, named
  (#85) or reproducible at BASE, and out of this ticket's scope.

## Acceptance criteria

1. **Each message in full, every line, wrapped, never an ellipsis — met.** `wrap()` keeps every
   line; the multi-line and over-pane controls cover it; BASE dropped lines and ellipsized.
2. **Each command in full, wrapped the same way — met.** Same `wrap()` on `tool_line` output;
   the over-pane command control covers it.
3. **A Muse Code launch's pane shows each command and each message — met.** `muse_facts()` and
   the delta buffer; the recorded Muse stream control shows a bash command and a two-line
   message; BASE showed only tool names.
4. **Tool output stays out — met.** Still only name + input summary; the Muse control asserts
   the bash `output` and the file body never appear.
5. **Self-test controls, each failing before the change — met.** Three new controls (plus the
   over-pane command); each run against BASE printed the cut or missing behaviour, recorded
   above.
6. **Live run's panes — implemented for the coachman to verify.** `view-stream.sh` is what
   `host.sh` runs on every pane; full text and commands are what it now prints.
