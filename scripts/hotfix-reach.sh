#!/usr/bin/env bash
# How a hotfix on postmaster's main reaches every run in flight, and applying it there.
# A fix reaches a run through the checkout the run calls postmaster from where it can, and
# as a lone fix commit where it cannot — never as a merge of main into a run's branch.
#
#   hotfix-reach.sh report <runs-root> <fix-commit> [--tool <repo>]
#       one line per run in flight: the run, how the fix reaches it (checkout, branch,
#       next-leg or conflict), and what that means. checkout: through the tool checkout,
#       nothing more to do on the branch. branch: as a fix commit on the run's branch,
#       because the branch carries its own copy of a fixed file. next-leg: a fixed file is
#       a runbook the current leg has already read; the fix takes effect at the next leg.
#       conflict: the branch changed the same lines of a fixed file; left untouched.
#   hotfix-reach.sh apply <runs-root> <fix-commit> [--tool <repo>]
#       apply the fix commit where a run needs it, at that run's next stop between legs,
#       never mid-leg and never as a merge of main. On a run's branches (synthesis and
#       every lane branch that carries a fixed file) as a commit whose message says it is
#       main's fix; on the run's tool checkout when it is a pin that does not yet serve
#       the fix. The next leg's prompt is told: <dispatch>/hotfix-notes.md, and the prompt
#       file when it already exists. Every step is logged through log-action.sh.
#   hotfix-reach.sh --self-test
#
# <runs-root> is a project's .postmaster/runs. <fix-commit> is the sha of the fix on
# postmaster's main; --tool names the postmaster checkout that holds it (default: this
# script's own repo). A run is in flight when its manifest's stage is neither done nor
# abandoned. "Carries its own copy of the fixed file" is the file existing in the run's
# branch tree in the target repo: a postmaster-as-target run always does, a run against
# another project never does. "Changed the same lines" is the fix's diff not applying
# cleanly to the branch; that run is left alone and named, and whichever merges second
# resolves the conflict. Pin fixes are recorded beside the pin as <commit>.fixes so
# run-meta.sh check still accepts the checkout.
#
#   exit 0  printed; apply: every needed fix landed or was rightly left alone
#   exit 1  usage, no such root or commit, or a step failed
#   exit 2  apply: a fix was needed and could not be applied (a conflict is not this)
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
TOOLS=${POSTMASTER_TOOL_PINS:-$HOME/.postmaster/tool-pins}
usage() { echo "usage: hotfix-reach.sh report <runs-root> <fix-commit> [--tool <repo>] | apply <runs-root> <fix-commit> [--tool <repo>] | --self-test" >&2; exit 1; }

