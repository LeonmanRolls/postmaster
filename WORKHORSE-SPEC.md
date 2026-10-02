# Workhorse spec: 217, Postmaster runs on macOS, shown by a macOS job in CI and a fixture run on a Mac

## Summary

Make postmaster run on macOS as well as on Linux: route every process-liveness
check through one `/proc`-or-`ps` helper, fix each macOS failure the audit
found, fix or state-with-a-message everything that merely degrades, and prove
it with forced-branch tests on Linux, a macOS job in CI, and a fixture run on
a Mac.

## Technical context

- **Language and version**: TypeScript on Bun 1.4.2 or newer, run in place
  through the uniform two-line `scripts/*.sh` wrappers, as today. Shell in
  wrappers and runbook blocks must run under bash 3.2 and under zsh. No new
  Python anywhere; `jq` stops being required.
- **Dependencies used or added**: none. Runtime imports stay Bun built-ins and
  Node standard modules; CI uses `actions/checkout@v4`,
  `oven-sh/setup-bun@v2`, and `actions/setup-node` only if the gate needs
  Node (the experiment in D14 decides).
- **Testing**: `bun run check` (exit 0) from the worktree root; the
  per-criterion checks in the table below, each run on Linux by forcing the
  macOS branch where one exists (one proc-root setting, one platform
  override); the run's frozen `coachman-contract` check
  (`scripts/coachman-contract.sh --self-test`, exit 0). Timing controls in
  the host self-test are load-sensitive: generous margins, and a lone timing
  failure is re-run on a quieter machine before it is judged, per the
  waybill's standing rule.
- **Constraints**: one helper, not per-site patches; callers get no
  macOS-only branch; the watchers stay cheap (poll every 250 to 500 ms,
  `process.kill(pid, 0)` for liveness where that is enough, the zombie read
  only when the process is still there, `LC_ALL=C` on every `ps` call);
  nothing repo-specific and nothing harness-specific; deterministic checks
  live in `scripts/`; every fail-before/pass-after pair and every
  positive/negative control runs through the identical command; `raw/trials/`
  and `oracle-*.sh` are evidence and are never edited; a script added now
  gets a wrapper like the others; the Bun-minimum check lives where every
  entry form passes through it so #218 cannot drop it.

## Direction check

- Ticket direction "one helper, not patches at each site": a single new
  module in `scripts/lib/` owns every per-pid liveness and zombie read; the
  three `host.ts` watcher sites, the `view-stream.ts` follower and the
  self-test's liveness reads call it, and a containment test fails if a
  per-pid read lives anywhere else.
- Ticket direction "`process.kill(pid, 0)` may serve liveness ... the zombie
  state comes from the `/proc` or `ps` read": the helper answers exactly
  live, zombie or absent; the cheap signal probe first, the state read only
  when the process is still there.
- Ticket direction "callers get no macOS-only branch": the only branch is
  inside the helper, on `/proc` presence through the one proc-root setting
  (D1). No caller switches on platform for liveness.
- Ticket direction "lands after a fixture run on Linux scores clean as well
  as the Mac run": this change touches contract files (the `coachman.md`
  shell blocks, `scripts/fixture.ts`), so lanes keep the contract self-test
  green; both fixture runs are ship-time and not lane work (D13).
- Ticket direction "where a macOS branch can be forced on Linux, the tests
  force it": D1 and D2 name the two overrides; every forced-branch test
  states what it forced and what it returned, never "verified on macOS".
- Ticket direction "memory caps stay with #140": caps only degrade here with
  a stated message; the wiki page records them as #140's.
- Ticket direction "archived trial scripts are evidence and are not edited":
  `raw/**`, `oracle-*.sh` and `fixtures/` stay out of the
  portability checker's scope (D7); the wiki page lists the trial scripts
  and the two oracles as Linux-only.
- Ticket direction "#218 runs at the same time": new scripts get uniform
  wrappers; the Bun-minimum check has a wrapper layer and a shared-TS layer
  (D8), so whichever entry form survives keeps it; isolation-flag argv in
  re-spawned children stays byte-identical (D12).
