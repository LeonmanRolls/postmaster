---
name: postmaster
description: 'Start work with postmaster on this machine, from any directory. It is the front door and establishes its own preconditions: it finds the postmaster repo from its own link, conducts setup if needed, and reuses a target the session already chose. It lists git projects by recency, verifies the target, handles a dirty tree, discovers the project gate, docs and tracker, confirms a launch card, then continues in this conversation or starts a separate postmaster session according to the configured harness and model, target and terminal presence. The postmaster decomposes a stream into tickets and dispatches coachmen. Reached by typing /postmaster or by AGENTS.md.'
---

# /postmaster: start work with postmaster

You get the machine ready if it is not, choose a target, confirm a launch card, and route the
postmaster role. When the current session qualifies, continue this conversation as postmaster;
otherwise start a separate session and report where to watch it. Once acting as postmaster,
follow `postmaster.md` beside this file.

The postmaster dispatches one **coachman** per ticket, one leg at a time. A coachman drives
exactly one leg of one load and hands off to the next leg in writing; its runbook is
`coachman.md`. Harness-specific invocations are in `harnesses.md`, tracker mechanics in
`trackers.md`, where a launch runs and how the user watches it in `hosts.md`, and the machine's choices — which harnesses, which lanes, which tracker — in
`~/.postmaster/config.toml`, whose shape is `<tool>/config.example.toml`. There is
no separate per-ticket skill: dispatching a coachman is something the postmaster does, not
something a person invokes.

## First: find the postmaster repo

`<tool>` in these runbooks is the postmaster repo this skill lives in. The skill is installed as
a link into it, never as a copy. Find it once, from `<skill>`: the absolute path of the directory
your harness loaded this file from, or `skills/postmaster` when `AGENTS.md` sent a session in
the repo here.

```sh
t=$(CDPATH= cd -P -- "<skill>/../.." 2>/dev/null && pwd) && test -f "$t/scripts/link-skills.sh" && echo "$t" || { echo "postmaster: <skill> is not a link into a postmaster checkout" >&2; false; }
```

It prints `<tool>`. Write that absolute path wherever these runbooks say `<tool>`, and give it to
every session you brief. If it prints the error instead, stop and tell the user: the skill was
copied, or its link points somewhere else. `<checkout>/scripts/link-skills.sh`, where
`<checkout>` is their postmaster checkout, links it again.

[Why a skill is a link, and the repo is found from it](../../wiki/concepts/skill-links.md)

## Next: establish the preconditions yourself

You are reached two ways, and they arrive in different states. A session opened in this repo
comes through `AGENTS.md`, which may already have set the machine up and chosen a target.
Someone typing `/postmaster` arrives cold. **Assume neither. Check.**

```sh
cat ~/.postmaster/config.toml 2>/dev/null || echo "NOT SET UP"
```

**No config: stop and set the machine up first**, in conversation, per the setup section of
`<tool>/AGENTS.md`; each path there is relative to `<tool>`. Do not continue to target
selection: every later step reads the config for the team, the tracker and the merge word,
and without it the launch card cannot be filled. Come back here when it is written.

**Config present, and this session has already chosen and verified a target:** skip to
"Work out what the project needs" and do not ask again.

**Config present, no target yet:** carry on below.

Say which of these you found, in one line, before doing anything else. A session that cannot
tell whether it is setting up or dispatching is one nobody can follow.

## Choose the target project

**Ask the user which project to dispatch against, whatever the cwd.** The cwd may be `<tool>`
itself or any other project, and neither is the target until the user says so. Do the finding
for them:

```sh
<tool>/scripts/find-projects.sh [root ...]   # most recently worked first; ~/Code unless roots are given
```

**Sort by last commit and show about twelve.** Recency is the best available proxy for
intent, and it does the filtering that rules cannot: dormant repos and scratch work fall
off the list without needing to be named. Offer the full list on request.

**Exclude third-party clones** (`external/` or wherever they live). Nobody dispatches work
into a vendored copy of someone else's project.

**Do NOT filter to projects with a remote.** Plenty of real work is local-only, and
filtering on a remote silently hides it. Show the remote status as information instead: it
decides whether push and PR steps apply, and a local-only project is normal, not broken.

Adjust the search roots to the machine. `~/Code` is one convention, not a rule.

## Precondition: verify the chosen target, and fail if it does not hold

**The chosen project must be a git repository.**

```sh
<tool>/scripts/check-target.sh "$TARGET"   # 0 usable · 1 not a repo · 2 dirty, ask first
```