run_py() {  # run_py <command> <runs-root> <fix-commit> <tool-repo>
  python3 - "$HERE" "$TOOLS" "$@" <<'PY'
import json, os, pathlib, re, shutil, subprocess, sys, tempfile

HERE, TOOLS = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
CMD, ROOT, FIX, TOOL = sys.argv[3], pathlib.Path(sys.argv[4]), sys.argv[5], pathlib.Path(sys.argv[6])

def die(msg, code=1):
    print("hotfix-reach: " + msg, file=sys.stderr)
    sys.exit(code)

def run(argv, cwd=None, check=False):
    r = subprocess.run([str(a) for a in argv], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        die("%s: %s" % (argv[0], (r.stderr or r.stdout).strip().splitlines()[-1:]))
    return r

def git(where, *args):
    return run(["git", "-C", str(where), *args])

def git_ok(where, *args):
    r = git(where, *args)
    return r.returncode == 0

def git_out(where, *args):
    r = git(where, *args)
    return r.stdout.strip() if r.returncode == 0 else ""

if not ROOT.is_dir():
    die("no such runs root: %s" % ROOT)
if not git_ok(TOOL, "rev-parse", "--verify", "-q", FIX + "^{commit}"):
    die("no such fix commit in %s: %s" % (TOOL, FIX))
FIX_SHA = git_out(TOOL, "rev-parse", "--verify", "-q", FIX + "^{commit}")
FIX_SHORT = FIX_SHA[:12]
FIX_SUBJECT = git_out(TOOL, "log", "-1", "--format=%s", FIX_SHA)
FIX_FILES = [ln for ln in git_out(TOOL, "show", "--pretty=format:", "--name-only", FIX_SHA).splitlines() if ln.strip()]
if not FIX_FILES:
    die("the fix commit %s changes no files" % FIX_SHORT)
RUNBOOK_RE = re.compile(r"(^|/)skills/[^/]+/[^/]+\.md$")
is_runbook = any(RUNBOOK_RE.search(f) for f in FIX_FILES)

def project_repo():
    # <project>/.postmaster/runs -> the project root, the target the runs were dispatched on
    p = ROOT.resolve()
    if p.name == "runs" and p.parent.name == ".postmaster":
        repo = p.parent.parent
    else:
        repo = p.parent
    if not git_ok(repo, "rev-parse", "--git-dir"):
        die("no git repository at %s for these runs" % repo)
    return repo

def stage_of(dispatch):
    try:
        return (json.loads((dispatch / "manifest.json").read_text()).get("stage") or "")
    except (OSError, ValueError, AttributeError):
        return ""

def leg_of(dispatch):
    try:
        return int(json.loads((dispatch / "manifest.json").read_text()).get("leg") or 0)
    except (OSError, ValueError, AttributeError):
        return 0

def lanes_of(dispatch):
    try:
        lanes = json.loads((dispatch / "manifest.json").read_text()).get("lanes") or {}
        return sorted(lanes.keys())
    except (OSError, ValueError, AttributeError):
        return []

def in_flight_runs():
    runs = []
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir() or d.name in ("postmaster", "hotfix"):
            continue
        if not (d / "manifest.json").is_file():
            continue
        st = stage_of(d)
        if st in ("done", "abandoned"):
            continue
        runs.append(d)
    return runs

def mid_leg(dispatch):
    """A leg is in progress: started, and its process has not exited or finished."""
    st, leg = stage_of(dispatch), leg_of(dispatch)
    if st in ("", "dispatched", "done", "abandoned"):
        return False
    if leg <= 0:
        return False
    return not (dispatch / (".leg-%d-done" % leg)).exists() and \
           not (dispatch / (".leg-%d-exited" % leg)).exists()

def branch_carries(repo, branch, path):
    return git_ok(repo, "cat-file", "-e", "%s:%s" % (branch, path))

def run_branches(dispatch, repo):
    ticket = dispatch.name
    names = [ticket]
    for lane in lanes_of(dispatch):
        names.append("wb/%s-%s" % (ticket, lane))
    # also any wb/ branch the repo holds for this ticket, in case a lane left one
    for ln in git_out(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/wb/" + ticket + "-").splitlines():
        if ln and ln not in names:
            names.append(ln)
    out = []
    for n in names:
        if git_ok(repo, "rev-parse", "--verify", "-q", "refs/heads/" + n):
            out.append(n)
    return out

def classify(dispatch, repo):
    branches = run_branches(dispatch, repo)
    carries = []
    for b in branches:
        for f in FIX_FILES:
            if branch_carries(repo, b, f):
                carries.append(b)
                break
    if is_runbook and mid_leg(dispatch):
        return "next-leg", carries
    if carries:
        return "branch", carries
    return "checkout", carries

def patch_text():
    r = git(TOOL, "format-patch", "-1", FIX_SHA, "--stdout")
    return r.stdout if r.returncode == 0 else ""

def apply_conflicts(repo, branch, patch):
    """True when the fix's diff does not apply cleanly to branch."""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="hotfix-reach-"))
    try:
        if not git_ok(repo, "worktree", "add", "--detach", str(tmp), branch):
            return True  # cannot inspect: treat as conflict so we leave it alone
        p = tmp / "fix.patch"
        p.write_text(patch)
        r = git(tmp, "apply", "--check", str(p))
        return r.returncode != 0
    finally:
        git(repo, "worktree", "remove", "--force", str(tmp))
        shutil.rmtree(tmp, ignore_errors=True)

def log(dispatch, actor, action, target, detail):
    script = HERE / "log-action.sh"
    run([script, str(dispatch), actor, action, target, detail])

def log_note(dispatch, detail):
    log(dispatch, "postmaster", "note", "hotfix", detail)

def fix_message():
    return "Main's fix %s: %s\n\nCherry-picked alone from main for this run; this is main's fix,\nnot this run's own work. Never a merge of main.\n" % (FIX_SHORT, FIX_SUBJECT)

def apply_on_branch(repo, branch, patch):
    """Commit the fix alone on branch. Prefers a clean worktree of that branch."""
    msg = fix_message()
    wt = None
    for ln in git_out(repo, "worktree", "list", "--porcelain").splitlines():
        if ln.startswith("worktree "):
            wt = pathlib.Path(ln[len("worktree "):])
        elif ln == "branch refs/heads/" + branch and wt is not None:
            break
        else:
            wt = None
    if wt is not None and wt.is_dir():
        dirty = git_out(wt, "status", "--porcelain")
        if dirty:
            return None, "worktree dirty"
        p = wt / ".hotfix-reach.patch"
        p.write_text(patch)
        r = git(wt, "apply", str(p))
        p.unlink(missing_ok=True)
        if r.returncode != 0:
            return None, "apply failed"
        git(wt, "add", "-A")
        r = git(wt, "commit", "-m", msg)
        if r.returncode != 0:
            return None, "commit failed"
        return git_out(wt, "rev-parse", "HEAD"), "worktree"
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="hotfix-reach-"))
    try:
        if not git_ok(repo, "worktree", "add", "--detach", str(tmp), branch):
            return None, "no scratch"
        p = tmp / "fix.patch"
        p.write_text(patch)
        if git(tmp, "apply", str(p)).returncode != 0:
            return None, "apply failed"
        git(tmp, "add", "-A")
        if git(tmp, "commit", "-m", msg).returncode != 0:
            return None, "commit failed"
        new = git_out(tmp, "rev-parse", "HEAD")
        if not new:
            return None, "no commit"
        r = git(repo, "update-ref", "refs/heads/" + branch, new)
        if r.returncode != 0:
            return None, "update-ref failed"
        return new, "scratch"
    finally:
        git(repo, "worktree", "remove", "--force", str(tmp))
        shutil.rmtree(tmp, ignore_errors=True)

