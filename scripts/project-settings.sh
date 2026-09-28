#!/usr/bin/env bash
# A project's .postmaster/ settings: what it requires of a run (project.toml, the one file it
# may commit) and this person's choices on this machine (settings.toml, never committed).
# Reads both, applies the precedence, refuses a credential or a filesystem path in either, and
# writes settings.toml when a setup conversation settles a choice. A project without a
# .postmaster/ folder has no settings: that is the normal case, never an error.
#
#   project-settings.sh <repo> has
#       shared=yes|no local=yes|no any=yes|no
#   project-settings.sh <repo> get <key>
#       the value under the precedence (shared, then local; discovery is the caller's job).
#       Keys: turnpikes.default · tracker.board · tracker.workspace · tracker.team ·
#             risk.surfaces · roles.workhorses · roles.reviewers · roles.coachman ·
#             roles.coachman_fallback · roles.lens_reviewers.<lens>
#       Lists print one item per line; turnpikes.default prints `turnpikes: <names>` as
#       scripts/turnpikes.sh resolve does; roles.coachman prints harness/model[/effort].
#       An absent key prints nothing and exits 0: absence is not an error.
#   project-settings.sh <repo> validate
#       exit 0 when both files parse and hold only what they may; exit 1 naming what may not
#   project-settings.sh <repo> write-local <key>=<value> [<key>=<value>...]
#       write those keys into <repo>/.postmaster/settings.toml, replacing their old values and
#       leaving every other key alone. List values are comma-separated; risk.surfaces takes
#       a value with embedded newlines. Creates the folder and its .gitignore if needed.
#   project-settings.sh --self-test
#
# What each file may hold, and nothing else:
#   project.toml (shared)   turnpikes.default, tracker.{board,workspace,team}, risk.surfaces,
#                           and checks.* (scripts/verify.sh owns that schema)
#   settings.toml (local)   roles.{workhorses,reviewers,coachman,coachman_fallback,
#                           lens_reviewers.<lens>}, and the same turnpikes/tracker/risk keys
# Neither may carry a credential or a filesystem path: no key named for one, and no path-like
# value in a name field. risk.surfaces is prose and may mention a path; a name field may not
# be one. Role assignments name lanes the machine config defines; they never name an env file.
#
# Precedence: discovery supplies defaults; project.toml declares what the project requires;
# settings.toml are this person's choices on this machine; ~/.postmaster/config.toml supplies
# what is machine-specific and is never overridden by a project. None of these sets a floor of
# turnpikes: a ticket names the turnpikes its run passes through (#40).
#
#   exit 0  printed, validated, or written
#   exit 1  usage, a missing repo, a file that does not parse, a key or value outside the shape
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

if [ "${1:-}" = --self-test ]; then
  SELF="$HERE/project-settings.sh" python3 -I - --self-test <<'PY'
import os, pathlib, shutil, subprocess, sys, tempfile
self = os.environ["SELF"]
tmp = pathlib.Path(tempfile.mkdtemp())
fails = 0

def ok(msg):
    print("  ok   %s" % msg)

def fail(msg, extra=""):
    global fails
    print("  FAIL %s" % msg)
    if extra:
        print("         %s" % extra.replace("\n", "\n         "))
    fails += 1

def run(*args, expect=0, contains=None, not_contains=None):
    r = subprocess.run([self, *args], capture_output=True, text=True)
    out = r.stdout + r.stderr
    good = r.returncode == expect
    if contains and contains not in out:
        good = False
    if not_contains and not_contains in out:
        good = False
    return r, out, good

def repo(name, shared=None, local=None):
    p = tmp / name
    (p / ".postmaster").mkdir(parents=True, exist_ok=True)
    if shared is not None:
        (p / ".postmaster" / "project.toml").write_text(shared, encoding="utf-8")
    if local is not None:
        (p / ".postmaster" / "settings.toml").write_text(local, encoding="utf-8")
    return p

