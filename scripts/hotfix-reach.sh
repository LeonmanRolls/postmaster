#!/usr/bin/env bash
# How a hotfix on postmaster's main reaches every run in flight, and putting it there.
# A fix reaches a run through the checkout the run calls postmaster from where it can,
# and as the fix commit alone where it cannot, never as a merge of main into a run's
# branch. The hotfix skill (skills/hotfix/SKILL.md) is the journey this script is the
# deterministic half of: report first, queue, and the postmaster applies at each leg
# boundary before launching the next leg.
#
#   hotfix-reach.sh report <fix-commit> [root ...] [--tool <repo>]
#       one line per run in flight: the run, how the fix reaches it (checkout, branch,
#       next-leg or conflict), and what that means. checkout: through the tool checkout
#       the run calls, nothing on its branches. branch: as the fix commit alone on the
#       run's branches that carry their own copy of a fixed file, at the next leg
#       boundary. next-leg: a fixed file is a runbook the current leg has already read;
#       the next leg's prompt is told. conflict: a branch changed the same lines of a
#       fixed file; that branch is left untouched and named.
#   hotfix-reach.sh queue <fix-commit> [root ...] [--tool <repo>]
#       record what each run needs in its dispatch, without touching a branch: a managed
#       pin that does not yet serve the fix gets the fix commit alone at once (the way a
#       pulled main checkout already serves it); branch commits wait for the run's next
#       stop between legs. A run mid-leg keeps its queued work until its boundary.
#   hotfix-reach.sh next-leg <dispatch> <leg> <prompt-file> [--tool <repo>]
#       at the hand-off boundary, apply one dispatch's queued fix commits alone and add
#       the main-fix note to the next leg's prompt. The postmaster runs this before
#       launching each leg; it refuses a leg that has already started, a branch with
#       uncommitted changes, and any advance past a leg with no completed hand-off,
#       and it never merges main into the run. Every entry is checked before the
#       first apply, so a refusal moves nothing; each branch is classified fresh
#       at the boundary, branches that appeared since queue included, and lands in
#       exactly one list.
#   hotfix-reach.sh --self-test
#
# <fix-commit> is the one non-merge commit on main that carries the fix, subject
# "#<ticket>, <title>". Each root is a project root or a runs directory, walked for run
# directories; with none, the machine config's projects_roots plus the tool checkout.
# --tool names the postmaster checkout that holds the fix (default: this script's own
# repo). A run is in flight when its manifest's stage is neither done nor abandoned.
# A branch is concerned by the fix when it carries a fixed file or deleted one:
# the file in the branch tree, or gone at the tip but present at the merge-base
# of the branch and the fix. Gone at the base means the branch never carried it,
# so there is nothing to create; with no shared history the branch's own history
# touching the file stands in for the base. One content-first verdict classifies every
# concerned branch: a trial pick of the fix onto the branch's tip, in a scratch,
# with no history shortcut. An unchanged tree means has-fix, a clean pick means
# needs, any conflict, modify/delete included, means conflicts; that branch is
# left alone and named, and whichever merges second resolves the conflict. The
# pick is fetched from the tool when the branch's repo does not hold it; when the
# fix cannot be fetched the branch verdict is unknown and the tool stops with
# that reason before any write, never guessing from history. The boundary verdict
# supersedes the queue-time one: the notes and the prompt state only final
# outcomes, and the record is keyed by fix and branch, a row rewritten on every
# verdict, never trusting the fix's presence. A stop between legs is a completed
# hand-off, .done plus a hand-off
# that checks clean; an exited leg without one is a remount, not a boundary, and
# advancing always needs the completed hand-off, even before the first bootstrap.
# Pin fixes are recorded beside the pin as <dispatch-commit>.fixes, one "<pin-sha>
# <fix-sha>" pair per fix it applied, so run-meta.sh check still accepts the checkout;
# a row counts only while its pin is still in the pin's history, so a reset or
# re-cut pin is served again. A run outside a recognized runs folder, such as the
# legacy runs/<project>/<ticket> layout, reports unknown and still takes the fix on
# its pinned checkout at queue time; no branch work can be found for it.
# Every step is logged through log-action.sh, to the run and to the project ledger.
#
#   exit 0  printed; queue/next-leg: every fix queued, landed, waited or rightly left alone
#   exit 1  usage, no such root or commit, a refused preflight, or a step failed
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
TOOL_DEFAULT=$(dirname "$HERE")
TOOLS=${POSTMASTER_TOOL_PINS:-$HOME/.postmaster/tool-pins}
usage() { echo "usage: hotfix-reach.sh report <fix-commit> [root ...] [--tool <repo>] | queue <fix-commit> [root ...] [--tool <repo>] | next-leg <dispatch> <leg> <prompt-file> [--tool <repo>] | --self-test" >&2; exit 1; }

run_py() {  # run_py <command> <tool> <args...>
  python3 - "$HERE" "$TOOLS" "$@" <<'PY'
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib

HERE = pathlib.Path(sys.argv[1])
TOOLS = pathlib.Path(sys.argv[2]).resolve() if sys.argv[2] else pathlib.Path(sys.argv[2])
CMD = sys.argv[3]
TOOL = pathlib.Path(sys.argv[4])
ARGS = sys.argv[5:]

SCRIPT_ROOT = HERE.parent
TERMINAL = {"done", "abandoned"}
PRUNED = {".git", ".worktrees", "node_modules", ".venv", "venv", "vendor"}
PENDING = ".hotfix-pending.json"
APPLIED = ".hotfix-applied.json"
SUBJECT = re.compile(r"#([0-9]+),\s*(.+)$")
RUNBOOK_PREFIX = "skills/postmaster/"


class HotfixError(Exception):
    pass


def git(where, *args, check=True):
    p = subprocess.run(["git", "-C", str(where), *map(str, args)],
                       capture_output=True, text=True)
    if check and p.returncode:
        detail = (p.stderr or p.stdout).strip().splitlines()
        raise HotfixError("git %s in %s failed: %s"
                          % (" ".join(map(str, args[:4])), where,
                             detail[0][:300] if detail else "exit %d" % p.returncode))
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def canon(path):
    return pathlib.Path(path).expanduser().resolve()


def utcnow():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_action(dispatch, actor, action, target, detail):
    script = SCRIPT_ROOT / "scripts" / "log-action.sh"
    if not script.is_file():
        raise HotfixError("cannot log hotfix action; missing %s" % script)
    p = subprocess.run([str(script), str(dispatch), actor, action, target, detail],
                       capture_output=True, text=True)
    if p.returncode:
        raise HotfixError("log-action failed for %s: %s"
                          % (dispatch, (p.stderr or p.stdout).strip()[:300]))


def ensure_hotfix_dir(tool):
    d = tool / ".postmaster" / "runs" / "hotfix"
    d.mkdir(parents=True, exist_ok=True)
    return d


def require_tool(tool):
    tool = canon(tool)
    rc, top, _ = git(tool, "rev-parse", "--show-toplevel", check=False)
    if rc or top != str(tool):
        raise HotfixError("tool checkout is not the top of a git repository: %s" % tool)
    return tool


def fix_details(tool, commit):
    rc, full, _ = git(tool, "rev-parse", "--verify", "%s^{commit}" % commit, check=False)
    if rc or not full:
        raise HotfixError("no such fix commit in %s: %s" % (tool, commit))
    _, parents, _ = git(tool, "rev-list", "--parents", "-n", "1", full)
    fields = parents.split()
    if len(fields) != 2:
        raise HotfixError("%s is not one fix commit; pass the commit that changes the "
                          "files, not a merge commit" % full[:12])
    _, subject, _ = git(tool, "show", "-s", "--format=%s", full)
    m = SUBJECT.match(subject)
    if not m:
        raise HotfixError("fix commit subject must start with #<ticket>, <title>: %s" % subject)
    rc, main, _ = git(tool, "rev-parse", "--verify", "-q", "refs/heads/main", check=False)
    if rc or not main:
        raise HotfixError("the tool checkout has no main branch to check the fix against")
    rc, _, _ = git(tool, "merge-base", "--is-ancestor", full, "refs/heads/main", check=False)
    if rc:
        raise HotfixError("fix %s is not on main; merge it and pull first" % full[:12])
    parent = fields[1]
    _, raw_paths, _ = git(tool, "diff-tree", "--no-commit-id", "--name-only", "-r", "-M",
                           parent, full)
    paths = sorted(set(p for p in raw_paths.splitlines() if p))
    if not paths:
        raise HotfixError("fix %s changes no files" % full[:12])
    return {"commit": full, "short": full[:12], "parent": parent, "paths": paths,
            "subject": subject, "ticket": "#" + m.group(1), "title": m.group(2).strip()}


def configured_roots(tool, given):
    roots = []
    for g in given:
        c = canon(g)
        if not c.is_dir():
            raise HotfixError("no such project root: %s" % g)
        roots.append(c)
    if not roots:
        cfg = pathlib.Path(os.environ.get("POSTMASTER_CONFIG",
                                          pathlib.Path.home() / ".postmaster/config.toml")).expanduser()
        if not cfg.is_file():
            raise HotfixError("no project roots were supplied and no machine config "
                              "exists at %s" % cfg)
        try:
            data = tomllib.load(open(cfg, "rb"))
        except (OSError, tomllib.TOMLDecodeError) as e:
            raise HotfixError("cannot read project roots from %s: %s" % (cfg, e))
        for p in data.get("projects_roots", []):
            if isinstance(p, str) and p.strip() and canon(p).is_dir():
                roots.append(canon(p))
        if not roots:
            raise HotfixError("the machine config names no readable projects_roots; "
                              "pass project roots explicitly")
    if tool.is_dir() and tool not in roots:
        roots.append(tool)
    unique, seen = [], set()
    for r in roots:
        if r not in seen:
            unique.append(r)
            seen.add(r)
    return unique


def run_dirs(root):
    found = []
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in PRUNED)
        path = pathlib.Path(current)
        if ({"run.json", "manifest.json"} & set(files)) and path.name not in {"", "."}:
            parent = path.parent.name
            grand = path.parent.parent.name if len(path.parents) > 1 else ""
            if parent == "runs" or grand == "runs":
                found.append(path.resolve())
                dirs[:] = []
    return found


def project_for(dispatch):
    p = dispatch.resolve()
    if p.parent.name == "runs" and p.parent.parent.name == ".postmaster":
        return p.parent.parent.parent
    return None


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def active_runs(roots):
    found, seen = [], set()
    for root in roots:
        for dispatch in run_dirs(root):
            if dispatch in seen:
                continue
            seen.add(dispatch)
            manifest = read_json(dispatch / "manifest.json")
            run = read_json(dispatch / "run.json")
            stage = (manifest or {}).get("stage") or ""
            if stage in TERMINAL:
                continue
            found.append({"dispatch": dispatch, "manifest": manifest, "run": run,
                          "stage": stage})
    return sorted(found, key=lambda x: str(x["dispatch"]))


def stage_of(dispatch):
    try:
        return json.loads((dispatch / "manifest.json").read_text()).get("stage") or ""
    except (OSError, ValueError, AttributeError):
        return ""


def lanes_of(dispatch):
    try:
        lanes = json.loads((dispatch / "manifest.json").read_text()).get("lanes") or {}
        return sorted(lanes.keys())
    except (OSError, ValueError, AttributeError):
        return []


def handoff_ok(dispatch, leg):
    handoff = dispatch / ("handoff-%d.md" % leg)
    if not handoff.is_file():
        return False
    checker = SCRIPT_ROOT / "scripts" / "handoff-check.sh"
    if not checker.is_file():
        return False
    p = subprocess.run([str(checker), str(handoff)], capture_output=True, text=True)
    return p.returncode == 0


