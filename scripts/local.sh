#!/usr/bin/env bash
# Tickets kept in the target repository's own git directory, with no service and no login: no
# network, and nothing installed beyond the bash, git and python3 the other scripts use. The
# store is postmaster/tickets/ in the repository's common git directory (.git/postmaster/tickets/
# in a plain checkout): outside the working tree and every branch, one copy whatever branch or
# worktree is checked out, and removed with the repository. A ticket is two files there: <n>.md,
# its body as written, and <n>.json, its title, state, labels, created time and log. Every write
# holds the store's lock and replaces a whole file, so a reader sees a file as it was before a
# write or after it, never in between.
#
#   local.sh <repo> store                          the store's path; exit 3 when there is none
#   local.sh <repo> store init                     make the store; idempotent
#   local.sh <repo> store remove                   remove a store that holds no ticket
#   local.sh <repo> create <title> <body-file>     new ticket in todo; prints its number
#   local.sh <repo> read <n> [--body]              title, state, labels, body, log; with --body,
#                                                  only the body as stored, ending in a newline
#   local.sh <repo> edit <n> <body-file> <base-file>
#                                                  replace the ticket's body; never its title
#   local.sh <repo> title <n> <title>              replace the ticket's title, the user's command
#   local.sh <repo> state <n> <state>              todo | in-progress | blocked | done | cancelled
#   local.sh <repo> comment <n> <actor> <text>     one log line, dated to the minute, actor first
#   local.sh <repo> list [state]                   one line per ticket: number, state, title;
#                                                  grouped by state, in the order above
#   local.sh --self-test                           every command against throwaway repos, offline
#
# <repo> is any checkout of the repository: the main one, a linked worktree or a directory in
# either. Git's own variables that name a repository, such as the GIT_DIR a hook or
# `git rebase --exec` exports, are ignored. store init and store remove run only from the main
# checkout, never from a linked worktree, where lanes and coachmen work: a repository whose store
# exists uses this tracker whatever the config names (scripts/tracker-kind.sh).
#
# A body file or a base file may be /dev/stdin. create and edit drop a byte-order mark from the
# start of a body. edit takes the body as it was read when the change was drafted (read --body)
# and refuses when the ticket no longer matches it, so a change made meanwhile is not lost. list
# prints every ticket it can read, and names on stderr each one it cannot.
#
#   exit 0  ok
#   exit 1  usage, git or python3 missing, not a git repository, unknown ticket, a ticket file
#           that is not as this script writes it, a title that is empty or more than one line, an
#           argument or a body that is not UTF-8, a body file that cannot be read or is empty,
#           store init or remove from a linked worktree, store remove on a store holding a
#           ticket, a store that cannot be read or written, or list with a ticket it cannot read
#   exit 2  invalid state
#   exit 3  the repository has no store (run: local.sh <repo> store init)
#   exit 4  the ticket changed since the base was read
set -uo pipefail
die() { echo "local: $*" >&2; exit 1; }
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
if [ "${1:-}" != --self-test ]; then
  [ $# -ge 2 ] || die "usage: local.sh <repo> store|create|edit|read|title|state|comment|list ... | --self-test"
  REPO=$1
  [ -d "$REPO" ] || die "no such directory: $REPO"
  command -v git >/dev/null 2>&1 || die "git is not on PATH"
  command -v python3 >/dev/null 2>&1 || die "python3 is not on PATH"
  gitpath() {  # gitpath <rev-parse option>: that git directory's physical path, as <repo> sees it
    local p
    p=$(git -C "$REPO" rev-parse "$1" 2>/dev/null) || return 1
    case $p in /*) ;; *) p=$REPO/$p ;; esac
    CDPATH= cd -P -- "$p" 2>/dev/null && pwd -P
  }
  # Every worktree of a repository shares its common git directory, so each finds the one store.
  COMMON=$(gitpath --git-common-dir) || die "not a git repository: $REPO"
  GITDIR=$(gitpath --git-dir) || die "not a git repository: $REPO"
  MAIN=""   # empty in the main checkout; from a linked worktree, the main checkout's path
  if [ "$GITDIR" != "$COMMON" ]; then
    MAIN=$(git -C "$REPO" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
    MAIN=${MAIN:-the main checkout}
  fi

  # The program is an argument, not standard input, so a body or base file can be /dev/stdin;
  # -I keeps python from importing modules out of the directory it runs in, often the target.
  IFS= read -r -d '' PROGRAM <<'PY'
import contextlib, datetime, fcntl, json, os, re, signal, sys

signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # a reader that stops early, such as head, ends us quietly
STATES = ["todo", "in-progress", "blocked", "done", "cancelled"]
STORE, MAIN = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
cmd = args[0]
BOM = b"\xef\xbb\xbf"

def die(msg, code=1):
    print("local: " + msg, file=sys.stderr); sys.exit(code)

def usage(text):
    die("usage: local.sh <repo> " + text)

def utf8(s, what):  # an argument as text; exit 1 when it holds bytes that are not UTF-8
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        die("the %s is not UTF-8" % what)
    return s

def title_arg(s):
    title = utf8(s, "title").strip()
    if not title: die("the title is empty")
    if "\n" in title or "\r" in title: die("the title is more than one line")
    return title

def number_arg(s):
    if not re.fullmatch(r"#?0*[1-9]\d*", s):
        die("not a ticket number: " + s)
    return int(s.lstrip("#"))

def state_arg(s):
    if s not in STATES:
        die("invalid state %s (one of: %s)" % (s, ", ".join(STATES)), 2)
    return s

def need_store():
    if not os.path.isdir(STORE):
        die("no ticket store at %s; with the user's word, run: local.sh <repo> store init" % STORE, 3)

def main_checkout_only(what):
    if MAIN:
        die("%s runs only from the repository's main checkout, %s, never from a linked worktree" % (what, MAIN))

def path(n, ext):
    return os.path.join(STORE, "%d.%s" % (n, ext))

def one_line(s):
    return " ".join(s.split())

def bytes_of(p, what):  # a file's bytes; exit 1 when it cannot be read
    try:
        with open(p, "rb") as f:
            return f.read()
    except OSError as e:
        die("cannot read %s %s: %s" % (what, p, e.strerror))

def text_of(data, p, what):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        die("cannot read %s %s: it is not UTF-8" % (what, p))

def body_file(p):  # a body file's bytes, less a byte-order mark; exit 1 when it cannot be read or is empty
    data = bytes_of(p, "body file")
    data = data[len(BOM):] if data.startswith(BOM) else data
    if not text_of(data, p, "body file").strip():
        die("the body file %s is empty" % p)
    return data

def normal(text):  # a body as edit compares it: line endings, trailing spaces and blank edges aside
    lines = [l.rstrip() for l in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0]: lines.pop(0)
    while lines and not lines[-1]: lines.pop()
    return "\n".join(lines)

def load(n):  # (a ticket's title, state, labels, created time and log, None), or (None, why not)
    p = path(n, "json")
    try:
        with open(p, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return None, "no ticket #%d in %s" % (n, STORE)
    except OSError as e:
        return None, "cannot read ticket #%d at %s: %s" % (n, p, e.strerror)
    try:
        m = json.loads(raw.decode("utf-8-sig"))
    except ValueError as e:  # a decoding error is a ValueError too
        return None, "ticket #%d at %s is not valid JSON: %s" % (n, p, e)
    if not isinstance(m, dict):
        return None, "ticket #%d at %s is not a JSON object" % (n, p)
    for k in ("title", "state", "created"):
        if not isinstance(m.get(k), str):
            return None, "ticket #%d at %s has no %s string" % (n, p, k)
    for k in ("labels", "log"):
        v = m.setdefault(k, [])
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            return None, "ticket #%d at %s: its %s is not a list of strings" % (n, p, k)
    return m, None

def meta(n):  # exit 1 when there is no such ticket, or its file is not as this script writes it
    m, why = load(n)
    if why: die(why)
    return m

def body(n):
    return bytes_of(path(n, "md"), "the body of #%d at" % n)

def write(p, data):  # replace a whole file: a reader sees the old one or the new one, never part
    tmp = "%s.%d.tmp" % (p, os.getpid())
    try:
        with open(tmp, "wb") as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
    except OSError as e:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        die("cannot write %s: %s" % (p, e.strerror))

def write_meta(n, m):
    write(path(n, "json"), (json.dumps(m, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))

@contextlib.contextmanager
def locked():  # every write holds the store's lock; it is released when the process ends, whatever happens
    try:
        fd = os.open(os.path.join(STORE, ".lock"), os.O_RDWR | os.O_CREAT, 0o644)
        fcntl.flock(fd, fcntl.LOCK_EX)
    except OSError as e:
        need_store()
        die("cannot lock the store %s: %s" % (STORE, e.strerror))
    try:
        need_store()  # it may have been removed while this waited for the lock
        yield
    finally:
        os.close(fd)

def numbers():  # every ticket's number, ascending; a ticket exists once its .json is written
    return sorted(int(m.group(1)) for m in (re.fullmatch(r"(\d+)\.json", f) for f in os.listdir(STORE)) if m)

def next_number():  # one past every number in use, including a body an unfinished create left
    used = [int(m.group(1)) for m in (re.fullmatch(r"(\d+)\.(?:json|md)", f) for f in os.listdir(STORE)) if m]
    return max(used, default=0) + 1

if cmd == "store":
    if len(args) == 1:
        need_store(); print(STORE)
    elif args[1:] == ["init"]:
        main_checkout_only("store init")
        existed = os.path.isdir(STORE)
        try:
            os.makedirs(STORE, exist_ok=True)
        except OSError as e:
            die("cannot make %s: %s" % (STORE, e.strerror))
        print("store %s: %s" % ("exists" if existed else "created", STORE))
    elif args[1:] == ["remove"]:
        main_checkout_only("store remove")
        need_store()
        with locked():
            names = os.listdir(STORE)
            held = {f.split(".")[0] for f in names if re.fullmatch(r"\d+\.(?:json|md)", f)}
            if held:
                die("the store at %s holds %d ticket(s); it is removed only when it holds none" % (STORE, len(held)))
            for f in names:  # the lock, and whatever an unfinished write left
                if f == ".lock" or re.fullmatch(r"\d+\.(?:json|md)\.\d+\.tmp", f):
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(os.path.join(STORE, f))
            try:
                os.rmdir(STORE)
            except OSError as e:
                die("cannot remove %s: %s" % (STORE, e.strerror))
            with contextlib.suppress(OSError):
                os.rmdir(os.path.dirname(STORE))  # postmaster/, when nothing else is in it
        print("store removed: %s" % STORE)
    else:
        usage("store [init|remove]")

elif cmd == "create":
    if len(args) != 3: usage("create <title> <body-file>")
    title = title_arg(args[1]); data = body_file(args[2])
    need_store()
    with locked():
        n = next_number()
        write(path(n, "md"), data)
        created = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        write_meta(n, {"title": title, "state": "todo", "labels": [], "created": created, "log": []})
    print(n)

elif cmd == "edit":
    # Four arguments whose body file does not exist are most likely the form the other adapters
    # once took, with a title where the body file goes.
    if len(args) != 4 or not os.path.exists(args[2]):
        usage("edit <n> <body-file> <base-file>" + ("; no such body file: " + args[2] if len(args) == 4 else ""))
    n = number_arg(args[1])
    data = body_file(args[2]); base = text_of(bytes_of(args[3], "base file"), args[3], "base file")
    need_store()
    with locked():
        meta(n)
        if normal(body(n).decode("utf-8-sig", errors="replace")) != normal(base.lstrip("\ufeff")):
            die("#%d changed since %s was read; read it again" % (n, args[3]), 4)
        write(path(n, "md"), data)
    print("#%d: edited" % n)

elif cmd == "read":
    body_only = args[2:] == ["--body"]
    if len(args) != 2 and not body_only: usage("read <n> [--body]")
    n = number_arg(args[1]); need_store(); m = meta(n); data = body(n)
    if body_only:
        sys.stdout.buffer.write(data if data.endswith(b"\n") else data + b"\n"); sys.exit(0)
    print("id: #%d" % n)
    print("title: %s" % one_line(m["title"]))
    print("state: %s" % one_line(m["state"]))
    print("labels: %s" % ", ".join(one_line(l) for l in m["labels"]))
    print("created: %s" % m["created"][:10])
    print("path: %s" % path(n, "md"))
    print()
    print(data.decode("utf-8-sig", errors="replace").strip())
    if m["log"]:
        print("\n## Log")
        for line in m["log"]:
            print("- " + one_line(line))

elif cmd == "title":
    if len(args) != 3: usage("title <n> <title>")
    n = number_arg(args[1]); title = title_arg(args[2])
    need_store()
    with locked():
        m = meta(n); m["title"] = title; write_meta(n, m)
    print("#%d: title changed" % n)

elif cmd == "state":
    if len(args) != 3: usage("state <n> <state>")
    n = number_arg(args[1]); new = state_arg(args[2])
    need_store()
    with locked():
        m = meta(n); m["state"] = new; write_meta(n, m)
    print("#%d: %s" % (n, new))

elif cmd == "comment":
    if len(args) < 4: usage("comment <n> <actor> <text>")
    n = number_arg(args[1]); actor = utf8(args[2], "actor"); text = utf8(" ".join(args[3:]), "comment")
    line = one_line("%s %s: %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), actor, text))
    need_store()
    with locked():
        m = meta(n); m["log"].append(line); write_meta(n, m)
    print("#%d: %s" % (n, line))

elif cmd == "list":
    if len(args) not in (1, 2): usage("list [state]")
    want = state_arg(args[1]) if len(args) == 2 else None
    need_store()
    rows, unread = [], []
    for n in numbers():
        m, why = load(n)
        if why: unread.append(why)
        else: rows.append((n, one_line(m["state"]), one_line(m["title"])))
    rank = lambda r: (STATES.index(r[1]) if r[1] in STATES else len(STATES), r[0])
    for n, st, title in sorted(rows, key=rank):
        if want is None or st == want:
            print("#%d\t%s\t%s" % (n, st, title))
    for why in unread:
        print("local: " + why, file=sys.stderr)
    sys.exit(1 if unread else 0)

else:
    usage("store|create|edit|read|title|state|comment|list ...")
PY
  exec python3 -I -c "$PROGRAM" "$COMMON/postmaster/tickets" "$MAIN" "${@:2}"
fi

# --- self-test ----------------------------------------------------------------------------
# Every command runs for real, against throwaway repositories with no remote. HOME is an empty
# directory, git reads no user or system config, every proxy points at a closed port, and a gh
# first on PATH records any call, so a control passing here needed no service and no login.
SELF="$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")"
HERE=$(dirname -- "$SELF")
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT   # stdin not a terminal: rm asks nothing about git's read-only files
tmp=$(CDPATH= cd -P -- "$tmp" && pwd -P) || exit 1
mkdir -p "$tmp/bin" "$tmp/home/.config" || exit 1
printf '#!/bin/sh\necho "gh $*" >> "%s/gh.log"\nexit 1\n' "$tmp" > "$tmp/bin/gh" && chmod +x "$tmp/bin/gh" || exit 1
export HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" PATH="$tmp/bin:$PATH" POSTMASTER_CONFIG="$tmp/home/no-config.toml"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CEILING_DIRECTORIES="$tmp"
for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY; do export "$v=http://127.0.0.1:9"; done
export GIT_AUTHOR_NAME=self-test GIT_AUTHOR_EMAIL=self-test@example.org GIT_COMMITTER_NAME=self-test GIT_COMMITTER_EMAIL=self-test@example.org

newrepo() {  # newrepo <dir>: a repository with no remote, one commit, and worktrees excluded as the flow does
  git init -q "$1" && git -C "$1" commit -q --allow-empty -m "Initial commit" \
    && mkdir -p "$1/.git/info" && printf '.worktrees/\n' >> "$1/.git/info/exclude"
}
R="$tmp/repo"; W="$R/.worktrees/7"
newrepo "$R" && mkdir "$R/sub" && git -C "$R" worktree add -q "$W" -b 7 || exit 1
U="$tmp/unticketed"; newrepo "$U" || exit 1
ST="$R/.git/postmaster/tickets"
lt() { out=$("$SELF" "$@" 2>&1); rc=$?; }                   # lt <repo> <command...>: sets out and rc
snap() { local f; for f in "$1"/*; do [ -f "$f" ] && printf '%s %s\n' "${f##*/}" "$(cksum < "$f")"; done; }   # snap <store>
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
check() {  # check <label> <exit wanted> <text the output holds, or empty>: judges the last lt
  if [ "$rc" -eq "$2" ] && { [ -z "$3" ] || printf '%s\n' "$out" | grep -qF -- "$3"; }; then ok "$1"
  else fail "$1: wanted exit $2${3:+ with \"$3\"}, got exit $rc" "$out"; fi
}
refused() {  # refused <label> <exit> <text the message holds> <repo> <command...>: exits so and changes no file in R's store
  local label=$1 want=$2 why=$3 was; shift 3
  was=$(snap "$ST"); lt "$@"
  if [ "$rc" -eq "$want" ] && printf '%s\n' "$out" | grep -qF -- "$why" && [ "$(snap "$ST")" = "$was" ]; then ok "$label"
  else fail "$label: wanted exit $want with \"$why\" and no file changed, got exit $rc" "$out"; fi
}
bodyline() { printf '%s\n' "$out" | sed -n 8p; }   # the first body line of the last read

printf '## Problem / feature\nA ticket with `code`, "quotes" and a trailing space. \n\n## Acceptance criteria\n1. It is read back as written.\n\n## Direction\nNone: any approach that meets the criteria.\n\n## Turnpikes\ndefault\n' > "$tmp/body.md"
printf '## Problem / feature\r\nStored with CRLF line endings.\r\n' > "$tmp/crlf.md"
printf '## Problem / feature\nThe new body.\n' > "$tmp/new.md"
printf ' \n\n' > "$tmp/empty.md"
{ printf '\357\273\277'; cat "$tmp/body.md"; } > "$tmp/bom.md"
printf '[tracker]\nkind = "github"\n' > "$tmp/github.toml"; printf '[tracker]\nkind = "plane"\n' > "$tmp/plane.toml"

echo "negative controls: a repository with no store"
lt "$R" store; check "store says there is none, exit 3, and names store init" 3 "store init"
nostore() { local label=$1; shift; lt "$R" "$@"; check "$label exits 3" 3 "no ticket store"; }   # nostore <label> <command...>
nostore create create "A title" "$tmp/body.md"
nostore read read 1
nostore "read --body" read 1 --body
nostore edit edit 1 "$tmp/new.md" "$tmp/body.md"
nostore title title 1 "A title"
nostore state state 1 done
nostore comment comment 1 postmaster "hello"
nostore list list
nostore "store remove" store remove
lt "$W" store init; check "store init from a linked worktree is refused, and names the main checkout" 1 "main checkout, $R"
[ ! -e "$ST" ] && ok "and none of them made a store" || fail "and none of them made a store"
mkdir "$tmp/plain"; lt "$tmp/plain" list; check "a directory that is not a git repository exits 1" 1 "not a git repository"

echo "positive controls"
refs=$(git -C "$R" for-each-ref | cksum); commits=$(git -C "$R" rev-list --all | wc -l)
lt "$R/sub" store init; check "store init from the main checkout makes the store in the repository's git directory" 0 "store created: $R/.git/postmaster/tickets"
lt "$R" store init; check "store init on an empty store leaves it as it was" 0 "store exists:"
same=1
for d in "$R" "$R/sub" "$W"; do lt "$d" store; [ "$rc" -eq 0 ] && [ "$out" = "$ST" ] || same=0; done
[ $same -eq 1 ] && ok "the main checkout, a directory in it and a linked worktree find the same store" \
  || fail "the main checkout, a directory in it and a linked worktree find the same store" "$out"
before=$(date -u +%Y-%m-%d); lt "$R" create "  A tracker that needs no service  " "$tmp/body.md"; after=$(date -u +%Y-%m-%d)
[ "$rc" -eq 0 ] && [ "$out" = 1 ] && ok "create prints the new ticket's number, 1" || fail "create prints the new ticket's number, 1 (exit $rc)" "$out"
lt "$R" create "Line endings" "$tmp/crlf.md"
[ "$rc" -eq 0 ] && [ "$out" = 2 ] && ok "the next create prints 2" || fail "the next create prints 2 (exit $rc)" "$out"
"$SELF" "$R" read 1 --body > "$tmp/out" 2>&1; rc=$?
[ $rc -eq 0 ] && cmp -s "$tmp/out" "$tmp/body.md" && ok "read --body prints the body byte for byte" \
  || fail "read --body prints the body byte for byte (exit $rc)" "$(cat -A "$tmp/out")"
"$SELF" "$R" read 2 --body > "$tmp/out" 2>&1; rc=$?
[ $rc -eq 0 ] && cmp -s "$tmp/out" "$tmp/crlf.md" && ok "a CRLF body keeps its line endings" \
  || fail "a CRLF body keeps its line endings (exit $rc)" "$(cat -A "$tmp/out")"
lt "$R" read 1
head=$(printf '%s\n' "$out" | sed -n '1,7p' | tr '\n' '|')
case $head in
  "id: #1|title: A tracker that needs no service|state: todo|labels: |created: $before|path: $ST/1.md||" \
  | "id: #1|title: A tracker that needs no service|state: todo|labels: |created: $after|path: $ST/1.md||") good=1 ;;
  *) good=0 ;;
