#!/usr/bin/env python3
"""The record of one run of run.sh, from the stream and metadata it kept.

    record.py <keep-dir> <run>              print the record
    record.py --task-files <stream>         print the task output files a claude stream names

A record keeps chosen fields only: the form, the versions, the git commands the reviewer ran with
the files each one's output showed a diff for, the tool counts, how the run ended, whether the
report cites the planted line, and the report. The streams are not kept: claude's init event lists
the machine's own tools and connectors. The scratch's path is written as <tmp>.
"""
import glob, json, os, re, sys

PLANTED_FILE, PLANTED_LINE = "src/page.js", 8
CITE = re.compile(r"page\.js[`'\"*\]]*(?::L?|[\s,(]*(?:lines?|L)\s*)(\d+)(?:\s*(?:-|–|to)\s*L?(\d+))?")


def cites(text):
    """Every (first, last, line) that cites src/page.js with a line number."""
    out = []
    for line in (text or "").splitlines():
        for m in CITE.finditer(line):
            first = int(m.group(1))
            out.append((first, int(m.group(2) or first), line.strip()))
    return out


def reports_planted(text):
    return [c for c in cites(text) if c[0] <= PLANTED_LINE <= c[1]]


# The check is a count, so it is run on a known citation and on known misses before it is trusted.
for text, want in [("src/page.js:8 — the slice ends one past the page", True),
                   ("- [P1] Off by one — <tmp>/src/page.js:7-9", True),
                   ("`src/page.js` line 8: the page has size + 1 records", True),
                   ("src/count.js:6 — rounds up", False), ("(none)", False),
                   ("src/page.js:5 — number is checked", False)]:
    if bool(reports_planted(text)) != want:
        sys.exit("record.py: the planted-line check misreads %r" % text)


def events(path):
    out = []
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def task_files(ev):
    """The output files of the tasks a claude stream says it ran: a forked skill's transcript."""
    return [e["output_file"] for e in ev if e.get("type") == "system"
            and e.get("subtype") == "task_notification" and e.get("output_file")]


def paragraph(lines, i):
    """The lines from i to the next blank one."""
    para = []
    for l in lines[i:]:
        if not l.strip():
            break
        para.append(l)
    return para


def skill_prompt(text):
    """The passages of a skill's prompt that choose what it reviews: the target it was given, the
    level's tag line, and the paragraph that says which diff to read, under its heading where the
    level's prompt has one."""
    out, lines, told = [], text.splitlines(), False
    for i, line in enumerate(lines):
        if line.startswith("Review target:") or (line.startswith("`") and line.endswith("`") and "\u2192" in line):
            out.append(line)
        elif line.startswith("## Turn 1") or line.startswith("## Phase 0"):
            para = paragraph(lines, i + 2)
            out.append("%s: %s" % (line[3:], " ".join(para)))
            told = told or any("@{upstream}" in l for l in para)
    if not told:  # a level with no such heading says it in the paragraph that names @{upstream}
        i = next((i for i, l in enumerate(lines) if "@{upstream}" in l), None)
        if i is not None:
            while i > 0 and lines[i - 1].strip():
                i -= 1
            out.append("diff rule: %s" % " ".join(paragraph(lines, i)))
    return out


