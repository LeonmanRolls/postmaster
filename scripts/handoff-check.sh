#!/usr/bin/env bash
# Check that a leg's hand-off document has every required section and that none is empty.
# A hand-off that passes is the whole of what the next leg's coachman knows, so a missing
# section here is a decision silently lost, not a formatting nit.
#
#   handoff-check.sh <handoff-file>
#
#   exit 0  every section present and non-empty
#   exit 1  usage or no such file
#   exit 2  sections missing or empty; each is named on stderr
set -uo pipefail
F=${1:?usage: handoff-check.sh <handoff-file>}
[ -f "$F" ] || { echo "handoff-check: no such file: $F" >&2; exit 1; }
python3 - "$F" <<'PY'
import sys, re
# coachman-contract:handoff-completion:start
required = ["Decisions", "Deferred findings", "Verified by execution", "Unverified",
            "Branches and lanes", "Open questions", "Next leg"]
text = open(sys.argv[1]).read()
sections = {}
current = None
for line in text.splitlines():
    m = re.match(r"^##\s+(.*?)\s*$", line)
    if m: current = m.group(1); sections.setdefault(current, []); continue
    if current is not None and line.strip(): sections[current].append(line)
bad = [s for s in required if s not in sections or not sections[s]]
# coachman-contract:handoff-completion:end
if bad:
    for s in bad: print("handoff-check: missing or empty section: %s" % s, file=sys.stderr)
    sys.exit(2)
print("hand-off complete: %d sections" % len(required))
PY
