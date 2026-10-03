#!/usr/bin/env python3
"""Compare an AI privacy check with #135's mechanical scanner on the same made-up lines.

  ai_check.py <source> --out <dir> [--tmp <dir>] [--levels a,b] [--repeats N] [--opf <dir>]
              [--key-file <file>]
  ai_check.py <source> --out <dir> --score-only

<source> is what ../../scanner-rule-format/apparatus/load.py takes (git:<ref>:<path>). The
corpus is built here at run time and never written down: #135's own fixture lines, the eight
probes of the scanner-rule-format trial, and 36 open-ended lines written for this trial, each
labelled before any model sees it. Every line is made up, built from fragments. The mechanical
check is #135's whole line pipeline; each AI level is a harness model given the same numbered
lines and a fixed instruction, answering in JSON with line numbers and kinds, never values.
Each AI level answers the corpus --repeats times, plus a control of ten plain lines. The
level opf is OpenAI's Privacy Filter run locally by opf.ts, which --opf names a folder for: one
holding @huggingface/transformers in node_modules and the model under models/. The level jev
is TypeSafe's Jev 1.13 through OpenRouter's System One endpoint: one request per line, with one
yes/no question per kind; it reads OPENROUTER_API_KEY from the environment, or from the
file of name=value lines --key-file names. --score-only makes no call and scores every level whose answers
are already in --out.

Writes, under --out: corpus.txt (each line's number, group, label, expected kind and name,
never its text), mechanical.txt, one <level>-<n>.json per call (the parsed findings, the
exit status and the seconds taken), and scores.txt.
"""
import concurrent.futures
import json
import os
import pathlib
import random
import re
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
RULE_TRIAL = HERE.parent.parent / "scanner-rule-format" / "apparatus"
sys.path.insert(0, str(RULE_TRIAL))
import probes as rule_probes  # noqa: E402

KINDS = ["secret", "email", "home-path", "private-host", "account-id", "attribution",
         "person", "phone", "postal-address", "other-personal"]

INSTRUCTION = """You check text for private data before it is published. Each line below is
one line a change would publish, after its number and a colon. Report every line that holds
private data of these kinds:
- secret, meaning a token, API key, password, credential, or private-key material
- email, meaning an email address, except a public no-reply address or one on a reserved domain
  (example.com, example.org, example.net, or names ending .test, .invalid or .localhost)
- home-path, meaning a file path that names one person's home directory (such as /home/<name> or
  /Users/<name>) or a per-user temporary folder of an agent tool; a placeholder user such as
  user, username, $USER or <user>, or a bare ~/, names nobody
- private-host, meaning a host or address on a private network: a private, link-local or
  carrier-grade IP address, a name under .internal, .local, .lan, .home.arpa or a tailnet
  (.ts.net), or a personal device's name
- account-id, meaning an identifier of an account, organisation, customer, user or session
- attribution, meaning a statement or trailer crediting an AI assistant or AI tool with writing or
  co-writing the work, in any wording
- person, meaning the name of a private individual (not a public figure, not a placeholder such as
  Alice or Bob, not a product or project)
- phone, meaning a phone number of a person
- postal-address, meaning a street address
- other-personal, meaning any other data that identifies a private person or their private life
Report a line even when its value looks made up or like test data; made-up data is marked
separately. Do not report a line that only names a kind of data without holding any, such as a
sentence about email addresses or a field name. Never repeat a private value in your answer.
Answer with JSON only: {"findings": [{"line": <number>, "kind": "<kind>"}]}, one entry per
line and kind found, and an empty list when nothing is found."""

SCHEMA = {
    "type": "object",
    "properties": {"findings": {"type": "array", "items": {
        "type": "object",
        "properties": {"line": {"type": "integer"}, "kind": {"type": "string", "enum": KINDS}},
        "required": ["line", "kind"], "additionalProperties": False}}},
    "required": ["findings"], "additionalProperties": False,
}

