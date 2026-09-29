---
title: The workhorse spec
type: concept
standing: claimed
sources: [articles/spec-kit-templates, articles/ai-native-sdlc-playbook]
updated: 2026-09-29
---

# The workhorse spec

**Claim.** Each workhorse drafts its own spec, the workhorse spec. When a ticket carries the
what, the why and the high-level technical direction, each workhorse should draft its own
detailed spec. The user reviews each spec before implementation.

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
  meant to build. The run records the commit the user approved, so the accepted plan can be
  compared with what was implemented.
- **The review happens while the plan is still cheap to change.** The user chose this because
  planning errors cost less to fix than code, and weaker, cheaper models gain the most. These
  expected benefits are unverified until runs or trials measure them.

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

## Review before implementation

The user reviews every spec before implementation, as an interactive planning stage. This
reverses the audit-only decision from #29. The review is for scope and correctness. It does not
show one workhorse another's spec or ask the coachman to choose a shared approach. The coachman
still does not check code against the approved spec.

The [AI-native SDLC playbook](../sources/ai-native-sdlc-playbook.md) motivates this timing: it
puts design review before code generation and has acceptance of a plan start implementation
[@articles/ai-native-sdlc-playbook]. It does not show whether this flow gets better results.

## What would change it

The comparison in issue #9 runs the same tickets three ways: each workhorse drafting its own
spec, the coachman drafting one shared spec, and no spec at all. The own-spec condition now
includes user review. The experiment measures whether review makes the independent specs
converge, as well as the quality of the synthesis. Its decision rule is fixed in advance: this
stays the default unless a shared spec produces a clearly better synthesis.

## What changed because of it

The workhorse contract in `skills/postmaster/coachman.md` makes the first spec a stop before
implementation. The postmaster presents each spec through the machine's `planning.review_link`
template or its worktree path. Requested changes return to the same workhorse thread, and the
run records the commit approved. `WORKHORSE-SPEC.md` keeps the plan and tasks format from
`skills/postmaster/workhorse-spec-template.md`. The coachman still does not check code against
the approved spec.
