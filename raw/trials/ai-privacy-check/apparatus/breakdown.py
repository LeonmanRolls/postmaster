#!/usr/bin/env python3
"""Name, for each level, the labelled lines it missed and the ones it raised wrongly.

  breakdown.py <results-dir>     writes <results-dir>/breakdown.txt

Reads corpus.txt, mechanical.txt and the <level>-<n>.json files ai_check.py wrote. A level's
verdict on a line is its majority over its numbered calls. Lines are named by their corpus
name (a fixture's name and line, a probe's or an open-ended case's name), never their text.
"""
import collections
import json
import pathlib
import re
import sys


def main(args):
    if len(args) != 1:
        raise SystemExit("usage: breakdown.py <results-dir>")
    out = pathlib.Path(args[0])
    corpus = {}
    for row in (out / "corpus.txt").read_text().splitlines()[1:]:
        number, group, label, kind, name = row.split("\t")
        corpus[int(number)] = dict(group=group, label=label, kind=kind, name=name)
    verdicts = {"mechanical": {int(r.split("\t")[0]) for r in (out / "mechanical.txt").read_text().splitlines()
                               if r.split("\t")[1] != "-"}}
    calls = collections.defaultdict(list)
    for path in sorted(out.glob("*-*.json")):
        m = re.match(r"(.+)-(\d+)\.json$", path.name)
        if not m:
            continue
        record = json.loads(path.read_text())
        if isinstance(record["findings"], list):
            calls[m.group(1)].append({n for n, _k in record["findings"]})
    for level, runs in calls.items():
        votes = collections.Counter(n for run in runs for n in run)
        verdicts[level] = {n for n, v in votes.items() if v * 2 > len(runs)}
    lines = []
    for level, found in verdicts.items():
        missed = [c["name"] for n, c in sorted(corpus.items()) if c["label"] == "pos" and n not in found]
        raised = [c["name"] for n, c in sorted(corpus.items()) if c["label"] == "neg" and n in found]
        lines.append("## %s: %d positives missed, %d negatives raised" % (level, len(missed), len(raised)))
        lines.append("missed: " + (", ".join(missed) or "none"))
        lines.append("raised: " + (", ".join(raised) or "none"))
        lines.append("")
    (out / "breakdown.txt").write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1:])
