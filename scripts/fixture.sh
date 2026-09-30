#!/usr/bin/env bash
# Run the flow end to end against a small app whose tickets have a known outcome, and score a
# finished run from its own records. Why, and what it catches that the gate cannot:
# wiki/concepts/fixture-runs.md.
#
#   fixture.sh new <name or dest> <ticket>
#   fixture.sh score <dispatch> <repo>
#   fixture.sh hidden <ticket> <app-dir>
#   fixture.sh --self-test
#
# The app is fixtures/app. A ticket is fixtures/tickets/<ticket>/: ticket.md (a `# ` title line,
# then the body in the ticket shape), hidden/ (acceptance tests written before any run) and
# reference.patch (a solution, applied to the app, that passes them). Only the app ever leaves
# this repo; the hidden tests run from here, against a copy.
#
# new     makes <dest> a fresh git repo holding the committed app, one commit on main, outside
#         every other repo, so a run never touches this repo's branches, worktrees or run records.
#         A bare name goes under ~/Code/fixtures, or $POSTMASTER_FIXTURES when that is set; a
#         path is used as given. Claude Code asks whether to trust each copy the first time a
#         session starts in it, though ~/Code/fixtures is trusted: its trust covers a plain
#         folder inside a trusted one, never a git repository. The user answers it once per
#         copy. It has no remote. It makes the repo's own ticket store (scripts/local.sh),
#         files the ticket there and prints its number to dispatch against <dest>; a run reads
#         it through the local tracker whatever the config names (scripts/tracker-kind.sh).
# score   scores a finished run from its records, never its report: the ticket its waybill
#         carries verbatim, whose hidden tests run against main and, beside those counts, against
#         each lane's harvested wb/<TICKET>-<lane> branch (scripts/fixture-lanes.ts); the app's
#         gate as
#         scripts/discover-project.sh finds it, on main; the stages scripts/stage.sh --list names,
#         up to done, each entered in order by a logged change; each leg's done and exited
#         markers, for every leg the run recorded; each leg's hand-off, through
#         scripts/handoff-check.sh; run.json; and card.md. One line per check on stdout, and what
#         a failed check printed on stderr.
# hidden  runs a ticket's hidden tests against an app directory.
#
# The stages and hand-off rules are the ones in the checkout score runs from, so a run is scored
# from the postmaster commit it was dispatched from; score says so when the two differ. The
# self-test needs no network once npm's cache holds the app's packages.
#
#   exit 0  new: made and filed; score, hidden: every check passed
#   exit 1  usage, a tool not on PATH, a refusal from new, or input that is not what it says
#   exit 2  score, hidden: a check failed
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
APP=$TOOL/fixtures/app
TICKETS=$TOOL/fixtures/tickets
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
LOCAL_SH=$HERE/local.sh
usage() { echo "usage: fixture.sh new <name or dest> <ticket> | score <dispatch> <repo> | hidden <ticket> <app-dir> | --self-test" >&2; exit 1; }
need() { local t; for t in "$@"; do command -v "$t" >/dev/null 2>&1 || { echo "fixture: $t is not on PATH" >&2; exit 1; }; done; }

