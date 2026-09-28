#!/usr/bin/env bash
# Keep one postmaster worktree per dispatched commit while any run using it is in flight.
#
#   tool-pin.sh acquire <dispatch> <tool-repo> <commit>  acquire the shared checkout and run reference
#   tool-pin.sh release <dispatch> <tool-repo>  release a terminal run and reap the last pin
#   tool-pin.sh cancel <dispatch> <tool-repo>   undo an acquire if run-meta could not write
#   tool-pin.sh --self-test
#
# The registry lives under ~/.postmaster/tool-pins. POSTMASTER_TOOL_PINS may point it elsewhere
# for an isolated test. A run is in flight while its reference exists. Release requires a
# terminal manifest; done runs also need every coachman exit marker, and the postmaster releases
# abandoned runs only after it stops their processes and removes their worktrees. Registry
# changes for one commit share an advisory lock.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(dirname "$HERE")
TEST_TMP=
if [ "${1:-}" = "--self-test" ]; then
  TEST_TMP=$(mktemp -d -p "$ROOT" '.tool-pin-test.XXXXXX') || exit 1
  export POSTMASTER_TOOL_PINS="$TEST_TMP/pins"
  trap 'rm -r -- "$TEST_TMP" </dev/null 2>/dev/null' EXIT
fi
python3 - "$ROOT" "$0" "$TEST_TMP" "$@" <<'PY'
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(sys.argv[1]).resolve()
SCRIPT = pathlib.Path(sys.argv[2]).resolve()
TEST_TMP = sys.argv[3]
ARGS = sys.argv[4:]
PINS = pathlib.Path(os.environ.get(
    "POSTMASTER_TOOL_PINS", str(pathlib.Path.home() / ".postmaster" / "tool-pins")
)).expanduser().resolve()
TERMINAL = {"done", "abandoned"}


class PinError(Exception):
    pass


def fail(message):
    raise PinError(message)


def git(repo, *args, check=True):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True
    )
    if check and result.returncode:
        fail(result.stderr.strip() or "git %s failed" % " ".join(args))
    return result


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail("cannot read %s: %s" % (path, error))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".%s." % path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


@contextlib.contextmanager
def commit_lock(commit):
    PINS.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = PINS / (".%s.lock" % commit)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a+") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def dispatch_path(value):
    path = pathlib.Path(value).expanduser()
    if not path.is_dir():
        fail("no such dispatch directory: %s" % path)
    return path.resolve()


def tool_root(value, requested_commit=None):
    result = git(value, "rev-parse", "--show-toplevel")
    root = pathlib.Path(result.stdout.strip()).resolve()
    if requested_commit is None:
        commit = git(root, "rev-parse", "HEAD").stdout.strip()
    else:
        if len(requested_commit) != 40 or any(ch not in "0123456789abcdef" for ch in requested_commit):
            fail("requested tool commit must be a full commit id")
        resolved = git(root, "rev-parse", "--verify", requested_commit + "^{commit}", check=False)
        if resolved.returncode or resolved.stdout.strip() != requested_commit:
            fail("requested tool commit is not available in the tool repo: %s" % requested_commit)
        commit = requested_commit
    if len(commit) != 40 or any(ch not in "0123456789abcdef" for ch in commit):
        fail("tool repo did not report a full commit id")
    return root, commit


def layout(commit):
    pin_dir = PINS / commit
    return pin_dir, pin_dir / "checkout", pin_dir / "runs", pin_dir / "owner.json"


def reference_name(dispatch):
    return hashlib.sha256(str(dispatch).encode("utf-8")).hexdigest() + ".json"


def references(refs_dir):
    if not refs_dir.is_dir():
        return []
    return sorted(refs_dir.glob("*.json"))


def verify_checkout(checkout, commit):
    if not checkout.is_dir():
        return False
    actual = git(checkout, "rev-parse", "HEAD", check=False)
    top = git(checkout, "rev-parse", "--show-toplevel", check=False)
    if actual.returncode or top.returncode:
        fail("pinned path exists but is not a git worktree: %s" % checkout)
    if actual.stdout.strip() != commit or pathlib.Path(top.stdout.strip()).resolve() != checkout.resolve():
        fail("pinned path does not contain the requested commit: %s" % checkout)
    status = git(checkout, "status", "--porcelain", check=False)
    if status.returncode or status.stdout:
        fail("pinned worktree is not clean: %s" % checkout)
    return True


