# Workhorse spec: 122 The watcher takes the steps that need no judgment

## Summary

The watcher (`scripts/runs-watch.sh`) currently waits and names; it wakes the postmaster for
every DISPATCH and REMOUNT even when the next step is mechanical. This change makes the watcher
take those steps itself — dispatch the next leg when the hand-off checks out (AC1), resume a leg
that ended on a named transient provider error (AC2) — and wake the postmaster only for
decisions and for any step it could not complete (AC3). A held run is never touched (AC4). The
self-test grows controls for each step and each wake case (AC5).

## Technical context

- **Language and version**: bash with Python in heredocs (the repo's standing shape); Python 3.11+
- **Dependencies used or added**: none new. `runs-watch.sh` already calls `runs-status.sh`;
  it will also call `handoff-check.sh`, `turnpikes.sh`, `host.sh`, `launch.sh` and
  `log-action.sh`, all already in `scripts/`.
- **Testing**: `scripts/runs-watch.sh --self-test` (the new controls), `scripts/launch.sh
  --self-test` (the new adapter commands), then the project gate
  (`bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh &&
  scripts/wiki-lint.sh && …'`), and `/home/brindlewick/postmaster/scripts/verify.sh run .`
- **Constraints**:
  - Nothing harness-specific in the flow: transient provider errors and thread-id shapes are
    named in the adapter (`launch.sh` + `harnesses.md`), never re-derived in the watcher.
  - Deterministic work in `scripts/`, not prose.
  - Every count needs a control; the self-test must not launch real agent threads.
  - Script paths in runbooks go through `<tool>`.
  - Log every taken step through `log-action.sh` with a detail saying the watcher took it.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Watcher takes mechanical steps itself and logs them (ticket direction) | `runs-watch.sh` gains take-dispatch and take-resume paths; each logs `dispatch`/`resume` via `log-action.sh` with "the watcher took it" in the detail |
| Postmaster woken only for decisions | Only RULE, GATE, READ, INSPECT, non-transient REMOUNT, over-cap resume, DISPATCH with no next leg, and any failed step print `needs` lines and exit 0 |
| Transient-error naming in the adapter | New `launch.sh transient` enumerates the set; `harnesses.md` documents it; the watcher calls the script |
| Detect from the durable record, never prompt text | `launch.sh transient` reads the leg's `.err` and stream tail only |
| Resume count survives a watcher restart | Count file per leg in the dispatch directory (`.leg-<n>-watch-resumes`) |
| Hand-off check failure / `turnpikes.sh legs` non-zero wake, not silent | `try_dispatch` returns "wake" on either; recorded as a step it could not complete |
| Held run left alone entirely | Held check before any take-step; the negative control shows no stub call and no wake |
| Self-test controls run, no real agent threads | `POSTMASTER_WATCH_TAKE` stages the launch; the control runs `runs-watch.sh` itself and asserts the stub was called (or not) plus the log line |
| Every count has a positive and a negative control | New self-test section: dispatch taken, resume taken, each AC3 wake case, held left alone |
| Nothing repo-specific | Repo path is read from the run's own `checks.json` (written at dispatch); worktree is `<repo>/.worktrees/<TICKET>` |
| Nothing harness-specific in the flow | Thread-id shapes and transient strings live in `launch.sh`, with `harnesses.md` changed together |
| Script paths through `<tool>` | `skill-refs.sh` after the runbook edits; no bare `scripts/` paths added |

## Structure

- `scripts/launch.sh` — new adapter commands `thread-id <events-file>` and `transient
  <err-file> [<stream-file>]`, with self-test controls. `harnesses.md` changes with it.
- `scripts/runs-watch.sh` — take-dispatch / take-resume, held check before steps, resume
  count in the dispatch directory, `POSTMASTER_WATCH_TAKE` staging hook, new self-test
  controls (AC5), updated header.
- `skills/postmaster/postmaster.md` — Stage D: the watcher takes mechanical steps and names
  only what needs the postmaster; Stage C notes the watcher may take a dispatch.
- `skills/postmaster/harnesses.md` — the transient provider-error set and thread-id shapes,
  as the adapter names them.

No new script is added, so the gate's self-test list is unchanged.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `POSTMASTER_WATCH_TAKE` hook | AC5 forbids launching real agent threads in the self-test, but the control must run the same command the watcher runs | Dry-run flag would not be the identical command; PATH stubs cannot reach `$HERE/host.sh` |

## Decisions

1. **Repo path source.** `checks.json` (written by `verify.sh record` at dispatch) carries
   `repo`. The synthesis worktree is `<repo>/.worktrees/<TICKET>`. Missing `checks.json` or
   missing `repo` is a step the watcher cannot complete → wake.
2. **Thread-id extraction.** New `launch.sh thread-id <events-file>` detects the event shape
   (claude `session_id`, codex `thread_id`, pi `session.id`, muse `stream.id`, mimo
   `sessionID`) and prints the first id. Harness-specific knowledge stays in the adapter.
3. **Transient provider-error set.** Enumerated in `launch.sh transient` and documented in
   `harnesses.md`: model stream idle timeout; gateway failures (bad gateway, service
   unavailable, gateway timeout, overloaded / 529); stream drops (stream disconnected, SSE
   error, connection reset/aborted, broken pipe). Quota, 402, 429, usage-limit and launch
   refusals are never transient.
4. **Resume cap.** Three watcher resumes per leg; the count lives in
   `<dispatch>/.leg-<n>-watch-resumes`. A fourth transient end wakes the postmaster. The
   count is of watcher-taken resumes only.
5. **Who logs.** The watcher itself writes the `log-action` line after a successful step, so
   the control sees the real log. Actor stays `postmaster`; the detail carries "the watcher
   took it".
6. **Stub surface.** `POSTMASTER_WATCH_TAKE` replaces only the host/launch invocation. Prompts,
   manifest updates, count bumps and logging are real. The stub prints a thread id (dispatch)
   and exits 0, or exits non-zero to simulate a launch failure.
7. **DISPATCH with no next leg.** After the ship leg there is no next leg; that is the
   postmaster's close (Stage G), so it wakes — it is judgment, not a mechanical dispatch.
8. **Hand-off check failure.** Not the Stage C step-2 recovery (remove marker, resume leg `p`);
   the watcher wakes the postmaster. That recovery is judgment about an unfinished leg.
9. **USER still does not wake.** It is not in AC3's list; the question is already with the
   user. WAIT and `-` do not wake, as today.

## Tasks

- [ ] T001 [P] [AC2] `scripts/launch.sh`: add `thread-id` and `transient` adapter commands
  with self-test controls; `skills/postmaster/harnesses.md` documents the transient set and
  the thread-id shapes.
- [ ] T002 [AC1] `scripts/runs-watch.sh`: take-dispatch path — hand-off check, `turnpikes.sh
  legs`, leg prompt, launch through `host.sh`/`launch.sh`, thread id and `leg` recorded,
  `dispatch` logged with "the watcher took it"; failures wake the postmaster.
- [ ] T003 [AC2] `scripts/runs-watch.sh`: take-resume path — transient check via
  `launch.sh transient`, remount prompt, resume on the leg's own thread, count file in the
  dispatch directory (max 3), `resume` logged; fourth end and non-transient wakes.
- [ ] T004 [AC3] `scripts/runs-watch.sh` + `skills/postmaster/postmaster.md` Stage D: every
  judgment case still wakes (RULE, GATE, READ, INSPECT, quota/wall, launch refusal, and any
  step the watcher could not complete); Stage D describes the watcher taking steps.
- [ ] T005 [AC4] `scripts/runs-watch.sh`: held check before any take-step; a held run is left
  alone entirely.
- [ ] T006 [AC5] `scripts/runs-watch.sh --self-test`: positive control for dispatch taken and
  resume taken; a wake control for each AC3 member; negative control that a held run is left
  alone; the controls run `runs-watch.sh` with `POSTMASTER_WATCH_TAKE` stubbed.
- [ ] T007 [P] [AC1] [AC2] [AC3] [AC4] [AC5] Run the gate and `verify.sh run .`; write
  `WORKHORSE-SUMMARY.md`.
