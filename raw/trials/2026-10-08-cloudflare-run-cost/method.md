---
kind: trial
subject: what one run of the flow would cost on Cloudflare Containers and on other on-demand providers, and as pay-per-token model use, from the lane audit's times and token counts, how many launches ran at once, and which of the flow's scripts lean on one machine
date: 2026-10-11
---

# Method

**Question.** [Issue #341](https://github.com/brindlewick/postmaster/issues/341) asks whether the flow could run on
Cloudflare, with Workers as the control plane and Containers for the lanes. Its third criterion asks what a run
would cost there: instance-hours from the lane audit's times, and the model bill if API keys replace subscription
logins, from the audit's token counts. This trial computes those two figures and the controls that could have
made them come out wrong. The comparison it serves is Cloudflare against a flat-priced server, so the container-time
figures lead, with the totals for all the runs and a break-even against a flat monthly price, and the model bill, which
is the same on any host, is a side note. It answers a question about arithmetic on the fleet's own records. It does not show
that the flow runs on Cloudflare, which needs a trial of its own.

Two later questions use the same records. The first is whether another on-demand provider would charge less than Cloudflare
for the same hours, priced from each provider's own page on two kinds of hour (a gate hour and a waiting-agent hour) and, for
virtual machines, for a machine kept up for a run's whole life. The second is what limits how many runs can be in flight,
for which the trial counts how many launches ran at once. A third asks what a whole flow costs, not only a run's
launches: one ticket from the booking clerk to the merge, a month of tickets at the audited pace, and what the cloud would
cost if it took only the peaks.

**Inputs.**

- The lane audit's derived data, `../2026-10-03-lane-audit/results/runs.json`, committed: 18 real runs and 24
  fixture runs that reached synthesis, with each lane's seconds, each reviewer's exit, each gate run's seconds and
  each stage's seconds. Nothing in that file was changed.
- Two things the audit's file does not hold, read once on 2026-10-08 from the runs' own records, read-only, and kept
  only as derived numbers that name no path, thread or session: the uptime of each coachman thread's last process
  (`results/coachman-uptime.json`), from the session exports; and the tokens of every workhorse, reviewer and
  coachman launch split by kind (`results/tokens-by-kind.json`), from each launch's own events stream and the
  coachman's session export.
- The rates. Cloudflare's: the Containers pricing page and instance-types partial of the documentation
  repository at commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f, read on 2026-10-08. The models': each vendor's own
  pricing page, read on 2026-10-08, with the page and tier in `results/prices.json`.
- Other providers' rates, entered by hand in `results/providers.json` (containers and sandboxes billed by the second) and
  `results/machines.json` (machines billed whole), each row naming its page, the day it was read and how well it was
  checked. The readings are the captures `on-demand-containers-and-sandboxes` and `on-demand-virtual-machines`, read on
  2026-10-09. A rate that could be had only from a search answer or a third party is not in the files.
- The pace of tickets, `results/pace.json`, written by `apparatus/pace.ts` from a tab-separated file of merge time and title:
  the project's closed pull requests on GitHub with a merge time, read on 2026-10-11 through its REST API, counted by UTC
  merge day as merged and as ticket-titled (a title that starts with a ticket number and a comma). No title or number is
  kept. The query is in the header of `pace.ts`. The file's last day is a part day and is left out of the window.
- The open interactive sessions, `results/sessions.json`: how many sessions of each kind were open at one moment
  (2026-10-11 04:27Z), and how many were working, from the machine's list of sessions, with no name kept. It cannot be read
  again; it is one moment.
- The flow's scripts, `scripts/` and `scripts/lib/` of this repository at the base of this branch, for the table of
  what they lean on. The seven scripts that test the flow itself (self-tests, oracles, acceptance runs) and every
  `.test.ts` are left out, which leaves 69.

**Definitions.**

- *A launch* is one workhorse lane, one reviewer or one coachman leg. The costing assumes each runs in a container
  of its own, started when it starts and stopped when it exits.
- *Lane seconds*: from the start of implementing to the exit of the lane's process, as the lane audit defines them.
- *Reviewer seconds*: each reviewer's exit less the first launch line of its round, for rounds that have a launch
  line and an exit marker; the audit's `roundTimes`. A round with no launch line is left out, so the sum reads low.
- *Gate seconds* are the coachman's runs of the gate on a branch. They run inside a container that exists anyway, so
  they are shown and not added.
- *The coachman's seconds* are bracketed. The floor is the sum, over a run's coachman threads, of the uptime of the
  thread's last process, from the session export; a thread resumed after a stop ran in several processes and the
  export keeps only the last, so the sum is a floor. The ceiling is the seconds in the stages in which a leg can run
  (planning, workhorses running, synthesis, checkpoint, review), which counts the user's wait for a spec review. The cost
  tables use the median of both over the same 14 runs that have session exports; the ceiling over all 18 runs, which
  includes the four longest, is reported beside them and in what the largest cell would read.
- *All runs together*: the lanes' and reviewers' seconds summed over the 18 runs, and the coachman's seconds summed two
  ways, the floor over the 14 runs that have session exports and the ceiling over all 18. "Low" is lanes and reviewers
  plus the floor; "high" is lanes and reviewers plus the ceiling; "average run" is "high" divided by 18. The records of
  the 18 runs span 2026-09-28 to 2026-10-03, read from the earliest and latest timestamp in them.
- *Break-even against a flat monthly price*: the runs a month at which the $5 plan fee plus the average run's cost for
  each run equals the flat price, for example prices. It assumes the flat machine is big enough for the work, which
  this trial does not size.
- *A gate hour* is 4 vCPU and 12 GiB with every vCPU busy, and a *waiting-agent hour* is 1 vCPU and 4 GiB with a fifth of the
  CPU busy; the first is the project's checks, the second a lane, a reviewer or a coachman waiting on a model. Neither was
  measured. The waiting-agent hours of the 18 runs are every lane, reviewer and coachman launch hour (the coachman at its
  floor or its ceiling) less the gate hours, which are carved out of the coachman and counted once.
- *A rate* is dollars per vCPU-hour and per GiB-hour, with the CPU charged either for the busy part or for every vCPU, plus
  disk per GB-hour where the provider charges it by the hour. A provider whose longest session is shorter than 19 hours, about
  the coachman's median ceiling over a whole run (18.8 hours), is left out, and one whose largest sandbox is below the gate is
  shown as over its size limit. *A machine billed whole* costs its hourly price for the run's whole life, from the first to the
  last timestamp in the run's record, rounded up to a whole hour where the provider bills by the hour, run by run. A typical run
  for the provider tables is built from the median hours of each role, as in the cost tables.
- *The launches at once* are counted from intervals: a lane from the start of implementing to its exit, a reviewer from its
  round's first launch line to its own exit, a gate run for its seconds, and the coachman for each stage in which a leg can
  run, which includes the wait for the user's spec review and so is an upper bound. The load at a moment is how many
  intervals cover it. The most at once inside any one run, and the number of coachman stages longer than 24 hours, are counted
  from the same intervals.
- *A whole flow*: the launches of a run, the interactive roles around them (the postmaster and the booking clerks) and the
  control plane. An *interactive session* is a harness in a container with the waiting-agent profile, with the Durable
  Object in front of it ($0.005625 an hour, 128 MB at $12.50 per million GB-seconds). Awake it costs the waiting-agent hour;
  kept up and idle it holds its memory and disk only (a provider that charges every vCPU charges it idle as well). Two
  policies: *asleep when idle*, where the container stops and costs nothing between turns, and *kept up*, where it stays up
  between turns. A session's month is its awake hours a day at the awake rate, plus for kept-up the other hours at the idle
  rate, over 30 days. Two readings of the awake hours: 2 a day, assumed, and 24 times the share of open sessions that were
  working at the snapshot, 5.3.
- *The audited pace*: the runs over the span from the earliest to the latest timestamp in their records, scaled to 30
  days. The *ticketed pace* is the merged ticket-titled pull requests from 2026-09-26, when titles began to carry ticket
  numbers, to the last whole day read, scaled the same way. It counts hand-made, research and documentation pull requests
  and leaves out runs that were set aside or never merged, so it is a second reading, not a bound.
- *A ticket's own compute*: the average run's launches at the sized-to-use rates, bracketed by the coachman's floor and its
  ceiling, plus the priced parts of the control plane: 10,000 requests at $0.15 a million and 1,000 workflow steps at $0.80
  per 100,000, which are assumed counts, and the Durable Object for the container-hours of the ticket's launches. A month is
  tickets times that, plus the sessions' month and the $5 plan fee. The tickets a month at which a flat price costs the same
  is the flat price less the sessions and the plan fee, over a ticket's own compute: none where the first two already cost
  more, and a range from the high costs to the low ones. The Workers Paid allowances are not taken off.
- *The peaks*: with `k` launches held on the machine at once. The least that could go is the launch-seconds above `k`, the
  sum over each count `c` above `k` of `c - k` times the seconds spent at `c`, from the histogram of the load of lanes,
  reviewers and gate runs. The second reading is admission: launches are taken in the order they start, and one that finds
  the machine full goes to the cloud and stays there. Lane and reviewer hours are priced at the awake rate and gate hours at
  the gate hour, each with its Durable Object. The coachman is not counted.
- *Cost of container time*: seconds times the per-second rate of an instance type, memory and disk for what the type
  provisions and CPU for active use only, from the Containers pricing page. The audit holds no CPU measurement, so
  CPU use is bracketed at none, a quarter and all vCPUs busy. List rates; the monthly allowance is not taken off,
  and `cost.ts` reports how far it goes.
- *Tokens by kind*: uncached input, cache reads, cache writes and output. Codex's and Muse Code's input includes
  cache reads, MiMo Code's and Claude Code's leaves them out, which is why the audit's input counts do not mean the
  same thing across harnesses. Reasoning tokens are counted as output (MiMo Code reports them apart; codex includes
  them).
- *Model bill*: the tokens of each kind times the vendor's rate for that kind. For Claude Code the figure is the
  dollars the harness reported, which are cumulative for the session; its top-level usage is the last iteration's and
  reads low. "If no cache hit" prices every input token at the plain input rate and brackets what the vendors'
  caches do. A second pricing puts the coachman's tokens at Meta's standard tier instead of the contributor tier it ran on,
  since the two differ twelvefold in input price.

**Counts and controls.** Every count has a control, listed with its result in
[results/controls.md](results/controls.md), 45 in all, and `apparatus/controls.test.ts` runs them against the
committed data. They include: the audit's own published gate totals reproduced through the new code (36 lane-branch
gate runs, 6.5 hours; 260 synthesis runs, 43.5 hours); one lane's seconds recomputed from its two timestamps; that
lane's cost recomputed by hand; a run with nothing in it reading zero everywhere; the coachman's floor below its
ceiling in all 14 runs that have both, and the same comparison swapped failing in all 14; the token totals by role
reproducing the audit's published ones (coachman 1478M in and 5253k out, codex reviewers 119 launches and 240M in,
codex workhorses 18 launches and 438M in, Opus 71 launches and $644.17); and Claude Code's reported dollars
recomputed from each launch's own per-model tokens at the published Opus 5.5 prices, inside the bracket from all
cache writes at five minutes to all at one hour for 61 of 61 launches that used one model, against 0 launches when
the same arithmetic uses Opus 4.1's prices; and the coachman's dollars at Meta's standard tier summed launch by launch
and recomputed from the summed tokens, against the same re-pricing of a model no launch used, which moves nothing; and the totals for all the runs, as hours
times the hourly rate and as the cost summed run by run, with the totals over no runs reading zero; the intervals rebuilt
from timestamps against the hours the instance-time tables summed from each launch's own seconds, the area under the load
curve against the sum of the intervals, and the load of no launches reading zero; Cloudflare's row of the provider table
against the cost module's standard-4 hour and against the waiting-agent hour by hand; the waiting-agent and gate hours
against every launch hour; Fly.io's performance-4x price from the per-vCPU and per-GiB rates against the hourly price Fly's pricing
page prints and the per-second figure from its documentation's constants, and an unchecked figure for it failing that comparison
by a factor of 2.72; Daytona's size limit rejecting the gate and accepting the agent; every row naming its page, its date and its
check; the break-even against a rented month for Vultr by hand, and none for a machine with no monthly price; the longest
coachman stage and the count of stages over 24 hours from the intervals against the audit's own stage seconds, with a stage of
exactly 24 hours not counted; the most launches at once inside one run against the most across all runs together; the
whole-flow break-even put back into the month (the month at the break-even costs the flat price, a ticket fewer less and a
ticket more more) and, with no sessions, against the earlier break-even for the same average run; the launch-seconds above
zero at once from the histogram against the sum of the launches' lengths, and zero above the most that ran at once; a month
of no tickets costing the sessions and the plan alone, with no break-even under them; a month of launches at the audited pace
as tickets times the average run against the total of the audited runs scaled from their span to 30 days; the launches that
admission sends to the cloud never fewer than the least that could go, and all of them with no room, and none with room for
the most that ran at once; and the file of merged pull requests by day with no day more ticket-titled than merged, its days
adding up to its total, and a made-up day failing the same check. The unit tests beside each module hold the other positive and
negative cases, 170 tests in all. For the scan of scripts they
include a package-manager lock file and a process's own `.pid` property, which must not count as marker files, and
another tool's `worktree` command, which must not count as a `git worktree` call; a hand count of calls to `git` with a
worktree verb in the 69 scripts finds the same six scripts as the scan. They show the code applies a rule the same way on a case that must read non-zero and one that
must read zero. They cannot show that the rule is the right one.

