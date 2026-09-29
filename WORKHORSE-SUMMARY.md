# Workhorse summary: #122 Watcher takes mechanical steps

## Built

- `89a0734` — Write #122 workhorse spec.
- `74a782a` — Add watcher harness stream adapters.
- `05c7b6e` — Let watcher dispatch and remount runs.

The watcher now dispatches the checked next leg and resumes a leg only when the adapter recognizes the recorded model stream idle timeout. It persists per-leg resume attempts in `watcher.json`, logs each action, and wakes the postmaster for judgment cases or incomplete steps. The runbook describes the new division of work. The watcher self-test records host launches in a stub, so its controls exercise the action paths without starting agent threads.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0.
  - Printed: `gate: pass, exit 0, 810s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `scripts/launch.sh --self-test` — exit 0.
- `scripts/runs-watch.sh --self-test` — exit 0.
- `bash -n scripts/runs-watch.sh && bash -n scripts/launch.sh && scripts/skill-refs.sh && scripts/wiki-lint.sh && git diff --check` — exit 0.

## Decisions

- The adapter names `model stream idle timeout` as the only retryable provider error. It reads durable error and event records and ignores matching text in user prompts. Generic timeouts, quota or provider walls, and launch refusals stay with the postmaster.
- Resume attempts are stored per leg in `watcher.json` and recorded before attempting a resume. A failed resume wakes the postmaster and is not retried by the watcher. The fourth matching end wakes the postmaster without another attempt.
- A held run is checked before any watcher action or state change. The held controls assert that dispatch and resume leave markers, manifests, logs, and watcher state untouched.
- No new script was needed; implementation stays in `runs-watch.sh` and its `launch.sh` adapter.

## Not done

- Nothing in the ticket was deferred. I did not push the branch, as required for this lane.

## Acceptance criteria

- AC1 — Met. A valid hand-off dispatches the next listed leg, updates its manifest, and logs that the watcher took the step; incomplete checks wake the postmaster.
- AC2 — Met. Named transient ends resume on the recorded thread with the remount prompt, up to three persisted attempts per leg, and each resume is logged.
- AC3 — Met. Escalations, cards, walls, refusals, inspection, exhausted retries, and incomplete watcher steps remain visible to the postmaster.
- AC4 — Met. Held runs are left untouched.
- AC5 — Met. Self-tests control each action and wake case, and verify held dispatch and resume paths leave the run unchanged without launching agent threads.
