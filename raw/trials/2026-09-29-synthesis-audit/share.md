# Shares

Written by `measure.py` on 2026-09-29, run from a checkout of this repository that holds the
lane branches, as `measure.py --fixture todo-fixture-1=<repo> ... --fixture todo-fixture-9=<repo>`,
each `<repo>` the fixture repository that run was dispatched against. It exited 0.

A run of six words is counted once for each place it occurs in the synthesis's added lines.
*First only* is found in the diff of the lane the SYNTHESIS line ranks first and not in the
other's; *second only* the reverse; *both* in both lanes' diffs; *neither* in no lane's diff,
so written in the synthesis itself. Each lane's diff runs from the run's base to its harvested
head. The oracle's files, `WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md` and `BASE-CONTROLS`
are left out on every side. [method.md](method.md) says why, and what the numbers cannot show.

## By run

| run | ranked first | second | runs of six words | first only | second only | both | neither |
|---|---|---|---:|---:|---:|---:|---:|
| #18 | luna | mimo | 9580 | 70% | 19% | 3% | 8% |
| #38 | mimo | luna | 11838 | 47% | 36% | 4% | 14% |
| #80 | mimo | luna | 2831 | 75% | 7% | 5% | 13% |
| #81 | mimo | luna | 4996 | 69% | 25% | 4% | 3% |
| #105 | luna | mimo | 4647 | 84% | 2% | 4% | 10% |
| #106 | mimo | luna | 153 | 37% | 0% | 63% | 0% |
| #108 | mimo | luna | 2550 | 70% | 1% | 9% | 20% |
| #109 | luna | mimo | 128663 | 12% | 73% | 12% | 3% |
| #112 | luna | mimo | 1148 | 33% | 31% | 8% | 27% |
| #113 | mimo | luna | 79 | 42% | 14% | 44% | 0% |
| #114 | luna | mimo | 4042 | 3% | 65% | 4% | 28% |
| #116 | luna | mimo | 3094 | 86% | 1% | 4% | 10% |
| #121 | mimo | luna | 2485 | 71% | 0% | 0% | 28% |
| #122 | luna | mimo | 7384 | 53% | 24% | 4% | 18% |
| #124 | luna | mimo | 4911 | 52% | 27% | 8% | 13% |
| #135 | luna | mimo | 4201 | 27% | 7% | 0% | 66% |
| todo-fixture-1 | luna | mimo | 1331 | 21% | 52% | 15% | 12% |
| todo-fixture-2 | mimo | luna | 1491 | 62% | 12% | 22% | 4% |
| todo-fixture-3 | mimo | luna | 2526 | 50% | 10% | 13% | 27% |
| todo-fixture-4 | mimo | luna | 1305 | 74% | 2% | 17% | 8% |
| todo-fixture-5 | mimo | luna | 1311 | 59% | 16% | 18% | 6% |
| todo-fixture-6 | mimo | luna | 1456 | 82% | 2% | 14% | 2% |
| todo-fixture-7 | luna | mimo | 972 | 37% | 19% | 22% | 22% |
| todo-fixture-8 | mimo | luna | 972 | 75% | 2% | 18% | 4% |
| todo-fixture-9 | luna | mimo | 1261 | 35% | 41% | 17% | 7% |

## By kind

*Docs* are `.md` and `.txt` files and anything under `wiki/` or `raw/`; *tests* are files under a
`test/` or `tests/` folder or named `*.test.*` or `*.spec.*`, which only the fixture runs have;
*code* is the rest. A script's `--self-test` is part of the script, so it counts as code.

