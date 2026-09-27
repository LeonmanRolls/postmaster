#!/usr/bin/env bash
# Which lanes review under each lens. A lens is reviewed by the lanes the config names for it in
# [team.lens_reviewers], or, where it names none, by [team] reviewers, which default to the
# workhorses. The postmaster writes the result into the waybill's Team section, and the coachman
# reads it back from there, so a run keeps the reviewers it was dispatched with.
#
#   reviewers.sh lines [--config <path>]   the waybill's reviewer lines, from the config
#   reviewers.sh lanes <waybill> <lens>    the lanes for one lens, one per line, from a waybill
#   reviewers.sh lenses                    the lenses, in the order the review stage runs them
#   reviewers.sh --self-test
#
# `lines` prints `reviewers: <lane>, <lane>`, then `<lens> reviewers: <lane>, …` for each lens the
# config gives its own lanes. `lanes` reads only the waybill's `## Team` section: the lens's own
# line where it has one, the `reviewers:` line otherwise. The lenses are the entries of the review
# stage in skills/postmaster/coachman.md, and change with it.
#
#   exit 0  printed
#   exit 1  usage, no config or one that does not parse, or no such waybill
#   exit 2  a lens the review stage does not have, a lane the config does not define, a lens with
#           no lanes, or a waybill whose Team section has no reviewers line
set -uo pipefail
LENSES="style bug security"
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
usage() { echo "usage: reviewers.sh lines [--config <path>] | lanes <waybill> <lens> | lenses | --self-test" >&2; exit 1; }

lines() {  # lines <config>
  [ -f "$1" ] || { echo "reviewers: no config at $1 (POSTMASTER_CONFIG overrides the path)" >&2; return 1; }
  python3 - "$1" "$LENSES" <<'PY'
import sys, tomllib
path, lenses = sys.argv[1], sys.argv[2].split()
try:
    cfg = tomllib.load(open(path, "rb"))
except (OSError, tomllib.TOMLDecodeError) as e:
    print("reviewers: %s does not parse: %s" % (path, e), file=sys.stderr); sys.exit(1)
defined = set((cfg.get("lanes") or {}).keys())
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
print("reviewers: " + ", ".join(default))
for lens, names in own.items():
    print("%s reviewers: %s" % (lens, ", ".join(names)))
PY
}

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
model = "m3"'
config() {  # config <name> <[team] body>: a config with three lanes
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
  'reviewers: luna, mimo\nsecurity reviewers: luna, mimo, sentinel' lines "$tmp/one.toml"
waybill one "$(lines "$tmp/one.toml")"
expect "a lens with its own line gets exactly those lanes" 0 'luna\nmimo\nsentinel' lanes "$tmp/one.md" security
expect "a lens without one gets the reviewer list" 0 'luna\nmimo' lanes "$tmp/one.md" bug
expect "and so does style" 0 'luna\nmimo' lanes "$tmp/one.md" style
config two 'workhorses = ["luna", "mimo"]
reviewers = ["sentinel"]'
expect "a config without the table gives the reviewers line alone, as before" 0 'reviewers: sentinel' lines "$tmp/two.toml"
config three 'workhorses = ["luna", "mimo"]'
expect "reviewers default to the workhorses" 0 'reviewers: luna, mimo' lines "$tmp/three.toml"
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
expect "no config is refused" 1 '' lines "$tmp/none.toml"
expect "a waybill lens that is not a lens is refused" 2 '' lanes "$tmp/one.md" secruity
waybill no-team ''
expect "a Team section with no reviewers line is refused, never read as no reviewers" 2 '' lanes "$tmp/no-team.md" bug
expect "reviewer lines in the ticket's text are not read" 2 '' lanes "$tmp/no-team.md" security
expect "no such waybill is refused" 1 '' lanes "$tmp/none.md" bug

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
