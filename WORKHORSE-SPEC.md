# Workhorse spec: #160 Record each launch's tokens and cost where its harness reports them

## Summary

Read the input/output tokens and cost each harness reports for a launch from its own
event stream or session record, keep those figures in the run's records per role and
lane, and sum them in the run's closing record, naming harnesses that report nothing
and never writing a missing figure as zero.

## Technical context

- **Language and version**: TypeScript run by Bun, Bun the only dependency, in a
  functional style: no mutation unless truly necessary, a pure core with side
  effects at the edges.
- **Dependencies used or added**: none beyond Bun itself. No tsconfig, no
  package.json, no shared TypeScript infrastructure: the new script and its tests
  stand alone on Bun's defaults, so branches adding TypeScript in parallel merge
  in any order.
- **Testing**: `scripts/usage.test.ts` beside the script, run with `bun test`;
  `bun test` is the one command that runs the paired per-harness controls. The
  project's gate runs them; `verify.sh run .` just before the summary.
- **Constraints**: read usage from each harness's own event stream or session record,
  never estimate from text length. Per-harness reading lives behind the harness
  adapter. Deterministic work in `scripts/`, not prose. Every count needs a control.
  A missing figure is never recorded as zero. Fixture streams hold made-up values
  only, never trimmed from real run records. Touch only what this ticket requires.

## Direction check

- Read usage from each harness's own event stream or session record; do not estimate
  from text length: the reader only copies fields the harness itself writes. No
  length-based estimation exists anywhere in the change.
- Per-harness reading lives behind the harness adapter: field names and stream or
  session shapes are known only to the new script and documented per harness in
  `skills/postmaster/harnesses.md`, beside the adapter's other forms. Runbooks say
  "cost"; the adapter says what that means per harness.
- Self-test control per harness from a recorded stream, one that reports usage and
  one that does not: `scripts/fixtures/usage/` holds one recorded pair per harness
  in `harnesses.md`'s table, built in each harness's exact event shape with made-up
  values only. `bun test scripts/usage.test.ts` runs the identical read on both:
  the with-usage stream must yield the figures it carries, the no-usage stream must
  yield no figure and must not yield zero.
- Each launch records its figures in the run's records, per role and lane: the new
  script writes one record per launch beside that launch's events stream, carrying
  role, lane, harness and only the figures reported. `launch.sh` calls it through
  Bun after its existing session export on every run launch, resume and review,
  best-effort, so a recording fault never changes the harness's exit.
- The closing record sums per role and lane, names harnesses that report nothing,
  never records a missing figure as zero: the new script's sum prints the closing
  block; `coachman.md` Stage 4 carries that block in the final `run-log.md` entry
  and on the ship card, quoted, never hand-recomputed.
- Nothing harness-specific outside an adapter, deterministic work in scripts, every
  count a control: extraction, recording and summing are all in the one new script;
  `coachman.md` and `postmaster.md` name no harness fields.
- Script paths under `skills/postmaster/` go through `<tool>`; `skill-refs.sh`
  stays clean.

No departures from the direction.

## Structure

Create:

- `scripts/usage.ts` — the adapter's usage reading and the run's usage records:
  - `read` — print one JSON object with the figures a harness reports in one
    event stream (or, where a harness reports usage only in its session record,
    in that record). Keys for absent figures are omitted. Cost appears only
    where the harness reports one.
  - `record` — write one usage record for one launch beside that launch's
    events stream, carrying role, lane, harness and only the figures reported.
    Re-reading a stream that grew (a resume or remount) replaces that stream's
    record with the whole-stream reading, so one stream is never double-counted.
  - `sum <dispatch>` — print the closing block over the run's usage records
    (see Decisions for its shape).
- `scripts/usage.test.ts` — the tests beside the script: the paired fixture
  controls for every harness, run with `bun test`.
- `scripts/fixtures/usage/` — recorded streams, one with-usage and one no-usage
  stream per harness in `harnesses.md`'s table (codex, grok, agy, claude, pi,
  muse, mimo), made-up values only in each harness's exact event shape.

Change:

- `scripts/launch.sh` — after the existing `export-session.sh` call on a run
  launch, call the usage record through Bun on the same events stream (and the
  exported session where the harness reports usage only there). Warn on failure;
  still exit with the harness's status. Role and lane reach the record from the
  launch site (arguments or environment), never guessed from paths.
- `skills/postmaster/harnesses.md` — a Usage subsection: where each harness
  reports input and output tokens and cost (event type and field path, or the
  session record), and the new script as this file's executable form of that
  reading.
