#!/usr/bin/env bash
# Blind acceptance probes for #216: the private-data check as TypeScript run by Bun.
# Interface-only: it drives the five scripts through their CLIs and asserts the
# ticket's checks. Run from anywhere inside the worktree under test:
#   oracle-216.sh [probe...]        all probes, or only the named ones
# Exit 0 when every probe behaves, 1 when a probe misbehaves, 2 on usage errors.
# Made-up fixtures are assembled from fragments at run time; this file carries no
# matchable form besides the false-positive shapes the port must stop flagging.
set -u

ROOT=$(git rev-parse --show-toplevel) || exit 2
cd "$ROOT" || exit 2
SCRIPTS=$ROOT/scripts
T=$(mktemp -d) || exit 2
trap 'rm -rf "$T" "$ROOT/.oracle-tmp" "$ROOT/raw/oracle-probe" "$ROOT/.postmaster/oracle-probe"' EXIT

passed=0
failed=0
failed_names=""

mkrepo() {
  d=$1
  git init -q -b main "$d"
  git -C "$d" config user.name Oracle
  git -C "$d" config user.email "oracle@example.invalid"
}

# A private-key block, assembled so no committed line holds its shape.
key_block() {
  printf '%s%s\n' '-----BEGIN PRIVATE ' 'KEY-----' > "$1"
  printf '%s\n' 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo9' >> "$1"
  printf '%s%s\n' '-----END PRIVATE ' 'KEY-----' >> "$1"
}

bearer_line() {
  printf '%s %s\n' 'Bearer' 'ABCDEFGHIJ1234567890'
}

# A same-line allow marker, assembled so no committed line holds its shape.
mark() {
  printf '%s:allow %s -- test fixture' 'private-data' "$1"
}

home_path() {
  u=fixture-user-413
  printf '/%s/%s/%s' home "$u" notes.txt
}

p_no_python() {
  out=$(grep -rni 'python' scripts/scrub-check.sh scripts/scrub-check.ts \
    scripts/scrub-rewrite.sh scripts/scrub-rewrite.ts scripts/raw-promote.sh \
    scripts/raw-promote.ts scripts/tree-check.sh scripts/tree-check.ts \
    scripts/verify-merge.sh scripts/verify-merge.ts) && return 1
  [ -z "$out" ]
}

check_wrapper() {
  f=$1
  base=$2
  [ "$(wc -l < "$f")" = 2 ] || return 1
  [ "$(sed -n '1p' "$f")" = '#!/usr/bin/env bash' ] || return 1
  line2=$(sed -n '2p' "$f")
  case $line2 in 'exec bun --no-env-file "'*) ;; *) return 1 ;; esac
  case $line2 in *"/$base.ts"*) ;; *) return 1 ;; esac
  case $line2 in *'"$@"') ;; *) return 1 ;; esac
}

p_wrappers() {
  check_wrapper scripts/scrub-check.sh scrub-check || return 1
  check_wrapper scripts/scrub-rewrite.sh scrub-rewrite || return 1
  check_wrapper scripts/raw-promote.sh raw-promote || return 1
  check_wrapper scripts/tree-check.sh tree-check || return 1
  check_wrapper scripts/verify-merge.sh verify-merge || return 1
}

p_tests_beside() {
  for f in scrub-check scrub-rewrite raw-promote tree-check verify-merge; do
    [ -f "scripts/$f.test.ts" ] || return 1
  done
  [ -f scripts/scrub-diff.test.ts ]
}

p_diff_test() {
  bun test scripts/scrub-diff.test.ts > "$T/diff.out" 2>&1
}

p_spans_exact() {
  key_block "$T/span.txt"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --spans "$T/span.txt" > "$T/spans.out" 2>&1 || return 1
  grep -q ':token$' "$T/spans.out" || return 1
  grep -Eqv '^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[a-z-]+$' "$T/spans.out" && return 1
  grep -q 'BEGIN' "$T/spans.out" && return 1
  return 0
}

p_findings_json() {
  r=$T/frepo
  mkrepo "$r"
  echo clean > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m clean
  c1=$(git -C "$r" rev-parse HEAD)
  key_block "$r/leak.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m leak
  c2=$(git -C "$r" rev-parse HEAD)
  (cd "$r" && POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --findings "$c1" "$c2" > "$T/find.out" 2>&1)
  [ $? = 1 ] || return 1
  grep -q '"rule"' "$T/find.out" || return 1
  grep -q 'token' "$T/find.out" || return 1
  grep -q 'leak.txt' "$T/find.out" || return 1
}