def acquire(dispatch_arg, repo_arg, requested_commit):
    dispatch = dispatch_path(dispatch_arg)
    manifest_path = dispatch / "manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("stage") != "dispatched":
        fail("a tool pin can only be acquired at dispatch (manifest stage must be dispatched)")
    repo, commit = tool_root(repo_arg, requested_commit)
    pin_dir, checkout, refs_dir, owner_file = layout(commit)
    ref = refs_dir / reference_name(dispatch)
    pending = dispatch / ".tool-pin-pending.json"

    with commit_lock(commit):
        refs_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if checkout.exists():
            verify_checkout(checkout, commit)
            if not owner_file.is_file():
                fail("pinned worktree has no owner record: %s" % checkout)
            if load_json(owner_file).get("commit") != commit:
                fail("pinned worktree owner record has a different commit")
        else:
            checkout.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            result = git(repo, "worktree", "add", "--detach", str(checkout), commit, check=False)
            if result.returncode:
                fail(result.stderr.strip() or "could not create pinned worktree")
            write_json(owner_file, {"repo": str(repo), "commit": commit})
            verify_checkout(checkout, commit)

        if ref.exists():
            saved = load_json(ref)
            if saved.get("dispatch") != str(dispatch) or saved.get("commit") != commit:
                fail("the dispatch already holds a different pin reference")
        else:
            write_json(ref, {"dispatch": str(dispatch), "commit": commit})
        write_json(pending, {"commit": commit, "path": str(checkout)})

    print(json.dumps({"commit": commit, "path": str(checkout)}, sort_keys=True))


def run_pin_record(dispatch):
    record_path = dispatch / "run.json"
    if not record_path.is_file():
        return None
    record = load_json(record_path)
    tool = record.get("tool")
    if not isinstance(tool, dict):
        return None
    commit = tool.get("commit")
    path = tool.get("path")
    if not isinstance(commit, str) or len(commit) != 40 or not isinstance(path, str):
        fail("run.json has a malformed tool pin")
    pin_dir, checkout, refs_dir, owner_file = layout(commit)
    if pathlib.Path(path).resolve() != checkout.resolve():
        fail("run.json tool path is not the managed checkout for its commit")
    return commit, checkout, refs_dir, owner_file


def resolve_tool(dispatch_arg):
    dispatch = dispatch_path(dispatch_arg)
    record_path = dispatch / "run.json"
    if record_path.is_file():
        record = load_json(record_path)
        tool = record.get("tool")
        if tool is not None:
            if not isinstance(tool, dict):
                fail("run.json has a malformed tool pin")
            commit, path = tool.get("commit"), tool.get("path")
            if not isinstance(commit, str) or len(commit) != 40 or not isinstance(path, str):
                fail("run.json has a malformed tool pin")
            pin_dir, checkout, _, _ = layout(commit)
            if pathlib.Path(path).resolve() != checkout.resolve():
                fail("run.json tool path is not the managed checkout for its commit")
            verify_checkout(checkout, commit)
            print(str(checkout))
            return

    brief = dispatch / "brief.md"
    if not brief.is_file():
        fail("run has no pinned run.json tool or legacy waybill")
    values = re.findall(r"(?m)^tool:\s*(.*?)\s*$", brief.read_text(encoding="utf-8"))
    if len(values) != 1 or not values[0]:
        fail("legacy waybill must contain exactly one tool: path")
    path = pathlib.Path(values[0]).expanduser()
    if not path.is_dir() or git(path, "rev-parse", "--git-dir", check=False).returncode:
        fail("legacy waybill tool path is not a git repo: %s" % path)
    print(str(path.resolve()))


def remove_empty(path):
    try:
        path.rmdir()
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("could not remove empty pin directory %s: %s" % (path, error))