esac
[ "$rc" -eq 0 ] && [ $good -eq 1 ] && [ "$(bodyline)" = "## Problem / feature" ] \
  && ok "read prints id, title, state, labels, created and path, a blank line, then the body" \
  || fail "read prints id, title, state, labels, created and path, a blank line, then the body (exit $rc)" "$out"
lt "$W" read 1; from_worktree=$out; lt "$R/sub" read 1
[ "$rc" -eq 0 ] && [ "$out" = "$from_worktree" ] && ok "a linked worktree and a subdirectory read the same ticket" \
  || fail "a linked worktree and a subdirectory read the same ticket" "$out"
lt "$W" state 1 in-progress; lt "$R" read 1
printf '%s\n' "$out" | grep -qx 'state: in-progress' && ok "a state set from a linked worktree is the state the main checkout reads" \
  || fail "a state set from a linked worktree is the state the main checkout reads" "$out"
line='[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} coachman: Harvested both lanes\.'
lt "$R/sub" comment 1 coachman "Harvested both
lanes."; written=$out; lt "$R" read 1
[ "$(printf '%s\n' "$written" | wc -l)" -eq 1 ] && printf '%s\n' "$written" | grep -qxE -e "#1: $line" \
  && printf '%s\n' "$out" | sed -n '/^## Log$/,$p' | grep -qxE -e "- $line" \
  && ok "comment adds one dated line to the log, actor first, on one line" \
  || fail "comment adds one dated line to the log, actor first, on one line" "$written$(printf '\n'; printf '%s' "$out")"
