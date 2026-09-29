# Workhorse spec: 85 Self-test controls that fail at random: host.sh and review-round.sh timing, and grep -q under pipefail

## Summary

Self-test controls flake under load from fixed timing windows in `host.sh` and `review-round.sh`, and from `printf | grep -q` under `pipefail` across about 17 scripts. This workhorse replaces fixed windows with event waits behind generous upper bounds, converts every self-test `| grep -q` to a herestring (or a file read), and adds one control that reproduces the old form's SIGPIPE race and passes on the new form.

## Technical context

- **Language and version**: Bash with Python 3.11+ heredocs, as the rest of the repo.
- **Dependencies used or added**: none.
- **Testing**:
  - AC1: causes recorded in `WORKHORSE-SUMMARY.md` (the PR text source).
  - AC2: `scripts/host.sh --self-test` and `scripts/review-round.sh --self-test`, 50 runs each, while four other self-tests run concurrently; each must exit 0 every time.
  - AC3: break each guarantee on purpose in a scratch copy and show the control fails; restore and show it passes.
  - AC4: no `sleep <constant>` sits between setup and a pass/fail decision; each wait polls for its event with a generous upper bound.
  - AC5: `grep -n 'grep -q' scripts/*.sh` shows no self-test `| grep -q` form; the new race control passes; full gate at the end.
- **Constraints**: fix controls, not the guarantees they check; change `host.sh`/`review-round.sh` production code only if a cause lives there; never push; work only in this worktree.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Fix the controls, not the guarantees | Only self-test bodies and self-test helpers change. `host.sh run`, `watch_exit`, `review-round.sh start/wait/teardown` stay as they are unless a cause is proven there (none is: both windows named in the notes are control-side waits). |
| Wait on the events the controls depend on, with generous upper bounds | `marker`-style polling for pidfiles, process death, state-file fields, and wait-announce lines. Bounds raised to tens of seconds. |
| No fixed sleep decides whether a control passes | `sleep 0.5` before a stale-wait restart and `sleep 1` after `timeout 1` go away, replaced by event waits. Setup-only short pauses (if any remain) are not on the pass/fail path. |
| No self-test checks output by piping into `grep -q` under pipefail | Every `... | grep -q` in a self-test becomes `grep -q ... <<< "..."` or `grep -q ... <file>`. |
| A control reproduces the race on the old form and passes on the new one | New control in `front-door-acceptance.sh` (the named gate victim): `seq 1 100000 | grep -q 1` under `pipefail` exits 141 despite matching; `grep -q 1 <<< "$(seq 1 100000)"` exits 0. |
| Other self-tests' timing flakiness: find, do not change | Noted in the summary; left alone. |
| Nothing repo-specific / harness-specific in the flow | No production flow changes. |
| Deterministic work in scripts | The race control and the event-wait helpers live in the self-tests themselves. |
| Every count needs a control | The race control is positive (old form fails) and negative (new form passes) through the identical command shape. |

## Structure

- `WORKHORSE-SPEC.md` — this file (first commit).
- `scripts/host.sh` — self-test only: event-wait for the h6/h7 pidfile before SIGKILL; longer marker bounds; herestring form for `printf | grep -q` and `calls herdr | grep -q`.
- `scripts/review-round.sh` — self-test only: event-wait for the stale wait to announce itself before `start`; deadline-kept control based on state-file identity plus a generous `took` bound; event-wait for process death; longer `launch` child-pid bound.
- `scripts/front-door-acceptance.sh` — self-test: convert `printf | grep -q`; add the pipe-race control.
- Self-test `| grep -q` → herestring in: `cut-scratch.sh`, `fixture.sh`, `github.sh`, `launch.sh`, `link-skills.sh`, `local.sh`, `log-action.sh`, `parallel-runs-acceptance.sh`, `run-times.sh`, `skill-refs.sh`, `style-findings.sh`, `ticket-check.sh`, `tool-faults.sh`, `turnpikes.sh`, `wiki-lint.sh` (and any remaining in the files above).
- `WORKHORSE-SUMMARY.md` — last commit.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| None | | |

## Decisions

1. **Where the pipe-race control lives.** `front-door-acceptance.sh`, because the ticket names it as the gate that failed through this race on 2026-09-29. One control is enough (AC5 says "a control").
2. **Old form race reproduction uses `seq 1 100000 | grep -q 1`, not `printf`.** Verified: exits 141 under `pipefail` reliably, while a short `printf | grep -q` often wins the race and hides the bug. The control names both forms.
3. **`host.sh run`'s 10s pidfile window is not widened.** That is production behaviour a caller may rely on ("returns once the pidfile holds a pid, or its window ends"). The control waits for the pidfile as an event after `run` returns, which is what the direction asks for.
4. **`tool-faults.sh` keeps `set +o pipefail` for now only if it still needs non-`grep -q` pipes; every `| grep -q` inside it is converted anyway.** Converting the form is what AC5 asks; removing the blanket `set +o pipefail` is not required if other pipes remain, but it goes away if nothing needs it.
5. **Review-round "keeps the deadline" control uses both state identity and a `took` bound.** State `attempt`+`deadline` unchanged after an interrupted wait is direct evidence; `took` well under a fresh limit is the behavioural evidence. Limit 60s, age until remaining ≤ 20s, overhead 25s: a reset (≈60s) cannot pass, a kept deadline (≈20s + startup) cannot fail.
6. **`calls herdr | grep -q` counts as the racy form.** AC5 forbids checking output "by piping it into `grep -q`". Those become `grep -q ... <<< "$(calls herdr)"`.
7. **Production `printf | sed | tr | grep -q` in `host.sh`'s `agent_kinds` is left alone.** It is not a self-test check; the direction is to fix controls.

## Tasks

- [ ] T001 [AC1] Record each timing cause (which wait, why a busy machine breaks it) in the summary's PR section.
- [ ] T002 [P] [AC5] Convert every self-test `| grep -q` to a herestring or file read across the ~17 scripts named in Structure.
- [ ] T003 [P] [AC5] Add the pipe-race control in `scripts/front-door-acceptance.sh`: old form fails under pipefail, new form passes.
- [ ] T004 [P] [AC4] Fix `scripts/host.sh` self-test h6/h7: event-wait for the pidfile before SIGKILL; generous marker bounds; no fixed sleep on the pass/fail path.
- [ ] T005 [P] [AC4] Fix `scripts/review-round.sh` self-test timing controls: event-wait for stale-wait announce; deadline-kept with state identity + generous `took` bound; event-wait for process death; longer launch child-pid bound.
- [ ] T006 [AC2] Run each fixed timing control 50 times in a row with four other self-tests concurrent; record the results.
- [ ] T007 [AC3] Break each guarantee on purpose and show the control still fails; restore and show it passes.
- [ ] T008 [AC4] Audit remaining `sleep` in the two self-tests: none decides pass/fail.
- [ ] T009 [AC5] Confirm no self-test `| grep -q` remains and the race control passes; run the full gate via `verify.sh run .`.
