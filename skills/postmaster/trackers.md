# Tracker adapters

The runbooks make five demands of a tracker and no more: read a ticket, set its state, add a
dated comment, create a ticket, and replace a ticket's body. This file says what each means for
each tracker kind the config allows (`<tool>/config.example.toml`, `[tracker]`). Every write is also
logged through `<tool>/scripts/log-action.sh` as `ticket-create`, `ticket-edit`, `ticket-state` or
`ticket-comment`. `<tool>` is the postmaster repo, as the runbook that sent you here found it.

**GitHub Issues is the default**, on a GitHub Projects board so the tickets are a kanban the
user can look at. Plane is another named kind, and `local` keeps a repo's tickets in its own
git directory, with no service and no login. Anything else is `other`. Tickets never
live on a branch of the target repo: a ticket is state, and state does not belong in a commit.

The ticket shape is the same everywhere: a title, then these headings in this order, so opening
one costs no orientation. `<tool>/scripts/ticket-check.sh` is its executable form. It requires the
title and the first four headings, and does not check `Notes` or `User journey`.

```
## Problem / feature
One or two sentences. What is wrong, or what is wanted, and why it matters.

## Acceptance criteria
Numbered. Each one answerable yes or no. What "done" looks like.

## Direction
The high-level technical direction the user wants: the approach, the constraints on how, and
anything the workhorses must not decide differently. Not a design: each workhorse drafts its
own spec from it. "None: any approach that meets the criteria" is a direction; leaving the
heading out is not.

## Turnpikes
The checks the run must pass through before it ships, besides the project's gate, which always
runs: `default`, `none`, or turnpikes by name, separated by commas. `default` stands for this
project's declared default set, alone or in a list. `<tool>/scripts/turnpikes.sh --list` lists the
turnpike names; `<tool>/scripts/turnpikes.sh resolve --project <repo> default` shows what
`default` means for the target. Only names go here; the reason for a choice goes in the notes.

## Notes
Everything else: context, links, decisions already taken, constraints, what is out of scope.
A ticket that changes something a person uses also carries a `## User journey`: where they
begin, what they tap or type, what they expect. A command-line app's examples are transcripts
in its User journey: a fenced block whose `$ ` lines are commands, each followed by what it prints and, when it exits
other than 0, a line `[exit N]`.
```

[Why a ticket carries a direction, and is checked before it is accepted](../../wiki/concepts/ticket-shape.md)

[Why a ticket names its turnpikes](../../wiki/concepts/turnpikes.md)

The flow's states are `todo`, `in-progress`, `blocked`, `done` and `cancelled`, and each
adapter maps them onto what its tracker has. Every adapter script prints a ticket the same
way (`id`, `title`, `state`, `labels`, `created`, the body, then a `## Log` of comments), so
a runbook reads a ticket without knowing which tracker it came from.

## github

GitHub Issues through the `gh` CLI, on a GitHub Projects board linked to the target repo.
The board is the kanban: its Status column, which every new board has as Todo, In Progress
and Done, carries the state, and an issue's card sits in the column its state says. GitHub
has no blocked column by default, so `blocked` is a label on the card, added without moving
it and removed by the next state change. `done` closes the issue; `cancelled` closes it as
not planned. The ticket id is the issue number, and the prefix discovery reads from commit
messages is `#`.

Everything goes through `<tool>/scripts/github.sh`, which reads the GitHub repository from the
target's origin remote and needs nothing configured. `gh` must be logged in with the
`project` scope (`gh auth login`, then `gh auth refresh -s project`); the user does both,
never an agent, and `<tool>/scripts/probe-trackers.sh` says whether they have.
An optional `.postmaster/project.toml` `[tracker].binding` selects the exact title of the linked
Projects board. Without it, the adapter keeps its discovered board choice. The shared binding is
a board name; its owner and the user's GitHub login are machine-side.

```sh
<tool>/scripts/github.sh <repo> board                        # the linked board and its URL; exit 3 if none
<tool>/scripts/github.sh <repo> board init                   # create a board named after the repo and link it
<tool>/scripts/github.sh <repo> create "<title>" <body-file> # prints the new issue number
<tool>/scripts/github.sh <repo> read <n>
<tool>/scripts/github.sh <repo> read <n> --body              # the body alone, exactly as stored
<tool>/scripts/github.sh <repo> edit <n> <body-file> <base-file>
<tool>/scripts/github.sh <repo> state <n> in-progress
<tool>/scripts/github.sh <repo> comment <n> coachman "<text>"
<tool>/scripts/github.sh <repo> list [state]
<tool>/scripts/github.sh <repo> access                       # the user's permission: ADMIN, WRITE, READ...
<tool>/scripts/github.sh <repo> search "<text>"              # issues holding it: number, open or closed, title
```

