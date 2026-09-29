#!/usr/bin/env bash
# GitHub Issues as tickets, on a GitHub Projects board as the kanban. One board per target
# repo, linked to it and found through that link, so nothing is configured: the board's Status
# column, which every new board has as Todo, In Progress and Done, carries the flow's state,
# and closing an issue is done. GitHub has no blocked column by default, so blocked is a label
# named `blocked`, added without moving the card and removed by the next state change.
#
#   github.sh <repo> board                         the linked board; exit 3 when there is none
#   github.sh <repo> board init [title]            create a board named after the repo and
#                                                  link it; idempotent
#   github.sh <repo> create <title> <body-file>    new issue on the board in Todo; prints its number
#                                                  (exit 5: created, but not put on the board)
#   github.sh <repo> read <n> [--body]             title, state, labels, body, comments; with
#                                                  --body, only the body, exactly as stored
#   github.sh <repo> edit <n> <body-file> <base-file>
#                                                  replace the issue's body; never its title
#   github.sh <repo> state <n> <state>             todo | in-progress | blocked | done | cancelled
#   github.sh <repo> comment <n> <actor> <text>    one comment, dated to the minute, actor first
#   github.sh <repo> list [state]                  one line per issue: number, state, title
#   github.sh <repo> access                        the user's permission on the repository:
#                                                  ADMIN, MAINTAIN, WRITE, TRIAGE or READ
#   github.sh <repo> search <text>                 one line per issue holding the text in its
#                                                  title, body or comments: number, open or
#                                                  closed, title (GitHub's index, not exact; a
#                                                  colon or a quote in the text counts as a space)
#   github.sh --self-test                          read, edit, create, access and search against a
#                                                  stub gh, offline
#
# <repo> is a local checkout; the GitHub repository is read from its origin remote. Everything
# goes through the gh CLI, which must be logged in with the `project` scope
# (`gh auth refresh -s project`); scripts/probe-trackers.sh says whether it is.
#
# edit takes the body as it was read when the change was drafted (read --body) and refuses when
# the issue no longer matches it, so a change made in the tracker meanwhile is not lost.
#
#   exit 0  ok
#   exit 1  usage, gh missing or not logged in, no origin remote, unknown issue (a pull request
#           is not one), a body file that cannot be read or is empty, or gh failed
#   exit 2  invalid state
#   exit 3  the repo has no linked board (run: github.sh <repo> board init)
#   exit 4  the issue changed since the base was read
#   exit 5  create made the issue, and printed its number, but could not put it on the board
set -uo pipefail
die() { echo "github: $*" >&2; exit 1; }
if [ "${1:-}" != --self-test ]; then
  REPO=${1:?usage: github.sh <repo> board|create|edit|read|state|comment|list|access ... | --self-test}
  [ $# -ge 2 ] || die "usage: github.sh <repo> board|create|edit|read|state|comment|list|access ... | --self-test"
  [ -d "$REPO" ] || die "no such directory: $REPO"
  command -v gh >/dev/null 2>&1 || die "gh is not on PATH"
  gh auth status >/dev/null 2>&1 || die "gh is not logged in; the user runs: gh auth login"
  REMOTE=$(git -C "$REPO" remote get-url origin 2>/dev/null) || die "$REPO has no origin remote"

  exec python3 - "$REMOTE" "${@:2}" <<'PY'
import datetime, json, os, re, subprocess, sys

STATES = ["todo", "in-progress", "blocked", "done", "cancelled"]
COLUMN = {"todo": "todo", "in-progress": "inprogress", "done": "done", "cancelled": "done"}
BLOCKED = "blocked"

def die(msg, code=1):
    print("github: " + msg, file=sys.stderr); sys.exit(code)

m = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$", sys.argv[1])
if not m:
    die("origin is not a GitHub remote: " + sys.argv[1])
OWNER, NAME = m.group(1), m.group(2)
NWO = "%s/%s" % (OWNER, NAME)
args = sys.argv[2:]
cmd = args[0]

def gh(*argv, ok=(0,)):
    r = subprocess.run(["gh", *argv], capture_output=True, text=True)
    if r.returncode not in ok:
        die("gh %s: %s" % (" ".join(argv[:3]), (r.stderr or r.stdout).strip()[:300]))
    return r.stdout

def ghj(*argv):
    out = gh(*argv)
    try:
        return json.loads(out)
    except ValueError:
        die("gh %s returned no JSON" % " ".join(argv[:3]))

# --- the board ---------------------------------------------------------------------------

def linked_boards():
    q = ("query($owner:String!,$name:String!){repository(owner:$owner,name:$name){"
         "projectsV2(first:20){nodes{id number title closed url "
         "owner{... on User{login} ... on Organization{login}}}}}}")
    data = ghj("api", "graphql", "-f", "query=" + q, "-F", "owner=" + OWNER, "-F", "name=" + NAME)
    nodes = data.get("data", {}).get("repository", {}).get("projectsV2", {}).get("nodes", []) or []
    return [n for n in nodes if not n.get("closed")]

def board():
    boards = linked_boards()
    if not boards:
        die("%s has no linked board; run: github.sh <repo> board init" % NWO, 3)
    named = [b for b in boards if b.get("title") == NAME]
    b = named[0] if len(boards) > 1 and named else boards[0]
    b["ownerLogin"] = (b.get("owner") or {}).get("login") or OWNER
    return b

def board_init(title):
    boards = linked_boards()
    if boards:
        b = boards[0]; print("board exists: #%s %s %s" % (b["number"], b["title"], b["url"])); return
    made = ghj("project", "create", "--owner", OWNER, "--title", title, "--format", "json")
    gh("project", "link", str(made["number"]), "--owner", OWNER, "--repo", NWO)
    print("board created: #%s %s %s" % (made["number"], title, made.get("url", "")))

def status_field(b):
    fields = ghj("project", "field-list", str(b["number"]), "--owner", b["ownerLogin"], "--format", "json")
    for f in fields.get("fields", []):
        if f.get("name", "").lower() == "status" and f.get("options") is not None:
            opts = {re.sub(r"\W", "", o["name"]).lower(): o["id"] for o in f["options"]}
            return f["id"], opts
    die("board #%s has no Status field" % b["number"])

def item_id(b, number, url):
    items = ghj("project", "item-list", str(b["number"]), "--owner", b["ownerLogin"], "--format", "json", "--limit", "1000")
    for it in items.get("items", []):
        c = it.get("content") or {}
        if c.get("type") == "Issue" and c.get("number") == number and c.get("repository") == NWO:
            return it["id"], it.get("status")
    added = ghj("project", "item-add", str(b["number"]), "--owner", b["ownerLogin"], "--url", url, "--format", "json")
    return added["id"], None

def set_column(b, number, url, flow):
    field, opts = status_field(b)
    key = COLUMN[flow]
    if key not in opts:
        die("board #%s has no Status column for %s (its columns: %s)" % (b["number"], flow, ", ".join(opts)))
    iid, _ = item_id(b, number, url)
    gh("project", "item-edit", "--project-id", b["id"], "--id", iid, "--field-id", field,
       "--single-select-option-id", opts[key])

def board_statuses(b):
    items = ghj("project", "item-list", str(b["number"]), "--owner", b["ownerLogin"], "--format", "json", "--limit", "1000")
    out = {}
    for it in items.get("items", []):
        c = it.get("content") or {}
        if c.get("type") == "Issue" and c.get("repository") == NWO:
            out[c.get("number")] = it.get("status") or ""
    return out

# --- issues ------------------------------------------------------------------------------

def issue(number):
    # gh issue view --json has no stateReason either, so one GraphQL query per read.
    q = ("query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){"
         "issue(number:$number){number title body state stateReason url createdAt "
         "labels(first:50){nodes{name}} comments(first:100){nodes{body createdAt author{login}}}}}}")
    data = ghj("api", "graphql", "-f", "query=" + q, "-F", "owner=" + OWNER, "-F", "name=" + NAME, "-F", "number=%d" % number)
    iss = (data.get("data", {}).get("repository") or {}).get("issue")
    if not iss:
        die("no issue #%d in %s" % (number, NWO))
    iss["labels"] = iss.get("labels", {}).get("nodes", [])
    iss["comments"] = iss.get("comments", {}).get("nodes", [])
    return iss

def all_issues():
    # gh issue list --json has no stateReason, and cancelled needs it, so the list is one
    # GraphQL query per 100 issues instead.
    q = ("query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){"
         "issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){"
         "pageInfo{hasNextPage endCursor} nodes{number title state stateReason labels(first:50){nodes{name}}}}}}")
    out, after = [], None
    while True:
        argv = ["api", "graphql", "-f", "query=" + q, "-F", "owner=" + OWNER, "-F", "name=" + NAME]
        if after: argv += ["-F", "after=" + after]
        page = ghj(*argv).get("data", {}).get("repository", {}).get("issues", {})
        for n in page.get("nodes", []):
            out.append({"number": n["number"], "title": n["title"], "state": n["state"],
                        "stateReason": n.get("stateReason"), "labels": n.get("labels", {}).get("nodes", [])})
        if not page.get("pageInfo", {}).get("hasNextPage"): return out
        after = page["pageInfo"]["endCursor"]

def flow_state(iss, status):
    if iss.get("state") == "CLOSED":
        return "cancelled" if iss.get("stateReason") == "NOT_PLANNED" else "done"
    if any(l.get("name", "").lower() == BLOCKED for l in iss.get("labels") or []):
        return "blocked"
    return "in-progress" if re.sub(r"\W", "", status or "").lower() == "inprogress" else "todo"

def ensure_label():
    names = {l["name"].lower() for l in ghj("label", "list", "-R", NWO, "--json", "name", "--limit", "200")}
    if BLOCKED not in names:
        gh("label", "create", BLOCKED, "-R", NWO, "--color", "B60205", "--description", "Waiting on something outside the run")

def set_label(number, present):
    if present:
        ensure_label(); gh("issue", "edit", str(number), "-R", NWO, "--add-label", BLOCKED)
    else:
        gh("issue", "edit", str(number), "-R", NWO, "--remove-label", BLOCKED)

def usage(text):
    die("usage: github.sh <repo> " + text)

def number_arg(s):
    if not re.fullmatch(r"#?\d+", s):
        die("not an issue number: " + s)
    return int(s.lstrip("#"))

def text_of(path, what):  # a file's text, line endings kept; exit 1 when it cannot be read
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()
    except (OSError, UnicodeDecodeError) as e:
        die("cannot read %s %s: %s" % (what, path, getattr(e, "strerror", None) or e))

def body_file(path):  # a body file's text; exit 1 when it cannot be read or holds nothing
    text = text_of(path, "body file")
    if not text.strip():
        die("the body file %s is empty" % path)
    return text

def normal(text):  # a body as edit compares it: line endings, trailing spaces and blank edges aside
    lines = [l.rstrip() for l in text.replace("\r\n", "\n").split("\n")]
    while lines and not lines[0]: lines.pop(0)
    while lines and not lines[-1]: lines.pop()
    return "\n".join(lines)

if cmd == "board":
    if len(args) == 1:
        b = board(); print("#%s\t%s\t%s" % (b["number"], b["title"], b["url"]))
    elif args[1] == "init" and len(args) in (2, 3):
        board_init(args[2] if len(args) == 3 else NAME)
    else:
        usage("board [init [title]]")

elif cmd == "create":
    if len(args) != 3: usage("create <title> <body-file>")
    body_file(args[2])
    b = board()
    if COLUMN["todo"] not in status_field(b)[1]:
        die("board #%s has no Status column for todo; nothing was created" % b["number"])
    url = gh("issue", "create", "-R", NWO, "--title", args[1], "--body-file", args[2]).strip().splitlines()[-1]
    number = int(url.rstrip("/").rsplit("/", 1)[-1])
    try:
        set_column(b, number, url, "todo")
    except SystemExit:
        print(number)
        print("github: #%d was created, but is not on the board" % number, file=sys.stderr)
        sys.exit(5)
    print(number)

elif cmd == "edit":
    # Four arguments whose second is not a file are the old form, which also took a title.
    if len(args) != 4 or not os.path.isfile(args[2]):
        usage("edit <n> <body-file> <base-file>" + ("; no such body file: " + args[2] if len(args) == 4 else ""))
    n = number_arg(args[1])
    body_file(args[2]); base = text_of(args[3], "base file")
    board(); iss = issue(n)
    if normal(iss.get("body") or "") != normal(base):
        die("#%d changed since %s was read; read it again" % (n, args[3]), 4)
    gh("issue", "edit", str(n), "-R", NWO, "--body-file", args[2])
    print("#%d: edited" % n)

elif cmd == "read":
    body_only = args[2:] == ["--body"]
    if len(args) != 2 and not body_only: usage("read <n> [--body]")
    n = number_arg(args[1]); iss = issue(n); b = board()
    if body_only:
        sys.stdout.write((iss.get("body") or "") + "\n"); sys.exit(0)
    statuses = board_statuses(b)
    print("id: #%d" % n)
    print("title: %s" % iss.get("title", ""))
    print("state: %s" % flow_state(iss, statuses.get(n)))
    print("labels: %s" % ", ".join(l["name"] for l in iss.get("labels") or []))
    print("created: %s" % str(iss.get("createdAt", ""))[:10])
    print("url: %s" % iss.get("url", ""))
    print()
    print((iss.get("body") or "").strip())
    comments = iss.get("comments") or []
    if comments:
        print("\n## Log")
        for c in sorted(comments, key=lambda c: c.get("createdAt", "")):
            text = " ".join((c.get("body") or "").split())
            if not re.match(r"\d{4}-\d{2}-\d{2} ", text):
                text = "%s %s: %s" % (str(c.get("createdAt", ""))[:10], (c.get("author") or {}).get("login", "?"), text)
            print("- " + text)

elif cmd == "state":
    if len(args) != 3: usage("state <n> <state>")
    n = number_arg(args[1]); new = args[2]
    if new not in STATES:
        die("invalid state %s (one of: %s)" % (new, ", ".join(STATES)), 2)
    b = board(); iss = issue(n)
    blocked_now = any(l.get("name", "").lower() == BLOCKED for l in iss.get("labels") or [])
    closed = iss.get("state") == "CLOSED"
    if new == "blocked":
        if closed: gh("issue", "reopen", str(n), "-R", NWO)
        if not blocked_now: set_label(n, True)
    else:
        if blocked_now: set_label(n, False)
        if new in ("todo", "in-progress") and closed:
            gh("issue", "reopen", str(n), "-R", NWO)
        elif new == "done" and not closed:
            gh("issue", "close", str(n), "-R", NWO, "--reason", "completed")
        elif new == "cancelled" and not (closed and iss.get("stateReason") == "NOT_PLANNED"):
            if closed: gh("issue", "reopen", str(n), "-R", NWO)
            gh("issue", "close", str(n), "-R", NWO, "--reason", "not planned")
        set_column(b, n, iss["url"], new)
    print("#%d: %s" % (n, new))

elif cmd == "comment":
    if len(args) < 4: usage("comment <n> <actor> <text>")
    n = number_arg(args[1]); actor = args[2]; text = " ".join(args[3:])
    line = "%s %s: %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), actor, text)
    gh("issue", "comment", str(n), "-R", NWO, "--body", line)
    print("#%d: %s" % (n, line))

elif cmd == "list":
    if len(args) not in (1, 2): usage("list [state]")
    want = args[1] if len(args) == 2 else None
    if want and want not in STATES:
        die("invalid state %s (one of: %s)" % (want, ", ".join(STATES)), 2)
    statuses = board_statuses(board())
    for iss in sorted(all_issues(), key=lambda i: i["number"]):
        st = flow_state(iss, statuses.get(iss["number"]))
        if want is None or st == want:
            print("#%d\t%s\t%s" % (iss["number"], st, iss.get("title", "")))

elif cmd == "access":
    if len(args) != 1: usage("access")
    q = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){viewerPermission}}"
    data = ghj("api", "graphql", "-f", "query=" + q, "-F", "owner=" + OWNER, "-F", "name=" + NAME)
    perm = ((data.get("data") or {}).get("repository") or {}).get("viewerPermission")
    if not perm:
        die("no permission on %s could be read" % NWO)
    print(perm)