- Project rule "nothing repo-specific": no hardcoded paths, hosts or users;
  platform is detected (`uname`, `/proc` presence, binary probes), never
  configured, apart from the two test overrides.
- Project rule "nothing harness-specific in the flow": the `ps` invocations
  use flags valid on BSD and on Linux procps; no per-harness branch.
- Project rule "deterministic work goes in `scripts/`, not in prose": the
  portability check, the skip enforcement and the Bun check are scripts with
  tests, not runbook instructions.
- Project rule "every count needs a control": each fix carries a
  fail-before/pass-after test; each checker carries positive and negative
  controls through the same command.
- Ticket notes "a launch with no harness record is never counted finished"
  was proposed separately: out of scope. Lanes do not implement it. The
  person running the Mac fixture still runs the report's sixth control as
  an observation.

## Structure

- AC1: one new module in `scripts/lib/` (the lane names the file) owning
  every per-pid liveness and zombie read, plus its `<name>.test.ts`. It
  absorbs the per-pid readers in `scripts/host.ts` (`procStat`, the
  `watch()`, background-runner and headless-agent sites, the
  `processes()`/`processTable()` enumeration, the
  `startOf()`/`legStart()`/`legSelfStart()` readers), `alive()` in
  `scripts/view-stream.ts`, the lock check in `scripts/runs-status.ts`,
  and the liveness reads in `scripts/host-self-test.ts`; all of them
  route through it, so the one D1 override forces every branch. Bare
  `kill(pid, 0)` stays allowed for liveness-only probes that need no
  zombie answer.
- AC2: the same files' behavior, proved by marker tests beside the host
  tests; no new product file.
- AC3: `scripts/host.ts` (registry member split, `lstart` locale, absolute
  Bun path at every re-spawn site the audit lists);
  `scripts/synthesis-shares.ts` (portable `check-attr` replacement);
  `scripts/fixture.ts` (`need()` drops `jq` and `npm`);
  `fixtures/app/.postmaster/project.toml` (gate becomes `bun run check`),
  `fixtures/app/package.json` (the check script runs under Bun alone) and a
  committed Bun lockfile for the fixture app so `install=` is Bun;
  `skills/postmaster/coachman.md` (the shell blocks about lines 771 to 849
  quote-safe under bash and zsh); tests beside each touched script.
- AC4: `scripts/setup.ts` (limit questions gated on enforcement plus the
  D2 override); one wiki page `wiki/concepts/macos-portability.md` plus a
  `## Platforms` entry in `wiki/index.md`; per-item fixes or messages in
  `scripts/host.ts` (`timeout`, `flock`, systemd notice, boot id, FIFO),
  `scripts/lib/proc.ts` (signal table), `scripts/review-findings.ts` (task
  root), `scripts/project-settings.ts` (`~user`), `scripts/review-round.ts`
  (boot id, monotonic), `scripts/launch.ts` and
  `scripts/export-session.ts` (XDG note), each with its test or message.
- AC5: `scripts/darwin-skip.toml` (new, D4) plus a skip helper (new module
  in `scripts/lib/`, the lane names it) and its gate enforcement; fixes or
  skip entries for the audit's test list (`host-self-test.ts`,
  `host.test.ts`, `launch.test.ts`, `landing.test.ts`, `local.test.ts`,
  `log-action.test.ts`, `run-meta.test.ts`, `review-round.test.ts`,
  `view-stream.test.ts`, `spec-session.test.ts`, `tool-faults.test.ts`,
  `verify-journey.test.ts`), each audit line verified by reading first.
- AC6: `scripts/portability-check.ts` (new) with the uniform
  `scripts/portability-check.sh` wrapper and
  `scripts/portability-check.test.ts`; `package.json` (the `check` script
  runs it); `.postmaster/project.toml` (the gate `shows` text names it).
- AC7: `.github/workflows/check.yml` (new; `pages.yml` untouched).
- AC8: `README.md` (supported platforms, requirements);
  `skills/postmaster/trackers.md` (the `python3` line); the Bun-minimum
  check in every `scripts/*.sh` wrapper and in one shared TS module (D8).