**To repeat.** From a checkout of this repository, with the run folders for the two steps that read them:

```
bun apparatus/uptime.ts --runs <ids> --dir <runs folder> [--dir <another>] --out results/coachman-uptime.json
bun apparatus/measure.ts --audit ../2026-10-03-lane-audit/results/runs.json --runs <ids> --dir <runs folder> --out results/tokens-by-kind.json
bun apparatus/primitives.ts --repo <checkout> --out results/script-primitives.md
bun apparatus/pace.ts --in merged.tsv --read <day> --out results/pace.json   # the pace of merged pull requests
bun apparatus/run.ts          # instance-time.json, instance-time.md, cost.md, concurrency.md, providers.md, whole-flow.md
bun apparatus/model-bill.ts    # model-bill.md
bun apparatus/controls.ts      # controls.md
bun apparatus/quotes.ts --notes ../../articles/<capture>/passages.md --root <cloudflare-docs>/src/content   # quote-check.md
bun apparatus/quotes.ts --page <page.md> --capture ../../articles/<capture>/passages.md ...
bun test apparatus/
```

A reader without the run folders runs `run.ts`, `model-bill.ts`, `controls.ts` and the tests alone and gets every table from the committed
data. The quote check needs a checkout of `cloudflare-docs` at commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f. `uptime.ts` and
`measure.ts` refuse to write anything that looks like a path. `passages.ts` turned the readers' notes into the passages files of
the thirteen captures.

