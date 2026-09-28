# Workhorse spec: 112 Full messages and commands on a pane

## Summary

A headless launch's pane cuts every message and command to one line and ellipsizes it at the
pane width (`short()` in `scripts/view-stream.sh`), and a Muse Code stream shows only tool
names. This change wraps full text to the pane instead of cutting it, and renders Muse
commands and messages from the events its stream already carries.

## Technical context

- **Language and version**: Bash wrapping a Python 3 heredoc (`scripts/view-stream.sh`), as at
  BASE. Python stdlib only (`json`, `os`, `re`, `shutil`, `sys`, `time`; `textwrap` not needed).
- **Dependencies used or added**: none.
- **Testing**: `scripts/view-stream.sh --self-test` (extended), and the project gate
  (`bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh &&
  scripts/wiki-lint.sh && for n in … view-stream …; do scripts/$n.sh --self-test || exit 1;
  done'`). New self-test controls are run against `git show BASE:scripts/view-stream.sh` and
  must fail there.
- **Constraints**: keep the script's path, arguments, output shape and exit codes except where
  the ticket changes them. Tool output stays out of the pane. Do not invent Muse event names;
  use only names seen in `skills/postmaster/harnesses.md` and recorded streams
  (`raw/trials/`, and the coachman `*-events.jsonl` shapes those trials name).

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Show the full text of what the agent says and runs, wrapped to the pane | `short()` (first line, ellipsis) becomes `wrap()` (every line, word-wrapped, never truncated) |
| Tool output stays out | Still only tool name + input summary; Muse `tool.result.payload.text` output and `task.lifecycle.output` chunks are never printed |
| Deterministic work in `scripts/` | All of the change is in `view-stream.sh` and its self-test |
| Every count needs a control | New self-test controls: multi-line message, line longer than the pane, recorded Muse stream; each must fail on BASE |
| Nothing harness-specific in the flow | Muse/claude/codex/mimo/pi rules stay inside `view-stream.sh`, named from `harnesses.md` |
| Script paths in runbooks go through `<tool>` | No new paths in runbooks; existing `<tool>/scripts/view-stream.sh` refs stay |

## Structure

- `scripts/view-stream.sh` — wrap instead of cut; Muse commands and messages; self-test controls.
- `skills/postmaster/harnesses.md` — "The pane view" wording (wrapped blocks, Muse commands and messages).
- `skills/postmaster/hosts.md` — pane bullet wording.
- `README.md` — `view-stream.sh` one-line description.
- `WORKHORSE-SPEC.md` (this file), `WORKHORSE-SUMMARY.md` at the end.

## Decisions

1. **How a Muse message is delimited.** Muse's stdout stream carries message text only as
   `run.output.delta` chunks and the final `run.terminal.*` text; there is no per-message
   commit on stdout. Accumulate deltas and flush them as `says:` when the next non-delta Muse
   event arrives (a tool call ends the message). A `run.terminal.*` does not flush as `says:`
   (its text already sits on the result line). A lone delta with nothing after it prints
   nothing — its text is the result's, which keeps the existing negative control honest.
2. **Where a Muse command lives.** `tool.result` for `bash` carries no `edit_facts`; the
   command is the `command` field inside `payload.text` when that text is a JSON object (a
   recorded coachman stream shows this). `edit_file`/`write_file` keep `edit_facts.path`.
   `read_file`'s path is the path in `Read text file \`…\``. No invented field names.
3. **Wrapping.** Word-wrap at the pane width (`width` as now: terminal columns − 10 when
   following, 160 otherwise). Tokens longer than the pane hard-break so nothing is cut short.
   Explicit newlines in the text stay. No ellipsis, ever.
4. **Timestamps.** Following, every physical output line carries the local time, as now.
5. **Result lines.** Keep the `result: …` shape, including its text, but wrapped not
   truncated (`short(s, 100)` becomes wrap at full width).
6. **Existing "first line only" control.** Updated to expect every line; the ticket changes
   that behaviour.

## Tasks

- [x] T001 [AC1] [AC2] Replace `short()` with a wrap that keeps every line and never ellipsizes; use it for messages and tool/command lines in `scripts/view-stream.sh`.
- [x] T002 [AC3] [AC4] Render Muse commands (bash `command` in `tool.result` text JSON, `edit_facts.path`, read_file path) and messages (flushed `run.output.delta`), keeping tool output out.
- [x] T003 [AC5] Extend `--self-test` with multi-line message, over-pane line, and a recorded Muse Code stream; update the first-line-only control; verify each new control fails on BASE.
- [x] T004 [AC1] [AC2] [AC3] Update pane-view prose in `harnesses.md`, `hosts.md`, `README.md`.
- [x] T005 [AC6] Run the extended self-test and the project gate; record results for the summary.
