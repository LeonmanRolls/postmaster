#!/usr/bin/env bash
# The checks a change to a project is verified by, and running them. A project may declare its
# checks in .postmaster/project.toml, the settings file it commits for everyone who works on it
# (project.example.toml at this repo's root is its shape). A project that declares none gets
# defaults, found the way scripts/discover-project.sh finds the gate. Either way the gate is a
# check. A run is held to the checks it recorded at dispatch, never to what a branch declares
# later. Why, and what the defaults cover: wiki/concepts/verification.md.
#
#   verify.sh checks <repo> [--gate <command>] [--lines | --json]
#       the project's checks: each one's name, where it came from, its command and what it shows
#   verify.sh record <repo> <dispatch> [--gate <command>]
#       write the run's checks to <dispatch>/checks.json, once, and print them for the waybill
#   verify.sh arm <worktree> <dispatch>
#       copy the run's checks and its ticket into <worktree>/.postmaster/verify/, which git is told
#       to ignore, so a workhorse can run them knowing nothing of the run's directory
#   verify.sh run <worktree> [<dispatch>]
#       run every check in <worktree>, one result line each. With <dispatch>, as the coachman: run
#       the run's record, whatever the worktree's copy says, from a copy in <dispatch>/verify/, and
#       log each result as a `verify` action. Without it, as a workhorse: run what arm copied, and
#       log nothing. Either way it refuses a worktree holding anything git sees that its commit
#       does not, so every result belongs to a commit; a check that leaves such a file fails, and
#       the checks after it are not run
#   verify.sh journey-path <worktree> [<dispatch>]
#       where the journey report for <worktree>'s HEAD goes: under <dispatch>/journey/ for the
#       coachman, under the worktree's .postmaster/verify/journey/ for a workhorse
#   verify.sh results <dispatch> <worktree>
#       each check's latest logged result at <worktree>'s HEAD
#   verify.sh summary <summary-file> <dispatch> <worktree>
#       whether a workhorse's summary gives every check's command and exit, as `run` printed
#       them, and whether each claim agrees with the coachman's latest run on that branch
#   verify.sh --self-test
#
# The defaults, by what discovery finds: the gate, always; for a command-line app (a package.json
# bin), `examples`, scripts/verify-examples.sh; for a web app (a browser suite, or a web framework
# among its dependencies), `browser`, its suite, and `journey`, scripts/verify-journey.sh; for a
# library (package.json exports, or main or module on a package that is not private), `library`,
# scripts/verify-library.sh. A Cargo or pyproject project gets `examples` or `library` too, which
# report not run and say to declare the check. A declared check has a command and says what it
# shows, or uses one of the defaults by name; a command may also be scored, passing when the last
# number its score pattern captures from the output is at or above its threshold.
#
# A check passes, fails, or is not run, and a check that could not run is never written as
# passed. Each runs from the worktree's root under bash -e -o pipefail, in a process group of its
# own, which is stopped when the check ends, when it times out and when the run is stopped. It is
# not run on exit 126 or 127, when bash could not start it, nor a default's script on exit 3,
# which says why. A check that outlives its timeout, or is killed, fails. A scored check passes
# when it exits 0 and its last score is at or above its threshold. Colour codes and control
# characters are taken out of what is printed and logged. A command of several lines is printed,
# and carried to the waybill, as the one line that runs it the same way: bash -eo pipefail -c.
#
#   exit 0  printed; run, results, summary: every check passed, or the summary holds
#   exit 1  usage, or input that is not what it says, a declaration included
#   exit 2  run, results: a check failed; summary: a check is missing, or a claim disagrees
#   exit 3  run, results: none failed, but a check was not run or has no result
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
HERE=$(cd "$(dirname "$0")" && pwd -P)
usage() { echo "usage: verify.sh checks <repo> [--gate <command>] [--lines | --json] | record <repo> <dispatch> [--gate <command>] | arm <worktree> <dispatch> | run <worktree> [<dispatch>] | journey-path <worktree> [<dispatch>] | results <dispatch> <worktree> | summary <summary-file> <dispatch> <worktree> | --self-test" >&2; exit 1; }

