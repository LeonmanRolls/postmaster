#!/usr/bin/env bash
# Scan committed additions for private-data shapes without printing matched values.
#
#   scrub-check.sh <base> <head>       scan added lines in every commit in base..head
#   scrub-check.sh --history [<ref>]   scan the history reachable from ref (default: main)
#   scrub-check.sh --self-test         run synthetic positive and negative controls
#   scrub-check.sh --help
#
# The allowlist is scripts/scrub-check.allow in the scanned repository. Each line allows one
# exact matched value or one exact added line. Uncommitted changes are outside the scan.
#
#   exit 0  clean (including an empty range)
#   exit 1  suspects, one per line on stdout: <commit>:<path>:<line>: <kind>
#   exit 2  usage or a Git/input error; notices go to stderr
set -uo pipefail
SELF=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")
SCRUB_CHECK_SCRIPT="$SELF" python3 -I - "$@" <<'PY'
import ast
import ipaddress
import os
import pathlib
import re
import subprocess
import sys
import tempfile


USAGE = "usage: scrub-check.sh <base> <head> | --history [<ref>] | --self-test | --help"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SCRIPT = pathlib.Path(os.environ.get("SCRUB_CHECK_SCRIPT", "")).resolve()
FIXTURE_EMAIL = "fixture" + "@" + "example.invalid"


def notice(message, code=2):
    print("scrub-check: " + message, file=sys.stderr)
    raise SystemExit(code)


def git(args, *, cwd=None, data=None):
    try:
        result = subprocess.run(
            ["git", *args], cwd=cwd, input=data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False,
        )
    except OSError:
        notice("could not run Git")
    if result.returncode != 0:
        notice("Git could not read the requested history")
    return result.stdout


def repository_root():
    raw = git(["rev-parse", "--show-toplevel"])
    try:
        root = pathlib.Path(os.fsdecode(raw.strip())).resolve()
    except (OSError, ValueError):
        notice("could not find the repository root")
    if pathlib.Path.cwd().resolve() != root:
        notice("run from the repository root")
    return root


def resolve_commit(ref):
    if not ref or ref.startswith("-"):
        notice("a commit ref is required")
    raw = git(["rev-parse", "--verify", "--quiet", "--end-of-options", ref + "^{commit}"])
    commit = raw.decode("ascii", errors="ignore").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        notice("the repository did not return a full commit id")
    return commit


def key_value_pattern(keys):
    choices = "|".join(re.escape(key) for key in keys)
    return re.compile(
        r"(?<![A-Za-z0-9_])(?:" + choices + r")\b\s*[\"']?\s*[:=]\s*"
        r"(?:\"(?P<double>[^\"\n]+)\"|'(?P<single>[^'\n]+)'|(?P<bare>[^\s,;}\]]+))",
        re.IGNORECASE,
    )


# Build field names from pieces so the scanner source does not contain a key/value example.
SENSITIVE_FIELDS = key_value_pattern((
    "user" + "Email",
    "session" + "_" + "context",
    "credential" + "_" + "org",
))
ACCOUNT_FIELDS = key_value_pattern((
    "account" + "Id", "account" + "ID", "account" + "_" + "id",
    "account" + "Uuid", "account" + "_" + "uuid",
))
ORGANIZATION_FIELDS = key_value_pattern((
    "organization" + "Uuid", "organization" + "_" + "uuid",
    "organization" + "Id", "organization" + "_" + "id",
    "org" + "Id", "org" + "_" + "id", "org" + "Uuid", "org" + "_" + "uuid",
))
SECRET_FIELDS = key_value_pattern((
    "api" + "_" + "key", "api" + "Key", "access" + "_" + "token", "access" + "Token",
    "refresh" + "_" + "token", "refresh" + "Token", "client" + "_" + "secret",
    "client" + "Secret", "private" + "_" + "key", "private" + "Key", "secret", "token", "password", "credential",
))

EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])")
IPV4 = re.compile(r"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])")
IPV6 = re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])")
PRIVATE_HOST = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"(?:local|internal|lan|home|tailnet|intranet|private|corp)\b|(?<![A-Za-z0-9_-])" + re.escape("local" + "host") + r"\b"
)

HOME_MARKER = "~" + "/"
HOME_PREFIXES = (
    re.escape(HOME_MARKER) + r"[^\s\"'<>),;]+",
    r"/(?:home|Users)/[^/\s\"'<>]+(?:/[^\s\"'<>),;]*)?",
    r"/tmp/(?:claude|codex|grok|pi|mimo|muse|agy|postmaster|agent)[A-Za-z0-9._-]*(?:/[^\s\"'<>),;]*)?",
    r"[A-Za-z]:\\Users\\[^\\\s\"'<>]+(?:\\[^\s\"'<>),;]*)?",
)
PRIVATE_PATH = re.compile("(?:" + "|".join(HOME_PREFIXES) + ")", re.IGNORECASE)

TOKEN_PREFIXES = (
    "gh" + "p_", "github" + "_pat_", "gh" + "o_", "gh" + "u_", "gh" + "s_", "gh" + "r_",
    "sk" + "-", "sk" + "_live_", "sk" + "_test_", "xox" + "b-", "xox" + "p-",
    "xox" + "a-", "xox" + "r-", "ya29" + ".",
)
TOKEN = re.compile(
    r"(?<![A-Za-z0-9])(?P<value>(?:" + "|".join(re.escape(p) for p in sorted(TOKEN_PREFIXES, key=len, reverse=True))
    + r")[A-Za-z0-9_./+-]{20,})"
)
ACCESS_KEY = re.compile(r"(?<![A-Za-z0-9])(?P<value>" + "AK" + "IA" + r"[A-Z0-9]{16})(?![A-Za-z0-9])")
PEM_HEADER = re.compile(r"(?i)(?P<value>-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)")
SECRET_VALUE = re.compile(r"(?i)^(?P<value>[A-Za-z0-9_./+=-]{20,})$")

PRIVATE_INSTRUCTIONS = (
    re.compile(r"(?im)^\s*#{1,6}\s+(?:private|global|personal)\s+instructions\b[^\n]*"),
    re.compile(r"(?im)^\s*#{1,6}\s+standing instructions for agents on this machine\b[^\n]*"),
    re.compile(r"(?im)^\s*#{1,6}\s+Identity and privacy\b[^\n]*"),
    re.compile(r"(?im)^\s*(?:Never|Do not|Always|You must)\b[^\n]{0,240}\b(?:account|private|secret|identity|family|employer|email|credential|token)\b[^\n]*"),
    re.compile(r"(?im)^\s*You are\b[^\n]{0,160}\b(?:agent|assistant)\b[^\n]*"),
)
COAUTHOR_PREFIX = "Co-Authored" + "-By:"
ASSISTANT_ATTRIBUTION = (
    re.compile(r"(?im)^\s*" + re.escape(COAUTHOR_PREFIX) + r"\s*(?:Claude|ChatGPT|GPT|OpenAI|Codex|Gemini|Copilot)\b[^\n]*"),
    re.compile(r"(?im)^\s*(?:Generated|Created|Written|Drafted)\s+(?:with|by)\s+(?:Claude|ChatGPT|GPT|OpenAI|Codex|Gemini|Copilot)\b[^\n]*"),
)


def field_value(match):
    for group in ("double", "single", "bare"):
        value = match.group(group)
        if value is not None:
            return value
    return ""


def match_span(match, group="value"):
    start, end = match.span(group)
    return start, end, match.group(group)


def public_noreply(address):
    local, _, domain = address.rpartition("@")
    local, domain = local.lower(), domain.lower()
    return domain == "users.noreply.github.com" or (local in {"noreply", "no-reply", "do-not-reply"} and domain in {"github.com", "openai.com"})


def ip_spans(line):
    for pattern in (IPV4, IPV6):
        for match in pattern.finditer(line):
            try:
                address = ipaddress.ip_address(match.group())
            except ValueError:
                continue
            if address.is_private or address.is_loopback or address.is_link_local:
                yield match.start(), match.end(), match.group()


