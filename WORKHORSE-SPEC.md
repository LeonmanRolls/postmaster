# Workhorse spec: #109 Port the scripts to TypeScript

## Summary

Port every script under `scripts/` to a Bun-run TypeScript entry point, keeping each existing `.sh` path as a thin argument-forwarding wrapper, and update the gate and runtime documentation.

## Technical context

- **Language and version**: TypeScript in strict mode, run by Bun 1.4.2 or newer.
- **Dependencies used or added**: Bun built-ins and Node standard modules at runtime; `typescript` and `@biomejs/biome` as the only development dependencies.
- **Testing**: `tsc --noEmit`, `biome check`, all 31 self-tests present at BASE, the repository gate, and `scripts/discover-project.sh .`.
- **Constraints**: Preserve all script paths, arguments, output formats, and exit codes; preserve every BASE self-test control; no Python under `scripts/`; do not alter behavior beyond the TypeScript port and Bun gate/documentation support.

## Direction check

- The shell becomes TypeScript run directly by Bun. Each existing `.sh` will only invoke its sibling `.ts` and forward its arguments.
- Shell commands use Bun's shell support or Node's standard process APIs at the side-effect boundary. Data parsing and decisions live in typed TypeScript functions.
- Runtime code uses only Bun built-ins and Node standard modules. The only declared development dependencies are TypeScript and Biome.
- The scripts retain their original command interfaces and self-test controls. The existing self-test inventory is fixed to the 31 scripts that exposed `--self-test` at BASE.
- The check is deterministic and discoverable: `package.json` runs type checking, Biome, and the fixed self-test list; project discovery recognizes Bun's lockfile and reports `bun run check`.
- README and AGENTS instructions will require Bun 1.4.2 or newer instead of Python 3.11.
- No repo-specific or harness-specific behavior is introduced; the existing scripts remain the public interface.

## Structure

- Replace the implementation in all 38 existing `scripts/*.sh` files with wrappers and add matching `scripts/*.ts` entry points: `check-target`, `cut-scratch`, `discover-project`, `find-projects`, `fixture`, `front-door-acceptance`, `front-door`, `github`, `handoff-check`, `host`, `launch`, `link-skills`, `local`, `log-action`, `plane`, `probe-harnesses`, `probe-trackers`, `review-round`, `reviewers`, `run-log`, `run-meta`, `run-times`, `runs-status`, `setup`, `skill-refs`, `stage`, `style-findings`, `ticket-check`, `tool-faults`, `tracker-kind`, `turnpikes`, `verify-examples`, `verify-journey`, `verify-library`, `verify`, `view-stream`, `wait-for-markers`, and `wiki-lint`.
- Add shared TypeScript helpers under `scripts/lib/` where they remove duplicated process, filesystem, and CLI behavior without obscuring script-specific logic.
- Add `package.json`, `bun.lock`, strict `tsconfig.json`, Biome configuration, and a TypeScript runner for the fixed self-test inventory.
- Update `README.md` and `AGENTS.md` to state the Bun runtime requirement and check command.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Keep 38 `.sh` entry points alongside TypeScript implementations | Existing runbooks and callers rely on those paths and interfaces. | Renaming callers would violate the ticket and break runs in flight. |
| Use a fixed self-test runner list in the package check | The wrappers will no longer contain self-test logic, so searching wrappers for `--self-test` would silently skip coverage. | Dynamic discovery from wrapper contents would pass without exercising any self-test. |

## Decisions

- Set the documented minimum runtime to Bun 1.4.2, the installed version named by the ticket.
- Preserve the BASE self-test inventory exactly: `cut-scratch`, `fixture`, `front-door-acceptance`, `front-door`, `github`, `host`, `launch`, `link-skills`, `local`, `log-action`, `plane`, `review-round`, `reviewers`, `run-log`, `run-meta`, `run-times`, `runs-status`, `setup`, `skill-refs`, `stage`, `style-findings`, `ticket-check`, `tool-faults`, `turnpikes`, `verify`, `verify-examples`, `verify-journey`, `verify-library`, `view-stream`, `wait-for-markers`, and `wiki-lint`.
- Preserve shell-facing process behavior at the TypeScript edge with Node standard process APIs where that gives the closest match for inherited streams, signals, and exit status; use Bun facilities for TypeScript execution and TOML parsing.
- Teach discovery to select `bun run <script>` when a Bun lockfile is present, while retaining its existing npm and pnpm behavior for other projects.

## Tasks

- [ ] T001 [P] [AC1] Port `scripts/check-target.sh`, `scripts/handoff-check.sh`, `scripts/find-projects.sh`, `scripts/discover-project.sh`, `scripts/tracker-kind.sh`, and `scripts/probe-harnesses.sh` to matching `.ts` entry points and wrappers.
- [ ] T002 [P] [AC1] Port `scripts/probe-trackers.sh`, `scripts/setup.sh`, `scripts/link-skills.sh`, `scripts/skill-refs.sh`, and `scripts/verify.sh` to matching `.ts` entry points and wrappers.
- [ ] T003 [P] [AC1] Port `scripts/cut-scratch.sh`, `scripts/fixture.sh`, `scripts/front-door-acceptance.sh`, `scripts/front-door.sh`, and `scripts/local.sh` to matching `.ts` entry points and wrappers.
- [ ] T004 [P] [AC1] Port `scripts/github.sh`, `scripts/plane.sh`, `scripts/ticket-check.sh`, and `scripts/tool-faults.sh` to matching `.ts` entry points and wrappers.
- [ ] T005 [P] [AC1] Port `scripts/host.sh` and `scripts/launch.sh` to matching `.ts` entry points and wrappers.
- [ ] T006 [P] [AC1] Port `scripts/log-action.sh`, `scripts/run-log.sh`, `scripts/run-meta.sh`, `scripts/run-times.sh`, `scripts/runs-status.sh`, `scripts/stage.sh`, and `scripts/wait-for-markers.sh` to matching `.ts` entry points and wrappers.
- [ ] T007 [P] [AC1] Port `scripts/review-round.sh`, `scripts/reviewers.sh`, `scripts/style-findings.sh`, and `scripts/turnpikes.sh` to matching `.ts` entry points and wrappers.
- [ ] T008 [P] [AC1] Port `scripts/verify-examples.sh`, `scripts/verify-journey.sh`, `scripts/verify-library.sh`, `scripts/view-stream.sh`, and `scripts/wiki-lint.sh` to matching `.ts` entry points and wrappers.
- [ ] T009 [AC3] Preserve and run every BASE control in the 31 self-tests, including subprocess, negative, and positive controls; record the BASE-to-port mapping in the implementation documentation.
- [ ] T010 [AC4] Add `package.json`, `bun.lock`, strict `tsconfig.json`, Biome configuration, shared TypeScript helpers under `scripts/lib/`, and the fixed self-test runner; declare only TypeScript and Biome as development dependencies.
- [ ] T011 [AC5] Make `package.json`'s `check` run `tsc --noEmit`, Biome, and every BASE self-test, and make `scripts/discover-project.sh .` report `bun run check`.
- [ ] T012 [AC6] Update `README.md` and `AGENTS.md` to require Bun 1.4.2 or newer instead of Python 3.11.
- [ ] T013 [AC2] Verify each `.sh` path forwards the same arguments to its `.ts` implementation and confirm output and status behavior through the fixed self-test suite and gate.
