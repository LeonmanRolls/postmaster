# postmaster

Get one ticket implemented by several models at once, then judged before it lands.

![Hand in the tickets. Ship with a fleet.](docs/poster.jpg)

Two or more models implement the same ticket **independently, in separate worktrees, unable
to see each other's work**. A coachman combines what each got right, puts the result through
the adversarial review rounds its ticket names, then leaves a ship card for the
project's landing route. Pull-request projects are merged by the user; local-merge projects use
the merge authority in the config.

## The four roles

| role | does | never does |
|---|---|---|
| **postmaster** | splits a stream into tickets, dispatches one coachman per ticket, supervises, answers escalations, grants merges | run a model lane, edit source |
| **booking clerk** | prepares one ticket with the user and marks it ready after sign-off | dispatch, edit the target repository |
| **coachman** | drives one leg of a ticket; at most two legs, synthesis and review, each a fresh coachman, carry it from waybill to ship card with a written hand-off between them; the last leg ends the run ready for merge | take a second leg, merge |
| **the team** | several lanes implementing the same ticket in blinkers | see each other's work |

## Lean on the harnesses

postmaster leans on the agent harnesses as much as it can. Planning, coding, reviewing and
fixing are the harnesses' work, through their own skills wherever a harness has one: a bug
review is the harness's own code-review skill, and a security review its own security-review
skill. postmaster itself is mostly plumbing between the stages. It starts each agent with the
right brief, carries the hand-off from one leg to the next, and records what happened.

That is why it has so many scripts. A check written once as a script runs the same way every
time, instead of being worked out again by a model on every run, which saves tokens. The
scripts are well tested, and when one does fail, the model running it can usually read the
error and carry on. The run records the fault, so the script gets fixed.

## Why several models rather than one good one

Because they disagree usefully. Across a sample of runs, the synthesis took contributions
from **both** lanes every time: not "pick the winner", but one lane's mechanism plus the
other's test, wiring or edge case. And a second lane finding the same defect independently
is corroboration you can act on; a single lane agreeing with itself is not.

Disagreement is also diagnostic. When two lanes build the same mechanism and name it
differently, the project's own conventions did not decide it, and the coachman records the
gap as a proposed rule rather than flipping a coin the next run will flip again.

Running several models is also a way to take full advantage of the competition between
providers. There are many strong models now, from many providers, and they compete hard.
postmaster runs several side by side, so it is not locked into anyone's ecosystem. A lane is
a harness plus a model, each harness sits behind an adapter, and nothing in the flow depends
on one provider's tools. The config says which harness and model fills each role, so moving
a role to a different model is an edit to the config.

## Logging, auditing and tracing

These are first-class concerns in postmaster, designed in from the start rather than added
later. Several models change code in parallel, and nobody watches every step as it happens.
The record of what they did is how the work gets checked, and how the flow itself improves.

- **Every action is logged as it happens.** The postmaster and every coachman write one JSON
  line per action, to the run's own log and to the project's ledger. The actions come from a
  fixed set, so the log can be counted rather than read.
- **Every run can be traced from ticket to merge.** The waybill records what was dispatched.
  Each leg starts from the previous leg's written hand-off, and logs when it takes over and
  when it hands off. Each lane's event stream is kept with the run, along with the id of its
  harness thread. The ship card records what is proposed for merge and the evidence for it.
- **Nothing is reconstructed afterwards.** The narrative in `run-log.md` is for reading.
  Audits, and changes to the flow, work from the log.
- **Claims trace to evidence.** The [wiki](wiki/index.md) gives every claim a standing and
  cites the recorded runs and trials behind it.
- **Checks are scripts with controls.** Anything deterministic is a script, and every count
  comes with a control that could have come out the other way, so a passing check means
  something.

## Wiki

What the project has learned is in [`wiki/`](wiki/index.md), published with GitHub Pages, on
the LLM-wiki pattern: how harnesses really behave as against what their documentation says,
what the services the flow depends on actually do, why the design is shaped as it is, and
what happens when several models implement one ticket. That last is the founding question,
not the only subject.

Every run writes its full record — ledger, narrative, harness logs — to its own project's
`.postmaster/`, which is gitignored: that is the instance's business, not the tool's.
Promoting one into [`raw/`](raw/README.md) is a separate decision, and a decision to publish:
it happens after a scrub, only for a target that may be published, and only with what may
lawfully be redistributed. `raw/` is committed, so any claim can be followed to the record
behind it by anyone who clones the repository. A claim whose evidence could not be promoted
is not made.

The claims above about combining models start there marked as claims, and the wiki grows one
record at a time. `skills/wiki` carries the three operations: ingest, query, lint.

