#!/usr/bin/env python3
"""How much of each synthesis came from each lane, measured in runs of six words.

Read-only: it runs `git diff` and `git show` in the repositories it is given, and writes
nothing. RUNS below names every run it measures and the commits each one pins.

    measure.py [--postmaster REPO] [--fixture NAME=REPO ...]             the shares, as markdown
    measure.py [--postmaster REPO] [--fixture NAME=REPO ...] --controls  each lane's own diff
                                                                        measured as a synthesis
    measure.py --self-test                                              the pure core on literal input

REPO defaults to the repository holding this file; a worktree of it will do, since a worktree
shares the repository's commits. NAME is a fixture run's name, such as todo-fixture-4, and REPO
the fixture repository that run was dispatched against. A run whose repository is not given
is listed as not measured.

  exit 0  every run with a repository measured, and with --controls every control behaved
  exit 1  a pinned commit is missing, a git command failed, or a control misbehaved
  exit 2  usage
"""
import collections
import os
import re
import subprocess
import sys

K = 6  # words in one run

# run, repository, base, oracle (the files it added are excluded; None where the run had none),
# synthesis from, synthesis to (the commit its checkpoint 1 card names), luna's harvested head,
# mimo's harvested head, the lane its SYNTHESIS line ranks first
RUNS = [
    ("#18", "postmaster", "bb782a973e69", None, "5d78105f8141", "468035b6cf24", "e7c3ac21ab0f", "b7902bec8a1e", "luna"),
    ("#38", "postmaster", "7e6a7151661e", "5e249e71a813", "5e249e71a813", "e355a28830d5", "332fccb20524", "3c80384617b9", "mimo"),
    ("#80", "postmaster", "7e6a7151661e", "6786a8ac678d", "6786a8ac678d", "d2fb4fa20aa4", "c999be7af6a4", "0ec3e51f967a", "mimo"),
    ("#81", "postmaster", "b627af7c2f09", "25c116d65cb1", "25c116d65cb1", "fc6aad13c23d", "09c1d3578903", "092cfbb179a7", "mimo"),
    ("#105", "postmaster", "bb782a973e69", None, "bb782a973e69", "63e905d03885", "66c649546013", "e083104f9f26", "luna"),
    ("#106", "postmaster", "baa28c14245d", "2bce4e92c98a", "2bce4e92c98a", "5d45d19974c0", "db176089712b", "9580c2d44f64", "mimo"),
    ("#108", "postmaster", "0b02eefc3066", "af4173751d39", "af4173751d39", "48659e8011e3", "5a02b48451b2", "f27ce4427ca6", "mimo"),
    ("#109", "postmaster", "bb782a973e69", "196f2543bb1a", "aacd989b54ef", "d18a41a7ad0f", "3a38edca0696", "6ff83f0b3b1e", "luna"),
    ("#112", "postmaster", "bb782a973e69", "e43c4b10d40e", "e43c4b10d40e", "419ac4d69bd3", "97a0a6047c21", "2b3a6270837b", "luna"),
    ("#113", "postmaster", "bb782a973e69", "6181513d926f", "24aa68ddd1b5", "016192592d3c", "a9de00c1de0d", "ec377b37d72a", "mimo"),
    ("#114", "postmaster", "bb782a973e69", "44dbf0b8d346", "44dbf0b8d346", "82a5579ebe46", "6798e86bef4e", "1924f1b4c39a", "luna"),
    ("#116", "postmaster", "7e6a7151661e", "1263e0d5d72d", "b04dddf464a0", "1a734918b57b", "7d4464b45e9b", "9c48b249e18d", "luna"),
    ("#121", "postmaster", "7e6a7151661e", "0427f86d3c31", "0427f86d3c31", "d9fb141e8639", "40be9a77cf3d", "594bf5f36ed7", "mimo"),
    ("#122", "postmaster", "baa28c14245d", "bd10163e0c39", "bd10163e0c39", "6303e29e5ce7", "908fa83dc28b", "245f8cae7ec7", "luna"),
    ("#124", "postmaster", "6e9f87cc776c", "389782d98f74", "389782d98f74", "59df2d4225dc", "af793c51de27", "3c25f598cc9b", "luna"),
    ("#135", "postmaster", "6e9f87cc776c", "160d6d8cadbf", "de8e5e3c8dd7", "a6e1cedc3992", "cd26fbd17b3e", "6908d428118b", "luna"),
    ("todo-fixture-1", "todo-fixture-1", "59816c80b365", "cad8ac12b3ba", "cad8ac12b3ba", "31dd74837dd3", "848f40da2e64", "8b2dbc9d7b3b", "luna"),
    ("todo-fixture-2", "todo-fixture-2", "135a07d488de", "1ecf89a87402", "1ecf89a87402", "40d4f0673707", "6d65f7dcf3a6", "714224bcf089", "mimo"),
    ("todo-fixture-3", "todo-fixture-3", "d74805904553", "c2d2801dfda5", "c2d2801dfda5", "bf992ac7486f", "e1e9508862ba", "edb0f4d05f72", "mimo"),
    ("todo-fixture-4", "todo-fixture-4", "12292fc8acc9", "3c5a7b1d5cd0", "3c5a7b1d5cd0", "780bf02f9272", "c0768c83adf6", "4af3643b8db2", "mimo"),
    ("todo-fixture-5", "todo-fixture-5", "b5a29e1c8263", "e3eedab9910c", "e3eedab9910c", "2a7fae840a68", "31c21d233e9c", "534131ad7090", "mimo"),
    ("todo-fixture-6", "todo-fixture-6", "e184837f2007", "3a93e2728645", "3a93e2728645", "2f53cc8fd3cf", "0c2d3f8fef77", "a5ec28a98d1f", "mimo"),
    ("todo-fixture-7", "todo-fixture-7", "61ce8bbf0061", "f384796d79a7", "f384796d79a7", "70796481c753", "f23e4f97b95b", "63be2c96f144", "luna"),
    ("todo-fixture-8", "todo-fixture-8", "f4db996a4279", "60263d0058b0", "60263d0058b0", "eb5d2adfc44f", "7e5efde8c706", "e46beb8f0026", "mimo"),
    ("todo-fixture-9", "todo-fixture-9", "dc2bb90c9bb1", "4bd2ebcc7a1c", "4bd2ebcc7a1c", "cbd2db8124a4", "49bf457cb5dd", "dc98a7386601", "luna"),
]

