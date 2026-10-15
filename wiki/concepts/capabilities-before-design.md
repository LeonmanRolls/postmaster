---
title: A ticket checks what the libraries already do before it picks a design
type: concept
standing: claimed
sources: []
updated: 2026-10-15
---

# A ticket checks what the libraries already do before it picks a design

**Claim.** A ticket that wraps, replaces or works around a library, SDK or service the project
already uses names what that library already offers, read from its own documentation and its
installed version, before it chooses a design. At the ticket, where the user signs off, that costs
a few reads. After the build it costs a rework.

**Standing: claimed.** A decision taken on reasoning after one run whose record is not promoted to
`raw/`. The account below is `unverified` for that reason, and nothing on this page cites a record.

## The reasoning

- **What happened (`unverified`).** A run built a consent mechanism beside an analytics SDK: its own
  store for the visitor's choice, a mirror of that choice for the server, a sweep of the SDK's
  storage and a filter in front of the SDK. The block of the SDK's settings that the ticket had
  cited for one option also held options that store the choice, share it across subdomains and
  enforce it. A reviewer who knew the SDK asked for the rework after the build and its review
  rounds had finished.
- **The user chooses among the options the ticket lists.** Each decision named the alternative it
  beat, and none of them was the library's own way, so the sign-off could only pick between
  options that were already off the mark.
- **The build and the review do not look for it.** The coachman builds to the decisions it is
  given. Review lanes look for defects in a change, not for a simpler design, and each defect they
  found in the second mechanism was closed with more of it. Findings that all trace to one
  mechanism were triaged one by one.
- **One option read from a source is not the feature read.** The ticket cited a single option; its
  neighbours sat within twenty lines in the same file. The documentation, opened in a browser, and
  the installed version's whole block are read for the feature, not for the option first thought
  of.
- **Reading is selective (`unverified`).** A second clerk, started with the first ticket's
  references closed, read the vendor's documentation and the installed types and again passed over
  settings in the block it had used: the ones that keep the visitor's choice across visits, name
  where it is stored and share it across subdomains, and the server SDK's local evaluation of
  flags. Nothing asked it to list the block, and a block of two thousand names is not read whole
  by choice. A menu of the declared API, ranked against the draft's own words and followed by a map
  of every name, puts those names in front of it while it plans.
- **Knowing is enough; the ticket lists nothing from the menu.** The user asked that the clerk
  know every function available during planning, not repeat them: a requirement to name each
  listed name in the ticket would cost hundreds of names per ticket and would be answered by
  transcription, not by reading.
- **The project's own code is a library too.** A helper the repository already has is passed over
  for the same reason, so the menu of the folders a change touches is made the same way.
- **A guarantee is tested, not assumed.** Where a criterion is a guarantee the documentation only
  implies, such as nothing sent before consent, a throwaway page against a stand-in shows what the
  library does. The probes find the gaps that really need custom code, which are fewer and
  smaller than a design made without them.

## What it does not settle

The ticket still decides. The library's way can be wrong for the project, and the entry says what
stays custom and why. `scripts/run ticket-capabilities` judges the form of the section: that the
investigation is written down, with a source for what the library offers. It cannot judge that the
sources say what the entry says; the clerk reads them and the user can follow them.

A menu cannot make the clerk read it. The check holds that the menus were made from the draft the
clerk planned from, and that a claim of "the library cannot do this" names what was searched; it
cannot hold that the names were weighed. The ranked part is a net that misses a name sharing no
word with the draft, and the map of every name is what covers it.

## What would change it

Tickets written with the section, set beside tickets without it: how many custom mechanisms
duplicate an option the ticket lists, and how many reviews or reworks ask for the library's own
way. A section that is always `None:` or copied between tickets would show the step is not being
done. `Searched:` parts that name settings which do not exist, or that miss the one a reviewer
later finds, would show the menus are not being read.

## What changed because of it

[The clerk runbook](../../skills/clerk/clerk.md) gains "Check what the libraries already do", and
[the ticket template](../../skills/clerk/ticket-template.md) gains `### Existing capabilities` and
a line in each decision's `Instead of`. `scripts/run ticket-capabilities` checks the section's
form, and `scripts/run ticket-parts` prints a note, never a finding, when a ticket lacks it, so a
ticket written before the section stays ready.

`scripts/run api-index` reads every exported name and setting of a package, and of the packages of
its family that its declarations import, from the installed copy or the version the lockfile pins.
`scripts/run code-index` reads every export of the project folders a change touches. Each saves a
menu: the entries nearest the draft's words, with signature and doc comment, then a map of every
name by file and owner, under a key of the draft's words. `scripts/run ticket-capabilities
--candidates` refuses a menu made from an older draft or without the draft, and an entry with a
custom part and no `Searched:` part.

Not changed, and open: a design lens among the review turnpikes, and the coachman's use of
"do-not-reopen" on architecture. Both sit in the coachman contract, so each needs a fixture run
that scores clean. Related: [a ticket's shape](ticket-shape.md),
[the turnpikes](turnpikes.md).
