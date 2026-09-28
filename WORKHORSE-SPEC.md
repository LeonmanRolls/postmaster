# Workhorse spec: #113 Allow runs to change overlapping files

## Summary

Ticket #113 removes file-surface scheduling limits so runs launch up to `team.max_runs`, with the run merging second resolving conflicts at its merge; this workhorse will update the runbooks and search the full acceptance-criteria scope for remaining restrictions.

## Technical context

- **Language and version**: Markdown prose.
- **Dependencies used or added**: None.
- **Testing**: Search `skills/`, `AGENTS.md`, `README.md` and `wiki/` for rules against overlapping run file changes; run the configured gate with `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: Prose only. Preserve `team.max_runs` and its value. Preserve existing merge-conflict mechanics. Do not change scripts, gates or self-tests. Work and commit only in this worktree; never push.

## Direction check

- Stage A step 6 will order tickets by dependencies only.
- No hard rule will prohibit runs from changing overlapping files; `team.max_runs` will remain the only in-flight run limit in `postmaster.md`.
- The coachman concurrency note will say the run merging second resolves conflicts at its merge, by merging and never rebasing, without sequencing advice.
- I will search the full AC4 scope and remove or reword every remaining statement that requires runs not to change the same files.
- Changes stay in Markdown; no scripts, gates, self-tests or `team.max_runs` values change.

## Structure

- Update `skills/postmaster/postmaster.md` scheduling guidance and hard rules.
- Update the concurrency note in `skills/postmaster/coachman.md`.
- Inspect `skills/`, `AGENTS.md`, `README.md` and `wiki/` for any further overlapping-file restrictions; edit any additional affected prose files found there.

## Decisions

- Keep dependency ordering: a ticket that needs another ticket's change waits for it to land.
- Keep the current conflict-resolution mechanics in `coachman.md`; clarify that the second merge resolves conflicts by merging and never rebasing.
- Do not change the configured `team.max_runs` value or default.

## Tasks

- [ ] T001 [AC1] Change Stage A step 6 and remove the overlapping-surface prohibition in `skills/postmaster/postmaster.md`.
- [ ] T002 [AC2] Keep `team.max_runs` as the only in-flight limit in `skills/postmaster/postmaster.md`.
- [ ] T003 [AC3] Update the concurrency note in `skills/postmaster/coachman.md` to describe second-merge conflict resolution without sequencing advice.
- [ ] T004 [AC4] Search `skills/`, `AGENTS.md`, `README.md` and `wiki/`, and update any remaining rules against overlapping run file changes.
