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

# A caller may be in the target worktree (launch.sh cds there first), so do not
# import modules from that worktree by accident.
python3 -I - "$HERE" "$@" <<'PY'
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

def top_id(record, harness):
    # The record's own identity, without descending: a nested id inside an
    # earlier tool result must not win over a later top-level session identity.
    if not isinstance(record, dict):
        return None
    if harness == "muse":
        stream = record.get("stream")
        if isinstance(stream, dict) and stream.get("kind") == "session" and isinstance(stream.get("id"), str):
            return stream["id"]
    if harness == "pi" and record.get("type") == "session" and isinstance(record.get("id"), str):
        return record["id"]
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
        if isinstance(record.get(key), str) and record[key]:
            return record[key]
    return None

def session_id(events, harness):
    try:
        lines = events.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as e:
        die("cannot read the events stream: %s" % e.strerror)
    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except ValueError:
            continue
    for record in records:
        found = top_id(record, harness)
        if found:
            return found
    for record in records:
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
    # A store holds many threads, and one id can hide inside another
    # (thread-1 inside thread-10, or inside other-thread-1), so neither a
    # substring nor a bare dash-suffix is a match. Codex names files
    # rollout-<timestamp>-<thread>.jsonl with a fixed timestamp shape, and only
    # that shape is matched; claude and pi name the file for the thread exactly.
    # If codex ever changes its timestamp shape this fails loudly, refusing the
    # export, rather than silently misattributing another session.
    codex_stem = re.compile(r"rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-" + re.escape(thread) + r"\Z")
    exact, suffixed = [], []
    try:
        for path in root.rglob("*.jsonl"):
            stem = path.name[:-len(".jsonl")]
            if stem == thread:
                exact.append(path)
            elif harness == "codex" and codex_stem.match(stem):
                suffixed.append(path)
    except OSError:
        pass
    found = exact or suffixed
    if not found:
        die("no durable %s record was found for thread %s" % (harness, thread))
    # Thread ids are unique, so several records for one thread should not happen;
    # the newest is kept (a codex thread spanning midnight owns one file per day),
    # loudly rather than silently.
    if len(found) > 1:
        print("export-session: %d %s records name thread %s; keeping the newest" % (len(found), harness, thread),
              file=sys.stderr)
    found.sort(key=lambda p: p.stat().st_mtime_ns, reverse=True)
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
        # A run dispatched under the old layout finishes where it started:
        # nothing to export into, and the launch's own exit stands.
        print("export-session: %s is not under <project>/.postmaster/runs; skipping" % dispatch, file=sys.stderr)
        return
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
        # Store locations come from the planted HOME, never the machine's own.
        env.pop("CODEX_HOME", None)
        env.pop("CLAUDE_CONFIG_DIR", None)
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
        check("codex", "thread-codex", {"type": "thread.started", "thread_id": "thread-codex"}, ".codex/sessions/2026/01/03/rollout-2026-01-03T00-00-00-thread-codex.jsonl")
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
        codex_sessions = home / ".codex" / "sessions"
        (codex_sessions / "2026" / "01" / "01").mkdir(parents=True, exist_ok=True)
        (codex_sessions / "2026" / "01" / "02").mkdir(parents=True, exist_ok=True)
        right = codex_sessions / "2026" / "01" / "01" / "rollout-2026-01-01T00-00-00-thread-1.jsonl"
        wrong = codex_sessions / "2026" / "01" / "02" / "rollout-2026-01-02T00-00-00-thread-10.jsonl"
        right.write_text("RIGHT thread one\n", encoding="utf-8")
        wrong.write_text("WRONG thread ten\n", encoding="utf-8")
        os.utime(right, (1000000000, 1000000000))
        os.utime(wrong, (1100000000, 1100000000))
        decoy_events = dispatch / "logs" / "decoy.jsonl"
        decoy_events.write_text(json.dumps({"type": "thread.started", "thread_id": "thread-1"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "codex", str(cwd), str(decoy_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 0, result.stderr
        saved = (dispatch / "sessions" / "lane" / "thread-1.jsonl").read_text(encoding="utf-8")
        assert saved == "RIGHT thread one\n", "export copied the newer prefix-sharing decoy"
        print("  ok   a newer thread whose id extends the thread's does not shadow its session")
        lone_home = root / "lone-home"
        lone_sessions = lone_home / ".codex" / "sessions" / "2026" / "01" / "04"
        lone_sessions.mkdir(parents=True, exist_ok=True)
        (lone_sessions / "rollout-2026-01-04T00-00-00-other-thread-1.jsonl").write_text(
            "WRONG other thread\n", encoding="utf-8")
        lone_env = {**env, "HOME": str(lone_home)}
        lone_events = dispatch / "logs" / "suffix.jsonl"
        lone_events.write_text(json.dumps({"type": "thread.started", "thread_id": "thread-1"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lone", "codex", str(cwd), str(lone_events), ""],
            capture_output=True, text=True, env=lone_env, timeout=10,
        )
        assert result.returncode == 1 and "no durable codex record was found" in result.stderr, result.stderr
        print("  ok   a thread whose id extends the thread's with a dash does not shadow its session")
        claude_dir = home / ".claude" / "projects" / "project"
        claude_dir.mkdir(parents=True, exist_ok=True)
        (claude_dir / "thread-2.jsonl").write_text("RIGHT exact\n", encoding="utf-8")
        (claude_dir / "other-thread-2.jsonl").write_text("WRONG suffix\n", encoding="utf-8")
        os.utime(claude_dir / "thread-2.jsonl", (1000000000, 1000000000))
        os.utime(claude_dir / "other-thread-2.jsonl", (1100000000, 1100000000))
        decoy2_events = dispatch / "logs" / "decoy2.jsonl"
        decoy2_events.write_text(json.dumps({"session_id": "thread-2"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "claude", str(cwd), str(decoy2_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 0, result.stderr
        saved = (dispatch / "sessions" / "lane" / "thread-2.jsonl").read_text(encoding="utf-8")
        assert saved == "RIGHT exact\n", "export preferred a suffixed decoy over the exact file"
        print("  ok   an exact store file wins over a newer suffixed decoy")
        lone_dir = home / ".claude" / "projects" / "lone"
        lone_dir.mkdir(parents=True, exist_ok=True)
        (lone_dir / "other-thread-9.jsonl").write_text("DECOY\n", encoding="utf-8")
        lone_events = dispatch / "logs" / "lone.jsonl"
        lone_events.write_text(json.dumps({"session_id": "thread-9"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "claude", str(cwd), str(lone_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 1 and "no durable claude record was found" in result.stderr, result.stderr
        print("  ok   a suffixed decoy alone is no record for claude")
        nested_events = dispatch / "logs" / "nested.jsonl"
        nested_events.write_text(
            json.dumps({"type": "tool_result", "result": {"session_id": "WRONG-nested"}}) + "\n"
            + json.dumps({"type": "session", "session_id": "RIGHT-top"}) + "\n", encoding="utf-8")
        (claude_dir / "WRONG-nested.jsonl").write_text("WRONG\n", encoding="utf-8")
        (claude_dir / "RIGHT-top.jsonl").write_text("RIGHT\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "claude", str(cwd), str(nested_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 0, result.stderr
        saved = (dispatch / "sessions" / "lane" / "RIGHT-top.jsonl").read_text(encoding="utf-8")
        assert saved == "RIGHT\n", "a nested id beat the top-level session identity"
        print("  ok   a top-level session id wins over a nested id in an earlier line")
        span_old = codex_sessions / "2026" / "01" / "01" / "rollout-2026-01-01T23-59-00-thread-7.jsonl"
        span_new = codex_sessions / "2026" / "01" / "02" / "rollout-2026-01-02T00-01-00-thread-7.jsonl"
        span_old.write_text("OLD segment\n", encoding="utf-8")
        span_new.write_text("NEW segment\n", encoding="utf-8")
        os.utime(span_old, (1000000000, 1000000000))
        os.utime(span_new, (1100000000, 1100000000))
        span_events = dispatch / "logs" / "span.jsonl"
        span_events.write_text(json.dumps({"type": "thread.started", "thread_id": "thread-7"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "codex", str(cwd), str(span_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 0, result.stderr
        saved = (dispatch / "sessions" / "lane" / "thread-7.jsonl").read_text(encoding="utf-8")
        assert saved == "NEW segment\n", "several records kept the older one"
        assert "2 codex records name thread thread-7; keeping the newest" in result.stderr, result.stderr
        print("  ok   several records for one thread keep the newest, loudly")
        shadow = root / "shadow"; shadow.mkdir()
        (shadow / "json.py").write_text(
            'import pathlib\npathlib.Path(r"%s").write_text("imported")\nraise SystemExit("shadow")\n' % (shadow / "marker"),
            encoding="utf-8")
        shadow_events = dispatch / "logs" / "shadow.jsonl"
        shadow_events.write_text(json.dumps({"conversationId": "thread-shadow"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(dispatch), "lane", "agy", str(shadow), str(shadow_events), ""],
            capture_output=True, text=True, env=env, timeout=10, cwd=shadow,
        )
        assert result.returncode == 0, result.stderr
        assert not (shadow / "marker").exists(), "a worktree module shadowed the exporter"
        assert (dispatch / "sessions" / "lane" / "thread-shadow.events.jsonl").is_file()
        print("  ok   worktree modules cannot shadow the exporter's standard library imports")
        legacy = root / "legacy" / "RUN-0"
        (legacy / "logs").mkdir(parents=True)
        legacy_events = legacy / "logs" / "lane.jsonl"
        legacy_events.write_text(json.dumps({"type": "thread.started", "thread_id": "thread-old"}) + "\n", encoding="utf-8")
        result = subprocess.run(
            [str(here / "export-session.sh"), str(legacy), "lane", "codex", str(cwd), str(legacy_events), ""],
            capture_output=True, text=True, env=env, timeout=10,
        )
        assert result.returncode == 0 and not (legacy / "sessions").exists(), result.stderr
        print("  ok   a dispatch outside the project run root is skipped, not failed")
        print("self-test: all controls behaved")
    finally:
        shutil.rmtree(root, ignore_errors=True)

if args == ["--self-test"]:
    self_test(); raise SystemExit(0)
if len(args) != 6:
    die("usage: export-session.sh <dispatch> <name> <harness> <cwd> <events> [<harness-data>] | --self-test")
export(*args[:5], args[5])
PY
