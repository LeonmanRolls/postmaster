#!/usr/bin/env bash
# Scan a change's every commit for added lines that look like private data, and report each
# suspect by shape and context so a person can rule it scrubbed or allowed. A coachman never
# scrubs or allows a suspect on its own: this script decides nothing, only reports.
#
#   scrub-check.sh <base> <head>    the added lines of every commit in base..head, not only
#                                   the tip; a line added and then deleted is still seen
#   scrub-check.sh --history [ref]  whether that ref's existing history already holds a
#                                   suspect; ref defaults to main
#   scrub-check.sh --help           usage, exit 0
#   scrub-check.sh --self-test      positive and negative controls, one ok line each
#
# Suspects are printed on stdout, one per line, as <commit>:<path>:<line>: <kind> where
# <commit> is the full 40-character sha, <path> the repo-relative file, <line> the added
# line's number in the new file, and <kind> the pattern name that matched. A matched value is
# never printed: not in a suspect line, not in a notice, not in a diagnostic, not in a
# self-test. Human notices go to stderr. The scan is read-only: it reads git objects and the
# allowlist and writes nothing.
#
# The kinds, each matched by shape and context, never against a list of anyone's values:
#   key                  a sensitive key name with a value (the value span)
#   email                an address that is not a public no-reply alias
#   account-id           an opaque account or organization id shape, or a UUID on a line
#                        with account or identity context
#   home-path            a home-directory or harness-scratch path
#   private-host         a private-network IPv4/IPv6 literal or a private hostname
#   token                a key- or token-shaped string
#   attribution          an assistant attribution trailer or footer
#   private-instructions a sentence of the kind a private instructions file carries
#
# The allowlist is scripts/scrub-check.allow at the scanned repository's root: one exact
# allowed value per line, blank lines ignored. A suspect is suppressed when an entry equals
# its matched value span, or equals its whole added line. A missing allowlist means no
# allowed values. An allowed value is by the user's ruling fine to publish.
#
#   exit 0  clean: no unallowed suspect in the range (or the history)
#   exit 1  suspects, one per line on stdout
#   exit 2  usage, or a git range or file that cannot be read
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
usage() {
  cat >&2 <<'EOF'
usage: scrub-check.sh <base> <head> | --history [ref] | --help | --self-test

Scan every commit in base..head (added lines only), or the existing history of a ref
(default main). Prints one suspect per line on stdout as <commit>:<path>:<line>: <kind>,
never a matched value. Allowlist: scripts/scrub-check.allow at the repo root.
exit 0 clean · exit 1 suspects · exit 2 usage
EOF
}

scan() {  # scan <repo> <mode> <base> <head|-->
  python3 - "$HERE" "$@" <<'PY'
import os, pathlib, re, subprocess, sys

here, repo_arg, mode, base, head = sys.argv[1:6]
SELF = "scrub-check"

def die(msg):
    print(SELF + ": " + msg, file=sys.stderr)
    sys.exit(2)

def git(repo, *a):
    r = subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)
    return r

def repo_root(where):
    r = git(where, "rev-parse", "--show-toplevel")
    if r.returncode != 0:
        die("not a git repository: %s" % where)
    return pathlib.Path(r.stdout.strip())

root = repo_root(repo_arg)

# --- patterns ---------------------------------------------------------------------------------
# Literal phrases use a one-character class break (commi[t], Co[-]Authored-By) so the
# pattern source is not a match of itself. Keys match only with a following value.

KEY_NAMES = (
    "userEmail", "user_email", "user-email",
    "organizationUuid", "organization_uuid", "organizationId", "organization_id",
    "orgUuid", "org_uuid", "orgId", "org_id",
    "session_context", "sessionContext",
    "credential_org", "credentialOrg", "credential_org_id",
    "accountId", "account_id", "account-id",
    "userId", "user_id", "user-id",
)
KEY = re.compile(r"\b(" + "|".join(re.escape(n) for n in KEY_NAMES) + r")\s*[:=]\s*(\S+)")
# A value that is a template placeholder is not a leaked secret.
KEY_SKIP = re.compile(r"^[<{\[]|[>}\]]$|^\.{2,}$|^N/?A$|^null$|^None$|^true$|^false$", re.I)

EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
NOREPLY_LOCAL = {
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
    "noresponse", "no-response", "no_response", "mailer-daemon", "mailer_daemon",
}

