---
title: The planning stage
type: concept
standing: claimed
sources: [articles/ai-native-sdlc-playbook]
updated: 2026-09-30
---

# The planning stage

**Claim.** The current contract has the coachman write one shared spec for a run before any
workhorse starts. The postmaster presents that spec for one user decision; on approval every
workhorse implements from it in blinkers. This is the decision in [#170](https://github.com/brindlewick/postmaster/issues/170),
recorded in the ticket and summarized in the [workhorse spec page](workhorse-spec.md). It is unverified as a
fleet practice: no completed run has measured what this change does to lane contributions.

**Standing: claimed.** The policy changed by decision, not by run evidence. The outside
playbook motivates human review before code but does not settle whether one shared spec works
better than per-workhorse specs.

## The reasoning

- A single review removes the second per-lane spec review and its wait from each run. This is
  the stated reason for #170, not a measured time saving.
- One shared spec fixes the ticket-level requirements and decisions before implementation.
  It remains at the template's level: what to build, the decisions that matter and the tests,
  not code. The workhorses still choose their implementation independently.
- The earlier policy gave each workhorse its own design plan. That can expose more design
  alternatives, but it costs a review per lane. Whether that extra diversity was useful remains
  open; the [workhorse spec](workhorse-spec.md) records the policy change.
- A fault is cheapest to fix while it is still a document. The captured playbook makes the same
  case for design review before code [@articles/ai-native-sdlc-playbook/passages.md]. It does
  not show which spec ownership produces a better synthesis.

## What it does

The runbook now gives the coachman authorship of one spec and the postmaster one review pause.
The user can approve it, request changes in their own words for another pass, or stop the run.
A fixture run is signed off by the postmaster. Once approved, the same spec reaches each lane;
the workhorses do not write specs. A run dispatched before the change retains its old flow
through its pinned tool.

## What would change it

The open question is whether implementation choices still provide useful diversity when the
plans are shared. [#158](https://github.com/brindlewick/postmaster/issues/158) measures each
lane's share of the synthesis from git. A non-trivial share shows a contribution, but by itself
does not show that the contribution improved the result. [#159](https://github.com/brindlewick/postmaster/issues/159)
scores each lane's branch on fixture hidden tests beside the synthesis. Together, lane shares
and branch scores can show whether lanes contribute distinct work and whether that work helps
the shipped result. Compare these measures on runs following the shared-spec ruling with the
earlier per-workhorse runs; retain `claimed` until a run record bears on the question.

## What changed because of it

Ticket #170 replaces the per-workhorse planning pause with one coachman-authored spec, one
review package, and a spec session using the postmaster's recorded harness, model and effort.
The planning timing still runs from entry through the final decision, and the action log still
records the spec review. This change does not move a standing: the first trials, #158 and #159,
follow the new direction by ruling, and their measures will help answer whether implementation
diversity remains useful.

## What would settle it

Across runs using each policy, compare lane shares of the synthesis, each lane's fixture score,
and whether the synthesis passes tests the strongest lane alone fails. Record review rounds and
planning time as well. Useful diversity would show up as distinct lane contributions that
improve the combined result. A lane share alone is not enough. A run that implements an
unapproved spec or gives a lane another lane's work refutes the contract as written.
