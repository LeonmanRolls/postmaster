# Workhorse summary: 259 What only degrades on macOS is fixed, or stated with what the user sees

## What was built

The commits on `wb/259-mimo`, in order:

- `690e6b3` **Read the signal numbers and the boot id from the running system** —
  `signalExitCode` takes `os.constants.signals` (and the runtime's numeric `SIG<n>` names), so a
  child dead by a signal reports 128 plus this system's number; `scripts/lib/processes.ts` gains
  the shared `bootId()` (proc root, then `kern.bootsessionuuid`, then the whole seconds of
  `kern.boottime`) and `sameBoot()`, which still matches a record in the base's whole-text
  `kern.boottime` form on the same boot. New tests beside `proc.ts`.
- `b942fcb` **Compare round boots through the shared boot id and its old text form** —
  `review-round` reads the boot id through the shared module and compares with `sameBoot()`.
- `f19179b` **Give the Herdr wait a timeout without timeout(1), write the whole environment to
  the FIFO, and take -x for flock** — `limit()` falls back to `run()`'s own millisecond timeout
  where `timeout(1)` is absent; `envWrite()` waits out `EAGAIN` until the reader drains the FIFO
  instead of abandoning the rest, so an environment larger than the pipe arrives whole; the
  waiting list's flock takes `-x`.
- `caf7d80` **Harvest Claude task output from the per-user temporary folder too** — harvest
  accepts `<shared>/claude-<uid>` and `<tmpdir>/claude-<uid>` and refuses anything else as
  before.
- `e6ff2f3` **Find the tracker prefix in process, without depending on grep's pattern support** —
  discover-project matches the ticket pattern in process with GNU grep's word boundaries and the
  same ranking; a grep that exits 2 no longer empties the prefix.
- `f1dc4a1` **Ask about launch limits only where a launch can be capped** — setup reads `uname -s`
  as `systemdCapability()` does: off Linux it lists no `limits.` key, asks no limit question,
  writes no `[limits]` table, and prints once that launches run without memory or process
  limits.
- `5ec551c` **Write the readme's section for Mac users** — `## On a Mac` after "What it needs",
  one entry for each of D5 to D11 and one for the archived trial scripts and old ticket oracles,
  each saying what the user sees, and naming no source file.
- `be91beb` **Carry a 1,000-byte variable beside the 100,000-byte one in the stub panes** — the
  self-test's Herdr-stub and tmux-stub controls print both lengths from one environment.

Tests written beside the change: new `scripts/lib/proc.test.ts`; additions to `setup.test.ts`
(the stand-in uname: no keys, no questions, one line, no table), `discover-project.test.ts`
(ABC-1..3 with the real grep and with a stand-in that exits 2), `review-findings.test.ts`
(per-user temporary folder copied; outside both refused); `host.test.ts`'s member-start record is
written through the shared `bootId()` with a stand-in `sysctl`, and its section counts carry the
two new self-test controls.

## Checks

What the final
`/home/brindlewick/.postmaster/tool-pins/5c58c8346d1bfc369855ecf862135547100a57d8/scripts/run verify run .`
printed, run just before this summary was written (full transcript with the command, its output
and its exit: `.postmaster/verify/verify-run.txt`):

```text
c1: pass, exit 0, 27s: bash .postmaster/verify/c1.sh
c2: pass, exit 0, 195s: bash .postmaster/verify/c2.sh
c3: pass, exit 0, 5s: bash .postmaster/verify/c3.sh
c4: pass, exit 0, 4s: bash .postmaster/verify/c4.sh
c5: pass, exit 0, 0s: bash .postmaster/verify/c5.sh
c6: pass, exit 0, 1s: bash .postmaster/verify/c6.sh
c7: pass, exit 0, 1s: bash .postmaster/verify/c7.sh
c8: pass, exit 0, 2s: bash .postmaster/verify/c8.sh
c9: pass, exit 0, 0s: bash .postmaster/verify/c9.sh
gate: fail, exit 1, 1172s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/259-mimo/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 8s: scripts/run coachman-contract --self-test
[exit 2]
```

The gate's one failure is pre-existing and environmental, not this change's: the full
`bun run check` scores 2746 of 2747 tests, and the single failure is `probe-confine.test.ts`'s
"a bwrap is vetted only on a root-owned chain", which cannot pass inside this lane's own bwrap
confinement (only uid 1001 is mapped, so root-owned files report as 65534). Those two files are
byte-identical to the base of this ticket. `.postmaster/verify/gate.txt` holds the failing
control alone, the empty diff against the base and the uid map; every other gate component —
tsc, oxlint, the format check, skill-refs and wiki-lint — passes.

Other commands run during the loop, with their exits:

- `bunx tsc --noEmit` — exit 0
- `bunx oxlint` — exit 0 (pre-existing warnings only)
- `bunx biome format scripts types lint package.json tsconfig.json biome.json .oxlintrc.json` —
  exit 0
- `bun test scripts/setup.test.ts scripts/discover-project.test.ts scripts/review-findings.test.ts`
  — exit 0 (143 pass)
- `bun test scripts/lib/proc.test.ts` — exit 0 (3 pass)
- `scripts/run skill-refs` — exit 0
- `scripts/run wiki-lint` — exit 0
- `scripts/run coachman-contract --self-test` — exit 0 (36 passed, 0 failed)
- `bun run check` run directly during the loop — exit 1, the same environmental failure
- `scripts/run summary-evidence .postmaster/verify/WORKHORSE-SUMMARY.draft.md .` — exit 0

## Evidence

1. `.postmaster/verify/c1.txt`
2. `.postmaster/verify/c2.txt`
3. `.postmaster/verify/c3.txt`
4. `.postmaster/verify/c4.txt`
5. `.postmaster/verify/c5.txt`
6. `.postmaster/verify/c6.txt`
7. `.postmaster/verify/c7.txt`
8. `.postmaster/verify/c8.txt`
9. `.postmaster/verify/c9.txt`
- The checker's own run over this summary: `.postmaster/verify/summary-evidence.txt`.

Within-brief questions decided for myself:

- The nine ticket checks were added to this worktree's armed `.postmaster/verify/spec.json`
  beside the run's `gate` and `coachman-contract`, so `verify run` runs them all and prints one
  line per check; the run's own two checks are unchanged.
- C4's loop through `run()` skips the four signals that only stop a child (a stopped child
  reports no exit code at all, and Bun's `spawnSync` cannot time one out); their numbers are
  still asserted at function level, and every signal whose default action can end a child goes
  through `run()`.
- `signalExitCode` also maps the runtime's numeric `SIG<n>` names (Bun reports SIGSTKFLT as
  `SIG16`), which is what lets every system-numbered signal reach 128 plus its number.