# The AI levels: harnesses this machine runs, at low effort, with no tools.
LEVELS = {
    "haiku": ("claude", "claude-haiku-4-5-20251001", None),
    "opus": ("claude", "claude-opus-5-5", "low"),
    "sol": ("codex", "gpt-6-sol", "low"),
    "mimo": ("mimo", "xiaomi-token-plan-sgp/mimo-v2.6-pro", "low"),
    "opf": ("local", "openai/privacy-filter, 4-bit ONNX", None),
    "jev": ("jev", "typesafe/jev-1.13", None),
}

# Jev reads each question literally and answers each one on its own (TypeSafe's guidance), so
# every kind is one yes/no question about the line, carrying that kind's whole definition.
JEV_QUESTIONS = dict([
    ("secret", "Does `line` hold a token, API key, password, credential or private-key material, real or made up?"),
    ("email", "Does `line` hold an email address, real or made up, other than a public no-reply address or one at example.com, example.org or example.net or under a name ending .test, .invalid or .localhost?"),
    ("home-path", "Does `line` hold a file path that names one person's home directory, such as /home/<name> or /Users/<name>, or a per-user temporary folder of an agent tool? A placeholder user such as user, username, $USER or <user>, or a bare ~/, names nobody."),
    ("private-host", "Does `line` hold a host or address on a private network: a private, link-local or carrier-grade IP address, a name under .internal, .local, .lan, .home.arpa or .ts.net, or a personal device's name?"),
    ("account-id", "Does `line` hold an identifier of an account, organisation, customer, user or session, not just the name of a field?"),
    ("attribution", "Does `line` credit an AI assistant or AI tool with writing or co-writing the work, in any wording?"),
    ("person", "Does `line` hold the name of a private individual, not a public figure, not a placeholder such as Alice or Bob, and not a product or project?"),
    ("phone", "Does `line` hold a phone number of a person, real or made up?"),
    ("postal-address", "Does `line` hold a street address, real or made up?"),
    ("other-personal", "Does `line` hold other data that identifies a private person or their private life?"),
])
JEV_URL = "https://openrouter.ai/api/v1/systemone"

# A run inside another agent's session must not carry that session's identity (issue #102).
IDENTITY = re.compile(r"^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION|MESSAGING|CHILD)\w*|"
                      r"CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_EXECPATH|CLAUDE_CODE_TOOL_USE_ID|"
                      r"HERDR_\w+|TMUX_PANE)$")