print("positive controls")
empty = repo("empty")
r, out, good = run(str(empty), "has", expect=0, contains="any=no")
ok("a project with no settings reports any=no") if good else fail("a project with no settings reports any=no", out)
r, out, good = run(str(empty), "get", "turnpikes.default", expect=0)
ok("and a missing key prints nothing") if good and out.strip() == "" else fail("and a missing key prints nothing", out)
r, out, good = run(str(empty), "validate", expect=0)
ok("and validate passes with no files") if good else fail("and validate passes with no files", out)

both = repo("both",
    shared='[turnpikes]\ndefault = ["style", "bug"]\n[tracker]\nboard = "widgets"\n[risk]\nsurfaces = ["binds a port"]\n',
    local='[roles]\nworkhorses = ["luna", "mimo"]\n[turnpikes]\ndefault = ["style"]\n')
r, out, good = run(str(both), "has", expect=0, contains="shared=yes")
ok("a folder with both files reports them") if good else fail("a folder with both files reports them", out)
r, out, good = run(str(both), "get", "turnpikes.default", expect=0, contains="turnpikes: style")
ok("local wins over shared for the default turnpikes") if good and "bug" not in out else fail("local wins over shared for the default turnpikes", out)
r, out, good = run(str(both), "get", "tracker.board", expect=0, contains="widgets")
ok("a key only the shared file names is read") if good else fail("a key only the shared file names is read", out)
r, out, good = run(str(both), "get", "roles.workhorses", expect=0, contains="luna")
ok("role assignments are read from the local file") if good else fail("role assignments are read from the local file", out)
r, out, good = run(str(both), "validate", expect=0)
ok("both files pass validate") if good else fail("both files pass validate", out)

written = repo("written")
r, out, good = run(str(written), "write-local", "roles.workhorses=luna,mimo", "turnpikes.default=style,bug",
                   "risk.surfaces=binds a port\nserves a site", expect=0)
_, out2, good2 = run(str(written), "get", "roles.workhorses", expect=0, contains="mimo")
_, out3, good3 = run(str(written), "get", "turnpikes.default", expect=0, contains="turnpikes: style, bug")
ok("write-local writes the keys and get reads them back") if good and good2 and good3 \
    else fail("write-local writes the keys and get reads them back", out + out2 + out3)
gi = written / ".postmaster" / ".gitignore"
ok("write-local creates the folder's .gitignore covering the whole folder") if gi.is_file() and "*" in gi.read_text() \
    else fail("write-local creates the folder's .gitignore covering the whole folder")
r, out, good = run(str(written), "write-local", "roles.reviewers=mimo", expect=0)
_, out2, good2 = run(str(written), "get", "roles.workhorses", expect=0, contains="luna")
ok("a later write keeps the keys it does not name") if good and good2 else fail("a later write keeps the keys it does not name", out2)

roles = repo("roles",
    local='[roles]\nworkhorses = ["luna"]\ncoachman = { harness = "grok", model = "m4.6", effort = "xhigh" }\n')
_, out, good = run(str(roles), "get", "roles.coachman", expect=0, contains="grok/m4.6/xhigh")
ok("a coachman named as a role table prints harness/model/effort") if good else fail("a coachman named as a role table prints harness/model/effort", out)

