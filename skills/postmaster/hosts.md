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
| run a headless launch, visibly | a new tab under the run's ticket-labeled synthesis-worktree space, nested under the repository's space | a window in session `postmaster-<repo>` | a detached background process |
| spawn the interactive postmaster or a spec session | `herdr agent start` in a fresh tab of the repository's space, never a pane an agent ran in before | a window in session `postmaster-<repo>` | not possible: it runs headless, below |
| send it a message | `herdr agent prompt` | paste the text bracketed, then Enter as a key of its own | resume its thread with the message as the prompt |
| wait for it to settle | the same call, `herdr agent prompt --wait`: idle, done or blocked | its screen unchanged for 10 seconds | its marker lands |
| read what it said | `herdr agent read --source recent-unwrapped` | `tmux capture-pane -p -J` | its final message (`harnesses.md`) |
| close a worktree's space | `herdr workspace close`, before the worktree is removed | kill the worktree's windows | nothing to close |

```sh
<tool>/scripts/host.sh detect
<tool>/scripts/host.sh name <dispatch>
<tool>/scripts/host.sh name <dispatch> coachman <leg-name> <leg-number>
<tool>/scripts/host.sh name <dispatch> workhorse <lane>
<tool>/scripts/host.sh name <dispatch> review <lane> <lens> <round>
<tool>/scripts/host.sh name <dispatch> postmaster
<tool>/scripts/host.sh name <dispatch> role <text...>
<tool>/scripts/host.sh leg launch|resume|takeover|retry|outcome|backfill|waiting ...
<tool>/scripts/host.sh run <name> <cwd> [--under <dispatch>] [--role lane|coachman|reviewer] [--run <dispatch>] [--out <file>] [--err <file>] [--append] [--marker <file>] [--pidfile <file>] -- <command...>
<tool>/scripts/host.sh stop <worktree>
<tool>/scripts/host.sh close <worktree>
<tool>/scripts/host.sh stop-run <dispatch>
<tool>/scripts/host.sh close-run <dispatch>
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
pane. A spec session is spawned the same way (`postmaster.md`, Spec review).
`spawn`, `send`, `wait` and `read` exit 3 on `none`.

## Run, on every host

**Coachman legs use `host.sh leg`**, which is the only runbook interface for launching,
resuming or taking over a leg. It derives the marker, event, error and attempt-record paths.
`launch` starts a new stream, `resume` appends to that stream and reuses the role recorded for
the previous attempt, `takeover` preserves the old stream and starts a fresh fallback stream,
and `retry` repeats the last refused, pre-thread or user-routed wall attempt with its saved prompt.
The leg command records one of `refused`, `pre-thread`, `walled`, `incomplete` or `finished`
before `--marker` lands. A refusal to load the env file remains `refused`; no runbook reads
`.err` text to classify the result. One starter holds the leg's lock at a time: a lock whose
owner is dead is stolen, a live one refuses. The launch names itself in the lock as its
first act, through a temporary file, and never runs unowned; a release removes only a lock
that still names the releaser. `leg outcome` prints the last attempt record;
`leg waiting` keeps the waiting list.

Each attempt record keeps `attempt`, `leg`, `name`, `request`, `role`, `prompt`, `thread_id`,
`outcome`, `on_answer`, `backfilled`, `exit` and `ended`. `on_answer` is `retry` for `refused`,
`pre-thread` and fallback `walled`, `resume` for `incomplete`, and `none` otherwise; it is the
action for when the user answers. `backfilled` is true when the attempt died without its record
and was classified later from its evidence: every start writes an intent file first (attempt,
request, role, prompt, thread id and stream offset), and the next start — or `leg backfill`
on its own — classifies each attempt that has an intent or phase file but no record, over its
own stream slice. A phase file beyond the last record therefore reads INSPECT, never the stale
outcome. Every append terminates a torn tail line first, so a recovery record never fuses
onto the fragment it supersedes.

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
- **Run launches must name their space.** `lane`, `coachman` and `reviewer` launches require
  `--under <dispatch>`. Any launch with `--run <dispatch>` also requires `--under`, so a run
  launch cannot fall back to a top-level space. Project-level launches may omit both.
- **A finished launch closes its own tab or window** a short settle delay after its marker
  lands (`POSTMASTER_HOST_FINISH_DELAY`, 0.2s), not when rendering provably ends. Cleanup uses
  the pane, tab or window IDs `host.sh` recorded when it opened the launch;
  labels and prompt text never identify ownership. A user pane split into a launch tab or window
  survives: `host.sh` closes only its own pane and leaves the shared tab or window open. The event
  stream and logs stay on disk.
- **`--pidfile` gets its pid, which is also its process group:** `kill -- -<pid>` stops all of
  it. `host.sh run` returns as soon as the launch has started. The wait still goes in the same
  command as the launch, as `<tool>/scripts/wait-for-markers.sh`, or for a review round
  `<tool>/scripts/review-round.sh wait`.
- **`--role` selects per-role limits; `--run` selects the dispatch's recorded config.** Use
  `lane` for a workhorse, `coachman` for a leg, and `reviewer` for a review launch. Direct host
  launches use the default limits. With `--run <dispatch>`, the limits come from the config in
  `<dispatch>/run.json`, so an edit to the live config does not change an in-flight run.
- **A Linux user scope contains each launch and its descendants.** When systemd can verify a
  cgroup v2 memory controller, pids controller and the requested scope properties, `host.sh`
  applies `MemoryMax` (default `8G`), `MemorySwapMax=0` and `TasksMax` (default `512`). Systemd
  kills the scope on memory exhaustion; when the pids controller records a refused fork,
  `host.sh` kills that scope. `.err` says `host: memory cap reached (MemoryMax=<value>)` or
  `host: process cap reached (TasksMax=<value>)`. The notice also appears in the pane's stderr.
  A machine without a working per-launch cgroup backend still runs the command and records
  `host: launch running uncapped (no supported per-launch limits available)` in `.err`, with a
  warning to the caller. The limits live under `[limits]` in `config.toml`; `[limits.lane]`,
  `[limits.coachman]` and `[limits.reviewer]` can override either setting. The caps bind an
  accidental runaway, not a deliberate escape: every launch runs as the same user, which can
  always start work outside the launch's scope, so the caps are resource bounds, not a
  security boundary.
- **A launch outlives its caller.** It belongs to the host's server, or with no host to a session
  of its own, so a caller's background-task cap or its exit does not reach it.
- **A launch carries its own pane's identity, never its caller's**: `HERDR_PANE_ID`, the tab and
  space ids and `TMUX_PANE` are those of the pane it runs in, and are unset with no host. A
  harness's own Herdr integration reports to whatever pane those name. Its environment reaches
  the pane through a FIFO and a pipe, never a file on disk or a command line.
  [Why a launch must own its pane](../../wiki/concepts/herdr-headless-launches.md)
- **A launch never carries its caller's Claude Code session identity or its caller's Herdr
  identity.** The caller's environment is handed over minus:
  - `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`,
    `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ATTENDED`,
    `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`,
    `CLAUDE_CODE_TOOL_USE_ID`, and the families
    `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_CODE_CHILD_*` — a lane that
    inherits the calling session's identity can message it or keep no session record of its own.
  - every `HERDR_*` of the caller's. In a Herdr pane the launch gets only that pane's own six
    (`HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_ENV`, `HERDR_SOCKET_PATH`,
    `HERDR_BIN_PATH`); with tmux or no host, none. A lane that inherits the caller's Herdr
    variables can drive its caller's Herdr session.

  Every other variable of the caller's still reaches the launch, `POSTMASTER_*` settings and a
  harness's own configuration (such as `CLAUDE_CONFIG_DIR`, `CLAUDE_EFFORT`, `ANTHROPIC_*`, and
  configuration under the `CLAUDE_CODE_` prefix that is not in the families above) included, and
  so does the lane's env file once `launch.sh` sources it. The strip is a deny-list in
  `<tool>/scripts/host.sh`'s runner: to add a name or a family, extend that list and the
  matching test beside the script. Never widen it to the whole `CLAUDE_CODE_*` prefix and
  never replace it with an allow-list; both would drop configuration a launch needs.
- **The ticket belongs to the run's space; a launch label carries only launch identity.**
  `<tool>/scripts/host.sh name <dispatch>` prints the ticket number and title for the run level.
  Its launch forms build labels from the run's recorded config: `coachman · <model> · leg <n>`,
  `<lane> · workhorse · <model>`, or `<lane> · <lens> review · <model> · r<n>`, and
  `role <text...>` names any other launch by its role alone. A model shows as the basename
  after its last `/`, so a provider prefix never pushes the round past the ellipsis. A lane
  or role comes first so it remains visible on a narrow sidebar. `postmaster` is the
  project-level interactive role. `host.sh run --under <dispatch>` puts the ticket on the
  synthesis worktree space and every launch label on its tab or window, pane title, and
  harness thread name (`POSTMASTER_LAUNCH_NAME`, `harnesses.md`). A title can contain shell
  syntax, so take every value from `host.sh name`; never type it into a shell.
- **The pane shows the stream, not the JSON**: `<tool>/scripts/view-stream.sh` renders each event
  of interest as wrapped lines — what the agent says and runs, in full — each with its time.
- **Every launch is registered while it runs**, under `POSTMASTER_HOST_STATE` (default
  `~/.postmaster/host`), with the worktree it was placed in, whatever host ran it. `host.sh stop
  <worktree>` stops every launch running there and everything each one started, even in a
  session of its own, as a harness runs a tool command: TERM first, then KILL to whatever is left
  after 20 seconds (`POSTMASTER_HOST_STOP_WAIT`), and exit 2 naming anything still running. It
  never runs from inside that worktree, which would stop the caller too. `host.sh close
  <worktree>` refuses while one runs there, after waiting 15 seconds for one that is just ending.
- `host.sh stop-run <dispatch>` and `host.sh close-run <dispatch>` cover the synthesis worktree,
  workhorse worktrees in the run config, and reviewer scratches in its round records and action
  log, including scratch clones that Git does not list as worktrees, plus any pane or window
  still tagged for the run. Either exits 2 when the run's records cannot be read, naming the
  record it refused.
- **It degrades rather than refuses.** If the host cannot place the launch, or its pane has not
  started it within 20 seconds, it runs in the background instead, exactly once, and `host.sh`
  prints `host=none` rather than where it would have been.

## herdr

- **Placement.** Every run launch uses `host.sh run --under <dispatch>`, which reads the ticket name and synthesis
  worktree from the waybill. `herdr worktree open --workspace <repository's space> --path
  <synthesis worktree> --label <ticket>` opens the run's space. Every launch gets a tab
  in the same space, with its own checkout as the tab's working directory, the first one
  included: it closes the run space's root tab once its own tab exists. That includes
  reviewer worktrees and security-review clones: a clone is never opened as a separate
  workspace. A failure before the launch lands rolls back instead — the root tab
  while the launch tab does not exist yet, the launch tab after — so a failed
  placement leaves nothing a later close could refuse. A run launch without `--under` is refused
  instead of opening a top-level space.
- **The tree** is project space → ticket-labeled run space → live launch tabs. The project space holds
  the postmaster, the synthesis worktree's space holds all coachman legs, workhorses and review
  launches for that ticket, and each launch's label starts with its role and lane. The synthesis
  worktree space has no spare shell tab: the first launch closes its root tab once its own
  tab exists, and each later tab is opened for a launch. When its marker lands, a launch tab
  closes after the settle delay; a user split stays open with the user's pane. The project
  space keeps its shell tab:
  Herdr closes a workspace with its last tab, and refuses the close once a worktree nests under
  it, so host.sh never closes it. The tabs are panes under the run; Herdr 0.9.1 cannot nest one
  agent under another.
- **Ownership.** `host.sh` marks what it opens with Herdr metadata tokens: a space
  `postmaster=opened`, a pane `postmaster=launch`. It remembers each launch tab in the host state.
  `host.sh close <worktree>` closes tabs it opened for that checkout, then closes a space only
  when that space belongs to the checkout, carries the ownership token, every pane in it does,
  and nothing registered runs there. A tab closes only when every pane in it
  carries the launch token: a split tab keeps the user's pane and stays open,
  named in the refusal, and so does a tab whose pane list cannot place every
  row. A row counts as placed only when its tab_id is a string of the shape
  Herdr sends (`w…:t…`); a missing, null or otherwise malformed tab_id is
  unattributable, and one unattributable sibling refuses the close. Where the
  recorded pane itself carries no attributable tab, only that pane closes,
  never the tab. Closing a reviewer scratch therefore removes its tabs
  without closing the run space; when they are its last tabs Herdr destroys the tabless space
  with them. It never closes a repository's own space, a scratch clone's aside, never uses
  `workspace close --group`, and never runs `herdr worktree remove`, which deletes the checkout.
  Close a space before removing its worktree.
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
  runs on the same config and host as the session that started it. Its tab label is `postmaster`;
  the project's space already names the project.
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
  `@postmaster_cwd` set to its worktree and `@postmaster_state` to `running`, then `done`. The
  launch pane is tagged as host-owned, and its pane ID is recorded in `@postmaster_pane`. After
  its marker lands, host.sh closes that pane by ID; the window closes with it when it is alone.
  If the user split a pane into the window, the launch pane closes and the user's pane remains.
- A window's command starts with the tmux server's environment; `host.sh` hands the caller's
  across the same way as for Herdr, and `spawn` passes the caller's `POSTMASTER_*` settings.
- `host.sh close <worktree>` closes only the recorded pane IDs host.sh opened for that worktree
  once no launch runs there. A split window stays open with its other panes and the close
  reports the refusal (exit 2); an unrecorded pane is never selected by its window name or
  other text.
- Sending: `tmux load-buffer` from the file, `tmux paste-buffer -p` so an application that asked
  for bracketed paste gets it, then `tmux send-keys Enter` as a key of its own. Settled means
  the screen has not changed for 10 seconds (`POSTMASTER_HOST_QUIET`).
- Kill only a session you created, and read a pane (`tmux capture-pane -p`) before killing it.

## none

- A launch is a detached process in a session of its own, with no terminal. There is nothing to
  watch but its files: `<tool>/scripts/runs-status.sh`, the events file, and
  `<tool>/scripts/view-stream.sh < <events-file>` for the readable form.
- **The postmaster runs headless, as a native session**, like every other role:
  `<tool>/scripts/host.sh run "postmaster" <repo> --out <runs>/postmaster/events.jsonl
  --err <runs>/postmaster/postmaster.err --marker <runs>/postmaster/.exited -- <tool>/scripts/launch.sh
  launch postmaster <repo> <brief-file>`. Its brief says it runs headless, so whenever it needs
  the user it writes `<runs>/postmaster/ESCALATION.md` and ends its turn, and
  `<tool>/scripts/runs-status.sh` shows the escalation pending. The user answers by resuming its thread,
  through `host.sh run --append` with `<tool>/scripts/launch.sh resume postmaster <repo> <thread-id>
  <message-file>`, or by opening the thread in the harness's own interactive resume.
  A fixture copy's postmaster uses this headless form on every host, whatever `host.sh detect`
  says: `front-door.sh` prints `headless` for it (`SKILL.md` step 3), so it never meets a trust
  prompt.
- **This needs a harness with a resume form.** `launch.sh` refuses to resume agy, so with no
  host the postmaster runs on another harness.

## Tests

The tests beside `<tool>/scripts/host.sh` run every form against stub `herdr` and `tmux` on a PATH that
holds nothing else, and never reaches a live server. It also checks the labels: each kind of
launch (a coachman leg, a workhorse, each review lens with its round, the postmaster) leads
with its role and holds no part of the ticket title, and the run's level carries the ticket.
Where a working systemd user scope exists, it also checks that a bounded fork and allocation
launch are stopped at their caps while a healthy launch completes. Without that backend it
checks the uncapped notice and successful launch.
`<tool>/scripts/host.sh --live-test` runs the
ticket's controls against the hosts on this machine, in a scratch repository it creates: a
postmaster using the project's first tab; a coachman in a ticket-labeled run space with no spare
shell tab; a workhorse and style, bug, and security launches under that run, including a security
clone whose tab closes without closing the run space; then the same launch with no host and on
tmux. It opens only its own spaces and tmux session, and closes them.
