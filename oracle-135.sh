#!/usr/bin/env bash
# oracle-135.sh — blind acceptance for #135, "Scrub private data from public history".
#
# It tests the change at its interfaces only: the scrub's exits, suspects and
# silence on fixture repositories it builds itself, the rewrite's and the
# promote's completes and refusals, the tree and wiki checks' fails, the
# poll's TELL and the runner's detections log, the gate's wiring, and the
# check's own tests. A probe that fails for any other reason than the product
# misbehaving is an oracle bug, and fails the oracle too.
#
#   oracle-135.sh [base] [head]    the change under test; base defaults to
#                                  main, head to HEAD; run from the repo root
#
#   exit 0  every probe behaved
#   exit 1  a probe misbehaved
#   exit 2  usage, not a repository, or the oracle's own fixture failed
set -uo pipefail
REPO=$(pwd -P)
BASE_ARG=${1:-main}
HEAD_ARG=${2:-HEAD}
[ $# -le 2 ] || { echo "usage: oracle-135.sh [base] [head]" >&2; exit 2; }
case $BASE_ARG in -*) echo "usage: oracle-135.sh [base] [head]" >&2; exit 2 ;; esac
case $HEAD_ARG in -*) echo "usage: oracle-135.sh [base] [head]" >&2; exit 2 ;; esac
git -C "$REPO" rev-parse --show-toplevel >/dev/null 2>&1 || { echo "oracle-135: not a repository" >&2; exit 2; }
SCRUB=$REPO/scripts/scrub-check.sh
TREE=$REPO/scripts/tree-check.sh
LINT=$REPO/scripts/wiki-lint.sh
PROMOTE=$REPO/scripts/raw-promote.sh
REWRITE=$REPO/scripts/scrub-rewrite.sh
MERGE=$REPO/scripts/verify-merge.sh
STATUS=$REPO/scripts/runs-status.sh
VERIFY=$REPO/scripts/verify.sh
for s in "$SCRUB" "$TREE" "$LINT" "$PROMOTE" "$REWRITE" "$STATUS" "$VERIFY" "$MERGE"; do
  [ -x "$s" ] || { echo "oracle-135: no $s" >&2; exit 2; }
done

tmp=$(mktemp -d) || exit 2
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
fails=0
# Hermetic probes: a detections log in the environment is the gate's, and
# fixture findings must never land in it. Logging probes set their own.
export POSTMASTER_DETECTIONS_LOG=

ok() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }

# Every fabricated secret, assembled from pieces so this file carries no
# matchable form. own-branch-clean below proves it. A name ending in a
# secret word takes its value through printf -v, never `=`: assigning a
# value to such a name is itself the shape the check finds.
E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
printf -v EMAIL '%s' "contact-${E_LOCAL}@${E_HOST}.${E_TLD}"
PLUS_LOCAL='First.Last+tag'
printf -v PLUS_EMAIL '%s' "${PLUS_LOCAL}@sub.${E_HOST}.${E_TLD}"
DOT='.'
PRIV_IP="10${DOT}135${DOT}4${DOT}13"
CGNAT_IP="100${DOT}99${DOT}4${DOT}13"
PUB100="100${DOT}128${DOT}0${DOT}1"
PRIV_HOST="metrics${DOT}internal"
TAIL_HOST="node-413${DOT}ts${DOT}net"
HOME_P='/ho'; HOME_O='me/'; HOME_U='fixture-user-413'
HOME_PATH="${HOME_P}${HOME_O}${HOME_U}/notes.txt"
T_P1='s'; T_P2='k-'; T_B='fictional413keyK7mQ2xZ9aVbN4qy7'
TOKEN_V="${T_P1}${T_P2}${T_B}"
BEARER_V1='fictional413relay'; BEARER_V2='K7mQ2xZ9aVbN4qy7'
BEARER="Bearer ${BEARER_V1}${BEARER_V2}"
O_P1='or'; O_P2='g-'; O_B='fictional413relayK7mQ2xZ9'
ORG_TOKEN="${O_P1}${O_P2}${O_B}"
SESS_P='sess-'; SESS_B='fictional413K7mQ2x'
printf -v SESS_ID '%s' "${SESS_P}${SESS_B}"
UUID_A='41313513-0042'; UUID_B='4c1d-9e5f-135135135135'
UUID_V="${UUID_A}-${UUID_B}"
ACCT_A='123456'; ACCT_B='789012'
ACCT_NUM="${ACCT_A}${ACCT_B}"
K_U='user'; K_E='Email'
KEY_USER="${K_U}${K_E}"
K_S1='session'; K_S2='Context'
KEY_SESSC="${K_S1}${K_S2}"
K_C1='credential'; K_C2='_org'
KEY_CRED="${K_C1}${K_C2}"
A_F1='account'; A_F2='Id'
KEY_ACCT="${A_F1}${A_F2}"
S_V1='fixture-'; S_V2='session-413'
SESS_VAL="${S_V1}${S_V2}"
O_V1='fixture-'; O_V2='org-413'
ORG_VAL="${O_V1}${O_V2}"
C_A='Co-Au'; C_B='thored-'; C_C='By: Imaginary Aide'
TRAILER="${C_A}${C_B}${C_C}"
G_W1='generated-'; G_W2='with: ImaginaryAide'
GENWITH="${G_W1}${G_W2}"
D_N1='SESSION'; D_N2='SECRET'; US='_'; D_V1='relay-413-'; D_V2='quiet'
DOTENV_LINE="${D_N1}${US}${D_N2}=${D_V1}${D_V2}"
ALLOW_P='private-data:allo'
ALLOW="${ALLOW_P}w"
ALLOW_NEXT="${ALLOW_P}w-next-line"
ON_LOCAL='oracle-135'
printf -v NOREPLY_ADDR '%s' "${ON_LOCAL}@users.noreply.github.com"
BODY1='QUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJD'
BODY2='REVGREVGREVGREVGREVGREVGREVGREVGREVGREVG'
BODY3='QkJDQkJDQkJDQkJDQkJDQkJDQkJDQkJDQkJDQkJD'
PEM_HEAD='-----BEGIN PRIVATE '
PEM_T='KEY-----'
PEM_END='-----END PRIVATE '
PGP_H='-----BEGIN PGP PRIVATE '
PGP_T='KEY BLOCK-----'
PUTTY_H='PuTTY-User-Key-File-'
PUTTY_V='2: test-413-key'
SSH2_H='---- BEGIN SSH2 ENCRYPTED PRIVATE '
SSH2_T='KEY ----'
AGE_A='AGE-'; AGE_S='SECRET-'; AGE_K='KEY-'
AGE_B='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

mkrepo() {  # a scratch repo on main with one clean commit, printed
  local d
  d=$(mktemp -d -p "$tmp") || return 1
  ( cd "$d" && git init -q -b main . && git config user.name Oracle \
    && git config user.email "oracle@example.invalid" \
    && printf 'base\n' > base.txt && git add base.txt && git commit -qm base ) || return 1
  printf '%s' "$d"
}
commit_file() {  # commit_file <repo> <path> <content> [message]: commit, print the sha
  ( cd "$1" && mkdir -p "$(dirname -- "$2")" && printf '%s\n' "$3" > "$2" \
    && git add "$2" && git commit -qm "${4:-add $2}" >/dev/null && git rev-parse HEAD )
}
leaked() {  # leaked <output> <value...>: 0 when a value reaches the output
  local out=$1; shift
  local v
  for v in "$@"; do printf '%s' "$out" | grep -qF -- "$v" && return 0; done
  return 1
}
expects_one() {  # expects_one <repo> <base> <head> <path> <kind> <secret...>
  local r=$1 base=$2 head=$3 path=$4 kind=$5; shift 5
  local out code
  out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
  [ "$code" -eq 1 ] && [ "$out" = "$head:$path:1: $kind" ] && ! leaked "$out" "$@"
}
expects_silent() {  # expects_silent <repo> <base> <head>
  local out code
  out=$(cd "$1" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$2" "$3" 2>/dev/null); code=$?
  [ "$code" -eq 0 ] && [ -z "$out" ]
}

echo "exits and silence"
out=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ -z "$out" ]; } && ok "no arguments is a usage error, exit 2" || fail "no arguments is a usage error, exit 2 (exit $code)"
out=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --help 2>&1); code=$?
{ [ "$code" -eq 0 ] && printf '%s' "$out" | grep -q "usage:"; } && ok "--help exits 0 with the usage" || fail "--help exits 0 with the usage (exit $code)"
for flag in --history "--history HEAD" --pr-description --spans --log-detection; do
  # shellcheck disable=SC2086
  out=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" $flag 2>/dev/null); code=$?
  { [ "$code" -eq 2 ] && [ -z "$out" ]; } && ok "$flag without its argument is a usage error, exit 2" || fail "$flag without its argument is a usage error, exit 2 (exit $code)"
