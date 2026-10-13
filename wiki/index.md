---
title: postmaster wiki
type: schema
updated: 2026-10-13
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
- [A second reviewer earns its keep; a second workhorse is cheap and not shown to](concepts/several-lanes.md):
  **claimed**. An audit of three days of runs: one reviewer lane alone found about half of the severe
  findings the coachman verified and two found over nine tenths. A second workhorse supplied a fix or
  a missing part in 12 of 18 real runs by the coachman's cards, and in 22 fixture runs each lane
  alone passed every hidden test. The coachman, the review loop and one security review cost most.
- [Mixing models for coding: what exists, what is shown, and what postmaster adds](concepts/mixing-models-for-coding.md):
  **claimed**. A read of 249 papers and project pages on 2026-10-04. Each part of the flow exists
  elsewhere, mixing models for coding is neither proven nor disproven, and independently built versions
  fail together. The whole combination run as an audited process, and an audit of its own flow, were
  not found elsewhere. The README's claim that the synthesis took from both lanes every time is not
  supported, and the lane audit is. A scan of 60 lane streams found no lane reading the other's code, one
  reading its plan and two reaching the run's blind tests.

## Harnesses

How each agent CLI really behaves, as distinct from what its documentation says.

- [Prompt delivery differs by harness](concepts/prompt-delivery.md): **settled**.
- [A resumed codex thread runs on the model its resume names](concepts/codex-resume-model.md):
  **settled**. A resume that names no model runs on codex's default, not on the thread's own.