def open_ended():
    """Lines a shape cannot judge, each with its label and expected kind. Made up, in pieces."""
    name1 = "Mar" + "git " + "Oyelaran-" + "Szabo"
    name2 = "Il" + "se " + "Varga-" + "Thornbury"
    first = "Mar" + "git"
    phone_uk = "0161 496 " + "0738"
    phone_us = "(555) 010-" + "4477"
    phone_mobile = "+44 77" + "00 900" + "461"
    street1 = "7 Wren " + "Close, Fallowmere"
    street2 = "48 Larkspur " + "Row, Thistlecombe"
    password = "Tulip-" + "Harbour-" + "1967"
    arpa = "nas-" + first.lower() + ".home" + ".arpa"
    device = first.lower() + "s-mac" + "book-pro"
    private_ip = ".".join(("10", "20", "30", "40"))
    home = "/" + "Us" + "ers/" + first.lower() + ".oyelaran/Projects/app"
    mailbox = first.lower() + ".o" + "@" + "quietharbour-413" + ".net"
    doc_ip = ".".join(("192", "0", "2", "10"))
    vendor = "Clau" + "de"
    return [
        ("open-person-phone", "pos", "person", f"Call {name1} on {phone_uk} about the lease renewal."),
        ("open-person-health", "pos", "person", "My sis" f"ter {name2} is in hospital, so I am offline on Thursday."),
        ("open-address", "pos", "postal-address", f"Ship the spare keys to {street1}."),
        ("open-phone-us", "pos", "phone", f"Her number is {phone_us}; text before calling."),
        ("open-address-person", "pos", "postal-address", f"{first}'s home address is {street2}."),
        ("open-password-prose", "pos", "secret", f"Staging login is {first.lower()}.o with password {password}."),
        ("open-host-arpa", "pos", "private-host", f"The backup target resolves to {arpa} on the home network."),
        ("open-phone-mobile", "pos", "phone", f"Reach me on Signal at {phone_mobile}."),
        ("open-attribution-prose", "pos", "attribution", "Most of this patch was written by an AI assistant."),
        ("open-attribution-trailer", "pos", "attribution", "Assisted-by: GitHub " + "Copilot"),
        ("open-attribution-drafted", "pos", "attribution", "Drafted with help from Chat" + "GPT, then edited by hand."),
        ("open-attribution-pr", "pos", "attribution", "This pull request description was produced by " + vendor + "."),
        ("open-branch-name", "pos", "person", json.dumps({"gitBranch": "fix/" + first.lower() + "-oyelaran-tax-return-2026"})),
        ("open-device-name", "pos", "private-host", json.dumps({"hostname": device})),
        ("open-ssh-target", "pos", "private-host", json.dumps({"ssh_target": "deploy@" + private_ip})),
        ("open-cwd", "pos", "home-path", json.dumps({"cwd": home})),
        ("open-email", "pos", "email", f"Send the invoice to {mailbox} by Friday."),
        ("open-customer-id", "pos", "account-id", "Customer 4471-2290-" + "1183 asked for a refund on the duplicate charge."),
        ("open-public-figure", "neg", "", "Linus Torvalds merged the scheduler change in 2007."),
        ("open-placeholders", "neg", "", "Alice sends Bob the session key in the protocol diagram."),
        ("open-role", "neg", "", "Ask the on-call engineer before restarting the cache."),
        ("open-field-name", "neg", "", "The userEmail field is dropped before upload."),
        ("open-public-ip", "neg", "", "Point the resolver at 1.1.1.1 if DNS fails."),
        ("open-public-host", "neg", "", "Docs live at https://docs.github.com/en/rest."),
        ("open-by-hand", "neg", "", "Written by hand; no assistant was used for this change."),
        ("open-vendor-mention", "neg", "", vendor + " Code supports a --model flag."),
        ("open-names-secret", "neg", "", "Store the token in the TYPESAFE_API_KEY environment variable."),
        ("open-doc-ip", "neg", "", f"Use {doc_ip} in examples; it is a documentation address."),
        ("open-phone-field", "neg", "", "The form's phone field accepts up to fifteen digits."),
        ("open-bare-tilde", "neg", "", "Set the path to ~/Code/project in your config."),
        ("open-placeholder-home", "neg", "", "The fixture user is called user and lives at " + "/ho" + "me/user" + "."),
        ("open-tool-credit", "neg", "", "Generated with Makefile 4.3 from the template."),
        ("open-ci", "neg", "", "Our CI runs on GitHub-hosted runners."),
        ("open-assistant-reply", "neg", "", "The assistant's reply ends with a short summary."),
        ("open-system-path", "neg", "", "Read the config from /etc/postmaster/config.toml."),
        ("open-id-shape", "neg", "", "Session ids look like sess_ followed by random letters; never log them."),
    ]


CLEAN = [
    "The cache expires after ten minutes.", "Run the tests before you push.",
    "The parser now accepts trailing commas.", "Rename the helper to match the others.",
    "The release notes list three fixes.", "Logging moves to its own module.",
    "The flag defaults to off.", "Retry twice, then give up.",
    "The table sorts by date, newest first.", "Remove the unused import.",
]

PROBE_LABELS = {
    "trailer": ("pos", "attribution"), "pr-default": ("pos", "attribution"),
    "pr-footer": ("pos", "attribution"), "pr-footer-plain": ("pos", "attribution"),
    "json-depth-1": ("pos", "home-path"), "json-depth-2": ("pos", "home-path"),
    "thinking-signature": ("unreadable", ""), "reasoning-encrypted": ("unreadable", ""),
}


