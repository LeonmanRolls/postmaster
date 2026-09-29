#!/usr/bin/env bash
# Turn a harness's own code-review output into the flow's finding contract, so the coachman
# dedups and verifies these findings as it does brief findings. Where the harness does not
# provide a field the contract asks for, such as a severity, the field is marked `not
# provided` rather than invented.
#
#   review-findings.sh <harness> <report-file> [--root <dir>]
#   review-findings.sh --self-test
#
# <report-file> is the lane's final message (its last result line, codex's -o file, or the
# last text event), already extracted from the events stream. --root makes an absolute path
# under <dir> relative, which is what a codex report needs: it cites the scratch's full path.
#
# One JSON object per finding on stdout, fields of the finding contract:
#   file, line, end_line, severity, confidence, title, body, evidence
# Severity is P1 to P3 where the harness gave one, otherwise `not provided`; confidence is the
# harness's own value or `not provided`; evidence is quoted code when the report carried one.
#
#   exit 0  the report was read; it holds no findings, or every finding was printed
#   exit 1  usage, or a report file that cannot be read
#   exit 3  the report looks like a review with findings that cannot be parsed: a loud
#           failure, never counted as a clean review
set -uo pipefail
usage() { echo "usage: review-findings.sh <harness> <report-file> [--root <dir>] | --self-test" >&2; exit 1; }

if [ "${1:-}" = --self-test ]; then
  self=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")
  tmp=$(mktemp -d) || exit 1
  trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  fails=0
  ok()   { printf '  ok   %s\n' "$1"; }
  fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
  parse() {  # parse <harness> <report>: prints findings; $rc is the exit
    printf '%s' "$2" > "$tmp/report.txt"
    out=$("$self" "$1" "$tmp/report.txt" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err")
  }
  is() {  # is <label> <want-exit> <want-out> <harness> <report>
    local label=$1 want_rc=$2 want_out=$3; shift 3
    parse "$@"
    if [ "$rc" -eq "$want_rc" ] && [ "$out" = "$(printf '%b' "$want_out")" ]; then ok "$label"
    else fail "$label" "wanted exit $want_rc and $(printf '%b' "$want_out" | head -c 200), got exit $rc
$(printf '%s' "$out" | head -c 400)
$err"; fi
  }
  has_field() {  # has_field <label> <field> <value> <harness> <report>
    local label=$1 field=$2 want=$3; shift 3
    parse "$@"
    case $out in *"\"$field\": \"$want\""*|*"\"$field\": $want"*) ok "$label" ;;
      *) fail "$label" "no $field=$want in $out" ;;
    esac
  }

  echo "positive controls: each harness's recorded output becomes findings at file and line"
  # From raw/trials/code-review-scope/claude-range.txt (claude 2.1.283, /code-review low).
  is "claude's low report yields the finding at src/page.js:8" 0 \
    '{"file": "src/page.js", "line": 8, "end_line": 8, "severity": "not provided", "confidence": "not provided", "title": "Off-by-one in the slice end", "body": "`slice(start, start + size + 1)` returns `size + 1` records per page.", "evidence": "not provided"}' \
    claude 'src/page.js:8 — Off-by-one in the slice end: `slice(start, start + size + 1)` returns `size + 1` records per page.
'
  # From raw/trials/code-review-scope/claude-default-medium.txt (claude, /code-review medium).
  has_field "claude's medium report yields the finding at src/page.js:8" file src/page.js claude 'I found one bug in the changes.
- `src/page.js:8`: `page()` returns one record too many.
'
  has_field "and at line 8" line 8 claude 'I found one bug in the changes.
- `src/page.js:8`: `page()` returns one record too many.
'
  # From raw/trials/code-review-scope/codex-base.txt (codex-cli 0.157.1, review --base).
  has_field "codex's report yields the finding at src/page.js" file /tmp/scratch/src/page.js codex 'Review comment:

- [P1] Return no more than `size` records — /tmp/scratch/src/page.js:8-8
  `slice` uses an exclusive end index, so adding 1 returns up to `size + 1` records.
'
  has_field "and at line 8" line 8 codex '- [P1] Return no more than `size` records — /tmp/scratch/src/page.js:8-8
  body
'
  has_field "and its severity is the priority it gave" severity P1 codex '- [P1] Return no more than `size` records — /tmp/scratch/src/page.js:8-8
  body
'
  printf '%s' '- [P1] Return no more than `size` records — /tmp/scratch/src/page.js:8-8
  body