def at_boundary(dispatch, manifest):
    try:
        leg = int((manifest or {}).get("leg", 0))
    except (TypeError, ValueError):
        return False
    stage = (manifest or {}).get("stage") or ""
    if stage in ("", "dispatched") or leg <= 0:
        return True
    return leg_completed(dispatch, leg)


def leg_completed(dispatch, leg):
    # A leg is complete only on .done plus a hand-off that checks clean. An
    # exited leg without one is a remount, not a boundary, at every stage:
    # advancing past it without a hand-off is never allowed.
    return (dispatch / (".leg-%d-done" % leg)).exists() and handoff_ok(dispatch, leg)


def run_branches(dispatch, repo):
    ticket = dispatch.name
    names = [ticket]
    for lane in lanes_of(dispatch):
        names.append("wb/%s-%s" % (ticket, lane))
    for ln in git(repo, "for-each-ref", "--format=%(refname:short)",
                  "refs/heads/wb/" + ticket + "-*")[1].splitlines():
        if ln and ln not in names:
            names.append(ln)
    return [n for n in names
            if git(repo, "rev-parse", "--verify", "-q", "refs/heads/" + n, check=False)[0] == 0]


def branch_carries(repo, branch, path):
    return git(repo, "cat-file", "-e", "%s:%s" % (branch, path), check=False)[0] == 0


def patch_text(tool, fix):
    rc, out, err = git(tool, "format-patch", "-1", fix["commit"], "--stdout", check=False)
    if rc or not out:
        raise HotfixError("cannot export fix %s as a patch: %s"
                          % (fix["short"], (err or out).strip()[:200]))
    return out


def outside_patch(patch):
    fd, name = tempfile.mkstemp(prefix="hotfix-reach-", suffix=".patch")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(patch)
    return pathlib.Path(name)


def ensure_fix_object(repo, tool, fix):
    """Fetch the fix commit into REPO from the tool repo when missing. Returns
    (True, "") or (False, why)."""
    if git(repo, "cat-file", "-e", fix["commit"], check=False)[0] == 0:
        return True, ""
    code, out, err = git(repo, "fetch", "-q", str(tool), fix["commit"], check=False)
    if code == 0 and git(repo, "cat-file", "-e", fix["commit"], check=False)[0] == 0:
        return True, ""
    why = (err or out or "fetch failed").splitlines()
    return False, why[-1][:200]


def pick_empty(where):
    return git(where, "diff", "--cached", "--quiet", check=False)[0] == 0


def abort_pick(where):
    git(where, "cherry-pick", "--quit", check=False)
    restore_clean(where)


def classify_branch(repo, branch, tool, fix, patch):
    """One content-first verdict for BRANCH: has-fix, needs, or conflicts. A
    trial pick of the fix onto the branch's tip, in a scratch, decides
    everything, with no history shortcut: an unchanged tree means has-fix, a
    clean pick means needs, any conflict, modify/delete included, means
    conflicts. When the fix object cannot be fetched the verdict is unknown
    and the tool stops, refusing to guess from history."""
    ok, why = ensure_fix_object(repo, tool, fix)
    if not ok:
        raise HotfixError("cannot classify branch %s: fix %s is not in its repo and "
                          "cannot be fetched from the tool (%s); verdict unknown, "
                          "refusing to guess from history"
                          % (branch, fix["short"], why))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="hotfix-reach-"))
    try:
        if git(repo, "worktree", "add", "--detach", str(tmp), branch, check=False)[0]:
            return "conflicts"
        if git(tmp, "cherry-pick", "--no-commit", fix["commit"], check=False)[0]:
            abort_pick(tmp)
            return "conflicts"
        empty = pick_empty(tmp)
        abort_pick(tmp)
        return "has-fix" if empty else "needs"
    finally:
        git(repo, "worktree", "remove", "--force", str(tmp), check=False)
        shutil.rmtree(tmp, ignore_errors=True)


def land_fix(where, repo, tool, fix, patch):
    """Stage the fix's changes on the worktree at WHERE for the caller to commit.
    Returns (True, how) with changes staged, or (False, why) with the tree
    restored. The same method classify_branch chose, so a needs verdict lands."""
    ok, _ = ensure_fix_object(repo, tool, fix)
    if ok:
        if git(where, "cherry-pick", "--no-commit", fix["commit"], check=False)[0]:
            abort_pick(where)
            return False, "conflict"
        if pick_empty(where):
            abort_pick(where)
            return False, "conflict"
        return True, "pick"
    p = outside_patch(patch)
    try:
        if git(where, "apply", str(p), check=False)[0]:
            restore_clean(where)
            return False, "conflict"
        return True, "patch"
    finally:
        p.unlink(missing_ok=True)


def branch_deleted(repo, branch, fix, path):
    """Whether BRANCH itself deleted PATH: gone at the tip but present at the
    merge-base of the branch and the fix. Gone at the base means the branch
    never carried it, so there is nothing to create. When the branch and the
    fix share no readable history there is no base, and the branch's own
    history touching the file is the only evidence of a delete."""
    if branch_carries(repo, branch, path):
        return False
    code, base, _ = git(repo, "merge-base", branch, fix["commit"], check=False)
    if code or not base:
        _, touched, _ = git(repo, "log", "--format=%H", "-1", branch, "--", path,
                              check=False)
        return bool(touched.strip())
    return git(repo, "cat-file", "-e", "%s:%s" % (base, path), check=False)[0] == 0


def concerns(repo, branch, fix):
    return any(branch_carries(repo, branch, f) or branch_deleted(repo, branch, fix, f)
               for f in fix["paths"])


def classify(repo, info, tool, fix, patch):
    branches = run_branches(info["dispatch"], repo)
    carries = [b for b in branches if concerns(repo, b, fix)]
    runbook = any(p.startswith(RUNBOOK_PREFIX) for p in fix["paths"])
    mid = not at_boundary(info["dispatch"], info["manifest"])
    needs, skipped, done = [], [], []
    for b in carries:
        verdict = classify_branch(repo, b, tool, fix, patch)
        if verdict == "has-fix":
            done.append(b)
        elif verdict == "conflicts":
            skipped.append(b)
        else:
            needs.append(b)
    if skipped:
        return {"reach": "conflict", "needs": needs, "skipped": skipped, "done": done,
                "runbook": runbook,
                "detail": "branch changed the same lines on %s; left untouched"
                          % ", ".join(skipped)}
    if runbook and mid:
        return {"reach": "next-leg", "needs": needs, "skipped": [], "done": done,
                "runbook": True,
                "detail": "runbook already read; reaches at the next leg"
                          + ("; fix commit for %s" % ", ".join(needs) if needs else "")}
    if carries:
        if not needs:
            return {"reach": "branch", "needs": [], "skipped": [], "done": done,
                    "runbook": runbook, "detail": "fix already on %s" % ", ".join(done)}
        return {"reach": "branch", "needs": needs, "skipped": [], "done": done,
                "runbook": runbook,
                "detail": "fix commit on %s, at the next leg boundary" % ", ".join(needs)}
    return {"reach": "checkout", "needs": [], "skipped": [], "done": [],
            "runbook": runbook,
            "detail": "through the checkout it calls postmaster from, nothing more to do"}


def pin_of(dispatch):
    try:
        r = json.loads((dispatch / "run.json").read_text())
        co = (r.get("postmaster") or {}).get("checkout") or ""
        return canon(co) if co else None
    except (OSError, ValueError, AttributeError):
        return None


def dispatch_commit(dispatch):
    try:
        r = json.loads((dispatch / "run.json").read_text())
        return (r.get("postmaster") or {}).get("commit") or ""
    except (OSError, ValueError, AttributeError):
        return ""


def pin_is_managed(pin, tool):
    return pin is not None and pin.is_dir() and pin != tool and pin.parent == TOOLS


def fixes_file(pin, commit):
    return pin.parent / (commit + ".fixes")


def pin_serves_fix(pin, commit, fix):
    f = fixes_file(pin, commit)
    if not f.is_file():
        return False
    for ln in f.read_text(encoding="utf-8").splitlines():
        fields = ln.split()
        if len(fields) == 2 and fields[1] == fix["commit"]:
            # The record alone is not evidence: a pin reset to its dispatch
            # commit, or one release removed and a later dispatch re-cut, keeps
            # the row while losing the fix. The recorded pin must still be in
            # the pin's history.
            if git(pin, "merge-base", "--is-ancestor", fields[0], "HEAD",
                   check=False)[0] == 0:
                return True
    return False


def record_pin_fix(pin, commit, pin_sha, fix):
    f = fixes_file(pin, commit)
    with open(f, "a", encoding="utf-8") as fh:
        fh.write("%s %s\n" % (pin_sha, fix["commit"]))


def fix_message(fix):
    return ("Main's fix %s: %s\n\nCherry-picked alone from main for this run; this is "
            "main's fix,\nnot this run's own work. Never a merge of main.\n"
            % (fix["short"], fix["subject"]))


def restore_clean(where):
    git(where, "reset", "-q", "--hard", "HEAD", check=False)
    git(where, "clean", "-fdq", check=False)


def apply_on_pin(pin, commit, tool, fix, patch):
    if git(pin, "rev-parse", "--verify", "-q", "HEAD", check=False)[0]:
        return None, "not a checkout"
    if git(pin, "status", "--porcelain", check=False)[1].strip():
        return None, "checkout dirty"
    ok, how = land_fix(pin, pin, tool, fix, patch)
    if not ok:
        return None, how
    git(pin, "add", "-A", check=False)
    if git(pin, "commit", "-m", fix_message(fix), check=False)[0]:
        abort_pick(pin)
        return None, "commit failed"
    new = git(pin, "rev-parse", "HEAD", check=False)[1]
    if not new:
        abort_pick(pin)
        return None, "no commit"
    record_pin_fix(pin, commit, new, fix)
    return new, "pin"


def live_worktree(repo, branch):
    want = "branch refs/heads/" + branch
    wt = None
    for ln in git(repo, "worktree", "list", "--porcelain", check=False)[1].splitlines():
        if ln.startswith("worktree "):
            wt = pathlib.Path(ln[len("worktree "):])
        elif ln == want and wt is not None:
            return wt if wt.is_dir() else None
        elif not ln.strip():
            wt = None
    return None


def apply_on_branch(repo, branch, tool, fix, patch):
    msg = fix_message(fix)
    wt = live_worktree(repo, branch)
    if wt is not None:
        if git(wt, "status", "--porcelain", check=False)[1].strip():
            return None, "worktree dirty"
        ok, how = land_fix(wt, repo, tool, fix, patch)
        if not ok:
            return None, how
        git(wt, "add", "-A", check=False)
        if git(wt, "commit", "-m", msg, check=False)[0]:
            abort_pick(wt)
            return None, "commit failed"
        new = git(wt, "rev-parse", "HEAD", check=False)[1]
        return (new, "worktree") if new else (None, "no commit")
    old = git(repo, "rev-parse", branch, check=False)[1]
    if not old:
        return None, "branch gone"
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="hotfix-reach-"))
    try:
        if git(repo, "worktree", "add", "--detach", str(tmp), branch, check=False)[0]:
            return None, "no scratch"
        ok, how = land_fix(tmp, repo, tool, fix, patch)
        if not ok:
            return None, how
        git(tmp, "add", "-A", check=False)
        if git(tmp, "commit", "-m", msg, check=False)[0]:
            return None, "commit failed"
        new = git(tmp, "rev-parse", "HEAD", check=False)[1]
        if not new:
            return None, "no commit"
        if git(repo, "update-ref", "refs/heads/" + branch, new, old,
               check=False)[0]:
            return None, "branch moved"
        return new, "scratch"
    finally:
        git(repo, "worktree", "remove", "--force", str(tmp), check=False)
        shutil.rmtree(tmp, ignore_errors=True)