def finish_release(dispatch, commit, checkout, refs_dir, owner_file, repo_arg):
    ref = refs_dir / reference_name(dispatch)
    released = dispatch / ".tool-pin-released"
    if released.is_file() and not ref.exists():
        print("tool-pin: this run's reference was already released")
        return

    with commit_lock(commit):
        if released.is_file() and not ref.exists():
            print("tool-pin: this run's reference was already released")
            return
        if not ref.is_file():
            fail("no tool pin reference exists for this run")
        marker = load_json(ref)
        if marker.get("dispatch") != str(dispatch) or marker.get("commit") != commit:
            fail("the tool pin reference does not belong to this run")

        others = [path for path in references(refs_dir) if path != ref]
        if others:
            if not checkout.is_dir():
                fail("pinned worktree is missing while another run still uses it: %s" % checkout)
            verify_checkout(checkout, commit)
            ref.unlink()
            try:
                (dispatch / ".tool-pin-pending.json").unlink()
            except FileNotFoundError:
                pass
            write_json(released, {"commit": commit, "path": str(checkout)})
            print("tool-pin: released this run; checkout remains for %d run(s)" % len(others))
            return

        pin_dir = checkout.parent
        if checkout.exists():
            verify_checkout(checkout, commit)
            if not owner_file.is_file():
                fail("pinned worktree has no owner record: %s" % checkout)
            owner = load_json(owner_file).get("repo")
            owner_path = pathlib.Path(owner).resolve() if isinstance(owner, str) else None
            if owner_path is None or not owner_path.is_dir():
                # A checkout can be shared by runs launched from another clone. Use that
                # caller's repo only when it is the same common Git repository.
                candidate, _ = tool_root(repo_arg)
                common_pin = git(checkout, "rev-parse", "--git-common-dir").stdout.strip()
                common_candidate = git(candidate, "rev-parse", "--git-common-dir").stdout.strip()
                common_pin_path = (checkout / common_pin).resolve() if not pathlib.Path(common_pin).is_absolute() else pathlib.Path(common_pin).resolve()
                common_candidate_path = (candidate / common_candidate).resolve() if not pathlib.Path(common_candidate).is_absolute() else pathlib.Path(common_candidate).resolve()
                if common_pin_path != common_candidate_path:
                    fail("the checkout's owning tool repo is gone; refusing to remove an unrelated worktree")
                owner_path = candidate
            result = git(owner_path, "worktree", "remove", str(checkout), check=False)
            if result.returncode:
                fail(result.stderr.strip() or "could not remove pinned worktree")

        ref.unlink()
        try:
            (dispatch / ".tool-pin-pending.json").unlink()
        except FileNotFoundError:
            pass
        try:
            owner_file.unlink()
        except FileNotFoundError:
            pass
        remove_empty(refs_dir)
        remove_empty(pin_dir)
        write_json(released, {"commit": commit, "path": str(checkout)})
        print("tool-pin: released the last run; removed %s" % checkout)


def release(dispatch_arg, repo_arg, cancel=False):
    dispatch = dispatch_path(dispatch_arg)
    if cancel:
        if (dispatch / "run.json").exists():
            fail("cannot cancel a pin after run.json has been written")
        pending = dispatch / ".tool-pin-pending.json"
        if not pending.is_file():
            print("tool-pin: no pending pin to cancel")
            return
        value = load_json(pending)
        commit, path = value.get("commit"), value.get("path")
        if not isinstance(commit, str) or not isinstance(path, str):
            fail("pending tool pin is malformed")
        pin_dir, checkout, refs_dir, owner_file = layout(commit)
        if pathlib.Path(path).resolve() != checkout.resolve():
            fail("pending tool path is not the managed checkout for its commit")
        pin = commit, checkout, refs_dir, owner_file
    else:
        pin = run_pin_record(dispatch)
    if pin is None:
        print("tool-pin: legacy run has no pinned checkout")
        return
    commit, checkout, refs_dir, owner_file = pin
    if cancel:
        finish_release(dispatch, commit, checkout, refs_dir, owner_file, repo_arg)
    else:
        manifest = load_json(dispatch / "manifest.json")
        if manifest.get("stage") not in TERMINAL:
            fail("cannot release a run whose manifest is not done or abandoned")
        if manifest.get("stage") == "done":
            legs = (manifest.get("coachman") or {}).get("legs") or {}
            for leg in legs:
                if not (dispatch / (".leg-%s-exited" % leg)).is_file():
                    fail("cannot release before coachman leg %s has exited" % leg)
        finish_release(dispatch, commit, checkout, refs_dir, owner_file, repo_arg)


