# Controls

Each row is a count run through the same code on a case that must read non-zero or agree, and on one that must read zero or differ, or a figure from a second record.

| | What | Positive | Negative |
| --- | --- | --- | --- |
| ok | serious findings by round from the finding lines equal the run's own card line | #335: lines read 7,3,2,1,1,2,2,1,0, its card's REVIEW line reads 7,3,2,1,1,2,2,1,0 | see the next row |
| ok | a run with finding lines and no gating P1 or P2 reads zero through the same command | the count above reads 19 for #335 | #265 has 11 finding lines, all style or P3, and reads 0; 5 runs read 0 |
| ok | rounds, round 1 and total agree with the lane audit's table | 17 of 18 runs agree on all three | #135: 5/11/44 here, 5/11/32 in the audit (severity in the target field, see method.md) |
| ok | a round after round 2 that follows a round with no serious finding line is silent | 7 runs hold one: #38 (5), #109 (7,11), #124 (5,6,7,8,9,10,11,12,13,14,15,16,17,18), #200 (3), #202 (8), #258 (2), #268 (5,6,7) | 54 runs hold none |
| ok | the commit named as the origin of a cited line adds that line, read with git show and not git blame | 296 of 316 later findings placed in a fix or in the change | 20 do not: the line was moved or reformatted after the commit, or the cited text is its own first line only |
