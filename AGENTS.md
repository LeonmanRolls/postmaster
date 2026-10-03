# postmaster

**This file is the canonical context for every agent working in this repo, whatever harness
it runs under.** `CLAUDE.md` imports it; codex, grok, pi and mimo read it natively, and muse
does in a trusted workspace, which its bypass flag makes one; agy reads no ambient file at all
and must be pointed at it explicitly by whatever brief launches it.

## Read this first: this repo is the tool, and it can be its own target

postmaster dispatches agents at git repositories. **One of those repositories may be this
one.** Using postmaster to develop postmaster is supported, and it is the most honest test
the tool has: a flow that cannot improve itself is a flow nobody should trust with a real
project.

A session opening here is usually here to **run** the tool against something else. Ask which
target the user wants before assuming either way.

### What is different when the target IS this repo

**A run runs on the version it was dispatched from.** At dispatch the run is pinned to the
postmaster commit it started on: a checkout of that commit, which the waybill names as its
tool and `run.json` records. Every coachman leg reads its runbooks and runs its scripts from
that checkout — later legs, resumes and takeovers included — whatever `main` has done since.
The supervising postmaster stays on the main checkout. A change can merge with runs in
flight; each of them finishes on the version it started with. A fix you just merged reaches
the next dispatch, not one already running.

**The supervising session is in the same position.** Whatever is supervising loaded its
context at startup. After merging a change to the flow, restart it or accept that it is
running the previous version.

**Everything else is ordinary.** Worktrees under `.worktrees/` are gitignored, the gate runs
the same way, and merges are merges. There is no special mode.

**A change to the coachman contract merges only after a fixture run scores clean**: a run
dispatched from the change's branch against a repository made by `scripts/run fixture new`, and
scored by `scripts/run fixture score` on the same branch. What the contract is is defined in one
place, [its file list](docs/coachman-contract.toml);
`scripts/run coachman-contract` says whether a change touches it. That rule is about the change's
quality, not about the runs in flight. [Why](wiki/concepts/fixture-runs.md).

## When a session opens in this repo, do this

No slash command, and no wizard for the user to run. The user opens their agent in this
folder and says hi. Any first message starts the flow: set the machine up if it is not,
choose a target, launch the postmaster. Work out where the user is and pick up from there.

**1. Is this machine set up?**

```sh
cat ~/.postmaster/config.toml 2>/dev/null || echo "NOT SET UP"
scripts/run link-skills --check  # names missing or blocked links; read its exit status
```

Include both results when you say whether the machine is set up. The link check is read-only.
If the config is present but the check names missing or blocked links, report them and offer
the install step below on the user's word.

If it is missing, set it up now, in conversation, before anything else. You conduct it:
probe first, ask one thing at a time, verify each answer, then have the script write the
config. Do not guess an answer, and do not hand the user a script to run instead.

```sh
scripts/run probe-harnesses     # which agent CLIs exist, and which read no ambient context
scripts/run probe-trackers      # which ticket sources are reachable, and what would finish each
```

What to settle, in this order, and why none of it is guessed:

- **Which harness and model fills each role:** the horses, the reviewers, the coachman and
  its fallback, the postmaster. Offer only what the probe found, and do not assume: a
  harness on PATH can still be walled, out of credit, or reading no ambient context. The
  shape of the answer is `config.example.toml` at the repo root.
- **How tickets are created.** GitHub Issues on a GitHub Projects board is the default: a
  kanban the user can open, needing only `gh` logged in with the `project` scope. When
  the probe says `partial`, it names the one command that finishes it (`gh auth login`,
  `gh auth refresh -s project`); the user runs it, since a login is theirs, and you probe
  again. Plane is another named kind: ask for the API origin and the workspace slug, ask
  the user to write `~/.postmaster/plane.env` with `PLANE_API_KEY=<key>` themselves,
  since a key never passes through a conversation, and confirm with `scripts/run plane
  projects`. `local` needs no service and no login: it keeps each repo's tickets in the
  repo's own git directory, and a repo whose store exists uses it whatever this answer is.
  Anything else is `other`, described once outside this repo (`skills/postmaster/trackers.md`).
- **Where projects live.** `~/Code` is one convention, not a rule.
- **Who says the merge word.** A person, or the postmaster itself (`ship.merge_authority`).
  A run never merges on its own authority; the config says whose authority that is.

Then put the answers in a file, one `key=value` per line, and let the script write and check
the config; it refuses a harness that is not on PATH, a coachman on a lane's model and a
config that does not parse, and a refusal is a question back to the user, not something
to work around.

```sh
scripts/run setup --keys                       # every key, its default and what it asks
scripts/run setup --answers <file> --dry-run   # the config it would write
scripts/run setup --answers <file>             # write ~/.postmaster/config.toml
```

