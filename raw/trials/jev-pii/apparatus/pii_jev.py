#!/usr/bin/env python3
"""Judge lines for personal data with Jev 1.13, through OpenRouter's System One endpoint.

  pii_jev.py corpus  --out <dir> [--repeats N] [--key-file <file>] [--version v2..v6]
  pii_jev.py history --out <dir> [--range <rev>] [--key-file <file>] [--version v2..v6]
  pii_jev.py rejudge --out <dir> --from <history.json> [--key-file <file>] [--version v2..v6]
  pii_jev.py score   --out <dir> [--version v2..v6]   (rescore a corpus run from its saved answers)

The corpus and score modes take --lines <file> to judge other labelled lines instead of the
corpus: a JSON list of {"label", "parts"}, each line stored in pieces as the patterns trial
keeps the lines another model wrote (`../../pii-patterns/`); a label of "none" is a negative.

The second iteration of #208's AI check, after the user narrowed the scope on 2026-10-02:
personal data only, since private context such as paths, hosts, ids and attribution is allowed.
Following TypeSafe's guidance, every question is atomic and every exclusion is made in code:

- A line gets six yes/no questions: does it name a person; is everyone it names a well-known
  public figure; is everyone it names a placeholder or textbook name; does it hold a phone
  number; a street address; other personal details (a date of birth, an identity, bank or card
  number, a health detail).
- An email address is found by a pattern, dropped in code when it is a public no-reply address
  or on a reserved domain, and only then put to Jev: does it belong to an individual person.
- A phone number counts only on a line holding seven or more digits, checked in code.

person = names a person, and none of the exclusion questions reaches 0.5. Each kind counts at or
above the threshold, swept in the scores.

Versions. v2 is the above. v3, after v2's pass over this repository's history, adds two
exclusions, each another atomic question: is everyone named a cited author of a published work,
and is every name that of a tool, model, agent role or product rather than a human. v4 widens
the cited-author question to preprints and citations, and masks in code, before any question,
the project's own names that are not people: its roles, lanes, harnesses, hosts and account, all
already public in the repository. v5 answers v4's finding that a line-only author question
clears a private name in a manifest's author field: it masks "lane" too, drops the line-only
author question, and asks instead, in a second request and only for a line that would otherwise
be flagged as naming a person, whether everyone it names is an author of a work that the line or
the lines around it cite. v6 widens that question from a work cited by its title, venue or link
to one cited by its authors and year as well.

The corpus mode runs a labelled set of made-up lines built here from fragments; the history mode
runs every unique added line of this repository's history once and records, for each line Jev
flags, where it was added and the kinds, never the text. The rejudge mode asks again, with a
later version, the lines a v2 history pass flagged at 0.5, and under v4 also every line the mask
changes: an exclusion only removes findings, so a line v2 cleared stays cleared, within the
noise of Jev's answers, which vary between calls. The key is OPENROUTER_API_KEY, from the
environment or --key-file.
"""
import concurrent.futures
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

URL = "https://openrouter.ai/api/v1/systemone"
MODEL = "typesafe/jev-1.13"
KINDS = ["person", "email", "phone", "postal-address", "other-personal"]
QUESTIONS = dict([
    ("names_person", "Does `line` contain the name of a person?"),
    ("public_figure", "Is every person named in `line` a well-known public figure?"),
    ("placeholder", "Is every person named in `line` a placeholder or textbook example name, such as Alice, Bob, Jane Doe or John Smith?"),
    ("phone", "Does `line` contain a phone number?"),
    ("address", "Does `line` contain a street address?"),
    ("other", "Does `line` contain a date of birth, an identity, bank or card number, or a health detail about a person?"),
])
V3_QUESTIONS = dict([
    ("cited_author", "Is every person named in `line` named as an author of a published paper, article or book?"),
    ("not_human", "Is every name in `line` the name of a software tool, an AI model, an agent role or a product, rather than a human being?"),
])
V4_QUESTIONS = dict([
    ("cited_author", "Is every person named in `line` named as an author of a paper, preprint, article, book or talk, or in the citation of one?"),
])
PROJECT_NAMES = ("postmaster", "coachman", "workhorse", "wheeler", "sentinel", "luna", "sol", "mimo", "opus",
                 "claude", "codex", "grok", "pi", "muse", "agy", "herdr", "tmux", "brindlewick")