def pin_of(dispatch):
    try:
        r = json.loads((dispatch / "run.json").read_text())
        co = (r.get("postmaster") or {}).get("checkout") or ""
        return pathlib.Path(co) if co else None
    except (OSError, ValueError, AttributeError):
        return None

def pin_has_fix(pin, dispatch_commit):
    """The pin serves the fix when its HEAD is the dispatch commit or carries only recorded fixes."""
    at = git_out(pin, "rev-parse", "--verify", "-q", "HEAD")
    if not at:
        return False
    if at == dispatch_commit:
        return False  # exactly the dispatch commit: the fix is not on it yet
    fixes = pathlib.Path(str(pin.parent / (dispatch_commit + ".fixes")))
    recorded = set()
    if fixes.is_file():
        recorded = {ln.strip() for ln in fixes.read_text().splitlines() if ln.strip()}
    revs = git_out(pin, "rev-list", "%s..HEAD" % dispatch_commit).splitlines()
    return bool(revs) and all(r in recorded for r in revs)

def apply_on_pin(dispatch, pin):
    """Cherry-pick the fix alone onto the run's pin so the checkout serves it."""
    try:
        r = json.loads((dispatch / "run.json").read_text())
        commit = (r.get("postmaster") or {}).get("commit") or ""
    except (OSError, ValueError, AttributeError):
        return None, "no run.json"
    if not commit:
        return None, "no dispatch commit"
    if pin_has_fix(pin, commit):
        return None, "already"
    if not git_ok(pin, "rev-parse", "--verify", "-q", "HEAD"):
        return None, "not a checkout"
    patch = patch_text()
    p = pin / ".hotfix-reach.patch"
    p.write_text(patch)
    r = git(pin, "apply", "--check", str(p))
    if r.returncode != 0:
        p.unlink(missing_ok=True)
        return None, "conflict"
    git(pin, "apply", str(p))
    p.unlink(missing_ok=True)
    git(pin, "add", "-A")
    msg = fix_message()
    if git(pin, "commit", "-m", msg).returncode != 0:
        return None, "commit failed"
    new = git_out(pin, "rev-parse", "HEAD")
    fixes = pin.parent / (commit + ".fixes")
    with open(fixes, "a") as f:
        f.write(new + "\n")
    return new, "pin"