done
tip=$(git -C "$REPO" rev-parse HEAD)
out=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$tip" "$tip" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } && ok "an empty commit range is clean" || fail "an empty commit range is clean (exit $code)"

echo "each rule flags its shape, without its value"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "{\"$KEY_USER\": \"withheld\"}")
expects_one "$r" "$base" "$head" fix.txt key "withheld" && ok "a present contact key flags" || fail "a present contact key flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "{\"$KEY_SESSC\": \"$SESS_VAL\"}")
expects_one "$r" "$base" "$head" fix.txt key "$SESS_VAL" && ok "a present session key flags" || fail "a present session key flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "{\"$KEY_CRED\": \"$ORG_VAL\"}")
expects_one "$r" "$base" "$head" fix.txt key "$ORG_VAL" && ok "a present credential key flags" || fail "a present credential key flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "$KEY_ACCT: $ACCT_NUM")
expects_one "$r" "$base" "$head" fix.txt account-id "$ACCT_NUM" && ok "a populated account id field flags" || fail "a populated account id field flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "contact: $EMAIL")
expects_one "$r" "$base" "$head" fix.txt email "$EMAIL" && ok "an address flags" || fail "an address flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "write to $PLUS_EMAIL for the demo")
expects_one "$r" "$base" "$head" fix.txt email "$PLUS_EMAIL" && ok "a tagged subdomain address flags" || fail "a tagged subdomain address flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "owner $ORG_TOKEN")
expects_one "$r" "$base" "$head" fix.txt account-id "$ORG_TOKEN" && ok "an opaque org token flags" || fail "an opaque org token flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "relay $SESS_ID")
expects_one "$r" "$base" "$head" fix.txt account-id "$SESS_ID" && ok "an opaque session token flags" || fail "an opaque session token flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "account ref $UUID_V")
expects_one "$r" "$base" "$head" fix.txt account-id "$UUID_V" && ok "a UUID with account context flags" || fail "a UUID with account context flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "source under $HOME_PATH")
expects_one "$r" "$base" "$head" fix.txt private-path "$HOME_PATH" && ok "a home directory flags" || fail "a home directory flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "endpoint $PRIV_IP:8080")
expects_one "$r" "$base" "$head" fix.txt private-host "$PRIV_IP" && ok "a private IP flags" || fail "a private IP flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "relay at $CGNAT_IP:8080")
expects_one "$r" "$base" "$head" fix.txt private-host "$CGNAT_IP" && ok "a carrier-grade IP flags" || fail "a carrier-grade IP flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "node at $TAIL_HOST:8080")
expects_one "$r" "$base" "$head" fix.txt private-host "$TAIL_HOST" && ok "a tailnet name flags" || fail "a tailnet name flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "relay key $TOKEN_V")
expects_one "$r" "$base" "$head" fix.txt token "$TOKEN_V" && ok "a documented key prefix flags" || fail "a documented key prefix flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "auth $BEARER")
expects_one "$r" "$base" "$head" fix.txt token "$BEARER_V1$BEARER_V2" && ok "a Bearer credential flags" || fail "a Bearer credential flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "$DOTENV_LINE")
expects_one "$r" "$base" "$head" fix.txt dotenv "$DOTENV_LINE" && ok "a key-like assignment flags" || fail "a key-like assignment flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "$TRAILER")
expects_one "$r" "$base" "$head" fix.txt assistant-attribution "Imaginary Aide" && ok "an authorship trailer flags" || fail "an authorship trailer flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "$GENWITH")
expects_one "$r" "$base" "$head" fix.txt assistant-attribution "ImaginaryAide" && ok "a generated-with footer flags" || fail "a generated-with footer flags"

echo "clean shapes stay silent"
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt '{"userEmail": null}'); expects_silent "$r" "$last" "$head" && ok "a null key value is clean" || fail "a null key value is clean"; last=$head
head=$(commit_file "$r" b.txt "the userEmail field is redacted before promotion"); expects_silent "$r" "$last" "$head" && ok "a bare key name is clean" || fail "a bare key name is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "write noreply@no-such-vendor-413.net instead"); expects_silent "$r" "$last" "$head" && ok "a no-reply address is clean" || fail "a no-reply address is clean"; last=$head
head=$(commit_file "$r" b.txt "write someone@example.org for the demo"); expects_silent "$r" "$last" "$head" && ok "a reserved domain is clean" || fail "a reserved domain is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "see org-ab12 for the demo"); expects_silent "$r" "$last" "$head" && ok "a short org token is clean" || fail "a short org token is clean"; last=$head
head=$(commit_file "$r" b.txt "the session_context key holds the session"); expects_silent "$r" "$last" "$head" && ok "a key name with no digit is clean" || fail "a key name with no digit is clean"; last=$head
head=$(commit_file "$r" c.txt "schema example $UUID_V"); expects_silent "$r" "$last" "$head" && ok "a UUID with no id context is clean" || fail "a UUID with no id context is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "notes under ~/Code/notes.txt"); expects_silent "$r" "$last" "$head" && ok "a bare home reference is clean" || fail "a bare home reference is clean"; last=$head
head=$(commit_file "$r" b.txt "read /home/user/docs for the layout"); expects_silent "$r" "$last" "$head" && ok "a placeholder user is clean" || fail "a placeholder user is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "proxy at 127.0.0.1:9"); expects_silent "$r" "$last" "$head" && ok "loopback is clean" || fail "loopback is clean"; last=$head
head=$(commit_file "$r" b.txt "the relay moved to $PUB100 last month"); expects_silent "$r" "$last" "$head" && ok "a public address past the carrier-grade range is clean" || fail "a public address past the carrier-grade range is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "token: short"); expects_silent "$r" "$last" "$head" && ok "a short secret-field value is clean" || fail "a short secret-field value is clean"; last=$head
head=$(commit_file "$r" b.txt "auth Bearer <token> here"); expects_silent "$r" "$last" "$head" && ok "a placeholder Bearer credential is clean" || fail "a placeholder Bearer credential is clean"; last=$head
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" a.txt "TOKEN_TYPE=Bearer"); expects_silent "$r" "$last" "$head" && ok "a key-like name pointing elsewhere is clean" || fail "a key-like name pointing elsewhere is clean"; last=$head
head=$(commit_file "$r" b.txt "the commit trailer policy forbids crediting an assistant"); expects_silent "$r" "$last" "$head" && ok "attribution discussion without a trailer is clean" || fail "attribution discussion without a trailer is clean"; last=$head

echo "a line added and then deleted is still flagged"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
added=$(commit_file "$r" leak.txt "contact: $EMAIL")
( cd "$r" && git rm -q leak.txt && git commit -qm "delete the leak at the tip" >/dev/null )
gone=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$gone" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$added:leak.txt:1: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "the added commit is named, without the value" || fail "the added commit is named, without the value"

echo "commit messages are scanned with markers inert"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'ordinary public sample\n' > clean.txt && git add clean.txt \
  && git commit -qm "add the notes" -m "$TRAILER" >/dev/null )
head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:(message):3: assistant-attribution" ]; } \
  && ok "a trailer in a message is reported as its message line" || fail "a trailer in a message is reported as its message line (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'ordinary public sample\n' > clean.txt && git add clean.txt \
  && git commit -qm "note" -m "write to $EMAIL" >/dev/null )
head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:(message):3: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "an address in a message is reported without the value" || fail "an address in a message is reported without the value (exit $code)"
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=messages bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "a message finding is silent with messages switched off" || fail "a message finding is silent with messages switched off (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'ordinary public sample\n' > clean.txt && git add clean.txt \
  && git commit -qm "note" -m "write to $EMAIL  # $ALLOW email -- fixture" >/dev/null )
