# Workhorse summary: 258 — postmaster's own tests pass on macOS, and CI runs them on Linux and macOS for every pull request

## What you built

Commits on `wb/258-mimo`, oldest first:

- `23b18bc` Refuse a Bun below the minimum before any script starts — `scripts/lib/bun-min.ts` reads `engines.bun` from the tool's own package.json in its own process before `scripts/run` loads any script, naming both versions on refusal; `scripts/old-bun.ts` drives every script through that path under a real older Bun; `.github/workflows/check.yml` runs the full check on Linux and on a Mac with the system bash, and the refusal under Bun 1.3.14.
- `2669efc` Hold every test skip against one list, and fail a pass that checked nothing — `scripts/skip-check.ts` runs the suite over Bun's JUnit report in a temporary folder, matches every observed skip to `scripts/skips.toml` (file, full name, reason, systems), fails a skipped test the list does not name for this system, an entry with no reason or the wrong system, a stale entry, and a test that passes with zero assertions; `bun run check` runs it in place of the bare `bun test`.
- `cc982c0` Make the suite pass on macOS, and fix every skip it needs there — the host self-test reads boot id and boot time through the shared sysctl-fallback reading, starts the escapee's session with setsid or python inside the stub PATH it runs with, and asserts the escapee and the deaf child ran before the stop; the launch parity fixtures dump the handed environment and witness argv through python (no `env -0`, `sort -z` or `/proc/self/cmdline`); the environment control is sized to the 1 MiB macOS exec limit; temp paths compare through `realpathSync`; python gates probe an interpreter that runs; the five wiring tests assert the record that holds instead of returning; raw-byte argv, the iconv differential, the flock holder, the non-UTF-8 file name, the linux-only wrap flags and the root-owned-chain premise skip where they cannot run, each listed in `skips.toml`.
- `54edc72` Let a copy of the start command outside the tool start the files beside it — the version check runs only where the tool's manifest and check file sit beside `scripts/run`.
- `99aa713` Ask a pull request's checks before the merge word — `landing pr-checks` reads the pull request's checks at the card's HEAD through a `gh` on PATH (`pass`, `pending`, `fail: <name> <link>`, `none`); Stage F asks it on both routes after the pull request opens and before the merge word or the postmaster's own merge, moves on only on `pass` or `none`, sends a `fail` back to the last leg with the failing job as the exact discrepancy, and waits on `pending`.
- `45b3aea` Name the systems postmaster runs on, and list no Python — README's "What it needs" names Linux and macOS, the Apple-silicon Mac job, and Intel Macs as not tested; the Python requirement is gone from README and trackers.md.

## Checks

gate: pass, exit 0, 1191s: bun run check
coachman-contract: pass, exit 0, 8s: scripts/run coachman-contract --self-test

Other commands the evidence rests on, each run to its shown exit:

- `cd /tmp/c3a && bun run check` with a planted unlisted skip — exit 1, names the file and `planted skip`
- `cd /tmp/c3a && bun run check` with the entry's reason empty — exit 1, names the entry
- `cd /tmp/c3a && bun run check` with the entry listed for darwin only — exit 1, `wrong system … listed for darwin, not linux`
- `cd /tmp/c3a && bun run check` with the entry listed for linux and darwin — exit 0
- `cd /tmp/c4a && bun run check` with the planted zero-assertion pass — exit 1, `passes without checking anything: scripts/github.test.ts: planted vacuous`
- `cd /tmp/c4a && bun run check` with the early return removed — exit 0
- `bun test scripts/host.test.ts` — exit 0, 37 pass, 0 fail
- `bun test scripts/landing.test.ts` — exit 0, 122 pass
- `PATH=/tmp/bun-old/bun-linux-x64:$PATH …/bun scripts/old-bun.ts` under real Bun 1.3.14 — exit 0, `70 of 70 scripts refused`
- `grep -n -i python README.md skills/postmaster/trackers.md` — exit 1 (no match)

## Evidence

1. not shown: the lane has no Mac and never pushes; the `macos-latest` job in `.github/workflows/check.yml` runs the full check on this ticket's pull request
2. `.postmaster/verify/evidence/gate-linux-check.log`
   `.postmaster/verify/logs/gate.log`
   `.postmaster/verify/evidence/summary-evidence.txt`
3. `.postmaster/verify/evidence/c3a-run1-unlisted-skip.txt`
   `.postmaster/verify/evidence/c3a-run2-no-reason.txt`
   `.postmaster/verify/evidence/c3a-run3-darwin-only.txt`
   `.postmaster/verify/evidence/c3a-run4-listed-for-linux.txt`
4. `.postmaster/verify/evidence/c4a-run1-planted-vacuous.txt`
   `.postmaster/verify/evidence/c4a-run2-early-return-removed.txt`
5. `.postmaster/verify/evidence/c5-check-workflow.yml`
6. `.postmaster/verify/evidence/c6-macos-bash-gate.txt`
7. `.postmaster/verify/evidence/c7-old-bun-drive.txt`
8. `.postmaster/verify/evidence/c8-bun-min.txt`
9. `.postmaster/verify/evidence/c9-landing-pr-checks.txt`
   `.postmaster/verify/evidence/c9-c10-stage-f.txt`
