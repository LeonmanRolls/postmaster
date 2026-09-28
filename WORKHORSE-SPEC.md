# Workhorse spec: 18 a project's .postmaster/ holds its settings and every run's record

## Summary

Give every target project an optional `.postmaster/` folder that holds its own settings
(shared `project.toml` plus local `settings.toml`) and every run's full record under
`runs/`, with the folder carrying a `.gitignore` that commits nothing by default. Move run
artifacts off `~/.postmaster/runs/<basename>/` so two projects with the same basename no
longer share a ledger, state the precedence once (discovery → shared → local → machine),
and have discovery and setup read and write the folder. This repo grows its own
`.postmaster/` as the first test.

## Technical context

- **Language and version**: bash scripts with Python 3.11+ in heredocs (the repo's existing pattern); TOML for settings
- **Dependencies used or added**: none; `tomllib` from the stdlib, already used by `verify.sh`
- **Testing**: the project gate (`bash -c 'for f in scripts/*.sh; do bash -n "$f" …'` and each script's `--self-test`), plus targeted self-tests on `project-settings.sh`, `turnpikes.sh`, `log-action.sh`, `discover-project.sh`
- **Constraints**:
  - A project without `.postmaster/` behaves exactly as today: nothing demanded, discovery still runs
  - No setting may name a credential or a filesystem path on the machine (shared or local)
  - The shared file may carry only default turnpikes, tracker binding by name, risk surfaces, and checks (already there); never a credential, path, machine name or role assignment
  - Nothing in `.postmaster/` is committed by default; sharing is one file, opt-in
  - Precedence: discovery defaults; shared file; local settings; machine config, never overridden by a project
  - No floor of turnpikes: a ticket names its turnpikes; project settings only say what `default` means
  - Run artifacts move to `<project>/.postmaster/runs/`; in-flight runs under the old layout are not migrated
  - Softens design rule 1 deliberately; the reason is recorded with it
  - This repo grows its own `.postmaster/` as part of the work

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Optional folder; nothing demanded | `project-settings.sh` treats a missing folder as empty; no script fails without it; discovery unchanged in behaviour |
| No credential or filesystem path | The settings schema has no path/credential keys; `project-settings.sh` refuses path-like values and unknown keys |
| Holds roles, turnpikes default, tracker binding, risk surfaces, run record | `settings.toml` (roles), `project.toml` (turnpikes, tracker, risk, checks), `runs/` (ledger, narrative, cards, events, exported sessions) |
| Nothing committed by default | `.postmaster/.gitignore` is `*`; shared file is `git add -f` only |
| Sharing is one narrow file | `project.toml` alone; documented in `project.example.toml` and the wiki |
| Normal case is no file | Missing settings is not an error and not a prompt |
| Precedence stated once | `AGENTS.md` design-rule note + `project.example.toml` header + `project-settings.sh` implements it |
| No turnpike floor | `turnpikes.sh resolve/short` expand `default` from project settings when present; the table's marks remain the discovery default |
| Run artifacts move | New path `<project>/.postmaster/runs/`; `log-action.sh`, `runs-status.sh` docs, `fixture.sh`, runbooks follow |
| Setup writes local settings | `AGENTS.md` / `SKILL.md` front-door steps offer `.postmaster/` writes on agreement |
| Discovery reports the folder | `discover-project.sh` prints `postmaster_dir=` and settings presence |
| Design rule 1 softening recorded | `AGENTS.md` design-rule 1 gains the reason |
| This repo grows its own `.postmaster/` | Committed `project.toml` (force-added) + local `.gitignore` |

## Structure

- `project.example.toml` — expand: turnpikes, tracker binding, risk surfaces, checks (existing), precedence and the no-path/no-credential rule
- `settings.example.toml` — new: local settings shape (role assignments and local overrides)
- `scripts/project-settings.sh` — new: read/validate/write project settings with precedence; self-test
- `scripts/turnpikes.sh` — `default` expands from project settings when the project declares one
- `scripts/ticket-check.sh` — pass the repo's default turnpikes through to `turnpikes.sh`
- `scripts/log-action.sh` — project name from the project root, not the basename of `runs/`
- `scripts/runs-status.sh` — usage text names the new run root
- `scripts/discover-project.sh` — report `postmaster_dir=` and which settings files exist
- `scripts/fixture.sh` — run root under the fixture repo, not `~/.postmaster/runs/`
- `skills/postmaster/SKILL.md`, `postmaster.md`, `coachman.md` — new run root; session export into the run record; setup offers `.postmaster/` writes
- `AGENTS.md` — design rule 1 softened with its reason; precedence; front-door offers project settings
- `README.md` — `.postmaster/` layout and precedence
- `wiki/concepts/project-settings.md` — new concept: what a project's `.postmaster/` is for
- `wiki/concepts/verification.md`, `wiki/concepts/turnpikes.md` — point at the settings now that #18 lands
- `.postmaster/` (this repo) — `.gitignore` (`*`) and `project.toml` (this project's declarations), force-added

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| None | — | — |

## Decisions

1. **Local settings filename is `settings.toml`.** Shared stays `project.toml` (already the declared name). Two names, one role each, no union file.
2. **`.postmaster/.gitignore` is `*`.** Nothing is committed by default, settings included. Sharing is `git add -f .postmaster/project.toml`. A checkout that never ran looks identical to one that has.
3. **Run root is `<project>/.postmaster/runs/`** with `ledger.jsonl` beside the run directories, same relative shape as today. `log-action.sh` already writes `../ledger.jsonl` from the dispatch dir; only its `project` field needs to stop reading the basename of `runs/`.
4. **Project name in the ledger** is the basename of the project root (`.postmaster`'s parent), so two checkouts of the same basename still name themselves honestly in their own ledgers; the collision the ticket names is gone because the directories are path-keyed.
5. **Settings schema forbids path-like and credential-like values** in every name field (absolute paths, `~/`, `key=value` secrets). Check `command` strings are opaque shell the project runs and are not "naming a path on the machine"; they are already the verification contract.
6. **Role assignments live only in local `settings.toml`.** They name lanes from the machine config (`workhorses`, `reviewers`) and may name a coachman by harness/model; the machine config still defines the lanes. The shared file never carries them.
7. **`default` turnpikes** may be declared in either settings file as a list of turnpike names. Precedence applies: shared, then local, else the table's marks in `turnpikes.sh`. `turnpikes.sh resolve`/`short` take an optional `--project` and read that set.
8. **Tracker binding is a name only** (`board` for github, `workspace` for plane, `team` for other). No URL, no path, no credential. The machine config still supplies the kind and any URL.
9. **Risk surfaces** are a list of short strings (or one multi-line string) naming what the project binds, allowlists, spawns and serves. They feed the security lens via the waybill, as today's discovered/asked value does.
10. **Session export** is added to the coachman's audit step: each workhorse's durable session is exported into `<dispatch>/audit/<lane>-session.*` per the harness adapter's export form. Events streams already live in `<dispatch>/logs/`.
11. **No migration** of in-flight runs. The old path is simply no longer written. Documented in the runbooks.
12. **This repo's `.postmaster/project.toml`** declares its checks (the real gate), its default turnpikes (`style, bug, security`, matching the table), its tracker binding (`board = "postmaster"` is wrong here — this repo's tracker is github issues on its own board, named by discovery; I'll declare nothing for tracker unless we know it) and its risk surfaces (from the brief). Force-added so it is the shared file.
13. **The design-rule-1 softening** is recorded in `AGENTS.md` beside the rule, not only in the wiki: the rule is what every agent reads.

## Tasks

- [x] T001 [P] [AC4] `.postmaster/.gitignore` with `*`, created whenever `.postmaster/` is created; document it in `project.example.toml` and `settings.example.toml`
- [x] T002 [P] [AC1] [AC2] [AC5] [AC7] `scripts/project-settings.sh`: read shared + local settings, enforce the schema (no credential/path), apply precedence, answer queries, write local settings; self-test
- [x] T003 [AC1] [AC5] [AC7] Expand `project.example.toml` (turnpikes, tracker binding, risk surfaces, checks) and add `settings.example.toml` (roles, local overrides)
- [x] T004 [AC7] `scripts/turnpikes.sh`: `default` expands from project settings when declared; `--project` flag; self-test covers the override
- [x] T005 [AC7] `scripts/ticket-check.sh`: pass the repo's default turnpikes to `turnpikes.sh`
- [x] T006 [AC8] `scripts/log-action.sh`: project field from the project root; docs name the new run root
- [x] T007 [AC8] `scripts/runs-status.sh`, `scripts/fixture.sh`: new run root; fixture no longer keys on basename
- [x] T008 [AC3] [AC8] Runbooks (`SKILL.md`, `postmaster.md`, `coachman.md`): `<project>/.postmaster/runs/`; session export into the run record; no migration note
- [x] T009 [AC9] `AGENTS.md` + `SKILL.md`: setup offers `.postmaster/` writes (shared vs local, said which); design rule 1 softened with its reason; precedence stated once
- [x] T010 [AC10] `scripts/discover-project.sh`: report `postmaster_dir=` and which settings files exist
- [x] T011 [AC1] [AC5] `README.md` + `wiki/concepts/project-settings.md`: the folder, the two files, precedence, what is forbidden
- [x] T012 [AC3] This repo's own `.postmaster/`: `.gitignore` and `project.toml` (checks, turnpikes default, risk surfaces), force-added
- [x] T013 [AC1] [AC2] Gate and self-tests pass; `wiki-lint` clean
