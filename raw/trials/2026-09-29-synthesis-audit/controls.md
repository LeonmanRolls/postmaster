# Controls

Written by `measure.py` on 2026-09-29, from the same checkout and with the same fixture
repositories as [share.md](share.md).

## Self-test

`measure.py --self-test` checks the pure core on literal input, with no repository. It exited 0.

```
ok    five words make no run
ok    six words make one run
ok    seven words make two runs
ok    added lines, excluded files left out
ok    kinds
ok    attribution by lane
ok    attribution by kind
ok    a lane measured against itself: nothing second only, nothing in neither, some first only
ok    percent of nothing
```

## Each lane measured as though it were the synthesis

`measure.py --controls` measures each lane's own diff, from the run's base to its harvested
head, through the same code as the synthesis, with the same exclusions. Every run of words it
holds is in that lane's diff, so the other lane's only share and *neither* must read 0: the
negative controls. The lane's own only share must read above 0: the positive control. A fault
that applied an exclusion to one side only, swapped the lanes, or split words differently for
a synthesis and a lane would show here. The controls cannot show that a pinned commit is the
right one: that rests on the run records, as [method.md](method.md) says. It exited 0.

| run | luna as synthesis: luna only | mimo only | neither | behaved | mimo as synthesis: mimo only | luna only | neither | behaved |
|---|---:|---:|---:|---|---:|---:|---:|---|
| #18 | 10491 | 0 | 0 | yes | 6587 | 0 | 0 | yes |
| #38 | 6257 | 0 | 0 | yes | 25564 | 0 | 0 | yes |
| #80 | 1596 | 0 | 0 | yes | 2464 | 0 | 0 | yes |
| #81 | 2858 | 0 | 0 | yes | 3537 | 0 | 0 | yes |
| #105 | 4216 | 0 | 0 | yes | 3069 | 0 | 0 | yes |
| #106 | 33 | 0 | 0 | yes | 56 | 0 | 0 | yes |
| #108 | 1746 | 0 | 0 | yes | 2129 | 0 | 0 | yes |
| #109 | 83967 | 0 | 0 | yes | 107094 | 0 | 0 | yes |
| #112 | 611 | 0 | 0 | yes | 1189 | 0 | 0 | yes |
| #113 | 46 | 0 | 0 | yes | 2768 | 0 | 0 | yes |
| #114 | 3286 | 0 | 0 | yes | 2830 | 0 | 0 | yes |
| #116 | 2830 | 0 | 0 | yes | 2581 | 0 | 0 | yes |
| #121 | 1420 | 0 | 0 | yes | 2185 | 0 | 0 | yes |
| #122 | 5581 | 0 | 0 | yes | 5017 | 0 | 0 | yes |
| #124 | 3941 | 0 | 0 | yes | 5024 | 0 | 0 | yes |
| #135 | 2487 | 0 | 0 | yes | 2761 | 0 | 0 | yes |
| todo-fixture-1 | 798 | 0 | 0 | yes | 996 | 0 | 0 | yes |
| todo-fixture-2 | 813 | 0 | 0 | yes | 935 | 0 | 0 | yes |
| todo-fixture-3 | 1093 | 0 | 0 | yes | 1922 | 0 | 0 | yes |
| todo-fixture-4 | 645 | 0 | 0 | yes | 1051 | 0 | 0 | yes |
| todo-fixture-5 | 698 | 0 | 0 | yes | 1070 | 0 | 0 | yes |
| todo-fixture-6 | 638 | 0 | 0 | yes | 1259 | 0 | 0 | yes |
| todo-fixture-7 | 732 | 0 | 0 | yes | 866 | 0 | 0 | yes |
| todo-fixture-8 | 566 | 0 | 0 | yes | 1120 | 0 | 0 | yes |
| todo-fixture-9 | 696 | 0 | 0 | yes | 1044 | 0 | 0 | yes |
