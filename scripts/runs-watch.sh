#!/usr/bin/env bash
# Wait for a run whose NEXT needs the postmaster. The status table remains the authority;
# this script adds a wait, a held-ticket filter and a one-line report, and takes no action.
#
#   runs-watch.sh <project-run-root> [--timeout <seconds>]
#   runs-watch.sh --self-test
#
# It checks immediately, then every postmaster.poll_seconds (120 by default). A ticket in
# <project-run-root>/postmaster/held is ignored until it is removed from that file.
#
#   exit 0  one or more runs need the postmaster; the table and their NEXT values are printed
#   exit 3  the timeout passed with no run to act on; the last table is printed
#   exit 1  the status reader or hold list could not be read
set -euo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

exec python3 - "$HERE/runs-status.sh" "$@" <<'PY'
import argparse
import contextlib
import io
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import tomllib

STATUS_SCRIPT = pathlib.Path(sys.argv[1])
IGNORED_NEXT = {"WAIT", "USER", "-"}


class WatchError(Exception):
    pass


def seconds(value):
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number of seconds") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise argparse.ArgumentTypeError("must be a finite, non-negative number of seconds")
    return parsed


def poll_seconds(config_path=None):
    if config_path is None:
        config_path = os.environ.get("POSTMASTER_CONFIG") or os.path.join(
            os.path.expanduser("~"), ".postmaster", "config.toml"
        )
    try:
        with open(config_path, "rb") as config_file:
            value = tomllib.load(config_file).get("postmaster", {}).get("poll_seconds", 120)
    except (OSError, tomllib.TOMLDecodeError):
        return 120
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 120
    try:
        interval = float(value)
    except OverflowError:
        return 120
    if not math.isfinite(interval) or interval <= 0:
        return 120
    return interval


