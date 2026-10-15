# What it needs, and notes for macOS

## What it needs

**Linux and macOS** are supported. Apple silicon Macs are tested; Intel Macs are not tested.
At least two agent CLIs that can run headless. Any git repository as a target. A session host
to watch the fleet in: [Herdr](https://herdr.dev) by default wherever it is running, where each
launch appears in its worktree's space under the project's, or tmux. With neither, launches run
in the background and the flow still works (`skills/postmaster/hosts.md`). Bun 1.4.2 or newer, which
runs the TypeScript scripts and reads the config, and Node and npm, which the fixture flow
needs to run its gate.

## On a Mac

The flow runs on macOS. What still differs from Linux, and what you see for it:

- **Launches run without memory or process limits.** Caps need Linux with systemd, so a Mac
  launch says `launch running uncapped (no supported per-launch limits available)` and runs
  as it is. [#29](https://github.com/LeonmanRolls/postmaster/issues/29) plans to cap them
  there.
- **Whether Muse and MiMo keep each lane's data apart is not known.** Only a Mac with those
  agents logged in can show it, so until
  [#50](https://github.com/LeonmanRolls/postmaster/issues/50) runs that trial there, nothing
  here claims they do or do not.
- **Without `flock`, two runs adding a waiting question at once can rarely lose one entry.**
  macOS ships no flock, and the waiting list then falls back to its lock-file guard. Installing
  flock (Homebrew's) gives it the kernel lock again; until then, one of two simultaneous
  additions may be dropped.
- **A path written as `~username` for another user stays as written.** macOS keeps its users
  outside the file Linux reads them from, so such a command fails with an error naming the
  path exactly as you wrote it.
- **An argument that is not valid text is taken with its bad bytes replaced, not refused.**
  macOS shows a program its raw arguments only through native code, and terminals send valid
  text, so you will not normally see it; if it happened, the argument would arrive with
  replacement characters instead of an error.
- **A review round's time limit follows the clock.** Setting the clock while a round runs
  shortens or lengthens its time left. Time spent asleep counts just as it does on Linux.
- **Changing the time zone while a run is going makes the run lose track of its launches.**
  Stop and close no longer find the launches that were started before the change, so they are
  left running. Change the time zone between runs.
- **The archived trial scripts under `raw/trials/` and the root `oracle-*.sh` files run on
  Linux only.** On a Mac they produce no result.

Back to the [README](../README.md).