tickets() { local d; for d in "$TICKETS"/*/; do [ -f "$d/ticket.md" ] && basename "$d"; done; }
ticket_title() { sed -n '1s/^# //p' "$TICKETS/$1/ticket.md"; }
ticket_body() { tail -n +2 "$TICKETS/$1/ticket.md" | sed '/./,$!d'; }   # after the title line
is_ticket() {
  [ -n "$1" ] && [ -f "$TICKETS/$1/ticket.md" ] && return 0
  echo "fixture: no ticket '$1'; the tickets are: $(tickets | paste -sd' ' -)" >&2; return 1
}

make_repo() {  # make_repo <dest>: a new repo holding the app's files as git sees them, one commit
  local dest=$1 key value
  mkdir "$dest" || return 1
  python3 - "$APP" "$dest" <<'PY' || { echo "fixture: could not copy the app to $dest" >&2; return 1; }
import os, shutil, subprocess, sys
src, dst = sys.argv[1], sys.argv[2]
listed = subprocess.run(["git", "-C", src, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                        capture_output=True, check=True).stdout.decode().split("\0")
for rel in sorted({n for n in listed if n}):
    s, d = os.path.join(src, rel), os.path.join(dst, rel)
    if not os.path.lexists(s):
        continue                        # deleted from the working tree
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if os.path.islink(s):
        os.symlink(os.readlink(s), d)
    else:
        shutil.copy2(s, d)
PY
  git -C "$dest" init -q -b main || return 1
  # A run commits in this repo, so it commits as this checkout does.
  for key in user.name user.email; do
    value=$(git -C "$TOOL" config "$key") && git -C "$dest" config "$key" "$value"
  done
  git -C "$dest" add -A && git -C "$dest" commit -q -m "Initial commit" \
    || { echo "fixture: could not commit the app in $dest; git needs user.name and user.email" >&2; return 1; }
}

make_and_file() {  # make_and_file <name or dest> <ticket>
  local dest=$1 ticket=$2 probe body number rc
  is_ticket "$ticket" || return 1
  case $dest in */*) ;; *) dest=${POSTMASTER_FIXTURES:-$HOME/Code/fixtures}/$dest ;; esac
  dest=$(python3 -c 'import os, sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$dest")
  [ -e "$dest" ] && { echo "fixture: $dest already exists; a run starts from a fresh repo" >&2; return 1; }
  probe=$(dirname "$dest"); while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  if git -C "$probe" rev-parse --git-dir >/dev/null 2>&1; then
    echo "fixture: $dest would be inside the git repository at $(git -C "$probe" rev-parse --show-toplevel 2>/dev/null || echo "$probe"); a run's repo stands alone" >&2
    return 1
  fi
  unmake() { [ -d "$dest" ] && rm -r -- "$dest" </dev/null; }   # until the ticket is filed, nothing refers to dest
  mkdir -p "$(dirname "$dest")" && make_repo "$dest" || { unmake; return 1; }
  "$LOCAL_SH" "$dest" store init >/dev/null || { unmake; echo "fixture: could not make the ticket store in $dest" >&2; return 1; }
  body=$(mktemp) || { unmake; return 1; }
  ticket_body "$ticket" > "$body"
  number=$("$LOCAL_SH" "$dest" create "$(ticket_title "$ticket")" "$body" | tail -1); rc=$?
  rm -f -- "$body"
  [ $rc -eq 0 ] && [[ $number =~ ^[0-9]+$ ]] || { unmake; echo "fixture: filing the ticket in $dest's own store failed (exit $rc)" >&2; return 1; }
  echo "fixture: made $dest from fixtures/app at $(git -C "$TOOL" rev-parse --short HEAD); main is at $(git -C "$dest" rev-parse --short HEAD)"
  echo "fixture: filed ticket $ticket in $dest's own ticket store as #$number: $(ticket_title "$ticket")"
  echo "fixture: dispatch ticket #$number against $dest, then: scripts/fixture.sh score <its dispatch directory> $dest"
}

new_run() {  # new_run <name or dest> <ticket>
  [ -z "$(git -C "$TOOL" status --porcelain -- fixtures)" ] \
    || { echo "fixture: fixtures/ has uncommitted changes; a run starts from a committed fixture" >&2; return 1; }
  make_and_file "$@"
}

py() {  # py score <dispatch> <repo> | py hidden <ticket> <app-dir>
  python3 - "$TOOL" "$@" <<'PY'
import json, os, pathlib, re, shutil, subprocess, sys, tempfile

TOOL = pathlib.Path(sys.argv[1])
SCRIPTS, TICKETS = TOOL / "scripts", TOOL / "fixtures" / "tickets"
TIMEOUT = 1200                            # seconds, for an install, a gate or a hidden suite
CHECKS = ["hidden-tests", "gate", "stages", "markers", "handoffs", "run.json", "ship-card"]
LEG_FILE = re.compile(r"\.leg-(\d+)-(?:done|exited)|leg-(\d+)-(?:prompt|takeover)\.txt|handoff-(\d+)\.md")

def sh(cmd, cwd=None, env=None):
    try:
        r = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, capture_output=True, text=True,
                           timeout=TIMEOUT, stdin=subprocess.DEVNULL)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return None, "timed out after %ds" % TIMEOUT

def exited(code):
    return "timed out after %ds" % TIMEOUT if code is None else "exit %d" % code

def tail(text, n=20):
    return "\n".join(text.rstrip().splitlines()[-n:])

def squash(text):
    return " ".join(text.split())

def section(text, heading):  # the text under a `## <heading>`, up to the next `## `
    m = re.search(r"^##[ \t]+%s[ \t]*\n(.*?)(?=^##[ \t]|\Z)" % re.escape(heading), text, re.M | re.S | re.I)
    return m.group(1) if m else ""

def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None

def hidden(ticket, app):
    """A ticket's hidden tests against an app directory: (passed, detail, output)."""
    # A test drives the command many times; on a loaded machine that outlasts bun's 5s default.
    code, out = sh(["bun", "test", "--timeout", "120000", "./"], cwd=TICKETS / ticket / "hidden",
                   env={**os.environ, "FIXTURE_APP": str(app)})
    counts = {k: int(n) for n, k in re.findall(r"^\s*(\d+) (pass|fail)\s*$", out, re.M)}
    passed, failed = counts.get("pass", 0), counts.get("fail", 0)
    detail = "%d pass, %d fail" % (passed, failed) if counts else "bun test %s" % exited(code)
    return code == 0 and passed > 0 and failed == 0, detail, out

