#!/usr/bin/env bash
# The turnpikes: the checks a run must pass through before it ships. The project's gate is not
# one of them; it runs on every run. This is the one place the turnpikes and the default set are
# defined. A ticket names its run's turnpikes in its `## Turnpikes` section, and
# scripts/ticket-check.sh, the postmaster and the coachman all read them from here.
#
#   turnpikes.sh --list                 every turnpike, one per line: its name, `default` or `-`,
#                                       the leg that runs it, and what it checks
#   turnpikes.sh resolve [<text>...]    a `## Turnpikes` section's text, as the turnpikes it
#                                       names; with no text given, the section is read from stdin
#   turnpikes.sh legs <dispatch> [--expect <line>]
#                                       a run's legs, from the waybill under its title; with
#                                       --expect, its `turnpikes:` line must be <line>
#   turnpikes.sh legs --line <line>     the legs a run with that `turnpikes:` line has
#   turnpikes.sh legs --names <line>    the `legs:` line that waybill carries for that line
#   turnpikes.sh short <line>           the default turnpikes a `turnpikes:` line leaves out
#   turnpikes.sh --self-test
#
# A section holds `default`, `none`, or turnpike names, separated by commas or spaces, and
# nothing else. `default` stands for every turnpike --list marks default, alone or in a list;
# `none` stands alone. Case, backticks, a list marker at the start of a line, a thematic break,
# a hard line break, invisible characters and a closing full stop are ignored; every other
# token, a lone dash or dots among them, is a word, and a word that is not a turnpike is named.
# resolve prints the line the waybill carries: `turnpikes: ` and the names, in the order --list
# gives them, or `turnpikes: none`.
#
# legs prints one line per leg the run has, in order: its number, its name, and the turnpikes it
# runs. A run is at most two legs, synthesis (1) and review (2). Synthesis always runs. Review
# runs only when the waybill names a turnpike that runs in it, so a run with none is one leg and
# its synthesis leg ends with the ship card. The waybill holds two lines between its title and
# its first `##` heading, above the ticket, so nothing the ticket holds is ever read for them:
# the one `turnpikes:` line (the names resolve printed, or `none`, never `default`) and the one
# `legs:` line (`legs: synthesis` or `legs: synthesis review`) that `legs --names` prints and
# the postmaster writes at dispatch. A waybill with no `legs:` line was dispatched before this
# change and keeps its three legs, synthesis, review and ship, with ship numbered 3 even when
# review is absent. A waybill with no `turnpikes:` line is refused, never read as `none`.
#
# A turnpike is added as one line of the table below, and to the runbook step that runs it.
# Every command checks the table first: each name a lowercase word, neither `default` nor
# `none`, listed once; `default` or `-`; a leg that exists; and words saying what it checks.
#
#   exit 0  printed
#   exit 1  usage, no waybill, or a table that breaks its rules
#   exit 2  resolve: the text is not a turnpikes section; legs and short: the line is missing,
#           is not names or none, is not the one --expect gives, or a `legs:` line that does
#           not fit the turnpikes. One line per fault, on stdout.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
usage() { echo "usage: turnpikes.sh --list | resolve [<text>...] | legs <dispatch> [--expect <line>] | legs --line <line> | legs --names <line> | short <line> | --self-test" >&2; exit 1; }

# Both bodies are read with `read`, not `$(cat ...)`, so that a shell as old as bash 3.2 parses
# this file: it reads a here-document inside `$( )` as ordinary text, quotes and backticks included.
IFS= read -r -d '' TABLE <<'TURNPIKES' || true
# name     set      leg     what it checks
style      default  review  idiom, naming, abstraction and consistency with the project's own conventions
bug        default  review  correctness, logic, and whether the tests are adequate
security   default  review  exploit paths through the project's risk surfaces
TURNPIKES