- AC9: no code. Ship-time runs, not lane work (D13).
- Untouched: `raw/**`, `oracle-*.sh`, `fixtures/tickets/**`,
  `.github/workflows/pages.yml`, and every isolation-flag argv (D12).

## Decisions

- D1. `POSTMASTER_PROC_ROOT`: the one proc-root setting. When set, the
  helper reads per-pid state from that directory instead of `/proc` (same
  layout: `<pid>/stat`); a value pointing at a folder that does not exist
  forces the no-`/proc` branch on Linux. Unset means `/proc`. Empty means
  `/proc`. A file (not a directory) at the path behaves as no-`/proc`.
- D2. `POSTMASTER_PLATFORM`: the platform override for `setup.ts` and the
  skip helper only, never for liveness. `darwin` forces the macOS path,
  `linux` forces the Linux path, unset means the real platform. Any other
  value is an error naming the value.
- D3. The helper answers exactly live, zombie or absent, and a zombie is
  not live anywhere: the marker lands for zombie and absent alike. No new
  PID-reuse machinery: callers that already compare start tokens keep
  doing so through what the helper returns, and `watch()` keeps its bare
  pid contract. Enumeration and start readers route through it
  (Structure), so the one override forces the `ps` branch's five-word
  table on Linux for the AC3 registry test. Bare `kill(pid, 0)` stays
  allowed for liveness-only probes; every read that distinguishes zombie
  goes through the helper.
- D4. The skip file is `scripts/darwin-skip.toml`: repeated `[[skip]]`
  tables, each with a non-empty `name` (the exact test name) and a
  non-empty `reason`. Skipping an unlisted name throws, so the gate fails
  on any platform. The call shape follows the `test.skipIf` precedent in
  `launch.test.ts`; no platform-motivated raw `skip`/`skipIf` outside the
  helper, enforced by a gate step the lane adds.
- D5. The wiki page is `wiki/concepts/macos-portability.md`: front matter
  `title`, `type: concept`, `standing: claimed`, `updated`, no `sources`;
  one entry under a new `## Platforms` section in `wiki/index.md` between
  `Trackers and tooling` and `Testing the flow`; the lead states once that
  macOS behaviors rest on documented behavior pending the CI macOS job and
  the Mac fixture run; each row gives file, macOS behavior, and the test
  or message with a relative link to it; rows resting only on docs carry
  `unverified` in the row. No `wiki/log.md` entry: the log records wiki
  operations, and this page arrives via ticket.
- D6. The workflow is `.github/workflows/check.yml`, on `pull_request` and
  on push to `main`: jobs `macos` (`macos-latest`) and `linux`
  (`ubuntu-latest`); each checks out with `fetch-depth: 0`, sets up Bun
  `1.4.2`, sets up Node only if D14 needs it (with a comment naming the
  step), runs `bun install --frozen-lockfile`, then `bun run check`.
- D7. `scripts/portability-check.sh [path...]` mirrors `skill-refs.sh`:
  default the repo root, exit 0 when clean, exit 1 with `file:line`
  faults on stdout, exit 2 on usage or unreadable input. Scope is
  `scripts/**/*.ts` and the shell blocks of `skills/postmaster/*.md`;
  `raw/**`, `oracle-*.sh` and `fixtures/**` are out. The lane defines the
  ownership map (which code owns each construct) in the checker and
  documents it in its summary.
- D8. The Bun minimum is enforced in two layers, both naming `1.4.2` in
  the refusal message: every `scripts/*.sh` wrapper compares `bun
  --version` before it execs (bash 3.2-safe, no external parser), and one
  shared TS module compares `Bun.version` and is imported by every
  runnable `scripts/*.ts`. A test pins both hardcoded minima to the
  `engines.bun` declaration, and a gate test asserts every wrapper and
  every runnable script carries its layer.
- D9. Setup asks the eight limit questions only where launch caps can
  enforce them (cheap detection the lane chooses: it must skip on Darwin;
  `uname` Linux plus `systemd-run` present plus cgroup controllers
  readable is sufficient). `POSTMASTER_PLATFORM` forces either way for
  tests. An `--answers` file carrying `limits.*` keys on an unenforcing
  platform warns on stderr, writes no `[limits]` table, and continues.
