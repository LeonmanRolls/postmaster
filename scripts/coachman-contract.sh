#!/usr/bin/env bash
# Decide whether a git change touches the coachman contract defined in
# docs/coachman-contract.toml. Contract regions are delimited in their source files.
#
#   coachman-contract.sh <base> <head>
#   coachman-contract.sh --repo <repo> <base> <head>
#   coachman-contract.sh --self-test
#
#   exit 0  no contract change
#   exit 1  contract change; print each part and changed file:line
#   exit 2  usage, git or contract-index error
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)

python3 - "$HERE" "$@" <<'PY'
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib


INDEX = "docs/coachman-contract.toml"
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class ContractError(Exception):
    pass


def run(argv, *, cwd=None, check=True, env=None, text=True):
    p = subprocess.run(argv, cwd=cwd, capture_output=True, text=text, env=env)
    if check and p.returncode:
        detail = p.stderr.strip() or p.stdout.strip() or "exit %d" % p.returncode
        raise ContractError("%s: %s" % (" ".join(map(str, argv)), detail))
    return p


def blob(repo, rev, path):
    p = run(["git", "-C", str(repo), "show", "%s:%s" % (rev, path)], check=False)
    if p.returncode:
        return None
    return p.stdout


def read_index(repo, rev):
    raw = blob(repo, rev, INDEX)
    if raw is None:
        return None, None
    try:
        data = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as e:
        raise ContractError("%s at %s is invalid TOML: %s" % (INDEX, rev, e))
    parts = data.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ContractError("%s at %s must define [[parts]]" % (INDEX, rev))
    seen = set()
    for part in parts:
        ident = part.get("id")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", ident):
            raise ContractError("%s at %s has an invalid part id" % (INDEX, rev))
        if ident in seen:
            raise ContractError("%s at %s repeats part %s" % (INDEX, rev, ident))
        seen.add(ident)
        if not part.get("title") or not part.get("definition"):
            raise ContractError("%s at %s has an incomplete part %s" % (INDEX, rev, ident))
        mappings = part.get("implementation")
        if not isinstance(mappings, list) or not mappings:
            raise ContractError("%s at %s has no implementation locations for %s" % (INDEX, rev, ident))
        for mapping in mappings:
            path = mapping.get("file")
            start, end = mapping.get("start"), mapping.get("end")
            if (not isinstance(path, str) or path.startswith("/") or ".." in pathlib.PurePosixPath(path).parts
                    or not isinstance(start, str) or not start or not isinstance(end, str) or not end):
                raise ContractError("%s at %s has an invalid implementation location for %s" % (INDEX, rev, ident))
    return data, raw


def diff_hunks(repo, base, head, path):
    p = run(["git", "-C", str(repo), "diff", "--no-ext-diff", "--no-renames", "--no-color",
             "--unified=0", base, head, "--", path])
    hunks = []
    for line in p.stdout.splitlines():
        m = HUNK.match(line)
        if not m:
            continue
        old_start, old_count, new_start, new_count = m.groups()
        old_count = int(old_count or 1)
        new_count = int(new_count or 1)
        old_start, new_start = int(old_start), int(new_start)
        old_lines = set(range(old_start, old_start + old_count)) if old_count else set()
        new_lines = set(range(new_start, new_start + new_count)) if new_count else set()
        hunks.append((old_lines, new_lines))
    return hunks


def changed_lines(hunks):
    old, new = set(), set()
    for before, after in hunks:
        old.update(before)
        new.update(after)
    return old, new


def changed_ranges_for_manifest(lines):
    """Map each manifest line to its part, including its implementation entries."""
    owner = {}
    current = None
    pending = False
    for number, line in enumerate(lines, 1):
        if line.strip() == "[[parts]]":
            current, pending = None, True
        elif pending:
            ident = re.match(r'\s*id\s*=\s*"([a-z][a-z0-9-]*)"', line)
            if ident:
                current, pending = ident.group(1), False
        owner[number] = current or "contract-index"
    return owner


def manifest_changes(repo, base, head):
    hunks = diff_hunks(repo, base, head, INDEX)
    if not hunks:
        return {}
    old_raw, new_raw = blob(repo, base, INDEX), blob(repo, head, INDEX)
    old_lines = old_raw.splitlines() if old_raw is not None else []
    new_lines = new_raw.splitlines() if new_raw is not None else []
    old_owner, new_owner = changed_ranges_for_manifest(old_lines), changed_ranges_for_manifest(new_lines)
    old_changed, new_changed = changed_lines(hunks)
    out = {}
    for number in sorted(old_changed):
        part = old_owner.get(number, "contract-index")
        out.setdefault(part, set()).add((INDEX, number))
    for number in sorted(new_changed):
        part = new_owner.get(number, "contract-index")
        out.setdefault(part, set()).add((INDEX, number))
    return out


