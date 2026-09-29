# Workhorse spec: 57 A leg's launch, resume and takeover are run by a script that records how each ended

## Summary

Replace hand-written leg launch, resume and takeover plumbing with `host.sh` leg commands that own the stream, markers and structured attempt outcome, then make polling decisions from those outcomes.

## Technical context

- **Language and version**: Bash, with Python 3.11 for structured records.
- **Dependencies used or added**: Existing shell and Python dependencies only.
- **Testing**: `scripts/host.sh --self-test`, `scripts/launch.sh --self-test`, `scripts/runs-status.sh --self-test`, the affected watcher self-test, and the project gate through `scripts/verify.sh run .`.
- **Constraints**: Keep the leg wrapper in `scripts/host.sh` or beside it; do not infer outcomes from `.err`; keep harness forms in `launch.sh` and `harnesses.md`; every counted outcome needs positive and negative controls; runbooks must not assemble leg markers, redirects or stream paths.

## Direction check

- The launch, resume and takeover workflow will be one `host.sh` command surface, built on the existing host so every leg keeps the selected session host.
- Harness invocation and thread behavior remain in `launch.sh` and `harnesses.md`; outcome signaling is structured and independent of `.err` prose.
- `runs-status.sh` will map recorded outcomes to next actions. The prose REMOUNT classifier will be removed from `postmaster.md`.
- Runbooks will call the leg command with the prompt and role inputs; the script will derive attempt files, markers and stream paths.
- User-waiting index maintenance will be scripted. Each user-facing outcome will say what to do after the answer, including retrying a refused resume with its original prompt.

## Structure

- Extend `scripts/host.sh` with leg launch, resume and fallback takeover operations, lifecycle state and a controlled self-test.
- Extend `scripts/launch.sh` to expose structured information that distinguishes pre-harness refusal from a harness exit, including env-file load failure.
- Update `scripts/runs-status.sh` and `scripts/runs-watch.sh` to consume the attempt record and report the next action; maintain the user-waiting list mechanically.
- Update `skills/postmaster/postmaster.md`, `skills/postmaster/hosts.md` and `skills/postmaster/harnesses.md` to document and use the script contract, including user-answer follow-through.
- Update `skills/postmaster/controls.md` and affected script fixtures/self-tests to describe and control the new outcome records.

## Complexity tracking

None.

## Decisions

- Store the latest leg attempt as a structured record under the dispatch, with a fixed outcome: `refused`, `pre-thread`, `walled`, `incomplete` or `finished`.
- Treat a pre-harness refusal, including an env file that fails while loading, as `refused`; treat a started harness that exits before a thread id as `pre-thread`.
- Derive wall state from structured launch/stream signals, never by reading `.err`; a wall on a primary leg routes to fallback takeover, while a fallback wall routes to the user.
- Have the status poll regenerate the waiting-run index from waiting markers so the postmaster does not maintain that list by hand.
- Preserve a refused resume's prompt and inputs so the postmaster can retry that same delivery after the user answers.

## Tasks

- [ ] T001 [P] [AC1] Add the single leg launch/resume/takeover command and marker, stream and attempt-record ownership in `scripts/host.sh`.
- [ ] T002 [P] [AC2] Add structured pre-harness and harness-start signaling in `scripts/launch.sh`, with outcome controls in its self-test.
- [ ] T003 [AC3] Make `scripts/runs-status.sh` choose next actions from attempt records and replace REMOUNT coverage in `scripts/runs-watch.sh` tests.
- [ ] T004 [AC4] Document the post-answer action, including replaying a refused resume prompt, in `skills/postmaster/postmaster.md` and `skills/postmaster/hosts.md`.
- [ ] T005 [AC5] Route primary walls to scripted fallback takeover and fallback walls to the user, with controls before and after the first stream event in `scripts/host.sh` self-tests.
- [ ] T006 [AC6] Regenerate the waiting-run list from scripts and remove manual list editing from `skills/postmaster/postmaster.md`.
- [ ] T007 [AC7] Add positive and negative controls for each outcome, env-file load failure, and refusal of a resume after a thread id exists across `scripts/host.sh`, `scripts/launch.sh` and `scripts/runs-status.sh`.
- [ ] T008 [AC1] Document the outcome record and harness boundary in `skills/postmaster/harnesses.md` and `skills/postmaster/controls.md`.