head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:(message):3: email" ]; } \
  && ok "marker text in a message suppresses nothing and faults nothing" || fail "marker text in a message suppresses nothing and faults nothing (exit $code)"

echo "merge resolutions are scanned once, never twice"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && git checkout -qb side >/dev/null && printf 'side line\n' > merge.txt \
  && git add merge.txt && git commit -qm "side work" >/dev/null && git checkout -q main \
  && printf 'main line\n' > merge.txt && git add merge.txt \
  && git commit -qm "main work" >/dev/null; git merge -q --no-commit side >/dev/null 2>&1; \
  printf 'contact: %s\n' "$EMAIL" > merge.txt && git add merge.txt \
  && git commit -qm "merge the side" >/dev/null )
merge=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$merge" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$merge:merge.txt:1: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a resolution carrying a suspect is reported under the merge" || fail "a resolution carrying a suspect is reported under the merge (exit $code)"
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=merges bash "$SCRUB" "$base" "$merge" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "a resolution is silent with merges switched off" || fail "a resolution is silent with merges switched off (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && git checkout -qb side "$base" >/dev/null )
side=$(commit_file "$r" leak.txt "contact: $EMAIL" "side leak")
( cd "$r" && git checkout -q main && git merge -q --no-ff -m "merge the side" side 2>/dev/null )
merge2=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$merge2" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$side:leak.txt:1: email" ]; } \
  && ok "a side branch finding is reported under its own commit only" || fail "a side branch finding is reported under its own commit only (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'contact: %s\n' "$EMAIL" > old.txt && git add old.txt \
  && git commit -qm "old leak" >/dev/null && printf 'ordinary\n' > quiet.txt \
  && git add quiet.txt && git commit -qm "quiet base" >/dev/null )
qbase=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'ordinary\n' > advance.txt && git add advance.txt \
  && git commit -qm "main advance" >/dev/null && git checkout -qb side3 "$qbase" >/dev/null \
  && printf 'ordinary\n' > side.txt && git add side.txt && git commit -qm "side advance" >/dev/null \
  && git checkout -q main && git merge -q --no-ff -m "merge the quiet side" side3 2>/dev/null )
merge3=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$qbase" "$merge3" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "lines published before the base merge quietly" || fail "lines published before the base merge quietly (exit $code)"

echo "marked lines stay silent, bad markers fault"
r=$(mkrepo); last=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" marked.txt "contact: $EMAIL  # $ALLOW email -- fixture relay address")
expects_silent "$r" "$last" "$head" && ok "a marked line stays silent" || fail "a marked line stays silent"; last=$head
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=markers bash "$SCRUB" "$last~1" "$last" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$off" = "$last:marked.txt:1: email" ]; } \
  && ok "a marked line flags with markers switched off" || fail "a marked line flags with markers switched off (exit $code)"
head=$(commit_file "$r" next.txt "$ALLOW_NEXT email -- fixture relay address
contact: $EMAIL")
expects_silent "$r" "$last" "$head" && ok "a next-line marker stays silent" || fail "a next-line marker stays silent"; last=$head
head=$(commit_file "$r" reasonless.txt "contact: $EMAIL  # $ALLOW email")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF "$head:reasonless.txt:1: marker"; } \
  && ok "a marker without a reason faults beside its finding" || fail "a marker without a reason faults beside its finding (exit $code)"; last=$head
head=$(commit_file "$r" unused.txt "ordinary public sample  # $ALLOW email -- nothing to suppress")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:unused.txt:1: marker" ]; } \
  && ok "a marker that suppresses nothing faults" || fail "a marker that suppresses nothing faults (exit $code)"
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=markers bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "an unused marker is silent with markers switched off" || fail "an unused marker is silent with markers switched off (exit $code)"; last=$head
head=$(commit_file "$r" unknown.txt "contact: $EMAIL  # $ALLOW emial -- typo in the rule")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF "$head:unknown.txt:1: marker"; } \
  && ok "a marker naming an unknown rule faults" || fail "a marker naming an unknown rule faults (exit $code)"; last=$head
head=$(commit_file "$r" prose.txt "the $ALLOW template marks made-up lines")
expects_silent "$r" "$last" "$head" && ok "marker-shaped text on a clean line is prose" || fail "marker-shaped text on a clean line is prose"; last=$head
head=$(commit_file "$r" quoted.txt "$ALLOW email -- for $EMAIL")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF "$head:quoted.txt:1: email" && ! leaked "$out" "$EMAIL"; } \
  && ok "a reason quoting a suspect flags, without the value" || fail "a reason quoting a suspect flags, without the value (exit $code)"

echo "pull request text scans like a message"
r=$(mkrepo)
printf 'Ship the relay.\n\nContact: %s\n' "$EMAIL" > "$r/pr.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --pr-description pr.md 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "(pr-description):3: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a suspect in the description is reported without the value" || fail "a suspect in the description is reported without the value (exit $code)"
printf 'Ship the relay.\n' > "$r/clean.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --pr-description clean.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "a clean description stays silent" || fail "a clean description stays silent (exit $code)"
printf 'Contact: %s  # %s email -- fixture\n' "$EMAIL" "$ALLOW" > "$r/marked.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --pr-description marked.md 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "(pr-description):1: email" ]; } \
  && ok "marker text in the description suppresses nothing" || fail "marker text in the description suppresses nothing (exit $code)"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --pr-description no-such.md 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ -z "$out" ]; } \
  && ok "a missing description exits 2" || fail "a missing description exits 2 (exit $code)"

echo "every reported finding is logged, never its value"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" logged.txt "contact: $EMAIL")
rm -f "$tmp/o.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/o.jsonl" bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"), e[0].get("line"))' "$tmp/o.jsonl" 2>/dev/null)
{ [ "$code" -eq 1 ] && [ "$entry" = "1 email logged.txt 1" ]; } \
  && ok "a reported finding is logged once, by rule, file and line" || fail "a reported finding is logged once, by rule, file and line (exit $code)"
centry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(e[0].get("commit"))' "$tmp/o.jsonl" 2>/dev/null)
[ "$centry" = "$head" ] && ok "the log names the commit" || fail "the log names the commit"
if grep -qF -- "$EMAIL" "$tmp/o.jsonl" 2>/dev/null; then fail "a logged finding logs no value"
else ok "a logged finding logs no value"; fi
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fault.txt "ordinary  # $ALLOW email -- nothing to suppress")
rm -f "$tmp/o2.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/o2.jsonl" bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ ! -e "$tmp/o2.jsonl" ]; } \
  && ok "a marker fault is reported but never logged" || fail "a marker fault is reported but never logged (exit $code)"
rm -f "$tmp/o3.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/o3.jsonl" bash "$SCRUB" "$base" "$base" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ ! -e "$tmp/o3.jsonl" ]; } \
  && ok "a clean scan writes nothing" || fail "a clean scan writes nothing (exit $code)"
printf 'Contact: %s\n' "$EMAIL" > "$r/dirty.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/no-such-dir/o.jsonl" bash "$SCRUB" --pr-description dirty.md 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ -z "$out" ]; } && ok "a log that cannot be written fails the check, exit 2" || fail "a log that cannot be written fails the check, exit 2 (exit $code)"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=key bash "$SCRUB" "$base" "$base" 2>&1); code=$?
{ [ "$code" -eq 0 ] && printf '%s' "$out" | grep -q "disabled"; } \
  && ok "a switched-off rule is named on stderr" || fail "a switched-off rule is named on stderr (exit $code)"

echo "--log-detection appends one detection"
r=$(mkrepo)
rm -f "$tmp/c.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/c.jsonl" bash "$SCRUB" --log-detection email notes/contact.txt 3 "$head" 2>/dev/null); code=$?
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"), e[0].get("line"), e[0].get("commit"))' "$tmp/c.jsonl" 2>/dev/null)
{ [ "$code" -eq 0 ] && [ -z "$out" ] && [ "$entry" = "1 email notes/contact.txt 3 $head" ]; } \
  && ok "a well-formed call appends its detection" || fail "a well-formed call appends its detection (exit $code)"