core() {  # core <subcommand> <args>...
  exec python3 -I - "$HERE" "$@" <<'PY'
import datetime as dt, json, os, pathlib, re, shlex, signal, subprocess, sys, tempfile, time, tomllib

here, cmd, args = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
DECLARATION = ".postmaster/project.toml"
SPEC = ".postmaster/verify"
NAME = re.compile(r"[a-z][a-z0-9-]*")
KEYS = ("command", "shows", "use", "score", "threshold", "timeout")
TIMEOUT = 1800
DEFAULTS = {  # which: (name, kind, what it shows, its script)
    "gate": ("gate", "project", "the project's gate passes", None),
    "cli-examples": ("examples", "tool", "the ticket's example transcripts, run through the project's command, print and exit as they say", "verify-examples.sh"),
    "browser-suite": ("browser", "project", "the project's browser suite passes", None),
    "web-journey": ("journey", "tool", "each step of the ticket's User journey, walked in a browser, does what the ticket says", "verify-journey.sh"),
    "library-tests": ("library", "tool", "the tests that import the library by its package name pass", "verify-library.sh"),
}
USABLE = ("cli-examples", "browser-suite", "web-journey", "library-tests")
WEB = {"next", "nuxt", "vite", "@sveltejs/kit", "astro", "@remix-run/react", "react-scripts", "@angular/core",
       "gatsby", "@solidjs/start"}
SUITE_SCRIPTS = ("e2e", "test:e2e", "test:browser", "playwright", "cypress")
RESULT = re.compile(r"^\s*(?:[-*]\s+)?(?P<tick>`?)(?P<name>[a-z][a-z0-9-]*): (?P<result>pass|fail|not run), "
                    r"exit (?P<exit>-?\d+|-), (?P<secs>\d+)s: (?P<cmd>.*?)(?P=tick)\s*$")
DETAIL = re.compile(r"^on=(?P<branch>\S+)@(?P<sha>[0-9a-f]+) result=(?P<result>\S+) exit=(?P<exit>\S+)")
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

def die(msg):
    print("verify: " + msg, file=sys.stderr); sys.exit(1)

def plain(text):  # what a reader sees: no colour codes or control characters, and \r as a line break
    return CONTROL.sub("", ANSI.sub("", text.replace("\r\n", "\n").replace("\r", "\n")))

def oneline(command):  # a command on one line that runs as the check runs it: as printed, quoted and waybilled
    command = command.strip()
    if "\n" not in command:
        return command
    quoted = command.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\t", "\\t")
    return "bash -eo pipefail -c $'%s'" % quoted

def git(where, *a):
    r = subprocess.run(["git", "-C", str(where), *a], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def load_json(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None

def pm(repo):
    return ("pnpm" if (repo / "pnpm-lock.yaml").exists() else "bun" if (repo / "bun.lock").exists() or (repo / "bun.lockb").exists()
            else "yarn" if (repo / "yarn.lock").exists() else "npm")

def discover(repo):  # (the defaults that apply, in order; the browser suite's command)
    pkg = load_json(repo / "package.json") if (repo / "package.json").is_file() else None
    if isinstance(pkg, dict):
        found, deps = [], {}
        for k in ("dependencies", "devDependencies"):
            if isinstance(pkg.get(k), dict):
                deps.update(pkg[k])
        scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
        suite = next(("%s run %s" % (pm(repo), s) for s in SUITE_SCRIPTS if scripts.get(s)), "")
        if not suite and any((repo / ("playwright.config." + e)).exists() for e in ("ts", "js", "mjs", "cjs", "mts")):
            suite = "npx playwright test"
        if not suite and any((repo / ("cypress.config." + e)).exists() for e in ("ts", "js", "mjs", "cjs")):
            suite = "npx cypress run"
        if pkg.get("bin"):
            found.append("cli-examples")
        if suite or WEB & set(deps):
            found += ["browser-suite", "web-journey"]
        if "exports" in pkg or (("main" in pkg or "module" in pkg) and pkg.get("private") is not True):
            found.append("library-tests")
        return found, suite
    if (repo / "Cargo.toml").is_file():
        text = (repo / "Cargo.toml").read_text(errors="replace")
        return ((["cli-examples"] if "[[bin]]" in text or (repo / "src" / "main.rs").is_file() else [])
                + (["library-tests"] if (repo / "src" / "lib.rs").is_file() else [])), ""
    if (repo / "pyproject.toml").is_file():
        try:
            project = tomllib.load(open(repo / "pyproject.toml", "rb")).get("project")
        except (OSError, tomllib.TOMLDecodeError):
            project = None
        if isinstance(project, dict):
            return (["cli-examples"] if project.get("scripts") else ["library-tests"]), ""
    return [], ""

def default(which, gate, suite, name=None, shows=None, source=None):
    dname, kind, dshows, script = DEFAULTS[which]
    command = gate if which == "gate" else suite if which == "browser-suite" else shlex.quote(str(here / script))
    return {"name": name or dname, "source": source or "default:" + which, "kind": kind,
            "command": command or "", "shows": shows or dshows}

def declared(repo, gate, suite):  # the declared checks, or None when the project declares none
    settings = subprocess.run([str(here / "project-settings.sh"), "inspect", str(repo)],
                              capture_output=True, text=True)
    if settings.returncode:
        die(settings.stderr.strip() or "project settings could not be read")
    p = repo / DECLARATION
    if not p.is_file():
        return None
    try:
        table = tomllib.load(open(p, "rb")).get("checks")
    except tomllib.TOMLDecodeError as e:
        die("%s does not parse: %s" % (DECLARATION, e))
    except OSError as e:
        die("cannot read %s: %s" % (DECLARATION, e.strerror))
    if not table:
        return None
    if not isinstance(table, dict):
        die("%s: checks must be [checks.<name>] tables" % DECLARATION)
    faults, out = [], []
    for name, c in table.items():
        at, before = "[checks.%s]" % name, len(faults)
        if not NAME.fullmatch(name):
            faults.append("%s: a check's name is a lowercase word" % at); continue
        if not isinstance(c, dict):
            faults.append("%s must be a table" % at); continue
        extra = sorted(set(c) - set(KEYS))
        if extra:
            faults.append("%s: %s is not a key; the keys are %s" % (at, ", ".join(extra), ", ".join(KEYS)))
        if ("command" in c) == ("use" in c):
            faults.append("%s needs a command or a use, not both" % at); continue
        shows = c.get("shows")
        if shows is not None and (not isinstance(shows, str) or not shows.strip()):
            faults.append("%s: shows is words saying what the check shows" % at)
        if "timeout" in c and (isinstance(c["timeout"], bool) or not isinstance(c["timeout"], int) or c["timeout"] <= 0):
            faults.append("%s: timeout is a whole number of seconds" % at)
        if "use" in c:
            if name == "gate" or c["use"] not in USABLE:
                faults.append("%s: use names a default, one of %s; the gate takes a command" % (at, ", ".join(USABLE)))
            if "score" in c or "threshold" in c:
                faults.append("%s: a score is read from a command's output, so it goes with command, not use" % at)
            check = None if len(faults) > before else default(c["use"], gate, suite, name=name, shows=shows, source="declared:" + c["use"])
        else:
            if not isinstance(c["command"], str) or not c["command"].strip():
                faults.append("%s: command is the shell command that runs the check" % at)
            if shows is None:
                faults.append("%s: shows says what the check shows" % at)
            check = {"name": name, "source": "declared", "kind": "project", "command": str(c["command"]).strip(), "shows": shows}
            if ("score" in c) != ("threshold" in c):
                faults.append("%s: score and threshold go together" % at)
            elif "score" in c:
                try:
                    if not isinstance(c["score"], str) or re.compile(c["score"]).groups != 1:
                        faults.append("%s: score is a regular expression with one group, the number" % at)
                except re.error as e:
                    faults.append("%s: score is not a regular expression: %s" % (at, e))
                if isinstance(c["threshold"], bool) or not isinstance(c["threshold"], (int, float)):
                    faults.append("%s: threshold is a number" % at)
                check.update(score=c["score"], threshold=c["threshold"])
        if check is not None:
            if "timeout" in c:
                check["timeout"] = c["timeout"]
            out.append(check)
    if faults:
        die("%s declares its checks wrongly:\n  %s" % (DECLARATION, "\n  ".join(faults)))
    return out

def resolve(repo, gate, warn_gate=False):  # (checks, the declaration's path or None)
    found, suite = discover(repo)
    checks = declared(repo, gate, suite)
    if checks is None:
        return [default("gate", gate, suite)] + [default(w, gate, suite) for w in found], None
    if git(repo, "rev-parse", "--git-dir") is not None and git(repo, "ls-files", "--error-unmatch", DECLARATION) is None:
        print("verify: warn: %s is not committed, so its checks hold on this checkout only" % DECLARATION, file=sys.stderr)
    gates = [c for c in checks if c["name"] == "gate"]
    if warn_gate and gates and gate and oneline(gates[0]["command"]) != oneline(gate):
        print("verify: warn: %s declares the gate as %s, so %s is not used" % (DECLARATION, oneline(gates[0]["command"]), gate),
              file=sys.stderr)
    return (gates or [default("gate", gate, suite)]) + [c for c in checks if c["name"] != "gate"], DECLARATION

def human(checks):
    lines = []
    for c in checks:
        lines.append("%s [%s] %s" % (c["name"], c["source"], oneline(c["command"]) or "(no command found)"))
        lines.append("  shows: %s" % c["shows"])
        if "threshold" in c:
            lines.append("  passes when it exits 0 and the last number /%s/ captures is %s or more" % (c["score"], c["threshold"]))
    return "\n".join(lines)

def top_of(wt):
    top = git(wt, "rev-parse", "--show-toplevel")
    if top is None or git(wt, "rev-parse", "HEAD") is None:
        die("%s is not a git worktree with a commit" % wt)
    return pathlib.Path(top)

def recorded(dispatch):
    d = load_json(dispatch / "checks.json")
    if not isinstance(d, dict) or not isinstance(d.get("checks"), list):
        die("no checks recorded at %s: the postmaster records them at dispatch with verify.sh record" % (dispatch / "checks.json"))
    return d["checks"]

def ticket_part(text):
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if re.match(r"^##\s+Ticket\s*$", l)), None)
    if start is None:
        return text
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^##\s+Project profile\s*$", lines[i])), len(lines))
    return "\n".join(lines[start + 1:end]).strip("\n") + "\n"

def write_spec(spec, dispatch, journey):  # the run's checks and ticket, where a check's scripts read them
    checks = recorded(dispatch)
    try:
        ticket = ticket_part(open(dispatch / "brief.md", encoding="utf-8", errors="replace").read())
    except OSError:
        die("no waybill at %s to take the ticket from" % (dispatch / "brief.md"))
    spec.mkdir(parents=True, exist_ok=True)
    for name, text in (("ticket.md", ticket),
                       ("spec.json", json.dumps({"checks": checks, "journey_dir": str(journey)}, indent=2) + "\n")):
        fd, tmp = tempfile.mkstemp(dir=spec); os.close(fd)
        open(tmp, "w", encoding="utf-8").write(text); os.replace(tmp, spec / name)
    return checks

def arm(wt, dispatch):
    top = top_of(wt)
    spec = top / SPEC
    checks = write_spec(spec, dispatch, spec / "journey")
    common = top / (git(top, "rev-parse", "--git-common-dir") or ".git")   # relative to top, or absolute
    exclude = common / "info" / "exclude"
    lines = exclude.read_text().splitlines() if exclude.exists() else []
    if SPEC + "/" not in lines:
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude, "a") as f:
            f.write(("" if not lines or exclude.read_text().endswith("\n") else "\n") + SPEC + "/\n")
    return top, spec, checks