- **Board:** one per target repo, found through the repo's project links. A repo with no
  board is exit 3 from every command; `board init` creates one, named after the repo, and
  links it. Propose that to the user before running it, and give them the URL after: a
  board made from the CLI opens in table layout, and the switch to the board layout is one
  click on the page.
- **Read:** `read`, which prints the issue with its state worked out from the issue and
  the board together. `read --body` prints the body alone, exactly as stored.
- **Create:** `create` with a body file in the ticket shape; the issue is added to the board
  in Todo. An empty body file is refused, and so is a board with no Todo column, before
  anything is created. An issue created but not put on the board still prints its number, and
  exits 5.
- **Edit:** `edit` replaces the issue's body with `<body-file>`, and never its title.
  `<base-file>` is the body as `read --body` printed it when the change was drafted: if the
  issue no longer matches it, `edit` writes nothing and exits 4. It refuses an empty body
  file, and a number that is not an issue.
- **Set state:** `state`. `todo` and `in-progress` move the card and reopen a closed issue;
  `blocked` adds the label; `done` closes the issue and moves the card to Done; `cancelled`
  closes it as not planned.
- **Comment:** `comment`, dated to the minute, actor first (`postmaster`, `coachman`, or the
  user's word for themselves). The ready-to-merge comment is one such line pointing at
  `<dispatch>/card.md`.
- **Access:** `access` prints the user's permission on the repository, as GitHub names it.
- **Search:** `search`, GitHub's search of titles, bodies and comments for a phrase. It is an
  index, not an exact match, so a caller that needs one reads each issue it names.

## plane

Plane work items through Plane's REST API, cloud or self-hosted. A Plane project is a kanban
already, so its states are the columns: `todo` is the first state in the unstarted group,
`in-progress` is started, `done` is completed, `cancelled` is cancelled. Plane has no blocked
group either, so `blocked` is a label named `blocked`, as on GitHub. One Plane project per
target repo, matched by the project identifier that prefixes every work item id (`PM-12`),
which is the prefix discovery reads from commit messages; a target that has shipped one
ticket needs nothing configured, and one that has not is a question for the user.

Everything goes through `<tool>/scripts/plane.sh`. The instance and workspace are in the config:
An optional project `[tracker].binding` names the workspace slug. When the project is in
scope — `POSTMASTER_PROJECT` set, or run from the project's checkout — the binding must
match the machine config's `workspace`, and a mismatch is refused; with no project in
scope there is nothing to match, and the machine workspace is used as before. The instance
URL and API key remain machine-side.

```toml
[tracker]
kind = "plane"
url = "https://api.plane.so"     # cloud; a self-hosted instance is its own origin
workspace = "<slug>"             # the segment after the host in the workspace's web URL
```

The API key is `PLANE_API_KEY` in `~/.postmaster/plane.env` (or the file `[tracker]
env_file` names), one line, made in Plane under profile settings, API tokens. The user
writes that file; the key never passes through a conversation, the config or this repo.
`<tool>/scripts/plane.sh projects` proves the three of them agree by listing the workspace's
projects, and `<tool>/scripts/probe-trackers.sh` runs it.

```sh
<tool>/scripts/plane.sh projects                             # identifier, id and name of every project
<tool>/scripts/plane.sh create <IDENT> "<title>" <body-file> # prints the new id, IDENT-n
<tool>/scripts/plane.sh read PM-12
<tool>/scripts/plane.sh read PM-12 --body                    # the body alone, as markdown
<tool>/scripts/plane.sh edit PM-12 <body-file> <base-file>
<tool>/scripts/plane.sh state PM-12 in-progress
<tool>/scripts/plane.sh comment PM-12 coachman "<text>"
<tool>/scripts/plane.sh list PM [state]
```

- **Read:** `read`; the body Plane stores as HTML comes back as markdown in the ticket
  shape. `read --body` prints that markdown alone.
- **Create:** `create` with a markdown body file; the script renders it to the HTML Plane
  stores and puts the item in the todo state. It refuses a body that would not read back
  with the same words and structure.
- **Edit:** `edit` renders the body file as `create` does and replaces the description, and
  never the title. `<base-file>` is the body as `read --body` printed it when the change was
  drafted: if the work item no longer matches it, `edit` writes nothing and exits 4. It
  refuses, exit 1, a work item whose description `read` does not show as Plane stores it:
  markup `read` does not render, such as a table, an image, emphasis or an HTML comment,
  which it names, or text it would read back as something else. The user makes that change
  in Plane. It also refuses an empty body, and one that would not read back with the same
  words and structure.
- **Set state:** `state`, one API call per change; `blocked` is the label.
- **Comment:** `comment`, the same dated line as on GitHub.

## local

Tickets in the target repository's own git directory, for a repo with no remote, or a user
with no network or no login. Nothing is installed or configured beyond bash, git and python3.
The store is `postmaster/tickets/` in the repository's common git directory
(`.git/postmaster/tickets/` in a plain checkout): outside the working tree and every branch,
the same for every worktree, and removed with the repository. A ticket is `<n>.md`, its body
as written, and `<n>.json`, its title, state, labels, created time and log. The ticket id is
its number, written `#<n>` as on GitHub.

**A repo whose store exists uses this tracker, whatever `[tracker] kind` names**, and any other
repo uses the config's kind. `<tool>/scripts/tracker-kind.sh <repo>` names the kind a repo uses:
`<tool>/scripts/discover-project.sh` reports it as `tracker=`, and `<tool>/scripts/ticket-check.sh <repo>
<id>` reads through it.

Everything goes through `<tool>/scripts/local.sh`, which takes any checkout of the repo, a linked
worktree included:

```sh
<tool>/scripts/local.sh <repo> store                         # the store's path; exit 3 if none
<tool>/scripts/local.sh <repo> store init                    # make the store
<tool>/scripts/local.sh <repo> store remove                  # remove a store that holds no ticket
<tool>/scripts/local.sh <repo> create "<title>" <body-file>  # prints the new number
<tool>/scripts/local.sh <repo> read <n>
<tool>/scripts/local.sh <repo> read <n> --body               # the body alone, as stored
<tool>/scripts/local.sh <repo> edit <n> <body-file> <base-file>
<tool>/scripts/local.sh <repo> title <n> "<title>"
<tool>/scripts/local.sh <repo> state <n> in-progress
<tool>/scripts/local.sh <repo> comment <n> coachman "<text>"
<tool>/scripts/local.sh <repo> list [state]                  # every ticket, grouped by state
```

- **Store:** `store init` makes one and `store remove` removes one that holds no ticket, each
  only on the user's word and only from the repo's main checkout; from a linked worktree both
  refuse. Every other command on a repo without a store exits 3. `discover-project.sh` warns
  when a github target has no origin remote, and so can have no board: a store is the one to
  propose.
- **Read:** `read` prints the ticket, with a `path:` line naming its body file. `read --body`
  prints the body alone, as stored, ending in a newline. `list` is where the user sees the
  tickets: one line each, grouped by state in the flow's order. It names on stderr each ticket
  whose file it cannot read, and exits 1.
- **Create:** `create` with a body file in the ticket shape; the ticket starts in todo. It
  refuses an empty body, and a title that is empty or more than one line.
- **Edit:** `edit` replaces the body with `<body-file>`, and never the title. `<base-file>` is
  the body as `read --body` printed it when the change was drafted: if the ticket no longer
  matches it, `edit` writes nothing and exits 4. Either file may be `/dev/stdin`.
- **Title:** `title` is where the user sets a title, as they would on GitHub's page. Like any
  change to a ticket's text, it waits for the user's word.
- **Set state:** `state`. All five states are the ticket's own, `blocked` included.
- **Comment:** `comment`, the same dated line as on GitHub, kept in the ticket's log.

[Why a repo's tickets live in its git directory, and its tracker is discovered](../../wiki/concepts/local-tracker.md)

## other

A tracker the agent reaches through its own tooling, an MCP server or a CLI. The config names
it, and the setup session records how each of the five demands is met in
`~/.postmaster/trackers/<name>.md`, outside this repo and in the same shape as the sections
above, so the user's instance never enters the flow. Until that file exists the tracker is
not configured, however reachable it is. One written before a body could be replaced says
nothing about it; until it does, the user makes an approved change in the tracker.

## postmaster's own tracker

A fault a run meets in postmaster itself is filed on postmaster's own tracker, never the
target's. That tracker is GitHub, whatever the config's kind: the repository the origin of
postmaster's own checkout names, when postmaster is a checkout of its own and `access` says
ADMIN, since nothing is filed on a repository the user does not own.
`<tool>/scripts/tool-faults.sh` finds a fault's ticket with `search` and files one with
`create`. With no such tracker, the fault stays in the run's records.
