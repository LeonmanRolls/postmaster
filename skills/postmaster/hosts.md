# Session hosts

Every host-specific fact in the flow lives here and nowhere else. The runbooks say "through
`<tool>/scripts/host.sh`"; this file says what that means on each host. When a host changes, this file
changes and the runbooks do not. `<tool>` is the postmaster repo, as the runbook that sent you here
found it.

**`<tool>/scripts/host.sh` is the executable form of this file.** The two change together. A form the
script does not have is a form this file has not recorded yet.

A host decides two things only: where a launch runs, so the user can watch it, and what keeps
the interactive postmaster alive between turns. **It never changes what a launch is.** Every
lane and every coachman leg is the same headless command on every host: `<tool>/scripts/launch.sh`'s
form, its events stream to its events file, its errors to its `.err` file, its marker touched
when it exits, and then it exits. An idle thread is a native session on disk, never a process.

## Which host

`<tool>/scripts/host.sh detect` prints `herdr`, `tmux` or `none`:

| host | when |
|---|---|
| `herdr` | a Herdr server answers (`herdr workspace list` exits 0), whether the caller is in a Herdr pane or not |
| `tmux` | no Herdr server answers, and tmux is on PATH |
| `none` | neither |

**Herdr is the default wherever it is present, and nothing needs configuring to get it or to do
without it.** `POSTMASTER_HOST=herdr|tmux|none` overrides detection for a user who wants another;
a forced host that is not there falls back to detection, with a warning. The flow runs the same
way on every row, only less visibly on the last.

## The forms

| form | herdr | tmux | none |
|---|---|---|---|
| run a headless launch, visibly | a new tab in the space of the worktree the launch runs in, nested under the repository's space | a window in session `postmaster-<repo>` | a detached background process |
| spawn the interactive postmaster | `herdr agent start` in a fresh tab of the repository's space, never a pane an agent ran in before | a window in session `postmaster-<repo>` | not possible: it runs headless, below |
| send it a message | `herdr agent prompt` | paste the text bracketed, then Enter as a key of its own | resume its thread with the message as the prompt |
| wait for it to settle | the same call, `herdr agent prompt --wait`: idle, done or blocked | its screen unchanged for 10 seconds | its marker lands |
| read what it said | `herdr agent read --source recent-unwrapped` | `tmux capture-pane -p -J` | its final message (`harnesses.md`) |
| close a worktree's space | `herdr workspace close`, before the worktree is removed | kill the worktree's windows | nothing to close |

```sh
<tool>/scripts/host.sh detect
<tool>/scripts/host.sh name <dispatch> [<role or lane>]
<tool>/scripts/host.sh run <name> <cwd> [--out <file>] [--err <file>] [--append] [--marker <file>] [--pidfile <file>] -- <command...>
<tool>/scripts/host.sh stop <worktree>
<tool>/scripts/host.sh close <worktree>
<tool>/scripts/host.sh spawn <handle> <cwd> [--label <name>] -- <interactive form>
<tool>/scripts/host.sh send <handle> <file> [--wait [<seconds>]]
<tool>/scripts/host.sh wait <handle> [<seconds>]
<tool>/scripts/host.sh read <handle> [<lines>]
```

**Send and wait as one command, `send --wait`.** On Herdr a separate `wait` straight after a
message can return the previous turn's settled state before the new turn starts; `wait` alone
is for a session nothing was just sent to. `send --wait` and `wait` exit 3 when the session did
not settle in time, stopped at an approval or a question, or showed no turn at all. Herdr can
report that last for a turn that did run, and a harness just started can look ready before it
takes input and drop what it is sent, so read the session before sending the message again.
`spawn` refuses a handle a live session already has, and says so when the harness stops on its
first start to ask something, such as whether to trust the folder: the user answers it in the
pane. `spawn`, `send`, `wait` and `read` exit 3 on `none`.

## Run, on every host

- **The command is the one a caller would have backgrounded with `&`.** It runs from the
  directory `host.sh` was called in, with the caller's environment and an empty stdin, its
  stdout to `--out` and its stderr to `--err`. `<cwd>` places it: the worktree whose space shows
  it. It runs in a session of its own with no terminal, so a prompt for a password or a host key
  fails at once instead of waiting; stopping its pane still stops it.
- **Its marker means it ended.** `--marker` is removed as the launch starts, so an earlier one is
  never mistaken for it, and touched when it exits, whatever its exit. If `host.sh` cannot start
  it at all, the marker lands anyway and `--err` says why.