**Read its exit code and stop on 1.** Do not offer to `git init`, do not walk up looking for
a repo, and do not proceed in a directory that merely contains one. A postmaster with no
repository has nothing to dispatch against, and every later stage (worktrees, gates,
merges) fails in a more confusing way further in.

## A dirty tree is a question, not a failure

Exit 2 from the check means uncommitted work. Coachmen branch from committed HEAD, so
uncommitted work is silently excluded from every run and the user does not find out
until something ships without it. Say what is uncommitted and offer, in this order:

1. **Commit it**: finished work that belongs in the base.
2. **Stash it**: unrelated to this stream. The stash is a shared stack, so name what you
   pushed and where it can be found again.
3. **Commit it to a base branch and dispatch from there**: when the uncommitted work IS
   the starting point.
4. **Hand back**: when none of those is obviously right.

Never choose silently, and never `git checkout`, reset or discard anything.

## Work out what the project needs: discover, do not demand

The flow is general and carries no assumptions about build tools, docs layout or trackers.
**Discover them; only ask when discovery genuinely fails.** A general tool that needs a
config file before it runs on a plain git repo is a tool nobody adopts.

```sh
<tool>/scripts/discover-project.sh "$TARGET"   # gate=… docs=… tracker=… tracker_prefix=… ambient_context=…
```

The target's tracker is the kind `tracker` names: `local` when the target's own ticket store
exists, whatever the config names, and the config's kind otherwise (`trackers.md`, local).
A github tracker needs the target's board: `<tool>/scripts/github.sh "$TARGET" board` names it, and
exit 3 means there is none yet, so propose `board init` to the user and hand them the URL
it prints. A plane tracker needs the target's project identifier: the discovered
`tracker_prefix` when the target has shipped a ticket, otherwise `<tool>/scripts/plane.sh projects`
lists the candidates and the user picks. A local tracker needs its store: exit 3 from
`<tool>/scripts/local.sh "$TARGET" store` means there is none yet, so propose `store init` to the
user. A github target with no origin remote can have no board, and `discover-project.sh` warns
of it: propose `<tool>/scripts/local.sh "$TARGET" store init` to the user instead. Report what
you found on the launch card, and ask only about what you could not determine.
**If the project has no `AGENTS.md` or equivalent, say so.** Lanes that read no ambient
context start blind, and that has silently handicapped a lane before. Ask the user for
the project's risk surfaces (what it binds, allowlists, spawns and serves) where the docs do
not say; the security lens reviews against them.

## Stage 0: scope, confirm, choose the postmaster session

1. **Scope the stream.** From the user's words plus a read-only pass over the named
   sources, write one paragraph: what the stream is, its likely first few tickets, and
   which parts of the project they touch. Do not deep-dive; the postmaster does that.
2. **Carry un-ticketed work into the stream paragraph.** After the user confirms the launch
   card, the postmaster handles its first ticket under Stage A in `postmaster.md`; do not
   create a tracker ticket before that confirmation.
3. **Choose the postmaster session and show the launch card.** Report the current session's
   harness and model, its working directory, and whether a person is at the terminal. Use
   `yes` only when this conversation can ask and receive answers from a person; a headless
   session reports `no`. Do not copy the configured harness or model into the session report.
   Run the route check against the selected target and the machine config:

   ```sh
   <tool>/scripts/postmaster-route.sh "<reported harness>" "<reported model>" "$PWD" <yes|no> "$TARGET"
   ```

   It prints `self: ...` when this conversation will be postmaster, or `spawn: ...` with every
   reason a separate session is required. The launch card includes that result and explains
   that the selected route is the postmaster for this project. Also cover the configured
   postmaster harness, model and effort (`team.postmaster`), the team the config names, who
   says the merge word (`ship.merge_authority`), the session host the fleet will run on
   (`<tool>/scripts/host.sh detect`), and the project facts above. Launch nothing before the
   user confirms.
4. **Record the confirmed launch before acting as postmaster.** Set `<runs>` to
   `~/.postmaster/runs/<project>/`, where `<project>` is the repo's basename, and create its
   postmaster directory:

   ```sh
   RUNS="$HOME/.postmaster/runs/$(basename -- "$TARGET")"
   mkdir -p "$RUNS/postmaster"
   ```

   Write
   `brief.md`, beginning with "You are the postmaster for <project>. Follow
   `<tool>/skills/postmaster/postmaster.md`," followed by the confirmed stream paragraph,
   project profile, configured team, merge authority, host, `<tool>` and config path, plus the
   current session's reported harness, model, working directory and terminal presence and the
   route result. This is the durable context a postmaster restarted from nothing reads to carry
   on. Then log the first action:

   ```sh
   <tool>/scripts/log-action.sh "$RUNS/postmaster" postmaster note launch "<route result>"
   ```

   This `note` is the postmaster's first action and writes to both `actions.jsonl` and the
   project's `ledger.jsonl`.
