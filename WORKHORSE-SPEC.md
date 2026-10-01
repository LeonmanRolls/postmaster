# Workhorse spec: #200 Confine lanes with sandbox-runtime

## Summary

Run every lane launch, resume and review through a version-pinned sandbox-runtime policy while keeping each harness command and its bypass flag intact.

## Technical context

- **Language and version**: TypeScript on Bun for changed scripts; the copied two-line Bash entry points only invoke Bun.
- **Dependencies used or added**: sandbox-runtime (`srt`) version `0.0.77`, installed outside the repository for development and required on `PATH` when confinement is on. No new repository runtime dependency.
- **Testing**: `bun test scripts/launch.test.ts scripts/run-meta.test.ts scripts/project-settings.test.ts scripts/lib/confinement.test.ts scripts/lib/text.test.ts`; `scripts/launch.sh --self-test`; the worktree gate and `<tool>/scripts/verify.sh run .`; a branch-pinned `scripts/fixture.sh new` run followed by `scripts/fixture.sh score` with every lane confined. The launch self-test uses the real `srt` executable and a plain shell, with unconfined controls.
- **Constraints**: Work only in this worktree; copy the #109 port unchanged in its own commit before modifying TypeScript; preserve harness arguments and bypass flags; read the recorded config under `--run`; do not change setup, Landlock, shared-clone or macOS-trial work; do not read the wiki, raw trial files or other lanes.

## Direction check

| Constraint | Plan |
|---|---|
| Wrap from outside through one path, with no operating-system branch | `launch.ts` builds the existing harness command, then one edge function invokes `srt --settings <file> -- <command>` for a lane. Launch, resume and review use it. The harness's own flags remain in `buildForms`. |
| Preserve useful lane access | A pure policy builder allows the lane's physical worktree, its shared git directory with the exceptions below, its own temp and harness state, its prompt, its named final-message file, the pinned tool, the harness install and the `srt` install. It sets `TMPDIR` and `CLAUDE_CODE_TMPDIR` to that lane's temp directory. |
| Enforce isolation | Deny reads from the home directory before reallowing named paths; write access is an explicit list. Keep Unix sockets disallowed, use sandbox-runtime's process isolation, and allow only documented API and project hosts. Check effects on the host disk because a denied write can report success inside the sandbox. |
| Protect shared git metadata | Resolve `git rev-parse --git-common-dir`, allow git's required writes there, and put its `config` and `hooks` paths in `denyWrite`. The self-test checks direct edits and replacement attempts against both. |
| Pin the research-preview runtime | One constant names version `0.0.77`. `run-meta.ts` records the selected mode and version at dispatch; `launch.ts` requires the recorded version on every run launch and resume and checks the executable before spawning. A missing, wrong-version or unusable runtime exits 1 without starting the harness. |
| Keep machine and project decisions separate | Top-level machine `confine` is `on` or `off`, absent meaning `off`. A shared or local project `[network].allowed_hosts` list adds gate hosts to the harness profile. The dispatch record freezes the effective config and project list. |
| Keep deterministic rules in scripts and harness details in the adapter | Policy validation and assembly live in TypeScript. `harnesses.md` lists each harness's allowed paths and hosts; `coachman.md` states lane capability and staging guidance, without copying the wiki's rationale. Any script path added to a runbook goes through `<tool>`. |
| Test the coachman contract before landing | Run the branch's gate, then dispatch and score a fixture run from this branch with `confine = "on"` for every lane. |

## Structure

First copy these files **unchanged** from `c70e592819302001e8ef3a358781a9ca4b5b5232` and commit the copy alone:

- `scripts/launch.sh`, `scripts/launch.ts`, `scripts/launch.test.ts`
- `scripts/run-meta.sh`, `scripts/run-meta.ts`, `scripts/run-meta.test.ts`
- `scripts/project-settings.sh`, `scripts/project-settings.ts`, `scripts/project-settings.test.ts`
- `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `scripts/lib/text.ts`, `scripts/lib/text.test.ts`, `scripts/fixtures/text-goldens.json`
- `types/bun.d.ts`, `bunfig.toml`, `package.json`, `tsconfig.json`, `bun.lock`, `biome.json`, `.oxlintrc.json`

Then change `scripts/launch.ts` and its adjacent test, `scripts/run-meta.ts` and its adjacent test, `scripts/project-settings.ts` and its adjacent test, `package.json` if needed to retain `bun run lint`, `project.example.toml`, `skills/postmaster/harnesses.md` and `skills/postmaster/coachman.md`. Add `scripts/lib/confinement.ts` and `scripts/lib/confinement.test.ts`. `WORKHORSE-SPEC.md` is the intent record; `WORKHORSE-SUMMARY.md` is written last after implementation.

## Decisions

- Only names in the recorded or live `[lanes]` table are confined. `review` is a lane launch. Coachman and postmaster commands keep their existing behavior. All seven harnesses that `launch.ts` can start get a profile; an unrecognized harness fails closed when confinement is on.
- The launch creates a private per-run, per-lane temp directory under the machine's postmaster data directory and a per-lane package cache there. The policy reopens only that directory; other lanes' temporary files stay behind the home read deny. The trusted launcher creates the sandbox settings file there before spawning.
- The policy uses real paths. It opens only the exact prompt file and, when present, the exact final-message file outside the worktree. It creates the final-message file before invoking `srt`; the lane cannot write the surrounding dispatch directory.
- Base network access is the harness's documented API hosts plus `registry.npmjs.org` and `github.com`. The project list adds exact hostnames or `*.` subdomains, optionally with a port; bare `*`, URLs, paths and malformed values are refused. Shared and local project host lists are added together, not substituted for each other. Hosts named in an alternate backend's environment file must be declared by the project.
- Pi's `provider/model` selects a narrow provider host set rather than opening every provider's hosts at once. The implementation will record the real provider endpoints it supports in `harnesses.md`; a custom provider uses explicit project hosts. Grok and agy get their own documented profiles and the same confinement controls as the five trialled harnesses.
- Without `--run`, the launch reads the live machine config and inspects the project rooted at its worktree for additional hosts. With `--run`, it reads only the recorded config and project settings, so later edits do not change the run's policy.
- A run record has an explicit `confinement` object with `mode` and `sandbox_runtime_version` (`null` when off). The recorded `config.confine` remains the source of the mode under `--run`; disagreement between the two fails. An older run without the object is accepted only when its recorded config resolves to off.
- The port's removed `--self-test` entry points need TypeScript compatibility dispatch so the BASE gate still invokes meaningful tests. `launch.sh --self-test` runs the real confinement battery; `run-meta.sh` and `project-settings.sh` dispatch their adjacent Bun tests. The copied wrappers remain two-line Bun invocations.
- Each control uses a disposable repository, sibling lane and reviewer scratch, a private home marker, an outside Unix socket and an outside process. For each denied operation, the identical unconfined command first succeeds; the confined command then fails or leaves no host-side effect. Allowed operations also run both ways. Network controls use a local server so an unrelated public outage cannot make a denial look correct.

## Tasks

- [ ] T001 [P] [AC1] Copy the exact #109 files listed above with `git show` and commit that copy alone.
- [ ] T002 [AC1] Add the single sandbox-runtime wrapping path for lane `launch`, `resume` and `review` in `scripts/launch.ts`, preserving `buildForms` and bypass arguments.
- [ ] T003 [AC2] Build allowed filesystem paths, private temp, prompt and final-message handling, package cache and harness profiles in `scripts/lib/confinement.ts`; test each profile beside it.
- [ ] T004 [AC3] Enforce home read denial, worktree and scratch isolation, Unix socket and process isolation, and network allowlisting in `scripts/lib/confinement.ts` and `scripts/launch.test.ts`.
- [ ] T005 [AC4] Resolve the shared git directory and deny writes to its `config` and `hooks` in `scripts/lib/confinement.ts`; test direct and replacement writes.
- [ ] T006 [AC5] Validate and merge `[network].allowed_hosts` in `scripts/project-settings.ts`, test it in `scripts/project-settings.test.ts`, record it at dispatch, and document the setting in `project.example.toml` and the harness allowlists in `skills/postmaster/harnesses.md`.
- [ ] T007 [AC6] Make `scripts/launch.sh --self-test` run a plain shell through real confinement with positive and negative controls for every allowed and forbidden capability in criteria 2 through 4.
- [ ] T008 [AC7] Parse top-level `confine` from the live or recorded config, default absence to off, fail closed with a named missing prerequisite, and record the selected mode in `scripts/run-meta.ts` with adjacent tests.
- [ ] T009 [AC8] Record the pinned sandbox-runtime version in `run.json`; reject missing, mismatched or unstartable runtime on every confined launch and resume, with tests in `scripts/run-meta.test.ts` and `scripts/launch.test.ts`.
- [ ] T010 [AC9] Install `0.0.77` in session scratch for testing, run the worktree gate and `<tool>/scripts/verify.sh run .`, then dispatch and score a branch-pinned fixture with all lanes confined.
- [ ] T011 [AC10] Update the Lane capability section of `skills/postmaster/coachman.md` and the operational tables in `skills/postmaster/harnesses.md`; run `scripts/skill-refs.sh` after the runbook edit.
