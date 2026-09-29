#!/usr/bin/env bash
# List candidate target projects, most recently worked first.
#
# Recency does the filtering that rules cannot: dormant repos and scratch work fall off
# the list without needing to be named. Third-party clones are excluded because nobody
# dispatches work into a vendored copy of someone else's project.
#
# Deliberately does NOT filter on having a remote. Plenty of real work is local-only, and
# filtering on a remote silently hides it. Remote status is shown as information; project
# instructions or the user establish whether landing uses a pull request or a local merge.
set -uo pipefail
LIMIT=${LIMIT:-12}
DEPTH=${DEPTH:-3}
EXCLUDE=${EXCLUDE:-external}          # directory name segment to skip
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
roots=("$@")
if [ ${#roots[@]} -eq 0 ] && [ -f "$CONFIG" ] && python3 -c 'import tomllib' 2>/dev/null; then
  while IFS= read -r r; do roots+=("$r"); done < <(python3 -c '
import sys, tomllib
for r in tomllib.load(open(sys.argv[1], "rb")).get("projects_roots", []): print(r)' "$CONFIG")
fi
[ ${#roots[@]} -eq 0 ] && roots=("$HOME/Code")
roots=("${roots[@]/#\~/$HOME}")

# NOTE: the loop below runs in a pipeline, so any counter incremented inside it lives in a
# subshell and is lost. Count the OUTPUT instead; that is the thing we actually care about.
out=$(
for root in "${roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r g; do
    d=$(dirname "$g")
    # [[ ]] not case: a case pattern's ")" gets matched against the enclosing $( )
    [[ "$d" == */"$EXCLUDE"/* ]] && continue
    ts=$(git -C "$d" log -1 --format=%ct 2>/dev/null) || continue
    [ -n "$ts" ] || continue
    rel=$(git -C "$d" log -1 --format=%cr 2>/dev/null)
    if git -C "$d" remote get-url origin >/dev/null 2>&1; then r=remote; else r=local-only; fi
    printf '%s\t%s\t%s\t%s\n' "$ts" "${d/#$HOME/~}" "$rel" "$r"
  done < <(find "$root" -maxdepth "$DEPTH" -name .git -type d \
             -not -path '*/node_modules/*' -not -path '*/.worktrees/*' 2>/dev/null)
done | sort -rn | head -"$LIMIT" | awk -F'\t' '{printf "%-44s %-18s %s\n", $2, $3, $4}'
)
if [ -z "$out" ]; then
  # Zero means the roots were wrong, not that the user has no projects.
  echo "find-projects: no git repositories under: ${roots[*]}" >&2
  exit 0
fi
printf '%s\n' "$out"
