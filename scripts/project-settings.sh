#!/usr/bin/env bash
# Read, validate and write a project's optional shared and local settings.
#
#   project-settings.sh inspect <repo>       resolved facts and their source as JSON
#   project-settings.sh report <repo>        compact key=value source report
#   project-settings.sh effective <repo> [<machine-config>]
#                                             machine config with local role choices applied
#   project-settings.sh ensure <repo>         create .postmaster/.gitignore, no settings
#   project-settings.sh write <repo> project|local [<toml-file>]
#                                             validate, then write the agreed settings
#   project-settings.sh --self-test
#
# Shared settings are .postmaster/project.toml. Local settings are the ignored
# .postmaster/settings.toml. Missing files are normal. Project files may not name machine paths
# or credentials. The only machine data accepted by a local role choice is a name already in the
# machine config; harnesses, models, env files and other machine details stay there.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

python3 - "$HERE" "$@" <<'PY'
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import tomllib

here = pathlib.Path(sys.argv[1]).resolve()
args = sys.argv[2:]

def die(message, code=1):
    print("project-settings: " + message, file=sys.stderr)
    raise SystemExit(code)

def table(value, where):
    if not isinstance(value, dict):
        die("%s must be a table" % where)
    return value

def project_root(raw):
    p = pathlib.Path(raw).expanduser().resolve()
    if not p.is_dir():
        die("no such project directory: %s" % raw)
    return p

def settings_dir(repo):
    p = repo / ".postmaster"
    if p.is_symlink():
        die("%s must be a directory inside the project, not a symlink" % p)
    if p.exists() and not p.is_dir():
        die("%s is not a directory" % p)
    return p

BAD_KEY = re.compile(r"(?i)(?:secret|credential|password|token|env[_-]?file|api[_-]?key|private[_-]?key|auth[_-]?token)")
ABS_PATH = re.compile(r"(?:^|[\s=\"'(])/(?!/)(?:[^\s\"']+)")
HOME_PATH = re.compile(r"(?:^|[\s=\"'(])(?:~(?:/|$)|\$HOME(?:/|$)|\$USERPROFILE(?:\\|/|$)|%USERPROFILE%(?:\\|/|$))")
PARENT_PATH = re.compile(r"(?:^|[/\\])\.\.(?:[/\\]|$)")
WINDOWS_PATH = re.compile(r"(?:^|[\s=\"'(])[A-Za-z]:[\\/]")
UNC_PATH = re.compile(r"(?:^|[\s=\"'(])(?:\\\\[^\\\s]+\\|//[^/\s]+/)")
FILE_URL_PATH = re.compile(r"(?i)\bfile:(?:/|\\)+[^\s\"']*")
ENV_PATH = re.compile(
    r"(?i)(?<![A-Za-z0-9_])(?:"
    r"\$(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|PWD|PATH|TMP|TEMP|TMPDIR|[A-Z0-9_]*(?:PATH|_DIR|_ROOT|_HOME))"
    r"|%(?:USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TMP|TEMP)%)"
)
ASSIGNMENT_SECRET = re.compile(r"(?i)\b[A-Z0-9_]*(?:API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|PASSWORD|SECRET|CREDENTIAL)\s*=\s*[^\s,;]+")
TOKEN_VALUE = re.compile(r"(?i)\b(?:gh[pousr]_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})\b")
NAMED_CREDENTIAL = re.compile(r"\b[A-Z][A-Z0-9_]*(?:API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|TOKEN|PASSWORD|SECRET|CREDENTIALS?)[A-Z0-9_]*\b")
MACHINE_NAMES = {name.strip().lower() for name in (socket.gethostname(), os.environ.get("COMPUTERNAME", "")) if name.strip()}
MACHINE_NAMES |= {name.split(".", 1)[0] for name in list(MACHINE_NAMES) if name}

def names_machine(value):
    for name in MACHINE_NAMES:
        if len(name) >= 3 and re.search(r"(?<![A-Za-z0-9_.-])" + re.escape(name) + r"(?![A-Za-z0-9_.-])", value, re.I):
            return True
    return False

