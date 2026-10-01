# Workhorse spec: 201 lane confinement readiness in setup

## Summary

Nothing in setup says what sandbox-runtime needs on the machine, so a user finds out when a
launch fails. This ticket adds `scripts/probe-confine.sh`, which reports `ready`, `partial`
or `unavailable` for lane confinement in the shape `probe-trackers.sh` already uses, wires a
`confine` key (`on`/`off`) through `setup.sh` and `config.example.toml`, and puts the
answer on the postmaster's launch card. Any root command is the user's to run; the probe
runs again after they do.

## Technical context

- **Language and version**: TypeScript run by Bun (1.4.x on this machine), functional core
  with side effects at the edges. The new probe is new code; `setup` is the port's files
  copied unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232`, then changed.
- **Dependencies used or added**: none beyond the copy set (`scripts/lib/data.ts`,
  `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `bunfig.toml`) and node builtins. No
  package.json change.
- **Testing**:
  - `bun test ./scripts` — picks up `scripts/probe-confine.test.ts` and the copied/changed
    `scripts/setup.test.ts`.
  - `bun test scripts/probe-confine.test.ts` — the probe's three controls (ready, partial,
    unavailable) via tool stubs.
  - `bun test scripts/setup.test.ts` — copied controls plus the `confine` controls.
  - `/home/brindlewick/.postmaster/tool-pins/56b7a04cb7758bdb2a292f583e81fd51300cfb2c/scripts/verify.sh run .`
    — the run's gate, which includes `scripts/setup.sh --self-test`.
- **Constraints**:
  - Probe-then-ask, as for harnesses and ticket sources: the probe reports, the user
    chooses, the script does not guess.
  - Root commands stay the user's. The flow never runs `sudo`, never writes
    `/etc/apparmor.d/`, never reloads AppArmor.
  - Deterministic checks live in `scripts/`, not in prose. Every result the probe can print
    has a control that could have come out the other way.
  - This ticket adds the question and the config write only. `launch.sh` reading `confine`
    is ticket #200. Whichever lands second merges the other's change.

## Direction check

| Direction / rule | How this plan meets it |
|---|---|
| Probe-then-ask, as for ticket sources | `scripts/probe-confine.sh` prints the table and names the finishing command; AGENTS.md "What to settle" asks `confine` once with that result in front of the user. |
| Partial names the one command that finishes it | Each incomplete need names its install command (or the AppArmor rule); see Decisions for the AppArmor case, which is a rule block, not one line. |
| Root is the user's; probe runs again after | The probe prints the rule and says the user runs it as root. AGENTS.md says to probe again after they do. Nothing in the flow executes it. |
| TypeScript run by Bun, tests beside, functional style | New probe is `probe-confine.ts` + `probe-confine.test.ts`. `setup` is the port copy, changed in TypeScript. Shared decision logic is a pure function; PATH/sysctl/platform reads sit at the edge. |
| Copy the port's files unchanged, commit the copy alone | One commit that is only the copy of `setup.ts`, `setup.sh`, `setup.test.ts`, `lib/data.ts`, `lib/paths.ts`, `lib/proc.ts`, `bunfig.toml` from `c70e592`. Ticket changes come in later commits. |
| Deterministic work in `scripts/` | The probe, the `confine` validation and the config write are all scripts. AGENTS.md and SKILL.md only say when to run them and what to show. |
| Every count needs a control | Probe self-test has a ready, a partial and an unavailable control, each through the same stubbed tool lookups. Setup gains positive and negative `confine` controls. |
| Fix what this change introduces | `setup.sh --self-test` is in this branch's gate; the port moved those controls into `setup.test.ts` and dropped the flag. The ticket's change keeps `--self-test` working (Decisions). |
| Nothing harness-specific in the flow | The probe checks tools and kernel state only. It never looks at a harness. |

## Structure

| Path | Change |
|---|---|
| `scripts/setup.ts` | Copy unchanged, then add the `confine` key |
| `scripts/setup.sh` | Copy unchanged (two-line Bun wrapper, replaces the shell script), then keep `--self-test` working |
| `scripts/setup.test.ts` | Copy unchanged, then add `confine` controls |
| `scripts/lib/data.ts` | Copy unchanged |
| `scripts/lib/paths.ts` | Copy unchanged |
| `scripts/lib/proc.ts` | Copy unchanged |
| `bunfig.toml` | Copy unchanged |
| `scripts/probe-confine.sh` | New: two-line Bun wrapper |
| `scripts/probe-confine.ts` | New: the probe |
| `scripts/probe-confine.test.ts` | New: three controls with tool stubs |
| `config.example.toml` | Document top-level `confine = "on"` / `"off"` |
| `AGENTS.md` | Probe list + "What to settle" asks `confine` once with the probe's result |
| `skills/postmaster/SKILL.md` | Stage 0 launch card says whether lanes will run confined |

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `setup.sh --self-test` maps to `bun test scripts/setup.test.ts` after the copy | This branch's gate (`verify.sh` arm) still runs `scripts/setup.sh --self-test`. The port moved those controls into `setup.test.ts` and left the flag out of `setup.ts`. | Leaving the flag dead breaks the gate. Porting a second self-test into `setup.ts` would duplicate `setup.test.ts`. |
| AppArmor fix is named as a rule block plus a reload, not a single line | The fix is a profile file and an AppArmor reload. Inventing a one-liner would hide what root is about to run. | A single `sudo sh -c '...'` would still be multi-line and harder to read before running as root. |

