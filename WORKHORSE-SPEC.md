# Workhorse spec: 182 A fixture run runs every agent at its harness's lowest effort

## Summary

A fixture run launches every agent at its harness's lowest effort; a ticket
run keeps its configured levels. `fixture.sh new` leaves a fixture fact in
the copy it makes, [`run-meta.sh`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.sh) records lowered efforts from one table when
that fact is present, `launch.sh review` takes its effort from the run's
record instead of a fixed top level, and every waybill carries one
`efforts:` line printed from the record, which `fixture.sh score` checks.
This spec is the coachman's one spec for both lanes, written for a base that
includes #109.

## Technical context

- **Language and version**: TypeScript run by Bun. Since #109 the scripts
  this ticket changes are [`scripts/fixture.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.ts), [`scripts/run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts) and
  [`scripts/launch.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.ts), each run by its `scripts/<name>.sh` wrapper;
  every edit lands in the `.ts`, never the wrapper.
- **Dependencies used or added**: none. No new packages; [`package.json`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/package.json) and
  [`bun.lock`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/bun.lock) are not touched.
- **Testing**: `bun test scripts/fixture.test.ts scripts/run-meta.test.ts
  scripts/launch.test.ts` for the ticket's controls; the waybill's gate from
  the worktree root; and a fixture run scored clean on this branch before
  merge (the merge gate, not this run's work).
- **Constraints**: This ticket waits for #109 and is implemented on a base
  that includes it, so nothing is copied from #109's branch (the user's
  word, 2026-10-01). Only fixture runs change. Fixture status comes only
  from the marker `fixture.sh new` writes, never the repository's name or
  path. The machine config file is never written. A ticket run records its
  config as today. An unmapped harness keeps its effort, with a warning.
  Tests sit beside their target as `<name>.test.ts`, in a functional style.
  Work in this worktree only; never push.

## Direction check

- "Fixture runs should be at minimum effort" (2026-09-30): [`run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts)
  rewrites the recorded config's efforts to the one lowest table when the
  fixture fact is present, so every `--run` launch, resume and review
  follows it.
- Lowest levels tried 2026-09-30: exactly the one table [`run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts)
  records from: codex `none`, claude `low`, muse `minimal`, MiMo `low`.
- Only fixture runs change; ticket runs keep their top level: the ticket
  path records the effective machine config unchanged, and review reads the
  lane's recorded effort, which on a ticket run is the configured level
  (top in practice, per AC5).
- No repo-specific hardcoding: the fixture fact is a file the copy carries;
  detection never looks at name or path.
- Deterministic work in scripts: the table, the fact check, the record
  rewrite, the review effort, the `efforts:` line and the score check all
  live in `scripts/`, with paired controls in their tests. The postmaster
  pastes the `efforts:` line; it never composes it.
- TypeScript for every script this ticket changes: the three scripts are
  TypeScript on the base, so the change is made there directly.
- Every count needs a control: AC5 is a control matrix over identical
  commands under a fixture run's record and a ticket run's.

## Structure

- [`scripts/fixture.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.ts) / [`scripts/fixture.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.test.ts): `new` leaves the
  fixture fact in the copy; `score` checks the waybill's efforts against
  `run.json` (AC1, AC4).
- [`scripts/run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts) / [`scripts/run-meta.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.test.ts): dispatch records
  fixture efforts from the one table, warns on an unknown harness, never
  touches the machine file, ticket path unchanged (AC2); a new
  `efforts <dispatch>` command prints the waybill's `efforts:` line from
  `run.json` (AC4).
- [`scripts/launch.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.ts) / [`scripts/launch.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.test.ts): `review` takes the
  lane's effort from the selected config instead of a fixed top level
  (AC3); the AC5 command controls.
- [`skills/postmaster/SKILL.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/SKILL.md): the waybill template's Team section gains
  the `efforts:` line.
- [`skills/postmaster/postmaster.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/postmaster.md): Stage B step 7 pastes the line
  `run-meta.sh efforts <dispatch>` prints, and names `run.json` as the
  source of the whole team.
- [`skills/postmaster/harnesses.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/harnesses.md): the review level is the run-recorded
  lane effort, not a fixed top level.
