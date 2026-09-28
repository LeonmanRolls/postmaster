# Workhorse summary: 109 TypeScript for the whole of scripts/

## What was built

Every script under `scripts/` is TypeScript run by Bun. Each `scripts/<name>.sh` is a one-line
wrapper that hands its arguments to `scripts/<name>.ts`. No Python remains under `scripts/`.
Paths, arguments, output formats and exit codes are kept.

### Commits on `wb/109-mimo`

| commit | what |
|---|---|
| `cc9bf43` | Add workhorse spec for #109 TypeScript scripts port |
| `fb41d05` | Add TypeScript toolchain and shared script libraries for #109 |
| `4953241` | Port check-target and run-log to TypeScript behind one-line wrappers |
| `a6278c1` | Name Bun 1.4.2 or newer in README and AGENTS.md in place of Python 3.11 |
| `a6aaf2f` | Port all scripts/ to TypeScript behind one-line wrappers |
| `39746d4` | Keep port scratch files out of the tree |
| `30dcefe` | Fix crash bugs in host, launch, plane and skill-refs ports |
| `be56bf4` | Match BASE output trimming in turnpikes self-test |
| `c4e4c8a` | Fix local, setup and style-findings self-test controls |
| `2d6860d` | Fix cut-scratch, host, launch and link-skills controls; drop host Python stubs |
| `6eb8062` | Fix ticket-check, verify, verify-examples and verify-library controls |
| `dd8fed3` | Apply the host.sh stop fix from #117 to the host.ts port |
| `58b2758` | Fix fixture, view-stream and review-round self-test hangs and controls |
| `1f4eda1` | Make tsc strict and biome check pass on the port |
| `68d4209` | Keep a workhorse's journey path to its own worktree in the self-test |
| `abb108e` | Let run() unset an env var so a workhorse's journey path stays its own |

Files: `package.json`, `tsconfig.json`, `biome.json`, `bun.lock`, `types/bun.d.ts`,
`scripts/lib/{paths,proc,data,selftest}.ts`, 38 × `scripts/<name>.ts`, 38 × one-line
`scripts/<name>.sh`, `README.md`, `AGENTS.md`, `.gitignore`.

## Checks

Run from the worktree root with `/home/brindlewick/postmaster/scripts/verify.sh run .`
just before this summary was written:

