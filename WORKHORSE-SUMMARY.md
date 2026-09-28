# Workhorse summary: #18 Project-local settings and run artifacts

## Built

- Added optional shared .postmaster/project.toml and ignored local .postmaster/settings.toml, with schema checks that reject credentials, machine paths and machine identity. Discovery remains the fallback when either file is absent.
- Applied project settings to turnpike resolution, role selection, tracker bindings, launch forms, check validation, run metadata and setup conversation guidance. discover-project.sh reports which facts are discovered, shared or local.
- Moved ledgers and run artifacts under <repo>/.postmaster/runs/, keyed by the canonical project path. Run metadata records that path and its settings sources; harness event streams and exported durable sessions stay with each run.
- Added the folder-wide ignore rule, shared and local examples, and a shared profile for this repository with its gate, default turnpikes and risk surfaces.
- Made turnpikes.sh --list independent of project settings, removed POSTMASTER_PROJECT before settings validation queries the turnpike catalogue, and added a bounded recursion regression control.
- Updated scripts, tests, README and runbooks for the project-local paths, precedence, setup and sharing rules.

## Commits

Implementation commits on the branch before this summary commit:

- dd547e8 — #18, define project settings work
- fc184d0 — #18, bound project settings turnpike lookup
- 2c719f4 — #18, update turnpike fixtures for project runs
- ce10ed9 — #18, export durable sessions into project runs
- 516f049 — #18, apply project settings across flow
- 22cc1fa — #18, isolate GitHub binding fixture
- c093aae — #18, store run records by project path
- 2fadc4f — #18, allow generated paths in project checks
- 27de6d5 — #18, create fixture run roots after repos
- 61abc00 — #18, document project settings and run roots
- 911de7e — #18, record completed workhorse tasks
- de1f8e5 — #18, isolate target imports in readers
- da87a2d — #18, move review-round fixtures into project runs
- 86c9dc0 — #18, update remaining run-path fixtures
- d5fe71c — Apply the host.sh stop fix from #117
- ddc304e — #18, isolate verifier self-test environment

The branch also contains d5fe71c, the #117 host fix; it is included here because it is in this branch’s history. Its author and committer match the repository identity rules.

## Checks

- Required command /home/brindlewick/postmaster/scripts/verify.sh run . — exit 0.
- It printed this final line immediately before this summary was written:
  > gate: pass, exit 0, 374s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
- Brief check gate [default:gate] — command: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done' — exit 0 as part of the required command.
- timeout 10 env POSTMASTER_PROJECT="$PWD" scripts/project-settings.sh inspect "$PWD" — exit 0.
- timeout 10 scripts/discover-project.sh "$PWD" — exit 0.
- scripts/verify.sh checks . --lines — exit 0.
- scripts/skill-refs.sh and git diff --check — each exit 0.
- Targeted self-tests, each with exit 0: scripts/project-settings.sh --self-test, turnpikes.sh --self-test, ticket-check.sh --self-test, github.sh --self-test, plane.sh --self-test, reviewers.sh --self-test, run-meta.sh --self-test, log-action.sh --self-test, runs-status.sh --self-test, fixture.sh --self-test, export-session.sh --self-test, launch.sh --self-test, host.sh --self-test, verify.sh --self-test, stage.sh --self-test, style-findings.sh --self-test, tool-faults.sh --self-test, review-round.sh --self-test and local.sh --self-test.
- bash -n scripts/verify.sh — exit 0.
- timeout 180 scripts/verify.sh --self-test and POSTMASTER_VERIFY="$PWD/.postmaster/verify" timeout 180 scripts/verify.sh --self-test — each exit 0. The second exercises the verifier under the outer run’s environment.
- POSTMASTER_PROJECT="$PWD" timeout 60 scripts/style-findings.sh --self-test — exit 0.
- POSTMASTER_VERIFY="$PWD/.postmaster/verify" timeout 30 scripts/verify.sh --self-test — exit 124 at the time limit after partial progress; rerunning with the 180-second limit completed with exit 0.
- Earlier complete verify.sh run . attempts exited 2 while exposing and then fixing: target json module shadowing, a review-round fixture still using the old run root, and inherited POSTMASTER_VERIFY in the nested verifier self-test. A later attempt exited 2 on the style self-test’s knip negative control; that control passed on its focused rerun, and the final complete verifier passed.

## Decisions

- Use .postmaster/project.toml for opt-in shared requirements and .postmaster/settings.toml for this checkout’s local choices. Local role assignments may select only lanes and coachmen already present in machine configuration.
- Let project turnpikes define only the meaning of default; an empty list is valid and tickets may name fewer or no turnpikes.
- Keep turnpikes.sh --list as a project-independent catalogue. Resolve defaults with an explicit --project target.
- Reject credential-like values and machine paths while allowing portable project-relative check commands and generated shell-local paths.
- Ignore the whole .postmaster/ folder, exposing only its .gitignore from the root ignore file. Add the shared project.toml deliberately; do not commit local settings or run records.
- Declare this repository’s gate, default turnpikes and risk surfaces in its shared profile. Leave its tracker binding to discovery because no board or team name was verified.

## Not done

- Did not migrate ~/.postmaster/runs/ contents or move machine configuration into a project; the ticket explicitly leaves existing machine data in place.
- Did not commit local settings, a tracker binding with an unverified name, or run artifacts.
- Did not update the tracker or push this branch, per the workhorse instructions.
- Did not run the end-to-end fixture dispatch and score. AGENTS.md requires a clean fixture run before merging a coachman contract change. fixture.sh new requires its standalone target repo to be outside every existing Git repo, while this worktree’s task instructions require all writes to stay inside the worktree. The fixture run remains a merge prerequisite for the coachman in an execution context allowed to create that standalone repo.
- Did not promote operational run records to the research wiki; the ticket says evidence promotion is a deliberate decision.

## Acceptance criteria

- AC1 — Met. Shared and local settings are optional and discovery remains the fallback.
- AC2 — Met. Shared and local settings reject credentials and machine filesystem paths.
- AC3 — Met. The schema supports local role choices, project defaults, tracker binding and risk surfaces; run records, harness streams and durable sessions live under each project’s path-keyed run root.
- AC4 — Met. .postmaster/.gitignore covers the folder and local settings, logs and run artifacts remain ignored; only the opt-in shared file is deliberately committed here.
- AC5 — Met. The shared schema accepts project requirements and rejects roles, credentials, machine paths and machine identity.
- AC6 — Met. Missing settings files do not prompt or stop discovery.
- AC7 — Met. Discovery, shared settings, local settings and machine settings follow the stated precedence; projects impose no turnpike floor.
- AC8 — Met. New run artifacts use <repo>/.postmaster/runs/; old machine-level run roots were not migrated.
- AC9 — Met. Setup offers the local or shared file according to the decision and writes only after agreement.
- AC10 — Met. Discovery reports shared/local presence and fact sources.

