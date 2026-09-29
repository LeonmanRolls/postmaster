#!/usr/bin/env bash
# Scan a change's every commit for added lines that look like private data.
#
#   scrub-check.sh <base> <head>    the added lines of every commit in base..head,
#                                   not only the tip; a line added then deleted
#                                   is still seen
#   scrub-check.sh --files <path>... worktree files, streamed line by line;
#                                   the raw/ promotion gate and the tree check
#                                   scan through this, never through the diff
#   scrub-check.sh --history [ref]  whether that ref's existing history already
#                                   holds a suspect; ref defaults to main
#   scrub-check.sh --help           usage, exit 0
#   scrub-check.sh --self-test      controls, one ok line each, exit 0 when all pass
#
# One suspect per line on stdout as <commit>:<path>:<line>: <kind>, where
# <commit> is the full 40-character sha, <path> the repo-relative file, <line>
# the added line's number in the new file, and <kind> the pattern name below.
# --files prints <path>:<line>: <kind> instead: there is no commit, and <path>
# is as given. A matched value is never printed: not in a suspect line, not in
# a notice, not in a diagnostic, not in a self-test; a value that reaches a
# reported path is redacted. Human notices go to stderr. The scan is read-only.
# Both scans stream: diffs and files are read line by line, so memory is
# bounded by the longest line, never by the file. It needs nothing beyond the
# gate's: bash, git and the Python standard library.
#
# The kinds, matched by shape and context, never against anyone's values:
#   key                   a named contact, session or credential key with a
#                         value that is present, not an absence marker
#                         (userEmail, session_context, credential_org and
#                         their case forms)
#   email                 an address that is neither a public no-reply form
#                         nor on a reserved domain
#   account-id            an opaque org or account token, a UUID on a
#                         line with account context, or a populated
#                         account or organization id field
#   private-path          a home directory with a concrete user, or harness
#                         scratch with a run marker; bare ~/ references and
#                         placeholder users are not suspects
#   private-host          a private, link-local or unique-local IP literal
#                         (never loopback), or a private-network hostname
#   token                 a documented key prefix with a body, a private-key
#                         header, or a long value under a secret-bearing field
#   dotenv                a .env-style NAME=value assignment whose name is
#                         key-like and whose value is present and literal
#   assistant-attribution an authorship trailer or generated-with footer
#   private-instructions  an instructions-file heading or a secrecy directive
#
# The allowlist is scripts/scrub-check.allow at the scanned repository's root:
# one entry per line as <value><TAB><reason>, and every non-empty line is an
# entry (there is no comment syntax). A suspect is suppressed when an entry's
# value equals its matched value span, or equals its whole added line. A line
# without a reason is refused: the scan exits 2 rather than honour a ruling
# nobody wrote down, and a ruling that quotes a suspect is refused the same
# way. The allowlist's own lines are never scanned. A missing file means no
# allowed values. An allowed value is by the user's ruling fine to publish.
# A value containing a tab cannot be allowed, and re-escalates instead: the
# split is on the first tab on purpose.
#
#   exit 0  clean: no unallowed suspect in the range (or the history, or files)
#   exit 1  suspects, one per line on stdout
#   exit 2  usage, an unreadable range, an unreadable file, a reason-less
#           allowlist entry, or a scan that could not finish
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


USAGE = "usage: scrub-check.sh <base> <head> | --files <path>... | --history [<ref>] | --self-test | --help"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SCRIPT = pathlib.Path(os.environ.get("SCRUB_CHECK_SCRIPT", "")).resolve()
FIXTURE_MAILBOX = "fixture" + "@" + "example.invalid"


def notice(message, code=2):
    print("scrub-check: " + message, file=sys.stderr)
    raise SystemExit(code)


def git(args, *, cwd=None):
    try:
        result = subprocess.run(
            ["git", *args], cwd=cwd, stdout=subprocess.PIPE,
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
        r"(?:\"(?P<double>[^\"\n]+)\"|'(?P<single>[^'\n]+)'|(?P<bare>[^\s\"',;}\]]+))",
        re.IGNORECASE,
    )


def field_value(match):
    for group in ("double", "single", "bare"):
        value = match.group(group)
        if value is not None:
            return value
    return ""


def value_span(match):
    return next(
        match.span(group)
        for group in ("double", "single", "bare")
        if match.group(group) is not None
    )


