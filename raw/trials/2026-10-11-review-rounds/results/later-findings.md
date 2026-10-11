# What the findings after round 1 are made of

382 serious findings name round 2 or later in the 61 runs. Each is put in the first group of [rule.md](../rule.md) that applies, by where `git blame` says the cited lines came from. 94 more serious findings are counted by round from the runs' own cards and cannot be traced one by one; they are in no group.

| Group | All | A | B | C | Round 2 | Round 3 | Round 4 | Round 5 or later |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Missed: in the change as first reviewed, not named before | 149 (39%) | 86 | 52 | 11 | 71 | 35 | 14 | 29 |
| Missed: in the change, and no reviewer of its lens had run | 0 (0%) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Made by the last round's fix | 113 (30%) | 90 | 16 | 7 | 44 | 24 | 15 | 30 |
| Made by an older fix | 49 (13%) | 34 | 10 | 5 | 0 | 11 | 11 | 27 |
| Outside the change: older than the run, or main's | 18 (5%) | 15 | 1 | 2 | 7 | 6 | 4 | 1 |
| The same lines named again | 6 (2%) | 3 | 1 | 2 | 3 | 3 | 0 | 0 |
| Unplaced: no line to read, or no history to read it in | 47 (12%) | 46 | 1 | 0 | 4 | 13 | 17 | 13 |
| All later findings | 382 | 274 | 81 | 27 | 129 | 92 | 61 | 100 |

Of the 335 that could be placed, 162 (48%) are in lines an earlier round's fix wrote, 149 (44%) were in the change when round 1 reviewed it and no round had named them, and 18 (5%) are outside the change.

## In the long runs and the short ones

| Group | Runs of six rounds or more | Runs of fewer |
| --- | --- | --- |
| Missed: in the change as first reviewed, not named before | 85 (38%) | 64 (41%) |
| Made by the last round's fix | 74 (33%) | 39 (25%) |
| Made by an older fix | 41 (18%) | 8 (5%) |
| Outside the change: older than the run, or main's | 2 (1%) | 16 (10%) |
| The same lines named again | 4 (2%) | 2 (1%) |
| Unplaced: no line to read, or no history to read it in | 19 (8%) | 28 (18%) |

15 of the later findings are a re-log: their target text was already a serious finding in an earlier round of the same run.