for bad in "marker f.txt 1" "no-such-rule f.txt 1" "email f.txt x" "email f.txt 1 short"; do
  # shellcheck disable=SC2086
  out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/c.jsonl" bash "$SCRUB" --log-detection $bad 2>/dev/null); code=$?
  { [ "$code" -eq 2 ] && [ -z "$out" ]; } && ok "--log-detection refuses $bad, exit 2" || fail "--log-detection refuses $bad, exit 2 (exit $code)"
done
rm -f "$tmp/c0.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/c0.jsonl" bash "$SCRUB" --log-detection email f.txt 0 2>/dev/null); code=$?
entry0=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("line"))' "$tmp/c0.jsonl" 2>/dev/null)
{ [ "$code" -eq 0 ] && [ -z "$out" ] && [ "$entry0" = "1 email 0" ]; } \
  && ok "line 0 appends, for findings on the file's name" || fail "line 0 appends, for findings on the file's name (exit $code)"
rm -f "$tmp/c2.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --log-detection email f.txt 1 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ ! -e "$tmp/c2.jsonl" ]; } \
  && ok "an unset log appends nothing, exit 0" || fail "an unset log appends nothing, exit 0 (exit $code)"

echo "--spans names each finding by file index and offsets"
r=$(mkrepo)
printf 'contact: %s\nordinary public sample\n' "$EMAIL" > "$r/a.txt"
printf 'ordinary\n' > "$r/b.txt"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --spans a.txt b.txt 2>/dev/null); code=$?
slice=$(cd "$r" && printf '%s' "$out" | python3 -c '
import sys
row = sys.stdin.read().splitlines()
assert len(row) == 1, row
i, line, start, end, rule = row[0].split(":")
assert (i, line, rule) == ("0", "1", "email"), row
body = open("a.txt", encoding="utf-8").read().splitlines()[0]
print(body[int(start):int(end)])
' 2>/dev/null)
{ [ "$code" -eq 0 ] && [ "$slice" = "$EMAIL" ]; } \
  && ok "a span covers its finding exactly" || fail "a span covers its finding exactly (exit $code)"
if leaked "$out" "$EMAIL"; then fail "a span report prints no value"; else ok "a span report prints no value"; fi
printf 'ordinary  # %s email -- nothing to suppress\n' "$ALLOW" > "$r/f.txt"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --spans f.txt 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && printf '%s' "$out" | grep -qE '^0:1:[0-9]+:[0-9]+:marker$'; } \
  && ok "a marker fault is a span of its own" || fail "a marker fault is a span of its own (exit $code)"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --spans no-such.txt 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ -z "$out" ]; } \
  && ok "spans on a missing file exits 2" || fail "spans on a missing file exits 2 (exit $code)"

echo "each control fails when its rule is switched off"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "{\"$KEY_USER\": \"withheld\"}")
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=key bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "a key finding is silent with key switched off" || fail "a key finding is silent with key switched off (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "relay at $CGNAT_IP:8080")
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=private-host bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "a host finding is silent with private-host switched off" || fail "a host finding is silent with private-host switched off (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" fix.txt "$DOTENV_LINE")
off=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= SCRUB_CHECK_DISABLE=dotenv bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$off" ]; } \
  && ok "a dotenv finding is silent with dotenv switched off" || fail "a dotenv finding is silent with dotenv switched off (exit $code)"

echo "the check's own tests"
selfout=$(cd "$REPO" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --self-test 2>/dev/null); code=$?
[ "$code" -eq 0 ] && ok "the self-test passes" || fail "the self-test passes (exit $code)"
for rule in key email account-id private-path private-host token dotenv assistant-attribution; do
  pos=$(printf '%s' "$selfout" | grep -c "^  ok   pos $rule:")
  neg=$(printf '%s' "$selfout" | grep -c "^  ok   neg $rule:")
  { [ "$pos" -ge 3 ] && [ "$neg" -ge 3 ]; } \
    && ok "$rule carries three positives and three negatives ($pos+$neg)" \
    || fail "$rule carries three positives and three negatives ($pos+$neg)"
done
[ ! -e "$REPO/scripts/scrub-check.allow" ] && [ -z "$(ls "$REPO"/scripts/*.allow 2>/dev/null)" ] \
  && ok "no exceptions file ships" || fail "no exceptions file ships"
if grep -r "allowlist" "$REPO/scripts/" 2>/dev/null | grep -q .; then fail "no allowlist machinery"
else ok "no allowlist machinery"; fi

echo "the rewrite clears history without touching the tree"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
leak=$(commit_file "$r" notes/contact.txt "contact: $EMAIL")
( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
saved=$(git -C "$r" rev-parse "HEAD^{tree}")
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>"$tmp/rw.err"); code=$?
[ "$code" -eq 0 ] && ok "a historical finding is rewritten" || fail "a historical finding is rewritten (exit $code)"
[ "$(git -C "$r" rev-parse "HEAD^{tree}")" = "$saved" ] \
  && ok "the final tree is unchanged" || fail "the final tree is unchanged"
printf '%s' "$out" | grep -qF "$leak:notes/contact.txt:1: email removed" \
  && ok "the removal names its commit, file, line and rule" || fail "the removal names its commit, file, line and rule"
if leaked "$out" "$EMAIL" || grep -qF -- "$EMAIL" "$tmp/rw.err" 2>/dev/null; then fail "a rewrite prints no value"
else ok "a rewrite prints no value"; fi
rescan=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" HEAD 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$rescan" ]; } \
  && ok "the rewritten range scans clean" || fail "the rewritten range scans clean (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" notes/contact.txt "contact: $EMAIL" >/dev/null
tip=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ "$(git -C "$r" rev-parse HEAD)" = "$tip" ]; } \
  && ok "a finding at the tip refuses with the branch untouched" || fail "a finding at the tip refuses with the branch untouched (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" notes/contact.txt "contact: $EMAIL" >/dev/null
tip=$(git -C "$r" rev-parse HEAD)
git init -q --bare "$tmp/rw-remote.git"
( cd "$r" && git remote add origin "$tmp/rw-remote.git" && git push -q origin HEAD 2>/dev/null )
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ "$(git -C "$r" rev-parse HEAD)" = "$tip" ]; } \
  && ok "a pushed branch refuses with the branch untouched" || fail "a pushed branch refuses with the branch untouched (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && printf 'ordinary\n' > notes.txt && git add notes.txt \
  && git commit -qm "add the notes" -m "$TRAILER" >/dev/null )
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
rescan=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" HEAD 2>/dev/null); rcode=$?
{ [ "$code" -eq 0 ] && [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
  && ok "a trailer in an earlier message is stripped" || fail "a trailer in an earlier message is stripped (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" notes/contact.txt "contact: $EMAIL" >/dev/null
( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
( cd "$r" && git checkout -qb side >/dev/null && printf 'side\n' > side.txt \
  && git add side.txt && git commit -qm side >/dev/null && git checkout -q main \
  && printf 'main\n' > main.txt && git add main.txt && git commit -qm mainwork >/dev/null \
  && git merge -q --no-ff -m "merge the side" side 2>/dev/null )
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ "$(git -C "$r" rev-list --parents -n 1 HEAD | wc -w)" -eq 3 ]; } \
  && ok "a clean merge keeps both parents through a rewrite" || fail "a clean merge keeps both parents through a rewrite (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && git checkout -qb side >/dev/null \
  && printf 'contact: %s\n' "$EMAIL" > merge.txt && git add merge.txt \
  && git commit -qm side >/dev/null && git checkout -q main \
  && printf 'main\n' > merge.txt && git add merge.txt && git commit -qm mainwork >/dev/null; \
  git merge -q --no-commit side >/dev/null 2>&1; \
  printf 'contact: %s\n' "$EMAIL" > merge.txt && git add merge.txt \
  && git commit -qm "merge the side" >/dev/null )
tip=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ "$(git -C "$r" rev-parse HEAD)" = "$tip" ]; } \
  && ok "a merge carrying a finding refuses with the branch untouched" || fail "a merge carrying a finding refuses with the branch untouched (exit $code)"