def findings(line):
    found = []

    for match in SENSITIVE_FIELDS.finditer(line):
        value = field_value(match)
        if value:
            start = next(match.span(group) for group in ("double", "single", "bare") if match.group(group) is not None)
            found.append((start[0], start[1], "sensitive-field", value))

    for kind, pattern in (("account-id", ACCOUNT_FIELDS), ("organization-id", ORGANIZATION_FIELDS)):
        for match in pattern.finditer(line):
            value = field_value(match)
            if value:
                start = next(match.span(group) for group in ("double", "single", "bare") if match.group(group) is not None)
                found.append((start[0], start[1], kind, value))

    for match in EMAIL.finditer(line):
        value = match.group()
        if not public_noreply(value):
            found.append((match.start(), match.end(), "email", value))

    for match in PRIVATE_PATH.finditer(line):
        value = match.group()
        while value and value[-1] in {".", "!", "?", ":", "]", "}", chr(34), chr(96)}:
            value = value[:-1]
        if value:
            found.append((match.start(), match.start() + len(value), "private-path", value))

    for match in PRIVATE_HOST.finditer(line):
        found.append((match.start(), match.end(), "private-network", match.group()))
    found.extend((start, end, "private-network", value) for start, end, value in ip_spans(line))

    for pattern in (TOKEN, ACCESS_KEY, PEM_HEADER):
        for match in pattern.finditer(line):
            start, end, value = match_span(match)
            found.append((start, end, "credential", value))

    for match in SECRET_FIELDS.finditer(line):
        value = field_value(match)
        if len(value) >= 20 and SECRET_VALUE.fullmatch(value):
            start = next(match.span(group) for group in ("double", "single", "bare") if match.group(group) is not None)
            found.append((start[0], start[1], "credential", value))

    for pattern in ASSISTANT_ATTRIBUTION:
        for match in pattern.finditer(line):
            found.append((match.start(), match.end(), "assistant-attribution", match.group()))

    for pattern in PRIVATE_INSTRUCTIONS:
        for match in pattern.finditer(line):
            found.append((match.start(), match.end(), "private-instructions", match.group()))

    # The same span can satisfy overlapping credential shapes; report that suspect once per kind.
    unique = {}
    for start, end, kind, value in found:
        unique[(start, end, kind, value)] = (start, end, kind, value)
    return sorted(unique.values(), key=lambda item: (item[0], item[1], item[2]))


def allowlist(root):
    path = root / "scripts" / "scrub-check.allow"
    try:
        return {line for line in path.read_text(encoding="utf-8").splitlines() if line != ""}
    except FileNotFoundError:
        return set()
    except (OSError, UnicodeError):
        notice("could not read scripts/scrub-check.allow")


def git_path(raw):
    raw = raw.rstrip(b"\r\n")
    if raw.startswith(b'"'):
        try:
            path = ast.literal_eval(raw.decode("ascii"))
        except (SyntaxError, UnicodeError, ValueError):
            path = raw.decode("utf-8", errors="replace")
    else:
        path = os.fsdecode(raw)
    if path.startswith("b/"):
        path = path[2:]
    return path


def safe_path(path, protected_values=()):
    spans = sorted(set((start, end) for start, end, _kind, _value in findings(path)))
    for value in protected_values:
        if not value:
            continue
        offset = 0
        while True:
            start = path.find(value, offset)
            if start < 0:
                break
            spans.append((start, start + len(value)))
            offset = start + len(value)
    merged = []
    for start, end in sorted(set(spans)):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    pieces, cursor = [], 0
    for start, end in merged:
        pieces.append(path[cursor:start])
        pieces.append("[redacted]")
        cursor = end
    pieces.append(path[cursor:])
    safe = "".join(pieces)
    return "".join(ch if ch >= " " and ch != "\x7f" else "\\x%02x" % ord(ch) for ch in safe)