# A lane's own records and the run's blind tests are not product, wherever they sit.
EXCLUDED = re.compile(r"(WORKHORSE-(SPEC|SUMMARY)\.md|BASE-CONTROLS|oracle|acceptance)", re.I)
CATEGORIES = ("first", "second", "both", "neither")


# --- the pure core: text in, counts out -----------------------------------------------------

def added_lines(diff, skip):
    """Map each file a diff adds lines to onto those lines, leaving out excluded files."""
    per, cur = collections.defaultdict(list), None
    for line in diff.split("\n"):
        if line.startswith("+++ "):
            path = line[4:]
            cur = path[2:] if path.startswith("b/") else None  # /dev/null: a deleted file
            continue
        if line.startswith("+") and cur and not (cur in skip or EXCLUDED.search(cur)):
            per[cur].append(line[1:])
    return per


def runs_of_words(text, k=K):
    """Every run of k consecutive words, a word being anything between whitespace."""
    words = re.findall(r"\S+", text)
    return [" ".join(words[i:i + k]) for i in range(max(0, len(words) - k + 1))]


def kind(path):
    """docs, tests or code."""
    parts = path.split("/")
    if path.endswith((".md", ".txt")) or parts[0] in ("wiki", "raw"):
        return "docs"
    if "test" in parts[:-1] or "tests" in parts[:-1] or re.search(r"\.(test|spec)\.", parts[-1]):
        return "tests"
    return "code"


def word_runs(per):
    """The runs of words in each file's added lines, file by file."""
    return {path: runs_of_words("\n".join(lines)) for path, lines in per.items()}


