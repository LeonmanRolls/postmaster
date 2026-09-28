# Workhorse spec: #18 Project-local settings and run artifacts

## Summary

Add optional project-local settings and shared project declarations, keep run records under each project, and resolve project facts with the ticket's stated precedence while refusing paths and credentials in project files.

## Technical context

- **Language and version**: Bash and Python 3.11+, matching the existing scripts.
- **Dependencies used or added**: Python's `tomllib`; no new dependencies.
- **Testing**: the ticket's gate, including self-tests for changed scripts; targeted self-tests for project settings, precedence, ignored files, artifact paths and discovery output; `/home/brindlewick/postmaster/scripts/verify.sh run .` after all changes are committed.
- **Constraints**: remain in this worktree; commit the spec by itself first; never push; keep the project profile optional; ignore all of `.postmaster/` by default; shared declarations must be narrow and contain no machine-specific data; do not migrate existing machine-level run records.

## Direction check

- Project settings are optional; absent files continue through discovery with no creation prompt.
- Keep machine config machine-specific. A project's local role choices select machine-defined lanes and do not replace machine credentials, harness setup, or other machine-only values.
- Use one documented shared file, `.postmaster/project.toml`, for project requirements only. Keep per-machine choices in ignored `.postmaster/settings.toml`.
- Validate shared and local project files before use. Reject credential-like fields and filesystem paths, including absolute, home-relative, and parent-relative values.
- Store the full run record under `<project>/.postmaster/runs/`; leave old `~/.postmaster/runs/` contents untouched.
- Update scripts and runbooks where they read project facts, dispatch roles, or create and poll run artifacts. Do not make project defaults a floor of turnpikes.
- The ticket deliberately softens design rule 1: optional project files preserve discovery as the normal path while allowing explicit project decisions and corrections to survive a run. This adds a place to record what discovery cannot infer; it does not make a project file required.

## Structure

- Add a central project-settings reader/validator and extend project discovery and consumers.
- Extend `project.example.toml` and add a local settings example or documented schema.
- Move run-root creation and ledger writes into `<project>/.postmaster/`, updating logging/status scripts and runbooks.
- Add `.postmaster/.gitignore` and a shared profile for this repository that demonstrates declared project facts.
- Update setup guidance, README, and the affected postmaster/coachman/wiki runbooks.
- Add script self-tests for accepted and rejected profiles, precedence, discovery, ignored artifacts, and distinct project paths.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Design rule 1 now permits optional project-local files. | The ticket names decisions discovery cannot infer and requires corrections to survive across runs. | Keeping everything in discovery or machine config cannot preserve project requirements across machines; making files mandatory would contradict the normal case and acceptance criterion 6. |

## Decisions

- Use `.postmaster/project.toml` for the shared, opt-in declaration and `.postmaster/settings.toml` for ignored, machine-local choices; this preserves the existing shared filename and separates scope by file.
- Shared role assignments are forbidden. Local role assignments may select names already defined by the machine config; they cannot introduce harness credentials, env-file references, or filesystem paths.
- Project turnpikes describe only the meaning of `default`; each ticket still names the run's turnpikes.
- Preserve the existing local tracker store rule. A project binding selects tracker identity by a safe name; connection details and credentials remain machine-side.
- Create this repository's `.postmaster/` with a complete ignore rule and a shared declaration demonstrating project-owned facts; do not commit local settings or run artifacts.
- Do not migrate existing runs. A new dispatch uses the project path directly, so equal basenames cannot collide.

## Tasks

- [ ] T001 [P] [AC1] Implement optional shared and local project profile parsing and validation in `scripts/project-settings.sh`; extend `project.example.toml` and document the local settings shape.
- [ ] T002 [P] [AC2] Reject credential fields and machine filesystem paths in both profile files, with positive and negative self-tests.
- [ ] T003 [P] [AC3] Support project role assignments, default turnpikes, tracker binding and risk surfaces; preserve complete per-run records under the project's `.postmaster/runs/`.
- [ ] T004 [P] [AC4] Add `.postmaster/.gitignore` and checks that local choices and run artifacts remain ignored while shared declarations are added only explicitly.
- [ ] T005 [AC5] Restrict shared `project.toml` to project-owned declarations and existing check declarations; reject roles, paths, credentials and machine identity.
- [ ] T006 [AC6] Keep missing project files optional, retain discovery behavior, and do not prompt to create settings when no decision is being recorded.
- [ ] T007 [AC7] Apply discovery/shared/local/machine precedence in launch, front-door, tracker resolution, checks and waybill generation without imposing turnpike floors.
- [ ] T008 [AC8] Move run-root creation, action ledger writes and status polling from machine-level basename roots to project-local path roots; leave old roots untouched.
- [ ] T009 [AC9] Update setup conversation runbooks to offer local settings or the shared declaration when a project decision is made, and write only after agreement.
- [ ] T010 [AC10] Report shared/local profile presence and declared versus discovered facts from `scripts/discover-project.sh`, and update runbooks and README to match.
