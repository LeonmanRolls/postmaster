#!/usr/bin/env bash
# Report and carry one merged postmaster fix to the runs that need it.
#
#   hotfix.sh report <tool-checkout> <fix-commit> [project-root ...]
#       report every in-flight run below the roots (or configured project roots), and say
#       whether the fix arrives through postmaster's checkout, needs one commit on the run
#       branch, waits for the next leg because it changes a runbook, or conflicts with work
#       already on that branch
#   hotfix.sh queue <tool-checkout> <fix-commit> [project-root ...]
#       record the needed branch or runbook action in each dispatch, without touching a branch
#   hotfix.sh next-leg <tool-checkout> <dispatch> <leg> <prompt-file>
#       at the hand-off boundary, apply queued fix commits alone and add the main-fix note to
#       the next leg's prompt
#   hotfix.sh --self-test
#
# A fix commit must already be on the tool checkout's main branch. The script never merges
# main into a run branch. A conflict is reported and left for the second merger to resolve.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

case "${1:-}" in
  --self-test) ;;
  report|queue|next-leg) ;;
  *) echo "usage: hotfix.sh report <tool-checkout> <fix-commit> [project-root ...] | queue <tool-checkout> <fix-commit> [project-root ...] | next-leg <tool-checkout> <dispatch> <leg> <prompt-file> | --self-test" >&2; exit 1 ;;
esac

exec python3 -I - "$HERE" "$@" <<'PY'
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import tomllib


SCRIPT_ROOT = pathlib.Path(sys.argv[1]).resolve().parent
ARGS = sys.argv[2:]
TERMINAL = {"done", "abandoned"}
PRUNED = {".git", ".worktrees", "node_modules", ".venv", "venv", "vendor"}
PENDING = ".hotfix-pending.json"
APPLIED = ".hotfix-applied.json"


class HotfixError(Exception):
    pass


def git(where, *args, check=True, env=None):
    p = subprocess.run(["git", "-C", str(where), *map(str, args)], capture_output=True, text=True, env=env)
    if check and p.returncode:
        detail = (p.stderr or p.stdout).strip()
        raise HotfixError("git %s in %s failed: %s" % (" ".join(map(str, args[:3])), where, detail[:500]))
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def canon(path):
    return pathlib.Path(path).expanduser().resolve()


def common_dir(repo):
    _, value, _ = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return pathlib.Path(value).resolve()


def require_tool(tool):
    tool = canon(tool)
    if git(tool, "rev-parse", "--show-toplevel")[1] != str(tool):
        raise HotfixError("tool checkout is not the top of a git repository: %s" % tool)
    return tool


def fix_details(tool, commit):
    _, full, _ = git(tool, "rev-parse", "--verify", "%s^{commit}" % commit)
    _, branch, _ = git(tool, "symbolic-ref", "--short", "-q", "HEAD")
    if branch != "main":
        raise HotfixError("tool checkout must be on main after the pull; it is on %s" % (branch or "a detached HEAD"))
    _, parents, _ = git(tool, "rev-list", "--parents", "-n", "1", full)
    fields = parents.split()
    if len(fields) != 2:
        raise HotfixError("%s is not one fix commit; pass the commit that changes the files, not a merge commit" % full[:12])
    rc, _, _ = git(tool, "merge-base", "--is-ancestor", full, "HEAD", check=False)
    if rc:
        raise HotfixError("fix %s is not on the tool checkout's current branch; merge it and pull first" % full[:12])
    parent = fields[1]
    _, raw_paths, _ = git(tool, "diff-tree", "--no-commit-id", "--name-only", "-r", "-M", parent, full)
    paths = sorted(set(p for p in raw_paths.splitlines() if p))
    if not paths:
        raise HotfixError("fix %s changes no files" % full[:12])
    _, subject, _ = git(tool, "show", "-s", "--format=%s", full)
    m = re.match(r"#([0-9]+),\s*(.+)$", subject)
    if not m:
        raise HotfixError("fix commit subject must start with #<ticket>, <title>: %s" % subject)
    ticket = "#" + m.group(1)
    title = m.group(2).strip()
    return {"commit": full, "parent": parent, "paths": paths, "subject": subject, "ticket": ticket, "title": title}