def attribute(synthesis, first, second):
    """Count the synthesis's runs of words by kind and by which lane's diff holds them."""
    counts = collections.defaultdict(collections.Counter)
    for path, runs in synthesis.items():
        for r in runs:
            in_first, in_second = r in first, r in second
            if in_first and in_second:
                cat = "both"
            elif in_first:
                cat = "first"
            elif in_second:
                cat = "second"
            else:
                cat = "neither"
            counts[kind(path)][cat] += 1
            counts["all"][cat] += 1
    return counts


def pct(part, whole):
    return "%.0f%%" % (100 * part / whole) if whole else "n/a"


# --- the edges: git, arguments, output ------------------------------------------------------

class GitError(Exception):
    pass


def git(repo, *args):
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise GitError("git %s exited %d" % (args[0], p.returncode))
    return p.stdout


def diff(repo, a, b):
    return git(repo, "diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/",
               "--unified=0", "--no-renames", a, b)


def files_added_by(repo, commit):
    if not commit:
        return set()
    return {f for f in git(repo, "show", "--name-only", "--format=", commit).split("\n") if f}


def lane_set(repo, base, head, skip):
    s = set()
    for runs in word_runs(added_lines(diff(repo, base, head), skip)).values():
        s.update(runs)
    return s


def measure(repo, run, syn_from=None, syn_to=None):
    """Counts for one run; syn_from and syn_to replace the synthesis range for a control."""
    _, _, base, oracle, s_from, s_to, luna, mimo, first = run
    skip = files_added_by(repo, oracle)
    heads = {"luna": luna, "mimo": mimo}
    second = "mimo" if first == "luna" else "luna"
    synthesis = word_runs(added_lines(diff(repo, syn_from or s_from, syn_to or s_to), skip))
    return attribute(synthesis, lane_set(repo, base, heads[first], skip),
                     lane_set(repo, base, heads[second], skip))


def missing(repo, run):
    pinned = list(dict.fromkeys(c for c in run[2:8] if c))
    return [c for c in pinned if subprocess.run(
        ["git", "-C", repo, "cat-file", "-e", c + "^{commit}"], capture_output=True).returncode]


def table_shares(results):
    out = ["| run | ranked first | second | runs of six words | first only | second only | both | neither |",
           "|---|---|---|---:|---:|---:|---:|---:|"]
    for run, counts in results:
        a, first = counts["all"], run[8]
        n = sum(a.values())
        out.append("| %s | %s | %s | %d | %s | %s | %s | %s |" % (
            run[0], first, "mimo" if first == "luna" else "luna", n,
            *(pct(a[c], n) for c in CATEGORIES)))
    return out


def table_kinds(results):
    out = ["| run | kind | runs of six words | first only | second only | both | neither |",
           "|---|---|---:|---:|---:|---:|---:|"]
    for run, counts in results:
        for k in ("code", "tests", "docs"):
            c = counts.get(k)
            if not c:
                continue
            n = sum(c.values())
            out.append("| %s | %s | %d | %s |" % (run[0], k, n, " | ".join(pct(c[x], n) for x in CATEGORIES)))
    return out


def usage(msg=None):
    if msg:
        print("measure.py: %s" % msg, file=sys.stderr)
    print("usage: measure.py [--postmaster REPO] [--fixture NAME=REPO ...] [--controls] | --self-test",
          file=sys.stderr)
    sys.exit(2)