10. `.postmaster/verify/evidence/c9-c10-stage-f.txt`
    `.postmaster/verify/evidence/c9-landing-pr-checks.txt`
11. `.postmaster/verify/evidence/c11-readme-systems.txt`
12. `.postmaster/verify/evidence/c12-python-grep.txt`

## Decisions I made within the brief

- **The skip list's shape**: `scripts/skips.toml`, one `[[skip]]` per site, holding the test file, the full name (describes outermost first, joined with ` > `, then the test name, derived from Bun's own report), the reason, and the systems. The tests' top notices were removed; the reasons live only there. The brief leaves format and place to the lane.
- **The suite runs once, inside skip-check**: `bun run check` runs `bun test scripts/ lint/ --reporter=junit` through `scripts/run skip-check` with inherited stdio, so the suite's own output still streams, its exit code still gates, and the report is read in the same pass — no second suite run.
- **A stale entry fails**: an entry naming a test that is not in the report fails the check, so a renamed or deleted test cannot leave a dead entry behind; every test a skip names appears in the report whether it ran or skipped, on both systems.
- **The parity stubs became python**: the handed-environment dump and the argv witness use python — the parity block already requires a python3 with tomllib (3.11+) wherever it runs — since BSD `env` has no `-0`, BSD `sort` no `-z`, and macOS no `/proc/self/cmdline`.
- **The 1.2 MB environment was resized, not skipped**: 4,000 exports ≈ 840 KB still exercises a big environment and fits the 1 MiB macOS exec limit, so the control runs on both systems (D1: fix wherever a Mac can do what the test does).
- **The confinement battery keeps running on macOS**: the Seatbelt profile allows what the battery expects and denies signals to the outside, so nothing skips there; the skip list is where an entry would go if the Mac job disagrees.
- **Boot identity never follows `POSTMASTER_PROC_ROOT`**: `bootId()`/`bootTime()` default to the real `/proc` so every writer and reader of a record shares one identity whatever the process queries are forced to; the fallback tests pass an explicit root instead.
- **`pr-checks` without `--pr` prints `none`**: the local route opens no pull request, so the runbook asks the same question there before the postmaster's own merge and it answers `none`, which the stage moves on.
- **The copied-start-command guard**: `scripts/run` runs the version check only where the tool's manifest and `lib/bun-min.ts` sit beside it; a copy taken outside the tool — as the ticket-check tests take one — starts what it resolves beside itself, as it did before.
- **The planted skip is suppressed for tsc**: these Bun types leave `test.skip` out, so the planted copy carries a `@ts-expect-error` line; the runtime skip and its JUnit report are exactly as planted.

## What I did not do

- Ran no macOS job: the lane has no Mac and never pushes; `macos-latest` runs the check when the postmaster opens this ticket's pull request (criteria 1, 5 and 6 on real hardware).
- Ran no fixture run from this branch: the coachman contract requires one before the contract change merges; the armed `scripts/run coachman-contract --self-test` passes on the branch, and the fixture run is the coachman's to dispatch.
- Did not touch the archived trial scripts or the `oracle-*.sh` files, and did not add the Linux-only-constructs check (#260) or the macOS-degradation fixes (#259), both out of scope.

## My verdict, one line per acceptance criterion

1. not shown: no Mac runs here; the workflow's `macos-latest` job runs `bun run check` on the pull request, and every part forceable on Linux passes (host self-test at full count, gate green).
2. Met: `skips.toml` holds every skip site with its reason and systems; `bun run check` matched the one skip this machine fires against its entry and summarised it.
3. Met: the four planted-skip runs show unlisted, no-reason, wrong-system failing with the names, and linux-listed exiting 0.
4. Met: the planted zero-assertion pass fails the check naming it; removing the early return exits 0.
5. Met: `.github/workflows/check.yml` runs the full check on `ubuntu-latest` and `macos-latest` for every pull request, full-history checkout, Bun at the manifest's minimum, `bun install --frozen-lockfile`.
6. Met: the Mac job prints `/usr/bin/env bash`'s version and stops with an error unless it is 3.2.
7. Met: a third job runs every script through the start command under Bun 1.3.14 with no install.
8. Met: under Bun 1.3.14 every script stops with nothing on stdout and the version message naming 1.4.2 and 1.3.14 on stderr; under a raised minimum the same message beats a load error.
9. Met: Stage F asks `landing pr-checks` after the pull request opens and moves on only on `pass` or `none`, before the merge instructions reach `.waiting-on-user`; the stand-in gh covers pass, pending, fail, none and another head.
10. Met: on `fail` Stage F removes `.card-ready` and `.leg-<n>-done` for the current leg and resumes it with the failing job's name and link as the exact discrepancy; on `pending` it waits and asks again at its next look.
11. Met: README names Linux and macOS supported, Apple silicon as what CI runs, and Intel Macs not tested.
12. Met: `grep -n -i python README.md skills/postmaster/trackers.md` finds nothing.