elif cmd == "search":
    if len(args) != 2: usage("search <text>")
    hits = ghj("search", "issues", '"%s"' % re.sub(r'[":]', " ", args[1]).strip(), "--repo", NWO,
               "--json", "number,title,state", "--limit", "100")
    for h in sorted(hits, key=lambda h: h["number"]):
        print("#%d\t%s\t%s" % (h["number"], str(h.get("state", "")).lower(), h.get("title", "")))

else:
    usage("board|create|edit|read|state|comment|list|access|search ...")
PY
fi

# --- self-test ----------------------------------------------------------------------------
# read and edit run for real, against a stub gh first on PATH: it answers the queries from
# canned files and records every issue edit, so nothing reaches GitHub.
SELF="$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")"
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
S="$tmp/stub"; mkdir -p "$tmp/bin" "$S" || exit 1
cat > "$tmp/bin/gh" <<'GH'
#!/usr/bin/env bash
d=$GITHUB_SH_STUB
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=${a#number=} ;; esac; done
    case $q in
      *projectsV2*) cat "$d/boards.json" ;;
      *viewerPermission*) cat "$d/access.json" ;;
      *"issue(number:"*) if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
                         else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "project item-list") cat "$d/items.json" ;;
  "project field-list") cat "$d/fields.json" ;;
  "project item-add") if [ -f "$d/no-item-add" ]; then echo "stub gh: item-add refused" >&2; exit 1; fi
                      echo '{"id": "PVTI_new"}' ;;
  "project item-edit") exit 0 ;;
  "issue create") printf 'create\n' >> "$d/creates.log"; echo "https://github.com/o/r/issues/60" ;;
  "search issues") printf '%s\n' "$*" >> "$d/searches.log"; cat "$d/search.json" ;;
  "issue edit")
    f="" prev=""
    for a in "$@"; do [ "$prev" = --body-file ] && f=$a; prev=$a; done
    printf 'call:%s\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    cp -- "$f" "$d/edited-body" ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
