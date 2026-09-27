#!/usr/bin/env bash
# Which change each harness's own code-review skill reviews in a review scratch: a worktree
# detached at the snapshot, with no upstream, of a target whose default branch is not `main`. The
# change is two commits, and the planted bug is in the first, so a review of the last commit alone
# cannot report it. Each harness runs twice through one command that differs only in the target it
# names: none, which is its default, and the run's change named explicitly. Every run gets a fresh
# scratch cut by scripts/cut-scratch.sh and checked before the launch.
#
#   run.sh <postmaster-checkout> <out-dir> [<run>...]
#
# The runs are claude-default, claude-range, codex-default, codex-base, mimo-default and
# mimo-range; all six when none is named. claude launches through `launch.sh launch` on a trial
# config. codex and MiMo Code have no review form in launch.sh, so their commands are built here.
# MIMO_ENV_FILE names the file that sets MiMo Code's key; it is sourced into the MiMo process
# alone and never printed. CLAUDE_MODEL, CODEX_MODEL and MIMO_MODEL choose the models, LEVEL the
# effort (default low); a run at another level is recorded as <run>-<level>. KEEP names a
# directory to keep each run's raw stream in, with the transcript of any task or session the
# review ran in, so the record can be made again with record.py; none of them is ever published,
# since claude's init event lists the machine's own tools and connectors. Each record keeps only
# the fields record.py names.
set -uo pipefail
usage="usage: run.sh <postmaster-checkout> <out-dir> [<run>...]"
ROOT=$(cd "${1:?$usage}" && pwd -P) || exit 1
OUT=${2:?$usage}; shift 2
RUNS=${*:-claude-default claude-range codex-default codex-base mimo-default mimo-range}
CLAUDE_MODEL=${CLAUDE_MODEL:-claude-opus-5-5}
CODEX_MODEL=${CODEX_MODEL:-gpt-6-luna}
MIMO_MODEL=${MIMO_MODEL:-xiaomi-token-plan-sgp/mimo-v2.6-pro}
LEVEL=${LEVEL:-low}
HERE=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P) || exit 1
tmp=$(mktemp -d) && tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'git -C "$tmp/target" worktree prune 2>/dev/null; rm -r -- "$tmp"' EXIT
KEEP=${KEEP:-$tmp/streams}
mkdir -p "$KEEP" && KEEP=$(cd "$KEEP" && pwd -P) || exit 1
case " $RUNS " in *" mimo-"*) [ -r "${MIMO_ENV_FILE:-}" ] || { echo "run.sh: MIMO_ENV_FILE must name MiMo Code's key file" >&2; exit 1; } ;; esac
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_AUTHOR_DATE=2026-09-27T00:00:00Z GIT_COMMITTER_DATE=2026-09-27T00:00:00Z   # the same SHAs every time

# The fixture: a record store on trunk; the change pages through it (the planted bug, an
# off-by-one at src/page.js:8) and then counts the pages, correctly.
git init -q -b trunk "$tmp/target" && mkdir -p "$tmp/target/src" || exit 1
cat > "$tmp/target/package.json" <<'EOF'
{ "name": "records", "version": "1.0.0", "private": true, "main": "src/store.js" }
EOF
cat > "$tmp/target/src/store.js" <<'EOF'
const records = [];

// Add a record and return how many there are.
function add(record) {
  records.push(record);
  return records.length;
}

// Every record, oldest first, as a copy the caller may change.
function all() {
  return records.slice();
}

module.exports = { add, all };
EOF
git -C "$tmp/target" add -A && git -C "$tmp/target" commit -qm "Keep records in memory" || exit 1
BASE=$(git -C "$tmp/target" rev-parse HEAD)
git -C "$tmp/target" worktree add -q -b T-1 "$tmp/synthesis" || exit 1
cat > "$tmp/synthesis/src/page.js" <<'EOF'
const { all } = require("./store");

// Page `number` of the records, counting from 1, with `size` records to a page.
function page(number, size) {
  if (!Number.isInteger(number) || number < 1) throw new RangeError("number must be a positive integer");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const start = (number - 1) * size;
  return all().slice(start, start + size + 1);
}

module.exports = { page };
EOF
git -C "$tmp/synthesis" add -A && git -C "$tmp/synthesis" commit -qm "Page through the records" || exit 1
cat > "$tmp/synthesis/src/count.js" <<'EOF'
const { all } = require("./store");

// How many pages of `size` records there are.
function pageCount(size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  return Math.ceil(all().length / size);
}

module.exports = { pageCount };
EOF
git -C "$tmp/synthesis" add -A && git -C "$tmp/synthesis" commit -qm "Count the pages" || exit 1
SNAP=$(git -C "$tmp/synthesis" rev-parse HEAD)
PLANTED=$(grep -n 'slice(start' "$tmp/synthesis/src/page.js")
[ "${PLANTED%%:*}" = 8 ] || { echo "run.sh: the planted line is not src/page.js:8" >&2; exit 1; }