When the check names missing or blocked links, show the user the dry run output below and ask
whether they want the links installed. Run the installer only after they agree. If they
decline, report that setup remains without the links. The links go to this repo's main checkout,
never a worktree, and nothing is ever copied or replaced. A path in the way is the user's to
move before installation.

```sh
scripts/run link-skills --dry-run   # the links it would make, and anything in the way
scripts/run link-skills             # only after the user agrees; makes links, replaces nothing
```

**2. Which project are we dispatching against?**

```sh
scripts/run find-projects                 # most recently worked first
scripts/run check-target <chosen>         # 0 usable · 1 not a repo · 2 dirty, ask first
scripts/run discover-project <chosen>     # gate command, docs, tracker and its prefix, checks
scripts/run project-settings report <chosen>  # shared/local presence and per-fact sources
```

**When a decision belongs to the project rather than the machine, offer it for
`.postmaster/` and write it there on agreement, never silently.** `run discover-project`
reports whether the target already has settings. If a fact is one every run against this
project needs — the default turnpikes, the tracker binding by name, the risk surfaces —
propose the shared `project.toml` and say which file you are proposing, since that one is
committed. If it is this person's choice on this machine — which lanes fill the roles —
propose local `settings.toml`. A missing settings file is never an error and never a
prompt to create one; the normal case is nothing written.

**The target may be this repo.** Developing postmaster with postmaster is supported; see
the section above for the two things that differ.

**3. Start the postmaster** per `skills/postmaster/SKILL.md`, and hand over if it spawns one.
It checks the same preconditions again, cheaply, because it is also reached by someone typing
`/postmaster` on a machine that has done none of the above. Tell it what this session has
already settled — the config, the chosen target — and it will pick up from there rather than
asking twice. When the decision script says `self`, this session carries on as the postmaster;
when it says `spawn`, a separate postmaster session is started and this one stops.

**Prefer the scripts to doing it by hand.** They are the deterministic half of this flow and
they carry their own controls. Reasoning your way to a project list or a git check is slower,
costs tokens, and is how the wrong answer gets produced confidently.

## What it is

A three-role flow for getting one ticket implemented well by several models at once.

| role | what it does | where it is defined |
|---|---|---|
| **postmaster** | decomposes a stream into tickets, dispatches one coachman per ticket leg by leg, supervises, answers escalations, grants merges | `skills/postmaster/postmaster.md` (the front door session, or one it spawned) |
| **coachman** | drives one leg of one ticket; at most two legs, `synthesis` and `review`, each a fresh coachman with a written hand-off between them, carry a ticket from waybill to ship card: harnessing the team, judging their work, running the turnpikes its ticket names, clearing the gate | `skills/postmaster/coachman.md` |
| **the team** | several model lanes implementing the same ticket independently, in **blinkers**: separate worktrees, unable to see each other's work | `coachman.md`, lane table |

The postmaster runs no model lanes and edits no source. A coachman never takes a second
load. The **waybill** (`<dispatch>/brief.md`) is the only thing that travels between them.
Harness-specific invocations live in `skills/postmaster/harnesses.md`, and
`scripts/run launch` is their executable form: the runbooks name a form (launch, resume,
thread id), that file gives the command, the script runs it. Where a launch runs, and how the
user watches it, is the session host's: `skills/postmaster/hosts.md` records Herdr, tmux and no
host at all, and `scripts/run host` runs every launch through them. `SKILL.md` is the front door —
reached from this file or by typing `/postmaster`, it gets the machine ready if it is not and
starts the postmaster, in this conversation when the session is already the one
`team.postmaster` names in the target repo with the user at the terminal, and as a session it
spawns otherwise; `postmaster.md` is what the postmaster then does. A run is at most two
coachman legs, `synthesis` and `review`, each a fresh thread, so no context outlives a
leg and a leg's hand-off document is the whole of what the next leg knows. The review leg runs
only when the ticket names a turnpike that runs in it, and the last leg ends the run ready for
the user's merge with the ship card. A run dispatched before this change keeps its third `ship` leg.

## What the project has learned lives in the wiki

`wiki/` is this project's knowledge base: how harnesses really behave as against their
documentation, what the services the flow depends on actually do, why the design is shaped as
it is, and what happens when several models implement one ticket. `wiki/index.md` is a catalog
of one-line summaries, cheap to read; `wiki/schema.md` is the contract, including who may read
what. `skills/wiki` operates it.

A runbook says what an agent must do. The wiki says what the project knows, what it rests on,
how sure it is and what would change it. Do not restate one in the other.

**Read the index before decomposing a stream into tickets**, and the concepts that stream
touches. **Lanes do not read the wiki**, for the reason `wiki/schema.md` gives: a lane that
has read the project's findings about lanes is no longer an independent measurement of them.

