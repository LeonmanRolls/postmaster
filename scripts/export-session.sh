#!/usr/bin/env bash
# Copy a finished lane or coachman thread into its project-local run record.
#
#   export-session.sh <dispatch> <name> <harness> <cwd> <events> [<harness-data>]
#   export-session.sh --self-test
#
# launch.sh calls this after a run launch exits. The host supplies the exact events path; the
# thread id is read from that harness's stream. Each thread gets a separate file under
# <dispatch>/sessions/<name>/, so coachman legs and review rounds do not overwrite one another.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

python3 - "$HERE" "$@" <<'PY'
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

here = pathlib.Path(sys.argv[1]).resolve()
args = sys.argv[2:]

def die(message, code=1):
    print("export-session: " + message, file=sys.stderr)
    raise SystemExit(code)

def find_id(value, harness):
    if isinstance(value, dict):
        if harness == "muse":
            stream = value.get("stream")
            if isinstance(stream, dict) and stream.get("kind") == "session" and isinstance(stream.get("id"), str):
                return stream["id"]
        if harness == "pi" and value.get("type") == "session" and isinstance(value.get("id"), str):
            return value["id"]
        keys = {
            "codex": ("thread_id",),
            "grok": ("thread_id", "session_id", "sessionId", "conversationId", "uuid"),
            "agy": ("conversationId", "conversation_id"),
            "claude": ("session_id",),
            "pi": (),
            "muse": (),
            "mimo": ("sessionID", "session_id"),
        }.get(harness, ())
        for key in keys:
            if isinstance(value.get(key), str) and value[key]:
                return value[key]
        for item in value.values():
            found = find_id(item, harness)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_id(item, harness)
            if found:
                return found
    return None

def session_id(events, harness):
    try:
        lines = events.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as e:
        die("cannot read the events stream: %s" % e.strerror)
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        found = find_id(record, harness)
        if found:
            return found
    return None

def native_record(harness, thread, cwd):
    home = pathlib.Path.home()
    if harness == "codex":
        root = pathlib.Path(os.environ.get("CODEX_HOME", home / ".codex")) / "sessions"
    elif harness == "claude":
        root = pathlib.Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude")) / "projects"
    elif harness == "pi":
        root = home / ".pi" / "agent" / "sessions"
    else:
        return None
    if not root.is_dir():
        die("no durable %s session store is available" % harness)
    found = []
    try:
        for path in root.rglob("*.jsonl"):
            if thread in path.name:
                found.append(path)
    except OSError:
        pass
    if not found:
        die("no durable %s record was found for thread %s" % (harness, thread))
    found.sort(key=lambda p: (p.name == thread + ".jsonl", p.stat().st_mtime_ns), reverse=True)
    return found[0]

