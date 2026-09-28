# Workhorse spec: #116 Bound each launch with memory and process caps

## Summary

Bound each `host.sh run` launch and its descendants with per-launch Linux cgroup limits, while
leaving launches runnable with an uncapped notice when the machine has no working limiter.

## Technical context

- **Language and version**: Bash; Python 3.11+ for TOML and run manifest parsing.
- **Dependencies used or added**: Existing `systemd-run` and `systemctl` user manager on Linux;
  no new dependency. Other machines keep the existing runner and report that it is uncapped.
- **Testing**: `scripts/host.sh --self-test` covers capped fork and allocation controls, a healthy
  launch, and the uncapped fallback; `scripts/setup.sh --self-test` covers limit defaults,
  overrides and validation; the worktree gate and `scripts/verify.sh run .` cover the project.
- **Constraints**: Cap one launch tree, never the whole user. Keep existing run markers and error
  files as the user-visible channel. Read the run's recorded config for in-flight work.

## Direction check

- A transient systemd user scope gives each launch its own cgroup and applies `MemoryMax`,
  `TasksMax` and `OOMPolicy=kill` to the launch and children, including children that start new
  sessions. `MemorySwapMax=0` prevents an allocator from evading the memory limit through swap.
- A supervisor outside the scope watches cgroup events. `TasksMax` rejects new forks but does not
  terminate the launch, so a `pids.events` limit event makes the supervisor kill that scope.
- No `ulimit -u` or other per-user process limit is used. If the user manager cannot apply and
  verify the cgroup properties, the launch follows the existing path and `.err` records that it
  ran uncapped.
- The role and run are explicit `host.sh run` options. The run option selects the immutable
  config snapshot in `run.json`; the limits section and setup prompts carry the same defaults.
- Fork and allocation controls use tight scope limits, short timeouts and cleanup checks. A
  healthy launch runs through the same host runner as each cap control.

## Structure

- `scripts/host.sh`: role/run options, recorded-config limit selection, systemd scope runner,
  cap-event reporting, uncapped fallback and self-test controls.
- `skills/postmaster/hosts.md`: run contract, limits, fallback and test behavior.
- `skills/postmaster/coachman.md`: pass lane and reviewer roles and the dispatch to launches.
- `skills/postmaster/postmaster.md`: pass the coachman role and dispatch to each leg launch.
- `config.example.toml`: default limits and per-role override examples.
- `scripts/setup.sh`: prompts, generated TOML, `--keys` entries and self-test coverage.

## Decisions

- Use transient systemd user scopes on Linux with working cgroup v2 memory and pids controllers;
  reject `ulimit -u` because it constrains every process owned by the user. No portable per-tree
  fallback is assumed.
- Default each launch to `MemoryMax=4G` and `TasksMax=256`. Role tables can override either
  value; setup leaves a role value inherited from the defaults unless the user supplies one.
- Identify lane, coachman and reviewer launches with `--role`; identify the dispatch with `--run`
  so changes to the live config do not affect a run already in flight. Other direct host launches
  use the default limits from the live config or the built-in defaults.
- Write `host: process cap reached (TasksMax=<value>)` or
  `host: memory cap reached (MemoryMax=<value>)` to `.err` and the pane's stderr. Write
  `host: launch running uncapped (no supported per-launch limits available)` to `.err` when
  limiting is unavailable, and warn the caller as well.

## Tasks

- [ ] T001 [P] [AC1] Add per-launch systemd scope limits and process-tree supervision in `scripts/host.sh`.
- [ ] T002 [P] [AC2] Stop only the affected scope, retain the marker, and report the reached cap in `scripts/host.sh`.
- [ ] T003 [P] [AC3] Read default and per-role limits from live or recorded config in `scripts/host.sh`, `config.example.toml` and `scripts/setup.sh`.
- [ ] T004 [AC1] Pass lane, coachman and reviewer roles plus each dispatch from `skills/postmaster/coachman.md` and `skills/postmaster/postmaster.md`.
- [ ] T005 [AC4] Add bounded fork, allocation, healthy-launch and cleanup controls to `scripts/host.sh --self-test`.
- [ ] T006 [AC5] Cover the uncapped notice and continued launch behavior when the cap backend is absent in `scripts/host.sh --self-test` and `skills/postmaster/hosts.md`.
- [ ] T007 [AC1] Document the run options, scope behavior and limits in `skills/postmaster/hosts.md`.
