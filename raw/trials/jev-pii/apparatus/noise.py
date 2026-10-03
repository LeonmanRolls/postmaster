#!/usr/bin/env python3
"""How far Jev's answers move between calls: compare the saved answers of corpus calls.

  noise.py <results-dir>

For each pair of calls named below, it counts the answers to the same question about the same
line that differ, and the largest difference. Pairs within one version measure the noise of
identical requests; v2 against v3 measures whether asking two more questions in the same
request moves the answers to the others, over the 60 lines and six questions both asked.
"""
import itertools
import json
import pathlib
import sys

PAIRS = [("v2/jev-1", "v2/jev-2"), ("v2/jev-1", "v2/jev-3"), ("v2/jev-2", "v2/jev-3"),
         ("v3/jev-1", "v3/jev-2"), ("v6/jev-1", "v6/jev-2"),
         ("v2/jev-1", "v3/jev-1"), ("v2/jev-2", "v3/jev-2")]


def answers(root, name):
    record = json.loads((root / (name + ".json")).read_text())
    return [dict(line) for line in record["nouls"]]


def main(args):
    if len(args) != 1:
        sys.exit(__doc__)
    root = pathlib.Path(args[0])
    print("calls compared            answers  differ  largest difference")
    for first, second in PAIRS:
        a, b = answers(root, first), answers(root, second)
        pairs = [(x[k], y[k]) for x, y in zip(a, b) for k in x if k in y]
        differ = [abs(p - q) for p, q in pairs if p != q]
        print("%-25s %-8d %-7d %.2f" % (first + " " + second, len(pairs), len(differ), max(differ, default=0)))
    flips = 0
    total = 0
    for first, second in itertools.combinations(["v2/jev-1", "v2/jev-2", "v2/jev-3"], 2):
        for x, y in zip(answers(root, first), answers(root, second)):
            for k in x:
                if k in y:
                    total += 1
                    flips += (x[k] >= 0.5) != (y[k] >= 0.5)
    print("\nv2's three calls, pairwise: %d of %d answers fall on opposite sides of 0.5" % (flips, total))


if __name__ == "__main__":
    main(sys.argv[1:])
