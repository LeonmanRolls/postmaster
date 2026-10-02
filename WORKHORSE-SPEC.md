# Workhorse spec: #201, Setup and the probe say whether lane confinement can run on this machine, and what finishes it

## Summary

Nothing in setup says what sandbox-runtime needs on the machine, so a user finds out when a launch fails. This ticket adds `scripts/probe-confine.sh`, which reports `ready`, `partial` or `unavailable` for lane confinement in the shape `probe-trackers.ts` already uses; wires a `confine` key (`on`/`off`) through `setup.ts` and `config.example.toml`, asked once with the probe's result in front of the user; and puts the answer on the postmaster's launch card. Any root command is the user's to run; the probe runs again after they do.

This is the coachman's one spec, written from the two lane specs (sol 79b0dc6, mimo 68b41bc) on the user's word: both workhorses implement from this same file, in blinkers as before.

## Technical context

- **Language and version**: TypeScript run by Bun, functional core with side effects at the edges. Each new script gets the two-line Bash wrapper every script on main has: a shebang, then one line that runs the `.ts` with Bun, passing the arguments on, so the agent following AGENTS.md and setup.ts (which calls probe-confine.sh --verdict) reach it by its .sh path like every other script. Since #109, the TypeScript port, merged, the scripts this ticket changes are already TypeScript on main, so it changes them in place.
- **Dependencies used or added**: none. Bun's built-ins, Node's standard modules and the helpers already in `scripts/lib/`; no `package.json` change.
- **Testing**: `bun test scripts/probe-confine.test.ts` (the probe's three controls, stubbed); `bun test scripts/setup.test.ts` (setup's own controls plus the new `confine` controls); `bun run check` (the project's gate: type check, Oxlint, the Biome format check, every test beside its script, the runbook references and the wiki lint); and, just before the summary, the pinned `scripts/verify.sh run .`, which runs every check the run recorded at dispatch and records each result.
- **Constraints**: work only in this worktree; read no other lane, no other branch, no `.worktrees/`, no wiki. Nothing in the flow runs a privileged command, writes `/etc/apparmor.d/`, or reloads AppArmor. This ticket adds the question and the config write only; `launch.ts` reading `confine` is #200, and whichever lands second merges the other's change.

## Direction check

- Probe first, then ask once: `AGENTS.md` gains the probe in its probe list and the confine question in "What to settle", after the tracker question; `setup.ts` prints the probe table as it already prints `probe-harnesses.ts`, then asks once whether lanes run confined (on or off, default off); the probe runs again after the user acts.
- `partial` names what finishes it: one install command for missing packages; the AppArmor rule block plus its activation for restricted namespaces (see Complexity tracking).
- Root is the user's: the probe prints root commands and says the user runs them; nothing executes them.
- TypeScript run by Bun, tests beside, functional style: a new probe plus changes to `setup.ts` and `setup.test.ts`, pure verdict logic, PATH/sysctl/platform reads at the edge.
- Every result has a control: ready, partial and unavailable each forced through the same stubbed lookups; setup gains positive and negative `confine` controls.
- Nothing harness-specific: the probe checks tools and kernel state only, never a harness.
- After writing a runbook, run the pinned `scripts/skill-refs.sh`; before the summary, run the pinned `scripts/verify.sh run .` and record each check.

## Structure

| Path | Change |
| --- | --- |
| `scripts/probe-confine.ts` | New: the probe |
| `scripts/probe-confine.sh` | New: the two-line Bun wrapper every script has |
| `scripts/probe-confine.test.ts` | New: a control for each verdict, with tool stubs |
| `scripts/setup.ts` | Add the `confine` question and its config write |
| `scripts/setup.test.ts` | Add the `confine` controls |
| `config.example.toml` | Document top-level `confine` |
| `AGENTS.md` | Probe list plus the confine question in "What to settle" |
| `skills/postmaster/SKILL.md` | Stage 0 launch card says whether lanes will run confined |
| `README.md` | Script list gains the probe |

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| The AppArmor fix is named as a rule block plus an activation command, not one line | The fix is a profile file and an AppArmor reload. The user reviews it before running it as root. | A single `sudo sh -c '...'` heredoc hides what root is about to run. |

## Decisions

1. **Table shape.** One row per need (`bubblewrap`, `socat`, `ripgrep`, `user namespaces` on Linux; `sandbox-exec`, `ripgrep` on macOS), columns in the `probe-trackers.ts` shape, exit 0 always. The footer states `lane confinement: ready|partial|unavailable`, names the command (or the rule) that finishes it when the verdict is `partial`, and explains the words.
2. **`--verdict`.** `probe-confine.sh --verdict` prints one of `ready`, `partial`, `unavailable` and nothing else. `setup.ts` uses that to validate `confine=on`. The default (no flag) is the table. One implementation of the decision.
3. **Linux order: packages first.** Missing packages are named in a single install command for the machine's package manager (`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`, `brew` where present; packages `bubblewrap`, `socat`, `ripgrep`): `partial`, then the user reruns the probe, which may reveal the AppArmor step next. A missing package with no known manager is `unavailable`.
4. **Readiness is a launch test, not the sysctl alone.** With the tools present, the probe runs a minimal Bubblewrap user-namespace launch. When it fails on Ubuntu 24.04 or later with `kernel.apparmor_restrict_unprivileged_userns=1` and no usable rule, the verdict is `partial` naming the AppArmor rule from the brief (profile for `/usr/bin/bwrap` with `userns,`) plus `sudo apparmor_parser -r /etc/apparmor.d/bwrap`, run by the user as root. A profile file merely existing does not decide: loaded or not, the launch test tells the truth. A failed launch with no known remedy is `unavailable` with its cause.
5. **macOS.** `sandbox-exec` and `rg` on PATH means `ready`. Missing `rg` with Homebrew present is `partial` naming `brew install ripgrep`; missing `sandbox-exec`, or missing `rg` without Homebrew, is `unavailable`. Every macOS result says macOS has not been tried. Any other platform is `unavailable`.
6. **Setup.** Prints the probe table as it prints the harness probe's (`probe-harnesses.ts`), then asks `confine` once (`on`/`off`, default `off`). `on` is accepted when the verdict is `ready` or `partial` (the user may still be about to run the root step) and refused with a message naming the probe when `unavailable`. Any other value is refused. Writes top-level `confine = "on"` or `"off"`; a config without the key reads as off.
7. **Self-test surface.** The probe's controls live in `scripts/probe-confine.test.ts`, beside the probe, and run in `bun run check` with every other test; the probe has no `--self-test` flag. `setup.test.ts` gains the `confine` controls beside setup's own.
8. **Test seam.** The probe reads tools through PATH and platform/sysctl through small edges honoring `POSTMASTER_PROBE_PLATFORM` and `POSTMASTER_PROBE_SYSCTL` whenever set. Tests use them (PATH stubs plus overrides) to force each verdict without touching the real machine; docs never mention them. A stub `bwrap` that is present but fails the launch drives the restricted control.
9. **Docs.** `AGENTS.md`: probe list gains the probe; the confine question sits after the tracker question. `SKILL.md`: the stage 0 launch card says whether lanes will run confined, reading a missing key as off. `config.example.toml` documents top-level `confine`. `README.md` script list gains the probe.

## Showing each criterion

Each check is the command, the input and the expected output, the way the work will really be used.

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
| --- | --- | --- | --- |
| AC1 | A probe script prints `ready`, `partial` or `unavailable` for lane confinement on this machine, in the shape `scripts/probe-trackers.sh` uses, and for `partial` names the one command that finishes it. | `scripts/probe-confine.sh` on this machine (tools present, Bubblewrap starts); `scripts/probe-confine.sh --verdict`; the probe with `rg` hidden behind PATH stubs. | Exit 0, a table plus a footer saying `lane confinement: ready`; `--verdict` prints `ready` and nothing else; with `rg` hidden, the table says `partial` and the footer names the install command. |
| AC2 | On Ubuntu 24.04 or later, where unprivileged user namespaces are restricted, the probe says `partial` and names the AppArmor rule that lets only Bubblewrap create them. | The probe with restricted namespaces: a stub `bwrap` present but failing the launch, and `POSTMASTER_PROBE_SYSCTL=1`. The restricted control in `bun test scripts/probe-confine.test.ts` pins this output. | `partial`, the `/etc/apparmor.d/bwrap` rule block, and the activation command, saying the user runs them as root. |
| AC3 | When a package is missing, the probe says `partial` and names the install command for the machine's package manager, or says `unavailable` when it knows none. | The probe with a needed package hidden and a stub `apt-get` on PATH; then with no known package manager on PATH. | `partial` and one install command; then `unavailable`. |
| AC4 | On macOS the probe says `ready` when `sandbox-exec` and ripgrep are present, and its output says macOS has not been tried. | The probe with `POSTMASTER_PROBE_PLATFORM=darwin` and stub `sandbox-exec` plus `rg`. | `ready`, and a line saying macOS has not been tried. |
| AC5 | `scripts/setup.sh` has a `confine` key, `on` or `off`, that the setup conversation asks once with the probe's result. The script refuses `on` when the probe says `unavailable` and writes the key to the config otherwise. | `scripts/setup.sh --keys`; a full `--answers` run with `confine=on`; one with `confine=maybe`; one with `confine=on` and the probe forced to `unavailable` (`POSTMASTER_PROBE_PLATFORM` set to an unknown platform); then `AGENTS.md` "What to settle" and `config.example.toml`. | `--keys` lists `confine`; `confine = "on"` is written to the config; `confine=maybe` exits 1 and writes nothing; the forced run refuses `on` with a message naming the probe; "What to settle" shows the question with the probe's result; `config.example.toml` documents the key. |
| AC6 | The postmaster's launch card says whether lanes will run confined. | The stage 0 "Launch card" step of `skills/postmaster/SKILL.md`. | It carries a line saying whether lanes will run confined, from the config's `confine` key (missing reads as off). |
| AC7 | The probe's self-test has a control for each result, `ready`, `partial` and `unavailable`, using stubs for the tools it looks for. | `bun test scripts/probe-confine.test.ts` | Passes, with a named control for each of `ready`, `partial` and `unavailable`, each using stubs for the tools the probe looks for. |

## Tasks

- [ ] T001 [P] [AC1] Add `scripts/probe-confine.ts` and its two-line Bun wrapper `scripts/probe-confine.sh`: rows plus footer in the `probe-trackers.ts` shape, exit 0, verdict `ready`/`partial`/`unavailable`, `--verdict` flag.
- [ ] T002 [AC2] On restricted unprivileged user namespaces, say `partial` and name the AppArmor rule that lets only Bubblewrap create them, plus the activation the user runs as root.
- [ ] T003 [AC3] When a needed package is missing, say `partial` and name the install command for the machine's package manager, or `unavailable` when no manager is known.
- [ ] T004 [AC4] On macOS, say `ready` when `sandbox-exec` and ripgrep are present, and say macOS has not been tried.
- [ ] T005 [AC7] `scripts/probe-confine.test.ts` with a control for each of `ready`, `partial` and `unavailable`, using stubs for the tools the probe looks for.
- [ ] T006 [AC5] `scripts/setup.ts`: `confine` key `on`/`off` (default `off`), asked once after the probe is shown, refuse `on` when the probe says `unavailable`, write the key to the config.
- [ ] T007 [AC5] `scripts/setup.test.ts` controls for the `confine` key (writes `on`/`off`, defaults to `off`, refuses `on` when unavailable, refuses other values).
- [ ] T008 [AC5] `config.example.toml` documents top-level `confine`.
- [ ] T009 [AC5] `AGENTS.md`: run `scripts/probe-confine.sh` with the other probes, and ask the confine question once in "What to settle" with the probe's result, noting any root command is the user's and the probe runs again after.
- [ ] T010 [AC6] `skills/postmaster/SKILL.md` stage 0 launch card says whether lanes will run confined; `README.md` script list gains the probe.
- [ ] T011 [AC1] Run `bun run check`, the pinned `scripts/skill-refs.sh` and the pinned `scripts/verify.sh run .`; record each check, then write and commit `WORKHORSE-SUMMARY.md` last.