def region(lines, start, end):
    starts = [i + 1 for i, line in enumerate(lines) if line.strip() == start]
    ends = [i + 1 for i, line in enumerate(lines) if line.strip() == end]
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        return None
    return set(range(starts[0], ends[0] + 1))


# coachman-contract:fixture-detector:start
def validate_head_mappings(repo, head, data):
    if data is None:
        return
    for part in data["parts"]:
        for mapping in part["implementation"]:
            source = blob(repo, head, mapping["file"])
            if source is None:
                raise ContractError("%s at %s maps %s to a missing file" % (INDEX, head, mapping["file"]))
            if region(source.splitlines(), mapping["start"], mapping["end"]) is None:
                raise ContractError("%s at %s has missing or duplicate markers for %s in %s" %
                                    (INDEX, head, part["id"], mapping["file"]))


def check_change(repo, base, head):
    repo = pathlib.Path(repo).resolve()
    for rev in (base, head):
        run(["git", "-C", str(repo), "rev-parse", "--verify", "%s^{commit}" % rev])
    base_index, _ = read_index(repo, base)
    head_index, _ = read_index(repo, head)
    if base_index is None and head_index is None:
        return {}
    validate_head_mappings(repo, head, head_index)
    reports = manifest_changes(repo, base, head)
    parts_by_id = {}
    for data in (base_index, head_index):
        if data:
            for part in data["parts"]:
                parts_by_id.setdefault(part["id"], []).append(part)
    for ident, versions in parts_by_id.items():
        paths = set()
        for part in versions:
            for mapping in part["implementation"]:
                paths.add(mapping["file"])
        for path in paths:
            hunks = diff_hunks(repo, base, head, path)
            if not hunks:
                continue
            old_changed, new_changed = changed_lines(hunks)
            old_source, new_source = blob(repo, base, path), blob(repo, head, path)
            if old_source is None:
                old_source_lines = []
            else:
                old_source_lines = old_source.splitlines()
            if new_source is None:
                new_source_lines = []
            else:
                new_source_lines = new_source.splitlines()
            mappings = [mapping for part in versions for mapping in part["implementation"]
                        if mapping["file"] == path]
            old_regions, new_regions = [], []
            for mapping in mappings:
                if old_source is not None:
                    found = region(old_source_lines, mapping["start"], mapping["end"])
                    if found is not None:
                        old_regions.append(found)
                if new_source is not None:
                    found = region(new_source_lines, mapping["start"], mapping["end"])
                    if found is not None:
                        new_regions.append(found)
            old_contract = set().union(*old_regions) if old_regions else set()
            new_contract = set().union(*new_regions) if new_regions else set()
            refs = {(path, n) for n in new_changed & new_contract}
            if not refs:
                refs = {(path, n) for n in old_changed & old_contract}
            # If a mapped delimiter is itself renamed or removed, preserve the hit through
            # whichever side still has a parseable contract region.
            if not refs and bool(old_contract) != bool(new_contract) and (old_changed or new_changed):
                refs = {(path, n) for n in new_changed} or {(path, n) for n in old_changed}
            if refs:
                reports.setdefault(ident, set()).update(refs)
    return reports


def line_ranges(numbers):
    ordered = sorted(numbers)
    if not ordered:
        return []
    out, first, last = [], ordered[0], ordered[0]
    for number in ordered[1:]:
        if number == last + 1:
            last = number
            continue
        out.append((first, last))
        first = last = number
    out.append((first, last))
    return out


def print_result(reports, base, head):
    if not reports:
        print("no coachman contract change (%s..%s)" % (base, head))
        return 0
    for ident in sorted(reports):
        paths = sorted({path for path, _ in reports[ident]})
        for path in paths:
            for first, last in line_ranges(line for touched_path, line in reports[ident] if touched_path == path):
                suffix = ":%d" % first if first == last else ":%d-%d" % (first, last)
                print("yes %s %s%s" % (ident, path, suffix))
    return 1
# coachman-contract:fixture-detector:end