# Field names are built from pieces so this source holds no key/value example.
# The value span is the unquoted inner value, so a JSON closing brace never
# becomes part of it.
# Identifier fields report as account-id, never here: one line per suspect.
SENSITIVE_KEYS = key_value_pattern((
    "user" + "Email", "user" + "_" + "email", "user" + "-" + "email",
    "session" + "_" + "context", "session" + "Context",
    "credential" + "_" + "org", "credential" + "Org", "credential" + "_" + "org" + "_" + "id",
))
ACCOUNT_FIELDS = key_value_pattern((
    "account" + "Id", "account" + "ID", "account" + "_" + "id",
    "account" + "-" + "id", "account" + "Uuid", "account" + "_" + "uuid",
    "account" + "-" + "uuid", "user" + "Id", "user" + "_" + "id",
    "user" + "-" + "id",
))
ORGANIZATION_FIELDS = key_value_pattern((
    "organization" + "Uuid", "organization" + "_" + "uuid",
    "organization" + "-" + "uuid", "organization" + "Id",
    "organization" + "_" + "id", "organization" + "-" + "id",
    "org" + "Id", "org" + "_" + "id", "org" + "-" + "id",
    "org" + "Uuid", "org" + "_" + "uuid", "org" + "-" + "uuid",
))
# A value that marks absence is not a leaked secret. The list is syntactic on
# purpose: no word may excuse a value, or redaction markers would.
ABSENT_VALUE = re.compile(
    r"^(?:null|None|true|false|N/?A|\.{2,}|<[^<>]*>)$", re.IGNORECASE)

# No dot in the trailing lookahead: the greedy domain backtracks so the top
# label ends before a sentence period, and an address ending a sentence still
# flags without swallowing the period.
EMAIL = re.compile(
    r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"(?![A-Za-z0-9-])")
NOREPLY_LOCAL = frozenset({
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
    "do_not_reply", "noresponse", "no-response", "no_response",
    "mailer-daemon", "mailer_daemon",
})
USERS_NOREPLY_DOMAIN = "users.noreply.github.com"
# RFC 2606 names can never receive mail, so they can never be a leak.
RESERVED_DOMAINS = frozenset({
    "example", "example.com", "example.net", "example.org",
    "test", "invalid", "localhost",
})


def public_noreply(address):
    local, _, domain = address.rpartition("@")
    local, domain = local.lower(), domain.lower()
    if local in NOREPLY_LOCAL:
        return True
    if domain == USERS_NOREPLY_DOMAIN:
        return True
    return any(domain == r or domain.endswith("." + r) for r in RESERVED_DOMAINS)


OPAQUE_ID = re.compile(
    r"(?<![A-Za-z0-9_-])(?:org|acct|account)[_-][A-Za-z0-9]{6,}"
    r"(?![A-Za-z0-9_-])")
UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
ACCOUNT_CONTEXT = re.compile(
    r"\b(?:account|org(?:anization)?s?|user|identity|credential)s?\b", re.IGNORECASE)

# A path is a suspect only with a concrete user or run marker: bare ~/ notes
# and placeholder users name nobody. The placeholder set is structural, not a
# word list: these segments carry no identity by construction.
PLACEHOLDER_USER = re.compile(
    r"^(?:user|username|\*|\$USER|\$\{USER\}|<[^<>]*>)$", re.IGNORECASE)
HARNESS_NAMES = (
    "claude", "codex", "mimo", "grok", "pi", "agy", "muse",
    "postmaster", "anthropic", "openai",
)
# One literal uses a single-character class break (/ro[o]t/) so the pattern
# source is not a match of itself; every other literal below is already broken
# by the regex syntax around it, which the self-test's source control proves.
# Absolute paths only: a home or root directory under a variable or a relative
# parent ($tmp/root, $d/home) is scratch scaffolding, not a leak. The lookbehind
# keeps PATH-style lists (preceded by a colon) matching.
PRIVATE_PATH = re.compile(
    r"(?<![A-Za-z0-9_.$}~.-])(?:/home/|/Users/)([A-Za-z0-9._-]+)(?=/|$)"
    r"|(?<![A-Za-z0-9_.$}~.-])/ro[o]t/[A-Za-z0-9._-]+"
    r"|(?<![A-Za-z0-9_])~(?!\.)[A-Za-z0-9._-]+/[^\s\"'<>),;]*"
    r"|(?<![A-Za-z0-9_.$}~.-])/tmp/(?:" + "|".join(HARNESS_NAMES)
    + r")(?:-[A-Za-z0-9._-]+|/[^\s\"'<>),;]+)"
    r"|(?<![A-Za-z0-9_])[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)(?=$|\\)",
    re.IGNORECASE)
IPV4 = re.compile(r"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])")
IPV6 = re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])")
HEX_DIGIT = re.compile(r"[0-9A-Fa-f]")
PRIVATE_HOST = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"(?:local|internal|lan|home|tailnet|intranet|private|corp)\b")

TOKEN_PREFIXES = (
    "gh" + "p_", "gh" + "o_", "gh" + "u_", "gh" + "s_", "gh" + "r_",
    "github" + "_pat_", "sk" + "-", "sk" + "_live_", "sk" + "_test_",
    "xox" + "b-", "xox" + "p-", "xox" + "a-", "xox" + "r-", "xox" + "s-",
    "ya29" + ".",
)
TOKEN = re.compile(
    r"(?<![A-Za-z0-9])(?P<value>(?:"
    + "|".join(re.escape(p) for p in sorted(TOKEN_PREFIXES, key=len, reverse=True))
    + r")[A-Za-z0-9_./+-]{20,})")