def scan_machine_data(value, location):
    if isinstance(value, dict):
        for key, item in value.items():
            if BAD_KEY.search(str(key)):
                die("%s names a credential or machine file field: %s" % (location, key))
            scan_machine_data(item, location + "." + str(key))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            scan_machine_data(item, "%s[%d]" % (location, i))
    elif isinstance(value, str):
        if (ABS_PATH.search(value) or HOME_PATH.search(value) or PARENT_PATH.search(value)
                or WINDOWS_PATH.search(value) or UNC_PATH.search(value) or FILE_URL_PATH.search(value)
                or ENV_PATH.search(value) or names_machine(value)):
            die("%s names a filesystem path on a machine" % location)
        if (ASSIGNMENT_SECRET.search(value) or TOKEN_VALUE.search(value) or NAMED_CREDENTIAL.search(value)
                or "-----BEGIN PRIVATE KEY-----" in value.upper()):
            die("%s contains a credential value" % location)

def read_toml(path, label):
    if path.is_symlink():
        die("%s must not be a symlink" % path)
    if not path.exists():
        return {}, False
    if not path.is_file():
        die("%s is not a regular file" % path)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as e:
        die("%s does not parse: %s" % (label, e))
    scan_machine_data(data, label)
    return data, True

def known_turnpikes():
    env = os.environ.copy()
    env.pop("POSTMASTER_PROJECT", None)
    r = subprocess.run([str(here / "turnpikes.sh"), "--list"], capture_output=True, text=True, env=env)
    if r.returncode:
        die("cannot read the turnpike list: %s" % (r.stderr.strip() or r.stdout.strip()))
    return {line.split()[0] for line in r.stdout.splitlines() if line.split()}

def nonblank_string(value, where):
    if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
        die("%s must be a non-empty string without control characters" % where)
    return value.strip()

def name_list(value, where, allow_empty=False):
    if not isinstance(value, list) or (not value and not allow_empty) or not all(isinstance(x, str) and x.strip() for x in value):
        die("%s must be a %slist of names" % (where, "" if allow_empty else "non-empty "))
    names = [x.strip() for x in value]
    if len(set(names)) != len(names):
        die("%s repeats a name" % where)
    for name in names:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            die("%s has an invalid name: %s" % (where, name))
    return names

def validate_common(data, label, local):
    allowed = {"project", "tracker"} | ({"roles"} if local else {"checks"})
    unknown = sorted(set(data) - allowed)
    if unknown:
        die("%s has unsupported table or key: %s" % (label, unknown[0]))
    project = table(data.get("project", {}), label + ".project")
    unknown = sorted(set(project) - {"default_turnpikes", "risk_surfaces"})
    if unknown:
        die("%s.project has unsupported key: %s" % (label, unknown[0]))
    if "default_turnpikes" in project:
        names = name_list(project["default_turnpikes"], label + ".project.default_turnpikes", allow_empty=True)
        known = known_turnpikes()
        bad = [n for n in names if n not in known]
        if bad:
            die("%s.project.default_turnpikes names an unknown turnpike: %s" % (label, bad[0]))
        project["default_turnpikes"] = names
    if "risk_surfaces" in project:
        surfaces = project["risk_surfaces"]
        if isinstance(surfaces, str):
            project["risk_surfaces"] = nonblank_string(surfaces, label + ".project.risk_surfaces")
        elif isinstance(surfaces, list) and surfaces and all(isinstance(x, str) and x.strip() for x in surfaces):
            project["risk_surfaces"] = [x.strip() for x in surfaces]
        else:
            die("%s.project.risk_surfaces must be non-empty text or a list of non-empty strings" % label)
    tracker = table(data.get("tracker", {}), label + ".tracker")
    unknown = sorted(set(tracker) - {"binding"})
    if unknown:
        die("%s.tracker has unsupported key: %s" % (label, unknown[0]))
    if "binding" in tracker:
        binding = nonblank_string(tracker["binding"], label + ".tracker.binding")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]*", binding):
            die("%s.tracker.binding must be a tracker name, not a path or URL" % label)
        tracker["binding"] = binding
    if not local and "checks" in data:
        checks = table(data["checks"], label + ".checks")
        for name, spec in checks.items():
            if not re.fullmatch(r"[a-z][a-z0-9-]*", name):
                die("%s.checks has an invalid check name: %s" % (label, name))
            table(spec, label + ".checks." + name)
    if local:
        roles = table(data.get("roles", {}), label + ".roles")
        unknown = sorted(set(roles) - {"workhorses", "reviewers", "coachman", "lens_reviewers"})
        if unknown:
            die("%s.roles has unsupported key: %s" % (label, unknown[0]))
        for key in ("workhorses", "reviewers"):
            if key in roles:
                roles[key] = name_list(roles[key], label + ".roles." + key)
        if "coachman" in roles:
            coachman = nonblank_string(roles["coachman"], label + ".roles.coachman")
            if coachman not in ("coachman", "coachman_fallback"):
                die(label + ".roles.coachman must name coachman or coachman_fallback")
            roles["coachman"] = coachman
        if "lens_reviewers" in roles:
            lenses = table(roles["lens_reviewers"], label + ".roles.lens_reviewers")
            allowed_lenses = {"style", "bug", "security"}
            for lens, names in list(lenses.items()):
                if lens not in allowed_lenses:
                    die(label + ".roles.lens_reviewers names an unknown lens: %s" % lens)
                lenses[lens] = name_list(names, label + ".roles.lens_reviewers." + lens)
    return data

