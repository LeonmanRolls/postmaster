## Problem / feature

A project's own settings can only pick among the lanes the global config defines. They cannot choose a model, a key file or any other setting of the global config, and most steps never read them: who the postmaster is, the tracker and the clerk come from the global config alone. A project therefore cannot run with models or keys of its own, and a project with no global config cannot run at all.

Done: any setting in a project's own settings overrides the same setting of the global config for that project, wherever the flow reads it, and a project whose own settings are complete needs no global config. Settings a project shares through a file git tracks are used once the user has accepted them. This is the first slice of [#320, Setup asks for the target first, and a project's own settings override the global config](https://github.com/brindlewick/postmaster/issues/320), which holds the decisions it follows.

## Acceptance criteria

1. A project's own settings override the global config one setting at a time: a lane's model set there changes that model and nothing else.
2. Every step that works on a project reads its own settings over the global config: choosing the postmaster, each launch, the reviewers, the tracker, the run's record and the watcher.
3. A project whose own settings are complete runs with no global config.
4. When a file git tracks in the project overrides the global config, its settings are used only after the user has accepted them.
5. After that file changes, its settings are used only once the user accepts them again.
6. A fixture run from this change's final head scores clean.

## Out of scope

- Setup's order and steps, which the second, third and fourth slices of #320 change.
- A key itself in a settings file.
- A per-project setting for where projects live.
- A personal layer on top of a project's shared settings.
- A project's declared checks and risk surfaces, which are read as today.

## Direction

It lands before the third slice of #320, which needs it; the second and fifth can run beside it. It changes scripts on the coachman contract's list, so it lands only after a fixture run from its final head scores clean. A run keeps the settings it recorded at dispatch. Project settings files written before the change keep working. The precedence rule in the project's instructions and the settings examples change with it. Linux and macOS. Accepting shared settings protects against settings that arrive with a repository, not against a lane, which can already change the global config when it runs unconfined.

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

Each check runs in a scratch git repository, with a scratch global config named by `POSTMASTER_CONFIG`: `config.example.toml` with `team.postmaster` set to `{ harness = "claude", model = "opus-x" }`. "The project's settings file" is the person's own file in the repository's `.postmaster/`.

- **C1** The project's settings file holds `[lanes.luna]` `model = "gpt-other"` → `scripts/run launch form luna --project <repo>` prints `-m gpt-other` with luna's effort from the global config, `launch form deepseek --project <repo>` prints the global model, and the project's effective config differs from the global one in that value alone. A file setting `team.workhorses = ["mimo"]` gives exactly `["mimo"]`, and one setting `env_file` for a lane makes `launch form` look for that file. With the file gone, every value is the global one. **At the base:** `scripts/run project-settings effective <repo>` and `launch form luna --project <repo>` both exit 1 with `project-settings: local project settings has unsupported table or key: lanes`.
- **C2** The project's settings set `team.postmaster = { harness = "codex", model = "gpt-p" }`, `tracker.kind = "plane"`, `team.clerk`, `postmaster.poll_seconds = 30`, `limits.memory_max` and one lane's model → `scripts/run front-door codex gpt-p <repo> yes <repo>` prints `self`; `scripts/run tracker-kind <repo>` prints `plane`; the clerk's launch, the `run.json` that `scripts/run run-meta` writes for a dispatch in the project, the watcher's poll interval, a launch's limits outside a run and `scripts/run reviewers lines --project <repo>` each show the project's value. A test lists every script under `scripts/` whose code builds the global config's path, and finds only the shared loader. **At the base:** `front-door` → `spawn harness differs: this session runs on codex, team.postmaster names claude; model differs: this session runs on gpt-p, team.postmaster names opus-x`; `tracker-kind` → `github`; 13 scripts build the path themselves: `clerk`, `find-projects`, `front-door`, `host`, `launch`, `plane`, `probe-trackers`, `project-settings`, `reviewers`, `run-meta`, `runs-watch`, `setup` and `tracker-kind`.
- **C3** `POSTMASTER_CONFIG` names a missing file, and the project's settings file holds the whole scratch config → `front-door` decides, `launch form` prints each role's form, and `run-meta` writes the run's record. **At the base:** `front-door` → `front-door: no config at <path> (POSTMASTER_CONFIG overrides the path)`, exit 1; with the whole config as the project's file, `project-settings inspect` → `local project settings.projects_roots[0] names a filesystem path on a machine`, exit 1.
- **C4** The project's settings file sets one lane's model and is committed with `git add -f` → until the user accepts it, every reader in C2 uses the global value and says the file's settings wait for acceptance, naming the file; after the user accepts them, the project's value is used. An untracked settings file is used with no acceptance, and the project's declared checks file is read as before. **At the base:** a tracked file holding `[roles]` `workhorses = ["luna", "mimo"]` is read silently: `project-settings report` prints `project_local=yes` and `project_source.roles=local`, and `effective` gives `team.workhorses = ['luna', 'mimo']`, exit 0.
- **C5** After C4's acceptance, the tracked file is changed and committed again → its settings are not used until the user accepts them again, and the readers say so; the unchanged file needs no second acceptance. **At the base:** nothing records an acceptance, and a tracked file is read as it stands, as C4 shows.
- **C6** `scripts/run fixture new`, a run dispatched from this branch's final head, then `scripts/run fixture score` on the same branch → clean. **At the base:** no such run.

### Technical notes

- Decisions of #320 that bind this slice: D2, a project may commit its settings to share them; D5, a project's own settings can override any setting of the global config, models and key files included; D8, settings that a file git tracks uses to override the global config are used only after the user accepts them, and again after they change; D9, a project's settings are written like the global config and override it setting by setting, a group merging and a list or single value replaced whole. (C1, C2, C3, C4, C5)
- The shape and the merge are in [`scripts/project-settings.ts`](https://github.com/brindlewick/postmaster/blob/8baf5af/scripts/project-settings.ts#L516-L519): `validateCommon` lets the local file hold only `project`, `tracker` and `roles` (L516-L519), roles may only pick entries of the global config (L583), and `effectiveConfig` (L689-L745) applies roles alone. The merge is a pure function of two tables (design rule 8), in one loader under `scripts/lib/` that every reader imports (design rule 7). (C1, C2)
- The person's file loses the path and credential refusal of `scanMachineData` (L330-L373); the committed checks file keeps it. A `[roles]` table in an existing file keeps working, read as the `team` entries it names. (C1, C3)
- The readers, each building the path itself today: `front-door.ts` L38-L39; `launch.ts` L72-L73, which with `--project` already merges roles (L144-L160); `run-meta.ts` L1045-L1047, which records the effective config (L992-L998); `reviewers.ts` L255-L256; `clerk.ts` L63-L67; `tracker-kind.ts` L27; `plane.ts` L1018; `runs-watch.ts` L1671-L1676; `host.ts` L2443, for launch limits outside a run (inside one they come from `run.json`, L1613-L1628); `probe-trackers.ts` L11; `find-projects.ts` L45; `setup.ts` L141; `project-settings.ts` L828 and L876. `find-projects` keeps reading the global config alone, since it runs before a project is chosen. (C2)
- With no global config, the loader takes the project's file as the whole config; a reader that needs a config and finds neither says so, as `front-door` does today. (C3)
- Tracked means `git ls-files --error-unmatch` finds the settings file in the project's own repository; the global config is never tested this way. An acceptance can be kept beside the global config, keyed by the project and the file's content, so that a change asks again. Only the user accepts: the front door asks at the launch card, and no run, lane or script accepts on its own. A project's declared checks file is not covered. (C4, C5)
- Docs that change with it: AGENTS.md "Where a setting comes from" (L242-L252), `skills/postmaster/SKILL.md` "Optional project settings" (L152-L174), `settings.example.toml`, the precedence paragraph of `project.example.toml`, the header of `config.example.toml`, and the claim "never overridden by a project" in `wiki/concepts/project-settings.md`. (C1, C4)
- Contract files it touches include `launch.ts`, `run-meta.ts`, `host.ts`, `runs-watch.ts` and `SKILL.md`; `scripts/run coachman-contract` names them. (C6)

### Verified at 8baf5af9a13cae1dd788cc85b0bc0a30a501a396

- Each line range above was read at the base, and each **At the base** result was run there in a scratch repository with a scratch config.
- The 13 scripts are those whose code, outside comments, builds `.postmaster/config.toml` under the home folder. Two oracles, `fixture-time-oracle.ts` and `walls-oracle.ts`, name a `config.toml` in a temporary folder of their own and read no global config.