echo "promotion scrubs, checks again, and completes only when clean"
r=$(mkrepo)
printf 'Reach the relay at %s for pings.\n' "$EMAIL" > "$tmp/pm-dirty.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-dirty.md" raw/trials/t413/notes.md 2>"$tmp/pm.err"); code=$?
[ "$code" -eq 0 ] && ok "a dirty file completes scrubbed" || fail "a dirty file completes scrubbed (exit $code)"
if grep -qF -- "$EMAIL" "$r/raw/trials/t413/notes.md" 2>/dev/null; then fail "the copy holds no value"
elif grep -qF '<redacted:email>' "$r/raw/trials/t413/notes.md" 2>/dev/null; then ok "the copy holds a placeholder naming its rule"
else fail "the copy holds a placeholder naming its rule"; fi
if leaked "$out" "$EMAIL" || grep -qF -- "$EMAIL" "$tmp/pm.err" 2>/dev/null; then fail "a scrub prints no value"
else ok "a scrub prints no value"; fi
printf '%s' "$out" | grep -qF 'raw/trials/t413/notes.md:1: email scrubbed' \
  && ok "a scrub reports its rule, file and line" || fail "a scrub reports its rule, file and line"
cmp -s "$tmp/pm-dirty.md" <(printf 'Reach the relay at %s for pings.\n' "$EMAIL") \
  && ok "the original is untouched" || fail "the original is untouched"
[ ! -e "$r/wiki/log.md" ] && ok "a scrub records no ruling" || fail "a scrub records no ruling"
recheck=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --files raw/trials/t413/notes.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$recheck" ]; } \
  && ok "the copy checks clean again" || fail "the copy checks clean again (exit $code)"
r=$(mkrepo)
printf 'ordinary  # %s email -- nothing to suppress\n' "$ALLOW" > "$tmp/pm-fault.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-fault.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ ! -e "$r/raw/trials/t413/notes.md" ] && printf '%s' "$out" | grep -qE ': marker$'; } \
  && ok "a marker fault is refused with nothing copied" || fail "a marker fault is refused with nothing copied (exit $code)"
r=$(mkrepo)
printf 'Reach the relay at %s.  # %s email -- made-up relay address\n' "$EMAIL" "$ALLOW" > "$tmp/pm-marked.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-marked.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && grep -qF -- "$EMAIL" "$r/raw/trials/t413/notes.md" 2>/dev/null; } \
  && ok "marked made-up data travels verbatim" || fail "marked made-up data travels verbatim (exit $code)"
r=$(mkrepo)
printf 'The relay ran its checks and stayed green.\n' > "$tmp/pm-clean.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ] && cmp -s "$tmp/pm-clean.md" "$r/raw/trials/t413/notes.md"; } \
  && ok "a clean file promotes silently and whole" || fail "a clean file promotes silently and whole (exit $code)"
r=$(mkrepo)
printf 'clean\n' > "$tmp/pm-out.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-out.md" notes/elsewhere.md 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ ! -e "$r/notes/elsewhere.md" ]; } \
  && ok "a destination outside raw/ is refused" || fail "a destination outside raw/ is refused (exit $code)"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" --ruled 'a ruling' "$tmp/pm-out.md" raw/t413/x.md 2>/dev/null); code=$?
{ [ "$code" -eq 2 ] && [ ! -e "$r/raw/t413/x.md" ]; } \
  && ok "the removed ruling flag is a usage error" || fail "the removed ruling flag is a usage error (exit $code)"
r=$(mkrepo)
printf 'Reach the relay at %s.\n' "$EMAIL" > "$tmp/pm-logged.md"
rm -f "$tmp/pm.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/pm.jsonl" bash "$PROMOTE" "$tmp/pm-logged.md" raw/t/t413.md 2>/dev/null); code=$?
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"))' "$tmp/pm.jsonl" 2>/dev/null)
{ [ "$code" -eq 0 ] && [ "$entry" = "1 email" ] && ! grep -qF -- "$EMAIL" "$tmp/pm.jsonl" 2>/dev/null; } \
  && ok "a scrubbed finding is logged once, without the value" || fail "a scrubbed finding is logged once, without the value (exit $code)"

echo "the tree check holds the change to both halves"
r=$(mkrepo); head=$(git -C "$r" rev-parse HEAD)
mkdir -p "$r/.postmaster/verify" && printf 'run record\n' > "$r/.postmaster/verify/checks.json"
( cd "$r" && git add .postmaster/verify/checks.json )
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$TREE" main "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/verify/checks.json'; } \
  && ok "a staged .postmaster/ file fails, named" || fail "a staged .postmaster/ file fails, named (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" .postmaster/project.toml '[project]' >/dev/null
head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$TREE" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "the shared project.toml is exempt" || fail "the shared project.toml is exempt (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" raw/trials/t413/notes.md "Reach the relay at $EMAIL for pings." >/dev/null
head=$(git -C "$r" rev-parse HEAD)
rm -f "$tmp/t.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/t.jsonl" bash "$TREE" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/trials/t413/notes.md:1:'; } \
  && ok "an added raw/ file carrying a suspect fails, named" || fail "an added raw/ file carrying a suspect fails, named (exit $code)"
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"), e[0].get("line"))' "$tmp/t.jsonl" 2>/dev/null)
[ "$entry" = "1 email raw/trials/t413/notes.md 1" ] \
  && ok "a raw/ fault is logged once, under its real path" || fail "a raw/ fault is logged once, under its real path ($entry)"

echo "the wiki lint holds pages to paths, hosts and quotation"
wl() {  # wl <target>: a scratch wiki fixture with one concept, printed
  local d
  d=$(mktemp -d -p "$tmp") || return 1
  mkdir -p "$d/wiki/concepts" "$d/raw"
  printf -- '---\ntitle: i\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\n- [c](concepts/c.md)\n' > "$d/wiki/index.md"
  printf -- '---\ntitle: c\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n' > "$d/wiki/concepts/c.md"
  printf '%s' "$d"
}
w=$(wl)
printf 'See %s%s%s/notes.txt for the log.\n' "$HOME_P" "$HOME_O" "$HOME_U-413" >> "$w/wiki/concepts/c.md"
rm -f "$tmp/w.jsonl"
out=$(POSTMASTER_DETECTIONS_LOG="$tmp/w.jsonl" bash "$LINT" "$w" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'private-path'; } \
  && ok "a page carrying a private path fails" || fail "a page carrying a private path fails (exit $code)"
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"))' "$tmp/w.jsonl" 2>/dev/null)
[ "$entry" = "1 private-path" ] \
  && ok "a page fault is logged once" || fail "a page fault is logged once ($entry)"
w=$(wl)
printf 'Reach the relay at %s for pings.\n' "$EMAIL" >> "$w/wiki/concepts/c.md"
rm -f "$tmp/w2.jsonl"
out=$(POSTMASTER_DETECTIONS_LOG="$tmp/w2.jsonl" bash "$LINT" "$w" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ ! -e "$tmp/w2.jsonl" ]; } \
  && ok "a page carrying only an address passes unlogged" || fail "a page carrying only an address passes unlogged (exit $code)"
w=$(wl)
QLINE='The staging relay counted four hundred thirteen spans on the quiet Tuesday run.'
printf '%s\n' "$QLINE" > "$w/raw/evidence.txt"
printf '%s\n' "$QLINE" >> "$w/wiki/concepts/c.md"
out=$(POSTMASTER_DETECTIONS_LOG= bash "$LINT" "$w" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'repeats raw/'; } \
  && ok "a page line quoting raw/ fails" || fail "a page line quoting raw/ fails (exit $code)"

echo "the poll reports untold detections, the runner sets the log"
pollroot=$tmp/poll; mkdir -p "$pollroot/tell" "$pollroot/told" "$pollroot/part"
DET='{"commit":"","file":"notes.txt","line":1,"rule":"email","ts":"2026-09-29T00:00:00Z"}'
DET2='{"commit":"","file":"notes.txt","line":2,"rule":"token","ts":"2026-09-29T00:01:00Z"}'
for n in tell told part; do
  printf '{"migration":"m1","spec":{},"stage":"review","leg":2}' > "$pollroot/$n/manifest.json"
