# raw — the wiki's evidence

Everything the wiki's claims rest on, exactly as it was produced or found, **committed and
published with the pages that cite it**. A citation nobody can follow is not a citation.

Two rules govern this directory, and the second is the one that does the work.

**Nothing here is edited, corrected or deleted.** A page in `wiki/` may say a record is
wrong; it may not change the record. That is what makes a claim checkable: anyone can clone
this repository, follow a standing to the record behind it, and count again.

One exception: something private that the scrub missed is redacted where it appears. The record
says what was redacted and when, `wiki/log.md` has an entry for it, and nothing else changes.

**Nothing arrives here automatically.** Every run already writes its full record — ledger,
narrative, cards, harness logs — to its own project's `.postmaster/`, which is gitignored in
whatever project it belongs to. Copying one here is a separate, deliberate act, and it is a
**decision to publish**. Most runs are operational and stay where they are; a few bear on a
claim and are promoted.

## Before anything is promoted

The copy is the moment of publication, so it is the moment the checks happen. Every one of
these, every time:

- **Scrub for secrets.** A harness session transcript can carry anything that was on screen,
  including a key a lane printed while debugging. Automated first, then read what the scrub
  reports. `scripts/scrub-check.sh` scans every committed addition in a change and reports
  suspects by commit, file, line and kind without printing their values. An unruled suspect
  stops the change check for the postmaster to take to the user. A user's ruling is recorded
  as an exact allowed value or line in `scripts/scrub-check.allow`. Existing history can be
  checked with `scripts/scrub-check.sh --history`, which defaults to `main`.
- **Check the target may be published.** A run against a private project carries that
  project's ticket text, branch names and file paths. Those do not become publishable by
  being evidence. Promote a run only when its target is public — which, for this repository's
  own runs, it is. Everything else stays in `.postmaster/`, and the claim it would have
  supported stays uncited or unmade.
- **Check the size.** Harness session exports can be large. Promote the ledger, narrative,
  cards and review notes as a matter of course; promote a session export when it is the
  evidence rather than merely available.
- **Respect what is not ours.** For a paper or article, capture what may lawfully be
  redistributed — the citation, the retrieval date, the passages relied on — rather than a
  wholesale copy of someone else's work.

If any of those cannot be satisfied, the record is not promoted. The wiki then says what it
could not show, rather than making a claim nobody can check.

## What lands here

```
raw/runs/<run-id>/        a run promoted from a project's .postmaster/
  ledger.jsonl            every action, one JSON line, from scripts/log-action.sh
  run-log.md              the coachman's narrative
  card.md                 the ship card
  logs/                   one harness events stream per lane and per review round
  sessions/               a lane's durable harness record, where it is the evidence
  reviews/  handoffs/     the review notes and the hand-off between legs

raw/trials/<slug>/        a deliberate experiment, smaller than a run
  method.md               what was run, against which version, and what was compared
  <recorded output>       the streams, requests or transcripts it produced

raw/papers/<slug>/        a paper: what may be redistributed, plus source.md
raw/articles/<slug>/      an article, post or documentation page, plus source.md
```

Three kinds of evidence, differing in force. A **run** is what this fleet did, and answers
questions about this fleet. A **trial** is a deliberate experiment — a harness driven against
a recording provider to see what it really sends, say — and answers the narrow question it was
designed for, which is often enough to settle a fact about a tool. A **paper or article** is
what someone else claims, and answers nothing on its own: outside work is a source of
hypotheses, not of standings.

A trial carries `method.md` saying what was run and against which version, because a trial
that cannot be repeated is an anecdote. A web capture carries `source.md`:

```yaml
---
url: <the page>
retrieved: YYYY-MM-DD
title: <as published>
author: <as published, or unknown>
---
Why it was captured, in a sentence.
```

## What does not land here

Anything written to make a point about this project: notes, summaries, arguments,
conclusions. Those belong in `wiki/`, where they can be revised and where their standing is
tracked. Raw is only what a run produced, what a trial recorded, or what was published
elsewhere.

A run is promoted when it has ended, never while it runs: a live run is still writing, and a
citation to a moving file is not a citation.
