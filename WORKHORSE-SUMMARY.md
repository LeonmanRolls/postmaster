# Workhorse summary: 106 Tell a new user to say hi

## What I built

Two prose edits, in the files a new user and their agent read first.

- `a875cda` Add workhorse spec for #106 — `WORKHORSE-SPEC.md`, committed alone before any code.
- `83215df` Tell a new user to say hi — `README.md` Getting started and `AGENTS.md`'s session-opening passage, plus the spec's tasks ticked.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` just before this summary:

```
gate: pass, exit 0, 836s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other commands, with their exit codes:

- `scripts/review-round.sh --self-test` — exit 0, all controls behaved (after the first two gate runs failed only its timing controls under load; that self-test passes clean in isolation).
- Grep sweeps of `README.md` and `AGENTS.md` for auto-start wording (takes it from there, open your agent, first message, on its own, starts the flow, tells the agent, immediately, when you open, and the like) — exit 0; the only hits left are "merge on its own authority" (about merges, not agent start) and the new "say hi" / "any first message starts the flow" sentences themselves.

The first two full gate runs failed with `self-test: 3 control(s) misbehaved`, all three in `review-round.sh`'s timing and teardown controls ("a wait from an earlier start of the round stands down", "teardown from inside a scratch leaves it in place", "from outside, teardown stops the unfinished reviewer first"). That is the load flake the brief names. The third run passed clean under load average about 33.

## Decisions

- **Where "any first message starts the flow" goes.** The acceptance criterion names it for AGENTS.md; I also put it in the README, so a new user who never opens AGENTS.md still learns the trigger. Both files carry the sentence.
- **How to kill the auto-start implication in the README.** "AGENTS.md tells the agent what to do" read as though opening the agent was enough. Preceding the paragraph with "Any first message starts the flow" makes the trigger explicit without rewriting the rest.
- **Pronoun in AGENTS.md.** "They open their agent" became "The user opens their agent", matching the acceptance criterion's wording.
- **Section header "When a session opens in this repo, do this".** Kept as it is. It is the agent's instruction header for when it is engaged, not a claim that the agent begins alone.
- **Sweep scope.** Only `README.md` and `AGENTS.md` (`CLAUDE.md` is a symlink to `AGENTS.md`). The two auto-start implications were the README's "AGENTS.md tells the agent what to do" beside "open your agent in it", and AGENTS.md's "this file takes it from there". Both are gone. `raw/README.md` is out of scope for this ticket.

## What I did not do

- No script was added or changed. The gate's script list is untouched.
- #33's `postmaster` command, and any other flow, skill or runbook, are untouched: this ticket covers the clone only.
- No wiki page changed, so `scripts/wiki-lint.sh` needed no work.

## Acceptance criteria

- **AC1 — README's Getting started says to open your agent in the clone and say hi.** Met. It now reads: "Clone this repo, open your agent in it, and say hi. Any first message starts the flow."
- **AC2 — AGENTS.md says the user opens their agent in this folder and says hi, and that any first message starts the flow.** Met. The session-opening passage now reads: "The user opens their agent in this folder and says hi. Any first message starts the flow: set the machine up if it is not, choose a target, launch the postmaster."
- **AC3 — Nothing left in the README or AGENTS.md says or implies that the agent starts on its own.** Met. "This file takes it from there" is gone; "AGENTS.md tells the agent what to do" is now preceded by the explicit trigger; the sweep found nothing else that implies a solo start.
