# What a ticket carried, against the rounds its run took

Spearman's rho over the runs that have the feature. A rank correlation is a rough guide at these sizes, and a ticket's size sets its criteria, its change and its first round together.

| Runs | Feature | n | rho with rounds | rho with round 1's serious findings |
| --- | --- | --- | --- | --- |
| all 61 | acceptance criteria | 61 | 0.43 | 0.47 |
| all 61 | decisions | 61 | -0.15 | -0.10 |
| all 61 | checks | 61 | -0.18 | -0.14 |
| all 61 | technical notes | 61 | -0.21 | -0.20 |
| all 61 | ticket length, characters | 61 | -0.01 | 0.04 |
| all 61 | lines changed before review | 61 | 0.23 | 0.28 |
| all 61 | files changed before review | 61 | 0.18 | 0.18 |
| all 61 | serious findings in round 1 | 61 | 0.83 | 1.00 |
| several workhorses | acceptance criteria | 46 | 0.28 | 0.35 |
| several workhorses | decisions | 46 | -0.04 | -0.01 |
| several workhorses | checks | 46 | -0.06 | -0.02 |
| several workhorses | technical notes | 46 | -0.04 | -0.02 |
| several workhorses | ticket length, characters | 46 | 0.24 | 0.33 |
| several workhorses | lines changed before review | 46 | 0.12 | 0.22 |
| several workhorses | files changed before review | 46 | 0.12 | 0.18 |
| several workhorses | serious findings in round 1 | 46 | 0.77 | 1.00 |
| single thread | acceptance criteria | 15 | 0.46 | 0.52 |
| single thread | decisions | 15 | -0.32 | -0.25 |
| single thread | checks | 15 | 0.46 | 0.52 |
| single thread | technical notes | 15 | -0.19 | -0.30 |
| single thread | ticket length, characters | 15 | -0.19 | -0.27 |
| single thread | lines changed before review | 15 | 0.64 | 0.36 |
| single thread | files changed before review | 15 | 0.11 | -0.13 |
| single thread | serious findings in round 1 | 15 | 0.81 | 1.00 |

## What a feature adds beyond round 1

| Feature | rho with rounds | rho with rounds, holding round 1's serious findings |
| --- | --- | --- |
| acceptance criteria | 0.43 | 0.08 |
| lines changed before review | 0.23 | -0.01 |
| decisions | -0.15 | -0.12 |
| checks | -0.18 | -0.11 |
| acceptance criteria, several workhorses (46 runs) | 0.28 | 0.02 |
| lines changed before review, several workhorses (46 runs) | 0.12 | -0.09 |
| acceptance criteria, single thread (15 runs) | 0.46 | 0.07 |
| lines changed before review, single thread (15 runs) | 0.64 | 0.64 |
| serious findings in round 1, holding criteria | 0.83 | 0.78 |

Rounds against all of a run's serious findings: rounds = 1.8 + 0.19 × serious findings by the Theil–Sen line, 2.1 + 0.18 × by least squares, over 61 runs. About five serious findings add a round.

## Rounds by the number of acceptance criteria

**all runs**

| Criteria | Runs | Rounds, median | Runs of 5 or more | Round 1 serious, median | Most |
| --- | --- | --- | --- | --- | --- |
| 1 to 3 | 8 | 2 | 0 | 0.5 | 2 |
| 4 to 5 | 21 | 3 | 5 | 3 | 13 |
| 6 to 8 | 17 | 4 | 8 | 3 | 20 |
| 9 or more | 15 | 4 | 6 | 4 | 9 |

**several workhorses**

| Criteria | Runs | Rounds, median | Runs of 5 or more | Round 1 serious, median | Most |
| --- | --- | --- | --- | --- | --- |
| 1 to 3 | 3 | 2 | 0 | 1 | 2 |
| 4 to 5 | 14 | 3.5 | 4 | 3.5 | 13 |
| 6 to 8 | 15 | 4 | 7 | 3 | 20 |
| 9 or more | 14 | 4 | 6 | 4.5 | 9 |

**single thread**