IFS= read -r -d '' CORE <<'PY' || true
import re, sys, unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
table, cmd, args = sys.argv[1], sys.argv[2], sys.argv[3:]
# A run is at most two legs. A waybill with no `legs:` line was dispatched before this change
# and keeps three, with ship numbered 3 even when review is absent.
LEGS = [(1, "synthesis"), (2, "review")]
ALWAYS = {"synthesis"}
LEGACY_LEGS = [(1, "synthesis"), (2, "review"), (3, "ship")]
LEGACY_ALWAYS = {"synthesis", "ship"}
NAMES = {"synthesis", "review"}
RESERVED = ("default", "none")
BREAK = re.compile(r" {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*")
MARKER = re.compile(r"[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)")
LINE = re.compile(r"[ \t]*turnpikes[ \t]*:")
LEGS_LINE = re.compile(r"[ \t]*legs[ \t]*:")

rows, faults = [], []
for n, line in enumerate(table.split("\n"), 1):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    f = line.split(None, 3)
    if len(f) < 4 or not re.search(r"[^\W_]", f[3]):
        faults.append("line %d needs a name, default or -, a leg, and what it checks" % n)
        continue
    name, mark, leg, what = f
    if not re.fullmatch(r"[a-z][a-z0-9-]*", name):
        faults.append('line %d: "%s" is not a lowercase word' % (n, name))
    elif name in RESERVED:
        faults.append('line %d: "%s" already means something in a ticket, so no turnpike is named it' % (n, name))
    elif name in [r[0] for r in rows]:
        faults.append('line %d: "%s" is listed twice' % (n, name))
    if mark not in ("default", "-"):
        faults.append('line %d: "%s" is neither default nor -' % (n, mark))
    if leg not in [l for _, l in LEGS]:
        faults.append('line %d: "%s" is not a leg; the legs are %s' % (n, leg, ", ".join(l for _, l in LEGS)))
    rows.append((name, mark == "default", leg, what.strip()))
if faults:
    print("\n".join("turnpikes: the table's " + f for f in faults), file=sys.stderr)
    sys.exit(1)
names = [r[0] for r in rows]
defaults = [r[0] for r in rows if r[1]]
leg_of = {r[0]: r[2] for r in rows}

def words_of(text):
    words = []
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")   # invisible format characters
    for line in text.split("\n"):
        line = re.sub(r"\\+$", "", line.rstrip("\r"))                        # a hard line break
        if BREAK.fullmatch(line):
            continue
        m = MARKER.match(line)                                               # a list marker opens a line
        if m:
            line = line[m.end():]
        for tok in re.split(r"[\s,;]+", line):
            if tok:
                words.append(tok.strip("`*_").rstrip(".").strip("`*_").lower() or tok)
    return words

def resolve(text):  # (names in table order, []) or (None, [fault, ...])
    words = words_of(text)
    holds = "the section holds only default, none, or names from: %s" % (", ".join(names) or "(no turnpikes)")
    if not words:
        return None, ["names no turnpike; " + holds]
    out = []
    unknown = ['"%s"' % w for w in dict.fromkeys(words) if w not in names and w not in RESERVED]
    if unknown:
        which = unknown[0] if len(unknown) == 1 else ", ".join(unknown[:-1]) + " and " + unknown[-1]
        out.append("%s %s; %s" % (which, "is not a turnpike" if len(unknown) == 1 else "are not turnpikes", holds))
    if "none" in words and len(set(words)) > 1:
        out.append("none stands alone, and is not listed with other turnpikes")
    if out:
        return None, out
    chosen = set(words) | (set(defaults) if "default" in words else set())
    return [n for n in names if n in chosen], []

def named(line):  # a waybill's turnpikes: line, as the names it holds; exit 2 unless names or none
    if "\n" in line or not LINE.match(line):
        print('"%s" is not a turnpikes: line' % line.replace("\n", "\\n")); sys.exit(2)
    value = LINE.sub("", line, count=1)
    if "default" in words_of(value):
        print("the waybill's turnpikes line says default; it carries the names ticket-check.sh printed for the ticket")
        sys.exit(2)
    got, out = resolve(value)
    if out:
        print("\n".join("the waybill's turnpikes: " + o for o in out)); sys.exit(2)
    return got