def allowed(entries, line, finding):
    return line in entries or finding[3] in entries


def scan_diff(root, parent, commit, entries):
    diff = git([
        "diff", "--text", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=0",
        "--src-prefix=a/", "--dst-prefix=b/", parent, commit, "--",
    ], cwd=root)
    suspects, protected_values = [], []
    path, line_number = "", None
    for raw in diff.splitlines(keepends=True):
        content = raw.rstrip(b"\r\n")
        if content.startswith(b"diff --git "):
            path, line_number = "", None
        elif content.startswith(b"+++ ") and line_number is None:
            path = git_path(content[4:])
            line_number = None
        elif content.startswith(b"@@ "):
            match = re.search(rb"\+([0-9]+)(?:,[0-9]+)?\s+@@", content)
            line_number = int(match.group(1)) if match else None
        elif line_number is not None and content.startswith(b"+"):
            text = content[1:].decode("utf-8", errors="replace")
            matches = findings(text)
            protected_values.extend(item[3] for item in matches)
            for item in matches:
                if not allowed(entries, text, item):
                    suspects.append((commit, path, line_number, item[2], item[3]))
            line_number += 1
    return suspects, protected_values

def commits_for_range(base, head):
    raw = git(["rev-list", "--reverse", base + ".." + head])
    commits = raw.decode("ascii", errors="strict").splitlines()
    if any(not re.fullmatch(r"[0-9a-f]{40}", commit) for commit in commits):
        notice("the repository did not return full commit ids")
    return commits


def commits_for_history(ref):
    raw = git(["rev-list", "--reverse", ref])
    commits = raw.decode("ascii", errors="strict").splitlines()
    if any(not re.fullmatch(r"[0-9a-f]{40}", commit) for commit in commits):
        notice("the repository did not return full commit ids")
    return commits


def parent_of(commit):
    raw = git(["rev-list", "--parents", "--max-count=1", commit]).decode("ascii", errors="strict").split()
    if not raw:
        notice("Git could not read a commit")
    return raw[1] if len(raw) > 1 else EMPTY_TREE


def run_scan(root, commits):
    entries = allowlist(root)
    suspects, protected_values = [], []
    for commit in commits:
        found, protected = scan_diff(root, parent_of(commit), commit, entries)
        suspects.extend(found)
        protected_values.extend(protected)
    for commit, path, line, kind, _value in sorted(suspects, key=lambda item: item[:4]):
        print("%s:%s:%d: %s" % (commit, safe_path(path, protected_values), line, kind))
    return 1 if suspects else 0

def add_fixture(repo, relative, contents, message):
    target = repo / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(contents, encoding="utf-8")
    git(["add", "--", relative], cwd=repo)
    git([
        "-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_EMAIL,
        "commit", "-m", message,
    ], cwd=repo)
    return git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()


def run_child(args, cwd):
    try:
        return subprocess.run(
            [str(SCRIPT), *args], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", check=False,
        )
    except OSError:
        return None