def waybill_tickets(dispatch):
    """The fixture tickets whose acceptance criteria the waybill carries verbatim."""
    brief = dispatch / "brief.md"
    text = squash(brief.read_text(errors="replace")) if brief.is_file() else ""
    found = []
    for t in sorted(p for p in TICKETS.iterdir() if (p / "ticket.md").is_file()):
        criteria = squash(section((t / "ticket.md").read_text(), "Acceptance criteria"))
        if criteria and criteria in text:
            found.append(t.name)
    return found

LANE_LINE = re.compile(r"^(.*): (\d+ pass, \d+ fail|missing|failed to build)$")

def lane_scores(dispatch, repo, ticket):
    """Each lane's hidden status from scripts/fixture-lanes.ts; '' when there are no lanes."""
    code, out = sh(["bun", "--no-env-file", str(SCRIPTS / "fixture-lanes.ts"),
                    str(dispatch), str(repo), ticket])
    if code != 0:
        return "lanes not scored"
    return "; ".join(l.strip() for l in out.splitlines() if LANE_LINE.match(l.strip()))

def check_hidden(dispatch, repo, app):
    found = waybill_tickets(dispatch)
    if len(found) != 1:
        return False, ("brief.md carries no fixture ticket's criteria verbatim" if not found
                       else "brief.md carries more than one fixture ticket: %s" % ", ".join(found)), ""
    ok, detail, out = hidden(found[0], app)
    text = "%s, from the waybill: %s on main" % (found[0], detail)
    lanes = lane_scores(dispatch, repo, found[0])
    if lanes:
        text = "%s; %s" % (text, lanes)
    return ok, text, out

def check_gate(app):
    code, out = sh([SCRIPTS / "discover-project.sh", app])
    gate = next((l[len("gate="):] for l in out.splitlines() if l.startswith("gate=")), "")
    if not gate:
        return False, "scripts/discover-project.sh found no gate", out
    install = ["npm", "ci"] if (app / "package-lock.json").is_file() else ["npm", "install"]
    code, out = sh(install + ["--prefer-offline", "--no-audit", "--no-fund"], cwd=app)
    if code != 0:
        return False, "%s on main: %s" % (" ".join(install), exited(code)), out
    code, out = sh(["bash", "-c", gate], cwd=app)
    return code == 0, "%s on main: %s" % (gate, exited(code)), out

def read_actions(dispatch):
    path = dispatch / "actions.jsonl"
    if not path.is_file():
        return None, "no actions.jsonl"
    events = []
    for n, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        if line.strip():
            try:
                events.append(json.loads(line))
            except ValueError:
                return None, "actions.jsonl line %d is not JSON" % n
    return events, ""

def check_stages(dispatch):
    code, out = sh([SCRIPTS / "stage.sh", "--list"])
    listed = out.split() if code == 0 else []
    if "done" not in listed:
        return False, "scripts/stage.sh --list names no done stage"
    expected = listed[:listed.index("done") + 1]
    events, why = read_actions(dispatch)
    if events is None:
        return False, why
    # A run is created in the first stage; every later one is entered by a logged change.
    entered = [e.get("target") for e in events if e.get("action") == "stage"]
    due = expected[1:]
    if entered == due:
        return True, "%s to done, %d stages, each entered in order" % (expected[0], len(expected))
    for i, (want, got) in enumerate(zip(due, entered)):
        if want != got:
            return False, "after %s entered %s, not %s" % (([expected[0]] + entered)[i], got, want)
    if len(entered) < len(due):
        return False, "stopped at %s; never entered %s" % (([expected[0]] + entered)[-1], due[len(entered)])
    return False, "entered %s after done" % entered[len(due)]

def legs_of(dispatch, manifest):
    """Every leg the run recorded anywhere; a leg with any trace must have left all of them."""
    seen = set()
    for p in dispatch.iterdir():
        m = LEG_FILE.fullmatch(p.name)
        if m:
            seen.add(int(next(g for g in m.groups() if g)))
    if isinstance(manifest, dict):
        if isinstance(manifest.get("leg"), int):
            seen.add(manifest["leg"])
        seen.update(int(k) for k in ((manifest.get("coachman") or {}).get("legs") or {}) if str(k).isdigit())
    return list(range(1, max(seen) + 1)) if seen else []

def check_markers(dispatch, legs):
    if not legs:
        return False, "no leg recorded"
    missing = [".leg-%d-%s" % (n, k) for n in legs for k in ("done", "exited")
               if not (dispatch / (".leg-%d-%s" % (n, k))).exists()]
    if missing:
        return False, "missing %s" % ", ".join(missing)
    return True, "%d legs, each with its done and exited marker" % len(legs)

def check_handoffs(dispatch, legs):
    if not legs:
        return False, "no leg recorded"
    bad = []
    for n in legs:
        f = dispatch / ("handoff-%d.md" % n)
        if not f.is_file():
            bad.append("%s missing" % f.name); continue
        code, out = sh([SCRIPTS / "handoff-check.sh", f])
        if code != 0:
            said = [l.replace("handoff-check: ", "") for l in out.splitlines() if l.strip()]
            more = " (and %d more)" % (len(said) - 1) if len(said) > 1 else ""
            bad.append("%s: %s%s" % (f.name, said[0] if said else exited(code), more))
    if bad:
        return False, "; ".join(bad)
    return True, "%d hand-offs pass scripts/handoff-check.sh" % len(legs)

