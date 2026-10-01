#!/usr/bin/env bash
# Copy one file or tree into raw/, scrubbed before the copy completes.
#
#   raw-promote.sh <src> <dest>     copy src to dest under raw/
#   raw-promote.sh --self-test      controls, exit 0 when all pass
#   raw-promote.sh --help           usage, exit 0
#
# Run from the repository root. The copy is the moment of publication, so the
# scrub runs first: every regular file under src goes through the scrub's
# span protocol, and each finding is replaced with a placeholder naming its
# rule. The copy is checked again, and it completes only when clean: a file
# whose recheck trips removes the whole copy and fails. A file with no
# findings is copied byte for byte. The original is never touched and stays
# where it is; only the copy is scrubbed.
#
# A marker fault in the source refuses the copy: placeholders replace
# private data, never structural faults, so the marker is fixed in the run
# record first. A valid marker travels with its line, and the made-up data
# it marks is copied verbatim. There is no ruling: a trip is fixed, never
# overridden, and nothing is ever recorded in wiki/log.md.
#
# The destination must be under raw/ and must not exist: evidence is never
# overwritten. Symlinks and other non-regular files are refused, never
# followed, and a destination leading through a symlinked directory is
# refused too. Any scan that cannot finish refuses the copy; only a clean
# scan copies.
#
# A completed scrub prints one value-free line per replaced finding on
# stdout, as <dest>:<line>: <rule> scrubbed. A trip prints the scrub's
# suspect lines for the source instead, one per line as <path>:<line>:
# <kind>, never a value.
#
#   exit 0  copied, scrubbed where the scan found anything
#   exit 1  the scan tripped; nothing was copied
#   exit 2  usage, not a repository, the scan failed, the destination is
#           outside raw/ or already exists, or the source is unusable
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH= cd -P -- "$HERE/.." && pwd -P)
SCRUB=$ROOT/scripts/scrub-check.sh
USAGE="usage: raw-promote.sh <src> <dest> | --self-test | --help"

case ${1:-} in
  --help) echo "$USAGE" >&2; exit 0 ;;
esac

