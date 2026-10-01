# Workhorse spec: #201, Setup and the probe say whether lane confinement can run on this machine, and what finishes it

## Summary

Nothing in setup says what sandbox-runtime needs on the machine, so a user finds out when a
launch fails. This ticket adds `scripts/probe-confine.sh`, which reports `ready`, `partial` or
`unavailable` for lane confinement in the shape `probe-trackers.sh` already uses; wires a
`confine` key (`on`/`off`) through `setup.sh` and `config.example.toml`, asked once with the
probe's result in front of the user; and puts the answer on the postmaster's launch card. Any
root command is the user's to run; the probe runs again after they do.

This is the coachman's one spec, written from the two lane specs (sol 79b0dc6, mimo 68b41bc)
on the user's word: both workhorses implement from this same file, in blinkers as before.

## Technical context

- **Language and version**: TypeScript run by Bun, functional core with side effects at the
  edges. Executable scripts keep a two-line Bash wrapper that runs the `.ts` with Bun.
- **Dependencies used or added**: none. The port files copied below need only node builtins
  and `bunfig.toml`; no `package.json` change.
- **Testing**: `bun test scripts/probe-confine.test.ts` (the probe's three controls, stubbed);
  `bun test scripts/setup.test.ts` (copied controls plus the new `confine` controls);
  `bun test ./scripts`, `bun run lint`, the pinned `scripts/skill-refs.sh`, and the run's
  checks through the pinned `scripts/verify.sh run .` before the summary.
- **Constraints**: work only in this worktree; read no other lane, no other branch, no
  `.worktrees/`, no wiki. Copy the port files unchanged and commit that copy on its own.
  Nothing in the flow runs a privileged command, writes `/etc/apparmor.d/`, or reloads
  AppArmor. This ticket adds the question and the config write only; `launch.sh` reading
  `confine` is #200, and whichever lands second merges the other's change.

## Direction check

- Probe first, then ask once: `AGENTS.md` gains the probe in its probe list and the confine
  question in "What to settle", after the tracker question; `setup.sh` prints the probe table
  as it already prints `probe-harnesses.sh`, then asks once; the probe runs again after the
  user acts.
- `partial` names what finishes it: one install command for missing packages; the AppArmor
  rule block plus its activation for restricted namespaces (see Complexity tracking).
- Root is the user's: the probe prints root commands and says the user runs them; nothing
  executes them.
- TypeScript run by Bun, tests beside, functional style: new probe plus changed port copy,
  pure verdict logic, PATH/sysctl/platform reads at the edge.
- Every result has a control: ready, partial and unavailable each forced through the same
  stubbed lookups; setup gains positive and negative `confine` controls.
- Nothing harness-specific: the probe checks tools and kernel state only, never a harness.
- After writing a runbook, run the pinned `scripts/skill-refs.sh`; before the summary, run
  the pinned `scripts/verify.sh run .` and record each check.

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
| `config.example.toml` | Document top-level `confine` |
| `AGENTS.md` | Probe list plus the confine question in "What to settle" |
| `skills/postmaster/SKILL.md` | Stage 0 launch card says whether lanes will run confined |
| `README.md` | Script list gains the probe |

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `setup.sh --self-test` maps to `bun test scripts/setup.test.ts` after the copy | This branch's gate still runs `scripts/setup.sh --self-test`. The port moved those controls into `setup.test.ts` and left the flag out of `setup.ts`. | Leaving the flag dead breaks the gate. A second self-test inside `setup.ts` would duplicate `setup.test.ts`. |
| The AppArmor fix is named as a rule block plus an activation command, not one line | The fix is a profile file and an AppArmor reload. The user reviews it before running it as root. | A single `sudo sh -c '...'` heredoc hides what root is about to run. |

## Decisions

1. **Table shape.** One row per need (`bubblewrap`, `socat`, `ripgrep`, `user namespaces` on
   Linux; `sandbox-exec`, `ripgrep` on macOS), columns in the `probe-trackers.sh` shape, exit
   0 always. The footer states `lane confinement: ready|partial|unavailable`, names the
   command (or the rule) that finishes it when the verdict is `partial`, and explains the words.
2. **`--verdict`.** `probe-confine.sh --verdict` prints one of `ready`, `partial`,
   `unavailable` and nothing else. `setup.sh` uses that to validate `confine=on`. The default
   (no flag) is the table. One implementation of the decision.
3. **Linux order: packages first.** Missing packages are named in a single install command
   for the machine's package manager (`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`,
   `brew` where present; packages `bubblewrap`, `socat`, `ripgrep`): `partial`, then the user
   reruns the probe, which may reveal the AppArmor step next. A missing package with no known
   manager is `unavailable`.
4. **Readiness is a launch test, not the sysctl alone.** With the tools present, the probe
   runs a minimal Bubblewrap user-namespace launch. When it fails on Ubuntu 24.04 or later
   with `kernel.apparmor_restrict_unprivileged_userns=1` and no usable rule, the verdict is
   `partial` naming the AppArmor rule from the brief (profile for `/usr/bin/bwrap` with
   `userns,`) plus `sudo apparmor_parser -r /etc/apparmor.d/bwrap`, run by the user as root.
   A profile file merely existing does not decide: loaded or not, the launch test tells the
   truth. A failed launch with no known remedy is `unavailable` with its cause.
5. **macOS.** `sandbox-exec` and `rg` on PATH means `ready`. Missing `rg` with Homebrew
   present is `partial` naming `brew install ripgrep`; missing `sandbox-exec`, or missing
   `rg` without Homebrew, is `unavailable`. Every macOS result says macOS has not been tried.
   Any other platform is `unavailable`.