"$SELF" "$R" read 1 --body > "$tmp/base.md" 2>/dev/null
lt "$R" edit 1 "$tmp/new.md" "$tmp/base.md"; check "edit against the body as read replaces it" 0 "#1: edited"
"$SELF" "$R" read 1 --body > "$tmp/out" 2>&1
lt "$R" read 1
cmp -s "$tmp/out" "$tmp/new.md" && printf '%s\n' "$out" | grep -qx 'title: A tracker that needs no service' && printf '%s\n' "$out" | grep -qx 'state: in-progress' \
  && ok "the body is the new one, and the title and state are as they were" || fail "the body is the new one, and the title and state are as they were" "$out"
printf '## Problem / feature  \r\nThe new body.  \r\n\r\n' > "$tmp/base-crlf.md"
lt "$R" edit 1 "$tmp/new.md" "$tmp/base-crlf.md"; check "a base that differs only in line endings and trailing spaces matches" 0 "#1: edited"
lt "$R" title 1 "  Tickets with no service  "; check "title replaces the title" 0 "#1: title changed"
"$SELF" "$R" read 1 --body > "$tmp/out" 2>&1; lt "$R" read 1
printf '%s\n' "$out" | grep -qx 'title: Tickets with no service' && printf '%s\n' "$out" | grep -qx 'state: in-progress' && cmp -s "$tmp/out" "$tmp/new.md" \
  && ok "and leaves the body and state as they were" || fail "and leaves the body and state as they were" "$out"