def load(source, mode, lines=None):
    command = ["python3", str(RULE_TRIAL / "load.py"), source, mode]
    stdin = None if lines is None else "".join(json.dumps(line) + "\n" for line in lines)
    result = subprocess.run(command, input=stdin, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit("ai_check: load.py failed: " + result.stderr.strip()[:200])
    return result.stdout


def corpus(source):
    items = []
    table = json.loads(load(source, "table"))
    for fixture in table["fixtures"]:
        for number, text in enumerate(fixture["text"].split("\n"), 1):
            if text:
                items.append(dict(group="fixture", name="%s line %d" % (fixture["name"], number),
                                  label=fixture["polarity"], kind=fixture["rule"], text=text))
    for name, _what, text in rule_probes.probes():
        label, kind = PROBE_LABELS[name]
        items.append(dict(group="probe", name=name, label=label, kind=kind, text=text))
    for name, label, kind, text in open_ended():
        items.append(dict(group="open", name=name, label=label, kind=kind, text=text))
    random.Random(208).shuffle(items)
    return table["source"], items


def prompt(lines):
    return INSTRUCTION + "\n\n" + "\n".join("%d: %s" % (n, t) for n, t in enumerate(lines, 1))


def clean_env(extra=None):
    env = {k: v for k, v in os.environ.items() if not IDENTITY.match(k)}
    env.update(extra or {})
    return env


def env_file(path):
    values = {}
    for raw in pathlib.Path(path).expanduser().read_text().splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$", raw)
        if m:
            values[m.group(1)] = m.group(2).strip().strip("'\"")
    return values


def ask(level, text, workdir, lines=None, opf=None):
    harness, model, effort = LEVELS[level]
    workdir = pathlib.Path(workdir)
    started = time.monotonic()
    if harness == "jev":
        found, cost = [], 0.0

        def one(item):
            number, line = item
            body = json.dumps({"model": model, "state": {"line": line}, "questions": {
                kind: {"type": "noul", "instructions": text} for kind, text in JEV_QUESTIONS.items()}})
            for attempt in range(4):
                request = urllib.request.Request(JEV_URL, data=body.encode(), headers={
                    "Authorization": "Bearer " + opf, "Content-Type": "application/json"})
                try:
                    with urllib.request.urlopen(request, timeout=120) as response:
                        return number, json.loads(response.read())
                except urllib.error.HTTPError as error:
                    if error.code != 429 or attempt == 3:
                        return number, {"error": error.code}
                    time.sleep(2 ** attempt)
            return number, {"error": "retries"}

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(one, enumerate(lines, 1)))
        failed = [n for n, reply in replies if "answers" not in reply]
        nouls = {}
        for number, reply in replies:
            cost += float((reply.get("usage") or {}).get("cost") or 0)
            answers = reply.get("answers") or {}
            if answers:
                # Kept as a list in KINDS order, so no kind's name stands before its number.
                nouls[str(number)] = [round(float((answers.get(k) or {}).get("noul", 0)), 3) for k in KINDS]
                found += [(number, k) for k, v in zip(KINDS, nouls[str(number)]) if v >= 0.5]
        seconds = round(time.monotonic() - started, 1)
        ask.nouls = nouls
        return ("failed %d" % len(failed) if failed else 0), seconds, sorted(set(found)), round(cost, 6)
    if harness == "local":
        folder = pathlib.Path(opf)
        (folder / "opf.ts").write_text((HERE / "opf.ts").read_text())
        result = subprocess.run(["bun", str(folder / "opf.ts"), str(folder / "models")],
                                input=json.dumps({"lines": lines}), env=clean_env(),
                                capture_output=True, text=True, timeout=900, check=False)
        answer = result.stdout
    elif harness == "claude":
        command = ["claude", "-p", text, "--model", model, "--output-format", "json",
                   "--tools", "", "--no-session-persistence", "--json-schema", json.dumps(SCHEMA)]
        if effort:
            command += ["--effort", effort]
        result = subprocess.run(command, cwd=workdir, env=clean_env(), capture_output=True,
                                text=True, timeout=900, check=False)
        answer = result.stdout
        try:
            outer = json.loads(answer)
            answer = json.dumps(outer["structured_output"]) if outer.get("structured_output") else outer.get("result", "")
        except (ValueError, KeyError, TypeError):
            pass
    elif harness == "codex":
        schema = workdir / "schema.json"
        schema.write_text(json.dumps(SCHEMA))
        last = workdir / "last.txt"
        command = ["codex", "exec", "-C", str(workdir), "--skip-git-repo-check", "--ephemeral",
                   "-s", "read-only", "-m", model, "-c", 'model_reasoning_effort="%s"' % effort,
                   "--output-schema", str(schema), "-o", str(last), text]
        result = subprocess.run(command, env=clean_env(), capture_output=True, text=True,
                                timeout=900, check=False)
        answer = last.read_text() if last.exists() else ""
    else:
        config = {"permission": {k: "deny" for k in ("bash", "edit", "webfetch", "external_directory")}}
        extra = dict(env_file("~/.postmaster/lanes/mimo.env"), XDG_DATA_HOME=str(workdir / "xdg"),
                     MIMOCODE_DISABLE_CLAUDE_IMPORT="1", MIMOCODE_CONFIG_CONTENT=json.dumps(config))
        prompt_file = workdir / "prompt.txt"
        prompt_file.write_text(text)
        command = ["mimo", "run", "--format", "json", "-m", model, "--variant", effort,
                   "--dangerously-skip-permissions"]
        with open(prompt_file) as stdin:
            result = subprocess.run(command, cwd=workdir, env=clean_env(extra), stdin=stdin,
                                    capture_output=True, text=True, timeout=900, check=False)
        parts = []
        for raw in result.stdout.splitlines():
            try:
                event = json.loads(raw)
            except ValueError:
                continue
            if event.get("type") == "text":
                parts.append((event.get("part") or {}).get("text", ""))
        answer = "".join(parts)
    seconds = round(time.monotonic() - started, 1)
    return result.returncode, seconds, parse(answer), None