def check_run_json(dispatch):
    path = dispatch / "run.json"
    if not path.is_file():
        return False, "no run.json"
    data = read_json(path)
    if not isinstance(data, dict) or not data:
        return False, "run.json is not a JSON object"
    return True, "written, and parses"

def check_card(dispatch):
    path = dispatch / "card.md"
    if not path.is_file():
        return False, "no card.md"
    lines = [l for l in path.read_text(errors="replace").splitlines() if l.strip()]
    if not lines:
        return False, "card.md is empty"
    return True, "card.md, %d lines" % len(lines)

def report(results):
    for name, ok, detail, out in results:
        print("%-4s %-12s %s" % ("ok" if ok else "FAIL", name, detail))
        if not ok and out.strip():
            print("--- %s\n%s" % (name, tail(out)), file=sys.stderr)
    sys.exit(0 if all(ok for _, ok, _, _ in results) else 2)

def score(dispatch, repo):
    code, main = sh(["git", "-C", repo, "rev-parse", "--verify", "-q", "refs/heads/main^{commit}"])
    main = main.strip()
    if code != 0 or not main:
        print("fixture: %s has no main branch" % repo, file=sys.stderr); sys.exit(1)
    manifest = read_json(dispatch / "manifest.json")
    base = manifest.get("base") if isinstance(manifest, dict) else None
    if isinstance(base, str) and base and sh(["git", "-C", repo, "merge-base", "--is-ancestor", base, main])[0] != 0:
        print("fixture: the manifest's base %s is not on main in %s; is this the run's repo?" % (base[:12], repo),
              file=sys.stderr); sys.exit(1)
    meta = read_json(dispatch / "run.json")
    ran = (meta.get("postmaster") or {}).get("commit") if isinstance(meta, dict) else None
    here = sh(["git", "-C", TOOL, "rev-parse", "HEAD"])[1].strip()
    if isinstance(ran, str) and ran and ran != here:
        print("fixture: note: the run was dispatched from postmaster %s, and this checkout is at %s; "
              "the stages and hand-off rules scored are this checkout's" % (ran[:12], here[:12]), file=sys.stderr)
    scratch = pathlib.Path(tempfile.mkdtemp(prefix="fixture-score-"))
    try:
        app = scratch / "app"
        app.mkdir()
        code, out = sh(["bash", "-o", "pipefail", "-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"',
                        "export", repo, main, app])
        if code != 0:
            print("fixture: could not export main from %s: %s" % (repo, tail(out, 3)), file=sys.stderr); sys.exit(1)
        legs = legs_of(dispatch, manifest)
        results = [("hidden-tests",) + check_hidden(dispatch, repo, app),
                   ("gate",) + check_gate(app),
                   ("stages",) + check_stages(dispatch) + ("",),
                   ("markers",) + check_markers(dispatch, legs) + ("",),
                   ("handoffs",) + check_handoffs(dispatch, legs) + ("",),
                   ("run.json",) + check_run_json(dispatch) + ("",),
                   ("ship-card",) + check_card(dispatch) + ("",)]
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    assert [r[0] for r in results] == CHECKS
    report(results)

mode, args = sys.argv[2], sys.argv[3:]
if mode == "score":
    score(pathlib.Path(args[0]).resolve(), pathlib.Path(args[1]).resolve())
elif mode == "hidden":
    ok, detail, out = hidden(args[0], pathlib.Path(args[1]).resolve())
    report([("hidden-tests", ok, "%s: %s" % (args[0], detail), out)])
PY
}

score_run() {  # score_run <dispatch> <repo>
  [ -d "$1" ] || { echo "fixture: no such dispatch directory: $1" >&2; return 1; }
  git -C "$2" rev-parse --git-dir >/dev/null 2>&1 || { echo "fixture: not a git repo: $2" >&2; return 1; }
  py score "$1" "$2"
}

hidden_run() {  # hidden_run <ticket> <app-dir>
  is_ticket "$1" || return 1
  [ -f "$2/package.json" ] || { echo "fixture: no package.json in $2" >&2; return 1; }
  py hidden "$1" "$2"
}

case ${1:-} in
  new)
    [ $# -eq 3 ] || usage
    case $2$3 in -*) usage ;; esac
    need git python3
    new_run "$2" "$3"; exit $? ;;
  score) [ $# -eq 3 ] || usage; need git python3 bun npm jq; score_run "$2" "$3"; exit $? ;;
  hidden) [ $# -eq 3 ] || usage; need python3 bun; hidden_run "$2" "$3"; exit $? ;;
  --self-test) ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