print("negative controls")
bad_path = repo("badpath", local='[roles]\nworkhorses = ["/home/user/lanes"]\n')
_, out, good = run(str(bad_path), "validate", expect=1, contains="looks like a path")
ok("a path in a lane name is refused") if good else fail("a path in a lane name is refused", out)
bad_key = repo("badkey", shared='[env_file]\nx = "secret"\n')
_, out, good = run(str(bad_key), "validate", expect=1, contains="name no credential")
ok("a key named for a credential or path is refused") if good else fail("a key named for a credential or path is refused", out)
bad_roles = repo("badroles", shared='[roles]\nworkhorses = ["luna"]\n')
_, out, good = run(str(bad_roles), "validate", expect=1, contains="never in the shared file")
ok("a role assignment in the shared file is refused") if good else fail("a role assignment in the shared file is refused", out)
bad_home = repo("badhome", local='[tracker]\nboard = "~/boards/widgets"\n')
_, out, good = run(str(bad_home), "validate", expect=1, contains="looks like a path")
ok("a home path in a tracker binding is refused") if good else fail("a home path in a tracker binding is refused", out)
bad_env = repo("badenv", local='[roles]\ncoachman = { harness = "grok", model = "m", env_file = "~/.x" }\n')
_, out, good = run(str(bad_env), "validate", expect=1, contains="name no credential")
ok("an env_file in a role table is refused") if good else fail("an env_file in a role table is refused", out)
broken = repo("broken", shared='not toml =\n')
_, out, good = run(str(broken), "validate", expect=1, contains="does not parse")
ok("a file that does not parse is refused") if good else fail("a file that does not parse is refused", out)
empty_def = repo("emptydef", shared='[turnpikes]\ndefault = []\n')
_, out, good = run(str(empty_def), "validate", expect=1, contains="non-empty")
ok("an empty default turnpikes list is refused") if good else fail("an empty default turnpikes list is refused", out)
bad_write = repo("badwrite")
_, out, good = run(str(bad_write), "write-local", "roles.workhorses=/home/x", expect=1, contains="looks like a path")
ok("write-local refuses a path before writing") if good else fail("write-local refuses a path before writing", out)

shutil.rmtree(tmp, ignore_errors=True)
print()
if fails == 0:
    print("self-test: all controls behaved")
    sys.exit(0)
print("self-test: %d control(s) misbehaved" % fails)
sys.exit(1)
PY
  exit $?
fi