' > "$tmp/report.txt"
  out=$("$self" codex "$tmp/report.txt" --root /tmp/scratch 2>"$tmp/err"); rc=$?
  case $out in *'"file": "src/page.js"'*) ok "and an absolute path under --root is relative" ;;
    *) fail "and an absolute path under --root is relative" "exit $rc $out $(cat "$tmp/err")" ;;
  esac
  # From raw/trials/code-review-scope/mimo-range.txt (MiMo Code 0.1.15, /review with a range).
  has_field "mimo's report yields the finding at src/page.js" file src/page.js mimo '### Bug — `src/page.js:8`: off-by-one, pages return `size + 1` records

```js
return all().slice(start, start + size + 1);
```

`Array.prototype.slice(start, end)` is end-exclusive.
'
  has_field "and at line 8" line 8 mimo '### Bug — `src/page.js:8`: off-by-one
'
  has_field "and marks severity not provided rather than inventing one" severity "not provided" mimo \
    '### Bug — `src/page.js:8`: off-by-one
'
  has_field "and keeps the quoted code as evidence" evidence "return all().slice(start, start + size + 1);" mimo \
    '### Bug — `src/page.js:8`: off-by-one

```js
return all().slice(start, start + size + 1);
```
'
  # A JSON array in the final message, the shape claude's prompt asks for at xhigh and max.
  is "a JSON array of findings is read as findings" 0 \
    '{"file": "src/page.js", "line": 8, "end_line": 8, "severity": "not provided", "confidence": "not provided", "title": "Off-by-one in slice", "body": "returns size+1", "evidence": "not provided"}' \
    claude '[{"file": "src/page.js", "line": 8, "summary": "Off-by-one in slice", "failure_scenario": "returns size+1"}]
'
  has_field "and one in a fenced json block is too" file src/page.js claude 'Nine findings remain.

```json
[
  {
    "file": "src/page.js",
    "line": 8,
    "summary": "The slice end makes page() return size + 1 records.",
    "failure_scenario": "pages overlap. Reproduced with node."
  }
]
```
'
  has_field "mimo's Bug heading with the path in the body yields the finding" file src/page.js mimo \
    '### Bug — off-by-one in `page` (high)

`src/page.js:8` returns one record too many:

```js
return all().slice(start, start + size + 1);
```
'

  echo "negative controls: no findings yield none; unparseable output fails loudly"
  is "a report that says there is nothing to review yields none" 0 '' \
    mimo 'Nothing to review. The worktree has no uncommitted changes.
'
  is "a claude report with no finding line yields none" 0 '' \
    claude 'I found no bugs in the changes. The diff looks correct.
'
  is "an empty JSON array yields none" 0 '' \
    claude '[]
'
  is "a codex report with only a verdict and no finding yields none" 0 '' \
    codex 'The patch is correct. No findings.
'
  is "output that is not a review report fails loudly, never as clean" 3 '' \
    claude 'ERROR: something exploded in the harness
'
  is "a finding marker with no parseable location fails loudly" 3 '' \
    mimo '### Bug — somewhere in the code, there is a problem
'
  is "codex's markdown with a priority but no path fails loudly" 3 '' \
    codex '- [P1] A serious problem exists here
'
  parse claude 'this is just a paragraph with no review shape at all
'
  [ $rc -eq 3 ] && ok "a long report with no markers and no findings fails loudly" \
    || fail "a long report with no markers and no findings fails loudly" "exit $rc $out"
  parse claude ''
  [ $rc -eq 0 ] && [ -z "$out" ] && ok "an empty report yields none" \
    || fail "an empty report yields none" "exit $rc $out"
  "$self" claude "$tmp/no-such-file" >/dev/null 2>&1; rc=$?
  [ $rc -eq 1 ] && ok "a missing report file is refused" || fail "a missing report file is refused" "exit $rc"
  "$self" style-review "$tmp/report.txt" >/dev/null 2>&1; rc=$?
  [ $rc -eq 1 ] && ok "a harness with no review form is refused" || fail "a harness with no review form is refused" "exit $rc"

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

[ $# -ge 2 ] || usage
HARNESS=$1; REPORT=$2; shift 2
ROOT=""
while [ $# -gt 0 ]; do
  case $1 in
    --root) [ $# -ge 2 ] || usage; ROOT=$2; shift ;;
    *) usage ;;
  esac
  shift
done
case $HARNESS in claude|codex|mimo) ;; *)
  echo "review-findings: $HARNESS has no code-review form; nothing to parse" >&2; exit 1 ;;
esac
[ -f "$REPORT" ] && [ -r "$REPORT" ] || { echo "review-findings: cannot read $REPORT" >&2; exit 1; }

python3 - "$HARNESS" "$REPORT" "$ROOT" <<'PY'
import json, os, re, sys

