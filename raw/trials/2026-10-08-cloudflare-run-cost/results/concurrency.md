# How many launches ran at once

The 18 real runs that reached synthesis, whose records span 2026-09-28 to 2026-10-03. A launch is an
interval: a lane from the start of implementing to its exit; a reviewer from its round's first launch line to its own
exit; a gate run for its seconds, ending when it was logged; the coachman for each stage in which a leg can run, which
includes the wait for the user's spec review, so its row is an upper bound. The load of a set of launches is how many
cover each moment, over the one window that covers all of them. [method.md](../method.md) says what this leaves out:
fixture runs, other projects and the user's own sessions shared the machine.

| Launches | Most at once | Average at once | Time with 5 or more | Time with 10 or more |
| --- | --- | --- | --- | --- |
| workhorse lanes | 6 | 0.6 | 0% | 0% |
| reviewers | 12 | 1.0 | 6% | 2% |
| gate runs | 7 | 0.4 | 0% | 0% |
| lanes, reviewers and gates together | 12 | 2.0 | 13% | 2% |
| those and the coachman, whenever a run is in one of its stages | 24 | 6.1 | 48% | 28% |

Inside any one run, at most 5 lanes, reviewers and gate runs ran at once, and 6 with the
coachman's stages. The longest single coachman stage is 63.4 hours, waits included, and 7 stages ran longer
than 24 hours.