| run | kind | runs of six words | first only | second only | both | neither |
|---|---|---:|---:|---:|---:|---:|
| #18 | code | 7243 | 81% | 7% | 3% | 10% |
| #18 | docs | 2337 | 37% | 59% | 1% | 3% |
| #38 | code | 4410 | 7% | 77% | 4% | 11% |
| #38 | docs | 7428 | 70% | 11% | 3% | 16% |
| #80 | code | 1712 | 82% | 0% | 1% | 16% |
| #80 | docs | 1119 | 63% | 18% | 12% | 7% |
| #81 | code | 1622 | 26% | 68% | 6% | 0% |
| #81 | docs | 3374 | 89% | 4% | 3% | 4% |
| #105 | code | 3825 | 86% | 1% | 3% | 10% |
| #105 | docs | 822 | 73% | 9% | 8% | 10% |
| #106 | docs | 153 | 37% | 0% | 63% | 0% |
| #108 | code | 1397 | 74% | 0% | 3% | 22% |
| #108 | docs | 1153 | 66% | 2% | 16% | 16% |
| #109 | code | 128593 | 12% | 73% | 12% | 3% |
| #109 | docs | 70 | 7% | 66% | 16% | 11% |
| #112 | code | 1028 | 34% | 29% | 7% | 30% |
| #112 | docs | 120 | 26% | 49% | 22% | 2% |
| #113 | docs | 79 | 42% | 14% | 44% | 0% |
| #114 | code | 3166 | 0% | 68% | 1% | 31% |
| #114 | docs | 876 | 15% | 53% | 13% | 19% |
| #116 | code | 2795 | 85% | 1% | 4% | 10% |
| #116 | docs | 299 | 95% | 0% | 1% | 4% |
| #121 | code | 2000 | 76% | 0% | 0% | 23% |
| #121 | docs | 485 | 50% | 2% | 0% | 48% |
| #122 | code | 6375 | 61% | 18% | 2% | 19% |
| #122 | docs | 1009 | 4% | 64% | 17% | 15% |
| #124 | code | 2477 | 33% | 45% | 7% | 15% |
| #124 | docs | 2434 | 71% | 9% | 8% | 12% |
| #135 | code | 4103 | 28% | 6% | 0% | 66% |
| #135 | docs | 98 | 5% | 46% | 0% | 49% |
| todo-fixture-1 | code | 348 | 45% | 17% | 20% | 17% |
| todo-fixture-1 | tests | 975 | 12% | 65% | 13% | 11% |
| todo-fixture-1 | docs | 8 | 0% | 100% | 0% | 0% |
| todo-fixture-2 | code | 370 | 81% | 0% | 19% | 0% |
| todo-fixture-2 | tests | 1083 | 58% | 14% | 23% | 5% |
| todo-fixture-2 | docs | 38 | 0% | 79% | 0% | 21% |
| todo-fixture-3 | code | 835 | 48% | 7% | 9% | 37% |
| todo-fixture-3 | tests | 1670 | 51% | 11% | 16% | 22% |
| todo-fixture-3 | docs | 21 | 0% | 100% | 0% | 0% |
| todo-fixture-4 | code | 413 | 63% | 5% | 16% | 16% |
| todo-fixture-4 | tests | 884 | 78% | 0% | 18% | 4% |
| todo-fixture-4 | docs | 8 | 100% | 0% | 0% | 0% |
| todo-fixture-5 | code | 358 | 50% | 6% | 38% | 5% |
| todo-fixture-5 | tests | 915 | 62% | 20% | 11% | 7% |
| todo-fixture-5 | docs | 38 | 82% | 16% | 0% | 3% |
| todo-fixture-6 | code | 381 | 55% | 9% | 31% | 5% |
| todo-fixture-6 | tests | 1066 | 92% | 0% | 8% | 0% |
| todo-fixture-6 | docs | 9 | 67% | 0% | 0% | 33% |
| todo-fixture-7 | code | 324 | 59% | 5% | 27% | 9% |
| todo-fixture-7 | tests | 645 | 26% | 26% | 19% | 29% |
| todo-fixture-7 | docs | 3 | 0% | 100% | 0% | 0% |
| todo-fixture-8 | code | 393 | 69% | 3% | 27% | 1% |
| todo-fixture-8 | tests | 573 | 81% | 0% | 12% | 7% |
| todo-fixture-8 | docs | 6 | 0% | 100% | 0% | 0% |
| todo-fixture-9 | code | 333 | 62% | 12% | 24% | 1% |
| todo-fixture-9 | tests | 887 | 26% | 49% | 16% | 10% |
| todo-fixture-9 | docs | 41 | 0% | 100% | 0% | 0% |