## Vocabulary

Coaching-era, because the shape fits: several horses pull one load, and blinkers stop each
seeing the others. Both are load-bearing properties of the architecture, and no other
metaphor expresses them.

**waybill** the brief that travels with a load · **harness** the CLI wrapping a model ·
**blinkers** worktree isolation between lanes · **workhorse** a lane that implements the ticket,
as against a reviewer · **workhorse spec** a workhorse's own plan for the ticket, committed before
its code (`WORKHORSE-SPEC.md`) · **lead horse / wheeler** the ranked lanes ·
**turnpike** a check a run must pass through before it ships, named by its ticket: `default` is
the style, bug and security reviews, and the project's gate always runs besides them ·
**remount** resuming a stalled run ·
**spent** a run whose process is gone with no marker · **lame** a lane that is present but not pulling · **fleet** the
whole system.

`orchestrator` is deliberately NOT used: this flow has a postmaster.

## Design rules for the tool itself

1. **Nothing repo-specific.** No hardcoded paths, hosts, trackers, build tools or user
   names. The flow discovers what a project needs; it does not demand configuration.
   *Softened by #18:* a project may carry an optional `.postmaster/` folder holding what
   discovery cannot infer and what one instance chose, and every run's record. The rule
   still holds — the folder is optional, a project without one works as it does today, and
   nothing is demanded. What it adds is a place for a decision discovery cannot make and a
   correction where discovery guessed wrong, so the correction survives the run that made it.
2. **Nothing harness-specific in the flow.** Every harness has its own flags and its own
   event format. That belongs behind an adapter (`skills/postmaster/harnesses.md`), not in
   prose telling a reader not to confuse them. Trackers likewise (`skills/postmaster/trackers.md`),
   and session hosts (`skills/postmaster/hosts.md`).
3. **Deterministic work goes in `scripts/`, not in prose.** A check written as prose is
   re-derived, and mis-derived, on every run. A script gets it wrong once and is fixed.
4. **A prompt lives in argv.** Never select a process by matching text that could appear in
   a prompt; match on pid or working directory. Prefer `--prompt-file` where a harness
   offers it.
5. **Every count needs a control.** A positive control reading non-zero and a negative
   control reading zero, through the identical command.
6. **Every action on a project is logged as it happens**, one JSON line per action through
   `scripts/run log-action`, per run and per project. The narrative is for reading; the log
   is what a run is audited from and what the flow is improved from.

The scripts run on Bun 1.4.2 or newer: `scripts/run <name> [args]` is the one entry for every
tool script; it execs Bun with `--no-env-file` and the tool's own `bunfig.toml`, so a script run
inside a target project never loads that project's `.env` or Bun config. Runtime imports are
Bun's built-ins and Node's standard modules only; `typescript`, `@biomejs/biome` and `oxlint`
are the development dependencies, and `bun run check` is the type check, Oxlint, the Biome
format check, the tests beside every script, the runbook reference check and the wiki lint.

### Where a setting comes from

Precedence, stated once and followed everywhere: **discovery** supplies defaults; the
shared `.postmaster/project.toml`, where one exists, declares what the project requires of
every run; local `.postmaster/settings.toml` are this person's choices on this machine;
`~/.postmaster/config.toml` supplies what is machine-specific and is never overridden by a
project. None of these sets a floor of turnpikes: a ticket names the turnpikes its run
passes through (#40), and project settings only say what `default` means for that project.
A project's settings name no credential and no filesystem path, in either file
(`scripts/run project-settings`). Nothing in `.postmaster/` is committed by default; the one
shared file is committed on purpose with `git add -f`.

## Working on this repository

**Fix an open pull request instead of deferring its gaps to a ticket.** When you find a flaw
in work an open pull request introduces, fix it on that pull request's branch: a missing
check, a stale sentence, an instruction with no mechanism behind it, a rule written as prose
that belongs in a script. That does not widen the pull request. Finishing what it introduced
is part of the same change.

A ticket is for work the pull request never set out to do: it touches another contract, or
depends on something that does not exist yet.

The test is whether the fix completes what the pull request claims. "Is this a separate
concern?" is the wrong test, because nearly anything can be described as one. Before filing a
ticket, run `gh pr list` and check whether the work belongs in one of them.

**A script path in `skills/postmaster/` goes through `<tool>`**, the repo the skill finds from
its link: `<tool>/scripts/run stage`, never `scripts/run stage`, which resolves only from this
repo's root. The run's own pinned tool goes through `<rt>`, resolved per run by
`run run-meta path`. `scripts/run skill-refs` names every other path that does not go through
`<tool>`, and `--fix` rewrites the bare ones; run both after writing a runbook and after a rebase.
