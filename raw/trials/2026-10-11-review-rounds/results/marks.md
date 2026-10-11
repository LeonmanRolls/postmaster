# The readers' marks of the later findings

382 later findings, 309 with text. Reader A marked 279, reader B 309, both 279.

| Mark | Same mark from both readers | Wilson 95% interval | Cohen's kappa |
| --- | --- | --- | --- |
| ticket open | 240 of 279 (86%) | 81–90% | 0.57 |
| disagrees | 277 of 279 (99%) | 97–100% | 0.87 |
| kind | 248 of 279 (89%) | 85–92% | 0.83 |

## Ticket open

| Reading | Findings | Share of the marked |
| --- | --- | --- |
| both readers say yes | 26 | 9% |
| at least one says yes | 61 | 22% |

## Kind

| Kind | Reader A | Reader B | Both the same |
| --- | --- | --- | --- |
| input | 142 | 172 | 138 |
| state | 52 | 58 | 50 |
| contract | 43 | 30 | 27 |
| site | 14 | 13 | 11 |
| prose | 13 | 14 | 10 |
| test | 4 | 6 | 4 |
| other | 11 | 16 | 8 |

## By how the run's ticket was prepared

| Group | Runs | Later findings marked | Ticket open, both readers | Ticket open, either | Both-reader findings per 100 criteria |
| --- | --- | --- | --- | --- | --- |
| A | 34 | 198 | 16 (8%) | 43 | 8 |
| B | 12 | 58 | 5 (9%) | 9 | 3 |
| C | 15 | 23 | 5 (22%) | 9 | 7 |

## By how the finding came to be found

| Group | Marked | Ticket open, both | Ticket open, either | Disagrees, either |
| --- | --- | --- | --- | --- |
| Made by the last round's fix | 78 | 4 | 20 | 4 |
| Missed: in the change as first reviewed, not named before | 106 | 16 | 24 | 2 |
| Outside the change: older than the run, or main's | 15 | 2 | 2 | 0 |
| Made by an older fix | 28 | 3 | 7 | 1 |
| The same lines named again | 5 | 1 | 3 | 1 |
| Unplaced: no line to read, or no history to read it in | 47 | 0 | 5 | 1 |

## Rounds a change would have removed

Each row removes the chosen findings and the ones that followed from them: a finding in lines a fix of a removed finding wrote, or in lines a removed finding named. *Strict* counts a round only where every serious finding of the run's last rounds is removed. *By the fitted relation* takes 0.18 rounds for each serious finding, from the 61 runs (rounds = 2.1 + 0.18 × serious findings, Theil–Sen slope 0.19).

| Change | Findings chosen | With what followed from them | Runs touched | Rounds removed, strict | Rounds removed, by the fitted relation |
| --- | --- | --- | --- | --- | --- |
| The ticket left it open (both readers) | 26 | 28 | 15 | 1 | 5 |
| The ticket left it open (either reader) | 61 | 65 | 20 | 4 | 12 |
| The same defect at one more place (kind site, both readers) | 11 | 12 | 7 | 0 | 2 |
| Two places that must agree do not (kind contract, both readers) | 27 | 28 | 11 | 3 | 5 |
| In lines outside the change | 18 | 19 | 10 | 4 | 3 |
| Made by an earlier fix, for comparison | 162 | 162 | 31 | 19 | 29 |
