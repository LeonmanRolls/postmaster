# Stop signals

A *transition* is a point at which a loop went on: round r ended with its fixes in, and round r+1 ran. *Clean* means round r+1 held no serious finding. The signals and rules were fixed in `apparatus/signals.ts` before the later set was read.

## The 61 runs

61 runs, 199 transitions, of which 45 (23%) went to a clean round. A transition after round 1 is 141, of which 27 went to a clean round.

| Signal at the end of round r | Transitions where it holds | Next round clean there (95% interval) | Where it does not | Next round clean there |
| --- | --- | --- | --- | --- |
| the round has one serious finding | 42 | 50% (36–64%) | 157 | 15% |
| fewer serious findings than the round before | 84 | 21% (14–31%) | 115 | 23% |
| as many or more serious findings than the round before | 57 | 16% (9–27%) | 142 | 25% |
| the round's fixes changed 30 lines or fewer | 19 | 37% (19–59%) | 180 | 21% |
| the round's fixes changed no code, only words and tests | 6 | 0% (0–39%) | 193 | 23% |
| no serious finding of the round is a P1 | 131 | 31% (23–39%) | 47 | 11% |
| one lane alone named the round's findings, none was corroborated | 42 | 40% (27–56%) | 136 | 21% |
| at least half the round's findings are in lines an earlier fix wrote | 69 | 20% (12–31%) | 109 | 28% |
| a finding of the round is in a file an earlier round's serious finding was in | 109 | 21% (14–30%) | 69 | 32% |
| the two lanes' overlap estimates fewer than one more serious finding present | 98 | 32% (23–41%) | 80 | 18% |
| every finding of the round was in the change and not named before | 18 | 50% (29–71%) | 160 | 23% |
| five or more serious findings in the round (added after the first look) | 51 | 2% (0–10%) | 148 | 30% |

### Stopping rules, applied after each round to each run

| Rule | Runs where it fires early | Rounds it would save | Serious findings in the rounds it would skip | Runs it skips only clean rounds in | Rounds after a run's last serious finding |
| --- | --- | --- | --- | --- | --- |
| stop when the round has at most one serious finding and its fixes changed 30 lines or fewer | 11 of 61 | 18 | 14 | 5 of 11 | 49 |
| stop when the round has at most one serious finding and fewer than the round before | 21 of 61 | 47 | 59 | 9 of 21 | 49 |
| stop when the round's fixes changed no code, only words and tests | 4 of 61 | 26 | 85 | 0 of 4 | 49 |
| stop after round 2 when it had at most two serious findings | 15 of 61 | 24 | 21 | 9 of 15 | 49 |

## The later set (runs whose review ended after the first set was fixed)

18 runs, 56 transitions, of which 15 (27%) went to a clean round. A transition after round 1 is 39, of which 10 went to a clean round.

| Signal at the end of round r | Transitions where it holds | Next round clean there (95% interval) | Where it does not | Next round clean there |
| --- | --- | --- | --- | --- |
| the round has one serious finding | 16 | 38% (18–61%) | 40 | 23% |
| fewer serious findings than the round before | 22 | 27% (13–48%) | 34 | 26% |
| as many or more serious findings than the round before | 17 | 24% (10–47%) | 39 | 28% |
| the round's fixes changed 30 lines or fewer | 13 | 54% (29–77%) | 43 | 19% |
| the round's fixes changed no code, only words and tests | 2 | 50% (9–91%) | 54 | 26% |
| no serious finding of the round is a P1 | 48 | 29% (18–43%) | 8 | 13% |
| one lane alone named the round's findings, none was corroborated | 22 | 36% (20–57%) | 34 | 21% |
| at least half the round's findings are in lines an earlier fix wrote | 13 | 38% (18–64%) | 43 | 23% |
| a finding of the round is in a file an earlier round's serious finding was in | 34 | 24% (12–40%) | 22 | 32% |
| the two lanes' overlap estimates fewer than one more serious finding present | 35 | 31% (19–48%) | 21 | 19% |
| every finding of the round was in the change and not named before | 12 | 17% (5–45%) | 44 | 30% |
| five or more serious findings in the round (added after the first look) | 9 | 0% (0–30%) | 47 | 32% |

### Stopping rules, applied after each round to each run

| Rule | Runs where it fires early | Rounds it would save | Serious findings in the rounds it would skip | Runs it skips only clean rounds in | Rounds after a run's last serious finding |
| --- | --- | --- | --- | --- | --- |
| stop when the round has at most one serious finding and its fixes changed 30 lines or fewer | 8 of 18 | 14 | 14 | 5 of 8 | 17 |
| stop when the round has at most one serious finding and fewer than the round before | 8 of 18 | 29 | 64 | 3 of 8 | 17 |
| stop when the round's fixes changed no code, only words and tests | 2 of 18 | 3 | 3 | 1 of 2 | 17 |
| stop after round 2 when it had at most two serious findings | 9 of 18 | 30 | 59 | 3 of 9 | 17 |

## What the two lanes' overlap leaves unseen

For each run with two reviewer lanes that named a serious finding in round 1, the Chapman estimate of how many serious findings were present and unseen by both, summed, against the findings in the change that later rounds named and round 1 had not.

| Runs | With a pair and a round-1 finding | Of those, the lanes named nothing in common | Round-1 findings the pair named | Estimated left unseen | Findings in the change named in rounds 2 and after |
| --- | --- | --- | --- | --- | --- |
| The 61 runs | 53 | 23 | 244 | 102 | 147 |
| The later set | 15 | 7 | 57 | 11 | 56 |

## What a round's fix commits bring

A fix commit is an own commit made after a round was launched and before the next. The columns count the commits that changed at least one line, and those with a serious finding in lines they wrote in the next round or in any later round.

**The 61 runs**

| Fix commits of round | Commits | A serious finding in the next round | In any later round |
| --- | --- | --- | --- |
| 1 | 138 | 29 (21%) | 39 (28%) |
| 2 | 90 | 16 (18%) | 20 (22%) |
| 3 | 45 | 11 (24%) | 14 (31%) |
| 4 | 41 | 5 (12%) | 6 (15%) |
| 5 and after | 101 | 15 (15%) | 18 (18%) |

**The later set**

| Fix commits of round | Commits | A serious finding in the next round | In any later round |
| --- | --- | --- | --- |
| 1 | 51 | 5 (10%) | 7 (14%) |
| 2 | 19 | 1 (5%) | 3 (16%) |
| 3 | 15 | 0 (0%) | 2 (13%) |
| 4 | 7 | 0 (0%) | 1 (14%) |
| 5 and after | 39 | 2 (5%) | 4 (10%) |
