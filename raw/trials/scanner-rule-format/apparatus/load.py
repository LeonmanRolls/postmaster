#!/usr/bin/env python3
"""Load #135's rule table, and its own fixtures, from the scanner's source.

  load.py <source> table       the rules, the compiled patterns, the string sets and the
                               fixtures with #135's findings, as one JSON object
  load.py <source> findings    one JSON string per stdin line in, #135's findings for it
                               out, one JSON list of [start, end, rule] per line
  load.py <source> scan        the same, through the scanner's whole line pipeline (its
                               LineScanner: ANSI stripping, JSON-string decoding, markers)

<source> is git:<ref>:<path>, read with `git show`, or file:<path>. The scanner is a bash
script carrying its Python in a heredoc; this takes the heredoc, drops the module's last
statement (the entry point that runs main), and executes the rest, so `findings`, `RULES`
and every pattern are the branch's own objects, never copies. The fixtures are the `pos` and
`neg` calls in its self-test, evaluated with the self-test's own fragment assignments, so no
value is ever written down here. A finding carries offsets in code points and its rule,
never its value.
"""
import ast
import json
import os
import re
import subprocess
import sys


def fail(message):
    print("load: " + message, file=sys.stderr)
    raise SystemExit(2)


def read_source(spec):
    kind, _, rest = spec.partition(":")
    if kind == "git":
        ref, _, path = rest.rpartition(":")
        if not ref or not path:
            fail("git source is git:<ref>:<path>")
        commit = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", "--end-of-options", ref + "^{commit}"],
            capture_output=True, text=True, check=False).stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            fail("no commit for that ref")
        shown = subprocess.run(["git", "show", commit + ":" + path],
                               capture_output=True, check=False)
        if shown.returncode != 0:
            fail("the file is not in that commit")
        return {"kind": "git", "ref": ref, "commit": commit, "path": path}, shown.stdout.decode()
    if kind == "file":
        try:
            with open(rest, encoding="utf-8") as handle:
                return {"kind": "file", "path": rest}, handle.read()
        except OSError:
            fail("could not read the file")
    fail("source is git:<ref>:<path> or file:<path>")


def heredoc(text):
    opener = "<<'PY'\n"
    start = text.find(opener)
    end = text.find("\nPY\n", start)
    if start < 0 or end < 0:
        fail("no Python heredoc in the source")
    return text[start + len(opener):end + 1]


def load(text):
    tree = ast.parse(heredoc(text))
    body = list(tree.body)
    if body and isinstance(body[-1], ast.Try):
        body = body[:-1]
    namespace = {"__name__": "scrub_check_rules"}
    os.environ["SCRUB_CHECK_DISABLE"] = ""
    exec(compile(ast.Module(body=body, type_ignores=[]), "<rule table>", "exec"), namespace)
    for name in ("findings", "RULES"):
        if name not in namespace:
            fail("the source defines no " + name)
    return tree, namespace


def fixtures(tree, namespace):
    """Every pos(...) and neg(...) call in the self-test, evaluated."""
    test = next((node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name == "self_test"), None)
    if test is None:
        return []
    scope = dict(namespace)
    for node in test.body:
        if isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) for t in node.targets):
            try:
                exec(compile(ast.Module(body=[node], type_ignores=[]), "<fragments>", "exec"), scope)
            except Exception:
                pass
    found = []
    for node in ast.walk(test):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id in ("pos", "neg") and len(node.args) >= 3):
            try:
                rule, text, name = (eval(compile(ast.Expression(arg), "<fixture>", "eval"), scope)
                                    for arg in node.args[:3])
            except Exception:
                fail("a fixture call could not be evaluated, line %d" % node.lineno)
            found.append({"polarity": node.func.id, "rule": rule, "name": name, "text": text,
                          "line": node.lineno})
    return found


def spans(find, line):
    return sorted({(start, end, kind) for start, end, kind, _value in find(line)})


def describe(namespace):
    patterns, sets = {}, {}
    for name, value in namespace.items():
        if isinstance(value, re.Pattern):
            patterns[name] = {"source": value.pattern, "flags": value.flags}
        elif (isinstance(value, tuple) and value
              and all(isinstance(item, re.Pattern) for item in value)):
            for index, item in enumerate(value):
                patterns["%s[%d]" % (name, index)] = {"source": item.pattern, "flags": item.flags}
        elif (isinstance(value, (frozenset, tuple, set, list)) and value
              and all(isinstance(item, str) for item in value) and name.isupper()):
            sets[name] = sorted(value)
    return patterns, sets


def main(args):
    if len(args) != 2 or args[1] not in ("table", "findings", "scan"):
        fail("usage: load.py <source> table|findings|scan")
    source, text = read_source(args[0])
    tree, namespace = load(text)
    find = namespace["findings"]
    if args[1] == "findings":
        for raw in sys.stdin:
            line = json.loads(raw)
            print(json.dumps([list(item) for item in spans(find, line)]))
        return 0
    if args[1] == "scan":
        if "LineScanner" not in namespace:
            fail("the source defines no LineScanner")
        for raw in sys.stdin:
            scanner = namespace["LineScanner"]()
            scanner.feed(1, json.loads(raw))
            scanner.flush()
            kept = sorted({(start, end, kind) for _n, start, end, kind, _v in scanner.kept})
            print(json.dumps([list(item) for item in kept]))
        return 0
    patterns, sets = describe(namespace)
    items = fixtures(tree, namespace)
    for item in items:
        item["findings"] = [[number, *span]
                            for number, line in enumerate(item["text"].split("\n"), 1)
                            if line or number == 1
                            for span in spans(find, line)]
    print(json.dumps({
        "source": source,
        "rules": sorted(namespace["RULES"]),
        "usage": namespace.get("USAGE", ""),
        "patterns": patterns,
        "sets": sets,
        "fixtures": items,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
