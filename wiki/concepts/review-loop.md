---
title: The review loop
type: concept
standing: claimed
sources: [runs/2026-09-26-postmaster-36]
updated: 2026-09-27
---

# The review loop

**Claim.** Style, bug and security review work better as one loop in one leg than as three
passes in three legs. Each round runs every lens still open on one snapshot: all three in round
1, then the gating lenses while a round logs a verified P1 or P2 finding. It should take fewer
rounds, it needs one leg start-up instead of three, and every fix is re-reviewed by the gating
lenses a ticket names unless the loop stops at its round cap.

**What ends the loop.** Round 2 runs whenever round 1 applied a fix. After that, round `r+1`
runs only when round `r` logged a verified P1 or P2 finding; a P3 finding does not keep the loop
going and is carried to the user unfixed. The cap of three rounds stays as a backstop: when
round 3 logs a verified P1 or P2 finding, the loop stops and escalates with the residue.
`scripts/review-decide.sh` decides this from the round's `finding` and `apply` lines.

**Standing: claimed.** This is a decision taken on reasoning. No run has been recorded under
either design, so neither the time saved nor the coverage gained is measured yet. The change is
[issue #36](https://github.com/brindlewick/postmaster/issues/36).

## The reasoning

- **Each round's fixes are re-reviewed by the gating lenses.** When the passes ran in sequence,
  style, then bug, then security, a fix made in the security pass was re-checked only by
  security reviewers. No bug reviewer ever saw it. In the loop, every round after the first runs
  the bug and security lenses on the code as fixed so far, so both see each fix in the next
  round, whichever lens found the defect it fixes.
- **Later rounds still review the fixed code.** The sequence existed so that later passes
  reviewed final code. The loop keeps that: every round reviews the code as fixed so far.
- **Fewer rounds, and one leg start-up instead of three.** On paper, a typical run goes from
  about five review rounds (style 1, bug 2, security 2) to two or three (unverified).
- **Style gates nothing, and runs once.** It runs in round 1 only, as it ran once before, and
  applies nothing. Its findings go to the ship card, and after the merge to the project's
  linter or docs, if the user wants them there. The next section says why.

## What it costs

- **Concurrency.** Round 1 runs every reviewer lane under every lens at once, and each may run
  the full test suite. With two reviewer lanes that is six processes where there were two. The
  levers are the run ceiling and the test runner's worker cap. A cap on reviewers per round is
  added only if runs show one is needed. Each lane also runs three reviews at once on one
  account, so it can reach a usage limit sooner. A lane that does is DEGRADED for the round, as
  any walled lane is. So is a reviewer still running at the round's time limit, which is
  stopped. The limit is a config value, `review.round_timeout_seconds`. Its default, 2400
  seconds, is the limit a round had when it ran one lens. The `degrade` lines whose cause is
  `timeout` will show whether round 1 needs more.
- **Context.** One leg now carries all three lenses' findings. The three-round cap bounds it. If
  a leg's context still runs out, the leg would be split at a round boundary, never by lens,
  since a split by lens would bring back the gap the loop closes.
- **Colliding fixes.** Fixes from different lenses can touch the same code. One coachman sees
  them together and reconciles them before applying.
- **The cap ends all review.** One three-round cap covers the whole loop, so a loop stopped at
  the cap ships its last round's fixes unreviewed. In sequence, a capped bug pass was still
  followed by the whole security pass.
- **Same-lane duplicates.** Round 1 puts one snapshot in front of every lens, so one lane can
  report the same defect under two lenses. That is one model agreeing with itself, not
  corroboration. H2 in [combining models](combining-models.md) counts corroboration by lane, and
  the record keeps every lens and every lane that reported a finding so that it can.

## Style findings feed the linter

The user decided on 2026-09-26, in
[issue #55](https://github.com/brindlewick/postmaster/issues/55), to try style not gating a
run, for now. The style lens applies nothing. After the merge, the coachman sorts each style
finding into a rule for a linter the project's gate runs, a convention for the project's own
docs, or neither, with a reason, and the postmaster puts the sort to the user, who decides
which become tickets.

- **A style change cost rounds, and nothing gated on it.** The style changes applied in round 1
  were re-reviewed by bug and security in round 2, so a run with any style change could never
  close in round 1.
- **The same judgments come back.** In the user's words the same style judgments come back run
  after run, because nothing turns a judgment into a check; this is unverified, since no run is
  recorded yet. A rule in the project's own linter is checked by the gate on every change,
  whoever wrote it, with no reviewer. A convention in the project's docs is read by every lane
  before it writes code.
- **Only a linter the gate already runs.** The flow neither configures nor edits a project's
  linter, so a new rule is a change to the project, made through a ticket. A rule for a linter
  the gate already runs is a small change the gate enforces at once. A linter the project does
  not run is a larger change, so it is proposed on its own, for the user to accept or not.
- **The check reads the gate, and never runs it.** `scripts/style-findings.sh` reads the gate
  as the run's own branch has it, so another run's merge cannot change a finished run's sort,
  and running a project's gate to learn what it runs would run everything it runs. It follows
  the scripts, recipes, files and tool configs the gate reaches, but no reader can follow every
  way a gate can run a linter. A sort may therefore name the file that runs a linter the reader
  missed (`via`). A linter the project already has is not proposed as new unless the sort says
  the gate does not run it, since a missed linter would otherwise come back to the user as one
  to adopt.
- **The conversation belongs to the postmaster.** The coachman is headless and never talks to
  the user, so the sort is written to the run's directory, and the postmaster puts it to the
  user once, as the run's aftercare ends, the way it puts a run's tool faults. Nothing is filed
  without the user's word, and a proposal the ledger shows filed, declined or already asked is
  not put again, so the same judgment does not return after every run.

Earlier the same day, on the pull request for issue #40, the user had decided the opposite:
that style blocks a ship as bug and security do, running every round. That change was reverted
before it merged, once issue #55 gave this direction.

What it costs:

- **A style finding is never fixed in the run that found it.** The ship card lists every one.
  A user who wants one fixed before the merge can withhold the word and say so.
- **Every run with style findings ends with a question for the user.** Nothing waits for the
  answer: the run is closed, and the next ticket is dispatched.
- **A finding counts as style or gating by the coachman's reading.** A defect misread as style
  would ship. When the loop runs another round, its reviewers see every deferred finding with
  its disposition and can argue it back to gating, and the finding's latest line then counts.
  Either way a finding's class is on its `finding` line, so a misreading can be counted
  afterwards.

## What would settle it

The stage timings from `scripts/run-times.sh` measure the review stage once runs exist. From
them and from each run's action log:

- the review stage's duration and its number of rounds, per run, against the estimate above;
- how often a bug reviewer finds a defect in code that a fix for a security finding changed.
  The sequence could not find these, since no bug reviewer saw a security fix, so each one is
  coverage the loop added. The log carries what this needs: each `finding` line names its file
  and line, and each `apply` line the findings it fixes;
- whether round 1 makes the machine queue or swap, and whether a review leg runs out of context;
- for style not gating, from the `finding` lines, the sort files and the `ticket-create` lines
  that name a proposal: how many style findings each run has, how many become rules or
  conventions the user accepts, and whether a kind of finding keeps coming back after its rule
  has landed. It should not. A kind that keeps coming back, or a style problem the user finds
  after a merge and would have blocked, argues for style gating again.

The claim is weakened if the loop takes as many rounds as the sequence did, or if its costs
force a cap on reviewers or a split leg on ordinary tickets.

The first record, [the review rounds of #36](../sources/2026-09-26-postmaster-36.md), was run by
hand rather than by a dispatch, and its round 1 was `/code-review`, not the lens loop, so it
measures neither design. It ran four rounds after its criteria check, above the estimate
[@runs/2026-09-26-postmaster-36/README.md]. In its round 3, three defects in fixes were found only
by the lens other than the one whose finding each fix addressed: 3.06, 3.08 and 3.10
[@runs/2026-09-26-postmaster-36/reports]. What should end the loop is a question of its own:
[when a review loop should stop](review-convergence.md).

## What changed because of it

A run has three legs, `synthesis`, `review` and `ship`, where it had five.
`skills/postmaster/coachman.md` runs review as one stage, `review`, with one checkpoint card,
and `scripts/stage.sh` refuses the three review stages it replaces. `[team.coachman_legs]` in
the config takes `synthesis`, `review` and `ship`, and `scripts/launch.sh` refuses a config
that names `style`, `bug` or `security`.

The cap was five rounds when the loop was introduced. On 2026-09-26 the user set it at three,
after #39's own review ran four rounds without a clean one and stopped on the repeated-class
rule. It stays at three as a backstop.
Each lens may have its own reviewer lanes (#63). With one list, a lane chosen for one lens, a
Claude lane for Claude Code's `/security-review` say, would review style and bugs as well, and
the choice of a lane for what its harness does well would cost a lane in every lens. A lens
that names no lanes of its own is reviewed by the reviewer list, as before. The waybill carries
each lens's lanes, so a run keeps the reviewers it was dispatched with. A lane that reviews
through its harness's own skill has [a page of its own](own-review-skills.md).

The lenses are now the turnpikes a ticket names, all three by default, and a run whose ticket
names none has no review leg:
[a ticket names the turnpikes its run passes through](turnpikes.md).

On 2026-09-27, with #59 reported, the user chose the rule the loop runs under #80: "in the first
round we fix as much as we can, then we repeat until there are no more P1 and P2s." Round 1
applies every verified gating finding, P1, P2 and P3 alike; from round 2 on only P1 and P2 are
fixed, and a P3 goes to the user unfixed. The cap of three rounds stays as a backstop
([when a review loop should stop](review-convergence.md)). Many bugs reaching production stays
the signal to revisit the rule.

Since issue #55, style gates nothing. `skills/postmaster/coachman.md` applies no style finding,
the ship card counts them, and aftercare sorts them; `skills/postmaster/postmaster.md` puts the
sort to the user after the merge. `scripts/style-findings.sh` lists a run's style findings,
shows what the gate runs and checks the sort, and `scripts/log-action.sh` refuses a `finding`
line that does not open with its class, `gating` or `style`.
