#!/usr/bin/env bash
# Does a change touch the coachman contract? The contract is defined in one place,
# skills/postmaster/contract.md; its parts are marked in the runbooks and scripts that
# implement them with <!-- contract:part=NAME --> ... <!-- /contract:part=NAME --> (a
# `# ` comment prefix in shell). This script compares those marked regions between two
# revisions and names every part whose region changed, with the file and line that touched
# it. It never reads a ticket's prose.
#
#   contract.sh <base> <head>     the change from base to head; in any git repository
#   contract.sh --parts           the part names the tree marks
#   contract.sh --self-test
#
#   exit 0  no: the change does not touch the contract
#   exit 1  yes: one line per part touched, `part: file:line`, on stdout
#   exit 2  usage, or a revision that cannot be read
#
# For "what a merge of main brought in", pass the merge's first parent and the merge itself
# (`contract.sh <merge>^1 <merge>`): that diff is exactly what the merge introduced.
# A change to skills/postmaster/contract.md outside any part region is a contract change
# named `definition`. The repository is the one the command runs in.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
usage() { echo "usage: contract.sh <base> <head> | --parts | --self-test" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "contract: not a git repository" >&2; exit 2; }

core() {  # core <base> <head>
  python3 - "$ROOT" "$1" "$2" <<'PY'
import difflib, pathlib, re, subprocess, sys

root, base, head = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
MARK = re.compile(r"^\s*(?:#\s*)?<!--\s*(/?)contract:part=([a-z][a-z0-9-]*)\s*-->\s*$")
DEFINITION = "skills/postmaster/contract.md"

def git(*a):
    r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def files(rev):
    out = git("ls-tree", "-r", "--name-only", rev)
    if out is None:
        print("contract: cannot read revision %s" % rev, file=sys.stderr); sys.exit(2)
    return [ln for ln in out.splitlines() if ln]

def regions(rev):
    """(part -> [(file, start, end, [(lineno, text), ...])], lines of contract.md outside any region)"""
    found, outside = {}, []
    for f in files(rev):
        text = git("show", "%s:%s" % (rev, f))
        if text is None:
            continue
        open_part, start, body = None, None, []
        for n, line in enumerate(text.splitlines(), 1):
            m = MARK.match(line)
            if m and not m.group(1):
                if open_part is not None:
                    print("contract: %s:%d opens %s while %s is open" % (f, n, m.group(2), open_part),
                          file=sys.stderr); sys.exit(2)
                open_part, start, body = m.group(2), n, []
                continue
            if m and m.group(1):
                if open_part is None or open_part != m.group(2):
                    print("contract: %s:%d closes %s but no such region is open" % (f, n, m.group(2)),
                          file=sys.stderr); sys.exit(2)
                found.setdefault(open_part, []).append((f, start, n, body))
                open_part, start, body = None, None, []
                continue
            if open_part is not None:
                body.append((n, line))
            elif f == DEFINITION:
                outside.append((n, line))
        if open_part is not None:
            print("contract: %s: region %s is never closed" % (f, open_part), file=sys.stderr); sys.exit(2)
    return found, outside

def body_text(region):
    return [text for _, text in region[3]]

def first_diff_line(a, b):
    """The first line where two bodies differ, head-side when it exists, else base-side."""
    sm = difflib.SequenceMatcher(a=[t for _, t in a], b=[t for _, t in b])
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            if j1 < len(b):
                return b[j1][0]
            if i1 < len(a):
                return a[i1][0]
    return a[0][0] if a else b[0][0]

try:
    base_r, base_out = regions(base)
    head_r, head_out = regions(head)
except SystemExit:
    raise
except Exception as e:
    print("contract: cannot read the regions: %s" % e, file=sys.stderr); sys.exit(2)

touched = {}  # part -> (file, line)
for part in sorted(set(base_r) | set(head_r)):
    b = [(r[0], body_text(r)) for r in base_r.get(part, [])]
    h = [(r[0], body_text(r)) for r in head_r.get(part, [])]
    if b == h:
        continue
    # Report the first region whose file or body differs; its head start line when it remains.
    for i in range(max(len(b), len(h))):
        bf, bb = b[i] if i < len(b) else (None, [])
        hf, hb = h[i] if i < len(h) else (None, [])
        if bf == hf and bb == hb:
            continue
        if i < len(head_r.get(part, [])):
            fr, br, hr = head_r[part][i], base_r[part][i][3] if i < len(base_r.get(part, [])) else [], head_r[part][i][3]
            touched[part] = (fr[0], first_diff_line(br, hr) if br else fr[1])
        else:
            fr = base_r[part][i]
            touched[part] = (fr[0], fr[1])
        break

if [t for _, t in base_out] != [t for _, t in head_out]:
    line = first_diff_line(base_out, head_out)
    touched.setdefault("definition", (DEFINITION, line))

if not touched:
    sys.exit(0)
for part in sorted(touched):
    f, line = touched[part]
    print("%s: %s:%s" % (part, f, line))
sys.exit(1)
PY
}

case ${1:-} in
  --parts)
    python3 - "$ROOT" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
