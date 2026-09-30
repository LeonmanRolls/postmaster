#!/usr/bin/env bash
# A run's style findings. They gate nothing: the review leg logs them and applies none, the ship
# card counts them, and aftercare sorts each into a rule for a linter the project's gate runs, a
# convention for the project's own docs, or neither. The postmaster puts the sort to the user
# after the merge.
#
#   style-findings.sh list <dispatch>    each style finding: its id, where it is, the rest of its line
#   style-findings.sh count <dispatch>   how many style findings the run has
#   style-findings.sh gate <dispatch>    what the gate runs, as the run's branch has it: each line
#                                        after where it is written, 20 of each file at most
#   style-findings.sh check <dispatch>   whether <dispatch>/style-sort.md sorts every style finding
#   style-findings.sh --self-test
#
# A finding is a `finding` line in <dispatch>/actions.jsonl, known by its target. The first word of
# its detail is its class, `gating` or `style`, and scripts/log-action.sh refuses any other. A
# target's latest line gives its class, so a finding argued back to gating in a later round is no
# longer a style finding, and two findings at one place need targets that differ. The ids are S1,
# S2, ... in the order of those latest lines.
#
# The sort holds one line per style finding, in any order, and may hold headings, blank lines and
# list bullets besides:
#
#   S<n> linter <linter> enable <rule>: <reason>          an existing rule of a linter the gate runs
#   S<n> linter <linter> write <rule>: <reason>           a custom rule to write for it
#   S<n> linter <linter> enable <rule> via <file>: <reason>  the same, for a linter the gate runs in
#                                                            a way `gate` does not show: <file> runs it
#   S<n> docs <doc>: <reason>                             a convention for the project's own docs
#   S<n> neither: <reason>
#   N<n> new-linter <linter> S<n>[,S<m>...]: <reason>     a linter the gate does not run, proposed once
#   N<n> new-linter <linter> S<n>[,S<m>...] not-in-gate: <reason>   one the project has, and the
#                                                                   gate does not run
#
# The reason follows the first colon that ends a word, so a rule's name may hold colons. Names are
# matched without their case or markup. The gate and the repo are the ones the waybill's Project
# profile names, and the repo is read as the run's branch has it: the branch is the dispatch
# directory's name. The gate is read, never run. It reaches the package scripts it runs, with
# their pre and post scripts and their workspaces; the make and just recipes it runs, with their
# prerequisites, variables and includes; the files it runs, less their comments; and the configs of
# pre-commit, lefthook, lint-staged, tox and nox. It runs a linter when a command it reaches, or a
# config, names it. A new linter is refused when the gate runs it, or when the project already has
# it and its line does not say not-in-gate.
#
# On exit 0, check prints one line per proposal: the findings that share a linter and rule, or a
# doc, on one line, then the proposal, then any notes in brackets, among them what the project's
# ledger records of that proposal from any run (filed, declined or asked). Then the counts.
#
#   exit 0  printed
#   exit 1  usage; no waybill, action log, or branch named for the run, where one is needed; a file
#           that cannot be read
#   exit 2  list and count: a finding whose class is neither gating nor style. gate: the waybill
#           names no gate, or no repo that exists. check: a finding with neither class; no sort,
#           with style findings to sort; or a sort that is wrong, or names a linter it cannot
#           check for want of a gate or a repo. One line per fault, on stdout.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
usage() { echo "usage: style-findings.sh list|count|gate|check <dispatch> | --self-test" >&2; exit 1; }