XOX_TOKEN = re.compile(r"(?<![A-Za-z0-9])(?P<value>xox[baprs]-[A-Za-z0-9-]{10,})")
ACCESS_KEY = re.compile(r"(?<![A-Za-z0-9])(?P<value>" + "AK" + "IA" + r"[A-Z0-9]{16})(?![A-Za-z0-9])")
PEM_HEADER = re.compile(r"(?i)(?P<value>-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)")
BEARER_TOKEN = re.compile(r"(?i)\b(?P<value>Bearer\s+[A-Za-z0-9._~+/-]{20,}={0,2})")
SECRET_FIELDS = key_value_pattern((
    "api" + "_" + "key", "api" + "Key", "access" + "_" + "token",
    "access" + "Token", "refresh" + "_" + "token", "refresh" + "Token",
    "client" + "_" + "secret", "client" + "Secret", "private" + "_" + "key",
    "private" + "Key", "secret", "token", "password", "credential",
))
SECRET_VALUE = re.compile(r"(?i)^(?P<value>[A-Za-z0-9_./+=-]{20,})$")

# A .env-style assignment is one NAME=value line. The name is key-like when an
# underscore- or dash-separated component names secret-bearing material, and a
# name ending in a pointer suffix points somewhere instead of holding a secret.
# The value is a leak only when it is literal: shell and code metacharacters
# mean the line composes or calls something rather than assigning a secret.
DOTENV_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$")
DOTENV_KEYLIKE = frozenset({
    "key", "keys", "secret", "secrets", "token", "tokens", "password",
    "passwd", "pwd", "credential", "credentials", "private", "auth",
    "passphrase", "cert",
})
DOTENV_POINTER = ("_path", "_file", "_dir", "_url", "_type", "_host", "_port")
DOTENV_METACHAR = re.compile(r"[$`(){}\];|&<>\"'\\]")
DOTENV_MIN_VALUE = 8


def dotenv_finding(line):
    match = DOTENV_LINE.match(line)
    if not match:
        return None
    name, value = match.group(1), match.group(2)
    lowered = name.lower()
    if lowered.endswith(DOTENV_POINTER):
        return None
    if not (set(re.split(r"[_-]+", lowered)) & DOTENV_KEYLIKE):
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
        value = value[1:-1]
    if len(value) < DOTENV_MIN_VALUE or ABSENT_VALUE.match(value):
        return None
    if DOTENV_METACHAR.search(value):
        return None
    start = line.find(value, match.start(2))
    return (start, start + len(value), "dotenv", value)

COAUTHOR_PREFIX = "Co-Authored" + "-By:"
ASSISTANT_VENDORS = (
    "Anthropic", "ChatGPT", "Claude", "Codex", "Copilot", "Cursor",
    "Gemini", "GPT", "OpenAI",
)
ASSISTANT_ATTRIBUTION = (
    re.compile(r"(?i)^\s*" + re.escape(COAUTHOR_PREFIX) + r"\s*\S[^\n]*"),
    re.compile(
        r"(?i)^\s*(?:Generated|Created|Written|Drafted)\s+(?:with|by)\s+"
        r"(?:" + "|".join(ASSISTANT_VENDORS) + r")\b[^\n]*"),
    re.compile(r"(?i)^\s*generated-with\s*:\s*\S[^\n]*"),
)

# Genre signals only: the ticket's own words for the file, and imperative
# secrecy directives. No standing-instructions title, no private-file phrase.
PRIVATE_INSTRUCTIONS = (
    re.compile(r"(?i)^\s*#{1,6}\s+(?:private|global|personal)\s+instructions\b[^\n]*"),
    re.compile(
        r"(?i)^\s*(?:Never|Do not|Don['\u2019]t|Always|You must)\b[^\n]{0,240}"
        r"\b(?:account|private|secret|identity|email|credential|token|key)\b[^\n]*"),
)


def ip_spans(line):
    for pattern in (IPV4, IPV6):
        for match in pattern.finditer(line):
            text = match.group()
            if not HEX_DIGIT.search(text):
                continue
            try:
                address = ipaddress.ip_address(text)
            except ValueError:
                continue
            if address.is_loopback or address.is_unspecified:
                continue
            if address.is_private or address.is_link_local:
                yield match.start(), match.end(), text