def claude(ev, tasks):
    init = next((e for e in ev if e.get("type") == "system" and e.get("subtype") == "init"), {})
    uses, results, tools, prompt, reported = {}, {}, {}, [], []
    for evs, tag in [(ev, "")] + [(events(t), " (forked task)") for t in tasks]:
        for e in evs:
            msg = e.get("message") or {}
            content = msg.get("content")
            if tag and e.get("type") == "user" and isinstance(content, str) and not prompt:
                prompt = skill_prompt(content)
            for c in content if isinstance(content, list) else []:
                if c.get("type") == "tool_use":
                    key = c["name"] + (" (subagent)" if e.get("parent_tool_use_id") else "") + tag
                    tools[key] = tools.get(key, 0) + 1
                    uses[c["id"]] = c
                    if c["name"] == "ReportFindings":
                        reported.append(c.get("input") or {})
                elif c.get("type") == "tool_result":
                    results[c.get("tool_use_id")] = text_of(c.get("content"))
    commands = [(u["input"].get("command", ""), results.get(i, "")) for i, u in uses.items()
                if u.get("name") == "Bash"]
    res = [e for e in ev if e.get("type") == "result"]
    ends = ["subtype=%s is_error=%s num_turns=%s duration_ms=%s cost_usd=%s" % (
        r.get("subtype"), r.get("is_error"), r.get("num_turns"), r.get("duration_ms"), r.get("total_cost_usd"))
        for r in res]
    started = [e for e in ev if e.get("type") == "system" and e.get("subtype") == "task_started"]
    head = ["harness: claude_code_version %s, model %s" % (init.get("claude_code_version"), init.get("model")),
            "code-review offered: %s" % ("code-review" in (init.get("slash_commands") or []))]
    head += ["ran as: a %s task, %s, subagent_type %s; its transcript read: %s" % (
        s.get("task_type"), s.get("description"), s.get("subagent_type"), "yes" if tasks else "no") for s in started]
    head += ["skill prompt: %s" % l for l in prompt]
    # A level whose prompt reports through the findings tool: each call's findings, as the tool got them.
    for call in reported:
        found = call.get("findings") or []
        head.append("findings tool call: level %s, %d finding(s), fields %s" % (
            call.get("level"), len(found), ", ".join(sorted({k for f in found for k in f})) or "none"))
        for f in found:
            head.append("  %s:%s | severity %s | %s" % (f.get("file"), f.get("line"), f.get("severity"),
                        " ".join(str(f.get("summary") or f.get("comment") or "").split())[:160]))
        hit = any(str(f.get("file", "")).endswith(PLANTED_FILE) and str(f.get("line")) == str(PLANTED_LINE) for f in found)
        head.append("planted line %s:%d in the findings tool call: %s" % (PLANTED_FILE, PLANTED_LINE, "yes" if hit else "no"))
    report = (res[-1].get("result") if res else "") or ""
    return head, commands, tools, ends, report


def codex(ev, last, rollouts, dest):
    commands, tools, msgs, ends = [], {}, [], []
    for e in ev:
        item = e.get("item") or {}
        if e.get("type") == "item.completed":
            tools[item.get("type")] = tools.get(item.get("type"), 0) + 1
            if item.get("type") == "command_execution":
                commands.append((item.get("command", ""), item.get("aggregated_output", "")))
            elif item.get("type") == "agent_message":
                msgs.append(item.get("text", ""))
        elif e.get("type") in ("turn.completed", "turn.failed", "error"):
            ends.append("%s %s" % (e["type"], json.dumps(e.get("usage") or e.get("error") or e.get("message"))))
    # The rollouts of the threads in this scratch: the exec thread, which enters and leaves review
    # mode, and the review thread, which is given the review prompt.
    head = []
    for path in rollouts:
        rs = events(path)
        meta = next((r.get("payload") or {} for r in rs if r.get("type") == "session_meta"), {})
        if meta.get("cwd") != dest:
            continue
        ctx = ["model %s, effort %s" % ((r.get("payload") or {}).get("model"), (r.get("payload") or {}).get("effort"))
               for r in rs if r.get("type") == "turn_context"]
        head.append("thread (source %s): %s" % (json.dumps(meta.get("source")), "; ".join(dict.fromkeys(ctx)) or "no turn"))
        for r in rs:
            p = r.get("payload") or {}
            if r.get("type") == "event_msg" and p.get("type") == "user_message" and "Review" in p.get("message", ""):
                head.append("  its review prompt: %s" % " ".join(p["message"].split()))
            item = p.get("item") or {}
            if item.get("type") == "EnteredReviewMode":
                head.append("  review target: %s" % json.dumps(item.get("target")))
            if item.get("type") == "ExitedReviewMode":
                out = item.get("review_output") or {}
                head.append("  review output: overall_correctness %s, %d finding(s)" % (
                    json.dumps(out.get("overall_correctness")), len(out.get("findings") or [])))
                for f in out.get("findings") or []:
                    loc = f.get("code_location") or {}
                    head.append("    %s | priority %s, confidence %s | %s:%s" % (
                        f.get("title"), f.get("priority"), f.get("confidence_score"), loc.get("absolute_file_path"),
                        json.dumps(loc.get("line_range"))))
    report = last or (msgs[-1] if msgs else "")
    return head, commands, tools, ends, report


def mimo(ev):
    """MiMo Code streams its subtask's tool calls inline, under the parent's session id."""
    commands, tools, ends, texts, subtasks = [], {}, [], [], []
    for e in ev:
        p = e.get("part") or {}
        if p.get("type") == "tool":
            tools[p.get("tool")] = tools.get(p.get("tool"), 0) + 1
            st = p.get("state") or {}
            if p.get("tool") == "bash":
                commands.append(((st.get("input") or {}).get("command", ""), st.get("output", "") or ""))
            if p.get("tool") in ("task", "actor"):
                inp = st.get("input") or {}
                model = (st.get("metadata") or {}).get("model") or {}
                err = " ".join(str(st.get("error") or "").split())
                subtasks.append("%s, subagent_type %s: %s%s%s" % (
                    p.get("tool"), (inp.get("operation") or inp).get("subagent_type"), st.get("status"),
                    ", on %s/%s" % (model.get("providerID"), model.get("modelID")) if model else "",
                    " (%s)" % err[:200] if err else ""))
        elif p.get("type") == "text":
            texts.append(p.get("text", ""))
        elif p.get("type") == "step-finish":
            ends.append("step-finish reason=%s cost=%s tokens=%s" % (p.get("reason"), p.get("cost"), json.dumps(p.get("tokens"))))
        if e.get("type") == "error":
            ends.append("error %s" % json.dumps(e.get("error"))[:300])
    return ["subtask: %s" % s for s in subtasks], commands, tools, ends, (texts[-1] if texts else "")