core() {  # core list|count|gate|check <dispatch> | forms <file>
  python3 - "$@" <<'PY'
import fnmatch, json, os, posixpath, re, shlex, subprocess, sys

cmd, dispatch = sys.argv[1], sys.argv[2]
RUN = os.path.basename(os.path.normpath(dispatch))
SORT = os.path.join(dispatch, "style-sort.md")
LEDGER = os.path.join(os.path.dirname(os.path.normpath(dispatch)), "ledger.jsonl")
FORMS = ('a sort line is one of: "S<n> linter <linter> enable <rule>: <reason>", '
         '"S<n> linter <linter> write <rule>: <reason>", either with "via <file>" after the rule, '
         '"S<n> docs <doc>: <reason>", "S<n> neither: <reason>", and '
         '"N<n> new-linter <linter> S<n>[,S<m>...]: <reason>", with "not-in-gate" after the findings')
SHOWN = 20      # lines of each file that gate prints; the rest are read, and counted
LONG = 4000     # a longer line is data, and no command in it is followed

def die(msg):
    print("style-findings: " + msg, file=sys.stderr)
    sys.exit(1)

def read(path, what):  # a file's text, less a byte-order mark
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            return f.read()
    except FileNotFoundError:
        die("no %s at %s" % (what, path))
    except OSError as e:
        die("cannot read %s: %s" % (path, e.strerror))

def plain(word):  # a name as a sort line writes it, less markup and quotes
    return word.strip("`*_\"'")

def named(name, text):  # whether the text holds the name as a word, whatever its case
    return re.search(r"(?<![A-Za-z0-9_-])%s(?![A-Za-z0-9_-])" % re.escape(name), text, re.I) is not None

def strip_js(text):  # JavaScript or TypeScript, less its comments
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return "\n".join(re.sub(r"(^|\s)//.*$", r"\1", l) for l in text.split("\n") if not re.match(r"\s*\*", l))

def config_text(text, path):  # a tool's config or a manifest, less its comments
    if re.search(r"\.[cm]?[jt]s$", path):
        return strip_js(text)
    if path.endswith(".json"):
        return text
    return "\n".join(re.sub(r"(^|\s)[#;].*$", r"\1", l) for l in text.split("\n"))

# --- the run's findings ---------------------------------------------------------------------------
def findings():  # ([(id, target, rest)], [fault]): each target whose latest finding line is style
    path = os.path.join(dispatch, "actions.jsonl")
    latest, faults = {}, []
    for n, line in enumerate(read(path, "action log").split("\n"), 1):
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except ValueError:
            die("%s line %d is not JSON" % (path, n))
        if not isinstance(e, dict) or e.get("action") != "finding":
            continue
        words = str(e.get("detail", "")).split(None, 1)
        if not words or words[0] not in ("gating", "style"):
            faults.append("actions.jsonl line %d: a finding whose detail opens with %s, not gating or style"
                          % (n, '"%s"' % words[0] if words else "nothing"))
            continue
        target = str(e.get("target", ""))
        latest.pop(target, None)                 # a finding logged again replaces its last line
        latest[target] = (words[0], words[1] if len(words) > 1 else "")
    style = [(t, rest) for t, (cls, rest) in latest.items() if cls == "style"]
    return [("S%d" % i, t, rest) for i, (t, rest) in enumerate(style, 1)], faults

# --- the waybill -------------------------------------------------------------------------------------
MARK = r"(?:\*\*|__)?"
def field(line, key, stops):  # a Project profile field's value, up to the next field on its line
    m = re.match(r"\s*(?:[-*+]\s+)?%s%s%s\s*:%s(.*)$" % (MARK, key, MARK, MARK), line, re.I)
    if not m:
        return None
    v = m.group(1)
    nxt = re.search(r"\s+%s(?:%s)%s\s*:%s(?=\s|$)" % (MARK, "|".join(stops), MARK, MARK), v, re.I)
    v = (v[:nxt.start()] if nxt else v).strip()
    if len(v) > 1 and v[0] == v[-1] == "`":
        v = v[1:-1].strip()
    return v

def profile():  # (repo, gate) from the waybill's own Project profile, the last one, after the ticket
    lines = read(os.path.join(dispatch, "brief.md"), "waybill").split("\n")
    heads = [i for i, l in enumerate(lines) if re.fullmatch(r" {0,3}##[ \t]+project profile[ \t:#]*\r?", l, re.I)]
    repo = gate = None
    for l in (lines[heads[-1] + 1:] if heads else []):
        if re.match(r" {0,3}#{1,2}(?:[ \t]|\r?$)", l):
            break
        r, g = field(l, "repo", ["default branch", "BASE"]), field(l, "gate", ["build", "browser suite"])
        repo = r if repo is None else repo
        gate = g if gate is None else gate
    return repo or None, (gate if gate and gate.lower() != "none" else None)

# --- the repo, as the run's branch has it ----------------------------------------------------------
def git(repo, *args, raw=False):  # a git command's output, or None
    try:
        r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    return r.stdout if raw else r.stdout.decode("utf-8", "replace")

class Tree:  # a commit's files, read through git; nothing in them is run
    def __init__(self, repo, branch):
        self.repo = repo
        sha = (git(repo, "rev-parse", "--verify", "--quiet", "refs/heads/%s^{commit}" % branch) or "").strip()
        if not sha:
            die("no branch %s in %s: the gate is read as the run's branch has it" % (branch, repo))
        self.blobs, self.dirs, self.cache = {}, {""}, {}
        for ent in (git(repo, "ls-tree", "-r", "-z", "--full-tree", sha, raw=True) or b"").split(b"\0"):
            meta, tab, path = ent.partition(b"\t")
            f = meta.split()
            if tab and len(f) == 3 and f[1] == b"blob":
                p = path.decode("utf-8", "replace")
                self.blobs[p] = (f[0].decode(), f[2].decode())
                d = posixpath.dirname(p)
                while d not in self.dirs:
                    self.dirs.add(d)
                    d = posixpath.dirname(d)

    def path(self, cwd, p):  # a path from a directory of the tree, or None when it leaves the tree
        if not p or p.startswith(("/", "~")):
            return None
        q = posixpath.normpath(posixpath.join(cwd, p))
        return "" if q == "." else (None if q == ".." or q.startswith("../") else q)

    def file(self, cwd, p):  # a file of the tree, a link within it followed once
        q = self.path(cwd, p)
        if q not in self.blobs:
            return None
        mode, sha = self.blobs[q]
        if mode == "120000":
            q = self.path(posixpath.dirname(q), (git(self.repo, "cat-file", "blob", sha) or "").strip())
            if q not in self.blobs or self.blobs[q][0] == "120000":
                return None
        return q

    def dir(self, cwd, p):  # a directory of the tree, or None
        q = self.path(cwd, p)
        return q if q in self.dirs else None

    def read(self, p):  # a file's text, or None when it is large, binary or absent
        if p not in self.cache:
            data = git(self.repo, "cat-file", "blob", self.blobs[p][1], raw=True) if p in self.blobs else None
            ok = data is not None and len(data) <= 512 * 1024 and b"\0" not in data[:8192]
            self.cache[p] = data.decode("utf-8-sig", "replace") if ok else None
        return self.cache[p]

    def glob(self, cwd, pattern):
        q = self.path(cwd, pattern)
        if q is None:
            return []
        if not re.search(r"[*?\[]", q):
            return [q] if q in self.blobs else []
        return sorted(p for p in self.blobs if fnmatch.fnmatchcase(p, q))

    def up(self, cwd, names):  # the nearest of these files at a directory or above it
        d = cwd
        while True:
            for n in names:
                p = posixpath.join(d, n) if d else n
                if p in self.blobs:
                    return p
            if not d:
                return None
            d = posixpath.dirname(d)

# --- reading shell ----------------------------------------------------------------------------------
PUNCT = set(";&|()<>")
SHELL_WORDS = {"!", "{", "}", "if", "then", "do", "else", "elif", "while", "until", "time", "exec",
               "builtin", "nohup"}
INERT = {"echo", "printf", ":", "true", "false", "exit", "return", "test", "[", "[[", "export", "set",
         "unset", "read", "shift", "local", "declare", "typeset", "trap", "wait", "sleep", "cat", "tee",
         "head", "tail", "wc", "sort", "uniq", "date", "pwd", "which", "type", "hash", "touch", "rm",
         "cp", "mv", "mkdir", "rmdir", "ln", "chmod", "chown", "ls", "fi", "done", "esac", "popd"}
INTERPRETERS = {"bash", "sh", "zsh", "dash", "ksh", "source", ".", "node", "nodejs", "python",
                "python3", "bun", "deno", "tsx", "ts-node", "ruby", "perl"}
BUILTINS = {  # subcommands of a package manager that are not a script run by its name
    "pnpm": {"add", "install", "i", "update", "up", "upgrade", "remove", "rm", "uninstall", "link", "ln",
             "unlink", "import", "rebuild", "rb", "prune", "fetch", "patch", "patch-commit", "exec", "dlx",
             "create", "run", "publish", "pack", "audit", "list", "ls", "outdated", "why", "root", "bin",
             "config", "c", "env", "setup", "store", "init", "deploy", "licenses", "server", "doctor"},
    "yarn": {"add", "install", "remove", "up", "upgrade", "run", "exec", "dlx", "workspace", "workspaces",
             "info", "why", "pack", "npm", "plugin", "set", "config", "version", "node", "bin", "cache",
             "dedupe", "explain", "init", "link", "unlink", "patch", "rebuild", "stage", "unplug",
             "global", "publish"},
    "bun": {"run", "test", "x", "repl", "exec", "install", "i", "add", "a", "remove", "rm", "update",
            "outdated", "link", "unlink", "publish", "patch", "patch-commit", "pm", "build", "init",
            "create", "c", "upgrade", "completions", "discord", "help", "audit", "why", "info"},
}
RUNNERS = {  # a runner, and the configs it reads, whose commands the gate then runs
    "pre-commit": (".pre-commit-config.yaml", ".pre-commit-config.yml"),
    "prek": (".pre-commit-config.yaml", ".pre-commit-config.yml"),
    "lefthook": ("lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook.toml",
                 "lefthook.json"),
    "lint-staged": (".lintstagedrc", ".lintstagedrc.json", ".lintstagedrc.yaml", ".lintstagedrc.yml",
                    ".lintstagedrc.js", ".lintstagedrc.cjs", ".lintstagedrc.mjs", "lint-staged.config.js",
                    "lint-staged.config.cjs", "lint-staged.config.mjs"),
    "tox": ("tox.ini",),
    "nox": ("noxfile.py",),
}

def subst(line):  # substitutions and expansions flattened, so that no ( or ) of theirs splits a command
    line = re.sub(r"\$\(MAKE\)|\$\{MAKE\}", "make", line)
    line = re.sub(r"\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^{}]*)\}", r"\1", line)
    for _ in range(10):
        new = re.sub(r"\$\(([^()]*)\)", r"\1", line)
        if new == line:
            break
        line = new
    return re.sub(r"\$\{[^{}]*\}", "_", line).replace("`", " ")

def uncomment(line):  # a line of shell less its comment: a # that starts a word, outside quotes
    q, i = None, 0
    while i < len(line):
        c = line[i]
        if c == "\\" and q != "'":
            i += 2
            continue
        if q:
            q = None if c == q else q
        elif c in "'\"":
            q = c
        elif c == "#" and (i == 0 or line[i - 1] in " \t;&|()"):
            return line[:i]
        i += 1
    return line

def commands(line):  # ("cmd", words) and ("sep", token), in order, for one line of shell
    line = subst(uncomment(line))
    try:
        lex = shlex.shlex(line, posix=True, punctuation_chars=";&|()<>")
        lex.whitespace_split, lex.commenters = True, ""
        toks = list(lex)
    except ValueError:
        toks = re.sub(r"(&&|\|\||[;&|()<>])", r" \1 ", line).split()
    words, skip = [], False
    for t in toks:
        if skip:
            skip = False
        elif t and set(t) <= PUNCT:
            if "<" in t or ">" in t:
                skip = True                      # a redirection's target is not a command
                continue
            if words:
                yield "cmd", words
                words = []
            yield "sep", t
        else:
            words.append(t)
    if words:
        yield "cmd", words

def unwrap(words):  # the command a line runs, less assignments and the wrappers that run the rest
    n, i = len(words), 0
    def past(j, valued=()):  # past the flags at j, and the value of each flag in valued
        while j < n and words[j].startswith("-") and words[j] != "--":
            j += 2 if words[j] in valued else 1
        return j + 1 if j < n and words[j] == "--" else j
    while i < n:
        w, b = words[i], posixpath.basename(words[i])
        nxt = words[i + 1] if i + 1 < n else ""
        if w in SHELL_WORDS or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", w):
            i += 1
        elif b == "command":
            if nxt in ("-v", "-V"):
                return []                        # asks whether a command exists, and runs nothing
            i += 1
        elif b == "env":
            i = past(i + 1, ("-u", "--unset", "-C", "--chdir", "-S", "--split-string"))
        elif b in ("cross-env", "cross-env-shell", "stdbuf", "nice"):
            i = past(i + 1, ("-n", "--adjustment"))
        elif b == "timeout":
            i = past(i + 1, ("-s", "--signal", "-k", "--kill-after")) + 1
        elif b in ("npx", "pnpx", "bunx"):
            i = past(i + 1, ("-p", "--package"))
        elif b in ("dotenv", "dotenvx"):
            i = words.index("--", i) + 1 if "--" in words[i:] else past(i + 1, ("-e", "-f", "-c", "-v"))
            i += 1 if i < n and words[i] == "run" else 0
        elif b in ("uv", "poetry", "pipenv", "hatch", "pdm", "rye") and nxt == "run":
            i = past(i + 2, ("--with", "--env", "-e", "--python", "-p"))
        elif b == "bundle" and nxt == "exec":
            i += 2
        elif b == "xargs":
            i = past(i + 1, ("-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"))
        else:
            break
    return words[i:]

def parse_just(text):  # a justfile's recipes, its variables, and its first recipe
    recipes, vars, first, current = {}, {}, None, None
    for line in text.split("\n"):
        if current is not None and (line[:1] in (" ", "\t") or not line.strip()):
            if line.strip():
                recipes[current][1].append(line.strip())
            continue
        current, s = None, line.strip()
        if not s or s.startswith(("#", "[", "set ", "import ", "mod ")):
            continue
        m = re.match(r"alias\s+([\w-]+)\s*:=\s*([\w-]+)", s)
        if m:
            recipes.setdefault(m.group(1), ([m.group(2)], []))
            continue
        m = re.match(r"(?:export\s+)?([A-Za-z_][\w-]*)\s*:=\s*(.*)$", s)
        if m:
            vars[m.group(1)] = m.group(2).strip().strip("'\"")
            continue
        m = re.match(r"@?([A-Za-z_][\w-]*)\b[^:]*:(?!=)(.*)$", s)
        if m:
            current = m.group(1)
            recipes[current] = (re.findall(r"[A-Za-z_][\w-]*", re.sub(r"\([^)]*\)", "", m.group(2))), [])
            first = first or current
    return recipes, vars, first

class Makefile:  # a makefile's rules and variables, its includes read, nothing run
    ASSIGN = r"(?:(?:export|override)\s+)*([A-Za-z0-9_.-]+)\s*(:{1,3}=|[?+!]?=)\s*(.*)$"

    def __init__(self, tree, path, cwd, sets):
        self.t, self.path, self.cwd, self.vars, self.rules = tree, path, cwd, dict(sets), {}
        self.fixed, self.first = set(sets), None
        self.read(path, 0)
        self.goal = self.expand(self.vars.get(".DEFAULT_GOAL", "")).strip() or self.first

    def expand(self, s, depth=0):  # $(NAME) and ${NAME}, as far as the makefile sets them
        if depth > 10 or "$" not in s:
            return s
        def one(m):
            name = m.group(1) or m.group(2)
            if name in self.vars:
                return self.expand(self.vars[name], depth + 1)
            return "make" if name == "MAKE" else m.group(0)
        return re.sub(r"\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}", one, s.replace("$$", "\0")).replace("\0", "$$")

    def recipe(self, line):  # a recipe line as the shell gets it
        return self.expand(re.sub(r"^\s*[@+-]*", "", line)).replace("$$", "$")

    def read(self, path, depth):
        text = self.t.read(path)
        current, define = None, False
        for line in re.sub(r"\\\r?\n", " ", text or "").split("\n"):
            if define:
                define = not re.match(r"\s*endef\b", line)
                continue
            if line.startswith("\t"):
                for t in current or []:
                    self.rules[t][1].append(line[1:])
                continue
            s = re.sub(r"(?<!\\)#.*$", "", line).strip()
            if not s or re.match(r"(ifeq|ifneq|ifdef|ifndef|else|endif)\b", s):
                continue                         # a conditional does not end a recipe
            if re.match(r"(?:(?:export|override)\s+)*define\b", s):
                define, current = True, None
                continue
            m = re.match(r"(?:-include|sinclude|include)\s+(.*)$", s)
            if m:
                for inc in self.expand(m.group(1)).split():
                    for p in (self.t.glob(self.cwd, inc) if depth < 10 else []):
                        self.read(p, depth + 1)
                current = None
                continue
            m = re.match(self.ASSIGN, s)
            if m:
                name, op, value = m.groups()
                if name not in self.fixed and op != "!=":
                    if op == "?=":
                        self.vars.setdefault(name, value)
                    elif op == "+=":
                        self.vars[name] = (self.vars.get(name, "") + " " + value).strip()
                    else:
                        self.vars[name] = self.expand(value) if op.startswith(":") else value
                current = None
                continue
            m = re.match(r"([^:=]+?)\s*::?(?![:=])(.*)$", s)
            if not m or re.match(r"\s*" + self.ASSIGN, m.group(2)):
                current = None                   # a directive, or a target's own variable
                continue
            prereqs, _, inline = m.group(2).partition(";")
            current = self.expand(m.group(1)).split()
            for t in current:
                self.rules.setdefault(t, ([], []))
                self.rules[t][0].extend(p for p in self.expand(prereqs).split() if p != "|")
                if inline.strip():
                    self.rules[t][1].append(inline.strip())
                if self.first is None and not t.startswith(".") and "%" not in t:
                    self.first = t

class Reach:  # what a gate command reaches in a tree, found by reading alone
    def __init__(self, tree, gate):
        self.t, self.cmds, self.texts, self.lines = tree, [], [], []
        self.seen, self.warnings, self.pkgs, self.makes, self.justs = set(), [], {}, {}, {}
        self.shell("gate", gate, "")

    def shell(self, where, text, cwd, keep_cd=False):  # lines of shell; a script's cd lasts to its end
        for raw in re.sub(r"\\\r?\n", " ", text).split("\n"):
            line = uncomment(raw).strip()
            if not line:
                continue
            self.lines.append((where, line))
            if len(line) <= LONG:
                after = self.scan(where, line, cwd)
                cwd = after if keep_cd else cwd

    def scan(self, where, line, cwd):
        saved = []
        for kind, val in commands(line):
            if kind == "sep":
                if val == "(":
                    saved.append(cwd)
                elif val == ")" and saved:
                    cwd = saved.pop()
                continue
            cwd, nested = self.command(where, val, cwd)
            for w in (val if nested else []):
                if re.search(r"[ \t\r\n]", w):   # a command in quotes, as sh -c and concurrently take one
                    self.scan(where, w, cwd)
        return cwd

    def command(self, where, words, cwd):  # (the directory after it, whether its words may hold commands)
        w = unwrap(words)
        if not w:
            return cwd, not words
        head, rest = posixpath.basename(w[0]), w[1:]
        if head in ("cd", "pushd"):
            args = [a for a in rest if not a.startswith("-")]
            d = self.t.dir(cwd, args[0]) if args else None
            return (cwd if d is None else d), False
        if head in INERT:
            return cwd, False
        self.cmds.append((where, w))
        if head in ("npm", "pnpm", "yarn", "bun"):
            self.manager(where, head, rest, cwd)
        elif head in ("npm-run-all", "npm-run-all2", "run-s", "run-p"):
            for a in rest:
                if not a.startswith("-"):
                    self.scripts_like(a, cwd)
        elif head in ("make", "gmake"):
            self.make(rest, cwd)
        elif head == "just":
            self.just(rest, cwd)
        elif head in ("turbo", "lerna"):
            self.tasks(rest, cwd)
        elif head in RUNNERS:
            self.configs(head, cwd)
        for a in rest:
            if a.startswith("npm:"):
                self.scripts_like(a[4:], cwd)
        if head in INTERPRETERS:
            for a in rest:
                p = None if a.startswith("-") else self.t.file(cwd, a)
                if p:
                    self.file(p, cwd)
                    break
        elif "/" in w[0]:
            p = self.t.file(cwd, w[0])
            if p:
                self.file(p, cwd)
        return cwd, True

    # package scripts
    def package(self, d):  # a package.json of the tree, as a dict
        if d not in self.pkgs:
            p = posixpath.join(d, "package.json") if d else "package.json"
            v = {}
            if p in self.t.blobs:
                try:
                    v = json.loads(self.t.read(p) or "")
                except ValueError:
                    self.warnings.append("%s does not parse, so no script of it was followed" % p)
            self.pkgs[d] = v if isinstance(v, dict) else {}
        return self.pkgs[d]

    def scripts(self, d):
        s = self.package(d).get("scripts")
        return {k: v for k, v in s.items() if isinstance(v, str)} if isinstance(s, dict) else {}

    def berry(self):  # Yarn 2 and later run no pre or post script
        m = re.match(r"yarn@(\d+)", str(self.package("").get("packageManager", "")))
        return bool(m and int(m.group(1)) >= 2) or ".yarnrc.yml" in self.t.blobs

    def workspaces(self):  # the directories of the workspace packages
        globs, w = [], self.package("").get("workspaces")
        w = w.get("packages") if isinstance(w, dict) else w
        globs += [g for g in (w if isinstance(w, list) else []) if isinstance(g, str)]
        if "lerna.json" in self.t.blobs:
            try:
                v = json.loads(self.t.read("lerna.json") or "").get("packages")
                globs += [g for g in (v if isinstance(v, list) else []) if isinstance(g, str)]
            except (ValueError, AttributeError):
                pass
        inside = False
        for l in (self.t.read("pnpm-workspace.yaml") or "").split("\n") if "pnpm-workspace.yaml" in self.t.blobs else []:
            if re.match(r"packages\s*:", l):
                inside = True
            elif inside and re.match(r"\s+-\s*", l):
                globs.append(re.sub(r"^\s+-\s*|\s+#.*$", "", l).strip().strip("'\""))
            elif inside and l.strip() and not l[:1].isspace():
                inside = False
        keep = [g.rstrip("/") for g in globs if not g.startswith("!")]
        drop = [g[1:].rstrip("/") for g in globs if g.startswith("!")]
        dirs = {posixpath.dirname(p) for p in self.t.blobs if posixpath.basename(p) == "package.json"} - {""}
        return [d for d in sorted(dirs) if any(fnmatch.fnmatchcase(d, g) for g in keep)
                and not any(fnmatch.fnmatchcase(d, g) for g in drop)]

    def selects(self, sel, d):  # a workspace named by its directory, its path or its package name
        s = re.sub(r"^\.\.\.|\.\.\.$", "", sel.strip()).strip("{}")
        s = s[2:] if s.startswith("./") else s
        name = str(self.package(d).get("name", ""))
        return s in (d, posixpath.basename(d), name) or fnmatch.fnmatchcase(d, s) or bool(name and fnmatch.fnmatchcase(name, s))

    def packages(self, ws, cwd):  # the package directories a script runs in
        if ws is None:
            p = self.t.up(cwd, ("package.json",))
            return [posixpath.dirname(p)] if p else []
        dirs = self.workspaces()
        chosen = dirs if ws == "all" else [d for d in dirs if any(self.selects(s, d) for s in ws)]
        return chosen or dirs

    def manager(self, where, pm, args, cwd):
        ws, i = None, 0
        while i < len(args) and args[i].startswith("-"):
            key, eq, val = args[i].partition("=")
            takes = key in ("-C", "--dir", "--prefix", "--cwd", "--filter", "-F") or (key in ("-w", "--workspace") and pm != "pnpm")
            val = val if eq else (args[i + 1] if i + 1 < len(args) else "")
            if key in ("-r", "--recursive", "-ws", "--workspaces"):
                ws = "all"
            elif key in ("-C", "--dir", "--prefix", "--cwd"):
                d = self.t.dir(cwd, val)
                cwd = cwd if d is None else d
            elif takes:
                ws = (ws if isinstance(ws, list) else []) + [val]
            i += 2 if takes and not eq else 1
        if i >= len(args):
            return
        sub, after = args[i], args[i + 1:]
        ws = "all" if any(a in ("-ws", "--workspaces") for a in after) else ws
        names = [a for a in after if not a.startswith("-")]
        if sub in ("run", "run-script", "rum", "urn"):
            if names:
                self.run(pm, names[0], ws, cwd)
        elif pm == "npm" and sub in ("test", "t", "tst", "start", "stop", "restart"):
            self.run(pm, {"t": "test", "tst": "test"}.get(sub, sub), ws, cwd)
        elif (pm, sub) in (("npm", "exec"), ("npm", "x"), ("pnpm", "exec"), ("pnpm", "dlx"), ("yarn", "exec"),
                           ("yarn", "dlx"), ("bun", "x")):
            j = 0
            while j < len(after) and after[j].startswith("-") and after[j] != "--":
                j += 1
            self.command(where, after[j + 1:] if j < len(after) and after[j] == "--" else after[j:], cwd)
        elif pm == "yarn" and sub == "workspaces" and names[:1] == ["foreach"]:
            left = [a for a in after[after.index("run") + 1 if "run" in after else 1:] if not a.startswith("-")]
            if left:
                self.run(pm, left[0], "all", cwd)
        elif pm == "yarn" and sub == "workspace" and len(names) > 1:
            left = names[2:] if names[1] == "run" else names[1:]
            if left:
                self.run(pm, left[0], [names[0]], cwd)
        elif pm != "npm" and sub not in BUILTINS[pm]:
            self.run(pm, sub, ws, cwd)

    def run(self, pm, name, ws, cwd):  # a package script, in each package it runs in
        dirs = self.packages(ws, cwd)
        for d in dirs:
            if name in self.scripts(d):
                self.script(d, name, pm)
        if pm == "bun" and ws is None and not any(name in self.scripts(d) for d in dirs):
            p = self.t.file(cwd, name)       # bun also runs a file by its path
            if p:
                self.file(p, cwd)

    def script(self, d, name, pm):  # a package script, with the pre and post scripts its runner runs
        s = self.scripts(d)
        hooks = [] if pm == "yarn" and self.berry() else ["pre" + name, "post" + name]
        for n in hooks[:1] + [name] + hooks[1:]:
            if n in s and ("script", d, n) not in self.seen:
                self.seen.add(("script", d, n))
                self.shell("%spackage.json scripts.%s" % (d + "/" if d else "", n), s[n], d)

    def scripts_like(self, pattern, cwd):  # npm-run-all's glob: * stays within a :-part, ** spans them
        pat = re.compile("".join(".*" if t == "**" else "[^:]*" if t == "*" else "[^:]" if t == "?" else re.escape(t)
                                 for t in re.findall(r"\*\*|\*|\?|[^*?]+", pattern)) + r"\Z")
        for d in self.packages(None, cwd):
            for n in sorted(self.scripts(d)):
                if pat.match(n):
                    self.script(d, n, "npm")

    def tasks(self, args, cwd):  # turbo's and lerna's tasks: a package script, in each workspace package
        sels, names, i = [], [], 0
        while i < len(args) and args[i] != "--":
            key, eq, val = args[i].partition("=")
            if key in ("--filter", "-F", "--scope"):
                sels.append(val if eq else (args[i + 1] if i + 1 < len(args) else ""))
                i += 0 if eq else 1
            elif not args[i].startswith("-"):
                names.append(args[i])
            i += 1
        if names[:1] in (["run"], ["exec"]):
            names = names[1:] if names[0] == "run" else []
        for n in names:
            if n.startswith("//#"):
                self.run("npm", n[3:], None, "")
            else:
                self.run("npm", n, sels or "all", cwd)

    # make and just
    def make(self, args, cwd):
        d, files, targets, sets, i = cwd, [], [], {}, 0
        valued = ("-C", "--directory", "-f", "--file", "--makefile", "-I", "--include-dir", "-o", "--old-file",
                  "--assume-old", "-W", "--what-if", "--new-file", "--assume-new", "--eval")
        while i < len(args):
            a = args[i]
            key, eq, val = a.partition("=")
            if a in valued and i + 1 < len(args):
                val, i = args[i + 1], i + 1
            elif a in ("-j", "--jobs", "-l", "--load-average", "--max-load") and i + 1 < len(args) \
                    and re.fullmatch(r"\d+(\.\d+)?", args[i + 1]):
                i += 2
                continue
            elif a.startswith(("-C", "-f")) and len(a) > 2 and not a.startswith("--"):
                key, val = a[:2], a[2:]
            elif not eq and not a.startswith("-"):
                targets.append(a)
                i += 1
                continue
            if key in ("-C", "--directory"):
                nd = self.t.dir(d, val)
                d = d if nd is None else nd
            elif key in ("-f", "--file", "--makefile"):
                files.append(val)
            elif eq and not a.startswith("-"):
                sets[key] = val
            i += 1
        for f in files or ["GNUmakefile", "makefile", "Makefile"]:
            p = self.t.file(d, f)
            if p:
                break
        else:
            return
        k = (p, d, tuple(sorted(sets.items())))
        if k not in self.makes:
            self.makes[k] = Makefile(self.t, p, d, sets)
        mk = self.makes[k]
        for t in targets or ([mk.goal] if mk.goal else []):
            self.target(mk, t, d)

    def target(self, mk, t, d):
        if ("make", mk.path, d, t) in self.seen or t not in mk.rules:
            return
        self.seen.add(("make", mk.path, d, t))
        prereqs, recipe = mk.rules[t]
        for p in prereqs:
            self.target(mk, p, d)
        for line in recipe:
            self.shell("%s %s" % (mk.path, t), mk.recipe(line), d)

    def just(self, args, cwd):
        jf = wd = None
        names, i = [], 0
        while i < len(args):
            key, eq, val = args[i].partition("=")
            if key in ("-f", "--justfile", "-d", "--working-directory"):
                if not eq:
                    val, i = (args[i + 1] if i + 1 < len(args) else ""), i + 1
                jf, wd = (val, wd) if key in ("-f", "--justfile") else (jf, val)
            elif key == "--set":
                i += 2
            elif not args[i].startswith("-"):
                names.append(args[i])
            i += 1
        p = self.t.file(cwd, jf) if jf else self.t.up(cwd, ("justfile", "Justfile", ".justfile", "JUSTFILE"))
        if not p:
            return
        if p not in self.justs:
            self.justs[p] = parse_just(self.t.read(p) or "")
        recipes, vars, first = self.justs[p]
        d = self.t.dir(cwd, wd) if wd else None
        d = posixpath.dirname(p) if d is None else d
        for n in [n for n in names if n in recipes] or ([first] if first else []):
            self.recipe(p, n, d)

    def recipe(self, p, n, d):
        recipes, vars, first = self.justs[p]
        if ("just", p, n) in self.seen or n not in recipes:
            return
        self.seen.add(("just", p, n))
        deps, body = recipes[n]
        for dep in deps:
            self.recipe(p, dep, d)
        for line in body:
            line = re.sub(r"\{\{\s*([A-Za-z_][\w-]*)\s*\}\}", lambda m: vars.get(m.group(1), m.group(0)), line)
            self.shell("%s %s" % (p, n), re.sub(r"^[@-]+", "", line), d)

    # runners' configs, and files
    def configs(self, head, cwd):
        found = [(p, config_text(self.t.read(p) or "", p)) for p in (self.t.up(cwd, (n,)) for n in RUNNERS[head]) if p]
        if head == "lint-staged":
            pj = self.t.up(cwd, ("package.json",))
            v = self.package(posixpath.dirname(pj)).get("lint-staged") if pj else None
            found += [(pj + " lint-staged", json.dumps(v))] if v else []
        for p, text in found:
            if ("config", p) not in self.seen:
                self.seen.add(("config", p))
                self.texts.append((p, text))
                self.lines += [(p, l.strip()) for l in text.split("\n") if l.strip()]

    def file(self, p, cwd):  # a file the gate runs: its commands run where its caller is
        if ("file", p) in self.seen:
            return
        self.seen.add(("file", p))
        text = self.t.read(p)
        if text is not None:
            self.shell(p, strip_js(text) if re.search(r"\.[cm]?[jt]sx?$", p) else text, cwd, keep_cd=True)

    def runs(self, linter):  # where the gate runs the linter, or None
        for where, words in self.cmds:           # a quoted command is read as its own commands
            if any(named(linter, w) for w in words if not re.search(r"[ \t\r\n]", w)):
                return where
        for where, text in self.texts:
            if named(linter, text):
                return where
        return None

MANIFESTS = re.compile(r"(^|/)(package\.json|pyproject\.toml|setup\.cfg|tox\.ini|requirements[^/]*\.txt|Pipfile|"
                       r"Gemfile|go\.mod|Cargo\.toml|composer\.json|\.pre-commit-config\.ya?ml|\.tool-versions|mise\.toml)$")

def has_linter(tree, linter):  # a file that shows the project has the linter: its config, or a manifest naming it
    own = re.compile(r"\.?%s(rc)?([._-].*)?\Z" % re.escape(linter), re.I)
    for p in sorted(tree.blobs):
        if own.match(posixpath.basename(p)):
            return p
    for p in sorted(tree.blobs):
        if MANIFESTS.search(p) and named(linter, config_text(tree.read(p) or "", p)):
            return p
    return None

def states():  # what the project's ledger last records of each proposal, from any run
    out = {}
    try:
        with open(LEDGER, encoding="utf-8-sig", errors="replace") as f:
            rows = f.read().split("\n")
    except OSError:
        return out
    for row in rows:
        try:
            e = json.loads(row)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        a, d, run = e.get("action"), str(e.get("detail", "")), e.get("run", "?")
        if a == "ticket-create" and d.startswith("style proposal: "):
            out[d[16:].strip()] = "filed %s in %s" % (e.get("target", "?"), run)
        elif a == "note" and d.startswith("style proposal declined: "):
            out[d[25:].split(": ", 1)[0].strip()] = "declined in %s" % run
        elif a == "note" and d.startswith("style proposal asked: "):
            k = d[22:].strip()
            if not out.get(k, "").startswith(("filed", "declined")):
                out[k] = "asked in %s" % run
    return out

ENTRY = re.compile(r"(?:[-*+][ \t]+)?(S\d+|N\d+)[ \t]+(.+?):(?:[ \t]+(.*))?")
def shape(line):  # (id, head words, reason) of a sort line, or None
    m = ENTRY.fullmatch(line)
    if not m:
        return None
    i, head = m.group(1), m.group(2).split()
    if i[0] == "S":
        ok = (head[:1] == ["linter"] and (len(head) == 4 or (len(head) == 6 and head[4] == "via"))
              and head[2] in ("enable", "write")) or (len(head) == 2 and head[0] == "docs") or head == ["neither"]
    else:
        ok = len(head) >= 3 and head[0] == "new-linter"
    return (i, head, (m.group(3) or "").strip()) if ok else None

# --- the commands -----------------------------------------------------------------------------------
if cmd == "forms":  # the self-test's: each line of a file, marked a sort line's shape or not
    for line in read(dispatch, "file").split("\n"):
        if line.strip():
            print(("ok  " if shape(line.strip()) else "bad ") + line.strip())
    sys.exit(0)

if cmd in ("list", "count"):
    style, faults = findings()
    if faults:
        print("\n".join(faults))
        sys.exit(2)
    if cmd == "count":
        print(len(style))
    for i, where, rest in (style if cmd == "list" else []):
        print(" ".join(x for x in (i, where, rest) if x))
    sys.exit(0)

if cmd == "gate":
    repo, gate = profile()
    if not gate or not repo or not os.path.isdir(repo):
        print("the waybill's Project profile names no gate" if not gate
              else "the waybill's Project profile names no repo that exists" + (": " + repo if repo else ""))
        sys.exit(2)
    r = Reach(Tree(repo, RUN), gate)
    for w in r.warnings:
        print("style-findings: " + w, file=sys.stderr)
    shown = {}
    for where, line in r.lines:
        shown[where] = shown.get(where, 0) + 1
        if shown[where] <= SHOWN:
            print("%s: %s" % (where, line if len(line) <= 200 else line[:197] + "..."))
    for where, k in shown.items():
        if k > SHOWN:
            print("%s: %d more lines, read and not shown" % (where, k - SHOWN))
    sys.exit(0)

# check
style, faults = findings()
ids = [s[0] for s in style]
if not os.path.exists(SORT):
    if faults or style:
        print("\n".join(faults + ["no style-sort.md in %s, and %d style finding%s to sort"
                                  % (dispatch, len(style), "" if len(style) == 1 else "s")]))
        sys.exit(2)
    print("no style findings, so nothing to sort")
    sys.exit(0)
on_s, on_n, first_new, props, checks, bad_shape = {}, {}, {}, [], [], False
for n, raw in enumerate(read(SORT, "sort").split("\n"), 1):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    got = shape(line)
    if got is None:
        faults.append("line %d is not a sort line: %s" % (n, line))
        bad_shape = True
        continue
    i, head, reason = got
    if not reason:
        faults.append("line %d: %s has no reason" % (n, i))
    if i[0] == "S":
        on_s.setdefault(i, []).append(n)
        if i not in ids:
            faults.append("line %d: %s is not a style finding of this run" % (n, i))
        if head[0] == "linter":
            lint, via = plain(head[1]), (plain(head[5]) if len(head) == 6 else None)
            checks.append((n, i, "linter", lint, via))
            props.append((i, "linter %s %s %s" % (lint.lower(), head[2], plain(head[3])), via, None))
        else:
            props.append((i, "docs " + plain(head[1]) if head[0] == "docs" else "neither", None, None))
        continue
    on_n.setdefault(i, []).append(n)
    rest = head[2:]
    marked = rest[-1] == "not-in-gate"
    covers = [c for c in re.split(r"[,\s]+", " ".join(rest[:-1] if marked else rest)) if c]
    if not covers:
        faults.append("line %d: %s names no finding the linter would enforce" % (n, i))
    for c in covers:
        if c not in ids:
            faults.append("line %d: %s names %s, which is not a style finding of this run" % (n, i, c))
    lint = plain(head[1])
    was = first_new.setdefault(lint.lower(), (n, i))
    if was != (n, i):
        faults.append("line %d: %s proposes %s again, as %s on line %d does: propose it once, for every finding it would enforce"
                      % (n, i, lint, was[1], was[0]))
    checks.append((n, i, "new", lint, marked))
    props.append((i, "new-linter " + lint.lower(), None, (covers, marked)))
for i in ids:
    if i not in on_s:
        faults.append("%s is not sorted" % i)
for i, where in list(on_s.items()) + list(on_n.items()):
    if len(where) > 1:
        faults.append("%s is sorted twice, on lines %s" % (i, ", ".join(map(str, where))))
if checks:
    repo, gate = profile()
    if not repo or not os.path.isdir(repo):
        faults += ["line %d: %s names %s, and the waybill's Project profile names no repo that exists to check it against"
                   % (n, i, lint) for n, i, kind, lint, extra in checks]
    else:
        tree = Tree(repo, RUN)
        r = Reach(tree, gate) if gate else None
        for w in (r.warnings if r else []):
            print("style-findings: " + w, file=sys.stderr)
        for n, i, kind, lint, extra in checks:
            if kind == "linter" and extra:
                p = tree.file("", extra)
                if p is None:
                    faults.append("line %d: %s names %s via %s, which the run's branch does not have" % (n, i, lint, extra))
                elif not named(lint, config_text(tree.read(p) or "", p)):
                    faults.append("line %d: %s names %s via %s, which does not name %s" % (n, i, lint, extra, lint))
            elif kind == "linter" and r is None:
                faults.append("line %d: %s names %s, and the waybill's Project profile has no gate to check it against" % (n, i, lint))
            elif kind == "linter" and not r.runs(lint):
                faults.append("line %d: %s names %s, which `gate` does not show the gate running: if the gate runs it some way "
                              "`gate` does not follow, add via and the file that runs it after the rule; if it does not, sort "
                              "the finding docs or neither, and propose %s on a new-linter line" % (n, i, lint, lint))
            elif kind == "new":
                at, own = (r.runs(lint) if r else None), has_linter(tree, lint)
                if at:
                    faults.append("line %d: %s proposes %s, which the gate already runs (%s): sort its findings as linter lines"
                                  % (n, i, lint, at))
                elif own and not extra:
                    faults.append("line %d: %s proposes %s, which the project already has (%s): if the gate runs it, sort its "
                                  "findings as linter lines, with via if `gate` does not show it; if the gate does not, add "
                                  "not-in-gate after the findings" % (n, i, lint, own))
if faults:
    print("\n".join(faults + ([FORMS] if bad_shape else [])))
    sys.exit(2)

groups, order, seen_state = {}, [], states()
for i, key, via, new in props:
    g = groups.setdefault(key, {"ids": [], "via": [], "new": new})
    order += [] if key in order else [key]
    g["ids"].append(i)
    g["via"] += [via] if via and via not in g["via"] else []
rank = ("linter", "docs", "new-linter", "neither")
for key in sorted(order, key=lambda k: rank.index(k.split()[0])):
    g = groups[key]
    notes = (["for " + " ".join(g["new"][0])] if g["new"] else []) + ["via " + v for v in g["via"]]
    notes += ["not in the gate"] if g["new"] and g["new"][1] else []
    notes += [seen_state[key]] if key != "neither" and key in seen_state else []
    print("%s: %s%s" % (" ".join(g["ids"]), key, " [%s]" % "; ".join(notes) if notes else ""))
kinds = [key.split()[0] for i, key, via, new in props if i[0] == "S"]
plural = lambda k, one, many: "%d %s" % (k, one if k == 1 else many)
print("sorted %s: %d to a linter, %d to the docs, %d to neither; %s proposed"
      % (plural(len(ids), "style finding", "style findings"), kinds.count("linter"), kinds.count("docs"),
         kinds.count("neither"), plural(len(first_new), "new linter", "new linters")))
PY
}