- D10. The `check-attr --source` replacement uses only git flags present
  in Apple Git 2.39 (the lane cites each flag's introduction version) and
  preserves `--source` semantics: attributes as of an arbitrary commit
  without checking it out. The macOS CI job is the old-git proof.
- D11. Registry member lines split at the first space: the pid is the
  head, the start token is everything after it, so a five-word `lstart`
  survives whole. Non-numeric pid heads are ignored, as today.
- D12. Every re-spawned Bun (the Herdr typed line, the tmux `bash -c`
  line, `startDetached`, the `view-stream` follower, the `launch.ts` and
  `stage.ts` sites the audit lists) uses the absolute path of the running
  Bun (`process.execPath`), quoted. Every other argv byte, including the
  isolation flags, stays identical: flag changes belong to #218.
- D13. The Linux contract fixture run is the postmaster's at the final
  card; the Mac fixture run is a person's after that. Lanes record AC9 as
  `not shown: needs a person with a Mac at ship time` and dispatch no
  runs.
- D14. Each lane runs the full gate with Node and npm hidden from PATH.
  Green means CI needs no `setup-node` step and the README claims
  Bun-only (plus git and the session host). A step that genuinely needs
  Node gets the CI step with a comment and a README line naming it, with
  the transcript that proves the need.
- D15. Every audit file-and-line is verified by reading before it is
  used. Drift is recorded, not copied: `checks.sh:54` names no file in
  the tree, and the audit header's "reports 1 and 3 ... pending" is stale
  (all four reports are present). The wiki page is the corrected record.
- D16. `timeout` and `flock` are never shelled out to where the tree owns
  the call: `lib/proc.ts run()` already takes a millisecond timeout, and
  the `flock` fallbacks either move to `lockf -k` on BSD or keep their
  weaker behavior with the exact message the user sees, stated on the
  wiki page. The lane chooses per site and records each.
- D17. The fixture app's gate and install run with Bun alone: declared
  gate `bun run check`, a Bun-native check script (no bare `tsc`/`biome`
  with node shebangs on the path), and a committed Bun lockfile so
  `install=` is `bun install --frozen-lockfile`. The app's tests and
  tickets stay untouched.
- D18. AC3's zsh proof has two halves everywhere: a static check that no
  runbook shell block carries an unquoted multi-word variable (the
  fail-before proof on Linux), and the blocks run under `zsh -c` with
  stubbed placeholders where zsh is present (macOS CI runs it; Linux
  without zsh records the skip with its reason).
- D19. Where the ticket's problem statement and the audit disagree on a
  detail, the code as read wins; the lane records the correction in its
  summary and on the wiki page where the page covers it.

## Showing each criterion

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
|---|---|---|---|
| AC1 | Every liveness and zombie check goes through one process-state helper that answers live, zombie or absent, from `/proc/<pid>/stat` where `/proc` exists and from `ps -o stat= -p <pid>` where it does not. The three watchers, the `view-stream.ts` follower and the self-test use it. Check: a search of the scripts finds `/proc/<pid>` reads for liveness only inside the helper, and tests force both branches on Linux by pointing the helper's proc root, one setting, at a folder that does not exist. | (a) The helper's test beside it: a live pid answers live, a planted `Z` fixture stat answers zombie, a dead pid answers absent; each run twice, with `POSTMASTER_PROC_ROOT` unset (the `/proc` branch) and pointed at a folder that does not exist (the `ps` branch); zombie on the `ps` branch via a stub `ps` on PATH printing a `Z` state. (b) The containment test: fails if any per-pid stat read lives outside the helper module. (c) From the worktree root, `grep -rn '/proc/' scripts/host.ts scripts/view-stream.ts scripts/host-self-test.ts`: only owned non-liveness reads remain (boot id, uptime, cmdline). | (a) all six answers correct on both branches. (b) exit 0. (c) the grep shows only the owned reads, each named in the lane's summary. |
| AC2 | A live process never produces its completion marker, and the marker lands after it exits or becomes a zombie. Where there is no `/proc`, a live background runner is not rejected as "did not start", a Herdr launch's pane stays open until the harness process exits, and the headless agent is released only then. Check: tests run one live and one exiting process through both branches, and assert all of this, the live case as the negative control and the exit as the positive. | (a) With `POSTMASTER_HOST=none`, `host.sh run` a `sleep 30` with `--marker`: poll 3 s, the marker is absent while it lives (negative control); kill it, the marker lands within 5 s. (b) `host.sh run` a `sh -c 'exit 3'`: the marker lands with the exit recorded (positive control). Run (a) and (b) twice: default env and `POSTMASTER_PROC_ROOT` at a missing folder. (c) The no-`/proc` live run prints no `did not start in the background`. (d) The AC1 containment test covers the Herdr pane and headless-agent sites (no direct liveness read remains in `host.ts` at all); their end-to-end proof is the Mac fixture run. | (a) no marker while live, marker after the kill, on both branches. (b) marker with exit 3, on both branches. (c) no rejection line. (d) containment green. |
| AC3 | Each of the other items under "the flow fails or misbehaves" is fixed, and each fix has a test that fails before it and passes after, run on Linux by forcing the macOS branch where one exists. Check: the card lists each item with its test, and `host.sh stop` against a registry written with a five-word start time, `fixture.sh score` without `jq` and `npm` on PATH, and the zsh blocks run under `zsh -c` where zsh is present are among the tests. | (a) Registry: start a real `sleep`, rewrite its record's starts to the five-word `ps lstart` form, and with `POSTMASTER_PROC_ROOT` at a missing folder (forcing the `ps` branch's five-word table) `host.sh stop` stops it. (b) `lstart` locale: a stub `ps` on PATH records its environment; the leg-lock call carries `LC_ALL=C`. (c) `check-attr`: with a stub `git` refusing `--source`, the synthesis measurement still reports shares on a commit carrying `linguist-generated` attrs. (d) Fixture: `fixture.sh score` starts past `need()` with `jq` and `npm` hidden (no `not on PATH` death), and the fixture app's discovered gate and install are the Bun forms, run green with node and npm hidden. (e) Runbook blocks: the static no-unquoted-variable check plus the blocks under `zsh -c` with stubbed placeholders where zsh is present (D18). (f) Bun path: a background launch succeeds with `bun` absent from PATH, and the Herdr typed line plus the tmux argv carry the absolute path (stub assertion). Each item's test is shown failing on the un-fixed code (fix stashed) and passing with it. | (a) the sleep dies by stop. (b) `LC_ALL=C` recorded. (c) shares reported, no `--source` call. (d) score proceeds; the app gate green under Bun alone. (e) static green everywhere, `zsh -c` green where present. (f) launch green without `bun` on PATH. Six fail-before transcripts, six passes, the registry one under the forced branch. |
| AC4 | Each item under "works, but degrades" is fixed or its macOS behaviour is stated with the message the user sees, on one wiki page that lists every Linux-specific construct found with its file, its macOS behaviour and the test or message that shows it. Setup asks no limit questions where nothing enforces them. Check: the page exists, `scripts/wiki-lint.sh` passes, and setup run with the platform forced to Darwin asks none. | (a) `scripts/wiki-lint.sh` exits 0 with the new page and index entry in place. (b) `POSTMASTER_PLATFORM=darwin setup.sh --answers <file-with-limits-keys>`: completes, writes no `[limits]`, warns on stderr. (c) With an answers file lacking the limits keys: the linux-forced run prints the Launch limits section with all eight cap echoes; the darwin-forced run prints no Launch limits section and no cap echo. (d) Every wiki row carries its test (in the gate) or its exact message (quoted from the code). | (a) exit 0. (b) exit 0, no `[limits]`, warning present. (c) eight cap echoes on linux-forced; no limits section on darwin-forced. (d) no row without its proof. |
| AC5 | Each test under "cannot pass on macOS" is fixed, or skipped by name in one skip file with its reason, and the gate fails on a skip that has no entry. Check: the skip file exists, each entry has a reason, and a test skipped without an entry fails `bun run check`. | (a) `scripts/darwin-skip.toml` parses; every entry has a non-empty name and reason. (b) `bun run check` exits 0 on Linux. (c) The helper's negative control: skipping an unlisted name throws (fails the gate on any platform). (d) `POSTMASTER_PLATFORM=darwin bun test <each touched test file>`: listed tests skip by name, the rest pass. | (a) valid, no entry without a reason. (b) exit 0. (c) the plant fails with the missing-entry error. (d) skips named, no other failures. |
| AC6 | A script, `scripts/portability-check.ts`, fails on a new use of a Linux-only construct outside the code that owns it: `/proc` reads, `timeout`, `setsid`, `flock`, `jq`, `python3`, GNU-only flags, `/bin/true` or `/bin/false`, and unquoted multi-word variables in the runbooks' shell blocks. The gate runs it. Check: a positive control (a clean tree passes) and a negative control per construct (a planted use is refused with its file and line), through the same command. | (a) `scripts/portability-check.sh` on the clean tree: exit 0. (b) Nine plants, each in a scratch copy, each run through the same command: a `/proc` read outside the helper, `timeout`, `setsid`, `flock`, `jq`, `python3`, a GNU-only flag, `/bin/true` and `/bin/false`, an unquoted multi-word variable in a runbook block copy. (c) `package.json`'s check names the checker, and planting one construct in the worktree turns `bun run check` red (plant removed after). | (a) exit 0, no faults. (b) nine refusals, each exit 1 naming file and line. (c) gate red while planted, green after removal. |
| AC7 | A GitHub Actions workflow runs `bun run check` on a macOS runner and on Linux for every pull request, with Bun pinned to 1.4.2, a full-history checkout and a frozen install. Check: the workflow file exists, and the pull request's checks show both jobs green before it merges. | (a) `.github/workflows/check.yml` parses as YAML and holds `macos` and `linux` jobs with `actions/checkout@v4` at `fetch-depth: 0`, `oven-sh/setup-bun@v2` at `bun-version: 1.4.2`, `bun install --frozen-lockfile`, and `bun run check` (plus `setup-node` only per D14, commented). (b) The jobs-green half is shown on the pull request, not by the lane. | (a) every required step present in both jobs. (b) pending at lane time; the postmaster reads the jobs before the merge. |
| AC8 | The supported platforms and the Bun minimum are stated and enforced. Check: the README names Linux and macOS as supported, the stale Python and `jq` requirement lines are gone, and a script run under a Bun older than 1.4.2 exits with a message that names the version it needs. | (a) `grep` shows the README's supported-platforms statement naming Linux and macOS, and no Python-3.11 or `jq` requirement remains in the README or `trackers.md`. (b) With a stub `bun` reporting 1.3.14 first on PATH, a wrapper exits non-zero naming 1.4.2; reporting 1.4.2, it proceeds. (c) The shared TS module's comparison is unit-tested both sides of 1.4.2. (d) The presence test asserts every wrapper and every runnable script carries its layer; the pin test asserts both minima equal `engines.bun`. | (a) platforms named, stale lines gone. (b) refusal naming 1.4.2, then success. (c)(d) all green. |
| AC9 | A fixture run on a Mac scores clean. A person with a Mac dispatches a fixture run from the final head and scores it with `fixture.sh score`, and the output is posted on the pull request. Check: the output is on the pull request, its platform line names macOS, and every score line is ok. The ticket does not close until this is done. | No lane check: `not shown: needs a person with a Mac at ship time` (D13). | The summary carries the line; the postmaster schedules the run. |

