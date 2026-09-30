# Workhorse spec: 179 A workhorse shows each acceptance criterion working before it stops

## Summary

A workhorse currently runs the run's checks once and reports what they printed, without being
required to use what it built or to keep working until each acceptance criterion is shown
working. This change makes the workhorse brief a build–exercise–fix loop driven by a new spec
section that says how each criterion will be shown, puts the evidence for each criterion under
the worktree's `.postmaster/verify/`, and adds a TypeScript script that holds
`WORKHORSE-SUMMARY.md` to that shape so the coachman can read the evidence when it judges the
lanes.

## Technical context

- **Language and version**: TypeScript, run by Bun (the project's existing script style:
  `scripts/run-clash.ts`, `scripts/synthesis-shares.ts`). Shell/markdown only where the existing
  runbooks already are.
- **Dependencies used or added**: none. `node:fs`, `node:path` and `bun:test` only.
- **Testing**: `bun test scripts/summary-evidence.test.ts` for the four summary shapes; the
  project's gate (`bash -c '…'` as the waybill names it) for the rest. The fixture path of
  criterion 4 is exercised by a fixture run, which is the landing condition, not a test this
  branch runs.
- **Constraints**: blind acceptance tests stay hidden from lanes; new scripts are TypeScript run
  by Bun with tests beside them in `<name>.test.ts`, in a functional style; never push; one
  change on this branch; the workhorse contract and spec template are what change, so the
  branch lands only after a fixture run scores clean (ticket notes).

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Blind acceptance tests stay hidden from the lanes; a lane shows its criteria by its own means | Nothing in the brief, template or new script names or hands out the coachman's blind tests. Evidence is the lane's own transcripts and walks. |
| New script is TypeScript run by Bun, tests beside it in `<name>.test.ts`, functional style | `scripts/summary-evidence.ts` is a pure-core-plus-IO script in the `run-clash.ts` shape; `scripts/summary-evidence.test.ts` sits beside it. No new shell script and no new Python in `verify.sh`. |
| A prompt lives in argv; deterministic work goes in `scripts/` | The summary-shape rule is a script, not prose the coachman re-derives. The brief text remains in `coachman.md`, where the other brief clauses live. |
| Never push; work only inside this worktree | All edits under `/home/brindlewick/postmaster/.worktrees/179-mimo`. |
| The workhorse contract change lands after a fixture run scores clean | Recorded as the landing condition in the ticket notes and in `WORKHORSE-SUMMARY.md`'s "what I did not do"; this branch does not claim that run. |
| Fixture is a command-line app (criterion 4 path); criterion 3 has no web fixture | Design keeps CLI transcripts and browser walks as separate evidence kinds; no web fixture is invented here. |
| Related #170: while the coachman writes the one spec, criterion 1's section is the coachman's to fill | The section is added to the shared template whoever fills the spec uses; this ticket does not change who drafts the spec. |

## Structure

| Path | Change |
|---|---|
| `skills/postmaster/workhorse-spec-template.md` | Add a `## Showing each criterion` section to the template block: per acceptance criterion, the command, input and expected output, or the user-surface steps and what each should show. |
| `skills/postmaster/coachman.md` | The workhorse contract and the brief the coachman writes: implementation is a loop (build, exercise each criterion as the spec says, fix what fails, exercise again, until every criterion is shown working and every check passes; a genuinely stuck workhorse stops and says what blocks it); `verify.sh run .` just before the summary stays the last step. Browser evidence for every criterion that touches a user surface, in a real browser through the project's own browser library from a shell command in the worktree, one screenshot per step; where the ticket has no `User journey`, the workhorse writes the one it walked into its summary. CLI evidence is a kept transcript of each new or changed command on realistic input: command, output, exit. `WORKHORSE-SUMMARY.md` gives, per criterion, evidence under `.postmaster/verify/` or a `not shown` line with the reason. A harness with no browser backend marks the browser evidence `not shown` with that reason. Harvest holds each summary to the shape with the new script, reads the evidence, and a criterion claimed as shown without evidence counts against that lane. |
| `scripts/summary-evidence.ts` | New. Holds a `WORKHORSE-SUMMARY.md` to the evidence shape against the ticket's acceptance criteria and the worktree's `.postmaster/verify/`. |
| `scripts/summary-evidence.test.ts` | New. The four cases in acceptance criterion 8, through `bun scripts/summary-evidence.ts`. |

No change to `scripts/verify.sh`, the blind acceptance tests, the fixture scripts, or who drafts
the spec.

## Complexity tracking

None.

## Decisions

1. **Evidence section name and shape.** `WORKHORSE-SUMMARY.md` gains `## Evidence`, one entry
   per acceptance criterion, numbered as the ticket numbers them. An entry is either one or more
   worktree-relative paths under `.postmaster/verify/`, or the line `not shown: <reason>`. That
   is the shape the script parses; the rest of the summary stays as today.