def external_export(harness, thread, data, destination):
    env = os.environ.copy()
    command = None
    if harness == "grok":
        command = ["grok", "export", thread]
    elif harness == "muse":
        if not data:
            die("the run did not record a Muse data directory")
        env["XDG_DATA_HOME"] = data
        command = ["muse", "export", "--session", thread, "--out", str(destination)]
    elif harness == "mimo":
        if not data:
            die("the run did not record a MiMo data directory")
        env["XDG_DATA_HOME"] = data
        env["MIMOCODE_DISABLE_CLAUDE_IMPORT"] = "1"
        command = ["mimo", "export", thread]
    if command is None:
        return False
    try:
        result = subprocess.run(command, capture_output=True, env=env, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        die("%s export failed: %s" % (harness, type(e).__name__))
    if result.returncode:
        die("%s export failed with exit %s" % (harness, result.returncode))
    if harness != "muse":
        destination.write_bytes(result.stdout)
    if not destination.is_file() or destination.stat().st_size == 0:
        die("%s export produced no durable session" % harness)
    return True

def export(dispatch_raw, name, harness, cwd_raw, events_raw, data):
    dispatch = pathlib.Path(dispatch_raw)
    if dispatch.is_symlink() or not dispatch.is_dir():
        die("dispatch must be a real run directory")
    dispatch = dispatch.resolve()
    runs = dispatch.parent
    if runs.name != "runs" or runs.parent.name != ".postmaster":
        die("dispatch must be under <project>/.postmaster/runs")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
        die("name must be a lane or role name")
    if harness not in {"codex", "grok", "agy", "claude", "pi", "muse", "mimo"}:
        die("unknown harness: %s" % harness)
    cwd = pathlib.Path(cwd_raw).resolve()
    if not cwd.is_dir():
        die("launch directory is missing")
    events = pathlib.Path(events_raw)
    if events.is_symlink() or not events.is_file():
        die("events stream is missing or not a regular file")
    if events.resolve().parent != (dispatch / "logs").resolve():
        die("events stream must be a direct file in the run's logs directory")
    thread = session_id(events, harness)
    if not thread or not re.fullmatch(r"[A-Za-z0-9_.-]+", thread):
        die("no safe %s thread id appears in the events stream" % harness)

    extension = {"grok": ".md", "agy": ".events.jsonl", "muse": ".json", "mimo": ".export"}.get(harness, ".jsonl")
    session_root = dispatch / "sessions"
    if session_root.is_symlink():
        die("session export directory must not be a symlink")
    session_root.mkdir(exist_ok=True)
    folder = session_root / name
    if folder.is_symlink():
        die("session export directory must not be a symlink")
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / (thread + extension)
    if destination.is_symlink():
        die("session export destination must not be a symlink")
    fd, temp_name = tempfile.mkstemp(prefix="." + thread + ".", dir=folder)
    os.close(fd)
    temporary = pathlib.Path(temp_name)
    try:
        if harness in {"codex", "claude", "pi"}:
            shutil.copyfile(native_record(harness, thread, cwd), temporary)
        elif harness == "agy":
            # Antigravity exposes no export command; its complete stream is the durable transcript.
            shutil.copyfile(events, temporary)
        else:
            external_export(harness, thread, data, temporary)
        if not temporary.is_file() or temporary.stat().st_size == 0:
            die("%s produced an empty session export" % harness)
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    print("export-session: saved %s thread %s" % (harness, thread), file=sys.stderr)

def self_test():
    root = pathlib.Path(tempfile.mkdtemp(prefix="export-session-test-"))
    try:
        repo = root / "repo"
        dispatch = repo / ".postmaster" / "runs" / "RUN-1"
        cwd = root / "worktree"
        home = root / "home"
        bin_dir = root / "bin"
        (dispatch / "logs").mkdir(parents=True); cwd.mkdir(); home.mkdir(); bin_dir.mkdir()
        env = {**os.environ, "HOME": str(home), "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", "")}
        count = 0
        def check(harness, thread, row, native=None, data=""):
            nonlocal count
            events = dispatch / "logs" / (harness + ".jsonl")
            events.write_text(json.dumps(row) + "\n", encoding="utf-8")
            if native:
                path = home / native
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("durable " + thread + "\n", encoding="utf-8")
            result = subprocess.run(
                [str(here / "export-session.sh"), str(dispatch), "lane", harness, str(cwd), str(events), data],
                capture_output=True, text=True, env=env, timeout=10,
            )
            assert result.returncode == 0, result.stderr
            suffix = {"grok": ".md", "agy": ".events.jsonl", "muse": ".json", "mimo": ".export"}.get(harness, ".jsonl")
            saved = dispatch / "sessions" / "lane" / (thread + suffix)
            assert saved.is_file() and saved.stat().st_size > 0
            count += 1

        # Native local stores are copied without reading or printing their contents.
        check("codex", "thread-codex", {"type": "thread.started", "thread_id": "thread-codex"}, ".codex/sessions/rollout-thread-codex.jsonl")
        check("claude", "thread-claude", {"session_id": "thread-claude"}, ".claude/projects/project/thread-claude.jsonl")
        check("pi", "thread-pi", {"type": "session", "id": "thread-pi"}, ".pi/agent/sessions/--project--/thread-pi.jsonl")
        check("agy", "thread-agy", {"conversationId": "thread-agy"})

        (bin_dir / "grok").write_text("#!/bin/sh\nprintf 'grok export %s\\n' \"$2\"\n", encoding="utf-8")
        (bin_dir / "grok").chmod(0o755)
        check("grok", "thread-grok", {"thread_id": "thread-grok"})
        (bin_dir / "muse").write_text("#!/bin/sh\n[ \"$1\" = export ] && { printf 'muse session\\n' > \"$5\"; exit 0; }\nexit 1\n", encoding="utf-8")
        (bin_dir / "muse").chmod(0o755)
        check("muse", "thread-muse", {"stream": {"kind": "session", "id": "thread-muse"}}, data=str(root / "muse-data"))
        (bin_dir / "mimo").write_text("#!/bin/sh\n[ \"$1\" = export ] && { printf 'mimo session\\n'; exit 0; }\nexit 1\n", encoding="utf-8")
        (bin_dir / "mimo").chmod(0o755)
        check("mimo", "thread-mimo", {"sessionID": "thread-mimo"}, data=str(root / "mimo-data"))
        assert count == 7
        print("self-test: all controls behaved")
    finally:
        shutil.rmtree(root, ignore_errors=True)

if args == ["--self-test"]:
    self_test(); raise SystemExit(0)
if len(args) != 6:
    die("usage: export-session.sh <dispatch> <name> <harness> <cwd> <events> [<harness-data>] | --self-test")
export(*args[:5], args[5])
PY