GH
chmod +x "$tmp/bin/gh"
git init -q "$tmp/repo" && git -C "$tmp/repo" remote add origin https://github.com/o/r.git || exit 1
BOARD='{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}'
printf '%s\n' "$BOARD" > "$S/boards.json"
printf '%s\n' '{"items": [{"id": "PVTI_7", "status": "Todo", "content": {"type": "Issue", "number": 7, "repository": "o/r"}}]}' > "$S/items.json"
printf '%s\n' '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Todo"}, {"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}]}' > "$S/fields.json"

stored() {  # stored <n> <file>: issue <n> on the stub holds <file>'s bytes as its body
  python3 - "$1" "$2" > "$S/issue-$1.json" <<'PY'
import json, sys
body = open(sys.argv[2], encoding="utf-8", newline="").read()
print(json.dumps({"data": {"repository": {"issue": {
    "number": int(sys.argv[1]), "title": "Check a ticket's shape", "body": body, "state": "OPEN",
    "stateReason": None, "url": "https://github.com/o/r/issues/" + sys.argv[1],
    "createdAt": "2026-09-23T00:00:00Z", "labels": {"nodes": []}, "comments": {"nodes": []}}}}}))
PY
}
gh_sh() { PATH="$tmp/bin:$PATH" GITHUB_SH_STUB="$S" "$SELF" "$tmp/repo" "$@"; }
edits() { grep -c '^call:' "$S/edits.log" 2>/dev/null || true; }
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }

printf '## Problem / feature\nA body with `code`, "quotes" and a trailing space. \n\n## Direction\nNone.' > "$tmp/lf.md"
printf '## Problem / feature\r\nStored with CRLF line endings.\r\n\r\n## Direction\r\nNone.\r\n' > "$tmp/crlf.md"
printf '## Problem / feature\nThe new body.\n\n## Direction\nNone: any approach that meets the criteria.\n' > "$tmp/new.md"

echo "positive controls"
stored 7 "$tmp/lf.md"; gh_sh read 7 --body > "$tmp/out" 2>&1; rc=$?
{ cat "$tmp/lf.md"; printf '\n'; } > "$tmp/want"
[ $rc -eq 0 ] && cmp -s "$tmp/out" "$tmp/want" && ok "read --body prints the stored body byte for byte, then one newline" \
  || fail "read --body prints the stored body byte for byte, then one newline (exit $rc)" "$(cat -A "$tmp/out")"
stored 7 "$tmp/crlf.md"; gh_sh read 7 --body > "$tmp/out" 2>&1; rc=$?
{ cat "$tmp/crlf.md"; printf '\n'; } > "$tmp/want"
[ $rc -eq 0 ] && cmp -s "$tmp/out" "$tmp/want" && ok "read --body keeps a CRLF body's line endings" \
  || fail "read --body keeps a CRLF body's line endings (exit $rc)" "$(cat -A "$tmp/out")"