lt "$R" create "Blocked one" "$tmp/body.md"; lt "$R" state 3 blocked
lt "$R" create "Done one" "$tmp/body.md"; lt "$R" state 4 done
lt "$R" create "Cancelled one" "$tmp/body.md"; lt "$R" state 5 cancelled
lt "$R" create "Another todo" "$tmp/body.md"; lt "$R" state 2 done
lt "$R" list
want_list=$(printf '#6\ttodo\tAnother todo\n#1\tin-progress\tTickets with no service\n#3\tblocked\tBlocked one\n#2\tdone\tLine endings\n#4\tdone\tDone one\n#5\tcancelled\tCancelled one')
[ "$rc" -eq 0 ] && [ "$out" = "$want_list" ] && ok "list groups every ticket by state, in the flow's order, then by number" \
  || fail "list groups every ticket by state, in the flow's order, then by number (exit $rc)" "$out"
lt "$R" list done
[ "$rc" -eq 0 ] && [ "$out" = "$(printf '#2\tdone\tLine endings\n#4\tdone\tDone one')" ] && ok "list <state> lists only that state" \
  || fail "list <state> lists only that state (exit $rc)" "$out"
was=$(snap "$ST"); lt "$R" store init; said=$out; lt "$R" list
[ "$(snap "$ST")" = "$was" ] && [ "$out" = "$want_list" ] && printf '%s\n' "$said" | grep -qF "store exists:" \
  && ok "store init on a store holding tickets changes none of them" || fail "store init on a store holding tickets changes none of them" "$said$(printf '\n'; printf '%s' "$out")"
