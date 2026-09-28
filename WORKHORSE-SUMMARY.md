# Workhorse summary: 114 A run runs on the postmaster version it was dispatched from

## What I built

- `4320c9d` — `WORKHORSE-SPEC.md`, the plan and tasks, committed before any code.
- `729806d` — pin a run to its dispatch commit in `scripts/run-meta.sh`: cut a shared worktree
  of the postmaster repo at the dispatch commit under `POSTMASTER_TOOLS` (default
  `~/.postmaster/tools/<sha>`), record it as `postmaster.checkout` in `run.json`, and add
  `pin`, `path`, `check` and `release`. `check` is the AC3 control (the pin still serves its
  commit's versions after main moved on); `release` removes the pin when no run in flight uses
  it (AC4). Self-test carries positive and negative controls in the repo's style.
- `6652f7f` — run every leg on the pin: the waybill's `tool:` names it
  (`SKILL.md`), `postmaster.md` Stage C resolves it with `run-meta.sh path`, runs `check`
  before each launch/resume, and uses it for `host.sh`, `launch.sh` and the leg prompt's
  `coachman.md`; Stage D's takeover does the same; Stage G step 3 and the abandon path call
  `release`. `coachman.md` says `<tool>` is the pinned checkout. `AGENTS.md` says a run runs
  on the version it was dispatched from and no longer says a contract change waits for the
  fleet; the fixture-run rule stays.
- `267c91a` — serialize pin cuts with `flock` so concurrent runs dispatched at one commit
  share one checkout (fixture's parallel `record` calls raced on `git worktree add`).
- `a74d45d` — isolate `verify.sh`'s workhorse `journey-path` self-test from
  `POSTMASTER_VERIFY`, so the gate passes when `verify.sh run` names the armed spec for every
  check (overlaps #113).

## Checks

From `/home/brindlewick/postmaster/scripts/verify.sh run .`, run just before this summary:

```
gate: pass, exit 0, 279s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other commands run, with exit codes:

- `scripts/run-meta.sh --self-test` — exit 0 (including the AC3 pin-after-main-moves control and the concurrent-cut control).
- `scripts/fixture.sh --self-test` — exit 0 after the pin race fix (failed before it).
- `scripts/launch.sh --self-test` — exit 0.
- `scripts/verify.sh --self-test` — exit 0 after the journey-path isolation fix.
- `scripts/skill-refs.sh` — exit 0 after the runbook edits.
- Six concurrent `run-meta.sh pin` calls on one commit — all exit 0, one shared checkout.

Earlier full-gate attempts under load hit `host.sh` (known flake #85) and `review-round.sh`
timing flakes and one `verify.sh` journey-path failure caused by `POSTMASTER_VERIFY` leaking
into the self-test; those are named above. The recorded gate run passed clean.

## Decisions

- **Pin path `~/.postmaster/tools/<full-sha>`** (`POSTMASTER_TOOLS` overrides the root): a
  deterministic function of the commit, shared across projects, outside any target's
  `.worktrees/`. A detached git worktree of the tool repo at that commit.
- **Pin verbs live in `run-meta.sh`, not a new script.** `run-meta.sh` already writes "what a
  run started from" at dispatch and is already in the stand-in gate's self-test list, so this
  run's gate exercises the new controls without changing a gate list that exists only in the
  already-dispatched project profile (stand-in until #17). No new script was added, so there
  was no gate self-test list to extend in the repo source.
- **"In flight" means manifest stage is not `done` and not `abandoned`.** A stuck run keeps
  its pin; that is conservative and safe for remount.
- **Release is the postmaster's, in Stage G step 3 after `stage.sh done`**, and in the abandon
  path after `stage.sh abandoned` — never the ship leg (still using the pin), never before the
  last leg's process has exited.
- **Uncommitted tool changes are not in the pin** (the pin is the commit, per the ticket's
  direction). `run.json` still records `uncommitted_changes`.
- **`check` verifies the pin's HEAD equals the recorded commit and its tracked tree is clean**
  — exactly "reads and runs the versions of its own commit". The identical command is `check`;
  the self-test also reads `coachman.md`'s marker from the pin and from the moved main
  (positive A / negative B).
- **Stage C resolves the run's tool via `run-meta.sh path`** so the runbooks are wired through
  the script rather than a hand-copied path.
- **`flock` around pin cut and pin remove.** Concurrent `git worktree add` of one commit fails
  on git's own lock and leaves no pin; the fixture self-test's parallel `record` calls hit
  this every time until serialized.
- **Journey-path self-test isolation** (`env -u POSTMASTER_VERIFY`) so `verify.sh run`'s
  `POSTMASTER_VERIFY` does not redirect the workhorse path question. Minimal fix; #113
  ("isolate journey path self-test") may overlap.

## What I did not do, and why

- **No new script**, so no gate self-test list change was needed; `run-meta.sh` is already in
  the list and carries the new controls. The stand-in gate lives in the run's project profile
  and the armed `checks.json` (stand-in until #17), not in the repo source.
- **No wiki page.** The ticket did not ask for one; `wiki-lint.sh` is in the gate and stayed
  clean. `wiki/concepts/run-config.md` is about the config pin and was left alone.
- **Old unpinned waybills still run.** `coachman.md` uses whatever `tool:` the waybill gives;
  `path`/`check`/`release` no-op on a `run.json` with no checkout.
- **Runs in flight when this lands keep the unpinned layout**, as the ticket notes.
- **Front door and postmaster supervision stay on the main checkout** (`<tool>`); only the
  run's legs move to `<rt>`, the pin.
- **Did not replace scripts** (#109) or touch teardown beyond the release step.

## Verdict on the acceptance criteria

1. **At dispatch the run is pinned to the postmaster commit it is dispatched from; the waybill
   names it as `tool:` and `run.json` records it.** Met. `run-meta.sh` cuts
   `~/.postmaster/tools/<sha>` at the dispatch commit, records `postmaster.checkout`, and the
   waybill template's `tool:` names that path.
2. **Every launch, resume and takeover of the run's legs runs from its pinned checkout.** Met.
   `postmaster.md` Stage C and the takeover prompt use `<rt>` for `host.sh`, `launch.sh` and
   `coachman.md`; the coachman's `<tool>` is the waybill's pin.
3. **A control shows a run dispatched at one commit still reads and runs its own versions in
   its next leg after `main` moves.** Met. `run-meta.sh check` plus its self-test: after the
   tool repo's branch moves on, the pin still reads A while main reads B (identical command
   `check`, and `marker_of` on `coachman.md`), with the negative control the same command on a
   record naming the moved checkout.
4. **A pinned checkout is removed once no run that uses it is in flight, and runs at the same
   commit share one.** Met. One path per commit; `release` keeps it while any run whose
   `run.json` names it has a stage other than `done`/`abandoned`, and removes it after
   `stage.sh done` / `stage.sh abandoned` (Stage G step 3 and abandon). Self-test covers
   keep-while-in-flight, remove-when-idle, and concurrent cuts sharing one pin.
5. **`AGENTS.md` says a run runs on the version it was dispatched from, and no longer says a
   contract change must land while the fleet is idle.** Met. The bites section now says the
   run is pinned to its dispatch commit and a change can merge with runs in flight; the
   fleet-idle sentence and "the only category that needs the fleet quiet" are gone; the
   fixture-run rule and its "quality, not the runs in flight" clause stay.