def pending_of(dispatch):
    data = read_json(dispatch / PENDING) or {}
    commits = data.get("commits")
    return commits if isinstance(commits, list) else []


def write_pending(dispatch, commits):
    write_json(dispatch / PENDING, {"commits": commits})


def record_applied(dispatch, source, branch_commits, skipped, leg, prompt):
    """Record one verdict in the applied file, keyed by fix and branch: the
    row is rewritten on every verdict, never trusted from the fix's presence."""
    data = read_json(dispatch / APPLIED) or {}
    rows = data.get("commits")
    rows = rows if isinstance(rows, list) else []
    row = next((x for x in rows
                if isinstance(x, dict) and x.get("source") == source), None)
    if row is None:
        row = {"source": source, "branch_commits": {}, "skipped_conflict": [],
               "leg": leg, "prompt": prompt, "at": utcnow()}
        rows.append(row)
    commits = row.get("branch_commits")
    if not isinstance(commits, dict):
        commits = {}
        row["branch_commits"] = commits
    conflicts = row.get("skipped_conflict")
    if not isinstance(conflicts, list):
        conflicts = []
        row["skipped_conflict"] = conflicts
    for branch, rev in branch_commits.items():
        commits[branch] = rev
        while branch in conflicts:
            conflicts.remove(branch)
    for branch in skipped:
        if branch in commits:
            del commits[branch]
        if branch not in conflicts:
            conflicts.append(branch)
    row["skipped_conflict"] = sorted(conflicts)
    row["leg"] = leg
    row["prompt"] = prompt
    row["at"] = utcnow()
    write_json(dispatch / APPLIED, {"commits": rows})


def note_lines(fix, applied, skipped, runbook_only):
    if runbook_only:
        return ["- Main's fix %s (`%s`) is a runbook fix with no copy on this run's "
                "branches; the next leg reads the fixed runbook. It is main's fix, not "
                "this run's work.\n" % (fix["short"], fix["subject"])]
    lines = []
    for branch, sha in sorted(applied.items()):
        lines.append("- Main's fix %s (`%s`) was applied alone as %s on branch %s. It "
                     "is main's fix, not this run's work.\n"
                     % (fix["short"], fix["subject"], sha[:12], branch))
    for branch in sorted(skipped):
        lines.append("- Main's fix %s (`%s`) conflicts with branch %s, which changed "
                     "the same lines and was left untouched; whichever merges second "
                     "resolves it.\n" % (fix["short"], fix["subject"], branch))
    return lines


def write_hotfix_notes(dispatch, fix, applied, skipped, runbook_only):
    note = dispatch / "hotfix-notes.md"
    lines = note_lines(fix, applied, skipped, runbook_only)
    if not note.is_file():
        note.write_text("# Hotfix notes\n\n" + "".join(lines), encoding="utf-8")
        return
    text = note.read_text(encoding="utf-8")
    if runbook_only:
        # Branchless and identical every time: presence is completeness.
        if "".join(lines) not in text:
            note.write_text(text + "".join(lines), encoding="utf-8")
        return
    kept = []
    for ln in text.splitlines(keepends=True):
        if ("Main's fix %s" % fix["short"]) in ln and (
                "branch " not in ln or any(
                    ("on branch %s. " % b) in ln
                    or ln.rstrip("\n").endswith("on branch %s." % b)
                    or ("with branch %s," % b) in ln
                    for b in list(applied) + list(skipped))):
            continue
        kept.append(ln)
    note.write_text("".join(kept) + "".join(lines), encoding="utf-8")


def append_prompt_note(dispatch, fix, prompt):
    markers = []
    note = dispatch / "hotfix-notes.md"
    if note.is_file():
        for ln in note.read_text(encoding="utf-8").splitlines():
            if ln.startswith("- Main's fix ") and fix["short"] in ln:
                markers.append(ln[2:])
    if not markers:
        markers = ["Main's fix %s (`%s`) reached this run; see hotfix-notes.md." % (
            fix["short"], fix["subject"])]
    kept = [ln for ln in prompt.read_text(encoding="utf-8").splitlines()
            if not (ln.startswith("Note: ") and fix["short"] in ln)]
    body = "\n".join(kept).rstrip("\n")
    head = body + "\n\n" if body else ""
    prompt.write_text(head + "Note: " + " ".join(markers)
                      + " Do not merge main into the run branch.\n", encoding="utf-8")


def describe(dispatch, project, stage, reach, detail):
    name = dispatch.name
    if project is not None:
        name = "%s/%s" % (project.name, name)
    return "%-24s %-10s %s" % (name, reach, detail)


def do_report(tool, fix_commit, roots):
    tool = require_tool(tool)
    fix = fix_details(tool, fix_commit)
    patch = patch_text(tool, fix)
    runs = active_runs(configured_roots(tool, roots))
    master = ensure_hotfix_dir(tool)
    print("%-24s %-10s %s" % ("RUN", "REACH", "WHAT"))
    counts = {"checkout": 0, "branch": 0, "next-leg": 0, "conflict": 0, "unknown": 0}
    for info in runs:
        dispatch = info["dispatch"]
        if not isinstance(info["run"], dict) or not info["manifest"]:
            line = describe(dispatch, None, info["stage"], "unknown",
                            "run.json or manifest.json is missing or unreadable")
            print(line)
            counts["unknown"] += 1
            continue
        repo = project_for(dispatch)
        if repo is None:
            line = describe(dispatch, None, info["stage"], "unknown",
                            "run directory is not under a recognized runs folder")
            print(line)
            counts["unknown"] += 1
            continue
        result = classify(repo, info, tool, fix, patch)
        line = describe(dispatch, repo, info["stage"], result["reach"], result["detail"])
        print(line)
        counts[result["reach"]] += 1
        log_action(dispatch, "postmaster", "note", fix["commit"],
                   "hotfix report: reach=%s; %s" % (result["reach"], result["detail"]))
    if not runs:
        print("no in-flight runs")
    log_action(master, "postmaster", "note", fix["commit"],
               "hotfix report covered %d in-flight run(s)" % len(runs))
    print("totals: %d checkout, %d branch, %d next-leg, %d conflict, %d unknown"
          % (counts["checkout"], counts["branch"], counts["next-leg"], counts["conflict"],
             counts["unknown"]))
    return 0


def queue_pin_side(dispatch, fix, patch):
    pin = pin_of(dispatch)
    if pin is None or not pin.is_dir():
        return
    if not pin_is_managed(pin, TOOL):
        return
    commit = dispatch_commit(dispatch)
    if not commit:
        log_action(dispatch, "postmaster", "note", fix["commit"],
                   "hotfix pin has no recorded dispatch commit; left alone")
        return
    if pin_serves_fix(pin, commit, fix):
        return
    new, how = apply_on_pin(pin, commit, TOOL, fix, patch)
    if new:
        log_action(dispatch, "postmaster", "apply", str(pin),
                   "main's fix %s on the run's checkout (%s)" % (fix["short"], how))
        print("%s: checkout <- main's fix %s (%s)" % (dispatch.name, fix["short"], how))
    else:
        log_action(dispatch, "postmaster", "note", fix["commit"],
                   "hotfix pin %s: %s; left alone" % (fix["short"], how))
        print("%s: checkout %s; left alone" % (dispatch.name, how))


def do_queue(tool, fix_commit, roots):
    tool = require_tool(tool)
    fix = fix_details(tool, fix_commit)
    patch = patch_text(tool, fix)
    runs = active_runs(configured_roots(tool, roots))
    master = ensure_hotfix_dir(tool)
    queued = 0
    for info in runs:
        dispatch = info["dispatch"]
        if not isinstance(info["run"], dict) or not info["manifest"]:
            log_action(dispatch, "postmaster", "note", fix["commit"],
                       "hotfix queue: run.json or manifest.json unreadable; left alone")
            print("%s: unknown; left alone" % dispatch.name)
            continue
        repo = project_for(dispatch)
        if repo is None:
            # A run outside a recognized runs folder, such as the legacy
            # runs/<project>/<ticket> layout: no branch work can be found for
            # it, but its pinned checkout still takes the fix at once.
            queue_pin_side(dispatch, fix, patch)
            log_action(dispatch, "postmaster", "note", fix["commit"],
                       "hotfix queue: project not recognized; branch work "
                       "skipped, pin side handled")
            print("%s: unknown; branch work skipped" % dispatch.name)
            continue
        # Classify before the pin side: an unknown branch verdict stops the run
        # before any write, the pin's included.
        result = classify(repo, info, tool, fix, patch)
        queue_pin_side(dispatch, fix, patch)
        reach = result["reach"]
        if reach == "checkout" and not result["runbook"]:
            log_action(dispatch, "postmaster", "note", fix["commit"],
                       "hotfix %s reaches through the checkout, nothing more to do"
                       % fix["short"])
            print("%s: checkout; nothing more to do" % dispatch.name)
            continue
        if reach == "checkout" and result["runbook"]:
            write_hotfix_notes(dispatch, fix, {}, [], True)
            log_action(dispatch, "postmaster", "note", fix["commit"],
                       "hotfix %s is a runbook fix with no branch copy; noted for the "
                       "next leg" % fix["short"])
            print("%s: runbook fix, no branch copy; noted for the next leg" % dispatch.name)
            continue
        if reach == "conflict":
            log_action(dispatch, "postmaster", "note", fix["commit"],
                       "main hotfix conflict; %s; whichever merges second resolves it"
                       % result["detail"])
            print("%s: %s" % (dispatch.name, result["detail"]))
        if not result["needs"] and not result["runbook"]:
            if reach == "branch":
                log_action(dispatch, "postmaster", "note", fix["commit"],
                           "hotfix %s already on %s; nothing to do"
                           % (fix["short"], ", ".join(result["done"])))
                print("%s: fix already applied; nothing to do" % dispatch.name)
            continue
        pending = pending_of(dispatch)
        if any(isinstance(x, dict) and x.get("fix") == fix["commit"] for x in pending):
            print("%s: already queued" % dispatch.name)
            continue
        pending.append({"fix": fix["commit"], "subject": fix["subject"],
                        "paths": fix["paths"], "branches": result["needs"],
                        "skipped_conflict": result["skipped"], "runbook": result["runbook"],
                        "queued_at": utcnow()})
        write_pending(dispatch, pending)
        queued += 1
        log_action(dispatch, "postmaster", "note", fix["commit"],
                   "queued main hotfix for the next leg boundary: %s"
                   % ", ".join(result["needs"] or ["runbook note"]))
        print("%s: queued for the next leg boundary%s"
              % (dispatch.name,
                 "" if result["needs"]
                 else " (runbook note; no branch carries the fix)"))
    log_action(master, "postmaster", "note", fix["commit"],
               "hotfix propagation queued for %d in-flight run(s)" % queued)
    return 0


def check_boundary(dispatch, manifest, leg):
    try:
        current = int((manifest or {}).get("leg", 0))
    except (TypeError, ValueError):
        raise HotfixError("run manifest has no readable current leg")
    started = not at_boundary(dispatch, manifest)
    if leg == current and started:
        raise HotfixError("leg %d already started; hotfixes are applied only before a "
                          "leg or between legs" % leg)
    if leg != current and leg != current + 1:
        raise HotfixError("leg %d does not follow the manifest leg %d" % (leg, current))
    if leg == current + 1 and not leg_completed(dispatch, current):
        raise HotfixError("leg %d has not reached a completed hand-off boundary; "
                          "hotfixes are applied only between legs" % current)


