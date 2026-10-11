---
title: Log
type: schema
updated: 2026-10-10
---

# Log

Append-only. Newest first. One entry per operation, prefixed so it can be parsed.

## [2026-10-10] ingest | story pages: a change and a ticket told as stories that scroll

Issue #321. Built three story pages, two of pull request 336 and one of #352, and recorded them in
`raw/trials/2026-10-09-story-pages/`: each page, its story file, its drawings, the builder it was made with, and the
Codex prompt that drew the ticket's picture. The user judged each form in turn and chose the drawn one, with a
picture and a plain welcome to start and the ticket's words a step at a time. Added
[A ticket or a change reads better as a story that scrolls](concepts/story-pages.md), standing claimed: one user, one
change and one ticket, nothing measured. #352 builds the page for tickets, and #434 has the booking clerk make one
for every ticket it prepares.

## [2026-10-09] ingest | what two counts of mutation flag in the project's scripts, and whether they reach the review findings

Issue #372, the second half of trial 4 on [the functional-core page](concepts/functional-core-and-verification.md).
Counted mutation twice in the 79 non-test scripts on `main` (at `67d4ae2`) and in the code of the 19 review rounds of
#202, #216, #252 and #268, and recorded the run in `raw/trials/2026-10-09-mutation-counts/`: the rule (an Oxlint plugin),
its 105 controls, both counts at every commit, the findings joined to the functions that hold their lines, and a draw of
30 flagged places read by one reader and 10 of them by a second. The first count flags 360 places on `main`, an estimated
312 of them not hazards, so its first failure test is met; 8 of the 78 findings that cite a TypeScript line sit in a
function it flags, so its second failure test is not met, and 8 is about what random placement would give. The result is
in the trial 4 section, with one sentence in the second part of proposal 1. Nothing was installed in the project, and
nothing in the gate, the rules or the runbooks changed. No standing changed.

## [2026-10-09] query | would banning mutation make code easier to follow, for a reader and for a model

Issue #300. The user asked whether code without mutation is easier for a model to follow and proposed starting with a ban
and some exceptions. Answered from the reading already captured: the benefit is argued and not measured (no study found
compares mutable and immutable versions of the same code, and the 84 findings were not classified by mutation), and local
mutation does not change whether a function can be tested without the outside. What can be measured is how much a rule
would flag. Filed back into [the functional-core page](concepts/functional-core-and-verification.md): proposal 1 has a
possible second part against mutating what escapes a function, and trial 4 counts escaping mutation and every mutation,
with controls, on `main` and at the review snapshots. The research session alone read this addition. Nothing was run or
installed. No standing changed.

## [2026-10-09] query | does passing git in, or Effect, make the cleanup checks more effective

Issue #300. Two questions on [the functional-core page](concepts/functional-core-and-verification.md): would wrapping
side effects in Effect help, and are tests more effective when the live run and the test run differ only in a mock git
swapped for real git. Answered from the reading already captured and from #252's code at its round-1 snapshot, and
filed back into the page. Trial 5 is now one program with its git swapped, a mock checked against real git on a scratch
repository, and a plain version compared with an Effect version, in three steps, each later step run only if the one
before did not fail. Proposal 2, the Effect sentences and the answer say the same. The old trial 5 listed, in its
generator, two states that only the findings had named (a submodule and an unbranched merge); a model that has not seen
the findings now writes the list. A third independent check of the rewrite found 16 problems (3 overstated, 1
unsupported, 5 missing a limit, 3 stale, 4 minor), all corrected. Nothing was run or installed. No standing changed.

## [2026-10-05] ingest | whether the lanes saw each other's work

Issue #277. Read the events streams of 60 workhorse lanes in 30 real runs, and recorded the scan in
`raw/trials/2026-10-05-lane-isolation-scan/`: the script with its self-test, its output, the controls and the
readings. No stream named the other lane's worktree or showed its code. One lane read the other's plan, two
reached the run's blind tests, and only one of those two runs recorded it. The sandbox that the `confine`
setting turns on isolates processes and not files. Added "Whether its lanes were kept apart" to
[Mixing models for coding](concepts/mixing-models-for-coding.md) and a line to
[Lane confinement](concepts/lane-confinement.md). No standing changed: the scan reads the runs' own records
and promotes no run.

