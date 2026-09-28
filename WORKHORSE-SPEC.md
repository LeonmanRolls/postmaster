# Workhorse spec: 116 Bound a launch and everything it starts with a memory cap and a process cap

## Summary

One lane's runaway bug must stop that lane and nothing else. Every launch through
`scripts/host.sh run` will run under a memory cap and a process cap that bound the launch and
everything it starts, so a fork bomb or an alloc bomb dies at its cap, its `.err` names the cap,
its marker lands, and every other launch and the postmaster keep going.

## Technical context

- **Language and version**: Bash 5 with Python 3.11+ in heredocs (the repo's existing form).
  No new dependencies.
- **Dependencies used or added**: `systemd-run --user --scope` and `systemctl --user` where they
  exist (Linux user session, cgroup v2 with memory and pids). No new packages. On a machine with
  no way to cap, the launch runs uncapped and says so.
- **Testing**: `scripts/host.sh --self-test` gains the cap controls (fork bomb stopped at the
  process cap, alloc bomb stopped at the memory cap, within-caps launch unchanged, uncapped
  notice). Each cap control is run against `git show BASE:scripts/host.sh` first to show it fails
  on the old behaviour. Then the project gate:
  `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in ...; do scripts/$n.sh --self-test || exit 1; done'`
- **Constraints**: no CPU caps and no disk confinement (#107 is out of scope). `ulimit -u` is
  explicitly not the mechanism (it limits the whole user). `host.sh`'s path, arguments, output
  formats and exit codes stay as they are except where this ticket changes them. The pane shows
  the stopped launch and the cap through the existing `.err`/marker mechanism only.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Bound each launch and everything it starts with a memory cap and a process cap | A systemd user scope per launch (`MemoryMax`, `MemorySwapMax=0`, `TasksMax`) holds the launch and every process it starts, since they stay in the scope's cgroup after `setsid` |
| A launch that reaches a cap is stopped on its own; every other launch and the postmaster keep running | The memory cap OOM-kills only that scope (`Result=oom-kill`); a cap watcher kills only that process group at the process cap. No other cgroup is touched. The runner still writes the marker and the launch's `.err` |
| The caps have defaults, and the config can set them per role | Built-in defaults; `[limits]` and optional `[limits.lane]`, `[limits.coachman]`, `[limits.reviewer]` in `config.example.toml` and `scripts/setup.sh --keys` |
| `host.sh --self-test` has controls with positive and negative counterparts | Fork bomb stopped at the process cap **and** a within-caps launch completed, through the same runner; alloc bomb stopped at the memory cap **and** the within-caps control; each cap control run against BASE first |
| On a machine with no way to cap, the launch still runs and says it runs uncapped | Fall back to the existing start path and write `host: running uncapped: no way to cap a launch here` to `.err` |
| Nothing repo-specific, nothing harness-specific in the flow | Caps live in `host.sh` (the host adapter) and in config; no repo or harness names |
| Deterministic work in `scripts/`, not prose | Cap wrapping, cap watching, limit lookup and the self-test controls are code in `host.sh` |
| Every count needs a control | The self-test asserts both that the capped launch stopped **and** that the within-caps launch completed, through the same runner |
| `ulimit -u` is not the mechanism | Rejected: it limits the whole user, not one launch's tree. systemd scope per launch is used instead |
| CPU caps and disk confinement out of scope | Not built |
| Keep `host.sh`'s arguments except where the ticket changes them | No new flags on `run`. The role for per-role limits is inferred from the name's ` · <role>` segment, which `host.sh name` already writes |
| The pane shows the stopped launch and the cap through `.err`/marker only | The cap line is appended to the launch's `.err`; no second channel |
| If the config gains keys, extend `config.example.toml` and `setup.sh --keys`; say how a run in flight is unaffected | `[limits]` keys go in both. A run keeps the config recorded in its `run.json`; a change here reaches the next run's launches |

## Structure

Changed:

- `scripts/host.sh` — cap wrap around the launch, cap watcher, `.err` wording, limit lookup
  from config, uncapped notice, self-test controls
- `skills/postmaster/hosts.md` — the run form and what a cap does, with `host.sh`
- `config.example.toml` — `[limits]` and optional per-role tables
- `scripts/setup.sh` — `--keys` and the written config gain the `[limits]` keys

Unchanged: `skills/postmaster/coachman.md` and `postmaster.md` command shapes (the name already
carries the role; no new flag).

## Complexity tracking

No departures from the direction.

## Decisions

1. **Mechanism: systemd user scope per launch, not `ulimit -u`.** `systemd-run --user --scope`
   with `MemoryMax`, `MemorySwapMax=0` and `TasksMax` puts the launch and everything it starts in
   one cgroup. `setsid` moves the session, not the cgroup, so children stay bounded. Rejected:
   `ulimit -u` (whole user), `ulimit -v` (whole process, not the tree, and swap-blind), raw
   cgroupfs writes (need a delegated cgroup and more kernel-facing code than a scope).
2. **`MemorySwapMax=0` alongside `MemoryMax`.** Without it the cap reclaims to swap and the
   launch survives past the cap (verified on this machine: 500 MB allocated under an 80 MB
   `MemoryMax`). With it the scope is OOM-killed at the cap (`Result=oom-kill`, exit 137).
3. **`.err` wording, used in the watcher, the runner and the self-test assertions:**
   - `host: launch stopped: reached the memory cap (N bytes)`
   - `host: launch stopped: reached the process cap (N)`
   - `host: running uncapped: no way to cap a launch here`
4. **Role for per-role limits is inferred from the launch name** (the ` · <role>` segment
   `host.sh name` writes): `coachman` → coachman, a name ending in ` review` → reviewer,
   anything else → lane. No new `run` flag, so the runbook forms do not change. A launch whose
   name carries no ` · ` gets the default limits only.
5. **Process cap needs a watcher; memory cap is named after the fact.** `TasksMax` makes `fork`
   fail and the launch keeps running (verified). A watcher polls `pids.events` and kills that
   launch's process group, naming the process cap. Memory is named from `systemctl --user show
   <unit> -p Result` = `oom-kill` after the wait, which is race-free (verified: Result survives
   after the cgroup is gone).
6. **Defaults: 8 GiB memory, 512 tasks.** The incident was 22 GB and ~2700 processes; 8 GiB and
   512 bound a real agent launch and its build tools without stopping ordinary work. Config can
   raise or lower them per role.
7. **Config shape: `[limits] memory_bytes, tasks`, optional `[limits.lane|coachman|reviewer]`.**
   Setup asks for and writes the two global keys. Per-role tables are optional hand-edits, the
   same precedent as `[team.coachman_legs]` (documented in `config.example.toml`, not prompted).
8. **A run in flight is unaffected because a run keeps the config recorded in its `run.json`**
   (the existing pattern `config.example.toml` states). The caps are read from the live config at
   each launch, as every host setting is; `run.json` is what a run is audited from.
9. **Uncapped notice goes to `.err` at minimum** (and nowhere else), so the pane and any `.err`
   reader see it. Existing self-test `.err` byte-comparisons only run where capping is available
   (systemd-run on the stub PATH), so a within-caps `.err` stays empty and identical to a direct
   run.
10. **Self-test safety.** Fork and alloc controls run through `host.sh run` under tight caps
    (8 tasks / 32 MiB), with marker waits that time out, and `host.sh stop` plus a group kill as
    cleanup. They never run without the cap mechanism (if capping is unavailable those two
    controls are skipped and only the uncapped-notice control runs).

## Tasks

- [ ] T001 [AC1] [P] Wrap the launch in `host.sh`'s runner with a systemd user scope
      (`MemoryMax`, `MemorySwapMax=0`, `TasksMax`) so the launch and everything it starts are
      bounded; fall back to the current start path when no scope can be created.
- [ ] T002 [AC2] [P] Stop a launch that reaches a cap and name the cap in its `.err`:
      watcher for the process cap (kill that process group only), `Result=oom-kill` after wait
      for the memory cap; the marker still lands; other launches are untouched.
- [ ] T003 [AC3] [P] Limit lookup from config with defaults: `scripts/host.sh` reads
      `[limits]` / `[limits.<role>]` via `POSTMASTER_CONFIG`; extend `config.example.toml` and
      `scripts/setup.sh --keys` (and the written `[limits]` block) consistently.
- [ ] T004 [AC4] [P] `host.sh --self-test` cap controls: a fork-without-end launch is stopped at
      the process cap, an allocate-without-end launch is stopped at the memory cap, a
      within-caps launch runs as it did before; each cap control run against BASE first and the
      output recorded; the controls are self-bounding (tight caps, short timeouts, cleanup).
- [ ] T005 [AC5] [P] Uncapped path: the launch still runs and `.err` says
      `host: running uncapped: no way to cap a launch here`; self-test covers it by stubbing the
      cap mechanism away.
- [ ] T006 [AC1] [P] `skills/postmaster/hosts.md` records the caps and the `.err` wording with
      `scripts/host.sh`, keeping the run form and output formats unchanged.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] Run `scripts/verify.sh run .` on a clean tree and write
      `WORKHORSE-SUMMARY.md` with each check's command and exit.
