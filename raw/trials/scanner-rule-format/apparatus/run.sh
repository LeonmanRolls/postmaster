#!/usr/bin/env bash
# Run the trial from the repository root and record its output under results/.
#
#   raw/trials/scanner-rule-format/apparatus/run.sh [<ref> [<later-ref>]]
#       <ref> holds the table rules-135.toml was written against (default 135); with
#       <later-ref>, the same entries are also compared with that later table, into
#       results/table-later.txt, to show what changed between the two
#
# Writes results/versions.txt, results/entry-points.txt, results/table.txt,
# results/controls.txt, results/mutations.txt and results/probes.txt. Exits 1 when a control does not behave
# as method.md says.
set -uo pipefail
ref=${1:-135}
later=${2:-}
here=raw/trials/scanner-rule-format
app=$here/apparatus
out=$here/results
[ -d "$app" ] || { echo "run from the repository root" >&2; exit 2; }
mkdir -p "$out"
source="git:$ref:scripts/scrub-check.sh"
check() { bun "$app/check.ts" "$@"; }

{
  echo "date: $(date -u +%Y-%m-%d)"
  echo "table: $(git rev-parse "$ref^{commit}") (ref $ref), scripts/scrub-check.sh"
  echo "bun: $(bun --version)"
  echo "node: $(node --version)"
  echo "python: $(python3 --version 2>&1)"
} > "$out/versions.txt"

# What the scanner and its two companions are asked to do, as each states it.
{
  git show "$ref:scripts/scrub-check.sh" | sed -n '/^USAGE = (/,/)$/p'
  git show "$ref:scripts/raw-promote.sh" | grep -m1 '^USAGE='
  git show "$ref:scripts/scrub-rewrite.sh" | grep -m1 '^USAGE='
} > "$out/entry-points.txt"

check "$source" "$app/rules-135.toml" --lines 50000 > "$out/table.txt"
echo "exit $?" >> "$out/table.txt"
if [ -n "$later" ]; then
  echo "later table: $(git rev-parse "$later^{commit}") (ref $later)" >> "$out/versions.txt"
  check "git:$later:scripts/scrub-check.sh" "$app/rules-135.toml" --lines 50000 > "$out/table-later.txt"
  echo "exit $?" >> "$out/table-later.txt"
fi

fails=0
ok() {  # ok <label> <condition-exit>
  if [ "$2" -eq 0 ]; then echo "ok    $1"; else echo "FAIL  $1"; fails=$((fails + 1)); fi
}
{
  controls=$(check "file:$app/controls/table.sh" "$app/controls/rules.toml" --lines 20000)
  code=$?
  printf '%s\nexit %s\n\n' "$controls" "$code"
  grep -q '^expressed  ctl-widget ' <<<"$controls"; ok "the positive control, ctl-widget, is expressed" $?
  grep -q '^NOT EXPRESSED  ctl-checksum ' <<<"$controls" && grep -q 'disagrees with the table' <<<"$controls"
  ok "ctl-checksum is listed, for disagreeing with the table" $?
  grep -q '^NOT EXPRESSED  ctl-conditional ' <<<"$controls" && grep -q 'regex does not compile' <<<"$controls"
  ok "ctl-conditional is listed, for an entry the format refuses" $?
  grep -q '^NOT EXPRESSED  ctl-missing ' <<<"$controls" && grep -q 'no entry in the format file' <<<"$controls"
  ok "ctl-missing is listed, for having no entry" $?
  [ "$code" -eq 1 ]; ok "the run exits 1 when it lists a rule" $?
} > "$out/controls.txt"

{
  for mutation in email/allowlists account-id/requires private-host/check dotenv/minLength; do
    result=$(check "$source" "$app/rules-135.toml" --lines 20000 --without "$mutation")
    code=$?
    printf '%s\nexit %s\n\n' "$result" "$code"
    grep -q "^NOT EXPRESSED  ${mutation%%/*} " <<<"$result"
    ok "dropping $mutation lists ${mutation%%/*}" $?
  done
} > "$out/mutations.txt"

{
  probes=$(python3 "$app/probes.py" "$source")
  printf '%s\n\n' "$probes"
  grep -q '^trailer  *assistant-attribution ' <<<"$probes"; ok "the trailer control is found" $?
  grep -q '^json-depth-1  *private-path ' <<<"$probes"; ok "the depth-1 control is found" $?
} > "$out/probes.txt"

grep -h '^FAIL' "$out/controls.txt" "$out/mutations.txt" "$out/probes.txt"
[ "$fails" -eq 0 ] || exit 1
grep -q '^listed: none' "$out/table.txt" && echo "table: listed none" || grep '^listed:' "$out/table.txt"
