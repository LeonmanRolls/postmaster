# Changes the user made to a ticket's ask after the lanes had started

From each run's action log (`ticket-edit` lines and the postmaster's notes) and the tracker's edit history for the ticket, read on 2026-10-04. Only changes made after the first workhorse launched are listed. The run records are not promoted.

Five of the 21 runs had a change that replaced what a criterion asked for with a form the template now calls bounded. Other changes made after launch are listed under the table, so the list is complete.

| Run | When (UTC) | What the user changed | Bounded form it matches | Severe findings in the rounds just before | In the rounds after |
| --- | --- | --- | --- | --- | --- |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 2026-09-30 22:40, after round 4 | From a definition of every part of the contract and the file and line that touched it, to a list of files, each covered whole | a closed set: the named files | round 3: 1, round 4: 2 | round 5: 1; the user ended the review there |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 2026-09-30 13:28, after round 10 | The port does what the flow needs; the old scripts are the reference only where the flow depends on them, and a finding must name an observable difference | name the cases that must agree: the observable ones | round 9: 8, round 10: 5 | round 11: 4, round 12: 4, round 13: 0 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 2026-09-29 23:33, after round 18 | Whether a ticket landed is decided from ancestry, or from the provider's report that the pull request merged, never by comparing content | observe an outcome instead of comparing content | rounds 16 to 18: 3, 4, 5 | round 19: 1, round 20: 1 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 2026-10-04 10:32, after round 7 | A finding comes only from an observed change; what a lane's commands name outside its folder is a note; the command classifier is removed | observe afterwards instead of predicting from the command text | round 6: 1, round 7: 5 | round 8: 1, round 9: 2 |
| [#252](https://github.com/brindlewick/postmaster/issues/252) | 2026-10-04 22:01, after round 3 | The dry run is a best-effort preview, not a prediction of every refusal of the real run | any other case may differ, and the output says so | round 2: 5, round 3: 4 | round 4 had not reported when the records were read |

How to read it:

- Each change came after a round with several severe findings, so a smaller next round is also what a run that is settling down would show. Five runs cannot separate the two.
- [#109](https://github.com/brindlewick/postmaster/issues/109)'s rounds 11 and 12 are from its checkpoint and its finding lines. Its round 11 has no finding lines: the review leg's checkpoint says 4 of 5 claimed P2 findings stood.
- [#202](https://github.com/brindlewick/postmaster/issues/202)'s rescope was made in the run's spec and notes, not in the ticket on the tracker; the ticket's text was not edited.
- [#124](https://github.com/brindlewick/postmaster/issues/124)'s counts for rounds 5 to 18 are from the run's own review checkpoint, since its finding lines name none ([severe-by-round.md](severe-by-round.md)).
- Other edits after launch, none of them a bounding: [#135](https://github.com/brindlewick/postmaster/issues/135) was widened at 2026-09-29 05:42 to absorb another ticket and rewritten at 2026-09-30 00:13 to one mechanical check; [#124](https://github.com/brindlewick/postmaster/issues/124) gained a criterion for a landing script at 2026-09-29 10:07 and another at 11:41; [#109](https://github.com/brindlewick/postmaster/issues/109) gained three paragraphs on test placement and linting at 2026-09-30 13:50 to 14:10. [#98](https://github.com/brindlewick/postmaster/issues/98), [#158](https://github.com/brindlewick/postmaster/issues/158), [#159](https://github.com/brindlewick/postmaster/issues/159), [#170](https://github.com/brindlewick/postmaster/issues/170) and [#179](https://github.com/brindlewick/postmaster/issues/179) were edited by the user during the planning stage, before any lane started, and the lanes saw the edited text.