def control(ok, name, detail=""):
    print("  %s %s%s" % ("ok  " if ok else "FAIL", name, (": " + detail) if detail else ""))
    return ok


def git_fixture(repo, root, source_root, manifest_data):
    repo.mkdir(parents=True)
    shutil.copy2(source_root / "scripts" / "coachman-contract.sh", repo / "coachman-contract.sh")
    for part in manifest_data["parts"]:
        for mapping in part["implementation"]:
            source = source_root / mapping["file"]
            target = repo / mapping["file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy2(source, target)
    index = repo / INDEX
    index.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_root / INDEX, index)
    (repo / "skills/postmaster/harnesses.md").parent.mkdir(parents=True, exist_ok=True)
    (repo / "README.md").write_text("fixture\n", encoding="utf-8")
    run(["git", "init", "-q", "-b", "main", str(repo)])
    run(["git", "-C", str(repo), "config", "user.name", "brindlewick"])
    run(["git", "-C", str(repo), "config", "user.email", "332054101+brindlewick@users.noreply.github.com"])
    os.chmod(repo / "coachman-contract.sh", 0o755)
    run(["git", "-C", str(repo), "add", "."])
    run(["git", "-C", str(repo), "commit", "-q", "-m", "fixture baseline"])
    return run(["git", "-C", str(repo), "rev-parse", "HEAD"]).stdout.strip()


def commit_fixture(repo, message):
    run(["git", "-C", str(repo), "add", "."])
    run(["git", "-C", str(repo), "commit", "-q", "-m", message])
    return run(["git", "-C", str(repo), "rev-parse", "HEAD"]).stdout.strip()