def command(*args, env):
    return subprocess.run([str(SCRIPT), *map(str, args)], capture_output=True, text=True, env=env)


def self_test():
    temporary = pathlib.Path(TEST_TMP)
    repo = temporary / "tool"
    pins = temporary / "pins"
    dispatches = [temporary / "runs" / name for name in ("run-one", "run-two")]
    env = dict(os.environ, POSTMASTER_TOOL_PINS=str(pins))
    failures = []
    print("positive controls")

    def ok(label, condition):
        if condition:
            print("  ok   " + label)
        else:
            print("  FAIL " + label)
            failures.append(label)

    def init_git(*args, check=True):
        result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
        if check and result.returncode:
            raise PinError(result.stderr.strip())
        return result

    def commit_file(label):
        (repo / "skills" / "postmaster").mkdir(parents=True, exist_ok=True)
        (repo / "scripts").mkdir(parents=True, exist_ok=True)
        (repo / "skills" / "postmaster" / "coachman.md").write_text(
            "runbook:%s\n" % label, encoding="utf-8"
        )
        script = repo / "scripts" / "version-probe.sh"
        script.write_text("#!/usr/bin/env bash\nprintf 'script:%s\\n'\n" % label, encoding="utf-8")
        script.chmod(0o755)
        init_git("add", "skills/postmaster/coachman.md", "scripts/version-probe.sh")
        init_git(
            "-c", "user.name=brindlewick",
            "-c", "user.email=332054101+brindlewick@users.noreply.github.com",
            "commit", "-m", "set tool fixture to " + label,
        )
        return init_git("rev-parse", "HEAD").stdout.strip()

    def manifest(dispatch, stage="dispatched", legs=None):
        dispatch.mkdir(parents=True, exist_ok=True)
        value = {"stage": stage, "coachman": {"legs": legs or {}}}
        (dispatch / "manifest.json").write_text(json.dumps(value) + "\n", encoding="utf-8")

    def put_run_record(dispatch, commit, path):
        (dispatch / "run.json").write_text(
            json.dumps({"tool": {"commit": commit, "path": path}}) + "\n", encoding="utf-8"
        )
        (dispatch / "brief.md").write_text("tool: %s\n" % repo, encoding="utf-8")

    def pin_command(action, dispatch):
        args = [action, dispatch, repo]
        if action == "acquire":
            args.append(a)
        return command(*args, env=env)

    try:
        repo.mkdir()
        init_git("init", "-q", "-b", "main")
        a = commit_file("A")
        for dispatch in dispatches:
            manifest(dispatch)

        first = pin_command("acquire", dispatches[0])
        second = pin_command("acquire", dispatches[1])
        first_info = json.loads(first.stdout) if first.returncode == 0 else {}
        second_info = json.loads(second.stdout) if second.returncode == 0 else {}
        shared = first.returncode == 0 and second.returncode == 0 and first_info == second_info
        ok("runs at the same commit share one checkout", shared)
        pin_path = pathlib.Path(first_info.get("path", temporary / "missing"))
        pin_dir = pin_path.parent
        listed = init_git("-c", "core.quotePath=false", "worktree", "list", "--porcelain").stdout
        worktree_entries = [line[9:] for line in listed.splitlines() if line.startswith("worktree ")]
        ok("one worktree is registered for the shared commit", worktree_entries.count(str(pin_path)) == 1)

        for dispatch in dispatches:
            put_run_record(dispatch, a, str(pin_path))
        commit_file("B")

        late = temporary / "runs" / "run-late"
        manifest(late)
        acquired_late = pin_command("acquire", late)
        late_info = json.loads(acquired_late.stdout) if acquired_late.returncode == 0 else {}
        put_run_record(late, a, str(pin_path))
        ok(
            "a dispatch keeps its recorded commit after the source advances",
            acquired_late.returncode == 0 and late_info.get("commit") == a and late_info.get("path") == str(pin_path),
        )

        def probe_tool(path, expected):
            try:
                doc = (path / "skills/postmaster/coachman.md").read_text(encoding="utf-8").strip()
                result = subprocess.run(
                    [str(path / "scripts/version-probe.sh")], capture_output=True, text=True
                )
                return result.returncode == 0 and doc == "runbook:" + expected and result.stdout.strip() == "script:" + expected
            except OSError:
                return False

        resolved = command("resolve", dispatches[0], env=env)
        ok(
            "a later leg resolves its recorded tool and reads and runs the dispatched versions after the source advances",
            resolved.returncode == 0 and probe_tool(pathlib.Path(resolved.stdout.strip()), "A"),
        )

        print("negative controls")
        ok(
            "the same version probe rejects the advanced source checkout",
            not probe_tool(repo, "A"),
        )

        early = pin_command("release", dispatches[0])
        ok("an in-flight run cannot release its pin", early.returncode != 0 and pin_path.is_dir())

        manifest(late, "done")
        released_late = pin_command("release", late)
        ok("a run acquired after the source advances releases its shared reference", released_late.returncode == 0 and pin_path.is_dir())

        for dispatch in dispatches:
            manifest(dispatch, "done", {"1": {"thread_id": "fixture-thread"}})
            (dispatch / ".leg-1-exited").touch()
        released_one = pin_command("release", dispatches[0])
        remaining = list((pin_dir / "runs").glob("*.json")) if (pin_dir / "runs").is_dir() else []
        ok("releasing one run keeps the checkout for the other run", released_one.returncode == 0 and pin_path.is_dir() and len(remaining) == 1)
        released_two = pin_command("release", dispatches[1])
        ok("releasing the last run removes the shared checkout", released_two.returncode == 0 and not pin_path.exists() and not pin_dir.exists())

        legacy = temporary / "legacy"
        manifest(legacy, "done")
        (legacy / "run.json").write_text("{}\n", encoding="utf-8")
        (legacy / "brief.md").write_text("tool: %s\n" % repo, encoding="utf-8")
        old_tool = command("resolve", legacy, env=env)
        ok("an old waybill still resolves its original tool path", old_tool.returncode == 0 and old_tool.stdout.strip() == str(repo))
        old = pin_command("release", legacy)
        ok("an old run without a tool pin releases as a no-op", old.returncode == 0)
    except (OSError, PinError, json.JSONDecodeError) as error:
        print("  FAIL self-test setup: %s" % error)
        failures.append("self-test setup")

    if failures:
        print("self-test: %d control(s) misbehaved" % len(failures))
        return 1
    print("self-test: all controls behaved")
    return 0


