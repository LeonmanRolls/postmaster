# Workhorse spec: 114 A run runs on the postmaster version it was dispatched from

## Summary

A run must not mix postmaster versions part-way through: at dispatch, cut a checkout of
postmaster at the dispatch commit, name it as the waybill's `tool:`, record it in `run.json`,
and run every leg launch, resume and takeover from it. Then a change can merge with runs in
flight. The pin is shared per commit and released when no run using it is still in flight.

## Technical context

- **Language and version**: bash with Python 3.11+ in heredocs, as the rest of `scripts/`.
- **Dependencies used or added**: none. git worktrees of the postmaster repo, under
  `~/.postmaster/tools/<sha>` (override: `POSTMASTER_TOOLS`).
- **Testing**:
  - `scripts/run-meta.sh --self-test` — pin cut, the AC3 control (positive and negative,
    identical command), sharing, and AC4 release / keep-while-in-flight.
  - The project gate in the waybill (this run's `checks`).
  - `scripts/skill-refs.sh` and `scripts/wiki-lint.sh` after runbook edits.
- **Constraints**:
  - Direction: pin is a worktree of the postmaster repo at the dispatch commit; the waybill
    names it as `tool:` and `run.json` records it.
  - Front door and postmaster supervision stay on the main checkout; only the run's legs move
    to the pin.
  - Old waybills whose `tool:` is the main checkout must still run.
  - Deterministic work in `scripts/`, not prose. Every count needs a control. Script paths in
    runbooks go through `<tool>`.
  - Runs in flight when this lands keep the unpinned layout.
  - Fixture-run rule for contract changes stays (it is about quality, not the fleet).

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Pin at dispatch: checkout at the commit, waybill `tool:`, `run.json` records it | `run-meta.sh` (called at dispatch) cuts `~/.postmaster/tools/<sha>` from the tool repo at HEAD and records `postmaster.checkout` beside `postmaster.commit`. Waybill template's `tool:` names that path. |
| Every launch, resume, takeover runs from the pin | `postmaster.md` Stage C resolves the run's tool via `run-meta.sh path` and uses it for `host.sh`, `launch.sh`, and the leg prompt's `coachman.md`. Coachman already uses the waybill's `tool:`. |
| AC3 control, positive and negative, identical command | `run-meta.sh check <dispatch>` compares the pin to its recorded commit (HEAD + clean tree). Positive: after the tool repo's branch moves on, check still passes. Negative: same command on a record naming the moved checkout fails. In `--self-test` as `ok` lines. |
| Share one checkout per commit; remove when no run in flight | Pin path is a function of the commit sha. `run-meta.sh release <dispatch>` removes it only when no other run whose `run.json` names it has a manifest stage other than `done`/`abandoned`. Removal: postmaster Stage G after `stage.sh done`, and the abandon path after `stage.sh abandoned`. |
| Front door / postmaster supervision on main checkout | `postmaster.md` keeps `<tool>` (live) for its own scripts; only Stage C leg launches and leg prompts use the pin. |
| Old unpinned waybills still run | Coachman reads whatever `tool:` the waybill gives; no format break. |
| AGENTS.md: run on dispatch version; no fleet-idle rule; keep fixture rule | Rewrite the bites section; keep the fixture sentence and other non-fleet contract-change sentences. |
| Gate self-test list if a script is added | No new script: pin verbs live in `run-meta.sh`, which is already in the gate's self-test list. |

## Structure

- `scripts/run-meta.sh` — add pin cut at dispatch (`postmaster.checkout` in `run.json`),
  and `check`, `release`, `path` verbs; extend `--self-test` with AC3/AC4 controls.
- `skills/postmaster/SKILL.md` — waybill template `tool:` line names the pinned checkout.
- `skills/postmaster/postmaster.md` — Stage B records the pin; Stage C launches legs from
  it; Stage G and abandon release it.
- `skills/postmaster/coachman.md` — say `<tool>` is the run's pinned checkout.
- `AGENTS.md` — AC5 wording.
- `skills/postmaster/controls.md` — note the pin under run-meta's row if needed.

## Complexity tracking

None.

## Decisions

- **Pin path `~/.postmaster/tools/<full-sha>`** (`POSTMASTER_TOOLS` overrides the root):
  shared across projects, a deterministic function of the commit, outside any target's
  `.worktrees/`. A git worktree of the tool repo, detached at that commit.
- **Pin logic in `run-meta.sh`, not a new script:** `run-meta.sh` already writes "what a run
  started from" at dispatch and is already in the stand-in gate's self-test list, so this
  run's gate exercises the new controls without changing a gate list that exists only in the
  already-dispatched project profile (stand-in until #17).
- **"In flight" means manifest stage is not `done` and not `abandoned`.** A stuck run keeps
  its pin; that is conservative and safe for remount.
- **Release by the postmaster after `stage.sh done` / `stage.sh abandoned`**, never by the
  ship leg (still using the pin) and never before the last leg's process has exited.
- **Uncommitted tool changes are not in the pin** (the pin is the commit, per the ticket's
  direction). `run.json` already records `uncommitted_changes`.
- **`check` verifies HEAD equals the recorded commit and the tracked tree is clean at it**,
  which is exactly "reads and runs the versions of its own commit".
- **Stage C resolves the run's tool via `run-meta.sh path`** so the runbooks are wired through
  the script, not a hand-copied path.

## Tasks

- [ ] T001 [AC1] [AC4] Extend `scripts/run-meta.sh`: pin cut at dispatch, `postmaster.checkout` in `run.json`, shared per commit, `path`/`check`/`release` verbs, self-test with positive and negative controls (`scripts/run-meta.sh`).
- [ ] T002 [AC2] Update `skills/postmaster/postmaster.md` Stage B/C/D/G and abandon so every leg launch, resume and takeover uses the pinned checkout (its `host.sh`, `launch.sh`, and the runbook the prompt names).
- [ ] T003 [AC2] Update `skills/postmaster/SKILL.md` waybill template `tool:` line and `skills/postmaster/coachman.md` so the waybill's `tool:` is the pin.
- [ ] T004 [AC3] Wire `run-meta.sh check` into the runbooks before a leg is launched, and prove the control in the self-test (pinned versions after the tool repo's branch moves on).
- [ ] T005 [AC4] Record exactly where release happens (postmaster Stage G after close, and abandon) and what "no run in flight" means; implement it in `run-meta.sh release`.
- [ ] T006 [AC5] Update `AGENTS.md`: a run runs on the version it was dispatched from; drop the fleet-idle rule; keep the fixture-run rule and other non-fleet contract-change sentences.
- [ ] T007 [AC1] Run `scripts/skill-refs.sh`, the gate, and write `WORKHORSE-SUMMARY.md`.
