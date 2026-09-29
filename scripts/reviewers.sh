#!/usr/bin/env bash
# Which lanes review under each lens. A lens is reviewed by the lanes the config names for it in
# [team.lens_reviewers], or, where it names none, by [team] reviewers, which default to the
# workhorses. Bug reviewers are then limited to lanes whose harness has a code-review form.
# The postmaster writes the result into the waybill's Team section, and the coachman reads it
# back from there, so a run keeps the reviewers it was dispatched with.
#
#   reviewers.sh lines [--config <path>]   the waybill's reviewer lines, from the config
#   reviewers.sh eligible <lens> [--config <path>]  configured lanes for a lens, checked for eligibility
#   reviewers.sh lanes <waybill> <lens>    the lanes for one lens, one per line, from a waybill
#   reviewers.sh lenses                    the lenses, in the order the review stage runs them
#   reviewers.sh --self-test
#
# `lines` prints `reviewers: <lane>, <lane>`, a `bug reviewers:` line containing only eligible
# lanes, then each other lens the config gives its own lanes. `eligible` resolves a configured
# lens and exits 2 if it has no eligible reviewers. `lanes` reads only the waybill's `## Team`
# section: the lens's own line where it has one, the `reviewers:` line otherwise. The lenses are
# the entries of the review stage in skills/postmaster/coachman.md, and change with it.
#
#   exit 0  printed
#   exit 1  usage, no config or one that does not parse, or no such waybill
#   exit 2  a lens the review stage does not have, a lane the config does not define, a lens with
#           no eligible lanes, or a waybill whose Team section has no reviewers line
set -uo pipefail
LENSES="style bug security"
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
usage() { echo "usage: reviewers.sh lines [--config <path>] | eligible <lens> [--config <path>] | lanes <waybill> <lens> | lenses | --self-test" >&2; exit 1; }

resolved() {  # resolved <lines|eligible> <config> [lens]
  [ -f "$2" ] || { echo "reviewers: no config at $2 (POSTMASTER_CONFIG overrides the path)" >&2; return 1; }
  FORMS=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/review-forms.sh
  python3 - "$2" "$LENSES" "$FORMS" "$1" "${3:-}" <<'PY'
import subprocess, sys, tomllib
path, lenses, forms, mode, selected = sys.argv[1], sys.argv[2].split(), sys.argv[3], sys.argv[4], sys.argv[5]
def has_form(harness):
    return subprocess.call([forms, "has", harness or ""], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
try:
    cfg = tomllib.load(open(path, "rb"))
except (OSError, tomllib.TOMLDecodeError) as e:
    print("reviewers: %s does not parse: %s" % (path, e), file=sys.stderr); sys.exit(1)
lanes = cfg.get("lanes") or {}
defined = set(lanes.keys())
team = cfg.get("team") or {}
faults = []
def lanes_of(value, where):
    if not isinstance(value, list) or not value or not all(isinstance(v, str) and v for v in value):
        faults.append("%s is not a list of lane names" % where); return []
    for lane in value:
        if lane not in defined:
            faults.append("%s names %s, which is not a lane in [lanes]" % (where, lane))
    return value
default = lanes_of(team.get("reviewers") or team.get("workhorses") or [], "[team] reviewers")
per_lens = team.get("lens_reviewers") or {}
if not isinstance(per_lens, dict):
    faults.append("[team.lens_reviewers] is not a table"); per_lens = {}
for lens in per_lens:
    if lens not in lenses:
        faults.append("[team.lens_reviewers] names %s, which is not a lens (one of: %s)" % (lens, ", ".join(lenses)))
own = {lens: lanes_of(per_lens[lens], "[team.lens_reviewers] %s" % lens) for lens in lenses if lens in per_lens}
if faults:
    for f in faults: print("reviewers: " + f, file=sys.stderr)
    sys.exit(2)
def configured(lens):
    return own.get(lens, default)
def eligible(lens):
    names = configured(lens)
    if lens != "bug":
        return names
    return [name for name in names if has_form((lanes.get(name) or {}).get("harness"))]
if mode == "lines":
    print("reviewers: " + ", ".join(default))
    for lens in lenses:
        if lens == "bug" or lens in own:
            print("%s reviewers: %s" % (lens, ", ".join(eligible(lens))))
elif mode == "eligible":
    if selected not in lenses:
        print("reviewers: %s is not a lens (one of: %s)" % (selected, ", ".join(lenses)), file=sys.stderr)
        sys.exit(2)
    names = eligible(selected)
    if not names:
        if selected == "bug":
            print("reviewers: no configured bug reviewer has a code-review form; the bug turnpike cannot run", file=sys.stderr)
        else:
            print("reviewers: %s has no configured reviewers" % selected, file=sys.stderr)
        sys.exit(2)
    print("\n".join(names))
PY
}

lines() { resolved lines "$1"; }
eligible() { resolved eligible "$2" "$1"; }

lanes() {  # lanes <waybill> <lens>
  [ -f "$1" ] || { echo "reviewers: no such waybill: $1" >&2; return 1; }
  case " $LENSES " in *" $2 "*) ;; *) echo "reviewers: $2 is not a lens (one of: $LENSES)" >&2; return 2 ;; esac
  python3 - "$1" "$2" <<'PY'