def api_key(path):
    """OPENROUTER_API_KEY from the environment, or from a KEY=value file; never printed."""
    if path:
        return env_file(path).get("OPENROUTER_API_KEY") or sys.exit("ai_check: no OPENROUTER_API_KEY in the key file")
    return os.environ.get("OPENROUTER_API_KEY") or sys.exit("ai_check: OPENROUTER_API_KEY is not set")


def parse(answer):
    """The findings in an answer, as (line, kind) pairs; None when no JSON object is found."""
    match = re.search(r"\{.*\}", answer or "", re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group())
    except ValueError:
        return None
    found = []
    for item in data.get("findings", []) if isinstance(data, dict) else []:
        if isinstance(item, dict) and isinstance(item.get("line"), int) and item.get("kind") in KINDS:
            found.append((item["line"], item["kind"]))
    return sorted(set(found))


def score(items, flagged_lines):
    """Lines found, by group and label."""
    rows = {}
    for number, item in enumerate(items, 1):
        if item["label"] == "unreadable":
            continue
        key = (item["group"], item["label"])
        hit, total = rows.get(key, (0, 0))
        rows[key] = (hit + (number in flagged_lines), total + 1)
    return rows


def main(args):
    opts = {"--levels": ",".join(LEVELS), "--repeats": "3", "--tmp": None, "--out": None, "--opf": None,
            "--key-file": None}
    rest, score_only = [], False
    while args:
        head = args.pop(0)
        if head == "--score-only":
            score_only = True
        elif head in opts:
            opts[head] = args.pop(0)
        else:
            rest.append(head)
    if len(rest) != 1 or not opts["--out"]:
        raise SystemExit("usage: ai_check.py <source> --out <dir> [--tmp <dir>] [--levels a,b] [--repeats N]")
    out = pathlib.Path(opts["--out"])
    out.mkdir(parents=True, exist_ok=True)
    source, items = corpus(rest[0])
    lines = [item["text"] for item in items]
    with open(out / "corpus.txt", "w") as handle:
        handle.write("table: %s %s\n" % (source.get("ref"), source.get("commit")))
        for number, item in enumerate(items, 1):
            handle.write("%d\t%s\t%s\t%s\t%s\n" % (number, item["group"], item["label"], item["kind"] or "-", item["name"]))
    mechanical = [json.loads(row) for row in load(rest[0], "scan", lines).splitlines()]
    mech_lines = {n for n, spans in enumerate(mechanical, 1) if spans}
    with open(out / "mechanical.txt", "w") as handle:
        for number, spans in enumerate(mechanical, 1):
            handle.write("%d\t%s\n" % (number, ",".join(sorted({s[2] for s in spans})) or "-"))
    results = {}
    if score_only:
        present = sorted({p.name.rsplit("-", 1)[0] for p in out.glob("*-*.json")},
                         key=lambda name: list(LEVELS).index(name) if name in LEVELS else 99)
        repeats = sorted({p.stem.rsplit("-", 1)[1] for p in out.glob("*-*.json")} - {"control"}, key=int)
        for path in out.glob("*-*.json"):
            record = json.loads(path.read_text())
            if isinstance(record["findings"], list):
                record["findings"] = [tuple(x) for x in record["findings"]]
            results[(record["level"], record["run"])] = record
        opts["--levels"], opts["--repeats"] = ",".join(present), str(len(repeats))
        write_scores(out, items, mech_lines, results, opts)
        return
    for level in opts["--levels"].split(","):
        for run in [str(n) for n in range(1, int(opts["--repeats"]) + 1)] + ["control"]:
            given = CLEAN if run == "control" else lines
            text = prompt(given)
            extra = opts["--opf"] if LEVELS[level][0] != "jev" else api_key(opts["--key-file"])
            with tempfile.TemporaryDirectory(dir=opts["--tmp"], prefix="ai-check-") as workdir:
                try:
                    code, seconds, found, cost = ask(level, text, workdir, given, extra)
                except subprocess.TimeoutExpired:
                    code, seconds, found, cost = "timeout", 900, None, None
            record = {"level": level, "run": run, "exit": code, "seconds": seconds,
                      "findings": found if found is not None else "unparsed"}
            if cost is not None:
                record["cost_usd"] = cost
            if LEVELS[level][0] == "jev" and getattr(ask, "nouls", None) is not None:
                record["noul_order"], record["nouls"] = KINDS, ask.nouls
                ask.nouls = None
            (out / ("%s-%s.json" % (level, run))).write_text(json.dumps(record) + "\n")
            results[(level, run)] = record
            print("%s %s exit=%s %ss %s" % (level, run, code, seconds,
                  "unparsed" if found is None else "%d findings" % len(found)), flush=True)
    write_scores(out, items, mech_lines, results, opts)


