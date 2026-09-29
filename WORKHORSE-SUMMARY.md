# Workhorse summary: 80 End the review loop on P1 and P2 findings

## Commits

| commit | what it does |
|---|---|
| `095f7cb` | Workhorse spec for #80 |
| `d68ac7c` | `scripts/review-decide.sh`: the loop decision from `finding` and `apply` lines, with `--self-test` |
| `f0586ab` | `skills/postmaster/coachman.md`: P1–P3 output-contract definitions; round 1 fixes every gating severity; from round 2 on only P1 and P2; non-closed fix logging; the decision script and the cap-as-backstop in step 5; the checkpoint card names the end-round and carried P3s |
| `dfd48d6` | Wiki: what ends the loop and the cap-as-backstop in `review-loop.md`; the user's rule of 2026-09-27 in the Decision section of `review-convergence.md`; index lines |

## Checks

From `/home/brindlewick/postmaster/scripts/verify.sh run .` run just before this summary:

- gate: pass, exit 0, 370s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'

Other commands run, with their exit codes:

- `scripts/review-decide.sh --self-test`: exit 0 (all controls behaved; positive and negative control for each case in AC2 and AC6, plus non-closed-fix and round-bound controls)
- `scripts/skill-refs.sh`: exit 0
- `scripts/wiki-lint.sh`: exit 0
- `bash -n scripts/review-decide.sh`: exit 0

## Decisions

1. **Style behaviour.** The ticket notes say "style stays exactly as it is now (the clearly right findings applied, the rest to the Style residue)". At BASE, step 4 says "never a style finding" and #55's wiki page says style applies nothing. The parenthetical describes the overall apply picture (verified gating findings applied; style findings to Style residue), not a restoration of the pre-#55 style-finding application that #55 removed. Style behaviour is left unchanged; the notes' "Out of scope: whether style gates (#55)" confirms this. This is the one ambiguity in the brief.
2. **Script name and interface.** `scripts/review-decide.sh <dispatch> <round>`; one decision line on stdout; exit 0 on a valid decision, 1 on usage or a bad log. Not added to the gate's script list (fixed at BASE); its self-test is run directly.
3. **Decision output.** Three outcomes: `another round runs: <reason>`, `the loop ends at round N: <reason>`, `the cap is reached: escalate with the residue`. These cover AC5's two-way question and AC7's "which round ended the loop and why".
4. **Associating apply lines with a round.** An `apply` counts for round `r` when any finding target its detail names has a `finding` whose round is `r`. For round 1 (the only round whose applies drive the decision) this is precise.
5. **Severity definitions.** One line each, project-agnostic, impact-based: P1 = a caller can reach a wrong result, lost data, or a security hole through the change; P2 = a case the change should handle fails, or a security surface falls below the project's own bar; P3 = real but unlikely to hurt, an edge case or a missing nicety.
6. **Non-closed P3 fixes.** AC2 mandates logging for non-closed P1/P2 fixes. A P3 fix from round 1 that does not verify closed is logged the same way (as a P3 finding in the checking round) so the record is complete; it does not keep the loop going.
7. **Round number past 3.** The script refuses a round past the cap (exit 1).
8. **Gating lens with no real review.** The existing step 2 rule (a round in which no lane actually reviewed under a gating lens is never the last) is kept and cross-referenced from step 5: the decision script is overridden in that case.

## Not done, and why

- The legs table still says "every round to clean" (`coachman.md` line 141). The direction limits changes to steps 4–5 of stage 2, the lens briefs' output contract and step 6; the table is outside that set. The detailed rule is in step 5.
- The hand-off template and the stage 3 ship-card text were not changed. The direction limits changes as above; step 4 states that P3 findings go to the hand-off's deferred findings and the ship card's open findings "with its lens and the round that found it", and the existing channels carry them.
- The gate command and the gate's script list were not changed; the brief says not to.

## Acceptance criteria

| AC | met | evidence |
|---|---|---|
| 1 | yes | `coachman.md` step 4: "Round 1 applies every verified gating finding, P1, P2 and P3 alike"; escalation and hand-off language preserved. |
| 2 | yes | Step 5 calls `review-decide.sh`, which encodes "round 2 runs whenever round 1 applied a fix" and "round `r+1` runs only when round `r` logged a verified P1 or P2 finding"; non-closed fix logging is in step 5. Self-test covers both cases, pos and neg. |
| 3 | yes | Step 4: "From round 2 on, only verified P1 and P2 gating findings are fixed; a P3 finding is not fixed and goes to the hand-off's deferred findings and the ship card's open findings, with its lens and the round that found it." |
| 4 | yes | Step 1's output contract defines P1, P2, P3 in one line each, in terms that fit any target project. |
| 5 | yes | `scripts/review-decide.sh` reads the round's `finding` and `apply` lines and prints the decision; step 5 calls it. Self-test has a positive and a negative control for each case in AC2 and AC6. |
| 6 | yes | Step 5: "The cap of 3 rounds … stays as a backstop: when round 3 logs a verified P1 or P2 finding, the loop stops and escalates with the residue." The repeated-class escalation is unchanged below it. |
| 7 | yes | Step 6: "The card says which round ended the loop and why, as `<tool>/scripts/review-decide.sh` printed it, and lists the P3 findings the loop carried to the ship card's open findings, with each one's lens and the round that found it." |
| 8 | yes | `wiki/concepts/review-loop.md` has a "What ends the loop" paragraph naming the rule and the cap-as-backstop; the Decision section of `wiki/concepts/review-convergence.md` records the user's words and the backstop. `wiki-lint.sh` exits 0. |