def self_test(root):
    if not SCRIPT.is_file():
        notice("the scanner script could not be found")
    temp_root = root / ".postmaster" / "verify"
    try:
        temp_root.mkdir(parents=True, exist_ok=True)
    except OSError:
        notice("could not prepare the self-test scratch directory", 1)

    failures = 0

    def ok(label, passed):
        nonlocal failures
        print("  %s %s" % ("ok  " if passed else "FAIL", label))
        if not passed:
            failures += 1

    try:
        with tempfile.TemporaryDirectory(prefix="scrub-check-", dir=temp_root) as directory:
            scratch = pathlib.Path(directory)
            repo = scratch / "base"
            repo.mkdir()
            git(["init", "-q", "--initial-branch=main"], cwd=repo)
            git(["config", "user.name", "Fixture"], cwd=repo)
            git(["config", "user.email", FIXTURE_EMAIL], cwd=repo)
            (repo / "scripts").mkdir()
            (repo / "scripts" / "scrub-check.sh").write_bytes(SCRIPT.read_bytes())
            (repo / "scripts" / "scrub-check.allow").write_text("", encoding="utf-8")
            git(["add", "scripts/scrub-check.sh", "scripts/scrub-check.allow"], cwd=repo)
            git(["commit", "-qm", "base"], cwd=repo)
            start = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()

            source_check = run_child(["--history"], repo)
            ok("the scanner source is clean in its own history", bool(source_check and source_check.returncode == 0 and not source_check.stdout))
            help_result = run_child(["--help"], repo)
            ok("help exits cleanly on stderr", bool(help_result and help_result.returncode == 0 and not help_result.stdout and "usage:" in help_result.stderr))
            usage_result = run_child(["--unknown"], repo)
            ok("usage errors exit 2 without stdout", bool(usage_result and usage_result.returncode == 2 and not usage_result.stdout))
            if source_check and source_check.stdout:
                for suspect in source_check.stdout.splitlines():
                    print("         suspect " + suspect)

            sample_email = "lane@" + "example.invalid"
            private_ip = ".".join(("192", "168", "50", "8"))
            private_host = "buildbox" + "." + "lan"
            private_path = "/" + "home" + "/" + "sample-user" + "/" + "record.txt"
            fake_token = ("gh" + "p_") + ("x" * 36)
            fake_org_uuid = "00000000-0000-4000-8000-000000000001"
            fake_account_id = "123456789"
            sensitive_lines = [
                "user" + "Email" + ": " + sample_email,
                "session" + "_" + "context" + ": fixture-session",
                "credential" + "_" + "org" + ": fixture-org",
            ]
            cases = [
                ("sensitive-field", "\n".join(sensitive_lines) + "\n"),
                ("email", "contact: " + sample_email + "\n"),
                ("account-id", "account" + "Id" + ": " + fake_account_id + "\n"),
                ("organization-id", "organization" + "Uuid" + ": " + fake_org_uuid + "\n"),
                ("private-path", "source: " + private_path + "\n"),
                ("private-network", "+++ host " + private_host + " address " + private_ip + "\n"),
                ("credential", "token: " + fake_token + "\n"),
                ("assistant-attribution", ("Co-Authored" + "-By: ") + "Claude\n"),
                ("private-instructions", "# Global instructions for this fixture\n## Identity and privacy\n"),
            ]

            last = start
            for index, (kind, text) in enumerate(cases, 1):
                head = add_fixture(repo, "fixtures/positive-%02d.txt" % index, text, "positive fixture")
                result = run_child([last, head], repo)
                lines = [] if result is None else result.stdout.splitlines()
                expected = "%s:fixtures/positive-%02d.txt:" % (head, index)
                good = bool(result and result.returncode == 1 and any(line.startswith(expected + "1: ") and line.endswith(": " + kind) for line in lines)
                            and all(value not in result.stdout for value in (sample_email, private_ip, private_host, private_path, fake_token, fake_org_uuid, fake_account_id, "fixture-session", "fixture-org", "Co-Authored" + "-By: Claude", "# Global instructions for this fixture")))
                ok("a fixture carrying %s is reported without its value" % kind, good)
                last = head

                clean_text = "ordinary public sample\n"
                if kind == "email":
                    clean_text = "contact: 123456789+sample@users.noreply.github.com\n"
                clean_head = add_fixture(repo, "fixtures/clean-%02d.txt" % index, clean_text, "clean fixture")
                clean = run_child([last, clean_head], repo)
                ok("a clean %s control passes" % kind, bool(clean and clean.returncode == 0 and not clean.stdout))
                last = clean_head

            path_head = add_fixture(repo, "fixtures/" + sample_email + ".txt", "contact: " + sample_email + "\n", "path redaction fixture")
            path_result = run_child([last, path_head], repo)
            ok("a matched value in a reported path is redacted", bool(path_result and path_result.returncode == 1 and sample_email not in path_result.stdout and "[redacted]" in path_result.stdout))
            last = path_head

            transient = "account" + "Id" + ": " + fake_account_id + "\n"
            added = add_fixture(repo, "fixtures/transient.txt", transient, "add transient fixture")
            removed_path = repo / "fixtures" / "transient.txt"
            removed_path.unlink()
            git(["add", "--", "fixtures/transient.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_EMAIL, "commit", "-m", "remove transient fixture"], cwd=repo)
            deleted = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            history_range = run_child([last, deleted], repo)
            ok("an added line remains flagged after deletion at the tip", bool(history_range and history_range.returncode == 1 and history_range.stdout.startswith(added + ":fixtures/transient.txt:1: account-id\n")))
            last = deleted

            allowed_value = "fixture-allowed-org"
            allowed_line = "credential" + "_" + "org" + ": " + allowed_value
            pending = add_fixture(repo, "fixtures/allowed-value.txt", allowed_line + "\n", "pending ruling fixture")
            pending_result = run_child([last, pending], repo)
            ok("a not-yet-allowed match is reported", bool(pending_result and pending_result.returncode == 1 and pending_result.stdout.endswith(": sensitive-field\n") and allowed_value not in pending_result.stdout))
            (repo / "scripts" / "scrub-check.allow").write_text(allowed_value + "\n", encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            allowed = git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_EMAIL, "commit", "-m", "allow exact fixture value"], cwd=repo)
            allow_head = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            allowed_result = run_child([last, allow_head], repo)
            ok("an exact allowed value suppresses the earlier match", bool(allowed and allowed_result and allowed_result.returncode == 0 and not allowed_result.stdout))

            whole_line = "session" + "_" + "context" + ": whole-line-fixture"
            whole_head = add_fixture(repo, "fixtures/allowed-line.txt", whole_line + "\n", "whole line fixture")
            (repo / "scripts" / "scrub-check.allow").write_text(allowed_value + "\n" + whole_line + "\n", encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            final_head = git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_EMAIL, "commit", "-m", "allow whole fixture line"], cwd=repo)
            final_sha = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            whole_result = run_child([whole_head, final_sha], repo)
            ok("an exact allowed added line is suppressed", bool(final_head and whole_result and whole_result.returncode == 0 and not whole_result.stdout))

            (repo / "scripts" / "scrub-check.allow").write_text("", encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_EMAIL, "commit", "-m", "remove fixture ruling"], cwd=repo)
            pending_again = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            revoked_result = run_child([pending, pending_again], repo)
            ok("a match without a current allowance escalates again", bool(revoked_result and revoked_result.returncode == 1 and allowed_value not in revoked_result.stdout))

            empty = run_child([final_sha, final_sha], repo)
            ok("an empty commit range is clean", bool(empty and empty.returncode == 0 and not empty.stdout))

            history = run_child(["--history", "HEAD"], repo)
            ok("history mode reports a suspect without its value", bool(history and history.returncode == 1 and allowed_value not in history.stdout and ": sensitive-field\n" in history.stdout))
    except SystemExit:
        raise
    except Exception:
        ok("self-test fixture setup and scan", False)

    print("self-test: all controls behaved" if failures == 0 else "self-test: %d control(s) failed" % failures)
    return 0 if failures == 0 else 1


def main(args):
    if args == ["--help"]:
        print(USAGE, file=sys.stderr)
        return 0
    root = repository_root()
    if args == ["--self-test"]:
        return self_test(root)
    if args and args[0] == "--history":
        if len(args) > 2:
            notice(USAGE)
        ref = args[1] if len(args) == 2 else "main"
        head = resolve_commit(ref)
        return run_scan(root, commits_for_history(head))
    if len(args) != 2 or any(arg.startswith("--") for arg in args):
        notice(USAGE)
    base, head = resolve_commit(args[0]), resolve_commit(args[1])
    return run_scan(root, commits_for_range(base, head))


try:
    raise SystemExit(main(sys.argv[1:]))
except BrokenPipeError:
    raise SystemExit(1)
except SystemExit:
    raise
except Exception:
    print("scrub-check: scan failed", file=sys.stderr)
    raise SystemExit(2)
PY
