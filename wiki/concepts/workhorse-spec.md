---
title: The workhorse spec
type: concept
standing: claimed
sources: [articles/spec-kit-templates]
updated: 2026-09-29
---

# The workhorse spec

**Claim.** Each workhorse drafts its own spec, the workhorse spec. When a ticket carries the what, the why and the high-level technical direction, the
detailed spec is better drafted by each workhorse for itself than by the coachman for all of them.

**Standing: claimed.** This is a decision taken on reasoning, before any run bears on it. The
comparison in [issue #9](https://github.com/brindlewick/postmaster/issues/9) is its test.

## The reasoning

- **It keeps the workhorses independent.** Several models are worth running because they take
  different approaches ([combining models](combining-models.md), H1). One shared spec fixes the
  approach before any workhorse starts, so the workhorses differ only in how they carry it out, and the
  synthesis has less to choose between.
- **It keeps the coachman a neutral judge.** The coachman compares the workhorses' work and
  composes the synthesis. A coachman that had written the spec would be judging each workhorse
  against its own answer, and would tend to favour whichever followed it most closely.
- **It makes the run auditable.** Each workhorse's spec, committed before its code, records what it
  meant to build. Read beside what it built, it shows whether the workhorses diverged at the design
  or only in the code, and where a workhorse departed from its own plan.

## The format

A workhorse's spec follows GitHub Spec Kit's plan and tasks templates, combined in one file
[@articles/spec-kit-templates]. Spec Kit splits the work into three documents: a spec for the
what and why, a plan for the how, and tasks for the order of work. In postmaster the ticket
already holds the first, since the user owns the what, the why and the direction
([the ticket's shape](ticket-shape.md)), so a workhorse writes only the second and third. A
workhorse writing Spec Kit's spec would be restating requirements that belong to the ticket.

Three things are adapted to a lane. Spec Kit's constitution check becomes a direction check,
against the ticket's direction and the target project's own rules. Its user-story tags on tasks
become acceptance-criterion tags, since tickets carry numbered criteria rather than stories, and
that lets an audit see at once whether every criterion has a task. Its `NEEDS CLARIFICATION`
markers become recorded decisions, because a workhorse has nobody to ask mid-run.

## What reviews it

The user does, before any code is written. The [planning stage](planning-stage.md) puts each
workhorse's spec to the user one at a time, never beside another's, and a workhorse implements
only from a spec the user approved. That review is for scope and correctness; it does not try
to make the specs alike, which would undo the independence above.

## What would change it

The comparison in issue #9 runs the same tickets three ways: each workhorse drafting its own spec,
the coachman drafting one shared spec, and no spec at all. Its own-spec level is the workhorses'
own specs reviewed by the user, and whether review makes the specs converge is a measure of it.
Its decision rule is fixed in advance: this stays the default unless a shared spec produces a
clearly better synthesis.

## What changed because of it

The workhorse contract in `skills/postmaster/coachman.md` gains `WORKHORSE-SPEC.md` as a workhorse's first act,
written from `skills/postmaster/workhorse-spec-template.md`, and the run's audit keeps a copy of each
one as first committed and as finished. On 2026-09-29 the planning stage began putting each
spec to the user before code, reversing part of #29's "nobody reviews it during the run"; the
coachman still does not check code against the spec.
