# Controls for the count

Every count here is made by a command, and each has a control that could have come out otherwise. Commands are in [the method](../method.md). `<runs>` stands for a run folder that is not promoted.

## The severe-findings count

| # | Control | Result |
| --- | --- | --- |
| 1 | Positive: the severe-by-round command on [#202](https://github.com/brindlewick/postmaster/issues/202) | `1:12 2:4 3:3 4:2 5:4 6:1 7:5`. Not zero, and equal to the figures the postmaster made for [#202](https://github.com/brindlewick/postmaster/issues/202): 12, 4, 3, 2, 4, 1, 5 |
| 2 | Negative: the same command on two runs that have no severe finding line, run 108 (141 action lines) and run 265 (77 action lines) | Nothing printed for either |
| 3 | Agreement of two programs: the one-line command here against the lane audit's table, for the 18 runs of the audit, on rounds, severe findings in each round and total | 17 of 18 identical. [#135](https://github.com/brindlewick/postmaster/issues/135) differs by one: the audit reads 32 and the command reads 31, because one round-5 line is a coachman's summary of P2 fixes with no `P2` severity word in the form the command reads |
| 4 | A second record of the same count, for [#202](https://github.com/brindlewick/postmaster/issues/202): its review checkpoint states the verified findings round by round | 12, 4, 3, 2, 4, 1, 5, 1, 2 in both. Rounds 8 and 9 have no finding lines, so they come from the escalation lines and agree with the checkpoint |
| 5 | A second record of the same count, for [#124](https://github.com/brindlewick/postmaster/issues/124): its review checkpoint lists verified findings in a table of 20 rounds | **Disagrees.** The finding lines name no round from 5 to 18 and sum to 28. The checkpoint's table gives 11, 6, 5, 3, 6, 9, 8, 4, 4, 5, 5, 2, 5, 4, 3, 3, 4, 5, 1, 1, which is 94. The coachman's escalation line for each of rounds 5 to 18 gives the same number of severe findings as the table (round 5 says "1 P1-claim 5 P2" where the table reads 6 P2). For rounds 1 to 4 the lines and the table agree on rounds 3 and 4, and differ on round 1 (13 against 11) and round 2 (5 against 6) |
| 6 | A second record of the same count, for [#109](https://github.com/brindlewick/postmaster/issues/109): its checkpoint says rounds 4 to 8 fixed six, four, eight, three and one findings | Agrees for rounds 4, 5 and 6 (6, 4, 8), and says 3 and 1 where the lines say none and 2 for rounds 7 and 8. Round 11 has no finding lines and the checkpoint says 4 P2 stood |

What the disagreements mean: a count made from `finding` lines is a count of what the coachman logged as findings. Where the coachman wrote a round's findings into an escalation file or a checkpoint and not into finding lines, the count reads low. The count is therefore a floor, and for [#124](https://github.com/brindlewick/postmaster/issues/124) a floor at under a third of what the run's own record states. The lane audit's table has the same floor for [#124](https://github.com/brindlewick/postmaster/issues/124), since it reads the same lines.

## The postmaster's figures for [#202](https://github.com/brindlewick/postmaster/issues/202)

| Figure | The postmaster's | This count |
| --- | --- | --- |
| Severe findings per round, rounds 1 to 9 | 12, 4, 3, 2, 4, 1, 5, 1, 2 | the same |
| Gating findings, any severity, rounds 1 to 7 | 51 | 51 (20, 5, 4, 4, 6, 6, 6) |
| Of those, in a reader of shell command text | 28 | 29 by my reading of the finding's slug and target; 25 to 29 depending on four boundary findings (a refusal's attribution, two exemptions for what a lane may read, and file-tool paths). [run-202-gating.tsv](run-202-gating.tsv) lists each |

The last figure is a judgement about where a finding sits. It is within one of the postmaster's, and a second reader was not asked.

## The labels and the tags

| # | Control | Result |
| --- | --- | --- |
| 7 | Three readers labelled the 21 tickets, one with outcomes already seen and two given the texts alone | The two readers gave the same label on 18 of 21 (kappa 0.72) and the same flagged-or-not on 19 of 21 (kappa 0.81). This session and each reader: 13 of 21 (kappa 0.35 and 0.38) and 17 of 21 (0.61 and 0.62). [labels.md](labels.md) |
| 8 | Positive: the three runs the rules were written from, [#202](https://github.com/brindlewick/postmaster/issues/202), [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252) | Flagged by all three readers: this session `yes`, `yes`, `yes`; each reader `partly`, `partly`, `partly`. Not a test, since the rules were written from them |
| 9 | Negative: three tickets that ask for a measurement or a named check, [#158](https://github.com/brindlewick/postmaster/issues/158), [#159](https://github.com/brindlewick/postmaster/issues/159) and [#160](https://github.com/brindlewick/postmaster/issues/160) | `no` for all three readers on all three |
| 10 | Three readers tagged the mechanism of 99 late severe findings, from their logged text in a shuffled list | All three agree on 82 of 99 and at least two on all 99; kappa 0.84, 0.84 and 0.87 pairwise. [tail-findings.md](tail-findings.md) |
| 11 | The control for the tags: round 1 of the same nine runs, 92 severe findings, tagged by this session and one reader | Agreement 61 of 92, kappa 0.54, lower than for the late findings; the shares differ from the late rounds (M1 to M3 38% to 42% in round 1, 68% later), so the tags do not read the same everywhere |
| 12 | The tag counts add up | The by-run counts sum to 99 for the late findings and 92 for round 1, and each finding has one tag per reader |

One reader listed the readers' folder once before reading the brief's restriction; it reports that the listing showed file names and sizes and that it read nothing beyond the brief and the 21 ticket files.