- [A resume's exit status does not say it continued its thread](concepts/resume-exit-status.md):
  **settled**, for pi, Muse Code and MiMo Code. Resuming a thread it cannot find, a harness can
  exit 0 having done nothing, or having started a new thread.
- [A lane stays inside its worktree only when a sandbox wraps its harness](concepts/lane-confinement.md):
  **claimed**. In bypass mode every harness wrote into the main checkout and read another lane's
  worktree; their own guards switch off or check only what a tool call names. sandbox-runtime
  around the harness stopped every reach on all five, and every lane still passed the gate.
  A worktree still shares its repository's store; a shared clone per lane does not. The flow's `confine`
  setting isolates processes only, and a scan of 60 lane streams found reaches it did not stop.

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

## Reading tickets and changes

How the user reads what the flow puts in front of them, on a phone and an iPad.

- [A ticket or a change reads better as a story that scrolls, drawn before it shows code](concepts/story-pages.md):
  **claimed**. Three trial pages, two of one merged change and one of a ticket, judged by the user in turn: a
  section for each criterion, drawings before code, a picture and a plain welcome to start, and the ticket's words
  a step at a time. #352 builds it for tickets, and #434 has the booking clerk make one for every ticket.

## Checking code

What would find a defect in postmaster's own scripts before a reviewer does, and what it would cost.

- [What a functional core opens up for checking code, and what it does for coding with AI](concepts/functional-core-and-verification.md):
  **claimed**. Of 84 serious review findings in four runs, a stated property or a small model would have
  caught 79 and a pure core made the check possible for 24, none of them without a property. Proofs cost
  far more than the code they check, the one tool found that verifies TypeScript is a tech preview, and
  with language models the trust moves to the specification. Four changes to the design rules and the
  ticket template are proposed, and five trials, one of which tests a cleanup script with its git swapped
  for a mock that is checked against real git. The first part of trial 4 has been run: a check on environment, clock and
  import use flags 13 places on `main`, 3 of them defects, and points at the cause of 6 of the 8 findings it was tried on.
  The mutation counts of trial 4 have been run: the first flags 360 places on
  `main`, an estimated 312 of them not hazards, and reaches the function of 8 of the 78 findings that cite a line, about
  as many as random placement would give.
  A reading trial on three of the project's modules, with a small model as the reader, found the functional
  rewrite no easier to follow than the original, and about a tenth more effort than a tidy rewrite of the same size. One person shown one function in both
  versions preferred the functional one.
  The first trial ran: laws written blind from the ticket found 2 of 8 first-round findings of #202's
  classifier, 1 of the 5 counted cheap, and the proposal of a law for each reader of text is set aside.

## Decisions

Why the design is shaped as it is.

- [The workhorse spec](concepts/workhorse-spec.md): **claimed**. One spec per run, written by
  the coachman at the template's level and passed down, so the user reviews it once and the
  lanes still choose their own implementations.
- [The planning stage](concepts/planning-stage.md): **claimed**. The run's one spec passes
  the user's review in a spec session before any code, from Anthropic's AI-native SDLC playbook: a fault is
  cheapest to fix at the planning stage, and weaker models gain the most from a reviewed plan.
- [Faults a run finds in postmaster become tickets](concepts/tool-faults.md): **claimed**. A
  run records each fault in postmaster as it happens and never fixes the tool; a fault in a
  control stops the leg. When the run closes, its faults become tickets on postmaster's own
  tracker, carrying nothing of the target.
- [A ticket's shape is checked before it is accepted](concepts/ticket-shape.md): **claimed**.
  A title, the problem, numbered criteria each answerable yes or no, and the user's direction,
  checked by a script before any ticket is dispatched. What is missing is asked of the user.
- [Tickets and acceptance criteria that a run can finish](concepts/ticket-and-criteria-design.md):
  **claimed**. The template's four shapes that cannot be finished restate an old idea, the verifiable
  requirement, and each bounded form has older names and some support. The reading asks for the
  reason and the bar to be stated differently, for the direction and cost of "unknown" to be named, and
  names eleven other ways a criterion fails, the best measured a check that passes while the criterion
  is false. A count of 21 runs fits the rules and cannot test them. From [#293](https://github.com/brindlewick/postmaster/issues/293) and outside work; no rule
  was changed, and twelve changes are proposed.
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
- [Why runs take the review rounds they do, and what the planning stage could cut](concepts/review-rounds.md):
  **mixed**. Of 61 runs the median took 3 rounds, and a fifth of them hold 44% of the rounds, a
  third of all rounds being in the 13 runs before the loop's rule changed on 29 September. Rounds
  follow the first round's serious findings (rho 0.83), and across the 61 runs criteria and change
  size go with them through it, except that in the 15 single-thread runs the change's size keeps a
  link of 0.64 with rounds. Of 335 later findings that
  could be placed, 44% were in the change and not named before and 48% are in lines an earlier fix
  wrote. Two readers say a ticket left a point open for 8% to 20% of the marked later findings, most
  often a state or an input case. No one cause a ticket could settle accounts for more than about a
  twentieth of the rounds, and what a ticket's preparation seems to save shrinks once the runs
  before the script of 29 September are set apart. Runs with more than five criteria took 76 rounds above the
  smaller tickets' median (68 net). No stop signal tried predicts a clean next round above about
  half; the rise rule in force since 9 October, replayed, marks 16 of the 61 runs, which took a
  median 7 rounds against 3. From
  [#400](https://github.com/brindlewick/postmaster/issues/400); nothing was changed, and six
  changes are proposed.
- [Each project defines how a change to it is verified](concepts/verification.md): **claimed**.
  A project declares its checks or gets defaults by discovery; every workhorse runs them before
  it reports, and the coachman runs them again on each branch and on the synthesis.
- [A project's .postmaster/ holds its settings and every run's record](concepts/project-settings.md):
  **claimed**. Optional, records ignored, shared through one narrow file; run artifacts live
  with the project so two checkouts with the same basename no longer share a ledger.
- [A gate on the default branch after a merge runs from a clean checkout](concepts/clean-checkout-gates.md):
  **claimed**. The run's working copies stay under `.worktrees/`; the flow's post-merge gate
  runs from a clean checkout of the branch outside the project folder, so it never reads them.
- [The dashboard shows the fleet and can do nothing to it](concepts/dashboard.md): **claimed**.
  A read-only web page for phone, iPad and desktop. It takes every figure from the scripts that
  already compute it, listens on a Unix socket, and is reached only by the machine's owner
  through Tailscale's proxy over plain HTTP. It never acts, because anything it could do, an
  agent running as the user could do too. Its look, chosen by the user from 44 prototypes in #238
  as the easiest to read: navy and coral on cream, in the manner of an engraved notice.
- [No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md):
  **claimed**. A survey of 32 tools found none checking agent transcripts and git history together
  for personal data and secrets. A trial wrote #135's rules as data, and every one agreed with
  the scanner. Two more measured Jev and patterns for personal data: patterns match Jev on data
  with a shape or a label, raise less on real code, and leave names in prose, so the check uses
  patterns alone (#216). The gap is the reason to publish; the library is a later change of its
  own.

## Running the flow elsewhere

What it would take to run the flow on someone else's machines, and what the harness vendors say about it.

- [The flow could run on Cloudflare as a control plane and one container per launch, but not on a Worker, and not yet on
  subscription logins](concepts/running-the-flow-on-cloudflare.md): **claimed**. A Worker cannot run a lane; a container can, and
  Cloudflare's tutorials show Claude Code, Codex and Pi in one with the model key held outside it, for API credentials; an
  earlier example in its sandbox repository did the same for a Claude subscription token. No vendor's terms settle a
  subscription login held by a Worker for a cloud container. On Cloudflare alone a typical run costs about $1 to $4.50 in
  container time and the average run up to about $4 to $7, with the control plane at cents; the model bill, the same on any
  host, is a side note. Other on-demand providers charge about the same: Cloudflare is mid-pack, with several container
  platforms and hourly virtual machines cheaper for a typical run by under a dollar, and the platforms built for agent
  sandboxes dearer. A container per lane would stop every reach the isolation scan found inside the machine, by the
  documented design, and lifts the machine's cores as the limit on runs in flight, not the usage windows or the user's
  rulings. It would be an option a ticket chooses beside local runs. The whole flow, every role from the booking clerk to
  the merge, costs about $1.7 to $3.1 a typical ticket and $223 to $424 a month at the audited pace, with the interactive
  sessions asleep when idle and before the model bill; kept up between turns $485 to $647. The example flat prices of $50 to
  $200 are below that.

## Sources

[Recorded runs and captured reading](sources/index.md): one run, the review rounds of #36,
fourteen papers on review, fixes and severity, an article on review before implementation,
[pstack](sources/pstack.md), a plugin of skills for verified agent work, read twice and set beside
what postmaster holds, the reading on functional programming and verification (97 papers and
28 articles), and the Cloudflare documentation, the harness vendors' pages and their price pages, and the
pricing pages of other on-demand compute, read for running the flow on Cloudflare and elsewhere.