def next_leg_prompt(dispatch):
    """Write hotfix-notes.md and point the next leg's prompt at it when one exists."""
    note = dispatch / "hotfix-notes.md"
    line = "- Main's fix %s (`%s`) was applied to this run's branch as a lone commit. It is main's fix, not this run's work.\n" % (FIX_SHORT, FIX_SUBJECT)
    if note.is_file():
        text = note.read_text()
        if FIX_SHORT not in text:
            note.write_text(text + line)
    else:
        note.write_text("# Hotfix notes\n\n" + line)
    leg = leg_of(dispatch)
    for n in (leg, leg + 1):
        prompt = dispatch / ("leg-%d-prompt.txt" % n)
        if prompt.is_file():
            t = prompt.read_text()
            marker = "Main's fix %s" % FIX_SHORT
            if marker not in t:
                prompt.write_text(t.rstrip("\n") + "\n\nNote: main's fix %s (`%s`) was applied to this branch alone. It is main's fix, not this run's own work.\n" % (FIX_SHORT, FIX_SUBJECT))

def report():
    repo = project_repo()
    print("%-14s %-10s %s" % ("RUN", "REACH", "WHAT"))
    n_checkout = n_branch = n_next = n_conflict = 0
    for d in in_flight_runs():
        reach, carries = classify(d, repo)
        patch = patch_text()
        if reach == "branch" and carries and apply_conflicts(repo, carries[0], patch):
            reach = "conflict"
        if reach == "checkout":
            n_checkout += 1
            what = "through the checkout it calls postmaster from, nothing more to do"
        elif reach == "branch":
            n_branch += 1
            what = "fix commit on %s, at the next leg boundary" % ",".join(carries)
        elif reach == "next-leg":
            n_next += 1
            what = "runbook already read; reaches at the next leg"
        else:
            n_conflict += 1
            what = "branch changed the same lines; left untouched"
        print("%-14s %-10s %s" % (d.name, reach, what))
    print("totals: %d checkout, %d branch, %d next-leg, %d conflict" %
          (n_checkout, n_branch, n_next, n_conflict))
    return 0