| Criteria | Runs | Rounds, median | Runs of 5 or more | Round 1 serious, median | Most |
| --- | --- | --- | --- | --- | --- |
| 1 to 3 | 5 | 2 | 0 | 0 | 2 |
| 4 to 5 | 7 | 2 | 1 | 3 | 6 |
| 6 to 8 | 2 | 5.5 | 1 | 4 | 9 |
| 9 or more | 1 | 2 | 0 | 1 | 2 |

## Rounds by lines changed before the first review

| Lines changed | Runs | Rounds, median | Runs of 5 or more | Round 1 serious, median | Most |
| --- | --- | --- | --- | --- | --- |
| under 400 | 8 | 3.5 | 3 | 2 | 5 |
| 400 to 999 | 22 | 2 | 4 | 2 | 20 |
| 1,000 to 2,499 | 18 | 3 | 6 | 3 | 13 |
| 2,500 or more | 13 | 4 | 6 | 5 | 13 |

## How the ticket was prepared

**one-part ticket, 34 runs, against two-part ticket, 12 runs**

| Measure | one-part ticket: median | two-part ticket: median | One-sided p that one-part ticket is higher |
| --- | --- | --- | --- |
| rounds | 4.0 (mean 5.0) | 3.0 (mean 4.1) | 0.266 |
| serious findings in round 1 | 4.0 (mean 5.3) | 4.0 (mean 4.4) | 0.308 |
| serious findings in all | 9.5 (mean 15.7) | 7.0 (mean 12.2) | 0.325 |
| acceptance criteria | 5.5 (mean 6.1) | 14.5 (mean 13.5) | 1.000 |
| lines changed before review | 825.5 (mean 2626.9) | 3382.5 (mean 3351.3) | 0.740 |
| serious findings per criterion | 2.1 (mean 2.4) | 0.4 (mean 0.9) | 0.009 |
| serious findings per 1,000 lines changed | 10.8 (mean 17.1) | 2.0 (mean 2.9) | 0.001 |

**several workhorses, one-part ticket, 34 runs, against single thread, two-part ticket, 15 runs**

| Measure | several workhorses, one-part ticket: median | single thread, two-part ticket: median | One-sided p that several workhorses, one-part ticket is higher |
| --- | --- | --- | --- |
| rounds | 4.0 (mean 5.0) | 2.0 (mean 2.8) | 0.010 |
| serious findings in round 1 | 4.0 (mean 5.3) | 1.0 (mean 2.2) | 0.005 |
| serious findings in all | 9.5 (mean 15.7) | 1.0 (mean 4.0) | 0.002 |
| acceptance criteria | 5.5 (mean 6.1) | 4.0 (mean 4.5) | 0.019 |
| lines changed before review | 825.5 (mean 2626.9) | 882.0 (mean 1231.9) | 0.331 |
| serious findings per criterion | 2.1 (mean 2.4) | 0.3 (mean 0.8) | 0.005 |
| serious findings per 1,000 lines changed | 10.8 (mean 17.1) | 1.3 (mean 3.1) | 0.000 |

Runs with 3 criteria or fewer took a median 2 rounds (8 runs, most 2); the rest 4 (53 runs). One-sided permutation p for the mean, 20,000 shuffles, seed 400: 0.0000.

# Tickets of five criteria or fewer, and more

The five-criteria rule of the booking clerk took effect on 2026-10-10. The rows count runs by what their ticket carried, whatever rule applied then. *Rounds above the median* sums, over the runs with more than five, the rounds each took above the median of the runs with five or fewer in the same set: an upper bound on what a split would have removed, since each slice has a first round and a clean round of its own.

| Set | Runs, five or fewer | Rounds, median | Runs of 6 or more | Runs, more than five | Rounds, median | Runs of 6 or more | Rounds above the median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The 61 runs | 29 | 3.0 (mean 3.3) | 3 of 29 | 32 | 4.0 (mean 5.1) | 9 of 32 | 76 |
| The later set | 13 | 3.0 (mean 2.9) | 1 of 13 | 5 | 6.0 (mean 7.2) | 3 of 5 | 21 |
