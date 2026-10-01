# Workhorse spec: #200 Confine every lane with sandbox-runtime

## Summary

With `confine = "on"` in the machine config, every lane harness `scripts/launch.sh` starts is
wrapped from the outside in Anthropic's sandbox-runtime (`srt`), so bypass mode stays on and one
OS-agnostic path covers all five harnesses. The wrap lives in the launch's own spawn; `run.json`
records whether the run was confined and which sandbox-runtime version it used; `harnesses.md`
records each harness's allowed paths and hosts; `launch.sh --self-test` proves the allow-lists
with paired positive and negative controls.

## Technical context

- **Language and version**: TypeScript run by Bun (the user's word for this ticket), from the
  #109 port at `c70e592819302001e8ef3a358781a9ca4b5b5232`. Shell wrappers stay two-line.
- **Dependencies used or added**: none new in `package.json` beyond what the port copy brings
  (`typescript`, `@biomejs/biome`, `oxlint`). sandbox-runtime is an external CLI (`srt`), not an
  npm dependency of this repo: it is found on `PATH` or via `POSTMASTER_SRT`, and its pinned
  version is recorded, never vendored into the tree.
- **Testing**: `scripts/launch.sh --self-test` (gate form; runs the bun tests below),
  `bun test scripts/launch.test.ts scripts/run-meta.test.ts scripts/lib/confine.test.ts`,
  `bun run lint`, the full project gate from the brief, and a fixture run with `confine = "on"`
  scored by `scripts/fixture.sh score`.
- **Constraints**: bypass flag unchanged on every harness form; one code path with no OS name;
  `confine` key read by `launch.sh` only (`setup.sh` / `config.example.toml` are #201's); never
  run a confined lane unconfined; pin and record the sandbox-runtime version; no wiki/`raw/`
  reads; lanes stay in blinkers.

## Direction check

| Constraint (ticket direction and project rules) | How this plan meets it |
|---|---|
| Wrap the harness from the outside at the point `launch.sh` runs it | `launch.ts` builds an `srt --settings <file> -- <harness> <args…>` argv around the form it already builds; `form` output and the harness's own flags (bypass included) are untouched |
| Bypass mode stays on for every harness | The wrap is outside the form; `harnesses.md` forms are not edited for confinement |
| One mechanism covers all five harnesses | One settings builder + one wrap, parameterised only by the harness's allow-list table |
| The trial shim is a starting point, not a design | Allow-lists become data beside the code (`harnesses.md` is the record; `lib/confine.ts` holds the machine); the temp folder and opened launch files are computed per launch, not hard-coded per harness |
| Shared git `hooks` and `config` stay read-only (shared clones are #203) | Those two paths go in `denyWrite` / read-only in the srt settings, taken from the worktree's git common dir |
| sandbox-runtime is a research preview: pin its version | Resolve `srt` once per run, record `version` + path in `run.json` at dispatch; every confined launch/resume in that run uses that path and refuses a mismatch |
| `confine` key shared with #201: this ticket only reads it | `launch.ts` reads top-level `confine` (`on`/`off`, absent = off) from the live config or the run's recorded config; no write to `setup.sh` or `config.example.toml` |
| Deterministic work in `scripts/`, not prose | Settings build, wrap, host merge, version probe and self-test controls are TypeScript with tests |
| A prompt lives in argv / prefer `--prompt-file` | Unchanged; the prompt file is opened as a read-only allow in the sandbox settings |
| Every count needs a control | AC6's self-test pairs each confinement step with the same step unconfined (positive) and confined (negative) |
| Every action logged | No new log actions; confinement is part of `launch`, already logged |
| TypeScript rule for this ticket | All new/changed script logic is `.ts` beside tests; `scripts/*.sh` remain parseable wrappers |
| Copy port files unchanged first, then change TypeScript | One commit is a pure `git show c70e59281930:<path>` copy; ticket work follows only in TypeScript and the two runbooks |
| Fix an open PR's gaps in that PR, not a new ticket | This is a workhorse on #200, not a PR review; nothing here files or widens another PR |
| Worktree only, never push, never other branches | All work in `/home/brindlewick/postmaster/.worktrees/200-mimo` on `wb/200-mimo` |

## Structure

**Copied unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232` (own commit):**

- `scripts/launch.ts`, `scripts/launch.test.ts`, `scripts/launch.sh` (wrapper)
- `scripts/run-meta.ts`, `scripts/run-meta.test.ts`, `scripts/run-meta.sh` (wrapper)
- `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `scripts/lib/text.ts`, `scripts/lib/text.test.ts`
- `bunfig.toml`, `package.json`, `tsconfig.json`, `bun.lock`, `biome.json`, `.oxlintrc.json`
- `types/` only if the port's `tsconfig` includes it and the copied sources need it

**Changed or added for #200:**

- `scripts/lib/confine.ts` — resolve `srt`, build the settings document, wrap a command,
  merge hosts, the git `hooks`/`config` read-only rule, the lane temp dir
- `scripts/lib/confine.test.ts` — unit controls for the builder and the host merge
- `scripts/launch.ts` — read `confine`, wrap `launch`/`resume`/`review` spawns when on;
  `--self-test` runs the bun test files the gate names; fail-closed on a missing `srt`
- `scripts/launch.test.ts` — confinement controls (AC2–AC4, AC7) with paired positives
- `scripts/run-meta.ts` — record `sandbox.confine` and `sandbox.sandbox_runtime_version` /
  `sandbox.sandbox_runtime_path` in `run.json` at dispatch
- `scripts/run-meta.test.ts` — those fields, on and off, and a missing `srt`
- `package.json` — restore a `lint` script so `bun run lint` (the gate) works beside the
  port's `check`
- `skills/postmaster/harnesses.md` — a Confinement section: per harness, allowed paths and hosts
- `skills/postmaster/coachman.md` — Lane capability: lanes run confined; drop the claim that no
  harness has mechanical enforcement; no restatement of the wiki's `lane-confinement` reasoning

**Unchanged on purpose:** `scripts/setup.sh`, `config.example.toml` (#201), `scripts/fixture.sh`
unless the fixture cannot carry `confine = "on"` through `POSTMASTER_CONFIG` (it can today).

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Confinement applies to workhorse and reviewer launches, not to the coachman or postmaster | The coachman must read every lane's worktree to synthesize; confining it would break the flow | Confining every `launch.sh` process would close the coachman out of the work it is given |
| `launch.sh --self-test` delegates to `bun test` | The #109 port moved the old bash self-test into `launch.test.ts`; the gate still invokes `--self-test` | Keeping the bash self-test would fork the suite the port already owns and break the "copy the port" rule |
| Alternate API backends from a lane `env_file` are not auto-allowed | Flow rule: env files are named, never read | Parsing env files for hosts would read secrets-adjacent user files the design says stay opaque; a project lists those hosts in `confine_hosts` |

## Decisions

1. **What "confine" covers.** Workhorse and reviewer launches and resumes (and a reviewer's
   `review` form launch). The coachman and the postmaster run unrestricted: the coachman's job
   is to read the lanes. `POSTMASTER_LAUNCH_ROLE` / the name already distinguish them.
2. **Where `srt` comes from.** `POSTMASTER_SRT` if set, else `srt` on `PATH`. Absent or not
   executable with `confine = "on"` is a launch failure (AC7), never an unconfined run.
3. **What `run.json` records (AC7, AC8).** At dispatch `run-meta` writes:
   `"sandbox": { "confine": "on"|"off", "sandbox_runtime_version": string|null, "sandbox_runtime_path": string|null }`.
   `confine` is the effective key (absent → `"off"`). Version and path are the resolved `srt`
   when confine is on, `null` when off. Under `--run`, a confined launch uses the recorded path
   and refuses if it is missing, not executable, or reports a different version — exit 1, naming
   what is missing.
4. **One OS-agnostic path.** A single `wrapWithSrt(cmd, args, settings)` used by every confined
   spawn. Settings are the JSON shape the trial used
   (`filesystem.denyRead/allowRead/allowWrite/denyWrite`, `network.allowedDomains/deniedDomains`).
   No `linux`/`darwin` branch in this repo; Bubblewrap vs Seatbelt is `srt`'s own choice.
5. **Paths (from the trial allow-lists, parameterised).** Read-only: the system; harness installs
   (`~/.local/bin`, `~/.local/lib`, `~/.local/opt`, `~/.local/share/claude`, `~/.local/share/pi`);
   `~/.gitconfig`, `~/.config/git`; `~/.agents`; the tool's own repo; the `srt` install; plus
   each harness's config that the trial kept read-only (mimo: `~/.config/mimocode`, `~/.mimocode`,
   `~/.claude/CLAUDE.md`, `~/.claude.json`). Read-write: the worktree (launch cwd); the git
   common dir (so a worktree commits into the shared store); the harness's own state
   (codex `~/.codex`, claude `~/.claude` + `~/.claude.json`, muse `~/.config/muse` + its
   `XDG_DATA_HOME`, mimo `~/.cache/mimocode` + `~/.local/state/mimocode` + its `XDG_DATA_HOME`,
   pi `${PI_CODING_AGENT_DIR:-~/.pi/agent}`); npm cache `~/.npm`; a per-lane temp dir. Home is
   otherwise hidden (`denyRead`).
6. **Git `hooks` and `config` (AC4).** Resolved from `git rev-parse --git-common-dir` in the
   worktree; both paths are read-only in the settings (`denyWrite`, still listed readable).
   Covers a worktree's file-form `.git` that `srt` itself skips.
7. **Lane temp dir.** `<cwd>/.lane-tmp`, created before the spawn; `TMPDIR` and
   `CLAUDE_CODE_TMPDIR` both point at it (the trial's reason: `srt` otherwise hands
   `TMPDIR=/tmp/claude`, which does not exist). Removed is left to the worktree; a lane may
   keep using it.
8. **Launch-named files.** The prompt file is read-only in settings; codex's `--last` /
   `-o` file is read-write and touched first so it exists (existing launch behaviour).
9. **Hosts (AC5).** Per-harness hosts from the trial, plus always `registry.npmjs.org` and
   `github.com`, plus `confine_hosts` from the project's settings (`[project] confine_hosts`
   in `.postmaster/project.toml`, and the same key in local `settings.toml` if present —
   both merge). Anything else is refused. `harnesses.md` records the per-harness rows.
   Starting hosts: codex `chatgpt.com`, `*.chatgpt.com`, `*.openai.com`; claude
   `api.anthropic.com`, `*.anthropic.com`, `claude.ai`, `platform.claude.com`; muse
   `api.meta.ai`, `*.meta.ai`, `auth.meta.com`; mimo `*.xiaomimimo.com`, `mimo.xiaomi.com`;
   pi — the trial used loopback, so a task finds pi's real API hosts from its docs/help before
   the table is written. Uncertain names stay out of the table rather than over-allowed.
10. **Self-test (AC6).** When `srt` resolves, `--self-test` runs a plain `sh` through
    confinement against a fixture worktree, git dir, temp dir, prompt file and `~` probe, and
    for each AC2–AC4 item runs the same step unconfined (must succeed) and confined (must be
    refused or silently not reach the disk, per the item). When `srt` does not resolve, those
    controls are skipped by name and the self-test still exits 0 so the project gate passes on
    a machine that has not installed a research preview; the summary records the srt-present
    run.
11. **pi hosts.** Decided at implementation from pi's own help/docs or a one-shot probe, then
    written into `harnesses.md`; not guessed in this spec.
12. **`form` stays bare.** Confinement wraps the spawn only; `launch.sh form` still prints the
    harness's own command, so the bypass-flag self-test and every runbook stay valid.
13. **Gate entry after the port copy.** `launch.sh --self-test` and `run-meta.sh --self-test`
    run the corresponding bun tests (exit status is the test run's). Every other `*.sh
    --self-test` in the gate is untouched.

## Tasks

- [ ] T001 [P] Copy the #109 port files unchanged from `c70e592819302001e8ef3a358781a9ca4b5b5232`
      (`scripts/launch.ts`, `scripts/launch.test.ts`, `scripts/launch.sh`, `scripts/run-meta.ts`,
      `scripts/run-meta.test.ts`, `scripts/run-meta.sh`, `scripts/lib/{data,paths,proc,text}.ts`
      and `text.test.ts`, `bunfig.toml`, `package.json`, `tsconfig.json`, `bun.lock`,
      `biome.json`, `.oxlintrc.json`) and commit the copy alone; add a `lint` script so
      `bun run lint` runs; make `launch.sh --self-test` and `run-meta.sh --self-test` run the
      bun tests so the gate stays green.
- [ ] T002 [P] [AC5] Record each harness's confinement paths and hosts in
      `skills/postmaster/harnesses.md`, and find pi's real API hosts (task 11). No wiki reasoning.
- [ ] T003 [AC1] [AC2] [AC3] [AC4] Add `scripts/lib/confine.ts` and `scripts/lib/confine.test.ts`:
      resolve `srt`, build the srt settings document (allow-lists, lane temp dir, prompt/last
      files, git common-dir `hooks` and `config` read-only), merge harness hosts with
      `registry.npmjs.org`, `github.com` and project `confine_hosts`, and wrap a command as
      `srt --settings <file> -- <cmd…>` with no OS name in the path.
- [ ] T004 [AC1] [AC7] Wire `scripts/launch.ts` so `launch`, `resume` and `review` for a
      workhorse or reviewer spawn through the wrap when `confine` is on; keep the harness form
      and bypass flag unchanged; exit 1 naming what is missing when `srt` cannot start; never
      fall back to an unconfined run; `confine` off or absent behaves as today.
- [ ] T005 [AC7] [AC8] Extend `scripts/run-meta.ts` so `run.json` records
      `sandbox.confine`, `sandbox.sandbox_runtime_version` and `sandbox.sandbox_runtime_path`;
      under `--run` a confined launch uses that path and refuses a missing or mismatched `srt`.
- [ ] T006 [AC6] Extend `scripts/launch.test.ts` with the confinement self-test: a plain shell
      through the wrap, every AC2–AC4 item with a positive control unconfined and a negative
      control confined; skip by name only when `srt` is absent.
- [ ] T007 [AC10] Update the Lane capability section of `skills/postmaster/coachman.md`: lanes
      run confined when `confine` is on; remove "No harness has verified mechanical write
      enforcement"; no restatement of wiki `lane-confinement` reasoning in either runbook.
- [ ] T008 [AC9] Run a fixture with `confine = "on"` and score it clean under
      `scripts/fixture.sh score`; change `scripts/fixture.sh` only if the fixture config cannot
      carry the key (it can through `POSTMASTER_CONFIG`).
- [ ] T009 [AC2] [AC3] [AC5] [AC6] [AC7] [AC8] Run the full gate from the brief to green, then
      `<tool>/scripts/verify.sh run .`, and write `WORKHORSE-SUMMARY.md`.