def legs_of_names(spec, got):
    """spec is a legs: line's names; print each with the turnpikes that run in it."""
    want = words_of(LEGS_LINE.sub("", spec, count=1))
    out = []
    if not want or any(w not in NAMES for w in want):
        out.append('"%s" is not a legs: line of %s' % (spec.replace("\n", "\\n"), " and ".join(sorted(NAMES))))
    if len(want) != len(set(want)):
        out.append("a leg is listed twice")
    if want and want != [n for n in ("synthesis", "review") if n in want]:
        out.append("the legs are listed out of order; synthesis comes first")
    if "synthesis" not in want:
        out.append("synthesis is missing; every run starts with it")
    for x in got:
        if leg_of[x] not in want:
            out.append('%s runs in %s, and the legs: line lists no %s leg' % (x, leg_of[x], leg_of[x]))
    if "review" in want and not any(leg_of[x] == "review" for x in got):
        out.append("review is listed, and no turnpike runs in it")
    if out:
        return None, out
    return [(i, leg) for i, leg in enumerate(want, 1)], []

def print_legs(pairs, got):
    for n, leg in pairs:
        runs = [x for x in got if leg_of[x] == leg]
        print(" ".join([str(n), leg] + runs))

def legs_current(got):
    pairs = [(n, leg) for n, leg in LEGS if leg in ALWAYS or any(leg_of[x] == leg for x in got)]
    print_legs(pairs, got)

def legs_legacy(got):
    pairs = [(n, leg) for n, leg in LEGACY_LEGS if leg in LEGACY_ALWAYS or any(leg_of[x] == leg for x in got)]
    print_legs(pairs, got)

def waybill_legs(path):
    """(turnpike names, legs-pairs or None for legacy, faults)."""
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    above = []                                  # the lines above the waybill's first ## heading
    for l in lines:
        if l.startswith("## "):
            break
        above.append(l.rstrip("\r"))
    found = [l for l in above if LINE.match(l)]
    if len(found) != 1:
        print("the waybill has %s turnpikes: line%s under its title, above the ticket, and one is needed; none is never assumed"
              % (len(found) or "no", "" if len(found) == 1 else "s")); sys.exit(2)
    got = named(found[0])
    legs_lines = [l for l in above if LEGS_LINE.match(l)]
    if not legs_lines:
        return found[0], got, None               # dispatched before this change: three legs
    if len(legs_lines) > 1:
        print("the waybill has %d legs: lines under its title, and one is needed" % len(legs_lines)); sys.exit(2)
    pairs, out = legs_of_names(legs_lines[0], got)
    if out:
        print("\n".join("the waybill's legs: " + o for o in out)); sys.exit(2)
    return found[0], got, pairs

if cmd == "list":
    for name, d, leg, what in rows:
        print("%-10s %-8s %-9s %s" % (name, "default" if d else "-", leg, what))
elif cmd == "resolve":
    got, out = resolve(" ".join(args) if args else sys.stdin.buffer.read().decode("utf-8", "replace"))
    if out:
        print("\n".join(out)); sys.exit(2)
    print("turnpikes: " + (", ".join(got) or "none"))
elif cmd == "short":
    got = named(args[0])
    for n in defaults:
        if n not in got:
            print(n)
elif cmd == "legs" and args[0] == "--names":
    got = named(args[1])
    pairs, out = legs_of_names("legs: " + " ".join(leg for _, leg in LEGS if leg in ALWAYS or any(leg_of[x] == leg for x in got)), got)
    if out:
        print("\n".join(out)); sys.exit(2)
    print("legs: " + " ".join(leg for _, leg in pairs))
elif cmd == "legs" and args[0] == "--line":
    legs_current(named(args[1]))
elif cmd == "legs":
    try:
        text, got, pairs = waybill_legs(args[0])
    except OSError as e:
        print("turnpikes: cannot read %s: %s" % (args[0], e.strerror), file=sys.stderr); sys.exit(1)
    if len(args) == 2 and " ".join(text.split()) != " ".join(args[1].split()):
        print('the waybill says "%s", and the ticket\'s check printed "%s"' % (text.strip(), args[1].strip()))
        sys.exit(2)
    if pairs is None:
        legs_legacy(got)
    else:
        print_legs(pairs, got)
