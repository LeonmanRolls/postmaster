#!/usr/bin/env bash
# Blind acceptance oracle for #216: the private-data check in TypeScript.
#
# Written from the ticket's agents' checks (C1-C29) before any lane's diff
# existed. It runs from the repository root of the implementation under
# test: `bash oracle-216.sh`. Exit 0 when every check passes, 1 otherwise.
# A SKIP marks a control the machine cannot run (named with its reason).
#
# No committed line below holds a whole test value: every value is
# assembled from fragments at run time, so this file scans clean itself.
# Interface readings this oracle pins (all from the ticket's own words):
# - one suspect per place; a line listing keeps one rule per place.
# - a key's header alone flags, and every line of a key block flags; a
#   bare base64 line outside any block is asserted nothing about.
# - the held-out comparison counts a line when any rule outside the
#   secret, marker, encrypted-reasoning and private-context rules fires.
# - content inside an OSC sequence is asserted nothing about.
set -uo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SCRUB="$ROOT/scripts/scrub-check.sh"
REWRITE="$ROOT/scripts/scrub-rewrite.sh"
PROMOTE="$ROOT/scripts/raw-promote.sh"
TREE="$ROOT/scripts/tree-check.sh"
VERIFY_MERGE="$ROOT/scripts/verify-merge.sh"
STATUS="$ROOT/scripts/runs-status.sh"
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
BASE_REF="${ORACLE_BASE:-}"

