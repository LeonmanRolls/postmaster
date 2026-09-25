---
title: Log
type: schema
updated: 2026-09-25
---

# Log

Append-only. Newest first. One entry per operation, prefixed so it can be parsed.

## [2026-09-25] ingest | harness diversity, pre-registered

Issue #12's question leaves the open questions on combining models for a concept page of its
own, at standing `claimed`. The page states the claim, three arrangements with the same model on
the same harness as the control, the measures and controls of issue #9, the confounds each run
records, how the result decides the diversity rule in `[team]`, and a cheap trial to run first.
Nothing bears on it yet.

## [2026-09-23] lint | workhorse replaces arm

The project no longer says arm for a lane that implements the ticket; it says workhorse, and a
workhorse's own plan is the workhorse spec. The decision page is renamed to match, as is the
template it describes. Entries below that say arm or horse stand as written.

## [2026-09-23] ingest | a horse's spec uses Spec Kit's plan and tasks format

Captured GitHub Spec Kit's spec, plan and tasks templates into
`raw/articles/spec-kit-templates/`, with their MIT license, pinned to one commit. A horse's
A horse's own spec now follows the plan and tasks templates in one file; the ticket plays the part of
Spec Kit's spec. The decision page records the mapping and the three adaptations. The source is
outside work: it shapes the format and does not move the page's standing, which stays
`claimed`.

## [2026-09-23] ingest | each horse drafts its own spec

First page in the Decisions area. The ticket carries the what, the why and the high-level
direction; each horse then drafts its own detailed spec, committed before any code. It keeps the
horses independent and the coachman a neutral judge, and at this stage it is an audit record
that nobody reviews during the run. Standing `claimed`, since no run bears on it yet; issue #9
is the test.

## [2026-09-22] lint | lint claims only what it checks

The skill introduced its list of checks with "what it enforces", but the script did six of
the ten, one only in part, and three need a person. Both the skill and the schema also called
lint part of the repo's gate, which does not exist yet. The two missing checks that are
mechanical now run: a capture's `source.md` must give a url and a retrieval date, and a
standing beyond `claimed` must rest on at least one run or trial, with every front-matter
source resolving under `raw/`. The documentation now separates what the script checks from
what a person checks, and the self-test has a failing case, asserted on its own reason, for
every check the script claims.

## [2026-09-22] lint | the homepage is for readers

The homepage carried instructions meant for whoever maintains the wiki: how evidence reaches
`raw/`, an order to read the schema before operating, the line between a concept and a
runbook, and a table counting records. None of it helps someone reading the wiki, and all of
it already lives in `raw/README.md` or the schema. The homepage now says what the wiki covers,
how to read a standing and a citation, and lists the pages. It is also what the postmaster
reads before decomposing a stream, so a shorter page costs less on every run.

## [2026-09-22] lint | sources hold what was chosen, not every run

The sources index still said "one page per finished run" and that the first would arrive from
the first dispatch to reach a ship card, which described the first draft rather than the
design. Nothing reaches `raw/` or `sources/` on its own: a run's record stays in its project's
`.postmaster/` unless somebody promotes it. The index, the schema's page kinds and the wiki
skill now say so, and say that a captured paper or article also gets a sources page while a
recorded trial is cited directly. The skill's description, which decides when an agent loads
it, still described the wiki as answering only the multi-model question from run ledgers;
it now matches the scope and the three kinds of evidence.

## [2026-09-22] lint | raw is committed, and promotion is the gate

`raw/` had been gitignored on the grounds that logs are public-unsafe and instance-specific.
That reasoning outlived its cause: everything automatic now lives in each project's
`.postmaster/`, so reaching `raw/` is already a deliberate act. Making that act the publication
decision — scrub, publishable target, lawful redistribution — lets the evidence be committed,
which is the point of a wiki with sources: a standing can be followed to the record behind it
by anyone who clones the repository. The sha256 provenance mechanism goes with it, since git
supplies integrity. The entry below headed "raw made local and uncommitted" is the one this
reverses, and it stands as written: this log is append-only, and it is accurate as a record of
what was decided at the time.

## [2026-09-22] ingest | prompt delivery differs by harness

First concept outside the founding question, and the first carrying evidence: pi's attachment
form delivers a different message from stdin, it hangs on an inherited pipe, and a resume
against another directory's session exits 0 having done nothing. Settled by controlled trial
against pi 0.87.0; changed harnesses.md and launch.sh in pull request #1.

## [2026-09-22] lint | wiki rescoped to the whole project

It had been written as though its only subject were whether combining models works. That is
the founding question, not the scope: harness behaviour, the services the flow depends on, and
the reasons behind design decisions all belong here. Index reorganised by area, and the line
between a concept and a runbook stated: a runbook says what to do, a concept says what is
known and how sure.

## [2026-09-22] lint | raw is a deliberate subset, not the default home of a run

Every run's full record, harness logs included, belongs in `<project>/.postmaster/`, which is
gitignored in whatever project it is. Nothing reaches `raw/` automatically: a record is copied
in only when somebody decides that run is evidence for a claim. Most runs are operational; a
few are evidence, and the difference is a decision rather than a default.

## [2026-09-22] lint | raw made local and uncommitted

`raw/` sat in the repository root, so run evidence would have been committed to a public repo
whatever the published site rendered. It is now gitignored, its contract aside. Runs are
specific to the instance that made them and carry its paths and ticket text; the tool's
history is not the place for them. Compiled records now carry the sha256 of each file they
drew on, so provenance survives without the evidence being published, and lint checks that no
page quotes raw or names a path.

## [2026-09-22] lint | raw widened to published sources

`raw/` had been restricted to runs, which contradicted the pattern and would have blocked the
literature the spec-detail and harness-diversity questions need. It now takes `papers/` and
`articles/` alongside `runs/`, each capture carrying its url and retrieval date. The rule that
keeps the two apart: a run can move a standing, a paper cannot. Run ingest also now copies each
lane's harness events stream and its exported session, which were previously left on the
machine.

## [2026-09-22] lint | wiki rebuilt on the LLM-wiki pattern

Restructured to immutable `raw/` sources, compiled `wiki/` pages, front matter with
standings, `[@source]` citations and `[[wikilinks]]`. Added the harness-diversity open
question. No raw records and no run records yet, so every standing is `claimed` and nothing
carries a citation.

## [2026-09-22] ingest | wiki created

The three claims the README makes, entered as hypotheses at standing `claimed`, with four
open questions and the run-record template.
