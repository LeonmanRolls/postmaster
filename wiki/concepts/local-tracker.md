---
title: A repository's tickets can live in its own git directory, found without configuration
type: concept
standing: claimed
sources: []
updated: 2026-09-27
---

# The local tracker

**Claim.** A tracker that needs no service can keep a repository's tickets in that repository's
own git directory, outside the working tree and every branch, and a repository whose ticket
store exists can use it whatever tracker the machine's config names. Each ticket then has one
copy for every branch and worktree, no project needs configuring, and a script can make a
throwaway repository with its ticket already filed.

**Standing: claimed.** This is a decision taken on reasoning in
[issue #11](https://github.com/brindlewick/postmaster/issues/11), before any run bears on it.

## Why not a branch

An earlier tracker kept tickets on a `tickets` branch of the target repository, so every state
change was a commit. The runbooks hold that a ticket is state, and state does not belong in a
commit. This store is outside git's history altogether: two plain files per ticket, which git
does not track.

## Why the repository's git directory

Two places were weighed: this one, and a directory under `~/.postmaster/tickets/` named after
the repository, which the ticket's own notes suggested.

- **One copy for every worktree.** A repository's linked worktrees share its common git
  directory, so a run's worktree reads the same ticket files as the main checkout, and a state
  set from one is the state the other sees. `scripts/local.sh --self-test` checks both.
- **No name to collide.** A store under `~/.postmaster/tickets/<name>/` would be keyed by the
  repository's name, as the run records are. Two repositories with one name would share a
  store, and a repository that moved would lose its own. In the git directory, the repository
  itself is the key.
- **Nothing in the working tree.** A store never shows in `git status`, so it never makes a
  target look dirty to `scripts/check-target.sh`. The self-test checks that a store leaves
  `git status` empty and adds no branch or commit.
- **A throwaway repository takes its tickets with it.** Fixture runs
  ([issue #37](https://github.com/brindlewick/postmaster/issues/37)) make a fresh repository
  for each run. Once they file their tickets here, which is what this tracker was built for
  first, a run's ticket goes when its repository does, rather than leaving a store behind.

The cost is the other side of the last point. Deleting a repository deletes its tickets, and a
clone does not carry them. A project whose tickets must outlive its checkout, or be shared
between machines, belongs on a tracker with a service. Numbers also start at 1 in every store,
so a repository that ran GitHub tickets before reuses their numbers, and the flow names a run's
directory and branches by its ticket's number.

## Why the kind is discovered, not configured

`[tracker] kind` is one choice for the whole machine, and the config holds nothing about any
one project, since projects are discovered. A fixture run needs its fresh repository to use this
tracker on a machine whose config names GitHub for everything else. Naming each such repository
in the config would mean a script editing the user's config on every run.

The store is its own signal: it exists only in the repository it belongs to. So a repository
that has one uses it, and any other uses the config's kind. `scripts/tracker-kind.sh` holds
that rule in one place; `scripts/discover-project.sh` reports the kind, and
`scripts/ticket-check.sh` reads a ticket through it. Only a store that is known to be absent
sends a repository to the config's kind: when the script cannot look, the kind is not told.

That makes making a store a decision about where a repository's tickets live, since one made by
mistake moves a repository off the tracker the config names. So a store is made or removed only
on the user's word, as a GitHub board is, and only from the repository's main checkout, never
from a linked worktree, where lanes and coachmen work. One made by mistake can be removed while
it holds no ticket. The launch card shows the tracker a target will use, and a fixture run's
repository is made by a script the user runs for that purpose.

## Where the user looks

`scripts/local.sh <repo> list` prints every ticket, one line each, grouped by state in the
flow's order. `read` prints one ticket with the path of its body, a plain markdown file, and
`title` is where the user changes a title, which `edit` never does. Issue #11 did not need a
kanban view, and the store does not rule one out: a ticket's title, state and log are one small
JSON file beside its body.

## What would change it

- A user who loses tickets by deleting or re-cloning a repository, or who needs the same
  tickets on two machines. Either points that project to a tracker with a service.
- A run that uses the wrong tracker for its target: a store the user did not mean to make, or
  a repository that should have had one and did not.
- Fixture runs, the first use this was built for. The first recorded one that files and reads
  its ticket here is the test.

## What changed because of it

`scripts/local.sh` is the adapter, with the same command shape and read output as the other
two, and `skills/postmaster/trackers.md` describes it as the `local` kind. `store init` and
`store remove` refuse in a linked worktree. `scripts/tracker-kind.sh` names the kind a target
uses: `scripts/discover-project.sh` reports it as `tracker`, and warns when a github target has
no origin remote, and `scripts/ticket-check.sh` reads a ticket through it.
`scripts/probe-trackers.sh`, `scripts/setup.sh` and `config.example.toml` name the kind.