6. **Setup.** Prints the probe table as it prints `probe-harnesses.sh`, then asks `confine`
   once (`on`/`off`, default `off`). `on` is accepted when the verdict is `ready` or
   `partial` (the user may still be about to run the root step) and refused with a message
   naming the probe when `unavailable`. Any other value is refused. Writes top-level
   `confine = "on"` or `"off"`; a config without the key reads as off.
7. **Self-test surface.** The probe's controls live in `scripts/probe-confine.test.ts` and run
   through `bun test` (no probe `--self-test`: the gate invokes none). `setup.sh --self-test`
   runs `bun test scripts/setup.test.ts` so the existing gate keeps passing.
8. **Test seam.** The probe reads tools through PATH and platform/sysctl through small edges
   honoring `POSTMASTER_PROBE_PLATFORM` and `POSTMASTER_PROBE_SYSCTL` whenever set. Tests use
   them (PATH stubs plus overrides) to force each verdict without touching the real machine;
   docs never mention them. A stub `bwrap` that is present but fails the launch drives the
   restricted control.
9. **Docs.** `AGENTS.md`: probe list gains the probe; the confine question sits after the
   tracker question. `SKILL.md`: the stage 0 launch card says whether lanes will run confined,
   reading a missing key as off. `config.example.toml` documents top-level `confine`.
   `README.md` script list gains the probe.

## Acceptance checks

Each check is the command, the input and the expected output, the way the work will really be used.

- **AC1.** `scripts/probe-confine.sh` exits 0 and prints a table plus a footer. On this
  machine (tools present, Bubblewrap starts) the footer says `lane confinement: ready`.
  `scripts/probe-confine.sh --verdict` prints `ready` and nothing else. With `rg` hidden
  behind PATH stubs, the table says `partial` and the footer names the install command.
- **AC2.** On Ubuntu 24.04+ with restricted namespaces (stub `bwrap` present but failing the
  launch, `POSTMASTER_PROBE_SYSCTL=1`), the probe prints `partial`, the
  `/etc/apparmor.d/bwrap` rule block, and the activation command, saying the user runs them
  as root. The `bun test scripts/probe-confine.test.ts` restricted control pins this output.
- **AC3.** With a needed package hidden and a stub `apt-get` on PATH, the probe prints
  `partial` and one install command. With no known package manager on PATH, it prints
  `unavailable`.
- **AC4.** With `POSTMASTER_PROBE_PLATFORM=darwin` and stub `sandbox-exec` plus `rg`, the
  probe prints `ready` and a line saying macOS has not been tried.
- **AC5.** `scripts/setup.sh --keys` lists `confine`. A full `--answers` run with
  `confine=on` writes `confine = "on"` to the config; `confine=maybe` exits 1 and writes
  nothing. With the probe forced to `unavailable`
  (`POSTMASTER_PROBE_PLATFORM` set to an unknown platform), `confine=on` is refused with a
  message naming the probe. `AGENTS.md` "What to settle" shows the question with the probe's
  result; `config.example.toml` documents the key.
- **AC6.** `skills/postmaster/SKILL.md` stage 0 "Launch card" step carries a line saying
  whether lanes will run confined, from the config's `confine` key (missing reads as off).
- **AC7.** `bun test scripts/probe-confine.test.ts` passes with a named control for each of
  `ready`, `partial` and `unavailable`, each using stubs for the tools the probe looks for.

## Tasks

- [ ] T001 [P] [AC1] Copy the port files unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232` (`scripts/setup.ts`, `scripts/setup.sh`, `scripts/setup.test.ts`, `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `bunfig.toml`) and commit the copy on its own.
- [ ] T002 [P] [AC1] Add `scripts/probe-confine.sh` (two-line Bun wrapper) and `scripts/probe-confine.ts`: rows plus footer in the `probe-trackers.sh` shape, exit 0, verdict `ready`/`partial`/`unavailable`, `--verdict` flag.
- [ ] T003 [AC2] On restricted unprivileged user namespaces, say `partial` and name the AppArmor rule that lets only Bubblewrap create them, plus the activation the user runs as root.
- [ ] T004 [AC3] When a needed package is missing, say `partial` and name the install command for the machine's package manager, or `unavailable` when no manager is known.
- [ ] T005 [AC4] On macOS, say `ready` when `sandbox-exec` and ripgrep are present, and say macOS has not been tried.
- [ ] T006 [AC7] `scripts/probe-confine.test.ts` with a control for each of `ready`, `partial` and `unavailable`, using stubs for the tools the probe looks for.
- [ ] T007 [AC5] `scripts/setup.ts`: `confine` key `on`/`off` (default `off`), asked once after the probe is shown, refuse `on` when the probe says `unavailable`, write the key to the config; keep `scripts/setup.sh --self-test` working.
- [ ] T008 [AC5] `scripts/setup.test.ts` controls for the `confine` key (writes `on`/`off`, defaults to `off`, refuses `on` when unavailable, refuses other values).
- [ ] T009 [AC5] `config.example.toml` documents top-level `confine`.
- [ ] T010 [AC5] `AGENTS.md`: run `scripts/probe-confine.sh` with the other probes, and ask the confine question once in "What to settle" with the probe's result, noting any root command is the user's and the probe runs again after.
- [ ] T011 [AC6] `skills/postmaster/SKILL.md` stage 0 launch card says whether lanes will run confined; `README.md` script list gains the probe.
- [ ] T012 [AC1] Run `bun test ./scripts`, `bun run lint`, the pinned `scripts/skill-refs.sh`, and the pinned `scripts/verify.sh run .`; record each check, then write and commit `WORKHORSE-SUMMARY.md` last.