def findings(line):
    found = []

    for match in SENSITIVE_KEYS.finditer(line):
        value = field_value(match)
        if value and not ABSENT_VALUE.match(value):
            start, end = value_span(match)
            found.append((start, end, "key", value))

    for pattern in (ACCOUNT_FIELDS, ORGANIZATION_FIELDS):
        for match in pattern.finditer(line):
            value = field_value(match)
            if value and not ABSENT_VALUE.match(value):
                start, end = value_span(match)
                found.append((start, end, "account-id", value))

    for match in EMAIL.finditer(line):
        value = match.group()
        if not public_noreply(value):
            found.append((match.start(), match.end(), "email", value))

    for match in OPAQUE_ID.finditer(line):
        found.append((match.start(), match.end(), "account-id", match.group()))
    if ACCOUNT_CONTEXT.search(line):
        for match in UUID.finditer(line):
            found.append((match.start(), match.end(), "account-id", match.group()))

    for match in PRIVATE_PATH.finditer(line):
        value = match.group()
        while value and value[-1] in {".", "!", "?", ":", "]", "}", chr(34), chr(96)}:
            value = value[:-1]
        user = match.group(1) if match.lastindex and match.group(1) else None
        if user is None and match.lastindex == 2:
            user = match.group(2)
        if user is not None and PLACEHOLDER_USER.match(user):
            continue
        if value:
            found.append((match.start(), match.start() + len(value), "private-path", value))

    for match in PRIVATE_HOST.finditer(line):
        found.append((match.start(), match.end(), "private-host", match.group()))
    found.extend(
        (start, end, "private-host", value) for start, end, value in ip_spans(line))

    for pattern in (TOKEN, XOX_TOKEN, ACCESS_KEY, PEM_HEADER, BEARER_TOKEN):
        for match in pattern.finditer(line):
            start, end = match.span("value")
            found.append((start, end, "token", match.group("value")))

    for match in SECRET_FIELDS.finditer(line):
        value = field_value(match)
        inner = SECRET_VALUE.match(value) if len(value) >= 20 else None
        if inner:
            start, end = value_span(match)
            # The span is the whole quoted value; the secret is all of it.
            found.append((start, end, "token", value))

    dotenv = dotenv_finding(line)
    if dotenv is not None:
        found.append(dotenv)

    for pattern in ASSISTANT_ATTRIBUTION:
        for match in pattern.finditer(line):
            found.append((match.start(), match.end(), "assistant-attribution", match.group()))

    for pattern in PRIVATE_INSTRUCTIONS:
        for match in pattern.finditer(line):
            found.append((match.start(), match.end(), "private-instructions", match.group()))

    # One suspect per match: identical spans collapse, distinct kinds stand.
    unique = {}
    for start, end, kind, value in found:
        unique[(start, end, kind, value)] = (start, end, kind, value)
    return sorted(unique.values(), key=lambda item: (item[0], item[1], item[2]))


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


def allowlist(root):
    path = root / "scripts" / "scrub-check.allow"
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return set()
    except (OSError, UnicodeError):
        notice("could not read scripts/scrub-check.allow")
    entries = set()
    for number, line in enumerate(text.splitlines(), 1):
        if line == "":
            continue
        value, tab, reason = line.partition("\t")
        if not tab or not value or not reason.strip():
            notice("scripts/scrub-check.allow line %d has no ruling reason" % number)
        entries.add(value)
        if findings(reason):
            notice("scripts/scrub-check.allow line %d ruling names a suspect; "
                   "describe it, never quote it" % number)
    return entries


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