fail() { echo "raw-promote: $1" >&2; exit "${2:-2}"; }

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  # shellcheck disable=SC2064
  trap "rm -r -- \"$tmp\" </dev/null 2>/dev/null" EXIT
  fails=0
  # Hermetic logging: the gate runs self-tests with a detections log set,
  # and fixture findings must never land in it.
  export POSTMASTER_DETECTIONS_LOG=
  E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
  SUSPECT="contact-${E_LOCAL}@${E_HOST}.${E_TLD}"
  K_U='user'; K_E='Email'
  O_P1='or'; O_P2='g-'; O_B1='fictional413relay'; O_B2='K7mQ2xZ9'
  H_R='/ho'; H_O='me/'; H_U='fixture-user-413'
  I_A='10'; I_B='135'; I_C='4'; I_D='13'; DOT='.'
  T_P1='s'; T_P2='k-'; T_B1='fictional413key'; T_B2='K7mQ2xZ9aVbN4qy7'
  D_N1='SESSION'; D_N2='SECRET'; US='_'; D_V1='relay-413-'; D_V2='quiet'
  C_A='Co-Au'; C_B='thored-'; C_C='By: Imaginary Aide'
  ALLOW_P='private-data:allo'
  E2_L='a'; E2_H='b'; E2_T='co'

  repo() {  # a scratch repo, printed; the caller cds into it
    local d
    d=$(mktemp -d -p "$tmp") || return 1
    ( cd "$d" && git init -q -b main . ) || return 1
    printf '%s' "$d"
  }
  expect() {  # expect <want-exit> <label> <command...>
    local want=$1 label=$2 out code
    shift 2
    out=$("$@" 2>&1); code=$?
    if [ "$code" -eq "$want" ]; then printf '  ok   %s\n' "$label"
    else printf '  FAIL %s: wanted exit %s, got %s\n%s\n' "$label" "$want" "$code" "$out"; fails=$((fails+1)); fi
  }
  refused_clean() {  # refused_clean <repo> <dest>: nothing was copied there
    [ ! -e "$1/$2" ]
  }

  echo "scrub controls: a dirty copy completes scrubbed, never verbatim"
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > "$tmp/dirty.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/dirty.md" raw/trials/t413/notes.md 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ -f "$r/raw/trials/t413/notes.md" ]; } \
      && printf '  ok   a dirty file completes scrubbed\n' \
      || { printf '  FAIL a dirty file completes scrubbed: exit %s\n' "$code"; fails=$((fails+1)); }
    if grep -qF -- "$SUSPECT" "$r/raw/trials/t413/notes.md" 2>/dev/null; then
      printf '  FAIL the copy holds no value\n'; fails=$((fails+1))
    elif grep -qF '<redacted:email>' "$r/raw/trials/t413/notes.md" 2>/dev/null; then
      printf '  ok   the copy holds a placeholder naming its rule\n'
    else printf '  FAIL the copy holds a placeholder naming its rule\n'; fails=$((fails+1)); fi
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a scrub prints no value\n'; fails=$((fails+1))
    else printf '  ok   a scrub prints no value\n'; fi
    if printf '%s' "$out" | grep -qF 'raw/trials/t413/notes.md:1: email scrubbed'; then
      printf '  ok   a scrub reports its rule, file and line\n'
    else printf '  FAIL a scrub reports its rule, file and line\n'; fails=$((fails+1)); fi
    cmp -s "$tmp/dirty.md" <(printf 'Reach the relay at %s for pings.\n' "$SUSPECT") \
      && printf '  ok   the original is untouched\n' \
      || { printf '  FAIL the original is untouched\n'; fails=$((fails+1)); }
    [ ! -e "$r/wiki/log.md" ] \
      && printf '  ok   a scrub records no ruling\n' \
      || { printf '  FAIL a scrub records no ruling\n'; fails=$((fails+1)); }
    out2=$(bash "$ROOT/scripts/scrub-check.sh" --files "$r/raw/trials/t413/notes.md" 2>/dev/null); code2=$?
    { [ "$code2" -eq 0 ] && [ -z "$out2" ]; } \
      && printf '  ok   the copy checks clean again\n' \
      || { printf '  FAIL the copy checks clean again: exit %s\n' "$code2"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    TOKEN413="$T_P1$T_P2$T_B1$T_B2"
    printf 'mail %s then %s end\n' "$SUSPECT" "$TOKEN413" > "$tmp/twospan.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/twospan.md" raw/trials/t413/notes.md 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && grep -qF 'mail <redacted:email> then <redacted:token> end' "$r/raw/trials/t413/notes.md"; } \
      && printf '  ok   two spans on one line scrub independently\n' \
      || { printf '  FAIL two spans on one line scrub independently: exit %s\n' "$code"; fails=$((fails+1)); }
    if grep -qF -- "$SUSPECT" "$r/raw/trials/t413/notes.md" 2>/dev/null \
      || grep -qF -- "$TOKEN413" "$r/raw/trials/t413/notes.md" 2>/dev/null; then
      printf '  FAIL a multi-span scrub publishes no fragment\n'; fails=$((fails+1))
    else printf '  ok   a multi-span scrub publishes no fragment\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    JPATH=$(printf '/home/%s' fixture-user)
    printf '{"text": "first line\\n%s-413/notes.txt/x"}\n' "$JPATH" > "$tmp/jsonl.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/jsonl.md" raw/trials/t413/notes.md 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && grep -qF '<redacted:private-path>' "$r/raw/trials/t413/notes.md" 2>/dev/null; } \
      && printf '  ok   an escaped value in JSON scrubs through promotion\n' \
      || { printf '  FAIL an escaped value in JSON scrubs through promotion: exit %s\n' "$code"; fails=$((fails+1)); }
    if grep -qF -- "$JPATH-413" "$r/raw/trials/t413/notes.md" 2>/dev/null; then
      printf '  FAIL a JSON scrub publishes no value\n'; fails=$((fails+1))
    else printf '  ok   a JSON scrub publishes no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'contact: %s ok \xff tail\n' "$SUSPECT" > "$tmp/invalid.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/invalid.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && cmp -s "$r/raw/trials/t413/notes.md" <(printf 'contact: <redacted:email> ok \xff tail\n'); } \
      && printf '  ok   bytes outside the span survive the scrub\n' \
      || { printf '  FAIL bytes outside the span survive the scrub: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    python3 -c "
