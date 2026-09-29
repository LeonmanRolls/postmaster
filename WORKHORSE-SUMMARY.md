# Workhorse summary: 85 Self-test controls that fail at random

## Commits

- `eb6a653` Workhorse spec: 85 self-test timing and grep -q pipe race
- `a65aca5` Self-tests read output without a pipe that can break under pipefail
- `fe610ef` Control reproduces the grep -q pipe race on the old form and passes on the new
- `12ca7e9` Timing controls wait on the events they depend on, behind generous bounds
- `8e1f013` The late-pane control waits for the late start's event, not a fixed window
- `c6bf8b1` Every self-test marker wait is event-based behind a generous 60s bound
- `de02f4e` The report/release control waits for the release call to land

## Causes of each timing failure (for the pull request)

**host.sh, "its runner and the launch killed outright: the marker still lands".**
The control relied on two windows that are not events. `host.sh run` itself waits at most
10 seconds (40 × 0.25s) for the launch's pid file, then returns either way. The control
then `cat`s that pid file and SIGKILLs the pane's and the launch's process groups. On a
busy machine the runner can take longer than 10 seconds to consume its spec and write the
pid, so the kill lands on an empty or wrong pgid and the `sleep 60` launch keeps running;
its `watch_exit` watcher never sees the pid die and the marker does not land. The control
then waited only a further 10 seconds for that marker, which `watch_exit` (a double-forked
Python polling every 0.5s) can also miss when Python startup and scheduling are slow. Either
window running out first looks exactly like a marker that "failed to land". The fix makes
the control wait for the pid file as an event after `run` returns, and gives the marker 60s.

**review-round.sh, "a wait run again keeps the round's deadline rather than starting a new one".**
The control coordinated four fixed windows: `limit 4`, `timeout 1` on the first wait,
`sleep 1` before the second, and `took <= 3` as the pass bound. Under load `run start` plus
`launch` can eat most of the 4s deadline before the first wait begins; `timeout 1` can kill
the first wait before it has recorded anything; `sleep 1` oversleeps; and process-startup
overhead inflates `took` past 3 even when the deadline was kept. A different set of wait
and teardown controls flaked the same way: `sleep 0.5` before restarting the round could
fire before the stale wait had read its attempt, so the stale wait would not stand down,
and `! alive` ran before a stopped process was reaped. The fix waits for the stale wait to
announce itself (`round 4,`) before restarting, reads the state's `attempt` and `deadline`
directly to prove they were kept, and waits for process death as an event.

**grep -q under pipefail.** `printf ... | grep -q` under `set -o pipefail` races SIGPIPE:
`grep -q` exits on its first match, the writer takes SIGPIPE (141), and pipefail reports
the writer's failure although the text matched. `seq 1 100000 | grep -q 1` reproduces it
reliably; a short `printf` often finishes before `grep` exits and hides it. The form sat in
the self-tests of 17 scripts. `front-door-acceptance.sh` carried it through a gate on 2026-09-29
with exactly the expected output. Every self-test check now feeds `grep` a herestring.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed, just before this summary:

```
gate: pass, exit 0, 646s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
EXIT:0
```

