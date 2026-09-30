# Workhorse spec: #159 Score each lane's harvested branch beside the merged result

## Summary

`fixture.sh score` currently runs the ticket's hidden tests only against the merged result on
main, so a fixture record cannot show whether each lane's own branch would already have passed
them. This workhorse extends `score` to run the same hidden suite against each lane's harvested
`wb/<TICKET>-<lane>` branch and print each lane's pass and fail counts beside the merged
result's, reporting a missing or unbuildable lane as such and never as a pass.

## Technical context

- **Language and version**: bash entry point with the scoring logic in a Python 3 heredoc inside
  `scripts/fixture.sh` (the existing `py` function); self-test in bash in the same file.
- **Dependencies used or added**: none. Reuses `fixture.sh`'s own `hidden()` helper and `git
  archive` export path; `bun` and `npm` are already required by `score`.
- **Testing**: `scripts/fixture.sh --self-test` (the new lane controls live there); then the
  project gate `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'` via
  `/home/brindlewick/.postmaster/tool-pins/73fca4e4a513d8915bf067723d54871b4b8ba728/scripts/verify.sh run .`.
- **Constraints**: reuse `fixture.sh hidden` for each lane branch; nothing the lanes see changes
  (no runbook, waybill template, or workhorse-facing file). Score still judges the run on the
  merged result; lane counts are measurement beside it.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Reuse `fixture.sh hidden` for each lane branch | `check_hidden` already calls the `hidden()` helper that `fixture.sh hidden` exposes; the same helper runs once per exported lane branch. No second test path. |
| Nothing the lanes see changes | Only `scripts/fixture.sh` is touched: the `score` path in the `py` heredoc, that file's header comment, and its `--self-test`. No `skills/`, no fixture app, no ticket files. |
| Every count needs a control (AGENTS.md) | AC3's three controls are the positive (a lane that passes), the negative (a lane that fails) and the zero/absent case (a lane that is missing). A fourth control covers AC2's "failed to build". All score through the same `score_run` command. |
| Deterministic work goes in `scripts/` | Lane discovery, export and reporting are Python in `fixture.sh`, not prose for a coachman to re-derive. |
| A run is scored from its records | Lane names come from the run's own `manifest.json` / `audit/` / waybill `workhorses:` line and the `wb/<TICKET>-<lane>` archive the runbook says to keep; score does not ask the lanes or the harnesses anything. |

## Structure

- `scripts/fixture.sh`
  - Header comment: `score` also reports each lane's hidden counts beside the merged result.
  - `py` score path:
    - Resolve the run's ticket id from the waybill `# Waybill: <TICKET>` line (fallback: the
      dispatch directory's basename).
    - Discover lane names from the run's records: `manifest.json` `lanes` keys, plain
      `audit/<lane>.md` names, the waybill's `workhorses:` line, and any `wb/<TICKET>-*` ref.
    - For each lane, export `wb/<TICKET>-<lane>` the same way main is exported and run
      `hidden()` on that tree.
    - Append `; <lane>: <status>` to the hidden-tests detail. Status is `N pass, M fail`,
      `missing`, or `failed to build`. The check's ok/FAIL still judges only the merged result.
  - `--self-test`: lane branches and a manifest that names them, plus assertions that a passing
    lane, a failing lane, a missing lane and an unbuildable lane are reported correctly and that
    missing / failed-to-build never read as a pass.

## Complexity tracking

No departure from the ticket's direction or the project's rules.

## Decisions

1. **What "harvested branch" means.** The `wb/<TICKET>-<lane>` tip the coachman is told to keep
   as a local archive (`coachman.md`). Score reads that ref; it does not parse a harvest SHA out
   of `audit/<lane>.md` prose. A lane whose archive branch is gone is exactly AC2's missing case.
2. **Where lane names come from.** The union of `manifest.json` `lanes` keys, plain
   `audit/<lane>.md` basenames (not `*-spec.md` / `*-spec-final.md`), the waybill `workhorses:`
   names before `=`, and `wb/<TICKET>-*` refs. A name in any of those is a lane of this run; a
   branch with no name in the records is still scored, because it is a harvested lane branch.
3. **Ticket id for the branch prefix.** `# Waybill: <TICKET>` on the waybill, else the dispatch
   directory's basename (the self-test and the runbooks both use the ticket id there).
4. **Report shape.** One hidden-tests line, still seven lines on stdout overall, with each lane
   appended beside the merged counts: `… on main; one: 5 pass, 0 fail; two: missing`. The
   existing `expect` helper's seven-line contract and its `fail on main` control stay valid.
5. **Lane results do not change the score's exit code.** The score judges whether the run shipped
   the ticket; the lane counts are the measurement combining-models H1 asked for. A missing or
   failed lane is reported on the line, never as `N pass` / `ok`, and does not alone exit 2.
6. **Missing vs failed to build.** No `wb/<TICKET>-<lane>` ref → `missing`. Ref exists but the
   export fails, the tree has no `package.json`, or `hidden()` yields no pass/fail counts (bun
   cannot run the suite against it) → `failed to build`. A suite that runs and reports counts is
   those counts, even when every test fails.
7. **A failed-to-build control ships with the three AC3 names.** AC2 names that state; leaving it
   untested would leave the only "never as a pass" path without a control.

## Tasks

- [ ] T001 [P] [AC1] Extend `check_hidden` / `score` in `scripts/fixture.sh` to export each lane's `wb/<TICKET>-<lane>` branch and run `hidden()` on it, appending `; <lane>: N pass, M fail` beside the merged result's counts.
- [ ] T002 [AC2] In the same score path, report a lane with no ref as `missing` and a lane whose export or hidden suite cannot run as `failed to build`, never as pass counts; cover both in the status helper.
- [ ] T003 [AC3] Add self-test controls in `scripts/fixture.sh --self-test` for a lane branch that passes, one that fails, and one that is missing, each asserted on the hidden-tests line through `score_run`.
- [ ] T004 [AC2] Add a self-test control for a lane branch that fails to build (no runnable app), asserted the same way and never as a pass.
- [ ] T005 [AC1] Update the `score` description in the `scripts/fixture.sh` header comment to mention the per-lane hidden counts beside the merged result.