def do_next_leg(tool, dispatch_s, leg_s, prompt_s):
    tool = require_tool(tool)
    dispatch = canon(dispatch_s)
    prompt = canon(prompt_s)
    if not dispatch.is_dir():
        raise HotfixError("no such dispatch directory: %s" % dispatch)
    if not prompt.is_file() or prompt.parent != dispatch:
        raise HotfixError("next-leg prompt must be an existing file directly in %s" % dispatch)
    try:
        leg = int(leg_s)
        if leg < 1:
            raise ValueError()
    except ValueError:
        raise HotfixError("leg must be a positive whole number")
    manifest = read_json(dispatch / "manifest.json")
    run = read_json(dispatch / "run.json")
    if not manifest or not run:
        raise HotfixError("run.json and manifest.json must be readable")
    check_boundary(dispatch, manifest, leg)
    pending = [x for x in pending_of(dispatch) if isinstance(x, dict) and x.get("fix")]
    if not pending:
        print("hotfix: no queued fixes for leg %d" % leg)
        notes = dispatch / "hotfix-notes.md"
        if notes.is_file():
            shorts = set()
            for ln in notes.read_text(encoding="utf-8").splitlines():
                parts = ln.split()
                if ln.startswith("- Main's fix ") and len(parts) > 3:
                    shorts.add(parts[3])
            for fix_short in sorted(shorts):
                append_prompt_note(dispatch, {"short": fix_short, "subject": ""},
                                   prompt)
            log_action(dispatch, "postmaster", "note", "hotfix-notes.md",
                       "hotfix notes carried into the leg %d prompt" % leg)
        return 0
    repo = project_for(dispatch)
    if repo is None:
        raise HotfixError("run directory is not under a recognized runs folder: %s" % dispatch)
    master = ensure_hotfix_dir(tool)
    remaining = list(pending)
    works = []
    for item in pending:
        fix = fix_details(tool, item["fix"])
        patch = patch_text(tool, fix)
        saved = list(item.get("branches", []))
        branches = [b for b in saved
                    if git(repo, "rev-parse", "--verify", "-q", "refs/heads/" + b,
                           check=False)[0] == 0]
        missing = [b for b in saved if b not in branches]
        branches += [b for b in item.get("skipped_conflict", [])
                     if b not in branches
                     and git(repo, "rev-parse", "--verify", "-q", "refs/heads/" + b,
                             check=False)[0] == 0]
        # Branches created after queue, such as workhorse branches cut while the
        # run was still at dispatched, need the fix as much as the queued ones.
        for b in run_branches(dispatch, repo):
            if b not in branches and concerns(repo, b, fix):
                branches.append(b)
        works.append((item, fix, patch, branches, missing))
    # Preflight: every entry is checked before the first apply, so a refusal
    # moves nothing: no commit, no note, no prompt line, pending intact.
    for item, fix, patch, branches, missing in works:
        if missing:
            raise HotfixError("queued branch %s is gone from %s; resolve by hand"
                              % (", ".join(missing), repo))
        if branches:
            ok, why = ensure_fix_object(repo, tool, fix)
            if not ok:
                raise HotfixError("cannot classify %s: fix %s is not in the project "
                                  "repo and cannot be fetched from the tool (%s); "
                                  "verdict unknown, refusing to guess from history"
                                  % (", ".join(branches), fix["short"], why))
        for b in branches:
            wt = live_worktree(repo, b)
            if wt is not None and git(wt, "status", "--porcelain", check=False)[1].strip():
                raise HotfixError("%s has uncommitted branch changes; clean or resolve "
                                  "them before leg %d" % (b, leg))
    for item, fix, patch, branches, _ in works:
        # The boundary verdict supersedes the queue-time one: each branch is
        # classified fresh, lands in exactly one list, and the notes and the
        # prompt state only these final outcomes.
        applied, skipped = {}, []
        for b in branches:
            verdict = classify_branch(repo, b, tool, fix, patch)
            if verdict == "has-fix":
                applied[b] = git(repo, "rev-parse", b, check=False)[1]
                continue
            if verdict == "conflicts":
                skipped.append(b)
                continue
            new, how = apply_on_branch(repo, b, tool, fix, patch)
            if not new:
                raise HotfixError("could not apply %s alone to %s (%s); the branch was "
                                  "left clean" % (fix["short"], b, how))
            applied[b] = new
            log_action(dispatch, "postmaster", "apply", new,
                       "main's fix %s applied alone to branch %s (%s)"
                       % (fix["commit"], b, how))
            log_action(master, "postmaster", "apply", new,
                       "%s: main's fix %s applied alone to branch %s"
                       % (dispatch.name, fix["commit"], b))
            print("hotfix: applied %s alone to %s as %s" % (fix["short"], b, new[:12]))
        runbook_only = not branches and not applied and not skipped and bool(item.get("runbook"))
        write_hotfix_notes(dispatch, fix, applied, skipped, runbook_only)
        append_prompt_note(dispatch, fix, prompt)
        log_action(dispatch, "postmaster", "note", fix["commit"],
                   "main fix note added to the leg %d prompt" % leg)
        record_applied(dispatch, fix["commit"], applied, skipped, leg, prompt.name)
        remaining = [x for x in remaining if x.get("fix") != fix["commit"]]
        if skipped and not applied:
            print("hotfix: %s left untouched (%s); whichever merges second resolves it"
                  % (dispatch.name, ", ".join(sorted(set(skipped)))))
    write_pending(dispatch, remaining)
    return 0


def main():
    if CMD == "report":
        if len(ARGS) < 1:
            raise HotfixError("usage: hotfix-reach.sh report <fix-commit> [root ...] "
                              "[--tool <repo>]")
        return do_report(TOOL, ARGS[0], ARGS[1:])
    if CMD == "queue":
        if len(ARGS) < 1:
            raise HotfixError("usage: hotfix-reach.sh queue <fix-commit> [root ...] "
                              "[--tool <repo>]")
        return do_queue(TOOL, ARGS[0], ARGS[1:])
    if CMD == "next-leg":
        if len(ARGS) != 3:
            raise HotfixError("usage: hotfix-reach.sh next-leg <dispatch> <leg> "
                              "<prompt-file> [--tool <repo>]")
        return do_next_leg(TOOL, ARGS[0], ARGS[1], ARGS[2])
    raise HotfixError("unknown command: %s" % CMD)


try:
    sys.exit(main())
except HotfixError as e:
    print("hotfix-reach: " + str(e), file=sys.stderr)
    sys.exit(1)
PY
}