- C2's stub evidence runs `scripts/run host-self-test` directly, so the `ok` lines are visible;
  `bun test` prints no names for passing tests. The real-tmux half of C2 runs the command for
  both variable sizes.
- The readme section is `## On a Mac`, placed after "What it needs" and before "Installing the
  skills", exactly eight entries.
- The check scripts and transcripts live under `.postmaster/verify` (gitignored, as the verify
  directory is); the code and tests live in the commits above.

What I did not do, and why:

- D1–D4 and D6–D11 are documentation or decisions, not code: nothing caps a launch on a Mac
  (#140), nothing probes Muse/MiMo data (#205), no directory-service lookup for `~user` paths,
  no native-code argument or lock reading, no time-zone fix (D11), no wiki page (D1), no full
  list of Linux-only files (D2), and no probe at setup for cap capability — setup and the launch
  share the one Linux test (D4).
- The archived trial scripts and old ticket oracles were not edited, per the direction.
- `docs/coachman-contract.toml` is untouched (`host.sh` does not change), so no fixture run was
  needed.
- The pre-existing environmental gate failure was not worked around: setting
  `POSTMASTER_PROBE_BWRAP_SECURE` or editing another ticket's test would weaken a check rather
  than pass it, and it is not this ticket's to change.
- The self-test's fifty-pair claim control flaked once under machine load (load average ~28 on
  18 cores, other runs' gates running) during the loop; it passed in the gate on the same code
  and in the final run's gate, and `.postmaster/verify/c2.txt` is from a full pass on the final
  code.

Verdicts, one line per acceptance criterion:

- Criterion 1: met — C1: without `timeout(1)`, close and run settle on a host in ~5 s; with it,
  as today; no Herdr close is attempted.
- Criterion 2: met — C2: 100,000 and 1,000 bytes reach the Herdr-stub pane, the tmux-stub pane
  and a real tmux window whole, with markers landing.
- Criterion 3: met — C3: with the boot id read through the shared module, corrected
  microseconds/date text (the text a time zone change also changes) drops no record and reports
  no restart; a changed `kern.bootsessionuuid`, or changed seconds when it is refused, does.
- Criterion 4: met — C4: through `run()`, 128 plus `os.constants.signals`' number for every
  signal that can end a child; with the macOS numbers applied here, 158/138/140.
- Criterion 5: met — C5: output under `<tmpdir>/claude-<uid>` and under `/tmp/claude-<uid>` is
  harvested; outside both, refused with the same message.
- Criterion 6: met — C6: `tracker_prefix=ABC` with the real grep and with a grep that exits 2.
- Criterion 7: met — C7: no `limits.` key, no limit question, no refusal and no `[limits]`
  table under the Darwin stand-in; on Linux the eight keys and the refusal stand.
- Criterion 8: met — C8: exactly one line saying launches run without memory or process limits
  under the stand-in, interactive and with answers; none on Linux.
- Criterion 9: met — C9: the readme section after "What it needs" holds exactly the eight
  entries for D5–D11 and the archive, each with what the user sees, and none for what C1–C6
  fixed.