- **`--append` is for a resume**, which is a run like any other, with `<tool>/scripts/launch.sh resume
  ...` as the command: it adds to `--out` instead of emptying it, while `--err` always holds only
  the latest process's errors. A stream is only ever appended to after being emptied once, so a
  second writer on the same file cannot overwrite the first.
- **`--pidfile` gets its pid, which is also its process group:** `kill -- -<pid>` stops all of
  it. `host.sh run` returns as soon as the launch has started. The wait still goes in the same
  command as the launch, as `<tool>/scripts/wait-for-markers.sh`, or for a review round
  `<tool>/scripts/review-round.sh wait`.
- **A launch outlives its caller.** It belongs to the host's server, or with no host to a session
  of its own, so a caller's background-task cap or its exit does not reach it.
- **A launch carries its own pane's identity, never its caller's**: `HERDR_PANE_ID`, the tab and
  space ids and `TMUX_PANE` are those of the pane it runs in, and are unset with no host. A
  harness's own Herdr integration reports to whatever pane those name. Its environment reaches
  the pane through a FIFO and a pipe, never a file on disk or a command line.
  [Why a launch must own its pane](../../wiki/concepts/herdr-headless-launches.md)
- **`<name>` is the run's name, then the role or lane:** `<ticket>, <ticket title> · <role or
  lane>`, for example `#36, Run the style, bug and security reviews in parallel · coachman`.
  Take it from the waybill, `"$(<tool>/scripts/host.sh name <dispatch> <role>)"`, never by typing it:
  a ticket's title can hold anything a shell would run. It labels the space when `host.sh`
  opens it, and the tab or window, and is the pane's terminal title while the launch runs, which
  is what a Herdr client shows for a pane with an agent in it. `POSTMASTER_LAUNCH_NAME` carries
  it to `launch.sh`, which names the thread where the harness can (`harnesses.md`).
- **The pane shows the stream, not the JSON**: `<tool>/scripts/view-stream.sh` renders each event
  of interest as wrapped lines — what the agent says and runs, in full — each with its time.
- **Every launch is registered while it runs**, under `POSTMASTER_HOST_STATE` (default
  `~/.postmaster/host`), with the worktree it was placed in, whatever host ran it. `host.sh stop
  <worktree>` stops every launch running there and everything each one started, even in a
  session of its own, as a harness runs a tool command: TERM first, then KILL to whatever is left
  after 20 seconds (`POSTMASTER_HOST_STOP_WAIT`), and exit 2 naming anything still running. It
  never runs from inside that worktree, which would stop the caller too. `host.sh close
  <worktree>` refuses while one runs there, after waiting 15 seconds for one that is just ending.
- **It degrades rather than refuses.** If the host cannot place the launch, or its pane has not
  started it within 20 seconds, it runs in the background instead, exactly once, and `host.sh`
  prints `host=none` rather than where it would have been.

## herdr

- **Placement.** `herdr worktree list --cwd <cwd>` names the repository and the space its own
  checkout is open in; with none, `host.sh` opens it as `herdr workspace create --cwd <repo>
  --label <repo name>`, so the tree has a root. A worktree whose space is open gets a new tab
  there. Otherwise `herdr worktree open --workspace <repository's space> --path <worktree>
  --label <name>` opens it, which is what nests it under the repository's space. A detached
  reviewer scratch opens the same way. The repository's own checkout gets a tab in its own space.
  A reviewer's scratch clone (`cut-scratch.sh --clone`) is a repository of its own to Herdr, so
  it opens as a space of the launch's own, as a directory outside any repository does;
  `cut-scratch.sh --kind` is what tells it from a repository the user works in.
- **The tree today** is one level deep, by worktree: the repository's space holds the
  postmaster; under it, the synthesis worktree's space holds each coachman leg as a tab, and each
  workhorse's and each reviewer's worktree has a space of its own. Workhorses sit beside their
  coachman, not under it: Herdr 0.9.1 cannot nest one agent under another.
- **Ownership.** `host.sh` marks what it opens with Herdr metadata tokens: a space
  `postmaster=opened`, a pane `postmaster=launch`. `host.sh close` closes a space only when it
  carries the token and every pane in it does, and nothing registered runs there. It never
  closes a repository's own space, a scratch clone's aside, never uses `workspace close
  --group`, and never runs `herdr worktree remove`, which deletes the checkout. Close a space
  before removing its worktree.
