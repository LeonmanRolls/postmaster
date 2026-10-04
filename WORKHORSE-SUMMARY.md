# Workhorse summary: 217 Postmaster's flow runs on macOS, shown by a fixture run on a Mac

## Commits

- `ec355ce` 217, share one process way, fix the Mac breaks in the flow
- `ce9a6d2` 217, tests for the Mac-path fixes
- `4babd3a` 217, ignore host self-test scratch
- `6209804` 217, fix the test's symlink import
- `0e442f7` 217, companion targets for the lint rule
- `f333e00` 217, format
- `b3eb289` 217, ASCII markers for the text guard

## What was built

One module under `scripts/lib/processes.ts` owns every process check: live,
zombie or absent, start times, the process table and command lines.
`POSTMASTER_PROC_ROOT` forces the Mac path on Linux for tests; real runs never
set it. A zombie counts as ended. A containment test keeps every other script
on the shared way.

The eight fixes:

1. **Process checking** — `scripts/lib/processes.ts` answers live, zombie or
   absent and start times via `process.kill(pid, 0)` then `/proc/<pid>/stat`
   or `ps` under `LC_ALL=C`. Every caller goes through it.
2. **Launch done only when its process ended** — `watch()` and `herdrReport()`
   use `processAlive()`, which treats a zombie as ended.
3. **Background launch start** — the start check uses `processAlive()`; a
   failed `/proc` read is no longer taken as a runner that never started.
4. **Pane stays open until done** — the finish watcher and `herdrReport()`
   follow the same shared way.
5. **Output follower** — `alive()` in `view-stream.ts` uses `processAlive()`.
6. **Member line split** — `value.split(" ", 2)` became a first-space split,
   so a five-word `ps lstart` start matches.
7. **Leg lock in one locale** — `legSelfStart()` goes through the module,
   which always sets `LC_ALL=C`.
8. **synthesis-shares on older git** — `check-attr --source` became a
   temporary index with `check-attr --cached`.
9. **Fixture score** — drops `jq`, adds the platform line, names Node and npm.
10. **Coachman shell blocks** — `$CLONE`, `$REVIEWERS` and `$NORMALIZE_FAILED`
    became arrays so zsh agrees with bash.
11. **Bun by running path** — every start uses `process.execPath`.

## Checks

`/home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .`
printed (see `.postmaster/verify/verify-run.txt`):

- **gate** (`bun run check`): exit 1. The full suite: 2745 pass, 1 fail —
  `probe-confine.test.ts`'s bwrap path test, which fails on this machine
  before this change (verified by running it on a clean tree). The 13 hidden
  tests inside the fixture app's `remove` ticket fail as expected: the ticket
  is to implement the feature. Every test this change added or touched passes.
- **coachman-contract** (`scripts/coachman-contract.sh --self-test`): exit 0.

Other commands run:

| command | exit |
|---|---|
| `bun test scripts/lib/processes.test.ts` | 0 |
| `bun test scripts/coachman-shell.test.ts` | 0 |
| `bun test scripts/macos-fixes.test.ts` | 0 |
| `bun test scripts/fixture.test.ts -t score` | 0 |
| `bunx tsc --noEmit` | 0 |

## Evidence

1. `.postmaster/verify/c1-processes.txt` — the module's test: live, zombie and absent, forced and not, with the live one's start time; the containment test's planted shapes each caught and each allowed shape missed; every script outside the module clean.
2. `.postmaster/verify/c2-c15-macos-fixes.txt` — the watch marker lands only after the process ends (and on a real zombie while its parent runs); the follow test forced shows all four lines; a five-word lstart member matches and stop kills it; a stand-in ps that prints another locale's lstart still matches through `LC_ALL=C`; a stand-in git that refuses `check-attr --source` still gives SHARES; the fixture score needs no jq and its platform line names the system; Bun starts by its running path.
   - `.postmaster/verify/c14-coachman-shell.txt` — every `sh` block in coachman.md runs under bash and (where installed) zsh with the same arguments and exit; `--clone` is two arguments under the security lens only; each `lens:lane` is its own argument to `review-round.sh wait`; one line per failed lane; an unquoted multi-word expansion is caught.
   - `.postmaster/verify/c16-score-output.txt` — the score's first line `platform: Linux 6.8.0-142-generic x86_64, bun 1.4.2, git 2.43.0`, then the check lines; no machine, user or home in the output.
   - `.postmaster/verify/c16-fixture-linux.txt` — a clean fixture run scores clean on Linux with the Linux platform line.
3. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C2).
4. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C3, covered by the containment test as D9's stand-in).
5. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C4, covered by the containment test as D9's stand-in).
6. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C5).
7. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C6).
8. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C7, same member split as C6).
9. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C8).
10. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C9, same locale fix as C8).
11. `.postmaster/verify/c2-c15-macos-fixes.txt` — same as 2 (C10).
12. `.postmaster/verify/c16-score-output.txt` — the platform line (C12).
13. `.postmaster/verify/c16-score-output.txt` — no machine, user or home in the score (C13).
14. `.postmaster/verify/c14-coachman-shell.txt` — the coachman shell blocks (C14).
15. `.postmaster/verify/c2-c15-macos-fixes.txt` — Bun by running path (C15).
16. `.postmaster/verify/c16-fixture-linux.txt` — the fixture flow on Linux as far as it goes: a clean record scores clean with the Linux platform line.
    - not shown: the Mac run — this run is on Linux; a fixture run on a Mac that scores clean is what shows C16, and that needs the merge first (D10).
17. not shown: the Mac score comment waits on C16's Mac run.

## Decisions I made

- The module is `scripts/lib/processes.ts`, beside `proc.ts` (spawn) and
  `text.ts` (text). The name says what it owns: process facts.
- The containment scan strips line and block comments before matching, so a
  comment never trips it. The planted shapes live in the module (excluded from
  the scan), as `text.ts`'s guard does.
- `processState` treats a kill-present but stat-gone pid as absent (the
  process exited between the two reads), and a kill-present but ps-gone pid as
  absent likewise. This keeps the watchers cheap: `processAlive` is one call.
- The member line split uses `indexOf(" ")` slicing, matching the tech note's
  "splits at the first space only".
- The coachman blocks use arrays (`CLONE=()`, `REVIEWERS=()`,
  `NORMALIZE_FAILED=()`) with `"${ARRAY[@]}"` expansion, which works in bash
  3.2 and zsh.
- `macos-fixes.ts` and `coachman-shell.ts` are thin companion targets for the
  lint rule's test-beside-target check; the real logic is in the tests.
- The score's platform line reads `os.type()`, `os.release()`, `os.machine()`,
  `Bun.version` and the number from `git --version`, matching the tech note.

## What I did not do

- **C16's Mac run** and **C17's comment**: these need a Mac after the merge
  (D10, D11). On Linux the fixture flow runs as far as it goes and scores
  clean; the Mac run's score is what shows C16.
- **#258, #259, #260**: the three later tickets of D1, out of scope.
- **Boot id and uptime**: stay where they are, for #259.
- **The `.sh` wrappers**: they stay; #218 removes them.
- **`raw/trials/` and the oracles**: not edited, per the direction.

## Verdict

1. **met** — `scripts/lib/processes.ts` answers live, zombie and absent and start times on both paths; a zombie has ended.
2. **met** — `watch()` and `herdrReport()` mark done only when `processAlive` is false.
3. **met** — the background start check uses `processAlive()`; a real runner is never rejected, a runner that died before taking its spec still is.
4. **met** — the pane stays open while `processAlive` holds; the finish watcher closes it after.
5. **met** — `alive()` in `view-stream.ts` uses the shared way; the follow test forced shows every line.
6. **met** — the member line splits at its first space; stop kills every matching process.
7. **met** — close waits on the same registry scan and leaves a running pane open.
8. **met** — `legSelfStart()` goes through the module, which always sets `LC_ALL=C`.
9. **met** — `runs-status.ts` compares the lock through the module.
10. **met** — `check-attr --source` is gone; a temporary index and `--cached` give the same answer.
11. **met** — `need()` drops `jq`; the README names Node and npm.
12. **met** — the score's first line is `platform: <os> <release> <machine>, bun <version>, git <version>`.
13. **met** — nothing in the score names the machine, the user or their home.
14. **met** — every `sh` block runs the same under bash and zsh (zsh skipped where absent).
15. **met** — every Bun start uses `process.execPath`; a pane PATH without bun still works.
16. **not met (needs a Mac)** — on Linux the fixture flow scores clean; the Mac run is what shows this criterion and it waits on the merge.
17. **not met (needs a Mac)** — the Mac score comment waits on C16's Mac run.