Setting up a project makes its verifiers, based on
[pstack](https://github.com/cursor/plugins/tree/23e4138daa01c42d4969f7a5465f82704e64f798/pstack)'s
create- and maintain-verification skills: each verifier is a small folder that tells an agent
arriving cold how to start one surface of the project, drive it the way a user does, and keep
proof. See [#273](https://github.com/brindlewick/postmaster/issues/273).

## Getting started

Clone this repo, open your agent in it, and say hi. Any first message starts the flow.
There is no command to memorise and no wizard to run: `AGENTS.md` tells the agent what to
do. There are two ways to start. From a session in the postmaster project, say hi: the
first question is which project to work on, postmaster itself or another, and the session
is the postmaster in the chosen project's folder, or starts one there when it cannot be.
Or run the postmaster command in a session already in that project: setup offers that
project first. Either way setup asks one question at a time (which agent CLIs fill which
role, where tickets live, where your projects are, who says the merge word), offers the
global config, which can be set up or skipped, and then the project's own settings or the
global config as it is, and links the skills into your agent CLIs. The first start in a
new folder may ask whether to trust it.

```sh
scripts/run probe-harnesses      # which agent CLIs are installed
scripts/run probe-trackers       # which ticket sources are reachable
scripts/run probe-confine        # whether lane confinement can run, and what would finish it
scripts/run setup --answers <file> # writes the config from the agent's collected answers (--keys lists them; --project writes one project's settings)
scripts/run setup-next <project> # where setup stands and what comes next: global, project or done
scripts/run link-skills [--dry-run | --check | --remove]            # the skills, as links into each CLI's skills folder
scripts/run skill-refs [--fix]                                      # every script path in the skill goes through <tool>
scripts/run find-projects        # your git projects, most recent first
scripts/run check-target  <path> # 0 usable · 1 not a repo · 2 dirty
scripts/run discover-project <path>                                # gate, docs, tracker and its prefix, and the checks
scripts/run project-settings inspect|report|ensure|write …        # optional project settings and their source
scripts/run front-door <harness> <model> <cwd> <yes|no> <target>   # self or spawn: who runs the stream
scripts/run verify checks|record|arm|run|results|summary …          # the checks a change is verified by
scripts/run verify-examples | scripts/run verify-journey | scripts/run verify-library # the defaults beyond the gate
scripts/run cut-scratch <repo> <source-worktree> <dest> <commit> [--clone <base>]  # reviewer scratch; --kind, --remove
scripts/run wait-for-markers <dir> <glob> <count> <timeout>       # block until a round is in
scripts/run review-round start|wait|teardown <dispatch> <round> … # a review round's deadline, its wait, its teardown
scripts/run log-action <dispatch> <actor> <action> <target> …     # one JSON line per action
scripts/run tool-faults harvest|comment|file|decline <dispatch> …  # a closed run's tool faults, as tickets
scripts/run stage <dispatch> <stage>                               # the one way a run changes stage
scripts/run clerk brief|start …                                    # prepare a ticket with the user
scripts/run ticket-ready <repo> <id> | mark|queue|pending …        # check, sign off, and queue tickets
scripts/run premises <repo> <waybill> <base>                       # compare ticket premises with the run base
scripts/run run-times <dispatch>                                   # how long each stage took, from the log
scripts/run run-log <dispatch> <text> | --section <title> | --close # the narrative, timestamped
scripts/run run-meta <dispatch> <repo> | path|check|release <dispatch> | run-pinned <dispatch> <name> [args] # the pinned tool and its scripts
scripts/run run-clash <repo> <ticket-id>                      # refuse an id that already names a run or a branch
scripts/run github <repo> board|create|edit|read|state|comment|list|access|search # GitHub Issues on a Projects board
scripts/run plane create|edit|read|state|comment|list …             # Plane work items
scripts/run local <repo> store|create|edit|read|title|state|comment|list # tickets in the repo's git directory
scripts/run tracker-kind <repo>                                    # the tracker kind a repo uses: local when its store exists
scripts/run ticket-check <repo> <id> | --body <file> | --splice …   # a ticket's shape; --splice writes approved parts in
scripts/run ticket-parts <body-file> [--final]                   # a two-part ticket is fit to be signed off
scripts/run turnpikes --list | resolve <text> | legs <dispatch>     # the turnpikes, and a run's legs
scripts/run style-findings list|count|gate|check <dispatch>         # a run's style findings, what its gate runs, the sort
scripts/run launch form|launch|review|resume|skill <lane-or-role> … # any lane or role, one command
scripts/run reviewers lines|eligible <lens>|lanes <waybill> <lens>|lenses # which lanes review under each lens
scripts/run review-forms has <harness>                            # whether the harness has a code-review form
scripts/run review-findings normalize|harvest …                   # native bug-review output into the finding contract
scripts/run host leg launch|resume|takeover|retry|outcome|backfill|waiting … | detect|name|run|stop|close|stop-run|close-run|spawn|send|wait|read … # leg lifecycle, launch placement and teardown
scripts/run view-stream < <events-file>                            # a harness's events, wrapped: what it says and runs, in full
scripts/run runs-status <run-root>                                  # the postmaster's poll
scripts/run coachman-contract <base> <head>                         # whether a change touches the contract, by file
scripts/run runs-watch <run-root> [--timeout <seconds>]              # wait until a run needs the postmaster
scripts/run handoff-check <handoff-file>                            # a leg may end only on exit 0
scripts/run review-page change|files …                             # the data behind a review page or code viewer
scripts/run wiki-lint                                             # the wiki's rules, run not remembered
scripts/run fixture new|score|hidden …                              # a run on a fixture app, scored against a known outcome
```

A project may carry a `.postmaster/` folder. It holds the project's settings and every run's
full record — the ledger, the narrative, the cards, each lane's harness events stream and its
exported durable session — under `runs/`. The runs are never committed: the folder carries
its own `.gitignore`, so a checkout never brings another instance's ledgers, paths, ticket
text or harness sessions. The person's settings file is the exception: it is ignored only
on the user's yes during setup, so it is committed like any file, while the shared file is
committed on purpose with `git add -f` to share it. A project that has never been run
against looks exactly like one that has.

What a project may declare to everyone who works on it is one file, `.postmaster/project.toml`,
committed on purpose with `git add -f`: the checks that show a change works, the default
turnpikes, the tracker binding by name, and the risk surfaces. It names no credential, no
filesystem path, no machine name and no role assignment. This person's choices for the
project are in `.postmaster/settings.toml`, written like the global config: they override it
setting by setting, models and env files included. Share it by committing it; a tracked
file is used only after the user has accepted it. The
shapes are `project.example.toml` and `settings.example.toml`. With neither file, the flow
discovers what it can and the agent conducts the rest in conversation: a missing settings file
is never an error and never a prompt to create one.

Precedence is stated once and followed everywhere: discovery supplies defaults; the shared
file declares what the project requires; the person's settings override the global config
setting by setting for that project; the global config supplies the machine's defaults. None
of these sets a floor of turnpikes: a ticket names the turnpikes its run passes through, and
project settings only say what `default` means for that project.

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
  as it is. [#140](https://github.com/brindlewick/postmaster/issues/140) plans to cap them
  there.
- **Whether Muse and MiMo keep each lane's data apart is not known.** Only a Mac with those
  agents logged in can show it, so until
  [#205](https://github.com/brindlewick/postmaster/issues/205) runs that trial there, nothing
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

## Installing the skills

Skills are installed as links, never as copies. `scripts/run link-skills` links each directory
under `skills/` into the user-level skills folder of every installed agent CLI that has one,
pointing at the main checkout of this repo, never a worktree. Setup checks their status first.
If links are missing, it shows the dry-run output and asks before installing them:

```sh
scripts/run link-skills --check      # report missing or blocked links; never changes anything
scripts/run link-skills --dry-run   # the links it would make, and anything in the way
scripts/run link-skills             # install, after the user agrees
scripts/run link-skills --remove    # remove them, and nothing else
```

It replaces nothing. A file, a folder or another link where a link belongs is named, and
nothing changes until you move it. `--check` is the read-only counterpart: it names any
missing or blocked link and the one command that installs them. Once linked, the postmaster skill (`/postmaster` in Claude
Code) works from any project, and finds this repo from its link. The folder each CLI reads is
in `skills/postmaster/harnesses.md`. A CLI with no folder there, agy for now, is pointed at
this repo's `skills/postmaster/SKILL.md` by its absolute path.

`skills/postmaster` runs the flow and is the one a dispatch needs. `skills/wiki` operates the
wiki, works in a checkout of this repo, and is only wanted by a session doing that. Each
directory is one skill; the other files beside a `SKILL.md` are its reference material, loaded
when its instructions send an agent to them rather than up front.

**Tickets are GitHub Issues on a GitHub Projects board by default:** a kanban you can open,
with each ticket a card in the column its state says, and nothing to configure beyond `gh`
being logged in. Plane works the same way through its API, cloud or self-hosted. With no
service and no login, the local kind keeps a repo's tickets in its own git directory, and
`scripts/run local <repo> list` shows them by state. Any other tracker your agent reaches
through its own tooling is described once, outside this repo.
The adapters are in `skills/postmaster/trackers.md`.

**Nothing about a target project has to be configured to run.** The flow discovers the gate,
docs and ticket convention. When a conversation settles a project decision that discovery cannot
answer, the agent offers the local settings file or the shared declaration and writes it only
with agreement. A missing file is never a prompt to create an empty one.

## Native sessions

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

## Design rules

Project files are optional and discovery remains the default; they record only project decisions
discovery cannot infer. Nothing harness-specific outside an adapter. Anything
deterministic lives in `scripts/`, because prose is re-derived, and mis-derived, on every
run. Every count carries a control that could have come out otherwise. Every action a run
takes on a project is logged as a structured event, so what the flow did can be audited and
improved from the record rather than from the narrative.

See `AGENTS.md` for the full context, and `skills/postmaster/` for the runbooks
(`postmaster.md`, `coachman.md`) and the adapters (`harnesses.md`, `hosts.md`, `trackers.md`).
