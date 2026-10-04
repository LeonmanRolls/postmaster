# Workhorse spec: 259 What only degrades on macOS is fixed, or stated with what the user sees

## Problem / feature

[#217, Postmaster runs on macOS, shown by a macOS job in CI and a fixture run on a Mac](https://github.com/brindlewick/postmaster/issues/217) makes postmaster's flow work on a Mac. Some parts will still work worse there than on Linux, and nothing tells the user:

- When Herdr hangs, the check whether it is running never gives up, so a launch or a close waits forever. On Linux it gives up after a few seconds.
- A launch in a Herdr pane or tmux window fails when the caller's environment is larger than the pipe that carries it can hold. A Mac's pipe holds a quarter of what Linux's does.
- After the clock is corrected, as on waking from sleep, postmaster can take the machine to have restarted. It then forgets the launches it started, and a review round stops over a restart that never happened.
- A program stopped by a signal reports the exit code Linux would give, not the Mac's.
- A Claude reviewer's background output may not be collected, because a Mac gives each user a temporary folder of their own.
- A project's ticket prefix may not be found in its commit messages, because the search uses a pattern Apple's grep may not support.
- Setup asks eight questions about launch limits, which nothing applies on a Mac.
- A few rarer differences are not written down anywhere.

Done: the first six work on a Mac as they do on Linux, setup on a Mac stops asking about limits it cannot apply, and the readme tells a Mac user what still differs and what they will see. This is the third of the four tickets split from #217, and it lands after #217.

## Acceptance criteria

1. On a Mac, as on Linux, a launch or a close that finds Herdr not answering stops waiting for it after a few seconds.
2. A launch placed in a Herdr pane or tmux window receives the caller's whole environment, however large it is.
3. On a Mac, postmaster takes the machine to have restarted only when it has, not when its clock is corrected or its time zone changes.
4. On a Mac, a program stopped by a signal reports the exit code a shell on a Mac reports.
5. A Claude reviewer's background output is collected from the user's own temporary folder as well as from the shared one.
6. A project's ticket prefix is found in its commit messages on a Mac as on Linux.
7. On a Mac, setup neither asks about launch limits nor lists them among its settings.
8. On a Mac, setup says once that launches there run without memory or process limits.
9. The readme has a section for Mac users that names each difference left and what the user sees for it.

## Decisions

- **D1 (proposed)** What still differs on a Mac is written in the readme, by the lanes, as part of the change. Why: lanes do not read the wiki, and the wiki records what runs have shown, while nothing has run on a Mac yet. Instead of: a wiki page the coachman writes after the lanes finish.
- **D2 (proposed)** The readme names only the differences left, not every Linux-only part of the code. Why: a fixed item works as on Linux, and the check of [#260, A check refuses new Linux-only constructs in the scripts and runbooks](https://github.com/brindlewick/postmaster/issues/260) keeps the list of Linux-only code. Instead of: the full list with files that the original ticket asked for.
- **D3 (given by the user)** Setup's list of its settings leaves out the limit settings wherever setup does not ask them. Why: the setup conversation asks what that list names. Instead of: listing them on every system, as today.
- **D4 (proposed)** Setup leaves launch limits out on every system but Linux, the only one where postmaster can cap a launch. Why: setup and the launch then decide by the same test. Instead of: probing at setup whether this machine can cap a launch, an answer that can change before the next launch.
- **D5 (proposed)** Launches on a Mac keep running without limits, and saying so, until [#140, Cap each launch's memory and processes on macOS too](https://github.com/brindlewick/postmaster/issues/140) caps them. Why: capping on a Mac needs a trial on a real Mac, which #140 plans. Instead of: capping them here.
- **D6 (proposed)** Whether Muse and MiMo keep each lane's data apart on a Mac is checked when [#205, Research: run the lane-confinement trial on macOS](https://github.com/brindlewick/postmaster/issues/205) runs them there, and until then the readme says it is not known. Why: only a Mac with those agents logged in can show it. Instead of: a check here that cannot run on Linux.
- **D7 (proposed)** On a Mac with no flock command, the postmaster's waiting list keeps its lock-file guard, under which two runs adding at once can, rarely, lose one entry. Why: a Mac can install flock, which the readme suggests, and the only other way is native code. Instead of: native code for a lock the system holds.
- **D8 (proposed)** A path written as a tilde followed by a user's name stays as written on a Mac, and the error names it. Why: a Mac keeps its users outside the file Linux reads them from, and such paths are rare. Instead of: asking the Mac's directory service.
- **D9 (proposed)** On a Mac, a command-line argument that is not valid text is taken with its bad bytes replaced, not refused. Why: a Mac shows a program its raw arguments only through native code, and its terminals send valid text. Instead of: native code to read them.
- **D10 (proposed)** On a Mac, a review round's time limit follows the clock, so setting the clock during a round shortens or lengthens it. Why: it is rare, and time asleep counts the same on both systems. Instead of: deriving the time since start from the Mac's record of its start, which only a Mac can show to work.
- **D11 (proposed)** Changing a Mac's time zone while a run is going makes postmaster lose track of that run's launches, and this is written up, not fixed here. Why: the fix changes how #217's process checks read start times, which #217 keeps as they are on purpose. Instead of: fixing it in this ticket.

## Out of scope

- What breaks the flow on a Mac: #217.
- Postmaster's own tests on a Mac, CI on both systems, and the readme's platforms and Bun minimum: [#258, Postmaster's own tests pass on macOS, and CI runs them on Linux and macOS for every pull request](https://github.com/brindlewick/postmaster/issues/258).
- A check that refuses new Linux-only code: #260.
- Capping launches on a Mac, and asking about limits there again once it does: #140.
- Finding out where Muse and MiMo keep their data on a Mac: #205.
- Keeping track of a run's launches across a change of time zone on a Mac (D11).
- Native code on a Mac to read raw arguments, other users' home folders or a lock the system holds (D7 to D9).

## Direction

Linux and macOS, in the language and runtime of the project's other scripts. On Linux everything behaves as today, except that a large environment now reaches a pane. A run already going when this lands keeps working: what it recorded about the machine's start is read as before. A test that takes the Mac path on Linux says so, never that it ran on a Mac. It does not change the coachman's steps or its contract, so it needs no fixture run. The archived trial scripts and the old ticket oracles are not edited. It lands after #217, whose shared process checks it extends. #258 also edits the readme's requirements, and whichever lands second keeps the other's words.

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

"Forced" means #217's test setting that sends process checks down the Mac path (`POSTMASTER_PROC_ROOT` at a folder that does not exist, in #217's draft). Every `host.sh` call sets `POSTMASTER_HOST_STATE` to a scratch folder. A stand-in is a script placed first on PATH.

- **C1** A stand-in `herdr` that never returns, and a PATH with no `timeout`: `host.sh close <dir>` → exit 0 within 10 s, no Herdr pane closed; `host.sh run` with `POSTMASTER_HOST` unset → `host=tmux` or `host=none` within 10 s; with `timeout` on PATH, the same as today. **At the base:** without `timeout`, `host.sh close` had not returned after 20 s (stopped from outside, exit 124); with it, exit 0 after 5 s.
- **C2** `host.sh run` under the self-test's Herdr stub and under tmux, with a 100,000-byte variable in the caller's environment, and again with a 1,000-byte one → the command runs in the pane, prints the variable's full length, no "environment never arrived", and the marker lands after it exits. **At the base:** `host.sh _env-write` with the 100,000-byte variable and a reader that waits 1 s delivered 65,536 bytes and no end mark, so the runner would report "the caller's environment never arrived"; with 1,000 bytes, everything arrived.
- **C3** Forced, with a stand-in `sysctl` whose `kern.boottime` changes its microseconds and its date text between calls while `kern.bootsessionuuid` stays the same: a launch started by `host.sh run` is still found and stopped by `host.sh stop <cwd>`, and `review-round.sh check` on a round started before the change reports no restart. When `kern.bootsessionuuid` changes → the record is dropped and `check` reports the restart. With `kern.bootsessionuuid` refused → the same, read from the whole seconds of `kern.boottime`. A registry record and a round state written by the base's code on the same boot still match. Unforced, the Linux boot id is read as today. **At the base:** both places compare the whole text of `kern.boottime`, microseconds and local date included (read from the code; the setting does not exist yet).
- **C4** A child stopped by each signal in `os.constants.signals`, through `run()` → 128 plus that system's number; with the Mac's numbers in place of the running system's, SIGUSR1, SIGBUS and SIGSYS → 158, 138 and 140. **At the base:** Linux's table answers 138 for SIGUSR1 whatever the system's numbers.
- **C5** `review-findings.sh harvest` with `TMPDIR` at a folder outside `/tmp/claude-<uid>` and a task output under `<TMPDIR>/claude-<uid>/` → copied, exit 0; an output under `/tmp/claude-<uid>/` → copied, as today; an output outside both → refused with "Claude task output is outside", as today. **At the base:** the root is `/tmp/claude-<uid>` whatever `TMPDIR` says (read from the code).
- **C6** `discover-project.sh` on a repository whose commits name ABC-1 to ABC-3, with a stand-in `grep` that exits 2 → `tracker_prefix=ABC`, the same as with the real grep. **At the base:** with the stand-in, `tracker_prefix=` and exit 0; with the real grep, `tracker_prefix=ABC`.
- **C7** With a stand-in `uname` that prints `Darwin` for `-s`: `setup.sh --keys` lists no `limits.` key, and `setup.sh --answers <file> --dry-run` with `limits.memory_max=bogus` → exit 0, no limit question, no `[limits]` table. Without the stand-in, on Linux → the eight keys listed, and the same answers refused naming `memory_max`, exit 1. **At the base:** with the stand-in, `--keys` listed the eight keys and the answers run asked the limit question and refused `bogus`, exit 1.
- **C8** The same runs, interactive and with answers → with the stand-in, exactly one line saying launches on this system run without memory or process limits; on Linux, no such line. **At the base:** no such line; the limits header prints on every system.
- **C9** The readme's section for Mac users, read against D5 to D11 → one entry for each, plus one saying the archived trial scripts and old ticket oracles run on Linux only, each saying what the user sees; no entry for what C1 to C6 fix, no file named; `bun run check` passes. **At the base:** no such section, and the readme does not mention a Mac.

### Technical notes

- [`limit()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L209-L211) runs `timeout` only where it is on PATH, and [`herdrUp()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L244-L246) is the only Herdr call given a limit (5 s), reached from `detect()` and [`closeCmd()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2927-L2948). [`run()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/lib/proc.ts#L60-L119) takes `timeout` in milliseconds and sets `timedOut`. The systemd probe's own `timeout` (L1749-L1753) runs on Linux only. (C1)
- [`envWrite()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2002-L2028), started as `_env-write` by the Herdr and tmux placements ([L2550-L2560](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2550-L2560)), writes a FIFO opened with `O_NONBLOCK` and returns on any error but `ENXIO` and `ENOENT`, so `EAGAIN` mid-write abandons the rest. `_writeEnvPipe()` (L1897-L1920) has no caller. [`readEnvPipe()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L1922-L1966) waits 30 s for `POSTMASTER_ENV_OK=1`, then the runner prints "the caller's environment never arrived" ([L2057-L2068](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2057-L2068)). A Mac FIFO holds 16 KiB, Linux's 64 KiB. (C2)
- [`bootId()` in host.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L506-L513) and [in review-round.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/review-round.ts#L49-L57) fall back to the whole text of `sysctl -n kern.boottime`, `{ sec = …, usec = … } <date in local time>`. The registry drops a record whose boot differs ([L697](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L697)), and [`review-round.sh check`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/review-round.ts#L163-L172) stops with "the machine has restarted since the round started". Read `kern.bootsessionuuid` first, then the `sec` value as [`bootTime()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L514-L528) reads it. [`monotonic()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/review-round.ts#L40-L47) stays as it is. (C3, D10)
- The boot id read joins #217's shared process module and follows its test setting, so a forced run reaches the `sysctl` path on Linux; the Linux read is unchanged. A record or round state whose boot equals the old text form, read now, still matches, so a run already going keeps its launches. `host.ts` and `review-round.ts` are not in [`docs/coachman-contract.toml`](https://github.com/brindlewick/postmaster/blob/40d50ce/docs/coachman-contract.toml); `host.sh` is, and does not change. (C1, C2, C3)
- [`SIGNAL_NUMBERS` and `signalExitCode()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/lib/proc.ts#L18-L58) hold Linux's numbers, and nothing in the scripts reads `os.constants.signals` yet. On a Mac SIGBUS is 10, SIGUSR1 30, SIGUSR2 31, SIGSYS 12 and SIGCHLD 20. (C4)
- [`harvest()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/review-findings.ts#L1277-L1300) resolves its root from `/tmp/claude-<uid>` or the fixture override. Accept `<os.tmpdir()>/claude-<uid>` as well, resolved the same way, and refuse anything else as today. (C5)
- [discover-project.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/discover-project.ts#L101-L111) spawns `grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b'` over `git log --oneline -200`. Match in-process with GNU grep's word boundaries in a UTF-8 locale, where a letter, digit or underscore on either side blocks a match, and keep the ranking below it. (C6)
- [setup.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/setup.ts#L151-L197): `--keys` (the limit lines L176-L183), the [limit questions](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/setup.ts#L373-L405) and the [`[limits]` table](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/setup.ts#L524-L527). Read the system as [`systemdCapability()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L1734-L1739) does, `uname -s` found on PATH, so the stand-in forces it. Limit answers given on a Mac are neither checked nor written. [setup.test.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/setup.test.ts#L117) reads `--keys`. (C7, C8, D3, D4)
- The launch's uncapped notices at [L2181](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2181) and [L2494](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2494) stay. [hosts.md](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/hosts.md#L129-L141) and [config.example.toml](https://github.com/brindlewick/postmaster/blob/40d50ce/config.example.toml#L72-L80) already say the caps need Linux with systemd. (D5)
- The section goes after "What it needs" ([README.md](https://github.com/brindlewick/postmaster/blob/40d50ce/README.md#L172-L180)), whose requirements #258 rewrites. It covers D5 to D11, says the archived scripts under `raw/trials/` and the root `oracle-*.sh` files run on Linux only, and names no file. (C9, D1, D2)
- flock runs at [host.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L4575-L4584) with `--exclusive` and at [run-meta.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/run-meta.ts#L190-L194) with `-n`. Without it the waiting list falls back to the pid-file mutex, `legMutexTake()`, whose comment names the steal race. Pass `-x` for `--exclusive`, a form util-linux and the flock Homebrew installs both accept. (D7)
- [`expandUser()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/project-settings.ts#L108-L127) reads `/etc/passwd`. [`rawArgvBytes()`, `argvHasUndecodableBytes()` and `argvDecoded()`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/lib/proc.ts#L121-L222) keep the runtime's decoding without `/proc`; [runs-watch.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/runs-watch.ts#L1385-L1400) and [parallel-runs-acceptance.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/parallel-runs-acceptance.ts#L333-L348) re-read the raw arguments only for a `--` right after the script, which no caller passes. None of them changes. (D8, D9)
- Muse and MiMo get `XDG_DATA_HOME` at [launch.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/launch.ts#L373-L395) L373-L395, L522 and L1397-L1407, and at [export-session.ts](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/export-session.ts#L286-L296). Nothing changes there. (D6)
- On a Mac, start times come from `ps -o lstart=`, printed in local time, into the registry and the leg locks; #217 keeps that form so that records written before it still match. (D11)

### Verified at 40d50ce

- #217 has not landed here, so its shared process module and test setting do not exist and C3's forced run cannot be tried. The ticket is checked again at its dispatch commit, after #217.
- Run here: C1 (no return in 20 s without `timeout`; exit 0 after 5 s with it), C2's reproduction (65,536 of about 104,500 bytes and no end mark; all of a 1,000-byte variable), C6 (an empty prefix with a grep that exits 2) and C7 (eight keys; the answers run refused `bogus`, exit 1).
- Read from the code: C3, C4, C5, C8 and C9. Every file, function and line range cited reads as described.
- Taken from macOS documentation and the audit, not tried on a Mac: `kern.bootsessionuuid`, a FIFO's 16 KiB, `lstart` in local time, a per-user temporary folder, Apple's grep and the flags of Homebrew's flock.