ACCOUNT_TOKEN = re.compile(r"\b(?:org|acct|account)[_-][A-Za-z0-9][A-Za-z0-9_-]{5,}\b")
UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
ACCOUNT_CONTEXT = re.compile(
    r"\b(?:account|org(?:anization)?s?|user|identity|credential|tenant|workspace)s?\b", re.I)

HOME_PATH = re.compile(
    r"(?:/home/|/Users/|/root/)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*/?")
HARNESS_TMP = re.compile(
    r"/tmp/(?:claude|mimo|codex|grok|pi|agy|muse|postmaster|anthropic|openai)[A-Za-z0-9._-]*")
HARNESS_DOT = re.compile(
    r"~/\.(?:claude|postmaster|ssh|aws|gnupg|config|codex|grok)(?:/[A-Za-z0-9._-]+)+")

PRIVATE_IP = re.compile(
    r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|169\.254\.\d{1,3}\.\d{1,3})\b")
PRIVATE_HOST = re.compile(
    r"\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:local|lan|internal|home|private|intranet|corp|tailnet)\b",
    re.I)
PRIVATE_IPV6 = re.compile(
    r"\b(?:[fF][cCdD][0-9a-fA-F]{2}|[fF][eE][89abAB][0-9a-fA-F])(?::[0-9a-fA-F]{0,4}){2,7}\b")

TOKEN_RES = [
    re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgho_[A-Za-z0-9]{20,}"),
    re.compile(r"\bghu_[A-Za-z0-9]{20,}"),
    re.compile(r"\bghs_[A-Za-z0-9]{20,}"),
    re.compile(r"\bghr_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._=-]{20,}"),
    re.compile(r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key"
               r"|private[_-]?key|client[_-]?secret)\s*[:=]\s*\S+"),
    # A long unbroken token after a value marker, not a bare hex sha (those are git's own).
    re.compile(r"[:=]\s*[\"']?[A-Za-z0-9+/]{32,}={0,2}[\"']?"),
    re.compile(r"[:=]\s*[\"']?(?!.*[g-zG-Z/+=])[0-9a-fA-F]{32,}[\"']?"),
]

ATTRIBUTION_RES = [
    re.compile(r"\bCo[-]Authored-By\s*:\s*\S"),
    re.compile(r"\bCo[-]authored[-]by\s*:\s*\S", re.I),
    re.compile(r"\bGenerated[- ]with\s+(?:Claude|ChatGPT|GPT-|Codex|Copilot|Gemini|Anthropic|OpenAI|Cursor)"),
    re.compile(r"\bgenerated-with\s*:\s*\S"),
    re.compile(r"\bGenerated[- ]by\s*:\s*(?:Claude|ChatGPT|Codex|Copilot|Gemini|Anthropic|OpenAI)"),
]

INSTRUCTIONS_RES = [
    re.compile(r"\bThis (?:machine|host|box|workstation) belongs to\b", re.I),
    re.compile(r"\bAuthor and committer on every commi[t]\b", re.I),
    re.compile(r"\bNo AI[-]attribution\b", re.I),
    re.compile(r"\bnever write anything that could identif[y]\b", re.I),
    re.compile(r"^#*\s*Standing instruction[s] for\b", re.I),
    re.compile(r"\bEvery agent session on this machin[e]\b", re.I),
    re.compile(r"\bDo not print the contents of\b.*\b(?:\.ssh|\.claude|\.config|\.postmaster)\b", re.I),
]

# --- allowlist ---------------------------------------------------------------------------------
allow_path = root / "scripts" / "scrub-check.allow"
allowed = set()
if allow_path.is_file():
    try:
        for raw in allow_path.read_text(encoding="utf-8", errors="replace").splitlines():
            s = raw.strip("\r\n")
            if s.strip() and not s.lstrip().startswith("#"):
                allowed.add(s)
    except OSError as e:
        die("cannot read %s: %s" % (allow_path, e.strerror))

def suppressed(value, line):
    return value in allowed or line in allowed