def load_profiles(repo):
    d = settings_dir(repo)
    shared, has_shared = read_toml(d / "project.toml", "shared project settings")
    local, has_local = read_toml(d / "settings.toml", "local project settings")
    validate_common(shared, "shared project settings", False)
    validate_common(local, "local project settings", True)
    return shared, local, has_shared, has_local

def merged_profile(shared, local, has_shared, has_local):
    out = {"shared_present": has_shared, "local_present": has_local, "project": {}, "tracker": {}, "roles": {}, "sources": {}}
    for field in ("default_turnpikes", "risk_surfaces"):
        if field in shared.get("project", {}):
            out["project"][field] = shared["project"][field]
            out["sources"]["project." + field] = "shared"
        if field in local.get("project", {}):
            out["project"][field] = local["project"][field]
            out["sources"]["project." + field] = "local"
        if field not in out["project"]:
            out["sources"]["project." + field] = "discovery"
    if "binding" in shared.get("tracker", {}):
        out["tracker"]["binding"] = shared["tracker"]["binding"]
        out["sources"]["tracker.binding"] = "shared"
    if "binding" in local.get("tracker", {}):
        out["tracker"]["binding"] = local["tracker"]["binding"]
        out["sources"]["tracker.binding"] = "local"
    if "binding" not in out["tracker"]:
        out["sources"]["tracker.binding"] = "discovery"
    out["roles"] = local.get("roles", {})
    out["sources"]["roles"] = "local" if out["roles"] else "machine"
    return out

def load_machine(path):
    if path == "-":
        try:
            return json.load(sys.stdin)
        except (ValueError, OSError) as e:
            die("machine config JSON does not parse: %s" % e)
    p = pathlib.Path(path).expanduser()
    try:
        return tomllib.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as e:
        die("machine config %s does not parse: %s" % (path, e))

