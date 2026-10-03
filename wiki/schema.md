---
title: How the wiki is kept
type: schema
updated: 2026-09-22
---

# How the wiki is kept

This page is the contract for every other page, and for any agent operating on the wiki.
Read it before ingesting, querying or linting.

**Scope: anything relevant to the project.** How harnesses really behave, what the services
the flow depends on really do, why the design is as it is, what outside work claims, and what
happens when several models implement one ticket. That last is the founding question, not the
only subject.

The shape is the LLM-wiki pattern: immutable sources in `raw/`, compiled pages in `wiki/`,
these conventions as the schema, and an append-only `log.md`. Knowledge is compiled once and
kept current, rather than re-derived from scratch each time somebody asks.

## Layers

| layer | what it is | who writes it |
|---|---|---|
| `<project>/.postmaster/` | where every run's full record lives, harness logs included; gitignored in its own project | every run, automatically |
| `raw/` | the evidence these pages cite: promoted runs, trials and captures; never edited except to redact something private, and committed so a citation can be followed ([the contract](../raw/README.md)) | ingest, by decision |
| `wiki/` | compiled pages, revised freely, every claim cited | ingest and query |
| `wiki/log.md` | append-only record of every operation | every operation |

## Page kinds

**`wiki/concepts/`** — a claim, with its standing and what would settle it. A hypothesis about
combining models is one kind; so is a finding about a harness, a service, or a design decision
and its reason. If it could be wrong and evidence bears on it, it is a concept.

**`wiki/sources/`** — one page per piece of evidence somebody chose to keep. A promoted run
is distilled from `raw/runs/<run-id>/` in the shape of [the template](sources/template.md):
numbers, not impressions, each citing the file it came from. A captured paper or article gets
a page saying what it claims and what it would mean here if true. A recorded trial needs no
page: its `method.md` describes it and the concept it settles cites it directly.

**`wiki/entities/`** — a thing the other pages keep referring to: a lane, a harness, a target
project. Only when it has accumulated enough to be worth a page.

## Concepts against runbooks

`skills/postmaster/*.md` say what an agent **must do**: terse, current, authoritative. A
concept says what the project **knows**: the claim, what it rests on, how sure it is, what
would change it. A concept that settles may change a runbook, and then records that it did.
Never restate a runbook's instructions in a concept, and never put a standing or an argument
in a runbook.

## Front matter

Every page carries it:

```yaml
---
title: <one line>
type: concept | source | entity | schema
standing: claimed | supported | mixed | refuted | settled   # concepts only
sources: [runs/2026-09-22-postmaster-17, trials/pi-prompt-forms]   # raw ids this rests on
updated: YYYY-MM-DD
---
```

## What may be published

`raw/` and `wiki/` are both committed and public, so the question is not what a page may show
but what may be promoted into `raw/` at all. [The contract](../raw/README.md) governs that:
scrub for secrets, only promote a run whose target is public, and capture only what may
lawfully be redistributed.

That decided, pages need no defensive paraphrasing. Quote a ledger line where quoting it is
clearer, and cite it. Integrity needs no hash either: the record is in git, so its history is
the proof that it was not drifted from after the fact.

What still holds:

- **Compile, do not transcribe.** A record says a lane produced three findings of which two
  were corroborated, and cites the lines; it does not reproduce the ledger, which is already
  one directory away.
- **A claim whose evidence could not be promoted is not made.** Where a run against a private
  target would have supported a page, the page says what it could not show rather than
  asserting it uncitably. An uncheckable claim in a wiki with sources is worse than an
  absent one.

## Citations and links

- **`[@runs/<run-id>]`**, **`[@trials/<slug>]`**, **`[@papers/<slug>]`**, **`[@articles/<slug>]`**
  cite a raw record, and resolve to a path in this repository that any reader can open.
  Every number and every claim taken from evidence carries one. A claim with no citation is
  marked `unverified` in the sentence that makes it, or it does not go in.
- **A trial settles what it was designed to settle**, and no more: it can settle a fact about
  a tool, and cannot settle whether combining models works, which needs runs.
- **Outside work does not move a standing.** A paper may motivate a hypothesis and belongs in
  its "what would settle it"; only `[@runs/...]` records decide whether it holds here. A
  concept citing only papers stays `claimed`.
- **`[[page-name]]`** cross-references another wiki page. Link liberally; a link to a page
  that does not exist yet marks something worth writing.
- A run record cites the exact file: `[@runs/<id>/ledger.jsonl]`, `[@runs/<id>/card.md]`.

## Standing of a claim

Concepts carry one of these, and the log records every change:

- **claimed** — stated somewhere with no run record behind it yet
- **supported** — consistent with every run record that bears on it, and there are at least three
- **mixed** — run records on both sides; the page says what separates them
- **refuted** — contradicted by run records a defender of the claim would accept
- **settled** — supported, and the measurement that would refute it has been tried

## Who reads this, and who must not

**The postmaster reads the index**, and the concepts a stream touches, so that what the
project already knows reaches the work. The index is a catalog of one-line summaries for
exactly that: read the catalog, not the corpus.

**A coachman is pointed at a concept by its waybill**, where one bears on its ticket, rather
than reading the wiki at large.

**A lane does not read the wiki at all.** Its context is the ticket, the project's docs and
its runbook. The reason is contamination, not economy: these pages hold claims about which
lane's mechanism tends to survive synthesis and which findings get corroborated, and a lane
that has read them is no longer an independent measurement of them. Corroboration means two
lanes found something without seeing each other; if both have read a page saying what tends
to be found, the standing on that page is circular. Blinkers apply to knowledge, not only to
each other's worktrees.

That instruction cannot hold on its own, and this page does not pretend it can. When the
target is this repository the wiki is inside the lane's own worktree and nothing prevents it
being read. So it is measured rather than assumed: a lane's exported harness session records
what it read, a run record says whether any lane touched `wiki/` or `raw/`, and a concept
resting on a run with a contaminated lane says so and is weaker for it.

**Nobody reads `raw/` to make a claim.** It is evidence for checking one.

## Operations

**ingest a run** — a run has ended. Copy `<dispatch>` into `raw/runs/<run-id>/` unchanged,
including each lane's events stream and its exported harness session, write a run record in
`wiki/sources/` from it, update the standing of every concept the record bears on, add the
cross-references, and append to the log.

**ingest a source** — a paper or article worth keeping. Capture the text into
`raw/papers/<slug>/` or `raw/articles/<slug>/` with its `source.md`, write a page in
`wiki/sources/` saying what it claims and what it would mean here if true, and link it from
every concept it bears on. It does not change a standing.

**query** — a question. Read the relevant pages, answer with citations, and where the answer
is worth keeping, file it back as a page rather than leaving it in a chat.

**lint** — a health check in two halves. `scripts/run wiki-lint` does the mechanical half:
front matter and standings, citations and links resolving, orphans, trial and capture records,
and a standing beyond `claimed` resting on this fleet's own runs or trials. Whoever runs it
does the judgement half: that every claim is cited or marked unverified, and that no standing
contradicts what its records say. Run it before committing any change to the wiki.

## Writing

Plain, short sentences. A number with the control that could have come out otherwise. Name a
target by its repository name only: no paths, hosts or people. Links are ordinary relative
markdown, so they work in the repository and on the published site alike.

## Publishing

GitHub Pages builds `wiki/` with Jekyll on every push to `main` that touches it
(`.github/workflows/pages.yml`). `raw/` is deliberately not published: it is evidence, read in
the repository. A `[@...]` citation is therefore a repository reference, not a web link.