# --- scanning ----------------------------------------------------------------------------------
# (kind, regex, which group is the value: int or None meaning the whole match)
def value_spans(line):
    out = []
    for m in KEY.finditer(line):
        val = m.group(2)
        if not KEY_SKIP.match(val):
            out.append(("key", val))
    for m in EMAIL.finditer(line):
        addr = m.group(0)
        local, _, domain = addr.rpartition("@")
        if local.lower() in NOREPLY_LOCAL:
            continue
        out.append(("email", addr))
    if ACCOUNT_TOKEN.search(line):
        for m in ACCOUNT_TOKEN.finditer(line):
            out.append(("account-id", m.group(0)))
    elif ACCOUNT_CONTEXT.search(line):
        for m in UUID.finditer(line):
            out.append(("account-id", m.group(0)))
    for rx in (HOME_PATH, HARNESS_TMP, HARNESS_DOT):
        for m in rx.finditer(line):
            out.append(("home-path", m.group(0)))
    for rx in (PRIVATE_IP, PRIVATE_HOST, PRIVATE_IPV6):
        for m in rx.finditer(line):
            out.append(("private-host", m.group(0)))
    for rx in TOKEN_RES:
        for m in rx.finditer(line):
            out.append(("token", m.group(0)))
    for rx in ATTRIBUTION_RES:
        for m in rx.finditer(line):
            out.append(("attribution", m.group(0)))
    for rx in INSTRUCTIONS_RES:
        for m in rx.finditer(line):
            out.append(("private-instructions", m.group(0)))
    return out

def parse_patch(patch, commit):
    """Yield (commit, path, lineno, text) for each added line in the patch."""
    path = None
    old_ln = new_ln = 0
    for raw in patch.split("\n"):
        if raw.startswith("diff --git "):
            path = None
            continue
        if raw.startswith("+++ "):
            p = raw[4:].strip()
            if p.startswith("b/"):
                p = p[2:]
            path = p if p != "/dev/null" else None
            continue
        if raw.startswith("--- "):
            continue
        if raw.startswith("@@"):
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
            if m:
                new_ln = int(m.group(1))
            continue
        if path is None:
            continue
        if raw.startswith("+"):
            yield commit, path, new_ln, raw[1:]
            new_ln += 1
        elif raw.startswith("-"):
            pass
        elif raw.startswith("\\"):
            pass
        else:
            new_ln += 1

def commits_to_scan():
    if mode == "history":
        r = git(root, "rev-list", "--reverse", base)
        if r.returncode != 0:
            die("cannot list history of %s: %s" % (base, r.stderr.strip() or "git failed"))
    else:
        r = git(root, "rev-list", "--reverse", "%s..%s" % (base, head))
        if r.returncode != 0:
            die("cannot list %s..%s: %s" % (base, head, r.stderr.strip() or "git failed"))
    shas = [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
    return shas

def patch_of(commit):
    # --root makes a root commit's whole tree look added; --first-parent keeps a merge to
    # its own contribution against the line it branched from.
    r = git(root, "show", "--format=", "--patch", "--root", "--first-parent", "--no-color", commit)
    if r.returncode != 0:
        die("cannot read commit %s: %s" % (commit, r.stderr.strip() or "git failed"))
    return r.stdout

suspects = []
for commit in commits_to_scan():
    for _c, path, lineno, text in parse_patch(patch_of(commit), commit):
        for kind, value in value_spans(text):
            if suppressed(value, text):
                continue
            suspects.append("%s:%s:%d: %s" % (commit, path, lineno, kind))

for s in suspects:
    print(s)
sys.exit(1 if suspects else 0)
PY
}

case ${1:-} in
  --help) usage; exit 0 ;;
  --self-test) ;;
  --history)
    case $# in
      1) set -- --history main ;;
      2) ;;
      *) usage; exit 2 ;;
    esac
    ROOT=$(git -C . rev-parse --show-toplevel 2>/dev/null) || { echo "scrub-check: not a git repository" >&2; exit 2; }
    scan "$ROOT" history "$2" -; exit $? ;;
  ""|-*) usage; exit 2 ;;
  *)
    [ $# -eq 2 ] || { usage; exit 2; }
    ROOT=$(git -C . rev-parse --show-toplevel 2>/dev/null) || { echo "scrub-check: not a git repository" >&2; exit 2; }
    scan "$ROOT" range "$1" "$2"; exit $? ;;
esac

# --- self-test -------------------------------------------------------------------------------
# Fixtures are invented values in scratch git repos under mktemp. No real private value is
# read or written. Every control prints only a kind name or a label, never a matched value.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
SELF="$HERE/scrub-check.sh"
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }

# A scratch repository with one initial commit. Sets REPO and BASE_SHA (the initial sha,
# so a scan range has a real base: main..HEAD would be empty while the branch is main).
newrepo() {
  REPO="$tmp/$1"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.name scrub-selftest
  git -C "$REPO" config user.email noreply@example.org
  printf 'clean\n' > "$REPO/README.md"
  git -C "$REPO" add README.md
  git -C "$REPO" commit -q -m initial
  BASE_SHA=$(git -C "$REPO" rev-parse HEAD)
}