if [ "${1:-}" = --self-test ]; then
  [ $# -eq 1 ] || usage
  :
elif [ $# -ge 2 ] && { [ "$1" = report ] || [ "$1" = queue ]; }; then
  cmd=$1; shift
  tool=$TOOL_DEFAULT; pos=()
  while [ $# -gt 0 ]; do
    case $1 in
      --tool) [ $# -ge 2 ] || usage; tool=$2; shift 2 ;;
      *) pos+=("$1"); shift ;;
    esac
  done
  [ "${#pos[@]}" -ge 1 ] || usage
  tool=$(CDPATH= cd -P -- "$tool" 2>/dev/null && pwd -P) \
    || { echo "hotfix-reach: no such tool repo: $tool" >&2; exit 1; }
  run_py "$cmd" "$tool" "${pos[@]}"
  exit $?
elif [ "${1:-}" = next-leg ]; then
  shift
  tool=$TOOL_DEFAULT; pos=()
  while [ $# -gt 0 ]; do
    case $1 in
      --tool) [ $# -ge 2 ] || usage; tool=$2; shift 2 ;;
      *) pos+=("$1"); shift ;;
    esac
  done
  [ "${#pos[@]}" -eq 3 ] || usage
  tool=$(CDPATH= cd -P -- "$tool" 2>/dev/null && pwd -P) \
    || { echo "hotfix-reach: no such tool repo: $tool" >&2; exit 1; }
  run_py next-leg "$tool" "${pos[@]}"
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
export POSTMASTER_TOOL_PINS="$tmp/pins"
mkdir -p "$POSTMASTER_TOOL_PINS"

cmd() {  # cmd <repo> <git args...>
  local where=$1; shift
  git -C "$where" "$@" || { echo "self-test fixture failed: git $*" >&2; exit 1; }
}
nofetch() {  # nofetch <command...>: run with the file transport refused, so a
  # fetch of the fix fails while every local read and commit still works.
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow \
    GIT_CONFIG_VALUE_0=never "$@"
}
new_repo() {  # new_repo <dir>
  mkdir -p "$1"
  git -C "$1" init -q -b main
  git -C "$1" config user.email self@test
  git -C "$1" config user.name self-test
}
dispatch() {  # dispatch <runs-root> <name> <stage> <leg> <lanes-json> [<checkout> <commit>]
  local d=$1/$2
  mkdir -p "$d/logs"
  printf '{"stage": "%s", "leg": %s, "lanes": %s}\n' "$3" "$4" "$5" > "$d/manifest.json"
  if [ $# -ge 7 ]; then
    printf '{"project": "fix", "run": "%s", "postmaster": {"commit": "%s", "checkout": "%s"}}\n' \
      "$2" "$7" "$6" > "$d/run.json"
  else
    printf '{"project": "fix", "run": "%s"}\n' "$2" > "$d/run.json"
  fi
  printf '%s\n' "$d"
}
between_legs() {  # between_legs <dispatch>: leg 1 done with a hand-off that checks clean
  local d=$1
  printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified \
    "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-1.md"
  : > "$d/.leg-1-done"
}

# The tool repo holds the fixes: a postmaster-shaped tree.
tool="$tmp/tool"
new_repo "$tool"
mkdir -p "$tool/scripts" "$tool/skills/postmaster"
echo "old" > "$tool/scripts/foo.sh"
echo "runbook" > "$tool/skills/postmaster/coachman.md"
cmd "$tool" add -A
cmd "$tool" commit -qm base
BASE=$(cmd "$tool" rev-parse HEAD)
echo "new" > "$tool/scripts/foo.sh"
cmd "$tool" commit -qam "#7, Fix foo"
FIX=$(cmd "$tool" rev-parse HEAD)
echo "newer" > "$tool/scripts/foo.sh"
cmd "$tool" commit -qam "#7, Fix foo again"
FIX3=$(cmd "$tool" rev-parse HEAD)
echo "fixed runbook" > "$tool/skills/postmaster/coachman.md"
cmd "$tool" commit -qam "#7, Fix the runbook"
FIX2=$(cmd "$tool" rev-parse HEAD)
cmd "$tool" checkout -qb side "$BASE"
echo "side" > "$tool/scripts/side.sh"
cmd "$tool" add -A
cmd "$tool" commit -qm "#7, Side fix"
cmd "$tool" checkout -q main
cmd "$tool" merge -q --no-ff -m "Merge side" side
MERGE=$(cmd "$tool" rev-parse HEAD)
cmd "$tool" checkout -q side
echo "stranded" > "$tool/scripts/side.sh"
cmd "$tool" commit -qam "#7, Stranded fix"
STRANDED=$(cmd "$tool" rev-parse HEAD)
cmd "$tool" checkout -q main
echo "unrelated" > "$tool/scripts/other.sh"
cmd "$tool" add -A
cmd "$tool" commit -qm "oops no ticket"
BAD=$(cmd "$tool" rev-parse HEAD)
cmd "$tool" commit -q --allow-empty -m "#7, Empty"
EMPTY=$(cmd "$tool" rev-parse HEAD)

# Project A is postmaster-as-target: its runs' branches carry scripts/foo.sh.
projA="$tmp/projA"
new_repo "$projA"
mkdir -p "$projA/scripts" "$projA/skills/postmaster"
echo "old" > "$projA/scripts/foo.sh"
echo "runbook" > "$projA/skills/postmaster/coachman.md"
cmd "$projA" add -A
cmd "$projA" commit -qm base
RUNS_A="$projA/.postmaster/runs"
dA=$(dispatch "$RUNS_A" tA synthesis 1 '{"luna": {}}')
cmd "$projA" checkout -qb tA
cmd "$projA" checkout -qb wb/tA-luna
cmd "$projA" checkout -q tA
dB=$(dispatch "$RUNS_A" tB checkpoint-1 1 '{"luna": {}}')
between_legs "$dB"
cmd "$projA" checkout -qb tB main
cmd "$projA" checkout -qb wb/tB-luna
cmd "$projA" checkout -q tA

# Project B is another target: its run's branch has no scripts/foo.sh.
projB="$tmp/projB"
new_repo "$projB"
mkdir -p "$projB/src"
echo "app" > "$projB/src/app.py"
cmd "$projB" add -A
cmd "$projB" commit -qm base
RUNS_B="$projB/.postmaster/runs"
dC=$(dispatch "$RUNS_B" tC workhorses-running 1 '{}')
cmd "$projB" checkout -qb tC

# A managed pin at the dispatch commit for tB; tA's checkout is unmanaged (the tool).
pinB="$POSTMASTER_TOOL_PINS/$BASE"
cmd "$tool" clone -q "$tool" "$pinB" 2>/dev/null
cmd "$pinB" config user.email self@test
cmd "$pinB" config user.name self-test
cmd "$pinB" checkout -q "$BASE"
printf '{"project": "fix", "run": "tB", "postmaster": {"commit": "%s", "checkout": "%s"}}\n' \
  "$BASE" "$pinB" > "$dB/run.json"
printf '{"project": "fix", "run": "tA", "postmaster": {"commit": "%s", "checkout": "%s"}}\n' \
  "$BASE" "$tool" > "$dA/run.json"

echo "the AC5 control: one command tells apart a run that needs the commit and one that does not"
out=$("$SELF" report "$FIX" "$RUNS_A" "$RUNS_B" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tB  *branch" \
  && ok "a run whose branch carries the fixed file is branch" \
  || fail "a run whose branch carries the fixed file is branch (exit $rc)" "$out$(cat "$tmp/err")"
printf '%s\n' "$out" | grep -q "tC  *checkout" \
  && ok "and the same command says checkout for the run with no copy" \
  || fail "and the same command says checkout for the run with no copy" "$out"
[ "$(cmd "$pinB" rev-parse HEAD)" = "$BASE" ] \
  && ok "report changes nothing on the pin" \
  || fail "report changes nothing on the pin"

echo "roots default to the machine config plus the tool"
printf 'projects_roots = ["%s"]\n' "$projB" > "$tmp/config.toml"
out=$(POSTMASTER_CONFIG="$tmp/config.toml" "$SELF" report "$FIX" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tC  *checkout" \
  && ok "with no roots the config's projects are covered" \
  || fail "with no roots the config's projects are covered (exit $rc)" "$out$(cat "$tmp/err")"

echo "the fix preflight refuses anything but one merged fix commit"
out=$("$SELF" report "$MERGE" "$RUNS_A" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "not one fix commit" \
  && ok "a merge commit is refused" \
  || fail "a merge commit is refused (exit $rc)" "$out"
out=$("$SELF" report "$BAD" "$RUNS_A" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "must start with #<ticket>" \
  && ok "a commit without the ticket subject is refused" \
  || fail "a commit without the ticket subject is refused (exit $rc)" "$out"
out=$("$SELF" report "$STRANDED" "$RUNS_A" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "not on main" \
  && ok "a fix that has not landed on main is refused" \
  || fail "a fix that has not landed on main is refused (exit $rc)" "$out"
out=$("$SELF" report "$EMPTY" "$RUNS_A" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "changes no files" \
  && ok "a fix that changes no files is refused" \
  || fail "a fix that changes no files is refused (exit $rc)" "$out"

echo "queue records branch work, touches no branch, and serves the pin at once"
beforeB=$(cmd "$projA" rev-parse tB)
beforeW=$(cmd "$projA" rev-parse wb/tB-luna)
out=$("$SELF" queue "$FIX" "$RUNS_A" "$RUNS_B" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "queue exits 0 (exit $rc)" "$(cat "$tmp/err")$out"
[ -f "$dB/.hotfix-pending.json" ] && printf '%s\n' "$out" | grep -q "tB: queued" \
  && ok "the run between legs is queued" \
  || fail "the run between legs is queued" "$out"
[ "$(cmd "$projA" rev-parse tB)" = "$beforeB" ] \
  && [ "$(cmd "$projA" rev-parse wb/tB-luna)" = "$beforeW" ] \
  && ok "queue changes no branch" \
  || fail "queue changes no branch"
[ "$(cmd "$pinB" rev-parse HEAD)" != "$BASE" ] \
  && [ "$(cmd "$pinB" log -1 --format=%s)" != "" ] \
  && case "$(cmd "$pinB" log -1 --format=%s)" in "Main's fix "*) true ;; *) false ;; esac \
  && ok "the managed pin serves the fix alone at once" \
  || fail "the managed pin serves the fix alone at once" "$(cmd "$pinB" log -1 --format=%s)"
grep -q " $FIX$" "$POSTMASTER_TOOL_PINS/$BASE.fixes" 2>/dev/null \
  && ok "the pin fix is recorded beside the pin" \
  || fail "the pin fix is recorded beside the pin" "$(cat "$POSTMASTER_TOOL_PINS/$BASE.fixes" 2>/dev/null)"
[ ! -f "$dC/.hotfix-pending.json" ] && printf '%s\n' "$out" | grep -q "tC: checkout" \
  && ok "the run served by its checkout gets no branch work" \
  || fail "the run served by its checkout gets no branch work" "$out"
git -C "$tool" log main --format=%s | grep -q "Main's fix" \
  && fail "the tool checkout itself is never committed onto" \
  || ok "the tool checkout itself is never committed onto"

echo "next-leg applies the fix alone at the boundary and tells the prompt"
prompt="$dB/leg-2-prompt.txt"
printf 'You are the coachman for leg 2.\n' > "$prompt"
out=$("$SELF" next-leg "$dB" 2 "$prompt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "next-leg exits 0 (exit $rc)" "$(cat "$tmp/err")$out"
msg=$(cmd "$projA" log -1 --format=%s tB)
case $msg in "Main's fix "*) ok "the branch commit says it is main's fix" ;; *) fail "the branch commit says it is main's fix" "got: $msg" ;; esac
[ "$(cmd "$projA" rev-parse tB^)" = "$beforeB" ] \
  && [ "$(cmd "$projA" show --format= --name-only tB)" = "scripts/foo.sh" ] \
  && ok "it is one commit with only the fixed file" \
  || fail "it is one commit with only the fixed file"
cmd "$projA" log --oneline tB | grep -qi "merge" \
  && fail "never a merge of main" "$(cmd "$projA" log --oneline tB)" \
  || ok "never a merge of main"
cmd "$projA" log -1 --format=%s wb/tB-luna | grep -q "Main's fix" \
  && ok "every lane branch that carries the file gets it too" \
  || fail "every lane branch that carries the file gets it too"
grep -q "Main's fix ${FIX:0:12}" "$prompt" && grep -q "Do not merge main" "$prompt" \
  && ok "the next leg's prompt names the fix and says not to merge main" \
  || fail "the next leg's prompt names the fix and says not to merge main" "$(cat "$prompt")"
grep -q "applied alone" "$dB/hotfix-notes.md" \
  && ok "hotfix-notes.md records the branch application" \
  || fail "hotfix-notes.md records the branch application" "$(cat "$dB/hotfix-notes.md" 2>/dev/null)"
[ "$(python3 -c "import json;print(len(json.load(open('$dB/.hotfix-pending.json'))['commits']))")" -eq 0 ] \
  && ok "the queued entry is consumed" \
  || fail "the queued entry is consumed" "$(cat "$dB/.hotfix-pending.json")"
grep -q '"action":"apply"' "$dB/actions.jsonl" \
  && grep -q '"action":"apply"' "$RUNS_A/ledger.jsonl" \
  && ok "the fix commit is logged to the run and the project ledger" \
  || fail "the fix commit is logged to the run and the project ledger"

echo "a second fix lands on the same pin"
out=$("$SELF" queue "$FIX3" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "queue of the second fix (exit $rc)" "$(cat "$tmp/err")$out"
[ "$(cmd "$pinB" log --oneline | grep -c "Main's fix")" -eq 2 ] \
  && ok "a pin carrying one recorded fix still takes the next" \
  || fail "a pin carrying one recorded fix still takes the next" "$(cmd "$pinB" log --oneline)"
[ "$(wc -l < "$POSTMASTER_TOOL_PINS/$BASE.fixes")" -eq 2 ] \
  && ok "both fixes are recorded" \
  || fail "both fixes are recorded"
before=$(cmd "$pinB" rev-parse HEAD)
"$SELF" queue "$FIX3" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
[ "$(cmd "$pinB" rev-parse HEAD)" = "$before" ] \
  && ok "re-queueing a served fix changes nothing" \
  || fail "re-queueing a served fix changes nothing"

echo "mid-leg waits: next-leg refuses before the boundary and touches nothing"
printf 'You are the coachman for leg 2.\n' > "$dA/leg-2-prompt.txt"
beforeA=$(cmd "$projA" rev-parse tA)
out=$("$SELF" next-leg "$dA" 2 "$dA/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "completed hand-off boundary" \
  && ok "a hotfix cannot be applied in the middle of a leg" \
  || fail "a hotfix cannot be applied in the middle of a leg (exit $rc)" "$out"
[ "$(cmd "$projA" rev-parse tA)" = "$beforeA" ] \
  && [ "$(cat "$dA/leg-2-prompt.txt")" = "You are the coachman for leg 2." ] \
  && ok "and the mid-leg branch and prompt are untouched" \
  || fail "and the mid-leg branch and prompt are untouched"

echo "a run that already has the fix is left alone"
out=$("$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tB: fix already applied" \
  && ok "re-queueing an applied fix says already applied" \
  || fail "re-queueing an applied fix says already applied" "$out"
[ "$(cmd "$projA" log --oneline tB | grep -c "Main's fix")" -eq 1 ] \
  && ok "and the branch carries exactly one fix commit" \
  || fail "and the branch carries exactly one fix commit"

echo "a run whose branch changed the same lines is named and left untouched"
dE=$(dispatch "$RUNS_A" tE checkpoint-1 1 '{}')
between_legs "$dE"
cmd "$projA" checkout -qb tE main
echo "conflict" > "$projA/scripts/foo.sh"
cmd "$projA" commit -qam "lane changed the same lines"
cmd "$projA" checkout -q tA
out=$("$SELF" report "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tE  *conflict" \
  && ok "the run is named as a conflict" \
  || fail "the run is named as a conflict (exit $rc)" "$out$(cat "$tmp/err")"
beforeE=$(cmd "$projA" rev-parse tE)
out=$("$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ "$(cmd "$projA" rev-parse tE)" = "$beforeE" ] && [ ! -f "$dE/.hotfix-pending.json" ] \
  && printf '%s\n' "$out" | grep -q "tE: branch changed the same lines" \
  && ok "and its branch is left untouched with no queued work" \
  || fail "and its branch is left untouched with no queued work" "$out"

echo "a clean branch still gets the fix when a lane branch conflicts"
dM=$(dispatch "$RUNS_A" tM checkpoint-1 1 '{"luna": {}}')
between_legs "$dM"
cmd "$projA" checkout -qb tM main
cmd "$projA" checkout -qb wb/tM-luna
echo "conflict" > "$projA/scripts/foo.sh"
cmd "$projA" commit -qam "lane changed the same lines"
cmd "$projA" checkout -q tA
out=$("$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tM: branch changed the same lines on wb/tM-luna" \
  && printf '%s\n' "$out" | grep -q "tM: queued" \
  && ok "the conflict is named and the clean branch is queued" \
  || fail "the conflict is named and the clean branch is queued" "$out"
printf 'You are the coachman for leg 2.\n' > "$dM/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dM" 2 "$dM/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] || fail "next-leg on the mixed run (exit $rc)" "$(cat "$tmp/err")$out"
cmd "$projA" log -1 --format=%s tM | grep -q "Main's fix" \
  && ! cmd "$projA" log -1 --format=%s wb/tM-luna | grep -q "Main's fix" \
  && ok "the clean branch gets the commit and the conflicted one does not" \
  || fail "the clean branch gets the commit and the conflicted one does not"
grep -q "left untouched" "$dM/hotfix-notes.md" \
  && ok "and the notes name the branch left untouched" \
  || fail "and the notes name the branch left untouched"

echo "a runbook fix mid-leg reaches at the next leg"
projC="$tmp/projC"
new_repo "$projC"
mkdir -p "$projC/src"
echo "app" > "$projC/src/app.py"
cmd "$projC" add -A
cmd "$projC" commit -qm base
RUNS_C="$projC/.postmaster/runs"
dF=$(dispatch "$RUNS_C" tF review 2 '{}')
cmd "$projC" checkout -qb tF
: > "$dF/.leg-1-done"
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified \
  "Branches and lanes" "Open questions" "Next leg" > "$dF/handoff-1.md"
out=$("$SELF" report "$FIX2" "$RUNS_C" --tool "$tool" 2>"$tmp/err"); rc=$?
printf '%s\n' "$out" | grep -q "tF  *next-leg" \
  && ok "a runbook fix on a run mid-leg is next-leg" \
  || fail "a runbook fix on a run mid-leg is next-leg (exit $rc)" "$out$(cat "$tmp/err")"
out=$("$SELF" queue "$FIX2" "$RUNS_C" --tool "$tool" 2>"$tmp/err"); rc=$?
[ -f "$dF/.hotfix-pending.json" ] \
  && ok "queue holds the runbook fix for the boundary without touching the branch" \
  || fail "queue holds the runbook fix for the boundary without touching the branch" "$out"
[ "$(cmd "$projC" log --oneline tF | wc -l)" -eq 1 ] \
  && ok "and the branch carries no commit" \
  || fail "and the branch carries no commit"
: > "$dF/.leg-2-done"
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified \
  "Branches and lanes" "Open questions" "Next leg" > "$dF/handoff-2.md"
printf '{"stage": "shipping", "leg": 2, "lanes": {}}\n' > "$dF/manifest.json"
printf 'You are the coachman for leg 3.\n' > "$dF/leg-3-prompt.txt"
out=$("$SELF" next-leg "$dF" 3 "$dF/leg-3-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && grep -q "Main's fix ${FIX2:0:12}" "$dF/leg-3-prompt.txt" \
  && grep -q "Do not merge main" "$dF/leg-3-prompt.txt" \
  && ok "the next leg's prompt carries the runbook note" \
  || fail "the next leg's prompt carries the runbook note (exit $rc)" "$out$(cat "$tmp/err")"

echo "a dirty branch stops next-leg before anything moves"
dD=$(dispatch "$RUNS_A" tD checkpoint-1 1 '{}')
between_legs "$dD"
cmd "$projA" checkout -qb tD main
cmd "$projA" checkout -q tA
cmd "$projA" worktree add -q "$tmp/wt-tD" tD
echo "dirty" >> "$tmp/wt-tD/scripts/foo.sh"
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dD/leg-2-prompt.txt"
beforeD=$(cmd "$projA" rev-parse tD)
out=$("$SELF" next-leg "$dD" 2 "$dD/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "uncommitted branch changes" \
  && [ "$(cmd "$projA" rev-parse tD)" = "$beforeD" ] \
  && ok "a dirty branch refuses next-leg with the branch untouched" \
  || fail "a dirty branch refuses next-leg with the branch untouched (exit $rc)" "$out"
cmd "$tmp/wt-tD" checkout -q -- scripts/foo.sh
out=$("$SELF" next-leg "$dD" 2 "$dD/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && cmd "$projA" log -1 --format=%s tD | grep -q "Main's fix" \
  && ok "and applies once the branch is clean" \
  || fail "and applies once the branch is clean (exit $rc)" "$out$(cat "$tmp/err")"

echo "an exited leg without a hand-off is a remount, not a boundary"
dX=$(dispatch "$RUNS_A" tX checkpoint-1 1 '{}')
: > "$dX/.leg-1-exited"
cmd "$projA" checkout -qb tX main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dX/leg-2-prompt.txt"
beforeX=$(cmd "$projA" rev-parse tX)
out=$("$SELF" next-leg "$dX" 2 "$dX/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "completed hand-off boundary" \
  && [ "$(cmd "$projA" rev-parse tX)" = "$beforeX" ] \
  && ok "an exited-only leg refuses next-leg with the branch untouched" \
  || fail "an exited-only leg refuses next-leg with the branch untouched (exit $rc)" "$out"

echo "main commits the branch never saw do not read as conflicts"
toolG="$tmp/toolG"
new_repo "$toolG"
mkdir -p "$toolG/scripts"
printf 'line1\nline2\nline3\n' > "$toolG/scripts/foo.sh"
cmd "$toolG" add -A; cmd "$toolG" commit -qm base
printf 'line1-CHANGED\nline2\nline3\n' > "$toolG/scripts/foo.sh"; cmd "$toolG" commit -qam "#8, Touch line1"
printf 'line1-CHANGED\nline2\nline3-FIXED\n' > "$toolG/scripts/foo.sh"; cmd "$toolG" commit -qam "#9, Fix line3"
FIXG=$(cmd "$toolG" rev-parse HEAD)
projG="$tmp/projG"
new_repo "$projG"
mkdir -p "$projG/scripts"
printf 'line1\nline2\nline3\n' > "$projG/scripts/foo.sh"
cmd "$projG" add -A; cmd "$projG" commit -qm base
RUNS_G="$projG/.postmaster/runs"
dG=$(dispatch "$RUNS_G" tG checkpoint-1 1 '{}')
between_legs "$dG"
cmd "$projG" checkout -qb tG
cmd "$projG" checkout -q main
out=$("$SELF" report "$FIXG" "$RUNS_G" --tool "$toolG" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tG  *branch" \
  && ok "an unchanged branch past an intervening commit is branch, not conflict" \
  || fail "an unchanged branch past an intervening commit is branch, not conflict (exit $rc)" "$out$(cat "$tmp/err")"
"$SELF" queue "$FIXG" "$RUNS_G" --tool "$toolG" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dG/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dG" 2 "$dG/leg-2-prompt.txt" --tool "$toolG" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$(cmd "$projG" show tG:scripts/foo.sh)" = "$(printf 'line1\nline2\nline3-FIXED')" ] \
  && ok "and the applied commit carries the fix on the branch's own lines" \
  || fail "and the applied commit carries the fix on the branch's own lines (exit $rc)" "$out$(cat "$tmp/err")"

echo "a pin that lost its fix is served again"
cmd "$pinB" reset -q --hard "$BASE"
beforeC=$(cmd "$pinB" rev-parse HEAD)
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
[ "$(cmd "$pinB" rev-parse HEAD)" != "$beforeC" ] \
  && [ "$(cmd "$pinB" show HEAD:scripts/foo.sh)" = "new" ] \
  && ok "a pin reset to its dispatch commit takes the fix again" \
  || fail "a pin reset to its dispatch commit takes the fix again"
rm -rf "$pinB"
cmd "$tool" clone -q "$tool" "$pinB" 2>/dev/null
cmd "$pinB" config user.email self@test
cmd "$pinB" config user.name self-test
cmd "$pinB" checkout -q "$BASE"
[ -f "$POSTMASTER_TOOL_PINS/$BASE.fixes" ] || { echo "bad fixture: fixes record gone" >&2; exit 1; }
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
[ "$(cmd "$pinB" rev-parse HEAD)" != "$BASE" ] \
  && cmd "$pinB" log -1 --format=%s | grep -q "Main's fix" \
  && ok "and so does a pin release removed and a later dispatch re-cut" \
  || fail "and so does a pin release removed and a later dispatch re-cut"

echo "notes-only next-leg writes the named prompt, and never mid-leg"
dN=$(dispatch "$RUNS_A" tN checkpoint-1 1 '{}')
between_legs "$dN"
printf '# Hotfix notes\n\n- Main'"'"'s fix %s (`%s`) is a runbook fix with no copy on this run'"'"'s branches.\n' \
  "${FIX2:0:12}" "#7, Fix the runbook" > "$dN/hotfix-notes.md"
printf 'leg 1 prompt\n' > "$dN/leg-1-prompt.txt"
printf 'leg 2 prompt\n' > "$dN/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dN" 2 "$dN/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && grep -q "Main's fix ${FIX2:0:12}" "$dN/leg-2-prompt.txt" \
  && [ "$(cat "$dN/leg-1-prompt.txt")" = "leg 1 prompt" ] \
  && ok "the note lands on the named prompt and no other" \
  || fail "the note lands on the named prompt and no other (exit $rc)" "$out$(cat "$tmp/err")"
dNm=$(dispatch "$RUNS_A" tNm workhorses-running 2 '{}')
cp "$dN/hotfix-notes.md" "$dNm/hotfix-notes.md"
printf 'leg 2 prompt\n' > "$dNm/leg-2-prompt.txt"
printf 'leg 3 prompt\n' > "$dNm/leg-3-prompt.txt"
out=$("$SELF" next-leg "$dNm" 3 "$dNm/leg-3-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "completed hand-off boundary" \
  && [ "$(cat "$dNm/leg-2-prompt.txt")" = "leg 2 prompt" ] \
  && [ "$(cat "$dNm/leg-3-prompt.txt")" = "leg 3 prompt" ] \
  && ok "and a notes-only next-leg mid-leg refuses with both prompts untouched" \
  || fail "and a notes-only next-leg mid-leg refuses with both prompts untouched (exit $rc)" "$out"

echo "a legacy-layout run still takes the fix on its pin"
mkdir -p "$tmp/runs/legacy/RUN-L/logs"
printf '{"stage": "synthesis", "leg": 1, "lanes": {}}\n' > "$tmp/runs/legacy/RUN-L/manifest.json"
pinL="$POSTMASTER_TOOL_PINS/$FIX"
cmd "$tool" clone -q "$tool" "$pinL" 2>/dev/null
cmd "$pinL" config user.email self@test
cmd "$pinL" config user.name self-test
cmd "$pinL" checkout -q "$FIX"
printf '{"project": "legacy", "run": "RUN-L", "postmaster": {"commit": "%s", "checkout": "%s"}}\n' \
  "$FIX" "$pinL" > "$tmp/runs/legacy/RUN-L/run.json"
out=$("$SELF" report "$FIX3" "$tmp/runs" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "RUN-L  *unknown" \
  && ok "a legacy-layout run reports unknown on its branches" \
  || fail "a legacy-layout run reports unknown on its branches (exit $rc)" "$out$(cat "$tmp/err")"
out=$("$SELF" queue "$FIX3" "$tmp/runs" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$(cmd "$pinL" rev-parse HEAD)" != "$FIX" ] \
  && cmd "$pinL" log -1 --format=%s | grep -q "Main's fix" \
  && ok "and queue still serves its pinned checkout alone" \
  || fail "and queue still serves its pinned checkout alone (exit $rc)" "$out$(cat "$tmp/err")"

echo "a lane branch missing from the manifest still gets the fix"
dR=$(dispatch "$RUNS_A" tR checkpoint-1 1 '{}')
between_legs "$dR"
cmd "$projA" checkout -qb tR main
cmd "$projA" checkout -qb wb/tR-luna
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dR/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dR" 2 "$dR/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && cmd "$projA" log -1 --format=%s tR | grep -q "Main's fix" \
  && cmd "$projA" log -1 --format=%s wb/tR-luna | grep -q "Main's fix" \
  && ok "an unlisted lane branch is found by the branch scan and fixed" \
  || fail "an unlisted lane branch is found by the branch scan and fixed (exit $rc)" "$out$(cat "$tmp/err")"

echo "roots with spaces arrive whole"
mkdir -p "$tmp/spaced root/.postmaster/runs"
git -C "$tmp/spaced root" init -q -b main
dS=$(dispatch "$tmp/spaced root/.postmaster/runs" tS synthesis 1 '{}')
out=$("$SELF" report "$FIX" "$tmp/spaced root" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tS  *checkout" \
  && ok "a spaced root reports instead of splitting" \
  || fail "a spaced root reports instead of splitting (exit $rc)" "$out$(cat "$tmp/err")"

echo "a fix may use the patch's own old filenames"
toolJ="$tmp/toolJ"
new_repo "$toolJ"
mkdir -p "$toolJ/scripts"
printf 'a\nb\nc\n' > "$toolJ/scripts/foo.sh"
cmd "$toolJ" add -A; cmd "$toolJ" commit -qm base
printf 'a\nb\nC\n' > "$toolJ/scripts/foo.sh"
echo payload > "$toolJ/fix.patch"
echo hidden > "$toolJ/.hotfix-reach.patch"
cmd "$toolJ" add -A; cmd "$toolJ" commit -qm "#7, Fix with patch filenames"
FIXJ=$(cmd "$toolJ" rev-parse HEAD)
projJ="$tmp/projJ"
new_repo "$projJ"
mkdir -p "$projJ/scripts"
printf 'a\nb\nc\n' > "$projJ/scripts/foo.sh"
cmd "$projJ" add -A; cmd "$projJ" commit -qm base
RUNS_J="$projJ/.postmaster/runs"
dJ=$(dispatch "$RUNS_J" tJ checkpoint-1 1 '{}')
between_legs "$dJ"
cmd "$projJ" checkout -qb tJ
cmd "$projJ" checkout -q main
out=$("$SELF" report "$FIXJ" "$RUNS_J" --tool "$toolJ" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tJ  *branch" \
  && ok "a fix creating fix.patch is branch, not conflict" \
  || fail "a fix creating fix.patch is branch, not conflict (exit $rc)" "$out$(cat "$tmp/err")"
"$SELF" queue "$FIXJ" "$RUNS_J" --tool "$toolJ" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dJ/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dJ" 2 "$dJ/leg-2-prompt.txt" --tool "$toolJ" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$(cmd "$projJ" show tJ:fix.patch)" = "payload" ] \
  && [ "$(cmd "$projJ" show tJ:.hotfix-reach.patch)" = "hidden" ] \
  && [ "$(cmd "$projJ" show tJ:scripts/foo.sh)" = "$(printf 'a\nb\nC')" ] \
  && ok "and both files land in the applied commit with the fix" \
  || fail "and both files land in the applied commit with the fix (exit $rc)" "$out$(cat "$tmp/err")"

echo "a branch created after queue still gets the fix"
dL=$(dispatch "$RUNS_A" tL checkpoint-1 1 '{"luna": {}}')
between_legs "$dL"
cmd "$projA" checkout -qb tL main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
cmd "$projA" checkout -qb wb/tL-luna main
cmd "$projA" checkout -q tA
printf 'You are the coachman for leg 2.\n' > "$dL/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dL" 2 "$dL/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && cmd "$projA" log -1 --format=%s tL | grep -q "Main's fix" \
  && cmd "$projA" log -1 --format=%s wb/tL-luna | grep -q "Main's fix" \
  && ok "a lane branch cut after queue is picked up at the boundary" \
  || fail "a lane branch cut after queue is picked up at the boundary (exit $rc)" "$out$(cat "$tmp/err")"

echo "advancing past an incomplete leg is refused at every stage"
dP=$(dispatch "$RUNS_A" tP dispatched 1 '{}')
: > "$dP/.leg-1-exited"
cmd "$projA" checkout -qb tP main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dP/leg-2-prompt.txt"
beforeP=$(cmd "$projA" rev-parse tP)
out=$("$SELF" next-leg "$dP" 2 "$dP/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "completed hand-off boundary" \
  && [ "$(cmd "$projA" rev-parse tP)" = "$beforeP" ] \
  && ok "next-leg 2 over an exited-only leg 1 refuses before the first bootstrap too" \
  || fail "next-leg 2 over an exited-only leg 1 refuses before the first bootstrap too (exit $rc)" "$out"
dP0=$(dispatch "$RUNS_A" tP0 dispatched 1 '{}')
cmd "$projA" checkout -qb tP0 main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 1.\n' > "$dP0/leg-1-prompt.txt"
out=$("$SELF" next-leg "$dP0" 1 "$dP0/leg-1-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && cmd "$projA" log -1 --format=%s tP0 | grep -q "Main's fix" \
  && ok "and the legitimate pre-leg application still lands" \
  || fail "and the legitimate pre-leg application still lands (exit $rc)" "$out$(cat "$tmp/err")"

echo "a reverted fix is delivered again"
dV=$(dispatch "$RUNS_A" tV checkpoint-1 1 '{}')
between_legs "$dV"
cmd "$projA" checkout -qb tV main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dV/leg-2-prompt.txt"
"$SELF" next-leg "$dV" 2 "$dV/leg-2-prompt.txt" --tool "$tool" >/dev/null 2>&1
cmd "$projA" checkout -q tV
cmd "$projA" revert --no-edit HEAD >/dev/null 2>&1
cmd "$projA" checkout -q tA
out=$("$SELF" report "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tV  *branch  *fix commit on" \
  && ok "a reverted branch needs the fix again, not already-on" \
  || fail "a reverted branch needs the fix again, not already-on (exit $rc)" "$out$(cat "$tmp/err")"
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dV/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dV" 2 "$dV/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$(cmd "$projA" show tV:scripts/foo.sh)" = "new" ] \
  && ok "and the re-delivery restores the content" \
  || fail "and the re-delivery restores the content (exit $rc)" "$out$(cat "$tmp/err")"

echo "a branch that deleted the fixed file is a conflict"
dDel=$(dispatch "$RUNS_A" tDel checkpoint-1 1 '{}')
between_legs "$dDel"
cmd "$projA" checkout -qb tDel main
cmd "$projA" rm -q scripts/foo.sh
cmd "$projA" commit -qm "lane deleted the file"
cmd "$projA" checkout -q tA
out=$("$SELF" report "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tDel  *conflict" \
  && ok "a branch that deleted the fixed file reports conflict" \
  || fail "a branch that deleted the fixed file reports conflict (exit $rc)" "$out$(cat "$tmp/err")"
out=$("$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tDel: branch changed the same lines" \
  && [ ! -f "$dDel/.hotfix-pending.json" ] \
  && ok "and queue names it untouched with no branch work" \
  || fail "and queue names it untouched with no branch work (exit $rc)" "$out$(cat "$tmp/err")"

echo "a withdrawn conflict applies with one verdict, not two"
dW2=$(dispatch "$RUNS_A" tW2 checkpoint-1 1 '{"luna": {}}')
between_legs "$dW2"
cmd "$projA" checkout -qb tW2 main
cmd "$projA" checkout -qb wb/tW2-luna
echo conflict > "$projA/scripts/foo.sh"
cmd "$projA" commit -qam "lane changed the same lines"
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
cmd "$projA" checkout -q wb/tW2-luna
echo old > "$projA/scripts/foo.sh"
cmd "$projA" commit -qam "lane withdrew the edit"
cmd "$projA" checkout -q tA
printf 'You are the coachman for leg 2.\n' > "$dW2/leg-2-prompt.txt"
out=$("$SELF" next-leg "$dW2" 2 "$dW2/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && cmd "$projA" log -1 --format=%s wb/tW2-luna | grep -q "Main's fix" \
  && [ "$(grep -c "wb/tW2-luna" "$dW2/hotfix-notes.md")" -eq 1 ] \
  && ! grep "wb/tW2-luna" "$dW2/hotfix-notes.md" | grep -q "left untouched" \
  && ok "a withdrawn conflict applies with the applied verdict only" \
  || fail "a withdrawn conflict applies with the applied verdict only (exit $rc)" "$out$(cat "$tmp/err")"

echo "content without history is has-fix, not conflict"
dC3=$(dispatch "$RUNS_A" tC3 checkpoint-1 1 '{}')
between_legs "$dC3"
cmd "$projA" checkout -qb tC3 main
echo new > "$projA/scripts/foo.sh"
cmd "$projA" commit -qam "lane independently fixed the same content"
cmd "$projA" checkout -q tA
out=$("$SELF" report "$FIX" "$RUNS_A" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tC3  *branch  *fix already on" \
  && ok "content without history reports has-fix" \
  || fail "content without history reports has-fix (exit $rc)" "$out$(cat "$tmp/err")"

echo "a mid-loop refusal moves nothing"
dC4=$(dispatch "$RUNS_A" tC4 checkpoint-1 1 '{"luna": {}}')
between_legs "$dC4"
cmd "$projA" checkout -qb tC4 main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
cmd "$projA" checkout -qb wb/tC4-luna tC4
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX2" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
cmd "$projA" branch -q -D wb/tC4-luna
printf 'You are the coachman for leg 2.\n' > "$dC4/leg-2-prompt.txt"
beforeC4=$(cmd "$projA" rev-parse tC4)
out=$("$SELF" next-leg "$dC4" 2 "$dC4/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "wb/tC4-luna is gone" \
  && [ "$(cmd "$projA" rev-parse tC4)" = "$beforeC4" ] \
  && [ "$(grep -c '"fix"' "$dC4/.hotfix-pending.json")" -eq 2 ] \
  && [ "$(grep -c "Main's fix" "$dC4/leg-2-prompt.txt")" -eq 0 ] \
  && ok "a mid-loop refusal moves nothing: branch, pending and prompt intact" \
  || fail "a mid-loop refusal moves nothing: branch, pending and prompt intact (exit $rc)" "$out"

echo "a re-delivery rewrites the record to the branch's current sha"
dV2=$(dispatch "$RUNS_A" tV2 checkpoint-1 1 '{}')
between_legs "$dV2"
cmd "$projA" checkout -qb tV2 main
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
printf 'You are the coachman for leg 2.\n' > "$dV2/leg-2-prompt.txt"
"$SELF" next-leg "$dV2" 2 "$dV2/leg-2-prompt.txt" --tool "$tool" >/dev/null 2>&1
firstV2=$(cmd "$projA" rev-parse tV2)
cmd "$projA" checkout -q tV2
cmd "$projA" revert --no-edit HEAD >/dev/null 2>&1
cmd "$projA" checkout -q tA
"$SELF" queue "$FIX" "$RUNS_A" --tool "$tool" >/dev/null 2>&1
# The same prompt file: a re-delivery must rewrite its note, not keep the old sha.
out=$("$SELF" next-leg "$dV2" 2 "$dV2/leg-2-prompt.txt" --tool "$tool" 2>"$tmp/err"); rc=$?
secondV2=$(cmd "$projA" rev-parse tV2)
[ $rc -eq 0 ] \
  && grep -q "${secondV2:0:12}" "$dV2/hotfix-notes.md" \
  && grep -q "${secondV2:0:12}" "$dV2/leg-2-prompt.txt" \
  && grep -q "$secondV2" "$dV2/.hotfix-applied.json" \
  && ! grep -q "${firstV2:0:12}" "$dV2/hotfix-notes.md" \
  && ! grep -q "${firstV2:0:12}" "$dV2/leg-2-prompt.txt" \
  && ! grep -q "$firstV2" "$dV2/.hotfix-applied.json" \
  && [ "$(grep -c "Main's fix ${FIX:0:7}" "$dV2/hotfix-notes.md")" -eq 1 ] \
  && ok "a re-delivery leaves notes, prompt and applied naming the current sha" \
  || fail "a re-delivery leaves notes, prompt and applied naming the current sha (exit $rc)" "$out$(cat "$tmp/err")"

echo "a fix that cannot be fetched stops the tool with unknown, before any write"
projU="$tmp/projU"
new_repo "$projU"
mkdir -p "$projU/scripts"
echo "old" > "$projU/scripts/foo.sh"
cmd "$projU" add -A
cmd "$projU" commit -qm base
RUNS_U="$projU/.postmaster/runs"
dU=$(dispatch "$RUNS_U" tU checkpoint-1 1 '{}')
between_legs "$dU"
cmd "$projU" checkout -qb tU
cmd "$projU" checkout -q main
# The fix lives in the tool, not in the project, and the fetch cannot land.
if git -C "$projU" cat-file -e "$FIX" 2>/dev/null \
  || nofetch git -C "$projU" fetch -q "$tool" "$FIX" 2>/dev/null; then
  fail "fixture: the fix object is reachable in projU or its fetch works"
else
  ok "fixture: the fix object is absent and its fetch fails"
fi
out=$(nofetch "$SELF" report "$FIX" "$RUNS_U" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "tU" \
  && printf '%s\n' "$out" | grep -q "unknown" \
  && [ ! -f "$dU/.hotfix-pending.json" ] && [ ! -f "$dU/hotfix-notes.md" ] \
  && ! grep -rq "${FIX:0:7}" "$dU/logs" 2>/dev/null \
  && ok "report stops with unknown and writes nothing" \
  || fail "report stops with unknown and writes nothing (exit $rc)" "$out"
# A managed pin makes the queue case sharp: the reorder must stop before serving it.
pinU="$POSTMASTER_TOOL_PINS/pinU"
cmd "$tool" clone -q "$tool" "$pinU" 2>/dev/null
cmd "$pinU" config user.email self@test
cmd "$pinU" config user.name self-test
cmd "$pinU" checkout -q "$BASE"
printf '{"project": "fix", "run": "tU", "postmaster": {"commit": "%s", "checkout": "%s"}}\n' \
  "$BASE" "$pinU" > "$dU/run.json"
out=$(nofetch "$SELF" queue "$FIX" "$RUNS_U" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "unknown" \
  && [ "$(cmd "$pinU" rev-parse HEAD)" = "$BASE" ] \
  && [ ! -f "$dU/.hotfix-pending.json" ] && [ ! -f "$dU/hotfix-notes.md" ] \
  && ok "queue stops with unknown before the pin and the pending write" \
  || fail "queue stops with unknown before the pin and the pending write (exit $rc)" "$out"

echo "the next-leg preflight refuses an unfetchable fix with pending intact"
projN="$tmp/projN"
new_repo "$projN"
mkdir -p "$projN/scripts"
echo "old" > "$projN/scripts/foo.sh"
cmd "$projN" add -A
cmd "$projN" commit -qm base
RUNS_N="$projN/.postmaster/runs"
dN=$(dispatch "$RUNS_N" tN checkpoint-1 1 '{}')
between_legs "$dN"
cmd "$projN" checkout -qb tN
cmd "$projN" checkout -q main
printf '{"commits": [{"fix": "%s", "subject": "#7, Fix foo", "paths": ["scripts/foo.sh"], "branches": ["tN"], "skipped_conflict": [], "runbook": false, "queued_at": "fixture"}]}\n' \
  "$FIX" > "$dN/.hotfix-pending.json"
printf 'You are the coachman for leg 2.\n' > "$dN/leg-2-prompt.txt"
if git -C "$projN" cat-file -e "$FIX" 2>/dev/null \
  || nofetch git -C "$projN" fetch -q "$tool" "$FIX" 2>/dev/null; then
  fail "fixture: the fix object is reachable in projN or its fetch works"
else
  ok "fixture: the next-leg fix object is absent and its fetch fails"
fi
beforeN=$(cmd "$projN" rev-parse tN)
out=$(nofetch "$SELF" next-leg "$dN" 2 "$dN/leg-2-prompt.txt" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "unknown" \
  && printf '%s\n' "$out" | grep -q "tN" \
  && grep -q "$FIX" "$dN/.hotfix-pending.json" \
  && [ "$(cmd "$projN" rev-parse tN)" = "$beforeN" ] \
  && [ ! -f "$dN/hotfix-notes.md" ] \
  && [ "$(grep -c "Main's fix" "$dN/leg-2-prompt.txt")" -eq 0 ] \
  && ok "next-leg refuses unknown with branch, pending, notes and prompt intact" \
  || fail "next-leg refuses unknown with branch, pending, notes and prompt intact (exit $rc)" "$out"

echo "unknown holds whatever the branch history suggests"
projV="$tmp/projV"
new_repo "$projV"
mkdir -p "$projV/scripts"
echo "old" > "$projV/scripts/foo.sh"
cmd "$projV" add -A
cmd "$projV" commit -qm base
RUNS_V="$projV/.postmaster/runs"
dRv=$(dispatch "$RUNS_V" tRv checkpoint-1 1 '{}')
between_legs "$dRv"
cmd "$projV" checkout -qb tRv
echo new > "$projV/scripts/foo.sh"
cmd "$projV" commit -qam "lane takes the fix early"
cmd "$projV" revert --no-edit HEAD >/dev/null 2>&1
cmd "$projV" commit -q --amend -m 'Revert "#7, Fix foo"'
cmd "$projV" checkout -q main
if git -C "$projV" cat-file -e "$FIX" 2>/dev/null \
  || nofetch git -C "$projV" fetch -q "$tool" "$FIX" 2>/dev/null; then
  fail "fixture: the fix object is reachable in projV or its fetch works"
else
  ok "fixture: the revert-branch fix object is absent and its fetch fails"
fi
out=$(nofetch "$SELF" report "$FIX" "$RUNS_V" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "unknown" \
  && ! grep -rq "${FIX:0:7}" "$dRv/logs" 2>/dev/null \
  && ok "a branch holding a revert of the fix is unknown, not needs" \
  || fail "a branch holding a revert of the fix is unknown, not needs (exit $rc)" "$out"
projW="$tmp/projW"
new_repo "$projW"
mkdir -p "$projW/scripts"
echo "old" > "$projW/scripts/foo.sh"
cmd "$projW" add -A
cmd "$projW" commit -qm base
RUNS_W="$projW/.postmaster/runs"
dW=$(dispatch "$RUNS_W" tW checkpoint-1 1 '{}')
between_legs "$dW"
cmd "$projW" checkout -qb tW
cmd "$projW" commit -q --allow-empty -m "Main's fix ${FIX:0:7} landed already"
cmd "$projW" checkout -q main
if git -C "$projW" cat-file -e "$FIX" 2>/dev/null \
  || nofetch git -C "$projW" fetch -q "$tool" "$FIX" 2>/dev/null; then
  fail "fixture: the fix object is reachable in projW or its fetch works"
else
  ok "fixture: the message-branch fix object is absent and its fetch fails"
fi
out=$(nofetch "$SELF" report "$FIX" "$RUNS_W" --tool "$tool" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -q "unknown" \
  && ! grep -rq "${FIX:0:7}" "$dW/logs" 2>/dev/null \
  && ok "a branch message claiming the fix is unknown, never has-fix" \
  || fail "a branch message claiming the fix is unknown, never has-fix (exit $rc)" "$out"

echo "a branch cut after main deleted the file is never carried, not deleted"
cmd "$tool" rm -q scripts/foo.sh
cmd "$tool" commit -qm "main drops foo"
DTOOL=$(cmd "$tool" rev-parse HEAD)
printf 'restored\n' > "$tool/scripts/foo.sh"
cmd "$tool" add -A
cmd "$tool" commit -qm "#7, Restore foo"
FIXADD=$(cmd "$tool" rev-parse HEAD)
projD="$tmp/projD"
new_repo "$projD"
cmd "$projD" fetch -q "$tool" "$DTOOL"
cmd "$projD" checkout -q -B main "$DTOOL"
cmd "$projD" commit -q --allow-empty -m "later on main"
RUNS_D="$projD/.postmaster/runs"
dD3=$(dispatch "$RUNS_D" tD checkpoint-1 1 '{}')
between_legs "$dD3"
cmd "$projD" checkout -qb tD
cmd "$projD" checkout -q main
# The fix object is present: the verdict must come from the merge-base, not absence.
cmd "$projD" fetch -q "$tool" "$FIXADD"
out=$("$SELF" report "$FIXADD" "$RUNS_D" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tD  *checkout" \
  && ok "a branch cut after main deleted the file reports checkout" \
  || fail "a branch cut after main deleted the file reports checkout (exit $rc)" "$out$(cat "$tmp/err")"
out=$("$SELF" queue "$FIXADD" "$RUNS_D" --tool "$tool" 2>"$tmp/err"); rc=$?
printf 'You are the coachman for leg 2.\n' > "$dD3/leg-2-prompt.txt"
beforeD=$(cmd "$projD" rev-parse tD)
out2=$("$SELF" next-leg "$dD3" 2 "$dD3/leg-2-prompt.txt" --tool "$tool" 2>&1); rc2=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "nothing more to do" \
  && [ ! -f "$dD3/.hotfix-pending.json" ] \
  && [ $rc2 -eq 0 ] && [ "$(cmd "$projD" rev-parse tD)" = "$beforeD" ] \
  && [ ! -f "$dD3/hotfix-notes.md" ] \
  && ok "and the boundary creates nothing on it" \
  || fail "and the boundary creates nothing on it (exit $rc/$rc2)" "$out$out2$(cat "$tmp/err")"

echo "a branch that never saw the file is not its deleter"
printf 'bar\n' > "$tool/scripts/bar.sh"
cmd "$tool" add -A
cmd "$tool" commit -qm "main adds bar"
ABAR=$(cmd "$tool" rev-parse HEAD)
printf 'bar fixed\n' > "$tool/scripts/bar.sh"
cmd "$tool" commit -qam "#7, Fix bar"
FIXB=$(cmd "$tool" rev-parse HEAD)
PBAR=$(cmd "$tool" rev-parse "$ABAR^")
projE="$tmp/projE"
new_repo "$projE"
cmd "$projE" fetch -q "$tool" "$PBAR"
cmd "$projE" checkout -q -B main "$PBAR"
RUNS_E="$projE/.postmaster/runs"
dE=$(dispatch "$RUNS_E" tE checkpoint-1 1 '{}')
between_legs "$dE"
cmd "$projE" checkout -qb tE
printf 'mine\n' > "$projE/scripts/bar.sh"
cmd "$projE" add scripts/bar.sh
cmd "$projE" commit -qm "lane drafts its own copy"
cmd "$projE" rm -q scripts/bar.sh
cmd "$projE" commit -qm "lane drops its own copy"
cmd "$projE" checkout -q main
cmd "$projE" fetch -q "$tool" "$FIXB"
out=$("$SELF" report "$FIXB" "$RUNS_E" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "tE  *checkout" \
  && ok "a branch whose own copy never met the file reports checkout" \
  || fail "a branch whose own copy never met the file reports checkout (exit $rc)" "$out$(cat "$tmp/err")"
out=$("$SELF" queue "$FIXB" "$RUNS_E" --tool "$tool" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q "nothing more to do" \
  && [ ! -f "$dE/.hotfix-pending.json" ] \
  && ok "and queue creates no branch work for it" \
  || fail "and queue creates no branch work for it (exit $rc)" "$out$(cat "$tmp/err")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1

