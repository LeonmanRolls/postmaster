# Native sessions

Only one process in the fleet is kept alive between turns: the postmaster, which the
user talks to. A spawned postmaster needs a host that keeps an interactive process
running (Herdr or tmux); when the front-door session is the postmaster, that
conversation is the live process and needs no host of its own. Everything else runs
as a **native session**: the harness's own thread, in its
own store on disk. A lane or a coachman leg is launched headless, writes its events and a
marker, and exits. When it is needed again, for a ruling to a coachman or a remount of a
stalled lane, the flow resumes that thread with one command (`scripts/run launch resume`) and
the harness reloads the conversation itself.

That is cheaper than a pane per role. An idle interactive agent in a tmux or Herdr pane is a
process, its memory and often a network keepalive, doing nothing until someone types; two
concurrent runs with a coachman and two lanes each would hold six of them. An idle native
session is a file. The resume costs the tokens of reloading the thread, which prompt caching
mostly absorbs, and it leaves the harness's own record as the durable one.
`skills/postmaster/harnesses.md` says where each harness keeps its threads and how each is
resumed. On a host, each launch still gets a pane of its own while it runs, so the fleet can be
watched: the pane is a window onto a headless process that exits when it is done.

Back to the [README](../README.md).