def effective_config(repo, machine, profile_pair=None):
    cfg = json.loads(json.dumps(machine))
    if profile_pair is None:
        shared, local, hs, hl = load_profiles(repo)
    else:
        shared, local = profile_pair
        hs, hl = bool(shared), bool(local)
    profile = merged_profile(shared, local, hs, hl)
    roles = profile["roles"]
    if not roles:
        return cfg
    lanes = table(cfg.get("lanes", {}), "machine config [lanes]")
    team = table(cfg.setdefault("team", {}), "machine config [team]")
    for key in ("workhorses", "reviewers"):
        if key in roles:
            unknown = [name for name in roles[key] if name not in lanes]
            if unknown:
                die("local roles.%s names %s, which is not a machine lane" % (key, unknown[0]))
            team[key] = roles[key]
    if "coachman" in roles:
        source = roles["coachman"]
        coachman = team.get(source)
        if not isinstance(coachman, dict) or not coachman.get("harness") or not coachman.get("model"):
            die("local roles.coachman selects %s, but the machine config does not define it" % source)
        team["coachman"] = coachman
    if "lens_reviewers" in roles:
        own = table(team.get("lens_reviewers", {}), "machine config [team.lens_reviewers]")
        for lens, names in roles["lens_reviewers"].items():
            unknown = [name for name in names if name not in lanes]
            if unknown:
                die("local roles.lens_reviewers.%s names %s, which is not a machine lane" % (lens, unknown[0]))
            own[lens] = names
        team["lens_reviewers"] = own
    return cfg

def inspect(repo):
    shared, local, hs, hl = load_profiles(repo)
    profile = merged_profile(shared, local, hs, hl)
    profile["shared_file"] = ".postmaster/project.toml" if hs else None
    profile["local_file"] = ".postmaster/settings.toml" if hl else None
    return profile

def write_profile(repo, layer, source):
    if layer not in ("project", "local"):
        die("write layer must be project or local")
    d = settings_dir(repo)
    name = "project.toml" if layer == "project" else "settings.toml"
    dest = d / name
    if dest.is_symlink():
        die("%s must not be a symlink" % dest)
    try:
        raw = pathlib.Path(source).expanduser().read_text(encoding="utf-8") if source != "-" else sys.stdin.read()
    except (OSError, UnicodeError) as e:
        die("cannot read settings input: %s" % e)
    try:
        candidate = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as e:
        die("settings input does not parse: %s" % e)
    scan_machine_data(candidate, "settings input")
    validate_common(candidate, "settings input", layer == "local")
    # Validate the complete resulting pair before changing either file.
    old_shared, old_local, _, _ = load_profiles(repo)
    if layer == "project":
        old_shared = candidate
    else:
        old_local = candidate
    validate_common(old_shared, "shared project settings", False)
    validate_common(old_local, "local project settings", True)
    if old_local.get("roles"):
        config_path = pathlib.Path(os.environ.get("POSTMASTER_CONFIG", str(pathlib.Path.home() / ".postmaster/config.toml"))).expanduser()
        if not config_path.is_file():
            die("local role assignments need the machine config at %s" % config_path)
        effective_config(repo, load_machine(str(config_path)), (old_shared, old_local))
    d.mkdir(parents=True, exist_ok=True)
    ensure_ignore(repo, quiet=True)
    if dest.exists() and not dest.is_file():
        die("%s is not a regular file" % dest)
    fd, tmp_name = tempfile.mkstemp(prefix="." + name + ".", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(raw if raw.endswith("\n") else raw + "\n")
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp_name, dest)
    except Exception:
        try: os.unlink(tmp_name)
        except OSError: pass
        raise
    print("project-settings: wrote %s" % dest)

def ensure_ignore(repo, quiet=False):
    d = settings_dir(repo)
    d.mkdir(parents=True, exist_ok=True)
    ignore = d / ".gitignore"
    if ignore.is_symlink():
        die("%s must not be a symlink" % ignore)
    if ignore.exists() and not ignore.is_file():
        die("%s is not a regular file" % ignore)
    existing = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    rule = "*\n!.gitignore\n"
    if not existing.endswith(rule):
        prefix = existing
        if prefix and not prefix.endswith("\n"):
            prefix += "\n"
        ignore.write_text(prefix + rule, encoding="utf-8")
    if not quiet:
        print("project-settings: ensured %s" % ignore)