## [2026-10-05] query | how the dashboard looks

The user chose the look in #238's design session: "let's go with engraved navy and coral from
astra", because "it felt the easiest to read". Recorded in [the dashboard](concepts/dashboard.md) under "How it looks": the choice, how it
was reached in the user's words, what the chosen prototype carries, and where it does not follow its
data. On the user's word, the chosen prototype is kept in `docs/design/dashboard` with full-page
pictures and a spec, so the look can be reproduced exactly. No standing changed.

## [2026-10-05] ingest | pstack read again at e43c7ee, and its nine ranked changes judged again

Issue #309. The link the user gave (`c47b128`) is four commits before the first report's `23e4138`. The head
at `e43c7ee` adds `/correct` and changes `/architect` and the perf-issue playbook, and moves no verdict.
Captured its passages and the comparison in `raw/articles/pstack-plugin-e43c7ee/`. Recorded six trials: which
test cases pass when their script is replaced by a stub (`2026-10-05-total-mutant`), who writes on the tickets and what
the comment log shows (`2026-10-05-ticket-text-authors`), the decisions of eight tickets marked by what could settle
them (`2026-10-05-decisions-sample`), the versions the runs were dispatched with
(`2026-10-05-harness-versions-in-runs`), what a fixture run takes (`2026-10-05-fixture-run-times`), and which
scripts remove or rewrite something and which have a dry run (`2026-10-05-state-changing-scripts`). Added "Read again on
2026-10-05" to [pstack](sources/pstack.md), which judges the nine changes again with the user's word on each and weighs
two more, one from `/correct` and one the first report had left out. Fixed a link in the page: the ticket template moved with
#251. No standing changed.

## [2026-10-05] ingest | functional programming, formal verification and AI coding

Issue #300. Recorded `raw/trials/2026-10-04-review-findings-classified/`: the 84 serious review findings of runs
#202, #216, #252 and #268, read against a rubric written first, with six anchors labelled before the rest, a
second reader on 26 of them and the controls for the count. A stated property or a small model would have caught
79; a pure core made the check possible for 24, none without a property; 5 were prose or inference. Added
[What a functional core opens up for checking code, and what it does for coding with AI](concepts/functional-core-and-verification.md),
**claimed**, with a map of 125 sources in five groups, captured under `raw/papers/` and
`raw/articles/`, four claims weighed in both directions, four proposed changes to the design rules and the
ticket template, and five small trials, none run. Two independent checks of the built page against its captures
and sources, one of the record and one of the literature, found 28 and 43 problems (wrong, overstated,
unsupported, missing a limit, minor); all were corrected before publication. No standing changed.

## [2026-10-04] ingest | what exists for coding with several models, whether mixing models is proven, and what postmaster adds

Issue #277. Captured 107 papers and 139 pages into `raw/papers/` and `raw/articles/`, each with its
address, the day it was read and the passages relied on, and recorded the search in
`raw/trials/2026-10-04-landscape-search/`: every query, the rule for choosing in each group, the controls,
what was not read, and the marks of the count that ranks the closest tools. Added
[Mixing models for coding](concepts/mixing-models-for-coding.md), **claimed**, with a map in six groups, the
evidence on four claims about mixing models in code and in general work, the closest tools beside
postmaster, what postmaster shares and adds, the README checked line by line against
[the lane audit](concepts/several-lanes.md), and what can and cannot be said in public. The README's
claim that the synthesis took contributions from both lanes every time is not supported by the audit.
Linked it from [Combining models](concepts/combining-models.md). No standing changed: outside work moves
none, and the page rests on the audits, which promote no run.

## [2026-10-04] query | should setup create a project's verifiers with pstack's skill

The user's word: yes, as part of setup on a new project, using pstack's `/create-verification-skill`.
Filed as #273, on the board in Todo, for a ticket session to settle where setup runs it, what it
produces and where that lives, and what counts as done. Candidate 7 in
[pstack](sources/pstack.md) now belongs in #273, with the QA turnpike (#97) taking the record as
input. The trial of whether lanes do better with the record stays the way to measure it, on a
project with a user interface. No standing changed.

## [2026-10-04] ingest | how often a lane's evidence is `not shown`, and whether the check bounds it