lt "$R" create "With a byte-order mark" "$tmp/bom.md"; n=$out
"$SELF" "$R" read "$n" --body > "$tmp/out" 2>&1; lt "$R" read "$n"
cmp -s "$tmp/out" "$tmp/body.md" && [ "$(bodyline)" = "## Problem / feature" ] \
  && ok "create drops a body's byte-order mark" || fail "create drops a body's byte-order mark" "$(cat -A "$tmp/out")"
{ printf '\357\273\277'; cat "$tmp/body.md"; } > "$ST/$n.md"; lt "$R" read "$n"
[ "$rc" -eq 0 ] && [ "$(bodyline)" = "## Problem / feature" ] && ok "read shows the first heading of a body that gained a byte-order mark" \
  || fail "read shows the first heading of a body that gained a byte-order mark (exit $rc)" "$(bodyline | cat -A)"
n=$("$SELF" "$R" create "From a pipe" /dev/stdin < <(cat "$tmp/body.md") 2>&1); "$SELF" "$R" read "$n" --body > "$tmp/out" 2>&1
cmp -s "$tmp/out" "$tmp/body.md" && ok "create takes its body from /dev/stdin" || fail "create takes its body from /dev/stdin" "$n$(printf '\n'; cat "$tmp/out")"
"$SELF" "$R" read "$n" --body > "$tmp/base.md"; out=$(cat "$tmp/new.md" | "$SELF" "$R" edit "$n" /dev/stdin "$tmp/base.md" 2>&1); rc=$?
"$SELF" "$R" read "$n" --body > "$tmp/out" 2>&1
[ $rc -eq 0 ] && cmp -s "$tmp/out" "$tmp/new.md" && ok "edit takes its body from /dev/stdin" || fail "edit takes its body from /dev/stdin (exit $rc)" "$out"
out=$("$SELF" "$R" read "$n" --body | "$SELF" "$R" edit "$n" "$tmp/body.md" /dev/stdin 2>&1); rc=$?
[ $rc -eq 0 ] && ok "edit takes its base from /dev/stdin" || fail "edit takes its base from /dev/stdin (exit $rc)" "$out"
[ -z "$(git -C "$R" status --porcelain --ignored=no)" ] && [ "$(git -C "$R" for-each-ref | cksum)" = "$refs" ] \
  && [ "$(git -C "$R" rev-list --all | wc -l)" = "$commits" ] && [ -z "$(git -C "$W" status --porcelain)" ] \
  && ok "no ticket is in a working tree, on a branch or in a commit" \
  || fail "no ticket is in a working tree, on a branch or in a commit" "$(git -C "$R" status --porcelain; git -C "$R" for-each-ref)"
