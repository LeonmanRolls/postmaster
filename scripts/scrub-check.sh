#!/usr/bin/env bash
# The one check for private data: a single rule table serving the gate, the
# wiki scrub and the history rewrite. It scans everything a change would
# publish: the added lines of every commit from its base to its head, so a
# line added and then deleted is still found; the names of added files;
# each commit message; the lines each merge commit introduces beyond every
# parent, so already-published lines merge quietly; and, through
# --pr-description, the pull request's description before it is opened.
#
#   scrub-check.sh <base> <head>    the range: added lines, messages and
#                                   merge resolutions, one suspect per line
#   scrub-check.sh --files <path>... worktree files, streamed line by line
#   scrub-check.sh --files-inert <path>...
#                                   worktree files with marker syntax inert,
#                                   for names and pages, where a marker
#                                   suppresses nothing and faults nothing
#   scrub-check.sh --pr-description <file>
#                                   pull request text, scanned like a message
#   scrub-check.sh --spans <path>... machine protocol for the wiki scrub:
#                                   <index>:<line>:<start>:<end>:<rule> per
#                                   finding, the file indexing into argv
#   scrub-check.sh --safe-path <path>...
#                                   print each path redacted, one per line
#   scrub-check.sh --log-detection <rule> <file> <line> [<commit>]
#                                   append one detection for a check that
#                                   scanned through a stand-in path
#   scrub-check.sh --help           usage, exit 0
#   scrub-check.sh --self-test      controls, one ok line each, exit 0 when all pass
#
# One suspect per line on stdout as <commit>:<path>:<line>: <kind>, where
# <commit> is the full 40-character sha, <path> the repo-relative file, <line>
# the added line's number in the new file (0 when the finding is the file's
# own name), and <kind> the rule name below.
# Messages print <commit>:(message):<line>: <kind>; --files prints
# <path>:<line>: <kind> and --pr-description (pr-description):<line>: <kind>,
# since neither has a commit. A matched value is never printed: not in a
# suspect line, not in a notice, not in a diagnostic, not in a self-test; a
# value that reaches a reported path is redacted. Human notices go to stderr.
# The scan is read-only. Every scan streams: diffs and files are read line by
# line, so memory is bounded by the longest line, never by the file. It needs
# nothing beyond the gate's: bash, git and the Python standard library.
#
# The rules, matched by shape and context, never against anyone's values:
#   key                   a named contact, session or credential key with a
#                         value that is present, not an absence marker
#                         (userEmail, session_context, credential_org and
#                         their case forms)
#   email                 an address that is neither a public no-reply form
#                         nor on a reserved domain
#   account-id            an opaque org, account or session token whose
#                         body carries a digit, a UUID on a line with
#                         account context, or a populated account or
#                         organization id field
#   private-path          a home directory with a concrete user, or harness
#                         scratch with a run marker; bare ~/ references and
#                         placeholder users are not suspects
#   private-host          a private, link-local, unique-local or carrier-grade
#                         IP literal (never loopback), or a private-network
#                         hostname, tailnet names included
#   token                 a documented key prefix with a body, a private-key
#                         header, a Bearer credential, or a long value under
#                         a secret-bearing field
#   dotenv                a .env-style NAME=value assignment whose name is
#                         key-like and whose value is present and literal
#   assistant-attribution an authorship trailer or generated-with footer
#   marker                a made-up-data marker that suppresses nothing, or
#                         marker-shaped text beside a finding it does not
#                         validly suppress (markers never name it)
#
# Text from shared instruction files is not private data in itself: the
# script looks for personal data and secrets only.
#
# Made-up data that looks like personal data is marked inline, never ruled
# on: `private-data:allow <rule> -- <reason>` on the finding's own line, or
# `private-data:allow-next-line <rule> -- <reason>` on the line above, with
# a real rule in place of <rule>. The marker names one rule and suppresses
# that rule's findings on its line, except inside the marker's own text,
# whose reason must never quote a suspect; the next-line form suppresses
# its rule on the very next line instead. Each marker must suppress at
# least one finding the others did not, same-line markers first: a
# redundant marker faults like an unused one. A marker that suppresses
# nothing fails the check, and marker-shaped text that names no rule,
# gives no reason or names an unknown rule fails it too when its line
# carries a finding, both as a marker finding. The same text on a line
# with no findings is prose, never a fault. Markers travel with the
# data's commit: in a diff only added lines carry them, and a merge
# resolution never reports a finding twice. A merge is scanned for the
# added lines it shares with no parent: a file the merge leaves equal to
# any parent is skipped whole, and of a file it changes only the lines no
# parent holds are scanned, so a merge from the default branch reports the
# conflict resolutions, never the branch's own past. They do not apply in
# commit messages or pull request text, which are scanned with marker
# syntax inert. There is no exceptions file and no baseline: a finding
# fails the gate like any lint error, and the coachman fixes it.
#
# When POSTMASTER_DETECTIONS_LOG names a file, every finding but a marker
# fault is appended there as it happens, kept or suppressed alike, one
# JSON object per line with the rule, the redacted file, the line and the
# commit, never the value. A match a valid marker suppresses carries
# "via": "marker", so the ship card can resolve it as marked made-up data.
# The gate runner sets it; self-tests and manual runs leave it unset and
# log nothing. An empty value logs nothing. A log that cannot be written
# fails the check. A check that scans through a stand-in path (a blob
# staged under a temporary name) scans with the variable emptied and calls
# --log-detection with the real path, so one finding is logged once.
#
# --safe-path redacts private-shaped spans from each given path, for
# diagnostics that name a file. It exits 2 when the repository cannot be
# read; a caller that cannot redact must fail, never print the path raw.
#
# SCRUB_CHECK_DISABLE names rules to switch off, comma- or space-separated,
# as a test hook only: rule names switch off those rules, `messages`
# switches off commit message scans, `merges` merge resolution scans, and
# `markers` marker handling whole. The self-test proves every control fails
# with its rule switched off. The gate never sets it; when set, a notice on
# stderr names what is off, so no silenced run passes as a real one.
#
#   exit 0  clean: no suspect in the range (or files, or the description)
#   exit 1  suspects, one per line on stdout
#   exit 2  usage, an unreadable range, an unreadable file, or a detections
#           log that cannot be written (--spans, --safe-path and
#           --log-detection exit 0 or 2) or a scan that could not finish
set -uo pipefail
SELF=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")
SCRUB_CHECK_SCRIPT="$SELF" python3 -I - "$@" <<'PY'
import ast
import datetime
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile


USAGE = ("usage: scrub-check.sh <base> <head> | --files <path>... | "
         "--files-inert <path>... | --pr-description <file> | --spans <path>... | "
         "--safe-path <path>... | --log-detection <rule> <file> <line> [<commit>] | "
         "--self-test | --help")
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SCRIPT = pathlib.Path(os.environ.get("SCRUB_CHECK_SCRIPT", "")).resolve()
FIXTURE_MAILBOX = "fixture" + "@" + "example.invalid"
DISABLED = frozenset(os.environ.get("SCRUB_CHECK_DISABLE", "").replace(",", " ").split())


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


# The body must carry a digit: opaque machine ids always do, and without
# one the shape is a name (session_context), not an id.
OPAQUE_ID = re.compile(
    r"(?<![A-Za-z0-9_-])(?:org|acct|account|sess|ses|session)[_-](?=\S*[0-9])[A-Za-z0-9]{6,}"
    r"(?![A-Za-z0-9_-])")
UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
ACCOUNT_CONTEXT = re.compile(
    r"\b(?:account|org(?:anization)?s?|user|identity|credential|session|thread)s?\b",
    re.IGNORECASE)

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
# A home user ends where its name ends: a quote, a space or the line end
# after a bare directory is still a home directory, not just a trailing
# slash. The fixed literal prefixes make that widening safe; a bare tilde
# keeps its slash, because a one-character anchor without one matches
# binary noise hundreds of times over.
PRIVATE_PATH = re.compile(
    r"(?<![A-Za-z0-9_.$}~.-])(?:/home/|/Users/)([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])"
    r"|(?<![A-Za-z0-9_.$}~.-])/ro[o]t/[A-Za-z0-9._-]+"
    r"|(?<![A-Za-z0-9_])~(?!\.)([A-Za-z0-9._-]+)/[^\s\"'<>),;]*"
    r"|(?<![A-Za-z0-9_.$}~.-])/tmp/(?:" + "|".join(HARNESS_NAMES)
    + r")(?:-[A-Za-z0-9._-]+|/[^\s\"'<>),;]+)"
    r"|(?<![A-Za-z0-9_])[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])",
    re.IGNORECASE)