def status_table(runs):
    result = subprocess.run(
        [str(STATUS_SCRIPT), os.fspath(runs)],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()
        raise WatchError(message or "runs-status.sh failed with exit %d" % result.returncode)
    return result.stdout


def held_tickets(runs):
    path = pathlib.Path(runs) / "postmaster" / "held"
    try:
        with path.open(encoding="utf-8") as held_file:
            return {line.strip() for line in held_file if line.strip()}
    except FileNotFoundError:
        return set()
    except OSError as error:
        raise WatchError("cannot read %s: %s" % (path, error)) from error


def actionable(table, held):
    rows = []
    in_table = False
    for line in table.splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == "RUN" and fields[-1] == "NEXT":
            in_table = True
            continue
        if not in_table or len(fields) < 6:
            continue
        ticket, next_step = fields[0], fields[-1]
        if next_step not in IGNORED_NEXT and ticket not in held:
            rows.append((ticket, next_step))
    if not in_table:
        raise WatchError("runs-status.sh did not print its table")
    return rows


def print_table(table):
    sys.stdout.write(table)
    if not table.endswith("\n"):
        sys.stdout.write("\n")


def watch(runs, interval, timeout=None):
    deadline = None if timeout is None else time.monotonic() + timeout
    while True:
        table = status_table(runs)
        needs = actionable(table, held_tickets(runs))
        if needs:
            print_table(table)
            for ticket, next_step in needs:
                print("%s needs the postmaster (NEXT=%s)" % (ticket, next_step))
            return 0

        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                print_table(table)
                return 3
            time.sleep(min(interval, remaining))
        else:
            time.sleep(interval)


def fixture_run(root, ticket, stage="review", leg=2, markers=(), old=False):
    run = pathlib.Path(root) / ticket
    run.mkdir(parents=True)
    (run / "manifest.json").write_text(
        json.dumps({"stage": stage, "leg": leg}) + "\n", encoding="utf-8"
    )
    (run / "run-log.md").write_text("fixture\n", encoding="utf-8")
    for marker in markers:
        (run / marker).touch()
    if old:
        ago = time.time() - 3600
        for path in run.iterdir():
            os.utime(path, (ago, ago))
    return run


def capture_watch(runs, interval=0.01, timeout=None):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = watch(runs, interval, timeout)
    return code, output.getvalue()


def self_test():
    fails = 0

    def check(label, passed, detail=""):
        nonlocal fails
        if passed:
            print("  ok   %s" % label)
        else:
            print("  FAIL %s" % label)
            if detail:
                for line in detail.splitlines():
                    print("         %s" % line)
            fails += 1

    def root_at(base, name):
        root = pathlib.Path(base) / name
        root.mkdir()
        return root

    print("positive controls")
    actionable_states = [
        ("RULE", "review", 2, [".escalation-ready"], False),
        ("READ", "review", 2, [".checkpoint-review-ready"], False),
        ("DISPATCH", "review", 2, [".leg-2-done"], False),
        ("REMOUNT", "review", 2, [".leg-2-exited"], False),
        ("INSPECT", "review", 2, [], True),
        ("GATE", "shipping", 3, [".card-ready"], False),
    ]
    with tempfile.TemporaryDirectory(prefix="runs-watch-") as tmp:
        for index, (next_step, stage, leg, markers, old) in enumerate(actionable_states, 1):
            root = root_at(tmp, "positive-%s" % index)
            ticket = "T-%d" % index
            fixture_run(root, ticket, stage, leg, markers, old)
            code, output = capture_watch(root, timeout=0.2)
            table_row = any(
                line.split()[:1] == [ticket] and line.split()[-1:] == [next_step]
                for line in output.splitlines()
            )
            check(
                "NEXT=%s returns and names its run" % next_step,
                code == 0
                and table_row
                and "%s needs the postmaster (NEXT=%s)" % (ticket, next_step) in output,
                output,
            )

        root = root_at(tmp, "mixed")
        fixture_run(root, "T-7", markers=[".escalation-ready"])
        fixture_run(root, "T-8", stage="shipping", leg=3, markers=[".card-ready"])
        (root / "postmaster").mkdir()
        (root / "postmaster" / "held").write_text("T-7\n", encoding="utf-8")
        code, output = capture_watch(root, timeout=0.2)
        check(
            "a held run is skipped while another actionable run is named",
            code == 0
            and "T-8 needs the postmaster (NEXT=GATE)" in output
            and "T-7 needs the postmaster" not in output,
            output,
        )

        config = pathlib.Path(tmp) / "poll.toml"
        check("a missing config uses the 120-second default", poll_seconds(config) == 120)
        config.write_text("[postmaster]\npoll_seconds = 7\n", encoding="utf-8")
        check("postmaster.poll_seconds sets the interval", poll_seconds(config) == 7)
        config.write_text("[postmaster\npoll_seconds = 7\n", encoding="utf-8")
        check("an unreadable config value uses the 120-second default", poll_seconds(config) == 120)

        print("negative controls")
        negative_cases = [
            ("WAIT", "review", 2, [], False, False),
            ("USER", "review", 2, [".waiting-on-user", ".leg-2-exited"], False, False),
            ("-", "done", 3, [".leg-3-done"], False, False),
            ("RULE", "review", 2, [".escalation-ready"], False, True),
        ]
        for index, (expected, stage, leg, markers, old, hold) in enumerate(negative_cases, 1):
            root = root_at(tmp, "negative-%s" % index)
            ticket = "T-%d" % (index + 10)
            fixture_run(root, ticket, stage, leg, markers, old)
            if hold:
                (root / "postmaster").mkdir()
                (root / "postmaster" / "held").write_text(ticket + "\n", encoding="utf-8")
            code, output = capture_watch(root, timeout=0.08)
            table_row = any(
                line.split()[:1] == [ticket] and line.split()[-1:] == [expected]
                for line in output.splitlines()
            )
            check(
                "%s%s leaves the watcher waiting until timeout" % (
                    "a held run with " if hold else "NEXT=",
                    expected,
                ),
                code == 3 and table_row and "needs the postmaster" not in output,
                output,
            )

    print()
    if fails == 0:
        print("self-test: all controls behaved")
        return 0
    print("self-test: %d control(s) misbehaved" % fails)
    return 1


def main():
    parser = argparse.ArgumentParser(
        prog="runs-watch.sh",
        description="Wait for runs that need the postmaster.",
        usage="%(prog)s <project-run-root> [--timeout <seconds>] | --self-test",
    )
    parser.add_argument("runs", nargs="?", help="the project's run root")
    parser.add_argument("--timeout", type=seconds, metavar="SECONDS")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(sys.argv[2:])

    if args.self_test:
        if args.runs is not None or args.timeout is not None:
            parser.error("--self-test takes no other arguments")
        return self_test()
    if args.runs is None:
        parser.error("a project run root is required")
    return watch(args.runs, poll_seconds(), args.timeout)


try:
    sys.exit(main())
except WatchError as error:
    print("runs-watch: %s" % error, file=sys.stderr)
    sys.exit(1)
PY
