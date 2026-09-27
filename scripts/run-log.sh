#!/usr/bin/env bash
# Append to a run's narrative, run-log.md, with the time on every entry. This is the one way the
# narrative is written, so a reader can see when each thing happened and how long each part of
# the work took.
#
#   run-log.sh <dispatch> <text...>            one entry:  - 12:35:07Z <text>
#   run-log.sh <dispatch> --section <title>    close the open section, start a new one
#   run-log.sh <dispatch> --close              close the open section; nothing if none is open
#   run-log.sh --self-test
#
# A section starts with a heading carrying its start time, and ends with a line saying how long
# it took, written when the next section starts or when --close is called. The narrative is for
# reading; what a run is audited from is actions.jsonl.
#
#   exit 0  written
#   exit 1  usage, or no such dispatch directory
set -uo pipefail

now() { printf '%s' "${RUN_LOG_NOW:-$(date -u '+%Y-%m-%d %H:%M:%S')}"; }   # RUN_LOG_NOW: tests only

close_open() {  # close_open <log> <now>; writes the open section's duration, if any
  python3 - "$1" "$2" <<'PY'
import datetime as dt, re, sys
path, now = sys.argv[1], dt.datetime.strptime(sys.argv[2], "%Y-%m-%d %H:%M:%S")
try:
    lines = open(path).read().splitlines()
except FileNotFoundError:
    sys.exit(0)
head = re.compile(r"^## (.+) \((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC\)$")
found = [(i, head.match(l)) for i, l in enumerate(lines) if head.match(l)]
if not found:
    sys.exit(0)                                   # no section has been started
i, m = found[-1]
title, start = m.group(1), dt.datetime.strptime(m.group(2), "%Y-%m-%d %H:%M:%S")
closed = "section %s took " % title
if any(l.startswith("- ") and closed in l for l in lines[i + 1:]):
    sys.exit(0)                                   # already closed
sec = max(0, int((now - start).total_seconds()))
h, rem = divmod(sec, 3600); m_, s = divmod(rem, 60)
took = "%dh %02dm" % (h, m_) if h else ("%dm %02ds" % (m_, s) if m_ else "%ds" % s)
with open(path, "a") as f:
    f.write("- %sZ %s%s\n" % (now.strftime("%H:%M:%S"), closed, took))
PY
}

write() {  # write <dispatch> <args...>
  local d=$1; shift
  [ -d "$d" ] || { echo "run-log: no such dispatch directory: $d" >&2; return 1; }
  local log="$d/run-log.md" t; t=$(now)
  case ${1:-} in
    --section)
      [ -n "${2:-}" ] || { echo "usage: run-log.sh <dispatch> --section <title>" >&2; return 1; }
      close_open "$log" "$t"
      printf '\n## %s (%s UTC)\n\n' "$2" "$t" >> "$log" ;;
    --close)
      close_open "$log" "$t" ;;
    "")
      echo "usage: run-log.sh <dispatch> <text...> | --section <title> | --close" >&2; return 1 ;;
    *)
      printf -- '- %sZ %s\n' "${t#* }" "$*" >> "$log" ;;
  esac
}

if [ "${1:-}" != "--self-test" ]; then
  [ $# -ge 1 ] || { echo "usage: run-log.sh <dispatch> <text...> | --section <title> | --close | --self-test" >&2; exit 1; }
  write "$@"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
d="$tmp/RUN"; mkdir "$d"; log="$d/run-log.md"
fails=0
has() { grep -qxF -- "$2" "$log" && printf '  ok   %s\n' "$1" || { printf '  FAIL %s: no line "%s"\n' "$1" "$2"; sed 's/^/         /' "$log"; fails=$((fails+1)); }; }
count() { grep -c -- "$1" "$log"; }

RUN_LOG_NOW="2026-01-01 12:00:00" write "$d" --section Harvest
RUN_LOG_NOW="2026-01-01 12:03:07" write "$d" "luna harvested, 4 commits"
RUN_LOG_NOW="2026-01-01 12:30:00" write "$d" --section Synthesis
RUN_LOG_NOW="2026-01-01 12:45:30" write "$d" --close
RUN_LOG_NOW="2026-01-01 12:50:00" write "$d" --close

echo "positive controls"
has "a section heading carries its start time"          "## Harvest (2026-01-01 12:00:00 UTC)"
has "an entry carries the time"                          "- 12:03:07Z luna harvested, 4 commits"
has "starting a section closes the last, with its time"  "- 12:30:00Z section Harvest took 30m 00s"
has "--close closes the open section"                    "- 12:45:30Z section Synthesis took 15m 30s"

echo "negative controls"
[ "$(count 'section Synthesis took')" -eq 1 ] && printf '  ok   %s\n' "closing twice writes one line" \
  || { printf '  FAIL closing twice writes one line\n'; fails=$((fails+1)); }
rm -- "$log"; RUN_LOG_NOW="2026-01-01 13:00:00" write "$d" --close
[ ! -s "$log" ] && printf '  ok   %s\n' "--close with no open section writes nothing" \
  || { printf '  FAIL --close with no open section writes nothing\n'; fails=$((fails+1)); }
write "$tmp/nowhere" "x" 2>/dev/null; rc=$?
[ $rc -eq 1 ] && printf '  ok   %s\n' "a missing dispatch directory is refused" \
  || { printf '  FAIL a missing dispatch directory is refused (exit %s)\n' "$rc"; fails=$((fails+1)); }

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
