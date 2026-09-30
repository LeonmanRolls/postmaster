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
# Risk surfaces are prose and check commands are shell the project runs, so those values may
# mention a path or a secret's name; a name field (tracker binding, lane, turnpike) may not.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

# A caller may be in the target repo, so do not import modules from that repo by accident.
python3 -I - "$HERE" "$@" <<'PY'
import json
import os
import pathlib
import re
import shutil
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

BAD_KEY = re.compile(r"(?i)(?:secret|credential|password|token|key[_-]?file|env[_-]?file|api[_-]?key|private[_-]?key|auth[_-]?token)")
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
TOKEN_VALUE = re.compile(r"(?i)\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[a-z]-[A-Za-z0-9-]{8,})\b")
CRED_WORD = r"(?:API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|TOKEN|PASSWORD|SECRET|CREDENTIALS?|KEY[_-]?FILE|ENV[_-]?FILE|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)"
# A credential word in identifier position: bounded by non-letters on each side, or
# split from a lowercase run by a camelCase step on either side (githubApiKey,
# secretKey). The boundary tests are case-sensitive while the word itself matches
# in any case. Glued lowercase ("secretary", "mysecret") is indistinguishable
# from a natural word and stays out.
NAMED_CREDENTIAL = re.compile(
    r"(?:(?<![A-Za-z])|(?<=[a-z])(?=[A-Z]))" + r"(?i:" + CRED_WORD + r")"
    + r"(?:(?![A-Za-z])|(?<=[a-z])(?=[A-Z]))")
# Identifier shape: a separator, a digit, a camelCase step, or all caps.
IDENTIFIER_SHAPED = re.compile(r"[_-]|[0-9]|[a-z][A-Z]|^[A-Z0-9_]+$")

def credential_name_in(value):
    words = value.split()
    if len(words) > 1:
        # Phrasing: only identifier-shaped words can name a credential, so
        # "Secret Santa" passes while "Migrate api_key usage" does not.
        return any(IDENTIFIER_SHAPED.search(word) and NAMED_CREDENTIAL.search(word) for word in words)
    # One token: any credential word in identifier position names one.
    return bool(NAMED_CREDENTIAL.search(value.strip()))
