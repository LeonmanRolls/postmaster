---
title: A ticket's shape is checked before it is accepted
type: concept
standing: claimed
sources: []
updated: 2026-09-26
---

# A ticket's shape is checked before it is accepted

**Claim.** A ticket that reaches a coachman has a title, the problem or feature, numbered
acceptance criteria each answerable yes or no, and the direction the user wants. Checking that
shape before a ticket is accepted, and asking the user for whatever is missing, costs less than
a run dispatched without it.

**Standing: claimed.** This is a decision taken on reasoning in
[issue #7](https://github.com/brindlewick/postmaster/issues/7), before any run bears on it.

## The reasoning

- **The criteria are what a run is judged against.** The coachman writes its blind acceptance
  tests from them before it reads any lane's work, and ranks the lanes by those tests. A ticket
  with no criteria, or with criteria nobody can answer yes or no, leaves the coachman nothing
  to rank the lanes by and the gate nothing to prove.
- **The direction is where the user's intent ends and the workhorses' own plans begin.** It
  holds the approach the user wants, the constraints on how, and anything the workhorses must
  not decide differently. It is not a design: each workhorse drafts its own spec from it
  ([the workhorse spec](workhorse-spec.md)). It may say "None: any approach that meets the
  criteria", but it is never left out, so that an open approach is a decision rather than an
  omission.
- **A ticket is the user's.** The postmaster proposes what is missing, drawn from the stream
  and the ticket's own text, and writes back only what the user gives or approves. A ticket
  rewritten to pass the check without the user would pass on the postmaster's words. This
  matters most for the direction. A direction the postmaster wrote would narrow the
  workhorses' approaches before they start, and keeping those approaches independent is why
  each workhorse drafts its own spec.

## What a script can judge

The check is a script, so "answerable yes or no" means what a script can see: a criterion has
words, asks no question, and is not marked to be decided later. The header of
`scripts/ticket-check.sh` lists what it judges and what it does not.

Hedging words such as "where possible" were left out. A criterion can hedge and still say what
happens otherwise, as criterion 4 of
[issue #14](https://github.com/brindlewick/postmaster/issues/14) does, and a rule on the words
alone cannot tell the two apart. Whether a criterion is vague, can really be tested, or is the
right one stays with the user and the postmaster.

## What would change it

Runs dispatched on checked tickets, set beside runs on tickets the check would have failed:
whether the coachman's blind tests came from the criteria as written or had to fill gaps, and
how many escalations asked what the ticket meant. The `ticket-check` lines in the ledger count
how often tickets arrive malformed, and which part is missing.

## What changed because of it

The ticket shape in `skills/postmaster/trackers.md` gains `## Direction`, and
`scripts/ticket-check.sh` is the shape's executable form. Stage A of
`skills/postmaster/postmaster.md` runs the check on every ticket before it is accepted, and
Stage B runs it again before a ticket is dispatched. Only the user's answer is written back:
`ticket-check.sh --splice` changes the sections the user approved and no other line, and the
`edit` command added to each tracker adapter replaces the body alone, never the title, and
writes nothing if the ticket changed since it was read.

The shape later gained `## Turnpikes` after `## Direction`:
[a ticket names the turnpikes its run passes through](turnpikes.md).