def main():
    if sys.argv[1:2] == ["--task-files"]:
        print("\n".join(task_files(events(sys.argv[2]))))
        return
    keep, run = sys.argv[1:3]
    meta = json.load(open(os.path.join(keep, run + ".meta.json")))
    ev = events(os.path.join(keep, run + ".jsonl"))
    harness = run.split("-")[0]
    if harness == "claude":
        head, commands, tools, ends, report = claude(ev, sorted(glob.glob(os.path.join(keep, run + ".task-*.jsonl"))))
    elif harness == "codex":
        last = open(os.path.join(keep, run + ".last"), encoding="utf-8", errors="replace").read()
        head, commands, tools, ends, report = codex(ev, last, meta["rollouts"], meta["dest"])
    else:
        head, commands, tools, ends, report = mimo(ev)
    err = open(os.path.join(keep, run + ".err"), encoding="utf-8", errors="replace").read()
    shown = set()
    lines = ["run: %s" % run,
             "form: %s" % meta["form"],
             "model asked for: %s, level %s" % (meta["model"], meta["level"]),
             "versions: %s; %s" % (meta["versions"], meta["git"]),
             "BASE %s, HEAD~1 %s, SNAP (HEAD) %s" % (meta["base"], meta["head_1"], meta["snap"]),
             "planted: %s:%s" % (PLANTED_FILE, meta["planted"]),
             "scratch: a worktree detached at SNAP, checked by cut-scratch.sh --check; uncommitted files before the run: %s" % meta["dirty_before"]]
    lines += head
    lines.append("exit: %s, stderr bytes: %d" % (meta["exit"], len(err.encode())))
    if err.strip() and not ev:
        lines.append("stderr: %s" % err.strip()[:400])
    lines.append("tool calls: %s" % (", ".join("%s %d" % kv for kv in sorted(tools.items())) or "none"))
    lines.append("git commands run, with the files each one's output showed a diff for:")
    for cmd, out in commands:
        if "git" not in cmd:
            continue
        files = re.findall(r"^diff --git a/(\S+) b/", out, re.M) + re.findall(r"^ (\S+) +\| +\d+ [+-]*$", out, re.M)
        shown.update(files)
        first = next((l for l in out.splitlines() if l.strip()), "(no output)")
        lines.append("  $ %s\n      -> %s" % (" ".join(cmd.split())[:300],
                     ", ".join(dict.fromkeys(files)) if files else "no diff; first line: " + first[:160]))
    if not any("git" in c for c, _ in commands):
        lines.append("  (none)")
    lines.append("files any git output showed a diff for: %s" % (", ".join(sorted(shown)) or "none"))
    lines += ["end: %s" % e for e in ends] or ["end: none recorded"]
    hit = reports_planted(report)
    lines.append("planted line %s:%d cited by the report: %s" % (PLANTED_FILE, PLANTED_LINE, "yes" if hit else "no"))
    for first, last, line in cites(report):
        lines.append("  page.js cited at %s: %s" % (first if first == last else "%d-%d" % (first, last), line[:200]))
    lines.append("scratch after the run: %s uncommitted, tracked files changed since SNAP: %s" % (
        meta["dirty_after"], meta["changed_since_snap"].strip() or "none"))
    lines.append("--- the report ---")
    lines.append(scrub(report).strip() or "(empty)")
    out = "\n".join(lines).replace(meta["tmp"], "<tmp>").replace(os.path.expanduser("~"), "~")
    if re.search(r"connector|mcp__", out, re.I):
        sys.exit("record.py: the record of %s still names a connector; nothing written" % run)
    print(out)


def scrub(report):
    """A harness can add a line about the machine's own connectors to its report. Such a line says
    nothing about the review and names the account's setup, so it is replaced, and says so."""
    return "\n".join("[a line about this machine's account integrations, removed by record.py]"
                     if re.search(r"connector|mcp__", l, re.I) else l for l in report.splitlines())


if __name__ == "__main__":
    main()
