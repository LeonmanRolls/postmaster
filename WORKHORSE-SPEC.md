# Workhorse spec: #112 Show full headless agent messages and commands in panes

## Summary

Render every agent message and command in full, wrapping it to the pane width, and teach the Muse Code adapter to expose its message and command text from the event stream.

## Technical context

- **Language and version**: Bash entry point with embedded Python 3.
- **Dependencies used or added**: Python standard library only.
- **Testing**: `scripts/view-stream.sh --self-test`, then the worktree verification gate.
- **Constraints**: Keep the script path, arguments, exit codes and event framing; keep tool output out; use only this worktree; never push.

## Direction check

- Preserve complete message and command text, including line breaks, and wrap long lines to the pane's available width without ellipses.
- Keep tool results, thinking, hooks and streaming deltas out of the view.
- Render Muse Code messages and commands only from its event stream shapes; the Muse trial summaries contain no complete JSONL stream, so any fixture must use the event types already recorded in the trial and the existing adapter's observed fields.
- Keep the implementation harness-aware only in the stream adapter, with deterministic behavior in `scripts/view-stream.sh` and no new dependencies.
- Add positive and negative controls that demonstrate the prior truncation behavior, and run the gate after committing the implementation.

## Structure

- Change `scripts/view-stream.sh` to preserve and wrap message and command content, render Muse Code text and commands, and extend its self-test.
- Add the focused recorded Muse Code stream fixture at `scripts/fixtures/view-stream/muse.jsonl`; update the pane-view descriptions in `README.md`, `scripts/host.sh`, `skills/postmaster/hosts.md`, and `skills/postmaster/harnesses.md`.
- Add this spec and a final `WORKHORSE-SUMMARY.md` at the worktree root.

## Decisions

- Use Python's standard library to wrap output at the terminal width available to the follower, leaving room for its timestamp; non-follow output keeps a fixed display width.
- Keep compact summaries for errors and run metadata; full-text treatment applies to messages and commands.
- The committed Muse trial records event summaries rather than a complete stream. Capture focused events from a constrained local `muse exec --json` run for the self-test fixture; do not claim a raw trial contains JSONL it does not preserve.
- The live Herdr pane check belongs to the coachman after synthesis; this lane will verify the follower's output and document that limit.

## Tasks

- [x] T001 [P] [AC1] Wrap every message in full, preserving all its lines, in `scripts/view-stream.sh`.
- [x] T002 [P] [AC2] Wrap every command in full, preserving all its lines, in `scripts/view-stream.sh`.
- [x] T003 [AC3] Render Muse Code messages and command text from its established event records in `scripts/view-stream.sh`.
- [x] T004 [AC4] Keep tool output out of the pane and retain its negative control in `scripts/view-stream.sh`.
- [x] T005 [AC5] Add multiline, over-width and Muse Code stream controls to `scripts/view-stream.sh --self-test`, and show each fails against the baseline behavior.
- [x] T006 [AC6] Keep the `--follow` pane path using the full-text renderer and verify it with a growing stream in `scripts/view-stream.sh --self-test`.
