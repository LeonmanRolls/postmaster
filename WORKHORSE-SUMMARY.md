# Workhorse summary: #57, a leg's attempts are scripted and recorded

## Built

- Added `host.sh leg launch|resume|takeover|retry` to own each leg's stream, markers, live wall detection, saved retry inputs, and JSONL attempt history.
- Added a launch phase signal so pre-harness refusals, including env-file failures, remain distinct from harness exits.
- Changed `runs-status.sh` to map recorded outcomes to `ASK`, `TAKEOVER`, `RESUME`, or `DISPATCH`, inspect unknown records, and regenerate `postmaster/waiting` from run markers.
- Replaced the postmaster's prose REMOUNT classification with recorded-outcome actions, including retrying a refused resume with its saved prompt and thread.
- Updated host and harness documentation, the control table, README command index, and the affected `log-action.sh` self-test fixture.

## Commits

- `a1d429f #57, record leg attempt workhorse spec`
- `01c00cc #57, script leg attempts and status`
- `0fdf2ce #57, update the unlisted control fixture`

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` from the worktree root — exit 0; printed: `gate: pass, exit 0, 718s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action plane project-settings review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `scripts/launch.sh --self-test` — exit 0.
- `scripts/runs-status.sh --self-test` — exit 0.
- `scripts/runs-watch.sh --self-test` — exit 0.
- `scripts/log-action.sh --self-test` — exit 0.
- `bash -n scripts/host.sh scripts/launch.sh scripts/runs-status.sh scripts/runs-watch.sh` — exit 0.
- `/home/brindlewick/postmaster/scripts/skill-refs.sh /home/brindlewick/postmaster/.worktrees/57-luna/skills/postmaster/*.md` — exit 0.
- `git diff --check` — exit 0.
- An earlier `verify.sh run .` exited 2 because the `log-action.sh` negative fixture still treated `launch.sh` as unlisted after it was added to the control table. Commit `0fdf2ce` updates the fixture; the final gate above passes.

## Decisions

- Store every attempt as an appended JSONL record and let status read the latest record. The fixed outcomes are `refused`, `pre-thread`, `walled`, `incomplete`, and `finished`.
- Keep the phase `refused` until env loading succeeds and the configured harness remains callable; mark it `started` immediately before invoking the harness.
- Detect walls from stderr as it streams to the log and from structured harness error events. The classifier never opens `.err`, and assistant prose alone is not a wall.
- Route a primary wall to fallback takeover and a fallback wall to the user. Retry uses the saved prompt, thread id, and role.
- Treat missing or unrecognized outcome data, and a wall with an unrecognized role, as `INSPECT` instead of guessing a next action.
- Have `runs-status.sh` atomically regenerate `postmaster/waiting` from non-closed runs carrying `.waiting-on-user`.

## Not done

- No fixture run: this change does not alter the coachman contract in `coachman.md`.
- No push, as instructed.

## Acceptance criteria

- AC1 — Met. The `host.sh leg` command owns launch, resume, takeover, marker and stream handling, and attempt records.
- AC2 — Met. Attempts record only the five fixed outcomes, with phase signaling separating launch refusals from harness exits.
- AC3 — Met. `runs-status.sh` maps attempt records to next actions, and the REMOUNT rules are removed from `postmaster.md`.
- AC4 — Met. ASK instructions state the action after the user answers; retry replays a refused resume's prompt and thread.
- AC5 — Met. Host controls cover primary walls before and after the first event and route fallback walls to the user.
- AC6 — Met. `runs-status.sh` maintains the generated waiting-run list.
- AC7 — Met. Self-tests cover each outcome, env-file load failure, a refused resume with an existing thread id, and positive and negative classification controls.