def configured_roots(tool, given):
    roots = [canon(x) for x in given]
    if not roots:
        cfg = pathlib.Path(os.environ.get("POSTMASTER_CONFIG", pathlib.Path.home() / ".postmaster/config.toml")).expanduser()
        if not cfg.is_file():
            raise HotfixError("no project roots were supplied and no machine config exists at %s" % cfg)
        try:
            data = tomllib.load(open(cfg, "rb"))
        except (OSError, tomllib.TOMLDecodeError) as e:
            raise HotfixError("cannot read project roots from %s: %s" % (cfg, e))
        roots = [canon(p) for p in data.get("projects_roots", []) if isinstance(p, str) and p.strip()]
        if not roots:
            raise HotfixError("the machine config has no projects_roots; pass project roots explicitly")
    roots.append(tool)
    unique = []
    seen = set()
    for root in roots:
        if root.is_dir() and root not in seen:
            unique.append(root)
            seen.add(root)
    if not unique:
        raise HotfixError("no readable project roots")
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
    if p.parent.parent.name == "runs":
        return p.parent.parent.parent
    raise HotfixError("run directory is not under a recognized runs folder: %s" % dispatch)


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def active_runs(roots):
    found, seen = [], set()
    for root in roots:
        for dispatch in run_dirs(root):
            if dispatch in seen:
                continue
            seen.add(dispatch)
            manifest = read_json(dispatch / "manifest.json")
            run = read_json(dispatch / "run.json")
            stage = (manifest or {}).get("stage")
            if stage in TERMINAL:
                continue
            found.append({"dispatch": dispatch, "manifest": manifest, "run": run, "stage": stage})
    return sorted(found, key=lambda x: str(x["dispatch"]))


def leg_has_started(dispatch, manifest):
    try:
        n = int((manifest or {}).get("leg", 0))
    except (TypeError, ValueError):
        return False
    leg = str(n)
    coaches = ((manifest or {}).get("coachman") or {}).get("legs") or {}
    entry = coaches.get(leg) if isinstance(coaches, dict) else None
    return bool((isinstance(entry, dict) and entry.get("thread_id")) or (dispatch / (".leg-%d-exited" % n)).exists())


def worktree_for(project, dispatch):
    return project / ".worktrees" / dispatch.name


def path_exists_at(repo, ref, path):
    rc, _, _ = git(repo, "cat-file", "-e", "%s:%s" % (ref, path), check=False)
    return rc == 0


def merge_conflicts(repo, head, fix):
    rc, names, err = git(repo, "merge-tree", "--write-tree", "--name-only", head, fix, check=False)
    if rc == 0:
        return []
    if rc == 1:
        return sorted(set(x.strip() for x in (names + "\n" + err).splitlines() if x.strip() and "/" in x))
    raise HotfixError("cannot check whether %s conflicts with %s: %s" % (fix[:12], head[:12], (err or names)[:300]))