need git python3 bun npm jq
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export POSTMASTER_CONFIG=$tmp/config.toml; CONFIG=$POSTMASTER_CONFIG
export POSTMASTER_TOOL_PINS=$tmp/tools
cat > "$CONFIG" <<'EOF'
[lanes.one]
harness = "bash"
model = "m1"
[lanes.two]
harness = "bash"
model = "m2"
[team]
workhorses = ["one", "two"]
coachman = { harness = "bash", model = "judge" }
[tracker]
kind = "github"
EOF
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
first=$(tickets | head -1)
background() {  # background <name> <command...>: run it in the background, into $tmp/<name>.out and .rc
  local name=$1; shift
  ( "$@" > "$tmp/$name.out" 2> "$tmp/$name.err"; echo $? > "$tmp/$name.rc" ) &
}
rc_of() { cat "$tmp/$1.rc" 2>/dev/null || echo none; }

# The records of finished runs are built with the scripts a run uses, so they follow the
# contract as those scripts define it today: the stages from stage.sh --list, and the hand-off
# sections from what handoff-check.sh says an empty hand-off lacks. As the runbooks have it, the
# legs enter every stage after the first and before done, and the postmaster closes the run. The
# score counts legs from the run itself, so the number of legs here is arbitrary.
: > "$tmp/empty.md"
sections=$("$HERE/handoff-check.sh" "$tmp/empty.md" 2>&1 >/dev/null | sed -n 's/^handoff-check: missing or empty section: //p')
listed=$("$HERE/stage.sh" --list)
stages=$(printf '%s\n' "$listed" | sed '/^done$/q' | sed '1d;$d')
record() {  # record <name> <ticket> <shipped: reference, app or broken>: a finished run
  local name=$1 t=$2 shipped=$3 legs=3 n s section done_stages=0 count
  local repo=$tmp/$name/repo d=$tmp/$name/repo/.postmaster/runs/7 base
  mkdir -p "$tmp/$name" && make_repo "$repo" >/dev/null || return 1
  mkdir -p "$d/logs" "$d/audit" "$d/render" || return 1
  base=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" checkout -q -b 7 || return 1
  case $shipped in
    reference) git -C "$repo" apply "$TICKETS/$t/reference.patch" || return 1 ;;
    broken) git -C "$repo" apply "$TICKETS/$t/reference.patch" || return 1
            printf 'export const broken: number = "not a number";\n' > "$repo/src/broken.ts" ;;
  esac
  git -C "$repo" add -A && git -C "$repo" commit -q --allow-empty -m "Implement the ticket" \
    && git -C "$repo" checkout -q main && git -C "$repo" merge -q --no-ff -m "Merge branch 7" 7 || return 1
  printf '{"stage": "dispatched", "leg": 1, "base": "%s", "lanes": {}, "coachman": {"legs": {}}}\n' "$base" > "$d/manifest.json"
  { printf '# Waybill: 7\n\n## Ticket\n\n'; ticket_body "$t"; printf '\n## Project profile\nrepo: %s\n' "$repo"; } > "$d/brief.md"
  "$HERE/run-meta.sh" "$d" "$repo" >/dev/null || return 1
  count=$(printf '%s\n' "$stages" | wc -l)
  for n in $(seq 1 "$legs"); do
    printf 'You are the coachman for leg %s of 7.\n' "$n" > "$d/leg-$n-prompt.txt"
    "$HERE/log-action.sh" "$d" postmaster dispatch 7 "leg $n" && "$HERE/log-action.sh" "$d" coachman handoff-accept "leg-$n" || return 1
    for s in $(printf '%s\n' "$stages" | sed -n "$((done_stages + 1)),$((count * n / legs))p"); do
      "$HERE/stage.sh" "$d" "$s" >/dev/null || return 1
    done
    done_stages=$((count * n / legs))
    while IFS= read -r section; do printf '## %s\nLeg %s, recorded.\n\n' "$section" "$n"; done <<< "$sections" > "$d/handoff-$n.md"
    "$HERE/log-action.sh" "$d" coachman handoff "leg-$n" && touch "$d/.leg-$n-done" "$d/.leg-$n-exited" || return 1
  done
  "$HERE/stage.sh" "$d" done postmaster >/dev/null || return 1
  printf '# Ship card: 7\n\nBranch 7 is merged into main.\n' > "$d/card.md"
  python3 - "$d/manifest.json" "$legs" <<'PY'
import json, sys
path, legs = sys.argv[1], int(sys.argv[2])
m = json.load(open(path)); m["leg"] = legs
m["coachman"]["legs"] = {str(n): {"thread_id": "thread-%d" % n} for n in range(1, legs + 1)}
json.dump(m, open(path, "w"), indent=2)
PY
}

