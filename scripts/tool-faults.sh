#!/usr/bin/env bash
# Turn the faults a run met in postmaster itself into tickets on postmaster's own tracker, once
# the run has closed. A run never fixes postmaster: each fault is logged as it happens, as a
# `tool-fault` action (scripts/log-action.sh), and this script collects them afterwards.
#
#   tool-faults.sh harvest <dispatch>             group the run's tool-fault lines, one entry per
#                                                 distinct fault; draft a ticket for each; look
#                                                 each up on postmaster's own tracker
#   tool-faults.sh comment <dispatch> <id> [<ticket>]
#                                                 comment on a known fault's ticket that it was
#                                                 seen again, naming the run by its public id; with
#                                                 <ticket>, on that one, on the user's word that
#                                                 it holds the same fault
#   tool-faults.sh file <dispatch> <id>           file a new fault's draft as a ticket
#   tool-faults.sh decline <dispatch> <id> <word> the user said no: recorded, and nothing filed
#   tool-faults.sh --self-test
#
# <dispatch> is a closed run's directory (stage done or abandoned), or <runs>/postmaster for the
# faults the postmaster met outside any run. <runs>/postmaster never closes, so each harvest of
# it takes the tool-fault lines logged since the last, under a run id of their own.
#
# Repeats of one fault are grouped: the same postmaster file, and the same --failed text once
# case, punctuation, numbers, ids, other paths than postmaster's own and the target's names are
# set aside. A fault's id, tf-<8 hex>, is taken from those two, so one fault has one id in every
# run. A ticket holds a fault when its title, body or a comment on it carries the id: the title
# of a ticket this script files carries it, and so does every comment it makes.
#
# postmaster's own tracker is GitHub, and only this: the repository the origin of postmaster's
# own checkout names, the directory above this script, when that is the top of a git checkout
# and the user administers the repository (github.sh access says ADMIN). Anywhere else, the
# faults stay in the run's records.
#
# A ticket carries the postmaster file, the failure (--failed) and the proposed fix (--fix), and
# nothing else of a fault, once made safe to publish. Postmaster's own paths, links, file names,
# ticket keys and ids are kept; the target's names are withheld, and so is any other path, link,
# address or ticket key; any run of four words the waybill holds and postmaster's own text does
# not; any word of the waybill that postmaster's own text never uses; any word it never uses
# that is capitalised or not ASCII; and any token that looks like code, such as one mixing
# letters and digits, that postmaster's own text never uses. The run is named by a public id
# kept in <dispatch>/tool-faults.json, where grep finds it again, and never by its directory,
# whose name is the target's ticket. A comment is written by this script alone, from ids. A
# draft is filed as the harvest wrote it, or, if it was changed since, only when it is still
# safe to publish; and only when scripts/ticket-check.sh passes it.
#
# Writes <dispatch>/tool-faults.json (the run ids, how many tool-fault lines have been harvested,
# and each fault's last state), and a draft per fault at <dispatch>/tool-faults/<run id>/<id>.md
# with its title in <id>.title, left alone once written so a draft the user changed stays
# changed. harvest logs a note of what it found. A fault's state, as harvest prints it:
#   known <ticket>   a ticket holds it: comment
#   new              none does: show the user the draft the line names; "like" names the other
#                    fault tickets for the same file
#   asked            new at an earlier harvest of the same run, and not answered since
#   unchecked        the tracker could not be read; harvest again later
#   kept             postmaster has no tracker this script can reach, and the line says why
#   commented, filed, declined   done, as the run's log records
#
#   exit 0  done; harvest prints a line for the run, then one per fault, then any notes
#   exit 1  usage; no such dispatch, fault or draft; a run still open; the tracker could not
#           be read or refused a write; or the log could not be written
#   exit 2  comment or file refused: a changed draft is not safe to publish, a draft fails
#           scripts/ticket-check.sh, a fault to comment on has no ticket, or one to file has one
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
usage() { echo "usage: tool-faults.sh harvest <dispatch> | comment <dispatch> <id> [<ticket>] | file <dispatch> <id> | decline <dispatch> <id> <the user's word> | --self-test" >&2; exit 1; }

run_py() {  # run_py <command> <dispatch> [args...]
  python3 - "$HERE" "$TOOL" "$@" <<'PY'
import datetime as dt, hashlib, json, os, pathlib, re, secrets, subprocess, sys, tempfile

HERE, TOOL = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
CMD, ARGS = sys.argv[3], sys.argv[4:]


def die(msg, code=1):
    print("tool-faults: " + msg, file=sys.stderr)
    sys.exit(code)


if not pathlib.Path(ARGS[0]).is_dir():
    die("no such dispatch directory: %s" % ARGS[0])
D = pathlib.Path(ARGS[0]).resolve()
LOG, STATE, DRAFTS = D / "actions.jsonl", D / "tool-faults.json", D / "tool-faults"
ONGOING = D.name == "postmaster"                    # <runs>/postmaster: it never closes
ASKING = ("new", "asked", "unchecked", "kept")      # a fault whose draft may yet be filed
DONE = re.compile(r"^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\b")


def run(argv):
    return subprocess.run([str(a) for a in argv], capture_output=True, text=True)


def git(where, *args):
    r = run(["git", "-C", where, *args])
    return r.stdout.strip() if r.returncode == 0 else ""


def why(r):
    return ((r.stderr or r.stdout).strip().splitlines() or ["exit %d" % r.returncode])[-1]


def closed():
    if ONGOING:
        return
    try:
        stage = json.loads((D / "manifest.json").read_text()).get("stage")
    except (OSError, ValueError, AttributeError):
        die("%s has no manifest to read" % D)
    if stage not in ("done", "abandoned"):
        die("the run is still open (stage %s); its faults are harvested when it closes" % stage)


def read_log():
    """The log's actions, and the numbers of its lines that are not one. Only a newline ends a line."""
    entries, bad = [], []
    try:
        text = LOG.read_bytes().decode("utf-8", "replace")
    except OSError:
        return entries, bad
    for n, line in enumerate(text.split("\n"), 1):
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except ValueError:
            e = None
        if isinstance(e, dict):
            entries.append(e)
        else:
            bad.append(n)
    return entries, bad


def fields(e):
    return e["fault"] if isinstance(e.get("fault"), dict) else {}


def log(action, target, detail):
    r = run([HERE / "log-action.sh", D, "postmaster", action, target, detail])
    if r.returncode:
        die("the log could not be written: %s" % why(r))


def load_state():
    try:
        st = json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}
    return st if isinstance(st, dict) else {}


def save_state(st):
    fd, tmp = tempfile.mkstemp(dir=D)
    os.close(fd)
    with open(tmp, "w") as f:
        json.dump(st, f, indent=2)
        f.write("\n")
    os.replace(tmp, STATE)


def postmaster_run():
    try:
        pm = json.loads((D / "run.json").read_text()).get("postmaster")
    except (OSError, ValueError, AttributeError):
        return {}
    return pm if isinstance(pm, dict) else {}


def own_ids(st):
    """The ids postmaster itself writes into a draft or a comment: the run ids, and its commit."""
    commit = str(postmaster_run().get("commit") or "")
    return {r["run_id"] for r in st.get("runs", [])} | ({commit, commit[:12]} if commit else set())


def meta():
    pm = postmaster_run()
    if not pm.get("commit"):
        return ""
    return ", which ran postmaster %s%s" % (str(pm["commit"])[:12], " with uncommitted changes" if pm.get("uncommitted_changes") else "")


def seen(n):
    return "once" if n == 1 else "%d times" % n


def new_id():
    while True:
        rid = secrets.token_hex(5)
        if re.search(r"\d", rid):
            return rid


# --- whose repository is whose ----------------------------------------------------------------

def own_checkout():
    """True when postmaster here is the top of a git checkout of its own, not a copy inside another."""
    top = git(TOOL, "rev-parse", "--show-toplevel")
    return bool(top) and os.path.realpath(top) == os.path.realpath(TOOL)


def common_dir(where):
    out = git(where, "rev-parse", "--git-common-dir")
    return os.path.realpath(os.path.join(str(where), out)) if out and "\n" not in out else ""


