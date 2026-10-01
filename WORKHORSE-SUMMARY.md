# Workhorse summary: 179 A workhorse shows every acceptance criterion working, and keeps at it until it can

## Commits

- `d2ca840` Spec template gains Showing each criterion
- `853779d` summary-evidence.ts holds a summary to the evidence shape
- `29e60fe` Workhorse brief is a build-exercise-fix loop with per-criterion evidence
- `dcefca5` summary-evidence reads the worktree's armed ticket first
- (this commit) Workhorse summary: 179

## Checks

`/home/brindlewick/.postmaster/tool-pins/653ba2e8f9b13c985809773f41b04a58bb10532c/scripts/verify.sh run .`
just before this summary:

- `gate [declared] bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && bun test scripts/usage.test.ts && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done && bun test scripts/run-clash.test.ts && bun install --frozen-lockfile && bun test ./scripts ./lint && bun run lint'` — pass, exit 0, 766s

Other commands, with their exits:

- `bun test scripts/summary-evidence.test.ts` — exit 0 (13 pass; the four AC8 cases among them)
- `bun test ./scripts ./lint` — exit 0 (97 pass across 6 files)
- `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts .postmaster/verify/WORKHORSE-SUMMARY-draft.md .` — exit 0
- `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts .postmaster/verify/evidence/broken-omit.md .` (and broken-missing, broken-dots, broken-link, broken-bare) — each exit 2
- `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts .postmaster/verify/evidence/not-shown.md .` — exit 0
- `bash .postmaster/verify/ac1-run-checks.sh .postmaster/verify/ac1-app-patched .postmaster/verify/ac1-patched-transcript.txt` — exit 0 (14 pass)
- `bash .postmaster/verify/ac1-run-checks.sh .postmaster/verify/ac1-app-unpatched .postmaster/verify/ac1-unpatched-transcript.txt` — exit 1 (5 pass, 9 fail; the five are criterion 4's cases, already there)
- `bun --no-env-file --config=/dev/null scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .` — exit 0 (the harvest command, on this summary; transcript below)

## Evidence

1. `.postmaster/verify/ac1-showing-each-criterion.md`, `.postmaster/verify/ac1-patched-transcript.txt`, `.postmaster/verify/ac1-unpatched-transcript.txt`, `.postmaster/verify/ac1-already-there.md`
2. `.postmaster/verify/evidence/ac2-ac3-clauses.txt`
3. `.postmaster/verify/evidence/ac2-ac3-clauses.txt`
4. `.postmaster/verify/evidence/ac4-final.txt`
5. `.postmaster/verify/evidence/ac5-final.txt`
6. `.postmaster/verify/evidence/ac6-breaks.txt`
7. `.postmaster/verify/evidence/ac7-not-shown.txt`
8. `.postmaster/verify/evidence/ac8-tests.txt`

## Decisions

1. **Evidence section shape.** `## Evidence` is a numbered list matching the ticket's
   criteria: one or more worktree-relative paths under `.postmaster/verify/`, or
   `not shown: <reason>`. Paths may be in backticks. A bare word is not a path.
2. **Criteria reading.** `summary-evidence.ts` reads the ticket's `## Acceptance criteria` the
   way `ticket-check.sh` does — numbered 1, 2, 3, continuation lines belonging to the item
   above — and matches by number. The expected criteria come from the ticket, never from the
   summary.
3. **Default ticket path.** The armed copy at `<worktree>/.postmaster/verify/ticket.md` first,
   as Decision 1 of the shared spec says; `$POSTMASTER_VERIFY/ticket.md` is only a fallback.
   That keeps the tests independent of whatever the surrounding gate exported.
4. **Path containment.** A cited path counts as under `.postmaster/verify/` only once `..` and
   symlinks are resolved. Both escapes (`../` and a symlink pointing out) are refused with
   `outside .postmaster/verify`.
5. **Standalone script.** No `verify.sh` change. The coachman runs
   `bun --no-env-file --config=/dev/null <tool>/scripts/summary-evidence.ts …` beside
   `verify.sh summary`.
6. **AC1 criterion 4 on the unpatched copy.** Its five cases already print usage and exit 2
   because `remove` is not a known command and the switch default already does that. Named in
   `.postmaster/verify/ac1-already-there.md`; the check cannot tell "remove rejected a bad id"
   from "remove is not implemented".
7. **No scripts/lib/ copy from #109.** The new script imports only `node:fs` and `node:path`.
   Decision 9 of the shared spec says that means nothing is copied from the port.

## What I did not do

- **A fixture run scoring clean.** The landing condition for this coachman-contract change.
  This branch does not claim that run; the AC2 row of the shared spec names what the postmaster
  reads when it scores one.
- **The browser path of criterion 3, and real use of criterion 7.** This repository has no web
  fixture. The clauses are contract on this branch; they are walked on the first web-target run.
- **A score line in `fixture.sh` for the evidence.** Left to a ticket of its own (shared-spec
  Decision 11).
- **Any change to `scripts/verify.sh`, the blind acceptance tests, the fixture scripts, or who
  drafts the spec.** Out of this ticket's Structure.

## Verdict

- **AC1 — met.** The template gains `## Showing each criterion` before `## Tasks`. The filled
  table for the fixture `remove` ticket has eight rows, each with a check that runs as written.
  Every check passes on the patched copy; on the unpatched copy nine fail and five pass, the
  five being criterion 4's cases already there (named).
- **AC2 — met on this branch.** The workhorse contract and Stage 0 brief clauses give the
  loop: build, run each criterion's check as the spec specifies it, fix, rerun, until every
  check shows its criterion working and the run's checks pass; add checks, never drop or weaken
  the spec's; a stuck workhorse stops and says what blocks it (Decision 10); the evidence comes
  from the last pass, on the final code; `verify.sh run .` just before the summary stays the
  last step. The landing-run half waits for that run.
- **AC3 — met as contract.** The browser clauses require every surface-touching criterion to be
  checked in a real browser through the project's own library from a shell command, screenshot
  per step, with or without a ticket `User journey`; where the ticket has none, the spec's steps
  are the journey. Real-use demonstration waits for the first web-target run.
- **AC4 — met.** The harvest command, run on this lane's own summary, exits 0 and the
  transcript keeps the command, its output and its exit.
- **AC5 — met.** `## Evidence` has an entry for each of the eight criteria: transcripts under
  `.postmaster/verify/`. `git check-ignore` prints every cited path.
- **AC6 — met.** Each broken copy exits 2 and names the criterion and what is wrong with it.
  The harvest clauses run the script beside `verify.sh summary`, put each lane's result on the
  checkpoint 1 card, and count a criterion claimed as shown without evidence against that lane.
- **AC7 — met as contract.** A `not shown: <reason>` entry holds. The clause tells a workhorse
  whose harness has no browser backend to mark its browser evidence `not shown` with that
  reason, and names no harness; the render gate is unchanged. Real use waits for a web target.
- **AC8 — met.** Four cases pass in `bun test scripts/summary-evidence.test.ts`: evidence for
  every criterion; a criterion missing evidence; evidence that does not exist; a `not shown`
  line.
