---
title: A run's working copies live outside the project folder
type: concept
standing: claimed
sources: []
updated: 2026-09-30
---

# Working copies outside the project folder

**Claim.** A run's working copies are cut outside the target repository, under a root the flow
computes from the repository's own path, so a project's own linter, formatter or test runner
that walks the whole folder never reads them.

**Standing: claimed.** The observation behind it is the ticket's account of fixture runs 4 and 5
on 2026-09-28, unverified here: no promoted run record in `raw/` carries those runs yet.

## Why it is so

The flow keeps several working copies at once: the synthesis worktree, one workhorse worktree
per lane, and a reviewer scratch per lens per lane. They used to live under the target
repository, at `.worktrees/`. A project tool that walks the folder from the repository root then
reads every one of them. In the fixture app that is Biome, whose config includes `**`; it found
the copies' own config files and the gate failed on main right after a merge, and passed once
the copies were removed. Any project whose gate walks the tree would fail the same way, and
could pick up a lane's unfinished work.

Asking each project to ignore `.worktrees/` does not scale and is not the flow's business. The
copies are the flow's, so the flow moves them. They are cut at `<parent>/.postmaster-worktrees/
<basename>` beside the repository (or under `POSTMASTER_WORKTREES`), resolved by
`scripts/worktree-path.sh root`, and nothing is cut under `<repo>/.worktrees/`. That name stays
gitignored so a stray copy from the older layout is never committed.

The gate on main can run at any point after a merge, including while the synthesis worktree
still exists: the coachman sits in it through aftercare, and only the postmaster removes it.
Gating after teardown would leave the whole window the fixture runs hit still red, and a
sibling run's copies under `.worktrees/` would still fail a folder-walking check. Keeping the
copies outside closes both.

## The control

`scripts/worktree-path.sh --self-test` runs one identical check twice: a project whose check
fails whenever a copy exists under `.worktrees/` passes when the run's copies live only at the
outside root (the control reads zero), and the same check fails when a copy is left under
`.worktrees/` where a folder-walking tool reads (the control reads non-zero).

## What would settle it

Supported, when a fixture run's gate on the app's main checkout passes immediately after the
merge with the run's worktrees still present outside the project, and the negative control
above still fails. Refuted, when a project's gate on main reads a run's working copies while
they are only outside the project folder, or when the outside root cannot be resolved without
project-specific configuration.

## What changed because of it

`scripts/worktree-path.sh` resolves the root; `postmaster.md` and `coachman.md` cut, name and
tear down every working copy under it; `review-round.sh` finds each reviewer scratch there.
Related: issue #107 may still move lanes to clones of their own; that would keep the same
property.
