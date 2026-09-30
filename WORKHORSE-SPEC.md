# Workhorse spec: 182 A fixture run runs every agent at its harness's lowest effort

## Summary

A fixture run launches every agent at its harness's lowest effort; a ticket
run keeps its configured levels. `fixture.sh new` leaves a fixture fact in
the copy it makes, `run-meta.sh` records lowered efforts from one table when
that fact is present, `launch.sh review` takes its effort from the run's
record instead of a fixed top level, and the waybill names the recorded
efforts. This spec is the coachman's one spec for both lanes.

## Technical context

- **Language and version**: TypeScript run by Bun. The three scripts this
  ticket changes are copied from the #109 port first (copy commit), then
  changed in TypeScript; every ticket edit lands in the `.ts`, never the
  shell wrapper.
- **Dependencies used or added**: none beyond what the port files already
  import (`node:` builtins, `bun:test`, relative `./lib/*.ts`). No new
  packages; `package.json` and `bun.lock` are not touched.
- **Testing**: `bun test scripts/fixture.test.ts scripts/run-meta.test.ts
  scripts/launch.test.ts` for the ticket's controls; `scripts/<name>.sh
  --self-test` for each copied script (bridged in-TS, see T008); the
  waybill's gate from the worktree root; and a fixture run scored clean on
  this branch before merge (the merge gate, not this run's work).
- **Constraints**: Only fixture runs change. Fixture status comes only from
  the marker `fixture.sh new` writes, never the repository's name or path.
  The machine config file is never written. A ticket run records its config
  as today. An unmapped harness keeps its effort, with a warning. Scripts
  this ticket writes or changes are TypeScript with `<name>.test.ts` beside
  them, in a functional style. Work in this worktree only; never push.

## Direction check

- "Fixture runs should be at minimum effort" (2026-09-30): `run-meta.ts`
  rewrites the recorded config's efforts to the one lowest table when the
  fixture fact is present, so every `--run` launch, resume and review
  follows it.
- Lowest levels tried 2026-09-30: exactly the one table `run-meta.ts`
  records from: codex `none`, claude `low`, muse `minimal`, MiMo `low`.
- Only fixture runs change; ticket runs keep their top level: the ticket
  path records the effective machine config unchanged, and review reads the
  lane's recorded effort, which on a ticket run is the configured level
  (top in practice, per AC5).
- No repo-specific hardcoding: the fixture fact is a file the copy carries;
  detection never looks at name or path.
- Deterministic work in scripts: the table, the fact check, the record
  rewrite, the review effort and the score check all live in `scripts/`,
  with paired controls in their tests.
- TypeScript for scripts this ticket changes: copy the port files unchanged
  first (T001), then change the TypeScript; the `--self-test` bridge lives
  in the `.ts` so no ticket edit lands in shell.
- Every count needs a control: AC5 is a control matrix over identical
  commands under a fixture record and a ticket record.

## Structure

### Copied unchanged from commit `87038b9222ccb2a3e22706a9110a7923a319d1fd` (#109 port)

One commit that is the copy alone (`git show 87038b9222cc:<path>` per file):

- `scripts/fixture.sh`, `scripts/fixture.ts`, `scripts/fixture.test.ts`
- `scripts/run-meta.sh`, `scripts/run-meta.ts`, `scripts/run-meta.test.ts`
- `scripts/launch.sh`, `scripts/launch.ts`, `scripts/launch.test.ts`
- `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`,
  `scripts/lib/text.ts`, `scripts/lib/text.test.ts`
- `scripts/fixtures/text-goldens.json` (read by `scripts/lib/text.test.ts`)
- `bunfig.toml` (the wrappers' `--config` anchor)

Not copied: `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`. The
port's `package.json` has no `lint` script, so copying it would break the
waybill's gate at `bun run lint`; the copied code imports only `node:`
builtins, `bun:test` and relative paths, so it needs none of those files.

### Changed by this ticket (after the copy)

- `scripts/fixture.ts` / `scripts/fixture.test.ts`: `new` leaves the
  fixture fact in the copy; `score` checks the waybill names the recorded
  efforts (AC1, AC4).
- `scripts/run-meta.ts` / `scripts/run-meta.test.ts`: dispatch records
  fixture efforts from the one table, warns on an unknown harness, never
  touches the machine file; ticket path unchanged (AC2).
- `scripts/launch.ts` / `scripts/launch.test.ts`: `review` takes the
  lane's effort from the selected config instead of a fixed top level
  (AC3); AC5 command controls.
- `skills/postmaster/harnesses.md`: the review level is the run-recorded
  lane effort, not a fixed top level.
- `skills/postmaster/coachman.md`: the bug-lens entry no longer says the
  form fixes each harness at its highest review level.
- `skills/postmaster/postmaster.md`: Stage B step 7 sources the waybill
  team from `run.json`'s recorded config.

No wiki page is updated here: the wiki records what a scored fixture run
has shown, and that evidence is the merge gate's business.

## Acceptance checks

For each acceptance criterion, the check that shows it working the way it
will really be used: the command, the input and what it should print.

- **AC1.** `scripts/fixture.sh new /tmp/<runs>/copy1 <ticket>` makes a
  repo whose first commit holds `.postmaster/fixture` with the fixed
  one-line marker and nothing else new. `mv` the copy to a neutral name
  and dispatch against it: `run.json` still records the lowest efforts.
  A plain repo with "fixture" in its name records the configured efforts.
- **AC2.** `scripts/run-meta.sh <dispatch> <fixture-copy>` writes
  `run.json` with codex `none`, claude `low`, muse `minimal`, MiMo `low`
  on every lane and role; a lane on an unmapped harness keeps its
  configured effort and the command names it on stderr; `sha256sum` of
  the machine config is identical before and after. Against a plain
  repo the same command records the effective config unchanged.
- **AC3.** With stub harnesses on PATH,
  `scripts/launch.sh review <lane> <scratch> <base> --run <fixture-record>`
  runs codex with `model_reasoning_effort="none"`, claude with
  `/code-review low <range>` and `--effort low`, mimo with
  `--variant low`. The identical commands with `--run <ticket-record>`
  name `max`, `max`, `high`, as today.
- **AC4.** A fixture run's waybill Team triples (`lane=harness/model/effort`)
  equal the `run.json` recorded efforts. `scripts/fixture.sh score
  <dispatch> <repo>` passes a matching waybill and fails one whose triple
  differs from the record.
- **AC5.** `scripts/launch.sh form <lane> --run <record>`,
  `form coachman --leg synthesis --run <record>` (launch and resume lines)
  and the stubbed AC3 review: identical commands under the fixture record
  name the lowest efforts and under the ticket record the configured ones.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `--self-test` on the three copied scripts dispatches to `bun test scripts/<name>.test.ts` from inside the `.ts` | The port moved those controls into `.test.ts` files and the ported `.ts` answers no `--self-test`; the waybill's gate still runs `scripts/<n>.sh --self-test` for all three. | Dropping `--self-test` fails the gate. Dispatching from the shell wrapper would put a ticket edit in shell, against the user's word that every script this ticket changes is TypeScript. |
| Review names the harness top level when the lane names no effort (codex `max`, claude `max`, mimo `high`) | Without a named level, claude's `/code-review` reuses whatever level an interactive session last used (harnesses.md), which is nondeterministic; and an effortless lane's review must stay as today. | Omitting the level follows harness defaults that differ per harness and, for claude, per machine history. |

## Decisions

- **Where the fixture fact lives.** `fixture.sh new` writes
  `.postmaster/fixture` in the copy before the initial commit, so the
  fact is tracked in the copy's first commit. Content is a fixed one-line
  marker string naming the format, holding no path or repository name;
  tests assert it byte-for-byte. `.postmaster/` is the established home
  for postmaster facts (settings, verify); a root dotfile would scatter
  them. The app template does NOT ship the file: it is a property of the
  copy `new` made, and shipping it would mark every `make_repo`-built
  repo (including score self-test records) as a fixture run.
- **Detection site.** `run-meta.ts` checks the target repo path it is
  already given for `.postmaster/fixture`. Presence is the fact: a
  missing file means a ticket run, and an unreadable-but-present file
  still counts as fixture. Never the repository's name or path.
- **One lowest table, in `run-meta.ts`.** The table
  (codex `none`, claude `low`, muse `minimal`, MiMo `low`) lives once in
  `run-meta.ts`, its only consumer; no shared module, no second table.
  It applies to every lane and every team role with a harness and an
  effort (coachman, coachman_fallback, postmaster, coachman_legs entries)
  in the effective config before `run.json` is written. An unmapped
  harness keeps its configured effort and is named on stderr with the
  kept effort.
- **No separate review effort.** Review reads the lane's recorded
  `effort`, the field AC3 names ("the effort the run recorded for that
  lane"). A ticket run therefore reviews at its configured level (top in
  practice), exactly what AC5's "in a ticket run, each launches at the
  configured level" requires of the bug-lens review. A parallel
  `review_effort` field would contradict that sentence and add a second
  table the ticket never asks for.
- **Review effort source.** `launch.ts review` takes the lane's effort
  from the selected config (recorded with `--run`, live without), the
  same source as launch and resume; the fixed top level is gone. When
  the lane names no effort, review names the harness top level (see
  Complexity tracking). Harnesses without a review form still exit 3.
- **Waybill efforts.** No new section: the Team triples already carry
  `lane=harness/model/effort`, so naming the recorded config there IS
  AC4. `postmaster.md` Stage B step 7 is corrected to source the team
  from `run.json`'s recorded config (today it says "the resolved machine
  config", which on a fixture run would write the wrong levels). A
  separate `efforts:` entry would list every lane and role twice.
- **`score` checks AC4.** `fixture.sh score` verifies each waybill Team
  triple against the `run.json` recorded config: a matching waybill
  scores clean, a mismatched effort fails, with positive and negative
  controls beside the existing ones.
- **Runbook wording follows the behavior.** `harnesses.md` (review level
  is the run-recorded lane effort; top when the lane names none),
  `coachman.md` (bug-lens entry drops the fixed-top sentence) and
  `postmaster.md` (Stage B step 7) change with the scripts; the script
  and its runbook change together. `SKILL.md`'s waybill template is
  unchanged: its Team shape already carries effort.
- **Copy fallout is fixed before ticket edits.** The T001 copy commit is
  verified by running the three copied suites and the gate; anything the
  copy breaks is fixed in the copy's terms before the ticket's changes
  begin, so a later red line blames the ticket, not the port.

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Copy the Structure section's file list unchanged from `87038b9222ccb2a3e22706a9110a7923a319d1fd` (`git show 87038b9222cc:<path>` per file) and commit that copy alone; run `bun test scripts/fixture.test.ts scripts/run-meta.test.ts scripts/launch.test.ts scripts/lib/text.test.ts` and the waybill's gate, and fix copy fallout before any ticket edit.
- [ ] T002 [AC1] Make `scripts/fixture.ts` `new` write `.postmaster/fixture` with the fixed one-line marker before the initial commit; update the copy-contents control in `scripts/fixture.test.ts` to expect exactly the app's files plus the marker, and cover the marker's presence, content and name/path independence.
- [ ] T003 [AC2] Make `scripts/run-meta.ts` lower every lane and role effort from the one table when `.postmaster/fixture` is present in the target repo (warn on stderr naming an unmapped harness and keep its effort), record the config unchanged when absent, and never write the machine config; controls in `scripts/run-meta.test.ts`, including coachman_legs entries.
- [ ] T004 [AC3] Make `scripts/launch.ts` `review` use the lane's effort from the selected config, falling back to the harness top level when the lane names none; controls in `scripts/launch.test.ts`, including a ticket-record review that still names `max` / `high` and an effortless lane that names top.
- [ ] T005 [AC4] Correct `skills/postmaster/postmaster.md` Stage B step 7 to source the waybill team from `run.json`'s recorded config; make `scripts/fixture.ts` `score` verify the waybill Team triples against the record, with positive and negative controls in `scripts/fixture.test.ts`.
- [ ] T006 [AC3] Update `skills/postmaster/harnesses.md` (review level is the run-recorded lane effort, top when the lane names none) and `skills/postmaster/coachman.md` (bug-lens entry drops the fixed-top sentence).
- [ ] T007 [AC5] Add the AC5 control matrix to `scripts/launch.test.ts`: identical `form` (workhorse launch, coachman leg, resume lines) and stubbed `review` commands under a fixture record and a ticket record, asserting lowest vs configured each way.
- [ ] T008 [AC1] [AC2] [AC3] Answer `--self-test` in `scripts/fixture.ts`, `scripts/run-meta.ts` and `scripts/launch.ts` by running `bun test scripts/<name>.test.ts`, so the gate's self-test loop passes for the three copied scripts; wrappers stay the port's two-liners.
- [ ] T009 [AC1] [AC2] [AC3] [AC4] [AC5] Run the waybill's gate from the worktree root, fix what it names that this change broke, and confirm every acceptance criterion has a green control.
