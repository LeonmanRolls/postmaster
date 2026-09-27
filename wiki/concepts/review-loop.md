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
1, then bug and security until clean. It should take fewer rounds, it needs one leg start-up
instead of three, and every fix is re-reviewed by the gating lenses a ticket names unless the
loop stops at its round cap.

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
  reviewed final code. The loop keeps that: every round reviews the code as fixed so far,
  including the style changes applied in round 1.
- **Fewer rounds, and one leg start-up instead of three.** On paper, a typical run goes from
  about five review rounds (style 1, bug 2, security 2) to two or three (unverified).
- **Style stays advisory and single-shot.** It runs in round 1 only, as it ran once before. The
  style changes that are clearly right are applied with that round's fixes, and the rest go to
  the ship card for the user to pick from.

## What it costs

- **Concurrency.** Round 1 runs every reviewer lane under every lens at once, and each may run
  the full test suite. With two reviewer lanes that is six processes where there were two. The
  levers are the run ceiling and the test runner's worker cap. A cap on reviewers per round is
  added only if runs show one is needed. Each lane also runs three reviews at once on one
  account, so it can reach a usage limit sooner. A lane that does is DEGRADED for the round, as
  any walled lane is.
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

## What would settle it

The stage timings from `scripts/run-times.sh` measure the review stage once runs exist. From
them and from each run's action log:

- the review stage's duration and its number of rounds, per run, against the estimate above;
- how often a bug reviewer finds a defect in code that a fix for a security finding changed.
  The sequence could not find these, since no bug reviewer saw a security fix, so each one is
  coverage the loop added. The log carries what this needs: each `finding` line names its file
  and line, and each `apply` line the findings it fixes;
- whether round 1 makes the machine queue or swap, and whether a review leg runs out of context.

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
rule. It stays at three until #59, the research on what should end an AI review loop,
reports.
Each lens may have its own reviewer lanes (#63). With one list, a lane chosen for one lens, a
Claude lane for Claude Code's `/security-review` say, would review style and bugs as well, and
the choice of a lane for what its harness does well would cost a lane in every lens. A lens
that names no lanes of its own is reviewed by the reviewer list, as before. The waybill carries
each lens's lanes, so a run keeps the reviewers it was dispatched with. A lane that reviews
through its harness's own skill has [a page of its own](own-review-skills.md).

The lenses are now the turnpikes a ticket names, all three by default, and a run whose ticket
names none has no review leg:
[a ticket names the turnpikes its run passes through](turnpikes.md).

On 2026-09-27, with #59 reported, the user chose one round of bug review for now, to be
revisited if many bugs reach production ([when a review loop should stop](review-convergence.md)).
`coachman.md` still says three rounds until the ticket that changes it lands.
