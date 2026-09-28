# Workhorse summary: 116 Bound a launch and everything it starts with a memory cap and a process cap

## Commits

- `fa3ef2a` Add workhorse spec for #116: memory and process caps on every launch
- `829777e` Bound every host.sh launch with a memory cap and a process cap
- `1b5c689` Add [limits] config keys for launch caps, and record them in hosts.md
- `bdfbda1` Drop unused cap constants from host.sh; the wording lives in the watcher
- `deb4c38` Name the memory cap before OOM: MemoryHigh at the cap, MemoryMax just above

## Checks

Run from the worktree root on a clean tree, just before this summary was written:

- `gate` — `/home/brindlewick/postmaster/scripts/verify.sh run .`
  `gate: pass, exit 0, 349s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
  exit 0

Other commands run while building, each with its exit:

- `bash -n scripts/host.sh` — exit 0
- `bash -n scripts/setup.sh` — exit 0
- `scripts/host.sh --self-test` (three consecutive runs after the MemoryHigh fix) — exit 0 each; all controls behaved
- `scripts/setup.sh --self-test` — exit 0; all controls behaved
- `scripts/skill-refs.sh` — exit 0
- `python3 -c 'import tomllib; tomllib.load(open("config.example.toml","rb"))'` — exit 0

### The cap controls against BASE, as the brief requires

Scenario run through `git show 7e6a7151661ee61511ca908fdc0fa76459410e7c:scripts/host.sh` (the
branch point), same runner shape as the self-test controls, self-bounding (4 s observation,
then `kill -KILL` on the process group):

1. **Fork-without-end** (`while :; do sleep 60 & done`):
   `host=none` returned. After 4 s: marker had **not** landed, the launch was still running,
   **5928 processes** in its group, `.err` **empty** and naming **no cap** (`grep` count 0).
2. **Allocate-without-end** (8 MiB `bytearray` in a loop):
   `host=none` returned. After 4 s: marker had **not** landed, the launch was still running
   at RSS **2342624** KiB, `.err` **empty** and naming **no cap** (`grep` count 0).
3. **Within-caps** (a command that prints one stderr line and exits 3):
   marker landed, `.err` held `a line on stderr` only — it ran as it did before.

On this branch the same two runaway launches are each stopped at their cap, their `.err` names
the cap, and their markers land; the within-caps launch is unchanged.

## Decisions the brief left open

1. **Mechanism: systemd user scope per launch**, not `ulimit -u`. `systemd-run --user --scope`
   with `MemoryHigh`, `MemoryMax`, `MemorySwapMax=0` and `TasksMax` puts the launch and
   everything it starts in one cgroup. Rejected `ulimit -u` (limits the whole user),
   `ulimit -v` (one process, not the tree, and swap-blind), raw cgroupfs writes (more
   kernel-facing code, and needs a delegated cgroup).
2. **`MemorySwapMax=0` and `MemoryHigh` at the named cap, `MemoryMax` 8 MiB above.** Without
   `MemorySwapMax=0` a launch reclaims to swap and survives past the cap (measured on this
   machine: 500 MB allocated under an 80 MB `MemoryMax`). `systemctl show -p Result` is too
   racy to name the cap after death (it reads `success` for seconds after an OOM-kill), so the
   watcher names the cap from `memory.current` / `memory.events` while the launch is still
   alive, at `MemoryHigh`, and the kernel OOM at `MemoryMax` is only a backstop.
3. **`.err` wording, used in the watcher and the self-test assertions:**
   `host: launch stopped: reached the memory cap (N bytes)`,
   `host: launch stopped: reached the process cap (N)`,
   `host: running uncapped: no way to cap a launch here`.
4. **Role inferred from the launch name** (the ` · <role>` segment `host.sh name` writes):
   `coachman` → coachman, a name ending ` review` → reviewer, anything else → lane. No new
   `run` flag, so the runbook forms do not change.
5. **Process cap needs a watcher; `TasksMax` alone only makes `fork` fail** (measured: a fork
   loop survives with `pids.current` pinned). The watcher kills that launch's process group
   only and names the cap. The memory cap is named the same way, before OOM.
6. **Defaults 8 GiB memory, 512 tasks.** The incident was 22 GB and ~2700 processes; these
   bound a real agent launch and its build tools. Config can raise or lower them per role.
7. **Config shape: `[limits] memory_bytes, tasks`, optional `[limits.lane|coachman|reviewer]`.**
   Setup asks for and writes the two global keys. Per-role tables are optional hand-edits, the
   same precedent as `[team.coachman_legs]` (in `config.example.toml`, not prompted). A run
   keeps the config recorded in its `run.json`, so a change here reaches the next run.
8. **Uncapped notice goes to `.err`** (the brief's minimum). Existing self-test `.err`
   byte-comparisons strip only that one line, so a within-caps `.err` is still held to being
   identical to a direct run.
9. **Self-test safety.** Fork and alloc controls run through `host.sh run` under tight caps
    (8 tasks / 32 MiB), with marker waits that time out and a group kill as cleanup. They are
    skipped when there is no cap mechanism on the machine, and the uncapped-notice control
    stubs `systemd-run` away even when one exists.

## What I did not do

- **CPU caps** and **confining what a lane reads or writes on disk** — out of scope (the latter
  is #107).
- **A `--role` flag on `host.sh run`** — the name already carries the role, so the runbook
  forms stay as they are.
- **Setup prompts for per-role limits** — they are documented hand-edits under `[limits.<role>]`,
  like `[team.coachman_legs]`, so setup's question list stays the size it was.

## Acceptance criteria

1. **Every launch through `scripts/host.sh run` runs under a memory cap and a process cap that
   bound it and everything it starts.** — Met. The runner starts every launch in a systemd user
   scope (`MemoryHigh`/`MemoryMax`/`MemorySwapMax=0`/`TasksMax`); children stay in the cgroup
   after `setsid`. Defaults 8 GiB / 512 tasks from `[limits]`, per role from `[limits.<role>]`.
2. **A launch that reaches a cap is stopped on its own; every other launch and the postmaster
   keep running; the exit marker lands; `.err` names the cap.** — Met. The watcher kills only
   that launch's process group and writes the cap line; the runner still touches the marker.
   Other cgroups are untouched. Wording is as in Decision 3.
3. **The caps have defaults, and the config can set them per role.** — Met. `[limits]` in
   `config.example.toml` and `scripts/setup.sh --keys`, optional `[limits.lane|coachman|reviewer]`;
   role from the name's ` · <role>` segment.
4. **`host.sh --self-test` has controls: fork-without-end stopped at the process cap,
   allocate-without-end stopped at the memory cap, within-caps runs as before.** — Met. Each
   cap control is asserted together with the within-caps control through the same runner, and
   each was run against BASE first (output recorded above): BASE leaves both runaways running
   with no cap named; this branch stops both and names the cap.
5. **On a machine with no way to cap a launch, the launch still runs, and it says it runs
   uncapped.** — Met. Fall back to the previous start path and write
   `host: running uncapped: no way to cap a launch here` to `.err`. Covered in the self-test by
   stubbing `systemd-run` away, and the capped path is asserted not to carry that notice.
