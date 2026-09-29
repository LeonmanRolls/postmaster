---
title: A lane may review through its harness's own skill
type: concept
standing: claimed
sources: [trials/claude-security-review, trials/code-review-scope, trials/code-review-launch]
updated: 2026-09-29
---

# A lane may review through its harness's own skill

**Claim.** Under a lens, a lane whose harness ships its own review skill for that lens reviews
at least as well by running the skill as by following postmaster's brief. For the **security**
lens a lane whose harness has none still follows the brief, so the lens never loses a lane. For
the **bug** lens there is no fallback: a lane whose harness has no code-review skill does not
review for bugs at all, and the bug brief is gone. The security lens works this way since
[issue #66](https://github.com/brindlewick/postmaster/issues/66), and the bug lens since
[issue #38](https://github.com/brindlewick/postmaster/issues/38).

**Standing: claimed.** The user took this decision on reasoning. No run has yet put a skill
beside the brief on the same snapshot. The trials below settle something narrower, facts about
what each tool's code-review skill needs in order to review a run's change at all.

## The reasoning

- **A harness's makers tune its skill for their own model.** A skill carries its maker's
  prompt, and Claude Code's also filters its own false positives with verification agents.
  postmaster's brief is one prompt written for every harness (unverified: no run has compared
  the two).
- **The lane stays independent.** The skill runs in the lane's own scratch, on the same
  snapshot as every other lane, and the coachman verifies its findings like anyone else's. So a
  finding it shares with another lane still counts as corroboration by lane, as
  [combining models](combining-models.md) needs.
- **On the bug lens, nothing is lost where a harness has no skill** in the sense that matters:
  the user chose that the bug review is the skill, not a brief every harness is given. The
  lens is as wide as the lanes whose harness has a form. The security lens kept the brief
  fallback; the bug lens does not, since #38.
- **The user chooses the lanes.** Since #63 a lens may have its own reviewer lanes (see
  [the review loop](review-loop.md)), so a lane can be added to one lens for its skill alone.

## What it costs

- **The brief's context does not reach a skill.** The brief names the project's own surfaces
  (how it binds and authenticates, what it allowlists, what it spawns) and the findings already
  known. A skill reviews without them. It may miss a surface only the project's docs describe,
  or report a known finding again. The coachman's verification drops what does not hold, but it
  cannot add what a skill never looked for. Lanes on the brief keep running beside it on the
  security lens; on the bug lens there is no brief lane.
- **Its report is not the finding contract.** Each harness's report has its own shape.
  `scripts/review-findings.sh` turns them into the contract (file, line, severity, summary,
  body, evidence, confidence, category, source), marking a field the harness did not give as
  `not provided` rather than inventing one. Unparseable output fails loudly, never as clean.
  The coachman then dedups and verifies as it does brief findings.
- **A skill has its own assumptions about the repository.** Claude Code's `/security-review`
  needs `origin/HEAD`, below. Its `/code-review` needs the change named: see the bug lens.

## The bug lens

Under the bug lens, only lanes whose harness has a code-review skill review. Each is launched
through `<tool>/scripts/launch.sh review <lane> <scratch> <BASE>`, on the same snapshot and in
its own worktree scratch, at the harness's top level (`max` for claude and codex, `high` for
MiMo Code on MiMo V2.6 Pro). No bug brief is written. A lane whose harness has none does not
review for bugs; `setup.sh` names such lanes at setup and warns when none of the chosen bug
reviewers has one, and a run whose turnpikes include the bug review and whose config gives it
no such lane is refused at the pre-flight.

**Every form names the change from BASE.** A skill left to choose its own diff cannot be
trusted in a review scratch, which is a worktree detached at the snapshot with no upstream. In
the trial [`raw/trials/code-review-scope/`](../../raw/trials/code-review-scope/method.md),
claude 2.1.283's `/code-review` looked at the last commit alone first, at `low` and at
`medium`, and reached the whole change only because the branch list showed the target's
default branch (`trunk`). codex 0.157.1's `codex exec review` has no default target and exits
1 before any model call. MiMo Code 0.1.15's `/review` reviewed uncommitted changes, which in a
clean scratch is nothing, and exited 0. Named explicitly, each reviewed exactly the run's
change. So every review form names the change.

