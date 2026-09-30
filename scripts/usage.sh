#!/usr/bin/env bash
# Read what a launch cost from its harness's own event stream or session record, keep it in the
# run's records per role and lane, and sum it for the closing record. The per-harness reading
# lives here, behind the harness adapter (skills/postmaster/harnesses.md): this script is that
# reading's executable form. A figure the harness did not report is omitted and never written as
# zero; a harness that reports nothing is named as reporting nothing.
#
#   usage.sh read <events> <harness> [<session>]    print one JSON object of the figures the
#                                                   harness reports in that stream (or, where it
#                                                   reports usage only in its session record, in
#                                                   that record)
#   usage.sh record <events> <harness> <name> <dispatch> [--role <role>] [--lane <lane>]
#                                                   write <dispatch>/logs/<events-basename>-usage.json
#   usage.sh sum <dispatch>                         the closing block: figures summed per role and
#                                                   lane, and which harnesses report nothing
#   usage.sh --self-test
#
# Roles are workhorse, reviewer and coachman. A lane is the workhorse's or reviewer's lane name,
# or the coachman leg. Recording is best-effort like export-session.sh: a fault warns and leaves
# the launch's own exit alone. `sum` is what the closing record quotes; it never invents a figure.
#
#   exit 0  read, recorded or summed
#   exit 1  usage, an unreadable stream or dispatch, or the self-test failed
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

# A caller may be in the target worktree (launch.sh cds there first), so do not
# import modules from that worktree by accident.
python3 -I - "$HERE" "$@" <<'PY'
import json
import os
import pathlib
import re
import sys

here = pathlib.Path(sys.argv[1]).resolve()
args = sys.argv[2:]

def die(message, code=1):
    print("usage: " + message, file=sys.stderr)
    raise SystemExit(code)