lines = ['public filler line %d with padding words to add bulk volume here' % i for i in range(400000)]
lines[200000] = 'contact: $SUSPECT'
open('$tmp/big.md', 'w').write('\n'.join(lines) + '\n')
"
    limited=$(bash -c "ulimit -v 65536 || exit 99; exec bash \"$HERE/raw-promote.sh\" \"$tmp/big.md\" raw/trials/t413/big.md" 2>&1); code=$?
    if [ "$code" -eq 99 ]; then
      printf '  ok   a large dirty file streams under a small address space: skipped, no address-space limit on this machine\n'
    else
      { [ "$code" -eq 0 ] && grep -qF '<redacted:email>' "$r/raw/trials/t413/big.md" 2>/dev/null; } \
        && printf '  ok   a large dirty file streams under a small address space\n' \
        || { printf '  FAIL a large dirty file streams under a small address space: exit %s\n' "$code"; fails=$((fails+1)); }
    fi
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > "$tmp/logged.md"
    rm -f "$tmp/pm.jsonl"
    out=$(POSTMASTER_DETECTIONS_LOG="$tmp/pm.jsonl" bash "$HERE/raw-promote.sh" "$tmp/logged.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a logged scrub completes\n' \
      || { printf '  FAIL a logged scrub completes: exit %s\n' "$code"; fails=$((fails+1)); }
    entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file").endswith("logged.md"), e[0].get("line"), repr(e[0].get("commit")))' "$tmp/pm.jsonl" 2>/dev/null)
    [ "$entry" = "1 email True 1 ''" ] \
      && printf '  ok   a scrubbed finding is logged once, under its source\n' \
      || { printf '  FAIL a scrubbed finding is logged once, under its source: %s\n' "$entry"; fails=$((fails+1)); }
    if grep -qF -- "$SUSPECT" "$tmp/pm.jsonl" 2>/dev/null; then
      printf '  FAIL a scrub log logs no value\n'; fails=$((fails+1))
    else printf '  ok   a scrub log logs no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    { printf '{"%s": "withheld"}\n' "$K_U$K_E"
      printf 'owner %s%s%s%s\n' "$O_P1" "$O_P2" "$O_B1" "$O_B2"
      printf 'Reach the relay at %s.\n' "$SUSPECT"
      printf 'source under %s%s%s/notes.txt\n' "$H_R" "$H_O" "$H_U"
      printf 'endpoint %s%s%s%s%s%s%s:8080\n' "$I_A" "$DOT" "$I_B" "$DOT" "$I_C" "$DOT" "$I_D"
      printf 'relay key %s%s%s%s\n' "$T_P1" "$T_P2" "$T_B1" "$T_B2"
      printf '%s%s%s=%s%s\n' "$D_N1" "$US" "$D_N2" "$D_V1" "$D_V2"
      printf '%s%s%s\n' "$C_A" "$C_B" "$C_C"
    } > "$tmp/all-rules.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/all-rules.md" raw/trials/t413/all.md 2>/dev/null); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   every rule scrubs in one file\n' \
      || { printf '  FAIL every rule scrubs in one file: exit %s\n' "$code"; fails=$((fails+1)); }
    missing=0
    for k in key account-id email private-path private-host token dotenv assistant-attribution; do
      grep -qF "<redacted:$k>" "$r/raw/trials/t413/all.md" 2>/dev/null || missing=1
    done
    [ "$missing" -eq 0 ] \
      && printf '  ok   every placeholder names its rule\n' \
      || { printf '  FAIL every placeholder names its rule\n'; fails=$((fails+1)); }
    out2=$(bash "$ROOT/scripts/scrub-check.sh" --files "$r/raw/trials/t413/all.md" 2>/dev/null); code2=$?
    { [ "$code2" -eq 0 ] && [ -z "$out2" ]; } \
      && printf '  ok   the scrubbed file checks clean again\n' \
      || { printf '  FAIL the scrubbed file checks clean again: exit %s\n' "$code2"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    { printf '{"%s": "write to %s@%s.%s soon"}\n' "$K_U$K_E" "$E2_L" "$E2_H" "$E2_T"
      printf '{"%s": "%s@%s.%s"}\n' "$K_U$K_E" "$E2_L" "$E2_H" "$E2_T"
    } > "$tmp/overlap.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/overlap.md" raw/trials/t413/overlap.md 2>/dev/null); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   overlapping findings complete\n' \
      || { printf '  FAIL overlapping findings complete: exit %s\n' "$code"; fails=$((fails+1)); }
    printf '{"%s": "<redacted:key>"}\n{"%s": "<redacted:email>"}\n' "$K_U$K_E" "$K_U$K_E" > "$tmp/overlap-want.md"
    cmp -s "$r/raw/trials/t413/overlap.md" "$tmp/overlap-want.md" \
      && printf '  ok   the outer finding wins, ties go to the first span\n' \
      || { printf '  FAIL the outer finding wins, ties go to the first span\n'; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/dirtytree/sub" && printf 'clean\n' > "$tmp/dirtytree/a.md"
    printf 'Reach the relay at %s.\n' "$SUSPECT" > "$tmp/dirtytree/sub/b.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/dirtytree" raw/trials/t413 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -f "$r/raw/trials/t413/a.md" ] \
      && grep -qF '<redacted:email>' "$r/raw/trials/t413/sub/b.md" 2>/dev/null; } \
      && printf '  ok   a dirty tree completes scrubbed whole\n' \
      || { printf '  FAIL a dirty tree completes scrubbed whole: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "marker controls: faults refuse, valid markers travel"
  r=$(repo) && { cd "$r" || exit 2
    printf 'ordinary  # %sw email -- nothing to suppress\n' "$ALLOW_P" > "$tmp/fault.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/fault.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && refused_clean "$r" raw/trials/t413/notes.md; } \
      && printf '  ok   a marker fault is refused with nothing copied\n' \
      || { printf '  FAIL a marker fault is refused with nothing copied: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qE ': marker$'; then printf '  ok   the refusal names the marker fault\n'
    else printf '  FAIL the refusal names the marker fault\n'; fails=$((fails+1)); fi
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s.  # %sw email -- made-up relay address\n' \
      "$SUSPECT" "$ALLOW_P" > "$tmp/marked.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/marked.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && grep -qF -- "$SUSPECT" "$r/raw/trials/t413/notes.md" 2>/dev/null; } \
      && printf '  ok   marked made-up data travels verbatim\n' \
      || { printf '  FAIL marked made-up data travels verbatim: exit %s\n' "$code"; fails=$((fails+1)); }
    out2=$(bash "$ROOT/scripts/scrub-check.sh" --files "$r/raw/trials/t413/notes.md" 2>/dev/null); code2=$?
    { [ "$code2" -eq 0 ] && [ -z "$out2" ]; } \
      && printf '  ok   the marked copy checks clean again\n' \
      || { printf '  FAIL the marked copy checks clean again: exit %s\n' "$code2"; fails=$((fails+1)); }
  }

  echo "negative controls: clean copies complete byte for byte"
  r=$(repo) && { cd "$r" || exit 2
    printf 'The relay ran its checks and stayed green.\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean file promotes silently\n' \
      || { printf '  FAIL a clean file promotes silently: exit %s\n' "$code"; fails=$((fails+1)); }
    cmp -s "$tmp/clean.md" "$r/raw/trials/t413/notes.md" \
      && printf '  ok   a promotion copies the content whole\n' \
      || { printf '  FAIL a promotion copies the content whole\n'; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/cleantree/sub" && printf 'a\n' > "$tmp/cleantree/a.md"
    printf 'b\n' > "$tmp/cleantree/sub/b.md"
    expect 0 "a clean tree promotes" bash "$HERE/raw-promote.sh" "$tmp/cleantree" raw/trials/t413
    { [ -f "$r/raw/trials/t413/a.md" ] && [ -f "$r/raw/trials/t413/sub/b.md" ]; } \
      && printf '  ok   a tree promotion keeps the shape\n' \
      || { printf '  FAIL a tree promotion keeps the shape\n'; fails=$((fails+1)); }
  }

  echo "recheck controls: the copy is checked again, and completes only when clean"
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$r/scripts"
    cat > "$r/scripts/scrub-check.sh" <<'FAKE'
#!/usr/bin/env bash
case $1 in
  --spans) echo "0:1:0:5:email" ;;
  --files) echo "staged.md:1: email"; exit 1 ;;
  --safe-path) shift; printf '%s\n' "$@" ;;
  *) exit 2 ;;