p_safe_path() {
  p=$(home_path)
  out=$(POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --safe-path "$p") || return 1
  printf '%s' "$out" | grep -qF '[redacted]' || return 1
}

p_log_detection() {
  hex40=$(printf '%040d' 0)
  rm -f "$T/det.log"
  POSTMASTER_DETECTIONS_LOG=$T/det.log "$SCRIPTS/scrub-check.sh" --log-detection token somefile.txt 3 "$hex40" || return 1
  grep -q '"rule": "token"' "$T/det.log" || return 1
}

p_log_detection_refuses_marker() {
  hex40=$(printf '%040d' 0)
  POSTMASTER_DETECTIONS_LOG=$T/det.log "$SCRIPTS/scrub-check.sh" --log-detection marker somefile.txt 1 "$hex40" > /dev/null 2>&1
  [ $? = 2 ]
}

p_clean_properties() {
  printf '%s\n' 'const HOME = process.env.HOME ?? "";' 'const h = this.home;' 'const p = Path.home;' > "$T/props.ts"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --files "$T/props.ts" > /dev/null 2>&1
  [ $? = 0 ]
}

p_clean_note_path() {
  printf '%s\n' 'wrote <trial>/home/note.txt for the test' > "$T/notepath.txt"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --files "$T/notepath.txt" > /dev/null 2>&1
  [ $? = 0 ]
}

p_census_bound() {
  base=${ORACLE_BASE:-$(git merge-base HEAD 135)}
  root=$(git rev-list --max-parents=0 "$base")
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" "$root" "$base" > "$T/range.out" 2> "$T/range.err"
  rc=$?
  [ "$rc" = 0 ] || [ "$rc" = 1 ] || return 1
  rm -rf .oracle-tmp && mkdir -p .oracle-tmp
  git archive "$root" | tar -x -C .oracle-tmp
  find .oracle-tmp -type f -print0 | xargs -0 POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --files > "$T/tree.out" 2> "$T/tree.err"
  rc=$?
  [ "$rc" = 0 ] || [ "$rc" = 1 ] || return 1
  range_n=$(wc -l < "$T/range.out")
  tree_n=$(wc -l < "$T/tree.out")
  total=$((range_n + tree_n))
  echo "census over $root..$base: $total ($range_n range, $tree_n tree)"
  sed 's/.*: //' "$T/range.out" "$T/tree.out" | sort | uniq -c
  rm -rf .oracle-tmp
  [ "$total" -le 50 ]
}