harness, report_path, root = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(report_path, encoding="utf-8", errors="replace").read()

NOT = "not provided"

def field(v):
    if v is None or v == "":
        return NOT
    return v

def norm_path(p):
    if not p:
        return p
    p = p.strip().strip("`")
    if root:
        r = os.path.abspath(root)
        ap = os.path.abspath(p) if os.path.isabs(p) else os.path.abspath(os.path.join(root, p))
        if ap == r or ap.startswith(r + os.sep):
            return os.path.relpath(ap, r)
    return p

def emit(f):
    out = {
        "file": field(f.get("file")),
        "line": f.get("line") if f.get("line") not in (None, "") else NOT,
        "end_line": f.get("end_line") if f.get("end_line") not in (None, "") else f.get("line") if f.get("line") not in (None, "") else NOT,
        "severity": field(f.get("severity")),
        "confidence": field(f.get("confidence")),
        "title": field(f.get("title")),
        "body": field(f.get("body")),
        "evidence": field(f.get("evidence")),
    }
    # line/end_line are numbers when the harness gave one, so the contract's file:line is usable
    for k in ("line", "end_line"):
        if isinstance(out[k], str) and out[k] != NOT:
            try:
                out[k] = int(out[k])
            except ValueError:
                pass
    print(json.dumps(out, ensure_ascii=False))

def cleanish(t):
    s = t.strip()
    if not s:
        return True
    low = s.lower()
    phrases = (
        "nothing to review", "no findings", "no bugs", "no issues",
        "looks correct", "no problems", "no defects", "patch is correct",
        "i found no", "found nothing", "no code changes",
    )
    return any(p in low for p in phrases) and not re.search(r"(P[123]\]|—\s*\S+:\d+|\S+:\d+\s*[:—])", s)

# --- claude -----------------------------------------------------------------------------
def parse_claude(t):
    found = []
    # JSON array in the final message (xhigh / max), whole or in a fenced block.
    candidates = [t.strip()]
    candidates += re.findall(r"```(?:json)?\n(\[[\s\S]*?\n\])\n```", t)
    for blob in candidates:
        if not blob.startswith("["):
            continue
        try:
            arr = json.loads(blob)
        except ValueError:
            arr = None
        if not isinstance(arr, list) or not arr:
            if isinstance(arr, list):
                return []
            continue
        for item in arr:
            if not isinstance(item, dict):
                continue
            loc = item.get("location") or item.get("loc") or item
            f = item.get("file") or loc.get("file") or item.get("path")
            ln = item.get("line") or loc.get("line") or loc.get("start")
            if not f or ln in (None, ""):
                continue
            found.append({
                "file": norm_path(str(f)), "line": int(ln) if str(ln).isdigit() else ln,
                "end_line": item.get("end_line") or loc.get("end") or ln,
                "severity": item.get("severity") or item.get("priority"),
                "confidence": item.get("confidence"),
                "title": item.get("short_summary") or item.get("title") or item.get("summary"),
                "body": item.get("failure_scenario") or item.get("body") or item.get("summary"),
                "evidence": item.get("evidence") or item.get("code"),
            })
        if found:
            return found
    # `path:line — title` or `path:line — title: body` (low).
    for m in re.finditer(r"^(\S+?):(\d+)\s*[—-]\s*(.+)$", t, re.M):
        path, line, rest = m.group(1), int(m.group(2)), m.group(3).strip()
        title, body = rest, rest
        if ": " in rest:
            title, body = rest.split(": ", 1)
        found.append({"file": norm_path(path), "line": line, "end_line": line,
                      "title": title, "body": body})
    # `path:line: title` and `- `path:line`: title` (medium and later).
    for m in re.finditer(r"^[ \t]*[-*]?\s*`([^`]+?):(\d+)`:\s*(.+)$", t, re.M):
        found.append({"file": norm_path(m.group(1)), "line": int(m.group(2)), "end_line": int(m.group(2)),
                      "title": m.group(3)[:80], "body": m.group(3)})
    for m in re.finditer(r"^(\S+?):(\d+):\s*(.+)$", t, re.M):
        path, line, rest = m.group(1), int(m.group(2)), m.group(3).strip()
        if path.startswith("http") or "/" not in path and not path.endswith((".js", ".ts", ".py", ".md", ".sh", ".go", ".rs", ".c", ".h", ".java")):
            continue
        found.append({"file": norm_path(path), "line": line, "end_line": line,
                      "title": rest[:80], "body": rest})
    return found