## Tasks

- [ ] T001 [P] [AC1] Write the one process-state helper as a new module in `scripts/lib/` with `<name>.test.ts`: live/zombie/absent from `/proc/<pid>/stat` or `ps -o stat= -p <pid>`, `POSTMASTER_PROC_ROOT` override (D1), zombie fixtures plus stub-`ps` tests on both branches.
- [ ] T002 [AC1] Convert the `scripts/host.ts` readers (`procStat`, watcher sites, enumeration, start readers), `alive()` in `scripts/view-stream.ts`, the lock check in `scripts/runs-status.ts`, and the liveness reads in `scripts/host-self-test.ts` to the helper; add the containment test failing on any per-pid stat read outside the helper.
- [ ] T003 [AC2] Add the marker tests beside the host tests: live `sleep` (no marker while live, marker after kill) and exiting `sh -c 'exit 3'` (marker with exit), each under default env and `POSTMASTER_PROC_ROOT` at a missing folder, plus the no-`did not start` assertion.
- [ ] T004 [P] [AC3] Fix the registry member split (D11) and the `lstart` locale in `scripts/host.ts`; add the five-word `host.sh stop` test and the stub-`ps` `LC_ALL=C` test in `scripts/host.test.ts`.
- [ ] T005 [P] [AC3] Replace `git check-attr --source` in `scripts/synthesis-shares.ts` with the D10 portable form; add the stub-`git` measurement test in `scripts/synthesis-shares.test.ts`.
- [ ] T006 [P] [AC3] Drop `jq` and `npm` from `need()` in `scripts/fixture.ts`; set the fixture app gate to `bun run check` in `fixtures/app/.postmaster/project.toml`, make `fixtures/app/package.json`'s check script Bun-native, and commit the fixture app's Bun lockfile (D17); add the hidden-tools tests in `scripts/fixture.test.ts`.
- [ ] T007 [P] [AC3] Rewrite the `skills/postmaster/coachman.md` shell blocks (about lines 771 to 849) quote-safe under bash and zsh; add the static no-unquoted-variable check and the `zsh -c` run with stubbed placeholders where zsh is present (D18).
- [ ] T008 [P] [AC3] Use the absolute running-Bun path at every re-spawn site in `scripts/host.ts`, `scripts/launch.ts` and `scripts/stage.ts` (D12), keeping all other argv bytes identical; add the PATH-stripped launch test and the typed-line argv assertion.
- [ ] T009 [P] [AC4] Gate the eight limit questions in `scripts/setup.ts` on enforcement with the `POSTMASTER_PLATFORM` override (D2, D9); add the darwin-asks-none, linux-asks-eight, and answers-keys-warn tests in `scripts/setup.test.ts`.
- [ ] T010 [AC4] Fix or message each degrade item in `scripts/host.ts`, `scripts/lib/proc.ts`, `scripts/review-findings.ts`, `scripts/project-settings.ts`, `scripts/review-round.ts`, `scripts/launch.ts` and `scripts/export-session.ts`, each with its test or exact message (D16).
- [ ] T011 [AC4] Write `wiki/concepts/macos-portability.md` and the `## Platforms` entry in `wiki/index.md` per D5; `scripts/wiki-lint.sh` exits 0.
- [ ] T012 [AC5] Write `scripts/darwin-skip.toml` and the skip helper in `scripts/lib/` with gate enforcement (D4); fix or list each test in the audit's test list plus `scripts/runs-status.test.ts:73` (own-stat fixture read the audit missed), verifying every audit line by reading first (D15).
- [ ] T013 [P] [AC6] Write `scripts/portability-check.ts` with the uniform `scripts/portability-check.sh` wrapper and `scripts/portability-check.test.ts` (D7); wire it into `package.json`'s check and the gate `shows` text in `.postmaster/project.toml`; run the positive plus nine negative controls.
- [ ] T014 [P] [AC7] Write `.github/workflows/check.yml` per D6; validate the YAML and every required step in both jobs.
- [ ] T015 [P] [AC8] State Linux and macOS support and drop the stale Python/`jq` lines in `README.md` and `skills/postmaster/trackers.md`; add the two-layer Bun-minimum check with refusal message, presence test and engines pin (D8).
- [ ] T016 [P] [AC9] Record `not shown: needs a person with a Mac at ship time` in `WORKHORSE-SUMMARY.md`; dispatch no runs (D13).
- [ ] T017 [P] [AC8] Run the D14 experiment: the full gate with node and npm hidden from PATH; keep the transcript under `.postmaster/verify/`; settle the `setup-node` step and the README requirements from it.
- [ ] T018 [AC1] Run `bun run check` to exit 0 from the worktree root (aggregating every AC's tests), then the run's frozen `verify.sh run .`, then `summary-evidence.ts`; keep all three transcripts under `.postmaster/verify/`.
