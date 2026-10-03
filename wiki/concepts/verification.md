---
title: Each project defines how a change to it is verified
type: concept
standing: claimed
sources: []
updated: 2026-09-27
---

# Each project defines how a change to it is verified

**Claim.** How a change is shown to work belongs to the project, not to the tool and not to each
lane. A project declares its checks: named commands, each saying what it shows. A project that
declares none gets defaults, found by discovery the way the gate is. Every workhorse runs the
same checks before it reports, and the coachman runs them again on each workhorse's branch and on
the synthesis. "Verified" then means the same thing in every summary and on every card.

**Standing: claimed.** This is a decision taken on reasoning in
[issue #56](https://github.com/brindlewick/postmaster/issues/56), before any run bears on it.

## The reasoning

- **A lane left to itself verifies its own way.** One runs the unit tests, another runs the app,
  a third reasons about the code. Their summaries all say "verified" and mean three things, and
  the coachman has no fixed standard to hold a claim against. A list of checks the run fixes at
  dispatch is that standard.
- **The project knows what "works" means.** For a library it is its tests through its public
  interface. For a command-line app it is running the command. For a web app it is a person's
  path through the pages. For a model-backed feature it may be an eval set with a pass
  threshold. The tool cannot know which, so the project says, and discovery supplies a first
  guess where it does not.
- **Declaring is optional.** The flow discovers what a project needs rather than demanding
  configuration. A project with no declaration still gets checks: the gate, and whatever
  discovery can tell about its kind.
- **The gate stays the gate.** It is the one command that must pass before anything ships.
  Verification is wider: the gate is always one of the checks, and the others show that the
  change does what its ticket says.
- **A run is held to the checks it recorded.** The checks are written once at dispatch, like the
  config the run keeps ([a run keeps its config](run-config.md)). A branch that edits its own
  declaration cannot loosen the checks it is judged by, and the coachman's run reads the record,
  not the worktree's copy.
- **A check that could not run is never a pass.** Each result is pass, fail or not run, and a
  card shows every one. A missing tool, a missing example or a missing walk reads as not run,
  so a green line means something ran and passed. A command cannot pass on a later line or the
  far end of a pipe after an earlier part failed, and a scored check that crashes fails whatever
  score it printed first.
- **A result belongs to a commit.** The checks refuse a worktree holding anything git sees that
  its commit does not, a check that leaves such a file fails, and a walk counts only for the
  commit it walked. What a card says was verified is then what the
  branch holds, and the postmaster can read back a result for the exact commit it is asked to
  merge.
- **A workhorse runs its checks without the run's directory.** That directory holds the other
  lanes' streams while they run. The checks and the ticket are copied into the workhorse's own
  worktree, where git ignores them, so the workhorse needs no path to anything beyond its
  blinkers.

## What the defaults cover

| a project that is | found by | check | what it does | not run when |
|---|---|---|---|---|
| any | always | `gate` | runs the gate discovery found, or the one the launch card settled | there is no gate |
| a command-line app | a `bin` in package.json | `examples` | runs the example transcripts in the ticket's User journey through the bin, each block in a fresh directory, and compares what a terminal would show and the exit | the User journey has no transcript, or the bin, its interpreter or its build tool cannot be run |
| a web app | a browser suite (an `e2e`-style script, a Playwright or Cypress config) or a web framework among its dependencies | `browser` | runs the suite | there is no suite |
| | | `journey` | holds the agent's report of walking the ticket's User journey to the ticket: every step, in order, marked did or did not, with a screenshot beside the report | the ticket has no journey, there is no report for this commit, or a step is not recorded |
| a library | package.json `exports`, or `main` or `module` on a package that is not private | `library` | runs the test files that declare a test and import the package by its name, through the project's own runner, after its build; helpers and fixtures are not tests | no test imports it by name, or its runner, node or its build tool is not installed |

A Cargo or pyproject project is recognised as a command-line app or a library, and its `examples`
or `library` check reports not run, saying to declare the check.

## What the defaults do not do

- **The journey check does not click.** A script cannot follow a prose journey, so the walk is
  the agent's, in the project's own browser library. The script holds the report to the ticket's
  steps, and a walk counts only for the commit it walked.
- **Only package.json projects get defaults that run beyond the gate.** A runner for Cargo or
  pytest would ship with no control that could run on the machine it was written on.
- **The examples check sees what a terminal shows.** Output and errors are compared together, so
  a transcript cannot say which stream a line went to.
- **Discovery guesses.** A library built with a web framework's tooling may be read as a web app.
  Its extra checks then report not run; none reports a pass it did not earn.
- **It replaces no oracle.** The coachman's blind acceptance tests stay its own, written before
  it reads any lane's work, and a fixture's hidden tests stay hidden from every lane.

## Where it is declared

In `.postmaster/project.toml`, the one settings file a project commits, as
[issue #18](https://github.com/brindlewick/postmaster/issues/18) describes it. The file's shape
is `project.example.toml` at the repository root, beside `settings.example.toml` for the local
choices that never travel. Checks are one of the things the shared file holds; see
[a project's .postmaster/](project-settings.md) for the rest and the precedence.

## What would change it

Fixture runs ([issue #37](https://github.com/brindlewick/postmaster/issues/37)) with declared
checks set beside runs without them: whether the checks change what the runs ship. The `verify`
lines in each run's log count how often a check fails on a workhorse's branch, how often a
summary's claim disagrees with the coachman's run, and how often a check is not run. A check that
is never anything but not run is one the defaults should not offer.

## What changed because of it

`scripts/run verify` reads a project's declaration or finds its defaults, records the run's checks
at dispatch, copies them into worktrees, runs them and logs each result as a `verify` action.
Each default is its own script with a self-test: `scripts/run verify-examples`,
`scripts/run verify-journey` and `scripts/run verify-library`. `scripts/run discover-project`
reports each check and where it came from, the waybill carries them, a workhorse's brief names
them and its summary gives each one's command and exit. The coachman runs them at harvest and
before each card, and the postmaster checks that the final commit has a result for each before
it grants a merge. The fixture app declares its own checks, and the remove ticket's User journey
carries its journey as a transcript, so a fixture run exercises the declared path and the
examples check alike.
