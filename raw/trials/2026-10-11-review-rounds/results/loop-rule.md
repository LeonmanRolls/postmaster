# The rule the review loop ran under

A run is pinned at dispatch to a postmaster commit and runs the loop that commit carries. The rule is read from whether the pinned commit holds the change that made the decision a script with a cap of three rounds, and the change that made the loop go on until a round finds more than the one before.

## The 61 runs

| Rule | Runs | Rounds | Rounds, median | Most | Runs past three rounds | Round 1 serious, median |
| --- | --- | --- | --- | --- | --- | --- |
| Goes on until a round finds nothing and applies no change, a cap of three rounds, before the script of 29 September | 13 | 89 | 5.0 | 20 | 11 | 8.0 |
| Round 2 after a round 1 that applied a fix, then another round only after a round with a verified P1 or P2, a cap of three rounds (the script of #80, merged 29 September) | 42 | 154 | 3.0 | 13 | 15 | 2.5 |
| Goes on while a round finds no more than the one before, a rise stops it for a ruling, no cap (#316, merged 9 October) | 6 | 17 | 2.5 | 6 | 1 | 3.0 |

## The later set

| Rule | Runs | Rounds | Rounds, median | Most | Runs past three rounds | Round 1 serious, median |
| --- | --- | --- | --- | --- | --- | --- |
| Goes on until a round finds nothing and applies no change, a cap of three rounds, before the script of 29 September | 0 | 0 | – | – | 0 | – |
| Round 2 after a round 1 that applied a fix, then another round only after a round with a verified P1 or P2, a cap of three rounds (the script of #80, merged 29 September) | 1 | 15 | 15.0 | 15 | 1 | 5.0 |
| Goes on while a round finds no more than the one before, a rise stops it for a ruling, no cap (#316, merged 9 October) | 17 | 59 | 3.0 | 7 | 7 | 3.0 |

## Group against rule, The 61 runs

| Group | until-clean | scripted-cap | rise |
| --- | --- | --- | --- |
| A one-part ticket, several workhorses | 13 | 21 | 0 |
| B two-part ticket, several workhorses | 0 | 12 | 0 |
| C two-part ticket, single thread | 0 | 9 | 6 |

## Group A split at the script of 29 September, against B and C

| Group | Runs | Rounds | Rounds, median (mean) | Round 1 serious, median | Serious in all, median | Criteria, median | Lines changed, median | Serious per criterion, median | Serious per 1,000 lines, median |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A, all | 34 | 169 | 4.0 (5.0) | 4.0 | 9.5 | 5.5 | 838 | 2.1 | 10.8 |
| A, before the script | 13 | 89 | 5.0 (6.8) | 8.0 | 18.0 | 6.0 | 850 | 3.0 | 19.3 |
| A, from the script | 21 | 80 | 3.0 (3.8) | 3.0 | 5.0 | 5.0 | 838 | 0.8 | 5.2 |
| B | 12 | 49 | 3.0 (4.1) | 4.0 | 7.0 | 14.5 | 3383 | 0.4 | 2.0 |
| C | 15 | 42 | 2.0 (2.8) | 1.0 | 1.0 | 4.0 | 882 | 0.3 | 1.3 |

**one-part ticket from the script, 21 runs, against two-part ticket, 12 runs**

| Measure | one-part ticket from the script: median | two-part ticket: median | One-sided p that one-part ticket from the script is higher |
| --- | --- | --- | --- |
| rounds | 3.0 (mean 3.8) | 3.0 (mean 4.1) | 0.651 |
| serious findings in round 1 | 3.0 (mean 3.5) | 4.0 (mean 4.4) | 0.800 |
| serious findings in all | 5.0 (mean 7.7) | 7.0 (mean 12.2) | 0.885 |
| acceptance criteria | 5.0 (mean 5.4) | 14.5 (mean 13.5) | 1.000 |
| lines changed before review | 838.0 (mean 1538.9) | 3382.5 (mean 3351.3) | 0.994 |
| serious findings per criterion | 0.8 (mean 1.4) | 0.4 (mean 0.9) | 0.117 |
| serious findings per 1,000 lines changed | 5.2 (mean 9.0) | 2.0 (mean 2.9) | 0.010 |

**one-part ticket before the script, 13 runs, against one-part ticket from the script, 21 runs**

| Measure | one-part ticket before the script: median | one-part ticket from the script: median | One-sided p that one-part ticket before the script is higher |
| --- | --- | --- | --- |
| rounds | 5.0 (mean 6.8) | 3.0 (mean 3.8) | 0.015 |
| serious findings in round 1 | 8.0 (mean 8.1) | 3.0 (mean 3.5) | 0.002 |
| serious findings in all | 18.0 (mean 28.7) | 5.0 (mean 7.7) | 0.001 |
| acceptance criteria | 6.0 (mean 7.2) | 5.0 (mean 5.4) | 0.018 |
| lines changed before review | 849.5 (mean 4749.9) | 838.0 (mean 1538.9) | 0.308 |
| serious findings per criterion | 3.0 (mean 4.0) | 0.8 (mean 1.4) | 0.003 |
| serious findings per 1,000 lines changed | 19.3 (mean 31.3) | 5.2 (mean 9.0) | 0.004 |

**one-part ticket from the script, 21 runs, against two-part ticket, single thread, 15 runs**

| Measure | one-part ticket from the script: median | two-part ticket, single thread: median | One-sided p that one-part ticket from the script is higher |
| --- | --- | --- | --- |
| rounds | 3.0 (mean 3.8) | 2.0 (mean 2.8) | 0.118 |
| serious findings in round 1 | 3.0 (mean 3.5) | 1.0 (mean 2.2) | 0.083 |
| serious findings in all | 5.0 (mean 7.7) | 1.0 (mean 4.0) | 0.076 |
| acceptance criteria | 5.0 (mean 5.4) | 4.0 (mean 4.5) | 0.142 |
| lines changed before review | 838.0 (mean 1538.9) | 882.0 (mean 1231.9) | 0.285 |
| serious findings per criterion | 0.8 (mean 1.4) | 0.3 (mean 0.8) | 0.101 |
| serious findings per 1,000 lines changed | 5.2 (mean 9.0) | 1.3 (mean 3.1) | 0.010 |

## Round 1 as a warning: five or more serious findings in round 1

| Set | Runs | Rounds | Runs flagged | Rounds in them | Runs of 6 or more | Of them, flagged | Rounds, median, flagged | Rounds, median, not flagged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The 61 runs | 61 | 260 | 22 | 147 | 12 | 10 | 5.0 | 2.0 |
| The later set | 18 | 74 | 5 | 39 | 4 | 4 | 6.0 | 3.0 |
| The 61 runs, before the script | 13 | 89 | 9 | 71 | 5 | 4 | 5.0 | 4.0 |
| The 61 runs, from the script | 48 | 171 | 13 | 76 | 7 | 6 | 5.0 | 2.0 |

## The rule in force, replayed over each run's serious findings per round

A round that logged more serious findings than the round before is a rise. Under the rule in force a rise stops the loop for a ruling, an equal or lower count goes on and a round with none ends it. What followed a rise in these runs is what the rule then in force led to.

| Set | Runs | Rose | First rise at round 2 | at round 3 | at round 4 | at round 5 or later | Rounds, median, rose | Rounds, median, never rose | Runs of 6 or more | Of them, rose | Rounds after a first rise | All rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The 61 runs | 61 | 16 | 4 | 3 | 3 | 6 | 7.0 | 3.0 | 12 | 9 | 61 | 260 |
| The later set | 18 | 6 | 1 | 3 | 2 | 0 | 6.0 | 2.5 | 4 | 4 | 23 | 74 |