def number(value):
    """An int or float the harness reported, else None. Never a stand-in for a missing figure."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    return None

def take(dst, key, value):
    v = number(value)
    if v is not None and key not in dst:
        dst[key] = v

def add(dst, key, value):
    v = number(value)
    if v is None:
        return
    if key in dst:
        dst[key] = dst[key] + v
    else:
        dst[key] = v

def load_records(path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        die("cannot read %s: %s" % (path, e.strerror))
    records = []
    if not text.strip():
        return records
    # A session export is one JSON document; an events stream is JSONL. Both may appear.
    stripped = text.lstrip()
    if stripped.startswith("{") and "\n" not in stripped.rstrip("\n"):
        text = text.rstrip("\n")
    try:
        doc = json.loads(text)
    except ValueError:
        doc = None
    if isinstance(doc, dict) and isinstance(doc.get("events"), list):
        for item in doc["events"]:
            if isinstance(item, dict):
                records.append(item)
        return records
    if isinstance(doc, list):
        return [r for r in doc if isinstance(r, dict)]
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            records.append(obj)
    return records

def dig(obj, *path):
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur

def payload_of(record):
    """Muse export records nest the event under envelope.payload; streams use payload."""
    for path in (("envelope", "payload"), ("payload",)):
        p = dig(record, *path)
        if isinstance(p, dict):
            return p
    return record if isinstance(record, dict) else {}

def usage_pairs_claude(records):
    """Claude reports the run on its result event: usage there, and total_cost_usd as cost."""
    out = {}
    result_usage = {}
    per_message = {}
    for r in records:
        t = r.get("type")
        if t == "result":
            u = r.get("usage") or {}
            if isinstance(u, dict):
                take(result_usage, "input_tokens", u.get("input_tokens"))
                take(result_usage, "output_tokens", u.get("output_tokens"))
            take(result_usage, "cost_usd", r.get("total_cost_usd"))
        elif t == "assistant" and isinstance(r.get("message"), dict):
            u = r["message"].get("usage") or {}
            if isinstance(u, dict):
                add(per_message, "input_tokens", u.get("input_tokens"))
                add(per_message, "output_tokens", u.get("output_tokens"))
    if result_usage:
        # The result is the run's own report. Do not also add the per-message figures it already
        # covers; a stream that ends without a result is summed from its messages instead.
        out.update(result_usage)
    else:
        out.update(per_message)
    return out

def usage_pairs_codex(records):
    """Codex reports one usage object per turn.completed; the launch is their sum."""
    out = {}
    for r in records:
        if r.get("type") == "turn.completed" and isinstance(r.get("usage"), dict):
            u = r["usage"]
            add(out, "input_tokens", u.get("input_tokens"))
            add(out, "output_tokens", u.get("output_tokens"))
    return out

def usage_pairs_mimo(records):
    """MiMo Code puts tokens and cost on each step_finish part."""
    out = {}
    for r in records:
        if r.get("type") != "step_finish":
            continue
        part = r.get("part") or {}
        if not isinstance(part, dict):
            continue
        tokens = part.get("tokens") or {}
        if isinstance(tokens, dict):
            add(out, "input_tokens", tokens.get("input"))
            add(out, "output_tokens", tokens.get("output"))
        add(out, "cost_usd", part.get("cost"))
    return out

def usage_pairs_muse(records):
    """Muse Code reports model tokens in the session record's goal_usage_attribution, not in
    the event stream (a tool result's original_output_tokens is tool output, not model usage)."""
    out = {}
    for r in records:
        p = payload_of(r)
        ev = p.get("event") if isinstance(p.get("event"), dict) else p
        if not isinstance(ev, dict):
            continue
        if ev.get("kind") != "goal_usage_attribution":
            continue
        rec = ev.get("record") or {}
        q = rec.get("quantity") if isinstance(rec, dict) else None
        if not isinstance(q, dict):
            q = ev.get("quantity") if isinstance(ev.get("quantity"), dict) else None
        if not isinstance(q, dict):
            continue
        if q.get("reported") is False:
            continue
        add(out, "input_tokens", q.get("input_tokens"))
        add(out, "output_tokens", q.get("output_tokens"))
    return out

def usage_pairs_pi(records):
    """Pi carries usage on the assistant message (and on its own usage rows)."""
    out = {}
    for r in records:
        if r.get("type") == "usage":
            for candidate in (r.get("usage"), dig(r, "row", "usage")):
                if isinstance(candidate, dict):
                    take(out, "input_tokens", candidate.get("input_tokens", candidate.get("input")))
                    take(out, "output_tokens", candidate.get("output_tokens", candidate.get("output")))
                    cost = candidate.get("cost")
                    take(out, "cost_usd", cost.get("total") if isinstance(cost, dict) else cost)
                    if "input_tokens" in out or "output_tokens" in out:
                        break
            continue
        if r.get("type") not in ("message_end", "turn_end"):
            continue
        m = r.get("message") or {}
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        u = m.get("usage")
        if not isinstance(u, dict):
            continue
        add(out, "input_tokens", u.get("input_tokens", u.get("input")))
        add(out, "output_tokens", u.get("output_tokens", u.get("output")))
        cost = u.get("cost")
        add(out, "cost_usd", cost.get("total") if isinstance(cost, dict) else cost)
    return out

def last_usage_metadata(records):
    """Gemini-family streams repeat one request's usageMetadata on its chunks; the last one of
    each run of identical figures is that request's report. Consecutive identical reports are one
    request; a change starts the next."""
    out = {}
    last = None
    for r in records:
        um = r.get("usageMetadata") or dig(r, "response", "usageMetadata") or dig(r, "message", "usageMetadata")
        if not isinstance(um, dict):
            continue
        pair = (number(um.get("promptTokenCount")), number(um.get("candidatesTokenCount")))
        if pair == last:
            continue
        last = pair
        add(out, "input_tokens", um.get("promptTokenCount"))
        add(out, "output_tokens", um.get("candidatesTokenCount"))
    return out

def usage_pairs_grok(records):
    """Grok's streaming-json carries usage under usage or token_usage, OpenAI-compatible names."""
    out = {}
    last = None
    for r in records:
        u = r.get("usage") or r.get("token_usage") or dig(r, "message", "usage")
        if not isinstance(u, dict):
            continue
        pair = (
            number(u.get("input_tokens", u.get("prompt_tokens"))),
            number(u.get("output_tokens", u.get("completion_tokens"))),
        )
        if pair == last or pair == (None, None):
            continue
        last = pair
        add(out, "input_tokens", u.get("input_tokens", u.get("prompt_tokens")))
        add(out, "output_tokens", u.get("output_tokens", u.get("completion_tokens")))
        take(out, "cost_usd", u.get("cost_usd") or u.get("total_cost_usd"))
    return out

READERS = {
    "claude": usage_pairs_claude,
    "codex": usage_pairs_codex,
    "mimo": usage_pairs_mimo,
    "muse": usage_pairs_muse,
    "pi": usage_pairs_pi,
    "agy": last_usage_metadata,
    "grok": usage_pairs_grok,
}

def read_figures(events_path, harness, session_path=None):
    if harness not in READERS:
        die("unknown harness: %s" % harness)
    records = load_records(events_path)
    figures = READERS[harness](records)
    if session_path:
        more = READERS[harness](load_records(session_path))
        for key, value in more.items():
            if key in figures:
                # The stream and the session record can both carry the same report. Keep the
                # larger single reading rather than adding a figure twice; when only one side
                # reports, that report stands.
                if number(value) is not None and number(figures[key]) is not None:
                    figures[key] = max(figures[key], value)
            else:
                figures[key] = value
    return figures

def read_cmd(argv):
    if not argv or argv[0] in ("-h", "--help"):
        die("read <events> <harness> [<session>]")
    events = pathlib.Path(argv[0])
    harness = argv[1] if len(argv) > 1 else ""
    session = pathlib.Path(argv[2]) if len(argv) > 2 else None
    if len(argv) > 3:
        die("read <events> <harness> [<session>]")
    if not harness:
        die("read <events> <harness> [<session>]")
    if not events.is_file():
        die("no such events stream: %s" % events)
    if session is not None and not session.is_file():
        die("no such session record: %s" % session)
    print(json.dumps(read_figures(events, harness, session), sort_keys=True))

def record_cmd(argv):
    role = "workhorse"
    lane = None
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--role":
            i += 1
            if i >= len(argv):
                die("record: --role needs a value")
            role = argv[i]
        elif a == "--lane":
            i += 1
            if i >= len(argv):
                die("record: --lane needs a value")
            lane = argv[i]
        else:
            rest.append(a)
        i += 1
    if len(rest) != 4:
        die("record <events> <harness> <name> <dispatch> [--role <role>] [--lane <lane>]")
    events, harness, name, dispatch_raw = rest
    if role not in ("workhorse", "reviewer", "coachman"):
        die("record: role must be workhorse, reviewer or coachman")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
        die("name must be a lane or role name")
    events_path = pathlib.Path(events)
    if not events_path.is_file():
        die("no such events stream: %s" % events_path)
    dispatch = pathlib.Path(dispatch_raw)
    if not dispatch.is_dir():
        die("no such dispatch directory: %s" % dispatch)
    logs = dispatch / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    stem = events_path.name
    if stem.endswith(".jsonl"):
        stem = stem[: -len(".jsonl")]
    out_path = logs / (stem + "-usage.json")
    figures = read_figures(events_path, harness)
    # Where the harness reports usage only in its session record (muse), the exported session
    # under <dispatch>/sessions/<name>/ is the reading. Merge it rather than adding it twice.
    sessions = dispatch / "sessions" / name
    if sessions.is_dir():
        for path in sorted(sessions.iterdir()):
            if not path.is_file():
                continue
            more = read_figures(events_path, harness, path)
            for key, value in more.items():
                if key in figures and number(figures[key]) is not None and number(value) is not None:
                    figures[key] = max(figures[key], value)
                elif key not in figures:
                    figures[key] = value
    record = {
        "name": name,
        "role": role,
        "lane": lane if lane is not None else name,
        "harness": harness,
        "stream": "logs/" + events_path.name,
    }
    for key in ("input_tokens", "output_tokens", "cost_usd"):
        if key in figures:
            record[key] = figures[key]
    tmp = out_path.with_name("." + out_path.name + ".tmp")
    tmp.write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, out_path)