def classify(tool, info, fix):
    dispatch, run = info["dispatch"], info["run"]
    if not isinstance(run, dict) or not isinstance(run.get("postmaster"), dict) or not info["manifest"]:
        return {"route": "unknown", "detail": "run.json or manifest.json is missing or unreadable"}
    try:
        project = project_for(dispatch)
        same_repo = common_dir(project) == common_dir(tool)
    except HotfixError:
        return {"route": "unknown", "detail": "the target project could not be identified"}
    if not same_repo:
        runbook = any(p.startswith("skills/postmaster/") for p in fix["paths"])
        if runbook:
            read_state = "current leg already started; use the fixed runbook on the following leg" if leg_has_started(dispatch, info["manifest"]) else "current leg has not started; its prompt will direct it to the fixed main runbook"
            return {"route": "next-leg", "detail": read_state}
        return {"route": "checkout", "detail": "postmaster's main checkout supplies the fix"}

    wt = worktree_for(project, dispatch)
    if not wt.is_dir() or git(wt, "rev-parse", "--show-toplevel", check=False)[0]:
        return {"route": "branch-pending", "detail": "the run branch worktree is not present yet"}
    _, head, _ = git(wt, "rev-parse", "HEAD")
    _, branch, _ = git(wt, "branch", "--show-current")
    if not branch:
        return {"route": "unknown", "detail": "the run worktree has no branch"}
    if branch != dispatch.name:
        return {"route": "unknown", "detail": "expected run branch %s but found %s" % (dispatch.name, branch)}
    dirty = git(wt, "status", "--porcelain")[1]
    if dirty:
        return {"route": "dirty", "detail": "run branch has uncommitted changes; left untouched", "branch": branch, "worktree": wt, "head": head}
    _, is_ancestor, _ = git(wt, "merge-base", "--is-ancestor", fix["commit"], head, check=False)
    rc, _, _ = git(wt, "merge-base", "--is-ancestor", fix["commit"], head, check=False)
    if rc == 0 or fix["commit"] in applied_commits(dispatch):
        return {"route": "already", "detail": "the fix is already recorded on the run branch", "branch": branch, "worktree": wt, "head": head}
    carrying = [p for p in fix["paths"] if path_exists_at(wt, head, p)]
    if not carrying:
        return {"route": "checkout", "detail": "the run branch has no copy of the fixed files", "branch": branch, "worktree": wt, "head": head}
    conflicts = merge_conflicts(wt, head, fix["commit"])
    if conflicts:
        return {"route": "conflict", "detail": "overlapping edits in " + ", ".join(conflicts), "branch": branch, "worktree": wt, "head": head}
    runbook = any(p.startswith("skills/postmaster/") for p in fix["paths"])
    read_state = ("current leg already read the pinned runbook; next leg must read the fixed main copy"
                  if leg_has_started(dispatch, info["manifest"]) else "current leg has not started; its prompt will direct it to the fixed main copy")
    return {"route": "branch+next-leg" if runbook else "branch",
            "detail": "branch carries the fixed file%s" % ("; " + read_state if runbook else ""),
            "branch": branch, "worktree": wt, "head": head}


def applied_commits(dispatch):
    data = read_json(dispatch / APPLIED) or {}
    rows = data.get("commits", [])
    return {x.get("source") for x in rows if isinstance(x, dict) and isinstance(x.get("source"), str)}


def describe(info, result):
    ticket = info["dispatch"].name
    try:
        project = project_for(info["dispatch"]).name
    except HotfixError:
        project = "unknown-project"
    return "%s/%s %s route=%s: %s" % (project, ticket, info["stage"] or "unknown-stage", result["route"], result["detail"])


def output_report(tool, commit, roots):
    fix = fix_details(tool, commit)
    runs = active_runs(configured_roots(tool, roots))
    master = ensure_log_dir(tool)
    for info in runs:
        result = classify(tool, info, fix)
        log(tool, info["dispatch"], "note", fix["commit"], "hotfix report: route=%s; %s" % (result["route"], result["detail"]))
        print(describe(info, result))
    if not runs:
        print("no in-flight runs")
    log(tool, master, "note", fix["commit"], "hotfix report covered %d in-flight run(s)" % len(runs))
    return runs, fix


def ensure_log_dir(tool):
    d = tool / ".postmaster" / "runs" / "postmaster"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(tool, dispatch, action, target, detail):
    log_script = SCRIPT_ROOT / "scripts" / "log-action.sh"
    if not log_script.is_file():
        raise HotfixError("cannot log hotfix action; missing %s" % log_script)
    p = subprocess.run([str(log_script), str(dispatch), "postmaster", action, target, detail], capture_output=True, text=True)
    if p.returncode:
        raise HotfixError("log-action failed for %s: %s" % (dispatch, (p.stderr or p.stdout).strip()))


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


def next_leg_for(info):
    manifest, dispatch = info["manifest"], info["dispatch"]
    try:
        current = int(manifest.get("leg", 0))
    except (AttributeError, TypeError, ValueError):
        return None
    return current + 1 if leg_has_started(dispatch, manifest) else current