| Check | Command | Exit |
|---|---|---|
| gate (the brief's named check) | `/home/brindlewick/postmaster/scripts/verify.sh run .` | 0 |

Other commands run, with exit:

| Command | Exit | Notes |
|---|---|---|
| `bash -n scripts/*.sh` (each file) | 0 | syntax |
| `scripts/skill-refs.sh` | 0 | |
| `scripts/wiki-lint.sh` | 0 | |
| `scripts/front-door-acceptance.sh --self-test` | 0 | includes the pipe-race control |
| `scripts/review-round.sh --self-test` × 50 under load | 0 × 50 | see soak below |
| `scripts/host.sh --self-test` × 50 under load | 50 × 0 on the named control | 5 runs failed other controls; see soak below |
| Teeth: `watch_exit` disabled → host.sh --self-test | 1 | "the marker still lands" failed |
| Teeth: wait resets the deadline → review-round.sh --self-test | 1 | deadline-kept failed |
| Teeth: attempt check removed → review-round.sh --self-test | 1 | stand-down failed |
| `seq 1 100000 \| grep -q 1` under pipefail | 141 | old form reproduces the race |
| `grep -q 1 <<<"$(seq 1 100000)"` under pipefail | 0 | new form never breaks |

### Soak (AC2): 50 runs under concurrent load

Two parallel sequences of 50 self-tests each, while four loader loops ran
`tool-faults`, `local`, `fixture`, `front-door-acceptance`, `ticket-check`,
`style-findings`, `link-skills`, `github`, `cut-scratch`, `launch`,
`parallel-runs-acceptance`, `wiki-lint`, `verify`, `verify-journey`, `skill-refs`
and `run-times` continuously. Other postmaster sessions were running fleets on the
same machine throughout. Soak window 2026-09-29T10:32:01Z to 14:34:10Z.

| Sequence | Named timing control | Full self-test |
|---|---|---|
| `review-round.sh --self-test` × 50 | 50 passed, 0 failed | 50 passed, 0 failed |
| `host.sh --self-test` × 50 | 50 passed, 0 failed | 45 passed, 5 failed other controls |

The 5 host.sh runs that exited non-zero failed other controls (`a pane that never starts
the launch`, `a split tab in an id-less response`, `an allocation runaway is stopped at
MemoryMax`, `host.sh marks the space it opened as its own`, and neighbours). The named
control "its runner and the launch killed outright: the marker still lands" passed on
every one of the 50 runs. Those other flakes are recorded under "What I did not do".

## Decisions

1. **Pipe-race control lives in `front-door-acceptance.sh`.** The ticket names it as the
   gate that failed through this race on 2026-09-29. One control is enough (AC5).
2. **Race reproduction uses `seq 1 100000 | grep -q 1`, not `printf`.** Verified: exits
   141 under `pipefail` reliably, while a short `printf | grep -q` often wins the race.
3. **`host.sh run`'s 10s pidfile window is not widened.** That is production behaviour
   ("returns once the pidfile holds a pid, or its window ends"). The control waits for the
   pidfile as an event after `run` returns.
4. **`calls herdr | grep -q` counts as the racy form** and was converted to a herestring,
   per AC5's "piping it into `grep -q`".
5. **Production `printf | sed | tr | grep -q` in `host.sh`'s `agent_kinds` and
   `probe-trackers.sh`'s `gh auth status | grep -q` are left alone.** They are not self-test
   checks; the direction is to fix controls.
6. **`tool-faults.sh`'s `set +o pipefail` stays.** Its `| grep -q` forms were converted;
   the flag remains because other non-`grep` pipes in that self-test still want it out of
   the way of a reader's broken pipe. Converting the form is what AC5 asks.
7. **Deadline-kept control checks the state file's `attempt` and `deadline` directly**, as
   well as the behavioural `took` bound. State identity is the direct evidence that `start`
   did not run again; `took` is the behavioural evidence.
8. **Other host.sh self-test flakes found under the soak are recorded, not fixed**, where
   they are not timing controls (stub-state races, cgroup fixture shapes). Where a flake
   was the same class — a fixed sleep or a tight event bound — it was fixed (late-pane
   window, marker bounds, report/release).
9. **`tool-faults.sh` already had a `leaks()` helper using a herestring** from #80's
   coachman; that form is the model the rest of the suite now follows.

## What I did not do

- **Did not change the guarantees** `host.sh` and `review-round.sh` check. `run`'s pidfile
  window, `watch_exit`, `round_wait`'s attempt check, and the deadline mechanism are as
  they were.
- **Did not fix every host.sh self-test flake.** Five of 50 soak runs failed controls that
  are not timing controls: stub-state races (`a split tab in an id-less response`, `host.sh
  marks the space it opened as its own`, `a pane that never starts the launch`) and a
  cgroup fixture (`an allocation runaway is stopped at MemoryMax`). Per the ticket's note
  that other flaky controls may share a cause, finding them is in scope and changing them
  is not; these are named here and left alone. The named timing control passed 50/50
  beside them.
- **Did not touch production `grep -q` pipes** outside self-tests (`host.sh` `agent_kinds`,
  `probe-trackers.sh`).
- **Did not add a `TIMING_ONLY` switch** or split the self-tests; the whole self-test is
  the unit the gate runs.
- **Did not open a pull request or push.** The coachman does that.

## Verdict against the acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| 1. Cause of each timing failure recorded in the pull request | **met** | "Causes of each timing failure" above, written for the PR body |
| 2. Each timing control passes 50 runs in a row under concurrent load | **met** | Soak: review-round 50/50 full self-test; host 50/50 on "the marker still lands" (5 runs failed other, non-timing controls) |
| 3. Each still fails when the guarantee it is checking is broken on purpose | **met** | Teeth runs: `watch_exit` off → marker control exit 1; deadline reset → deadline-kept exit 1; attempt check gone → stand-down exit 1 |
| 4. No fixed sleep decides whether a control passes | **met** | `sleep 0.5`/`sleep 1`/`sleep 6` on pass/fail paths replaced by event waits (`wait_line`, `wait_file`, `wait_grep`, `dead`, `remaining`-driven aging). Remaining `sleep`s are poll intervals or fixture work |
| 5. No self-test checks output by piping into `grep -q` under pipefail; a control reproduces the race on the old form and passes on the new | **met** | 17 scripts converted; `grep -n '\| grep -q' scripts/*.sh` shows only the race control's deliberate old form and two production lines; the control in `front-door-acceptance.sh` prints `the old form fails under pipefail although it matched (exit 141)` and `the herestring form matches without a pipe that can break` |
