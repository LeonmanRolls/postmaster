# Workhorse spec: #201 Probe and configure lane confinement

## Summary

Add a Bun probe that reports whether lane confinement can run and its next setup command, then use its result when setup records the machine's `confine` choice and when the postmaster shows the launch card.

## Technical context

- **Language and version**: TypeScript run by Bun, with two-line Bash wrappers for executable scripts.
- **Dependencies used or added**: Bun and Node builtins; the pinned #109 port files listed below are copied unchanged before modification. No package dependency is added. The probe observes `bwrap`, `socat`, `rg`, `sandbox-exec`, `sysctl`, and known package managers; it never installs software or changes AppArmor.
- **Testing**: `bun test scripts/probe-confine.test.ts scripts/setup.test.ts` covers the three probe verdicts, Ubuntu restriction, macOS output, package advice, and setup validation. `bun test ./scripts`, `bun run lint`, and the worktree's recorded checks through the pinned `scripts/verify.sh run .` cover integration. `scripts/probe-confine.sh --self-test` runs the probe controls; `scripts/setup.sh --self-test` remains compatible with the recorded gate. Check the generated TOML and `--keys` output in setup tests.
- **Constraints**: Work only in this worktree; read no other lane or wiki. Copy the specified #109 port files unchanged and commit that copy separately. Any privileged command is printed for the user, never executed by setup or the probe. Commit the spec alone and await approval before code. Commit as brindlewick and never push.

## Direction check

- Probe first, then ask once: add `<tool>/scripts/probe-confine.sh` to the machine setup steps in `AGENTS.md`, show its verdict, and ask whether to enable confinement. If the user runs a named command, probe again before continuing; setup itself also checks the verdict when given `confine=on`.
- Keep machine choices in `~/.postmaster/config.toml`: write a top-level `confine = "on"` or `"off"`, default off, and document that a missing key means off. Leave project settings untouched.
- Put detection and decisions in TypeScript under `scripts/`, with a pure verdict function and side effects at its boundary. Use Bun tests beside each changed script and stub observed tools in probe controls.
- Use OS and package-manager observations, not repository-specific paths or harness behavior. The one OS-specific path is `/usr/bin/bwrap`, required by the supplied AppArmor rule.
- Give every verdict a test control, including negative and positive outcomes through the same probe interface. Keep the probe read-only and exit zero with a table plus a footer.
- Update the launch-card instructions, not the launch mechanism; ticket #200 owns the launch-time read of `confine`.
- After writing a runbook, run the pinned tool's `scripts/skill-refs.sh` check. Before the final summary, run all armed checks with the pinned `scripts/verify.sh run .` and record each result.

## Structure

- `WORKHORSE-SPEC.md`: this committed plan; `WORKHORSE-SUMMARY.md` is written only after implementation and checks.
- Copy unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232` in one preparatory commit: `scripts/setup.ts`, `scripts/setup.sh`, `scripts/setup.test.ts`, `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, and `bunfig.toml`.
- Create `scripts/probe-confine.sh`, `scripts/probe-confine.ts`, and `scripts/probe-confine.test.ts`.
- Change `scripts/setup.ts` and `scripts/setup.test.ts` after the copy; keep `scripts/setup.sh` as the copied two-line wrapper.
- Change `config.example.toml`, `AGENTS.md`, `skills/postmaster/SKILL.md`, and `README.md` for the machine choice, setup conversation, launch card, and command list.

## Decisions

- The probe prints a header, a `lane` row with `ready`, `partial`, or `unavailable`, then a footer. A partial footer gives one command to run now. It exits zero for all three verdicts so the table remains the result.
- Check packages first. On Linux, combine all missing packages in one install command, then tell the user to rerun the probe. This reveals an AppArmor step only after Bubblewrap is installed. Recognize `apt-get`, `dnf`, `pacman`, `zypper`, and `apk`; package names are `bubblewrap`, `socat`, and `ripgrep`. If a package is missing and no known manager exists, report `unavailable`.
- With Linux tools present, use a minimal Bubblewrap user-namespace launch as the readiness test. On Ubuntu 24.04 or later, when `kernel.apparmor_restrict_unprivileged_userns=1` and that launch fails, report `partial` with a single user-run shell command that writes the supplied `/etc/apparmor.d/bwrap` profile and activates it with `apparmor_parser -r`. The global restriction remains in place. A failed launch without this known remedy is `unavailable` with its cause.
- On macOS, require `sandbox-exec` and `rg`. Missing `rg` gets `brew install ripgrep` if Homebrew exists; missing `sandbox-exec`, or missing `rg` without Homebrew, is `unavailable`. Every macOS result says this path has not been tried.
- On other operating systems, report `unavailable`. Do not claim a remedy the probe cannot establish.
- `confine=off` is always accepted. `confine=on` is accepted for `ready` or `partial`, and refused for `unavailable`. Reject values other than `on` or `off`. Existing config files without `confine` keep off behavior; setup writes the explicit default for newly generated files.
- The probe's `--self-test` runs its adjacent Bun test file. The copied setup's `--self-test` entry point will run its adjacent Bun tests, because the armed gate still invokes that switch after the port moves the old shell controls.

## Tasks

- [ ] T001 [AC5] Copy `scripts/setup.ts`, `scripts/setup.sh`, `scripts/setup.test.ts`, `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, and `bunfig.toml` unchanged from the specified commit and commit the copy alone.
- [ ] T002 [AC1] Create `scripts/probe-confine.sh` and `scripts/probe-confine.ts` with a zero-exit table, footer, and a pure verdict function.
- [ ] T003 [AC2] Add the Ubuntu restriction check, Bubblewrap launch check, and user-run AppArmor profile command to `scripts/probe-confine.ts`.
- [ ] T004 [AC3] Add Linux package-manager detection and a combined install command for missing packages to `scripts/probe-confine.ts`.
- [ ] T005 [AC4] Add macOS `sandbox-exec` and `rg` detection and the untried notice to `scripts/probe-confine.ts`.
- [ ] T006 [AC7] Create `scripts/probe-confine.test.ts` with stubbed tools and controls for `ready`, `partial`, and `unavailable`; cover Ubuntu and macOS paths and the `--self-test` entry point.
- [ ] T007 [AC5] Add `confine` to `scripts/setup.ts`, `scripts/setup.test.ts`, and `config.example.toml`; validate `on` against the probe and retain the setup self-test entry point.
- [ ] T008 [AC5] Update `AGENTS.md` to ask the confine question once with the probe result, leave privileged commands to the user, and rerun the probe after their action.
- [ ] T009 [AC6] Update the launch card in `skills/postmaster/SKILL.md` to show whether lanes will run confined, reading a missing config key as off.
- [ ] T010 [AC1] Add the probe to `README.md`, run the targeted tests, lint, skill-reference check, and the worktree's pinned verification checks, then write and commit `WORKHORSE-SUMMARY.md` last.
