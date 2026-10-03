#!/usr/bin/env python3
"""Build the data a prototype review page reads, for one merged pull request.

    make-review.py <pull request number> <extras.json> <out-dir>

Run from the repository root, with the pull request's commits fetched. It reads the pull
request through `gh api` (title, text, base and head), diffs the head against its merge base,
as GitHub does, and writes into <out-dir>:

  review.json        what the page shows first: the pull request, the card's contents from
                     <extras.json>, and one entry per changed file with its numbers
  chunks/<k>.json    the files' diffs and their text at the head, a few files per chunk, so a
                     page loads only what is opened
  check.txt          the totals beside the API's, which must match

Only this repository's public history goes in: every value comes from git or the API.
"""
import json
import pathlib
import re
import subprocess
import sys

CHUNK_BYTES = 1_500_000
# A page holds no email address. Test fixtures use reserved example domains, which stay; any
# other address is replaced, in the diff and the text alike, so line numbers do not move.
EMAIL = re.compile(r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,6}\b")
KEEP = re.compile(r"(^|\.)example\.(com|org|net)$|\.(invalid|test|example)$", re.I)
REDACTED = [0]


def scrub(text: str) -> str:
    def sub(m: re.Match) -> str:
        if KEEP.search(m.group(0).split("@", 1)[1]):
            return m.group(0)
        REDACTED[0] += 1
        return "<address removed>"
    return EMAIL.sub(sub, text)
LANG = {".sh": "bash", ".ts": "typescript", ".md": "markdown", ".json": "json", ".toml": "ini",
        ".py": "python", ".yml": "yaml", ".yaml": "yaml", ".js": "javascript", ".css": "css",
        ".html": "xml", ".txt": "plaintext", ".jsonl": "json", ".lock": "plaintext"}


def run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, check=True, text=True).stdout


def gh(path: str) -> dict:
    return json.loads(run("gh", "api", path))


def lang_of(path: str) -> str:
    name = pathlib.PurePosixPath(path).name
    if name in ("package.json", "tsconfig.json", "biome.json"):
        return "json"
    return LANG.get(pathlib.PurePosixPath(path).suffix, "plaintext")


def main() -> None:
    number, extras_path, out = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
    pr = gh(f"repos/brindlewick/postmaster/pulls/{number}")
    base, head = pr["base"]["sha"], pr["head"]["sha"]
    mb = run("git", "merge-base", base, head).strip()
    ticket = re.match(r"#(\d+), (.*)", pr["title"])
    extras = json.loads(extras_path.read_text())
    issue = gh(f"repos/brindlewick/postmaster/issues/{ticket.group(1)}") if ticket else None

    entries = []
    numstat = run("git", "diff", "--numstat", "-M", mb, head).splitlines()
    status = {}
    for line in run("git", "diff", "--name-status", "-M", mb, head).splitlines():
        parts = line.split("\t")
        status[parts[-1]] = (parts[0][0], parts[1] if parts[0][0] == "R" else None)
    for line in numstat:
        add, dele, path = line.split("\t", 2)
        if " => " in path:  # a rename: numstat writes {old => new}
            path = re.sub(r"\{(.*) => (.*)\}", r"\2", path).replace("//", "/")
        kind, old = status.get(path, ("M", None))
        binary = add == "-"
        entries.append({"path": path, "old": old, "status": kind, "add": 0 if binary else int(add),
                        "del": 0 if binary else int(dele), "binary": binary, "lang": lang_of(path)})

    order = extras.get("order")
    if order:  # a reading order: groups of path prefixes, files sorted by their group
        def rank(e: dict) -> tuple:
            for i, g in enumerate(order):
                if any(e["path"].startswith(p) or e["path"] == p for p in g["paths"]):
                    return (i, e["path"])
            return (len(order), e["path"])
        entries.sort(key=rank)
        for e in entries:
            e["group"] = rank(e)[0]

    (out / "chunks").mkdir(parents=True, exist_ok=True)
    chunk, size, k = [], 0, 0
    for i, e in enumerate(entries):
        paths = [e["old"], e["path"]] if e["old"] else [e["path"]]
        diff = "" if e["binary"] else scrub(run("git", "diff", "-U3", "-M", mb, head, "--", *paths))
        text = None
        if e["status"] != "D" and not e["binary"]:
            text = scrub(run("git", "show", f"{head}:{e['path']}"))
        item = {"i": i, "diff": diff, "text": text}
        n = len(json.dumps(item))
        if chunk and size + n > CHUNK_BYTES:
            (out / "chunks" / f"{k}.json").write_text(json.dumps(chunk))
            chunk, size, k = [], 0, k + 1
        chunk.append(item)
        size += n
        e["chunk"] = k
        e["lines"] = None if text is None else text.count("\n") + (0 if text.endswith("\n") or not text else 1)
    if chunk:
        (out / "chunks" / f"{k}.json").write_text(json.dumps(chunk))

    for f in extras.get("card", {}).get("findings", []):
        if "quote" not in f:  # the quote is the cited lines as they stand at the head, never retyped
            lines = run("git", "show", f"{head}:{f['path']}").split("\n")
            f["quote"] = "\n".join(lines[f["line"] - 1:f["endLine"]])

    review = {
        "pr": int(number), "title": pr["title"], "ticket": int(ticket.group(1)) if ticket else None,
        "ticketTitle": ticket.group(2) if ticket else pr["title"], "body": pr["body"] or "",
        "mergedAt": pr["merged_at"], "base": mb, "head": head,
        "additions": pr["additions"], "deletions": pr["deletions"], "changedFiles": pr["changed_files"],
        "ticketBody": issue["body"] if issue else "", "spec": extras.get("spec"),
        "card": extras.get("card", {}), "order": order or [], "files": entries, "redactions": REDACTED[0],
    }
    (out / "review.json").write_text(json.dumps(review, indent=1))
    adds, dels = sum(e["add"] for e in entries), sum(e["del"] for e in entries)
    check = (f"pull request {number}: {len(entries)} files, +{adds}/-{dels} from git; "
             f"the API says {pr['changed_files']} files, +{pr['additions']}/-{pr['deletions']}: "
             + ("match" if (len(entries), adds, dels) == (pr["changed_files"], pr["additions"], pr["deletions"]) else "MISMATCH")
             + f"; {k + 1} chunk(s); {REDACTED[0]} address(es) removed")
    (out / "check.txt").write_text(check + "\n")
    print(check)


if __name__ == "__main__":
    main()