NAMES = re.compile(r"(?i)(?<![A-Za-z0-9])(?:%s)(?![A-Za-z0-9])" % "|".join(PROJECT_NAMES))
NAMES_V5 = re.compile(r"(?i)(?<![A-Za-z0-9])(?:%s)(?![A-Za-z0-9])" % "|".join(PROJECT_NAMES + ("lane", "lanes")))
CITATION_QUESTION = ("Is every person named in `line` an author of a published paper, preprint, article, book or "
                     "talk that `line` or `context` cites by its title, venue or link?")
CITATION_QUESTION_V6 = ("Is every person named in `line` an author of a published paper, preprint, article, book or "
                        "talk that `line` or `context` cites, whether by its title, by its authors and year, by its "
                        "venue or by a link?")
VERSION = {"questions": dict(QUESTIONS), "mask": False, "names": NAMES, "citation": False}
# The lines around a line, by its text: up to three on each side, for v5's citation question.
CONTEXT = {}
# Labelled lines to judge in place of the corpus, from --lines.
LINES = {"file": None}

EMAIL_QUESTION = "Does `email` belong to an individual person, rather than a company, team, mailing list, service or bot?"
MAILBOX_SHAPE = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9-])")
NOREPLY_LOCAL = {"noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "mailer-daemon"}
RESERVED = ("example", "example.com", "example.net", "example.org", "test", "invalid", "localhost")
THRESHOLDS = (0.5, 0.7, 0.8, 0.9)


def masked(line):
    """The line as Jev sees it: from v4, the project's own names are replaced by TOOL."""
    return VERSION["names"].sub("TOOL", line) if VERSION["mask"] else line


def public_or_reserved(address):
    local, _, domain = address.lower().rpartition("@")
    return (local in NOREPLY_LOCAL or domain == "users.noreply.github.com"
            or any(domain == r or domain.endswith("." + r) for r in RESERVED))


def key(path):
    if path:
        for raw in pathlib.Path(path).expanduser().read_text().splitlines():
            m = re.match(r"^\s*(?:export\s+)?OPENROUTER_API_KEY=(.*)$", raw)
            if m:
                return m.group(1).strip().strip("'\"")
        sys.exit("pii_jev: no OPENROUTER_API_KEY in the key file")
    return os.environ.get("OPENROUTER_API_KEY") or sys.exit("pii_jev: OPENROUTER_API_KEY is not set")


def ask(api_key, line):
    """Jev's probabilities for one line: the questions, one per email candidate, and from v5 the
    citation question for a line that would otherwise be flagged as naming a person. A question
    left unanswered reads as 0 here; a gate would have to fail on it instead."""
    candidates = [m.group() for m in MAILBOX_SHAPE.finditer(line) if not public_or_reserved(m.group())]
    questions = {name: {"type": "noul", "instructions": text} for name, text in VERSION["questions"].items()}
    state = {"line": masked(line)}
    for index, address in enumerate(candidates):
        state["email_%d" % index] = address
        questions["email_%d" % index] = {"type": "noul",
                                         "instructions": EMAIL_QUESTION.replace("`email`", "`email_%d`" % index)}
    reply = call(api_key, state, questions)
    if "error" in reply or not VERSION["citation"] or "person" not in kinds(line, reply["nouls"], 0.5):
        return reply
    second = call(api_key, {"line": masked(line), "context": masked(CONTEXT.get(line, ""))},
                  {"cited_author": {"type": "noul", "instructions": VERSION["citation"]}})
    if "error" in second:
        return second
    reply["nouls"]["cited_author"] = second["nouls"]["cited_author"]
    return {"nouls": reply["nouls"], "cost": reply["cost"] + second["cost"], "second": True}


def call(api_key, state, questions):
    body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
    for attempt in range(6):
        request = urllib.request.Request(URL, data=body, headers={
            "Authorization": "Bearer " + api_key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                reply = json.loads(response.read())
            answers = reply.get("answers") or {}
            nouls = {name: round(float((answers.get(name) or {}).get("noul", 0)), 3) for name in questions}
            return {"nouls": nouls, "cost": float((reply.get("usage") or {}).get("cost") or 0)}
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503) or attempt == 5:
                return {"error": error.code}
        except (urllib.error.URLError, TimeoutError):
            if attempt == 5:
                return {"error": "network"}
        time.sleep(2 ** attempt)
    return {"error": "retries"}


def kinds(line, nouls, threshold):
    found = []
    if (nouls.get("names_person", 0) >= threshold and nouls.get("public_figure", 0) < 0.5
            and nouls.get("placeholder", 0) < 0.5 and nouls.get("cited_author", 0) < 0.5
            and nouls.get("not_human", 0) < 0.5):
        found.append("person")
    if any(v >= threshold for name, v in nouls.items() if name.startswith("email_")):
        found.append("email")
    if len(re.findall(r"[0-9]", line)) >= 7 and nouls.get("phone", 0) >= threshold:
        found.append("phone")
    if nouls.get("address", 0) >= threshold:
        found.append("postal-address")
    if nouls.get("other", 0) >= threshold:
        found.append("other-personal")
    return found


def run_all(api_key, lines, workers):
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        replies = list(pool.map(lambda line: ask(api_key, line), lines))
    return replies, round(time.monotonic() - started, 1)


def corpus():
    """Made-up lines, each labelled with the kind it holds, or "" for a hard negative."""
    if LINES["file"]:
        rows = json.loads(pathlib.Path(LINES["file"]).read_text())
        return [("" if row["label"] == "none" else row["label"], "".join(row["parts"])) for row in rows]
    n = lambda *parts: "".join(parts)  # noqa: E731 - names built in pieces
    at = "@"
    items = [
        ("person", n("Thanks to Ingrid ", "Halvorsen-Mbeki for reporting the crash.")),
        ("person", n("Assigned to Tomasz ", "Wierzbicki-Lund; he is back on Monday.")),
        ("person", n('author = "Priyanka ', 'Venkataraman-Oduya"')),
        ("person", json.dumps({"display_name": n("Kofi ", "Annorbah-Sarpei"), "role": "admin"})),
        ("person", n("D", "r. Henrietta ", "Okonkwo-Baptiste reviewed the scan results.")),
        ("person", n("Signed-off-by: Mateus ", "Albuquerque-Ferreira")),
        ("person", n("# Maintainer: Ewa ", "Kwiatkowska-Ruiz")),
        ("person", json.dumps({"text": n("my na", "me is Yusuf ", "Demirci-Hallam and I run the bakery on the corner")})),
        ("person", n("Meeting notes: Lars, Aiko ", "Watanabe-Price and I agreed on the date.")),
        ("person", n("The landlord, M", "r Desmond ", "Achterberg-Ngata, wants the deposit by Friday.")),
        ("email", n("Contact: ingrid.halvorsen", at, "fjordmail-413.net")),
        ("email", n("Send the logs to tomasz.w.lund", at, "quietharbour-413.net.")),
        ("email", json.dumps({"from": n("kofi.annorbah", at, "postbox-413.org")})),
        ("email", n("cc: priyanka.v.oduya", at, "inbox-413.io")),
        ("phone", n("Call me on +44 77", "00 900", "461 after six.")),
        ("phone", n("Her mobile is (555) 010-", "4477.")),
        ("phone", n("Tel: 0161 496 ", "0738")),
        ("phone", n("WhatsApp +1 202 555 ", "0143 about the keys.")),
        ("phone", n('phone_number = "+61 49', '1 570 ', '156"')),
        ("postal-address", n("Ship it to 7 Wren Cl", "ose, ", "Fallowmere FM", "3 2QT.")),
        ("postal-address", n("Her flat is at 48 Larkspur R", "ow, ", "Apartment 5B, Thistlecombe.")),
        ("postal-address", json.dumps({"address": n("1180 Juniper Hol", "low ", "Road, Cedar Falls")})),
        ("postal-address", n("We moved to Kastanienw", "eg 12, ", "99999 Beispielstadt last month.")),
        ("other-personal", n("Her date of bi", "rth is 14 March 1987.")),
        ("other-personal", n("SSN 900-12-", "3456 is on the form.")),
        ("other-personal", n("Card 4000 0566 5566 ", "5556 expires 09/29.")),
        ("other-personal", n("IBAN GB3", "3 BUKB 2020 1555 ", "5555 55 for the refund.")),
        ("other-personal", n("He was diag", "nosed with type 1 diabetes in March, so he skips the dinner.")),
        ("other-personal", n("Pass", "port X12", "34567 expires next year.")),
        ("other-personal", n("Her sal", "ary is 84,000 a year and she rents the flat from her brother.")),
        ("", "Linus Torvalds merged the scheduler change in 2007."),
        ("", "Ada Lovelace wrote the first published algorithm."),
        ("", "Alice sends Bob the session key in the protocol diagram."),
        ("", n('const user = { name: "Jane Doe", em', 'ail: ', '"jane', at, 'example.com" };')),
        ("", "John Smith is the default author in the fixture template."),
        ("", "Install @huggingface/transformers and run the pipeline."),
        ("", "Claude Code supports a --model flag."),
        ("", "The Herdr pane shows the agent as idle."),
        ("", n("Report problems to support", at, "github.com.")),
        ("", "Set `author_email` in the config file."),
        ("", "Version 10.20.30 fixes the parser."),
        ("", "The job ran at 2026-10-01 12:30:45 UTC."),
        ("", "Listen on port 8080 and retry after 300 ms."),
        ("", "The commit 89abcdef0123 introduced the bug."),
        ("", "Main Street is the name of the demo dataset."),
        ("", "The release date is 14 March 2027."),
        ("", "Our office is open from 9 to 5 on weekdays."),
        ("", "Use the test card number from the payment provider's docs."),
        ("", "The patient record schema has a diagnosis field."),
        ("", "A UUID such as 123e4567-e89b-12d3-a456-426614174000 identifies the job."),
        ("", "The Kubernetes maintainers released 1.31 last week."),
        ("", "Thanks to everyone who reported the crash."),
        ("", n("Sherlock Holmes lives at 221B Baker Str", "eet in the stories.")),
        ("", "Contact the maintainers through the issue tracker."),
        ("", "The model was trained by OpenAI and Anthropic researchers."),
        ("", "Call the support line on 1-800-555-0199 during office hours."),
        ("", "brindlewick maintains this project."),
        ("", "The GitHub user octocat opened the issue."),
        ("", "Rename the helper to match the others."),
        ("", "The form's phone field accepts up to fifteen digits."),
    ] + ([] if "not_human" not in VERSION["questions"] else [
        ("", "The coachman harvests both lanes before the review."),
        ("", "luna and mimo reviewed the change in round two."),
        ("", "Petersson and others (2004) measured capture-recapture in software inspections."),
        ("", "Herdr reports the pane as idle when Claude finishes its turn."),
        ("person", n("Ingrid from the support desk said M", "rs Halvorsen-", "Mbeki can be reached at home.")),
    ]) + ([] if not VERSION["mask"] else [
        ("", "Al Haddad, Ikram, Ahmed and Lee, a preprint of October 2025."),
        ("", "reviewers: luna, mimo"),
        ("person", n("Luna ", "Okafor-Brandt asked for the refund in person.")),
    ]) + ([] if not VERSION["citation"] else [
        ("", n("auth", "or: Mirela Van", "tongeren, Kwabena Osei-Fairweather")),
        ("person", n('"au', 'thor": "Bronagh ', 'Treloar-Sandoval",')),
        ("person", n("Copyright (c) 2026 Bronagh ", "Treloar-Sandoval")),
    ])
    # The lines around five of them, which only v5's citation question reads: two names in
    # authors' fields that cite nothing, two citations, and a licence's copyright line.
    CONTEXT.update([
        (items[2][1], '[package]\nname = "fernhill"\nversion = "0.3.1"\nlicense = "MIT"'),
        ("Al Haddad, Ikram, Ahmed and Lee, a preprint of October 2025.",
         '---\ntitle: "Evaluating models for vulnerability triage and prioritization (Al Haddad, Ikram, Ahmed and '
         'Lee, 2025)"\nsources: [papers/al-haddad-2025-vulnerability-triage]\n---'),
        (n("auth", "or: Mirela Van", "tongeren, Kwabena Osei-Fairweather"),
         'title: "Measuring review latency in open-source projects"\n'
         'url: https://example.org/papers/review-latency.pdf\nretrieved: 2026-10-01'),
        (n('"au', 'thor": "Bronagh ', 'Treloar-Sandoval",'),
         '{\n  "name": "fernhill-cli",\n  "version": "1.2.0",\n  "license": "MIT",'),
        (n("Copyright (c) 2026 Bronagh ", "Treloar-Sandoval"),
         "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy"),
    ])
    return items


CLEAN = ["The cache expires after ten minutes.", "Run the tests before you push.",
         "The parser now accepts trailing commas.", "Logging moves to its own module.",
         "The flag defaults to off.", "Retry twice, then give up.",
         "The table sorts by date, newest first.", "Remove the unused import.",
         "The release notes list three fixes.", "The build takes about a minute."]


def corpus_mode(out, repeats, api_key):
    items = corpus()
    lines = [text for _label, text in items]
    with open(out / "corpus.txt", "w") as handle:
        for number, (label, _text) in enumerate(items, 1):
            handle.write("%d\t%s\n" % (number, label or "negative"))
    runs = []
    for run in [str(n) for n in range(1, repeats + 1)] + ["control"]:
        given = CLEAN if run == "control" else lines
        replies, seconds = run_all(api_key, given, 8)
        record = {"run": run, "seconds": seconds,
                  "cost_usd": round(sum(r.get("cost", 0) for r in replies), 6),
                  "errors": sum(1 for r in replies if "error" in r),
                  "nouls": [list(r.get("nouls", {}).items()) for r in replies]}
        (out / ("jev-%s.json" % run)).write_text(json.dumps(record) + "\n")
        runs.append(record)
        print("jev %s %ss errors=%d" % (run, seconds, record["errors"]), flush=True)
    score_corpus(out, items, lines, runs)


def score_corpus(out, items, lines, runs):
    main = [r for r in runs if r["run"] != "control"]
    control = [r for r in runs if r["run"] == "control"][0]
    report = ["Lines found by the majority of %d calls, as found/total; in brackets, the fewest and" % len(main),
              "most found by any one call, since a linter makes one call per line.", "",
              "threshold  personal-data lines  kind right  negatives raised  control"]
    for threshold in THRESHOLDS:
        found_pos = right = raised = 0
        for index, (label, line) in enumerate(items):
            votes = []
            for record in main:
                nouls = dict(record["nouls"][index])
                votes.append(kinds(line, nouls, threshold))
            flagged = sum(1 for v in votes if v) * 2 > len(votes)
            named = sum(1 for v in votes if label in v) * 2 > len(votes)
            if label:
                found_pos += flagged
                right += named
            else:
                raised += flagged
        control_hits = sum(1 for i, line in enumerate(CLEAN) if kinds(line, dict(control["nouls"][i]), threshold))
        positives = sum(1 for label, _ in items if label)
        per_found, per_raised = [], []
        for record in main:
            hits = [(label, bool(kinds(line, dict(record["nouls"][i]), threshold))) for i, (label, line) in enumerate(items)]
            per_found.append(sum(1 for label, hit in hits if label and hit))
            per_raised.append(sum(1 for label, hit in hits if not label and hit))
        report.append("%-10s %-20s %-11s %-17s %s" % (
            threshold, "%d/%d (%d-%d)" % (found_pos, positives, min(per_found), max(per_found)),
            "%d/%d" % (right, positives),
            "%d/%d (%d-%d)" % (raised, len(items) - positives, min(per_raised), max(per_raised)), control_hits))
    report += ["", "Negatives raised at 0.5 and 0.9, and positives missed at 0.9, by corpus line number:"]
    for threshold in (0.5, 0.9):
        raised, missed = [], []
        for index, (label, line) in enumerate(items):
            votes = [kinds(line, dict(r["nouls"][index]), threshold) for r in main]
            flagged = sum(1 for v in votes if v) * 2 > len(votes)
            if not label and flagged:
                raised.append(str(index + 1))
            if label and not flagged and threshold == 0.9:
                missed.append("%d (%s)" % (index + 1, label))
        report.append("at %s raised: %s" % (threshold, ", ".join(raised) or "none"))
        if threshold == 0.9:
            report.append("at 0.9 missed: %s" % (", ".join(missed) or "none"))
    report += ["", "Seconds and cost per call: " + ", ".join(
        "%s %ss $%s" % (r["run"], r["seconds"], r["cost_usd"]) for r in runs)]
    (out / "scores.txt").write_text("\n".join(report) + "\n")
    print("\n".join(report))


def dump(record):
    """A history record as JSON with one flagged line per row, so a long list stays short."""
    rows = ["{"] + [" %s: %s," % (json.dumps(k), json.dumps(v)) for k, v in record.items() if k != "flagged"]
    rows.append(' "flagged": {')
    thresholds = list(record["flagged"])
    for t_index, threshold in enumerate(thresholds):
        entries = record["flagged"][threshold]
        rows.append("  %s: [" % json.dumps(threshold))
        rows += ["   %s%s" % (json.dumps(e), "," if i < len(entries) - 1 else "") for i, e in enumerate(entries)]
        rows.append("  ]%s" % ("," if t_index < len(thresholds) - 1 else ""))
    return "\n".join(rows + [" }", "}"]) + "\n"


def history_lines(rev):
    """Every unique added line of rev's history outside raw/runs and JSONL files, with the
    commit and path that first added it, oldest first; lines with no letter and fewer than seven
    digits are skipped."""
    log = subprocess.run(["git", "log", "--reverse", "--no-merges", "--no-renames", "-p", "--format=commit %H",
                          rev, "--", ".", ":!raw/runs", ":!*.jsonl"],
                         capture_output=True, text=True, errors="replace", check=True).stdout
    seen, out, commit, path = set(), [], "", ""
    hunk, pending = [], []

    def flush():
        for text, at in pending:
            CONTEXT[text] = "\n".join(hunk[max(0, at - 3):at] + hunk[at + 1:at + 4])
        hunk.clear()
        pending.clear()

    for raw in log.splitlines():
        if raw.startswith(("commit ", "diff --git ", "@@")):
            flush()
            if raw.startswith("commit "):
                commit = raw[7:]
        elif raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else ""
        elif raw.startswith(" "):
            hunk.append(raw[1:])
        elif raw.startswith("+") and not raw.startswith("+++") and path:
            text = raw[1:]
            hunk.append(text)
            if not re.search(r"[A-Za-z]", text) and len(re.findall(r"[0-9]", text)) < 7:
                continue
            if text.strip() and text not in seen:
                seen.add(text)
                pending.append((text, len(hunk) - 1))
                out.append((commit, path, text))
    flush()
    return out


def history_mode(out, rev, api_key):
    items = history_lines(rev)
    replies, seconds = run_all(api_key, [text for _c, _p, text in items], 16)
    flagged = {t: [] for t in THRESHOLDS}
    for index, ((commit, path, text), reply) in enumerate(zip(items, replies)):
        nouls = reply.get("nouls") or {}
        for threshold in THRESHOLDS:
            found = kinds(text, nouls, threshold)
            if found:
                # The index into history_lines(rev) finds the text again; the text is not kept.
                flagged[threshold].append({"index": index, "commit": commit[:12], "path": path, "kinds": found})
    record = {"rev": subprocess.run(["git", "rev-parse", rev], capture_output=True, text=True).stdout.strip(),
              "lines": len(items), "seconds": seconds, "errors": sum(1 for r in replies if "error" in r),
              "cost_usd": round(sum(r.get("cost", 0) for r in replies), 4),
              "flagged": {str(t): v for t, v in flagged.items()}}
    (out / "history.json").write_text(dump(record))
    print("history: %d lines, %ss, errors %d, $%s; flagged at 0.5/0.7/0.8/0.9: %s" % (
        record["lines"], seconds, record["errors"], record["cost_usd"],
        "/".join(str(len(flagged[t])) for t in THRESHOLDS)))


def rejudge_mode(out, source, api_key):
    """Ask again, with this version's questions, the lines a history pass flagged at 0.5."""
    earlier = json.loads(pathlib.Path(source).read_text())
    items = history_lines(earlier["rev"])
    indices = [f["index"] for f in earlier["flagged"]["0.5"]]
    if VERSION["mask"]:
        asked = set(indices)
        # A masked line's state differs from what v2 asked, so it is asked whatever v2 said.
        indices += [i for i, (_c, _p, text) in enumerate(items) if i not in asked and masked(text) != text]
    replies, seconds = run_all(api_key, [items[i][2] for i in indices], 16)
    flagged = {t: [] for t in THRESHOLDS}
    for index, reply in zip(indices, replies):
        commit, path, text = items[index]
        for threshold in THRESHOLDS:
            found = kinds(text, reply.get("nouls") or {}, threshold)
            if found:
                flagged[threshold].append({"index": index, "commit": commit[:12], "path": path, "kinds": found})
    record = {"rev": earlier["rev"], "lines": earlier["lines"], "asked": len(indices),
              "asked_twice": sum(1 for r in replies if r.get("second")), "seconds": seconds,
              "errors": sum(1 for r in replies if "error" in r),
              "cost_usd": round(sum(r.get("cost", 0) for r in replies), 4),
              "flagged": {str(t): v for t, v in flagged.items()}}
    (out / "history.json").write_text(dump(record))
    print("rejudged %d of %d lines, %ss, errors %d, $%s; flagged at 0.5/0.7/0.8/0.9: %s" % (
        len(indices), earlier["lines"], seconds, record["errors"], record["cost_usd"],
        "/".join(str(len(flagged[t])) for t in THRESHOLDS)))


def score_mode(out):
    items = corpus()
    runs = [json.loads(path.read_text()) for path in sorted(out.glob("jev-*.json"))]
    score_corpus(out, items, [text for _label, text in items], runs)


def main(args):
    if not args or args[0] not in ("corpus", "history", "rejudge", "score"):
        sys.exit(__doc__)
    mode, opts = args[0], {"--out": None, "--repeats": "3", "--key-file": None, "--range": "origin/main",
                           "--version": "v3", "--from": None, "--lines": None}
    rest = args[1:]
    while rest:
        head = rest.pop(0)
        if head not in opts or not rest:
            sys.exit(__doc__)
        opts[head] = rest.pop(0)
    if not opts["--out"]:
        sys.exit(__doc__)
    out = pathlib.Path(opts["--out"])
    out.mkdir(parents=True, exist_ok=True)
    if opts["--version"] in ("v3", "v4", "v5", "v6"):
        VERSION["questions"].update(V3_QUESTIONS)
    if opts["--version"] == "v4":
        VERSION["questions"].update(V4_QUESTIONS)
        VERSION["mask"] = True
    if opts["--version"] in ("v5", "v6"):
        del VERSION["questions"]["cited_author"]
        VERSION.update(mask=True, names=NAMES_V5,
                       citation=CITATION_QUESTION if opts["--version"] == "v5" else CITATION_QUESTION_V6)
    LINES["file"] = opts["--lines"]
    if mode == "score":
        return score_mode(out)
    api_key = key(opts["--key-file"])
    if mode == "corpus":
        corpus_mode(out, int(opts["--repeats"]), api_key)
    elif mode == "rejudge":
        rejudge_mode(out, opts["--from"], api_key)
    else:
        history_mode(out, opts["--range"], api_key)


if __name__ == "__main__":
    main(sys.argv[1:])