def uncommitted(top):  # every changed or new file git would see, but the checks' own copy
    r = subprocess.run(["git", "-C", str(top), "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True)
    return [l[3:] for l in r.stdout.splitlines() if l[3:] and not l[3:].strip('"').startswith(SPEC + "/")]

def listed(files):
    return ", ".join(files[:10]) + (" and %d more" % (len(files) - 10) if len(files) > 10 else "")

running = {"pgid": None}

def stop(signum, frame):  # a check never outlives the run that started it
    if running["pgid"]:
        try:
            os.killpg(running["pgid"], signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    sys.exit(128 + signum)

def run_one(c, top, env, log):
    if not c["command"]:
        return "not run", None, 0, "no command: discovery found none for %s; declare the check in %s" % (c["source"], DECLARATION)
    timeout = c.get("timeout") or TIMEOUT
    t0 = time.monotonic()
    with open(log, "wb") as f:
        p = subprocess.Popen(["bash", "-e", "-o", "pipefail", "-c", c["command"]], cwd=top, env=env,
                             stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
        running["pgid"], timed_out = p.pid, False
        while p.poll() is None:
            if time.monotonic() - t0 > timeout:
                timed_out = True; break
            time.sleep(0.1)
        try:  # the whole group goes, the command itself if it timed out, and whatever it left running
            os.killpg(p.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        p.wait()
        code = None if timed_out else p.returncode
        running["pgid"] = None
    secs = round(time.monotonic() - t0)
    out = plain(open(log, encoding="utf-8", errors="replace").read())
    last = next((l.strip() for l in reversed(out.splitlines()) if l.strip()), "(no output)")[:300]
    if code is None:
        return "fail", None, secs, "timed out after %ds" % timeout
    if code < 0:
        return "fail", code, secs, "killed by signal %d: %s" % (-code, last)
    if code in (126, 127):
        return "not run", code, secs, "bash could not start it: " + last
    if c["kind"] == "tool":
        if code == 0:
            return "pass", code, secs, ""
        return ("not run" if code == 3 else "fail"), code, secs, re.sub(r"^not run: ", "", last)
    if "threshold" in c:
        found = re.findall(c["score"], out)
        if code != 0:
            return "fail", code, secs, "exit %d%s: %s" % (code, (", last score %s" % found[-1]) if found else "", last)
        if not found:
            return "fail", code, secs, "no score in its output: nothing matches /%s/" % c["score"]
        try:
            score = float(found[-1])
        except ValueError:
            return "fail", code, secs, "its score, %r, is not a number" % found[-1]
        if score >= c["threshold"]:
            return "pass", code, secs, "score %s, threshold %s" % (found[-1], c["threshold"])
        return "fail", code, secs, "score %s, below the threshold %s" % (found[-1], c["threshold"])
    return ("pass" if code == 0 else "fail"), code, secs, "" if code == 0 else last

def run(wt, dispatch):
    top = top_of(wt)
    if dispatch:  # the coachman's copy lives in the run, so a workhorse's worktree keeps its own
        spec = dispatch / "verify" / "spec"
        checks = write_spec(spec, dispatch, dispatch / "journey")
    else:
        spec = top / SPEC
        d = load_json(spec / "spec.json")
        if not isinstance(d, dict) or not isinstance(d.get("checks"), list):
            die("%s is not armed: %s is missing; the coachman arms each workhorse worktree with verify.sh arm" % (top, spec / "spec.json"))
        checks = d["checks"]
    dirt = uncommitted(top)
    if dirt:
        die("%s has files git sees that its commit does not hold, so no result would belong to a commit: %s. "
            "Commit what belongs to the change and keep what a tool wrote out of git's sight%s, then run again."
            % (top, listed(dirt), ", or run on a scratch cut at the branch's HEAD with cut-scratch.sh" if dispatch else ""))
    sha = git(top, "rev-parse", "HEAD")
    branch = git(top, "symbolic-ref", "--short", "-q", "HEAD") or "detached"
    logs = (dispatch / "verify" / sha[:12]) if dispatch else (spec / "logs")
    logs.mkdir(parents=True, exist_ok=True)
    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, stop)
    env = dict(os.environ, POSTMASTER_VERIFY=str(spec))
    env.pop("POSTMASTER_LAUNCH_NAME", None)   # host.sh run names this runner's launch, not the checks it runs
    results, unlogged, spoiled = [], [], None
    for c in checks:
        log = logs / (c["name"] + ".log")
        if spoiled:
            result, code, secs, why = "not run", None, 0, "%s changed files git sees, so the worktree is no longer its commit" % spoiled
        else:
            result, code, secs, why = run_one(c, top, env, log)
            dirt = uncommitted(top)
            if dirt:
                spoiled, result = c["name"], "fail"
                why = "it changed files git sees, so its result is not its commit's: %s" % listed(dirt)
        results.append(result)
        print("%s: %s, exit %s, %ds: %s" % (c["name"], result, "-" if code is None else code, secs, oneline(c["command"]) or "(no command)"))
        if why:
            print("  " + why)
        if result != "pass" and c["command"] and log.exists():
            print("  log: %s" % log)
        sys.stdout.flush()
        if dispatch:
            detail = "on=%s@%s result=%s exit=%s secs=%d" % (branch, sha[:12], result.replace(" ", "-"), "-" if code is None else code, secs)
            if why:
                detail += (" score=" if result == "pass" else " reason=") + why
            r = subprocess.run([str(here / "log-action.sh"), str(dispatch), "coachman", "verify", c["name"], detail],
                               capture_output=True, text=True)
            if r.returncode != 0:
                unlogged.append("%s: %s" % (c["name"], r.stderr.strip()))
    for u in unlogged:
        print("verify: not logged, %s" % u, file=sys.stderr)
    if unlogged:
        sys.exit(1)
    sys.exit(2 if "fail" in results else 3 if "not run" in results else 0)

def logged(dispatch):  # every verify line in the run's log, oldest first
    out, f = [], dispatch / "actions.jsonl"
    try:
        lines = open(f, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return out
    for n, line in enumerate(lines, 1):
        try:
            e = json.loads(line)
        except ValueError:
            if '"verify"' in line:
                die("line %d of %s does not parse, so the checks' results cannot be read from it" % (n, f))
            continue
        m = DETAIL.match(e.get("detail", "")) if e.get("action") == "verify" else None
        if m:
            out.append((e.get("target"), e.get("ts", ""), m))
    return out

if cmd in ("checks", "record"):
    repo = pathlib.Path(args[0]).resolve()
    if not repo.is_dir():
        die("no such directory: %s" % args[0])
    gate, form = args[-2], args[-1]
    if cmd == "record":
        dispatch = pathlib.Path(args[1]).resolve()
        if not dispatch.is_dir():
            die("no such dispatch directory: %s" % args[1])
        f = dispatch / "checks.json"
        if f.exists():
            print("verify: %s already written; left alone" % f, file=sys.stderr)
            print(human(recorded(dispatch))); sys.exit(0)
    checks, decl = resolve(repo, gate, warn_gate=cmd == "record")
    if cmd == "checks":
        if form == "json":
            print(json.dumps(checks, indent=2))
        elif form == "lines":
            clean = lambda s: re.sub(r"[\t\r\n]+", " ", str(s))
            print("\n".join("\t".join((c["name"], c["source"], clean(oneline(c["command"])), clean(c["shows"]))) for c in checks))
        else:
            print(human(checks))
        sys.exit(0)
    record = {"written": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "repo": str(repo),
              "head": git(repo, "rev-parse", "HEAD"), "declaration": decl, "gate_given": gate or None, "checks": checks}
    fd, tmp = tempfile.mkstemp(dir=dispatch); os.close(fd)
    open(tmp, "w").write(json.dumps(record, indent=2) + "\n"); os.replace(tmp, f)
    print(human(checks)); sys.exit(0)

if cmd == "arm":
    top, spec, checks = arm(pathlib.Path(args[0]), pathlib.Path(args[1]).resolve())
    print("armed %s: %d checks in %s" % (top, len(checks), spec)); sys.exit(0)

if cmd == "run":
    run(pathlib.Path(args[0]), pathlib.Path(args[1]).resolve() if len(args) > 1 else None)

if cmd == "results":
    dispatch, top = pathlib.Path(args[0]).resolve(), top_of(pathlib.Path(args[1]))
    sha = git(top, "rev-parse", "HEAD")[:12]
    latest = {t: (ts, m) for t, ts, m in logged(dispatch) if m.group("sha") == sha}
    states = []
    for c in recorded(dispatch):
        got = latest.get(c["name"])
        states.append(got[1].group("result") if got else "missing")
        print("%s: %s" % (c["name"], "%s, exit %s, at %s" % (got[1].group("result").replace("-", " "), got[1].group("exit"), got[0])
                                     if got else "no result logged at %s" % sha))
    sys.exit(2 if "fail" in states else 0 if all(s == "pass" for s in states) else 3)

if cmd == "summary":
    summary, dispatch, top = pathlib.Path(args[0]), pathlib.Path(args[1]).resolve(), top_of(pathlib.Path(args[2]))
    try:
        text = open(summary, encoding="utf-8", errors="replace").read()
    except OSError:
        die("cannot read %s" % summary)
    claims = {}
    for line in text.splitlines():
        m = RESULT.match(line)
        if m:
            claims[m.group("name")] = m
    sha = git(top, "rev-parse", "HEAD")[:12]
    coach = {t: m for t, ts, m in logged(dispatch) if m.group("sha") == sha}
    problems = []
    for c in recorded(dispatch):
        m, want = claims.get(c["name"]), oneline(c["command"]) or "(no command)"
        if m is None:
            problems.append("unverified: the summary does not give %s's command and exit" % c["name"]); continue
        if oneline(m.group("cmd")) != want:
            problems.append("unverified: the summary says %s ran %s; the run's check is %s" % (c["name"], oneline(m.group("cmd")), want)); continue
        k = coach.get(c["name"])
        if k is not None and k.group("result") != m.group("result").replace(" ", "-"):
            problems.append("%s: the summary says %s; the coachman's run at %s says %s"
                            % (c["name"], m.group("result"), sha, k.group("result").replace("-", " ")))
    if problems:
        print("\n".join(problems))
    if not coach:
        print("no coachman run at %s to hold the claims against" % sha)
    print("the summary %s" % ("gives every check's command and exit%s" % ("" if not coach else ", and agrees with the coachman's run")
                              if not problems else "is unverified or disagrees: %d problem(s)" % len(problems)))
    sys.exit(2 if problems else 0)
die("unknown subcommand: " + cmd)
PY
}

case "${1:-}" in
  --self-test) ;;
  checks|record)
    SUB=$1; shift; POS=() GATE="" FORM=human
    while [ $# -gt 0 ]; do
      case $1 in
        --gate) [ $# -ge 2 ] || usage; GATE=$2; shift 2 ;;
        --lines) [ "$SUB" = checks ] || usage; FORM=lines; shift ;;
        --json) [ "$SUB" = checks ] || usage; FORM=json; shift ;;
        -*) usage ;;
        *) POS+=("$1"); shift ;;
      esac
    done
    if [ "$SUB" = checks ]; then [ ${#POS[@]} -eq 1 ] || usage; else [ ${#POS[@]} -eq 2 ] || usage; fi
    core "$SUB" "${POS[@]}" "$GATE" "$FORM"; exit $? ;;
  arm) [ $# -eq 3 ] || usage; core arm "$2" "$3"; exit $? ;;
  run) [ $# -eq 2 ] || [ $# -eq 3 ] || usage; shift; core run "$@"; exit $? ;;
  results) [ $# -eq 3 ] || usage; core results "$2" "$3"; exit $? ;;
  summary) [ $# -eq 4 ] || usage; core summary "$2" "$3" "$4"; exit $? ;;
  journey-path)
    [ $# -eq 2 ] || [ $# -eq 3 ] || usage
    if [ $# -eq 3 ]; then
      D=$(cd "$3" 2>/dev/null && pwd -P) || { echo "verify: no such dispatch directory: $3" >&2; exit 1; }
      exec "$HERE/verify-journey.sh" --path "$2" --dir "$D/journey"
    fi
    exec "$HERE/verify-journey.sh" --path "$2" ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(cd "$(mktemp -d)" && pwd -P) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
SELF="$HERE/verify.sh"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
G() { git -C "$1" -c user.name=t -c user.email=t@t "${@:2}"; }
repo() {  # repo <dir>: a git repo holding whatever is already in <dir>, committed
  mkdir -p "$1" || return 1
  "$HERE/project-settings.sh" ensure "$1" >/dev/null || return 1
  git -C "$1" init -q -b main && G "$1" add -A || return 1
  [ ! -f "$1/.postmaster/project.toml" ] || G "$1" add -f .postmaster/project.toml || return 1
  G "$1" commit -q --allow-empty -m first
}
lines() { "$SELF" checks "$tmp/$1" --gate "${2:-make check}" --lines 2>&1 | cut -f1,2 | tr '\t' ' ' | paste -sd, -; }
expect_lines() {  # expect_lines <label> <project> <name source,...>
  local got; got=$(lines "$2")
  [ "$got" = "$3" ] && ok "$1" || fail "$1" "want: $3"$'\n'"got:  $got"
}

echo "discovery: which defaults a project gets"
mkdir -p "$tmp/plain" && printf 'check:\n\ttrue\n' > "$tmp/plain/Makefile"
mkdir -p "$tmp/cli" && printf '{"name": "c", "bin": {"c": "c.sh"}}\n' > "$tmp/cli/package.json"
mkdir -p "$tmp/web" && printf '{"name": "w", "private": true, "main": "x.js", "scripts": {"e2e": "true"}, "devDependencies": {"next": "1"}}\n' > "$tmp/web/package.json"
mkdir -p "$tmp/pw" && printf '{"name": "p"}\n' > "$tmp/pw/package.json" && : > "$tmp/pw/playwright.config.ts"
mkdir -p "$tmp/nosuite" && printf '{"name": "n", "dependencies": {"vite": "1"}}\n' > "$tmp/nosuite/package.json"
mkdir -p "$tmp/lib" && printf '{"name": "l", "exports": "./i.js"}\n' > "$tmp/lib/package.json"
mkdir -p "$tmp/rust/src" && printf '[package]\nname = "r"\n' > "$tmp/rust/Cargo.toml" && : > "$tmp/rust/src/main.rs" && : > "$tmp/rust/src/lib.rs"
mkdir -p "$tmp/py" && printf '[project]\nname = "p"\n[project.scripts]\np = "p:main"\n' > "$tmp/py/pyproject.toml"
mkdir -p "$tmp/pylib" && printf '[project]\nname = "p"\n' > "$tmp/pylib/pyproject.toml"
for d in plain cli web pw nosuite lib rust py pylib; do repo "$tmp/$d"; done
expect_lines "a project discovery knows nothing of gets the gate alone"   plain   "gate default:gate"
expect_lines "a command-line app gets its examples"                       cli     "gate default:gate,examples default:cli-examples"
expect_lines "a web app gets its suite and its journey, and a private package with a main is no library" \
                                                                          web     "gate default:gate,browser default:browser-suite,journey default:web-journey"
expect_lines "a playwright config is a browser suite"                     pw      "gate default:gate,browser default:browser-suite,journey default:web-journey"
expect_lines "a library gets its tests through its name"                  lib     "gate default:gate,library default:library-tests"
expect_lines "a Cargo project with a main and a lib gets both"            rust    "gate default:gate,examples default:cli-examples,library default:library-tests"
expect_lines "a pyproject with scripts is a command-line app"             py      "gate default:gate,examples default:cli-examples"
expect_lines "a pyproject without is a library"                           pylib   "gate default:gate,library default:library-tests"
out=$("$SELF" checks "$tmp/web" --gate "npm run check" --lines)
grep -qF "$(printf 'browser\tdefault:browser-suite\tnpm run e2e\t')" <<<"$out" && ok "the suite's command is the project's own script" || fail "the suite's command is the project's own script" "$out"
grep -qF "$(printf 'gate\tdefault:gate\tnpm run check\t')" <<<"$out" && ok "the gate is the one it was given" || fail "the gate is the one it was given" "$out"
grep -qF "$(printf 'browser\tdefault:browser-suite\tnpx playwright test\t')" <<<"$("$SELF" checks "$tmp/pw" --lines)" && ok "and a playwright config's is playwright's" || fail "and a playwright config's is playwright's"
grep -qF "$(printf 'browser\tdefault:browser-suite\t\t')" <<<"$("$SELF" checks "$tmp/nosuite" --lines)" && ok "a web app with no suite has a browser check with no command" || fail "a web app with no suite has a browser check with no command"

echo "declaration"
mkdir -p "$tmp/decl/.postmaster"
printf '{"name": "d", "exports": "./i.js", "bin": {"d": "d.sh"}}\n' > "$tmp/decl/package.json"
cat > "$tmp/decl/.postmaster/project.toml" <<'EOF'
[checks.unit]
command = "npm test"
shows = "each module does what its tests say"

[checks.gate]
command = "npm run check"
shows = "the project's own gate"

[checks.answers]
command = "python evals/run.py"
shows = "answer quality holds"
score = 'score: ([0-9.]+)'
threshold = 0.85

[checks.try]
use = "cli-examples"
timeout = 120
EOF
repo "$tmp/decl"
expect_lines "a declaration replaces the defaults, keeps its order, and puts the gate first" \
  decl "gate declared,unit declared,answers declared,try declared:cli-examples"
out=$("$SELF" checks "$tmp/decl" --gate "make check" 2>&1)
grep -qF "gate [declared] npm run check" <<<"$out" && ok "a declared gate wins over the one discovery gave" || fail "a declared gate wins over the one discovery gave" "$out"
grep -qF "passes when it exits 0 and the last number /score: ([0-9.]+)/ captures is 0.85 or more" <<<"$out" && ok "a scored check says what passes" || fail "a scored check says what passes" "$out"
python3 -c 'import json,sys; c=[c for c in json.load(sys.stdin) if c["name"]=="try"][0]; sys.exit(0 if c.get("timeout")==120 else 1)' < <("$SELF" checks "$tmp/decl" --json 2>/dev/null) \
  && ok "a check that uses a default keeps its timeout" || fail "a check that uses a default keeps its timeout"
mkdir -p "$tmp/decl/.postmaster/runs/T-0"; printf '## Ticket\nx\n' > "$tmp/decl/.postmaster/runs/T-0/brief.md"
grep -qF "declares the gate as npm run check, so make ci is not used" <<<"$("$SELF" record "$tmp/decl" "$tmp/decl/.postmaster/runs/T-0" --gate "make ci" 2>&1 >/dev/null)" \
  && ok "record says when the project's declared gate overrides the one it was given" || fail "record says when the project's declared gate overrides the one it was given"
grep -qF "verify-examples.sh" <<<"$out" && grep -qF "shows: the ticket's example transcripts" <<<"$out" && ok "a check that uses a default runs its script and says what it shows" || fail "a check that uses a default runs its script and says what it shows" "$out"
grep -qF "warn" <<<"$out" && fail "a committed declaration raises no warning" "$out" || ok "a committed declaration raises no warning"
mkdir -p "$tmp/local/.postmaster" && printf '[checks.unit]\ncommand = "true"\nshows = "x"\n' > "$tmp/local/.postmaster/project.toml"
git -C "$tmp/local" init -q -b main
grep -qF "is not committed" <<<"$("$SELF" checks "$tmp/local" 2>&1 >/dev/null)" && ok "an uncommitted declaration is warned of" || fail "an uncommitted declaration is warned of"
mkdir -p "$tmp/empty/.postmaster" && printf '{"name": "e", "bin": "e.sh"}\n' > "$tmp/empty/package.json" && printf '[checks]\n' > "$tmp/empty/.postmaster/project.toml"
repo "$tmp/empty"
expect_lines "an empty [checks] declares nothing, so the defaults apply"  empty "gate default:gate,examples default:cli-examples"
bad() {  # bad <label> <toml> <text the refusal must hold>
  mkdir -p "$tmp/bad/.postmaster"; printf '%s\n' "$2" > "$tmp/bad/.postmaster/project.toml"
  local out rc; out=$("$SELF" checks "$tmp/bad" 2>&1); rc=$?
  [ $rc -eq 1 ] && grep -qF -- "$3" <<<"$out" && ok "$1" || fail "$1 (exit $rc)" "$out"
}
bad "a key that is not one is refused"           $'[checks.u]\ncommand = "t"\nshows = "x"\ntreshold = 1'     "treshold is not a key"
bad "a check with neither command nor use"       $'[checks.u]\nshows = "x"'                                     "needs a command or a use"
bad "a check with both"                          $'[checks.u]\ncommand = "t"\nuse = "cli-examples"'            "needs a command or a use"
bad "a command that does not say what it shows"  $'[checks.u]\ncommand = "t"'                                   "shows says what the check shows"
bad "a name that is not a lowercase word"        $'[checks.Unit]\ncommand = "t"\nshows = "x"'                  "lowercase word"
bad "a score without a threshold"                $'[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s (\\\\d+)"'  "score and threshold go together"
bad "a score with no group"                      $'[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s"\nthreshold = 1'  "one group"
bad "a threshold that is not a number"           $'[checks.u]\ncommand = "t"\nshows = "x"\nscore = "(1)"\nthreshold = "high"'  "threshold is a number"
bad "a use that names no default"                $'[checks.u]\nuse = "lint"'                                    "use names a default"
bad "a timeout that is not seconds"              $'[checks.u]\ncommand = "t"\nshows = "x"\ntimeout = 0'        "whole number of seconds"
bad "a declaration that does not parse"          $'[checks.u\ncommand = "t"'                                   "does not parse"

echo "record, arm and run"
# A project whose declared checks cover every outcome a run can have.
p="$tmp/proj"; mkdir -p "$p/.postmaster"
cat > "$p/.postmaster/project.toml" <<'EOF'
[checks.gate]
command = "true"
shows = "the gate"
[checks.red]
command = "echo broke; false"
shows = "a check that fails"
[checks.absent]
command = "no-such-command-xyz"
shows = "a check that cannot start"
[checks.good-score]
command = "echo 'score: 0.7'; echo 'score: 0.91'"
shows = "a scored check above its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.crash-score]
command = "echo 'batch 1 score: 1.00'; exit 1"
shows = "a scored check that prints a score, then fails"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.killed-score]
command = "echo 'score: 0.95'; kill -9 $$"
shows = "a scored check killed after a score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.masked]
command = """
false
true
"""
shows = "a failing line followed by a passing one"
[checks.piped]
command = "false | cat"
shows = "a failure piped into a success"
[checks.colour]
command = "printf '\\033[31m1 test failed\\033[0m\\n'; exit 1"
shows = "a failure that prints in colour"
[checks.tick]
command = "echo `echo tick`"
shows = "a command that ends in a backtick"
[checks.low-score]
command = "echo 'score: 0.5'"
shows = "a scored check below its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.no-score]
command = "echo nothing"
shows = "a scored check with no score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.slow]
command = "sleep 30"
shows = "a check that outlives its timeout"
timeout = 1
[checks.try]
use = "cli-examples"
EOF
repo "$p"
d="$p/.postmaster/runs/T-1"; mkdir -p "$d"
printf '# Waybill: T-1\n\n## Ticket\n## Problem / feature\nA thing.\n\n## Project profile\nrepo: %s\n' "$p" > "$d/brief.md"
out=$("$SELF" record "$p" "$d" --gate "make check"); rc=$?
[ $rc -eq 0 ] && [ -f "$d/checks.json" ] && grep -qF "red [declared] echo broke; false" <<<"$out" && ok "record writes checks.json and prints the checks" || fail "record writes checks.json and prints the checks (exit $rc)" "$out"
cp "$d/checks.json" "$tmp/before.json"; sleep 1; "$SELF" record "$p" "$d" >/dev/null 2>&1
cmp -s "$d/checks.json" "$tmp/before.json" && ok "a second record leaves checks.json alone" || fail "a second record leaves checks.json alone"
G "$p" worktree add -q "$p/.worktrees/T-1-a" -b wb/T-1-a
wt="$p/.worktrees/T-1-a"
"$SELF" arm "$wt" "$d" >/dev/null && [ -f "$wt/.postmaster/verify/spec.json" ] && ok "arm copies the checks into the worktree" || fail "arm copies the checks into the worktree"
grep -qF "A thing." "$wt/.postmaster/verify/ticket.md" && ! grep -qF "Project profile" "$wt/.postmaster/verify/ticket.md" && ok "and the ticket, without the rest of the waybill" || fail "and the ticket, without the rest of the waybill"
[ -z "$(git -C "$wt" status --porcelain)" ] && ok "and git does not see what it wrote" || fail "and git does not see what it wrote" "$(git -C "$wt" status --porcelain)"
out=$("$SELF" run "$wt" 2>&1); rc=$?
want() {  # want <label> <line the output must hold>
  grep -qF -- "$2" <<<"$out" && ok "$1" || fail "$1" "$out"
}
[ $rc -eq 2 ] && ok "a run with a failed check exits 2" || fail "a run with a failed check exits 2 (exit $rc)" "$out"
want "a passing check passes"                                  "gate: pass, exit 0,"
want "a failing check fails, with its last line"               "red: fail, exit 1,"
want "a command bash cannot start is not run"                  "absent: not run, exit 127,"
want "a score at or above its threshold passes"               "good-score: pass, exit 0,"
want "and the last score is the one read"                      "score 0.91, threshold 0.85"
want "a scored check that exits other than 0 fails, whatever it printed"  "crash-score: fail, exit 1,"
want "a scored check killed by a signal fails"                 "killed-score: fail, exit -9,"
want "a failing line is not hidden by a passing one after it"  "masked: fail, exit 1,"
want "a failure is not hidden by a pipe"                       "piped: fail, exit 1,"
want "a multi-line command prints as one line that runs the same"  "masked: fail, exit 1, 0s: bash -eo pipefail -c \$'false\\ntrue'"
grep -q $'\033' <<<"$out" && fail "colour codes are taken out of the reasons" "$out" || ok "colour codes are taken out of the reasons"
want "and the reason is what a reader sees"                    "  1 test failed"
want "a score below it fails"                                  "score 0.5, below the threshold 0.85"
want "a scored check with no score fails"                      "no score in its output"
want "a check past its timeout fails"                          "slow: fail, exit -,"
want "a default's not run is not run, with its reason"         "try: not run, exit 3,"
want "a failed check names its log"                            "log: $wt/.postmaster/verify/logs/red.log"
[ ! -e "$d/actions.jsonl" ] && ok "a workhorse's run logs nothing to the run" || fail "a workhorse's run logs nothing to the run"
lane_out=$out

echo "the coachman's run"
python3 - "$wt/.postmaster/verify/spec.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["checks"] = [c for c in s["checks"] if c["name"] != "red"]; json.dump(s, open(sys.argv[1], "w"))
PY
out=$("$SELF" run "$wt" "$d" 2>&1); rc=$?
[ $rc -eq 2 ] && want "the coachman runs the run's checks, not what the worktree holds" "red: fail, exit 1," || fail "the coachman's run exits 2 (exit $rc)" "$out"
n=$(grep -c '"action":"verify"' "$d/actions.jsonl" 2>/dev/null)
[ "$n" = 14 ] && ok "and logs one verify line per check" || fail "and logs one verify line per check ($n)"
python3 -c 'import json,sys; [json.loads(l) for l in open(sys.argv[1])]' "$d/actions.jsonl" 2>/dev/null \
  && ok "every line it logs parses, colour codes and all" || fail "every line it logs parses, colour codes and all"
python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(0 if s["journey_dir"]==sys.argv[2] and "red" not in [c["name"] for c in s["checks"]] else 1)' \
  "$wt/.postmaster/verify/spec.json" "$wt/.postmaster/verify/journey" \
  && ok "and leaves the workhorse's own copy as the workhorse left it" || fail "and leaves the workhorse's own copy as the workhorse left it"
sha=$(git -C "$wt" rev-parse HEAD | cut -c1-12)
grep -qF "\"target\":\"red\",\"detail\":\"on=wb/T-1-a@$sha result=fail exit=1" "$d/actions.jsonl" && ok "each naming the branch, the commit and the result" || fail "each naming the branch, the commit and the result" "$(tail -3 "$d/actions.jsonl")"
[ -f "$d/verify/$sha/red.log" ] && ok "with its output kept in the run" || fail "with its output kept in the run"
p1=$("$SELF" journey-path "$wt" "$d"); [ "$p1" = "$d/journey/$(git -C "$wt" rev-parse HEAD).md" ] && ok "the coachman's journey report goes in the run" || fail "the coachman's journey report goes in the run" "$p1"
p2=$(env -u POSTMASTER_VERIFY "$SELF" journey-path "$wt"); [ "$p2" = "$wt/.postmaster/verify/journey/$(git -C "$wt" rev-parse HEAD).md" ] && ok "a workhorse's in its worktree" || fail "a workhorse's in its worktree" "$p2"

echo "results and summaries"
out=$("$SELF" results "$d" "$wt"); rc=$?
[ $rc -eq 2 ] && grep -qF "red: fail, exit 1, at" <<<"$out" && grep -qF "gate: pass, exit 0, at" <<<"$out" && ok "results give each check's latest result at HEAD" || fail "results give each check's latest result at HEAD (exit $rc)" "$out"
cp -r "$d" "$p/.postmaster/runs/T-1-broken"; printf '{"action":"verify","target":"red","detail":"on=x\n' >> "$p/.postmaster/runs/T-1-broken/actions.jsonl"
"$SELF" results "$p/.postmaster/runs/T-1-broken" "$wt" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a log line that does not parse stops results rather than being skipped" || fail "a log line that does not parse stops results rather than being skipped (exit $rc)"
printf '# Summary\n\n## Checks\n%s\n' "$lane_out" > "$tmp/summary.md"
out=$("$SELF" summary "$tmp/summary.md" "$d" "$wt"); rc=$?
[ $rc -eq 0 ] && grep -qF "agrees with the coachman's run" <<<"$out" && ok "a summary that pastes the run's lines holds, signals, backticks and several lines included" || fail "a summary that pastes the run's lines holds, signals, backticks and several lines included (exit $rc)" "$out"
grep -v '^slow:' "$tmp/summary.md" > "$tmp/missing.md"
out=$("$SELF" summary "$tmp/missing.md" "$d" "$wt"); rc=$?
[ $rc -eq 2 ] && grep -qF "unverified: the summary does not give slow's command and exit" <<<"$out" && ok "a summary missing a check is unverified" || fail "a summary missing a check is unverified (exit $rc)" "$out"
sed 's/^red: fail, exit 1/red: pass, exit 0/' "$tmp/summary.md" > "$tmp/claims.md"
out=$("$SELF" summary "$tmp/claims.md" "$d" "$wt"); rc=$?
[ $rc -eq 2 ] && grep -qF "red: the summary says pass; the coachman's run at $(git -C "$wt" rev-parse HEAD | cut -c1-12) says fail" <<<"$out" && ok "a claim the coachman's run contradicts is named" || fail "a claim the coachman's run contradicts is named (exit $rc)" "$out"
sed 's/^gate: pass, exit 0, \([0-9]*\)s: true/gate: pass, exit 0, \1s: make/' "$tmp/summary.md" > "$tmp/other.md"
out=$("$SELF" summary "$tmp/other.md" "$d" "$wt"); rc=$?
[ $rc -eq 2 ] && grep -qF "unverified: the summary says gate ran make" <<<"$out" && ok "a check run with another command is unverified" || fail "a check run with another command is unverified (exit $rc)" "$out"
G "$wt" commit -q --allow-empty -m later
out=$("$SELF" results "$d" "$wt"); rc=$?
[ $rc -eq 3 ] && grep -qF "no result logged at" <<<"$out" && ok "a later commit has no results until the checks run on it" || fail "a later commit has no results until the checks run on it (exit $rc)" "$out"

echo "the gate and the browser suite, the defaults the runner runs itself"
default_run() {  # default_run <project> <gate> <e2e script>: record a web app's defaults and run them
  mkdir -p "$tmp/$1"; printf '{"name": "w", "private": true, "scripts": {"e2e": "%s"}, "devDependencies": {"next": "1"}}\n' "$3" > "$tmp/$1/package.json"
  repo "$tmp/$1"; mkdir -p "$tmp/$1/.postmaster/runs/T-5"; printf '## Ticket\nx\n' > "$tmp/$1/.postmaster/runs/T-5/brief.md"
  "$SELF" record "$tmp/$1" "$tmp/$1/.postmaster/runs/T-5" --gate "$2" >/dev/null; "$SELF" run "$tmp/$1" "$tmp/$1/.postmaster/runs/T-5" 2>&1
}
out=$(default_run webpass true "echo suite ran")
grep -qF "gate: pass, exit 0," <<<"$out" && grep -qF "browser: pass, exit 0, " <<<"$out" && grep -qF "journey: not run, exit 3," <<<"$out" \
  && ok "a gate and a suite that pass, pass, and a journey the ticket lacks is not run" || fail "a gate and a suite that pass, pass, and a journey the ticket lacks is not run" "$out"
out=$(default_run webfail false "exit 1")
grep -qF "gate: fail, exit 1," <<<"$out" && grep -qF "browser: fail, exit 1, " <<<"$out" \
  && ok "a gate and a suite that fail, fail" || fail "a gate and a suite that fail, fail" "$out"

echo "exits"
q="$tmp/green"; mkdir -p "$q/.postmaster"; printf '[checks.gate]\ncommand = "true"\nshows = "x"\n' > "$q/.postmaster/project.toml"; repo "$q"
e="$q/.postmaster/runs/T-2"; mkdir -p "$e"; printf '## Ticket\nx\n' > "$e/brief.md"; "$SELF" record "$q" "$e" >/dev/null
"$SELF" run "$q" "$e" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "a run whose every check passed exits 0" || fail "a run whose every check passed exits 0 (exit $rc)"
r="$tmp/grey"; mkdir -p "$r/.postmaster"; printf '[checks.gate]\ncommand = "true"\nshows = "x"\n[checks.try]\nuse = "library-tests"\n' > "$r/.postmaster/project.toml"; repo "$r"
f="$r/.postmaster/runs/T-3"; mkdir -p "$f"; printf '## Ticket\nx\n' > "$f/brief.md"; "$SELF" record "$r" "$f" >/dev/null
"$SELF" run "$r" "$f" >/dev/null 2>&1; rc=$?
[ $rc -eq 3 ] && ok "a run with a check not run and none failed exits 3" || fail "a run with a check not run and none failed exits 3 (exit $rc)"
"$SELF" run "$tmp/plain" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a worktree nobody armed is refused" || fail "a worktree nobody armed is refused (exit $rc)"
s="$q/.postmaster/runs/T-4"; mkdir -p "$s"
"$SELF" arm "$q" "$s" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a run that recorded no checks cannot arm a worktree" || fail "a run that recorded no checks cannot arm a worktree (exit $rc)"

echo "a check sees what it would from a terminal"
np="$tmp/named"; mkdir -p "$np/.postmaster"; printf '[checks.gate]\ncommand = "! printenv POSTMASTER_LAUNCH_NAME"\nshows = "x"\n' > "$np/.postmaster/project.toml"; repo "$np"
nd="$tmp/runs/named/T-11"; mkdir -p "$nd"; printf '## Ticket\nx\n' > "$nd/brief.md"; "$SELF" record "$np" "$nd" >/dev/null
POSTMASTER_LAUNCH_NAME="#11, a run" "$SELF" run "$np" "$nd" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "a run started by host.sh run keeps its launch's name from its checks" || fail "a run started by host.sh run keeps its launch's name from its checks (exit $rc)"

echo "a result belongs to a commit"
printf 'new\n' > "$q/new.txt"
out=$("$SELF" run "$q" "$e" 2>&1); rc=$?
[ $rc -eq 1 ] && grep -qF "new.txt" <<<"$out" && ok "a new file the commit lacks is refused, and named" || fail "a new file the commit lacks is refused, and named (exit $rc)" "$out"
rm -- "$q/new.txt"; "$SELF" arm "$q" "$e" >/dev/null; printf '# changed\n' >> "$q/.postmaster/project.toml"
out=$("$SELF" run "$q" 2>&1); rc=$?
[ $rc -eq 1 ] && grep -qF "files git sees that its commit does not hold" <<<"$out" && ok "so is a changed file, in a workhorse's run too" || fail "so is a changed file, in a workhorse's run too (exit $rc)" "$out"
G "$q" commit -qam "a change"

sp="$tmp/spoil"; mkdir -p "$sp/.postmaster"; printf 'broken\n' > "$sp/src.txt"
cat > "$sp/.postmaster/project.toml" <<'EOF'
[checks.gate]
command = "sed -i.orig s/broken/fixed/ src.txt && rm -f src.txt.orig"
shows = "a gate that fixes what it should only check"
[checks.unit]
command = "grep -q fixed src.txt"
shows = "passes only on what the gate rewrote"
EOF
repo "$sp"; sd="$sp/.postmaster/runs/T-9"; mkdir -p "$sd"; printf '## Ticket\nx\n' > "$sd/brief.md"; "$SELF" record "$sp" "$sd" >/dev/null
out=$("$SELF" run "$sp" "$sd" 2>&1); rc=$?
[ $rc -eq 2 ] && grep -qF "gate: fail, exit 0," <<<"$out" && grep -qF "it changed files git sees, so its result is not its commit's: src.txt" <<<"$out" \
  && ok "a check that rewrites a tracked file fails, and names it" || fail "a check that rewrites a tracked file fails, and names it (exit $rc)" "$out"
grep -qF "unit: not run, exit -, 0s:" <<<"$out" && ok "and the checks after it do not run" || fail "and the checks after it do not run" "$out"
[ "$("$SELF" results "$sd" "$sp" 2>&1 | grep -c ': pass')" = 0 ] && ok "and nothing is logged as passed" || fail "and nothing is logged as passed"
G "$sp" checkout -q -- src.txt
wp="$tmp/writes"; mkdir -p "$wp/.postmaster"; printf '[checks.gate]\ncommand = "echo ok | tee gate.log"\nshows = "x"\n' > "$wp/.postmaster/project.toml"; repo "$wp"
wd="$wp/.postmaster/runs/T-10"; mkdir -p "$wd"; printf '## Ticket\nx\n' > "$wd/brief.md"; "$SELF" record "$wp" "$wd" >/dev/null
out=$("$SELF" run "$wp" "$wd" 2>&1)
grep -qF "gate: fail, exit 0," <<<"$out" && grep -qF "gate.log" <<<"$out" && ok "so does a check that leaves a new file git sees" || fail "so does a check that leaves a new file git sees" "$out"
! sed -n '/^core() {/,/^PY$/p' "$SELF" | grep -q 'os[.]waitid' && ok "the runner waits without os.waitid, which python lacks on macOS before 3.13" || fail "the runner waits without os.waitid, which python lacks on macOS before 3.13"
for m in json re; do printf 'open("%s/imported", "w").write("%s")\n' "$tmp" "$m" > "$q/$m.py"; done
(cd "$q" && "$SELF" checks . --lines >/dev/null 2>&1; "$HERE/discover-project.sh" . >/dev/null 2>&1)
rm -f -- "$q/json.py" "$q/re.py"
[ ! -e "$tmp/imported" ] && ok "modules in the target's own directory are never imported" || fail "modules in the target's own directory are never imported" "$(cat "$tmp/imported")"

echo "nothing a check starts outlives it"
lp="$tmp/leftover"; mkdir -p "$lp/.postmaster"
printf '[checks.gate]\ncommand = "sleep 300 & echo $! > leftover.pid"\nshows = "x"\n' > "$lp/.postmaster/project.toml"; repo "$lp"
ld="$lp/.postmaster/runs/T-6"; mkdir -p "$ld"; printf '## Ticket\nx\n' > "$ld/brief.md"; "$SELF" record "$lp" "$ld" >/dev/null
"$SELF" run "$lp" "$ld" >/dev/null 2>&1
gone() { local i; for i in $(seq 40); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.05; done; return 1; }
gone "$(cat "$lp/leftover.pid")" && ok "a process a check leaves running is stopped when it ends" || fail "a process a check leaves running is stopped when it ends"
tp="$tmp/term"; mkdir -p "$tp/.postmaster"
printf '[checks.gate]\ncommand = "echo $$ > term.pid; sleep 300"\nshows = "x"\n' > "$tp/.postmaster/project.toml"; repo "$tp"
td="$tp/.postmaster/runs/T-7"; mkdir -p "$td"; printf '## Ticket\nx\n' > "$td/brief.md"; "$SELF" record "$tp" "$td" >/dev/null
python3 - "$SELF" "$tp" "$td" "$tp/term.pid" <<'PY' && ok "a run that is stopped stops its check" || fail "a run that is stopped stops its check"
import os, signal, subprocess, sys, time
me, repo, dispatch, pidfile = sys.argv[1:]
p = subprocess.Popen([me, "run", repo, dispatch], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(200):
    if os.path.exists(pidfile) and open(pidfile).read().strip():
        break
    time.sleep(0.05)
child = int(open(pidfile).read())
os.killpg(p.pid, signal.SIGTERM)   # as a session host stops a run: the run's group, not the check's
p.wait(timeout=10)
for _ in range(40):
    try:
        os.kill(child, 0)
    except ProcessLookupError:
        sys.exit(0)
    time.sleep(0.05)
sys.exit(1)
PY
mp="$tmp/moved"; mkdir -p "$mp/.postmaster"; printf '[checks.try]\nuse = "library-tests"\n' > "$mp/.postmaster/project.toml"; repo "$mp"
md="$mp/.postmaster/runs/T-8"; mkdir -p "$md"; printf '## Ticket\nx\n' > "$md/brief.md"; "$SELF" record "$mp" "$md" >/dev/null
python3 - "$md/checks.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for c in d["checks"]:
    if c["name"] == "try":
        c["command"] = "/no/such/checkout/scripts/verify-library.sh"
json.dump(d, open(sys.argv[1], "w"))
PY
out=$("$SELF" run "$mp" "$md" 2>&1)
grep -qF "try: not run, exit 127," <<<"$out" && ok "a default whose script cannot be started is not run" || fail "a default whose script cannot be started is not run" "$out"

echo "discovery reports the checks"
out=$("$HERE/discover-project.sh" "$tmp/decl" 2>/dev/null)
grep -qx 'gate=npm run check' <<<"$out" && ok "discover-project.sh names the declared gate" || fail "discover-project.sh names the declared gate" "$out"
grep -qx 'check.try=declared:cli-examples: the ticket'"'"'s example transcripts, run through the project'"'"'s command, print and exit as they say' <<<"$out" \
  && ok "and each check, where it came from and what it shows" || fail "and each check, where it came from and what it shows" "$out"
out=$("$HERE/discover-project.sh" "$tmp/cli" 2>/dev/null)
grep -qx 'check.examples=default:cli-examples: .*' <<<"$out" && ok "a default says which one it is" || fail "a default says which one it is" "$out"
mg="$tmp/multigate"; mkdir -p "$mg/.postmaster"; printf '[checks.gate]\ncommand = """\nfalse\necho lint clean\n"""\nshows = "x"\n' > "$mg/.postmaster/project.toml"; repo "$mg"
g=$("$HERE/discover-project.sh" "$mg" 2>/dev/null | sed -n 's/^gate=//p')
[ "$g" = "bash -eo pipefail -c \$'false\\necho lint clean'" ] && ! bash -c "$g" >/dev/null 2>&1 \
  && ok "a gate of several lines is carried as one line that fails as the gate does" || fail "a gate of several lines is carried as one line that fails as the gate does" "$g"
out=$("$HERE/discover-project.sh" "$tmp/bad" 2>&1); rc=$?
[ $rc -eq 1 ] && grep -qF 'project settings could not be read' <<<"$out" && ! grep -q '^check\.' <<<"$out" \
  && ok "a broken declaration stops discovery before it guesses checks" \
  || fail "a broken declaration stops discovery before it guesses checks (exit $rc)" "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
