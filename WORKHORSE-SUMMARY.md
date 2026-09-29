# Workhorse summary: #85 Self-test controls that fail at random

## Built

- `scripts/host.sh` now waits for the launch PID file before signaling and then waits up to 60 seconds for the completion marker. Its self-test records why the old PID-file and marker windows raced under load.
- `scripts/review-round.sh` self-tests now wait for output and saved-deadline events with bounded polling. The stale-round control starts its reviewer before the deadline and verifies the earlier waiter read the old attempt while time remained. Its fixture gives teardown a 30-second stop grace.
- Self-test output checks across the affected scripts read captured output or here-strings instead of sending it through `grep -q` pipelines. `scripts/front-door-acceptance.sh` now reproduces the old `pipefail`/SIGPIPE race and checks the captured-output form.

## Commits

- `2b3ca7b #85, record workhorse plan` — adds `WORKHORSE-SPEC.md` as its own commit.
- `baa9842 #85, wait on self-test events and full pipe input` — updates host and review timing controls, output checks, and the SIGPIPE reproducer.
- `eee13bd #85, start stale-round waiter before deadline` — removes the reviewer startup from the stale-round deadline window.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0. Printed: `gate: pass, exit 0, 792s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- Timing stress runner — exit 0. Host and review-round each completed 50 consecutive timing-control passes while `front-door-acceptance`, `launch`, `local`, and `turnpikes` self-test loops ran concurrently. The auxiliary loops completed 150, 54, 31, and 160 passes, with no failures. Earlier attempts had one SIGTERM interruption in each target suite; the final runner reset each streak and reached 50 consecutive passes.
- `scripts/host.sh --self-test` and `scripts/review-round.sh --self-test` — exit 0 in focused runs.
- `scripts/tool-faults.sh --self-test` — exit 0 on a clean standalone rerun.
- `bash -n scripts/*.sh && git diff --check` — exit 0.
- Initial `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 2; its gate exited 1 after 663 seconds because four dependent `tool-faults.sh` harvest checks saw four faults instead of five. The clean standalone rerun passed. No `tool-faults.sh` change was made because it is outside this ticket's change scope.
- Intentional negative controls — exit 1 as expected when the host marker watcher was disabled, the review wait reset the round deadline, or the stale-round guard was removed. The original implementations were restored before commit.
- The `front-door-acceptance.sh` SIGPIPE reproducer — passed as part of its self-test; the old pipeline fails under `pipefail`, while full capture and a here-string pass.

## Decisions

- The host marker bound is 60 seconds, after observing the PID-file event. `host.sh run` has its own 10-second PID-file wait; the former control then used a separate 10-second marker window. Under load, the first wait could expire before the caller had a PID to signal, and the second window could expire before the launch completed.
- The review fixture uses a 30-second stop grace because its old two-second TERM grace could expire while a loaded host scheduled the stopped process tree. Retry and stale-round controls now wait for progress or saved-deadline events; their polling intervals do not decide the result.
- The stale-round fixture starts its reviewer before starting the clock. Previously the two-second deadline began before reviewer startup, so process scheduling could consume the whole window before the waiter read the round state.
- The stress load uses `front-door-acceptance`, `launch`, `local`, and `turnpikes`. `tool-faults` was excluded after its unrelated harvest control failed once during load; its clean standalone rerun passed.
- The race reproducer writes a matching line followed by 16 MiB, making the producer's SIGPIPE under the old `grep -q` pipeline observable with `pipefail`.

## Not done

- No production host or review guarantee was changed; the edits address self-test controls and output checks, as directed.
- No fix was made to `tool-faults.sh`; its intermittent harvest result is outside this ticket's change scope.
- No pull request was opened from this lane. The timing causes are recorded in source comments and here for the coachman to carry into the pull request description.

## Acceptance

- AC1: Causes and the exact waits are recorded in source comments and this handoff. The eventual pull request description still needs to carry these notes.
- AC2: Met. Both timing suites completed 50 consecutive passes while four other self-test loops ran concurrently.
- AC3: Met. The host marker guarantee, review deadline preservation, and stale-round guard each failed under an intentional mutation.
- AC4: Met. Controls wait on PID-file, marker, output, or saved-deadline events with bounded polling; no fixed sleep decides success.
- AC5: Met. Self-test `grep -q` checks no longer consume breakable output pipelines, and the old SIGPIPE race is reproduced in a control.