esac
FAKE
    chmod +x "$r/scripts/scrub-check.sh"
    cp "$HERE/raw-promote.sh" "$r/scripts/raw-promote.sh"
    printf 'clean\n' > "$tmp/recheck.md"
    out=$(bash "$r/scripts/raw-promote.sh" "$tmp/recheck.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && refused_clean "$r" raw/trials/t413/notes.md; } \
      && printf '  ok   a tripped recheck removes the copy and fails\n' \
      || { printf '  FAIL a tripped recheck removes the copy and fails: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$r/scripts"
    cat > "$r/scripts/scrub-check.sh" <<'FAKE2'
#!/usr/bin/env bash
case $1 in
  --spans) exit 0 ;;
  --files) echo "staged.md:1: email"; exit 1 ;;
  --safe-path) shift; printf '%s\n' "$@" ;;
  *) exit 2 ;;
esac
FAKE2
    chmod +x "$r/scripts/scrub-check.sh"
    cp "$HERE/raw-promote.sh" "$r/scripts/raw-promote.sh"
    printf 'clean\n' > "$tmp/recheck2.md"
    out=$(bash "$r/scripts/raw-promote.sh" "$tmp/recheck2.md" raw/trials/t413/notes2.md 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && refused_clean "$r" raw/trials/t413/notes2.md; } \
      && printf '  ok   a clean scan with a dirty recheck refuses the copy\n' \
      || { printf '  FAIL a clean scan with a dirty recheck refuses the copy: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "refusal controls: the destination and the source"
  r=$(repo) && { cd "$r" || exit 2
    printf 'clean\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" notes/elsewhere.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" notes/elsewhere.md; } \
      && printf '  ok   a destination outside raw/ is refused\n' \
      || { printf '  FAIL a destination outside raw/ is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/../notes/escape.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" notes/escape.md; } \
      && printf '  ok   a destination escaping raw/ is refused\n' \
      || { printf '  FAIL a destination escaping raw/ is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    mkdir -p "$r/raw/trials/t413"
    printf 'evidence\n' > "$r/raw/trials/t413/notes.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ "$(cat "$r/raw/trials/t413/notes.md")" = "evidence" ]; } \
      && printf '  ok   an existing destination is never overwritten\n' \
      || { printf '  FAIL an existing destination is never overwritten: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" "$tmp/no-such-file.md" raw/trials/t413/x.md 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a missing source is refused\n' \
      || { printf '  FAIL a missing source is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    mkdir -p "$tmp/linktree" && ln -s /etc/hostname "$tmp/linktree/link.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/linktree" raw/trials/t414 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" raw/trials/t414; } \
      && printf '  ok   a source carrying a symlink is refused\n' \
      || { printf '  FAIL a source carrying a symlink is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   no arguments is a usage error\n' \
      || { printf '  FAIL no arguments is a usage error: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" --ruled 'a ruling' "$tmp/clean.md" raw/trials/t413/x.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" raw/trials/t413/x.md; } \
      && printf '  ok   the removed ruling flag is a usage error\n' \
      || { printf '  FAIL the removed ruling flag is a usage error: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s.\n' "$SUSPECT" > "$tmp/shaped.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/shaped.md" "raw/trials/t413/$SUSPECT.md" 2>/dev/null); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a copy to a shaped name completes\n' \
      || { printf '  FAIL a copy to a shaped name completes: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT"; then
      printf '  FAIL a shaped destination is redacted in the report\n'; fails=$((fails+1))
    elif printf '%s' "$out" | grep -qF '[redacted]'; then
      printf '  ok   a shaped destination is redacted in the report\n'
    else printf '  FAIL a shaped destination is redacted in the report\n'; fails=$((fails+1)); fi
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'clean\n' > "$tmp/clean.md"
    printf 'x' > "$r/raw"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/not-a-dir/child.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ ! -e "$r/raw/not-a-dir/child.md" ]; } \
      && printf '  ok   a destination whose parent is a file fails\n' \
      || { printf '  FAIL a destination whose parent is a file fails: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/cpshim"
    printf '#!/bin/sh\neval "dest=\\${$#}"; printf partial > "$dest"; exit 1\n' > "$tmp/cpshim/cp"
    chmod +x "$tmp/cpshim/cp"
    printf 'clean\n' > "$tmp/clean.md"
    out=$(PATH="$tmp/cpshim:$PATH" bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" raw/trials/t413/notes.md; } \
      && printf '  ok   a failed copy removes its partial and fails\n' \
      || { printf '  FAIL a failed copy removes its partial and fails: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/nostub" && cp "$HERE/raw-promote.sh" "$tmp/nostub/"
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > "$tmp/dirty.md"
    out=$(bash "$tmp/nostub/raw-promote.sh" "$tmp/dirty.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" raw/trials/t413/notes.md; } \
      && printf '  ok   a missing scanner refuses the copy\n' \
      || { printf '  FAIL a missing scanner refuses the copy: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/outside" "$r/raw" && ln -s "$tmp/outside" "$r/raw/trials"
    printf 'clean\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/escape.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ -z "$(ls -A "$tmp/outside")" ]; } \
      && printf '  ok   a destination through a symlink is refused\n' \
      || { printf '  FAIL a destination through a symlink is refused: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/outside2" && ln -s "$tmp/outside2" "$r/raw"
    printf 'clean\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/x.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ -z "$(ls -A "$tmp/outside2")" ]; } \
      && printf '  ok   a symlinked raw is refused\n' \
      || { printf '  FAIL a symlinked raw is refused: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p src413 && printf 'all public words\n' > src413/a.txt
    mkdir -p "$tmp/findshim"
    printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/findshim/find"
    chmod +x "$tmp/findshim/find"
    out=$(PATH="$tmp/findshim:$PATH" bash "$HERE/raw-promote.sh" src413 raw/runs/f413 2>&1); code=$?
    { [ "$code" -eq 2 ] && [ ! -e "$r/raw/runs/f413" ]; } \
      && printf '  ok   a failed source enumeration refuses the copy\n' \
      || { printf '  FAIL a failed source enumeration refuses the copy: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p src413
    printf 'all public words\n' > "src413/$SUSPECT.txt"
    mkdir -p "$tmp/cpshim"
    printf '#!/usr/bin/env bash\nfor a in "$@"; do case $a in -*) continue;; *) rm -f "$a"; break;; esac; done\nexec /bin/cp "$@"\n' > "$tmp/cpshim/cp"
    chmod +x "$tmp/cpshim/cp"
    out=$(PATH="$tmp/cpshim:$PATH" bash "$HERE/raw-promote.sh" src413 raw/runs/c413 2>&1); code=$?
    { [ "$code" -eq 2 ] && ! printf '%s' "$out" | grep -qF -- "$SUSPECT"; } \
      && printf '  ok   a failed copy prints no shaped path\n' \
      || { printf '  FAIL a failed copy prints no shaped path: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

[ $# -eq 2 ] || { echo "$USAGE" >&2; exit 2; }
SRC=$1 DEST=$2

top=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not a git repository"
[ "$(CDPATH= cd -P -- "$top" && pwd -P)" = "$(pwd -P)" ] || fail "run from the repository root"
[ -x "$SCRUB" ] || fail "no scrub to check the copy with"

case $DEST in raw/?*) ;; *) fail "the destination must be under raw/" ;; esac
case $DEST in */../*|../*|*/..|..) fail "the destination must be under raw/" ;; esac
# A symlinked parent would carry the copy outside raw/ despite the lexical
# checks, so every leading component must be a real directory or nothing yet.
prefix=$DEST
while [ "$prefix" != raw ] && [ "$prefix" != . ] && [ "$prefix" != / ]; do
  [ -L "$prefix" ] && fail "the destination leads through a symlink"
  prefix=$(dirname -- "$prefix")
done
[ -L raw ] && fail "the destination leads through a symlink"
[ -e "$DEST" ] && fail "the destination already exists; evidence is never overwritten"
[ -e "$SRC" ] || fail "the source does not exist"

STAGE=$(mktemp -d) || fail "could not stage the scan"
cleanup() { rm -rf -- "$STAGE" 2>/dev/null; }
trap cleanup EXIT

SRC=${SRC%/}
if [ -d "$SRC" ] && [ ! -L "$SRC" ]; then
  odd=$(find "$SRC" -not -type f -not -type d -print -quit) || fail "the source could not be read"
  [ -n "$odd" ] && fail "the source carries a non-regular file; symlinks are refused"
  find "$SRC" -type f -print0 > "$STAGE/enum.unsorted" || fail "the source could not be read"
  LC_ALL=C sort -z -o "$STAGE/enum" "$STAGE/enum.unsorted" || fail "the source could not be read"
  mapfile -d '' -t FILES < "$STAGE/enum"
  IS_DIR=1
elif [ -f "$SRC" ] && [ ! -L "$SRC" ]; then
  FILES=("$SRC")
  IS_DIR=""
else
  fail "the source is neither a regular file nor a directory"
fi

dest_for() {  # dest_for <src-file>: where it lands
  if [ -n "$IS_DIR" ]; then printf '%s/%s' "$DEST" "${1#$SRC/}"; else printf '%s' "$DEST"; fi
}

redact() {  # redact <path>: the path with every shaped span removed
  safe=$(bash "$SCRUB" --safe-path "$1" 2>/dev/null) || fail "the scan could not finish"
  printf '%s' "$safe"
}

copy_file() {  # copy_file <src> <dest>: cp whose stderr never prints a value
  local err code
  err=$(cp -- "$1" "$2" 2>&1); code=$?
  if [ -n "$err" ]; then
    bash "$SCRUB" --safe-path "$err" >&2 || true
  fi
  return "$code"
}

# Every file is scanned before anything is copied: a trip refuses the whole
# operation with nothing copied. Spans are kept per file for the copy phase,
# so one finding is logged once.
i=0
for f in ${FILES[@]+"${FILES[@]}"}; do
  errf=$STAGE/err.$i; spanf=$STAGE/spans.$i
  printf '%s' "$f" > "$STAGE/file.$i"
  if ! out=$(bash "$SCRUB" --spans "$f" 2>"$errf"); then
    cat "$errf" >&2; fail "the scan could not finish"
  fi
  cat "$errf" >&2
  if [ -n "$out" ]; then printf '%s\n' "$out" > "$spanf"; else : > "$spanf"; fi
  i=$((i + 1))
done
N=$i

trip=0
i=0
while [ "$i" -lt "$N" ]; do
  f=$(cat "$STAGE/file.$i")
  if grep -q ':marker$' "$STAGE/spans.$i" 2>/dev/null; then
    safe=$(redact "$f")
    while IFS=: read -r _ line _ _ rule; do
      [ "$rule" = marker ] && [ -n "$line" ] && printf '%s:%s: marker\n' "$safe" "$line"
    done < "$STAGE/spans.$i"
    trip=1
  fi
  i=$((i + 1))
done
[ "$trip" -eq 0 ] || exit 1

# No marker faults: copy each file, scrubbing the dirty ones, and check each
# copy again. Every failure from here removes the destination again, so a
# failed promotion leaves nothing behind.
remove_copy() { rm -rf -- "$DEST" 2>/dev/null; }
REPORT=""
note() {
  if [ -z "$REPORT" ]; then REPORT=$1; else REPORT="$REPORT
$1"; fi
}
i=0
while [ "$i" -lt "$N" ]; do
  f=$(cat "$STAGE/file.$i")
  d=$(dest_for "$f")
  mkdir -p -- "$(dirname -- "$d")" || { remove_copy; fail "could not create the destination"; }
  if [ -s "$STAGE/spans.$i" ]; then
    if ! python3 - "$f" "$STAGE/scrubbed.$i" "$STAGE/spans.$i" <<'PY'; then
import sys
src, tmp, spans = sys.argv[1], sys.argv[2], sys.argv[3]
found = {}
for row in open(spans, encoding="utf-8").read().splitlines():
    parts = row.split(":")
    if len(parts) != 5:
        sys.exit("a span is index:line:start:end:rule")
    _index, line, start, end, rule = parts
    try:
        line, start, end = int(line), int(start), int(end)
    except ValueError:
        sys.exit("a span carries numbers")
    found.setdefault(line, []).append((start, end, rule))
# Per line, in two phases: decide keep-or-skip outer-first (start
# ascending, longest first, overlapped spans skipped), then apply
# right-to-left so earlier offsets hold while the line mutates.
for line, group in found.items():
    group.sort(key=lambda s: (s[0], -(s[1] - s[0])))
    kept, used = [], []
    for start, end, rule in group:
        if any(s < end and start < e for s, e in used):
            continue
        used.append((start, end))
        kept.append((start, end, rule))
    kept.sort(key=lambda s: -s[0])
    found[line] = kept
# Stream the file line by line, so memory is bounded by the longest line.
# surrogateescape round-trips undecodable bytes, so only the matched spans
# change. Lines split exactly as the scanner splits them, and each line's
# original terminator travels back untouched.
count = 0
with open(src, "rb") as handle, open(tmp, "wb") as out:
    for raw in handle:
        count += 1
        body, term = raw, b""
        if body.endswith(b"\n"):
            body, term = body[:-1], b"\n"
            if body.endswith(b"\r"):
                body, term = body[:-1], b"\r\n"
        text = body.decode("utf-8", errors="surrogateescape")
        for start, end, rule in found.get(count, []):
            if not (0 <= start <= end <= len(text)):
                sys.exit("a span outside its line")
            text = text[:start] + "<redacted:%s>" % rule + text[end:]
        out.write(text.encode("utf-8", errors="surrogateescape") + term)
for line in found:
    if line < 1 or line > count:
        sys.exit("a span outside its line")
PY
      remove_copy; fail "the scrub could not finish"
    fi
    copy_file "$STAGE/scrubbed.$i" "$d" || { remove_copy; fail "the copy failed"; }
  else
    copy_file "$f" "$d" || { remove_copy; fail "the copy failed"; }
  fi
  # The recheck covers both paths: a file clean at scan time may have
  # changed before its copy landed.
  rerr=$STAGE/recheck-err.$i
  rout=$(bash "$SCRUB" --files "$d" 2>"$rerr"); rcode=$?
  cat "$rerr" >&2
  case $rcode in
    0) ;;
    1) printf '%s\n' "$rout"; remove_copy; exit 1 ;;
    *) remove_copy; fail "the scan could not finish" ;;
  esac
  if [ -s "$STAGE/spans.$i" ]; then
    safe=$(redact "$d")
    while IFS=: read -r _ line _ _ rule; do
      [ -n "$line" ] && [ -n "$rule" ] && note "$safe:$line: $rule scrubbed"
    done < "$STAGE/spans.$i"
  fi
  i=$((i + 1))
done

# Empty directories travel like cp -r carries them.
if [ -n "$IS_DIR" ]; then
  find "$SRC" -type d -print0 > "$STAGE/enumdirs" || { remove_copy; fail "the source could not be read"; }
  while IFS= read -r -d '' dir; do
    rel=${dir#$SRC/}
    [ "$rel" = "$dir" ] && continue
    mkdir -p -- "$DEST/$rel" || { remove_copy; fail "could not create the destination"; }
  done < "$STAGE/enumdirs"
fi

[ -n "$REPORT" ] && printf '%s\n' "$REPORT"
exit 0
