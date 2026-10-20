# Installing the skills, tickets and project configuration

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

Back to the [README](../README.md).