p_oracle_count() {
  n=$(grep -rho "oracle: [^\"']*" scripts/*.test.ts | sort -u | wc -l)
  echo "$n oracle tests"
  [ "$n" -ge 187 ]
}

p_oracle_pass() {
  bun test scripts/ -t 'oracle: ' > "$T/oracle.out" 2>&1
}

p_range_flags() {
  r=$T/rrepo
  mkrepo "$r"
  echo clean > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m clean
  c1=$(git -C "$r" rev-parse HEAD)
  key_block "$r/leak.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m leak
  c2=$(git -C "$r" rev-parse HEAD)
  (cd "$r" && POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" "$c1" "$c2" > "$T/range.out" 2>&1)
  [ $? = 1 ] || return 1
  grep -Eq '^[0-9a-f]{40}:[^:]+:[0-9]+: token$' "$T/range.out" || return 1
  grep -q 'BEGIN' "$T/range.out" && return 1
  return 0
}

p_message_scan() {
  r=$T/mrepo
  mkrepo "$r"
  echo clean > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m clean
  c1=$(git -C "$r" rev-parse HEAD)
  key_block "$T/msg.txt"
  echo more >> "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -F "$T/msg.txt"
  c2=$(git -C "$r" rev-parse HEAD)
  (cd "$r" && POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" "$c1" "$c2" > "$T/msg.out" 2>&1)
  [ $? = 1 ] || return 1
  grep -q '(message)' "$T/msg.out" || return 1
}

p_markers_honored() {
  r=$T/krepo
  mkrepo "$r"
  echo clean > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m clean
  c1=$(git -C "$r" rev-parse HEAD)
  printf '%s %s # %s\n' 'Bearer' 'ABCDEFGHIJ1234567890' "$(mark token)" > "$r/marked.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m marked
  c2=$(git -C "$r" rev-parse HEAD)
  (cd "$r" && POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" "$c1" "$c2" > /dev/null 2>&1)
  [ $? = 0 ]
}

p_rewrite_smoke() {
  r=$T/wrepo
  mkrepo "$r"
  echo clean > "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m clean
  key_block "$r/leak.txt"
  echo ok >> "$r/a.txt"
  git -C "$r" add -A && git -C "$r" commit -q -m leak
  (cd "$r" && GIT_EDITOR=true POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-rewrite.sh" HEAD~1 HEAD > "$T/rew.out" 2>&1)
  [ $? = 0 ] || return 1
  git -C "$r" show HEAD:leak.txt 2> /dev/null | grep -q 'BEGIN' && return 1
  root=$(git -C "$r" rev-list --max-parents=0 HEAD)
  (cd "$r" && POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" "$root" HEAD > /dev/null 2>&1)
  [ $? = 0 ]
}

p_promote_smoke() {
  bearer_line > "$T/src.txt"
  rm -f raw/oracle-probe
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/raw-promote.sh" "$T/src.txt" raw/oracle-probe > /dev/null 2>&1
  [ $? = 0 ] || return 1
  grep -q '<redacted:token>' raw/oracle-probe || return 1
  grep -q 'Bearer' "$T/src.txt" || return 1
  rm -f raw/oracle-probe
}

p_tree_postmaster() {
  mkdir -p .postmaster
  echo probe > .postmaster/oracle-probe
  git add -f .postmaster/oracle-probe
  "$SCRIPTS/tree-check.sh" > /dev/null 2>&1
  rc=$?
  git reset -q .postmaster/oracle-probe 2> /dev/null
  rm -f .postmaster/oracle-probe
  rmdir .postmaster 2> /dev/null
  [ "$rc" = 1 ]
}

p_pr_description() {
  bearer_line > "$T/pr.txt"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --pr-description "$T/pr.txt" > "$T/pr.out" 2>&1
  [ $? = 1 ] || return 1
  grep -q '(pr-description)' "$T/pr.out" || return 1
  printf '%s %s # %s\n' 'Bearer' 'ABCDEFGHIJ1234567890' "$(mark token)" > "$T/prm.txt"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --pr-description "$T/prm.txt" > /dev/null 2>&1
  [ $? = 1 ]
}

p_criterion5_diffs() {
  mb135=$(git merge-base origin/main 135)
  bad=""
  for f in .postmaster/project.toml raw/README.md scripts/runs-status.ts scripts/runs-watch.ts scripts/verify.ts scripts/wiki-lint.ts scripts/runs-status.test.ts scripts/runs-watch.test.ts scripts/verify.test.ts scripts/wiki-lint.test.ts skills/postmaster/coachman.md skills/postmaster/postmaster.md skills/wiki/SKILL.md; do
    git diff "main...HEAD" -- "$f" > "$T/new.diff" 2> /dev/null
    git diff "$mb135...135" -- "$f" > "$T/ref.diff" 2> /dev/null
    cmp -s "$T/new.diff" "$T/ref.diff" || bad="$bad $f"
  done
  [ -z "$bad" ] || { echo "differ:$bad"; return 1; }
}

p_streaming() {
  {
    i=1
    while [ "$i" -le 150000 ]; do printf 'ordinary log line %s\n' "$i"; i=$((i + 1)); done
    bearer_line
  } > "$T/big.log"
  POSTMASTER_DETECTIONS_LOG= "$SCRIPTS/scrub-check.sh" --files "$T/big.log" > /dev/null 2>&1
  [ $? = 1 ]
}

p_gate() {
  bun run check > "$T/gate.out" 2>&1
}

ALL="no_python wrappers tests_beside diff_test spans_exact findings_json safe_path log_detection log_detection_refuses_marker clean_properties clean_note_path census_bound oracle_count oracle_pass range_flags message_scan markers_honored rewrite_smoke promote_smoke tree_postmaster pr_description criterion5_diffs streaming gate"

run_one() {
  name=$1
  if "p_$name" > "$T/$name.out" 2>&1; then
    echo "ok $name"
    passed=$((passed + 1))
  else
    echo "FAIL $name"
    failed=$((failed + 1))
    failed_names="$failed_names $name"
  fi
}

if [ $# = 0 ]; then
  set -- $ALL
fi
for name in "$@"; do
  case " $ALL " in *" $name "*) ;; *) echo "unknown probe: $name" >&2; exit 2 ;; esac
done
for name in "$@"; do
  run_one "$name"
done
echo "oracle-216: $passed passed, $failed failed"
[ "$failed" = 0 ] || echo "failed:$failed_names"
[ "$failed" = 0 ]
