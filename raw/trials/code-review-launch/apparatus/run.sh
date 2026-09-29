#!/usr/bin/env bash
# A positive control through the flow's own launch path: in a worktree scratch detached at the
# snapshot of a target whose default branch is not `main`, with a planted bug in a commit that
# is not the last, each harness with a review form, at the level launch.sh review sets, yields
# a normalized finding at the bug's file and line.
#
#   run.sh <postmaster-checkout> <out-dir>
#
# Every review is scripts/launch.sh review <lane> <scratch> <BASE>, which is the form the bug
# lens uses. The fixture is the one from raw/trials/code-review-scope/: default branch `trunk`,
# two commits, the planted off-by-one in the first. The events stream is normalized with
# scripts/review-findings.sh normalize, and the check is that one finding is at src/page.js:8.
# Lanes come from a trial config that names the same harnesses and models as the live one;
# MIMO_ENV_FILE is MiMo Code's key file and is never printed.
set -uo pipefail
usage="usage: run.sh <postmaster-checkout> <out-dir>"
ROOT=$(cd "${1:?$usage}" && pwd -P) || exit 1
OUT=${2:?$usage}; shift 2
HERE=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P) || exit 1
MIMO_ENV_FILE=${MIMO_ENV_FILE:-$HOME/.postmaster/lanes/mimo.env}
CLAUDE_MODEL=${CLAUDE_MODEL:-claude-opus-5-5}
CODEX_MODEL=${CODEX_MODEL:-gpt-6-luna}
MIMO_MODEL=${MIMO_MODEL:-<plan-provider>/mimo-v2.6-pro}
tmp=$(mktemp -d) && tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'git -C "$tmp/target" worktree prune 2>/dev/null; rm -r -- "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_AUTHOR_DATE=2026-09-27T00:00:00Z GIT_COMMITTER_DATE=2026-09-27T00:00:00Z

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
[ "$(grep -n 'slice(start' "$tmp/synthesis/src/page.js" | cut -d: -f1)" = 8 ] \
  || { echo "run.sh: the planted line is not src/page.js:8"; exit 1; }

printf '[lanes.opus]\nharness = "claude"\nmodel = "%s"\neffort = "low"\n\n[lanes.luna]\nharness = "codex"\nmodel = "%s"\neffort = "low"\n\n[lanes.mimo]\nharness = "mimo"\nmodel = "%s"\neffort = "low"\nenv_file = "%s"\n' \
  "$CLAUDE_MODEL" "$CODEX_MODEL" "$MIMO_MODEL" "$MIMO_ENV_FILE" > "$tmp/config.toml"
mkdir -p "$tmp/run"
printf '{"config": {"lanes": {"opus": {"harness": "claude"}, "luna": {"harness": "codex"}, "mimo": {"harness": "mimo"}}}}\n' > "$tmp/run/run.json"

failed=0
for lane in opus luna mimo; do
  dest=$tmp/target/.worktrees/T-1-rev-bug-$lane
  "$ROOT/scripts/cut-scratch.sh" "$tmp/target" "$tmp/synthesis" "$dest" "$SNAP" >/dev/null 2>&1 \
    || { echo "run.sh: cannot cut $dest"; failed=1; continue; }
  "$ROOT/scripts/cut-scratch.sh" --check "$dest" "$SNAP" || { failed=1; continue; }
  echo "review $lane at $dest from $BASE"
  POSTMASTER_CONFIG=$tmp/config.toml "$ROOT/scripts/launch.sh" review "$lane" "$dest" "$BASE" \
    --last "$OUT/$lane-last.md" > "$OUT/$lane.jsonl" 2> "$OUT/$lane.err"
  rc=$?
  echo "exit $rc"
  # Harvest the review's own record where the harness keeps it outside the stream
  # (criterion 8): claude's forked task files, named by the stream's task_notification.
  "$ROOT/scripts/review-findings.sh" harvest "$OUT/$lane.jsonl" "$OUT" --prefix "$lane" \
    || { echo "FAIL $lane: harvest failed"; failed=1; continue; }
  # The final message for the record: codex's -o file when it has one, else the last
  # text of the stream. Normalization reads the events stream, not this file.
  if [ -s "$OUT/$lane-last.md" ]; then
    :
  else
    python3 - "$OUT/$lane.jsonl" "$OUT/$lane-report.md" <<'PY'
import json, sys
text = ""
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("type") == "result" and isinstance(e.get("result"), str):
        text = e["result"]
    elif e.get("type") == "assistant" and isinstance(e.get("message"), dict):
        for c in e["message"].get("content") or []:
            if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
                text = c["text"]
    elif e.get("type") == "text" and isinstance(e.get("part"), dict) and e["part"].get("text"):
        text = e["part"]["text"]
    elif e.get("type") == "assistant" and e.get("text"):
        text = e["text"]
open(sys.argv[2], "w").write(text)
print("report %d bytes" % len(text))
PY
  fi
  echo "normalize $OUT/$lane.jsonl"
  last_args=""
  [ "$lane" = luna ] && last_args="--last $OUT/$lane-last.md"   # codex's -o file
  # shellcheck disable=SC2086
  "$ROOT/scripts/review-findings.sh" normalize "$lane" "$dest" "$OUT/$lane.jsonl" \
    --run "$tmp/run" $last_args > "$OUT/$lane-findings.json" 2> "$OUT/$lane-findings.err"
  nrc=$?
  if [ $nrc -ne 0 ]; then
    echo "FAIL $lane: review-findings.sh exit $nrc $(cat "$OUT/$lane-findings.err")"
    failed=1
    continue
  fi
  if python3 - "$OUT/$lane-findings.json" <<'PY'
import json, sys
found = json.load(open(sys.argv[1], encoding="utf-8"))
ok = any(str(f.get("file", "")).endswith("src/page.js") and str(f.get("line")) == "8" for f in found)
print("HIT" if ok else "MISS")
sys.exit(0 if ok else 1)
PY
  then echo "PASS $lane: normalized finding at src/page.js:8"
  else echo "FAIL $lane: no normalized finding at src/page.js:8"; cat "$OUT/$lane-findings.json"; failed=1
  fi
done
exit $failed