def exercise_self_test(source_root):
    index_path = source_root / INDEX
    try:
        manifest_data = tomllib.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as e:
        raise ContractError("cannot read the current contract index: %s" % e)
    script = pathlib.Path(sys.argv[1]) / "coachman-contract.sh"
    passed = 0
    failed = 0
    print("coachman-contract self-test")

    def run_case(label, edit, expected_part=None, path_hint=None):
        nonlocal passed, failed
        with tempfile.TemporaryDirectory(prefix="coachman-contract-", dir=source_root) as scratch:
            repo = pathlib.Path(scratch) / "repo"
            base = git_fixture(repo, pathlib.Path(scratch), source_root, manifest_data)
            edit(repo)
            head = commit_fixture(repo, label)
            result = subprocess.run([str(repo / "coachman-contract.sh"), base, head], cwd=repo,
                                    capture_output=True, text=True)
            expected_code = 1 if expected_part else 0
            ok = result.returncode == expected_code
            output = result.stdout
            if expected_part:
                ok = ok and any(line.startswith("yes %s " % expected_part) for line in output.splitlines())
                if path_hint:
                    ok = ok and path_hint in output and re.search(re.escape(path_hint) + r":\d+", output) is not None
            else:
                ok = ok and output.startswith("no coachman contract change")
            if control(ok, label, "exit %d" % result.returncode):
                passed += 1
            else:
                failed += 1
                if result.stderr:
                    print("       " + result.stderr.strip().replace("\n", "\n       "))
                if output:
                    print("       " + output.strip().replace("\n", "\n       "))

    def replace_once(repo, path, before, after):
        target = repo / path
        content = target.read_text(encoding="utf-8")
        if before not in content:
            raise ContractError("self-test fixture is missing %r in %s" % (before, path))
        target.write_text(content.replace(before, after, 1), encoding="utf-8")

    run_case("renaming a coachman marker is a markers contract change",
             lambda repo: replace_once(repo, "skills/postmaster/coachman.md", "`.card-ready`", "`.card-finished`"),
             "markers", "skills/postmaster/coachman.md")
    run_case("adding a waybill section is a waybill contract change",
             lambda repo: replace_once(repo, "skills/postmaster/SKILL.md",
                                       "<!-- coachman-contract:waybill-template:end -->",
                                       "## Added field\n\n<!-- coachman-contract:waybill-template:end -->"),
             "waybill", "skills/postmaster/SKILL.md")
    run_case("changing the turnpike table is a turnpikes contract change",
             lambda repo: replace_once(repo, "scripts/turnpikes.sh", "style      default  review", "style      default  ship"),
             "turnpikes", "scripts/turnpikes.sh")
    run_case("adding a stage is a legs-stages contract change",
             lambda repo: replace_once(repo, "scripts/stage.sh", "done abandoned", "done abandoned paused"),
             "legs-stages", "scripts/stage.sh")
    run_case("changing completion detection is a completion contract change",
             lambda repo: replace_once(repo, "scripts/runs-status.sh", 'elif done: nxt = "DISPATCH"',
                                       'elif exited: nxt = "DISPATCH"'),
             "completion", "scripts/runs-status.sh")
    run_case("a docs-only change is not a contract change",
             lambda repo: (repo / "docs/release-notes.md").parent.mkdir(parents=True, exist_ok=True) or
                          (repo / "docs/release-notes.md").write_text("notes\n", encoding="utf-8"))
    run_case("runbook wording outside contract regions is not a contract change",
             lambda repo: (repo / "skills/postmaster/coachman.md").write_text(
                 (repo / "skills/postmaster/coachman.md").read_text(encoding="utf-8") + "\nEditorial note.\n", encoding="utf-8"))
    run_case("adding a harness entry is not a contract change",
             lambda repo: (repo / "skills/postmaster/harnesses.md").write_text("\nNew harness entry.\n", encoding="utf-8"))

    def merge_control(contract):
        nonlocal passed, failed
        label = "main merge with a contract change repeats the fixture" if contract else "main merge without a contract change keeps the fixture"
        with tempfile.TemporaryDirectory(prefix="coachman-contract-", dir=source_root) as scratch:
            repo = pathlib.Path(scratch) / "repo"
            base = git_fixture(repo, pathlib.Path(scratch), source_root, manifest_data)
            run(["git", "-C", str(repo), "switch", "-q", "-c", "feature"])
            run(["git", "-C", str(repo), "switch", "-q", "main"])
            if contract:
                replace_once(repo, "scripts/stage.sh", "done abandoned", "done abandoned paused")
                hint = "scripts/stage.sh"
                part = "legs-stages"
            else:
                (repo / "skills/postmaster/harnesses.md").write_text("new harness\n", encoding="utf-8")
                hint = None
                part = None
            commit_fixture(repo, "change on main")
            run(["git", "-C", str(repo), "switch", "-q", "feature"])
            run(["git", "-C", str(repo), "merge", "-q", "--no-ff", "main", "-m", "merge main"])
            head = run(["git", "-C", str(repo), "rev-parse", "HEAD"]).stdout.strip()
            result = subprocess.run([str(repo / "coachman-contract.sh"), base, head], cwd=repo,
                                    capture_output=True, text=True)
            ok = result.returncode == (1 if contract else 0)
            if part:
                ok = ok and any(line.startswith("yes %s " % part) for line in result.stdout.splitlines())
                ok = ok and hint in result.stdout and re.search(re.escape(hint) + r":\d+", result.stdout) is not None
            else:
                ok = ok and result.stdout.startswith("no coachman contract change")
            if control(ok, label, "exit %d" % result.returncode):
                passed += 1
            else:
                failed += 1
                if result.stderr:
                    print("       " + result.stderr.strip().replace("\n", "\n       "))
                if result.stdout:
                    print("       " + result.stdout.strip().replace("\n", "\n       "))

    merge_control(True)
    merge_control(False)
    print("coachman-contract self-test: %d passed, %d failed" % (passed, failed))
    return 0 if failed == 0 else 1


def main():
    args = sys.argv[2:]
    if not args:
        print("usage: coachman-contract.sh <base> <head> | --repo <repo> <base> <head> | --self-test", file=sys.stderr)
        return 2
    if args[0] == "--self-test":
        if len(args) != 1:
            print("usage: coachman-contract.sh --self-test", file=sys.stderr)
            return 2
        try:
            source_root = pathlib.Path(sys.argv[1]).resolve().parent
            return exercise_self_test(source_root)
        except ContractError as e:
            print("coachman-contract: %s" % e, file=sys.stderr)
            return 2
    if args[0] == "--repo" and len(args) == 4:
        _, repo, base, head = args
    elif len(args) == 2:
        repo_result = run(["git", "rev-parse", "--show-toplevel"], check=False)
        if repo_result.returncode:
            print("coachman-contract: run from a git repository or pass --repo", file=sys.stderr)
            return 2
        repo, base, head = repo_result.stdout.strip(), args[0], args[1]
    elif len(args) == 3:
        repo, base, head = args
    else:
        print("usage: coachman-contract.sh <base> <head> | --repo <repo> <base> <head> | --self-test", file=sys.stderr)
        return 2
    try:
        return print_result(check_change(repo, base, head), base, head)
    except ContractError as e:
        print("coachman-contract: %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
PY