def scan_diff(root, parent, commit, entries):
    try:
        child = subprocess.Popen(
            ["git", "diff", "--text", "--no-ext-diff", "--no-textconv",
             "--no-color", "--no-renames", "--unified=0", "--src-prefix=a/",
             "--dst-prefix=b/", parent, commit, "--"],
            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except OSError:
        notice("could not run Git")
    suspects, protected_values = [], []
    path, line_number, skipped = "", None, False
    for raw in child.stdout:
        content = raw.rstrip(b"\r\n")
        if content.startswith(b"diff --git "):
            path, line_number, skipped = "", None, False
        elif content.startswith(b"+++ ") and line_number is None:
            path = git_path(content[4:])
            skipped = (path == "scripts/scrub-check.allow")
            line_number = None
        elif content.startswith(b"@@ "):
            match = re.search(rb"\+([0-9]+)(?:,[0-9]+)?\s+@@", content)
            line_number = int(match.group(1)) if match else None
        elif line_number is not None and not skipped and content.startswith(b"+"):
            text = content[1:].decode("utf-8", errors="replace")
            matches = findings(text)
            protected_values.extend(item[3] for item in matches)
            for item in matches:
                if text not in entries and item[3] not in entries:
                    suspects.append((commit, path, line_number, item[2], item[3]))
            line_number += 1
    if child.wait() != 0:
        notice("Git could not read the requested history")
    return suspects, protected_values


def run_files(root, paths):
    entries = allowlist(root)
    suspects, protected_values = [], list(entries)
    # The repository's own allowlist holds user-ruled values; scanning it
    # would re-escalate the rulings themselves, so only that one path skips.
    allow = os.path.realpath(os.path.join(root, "scripts", "scrub-check.allow"))
    for raw_path in paths:
        if os.path.realpath(raw_path) == allow:
            continue
        try:
            handle = open(raw_path, "rb")
        except OSError:
            notice("could not read %s" % safe_path(raw_path))
        with handle:
            for number, raw in enumerate(handle, 1):
                text = raw.rstrip(b"\r\n").decode("utf-8", errors="replace")
                matches = findings(text)
                protected_values.extend(item[3] for item in matches)
                for item in matches:
                    if text not in entries and item[3] not in entries:
                        suspects.append((raw_path, number, item[2], item[3]))
    for path, line, kind, _value in sorted(suspects, key=lambda item: (item[0], item[1], item[2])):
        print("%s:%d: %s" % (safe_path(path, protected_values), line, kind))
    return 1 if suspects else 0


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
    # Allowed values still redact from reported paths: ruling a value
    # allowed must not print it.
    suspects, protected_values = [], list(entries)
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
    if isinstance(contents, bytes):
        target.write_bytes(contents)
    else:
        target.write_text(contents, encoding="utf-8")
    git(["add", "--", relative], cwd=repo)
    git([
        "-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
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
    for var in (
        "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE",
    ):
        os.environ.pop(var, None)

    failures = 0

    def ok(label, passed):
        nonlocal failures
        print("  %s %s" % ("ok  " if passed else "FAIL", label))
        if not passed:
            failures += 1

    # Every fabricated secret, assembled from pieces so this source carries no
    # matchable form. Each positive control also asserts none of these values
    # reaches stdout.
    AT = "@"
    sample_email = "lane-413" + AT + "relay-413" + ".net"
    private_ip = ".".join(("10", "135", "4", "13"))
    private_host = "metrics" + ".inter" + "nal"
    private_path = "/" + "home" + "/" + "fixture-user-413" + "/notes.txt"
    scratch_path = "/tmp/" + "clau" + "de-413" + "/scratch/notes.md"
    fake_token = "s" + "k-" + "fictional413keyK7mQ2xZ9aVbN4qy7"
    fake_key_id = "AK" + "IA" + "X" * 16
    fake_org_id = "org-" + "fictional413relayK7mQ2xZ9"
    fake_uuid = "41313513-0042" + "-" + "4c1d-9e5f-135135135135"
    fake_account = "123456789012"
    key_user = "user" + "Email"
    key_session = "session" + "_" + "context"
    key_cred = "credential" + "_" + "org"
    key_org = "organization" + "Uuid"
    coauthored = "Co-Authored" + "-By: "
    secrets = [
        sample_email, private_ip, private_host, private_path, scratch_path,
        fake_token, fake_key_id, fake_org_id, fake_uuid, fake_account,
        "fixture-session-413", "fixture-org-413", "withheld",
    ]

    def silent(result):
        return result is not None and all(v not in result.stdout for v in secrets)

    try:
        with tempfile.TemporaryDirectory(prefix="scrub-check-") as directory:
            scratch = pathlib.Path(directory)
            repo = scratch / "base"
            repo.mkdir()
            git(["init", "-q", "--initial-branch=main"], cwd=repo)
            git(["config", "user.name", "Fixture"], cwd=repo)
            git(["config", "user.email", FIXTURE_MAILBOX], cwd=repo)
            (repo / "scripts").mkdir()
            (repo / "scripts" / "scrub-check.sh").write_bytes(SCRIPT.read_bytes())
            git(["add", "scripts/scrub-check.sh"], cwd=repo)
            git(["commit", "-qm", "base"], cwd=repo)
            last = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()

            def pos(kind, text, name):
                nonlocal last
                head = add_fixture(repo, "fixtures/%s.txt" % name, text, "positive fixture")
                result = run_child([last, head], repo)
                lines = [] if result is None else result.stdout.splitlines()
                expected = "%s:fixtures/%s.txt:1: %s" % (head, name, kind)
                good = bool(
                    result and result.returncode == 1 and lines == [expected]
                    and silent(result))
                ok("a fixture carrying %s is reported without its value" % kind, good)
                last = head

            def neg(text, name, label):
                nonlocal last
                head = add_fixture(repo, "fixtures/%s.txt" % name, text, "clean fixture")
                result = run_child([last, head], repo)
                good = bool(result and result.returncode == 0 and not result.stdout)
                ok(label, good)
                last = head

            print("source control: the scanner does not flag itself")
            source_check = run_child(["--history", "HEAD"], repo)
            ok("the scanner source is clean in its own history", bool(
                source_check and source_check.returncode == 0 and not source_check.stdout))

            print("positive controls: each kind is flagged on a fixture that carries it")
            pos("key", '{"%s": "withheld"}\n' % key_user, "pos-key")
            pos("key", '{"%s": "fixture-session-413"}\n' % key_session, "pos-key-session")
            pos("key", '{"%s": "fixture-org-413"}\n' % key_cred, "pos-key-cred")
            pos("email", "contact: " + sample_email + "\n", "pos-email")
            pos("email", "write to " + sample_email + ".\n", "pos-email-final")
            pos("account-id", "owner " + fake_org_id + "\n", "pos-org-id")
            pos("account-id", '{"%s": "%s"}\n' % (key_org, fake_uuid), "pos-org-field")
            pos("account-id", "account ref " + fake_uuid + "\n", "pos-uuid-context")
            pos("account-id", "account" + "Id: " + fake_account + "\n", "pos-account-field")
            pos("private-path", "source under " + private_path + "\n", "pos-home-path")
            pos("private-path", "cache under " + scratch_path + "\n", "pos-scratch-path")
            pos("private-host", "endpoint " + private_ip + ":8080\n", "pos-private-ip")
            pos("private-host", "status at https://" + private_host + ":8443/up\n", "pos-private-host")
            pos("token", "relay key " + fake_token + "\n", "pos-token")
            pos("token", "relay id " + fake_key_id + "\n", "pos-access-key")
            pos("token", "api_key: " + "z" * 32 + "\n", "pos-secret-field")
            pos("token", "-----BEGIN " + "PRIVATE KEY-----\n", "pos-pem-header")
            pos("assistant-attribution", coauthored + "Imaginary Aide\n", "pos-attribution")
            pos("assistant-attribution", 'Generated with Claude\n', "pos-generated")
            pos("private-instructions", "# Global instructions for this fixture\n", "pos-stanza")
            pos("private-instructions",
                "Never copy a fixture credential into a ticket\n", "pos-directive")
            pos("dotenv", 'SESSION_SECRET=relay-413-quiet\n', "pos-dotenv")

            print("negative controls: clean lines stay silent")
            neg("the ship card lists each check and its exit code\n",
                "neg-plain", "a plain sentence is clean")
            neg("reach the relay at " + "99999999+fictional" + AT
                + "users.noreply.github.com for pings\n",
                "neg-noreply-domain", "a GitHub no-reply address is clean")
            neg("write " + "noreply" + AT + "no-such-vendor-413.net instead\n",
                "neg-noreply-local", "a no-reply local part is clean on any domain")
            neg("TOKEN_TYPE=Bearer\n",
                "neg-dotenv-pointer", "a key-like name pointing elsewhere is clean")
            neg("SESSION_SECRET=${STAGING}_relay_secret_413\n",
                "neg-dotenv-composed", "a composed assignment value is clean")
            neg("write " + "someone" + AT + "example.org for the demo\n",
                "neg-reserved-example", "a reserved example domain is clean")
            neg("write " + "someone" + AT + "thing.test for the demo\n",
                "neg-reserved-test", "a reserved test domain is clean")
            neg("write " + "someone" + AT + "thing.invalid for the demo\n",
                "neg-reserved-invalid", "a reserved invalid domain is clean")
            neg("write " + "person" + AT + "mail.localhost for the demo\n",
                "neg-reserved-localhost", "a localhost domain is clean")
            neg('{"userEmail": null}\n',
                "neg-key-null", "a null key value is clean")
            neg('{"userEmail": true}\n',
                "neg-key-bool", "a boolean key value is clean")
            neg('{"userEmail": "..."}\n',
                "neg-key-ellipsis", "an elided key value is clean")
            neg('{"userEmail": "<redacted>"}\n',
                "neg-key-bracketed", "a bracketed key value is clean")
            neg('{"userEmail": "N/A"}\n',
                "neg-key-na", "an N/A key value is clean")
            neg('{"userEmail": ""}\n',
                "neg-key-empty", "an empty key value is clean")
            neg("the userEmail field is redacted before promotion\n",
                "neg-key-prose", "a bare key name in prose is clean")
            neg("assign the org-chart-2024 to the team\n",
                "neg-org-compound", "a compound org word is not an id")
            neg("see org-ab12 for the demo\n",
                "neg-org-short", "a short org token is not an id")
            neg("the account-id kind covers org ids\n",
                "neg-kind-name", "the kind name itself is clean")
            neg("schema example " + fake_uuid + "\n",
                "neg-uuid-bare", "a UUID with no id context is clean")
            neg("notes under ~/Code/notes.txt\n",
                "neg-tilde-bare", "a bare home reference names nobody")
            neg("keys live in ~/.ssh/id_rsa\n",
                "neg-tilde-dotdir", "a generic dot directory names nobody")
            neg("read /home/user/docs for the layout\n",
                "neg-user-placeholder", "a placeholder user is clean")
            neg("read /home/$USER/docs for the layout\n",
                "neg-user-var", "a variable user is clean")
            neg("read /home/<user>/docs for the layout\n",
                "neg-user-bracketed", "a bracketed user is clean")
            neg("/tmp/pip-install-9 holds wheels\n",
                "neg-tmp-lookalike", "a lookalike temp dir is clean")
            neg('mkdir -p "$tmp/root/scripts" for the case\n',
                "neg-var-root", "a root dir under a variable is scaffolding")
            neg('mkdir -p "$d/home/user" for the case\n',
                "neg-var-home", "a home dir under a variable is scaffolding")
            neg("/tmp/codex is a product name\n",
                "neg-tmp-bare", "a bare harness name with no run marker is clean")
            neg("proxy at 127.0.0.1:9\n",
                "neg-loopback-v4", "loopback is universal, not private")
            neg("loopback ::1 answers\n",
                "neg-loopback-v6", "v6 loopback is universal, not private")
            neg("the gateway moved to 8.8.8.8 last month\n",
                "neg-public-ip", "a public IP is clean")
            neg("docs live on the project pages site\n",
                "neg-public-host", "a public hostname is clean")
            neg("serve on localhost:3000\n",
                "neg-localhost", "the loopback name is clean")
            neg("empty v6 :: stays\n",
                "neg-unspecified", "an empty address is clean")
            neg("commit = 89abcdef0123456789abcdef0123456789abcdef\n",
                "neg-hex-sha", "a hex sha under a plain field is not a token")
            neg("token: short\n",
                "neg-token-short", "a short secret-field value is clean")
            neg("auth Bearer <token> here\n",
                "neg-bearer-placeholder", "a placeholder bearer value is clean")
            neg("prefix sk-abc is short\n",
                "neg-prefix-short", "a short prefixed value is clean")
            neg("the commit trailer policy forbids crediting an assistant\n",
                "neg-attribution-talk", "attribution discussion without a trailer is clean")
            neg("Generated by Makefile for this repo\n",
                "neg-generated-tool", "a tool credit is not an assistant")
            neg("## Standing instructions for on-call\n",
                "neg-standing-other", "process instructions are not the private file")
            neg("Never start a leg without its hand-off\n",
                "neg-directive-plain", "a directive with no secrecy noun is clean")
            neg("Secrets never enter a repository\n",
                "neg-noun-first", "a secrecy noun without a directive is clean")

            print("history controls: a line added and then deleted is still flagged")
            added = add_fixture(repo, "leak.txt", "contact: " + sample_email + "\n", "add leak")
            gone_path = repo / "leak.txt"
            gone_path.unlink()
            git(["add", "--", "leak.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "delete the leak at the tip"], cwd=repo)
            deleted = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            covered = run_child([last, deleted], repo)
            ok("a line added and then deleted is still flagged", bool(
                covered and covered.returncode == 1
                and covered.stdout.splitlines() == ["%s:leak.txt:1: email" % added]
                and sample_email not in covered.stdout))
            last = deleted
            seen_history = run_child(["--history", "HEAD"], repo)
            ok("--history sees a line added and then deleted", bool(
                seen_history and seen_history.returncode == 1
                and any(ln.startswith(added + ":leak.txt:1: email") for ln in seen_history.stdout.splitlines())
                and sample_email not in seen_history.stdout))

            print("allowlist controls: a ruled match stays silent, an unruled one does not")
            pending = add_fixture(
                repo, "pending.txt", "contact: " + sample_email + "\n", "pending ruling")
            pending_result = run_child([last, pending], repo)
            ok("a not-yet-allowed match is reported", bool(
                pending_result and pending_result.returncode == 1
                and sample_email not in pending_result.stdout))
            (repo / "scripts").mkdir(exist_ok=True)
            (repo / "scripts" / "scrub-check.allow").write_text(
                sample_email + "\tself-test ruling: the lane's relay address\n",
                encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "allow one ruled value"], cwd=repo)
            ruled = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            ruled_result = run_child([last, ruled], repo)
            ok("an exact allowed value suppresses the earlier match", bool(
                ruled_result and ruled_result.returncode == 0 and not ruled_result.stdout))
            whole = '{"%s": "whole-line-allowed-99"}\n' % key_user
            whole_head = add_fixture(repo, "whole.txt", whole, "whole line fixture")
            (repo / "scripts" / "scrub-check.allow").write_text(
                sample_email + "\tself-test ruling: the lane's relay address\n"
                + whole.rstrip("\n") + "\tself-test ruling: the whole line\n",
                encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "allow the whole line"], cwd=repo)
            whole_ruled = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            whole_result = run_child([last, whole_ruled], repo)
            ok("an exact allowed added line is suppressed", bool(
                whole_result and whole_result.returncode == 0 and not whole_result.stdout))
            (repo / "scripts" / "scrub-check.allow").write_text("", encoding="utf-8")
            git(["add", "scripts/scrub-check.allow"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "remove the ruling"], cwd=repo)
            revoked = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            revoked_result = run_child([pending, revoked], repo)
            ok("a match without a current allowance escalates again", bool(
                revoked_result and revoked_result.returncode == 1
                and sample_email not in revoked_result.stdout))
            (repo / "scripts" / "scrub-check.allow").write_text(
                sample_email + "\n", encoding="utf-8")
            reasonless = run_child([revoked, revoked], repo)
            ok("an allowlist entry without a reason is refused, exit 2", bool(
                reasonless and reasonless.returncode == 2
                and not reasonless.stdout
                and sample_email not in reasonless.stderr))
            (repo / "scripts" / "scrub-check.allow").write_text("", encoding="utf-8")
            last = revoked

            print("usage, range and robustness controls")
            help_result = run_child(["--help"], repo)
            ok("--help exits 0 on stderr with no stdout", bool(
                help_result and help_result.returncode == 0
                and not help_result.stdout and "usage:" in help_result.stderr))
            for args, label in (([], "no arguments"), (["main"], "one range argument"),
                                (["--files"], "files without paths"),
                                (["--history", "a", "b"], "three history arguments")):
                usage_result = run_child(args, repo)
                ok("%s is a usage error, exit 2" % label, bool(
                    usage_result and usage_result.returncode == 2 and not usage_result.stdout))
            empty = run_child([last, last], repo)
            ok("an empty commit range is clean", bool(
                empty and empty.returncode == 0 and not empty.stdout))
            blob_head = add_fixture(
                repo, "blob.bin", bytes(range(0x80, 0x100)) * 3, "binary addition")
            blob = run_child([last, blob_head], repo)
            ok("a binary addition scans clean without crashing", bool(
                blob and blob.returncode == 0 and not blob.stdout))
            last = blob_head
            redacted_path = "contact-" + "lane-413" + AT + "relay-413" + ".net.txt"
            redacted_head = add_fixture(
                repo, redacted_path, "contact: " + sample_email + "\n", "path redaction")
            redacted = run_child([last, redacted_head], repo)
            ok("a matched value in a reported path is redacted", bool(
                redacted and redacted.returncode == 1
                and sample_email not in redacted.stdout
                and "[redacted]" in redacted.stdout))
            last = redacted_head

            print("file controls: --files scans worktree files, streamed")
            (repo / "loose.txt").write_text(
                "contact: " + sample_email + "\n", encoding="utf-8")
            loose = run_child(["--files", "loose.txt"], repo)
            ok("--files reports a suspect in an uncommitted file", bool(
                loose and loose.returncode == 1
                and loose.stdout.splitlines() == ["loose.txt:1: email"]
                and silent(loose)))
            (repo / "plain.txt").write_text(
                "ordinary public sample\n", encoding="utf-8")
            plain = run_child(["--files", "plain.txt"], repo)
            ok("--files stays silent on a clean file", bool(
                plain and plain.returncode == 0 and not plain.stdout))
            missing = run_child(["--files", "no-such-file.txt"], repo)
            ok("--files on a missing file exits 2", bool(
                missing and missing.returncode == 2 and not missing.stdout))
            big_text = ("clean relay line 413 pad " * 100 + "\n") * 70000
            big_head = add_fixture(
                repo, "big.txt",
                big_text + "contact: " + sample_email + "\n", "big addition")
            try:
                limited = subprocess.run(
                    ["bash", "-c", "ulimit -v 262144 || exit 99; exec \"$0\" \"$@\"",
                     str(SCRIPT), last, big_head],
                    cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, encoding="utf-8", errors="replace", check=False)
            except OSError:
                limited = None
            ok("a large addition streams under a small address space", bool(
                limited and limited.returncode == 1
                and limited.stdout.splitlines()
                == ["%s:big.txt:70001: email" % big_head]
                and silent(limited)))
            last = big_head
            fresh = scratch / "fresh"
            fresh.mkdir()
            git(["init", "-q", "--initial-branch=main"], cwd=fresh)
            git(["config", "user.name", "Fixture"], cwd=fresh)
            git(["config", "user.email", FIXTURE_MAILBOX], cwd=fresh)
            (fresh / "notes.txt").write_text("ordinary public sample\n", encoding="utf-8")
            git(["add", "notes.txt"], cwd=fresh)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-qm", "base"], cwd=fresh)
            fresh_history = run_child(["--history"], fresh)
            ok("--history on a clean history is silent", bool(
                fresh_history and fresh_history.returncode == 0 and not fresh_history.stdout))

            print("the scanner's own branch scans clean")
            real = root
            real_base = git(["rev-parse", "main"], cwd=real).decode("ascii",
                                                                    errors="strict").strip()
            real_head = git(["rev-parse", "HEAD"], cwd=real).decode("ascii",
                                                                    errors="strict").strip()
            branch = run_child([real_base, real_head], real)
            ok("this branch scans clean", bool(
                branch and branch.returncode == 0 and not branch.stdout))
    except SystemExit:
        raise
    except Exception:
        ok("self-test fixture setup and scan", False)

    print("self-test: all controls behaved" if failures == 0
          else "self-test: %d control(s) failed" % failures)
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
    if args and args[0] == "--files":
        if len(args) < 2:
            notice(USAGE)
        return run_files(root, args[1:])
    if len(args) != 2 or any(arg.startswith("--") for arg in args):
        notice(USAGE)
    base, head = resolve_commit(args[0]), resolve_commit(args[1])
    return run_scan(root, commits_for_range(base, head))


try:
    raise SystemExit(main(sys.argv[1:]))
except BrokenPipeError:
    print("scrub-check: output truncated; the scan did not finish", file=sys.stderr)
    raise SystemExit(2)
except SystemExit:
    raise
except Exception:
    print("scrub-check: scan failed", file=sys.stderr)
    raise SystemExit(2)
PY
