# Workhorse spec: 109 TypeScript for the whole of scripts/

## Summary

Port every script under `scripts/` from bash-with-Python-heredocs to TypeScript run by Bun, in one change: each `scripts/<name>.sh` stays as a one-line wrapper that hands its arguments to `scripts/<name>.ts`, no Python remains under `scripts/`, and the paths, arguments, output formats, exit codes and `--self-test` controls of every script are kept.

## Technical context

- **Language and version**: TypeScript, run by Bun 1.4.2 (the version installed on this machine; the docs will name Bun 1.4.2 or newer). Strict `tsc --noEmit` over the port.
- **Dependencies used or added**: runtime: none (Bun built-ins and Node standard modules only). Development: `typescript` and `@biomejs/biome` only. Because those are the only development dependencies, ambient declarations for the Bun and Node APIs the scripts use live in the repository (`types/`), not in `@types/node` or `bun-types`.
- **Testing**:
  - `bun run check` — `tsc --noEmit` (strict), `biome check`, then every self-test (the 31 scripts that had one at BASE).
  - The stand-in gate from `.postmaster/verify/spec.json`, via `/home/brindlewick/postmaster/scripts/verify.sh run .` after committing: `bash -n` every `scripts/*.sh`, `scripts/skill-refs.sh`, `scripts/wiki-lint.sh`, then `scripts/<name>.sh --self-test` for the fixed BASE list.
  - Per-script while porting: `scripts/<name>.sh --self-test` from the worktree root.