done
printf '%s\n' "$DET" > "$pollroot/tell/detections.jsonl"
printf '%s\n' "$DET" > "$pollroot/told/detections.jsonl"
printf '%s\n' "$DET" > "$pollroot/told/.detections-told"
printf '%s\n%s\n' "$DET" "$DET2" > "$pollroot/part/detections.jsonl"
printf '%s\n' "$DET" > "$pollroot/part/.detections-told"
out=$(bash "$STATUS" "$pollroot" 2>/dev/null); code=$?
next_of() { printf '%s\n' "$out" | awk -v r="$1" '$1==r{print $NF}'; }
{ [ "$code" -eq 0 ] && [ "$(next_of tell)" = TELL ]; } \
  && ok "a run with an untold detection is TELL" || fail "a run with an untold detection is TELL"
{ [ "$(next_of told)" = WAIT ] && [ "$(next_of part)" = TELL ]; } \
  && ok "a fully told log is WAIT, a partly told one TELL" || fail "a fully told log is WAIT, a partly told one TELL"
vproj=$tmp/vproj; mkdir -p "$vproj/.postmaster"
cat > "$vproj/.postmaster/project.toml" <<EOF
[checks.gate]
command = "true"
shows = "x"
[checks.probe]
command = '$SCRUB --log-detection email probe.txt 1'
shows = "x"
EOF
( cd "$vproj" && git init -q -b main . && git config user.name Oracle \
  && git config user.email "oracle@example.invalid" && git add -A && git add -f .postmaster/project.toml \
  && git commit -qm base )
vd="$vproj/.postmaster/runs/T-9"; mkdir -p "$vd"; printf '## Ticket\nx\n' > "$vd/brief.md"
bash "$VERIFY" record "$vproj" "$vd" >/dev/null 2>&1
( cd "$vproj" && git worktree add -q "$vproj/.worktrees/T-9-a" -b wb/T-9-a 2>/dev/null )
bash "$VERIFY" arm "$vproj/.worktrees/T-9-a" "$vd" >/dev/null 2>&1
out=$(bash "$VERIFY" run "$vproj/.worktrees/T-9-a" "$vd" 2>&1); code=$?
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"))' "$vd/detections.jsonl" 2>/dev/null)
{ [ "$code" -eq 0 ] && [ "$entry" = "1 email probe.txt" ]; } \
  && ok "a check's detection lands in the run's log" || fail "a check's detection lands in the run's log (exit $code)"

echo "the gate declares and runs the checks"
for c in checks.scrub checks.tree checks.wiki-lint; do
  grep -qF "[$c]" "$REPO/.postmaster/project.toml" \
    && ok "$c is declared" || fail "$c is declared"
done
for n in raw-promote scrub-check scrub-rewrite tree-check verify-merge; do
  grep -qF "$n" "$REPO/.postmaster/project.toml" \
    && ok "$n self-tests in the gate" || fail "$n self-tests in the gate"
done
count=$(python3 -c 'import re; m=re.search(r"for n in (.*?); do", open("'"$REPO"'/.postmaster/project.toml").read()); print(len(m.group(1).split()))')
[ "$count" = "45" ] && ok "the gate runs 45 self-tests" || fail "the gate runs 45 self-tests ($count)"
out=$(cd "$REPO" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$BASE_ARG" "$HEAD_ARG" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "the change's own range scans clean" || fail "the change's own range scans clean (exit $code)"
out=$(cd "$REPO" && POSTMASTER_DETECTIONS_LOG= bash "$TREE" "$BASE_ARG" "$HEAD_ARG" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "the change's own tree checks clean" || fail "the change's own tree checks clean (exit $code)"
out=$(cd "$REPO" && POSTMASTER_DETECTIONS_LOG= bash "$LINT" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "the wiki lints clean" || fail "the wiki lints clean (exit $code)"
grep -q "scrub-check" "$REPO/raw/README.md" && grep -q "backstop" "$REPO/raw/README.md" \
  && grep -q "not a proof" "$REPO/raw/README.md" \
  && ok "the evidence guide names the check and its backstop" || fail "the evidence guide names the check and its backstop"
allowed='^(argparse|ast|base64|collections|configparser|datetime|difflib|enum|fnmatch|functools|getopt|glob|hashlib|hmac|io|ipaddress|itertools|json|locale|logging|math|mimetypes|os|pathlib|platform|plistlib|pprint|queue|random|re|secrets|selectors|shlex|shutil|signal|socket|ssl|stat|statistics|string|struct|subprocess|sys|tarfile|tempfile|textwrap|threading|time|traceback|typing|unicodedata|unittest|urllib|uuid|warnings|weakref|xml|zipfile|zlib)$'
foreign=$(grep -hoE '^[ \t]*(import|from) [a-zA-Z0-9_]+' "$SCRUB" "$TREE" "$LINT" "$PROMOTE" "$REWRITE" "$STATUS" "$VERIFY" "$MERGE" \
  | awk '{print $NF}' | cut -d. -f1 | sort -u | grep -vE "$allowed" || true)
[ -z "$foreign" ] && ok "the checks need nothing beyond the standard library" || fail "the checks need nothing beyond the standard library ($foreign)"

echo "large files stream"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
python3 -c 'print(("clean relay line 413 pad " * 100 + "\n") * 70000, end="")' > "$r/big.txt"
printf 'contact: %s\n' "$EMAIL" >> "$r/big.txt"
limited=$(cd "$r" && bash -c 'ulimit -v 262144 || exit 99; exec bash "$0" --files big.txt' "$SCRUB" 2>/dev/null); code=$?
if [ "$code" -eq 99 ]; then ok "a large file streams under a small address space: skipped, no address-space limit here"
elif [ "$code" -eq 1 ] && [ "$limited" = "big.txt:70001: email" ] && ! leaked "$limited" "$EMAIL"; then
  ok "a large file streams under a small address space"
else fail "a large file streams under a small address space (exit $code)"; fi

echo "the round-3 repairs hold at the interfaces"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" plus.txt "++ contact: $EMAIL")
expects_one "$r" "$base" "$head" plus.txt email "$EMAIL" && ok "a plus-prefixed content line flags" || fail "a plus-prefixed content line flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && git checkout -qb side >/dev/null && printf 'side line\n' > merge.txt \
  && git add merge.txt && git commit -qm "side work" >/dev/null && git checkout -q main \
  && printf 'main line\n' > merge.txt && git add merge.txt \
  && git commit -qm "main work" >/dev/null; git merge -q --no-commit side >/dev/null 2>&1; \
  printf '++ contact: %s\n' "$EMAIL" > merge.txt && git add merge.txt \
  && git commit -qm "merge the side" >/dev/null )
merge=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$merge" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$merge:merge.txt:1: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a plus-prefixed resolution line flags" || fail "a plus-prefixed resolution line flags (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" j.jsonl "{\"text\": \"first line\\n$HOME_PATH/x\"}")
expects_one "$r" "$base" "$head" j.jsonl private-path "$HOME_PATH" && ok "an escaped value inside JSON flags" || fail "an escaped value inside JSON flags"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" ansi.log "$(printf 'prefix \033[32m%s\033[0m suffix' "$HOME_PATH")")
expects_one "$r" "$base" "$head" ansi.log private-path "$HOME_PATH" && ok "a color-wrapped value flags" || fail "a color-wrapped value flags"
r=$(mkrepo)
python3 -c 'print("".join("public line %d\n" % n for n in range(1, 31)), end="")' > "$r/gap.txt"
( cd "$r" && git add gap.txt && git commit -qm "gap base" >/dev/null ); last=$(git -C "$r" rev-parse HEAD)
python3 -c 'import sys; lines = open(sys.argv[1]).read().splitlines(keepends=True); lines[0] = sys.argv[2] + "\n"; lines[19] = sys.argv[3] + "\n"; open(sys.argv[1], "w").write("".join(lines))' \
  "$r/gap.txt" "# $ALLOW_NEXT email -- stray marker" "contact: $EMAIL"
( cd "$r" && git add gap.txt && git commit -qm "gap the marker" >/dev/null ); head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$last" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:gap.txt:1: marker
$head:gap.txt:20: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a marker across a hunk gap faults beside its finding, never crashes" || fail "a marker across a hunk gap faults beside its finding, never crashes (exit $code)"
r=$(mkrepo)
{ printf '{"%s": "write to %s soon"}\n' "$KEY_USER" "$EMAIL"
  printf '{"%s": "%s"}\n' "$KEY_USER" "$EMAIL"; } > "$tmp/pm-overlap.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-overlap.md" raw/trials/t413/overlap.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && cmp -s "$r/raw/trials/t413/overlap.md" <(printf '{"%s": "<redacted:key>"}\n{"%s": "<redacted:email>"}\n' "$KEY_USER" "$KEY_USER"); } \
  && ok "overlapping spans scrub outer-first, ties to the first span" || fail "overlapping spans scrub outer-first, ties to the first span (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" "$EMAIL.txt" "just public words here" "shaped name")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:[redacted]:0: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "an added file with a shaped name is reported at line 0, redacted" || fail "an added file with a shaped name is reported at line 0, redacted (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" marked.txt "contact: $EMAIL  # $ALLOW email -- fixture relay address")