MARK = re.compile(r"^\s*(?:#\s*)?<!--\s*contract:part=([a-z][a-z0-9-]*)\s*-->\s*$")
found = set()
for p in root.rglob("*"):
    if not p.is_file() or ".git" in p.parts:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        continue
    for line in text.splitlines():
        m = MARK.match(line)
        if m:
            found.add(m.group(1))
for name in sorted(found):
    print(name)
PY
    exit $? ;;
  --self-test) ;;
  -*|"") usage ;;
  *)
    [ $# -eq 2 ] || usage
    core "$1" "$2"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
# A miniature tree that carries the same marker shapes the real files use, so each control
# changes exactly one part. The last controls check the real tree still marks every part.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
G() { git -C "$tmp/repo" -c user.name=contract -c user.email=contract@example.invalid "$@"; }

mkdir -p "$tmp/repo/skills/postmaster" "$tmp/repo/scripts"
cd "$tmp/repo" || exit 1
G init -q
cat > skills/postmaster/contract.md <<'EOF'
# The coachman contract

## markers

<!-- contract:part=markers -->
| `.leg-<n>-done` | coachman |
<!-- /contract:part=markers -->

## waybill

<!-- contract:part=waybill -->
A waybill has `## Ticket` and `## Dispatch`.
<!-- /contract:part=waybill -->

## turnpikes

<!-- contract:part=turnpikes -->
style default review idiom
<!-- /contract:part=turnpikes -->

## legs

<!-- contract:part=legs -->
synthesis, review, ship
<!-- /contract:part=legs -->

## stages

<!-- contract:part=stages -->
dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned
<!-- /contract:part=stages -->

## completion

<!-- contract:part=completion -->
handoff sections, then .leg-<n>-done
<!-- /contract:part=completion -->
EOF
cat > skills/postmaster/coachman.md <<'EOF'
# Coachman

<!-- contract:part=markers -->
| `.leg-<n>-done`, `.leg-<n>-exited` | leg done; process gone |
<!-- /contract:part=markers -->

Prose outside any region is not the contract.

<!-- contract:part=legs -->
| 1 | synthesis |
<!-- /contract:part=legs -->

<!-- contract:part=completion -->
A leg ends on a complete hand-off.
<!-- /contract:part=completion -->
EOF
cat > skills/postmaster/SKILL.md <<'EOF'
# Skill

<!-- contract:part=waybill -->
```
# Waybill: <TICKET>

## Ticket
## Dispatch
```
<!-- /contract:part=waybill -->
EOF
cat > scripts/turnpikes.sh <<'EOF'
#!/usr/bin/env bash
# <!-- contract:part=turnpikes -->
TABLE="style default review"
# <!-- /contract:part=turnpikes -->
# <!-- contract:part=legs -->
LEGS="1 synthesis 2 review 3 ship"
# <!-- /contract:part=legs -->
EOF
cat > scripts/stage.sh <<'EOF'
#!/usr/bin/env bash
# <!-- contract:part=stages -->
STAGES="dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned"
# <!-- /contract:part=stages -->
EOF
cat > scripts/handoff-check.sh <<'EOF'
#!/usr/bin/env bash
# <!-- contract:part=completion -->
required="Decisions Deferred findings"
# <!-- /contract:part=completion -->
EOF
cat > scripts/runs-status.sh <<'EOF'
#!/usr/bin/env bash
# <!-- contract:part=markers -->
#   next   USER  (.waiting-on-user)
# <!-- /contract:part=markers -->
EOF
cat > scripts/host.sh <<'EOF'
#!/usr/bin/env bash
# <!-- contract:part=markers -->
# --marker is touched when it exits
# <!-- /contract:part=markers -->
EOF
cat > skills/postmaster/harnesses.md <<'EOF'
# Harnesses

A new harness entry is prose in an adapter, not the contract.
EOF
printf 'A docs-only change is not a contract change.\n' > README.md
G add -A && G commit -q -m base
base=$(G rev-parse HEAD)

checks() {  # checks <label> <want-exit> <want-part-or-empty> <base> <head>
  local label=$1 want=$2 part=$3 a=$4 b=$5 out rc
  out=$(cd "$tmp/repo" && "$HERE/contract.sh" "$a" "$b" 2>"$tmp/err"); rc=$?
  if [ $rc -ne "$want" ]; then
    fail "$label (exit $rc, wanted $want)" "$out$(cat "$tmp/err")"
    return
  fi
  if [ -n "$part" ]; then
    if printf '%s\n' "$out" | grep -q "^$part: "; then
      local fileline
      fileline=$(printf '%s\n' "$out" | sed -n "s/^$part: //p" | head -1)
      case $fileline in
        *:[0-9]*) ok "$label" ;;
        *) fail "$label (no file:line in '$fileline')" "$out" ;;
      esac
    else
      fail "$label (did not name $part)" "$out"
    fi
  else
    [ -z "$out" ] && ok "$label" || fail "$label (printed something)" "$out"
  fi
}

echo "positive controls: each contract change answers yes and names the part"
sed -i 's/\.leg-<n>-done/\.leg-<n>-finished/' skills/postmaster/coachman.md
G add -A && G commit -q -m "rename a marker"
head1=$(G rev-parse HEAD)
checks "renaming a marker is yes and names markers" 1 markers "$base" "$head1"
G reset -q --hard "$base"