2. **Where evidence lives.** Only under `<worktree>/.postmaster/verify/`, which `verify.sh arm`
   already tells git to ignore and the coachman already copies into the run's audit. A path
   outside that tree is a fail, so a summary cannot point at something the coachman will not
   find or that would dirty the worktree.
3. **Script name and interface.** `bun scripts/summary-evidence.ts <summary.md> <worktree>
   [--ticket <file>]`. The ticket defaults to the copy `verify.sh arm` puts at
   `.postmaster/verify/ticket.md` (or a waybill, read from `## Ticket` to `## Project profile`,
   as `verify-examples.sh` already does). Exit 0 holds; 1 usage or unreadable input; 2 a
   criterion is missing, cites evidence that does not exist or is outside `.postmaster/verify/`,
   or is claimed shown with no evidence. `not shown: <reason>` is valid and does not fail the
   shape.
4. **Who fills the new spec section.** Whoever drafts the workhorse spec — the workhorse today,
   the coachman if #170 holds — fills `## Showing each criterion`. The template is the only
   artifact this ticket changes for that criterion.
5. **Browser evidence without a ticket journey.** The walk is still per criterion that touches
   the surface. The workhorse writes the journey it walked into the summary's evidence (and
   keeps the report and screenshots under `.postmaster/verify/`); it does not invent a ticket
   `User journey` section. The existing `verify-journey.sh` check remains what holds a ticket
   that does carry a `User journey`.
6. **No browser backend.** The brief tells the workhorse when its harness has none (the
   coachman knows the harness from the waybill; `harnesses.md` already records that headless
   codex exposes no browser backend). The summary marks those criteria `not shown: <reason>`;
   the coachman's render gate covers the surface, as today.
7. **"Counts against that lane."** The script's exit 2 is the count: the coachman runs it at
   harvest beside `verify.sh summary`, names each problem on the checkpoint 1 card, and treats
   a criterion claimed as shown without evidence the way it already treats a check claim its
   run contradicts. No new scoring system.
8. **The loop's last step is unchanged.** The brief still requires
   `<tool>/scripts/verify.sh run .` just before the summary. The loop's own passes are what the
   workhorse uses to finish; that final run is what the summary's `## Checks` quotes.
9. **Spec section heading.** `## Showing each criterion`, placed before `## Tasks`, so a task
   can name how it will be shown without the template inventing a second planning document.

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Add `## Showing each criterion` to the template block in `skills/postmaster/workhorse-spec-template.md`, and the one-line note beside the block on what it is for.
- [ ] T002 [AC2] In `skills/postmaster/coachman.md`, rewrite the workhorse contract and Stage 0's brief clauses so implementation is a loop — build, exercise each criterion as the spec says, fix what fails, exercise again, until every criterion is shown working and every check passes; a workhorse that is genuinely stuck stops and says what blocks it — with `verify.sh run .` just before the summary still the last step.
- [ ] T003 [P] [AC3] In `skills/postmaster/coachman.md`, require on a project with a user surface that every criterion touching the surface is exercised in a real browser through the project's own browser library from a shell command in the worktree, with a screenshot per step, whether or not the ticket has a `User journey`, and that the workhorse write the journey it walked into its summary where the ticket has none.
- [ ] T004 [P] [AC4] In `skills/postmaster/coachman.md`, require for a command-line tool or scripts that each new or changed command is run the way it will be run, on realistic input, and the transcript kept: the command, its output and its exit.
- [ ] T005 [AC2, AC5] In `skills/postmaster/coachman.md`, define `WORKHORSE-SUMMARY.md`'s `## Evidence` section: per acceptance criterion, the transcripts or the journey report and its screenshots under the worktree's `.postmaster/verify/`, or a `not shown` line with the reason; and that the coachman read each lane's evidence when it judges the lanes.
- [ ] T006 [P] [AC6, AC7] Write `scripts/summary-evidence.ts` (TypeScript, Bun, functional core) holding a summary to that shape: every criterion has evidence that exists under `.postmaster/verify/` or a `not shown` line; a criterion claimed as shown without evidence is a problem the coachman counts against the lane.
- [ ] T007 [P] [AC8] Write `scripts/summary-evidence.test.ts` beside it covering: a summary with evidence for every criterion; one missing a criterion's evidence; one with evidence that does not exist; one with a `not shown` line.
- [ ] T008 [AC6, AC7] In `skills/postmaster/coachman.md`'s harvest and verify steps, run `bun <tool>/scripts/summary-evidence.ts` beside `verify.sh summary`, copy each lane's `.postmaster/verify/` as today, and name on the checkpoint 1 card any criterion claimed as shown without evidence; record the no-browser-backend `not shown` as the brief already records a degraded browser.
