# Workhorse spec: #108 Keep the front-door session as postmaster

## Summary

The front door will continue in the current conversation when its reported harness and
model match `team.postmaster`, its working tree is the chosen target, and a person is at
the terminal; otherwise it will explain why it starts a separate postmaster session.

## Technical context

- **Language and version**: Bash with Python 3.11+ for TOML parsing, matching existing scripts.
- **Dependencies used or added**: Python standard library (`tomllib`, `pathlib`, `subprocess`); no added dependencies.
- **Testing**: `scripts/postmaster-route.sh --self-test`; the repository gate from the ticket.
- **Constraints**: Keep the waybill and coachman contract unchanged. Use `<tool>/scripts/...` paths in runbooks. Never push.

## Direction check

- The current conversation remains postmaster only when harness, model, target repository,
  and terminal presence all qualify; otherwise the launch card explains every reason for
  spawning.
- The routing decision is deterministic script behavior based on reported session values,
  the selected target, and the config.
- The self-test gives a triggering case and a non-triggering control for each spawn reason.
- Either route creates the same postmaster brief and logs its first postmaster action under
  `<runs>/postmaster/` before continuing or spawning.
- The entry flow remains outside the coachman contract; the waybill, markers, turnpikes,
  dispatch flow, and headless escalation behavior stay unchanged.
- No project paths, harness invocation details, or user identity are hardcoded.

## Structure

- `scripts/postmaster-route.sh`: classify the current session as `self` or `spawn`, explain
  the reasons, and exercise each reason with positive and negative controls.
- `AGENTS.md`: let the session carry on when the selected target is this repo.
- `skills/postmaster/SKILL.md`: report session details, choose self or spawn, record the
  confirmed launch, then continue in this conversation or start the configured session.
- `skills/postmaster/postmaster.md`: describe a postmaster that may be continued or spawned.
- `README.md`: describe the new front-door behavior.
- `WORKHORSE-SUMMARY.md`: record commits, verification, decisions, omissions, and AC verdicts.

## Complexity tracking

## Decisions

- Print all applicable spawn reasons so the launch card explains every failed condition,
  rather than hiding later reasons behind a priority order.
- Compare the Git top-level directories of the reported working directory and target, so a
  session in a subdirectory of the target repository still qualifies.
- Treat the person-at-terminal value as an explicit session report, since the script cannot
  infer whether a human is available from its process environment.
- Write the shared postmaster brief only after the user confirms the launch card; log a
  `note` as the first postmaster action before either continuing or spawning.

## Tasks

- [ ] T001 [P] [AC4] Implement `scripts/postmaster-route.sh` with config and git-root comparison, reason output, and per-reason positive and negative self-test controls.
- [ ] T002 [AC3] Update `skills/postmaster/SKILL.md` so the launch card says whether this session or a new one will be postmaster and why.
- [ ] T003 [AC1] Update `AGENTS.md` and `skills/postmaster/SKILL.md` to continue in the current conversation when all self conditions hold.
- [ ] T004 [AC2] Keep a spawned postmaster path for each mismatch, another target, or no person at the terminal.
- [ ] T005 [AC5] Have `skills/postmaster/SKILL.md` write the shared postmaster brief and first `log-action.sh` note before continuing or spawning.
- [ ] T006 [AC6] Update `skills/postmaster/postmaster.md` and `README.md` to remove the spawned-only assumption and stale front-door claims.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] [AC6] Run the script self-test and repository gate; write `WORKHORSE-SUMMARY.md` with evidence and per-criterion verdicts.
