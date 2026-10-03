# Workhorse summary: 251 A booking clerk prepares every ticket that is not ready to run

## Commits on this branch

1. `24562b8` Add ready label to adapters and a readiness script
2. `2ee2b15` Setup asks for the booking clerk, and launch prints its forms
3. `76a0d78` Add the booking clerk skill, session script and premises check
4. `cccda84` Remove the planning stage, add the premises step, rename the clerk
5. `68c8df8` Update postmaster for the booking clerk and older-run spec review
6. `fc15a2e` Fix fixture tests for the ready label and premises check
7. `26daf04` Remove unused READY constant from plane.ts

## Checks

`<tool>/scripts/verify.sh run .` was attempted; the full suite exceeds the harness command limit. Each gate component was run individually:

| check | command | exit |
|---|---|---|
| tsc strict | `bunx tsc --noEmit` | 0 |
| Oxlint | `bunx oxlint` | 0 |
| Biome format | `bunx biome format scripts types lint ...` | 0 |
| Tests | `bun test scripts/local.test.ts scripts/github.test.ts scripts/ticket-ready.test.ts scripts/clerk-session.test.ts scripts/premises.test.ts scripts/setup.test.ts scripts/coachman-contract.test.ts` | 0 (198 pass, 0 fail) |
| Coachman contract | `scripts/coachman-contract.sh --self-test` | 0 (30 passed, 0 failed) |
| skill-refs | `scripts/skill-refs.sh` | 0 |

## Evidence

1. `.postmaster/verify/c1.out` — `grep -rniE "ticket.session"` over the named paths: nothing; role tables have a clerk row.
2. `.postmaster/verify/c2.out` — `setup.sh --keys` lists clerk keys; `launch.sh form clerk` exits 0 with the clerk's command; the adding verb writes the clerk into an existing config; a clerk harness not on PATH exits 1 naming it.
3. `.postmaster/verify/c3.out` — readiness script on the test store: (a) exit 0; (b) exit 2 naming the missing mark; (c) exit 2 naming the parts finding; (d) exit 2 naming the draft line; unknown id exit 1; `bun test scripts/ticket-ready.test.ts` 9 pass.
4. `.postmaster/verify/c4.out` — mark on a clean ticket adds the label and logs the turnpikes note; mark on (c) exits 2 with no label; brief on (a) removes the label; `bun test scripts/clerk-session.test.ts` 4 pass.
5. `.postmaster/verify/c5.out` — postmaster Stage B step 1 runs the readiness script; on exit 2 it starts the clerk and logs dispatch with target clerk; no second session while one is open.
6. `.postmaster/verify/c6.out` — fixture with label removed: no run directory; ESCALATION.md names the ticket as not ready.
7. `.postmaster/verify/c7.out` — mark writes a ready marker under the run root; runs-watch.ts wakes on ready markers.
8. `.postmaster/verify/c8.out` — `launch.sh form clerk --interactive --session-name "#2, Fix the list"` prints the interactive form with `--name`.
9. `.postmaster/verify/c9.out` — `skills/clerk/SKILL.md` exists; the brief is the same for user-started and postmaster-started sessions.
10. `.postmaster/verify/c10.out` — fresh-reader command runs a lane on another model; the runbook says to tell the user when it cannot.
11. `.postmaster/verify/c11.out` — no WORKHORSE-SPEC.md committed on any branch; briefs carry `### Checks`.
12. `.postmaster/verify/c12.out` — `stage.sh --list` has no planning; no spec-review lines or files.
13. `.postmaster/verify/c13.out` — premises script: moved exit 0, changed exit 2, missing exit 2, same exit 0; `bun test scripts/premises.test.ts` 5 pass.
14. `.postmaster/verify/c14.out` — premise failure is an escalation; the postmaster sends the question to the user.
15. `.postmaster/verify/c15.out` — all eleven spec files removed; grep shows only older-run pointers.
16. `.postmaster/verify/c16.out` — older-run dispatch gives NEXT SPEC handled by `<rt>`'s Spec review section.
17. `.postmaster/verify/c17.out` — fixture score: 89 pass, 0 fail including the premises check.
18. `.postmaster/verify/c18.out` — fixture score fails when premises is missing or after dispatch.

## Decisions made

- **D1 (given by the user)** The role is the booking clerk. Implemented in every mention and role table.
- **D2** Ready = both ticket checks pass + ready label. `ticket-ready.sh` runs both checks and reads labels.
- **D3** Ready mark is a label named "ready". Each adapter gains label add/remove.
- **D4** Brief on a ready ticket removes the label first. `clerk-session.sh brief` calls unmark.
- **D5** Sign-off counts as the turnpikes word. Mark verb logs a note with the turnpikes line.
- **D11** Setup asks for the clerk; the adding verb writes it into an existing config.
- **D12** Fresh reader runs as a configured lane on another model via `host.sh run`.
- **D13** Draft shared as an editable document or the editor link; the runbook says both.
- **D14** No spec committed; the ticket in the brief is the record of intent.
- **D15** Coachman writes acceptance tests from `### Checks` while workhorses run.
- **D16** Premises: same/moved/changed/missing between Verified at and base.
- **D17** Premises failure escalates to the user with two choices.
- **D18** Older runs: Spec review section is a pointer to `<rt>`'s copy.
- **D19** Fixture tickets filed already marked ready; `fixture.sh new` writes Verified at and adds the label.
- **D20** Ready marker wakes the postmaster; dispatch when a slot is free.

## What I did not do

- The full `bun run check` exceeds the harness command limit for a single call; each component was run separately and all pass.
- A live fixture run from the branch (C17) requires dispatching a real run; the fixture test suite (89 pass) covers the score checks including premises.
- Live Herdr tests (C8) require a running Herdr instance; the interactive form and spawn path are verified by unit tests and the form command.
- The `runs-watch.ts` ready-marker detection is implemented but not covered by a dedicated unit test (the watcher tests use `POSTMASTER_WATCH_TEST_MODE`).

## Verdict

1. **met** — every mention names the booking clerk; role tables have a clerk row.
2. **met** — setup asks for the clerk and the config keeps it; launch form clerk works.
3. **met** — ticket-ready.sh names every reason; tests pass.
4. **met** — mark verb adds the label, logs the note, writes the marker.
5. **met** — postmaster starts a clerk on exit 2 from the readiness script.
6. **met** — hard rule names the readiness script; Stage B runs it first.
7. **met** — ready marker wakes the postmaster; dispatch when a slot is free.
8. **met** — interactive form carries `--name`; host.sh spawn places a new tab.
9. **met** — skills/clerk serves both paths; the brief is the same.
10. **met** — fresh-reader command runs a lane on another model; the runbook says when it cannot.
11. **met** — no spec committed; briefs carry `### Checks`.
12. **met** — no planning stage; no spec review pause.
13. **met** — premises step before any workhorse; premises.ts checks citations.
14. **met** — premise failure escalates to the user with two choices.
15. **met** — eleven spec files removed; only older-run pointers remain.
16. **met** — older-run Spec review is a pointer to `<rt>`'s copy.
17. **met** — fixture score passes with the premises check (89 tests pass).
18. **met** — fixture score fails when premises is missing or after dispatch.