def self_test():
    ok = True

    def check(name, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print("%s  %s%s" % ("ok  " if good else "FAIL", name, "" if good else ": got %r, want %r" % (got, want)))

    check("five words make no run", runs_of_words("a b c d e"), [])
    check("six words make one run", runs_of_words("a b\nc d\te f"), ["a b c d e f"])
    check("seven words make two runs", len(runs_of_words("a b c d e f g")), 2)
    literal = "\n".join([
        "diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -0,0 +1,2 @@",
        "+one two three", "+four five six", "diff --git a/WORKHORSE-SPEC.md b/WORKHORSE-SPEC.md",
        "+++ b/WORKHORSE-SPEC.md", "+a lane's own record", "+++ b/test/remove-acceptance.test.ts",
        "+the blind tests", "+++ b/test/blind.test.ts", "+added by the oracle commit",
        "--- a/gone.md", "+++ /dev/null", "-removed", ""])
    check("added lines, excluded files left out",
          dict(added_lines(literal, {"test/blind.test.ts"})), {"src/x.ts": ["one two three", "four five six"]})
    check("kinds", [kind(p) for p in ("README.md", "wiki/a.md", "raw/t/out.json", "notes.txt",
                                      "test/cli.test.ts", "src/a.spec.ts", "scripts/a.sh", "src/tasks.ts")],
          ["docs", "docs", "docs", "docs", "tests", "tests", "code", "code"])
    first = set(runs_of_words("alpha beta gamma delta epsilon zeta"))
    second = set(runs_of_words("one two three four five six"))
    shared = set(runs_of_words("same words in both lanes here"))
    syn = {"src/a.ts": runs_of_words("alpha beta gamma delta epsilon zeta"),
           "src/b.ts": runs_of_words("one two three four five six"),
           "README.md": runs_of_words("same words in both lanes here"),
           "src/c.ts": runs_of_words("words nobody wrote before this run")}
    got = attribute(syn, first | shared, second | shared)
    check("attribution by lane", dict(got["all"]), {"first": 1, "second": 1, "both": 1, "neither": 1})
    check("attribution by kind", dict(got["docs"]), {"both": 1})
    lane_only = attribute({"src/a.ts": runs_of_words("alpha beta gamma delta epsilon zeta")}, first, second)
    check("a lane measured against itself: nothing second only, nothing in neither, some first only",
          (lane_only["all"]["second"], lane_only["all"]["neither"], lane_only["all"]["first"] > 0), (0, 0, True))
    check("percent of nothing", pct(0, 0), "n/a")
    return 0 if ok else 1


def main(argv):
    if argv == ["--self-test"]:
        return self_test()
    here = os.path.dirname(os.path.abspath(__file__))
    repos, controls, args = {}, False, list(argv)
    while args:
        a = args.pop(0)
        if a == "--controls":
            controls = True
        elif a in ("--postmaster", "--fixture") and args:
            v = args.pop(0)
            if a == "--postmaster":
                repos["postmaster"] = v
            else:
                name, _, path = v.partition("=")
                if not name.startswith("todo-fixture-") or not path:
                    usage("--fixture takes NAME=REPO, with NAME todo-fixture-<n>")
                repos[name] = path
        else:
            usage("unknown argument %s" % a)
    if "postmaster" not in repos:
        try:
            repos["postmaster"] = git(here, "rev-parse", "--show-toplevel").strip()
        except GitError:
            usage("no --postmaster REPO, and this file is not in a git repository")

    status, results, notes = 0, [], []
    for run in RUNS:
        repo = repos.get(run[1])
        if repo is None:
            notes.append("%s: not measured, no repository given for it" % run[0])
            continue
        gone = missing(repo, run)
        if gone:
            notes.append("%s: not measured, its repository lacks pinned commits %s" % (run[0], ", ".join(gone)))
            status = 1
            continue
        try:
            if not controls:
                results.append((run, measure(repo, run)))
                continue
            row = []
            for lane in ("luna", "mimo"):  # each lane's own diff, measured as though it were the synthesis
                head = run[6] if lane == "luna" else run[7]
                c = measure(repo, run, syn_from=run[2], syn_to=head)["all"]
                own, other = ("first", "second") if lane == run[8] else ("second", "first")
                behaved = c[other] == 0 and c["neither"] == 0 and c[own] > 0
                status = status if behaved else 1
                row.append("%d | %d | %d | %s" % (c[own], c[other], c["neither"], "yes" if behaved else "NO"))
            results.append((run, row))
        except GitError as e:
            notes.append("%s: not measured, %s" % (run[0], e))
            status = 1

    if controls:
        print("| run | luna as synthesis: luna only | mimo only | neither | behaved "
              "| mimo as synthesis: mimo only | luna only | neither | behaved |")
        print("|---|---:|---:|---:|---|---:|---:|---:|---|")
        for run, row in results:
            print("| %s | %s | %s |" % (run[0], row[0], row[1]))
    else:
        print("\n".join(table_shares(results)))
        print()
        print("\n".join(table_kinds(results)))
    for n in notes:
        print("\n" + n if n is notes[0] else n)
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