stored 7 "$tmp/lf.md"; out=$(gh_sh read 7 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(printf '%s\n' "$out" | head -1)" = "id: #7" ] && grep -qxF "title: Check a ticket's shape" <<<"$out" \
  && ok "read without --body still prints the header before the body" || fail "read without --body still prints the header before the body (exit $rc)" "$out"
gh_sh read 7 --body > "$tmp/base.md" 2>/dev/null; : > "$S/edits.log"
out=$(gh_sh edit 7 "$tmp/new.md" "$tmp/base.md" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ "$out" = "#7: edited" ] && [ "$(edits)" -eq 1 ] && grep -qF '[--body-file]' "$S/edits.log" \
   && ! grep -qF '[--title]' "$S/edits.log" && cmp -s "$S/edited-body" "$tmp/new.md"; then
  ok "edit against the body as read calls gh issue edit once, with the body file and no title"
else
  fail "edit against the body as read calls gh issue edit once, with the body file and no title (exit $rc, $(edits) edit(s))" "$out$(printf '\n'; cat "$S/edits.log")"
fi
stored 7 "$tmp/crlf.md"; tr -d '\r' < "$tmp/crlf.md" > "$tmp/base-lf.md"; : > "$S/edits.log"
out=$(gh_sh edit 7 "$tmp/new.md" "$tmp/base-lf.md" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = "#7: edited" ] && [ "$(edits)" -eq 1 ] && ok "a body stored with CRLF matches the same base with LF" \
  || fail "a body stored with CRLF matches the same base with LF (exit $rc, $(edits) edit(s))" "$out"

echo "negative controls: nothing is written"
refused() {  # refused <label> <exit> <text the message holds> <edit arguments...>
  local label=$1 want=$2 why=$3; shift 3
  : > "$S/edits.log"
  out=$(gh_sh edit "$@" 2>&1); rc=$?
  if [ $rc -eq "$want" ] && [ "$(edits)" -eq 0 ] && grep -qF -- "$why" <<<"$out"; then ok "$label"
  else fail "$label: wanted exit $want with \"$why\" and no edit, got exit $rc and $(edits) edit(s)" "$out"; fi
}
stored 7 "$tmp/lf.md"
printf '## Problem / feature\nChanged in the tracker since.\n' > "$tmp/stale.md"
printf ' \n\n' > "$tmp/empty.md"
refused "a base the issue no longer matches exits 4" 4 "#7 changed since" 7 "$tmp/new.md" "$tmp/stale.md"
refused "an empty body file exits 1" 1 "is empty" 7 "$tmp/empty.md" "$tmp/base.md"
refused "a missing base file exits 1" 1 "cannot read base file" 7 "$tmp/new.md" "$tmp/nowhere.md"
refused "a pull request number exits 1" 1 "no issue #34" 34 "$tmp/new.md" "$tmp/base.md"
refused "the old form, with a title, is a usage error" 1 "usage:" 7 "Check a ticket's shape" "$tmp/new.md"
printf '%s\n' '{"data": {"repository": {"projectsV2": {"nodes": []}}}}' > "$S/boards.json"
refused "no linked board exits 3" 3 "no linked board" 7 "$tmp/new.md" "$tmp/base.md"
gh_sh read 7 --body > /dev/null 2>&1; rc=$?
[ $rc -eq 3 ] && ok "read --body without a linked board exits 3" || fail "read --body without a linked board exits 3 (exit $rc)"
printf '%s\n' "$BOARD" > "$S/boards.json"

echo "access"
printf '%s\n' '{"data": {"repository": {"viewerPermission": "ADMIN"}}}' > "$S/access.json"
out=$(gh_sh access 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = ADMIN ] && ok "access prints the user's permission" || fail "access prints the user's permission (exit $rc)" "$out"
printf '%s\n' '{"data": {"repository": {"viewerPermission": "READ"}}}' > "$S/access.json"
out=$(gh_sh access 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = READ ] && ok "a repository the user only reads says READ" || fail "a repository the user only reads says READ (exit $rc)" "$out"
printf '%s\n' '{"data": {"repository": null}}' > "$S/access.json"
out=$(gh_sh access 2>&1); rc=$?
[ $rc -eq 1 ] && grep -qF "no permission on o/r" <<<"$out" && ok "a repository gh cannot see exits 1" \
  || fail "a repository gh cannot see exits 1 (exit $rc)" "$out"

echo "create and search"
creates() { grep -c . "$S/creates.log" 2>/dev/null || true; }
: > "$S/creates.log"
out=$(gh_sh create "A title" "$tmp/new.md" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = 60 ] && [ "$(creates)" -eq 1 ] && ok "create files the issue and prints its number" \
  || fail "create files the issue and prints its number (exit $rc)" "$out"
: > "$S/creates.log"; : > "$S/no-item-add"
out=$(gh_sh create "A title" "$tmp/new.md" 2>"$tmp/err"); rc=$?
[ $rc -eq 5 ] && [ "$out" = 60 ] && [ "$(creates)" -eq 1 ] && grep -qF "#60 was created, but is not on the board" "$tmp/err" \
  && ok "an issue that misses the board still prints its number, and exits 5" || fail "an issue that misses the board still prints its number, and exits 5 (exit $rc)" "$out$(cat "$tmp/err")"
mv -- "$S/no-item-add" "$tmp/no-item-add.was"; : > "$S/creates.log"; cp "$S/fields.json" "$tmp/fields.json"
printf '%s\n' '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Backlog"}, {"id": "o3", "name": "Done"}]}]}' > "$S/fields.json"
out=$(gh_sh create "A title" "$tmp/new.md" 2>&1); rc=$?
[ $rc -eq 1 ] && [ "$(creates)" -eq 0 ] && grep -qF "nothing was created" <<<"$out" \
  && ok "a board with no Todo column is refused before anything is created" || fail "a board with no Todo column is refused before anything is created (exit $rc)" "$out"
cp "$tmp/fields.json" "$S/fields.json"
printf '%s\n' '[{"number": 9, "title": "Later", "state": "CLOSED"}, {"number": 4, "title": "Earlier", "state": "OPEN"}]' > "$S/search.json"
out=$(gh_sh search 'tf-0a1b2c3d' 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = "$(printf '#4\topen\tEarlier\n#9\tclosed\tLater')" ] && grep -qF -- '"tf-0a1b2c3d" --repo o/r' "$S/searches.log" \
  && ok "search asks for the phrase in this repository, and prints number, state and title" || fail "search asks for the phrase in this repository, and prints number, state and title (exit $rc)" "$out"
gh_sh search 'Tool fault in scripts/x.sh:' >/dev/null 2>&1
grep -qF -- '"Tool fault in scripts/x.sh" --repo o/r' <<<"$(tail -1 "$S/searches.log")" \
  && ok "a colon in the text is searched as a space, which GitHub's query accepts" || fail "a colon in the text is searched as a space, which GitHub's query accepts" "$(tail -1 "$S/searches.log")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
