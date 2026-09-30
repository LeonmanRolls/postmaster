# Workhorse spec: #179, A workhorse shows every acceptance criterion working, and keeps at it until it can

_Shared spec written by the coachman from the two lane specs, per the user's word in planning round 1. Identical in both lanes' worktrees. Both lanes implement from this same file, in blinkers as before._

## Summary

The workhorse brief becomes a build–exercise–fix loop driven by per-criterion checks the spec specifies: each lane runs every criterion's check the way the criterion will really be used, keeps the evidence under its worktree's `.postmaster/verify/`, and a new TypeScript script holds `WORKHORSE-SUMMARY.md` to that shape so the coachman reads the evidence when it judges the lanes.

## Technical context

- **Language and version**: TypeScript run by Bun for the new evidence script (the repo's existing script style: `scripts/run-clash.ts`, `scripts/synthesis-shares.ts`); markdown only where the runbooks and template already are.
- **Dependencies used or added**: none. `node:fs`, `node:path` and `bun:test` only.
- **Testing**: `bun test scripts/summary-evidence.test.ts` for the four summary shapes in AC8; the waybill's gate for the rest. A fixture run scoring clean is the landing condition for this coachman-contract change, not a test this branch runs: the fixture is a command-line app, so it exercises the AC4 path, and AC3's browser path has no web fixture.
- **Constraints**: the blind acceptance tests stay hidden from the lanes; a lane shows its criteria by its own means. Evidence lives only under `.postmaster/verify/`, which the root `.gitignore` ignores through its `.postmaster/` rule. Browser work goes through the target project's own browser library from a shell command in the lane's worktree, never a shared browser server. No web fixture is invented here. No harness-specific wording enters the flow: the brief's no-backend clause is generic, and the coachman fills it from the waybill and `harnesses.md`.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| The user: lanes should verify their own work and iterate until they can check the feature is implemented | The brief is a loop: build, run each criterion's check as the spec specifies it, fix what fails, run it again, until every check shows its criterion working and the run's checks pass. |
| The user: the spec specifies how the lane checks its work; the checks are approved at spec review | The template gains `## Showing each criterion`, filled per run (by the coachman while #170 holds) and reviewed with the rest of the spec. A lane may add checks of its own, never drop or weaken one the spec specifies. |
| Blind acceptance tests stay hidden; a lane shows its criteria by its own means | Nothing in the brief, template or new script names or hands out the coachman's blind tests. Evidence is the lane's own transcripts and walks. |
| New script is TypeScript run by Bun, tests beside it in `<name>.test.ts`, functional style | `scripts/summary-evidence.ts` is a pure-core-plus-IO script in the `run-clash.ts` shape; `scripts/summary-evidence.test.ts` sits beside it. |
| Deterministic work goes in `scripts/`, not in prose | The summary-shape rule is a script the coachman runs at harvest, not a judgement re-derived from prose. |
| Coachman-contract change lands after a fixture run scores clean | Landing condition, recorded in the summary's "what I did not do"; this branch does not claim that run. |
| Fixture is CLI (AC4 path); AC3 has no web fixture | CLI transcripts and browser walks are separate evidence kinds; the browser clauses are contract on this branch, walked on the first web-target run. |
| #170: the coachman writes the one spec, so the checks are the coachman's to specify | This shared spec is the first to carry the checks section; the template is the artifact, whoever fills it. |

## Structure

| Path | Change |
|---|---|
| `skills/postmaster/workhorse-spec-template.md` | Add `## Showing each criterion` to the template block, before `## Tasks`: per acceptance criterion, the check that shows it working as it will really be used — the command, the input and the expected output, or the user-surface steps and what each should show. |
| `skills/postmaster/coachman.md` | Workhorse contract and Stage 0 brief clauses: the loop (build, run each criterion's check as the spec specifies it, fix, rerun, until every check shows its criterion working and the run's checks pass; lanes may add checks, never drop or weaken the spec's; a genuinely stuck workhorse stops and says what blocks it); `verify.sh run .` just before the summary stays the last step. Browser clauses: every surface-touching criterion checked in a real browser through the project's own library from a shell command, screenshot per step, whether or not the ticket has a `User journey`; where it has none, the spec's steps are the journey. CLI clauses: each new or changed command run as it will be run on realistic input, transcript kept (command, output, exit). Summary `## Evidence`: per criterion, transcripts or journey report plus screenshots under `.postmaster/verify/`, or `not shown: <reason>`; a harness with no browser backend marks the browser evidence `not shown` with that reason. Harvest: run the new script beside `verify.sh summary`, read the evidence, name problems on the checkpoint 1 card; a criterion claimed as shown without evidence counts against the lane. |
| `scripts/summary-evidence.ts` | New. Holds a `WORKHORSE-SUMMARY.md` to the evidence shape against the ticket's acceptance criteria and the worktree's `.postmaster/verify/`. |
| `scripts/summary-evidence.test.ts` | New. The four cases in AC8, through `bun scripts/summary-evidence.ts`. |

No change to `scripts/verify.sh`, the blind acceptance tests, the fixture scripts, or who drafts the spec. No planning-stage change: the checks ship inside the spec the user already reviews.

## Complexity tracking

None.

## Decisions

1. **Script name and interface.** `bun scripts/summary-evidence.ts <summary.md> <worktree> [--ticket <file>]`. Criteria are the numbered items under `## Acceptance criteria` in the ticket, matched by number so wording drift does not matter; the ticket defaults to the armed copy at `<worktree>/.postmaster/verify/ticket.md`, and `--ticket` accepts that shape or a waybill read from `## Ticket` to `## Project profile` (the `verify-examples.sh` precedent). Exit 0 holds; 1 usage or unreadable input; 2 a criterion is missing from the evidence section, cites evidence that does not exist or lies outside `.postmaster/verify/`, or is claimed shown with no evidence. `not shown: <reason>` is valid and does not fail the shape. The expected criteria come from the ticket, never inferred from the summary.
2. **Evidence section shape.** `WORKHORSE-SUMMARY.md` gains `## Evidence`, one entry per acceptance criterion numbered as the ticket numbers them: one or more worktree-relative paths under `.postmaster/verify/`, or the line `not shown: <reason>`. The rest of the summary stays as today.
3. **Standalone script; no `verify.sh` change.** One lane spec wired the validator into `verify.sh summary`; this spec keeps it a separate script the coachman runs at harvest beside `verify.sh summary`. The ticket asks for "a script", the harvest step runs every run either way, and `verify.sh`'s contract and self-tests stay untouched.
4. **The spec's checks bind the lanes.** Each criterion's check is run as specified; a lane may add checks of its own, never drop or weaken one the spec specifies. Where the ticket has no `User journey`, the spec's steps for a surface-touching criterion are the journey the lane walks and reports.
5. **No browser backend.** The brief tells the workhorse when its harness has none — the coachman knows the harness from the waybill and the backends from `harnesses.md`, so the clause names no harness. The summary marks those criteria `not shown: <reason>`; the coachman's render gate covers the surface, as today.
6. **"Counts against that lane."** The script's exit 2 output is the count: the coachman names each problem on the checkpoint 1 card and treats a criterion claimed as shown without evidence the way it already treats a check claim its run contradicts. No new scoring system.
7. **The loop's last step is unchanged.** The brief still requires `<tool>/scripts/verify.sh run .` just before the summary. The loop's own passes are what the workhorse uses to finish; that final run is what the summary's `## Checks` quotes.
8. **Template section heading and place.** `## Showing each criterion`, before `## Tasks`, so a task can name how it will be shown without a second planning document.

## Showing each criterion

_This section is the new template section, filled for this ticket: each criterion's check — the command, the input and the expected output. The user approves these checks with the rest of the spec._

| # | Check (command and input) | Expected output |
|---|---|---|
| AC1 | Read the section: `grep -n 'Showing each criterion' skills/postmaster/workhorse-spec-template.md`, then read that section against this ticket's 8 criteria. | The heading is present before `## Tasks`, and the section asks for, per criterion, the command, the input and the expected output, or the user-surface steps and what each should show. |
| AC2 | Read the workhorse contract and Stage 0's brief clauses in `skills/postmaster/coachman.md`. | The brief runs build, each criterion's check as the spec specifies it, fix, rerun, until every check shows its criterion working and the run's checks pass; lanes may add checks, never drop or weaken the spec's; a stuck lane stops and says what blocks it; `verify.sh run .` just before the summary stays the last step. The loop itself is exercised end to end by the landing fixture run, not on this branch. |
| AC3 | Read the browser clauses in `skills/postmaster/coachman.md` for a surface-touching criterion. | Every surface-touching criterion is checked in a real browser through the project's own library from a shell command, screenshot per step, with or without a ticket `User journey`; where the ticket has none, the spec's steps are the journey. Real-use demonstration waits for the first web-target run: this repo has no web fixture. |
| AC4 | Run the new command as it will be run: `bun scripts/summary-evidence.ts <summary> <worktree>` over realistic inputs (the AC8 fixture summaries), keeping each transcript (command, output, exit) under `.postmaster/verify/`. | Each transcript shows the command, its output and its exit; exit 0 where the evidence holds, 2 where a criterion has none. |
| AC5 | Write a sample `WORKHORSE-SUMMARY.md` with `## Evidence` entries pointing under `.postmaster/verify/`; run `git check-ignore` on the evidence paths and the AC6 script over the sample. | Every criterion names transcripts or a journey report plus screenshots that exist, or a `not shown: <reason>` line; the paths are git-ignored and the script holds. |
| AC6 | Run `bun scripts/summary-evidence.ts` over a summary missing a criterion's evidence and one citing a nonexistent path; read the harvest clauses in `skills/postmaster/coachman.md`. | Both runs exit 2 naming the problem; the runbook runs the script beside `verify.sh summary`, reads the evidence, and counts a shown-without-evidence claim against the lane on the checkpoint 1 card. |
| AC7 | Run the script over a sample whose browser criteria read `not shown: <reason>`; read the brief's no-backend clause and the render-gate hard rule. | The script exits 0; the brief tells the workhorse when its harness has none without naming harnesses; the render gate is unchanged. |
| AC8 | `bun test scripts/summary-evidence.test.ts`. | Four cases pass: evidence for every criterion; a criterion missing evidence; evidence that does not exist; a `not shown` line. |

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Add `## Showing each criterion` to the template block in `skills/postmaster/workhorse-spec-template.md`, before `## Tasks`, with the one-line note beside the block on what it is for.
- [ ] T002 [AC2] In `skills/postmaster/coachman.md`, rewrite the workhorse contract and Stage 0's brief clauses so implementation is a loop — build, run each criterion's check as the spec specifies it, fix what fails, run it again, until every check shows its criterion working and the run's checks pass; a lane may add checks of its own, never drop or weaken one the spec specifies; a workhorse that is genuinely stuck stops and says what blocks it — with `verify.sh run .` just before the summary still the last step.
- [ ] T003 [P] [AC3] In `skills/postmaster/coachman.md`, require on a project with a user surface that every criterion touching the surface is checked in a real browser through the project's own browser library from a shell command in the worktree, with a screenshot per step, whether or not the ticket has a `User journey`, and that where the ticket has none the spec's steps are the journey.
- [ ] T004 [P] [AC4] In `skills/postmaster/coachman.md`, require for a command-line tool or scripts that each new or changed command is run the way it will be run, on realistic input, and the transcript kept: the command, its output and its exit.
- [ ] T005 [AC2, AC5] In `skills/postmaster/coachman.md`, define `WORKHORSE-SUMMARY.md`'s `## Evidence` section: per acceptance criterion, the transcripts or the journey report and its screenshots under the worktree's `.postmaster/verify/`, or a `not shown` line with the reason; and that the coachman read each lane's evidence when it judges the lanes.
- [ ] T006 [P] [AC6, AC7] Write `scripts/summary-evidence.ts` (TypeScript, Bun, functional core) holding a summary to that shape: every criterion has evidence that exists under `.postmaster/verify/` or a `not shown` line; a criterion claimed as shown without evidence is a problem the coachman counts against the lane.
- [ ] T007 [P] [AC8] Write `scripts/summary-evidence.test.ts` beside it covering: a summary with evidence for every criterion; one missing a criterion's evidence; one with evidence that does not exist; one with a `not shown` line.
- [ ] T008 [AC6, AC7] In `skills/postmaster/coachman.md`'s harvest and verify steps, run `bun <tool>/scripts/summary-evidence.ts` beside `verify.sh summary`, and name on the checkpoint 1 card any criterion claimed as shown without evidence; keep the no-browser-backend `not shown` and the render gate as the brief and hard rules have them.