- `skills/postmaster/coachman.md` — Stage 4: the final `run-log.md` entry and the
  ship card carry the sum block as the cost, quoted, never hand-recomputed and
  never zero for a figure no harness reported.
- `.postmaster/project.toml` — the gate runs the new tests; update the shows
  line's count.

## Complexity tracking

None.

## Decisions

1. **TypeScript on Bun, self-contained.** A new script is TypeScript run by Bun,
   Bun the only dependency, functional in style. Its tests sit beside it as
   `scripts/usage.test.ts` and run with `bun test`. No tsconfig, no package.json,
   no shared helpers: Bun runs the script and its tests with no project setup,
   and parallel branches adding TypeScript merge in any order without absorbing
   each other's scaffolding.
2. **One record per events stream, beside the stream it was read from.** A central
   log cannot survive a resume: re-reading a stream that grew would double-count
   unless records are deltas, and deltas are fragile. A per-stream record replaced
   by each whole-stream re-read is idempotent across resumes and remounts. Review
   rounds already have distinct stream names, so they neither overwrite a
   workhorse's record nor each other.
3. **Absent figures are omitted keys, never 0.** A harness that reports `0` is
   recorded as 0; a harness that reports nothing has no such key. The sum prints
   `not reported` for a figure no launch under that (role, lane) reported, and
   marks partial coverage (`X (n of m launches)`) when only some launches
   reported it.
4. **Role and lane.** Role is workhorse, reviewer or coachman. Lane is the lane
   name for a workhorse or reviewer, and the coachman leg for the coachman. The
   sum is one line per (role, lane); each per-launch record also carries the
   stream's name so individual launches stay auditable.
5. **The sum's shape** (one line per (role, lane), then a harness line only when
   needed):
   ```
   cost: workhorse luna (claude): 12345 in, 678 out, $0.42
   cost: workhorse mimo (mimo): 23456 in, 890 out, cost not reported
   cost: reviewer luna (claude): 3210 in, 45 out, $0.08 (2 of 3 launches)
   cost: coachman synthesis (claude): 4567 in, 89 out, $0.12
   cost: harness agy reports nothing
   ```
   A figure the harness never reported reads `not reported`, never `0`.
6. **Recording is best-effort; the closing record quotes the sum.** A record fault
   warns and leaves the launch's exit alone (the `export-session.sh` pattern). A
   sum fault is quoted in the closing entry as unreadable, never as zeros.
7. **Fixtures are made up, never trimmed.** Real run records carry private context
   — paths, session ids, prompt text — that must not be committed. Every fixture
   stream is built in the harness's exact event shape with invented values;
   `harnesses.md` names the source of each shape.
8. **Which closing record.** `coachman.md` already names cost in the final
   `run-log.md` entry, and the audit that opened this ticket read the ship card.
   Both carry the sum block. The outward ticket comment keeps its own summary
   and is not required to restate the block.

## Tasks

- [x] T001 [P] [AC3] Usage reading and fixtures in `scripts/usage.ts`:
  per-harness reading from an event stream or session record;
  `scripts/fixtures/usage/` with a with-usage and a no-usage stream of made-up
  values in each harness's exact event shape for each harness in
  `harnesses.md`'s table; `scripts/usage.test.ts` pairs (with-usage reads the
  figures it carries, no-usage reads absent and never zero) through `bun test`.
- [ ] T002 [P] [AC1] Per-launch records: one usage record per events stream
  beside the stream, with role, lane, harness and only the figures reported;
  call it from `scripts/launch.sh` through Bun after `export-session.sh` on
  every run launch, resume and review, best-effort, with role and lane passed
  from the launch site.
- [x] T003 [P] [AC2] Closing sum: `sum` over the run's usage records per role and
  lane, `not reported` for an absent figure, partial coverage marked, harnesses
  that report nothing named; never a missing figure as zero.
- [ ] T004 [AC1] [AC3] `skills/postmaster/harnesses.md`: a Usage subsection naming
  where each harness reports input/output tokens and cost, and the new script as
  the adapter's executable form of that reading.
- [ ] T005 [AC2] `skills/postmaster/coachman.md` Stage 4: the final `run-log.md`
  entry and the ship card carry the sum block as the cost; a figure no harness
  reported is never written as zero.
- [ ] T006 [AC3] `.postmaster/project.toml`: the gate runs the new tests;
  update the shows line's count; keep `skill-refs.sh` and the rest of the gate
  green.
