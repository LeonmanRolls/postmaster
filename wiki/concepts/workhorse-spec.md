---
title: The workhorse spec
type: concept
standing: claimed
sources: [articles/spec-kit-templates]
updated: 2026-09-30
---

# The workhorse spec

**Claim.** One spec is written per run, by the coachman, in the workhorse-spec template. When
a ticket carries the what, the why and the high-level technical direction, the detailed spec
is better drafted once by the coachman and passed down than drafted independently by every
workhorse.

**Standing: claimed.** This is a decision taken on the user's word on 2026-09-30: reviewing
two specs is annoying, so the coachman comes up with the spec and passes it down. The
comparison in [issue #9](https://github.com/brindlewick/postmaster/issues/9) is still its
test. The earlier claim, that each workhorse drafts its own spec, is history below.

## The reasoning

- **One review per run.** With two lanes, per-workhorse specs meant two reviews per run, and
  a run in flight waited on each. The user found that too much.
- **Diversity can live in the implementations.** The spec stays at the template's level —
  what to build, the decisions that matter and the tests, not the code — so the workhorses
  still make their own implementation choices. Whether that is enough diversity is an open
  question; the lane shares
  [#158](https://github.com/brindlewick/postmaster/issues/158) measures are what would show
  it.
- **The coachman is still a judge of the code, not of a plan it wrote for a lane.** The
  coachman wrote the spec for the run, not a plan for either lane, so the comparison of the
  two implementations is still of two readings of one plan.

## The format

A run's spec follows GitHub Spec Kit's plan and tasks templates, combined in one file
[@articles/spec-kit-templates]. Spec Kit splits the work into three documents: a spec for the
what and why, a plan for the how, and tasks for the order of work. In postmaster the ticket
already holds the first, since the user owns the what, the why and the direction
([the ticket's shape](ticket-shape.md)), so the coachman writes only the second and third. A
spec writing Spec Kit's spec would be restating requirements that belong to the ticket.

Three things are adapted to a lane. Spec Kit's constitution check becomes a direction check,
against the ticket's direction and the target project's own rules. Its user-story tags on tasks
become acceptance-criterion tags, since tickets carry numbered criteria rather than stories, and
that lets an audit see at once whether every criterion has a task. Its `NEEDS CLARIFICATION`
markers become recorded decisions, because there is nobody to ask mid-run.

The level is the point: what to build, the decisions that matter and the tests, not the code,
so the lanes still choose their own implementation.

## What reviews it

The user does, before any code is written. The [planning stage](planning-stage.md) puts the
run's one spec to the user in a spec session, and every workhorse implements only from that
approved text.

## What would change it

The comparison in issue #9 runs the same tickets three ways: each workhorse drafting its own
spec, the coachman drafting one shared spec, and no spec at all. The shared-spec level is now
the default. Its decision rule is fixed in advance: it stays unless no spec produces a
clearly better synthesis, or the lane shares show the shared spec has flattened the diversity
the fleet exists for.

## What changed because of it

The workhorse contract in `skills/postmaster/coachman.md` once had `WORKHORSE-SPEC.md` as a
workhorse's first act, written from `skills/postmaster/workhorse-spec-template.md`, and the
run's audit kept a copy of each one. On 2026-09-29 the planning stage began putting each
spec to the user before code, reversing part of #29's "nobody reviews it during the run". On
2026-09-30 the coachman took the spec: one per run, written in the same template, reviewed
once, and passed down to every workhorse. The coachman still does not check code against the
spec.

## History: when each workhorse drafted its own

The earlier claim was that each workhorse drafts its own spec, blind to the others, so the
approaches stayed independent and the synthesis had something to choose between; that it kept
the coachman a neutral judge, because a coachman that had written the spec would favour
whichever lane followed it most closely; and that it made the run auditable, each spec
committed before its code recording what that workhorse meant to build. The user's word on
2026-09-30 reversed the first of these: one spec for the run, diversity looked for in the
implementations instead. The audit story survives as the run's one record of intent.