def remote(where):
    """A checkout's origin as (host, path), the host lower-cased and the path without .git, or None.
    A remote that is a local path has no host."""
    url = git(where, "remote", "get-url", "origin")
    if not url:
        return None
    m = (re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)(?::\d+)?/+(.*?)(?:\.git)?/*$", url)
         or re.match(r"^(?:[^@/:]+@)?([^/:]+):(?!//)(.*?)(?:\.git)?/*$", url))
    if m and m.group(2):
        return m.group(1).lower(), m.group(2)
    return "", url.rstrip("/")


def same_repo(repo):
    """True when the target is postmaster's own repository."""
    if not own_checkout():
        return False
    a, b = common_dir(repo), common_dir(TOOL)
    if a and a == b:
        return True
    ra, rb = remote(repo), remote(TOOL)
    return bool(ra and rb and ra[0] and ra[0] == rb[0] and ra[1].casefold() == rb[1].casefold())


def profile_repo(waybill):
    """The target's checkout: the repo line of the waybill's last Project profile section, which
    comes after the ticket's own text."""
    starts = [m.end() for m in re.finditer(r"^## Project profile[ \t]*$", waybill, re.M)]
    if not starts:
        return None
    body = waybill[starts[-1]:]
    end = re.search(r"^## ", body, re.M)
    m = re.search(r"^repo:[ \t]*(\S.*?)(?:[ \t]{2,}\S.*)?[ \t]*$", body[:end.start()] if end else body, re.M)
    return pathlib.Path(os.path.expanduser(m.group(1).strip())) if m else None


# --- what may be published ----------------------------------------------------------------------

TOKEN = re.compile(r"[~<>\w.@+/-]+")                 # a word, a path or a file name, whole
URL = re.compile(r"\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\s)\]>'\"`]+")
EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
IPV4 = re.compile(r"(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])")
KEY = re.compile(r"(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d+(?![\w-])")      # a tracker's ticket key, PM-12
FILELIKE = re.compile(r"[\w-]+(?:\.[\w-]+)*\.[A-Za-z]\w{1,7}")
FAULT_ID = re.compile(r"\btf-[0-9a-f]{8}\b")
HEX = re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b")
MARK = re.compile(r"\[(?:path|project|ticket text|ticket|code|link|address|withheld)\]")
WORD = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)*")
WTOK = re.compile(r"\w+")
TICKS = re.compile(r"`([^`\n]+)`")
HELD = re.compile("\x01(\\d+)\x02")
N = 4


def words(text):
    return [w.casefold() for w in WORD.findall(text)]


def grams(ws):
    return {tuple(ws[i:i + N]) for i in range(len(ws) - N + 1)}


class Safe:
    """What of a fault may be published: postmaster's own words, paths and ids, and nothing of the target's."""

    def __init__(self, ids=()):
        files = [p for sub in ("scripts", "skills", "wiki") if (TOOL / sub).is_dir()
                 for p in sorted((TOOL / sub).rglob("*")) if p.is_file()]
        files += sorted(TOOL.glob("*.md")) + [TOOL / "config.example.toml"]
        texts = []
        for p in files:
            try:
                texts.append(p.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError):
                pass
        own = "\n".join(texts)
        ws = words(own)
        self.vocab, self.grams = set(ws), grams(ws)
        self.tokens = {t.casefold() for t in WTOK.findall(own)}
        toks = TOKEN.findall(own)
        self.paths = {t.casefold() for t in toks if "/" in t}
        self.files = {t.casefold() for t in toks if FILELIKE.fullmatch(t)} | {p.name.casefold() for p in files}
        self.urls = {u.casefold().rstrip(".,;:") for u in URL.findall(own)}
        self.keys = set(KEY.findall(own))
        self.ids = set(ids)
        try:
            waybill = (D / "brief.md").read_text(encoding="utf-8", errors="replace")
        except OSError:
            waybill = ""
        repo = profile_repo(waybill)
        names = set()
        if repo and repo.is_dir() and same_repo(repo):
            waybill = ""                                # the target is postmaster: its text is public
        else:
            # <project>/.postmaster/runs/<TICKET>: the project root's name, not "runs".
            root = D.parent.parent.parent if (D.parent.name == "runs" and D.parent.parent.name == ".postmaster") else D.parent
            names = {root.name} | (set() if ONGOING else {D.name})
            k = None if ONGOING else re.match(r"([A-Za-z][A-Za-z0-9]*)[-_]\d+$", D.name)
            names |= {k.group(1)} if k else set()
            if repo:
                names.add(repo.name)
                r = remote(repo) if repo.is_dir() else None
                names |= set(r[1].split("/")[-2:]) if r and r[0] else ({os.path.basename(r[1])} if r else set())
        names = sorted((n for n in names if len(n) >= 2 and not n.isdigit() and n.casefold() not in self.vocab),
                       key=len, reverse=True)
        self.names = re.compile(r"(?<![^\W_])(%s)(?![^\W_])" % "|".join(map(re.escape, names)), re.I) if names else None
        ws = words(waybill)
        self.waybill_words, self.waybill_grams = set(ws) - self.vocab, grams(ws) - self.grams

    def own_path(self, p):
        """A path in postmaster's own tree, as postmaster names it, or None."""
        q = p[2:] if p.startswith("./") else p
        try:
            if q.startswith("/"):
                real, root = os.path.realpath(q), os.path.realpath(TOOL)
                if not real.startswith(root + os.sep):
                    return None
                q = real[len(root) + 1:]
            if q and not q.startswith("~") and ".." not in q.split("/") and (TOOL / q).exists():
                return os.path.normpath(q)
        except (OSError, ValueError):
            return None
        return p if p.casefold() in self.paths else None

    def publish(self, text):
        """The text with everything that is not postmaster's own withheld, each piece marked."""
        held = []

        def hold(s):
            held.append(s)
            return "\x01%d\x02" % (len(held) - 1)

        def token(m):
            tok = m.group(0)
            core = tok.rstrip(".,:")
            if "/" in core and re.search(r"\w", core):
                return hold(self.own_path(core) or "[path]") + tok[len(core):]
            if FILELIKE.fullmatch(core):
                return hold(core if core.casefold() in self.files else "[path]") + tok[len(core):]
            return tok

        def code(tok):
            if tok.casefold() in self.tokens or (tok.isdigit() and len(tok) < 7):
                return tok
            looks = tok.isdigit() or "_" in tok or any(c.isdigit() for c in tok) or re.search(r"[a-z][A-Z]", tok)
            return hold("[code]") if looks else tok

        def word(m):
            w = m.group(0)
            cf = w.casefold()
            if cf in self.vocab:
                return w
            if cf in self.waybill_words or not w.isascii() or w != w.lower():
                return hold("[withheld]")
            return w

        text = text.replace("\x01", "").replace("\x02", "")
        text = MARK.sub(lambda m: hold(m.group(0)), text)
        text = FAULT_ID.sub(lambda m: hold(m.group(0)), text)
        text = URL.sub(lambda m: hold(m.group(0) if m.group(0).casefold().rstrip(".,;:") in self.urls else "[link]"), text)
        text = EMAIL.sub(lambda m: hold("[address]"), text)
        text = IPV4.sub(lambda m: hold("[address]"), text)
        text = TOKEN.sub(token, text)
        text = HEX.sub(lambda m: hold(m.group(0)) if m.group(0) in self.ids else m.group(0), text)
        text = KEY.sub(lambda m: hold(m.group(0) if m.group(0) in self.keys else "[ticket]"), text)
        if self.names:
            text = self.names.sub(lambda m: hold("[project]"), text)
        spans = [(m.start(), m.end(), m.group(0).casefold()) for m in WORD.finditer(text)]
        hide = sorted({j for i in range(len(spans) - N + 1)
                       if tuple(s[2] for s in spans[i:i + N]) in self.waybill_grams for j in range(i, i + N)})
        runs = []
        for i in hide:
            if runs and runs[-1][1] == i - 1:
                runs[-1][1] = i
            else:
                runs.append([i, i])
        for a, b in reversed(runs):
            text = text[:spans[a][0]] + hold("[ticket text]") + text[spans[b][1]:]
        text = TICKS.sub(lambda m: "`" + WTOK.sub(lambda t: t.group(0) if t.group(0).casefold() in self.tokens
                                                  or (t.group(0).isdigit() and len(t.group(0)) < 7)
                                                  else hold("[code]"), m.group(1)) + "`", text)
        text = WTOK.sub(lambda m: code(m.group(0)), text)
        text = WORD.sub(word, text)
        return HELD.sub(lambda m: held[int(m.group(1))], text)

    def key(self, failed):
        """A fault's text as its id is taken from: postmaster's own paths kept, and all that varies set aside."""
        t = TOKEN.sub(lambda m: " %s " % (self.own_path(m.group(0).rstrip(".,:")) or "path")
                      if "/" in m.group(0) and re.search(r"\w", m.group(0)) else m.group(0), failed)
        if self.names:
            t = self.names.sub(" project ", t)
        t = HEX.sub(" id ", FAULT_ID.sub(" id ", t.casefold()))
        return " ".join(re.findall(r"[^\W\d_]+", re.sub(r"\d+", " n ", t)))


def tidy(text):
    return " ".join(text.split())


def clip(text, n):
    if len(text) <= n:
        return text
    cut = text[:n - 3]
    return (cut[:cut.rfind(" ")] if " " in cut else cut).rstrip(" ,;:") + "..."


# --- the run's faults ---------------------------------------------------------------------------

def controls():
    """The scripts controls.md lists, by path, with their kinds."""
    try:
        text = (TOOL / "skills/postmaster/controls.md").read_text()
    except OSError:
        return {}
    out = {}
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        m = re.fullmatch(r"`(?:<tool>/)?([^`]+)`", cells[0]) if len(cells) >= 2 else None
        if m and re.fullmatch(r"[\w-]+", cells[1]):
            out[m.group(1)] = cells[1]
    return out


def faults(entries, safe, first):
    """The distinct faults among the tool-fault lines from the first-th on, in the order first seen."""
    listed, groups, k = controls(), {}, 0
    for i, e in enumerate(entries):
        if e.get("action") != "tool-fault":
            continue
        k += 1
        if k <= first:
            continue
        file = str(e.get("target", ""))
        fid = "tf-" + hashlib.sha256(("%s\n%s" % (file, safe.key(str(fields(e).get("failed", ""))))).encode()).hexdigest()[:8]
        g = groups.setdefault(fid, {"id": fid, "file": file, "entries": [], "at": i})
        g["entries"].append(e)
    for g in groups.values():
        es = g["entries"]
        g["control"] = next((fields(e)["control"] for e in es if fields(e).get("control")), "") or listed.get(g["file"], "")
        g["workarounds"] = [fields(e)["workaround"] for e in es if fields(e).get("workaround")]
        g["escalated"] = any(e.get("action") == "escalate" and safe.own_path(str(e.get("target", ""))) == g["file"]
                             for e in entries[g["at"] + 1:])
    return list(groups.values())


def done_of(entries):
    """What the log says was done with each fault of each run: {(id, run id): (state, ticket)}."""
    out = {}
    for e in entries:
        m = DONE.match(str(e.get("detail", "")))
        if m and e.get("actor") == "postmaster" and e.get("action") in ("ticket-create", "ticket-comment", "note"):
            state = {"filed": "filed", "seen again": "commented", "declined": "declined"}[m.group(2)]
            out[(m.group(1), m.group(3))] = (state, "" if e["action"] == "note" else str(e.get("target", "")))
    return out


# --- postmaster's own tracker -------------------------------------------------------------------

class Unreached(Exception):
    pass


class GitHub:
    """The GitHub repository postmaster's own checkout names, through scripts/github.sh."""

    def call(self, *args):
        return run([HERE / "github.sh", TOOL, *args])

    def search(self, text):
        r = self.call("search", text)
        if r.returncode:
            raise Unreached("github.sh search: %s" % why(r))
        return [tuple(l.split("\t", 2)) for l in r.stdout.splitlines() if l.count("\t") >= 2]

    def read(self, number):
        r = self.call("read", number.lstrip("#"))
        if r.returncode:
            raise Unreached("github.sh read %s: %s" % (number, why(r)))
        return r.stdout


def reach():
    """postmaster's own tracker, or None and why not."""
    if not own_checkout():
        return None, "postmaster here is not a git checkout of its own"
    r = remote(TOOL)
    if not r or r[0] != "github.com":
        return None, "postmaster's checkout has no origin on GitHub"
    a = run([HERE / "github.sh", TOOL, "access"])
    if a.returncode:
        return None, "github.sh access: %s" % why(a)
    if a.stdout.strip() != "ADMIN":
        return None, "the user does not own postmaster's repository (github.sh access: %s)" % a.stdout.strip()
    return GitHub(), ""


def lookup(t, fid, file):
    """The ticket holding a fault's id in its title, body or comments, as (number, open or closed),
    if one does; and the other fault tickets for its file."""
    for number, state, _ in t.search(fid):
        if re.search(r"(?<![\w-])%s(?![\w-])" % fid, t.read(number)):
            return (number, state), []
    prefix = "Tool fault in %s:" % file
    return None, [number for number, _, title in t.search(prefix[:-1]) if title.startswith(prefix)]


# --- the drafts ---------------------------------------------------------------------------------

def draft(g, rid, safe):
    es = g["entries"]
    file = safe.publish(g["file"])
    failed = tidy(safe.publish(str(fields(es[0]).get("failed", ""))))
    fixes = list(dict.fromkeys(tidy(safe.publish(str(fields(e).get("fix", "")))) for e in es))
    roles = safe.publish(" and ".join(dict.fromkeys(str(e.get("actor", "")) for e in es)))
    title = "Tool fault in %s: %s [%s]" % (file, clip(failed.rstrip("."), 90), g["id"])
    facts = ["A run met a fault in `%s`: %s%s" % (file, failed, "" if failed.endswith((".", "!", "?")) else ".")]
    if g["control"]:
        facts.append("It is a fault in a control (%s), which stops the leg." % g["control"])
    if g["workarounds"]:
        facts.append("The run worked around it.")
    if g["escalated"]:
        facts.append("The run stopped and escalated.")
    facts.append("It was seen %s in run %s%s." % (seen(len(es)), rid, meta()))
    if len(fixes) == 1:
        direction = ["The fix the %s that met it proposed: %s" % (roles, fixes[0])]
    else:
        direction = ["The fixes proposed by the %s that met it:" % roles, ""] + ["- " + f for f in fixes]
    body = ["## Problem / feature", " ".join(facts), "",
            "## Acceptance criteria",
            "1. The fault above no longer happens.",
            "2. A control that fails on this fault, and passes with the fix, is part of the change.", "",
            "## Direction"] + direction + ["",
            "## Turnpikes", "default", "",
            "## Notes",
            "Filed from run %s by `scripts/tool-faults.sh`. The run's own records keep the full evidence: "
            "what ran, the error and the diagnosis. This ticket carries only the file, the failure and the "
            "proposed fix. If the fix changes the coachman contract (markers, the waybill shape, completion "
            "detection), a fixture run confirms it before it merges." % rid, "",
            "Tool fault id: `%s`." % g["id"]]
    return title, "\n".join(body) + "\n"


def digest(title_path, body_path):
    return hashlib.sha256(title_path.read_bytes() + b"\0" + body_path.read_bytes()).hexdigest()


def checked(title_path, body_path, safe, sha):
    """Why a draft may not be filed, or nothing. A draft as the harvest wrote it was made safe
    then; one changed since is made safe again, and must come through unchanged."""
    title, body = title_path.read_text().strip(), body_path.read_text()
    if digest(title_path, body_path) != sha:
        bad = [("title", title)] if safe.publish(title) != title else []
        bad += [("body", l) for l in body.splitlines() if safe.publish(l) != l]
        if bad:
            return "not safe to publish:\n" + "\n".join("  %s: %s\n  made safe: %s" % (w, t, safe.publish(t)) for w, t in bad)
    r = run([HERE / "ticket-check.sh", "--body", body_path, "--title", title])
    return "" if r.returncode == 0 else "the draft fails scripts/ticket-check.sh:\n" + (r.stdout + r.stderr).rstrip()


# --- the commands -------------------------------------------------------------------------------

def harvest():
    closed()
    entries, bad = read_log()
    lines = sum(1 for e in entries if e.get("action") == "tool-fault")
    st = load_state()
    runs = st.get("runs") or []
    if not runs or (ONGOING and lines > st.get("lines", 0)):
        runs.append({"run_id": new_id(), "first": st.get("lines", 0) if runs else 0,
                     "harvested": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        st["runs"] = runs
        save_state(st)                          # the id is kept before any draft names it
    rid, first = runs[-1]["run_id"], runs[-1]["first"]
    safe = Safe(own_ids(st))
    groups, done = faults(entries, safe, first), done_of(entries)
    prior = {(x.get("run_id"), x.get("id")): x for x in st.get("faults", [])}
    t, reason = reach() if any((g["id"], rid) not in done for g in groups) else (None, "")
    rows, found = [], []
    notes = ["  line %d of actions.jsonl is not a log line, and was left out" % n for n in bad]
    for g in groups:
        fid, was = g["id"], prior.get((rid, g["id"]), {})
        x = {"run_id": rid, "id": fid, "file": g["file"], "control": g["control"], "count": len(g["entries"]),
             "state": "", "ticket": "", "like": []}
        if (fid, rid) in done:
            x["state"], x["ticket"] = done[(fid, rid)]
        elif not t:
            x["state"] = "kept"
        else:
            try:
                k, x["like"] = lookup(t, fid, safe.publish(g["file"]))
            except Unreached as e:
                x["state"] = "unchecked"
                notes.append("  %s: the tracker could not be read: %s" % (fid, e))
            else:
                if k:
                    x["state"], x["ticket"], x["ticket_state"] = "known", k[0], k[1]
                else:
                    x["state"] = "asked" if was.get("state") in ("new", "asked") else "new"
        folder = DRAFTS / rid
        title_path, body_path = folder / (fid + ".title"), folder / (fid + ".md")
        if title_path.exists() and body_path.exists():
            x["sha"] = was.get("sha", "")
        else:
            folder.mkdir(parents=True, exist_ok=True)
            title, body = draft(g, rid, safe)
            title_path.write_text(title + "\n")
            body_path.write_text(body)
            x["sha"] = digest(title_path, body_path)
        x["draft"] = str(body_path.relative_to(D))
        what = x["state"] + (" " + x["ticket"] if x["ticket"] else "") + (" (%s)" % x["ticket_state"] if x.get("ticket_state") else "")
        what += (", like " + " ".join(x["like"])) if x["like"] else ""
        what += ("  " + x["draft"]) if x["state"] in ASKING else ""
        rows.append("%s  %s  %s%s  %s" % (fid, g["file"], "control (%s)  " % g["control"] if g["control"] else "", seen(x["count"]), what))
        if x["state"] not in ("commented", "filed", "declined"):
            if g["control"] and not g["escalated"]:
                notes.append("  %s: a fault in a control, and the log has no escalate naming its file after it" % fid)
            notes += ["  %s: a fault in a control, worked around: %s" % (fid, w) for w in (g["workarounds"] if g["control"] else [])]
        if x["state"] in ASKING:
            problem = checked(title_path, body_path, safe, x["sha"])
            if problem:
                notes.append("  %s: %s" % (fid, problem.replace("\n", "\n    ")))
        found.append(x)
    st["faults"] = [x for x in st.get("faults", []) if x.get("run_id") != rid] + found
    st["lines"] = lines
    save_state(st)
    tally = {}
    for x in found:
        tally[x["state"]] = tally.get(x["state"], 0) + 1
    if not groups:
        print("run %s: no tool faults" % rid)
    else:
        where = ("postmaster's own tracker, on GitHub" if t else "no tracker of postmaster's own: %s" % reason) if (t or reason) else "every fault dealt with"
        print("run %s: %d fault%s; %s" % (rid, len(groups), "" if len(groups) == 1 else "s", where))
        print("\n".join(rows))
    if notes:
        print("\n".join(notes))
    log("note", rid, "tool faults harvested: %d%s" % (len(groups), "".join(", %d %s" % (n, s) for s, n in sorted(tally.items()))))


def begin(fid):
    """The state and the fault's latest record, and the log; or exit 0 if the log says it is dealt with."""
    closed()
    st = load_state()
    xs = [x for x in st.get("faults", []) if x.get("id") == fid]
    if not xs:
        die("no fault %s in %s; harvest first" % (fid, STATE))
    entries, _ = read_log()
    d = done_of(entries).get((fid, xs[-1]["run_id"]))
    if d:
        print("%s: already %s" % (fid, " ".join(filter(None, d))))
        sys.exit(0)
    return st, xs[-1], entries


def settle(st, x, state, ticket):
    x["state"], x["ticket"] = state, ticket
    save_state(st)


def tracker():
    t, reason = reach()
    if not t:
        die("no tracker of postmaster's own: %s" % reason)
    return t


def comment(fid, ticket):
    st, x, entries = begin(fid)
    t, safe = tracker(), Safe(own_ids(st))
    first = next((r["first"] for r in st.get("runs", []) if r["run_id"] == x["run_id"]), 0)
    g = next((g for g in faults(entries, safe, first) if g["id"] == fid), None)
    if not g:
        die("the run's log no longer gives %s; harvest it again" % fid)
    try:
        if ticket:
            if not re.fullmatch(r"#?\d+", ticket):
                die("not a ticket number: %s" % ticket)
            number = "#" + ticket.lstrip("#")
            m = re.search(r"^state: (\S+)", t.read(number), re.M)
            state = m.group(1) if m else ""
        else:
            k = lookup(t, fid, safe.publish(g["file"]))[0]
            if not k:
                die("%s has no ticket on postmaster's tracker, so it is new: file it, or decline it" % fid, 2)
            number, state = k
    except Unreached as e:
        die("the tracker could not be read: %s" % e)
    text = "tool fault %s seen again: %s in run %s%s." % (fid, seen(len(g["entries"])), x["run_id"], meta())
    text += " This ticket is closed." if state in ("closed", "done", "cancelled") else ""
    r = t.call("comment", number.lstrip("#"), "postmaster", text)
    if r.returncode:
        die("the tracker refused the comment: %s" % why(r))
    log("ticket-comment", number, "tool fault %s seen again in run %s, on postmaster's own tracker" % (fid, x["run_id"]))
    settle(st, x, "commented", number)
    print("%s: commented on %s" % (fid, number))


def file(fid):
    st, x, _ = begin(fid)
    title_path, body_path = DRAFTS / x["run_id"] / (fid + ".title"), DRAFTS / x["run_id"] / (fid + ".md")
    if not (title_path.exists() and body_path.exists()):
        die("no draft for %s in %s" % (fid, title_path.parent))
    t, safe = tracker(), Safe(own_ids(st))
    try:
        k = lookup(t, fid, safe.publish(x["file"]))[0]
    except Unreached as e:
        die("the tracker could not be read, so nothing is filed: %s" % e)
    if k:
        die("%s is already %s on postmaster's tracker: comment on it instead" % (fid, k[0]), 2)
    problem = checked(title_path, body_path, safe, x.get("sha", ""))
    if problem:
        die("%s is not filed: %s" % (fid, problem), 2)
    r = t.call("create", title_path.read_text().strip(), body_path)
    made = (r.stdout.strip().splitlines() or [""])[-1]
    if r.returncode not in (0, 5) or not made.isdigit():
        die("the tracker refused the ticket: %s" % why(r))
    log("ticket-create", "#" + made, "tool fault %s filed in run %s, on postmaster's own tracker" % (fid, x["run_id"]))
    settle(st, x, "filed", "#" + made)
    print("%s: filed as #%s%s" % (fid, made, "; it is not on the board, so add it there" if r.returncode == 5 else ""))


def decline(fid, word):
    st, x, _ = begin(fid)
    log("note", fid, "tool fault %s declined in run %s, by the user: %s" % (fid, x["run_id"], word))
    settle(st, x, "declined", "")
    print("%s: declined" % fid)


if CMD == "harvest":
    harvest()
else:
    fid = ARGS[1]
    if not re.fullmatch(r"tf-[0-9a-f]{8}", fid):
        die("not a fault id: %s" % fid)
    if CMD == "comment":
        comment(fid, ARGS[2] if len(ARGS) > 2 else "")
    elif CMD == "file":
        file(fid)
    else:
        decline(fid, " ".join(ARGS[2:]))
PY
}

case ${1:-} in
  --self-test) ;;
  harvest) [ $# -eq 2 ] || usage; run_py "$@"; exit $? ;;
  comment) [ $# -eq 3 ] || [ $# -eq 4 ] || usage; run_py "$@"; exit $? ;;
  file) [ $# -eq 3 ] || usage; run_py "$@"; exit $? ;;
  decline) [ $# -ge 4 ] || usage; run_py "$@"; exit $? ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
# Runs a copy of postmaster's scripts and skills, whose checkout's origin is a stand-in GitHub
# repository, with a stub gh first on PATH that keeps its issues and comments in a file and
# records every issue it creates and every comment it adds, so nothing reaches GitHub. The
# target's names, paths, ids, words and a sentence of its ticket are made up afresh on each run,
# so that none of them is in postmaster's own text, this file included.
set +o pipefail   # a check reads grep's answer: grep -q stops at its first match, and the writer's broken pipe is no failure
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
T="$tmp/tool"; S="$tmp/stub"; RUNS="$tmp/runs"
mkdir -p "$T/skills" "$S" "$tmp/bin" || exit 1
cp -R "$HERE" "$T/scripts" && cp -R "$TOOL/skills/postmaster" "$T/skills/postmaster" || exit 1
git -C "$T" init -q && git -C "$T" remote add origin https://github.com/o/postmaster.git || exit 1
cat > "$tmp/bin/gh" <<'GH'
#!/usr/bin/env python3
import json, os, sys
d, a = os.environ["TOOL_FAULTS_STUB"], sys.argv[1:]
db_path = d + "/db.json"
db = json.load(open(db_path))
def save(): json.dump(db, open(db_path, "w"))
def arg(flag): return a[a.index(flag) + 1] if flag in a else ""
def write(line): open(d + "/writes.log", "a").write(line + "\n")
if a[:2] == ["auth", "status"]:
    sys.exit(0)
if a[:2] == ["api", "graphql"]:
    q = next(x for x in a if x.startswith("query="))
    if "viewerPermission" in q:
        print(json.dumps({"data": {"repository": {"viewerPermission": db["access"]}}}))
    elif "projectsV2" in q:
        print(json.dumps({"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "postmaster", "closed": False, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}))
    elif "issue(number:" in q:
        n = next(x for x in a if x.startswith("number=")).split("=", 1)[1]
        i = db["issues"].get(n)
        print(json.dumps({"data": {"repository": {"issue": None if i is None else {
            "number": int(n), "title": i["title"], "body": i["body"], "state": i["state"], "stateReason": None,
            "url": "https://github.com/o/postmaster/issues/" + n, "createdAt": "2026-01-01T00:00:00Z", "labels": {"nodes": []},
            "comments": {"nodes": [{"body": c, "createdAt": "2026-01-01T00:00:00Z", "author": {"login": "o"}} for c in i["comments"]]}}}}}))
    else:
        sys.exit("stub gh: unexpected query")
elif a[:2] == ["search", "issues"]:
    if os.path.exists(d + "/no-search"):
        sys.exit("stub gh: search is down")
    q = a[2].strip('"').casefold()
    hits = [{"number": int(n), "title": i["title"], "state": i["state"]} for n, i in db["issues"].items()
            if q in (i["title"] + "\n" + i["body"] + "\n" + "\n".join(i["comments"])).casefold()]
    print(json.dumps(hits))
elif a[:2] == ["project", "item-list"]:
    print('{"items": []}')
elif a[:2] == ["project", "field-list"]:
    print('{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Todo"}, {"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}]}')
elif a[:2] == ["project", "item-add"]:
    if os.path.exists(d + "/no-item-add"):
        sys.exit("stub gh: item-add refused")
    print('{"id": "PVTI_new"}')
elif a[:2] == ["project", "item-edit"]:
    pass
elif a[:2] == ["issue", "create"]:
    n = str(db["next"]); db["next"] += 1
    db["issues"][n] = {"title": arg("--title"), "body": open(arg("--body-file")).read(), "state": "OPEN", "comments": []}
    save(); write("create #%s %s" % (n, arg("--title")))
    open(d + "/created-%s.md" % n, "w").write(db["issues"][n]["body"])
    print("https://github.com/o/postmaster/issues/" + n)
elif a[:2] == ["issue", "comment"]:
    db["issues"][a[2]]["comments"].append(arg("--body")); save(); write("comment #%s %s" % (a[2], arg("--body")))
else:
    sys.exit("stub gh: unexpected: %s" % " ".join(a))
GH
chmod +x "$tmp/bin/gh"
db() {  # db <access> [<number> <OPEN|CLOSED> <title> <body>]...: the stub's repository, afresh
  python3 - "$S/db.json" "$@" <<'PY'
import json, sys
path, access, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
issues = {rest[i]: {"state": rest[i + 1], "title": rest[i + 2], "body": rest[i + 3], "comments": []} for i in range(0, len(rest), 4)}
json.dump({"access": access, "next": 60, "issues": issues}, open(path, "w"))
PY
}
tf() { PATH="$tmp/bin:$PATH" TOOL_FAULTS_STUB="$S" "$T/scripts/tool-faults.sh" "$@"; }
logf() { "$T/scripts/log-action.sh" "$@" >/dev/null 2>&1 || echo "self-test: could not log $*" >&2; }
writes() { grep -c "^$1 " "$S/writes.log" 2>/dev/null || true; }
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }

# The target, made up. NG holds the words of a sentence of its ticket out of order, so that no
# run of four of them, in the order the ticket has them, is in this file.
rand() { python3 -c 'import secrets, string, sys; print("".join(secrets.choice(sys.argv[2]) for _ in range(int(sys.argv[1]))))' "$1" "${2:-abcdefghijklmnopqrstuvwxyz}"; }
NAME="zq$(rand 6)"; OWNER="yq$(rand 6)"; WORD="xq$(rand 6)"; IDENT="vq$(rand 5)Totals"; IDENT2="wq$(rand 5)Revenue"
UUID=$(python3 -c 'import uuid; print(uuid.uuid4())'); HOMEP="/home/wq$(rand 5)/code/$NAME/$UUID"
SECRET=$(rand 32 0123456789abcdef); CYR=$(rand 7 абвгдежзиклмнопрстуфхцчшщ); CYR2=$(rand 7 αβγδεζηθικλμνξπρστυφχψω); KEYX="QZ$(rand 3 ABCDEFGHJKLMNPRSTUVWXYZ)-$(rand 3 123456789)"
PROPER="Q$(rand 7)"; EMAIL="jq$(rand 5)@kq$(rand 5).example"; IP="10.$(rand 2 123456789).$(rand 2 123456789).$(rand 2 123456789)"
NG=(column harness before board lane every merge)
SENTENCE="${NG[6]} ${NG[5]} ${NG[4]} ${NG[3]} ${NG[2]} the ${NG[1]} ${NG[0]}"
TICKET="${NAME^^}-12"
REPO="$tmp/home/My Code/$NAME"; mkdir -p "$REPO" && git -C "$REPO" init -q && git -C "$REPO" remote add origin "https://github.com/$OWNER/$NAME.git" || exit 1
PLANTED=("$NAME" "$OWNER" "$WORD" "$IDENT" "$IDENT2" "$HOMEP" "$REPO" "$TICKET" "$SENTENCE" "${NG[6]} ${NG[5]} ${NG[4]} ${NG[3]}"
         "${UUID%%-*}" "${UUID##*-}" "$SECRET" "$CYR" "$CYR2" "$KEYX" "$EMAIL" "$IP" "$PROPER")
leaks() {  # leaks <text>: the planted pieces of the target it holds, one per line. No pipe: grep -q
  local p   # would stop reading at its first match and fail the writer under pipefail
  for p in "${PLANTED[@]}"; do grep -qiF -- "$p" <<<"$1" && printf '%s\n' "$p"; done
}
newrun() {  # newrun <project> <ticket> <stage>: a run directory with its waybill, manifest and run.json
  local d="$RUNS/$1/.postmaster/runs/$2"
  mkdir -p "$d"
  printf '# Waybill: %s\n\n## Ticket\nThe %s ledger for %s: %s. %s.\n\nrepo: %s\n\n## Project profile\nrepo: %s          default branch: main       BASE: 0123abc\n' \
    "$2" "$WORD" "$NAME" "$SENTENCE" "$CYR" "$T" "$REPO" > "$d/brief.md"
  printf '{"stage": "%s", "leg": 3, "base": "0123abc", "lanes": {}, "coachman": {"legs": {}}}\n' "$3" > "$d/manifest.json"
  printf '{"postmaster": {"commit": "89abcdef0123456789abcdef0123456789abcdef", "uncommitted_changes": false}}\n' > "$d/run.json"
  printf '%s\n' "$d"
}
line_of() { printf '%s\n' "$out" | grep -E "^$1  " | head -1; }
id_where() { printf '%s\n' "$out" | grep -E "^tf-[0-9a-f]{8}  $1" | head -1 | cut -c1-11; }
state_of() { python3 -c 'import json, sys; print(" ".join(x["state"] for x in json.load(open(sys.argv[1]))["faults"] if x["id"] == sys.argv[2]))' "$1/tool-faults.json" "$2" 2>/dev/null; }
draft_of() { printf '%s/%s' "$1" "$(python3 -c 'import json, sys; print([x["draft"] for x in json.load(open(sys.argv[1]))["faults"] if x["id"] == sys.argv[2]][-1])' "$1/tool-faults.json" "$2")"; }
drafts() { find "$RUNS" -path '*/tool-faults/*' -type f \( -name '*.md' -o -name '*.title' \) -exec cat {} +; }

d=$(newrun "$NAME" "$TICKET" done)
logf "$d" postmaster dispatch "$TICKET" "leg 1"
logf "$d" coachman tool-fault scripts/wait-for-markers.sh --ran "scripts/wait-for-markers.sh $REPO/logs 'r1-*.done' 3 2400" \
  --failed "returned before 1 of 3 markers were in $HOMEP/logs" --error "exit 0; $NAME has 1 marker" \
  --diagnosis "\`$IDENT\` wrote its marker early" --fix "count only regular files, with find -type f"
logf "$d" coachman escalate scripts/wait-for-markers.sh "the wait is a control"
logf "$d" coachman tool-fault "$T/scripts/wait-for-markers.sh" --ran "the same wait, round 2" \
  --failed "Returned before 2 of 3 markers were in /elsewhere/logs." --error none --diagnosis same --fix "count only regular files, with find -type f"
logf "$d" coachman tool-fault scripts/wait-for-markers.sh --ran "the same wait, round 3" \
  --failed "returned before 1 of 3 markers were in $HOMEP/logs" --error none --diagnosis same --fix "count only regular files"
logf "$d" coachman tool-fault skills/postmaster/harnesses.md --ran "resume of $TICKET's leg 2" \
  --failed "the resume form hung while the $WORD ledger was open, reading src/$WORD/billing.ts in $NAME of $OWNER for $PROPER, $CYR and $CYR2 and $KEYX, mailed to $EMAIL, after scripts/ticket-check.sh quoted: $SENTENCE" \
  --error "timeout after 600s in $HOMEP" --diagnosis "the prompt went to $OWNER/$NAME" \
  --fix "pass the prompt on stdin, as for \`$IDENT\` and cfg[$IDENT2] in $HOMEP/src at $IP, key $SECRET; see https://github.com/$OWNER/$NAME" \
  --workaround "resumed by hand in the recorded form"
logf "$d" coachman tool-fault scripts/wait-for-markers.sh --ran "wait, round 4" \
  --failed "counted a directory named like a marker" --error none --diagnosis "find has no -type" --fix "add -type f to the find"
logf "$d" postmaster escalate "$TICKET" "a scope ruling, about nothing here"
logf "$d" coachman tool-fault skills/postmaster/coachman.md --ran "stage 2" --failed "the step runs scripts/stage.sh with a flag it does not take" \
  --error none --diagnosis x --fix "drop the flag" --control action-log
logf "$d" coachman tool-fault skills/postmaster/coachman.md --ran "stage 2" --failed "the step runs scripts/handoff-check.sh with a flag it does not take" \
  --error none --diagnosis x --fix "drop the flag" --control check
logf "$d" coachman ticket-comment "$TICKET" "ready to merge"
printf '%s\n' 'this line is not JSON' >> "$d/actions.jsonl"
printf '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"note","target":"x","detail":"a raw \xe2\x80\xa8 line separator"}\n' >> "$d/actions.jsonl"

echo "positive controls"
db ADMIN 12 OPEN "An ordinary issue" "Nothing to do with faults."
out=$(tf harvest "$d" 2>&1); rc=$?
A=$(id_where 'scripts/wait-for-markers.sh  control \(wait\)  3 times')
B=$(id_where 'skills/postmaster/harnesses.md')
C=$(id_where 'scripts/wait-for-markers.sh  control \(wait\)  once')
D1=$(id_where 'skills/postmaster/coachman.md  control \(action-log\)')
D2=$(id_where 'skills/postmaster/coachman.md  control \(check\)')
[ $rc -eq 0 ] && [ "$(printf '%s\n' "$out" | grep -cE '^tf-[0-9a-f]{8}  ')" -eq 5 ] && [ -n "$A$B$C$D1$D2" ] && [ ${#D1} -eq 11 ] && [ ${#D2} -eq 11 ] && [ "$D1" != "$D2" ] \
  && ok "seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart" \
  || fail "seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart (exit $rc)" "$out"
[ "$(printf '%s\n' "$out" | grep -c "is not a log line, and was left out")" -eq 1 ] && ok "a line that is not JSON is left out, and said so; one with a raw line separator is read" \
  || fail "a line that is not JSON is left out, and said so; one with a raw line separator is read" "$out"
grep -qF "\"action\":\"note\",\"target\":\"$(printf '%s\n' "$out" | head -1 | cut -d' ' -f2 | tr -d :)\",\"detail\":\"tool faults harvested: 5, 5 new\"" "$d/actions.jsonl" \
  && ok "the harvest logs what it found" || fail "the harvest logs what it found" "$(tail -2 "$d/actions.jsonl")"
[ "$(state_of "$d" "$B")" = new ] && [ -f "$(draft_of "$d" "$B")" ] && printf '%s\n' "$(line_of "$B")" | grep -qF "new  tool-faults/" \
  && ok "a fault no ticket holds is new, and its line names its draft" || fail "a fault no ticket holds is new, and its line names its draft" "$out"
printf '%s\n' "$out" | grep -qxF "  $C: a fault in a control, and the log has no escalate naming its file after it" \
  && ! printf '%s\n' "$out" | grep -qF "  $A: a fault in a control, and" && grep -qF 'The run stopped and escalated.' "$(draft_of "$d" "$A")" \
  && ! grep -qF 'The run stopped and escalated.' "$(draft_of "$d" "$C")" \
  && ok "only an escalate naming the fault's file counts as its escalation" || fail "only an escalate naming the fault's file counts as its escalation" "$out"
shape=0
for f in "$(draft_of "$d" "$A")" "$(draft_of "$d" "$B")" "$(draft_of "$d" "$C")"; do
  "$T/scripts/ticket-check.sh" --body "$f" --title "$(cat "${f%.md}.title")" >/dev/null 2>&1 || shape=$((shape+1))
  grep -qx '## Turnpikes' "$f" || shape=$((shape+1))
done
[ "$shape" -eq 0 ] && ok "each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh" \
  || fail "each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh ($shape fail)" "$(drafts)"
RID=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["runs"][-1]["run_id"])' "$d/tool-faults.json")
grep -qF "It was seen 3 times in run $RID, which ran postmaster 89abcdef0123." "$(draft_of "$d" "$A")" \
  && ok "a draft names the run by its public id, and the postmaster it ran" || fail "a draft names the run by its public id, and the postmaster it ran" "$(cat "$(draft_of "$d" "$A")")"
marked() { local m; for m in path project code link withheld "ticket text" ticket address; do grep -qF "[$m]" "$1" || { echo "no [$m]"; return 1; }; done; }
B_MD=$(draft_of "$d" "$B")
grep -qF 'skills/postmaster/harnesses.md' "${B_MD%.md}.title" && grep -qF 'pass the prompt on stdin' "$B_MD" && grep -qF 'scripts/ticket-check.sh' "$B_MD" \
  && marked "$B_MD" && ok "postmaster's own files and words are kept, and what is withheld is marked" \
  || fail "postmaster's own files and words are kept, and what is withheld is marked" "$(marked "$B_MD"; cat "${B_MD%.md}.title" "$B_MD")"
db ADMIN 12 OPEN "An ordinary issue" "Nothing to do with faults." \
  57 OPEN "Tool fault in scripts/wait-for-markers.sh: returned early [$A]" "A body." \
  58 OPEN "Retitled by hand" "Tool fault id: \`$D1\`."
out=$(tf harvest "$d" 2>&1)
printf '%s\n' "$(line_of "$A")" | grep -qE " known #57 \(open\)$" && printf '%s\n' "$(line_of "$C")" | grep -qE " asked, like #57  tool-faults/" \
  && printf '%s\n' "$(line_of "$D1")" | grep -qE " known #58 \(open\)$" && printf '%s\n' "$(line_of "$B")" | grep -qE " asked  tool-faults/" \
  && ok "a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked" \
  || fail "a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked" "$out"
: > "$S/writes.log"
out=$(tf comment "$d" "$A" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes comment)" -eq 1 ] && grep -qF "comment #57 " "$S/writes.log" && grep -qF "tool fault $A seen again: 3 times in run $RID" "$S/writes.log" \
  && grep -qF "\"target\":\"#57\",\"detail\":\"tool fault $A seen again in run $RID" "$d/actions.jsonl" \
  && ok "comment says once, on the ticket that holds it, that it was seen again, and logs it" \
  || fail "comment says once, on the ticket that holds it, that it was seen again, and logs it (exit $rc)" "$out$(printf '\n'; cat "$S/writes.log")"
out=$(tf comment "$d" "$C" 12 2>&1); rc=$?
[ $rc -eq 0 ] && tail -1 "$S/writes.log" | grep -qF "comment #12 " && tail -1 "$S/writes.log" | grep -qF "tool fault $C seen again: once in run $RID" \
  && ok "on the user's word that a ticket holds a new fault, comment names it there" \
  || fail "on the user's word that a ticket holds a new fault, comment names it there (exit $rc)" "$out$(printf '\n'; cat "$S/writes.log")"
out=$(tf file "$d" "$B" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes create)" -eq 1 ] && cmp -s "$S/created-60.md" "$B_MD" && printf '%s\n' "$out" | grep -qxF "$B: filed as #60" \
  && grep -qF "\"target\":\"#60\",\"detail\":\"tool fault $B filed in run $RID" "$d/actions.jsonl" \
  && ok "file files the draft as it is, once, and logs the new ticket" || fail "file files the draft as it is, once, and logs the new ticket (exit $rc)" "$out$(printf '\n'; cat "$S/writes.log")"
tf comment "$d" "$D1" >/dev/null 2>&1; out=$(tf decline "$d" "$D2" "the user: not worth a ticket" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes create)" -eq 1 ] && grep -qF "\"target\":\"$D2\",\"detail\":\"tool fault $D2 declined in run $RID, by the user: the user: not worth a ticket\"" "$d/actions.jsonl" \
  && ok "decline records the user's no, and files nothing" || fail "decline records the user's no, and files nothing (exit $rc)" "$out"
mv -- "$d/tool-faults.json" "$tmp/state.was"
python3 -c 'import json, sys; s = json.load(open(sys.argv[1])); [x.update(state="new") for x in s["faults"]]; json.dump(s, open(sys.argv[2], "w"))' "$tmp/state.was" "$d/tool-faults.json"
out=$(tf harvest "$d" 2>&1)
for f in "$A commented #57" "$B filed #60" "$C commented #12" "$D1 commented #58" "$D2 declined"; do
  printf '%s\n' "$out" | grep -qE "^${f%% *}  .*  ${f#* }$" || { fail "a later harvest reads what was done from the run's log, not its state file" "$f$(printf '\n')$out"; break; }
done && ok "a later harvest reads what was done from the run's log, not its state file"
again=$(newrun "$NAME" "${NAME^^}-16" done)
logf "$again" coachman tool-fault scripts/wait-for-markers.sh --ran "wait" --failed "counted a directory named like a marker" \
  --error none --diagnosis "find has no -type" --fix "add -type f to the find" --control wait
python3 -c 'import json, sys; p = sys.argv[1]; s = json.load(open(p)); s["issues"]["12"]["state"] = "CLOSED"; json.dump(s, open(p, "w"))' "$S/db.json"
out=$(tf harvest "$again" 2>&1)
printf '%s\n' "$(line_of "$C")" | grep -qE " known #12 \(closed\)$" && ok "in a later run, a fault a comment names on any ticket is known there" \
  || fail "in a later run, a fault a comment names on any ticket is known there" "$out"
out=$(tf comment "$again" "$C" 2>&1); rc=$?
[ $rc -eq 0 ] && tail -1 "$S/writes.log" | grep -qF "comment #12 " && tail -1 "$S/writes.log" | grep -qF "This ticket is closed." \
  && ok "a comment on a closed ticket says it is closed" || fail "a comment on a closed ticket says it is closed (exit $rc)" "$out$(printf '\n'; tail -1 "$S/writes.log")"
pm="$RUNS/$NAME/.postmaster/runs/postmaster"; mkdir -p "$pm"
logf "$pm" postmaster tool-fault scripts/runs-status.sh --ran "the poll" --failed "listed a run twice" --error none --diagnosis x --fix "list each once"
out=$(tf harvest "$pm" 2>&1); P=$(id_where 'scripts/runs-status.sh'); out=$(tf file "$pm" "$P" 2>&1)
python3 -c 'import json, sys; p = sys.argv[1]; s = json.load(open(p)); s["issues"]["61"]["state"] = "CLOSED"; json.dump(s, open(p, "w"))' "$S/db.json"
logf "$pm" postmaster tool-fault scripts/runs-status.sh --ran "the poll, later" --failed "listed a run twice" --error none --diagnosis x --fix "list each once"
out=$(tf harvest "$pm" 2>&1); P2=$(id_where 'scripts/runs-status.sh')
PR=$(python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1]))["runs"]))' "$pm/tool-faults.json")
[ "$P2" = "$P" ] && [ "$PR" -eq 2 ] && printf '%s\n' "$(line_of "$P")" | grep -qE "once  known #61 \(closed\)$" \
  && ok "the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known" \
  || fail "the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known" "$out"
notes=$(newrun notes IT-12 done); : > "$S/writes.log"
PAY=(late was it refused payment)
printf 'The %s %s %s %s %s %s.\n' "${PAY[4]}" "${PAY[1]}" "${PAY[3]}" "${PAY[2]}" "${PAY[1]}" "${PAY[0]}" >> "$notes/brief.md"
logf "$notes" coachman tool-fault scripts/launch.sh --ran "launch" --failed "the stream flag was refused" --error none --diagnosis "renamed" --fix "use the new flag"
logf "$notes" coachman tool-fault scripts/cut-scratch.sh --ran "cut" --failed "cloned a directory twice" --error none --diagnosis "a loop" --fix "clone each once"
out=$(tf harvest "$notes" 2>&1); N1=$(id_where 'scripts/launch.sh'); N2=$(id_where 'scripts/cut-scratch.sh')
out=$(tf file "$notes" "$N1" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes create)" -eq 1 ] && grep -qx '## Notes' "$(draft_of "$notes" "$N1")" \
  && ok "a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase" \
  || fail "a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase (exit $rc)" "$out"
printf '%s\n' "It was seen on a quiet day." >> "$(draft_of "$notes" "$N2")"
out=$(tf file "$notes" "$N2" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes create)" -eq 2 ] && ok "a changed draft is filed when it is still safe, in a project named with words postmaster uses" \
  || fail "a changed draft is filed when it is still safe, in a project named with words postmaster uses (exit $rc)" "$out"
pad=$(python3 -c 'print(("the step ran on " * 10)[:70])')
logf "$notes" coachman tool-fault skills/postmaster/coachman.md --ran "stage 2" --failed "$pad then scripts/wait-for-markers.sh waited for ever" \
  --error none --diagnosis x --fix "bound the wait" --control wait
out=$(tf harvest "$notes" 2>&1); N3=$(id_where 'skills/postmaster/coachman.md')
printf '%s\n' "It was seen once more." >> "$(draft_of "$notes" "$N3")"
out=$(tf file "$notes" "$N3" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(writes create)" -eq 3 ] && ok "a title is cut between words, so a changed draft keeps its paths whole" \
  || fail "a title is cut between words, so a changed draft keeps its paths whole (exit $rc)" "$out$(cat "${N3:+$(draft_of "$notes" "$N3")}" 2>/dev/null | head -1)"
kinds=$(newrun "$NAME" "${NAME^^}-19" done)
printf '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"tool-fault","target":"scripts/wait-for-markers.sh","detail":"waited on the wrong folder","fault":{"ran":"x","failed":"waited on the wrong folder","error":"none","diagnosis":"x","fix":"y","workaround":"","control":"gate"}}\n' > "$kinds/actions.jsonl"
printf '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"tool-fault","target":"scripts/log-action.sh","detail":"wrote nothing","fault":{"ran":"x","failed":"wrote nothing","error":"none","diagnosis":"x","fix":"y","workaround":"","control":""}}\n' >> "$kinds/actions.jsonl"
out=$(tf harvest "$kinds" 2>&1)
printf '%s\n' "$out" | grep -qE '^tf-[0-9a-f]{8}  scripts/wait-for-markers.sh  control \(gate\)  once' \
  && printf '%s\n' "$out" | grep -qE '^tf-[0-9a-f]{8}  scripts/log-action.sh  control \(action-log\)  once' \
  && ok "a fault keeps the kind of control its line recorded; with none recorded, the list's" \
  || fail "a fault keeps the kind of control its line recorded; with none recorded, the list's" "$out"
long=$(newrun "$NAME" "${NAME^^}-20" done)
logf "$long" coachman tool-fault scripts/launch.sh --ran x --failed "choked on $(rand 100000 abcdefghij)" --error none --diagnosis x --fix y
start=$SECONDS; out=$(tf harvest "$long" 2>&1); rc=$?
[ $rc -eq 0 ] && [ $((SECONDS - start)) -lt 25 ] && ok "a fault with a 100,000-character token is harvested in seconds" \
  || fail "a fault with a 100,000-character token is harvested in seconds (exit $rc, $((SECONDS - start))s)" "$(printf '%s\n' "$out" | cut -c1-200)"
python3 -c 'import json, sys; p = sys.argv[1]; s = json.load(open(p)); s["faults"].append(dict(s["faults"][0], id="tf-0badf00d", state="new")); json.dump(s, open(p, "w"))' "$long/tool-faults.json"
out=$(tf comment "$long" tf-0badf00d 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "no longer gives tf-0badf00d" && ! printf '%s\n' "$out" | grep -qF Traceback \
  && ok "a fault the log no longer gives is refused by name" || fail "a fault the log no longer gives is refused by name (exit $rc)" "$out"
board=$(newrun "$NAME" "${NAME^^}-17" done); : > "$S/writes.log"
logf "$board" coachman tool-fault scripts/cut-scratch.sh --ran "cut" --failed "cloned no dependency directory" --error none --diagnosis x --fix "clone them"
out=$(tf harvest "$board" 2>&1); K1=$(id_where 'scripts/cut-scratch.sh'); : > "$S/no-item-add"
out=$(tf file "$board" "$K1" 2>&1); rc=$?; mv -- "$S/no-item-add" "$tmp/no-item-add.was"
out2=$(tf harvest "$board" 2>&1)
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qF "it is not on the board" && printf '%s\n' "$(printf '%s\n' "$out2" | grep "^$K1  ")" | grep -qE " filed #6[0-9]$" \
  && ok "a ticket created but not put on the board is still filed, and logged" || fail "a ticket created but not put on the board is still filed, and logged (exit $rc)" "$out$(printf '\n')$out2"
[ -n "$(leaks "zz $NAME zz")" ] && ok "the leak check finds a planted piece" || fail "the leak check finds a planted piece"

echo "negative controls"
l=$(leaks "$(drafts; cat "$S/writes.log"; cat "$S"/created-*.md)")
[ -z "$l" ] && ok "no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment" \
  || fail "no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment" "$l"
: > "$S/writes.log"
out=$(tf comment "$d" "$A" 2>&1); rc=$?; out2=$(tf file "$d" "$B" 2>&1); rc2=$?
[ $rc -eq 0 ] && [ $rc2 -eq 0 ] && [ "$out" = "$A: already commented #57" ] && [ "$out2" = "$B: already filed #60" ] && [ ! -s "$S/writes.log" ] \
  && ok "a second comment or file says it is done, and writes nothing" || fail "a second comment or file says it is done, and writes nothing ($rc, $rc2)" "$out$(printf '\n')$out2"
clean=$(newrun "$NAME" "${NAME^^}-13" done)
logf "$clean" coachman note "$TICKET" "nothing went wrong"
out=$(tf harvest "$clean" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = "run $(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["runs"][-1]["run_id"])' "$clean/tool-faults.json"): no tool faults" ] \
  && [ ! -e "$clean/tool-faults" ] && [ ! -s "$S/writes.log" ] && ok "a clean log yields no fault and no draft" || fail "a clean log yields no fault and no draft (exit $rc)" "$out"
open=$(newrun "$NAME" "${NAME^^}-14" review)
logf "$open" coachman tool-fault scripts/launch.sh --ran x --failed y --error none --diagnosis z --fix w
out=$(tf harvest "$open" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "still open" && [ ! -e "$open/tool-faults.json" ] \
  && ok "a run still open is not harvested" || fail "a run still open is not harvested (exit $rc)" "$out"
mine=$(newrun "$NAME" "${NAME^^}-15" abandoned)
logf "$mine" coachman tool-fault scripts/launch.sh --ran "launch" --failed "the model flag was refused" --error none --diagnosis "renamed" --fix "use the new flag"
python3 -c 'import json, sys; p = sys.argv[1]; s = json.load(open(p)); s["access"] = "READ"; json.dump(s, open(p, "w"))' "$S/db.json"
out=$(tf harvest "$mine" 2>&1); rc=$?; F=$(id_where 'scripts/launch.sh')
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qF "the user does not own postmaster's repository" && [ "$(state_of "$mine" "$F")" = kept ] \
  && ok "a repository the user does not own is no tracker: the faults are kept" || fail "a repository the user does not own is no tracker: the faults are kept (exit $rc)" "$out"
out=$(tf file "$mine" "$F" 2>&1); rc=$?
[ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "no tracker of postmaster's own" && [ ! -s "$S/writes.log" ] \
  && ok "and nothing is filed there" || fail "and nothing is filed there (exit $rc)" "$out"
python3 -c 'import json, sys; p = sys.argv[1]; s = json.load(open(p)); s["access"] = "ADMIN"; json.dump(s, open(p, "w"))' "$S/db.json"
mkdir -p "$REPO/tools/postmaster" && cp -R "$T/scripts" "$T/skills" "$REPO/tools/postmaster/" || exit 1
vend=$(newrun "$NAME" "${NAME^^}-18" done)
logf "$vend" coachman tool-fault scripts/launch.sh --ran "launch" --failed "the effort flag was refused for $NAME" --error none --diagnosis x --fix "use the new flag"
out=$(PATH="$tmp/bin:$PATH" TOOL_FAULTS_STUB="$S" "$REPO/tools/postmaster/scripts/tool-faults.sh" harvest "$vend" 2>&1); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qF "not a git checkout of its own" && [ ! -s "$S/writes.log" ] && [ -z "$(leaks "$(cat "$vend"/tool-faults/*/*)")" ] \
  && ok "a copy of postmaster inside the target is no tracker, and withholds the target all the same" \
  || fail "a copy of postmaster inside the target is no tracker, and withholds the target all the same (exit $rc)" "$out"
out=$(tf harvest "$mine" 2>&1)
: > "$S/no-search"; out=$(tf harvest "$mine" 2>&1); out2=$(tf file "$mine" "$F" 2>&1); rc=$?; mv -- "$S/no-search" "$tmp/no-search.was"
[ "$(state_of "$mine" "$F")" = unchecked ] && [ $rc -eq 1 ] && printf '%s\n' "$out2" | grep -qF "could not be read, so nothing is filed" && [ ! -s "$S/writes.log" ] \
  && ok "a tracker that cannot be searched leaves the fault unchecked, and nothing is filed" \
  || fail "a tracker that cannot be searched leaves the fault unchecked, and nothing is filed (exit $rc)" "$out$(printf '\n')$out2"
printf '%s\n' "\`$IDENT\` is the one to fix" >> "$(draft_of "$mine" "$F")"
out=$(tf file "$mine" "$F" 2>&1); rc=$?
[ $rc -eq 2 ] && [ ! -s "$S/writes.log" ] && printf '%s\n' "$out" | grep -qF "not safe to publish" \
  && ok "file refuses a draft changed to carry the target's code" || fail "file refuses a draft changed to carry the target's code (exit $rc)" "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