def apply():
    repo = project_repo()
    patch = patch_text()
    changed = waited = conflicts = 0
    failed = 0
    for d in in_flight_runs():
        reach, carries = classify(d, repo)
        # the checkout side: a pin that does not yet serve the fix gets it alone
        pin = pin_of(d)
        if pin is not None and pin.is_dir():
            at = git_out(pin, "rev-parse", "--verify", "-q", "HEAD")
            if at and not pin_has_fix(pin, (json.loads((d / "run.json").read_text()).get("postmaster") or {}).get("commit") or ""):
                new, how = apply_on_pin(d, pin)
                if new:
                    log(d, "postmaster", "apply", str(pin), "main's fix %s on the run's checkout (%s)" % (FIX_SHORT, how))
                    changed += 1
                elif how not in ("already",):
                    log_note(d, "hotfix pin %s: %s" % (FIX_SHORT, how))
        # the branch side: only at a leg boundary, only when the branch carries a copy
        if reach == "checkout":
            log_note(d, "hotfix %s reaches through the checkout, nothing more to do" % FIX_SHORT)
            continue
        if reach == "next-leg" and not carries:
            log_note(d, "hotfix %s is a runbook this leg already read; reaches at the next leg" % FIX_SHORT)
            next_leg_prompt(d)
            continue
        if mid_leg(d):
            print("%s: wait (mid-leg %s); the fix commit lands at the next leg boundary" % (d.name, leg_of(d)))
            waited += 1
            log_note(d, "hotfix %s waits for the next leg boundary" % FIX_SHORT)
            continue
        if reach == "conflict" or (carries and apply_conflicts(repo, carries[0], patch)):
            print("%s: conflict (branch changed the same lines); left untouched" % d.name)
            conflicts += 1
            log_note(d, "hotfix %s conflict on the same lines; left untouched" % FIX_SHORT)
            continue
        ok_here = False
        for b in carries:
            new, how = apply_on_branch(repo, b, patch)
            if new:
                log(d, "postmaster", "apply", b, "main's fix %s as a lone commit (%s)" % (FIX_SHORT, how))
                print("%s: %s <- main's fix %s (%s)" % (d.name, b, FIX_SHORT, how))
                ok_here = True
                changed += 1
            elif how != "worktree dirty":
                log_note(d, "hotfix %s not applied on %s: %s" % (FIX_SHORT, b, how))
                failed += 1
            else:
                waited += 1
                log_note(d, "hotfix %s waits on %s (dirty)" % (FIX_SHORT, b))
        if ok_here or reach == "next-leg":
            next_leg_prompt(d)
            if reach == "next-leg":
                log_note(d, "hotfix %s reaches at the next leg; prompt notes it" % FIX_SHORT)
    print("applied %d, waited %d, conflict %d, failed %d" % (changed, waited, conflicts, failed))
    return 2 if failed else 0

if CMD == "report":
    sys.exit(report())
elif CMD == "apply":
    sys.exit(apply())
else:
    die("unknown command: %s" % CMD)
PY
}