Recorded `raw/trials/not-shown-evidence/`. A read-only count of the Evidence entries in lane
summaries, in this repository's runs and in the fixture repositories: 249 entries in this
repository's 21 summaries with the section, 35 of them `not shown` and 29 of those in one summary,
and 152 of 152 shown in the fixture repositories. Four made-up summaries for one ticket run through
`summary-evidence`: it passes eight `not shown` entries and refuses a missing entry and a missing
file. Cited from [pstack](sources/pstack.md), where it is the baseline for candidate 7. No
standing changed.

## [2026-10-04] ingest | a first look at pstack's verification skill

Recorded `raw/trials/pstack-verification-skill/`. The skill followed by hand, once, on a scratch
copy of the `todo` fixture app. The 37-claim walk of the feature map it made held all 37, and after
the reference solution of the fixture ticket `remove` it held 22. The first walk's output, the
files as first generated and the failing gate run were not kept, and the record says so. Cited from
[pstack](sources/pstack.md). No standing changed.

## [2026-10-04] lint | the pstack page follows main

[pstack](sources/pstack.md) was written against `40d50ce`. Main has since ended the `.sh` wrappers
(#218), so script names are now in the `scripts/run <name>` form and link to the `.ts` files. Read
as a diff with the script names made alike, the rules and sections the page cites did not change.
Candidate 2's search was repeated on main with the same result. The autonomous-run row and
candidate 5 now cite #264 and #265.

## [2026-10-03] ingest | audit of three days of runs, for what several lanes earn

Issue #257. A trial recorded in `raw/trials/2026-10-03-lane-audit/` over 31 of this repository's
runs and 25 fixture runs with activity from 2026-09-30 15:40 to 2026-10-03 15:40 UTC. It reads
the runs' own action logs, cards, usage files and event streams, and scores each fixture lane's
branch on the hidden tests, which the earlier audit could not. Across 18 real runs that reached
synthesis, a codex lane or mimo alone would have found 52% or 58% of 264 verified severe findings
and the two together 91%. The second workhorse's part was a fix or a missing part in 12 of 18 by the
coachman's cards, and each lane alone passed every hidden test in all 22 scorable fixture runs.
Added [A second reviewer earns its keep; a second workhorse is cheap and not shown to](concepts/several-lanes.md),
**claimed**, and linked it from [Combining models](concepts/combining-models.md), whose standings do
not move: the trial promotes no run.

## [2026-10-03] ingest | pstack, a plugin and guide of skills for verified agent work

Captured the plugin at commit 23e4138 and Part 1 of its guide into `raw/articles/`, as passages
only, and wrote [pstack](sources/pstack.md). It sets each of the plugin's 52 skills, 23 playbooks
and 24 principles beside what postmaster holds, gives each a verdict, and ranks nine candidate
changes. None is filed. Linked from
[each project defines how a change to it is verified](concepts/verification.md) and from
[a fixture run tests the flow end to end](concepts/fixture-runs.md), under what would change or
settle them. No standing changed, since outside work does not move one.

## [2026-10-03] query | should #216 build the check as a library module

The user's word: no; whether it becomes a library is a later concern, so #216 builds the check
for postmaster alone and the module work waits for a change of its own. Updated the
recommendation in
[No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md),
still **claimed**.

## [2026-10-03] query | can patterns carry the private-data check without a model

The user asked whether the check's patterns could cover what Jev catches. Answered from
`raw/trials/pii-patterns/`: they match it on personal data with a shape or a label, raise less
on real code, and leave names in prose. The user's word: #216 takes the narrowed scope with
patterns alone, no model. #216's and #135's tickets were rewritten to match. Updated
[No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md),
still **claimed**: the library's scope is patterns, and a judge for names in prose is a later,
optional argument.

## [2026-10-03] ingest | patterns for personal data, beside Jev

Issue #208. A trial recorded in `raw/trials/pii-patterns/`: patterns in TypeScript for names in
the places a name is written, email addresses, phone numbers, card, bank and ID numbers, dates of
birth, street addresses and a few phrases, against Jev 1.13 on the same lines. On the Jev
trial's corpus, a fit, they found 32 of 34. On two sets another model wrote, they found 23 of 33
before fixes and 25 of 34 after, where Jev found 32 of 33 and 32 of 34, with about as many false
alarms; the gap is names in prose. On this repository's 92,252 history lines they flagged 9 made-up
test addresses in five seconds. Updated
[No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md),
still **claimed**: patterns carry the check, and names in prose are what a model adds.

## [2026-10-03] ingest | a model beside the private-data scanner

Issue #208. Two trials. `raw/trials/ai-privacy-check/`: 188 made-up lines, #135's fixtures,
probes and open-ended lines, given to Claude Haiku 4.5, Claude Opus 5.5, GPT-6 Sol, MiMo V2.6
Pro, OpenAI's Privacy Filter run locally, and Jev 1.13; every general model found every
open-ended positive, none replaced the patterns, and Opus raised the fewest false alarms.
`raw/trials/jev-pii/`: after the user narrowed #135 to personal data and secrets on 2026-10-02,
Jev asked atomic questions with every exclusion in code, in five versions. The last finds 33 of
34 made-up personal-data lines at 0.8 and raises 2 of 37 hard negatives; over all 92,252 lines
of this repository's history it flagged 15, none of them personal data. Its answers move by up
to 0.2 between identical calls, a 1.1 MB line is past its context, and 21 requests failed after
six attempts. Updated
[No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md),
still **claimed**: the claim, the library's scope and the recommendation follow the narrowed
#135, and the judge is an argument of the library, not built in.

## [2026-10-01] ingest | whether to publish the private-data scanner as a library

Issue #208. Thirty-two outside tools captured in `raw/articles/scanner-*`, each with the passages
the survey rests on, read at a dated version; passages from GitHub were checked against the file
at the pinned commit or tag. Seven more captures on who publishes agent transcripts and what they
carry. A trial recorded in `raw/trials/scanner-rule-format/`: #135's rule table at `1223cc0`,
written in a proposed rule format, agreed with the scanner on every one of 50,093 lines, under Bun
and Node; its controls and mutations behaved, and round 5's table at `c47d246` already differs in
three rules. Probes found three gaps in #135: Claude Code's pull-request attribution, JSON nested
two deep, and encrypted reasoning blocks. New page
[No library covers what the private-data scanner checks, so postmaster publishes one](concepts/scanner-library.md),
at **claimed**. The user's word of 2026-10-02: a gap is reason enough to publish, with no wait for
an outside request; the order is #135, then #109's port, then the package.

## [2026-10-01] ingest | what keeps a lane inside its worktree

Issue #107. A trial recorded in `raw/trials/confine-lanes/`: ten model runs on codex, Claude Code,
Muse Code and MiMo Code, pi and MiMo Code's shell on a stand-in provider, and plain-shell probes,
at four levels: as launched today, with each harness's own guard, inside sandbox-runtime, and
inside a Landlock ruleset. Unconfined, every harness wrote into the main checkout and read the
other lane's worktree and a file elsewhere in the home directory. Claude Code's and MiMo Code's
own rules refused reads and let a shell write through; codex's and Muse Code's sandboxes switch off
in bypass mode. sandbox-runtime stopped every reach and every lane still passed the gate, after
three changes the page lists; it needed root to allow Bubblewrap on this Ubuntu machine. A
worktree's shared store still lets a lane read another lane's commits; a shared clone per lane
does not. New concept page `lane-confinement`, standing `claimed`.

## [2026-10-01] lint | a fixture run's postmaster runs headless

Fixture copies are marked in their own git config, and a fixture run's
postmaster runs headless on every host, so a run starts without a trust
prompt. Trusting the fixtures folder never spared a copy: the trust search
stops at the top of the repository.

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

## [2026-09-29] ingest | a read-only dashboard, reached through Tailscale's proxy

The design agreed with the user in issue #126. The dashboard shows every run by who acts next,
each run's cards, timings, review rounds, gate results and live output, and the machine's load.
Its layout follows the window's width, for a phone, an iPad or a desktop. It only shows,
because an action it could take is one an agent running as the user could take too. It takes
every figure from the scripts that already compute it, and listens on a Unix socket that
`tailscale serve` publishes on the tailnet over plain HTTP, so no certificate publishes the
machine's name. It answers only the owner's login at the machine's own name. New page at
standing `claimed`; whether the identity header reaches a plain-HTTP service is left for the
first ticket's live control. Tickets #146 to #150 build it, the first a dashboard the user can use
on its own.

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