def usage():
    print(
        "usage: tool-pin.sh resolve <dispatch> | acquire <dispatch> <tool-repo> <commit> | release <dispatch> <tool-repo> | cancel <dispatch> <tool-repo> | --self-test",
        file=sys.stderr,
    )
    return 2


def main():
    if ARGS == ["--self-test"]:
        return self_test()
    if len(ARGS) == 2 and ARGS[0] == "resolve":
        try:
            resolve_tool(ARGS[1])
            return 0
        except (PinError, OSError, json.JSONDecodeError) as error:
            print("tool-pin: %s" % error, file=sys.stderr)
            return 1
    if ARGS and ARGS[0] == "acquire" and len(ARGS) == 4:
        try:
            acquire(ARGS[1], ARGS[2], ARGS[3])
            return 0
        except (PinError, OSError, json.JSONDecodeError) as error:
            print("tool-pin: %s" % error, file=sys.stderr)
            return 1
    if len(ARGS) != 3 or ARGS[0] not in {"release", "cancel"}:
        return usage()
    action, dispatch_arg, repo_arg = ARGS
    try:
        release(dispatch_arg, repo_arg, cancel=(action == "cancel"))
        return 0
    except (PinError, OSError, json.JSONDecodeError) as error:
        print("tool-pin: %s" % error, file=sys.stderr)
        return 1


sys.exit(main())
PY
exit $?