- [`skills/postmaster/coachman.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/coachman.md): the bug-lens entry no longer says the
  form fixes each harness at its highest review level.

No wiki page is updated here: the wiki records what a scored fixture run
has shown, and that evidence is the merge gate's business.

## Acceptance checks

For each acceptance criterion, the check that shows it working the way it
will really be used: the command, the input and what it should print.

- **AC1.** `scripts/fixture.sh new <scratch>/copy1 <ticket>` makes a repo
  whose first commit holds `.postmaster/fixture` with the fixed one-line
  marker and nothing else new. `mv` the copy to a neutral name and
  dispatch against it: `run.json` still records the lowest efforts. A
  plain repo with "fixture" in its name records the configured efforts.
- **AC2.** `scripts/run-meta.sh <dispatch> <fixture-copy>` writes
  `run.json` with codex `none`, claude `low`, muse `minimal`, MiMo `low`
  on every lane and role whose config names an effort; a lane that names
  none still names none; a lane on an unmapped harness keeps its
  configured effort and the command names it on stderr; `sha256sum` of
  the machine config is identical before and after. Against a plain repo
  the same command records the effective config unchanged.
- **AC3.** With stub harnesses on PATH,
  `scripts/launch.sh review <lane> <scratch> <base> --run <fixture-dispatch>`
  runs codex with `model_reasoning_effort="none"`, claude with
  `/code-review low <range>` and `--effort low`, mimo with
  `--variant low`. The identical commands with `--run <ticket-dispatch>`
  name `max`, `max`, `high`, as today.
- **AC4.** `scripts/run-meta.sh efforts <fixture-dispatch>` prints one
  `efforts:` line naming every lane and coachman role that has an effort
  in `run.json`, each at its recorded level, and a fixture run's waybill
  carries that line. `scripts/fixture.sh score <dispatch> <repo>` passes
  a waybill whose `efforts:` line and Team efforts match `run.json`, and
  fails one where either differs.
- **AC5.** `scripts/launch.sh form <lane> --run <dispatch>`,
  `form coachman --leg synthesis --run <dispatch>` (launch and resume
  lines) and the stubbed AC3 review: identical commands under a fixture
  run's dispatch name the lowest efforts, and under a ticket run's the
  configured ones.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Review names the harness top level when the lane names no effort (codex `max`, claude `max`, mimo `high`) | Without a named level, claude's `/code-review` reuses whatever level an interactive session last used ([harnesses.md](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/harnesses.md)), which is nondeterministic; and an effortless lane's review must stay as today. | Omitting the level follows harness defaults that differ per harness and, for claude, per machine history. |

## Decisions

- **Where the fixture fact lives.** `fixture.sh new` writes
  `.postmaster/fixture` in the copy before the initial commit, so the
  fact is tracked in the copy's first commit. Content is a fixed one-line
  marker string naming the format, holding no path or repository name;
  tests assert it byte-for-byte. `.postmaster/` is the established home
  for postmaster facts (settings, verify); a root dotfile would scatter
  them. The app template does NOT ship the file: it is a property of the
  copy `new` made, and shipping it would mark every `makeRepo`-built
  repo (including score self-test records) as a fixture run.
- **Detection site.** [`run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts) checks the target repo path it is
  already given for `.postmaster/fixture`. Presence is the fact: a
  missing file means a ticket run, and an unreadable-but-present file
  still counts as fixture. Never the repository's name or path.
- **One lowest table, in [`run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts).** The table
  (codex `none`, claude `low`, muse `minimal`, MiMo `low`) lives once in
  [`run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts), its only consumer; no shared module, no second table.
  It applies to every lane and every team role (coachman,
  coachman_fallback, postmaster, coachman_legs entries) whose effective
  config names a harness and an effort, before `run.json` is written. One
  that names no effort stays without one (the user's word, 2026-10-01):
  the table never adds an effort the config did not name. An unmapped
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
  Complexity tracking), on a fixture run as on a ticket run. Harnesses
  without a review form still exit 3.