## What each harness's code-review skill needs

| harness | form (`launch.sh review`) | what it needs to review the run's change | findings | known findings | its own tool calls |
|---|---|---|---|---|---|
| claude | `/code-review max <BASE>...HEAD` through its launch form | the range in the prompt; without it the skill looked at the last commit alone first and reached further only through the branch list | at `max`, a JSON array in the final message (read from the 2.1.283 binary); at `low`, one `path:line — …` line per finding; at `medium`, a findings tool call in the forked task plus a final message of its own shape | cannot be given: the argument parser reads the first word as the level and joins the rest into the target | the forked task's output file under `/tmp/claude-<uid>/`, named by the stream's `task_notification`; the harvest copies it |
| codex | `codex exec review --base <BASE>` with its launch form's flags | `--base <BASE>`; it computes the merge base itself. No target: exits 1 before any model call | `- [P<n>] <title> — <absolute path>:<start>-<end>` with a body; the session file holds `review_output` structured | a custom prompt is an alternative to `--base`; whether they combine is untested | commands in the `--json` stream; model, effort and prompt in `~/.codex/sessions/YYYY/MM/DD/` |
| mimo | its launch form with `--command review` and `<BASE>...HEAD` in the prompt file | the range in the prompt file: `mimo run` appends stdin to its free-text arguments. A bare SHA is read as one commit. No target: uncommitted changes, nothing in a clean scratch, exit 0 | free markdown | free text in the same arguments; the form carries the range alone | a subtask's calls stream inline under the parent's session id |

pi and muse have no code-review skill (their help and `muse skills list`). grok's
documentation lists none. agy's is not recorded. Those lanes do not review for bugs.

The same fixture through the flow's own launch path — a worktree scratch detached at the
snapshot of a target whose default branch is `trunk`, the planted bug in the first of two
commits, each harness at the level criterion 3 of #38 sets — yields a normalized finding at
`src/page.js:8` for each form that has one
[@trials/code-review-launch/] [@trials/code-review-scope/].

## What Claude Code's security skill needs

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
the merge base where it was, so the skill still reviews exactly the run's change. A named range
needs no clone, so the bug lens keeps the ordinary worktree scratch.

## What would settle it

Runs in which a skill lane runs its harness's skill beside lanes on the brief, on the same
snapshots:

- per lane, the findings reported, and how many survive the coachman's verification;
- the surviving findings only a skill lane reported, and those only a brief lane reported;
- the project-specific surfaces a brief lane covered and a skill lane missed.

A fair comparison needs the same model on both: one claude lane on the skill and one on the
brief, which a config can set up with two lanes on one model. The claim is weakened if a skill
lane's surviving findings are routinely a subset of the brief lanes' on the same model. It is
refuted if they survive verification less often than the same model's findings on the brief.
Out of scope for #38, which the fixture in #37 can measure.

## What changed because of it

`scripts/launch.sh skill <lane> security-review` prints the prompt that invokes a lane's
harness's own security skill, and exits 3 for a harness with none.
`scripts/launch.sh review <lane> <cwd> <base>` runs the harness's
own code-review form on the change from `<base>` to the scratch's HEAD, at the harness's top
level, and exits 3 for a harness with no form. `scripts/review-forms.sh has` is the one list of
who has one. `scripts/review-findings.sh` turns each form's report into the finding contract.
`skills/postmaster/harnesses.md` records which harnesses have each skill and where each answer
came from. The coachman launches a security lane through its skill where it has one, and from
the brief otherwise; it launches every bug lane through `launch.sh review` and writes no bug
brief. `scripts/cut-scratch.sh` cuts the security lens's scratches as clones, checks every
scratch before a lane is launched into it, tells a scratch from anything else, and removes a
scratch of either kind. `scripts/host.sh` hosts a clone in a space of its
own, which it closes like a worktree's. `scripts/reviewers.sh` names as bug reviewers only the
configured ones whose harness has a form; `setup.sh` warns when none has one; the pre-flight
refuses a bug turnpike with no such lane. No reviewer runs the project's full gate: the
coachman runs it once per round on the snapshot, and a reviewer checks a finding with a
targeted probe.