broken() {  # broken <name> <clean dispatch>: a copy of the clean record's dispatch, to break one thing in
  local d=$tmp/$1/repo/.postmaster/runs/7
  mkdir -p "$(dirname "$d")" && cp -a "$2" "$d" && printf '%s\n' "$d"
}
breaks() {  # breaks <clean dispatch> <repo>: the negative controls, each with one thing broken, scored
  local clean=$1 repo=$2 d b
  d=$(broken break-stages "$clean") && python3 - "$d/actions.jsonl" <<'PY'
import json, sys
path = sys.argv[1]; kept = []; seen = 0
for line in open(path).read().splitlines():
    if json.loads(line).get("action") == "stage":
        seen += 1
        if seen == 3:
            continue                    # the third stage change was never logged
    kept.append(line)
open(path, "w").write("\n".join(kept) + "\n")
PY
  d=$(broken break-markers "$clean") && rm -- "$d/.leg-2-done"
  d=$(broken break-handoffs "$clean") && : > "$d/handoff-2.md"
  d=$(broken break-runjson "$clean") && rm -- "$d/run.json"
  d=$(broken break-card "$clean") && rm -- "$d/card.md"
  d=$(broken break-waybill "$clean") && printf '# Waybill: 7\n\n## Ticket\n\nSee the tracker.\n' > "$d/brief.md"
  for b in stages markers handoffs runjson card waybill; do
    background "break-$b" score_run "$tmp/break-$b/repo/.postmaster/runs/7" "$repo"
  done
  wait
}
recorded() {  # recorded <name> <ticket> <shipped>: build the record, score it, and break the first clean one
  record "$1" "$2" "$3" > "$tmp/built-$1.out" 2>&1 \
    || { echo "the record could not be built: $(tail -3 "$tmp/built-$1.out")"; return 1; }
  [ "$1" = "clean-$first" ] && breaks "$tmp/$1/repo/.postmaster/runs/7" "$tmp/$1/repo" &
  score_run "$tmp/$1/repo/.postmaster/runs/7" "$tmp/$1/repo"; local rc=$?
  wait
  return $rc
}

# Everything slow runs in the background at once: each record is built and scored, and each
# ticket's hidden suite runs against the app and against its reference.
for t in $(tickets); do background "clean-$t" recorded "clean-$t" "$t" reference; done
background break-hidden recorded break-hidden "$first" app
background break-gate recorded break-gate "$first" broken
hidden=()
for t in $(tickets); do
  make_repo "$tmp/app-$t" >/dev/null && make_repo "$tmp/ref-$t" >/dev/null \
    && git -C "$tmp/ref-$t" apply "$TICKETS/$t/reference.patch" && echo 0 > "$tmp/applied-$t.rc"
  background "hidden-app-$t" hidden_run "$t" "$tmp/app-$t"; hidden+=($!)
  background "hidden-ref-$t" hidden_run "$t" "$tmp/ref-$t"; hidden+=($!)
done
wait "${hidden[@]}"

echo "the tickets: each hidden suite fails on the app as committed and passes on its reference"
[ "$(tickets | wc -l)" -ge 2 ] && ok "there are at least two tickets" || fail "there are at least two tickets"
for t in $(tickets); do
  ticket_body "$t" > "$tmp/body-$t.md"
  out=$("$HERE/ticket-check.sh" --body "$tmp/body-$t.md" --title "$(ticket_title "$t")" 2>&1); rc=$?
  [ $rc -eq 0 ] && ok "$t: in the ticket shape, by scripts/ticket-check.sh" || fail "$t: in the ticket shape, by scripts/ticket-check.sh (exit $rc)" "$out"
  [ "$(rc_of "applied-$t")" = 0 ] && ok "$t: the reference solution applies to the app" || fail "$t: the reference solution applies to the app"
  [ "$(rc_of "hidden-app-$t")" = 2 ] && ok "$t: the hidden suite fails on the app as committed" \
    || fail "$t: the hidden suite fails on the app as committed (exit $(rc_of "hidden-app-$t"))" "$(cat "$tmp/hidden-app-$t.out" "$tmp/hidden-app-$t.err")"
  [ "$(rc_of "hidden-ref-$t")" = 0 ] && ok "$t: the hidden suite passes on the reference solution" \
    || fail "$t: the hidden suite passes on the reference solution (exit $(rc_of "hidden-ref-$t"))" "$(cat "$tmp/hidden-ref-$t.out" "$tmp/hidden-ref-$t.err")"
done

echo "new: a fresh repo outside every other, with its ticket in its own store"
cat > "$tmp/failing-local.sh" <<EOF
#!/usr/bin/env bash
# Stands in for scripts/local.sh: makes the store, and fails to file the ticket.
case \$2 in store) exec "$HERE/local.sh" "\$@" ;; *) exit 1 ;; esac
EOF
chmod +x "$tmp/failing-local.sh"
mkdir -p "$tmp/home" "$tmp/runs"
fresh_new() {  # fresh_new <dest> <ticket>: make_and_file with a home of the test's own
  HOME=$tmp/home make_and_file "$1" "$2" 2>&1
}
dest=$tmp/runs/fixture-$first
out=$(fresh_new "$dest" "$first"); rc=$?
[ $rc -eq 0 ] && grep -q "own ticket store as #1:" <<<"$out" && ok "new makes the repo and prints the ticket's number" || fail "new makes the repo and prints the ticket's number (exit $rc)" "$out"
[ "$(git -C "$dest" rev-list --count main 2>/dev/null)" = 1 ] && [ -z "$(git -C "$dest" status --porcelain 2>/dev/null)" ] \
  && ok "one commit on main, and a clean tree" || fail "one commit on main, and a clean tree"
