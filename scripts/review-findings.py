#!/usr/bin/env python3
"""Normalize native bug-review reports and harvest Claude's forked task transcripts."""
import filecmp
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
        results = [event for event in events if event.get("type") == "result"]
        if not results:
            raise ReportError("Claude stream has no final result text")
        # The last result rules, whatever shape it is: a run that ended in error, or
        # ended without text, is a failed reviewer, never a clean review. Real streams
        # carry the success subtype with string text; anything else fails loudly.
        last = results[-1]
        if last.get("subtype") != "success":
            raise ReportError("claude review run did not succeed (subtype: %s)" % (last.get("subtype") or "missing"))
        if not isinstance(last.get("result"), str):
            raise ReportError("claude review run ended with no result text")
        return last["result"]
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
        # The --last file is trusted only when the review's turn completed: codex
        # writes -o only on success, so a failed turn's file is an earlier
        # attempt's. A failed turn, or no completed turn, fails loudly.
        if any(event.get("type") == "turn.failed" for event in events):
            raise ReportError("codex review turn failed; refusing its --last output as stale")
        if not any(event.get("type") == "turn.completed" for event in events):
            raise ReportError("codex stream shows no completed turn; refusing its --last output as stale")
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
    body = item.get("body") or item.get("failure_scenario")
    return {
        "file": file,
        "line": number,
        "line_end": line_end,
        "target": "%s:%d" % (file, number),
        "severity": value_or_missing(severity),
        "summary": value_or_missing(summary),
        "body": value_or_missing(body),
        "evidence": value_or_missing(evidence),
        "confidence": value_or_missing(item.get("confidence")),
        "category": value_or_missing(item.get("category")),
        "source": harness,
    }


def pick_findings(found):
    """The one findings list among candidates: non-empty and holding an object. Scalar or
    empty lists say nothing; two findings lists fail loudly rather than guessing."""
    candidates = [value for value in found if value and any(isinstance(item, dict) for item in value)]
    if len(candidates) > 1:
        raise ReportError("review output holds %d JSON finding lists; refusing to guess which holds the findings" % len(candidates))
    return candidates[0] if candidates else None


def scan_spans(ntext):
    """Every JSON list in the text with its character span; undecodable brackets skipped."""
    decoder = json.JSONDecoder()
    found = []
    for match in re.finditer(r"\[", ntext):
        try:
            value, end = decoder.raw_decode(ntext[match.start():])
        except ValueError:
            continue
        if isinstance(value, list):
            found.append((value, match.start(), match.start() + end))
    return found


def excise_first(ntext, picked):
    """The text with the picked list's first literal removed. A twin literal stays
    outside, where the second-list check finds it."""
    for value, start, end in scan_spans(ntext):
        if value == picked:
            return ntext[:start] + ntext[end:]
    raise ReportError("cannot parse review output from claude")  # unreachable: the literal parsed from this text


def normalize_text(text):
    """The one normalization for clean-matching and JSON parsing: a fence wrapping
    the whole report, meaning its first and last lines, comes off, and edges are
    stripped. Anything else stays byte for byte: the reader preserves or refuses,
    never alters. Markdown parsing stays fence-aware: fences are structural there
    (evidence boundaries, quoted examples), cosmetic here."""
    lines = text.strip().splitlines()
    if len(lines) >= 2 and re.match(r"(?i)```(?:json)?\s*$", lines[0].strip()) and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return text.strip()


def claude_json(ntext):
    """(items, outside) for a claude report: the one JSON findings list and the text
    around it. None when the text holds no JSON findings structure at all, so the
    markdown fallback tries; anything else parses or fails loudly here."""
    try:
        whole = json.loads(ntext)
    except ValueError:
        whole = None
    if isinstance(whole, list):
        return whole, ""
    if isinstance(whole, dict):
        keyed = [whole[key] for key in DECLARED_KEYS if isinstance(whole.get(key), list)]
        if keyed:
            # Declared keys are held strictly before anything is picked: a non-empty
            # list with no objects is a malformed report even beside a valid list, which
            # must not silently win over the malformed one.
            for found in keyed:
                if found and not any(isinstance(item, dict) for item in found):
                    raise ReportError("review output's findings lists hold no objects; refusing to read as clean")
            picked = pick_findings(keyed)
            if picked is not None:
                return picked, excise_first(ntext, picked)
        object_lists = [value for (value, _s, _e) in scan_spans(ntext)
                        if value and any(isinstance(item, dict) for item in value)]
        picked = pick_findings(object_lists)
        if picked is None:
            raise ReportError("cannot parse review output from claude")
        return picked, excise_first(ntext, picked)
    object_lists = [value for (value, _s, _e) in scan_spans(ntext)
                    if value and any(isinstance(item, dict) for item in value)]
    picked = pick_findings(object_lists)
    if picked is None:
        return None
    return picked, excise_first(ntext, picked)


# The exact clean forms: the whole report, normalized, is a bare verdict, an empty JSON
# list, or {"findings": []} with no other key. "No findings." is on record in the
# project's own controls and the empty list in the trial's claude shape (fenced at max,
# which normalization strips); the rest are retained unambiguous bare verdicts. Anything
# longer — an extra key, prose, a second block — is not a clean form.
CLEAN_VERDICTS = frozenset({
    "no findings", "no findings.", "no findings found", "no findings found.",
    "no bugs found", "no bugs found.", "no issues found", "no issues found.",
    "no actionable findings", "no actionable findings.", "none", "none.",
})
DECLARED_KEYS = ("findings", "review_findings", "issues")
FILE_KEYS = ("file", "path", "file_path", "filePath", "filename")
LINE_KEYS = ("line", "line_number", "lineNumber", "start", "start_line", "startLine")
HASHLOC = re.compile(r"(?P<path>(?:[A-Za-z]:)?[^\s`*<>]+?)#L(?P<line>\d+)")
ATLINE = re.compile(r"(?P<path>[A-Za-z][^\s`*<>:,;()]*?)\s+\bat line\s+(?P<line>\d+)", re.I)
PRIORITY_TAG = re.compile(r"\[P[123]\]")
FINDING_WORDS = re.compile(r"\b(?:bugs?|buggy|findings?|issues?|defects?)\b", re.I)
NO_OTHER_PHRASES = frozenset({
    "no other findings found", "no other bugs found", "no other issues found",
    "no additional findings found", "no additional bugs found", "no additional issues found",
})


def is_clean_form(ntext):
    """The report normalized is exactly a clean form and nothing else."""
    if " ".join(ntext.lower().split()) in CLEAN_VERDICTS:
        return True
    try:
        parsed = json.loads(ntext)
    except ValueError:
        return False
    return parsed == [] or parsed == {"findings": []}