C="$tmp/concurrent"; newrepo "$C" && "$SELF" "$C" store init > /dev/null || exit 1
pids=""; for k in 1 2 3 4 5 6 7 8 9 10; do "$SELF" "$C" create "Ticket $k" "$tmp/body.md" > "$tmp/c.$k" 2>&1 & pids="$pids $!"; done
bad=0; for p in $pids; do wait "$p" || bad=$((bad+1)); done
got=$(cat "$tmp"/c.* | sort -n | paste -sd' ' -)
[ $bad -eq 0 ] && [ "$got" = "1 2 3 4 5 6 7 8 9 10" ] && [ "$("$SELF" "$C" list | wc -l | tr -d ' ')" = 10 ] \
  && ok "ten creates at once get ten different numbers" || fail "ten creates at once get ten different numbers ($bad failed)" "$got"

echo "controls: what the caller's environment must not change"
lt "$R" store; mine=$out
out=$(GIT_DIR="$U/.git" GIT_WORK_TREE="$U" GIT_INDEX_FILE="$U/.git/index" "$SELF" "$R" store 2>&1); rc=$?
V="$tmp/other"; newrepo "$V" || exit 1
GIT_DIR="$U/.git" GIT_WORK_TREE="$U" "$SELF" "$V" store init > /dev/null 2>&1
[ $rc -eq 0 ] && [ "$out" = "$mine" ] && [ -d "$V/.git/postmaster/tickets" ] && [ ! -e "$U/.git/postmaster" ] \
  && ok "a GIT_DIR from the caller does not steer it to another repository" \
  || fail "a GIT_DIR from the caller does not steer it to another repository (exit $rc)" "$out"
out=$(cd "$tmp" && CDPATH=.:/nonexistent "$SELF" repo store 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = "$ST" ] && ok "an exported CDPATH does not move a relative <repo>" \
  || fail "an exported CDPATH does not move a relative <repo> (exit $rc)" "$out"
Q="$tmp/caller"; newrepo "$Q" && ln -s "$R/sub" "$Q/link" || exit 1
out=$("$SELF" "$Q/link" store 2>&1); rc=$?; "$SELF" "$Q/link" store init > /dev/null 2>&1
[ $rc -eq 0 ] && [ "$out" = "$ST" ] && [ ! -e "$Q/.git/postmaster" ] \
  && ok "a symlink to a directory in the repository finds its store, not the store of the repository holding the link" \
  || fail "a symlink to a directory in the repository finds its store, not the store of the repository holding the link (exit $rc)" "$out"
S="$tmp/shadowing"; newrepo "$S" && "$SELF" "$S" store init > /dev/null && "$SELF" "$S" create "Shadowed" "$tmp/body.md" > /dev/null || exit 1
mkdir "$S/json"
for m in signal re contextlib datetime tomllib json/__init__; do
  printf 'open(%s, "a").write("%s\\n")\nraise SystemExit(9)\n' "'$tmp/imported'" "$m" > "$S/$m.py"