- **State.** The pane reports its launch `working` as it starts, under the agent label
  `headless`, and releases it (`pane release-agent`, same label) when the launch exits. Left to
  itself Herdr shows a headless harness as idle. A closing `idle` report does not work: Herdr
  ignores it while anything still runs in the pane.
  [The evidence](../../wiki/concepts/herdr-headless-launches.md)
- **The pane** runs one typed line, ` '<host.sh>' _run herdr '<spec>'`, with a leading space so
  a shell that honours it keeps it out of its history. After the launch the pane's shell stays
  at its prompt with the view above it. Closing the pane or its space stops a launch still
  running, and its marker still lands, touched by a watcher outside the pane; the flow then finds
  no hand-off or summary and treats the launch as spent.
- **`spawn`** passes the caller's `POSTMASTER_*` settings to the new pane, so the postmaster
  runs on the same config and host as the session that started it.
- **Never** prompt, close, move or rename a pane, tab, space or agent `host.sh` did not open, and
  never stop or restart the Herdr server.

### When Herdr ships `--parent`

[herdrdev/herdr#3153](https://github.com/herdrdev/herdr/issues/3153) proposed a `spawned_by` on
the agent record, set by `--parent <agent>` on `herdr agent start`, and a row nested under its
parent in the agents panel; the maintainers say it is planned. A headless launch is not started
with `herdr agent start`. It is a pane whose agent `host.sh` reports. So when it ships:

1. Record here which calls take a parent, and what they accept.
2. If `pane report-agent` takes one, `host.sh run` passes the caller's own pane, the
   `HERDR_PANE_ID` in its own environment: the coachman's pane for each of its lanes, the
   postmaster's for each leg. That nests each lane under its coachman with no change to any
   runbook, and the worktree spaces stay as they are.
3. If only `herdr agent start` does, nesting needs lanes started as interactive agents, which
   changes the coachman contract: issue #16, not this adapter.

## tmux

- One session per repository, `postmaster-<repo>` (the repository's basename, with `.` and `:`
  replaced), created detached on first use; a scratch clone's windows go in the session of the
  repository it was cut from. Each launch is a window named `<name>`, with the window option
  `@postmaster_cwd` set to its worktree and `@postmaster_state` to `running`, then `done`. After
  the launch a shell stays in the window.
- A window's command starts with the tmux server's environment; `host.sh` hands the caller's
  across the same way as for Herdr, and `spawn` passes the caller's `POSTMASTER_*` settings.
- `host.sh close <worktree>` kills that worktree's windows once nothing registered runs there.
- Sending: `tmux load-buffer` from the file, `tmux paste-buffer -p` so an application that asked
  for bracketed paste gets it, then `tmux send-keys Enter` as a key of its own. Settled means
  the screen has not changed for 10 seconds (`POSTMASTER_HOST_QUIET`).
- Kill only a session you created, and read a pane (`tmux capture-pane -p`) before killing it.

## none

- A launch is a detached process in a session of its own, with no terminal. There is nothing to
  watch but its files: `<tool>/scripts/runs-status.sh`, the events file, and
  `<tool>/scripts/view-stream.sh < <events-file>` for the readable form.
- **The postmaster runs headless, as a native session**, like every other role:
  `<tool>/scripts/host.sh run "<project> · postmaster" <repo> --out <runs>/postmaster/events.jsonl
  --err <runs>/postmaster/postmaster.err --marker <runs>/postmaster/.exited -- <tool>/scripts/launch.sh
  launch postmaster <repo> <brief-file>`. Its brief says it runs headless, so whenever it needs
  the user it writes `<runs>/postmaster/ESCALATION.md` and ends its turn, and
  `<tool>/scripts/runs-status.sh` shows the escalation pending. The user answers by resuming its thread,
  through `host.sh run --append` with `<tool>/scripts/launch.sh resume postmaster <repo> <thread-id>
  <message-file>`, or by opening the thread in the harness's own interactive resume.
- **This needs a harness with a resume form.** `launch.sh` refuses to resume agy, so with no
  host the postmaster runs on another harness.

## Tests

`<tool>/scripts/host.sh --self-test` runs every form against stub `herdr` and `tmux` on a PATH that
holds nothing else, and never reaches a live server. `<tool>/scripts/host.sh --live-test` runs the
ticket's controls against the hosts on this machine, in a scratch repository it creates: a launch
that lands in its worktree's space, nested under its repository's space, with its marker landing;
a reviewer's scratch clone opening as a space of its own, which `close` shuts; the same launch
with no host, backgrounded, with its marker landing; and the same on tmux. It opens only its own
spaces and tmux session, and closes them.