def report(repo):
    p = inspect(repo)
    print("project_shared=" + ("yes" if p["shared_present"] else "no"))
    print("project_local=" + ("yes" if p["local_present"] else "no"))
    for key in ("project.default_turnpikes", "tracker.binding", "project.risk_surfaces", "roles"):
        print("project_source." + key + "=" + p["sources"][key])
    if "default_turnpikes" in p["project"]:
        print("project_default_turnpikes=" + ", ".join(p["project"]["default_turnpikes"]))
    if "binding" in p["tracker"]:
        print("tracker_binding=" + p["tracker"]["binding"])

def self_test():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="project-settings-test-"))
    try:
        repo = tmp / "repo"; repo.mkdir()
        machine = tmp / "config.toml"
        machine.write_text('''[lanes.alpha]\nharness="codex"\nmodel="a"\n[lanes.beta]\nharness="claude"\nmodel="b"\n[team]\nworkhorses=["alpha","beta"]\nreviewers=["alpha","beta"]\ncoachman={harness="grok",model="coach"}\ncoachman_fallback={harness="pi",model="backup"}\n''', encoding="utf-8")
        os.environ["POSTMASTER_CONFIG"] = str(machine)
        missing = inspect(repo)
        assert not missing["shared_present"] and not missing["local_present"]
        assert missing["sources"]["project.default_turnpikes"] == "discovery"
        print("  ok   missing profiles are normal and retain discovery defaults")
        ensure_ignore(repo)
        assert (repo / ".postmaster" / ".gitignore").read_text().endswith("*\n!.gitignore\n")
        assert not (repo / ".postmaster" / "settings.toml").exists()
        print("  ok   ensure creates the folder ignore without prompting for settings")
        (repo / ".postmaster" / ".gitignore").write_text("# existing local rules\n!keep-me\n", encoding="utf-8")
        ensure_ignore(repo)
        assert (repo / ".postmaster" / ".gitignore").read_text().endswith("*\n!.gitignore\n")
        print("  ok   ensure completes an existing ignore file without discarding its rules")
        candidate = tmp / "shared.toml"
        candidate.write_text('''[project]\ndefault_turnpikes=["bug"]\nrisk_surfaces="the API and subprocess boundary"\n[tracker]\nbinding="Team board"\n''', encoding="utf-8")
        write_profile(repo, "project", str(candidate))
        shared = inspect(repo)
        assert shared["shared_present"] and shared["project"]["default_turnpikes"] == ["bug"]
        assert shared["sources"]["project.default_turnpikes"] == "shared"
        assert (repo / ".postmaster" / ".gitignore").read_text().endswith("*\n!.gitignore\n")
        guarded = subprocess.run(
            ["timeout", "10", str(here / "project-settings.sh"), "inspect", str(repo)],
            capture_output=True, text=True,
            env={**os.environ, "POSTMASTER_PROJECT": str(repo)},
        )
        assert guarded.returncode == 0, "inspect recursed or failed with POSTMASTER_PROJECT set: %s" % guarded.stderr
        print("  ok   inspect stays bounded when POSTMASTER_PROJECT is inherited")
        assert subprocess.run(["git", "init", "-q", str(repo)]).returncode == 0
        ignored = subprocess.run(["git", "-C", str(repo), "check-ignore", ".postmaster/project.toml"], capture_output=True)
        assert ignored.returncode == 0
        postmaster = repo / ".postmaster"
        (postmaster / "settings.toml").write_text("[roles]\nworkhorses=['alpha']\n", encoding="utf-8")
        (postmaster / "runs" / "T-1").mkdir(parents=True)
        (postmaster / "runs" / "T-1" / "card.md").write_text("private run text\n", encoding="utf-8")
        for ignored_path in (".postmaster/settings.toml", ".postmaster/runs/T-1/card.md"):
            result = subprocess.run(["git", "-C", str(repo), "check-ignore", ignored_path], capture_output=True)
            assert result.returncode == 0, "not ignored by the project folder: " + ignored_path
        print("  ok   the shared file writes, and .postmaster ignores it by default")
        empty_repo = tmp / "empty-default"; empty_repo.mkdir()
        empty_settings = tmp / "empty-default.toml"
        empty_settings.write_text('[project]\ndefault_turnpikes = []\n', encoding="utf-8")
        write_profile(empty_repo, "project", str(empty_settings))
        assert inspect(empty_repo)["project"]["default_turnpikes"] == []
        print("  ok   a project may define an empty default turnpike set")
        local = tmp / "local.toml"
        local.write_text('''[project]\ndefault_turnpikes=["style"]\n[roles]\nworkhorses=["alpha","beta"]\ncoachman="coachman_fallback"\n''', encoding="utf-8")
        write_profile(repo, "local", str(local))
        result = inspect(repo)
        assert result["sources"]["project.default_turnpikes"] == "local"
        assert result["sources"]["roles"] == "local"
        effective = effective_config(repo, load_machine(str(machine)))
        assert effective["team"]["coachman"]["model"] == "backup"
        assert effective["team"]["workhorses"] == ["alpha", "beta"]
        assert effective["team"]["postmaster"] if "postmaster" in effective["team"] else True
        print("  ok   local choices override shared defaults and select machine-defined roles")
        for label, contents in (
            ("shared roles", '[roles]\nworkhorses=["alpha"]\n'),
            ("absolute path", '[project]\nrisk_surfaces="reads /home/alex/secret"\n'),
            ("home path", '[tracker]\nbinding="~/.config/key"\n'),
            ("environment path", '[project]\nrisk_surfaces="$XDG_CONFIG_HOME/service"\n'),
            ("UNC path", '[project]\nrisk_surfaces="uses //server/share"\n'),
            ("file URL path", '[project]\nrisk_surfaces="reads file:///etc/service"\n'),
            ("single-slash file URL path", '[project]\nrisk_surfaces="reads file:/etc/service"\n'),
            ("machine name", '[project]\nrisk_surfaces="runs on %s"\n' % socket.gethostname()),
            ("credential field", '[tracker]\nenv_file="credential.env"\n'),
            ("credential name", '[project]\nrisk_surfaces="reads PLANE_API_KEY"\n'),
            ("unknown role", '[roles]\nworkhorses=["ghost"]\n'),
        ):
            bad = tmp / "bad.toml"; bad.write_text(contents, encoding="utf-8")
            try:
                if label == "shared roles":
                    validate_common(tomllib.loads(contents), "shared project settings", False)
                elif label not in ("unknown role", "shared roles"):
                    scan_machine_data(tomllib.loads(contents), "settings input")
                    validate_common(tomllib.loads(contents), "settings input", True)
                else:
                    write_profile(repo, "local", str(bad)); effective_config(repo, load_machine(str(machine)))
            except SystemExit:
                print("  ok   rejects " + label)
            else:
                raise AssertionError("accepted " + label)
        print("self-test: all controls behaved")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if args == ["--self-test"]:
    self_test(); raise SystemExit(0)
if not args:
    die("usage: project-settings.sh inspect|report <repo> | effective <repo> [<machine-config>] | ensure <repo> | write <repo> project|local [<toml-file>] | --self-test")
cmd = args[0]
if cmd == "ensure" and len(args) == 2:
    ensure_ignore(project_root(args[1]))
elif cmd in ("inspect", "report") and len(args) == 2:
    repo = project_root(args[1])
    if cmd == "report": report(repo)
    else: print(json.dumps(inspect(repo), sort_keys=True))
elif cmd == "effective" and len(args) in (2, 3):
    repo = project_root(args[1])
    config_path = args[2] if len(args) == 3 else os.environ.get("POSTMASTER_CONFIG", str(pathlib.Path.home() / ".postmaster/config.toml"))
    print(json.dumps(effective_config(repo, load_machine(config_path)), sort_keys=True))
elif cmd == "write" and len(args) in (3, 4):
    write_profile(project_root(args[1]), args[2], args[3] if len(args) == 4 else "-")
else:
    die("usage: project-settings.sh inspect|report <repo> | effective <repo> [<machine-config>] | ensure <repo> | write <repo> project|local [<toml-file>] | --self-test")
PY
