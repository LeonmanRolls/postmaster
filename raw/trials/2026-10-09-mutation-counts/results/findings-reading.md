# The 8 findings whose function the first count flags, read against the flagged places

One reader, the first, read each finding's description and the code of its snapshot (`git show
<snapshot>:<module>`), and asked whether a place of the first count in the holding function has
anything to do with the defect. No second reader read these. The flagged places are those of
[findings-join.tsv](findings-join.tsv), column `places_here`, without the ones marked second only.
The question is not whether the count "caught" the finding: it flags the function, not the defect.

| finding | function (lines at the snapshot) | flagged places of the first count | bears on the defect? |
|---|---|---|---|
| 216/bug-14 (`scripts/scrub-core.ts:700`, snapshot `cbd0384`) | `tokenFindings` (634-782) | three assignments to `lastIndex` of module-level regexes (`FIELD_VALUE` and `MAIL`, both global, and `DOTENV_LINE`, which is not) | **yes.** The defect is that `MAIL.test` runs on a global regex whose `lastIndex` was not reset, so successive fields miss intermittently. The flagged places are the resets of its neighbours, and the defect is the missing one: the cause is module-level regex state. |
| 268/bug-2 (`scripts/lib/switch-offs.ts:416`, `8fe7775`) | the callback of `placed.forEach` in `fileSwitches` (416-426) | two `Map.set` calls, one on each of two maps of the enclosing function | **partly.** The defect is that a close pops the whole stack of opens although the linter matches by rule set. The flagged `set` calls record the pairs that logic makes. The push and pop on the stack (second count only: the stack is a local name for an element of one of those maps, which the count does not follow) are the logic itself. The cause is the matching rule, not that the collections change. |
| 216/bug-12 (`scripts/raw-promote-main.ts:276`, `26ba0d0`) | `writeScrubbed` (258-291) | an assignment to a module-level variable on line 275, `ALLOW_MARKER.lastIndex = 0` | **beside it.** The flagged place is the line before the defective one, which strips a marker with that regex. The defect is what the pattern eats (closing JSON syntax), not the state. |
| 202/bug-1 (`scripts/reach.ts:693`, `3abedd7`) | `add` inside `commandTouches` (671-713) | two `push` calls on the enclosing function's array | no. The defect is how a refusal is attributed. |
| 216/sec-2 (`scripts/scrub-rewrite.ts:319`, `cbd0384`) | `main` (292-426) | a `delete` on `process.env` on line 294 | no. The defect is a raw path printed in a refusal. The function is 135 lines long. |
| 268/bug-1 (`scripts/lib/switch-offs.ts:435`, `8fe7775`) | the callback of `placed.forEach` in `fileSwitches` (428-452) | one `push` on the enclosing function's array, at the end of the callback | no. The defect is an identity that hashes one line where a lint comment covers the next node. |
| 268/security-5 (`scripts/lib/switch-offs.ts:555`, `7e07807`) | the callback of `placed.forEach` in `fileSwitches` (548-576) | one `push` on the enclosing function's array | no. The defect is a next-line identity that misses blank and comment skipping. |
| 268/security-12 (`scripts/lib/switch-offs.ts:771`, `b0f7d8a`) | the callback of `placed.forEach` in `fileSwitches` (759-792) | one `push` on the enclosing function's array | no. The defect is a block-comment identity that hashes a comment line. |

So of the 8, the flagged place bears on the defect in 1, partly in 1, sits next to it in 1, and has
nothing to do with it in 5. In all five of the last group the function holds one flagged place that is
its own output (a `push` onto the result, or a `delete` of an environment variable at start-up) next to
defects of the logic.
