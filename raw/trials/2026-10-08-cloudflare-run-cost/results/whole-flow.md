# What a whole flow costs in the cloud

One ticket from the booking clerk to the merge, and a month of them, on Cloudflare's list rates, with agents sized to what
they use (a waiting agent is 1 vCPU and 4 GiB with a fifth of the CPU busy; a gate is 4 vCPU and 12 GiB with every vCPU
busy; see providers.md). The model bill is the same on any host and is left out. Nothing here was run on Cloudflare.
Every figure with two ends is bracketed, not known: the low end counts the coachman at its floor and a session awake
2 hours a day; the high end counts the coachman at its ceiling and a session awake 5.3 hours a day.

## What is measured and what is assumed

| Part | Where it comes from | Kind |
| --- | --- | --- |
| Launches of a run: lanes, reviewers, coachman legs, gate runs | The 18 audited real runs, from their records | Measured; the coachman's time is bracketed by its floor and its ceiling |
| The pace of tickets | The audited runs: 18 in 5.1 days of records is 107 a month. The merged pull requests whose title starts with a ticket number: 129 from 2026-09-26 to 2026-10-10, 258 a month, of which 55 fall in the audited runs' days, against 18 audited runs. It also counts hand-made, research and documentation pull requests, and leaves out runs that were set aside or never merged | Measured; two readings, neither exact |
| Open interactive sessions | 18 at one moment: 9 of the flow's own roles (the postmaster and the clerks) and 9 research and design sessions; 4 were working at that moment | A snapshot, not a time series |
| Hours each session is awake in a day | 2 is assumed; 4 of 18 working at the snapshot reads as 5.3. Neither is a measurement of a day | Assumed, and one reading |
| The control plane | The priced parts: 10,000 requests and 1,000 workflow steps, which are assumed counts, and the Durable Object in front of each container for the hours it is up. The stores are unpriced | Argued |

## One ticket

| Part | Typical ticket | Average ticket |
| --- | --- | --- |
| Launches | $1.32 to $2.13 | $1.66 to $2.92 |
| Control plane: requests, steps and the Durable Object in front of each container | $0.06 to $0.14 | $0.08 to $0.22 |
| The postmaster and the clerks, a share of 9 sessions at 107 tickets a month, asleep when idle | $0.30 to $0.79 | $0.30 to $0.79 |
| The same, kept up between turns | $2.75 to $2.87 | $2.75 to $2.87 |
| **A ticket, sessions asleep when idle** | **$1.68 to $3.06** | **$2.04 to $3.93** |
| **A ticket, sessions kept up** | **$4.13 to $5.15** | **$4.50 to $6.01** |

A session awake costs $0.0585 an hour and kept up and idle $0.0441 an hour (memory and disk, and the
Durable Object in front of the container). The 24 fixture runs in the same records cost about $0.18 each with the coachman at its
ceiling, $4.31 in all. 13 further real runs, set aside or never reaching synthesis, would add $5.82 with the coachman at its
ceiling, 11% of the audited runs' launches at their ceiling, and are in no figure here.

## A month

The 9 sessions of the flow's own roles: $31.6 to $84.3 a month asleep when idle,
$294 to $307 kept up. All 18 open sessions, research and design too: $63.2 to $169 and $588 to $614. The plan
fee is $5 a month. The number of sessions is not scaled with the number of tickets.

| Tickets a month | Launches only | With the sessions asleep when idle | With the sessions kept up |
| --- | --- | --- | --- |
| 20 | 39.9 to 67.8 | 71.5 to 152 | 334 to 375 |
| 107 | 191 to 340 | 223 to 424 | 485 to 647 |
| 258 | 455 to 815 | 487 to 899 | 749 to 1122 |

Tickets a month at which a flat monthly price costs the same (the example prices of the earlier tables):

| Flat price a month | Launches only | Sessions asleep when idle | Sessions kept up |
| --- | --- | --- | --- |
| $25 | 6 to 11 | never | never |
| $50 | 14 to 25 | up to 7 | never |
| $100 | 30 to 54 | 3 to 36 | never |
| $200 | 62 to 111 | 35 to 93 | never |

Awake hours a day, for the 9 sessions, with the sessions' month in dollars:

| Awake hours a day | Asleep when idle | Kept up |
| --- | --- | --- |
| 1 | 15.8 | 290 |
| 2 | 31.6 | 294 |
| 4 | 63.2 | 302 |
| 6 | 94.8 | 309 |
| 8 | 126 | 317 |

## Only the peaks

If the machine holds k launches at once (lanes, reviewers and gate runs) and the cloud takes the rest. The records' 5.1 days
held 238 launch-hours. The first column is the least that could go, if launches could move as the count rises and
falls. The second is a launch that starts while the machine is full going to the cloud and staying there. Lane and reviewer
hours are priced at $0.059 and gate hours at $0.407, each with its Durable Object. The coachman, one for each run in flight, is
not counted, nor is the plan fee.

| Launches the machine holds at once | Launch-hours above that, at least | Launch-hours sent to the cloud | Share of all launch-hours | Of them gate runs | Dollars a month at that pace |
| --- | --- | --- | --- | --- | --- |
| 2 | 99.3 | 123.3 | 52% | 18.3 h | 80.5 |
| 4 | 41.7 | 63.8 | 27% | 7.6 h | 37.9 |
| 6 | 16.7 | 27.9 | 12% | 2.6 h | 15.0 |
| 8 | 6.0 | 10.7 | 4% | 0.9 h | 5.60 |
