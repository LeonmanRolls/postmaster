#!/usr/bin/env python3
"""Normalize native bug-review reports and harvest Claude's forked task transcripts."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SUPPORTED = {"claude", "codex", "mimo"}


class ReportError(Exception):
    pass


def read_events(path):
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ReportError("cannot read %s: %s" % (path, exc)) from exc
    events = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except ValueError as exc:
            raise ReportError("%s line %d is not JSON: %s" % (path, number, exc)) from exc
    return events


def final_report(harness, events_path, last_path):
    events = read_events(events_path)
    if harness == "claude":
        results = [event["result"] for event in events
                   if event.get("type") == "result" and isinstance(event.get("result"), str)]
        if not results:
            raise ReportError("Claude stream has no final result text")
        return results[-1]
    if harness == "mimo":
        reports = [(event.get("part") or {}).get("text") for event in events
                   if event.get("type") == "text"
                   and isinstance((event.get("part") or {}).get("text"), str)]
        if not reports:
            raise ReportError("MiMo Code stream has no final text event")
        return reports[-1]
    if harness == "codex":
        if not last_path:
            raise ReportError("Codex review normalization needs the --last output file")
        try:
            return Path(last_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise ReportError("cannot read Codex --last output %s: %s" % (last_path, exc)) from exc
    raise ReportError("%s has no code-review form" % harness)


def value_or_missing(value):
    if value is None:
        return "not provided"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = str(value).strip()
    return text if text else "not provided"


def normalize_location(path, line_value, end_value, scratch):
    path = str(path).strip().strip("`'\"()[]")
    match = re.match(r"^(.*?):(\d+)(?:-(\d+))?$", path)
    if match:
        path, embedded_line, embedded_end = match.groups()
        if line_value is None:
            line_value = embedded_line
        if end_value is None:
            end_value = embedded_end
    try:
        line = int(line_value)
    except (TypeError, ValueError) as exc:
        raise ReportError("finding has no numeric line: %s" % path) from exc
    if line < 1:
        raise ReportError("finding has an invalid line: %s" % line)
    try:
        root = Path(scratch).resolve(strict=False)
        candidate = Path(path)
        absolute = candidate.resolve(strict=False) if candidate.is_absolute() else (root / candidate).resolve(strict=False)
        relative = absolute.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ReportError("finding path is outside its review scratch: %s" % path) from exc
    file = relative.as_posix()
    if file in ("", ".") or file.startswith("../"):
        raise ReportError("finding path is not a file in its review scratch: %s" % path)
    try:
        line_end = int(end_value) if end_value is not None else "not provided"
    except (TypeError, ValueError) as exc:
        raise ReportError("finding has an invalid end line: %s" % end_value) from exc
    if isinstance(line_end, int) and line_end < line:
        raise ReportError("finding end line precedes its start line")
    return file, line, line_end


def normalize_item(item, harness, scratch):
    if not isinstance(item, dict):
        raise ReportError("finding is not an object")
    path = next((item.get(key) for key in ("file", "path", "file_path", "filePath", "filename") if item.get(key)), None)
    line = next((item.get(key) for key in ("line", "line_number", "lineNumber", "start", "start_line", "startLine") if item.get(key) is not None), None)
    end = next((item.get(key) for key in ("end", "end_line", "line_end", "endLine") if item.get(key) is not None), None)
    if path is None:
        raise ReportError("finding has no file")
    file, number, line_end = normalize_location(path, line, end, scratch)
    severity = item.get("severity", item.get("priority"))
    if isinstance(severity, int) and severity in (1, 2, 3):
        severity = "P%d" % severity
    summary = next((item.get(key) for key in
                    ("summary", "short_summary", "title", "description", "message", "failure_scenario")
                    if item.get(key)), None)
    evidence = next((item.get(key) for key in ("evidence", "quoted_code", "code", "snippet") if item.get(key)), None)
    return {
        "file": file,
        "line": number,
        "line_end": line_end,
        "target": "%s:%d" % (file, number),
        "severity": value_or_missing(severity),
        "summary": value_or_missing(summary),
        "body": value_or_missing(item.get("body")),
        "evidence": value_or_missing(evidence),
        "confidence": value_or_missing(item.get("confidence")),
        "category": value_or_missing(item.get("category")),
        "source": harness,
    }


def json_findings(text):
    stripped = re.sub(r"```(?:json)?\s*|```", "", text, flags=re.I).strip()
    try:
        value = json.loads(stripped)
        if isinstance(value, dict):
            for key in ("findings", "review_findings", "issues"):
                if isinstance(value.get(key), list):
                    return value[key]
        if isinstance(value, list):
            return value
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\[", text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        if isinstance(value, list):
            return value
    return None


CLEAN_PHRASES = ("nothing to review", "no findings", "no bugs", "no issues",
                 "looks correct", "no problems", "no defects", "patch is correct",
                 "i found no", "found nothing", "no code changes")
FINDING_MARKER = re.compile(r"\[P[123]\]|:(\d+)")


def explicit_clean(text):
    compact = " ".join(text.lower().split())
    if compact in {"[]", "no findings", "no findings.", "no findings found", "no findings found.", "no bugs found", "no bugs found.",
                   "no issues found", "no issues found.", "no actionable findings",
                   "no actionable findings.", "none", "none."}:
        return True
    if re.search(r"(?:^|\n)\s*(?:#+\s*)?(?:findings|issues)\s*\n\s*(?:none|no findings|no issues)\.?\s*(?:\n|$)", text, re.I):
        return True
    # A clean verdict in longer prose ("Nothing to review. The worktree is clean.") counts,
    # but only when no finding marker is present: a report that cites a file and line, or a
    # priority, is parsed as findings or fails loudly, never read as clean.
    return any(phrase in compact for phrase in CLEAN_PHRASES) and not FINDING_MARKER.search(text)


def markdown_findings(text, harness, scratch):
    findings = []
    in_fence = False
    location = re.compile(r"(?P<path>(?:[A-Za-z]:)?[^\s`*<>]+\.[A-Za-z0-9]{1,12}):(?P<line>\d+)(?:-(?P<end>\d+))?")
    lines = text.splitlines()
    for index, raw in enumerate(lines):
        line = raw.strip()
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if re.search(r"\bno (?:other|additional) (?:findings|bugs|issues) found\b", line, re.I):
            continue
        if not (line.startswith("#") or line.startswith(("-", "*", "**", "`")) or " — " in line or " – " in line):
            continue
        match = location.search(line)
        if not match:
            continue
        prefix = line[:match.start()].strip("#*-` :—–")
        suffix = line[match.end():].strip("` :—–-")
        if prefix.lower() == "bug":
            prefix = ""
        title = " ".join(part for part in (prefix, suffix) if part).strip()
        body = []
        for following in lines[index + 1:]:
            text_line = following.strip()
            if not text_line:
                if body:
                    break
                continue
            if text_line.startswith(("#", "- ", "* ", "Review comment:")) or text_line.startswith("```"):
                break
            body.append(text_line)
        findings.append(normalize_item({"file": match.group("path"), "line": match.group("line"),
                                        "end_line": match.group("end"), "summary": title,
                                        "body": "\n".join(body) if body else None}, harness, scratch))
    return findings


def codex_findings(text, scratch):
    pattern = re.compile(r"^\s*[-*]\s*\[(P[1-3])\]\s*(.+?)\s+[—–]\s+(.+):(\d+)(?:-(\d+))?\s*$")
    findings = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if match:
            severity, title, path, start, end = match.groups()
            body = []
            for following in lines[index + 1:]:
                text_line = following.strip()
                if not text_line:
                    if body:
                        break
                    continue
                if text_line.startswith(("#", "- ", "* ", "Review comment:")) or text_line.startswith("```"):
                    break
                body.append(text_line)
            findings.append(normalize_item({"file": path, "line": start, "end_line": end,
                                            "severity": severity, "title": title,
                                            "body": "\n".join(body) if body else None}, "codex", scratch))
    return findings


def parse_report(harness, text, scratch):
    if not text.strip():
        raise ReportError("review output is empty")
    if harness == "claude":
        findings = json_findings(text)
        if findings is not None:
            return unique_findings([normalize_item(item, harness, scratch) for item in findings])
    if harness == "codex":
        findings = codex_findings(text, scratch)
        if findings:
            return unique_findings(findings)
    findings = markdown_findings(text, harness, scratch)
    if findings:
        return unique_findings(findings)
    if explicit_clean(text):
        return []
    raise ReportError("cannot parse review output from %s" % harness)


def unique_findings(findings):
    unique = []
    seen = {}
    for finding in findings:
        key = (finding["file"], finding["line"], finding["line_end"],
               finding["severity"], finding["summary"])
        if key in seen:
            previous = unique[seen[key]]
            for field, value in finding.items():
                if previous.get(field) == "not provided" and value != "not provided":
                    previous[field] = value
        else:
            seen[key] = len(unique)
            unique.append(finding)
    return unique


def normalize_cli(lane, scratch, events_path, run_dir, last_path):
    try:
        run = json.loads((Path(run_dir) / "run.json").read_text(encoding="utf-8"))
        harness = run["config"]["lanes"][lane]["harness"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ReportError("cannot read recorded harness for lane %s from %s/run.json: %s" % (lane, run_dir, exc)) from exc
    if harness not in SUPPORTED:
        raise ReportError("%s has no code-review form" % harness)
    return parse_report(harness, final_report(harness, events_path, last_path), scratch)


def harvest(events_path, logs_dir, prefix):
    paths = []
    for event in read_events(events_path):
        if event.get("type") == "system" and event.get("subtype") == "task_notification" and event.get("output_file"):
            path = event["output_file"]
            if not isinstance(path, str):
                raise ReportError("task_notification output_file is not text")
            if path not in paths:
                paths.append(path)
    os.makedirs(logs_dir, exist_ok=True)
    prefix = re.sub(r"[^A-Za-z0-9_.-]+", "-", prefix).strip(".-") or "review"
    copied = []
    for index, path in enumerate(paths, 1):
        if not os.path.isfile(path):
            raise ReportError("Claude task output named by task_notification is missing: %s" % path)
        destination = os.path.join(logs_dir, "%s-claude-task-%02d-%s" % (prefix, index, os.path.basename(path)))
        if os.path.exists(destination):
            raise ReportError("refusing to overwrite harvested task output: %s" % destination)
        try:
            shutil.copy2(path, destination)
        except OSError as exc:
            raise ReportError("cannot copy Claude task output %s: %s" % (path, exc)) from exc
        copied.append(destination)
    return copied


def main(argv):
    if argv and argv[0] == "normalize" and len(argv) >= 6:
        lane, scratch, events_path = argv[1:4]
        run_dir = last_path = None
        rest = argv[4:]
        while rest:
            option = rest.pop(0)
            if option in ("--run", "--last") and rest:
                value = rest.pop(0)
                if option == "--run": run_dir = value
                else: last_path = value
            else:
                raise ReportError("unknown or incomplete option: %s" % option)
        if not run_dir:
            raise ReportError("normalize needs --run <dispatch>")
        print(json.dumps(normalize_cli(lane, scratch, events_path, run_dir, last_path), ensure_ascii=False, indent=2))
        return 0
    if argv and argv[0] == "harvest" and len(argv) == 5 and argv[3] == "--prefix":
        for path in harvest(argv[1], argv[2], argv[4]):
            print(path)
        return 0
    print("usage: review-findings.sh normalize <lane> <scratch> <events> --run <dispatch> [--last <file>] | harvest <events> <logs-dir> --prefix <name> | --self-test", file=sys.stderr)
    return 1


def self_test():
    fails = 0

    def check(label, condition, detail=""):
        nonlocal fails
        if condition:
            print("  ok   " + label)
        else:
            print("  FAIL " + label)
            if detail:
                print("         " + detail)
            fails += 1

    with tempfile.TemporaryDirectory(prefix="postmaster-review-findings-") as directory:
        root = Path(directory)
        scratch = root / "scratch"
        (scratch / "src").mkdir(parents=True)
        logs = root / "logs"
        external = root / "claude-task-output.txt"
        external.write_text("review task tools\n", encoding="utf-8")

        def run_config(name, harness):
            folder = root / name
            folder.mkdir(exist_ok=True)
            (folder / "run.json").write_text(json.dumps({"config": {"lanes": {"one": {"harness": harness}}}}), encoding="utf-8")
            return folder

        fixtures = {
            "claude": [{"type": "system", "subtype": "task_notification", "output_file": str(external)},
                       {"type": "result", "subtype": "success", "result": '[{"file":"src/page.js","line":8,"summary":"Page includes one extra item","category":"correctness"}]\nA sentence that is not a finding.'}],
            "codex": [{"type": "turn.completed"}],
            "mimo": [{"type": "text", "sessionID": "ses_1", "part": {"type": "text", "text": "### Bug — `src/page.js:8`: Page includes one extra item\n\nThe exclusive end repeats the boundary record.\n\n### No other issues found — `src/count.js:6`: Empty stores yield zero pages."}}],
        }
        for harness, events in fixtures.items():
            folder = run_config(harness, harness)
            event_file = root / (harness + ".events")
            event_file.write_text("".join(json.dumps(event) + "\n" for event in events), encoding="utf-8")
            last = None
            if harness == "codex":
                last = root / "codex.last"
                last.write_text("- [P1] Page includes one extra item — %s/src/page.js:8-8\n\nReview comment:\n\n- [P1] Page includes one extra item — %s/src/page.js:8-8\n  `slice` uses an exclusive end index.\n" % (scratch, scratch), encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(event_file), "--run", str(folder)] + (["--last", str(last)] if last else []), capture_output=True, text=True)
            try:
                parsed = json.loads(result.stdout)
                finding = parsed[0]
                positive = result.returncode == 0 and len(parsed) == 1 and finding["file"] == "src/page.js" and finding["line"] == 8 and finding["target"] == "src/page.js:8"
                if harness == "codex": positive = positive and finding["severity"] == "P1" and "exclusive end index" in finding["body"]
                if harness == "claude": positive = positive and finding["severity"] == "not provided" and finding["category"] == "correctness"
                if harness == "mimo": positive = positive and "boundary record" in finding["body"]
                check(harness + " recorded finding is normalized at its file and line", positive, result.stderr or result.stdout)
            except (ValueError, KeyError, IndexError):
                check(harness + " recorded finding is normalized at its file and line", False, result.stderr or result.stdout)

        empty_text = {"claude": {"type": "result", "subtype": "success", "result": "[]"},
                      "codex": None,
                      "mimo": {"type": "text", "part": {"type": "text", "text": "No findings."}}}
        for harness, event in empty_text.items():
            folder = run_config(harness + "-empty", harness)
            event_file = root / (harness + "-empty.events")
            event_file.write_text(json.dumps(event or {"type": "turn.completed"}) + "\n", encoding="utf-8")
            last = None
            if harness == "codex":
                last = root / "codex-empty.last"
                last.write_text("No findings.\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(event_file), "--run", str(folder)] + (["--last", str(last)] if last else []), capture_output=True, text=True)
            check(harness + " recorded empty report yields no findings", result.returncode == 0 and result.stdout.strip() == "[]", result.stderr or result.stdout)

        fenced = root / "claude-fenced.events"
        fenced.write_text(json.dumps({"type": "result", "subtype": "success", "result": "Nine findings remain.\n\n```json\n[{\"file\": \"src/page.js\", \"line\": 8, \"summary\": \"Off-by-one in slice\"}]\n```\n"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(fenced), "--run", str(run_config("fenced", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("claude fenced JSON array is read as findings", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/page.js" and parsed[0]["line"] == 8, result.stderr or result.stdout)
        except ValueError:
            check("claude fenced JSON array is read as findings", False, result.stderr or result.stdout)

        prose_clean = root / "mimo-prose.events"
        prose_clean.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "Nothing to review. The worktree has no uncommitted changes.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(prose_clean), "--run", str(run_config("prose", "mimo"))], capture_output=True, text=True)
        check("a clean verdict in longer prose yields no findings", result.returncode == 0 and result.stdout.strip() == "[]", result.stderr or result.stdout)

        guarded = root / "codex-guarded.events"
        guarded.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        guarded_last = root / "codex-guarded.last"
        guarded_last.write_text("No problems found in the files I read.\n- [P1] Something is wrong somewhere\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(guarded), "--run", str(run_config("guarded", "codex")), "--last", str(guarded_last)], capture_output=True, text=True)
        check("a clean phrase beside a finding marker still fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)

        for harness in SUPPORTED:
            folder = run_config("bad-" + harness, harness)
            event = {"type": "result", "subtype": "success", "result": "Maybe everything looks fine."}
            event_file = root / ("bad-" + harness + ".events")
            event_file.write_text(json.dumps(event if harness == "claude" else ({"type": "text", "part": {"type": "text", "text": event["result"]}} if harness == "mimo" else {"type": "turn.completed"})) + "\n", encoding="utf-8")
            args = [sys.executable, __file__, "normalize", "one", str(scratch), str(event_file), "--run", str(folder)]
            if harness == "codex":
                last = root / "bad-codex.last"
                last.write_text("Maybe everything looks fine.\n", encoding="utf-8")
                args += ["--last", str(last)]
            result = subprocess.run(args, capture_output=True, text=True)
            check(harness + " unrecognized report fails instead of becoming clean", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)

        harvest_events = root / "harvest.events"
        harvest_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(external)}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "harvest", str(harvest_events), str(logs), "--prefix", "r1-bug-one"], capture_output=True, text=True)
        copied = logs / ("r1-bug-one-claude-task-01-" + external.name)
        check("Claude task_notification transcript is copied into run logs", result.returncode == 0 and copied.is_file() and "review task tools" in copied.read_text(encoding="utf-8"), result.stderr or result.stdout)

    print()
    if fails == 0:
        print("self-test: all controls behaved")
        return 0
    print("self-test: %d control(s) misbehaved" % fails)
    return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    try:
        sys.exit(main(sys.argv[1:]))
    except ReportError as exc:
        print("review-findings: " + str(exc), file=sys.stderr)
        sys.exit(1)
