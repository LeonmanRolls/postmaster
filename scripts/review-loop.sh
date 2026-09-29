#!/usr/bin/env bash
# Decide whether a review loop runs another round from its verified findings and applied fixes.
#
#   review-loop.sh <dispatch> <round> | --self-test
#
# Review finding details use: <gating|style> <P1|P2|P3> r<round> ...
# Review apply details use: r<round> <finding target(s)> ...
#
#   RUN <next round>: round 1 applied a fix, or a later round found P1/P2
#   STOP <round>: no rule requires another round
#   CAP 3: round 3 found P1/P2; escalate with residue
set -uo pipefail

python3 - "$@" <<'PY'
import json
import re
import sys


def fail(message):
    print("review-loop: " + message, file=sys.stderr)
    raise SystemExit(1)


def parse_actions(lines):
    actions = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except ValueError as error:
            fail("actions.jsonl line %d is not JSON: %s" % (number, error))
        if not isinstance(event, dict):
            fail("actions.jsonl line %d is not an action object" % number)
        action = event.get("action")
        detail = str(event.get("detail", ""))
        if action == "finding":
            parts = detail.split(None, 3)
            if (len(parts) < 3 or parts[0] not in ("gating", "style")
                    or parts[1] not in ("P1", "P2", "P3")
                    or not re.fullmatch(r"r[1-3]", parts[2])):
                fail("actions.jsonl line %d: finding detail must start with '<gating|style> <P1|P2|P3> r1..r3'" % number)
            actions.append(("finding", parts[0], parts[1], int(parts[2][1:]), str(event.get("target", ""))))
        elif action == "apply":
            match = re.match(r"^r([1-3])\s+(\S.*)$", detail)
            if not match:
                fail("actions.jsonl line %d: apply detail must start with 'r1..r3' and name its finding target(s)" % number)
            actions.append(("apply", int(match.group(1)), match.group(2)))
    return actions


def decision(actions, round_number):
    if round_number == 1:
        applied = sum(1 for action in actions if action[0] == "apply" and action[1] == 1)
        if applied:
            noun = "fix" if applied == 1 else "fixes"
            return "RUN 2: round 1 applied %d %s" % (applied, noun)
        return "STOP 1: round 1 applied no fixes"

    serious = sum(1 for action in actions
                  if action[0] == "finding" and action[3] == round_number and action[2] in ("P1", "P2"))
    if round_number == 3:
        if serious:
            noun = "finding" if serious == 1 else "findings"
            return "CAP 3: round 3 has %d verified P1/P2 %s; escalate with residue" % (serious, noun)
        return "STOP 3: round 3 has no verified P1/P2 findings"
    if serious:
        noun = "finding" if serious == 1 else "findings"
        return "RUN 3: round 2 has %d verified P1/P2 %s" % (serious, noun)
    return "STOP 2: round 2 has no verified P1/P2 findings"


def action_line(action, target, detail):
    return json.dumps({"action": action, "target": target, "detail": detail})


def self_test():
    fails = 0

    def check(label, lines, round_number, expected):
        nonlocal fails
        try:
            actual = decision(parse_actions(lines), round_number)
        except SystemExit:
            actual = "invalid action log"
        if actual == expected:
            print("  ok   " + label)
        else:
            print("  FAIL %s (got %s; expected %s)" % (label, actual, expected))
            fails += 1

    print("positive controls")
    check("round 1 application runs round 2",
          [action_line("finding", "src/a.ts:1", "gating P3 r1 bug lane reading"),
           action_line("apply", "abc123", "r1 src/a.ts:1")],
          1, "RUN 2: round 1 applied 1 fix")
    check("round 2 P2 finding runs round 3",
          [action_line("finding", "src/a.ts:2", "gating P2 r2 bug lane execution")],
          2, "RUN 3: round 2 has 1 verified P1/P2 finding")
    check("round 3 P1 finding reaches the cap",
          [action_line("finding", "src/a.ts:3", "gating P1 r3 security lane reading")],
          3, "CAP 3: round 3 has 1 verified P1/P2 finding; escalate with residue")

    print("negative controls")
    check("an apply from another round does not run round 2",
          [action_line("finding", "src/a.ts:1", "gating P2 r1 bug lane reading"),
           action_line("apply", "abc123", "r2 src/a.ts:1")],
          1, "STOP 1: round 1 applied no fixes")
    check("round 2 P3 alone stops the loop",
          [action_line("finding", "src/a.ts:2", "gating P3 r2 bug lane reading")],
          2, "STOP 2: round 2 has no verified P1/P2 findings")
    check("round 3 P3 alone stops without a cap escalation",
          [action_line("finding", "src/a.ts:3", "gating P3 r3 security lane reading")],
          3, "STOP 3: round 3 has no verified P1/P2 findings")

    if fails:
        print("self-test: %d control(s) misbehaved" % fails)
        return 1
    print("self-test: all controls behaved")
    return 0


args = sys.argv[1:]
if args == ["--self-test"]:
    raise SystemExit(self_test())
if len(args) != 2:
    fail("usage: review-loop.sh <dispatch> <round> | --self-test")
dispatch, raw_round = args
if not re.fullmatch(r"[1-3]", raw_round):
    fail("round must be 1, 2, or 3")
try:
    with open(dispatch.rstrip("/") + "/actions.jsonl", encoding="utf-8") as stream:
        actions = parse_actions(stream)
except OSError as error:
    fail("cannot read %s/actions.jsonl: %s" % (dispatch.rstrip("/"), error))
print(decision(actions, int(raw_round)))
PY
