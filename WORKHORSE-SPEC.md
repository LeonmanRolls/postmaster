# Workhorse spec: #114 Pin runs to the dispatched postmaster version

## Summary

Each run will acquire a shared postmaster worktree at its dispatch commit, record and name that checkout as its tool, run every coachman leg from it, and release it after its run is fully terminal.

## Technical context

- **Language and version**: Bash and Python 3.11+, matching the existing scripts.
- **Dependencies used or added**: Git, Python standard library, and `flock`-style locking through Python's `fcntl`; no added dependency.
- **Testing**: `scripts/tool-pin.sh --self-test` exercises dispatch pinning, later-leg reads and execution after the source advances, sharing, and cleanup; `scripts/run-meta.sh --self-test`; the repository gate.
- **Constraints**: Keep the front door and postmaster supervision on the main checkout; pin run leg launches, resumes, takeovers, and their runbooks; preserve compatibility with existing waybills; use a worktree at the recorded commit; release only after the run is no longer in flight.

## Direction check

- Cut the pinned checkout as a Git worktree at the dispatch commit, share one managed checkout per commit, and put its absolute path in the waybill and `run.json`.
- Have the postmaster use the pinned checkout only for coachman leg launches, resumes, and takeovers; keep its own supervision on the front-door checkout.
- Coachmen resolve `<tool>` from the waybill, so all their scripts and subsequent workhorse launches use the pinned checkout. Existing waybills keep naming the main checkout and continue to work.
- Track one reference per active run. Release it after the final leg exits and Stage G closes the run, or after an abandoned run's processes and worktrees are stopped and removed. The managed checkout is removed when its last run reference is released.
- Make the post-dispatch behavior an executable positive and negative control in the new script's self-test.
- Update `AGENTS.md` to document per-run version pinning and retain the fixture-run quality rule for coachman contract changes.

## Structure

- Create `scripts/tool-pin.sh` for shared pin acquisition, terminal-run release, and the version-isolation control/self-test.
- Change `scripts/run-meta.sh` to acquire the pin and record its commit and path in `run.json`.
- Change `skills/postmaster/SKILL.md`, `skills/postmaster/postmaster.md`, and `skills/postmaster/coachman.md` to put the pinned path in each new waybill and use it for every run leg and its prompts.
- Change `AGENTS.md` to describe the pinned run lifecycle and remove the fleet-idle contract-change rule.
- Change `README.md` to list the pin manager and its self-test, and add that self-test to the run-local gate profile in `.postmaster/verify/spec.json`.

## Decisions

- Store managed worktrees under `~/.postmaster/tool-pins/<commit>` so runs across target projects can share them without putting their cache in a target repository.
- Treat the per-run reference created at dispatch as the in-flight count. A reference is released only after the manifest is `done` or `abandoned` and run processes have exited; the last released reference removes the checkout.
- Keep old waybills compatible by preserving their explicit `tool:` path behavior.
- Add no new external package; use standard library locking and Git worktree operations.
- The repository has no tracked gate builder; add the self-test to the waybill guidance and this run's verification profile.

## Tasks

- [x] T001 [P] [AC1] Add shared pin acquisition and persistence in `scripts/tool-pin.sh` and record the pinned commit/path in `scripts/run-meta.sh`.
- [x] T002 [AC1] [AC2] Update `skills/postmaster/SKILL.md` and `skills/postmaster/postmaster.md` to write the pinned path into waybills and route run-leg launch, resume, and takeover through it while keeping supervision on the main checkout.
- [x] T003 [P] [AC2] Update `skills/postmaster/coachman.md` so each leg's prompts and script calls use the waybill's pinned tool and preserve compatibility with old waybills.
- [x] T004 [AC3] Add positive and negative dispatch-version controls for later-leg runbook reads and script execution to `scripts/tool-pin.sh --self-test`.
- [x] T005 [AC4] Track run references and release the shared checkout after terminal teardown in `scripts/tool-pin.sh` and `skills/postmaster/postmaster.md`.
- [x] T006 [AC5] Update `AGENTS.md` to state that a run uses its dispatched version and remove only the fleet-idle restriction, retaining the fixture-run contract-quality requirement.
- [x] T007 [AC1] Add `scripts/tool-pin.sh --self-test` to the waybill project-profile guidance in `skills/postmaster/SKILL.md` and the run-local gate profile in `.postmaster/verify/spec.json`; check for a tracked gate builder and update one if present.
