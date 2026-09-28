# Workhorse spec: 113 two runs may change the same files

## Summary

The runbooks keep two runs off overlapping file surfaces; the user never wanted that rule.
Runs go in parallel up to `team.max_runs`, tickets are ordered by dependencies only, and the
run that merges second resolves the conflicts at its merge. This workhorse rewords three
passages in `skills/postmaster/postmaster.md` and `skills/postmaster/coachman.md` and sweeps
the AC4 scope for any leftover statement of the old rule.

## Technical context

- **Language and version**: Markdown prose in the runbooks; no code.
- **Dependencies used or added**: none.
- **Testing**: the project's gate (`bash -c 'for f in scripts/*.sh; ...'`) via
  `/home/brindlewick/postmaster/scripts/verify.sh run .`, plus a grep sweep of `skills/`,
  `AGENTS.md`, `README.md` and `wiki/` for the old rule's wording.
- **Constraints**: take the rule out and nothing more; `team.max_runs` and its value stay as
  they are; how a conflict is resolved stays as `coachman.md` already gives it (merge, never
  rebase); dependencies still order tickets; prose only, no script or gate changes; script
  paths in runbooks keep going through `<tool>`; the wiki stays lint-clean.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Stage A step 6 orders tickets by their dependencies only | Rewrite `postmaster.md` Stage A step 6 to order by dependencies alone; a ticket that needs another's change waits for it to land. |
| No hard rule forbids two runs on the same files | Drop "and never two runs on overlapping file surfaces" from `postmaster.md`'s hard rules. |
| `team.max_runs` is the only limit `postmaster.md` puts on runs in flight | The remaining hard rule is "Never launch more runs than `team.max_runs`"; Stage B's ceiling line is unchanged. |
| `coachman.md`'s concurrency note: second merger resolves conflicts, merge never rebase, no sequencing advice | Rewrite the note to say exactly that, dropping "Prefer sequencing those tickets" and "check the file surfaces before mass-launching". |
| Nothing else under `skills/`, `AGENTS.md`, `README.md` or the wiki still says two runs must not change the same files | Grep-sweep those paths; the only hits are the three passages above; remove or reword each. |
| A dependency still orders tickets | Kept in Stage A step 6 and in the concurrency note's last line. |
| Out of scope: conflict-resolution mechanics, `team.max_runs`'s value | Neither is touched. |
| Prose only | No script, gate or self-test changes; the gate's `skill-refs.sh` and `wiki-lint.sh` still pass. |
| Design rules (AGENTS.md): nothing repo-specific, deterministic work in scripts, script paths via `<tool>`, wiki lint clean | Pure prose edits; no new rules as prose that belong in a script; existing `<tool>` paths untouched. |

## Structure

- `WORKHORSE-SPEC.md` — this file (first commit).
- `skills/postmaster/postmaster.md` — Stage A step 6; the hard rule on run count.
- `skills/postmaster/coachman.md` — the Concurrency note near the end.
- `WORKHORSE-SUMMARY.md` — written last.

## Decisions

- Stage A step 6 becomes "Order them. Dependencies first: a ticket that needs another's
  change waits for it to land." The rest of the step (record the order and the reason in
  `plan.md`) is unchanged. Ties beyond dependencies are the postmaster's free choice; the
  runbook does not say how to break them, and inventing a tie-break would be new scope.
- The concurrency note keeps the useful facts (merges serialize; it is merge, never rebase;
  the blocked-by graph encodes logical order) and drops every piece of file-surface or
  sequencing advice. Colliding-barrel-exports colour is dropped with it: it existed only to
  motivate sequencing.
- "Never launch more runs than `team.max_runs`" is left as the sole in-flight limit, worded
  the same as the first half of the current hard rule.

## Tasks

- [x] T001 [AC1] Rewrite Stage A step 6 in `skills/postmaster/postmaster.md` so tickets are ordered by dependencies only.
- [x] T002 [AC2] Drop the overlapping-file-surfaces clause from the hard rule in `skills/postmaster/postmaster.md`, leaving `team.max_runs` as the only in-flight limit.
- [x] T003 [AC3] Rewrite the Concurrency note in `skills/postmaster/coachman.md`: second merger resolves conflicts at its merge, merge never rebase, no sequencing advice.
- [x] T004 [AC4] Grep-sweep `skills/`, `AGENTS.md`, `README.md` and `wiki/` for any remaining statement that two runs must not change the same files; reword or remove any leftover, and record the searches and their returns.
- [ ] T005 [AC1][AC2][AC3][AC4] Run the gate through `verify.sh run .` and write `WORKHORSE-SUMMARY.md`.