def sum_cmd(argv):
    if len(argv) != 1:
        die("sum <dispatch>")
    dispatch = pathlib.Path(argv[0])
    logs = dispatch / "logs"
    if not logs.is_dir():
        die("no such dispatch directory: %s" % dispatch)
    rows = []
    for path in sorted(logs.glob("*-usage.json")):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("cost: %s could not be read" % path.name)
            continue
        if isinstance(rec, dict):
            rows.append(rec)
    groups = {}
    order = []
    for rec in rows:
        role = rec.get("role") or "workhorse"
        lane = rec.get("lane") or rec.get("name") or "?"
        harness = rec.get("harness") or "?"
        key = (role, lane)
        if key not in groups:
            groups[key] = {"harnesses": [], "launches": 0, "figures": {"input_tokens": [], "output_tokens": [], "cost_usd": []}}
            order.append(key)
        g = groups[key]
        if harness not in g["harnesses"]:
            g["harnesses"].append(harness)
        g["launches"] += 1
        for fig in ("input_tokens", "output_tokens", "cost_usd"):
            if fig in rec and number(rec[fig]) is not None:
                g["figures"][fig].append(rec[fig])
    nothing = []
    for rec in rows:
        if not any(fig in rec and number(rec[fig]) is not None for fig in ("input_tokens", "output_tokens", "cost_usd")):
            h = rec.get("harness")
            if h and h not in nothing:
                nothing.append(h)

    def money(total):
        if float(total).is_integer():
            return "$%d" % int(total)
        return "$%.4f" % total

    def figure(g, fig, label):
        values = g["figures"][fig]
        launches = g["launches"]
        if not values:
            return "cost not reported" if fig == "cost_usd" else label + " not reported"
        total = sum(values)
        shown = money(total) if fig == "cost_usd" else "%s %s" % (int(total) if float(total).is_integer() else total, label)
        if len(values) == launches:
            return shown
        return "%s (%d of %d launches)" % (shown, len(values), launches)

    for key in order:
        role, lane = key
        g = groups[key]
        harnesses = ",".join(g["harnesses"])
        parts = [figure(g, fig, label) for fig, label in (("input_tokens", "in"), ("output_tokens", "out"), ("cost_usd", "cost"))]
        print("cost: %s %s (%s): %s" % (role, lane, harnesses, ", ".join(parts)))
    for h in nothing:
        print("cost: harness %s reports nothing" % h)
    if not rows:
        print("cost: no launch recorded usage")

