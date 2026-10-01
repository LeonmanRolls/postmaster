#!/usr/bin/env bash
# The controls' rule table, in the shape check.ts loads from #135's scanner: a bash script
# carrying its Python in a heredoc, with `findings`, `RULES` and a self-test whose `pos` and
# `neg` calls are the fixtures. It is never run as a scanner; load.py reads it.
#
#   ctl-widget       a part number; the format expresses it (the positive control)
#   ctl-checksum     a nine-digit serial whose check digit is right, which no regular
#                    expression in the format can tell (a negative control)
#   ctl-conditional  a doubled word; its entry uses a Python-only conditional group, which
#                    ECMAScript lacks (a negative control)
#   ctl-missing      a rule with no entry in the format file at all (a negative control)
python3 - "$@" <<'PY'
import re

WIDGET = re.compile(r"(?<![A-Za-z0-9])WIDGET-[0-9]{4}(?![0-9])")
SERIAL = re.compile(r"(?<![0-9])[0-9]{9}(?![0-9])")
DOUBLED = re.compile(r"(?<![a-z])(<)?([a-z]{3})-\2(?(1)>)(?![a-z])")
LOUD = re.compile(r"(?<![A-Z])[A-Z]{5,}!(?![A-Z])")


def check_digit(serial):
    total = sum((10 - index) * int(digit) for index, digit in enumerate(serial[:8]))
    return (11 - total % 11) % 11 % 10 == int(serial[8])


def findings(line):
    found = []
    for match in WIDGET.finditer(line):
        found.append((match.start(), match.end(), "ctl-widget", match.group()))
    for match in SERIAL.finditer(line):
        if check_digit(match.group()):
            found.append((match.start(), match.end(), "ctl-checksum", match.group()))
    for match in DOUBLED.finditer(line):
        found.append((match.start(), match.end(), "ctl-conditional", match.group()))
    for match in LOUD.finditer(line):
        found.append((match.start(), match.end(), "ctl-missing", match.group()))
    return sorted(set(found), key=lambda item: (item[0], item[1], item[2]))


RULES = frozenset({"ctl-widget", "ctl-checksum", "ctl-conditional", "ctl-missing"})


def self_test(root):
    def pos(rule, text, name):
        pass

    def neg(rule, text, name, label):
        pass

    good_serial = "12345678" + "6"
    bad_serial = "12345678" + "7"
    pos("ctl-widget", "order WIDGET-" + "4130 today\n", "pos-widget")
    pos("ctl-widget", "(WIDGET-" + "0001)\n", "pos-widget-paren")
    pos("ctl-widget", "WIDGET-" + "9999\n", "pos-widget-start")
    neg("ctl-widget", "WIDGET-" + "41301 is too long\n", "neg-widget-long", "five digits")
    neg("ctl-widget", "XWIDGET-" + "4130\n", "neg-widget-glued", "glued to a word")
    neg("ctl-widget", "widget-" + "4130\n", "neg-widget-lower", "lower case")
    pos("ctl-checksum", "serial " + good_serial + "\n", "pos-serial")
    pos("ctl-checksum", "[" + good_serial + "]\n", "pos-serial-bracket")
    pos("ctl-checksum", good_serial + " ok\n", "pos-serial-start")
    neg("ctl-checksum", "serial " + bad_serial + "\n", "neg-serial-digit", "wrong check digit")
    neg("ctl-checksum", "serial " + good_serial + "0\n", "neg-serial-long", "ten digits")
    neg("ctl-checksum", "serial 12345\n", "neg-serial-short", "five digits")
    pos("ctl-conditional", "say abc-abc now\n", "pos-doubled")
    pos("ctl-conditional", "say <abc-abc> now\n", "pos-doubled-bracketed")
    pos("ctl-conditional", "xyz-xyz\n", "pos-doubled-start")
    neg("ctl-conditional", "say abc-abd now\n", "neg-doubled-differ", "not doubled")
    neg("ctl-conditional", "say xabc-abc now\n", "neg-doubled-glued", "glued to a word")
    neg("ctl-conditional", "say abcd-abcd now\n", "neg-doubled-long", "four letters")
    pos("ctl-missing", "ALERT! now\n", "pos-loud")
    pos("ctl-missing", "say HELLO!\n", "pos-loud-end")
    pos("ctl-missing", "(QUIET!)\n", "pos-loud-paren")
    neg("ctl-missing", "STOP now\n", "neg-loud-plain", "no bang")
    neg("ctl-missing", "Stop! now\n", "neg-loud-mixed", "mixed case")
    neg("ctl-missing", "HI! now\n", "neg-loud-short", "two letters")


def main(args):
    return 0


try:
    raise SystemExit(main([]))
except SystemExit:
    raise
PY
