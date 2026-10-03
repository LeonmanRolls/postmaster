---
name: wiki
description: 'Operate the postmaster wiki, the project knowledge base: how harnesses and services really behave, why the design is as it is, and what happens when several models implement one ticket. Ingest promotes a run somebody chose to keep, or captures a paper or article, into committed raw evidence and compiles a page from it; nothing arrives automatically. Query answers with citations. Lint runs scripts/wiki-lint.sh over citations, links, standings and orphans. Every claim traces to a promoted run, a recorded trial or a captured source. Invoke via /wiki.'
---

# /wiki: ingest, query, lint

The wiki compiles what the project knows once and keeps it current, instead of re-deriving it
from chat histories. **Read `wiki/schema.md` first**; it is the contract for every page, and
this file only says how to perform the three operations. It works in a checkout of the
postmaster repo, the main one or a worktree, and every path here is relative to that
checkout's root.

Three layers, and the direction is one-way. A run writes its full record to its own
project's gitignored `.postmaster/`, automatically and always. `raw/` is written once, by
decision, when a run is promoted, a trial is recorded or a source is captured. `wiki/`
compiles from `raw/`. No operation ever edits `raw/`, and nothing moves from `.postmaster/`
to `raw/` without somebody choosing it.

**`raw/` and `wiki/` are both committed and public.** The gate is therefore at promotion, not
at the page: a record enters `raw/` only after a scrub, only when its target may be published,
and only carrying what may lawfully be redistributed. Once it is in, cite it freely — a reader
can open it. If evidence cannot be promoted, the claim it would have supported is not made,
and the page says what it could not show.

Three kinds of evidence with different force. A **run** says what this fleet did and can move
a standing. A **trial** is a deliberate experiment and settles the narrow question it was
designed for, carrying a `method.md` so it can be repeated. A **paper or article** says what
someone else claims: it motivates a hypothesis and belongs in what would settle it, but never
moves a standing on its own.

## ingest a run

A run has ended **and somebody has decided it is evidence**. Most runs are operational and
stay where they are: every run writes its full record to `<project>/.postmaster/runs/<run-id>/`
already, harness logs included, and that directory is gitignored. Ingest is the deliberate act
of promoting one of them to evidence. Never ingest on your own initiative; ask.

It is only ingestible once it has stopped writing.

1. **Copy the run whole** from `<project>/.postmaster/runs/<run-id>/` into `raw/runs/<run-id>/`,
   unchanged: the ledger, the narrative, the cards, `logs/` with each lane's harness events
   stream, and each lane's durable harness session exported at teardown (`grok export`,
   codex's rollout jsonl, pi's session jsonl). **Run the promotion checks first** — scrub,
   target publishable, size, redistribution — per `raw/README.md`. The copy is a decision to
   publish, and it is the only moment those checks happen.
2. **Write the run record** in `wiki/sources/YYYY-MM-DD-<target>-<ticket>.md` from
   `wiki/sources/template.md`, filling every section from the copied files. Every number
   carries `[@runs/<id>/<file>]`.
3. **Update the standings** of every concept the record bears on, per the evidence, not per
   the narrative. A standing may only move on what a run record says.
4. **Cross-reference** with `[[wikilinks]]` in both directions.
5. **Append to the log**: `## [YYYY-MM-DD] ingest | <title>`, naming which standings changed.

Never ingest a run that is still in flight, and never ingest twice: if `raw/runs/<run-id>/`
exists, the run is already in.

## ingest a source

A paper, article or documentation page worth keeping.

1. **Capture the text** into `raw/papers/<slug>/` or `raw/articles/<slug>/` with its
   `source.md` front matter (url, retrieved, title, author). A link alone is not a capture:
   pages move and a citation to a moving page is not a citation. Fetching is bounded by the
   machine's egress allowlist; a source behind a disallowed host is one the user supplies.
2. **Write its page** in `wiki/sources/`: what it claims, on what evidence, and what it would
   mean here if true.
3. **Link it** from every concept it bears on, in the section on what would settle that
   concept. **Do not change a standing**: outside work is a hypothesis, not a result.
4. **Append to the log**: `## [YYYY-MM-DD] ingest | <title>`.

## query

A question the wiki may already answer.

1. Read `wiki/index.md`, then the pages it points at. Do not re-derive from `raw/` what a
   page already compiles.
2. **Answer with citations.** Where the answer rests on a run, cite it; where it rests on
   nothing, say so plainly rather than inferring.
3. If the answer is worth keeping, file it as a page and log it. A good answer left in a chat
   is lost.

## lint

A health check. Run it before committing any change to the wiki.

```sh
scripts/wiki-lint.sh              # faults on stdout, exit 1 if any
bun test scripts/wiki-lint.test.ts  # each check fails on its own fault; a clean tree passes
```

**What the script checks.** The tests beside it have a failing case for every item here:

- every page has front matter with `title`, `type` and `updated`, and a concept also has a
  `standing` that is one of the five
- every citation in the text, such as `[@runs/...]` or `[@trials/...]`, resolves to a path
  under `raw/`, and so does every source a concept lists in its front matter
- a standing other than `claimed` rests on at least one run or trial, never on papers or
  articles alone, and `supported` rests on at least three
- every `[[...]]` resolves to a page, and every relative link resolves
- no orphan page: everything is reachable from `wiki/index.md`
- every trial has a `method.md`, and every captured paper or article has a `source.md` giving
  its url and retrieval date

**What a person checks, because no script can.** Passing the script says nothing about these:

- every claim carries a citation, or is marked unverified in the sentence making it
- no standing contradicts what its records actually say
- nothing under `raw/` is something the promotion checks should have refused: a secret, a
  private target's detail, a wholesale copy of someone else's work

A contradiction between a standing and its records is reported, never quietly corrected: it
means either the standing or the reading of a record is wrong, and which one is a judgement
for the user. The script reports and fixes nothing for the same reason.

Notation in backticks is not a citation: `[@papers/<slug>]` documents the syntax, and the
script skips code spans and fenced blocks so that examples do not fail the check.