[ $# -ge 2 ] || { echo "usage: project-settings.sh <repo> has|get <key>|validate|write-local key=value... | --self-test" >&2; exit 1; }
python3 -I - "$@" <<'PY'
import os, re, sys, tomllib

SHARED = ".postmaster/project.toml"
LOCAL = ".postmaster/settings.toml"
FORBIDDEN_KEY = re.compile(
    r"(env[_-]?file|token|secret|password|credential|api[_-]?key|auth[_-]?key"
    r"|private[_-]?key|path|home|dir|directory|filename|file_?path|passwd)", re.I)
PATHLIKE = re.compile(r"^(~|/|\./|\.\./)|[/\\]")
WORD = re.compile(r"^[a-z][a-z0-9-]*$")
LANE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
TURNPIKE_RESERVED = {"default", "none"}
SHARED_TABLES = {"turnpikes", "tracker", "risk", "checks"}
LOCAL_TABLES = {"turnpikes", "tracker", "risk", "roles"}
ROLE_NAME_KEYS = {"roles.workhorses", "roles.reviewers"}
ROLE_SPEC_KEYS = {"roles.coachman", "roles.coachman_fallback"}
LENS_PREFIX = "roles.lens_reviewers."


def die(msg):
    print("project-settings: " + msg, file=sys.stderr)
    sys.exit(1)


def refuse_key(path, key):
    if FORBIDDEN_KEY.search(key):
        die("%s names %r: a project's settings name no credential and no path on the machine"
            % (path, key))


def refuse_pathlike(path, key, value):
    if not isinstance(value, str):
        return
    if key.startswith("risk.") or key.startswith("checks."):
        return  # prose or a shell command the project runs
    if PATHLIKE.search(value.strip()):
        die("%s: %s is %r, which looks like a path on the machine; a name field names no path"
            % (path, key, value))


def load(path):
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        return {}
    except tomllib.TOMLDecodeError as e:
        die("%s does not parse: %s" % (path, e))
    except OSError as e:
        die("cannot read %s: %s" % (path, e.strerror))


def flatten(data, prefix=""):
    """Dotted view. A role spec or lens table stays one value under its own key."""
    out = {}
    for k, v in data.items():
        key = prefix + k
        if not isinstance(v, dict):
            out[key] = v
            continue
        if prefix == "roles." and k in ("coachman", "coachman_fallback", "lens_reviewers"):
            out[key] = v
            continue
        out.update(flatten(v, key + "."))
    return out


def check_shape(path, flat, allowed_tables, is_shared):
    # Also accept [roles.lens_reviewers] <lens> = [...]
    expanded = dict(flat)
    if "roles.lens_reviewers" in expanded and isinstance(expanded["roles.lens_reviewers"], dict):
        lens_table = expanded.pop("roles.lens_reviewers")
        for lens, lanes in lens_table.items():
            expanded["roles.lens_reviewers." + lens] = lanes
    for key, val in expanded.items():
        top = key.split(".", 1)[0]
        refuse_key(path, key)
        if top == "roles" or key.startswith("roles."):
            if is_shared:
                die("%s: roles are a person's choice on a machine, never in the shared file" % path)
            # fall through to the role shape checks below
        elif top not in allowed_tables:
            die("%s: [%s] is not one of %s" % (path, top, ", ".join(sorted(allowed_tables))))
        if top == "checks":
            continue
        if key == "turnpikes.default":
            if not isinstance(val, list) or not val:
                die("%s: turnpikes.default must be a non-empty list of turnpike names" % path)
            for name in val:
                if not isinstance(name, str) or not WORD.match(name) or name in TURNPIKE_RESERVED:
                    die("%s: turnpikes.default holds %r, which is not a turnpike name" % (path, name))
                refuse_pathlike(path, key, name)
        elif key.startswith("tracker."):
            if key not in ("tracker.board", "tracker.workspace", "tracker.team"):
                die("%s: %s is not tracker.board, tracker.workspace or tracker.team" % (path, key))
            if not isinstance(val, str) or not val.strip():
                die("%s: %s must be a non-empty name" % (path, key))
            refuse_pathlike(path, key, val)
        elif key == "risk.surfaces":
            if isinstance(val, str):
                continue
            if not isinstance(val, list) or not all(isinstance(x, str) and x.strip() for x in val):
                die("%s: risk.surfaces must be a string or a list of strings" % path)
        elif key == "roles" or key.startswith("roles."):
            if is_shared:
                die("%s: roles are a person's choice on a machine, never in the shared file" % path)
            if key in ROLE_NAME_KEYS:
                if not isinstance(val, list) or not val:
                    die("%s: %s must be a non-empty list of lane names" % (path, key))
                for lane in val:
                    if not isinstance(lane, str) or not lane.strip():
                        die("%s: %s holds an empty lane name" % (path, key))
                    refuse_pathlike(path, key, lane)
                    if not LANE.match(lane):
                        die("%s: %s holds %r, which is not a lane name" % (path, key, lane))
            elif key in ROLE_SPEC_KEYS:
                if isinstance(val, dict):
                    unknown = set(val) - {"harness", "model", "effort"}
                    if unknown:
                        die("%s: %s holds %s; a project's settings name no credential and no path on the machine"
                            % (path, key, ", ".join(sorted(unknown))))
                    for field, item in val.items():
                        if not isinstance(item, str) or not item.strip():
                            die("%s: %s.%s must be a non-empty name" % (path, key, field))
                        refuse_pathlike(path, key + "." + field, item)
                elif isinstance(val, str) and val.count("/") in (1, 2) and all(val.split("/")):
                    refuse_pathlike(path, key, val)
                else:
                    die("%s: %s must be harness/model[/effort] or a table of those names" % (path, key))
            elif key.startswith(LENS_PREFIX):
                lens = key[len(LENS_PREFIX):]
                if not WORD.match(lens):
                    die("%s: %s is not a lens name" % (path, key))
                if not isinstance(val, list) or not val:
                    die("%s: %s must be a non-empty list of lane names" % (path, key))
                for lane in val:
                    if not isinstance(lane, str) or not lane.strip():
                        die("%s: %s holds an empty lane name" % (path, key))
                    refuse_pathlike(path, key, lane)
                    if not LANE.match(lane):
                        die("%s: %s holds %r, which is not a lane name" % (path, key, lane))
            else:
                die("%s: %s is not a role assignment" % (path, key))
        else:
            die("%s: %s is not a settings key" % (path, key))


def read_settings(repo):
    shared_path = os.path.join(repo, SHARED)
    local_path = os.path.join(repo, LOCAL)
    shared = load(shared_path)
    local = load(local_path)
    sf = flatten(shared) if shared else {}
    lf = flatten(local) if local else {}
    if shared:
        check_shape(shared_path, sf, SHARED_TABLES, is_shared=True)
    if local:
        check_shape(local_path, lf, LOCAL_TABLES, is_shared=False)
    return shared_path, local_path, shared, local, sf, lf


def merged(sf, lf):
    out = dict(sf)
    out.update(lf)
    return out


def spec_to_str(val):
    if isinstance(val, dict):
        parts = [val.get("harness", ""), val.get("model", "")]
        if val.get("effort"):
            parts.append(val["effort"])
        return "/".join(parts)
    return val


def emit(value, key):
    if value is None:
        return
    if key == "risk.surfaces":
        items = [value] if isinstance(value, str) else list(value)
        for item in items:
            print(item)
        return
    if key == "turnpikes.default":
        print("turnpikes: " + ", ".join(list(value)))
        return
    if key in ROLE_SPEC_KEYS:
        print(spec_to_str(value))
        return
    if isinstance(value, list):
        for item in value:
            print(item)
        return
    print(value)


def toml_str(s):
    return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')


def toml_list(items):
    return "[" + ", ".join(toml_str(i) for i in items) + "]"


def set_path(data, parts, value):
    cur = data
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


def render(data):
    lines = [
        "# <project>/.postmaster/settings.toml",
        "# This person's choices on this machine. Never committed. Written by",
        "# scripts/project-settings.sh; the shape is settings.example.toml.",
        "",
    ]
    roles = data.get("roles")
    if isinstance(roles, dict):
        lines.append("[roles]")
        for k in ("workhorses", "reviewers"):
            if k in roles and isinstance(roles[k], list):
                lines.append("%s = %s" % (k, toml_list(roles[k])))
        for k in ("coachman", "coachman_fallback"):
            if k not in roles:
                continue
            v = roles[k]
            if isinstance(v, dict):
                inner = ", ".join("%s = %s" % (f, toml_str(v[f])) for f in ("harness", "model", "effort") if f in v)
                lines.append("%s = { %s }" % (k, inner))
            else:
                lines.append("%s = %s" % (k, toml_str(v)))
        lines.append("")
        lens = roles.get("lens_reviewers")
        if isinstance(lens, dict):
            lines.append("[roles.lens_reviewers]")
            for name, lanes in lens.items():
                if isinstance(lanes, list):
                    lines.append("%s = %s" % (name, toml_list(lanes)))
            lines.append("")
    for top in ("turnpikes", "tracker", "risk"):
        body = data.get(top)
        if not isinstance(body, dict):
            continue
        lines.append("[%s]" % top)
        for k, v in body.items():
            if isinstance(v, list):
                lines.append("%s = %s" % (k, toml_list(v)))
            else:
                lines.append("%s = %s" % (k, toml_str(v)))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_local(repo, assignments):
    _, local_path, _, local, _, _ = read_settings(repo)
    folder = os.path.join(repo, ".postmaster")
    os.makedirs(folder, exist_ok=True)
    gi = os.path.join(folder, ".gitignore")
    if not os.path.isfile(gi):
        with open(gi, "w", encoding="utf-8") as f:
            f.write(
                "# .postmaster/ holds this instance's settings and every run's full record.\n"
                "# Nothing in it is committed by default. To share what a run requires of\n"
                "# everyone, commit project.toml alone with: git add -f .postmaster/project.toml\n"
                "*\n"
            )
    data = dict(local)
    for item in assignments:
        if "=" not in item:
            die("write-local takes key=value, not %r" % item)
        key, val = item.split("=", 1)
        key, val = key.strip(), val.strip()
        refuse_key(LOCAL, key)
        if key == "turnpikes.default":
            set_path(data, ["turnpikes", "default"], [p.strip() for p in val.split(",") if p.strip()])
        elif key.startswith("tracker.") and key in ("tracker.board", "tracker.workspace", "tracker.team"):
            set_path(data, ["tracker", key.split(".", 1)[1]], val)
        elif key == "risk.surfaces":
            set_path(data, ["risk", "surfaces"], [p for p in val.split("\n") if p.strip()])
        elif key in ("roles.workhorses", "roles.reviewers"):
            set_path(data, ["roles", key.split(".", 1)[1]], [p.strip() for p in val.split(",") if p.strip()])
        elif key in ROLE_SPEC_KEYS:
            parts = val.split("/")
            if not (2 <= len(parts) <= 3) or not all(parts):
                die("%s must be harness/model[/effort], not %r" % (key, val))
            spec = {"harness": parts[0], "model": parts[1]}
            if len(parts) == 3:
                spec["effort"] = parts[2]
            set_path(data, ["roles", key.split(".", 1)[1]], spec)
        elif key.startswith(LENS_PREFIX):
            set_path(data, ["roles", "lens_reviewers", key[len(LENS_PREFIX):]],
                     [p.strip() for p in val.split(",") if p.strip()])
        else:
            die("%s is not a settings key this script writes" % key)
    text = render(data)
    tmp = local_path + ".new"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        local2 = load(tmp)
        check_shape(LOCAL, flatten(local2), LOCAL_TABLES, is_shared=False)
    except SystemExit:
        os.unlink(tmp)
        raise
    os.replace(tmp, local_path)


def main(argv):
    if len(argv) < 2:
        die("usage: project-settings.sh <repo> has|get <key>|validate|write-local key=value...")
    repo, cmd = argv[0], argv[1]
    if not os.path.isdir(repo):
        die("no such repo: %s" % repo)
    if cmd == "has":
        if len(argv) != 2:
            die("usage: project-settings.sh <repo> has")
        shared = os.path.isfile(os.path.join(repo, SHARED))
        local = os.path.isfile(os.path.join(repo, LOCAL))
        print("shared=%s" % ("yes" if shared else "no"))
        print("local=%s" % ("yes" if local else "no"))
        print("any=%s" % ("yes" if shared or local else "no"))
        return 0
    if cmd == "validate":
        if len(argv) != 2:
            die("usage: project-settings.sh <repo> validate")
        read_settings(repo)
        return 0
    if cmd == "get":
        if len(argv) != 3:
            die("usage: project-settings.sh <repo> get <key>")
        _, _, _, _, sf, lf = read_settings(repo)
        key = argv[2]
        m = merged(sf, lf)
        if key.startswith(LENS_PREFIX) and key not in m:
            lens_table = m.get("roles.lens_reviewers")
            if isinstance(lens_table, dict):
                m[key] = lens_table.get(key[len(LENS_PREFIX):])
        if key in ROLE_SPEC_KEYS and key not in m:
            # flatten keeps a role spec table whole; already present
            pass
        emit(m.get(key), key)
        return 0
    if cmd == "write-local":
        if len(argv) < 3:
            die("usage: project-settings.sh <repo> write-local key=value...")
        write_local(repo, argv[2:])
        return 0
    die("unknown command: %s" % cmd)


sys.exit(main(sys.argv[1:]))
PY
exit $?