def scan_machine_data(value, location, path=()):
    if isinstance(value, dict):
        for key, item in value.items():
            # Check names are validated by shape below, not scanned: a check called
            # secret-scan names no credential field.
            if path[:1] != ("checks",) and BAD_KEY.search(str(key)):
                die("%s names a credential or machine file field: %s" % (location, key))
            scan_machine_data(item, location + "." + str(key), path + (str(key),))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            scan_machine_data(item, "%s[%d]" % (location, i), path)
    elif isinstance(value, str):
        if path[:1] == ("checks",) or path[:2] == ("project", "risk_surfaces"):
            return  # prose about the project and shell it runs: shaped, not scanned
        if (ABS_PATH.search(value) or HOME_PATH.search(value) or PARENT_PATH.search(value)
                or WINDOWS_PATH.search(value) or UNC_PATH.search(value) or FILE_URL_PATH.search(value)
                or ENV_PATH.search(value)):
            die("%s names a filesystem path on a machine" % location)
        if (ASSIGNMENT_SECRET.search(value) or TOKEN_VALUE.search(value)
                or credential_name_in(value)
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

CHECK_KEYS = ("command", "shows", "use", "score", "threshold", "timeout")
CHECK_USES = ("cli-examples", "browser-suite", "web-journey", "library-tests")

def validate_check(name, spec, where):
    # Mirrors the declared-check rules in scripts/verify.sh, which stays
    # authoritative: write must never persist a shape checks would reject, and
    # the self-test runs both validators on every bad shape below.
    if not re.fullmatch(r"[a-z][a-z0-9-]*", name):
        die("%s: a check's name is a lowercase word" % where)
    table(spec, where)
    extra = sorted(set(spec) - set(CHECK_KEYS))
    if extra:
        die("%s: %s is not a key; the keys are %s" % (where, ", ".join(extra), ", ".join(CHECK_KEYS)))
    if ("command" in spec) == ("use" in spec):
        die("%s needs a command or a use, not both" % where)
    shows = spec.get("shows")
    if shows is not None and (not isinstance(shows, str) or not shows.strip()):
        die("%s: shows is words saying what the check shows" % where)
    if "timeout" in spec and (isinstance(spec["timeout"], bool) or not isinstance(spec["timeout"], int) or spec["timeout"] <= 0):
        die("%s: timeout is a whole number of seconds" % where)
    if "use" in spec:
        if name == "gate" or spec["use"] not in CHECK_USES:
            die("%s: use names a default, one of %s; the gate takes a command" % (where, ", ".join(CHECK_USES)))
        if "score" in spec or "threshold" in spec:
            die("%s: a score is read from a command's output, so it goes with command, not use" % where)
    else:
        if not isinstance(spec["command"], str) or not spec["command"].strip():
            die("%s: command is the shell command that runs the check" % where)
        if shows is None:
            die("%s: shows says what the check shows" % where)
        if ("score" in spec) != ("threshold" in spec):
            die("%s: score and threshold go together" % where)
        elif "score" in spec:
            try:
                if not isinstance(spec["score"], str) or re.compile(spec["score"]).groups != 1:
                    die("%s: score is a regular expression with one group, the number" % where)
            except re.error as e:
                die("%s: score is not a regular expression: %s" % (where, e))
            if isinstance(spec["threshold"], bool) or not isinstance(spec["threshold"], (int, float)):
                die("%s: threshold is a number" % where)

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
        # A name admits board-title punctuation; a path or URL does not pass. The value
        # scan above already refuses absolute, home, parent, Windows, UNC, file: and
        # env-var paths, so this refuses only what it misses: separators anywhere, a
        # URL scheme, and a leading ~ or $ expansion.
        if ("/" in binding or "\\" in binding or "://" in binding
                or re.match(r"(?i)^[a-z][a-z0-9+.-]*:[^ ]", binding)
                or binding.startswith(("~", "$"))):
            die("%s.tracker.binding must be a tracker name, not a path or URL" % label)
        tracker["binding"] = binding
    if not local and "checks" in data:
        checks = table(data["checks"], label + ".checks")
        for name, spec in checks.items():
            validate_check(name, spec, label + ".checks." + name)
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
    # A bare star anywhere is not enough: a later negation (!settings.toml) re-includes
    # what it ignored. The last effective rule decides, so it must be the star.
    effective = [line.strip() for line in existing.splitlines()]
    effective = [line for line in effective if line and not line.startswith("#")]
    if not effective or effective[-1] != "*":
        prefix = existing
        if prefix and not prefix.endswith("\n"):
            prefix += "\n"
        if not prefix:
            prefix = ("# .postmaster/ holds this instance's settings and every run's full record.\n"
                      "# Nothing in it is committed by default. To share what a run requires of\n"
                      "# everyone, commit project.toml alone with: git add -f .postmaster/project.toml\n")
        ignore.write_text(prefix + "*\n", encoding="utf-8")
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
        shadow = tmp / "shadow"; shadow.mkdir()
        (shadow / "json").mkdir()
        (shadow / "json" / "__init__.py").write_text('raise SystemExit("target module imported")\n', encoding="utf-8")
        isolated = subprocess.run(
            ["timeout", "10", str(here / "project-settings.sh"), "inspect", str(shadow)],
            capture_output=True, text=True, cwd=shadow,
        )
        assert isolated.returncode == 0, "target modules were imported: %s" % isolated.stderr
        print("  ok   project modules cannot shadow the settings reader's standard library imports")
        ensure_ignore(repo)
        assert (repo / ".postmaster" / ".gitignore").read_text().endswith("*\n")
        assert not (repo / ".postmaster" / "settings.toml").exists()
        print("  ok   ensure creates the folder ignore without prompting for settings")
        (repo / ".postmaster" / ".gitignore").write_text("# existing local rules\n!keep-me\n", encoding="utf-8")
        ensure_ignore(repo)
        kept = (repo / ".postmaster" / ".gitignore").read_text()
        assert kept.startswith("# existing local rules\n") and kept.endswith("*\n")
        print("  ok   ensure completes an existing ignore file without discarding its rules")
        negated = tmp / "negated"; negated.mkdir()
        ensure_ignore(negated)
        (negated / ".postmaster" / ".gitignore").write_text("*\n!settings.toml\n", encoding="utf-8")
        ensure_ignore(negated)
        repaired = (negated / ".postmaster" / ".gitignore").read_text()
        assert repaired.endswith("*\n") and "!settings.toml\n" in repaired
        assert subprocess.run(["git", "init", "-q", str(negated)]).returncode == 0
        assert subprocess.run(["git", "-C", str(negated), "check-ignore", "-q", ".postmaster/settings.toml"]).returncode == 0
        assert subprocess.run(["git", "-C", str(negated), "check-ignore", "-q", ".postmaster/runs/T-1/card.md"]).returncode == 0
        print("  ok   ensure re-ignores a folder a negation had re-included, keeping its rules")
        (negated / ".postmaster" / ".gitignore").write_text("*\n!runs/\n!runs/**\n", encoding="utf-8")
        ensure_ignore(negated)
        assert subprocess.run(["git", "-C", str(negated), "check-ignore", "-q", ".postmaster/runs/T-1/card.md"]).returncode == 0
        print("  ok   ensure re-ignores run artifacts a negation had re-included")
        before = (negated / ".postmaster" / ".gitignore").read_text()
        ensure_ignore(negated)
        assert (negated / ".postmaster" / ".gitignore").read_text() == before
        print("  ok   ensure is a no-op once the last rule is the star")
        candidate = tmp / "shared.toml"
        candidate.write_text('''[project]\ndefault_turnpikes=["bug"]\nrisk_surfaces="the API and subprocess boundary"\n[tracker]\nbinding="Team board"\n''', encoding="utf-8")
        write_profile(repo, "project", str(candidate))
        shared = inspect(repo)
        assert shared["shared_present"] and shared["project"]["default_turnpikes"] == ["bug"]
        assert shared["sources"]["project.default_turnpikes"] == "shared"
        assert (repo / ".postmaster" / ".gitignore").read_text().endswith("*\n")
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
            ("home path in a binding", '[tracker]\nbinding="~/.config/key"\n'),
            ("absolute path in a binding", '[tracker]\nbinding="/srv/boards/main"\n'),
            ("credential field", '[tracker]\nenv_file="credential.env"\n'),
            ("key file field", '[tracker]\nkeyfile="my.key"\n'),
            ("unknown role", '[roles]\nworkhorses=["ghost"]\n'),
            ("slash in a binding", '[tracker]\nbinding="user/board"\n'),
            ("backslash in a binding", "[tracker]\nbinding='C:\\boards\\x'\n"),
            ("URL in a binding", '[tracker]\nbinding="https://example.com/b"\n'),
            ("scheme in a binding", '[tracker]\nbinding="file:boards"\n'),
            ("colon-no-space in a binding", '[tracker]\nbinding="Team:Board"\n'),
            ("leading tilde in a binding", '[tracker]\nbinding="~other"\n'),
            ("leading dollar in a binding", '[tracker]\nbinding="$FOO"\n'),
            ("parent traversal in a binding", '[tracker]\nbinding=".."\n'),
            ("lowercase credential name", '[tracker]\nbinding="github_token"\n'),
            ("credential word with a dash", '[tracker]\nbinding="my-secret"\n'),
            ("keyword-initial credential name", '[tracker]\nbinding="TOKEN"\n'),
            ("bare credential words", '[tracker]\nbinding="API_KEY"\n'),
            ("all-caps credential token", '[tracker]\nbinding="MY_TOKEN"\n'),
            ("lowercase snake key", '[tracker]\nbinding="api_key"\n'),
            ("lowercase kebab key", '[tracker]\nbinding="api-key"\n'),
            ("bare lowercase key", '[tracker]\nbinding="apikey"\n'),
            ("mixed-case snake key", '[tracker]\nbinding="Api_Key"\n'),
            ("bare auth token", '[tracker]\nbinding="authtoken"\n'),
            ("bare access token", '[tracker]\nbinding="accesstoken"\n'),
            ("key file as value", '[tracker]\nbinding="keyfile"\n'),
            ("snake key file as value", '[tracker]\nbinding="key_file"\n'),
            ("kebab key file as value", '[tracker]\nbinding="key-file"\n'),
            ("caps key file as value", '[tracker]\nbinding="KEYFILE"\n'),
            ("env file as value", '[tracker]\nbinding="env_file"\n'),
            ("bare env file as value", '[tracker]\nbinding="envfile"\n'),
            ("kebab env file as value", '[tracker]\nbinding="env-file"\n'),
            ("bare private key", '[tracker]\nbinding="privatekey"\n'),
            ("snake private key", '[tracker]\nbinding="private_key"\n'),
            ("kebab private key", '[tracker]\nbinding="private-key"\n'),
            ("kebab access key", '[tracker]\nbinding="access-key"\n'),
            ("snake access key", '[tracker]\nbinding="access_key"\n'),
            ("bare password", '[tracker]\nbinding="password"\n'),
            ("bare secret", '[tracker]\nbinding="secret"\n'),
            ("bare token", '[tracker]\nbinding="token"\n'),
            ("bare credentials", '[tracker]\nbinding="credentials"\n'),
            ("bare caps secret", '[tracker]\nbinding="SECRET"\n'),
            ("single titlecase secret", '[tracker]\nbinding="Secret"\n'),
            ("camelCase api key", '[tracker]\nbinding="githubApiKey"\n'),
            ("camelCase token", '[tracker]\nbinding="accessToken"\n'),
            ("camelCase continuation", '[tracker]\nbinding="secretKey"\n'),
            ("camelCase sandwich", '[tracker]\nbinding="mySecretKey"\n'),
            ("credential value word", '[tracker]\nbinding="secretValue"\n'),
            ("token value word", '[tracker]\nbinding="tokenValue"\n'),
            ("password hash word", '[tracker]\nbinding="passwordHash"\n'),
            ("credential name word", '[tracker]\nbinding="credentialName"\n'),
            ("token value sandwich", '[tracker]\nbinding="authTokenValue"\n'),
            ("identifier word in phrasing", '[tracker]\nbinding="Migrate api_key usage"\n'),
            ("caps word in phrasing", '[tracker]\nbinding="The TOKEN is here"\n'),
            ("padded credential name", '[tracker]\nbinding="  api_key  "\n'),
            ("credential word in a role name", '[roles]\nworkhorses=["API_KEY"]\n'),
            ("classic token value", '[tracker]\nbinding="ghp_12345678901234567890"\n'),
            ("short classic token value", '[tracker]\nbinding="ghp_12345678"\n'),
            ("fine-grained token value", '[tracker]\nbinding="github_pat_ABCDEFGHIJKL"\n'),
            ("gitlab token value", '[tracker]\nbinding="glpat-ABCDEFGHIJKL"\n'),
            ("chat token value", '[tracker]\nbinding="xoxc-123456789012"\n'),
            ("key-like token value", '[tracker]\nbinding="sk-1234567890123456"\n'),
            ("credential assignment", '[tracker]\nbinding="X_API_KEY=abc123"\n'),
            ("lowercase credential assignment", '[tracker]\nbinding="password = hunter2"\n'),
            ("private key block", '[tracker]\nbinding="-----BEGIN PRIVATE KEY-----"\n'),
        ):
            bad = tmp / "bad.toml"; bad.write_text(contents, encoding="utf-8")
            try:
                if label == "shared roles":
                    validate_common(tomllib.loads(contents), "shared project settings", False)
                elif label != "unknown role":
                    scan_machine_data(tomllib.loads(contents), "settings input")
                    validate_common(tomllib.loads(contents), "settings input", True)
                else:
                    write_profile(repo, "local", str(bad)); effective_config(repo, load_machine(str(machine)))
            except SystemExit:
                print("  ok   rejects " + label)
            else:
                raise AssertionError("accepted " + label)
        for label, contents, local in (
            ("risk prose naming a path", '[project]\nrisk_surfaces="reads /home/alex/secret"\n', True),
            ("risk prose naming a secret", '[project]\nrisk_surfaces="reads PLANE_API_KEY and lane env files"\n', True),
            ("risk prose naming a machine", '[project]\nrisk_surfaces="runs on build-01 beside //server/share"\n', True),
            ("a check command with paths", '[checks.x]\ncommand="cat /tmp/out $HOME/f"\nshows="y"\n', False),
            ("a check named secret-scan", '[checks.secret-scan]\ncommand="true"\nshows="s"\n', False),
            ("a plain board name", '[tracker]\nbinding="Team board"\n', True),
            ("an ampersand board name", '[tracker]\nbinding="Platform & DevEx"\n', True),
            ("a comma board name", '[tracker]\nbinding="Team, Platform"\n', True),
            ("the documented example binding", '[tracker]\nbinding="the board, workspace or team name"\n', True),
            ("the documented local binding", '[tracker]\nbinding="the board, workspace or team name for this checkout"\n', True),
            ("a dotted board name", '[tracker]\nbinding="Board_1.v2"\n', True),
            ("a colon-space board name", '[tracker]\nbinding="Team: Board"\n', True),
            ("a natural secret word", '[tracker]\nbinding="Secret Santa"\n', True),
            ("a natural token word", '[tracker]\nbinding="Password reset project"\n', True),
            ("a glued lowercase word", '[tracker]\nbinding="secretary"\n', True),
            ("a glued lowercase credential", '[tracker]\nbinding="mysecret"\n', True),
            ("a keyword-prefixed natural word", '[tracker]\nbinding="Tokenomics review"\n', True),
            ("a token prefix too short to be a token", '[tracker]\nbinding="ghp_abc"\n', True),
            ("an assignment without a credential word", '[tracker]\nbinding="a=b"\n', True),
        ):
            try:
                scan_machine_data(tomllib.loads(contents), "settings input")
                validate_common(tomllib.loads(contents), "settings input", local)
            except SystemExit as e:
                raise AssertionError("rejected " + label + ": %s" % e)
            print("  ok   accepts " + label)
        verify = str(here / "verify.sh")
        bad_shapes = (
            ("unknown key", '[checks.x]\ncommand = "true"\nshows = "s"\nunknown = 1\n'),
            ("command and use", '[checks.x]\ncommand = "true"\nuse = "cli-examples"\nshows = "s"\n'),
            ("neither command nor use", '[checks.x]\nshows = "s"\n'),
            ("command without shows", '[checks.x]\ncommand = "true"\n'),
            ("score without threshold", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\n'),
            ("threshold without score", '[checks.x]\ncommand = "true"\nshows = "s"\nthreshold = 1\n'),
            ("score with two groups", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(a)(b)"\nthreshold = 1\n'),
            ("score that is not a regex", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(a"\nthreshold = 1\n'),
            ("string threshold", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\nthreshold = "high"\n'),
            ("zero timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = 0\n'),
            ("boolean timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = true\n'),
            ("unknown default", '[checks.x]\nuse = "nope"\n'),
            ("gate with use", '[checks.gate]\nuse = "cli-examples"\n'),
            ("score with use", '[checks.x]\nuse = "cli-examples"\nscore = "(x)"\nthreshold = 1\n'),
            ("blank shows", '[checks.x]\ncommand = "true"\nshows = ""\n'),
            ("blank command", '[checks.x]\ncommand = "  "\nshows = "s"\n'),
            ("non-lowercase name", '[checks.Bad]\ncommand = "true"\nshows = "s"\n'),
        )
        for i, (label, contents) in enumerate(bad_shapes):
            shape_repo = tmp / ("bad-shape-%d" % i); shape_repo.mkdir()
            shape_in = tmp / ("bad-shape-%d.toml" % i); shape_in.write_text(contents, encoding="utf-8")
            try:
                write_profile(shape_repo, "project", str(shape_in))
            except SystemExit:
                write_refused = True
            else:
                write_refused = False
            planted = shape_repo / ".postmaster" / "project.toml"
            planted.parent.mkdir(parents=True, exist_ok=True)
            planted.write_text(contents, encoding="utf-8")
            checked = subprocess.run(["timeout", "10", verify, "checks", str(shape_repo)],
                                     capture_output=True, text=True)
            assert write_refused and checked.returncode != 0, "accepted bad check shape: " + label
            print("  ok   write and verify.sh agree in refusing " + label)
        good_shapes = (
            ("command with shows and timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = 60\n'),
            ("scored command", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\nthreshold = 0.5\n'),
            ("bare default", '[checks.x]\nuse = "cli-examples"\n'),
            ("default with shows and timeout", '[checks.x]\nuse = "library-tests"\nshows = "s"\ntimeout = 60\n'),
            ("gate command", '[checks.gate]\ncommand = "true"\nshows = "s"\n'),
        )
        for i, (label, contents) in enumerate(good_shapes):
            shape_repo = tmp / ("good-shape-%d" % i); shape_repo.mkdir()
            shape_in = tmp / ("good-shape-%d.toml" % i); shape_in.write_text(contents, encoding="utf-8")
            write_profile(shape_repo, "project", str(shape_in))
            checked = subprocess.run(["timeout", "10", verify, "checks", str(shape_repo)],
                                     capture_output=True, text=True)
            assert checked.returncode == 0, "verify.sh refused " + label + ": " + checked.stderr
            print("  ok   write and verify.sh agree in accepting " + label)
        inspect(here.parent)
        print("  ok   this repo's own committed profile validates")
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
