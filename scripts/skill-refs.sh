#!/usr/bin/env bash
# Find every script reference in the postmaster skill that would not resolve from an installed
# skill. An installed skill is a link from a harness's skills folder into the postmaster repo,
# and a session reaches the repo only as <tool>, the path SKILL.md finds from that link once.
# A reference resolves from any working directory only when it goes through <tool> and names
# a script the repo has.
#
#   skill-refs.sh [<file>...]          default: skills/postmaster/*.md beside this script's repo
#   skill-refs.sh --fix [<file>...]    put <tool>/ before every bare scripts/ path, in place
#   skill-refs.sh --self-test
#
# A reference is any scripts/ path. It is a fault when it is bare (scripts/x.sh, which resolves
# only from the repo's own root), when it reaches scripts/ some other way (../../scripts/x.sh),
# or when it goes through <tool> to a script the repo does not have. A path under another
# placeholder or variable, such as <repo>/scripts/, is that directory's and not the tool's.
# --fix rewrites the bare form only, so it can be run again after a rebase and changes nothing
# the second time; the check that follows it names whatever it could not fix.
#
#   exit 0  every reference resolves
#   exit 1  faults, one per line on stdout: <file>:<line>: <reason>: <reference>
#   exit 2  usage, or a file that cannot be read
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(dirname "$HERE")

refs() {  # refs <root> check|fix <file>...
  python3 - "$@" <<'PY'
import pathlib, re, sys

root, mode, files = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
REF = re.compile(r"scripts/[A-Za-z0-9._-]*")
BARE = re.compile(r"(?<![A-Za-z0-9_./-])scripts/")      # what --fix rewrites
OTHER = re.compile(r"(<[A-Za-z0-9_-]+>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)/$")

faults = []
for f in files:
    p = pathlib.Path(f)
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print("skill-refs: cannot read %s: %s" % (f, e), file=sys.stderr); sys.exit(2)
    if mode == "fix":
        new, n = BARE.subn("<tool>/scripts/", text)
        if n:
            p.write_text(new, encoding="utf-8")
            print("%s: %d reference(s) now go through <tool>" % (f, n), file=sys.stderr)
        text = new
    for n, line in enumerate(text.splitlines(), 1):
        for m in REF.finditer(line):
            before, ref = line[:m.start()], m.group().rstrip(".")
            if before and re.match(r"[A-Za-z0-9_]", before[-1]):
                continue                                   # part of a longer name
            name = ref[len("scripts/"):]
            if before.endswith("<tool>/"):
                if name and not (root / "scripts" / name).is_file():
                    faults.append((f, n, "no such script in the postmaster repo", "<tool>/" + ref))
            elif OTHER.search(before):
                continue                                   # another directory's scripts/
            elif before.endswith("/"):
                faults.append((f, n, "reaches scripts/ without going through <tool>", ref))
            else:
                faults.append((f, n, "bare; it resolves only from the repo's own root", ref))
for f, n, why, ref in faults:
    print("%s:%d: %s: %s" % (f, n, why, ref))
sys.exit(1 if faults else 0)
PY
}

MODE=check
case ${1:-} in
  --self-test) MODE=self-test ;;
  --fix) MODE=fix; shift ;;
  -*) echo "usage: skill-refs.sh [--fix] [<file>...] | --self-test" >&2; exit 2 ;;
