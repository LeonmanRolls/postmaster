---
title: A ticket names the turnpikes its run passes through
type: concept
standing: claimed
sources: []
updated: 2026-09-26
---

# A ticket names the turnpikes its run passes through

**Claim.** A run should pass through the checks its ticket needs, and the ticket is where that
is decided. Each ticket names its turnpikes in a section of its own: `default` for the style,
bug and security reviews, fewer of them, or `none`. Most tickets need only the one word. The
project's gate is not a turnpike, and runs on every run.

**Standing: claimed.** This is a decision the user took in
[issue #40](https://github.com/brindlewick/postmaster/issues/40), before any run bears on it.

## The reasoning

- **Not every ticket needs every check.** Every run used to pass through the same three
  reviews, whatever the ticket was. The user's word is that some tickets need fewer, a research
  ticket may need none, and there is no floor: the ticket's own list decides.
- **`default` keeps the usual case to one word.** A ticket with no section is not read as
  `none`. It fails the check, and the postmaster proposes `default` to the user, who may answer
  with fewer turnpikes, others, or `none`. Leaving a review out is then always a choice somebody
  wrote down.
- **The gate is not a turnpike.** `AGENTS.md` used to define a turnpike as the gate a run must
  clear. The gate is the project's own check, and it runs whatever the ticket says. Turnpikes
  are the checks a ticket names on top of it. A ticket can name `none`, but it cannot skip the
  gate.
- **The turnpikes are listed in one place.** `scripts/turnpikes.sh` defines every turnpike and
  the default set, and the check, the postmaster and the coachman read them from it. A new
  turnpike, such as a fixture run from
  [issue #37](https://github.com/brindlewick/postmaster/issues/37), is one line there and a
  runbook step that runs it. The ticket shape and the check do not change.

## Decisions the ticket left open

- **The waybill carries names, not `default`.** The postmaster resolves the ticket's section
  when it writes the waybill, on a line under its title and above the ticket, so nothing the
  ticket holds is read for it. A run then passes through what it was dispatched with, even if
  the default set changes while it runs, and the table of turnpikes is not changed while any
  run is in flight, since a run's legs are read from it at each dispatch. When
  [issue #18](https://github.com/brindlewick/postmaster/issues/18) lets a project say what
  `default` means for it, the postmaster, which reads the project at dispatch, resolves it the
  same way.
- **A run with no review turnpike has no review leg.** The ship leg follows synthesis and
  starts from its hand-off. A review leg with no lens would start a coachman to do nothing.
- **A review loop without a gating lens is one round, and applies nothing.** In
  [the review loop](review-loop.md), every change is re-reviewed in the next round by the
  gating lenses, bug and security. With only `style` named, nothing would re-review a style
  change, so every style finding goes to the ship card's Style residue for the user to pick
  from. A bug or security defect the style reviewer finds in such a run is not fixed either:
  the coachman escalates it, and the user decides, since no lens would check the fix. The user
  chose this on 2026-09-26.
- **The turnpikes are the user's, like the direction.** The postmaster proposes `default` and
  never writes fewer turnpikes, or `none`, on its own judgment, even where it may create tickets
  without asking. Otherwise a postmaster that also says the merge word could remove every review
  from a run with no person choosing or seeing it. The user chose this on 2026-09-26. The
  postmaster shows the user any ticket that leaves out a default turnpike before creating it,
  dispatches one only with the user's word logged, and looks for that word before a merge.
- **A section holds names and nothing else.** A word that is not a turnpike is named by the
  check, so a reason for the choice goes in the ticket's notes, not beside the names.

## What it costs

- A ticket that names fewer turnpikes ships with less review. That is the ticket writer's call
  by design. The ship card lists the turnpikes the run passed through, so the user sees it at
  merge time.
- Every ticket written before this change fails the check until the section is added. The
  postmaster proposes `default` for each.

## What would change it

The postmaster logs every `ticket-check` with the turnpikes line it printed, so the ledger
counts how often tickets name fewer turnpikes than the default, and which ones. Set beside what
those runs shipped:

- a defect found after the merge, in a run that did not pass through the turnpike that looks
  for that kind of defect, would count against naming fewer;
- review rounds that found nothing on tickets that named `default` would suggest the default is
  wider than some kinds of ticket need.

## What changed because of it

The ticket shape in `skills/postmaster/trackers.md` gains `## Turnpikes` after `## Direction`.
`scripts/turnpikes.sh` lists the turnpikes and turns a ticket's section into names, and
`scripts/ticket-check.sh` requires the section and names any word that is not a turnpike. The
postmaster copies the resolved names into the waybill, and proposes `default` for a ticket with
no section. The coachman runs exactly the waybill's turnpikes, so a run with none goes from
synthesis to ship, and the ship card lists the turnpikes the run passed through. `AGENTS.md`
defines the word.