rm -f "$tmp/v6.jsonl"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG="$tmp/v6.jsonl" bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("via"))' "$tmp/v6.jsonl" 2>/dev/null)
{ [ "$code" -eq 0 ] && [ -z "$out" ] && [ "$entry" = "1 email marker" ] && ! grep -qF -- "$EMAIL" "$tmp/v6.jsonl" 2>/dev/null; } \
  && ok "a suppressed match is logged with its marker resolution, never its value" || fail "a suppressed match is logged with its marker resolution, never its value (exit $code)"
mkdir -p "$tmp/v7/done" "$tmp/v7/abandoned"
printf '{"migration":"m1","spec":{},"stage":"done","leg":2}' > "$tmp/v7/done/manifest.json"
printf '{"migration":"m1","spec":{},"stage":"abandoned","leg":2}' > "$tmp/v7/abandoned/manifest.json"
printf '%s\n' "$DET" > "$tmp/v7/done/detections.jsonl"
printf '%s\n' "$DET" > "$tmp/v7/abandoned/detections.jsonl"
out=$(bash "$STATUS" "$tmp/v7" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ "$(printf '%s\n' "$out" | awk '$1=="done"{print $NF}')" = TELL ] \
  && [ "$(printf '%s\n' "$out" | awk '$1=="abandoned"{print $NF}')" = TELL ]; } \
  && ok "terminal runs with untold detections are TELL" || fail "terminal runs with untold detections are TELL"
