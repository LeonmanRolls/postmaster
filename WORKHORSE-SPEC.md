# Workhorse spec: 182 Fixture runs at minimum effort

## Summary

A fixture run must launch every agent at its harness's lowest effort, and a ticket run must keep
today's levels, with the bug lens no longer forcing a fixed top level. This workhorse leaves a
fixture fact in the copy `fixture.sh new` makes, has `run-meta.sh` record lowered efforts from
one table when that fact is present, has `launch.sh review` take its effort from the run's
record, and makes the waybill name those efforts. The scripts this ticket changes are taken
from the #109 TypeScript port first (copy commit), then changed in TypeScript.

## Technical context

- **Language and version**: TypeScript run by Bun (the user's word, 2026-09-30), shell wrappers
  of the #109 port shape (`exec bun --no-env-file --config=…/bunfig.toml …/<name>.ts "$@"`).
- **Dependencies used or added**: none beyond what the port already imports (`scripts/lib/*`,
  `bunfig.toml`). No new packages.
- **Testing**:
  - `bun test scripts/fixture.test.ts` (and `scripts/fixture.sh --self-test`): the fact is left
    in the copy; score still runs.
  - `bun test scripts/run-meta.test.ts` (and `scripts/run-meta.sh --self-test`): a fixture
    target records every lane and role at the table's lowest effort, warns and keeps an unknown
    harness, never edits `~/.postmaster/config.toml`; a non-fixture target records as today.
  - `bun test scripts/launch.test.ts` (and `scripts/launch.sh --self-test`): `review` uses the
    recorded lane effort; ticket-recorded top level still launches as today.
  - Fixture-score control (in `scripts/fixture.test.ts` / `scripts/fixture.sh --self-test`):
    the waybill names the efforts `run.json` recorded.
  - AC5 controls, through the identical launch commands: fixture run → workhorse, coachman leg,
    resume and bug-lens review at the lowest level; ticket run → each at the configured level.
  - Gate: the waybill's `bash -c '…'` stand-in, from the worktree root.
- **Constraints**:
  - Fixture runs only change; ticket runs keep their top level for reviews and their configured
    effort for launches.
  - Lowest table: codex `none`, claude `low`, muse `minimal`, MiMo `low`. A harness with no
    entry keeps its effort, with a warning.
  - The machine config file is never changed. A ticket run records the config as today.
  - Never infer fixture from repository name or path.
  - Scripts this ticket writes or changes are TypeScript with `<name>.test.ts` beside them, in a
    functional style; the port's files are copied unchanged first, then changed in TypeScript.
  - Work in this worktree only; never push; one change per commit as work completes.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| "fixture runs should be at minimum effort" (2026-09-30) | `run-meta.sh` rewrites the recorded config's efforts to the lowest table when the fixture fact is present, so every `--run` launch and resume follows it. |
| Lowest levels tried 2026-09-30: codex `none`, claude `low`, muse `minimal`, MiMo `low` | Exactly the one table `run-meta.sh` records from. |
| Only fixture runs change | Ticket path records the effective machine config unchanged; only the fixture path rewrites efforts. |
| Ticket runs keep their top level (reviews) | `launch.sh review` uses the run-recorded lane effort; for a ticket run that recorded effort is the harness top level, so the bug lens is unchanged. |
| No repo-specific hardcoding | The fixture fact is a file the copy carries; detection never looks at name or path. |
| Deterministic work in scripts | The table, the fact check, the record rewrite and the review effort are all in `scripts/` (`run-meta.ts`, `launch.ts`, `fixture.ts`), with controls in their tests. |
| TypeScript for scripts this ticket changes | Copy `fixture.ts` / `run-meta.ts` / `launch.ts` and friends from the port commit first; ticket edits land in the TypeScript. |
| A prompt lives in argv / process matching rules | No change to how processes are selected or matched. |
| Every count needs a control | AC5 is a control matrix in `launch.test.ts` and `run-meta.test.ts`, same commands for fixture and ticket records. |
| A change to the coachman contract merges only after a fixture run scores clean | Noted for landing; this branch does not merge itself. |
| Launch forms stay as `harnesses.md` records them | Review forms and bypass flags are untouched; only the effort argument changes source. |

## Structure

### Copied unchanged from commit `87038b9222ccb2a3e22706a9110a7923a319d1fd` (#109 port)

One commit that is the copy alone:

| Path | Role |
|---|---|
| `scripts/fixture.sh` | wrapper (replaces the shell implementation) |
| `scripts/fixture.ts` | fixture implementation |
| `scripts/fixture.test.ts` | tests beside it |
| `scripts/run-meta.sh` | wrapper |
| `scripts/run-meta.ts` | run record / pin implementation |
| `scripts/run-meta.test.ts` | tests beside it |
| `scripts/launch.sh` | wrapper |
| `scripts/launch.ts` | launch / review implementation |
| `scripts/launch.test.ts` | tests beside it |
| `scripts/lib/data.ts` | shared JSON/TOML reads |
| `scripts/lib/paths.ts` | shared path helpers |
| `scripts/lib/proc.ts` | shared process helpers |
| `scripts/lib/text.ts` | shared text helpers |
| `scripts/lib/text.test.ts` | tests beside it |
| `bunfig.toml` | the wrappers' `--config` anchor |

### Changed by this ticket (after the copy)

| Path | Change |
|---|---|
| `scripts/lib/efforts.ts` (new) | the one lowest-effort table (codex `none`, claude `low`, muse `minimal`, MiMo `low`) and the top-level table reviews use for a ticket run (codex `max`, claude `max`, MiMo `high`); warn-on-missing lives here |
| `scripts/fixture.ts` / `scripts/fixture.test.ts` | `new` leaves the fixture fact in the copy; score checks the waybill names the recorded efforts (AC1, AC4) |
| `scripts/run-meta.ts` / `scripts/run-meta.test.ts` | dispatch records fixture efforts from the one table, warns on an unknown harness, never touches the machine file; ticket path unchanged (AC2) |
| `scripts/launch.ts` / `scripts/launch.test.ts` | `review` takes the run-recorded lane effort instead of a fixed top level (AC3); AC5 controls |
| `fixtures/app/.postmaster/fixture` (new) | the fact file `fixture.sh new`'s copy carries (also written explicitly by `new` before the initial commit so the script is what leaves it) |
| `skills/postmaster/harnesses.md` | review level is the run-recorded lane effort (ticket = top, fixture = lowest), not a fixed top level |
| `skills/postmaster/postmaster.md` | waybill Team efforts come from `run.json`; a fixture run names the lowered efforts |

`scripts/skill-refs.sh` runs after the runbook edits. No wiki page is updated here: the wiki
records what a scored fixture run has shown, and that evidence is the merge gate's business.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Separate `review_effort` on each recorded lane (ticket = top level, fixture = lowest) | AC3 needs review at "the effort the run recorded for that lane", while AC2/AC5 need ticket launches to stay at the configured effort and ticket reviews to stay at today's top level. One `effort` field cannot be both. | Overwriting `effort` with top level for ticket runs would move workhorse and coachman launches off the configured level, which AC5 forbids. Using `effort` for review as well would drop ticket reviews from top level to whatever the machine config names. |
| `--self-test` on the three copied wrappers dispatches to `bun test scripts/<name>.test.ts` | The gate still runs `scripts/<n>.sh --self-test`; the port moved those controls into `.test.ts` files and the wrappers alone no longer answer the flag. | Dropping `--self-test` would fail the waybill's gate. Keeping the old shell self-tests beside a wrapper would duplicate every control. |

## Decisions

1. **Where the fixture fact lives.** `fixture.sh new` writes `<dest>/.postmaster/fixture` before
   the initial commit (and `fixtures/app/.postmaster/fixture` ships in the app template so the
   file is in the copy's first commit). Presence of that file is the fact. Never the repository's
   name or path. Contents: a single line naming it as a fixture copy (stable, greppable).
2. **Detection site.** `run-meta.sh` checks the target repo path it is already given for
   `.postmaster/fixture`. A missing file means a ticket run. A file that exists but is unreadable
   still counts as a fixture run (presence is the fact).
3. **One lowest table.** `scripts/lib/efforts.ts` exports the lowest table named in the ticket
   and is the only place those strings live. A harness with no entry keeps its effort and
   `run-meta.sh` prints a warning naming the harness and the kept effort.
4. **Review effort recording.** When `run-meta.sh` writes `run.json`, every lane in the recorded
   config also gets `review_effort`: the same lowest string on a fixture run; the harness's top
   level (codex `max`, claude `max`, MiMo `high`) on a ticket run. `launch.sh review` reads that
   field. With no `--run` (live config, no record), review keeps the harness top level as today.
   Roles other than lanes do not get `review_effort`; only lanes are reviewed.
5. **Ticket run recording is untouched apart from `review_effort`.** The resolved effective
   config is recorded as today; only the added per-lane `review_effort` is new. The machine
   config file is never written.
6. **Waybill efforts.** The postmaster already writes the Team section from `run.json`'s config
   (`postmaster.md` Stage B). After the record carries lowered efforts, the waybill names them.
   `fixture.sh score` gains a check that the waybill's `workhorses:` / `coachman:` effort strings
   match the recorded config, so AC4 is scored and not merely assumed.
7. **`--self-test` bridge.** Each of the three wrappers answers `--self-test` by running
   `bun test scripts/<name>.test.ts`, so the waybill's gate command keeps working after the
   port copy. The bridge is a ticket commit after the unchanged copy, not part of the copy.
8. **Unknown harness on a fixture run.** Keep its configured effort and warn on stderr; still
   record `review_effort` as the harness top level if the top table has an entry, else omit it.
   This matches AC2's "keeps its effort, with a warning" and leaves review behavior sane.

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.

- [ ] T001 [P] Copy the #109 port files unchanged from `87038b9222ccb2a3e22706a9110a7923a319d1fd` into the worktree (the Structure table's copy list) and commit that copy alone.
- [ ] T002 [P] [AC2] Add `scripts/lib/efforts.ts` with the one lowest-effort table (codex `none`, claude `low`, muse `minimal`, MiMo `low`) and the ticket-run top-level table (codex `max`, claude `max`, MiMo `high`), plus tests in `scripts/lib/efforts.test.ts`.
- [ ] T003 [AC1] Make `scripts/fixture.ts` leave `.postmaster/fixture` in the copy `new` makes (before the initial commit), ship `fixtures/app/.postmaster/fixture`, and cover it in `scripts/fixture.test.ts`.
- [ ] T004 [AC2] Make `scripts/run-meta.ts` detect `.postmaster/fixture` in the target repo and, when present, record every lane and role at the lowest table's effort (warn and keep on a missing entry); when absent, record the config as today. Always record per-lane `review_effort` (lowest on a fixture run, top level on a ticket run). Never write the machine config. Controls in `scripts/run-meta.test.ts`.
- [ ] T005 [AC3] Make `scripts/launch.ts` `review` use the run-recorded lane `review_effort` instead of a fixed top level; with no `--run`, keep the top level. Controls in `scripts/launch.test.ts`, including a ticket-run review that still names `max` / `high`.
- [ ] T006 [AC4] Make `scripts/fixture.ts` `score` check that the waybill names the efforts `run.json` recorded; cover it in `scripts/fixture.test.ts`.
- [ ] T007 [AC5] Add the AC5 control matrix to `scripts/launch.test.ts` and `scripts/run-meta.test.ts`: identical launch commands under a fixture record and a ticket record, asserting lowest vs configured for workhorse launch, coachman leg, resume and bug-lens review.
- [ ] T008 [AC2] [AC3] [AC4] Bridge `--self-test` on `scripts/fixture.sh`, `scripts/run-meta.sh` and `scripts/launch.sh` to `bun test scripts/<name>.test.ts`, so the gate's self-test loop still runs these suites.
- [ ] T009 [AC3] [AC4] Update `skills/postmaster/harnesses.md` (review level is the run-recorded lane effort) and `skills/postmaster/postmaster.md` (waybill Team efforts from `run.json`; fixture runs name the lowered efforts). Run `scripts/skill-refs.sh`.
- [ ] T010 [AC1] [AC2] [AC3] [AC4] [AC5] Run the waybill's gate from the worktree root (`bash -c '…'` as given), fix what it names that this change broke, and confirm every acceptance criterion has a green control.
