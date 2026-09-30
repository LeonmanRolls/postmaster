---
title: Log
type: schema
updated: 2026-09-30
---

# Log

Append-only. Newest first. One entry per operation, prefixed so it can be parsed.

## [2026-09-30] ingest | a gate on the default branch after a merge runs from a clean checkout

Issue #110. A design decision, with the control that shows it. The fixture app's `npm run
check` failed on main right after a merge in fixture runs 4 and 5 (2026-09-28), because Biome
walked into the run's own worktrees under `.worktrees/`, and passed once they were removed.
The copies stay where the machine's convention puts them; the flow's two post-merge gates (the
ship leg's verification of the merged default branch, and fixture scoring's gate) now run from
a clean checkout of the branch outside the project folder, through `scripts/clean-checkout.ts`.
Hand-run tools in the main checkout still see the copies; the page says so. Standing `claimed`:
those fixture runs are not in `raw/`, so the page marks the observation unverified. The
colocated tests hold the positive and negative control.

## [2026-09-29] ingest | the planning stage: every spec to the user before code

A decision page, and a capture. Anthropic's AI-native SDLC playbook is captured into
`raw/articles/ai-native-sdlc-playbook/` for its claim that design review happens before any
code is generated. A run gains a `planning` stage: each workhorse drafts its own spec and
stops, the postmaster puts each spec to the user one at a time as a link into the workhorse's
worktree, and no workhorse writes code until its own spec is approved. Two approved specs are
needed to go on. This reverses part of #29, where the spec was an audit record nobody
reviewed during the run; the coachman still does not check code against the spec. The
workhorse-spec page no longer says nobody reviews it, and #9's own-spec level becomes the
workhorses' own specs reviewed by the user, with whether review makes the specs converge as a
measure. Standing `claimed`, since no run bears on it yet.

## [2026-09-29] ingest | what 25 syntheses took from each lane

Issue #157. A trial over the records of every run that reached synthesis by 2026-09-29, 16
against this repository and 9 fixture runs, recorded in `raw/trials/2026-09-29-synthesis-audit/`
with its script, its output and one row per run. No run was promoted: the claim rests on the
SYNTHESIS lines, the cards and a count in git, and the harness logs stay with each run. Every
SYNTHESIS line names something taken from each lane, as `coachman.md` requires, so the test H1
gave could not fail. Counted in runs of six words, the second-ranked lane's own share of the
synthesis was 2% or less in 8 runs and 10% or more in 15. H1 now names four measurements that
would settle it: #158, #159, #160 and a single-lane baseline. The cost question gains the
minutes the runs recorded. Standing stays `claimed`.

## [2026-09-27] ingest | how the style sort is checked and put to the user

After the review of #55's pull request, the review-loop page records why the style check reads
the gate as the run's branch has it and never runs it, why a sort may name the file that runs a
linter, and why a linter the project already has is not proposed as new unless the sort says the
gate does not run it. It also records that the postmaster puts the sort to the user once, as a
run's aftercare ends, and that a finding's latest line gives its class. Standing stays
`claimed`.

## [2026-09-27] ingest | style gates nothing, and feeds the project's linter

The user's direction in issue #55: try style not gating a run, for now. The style lens applies
nothing, the ship card counts its findings, and after the merge each is sorted into a rule for
a linter the project's gate runs, a convention for the project's docs, or neither, which the
postmaster puts to the user. The review-loop page records the decision, its reasons, its costs
and what would settle it; the turnpikes page says a turnpike need not gate. The decision earlier
the same day that style blocks a ship was reverted on #40's pull request before it merged. Both
pages stay `claimed`.

## [2026-09-27] ingest | a review round's time limit

The review loop page now says what happens to a reviewer still running when its round reaches
the time limit: it is stopped and recorded DEGRADED, with timeout as its cause. The limit moves
from the runbook into the config as `review.round_timeout_seconds`, and keeps its default of
2400 seconds, the limit a round had when it ran one lens. The `degrade` lines will show whether
round 1, which runs every lens at once, needs more. The standing stays `claimed`.

## [2026-09-27] ingest | each project defines how a change to it is verified

A page in the Decisions area. A project declares its checks in `.postmaster/project.toml`, or
gets defaults found by discovery: the gate always, then a command-line app's ticket examples, a
web app's browser suite and User journey, or a library's tests through its package name. A run
records its checks at dispatch; workhorses run them before they report, and the coachman runs
them on each branch and on the synthesis. The page says what the defaults cover and what they do
not. Standing `claimed`, since no run bears on it yet.

## [2026-09-27] lint | fixture copies go under ~/Code/fixtures

The fixture-runs page now records where `fixture.sh new` puts a copy when given only a name, and
that trusting that folder in Claude Code does not spare a copy the trust prompt: Claude Code
2.1.283 carries a trusted folder's trust to a plain folder inside it, never to a git repository.
No standing changed.

## [2026-09-27] lint | fixture tickets go in the fixture's own store

The fixture-runs page now records that a fixture run's ticket is filed in the fresh repository's
own ticket store, through the tracker #11 added, and no longer in a GitHub repository kept for
fixture tickets, which the user rejected. No standing changed.

## [2026-09-27] ingest | a resumed codex thread runs on the model its resume names

Second harness page, from a recorded trial of codex 0.157.1 against a stand-in provider
(`raw/trials/codex-resume-forms/`). A resume does not restore the model or the effort its thread
was launched on. It runs on what it names, and otherwise on codex's default. It prints text
without `--json`, and exits 2 on a prompt that starts with `-` unless `--` comes first.
`launch.sh resume` passed none of these, so a resumed codex lane or coachman ran on codex's
default. `harnesses.md` and `launch.sh` now carry the form the trial found. The trial also
corrects the adapter: without the bypass flag, a resume runs `workspace-write` in a trusted
worktree and read-only in an untrusted one. Standing `settled`, for codex 0.157.1. Issue #45.

## [2026-09-27] ingest | muse and mimo: what arrives, and resumes of a missing thread

A trial of Muse Code 1.4.0 and MiMo Code 0.1.15 through `launch.sh`, recorded in
`raw/trials/muse-mimo-controls/`, with a positive and a negative control for each check issue
#71 names. Muse Code's `--prompt-file` delivers the prompt verbatim. MiMo Code's stdin delivers
it after one newline of its own, and a message argument arrives quoted. Both exit 0 when resumed
on a thread their data directory does not hold: Muse Code opens a new thread under the id, and
MiMo Code does nothing. `prompt-delivery` gains both harnesses and keeps its standing. A new
page, `resume-exit-status`, records the resume finding at `settled`, and `launch.sh` now refuses
such a resume.

## [2026-09-27] redact | a plan provider id in the MiMo trial record

The trial in `raw/trials/mimo-headless-forms/` named the provider id of one account's plan, which
names a region, and the scrub before it was promoted missed it. The id is now `<plan-provider>` in
the five files that held it, the record says so, and `raw/README.md` now states the exception
that allows it. Nothing else in the record changed, and no standing rests on the id.

## [2026-09-27] ingest | MiMo Code's headless forms

A trial of MiMo Code 0.1.15, launched and resumed through `launch.sh`, recorded in
`raw/trials/mimo-headless-forms/`. Its forms are in `skills/postmaster/harnesses.md`. Two of its
findings bear on how far lanes are kept apart. A fresh session recalled a word another session
in the same data directory had been asked to remember, so each lane now gets its own. And a lane
asked to search went through the whole home directory, Claude Code's transcripts and another
lane's notes included, and found the word: a data directory of its own is not a sandbox. No
standing changes.

## [2026-09-27] ingest | Muse Code's headless forms

A trial of Muse Code 1.4.0, launched and resumed through `launch.sh`, recorded in
`raw/trials/muse-headless-forms/`. Its launch and resume forms, thread id and final message
are recorded in `skills/postmaster/harnesses.md`. It keeps a memory that outlives a session:
a fresh launch recalled a word an earlier one had been asked to remember, where a lane with its
own data directory did not. So each lane and each coachman leg now gets its own. No standing
changes.

## [2026-09-27] ingest | one round of bug review, for now

The user read #59's options for ending the review loop and chose none of them as written: for
now, one round of bug review, to be revisited if many bugs reach production. The research page
records the decision, and the review-loop page notes it. The cap of three rounds in `coachman.md`
stays until a ticket of its own changes it. No standing changes.

## [2026-09-27] ingest | the local tracker

A decision page under Decisions, from issue #11. A tracker with no service keeps a
repository's tickets in its own git directory, outside the working tree and every branch, and
a repository whose store exists uses it whatever the config names. The page records why the
git directory rather than a directory under `~/.postmaster/`, why the kind is discovered
rather than configured, why a store is made or removed only from the main checkout, and what
it costs. Standing `claimed`, since no run bears on it yet.

## [2026-09-27] ingest | turnpikes: what the reviews decided

Two decisions added to the turnpikes page, both the user's. In a run whose ticket names only
style, a bug or security defect the style reviewer finds is escalated to the user rather than
fixed, since no lens would check the fix. A ticket's turnpikes are the user's, like its
direction, so the postmaster never names fewer than `default` on its own. The table of
turnpikes is not changed while any run is in flight. Standing stays `claimed`.

## [2026-09-27] lint | fault tickets: when they are shown, where they go, what they withhold

The page on faults a run finds in postmaster now says that a fault ticket goes only to
postmaster's own repository on GitHub, when the user administers it, and why a draft errs
towards withholding. The drafts are shown to the user once, when a run's aftercare ends. No
standing changed.

## [2026-09-26] ingest | fixture runs test the flow end to end

First page in a new Testing the flow area. A small app with two tickets whose outcome is known,
one tightly specified and one open in design, each with acceptance tests written before any run
and kept out of every run. A fixture run is scored from its records rather than its report, and
a change to the coachman contract now merges only after one scores clean. The page records why
the tests are hidden and how a fixture run gets its ticket: a GitHub repository kept for fixture
tickets, since the waybill-only route skips the postmaster's own check of the ticket and the
tracker with no service does not exist yet. Standing `claimed`, since no fixture run has been
recorded.

## [2026-09-26] ingest | when a review loop should stop

A hypothesis page for #59, standing `claimed`. It compiles the review of #36 round by round and
tests the implementing session's reading of it against the reports. It sets out eight candidate
rules for ending a loop of model reviewers, and what should count toward them, each with the
evidence for and against. It proposes a trial with its cost: fresh reviewers on code a loop has
already passed, against code with known defects. It ends with five options for the loop's end in
`coachman.md` and a recommendation. No runbook changes; the choice is the user's.

## [2026-09-26] ingest | outside work on review, fixes and severity

Fourteen papers captured into `raw/papers/`, each keeping only the passages relied on, with a
source page each. They cover when inspections stop, what one review finds, how often fixes bring
new defects, how people and models disagree on severity, and how often a model reviewer's findings
are rejected. They bear on the new review-loop hypothesis and move no standing. Two sources found
but not quotable exactly are named on that page instead.

## [2026-09-26] ingest | the review rounds of #36

The first run record: the review of pull request #39, which implemented #36, run by hand in five
rounds, not by a dispatch. Promoted with local paths, a session id and the reviewer models' names
replaced. Its record lists every finding of rounds 2 to 4 with where it sat and what became of it.
It bears on H2 of combining models, the review loop and the new hypothesis; no standing changes,
since one hand-run record cannot move one.

## [2026-09-26] ingest | a lane may review through its harness's own skill

A trial of claude 2.1.283's `/security-review`, launched as the flow launches a reviewer lane,
recorded in `raw/trials/claude-security-review/`. In a scratch clone whose `origin/HEAD` leads
back to the base, it reported the planted command injection at its file and line in both runs.
In a worktree where `origin/HEAD` did not resolve, it returned success with an empty report after
no turns. One run ended with three result lines, the report on the last. A new page records why
a security lane may run its harness's own skill, at `claimed`, and what Claude Code's needs.

## [2026-09-26] lint | each lens may have its own reviewer lanes

The review-loop page records why a lens may name its own reviewer lanes: a lane chosen for one
lens, for a skill its harness has for that lens alone, should not have to review every other
lens as well. `[team.lens_reviewers]` names them, `scripts/reviewers.sh` resolves them, and the
waybill carries them to the review stage. The page's standing stays `claimed`.

## [2026-09-26] ingest | a ticket names its turnpikes

A decision page, beside the one on the ticket shape. A ticket now names the turnpikes its run
passes through: `default` for the style, bug and security reviews, fewer, or `none`, with no
floor. A turnpike no longer means the gate: the gate runs on every run. The page records why,
the decisions the ticket left open, and what the ledger will count. Standing `claimed`, since
no run bears on it yet.

## [2026-09-26] ingest | faults a run finds in postmaster become tickets

Third page in the Decisions area. A run never fixes postmaster itself: it logs each fault as it
happens, with its own diagnosis and proposed fix, stops on a fault in a control and works
around anything else, and the postmaster turns the run's faults into tickets on postmaster's
own tracker when the run closes. The page records why, and what a fault ticket may carry.
Standing `claimed`, since no run bears on it yet.

## [2026-09-26] ingest | a run keeps the config it started with

A decision page. A run now launches and resumes every lane and every leg on the config it
recorded in `run.json` at dispatch, never the live one. A config edited mid-run can no longer
change a lane part-way through, or hand one harness's thread id to another. The page records
what that costs: a fix to the config waits for the next run, and an env file's contents are
still read at each launch. Standing `claimed`, since no run bears on it yet.

## [2026-09-26] ingest | a skill is a link to the postmaster repo, never a copy

Third page in the Decisions area, with a trial behind its narrower fact. Each skill is installed
as a link from a harness's user-level skills folder to the main checkout, never as a copy, and a
session finds the repo from that link. The trial asked Claude Code, pi, MiMo Code, codex and
Muse Code, with a temporary HOME, which skills they loaded: each loads a linked skill from each
folder it documents, and none lists or warns about a link that is missing or points nowhere. The page
records why the one step that finds the repo is a line in `SKILL.md` rather than a script, and
why Antigravity is not linked yet. Standing `claimed`: the decision is the user's, issue #15.

## [2026-09-26] ingest | follow-up: claude's trust question, and claude killed mid-turn

Two checks added to `raw/trials/herdr-agent-lifecycle/`. Headless claude answered in a
directory its config had never trusted, with or without its bypass flag, while interactive claude
stopped at the trust question even with it. A claude killed mid-turn was reported done, as pi
had been, and a pane where one died mid-turn held the next start in `working` until its screen
was cleared. The Herdr page widens its kill finding to claude and adds the restart finding; the
live-agents page adds the bypass form and a cleared pane to what the option needs. No standing
changed.

## [2026-09-26] query | headless stays the default; live agents become an option

Asked whether headless runs are the better arrangement. On the trial, yes: a headless lane
exits about as soon after its last reply as Herdr notices a live one finish, the rest of the
marker's delay is a poll that can be shortened, and Herdr's settled states can mislead.
Decided: lanes and coachman legs stay headless, the postmaster stays the one interactive agent,
Herdr hosts every run for observability, and live agents become a config option, off by
default. The live-agents page records the decision, keeps its measurement as what would change
the default, and lists what the option needs. Its standing stays `claimed`.

## [2026-09-26] ingest | Herdr's agent states, and live agents against markers

A trial of Herdr 0.9.1 with pi 0.87.0 and claude 2.1.283 against a stand-in model, recorded in
`raw/trials/herdr-agent-lifecycle/`. Two new pages. The first, under trackers and tooling,
records what Herdr documents against what it does: most harnesses' states are read from the
screen, a separate wait can return the previous turn's state, and a pi agent killed mid-turn
was reported done. It is `settled` for that version. The second states issue #16's claim at
`claimed`, with its four measures, the control, a measurement on issue #37's fixture, the
decision rule, and what would follow for the coachman contract. No existing standing changed.

## [2026-09-26] ingest | Herdr shows a headless launch truthfully only when it owns its pane

First page on a service the flow depends on. A trial against Herdr 0.9.1 and claude 2.1.283,
run twice: left to itself Herdr shows a working headless claude as idle; a closing `idle` report
is ignored once an agent has run in the pane, and `release-agent` is what ends a reported state;
claude's Herdr integration reports into whatever pane `HERDR_PANE_ID` names; and a headless
harness does not title its pane. Settled on that trial, for claude only. It shaped
`scripts/host.sh` and `skills/postmaster/hosts.md`, issue #10.

## [2026-09-26] lint | the review loop's cap is three rounds

The review loop's round cap goes from five rounds to three, by the user's decision, after #39's
own review ran four rounds without a clean one and stopped on the repeated-class rule. It holds
until #59, the research on what should end an AI review loop, reports. `coachman.md` and the
decision page now say three.

## [2026-09-25] ingest | review runs as one loop

A decision page. Style, bug and security review no longer run one after another in three legs.
One leg runs one loop: every lens still open, in each round, on one snapshot, with style in
round 1 only. A run now has three legs: synthesis, review and ship. The page records why, what
the loop is expected to cost, and what the stage timings will measure. Standing `claimed`,
since no run has been recorded under either design.

## [2026-09-25] ingest | a ticket's shape is checked before it is accepted

Second page in the Decisions area. A ticket now carries a direction after its acceptance
criteria, and a script checks its shape before the postmaster accepts it: a title, the problem
or feature, numbered criteria each answerable yes or no, and the direction. What is missing is
proposed to the user, and only their answer is written back. The page also records what the
script can judge of "answerable yes or no", and why hedging words were left out. Standing
`claimed`, since no run bears on it yet.

## [2026-09-23] lint | workhorse replaces arm

The project no longer says arm for a lane that implements the ticket; it says workhorse, and a
workhorse's own plan is the workhorse spec. The decision page is renamed to match, as is the
template it describes. Entries below that say arm or horse stand as written.

## [2026-09-23] ingest | a horse's spec uses Spec Kit's plan and tasks format

Captured GitHub Spec Kit's spec, plan and tasks templates into
`raw/articles/spec-kit-templates/`, with their MIT license, pinned to one commit. A horse's
A horse's own spec now follows the plan and tasks templates in one file; the ticket plays the part of
Spec Kit's spec. The decision page records the mapping and the three adaptations. The source is
outside work: it shapes the format and does not move the page's standing, which stays
`claimed`.

## [2026-09-23] ingest | each horse drafts its own spec

First page in the Decisions area. The ticket carries the what, the why and the high-level
direction; each horse then drafts its own detailed spec, committed before any code. It keeps the
horses independent and the coachman a neutral judge, and at this stage it is an audit record
that nobody reviews during the run. Standing `claimed`, since no run bears on it yet; issue #9
is the test.

## [2026-09-22] lint | lint claims only what it checks

The skill introduced its list of checks with "what it enforces", but the script did six of
the ten, one only in part, and three need a person. Both the skill and the schema also called
lint part of the repo's gate, which does not exist yet. The two missing checks that are
mechanical now run: a capture's `source.md` must give a url and a retrieval date, and a
standing beyond `claimed` must rest on at least one run or trial, with every front-matter
source resolving under `raw/`. The documentation now separates what the script checks from
what a person checks, and the self-test has a failing case, asserted on its own reason, for
every check the script claims.

## [2026-09-22] lint | the homepage is for readers

The homepage carried instructions meant for whoever maintains the wiki: how evidence reaches
`raw/`, an order to read the schema before operating, the line between a concept and a
runbook, and a table counting records. None of it helps someone reading the wiki, and all of
it already lives in `raw/README.md` or the schema. The homepage now says what the wiki covers,
how to read a standing and a citation, and lists the pages. It is also what the postmaster
reads before decomposing a stream, so a shorter page costs less on every run.

## [2026-09-22] lint | sources hold what was chosen, not every run

The sources index still said "one page per finished run" and that the first would arrive from
the first dispatch to reach a ship card, which described the first draft rather than the
design. Nothing reaches `raw/` or `sources/` on its own: a run's record stays in its project's
`.postmaster/` unless somebody promotes it. The index, the schema's page kinds and the wiki
skill now say so, and say that a captured paper or article also gets a sources page while a
recorded trial is cited directly. The skill's description, which decides when an agent loads
it, still described the wiki as answering only the multi-model question from run ledgers;
it now matches the scope and the three kinds of evidence.

## [2026-09-22] lint | raw is committed, and promotion is the gate

`raw/` had been gitignored on the grounds that logs are public-unsafe and instance-specific.
That reasoning outlived its cause: everything automatic now lives in each project's
`.postmaster/`, so reaching `raw/` is already a deliberate act. Making that act the publication
decision — scrub, publishable target, lawful redistribution — lets the evidence be committed,
which is the point of a wiki with sources: a standing can be followed to the record behind it
by anyone who clones the repository. The sha256 provenance mechanism goes with it, since git
supplies integrity. The entry below headed "raw made local and uncommitted" is the one this
reverses, and it stands as written: this log is append-only, and it is accurate as a record of
what was decided at the time.

## [2026-09-22] ingest | prompt delivery differs by harness

First concept outside the founding question, and the first carrying evidence: pi's attachment
form delivers a different message from stdin, it hangs on an inherited pipe, and a resume
against another directory's session exits 0 having done nothing. Settled by controlled trial
against pi 0.87.0; changed harnesses.md and launch.sh in pull request #1.

## [2026-09-22] lint | wiki rescoped to the whole project

It had been written as though its only subject were whether combining models works. That is
the founding question, not the scope: harness behaviour, the services the flow depends on, and
the reasons behind design decisions all belong here. Index reorganised by area, and the line
between a concept and a runbook stated: a runbook says what to do, a concept says what is
known and how sure.

## [2026-09-22] lint | raw is a deliberate subset, not the default home of a run

Every run's full record, harness logs included, belongs in `<project>/.postmaster/`, which is
gitignored in whatever project it is. Nothing reaches `raw/` automatically: a record is copied
in only when somebody decides that run is evidence for a claim. Most runs are operational; a
few are evidence, and the difference is a decision rather than a default.

## [2026-09-22] lint | raw made local and uncommitted

`raw/` sat in the repository root, so run evidence would have been committed to a public repo
whatever the published site rendered. It is now gitignored, its contract aside. Runs are
specific to the instance that made them and carry its paths and ticket text; the tool's
history is not the place for them. Compiled records now carry the sha256 of each file they
drew on, so provenance survives without the evidence being published, and lint checks that no
page quotes raw or names a path.

## [2026-09-22] lint | raw widened to published sources

`raw/` had been restricted to runs, which contradicted the pattern and would have blocked the
literature the spec-detail and harness-diversity questions need. It now takes `papers/` and
`articles/` alongside `runs/`, each capture carrying its url and retrieval date. The rule that
keeps the two apart: a run can move a standing, a paper cannot. Run ingest also now copies each
lane's harness events stream and its exported session, which were previously left on the
machine.

## [2026-09-22] lint | wiki rebuilt on the LLM-wiki pattern

Restructured to immutable `raw/` sources, compiled `wiki/` pages, front matter with
standings, `[@source]` citations and `[[wikilinks]]`. Added the harness-diversity open
question. No raw records and no run records yet, so every standing is `claimed` and nothing
carries a citation.

## [2026-09-22] ingest | wiki created

The three claims the README makes, entered as hypotheses at standing `claimed`, with four
open questions and the run-record template.
