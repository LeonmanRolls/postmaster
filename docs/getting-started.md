# Getting started

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

Back to the [README](../README.md).