PASS=0
FAIL=0
SKIP=0
FAILED=""

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); FAILED="$FAILED $1"; printf '  FAIL %s\n%s\n' "$1" "$2"; }
skip() { SKIP=$((SKIP + 1)); printf '  SKIP %s: %s\n' "$1" "$2"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# The oracle stays in $ROOT: file forms take absolute paths, and the ticket
# never asks them to work outside a repository.

# --- Fragment-built values: no committed line holds a whole one. ---
# Pieces join through J, never by adjacency: quote-adjacent pieces would
# read as one value to a check that splices decoded strings back in.
J() { printf '%s' "$@"; }
U1=$(J "cla" "ra")
MAIL1=$(J "$U1.dup" "ont@fr" "ee.fr")
MAIL2=$(J "mar" "ia.gar" "cia@fr" "ee.fr")
RESERVED=$(J "examp" "le.com")
NEG_MAIL=$(J "dep" "loy@$RESERVED")
PHONE1=$(J "+44 770" "0 900" "843")
PEM_HEAD=$(J "-----BEGIN PRIVATE K" "EY-----")
PEM_BODY=$(J "MIIEvQIBADANBgkqhkiG9w0" "BAQEFAASCBKkwggSl")
PEM_END=$(J "-----END PRIVATE K" "EY-----")
TOK_GHP=$(J "gh" "p_" "AbCdEfGhIjKlMnOpQrStUvWxYz1234")
TOK_SK=$(J "sk" "-" "AbCdEfGhIjKlMnOpQrStUvWxYz1234")
TOK_BEARER=$(J "Bea" "rer " "AbCdEfGhIjKlMnOpQrStUvWxYz1234")
TOK_AKIA=$(J "AK" "IA" "ABCDEFGH12345678")
TOK_ASIA=$(J "AS" "IA" "ABCDEFGH12345678")
SECRET_FIELD_VAL=$(J "z8Qm2xR4" "vT7wN9pL1sK5jH3dF6g")
HOME_USER="$U1"
HOME_PATH=$(J "/ho" "me/$HOME_USER/no" "tes.txt")
SSH_ONE=$(J "dep" "loy@we" "b01")
SSH_INTERNAL=$(J "b" "@fileser" "ver.inte" "rnal")
SSH_TS=$(J "a" "na@devb" "ox.tail1" "23.ts.n" "et")
IPV4_A=$(J "10.2" "0.30.40")
IPV6_A=$(J "fd12:" "3456:" ":1")
OPAQUE_SESS=$(J "se" "ss_a" "bc123")
UUID_A=$(J "123e4567-e89b-" "12d3-a456-426614174000")
TRAILER_PREFIX=$(J "Co-Auth" "ored-By:")
TRAILER_ASST=$(J "$TRAILER_PREFIX Clau" "de Op" "us")
TRAILER_PERSON=$(J "$TRAILER_PREFIX Mar" "ia Gar" "cia <$MAIL2>")
FOOTER_MADE=$(J "genera" "ted-with: Imagina" "ryAide")
FOOTER_VENDOR=$(J "Genera" "ted with Cla" "ude")
MK_ALLOW=$(J "private-data:all" "ow")
MK_NEXT=$(J "private-data:allow-next-li" "ne")
ENV_HOME=$(J "process.env.HO" "ME")
TRIAL_NEG=$(J "open raw/trials/demo/ho" "me/note.txt")
PH_USER_PATH=$(J "/ho" "me/us" "er/not" "es.txt")
KEY_NAME=$(J "session_con" "text")
KEY_VAL=$(J "fixture-sess" "ion-413")
AC1=$(J "Jos" "é Gar" "cía")
ENC1=$(J "enc" "rypted-payl" "oad-one-aaaa1111")
ENC2=$(J "enc" "rypted-payl" "oad-two-bbbb2222")
ENC3=$(J "enc" "rypted-payl" "oad-three-cccc3333")

mk_repo() { # mk_repo <dir>: a scratch repo with user set and one clean commit
  mkdir -p "$1" && cd "$1" || return 1
  git init -q -b main .
  git config user.name "Oracle"
  git config user.email "oracle@$RESERVED"
  git commit -q --allow-empty -m "root"
  cd "$ROOT" || return 1
}

# --- C1: TypeScript run by Bun, no Python. ---
echo "C1: typescript, no python"
if ls "$ROOT/scripts/scrub-check.ts" "$ROOT/scripts/scrub-rewrite.ts" \
  "$ROOT/scripts/raw-promote.ts" "$ROOT/scripts/tree-check.ts" \
  "$ROOT/scripts/verify-merge.ts" >/dev/null 2>&1; then
  ok "the five scripts exist as TypeScript"
else
  bad "the five scripts exist as TypeScript" "missing .ts beside the wrappers"
fi
NEW10="$ROOT/scripts/scrub-check.ts $ROOT/scripts/scrub-check.sh $ROOT/scripts/scrub-rewrite.ts $ROOT/scripts/scrub-rewrite.sh $ROOT/scripts/raw-promote.ts $ROOT/scripts/raw-promote.sh $ROOT/scripts/tree-check.ts $ROOT/scripts/tree-check.sh $ROOT/scripts/verify-merge.ts $ROOT/scripts/verify-merge.sh"
# shellcheck disable=SC2086
if grep -il python $NEW10 2>/dev/null | grep -q .; then
  # shellcheck disable=SC2086
  bad "no python in the new scripts" "$(grep -il python $NEW10 2>/dev/null)"
else
  ok "no python in the new scripts"
fi
WRAP_OK=1
for s in scrub-check scrub-rewrite raw-promote tree-check verify-merge; do
  if ! diff <(sed "s/host/$s/g" "$ROOT/scripts/host.sh") "$ROOT/scripts/$s.sh" >/dev/null 2>&1; then
    WRAP_OK=0
  fi
done
if [ "$WRAP_OK" -eq 1 ]; then ok "wrappers copy the host form"; else bad "wrappers copy the host form" "a wrapper differs from host.sh but for the name"; fi
MPATH="$TMP/minpath"
mkdir -p "$MPATH"
for t in bun git sh bash env dirname; do
  p=$(command -v "$t") && ln -sf "$p" "$MPATH/$t"
done
if command -v python3 >/dev/null 2>&1 && [ -e "$MPATH/python3" ]; then
  bad "minimal PATH lacks python" "python3 resolves on the minimal PATH"
else
  ok "minimal PATH lacks python"
fi
mk_repo "$TMP/c1r"
(cd "$TMP/c1r" && echo "clean" > a.txt && git add -A && git commit -qm "clean") || true
if (cd "$TMP/c1r" && PATH="$MPATH" "$SCRUB" HEAD~1 HEAD >/dev/null 2>&1); then
  ok "range scan runs with only Bun, git and a shell on PATH"
else
  bad "range scan runs with only Bun, git and a shell on PATH" "exit $?"
fi

# --- C2: the range scan's cases. ---
echo "C2: range cases"
mk_repo "$TMP/c2r"
C2="$TMP/c2r"
(cd "$C2" && echo "contact $MAIL1" > addr.txt && git add -A && git commit -qm "add address"
  C2_DEL_BASE=$(git rev-parse HEAD)
  echo "gone" > addr.txt && git add -A && git commit -qm "drop address"
  echo "clean" > "reach-$MAIL1.txt" && git add -A && git commit -qm "file named with one"
  : > "empty-$MAIL2.txt" && git add -A && git commit -qm "empty file so named"
  echo "clean" > m.txt && git add -A && git commit -qm "write to $MAIL1 soon"
  echo "clean" > au.txt && git add -A && git commit --author="Tester <$MAIL1>" -qm "author case"
  echo "clean" > co.txt && git add -A
  git -c user.name="Tester" -c "$(J "user.em" "ail=$MAIL1")" commit --author="Oracle <oracle@$RESERVED>" -qm "committer case"
  git checkout -qb side HEAD~4 && echo "side" > side.txt && git add -A && git commit -qm "side work"
  git checkout -q main 2>/dev/null || git checkout -q master
  git merge -q --no-commit side >/dev/null 2>&1 || true
  echo "call $PHONE1" >> m.txt && git add -A && git commit -qm "merge side") || bad "C2 fixture" "fixture setup failed"
C2_ROOT=$(git -C "$C2" rev-list --max-parents=0 HEAD | head -1)
C2_HEAD=$(git -C "$C2" rev-parse HEAD)
C2_OUT=$(cd "$C2" && "$SCRUB" "$C2_ROOT" "$C2_HEAD" 2>"$TMP/c2.err") && C2_CODE=$? || C2_CODE=$?
C2_LINES=$(printf '%s' "$C2_OUT" | grep -c . || true)
if [ "$C2_CODE" -eq 1 ] && [ "$C2_LINES" -eq 7 ]; then
  ok "one line per case, exit 1"
else
  bad "one line per case, exit 1" "exit $C2_CODE, $C2_LINES lines: $C2_OUT"
fi
for want in "(message)" "(author)" "(committer)" ":0:"; do
  if printf '%s' "$C2_OUT" | grep -qF "$want"; then ok "range names $want"; else bad "range names $want" "$C2_OUT"; fi
done

# --- C3: transcripts read as seen. ---
echo "C3: transcript decoding"
ESC=$(printf '\033')
C3D="$TMP/c3"
mkdir -p "$C3D"
{
  printf '{"msg": "reach %s[31m%s%s[0m soon"}\n' "$ESC" "$MAIL1" "$ESC"
  L1="$MAIL1"
  printf '{"a": "%s"}\n' "$L1"
  LVL="$MAIL2"
  printf '{"a": "{\\"b\\": \\"%s\\"}"}\n' "$LVL"
  LVL2="$MAIL1"
  printf '{"a": "{\\"b\\": "{\\"c\\": \\"%s\\"}"}"}\n' "$LVL2"
  LVL3="$MAIL2"
  printf '{"a": "{\\"b\\": "{\\"c\\": "{\\"d\\": \\"%s\\"}"}"}"}\n' "$LVL3"
  printf '{"a": "{\\"b\\": "%s' "$MAIL1"
} > "$C3D/session.jsonl"
bun -e 'const fs=require("fs");const t="contact "+process.argv[1];fs.writeFileSync(process.argv[2],"\ufeff"+t,"utf16le")' "$MAIL2" "$C3D/uni.txt"
C3_OUT=$("$SCRUB" --files "$C3D/session.jsonl" "$C3D/uni.txt" 2>"$TMP/c3.err") && C3_CODE=$? || C3_CODE=$?
C3_LINES=$(printf '%s' "$C3_OUT" | grep -c . || true)
if [ "$C3_CODE" -eq 1 ] && [ "$C3_LINES" -eq 7 ]; then
  ok "one line per hidden value, exit 1"
else
  bad "one line per hidden value, exit 1" "exit $C3_CODE, $C3_LINES lines: $C3_OUT"
fi
for d in 1 2 3 4; do
  if printf '%s' "$C3_OUT" | grep -q "session.jsonl:$((d + 1)):"; then ok "depth $d decoded"; else bad "depth $d decoded" "$C3_OUT"; fi
done
if printf '%s' "$C3_OUT" | grep -q "session.jsonl:6:"; then ok "cut-off last record decoded"; else bad "cut-off last record decoded" "$C3_OUT"; fi
if printf '%s' "$C3_OUT" | grep -q "uni.txt:1:"; then ok "UTF-16 by its mark"; else bad "UTF-16 by its mark" "$C3_OUT"; fi

# --- C4: secrets as the first version. ---
echo "C4: secrets"
C4D="$TMP/c4"
mkdir -p "$C4D"
printf '%s\n' "$PEM_HEAD" > "$C4D/only-head.pem"
printf 'note "%s" here\n' "$TOK_GHP" > "$C4D/prefix.txt"
printf 'auth %s\n' "$TOK_BEARER" > "$C4D/bearer.txt"
printf 'id %s\n' "$TOK_AKIA" > "$C4D/aws.txt"
printf 'id %s\n' "$TOK_ASIA" > "$C4D/awsasia.txt"
printf 'api_key: %s\n' "$SECRET_FIELD_VAL" > "$C4D/field.txt"
printf 'export API_TOKEN=%s\n' "$SECRET_FIELD_VAL" > "$C4D/app.env"
{
  printf '%s\n' "$PEM_HEAD"
  printf '%s\n' "$PEM_BODY"
  printf '%s\n' "$PEM_END"
} > "$C4D/block.pem"
C4_OUT=$("$SCRUB" --files "$C4D/only-head.pem" "$C4D/prefix.txt" "$C4D/bearer.txt" "$C4D/aws.txt" "$C4D/awsasia.txt" "$C4D/field.txt" "$C4D/app.env" "$C4D/block.pem" 2>"$TMP/c4.err") && C4_CODE=$? || C4_CODE=$?
for f in only-head.pem prefix.txt bearer.txt aws.txt awsasia.txt field.txt; do
  if printf '%s' "$C4_OUT" | grep -q "$f:1: token"; then ok "$f found as token"; else bad "$f found as token" "$C4_OUT"; fi
done
if printf '%s' "$C4_OUT" | grep -qE "app.env:1: (dotenv|token)"; then ok "app.env found as dotenv"; else bad "app.env found as dotenv" "$C4_OUT"; fi
for ln in 1 2 3; do
  if printf '%s' "$C4_OUT" | grep -q "block.pem:$ln: token"; then ok "key block line $ln flags"; else bad "key block line $ln flags" "$C4_OUT"; fi
done
mk_repo "$TMP/c4r"
(cd "$TMP/c4r" && printf '%s\n%s\n%s\n' "$PEM_HEAD" "AAAAAAAAAAAAAAAAAAAA" "$PEM_END" > k.pem && git add -A && git commit -qm "key"
  printf '%s\n%s\n%s\n' "$PEM_HEAD" "$PEM_BODY" "$PEM_END" > k.pem && git add -A && git commit -qm "rotate body") || bad "C4 fixture" "fixture setup failed"
C4R_OUT=$(cd "$TMP/c4r" && "$SCRUB" HEAD~1 HEAD 2>/dev/null) && C4R_CODE=$? || C4R_CODE=$?
if [ "$C4R_CODE" -eq 1 ] && printf '%s' "$C4R_OUT" | grep -q "k.pem:2: token"; then
  ok "a commit changing only a body line is found"
else
  bad "a commit changing only a body line is found" "exit $C4R_CODE: $C4R_OUT"
fi

# --- C5: personal data by patterns alone. ---
echo "C5: personal data"
C5D="$TMP/c5"
mkdir -p "$C5D"
bun -e '
const fs = require("fs");
const kinds = ["person", "email", "phone", "postal-address", "other-personal"];
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const seen = new Set();
for (const row of rows) {
  if (kinds.includes(row.label) && !seen.has(row.label)) {
    seen.add(row.label);
    fs.writeFileSync(process.argv[2] + "/" + row.label + ".txt", row.parts.join("") + "\n");
  }
}' "$ROOT/raw/trials/pii-patterns/results/heldout/lines.json" "$C5D"
for k in person email phone postal-address other-personal; do
  if [ -f "$C5D/$k.txt" ]; then
    "$SCRUB" --files "$C5D/$k.txt" >/dev/null 2>&1; KCODE=$?
    if [ "$KCODE" -eq 1 ]; then
      ok "kind $k found"
    else
      bad "kind $k found" "exit $KCODE on a held-out $k line"
    fi
  else
    bad "kind $k found" "no held-out $k line"
  fi
done
printf 'Signed-off-by: %s\n' "$AC1" > "$C5D/accent.txt"
AC_OUT=$("$SCRUB" --files "$C5D/accent.txt" 2>/dev/null) && AC_CODE=$? || AC_CODE=$?
if [ "$AC_CODE" -eq 1 ] && printf '%s' "$AC_OUT" | grep -q "accent.txt:1: "; then
  ok "accented names found"
else
  bad "accented names found" "exit $AC_CODE: $AC_OUT"
fi
if grep -rniE "fetch[[:space:]]*\(|node:https?|chat/completions|openrouter|api\.anthropic|generativelanguage|WebSocket" \
  "$ROOT/scripts/scrub-check.ts" "$ROOT/scripts/scrub-rewrite.ts" "$ROOT/scripts/raw-promote.ts" \
  "$ROOT/scripts/tree-check.ts" "$ROOT/scripts/verify-merge.ts" 2>/dev/null | grep -q .; then
  bad "no network or model calls" "$(grep -rniE "fetch[[:space:]]*\(|node:https?|chat/completions|openrouter" "$ROOT"/scripts/scrub-check.ts "$ROOT"/scripts/scrub-rewrite.ts "$ROOT"/scripts/raw-promote.ts "$ROOT"/scripts/tree-check.ts "$ROOT"/scripts/verify-merge.ts 2>/dev/null | head -3)"
else
  ok "no network or model calls"
fi
if unshare -rn true 2>/dev/null; then
  ON_OUT=$("$SCRUB" --files "$C5D/email.txt" 2>/dev/null); ON_CODE=$?
  OFF_OUT=$(unshare -rn "$SCRUB" --files "$C5D/email.txt" 2>/dev/null); OFF_CODE=$?
  if [ "$ON_CODE" -eq "$OFF_CODE" ] && [ "$ON_OUT" = "$OFF_OUT" ]; then
    ok "same output with networking cut off"
  else
    bad "same output with networking cut off" "online ($ON_CODE) vs offline ($OFF_CODE)"
  fi
else
  skip "same output with networking cut off" "unshare cannot cut networking here"
fi

# --- C6: the held-out comparison. ---
echo "C6: held-out sets"
score_set() { # score_set <lines.json> <workdir>: prints "found raised pii none"
  bun -e '
const fs = require("fs");
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const lines = rows.map((r) => r.parts.join(""));
fs.writeFileSync(process.argv[2] + "/joined.txt", lines.join("\n") + "\n");
fs.writeFileSync(process.argv[2] + "/labels.txt", rows.map((r) => r.label).join("\n") + "\n");' "$1" "$2"
  "$SCRUB" --files "$2/joined.txt" 2>/dev/null | sed 's/^.*joined.txt://; s/: / /' > "$2/hits.txt" || true
  bun -e '
const fs = require("fs");
const labels = fs.readFileSync(process.argv[1] + "/labels.txt", "utf8").trim().split("\n");
const skip = new Set(["token", "dotenv", "marker", "encrypted-reasoning", "private-path", "private-host", "account-id", "key", "assistant-attribution"]);
const hit = new Map();
let raw = "";
try { raw = fs.readFileSync(process.argv[1] + "/hits.txt", "utf8"); } catch {}
for (const row of raw.trim().split("\n")) {
  if (!row.trim()) continue;
  const m = /^(\d+) (\S+)\s*$/.exec(row.trim());
  if (!m || skip.has(m[2])) continue;
  hit.set(Number(m[1]), true);
}
let found = 0, raised = 0, pii = 0, none = 0;
labels.forEach((label, i) => {
  const n = i + 1;
  if (label === "none") { none++; if (hit.get(n)) raised++; }
  else { pii++; if (hit.get(n)) found++; }
});
console.log(found + " " + raised + " " + pii + " " + none);' "$2"
}
mkdir -p "$TMP/c6a" "$TMP/c6b"
JL1=$(bun -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(r.length+" "+r.filter((x)=>x.parts.join("").includes("\n")).length)' "$ROOT/raw/trials/pii-patterns/results/heldout/lines.json")
JL2=$(bun -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(r.length+" "+r.filter((x)=>x.parts.join("").includes("\n")).length)' "$ROOT/raw/trials/pii-patterns/results/heldout2/lines.json")
printf '  info heldout rows/multi-line: %s; heldout2 rows/multi-line: %s\n' "$JL1" "$JL2"
read -r F1 R1 P1 N1 <<EOF
$(score_set "$ROOT/raw/trials/pii-patterns/results/heldout/lines.json" "$TMP/c6a")
EOF
read -r F2 R2 P2 N2 <<EOF
$(score_set "$ROOT/raw/trials/pii-patterns/results/heldout2/lines.json" "$TMP/c6b")
EOF
printf '  info set1 found %s/%s raised %s/%s; set2 found %s/%s raised %s/%s\n' "$F1" "$P1" "$R1" "$N1" "$F2" "$P2" "$R2" "$N2"
if [ "$P1" -eq 33 ] && [ "$N1" -eq 27 ]; then ok "set 1 shape 33/27"; else bad "set 1 shape 33/27" "got $P1/$N1"; fi
if [ "$P2" -eq 37 ] && [ "$N2" -eq 23 ]; then ok "set 2 shape 37/23"; else bad "set 2 shape 37/23" "got $P2/$N2"; fi
if [ "$F1" -ge 33 ] && [ "$R1" -le 3 ]; then ok "set 1 meets version 2"; else bad "set 1 meets version 2" "found $F1 raised $R1"; fi
if [ "$F2" -ge 25 ] && [ "$R2" -le 4 ]; then ok "set 2 meets version 2"; else bad "set 2 meets version 2" "found $F2 raised $R2"; fi

# --- C7: private context. ---
echo "C7: private context"
C7D="$TMP/c7"
mkdir -p "$C7D"
printf 'open %s\n' "$HOME_PATH" > "$C7D/path.txt"
printf 'run ssh %s uptime\n' "$SSH_ONE" > "$C7D/ssh1.txt"
printf 'run scp %s %s:/srv\n' build "$SSH_INTERNAL" > "$C7D/ssh2.txt"
printf 'run ssh %s uptime\n' "$SSH_TS" > "$C7D/ssh3.txt"
printf 'peer %s\n' "$IPV4_A" > "$C7D/ip4.txt"
printf 'peer %s\n' "$IPV6_A" > "$C7D/ip6.txt"
printf 'session %s here\n' "$OPAQUE_SESS" > "$C7D/opaque.txt"
printf '{"session_id": "%s"}\n' "$UUID_A" > "$C7D/sessfield.txt"
printf 'account uuid %s\n' "$UUID_A" > "$C7D/acctuuid.txt"
printf '%s\n' "$TRAILER_ASST" > "$C7D/trailer.txt"
printf '%s\n' "$FOOTER_MADE" > "$C7D/footer.txt"
printf '%s\n' "$FOOTER_VENDOR" > "$C7D/footer2.txt"
printf '%s\n' "$TRAILER_PERSON" > "$C7D/person-trailer.txt"
C7_OUT=$("$SCRUB" --files "$C7D"/path.txt "$C7D"/ssh1.txt "$C7D"/ssh2.txt "$C7D"/ssh3.txt "$C7D"/ip4.txt "$C7D"/ip6.txt "$C7D"/opaque.txt "$C7D"/sessfield.txt "$C7D"/acctuuid.txt "$C7D"/trailer.txt "$C7D"/footer.txt "$C7D"/footer2.txt "$C7D"/person-trailer.txt 2>"$TMP/c7.err") && C7_CODE=$? || C7_CODE=$?
[ "$C7_CODE" -eq 1 ] && ok "private context exits 1" || bad "private context exits 1" "exit $C7_CODE"
for pair in "path.txt:1: private-path" "ssh1.txt:1: private-host" "ssh2.txt:1: private-host" "ssh3.txt:1: private-host" "ip4.txt:1: private-host" "ip6.txt:1: private-host" "opaque.txt:1: account-id" "sessfield.txt:1: account-id" "acctuuid.txt:1: account-id" "trailer.txt:1: assistant-attribution" "footer.txt:1: assistant-attribution" "footer2.txt:1: assistant-attribution"; do
  if printf '%s' "$C7_OUT" | grep -qF "$pair"; then ok "$pair"; else bad "$pair" "$C7_OUT"; fi
done
if printf '%s' "$C7_OUT" | grep -q "ssh1.txt:1: email"; then bad "machine addresses never email" "$C7_OUT"; else ok "machine addresses never email"; fi
if printf '%s' "$C7_OUT" | grep -q "person-trailer.txt:1: assistant-attribution"; then
  bad "a person's trailer is personal data" "$C7_OUT"
elif printf '%s' "$C7_OUT" | grep -q "person-trailer.txt:1: "; then
  ok "a person's trailer is personal data"
else
  bad "a person's trailer is personal data" "no finding: $C7_OUT"
fi
C7N="$TMP/c7neg"
mkdir -p "$C7N"
printf 'const h = %s;\n' "$ENV_HOME" > "$C7N/env.ts"
printf 'const p = join(%s ?? "", "notes.txt");\n' "$ENV_HOME" > "$C7N/join.ts"
printf 'const sid = row.session_id;\n' > "$C7N/field.ts"
printf '%s\n' "$TRIAL_NEG" > "$C7N/trial.txt"
printf 'open %s\n' "$PH_USER_PATH" > "$C7N/phuser.txt"
printf 'run ssh %s uptime\n' "$NEG_MAIL" > "$C7N/phhost.txt"
C7N_OUT=$("$SCRUB" --files "$C7N"/env.ts "$C7N"/join.ts "$C7N"/field.ts "$C7N"/trial.txt "$C7N"/phuser.txt "$C7N"/phhost.txt 2>"$TMP/c7neg.err") && C7N_CODE=$? || C7N_CODE=$?
if [ "$C7N_CODE" -eq 0 ] && [ -z "$C7N_OUT" ]; then
  ok "code that only reads or names is clean"
else
  bad "code that only reads or names is clean" "exit $C7N_CODE: $C7N_OUT"
fi

# --- C8: the history census. ---
echo "C8: census"
C8_BASE="$BASE_REF"
if [ -z "$C8_BASE" ]; then
  if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then C8_BASE="origin/main"; else C8_BASE="HEAD"; fi
fi
C8_OUT=$(cd "$ROOT" && "$SCRUB" "$EMPTY_TREE" "$C8_BASE" 2>"$TMP/c8.err") && C8_CODE=$? || C8_CODE=$?
C8_LINES=$(printf '%s' "$C8_OUT" | grep -c . || true)
printf '  info census to %s: %s lines, exit %s\n' "$C8_BASE" "$C8_LINES" "$C8_CODE"
if { [ "$C8_CODE" -eq 0 ] || [ "$C8_CODE" -eq 1 ]; } && [ "$C8_LINES" -le 50 ]; then ok "at most 50 suspects"; else bad "at most 50 suspects" "exit $C8_CODE, $C8_LINES lines"; fi
mk_repo "$TMP/c8r"
(cd "$TMP/c8r" && echo "clean" > a.txt && git add -A && git commit -qm "clean") || true
C8_CLEAN=$(cd "$TMP/c8r" && POSTMASTER_DETECTIONS_LOG= "$SCRUB" HEAD~1 HEAD 2>/dev/null) && C8_CLEAN_CODE=$? || C8_CLEAN_CODE=$?
if [ "$C8_CLEAN_CODE" -eq 0 ] && [ -z "$C8_CLEAN" ]; then ok "clean control 0"; else bad "clean control 0" "exit $C8_CLEAN_CODE: $C8_CLEAN"; fi
(cd "$TMP/c8r" && echo "contact $MAIL1" > b.txt && git add -A && git commit -qm "planted") || true
C8_PLANT=$(cd "$TMP/c8r" && "$SCRUB" HEAD~1 HEAD 2>/dev/null) && C8_PLANT_CODE=$? || C8_PLANT_CODE=$?
if [ "$C8_PLANT_CODE" -eq 1 ] && [ -n "$C8_PLANT" ]; then ok "planted control at least 1"; else bad "planted control at least 1" "exit $C8_PLANT_CODE"; fi

# --- C9: the gate fails like lint. ---
echo "C9: gate failure"
C9D="$TMP/c9clone"
git clone -q "$ROOT" "$C9D" 2>/dev/null || bad "C9 clone" "clone failed"
C9_BASE="$BASE_REF"
if [ -z "$C9_BASE" ]; then
  if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then C9_BASE=$(git -C "$ROOT" rev-parse origin/main); else C9_BASE=$(git -C "$ROOT" rev-parse HEAD); fi
fi
(cd "$C9D" && git update-ref refs/remotes/origin/main "$C9_BASE" && git config user.name "Oracle" && git config user.email "oracle@$RESERVED" \
  && printf 'contact %s\n' "$MAIL1" > notes.txt && git add notes.txt && git commit -qm "planted note") || bad "C9 fixture" "fixture setup failed"
C9_OUT=$(cd "$C9D" && bun run check 2>&1) && C9_CODE=$? || C9_CODE=$?
if [ "$C9_CODE" -ne 0 ] && printf '%s' "$C9_OUT" | grep -q ":notes.txt:1: email"; then
  ok "gate fails naming rule and place"
else
  bad "gate fails naming rule and place" "exit $C9_CODE: $(printf '%s' "$C9_OUT" | tail -5)"
fi

# --- C10: no value shown. ---
echo "C10: values hidden"
if printf '%s' "$C2_OUT" | grep -qF "$MAIL1"; then bad "C2 output hides values" "$C2_OUT"; else ok "C2 output hides values"; fi
if printf '%s' "$C9_OUT" | grep -qF "$MAIL1"; then bad "C9 output hides values" "value shown"; else ok "C9 output hides values"; fi
SAFE_OUT=$(cd "$ROOT" && "$SCRUB" --safe-path "$TMP/reach-$MAIL1.txt" 2>/dev/null) && SAFE_CODE=$? || SAFE_CODE=$?
if [ "$SAFE_CODE" -eq 0 ] && ! printf '%s' "$SAFE_OUT" | grep -qF "$MAIL1"; then
  ok "file names print redacted"
else
  bad "file names print redacted" "exit $SAFE_CODE: $SAFE_OUT"
fi
printf '{"a": "%s, oops\n' "$MAIL1" > "$C3D/broken.jsonl"
BROKEN_OUT=$("$SCRUB" --files "$C3D/broken.jsonl" 2>&1) && BROKEN_CODE=$? || BROKEN_CODE=$?
if printf '%s' "$BROKEN_OUT" | grep -qF "$MAIL1"; then bad "malformed input hides values" "$BROKEN_OUT"; else ok "malformed input hides values"; fi
mk_repo "$TMP/c10r"
printf '{"a": "%s, oops\n' "$MAIL2" > "$TMP/c10promote.txt"
if (cd "$TMP/c10r" && "$PROMOTE" "$TMP/c10promote.txt" raw/trial-c10 2>"$TMP/c10p.err" >"$TMP/c10p.out"); then P10_CODE=$?; else P10_CODE=$?; fi
if grep -qF "$MAIL2" "$TMP/c10p.out" "$TMP/c10p.err" 2>/dev/null; then bad "promote output hides values" "value shown"; else ok "promote output hides values"; fi

# --- C11: the coachman fixes a finding. ---
echo "C11: runbook fix steps"
C11_HITS=$(grep -c -i "finding" "$ROOT/skills/postmaster/coachman.md" || true)
if [ "$C11_HITS" -ge 3 ] && grep -qi "run the gate again" "$ROOT/skills/postmaster/coachman.md"; then
  ok "coachman steps fix findings and rerun the gate"
else
  bad "coachman steps fix findings and rerun the gate" "finding mentions: $C11_HITS"
fi
C11_SEND=$(grep -n -i "finding" "$ROOT/skills/postmaster/coachman.md" | grep -i "gate" | grep -i "user" | grep -viE "not |never |n't | no .*user|without .*user" || true)
if [ -n "$C11_SEND" ]; then
  bad "no gate step puts a finding to the user" "$(printf '%s' "$C11_SEND" | head -3)"
else
  ok "no gate step puts a finding to the user"
fi

# --- C12: the user is told once. ---
echo "C12: telling"
C12R="$TMP/c12root"
mkdir -p "$C12R/r0" "$C12R/r1"
printf '{"stage":"workhorses-running","leg":1}\n' > "$C12R/r0/manifest.json"
touch "$C12R/r0/.waiting-on-user"
printf '{"stage":"workhorses-running","leg":1}\n' > "$C12R/r1/manifest.json"
printf 'contact %s\n' "$MAIL1" > "$TMP/c12mail.txt"
(cd "$TMP/c8r" && POSTMASTER_DETECTIONS_LOG="$C12R/r1/detections.jsonl" "$SCRUB" --files "$TMP/c12mail.txt" >/dev/null 2>&1) || true
S12_A=$("$STATUS" "$C12R" 2>/dev/null) || S12_A=""
if printf '%s' "$S12_A" | grep -q "^r1 .*TELL"; then ok "untold finding reads TELL"; else bad "untold finding reads TELL" "$S12_A"; fi
TELL_AT=$(printf '%s' "$S12_A" | grep -n "^r1 .*TELL" | cut -d: -f1)
USER_AT=$(printf '%s' "$S12_A" | grep -n "^r0 .*USER" | cut -d: -f1)
if [ -n "$TELL_AT" ] && [ -n "$USER_AT" ] && [ "$TELL_AT" -lt "$USER_AT" ]; then ok "TELL comes first"; else bad "TELL comes first" "$S12_A"; fi
touch "$C12R/r1/.waiting-on-user"
S12_W=$("$STATUS" "$C12R" 2>/dev/null) || S12_W=""
if printf '%s' "$S12_W" | grep -q "^r1 .*TELL"; then ok "TELL while waiting on the user"; else bad "TELL while waiting on the user" "$S12_W"; fi
cp "$C12R/r1/detections.jsonl" "$C12R/r1/.detections-told"
S12_T=$("$STATUS" "$C12R" 2>/dev/null) || S12_T=""
if printf '%s' "$S12_T" | grep -q "^r1 .*USER"; then ok "told finding reads USER"; else bad "told finding reads USER" "$S12_T"; fi
printf '{"stage":"done","leg":2}\n' > "$C12R/r1/manifest.json"
rm "$C12R/r1/.detections-told" "$C12R/r1/.waiting-on-user"
S12_D=$("$STATUS" "$C12R" 2>/dev/null) || S12_D=""
if printf '%s' "$S12_D" | grep -q "^r1 .*TELL"; then ok "TELL for a done run"; else bad "TELL for a done run" "$S12_D"; fi
printf 'contact %s  # %s email -- made-up test\n' "$MAIL1" "$MK_ALLOW" > "$TMP/c12marked.txt"
(cd "$TMP/c8r" && POSTMASTER_DETECTIONS_LOG="$C12R/r1/detections.jsonl" "$SCRUB" --files "$TMP/c12marked.txt" >/dev/null 2>&1) || true
if grep -q '"via":"marker"' "$C12R/r1/detections.jsonl" 2>/dev/null; then ok "marked finding logged via marker"; else bad "marked finding logged via marker" "$(cat "$C12R/r1/detections.jsonl" 2>/dev/null | head -3)"; fi
(cd "$TMP/c8r" && POSTMASTER_DETECTIONS_LOG="$C12R/r1/detections.jsonl" "$SCRUB" --files "$TMP/c12mail.txt" >/dev/null 2>&1) || true
S12_DUP=$("$STATUS" "$C12R" 2>/dev/null) || S12_DUP=""
if [ "$(printf '%s' "$S12_DUP" | grep -c "TELL")" -eq 1 ]; then ok "repeat log of one finding stays one TELL"; else bad "repeat log of one finding stays one TELL" "$S12_DUP"; fi
if grep -q "TELL" "$ROOT/scripts/runs-watch.ts" 2>/dev/null; then ok "watch wakes on TELL"; else bad "watch wakes on TELL" "no TELL in runs-watch.ts"; fi

# --- C13: the card lists every finding. ---
echo "C13: card findings"
if grep -qi "removed" "$ROOT/skills/postmaster/coachman.md" && grep -qi "marked" "$ROOT/skills/postmaster/coachman.md" && grep -qi "scrubbed" "$ROOT/skills/postmaster/coachman.md"; then
  ok "card step lists removed, marked and scrubbed"
else
  bad "card step lists removed, marked and scrubbed" "a resolution is missing from coachman.md"
fi
if grep -qi "withhold" "$ROOT/skills/postmaster/postmaster.md" && grep -n -i "withhold" "$ROOT/skills/postmaster/postmaster.md" | grep -qi "finding"; then
  ok "postmaster withholds a card missing one"
else
  bad "postmaster withholds a card missing one" "no withhold-a-finding step in postmaster.md"
fi

# --- C14-C16: markers. ---
echo "C14-C16: markers"
C14D="$TMP/c14"
mkdir -p "$C14D"
printf 'contact %s  # %s email -- made-up test\n' "$MAIL1" "$MK_ALLOW" > "$C14D/same.txt"
printf '# %s email -- made-up test\ncontact %s\n' "$MK_NEXT" "$MAIL1" > "$C14D/next.txt"
M14_OUT=$("$SCRUB" --files "$C14D/same.txt" "$C14D/next.txt" 2>"$TMP/c14.err") && M14_CODE=$? || M14_CODE=$?
if [ "$M14_CODE" -eq 0 ] && [ -z "$M14_OUT" ]; then ok "marked lines pass"; else bad "marked lines pass" "exit $M14_CODE: $M14_OUT"; fi
printf 'clean  # %s email -- stale test\n' "$MK_ALLOW" > "$C14D/unused.txt"
printf '# %s email -- stale test\nclean\n' "$MK_NEXT" > "$C14D/stale.txt"
printf 'contact %s  # %s email\n' "$MAIL1" "$MK_ALLOW" > "$C14D/noreason.txt"
printf 'clean %s oops\n' "$MK_ALLOW" > "$C14D/malformed.txt"
M15_OUT=$("$SCRUB" --files "$C14D/unused.txt" "$C14D/stale.txt" "$C14D/noreason.txt" "$C14D/malformed.txt" 2>/dev/null) && M15_CODE=$? || M15_CODE=$?
for f in unused.txt noreason.txt; do
  if printf '%s' "$M15_OUT" | grep -q "$f:1: marker"; then ok "$f faults as marker"; else bad "$f faults as marker" "$M15_OUT"; fi
done
if printf '%s' "$M15_OUT" | grep -qE "stale.txt:[12]: marker"; then ok "stale.txt faults as marker"; else bad "stale.txt faults as marker" "$M15_OUT"; fi
if printf '%s' "$M15_OUT" | grep -q "malformed.txt"; then bad "malformed marker on clean line passes" "$M15_OUT"; else ok "malformed marker on clean line passes"; fi
mk_repo "$TMP/c16r"
(cd "$TMP/c16r" && echo clean > a.txt && git add -A && git commit -qm "write to $MAIL1  # $MK_ALLOW email -- reword me") || bad "C16 fixture" "fixture setup failed"
M16_OUT=$(cd "$TMP/c16r" && "$SCRUB" HEAD~1 HEAD 2>/dev/null) && M16_CODE=$? || M16_CODE=$?
if [ "$M16_CODE" -eq 1 ] && printf '%s' "$M16_OUT" | grep -q "(message).*email"; then
  ok "markers inert in messages"
else
  bad "markers inert in messages" "exit $M16_CODE: $M16_OUT"
fi
printf 'ship it\ncontact %s  # %s email -- reword me\n' "$MAIL1" "$MK_ALLOW" > "$TMP/c16pr.txt"
printf 'noted\ncontact %s  # %s email -- reword me\n' "$MAIL2" "$MK_ALLOW" > "$TMP/c16comment.txt"
M16P_OUT=$("$SCRUB" --pr-description "$TMP/c16pr.txt" 2>/dev/null) && M16P_CODE=$? || M16P_CODE=$?
M16C_OUT=$("$SCRUB" --pr-description "$TMP/c16comment.txt" 2>/dev/null) && M16C_CODE=$? || M16C_CODE=$?
if [ "$M16P_CODE" -eq 1 ] && printf '%s' "$M16P_OUT" | grep -q "email" && [ "$M16C_CODE" -eq 1 ] && printf '%s' "$M16C_OUT" | grep -q "email"; then
  ok "markers inert in posted text"
else
  bad "markers inert in posted text" "exit $M16P_CODE/$M16C_CODE: $M16P_OUT $M16C_OUT"
fi

# --- C17-C18: the rewrite. ---
echo "C17-C18: rewrite"
mk_repo "$TMP/c17r"
C17="$TMP/c17r"
(cd "$C17" && echo "clean" > a.txt && git add -A && git commit -qm "clean"
  printf 'contact %s\n' "$MAIL1" > b.txt && git add -A && git commit -qm "planted"
  echo "clean" > b.txt && git add -A && git commit -qm "dropped") || bad "C17 fixture" "fixture setup failed"
C17_BEFORE=$(git -C "$C17" rev-parse HEAD^{tree})
C17_BASE=$(git -C "$C17" rev-parse HEAD~3)
C17_OUT=$(cd "$C17" && POSTMASTER_DETECTIONS_LOG="$TMP/c17.log" "$REWRITE" HEAD~3 2>"$TMP/c17.err") && C17_CODE=$? || C17_CODE=$?
C17_AFTER=$(git -C "$C17" rev-parse HEAD^{tree})
if [ "$C17_CODE" -eq 0 ] && [ "$C17_BEFORE" = "$C17_AFTER" ]; then
  ok "rewrite exits 0 with the tree unchanged"
else
  bad "rewrite exits 0 with the tree unchanged" "exit $C17_CODE"
fi
if [ "$(printf '%s' "$C17_OUT" | grep -c "removed")" -eq 1 ]; then ok "rewrite prints one removed line"; else bad "rewrite prints one removed line" "$C17_OUT"; fi
C17_RE=$(cd "$C17" && "$SCRUB" "$C17_BASE" HEAD 2>/dev/null) && C17_RE_CODE=$? || C17_RE_CODE=$?
if [ "$C17_RE_CODE" -eq 0 ] && [ -z "$C17_RE" ]; then ok "rescan after rewrite is clean"; else bad "rescan after rewrite is clean" "exit $C17_RE_CODE: $C17_RE"; fi
mk_repo "$TMP/c18r"
(cd "$TMP/c18r" && git init -q --bare "$TMP/c18remote" && git remote add origin "$TMP/c18remote"
  echo "clean" > a.txt && git add -A && git commit -qm "clean"
  printf 'contact %s\n' "$MAIL1" > b.txt && git add -A && git commit -qm "planted"
  echo "clean" > b.txt && git add -A && git commit -qm "dropped"
  git push -q origin main) || bad "C18 fixture" "fixture setup failed"
C18_HEAD_BEFORE=$(git -C "$TMP/c18r" rev-parse HEAD)
C18_OUT=$(cd "$TMP/c18r" && "$REWRITE" HEAD~3 2>"$TMP/c18.err") && C18_CODE=$? || C18_CODE=$?
C18_HEAD_AFTER=$(git -C "$TMP/c18r" rev-parse HEAD)
if [ "$C18_CODE" -eq 2 ] && [ "$C18_HEAD_BEFORE" = "$C18_HEAD_AFTER" ]; then
  ok "pushed branch refuses with HEAD unchanged"
else
  bad "pushed branch refuses with HEAD unchanged" "exit $C18_CODE"
fi
if tr '\n' ' ' < "$ROOT/skills/postmaster/coachman.md" | grep -qi "escalat[^.]*push\|push[^.]*escalat"; then
  ok "refused rewrite escalates to the user"
else
  bad "refused rewrite escalates to the user" "no pushed-branch escalation in coachman.md"
fi

# --- C19-C21: promoting records. ---
echo "C19-C21: promote"
mk_repo "$TMP/c19r"
C19S="$TMP/c19src"
mkdir -p "$C19S"
printf 'contact %s\nkey %s\n' "$MAIL1" "$TOK_SK" > "$C19S/notes.md"
C19_H0=$(git hash-object "$C19S/notes.md")
C19_OUT=$(cd "$TMP/c19r" && "$PROMOTE" "$C19S" raw/trial-c19 2>"$TMP/c19.err") && C19_CODE=$? || C19_CODE=$?
C19_H1=$(git hash-object "$C19S/notes.md")
if [ "$C19_CODE" -eq 0 ]; then ok "dirty promote exits 0"; else bad "dirty promote exits 0" "exit $C19_CODE: $(cat "$TMP/c19.err")"; fi
if [ "$(printf '%s' "$C19_OUT" | grep -c "scrubbed")" -eq 2 ]; then ok "one scrubbed line per replacement"; else bad "one scrubbed line per replacement" "$C19_OUT"; fi
if grep -q "<redacted:email>" "$TMP/c19r/raw/trial-c19/notes.md" 2>/dev/null && grep -q "<redacted:token>" "$TMP/c19r/raw/trial-c19/notes.md" 2>/dev/null; then
  ok "copy holds placeholders"
else
  bad "copy holds placeholders" "$(cat "$TMP/c19r/raw/trial-c19/notes.md" 2>/dev/null)"
fi
if grep -qF "$MAIL1" "$TMP/c19r/raw/trial-c19/notes.md" 2>/dev/null || grep -qF "$TOK_SK" "$TMP/c19r/raw/trial-c19/notes.md" 2>/dev/null; then
  bad "copy holds no value" "value survives in the copy"
else
  ok "copy holds no value"
fi
if [ "$C19_H0" = "$C19_H1" ]; then ok "sources unchanged"; else bad "sources unchanged" "source hash moved"; fi
C20S="$TMP/c20src"
mkdir -p "$C20S"
{
  printf '{"type":"thinking","thinking":"hmm","signature":"%s"}\n' "$ENC1"
  printf '{"type":"redacted_thinking","data":"%s"}\n' "$ENC2"
  printf '{"note":"says {\\"encrypted_content\\": \\"%s\\"} aloud"}\n' "$ENC3"
} > "$C20S/session.jsonl"
C20_OUT=$(cd "$TMP/c19r" && "$PROMOTE" "$C20S" raw/trial-c20 2>"$TMP/c20.err") && C20_CODE=$? || C20_CODE=$?
if [ "$C20_CODE" -eq 0 ] && [ "$(grep -o "redacted:encrypted-reasoning" "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null | wc -l)" -eq 3 ]; then
  ok "reasoning payloads replaced"
else
  bad "reasoning payloads replaced" "exit $C20_CODE: $(cat "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null)"
fi
if grep -qF "$ENC1" "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null || grep -qF "$ENC2" "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null || grep -qF "$ENC3" "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null; then
  bad "no payload survives" "payload survives in the copy"
else
  ok "no payload survives"
fi
if bun -e 'const fs=require("fs");for(const l of fs.readFileSync(process.argv[1],"utf8").trim().split("\n"))JSON.parse(l);console.log("parses")' "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null | grep -q parses; then
  ok "every copied line still parses"
else
  bad "every copied line still parses" "a copied line is not JSON"
fi
C21_RE=$("$SCRUB" --files "$TMP/c19r/raw/trial-c19/notes.md" "$TMP/c19r/raw/trial-c20/session.jsonl" 2>/dev/null) && C21_RE_CODE=$? || C21_RE_CODE=$?
if [ "$C21_RE_CODE" -eq 0 ] && [ -z "$C21_RE" ]; then ok "rescan of the copy is clean"; else bad "rescan of the copy is clean" "exit $C21_RE_CODE: $C21_RE"; fi
C21_OUT=$(cd "$TMP/c19r" && "$PROMOTE" "$C19S" raw/trial-c19 2>/dev/null) && C21_CODE=$? || C21_CODE=$?
if [ "$C21_CODE" -eq 2 ]; then ok "repeat promote exits 2"; else bad "repeat promote exits 2" "exit $C21_CODE"; fi
C21F="$TMP/c21src"
mkdir -p "$C21F"
printf 'clean  # %s email -- stale test\n' "$MK_ALLOW" > "$C21F/notes.md"
C21F_OUT=$(cd "$TMP/c19r" && "$PROMOTE" "$C21F" raw/trial-c21 2>/dev/null) && C21F_CODE=$? || C21F_CODE=$?
if [ "$C21F_CODE" -eq 1 ] && [ ! -e "$TMP/c19r/raw/trial-c21" ]; then ok "marker fault copies nothing, exit 1"; else bad "marker fault copies nothing, exit 1" "exit $C21F_CODE"; fi

# --- C22: the tree check. ---
echo "C22: tree check"
mk_repo "$TMP/c22a"
(cd "$TMP/c22a" && mkdir -p .postmaster/runs && echo record > .postmaster/runs/stale.json && git add -A && git commit -qm "run file" && git rm -q .postmaster/runs/stale.json && git commit -qm "drop it") || bad "C22 fixture" "fixture setup failed"
T22_A=$(cd "$TMP/c22a" && "$TREE" HEAD~2 HEAD 2>/dev/null) && T22_A_CODE=$? || T22_A_CODE=$?
if [ "$T22_A_CODE" -eq 1 ] && printf '%s' "$T22_A" | grep -q ".postmaster/runs/stale.json"; then
  ok "run file added then deleted fails named"
else
  bad "run file added then deleted fails named" "exit $T22_A_CODE: $T22_A"
fi
mk_repo "$TMP/c22b"
(cd "$TMP/c22b" && mkdir -p .postmaster && printf '[x]\n' > .postmaster/settings.toml && git add .postmaster/settings.toml) || bad "C22 fixture" "fixture setup failed"
T22_B=$(cd "$TMP/c22b" && "$TREE" HEAD HEAD 2>/dev/null) && T22_B_CODE=$? || T22_B_CODE=$?
if [ "$T22_B_CODE" -eq 1 ] && printf '%s' "$T22_B" | grep -q ".postmaster/settings.toml"; then
  ok "staged settings file fails named"
else
  bad "staged settings file fails named" "exit $T22_B_CODE: $T22_B"
fi
mk_repo "$TMP/c22c"
(cd "$TMP/c22c" && mkdir -p .postmaster && printf '[project]\n' > .postmaster/project.toml && git add -A && git commit -qm "shared settings") || bad "C22 fixture" "fixture setup failed"
T22_C=$(cd "$TMP/c22c" && "$TREE" HEAD~1 HEAD 2>/dev/null) && T22_C_CODE=$? || T22_C_CODE=$?
if [ "$T22_C_CODE" -eq 0 ] && [ -z "$T22_C" ]; then ok "shared settings pass"; else bad "shared settings pass" "exit $T22_C_CODE: $T22_C"; fi
mk_repo "$TMP/c22d"
(cd "$TMP/c22d" && echo clean > a.txt && git add -A && git commit -qm "clean"
  git checkout -qb side && mkdir -p .postmaster/runs && echo record > .postmaster/runs/m.json && git add -A && git commit -qm "run file on side"
  git checkout -q main && git merge -q --no-ff side -m "merge side") || bad "C22 fixture" "fixture setup failed"
T22_D=$(cd "$TMP/c22d" && "$TREE" HEAD~2 HEAD 2>/dev/null) && T22_D_CODE=$? || T22_D_CODE=$?
if [ "$T22_D_CODE" -eq 1 ] && printf '%s' "$T22_D" | grep -q ".postmaster/runs/m.json"; then
  ok "merge bringing a run file fails named"
else
  bad "merge bringing a run file fails named" "exit $T22_D_CODE: $T22_D"
fi
mk_repo "$TMP/c22e"
(cd "$TMP/c22e" && mkdir -p raw/trial && printf '{"x": {"encrypted_content": "%s"}}\n' "$ENC1" > raw/trial/s.jsonl && git add -A && git commit -qm "reasoning under raw") || bad "C22 fixture" "fixture setup failed"
T22_E=$(cd "$TMP/c22e" && "$TREE" HEAD~1 HEAD 2>/dev/null) && T22_E_CODE=$? || T22_E_CODE=$?
if [ "$T22_E_CODE" -eq 1 ]; then ok "reasoning added under raw fails"; else bad "reasoning added under raw fails" "exit $T22_E_CODE"; fi
# Fresh clone: $C9D still holds C9's planted note, whose finding the gate
# reports first, hiding the run file this check names.
C22G="$TMP/c22gclone"
git clone -q "$ROOT" "$C22G" 2>/dev/null || bad "C22 fixture" "clone failed"
(cd "$C22G" && git update-ref refs/remotes/origin/main "$C9_BASE" && git config user.name "Oracle" && git config user.email "oracle@$RESERVED" && mkdir -p .postmaster/runs && echo record > .postmaster/runs/stale.json && git add -f .postmaster/runs/stale.json && git commit -qm "run file") || bad "C22 fixture" "fixture setup failed"
T22_G=$(cd "$C22G" && bun run check 2>&1) && T22_G_CODE=$? || T22_G_CODE=$?
if [ "$T22_G_CODE" -ne 0 ] && printf '%s' "$T22_G" | grep -q ".postmaster/runs/stale.json"; then
  ok "gate fails on a committed run file"
else
  bad "gate fails on a committed run file" "exit $T22_G_CODE"
fi

# --- C23: every rule proven. ---
echo "C23: rule proofs"
for s in scrub-check scrub-rewrite raw-promote tree-check verify-merge; do
  if [ -f "$ROOT/scripts/$s.test.ts" ]; then ok "$s.test.ts beside its script"; else bad "$s.test.ts beside its script" "missing"; fi
done
FLIP_DIR="$TMP"
flip() { # flip <label> <disable> <mode> <args...>: clean means exit 0, visible means exit 1
  local label="$1" disable="$2" want="$3"; shift 3
  local out code
  out=$(cd "$FLIP_DIR" && SCRUB_CHECK_DISABLE="$disable" "$@" 2>/dev/null) && code=$? || code=$?
  if { [ "$want" = clean ] && [ "$code" -eq 0 ] && [ -z "$out" ]; } || { [ "$want" = visible ] && [ "$code" -eq 1 ] && [ -n "$out" ]; }; then
    ok "$label flips with $disable"
  else
    bad "$label flips with $disable" "exit $code: $out"
  fi
}
printf 'export TLS_CERT=%s\n' "$SECRET_FIELD_VAL" > "$TMP/cert.env"
printf '{"%s": "%s"}\n' "$KEY_NAME" "$KEY_VAL" > "$TMP/keyfield.json"
mk_repo "$TMP/c23add"
(cd "$TMP/c23add" && printf 'contact %s\n' "$MAIL1" > b.txt && git add -A && git commit -qm "planted" && echo clean > b.txt && git add -A && git commit -qm "dropped") || bad "C23 fixture" "fixture setup failed"
FLIP_DIR="$TMP/c23add"
flip "added then deleted" email clean "$SCRUB" HEAD~2 HEAD
FLIP_DIR="$TMP/c16r"
flip "message" messages clean "$SCRUB" HEAD~1 HEAD
FLIP_DIR="$TMP"
MERGE_RULE=$(cd "$C2" && "$SCRUB" "$C2_ROOT" "$C2_HEAD" 2>/dev/null | grep "m.txt" | sed 's/.*: \([a-z-]*\)$/\1/' | head -1)
if [ -n "$MERGE_RULE" ]; then
  MOUT=$(cd "$C2" && SCRUB_CHECK_DISABLE="$MERGE_RULE" "$SCRUB" "$C2_ROOT" "$C2_HEAD" 2>/dev/null) && MCODE=$? || MCODE=$?
  if printf '%s' "$MOUT" | grep -q "m.txt"; then bad "merge flips with $MERGE_RULE" "$MOUT"; else ok "merge flips with $MERGE_RULE"; fi
else
  bad "merge flips" "no rule read from the merge line"
fi
MOUT2=$(cd "$C2" && SCRUB_CHECK_DISABLE="merges" "$SCRUB" "$C2_ROOT" "$C2_HEAD" 2>/dev/null) && M2CODE=$? || M2CODE=$?
if [ "$M2CODE" -eq 1 ] && ! printf '%s' "$MOUT2" | grep -q "m.txt"; then ok "merges off drops the resolution"; else bad "merges off drops the resolution" "exit $M2CODE: $MOUT2"; fi
flip "marked line" markers visible "$SCRUB" --files "$C14D/same.txt"
flip "unused marker" marker clean "$SCRUB" --files "$C14D/unused.txt"
NRO=$(SCRUB_CHECK_DISABLE="marker" "$SCRUB" --files "$C14D/noreason.txt" 2>/dev/null) && NRO_CODE=$? || NRO_CODE=$?
if [ "$NRO_CODE" -eq 1 ] && printf '%s' "$NRO" | grep -q "noreason.txt:1: email"; then ok "reason-less marker flips to email"; else bad "reason-less marker flips to email" "exit $NRO_CODE: $NRO"; fi
flip "token" token clean "$SCRUB" --files "$C4D/bearer.txt"
flip "dotenv" dotenv clean "$SCRUB" --files "$TMP/cert.env"
flip "private-path" private-path clean "$SCRUB" --files "$C7D/path.txt"
flip "private-host" private-host clean "$SCRUB" --files "$C7D/ssh1.txt"
flip "account-id" account-id clean "$SCRUB" --files "$C7D/opaque.txt"
flip "attribution" assistant-attribution clean "$SCRUB" --files "$C7D/footer.txt"
flip "key field" key clean "$SCRUB" --files "$TMP/keyfield.json"
if printf '{"%s": "%s"}\n' "$KEY_NAME" "$KEY_VAL" | head -1 >/dev/null; then
  KOUT=$("$SCRUB" --files "$TMP/keyfield.json" 2>/dev/null) && KCODE=$? || KCODE=$?
  if [ "$KCODE" -eq 1 ] && printf '%s' "$KOUT" | grep -q "keyfield.json:1: key"; then ok "key field found as key"; else bad "key field found as key" "exit $KCODE: $KOUT"; fi
fi
P208_RULES="sign-off author-field copyright git-identity title self-introduction relative credit email phone health income family residence employer street postcode po-box address-field"
KNOWN_RULES="token dotenv marker encrypted-reasoning private-path private-host account-id key assistant-attribution"
PATTERNS="$ROOT/raw/trials/pii-patterns/apparatus/patterns.ts"
MISSING=""
DRIFT=""
for r in $P208_RULES; do
  if ! grep -qF "\"$r\"" "$PATTERNS" 2>/dev/null; then DRIFT="$DRIFT $r"; continue; fi
  grep -rqF "$r" "$ROOT"/scripts/*.test.ts 2>/dev/null || MISSING="$MISSING $r"
done
for r in $KNOWN_RULES; do
  grep -rqF "$r" "$ROOT"/scripts/*.test.ts 2>/dev/null || MISSING="$MISSING $r"
done
if [ -n "$DRIFT" ]; then printf '  info ported rules missing from patterns.ts:%s\n' "$DRIFT"; fi
if [ -z "$MISSING" ]; then ok "every ported rule named in tests"; else bad "every ported rule named in tests" "missing:$MISSING"; fi

# --- C24: the tree scans clean. ---
echo "C24: tree scan"
git -C "$ROOT" grep -I --name-only -z -e . -- . 2>/dev/null > "$TMP/tracked0.txt" || true
T24_COUNT=$(tr -cd '\0' < "$TMP/tracked0.txt" | wc -c | tr -d ' ')
printf '  info %s tracked text files\n' "$T24_COUNT"
T24_OUT=$(cd "$ROOT" && xargs -0 "$SCRUB" --files < "$TMP/tracked0.txt" 2>"$TMP/c24.err") && T24_CODE=$? || T24_CODE=$?
if [ "$T24_CODE" -eq 0 ] && [ -z "$T24_OUT" ]; then ok "every tracked file scans clean"; else bad "every tracked file scans clean" "exit $T24_CODE: $(printf '%s' "$T24_OUT" | head -10)"; fi

# --- C25: goldens. ---
echo "C25: goldens"
if ls "$ROOT/scripts/fixtures/"* 2>/dev/null | grep -qi "golden\|parity"; then ok "goldens recorded"; else bad "goldens recorded" "$(ls "$ROOT/scripts/fixtures/" 2>/dev/null | head)"; fi
if grep -rqi "regenerat" "$ROOT/scripts/fixtures/_note"* 2>/dev/null; then ok "regeneration noted"; else bad "regeneration noted" "no command in _note"; fi
S25_OUT=$("$SCRUB" --spans "$C4D/prefix.txt" 2>/dev/null) && S25_CODE=$? || S25_CODE=$?
if [ "$S25_CODE" -eq 0 ] && printf '%s' "$S25_OUT" | grep -qE "^0:1:[0-9]+:[0-9]+:token$"; then ok "--spans prints offsets"; else bad "--spans prints offsets" "exit $S25_CODE: $S25_OUT"; fi
F25_OUT=$(cd "$TMP/c8r" && "$SCRUB" --findings HEAD~1 HEAD 2>/dev/null) && F25_CODE=$? || F25_CODE=$?
if printf '%s' "$F25_OUT" | bun -e 'const fs=require("fs");let n=0;for(const l of fs.readFileSync(0,"utf8").trim().split("\n")){if(l.trim()){JSON.parse(l);n++}}if(!n)process.exit(1)' 2>/dev/null; then
  ok "--findings prints JSON lines"
else
  bad "--findings prints JSON lines" "exit $F25_CODE: $F25_OUT"
fi
: > "$TMP/logdetect.jsonl"
LD_COMMIT=$(git -C "$TMP/c8r" rev-parse HEAD)
if (cd "$TMP/c8r" && POSTMASTER_DETECTIONS_LOG="$TMP/logdetect.jsonl" "$SCRUB" --log-detection email notes.txt 1 "$LD_COMMIT" >/dev/null 2>&1) && [ -s "$TMP/logdetect.jsonl" ]; then
  ok "--log-detection appends"
else
  bad "--log-detection appends" "nothing appended"
fi

# --- C26: the first version kept. ---
echo "C26: kept behavior"
if grep -qiE "^\s*scrub|^\s*tree" "$ROOT/.postmaster/project.toml" 2>/dev/null; then
  bad "project settings take no scrub or tree entry" "$(grep -iE "scrub|tree" "$ROOT/.postmaster/project.toml" | head -3)"
else
  ok "project settings take no scrub or tree entry"
fi
DIFF_BASE="$BASE_REF"
if [ -z "$DIFF_BASE" ]; then
  if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then DIFF_BASE="origin/main"; else DIFF_BASE=""; fi
fi
if [ -n "$DIFF_BASE" ]; then
  BRANCH_FILES=$(git -C "$ROOT" diff --name-only "$DIFF_BASE"...HEAD 2>/dev/null) || BRANCH_FILES=""
  printf '  info branch touches: %s\n' "$(printf '%s' "$BRANCH_FILES" | tr '\n' ' ' | head -c 600)"
  KEPT_MISS=""
  for f in scripts/runs-status.ts scripts/verify.ts skills/postmaster/coachman.md skills/postmaster/postmaster.md; do
    printf '%s' "$BRANCH_FILES" | grep -qxF "$f" || KEPT_MISS="$KEPT_MISS $f"
  done
  if [ -z "$KEPT_MISS" ]; then ok "status poll, gate runner and runbooks kept"; else bad "status poll, gate runner and runbooks kept" "untouched:$KEPT_MISS"; fi
  if printf '%s' "$BRANCH_FILES" | grep -q "scripts/wiki-lint.ts"; then bad "wiki page rules not ported" "wiki-lint.ts touched"; else ok "wiki page rules not ported"; fi
  if printf '%s' "$BRANCH_FILES" | grep -q "skills/wiki/SKILL.md"; then bad "wiki skill lines not ported" "wiki SKILL.md touched"; else ok "wiki skill lines not ported"; fi
else
  skip "kept-file diff" "no base to diff against"
fi
if grep -q "verify-merge" "$ROOT/skills/postmaster/postmaster.md"; then ok "merge step runs verify-merge"; else bad "merge step runs verify-merge" "not named in postmaster.md"; fi
if grep -q "scrub-check" "$ROOT/package.json" && grep -q "tree-check" "$ROOT/package.json"; then ok "gate runs both scans"; else bad "gate runs both scans" "package.json check lacks a scan"; fi

# --- C27: streaming. ---
echo "C27: streaming"
if uname | grep -qi darwin; then
  skip "streaming under a limit" "no ulimit -v on macOS"
elif (ulimit -v 524288 2>/dev/null); then
  bun -e '
const fs = require("fs");
const line = ("clean log line number %d with words to fill bytes " + "x".repeat(2400) + "\n");
let out = "";
for (let i = 0; i < 70000; i++) out += "n" + i + " " + line.replace("%d", String(i));
fs.writeFileSync(process.argv[1], out);' "$TMP/big.txt"
  BIG_MB=$(wc -c < "$TMP/big.txt" | tr -d ' ')
  printf '  info big file: %s bytes\n' "$BIG_MB"
  if (ulimit -v 524288; bun --version >/dev/null 2>&1); then
    ok "bun starts under 512 MB"
  else
    bad "bun starts under 512 MB" "bun aborts under the limit"
  fi
  if (ulimit -v 524288; "$SCRUB" --files "$TMP/big.txt" >/dev/null 2>"$TMP/c27.err"); then
    ok "175 MB streams under the limit"
  else
    bad "175 MB streams under the limit" "exit $?: $(head -c 300 "$TMP/c27.err")"
  fi
  if (ulimit -v 524288; bun -e 'const fs=require("fs");fs.readFileSync(process.argv[1],"utf8")' "$TMP/big.txt" 2>/dev/null); then
    bad "whole-file read fails under the limit" "a whole read passed"
  else
    ok "whole-file read fails under the limit"
  fi
  mkdir -p "$TMP/c27src"
  cp "$TMP/big.txt" "$TMP/c27src/big.txt"
  if (cd "$TMP/c19r" && ulimit -v 524288; "$PROMOTE" "$TMP/c27src" raw/trial-c27 >/dev/null 2>&1); then
    ok "promote streams under the limit"
  else
    bad "promote streams under the limit" "exit $?"
  fi
else
  skip "streaming under a limit" "no limit can be set here"
fi

# --- C28: no line stalls. ---
echo "C28: long lines"
bun -e '
const fs = require("fs");
const cap = Array.from({ length: 190000 }, (_, i) => ["Alder", "Birch", "Cedar", "Elm", "Frost", "Grove"][i % 6]).join(" ");
const hy = Array.from({ length: 90000 }, (_, i) => ["well-known", "up-to-date", "state-of-the-art"][i % 3]).join(" ");
const qu = Array.from({ length: 150000 }, (_, i) => "\"lorem\"").join(" ");
const es = Array.from({ length: 90000 }, () => "\u001b[31mred\u001b[0m").join(" ");
fs.writeFileSync(process.argv[1] + "/cap.txt", cap.slice(0, 1048576) + "\n");
fs.writeFileSync(process.argv[1] + "/hy.txt", hy.slice(0, 1048576) + "\n");
fs.writeFileSync(process.argv[1] + "/qu.txt", qu.slice(0, 1048576) + "\n");
fs.writeFileSync(process.argv[1] + "/es.txt", es.slice(0, 1048576) + "\n");' "$TMP"
for f in cap hy qu es; do
  T0=$(bun -e 'console.log(Date.now())')
  "$SCRUB" --files "$TMP/$f.txt" >/dev/null 2>&1; LCODE=$?
  T1=$(bun -e 'console.log(Date.now())')
  MS=$(( T1 - T0 ))
  printf '  info %s: %s ms, exit %s\n' "$f" "$MS" "$LCODE"
  if [ "$LCODE" -eq 0 ] && [ "$MS" -lt 1000 ]; then ok "$f line within a second"; else bad "$f line within a second" "${MS}ms exit $LCODE"; fi
done
printf '%s contact %s\n' "$(head -c 1048000 < "$TMP/cap.txt" | tr -d '\n')" "$MAIL1" > "$TMP/planted.txt"
PL_OUT=$("$SCRUB" --files "$TMP/planted.txt" 2>/dev/null) && PL_CODE=$? || PL_CODE=$?
if [ "$PL_CODE" -eq 1 ] && printf '%s' "$PL_OUT" | grep -q "planted.txt:1: email"; then
  ok "planted value at a long line end found"
else
  bad "planted value at a long line end found" "exit $PL_CODE: $(printf '%s' "$PL_OUT" | head -c 200)"
fi

# --- C29: posted text scanned. ---
echo "C29: posting"
: > "$TMP/c29.log"
printf 'merge this\ncontact %s\n' "$MAIL1" > "$TMP/c29pr.txt"
P29_OUT=$(POSTMASTER_DETECTIONS_LOG="$TMP/c29.log" "$SCRUB" --pr-description "$TMP/c29pr.txt" 2>/dev/null) && P29_CODE=$? || P29_CODE=$?
if [ "$P29_CODE" -eq 1 ] && [ "$(wc -l < "$TMP/c29.log" | tr -d ' ')" -eq 1 ]; then
  ok "request text logs one line per finding"
else
  bad "request text logs one line per finding" "exit $P29_CODE, $(wc -l < "$TMP/c29.log" | tr -d ' ') lines"
fi
: > "$TMP/c29b.log"
printf 'noted\ncontact %s\n' "$MAIL2" > "$TMP/c29comment.txt"
Q29_OUT=$(POSTMASTER_DETECTIONS_LOG="$TMP/c29b.log" "$SCRUB" --pr-description "$TMP/c29comment.txt" 2>/dev/null) && Q29_CODE=$? || Q29_CODE=$?
if [ "$Q29_CODE" -eq 1 ] && [ "$(wc -l < "$TMP/c29b.log" | tr -d ' ')" -eq 1 ]; then
  ok "comment text logs one line per finding"
else
  bad "comment text logs one line per finding" "exit $Q29_CODE"
fi
if [ "$(grep -c "pr-description" "$ROOT/skills/postmaster/postmaster.md")" -ge 2 ]; then
  ok "landing steps scan before posting"
else
  bad "landing steps scan before posting" "fewer than two pr-description steps in postmaster.md"
fi

printf '\npass %s, fail %s, skip %s\n' "$PASS" "$FAIL" "$SKIP"
if [ -n "$FAILED" ]; then printf 'failed:%s\n' "$FAILED"; fi
[ "$FAIL" -eq 0 ]
