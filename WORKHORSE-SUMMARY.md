# Workhorse summary: #109 Port the scripts to TypeScript

## Built

- Ported all 38 scripts to Bun-run TypeScript while keeping their `.sh` paths as argument-forwarding wrappers.
- Added the strict TypeScript configuration, Bun lockfile, Biome configuration, shared helpers, and the fixed 31-script self-test runner. Runtime imports use Bun and Node standard modules; `typescript` and `@biomejs/biome` are the only development dependencies.
- Preserved the BASE control inventory in `BASE-CONTROLS.md` and ported `host.sh`'s isolated and live controls.
- Updated discovery, README, and AGENTS.md for Bun 1.4.2 or newer.
- Fixed the `local.sh` self-test to inspect combined stdout and stderr, matching its BASE control.

Commits on this branch, oldest first:

- `0547ec3` #109 record TypeScript port intent
- `f4d2038` #109 add Bun script runtime and logging ports
- `9ca87ff` #109 port tracker and workflow helpers
- `bfaef26` #109 port event rendering and wiki lint
- `422edbe` #109 port package test verification
- `60ab486` #109 port example transcript verification
- `c2fac19` #109 port journey report verification
- `dd79d03` #109 port skill linking
- `f1c4214` #109 port GitHub tracker adapter
- `0f9e841` #109 port Plane tracker adapter
- `b48aa59` #109 port review round orchestration
- `6ebdd30` Apply the host.sh stop fix from #117
- `720094d` #109 port ticket shape validation
- `24fcbfb` #109 port verification runner
- `6d8cbeb` #109 port harness launch forms
- `1ce42bb` #109 port fixture creation and scoring
- `96328a8` #109 port tool fault ticketing
- `559bd3d` #109 port style findings and gate tracing
- `d394707` #109 fix local adapter self-test output check
- `655a186` #109 port host execution and live controls
- `ef37fb1` #109 trim control map final blank line

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed this result immediately before this summary was written:

```text
gate: pass, exit 0, 306s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other verification commands and outcomes:

- `bun run check`: exit 1 on the first run because the local adapter self-test checked stdout only; after correcting the assertion, exit 0. The passing run type-checked, ran Biome, and passed all 31 baseline self-tests.
- `scripts/host.sh --self-test`: exit 0.
- `scripts/host.sh --live-test`: exit 0 against the available Herdr and tmux services, including the no-host negative control.
- `scripts/local.sh --self-test`: exit 0 after the assertion fix.
- `bunx tsc --noEmit`: exit 1 during host-test development due to missing imports and an un-awaited promise; corrected, final exit 0.
- `bunx biome check --write scripts/host.ts scripts/host-self-test.ts`: exit 0.
- `bunx biome check --write scripts/local.ts`: exit 0.
- `scripts/discover-project.sh .`: exit 0; it reported `gate=bun run check`.
- The wrapper inventory scan: exit 0; all 38 wrappers forward to their sibling TypeScript entry points.
- The embedded-Python invocation scan: exit 0; no Python heredoc or `python3 -c` remains. `style-findings.ts` retains Python interpreter names in its command vocabulary so that scanner behavior stays the same; these are strings, not Python code or invocations.
- `git diff --check bb782a973e69427c820ce16a676718e87f51995b..HEAD`: exit 2 before removing a trailing blank line from `BASE-CONTROLS.md`; final exit 0.
- An initial wrapper-scan command had a shell quoting error (exit 2); the corrected scan above passed.

## Decisions

- Set Bun 1.4.2 as the minimum documented version, as named by the ticket.
- Kept the package check's self-test list fixed to the 31 scripts that had self-tests at BASE.
- Kept the Python command names in `style-findings.ts`'s recognized command list because removing them would change that script's behavior; there is no Python implementation or subprocess under `scripts/`.
- Ported `host.sh --live-test` as well as its isolated self-test and ran the live controls against services available on this machine.
- Changed the local adapter self-test to examine combined stdout and stderr because BASE did so and the GitHub adapter writes its refusal to stderr.

## Not done

- Did not dispatch and score a fixture run. The ticket names that as a merge precondition; this workhorse ran the required repository verify gate and did not start an external ticket run.
- Did not push, as required by the brief.
- Left `raw/trials/` and the single-command interface out of scope.

## Acceptance criteria

- AC1: met. All 38 scripts have TypeScript implementations and thin `.sh` wrappers; no embedded Python invocation remains.
- AC2: met. Script paths and argument forwarding remain in place; the fixed self-test suite and host live controls pass.
- AC3: met. `BASE-CONTROLS.md` records the BASE controls beside their TypeScript ports, and all 31 baseline self-tests pass.
- AC4: met. Runtime imports use Bun and Node standard modules; package development dependencies are TypeScript and Biome only.
- AC5: met. `bun run check` exits 0, and discovery reports `gate=bun run check`.
- AC6: met. README and AGENTS.md require Bun 1.4.2 or newer in place of Python 3.11.