# commit <repo> <name> <content> — one commit that adds a file (or rewrites it)
commit_file() {
  printf '%s\n' "$3" > "$1/$2"
  git -C "$1" add -- "$2"
  git -C "$1" commit -q -m "add $2"
}

# run_range <repo> — scan BASE_SHA..HEAD, capture stdout and exit
run_range() {
  local repo=$1
  SC_OUT=$(cd "$repo" && "$SELF" "$BASE_SHA" HEAD 2>/dev/null)
  SC_RC=$?
}

# run_history <repo> — scan the whole history of main
run_history() {
  local repo=$1
  SC_OUT=$(cd "$repo" && "$SELF" --history main 2>/dev/null)
  SC_RC=$?
}

# Fixture values are composed at runtime from pieces so this source carries no matchable
# form of any kind: the scanner must not flag its own file.
FK=session_context
FV=zxqv-objection-lantern-marmalade
FK2=organizationUuid
FV2=7c2f9a10-4b1e-4c3d-8a9b-0e1f2a3b4c5d
EL=ada.lovelace
ED=corp-notexample.test
AI=org_
AB=k3m9xq72pl4n8w0z
HR=/home/
HU=ada.lovelace
HP=notes/todo.md
IPA=10.
IPB=4.5.6
PHA=printer
PHB=corp
TP=ghp_
TB=abcdefghij
TC=klmnopqrstuvwxyz012345
AT=Co-Authored-By
PI1=This
PI2="machine belongs to Example Handle Only."
E2L=should-be-caught-even-if-removed
E2D=example.test
E3L=listed-value
E3D=example.test

echo "positive controls: each kind is flagged on a fixture that carries it"
pos() {  # pos <kind> <label> <file> <line>
  local kind=$1 label=$2 file=$3 line=$4
  newrepo "pos-$kind-$RANDOM"
  commit_file "$REPO" "$file" "$line"
  run_range "$REPO"
  if [ $SC_RC -eq 1 ] && printf '%s\n' "$SC_OUT" | grep -qF ": $kind"; then
    ok "$label"
  else
    fail "$label (exit $SC_RC)" "$SC_OUT"
  fi
}

pos key   "a sensitive key with a value is flagged"                    t.json   "$FK: $FV"
pos key   "a second key shape is flagged"                              t.json   "$FK2: $FV2"
pos email "an address that is not a public no-reply alias is flagged"  t.txt    "contact is $EL@$ED"
pos account-id "an opaque org id shape is flagged"                     t.txt    "${AI}${AB}"
pos account-id "a UUID on an account line is flagged"                  t.txt    "account UUID $FV2"
pos home-path "a home-directory path is flagged"                       t.txt    "see ${HR}${HU}/${HP} for the list"
pos private-host "a private IPv4 literal is flagged"                   t.txt    "service is on ${IPA}${IPB} port 8080"
pos private-host "a private hostname is flagged"                       t.txt    "called ${PHA}.${PHB} this afternoon"
pos token "a key-shaped string is flagged"                             t.txt    "gave them ${TP}${TB}${TC}"
pos attribution "an attribution trailer is flagged"                    t.txt    "$AT: Assistant <noreply@anthropic.test>"
pos private-instructions "an instructions-file sentence is flagged"    t.md     "$PI1 $PI2"

echo "negative controls: a clean line is not flagged"
neg() {  # neg <label> <file> <line>
  local label=$1 file=$2 line=$3
  newrepo "neg-$RANDOM"
  commit_file "$REPO" "$file" "$line"
  run_range "$REPO"
  if [ $SC_RC -eq 0 ] && [ -z "$SC_OUT" ]; then
    ok "$label"
  else
    fail "$label (exit $SC_RC)" "$SC_OUT"
  fi
}

neg "a plain sentence is clean"                 t.txt 'the ship card lists each check and its exit code'
neg "a no-reply address is clean"               t.txt 'reply to noreply@example.org rather than a person'
neg "a bare key name without a value is clean"  t.txt 'the field userEmail is redacted before promotion'
neg "a git sha is not a token"                  t.txt 'compare against 7450ea7c3f2b8a1d4e6c0b9f8a7d6e5c4b3a2918'
neg "an example uuid with no id context is clean" t.txt "the schema example is $FV2"
neg "a public hostname is clean"                t.txt 'docs live on the project pages site'
neg "a public ip is clean"                      t.txt 'the gateway moved to 8.8.8.8 last month'
neg "a relative project path is clean"          t.txt 'see the file under scripts/ for the wiring'
neg "discussion of attribution is clean"        t.txt 'the commit trailer policy forbids crediting an assistant'
neg "a sentence about instructions is clean"    t.txt 'the rule is written in the runbook beside the gate'

