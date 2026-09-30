# Workhorse spec: 182 A fixture run runs every agent at its harness's lowest effort

## Summary

Mark fixture repositories when `fixture.sh new` creates them, lower every configured lane and
role in the recorded config at dispatch, and have launches and the waybill use those recorded
efforts.

## Technical context

- **Language and version**: TypeScript run by Bun, copied from the port at `87038b9222ccb2a3e22706a9110a7923a319d1fd`.
- **Dependencies used or added**: Existing Bun and Node built-ins; no new runtime dependency.
- **Testing**: `bun test scripts/fixture.test.ts scripts/run-meta.test.ts scripts/launch.test.ts`; the project gate via `/home/brindlewick/.postmaster/tool-pins/af5d373ea70c9a562a0f79859199361b0ac79697/scripts/verify.sh run .`; and a fixture dispatch whose `scripts/fixture.sh score` result is clean.
- **Constraints**: Fixture status comes only from a marker written by `fixture.sh new`, never the project name or path. Only fixture runs get lower effort. The machine config stays untouched, ticket-run config stays as recorded today, and an unmapped harness keeps its effort with a warning. Each script change stays in TypeScript with adjacent tests. Copy the port files unchanged and commit that copy separately before editing implementation. Never push.

## Direction check

- The user's direction changes fixture runs only; ticket runs retain their configured efforts. The marker controls the fixture-only config transform, and tests will run the same launch commands against fixture and ticket records.
- The minimum-effort table lives in one place in `scripts/run-meta.ts`: codex `none`, claude `low`, muse `minimal`, and mimo `low`. Unmapped harnesses keep their configured value and produce a warning.
- `run-meta.ts` writes only the run's config copy. It does not alter the machine config. The `fixture.sh new` marker makes fixture detection independent of a repository's name or location.
- `launch.ts` reads review effort from the selected lane in the config chosen by `--run`; this preserves the recorded ticket-run value and avoids a separate review-level table.
- The waybill template and Stage B instructions will require the effective efforts for every configured lane and role, including reviewer lanes and coachman leg overrides.
- The conversion rule requires the TypeScript port files and their dependencies to be copied unchanged and committed separately before ticket edits. The plan follows it.
- The repository's general rules require deterministic behavior in scripts, controls for every count, project actions logged as they happen, and prompts passed as arguments or files. This change adds no project-action count or prompt selection; its paired fixture/ticket controls use identical launch commands.
- All work stays on this worktree branch. No push or changes outside the worktree are planned.

## Structure

First, copy these files unchanged from the specified port commit and commit them by themselves:

- `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`
- `scripts/fixture.sh`, `scripts/fixture.ts`, `scripts/fixture.test.ts`
- `scripts/run-meta.sh`, `scripts/run-meta.ts`, `scripts/run-meta.test.ts`
- `scripts/launch.sh`, `scripts/launch.ts`, `scripts/launch.test.ts`
- `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `scripts/lib/text.ts`, `scripts/lib/text.test.ts`

Then change the TypeScript scripts and their tests:

- `scripts/fixture.ts` and `scripts/fixture.test.ts`
- `scripts/run-meta.ts` and `scripts/run-meta.test.ts`
- `scripts/launch.ts` and `scripts/launch.test.ts`

Update the waybill instructions and code-review contract in:

- `skills/postmaster/SKILL.md`
- `skills/postmaster/postmaster.md`
- `skills/postmaster/harnesses.md`

## Complexity tracking

None.

## Decisions

- `fixture.sh new` will write a tracked `.postmaster-fixture` marker at the fixture repository root before its initial commit. Its content will identify the marker format, not a path or repository name. `run-meta.ts` will classify a run by checking that file in the supplied project.
- `run-meta.ts` will apply the single harness-to-minimum table to all lane entries, team roles, and coachman leg overrides in the resolved config. Unknown harnesses retain their configured effort and are named in a warning.
- The waybill will carry an `efforts:` entry derived from the recorded config, listing every configured lane and role, including reviewer-only lanes and leg overrides. This makes the actual recorded values explicit for fixture and ticket runs.
- Launch tests will use recording harness stubs and the same `launch.sh` forms with fixture and ticket run records. They will cover workhorse launch, coachman leg launch, resume, and bug-lens review, asserting the recorded minimum for fixtures and configured effort for ticket runs.
- Validation will include the targeted Bun tests, the project's full gate, and a fixture run scored clean on this branch before merge.

## Tasks

- [ ] T001 [P] [AC1] Copy the listed TypeScript port files and dependencies unchanged from commit `87038b9222ccb2a3e22706a9110a7923a319d1fd`; commit the copy separately.
- [ ] T002 [AC1] Update `scripts/fixture.ts` and `scripts/fixture.test.ts` so `fixture.sh new` writes the tracked marker into the copied project and fixture detection does not depend on its name or path.
- [ ] T003 [AC2] Update `scripts/run-meta.ts` and `scripts/run-meta.test.ts` to lower all mapped lane and role efforts only for marked fixtures, warn and preserve unmapped efforts, preserve ticket config, and leave the machine config untouched.
- [ ] T004 [AC3] Update `scripts/launch.ts`, `scripts/launch.test.ts`, and `skills/postmaster/harnesses.md` so bug-lens reviews use the recorded lane effort.
- [ ] T005 [AC4] Update `skills/postmaster/SKILL.md` and `skills/postmaster/postmaster.md` so each waybill lists the effective efforts for configured lanes and roles from the recorded config.
- [ ] T006 [AC5] Add paired fixture and ticket launch controls to `scripts/launch.test.ts` for workhorse launch, coachman leg, resume, and bug-lens review, using identical commands and checking each effort.
- [ ] T007 [AC4] Extend `scripts/fixture.ts` and `scripts/fixture.test.ts` so fixture scoring verifies that the waybill names the effective efforts, preserving the scorer's positive and negative controls.
