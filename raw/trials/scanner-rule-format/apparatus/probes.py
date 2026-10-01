#!/usr/bin/env python3
"""Probe #135's scanner, whole pipeline, with lines a library would have to handle.

  probes.py <source>      <source> as load.py takes it

Each probe is a line built here from fragments, so no committed file holds it, and each
gap is paired with a control the scanner does find, so a probe that finds nothing is a
statement about the scanner and not about this script. Prints one line per probe:
its name, what it stands for, and the rules the scanner reported, never the line.
"""
import base64
import json
import pathlib
import random
import subprocess
import sys

HERE = pathlib.Path(__file__).parent


def probes():
    rng = random.Random(208)
    blob = base64.b64encode(bytes(rng.randrange(256) for _ in range(600))).decode()
    home = "/" + "home" + "/" + "fixture-413" + "/notes.txt"
    vendor = "Clau" + "de"
    return [
        ("trailer", "control: an assistant co-author trailer",
         "Co-Authored" + "-By: " + vendor + " <noreply@" + "anthropic.com>"),
        ("pr-default", "Claude Code's documented default pull-request attribution line",
         "This pull request was generated with assistance from " + vendor + "."),
        ("pr-footer", "the pull-request footer Claude Code has long written",
         "\U0001F916 Generated with [" + vendor + " Code](https://claude.com/claude-code)"),
        ("pr-footer-plain", "the same footer without its emoji",
         "Generated with [" + vendor + " Code](https://claude.com/claude-code)"),
        ("json-depth-1", "control: a home path after an escaped newline in a JSON string",
         json.dumps({"text": "notes\n" + home})),
        ("json-depth-2", "the same path one JSON level deeper, a document held in a string",
         json.dumps({"content": json.dumps({"text": "notes\n" + home})})),
        ("thinking-signature", "a thinking block whose reasoning is only in its encrypted signature",
         json.dumps({"type": "thinking", "thinking": "", "signature": blob})),
        ("reasoning-encrypted", "a reasoning item whose content is encrypted",
         json.dumps({"type": "reasoning", "encrypted_content": "gAAAAA" + blob})),
    ]


def main(args):
    if len(args) != 1:
        print("usage: probes.py <source>", file=sys.stderr)
        return 2
    items = probes()
    result = subprocess.run(
        ["python3", str(HERE / "load.py"), args[0], "scan"],
        input="".join(json.dumps(text) + "\n" for _name, _what, text in items),
        capture_output=True, text=True, check=False)
    if result.returncode != 0:
        print("probes: the scan failed: " + result.stderr.strip()[:200], file=sys.stderr)
        return 2
    found = [json.loads(line) for line in result.stdout.splitlines()]
    if len(found) != len(items):
        print("probes: the scan returned a different number of lines", file=sys.stderr)
        return 2
    for (name, what, _text), spans in zip(items, found):
        rules = sorted({rule for _start, _end, rule in spans})
        print("%-20s %-12s %s" % (name, ", ".join(rules) or "nothing", what))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
