# Workhorse spec: 80 End the review loop on P1 and P2 findings

## Summary

The review loop currently ends only when a round returns no new verified gating finding at any severity, so it runs to its three-round cap whenever minor findings keep appearing. This change makes round 1 fix every verified gating finding (P1, P2 and P3) and then repeat only while rounds log verified P1 or P2 findings, with the cap of three as a backstop; a decision script reads the log and prints whether another round runs.

## Technical context

- **Language and version**: Bash with Python in heredocs, matching the existing scripts (Python 3.11+).
- **Dependencies used or added**: none beyond the repo's existing pattern (bash, python3, jq not needed).
- **Testing**: `scripts/review-decide.sh --self-test` (positive and negative controls for each case in AC2 and AC6); `bash -n` on every changed script; `scripts/skill-refs.sh`; `scripts/wiki-lint.sh`; then the full gate via `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: Change only what ends the loop and which findings each round fixes (steps 4 and 5 of stage 2, the lens briefs' output contract, step 6). No marker, waybill field or completion check changes. The cap of three rounds stays. The repeated-class escalation stays. Style behaviour is unchanged. Script paths in runbooks go through `<tool>/`. Gate command unchanged.

## Direction check

| Constraint | How met |
|---|---|
| Change only what ends the loop and which findings each round fixes | Steps 4 and 5 rewritten; step 1's output contract gains P1–P3 definitions; step 6 gains the end-round line and carried P3s. Nothing else in coachman.md changes. |
| Round 1 applies every verified gating finding (P1, P2, P3) | Step 4: round 1 applies every verified gating finding; style findings still never applied. |
| Round 2 runs when round 1 applied a fix; after that only on P1/P2 | Step 5 calls the decision script; the script encodes this rule. |
| P3 from round 2 on unfixed, to hand-off deferred findings and ship card open findings with lens and round | Step 4 says so; the existing hand-off/ship-card channels carry them. |
| Severity is the coachman's verified one; lens briefs define P1–P3 in one line each | Step 1's output contract carries the three one-line definitions. |
| A script decides, with pos and neg controls per case in AC2 and AC6 | `scripts/review-decide.sh` with `--self-test`. |
| Cap of three stays as backstop; repeated-class escalation stays | Step 5 keeps both; the script reports cap at round 3 when P1/P2 would continue. |
| Review checkpoint card says which round ended the loop and why, lists P3s carried | Step 6 gains that requirement. |
| Wiki: review-loop.md says what ends the loop and the cap backstop; review-convergence.md Decision records the user's rule | Both pages updated; wiki-lint clean. |
| Script paths through `<tool>` in runbooks | skill-refs checked. |
| No marker / waybill / completion check changes | None touched. |
| Design rules: deterministic work in scripts; nothing repo/harness-specific; counts have controls | Decision logic is in the script, not prose; the script is project-agnostic; self-test has pos and neg controls. |

## Structure

| File | Change |
|---|---|
| `WORKHORSE-SPEC.md` | this file |
| `scripts/review-decide.sh` | new: reads finding and apply lines, prints the loop decision; `--self-test` |
| `skills/postmaster/coachman.md` | step 1 output contract (P1–P3 definitions); step 4 (what each round fixes, non-closed fix logging); step 5 (loop end via the script); step 6 (end-round and carried P3s on the card) |
| `wiki/concepts/review-loop.md` | what ends the loop; cap as backstop |
| `wiki/concepts/review-convergence.md` | Decision section: user's rule of 2026-09-27 in the user's words |
| `wiki/index.md` | one-line summaries of the two pages if they change meaning |
| `WORKHORSE-SUMMARY.md` | written last |

## Complexity tracking

None.

## Decisions

1. **Script name and interface.** `scripts/review-decide.sh <dispatch> <round>`; prints one decision line; exit 0 on a valid decision, 1 on usage or a bad log. The runbook calls it and reads the line.
2. **Decision output.** Three outcomes: `another round runs: <reason>`, `the loop ends at round N: <reason>`, `the cap is reached: escalate with the residue`. These cover AC5's "whether another round runs or the cap is reached" and AC7's "which round ended the loop and why".
3. **Associating apply lines with a round.** An `apply` line counts for round `r` when any finding target its detail names has a `finding` line whose round field is `r`. For round 1 (the only round whose applies drive the decision) this is precise; later rounds key on findings only, per the rule.
4. **Finding detail format.** `class severity round lens[,lens...] lane[,lane...] evidence...` after the target; the script parses the first three fields (class, severity, round). The latest finding line per target counts (a re-logged finding replaces its prior line), matching style-findings.sh.
5. **Severity definitions (lens briefs' output contract).** One line each, project-agnostic, impact-based: P1 = a caller can reach a wrong result, lost data, or a security hole through the change; P2 = a case the change should handle fails, or a security surface falls below the project's own bar; P3 = real but unlikely to hurt, an edge case or a missing nicety.
6. **Style behaviour interpretation.** The ticket notes say "style stays exactly as it is now (the clearly right findings applied, the rest to the Style residue)". At BASE, step 4 says "never a style finding" and #55's wiki entry says style applies nothing. The parenthetical describes the overall apply picture (verified gating findings applied; style findings to Style residue), not a restoration of pre-#55 style fixing. Style behaviour is left unchanged; the notes' "Out of scope: whether style gates (#55)" confirms this. Recorded here as the one ambiguity in the brief.
7. **Non-closed P3 fixes.** AC2 mandates logging for non-closed P1/P2 fixes. A P3 fix from round 1 that does not verify closed is logged the same way (as a P3 finding in the checking round) so the record is complete; the script then treats it per its severity (P3 does not keep the loop going).
8. **Round number past 3.** The script refuses a round past the cap (exit 1): the loop does not run there.
9. **Wiki scope.** review-loop.md gains what ends the loop and the cap-as-backstop wording; review-convergence.md's Decision section is rewritten to the refined rule in the user's words, noting the first answer and that many bugs in production stays the revisit signal. The index lines are updated to match.

## Tasks

- [ ] T001 [P] [AC1 AC2 AC3] Rewrite step 4 of stage 2 in `skills/postmaster/coachman.md`: round 1 applies every verified gating finding P1–P3; from round 2 on only P1 and P2; P3s to hand-off deferred findings and ship card open findings with lens and round; a non-closed P1/P2 fix logged as a finding of its own severity; style unchanged.
- [ ] T002 [P] [AC4] Add P1, P2, P3 one-line definitions to the lens briefs' output contract in step 1 of stage 2 in `skills/postmaster/coachman.md`.
- [ ] T003 [AC5] Write `scripts/review-decide.sh` with `--self-test` (pos and neg control per case in AC2 and AC6); step 5 calls it rather than counting findings.
- [ ] T004 [AC2 AC6] Rewrite step 5 of stage 2 in `skills/postmaster/coachman.md`: the decision script decides the next round; cap of three as backstop; repeated-class escalation stays.
- [ ] T005 [AC7] Update step 6 of stage 2 in `skills/postmaster/coachman.md`: the review checkpoint card says which round ended the loop and why, and lists the P3 findings carried to the ship card.
- [ ] T006 [AC8] Update `wiki/concepts/review-loop.md` (what ends the loop; cap as backstop) and the Decision section of `wiki/concepts/review-convergence.md` (user's rule of 2026-09-27 in the user's words, with the backstop); check `wiki/index.md`.
- [ ] T007 [AC1–AC8] Run `scripts/review-decide.sh --self-test`, `bash -n`, `scripts/skill-refs.sh`, `scripts/wiki-lint.sh`, then the full gate; write `WORKHORSE-SUMMARY.md`.
