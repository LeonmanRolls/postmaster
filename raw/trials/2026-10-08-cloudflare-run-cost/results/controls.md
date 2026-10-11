# Controls

Each count in the trial has a control that reads non-zero or a known number and one that reads zero,
through the same code. `bun controls.ts` writes this file; `controls.test.ts` runs the same checks.

| | Kind | What | Expected | Got | Result |
| --- | --- | --- | --- | --- | --- |
| C1 | positive | gate runs on lane branches, counted through summarizeRole | 36 runs and 6.5 hours, as the lane audit published | 36 runs, 6.5 hours | pass |
| C2 | positive | gate runs on the synthesis, through the same code | 260 runs and 43.5 hours, as the lane audit published | 260 runs, 43.5 hours | pass |
| C3 | positive | one lane's implementSeconds against its start and finish timestamps (run 201, lane sol) | 2001 seconds both ways | field 2001, timestamps 2001 | pass |
| C4 | positive | that lane's container cost at standard-4, memory and disk only | 2001 x (12 x 0.0000025 + 20 x 0.00000007) = $0.0628314 | $0.0628314 | pass |
| C5 | negative | a run with no lanes, gates, stages or reviewers, through runTime and cost | 0 seconds in every role and $0 | 0 seconds, $0 | pass |
| C6 | positive | the coachman's floor (session uptime) against its ceiling (stage seconds), run by run | floor at most ceiling in all runs that have both | 14 of 14 runs | pass |
| C7 | negative | the same comparison with floor and ceiling swapped | it must fail in at least one run, or the comparison tells nothing | 14 of 14 runs fail when swapped | pass |
| C8 | positive | coachman tokens from the session exports (14 runs) | about 1478M in and 5253k out, as the lane audit published | 1478.0M in, 5253k out | pass |
| C9 | positive | codex reviewer tokens, input counting cache reads as codex reports it | 119 launches, about 240M in, 2934k out | 119 launches, 240.2M in, 2934k out | pass |
| C10 | positive | codex workhorse tokens | 18 launches, about 438M in, 2583k out | 18 launches, 438.1M in, 2583k out | pass |
| C11 | positive | MiMo uncached input, which is what the audit counted as input (the audit left out cache reads) | reviewers 118 launches and 17M, workhorses 18 launches and 7.8M | reviewers 118 and 17.1M, workhorses 18 and 7.8M | pass |
| C12 | positive | Opus reviewer launches and the dollars Claude Code reported | 71 launches and $644.17, as the lane audit published | 71 launches, $644.17 | pass |
| C13 | negative | a harness with no launches in the data (grok), through the same selection | 0 launches and 0 tokens | 0 launches | pass |
| C14 | positive | MiMo output differs from the audit's by its reasoning tokens, which the audit left out | more than the audit's 1019k reviewer output, since reasoning tokens are counted as output (how Xiaomi bills them is not stated, so this is an assumption) | 4510k | pass |
| C15 | positive | each Opus launch's reported dollars against its own tokens at the published Opus 5.5 prices, between all cache writes at 5 minutes and all at 1 hour | inside the bracket for every launch that used no other model | 61 of 61 launches (9 used another Claude model besides, 1 recorded no usage) | pass |
| C16 | negative | the same bracket with Opus 4.1's prices ($15 in, $75 out), which are not Opus 5.5's | the reported dollars fall inside for almost no launch | 0 launches | pass |
| C17 | positive | every price in prices.json names its page and the day it was read | none missing | 0 missing of 8 | pass |
| C19 | positive | the coachman's dollars at Meta's standard tier, summed launch by launch and recomputed from the summed tokens | the two agree to a cent | $330.89 and $330.89 (14 runs) | pass |
| C20 | negative | the same re-pricing for a model no launch used | the coachman's dollars do not move | $11.75 before and $11.75 after | pass |
| C18 | positive | median of the audit helper on a case worked by hand | median of 1, 2, 9 is 2 and of 1, 2, 3, 10 is 2.5 | 2 and 2.5 | pass |
| C21 | positive | the lanes' and reviewers' hours of all the runs at standard-3 with a quarter of the CPU busy, through cost() and as hours times the hourly rate | the two agree to a cent | $21.07 and $21.07 (188.1 hours) | pass |
| C22 | positive | the high end of all the runs together, against the same cost summed run by run | the two agree to within a millionth of a dollar | $74.4528 and $74.4528 | pass |
| C23 | negative | the totals over no runs, through the same code | $0 low, $0 high and an average of 0, not NaN | $0 low, $0 high, average 0 | pass |
| C24 | positive | the launches rebuilt as intervals from their timestamps, against the hours the instance-time tables summed from each launch's own seconds | the same total for lanes, reviewers, gate runs and the coachman's stages, to a second | 65.8, 122.3, 50.0 and 476.5 hours, against 65.8, 122.3, 50.0 and 476.5 | pass |
| C25 | positive | the average load over the window, times the window's seconds, against the sum of every interval's length | equal: the area under the load curve is the sum of the intervals | 714.61 and 714.61 hours | pass |
| C26 | negative | the load of no launches, through the same code | a peak of 0 and an average of 0 | peak 0, average 0 | pass |
| C27 | positive | Cloudflare's row in the provider table: a gate hour against the cost module's standard-4 hour, and a waiting-agent hour against its arithmetic by hand | $0.40104 and $0.05292, agreeing to a millionth of a dollar | $0.40104 against $0.40104, and $0.05292 against $0.05292 | pass |
| C28 | positive | the waiting-agent hours and the gate hours of all the runs, against every launch hour (lanes, reviewers and the coachman's ceiling) | the two add up to the same hours, since the gate is carved out of the coachman and counted once | 664.6 against 664.6 hours | pass |
| C29 | positive | Fly's performance-4x with 8 GB from the provider table's per-vCPU and per-GiB rates, against the $0.1833 an hour that Fly's pricing page prints for it and the per-second figure from the documentation's constants times 3600 | $0.1833 an hour all three ways, to a hundredth of a cent | $0.1833 against $0.1833 and $0.1833 | pass |
| C30 | negative | the same Fly price against an unchecked figure of $0.0001386 a second that had been given for it | far apart: the unchecked figure is 2.7 times the derived price | 0.499 against 0.183 an hour, a ratio of 2.72 | pass |
| C31 | negative | Daytona's default size limit of 4 vCPU and 8 GB against the 12 GiB gate profile, through the fit check | the gate does not fit and the waiting agent does | gate fits: false, agent fits: true | pass |
| C32 | positive | every row of the provider and machine tables names its page, the day it was read and how well it was checked | none missing | 0 missing of 22 | pass |
| C33 | positive | the runs a month that cost what Vultr's 4 vCPU and 8 GiB machine costs kept up all month, from the table's code against $40 over the median life rounded up to a whole hour at $0.055 | the same number, about 26 | 25.97 against 25.97 (median life 27.7 hours) | pass |
| C34 | negative | the same break-even for Azure Spot, which has no monthly price, through the same code | none, not zero and not NaN | null | pass |
| C35 | positive | the longest coachman stage and the number of stages over 24 hours, from the rebuilt intervals against the audit's own stage seconds | the same longest stage and the same count | 63.40 hours and 7 against 63.40 hours and 7 | pass |
| C36 | negative | a stage of exactly 24 hours, and one of 24 hours and a second, through the same count of stages over 24 hours | the first is not counted and the second is | 0 and 1 | pass |
| C37 | positive | the most lanes, reviewers and gate runs at once inside any one run, against the most at once across all the runs together | at least 1 and no more than the all-runs peak, since one run is part of the whole | 5 against 12 | pass |
