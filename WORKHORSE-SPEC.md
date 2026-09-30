# Workhorse spec: 110 A project's gate never sees the run's own working copies

Shared coachman spec, committed identically in both worktrees: both lanes implement from this one spec.

## Summary

The flow keeps each run's working copies inside the target repository (`.worktrees/`), so any folder-walking project tool reads them and the gate on main fails after a merge. This spec moves every run working copy outside the project folder through one deterministic path script, records why in the wiki, and proves it with a positive and a negative control.

## Technical context

- **Language and version**: Bash with Python in heredocs, matching the existing flow scripts; run in place, no build step.
- **Dependencies used or added**: none; `git worktree add` already accepts an absolute path outside the repository.
- **Testing**:
  - `scripts/worktree-root.sh --self-test`: the AC3 control pair (identical check; pass with copies only outside, fail with a copy under `.worktrees/`) and the root rule.
  - The project gate from the worktree root, with the new script's self-test in `.postmaster/project.toml`'s list.
  - `scripts/wiki-lint.sh` after the wiki page lands; `scripts/skill-refs.sh` after the runbook edits.
  - `scripts/fixture.sh --self-test` and its scoring assertion for AC4.
- **Constraints**: the ticket's direction (a change in the flow, never asking projects to ignore `.worktrees/`); the design rules (nothing repo-specific, deterministic path work in `scripts/`, every count a control, `<tool>/` script references, every action logged); a coachman cannot remove its own worktree, so the gate must be clean while the synthesis worktree still exists; in-flight runs stay on their pinned tool.

## Direction check

- The ticket's direction asks for a flow change that keeps project tools from ever seeing run working copies. Working copies are cut outside the project folder by the flow; no project ignore rule is required or requested.
- AC1 is met structurally: nothing a run cuts lives under the project tree, so the gate on main cannot read a run's copies even before teardown, including sibling runs' copies.
- AC4 is the same mechanism: the synthesis worktree may still exist right after the merge, but it is outside the repo, so the fixture gate on main is clean; fixture scoring asserts this shape.
- Generic and deterministic: the root is derived from the repo path by one script every caller uses; no hardcoded hosts, paths, or project names.
- Every count a control: AC3's positive/negative pair runs through the identical check.

## Structure

- `scripts/worktree-root.sh` (new): given a repo path, prints the outside worktree root; `--self-test` carries the AC3 control pair and the root rule.
- `skills/postmaster/postmaster.md`: cut and tear down the synthesis worktree at the outside root.
- `skills/postmaster/coachman.md`: path table, Stage 0 cuts, review scratch destinations, teardown at the outside root.
- `scripts/review-round.sh`: `scratch()` and its header comment resolve under the new root.
- `scripts/find-projects.sh`: prune the new outside root from project search, as it prunes `.worktrees/`.
- `scripts/fixture.sh`: scoring asserts the fixture gate passes on main with the run's copies present; self-test covers that shape.
- `.postmaster/project.toml`: add the new script to the gate's self-test list.
- `wiki/concepts/working-copies-outside.md` (new), a one-line entry in `wiki/index.md`, an append to `wiki/log.md`.
- Self-test fixtures under `$tmp/.../.worktrees/` in other scripts stay: they are temp repos, not run copies, and no folder-walking gate reads them.

## Complexity tracking

None: the move is the ticket's own "keeping them outside the project folder" example, done through one script so every caller agrees.

## Decisions

1. **Mechanism: every run working copy outside the project folder.** Rejected: running only the postmerge gate from a temporary checkout. That shields one gate invocation while every other folder-walking read (a hand-run gate, CI on the checkout, a later flow step) still sees the copies, still exposes any in-repo read to sibling runs' copies, and needs dependencies installed in a pristine checkout per gate run. The ticket's direction says "ever".
2. **Root: `<parent-of-repo>/.postmaster-worktrees/<basename-of-repo>/`, physical paths.** `POSTMASTER_WORKTREES`, when set, replaces the parent directory, the way `POSTMASTER_TOOL_PINS` overrides tool pins. Outside the repo, derived from the repo path, distinct per repo, stable across reboots, no config key. Fail loudly when the root cannot be created.
3. **Same relative names under the new root** (synthesis `<root>/<TICKET>`, workhorse `<root>/<TICKET>-<lane>`, scratch `<root>/<TICKET>-rev-<lens>-<lane>`): only the root moves, so teardown and host placement change by one prefix.
4. **Legacy `<repo>/.worktrees/` stays gitignored; nothing new is cut there; no migration.** In-flight runs finish on their pinned tool with old paths, and the transient exposure until they land is accepted, not fixed.
5. **AC3 control: one identical check** (fail if any copy exists where folder-walking tools read), asserted both ways through the same function: pass with copies only outside, fail with a copy left under `.worktrees/`.
6. **AC4 proof without a live run:** fixture scoring asserts the fixture gate passes from the main checkout while the run's worktrees exist, and the self-test covers that shape, so the branch is judged without dispatching a fixture run.
7. **Wiki standing:** the page cites the fixture-runs-4-and-5 observation as the ticket carries it and says what would settle it; no invented `raw/` citation.

## Tasks

- [ ] T001 [P] [AC1] [AC3] Add `scripts/worktree-root.sh`: the outside root for a repo, plus `--self-test` with the AC3 positive/negative pair and the root rule.
- [ ] T002 [AC1] Point synthesis worktree cut/teardown in `skills/postmaster/postmaster.md` at the outside root via `<tool>/scripts/worktree-root.sh`.
- [ ] T003 [AC1] Point workhorse worktrees and reviewer scratches in `skills/postmaster/coachman.md` at the same root (path table, Stage 0 cut, scratch destinations, teardown).
- [ ] T004 [AC1] Resolve `scratch()` in `scripts/review-round.sh` (and its header comment) under the new root.
- [ ] T005 [AC1] Prune the new outside root in `scripts/find-projects.sh`, with a control showing a worktree there is not listed as a project.
- [ ] T006 [AC2] Write `wiki/concepts/working-copies-outside.md`, index it, append the log line; `scripts/wiki-lint.sh` clean.
- [ ] T007 [AC3] [AC4] Add the new script to the gate self-test list in `.postmaster/project.toml`; run the full project gate green.
- [ ] T008 [AC4] Extend `scripts/fixture.sh` scoring and self-test to prove the fixture gate passes on main with the run's copies present.
- [ ] T009 [AC1] Run the gate from the worktree root; `scripts/skill-refs.sh` clean after the runbook edits.
- [ ] T010 [AC1] Survey every production occurrence of `.worktrees` in `scripts/` and `skills/postmaster/`; route each run-copy path through the new root, leaving temp-repo fixtures and the legacy exclude alone.
