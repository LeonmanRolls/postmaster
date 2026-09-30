# Workhorse spec: #160 Record harness token usage and cost

## Summary

Record each lane, reviewer and coachman launch's reported token usage and cost from its harness stream, then summarize those records when the run closes.

## Technical context

- **Language and version**: Bash with Python 3.11 for stream parsing, consistent with the repository scripts.
- **Dependencies used or added**: No new dependencies.
- **Testing**: Per-harness recorded-stream controls in `scripts/usage.sh --self-test`; integration self-tests for launch recording and terminal summaries; the project gate.
- **Constraints**: Usage must come from each harness's event stream or session record. Missing figures remain missing and must never be presented as zero.

## Direction check

The ticket requires native harness-reported input tokens, output tokens and cost, with no estimation from text length. The parser will read each harness's own event or session fields and leave unreported fields absent. The project rules keep harness-specific interpretation in an adapter, deterministic aggregation in a script, and every reported count under positive and negative controls. Each launch's usage record will be logged with the run's action log.

## Structure

- Add `scripts/usage.sh` to read usage from each supported harness stream, append per-launch records to `<dispatch>/usage.jsonl`, and build the terminal summary.
- Add recorded positive and negative streams under `scripts/fixtures/usage/` for every harness supported by `skills/postmaster/harnesses.md`.
- Update `scripts/launch.sh` to record completed launch usage, and `scripts/host.sh` to pass the launch role into that record.
- Update `scripts/stage.sh` to append per-role and per-lane totals, plus harnesses with no reported usage, when a run enters a terminal stage.
- Update `scripts/log-action.sh` for the usage record action and `skills/postmaster/harnesses.md` to document each harness's usage source.

## Decisions

- Store one append-only JSONL record per launch in the run directory so separate roles, lanes, resumes and missing reports remain attributable.
- Identify a launch by role and lane or coachman leg, and retain its harness name; the same lane may run as a workhorse and as a reviewer.
- Summarize the recorded launches in `run-log.md` when the run enters `done` or `abandoned`, including an explicit list of harnesses that reported no usage. Do not invent totals for absent fields.
- Cover every harness currently documented in `skills/postmaster/harnesses.md` with a usage and a no-usage recorded-stream control.

## Tasks

- [ ] T001 [P] [AC3] Add per-harness usage readers and recorded positive and negative controls in `scripts/usage.sh` and `scripts/fixtures/usage/`; document the native usage sources in `skills/postmaster/harnesses.md`.
- [ ] T002 [AC1] Pass launch role metadata through `scripts/host.sh` and record reported token and cost fields per launch from its event stream in `scripts/launch.sh` via `scripts/usage.sh`, logging the record through `scripts/log-action.sh`.
- [ ] T003 [AC2] Aggregate usage by role and lane and append the terminal summary, preserving absent fields and naming harnesses with no report, through `scripts/stage.sh` and `scripts/usage.sh`.
