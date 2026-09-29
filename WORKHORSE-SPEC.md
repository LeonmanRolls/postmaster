# Workhorse spec: 106 Tell a new user to say hi

## Summary

A session opened in a fresh clone sits at an empty prompt until the user types something,
so the README's Getting started and AGENTS.md's session-opening passage must tell the user
to open their agent in the clone and say hi, and must not imply the agent starts on its own.
This workhorse makes those two wording changes and sweeps both files for any leftover
auto-start implication.

## Technical context

- **Language and version**: Markdown prose only.
- **Dependencies used or added**: none.
- **Testing**: `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'` from the worktree root, then `/home/brindlewick/postmaster/scripts/verify.sh run .` and a read-back of both edited passages against the three acceptance criteria.
- **Constraints**: minimal edit, in the files' own voice (plain, short sentences); this ticket covers the clone only, not #33's `postmaster` command; no scripts added; keep script paths through `<tool>` and the wiki linting clean; touch only README.md and AGENTS.md.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Tell the user to say hi, in the two places a new user and their agent read first | README Getting started and AGENTS.md's session-opening passage each say to say hi |
| #33's `postmaster` command sends `hi` itself; this ticket covers the clone | Only README.md and AGENTS.md are touched; no skill, script or command is changed |
| Minimal edit, in the files' own voice | Two short prose edits, plain sentences, no new sections |
| Script paths in runbooks go through `<tool>` | No runbook is touched; `scripts/skill-refs.sh` stays in the gate |
| Keep the wiki linting clean | No wiki file is touched; `scripts/wiki-lint.sh` stays in the gate |
| You add no script | No script is created or changed; stated again in the summary |
| Mind the neighbours in flight | Only the two named files change; whoever merges second resolves conflicts |

## Structure

- `WORKHORSE-SPEC.md` — this file (committed alone, first).
- `README.md` — Getting started: say hi; drop any implication the agent starts alone.
- `AGENTS.md` — "When a session opens in this repo, do this": say hi, any first message starts the flow; drop "this file takes it from there".

## Decisions

- **Where the "any first message starts the flow" sentence goes.** The acceptance criterion names it for AGENTS.md; a short echo in the README reinforces the same fact for a new user who never opens AGENTS.md. Both files get the sentence.
- **How to kill the auto-start implication in the README.** "AGENTS.md tells the agent what to do" reads as though opening the agent is enough. Preceding it with "Any first message starts the flow" makes the trigger explicit without rewriting the rest of the paragraph.
- **Pronoun in AGENTS.md.** "They open their agent" becomes "The user opens their agent", matching the acceptance criterion's wording.
- **Section header "When a session opens in this repo, do this".** Kept. It is the agent's instruction header for when it is engaged, not a claim that the agent begins alone.
- **Sweep result.** The only auto-start implications are README's "AGENTS.md tells the agent what to do" beside "open your agent in it", and AGENTS.md's "this file takes it from there". Lines about a run merging on its own authority are unrelated and stay.

## Tasks

- [x] T001 [AC1] Edit README.md Getting started so it says to open your agent in the clone and say hi.
- [x] T002 [AC2] Edit AGENTS.md's session-opening passage so it says the user opens their agent in this folder and says hi, and that any first message starts the flow.
- [x] T003 [AC3] Sweep README.md and AGENTS.md whole; remove or reword anything left that says or implies the agent starts on its own.
