---
title: A gate on the default branch after a merge runs from a clean checkout
type: concept
standing: claimed
sources: []
updated: 2026-09-30
---

# Clean-checkout gates

**Claim.** When the flow runs a project's gate on the default branch after a merge, it runs
from a clean checkout of that branch made outside the project folder and removed afterwards,
so the gate never reads the run's working copies under `.worktrees/`.

**Standing: claimed.** The observation behind it is the ticket's account of fixture runs 4 and 5
on 2026-09-28, unverified here: no promoted run record in `raw/` carries those runs yet.

## Why it is so

A run keeps its synthesis worktree, its workhorse worktrees and its reviewer scratches under
the target repository, at `.worktrees/`. That is where agents on this machine work. A project
tool that walks the folder from the repository root reads every one of those copies. In the
fixture app that is Biome, whose config includes `**`; it found the copies' own config files
and the gate failed on main right after a merge, and passed once the copies were removed. Any
project whose gate walks the tree would fail the same way, and could pick up a lane's
unfinished work.

Asking each project to ignore `.worktrees/` does not scale and is not the flow's business. The
copies stay where the machine's convention puts them; the gate moves. `scripts/clean-checkout.ts`
makes a clean checkout of the branch in a temporary directory outside the project folder, runs
the command there, removes the checkout even when the command fails, and reports the command's
exit. Two callers use it: the ship leg, immediately after the local merge, and fixture scoring's
gate check.

Gating after teardown is not enough: the coachman still sits in the synthesis worktree through
aftercare, and only the postmaster removes it, so a folder-walking gate on the live main
checkout stays red for that whole window. A clean checkout is independent of when worktrees are
removed.

## What it does not cover

A tool a person runs by hand in the main checkout still sees the copies under `.worktrees/`. The
flow cannot move that. What the flow can do is never run its own post-merge gate from there, and
say so here so a red hand-run gate on main is recognised as the copies rather than as the merge.

## The control

`scripts/clean-checkout.test.ts` runs one identical check both ways: a project whose check fails
whenever a copy exists under `.worktrees/` passes from the clean checkout (the control reads
zero), and the same check fails in the main checkout when a copy is left under `.worktrees/`
(the control reads non-zero). The tests also assert the checkout is made outside the project
folder and removed even when the command fails.

## What would settle it

Supported, when a fixture run's gate on the merged default branch passes immediately after the
merge with the run's worktrees still present under `.worktrees/`, and the negative control above
still fails. Refuted, when a gate the flow runs on the default branch after a merge reads a
run's working copies, or when the clean checkout cannot be made without project-specific
configuration.

## What changed because of it

`scripts/clean-checkout.ts` and its colocated tests; a new Stage 3 step in `coachman.md` that
gates the merged default branch through the helper; `fixture.sh` scoring's gate runs the same
way. Related: issue #107 may still confine each lane to its own worktree or clone; that would
narrow what a hand-run gate sees, but the clean checkout keeps its purpose either way.