same=$(git -C "$APP" ls-files --cached --others --exclude-standard | sort | while IFS= read -r f; do
  if [ -L "$APP/$f" ]; then [ "$(readlink "$APP/$f")" = "$(readlink "$dest/$f" 2>/dev/null)" ] && echo "$f"
  else cmp -s "$APP/$f" "$dest/$f" && echo "$f"; fi
done)
held=$(cd "$dest" && find . -path ./.git -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | sort)
[ -n "$held" ] && [ "$held" = "$same" ] && [ -L "$dest/CLAUDE.md" ] \
  && ok "it holds the app's files as git sees them, symlink included, and nothing else" \
  || fail "it holds the app's files as git sees them, symlink included, and nothing else" "$(diff <(printf '%s\n' "$same") <(printf '%s\n' "$held"))"
[ "$(git -C "$dest" config --local user.email)" = "$(git -C "$TOOL" config user.email)" ] \
  && [ "$(git -C "$dest" config --local user.name)" = "$(git -C "$TOOL" config user.name)" ] \
  && ok "it commits as this checkout does" || fail "it commits as this checkout does"
[ -z "$(git -C "$dest" remote)" ] && ok "it has no remote" || fail "it has no remote" "$(git -C "$dest" remote -v)"
[ "$("$HERE/local.sh" "$dest" list)" = "$(printf '#1\ttodo\t%s' "$(ticket_title "$first")")" ] \
  && [ "$("$HERE/local.sh" "$dest" read 1 --body)" = "$(ticket_body "$first")" ] \
  && ok "its own store holds the fixture ticket, title and body verbatim, in todo" \
  || fail "its own store holds the fixture ticket, title and body verbatim, in todo" "$("$HERE/local.sh" "$dest" list 2>&1)"
[ "$(grep -A1 '^\[tracker\]' "$CONFIG" | tail -1)" = 'kind = "github"' ] && [ "$("$HERE/tracker-kind.sh" "$dest")" = local ] \
  && ok "a run against it reads the local tracker, though the config names github" \
  || fail "a run against it reads the local tracker, though the config names github" "$("$HERE/tracker-kind.sh" "$dest" 2>&1)"