5. **Continue or spawn according to the route result.** For `self`, continue in this same
   conversation, read `postmaster.md` beside this file, and start its Stage A. Do not open a
   second session. For `spawn`, start the configured postmaster on the session host (`hosts.md`)
   using the brief just written. Start an interactive session of `team.postmaster`'s harness,
   rooted in the target repo, in the harness's interactive form from `harnesses.md`: its bypass
   mode, named `<project> · postmaster`. Hand it a one-line prompt file that tells it to read
   the brief at `$RUNS/postmaster/brief.md` first, then the runbook named there:

   ```sh
   <tool>/scripts/host.sh spawn postmaster-<project> <repo> --label "<project> · postmaster" -- <interactive form>
   <tool>/scripts/host.sh send postmaster-<project> <prompt-file>
   <tool>/scripts/host.sh read postmaster-<project>      # it took the message: a new session can drop one
   ```

   On Herdr it opens as a tab in the target repo's space, the root of every run's tree; on tmux,
   as a window in session `postmaster-<project>`. If `spawn` says it is not ready, the harness is
   asking something on its first start there, such as claude asking whether to trust the folder:
   the user answers it in the pane, and then the prompt is sent. With no host, `spawn` exits 3:
   launch it headless instead, as `hosts.md` gives under none, with a line in its brief that it
   runs headless, so whenever it needs the user it writes `<runs>/postmaster/ESCALATION.md` and
   ends its turn; tell the user it answers by resume.
6. **Report** where to continue or watch it (this conversation, the space and tab, the tmux
   session, or with no host its events file), the run root, and the brief. Stop only after
   spawning; when route is `self`, continue directly into `postmaster.md`.

## The waybill

The postmaster writes one per ticket at `~/.postmaster/runs/<project>/<TICKET>/brief.md`.
It is the only thing that travels between the postmaster and a coachman, so it carries
everything the coachman needs and nothing it must go and find:

```
# Waybill: <TICKET>
<the turnpikes: line <tool>/scripts/ticket-check.sh printed for the ticket, whole: turnpikes: <names> or turnpikes: none>

## Ticket
<the ticket verbatim: problem, acceptance criteria, direction, turnpikes, notes, User journey if it has one>

## Project profile
repo: <abs path>          default branch: <name>       BASE: <sha>
gate: <the real command>  build: <the real command>    browser suite: <command or none>
docs to read first: <files, in order>
tracker: <kind, and how a ticket is read and written>
risk surfaces: <what the project binds, allowlists, spawns, serves; from its docs or the user>

## Team
workhorses: <lane>=<harness>/<model>/<effort>, <lane>=…
reviewers: <lane>, <lane>
<lens> reviewers: <lane>, <lane>          (one line for each lens the config gives its own lanes)
coachman: <harness>/<model>/<effort>      (never a lane's model)
CHECKPOINT_MODE and MERGE_AUTHORITY come from ship.checkpoint_mode and ship.merge_authority, overridden only where the user says so for this run

## Dispatch
name: <ticket id>, <ticket title>
dispatch: <abs path of this directory>
synthesis worktree: <abs path; cut by the postmaster at BASE, the coachman's cwd for every leg>
tool: <abs path of the postmaster repo: <tool> in the runbooks>
postmaster ruling channel: resume the coachman's thread (harnesses.md) with the ruling as the prompt
```

## Hard rules

- Once the launch card is confirmed, the selected postmaster session runs the stream. Its job is
  `postmaster.md`.
- The postmaster runs no model lanes and edits no source. Its tokens buy judgment:
  decomposition, dispatch, supervision, escalation, merge grants, and talking to the
  user.
- All work in worktrees; the project's default branch stays clean.
- Verify claims against code before trusting them, above all before granting a merge.
- Every action on a project is logged as it happens, through `<tool>/scripts/log-action.sh`, by
  the postmaster and by every coachman. The narrative is for reading; the log is for
  learning.
- Prefer a script to a hand-rolled step. Anything deterministic (drift checks, collision
  surfaces, gate runs, completion detection) belongs in a script, not in prose that a
  model re-derives every run.
