# Workhorse spec: #75 Prevent duplicate run dispatches

## Summary

Add a read-only dispatch check that refuses an existing run directory or conflicting branch before Stage B writes anything, then have the postmaster show any refusal to the user.

## Technical context

- **Language and version**: Bash; Git CLI for branch refs.
- **Dependencies used or added**: Existing Bash and Git; no new dependencies.
- **Testing**: `scripts/dispatch-check.sh --self-test` demonstrates a clean pass and each refusal; `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` runs the project gate.
- **Constraints**: The guard is read-only. It checks `<repo>/.postmaster/runs/<TICKET>/`, branch `<TICKET>`, and every `wb/<TICKET>-*` branch before the first Stage B write. It reports all collisions and leaves any cleanup or id change to the user.

## Direction check

The ticket calls for a script at Stage B before the run directory is made; the runbook will call the guard before any Stage B write. A clash is returned to the user, who decides whether to archive or rename the old run, or choose another id; the postmaster will rename or remove nothing itself. The project keeps deterministic checks in scripts, and the runbook will invoke the script through `<tool>`. Work stays on this ticket branch, with no push.

## Structure

- Add `scripts/dispatch-check.sh` with a read-only `<repo> <ticket-id>` check and `--self-test`.
- Update `skills/postmaster/postmaster.md` to run the guard first in Stage B and surface its refusal to the user.
- Commit this spec alone before implementation.

## Complexity tracking

None.

## Decisions

- Treat local and remote-tracking branches as existing repository branches, report their names, and show every collision in one refusal.
- Use `dispatch-check.sh` as the script name and `<repo> <ticket-id>` as its interface.
- Use “Prevent duplicate run dispatches” as the spec title because the supplied ticket text did not include a tracker title.

## Tasks

- [ ] T001 [P] [AC1] Add the run-directory refusal to `scripts/dispatch-check.sh`.
- [ ] T002 [AC2] Detect and name the exact ticket branch and every `wb/<TICKET>-*` branch in `scripts/dispatch-check.sh`.
- [ ] T003 [AC3] Add `--self-test` controls for a clean pass, existing run directory, and conflicting branches in `scripts/dispatch-check.sh`.
- [ ] T004 [P] [AC4] Invoke `scripts/dispatch-check.sh` before any Stage B writes and send refusals to the user in `skills/postmaster/postmaster.md`.
