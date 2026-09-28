# Workhorse spec: 121 Make the run watcher part of postmaster

## Summary

The postmaster learns a run needs it only by looking, and each session improvises that look;
this change adds `scripts/runs-watch.sh`, a side-effect-free poller that waits until a run's
NEXT needs the postmaster (not WAIT, USER or `-`, and never a run on the held list), prints
`runs-status.sh`'s table, names each run with its NEXT, and exits, so Stage D can keep it in
the background, act on what it names, and start it again.

## Technical context

- **Language and version**: Bash with Python 3.11+ in heredocs, matching `scripts/runs-status.sh`.
- **Dependencies used or added**: none beyond the repo's scripts; wraps `scripts/runs-status.sh`
  and reads `postmaster.poll_seconds` from the config (`POSTMASTER_CONFIG` override).
- **Testing**: `scripts/runs-watch.sh --self-test` (positive controls for RULE, READ, DISPATCH,
  REMOUNT, INSPECT, GATE; negative for WAIT, USER, `-`, and held); `bash -n scripts/runs-watch.sh`;
  `scripts/skill-refs.sh` after the runbook edits; then the project gate via
  `/home/brindlewick/postmaster/scripts/verify.sh run .`
- **Constraints**: read runs, sleep, print only — no writes under `<runs>`, no process matching
  by prompt text; quote the runs dir; script paths in `skills/postmaster/` go through `<tool>`;
  `--self-test` with positive and negative controls, `--help`, strict mode.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Make the loop part of postmaster (ticket direction) | One `scripts/runs-watch.sh` in the tool; Stage D runs it in the background instead of an improvised loop |
| Side-effect free: read runs, sleep, print | The script only invokes `runs-status.sh`, reads `<runs>/postmaster/held`, sleeps and prints |
| Quote the runs dir; never match processes by prompt text | Every expansion of the runs path is quoted; the script starts no process and selects none |
| Script paths in runbooks go through `<tool>` | New references written as `<tool>/scripts/runs-watch.sh`; `scripts/skill-refs.sh` run after |
| Deterministic work in `scripts/`, not prose | Poll interval, held filter and NEXT filter live in the script's self-test, not in the runbook |
| Every count needs a control | Self-test's positive controls name each waking NEXT; negative controls leave it waiting until timeout |
| Nothing harness-specific in the flow | Stage D states the behaviour; `harnesses.md` carries how each harness keeps the watcher running |

No departure from the direction or the project's rules.

## Structure

- `scripts/runs-watch.sh` (new): the watcher, `--self-test`, `--help`.
- `skills/postmaster/postmaster.md` (Stage D): keep the watcher running in the background, act
  on what it names, start it again at once; holding and releasing via `<runs>/postmaster/held`.
- `skills/postmaster/harnesses.md`: per postmaster harness, how the watcher runs without
  blocking the conversation, and the fallback where it cannot.
- `README.md`: one line for `runs-watch.sh` beside `runs-status.sh`.
- `skills/postmaster/controls.md`: `runs-watch.sh` as a wait control beside `runs-status.sh`.

## Complexity tracking

None.

## Decisions

- **Which NEXT values wake the postmaster:** anything but `WAIT`, `USER` and `-`, as the ticket
  says, so a future NEXT wakes rather than sleeps.
- **Held list shape:** `<runs>/postmaster/held`, one run name (the ticket) per line; blank lines
  ignored; no comment syntax. Missing file means nothing held.
- **Wake output:** `runs-status.sh`'s table on stdout, then one `needs <run> <NEXT>` line per
  waking run. Timeout prints only the table and exits 3.
- **Poll interval:** `postmaster.poll_seconds` from the config (`POSTMASTER_CONFIG`), default
  120; no CLI override (the self-test sets a one-second config).
- **Timeout counting:** seconds slept, as `wait-for-markers.sh` does, so a clock jump cannot end
  the wait early; first look is immediate.
- **Config and holds read fresh each look**, so a held line takes effect on the next look without
  restarting the watcher.
- **README and controls.md** updated with the new script: the README lists every script and
  controls.md is the one list of controls; leaving them stale would be a gap this change introduced.
