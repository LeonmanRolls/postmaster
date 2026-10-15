---
title: A project's notes are copied into the part of the flow each is for
type: concept
standing: claimed
sources: []
updated: 2026-10-15
---

# A project's notes are copied into the part of the flow each is for

**Claim.** What a project knows that the flow does not, such as its written rules, where its
wiki is, how to start its servers, belongs in one plain-language file that the postmaster routes
and the tool copies into the input of each part of the flow, so that no lane has to find it and
every lane that writes or judges code sees the same rules.

**Standing: claimed.** A decision taken on reasoning after one run whose record is not promoted to
`raw/`. The account below is `unverified` for that reason, and nothing on this page cites a record.

## The reasoning

- **What happened (`unverified`).** A run's reviewers read the project's own style guide and a review
  bot's rule list, and none opened the company wiki that held the stricter, tiered version of the
  same rules. The wiki's map reached one reviewer through a start-up hook and no other. The lane that
  wrote the code was told the style guide's name and nothing of the bot's rules, and a review bot then
  flagged rule violations the reviewers had reported as minor or never found.
- **Ambient context differs by harness.** A hook, a parent folder's instruction file and a skill reach
  some lanes and not others, so what a lane knows about a project depends on which harness runs it.
  What the waybill and the briefs carry is the same for every lane.
- **Facts and instructions are different files.** `.postmaster/project.toml` holds facts the tool reads
  as values (the gate, the tracker, the risk surfaces, the checks). The notes hold instructions in
  words: what to read and how to judge.
- **A person decides where a note goes, once, in the open.** A note sorted by hand at each dispatch was
  copied wrongly once, from the wrong earlier waybill. The notes carry the routing, the user sees what
  each part would receive before accepting it, and the tool applies it the same way every time.
- **The tool stays generic.** It defines the parts and what each may hold; the content, and every name
  in it, is the project's. A wiki is registered once on the machine by name and path, and a project's
  notes name it as `source:<name>/<path>`, so a shared file carries no machine path.

## The form

The file is `.postmaster/notes.md`. A comment before a block routes it: `route: waybill, implement;
scope: apps/shop/**` sends the block that follows to those parts for work under that folder. A
`rules` comment names a file of written rules, as a JSON list or as markdown headings, with the labels
that gate; a `reads` comment names files a part should open. The parts are the clerk, the waybill,
the lane that implements, and the style, bug, security, design and landing lenses. `scripts/run
project-notes` checks the file, prints what each part would receive, copies it into a run, and verifies
that a waybill or a brief carries a bundled part word for word.

A rule that gates and is broken with no comment at the line saying why is a gating finding: it is fixed
in round 1, not left in the Style residue. The style lens reads the rules in batches of a dozen, one
batch to a lane at a time, so that no rule goes unasked.

## What would settle it

A comparison of the same ticket through the flow with and without notes, counting the comments a
project's own review bot raises on the pull request. Until then the page is a decision.

Related: [the review loop](review-loop.md),
[a ticket checks what the libraries already do](capabilities-before-design.md).