def decoded_json_values(text):
    """Every JSON value the report decodes to: the whole text, then each bracket-led
    fragment. Undecodable brackets are skipped."""
    values = []
    try:
        values.append(json.loads(text.strip()))
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for match in re.finditer(r"[\[{]", text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        values.append(value)
    return values


def walk_json(value, strings, cited):
    """Decoded string values, and (file, line-or-None) for objects naming a file, under
    a JSON value. Keys are not values: a citation smuggled into a key stays visible to
    the raw-text scan instead."""
    if isinstance(value, str):
        strings.append(value)
    elif isinstance(value, dict):
        file_value = next((value.get(key) for key in FILE_KEYS if value.get(key)), None)
        if file_value is not None:
            line_value = next((value.get(key) for key in LINE_KEYS if value.get(key) is not None), None)
            cited.append((file_value, line_value))
        for item in value.values():
            walk_json(item, strings, cited)
    elif isinstance(value, list):
        for item in value:
            walk_json(item, strings, cited)


def scan_locations(s):
    """(path, line, shown) for every location a string names: path:line with a letter in
    it, path#L<n>, and at line <n> against a path-like name on the same line."""
    for match in LOCATION.finditer(s):
        if re.search(r"[A-Za-z]", match.group("path")):
            yield match.group("path"), int(match.group("line")), "%s:%s" % (match.group("path"), match.group("line"))
    for match in HASHLOC.finditer(s):
        yield match.group("path"), int(match.group("line")), "%s#L%s" % (match.group("path"), match.group("line"))
    for match in ATLINE.finditer(s):
        if "/" in match.group("path") or "." in match.group("path"):
            yield match.group("path"), int(match.group("line")), "%s at line %s" % (match.group("path"), match.group("line"))


def is_finding_form_line(line):
    """A line the markdown parser would file: a heading, item or em-dash line citing a
    path:line with a letter in it."""
    if not (line.startswith("#") or line.startswith(("-", "*", "**", "`")) or " — " in line or " – " in line):
        return False
    match = LOCATION.search(line)
    return bool(match) and bool(re.search(r"[A-Za-z]", match.group("path")))


def is_exact_no_other(line):
    """A line that is exactly a no-other-issues phrase, heading markers and end
    punctuation aside. Anything longer — a citation beside the phrase — is not skipped."""
    return line.strip().lstrip("#").strip().rstrip(".:").strip().lower() in NO_OTHER_PHRASES


def match_or_loud(path, number, shown, targets, scratch):
    try:
        file, line, _end = normalize_location(path, number, None, scratch)
    except ReportError:
        raise ReportError("review output cites %s outside its filed findings" % shown)
    if (file, line) not in targets:
        raise ReportError("review output cites %s outside its filed findings" % shown)


def check_outside(outside, filed, scratch):
    """Nothing outside the one recognised structure may look like a finding: no second
    list, no finding-form line, no priority tag; a prose location must name a filed
    finding's file and line, nothing more."""
    targets = set((finding["file"], finding["line"]) for finding in filed)
    for value, _start, _end in scan_spans(outside):
        if value and any(isinstance(item, dict) for item in value):
            raise ReportError("review output holds a second findings list outside its filed findings")
    for line in outside.splitlines():
        if is_finding_form_line(line.strip()):
            raise ReportError("review output holds a markdown finding outside its filed findings")
    if PRIORITY_TAG.search(outside):
        raise ReportError("review output holds a priority tag outside its filed findings")
    for path, number, shown in scan_locations(outside):
        match_or_loud(path, number, shown, targets, scratch)
    strings, cited = [], []
    for value in decoded_json_values(outside):
        walk_json(value, strings, cited)
    for item in strings:
        for path, number, shown in scan_locations(item):
            match_or_loud(path, number, shown, targets, scratch)
    for file_value, line_value in cited:
        if line_value is None:
            raise ReportError("review output names file %s outside its filed findings" % file_value)
        match_or_loud(file_value, line_value, "%s:%s" % (file_value, line_value), targets, scratch)


def check_finding_words(ntext):
    """No finding words beside an empty declared list: a report claiming no findings in
    one key while describing bugs in another fails loudly."""
    for value in decoded_json_values(ntext):
        if isinstance(value, dict) and any(value.get(key) == [] for key in DECLARED_KEYS):
            for item in value.values():
                if isinstance(item, str) and FINDING_WORDS.search(item):
                    raise ReportError("review output describes findings beside its empty findings list")


def finding_body(lines, index):
    """The body and evidence after a finding's line: following prose until a blank line, the
    next heading or item; a fenced block is the finding's evidence, not its end. Also the
    first line past the block, so the outside check knows what the finding consumed."""
    body = []
    evidence = None
    following = index + 1
    total = len(lines)
    while following < total:
        text_line = lines[following].strip()
        if not text_line:
            if body:
                break
            following += 1
            continue
        if text_line.startswith(("#", "- ", "* ", "Review comment:")):
            break
        if text_line.startswith("```"):
            following += 1
            fence = []
            while following < total and not lines[following].strip().startswith("```"):
                fence.append(lines[following].rstrip("\n"))
                following += 1
            following += 1
            if evidence is None:
                evidence = "\n".join(fence).strip() or None
            continue
        body.append(text_line)
        following += 1
    return ("\n".join(body) if body else None, evidence, following)


# Headings whose sections hold non-findings, exactly as the recorded reports use them:
# mimo's "Not issues". Anything unrecorded ("Non-issues", "Not a bug") still parses,
# loudly, rather than being guessed at.
SKIP_SECTIONS = ("not issues",)


def check_fences_closed(lines):
    depth = sum(1 for raw in lines if raw.strip().startswith("```"))
    if depth % 2:
        raise ReportError("review output has an unclosed code fence")


LOCATION = re.compile(r"(?P<path>(?:[A-Za-z]:)?[^\s`*<>]+):(?P<line>\d+)(?:-(?P<end>\d+))?")


def cites_location(line):
    """A path:line citation: the path must hold a letter, so Makefile:8 counts and 12:30
    does not. A bare name can over-match (localhost:8080); the coachman's verification
    drops what does not hold, which beats losing a real citation quietly."""
    match = LOCATION.search(line)
    return bool(match) and bool(re.search(r"[A-Za-z]", match.group("path")))


def descope_not_issues(text):
    """Blank citations and fenced lines under recorded not-issues headings, keeping line
    numbers and prose, so their citations neither parse as findings nor trip the
    outside check."""
    out = []
    in_fence = False
    skip = False
    skip_level = 0
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out.append("" if skip else raw)
            continue
        if not in_fence and stripped.startswith("#"):
            hashes = len(stripped) - len(stripped.lstrip("#"))
            if stripped.lstrip("#").strip().lower().rstrip(":") in SKIP_SECTIONS:
                skip, skip_level = True, hashes
            elif skip and hashes <= skip_level:
                skip = False
        if skip and (in_fence or cites_location(stripped)):
            out.append("")
        else:
            out.append(raw)
    return "\n".join(out)


def markdown_findings_spans(text, harness, scratch):
    """Findings plus the text outside them: every line no finding block consumed and no
    fence quotes, for the outside check."""
    findings = []
    consumed = set()
    fenced = set()
    in_fence = False
    lines = text.splitlines()
    for index, raw in enumerate(lines):
        line = raw.strip()
        if line.startswith("```"):
            in_fence = not in_fence
            fenced.add(index)
            continue
        if in_fence:
            fenced.add(index)
            continue
        if is_exact_no_other(line):
            continue
        if not is_finding_form_line(line):
            continue
        match = LOCATION.search(line)
        prefix = line[:match.start()].strip("#*-` :—–")
        suffix = line[match.end():].strip("` :—–-")
        if prefix.lower() == "bug":
            prefix = ""
        title = " ".join(part for part in (prefix, suffix) if part).strip()
        body, evidence, end = finding_body(lines, index)
        try:
            findings.append(normalize_item({"file": match.group("path"), "line": match.group("line"),
                                            "end_line": match.group("end"), "summary": title,
                                            "body": body, "evidence": evidence}, harness, scratch))
        except ReportError as exc:
            raise ReportError("report line %d: %s" % (index + 1, exc)) from exc
        consumed.update(range(index, end))
    outside = "\n".join(raw for number, raw in enumerate(lines) if number not in consumed and number not in fenced)
    return findings, outside


def codex_findings_spans(text, scratch):
    """Findings plus the text outside them, as markdown_findings_spans."""
    pattern = re.compile(r"^\s*[-*]\s*\[(P[1-3])\]\s*(.+?)\s+[—–]\s+(.+):(\d+)(?:-(\d+))?\s*$")
    findings = []
    consumed = set()
    fenced = set()
    in_fence = False
    lines = text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            fenced.add(index)
            continue
        if in_fence:
            fenced.add(index)
            continue
        match = pattern.match(line)
        if match:
            severity, title, path, start, end = match.groups()
            body, evidence, block_end = finding_body(lines, index)
            try:
                findings.append(normalize_item({"file": path, "line": start, "end_line": end,
                                                "severity": severity, "title": title,
                                                "body": body, "evidence": evidence}, "codex", scratch))
            except ReportError as exc:
                raise ReportError("report line %d: %s" % (index + 1, exc)) from exc
            consumed.update(range(index, block_end))
    outside = "\n".join(raw for number, raw in enumerate(lines) if number not in consumed and number not in fenced)
    return findings, outside


def parse_report(harness, text, scratch):
    if not text.strip():
        raise ReportError("review output is empty")
    ntext = normalize_text(text)
    if is_clean_form(ntext):
        return []
    if harness == "claude":
        found = claude_json(ntext)
        if found is not None:
            items, outside = found
            normalized = []
            for position, item in enumerate(items):
                try:
                    normalized.append(normalize_item(item, harness, scratch))
                except ReportError as exc:
                    raise ReportError("finding %d: %s" % (position, exc)) from exc
            check_finding_words(ntext)
            check_outside(outside, normalized, scratch)
            return unique_findings(normalized)
    check_fences_closed(text.splitlines())
    scoped = descope_not_issues(text)
    if harness == "codex":
        findings, outside = codex_findings_spans(scoped, scratch)
        if findings:
            check_outside(outside, findings, scratch)
            return unique_findings(findings)
    findings, outside = markdown_findings_spans(scoped, harness, scratch)
    if findings:
        check_outside(outside, findings, scratch)
        return unique_findings(findings)
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


def harvest(events_path, logs_dir, prefix, task_root=None):
    wanted = []
    for event in read_events(events_path):
        if event.get("type") == "system" and event.get("subtype") == "task_notification":
            path = event.get("output_file")
            if not path:
                raise ReportError("task_notification names no output file")
            if not isinstance(path, str):
                raise ReportError("task_notification output_file is not text")
            if path not in wanted:
                wanted.append(path)
    os.makedirs(logs_dir, exist_ok=True)
    prefix = re.sub(r"[^A-Za-z0-9_.-]+", "-", prefix).strip(".-") or "review"
    # The root is resolved before comparing: the task path always is, so an unresolved root
    # under a symlinked /tmp would refuse its own files. The override exists for fixtures.
    root = Path(task_root).resolve() if task_root is not None else Path("/tmp/claude-%d" % os.getuid()).resolve()
    planned = []
    for index, path in enumerate(wanted, 1):
        try:
            resolved = Path(path).resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise ReportError("Claude task output named by task_notification is missing: %s" % path) from exc
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ReportError("Claude task output is outside %s: %s" % (root, path)) from exc
        if not resolved.is_file():
            raise ReportError("Claude task output named by task_notification is not a file: %s" % path)
        destination = os.path.join(logs_dir, "%s-claude-task-%02d-%s" % (prefix, index, os.path.basename(path)))
        if os.path.exists(destination) and not filecmp.cmp(resolved, destination, shallow=False):
            raise ReportError("refusing to overwrite harvested task output: %s" % destination)
        planned.append((resolved, destination))
    copied = []
    for resolved, destination in planned:
        # Every destination was vetted above: a refused harvest copies nothing.
        if os.path.exists(destination):
            copied.append(destination)
            continue
        try:
            shutil.copy2(resolved, destination)
        except OSError as exc:
            raise ReportError("cannot copy Claude task output %s: %s" % (resolved, exc)) from exc
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
        task_home = Path("/tmp/claude-%d" % os.getuid()) / ("postmaster-selftest-%d" % os.getpid())
        task_home.mkdir(parents=True, exist_ok=True)
        external = task_home / "claude-task-output.txt"
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
            "mimo": [{"type": "text", "sessionID": "ses_1", "part": {"type": "text", "text": "### Bug — `src/page.js:8`: Page includes one extra item\n\nThe exclusive end repeats the boundary record.\n\n### No other issues found."}}],
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

        # The reader preserves or refuses, never alters: only a fence wrapping the
        # whole report comes off, never one inside a string value.
        evidence_text = "```js\nx\n```"
        inner_fence = root / "claude-inner-fence.events"
        inner_fence.write_text(json.dumps({"type": "result", "subtype": "success", "result": json.dumps([{"file": "src/a.js", "line": 1, "summary": "s", "evidence": evidence_text}])}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(inner_fence), "--run", str(run_config("inner-fence", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("a fenced snippet inside evidence normalizes byte for byte", result.returncode == 0 and len(parsed) == 1 and parsed[0]["evidence"] == evidence_text, result.stderr or result.stdout)
        except ValueError:
            check("a fenced snippet inside evidence normalizes byte for byte", False, result.stderr or result.stdout)
        wrapped = root / "claude-wrapped.events"
        wrapped.write_text(json.dumps({"type": "result", "subtype": "success", "result": "```json\n" + json.dumps([{"file": "src/a.js", "line": 1, "summary": "s"}]) + "\n```\n"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(wrapped), "--run", str(run_config("wrapped", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("a report wrapped in one fence still parses", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/a.js", result.stderr or result.stdout)
        except ValueError:
            check("a report wrapped in one fence still parses", False, result.stderr or result.stdout)

        # A claude item's reproduction reaches triage: with no body, its
        # failure_scenario becomes the body instead of being dropped.
        scenario = "Store holds r0..r9; page(1, 3) returns 4 items."
        scenario_events = root / "claude-scenario.events"
        scenario_events.write_text(json.dumps({"type": "result", "subtype": "success", "result": json.dumps([{"file": "src/a.js", "line": 1, "summary": "Off by one", "failure_scenario": scenario}])}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(scenario_events), "--run", str(run_config("scenario", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an item with summary and failure_scenario normalizes with that scenario as its body", result.returncode == 0 and len(parsed) == 1 and parsed[0]["body"] == scenario, result.stderr or result.stdout)
        except ValueError:
            check("an item with summary and failure_scenario normalizes with that scenario as its body", False, result.stderr or result.stdout)

        prose_clean = root / "mimo-prose.events"
        prose_clean.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "Nothing to review. The worktree has no uncommitted changes.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(prose_clean), "--run", str(run_config("prose", "mimo"))], capture_output=True, text=True)
        check("a clean verdict in longer prose fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)

        guarded = root / "codex-guarded.events"
        guarded.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        guarded_last = root / "codex-guarded.last"
        guarded_last.write_text("No problems found in the files I read.\n- [P1] Something is wrong somewhere\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(guarded), "--run", str(run_config("guarded", "codex")), "--last", str(guarded_last)], capture_output=True, text=True)
        check("a clean phrase beside a finding marker still fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)

        # Codex's --last file is trusted only when the review's turn completed:
        # codex writes -o only on success, so a failed turn's file is stale.
        stale_clean = root / "codex-stale.last"
        stale_clean.write_text("No findings.\n", encoding="utf-8")
        failed_turn = root / "codex-failed.events"
        failed_turn.write_text(json.dumps({"type": "thread.started"}) + "\n" + json.dumps({"type": "turn.started"}) + "\n" + json.dumps({"type": "turn.failed", "error": {"message": "provider wall"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(failed_turn), "--run", str(run_config("failed-turn", "codex")), "--last", str(stale_clean)], capture_output=True, text=True)
        check("a stale clean --last beside a failed turn fails loudly, never clean", result.returncode == 1 and "turn failed" in result.stderr, result.stderr or result.stdout)
        no_turn = root / "codex-noturn.events"
        no_turn.write_text(json.dumps({"type": "thread.started"}) + "\n" + json.dumps({"type": "turn.started"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(no_turn), "--run", str(run_config("no-turn", "codex")), "--last", str(stale_clean)], capture_output=True, text=True)
        check("a clean --last with no completed turn fails loudly, never clean", result.returncode == 1 and "no completed turn" in result.stderr, result.stderr or result.stdout)

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
        partial = root / "harvest-partial.events"
        partial.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(external)}) + "\n" + json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(task_home / "absent.txt")}) + "\n", encoding="utf-8")
        partial_logs = root / "logs-partial"
        result = subprocess.run([sys.executable, __file__, "harvest", str(partial), str(partial_logs), "--prefix", "partial"], capture_output=True, text=True)
        check("a missing task file fails before anything is copied", result.returncode == 1 and "missing" in result.stderr and not any(partial_logs.iterdir()), result.stderr or result.stdout)
        one = root / "harvest-one.events"
        one.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(external)}) + "\n", encoding="utf-8")
        retry_logs = root / "logs-retry"
        first = subprocess.run([sys.executable, __file__, "harvest", str(one), str(retry_logs), "--prefix", "retry"], capture_output=True, text=True)
        again = subprocess.run([sys.executable, __file__, "harvest", str(one), str(retry_logs), "--prefix", "retry"], capture_output=True, text=True)
        check("an identical re-harvest is a no-op", first.returncode == 0 and again.returncode == 0 and again.stdout == first.stdout, (first.stderr or first.stdout) + (again.stderr or again.stdout))
        (retry_logs / ("retry-claude-task-01-" + external.name)).write_text("changed\n", encoding="utf-8")
        clobber = subprocess.run([sys.executable, __file__, "harvest", str(one), str(retry_logs), "--prefix", "retry"], capture_output=True, text=True)
        check("a re-harvest over different content still refuses", clobber.returncode == 1 and "refusing to overwrite" in clobber.stderr, clobber.stderr or clobber.stdout)
        outside = root / "outside-task-output.txt"
        outside.write_text("not a task file\n", encoding="utf-8")
        negatives = [
            ("a task_notification without an output file fails", {"type": "system", "subtype": "task_notification"}, "names no output file"),
            ("a task_notification with an empty output file fails", {"type": "system", "subtype": "task_notification", "output_file": ""}, "names no output file"),
            ("a task_notification with a non-text output file fails", {"type": "system", "subtype": "task_notification", "output_file": 7}, "not text"),
            ("a task_notification naming a missing file fails", {"type": "system", "subtype": "task_notification", "output_file": str(task_home / "absent.txt")}, "missing"),
        ]
        for number, (label, notification, message) in enumerate(negatives):
            events = root / ("harvest-neg-%d.events" % number)
            events.write_text(json.dumps(notification) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "harvest", str(events), str(logs), "--prefix", "neg"], capture_output=True, text=True)
            check(label, result.returncode == 1 and message in result.stderr, result.stderr or result.stdout)
        # The outside-tree case names its allowed root explicitly: a scratchpad TMPDIR
        # sits inside the default root, so a tempfile fixture is outside it only by luck.
        tree = root / "task-tree"
        tree.mkdir()
        outside_events = root / "harvest-outside.events"
        outside_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(outside)}) + "\n", encoding="utf-8")
        try:
            harvest(str(outside_events), str(root / "logs-outside"), "outside", task_root=str(tree))
            check("a task_notification naming a file outside the task tree fails", False, "no error")
        except ReportError as exc:
            check("a task_notification naming a file outside the task tree fails", "outside" in str(exc), str(exc))
        inner = task_home / "inner-task-output.txt"
        inner.write_text("inside the default root\n", encoding="utf-8")
        inner_events = root / "harvest-inner.events"
        inner_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(inner)}) + "\n", encoding="utf-8")
        try:
            harvest(str(inner_events), str(root / "logs-inner"), "inner", task_root=str(tree))
            check("a file inside the default root but outside the named root still fails", False, "no error")
        except ReportError as exc:
            check("a file inside the default root but outside the named root still fails", "outside" in str(exc), str(exc))
        quiet = root / "harvest-quiet.events"
        quiet.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "harvest", str(quiet), str(logs), "--prefix", "quiet"], capture_output=True, text=True)
        check("a stream with no task_notification harvests nothing and exits 0", result.returncode == 0 and result.stdout == "", result.stderr or result.stdout)
        # The coachman.md sample degrades a lane whose harvest failed: no normalize,
        # no findings JSON. Both sides of that branch, on the one stream.
        degrade_events = root / "degrade.events"
        degrade_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(task_home / "absent.txt")}) + "\n" + json.dumps({"type": "result", "subtype": "success", "result": "[]"}) + "\n", encoding="utf-8")
        degrade_harvest = subprocess.run([sys.executable, __file__, "harvest", str(degrade_events), str(root / "logs-degrade"), "--prefix", "degrade"], capture_output=True, text=True)
        degrade_json = root / "logs-degrade-findings.json"
        if degrade_harvest.returncode == 0:
            passed = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(degrade_events), "--run", str(run_config("degrade", "claude"))], capture_output=True, text=True)
            if passed.returncode == 0:
                degrade_json.write_text(passed.stdout, encoding="utf-8")
        check("a lane whose task file is missing ends DEGRADED with no findings JSON", degrade_harvest.returncode == 1 and "missing" in degrade_harvest.stderr and not degrade_json.exists(), degrade_harvest.stderr or degrade_harvest.stdout)
        skipped = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(degrade_events), "--run", str(run_config("degrade-skip", "claude"))], capture_output=True, text=True)
        check("the same stream still normalizes, so skipping it is what keeps the verdict uncounted", skipped.returncode == 0 and skipped.stdout.strip() == "[]", skipped.stderr or skipped.stdout)
        present_events = root / "degrade-present.events"
        present_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(external)}) + "\n" + json.dumps({"type": "result", "subtype": "success", "result": fixtures["claude"][1]["result"]}) + "\n", encoding="utf-8")
        present_harvest = subprocess.run([sys.executable, __file__, "harvest", str(present_events), str(root / "logs-degrade-present"), "--prefix", "present"], capture_output=True, text=True)
        present_json = root / "logs-degrade-present-findings.json"
        if present_harvest.returncode == 0:
            present = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(present_events), "--run", str(run_config("degrade-present", "claude"))], capture_output=True, text=True)
            if present.returncode == 0:
                present_json.write_text(present.stdout, encoding="utf-8")
        try:
            parsed = json.loads(present_json.read_text(encoding="utf-8"))
            check("the same stream with the file present harvests and normalizes to its finding", present_harvest.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/page.js" and parsed[0]["line"] == 8, present_harvest.stderr or present_harvest.stdout)
        except (ValueError, OSError, KeyError, IndexError):
            check("the same stream with the file present harvests and normalizes to its finding", False, present_harvest.stderr or present_harvest.stdout)
        # Consequence (1): the sample's degrade arm writes the run-log line as well
        # as the degrade action. This executes the sample itself, read from the
        # runbook as launch.sh's self-test reads it, not a copy of its logic.
        tool = Path(__file__).resolve().parent.parent
        blocks = re.findall(r"```sh\n(.*?)```", (tool / "skills" / "postmaster" / "coachman.md").read_text(encoding="utf-8"), re.S)
        samples = [block for block in blocks if 'NORMALIZE_FAILED=""' in block and "HARVEST_ERR" in block]
        sample_dispatch = root / "sample-dispatch"
        (sample_dispatch / "logs").mkdir(parents=True)
        (sample_dispatch / "logs" / "review-r9-bug-one.jsonl").write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(task_home / "absent.txt")}) + "\n" + json.dumps({"type": "result", "subtype": "success", "result": "[]"}) + "\n", encoding="utf-8")
        if len(samples) != 1:
            check("executing the sample on the missing-file fixture writes both lines", False, "%d degrade samples in coachman.md" % len(samples))
        else:
            sample = samples[0].replace("<tool>", str(tool))
            sample = sample.replace("<dispatch>", str(sample_dispatch)).replace("<repo>", str(root)).replace("<TICKET>", "T").replace("<round>", "9")
            sample = re.sub(r"for L in \$\([^;]*?; do", "for L in one; do", sample)
            sample = sample.replace("DEST=" + str(root) + "/.worktrees/T-rev-bug-$L", "DEST=" + str(scratch))
            (root / "sample.sh").write_text(sample, encoding="utf-8")
            ran = subprocess.run(["bash", str(root / "sample.sh")], capture_output=True, text=True)
            logged = []
            if (sample_dispatch / "actions.jsonl").exists():
                for raw in (sample_dispatch / "actions.jsonl").read_text(encoding="utf-8").splitlines():
                    try:
                        logged.append(json.loads(raw))
                    except ValueError:
                        pass
            degraded = [entry for entry in logged if entry.get("action") == "degrade" and entry.get("target") == "one"]
            narrative = (sample_dispatch / "run-log.md").read_text(encoding="utf-8") if (sample_dispatch / "run-log.md").exists() else ""
            check("executing the sample on the missing-file fixture writes both lines", ran.returncode == 0 and len(degraded) == 1 and "one bug: DEGRADED," in narrative, ran.stderr or (str(logged) + narrative))
        empty_first = root / "claude-empty-first.events"
        empty_first.write_text(json.dumps({"type": "result", "subtype": "success", "result": "[]\n[{\"file\": \"src/page.js\", \"line\": 8, \"summary\": \"bug\"}]"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(empty_first), "--run", str(run_config("empty-first", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an empty JSON list before findings does not read as clean", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/page.js" and parsed[0]["line"] == 8, result.stderr or result.stdout)
        except ValueError:
            check("an empty JSON list before findings does not read as clean", False, result.stderr or result.stdout)
        ambiguous = root / "claude-ambiguous.events"
        ambiguous.write_text(json.dumps({"type": "result", "subtype": "success", "result": "[{\"file\": \"src/a.js\", \"line\": 1, \"summary\": \"one\"}]\n[{\"file\": \"src/b.js\", \"line\": 2, \"summary\": \"two\"}]"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(ambiguous), "--run", str(run_config("ambiguous", "claude"))], capture_output=True, text=True)
        check("two non-empty JSON lists fail loudly", result.returncode == 1 and "JSON finding lists" in result.stderr, result.stderr or result.stdout)
        scalar_first = root / "claude-scalar-first.events"
        scalar_first.write_text(json.dumps({"type": "result", "subtype": "success", "result": "Counts [1, 2, 3] aside.\n[{\"file\": \"src/page.js\", \"line\": 8, \"summary\": \"bug\"}]"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(scalar_first), "--run", str(run_config("scalar-first", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an incidental scalar list does not hide the findings", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/page.js", result.stderr or result.stdout)
        except ValueError:
            check("an incidental scalar list does not hide the findings", False, result.stderr or result.stdout)
        timed = root / "mimo-timed.events"
        timed.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "No findings. Checked at 12:30."}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(timed), "--run", str(run_config("timed", "mimo"))], capture_output=True, text=True)
        check("a clean verdict mentioning a time fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        fenced = root / "mimo-fenced-evidence.events"
        fenced.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Bug — `src/page.js:8`: off by one\n\n```js\nreturn all().slice(start, start + size + 1);\n```\n\nThe exclusive end repeats the boundary record.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(fenced), "--run", str(run_config("fenced-evidence", "mimo"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("a fenced block after a finding is kept as its evidence", result.returncode == 0 and len(parsed) == 1 and "slice(start, start + size" in parsed[0]["evidence"] and "boundary record" in parsed[0]["body"], result.stderr or result.stdout)
        except ValueError:
            check("a fenced block after a finding is kept as its evidence", False, result.stderr or result.stdout)
        mixed = root / "claude-mixed.events"
        mixed.write_text(json.dumps({"type": "result", "subtype": "success", "result": "[{\"file\": \"src/a.js\", \"line\": 1, \"summary\": \"good\"}, {\"summary\": \"no file\"}, {\"file\": \"src/b.js\", \"line\": 2, \"summary\": \"good\"}]"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(mixed), "--run", str(run_config("mixed", "claude"))], capture_output=True, text=True)
        check("a bad item names its index when the batch fails", result.returncode == 1 and "finding 1" in result.stderr, result.stderr or result.stdout)
        dict_empty_first = root / "claude-dict-empty-first.events"
        dict_empty_first.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "issues": [{"file": "src/page.js", "line": 8, "summary": "bug"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(dict_empty_first), "--run", str(run_config("dict-empty-first", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an empty findings list does not win over a real issues list", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/page.js", result.stderr or result.stdout)
        except ValueError:
            check("an empty findings list does not win over a real issues list", False, result.stderr or result.stdout)
        dict_two_full = root / "claude-dict-two-full.events"
        dict_two_full.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [{"file": "src/a.js", "line": 1, "summary": "one"}], "issues": [{"file": "src/b.js", "line": 2, "summary": "two"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(dict_two_full), "--run", str(run_config("dict-two-full", "claude"))], capture_output=True, text=True)
        check("two populated dict lists fail loudly", result.returncode == 1 and "JSON finding lists" in result.stderr, result.stderr or result.stdout)
        dict_empty_only = root / "claude-dict-empty-only.events"
        dict_empty_only.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": []}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(dict_empty_only), "--run", str(run_config("dict-empty-only", "claude"))], capture_output=True, text=True)
        check("a whole report of only empty lists stays clean", result.returncode == 0 and result.stdout.strip() == "[]", result.stderr or result.stdout)
        makefile = root / "mimo-makefile.events"
        makefile.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Build\n- Check `Makefile:8`: the clean target removes the wrong dir.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(makefile), "--run", str(run_config("makefile", "mimo"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an extensionless file with a line is a finding", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "Makefile" and parsed[0]["line"] == 8, result.stderr or result.stdout)
        except ValueError:
            check("an extensionless file with a line is a finding", False, result.stderr or result.stdout)
        unclosed = root / "mimo-unclosed.events"
        unclosed.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Bug one `src/page.js:8`\n```js\nreturn all().slice(start, start + size + 1);\n\n### Bug two `src/count.js:6`\nSomething else is wrong.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(unclosed), "--run", str(run_config("unclosed", "mimo"))], capture_output=True, text=True)
        check("an unclosed fence fails loudly", result.returncode == 1 and "unclosed code fence" in result.stderr, result.stderr or result.stdout)
        codex_unclosed = root / "codex-unclosed.events"
        codex_unclosed.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        codex_unclosed_last = root / "codex-unclosed.last"
        codex_unclosed_last.write_text("- [P1] First \u2014 src/a.js:1-1\n```\n- [P1] Second \u2014 src/b.js:2-2\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(codex_unclosed), "--run", str(run_config("codex-unclosed", "codex")), "--last", str(codex_unclosed_last)], capture_output=True, text=True)
        check("an unclosed fence in a codex report fails loudly", result.returncode == 1 and "unclosed code fence" in result.stderr, result.stderr or result.stdout)
        codex_fenced = root / "codex-fenced.events"
        codex_fenced.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        codex_fenced_last = root / "codex-fenced.last"
        codex_fenced_last.write_text("The fix is:\n```\n- [P1] Example bug \u2014 src/page.js:8-8\n```\n- [P1] Real bug \u2014 src/count.js:6-6\n  Real body.\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(codex_fenced), "--run", str(run_config("codex-fenced", "codex")), "--last", str(codex_fenced_last)], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("a codex finding inside a fence is not filed", result.returncode == 0 and len(parsed) == 1 and parsed[0]["file"] == "src/count.js", result.stderr or result.stdout)
        except ValueError:
            check("a codex finding inside a fence is not filed", False, result.stderr or result.stdout)
        notissues = root / "mimo-notissues.events"
        notissues.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Not issues\n- Validation is fine \u2014 `src/count.js:6`: empty stores yield zero pages, which is correct.\n\nNo issues found.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(notissues), "--run", str(run_config("notissues", "mimo"))], capture_output=True, text=True)
        check("a location cited under Not issues is not a finding", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        notissues_resume = root / "mimo-notissues-resume.events"
        notissues_resume.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Bugs\n- Broken \u2014 `src/a.js:1`: wrong.\n### Not issues\n- Fine \u2014 `src/b.js:2`: not wrong.\n### More\n- Also broken \u2014 `src/c.js:3`: wrong.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(notissues_resume), "--run", str(run_config("notissues-resume", "mimo"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("findings outside Not issues still parse", result.returncode == 0 and sorted(f["target"] for f in parsed) == ["src/a.js:1", "src/c.js:3"], result.stderr or result.stdout)
        except ValueError:
            check("findings outside Not issues still parse", False, result.stderr or result.stdout)
        err_subtype = root / "claude-err-subtype.events"
        err_subtype.write_text(json.dumps({"type": "result", "subtype": "error_during_execution", "result": "No findings."}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(err_subtype), "--run", str(run_config("err-subtype", "claude"))], capture_output=True, text=True)
        check("an error result is a failed reviewer, never clean", result.returncode == 1 and "did not succeed" in result.stderr, result.stderr or result.stdout)
        str_list = root / "claude-str-list.events"
        str_list.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": ["bug at src/a.js:1"]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(str_list), "--run", str(run_config("str-list", "claude"))], capture_output=True, text=True)
        check("a findings list of strings fails closed", result.returncode == 1, result.stderr or result.stdout)
        null_list = root / "claude-null-list.events"
        null_list.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [null, null]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(null_list), "--run", str(run_config("null-list", "claude"))], capture_output=True, text=True)
        check("a findings list of nulls fails closed", result.returncode == 1, result.stderr or result.stdout)
        mixed_list = root / "claude-mixed-list.events"
        mixed_list.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"issues": [{"file": "src/a.js", "line": 1, "summary": "one"}, "junk"]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(mixed_list), "--run", str(run_config("mixed-list", "claude"))], capture_output=True, text=True)
        check("a findings list mixing an object with junk fails closed", result.returncode == 1, result.stderr or result.stdout)
        empty_notes = root / "claude-empty-notes.events"
        empty_notes.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "notes": "Bug at src/page.js:8"}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(empty_notes), "--run", str(run_config("empty-notes", "claude"))], capture_output=True, text=True)
        check("a citation in another key defeats an empty findings list", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        empty_plain_notes = root / "claude-empty-plain-notes.events"
        empty_plain_notes.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "notes": "all good"}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(empty_plain_notes), "--run", str(run_config("empty-plain-notes", "claude"))], capture_output=True, text=True)
        check("an empty findings list with other keys fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        none_cited = root / "mimo-none-cited.events"
        none_cited.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "## Findings\nnone\n\nThe bug at src/page.js:8 is real and needs fixing.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(none_cited), "--run", str(run_config("none-cited", "mimo"))], capture_output=True, text=True)
        check("a Findings/none verdict beside a cited line fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        none_cited_codex = root / "codex-none-cited.events"
        none_cited_codex.write_text(json.dumps({"type": "turn.completed"}) + "\n", encoding="utf-8")
        none_cited_last = root / "codex-none-cited.last"
        none_cited_last.write_text("Findings\nnone\n\nPlease fix src/a.js:1 though.\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(none_cited_codex), "--run", str(run_config("none-cited-codex", "codex")), "--last", str(none_cited_last)], capture_output=True, text=True)
        check("a codex Findings/none verdict beside a cited line fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        undeclared = root / "claude-undeclared.events"
        undeclared.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "bugs": [{"file": "src/a.js", "line": 1, "summary": "off by one"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(undeclared), "--run", str(run_config("undeclared", "claude"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("an empty declared list does not block an undeclared findings list", result.returncode == 0 and len(parsed) == 1 and parsed[0]["target"] == "src/a.js:1", result.stderr or result.stdout)
        except ValueError:
            check("an empty declared list does not block an undeclared findings list", False, result.stderr or result.stdout)
        malformed_beside = root / "claude-malformed-beside.events"
        malformed_beside.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": ["unparsed bug at src/page.js:8"], "issues": [{"file": "src/a.js", "line": 1, "summary": "other"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(malformed_beside), "--run", str(run_config("malformed-beside", "claude"))], capture_output=True, text=True)
        check("a malformed list beside a valid one fails loudly", result.returncode == 1 and "hold no objects" in result.stderr, result.stderr or result.stdout)
        err_no_text = root / "claude-err-no-text.events"
        err_no_text.write_text(json.dumps({"type": "result", "subtype": "success", "result": "No findings."}) + "\n" + json.dumps({"type": "result", "subtype": "error_during_execution"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(err_no_text), "--run", str(run_config("err-no-text", "claude"))], capture_output=True, text=True)
        check("a trailing error result without text fails loudly", result.returncode == 1 and "did not succeed" in result.stderr, result.stderr or result.stdout)
        ok_no_text = root / "claude-ok-no-text.events"
        ok_no_text.write_text(json.dumps({"type": "result", "subtype": "success"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(ok_no_text), "--run", str(run_config("ok-no-text", "claude"))], capture_output=True, text=True)
        check("a success result without text fails loudly", result.returncode == 1 and "no result text" in result.stderr, result.stderr or result.stdout)
        escaped_cite = root / "claude-escaped-cite.events"
        escaped_cite.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "notes": "see src/page.js\\u003a8"}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(escaped_cite), "--run", str(run_config("escaped-cite", "claude"))], capture_output=True, text=True)
        check("an escaped citation in another key defeats an empty findings list", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        pair_object = root / "claude-pair-object.events"
        pair_object.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "bug": {"file": "src/a.js", "line": 1}}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(pair_object), "--run", str(run_config("pair-object", "claude"))], capture_output=True, text=True)
        check("a file-and-line pair outside any list defeats an empty findings list", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        key_cite = root / "claude-key-cite.events"
        key_cite.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "src/a.js:1": "seen"}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(key_cite), "--run", str(run_config("key-cite", "claude"))], capture_output=True, text=True)
        check("a citation as a JSON key defeats an empty findings list", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        unrecog = root / "claude-unrecog.events"
        unrecog.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"status": "error", "message": "review timed out"}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(unrecog), "--run", str(run_config("unrecog", "claude"))], capture_output=True, text=True)
        check("an unrecognized JSON shape fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        trailing = root / "claude-trailing.events"
        trailing.write_text(json.dumps({"type": "result", "subtype": "success", "result": '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nAlso src/b.js:2 is wrong.'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(trailing), "--run", str(run_config("trailing", "claude"))], capture_output=True, text=True)
        check("an unfiled location outside the findings list fails loudly", result.returncode == 1 and "outside its filed findings" in result.stderr, result.stderr or result.stdout)
        example = root / "claude-example.events"
        example.write_text(json.dumps({"type": "result", "subtype": "success", "result": 'Example:\n```json\n[{"file": "src/fake.js", "line": 1, "summary": "s"}]\n```\n- Bug at src/real.js:2: actual'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(example), "--run", str(run_config("example", "claude"))], capture_output=True, text=True)
        check("a finding outside the findings list fails loudly", result.returncode == 1 and "outside its filed findings" in result.stderr, result.stderr or result.stdout)
        for name, report in (("fenced-empty", "```json\n[]\n```"), ("fenced-empty-dict", "```json\n{\"findings\": []}\n```")):
            events = root / ("claude-" + name + ".events")
            events.write_text(json.dumps({"type": "result", "subtype": "success", "result": report}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(events), "--run", str(run_config(name, "claude"))], capture_output=True, text=True)
            check("a fenced clean report stays clean", result.returncode == 0 and result.stdout.strip() == "[]", result.stderr or result.stdout)
        for name, report in (("noline", '{"findings": [], "bug": {"file": "src/a.js", "summary": "broken"}}'),
                             ("nullline", '{"findings": [], "bug": {"file": "src/a.js", "line": null, "summary": "broken"}}'),
                             ("hashline", '{"findings": [], "notes": "src/a.js#L8 is wrong"}'),
                             ("atline", '{"findings": [], "notes": "bug in src/a.js at line 3"}'),
                             ("prose-notes", '{"findings": [], "notes": "There is a bug in the sorting logic somewhere."}'),
                             ("issues-empty", '{"issues": []}')):
            events = root / ("claude-" + name + ".events")
            events.write_text(json.dumps({"type": "result", "subtype": "success", "result": report}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(events), "--run", str(run_config(name, "claude"))], capture_output=True, text=True)
            check("a non-clean shape with no findings list fails loudly", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        noother_both = root / "mimo-noother-both.events"
        noother_both.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Bug \u2014 src/a.js:1: one\n\n### No other issues found \u2014 src/b.js:2: two\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(noother_both), "--run", str(run_config("noother-both", "mimo"))], capture_output=True, text=True)
        try:
            parsed = json.loads(result.stdout)
            check("a citation beside the no-other phrase is filed", result.returncode == 0 and sorted(f["target"] for f in parsed) == ["src/a.js:1", "src/b.js:2"], result.stderr or result.stdout)
        except ValueError:
            check("a citation beside the no-other phrase is filed", False, result.stderr or result.stdout)
        for name, report, targets in (("match-colon", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nThe bug at src/a.js:1 is the one.', ["src/a.js:1"]),
                                      ("match-hash", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nSee src/a.js#L1.', ["src/a.js:1"]),
                                      ("match-atline", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nBug in src/a.js at line 1.', ["src/a.js:1"])):
            events = root / ("claude-" + name + ".events")
            events.write_text(json.dumps({"type": "result", "subtype": "success", "result": report}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(events), "--run", str(run_config(name, "claude"))], capture_output=True, text=True)
            try:
                parsed = json.loads(result.stdout)
                check("an outside location naming a filed finding parses", result.returncode == 0 and [f["target"] for f in parsed] == targets, result.stderr or result.stdout)
            except ValueError:
                check("an outside location naming a filed finding parses", False, result.stderr or result.stdout)
        for name, report in (("novel-hash", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nSee src/b.js#L2.'),
                             ("novel-atline", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nBug in src/b.js at line 2.')):
            events = root / ("claude-" + name + ".events")
            events.write_text(json.dumps({"type": "result", "subtype": "success", "result": report}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(events), "--run", str(run_config(name, "claude"))], capture_output=True, text=True)
            check("an unfiled outside location fails loudly", result.returncode == 1 and "outside its filed findings" in result.stderr, result.stderr or result.stdout)
        words = root / "claude-words.events"
        words.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": [], "bugs": [{"file": "src/a.js", "line": 1, "summary": "s"}], "notes": "There is a bug here too."}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(words), "--run", str(run_config("words", "claude"))], capture_output=True, text=True)
        check("finding words beside an empty findings list fail loudly", result.returncode == 1 and "beside its empty findings list" in result.stderr, result.stderr or result.stdout)
        second = root / "claude-second.events"
        second.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"issues": [{"file": "src/a.js", "line": 1, "summary": "s"}], "bugs": [{"file": "src/b.js", "line": 2, "summary": "s"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(second), "--run", str(run_config("second", "claude"))], capture_output=True, text=True)
        check("a second findings list under another key fails loudly", result.returncode == 1 and "outside its filed findings" in result.stderr, result.stderr or result.stdout)
        trial = Path(__file__).resolve().parent.parent / "raw" / "trials" / "code-review-launch"
        recorded = (trial / "opus-report.md").read_text(encoding="utf-8")
        rederive = root / "claude-rederive.events"
        rederive.write_text(json.dumps({"type": "result", "subtype": "success", "result": recorded}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(rederive), "--run", str(run_config("rederive", "claude"))], capture_output=True, text=True)
        check("the recorded claude report re-normalizes byte-identical", result.returncode == 0 and result.stdout == (trial / "opus-findings.json").read_text(encoding="utf-8"), result.stderr or result.stdout)
        unfiled = root / "claude-unfiled.events"
        unfiled.write_text(json.dumps({"type": "result", "subtype": "success", "result": recorded + "\nAlso src/unfiled.js:9 is wrong.\n"}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(unfiled), "--run", str(run_config("unfiled", "claude"))], capture_output=True, text=True)
        check("the recorded report with an unfiled outside location fails loudly", result.returncode == 1 and "outside its filed findings" in result.stderr, result.stderr or result.stdout)
        for name, report, message in (("matched-bullet", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\n- See src/a.js:1 again.', "a markdown finding outside"),
                                      ("twin-list", '{"issues": [{"file": "src/a.js", "line": 1, "summary": "s"}], "bugs": [{"file": "src/a.js", "line": 1, "summary": "s"}]}', "a second findings list"),
                                      ("tag-only", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nDowngraded from [P1] after review.', "a priority tag")):
            events = root / ("claude-" + name + ".events")
            events.write_text(json.dumps({"type": "result", "subtype": "success", "result": report}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(events), "--run", str(run_config(name, "claude"))], capture_output=True, text=True)
            check("structure outside the filed findings fails loudly", result.returncode == 1 and message in result.stderr, result.stderr or result.stdout)
        locationless = root / "claude-locationless.events"
        locationless.write_text(json.dumps({"type": "result", "subtype": "success", "result": '{"findings": ["no locations here"], "issues": [{"file": "src/a.js", "line": 1, "summary": "s"}]}'}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(locationless), "--run", str(run_config("locationless", "claude"))], capture_output=True, text=True)
        check("a locationless malformed list beside a valid one fails loudly", result.returncode == 1 and "hold no objects" in result.stderr, result.stderr or result.stdout)
        nested_skip = root / "mimo-nested-skip.events"
        nested_skip.write_text(json.dumps({"type": "text", "part": {"type": "text", "text": "### Not issues\n#### Sub\n- Broken \u2014 `src/a.js:1`: wrong.\n\nNo issues found.\n"}}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "normalize", "one", str(scratch), str(nested_skip), "--run", str(run_config("nested-skip", "mimo"))], capture_output=True, text=True)
        check("a subsection under Not issues stays skipped", result.returncode == 1 and "cannot parse review output" in result.stderr, result.stderr or result.stdout)
        second = task_home / "second-task-output.txt"
        second.write_text("second task tools\n", encoding="utf-8")
        clash_logs = root / "logs-clash"
        clash_logs.mkdir()
        (clash_logs / ("clash-claude-task-02-" + second.name)).write_text("changed\n", encoding="utf-8")
        clash = root / "harvest-clash.events"
        clash.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(external)}) + "\n" + json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(second)}) + "\n", encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "harvest", str(clash), str(clash_logs), "--prefix", "clash"], capture_output=True, text=True)
        check("a refused harvest copies nothing", result.returncode == 1 and "refusing to overwrite" in result.stderr and not (clash_logs / ("clash-claude-task-01-" + external.name)).exists(), result.stderr or result.stdout)
        link_root = root / "task-link"
        real_root = root / "task-real"
        real_root.mkdir()
        (real_root / "linked-task-output.txt").write_text("linked task tools\n", encoding="utf-8")
        link_root.symlink_to(real_root, target_is_directory=True)
        link_events = root / "harvest-link.events"
        link_events.write_text(json.dumps({"type": "system", "subtype": "task_notification", "output_file": str(real_root / "linked-task-output.txt")}) + "\n", encoding="utf-8")
        try:
            got = harvest(str(link_events), str(root / "logs-link"), "link", task_root=str(link_root))
            check("a symlinked task root still contains its files", len(got) == 1 and Path(got[0]).is_file(), "")
        except (ReportError, TypeError) as exc:
            check("a symlinked task root still contains its files", False, str(exc))
        try:
            harvest(str(link_events), str(root / "logs-link2"), "link", task_root=str(root / "elsewhere"))
            check("a task file outside the given root is still refused", False, "no error")
        except (ReportError, TypeError) as exc:
            check("a task file outside the given root is still refused", "outside" in str(exc), str(exc))
        shutil.rmtree(task_home, ignore_errors=True)

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