PY
core() { python3 -c "$CORE" "$@"; }  # core <table> list | resolve [<text>...] | short <line> | legs <waybill> [<expect>] | legs --line <line> | legs --names <line>

case ${1:-} in
  --list) [ $# -eq 1 ] || usage; core "$TABLE" list; exit $? ;;
  resolve) shift; core "$TABLE" resolve "$@"; exit $? ;;
  short) [ $# -eq 2 ] || usage; core "$TABLE" short "$2"; exit $? ;;
  legs) if [ "${2:-}" = --line ]; then [ $# -eq 3 ] || usage; core "$TABLE" legs --line "$3"; exit $?; fi
        if [ "${2:-}" = --names ]; then [ $# -eq 3 ] || usage; core "$TABLE" legs --names "$3"; exit $?; fi
        [ $# -eq 2 ] || { [ $# -eq 4 ] && [ "$3" = --expect ]; } || usage
        [ -f "$2/brief.md" ] || { echo "turnpikes: no waybill at $2/brief.md" >&2; exit 1; }
        if [ $# -eq 4 ]; then core "$TABLE" legs "$2/brief.md" "$4"; else core "$TABLE" legs "$2/brief.md"; fi; exit $? ;;
  --self-test) [ $# -eq 1 ] || usage ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
self=$HERE/$(basename "$0")
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
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
waybill() {  # waybill <dispatch> <the lines under the title, or nothing> [<a line in the ticket's notes>]
  mkdir -p "$1"
  { printf '# Waybill: T-1\n'; [ -n "$2" ] && printf '%s\n' "$2"
    printf '\n## Ticket\n## Problem / feature\nA change.\n\n## Turnpikes\ndefault\n\n## Notes\n%s\n\n' "${3:-}"
    printf '## Project profile\nrepo: /r\n\n## Dispatch\nname: #1, A change\ndispatch: %s\ntool: /t\n' "$1"; } > "$1/brief.md"
}
lines() { printf '%s\n' "$@"; }
# A name the table does not have, so that a turnpike added to it later breaks no control here.
NOPE=zz-not-listed
"$self" --list | awk '{print $1}' | grep -qx "$NOPE" && { echo "self-test: $NOPE is in the table; pick another unused name"; exit 1; }
PLUS=$(printf '%s\n%s' "$TABLE" "$NOPE  -        synthesis    a check the table does not have yet")

echo "positive controls: the list"
run "$self" --list
[ $rc -eq 0 ] && for n in style bug security; do [ "$(printf '%s\n' "$out" | awk -v n=$n '$1 == n' | wc -l)" -eq 1 ] || rc=9; done
[ $rc -eq 0 ] && ok "--list names style, bug and security, once each" || fail "--list names style, bug and security, once each" "$out"
[ "$(printf '%s\n' "$out" | awk '$2 == "default" {print $1}' | paste -sd' ' -)" = "style bug security" ] \
  && ok "the default set is style, bug and security" || fail "the default set is style, bug and security" "$out"
[ "$(printf '%s\n' "$out" | awk '$1 ~ /^(style|bug|security)$/ {print $3}' | sort -u)" = review ] \
  && ok "the three run in the review leg" || fail "the three run in the review leg" "$out"

echo "positive controls: a ticket's section"
run "$self" resolve default;            is "default stands for the default set" 0 "turnpikes: style, bug, security"
run "$self" resolve none;               is "none stands for no turnpike" 0 "turnpikes: none"
run "$self" resolve "security, bug";    is "a list names its turnpikes, in the table's order" 0 "turnpikes: bug, security"
run "$self" resolve "default, bug";     is "in a list, default still stands for the three" 0 "turnpikes: style, bug, security"
run "$self" resolve "$(lines '- Bug' '- `security`.')"
is "case, backticks, list markers and a closing full stop are ignored" 0 "turnpikes: bug, security"
run "$self" resolve "$(lines 'default' '' '---' '' '***')"
is "a thematic break is not a name" 0 "turnpikes: style, bug, security"
run "$self" resolve "$(printf 'bug\\\nsecurity')"
is "a hard line break is not part of a name" 0 "turnpikes: bug, security"
run "$self" resolve "$(printf 'default\342\200\213')"
is "an invisible character is not part of a name" 0 "turnpikes: style, bug, security"
out=$(lines '1. bug' '2. security' | "$self" resolve 2>&1); rc=$?
is "with no text given, the section is read from stdin" 0 "turnpikes: bug, security"
run "$self" resolve "bug, security"; line=$out; run "$self" resolve "${line#turnpikes: }"
is "the waybill's line resolves to itself" 0 "$line"
run core "$PLUS" resolve "default, $NOPE"
is "a turnpike added to the table resolves with nothing else changed" 0 "turnpikes: style, bug, security, $NOPE"

echo "positive controls: a two-leg run"
run "$self" legs --line "turnpikes: none";      is "no turnpike is one leg, synthesis" 0 "1 synthesis"
run "$self" legs --line "turnpikes: security";  is "a review turnpike is two legs" 0 "$(lines '1 synthesis' '2 review security')"
run "$self" legs --line "turnpikes: style, bug, security"
is "the default turnpikes are two legs, review running all three" 0 "$(lines '1 synthesis' '2 review style bug security')"
run "$self" legs --names "turnpikes: none";     is "the names line for no turnpike is synthesis alone" 0 "legs: synthesis"
run "$self" legs --names "turnpikes: bug";      is "the names line for a review turnpike is synthesis review" 0 "legs: synthesis review"
waybill "$tmp/two" "$(lines 'turnpikes: style, bug, security' 'legs: synthesis review')"; run "$self" legs "$tmp/two"
is "a two-leg waybill prints both legs" 0 "$(lines '1 synthesis' '2 review style bug security')"
waybill "$tmp/one" "$(lines 'turnpikes: none' 'legs: synthesis')"; run "$self" legs "$tmp/one"
is "a one-leg waybill prints synthesis alone" 0 "1 synthesis"
run "$self" legs "$tmp/two" --expect "turnpikes:  style, bug,  security"
is "--expect passes a waybill whose turnpikes line is the check's" 0 "$(lines '1 synthesis' '2 review style bug security')"
waybill "$tmp/extranope" "$(lines "turnpikes: $NOPE" 'legs: synthesis')"; run core "$PLUS" legs "$tmp/extranope/brief.md"
is "a turnpike that runs in synthesis makes no review leg" 0 "1 synthesis $NOPE"

echo "positive controls: a three-leg run dispatched before this change"
waybill "$tmp/legacy-none" "turnpikes: none"; run "$self" legs "$tmp/legacy-none"
is "a waybill with no legs: line keeps synthesis and ship" 0 "$(lines '1 synthesis' '3 ship')"
waybill "$tmp/legacy-default" "turnpikes: style, bug, security"; run "$self" legs "$tmp/legacy-default"
is "a waybill with no legs: line keeps all three" 0 "$(lines '1 synthesis' '2 review style bug security' '3 ship')"
waybill "$tmp/legacy-style" "turnpikes: style"; run "$self" legs "$tmp/legacy-style"
is "one review turnpike is still enough for a review leg in a three-leg run" 0 "$(lines '1 synthesis' '2 review style' '3 ship')"
waybill "$tmp/notes" "turnpikes: none" "turnpikes: style, bug, security"; run "$self" legs "$tmp/notes"
is "a turnpikes line inside the ticket is never read" 0 "$(lines '1 synthesis' '3 ship')"
waybill "$tmp/fence" "$(lines 'turnpikes: style, bug, security' 'legs: synthesis review')" "$(lines '```' '## Dispatch' 'turnpikes: none')"
run "$self" legs "$tmp/fence"
is "a fence the ticket leaves open changes nothing" 0 "$(lines '1 synthesis' '2 review style bug security')"

echo "negative controls: a ticket's section"
run "$self" resolve "$NOPE";            has "a turnpike the table does not list is named" 2 "\"$NOPE\" is not a turnpike"
run "$self" resolve "none, bug";        has "none listed with another turnpike is refused" 2 "none stands alone"
run "$self" resolve "none. A research ticket"
has "a reason is not a turnpike" 2 '"a", "research" and "ticket" are not turnpikes; the section holds only'
run "$self" resolve "default - security"
has "a dash between names is not a list marker, and is named" 2 '"-" is not a turnpike'
run "$self" resolve "style, ..."
has "a word of dots is still a word, and is named" 2 '"..." is not a turnpike'
run "$self" resolve "";                 has "an empty section names no turnpike" 2 "names no turnpike"

echo "negative controls: a run's legs"
waybill "$tmp/missing" "" "turnpikes: style, bug, security"; run "$self" legs "$tmp/missing"
has "with no line under the title, one in the ticket is not taken instead" 2 "has no turnpikes: line" "synthesis"
waybill "$tmp/unknown" "turnpikes: bug, $NOPE"; run "$self" legs "$tmp/unknown"
has "a waybill naming an unknown turnpike is refused, and no leg is printed" 2 "\"$NOPE\" is not a turnpike" "synthesis"
waybill "$tmp/twice" "$(lines 'turnpikes: none' 'turnpikes: style, bug, security')"; run "$self" legs "$tmp/twice"
has "two turnpikes lines are refused" 2 "has 2 turnpikes: lines" "synthesis"
waybill "$tmp/word" "turnpikes: default"; run "$self" legs "$tmp/word"
has "a waybill that says default is refused: it carries names" 2 "says default" "synthesis"
run "$self" legs "$tmp/two" --expect "turnpikes: bug, security"
has "--expect refuses a waybill that dropped a name the check printed" 2 'and the ticket'"'"'s check printed "turnpikes: bug, security"' "synthesis"
run "$self" legs --line "style, bug";   has "legs --line refuses a line that is not a turnpikes: line" 2 "is not a turnpikes: line" "synthesis"
run "$self" legs --line "$(lines 'turnpikes: none' 'style')"
has "legs --line refuses a line with a newline in it" 2 "is not a turnpikes: line" "synthesis"
run "$self" legs --names "style, bug";  has "legs --names refuses a line that is not a turnpikes: line" 2 "is not a turnpikes: line"
waybill "$tmp/badlegs" "$(lines 'turnpikes: style' 'legs: synthesis')"; run "$self" legs "$tmp/badlegs"
has "a review turnpike with no review leg is refused" 2 "style runs in review, and the legs: line lists no review leg" "1 synthesis"
waybill "$tmp/noleg" "$(lines 'turnpikes: style' 'legs: review')"; run "$self" legs "$tmp/noleg"
has "synthesis is never left out of a legs: line" 2 "synthesis is missing" "1 review"
waybill "$tmp/order" "$(lines 'turnpikes: style' 'legs: review synthesis')"; run "$self" legs "$tmp/order"
has "the legs: line lists synthesis first" 2 "listed out of order" "1 review"
waybill "$tmp/dup" "$(lines 'turnpikes: none' 'legs: synthesis synthesis')"; run "$self" legs "$tmp/dup"
has "a legs: line does not list a leg twice" 2 "listed twice"
waybill "$tmp/noreview" "$(lines 'turnpikes: none' 'legs: synthesis review')"; run "$self" legs "$tmp/noreview"
has "review is not listed when no turnpike runs in it" 2 "review is listed, and no turnpike runs in it"
waybill "$tmp/shipname" "$(lines 'turnpikes: none' 'legs: synthesis ship')"; run "$self" legs "$tmp/shipname"
has "ship is not a leg a waybill may name" 2 "is not a legs: line of review and synthesis"
waybill "$tmp/twolegs" "$(lines 'turnpikes: none' 'legs: synthesis' 'legs: synthesis review')"; run "$self" legs "$tmp/twolegs"
has "two legs: lines are refused" 2 "has 2 legs: lines" "synthesis"
run "$self" short "turnpikes: default"; has "short refuses default: a line carries names" 2 "says default"
run "$self" legs "$tmp/nowhere";        has "no waybill is a usage error" 1 "no waybill at"

echo "negative controls: the table"
bad() {  # bad <label> <a line added to the table> <text the refusal must carry>
  run core "$(printf '%s\n%s' "$TABLE" "$2")" list; has "$1" 1 "$3" "style"
}
bad "a turnpike named none is refused"       "none       -        review  nothing"       '"none" already means something in a ticket'
bad "a turnpike named default is refused"    "default    -        review  everything"    '"default" already means something in a ticket'
bad "a turnpike listed twice is refused"     "bug        -        review  bugs again"    '"bug" is listed twice'
bad "a leg that does not exist is refused"   "$NOPE      -        deploy  a check"       '"deploy" is not a leg'
bad "the ship leg is no longer a home"       "$NOPE      -        ship    a check"       '"ship" is not a leg'
bad "a set other than default or - is refused" "$NOPE    yes      review  a check"       '"yes" is neither default nor -'
bad "a name that is not a lowercase word is refused" "Zz-Not  -       review    a check"   '"Zz-Not" is not a lowercase word'
bad "a line with no description is refused"  "$NOPE      -        review"                  "needs a name, default or -, a leg, and what it checks"

echo "controls: a one-leg run, walked from synthesis to the card through the poll, the hand-off check and the stages"
d=$tmp/runs/proj/one; waybill "$d" "$(lines 'turnpikes: none' 'legs: synthesis')"; : > "$d/run-log.md"
printf '{"stage": "shipping", "leg": 1, "base": "abc123", "lanes": {}, "coachman": {"legs": {}}}\n' > "$d/manifest.json"
"$HERE/log-action.sh" "$d" postmaster dispatch one "leg 1" >/dev/null
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-1.md"
touch "$d/.leg-1-done" "$d/.leg-1-exited" "$d/.card-ready"
poll() { "$HERE/runs-status.sh" "$tmp/runs/proj" | awk -v r="$1" '$1 == r {print $NF}'; }
[ "$(poll one)" = GATE ] && ok "a one-leg run's card is GATE" || fail "a one-leg run's card is GATE" "$(poll one)"
[ "$("$self" legs "$d")" = "1 synthesis" ] && ok "a one-leg run has no second leg" || fail "a one-leg run has no second leg" "$("$self" legs "$d")"
"$HERE/stage.sh" "$d" shipped postmaster >/dev/null && "$HERE/stage.sh" "$d" done postmaster >/dev/null
[ "$(poll one)" = - ] && ok "a one-leg run closes at done" || fail "a one-leg run closes at done" "$(poll one)"
stages=$(python3 -c 'import json, sys; print(" ".join(json.loads(l)["target"] for l in open(sys.argv[1]) if json.loads(l)["action"] == "stage"))' "$d/actions.jsonl")
[ "$stages" = "shipped done" ] && ok "a one-leg run's stages after the card are the postmaster's" \
  || fail "a one-leg run's stages after the card are the postmaster's" "$stages"

echo "controls: a two-leg run, walked from synthesis through review to the card"
d=$tmp/runs/proj/two; waybill "$d" "$(lines 'turnpikes: style, bug, security' 'legs: synthesis review')"; : > "$d/run-log.md"
printf '{"stage": "checkpoint-1", "leg": 1, "base": "abc123", "lanes": {}, "coachman": {"legs": {}}}\n' > "$d/manifest.json"
"$HERE/log-action.sh" "$d" postmaster dispatch two "leg 1" >/dev/null
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-1.md"
touch "$d/.leg-1-done" "$d/.leg-1-exited"
[ "$(poll two)" = DISPATCH ] && ok "after synthesis the poll says DISPATCH" || fail "after synthesis the poll says DISPATCH" "$(poll two)"
next=$("$self" legs "$d" | awk '$1 > 1 {print $1 " " $2; exit}')
[ "$next" = "2 review" ] && ok "the leg after synthesis is review" || fail "the leg after synthesis is review" "$next"
prev=$("$self" legs "$d" | awk '$1 < 2 {p = $1} END {print p}')
"$HERE/handoff-check.sh" "$d/handoff-$prev.md" >/dev/null 2>&1 && [ "$prev" = 1 ] \
  && ok "the review leg starts from synthesis's hand-off, which passes its check" || fail "the review leg starts from synthesis's hand-off, which passes its check" "handoff-$prev.md"
python3 -c 'import json, sys; p = sys.argv[1]; m = json.load(open(p)); m["leg"] = 2; open(p, "w").write(json.dumps(m))' "$d/manifest.json"
"$HERE/stage.sh" "$d" review >/dev/null && "$HERE/stage.sh" "$d" shipping >/dev/null
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-2.md"
touch "$d/.leg-2-done" "$d/.leg-2-exited" "$d/.card-ready"
after=$("$self" legs "$d" | awk '$1 > 2')
[ "$(poll two)" = GATE ] && [ -z "$after" ] && ok "the review leg ends with the card, and no leg follows" \
  || fail "the review leg ends with the card, and no leg follows" "$(poll two) / $after"
"$HERE/stage.sh" "$d" shipped postmaster >/dev/null && "$HERE/stage.sh" "$d" done postmaster >/dev/null
stages=$(python3 -c 'import json, sys; print(" ".join(json.loads(l)["target"] for l in open(sys.argv[1]) if json.loads(l)["action"] == "stage"))' "$d/actions.jsonl")
[ "$stages" = "review shipping shipped done" ] && [ "$(poll two)" = - ] \
  && ok "it closes through the postmaster's stages" || fail "it closes through the postmaster's stages" "$stages"

echo "controls: a three-leg run dispatched before this change, walked from synthesis to ship"
d=$tmp/runs/proj/old; waybill "$d" "turnpikes: none"; : > "$d/run-log.md"
printf '{"stage": "checkpoint-1", "leg": 1, "base": "abc123", "lanes": {}, "coachman": {"legs": {}}}\n' > "$d/manifest.json"
"$HERE/log-action.sh" "$d" postmaster dispatch old "leg 1" >/dev/null
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-1.md"
touch "$d/.leg-1-done" "$d/.leg-1-exited"
[ "$(poll old)" = DISPATCH ] && ok "after synthesis the poll says DISPATCH" || fail "after synthesis the poll says DISPATCH" "$(poll old)"
next=$("$self" legs "$d" | awk '$1 > 1 {print $1 " " $2; exit}')
[ "$next" = "3 ship" ] && ok "the leg after synthesis is ship" || fail "the leg after synthesis is ship" "$next"
prev=$("$self" legs "$d" | awk '$1 < 3 {p = $1} END {print p}')
"$HERE/handoff-check.sh" "$d/handoff-$prev.md" >/dev/null 2>&1 && [ "$prev" = 1 ] \
  && ok "the ship leg starts from synthesis's hand-off, which passes its check" || fail "the ship leg starts from synthesis's hand-off, which passes its check" "handoff-$prev.md"
python3 -c 'import json, sys; p = sys.argv[1]; m = json.load(open(p)); m["leg"] = 3; open(p, "w").write(json.dumps(m))' "$d/manifest.json"
"$HERE/stage.sh" "$d" shipping >/dev/null
printf '## %s\nx\n' Decisions "Deferred findings" "Verified by execution" Unverified "Branches and lanes" "Open questions" "Next leg" > "$d/handoff-3.md"
touch "$d/.leg-3-done" "$d/.leg-3-exited" "$d/.card-ready"
after=$("$self" legs "$d" | awk '$1 > 3')
[ "$(poll old)" = GATE ] && [ -z "$after" ] && ok "after ship the card is GATE, and no leg follows" \
  || fail "after ship the card is GATE, and no leg follows" "$(poll old) / $after"
"$HERE/stage.sh" "$d" shipped >/dev/null && "$HERE/stage.sh" "$d" done postmaster >/dev/null
stages=$(python3 -c 'import json, sys; print(" ".join(json.loads(l)["target"] for l in open(sys.argv[1]) if json.loads(l)["action"] == "stage"))' "$d/actions.jsonl")
[ "$stages" = "shipping shipped done" ] && [ "$(poll old)" = - ] \
  && ok "a three-leg run keeps its stages" || fail "a three-leg run keeps its stages" "$stages"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