printf '[lanes.sentinel]\nharness = "claude"\nmodel = "%s"\n' "$CLAUDE_MODEL" > "$tmp/config.toml"
versions=$(printf 'claude %s; codex %s; mimo %s' "$(claude --version 2>/dev/null | head -1)" \
  "$(codex --version 2>/dev/null | head -1)" "$(mimo --version 2>/dev/null < /dev/null | head -1)")

for run in $RUNS; do
  name=$run; [ "$LEVEL" = low ] || name=$run-$LEVEL   # a run at another level is recorded under its own name
  dest=$tmp/target/.worktrees/T-1-rev-bug-$name
  "$ROOT/scripts/cut-scratch.sh" "$tmp/target" "$tmp/synthesis" "$dest" "$SNAP" >/dev/null 2>&1 || { echo "run.sh: cannot cut $dest" >&2; exit 1; }
  "$ROOT/scripts/cut-scratch.sh" --check "$dest" "$SNAP" || exit 1
  before=$(git -C "$dest" status --porcelain | wc -l)
  : > "$KEEP/$name.last"; touch "$KEEP/$name.start"
  case $run in
    claude-default) form="/code-review $LEVEL" ;;
    claude-range)   form="/code-review $LEVEL $BASE...HEAD" ;;
    codex-default)  form="codex exec review" ;;
    codex-base)     form="codex exec review --base $BASE" ;;
    mimo-default)   form="mimo run --command review" ;;
    mimo-range)     form="mimo run --command review $BASE...HEAD" ;;
    *) echo "run.sh: no such run: $run" >&2; exit 1 ;;
  esac
  case $run in
    claude-*)
      printf '%s\n' "$form" > "$tmp/$name-prompt.txt"
      POSTMASTER_CONFIG=$tmp/config.toml "$ROOT/scripts/launch.sh" launch sentinel "$dest" "$tmp/$name-prompt.txt" \
        > "$KEEP/$name.jsonl" 2> "$KEEP/$name.err" ;;
    codex-*)
      target=(); [ "$run" = codex-base ] && target=(--base "$BASE")
      (cd "$dest" && exec codex exec review "${target[@]}" --json -o "$KEEP/$name.last" -m "$CODEX_MODEL" \
        -c "model_reasoning_effort=\"$LEVEL\"" --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check) \
        < /dev/null > "$KEEP/$name.jsonl" 2> "$KEEP/$name.err" ;;
    mimo-*)
      target=(); [ "$run" = mimo-range ] && target=("$BASE...HEAD")
      (cd "$dest" && set -a && . "$MIMO_ENV_FILE" && set +a \
        && exec mimo run --command review --format json -m "$MIMO_MODEL" --variant "$LEVEL" --dangerously-skip-permissions "${target[@]}") \
        < /dev/null > "$KEEP/$name.jsonl" 2> "$KEEP/$name.err" ;;
  esac
  rc=$?
  # claude runs the skill as a forked task, whose tool calls are not in the stream but in the
  # task's output file, which the stream names. MiMo Code's subtask streams its own inline.
  if [ "${run%%-*}" = claude ]; then
    python3 "$HERE/record.py" --task-files "$KEEP/$name.jsonl" | while IFS= read -r f; do
      cp -- "$f" "$KEEP/$name.task-$(basename "$f" .output).jsonl"
    done
  fi
  # codex keeps each thread's model and effort in its rollout: record.py reads those written since
  # the start whose working directory is this scratch.
  rollouts=""
  [ "${run%%-*}" = codex ] && rollouts=$(find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -newer "$KEEP/$name.start" 2>/dev/null | tr '\n' ' ')
  case ${run%%-*} in claude) model=$CLAUDE_MODEL ;; codex) model=$CODEX_MODEL ;; mimo) model=$MIMO_MODEL ;; esac
  python3 - "$KEEP/$name.meta.json" run="$name" form="$form" level="$LEVEL" exit="$rc" tmp="$tmp" dest="$dest" \
    base="$BASE" snap="$SNAP" head_1="$(git -C "$dest" rev-parse HEAD~1)" planted="$PLANTED" versions="$versions" \
    git="$(git --version)" model="$model" dirty_before="$before" dirty_after="$(git -C "$dest" status --porcelain | wc -l)" \
    changed_since_snap="$(git -C "$dest" diff --name-only "$SNAP" | tr '\n' ' ')" rollouts="$rollouts" <<'EOF'
import json, sys
meta = dict(a.split("=", 1) for a in sys.argv[2:])
meta["rollouts"] = meta["rollouts"].split()
json.dump(meta, open(sys.argv[1], "w"), indent=1)
EOF
  python3 "$HERE/record.py" "$KEEP" "$name" > "$OUT/$name.txt" || exit 1
  echo "recorded $OUT/$name.txt"
done