- **Constraints**: one change; every script keeps its path, arguments, output and exit codes; no Python under `scripts/`; a run in flight keeps working (so the `.sh` interface is immutable); out of scope: `raw/trials/`, a single `postmaster` command (#33), any change to what a script does.

## Direction check

| Direction / rule | How this plan meets it |
|---|---|
| TypeScript for the whole of `scripts/`, run by Bun | Each script becomes `scripts/<name>.ts`; the only shell left is the one-line wrapper. |
| No Python remains under `scripts/` | Every `python3 -c`, `python3 - <<'PY'` heredoc and `tomllib` use is ported to TypeScript (`Bun.TOML`, `JSON`, direct logic). |
| Keep the scripts as straightforward as the bash they replace | Each `.ts` mirrors its `.sh`'s subcommands and branches in the same order; a git command run through `$` reads like the shell line it replaces. |
| A functional core with side effects at the edges | Argument parsing, pure checks and formatting sit in functions; filesystem, process and network work happens only where the bash did it. |
| Each `scripts/<name>.sh` is a one-line wrapper | `exec bun "$(dirname "$0")/<name>.ts" "$@"`. |
| Runtime imports only Bun built-ins and Node standard modules | No `package.json` `dependencies`; only `bun` and `node:*` imports at run time. |
| `typescript` and `@biomejs/biome` are the only development dependencies | Exactly those two in `devDependencies`; the APIs the scripts use are declared in `types/`. |
| Nothing repo-specific / nothing harness-specific in the flow | Ported logic keeps the same discovery and adapters; no new hardcoding. |
| Deterministic work in `scripts/`, not prose | Self-tests stay in the scripts and in `bun run check`, not in runbooks. |
| A prompt lives in argv | Unchanged: wrappers pass `"$@"` through; no matching on process text. |
| Every count needs a control | Every self-test control at BASE is ported one-for-one and is still run from the same path. |
| Every action is logged | `log-action.sh` behaviour is unchanged. |
| Script paths in runbooks go through `<tool>` | No runbook changes; `skill-refs.sh` still passes. |
| One change, conflicts with PRs that touch scripts | This branch carries the whole port; the open script PRs land first or are redone in TypeScript. |
| Not a single `postmaster` command (#33) | Wrappers stay; no new umbrella CLI. |
| Not a change to what a script does | Same subcommands, same stdout/stderr shapes, same exit codes. |

## Structure

- `package.json` — `check` script; `devDependencies`: `typescript`, `@biomejs/biome`.
- `tsconfig.json` — strict, `noEmit`, includes `scripts/**/*` and `types/**/*`.
- `biome.json` — lint/format rules for the TypeScript under `scripts/` and `types/`.
- `types/` — ambient declarations for the Bun and Node standard APIs the scripts use (`bun`'s `$`, `Bun.TOML`, `node:fs`, `node:path`, `node:process`, `node:os`, `node:child_process`, …), so `tsc --noEmit` is strict without extra `@types` packages.
- `scripts/lib/` — small shared TypeScript helpers used by more than one script (path anchors, self-test harness (`ok`/`fail`/`expect`), JSON/TOML read, colour-stripping, mktemp-with-cleanup). Nothing repo-specific.
- `scripts/<name>.sh` (38 files) — one-line wrapper, unchanged path and interface.
- `scripts/<name>.ts` (38 files) — the ported logic, including each `--self-test`.
- `README.md` — “What it needs” names Bun 1.4.2 or newer in place of Python 3.11; the `jq` sentence goes if `discover-project` no longer shells out to `jq`.
- `AGENTS.md` — names Bun 1.4.2 or newer as what the scripts run on, in the machine-setup context.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `types/` ambient declarations instead of `@types/node` / `bun-types` | AC4 allows only `typescript` and `@biomejs/biome` as development dependencies. | Adding `@types/node` or `bun-types` would be a third and fourth development dependency and violate AC4. |
| `scripts/lib/` shared helpers | 38 scripts share the self-test harness, TOML config read and path anchors; copying them 38 times is how the bash grew its own drift. | Duplicating a helper in every `.ts` is more straightforward per file but multiplies the port's surface and the places a control can be mis-copied. |
| `discover-project` reads `package.json` with `JSON` instead of `jq` | The port's runtime may import only Bun and Node standard modules; the gate discovery is the same shape either way. | Keeping `jq` leaves a system dependency the ticket's direction does not want and a warn path that would fire on a machine that has Bun but no `jq`. |

## Decisions

1. **Wrapper form.** `#!/usr/bin/env bash` + `exec bun "$(dirname "$0")/<name>.ts" "$@"`. One command; arguments and exit code pass through.
2. **TypeScript sits beside its wrapper** as `scripts/<name>.ts`, so the mapping is obvious and `dirname "$0"` finds it. Shared code goes in `scripts/lib/*.ts`, imported relatively.
3. **Sibling scripts are still invoked by path** (`scripts/local.sh`, `scripts/verify.sh`, …) via `$`/`Bun.spawn`, exactly as the bash did, so cross-script contracts and self-test fakes stay identical.
4. **Self-tests stay in-script** behind `--self-test` on the same path. The `check` script runs the same fixed BASE list of 31 names the stand-in gate names. A `bun test` suite is not used: the interface is `--self-test`, and every control must remain visible in one place beside the logic it checks.
5. **`ok`/`fail`/`expect` harness is shared** in `scripts/lib/selftest.ts`; every control's label and success/failure text is preserved from BASE (including `self-test: all controls behaved` / `self-test: N control(s) misbehaved`).
6. **`--self-test` that invokes `$0`/`SELF`** keeps invoking the `.sh` wrapper path, so the wrapper itself is what the control exercises.
7. **`jq` in `discover-project` becomes `JSON.parse`** of `package.json`; the `warn=jq not installed` line drops away because the case can no longer occur. Output lines and exit codes stay the same.
8. **Discovered gate command** prefers `bun run` when the target has a bun lockfile or `bunfig.toml`, else `pnpm run` when `pnpm-lock.yaml` exists, else `npm run`. This repo's `package.json` `check` is then reported as `bun run check`, which runs it. Without this, the only change needed for AC5 would be the `package.json` itself; the preference keeps the reported command honest to the runtime the port needs.
9. **TOML** is read with `Bun.TOML.parse` (text) rather than `tomllib` (bytes). Same values, same shape.
10. **`python3 -c '... eval ...'` self-test predicates** become TypeScript expressions in the ported self-test, not a retained interpreter.
11. **Bun version named in docs**: 1.4.2 or newer (what this machine runs and what the port is verified on).
12. **`host.sh` self-test flake (#85)** is not this change's; a failure there is left as it is and named in the summary if seen.
13. **Colour/control characters, encoding drops and `U+2028` handling** in `log-action.sh` are ported to match BASE byte-for-byte on the fixtures its self-test builds.

## Tasks

- [ ] T001 [P] [AC4] Add `package.json` (with `check`), `tsconfig.json` (strict, noEmit), `biome.json`, and `types/` ambient declarations for the Bun and Node APIs the scripts use.
- [ ] T002 [P] [AC1] Add `scripts/lib/` shared helpers: path anchors, self-test harness, JSON/TOML read, mktemp-with-cleanup, `$`/spawn helpers.
- [ ] T003 [AC1] [AC2] [AC3] Port the small argument/utility scripts: `check-target`, `tracker-kind`, `handoff-check`, `find-projects`, `probe-harnesses`, `probe-trackers`, `discover-project` (incl. T007's gate command change), each as `.sh` wrapper + `.ts`, self-test where BASE had one.
- [ ] T004 [AC1] [AC2] [AC3] Port the run-record scripts: `run-log`, `run-meta`, `run-times`, `runs-status`, `wait-for-markers`, `log-action`, `stage`, `style-findings`.
- [ ] T005 [AC1] [AC2] [AC3] Port the tracker scripts: `github`, `plane`, `local`, `ticket-check`.
- [ ] T006 [AC1] [AC2] [AC3] Port the dispatch/host scripts: `launch`, `host`, `reviewers`, `review-round`, `view-stream`, `cut-scratch`, `front-door`, `front-door-acceptance`.
- [ ] T007 [AC1] [AC2] [AC3] Port the verify/fixture/setup scripts: `verify`, `verify-examples`, `verify-journey`, `verify-library`, `fixture`, `setup`, `link-skills`, `turnpikes`, `skill-refs`, `wiki-lint`, `tool-faults`.
- [ ] T008 [AC5] Wire `check` to run `tsc --noEmit`, `biome check` and every BASE self-test; confirm `scripts/discover-project.sh .` reports a gate that runs it.
- [ ] T009 [AC6] Update `README.md` and `AGENTS.md` to name Bun 1.4.2 or newer in place of Python 3.11 (and drop `jq` if unused).
- [ ] T010 [AC1] [AC2] [AC3] Sweep: no `python3` under `scripts/`, every `.sh` is a one-line wrapper, every self-test control at BASE is present; record each control beside its port for the pull request.
- [ ] T011 [AC5] Commit all work, run `/home/brindlewick/postmaster/scripts/verify.sh run .` from the worktree root, then write `WORKHORSE-SUMMARY.md` and commit it.