echo "history controls: a line added and then deleted is still flagged"
newrepo hist-add-del
LK=userEmail
LV=$E2L@$E2D
commit_file "$REPO" leak.txt "$LK: $LV"
printf 'clean\n' > "$REPO/leak.txt"
git -C "$REPO" add -- leak.txt
git -C "$REPO" commit -q -m 'delete the leak at the tip'
run_range "$REPO"
if [ $SC_RC -eq 1 ] && printf '%s\n' "$SC_OUT" | grep -qF ': key'; then
  ok "a line added and then deleted is still flagged"
else
  fail "a line added and then deleted is still flagged (exit $SC_RC)" "$SC_OUT"
fi
run_history "$REPO"
if [ $SC_RC -eq 1 ] && printf '%s\n' "$SC_OUT" | grep -qF ': key'; then
  ok "--history sees a line added and then deleted"
else
  fail "--history sees a line added and then deleted (exit $SC_RC)" "$SC_OUT"
fi

echo "allowlist controls: an allowed match does not escalate, an unallowed one does"
newrepo allow
mkdir -p "$REPO/scripts"
AK=userEmail
AV=$E3L@$E3D
commit_file "$REPO" safe.txt "$AK: $AV"
run_range "$REPO"
if [ $SC_RC -eq 1 ] && printf '%s\n' "$SC_OUT" | grep -qF ': key'; then
  ok "a not-yet-allowed match is flagged"
else
  fail "a not-yet-allowed match is flagged (exit $SC_RC)" "$SC_OUT"
fi
printf '%s\n' "$AV" > "$REPO/scripts/scrub-check.allow"
git -C "$REPO" add scripts/scrub-check.allow
git -C "$REPO" commit -q -m 'allow one ruled value'
run_range "$REPO"
if [ $SC_RC -eq 0 ] && [ -z "$SC_OUT" ]; then
  ok "an allowed match is suppressed"
else
  fail "an allowed match is suppressed (exit $SC_RC)" "$SC_OUT"
fi
newrepo allow-whole-line
WL="$FK: whole-line-allowed-99"
commit_file "$REPO" safe.txt "$WL"
run_range "$REPO"
if [ $SC_RC -eq 1 ]; then
  mkdir -p "$REPO/scripts"
  printf '%s\n' "$WL" > "$REPO/scripts/scrub-check.allow"
  git -C "$REPO" add scripts/scrub-check.allow
  git -C "$REPO" commit -q -m 'allow the whole line'
  run_range "$REPO"
  if [ $SC_RC -eq 0 ] && [ -z "$SC_OUT" ]; then
    ok "an allowlist entry equal to the whole line suppresses it"
  else
    fail "an allowlist entry equal to the whole line suppresses it (exit $SC_RC)" "$SC_OUT"
  fi
else
  fail "an allowlist entry equal to the whole line suppresses it (setup)" "$SC_OUT"
fi

echo "usage and range controls"
"$SELF" --help >/dev/null 2>&1
[ $? -eq 0 ] && ok "--help exits 0" || fail "--help exits 0"
"$SELF" >/dev/null 2>&1
[ $? -eq 2 ] && ok "no arguments is a usage error, exit 2" || fail "no arguments is a usage error, exit 2"
"$SELF" main >/dev/null 2>&1
[ $? -eq 2 ] && ok "one range argument is a usage error, exit 2" || fail "one range argument is a usage error, exit 2"
newrepo empty-range
run_range "$REPO"
if [ $SC_RC -eq 0 ] && [ -z "$SC_OUT" ]; then
  ok "an empty range is clean"
else
  fail "an empty range is clean (exit $SC_RC)" "$SC_OUT"
fi

echo "the scanner's own source does not flag itself"
# The real repository's added lines on this branch must scan clean.
REAL=$(dirname "$HERE")
REAL_BASE=$(git -C "$REAL" rev-parse main 2>/dev/null || git -C "$REAL" rev-parse HEAD)
SC_OUT=$(cd "$REAL" && "$SELF" "$REAL_BASE" HEAD 2>/dev/null)
SC_RC=$?
if [ $SC_RC -eq 0 ] && [ -z "$SC_OUT" ]; then
  ok "this branch scans clean"
else
  fail "this branch scans clean (exit $SC_RC)" "$SC_OUT"
fi

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