# --- codex ------------------------------------------------------------------------------
def parse_codex(t):
    found = []
    # `- [P1] title — path:start-end` with a body indented under it.
    for m in re.finditer(
        r"^[ \t]*[-*]\s*\[(P[123])\]\s*(.+?)\s*[—-]\s*(\S+?):(\d+)(?:-(\d+))?\s*$"
        r"\n((?:[ \t]+.+\n?)*)",
        t, re.M,
    ):
        pri, title, path, start, end, body = m.group(1), m.group(2).strip(), m.group(3), int(m.group(4)), m.group(5), m.group(6)
        body = re.sub(r"^[ \t]+", "", body.strip(), flags=re.M)
        found.append({
            "file": norm_path(path), "line": start, "end_line": int(end) if end else start,
            "severity": pri, "title": title, "body": body or title,
        })
    if found:
        return found
    # A single-line form with no body.
    for m in re.finditer(r"\[(P[123])\]\s*(.+?)\s*[—-]\s*(\S+?):(\d+)(?:-(\d+))?", t):
        found.append({
            "file": norm_path(m.group(3)), "line": int(m.group(4)),
            "end_line": int(m.group(5)) if m.group(5) else int(m.group(4)),
            "severity": m.group(1), "title": m.group(2).strip(), "body": m.group(2).strip(),
        })
    return found

# --- mimo -------------------------------------------------------------------------------
def parse_mimo(t):
    found = []
    # `### Bug — `path:line`: title` or `### Bug — path:line: title`, with a fenced block as evidence.
    for m in re.finditer(
        r"^#{2,4}\s*(?:Bug|Issue|Problem|Finding)\s*[—-]\s*`?([^`:\n]+?):(\d+)`?\s*:?\s*([^\n]*)\n+"
        r"(?:```[a-zA-Z]*\n(.*?)```\n)?",
        t, re.M | re.S,
    ):
        evidence = (m.group(4) or "").strip() or None
        title = m.group(3).strip() or "Bug"
        found.append({
            "file": norm_path(m.group(1)), "line": int(m.group(2)), "end_line": int(m.group(2)),
            "title": title, "body": title,
            "evidence": evidence,
        })
    if found:
        return found
    # `### Bug — title` with `path:line` in the section that follows.
    for m in re.finditer(
        r"^#{2,4}\s*(?:Bug|Issue|Problem|Finding)\s*[—-]\s*([^\n]*)\n(.*?)(?=^#{2,4}\s|\Z)",
        t, re.M | re.S,
    ):
        title = m.group(1).strip() or "Bug"
        body = m.group(2)
        loc = re.search(r"`([^`\n]+?):(\d+)`", body) or re.search(r"(\S+?):(\d+)\b", body)
        if not loc:
            continue
        evidence = None
        fence = re.search(r"```[a-zA-Z]*\n(.*?)```", body, re.S)
        if fence:
            evidence = fence.group(1).strip()
        found.append({
            "file": norm_path(loc.group(1)), "line": int(loc.group(2)), "end_line": int(loc.group(2)),
            "title": title, "body": title, "evidence": evidence,
        })
    if found:
        return found
    # `path:line: title` in a markdown report.
    for m in re.finditer(r"`([^`]+?):(\d+)`:\s*(.+)$", t, re.M):
        found.append({"file": norm_path(m.group(1)), "line": int(m.group(2)), "end_line": int(m.group(2)),
                      "title": m.group(3)[:80], "body": m.group(3)})
    return found

parsers = {"claude": parse_claude, "codex": parse_codex, "mimo": parse_mimo}
markers = {
    "claude": re.compile(r"`[^`\n]+?:\d+`|^\S+:\d+\s*[—:]|\[\s*\{|\"file\"\s*:"),
    "codex": re.compile(r"\[P[123]\]|—\s*\S+:\d+"),
    "mimo": re.compile(r"#{2,4}\s*(Bug|Issue|Problem|Finding)|`[^`\n]+?:\d+`|\S+:\d+:"),
}

found = parsers[harness](text)
if found:
    seen = set()
    for f in found:
        key = (f.get("file"), f.get("line"))
        if key in seen:
            continue
        seen.add(key)
        emit(f)
    sys.exit(0)

stripped = text.strip()
if not stripped or stripped == "[]" or cleanish(text):
    sys.exit(0)

# Markers of a review with findings, and nothing we could read: a loud failure, never clean.
if markers[harness].search(text):
    sys.stderr.write("review-findings: cannot parse %s review output in %s; it looks like a review with findings\n" % (harness, report_path))
    sys.exit(3)

sys.stderr.write("review-findings: cannot parse %s review output in %s; no findings and no markers of a review\n" % (harness, report_path))
sys.exit(3)
PY