case ${1:-} in
  list|count|gate|check)
    [ $# -eq 2 ] || usage
    [ -d "$2" ] || { echo "style-findings: no dispatch directory at $2" >&2; exit 1; }
    core "$1" "$2"; exit $? ;;
  --self-test) [ $# -eq 1 ] || usage ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
self=$HERE/$(basename -- "$0")
SKILL=$(dirname -- "$HERE")/skills/postmaster
tmp=$(mktemp -d) || exit 1
clean() { rm -r -- "$1" </dev/null 2>/dev/null; }     # asks nothing at a terminal, whatever the modes
trap 'clean "$tmp"' EXIT
fails=0 out="" rc=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
run()  { out=$("$@" 2>&1); rc=$?; }
is()   {  # is <label> <exit> <the whole output>
  if [ "$rc" -eq "$2" ] && [ "$out" = "$3" ]; then ok "$1"; else fail "$1: wanted exit $2, got $rc" "$out"; fi
}
has()  {  # has <label> <exit> <text a line must contain> [<text no line may contain>]
  if [ "$rc" -eq "$2" ] && printf '%s\n' "$out" | grep -qF -- "$3" \
     && { [ -z "${4:-}" ] || ! printf '%s\n' "$out" | grep -qF -- "$4"; }; then ok "$1"
  else fail "$1: wanted exit $2 with \"$3\"${4:+ and no \"$4\"}, got exit $rc" "$out"; fi
}
lines() { printf '%s\n' "$@"; }
G() { git -c user.name=t -c user.email=t@example.invalid -c init.defaultBranch=main -c commit.gpgsign=false \
          -c core.hooksPath=/dev/null "$@"; }
commit() { G -C "$1" add -A >/dev/null && G -C "$1" commit -q -m "$2" >/dev/null; }
repo_at() {  # repo_at <dir> <branch>...: a git repo of the dir's files, with each branch at its commit
  local d=$1 b; shift
  G -C "$d" init -q && commit "$d" fixture || exit 1
  for b in "$@"; do G -C "$d" branch "$b" || exit 1; done
}
waybill() {  # waybill <dispatch> <repo> <gate, or nothing> [<the whole gate line>]
  mkdir -p "$1"
  { printf '# Waybill: T\n\n## Ticket\n## Problem / feature\nA change.\n\n## Project profile\ngate: make decoy\n\n'
    printf '## Project profile\nrepo: %s          default branch: main       BASE: abc123\n' "$2"
    if [ -n "${4:-}" ]; then printf '%s\n' "$4"; else printf 'gate: %s  build: none    browser suite: none\n' "$3"; fi
    printf 'docs to read first: AGENTS.md\n\n## Dispatch\ndispatch: %s\nturnpikes: style, bug, security\n' "$1"; } > "$1/brief.md"
}
logged() { "$HERE/log-action.sh" "$1" coachman "${@:2}" >/dev/null; }
findings() { local k; for k in $(seq 1 "$2"); do logged "$1" finding "src/f$k.ts:$k" "style P3 r1 style luna reading: finding $k"; done; }
sort_file() { local d=$1; shift; lines "$@" > "$d/style-sort.md"; }
R=$tmp/proj/.postmaster/runs

# An npm project. The gate reaches check, its pre script, lint through npm run, test:unit through
# run-s's glob, typos through pnpm, format:check, and the file precheck runs, less its comments.
# It never reaches format (an echoed hint), build (bun's own bundler), test (bun's own runner),
# test:unit:slow (a glob's * stays within a :-part), docs, or a file git does not track.
npm=$tmp/npm; mkdir -p "$npm/scripts" "$npm/node_modules/.bin"
cat > "$npm/package.json" <<'EOF'
{
  "devDependencies": { "eslint": "9.0.0" },
  "scripts": {
    "check": "tsc --noEmit && npm run lint && run-s 'test:*' && npm run format:check && npm run quoted && touch gate-ran",
    "precheck": "node scripts/versions.js && ./node_modules/.bin/helper",
    "lint": "cross-env NODE_ENV=ci biome check . && pnpm typos # oxfmt is not run yet",
    "typos": "typos . > scripts/typos.txt",
    "test:unit": "bun test && bun build ./src/index.ts",
    "test:unit:slow": "jest",
    "format:check": "prettier --check . || (echo 'run npm run format, to fix what eslint finds' && exit 1)",
    "quoted": "sh -c 'tsc --noEmit # stylua later'",
    "format": "eslint --fix .",
    "build": "hadolint Dockerfile",
    "build:types": "tsc -p types",
    "nbsp": "node -e \"console.log('a b : c')\" && dprint check",
    "test": "vitest",
    "docs": "markdownlint docs"
  }
}
EOF
lines '/**' ' * xo would be stricter' ' */' '// oxlint would catch more here' \
  'require("child_process").execSync("stylelint src") // knip later' > "$npm/scripts/versions.js"
lines 'jscpd is written here, and nothing runs it' > "$npm/scripts/typos.txt"
lines '#!/bin/sh' 'standard --fix .' > "$npm/node_modules/.bin/helper"
lines 'node_modules/' > "$npm/.gitignore"
repo_at "$npm" T-1 T-2 T-6 T-7 T-8 T-16 T-20 T-21 T-28

# A make project. The gate reaches check's prerequisites, a variable's command, a variable set with
# :::=, an included makefile's rule, a recursive make in web/ and the script its recipe runs there,
# a recipe past a conditional, and a script a recipe runs. Never fmt, the root's ci.sh, or a tool a
# script names only in a comment.
mk=$tmp/make; mkdir -p "$mk/scripts" "$mk/mk" "$mk/web"
printf '%b\n' 'SHELLCHECK ?= shellcheck' 'LINTER :::= yamllint' '.PHONY: check lint docs test' \
  'check: lint docs test' 'lint:' '\t@$(SHELLCHECK) scripts/*.sh' '\t$(LINTER) .' 'ifdef CI' '\t$(MAKE) -C web lint' 'endif' \
  '\ttouch make-ran' 'docs:' '\t-markdownlint docs' 'test:' '\t./scripts/test.sh' 'fmt:' '\truff format .' 'include mk/*.mk' > "$mk/Makefile"
printf '%b\n' 'docs: spell' 'spell:' '\tcspell .' > "$mk/mk/extra.mk"
printf '%b\n' 'lint:' '\t./ci.sh' > "$mk/web/Makefile"
lines '#!/bin/sh' 'stylelint .' > "$mk/web/ci.sh"
lines '#!/bin/sh' 'prettier --check .' > "$mk/ci.sh"
lines '#!/bin/sh' '# pylint is not run here' 'bats test' > "$mk/scripts/test.sh"
repo_at "$mk" T-4 T-24 T-27

# Workspaces: npm's --workspaces and -w, turbo, pnpm -r, and a cd into one package.
mono=$tmp/mono; mkdir -p "$mono/packages/web" "$mono/packages/docs"
lines '{"name": "mono", "workspaces": ["packages/*"], "scripts": {"check": "npm run lint --workspaces && turbo run typecheck && pnpm -r test && npm -w packages/docs run spell", "lint": "tsc"}}' > "$mono/package.json"
lines '{"name": "web", "scripts": {"lint": "eslint .", "typecheck": "tsc -b", "test": "vitest", "fmt": "dprint check"}}' > "$mono/packages/web/package.json"
printf '\357\273\277{"name": "@x/docs", "scripts": {"spell": "cspell .", "lint": "markdownlint ."}}\n' > "$mono/packages/docs/package.json"
repo_at "$mono" T-10 T-11

# just, wrappers and interpreters, a runner's config, and a long file.
other=$tmp/other; mkdir -p "$other/scripts"
printf '%s\n' 'default: check' '' 'check: lint' '    cargo test' '' 'lint:' '    cargo clippy -- -D warnings' '' 'fmt:' '    cargo fmt --check' > "$other/justfile"
lines 'ruff check .' > "$other/scripts/lint.sh"
lines 'require("child_process").execSync("stylelint x")' > "$other/scripts/lint.js"
lines 'execSync(`eslint ${dir}`)' > "$other/scripts/check.ts"
lines 'shellcheck *.sh' > "$other/scripts/check.sh"
lines 'repos:' '  - repo: https://github.com/astral-sh/ruff-pre-commit' '    hooks:' '      - id: ruff' '  # - id: mypy' > "$other/.pre-commit-config.yaml"
{ for k in $(seq 1 60); do echo "echo step $k"; done; echo 'vale .'; } > "$other/scripts/big.sh"
lines 'A readme that names no linter.' > "$other/README.md"
lines '{"packageManager": "yarn@4.1.0", "scripts": {"check": "yarn lint", "prelint": "sort-package-json --check", "lint": "eslint ."}}' > "$other/package.json"
repo_at "$other" T-12 T-13 T-14 T-18 T-23 T-25 T-26

d=$R/T-1; waybill "$d" "$npm" "npm run check"
logged "$d" dispatch luna thread-1
logged "$d" finding src/a.ts:12 "style P3 r1 style luna reading: a list named map"
logged "$d" finding src/b.ts:40 "gating P1 r1 style,bug luna,sol execution: an off-by-one the style lens found"
logged "$d" finding src/c.ts:7 "style P3 r2 bug sol reading: a let never reassigned, reported under bug"
logged "$d" apply abc1234 "src/b.ts:40"
none=$R/T-2; waybill "$none" "$npm" "npm run check"
logged "$none" finding src/b.ts:40 "gating P2 r1 bug luna reading: style is named here, and the finding is gating"

echo "positive controls: a run's style findings"
run "$self" count "$d";                 is "a run with two style findings counts two" 0 2
run "$self" list "$d"
is "they are listed in the order logged, whichever lens found them, and not the gating one the style lens found" 0 \
  "$(lines 'S1 src/a.ts:12 P3 r1 style luna reading: a list named map' 'S2 src/c.ts:7 P3 r2 bug sol reading: a let never reassigned, reported under bug')"
back=$R/T-19; mkdir -p "$back"
logged "$back" finding src/a.ts:12 "style P3 r1 style luna reading: a name"
logged "$back" finding src/a.ts:12:5 "style P3 r1 style luna reading: another name on that line, with a column"
logged "$back" finding src/a.ts:12 "gating P2 r2 bug sol reading: argued back to gating"
run "$self" list "$back"
is "a finding argued back to gating is no style finding, and one at a column of that line stays one" 0 \
  "S1 src/a.ts:12:5 P3 r1 style luna reading: another name on that line, with a column"

echo "negative controls: a run's style findings"
run "$self" count "$none";              is "a run whose findings are all gating counts none" 0 0
run "$self" list "$none";               is "and lists none" 0 ""
before=$(wc -l < "$d/actions.jsonl")
"$HERE/log-action.sh" "$d" coachman finding src/x.ts:1 "P2 r1 bug luna reading: no class" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && [ "$(wc -l < "$d/actions.jsonl")" -eq "$before" ] && grep -qF "gating or style" "$tmp/err" \
  && ok "log-action.sh refuses a finding with no class, and writes nothing" || fail "log-action.sh refuses a finding with no class, and writes nothing (exit $rc)" "$(cat "$tmp/err")"
bad=$R/T-3; mkdir -p "$bad"; cp "$d/actions.jsonl" "$bad/"
printf '{"action":"finding","target":"src/x.ts:1","detail":"advisory P3 r1 style luna reading: old words"}\n' >> "$bad/actions.jsonl"
run "$self" count "$bad"
is "a finding logged with another class is named, and nothing is counted" 2 'actions.jsonl line 6: a finding whose detail opens with "advisory", not gating or style'
run "$self" count "$R";                 has "no action log is refused, never read as no findings" 1 "no action log at"

echo "positive controls: what the gate runs"
run "$self" gate "$d"
for want in "gate: npm run check" "package.json scripts.precheck: node scripts/versions.js" \
            "package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos" \
            "package.json scripts.typos: typos . > scripts/typos.txt" "package.json scripts.test:unit: bun test" \
            "package.json scripts.format:check: prettier" 'scripts/versions.js: require("child_process").execSync("stylelint src")'; do
  has "the gate reaches: $want" 0 "$want"
done
m=$R/T-4; waybill "$m" "$mk" 'make -j$(nproc) -j 4 check'
run "$self" gate "$m"
for want in "Makefile lint: shellcheck scripts/*.sh" "Makefile lint: yamllint ." "web/Makefile lint: ./ci.sh" "web/ci.sh: stylelint ." \
            "Makefile lint: touch make-ran" "Makefile docs: markdownlint docs" "Makefile spell: cspell ." "scripts/test.sh: bats test"; do
  has "a make gate reaches: $want" 0 "$want"
done
t=$R/T-24; waybill "$t" "$mk" "make -j 4"; run "$self" gate "$t"
has "make -j 4 runs the default goal, not a target named 4" 0 "Makefile lint: shellcheck scripts/*.sh"
t=$R/T-27; waybill "$t" "$mk" 'make -j$(nproc) fmt'; run "$self" gate "$t"
has "a substitution in a make flag leaves the target named" 0 "Makefile fmt: ruff format ." "shellcheck"
t=$R/T-10; waybill "$t" "$mono" "npm run check"; run "$self" gate "$t"
for want in "packages/web/package.json scripts.lint: eslint ." "packages/docs/package.json scripts.lint: markdownlint ." \
            "packages/web/package.json scripts.typecheck: tsc -b" "packages/web/package.json scripts.test: vitest" \
            "packages/docs/package.json scripts.spell: cspell ."; do
  has "workspaces reached by --workspaces, turbo, pnpm -r and -w: $want" 0 "$want"
done
t=$R/T-11; waybill "$t" "$mono" "cd packages/web && npm run lint"; run "$self" gate "$t"
has "a cd before npm run takes the script from that package" 0 "packages/web/package.json scripts.lint: eslint ." "scripts.lint: tsc"
t=$R/T-12; waybill "$t" "$other" "just"; run "$self" gate "$t"
has "just runs its first recipe, and each recipe's prerequisites" 0 "justfile lint: cargo clippy -- -D warnings" "cargo fmt"
t=$R/T-13; waybill "$t" "$other" "env CI=1 ./scripts/lint.sh && cross-env CI=1 node scripts/lint.js && node -r ts-node/register scripts/check.ts && bash -euo pipefail scripts/check.sh"
run "$self" gate "$t"
for want in "scripts/lint.sh: ruff check ." 'scripts/lint.js: require("child_process").execSync("stylelint x")' \
            'scripts/check.ts: execSync(`eslint ${dir}`)' "scripts/check.sh: shellcheck *.sh"; do
  has "past env, cross-env and an interpreter's flags: $want" 0 "$want"
done
t=$R/T-14; waybill "$t" "$other" "pre-commit run --all-files"; run "$self" gate "$t"
has "pre-commit's config is reached, less its comments" 0 ".pre-commit-config.yaml: - id: ruff" "mypy"
t=$R/T-7; waybill "$t" "$npm" "npm run build:types && npm run lint"; run "$self" gate "$t"
has "a build: inside the gate is part of it" 0 "package.json scripts.build:types: tsc -p types"
t=$R/T-8; waybill "$t" "$npm" "npm run nbsp"; run "$self" gate "$t"
has "a no-break space in a quoted word is read, not recursed into" 0 "package.json scripts.nbsp:"
t=$R/T-20; waybill "$t" "$npm" "" '- **gate:** `npm run lint`  **build:** none    browser suite: none'; run "$self" gate "$t"
has "a gate in bold and backticks, on a bullet, is read" 0 "package.json scripts.lint: cross-env"
t=$R/T-21; waybill "$t" "$npm" "" 'gate : npm run lint  build: none'; run "$self" gate "$t"
has "a gate written gate :, is read" 0 "package.json scripts.lint: cross-env"
t=$R/T-28; mkdir -p "$t"
printf '## Project profile\n- **repo:** `%s`  default branch: main\n- **gate:** `npm run lint`\n' "$npm" > "$t/brief.md"; run "$self" gate "$t"
has "a repo in backticks is read" 0 "package.json scripts.lint: cross-env"
t=$R/T-23; waybill "$t" "$other" "sh scripts/big.sh"; run "$self" gate "$t"
has "a long file is shown in part" 0 "scripts/big.sh: 41 more lines, read and not shown" "vale"
findings "$t" 1; sort_file "$t" "S1 linter vale enable Vale.Spelling: the file's last line runs vale"
run "$self" check "$t";                 has "and read whole" 0 "S1: linter vale enable Vale.Spelling"
t=$R/T-26; waybill "$t" "$other" "npm run lint"; run "$self" gate "$t"
has "npm runs a script's pre script" 0 "package.json scripts.prelint: sort-package-json --check"

echo "negative controls: what the gate runs"
run "$self" gate "$d"
for not in "scripts.format: " scripts.docs "scripts.build: " "scripts.test: " test:unit:slow jest vitest hadolint oxfmt oxlint xo knip standard jscpd decoy; do
  has "the gate does not reach $not" 0 "gate: npm run check" "$not"
done
run "$self" gate "$m"
for not in ruff pylint prettier decoy "Makefile 4"; do has "a make gate does not reach $not" 0 "Makefile lint:" "$not"; done
run "$self" gate "$R/T-10";            has "a workspace script nothing runs is not reached" 0 "packages/web" "dprint"
t=$R/T-25; waybill "$t" "$other" "yarn check"; run "$self" gate "$t"
has "Yarn 2 and later run no pre script" 0 "package.json scripts.lint: eslint ." "sort-package-json"
[ ! -e "$npm/gate-ran" ] && [ ! -e "$mk/make-ran" ] && [ ! -e "$tmp/gate-ran" ] && [ ! -e "$tmp/make-ran" ] \
  && ok "nothing the gate runs was run" || fail "nothing the gate runs was run"
g=$R/T-5; waybill "$g" "$npm" ""
run "$self" gate "$g";                  is "a waybill that names no gate is refused" 2 "the waybill's Project profile names no gate"
g=$R/T-99; waybill "$g" "$npm" "npm run check"
run "$self" gate "$g";                  has "a run with no branch of its name is refused, never read from the checkout" 1 "no branch T-99 in"

echo "positive controls: the sort"
sort_file "$d" "# Style sort: T-1" "" "- S2 linter biome enable style/useConst: biome flags a let that is never reassigned" \
  "- S1 docs AGENTS.md: the project names a collection by what it holds, and nothing says so"
run "$self" check "$d"
is "a sort of every finding passes, and prints its proposals and counts" 0 \
  "$(lines 'S2: linter biome enable style/useConst' 'S1: docs AGENTS.md' \
           'sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 0 new linters proposed')"
five=$R/T-6; waybill "$five" "$npm" "npm run check"; findings "$five" 5
sort_file "$five" "S1 linter biome enable style/useConst: biome flags a let never reassigned" "S2 linter biome enable style/useConst: the same rule" \
  "S3 neither: quoting needs a shell linter, proposed below" "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks" \
  "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one" \
  "N1 new-linter shellcheck S3: the gate runs no shell linter"
good=$(cat "$five/style-sort.md")
run "$self" check "$five"
is "findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal" 0 \
  "$(lines 'S1 S2: linter biome enable style/useConst' 'S5: linter biome write plugin::no-needless-return' \
           'S4: docs CONTRIBUTING.md' 'N1: new-linter shellcheck [for S3]' 'S3: neither' \
           'sorted 5 style findings: 3 to a linter, 1 to the docs, 1 to neither; 1 new linter proposed')"
redo() {  # redo <label> <exit> <text a line must hold> <sed script applied to the good sort> [<text no line may hold>]
  printf '%s\n' "$good" | sed "$4" > "$five/style-sort.md"; run "$self" check "$five"; has "$1" "$2" "$3" "${5:-}"
}
redo "a linter run by a file the gate runs counts as run" 0 "S1: linter stylelint enable" '1s/biome enable style\/useConst/stylelint enable declaration-no-important/'
redo "a linter's case and markup are set aside" 0 "S1 S2: linter biome enable style/useConst" '1s/linter biome/linter `Biome`/'
redo "a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate" 0 \
  "N1: new-linter eslint [for S3; not in the gate]" 's/new-linter shellcheck S3:/new-linter eslint S3 not-in-gate:/'
sort_file "$five" "S1 linter shellcheck enable SC2086: a make gate runs shellcheck" "S2 neither: x" "S3 neither: x" "S4 neither: x" "S5 neither: x"
cp "$five/actions.jsonl" "$five/style-sort.md" "$m/"
run "$self" check "$m";                 has "a linter a make target runs counts as run" 0 "S1: linter shellcheck enable SC2086"
via=$R/T-18; waybill "$via" "$other" "tsc"; findings "$via" 1
sort_file "$via" "S1 linter ruff enable E501 via .pre-commit-config.yaml: pre-commit runs ruff, and this gate calls it some other way"
run "$self" check "$via";               has "a linter named via a file of the branch that names it" 0 "S1: linter ruff enable E501 [via .pre-commit-config.yaml]"
run "$self" check "$none";              is "a run with no style findings and no sort has nothing to sort" 0 "no style findings, so nothing to sort"
zero=$R/T-22; mkdir -p "$zero"; findings "$zero" 2; sort_file "$zero" "S1 neither: one" "S2 neither: two"
run "$self" check "$zero"
is "a sort with no linter and no docs line counts none of either" 0 \
  "$(lines 'S1 S2: neither' 'sorted 2 style findings: 0 to a linter, 0 to the docs, 2 to neither; 0 new linters proposed')"
printf '\357\273\277S1 neither: one\nS2 neither: two\n' > "$zero/style-sort.md"
run "$self" check "$zero";              has "a sort that opens with a byte-order mark is read" 0 "S1 S2: neither"
led=$tmp/led/.postmaster/runs; past=$led/T-15; mkdir -p "$past"; now=$led/T-16; waybill "$now" "$npm" "npm run check"; findings "$now" 2
logged "$past" ticket-create 80 "style proposal: linter biome enable style/useConst"
logged "$past" ticket-create 81 "linter biome enable style/useConst, filed another way"
logged "$past" note T-15 "style proposal declined: docs AGENTS.md: not now"
logged "$past" note T-15 "style proposal asked: new-linter shellcheck"
sort_file "$now" "S1 linter biome enable style/useConst: a" "S2 docs AGENTS.md: b" "N1 new-linter shellcheck S2: c"
run "$self" check "$now"
is "each proposal carries what the project's ledger last records of it, from any run" 0 \
  "$(lines 'S1: linter biome enable style/useConst [filed 80 in T-15]' 'S2: docs AGENTS.md [declined in T-15]' \
           'N1: new-linter shellcheck [for S2; asked in T-15]' \
           'sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 1 new linter proposed')"

echo "negative controls: the sort, each fault named"
redo "a finding left out"                     2 "S4 is not sorted"                                  '/^S4 /d'
redo "a finding sorted twice"                 2 "S2 is sorted twice, on lines 2, 7"                 '$a S2 neither: again'
redo "an id that is no style finding"         2 "line 7: S9 is not a style finding"                 '$a S9 neither: no such finding'
redo "a line with no reason"                  2 "line 3: S3 has no reason"                          's/^S3 neither: .*/S3 neither:/'
redo "a kind that is not one of the three"    2 "line 4 is not a sort line"                         's/^S4 docs/S4 convention/'
redo "a linter line with no enable or write"  2 "line 1 is not a sort line"                         '1s/biome enable/biome/'
redo "prose between the lines"                2 "line 7 is not a sort line: These are"              '$a These are the findings.'
redo "and the forms are then given"           2 'a sort line is one of: "S<n> linter'              '$a These are the findings.'
redo "a linter only an echoed hint would reach" 2 "S1 names eslint, which \`gate\` does not show"     '1s/biome enable style\/useConst/eslint enable prefer-const/'
redo "a linter only a comment names"          2 "S1 names oxlint, which \`gate\` does not show"     '1s/biome enable style\/useConst/oxlint enable prefer-const/'
redo "a linter only a shell comment names"    2 "S1 names oxfmt, which \`gate\` does not show"      '1s/biome enable style\/useConst/oxfmt enable x/'
redo "a linter only a comment in a quoted command names" 2 "S1 names stylua, which \`gate\` does not show" '1s/biome enable style\/useConst/stylua enable x/'
redo "a linter only bun's own build would reach" 2 "S1 names hadolint, which \`gate\` does not show"   '1s/biome enable style\/useConst/hadolint enable DL3008/'
redo "a new linter the gate already runs"     2 "N1 proposes BIOME, which the gate already runs"    's/new-linter shellcheck/new-linter BIOME/'
redo "a new linter the project already has"   2 "N1 proposes eslint, which the project already has (package.json)" 's/new-linter shellcheck/new-linter eslint/'
redo "a new linter proposed twice"            2 "N2 proposes shellcheck again, as N1 on line 6 does" '$a N2 new-linter shellcheck S4: again'
redo "a new linter for no such finding"       2 "N1 names S9, which is not a style finding"         's/shellcheck S3/shellcheck S3,S9/'
redo "a new linter for no finding at all"     2 "N1 names no finding the linter would enforce"      's/new-linter shellcheck S3:/new-linter shellcheck not-in-gate:/'
sort_file "$via" "S1 linter ruff enable E501 via README.md: a file that does not name it"
run "$self" check "$via";               has "a via file that does not name the linter" 2 "S1 names ruff via README.md, which does not name ruff"
sort_file "$via" "S1 linter ruff enable E501 via ruff.toml: a file the branch does not have"
run "$self" check "$via";               has "a via file the branch does not have" 2 "S1 names ruff via ruff.toml, which the run's branch does not have"
rm -f "$five/style-sort.md"; run "$self" check "$five"
has "no sort at all, with findings to sort"   2 "no style-sort.md in $five, and 5 style findings to sort"
waybill "$five" "$npm" ""; printf '%s\n' "$good" > "$five/style-sort.md"; run "$self" check "$five"
has "a linter line with no gate to check it against" 2 "S1 names biome, and the waybill's Project profile has no gate"
cp "$five/style-sort.md" "$none/"; run "$self" check "$none"
has "a sort for a run with no style findings" 2 "S1 is not a style finding of this run"
run "$self" check "$tmp/nowhere";       has "no dispatch directory is a usage error" 1 "no dispatch directory"

echo "the gate is read as the run's branch has it"
python3 -c 'import sys; p = sys.argv[1]; s = open(p).read(); open(p, "w").write(s.replace("cross-env NODE_ENV=ci biome check .", "eslint ."))' "$npm/package.json"
commit "$npm" "switch to eslint"; G -C "$npm" branch T-17
t=$R/T-17; waybill "$t" "$npm" "npm run lint"; run "$self" gate "$t"
has "a branch cut after a change reads the change" 0 "package.json scripts.lint: eslint ." "biome"
waybill "$d" "$npm" "npm run lint"; run "$self" gate "$d"
has "a run's own branch reads as it was, whatever the checkout now holds" 0 "package.json scripts.lint: cross-env NODE_ENV=ci biome check ." "scripts.lint: eslint"

echo "the runbooks agree with this script"
subs=$(cat "$SKILL"/*.md | grep -o 'style-findings\.sh [a-z-]*' | awk '{print $2}' | sort -u | paste -sd' ' -)
[ "$subs" = "check count gate list" ] && ok "the runbooks name list, count, gate and check, and no other subcommand" \
  || fail "the runbooks name list, count, gate and check, and no other subcommand" "$subs"
lines 'run `<tool>/scripts/style-findings.sh sort <dispatch>`' > "$tmp/planted.md"
[ "$(grep -o 'style-findings\.sh [a-z-]*' "$tmp/planted.md" | awk '{print $2}')" = sort ] \
  && ok "and a subcommand the script lacks would be caught" || fail "and a subcommand the script lacks would be caught"
awk '/^\*\*Sort the style findings\.\*\*/ {f = 1} f && /^```/ {n++; next} f && n == 1 {print} n == 2 {exit}' "$SKILL/coachman.md" \
  | sed -e 's/<n>/1/g; s/<m>/2/g; s/\[,S2\.\.\.\]//; s/<linter>/biome/; s/<rule>/style\/useConst/; s/<doc>/AGENTS.md/' \
        -e 's/<file>/biome.json/; s/<reason>/a reason/' > "$tmp/forms"
run core forms "$tmp/forms"
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | grep -c '^ok  ')" -ge 7 ] && ! printf '%s\n' "$out" | grep -q '^bad ' \
  && ok "every form coachman.md gives is a sort line" || fail "every form coachman.md gives is a sort line" "$out"
lines 'S1 lint biome enable style/useConst: a reason' > "$tmp/forms"; run core forms "$tmp/forms"
has "and a form that is not one would be caught" 0 "bad S1 lint biome"
says() { tr '\n' ' ' < "$1" | tr -s ' ' | grep -qF -- "$2"; }   # across line breaks
for want in "converge on a prescribed one-line fix for a gating finding" "is a finding about the LANE: log a \`note\`" \
            "for style, how many findings go to the ship card's Style residue, as"; do
  says "$SKILL/coachman.md" "$want" && ok "coachman.md says: $want" || fail "coachman.md says: $want"
done
for want in "Check the style sort too, once the last leg's process has exited" "--title \"<title>\" --project <repo>\`, and log \`ticket-check\`" \
            "log a \`note\` with \`style proposal asked: <proposal>\` for each draft shown" "and carry on with the stream"; do
  says "$SKILL/postmaster.md" "$want" && ok "postmaster.md says: $want" || fail "postmaster.md says: $want"
done
awk '/^5\. \*\*Put the style sort to the user/,/^6\. /' "$SKILL/postmaster.md" > "$tmp/step5"
! says "$tmp/step5" "ESCALATION.md" && ok "and the style sort is no escalation" || fail "and the style sort is no escalation" "$(cat "$tmp/step5")"
lines 'When the lanes converge on a prescribed one-line fix, apply it and re-review.' > "$tmp/old.md"
! says "$tmp/old.md" "one-line fix for a gating finding" && ok "and the rule's old wording would be caught" || fail "and the rule's old wording would be caught"

echo "the cleanup asks nothing at a terminal"
tty_run() { timeout 3 python3 -c 'import pty, sys; pty.spawn(sys.argv[1:])' "$@" </dev/null >/dev/null 2>&1; }
mkdir -p "$tmp/ro/a"; : > "$tmp/ro/a/f"; chmod a-w "$tmp/ro/a/f"
tty_run bash -c "$(declare -f clean); clean \"\$1\"" _ "$tmp/ro"
[ ! -e "$tmp/ro" ] && ok "at a terminal it removes a file git made read-only, and asks nothing" \
  || fail "at a terminal it removes a file git made read-only, and asks nothing"
mkdir -p "$tmp/ro2"; : > "$tmp/ro2/f"; chmod a-w "$tmp/ro2/f"
tty_run bash -c 'rm -r -- "$1" 2>/dev/null' _ "$tmp/ro2"
[ -e "$tmp/ro2/f" ] && ok "one that reads the terminal would ask instead, and remove nothing" \
  || fail "one that reads the terminal would ask instead, and remove nothing"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
