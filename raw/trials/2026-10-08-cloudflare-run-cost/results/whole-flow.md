# What a whole flow costs in the cloud

One ticket from the booking clerk to the merge, and a month of them, on Cloudflare's list rates, with agents sized to what
they use (a waiting agent is 1 vCPU and 4 GiB with a fifth of the CPU busy; a gate is 4 vCPU and 12 GiB with every vCPU
busy; see providers.md). The model bill is the same on any host and is left out. Nothing here was run on Cloudflare.

## What is measured and what is assumed

| Part | Where it comes from | Kind |
| --- | --- | --- |
| Launches of a run: lanes, reviewers, coachman legs, gate runs | The 18 audited real runs, from their records | Measured; the coachman's time is bracketed |
| The pace of tickets | The audited runs: 18 in 5.1 days of records is 107 a month. The merged pull requests whose title starts with a ticket number: 132 from 2026-09-26 to 2026-10-11, 248 a month, of which 55 fall in the audited runs' days, against 18 audited runs; it also counts hand-made, research and documentation pull requests, so it is an upper bound | Measured; two bounds |
| Open interactive sessions | 18 at one moment: 9 of the flow's own roles (the postmaster and the clerks) and 9 research and design sessions | A snapshot, not a time series |
| Hours each session is awake in a day | 2, with 1 and 4 shown in the sensitivity table | Assumed |
| The control plane | The priced parts, 0.01 dollars for 10,000 requests and 1,000 workflow steps; the stores are unpriced; $0.05 is assumed | Argued |

## One ticket

| Part | Typical ticket | Average ticket |
| --- | --- | --- |
| Launches | $1.32 to $2.13 | $2.92 |
| Control plane (assumed) | $0.05 | $0.05 |
| The postmaster and the clerks, a share at 107 tickets a month, asleep when idle | $0.27 | $0.27 |
| The same, kept up between turns | $2.41 | $2.41 |
| **A ticket, sessions asleep when idle** | **$1.64 to $2.45** | **$3.24** |
| **A ticket, sessions kept up** | **$3.78 to $4.59** | **$5.38** |

A session awake costs $0.0529 an hour and kept up and idle $0.0385 an hour (memory and disk). The
24 fixture runs in the same records cost about $0.18 each with the coachman at its ceiling, $4.31 in all.

## A month

The 9 sessions of the flow's own roles, each awake 2 hours a day: $28.6 a month asleep when idle,
$257 kept up. All 18 open sessions, research and design too: $57.2 and $515. The plan fee is $5 a month. A ticket's own
compute is $2.97 (the average run and the assumed control plane).

| Tickets a month | Launches only | With the sessions asleep when idle | With the sessions kept up |
| --- | --- | --- | --- |
| 20 | 64.4 | 93.0 | 322 |
| 107 | 322 | 351 | 580 |
| 248 | 740 | 769 | 998 |

Tickets a month at which a flat monthly price costs the same:

| Flat price a month | Launches only | Sessions asleep when idle | Sessions kept up |
| --- | --- | --- | --- |
| $25 | 6 | never | never |
| $50 | 15 | 5 | never |
| $100 | 31 | 22 | never |
| $200 | 65 | 56 | never |

Awake hours a day, for the 9 sessions, with the sessions' month in dollars:

| Awake hours a day | Asleep when idle | Kept up |
| --- | --- | --- |
| 1 | 14.3 | 253 |
| 2 | 28.6 | 257 |
| 4 | 57.2 | 265 |

## Only the peaks

If the machine holds k launches at once (lanes, reviewers and gate runs) and the cloud takes the rest. The records' 5.1 days
held 238 launch-hours; a launch-hour is priced at $0.126, the mix of waiting-agent and gate hours in the records.
The coachman, one for each run in flight, is not counted.

| Launches the machine holds at once | Launch-hours in the cloud | Share of all launch-hours | Dollars in the records' span | Dollars a month at that pace |
| --- | --- | --- | --- | --- |
| 2 | 99.3 | 42% | 12.5 | 74.3 |
| 4 | 41.7 | 18% | 5.26 | 31.2 |
| 6 | 16.7 | 7% | 2.10 | 12.5 |
| 8 | 6.0 | 3% | 0.76 | 4.51 |
