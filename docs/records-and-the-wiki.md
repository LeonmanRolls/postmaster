# Records and the wiki

What the project has learned is in [`wiki/`](../wiki/index.md), published with GitHub Pages, on
the LLM-wiki pattern: how harnesses really behave as against what their documentation says,
what the services the flow depends on actually do, why the design is shaped as it is, and
what happens when several models implement one ticket. That last is the founding question,
not the only subject.

Every run writes its full record (ledger, narrative, harness logs) to its own project's
`.postmaster/`, which is gitignored: that is the instance's business, not the tool's.
Promoting one into [`raw/`](../raw/README.md) is a separate decision, and a decision to publish:
it happens after a scrub, only for a target that may be published, and only with what may
lawfully be redistributed. `raw/` is committed, so any claim can be followed to the record
behind it by anyone who clones the repository. A claim whose evidence could not be promoted
is not made.

The claims above about combining models start there marked as claims, and the wiki grows one
record at a time. `skills/wiki` carries the three operations: ingest, query, lint.

Back to the [README](../README.md).