def queue_fix(tool, commit, roots):
    fix = fix_details(tool, commit)
    runs = active_runs(configured_roots(tool, roots))
    master = ensure_log_dir(tool)
    queued = 0
    for info in runs:
        dispatch = info["dispatch"]
        result = classify(tool, info, fix)
        route = result["route"]
        if route == "conflict":
            detail = "main hotfix conflict; branch left untouched; second merger resolves: " + result["detail"]
            log(tool, dispatch, "note", fix["commit"], detail)
            print(describe(info, result) + "; left untouched")
            continue
        if route in {"checkout", "already", "unknown", "dirty"}:
            detail = "main hotfix %s; %s" % (fix["commit"], result["detail"])
            log(tool, dispatch, "note", fix["commit"], detail)
            print(describe(info, result) + "; nothing to apply")
            continue
        target_leg = next_leg_for(info)
        if target_leg is None or target_leg < 1:
            log(tool, dispatch, "note", fix["commit"], "main hotfix could not determine the next leg; left for postmaster")
            print(describe(info, {"route": "unknown", "detail": "next leg is unreadable"}))
            continue
        data = read_json(dispatch / PENDING) or {"commits": []}
        commits = data.get("commits") if isinstance(data.get("commits"), list) else []
        if any(isinstance(x, dict) and x.get("commit") == fix["commit"] for x in commits):
            print(describe(info, result) + "; already queued for leg %d" % target_leg)
            continue
        detail = "queued main hotfix for leg %d: %s" % (target_leg, ", ".join(fix["paths"]))
        log(tool, dispatch, "note", fix["commit"], detail)
        commits.append({"commit": fix["commit"], "paths": fix["paths"], "route": route,
                        "target_leg": target_leg, "subject": fix["subject"]})
        write_json(dispatch / PENDING, {"commits": commits})
        queued += 1
        print(describe(info, result) + "; queued for leg %d" % target_leg)
    log(tool, master, "note", fix["commit"], "hotfix propagation queued for %d in-flight run(s)" % queued)
    return 0


def between_legs(dispatch, manifest, leg):
    try:
        current = int(manifest.get("leg", 0))
    except (AttributeError, TypeError, ValueError):
        raise HotfixError("run manifest has no readable current leg")
    if leg == current:
        if leg_has_started(dispatch, manifest):
            raise HotfixError("leg %d already started; hotfixes are applied only before a leg or between legs" % leg)
        previous = leg - 1
        if previous > 0:
            current = previous
    elif leg != current + 1:
        raise HotfixError("leg %d does not follow the manifest leg %d" % (leg, current))
    if current > 0 and leg > current:
        for suffix in ("done", "exited"):
            if not (dispatch / (".leg-%d-%s" % (current, suffix))).is_file():
                raise HotfixError("leg %d has not reached a completed hand-off boundary (%s is missing)" % (current, suffix))
        handoff = dispatch / ("handoff-%d.md" % current)
        if not handoff.is_file():
            raise HotfixError("leg %d has no hand-off file" % current)
        checker = SCRIPT_ROOT / "scripts" / "handoff-check.sh"
        checked = subprocess.run([str(checker), str(handoff)], capture_output=True, text=True)
        if checked.returncode:
            raise HotfixError("leg %d hand-off does not pass handoff-check.sh: %s" % (current, (checked.stderr or checked.stdout).strip()))
    if leg != current and (dispatch / (".leg-%d-exited" % leg)).exists():
        raise HotfixError("leg %d has already started; hotfixes are applied only between legs" % leg)


def source_subject(tool, commit):
    return git(tool, "show", "-s", "--format=%s", commit)[1]