leaked=$(for t in $(tickets); do
  for f in "$TICKETS/$t/hidden"/* "$TICKETS/$t/reference.patch"; do
    find "$dest" -path "$dest/.git" -prune -o -name "$(basename "$f")" -print
  done
done)
[ -z "$leaked" ] && ok "no hidden test and no reference solution reached it" || fail "no hidden test and no reference solution reached it" "$leaked"
out=$(fresh_new "$dest" "$first"); rc=$?
[ $rc -eq 1 ] && [ "$(git -C "$dest" rev-list --count main)" = 1 ] && ok "a dest that exists is refused, and left alone" || fail "a dest that exists is refused, and left alone (exit $rc)" "$out"
out=$(fresh_new "$tmp/app-$first/nested" "$first"); rc=$?
[ $rc -eq 1 ] && [ ! -e "$tmp/app-$first/nested" ] && ok "a dest inside a git repo is refused" || fail "a dest inside a git repo is refused (exit $rc)" "$out"
same_a="$tmp/one/widgets"; same_b="$tmp/two/widgets"
mkdir -p "$same_a/.postmaster/runs/T-1" "$same_b/.postmaster/runs/T-1"
"$HERE/log-action.sh" "$same_a/.postmaster/runs/T-1" postmaster note same-a one >/dev/null 2>&1; a_rc=$?
"$HERE/log-action.sh" "$same_b/.postmaster/runs/T-1" postmaster note same-b two >/dev/null 2>&1; b_rc=$?
[ $a_rc -eq 0 ] && [ $b_rc -eq 0 ] \
  && [ -f "$same_a/.postmaster/runs/ledger.jsonl" ] && [ -f "$same_b/.postmaster/runs/ledger.jsonl" ] \
  && ! cmp -s "$same_a/.postmaster/runs/ledger.jsonl" "$same_b/.postmaster/runs/ledger.jsonl" \
  && ok "same-basename projects keep separate project-local ledgers" \
  || fail "same-basename projects keep separate project-local ledgers"
out=$(fresh_new "$tmp/runs/nosuch" no-such-ticket); rc=$?
[ $rc -eq 1 ] && [ ! -e "$tmp/runs/nosuch" ] && ok "an unknown ticket is refused" || fail "an unknown ticket is refused (exit $rc)" "$out"
out=$(LOCAL_SH=$tmp/failing-local.sh fresh_new "$tmp/runs/unfiled" "$first"); rc=$?
[ $rc -eq 1 ] && [ ! -e "$tmp/runs/unfiled" ] && grep -q "filing the ticket" <<<"$out" \
  && ok "a ticket that cannot be filed: refused, and the repo it made is gone" \
  || fail "a ticket that cannot be filed: refused, and the repo it made is gone (exit $rc)" "$out"
out=$(cd "$tmp/runs" && POSTMASTER_FIXTURES='' fresh_new bare-name "$first"); rc=$?
[ $rc -eq 0 ] && [ "$(git -C "$tmp/home/Code/fixtures/bare-name" rev-list --count main 2>/dev/null)" = 1 ] && [ ! -e "$tmp/runs/bare-name" ] \
  && ok "a bare name goes under ~/Code/fixtures, not the working directory" \
  || fail "a bare name goes under ~/Code/fixtures, not the working directory (exit $rc)" "$out"
out=$(POSTMASTER_FIXTURES=$tmp/elsewhere fresh_new other-name "$first"); rc=$?
[ $rc -eq 0 ] && [ -d "$tmp/elsewhere/other-name/.git" ] && [ ! -e "$tmp/home/Code/fixtures/other-name" ] \
  && ok "POSTMASTER_FIXTURES moves where a bare name goes" \
  || fail "POSTMASTER_FIXTURES moves where a bare name goes (exit $rc)" "$out"

wait

echo "score: a recorded run that meets every check scores clean"
[ -n "$sections" ] && [ -n "$stages" ] && grep -qx done <<<"$listed" \
  && ok "the hand-off sections and the stages are read from the scripts that define them" \
  || fail "the hand-off sections and the stages are read from the scripts that define them"
expect() {  # expect <label> <name> <the check that fails, or none> [<text its FAIL line carries>]
  local out rc failing lines want
  out=$(cat "$tmp/$2.out" 2>/dev/null); rc=$(rc_of "$2")
  failing=$(printf '%s\n' "$out" | awk '$1 == "FAIL" { print $2 }' | paste -sd, -); [ -n "$failing" ] || failing=none
  lines=$(printf '%s\n' "$out" | grep -c .)
  want=$([ "$3" = none ] && echo 0 || echo 2)
  if [ "$rc" = "$want" ] && [ "$failing" = "$3" ] && [ "$lines" -eq 7 ] \
     && { [ -z "${4:-}" ] || grep -qF -- "$4" <<<"$(grep '^FAIL' <<<"$out")"; }; then
    ok "$1"
  else
    fail "$1: wanted exit $want with $3 failing${4:+ (\"$4\")}, got exit $rc with $failing failing" "$out"
  fi
}
for t in $(tickets); do expect "a clean run on $t: every check passes" "clean-$t" none; done

echo "score: negative controls, the same record with one check broken at a time"
expect "the app shipped as committed: hidden-tests alone fails, and the app's own gate passes" break-hidden hidden-tests "fail on main"
expect "the waybill does not carry the ticket: hidden-tests alone fails" break-waybill hidden-tests "carries no fixture ticket"
expect "a type error shipped: gate alone fails" break-gate gate "npm run check on main: exit"
expect "a stage change never logged: stages alone fails" break-stages stages ", not "
expect "a leg's done marker missing: markers alone fails" break-markers markers ".leg-2-done"
expect "a hand-off with no sections: handoffs alone fails" break-handoffs handoffs "handoff-2.md"
expect "no run.json: run.json alone fails" break-runjson run.json "no run.json"
expect "no ship card: ship-card alone fails" break-card ship-card "no card.md"

echo "lane scoring: the suite beside the new code runs in this self-test"
out=$(bun --no-env-file test "$HERE/fixture-lanes.test.ts" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "bun test scripts/fixture-lanes.test.ts" || fail "bun test scripts/fixture-lanes.test.ts (exit $rc)" "$out"

echo "score: input that is not a run is refused, not scored"
clean=$tmp/clean-$first/repo/.postmaster/runs/7; repo=$tmp/clean-$first/repo
score_run "$tmp/nowhere" "$repo" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "no such dispatch directory" || fail "no such dispatch directory (exit $rc)"
mkdir -p "$tmp/not-a-repo"; score_run "$clean" "$tmp/not-a-repo" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a repo that is not a git repo" || fail "a repo that is not a git repo (exit $rc)"
git init -q -b main "$tmp/other" && git -C "$tmp/other" commit -q --allow-empty -m "Another history"
out=$(score_run "$clean" "$tmp/other" 2>&1); rc=$?
[ $rc -eq 1 ] && grep -q "is this the run's repo" <<<"$out" && ok "a repo whose main does not hold the run's base" \
  || fail "a repo whose main does not hold the run's base (exit $rc)" "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