r=$(mkrepo)
mkdir -p "$r/src413" && printf 'all public words\n' > "$r/src413/a.txt"
mkdir -p "$tmp/v8shim" && printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/v8shim/find" && chmod +x "$tmp/v8shim/find"
out=$(cd "$r" && PATH="$tmp/v8shim:$PATH" POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" src413 raw/runs/f413 2>&1); code=$?
{ [ "$code" -eq 2 ] && [ ! -e "$r/raw/runs/f413" ]; } \
  && ok "a failed source enumeration refuses the copy" || fail "a failed source enumeration refuses the copy (exit $code)"
r=$(mkrepo)
mkdir -p "$r/src413" && printf 'all public words\n' > "$r/src413/$EMAIL.txt"
mkdir -p "$tmp/v9shim"
printf '#!/usr/bin/env bash\nfor a in "$@"; do case $a in -*) continue;; *) rm -f "$a"; break;; esac; done\nexec /bin/cp "$@"\n' > "$tmp/v9shim/cp" && chmod +x "$tmp/v9shim/cp"
out=$(cd "$r" && PATH="$tmp/v9shim:$PATH" POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" src413 raw/runs/c413 2>&1); code=$?
{ [ "$code" -eq 2 ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a failed copy prints no shaped path" || fail "a failed copy prints no shaped path (exit $code)"
r=$(mkrepo)
printf 'contact: %s ok \xff tail\n' "$EMAIL" > "$tmp/pm-invalid.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-invalid.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && cmp -s "$r/raw/trials/t413/notes.md" <(printf 'contact: <redacted:email> ok \xff tail\n'); } \
  && ok "bytes outside the span survive the scrub" || fail "bytes outside the span survive the scrub (exit $code)"
r=$(mkrepo)
python3 -c "
lines = ['public filler line %d with padding words to add bulk volume here' % i for i in range(400000)]
lines[200000] = 'contact: $EMAIL'
open('$tmp/pm-big.md', 'w').write('\n'.join(lines) + '\n')
"
limited=$(cd "$r" && bash -c 'ulimit -v 65536 || exit 99; exec bash "$0" "$1" raw/trials/t413/big.md' "$PROMOTE" "$tmp/pm-big.md" 2>&1); code=$?
if [ "$code" -eq 99 ]; then ok "a large dirty file promotes under a small address space: skipped, no address-space limit here"
elif [ "$code" -eq 0 ] && grep -qF '<redacted:email>' "$r/raw/trials/t413/big.md" 2>/dev/null; then
  ok "a large dirty file promotes under a small address space"
else fail "a large dirty file promotes under a small address space (exit $code)"; fi
w=$(wl)
printf 'See %s%s%s-413/notes.txt for the log.  <!-- %s private-path -- made-up -->\n' "$HOME_P" "$HOME_O" "$HOME_U" "$ALLOW" >> "$w/wiki/concepts/c.md"
out=$(POSTMASTER_DETECTIONS_LOG= bash "$LINT" "$w" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'private-path'; } \
  && ok "a marked path on a page still faults, markers inert" || fail "a marked path on a page still faults, markers inert (exit $code)"
w=$(wl)
QE2='contact-relay-414'; QH2='quiet-relay-414'; QT2='net'
printf -- '---\ntitle: qp\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n' > "$w/wiki/concepts/$QE2@$QH2.$QT2.md"
printf '\n- [qp](concepts/%s@%s.%s.md)\n' "$QE2" "$QH2" "$QT2" >> "$w/wiki/index.md"
QL4='The staging relay tallied four hundred fifteen spans on the Thursday run.'
printf '%s\n' "$QL4" > "$w/raw/evidence.txt"
printf '%s\n' "$QL4" >> "$w/wiki/concepts/$QE2@$QH2.$QT2.md"
out=$(POSTMASTER_DETECTIONS_LOG= bash "$LINT" "$w" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'repeats raw/' \
  && printf '%s' "$out" | grep -qF '[redacted]' && ! leaked "$out" "$QE2@$QH2.$QT2"; } \
  && ok "a quote fault on a shaped page path redacts the path" || fail "a quote fault on a shaped page path redacts the path (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
MAIL_FIELD='mail'
json=$(printf '{"%s": "%s", "note": "x # %s email -- made-up"}' "$MAIL_FIELD" "$EMAIL" "$ALLOW")
head=$(commit_file "$r" j.jsonl "$json")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:j.jsonl:1: email
$head:j.jsonl:1: key
$head:j.jsonl:1: marker" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a marker in another field neither suppresses nor passes" || fail "a marker in another field neither suppresses nor passes (exit $code)"
echo "round-5 repairs: shared causes and the merge scan"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" split.txt "$(printf '{"ownerM\033[0mail": "%s"}' "$SESS_VAL")")
expects_one "$r" "$base" "$head" split.txt key "$SESS_VAL" && ok "a name split by an escape still matches by its ending" || fail "a name split by an escape still matches by its ending"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
outer=$(python3 -c 'import json,sys; print(json.dumps({"outer": sys.argv[1]}))' "$(printf '{"%s": "%s"}' "$MAIL_FIELD" "$EMAIL")")
head=$(commit_file "$r" nest.jsonl "$outer")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:nest.jsonl:1: email
$head:nest.jsonl:1: key" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "a suspect nested two strings deep flags" || fail "a suspect nested two strings deep flags (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
content=$(printf 'aws_secret_access_key: %s\ndb_password: "%s"\nPOSTGRES_PASSWORD=%s\n' "$TOKEN_V" "$TOKEN_V" "$TOKEN_V")
head=$(commit_file "$r" comp.txt "$content")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:comp.txt:1: token
$head:comp.txt:2: token
$head:comp.txt:3: dotenv
$head:comp.txt:3: token" ] && ! leaked "$out" "$TOKEN_V"; } \
  && ok "compound secret endings flag" || fail "compound secret endings flag (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
{ printf '%s%s\n' "$PGP_H" "$PGP_T"
  printf '%s%s\n' "$PUTTY_H" "$PUTTY_V"
  printf '%s%s\n' "$SSH2_H" "$SSH2_T"
  printf '%s%s%s%s\n' "$AGE_A" "$AGE_S" "$AGE_K" "$AGE_B"
  printf '%s%s\n%s\n%s\n%s%s\n' "$PEM_HEAD" "$PEM_T" "$BODY1" "$BODY2" "$PEM_END" "$PEM_T"; } > "$tmp/keys.txt"
cp "$tmp/keys.txt" "$r/keys.txt"
( cd "$r" && git add keys.txt && git commit -qm "add keys" >/dev/null ); head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$(printf '%s' "$out" | grep -c ': token$')" -eq 8 ] && ! leaked "$out" "$BODY1"; } \
  && ok "every key format flags its every line" || fail "every key format flags its every line (exit $code)"
r=$(mkrepo)
( cd "$r" && mkdir -p keys && { printf '%s%s\n%s\n%s\n%s%s\n' "$PEM_HEAD" "$PEM_T" "$BODY1" "$BODY2" "$PEM_END" "$PEM_T"; } > keys/deploy.pem \
  && git add keys/deploy.pem && git commit -qm "deploy key" >/dev/null ); body_base=$(git -C "$r" rev-parse HEAD)
( cd "$r" && { printf '%s%s\n%s\n%s\n%s%s\n' "$PEM_HEAD" "$PEM_T" "$BODY3" "$BODY2" "$PEM_END" "$PEM_T"; } > keys/deploy.pem \
  && git add keys/deploy.pem && git commit -qm "rotate one line" >/dev/null ); body_head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$body_base" "$body_head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$body_head:keys/deploy.pem:2: token" ] && ! leaked "$out" "$BODY3"; } \
  && ok "a body-only change inside a key block flags" || fail "a body-only change inside a key block flags (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
content=$(printf '{"note": "x # %s email -- r"}\n{"contact": "%s"}\n' "$ALLOW_NEXT" "$EMAIL")
head=$(commit_file "$r" jn.jsonl "$content")
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && [ "$out" = "$head:jn.jsonl:1: marker
$head:jn.jsonl:2: email" ] && ! leaked "$out" "$EMAIL"; } \
  && ok "an in-string next-line marker does not reach the next record" || fail "an in-string next-line marker does not reach the next record (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
head=$(commit_file "$r" quiet.txt "$(printf '{"%s": "%s"}' "$KEY_USER" "$NOREPLY_ADDR")")
expects_silent "$r" "$base" "$head" && ok "a contact field holding a no-reply address is clean" || fail "a contact field holding a no-reply address is clean"
r=$(mkrepo)
printf 'see /home/%s@%s.%s/docs for logs\n' "$HOME_U" "$E_HOST" "$E_TLD" > "$tmp/pm-part.md"
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$PROMOTE" "$tmp/pm-part.md" raw/trials/t413/part.md 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && cmp -s "$r/raw/trials/t413/part.md" <(printf 'see <redacted:private-path>/docs for logs\n') \
  && printf '%s' "$out" | grep -qF 'part.md:1: private-path scrubbed' \
  && printf '%s' "$out" | grep -qF 'part.md:1: email scrubbed' && ! leaked "$out" "$HOME_U"; } \
  && ok "partly overlapping spans merge under the first rule, both reported" || fail "partly overlapping spans merge under the first rule, both reported (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" "$EMAIL.txt" "just public words here" "shaped name" >/dev/null
commit_file "$r" notes/contact.txt "contact: $EMAIL" >/dev/null; head=$(git -C "$r" rev-parse HEAD)
out=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --findings "$base" "$head" 2>/dev/null); code=$?
shaped=$(printf '%s' "$out" | python3 -c 'import json,sys; fs=[json.loads(l) for l in sys.stdin]; print(len(fs), all(set(f) >= {"commit","path","line","rule"} for f in fs), sum("@" in f["path"] for f in fs))' 2>/dev/null)
{ [ "$code" -eq 1 ] && [ "$shaped" = "2 True 1" ]; } \
  && ok "machine findings carry raw paths for the planner" || fail "machine findings carry raw paths for the planner (exit $code)"
r=$(mkrepo); base=$(git -C "$r" rev-parse HEAD)
commit_file "$r" "$EMAIL.txt" "contact: $EMAIL" "add the shaped note" >/dev/null
( cd "$r" && git rm -q "$EMAIL.txt" && git commit -qm "drop the shaped note" >/dev/null )
saved=$(git -C "$r" rev-parse "HEAD^{tree}")
out=$(cd "$r" && bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
rescan=$(cd "$r" && POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" HEAD 2>/dev/null); rcode=$?
{ [ "$code" -eq 0 ] && [ "$(git -C "$r" rev-parse "HEAD^{tree}")" = "$saved" ] && [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
  && ok "a historical finding under a shaped name is rewritten" || fail "a historical finding under a shaped name is rewritten (exit $code)"
hproj=$tmp/hproj; mkdir -p "$hproj/.postmaster"
printf 'contact: %s\n' "$EMAIL" > "$hproj/dirty.txt"
cat > "$hproj/.postmaster/project.toml" <<EOF
[checks.gate]
command = "bash $SCRUB --files dirty.txt"
shows = "x"
EOF
( cd "$hproj" && git init -q -b main . && git config user.name Oracle \
  && git config user.email "oracle@example.invalid" && git add -A && git add -f .postmaster/project.toml \
  && git commit -qm base )
hd="$hproj/.postmaster/runs/T-9"; mkdir -p "$hd"; printf '## Ticket\nx\n' > "$hd/brief.md"
bash "$VERIFY" record "$hproj" "$hd" >/dev/null 2>&1
( cd "$hproj" && git worktree add -q "$hproj/.worktrees/T-9-a" -b wb/T-9-a 2>/dev/null )
bash "$VERIFY" arm "$hproj/.worktrees/T-9-a" "$hd" >/dev/null 2>&1
out=$(bash "$VERIFY" run "$hproj/.worktrees/T-9-a" "$hd" 2>&1); code=$?
[ "$code" -eq 2 ] && ok "a dirty tree fails the gate" || fail "a dirty tree fails the gate (exit $code)"
out=$(SCRUB_CHECK_DISABLE=email bash "$VERIFY" run "$hproj/.worktrees/T-9-a" "$hd" 2>&1); code=$?
[ "$code" -eq 2 ] && ok "it fails with the test hook set in the caller too" || fail "it fails with the test hook set in the caller too (exit $code)"
grep -q "verify-merge" "$REPO/skills/postmaster/coachman.md" \
  && ok "the ship runbook names the merge scan" || fail "the ship runbook names the merge scan"
r=$(mkrepo)
( cd "$r" && git checkout -qb side >/dev/null && printf 'side\n' > base.txt \
  && git commit -qam "side work" >/dev/null && git checkout -q main \
  && printf 'main\n' > base.txt && git commit -qam "main work" >/dev/null; \
  git merge -q --no-ff side >/dev/null 2>&1; \
  printf 'resolved by the relay at %s\n' "$EMAIL" > base.txt && git add base.txt \
  && git commit -qm "Merge branch 'side'" >/dev/null )
out=$(POSTMASTER_DETECTIONS_LOG= bash "$MERGE" "$r" 2>/dev/null); code=$?
{ [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'base.txt:1: email' && ! leaked "$out" "$EMAIL"; } \
  && ok "a suspect in a merge resolution fails the merge scan" || fail "a suspect in a merge resolution fails the merge scan (exit $code)"
r=$(mkrepo)
( cd "$r" && git checkout -qb side >/dev/null && printf 'side\n' > side.txt \
  && git add side.txt && git commit -qm "side work" >/dev/null && git checkout -q main \
  && printf 'main\n' > main.txt && git add main.txt && git commit -qm "main work" >/dev/null \
  && git merge -q --no-ff -m "Merge branch 'side'" side >/dev/null )
out=$(POSTMASTER_DETECTIONS_LOG= bash "$MERGE" "$r" 2>/dev/null); code=$?
{ [ "$code" -eq 0 ] && [ -z "$out" ]; } \
  && ok "a clean merge passes the merge scan" || fail "a clean merge passes the merge scan (exit $code)"

# V12's recheck divergence and the merge-resolution streaming cap hold only in
# the suites: the first is a TOCTOU no blind probe reproduces stably, and the
# second needs git itself under a cap git cannot survive.

echo
if [ "$fails" -eq 0 ]; then echo "oracle-135: all probes behaved"; exit 0; fi
echo "oracle-135: $fails probe(s) misbehaved"; exit 1