def do_next_leg(tool, dispatch, leg_text, prompt):
    tool = require_tool(tool)
    dispatch = canon(dispatch)
    prompt = canon(prompt)
    if not dispatch.is_dir():
        raise HotfixError("no such dispatch directory: %s" % dispatch)
    if not prompt.is_file() or prompt.parent != dispatch:
        raise HotfixError("next-leg prompt must be an existing file directly in %s" % dispatch)
    try:
        leg = int(leg_text)
        if leg < 1:
            raise ValueError()
    except ValueError:
        raise HotfixError("leg must be a positive whole number")
    manifest = read_json(dispatch / "manifest.json")
    run = read_json(dispatch / "run.json")
    if not manifest or not run:
        raise HotfixError("run.json and manifest.json must be readable")
    between_legs(dispatch, manifest, leg)
    project = project_for(dispatch)
    pending_data = read_json(dispatch / PENDING) or {"commits": []}
    pending = pending_data.get("commits") if isinstance(pending_data.get("commits"), list) else []
    eligible = [x for x in pending if isinstance(x, dict) and x.get("target_leg") == leg]
    if not eligible:
        print("hotfix: no queued fixes for leg %d" % leg)
        return 0

    done = set()
    master = ensure_log_dir(tool)
    for item in eligible:
        notes = []
        source = item.get("commit", "")
        fix = fix_details(tool, source)
        result = classify(tool, {"dispatch": dispatch, "run": run, "manifest": manifest, "stage": manifest.get("stage")}, fix)
        if result["route"] == "conflict":
            detail = "main hotfix conflict; branch left untouched; second merger resolves: " + result["detail"]
            log(tool, dispatch, "note", source, detail)
            log(tool, master, "note", source, "%s: %s" % (dispatch.name, detail))
            print("hotfix: %s left untouched; %s" % (dispatch.name, result["detail"]))
            done.add(source)
            continue
        if result["route"] == "dirty":
            detail = "main hotfix not applied; run branch has uncommitted changes and was left untouched"
            log(tool, dispatch, "note", source, detail)
            log(tool, master, "note", source, "%s: %s" % (dispatch.name, detail))
            raise HotfixError("%s has uncommitted branch changes; clean or resolve them before the next leg" % dispatch.name)
        if result["route"] == "unknown":
            raise HotfixError("cannot safely classify %s for fix %s: %s" % (dispatch.name, source[:12], result["detail"]))
        branch_commit = ""
        if result["route"] in {"branch", "branch+next-leg", "branch-pending"}:
            wt = worktree_for(project, dispatch)
            if not wt.is_dir():
                raise HotfixError("run branch worktree is missing: %s" % wt)
            dirty = git(wt, "status", "--porcelain")[1]
            if dirty:
                raise HotfixError("run branch has uncommitted changes; left untouched: %s" % wt)
            head = git(wt, "rev-parse", "HEAD")[1]
            branch = git(wt, "branch", "--show-current")[1]
            conflicts = merge_conflicts(wt, head, source)
            if conflicts:
                detail = "main hotfix conflict; branch left untouched; second merger resolves: " + ", ".join(conflicts)
                log(tool, dispatch, "note", source, detail)
                log(tool, master, "note", source, "%s: %s" % (dispatch.name, detail))
                print("hotfix: %s left untouched; overlapping edits in %s" % (dispatch.name, ", ".join(conflicts)))
                done.add(source)
                continue
            rc, already, _ = git(wt, "merge-base", "--is-ancestor", source, head, check=False)
            if rc == 0:
                branch_commit = head
            else:
                before = head
                log(tool, dispatch, "note", source, "applying one main hotfix commit to %s at the leg %d boundary" % (branch, leg))
                env = os.environ.copy()
                env.update({"GIT_AUTHOR_NAME": "brindlewick", "GIT_AUTHOR_EMAIL": "332054101+brindlewick@users.noreply.github.com",
                            "GIT_COMMITTER_NAME": "brindlewick", "GIT_COMMITTER_EMAIL": "332054101+brindlewick@users.noreply.github.com"})
                rc, out, err = git(wt, "cherry-pick", "--no-commit", source, check=False, env=env)
                if rc:
                    if git(wt, "rev-parse", "--verify", "-q", "CHERRY_PICK_HEAD", check=False)[0] == 0:
                        git(wt, "cherry-pick", "--abort", check=False)
                    raise HotfixError("could not apply %s to %s; no merge of main was attempted: %s" % (source[:12], branch, (err or out).strip()[:300]))
                ticket = fix["ticket"] or "main"
                subject = "%s main fix: %s" % (ticket, fix["title"])
                body = "Main fix commit: %s" % source
                rc, out, err = git(wt, "commit", "-m", subject, "-m", body, check=False, env=env)
                if rc:
                    raise HotfixError("could not commit the staged main fix on %s: %s" % (branch, (err or out).strip()[:300]))
                branch_commit = git(wt, "rev-parse", "HEAD")[1]
                if git(wt, "rev-parse", "HEAD^", check=False)[1] != before:
                    raise HotfixError("hotfix commit on %s did not have the expected parent; inspect %s" % (branch, wt))
                log(tool, dispatch, "apply", branch_commit, "main fix %s applied alone to branch %s" % (source, branch))
                log(tool, master, "apply", branch_commit, "%s: main fix %s applied alone to branch %s" % (dispatch.name, source, branch))
                print("hotfix: applied %s alone to %s as %s" % (source[:12], branch, branch_commit[:12]))

        runbook_paths = [p for p in fix["paths"] if p.startswith("skills/postmaster/")]
        if runbook_paths:
            read_note = ("This run's current leg read its pinned copy before the fix. "
                         if leg_has_started(dispatch, manifest) else "This leg has not started yet. ")
            notes.append("Main fix %s (%s) updates %s. %sFor leg %d, read the updated main checkout file at <tool>/%s and follow it. Do not merge main into the run branch." %
                         (source[:12], fix["subject"], ", ".join(runbook_paths), read_note, leg, runbook_paths[0]))
        if branch_commit:
            branch = result.get("branch") or git(worktree_for(project, dispatch), "branch", "--show-current")[1]
            notes.append("Main fix %s was applied alone as %s on branch %s between legs. Do not merge main into the run branch." %
                         (source[:12], branch_commit[:12], branch))
        if result["route"] in {"checkout", "already"} and not notes:
            notes.append("Main fix %s reaches this run through postmaster's main checkout; no main merge is needed." % source[:12])
        if not notes:
            raise HotfixError("no safe propagation route remains for %s; left queued" % source[:12])
        message = "Main hotfix note for leg %d (%s): %s" % (leg, source[:12], " ".join(notes))
        current = prompt.read_text(encoding="utf-8")
        if "Main hotfix note for leg %d (%s):" % (leg, source[:12]) not in current:
            with prompt.open("a", encoding="utf-8") as f:
                f.write("\n\n" + message + "\n")
        log(tool, dispatch, "note", source, "main fix note added to leg %d prompt" % leg)
        log(tool, master, "note", source, "%s: main fix note added to leg %d prompt" % (dispatch.name, leg))
        applied_data = read_json(dispatch / APPLIED) or {"commits": []}
        rows = applied_data.get("commits") if isinstance(applied_data.get("commits"), list) else []
        if not any(isinstance(x, dict) and x.get("source") == source for x in rows):
            rows.append({"source": source, "branch_commit": branch_commit or None, "leg": leg,
                         "prompt": prompt.name, "at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        write_json(dispatch / APPLIED, {"commits": rows})
        done.add(source)

    remaining = [x for x in pending if not (isinstance(x, dict) and x.get("commit") in done)]
    write_json(dispatch / PENDING, {"commits": remaining})
    return 0


def self_test():
    import shutil
    import tempfile

    fails = []

    def ok(label, value):
        if value:
            print("  ok   " + label)
        else:
            print("  FAIL " + label)
            fails.append(label)

    def run(*args, env=None):
        p = subprocess.run([str(SCRIPT_ROOT / "scripts" / "hotfix.sh"), *map(str, args)], capture_output=True, text=True, env=env)
        return p.returncode, p.stdout, p.stderr

    def cmd(where, *args):
        p = subprocess.run(["git", "-C", str(where), *args], capture_output=True, text=True)
        if p.returncode:
            raise RuntimeError(p.stderr or p.stdout)
        return p.stdout.strip()

    with tempfile.TemporaryDirectory(prefix="postmaster-hotfix-") as temp:
        root = pathlib.Path(temp)
        tool = root / "tool"
        ext = root / "external"
        tool.mkdir()
        cmd(tool, "init", "-q", "-b", "main")
        cmd(tool, "config", "user.name", "brindlewick")
        cmd(tool, "config", "user.email", "332054101+brindlewick@users.noreply.github.com")
        (tool / "scripts").mkdir()
        (tool / "skills/postmaster").mkdir(parents=True)
        (tool / "scripts/verify.sh").write_text("#!/bin/sh\nprintf 'before\\n'\n", encoding="utf-8")
        (tool / "skills/postmaster/coachman.md").write_text("old runbook\n", encoding="utf-8")
        cmd(tool, "add", "scripts/verify.sh", "skills/postmaster/coachman.md")
        cmd(tool, "commit", "-qm", "base")
        base = cmd(tool, "rev-parse", "HEAD")

        def dispatch(project, name, branch=None, thread=True):
            d = project / ".postmaster/runs" / name
            d.mkdir(parents=True)
            manifest = {"stage": "checkpoint-1", "leg": 1, "base": base, "coachman": {"legs": {"1": {"thread_id": "thread-1"} if thread else {}}}}
            record = {"project": project.name, "run": name, "postmaster": {"commit": base, "checkout": str(tool)}}
            (d / "manifest.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            (d / "run.json").write_text(json.dumps(record) + "\n", encoding="utf-8")
            (d / "handoff-1.md").write_text("## Decisions\nx\n## Deferred findings\nx\n## Verified by execution\nx\n## Unverified\nx\n## Branches and lanes\nx\n## Open questions\nx\n## Next leg\nx\n", encoding="utf-8")
            (d / ".leg-1-done").touch()
            (d / ".leg-1-exited").touch()
            return d

        need = dispatch(tool, "RUN-NEED")
        cmd(tool, "branch", "RUN-NEED", base)
        cmd(tool, "worktree", "add", "-q", str(tool / ".worktrees/RUN-NEED"), "RUN-NEED")
        run_wt = tool / ".worktrees/RUN-NEED"
        (run_wt / "work.txt").write_text("run work\n", encoding="utf-8")
        cmd(run_wt, "add", "work.txt")
        cmd(run_wt, "commit", "-qm", "run work")

        ext.mkdir()
        cmd(ext, "init", "-q", "-b", "main")
        cmd(ext, "config", "user.name", "brindlewick")
        cmd(ext, "config", "user.email", "332054101+brindlewick@users.noreply.github.com")
        (ext / "readme.md").write_text("external\n", encoding="utf-8")
        cmd(ext, "add", "readme.md")
        cmd(ext, "commit", "-qm", "external")
        external = dispatch(ext, "RUN-CHECKOUT")

        (tool / "scripts/verify.sh").write_text("#!/bin/sh\nprintf 'after\\n'\n", encoding="utf-8")
        cmd(tool, "add", "scripts/verify.sh")
        cmd(tool, "commit", "-qm", "#132, Fix the verification check")
        fix = cmd(tool, "rev-parse", "HEAD")

        rc, report, err = run("report", tool, fix, tool, ext)
        ok("the same report command distinguishes a branch that needs the commit from a run served by the main checkout",
           rc == 0 and "RUN-NEED" in report and "route=branch" in report and "RUN-CHECKOUT" in report and "route=checkout" in report)
        ok("the report names both runs without reading unrelated worktrees", rc == 0 and not err)

        rc, out, err = run("queue", tool, fix, tool, ext)
        ok("queue logs and records a fix for the run branch", rc == 0 and "RUN-NEED" in out and (need / PENDING).is_file())
        before_apply = cmd(tool / ".worktrees/RUN-NEED", "rev-parse", "HEAD")
        prompt = need / "leg-2-prompt.txt"
        prompt.write_text("You are the coachman for leg 2.\n", encoding="utf-8")
        rc, out, err = run("next-leg", tool, need, "2", prompt)
        head = cmd(tool / ".worktrees/RUN-NEED", "rev-parse", "HEAD")
        subject = cmd(tool / ".worktrees/RUN-NEED", "show", "-s", "--format=%s", head)
        paths = cmd(tool / ".worktrees/RUN-NEED", "show", "--format=", "--name-only", head).splitlines()
        ledger = need.parent / "ledger.jsonl"
        parent = cmd(tool / ".worktrees/RUN-NEED", "rev-parse", "HEAD^")
        ok("the fix is one commit with a main-fix message and only the fixed file", rc == 0 and parent == before_apply and "main fix" in subject and paths == ["scripts/verify.sh"])
        ok("the next-leg prompt names the source commit and says not to merge main", "Main fix %s" % fix[:12] in prompt.read_text(encoding="utf-8") and "Do not merge main" in prompt.read_text(encoding="utf-8"))
        run_actions = (need / "actions.jsonl").read_text(encoding="utf-8").splitlines() if (need / "actions.jsonl").is_file() else []
        project_actions = ledger.read_text(encoding="utf-8").splitlines() if ledger.is_file() else []
        ok("apply is logged to the run and project ledgers", rc == 0 and any('"action":"apply"' in l for l in run_actions) and any('"action":"apply"' in l for l in project_actions))

        (tool / "skills/postmaster/coachman.md").write_text("fixed runbook\n", encoding="utf-8")
        cmd(tool, "add", "skills/postmaster/coachman.md")
        cmd(tool, "commit", "-qm", "#132, Fix the coachman runbook")
        runbook_fix = cmd(tool, "rev-parse", "HEAD")
        rc, report, err = run("report", tool, runbook_fix, ext)
        ok("a runbook already read is deferred to its next leg", rc == 0 and "RUN-CHECKOUT" in report and "route=next-leg" in report)

        conflict = dispatch(tool, "RUN-CONFLICT")
        cmd(tool, "branch", "RUN-CONFLICT", base)
        cmd(tool, "worktree", "add", "-q", str(tool / ".worktrees/RUN-CONFLICT"), "RUN-CONFLICT")
        conflict_wt = tool / ".worktrees/RUN-CONFLICT"
        (conflict_wt / "scripts/verify.sh").write_text("#!/bin/sh\nprintf 'branch version\\n'\n", encoding="utf-8")
        cmd(conflict_wt, "add", "scripts/verify.sh")
        cmd(conflict_wt, "commit", "-qm", "run overlaps the fix")
        rc, report, err = run("report", tool, fix, tool)
        ok("a same-line conflict is named and left for the second merger", rc == 0 and "RUN-CONFLICT" in report and "route=conflict" in report and "overlapping edits" in report)
        conflict_head = cmd(tool / ".worktrees/RUN-CONFLICT", "rev-parse", "HEAD")
        rc, out, err = run("queue", tool, fix, tool)
        unchanged = cmd(tool / ".worktrees/RUN-CONFLICT", "rev-parse", "HEAD") == conflict_head
        ok("a conflicting run branch remains untouched when fixes are queued", rc == 0 and unchanged and "left untouched" in out)

        # The prompt note for a runbook is added only after a clean between-leg stop.
        rc, out, err = run("queue", tool, runbook_fix, ext)
        prompt2 = external / "leg-2-prompt.txt"
        prompt2.write_text("You are the coachman for leg 2.\n", encoding="utf-8")
        rc2, out2, err2 = run("next-leg", tool, external, "2", prompt2)
        note = prompt2.read_text(encoding="utf-8")
        ok("the runbook note points the next leg to the merged file in the main checkout", rc == 0 and rc2 == 0 and "<tool>/skills/postmaster/coachman.md" in note and "Do not merge main" in note)

        # A mid-leg invocation is refused before any run branch or prompt is changed.
        late = dispatch(ext, "RUN-MID", thread=True)
        (late / ".leg-1-done").unlink()
        (late / ".leg-1-exited").unlink()
        mid_prompt = late / "leg-2-prompt.txt"
        mid_prompt.write_text("untouched\n", encoding="utf-8")
        rc, out, err = run("next-leg", tool, late, "2", mid_prompt)
        ok("a hotfix cannot be applied in the middle of a leg", rc == 1 and "completed hand-off boundary" in err and mid_prompt.read_text(encoding="utf-8") == "untouched\n")

    print()
    if fails:
        print("self-test: %d control(s) misbehaved" % len(fails))
        return 1
    print("self-test: all controls behaved")
    return 0


def main():
    if not ARGS:
        raise HotfixError("missing command")
    command = ARGS[0]
    if command == "--self-test":
        return self_test()
    if command in {"report", "queue"}:
        if len(ARGS) < 3:
            raise HotfixError("usage: hotfix.sh %s <tool-checkout> <fix-commit> [project-root ...]" % command)
        tool = require_tool(ARGS[1])
        if command == "report":
            output_report(tool, ARGS[2], ARGS[3:])
            return 0
        queue_fix(tool, ARGS[2], ARGS[3:])
        return 0
    if command == "next-leg":
        if len(ARGS) != 5:
            raise HotfixError("usage: hotfix.sh next-leg <tool-checkout> <dispatch> <leg> <prompt-file>")
        return do_next_leg(ARGS[1], ARGS[2], ARGS[3], ARGS[4])
    raise HotfixError("unknown command: %s" % command)


try:
    sys.exit(main())
except HotfixError as e:
    print("hotfix: " + str(e), file=sys.stderr)
    sys.exit(1)
PY
