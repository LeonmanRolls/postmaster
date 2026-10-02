# Workhorse summary: #201, Setup and the probe say whether lane confinement can run on this machine, and what finishes it

Implemented from the approved spec at `1cf6698` (coachman's merge of both lane specs). Branch
`wb/201-mimo`, base `56b7a04`.

## Commits

1. `fc093f8` — copy the TypeScript port's `setup` and `lib` files unchanged from `c70e592` (`scripts/setup.ts`, `scripts/setup.sh`, `scripts/setup.test.ts`, `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `bunfig.toml`). The worktree sat at the run's BASE, before the #109 merge, so the copy came first as the brief required.
2. `77ea738` — `scripts/probe-confine.sh`, `scripts/probe-confine.ts`, `scripts/probe-confine.test.ts`. The probe reports `ready`, `partial` or `unavailable` in the `probe-trackers` shape, with `--verdict` for setup.
3. `1946785` — `scripts/setup.ts` asks `confine` once after showing the probe, refuses `on` when the probe says `unavailable`, writes top-level `confine = "on"` / `"off"`; `config.example.toml` documents the key; `setup.sh --self-test` runs `bun test scripts/setup.test.ts`.
4. `5ecddbe` — `AGENTS.md` probe list and "What to settle" ask the confine question once with the probe's result; `skills/postmaster/SKILL.md` launch card says whether lanes will run confined; `README.md` lists the probe.
5. `908c7f8` — the probe tests also drive the `.sh` wrapper (and clear the unused-`SELF` lint warning).

## Checks

Just before this summary, `/home/brindlewick/.postmaster/tool-pins/56b7a04cb7758bdb2a292f583e81fd51300cfb2c/scripts/verify.sh run .` printed:

```
gate: pass, exit 0, 941s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && bun test scripts/usage.test.ts && scripts/skill-refs.sh && scripts/wiki-lint.sh && bun test scripts/clean-checkout.test.ts && for n in cut-scratch discover-project export-session fixture front-door front-door-acceptance github host landing launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done && bun test scripts/run-clash.test.ts && bun install --frozen-lockfile && bun test ./scripts ./lint && bun run lint'
```

The run's checks, as the brief names them, with command and exit:

| Check | Command | Exit |
| --- | --- | --- |
| gate (verify.sh run .) | `bash -c 'for f in scripts/*.sh; do bash -n "$f" \|\| exit 1; done && bun test scripts/usage.test.ts && scripts/skill-refs.sh && scripts/wiki-lint.sh && bun test scripts/clean-checkout.test.ts && for n in cut-scratch discover-project export-session fixture front-door front-door-acceptance github host landing launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test \|\| exit 1; done && bun test scripts/run-clash.test.ts && bun install --frozen-lockfile && bun test ./scripts ./lint && bun run lint'` | 0 (pass, 941s) |
| scripts tests | `bun test ./scripts` | 0 (133 pass, 0 fail) |
| lint | `bun run lint` | 0 |
| skill refs | `<pinned>/scripts/skill-refs.sh` | 0 |

Other commands run, with exit codes:

| Command | Exit | Notes |
| --- | --- | --- |
| `bun test scripts/probe-confine.test.ts` | 0 | 8 pass, 0 fail |
| `bun test scripts/setup.test.ts` | 0 | 32 pass, 0 fail |
| `scripts/setup.sh --self-test` | 0 | runs setup.test.ts (32 pass) |
| `scripts/probe-confine.sh` on this machine | 0 | `lane confinement: ready` |
| `scripts/probe-confine.sh --verdict` | 0 | `ready` |

## Decisions (within the brief)

- **Launch test over the sysctl alone.** With the tools present the probe runs
  `bwrap --ro-bind / / --unshare-user true`. A failed launch with
  `kernel.apparmor_restrict_unprivileged_userns=1` is `partial` naming the AppArmor rule; a
  failed launch with no known remedy is `unavailable` with its cause. A profile file merely
  existing does not decide; the launch test does.
- **AppArmor activation is `sudo apparmor_parser -r /etc/apparmor.d/bwrap`**, named beside
  the rule block the user writes as root. The flow never runs either.
- **Packages first.** Missing packages are one install command for the machine's manager
  (`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`, `brew`); the user reruns the probe
  after, which may reveal the AppArmor step next. No known manager is `unavailable`.
- **`setup.sh --self-test` maps to `bun test scripts/setup.test.ts`.** This branch's gate
  still calls `--self-test`; the port moved those controls into `setup.test.ts`. The
  wrapper stays the port's otherwise.
- **Test isolation.** Probe controls invoke `probe-confine.ts` by absolute bun path with
  PATH holding only the stubs, so a tool a control wants missing stays missing even when
  the host has it. One control drives the `.sh` wrapper on the host PATH.

## Not done, and why

- **`launch.sh` / `launch.ts` does not read `confine`.** That is #200. Whichever of the two
  lands second merges the other's change.
- **No root command was run.** The probe prints the AppArmor rule; the user runs it.
- **macOS was not tried.** The probe says so on every macOS result; the behavior comes from
  sandbox-runtime's README.

## Acceptance criteria

| # | Verdict | One line |
| --- | --- | --- |
| AC1 | met | `scripts/probe-confine.sh` prints a `probe-trackers`-shape table and footer with `ready`/`partial`/`unavailable`, exit 0; `partial` names the finishing command; `--verdict` prints the word alone. |
| AC2 | met | Restricted user namespaces yield `partial` and name the `/etc/apparmor.d/bwrap` rule (profile for `/usr/bin/bwrap` with `userns,`) plus `sudo apparmor_parser -r /etc/apparmor.d/bwrap`, for the user as root. |
| AC3 | met | A missing package yields `partial` and one install command for the machine's package manager; with no known manager, `unavailable`. |
| AC4 | met | On macOS, `sandbox-exec` and ripgrep present means `ready`, and every macOS result says macOS has not been tried. |
| AC5 | met | `setup.sh` has `confine` `on`/`off` (default `off`), asks once with the probe shown, refuses `on` when the probe says `unavailable`, writes the key otherwise. |
| AC6 | met | The postmaster launch card in `skills/postmaster/SKILL.md` says whether lanes will run confined, reading a missing key as off. |
| AC7 | met | `scripts/probe-confine.test.ts` has a named control for each of `ready`, `partial` and `unavailable`, each forced through stubs for the tools the probe looks for. |