- **Waybill efforts: one `efforts:` line.** `run-meta.sh efforts
  <dispatch>` prints one line from `run.json`: `efforts:` followed by
  `<name>=<effort>` pairs for every lane and coachman role that has an
  effort, a per-leg coachman as `coachman.<leg>`. It names the levels the
  Team lines leave out: reviewer-only lanes, the coachman fallback and
  per-leg coachmen. The postmaster is left out: no launch in a run reads
  its entry. Every waybill's Team section carries the line, a ticket
  run's naming its configured levels, so the template has one shape. The
  postmaster pastes the printed line at Stage B step 7 and never writes it
  by hand.
- **`score` checks AC4.** `fixture.sh score` checks the waybill's
  `efforts:` line against `run.json` pair by pair, and each Team entry's
  effort against the recorded one, reading the effort as the entry's last
  `/` field because a model may itself hold a slash
  (`mimo=mimo/<provider>/<model>/high`). A match scores clean and any
  difference fails, with positive and negative controls beside the
  existing ones.
- **Runbook wording follows the behavior.** [`harnesses.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/harnesses.md) (review level
  is the run-recorded lane effort; top when the lane names none),
  [`coachman.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/coachman.md) (bug-lens entry drops the fixed-top sentence),
  [`postmaster.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/postmaster.md) (Stage B step 7 pastes the `efforts:` line; it already
  says the team's config is the one in `run.json`, and its wording is
  tidied to name that source once) and [`SKILL.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/SKILL.md) (the template's
  `efforts:` line) change with the scripts; the script and its runbook
  change together.

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
task serves. Every acceptance criterion has at least one task.

- [ ] T001 [P] [AC1] Make [`scripts/fixture.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.ts) `new` write `.postmaster/fixture` with the fixed one-line marker before the initial commit; update the copy-contents control in [`scripts/fixture.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.test.ts) to expect exactly the app's files plus the marker, and cover the marker's presence, content and name/path independence.
- [ ] T002 [P] [AC2] Make [`scripts/run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts) lower every lane and role that names an effort from the one table when `.postmaster/fixture` is present in the target repo (leave one that names none without one; warn on stderr naming an unmapped harness and keep its effort), record the config unchanged when absent, and never write the machine config; controls in [`scripts/run-meta.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.test.ts), including coachman_legs entries and a lane with no effort.
- [ ] T003 [P] [AC3] Make [`scripts/launch.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.ts) `review` use the lane's effort from the selected config, falling back to the harness top level when the lane names none; controls in [`scripts/launch.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.test.ts), including a ticket-run review that still names `max` / `high` and an effortless lane that names top.
- [ ] T004 [AC4] Add `efforts <dispatch>` to [`scripts/run-meta.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.ts), printing the `efforts:` line from `run.json` (lanes and coachman roles, not the postmaster), with controls in [`scripts/run-meta.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/run-meta.test.ts); add the line to the waybill template's Team section in [`skills/postmaster/SKILL.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/SKILL.md), and make [`skills/postmaster/postmaster.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/postmaster.md) Stage B step 7 paste it and name `run.json` as the team's source.
- [ ] T005 [AC4] Make [`scripts/fixture.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.ts) `score` check the waybill's `efforts:` line and each Team entry's effort (its last `/` field) against `run.json`, with positive and negative controls in [`scripts/fixture.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/fixture.test.ts).
- [ ] T006 [AC3] Update [`skills/postmaster/harnesses.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/harnesses.md) (review level is the run-recorded lane effort, top when the lane names none) and [`skills/postmaster/coachman.md`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/skills/postmaster/coachman.md) (bug-lens entry drops the fixed-top sentence), then run [`scripts/skill-refs.sh`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/skill-refs.sh).
- [ ] T007 [AC5] Add the AC5 control matrix to [`scripts/launch.test.ts`](https://github.com/brindlewick/postmaster/blob/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/launch.test.ts): identical `form` (workhorse launch, coachman leg, resume lines) and stubbed `review` commands under a fixture run's dispatch and a ticket run's, asserting lowest vs configured each way.
- [ ] T008 [AC1] [AC2] [AC3] [AC4] [AC5] Run the waybill's gate from the worktree root, fix what it names that this change broke, and confirm every acceptance criterion has a green control.