if [ "${1:-}" = --self-test ]; then
  [ $# -eq 1 ] || usage
  :
elif [ $# -ge 3 ] && { [ "$1" = report ] || [ "$1" = apply ]; }; then
  cmd=$1 root=$2 fix=$3; shift 3
  tool=$TOOL
  while [ $# -gt 0 ]; do
    case $1 in
      --tool) [ $# -ge 2 ] || usage; tool=$2; shift 2 ;;
      *) usage ;;
    esac
  done
  root=$(CDPATH= cd -P -- "$root" 2>/dev/null && pwd -P) \
    || { echo "hotfix-reach: no such runs root: $root" >&2; exit 1; }
  tool=$(CDPATH= cd -P -- "$tool" 2>/dev/null && pwd -P) \
    || { echo "hotfix-reach: no such tool repo: $tool" >&2; exit 1; }
  run_py "$cmd" "$root" "$fix" "$tool"
  exit $?
else
  usage
fi

# --- self-test ----------------------------------------------------------------------------
# A run that needs the fix commit and a run that does not, told apart by the same command.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
SELF="$HERE/hotfix-reach.sh"

# The tool repo holds the fix: a postmaster-shaped tree, one commit that changes scripts/foo.sh.
tool="$tmp/tool"
mkdir -p "$tool/scripts" "$tool/skills/postmaster"
git -C "$tool" init -q -b main
git -C "$tool" config user.email self@test
git -C "$tool" config user.name self-test
echo "old" > "$tool/scripts/foo.sh"
echo "runbook" > "$tool/skills/postmaster/coachman.md"
git -C "$tool" add -A
git -C "$tool" commit -qm base
echo "new" > "$tool/scripts/foo.sh"
git -C "$tool" commit -qam "fix foo"
FIX=$(git -C "$tool" rev-parse HEAD)

# Project A is postmaster-as-target: its run's branch carries scripts/foo.sh.
projA="$tmp/projA"
mkdir -p "$projA/scripts" "$projA/.postmaster/runs/tA/logs"
git -C "$projA" init -q -b main
git -C "$projA" config user.email self@test
git -C "$projA" config user.name self-test
echo "old" > "$projA/scripts/foo.sh"
echo "other" > "$projA/scripts/bar.sh"
git -C "$projA" add -A
git -C "$projA" commit -qm base
git -C "$projA" checkout -qb tA
mkdir -p "$projA/.worktrees" 2>/dev/null || true
cat > "$projA/.postmaster/runs/tA/manifest.json" <<'EOF'
{"stage": "synthesis", "leg": 1, "lanes": {"luna": {}}}
EOF
# A second run on the same project, already between legs (leg 1 done).
mkdir -p "$projA/.postmaster/runs/tB/logs"
cat > "$projA/.postmaster/runs/tB/manifest.json" <<'EOF'
{"stage": "checkpoint-1", "leg": 1, "lanes": {}}
EOF
: > "$projA/.postmaster/runs/tB/.leg-1-done"
git -C "$projA" checkout -qb tB main
git -C "$projA" checkout -q tA

# Project B is another target: its run's branch has no scripts/foo.sh.
projB="$tmp/projB"
mkdir -p "$projB/src" "$projB/.postmaster/runs/tC/logs"
git -C "$projB" init -q -b main
git -C "$projB" config user.email self@test
git -C "$projB" config user.name self-test
echo "app" > "$projB/src/app.py"
git -C "$projB" add -A
git -C "$projB" commit -qm base
git -C "$projB" checkout -qb tC
cat > "$projB/.postmaster/runs/tC/manifest.json" <<'EOF'
{"stage": "workhorses-running", "leg": 1, "lanes": {}}
EOF

echo "positive controls"
out=$("$SELF" report "$projA/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tA  *branch" \
  && ok "a run whose branch carries the fixed file is branch" \
  || fail "a run whose branch carries the fixed file is branch (exit $rc)" "$out$(cat "$tmp/err")"
printf '%s\n' "$out" | grep -q "tC" && fail "project B is listed under project A's root" "$out" || true
outB=$("$SELF" report "$projB/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$outB" | grep -q "tC  *checkout" \
  && ok "a run whose branch carries no copy is checkout" \
  || fail "a run whose branch carries no copy is checkout (exit $rc)" "$outB$(cat "$tmp/err")"
printf '%s\n' "$out" | grep -q "tB  *branch" \
  && ok "a run between legs is still branch when it carries the file" \
  || fail "a run between legs is still branch when it carries the file" "$out"

echo "the same command tells them apart"
printf '%s\n' "$out" | grep -q "tA  *branch" && printf '%s\n' "$outB" | grep -q "tC  *checkout" \
  && ok "report shows branch for one run and checkout for the other" \
  || fail "report shows branch for one run and checkout for the other" "$out
$outB"

echo "apply lands the fix commit where it is needed"
# tB is between legs and carries the file: the fix commit lands there. tA is mid-leg and waits.
out=$("$SELF" apply "$projA/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "apply on project A (exit $rc)" "$(cat "$tmp/err")$out"
msg=$(git -C "$projA" log -1 --format=%s tB 2>/dev/null)
case $msg in
  "Main's fix "*) ok "the fix commit on the run's branch says it is main's fix" ;;
  *) fail "the fix commit on the run's branch says it is main's fix" "got: $msg" ;;
esac
git -C "$projA" show tB:scripts/foo.sh | grep -q new \
  && ok "and the branch carries the fix" \
  || fail "and the branch carries the fix" "$(git -C "$projA" show tB:scripts/foo.sh)"
git -C "$projA" log --oneline tB | grep -qi "merge" \
  && fail "never a merge of main" "$(git -C "$projA" log --oneline tB)" \
  || ok "never a merge of main"
git -C "$projA" log -1 --format=%s tA | grep -q "Main's fix" \
  && fail "mid-leg tA got no commit yet" "$(git -C "$projA" log -1 --format=%s tA)" \
  || ok "mid-leg tA waits; its branch is untouched for now"
outB=$("$SELF" apply "$projB/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "apply on project B (exit $rc)" "$(cat "$tmp/err")$outB"
git -C "$projB" log -1 --format=%s tC | grep -q "Main's fix" \
  && fail "project B's branch got no fix commit" "$(git -C "$projB" log -1 --format=%s tC)" \
  || ok "a run that does not need the commit gets no commit on its branch"

echo "mid-leg waits"
# tA is already mid-leg (synthesis, no done marker): a fresh apply still leaves it alone.
before=$(git -C "$projA" rev-parse tA)
out=$("$SELF" apply "$projA/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tA: wait" \
  && ok "mid-leg apply waits for the next leg boundary" \
  || fail "mid-leg apply waits for the next leg boundary" "$out$(cat "$tmp/err")"
[ $rc -eq 0 ] || fail "mid-leg apply still exits 0 (exit $rc)" "$out"
[ "$(git -C "$projA" rev-parse tA)" = "$before" ] \
  && ok "and the mid-leg branch is untouched" \
  || fail "and the mid-leg branch is untouched"

echo "a run whose branch changed the same lines is left alone"
mkdir -p "$projA/.postmaster/runs/tE/logs"
cat > "$projA/.postmaster/runs/tE/manifest.json" <<'EOF'
{"stage": "checkpoint-1", "leg": 1, "lanes": {}}
EOF
: > "$projA/.postmaster/runs/tE/.leg-1-done"
git -C "$projA" checkout -qb tE main
echo "conflict" > "$projA/scripts/foo.sh"
git -C "$projA" commit -qam "lane changed the same lines"
git -C "$projA" checkout -q tA
out=$("$SELF" report "$projA/.postmaster/runs" "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tE  *conflict" \
  && ok "the run is named as a conflict" \
  || fail "the run is named as a conflict" "$out$(cat "$tmp/err")"
before=$(git -C "$projA" rev-parse tE)
"$SELF" apply "$projA/.postmaster/runs" "$FIX" --tool "$tool" >/dev/null 2>"$tmp/err"
[ "$(git -C "$projA" rev-parse tE)" = "$before" ] \
  && ok "and its branch is left untouched" \
  || fail "and its branch is left untouched"

echo "a runbook fix mid-leg reaches at the next leg"
tool2="$tmp/tool2"
mkdir -p "$tool2/skills/postmaster"
git -C "$tool2" init -q -b main
git -C "$tool2" config user.email self@test
git -C "$tool2" config user.name self-test
echo "old" > "$tool2/skills/postmaster/coachman.md"
git -C "$tool2" add -A
git -C "$tool2" commit -qm base
echo "new" > "$tool2/skills/postmaster/coachman.md"
git -C "$tool2" commit -qam "fix the runbook"
FIX2=$(git -C "$tool2" rev-parse HEAD)
projC="$tmp/projC"
mkdir -p "$projC/src" "$projC/.postmaster/runs/tF/logs"
git -C "$projC" init -q -b main
git -C "$projC" config user.email self@test
git -C "$projC" config user.name self-test
echo "app" > "$projC/src/app.py"
git -C "$projC" add -A
git -C "$projC" commit -qm base
git -C "$projC" checkout -qb tF
cat > "$projC/.postmaster/runs/tF/manifest.json" <<'EOF'
{"stage": "review", "leg": 2, "lanes": {}}
EOF
: > "$projC/.postmaster/runs/tF/.leg-1-done"
out=$("$SELF" report "$projC/.postmaster/runs" "$FIX2" --tool "$tool2" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tF  *next-leg" \
  && ok "a runbook fix on a run mid-leg is next-leg" \
  || fail "a runbook fix on a run mid-leg is next-leg (exit $rc)" "$out$(cat "$tmp/err")"
printf '%s\n' "$out" | grep -q "checkout" && printf '%s\n' "$out" | grep -q "next-leg" \
  || true

echo "logging"
grep -q '"action":"apply"' "$projA/.postmaster/runs/ledger.jsonl" 2>/dev/null \
  && ok "the ledger records each fix commit it applied" \
  || fail "the ledger records each fix commit it applied" "$(cat "$projA/.postmaster/runs/ledger.jsonl" 2>/dev/null)"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
