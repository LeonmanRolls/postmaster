# WORKHORSE-SUMMARY.md

## Commits on branch wb/200-mimo

- `e627886` Add lane confinement: process space of its own per lane
- `a6c421f` Document lane confinement in harnesses.md and coachman.md
- `e9ee11c` Format confinement code to project style
- `b51faa1` Use Unicode digit class in battery count regex, matching the project guard

## Checks

`/home/brindlewick/.postmaster/tool-pins/d06ea3a7bc4afdab5d02e738c99356d00511ecc0/scripts/verify.sh run .` printed:

    gate: pass, exit 0, 848s: bun run check
    coachman-contract: pass, exit 0, 6s: scripts/coachman-contract.sh --self-test

Commands run and their exits:

- `bun run check` — exit 0
- `scripts/coachman-contract.sh --self-test` — exit 0
- `bun test scripts/lib/confine.test.ts` — exit 0 (6 pass)
- `bun test scripts/run-meta.test.ts` — exit 0 (99 pass)
- `bun test scripts/launch.test.ts` — exit 0 (256 pass)
- `scripts/skill-refs.sh` — exit 0
- `scripts/wiki-lint.sh` — exit 0
- `grep -rinE 'linux|darwin|bwrap|sandbox-exec' scripts/launch.ts` — exit 1 (no matches)

## Evidence

1. `.postmaster/verify/ac1-form-and-grep.md`
   - `.postmaster/verify/summary-evidence-check.md` (summary-evidence: evidence shape holds, exit 0)
2. `.postmaster/verify/ac2-battery-work-items.md`
3. `.postmaster/verify/ac3-signal-isolation.md`
4. not shown: moved to #221 by the user's word (2026-10-02)
5. not shown: moved to #221 by the user's word (2026-10-02)
6. `.postmaster/verify/ac6-battery-controls.md`
7. `.postmaster/verify/ac7-fallback.md`
8. not shown: dropped by the user's word (2026-10-01); no version is pinned or recorded
9. `.postmaster/verify/ac9-fixture-confined-task.md`
10. `.postmaster/verify/ac10-runbooks.md`

## Decisions

- Action verb for the fallback is `degrade` — the lane is degraded to unconfined; actor is `lane:<name>`.
- The macOS Seatbelt profile uses deny-signal-then-allow-same-sandbox; untested here (#205 checks it).
- The Bubblewrap flags are `--unshare-pid --proc /proc --bind / / --dev /dev --die-with-parent`; `--dev /dev` is needed for a working /dev inside the PID namespace.
- The battery's "gate" item is a shell command that exits 0 (stand-in for the project gate); the real gate is AC9's fixture task.
- The confinement battery's network reach uses Python's socket to connect to 1.1.1.1:53; the Unix socket test uses Python's AF_UNIX.
- When confinement cannot start, the skip reason distinguishes "no confinement" (tool not installed) from "inside a confinement" (tool present but start check fails).

## What I did not do

- The dispatched scored fixture run (AC9 second half): run by the coachman/postmaster from this branch, not the lane. Recorded expectations in the AC9 transcript.
- The macOS row is untested (no Mac available); #205 runs the macOS trial.

## Verdict

1. met — form wraps when on, bare when off, harness argv byte-identical, launch.ts names no OS
2. met — all five work items pass confined (gate, commit, write outside, network, Unix socket)
3. met — confined lane cannot signal what it did not start; can signal its own
4. n/a — moved to #221
5. n/a — moved to #221
6. met — battery runs with paired controls, ends with count, skip-by-name path works
7. met — fallback warns, logs, runs unconfined; off runs as before; run.json records mode
8. n/a — dropped
9. partially met — lane's confined task passes (gate, commit, signal refused); dispatched scored run is coachman's
10. met — harnesses.md and coachman.md say what the ticket requires