def self_test():
    fixtures = here / "fixtures" / "usage"
    fails = [0]

    def ok(label):
        print("  ok   %s" % label)

    def fail(label, detail=""):
        print("  FAIL %s" % label)
        if detail:
            print("         %s" % detail)
        fails[0] += 1

    def run_read(events, harness, session=None):
        cmd = ["bash", str(here / "usage.sh"), "read", str(events), harness]
        if session:
            cmd.append(str(session))
        import subprocess
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return None, r.stderr.strip()
        try:
            return json.loads(r.stdout), ""
        except ValueError:
            return None, r.stdout

    pairs = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"]
    print("positive controls: a stream that reports usage reads its figures")
    expected = {
        "claude": {"input_tokens": 1234, "output_tokens": 567, "cost_usd": 0.0060272},
        "codex": {"input_tokens": 3, "output_tokens": 4},
        "mimo": {"input_tokens": 1000, "output_tokens": 200, "cost_usd": 0.25},
        "muse": {"input_tokens": 900, "output_tokens": 110},
        "pi": {"input_tokens": 50, "output_tokens": 7, "cost_usd": 0.012},
        "agy": {"input_tokens": 80, "output_tokens": 12},
        "grok": {"input_tokens": 40, "output_tokens": 6},
    }
    for h in pairs:
        with_path = fixtures / (h + "-with-usage.jsonl")
        session = fixtures / (h + "-with-usage.session.json")
        sess = session if session.is_file() else None
        got, err = run_read(with_path, h, sess)
        if got is None:
            fail("%s: a stream that reports usage reads its figures" % h, err)
            continue
        want = expected[h]
        missing = [k for k in want if got.get(k) != want[k]]
        # cost_usd may be absent for harnesses that report none
        if "cost_usd" not in want and "cost_usd" in got:
            fail("%s: a stream that reports usage reads its figures" % h, "unexpected cost_usd: %r" % got.get("cost_usd"))
        elif missing:
            fail("%s: a stream that reports usage reads its figures" % h, "got %r want %r" % (got, want))
        else:
            if any(v == 0 for k, v in want.items() if k.endswith("tokens")):
                fail("%s: a stream that reports usage reads non-zero figures" % h, "expected non-zero, got %r" % want)
            else:
                ok("%s: a stream that reports usage reads its figures" % h)

    print("negative controls: a stream that does not report usage records nothing, never zero")
    for h in pairs:
        no_path = fixtures / (h + "-no-usage.jsonl")
        session = fixtures / (h + "-no-usage.session.json")
        sess = session if session.is_file() else None
        got, err = run_read(no_path, h, sess)
        if got is None:
            fail("%s: a stream that does not report usage records nothing" % h, err)
            continue
        if got:
            fail("%s: a stream that does not report usage records nothing, never zero" % h, "got %r" % got)
        else:
            ok("%s: a stream that does not report usage records nothing, never zero" % h)
        # the identical command must not invent zero
        if got == {"input_tokens": 0, "output_tokens": 0}:
            fail("%s: a missing figure is never zero" % h, "got %r" % got)

    print("record and sum")
    import shutil
    import subprocess
    import tempfile
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        dispatch = tmp / "RUN"
        (dispatch / "logs").mkdir(parents=True)
        # a workhorse that reports cost
        shutil.copy(fixtures / "claude-with-usage.jsonl", dispatch / "logs" / "luna-events.jsonl")
        r = subprocess.run(
            ["bash", str(here / "usage.sh"), "record", str(dispatch / "logs" / "luna-events.jsonl"),
             "claude", "luna", str(dispatch), "--role", "workhorse", "--lane", "luna"],
            capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            fail("record writes the launch's figures", r.stderr)
        else:
            rec = json.loads((dispatch / "logs" / "luna-events-usage.json").read_text())
            if rec.get("input_tokens") == 1234 and rec.get("role") == "workhorse" and "cost_usd" in rec:
                ok("record writes the launch's figures, per role and lane")
            else:
                fail("record writes the launch's figures, per role and lane", json.dumps(rec))
        # a harness that reports nothing
        shutil.copy(fixtures / "agy-no-usage.jsonl", dispatch / "logs" / "other-events.jsonl")
        r = subprocess.run(
            ["bash", str(here / "usage.sh"), "record", str(dispatch / "logs" / "other-events.jsonl"),
             "agy", "other", str(dispatch), "--role", "workhorse", "--lane", "other"],
            capture_output=True, text=True, timeout=10)
        rec = json.loads((dispatch / "logs" / "other-events-usage.json").read_text())
        if "input_tokens" not in rec and "cost_usd" not in rec:
            ok("record omits a figure the harness did not report")
        else:
            fail("record omits a figure the harness did not report", json.dumps(rec))
        r = subprocess.run(
            ["bash", str(here / "usage.sh"), "sum", str(dispatch)],
            capture_output=True, text=True, timeout=10)
        out = r.stdout
        if r.returncode != 0:
            fail("sum prints the closing block", r.stderr)
        else:
            if "cost: workhorse luna (claude): 1234 in, 567 out" in out and "cost: harness agy reports nothing" in out \
                    and "not reported" in out:
                ok("sum reports per role and lane, and names a harness that reports nothing")
            else:
                fail("sum reports per role and lane, and names a harness that reports nothing", out)
            if re.search(r"cost: workhorse other .*0 in", out) or re.search(r"cost: workhorse other .*\$0(\.0+)?( |,|$)", out):
                fail("sum never writes a missing figure as zero", out)
            elif "cost: workhorse other" in out and "not reported" in out:
                ok("sum never writes a missing figure as zero")
            else:
                fail("sum never writes a missing figure as zero", out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if fails[0] == 0:
        print("self-test: all controls behaved")
        raise SystemExit(0)
    print("self-test: %d control(s) misbehaved" % fails[0])
    raise SystemExit(1)

if args and args[0] == "--self-test":
    if len(args) != 1:
        die("--self-test takes no arguments")
    self_test()
if args and args[0] == "read":
    read_cmd(args[1:])
elif args and args[0] == "record":
    record_cmd(args[1:])
elif args and args[0] == "sum":
    sum_cmd(args[1:])
elif args and args[0] == "--self-test":
    pass
else:
    die("usage: usage.sh read <events> <harness> [<session>] | record <events> <harness> <name> <dispatch> [--role <role>] [--lane <lane>] | sum <dispatch> | --self-test")
PY
