# Workhorse spec: 110 A project's gate never sees the run's own working copies

Shared coachman spec, revised per postmaster review, committed identically in both worktrees:
both lanes implement from this one spec.

## Summary

Agents on this machine work in git worktrees under `.worktrees/` inside the project, so run
working copies stay there. The flow's gates on the default branch after a merge instead run
from a clean checkout of that branch made outside the project folder for the purpose and
removed afterwards, through one new TypeScript-on-Bun helper. The wiki records the mechanism
with its reason and its limits, and a control pair proves it.

## Technical context

- **Language and version**: TypeScript on Bun for the new helper, in a functional style (no
  mutation unless necessary); the existing Bash and Python stand where they are.
- **Dependencies used or added**: none new; fixture scoring already requires Bun, and Bun 1.x
  is on this machine.
- **Testing**:
  - `bun test` on the helper's colocated tests: the AC3 pair (the same check passes from the
    clean checkout and fails in the main checkout with a copy under `.worktrees/`) and the
    checkout lifecycle (made outside the project folder, removed afterwards even on failure).
  - The project gate from the worktree root, with the colocated tests in the declared gate.
  - `scripts/wiki-lint.sh` after the wiki page lands; `scripts/skill-refs.sh` after the
    runbook edits.
  - `scripts/fixture.sh --self-test`, and scoring still clean.
- **Constraints**: the machine's standing rule (agents work in `.worktrees/` inside the
  project: the copies stay); the ticket's direction (a change in the flow, never asking
  projects to ignore `.worktrees/`); the design rules (nothing repo-specific, deterministic
  work in `scripts/`, every count a control, `<tool>/` script references, every action
  logged); the user's standing preference (a new script is TypeScript on Bun, functional,
  with its tests beside it and run by the gate); in-flight runs stay on their pinned tool.

## Direction check

- The standing rule keeps every run working copy under `.worktrees/`; the gate moves, not
  the copies. No worktree cutting, teardown, or placement changes anywhere.
- AC1 is met at the two gates the flow runs on the default branch after a merge: the ship
  leg verifies the merged branch immediately after the local merge, and fixture scoring's
  gate runs the same way; both from a clean checkout outside the project folder.
- AC4 is fixture scoring's gate: the fixture app's gate passes on the merged result right
  after the merge, from a checkout that never contained `.worktrees/`.
- Generic and deterministic: one helper serves both callers; the repo, branch, and command
  are arguments, nothing is hardcoded.
- Every count a control: AC3's pair runs the identical check both ways through the helper's
  tests.

## Structure

- `scripts/clean-checkout.ts` (new): given a repo, a branch, and a command, make a clean
  checkout of that branch outside the project folder, run the command there, remove the
  checkout afterwards even on failure, and report the command's exit.
- `scripts/clean-checkout.test.ts` (new, beside it): the AC3 pair and the lifecycle tests;
  run by the gate.
- `skills/postmaster/coachman.md`: the ship leg verifies the merged default branch
  immediately after the local merge by running the recorded gate through the helper. The
  runbook runs no gate on the default branch after the merge today (Stage F gates the
  synthesis worktree before the merge word), so this is a new step in Stage 3.
- `scripts/fixture.sh`: scoring's gate runs through the helper, replacing the inline archive
  export, so one mechanism serves both callers.
- `.postmaster/project.toml`: the declared gate runs the colocated Bun tests.
- `wiki/concepts/clean-checkout-gates.md` (new), a one-line entry in `wiki/index.md`, an
  append to `wiki/log.md`: the mechanism, the reason (the worktree convention), and what it
  does not cover (tools a person runs by hand in the main checkout still see the copies).
- Unchanged: every worktree path, the `.worktrees/` exclude, and every self-test fixture.

## Complexity tracking

None: the mechanism, the runtime, and the test layout are the decided direction, and the
helper is generic over repos.

## Decisions

1. **The copies stay; the gate moves.** Round 2 moved working copies outside the project
   folder; the standing rule for where agents work on this machine reverses that. No path,
   exclude, or placement line changes.
2. **Two gates run from clean checkouts, through one helper.** The ship leg's verification
   immediately after the local merge (new Stage 3 step) and fixture scoring's gate (its
   inline export replaced). One mechanism, two callers, per the deterministic-work rule.
3. **Helper contract.** Inputs are repo, branch, command. The checkout holds only the branch
   content; it is made outside the project folder for the purpose and removed afterwards
   even when the command fails; the helper reports the command's exit unchanged. How the
   ship leg composes it with the recorded checks (raw gate command or an armed `verify.sh`
   run) is the implementer's choice; the AC3 control proves the result either way.
4. **AC3 pair shape.** The same fail-on-copy check passes from the clean checkout and fails
   in the main checkout with a copy under `.worktrees/`, both asserted in the helper's
   colocated tests.
5. **TypeScript on Bun, functional style, tests beside the target, run by the gate.** The
   user's standing preference for a new script; no new framework beyond what Bun runs
   directly.
6. **The wiki states the non-coverage plainly.** Hand-run tools in the main checkout still
   see the copies; the page says so, with the worktree convention as the reason the flow
   accepts that.
7. **No teardown-ordering dependency.** The clean checkout is independent of when worktrees
   are removed, so the verification reads the same before and after aftercare.

## Tasks

- [x] T001 [P] [AC1] [AC3] Add `scripts/clean-checkout.ts`: clean checkout of a branch outside the project folder, run the command there, remove it afterwards even on failure, report the command's exit.
- [x] T002 [P] [AC3] Add `scripts/clean-checkout.test.ts` beside it: the AC3 pair and the lifecycle (made outside, removed even on failure); `bun test` green.
- [x] T003 [AC1] Add the ship leg's verification to Stage 3 of `skills/postmaster/coachman.md`: immediately after the local merge, run the recorded gate on the merged default branch through `<tool>/scripts/clean-checkout.ts` via Bun.
- [x] T004 [AC1] [AC4] Route fixture scoring's gate in `scripts/fixture.sh` through the helper, replacing the inline export; score and self-test clean.
- [x] T005 [AC2] Write `wiki/concepts/clean-checkout-gates.md` (mechanism, worktree-convention reason, hand-run non-coverage), index it, append the log line; `scripts/wiki-lint.sh` clean.
- [x] T006 [AC3] [AC4] Run the colocated Bun tests from the declared gate in `.postmaster/project.toml`; full gate green.
- [x] T007 [AC1] Run the gate from the worktree root; `scripts/skill-refs.sh` clean after the runbook edits.
- [x] T008 [AC1] Survey every gate the flow runs on the default branch after a merge; confirm the two above are the whole set, and route any other found through the helper.
