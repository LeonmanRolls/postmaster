---
title: Sources
type: source
updated: 2026-09-29
---

# Sources

One page per piece of evidence somebody chose to keep: a run promoted from a project's
`.postmaster/`, compiled in the shape of [the template](template.md), or a paper or article
captured into `raw/`, saying what it claims and what it would mean here if true. Newest first.

## Articles

- [The AI-native SDLC playbook](ai-native-sdlc-playbook.md) (2026): design review happens
  before any code is generated, and nothing is implemented without an accepted plan.

## Runs

- [2026-09-26, `postmaster`, #36: the review rounds of pull request #39](2026-09-26-postmaster-36.md).
  Five rounds of review run by hand, with every finding of rounds 2 to 4, where it sat, and what
  became of it. Not a dispatch.

## Papers

On when review should stop, captured for [when a review loop should stop](../concepts/review-convergence.md):

- [Capture-recapture in software inspections](petersson-2004-capture-recapture.md) (2004): the
  overlap between independent reviewers estimates what an inspection left.
- [Review rate and what one review finds](kemerer-paulk-2009-review-rate.md) (2009): one careful
  review by a person finds about half the defects in code.
- [What people's review comments are about](czerwonka-2015-code-reviews.md) (2015): about 15% point
  to a possible defect.
- [People disagree on severity](tian-2016-severity.md) (2016): around 51% of duplicate bug reports
  carry different severities.
- [How often a fix by people brings a new defect](purushothaman-perry-2005-small-changes.md) (2005):
  nearly 40% of fixes in one large system.
- [Models reviewing and fixing the same code over and over](wang-lin-2026-iterative-bug-fixing.md)
  (2026): they damage correct code faster than they repair broken code, and cycle.
- [More revision rounds can undo a correct fix](gao-2026-looping-not-reliability.md) (2026).
- [Repair is only as good as the feedback](olausson-2024-self-repair.md) (2024).
- [A patch that passes its tests can still be wrong](wang-2026-solved-issues.md) (2026).
- [Models' false positives, and answers that change between runs](ullah-2024-llm-vulnerabilities.md)
  (2024).
- [The same review, repeated, comes out different](klishevich-2025-review-determinism.md) (2025).
- [A model reviewer in one company](cihan-2025-automated-review.md) (2024): about a quarter of its
  comments were not acted on.
- [How developers answered an agent's review comments](lin-2026-agentic-review.md) (2026): 56.3%
  rejected.
- [Models rate vulnerabilities as more urgent than they are](al-haddad-2025-vulnerability-triage.md)
  (2025).

Nothing arrives here on its own. Every run writes its full record to its own project's
gitignored `.postmaster/`, and most runs stay there. A page appears only when somebody decides
a run is evidence and ingests it: the promotion checks run, the record is copied into
`raw/runs/<run-id>/`, and the page is compiled from that copy. Until teardown offers that
choice, it is made by hand with `/wiki`.

A recorded trial needs no page here. Its `method.md` in `raw/trials/` describes it, and the
concept it settles cites it directly. See [how the wiki is kept](../schema.md).
