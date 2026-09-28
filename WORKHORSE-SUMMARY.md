# Workhorse summary: 18 a project's .postmaster/ holds its settings and every run's record

## What I built

Commits on `wb/18-mimo`:

1. `ff696d3` — workhorse spec for project `.postmaster/` settings and run record
2. `f0c871f` — project settings reader, with the shared and local shapes
   - `scripts/project-settings.sh` (new): reads `.postmaster/project.toml` and `settings.toml` under the precedence, refuses a credential or a filesystem path in either, writes the local file, `init` creates the folder and its `.gitignore`
   - `project.example.toml` expanded: default turnpikes, tracker binding by name, risk surfaces, checks
   - `settings.example.toml` (new): role assignments and local overrides
3. `0390c25` — a project's settings say what `default` means for its turnpikes
   - `scripts/turnpikes.sh`: `resolve`/`short` take `--project` and expand `default` from that project's declared set
   - `scripts/ticket-check.sh`: passes the repo through so `default` resolves per project
4. `19b12d2` — run artifacts live at `<project>/.postmaster/runs/`
   - `scripts/log-action.sh`: project name from the project root (old `runs/<project>/<TICKET>` layout still read)
   - `scripts/fixture.sh`: no longer refuses a basename that already has runs (the collision is gone by construction)
   - `scripts/runs-status.sh`, `scripts/discover-project.sh` (`postmaster_dir=`, `postmaster_shared=`, `postmaster_local=`)
   - `skills/postmaster/{SKILL,postmaster,coachman}.md`: new run root; each lane's durable session exported into `<dispatch>/audit/<lane>-session.*`
5. `27124a4` — project settings, precedence, this repo's `.postmaster/`, docs
   - `AGENTS.md`: design rule 1 softened with its reason; precedence stated once; setup offers `.postmaster/` writes
   - `README.md`, `wiki/concepts/project-settings.md` (new), `wiki/concepts/{turnpikes,verification}.md`, `wiki/index.md`
   - this repo's `.postmaster/project.toml` (force-added: checks, default turnpikes, risk surfaces) and its `.gitignore` (`*`)
   - `scripts/run-meta.sh`, `scripts/tool-faults.sh`: project name from the project root
6. `e6dcad7` — keep `POSTMASTER_VERIFY` out of verify.sh's self-test
   - A pre-existing leak: `verify.sh run` points checks at the armed copy through that variable, and `verify.sh --self-test` inherited it, so `journey-path` resolved the caller's worktree. The self-test builds its own worktrees and now unsets it.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed just before this summary:

```
gate: pass, exit 0, 282s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

- gate [default:gate] `bash -c 'for f in scripts/*.sh; …'` — exit 0 (above)

Other commands run, with exit:

- `scripts/project-settings.sh --self-test` — exit 0 (20 controls)
- `scripts/turnpikes.sh --self-test` — exit 0 (all controls, including the project default set)
- `scripts/ticket-check.sh --self-test` — exit 0
- `scripts/log-action.sh --self-test` — exit 0 (including the old-layout project name)
- `scripts/run-meta.sh --self-test` — exit 0
- `scripts/runs-status.sh --self-test` — exit 0
- `scripts/fixture.sh --self-test` — exit 0 (39 controls)
- `scripts/skill-refs.sh` — exit 0
- `scripts/wiki-lint.sh` — exit 0
- `scripts/discover-project.sh .` — exit 0; `postmaster_dir=yes postmaster_shared=yes postmaster_local=no`
- `scripts/project-settings.sh . validate` — exit 0
- `scripts/verify.sh --self-test` with `POSTMASTER_VERIFY` set — exit 0 after `e6dcad7`
- `bash -n` on every `scripts/*.sh` — exit 0 (part of the gate)

Earlier gate attempts under load each lost one control in a script this change does not own (`link-skills`, `review-round`); those controls pass alone. The `verify.sh` journey-path failure was reproducible and is fixed in `e6dcad7`.

## Decisions

- **Local settings filename is `settings.toml`.** Shared stays `project.toml`. Two names, one role each.
- **`.postmaster/.gitignore` is `*`.** Nothing is committed by default, settings included. Sharing is `git add -f .postmaster/project.toml`. `project-settings.sh init` and `write-local` create the folder with that gitignore.
- **Run root is `<project>/.postmaster/runs/`**, ledger beside the run directories. `log-action.sh` already wrote `../ledger.jsonl` from the dispatch dir; only its `project` field needed to stop reading the basename of `runs/`.
- **Project name in the ledger** is the basename of the project root. An older `runs/<project>/<TICKET>` layout is still read as that project, so a run already in flight is not disrupted by the reader.
- **No path or credential in either settings file.** `project-settings.sh` refuses keys named for one and path-like values in name fields. Check `command` strings are opaque shell the project runs (already the verification contract from #56) and are not "naming a path on the machine".
- **Role assignments live only in local `settings.toml`.** They name lanes the machine config defines; the shared file never carries them (`project-settings.sh` refuses).
- **`default` turnpikes** may be declared in either file; local wins. `turnpikes.sh resolve`/`short` take `--project` and fall back to the table's marks. Never a floor.
- **Tracker binding is a name only** (`board` / `workspace` / `team`). No URL, no path, no credential.
- **Risk surfaces** are short strings (prose may mention a path; a name field may not).
- **Session export** is the coachman's audit step: each workhorse's durable session into `<dispatch>/audit/<lane>-session.*` per `harnesses.md`.
- **No migration** of in-flight runs. Documented in the runbooks.
- **The `POSTMASTER_VERIFY` leak in verify.sh's self-test** is fixed in this branch (`e6dcad7`) because the gate runs `verify.sh --self-test` under `verify.sh run`, and without the fix the gate cannot pass. It is a one-line unset in the self-test, not a behaviour change for any run.

## Not done, and why

- **No fixture run.** This change does not touch the coachman contract (markers, waybill shape, the turnpike table, completion detection). The dispatch path is given to the coachman in the waybill; the turnpike names and legs are unchanged. Scripts and prose do not need the fleet quiet.
- **`project-settings.sh` is not in the waybill's 31-script self-test list** (that list was fixed at BASE). It has its own self-test, run above, and is named in this repo's declared `checks.gate` for future runs.
- **Local settings do not override checks.** Checks are what the project requires (shared file). Local holds roles and this person's answer to the same project questions. Adding check overrides was not asked for.

## Acceptance criteria

1. **Met.** A project may carry `.postmaster/` with settings in the shape of `project.example.toml` / `settings.example.toml`, and the flow reads it (`project-settings.sh`, `turnpikes.sh --project`, `verify.sh` checks). A project without one behaves as today: `has` reports `any=no`, `get` prints nothing, discovery still runs.
2. **Met.** `project-settings.sh` refuses a credential or a filesystem path in either file (keys named for one, path-like values in name fields). Controls cover both.
3. **Met.** The folder holds role assignments (`settings.toml`), default turnpikes, tracker binding by name, risk surfaces (`project.toml`), and every run's record under `runs/`: ledger, narrative, cards, `logs/` events streams, and `audit/<lane>-session.*` exported at harvest.
4. **Met.** Nothing in `.postmaster/` is committed by default; the folder's `.gitignore` is `*`. This repo force-adds only `project.toml`. A checkout that never ran looks like one that has.
5. **Met.** Sharing is one documented file: `project.toml`, committed with `git add -f`. It carries turnpikes default, tracker binding by name, risk surfaces and checks. It may not carry a credential, path, machine name or role assignment — the reader refuses each.
6. **Met.** The normal case is no file at all. A missing settings file is never an error and never a prompt.
7. **Met.** Precedence is stated once (AGENTS.md, pointed at from the examples and the wiki) and followed in `project-settings.sh`. No floor of turnpikes: a ticket names its own; project settings only say what `default` means.
8. **Met.** Run artifacts are at `<project>/.postmaster/runs/`. `log-action.sh`, `runs-status.sh`, `fixture.sh`, `run-meta.sh`, `tool-faults.sh` and the runbooks follow. In-flight runs under the old layout are not migrated; the reader still names them correctly.
9. **Met.** AGENTS.md and SKILL.md tell the agent to offer a project decision for `.postmaster/` on agreement, naming which file it proposes (shared `project.toml` vs local `settings.toml`).
10. **Met.** `discover-project.sh` prints `postmaster_dir=`, `postmaster_shared=` and `postmaster_local=`, so a waybill can say which facts were discovered and which were declared.

This repo carries its own `.postmaster/` (`project.toml` force-added: checks, default turnpikes, risk surfaces) as the first test of it. The design rule 1 softening is recorded in AGENTS.md beside the rule.
