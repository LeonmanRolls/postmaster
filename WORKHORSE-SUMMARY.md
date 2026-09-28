# Workhorse summary: #116 Bound each host launch with memory and process caps

## Commits

- `4388a7b #116 Record workhorse spec`
- `7055ee1 #116 Cap each host launch`
- This commit adds the summary.

## What changed

- `host.sh run` resolves default and role-specific limits from the dispatch's `run.json`, or
  from the live config for direct launches. Its `--role` and `--run` options are used by lane,
  coachman and reviewer launch paths.
- On Linux, a verified systemd user scope applies `MemoryMax`, `MemorySwapMax=0`, `TasksMax`
  and `OOMPolicy=kill` to each launch tree. A monitor kills only that scope after a process cap
  event. The runner reports the reached cap in `.err`, preserves the exit marker and registers
  the launch pid as soon as it starts.
- When systemd scopes are unavailable, the launch follows the existing runner and records
  `host: launch running uncapped (no supported per-launch limits available)` in `.err`, with a
  warning to the caller.
- Config defaults are `4G` and `256`; lane, coachman and reviewer tables can override either.
  `setup.sh --keys`, its prompts, generated config and validation cover the same settings.
- `review-round.sh` now launches reviewers with the reviewer role and dispatch snapshot.
  Runbooks document limits, notices and the unsupported-host behavior.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed this immediately before this
summary was written:

```text
gate: pass, exit 0, 364s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other checks:

- `scripts/host.sh --self-test` — exit 0. Fork and allocation runaways hit `TasksMax=16` and
  `MemoryMax=64M`, respectively; each leaves its marker and exact `.err` notice. Healthy
  launches finish during both cap controls, the capped runner publishes its pidfile while the
  command is still active, and the uncapped fallback completes with its notice.
- `scripts/setup.sh --self-test` — exit 0. Defaults, per-role inheritance and overrides, and
  invalid memory and task values behaved as expected.
- `scripts/review-round.sh --self-test` — the first run exited 1 and exposed delayed launch
  registration from the cap watcher. The watcher was changed to a direct background child; the
  rerun printed `self-test: all controls behaved` and exited 0.
- `scripts/skill-refs.sh && git diff --check && bash -n scripts/host.sh scripts/setup.sh scripts/review-round.sh`
  — exit 0.
- BASE control: `POSTMASTER_HOST_TEST_IMPL="$PWD/.host-base-test.sh" scripts/host.sh --self-test`
  — expected exit 1. With `scripts/host.sh` loaded from BASE
  `7e6a7151661ee61511ca908fdc0fa76459410e7c`, the output included:
  `FAIL a fork runaway is stopped at TasksMax, leaves its marker and no children` and
  `FAIL an allocation runaway is stopped at MemoryMax and leaves its marker`. The healthy
  launch controls passed. The temporary BASE script and output files were removed.

## Decisions

- Use a transient systemd user scope on Linux only after verifying cgroup v2 memory and pids
  controllers and the applied scope properties. `ulimit -u` was rejected because it limits the
  whole user. There is no portable per-process-tree fallback, so unsupported machines run
  uncapped and say so.
- Defaults are `MemoryMax=4G` and `TasksMax=256`; role values override either value and inherit
  omitted values from `[limits]`.
- Pass `--role` and `--run` to lane, coachman and reviewer launches so they use the config
  snapshot recorded at dispatch. Direct host launches use the live config and default role.
  The review-round executable passes its dispatch and reviewer role too.
- Use `host: process cap reached (TasksMax=<value>)` and
  `host: memory cap reached (MemoryMax=<value>)` for cap notices. The uncapped notice is
  `host: launch running uncapped (no supported per-launch limits available)`.
- Run capped controls only when the host has a verified systemd user scope; the self-test always
  checks successful uncapped fallback with the cap tools removed from `PATH`.

## Not done

- CPU caps and disk access confinement were not added; the ticket excludes them and disk
  confinement is #107.
- Nothing was pushed; the ticket requires this branch to land through a pull request.

## Acceptance criteria

- AC1: Met on Linux hosts with a verified systemd cgroup v2 user scope; each run has its own
  memory and process caps over its launch tree.
- AC2: Met. Cap exhaustion kills only the affected scope, reports the cap in `.err`, and leaves
  the runner's marker.
- AC3: Met. Defaults and lane, coachman and reviewer overrides are read from the recorded
  dispatch config or the live config for direct launches.
- AC4: Met. Bounded fork, bounded allocation, healthy concurrent launch and cleanup controls
  pass; both runaway cap controls fail on BASE.
- AC5: Met. The self-test removes cap tools from `PATH`, then verifies the launch completes and
  `.err` says it ran uncapped.