sed -i 's/^## Dispatch$/## Dispatch\n## Extra/' skills/postmaster/SKILL.md
G add -A && G commit -q -m "add a waybill section"
head2=$(G rev-parse HEAD)
checks "adding a waybill section is yes and names waybill" 1 waybill "$base" "$head2"
G reset -q --hard "$base"

sed -i 's/^TABLE="style default review"$/TABLE="style default review"\nextra - review another check/' scripts/turnpikes.sh
G add -A && G commit -q -m "change the turnpike table"
head3=$(G rev-parse HEAD)
checks "changing the turnpike table is yes and names turnpikes" 1 turnpikes "$base" "$head3"
G reset -q --hard "$base"

sed -i 's/shipped done/shipped landing done/' scripts/stage.sh
G add -A && G commit -q -m "add a stage"
head4=$(G rev-parse HEAD)
checks "adding a stage is yes and names stages" 1 stages "$base" "$head4"
G reset -q --hard "$base"

sed -i 's/Decisions Deferred findings/Decisions/' scripts/handoff-check.sh
G add -A && G commit -q -m "change completion detection"
head5=$(G rev-parse HEAD)
checks "changing completion detection is yes and names completion" 1 completion "$base" "$head5"
G reset -q --hard "$base"

echo "negative controls: each non-contract change answers no"
printf 'More docs.\n' >> README.md
G add -A && G commit -q -m "docs only"
head6=$(G rev-parse HEAD)
checks "a docs-only change is no" 0 "" "$base" "$head6"
G reset -q --hard "$base"

sed -i 's/Prose outside any region is not the contract./Prose outside any region stays outside./' skills/postmaster/coachman.md
G add -A && G commit -q -m "wording fix outside the contract"
head7=$(G rev-parse HEAD)
checks "a runbook wording fix outside the contract is no" 0 "" "$base" "$head7"
G reset -q --hard "$base"

printf 'codex    another CLI\n' >> skills/postmaster/harnesses.md
G add -A && G commit -q -m "new harness entry"
head8=$(G rev-parse HEAD)
checks "a new harness entry is no" 0 "" "$base" "$head8"
G reset -q --hard "$base"

echo "merge controls: what a merge of main brought in"
# Branch with no contract change of its own; main later brings one in.
G checkout -q -b topic "$base"
printf 'topic work\n' >> README.md
G add -A && G commit -q -m "topic work"
topic=$(G rev-parse HEAD)
G checkout -q -b main-with-contract "$base"
sed -i 's/\.leg-<n>-done/\.leg-<n>-done2/' skills/postmaster/coachman.md
G add -A && G commit -q -m "contract change on main"
mainc=$(G rev-parse HEAD)
G checkout -q topic
G merge -q --no-ff -m "Merge main" "$mainc" || fail "merge of the contract-changing main"
mergec=$(G rev-parse HEAD)
checks "a merge of main that brought in a contract change is yes" 1 markers "$mergec^1" "$mergec"
G reset -q --hard "$base"
G checkout -q -b topic2 "$base"
printf 'topic2 work\n' >> README.md
G add -A && G commit -q -m "topic2 work"
G checkout -q -b main-plain "$base"
printf 'plain main\n' > NOTES.md
G add -A && G commit -q -m "main without a contract change"
mainp=$(G rev-parse HEAD)
G checkout -q topic2
G merge -q --no-ff -m "Merge main" "$mainp" || fail "merge of the plain main"
mergep=$(G rev-parse HEAD)
checks "a merge of main that brought in no contract change is no" 0 "" "$mergep^1" "$mergep"

echo "the real tree: every part the definition names is marked outside it"
cd "$ROOT" || exit 1
parts=$("$HERE/contract.sh" --parts)
for part in markers waybill turnpikes legs stages completion; do
  printf '%s\n' "$parts" | grep -qx "$part" \
    && ok "the tree marks $part" || fail "the tree marks $part" "$parts"
done
for part in $parts; do
  n=$(python3 - "$part" <<'PY'
import pathlib, re, sys
part = sys.argv[1]
MARK = re.compile(r"^\s*(?:#\s*)?<!--\s*contract:part=%s\s*-->\s*$" % re.escape(part))
open_m = re.compile(r"^\s*(?:#\s*)?<!--\s*contract:part=%s\s*-->\s*$" % re.escape(part))
close_m = re.compile(r"^\s*(?:#\s*)?<!--\s*/contract:part=%s\s*-->\s*$" % re.escape(part))
root = pathlib.Path(".")
count = 0
for p in list(root.rglob("*")):
    if not p.is_file() or ".git" in p.parts:
        continue
    if str(p) == "skills/postmaster/contract.md":
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        continue
    if any(open_m.match(ln) for ln in text.splitlines()):
        count += 1
print(count)
PY
)
  [ "${n:-0}" -ge 1 ] && ok "$part is implemented outside the definition" \
    || fail "$part is implemented outside the definition" "regions outside contract.md: ${n:-0}"
done

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