```
gate: pass, exit 0, 274s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

| check | command | exit |
|---|---|---|
| gate | `bash -c 'for f in scripts/*.sh; do bash -n "$f" \|\| exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test \|\| exit 1; done'` | 0 |

Other commands run, with exit:

- `bun run check` (tsc --noEmit, biome check, every BASE self-test) — 0
- `./node_modules/.bin/tsc --noEmit` — 0
- `./node_modules/.bin/biome check scripts types package.json tsconfig.json biome.json` — 0
- `./scripts/discover-project.sh .` — 0, prints `gate=bun run check`
- each of the 31 `scripts/<name>.sh --self-test` — 0 (`self-test: all controls behaved`)
- `grep -n python3 scripts/*.sh scripts/*.ts` — only `style-findings.ts`'s `INTERPRETERS`
  name list (a set of interpreter names the shell tokenizer recognises, not a Python call)

## Self-test controls at BASE beside the port

Every control label from BASE is preserved in the ported self-test, run from the same path
(`scripts/<name>.sh --self-test`). The extraction below counts string-literal labels in
`ok`/`fail`/`has`/`expect`/`is`/`check`/`refused`/`wrote`/`last`/`named` call sites; helper
functions that take the label as `$1` are counted at their call sites in the ports.

| script | BASE control labels | ported | notes |
|---|---|---|---|
| `cut-scratch` | clone/cut ancestry, kind, remove | same labels | verify() reason text now kept on failure |
| `fixture` | new/score/hidden, breaks, recorded | same labels | expectScore reads captured output, no re-score |
| `front-door` | four sections, refusals | same labels | |
| `front-door-acceptance` | 17 alone + pairs + all-faults | same labels | |
| `github` | create/edit/read/state/comment/list | same labels | DieError maps create exit 5 |
| `host` | detect/name/run/stop/close/spawn/send/wait/read | same labels | Python stubs rewritten as bun; stopTree is the #117 port |
| `launch` | form/launch/resume, muse, mimo, bypass, skills | same labels | printf %q quoting matched |
| `link-skills` | plan/make/remove, CLAUDE_CONFIG_DIR, tool resolution | same labels | `command -v` via sh -c |
| `local` | store/create/edit/read/title/state/comment/list, UTF-8 | same labels | argv bytes via /proc/self/cmdline + surrogateescape |
| `log-action` | JSONL shape, U+2028, tool-fault paths, refusals | same labels | |
| `plane` | HTML↔markdown converters, API, self-test | same labels | |
| `review-round` | wait/teardown/limit, host stop | same labels | |
| `reviewers` | lines/lanes/lenses | same labels | |
| `run-log` | section/entry/close | same labels | |
| `run-meta` | run.json written once | same labels | |
| `run-times` | stage table, waiting, terminal | same labels | |
| `runs-status` | poll, markers | same labels | |
| `setup` | answers → config, lens/env/limit | same labels | config bytes match BASE |
| `skill-refs` | refs/fix | same labels | |
| `stage` | one stage line, terminal appends | same labels | |
| `style-findings` | list/count/gate/check, workspaces, forms | same labels | BOM-stripped JSON reads |
| `ticket-check` | shape rules, --splice, adapter | same labels | CRLF: `\r` stripped at tokenize |
| `tool-faults` | Safe/publish/harvest/comment/file/decline | same labels | |
| `turnpikes` | resolve/legs/short | same labels | `$(…)` trailing-newline stripping matched |
| `verify` | checks/record/arm/run/results/summary | same labels | process groups; signal deaths as `exit -N` |
| `verify-examples` | transcript runner | same labels | PATH uses `delimiter` not `sep` |
| `verify-journey` | journey judge | same labels | |
| `verify-library` | library tests | same labels | |
| `view-stream` | renderer, follow | same labels | zombies read as dead via /proc |
| `wait-for-markers` | positive/negative reader control, timeout | same labels | |
| `wiki-lint` | wiki rules, each fault | same labels | |

Each script's `--self-test` ends `self-test: all controls behaved` and exits 0.

## Decisions made within the brief

1. **Wrapper form** — `#!/usr/bin/env bash` + `exec bun "$(dirname "$0")/<name>.ts" "$@"`.
2. **TypeScript beside its wrapper** as `scripts/<name>.ts`; shared helpers in `scripts/lib/`
   (paths, proc, data, selftest).
3. **Sibling scripts still invoked by path** (`scripts/foo.sh`) so cross-script contracts and
   self-test fakes stay identical to BASE.
4. **Self-tests stay in-script** behind `--self-test`; `bun test` is not used. The `check`
   script runs the same fixed BASE list of 31 names the stand-in gate names.
5. **Ambient types in `types/bun.d.ts`** instead of `@types/node`/`bun-types`, because AC4
   allows only `typescript` and `@biomejs/biome` as development dependencies.
6. **`discover-project` reads `package.json` with `JSON.parse`** instead of `jq`; the
   `warn=jq not installed` line is gone because that failure mode is gone.
7. **Discovered gate command** prefers `bun run` when a bun lockfile sits next to
   `package.json`, else `pnpm run`/`npm run`. This repo reports `gate=bun run check`.
8. **TOML via `Bun.TOML.parse`**; `tomllib` probes in `tracker-kind`/`setup` are gone.
9. **`find-projects` home-shrink stays a no-op**, matching bash 5.2 `patsub_replacement`
   behaviour at BASE (an unquoted `~` in the replacement expands to `$HOME`).
10. **`local` locking** is an `O_EXCL` create/unlink spinlock in place of `fcntl.flock`;
    crash semantics differ (a stale lock is possible), all controls pass.
11. **UTF-8 refusal** recovers raw argv from `/proc/self/cmdline` with surrogateescape, since
    Bun replaces invalid argv bytes with U+FFFD; the self-test feeds invalid bytes through
    `printf` in bash, as BASE did.
12. **`style-findings` `INTERPRETERS`** keeps the name `"python3"` (a shell-tokenizer name
    list, not a Python call).
13. **Biome rules that fight deliberate port patterns** (`noNonNullAssertion`,
    `noControlCharactersInRegex`, `noAssignInExpressions`, `noFallthroughSwitchClause`,
    `noTemplateCurlyInString`, `noExplicitAny`, `noImplicitAnyLet`,
    `noShadowRestrictedNames`) are off in `biome.json`; `noUnusedVariables` is warn.
    `tsc --noEmit` runs with `strict: true` (and not `noUncheckedIndexedAccess`, which is
    beyond strict).
14. **`run()` treats an `undefined` env value as unset**, so a self-test can clear an
    inherited `POSTMASTER_VERIFY` (as `verify.sh run` sets for a check).
15. **A workhorse's journey-path control** clears `POSTMASTER_VERIFY` so it measures the
    worktree's own path; BASE leaked the variable the same way under `verify.sh run`.
16. **`host.ts` self-test stubs** (`herdr`, `tmux`, probe/tree fixtures) are `#!/usr/bin/env bun`
    or `setsid`/`ps`, not Python, per AC1.

## What was not done, and why

- **`raw/trials/` Python** is untouched: recorded evidence, out of scope.
- **A single `postmaster` command (#33)** is not added: out of scope; wrappers stay.
- **No change to what a script does**: subcommands, output text and exit codes match BASE.
  Where the port had to choose (e.g. `discover-project` no longer warns about `jq`), the
  change is named above and is a consequence of the port, not a behaviour change.
- **#85 (host self-test flake under load)** is not this change's; the ported host self-test
  passed every run it was given.
- **A fixture run dispatched from this branch scoring clean** is a merge condition for the
  coachman (needs a run and a fleet); this workhorse ran `scripts/fixture.sh --self-test`
  and the stand-in gate.
- **PR body with the control table** belongs to the ship leg; the table above is what it
  should carry.

## Acceptance criteria verdicts

1. **Every script's logic is TypeScript run by Bun; no Python under `scripts/`; each `.sh`
   hands its arguments to its TypeScript version** — met. 38 wrappers are one line of `exec
   bun`; the only `python3` string under `scripts/` is `style-findings`'s interpreter-name
   list.
2. **Every script keeps its path and interface** — met. Same paths, arguments, output formats
   and exit codes; self-tests compare against BASE behaviour throughout.
3. **Each `--self-test` runs from its path and keeps every control** — met. All 31 self-tests
   exit 0 with `self-test: all controls behaved`; the table above pairs BASE labels with the
   port.
4. **Runtime imports only Bun built-ins and Node standard modules; `typescript` and
   `@biomejs/biome` are the only development dependencies** — met. `package.json` has exactly
   those two `devDependencies`; `types/bun.d.ts` supplies the rest.
5. **`check` runs `tsc --noEmit` strict, `biome check` and every self-test; exits 0;
   `discover-project.sh .` reports a gate that runs it** — met. `bun run check` exits 0;
   `discover-project.sh .` prints `gate=bun run check`.
6. **README and AGENTS.md name Bun with the version in place of Python 3.11** — met. Both
   name Bun 1.4.2 or newer.