## Decisions

1. **Table shape.** Rows for each need (`bubblewrap`, `socat`, `ripgrep`, `user namespaces`
   on Linux; `sandbox-exec`, `ripgrep` on macOS), columns in the `probe-trackers.sh` shape.
   The footer states `lane confinement: ready|partial|unavailable`, names the command (or
   the rule) that finishes it when the verdict is `partial`, and explains the words. Exit 0
   always.
2. **One command for packages.** Missing packages are named in a single install command for
   the machine's package manager (apt/dnf/yum/pacman/zypper/apk/brew). If no package
   manager is known, that need is `unavailable` and so is the overall verdict when it is
   the only blocker.
3. **AppArmor.** When `sysctl kernel.apparmor_restrict_unprivileged_userns` is `1` and
   there is no bwrap profile, that need is `partial` and the probe prints the rule from
   the evidence (profile for `/usr/bin/bwrap` with `userns,`) and the reload command, and
   says the user runs them as root. When the sysctl is `0` or absent, the need is `ready`.
   When the sysctl is `1` and `/etc/apparmor.d/bwrap` already exists with that profile,
   the need is `ready` (the rule is already in place).
4. **macOS.** `sandbox-exec` and `ripgrep` on PATH means `ready`. The footer always says
   macOS has not been tried (the result is from sandbox-runtime's README). Other platforms
   are `unavailable`.
5. **`--verdict`.** `probe-confine.sh --verdict` prints one of `ready`, `partial`,
   `unavailable` and nothing else. `setup.sh` uses that to refuse `confine=on` when the
   verdict is `unavailable`. The default (no flag) is the table. This keeps one
   implementation of the decision.
6. **Setup asks once, with the probe in front.** `setup.sh` prints `probe-confine.sh` the
   way it already prints `probe-harnesses.sh`, then asks `confine` once (`on`/`off`,
   default `off`). `partial` allows `on` — the user may still be about to run the root
   step. `unavailable` refuses `on` with a message naming the probe.
7. **Config.** Top-level `confine = "on"` or `confine = "off"`, written by setup next to
   `projects_roots`. Default `off`. A config without the key reads as off (existing
   configs keep today's behavior). Documented in `config.example.toml`. `launch.sh` does
   not read it on this ticket.
8. **Self-test surface.** The probe's controls live in `scripts/probe-confine.test.ts`
   (the probes have no `--self-test` in the gate). `setup.sh --self-test` runs
   `bun test scripts/setup.test.ts` so the existing gate keeps passing after the copy.
9. **Stubbing in tests.** The probe reads tools via PATH and reads platform/sysctl through
   small injectable edges (env overrides used only by tests: `POSTMASTER_PROBE_PLATFORM`,
   `POSTMASTER_PROBE_SYSCTL`). Controls put stub executables first on PATH and set those
   overrides, so each of the three results is forced without touching the real machine.
10. **AGENTS.md order.** The `confine` question sits after the tracker question in "What
    to settle", since it is the same shape (probe, then ask, partial names the fix). The
    probe list above it gains `scripts/probe-confine.sh`.

## Tasks

- [ ] T001 [P] [AC1] Copy the port files unchanged from `c70e592` (`scripts/setup.ts`, `scripts/setup.sh`, `scripts/setup.test.ts`, `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `bunfig.toml`) and commit the copy on its own.
- [ ] T002 [P] [AC1] Add `scripts/probe-confine.sh` (two-line Bun wrapper) and `scripts/probe-confine.ts`, printing rows plus a footer in the `probe-trackers.sh` shape, exit 0, with the verdict `ready`/`partial`/`unavailable`.
- [ ] T003 [AC2] On restricted unprivileged user namespaces, say `partial` and name the AppArmor rule that lets only Bubblewrap create them (user runs it as root).
- [ ] T004 [AC3] When a needed package is missing, say `partial` and name the install command for the machine's package manager, or `unavailable` when no package manager is known.
- [ ] T005 [AC4] On macOS, say `ready` when `sandbox-exec` and ripgrep are present, and say macOS has not been tried.
- [ ] T006 [AC7] `scripts/probe-confine.test.ts` with a control for each of `ready`, `partial` and `unavailable`, using stubs for the tools the probe looks for.
- [ ] T007 [AC5] `scripts/setup.ts`: `confine` key `on`/`off` (default `off`), asked once after the probe is shown, refuse `on` when the probe says `unavailable`, write the key to the config; keep `scripts/setup.sh --self-test` working.
- [ ] T008 [AC5] `scripts/setup.test.ts` controls for the `confine` key (writes `on`/`off`, defaults to `off`, refuses `on` when unavailable).
- [ ] T009 [AC5] `config.example.toml` documents top-level `confine`.
- [ ] T010 [AC5] `AGENTS.md`: run `scripts/probe-confine.sh` with the other probes, and ask the confine question once in "What to settle", with the probe's result, noting that any root command is the user's and the probe runs again after.
- [ ] T011 [AC6] `skills/postmaster/SKILL.md` stage 0 launch card says whether lanes will run confined.
