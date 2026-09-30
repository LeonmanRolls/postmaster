# Workhorse spec: 160 Record what each launch costs, per role and lane

## Summary

No run records what its lanes, reviewers and coachman cost: every closing record says the run
is unmetered. This workhorse adds a harness-adapter reading of usage from each harness's own
event stream or session record, records the figures a harness reports at each launch into the
run's records, and has the closing record sum them per role and lane — naming harnesses that
report nothing and never writing a missing figure as zero — with paired self-test controls per
harness from recorded streams.

## Technical context

- **Language and version**: Bash 3.2+/4 with Python 3.11+ in heredocs, as the rest of `scripts/`.
- **Dependencies used or added**: none beyond what the scripts already use (`python3`, `jq` not needed).
- **Testing**: `scripts/usage.sh --self-test` (paired per-harness fixtures, positive and negative);
  `bash -n scripts/usage.sh`; the project's gate (`.postmaster/project.toml` `[checks.gate]`);
  `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
  just before the summary.
- **Constraints**: read usage from each harness's own event stream or session record, never
  estimate from text length (ticket direction). Per-harness reading lives behind the harness
  adapter (`skills/postmaster/harnesses.md` + its executable forms). Deterministic work in
  `scripts/`, not prose. Every count needs a control that could have come out the other way.
  Never modify postmaster runbooks, scripts or adapters except as this ticket requires. Script
  paths under `skills/postmaster/` go through `<tool>`. A missing figure is never recorded as
  zero.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Read usage from each harness's own event stream or session record; do not estimate from text length | `scripts/usage.sh` only copies fields the harness itself writes (the same style as `view-stream.sh` and `export-session.sh`). No length-based or token-count estimation exists anywhere in the change. |
| Per-harness reading lives behind the harness adapter | Field names and event/session shapes are known only to `scripts/usage.sh` and documented per harness in `skills/postmaster/harnesses.md`, beside the other adapter forms (`launch.sh`, `view-stream.sh`, `export-session.sh`). The runbooks say "cost"; the adapter says what that means per harness. |
| Self-test control per harness from a recorded stream: one that reports usage, and one that does not | `scripts/fixtures/usage/` holds one recorded stream pair per harness (`<harness>-with-usage.jsonl`, `<harness>-no-usage.jsonl`). `usage.sh --self-test` runs the identical `read` on both: the with-usage stream must yield non-zero figures where the harness reports them, the no-usage stream must yield no figure and must not yield zero. |
| Every launch records figures in the run's records, per role and lane | `usage.sh record` writes one JSON record beside the launch's events stream under `<dispatch>/logs/`, carrying `role`, `lane`, `name`, `harness` and only the figures present. `launch.sh` calls it on every run launch, resume and review, best-effort the way it calls `export-session.sh`, so a recording fault never changes the harness's exit. |
| The closing record sums them per role and lane, names harnesses that report nothing, never records a missing figure as zero | `usage.sh sum <dispatch>` reads the run's usage records and prints the closing block: one line per (role, lane) with the summed figures, "not reported" for an absent figure, and a line naming any harness whose launches reported no figures at all. `coachman.md` Stage 4 puts that block in the final `run-log.md` entry and on the ship card. |
| Deterministic work in `scripts/` (AGENTS.md design rule 3) | Extracting, recording and summing are all in `usage.sh`. The coachman's closing entry quotes the script's output; it does not re-derive numbers. |
| Every count needs a control (AGENTS.md design rule 5) | The with-usage fixture is the positive control (non-zero, exact figures) and the no-usage fixture the negative control (absent, never zero), for every harness, through one command. |
| Nothing harness-specific outside an adapter (AGENTS.md design rule 2) | `usage.sh` is the adapter's executable form; `harnesses.md` is the prose. `coachman.md` and `postmaster.md` do not name harness fields. |
| Never modify postmaster except as this ticket requires | Touch only: new `usage.sh` + its fixtures, the `launch.sh` post-launch call, `harnesses.md`'s usage section, `coachman.md`'s closing-record line, and `project.toml`'s gate list so the new self-test runs. |
| Script paths in `skills/postmaster/` go through `<tool>` | New references are `<tool>/scripts/usage.sh`. `scripts/skill-refs.sh` stays clean. |

No departures from the direction.

## Structure

Create:

- `scripts/usage.sh` — the adapter's usage reading and the run's usage records.
  - `usage.sh read <events> <harness> [<session>]` — print one JSON object: the figures the
    harness reports in that stream (or, where the harness reports usage only in its session
    record, in that record). Keys for absent figures are omitted. Cost is included only where
    the harness reports one.
  - `usage.sh record <events> <harness> <name> <dispatch> [--role <role>] [--lane <lane>]`
    — write `<dispatch>/logs/<events-basename>-usage.json` for that launch. `role` is
    `workhorse`, `reviewer` or `coachman`; `lane` is the lane name, the reviewer's lane, or the
    coachman leg. Defaults derive from the name the way `launch.sh` already knows it.
  - `usage.sh sum <dispatch>` — print the closing block (see Decisions for its shape).
  - `usage.sh --self-test` — paired fixture controls for every harness.
- `scripts/fixtures/usage/` — recorded streams, one pair per harness in
  `harnesses.md`'s table (codex, grok, agy, claude, pi, muse, mimo):
  `<harness>-with-usage.jsonl` and `<harness>-no-usage.jsonl`.

Change:

- `scripts/launch.sh` — after the existing `export-session.sh` call on a run launch, call
  `usage.sh record` on the same events stream (and the exported session where the harness
  reports usage only there). Warn on failure; still exit with the harness's status.
- `skills/postmaster/harnesses.md` — a Usage subsection: where each harness reports input and
  output tokens and cost (event type and field path, or the session record), and
  `<tool>/scripts/usage.sh` as this file's executable form for that reading.
- `skills/postmaster/coachman.md` — Stage 4: the final `run-log.md` entry and the ship card
  carry `<tool>/scripts/usage.sh sum <dispatch>`'s output as the cost, never a hand-recomputed
  figure and never zero for a figure no harness reported.
- `.postmaster/project.toml` — add `usage` to the gate's `--self-test` list; the shows line's
  count becomes 41.

## Complexity tracking

None.

## Decisions

1. **New script `scripts/usage.sh`, not a mode of `export-session.sh` or `view-stream.sh`.**
   Those two are a session exporter and a stream renderer; summing at close belongs to neither.
   Per-harness field knowledge is already duplicated between `view-stream.sh` and
   `export-session.sh` (thread-id shapes), so a third adapter form follows the existing pattern
   rather than a shared library the repo does not have.
2. **Per-launch record at `<dispatch>/logs/<events-basename>-usage.json`,** beside the events
   stream it was read from. One record per stream, overwritten with the whole-stream reading on
   each launch or resume that appends to it, so a remount does not double-count. Review rounds
   already have distinct stream names (`review-r<n>-<lens>-<lane>.jsonl`), so they do not
   overwrite a workhorse's record or each other.
3. **Absent figures are omitted keys, never 0.** A harness that reports `0` is recorded as 0;
   a harness that reports nothing has no such key. `sum` prints `not reported` for a figure no
   launch under that (role, lane) reported, and `X (n of m launches)` when only some did.
4. **Role and lane.** `role` ∈ `workhorse`, `reviewer`, `coachman`. `lane` is the workhorse's
   lane name, the reviewer's lane name, or the coachman's leg (`synthesis` / `review` / `ship`).
   The sum is one line per (role, lane); the per-launch record also carries the stream's name so
   individual launches stay auditable.
5. **`sum`'s shape** (one line per (role, lane), then a harness line only when needed):
   ```
   cost: workhorse luna (claude): 12345 in, 678 out, $0.42
   cost: workhorse mimo (mimo): 23456 in, 890 out, cost not reported
   cost: reviewer luna (claude): 3210 in, 45 out, $0.08 (2 of 3 launches)
   cost: coachman synthesis (claude): 4567 in, 89 out, $0.12
   cost: harness agy reports nothing
   ```
   A figure the harness never reported reads `... in not reported` / `cost not reported`, never
   `0 in` / `$0.00`.
6. **Recording is best-effort; summing is required for the closing record.** A `record` fault
   warns and leaves the launch's exit alone (the `export-session.sh` pattern). A `sum` fault is
   quoted in the closing entry as "cost could not be read", never as zeros.
7. **Fixture origin.** Streams are trimmed from recorded runs where the repo already holds them,
   or written in the harness's exact event shape from its documented schema where no recorded
   usage-bearing stream exists yet — the way `view-stream.sh`'s controls already say "trimmed
   from a recorded run". A fixture is evidence about the reader, not a claim that a live harness
   always emits that shape; `harnesses.md` names the source of each shape.
8. **Which "closing record".** `coachman.md` already names cost in the final `run-log.md` entry
   and the audit that opened this ticket read the ship card. Both carry the `sum` block. The
   outward ticket comment keeps its one-line summary and is not required to restate the block.
9. **The gate list grows to 41 self-tests** (`usage` added). This run's recorded checks still
   hold the gate as recorded at dispatch; `usage.sh --self-test` is run directly as well and its
   exit is reported in the summary.

## Tasks

- [ ] T001 [P] [AC3] `scripts/usage.sh read`: per-harness usage reading from an event stream or
  session record; `scripts/fixtures/usage/` with a with-usage and a no-usage recorded stream for
  each harness in `harnesses.md`'s table; `--self-test` pairs (positive reads non-zero, negative
  reads absent and never zero) through one command.
- [ ] T002 [P] [AC1] `scripts/usage.sh record`: write `<dispatch>/logs/<events-basename>-usage.json`
  per launch with role, lane, name, harness and only the figures reported; call it from
  `scripts/launch.sh` after `export-session.sh` on every run launch, resume and review,
  best-effort.
- [ ] T003 [P] [AC2] `scripts/usage.sh sum <dispatch>`: sum the run's usage records per role and
  lane, print `not reported` for an absent figure, note partial coverage, name harnesses that
  report nothing; never emit a missing figure as zero.
- [ ] T004 [AC1] [AC3] `skills/postmaster/harnesses.md`: a Usage subsection naming where each
  harness reports input/output tokens and cost (event or session fields) and
  `<tool>/scripts/usage.sh` as the adapter's executable form of that reading.
- [ ] T005 [AC2] `skills/postmaster/coachman.md` Stage 4: the final `run-log.md` entry and the
  ship card carry `<tool>/scripts/usage.sh sum <dispatch>`'s block as the cost; a figure no
  harness reported is never written as zero.
- [ ] T006 [AC3] `.postmaster/project.toml`: add `usage` to the gate's self-test list and update
  the shows line's count; keep `scripts/skill-refs.sh` and the rest of the gate green.