**Limits.**

- Every figure is the fleet's own, for 18 real runs of one repository whose records span 2026-09-28 to 2026-10-03, on the flow as it stood
  then. A different ticket mix gives different seconds.
- The costing puts every launch in a container of its own and starts none early or late. A design that shares a
  container between roles, or keeps one warm, costs differently.
- Instance sizes were not measured. The machine's own caps were 8 GiB for a launch and 16 GiB for the coachman after
  a kill at 8; the largest Cloudflare instance has 12 GiB. Whether a lane or the coachman fits is not shown here.
- The gate's seconds are the machine's, under its load. On a container with its own CPU they may be less or more.
- CPU use is bracketed, not measured.
- The coachman's floor leaves out earlier processes of a resumed thread; its ceiling counts waits for the user. The
  true figure is between. Four of the 18 runs have no session exports and are missing from the floor, and from the
  coachman's tokens, as they are from the audit's own coachman figure.
- Reviewer seconds read low where a round has no launch line, and high where a lane was restarted after a kill:
  the longest single reviewer is 344 minutes. The container table holds 289 reviewer launches and the model bill 308; the
  other 19 have no recorded time.
- The model bill prices the lanes at pay-per-token list prices. The MiMo lane ran on a Token Plan billed in credits,
  and Meta's contributor tier lets the vendor train on what is sent. Under a subscription the contributor model gives
  no discount (Meta's Terms 13.4, read the same day).
- Fixture runs are cheap and short and say little about a real ticket's tokens. Their tokens were not measured here;
  the trial's cost for a fixture lane uses the audit's medians.
- A price is the vendor's page on the day it was read. Pages carry no date of their own, and prices change.
- The launches-at-once counts are the 18 audited runs alone. Fixture runs, other projects and the user's own sessions shared the
  machine and are not in them, and the coachman's intervals count the user's waits as running.
- The provider rates are list prices from pages read once or twice on 2026-10-08 and 2026-10-09 through a fetch tool that
  returns a summary of a page, so two agreeing reads count as one check. The rate files say which rows have one read. Where a
  provider's pricing page could not be read, the row says where its rate came from. The two profiles are assumptions, the
  machine rows are one shape for a whole run and hold neither the gate nor a 16 GiB coachman, and nothing was ordered or run.
- The sessions' awake hours were not measured. The session list is one moment, not a series; two awake hours a day is an
  assumption and the share working at the snapshot gives 5.3, with 1, 4, 6 and 8 shown. The research and design sessions are
  the user's own work around the flow, not roles of it, and are priced apart. The number of sessions is not scaled with
  tickets. The control plane's request counts and the stores' prices were not measured. For the fixture runs the coachman is
  at its ceiling, and 13 real runs that were set aside or never reached synthesis are in no figure. A merged pull request is
  not a run, so the pace has two readings. The comparison against a flat price takes the flat price as given and does not
  size the machine.
- The scan of scripts counts files whose code matches a pattern, with comments removed and a target project's lock file
  names blanked. It lists the files behind each count. A file that reaches a machine primitive through a library the
  patterns do not name is missed, and a match is a file that uses the primitive, not a measure of how much.
