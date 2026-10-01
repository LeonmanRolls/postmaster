# Workhorse spec: #200 Run every lane inside sandbox-runtime

(Coachman-authored unified spec, per the user's one-spec ruling on 2026-10-01:
both lanes implement from this one spec, in blinkers as before. Takes the
port-copy plan both lane specs agreed on, sol's run-record and project-host
design, and mimo's resolution and skip rules, with the `form` and temp-dir
calls decided below.)

## Summary

With `confine = "on"`, every lane launch, resume and review `scripts/launch.sh`
starts is wrapped from the outside in version-pinned sandbox-runtime, through
one OS-agnostic path, with the harness's own form and bypass flag unchanged
inside the wrap.

## Technical context

- **Language and version**: TypeScript run by Bun; the two-line shell wrappers
  only invoke Bun.
- **Dependencies used or added**: none in `package.json` beyond the port copy.
  sandbox-runtime (`srt`) 0.0.77 is an external CLI, resolved not vendored.
- **Testing**: `scripts/launch.sh --self-test` (the real confinement battery
  with paired controls); `bun test` on the copied and new test files;
  `bun run lint`; the full project gate; a real confined harness task against
  a `fixture.sh new` app. Per-criterion checks are under Checks below.
- **Constraints**: bypass flags untouched; one wrap path naming no OS; absent
  `confine` means off; never run a confined lane unconfined; `setup.sh` and
  `config.example.toml` are #201's; no wiki/`raw/` reads; work in blinkers.

## Direction check