done
out=$(cd "$S" && "$SELF" . list 2>&1); rc=$?
kind=$(cd "$S" && POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/discover-project.sh" . 2>/dev/null | sed -n 's/^tracker=//p')
other=$(cd "$S" && POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/tracker-kind.sh" "$U" 2>&1)
[ $rc -eq 0 ] && [ "$kind" = local ] && [ "$other" = github ] && [ ! -e "$tmp/imported" ] && [ ! -e "$S/__pycache__" ] \
  && ok "modules in the target's own directory are never imported" \
  || fail "modules in the target's own directory are never imported (exit $rc, tracker=$kind)" "$out$(printf '\n'; cat "$tmp/imported" 2>/dev/null)"

echo "negative controls: nothing is written"
"$SELF" "$R" read 1 --body > "$tmp/base.md" 2>/dev/null
printf '## Problem / feature\nChanged in the store since.\n' > "$tmp/stale.md"
refused "a base the ticket no longer matches exits 4" 4 "#1 changed since" "$R" edit 1 "$tmp/body.md" "$tmp/stale.md"
refused "an empty body file exits 1" 1 "is empty" "$R" edit 1 "$tmp/empty.md" "$tmp/base.md"
refused "a missing base file exits 1" 1 "cannot read base file" "$R" edit 1 "$tmp/body.md" "$tmp/nowhere.md"
refused "the form with a title is a usage error" 1 "usage:" "$R" edit 1 "A title" "$tmp/body.md"
refused "edit on an unknown ticket exits 1" 1 "no ticket #99" "$R" edit 99 "$tmp/body.md" "$tmp/base.md"
refused "an invalid state exits 2" 2 "invalid state" "$R" state 1 finished
refused "state on an unknown ticket exits 1" 1 "no ticket #99" "$R" state 99 done
refused "a comment on an unknown ticket exits 1" 1 "no ticket #99" "$R" comment 99 coachman "hello"
refused "a comment that is not UTF-8 exits 1" 1 "comment is not UTF-8" "$R" comment 1 coachman "$(printf 'na\357ve')"
refused "an actor that is not UTF-8 exits 1" 1 "actor is not UTF-8" "$R" comment 1 "$(printf 'r\351viewer')" "hello"
refused "create with an empty body exits 1" 1 "is empty" "$R" create "A title" "$tmp/empty.md"
refused "create with an empty title exits 1" 1 "title is empty" "$R" create "  " "$tmp/body.md"
refused "create with a title of two lines exits 1" 1 "more than one line" "$R" create "Two
lines" "$tmp/body.md"
refused "create with a title that is not UTF-8 exits 1" 1 "title is not UTF-8" "$R" create "$(printf 'caf\351')" "$tmp/body.md"
refused "title with an empty title exits 1" 1 "title is empty" "$R" title 1 " "
refused "title with two lines exits 1" 1 "more than one line" "$R" title 1 "Two
lines"
refused "title that is not UTF-8 exits 1" 1 "title is not UTF-8" "$R" title 1 "$(printf '\377')"
refused "title on an unknown ticket exits 1" 1 "no ticket #99" "$R" title 99 "A title"
refused "something that is not a number exits 1" 1 "not a ticket number" "$R" read "PM-1"
refused "an unknown ticket exits 1" 1 "no ticket #99" "$R" read 99
refused "list with an invalid state exits 2" 2 "invalid state" "$R" list finished
refused "store init from a linked worktree is refused where a store exists too" 1 "never from a linked worktree" "$W" store init
refused "store remove from a linked worktree exits 1" 1 "never from a linked worktree" "$W" store remove
refused "store remove on a store holding tickets exits 1" 1 "removed only when it holds none" "$R" store remove
[ ! -e "$tmp/gh.log" ] && ok "no command called gh" || fail "no command called gh" "$(cat "$tmp/gh.log")"

echo "controls: a ticket file that is not as this script writes it"
L="$tmp/damaged"; LS="$L/.git/postmaster/tickets"; newrepo "$L" && "$SELF" "$L" store init > /dev/null || exit 1
for t in One Two Three; do "$SELF" "$L" create "$t" "$tmp/body.md" > /dev/null || exit 1; done
cp "$LS/2.json" "$tmp/2.json"; printf '{"title": "Two", "state": "todo",\n' > "$LS/2.json"
out=$("$SELF" "$L" list 2> "$tmp/err"); rc=$?
[ $rc -eq 1 ] && [ "$out" = "$(printf '#1\ttodo\tOne\n#3\ttodo\tThree')" ] && grep -qF "ticket #2" "$tmp/err" \
  && ok "list prints the tickets it can read, names the one it cannot, and exits 1" \
  || fail "list prints the tickets it can read, names the one it cannot, and exits 1 (exit $rc)" "$out$(printf '\n'; cat "$tmp/err")"
{ printf '\357\273\277'; cat "$tmp/2.json"; } > "$LS/2.json"
python3 -I -c 'import json, sys; p = sys.argv[1]; m = json.load(open(p)); m["log"] = "a line"; json.dump(m, open(p, "w"))' "$LS/3.json"
was=$(cksum < "$LS/3.json"); lt "$L" comment 3 coachman "hello"
[ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -qF "log is not a list" && [ "$(cksum < "$LS/3.json")" = "$was" ] \
  && ok "a log that is not a list is refused, not split into characters" || fail "a log that is not a list is refused, not split into characters (exit $rc)" "$out"
python3 -I -c 'import json, sys; p = sys.argv[1]; m = json.load(open(p)); m["log"] = []; m["labels"] = "bug"; json.dump(m, open(p, "w"))' "$LS/3.json"
lt "$L" read 3; check "labels that are not a list are refused" 1 "labels is not a list"
python3 -I -c 'import json, sys; p = sys.argv[1]; m = json.load(open(p)); m["labels"] = []; json.dump(m, open(p, "w"))' "$LS/3.json"
lt "$L" list
[ "$rc" -eq 0 ] && [ "$out" = "$(printf '#1\ttodo\tOne\n#2\ttodo\tTwo\n#3\ttodo\tThree')" ] \
  && ok "a ticket file saved with a byte-order mark still reads" || fail "a ticket file saved with a byte-order mark still reads (exit $rc)" "$out"

echo "controls: store init and store remove, from the main checkout only"
G="$tmp/guarded"; newrepo "$G" && git -C "$G" worktree add -q "$G/.worktrees/lane" -b lane || exit 1
POSTMASTER_CONFIG="$tmp/github.toml" "$SELF" "$G/.worktrees/lane" store init > /dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && [ ! -e "$G/.git/postmaster" ] && ok "a lane's worktree cannot make its repository a store" \
  || fail "a lane's worktree cannot make its repository a store (exit $rc)"
"$SELF" "$G" store init > /dev/null || exit 1
lt "$G" store remove; check "store remove on a store that holds no ticket removes it" 0 "store removed:"
[ ! -e "$G/.git/postmaster" ] && POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/tracker-kind.sh" "$G" 2>/dev/null | grep -qx github \
  && ok "and the repository is back on the config's kind" || fail "and the repository is back on the config's kind" "$(ls -a "$G/.git/postmaster" 2>&1)"

echo "controls: a repository whose store exists uses this tracker, whatever the config names"
tracker() { POSTMASTER_CONFIG=$1 "$HERE/discover-project.sh" "$2" 2>/dev/null | sed -n 's/^tracker=//p'; }
[ "$(tracker "$tmp/github.toml" "$R")" = local ] && [ "$(tracker "$tmp/github.toml" "$W")" = local ] \
  && ok "discover-project.sh names local for it and its worktree, with a config naming github" \
  || fail "discover-project.sh names local for it and its worktree, with a config naming github" "$(tracker "$tmp/github.toml" "$R")"
[ "$(tracker "$tmp/github.toml" "$U")" = github ] && [ "$(tracker "$tmp/plane.toml" "$U")" = plane ] \
  && [ -z "$(tracker "$tmp/home/no-config.toml" "$U")" ] \
  && ok "a repository with no store gets the config's kind, and none without a config" \
  || fail "a repository with no store gets the config's kind, and none without a config" "$(tracker "$tmp/github.toml" "$U")"
out=$(POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/tracker-kind.sh" "$tmp/plain" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "not a git repository" && [ -z "$(tracker "$tmp/github.toml" "$tmp/plain")" ] \
  && ok "a store that cannot be looked for is not taken for no store" \
  || fail "a store that cannot be looked for is not taken for no store (exit $rc)" "$out"
kind=$(cd "$tmp" && POSTMASTER_CONFIG=plane.toml "$HERE/discover-project.sh" "$U" 2>/dev/null | sed -n 's/^tracker=//p')
[ "$kind" = plane ] && ok "a relative POSTMASTER_CONFIG is read from the caller's directory" \
  || fail "a relative POSTMASTER_CONFIG is read from the caller's directory" "tracker=$kind"
out=$(env -u HOME -u POSTMASTER_CONFIG "$HERE/discover-project.sh" "$U" 2>/dev/null); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qx 'tracker=' && printf '%s\n' "$out" | grep -q '^gate=' \
  && ok "with HOME unset, discover-project.sh still reports, with the kind left to ask" \
  || fail "with HOME unset, discover-project.sh still reports, with the kind left to ask (exit $rc)" "$out"
kind=$(cd "$(dirname -- "$HERE")" && CDPATH=.:/nonexistent POSTMASTER_CONFIG="$tmp/github.toml" scripts/discover-project.sh "$R" 2>/dev/null | sed -n 's/^tracker=//p')
[ "$kind" = local ] && ok "discover-project.sh run by a relative path with CDPATH exported still finds the rule" \
  || fail "discover-project.sh run by a relative path with CDPATH exported still finds the rule" "tracker=$kind"
POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/discover-project.sh" "$U" 2> "$tmp/err" > /dev/null
H="$tmp/hosted"; newrepo "$H" && git -C "$H" remote add origin https://github.com/o/r.git || exit 1
POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/discover-project.sh" "$H" 2> "$tmp/err-hosted" > /dev/null
grep -qF "store init" "$tmp/err" && ! grep -qF "store init" "$tmp/err-hosted" \
  && ok "a github target with no origin remote is pointed at store init, and one with a remote is not" \
  || fail "a github target with no origin remote is pointed at store init, and one with a remote is not" "$(cat "$tmp/err" "$tmp/err-hosted")"
out=$(POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/ticket-check.sh" "$R" 3 2>&1); rc=$?
out7=$(POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/ticket-check.sh" "$R" 7 2>&1); rc7=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q '^well-formed' && [ $rc7 -eq 0 ] && [ ! -e "$tmp/gh.log" ] \
  && ok "ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside" \
  || fail "ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside (exit $rc, $rc7)" "$out$(printf '\n'; printf '%s' "$out7")"
out=$(POSTMASTER_CONFIG="$tmp/github.toml" "$HERE/ticket-check.sh" "$U" 3 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "github adapter" && [ -s "$tmp/gh.log" ] \
  && ok "without a store it goes to the github adapter, and the gh on PATH saw the call" \
  || fail "without a store it goes to the github adapter, and the gh on PATH saw the call (exit $rc)" "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