esac
if [ "$MODE" != self-test ]; then
  if [ $# -eq 0 ]; then
    CDPATH= cd -- "$ROOT" || exit 2
    set -- skills/postmaster/*.md
    [ -f "$1" ] || { echo "skill-refs: no skills/postmaster/*.md in $ROOT" >&2; exit 2; }
  fi
  refs "$ROOT" "$MODE" "$@"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
mkdir -p "$tmp/root/scripts" && : > "$tmp/root/scripts/stage.sh" && : > "$tmp/root/scripts/launch.sh"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
faults() { refs "$tmp/root" check "$@" 2>/dev/null | grep -c . ; }

cat > "$tmp/bare.md" <<'EOF'
Set the stage with `scripts/stage.sh <dispatch> synthesis`.
( scripts/launch.sh launch <lane> <wt> <prompt> ) &
Every leg ends with scripts/stage.sh.
EOF
cat > "$tmp/good.md" <<'EOF'
Set the stage with `<tool>/scripts/stage.sh <dispatch> synthesis`.
( <tool>/scripts/launch.sh launch <lane> <wt> <prompt> ) &
The project's own `<repo>/scripts/build.sh` and "$HERE/scripts/x" are not the tool's.
Every `<tool>/scripts/` path is the repo's; postscripts/ and myscripts/x.sh are other words.
EOF
printf 'Run `../../scripts/stage.sh` from the skill.\n' > "$tmp/relative.md"
printf 'Run `<tool>/scripts/no-such.sh`.\n' > "$tmp/missing.md"

echo "positive controls: each fault is found, on its own line"
[ "$(faults "$tmp/bare.md")" -eq 3 ] && ok "three bare references are three faults" \
  || fail "three bare references are three faults" "$(refs "$tmp/root" check "$tmp/bare.md")"
out=$(refs "$tmp/root" check "$tmp/bare.md"); rc=$?
[ $rc -eq 1 ] && grep -qF "$tmp/bare.md:1: bare" <<<"$out" && ok "a fault names its file and line, and exits 1" \
  || fail "a fault names its file and line, and exits 1 (exit $rc)" "$out"
[ "$(faults "$tmp/relative.md")" -eq 1 ] && ok "a path that reaches scripts/ another way is a fault" \
  || fail "a path that reaches scripts/ another way is a fault"
[ "$(faults "$tmp/missing.md")" -eq 1 ] && ok "a script the repo does not have is a fault" \
  || fail "a script the repo does not have is a fault"

echo "negative controls: nothing is found where nothing is wrong"
refs "$tmp/root" check "$tmp/good.md" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(faults "$tmp/good.md")" -eq 0 ] && ok "references through <tool>, and other directories' scripts/, read zero" \
  || fail "references through <tool>, and other directories' scripts/, read zero (exit $rc)" "$(refs "$tmp/root" check "$tmp/good.md")"
refs "$tmp/root" check "$tmp/nowhere.md" >/dev/null 2>&1; rc=$?
[ $rc -eq 2 ] && ok "a file that cannot be read is exit 2, not a clean result" || fail "a file that cannot be read is exit 2 (exit $rc)"

echo "--fix: bare references go through <tool>, and a second run changes nothing"
cp "$tmp/bare.md" "$tmp/fix.md"; cat "$tmp/good.md" >> "$tmp/fix.md"; cat "$tmp/relative.md" >> "$tmp/fix.md"
refs "$tmp/root" fix "$tmp/fix.md" >/dev/null 2>&1
[ "$(faults "$tmp/fix.md")" -eq 1 ] && ! grep -q '<tool>/<tool>/' "$tmp/fix.md" && grep -qF '`<tool>/scripts/stage.sh <dispatch>' "$tmp/fix.md" \
  && ok "every bare reference is fixed, none is doubled, and the one it cannot fix is still named" \
  || fail "every bare reference is fixed, none is doubled, and the one it cannot fix is still named" "$(cat "$tmp/fix.md")"
cp "$tmp/fix.md" "$tmp/once.md"; refs "$tmp/root" fix "$tmp/fix.md" >/dev/null 2>&1
cmp -s "$tmp/fix.md" "$tmp/once.md" && ok "a second --fix changes nothing" || fail "a second --fix changes nothing"
cp "$tmp/good.md" "$tmp/good-copy.md"; refs "$tmp/root" fix "$tmp/good-copy.md" >/dev/null 2>&1
cmp -s "$tmp/good.md" "$tmp/good-copy.md" && ok "--fix leaves a file with no bare reference alone" || fail "--fix leaves a file with no bare reference alone"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
