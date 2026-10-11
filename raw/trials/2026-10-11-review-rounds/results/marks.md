# The readers' marks of the later findings

382 later findings, 309 with text. Reader A marked 188, reader B 309, both 188.

| Mark | Same mark from both readers | Wilson 95% interval | Cohen's kappa |
| --- | --- | --- | --- |
| ticket open | 160 of 188 (85%) | 79–89% | 0.55 |
| disagrees | 187 of 188 (99%) | 97–100% | 0.92 |
| kind | 166 of 188 (88%) | 83–92% | 0.83 |

## Ticket open

| Reading | Findings | Share of the marked |
| --- | --- | --- |
| both readers say yes | 18 | 10% |
| at least one says yes | 43 | 23% |

## Kind

| Kind | Reader A | Reader B | Both the same |
| --- | --- | --- | --- |
| input | 90 | 172 | 88 |
| state | 32 | 58 | 31 |
| contract | 36 | 30 | 25 |
| site | 9 | 13 | 6 |
| prose | 11 | 14 | 9 |
| test | 3 | 6 | 3 |
| other | 7 | 16 | 4 |

## By how the run's ticket was prepared

| Group | Runs | Later findings marked | Ticket open, both readers | Ticket open, either | Both-reader findings per 100 criteria |
| --- | --- | --- | --- | --- | --- |
| A | 34 | 125 | 9 (7%) | 28 | 4 |
| B | 12 | 41 | 4 (10%) | 6 | 2 |
| C | 15 | 22 | 5 (23%) | 9 | 7 |

## By how the finding came to be found

| Group | Marked | Ticket open, both | Ticket open, either | Disagrees, either |
| --- | --- | --- | --- | --- |
| Made by the last round's fix | 62 | 4 | 18 | 3 |
| Missed: in the change as first reviewed, not named before | 77 | 10 | 16 | 2 |
| Outside the change: older than the run, or main's | 8 | 1 | 1 | 0 |
| Made by an older fix | 17 | 2 | 5 | 1 |
| The same lines named again | 5 | 1 | 3 | 1 |
| Unplaced: no line to read, or no history to read it in | 19 | 0 | 0 | 0 |

## Rounds a change would have removed

Each row removes the chosen findings and the ones that followed from them: a finding in lines a fix of a removed finding wrote, or in lines a removed finding named. *Strict* counts a round only where every serious finding of the run's last rounds is removed. *By the fitted relation* takes 0.18 rounds for each serious finding, from the 61 runs (rounds = 2.1 + 0.18 × serious findings, Theil–Sen slope 0.19).

| Change | Findings chosen | With what followed from them | Runs touched | Rounds removed, strict | Rounds removed, by the fitted relation |
| --- | --- | --- | --- | --- | --- |
| The ticket left it open (both readers) | 18 | 19 | 9 | 0 | 3 |
| The ticket left it open (either reader) | 43 | 46 | 13 | 3 | 8 |
| The same defect at one more place (kind site, both readers) | 6 | 7 | 4 | 0 | 1 |
| Two places that must agree do not (kind contract, both readers) | 25 | 26 | 9 | 3 | 5 |
| In lines outside the change | 18 | 19 | 10 | 4 | 3 |
| Made by an earlier fix, for comparison | 162 | 162 | 31 | 19 | 29 |