def write_scores(out, items, mech_lines, results, opts):
    groups = [("fixture", "pos"), ("fixture", "neg"), ("probe", "pos"), ("open", "pos"), ("open", "neg")]
    header = "level         " + "  ".join("%-13s" % ("%s %s" % g) for g in groups) + "  seconds"
    lines = ["Lines found, as found/total, by corpus group and label.", "", header]

    def row(name, flagged, seconds="-"):
        counts = score(items, flagged)
        cells = []
        for g in groups:
            hit, total = counts.get(g, (0, 0))
            cells.append("%-13s" % ("%d/%d" % (hit, total)))
        return "%-13s " % name + "  ".join(cells) + "  " + str(seconds)

    lines.append(row("mechanical", mech_lines))
    levels = opts["--levels"].split(",")
    repeats = [str(n) for n in range(1, int(opts["--repeats"]) + 1)]
    for level in levels:
        runs = [results[(level, r)] for r in repeats if isinstance(results[(level, r)]["findings"], list)]
        for r in repeats:
            record = results[(level, r)]
            flagged = {n for n, _k in record["findings"]} if isinstance(record["findings"], list) else set()
            lines.append(row("%s %s" % (level, r), flagged, record["seconds"]))
        if runs:
            votes = {}
            for record in runs:
                for n in {n for n, _k in record["findings"]}:
                    votes[n] = votes.get(n, 0) + 1
            majority = {n for n, v in votes.items() if v * 2 > len(runs)}
            lines.append(row("%s majority" % level, majority, statistics.median(r["seconds"] for r in runs)))
            lines.append(row("%s + mech" % level, majority | mech_lines))
    lines += ["", "Consistency: the share of scored lines on which every repeat of a level agrees."]
    scored = [n for n, item in enumerate(items, 1) if item["label"] != "unreadable"]
    for level in levels:
        runs = [results[(level, r)] for r in repeats if isinstance(results[(level, r)]["findings"], list)]
        if len(runs) < 2:
            lines.append("%-13s fewer than two parsed repeats" % level)
            continue
        sets = [{n for n, _k in r["findings"]} for r in runs]
        agree = sum(1 for n in scored if len({n in s for s in sets}) == 1)
        lines.append("%-13s %d/%d" % (level, agree, len(scored)))
    lines += ["", "Kinds on open-ended positives: lines where a majority named the expected kind."]
    for level in levels:
        runs = [results[(level, r)] for r in repeats if isinstance(results[(level, r)]["findings"], list)]
        hits = total = 0
        for n, item in enumerate(items, 1):
            if item["group"] != "open" or item["label"] != "pos":
                continue
            total += 1
            named = sum(1 for r in runs if (n, item["kind"]) in set(map(tuple, r["findings"])))
            hits += named * 2 > len(runs) if runs else 0
        lines.append("%-13s %d/%d" % (level, hits, total))
    lines += ["", "Unreadable probes (encrypted blocks): lines each level reported."]
    unreadable = [n for n, item in enumerate(items, 1) if item["label"] == "unreadable"]
    lines.append("%-13s %d/%d" % ("mechanical", len(set(unreadable) & mech_lines), len(unreadable)))
    for level in levels:
        for r in repeats:
            record = results[(level, r)]
            flagged = {n for n, _k in record["findings"]} if isinstance(record["findings"], list) else set()
            lines.append("%-13s %d/%d" % ("%s %s" % (level, r), len(set(unreadable) & flagged), len(unreadable)))
    jev_runs = [results[(lv, r)] for lv in levels for r in repeats
                if LEVELS.get(lv, ("",))[0] == "jev" and "nouls" in results[(lv, r)]]
    if jev_runs:
        lines += ["", "Jev at other thresholds: lines found, from the probabilities its calls returned, majority of calls."]
        for threshold in (0.5, 0.7, 0.8, 0.9, 0.95):
            votes = {}
            for record in jev_runs:
                for number, values in record["nouls"].items():
                    if max(values) >= threshold:
                        votes[int(number)] = votes.get(int(number), 0) + 1
            majority = {n for n, v in votes.items() if v * 2 > len(jev_runs)}
            lines.append(row("jev >= %.2f" % threshold, majority))
            lines.append(row("  + mech", majority | mech_lines))
    lines += ["", "Control: ten plain lines with no private data; lines reported (0 expected)."]
    for level in levels:
        record = results[(level, "control")]
        found = record["findings"]
        lines.append("%-13s %s" % (level, len({n for n, _k in found}) if isinstance(found, list) else "unparsed"))
    (out / "scores.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1:])
