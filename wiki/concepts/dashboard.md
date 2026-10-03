---
title: The dashboard shows the fleet and can do nothing to it
type: concept
standing: claimed
sources: []
updated: 2026-09-29
---

# The dashboard shows the fleet and can do nothing to it

**Claim.** A web dashboard lets the user see every run at a glance, on a phone, an iPad or a
desktop, without adding a way into the fleet. It only shows. It computes nothing that the
scripts do not already compute, and only the machine's owner can reach it, through
Tailscale's proxy.

**Standing: claimed.** This design was agreed with the user on 2026-09-29 in
[issue #126](https://github.com/brindlewick/postmaster/issues/126), before any of it was
built.

## Why a dashboard

The user follows runs through Herdr panes, Moshi and what the postmaster tells them. The state
of a run is spread over its run directory, the ledger, Herdr and the tracker. On 2026-09-28,
with ten runs in flight, a stalled run went unnoticed for an hour
([#121](https://github.com/brindlewick/postmaster/issues/121)). A provider's stream timeout
ended two coachman legs, and each one sat until the postmaster noticed
([#122](https://github.com/brindlewick/postmaster/issues/122)). The watcher from #121 wakes the
postmaster. Nothing showed the user the whole fleet at once: which runs are where, what waits
on them, what waits on the postmaster and for how long, and what the machine is carrying.

## What it shows

**The home page** sorts runs by who acts next:

1. **Waiting on you.** The postmaster's own escalation to the user, and each run whose next
   step is `USER`, each with its question in full.
2. **Waiting on the postmaster.** Each run whose next step is `RULE`, `READ`, `GATE`,
   `DISPATCH`, `REMOUNT` or `INSPECT`, with how long it has waited. A run is marked stalled once
   it has waited more than twice `postmaster.poll_seconds`, because a postmaster that is watching
   acts within one poll. This is the case that went unseen for an hour.
3. **Running.** Every other run in flight, with its ticket and title, stage, leg, review round,
   idle time and next step.
4. **Closed** in the last day.

**A run's page** shows the waybill, the checkpoint and ship cards, any escalation with the ruling
on it, the hand-offs, the run log, and how long each stage took, with waiting shown apart. It
also shows each review round: its reviewers, how long it took against its limit, and its
findings by class and severity, with rounds past the cap marked. Then the gate results, each
lane's and the coachman's harness, model and effort, and each launch's output as its pane shows
it, following live while it runs.

**The machine**: CPU and memory now and over the last hours, and which runs and launches are
using them.

**The postmaster's page**: its plan, the runs it holds, the faults runs found in postmaster, and
the ledger, filtered by run, actor and action.

**Layout follows the width of the window, not the device**, so iPad Split View and Slide Over
work too.

- **Narrow** (a phone, or Slide Over): one column.
- **Medium** (an iPad in portrait, or Split View): the list of runs beside the chosen run.
- **Wide** (an iPad in landscape, or a desktop): the home page is a board with one column per
  stage and a side column for what waits on the user. A run's page shows its running launches'
  output side by side, the way a Herdr tab splits its panes.

Every control works by touch, and none depends on hover. The page follows the device's light or
dark setting.

## What the user can do from it

Read, and follow a link out, for example to the ticket. Nothing else. The user answers
escalations, rulings, checkpoints and merge words where they answer them now, in the
postmaster's session.

The reason is the one that decides the rest of this page. Every agent runs as the user's own
account, in its harness's bypass mode, with no permission prompt. Any action the dashboard could
take, an agent on the same machine could take too, by calling it the way the page does. No
check the dashboard could make tells the user's click apart from an agent's request, because
anything the user's account can read or reach, so can an agent. A page that can only show gives
an agent nothing it could not already read from the run directories.

## What it must never do

- Write anything: not a run's files, a repository, the config, or the tracker.
- Start, stop, resume or signal a process, or call a harness or a model.
- Answer anyone but the machine's owner, or a request addressed to any host but this machine's
  tailnet name or address.
- Be published beyond the tailnet (never through Funnel), or open a TCP or UDP port of its own.
- Show a secret. From the config it shows only each role's harness, model and effort: never an
  env file, a path to one, or an environment variable. From an event stream it shows what the
  pane shows, and tool output stays out.
- Trust what it shows. Ticket text, cards, findings and everything an agent wrote are text, and
  are escaped. No raw HTML passes through, and nothing loads from anywhere else.
- Keep a record of its own. It holds no database and no cache that outlives its process. A
  restart loses only the machine's recent history.
- Load the machine while nobody is looking. With no page open it runs no script and reads no run
  file. Sampling the machine's load is the one exception, and it reads only `/proc`.

## Where each thing comes from

Every figure comes from a record the flow already keeps, through the script that already reads
it. Where a script prints only a table, it gains a `--json` form computed by the same code, so
the dashboard never computes a stage, a next step, a timing or a finding count a second way.

| what it shows | the record | read through |
|---|---|---|
| which run roots exist | each project's `.postmaster/runs/` (#18), and `~/.postmaster/runs/<project>/` for runs from before it | one script that lists them |
| stage, leg, markers, idle time, next step, how long it has waited, review round | the run directory | `runs-status.sh --json` |
| a run's title | the waybill | `host.sh name <dispatch>` |
| stage timings, waiting apart | the run's `actions.jsonl` | `run-times.sh --json` |
| review rounds, reviewers and findings | `logs/review-r<n>.json`, the reviewers' markers, the `finding`, `apply` and `degrade` lines | `review-round.sh`, reading findings as `review-decide.sh` does |
| gate results | the `gate` and `verify` lines | the script that writes them |
| cards, escalations, hand-offs, waybill, run log, plan | the files themselves | read as they are, and rendered as escaped text |
| the team | the run's `run.json`, as the run was dispatched | read as it is; harness, model and effort only |
| a run's launches, and whether each has ended | the run's streams and markers, named as the coachman's contract names them | read as they are |
| each launch's output | `logs/*-events.jsonl` and each reviewer's stream | `view-stream.sh --json`, the pane's own selection |
| each launch's CPU and memory, and its run | the session host's launch registry, and each launch's scope | `host.sh usage --json` |
| the machine's CPU and memory | `/proc` | the dashboard, sampled every 10 seconds, kept in memory |
| a ticket's link | the tracker | the tracker adapter's `read`, once per run |
| held runs, tool faults, the ledger | `postmaster/held`, `tool-faults.json`, `ledger.jsonl` | read as they are |

The tracker's board, run history across days and notifications are not part of it. The user did
not ask for them, and notifications belong to the watcher and Moshi.

## How it is served and reached

**Stack.** TypeScript run by Bun, with no package at run time: Bun's built-ins and Node's
standard modules, as #109 sets for the scripts. The pages are rendered on the server, with one
small script that keeps them live. There is no client framework and no build step. It lives in
this repository and runs from the main checkout.

**Process.** A systemd user service, niced, with a CPU weight below the default and a memory
cap, so on a saturated machine it gives way to the lanes. `scripts/dashboard.sh` installs,
starts, stops and removes it, and prints its address.

**Where it listens.** A Unix socket, `~/.postmaster/dashboard/dashboard.sock`, in a directory
only the user can open. It opens no TCP port on any interface.

**How the user reaches it.** `tailscale serve` publishes the socket on the tailnet over plain
HTTP, at `http://<machine>:<port>`, where the port is `dashboard.port` in the config. Every
device the user has on the tailnet reaches it, including a phone or an iPad with the Tailscale
app. Changing Tailscale's configuration needs root, or an operator granted by root (from
Tailscale's documentation, unverified here). The user runs the one `sudo tailscale serve` line
that `dashboard.sh` prints. The user account is not
made Tailscale's operator: that would let any agent running as the user change Tailscale,
including publishing a port to the internet.

**Why plain HTTP.** The tailnet already encrypts the traffic between devices. An HTTPS
certificate for the machine would be issued under its tailnet name, and that name would be
published in the public Certificate Transparency logs (from Tailscale's documentation,
unverified here). This project keeps the machine's tailnet name private. The cost is that
browsers call the page not secure, and features that need a secure context, such as service
workers and web push, are not available. It uses none of them.

**How it knows the request is the user's.** `tailscale serve` adds a `Tailscale-User-Login`
header to each request it forwards from a user's device. It first removes any such header the
client sent, and it adds none for a tagged device (from Tailscale's documentation, unverified
here). The dashboard serves a request only when that login is the machine owner's, as
`tailscale status` gives it at start. Whether the header is added for a service published over
plain HTTP, as well as over HTTPS, is unverified here, and the first ticket's live control
settles it. The dashboard also serves a request only when its Host is this machine's tailnet
name or address. Without that check, a web page open in the user's own browser could rebind a
name it controls to the machine's address and read the dashboard with the user's identity. It
answers GET and HEAD only.

## What it adds to the risk surfaces

- **A tailnet listener.** tailscaled listens on one port on the machine's tailnet addresses and
  forwards to the socket. Any device on the tailnet can connect, and only the owner's devices get
  a page. It is never published through Funnel.
- **A Unix socket open to the user's own processes, agents included.** They can forge the
  identity header, but they can already read every file the dashboard shows, and the dashboard
  can do nothing. This is why it never gets an action.
- **A long-running process that reads every run.** It reads the run roots, the launch registry,
  the config's team and `/proc`. It writes nothing but its socket.
- **Text written by models, shown in a browser.** Everything is escaped, and a
  Content-Security-Policy allows only the dashboard's own scripts, styles and connections, with no
  framing. A message that holds markup cannot run in the page, and cannot send what it reads
  anywhere else.
- **Commands shown from event streams.** A command an agent ran can hold a token. The panes
  already show those to the same person, and responses are marked `no-store`, so they stay out of
  the browser's cache.
- **One privileged step, taken by the user.** The `sudo tailscale serve` line. The tool never
  runs `sudo` and never changes Tailscale.

## What would change it

- **The user wants to act from it.** Acting would need a way in that an agent running as the
  user cannot use, and there is none on this machine today. That needs a design of its own.
- **The identity header is missing over plain HTTP.** Then either HTTPS, at the cost of the
  certificate logs, or a port bound on the tailnet address that checks each connection with
  `tailscale whois`. The first ticket's live control decides which is needed.
- **Stalls still go unseen, because nobody looks.** A dashboard is pulled, not pushed. The answer
  then is a notification from the watcher or Moshi, not an action on the dashboard.
- **Its cost shows on a saturated machine.** Its CPU budget is written into its tickets and
  measured, so this would show as a failed criterion.

## What changed because of it

Nothing is built yet. The tickets filed from #126, in order:

1. [#146](https://github.com/brindlewick/postmaster/issues/146), the home page, the server, how
   it is reached and who it answers. It is a dashboard the user can use on its own.
2. [#147](https://github.com/brindlewick/postmaster/issues/147), a run's page: its cards, timings,
   review rounds and gate results.
3. [#148](https://github.com/brindlewick/postmaster/issues/148), each launch's output, live, side
   by side on a wide screen.
4. [#149](https://github.com/brindlewick/postmaster/issues/149), the machine's load, and which
   runs are using it.
5. [#150](https://github.com/brindlewick/postmaster/issues/150), the postmaster's page: its plan,
   held runs, tool faults and the ledger.

Each of the last four depends only on the first.
