# Workhorse summary: 121 Make the run watcher part of postmaster

## What this built

- `4e1affc` Add workhorse spec for #121 — `WORKHORSE-SPEC.md` alone, before any code.
- `96b7f2a` Add runs-watch.sh: wait until a run needs the postmaster — `scripts/runs-watch.sh`
  with `--self-test`, `--help`, and strict mode: it wraps `runs-status.sh`'s table and NEXT
  column, reads `postmaster.poll_seconds` and `<runs>/postmaster/held`, prints `needs <run>
  <NEXT>` per waking run and exits 0, or the table and exit 3 on `--timeout`.
- `ce8dc8e` Keep runs-watch.sh running in Stage D, per harness — `skills/postmaster/postmaster.md`
  Stage D (background watcher, act, restart at once, hold/release on the held list),
  `skills/postmaster/harnesses.md` "Keeping the watcher running" (per postmaster harness),
  `README.md` and `skills/postmaster/controls.md` listings.
- `fa8048c` Add the spec's tasks, ticked — the Tasks section the first spec commit omitted.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed, just before this summary:

```
gate: pass, exit 0, 454s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

| check | command | exit |
|---|---|---|
| gate | `verify.sh run .` (the recorded gate above) | 0 |

Every other command run, and its exit:

| command | exit |
|---|---|
| `scripts/runs-watch.sh --self-test` | 0 (all controls behaved) |
| `scripts/runs-status.sh --self-test` | 0 |
| `scripts/skill-refs.sh` (after the runbook edits, then `--fix`, then again) | 0 |
| `scripts/wiki-lint.sh` | 0 |
| `bash -n` on every `scripts/*.sh` | 0 |

## Decisions

- **Which NEXT values wake the postmaster:** anything but `WAIT`, `USER` and `-`, so a future
  NEXT wakes rather than sleeps.
- **Held list shape:** `<runs>/postmaster/held`, one run name (the ticket) per line; blank lines
  ignored; no comment syntax. A missing file means nothing held. The list is read on every look,
  so a hold takes effect without restarting the watcher.
- **Wake output:** `runs-status.sh`'s table, then one `needs <run> <NEXT>` line per waking run.
  Timeout prints only the table and exits 3.
- **Poll interval:** `postmaster.poll_seconds` from the config (`POSTMASTER_CONFIG`), default 120.
  No CLI override; the self-test sets a one-second config.
- **Timeout counting:** seconds slept, as `wait-for-markers.sh` does, so a clock jump cannot end
  the wait early. The first look is immediate.
- **README and controls.md** get the new script: the README lists every script and controls.md
  is the one list of controls.
- **Spec Tasks section** was missing from the first spec commit and was added in `fa8048c`, ticked.
  The first commit stands as the record of intent and was not rewritten.

## What this did not do

- **Did not add `runs-watch.sh` to the project gate's self-test list.** That list lives in the
  gate command recorded at dispatch, not in a file this change owns. `runs-watch.sh --self-test`
  ran directly and passes. A gate that runs every `scripts/*.sh --self-test` would pick it up
  with no list to keep.
- **Did not make the watcher act on anything**, per the ticket's out of scope: it only wakes the
  postmaster.
- **Did not touch `coachman.md` or the marker contract.** Stage D and the watcher read the
  existing `runs-status.sh` NEXT values unchanged.

## Acceptance criteria

- **AC1 met.** `scripts/runs-watch.sh <runs>` waits on `runs-status.sh`'s table every
  `postmaster.poll_seconds` (default 120), prints the table, names each waking run with its NEXT,
  and exits 0. Self-test positive controls cover it.
- **AC2 met.** A run needs the postmaster when its NEXT is anything but `WAIT`, `USER` or `-`;
  a run listed in `<runs>/postmaster/held` never does. Negative controls cover WAIT, USER, `-`
  and held.
- **AC3 met.** `--timeout <seconds>` exits 3 after that long with nothing to act on, printing
  the table. The `--timeout 0` control shows the look still happens.
- **AC4 met.** The self-test has positive controls for RULE, READ, DISPATCH, REMOUNT, INSPECT
  and GATE (each names its run) and negative controls for WAIT, USER, `-`, and held (left
  waiting until timeout).
- **AC5 met.** `postmaster.md` Stage D says to keep `runs-watch.sh` running in the background,
  act on what it names, and start it again at once; holding is writing the ticket to the held
  list, releasing is removing it.
- **AC6 met.** `harnesses.md` "Keeping the watcher running" names each postmaster harness, how
  `host.sh run` keeps the watcher outside the harness's task list without blocking the
  conversation, and the foreground `--timeout` poll where it cannot run in the background.
