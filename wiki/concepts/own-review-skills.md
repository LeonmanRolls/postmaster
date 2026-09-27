---
title: A lane may review through its harness's own skill
type: concept
standing: claimed
sources: [trials/claude-security-review]
updated: 2026-09-26
---

# A lane may review through its harness's own skill

**Claim.** Under a lens, a lane whose harness ships its own review skill for that lens reviews
at least as well by running the skill as by following postmaster's brief. A lane whose harness
has none follows the brief, so the lens never loses a lane. The security lens works this way
since [issue #66](https://github.com/brindlewick/postmaster/issues/66), and
[issue #38](https://github.com/brindlewick/postmaster/issues/38) proposes the same for the bug
lens.

**Standing: claimed.** The user took this decision on reasoning. No run has yet put a skill
beside the brief on the same snapshot. The trial below settles something narrower, a fact about
one tool: what Claude Code's `/security-review` needs in order to review anything at all.

## The reasoning

- **A harness's makers tune its skill for their own model.** A skill carries its maker's
  prompt, and Claude Code's also filters its own false positives with verification agents.
  postmaster's brief is one prompt written for every harness (unverified: no run has compared
  the two).
- **The lane stays independent.** The skill runs in the lane's own scratch, on the same
  snapshot as every other lane, and the coachman verifies its findings like anyone else's. So a
  finding it shares with another lane still counts as corroboration by lane, as
  [combining models](combining-models.md) needs.
- **Nothing is lost where a harness has no skill.** That lane follows the brief, as before.
- **The user chooses the lanes.** Since #63 a lens may have its own reviewer lanes (see
  [the review loop](review-loop.md)), so a lane can be added to one lens for its skill alone.

## What it costs

- **The brief's context does not reach a skill.** The brief names the project's own surfaces
  (how it binds and authenticates, what it allowlists, what it spawns) and the findings already
  known. A skill reviews without them. It may miss a surface only the project's docs describe,
  or report a known finding again. The coachman's verification drops what does not hold, but it
  cannot add what a skill never looked for. Lanes on the brief keep running beside it.
- **Its report is not the finding contract.** Claude Code's gives each finding a file and line,
  a severity, a category, an exploit scenario and a confidence
  [@trials/claude-security-review/clone.txt]. It has no P1 to P3, and does not say whether a
  finding was verified by running something. The coachman maps it as it verifies. Normalizing
  a skill's output is #38's.
- **A skill has its own assumptions about the repository.** Claude Code's needs `origin/HEAD`,
  below.

## What Claude Code's skill needs

Launched as the flow launches a reviewer lane, with the prompt `launch.sh skill` prints,
Claude Code 2.1.283's `/security-review`:

- in a scratch clone whose `origin/HEAD` leads back to the base, reported the planted command
  injection at its file and line, severity High, in both runs
  [@trials/claude-security-review/clone.txt] [@trials/claude-security-review/clone-first.txt];
- in a worktree scratch where `origin/HEAD` did not resolve, exited 0 with one `success` result,
  0 turns and empty text, having reviewed nothing [@trials/claude-security-review/worktree.txt].
  Read as a verdict, that is a clean review;
- in one run of two, verified its findings in background agents and ended with three result
  lines, the report on the last [@trials/claude-security-review/clone-first.txt]. The harvest
  reads a lane's last result line, so it gets the report either way.

A worktree cannot hold an `origin/HEAD` of its own. Remote-tracking refs are shared by every
worktree of a repository, as git's worktree documentation says (unverified here). A clone of
the target has one, the branch the target has checked out, which is the default branch at the
run's base until another run merges. So the security lens reviews from clones cut with
`scripts/cut-scratch.sh --clone <BASE>`, every lane of it, so that which lane runs a skill never
decides what its scratch is. The cut, and the check before each launch, refuse a clone whose
`origin/HEAD` does not lead back to BASE. Another run's merge moves `origin/HEAD` on but leaves
the merge base where it was, so the skill still reviews exactly the run's change.

## What would settle it

Runs in which a security lane runs its harness's skill beside lanes on the brief, on the same
snapshots:

- per lane, the findings reported, and how many survive the coachman's verification;
- the surviving findings only a skill lane reported, and those only a brief lane reported;
- the project-specific surfaces a brief lane covered and a skill lane missed.

A fair comparison needs the same model on both: one claude lane on the skill and one on the
brief, which a config can set up with two lanes on one model. The claim is weakened if a skill
lane's surviving findings are routinely a subset of the brief lanes' on the same model. It is
refuted if they survive verification less often than the same model's findings on the brief.

## What changed because of it

`scripts/launch.sh skill <lane> security-review` prints the prompt that invokes a lane's
harness's own skill, and exits 3 for a harness with none. `skills/postmaster/harnesses.md`
records which harnesses have one, and where each answer came from. The coachman launches a
security lane through its skill where it has one, and from the brief otherwise.
`scripts/cut-scratch.sh` cuts the security lens's scratches as clones, checks every scratch
before a lane is launched into it, tells a scratch from anything else, and removes a scratch of
either kind. `scripts/host.sh` hosts a clone in a space of its
own, which it closes like a worktree's.
