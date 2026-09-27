---
title: Run record template
type: source
sources: [runs/<run-id>]
updated: YYYY-MM-DD
---

# Run record: YYYY-MM-DD, `<target>`, `<ticket>`

Copy this page to `sources/YYYY-MM-DD-<target>-<ticket>.md` and fill every section from
`raw/runs/<run-id>/`, which must already have been copied in. Name the target by its
repository name only. **Every number carries a citation** to the file it came from:
`[@runs/<id>/ledger.jsonl]`, which a reader can open. A figure with no citation does not
belong in a record.

The run is only here because it passed the promotion checks in `raw/README.md`, so cite it
plainly. Compile rather than transcribe: give the counts and outcomes and point at the lines,
since the ledger itself is one directory away. Where something was left out, say so rather
than implying the record is complete.

## The run

- Target: `<repository name>`
- Ticket: `<id>`, one line on what it asked for
- Lanes: `<name>` (`<harness>`, `<model>`), one per line; which were workhorses, which reviewers
- Coachman: `<harness>`, `<model>`
- Turnpikes: the waybill's `turnpikes:` line, and the legs the run had
- Outcome: shipped, abandoned or still open, and the date

## What the synthesis took (bears on H1)

One line per lane: what of its work reached the synthesis, from the coachman's synthesis
note. Then one line: did any lane's work reach it whole?

## Review findings (bears on H2)

| finding | lens | made by | also made independently by | held up |
|---|---|---|---|---|
| … | style, bug or security, or more than one | lane | lane, or none | yes, no, dismissed |

Counts: findings, corroborated findings, corroborated that held up, uncorroborated that held up.

## Disagreements recorded (bears on H3)

Each fork the coachman recorded as a proposed rule, and whether the project adopted it.

## Gate

The gate command, its exit on the synthesis before review and after the last round.

## Cost

Tokens per lane and for the coachman where the harness reports them; wall-clock from first
launch to ship card.

## Bears on

Which concepts this record affects, as `[[wikilinks]]`, and in which direction. Ingest updates
those pages' standings in the same pass and logs both.

## Source

`raw/runs/<run-id>/`, and the dispatch directory it was copied from, as recorded at the time.
