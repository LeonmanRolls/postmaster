# Workhorse spec: #159 A fixture run scores each lane's own branch against the hidden tests

## Summary

A fixture ticket's hidden tests are its acceptance tests in `fixtures/tickets/<ticket>/hidden/`, written before any run and never copied into a run's repository. `fixture.sh score` runs them only against the merged result on main. Extend `score` to run the same suite against each lane's harvested branch and report each lane's pass and fail counts beside the merged result's, with controls for a lane that passes, one that fails, one that is missing and one that fails to build. The lane scoring is a new TypeScript script run by Bun, `scripts/fixture-lanes.ts`, with its tests beside it in `scripts/fixture-lanes.test.ts`, run by `bun test`, and `fixture.sh score` calls it.

## Technical context

- **Language and version**: TypeScript run by Bun, which runs it with no build step, for the new script and its tests. Bash and the Python heredoc in `scripts/fixture.sh` only for the call that joins them.
- **Dependencies used or added**: Bun only. No packages, no `package.json`, no `tsconfig.json` and no lint config. `score` already requires `bun`, `git` and `npm`.
- **Testing**: `bun test scripts/fixture-lanes.test.ts` for everything new; then the project gate from the ticket profile via the tool's `scripts/verify.sh run .`, which runs `fixture.sh --self-test` for what `fixture.sh` already had. The gate knows nothing of TypeScript and does not run the new tests, so run both and record both results.
- **Constraints**: reuse `fixture.sh hidden` for each lane branch; nothing the lanes see changes; a missing or unbuildable lane is reported as such, never as a pass; Bun runs the new script with `--no-env-file`, so no `.env` in the working directory reaches it.

## Direction check

- **New code in TypeScript, run by Bun (the user's word).** The lane scoring is a new script, `scripts/fixture-lanes.ts`, with Bun its only dependency and no config files, so this branch and #109's TypeScript port can absorb each other whichever merges second.
- **As little as possible in `fixture.sh`, which #109 rewrites.** Its bash and Python change only where they must: one call from the score path, and the header comment. Its self-test does not change. Everything else is in the new files, and the new script exports its pure functions so a TypeScript `fixture.ts` can import them rather than run the script.
- **Reuse `fixture.sh hidden` for each lane branch.** The new script runs `fixture.sh hidden <ticket> <lane tree>` for each lane and reads its exit code and the counts on the line it prints. There is no second way of running the suite.
- **Nothing the lanes see changes.** No runbook, waybill template, fixture app, fixture ticket or hidden test.
- **Tests beside their target, in `<name>.test.ts` files run by `bun test` (the user's word).** Every new test is in `scripts/fixture-lanes.test.ts`. Nothing new goes into `fixture.sh --self-test`.
- **A functional core, with side effects at the edges (the user's word).** Which lanes a run has, each lane's status and the text for the hidden-tests line are pure functions of what the edges read. Only the edges read files, run `git` or `fixture.sh hidden`, and print. No mutation unless it is truly necessary.
- **Every count needs a control.** A lane that passes (positive), one that fails (negative), one that is missing (absent) and one that fails to build, each read back from what `fixture.sh score` prints.
- **Deterministic work goes in `scripts/`.** Lane discovery, export and reporting are code, not prose for a coachman to re-derive.
- **A run is scored from its records.** Lane names come from the run's own records and the kept lane branches. `score` asks the lanes and the harnesses nothing.

## Structure

- `scripts/fixture-lanes.ts` (new): finds a run's lanes, exports each lane's harvested branch the way `score` exports main, runs `fixture.sh hidden` on each tree, and prints each lane's status. A pure core with the edges outside it; the pure functions are exported.
- `scripts/fixture-lanes.test.ts` (new): unit tests for the pure functions, and the controls, beside their target.
- `scripts/fixture.sh`:
  - The score path runs the new script with the dispatch, the repo and the ticket the waybill carries, and adds what it prints after the merged counts on the hidden-tests line.
  - The header comment says `score` also reports each lane's counts beside the merged result.

## Decisions

1. **What "harvested branch" means.** The tip of `wb/<TICKET>-<lane>`, the branch the coachman keeps as a local archive. The script reads that branch; it does not parse a harvest commit out of the audit's prose. A lane whose branch is gone is the ticket's missing case.
2. **Which lanes are scored.** The lane names in the run's own records (its manifest, audit and waybill), together with the kept `wb/<TICKET>-*` branches. A lane the records name that has no branch is reported missing, and a kept branch no record names is still scored. Neither is dropped silently.
3. **The ticket id in the branch name.** From the waybill's `# Waybill: <TICKET>` line, else the dispatch directory's name.
4. **Report shape.** The lanes go on the hidden-tests line after the merged counts, in name order, e.g. `… on main; one: 5 pass, 0 fail; two: missing`. `score` still prints seven lines: the lane results extend the hidden-tests line and add no check line.
5. **Status words.** A lane for which `fixture.sh hidden` prints counts reports `N pass, M fail`, even when every test fails. A lane with no branch reports `missing`. A lane whose branch cannot be exported, which `fixture.sh hidden` refuses (it has no `package.json`), or for which it prints no counts reports `failed to build`. Those two never show pass counts.
6. **Lane results do not change the verdict.** The ok or FAIL on the hidden-tests line, and the exit code, still judge the merged result alone. The lane counts are measurement beside it.
7. **When the lanes cannot be scored.** If the waybill carries no single fixture ticket, the hidden-tests line fails as it does today and no lane is scored. If the new script itself fails, the line says the lanes were not scored, never a count, and the verdict is unchanged.
8. **A failed-to-build control ships with the three the ticket names.** The ticket names that state, and without a control its "never as a pass" path would go untested.

## Tasks

- [ ] T001 [P] [AC1] Create `scripts/fixture-lanes.ts`: find the run's lanes from its records and kept branches, export each `wb/<TICKET>-<lane>` branch, run `fixture.sh hidden` on it, and print `<lane>: <status>` for each lane in name order.
- [ ] T002 [AC2] In `scripts/fixture-lanes.ts`, report a lane with no branch as `missing`, and one that cannot be exported, is refused by `fixture.sh hidden` or gets no counts from it as `failed to build`, never as pass counts.
- [ ] T003 [AC1] In `scripts/fixture.sh`, have the score path run the new script and add its output after the merged counts on the hidden-tests line, with the verdict unchanged; update the header comment to match.
- [ ] T004 [AC3] Create `scripts/fixture-lanes.test.ts`: unit tests for the pure functions, and controls for a lane branch that passes, one that fails and one that is missing, each run through `fixture.sh score` and read back from the hidden-tests line.
- [ ] T005 [AC2] In `scripts/fixture-lanes.test.ts`, add a control for a lane branch that fails to build, never read as a pass, and one showing the verdict follows the merged result alone.