import re, sys
path, lens = sys.argv[1], sys.argv[2]
team, inside = [], False
for line in open(path, encoding="utf-8", errors="replace").read().splitlines():
    if re.match(r"^##\s", line):
        inside = re.match(r"^##\s+Team\s*$", line) is not None
        continue
    if inside:
        team.append(line)
def listed(prefix):
    for line in team:
        m = re.match(r"^\s*" + re.escape(prefix) + r"\s*:\s*(.*?)\s*$", line)
        if m:
            return [name.strip() for name in m.group(1).split(",") if name.strip()]
    return None
found = listed(lens + " reviewers")
if found is None:
    found = listed("reviewers")
if not found:
    print("reviewers: the Team section of %s has no reviewers line for %s" % (path, lens), file=sys.stderr)
    sys.exit(2)
print("\n".join(found))
PY
}

case ${1:-} in
  lines)
    [ $# -eq 1 ] || { [ $# -eq 3 ] && [ "$2" = --config ]; } || usage
    lines "${3:-$CONFIG}"; exit $? ;;
  eligible)
    [ $# -ge 2 ] || usage
    lens=$2; cfg=$CONFIG
    if [ $# -eq 4 ] && [ "$3" = --config ]; then cfg=$4
    elif [ $# -ne 2 ]; then usage; fi
    eligible "$lens" "$cfg"; exit $? ;;
  lanes) [ $# -eq 3 ] || usage; lanes "$2" "$3"; exit $? ;;
  lenses) [ $# -eq 1 ] || usage; printf '%s\n' $LENSES; exit 0 ;;
  --self-test) ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
lanes_block='[lanes.luna]
harness = "codex"
model = "m1"
[lanes.mimo]
harness = "mimo"
model = "m2"
[lanes.sentinel]
harness = "claude"
model = "m3"
[lanes.pi]
harness = "pi"
model = "m4"'
config() {  # config <name> <[team] body>: a config with four lanes, one per harness
  printf '%s\n\n[team]\n%s\n' "$lanes_block" "$2" > "$tmp/$1.toml"
}
waybill() {  # waybill <name> <reviewer lines>: a waybill whose Team section carries them
  { printf '# Waybill: 7\n\n## Ticket\n\nsecurity reviewers: luna\nreviewers: sentinel\n\n'
    printf '## Team\nworkhorses: luna=codex/m1/, mimo=mimo/m2/\n%s\ncoachman: muse/m4/\n\n' "$2"
    printf '## Dispatch\ndispatch: /tmp/x\n'; } > "$tmp/$1.md"
}
expect() {  # expect <label> <want exit> <want output, \n-joined> <command...>
  local label=$1 want_rc=$2 want_out=$3 out rc; shift 3
  out=$("$@" 2>"$tmp/err"); rc=$?
  if [ "$rc" -eq "$want_rc" ] && [ "$out" = "$(printf '%b' "$want_out")" ]; then ok "$label"
  else fail "$label: wanted exit $want_rc and \"$want_out\", got exit $rc" "$out$(cat "$tmp/err")"; fi
}

echo "positive controls"
config one 'workhorses = ["luna", "mimo"]
reviewers = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "mimo", "sentinel"]'
expect "the waybill lines name the reviewers, then each lens with its own lanes" 0 \
  'reviewers: luna, mimo\nbug reviewers: luna, mimo\nsecurity reviewers: luna, mimo, sentinel' lines "$tmp/one.toml"
waybill one "$(lines "$tmp/one.toml")"
expect "a lens with its own line gets exactly those lanes" 0 'luna\nmimo\nsentinel' lanes "$tmp/one.md" security
expect "the bug lens gets only configured reviewers with a review form" 0 'luna\nmimo' lanes "$tmp/one.md" bug
expect "the configured bug reviewers resolve to eligible lanes" 0 'luna\nmimo' "$0" eligible bug --config "$tmp/one.toml"
expect "and so does style" 0 'luna\nmimo' lanes "$tmp/one.md" style
config two 'workhorses = ["luna", "mimo"]
reviewers = ["sentinel"]'
expect "a config without the table keeps the reviewer line and adds eligible bug reviewers" 0 \
  'reviewers: sentinel\nbug reviewers: sentinel' lines "$tmp/two.toml"
config three 'workhorses = ["luna", "mimo"]'
expect "reviewers default to the workhorses, and bug reviewers are filtered" 0 \
  'reviewers: luna, mimo\nbug reviewers: luna, mimo' lines "$tmp/three.toml"
printf '[lanes.pi]\nharness = "pi"\nmodel = "p"\n\n[team]\nworkhorses = ["pi"]\nreviewers = ["pi"]\n' > "$tmp/no-review.toml"
expect "no eligible bug reviewer is a pre-flight refusal with its reason" 2 '' "$0" eligible bug --config "$tmp/no-review.toml"
grep -q 'no configured bug reviewer has a code-review form' "$tmp/err" \
  && ok "the refusal explains why the bug lens cannot run" || fail "the refusal explains why the bug lens cannot run" "$(cat "$tmp/err")"
config mixed 'workhorses = ["luna", "pi"]
reviewers = ["luna", "pi"]'
expect "a bug reviewer whose harness has no review form is left off the bug line" 0 \
  'reviewers: luna, pi\nbug reviewers: luna' lines "$tmp/mixed.toml"
expect "eligible agrees with review-forms.sh on the same config" 0 'luna' "$0" eligible bug --config "$tmp/mixed.toml"
expect "the lenses are the review stage's, in order" 0 'style\nbug\nsecurity' "$0" lenses

echo "negative controls"
config bad-lens 'workhorses = ["luna", "mimo"]
[team.lens_reviewers]
secruity = ["sentinel"]'
expect "a lens the review stage does not have is refused" 2 '' lines "$tmp/bad-lens.toml"
grep -q 'secruity, which is not a lens' "$tmp/err" && ok "and named" || fail "and named" "$(cat "$tmp/err")"
config bad-lane 'workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "nobody"]'
expect "a lane the config does not define is refused" 2 '' lines "$tmp/bad-lane.toml"
grep -q 'nobody, which is not a lane' "$tmp/err" && ok "and named" || fail "and named" "$(cat "$tmp/err")"
config empty 'workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = []'
expect "a lens with no lanes is refused" 2 '' lines "$tmp/empty.toml"
config bad-default 'workhorses = ["luna", "mimo"]
reviewers = ["ghost"]'
expect "a reviewer that is not a lane is refused" 2 '' lines "$tmp/bad-default.toml"
expect "no config is refused" 1 '' lines "$tmp/missing.toml"
expect "a waybill lens that is not a lens is refused" 2 '' lanes "$tmp/one.md" secruity
waybill no-team ''
expect "a Team section with no reviewers line is refused, never read as no reviewers" 2 '' lanes "$tmp/no-team.md" bug
expect "reviewer lines in the ticket's text are not read" 2 '' lanes "$tmp/no-team.md" security
{ printf '# Waybill: 7\n\n## Team\nreviewers: luna, mimo\nbug reviewers: \n'; } > "$tmp/empty-bug.md"
expect "an explicit empty bug reviewers line does not fall back to reviewers" 2 '' lanes "$tmp/empty-bug.md" bug
expect "no such waybill is refused" 1 '' lanes "$tmp/none.md" bug

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
