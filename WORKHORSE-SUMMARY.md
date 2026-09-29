# Workhorse summary: 122 The watcher takes the steps that need no judgment

## Commits

- `05941a7` 122: workhorse spec for the watcher taking mechanical steps
- `5922f73` 122: name transient provider errors and thread ids in the harness adapter
- `817000e` 122: the watcher dispatches and resumes the mechanical steps, and wakes only for judgment
- `73de8a6` 122: tick the workhorse tasks done

## What was built

- `scripts/launch.sh` gained two adapter commands: `thread-id <events-file>` (the thread id a
  stream records, from its shape: claude `session_id`, codex `thread_id`, pi `session.id`,
  muse `stream.id`, mimo `sessionID`) and `transient <err-file> [<stream-file>]` (exit 0 when
  a leg's end is a transient provider error the adapter names). `skills/postmaster/harnesses.md`
  documents both, with the transient set as a table.
- `scripts/runs-watch.sh` now takes the mechanical steps itself before it wakes anyone:
  - **Dispatch (AC1):** on `.leg-<n>-done` with a hand-off that passes `handoff-check.sh` and a
    next leg from `turnpikes.sh legs`, it writes the leg prompt, launches through
    `host.sh`/`launch.sh` with `--run`, records the thread id and `leg` in the manifest, and
    logs `dispatch` through `log-action.sh` with `the watcher took it` in the detail.
  - **Resume (AC2):** on a REMOUNT whose end `launch.sh transient` names, with a thread id and
    a watcher-resume count under three, it writes the remount prompt, resumes on the leg's own
    thread, bumps `<run>/.leg-<n>-watch-resumes`, clears the exited marker, and logs `resume`.
  - Anything else is named and the postmaster is woken (AC3). A held run is never touched (AC4).
- `skills/postmaster/postmaster.md` Stage D now says the watcher takes those two steps and
  names only what needs judgment or what it could not complete; Stage C notes the watcher may
  take a dispatch.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed:

```
gate: pass, exit 0, 716s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other commands run, with exit:

- `bash -n scripts/*.sh` — 0
- `scripts/skill-refs.sh` — 0
- `scripts/wiki-lint.sh` — 0
- `scripts/launch.sh --self-test` — 0 (includes the new `thread-id` and `transient` controls)
- `scripts/runs-watch.sh --self-test` — 0 (includes the new step and wake controls)

The first full gate run hit the known `review-round.sh` timing flakes and stopped there; the
re-run, as the brief says to judge by, was clean through that script and the rest of the suite.
`style-findings.sh --self-test` alone is slow enough that a single chained run can outlast a
ten-minute tool cap; run alone it exits 0, and `verify.sh run .` on the same tree passes the
whole gate in 716s.

## Decisions

1. **Repo path source.** The watcher reads `repo` from the run's `checks.json`, written at
   dispatch by `verify.sh record`; the worktree is `<repo>/.worktrees/<TICKET>`. A run with no
   usable `checks.json` is a step it cannot complete, so it wakes.
2. **Thread-id extraction is adapter work.** `launch.sh thread-id` detects the event shape.
   The watcher never parses stream formats itself.
3. **Transient provider-error set.** Enumerated in `launch.sh` and `harnesses.md`: model
   stream idle timeout; gateway failure (bad gateway, service unavailable, gateway timeout,
   overloaded / 502 / 503 / 504 / 529); stream drop (stream disconnected, SSE error,
   connection reset/aborted, broken pipe). Quota, 402, 429, usage-limit and `launch:` text is
   never transient.
4. **Resume cap.** Three watcher resumes per leg; the count is `<run>/.leg-<n>-watch-resumes`.
   A fourth transient end wakes. The count is of watcher-taken resumes only.
5. **Who logs.** The watcher writes the `log-action` line after a successful step (actor
   `postmaster`, detail `the watcher took it: …`) so the control sees the real log.
6. **Stub surface.** `POSTMASTER_WATCH_TAKE` replaces only the host/launch invocation; its
   stdout is the thread id and its exit is the step's. Prompts, manifest updates, count bumps,
   marker clears and logging are real. This is how the self-test proves each step without
   starting an agent thread: the control runs `runs-watch.sh` itself and asserts the stub was
   called (or not) plus the log line and count file.
7. **DISPATCH with no next leg wakes.** After the ship leg there is no next leg; that is
   Stage G, the postmaster's close.
8. **Hand-off check failure wakes.** Not the Stage C step-2 recovery (remove marker, resume
   leg `p`): that is judgment about an unfinished leg, so the watcher names it.
9. **USER still does not wake.** It is not in AC3's list; the question is already with the
   user. WAIT and `-` do not wake, as today.
10. **The exited marker goes when a resume is taken.** Otherwise the next look remounts a leg
    that is already running. `host.sh` clears it as the launch starts and touches it when the
    process exits, so a resume that dies again is remounted again, bounded by the count.

## Not done

- **No new script.** The gate's self-test list is unchanged; `launch.sh` and `runs-watch.sh`
  carry the new work.
- **Stage C step 2's recovery is not in the watcher.** On a failed hand-off check the watcher
  wakes the postmaster rather than removing the marker and resuming the previous leg. That
  path is judgment and is left in Stage D's DISPATCH case.
- **`runs-status.sh` is unchanged.** The NEXT vocabulary is the same; the watcher interprets
  DISPATCH and REMOUNT more narrowly and takes those steps when it can.
- **No wiki page.** The ticket is a flow change, not a finding about a harness or a service;
  the adapter's own comments and `harnesses.md` carry the set.

## Acceptance criteria

1. **Met.** On a done marker with a hand-off that passes `handoff-check.sh`, the watcher
   dispatches the next leg `turnpikes.sh legs` lists (prompt, `host.sh`/`launch.sh` with
   `--run`, thread id and `leg` recorded) and logs `dispatch` with `the watcher took it` in
   the detail. Hand-off failure, `turnpikes.sh legs` non-zero, no next leg, and a launch it
   cannot complete wake the postmaster.
2. **Met.** On a transient provider error `launch.sh transient` names (model stream idle
   timeout among them), the watcher resumes the leg on its own thread with the remount
   prompt, at most three times per leg (count in the dispatch directory), and logs `resume`.
   A fourth such end wakes. Non-transient ends (quota, wall, launch refusal, no thread id)
   wake as today.
3. **Met.** Escalation (RULE), checkpoint card (READ), ship card (GATE), quota or provider
   wall, launch refusal, INSPECT, and any step the watcher could not complete all still wake
   the postmaster; none is taken, retried or swallowed.
4. **Met.** A run listed as held is left alone entirely: no dispatch, no resume, no count,
   no wake. The held list is read on every look.
5. **Met.** The self-test has a positive control for dispatch taken and resume taken, a wake
   control for each AC3 member, and a negative control that a held run is left alone. Each
   runs `runs-watch.sh` itself with `POSTMASTER_WATCH_TAKE` stubbed, so no agent thread is
   started; the control proves the step by the stub's argv, the `log-action` line and the
   count file, and proves a wake by the `needs` line and a non-zero stub never being called.