| Constraint (ticket direction and project rules) | How this plan meets it |
|---|---|
| Wrap from the outside at the point `launch.sh` runs it | `launch.ts` builds the existing harness command, then one wrap step runs `srt --settings <file> -- <harness …>` for a lane. Launch, resume and review share it. |
| Bypass mode stays on, one mechanism for every harness | The wrap sits outside the form; every harness `launch.ts` supports gets an allow-list profile from the trial's lists, and an unknown harness fails closed. |
| Trial shim is a starting point, not a design | Allow-lists become validated data plus a tested builder; temp dir, prompt/last files and the settings file are computed per launch. |
| Shared git `hooks`/`config` read-only (#203 out of scope) | Both paths, resolved from the worktree's git common dir, go in `denyWrite` while staying readable; direct and replacement writes are tested. |
| Pin the research preview | One constant names 0.0.77; the version and path are recorded at dispatch and re-checked on every confined launch and resume. |
| Machine and project decisions separate | Top-level machine `confine` (`on`/`off`, absent is off); project gate hosts in shared/local project settings, merged. The dispatch record freezes both. |
| Deterministic work in scripts, harness facts in the adapter | Builder, wrap, host merge, version probe and controls are TypeScript with tests; `harnesses.md` records per-harness paths and hosts. |
| A prompt lives in argv | Unchanged; the prompt file is opened read-only in the settings. |
| Every count needs a control | Every self-test item runs unconfined (must succeed) and confined (must be refused or leave the disk clean). |
| TypeScript rule and port copy | One commit copies the port files unchanged; ticket work follows only in TypeScript and the two runbooks. |

## Structure

Copy unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232` and commit alone:
`scripts/launch.{sh,ts,test.ts}`, `scripts/run-meta.{sh,ts,test.ts}`,
`scripts/project-settings.{sh,ts,test.ts}`, `scripts/lib/{data,paths,proc,text}.ts`,
`scripts/lib/text.test.ts`, `bunfig.toml`, `package.json`, `tsconfig.json`,
`bun.lock`, `biome.json`, `.oxlintrc.json`, plus the `scripts/fixtures/` and
`types/` files the copied tests import. Then: add `scripts/lib/confine.ts` and
`scripts/lib/confine.test.ts` (resolve `srt`, build settings, merge hosts, wrap
a command); change `scripts/launch.ts` (read `confine`, wrap lane spawns,
fail closed, `--self-test` battery), `scripts/run-meta.ts` (record the
confinement object), `scripts/project-settings.ts` (validate and merge project
hosts), `package.json` (a `lint` script so `bun run lint` covers the tree),
`project.example.toml` (document the hosts key), `skills/postmaster/harnesses.md`
(Confinement section) and `skills/postmaster/coachman.md` (Lane capability).
`--self-test` on the three touched wrappers runs their adjacent bun tests.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Coachman and postmaster launches stay unconfined | The coachman must read every lane's worktree to synthesize | Confining every `launch.sh` process would lock the coachman out of its work |
| The battery skips by name when `srt` is absent, exit 0 | The gate must stay green on machines that chose `off` and never installed a research preview | Requiring `srt` would redden every gate where it is absent |
| Alternate-backend hosts from a lane `env_file` are not auto-allowed | Env files are named, never read | Parsing them would read secrets-adjacent user files the flow keeps opaque; the project lists those hosts |

## Decisions

1. **What is confined.** A launch, resume or review whose name is a lane in the
   effective `[lanes]` table. Coachman, fallback and postmaster are not.
2. **Where `srt` comes from.** `POSTMASTER_SRT` if set, else `srt` on `PATH`.
   Unresolvable, unexecutable or version-unreadable with `confine` on is exit 1
   naming what is missing; the harness never starts.
3. **What `run.json` records.** `run-meta` writes at dispatch
   `"confinement": {"mode": "on"|"off", "sandbox_runtime_version": string|null,
   "sandbox_runtime_path": string|null}`. Under `--run` a confined launch uses
   the recorded path and refuses a missing binary or a version mismatch. Mode
   disagreeing with recorded `config.confine` fails; a run without the object
   is accepted only when its config resolves to off.
4. **The wrap.** A single `srt --settings <file> -- <harness …>` step, no OS
   name in this repo's path. The harness argv inside is byte-identical to the
   off run, bypass flag included. `form` prints the wrapped command when on
   (it prints exact commands) and the bare form when off.
5. **Filesystem.** Trial lists, parameterised: home denied then named paths
   re-opened; worktree, git common dir, lane temp, harness state, npm/bun
   caches and the `srt` install as the trial had them; shared-clone
   alternates read-only; prompt read-only at its exact path; codex `-o`
   read-write, touched first. Real paths throughout. Git `hooks` and `config`
   are `denyWrite`, still readable.
6. **Lane temp dir.** Per-run per-lane under the machine harness-data root
   (pid-keyed without `--run`), created before the spawn; `TMPDIR` and
   `CLAUDE_CODE_TMPDIR` both point at it. Never inside the worktree.
7. **Hosts.** Per-harness trial hosts, plus `registry.npmjs.org` and
   `github.com`, plus the union of shared and local `[project] confine_hosts`.
   Exact hostnames and `*.` wildcards only; bare `*`, URLs, paths and
   malformed values are refused. Pi gets narrow per-provider sets (found from
   its docs at implementation, never guessed); grok/agy profiles follow the
   trial pattern from `harnesses.md` facts; a custom provider uses project hosts.
8. **Docs.** `harnesses.md` gains the per-harness paths and hosts;
   `coachman.md` Lane capability says lanes run confined (and stage named
   files, since `git add -A` fails inside) and drops the no-mechanical-
   enforcement claim. Neither restates wiki reasoning.
9. **Fixture (AC9).** The lane runs `fixture.sh new` plus a real confined
   harness task mirroring the trial prompt; the dispatched, scored fixture run
   is the coachman/postmaster's from the branch, per the merge rule.

## Tasks

- [ ] T001 [P] [AC1] Copy the port files unchanged and commit the copy alone;
  add the `lint` script; make the three touched `--self-test` entries run
  their bun tests; keep the gate green.
- [ ] T002 [P] [AC5] Find pi's real API hosts and grok/agy endpoints; record
  every harness's confinement paths and hosts in `harnesses.md`. No wiki reasoning.
- [ ] T003 [AC1] [AC2] [AC3] [AC4] Add `scripts/lib/confine.ts` (+ tests):
  resolve `srt`, build the settings document, merge hosts, wrap a command.
- [ ] T004 [AC1] [AC7] Wire `launch.ts`: wrap lane launch/resume/review when
  on, keep the harness form byte-identical, fail closed naming what is missing.
- [ ] T005 [AC7] [AC8] Extend `run-meta.ts` with the `confinement` object;
  refuse stale path or version mismatch under `--run`.
- [ ] T006 [AC5] Extend `project-settings.ts` with `[project] confine_hosts`
  validation and merge; record at dispatch; document in `project.example.toml`.
- [ ] T007 [AC6] Extend `launch.test.ts` with the plain-shell battery: every
  AC2–AC4 item with unconfined-positive and confined-negative controls, disk
  reads for writes, paired network controls; loud skip by name without `srt`.
- [ ] T008 [AC9] Run `fixture.sh new` plus a real confined harness task (gate,
  commit, reaches); record what the dispatched scored run must still show.
- [ ] T009 [AC10] Update `coachman.md` Lane capability; run `skill-refs.sh`.
- [ ] T010 [AC1] [AC2] [AC3] [AC4] [AC5] [AC6] [AC7] [AC8] Run the full gate to
  green, then `<tool>/scripts/verify.sh run .`, then write the summary.

## Checks

How a lane shows each acceptance criterion working the way it will really be used.

### AC1 — wrapped, form unchanged, one OS-free path
With `confine = "on"` in `POSTMASTER_CONFIG`: `scripts/launch.sh form t`
prints `launch: … srt --settings … -- codex exec … --dangerously-bypass-
approvals-and-sandbox …` and a wrapped `resume:` line; with `off` both lines
are the bare BASE form. A stub harness launched under `on` records argv
byte-identical to the `off` run. `grep -rinE 'linux|darwin|bwrap|sandbox-exec'
scripts/lib/confine.ts scripts/launch.ts` prints nothing.

### AC2 — a confined lane can do its work
`scripts/launch.sh --self-test` with real `srt` 0.0.77 on `PATH` exits 0 and
names each allowed item twice: gate, commit in own worktree, temp write,
prompt read, harness state write, API-host and registry reach — `unconfined:
ok` and `confined: ok` on every line.

### AC3 — a confined lane reaches nothing else
Same self-test run: each denied item reads `unconfined: reached` then
`confined: refused`, and the main-checkout write, other-lane read/write,
home read, outside Unix socket, outside signal and off-list host lines all
confirm the host disk is clean afterwards.

### AC4 — shared git `hooks` and `config` read-only
Same self-test run: direct writes, replacements and symlink swaps against
both paths are refused with the files byte-identical afterwards, while AC2's
commit line proves the lane still commits through the shared store.

### AC5 — per-harness records, project hosts
`harnesses.md` carries a Confinement section with a paths-and-hosts row for
codex, claude, muse, mimo, pi, grok and agy. A fixture project with
`[project] confine_hosts = ["<listed>"]`: a confined probe reaches the listed
host and is refused an unlisted one; a malformed entry is refused at parse
with the value named.

### AC6 — self-test with controls
`scripts/launch.sh --self-test` exits 0; its output names every AC2–AC4 item
once unconfined (must succeed) and once confined. With `srt` off `PATH` the
same command exits 0 with each confinement control `skipped (no srt)` by name.

### AC7 — fail closed, never unconfined, mode recorded
`confine = "on"`, `srt` unresolvable: `launch` exits 1, stderr names the
missing piece, and a stub harness plants no marker (never ran). `off` runs as
BASE. A dispatch with `on` records `"mode": "on"` in `run.json`; with `off`
or absent, `"off"`.

### AC8 — pinned version recorded and enforced
`run.json` carries `"sandbox_runtime_version": "0.0.77"` plus the resolved
path; pointing the run at another `srt` makes the next launch exit 1 naming
the mismatch.

### AC9 — fixture run scores clean
The lane's real confined harness task against a `fixture.sh new` app passes
that app's gate, commits, and reaches nothing outside; `scripts/fixture.sh
score` on the dispatched all-confined run from this branch prints clean (run
by the coachman/postmaster, not the lane).

### AC10 — runbooks say confined
`coachman.md` Lane capability contains `confin`, contains no
`No harness has verified mechanical` and no `no mechanical enforcement`, and
tells lanes to stage named files; neither runbook repeats the wiki's
`lane-confinement` reasoning (judged by reading, not grep).