IPV4 = re.compile(r"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])")
IPV6 = re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])")
HEX_DIGIT = re.compile(r"[0-9A-Fa-f]")
PRIVATE_HOST = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"(?:local|internal|lan|home|tailnet|intranet|private|corp)\b")
# A tailnet node address names a private node; the bare suffix names none.
TS_NET = re.compile(
    r"(?i)(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"ts\.net\b")
# Built from pieces: the literal network is itself a carrier-grade address.
CGNAT = ipaddress.ip_network("100.64." + "0.0/10")

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
    # A quoted value may carry a trailing comment: readers take the quoted
    # span and ignore the rest, so the scan does too. Anything else after the
    # closing quote means the line composes a value, and the whole value keeps
    # its quote characters and fails the literal check below.
    if len(value) >= 2 and value[0] in {"\"", "'"}:
        end = value.find(value[0], 1)
        if end > 0:
            rest = value[end + 1:].strip()
            if rest == "" or rest.startswith("#"):
                value = value[1:end]
    elif re.match(r"#(\s|$)", value):
        # A comment on its own assigns nothing.
        value = ""
    else:
        # An unquoted value ends where its comment starts: without the
        # strip, a metacharacter in the comment would excuse the secret
        # before it. A hash without a blank before it stays literal.
        value = re.split(r"\s+#", value, maxsplit=1)[0]
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
            if address.is_private or address.is_link_local or address in CGNAT:
                yield match.start(), match.end(), text


def findings(line):
    found = []

    if "key" not in DISABLED:
        for match in SENSITIVE_KEYS.finditer(line):
            value = field_value(match)
            if value and not ABSENT_VALUE.match(value):
                start, end = value_span(match)
                found.append((start, end, "key", value))

    if "account-id" not in DISABLED:
        for pattern in (ACCOUNT_FIELDS, ORGANIZATION_FIELDS):
            for match in pattern.finditer(line):
                value = field_value(match)
                if value and not ABSENT_VALUE.match(value):
                    start, end = value_span(match)
                    found.append((start, end, "account-id", value))

    if "email" not in DISABLED:
        for match in EMAIL.finditer(line):
            value = match.group()
            if not public_noreply(value):
                found.append((match.start(), match.end(), "email", value))

    if "account-id" not in DISABLED:
        for match in OPAQUE_ID.finditer(line):
            found.append((match.start(), match.end(), "account-id", match.group()))
        if ACCOUNT_CONTEXT.search(line):
            for match in UUID.finditer(line):
                found.append((match.start(), match.end(), "account-id", match.group()))

    if "private-path" not in DISABLED:
        for match in PRIVATE_PATH.finditer(line):
            value = match.group()
            while value and value[-1] in {".", "!", "?", ":", "]", "}", chr(34), chr(96)}:
                value = value[:-1]
            # The user is whichever group took part: home, tilde or drive path.
            user = next(
                (match.group(i) for i in range(1, (match.lastindex or 0) + 1)
                 if match.group(i) is not None),
                None,
            )
            if user is not None and PLACEHOLDER_USER.match(user):
                continue
            if value:
                found.append((match.start(), match.start() + len(value), "private-path", value))

    if "private-host" not in DISABLED:
        for match in PRIVATE_HOST.finditer(line):
            found.append((match.start(), match.end(), "private-host", match.group()))
        for match in TS_NET.finditer(line):
            found.append((match.start(), match.end(), "private-host", match.group()))
        found.extend(
            (start, end, "private-host", value) for start, end, value in ip_spans(line))

    if "token" not in DISABLED:
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

    if "dotenv" not in DISABLED:
        dotenv = dotenv_finding(line)
        if dotenv is not None:
            found.append(dotenv)

    if "assistant-attribution" not in DISABLED:
        for pattern in ASSISTANT_ATTRIBUTION:
            for match in pattern.finditer(line):
                found.append((match.start(), match.end(), "assistant-attribution", match.group()))

    # One suspect per match: identical spans collapse, distinct kinds stand.
    unique = {}
    for start, end, kind, value in found:
        unique[(start, end, kind, value)] = (start, end, kind, value)
    return sorted(unique.values(), key=lambda item: (item[0], item[1], item[2]))


RULES = frozenset({
    "key", "account-id", "email", "private-path", "private-host",
    "token", "dotenv", "assistant-attribution",
})
MARKER_LOOSE = re.compile(r"(?<![A-Za-z0-9_.-])private-data:allow")
MARKER_VALID = re.compile(r"private-data:allow(-next-line)?\s+(\S+)\s+--\s+(\S.*)$")
MARKER_BOUNDARY = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")


def parse_markers(line):
    """Split a line's marker heads into dicts with span, rule and validity.

    A head is valid only with a known rule and a reason; anything else is
    marker-shaped text, which faults only beside a finding and is prose
    otherwise. The next-line suffix counts with a word boundary, so a longer
    word sharing its prefix stays a same-line head.
    """
    heads = [match.start() for match in MARKER_LOOSE.finditer(line)]
    parsed = []
    for i, start in enumerate(heads):
        stop = heads[i + 1] if i + 1 < len(heads) else len(line)
        body = MARKER_VALID.match(line[start:stop])
        rule = body.group(2) if body else None
        rest = line[start + len("private-data:allow"):]
        if rest.startswith("-next-line") and (
                len(rest) == len("-next-line") or rest[len("-next-line")] not in MARKER_BOUNDARY):
            next_line = True
        else:
            next_line = bool(body and body.group(1))
        parsed.append({"span": (start, stop), "next_line": next_line,
                       "rule": rule if body and rule in RULES else None,
                       "valid": bool(body) and rule in RULES})
    return parsed


class LineScanner:
    """Streaming marker-aware line scanner for one line sequence.

    Feed (number, text) in file order; a next-line marker applies only to
    the very next fed line. Each valid marker must suppress at least one
    finding the others did not, same-line markers first: a redundant marker
    faults like an unused one. A marker never suppresses inside its own
    text, so a reason that quotes a suspect always flags, and the marker
    faults beside it for suppressing nothing. Marker-shaped text that is
    not a valid marker faults only when its line carries a finding; on a
    clean line it is prose. With markers disabled the feed passes findings
    through untouched. Faults are (number, start, end) triples, kept and
    suppressed are (number, start, end, kind, value).
    """

    def __init__(self, find=findings, markers=True):
        self._find = find
        self._prev = None
        self._off = (not markers) or "markers" in DISABLED
        self.kept = []
        self.faults = []
        self.suppressed = []

    def feed(self, number, text):
        raw = self._find(text)
        if self._off:
            for start, end, kind, value in raw:
                self.kept.append((number, start, end, kind, value))
            return
        current = list(raw)
        marks = parse_markers(text)
        for mark in marks:
            if not mark["valid"] and not mark["next_line"] and raw:
                self.faults.append((number, *mark["span"]))
        for mark in [m for m in marks if m["valid"] and not m["next_line"]]:
            hits = [item for item in current
                    if item[2] == mark["rule"] and item[1] <= mark["span"][0]]
            if not hits:
                self.faults.append((number, *mark["span"]))
            else:
                for start, end, kind, value in hits:
                    self.suppressed.append((number, start, end, kind, value))
                current = [item for item in current if item not in hits]
        if self._prev is not None:
            prev_number, prev_marks = self._prev
            if prev_number == number - 1:
                for mark in prev_marks:
                    if mark["valid"]:
                        hits = [item for item in current if item[2] == mark["rule"]]
                        if not hits:
                            self.faults.append((prev_number, *mark["span"]))
                        else:
                            for start, end, kind, value in hits:
                                self.suppressed.append((number, start, end, kind, value))
                            current = [item for item in current if item not in hits]
                    elif raw:
                        self.faults.append((prev_number, *mark["span"]))
            else:
                for mark in prev_marks:
                    if mark["valid"]:
                        self.faults.append((prev_number, *mark["span"]))
        for start, end, kind, value in current:
            self.kept.append((number, start, end, kind, value))
        self._prev = (number, [m for m in marks if m["next_line"]])

    def flush(self):
        if self._prev is not None:
            prev_number, prev_marks = self._prev
            for mark in prev_marks:
                if mark["valid"]:
                    self.faults.append((prev_number, *mark["span"]))
            self._prev = None


def safe_path(path):
    spans = sorted(set((start, end) for start, end, _kind, _value in findings(path)))
    merged = []
    for start, end in spans:
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


def log_detection(rule, file, line, commit, via=""):
    target = os.environ.get("POSTMASTER_DETECTIONS_LOG", "")
    if not target:
        return
    entry = {
        "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rule": rule, "file": safe_path(file), "line": line, "commit": commit,
    }
    if via:
        entry["via"] = via
    try:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    except OSError:
        notice("the detections log could not be written")


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


def commits_with_parents(base, head):
    raw = git(["rev-list", "--parents", "--reverse", base + ".." + head])
    items = []
    for line in raw.decode("ascii", errors="strict").splitlines():
        parts = line.split()
        if not parts or any(not re.fullmatch(r"[0-9a-f]{40}", p) for p in parts):
            notice("the repository did not return full commit ids")
        items.append((parts[0], parts[1:]))
    return items


def scan_message(commit):
    if "messages" in DISABLED:
        return []
    raw = git(["show", "-s", "--format=%B", commit])
    out = []
    for number, line in enumerate(raw.decode("utf-8", errors="replace").splitlines(), 1):
        for _start, _end, kind, _value in findings(line):
            out.append(("(message)", number, kind, line))
    return out


def scan_commit_diff(root, parent, commit):
    """Added lines of parent..commit: suspects and suppressed, each as
    (path, line, kind, line text).

    One LineScanner per file, fed in new-file order, so a next-line marker
    applies to the very next added line only when it is the next line.
    Streams: only the previous line's text is kept for fault attribution.
    """
    try:
        child = subprocess.Popen(
            ["git", "diff", "--text", "--no-ext-diff", "--no-textconv",
             "--no-color", "--no-renames", "--unified=0", "--src-prefix=a/",
             "--dst-prefix=b/", parent, commit, "--"],
            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except OSError:
        notice("could not run Git")
    suspects = []
    quiet = []
    path, line_number, new_file = "", None, False
    scanner, texts, kept_len, fault_len, supp_len = None, {}, 0, 0, 0

    def drain():
        nonlocal kept_len, fault_len, supp_len
        for num, _s, _e, kind, _v in scanner.kept[kept_len:]:
            suspects.append((path, num, kind, texts[num]))
        kept_len = len(scanner.kept)
        for num, _s, _e in scanner.faults[fault_len:]:
            suspects.append((path, num, "marker", texts[num]))
        fault_len = len(scanner.faults)
        for num, _s, _e, kind, _v in scanner.suppressed[supp_len:]:
            quiet.append((path, num, kind, texts[num]))
        supp_len = len(scanner.suppressed)

    def end_file():
        nonlocal scanner, texts, kept_len, fault_len, supp_len
        if scanner is not None:
            scanner.flush()
            drain()
        scanner, texts, kept_len, fault_len, supp_len = None, {}, 0, 0, 0

    for raw in child.stdout:
        content = raw.rstrip(b"\r\n")
        if content.startswith(b"diff --git "):
            end_file()
            path, line_number, new_file = "", None, False
        elif content.startswith(b"--- ") and line_number is None:
            new_file = content[4:] == b"/dev/null"
        elif content.startswith(b"+++ ") and line_number is None:
            path = git_path(content[4:])
            line_number = None
            # An added file publishes its name too: scan it with marker
            # syntax inert, reported at line 0. A modified file's name is
            # already published, and a deletion publishes nothing.
            if new_file and path != "/dev/null":
                for _start, _end, kind, _value in findings(path):
                    suspects.append((path, 0, kind, path))
        elif content.startswith(b"@@ "):
            match = re.search(rb"\+([0-9]+)(?:,[0-9]+)?\s+@@", content)
            line_number = int(match.group(1)) if match else None
        # Inside a hunk every + line is content: file headers only appear
        # before the first hunk, where line_number is still None, so a
        # source line starting "++ " reads as content, never as a header.
        elif line_number is not None and content.startswith(b"+"):
            if scanner is None:
                scanner = LineScanner()
            text = content[1:].decode("utf-8", errors="replace")
            texts[line_number] = text
            scanner.feed(line_number, text)
            drain()
            # Evict only after the drain: a fault on the previous fed line
            # needs its text, which a hunk gap would otherwise delete first.
            for stale in [n for n in texts if n < line_number - 1]:
                del texts[stale]
            line_number += 1
    end_file()
    if child.wait() != 0:
        notice("Git could not read the requested history")
    return suspects, quiet


def changed_names(raw):
    return [os.fsdecode(part) for part in raw.split(b"\0") if part]


def added_lines(root, parent, merge, path):
    """(number, text) added lines of parent..merge for one path, in order."""
    try:
        child = subprocess.Popen(
            ["git", "diff", "--text", "--no-ext-diff", "--no-textconv",
             "--no-color", "--no-renames", "--unified=0", "--src-prefix=a/",
             "--dst-prefix=b/", parent, merge, "--", path],
            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except OSError:
        notice("could not run Git")
    out, line_number = [], None
    for raw in child.stdout:
        content = raw.rstrip(b"\r\n")
        if content.startswith(b"@@ "):
            match = re.search(rb"\+([0-9]+)(?:,[0-9]+)?\s+@@", content)
            line_number = int(match.group(1)) if match else None
        elif line_number is not None and content.startswith(b"+"):
            out.append((line_number, content[1:].decode("utf-8", errors="replace")))
            line_number += 1
    if child.wait() != 0:
        notice("Git could not read the requested history")
    return out


def scan_merge_diff(root, parents, merge):
    """The merge's own lines: suspects and suppressed, each as
    (path, line, kind, line text).

    A file the merge leaves equal to any parent is skipped whole; of a
    file it changes, only the added lines no parent holds are scanned, so
    already-published lines merge quietly. One LineScanner per file, fed
    the resolution lines in new-file order.
    """
    first, others = parents[0], parents[1:]
    changed = set(changed_names(git(["diff", "--name-only", "-z", first, merge, "--"], cwd=root)))
    for other in others:
        changed &= set(changed_names(git(["diff", "--name-only", "-z", other, merge, "--"], cwd=root)))
    suspects = []
    quiet = []
    for path in sorted(changed):
        held = [set(text for _n, text in added_lines(root, other, merge, path))
                for other in others]
        scanner, texts = LineScanner(), {}
        kept_len, fault_len, supp_len, prev_fed = 0, 0, 0, None
        for number, text in added_lines(root, first, merge, path):
            if not all(text in lines for lines in held):
                continue
            texts[number] = text
            for stale in [n for n in texts if n != number and n != prev_fed]:
                del texts[stale]
            scanner.feed(number, text)
            for num, _s, _e, kind, _v in scanner.kept[kept_len:]:
                suspects.append((path, num, kind, texts[num]))
            kept_len = len(scanner.kept)
            for num, _s, _e in scanner.faults[fault_len:]:
                suspects.append((path, num, "marker", texts[num]))
            fault_len = len(scanner.faults)
            for num, _s, _e, kind, _v in scanner.suppressed[supp_len:]:
                quiet.append((path, num, kind, texts[num]))
            supp_len = len(scanner.suppressed)
            prev_fed = number
        scanner.flush()
        for num, _s, _e in scanner.faults[fault_len:]:
            suspects.append((path, num, "marker", texts[num]))
    return suspects, quiet


def run_scan(root, base, head):
    items = commits_with_parents(base, head)
    suspects = []
    # A merge resolution never reports a finding twice: (kind, path, text)
    # triples from the commits' own diffs are reported under those commits,
    # and the merge phase drops its repeats. Messages are never deduped.
    reported = set()
    for commit, parents in items:
        if len(parents) > 1:
            continue
        parent = parents[0] if parents else EMPTY_TREE
        for path, line, kind, _text in scan_message(commit):
            suspects.append((commit, path, line, kind))
            log_detection(kind, path, line, commit)
        found, quiet = scan_commit_diff(root, parent, commit)
        for path, line, kind, text in found:
            suspects.append((commit, path, line, kind))
            if kind != "marker":
                log_detection(kind, path, line, commit)
            reported.add((kind, path, text))
        for path, line, kind, text in quiet:
            if (kind, path, text) in reported:
                continue
            reported.add((kind, path, text))
            log_detection(kind, path, line, commit, via="marker")
    for commit, parents in items:
        if len(parents) <= 1:
            continue
        for path, line, kind, _text in scan_message(commit):
            suspects.append((commit, path, line, kind))
            log_detection(kind, path, line, commit)
        if "merges" in DISABLED:
            continue
        found, quiet = scan_merge_diff(root, parents, commit)
        for path, line, kind, text in found:
            if (kind, path, text) in reported:
                continue
            reported.add((kind, path, text))
            suspects.append((commit, path, line, kind))
            if kind != "marker":
                log_detection(kind, path, line, commit)
        for path, line, kind, text in quiet:
            if (kind, path, text) in reported:
                continue
            reported.add((kind, path, text))
            log_detection(kind, path, line, commit, via="marker")
    for commit, path, line, kind in sorted(suspects):
        print("%s:%s:%d: %s" % (commit, safe_path(path), line, kind))
    return 1 if suspects else 0


def run_files(root, paths, markers=True):
    del root
    suspects = []
    for raw_path in paths:
        try:
            handle = open(raw_path, "rb")
        except OSError:
            notice("could not read %s" % safe_path(raw_path))
        scanner = LineScanner(markers=markers)
        kept_len, fault_len, supp_len = 0, 0, 0
        with handle:
            for number, raw in enumerate(handle, 1):
                text = raw.rstrip(b"\r\n").decode("utf-8", errors="replace")
                scanner.feed(number, text)
                for num, _s, _e, kind, _v in scanner.kept[kept_len:]:
                    suspects.append((raw_path, num, kind))
                    log_detection(kind, raw_path, num, "")
                kept_len = len(scanner.kept)
                for num, _s, _e in scanner.faults[fault_len:]:
                    suspects.append((raw_path, num, "marker"))
                fault_len = len(scanner.faults)
                for num, _s, _e, kind, _v in scanner.suppressed[supp_len:]:
                    log_detection(kind, raw_path, num, "", via="marker")
                supp_len = len(scanner.suppressed)
            scanner.flush()
            for num, _s, _e in scanner.faults[fault_len:]:
                suspects.append((raw_path, num, "marker"))
    for path, line, kind in sorted(suspects):
        print("%s:%d: %s" % (safe_path(path), line, kind))
    return 1 if suspects else 0


def run_spans(root, paths):
    del root
    for index, raw_path in enumerate(paths):
        try:
            handle = open(raw_path, "rb")
        except OSError:
            notice("could not read %s" % safe_path(raw_path))
        scanner = LineScanner()
        kept_len, fault_len, supp_len = 0, 0, 0
        with handle:
            for number, raw in enumerate(handle, 1):
                text = raw.rstrip(b"\r\n").decode("utf-8", errors="replace")
                scanner.feed(number, text)
                for num, start, end, kind, _v in scanner.kept[kept_len:]:
                    print("%d:%d:%d:%d:%s" % (index, num, start, end, kind))
                    log_detection(kind, raw_path, num, "")
                kept_len = len(scanner.kept)
                for num, _s, _e, kind, _v in scanner.suppressed[supp_len:]:
                    log_detection(kind, raw_path, num, "", via="marker")
                supp_len = len(scanner.suppressed)
                for num, start, end in scanner.faults[fault_len:]:
                    print("%d:%d:%d:%d:marker" % (index, num, start, end))
                fault_len = len(scanner.faults)
            scanner.flush()
            for num, start, end in scanner.faults[fault_len:]:
                print("%d:%d:%d:%d:marker" % (index, num, start, end))
    return 0


def run_pr_description(root, path):
    del root
    try:
        handle = open(path, "rb")
    except OSError:
        notice("could not read %s" % safe_path(path))
    suspects = []
    with handle:
        for number, raw in enumerate(handle, 1):
            text = raw.rstrip(b"\r\n").decode("utf-8", errors="replace")
            for _start, _end, kind, _value in findings(text):
                suspects.append((number, kind))
                log_detection(kind, "(pr-description)", number, "")
    for line, kind in sorted(suspects):
        print("(pr-description):%d: %s" % (line, kind))
    return 1 if suspects else 0


def run_safe_paths(root, paths):
    del root
    for raw_path in paths:
        print(safe_path(raw_path))
    return 0


def run_log_detection(args):
    if len(args) not in (3, 4):
        notice(USAGE)
    rule, file, line = args[0], args[1], args[2]
    commit = args[3] if len(args) == 4 else ""
    if rule not in RULES:
        notice("--log-detection names a rule, one of: " + ", ".join(sorted(RULES)))
    if not file:
        notice("--log-detection names the file the finding was reported in")
    try:
        number = int(line)
    except ValueError:
        notice("--log-detection takes the finding's line number")
    if number < 0:
        notice("--log-detection takes the finding's line number, 0 for a name")
    if commit and not re.fullmatch(r"[0-9a-f]{40}", commit):
        notice("--log-detection takes a full commit id or nothing")
    log_detection(rule, file, number, commit)
    return 0


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


def run_child(args, cwd, env=None):
    try:
        merged = dict(os.environ)
        if env:
            merged.update(env)
        return subprocess.run(
            [str(SCRIPT), *args], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", check=False, env=merged,
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
    # Hermetic controls: the gate runs self-tests with a detections log set,
    # and must never inherit a test hook, so both are cleared here and set
    # per control below.
    os.environ.pop("POSTMASTER_DETECTIONS_LOG", None)
    os.environ.pop("SCRUB_CHECK_DISABLE", None)

    failures = 0

    def ok(label, passed):
        nonlocal failures
        print("  %s %s" % ("ok  " if passed else "FAIL", label))
        if not passed:
            failures += 1

    # Every fabricated secret, assembled from pieces so this source carries no
    # matchable form. Each positive control also asserts none of these values
    # reaches stdout. Marker text is built the same way: the source holds the
    # bare name only where the line carries no finding, which the source
    # control below proves.
    AT = "@"
    ALLOW = "private-data:allo" + "w"
    ALLOW_NEXT = "private-data:allow-next" + "-line"
    sample_email = "lane-413" + AT + "relay-413" + ".net"
    plus_email = "First.Last+tag" + AT + "sub." + "relay-413" + ".net"
    private_ip = ".".join(("10", "135", "4", "13"))
    cgnat_ip = ".".join(("100", "99", "4", "13"))
    public_100 = ".".join(("100", "128", "0", "1"))
    private_host = "metrics" + ".inter" + "nal"
    tailnet_host = "node-413" + ".ts" + ".net"
    private_path = "/" + "home" + "/" + "fixture-user-413" + "/notes.txt"
    scratch_path = "/tmp/" + "clau" + "de-413" + "/scratch/notes.md"
    fake_token = "s" + "k-" + "fictional413key" + "K7mQ2xZ9aVbN4qy7"
    fake_key_id = "AK" + "IA" + "X" * 16
    fake_bearer = "Bearer " + "fictional413relay" + "K7mQ2xZ9aVbN4qy7"
    fake_org_id = "org-" + "fictional413relayK7mQ2xZ9"
    fake_sess_id = "sess-" + "fictional413K7mQ2x"
    fake_uuid = "41313513-0042" + "-" + "4c1d-9e5f-135135135135"
    fake_account = "123456789012"
    key_user = "user" + "Email"
    key_session = "session" + "_" + "context"
    key_session_camel = "session" + "Context"
    key_cred = "credential" + "_" + "org"
    key_org = "organization" + "Uuid"
    coauthored = "Co-Authored" + "-By: "
    generated_with = "generated-with: " + "ImaginaryAide"
    secrets = [
        sample_email, plus_email, private_ip, cgnat_ip, private_host, tailnet_host,
        private_path, scratch_path, fake_token, fake_key_id, fake_bearer,
        fake_org_id, fake_sess_id, fake_uuid, fake_account,
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

            def pos(rule, text, name):
                nonlocal last
                head = add_fixture(repo, "fixtures/%s.txt" % name, text, "positive fixture")
                result = run_child([last, head], repo)
                lines = [] if result is None else result.stdout.splitlines()
                expected = "%s:fixtures/%s.txt:1: %s" % (head, name, rule)
                good = bool(
                    result and result.returncode == 1 and lines == [expected]
                    and silent(result))
                off = run_child([last, head], repo, {"SCRUB_CHECK_DISABLE": rule})
                good = good and bool(off and off.returncode == 0 and not off.stdout)
                ok("pos %s: a fixture carrying it is reported without its value, "
                   "and silent with it switched off" % rule, good)
                last = head

            def neg(rule, text, name, label):
                nonlocal last
                head = add_fixture(repo, "fixtures/%s.txt" % name, text, "clean fixture")
                result = run_child([last, head], repo)
                good = bool(result and result.returncode == 0 and not result.stdout)
                ok("neg %s: %s" % (rule, label), good)
                last = head

            print("source control: the scanner does not flag itself")
            source_check = run_child(["--files", str(SCRIPT)], root)
            ok("the scanner source is clean as a file", bool(
                source_check and source_check.returncode == 0 and not source_check.stdout))

            print("positive controls: each kind is flagged on a fixture that carries it")
            pos("key", '{"%s": "withheld"}\n' % key_user, "pos-key")
            pos("key", '{"%s": "fixture-session-413"}\n' % key_session, "pos-key-session")
            pos("key", '{"%s": "fixture-session-413"}\n' % key_session_camel, "pos-key-session-camel")
            pos("key", '{"%s": "fixture-org-413"}\n' % key_cred, "pos-key-cred")
            pos("email", "contact: " + sample_email + "\n", "pos-email")
            pos("email", "write to " + sample_email + ".\n", "pos-email-final")
            pos("email", "write to " + plus_email + " for the demo\n", "pos-email-plus")
            pos("account-id", "owner " + fake_org_id + "\n", "pos-org-id")
            pos("account-id", "relay " + fake_sess_id + "\n", "pos-sess-id")
            pos("account-id", '{"%s": "%s"}\n' % (key_org, fake_uuid), "pos-org-field")
            pos("account-id", "account ref " + fake_uuid + "\n", "pos-uuid-context")
            pos("account-id", "account" + "Id: " + fake_account + "\n", "pos-account-field")
            pos("private-path", "source under " + private_path + "\n", "pos-home-path")
            pos("private-path", "cache under " + scratch_path + "\n", "pos-scratch-path")
            pos("private-path", "notes at " + "~" + "fixture-user-413" + "/docs\n",
                "pos-tilde-path")
            pos("private-path", "{\"cwd\": \"" + "/home/" + "fixture-user-413" + "\"}\n",
                "pos-home-quoted")
            pos("private-path", "dir " + "/home/" + "fixture-user-413" + " is here\n",
                "pos-home-space")
            pos("private-path", "see " + "/home/" + "fixture-user-413" + ". Next\n",
                "pos-home-period")
            pos("private-path", "ver \"" + "C:" + "\\Users\\" + "fixture-user-413" + "\"\n",
                "pos-drive-quoted")
            pos("private-host", "endpoint " + private_ip + ":8080\n", "pos-private-ip")
            pos("private-host", "status at https://" + private_host + ":8443/up\n", "pos-private-host")
            pos("private-host", "relay at " + cgnat_ip + ":8080\n", "pos-cgnat-ip")
            pos("private-host", "node at " + tailnet_host + ":8080\n", "pos-tailnet")
            pos("token", "relay key " + fake_token + "\n", "pos-token")
            pos("token", "relay id " + fake_key_id + "\n", "pos-access-key")
            pos("token", "api_key: " + "z" * 32 + "\n", "pos-secret-field")
            pos("token", "auth " + fake_bearer + "\n", "pos-bearer")
            pos("token", "-----BEGIN " + "PRIVATE KEY-----\n", "pos-pem-header")
            pos("assistant-attribution", coauthored + "Imaginary Aide\n", "pos-attribution")
            pos("assistant-attribution", 'Generated with Claude\n', "pos-generated")
            pos("assistant-attribution", generated_with + "\n", "pos-generated-with")
            pos("dotenv", 'SESSION_SECRET=relay-413-quiet\n', "pos-dotenv")
            pos("dotenv", 'SESSION_SECRET="relay-413-quiet-secret" # rotate soon\n',
                "pos-dotenv-comment")
            pos("dotenv", 'SESSION_SECRET=\'relay-413-quiet-secret\' # rotate soon\n',
                "pos-dotenv-single-comment")
            pos("dotenv", 'SESSION_SECRET=relay-413-quiet-secret # rotate $STAGING soon\n',
                "pos-dotenv-unquoted-comment")
            pos("dotenv", 'SESSION_SECRET=sec#retLiteralValue99\n',
                "pos-dotenv-literal-hash")

            print("negative controls: clean lines stay silent")
            neg("key", "the ship card lists each check and its exit code\n",
                "neg-plain", "a plain sentence is clean")
            neg("email", "reach the relay at " + "99999999+fictional" + AT
                + "users.noreply.github.com for pings\n",
                "neg-noreply-domain", "a GitHub no-reply address is clean")
            neg("email", "write " + "noreply" + AT + "no-such-vendor-413.net instead\n",
                "neg-noreply-local", "a no-reply local part is clean on any domain")
            neg("dotenv", "TOKEN_TYPE=Bearer\n",
                "neg-dotenv-pointer", "a key-like name pointing elsewhere is clean")
            neg("dotenv", "SESSION_SECRET=${STAGING}_relay_secret_413\n",
                "neg-dotenv-composed", "a composed assignment value is clean")
            neg("dotenv", "TOKEN=\"alpha\"+\"beta\"\n",
                "neg-dotenv-quoted-composed", "a quoted composed value is clean")
            neg("dotenv", "SESSION_SECRET=# rotate soon replacement pending\n",
                "neg-dotenv-comment-only", "a comment on its own assigns nothing")
            neg("dotenv", "MY_PASSWORD=short # a much longer comment here\n",
                "neg-dotenv-short-stripped", "a short value stays short under its comment")
            neg("email", "write " + "someone" + AT + "example.org for the demo\n",
                "neg-reserved-example", "a reserved example domain is clean")
            neg("email", "write " + "someone" + AT + "thing.test for the demo\n",
                "neg-reserved-test", "a reserved test domain is clean")
            neg("email", "write " + "someone" + AT + "thing.invalid for the demo\n",
                "neg-reserved-invalid", "a reserved invalid domain is clean")
            neg("email", "write " + "person" + AT + "mail.localhost for the demo\n",
                "neg-reserved-localhost", "a localhost domain is clean")
            neg("key", '{"userEmail": null}\n',
                "neg-key-null", "a null key value is clean")
            neg("key", '{"userEmail": true}\n',
                "neg-key-bool", "a boolean key value is clean")
            neg("key", '{"userEmail": "..."}\n',
                "neg-key-ellipsis", "an elided key value is clean")
            neg("key", '{"userEmail": "<redacted>"}\n',
                "neg-key-bracketed", "a bracketed key value is clean")
            neg("key", '{"userEmail": "N/A"}\n',
                "neg-key-na", "an N/A key value is clean")
            neg("key", '{"userEmail": ""}\n',
                "neg-key-empty", "an empty key value is clean")
            neg("key", "the userEmail field is redacted before promotion\n",
                "neg-key-prose", "a bare key name in prose is clean")
            neg("account-id", "assign the org-chart-2024 to the team\n",
                "neg-org-compound", "a compound org word is not an id")
            neg("account-id", "see org-ab12 for the demo\n",
                "neg-org-short", "a short org token is not an id")
            neg("account-id", "see ses-ab12 for the demo\n",
                "neg-ses-short", "a short session token is not an id")
            neg("account-id", "the account-id kind covers org ids\n",
                "neg-kind-name", "the kind name itself is clean")
            neg("account-id", "the session_context key holds the session\n",
                "neg-session-context", "a key name with no digit is not an id")
            neg("account-id", "see ses-abcdef for the demo\n",
                "neg-ses-no-digit", "a digitless session token is a name, not an id")
            neg("account-id", "schema example " + fake_uuid + "\n",
                "neg-uuid-bare", "a UUID with no id context is clean")
            neg("private-path", "notes under ~/Code/notes.txt\n",
                "neg-tilde-bare", "a bare home reference names nobody")
            neg("private-path", "notes at " + "~" + "user" + "/docs\n",
                "neg-tilde-user", "a tilde placeholder user is clean")
            neg("private-path", "notes at " + "~" + "username" + "/docs\n",
                "neg-tilde-username", "a tilde username placeholder is clean")
            neg("private-path", "\"version\": \"" + "~1.0" + "\"\n",
                "neg-tilde-semver", "a version range is not a home directory")
            neg("private-path", "at " + "/home/" + "user" + " is here\n",
                "neg-home-placeholder-space", "a placeholder stays clean before a space")
            neg("private-path", "{\"cwd\": \"" + "/home/" + "user" + "\"}\n",
                "neg-home-placeholder-quoted", "a placeholder stays clean before a quote")
            neg("private-path", "keys live in ~/.ssh/id_rsa\n",
                "neg-tilde-dotdir", "a generic dot directory names nobody")
            neg("private-path", "read /home/user/docs for the layout\n",
                "neg-user-placeholder", "a placeholder user is clean")
            neg("private-path", "read /home/$USER/docs for the layout\n",
                "neg-user-var", "a variable user is clean")
            neg("private-path", "read /home/<user>/docs for the layout\n",
                "neg-user-bracketed", "a bracketed user is clean")
            neg("private-path", "/tmp/pip-install-9 holds wheels\n",
                "neg-tmp-lookalike", "a lookalike temp dir is clean")
            neg("private-path", 'mkdir -p "$tmp/root/scripts" for the case\n',
                "neg-var-root", "a root dir under a variable is scaffolding")
            neg("private-path", 'mkdir -p "$d/home/user" for the case\n',
                "neg-var-home", "a home dir under a variable is scaffolding")
            neg("private-path", "/tmp/codex is a product name\n",
                "neg-tmp-bare", "a bare harness name with no run marker is clean")
            neg("private-host", "proxy at 127.0.0.1:9\n",
                "neg-loopback-v4", "loopback is universal, not private")
            neg("private-host", "loopback ::1 answers\n",
                "neg-loopback-v6", "v6 loopback is universal, not private")
            neg("private-host", "the gateway moved to 8.8.8.8 last month\n",
                "neg-public-ip", "a public IP is clean")
            neg("private-host", "docs live on the project pages site\n",
                "neg-public-host", "a public hostname is clean")
            neg("private-host", "serve on localhost:3000\n",
                "neg-localhost", "the loopback name is clean")
            neg("private-host", "empty v6 :: stays\n",
                "neg-unspecified", "an empty address is clean")
            neg("private-host", "see " + "ts" + ".net for the docs\n",
                "neg-bare-tailnet", "a bare tailnet suffix names no node")
            neg("private-host", "the relay moved to " + public_100 + " last month\n",
                "neg-public-100", "a public address past the carrier-grade range is clean")
            neg("token", "commit = 89abcdef0123456789abcdef0123456789abcdef\n",
                "neg-hex-sha", "a hex sha under a plain field is not a token")
            neg("token", "token: short\n",
                "neg-token-short", "a short secret-field value is clean")
            neg("token", "auth Bearer <token> here\n",
                "neg-bearer-placeholder", "a placeholder Bearer credential is clean")
            neg("token", "prefix sk-abc is short\n",
                "neg-prefix-short", "a short prefixed value is clean")
            neg("assistant-attribution", "the commit trailer policy forbids crediting an assistant\n",
                "neg-attribution-talk", "attribution discussion without a trailer is clean")
            neg("assistant-attribution", "Generated by Makefile for this repo\n",
                "neg-generated-tool", "a tool credit is not an assistant")
            neg("assistant-attribution", "Co-Authored" + "-By\n",
                "neg-bare-trailer", "a trailer name with no credit is clean")
            neg("key", "# Global instructions for this fixture\n"
                "Never copy a fixture credential into a ticket\n",
                "neg-instructions-narrowed",
                "instructions-file text stays silent: personal data and secrets only")

            print("history controls: a line added and then deleted is still flagged")
            added = add_fixture(repo, "leak.txt", "contact: " + sample_email + "\n", "add leak")
            (repo / "leak.txt").unlink()
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

            print("diff controls: added lines starting '++ ' read as content")
            plus = add_fixture(repo, "plus.txt", "++ contact: " + sample_email + "\n",
                               "plus-prefix line")
            plused = run_child([last, plus], repo)
            ok("an added line starting '++ ' is scanned as content, never a header", bool(
                plused and plused.returncode == 1
                and plused.stdout.splitlines() == ["%s:plus.txt:1: email" % plus]
                and silent(plused)))
            last = plus
            gap_lines = ["public line %d\n" % n for n in range(1, 31)]
            gap_base = add_fixture(repo, "gap.txt", "".join(gap_lines), "gap base")
            gap_lines[0] = "# " + ALLOW_NEXT + " email -- stray marker\n"
            gap_lines[19] = "contact: " + sample_email + "\n"
            (repo / "gap.txt").write_text("".join(gap_lines), encoding="utf-8")
            git(["add", "--", "gap.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "gap the marker"], cwd=repo)
            gap = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            gapped = run_child([gap_base, gap], repo)
            ok("an unused marker across a hunk gap names the fault and the finding", bool(
                gapped and gapped.returncode == 1
                and gapped.stdout.splitlines() == [
                    "%s:gap.txt:1: marker" % gap, "%s:gap.txt:20: email" % gap]
                and silent(gapped)))
            last = gap

            print("diff controls: added file names are scanned")
            named_name = sample_email + ".txt"
            named = add_fixture(repo, named_name, "just public words here\n", "shaped name")
            named_result = run_child([last, named], repo)
            ok("an added file with a shaped name is reported at line 0, redacted", bool(
                named_result and named_result.returncode == 1
                and named_result.stdout.splitlines() == [
                    "%s:[redacted]:0: email" % named]
                and silent(named_result)))
            (repo / named_name).write_text("just public words, revised\n", encoding="utf-8")
            git(["add", "--", named_name], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "revise the named file"], cwd=repo)
            revised = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            revised_result = run_child([named, revised], repo)
            ok("a modified file's existing name is not reported again", bool(
                revised_result and revised_result.returncode == 0
                and not revised_result.stdout))
            last = revised

            print("message controls: commit messages are scanned with markers inert")
            (repo / "msg-clean.txt").write_text("ordinary public sample\n", encoding="utf-8")
            git(["add", "--", "msg-clean.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "add the notes", "-m", coauthored + "Imaginary Aide"], cwd=repo)
            trailer = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            trailed = run_child([last, trailer], repo)
            ok("a trailer in a commit message is reported as its message line", bool(
                trailed and trailed.returncode == 1
                and trailed.stdout.splitlines()
                == ["%s:(message):3: assistant-attribution" % trailer]))
            trailed_off = run_child([last, trailer], repo, {"SCRUB_CHECK_DISABLE": "messages"})
            ok("... and silent with messages switched off", bool(
                trailed_off and trailed_off.returncode == 0 and not trailed_off.stdout))
            last = trailer
            (repo / "msg-clean2.txt").write_text("ordinary public sample\n", encoding="utf-8")
            git(["add", "--", "msg-clean2.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "note",
                 "-m", "write to " + sample_email + "  # " + ALLOW + " email -- fixture"], cwd=repo)
            marked_msg = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            inert = run_child([last, marked_msg], repo)
            ok("marker text in a message suppresses nothing and faults nothing", bool(
                inert and inert.returncode == 1
                and inert.stdout.splitlines() == ["%s:(message):3: email" % marked_msg]
                and sample_email not in inert.stdout))
            last = marked_msg

            print("merge controls: a resolution is scanned once, never twice")
            merge_base = last
            git(["checkout", "-qb", "side-413"], cwd=repo)
            add_fixture(repo, "merge.txt", "side line\n", "side work")
            git(["checkout", "-q", "main"], cwd=repo)
            add_fixture(repo, "merge.txt", "main line\n", "main work")
            subprocess.run(["git", "merge", "--no-commit", "side-413"], cwd=repo,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            (repo / "merge.txt").write_text(
                "contact: " + sample_email + "\n", encoding="utf-8")
            git(["add", "--", "merge.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "merge the side"], cwd=repo)
            merge_sha = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            resolved = run_child([merge_base, merge_sha], repo)
            ok("a merge resolution carrying a suspect is reported under the merge", bool(
                resolved and resolved.returncode == 1
                and resolved.stdout.splitlines() == ["%s:merge.txt:1: email" % merge_sha]
                and sample_email not in resolved.stdout))
            resolved_off = run_child([merge_base, merge_sha], repo, {"SCRUB_CHECK_DISABLE": "merges"})
            ok("... and silent with merges switched off", bool(
                resolved_off and resolved_off.returncode == 0 and not resolved_off.stdout))
            last = merge_sha
            git(["checkout", "-qb", "side-413b"], cwd=repo)
            add_fixture(repo, "merge-plus.txt", "side line\n", "side plus work")
            git(["checkout", "-q", "main"], cwd=repo)
            add_fixture(repo, "merge-plus.txt", "main line\n", "main plus work")
            subprocess.run(["git", "merge", "--no-commit", "side-413b"], cwd=repo,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            (repo / "merge-plus.txt").write_text(
                "++ contact: " + sample_email + "\n", encoding="utf-8")
            git(["add", "--", "merge-plus.txt"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "commit", "-m", "merge the plus side"], cwd=repo)
            merge_plus = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            plused_merge = run_child([last, merge_plus], repo)
            ok("a '++ ' resolution line is scanned as content, never a header", bool(
                plused_merge and plused_merge.returncode == 1
                and plused_merge.stdout.splitlines() == ["%s:merge-plus.txt:1: email" % merge_plus]
                and silent(plused_merge)))
            last = merge_plus
            git(["checkout", "-qb", "side-414"], cwd=repo)
            side_sha = add_fixture(repo, "leak2.txt", "contact: " + sample_email + "\n", "side leak")
            git(["checkout", "-q", "main"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "merge", "--no-ff", "-m", "merge the second side", "side-414"], cwd=repo)
            merge2 = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            deduped = run_child([last, merge2], repo)
            ok("a side branch finding is reported under its own commit, not the merge", bool(
                deduped and deduped.returncode == 1
                and deduped.stdout.splitlines() == ["%s:leak2.txt:1: email" % side_sha]
                and sample_email not in deduped.stdout))
            last = merge2
            add_fixture(repo, "old-leak.txt", "contact: " + sample_email + "\n", "old leak")
            quiet_base = add_fixture(repo, "quiet-base.txt", "ordinary public sample\n",
                                     "quiet base")
            add_fixture(repo, "main-advance.txt", "ordinary public sample\n", "main advance")
            git(["checkout", "-qb", "side-415", quiet_base], cwd=repo)
            add_fixture(repo, "side-advance.txt", "ordinary public sample\n", "side advance")
            git(["checkout", "-q", "main"], cwd=repo)
            git(["-c", "user.name=Fixture", "-c", "user.email=" + FIXTURE_MAILBOX,
                 "merge", "--no-ff", "-m", "merge the quiet side", "side-415"], cwd=repo)
            merge3 = git(["rev-parse", "HEAD"], cwd=repo).decode("ascii").strip()
            prebase = run_child([quiet_base, merge3], repo)
            ok("lines published before the base merge quietly", bool(
                prebase and prebase.returncode == 0 and not prebase.stdout))
            last = merge3

            print("marker controls: marked lines stay silent, bad markers fault")
            marked = add_fixture(
                repo, "marked.txt",
                "contact: " + sample_email + "  # " + ALLOW + " email -- fixture relay address\n",
                "marked fixture")
            marked_result = run_child([last, marked], repo)
            ok("a marked line stays silent", bool(
                marked_result and marked_result.returncode == 0 and not marked_result.stdout))
            marked_off = run_child([last, marked], repo, {"SCRUB_CHECK_DISABLE": "markers"})
            ok("... and flags with markers switched off", bool(
                marked_off and marked_off.returncode == 1
                and marked_off.stdout.splitlines() == ["%s:marked.txt:1: email" % marked]
                and sample_email not in marked_off.stdout))
            marked_log = scratch / "marked-det.jsonl"
            marked_logged = run_child([last, marked], repo,
                                      {"POSTMASTER_DETECTIONS_LOG": str(marked_log)})
            logged = []
            if marked_log.is_file():
                logged = [json.loads(line) for line in
                          marked_log.read_text(encoding="utf-8").splitlines()]
            ok("... and a suppressed match is logged with its marker resolution", bool(
                marked_logged and marked_logged.returncode == 0
                and len(logged) == 1 and logged[0]["rule"] == "email"
                and logged[0]["file"] == "marked.txt" and logged[0]["line"] == 1
                and logged[0]["commit"] == marked and logged[0].get("via") == "marker"
                and sample_email not in marked_log.read_text(encoding="utf-8")))
            last = marked
            nextline = add_fixture(
                repo, "nextline.txt",
                ALLOW_NEXT + " email -- fixture relay address\ncontact: " + sample_email + "\n",
                "next-line fixture")
            nextline_result = run_child([last, nextline], repo)
            ok("a next-line marker stays silent", bool(
                nextline_result and nextline_result.returncode == 0
                and not nextline_result.stdout))
            nextline_off = run_child([last, nextline], repo, {"SCRUB_CHECK_DISABLE": "markers"})
            ok("... and flags its line with markers switched off", bool(
                nextline_off and nextline_off.returncode == 1
                and nextline_off.stdout.splitlines() == ["%s:nextline.txt:2: email" % nextline]
                and sample_email not in nextline_off.stdout))
            last = nextline
            reasonless = add_fixture(
                repo, "reasonless.txt",
                "contact: " + sample_email + "  # " + ALLOW + " email\n",
                "reasonless fixture")
            reasonless_result = run_child([last, reasonless], repo)
            ok("a marker without a reason faults beside its finding", bool(
                reasonless_result and reasonless_result.returncode == 1
                and reasonless_result.stdout.splitlines()
                == ["%s:reasonless.txt:1: email" % reasonless,
                    "%s:reasonless.txt:1: marker" % reasonless]
                and sample_email not in reasonless_result.stdout))
            last = reasonless
            unused = add_fixture(
                repo, "unused.txt",
                "ordinary public sample  # " + ALLOW + " email -- nothing to suppress\n",
                "unused fixture")
            unused_result = run_child([last, unused], repo)
            ok("a marker that suppresses nothing faults", bool(
                unused_result and unused_result.returncode == 1
                and unused_result.stdout.splitlines() == ["%s:unused.txt:1: marker" % unused]))
            unused_off = run_child([last, unused], repo, {"SCRUB_CHECK_DISABLE": "markers"})
            ok("... and stays silent with markers switched off", bool(
                unused_off and unused_off.returncode == 0 and not unused_off.stdout))
            last = unused
            unknown = add_fixture(
                repo, "unknown.txt",
                "contact: " + sample_email + "  # " + ALLOW + " emial -- typo in the rule\n",
                "unknown fixture")
            unknown_result = run_child([last, unknown], repo)
            ok("a marker naming an unknown rule faults beside its finding", bool(
                unknown_result and unknown_result.returncode == 1
                and unknown_result.stdout.splitlines()
                == ["%s:unknown.txt:1: email" % unknown,
                    "%s:unknown.txt:1: marker" % unknown]
                and sample_email not in unknown_result.stdout))
            last = unknown
            prose = add_fixture(
                repo, "prose-marker.txt",
                "the " + ALLOW + " template marks made-up lines\n",
                "prose fixture")
            prose_result = run_child([last, prose], repo)
            ok("marker-shaped text on a clean line is prose", bool(
                prose_result and prose_result.returncode == 0 and not prose_result.stdout))
            last = prose
            quoted = add_fixture(
                repo, "quoted.txt",
                ALLOW + " email -- for " + sample_email + "\n",
                "quoted fixture")
            quoted_result = run_child([last, quoted], repo)
            ok("a reason quoting a suspect flags, and its marker faults", bool(
                quoted_result and quoted_result.returncode == 1
                and quoted_result.stdout.splitlines()
                == ["%s:quoted.txt:1: email" % quoted,
                    "%s:quoted.txt:1: marker" % quoted]
                and sample_email not in quoted_result.stdout))
            last = quoted
            redundant = add_fixture(
                repo, "redundant.txt",
                "contact: " + sample_email
                + "  # " + ALLOW + " email -- one  # " + ALLOW + " email -- two\n",
                "redundant fixture")
            redundant_result = run_child([last, redundant], repo)
            ok("a redundant marker faults while the first suppresses", bool(
                redundant_result and redundant_result.returncode == 1
                and redundant_result.stdout.splitlines()
                == ["%s:redundant.txt:1: marker" % redundant]
                and sample_email not in redundant_result.stdout))
            last = redundant

            print("detection controls: every reported finding is logged, never its value")
            logpath = scratch / "detections.jsonl"
            os.environ["POSTMASTER_DETECTIONS_LOG"] = str(logpath)
            logged_parent = last
            logged = add_fixture(repo, "logged.txt", "contact: " + sample_email + "\n",
                                 "logged fixture")
            logged_result = run_child([last, logged], repo)
            try:
                logged_lines = logpath.read_text(encoding="utf-8").splitlines()
                logged_entry = json.loads(logged_lines[0]) if len(logged_lines) == 1 else None
            except (OSError, ValueError):
                logged_entry, logged_lines = None, []
            ok("a reported finding is logged by rule, file, line and commit", bool(
                logged_result and logged_result.returncode == 1
                and logged_entry is not None
                and logged_entry.get("rule") == "email"
                and logged_entry.get("file") == "logged.txt"
                and logged_entry.get("line") == 1
                and logged_entry.get("commit") == logged
                and logged_entry.get("ts", "").endswith("Z")
                and sample_email not in "\n".join(logged_lines)))
            last = logged
            fault_logged = add_fixture(
                repo, "fault-logged.txt",
                "ordinary public sample  # " + ALLOW + " email -- nothing to suppress\n",
                "fault fixture")
            fault_result = run_child([last, fault_logged], repo)
            try:
                fault_count = len(logpath.read_text(encoding="utf-8").splitlines())
            except OSError:
                fault_count = -1
            ok("a marker fault is reported but never logged", bool(
                fault_result and fault_result.returncode == 1
                and fault_result.stdout.splitlines()
                == ["%s:fault-logged.txt:1: marker" % fault_logged]
                and fault_count == 1))
            last = fault_logged
            del os.environ["POSTMASTER_DETECTIONS_LOG"]
            logpath.unlink()
            quiet = add_fixture(repo, "quiet.txt", "ordinary public sample\n", "quiet fixture")
            quiet_result = run_child([last, quiet], repo)
            ok("an unset log writes nothing", bool(
                quiet_result and quiet_result.returncode == 0 and not logpath.exists()))
            last = quiet
            unwritable = run_child(
                [logged_parent, logged], repo,
                {"POSTMASTER_DETECTIONS_LOG": str(scratch / "no-such-dir" / "d.jsonl")})
            ok("a log that cannot be written fails the check, exit 2", bool(
                unwritable and unwritable.returncode == 2 and not unwritable.stdout))

            print("span controls: --spans names each finding by file index and offsets")
            (repo / "spans.txt").write_text(
                "contact: " + sample_email + "\nordinary public sample\n", encoding="utf-8")
            spans = run_child(["--spans", "spans.txt"], repo)
            span_lines = [] if spans is None else spans.stdout.splitlines()
            span_ok = False
            if spans is not None and spans.returncode == 0 and len(span_lines) == 1:
                parts = span_lines[0].split(":")
                if len(parts) == 5 and parts[0] == "0" and parts[1] == "1" \
                        and parts[4] == "email":
                    body = (repo / "spans.txt").read_text(encoding="utf-8").splitlines()[0]
                    span_ok = body[int(parts[2]):int(parts[3])] == sample_email
            ok("a span covers its finding exactly", span_ok and silent(spans))
            (repo / "spans-fault.txt").write_text(
                "ordinary  # " + ALLOW + " email -- nothing to suppress\n", encoding="utf-8")
            spans_fault = run_child(["--spans", "spans-fault.txt"], repo)
            ok("a marker fault is a span of its own", bool(
                spans_fault and spans_fault.returncode == 0
                and len(spans_fault.stdout.splitlines()) == 1
                and spans_fault.stdout.splitlines()[0].endswith(":marker")))
            (repo / "spans-log.txt").write_text(
                "contact: " + sample_email + "\n", encoding="utf-8")
            spans_logpath = scratch / "spans.jsonl"
            spans_logged = run_child(
                ["--spans", "spans-log.txt"], repo,
                {"POSTMASTER_DETECTIONS_LOG": str(spans_logpath)})
            try:
                spans_logged_lines = spans_logpath.read_text(encoding="utf-8").splitlines()
            except OSError:
                spans_logged_lines = []
            ok("a span finding is logged like any other", bool(
                spans_logged and spans_logged.returncode == 0
                and len(spans_logged_lines) == 1
                and json.loads(spans_logged_lines[0]).get("rule") == "email"
                and sample_email not in spans_logged_lines[0]))
            spans_missing = run_child(["--spans", "no-such-file.txt"], repo)
            ok("--spans on a missing file exits 2", bool(
                spans_missing and spans_missing.returncode == 2 and not spans_missing.stdout))

            print("pull request controls: --pr-description scans like a message")
            (repo / "pr.md").write_text(
                "Ship the relay.\n\nContact: " + sample_email + "\n", encoding="utf-8")
            pr_dirty = run_child(["--pr-description", "pr.md"], repo)
            ok("a suspect in the description is reported without its value", bool(
                pr_dirty and pr_dirty.returncode == 1
                and pr_dirty.stdout.splitlines() == ["(pr-description):3: email"]
                and sample_email not in pr_dirty.stdout))
            (repo / "pr-clean.md").write_text("Ship the relay.\n", encoding="utf-8")
            pr_clean = run_child(["--pr-description", "pr-clean.md"], repo)
            ok("a clean description stays silent", bool(
                pr_clean and pr_clean.returncode == 0 and not pr_clean.stdout))
            (repo / "pr-marked.md").write_text(
                "Contact: " + sample_email + "  # " + ALLOW + " email -- fixture\n",
                encoding="utf-8")
            pr_marked = run_child(["--pr-description", "pr-marked.md"], repo)
            ok("marker text in the description suppresses nothing", bool(
                pr_marked and pr_marked.returncode == 1
                and pr_marked.stdout.splitlines() == ["(pr-description):1: email"]
                and sample_email not in pr_marked.stdout))
            pr_missing = run_child(["--pr-description", "no-such-file.txt"], repo)
            ok("--pr-description on a missing file exits 2", bool(
                pr_missing and pr_missing.returncode == 2 and not pr_missing.stdout))
            pr_bare = run_child(["--pr-description"], repo)
            ok("--pr-description without a file is a usage error, exit 2", bool(
                pr_bare and pr_bare.returncode == 2 and not pr_bare.stdout))

            print("log controls: --log-detection appends one detection")
            log2 = scratch / "called.jsonl"
            called = run_child(
                ["--log-detection", "email", "notes/contact.txt", "3", logged], repo,
                {"POSTMASTER_DETECTIONS_LOG": str(log2)})
            try:
                called_lines = log2.read_text(encoding="utf-8").splitlines()
                called_entry = json.loads(called_lines[0]) if len(called_lines) == 1 else None
            except (OSError, ValueError):
                called_entry = None
            ok("a well-formed call appends its detection", bool(
                called and called.returncode == 0 and not called.stdout
                and called_entry is not None
                and called_entry.get("rule") == "email"
                and called_entry.get("file") == "notes/contact.txt"
                and called_entry.get("line") == 3
                and called_entry.get("commit") == logged))
            for bad_args, label in (
                    (["--log-detection", "marker", "f.txt", "1"], "the marker rule"),
                    (["--log-detection", "no-such-rule", "f.txt", "1"], "an unknown rule"),
                    (["--log-detection", "email", "f.txt", "x"], "a bad line"),
                    (["--log-detection", "email", "f.txt", "-1"], "a negative line"),
                    (["--log-detection", "email", "f.txt", "1", "short"], "a short commit"),
                    (["--log-detection", "email"], "missing arguments")):
                refused = run_child(bad_args, repo)
                ok("--log-detection refuses %s, exit 2" % label, bool(
                    refused and refused.returncode == 2 and not refused.stdout))
            log0 = scratch / "called0.jsonl"
            called0 = run_child(
                ["--log-detection", "email", "notes/contact.txt", "0", logged], repo,
                {"POSTMASTER_DETECTIONS_LOG": str(log0)})
            try:
                called0_lines = log0.read_text(encoding="utf-8").splitlines()
                called0_entry = json.loads(called0_lines[0]) if len(called0_lines) == 1 else None
            except (OSError, ValueError):
                called0_entry = None
            ok("--log-detection accepts line 0 for a name finding", bool(
                called0 and called0.returncode == 0 and not called0.stdout
                and called0_entry is not None and called0_entry.get("line") == 0))
            noop = run_child(["--log-detection", "email", "f.txt", "1"], repo)
            ok("--log-detection with no log set appends nothing, exit 0", bool(
                noop and noop.returncode == 0 and not noop.stdout))
            unwritable_log = run_child(
                ["--log-detection", "email", "f.txt", "1"], repo,
                {"POSTMASTER_DETECTIONS_LOG": str(scratch / "no-such-dir" / "d.jsonl")})
            ok("--log-detection to an unwritable log exits 2", bool(
                unwritable_log and unwritable_log.returncode == 2 and not unwritable_log.stdout))

            print("path controls: --safe-path redacts without scanning")
            redacted_path = "contact-" + "lane-413" + AT + "relay-413" + ".net.txt"
            shaped = run_child(["--safe-path", redacted_path], repo)
            ok("--safe-path redacts a shaped span and prints no value", bool(
                shaped and shaped.returncode == 0
                and shaped.stdout.splitlines() == ["[redacted]"]
                and sample_email not in shaped.stdout))
            plain_path = run_child(["--safe-path", "wiki/concepts/p.md"], repo)
            ok("--safe-path passes a clean path through", bool(
                plain_path and plain_path.returncode == 0
                and plain_path.stdout.splitlines() == ["wiki/concepts/p.md"]))

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
            (repo / "marked-loose.txt").write_text(
                "contact: " + sample_email + "  # " + ALLOW + " email -- fixture\n",
                encoding="utf-8")
            marked_loose = run_child(["--files", "marked-loose.txt"], repo)
            ok("--files honours a marker", bool(
                marked_loose and marked_loose.returncode == 0 and not marked_loose.stdout))
            inert = run_child(["--files-inert", "marked-loose.txt"], repo)
            ok("--files-inert reports through a marker", bool(
                inert and inert.returncode == 1
                and inert.stdout.splitlines() == ["marked-loose.txt:1: email"]
                and silent(inert)))
            (repo / "marker-only.txt").write_text(
                "ordinary  # " + ALLOW + " email -- nothing here\n", encoding="utf-8")
            inert_only = run_child(["--files-inert", "marker-only.txt"], repo)
            ok("--files-inert stays silent on marker text with no finding", bool(
                inert_only and inert_only.returncode == 0 and not inert_only.stdout))
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
            if limited is not None and limited.returncode == 99:
                ok("a large addition streams under a small address space: skipped, "
                   "no address-space limit on this machine", True)
            else:
                ok("a large addition streams under a small address space", bool(
                    limited and limited.returncode == 1
                    and limited.stdout.splitlines()
                    == ["%s:big.txt:70001: email" % big_head]
                    and silent(limited)))
            last = big_head

            print("usage, range and robustness controls")
            help_result = run_child(["--help"], repo)
            ok("--help exits 0 on stderr with no stdout", bool(
                help_result and help_result.returncode == 0
                and not help_result.stdout and "usage:" in help_result.stderr))
            for args, label in (([], "no arguments"), (["main"], "one range argument"),
                                (["main", "HEAD", "extra"], "three range arguments"),
                                (["--files"], "files without paths"),
                                (["--files-inert"], "files-inert without paths"),
                                (["--spans"], "spans without paths"),
                                (["--safe-path"], "safe-path without paths"),
                                (["--log-detection"], "log-detection without arguments"),
                                (["--history"], "the removed history report"),
                                (["--history", "HEAD"], "the removed history report with a ref")):
                usage_result = run_child(args, repo)
                ok("%s is a usage error, exit 2" % label, bool(
                    usage_result and usage_result.returncode == 2 and not usage_result.stdout))
            empty = run_child([last, last], repo)
            ok("an empty commit range is clean", bool(
                empty and empty.returncode == 0 and not empty.stdout))
            disabled_note = run_child([last, last], repo, {"SCRUB_CHECK_DISABLE": "key"})
            ok("a switched-off rule is named on stderr", bool(
                disabled_note and disabled_note.returncode == 0
                and "disabled" in disabled_note.stderr and "key" in disabled_note.stderr))
            blob_head = add_fixture(
                repo, "blob.bin", bytes(range(0x80, 0x100)) * 3, "binary addition")
            blob = run_child([last, blob_head], repo)
            ok("a binary addition scans clean without crashing", bool(
                blob and blob.returncode == 0 and not blob.stdout))
            last = blob_head
            redacted_head = add_fixture(
                repo, redacted_path, "contact: " + sample_email + "\n", "path redaction")
            redacted = run_child([last, redacted_head], repo)
            ok("a matched value in a reported path is redacted", bool(
                redacted and redacted.returncode == 1
                and sample_email not in redacted.stdout
                and "[redacted]" in redacted.stdout))
            last = redacted_head

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
    if DISABLED:
        print("scrub-check: disabled for testing: %s" % " ".join(sorted(DISABLED)),
              file=sys.stderr)
    root = repository_root()
    if args == ["--self-test"]:
        return self_test(root)
    if args and args[0] == "--files":
        if len(args) < 2:
            notice(USAGE)
        return run_files(root, args[1:])
    if args and args[0] == "--files-inert":
        if len(args) < 2:
            notice(USAGE)
        return run_files(root, args[1:], markers=False)
    if args and args[0] == "--spans":
        if len(args) < 2:
            notice(USAGE)
        return run_spans(root, args[1:])
    if args and args[0] == "--pr-description":
        if len(args) != 2:
            notice(USAGE)
        return run_pr_description(root, args[1])
    if args and args[0] == "--safe-path":
        if len(args) < 2:
            notice(USAGE)
        return run_safe_paths(root, args[1:])
    if args and args[0] == "--log-detection":
        return run_log_detection(args[1:])
    if len(args) != 2 or any(arg.startswith("--") for arg in args):
        notice(USAGE)
    base, head = resolve_commit(args[0]), resolve_commit(args[1])
    return run_scan(root, base, head)


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
