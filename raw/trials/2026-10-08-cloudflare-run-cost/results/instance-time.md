# Container time per role

A launch is one lane, one reviewer, or one coachman leg. Each row is the time such a launch ran, from
the lane audit's derived data (`2026-10-03-lane-audit/results/runs.json`). [method.md](../method.md)
says what each column means and what it leaves out.

## Real runs (18 that reached synthesis)

| Role | Launches | Total hours | Median run, hours | Median launch, min | 90th percentile, min | Longest, min |
| --- | --- | --- | --- | --- | --- | --- |
| workhorse lanes | 36 | 65.8 | 2.1 | 64 | 140 | 906 |
| reviewers | 289 | 122.3 | 3.1 | 17 | 44 | 344 |
| gate runs on a lane's branch (inside the coachman) | 36 | 6.5 | 0.4 | 12 | 16 | 17 |
| gate runs on the synthesis (inside the coachman) | 260 | 43.5 | 2.1 | 12 | 16 | 21 |
| coachman, upper bound (stages a leg can run in) | 18 | 476.5 | 23.8 | – | – | – |

Lanes with no recorded time, left out above: 0.

## Fixture runs (24 that reached synthesis)

| Role | Launches | Total hours | Median run, hours | Median launch, min | 90th percentile, min | Longest, min |
| --- | --- | --- | --- | --- | --- | --- |
| workhorse lanes | 44 | 9.8 | 0.2 | 7 | 14 | 158 |
| reviewers | 192 | 24.9 | 0.9 | 2 | 20 | 153 |
| gate runs on a lane's branch (inside the coachman) | 42 | 0.0 | 0.0 | 0 | 0 | 0 |
| gate runs on the synthesis (inside the coachman) | 118 | 0.0 | 0.0 | 0 | 0 | 0 |
| coachman, upper bound (stages a leg can run in) | 24 | 46.4 | 1.6 | – | – | – |

Lanes with no recorded time, left out above: 4.

## Per run, real

| Run | Lanes, h | Reviewers, h | Gates on lanes, h | Gates on synthesis, h | Coachman upper bound, h |
| --- | --- | --- | --- | --- | --- |
| 110 | 2.1 | 3.5 | 0.4 | 2.4 | 12.9 |
| 158 | 1.9 | 2.3 | 0.4 | 1.5 | 19.5 |
| 159 | 1.0 | 1.5 | 0.4 | 1.2 | 18.0 |
| 160 | 1.7 | 1.5 | 0.4 | 1.2 | 3.7 |
| 163 | 2.2 | 2.9 | 0.4 | 3.0 | 26.4 |
| 165 | 4.7 | 2.9 | 0.0 | 3.0 | 26.8 |
| 170 | 3.0 | 8.5 | 0.4 | 1.3 | 31.1 |
| 179 | 1.8 | 2.2 | 0.4 | 2.9 | 16.8 |
| 182 | 3.2 | 1.5 | 0.5 | 1.4 | 10.7 |
| 200 | 2.4 | 3.2 | 0.2 | 1.8 | 7.0 |
| 201 | 1.2 | 2.2 | 0.5 | 0.8 | 28.9 |
| 57 | 3.1 | 9.7 | 0.4 | 3.3 | 36.2 |
| 75 | 0.9 | 2.3 | 0.4 | 1.7 | 4.1 |
| 98 | 2.0 | 9.9 | 0.5 | 1.7 | 21.3 |
| 109 | 27.8 | 13.4 | 0.1 | 5.9 | 62.1 |
| 122 | 3.1 | 13.0 | 0.4 | 2.4 | 39.6 |
| 124 | 2.0 | 15.7 | 0.3 | 4.7 | 43.1 |
| 135 | 1.8 | 25.9 | 0.2 | 3.4 | 68.2 |
