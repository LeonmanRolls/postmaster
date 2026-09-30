---
title: postmaster wiki
type: schema
updated: 2026-09-29
---

# postmaster wiki

What this project has learned: how the agent CLIs it drives really behave, what the services
it depends on actually do, why the design is shaped as it is, and what happens when several
models implement one ticket. That last question is the reason the project exists.

Each page makes a claim and says how sure it is, from **claimed** (stated, with nothing behind
it yet) to **settled** (tested, including the test that could have overturned it). Each claim
cites the evidence it rests on, kept in [`raw/`](../raw/README.md) in this repository, so you
can open it and check. [How the wiki is kept](schema.md) defines the standings in full, and
[the log](log.md) lists recent changes.

## Combining models

Does implementing one ticket with several models, each unable to see the others' work,
produce better software than one good model? If so, how?

- [Combining models](concepts/combining-models.md): three hypotheses and five open questions,
  all **claimed**, since no dispatched run has been promoted yet. An audit of 25 syntheses bears
  on H1: the coachman's record of what it took from each lane cannot fail, and the second lane's
  share, counted in git, ranges from nothing to most of the code.

## Harnesses

How each agent CLI really behaves, as distinct from what its documentation says.

- [Prompt delivery differs by harness](concepts/prompt-delivery.md): **settled**.
- [A resumed codex thread runs on the model its resume names](concepts/codex-resume-model.md):
  **settled**. A resume that names no model runs on codex's default, not on the thread's own.
- [A resume's exit status does not say it continued its thread](concepts/resume-exit-status.md):
  **settled**, for pi, Muse Code and MiMo Code. Resuming a thread it cannot find, a harness can
  exit 0 having done nothing, or having started a new thread.

## Trackers and tooling

What the services and CLIs postmaster depends on actually do.

- [Herdr and headless launches](concepts/herdr-headless-launches.md): **settled**, for claude.
  Left to itself Herdr shows a working headless claude as idle, and a launch that inherits its
  caller's pane reports into it; the view is true when each launch owns its pane and the host
  reports its state.
- [Herdr reads most agents' state from the screen](concepts/herdr-agent-states.md):
  **settled**, for Herdr 0.9.1. A settled state from its waits does not prove a turn finished.

## Testing the flow

How the flow is checked, and what each check can and cannot see.

- [Fixture runs](concepts/fixture-runs.md): **claimed**. A run against a small app whose tickets
  have hidden tests, scored from the run's own records, catches a broken contract between roles
  and a run that ships the wrong thing, which the offline gate cannot.

## Decisions

Why the design is shaped as it is.

- [The workhorse spec](concepts/workhorse-spec.md): **claimed**. Each workhorse drafts its
  own, which keeps the workhorses independent of each other and of the coachman, and makes
  each run auditable.
- [The planning stage](concepts/planning-stage.md): **claimed**. Each workhorse's spec passes
  the user's review before any code, from Anthropic's AI-native SDLC playbook: a fault is
  cheapest to fix at the planning stage, and weaker models gain the most from a reviewed plan.
- [Faults a run finds in postmaster become tickets](concepts/tool-faults.md): **claimed**. A
  run records each fault in postmaster as it happens and never fixes the tool; a fault in a
  control stops the leg. When the run closes, its faults become tickets on postmaster's own
  tracker, carrying nothing of the target.
- [A ticket's shape is checked before it is accepted](concepts/ticket-shape.md): **claimed**.
  A title, the problem, numbered criteria each answerable yes or no, and the user's direction,
  checked by a script before any ticket is dispatched. What is missing is asked of the user.
- [A ticket names the turnpikes its run passes through](concepts/turnpikes.md): **claimed**.
  `default` for the style, bug and security reviews, fewer, or `none`, with no floor. The
  project's gate is not a turnpike and always runs.
- [The review loop](concepts/review-loop.md): **claimed**. Style, bug and security review run
  as one loop in one leg, so each round's fixes are re-reviewed by the gating lenses a ticket names, in the
  next. It should also take fewer rounds. Style gates nothing: its
  findings feed the project's linter.
- [Live agents against markers and resumes](concepts/live-agents.md): **claimed**. Headless
  stays the default and live agents become an option; what it would take to change the default.
- [A skill is a link to the postmaster repo, never a copy](concepts/skill-links.md):
  **claimed**. Each skill is linked from a harness's own skills folder to the main checkout, and
  a session finds the repo from that link. Five harnesses were tried, and each loads a linked skill.
- [A run keeps the config it started with](concepts/run-config.md): **claimed**. Every launch
  and resume in a run reads the config recorded at dispatch, so no lane changes part-way
  through. A change to the config reaches the next run.
- [A lane may review through its harness's own skill](concepts/own-review-skills.md):
  **claimed**. A security lane runs its harness's own security review skill where it has one,
  and the brief where it has none; Claude Code's needs a clone whose `origin/HEAD` leads back to
  the base. A bug lane runs its harness's code-review skill where it has one, names the change
  from BASE, and does not review at all where it has none.
- [The local tracker](concepts/local-tracker.md): **claimed**. With no service and no login,
  a repository's tickets live in its own git directory, and a repository whose store exists
  uses it whatever the config names.
- [When a review loop should stop](concepts/review-convergence.md): **claimed**. Model reviewers
  do not run out of minor findings, so a loop should end on verified serious findings in the
  change's own code, and a mechanism whose fixes keep breaking should be redesigned rather than
  fixed again. From the review of #36 and outside work. The user chose: fix as much as can be
  fixed in the first round, then repeat until there are no more P1 and P2 findings, with the cap
  of three rounds as a backstop; many bugs reaching production stays the signal to revisit.
- [Each project defines how a change to it is verified](concepts/verification.md): **claimed**.
  A project declares its checks or gets defaults by discovery; every workhorse runs them before
  it reports, and the coachman runs them again on each branch and on the synthesis.
- [A project's .postmaster/ holds its settings and every run's record](concepts/project-settings.md):
  **claimed**. Optional, gitignored whole, shared through one narrow file; run artifacts live
  with the project so two checkouts with the same basename no longer share a ledger.
- [A gate on the default branch after a merge runs from a clean checkout](concepts/clean-checkout-gates.md):
  **claimed**. The run's working copies stay under `.worktrees/`; the flow's post-merge gate
  runs from a clean checkout of the branch outside the project folder, so it never reads them.

## Sources

[Recorded runs and captured reading](sources/index.md): one run, the review rounds of #36,
fourteen papers on review, fixes and severity, and an article on review before implementation.
