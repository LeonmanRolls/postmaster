#!/usr/bin/env bash
# Oracle for #135: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before any lane started, committed as the first
# commit on the ticket branch. It runs the pinned interface both lanes
# implement (scripts/scrub-check.sh) against scratch git repositories built at
# runtime under mktemp, and checks behaviour the ticket names: every commit
# scanned, never only the tip; shape-and-context matches, never a comparison
# against a list of real values; suspects reported by file, line and kind
# without ever printing a value; a user-ruled allowlist; gate wiring; and a
# history report. Kind names are the lane's own choice and are never asserted,
# only the report form. A match on a value no lane could have listed proves
# shape recognition (AC2).
#
# Every fixture value is fabricated here and assembled at runtime from short
# fragments, so this file's own committed lines carry no suspect shape, and
# scanning the ticket branch stays clean. The fixtures avoid the usual
# placeholder markers, so only the exclusion the ticket names (public no-reply
# addresses) tells them apart from the real thing.
#
#   oracle-135.sh [base]     run from the repo root; base defaults to the
#                            merge-base of HEAD with main; exit 0 when the
#                            worktree's script meets the ticket, 1 otherwise
set -uo pipefail

ROOT=$PWD
WORK=$(mktemp -d) || exit 1
trap 'rm -r -- "$WORK" </dev/null 2>/dev/null' EXIT
SCRIPT=scripts/scrub-check.sh
[ -f "$SCRIPT" ] || { echo "oracle: run from the repo root: $SCRIPT not found" >&2; exit 1; }
[ -x "$SCRIPT" ] || { echo "oracle: $SCRIPT is not executable" >&2; exit 1; }

BASE_ARG=${1:-}
if [ -z "$BASE_ARG" ]; then
  BASE_ARG=$(git merge-base HEAD main 2>/dev/null) \
    || { echo "oracle: no base: pass one or branch from main" >&2; exit 1; }
fi

# --- fabricated fixtures, assembled at runtime --------------------------------
# No committed line below carries a whole suspect shape; each value exists only
# at runtime, inside a scratch repository. Fragments stay short on purpose.
AT='@'; DOT='.'; DASH='-'; SL='/'; US='_'

E_LOCAL='suspect-413'; E_HOST='oraclemail-relay-135'; E_TLD='net'
SUSPECT_EMAIL="${E_LOCAL}${AT}${E_HOST}${DOT}${E_TLD}"

N_LOCAL='99999999+oracle-relay'; N_H1='users.noreply.gi'; N_H2='thub.com'
NOREPLY_EMAIL="${N_LOCAL}${AT}${N_H1}${N_H2}"

K_U='user'; K_E='Email'
KEY_A="${K_U}${K_E}"
K_OU_P1='organiza'; K_OU_P2='tionUuid'
KEY_B="${K_OU_P1}${K_OU_P2}"
K_SC_P1='session'; K_SC_P2='context'
KEY_C="${K_SC_P1}${US}${K_SC_P2}"
K_CO_P1='credential'; K_CO_P2='org'
KEY_D="${K_CO_P1}${US}${K_CO_P2}"

UUID_P1='41313513-0042'; UUID_P2='4c1d-9e5f-135135135135'
SUSPECT_UUID="${UUID_P1}${DASH}${UUID_P2}"

ORG_P='or'; ORG_Q='g-'; ORG_B1='oracle135relay'; ORG_B2='K7mQ2xZ9aV'
SUSPECT_ORGID="${ORG_P}${ORG_Q}${ORG_B1}${ORG_B2}"

TK_P1='s'; TK_P2='k-'; TK_B1='oracle135keyK7'; TK_B2='mQ2xZ9aVbN4'
SUSPECT_TOKEN="${TK_P1}${TK_P2}${TK_B1}${TK_B2}"

AK_P1='AK'; AK_P2='IA'; AK_B='ORACLE135400XYZ1'
SUSPECT_KEYID="${AK_P1}${AK_P2}${AK_B}"

HO_R='/ho'; HO_O='me/'; HO_U='oracle413'
CX_A='.cod'; CX_B='ex/ses'; CX_C='sions/'
SESS_DT='2026/09/29'; SESS_F='oracle-session-413.jsonl'
SUSPECT_HOMEPATH="${HO_R}${HO_O}${HO_U}${SL}${CX_A}${CX_B}${CX_C}${SESS_DT}${SL}${SESS_F}"

TP_A='/tm'; TP_B='p/'; CL_A='clau'; CL_B='de-501'
SCR_A='oracle-relay-135'; SCR_B='scratchpad/oracle-notes.md'
SUSPECT_SCRATCH="${TP_A}${TP_B}${CL_A}${CL_B}${SL}${SCR_A}${SL}${SCR_B}"

IP_A='10'; IP_B='135'; IP_C='4'; IP_D='13'
SUSPECT_IP="${IP_A}${DOT}${IP_B}${DOT}${IP_C}${DOT}${IP_D}"

HN_A='metrics'; HN_B='inter'; HN_C='nal'
SUSPECT_HOST="${HN_A}${DOT}${HN_B}${HN_C}"
SUSPECT_URL="https://${SUSPECT_HOST}:8443/status"

AB_A='Co-Au'; AB_B='thored-'; AB_C='By: Oracle Assistant <'; AB_D='>'
SUSPECT_ATTR="${AB_A}${AB_B}${AB_C}${NOREPLY_EMAIL}${AB_D}"

IN_1A='Standing ins'; IN_1B='tructions for the oracle staging fleet'
IN_2A='This fleet belongs to the oracle'; IN_2B=' staging crew and no one else.'
IN_3A='Rotate every staging credential on the'; IN_3B=' first Tuesday of the month.'
IN_4A='Never copy a staging credential into a'; IN_4B=' ticket, a comment or a log.'
IN_5A='Never debug a staging node from a network'; IN_5B=' the roster does not name.'
IN_6A='The roster lives with the fleet steward;'; IN_6B=' ask the steward to change it.'
INSTR=$(printf '%s%s\n%s%s\n%s%s\n%s%s\n%s%s\n%s%s\n' \
  "$IN_1A" "$IN_1B" "$IN_2A" "$IN_2B" "$IN_3A" "$IN_3B" \
  "$IN_4A" "$IN_4B" "$IN_5A" "$IN_5B" "$IN_6A" "$IN_6B")
INSTR_TELL="${IN_3A}${IN_3B}"

GIT_ID_NAME='oracle-135'
# Identity by environment, so no committed line holds a key-like token.
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
GIT_AUTHOR_NAME=$GIT_ID_NAME; GIT_AUTHOR_EMAIL=$NOREPLY_EMAIL
GIT_COMMITTER_NAME=$GIT_ID_NAME; GIT_COMMITTER_EMAIL=$NOREPLY_EMAIL
g() { git "$@"; }

# --- harness ------------------------------------------------------------------
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok - $1"; }
bad() { fail=$((fail + 1)); echo "not ok - $1"; [ -n "${2:-}" ] && echo "    $2"; }

FORM='^[0-9a-f]{40}:[A-Za-z0-9_./-]+:[0-9]+: [A-Za-z0-9_.-]+$'
# Lane output is untrusted: printf it, never let the shell expand it, and no
# diagnostic below ever echoes it back, since a buggy lane may print a value.
wellformed() { printf '%s' "$1" | grep -Eq "$FORM"; }

new_repo() {  # print the path of a scratch repo with one clean base commit
  local d
  d=$(mktemp -d -p "$WORK") || return 1
  ( cd "$d" && g init -q -b main . && printf 'oracle base\n' > base.txt \
    && g add base.txt && g commit -qm base ) || return 1
  printf '%s' "$d"
}

commit_file() {  # commit_file <repo> <path> <content>: commit, print the sha
  local repo=$1 path=$2 content=$3
  ( cd "$repo" && mkdir -p "$(dirname "$path")" && printf '%s\n' "$content" > "$path" \
    && g add "$path" && g commit -qm "add $path" >/dev/null && git rev-parse HEAD )
}

scan() {  # scan <repo> <base> <head>: run the worktree's script from the repo root
  ( cd "$1" && bash "$ROOT/$SCRIPT" "$2" "$3" )
}

flag_probe() {  # flag_probe <name> <path> <content> <secret>: one suspect line
  local name=$1 path=$2 content=$3 secret=$4
  local repo base sha out err code
  repo=$(new_repo) || { bad "$name" "scratch repo failed"; return; }
  base=$(git -C "$repo" rev-parse HEAD)
  sha=$(commit_file "$repo" "$path" "$content") || { bad "$name" "commit failed"; return; }
  out=$(scan "$repo" "$base" "$sha" 2>"$repo/stderr.txt"); code=$?
  err=$(cat "$repo/stderr.txt")
  [ "$code" -eq 1 ] || { bad "$name" "exit $code, want 1"; return; }
  wellformed "$out" || { bad "$name" "malformed report line"; return; }
  [ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] || { bad "$name" "want one report line"; return; }
  case "$out" in "$sha:$path:1: "*) ;; *) bad "$name" "misaddressed: want $sha:$path:1:"; return;; esac
  if grep -qF -- "$secret" <<<"$out"; then bad "$name" "value on stdout"; return; fi
  if grep -qF -- "$secret" <<<"$err"; then bad "$name" "value on stderr"; return; fi
  ok "$name"
}

clean_probe() {  # clean_probe <name> <path> <content>: silence and exit 0
  local name=$1 path=$2 content=$3
  local repo base sha out code
  repo=$(new_repo) || { bad "$name" "scratch repo failed"; return; }
  base=$(git -C "$repo" rev-parse HEAD)
  sha=$(commit_file "$repo" "$path" "$content") || { bad "$name" "commit failed"; return; }
  out=$(scan "$repo" "$base" "$sha" 2>/dev/null); code=$?
  [ "$code" -eq 0 ] || { bad "$name" "exit $code, want 0"; return; }
  [ -z "$out" ] || { bad "$name" "stdout not empty"; return; }
  ok "$name"
}

# --- exits and silence --------------------------------------------------------
bash "$ROOT/$SCRIPT" >/dev/null 2>&1; code=$?
[ "$code" -eq 2 ] && ok "usage-exits-2" || bad "usage-exits-2" "exit $code, want 2"

bash "$ROOT/$SCRIPT" --help >/dev/null 2>&1; code=$?
[ "$code" -eq 0 ] && ok "help-exits-0" || bad "help-exits-0" "exit $code, want 0"

clean_probe "clean-range-exits-0" notes/oracle.txt 'The relay ran its checks and stayed green.'

repo=$(new_repo) || bad "empty-range-exits-0" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  head=$(git -C "$repo" rev-parse HEAD)
  out=$(scan "$repo" "$head" "$head" 2>/dev/null); code=$?
  { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
    && ok "empty-range-exits-0" || bad "empty-range-exits-0" "exit $code"
fi

# --- one flag probe per ticket-named kind -------------------------------------
# The key probes forbid the placeholder value on the output, never the key name:
# a kind named after its key is the report's kind, not a printed value.
flag_probe "flag-key-a" data/session.json "{\"${KEY_A}\": \"withheld\"}" "withheld"
flag_probe "flag-key-b" data/session.json "{\"${KEY_B}\": \"${SUSPECT_UUID}\"}" "$SUSPECT_UUID"
flag_probe "flag-key-c" data/session.json "{\"${KEY_C}\": \"withheld\"}" "withheld"
flag_probe "flag-key-d" data/session.json "{\"${KEY_D}\": \"withheld\"}" "withheld"
flag_probe "flag-email" notes/contact.txt "$SUSPECT_EMAIL" "$SUSPECT_EMAIL"
flag_probe "flag-orgid" deploy/owner.txt "deploy-owner=${SUSPECT_ORGID}" "$SUSPECT_ORGID"
flag_probe "flag-home-path" notes/env.txt "session under ${SUSPECT_HOMEPATH}" "$SUSPECT_HOMEPATH"
flag_probe "flag-scratch-path" notes/env.txt "cache under ${SUSPECT_SCRATCH}" "$SUSPECT_SCRATCH"
flag_probe "flag-private-ip" deploy/endpoint.txt "endpoint ${SUSPECT_IP}:8080" "$SUSPECT_IP"
flag_probe "flag-private-host" deploy/endpoint.txt "$SUSPECT_URL" "$SUSPECT_HOST"
flag_probe "flag-token" notes/relay.txt "relay key ${SUSPECT_TOKEN}" "$SUSPECT_TOKEN"
flag_probe "flag-access-key" notes/relay.txt "relay id ${SUSPECT_KEYID}" "$SUSPECT_KEYID"
flag_probe "flag-attribution" notes/credits.txt "$SUSPECT_ATTR" "$SUSPECT_ATTR"

# --- instructions-like text: a block, not one line ----------------------------
repo=$(new_repo) || bad "flag-instructions" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  base=$(git -C "$repo" rev-parse HEAD)
  sha=$(commit_file "$repo" notes/standing.txt "$INSTR")
  if [ -z "${sha:-}" ]; then
    bad "flag-instructions" "commit failed"
  else
    out=$(scan "$repo" "$base" "$sha" 2>"$repo/stderr.txt"); code=$?
    err=$(cat "$repo/stderr.txt")
    if [ "$code" -ne 1 ]; then
      bad "flag-instructions" "exit $code, want 1"
    elif [ -z "$out" ]; then
      bad "flag-instructions" "empty stdout"
    elif ! grep -qF ":notes/standing.txt:" <<<"$out"; then
      bad "flag-instructions" "standing file not named"
    elif grep -qF -- "$INSTR_TELL" <<<"$out$err"; then
      bad "flag-instructions" "value printed"
    else
      deformed=0
      while IFS= read -r line; do wellformed "$line" || deformed=1; done <<<"$out"
      [ "$deformed" -eq 0 ] && ok "flag-instructions" || bad "flag-instructions" "malformed report line"
    fi
  fi
fi

# --- every commit, not only the tip -------------------------------------------
repo=$(new_repo) || bad "older-commit-flags" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  base=$(git -C "$repo" rev-parse HEAD)
  sha1=$(commit_file "$repo" notes/contact.txt "$SUSPECT_EMAIL")
  commit_file "$repo" notes/oracle.txt 'Later clean notes.' >/dev/null
  head=$(git -C "$repo" rev-parse HEAD)
  if [ -z "${sha1:-}" ]; then
    bad "older-commit-flags" "commit failed"
  else
    out=$(scan "$repo" "$base" "$head" 2>/dev/null); code=$?
    if [ "$code" -ne 1 ]; then
      bad "older-commit-flags" "exit $code, want 1"
    elif ! wellformed "$out"; then
      bad "older-commit-flags" "malformed report line"
    else
      case "$out" in "$sha1:notes/contact.txt:1: "*) ok "older-commit-flags";; *) bad "older-commit-flags" "misaddressed: want $sha1:notes/contact.txt:1:";; esac
    fi
  fi
fi

repo=$(new_repo) || bad "deleted-at-tip-flags" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  base=$(git -C "$repo" rev-parse HEAD)
  sha1=$(commit_file "$repo" notes/contact.txt "$SUSPECT_EMAIL")
  ( cd "$repo" && git rm -q notes/contact.txt && g commit -qm drop >/dev/null )
  head=$(git -C "$repo" rev-parse HEAD)
  if [ -z "${sha1:-}" ]; then
    bad "deleted-at-tip-flags" "commit failed"
  else
    out=$(scan "$repo" "$base" "$head" 2>/dev/null); code=$?
    if [ "$code" -ne 1 ]; then
      bad "deleted-at-tip-flags" "exit $code, want 1"
    else
      case "$out" in "$sha1:notes/contact.txt:1: "*) ok "deleted-at-tip-flags";; *) bad "deleted-at-tip-flags" "misaddressed: want $sha1:notes/contact.txt:1:";; esac
    fi
  fi
fi

# --- the allowlist pair: not-yet-allowed flags, allowed stays silent -----------
repo=$(new_repo) || bad "allowlist-not-yet-allowed-flags" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  base=$(git -C "$repo" rev-parse HEAD)
  commit_file "$repo" notes/contact.txt "$SUSPECT_EMAIL" >/dev/null
  head=$(git -C "$repo" rev-parse HEAD)
  out=$(scan "$repo" "$base" "$head" 2>/dev/null); code=$?
  [ "$code" -eq 1 ] \
    && ok "allowlist-not-yet-allowed-flags" \
    || bad "allowlist-not-yet-allowed-flags" "exit $code, want 1"
  commit_file "$repo" scripts/scrub-check.allow "$SUSPECT_EMAIL" >/dev/null
  head=$(git -C "$repo" rev-parse HEAD)
  out=$(scan "$repo" "$base" "$head" 2>/dev/null); code=$?
  { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
    && ok "allowlist-allowed-silent" \
    || bad "allowlist-allowed-silent" "exit $code"
fi

# --- history: the past reports, the clean past stays silent --------------------
repo=$(new_repo) || bad "history-flags-old" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  commit_file "$repo" notes/contact.txt "$SUSPECT_EMAIL" >/dev/null
  commit_file "$repo" notes/oracle.txt 'Later clean notes.' >/dev/null
  out=$( ( cd "$repo" && bash "$ROOT/$SCRIPT" --history ) 2>"$repo/stderr.txt"); code=$?
  err=$(cat "$repo/stderr.txt")
  if [ "$code" -ne 1 ]; then
    bad "history-flags-old" "exit $code, want 1"
  elif [ "$(printf '%s\n' "$out" | wc -l)" -ne 1 ]; then
    bad "history-flags-old" "want one report line"
  elif ! wellformed "$out"; then
    bad "history-flags-old" "malformed report line"
  elif grep -qF -- "$SUSPECT_EMAIL" <<<"$out$err"; then
    bad "history-flags-old" "value printed"
  elif ! grep -qF ":notes/contact.txt:" <<<"$out"; then
    bad "history-flags-old" "contact file not named"
  else
    ok "history-flags-old"
  fi
fi

repo=$(new_repo) || bad "history-clean-silent" "scratch repo failed"
if [ -n "${repo:-}" ]; then
  out=$( ( cd "$repo" && bash "$ROOT/$SCRIPT" --history ) 2>/dev/null); code=$?
  { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
    && ok "history-clean-silent" \
    || bad "history-clean-silent" "exit $code"
fi

# --- the lane's own self-test passes -------------------------------------------
bash "$ROOT/$SCRIPT" --self-test >"$WORK/selftest.log" 2>&1; code=$?
[ "$code" -eq 0 ] \
  && ok "self-test-passes" \
  || bad "self-test-passes" "exit $code (see the script's --self-test)"

# --- the lane's own branch scans clean ------------------------------------------
out=$(bash "$ROOT/$SCRIPT" "$BASE_ARG" HEAD 2>/dev/null); code=$?
if [ "$code" -ne 0 ]; then
  bad "own-branch-clean" "exit $code, want 0"
elif [ -n "$out" ]; then
  bad "own-branch-clean" "$(printf '%s\n' "$out" | wc -l) suspect lines on the branch (values never shown)"
else
  ok "own-branch-clean"
fi

# --- AC5: the scan is wired into the project's checks ---------------------------
if ! git ls-files --error-unmatch .postmaster/project.toml >/dev/null 2>&1; then
  bad "wiring-declared" ".postmaster/project.toml is not tracked"
else
  wired=$(bash scripts/verify.sh checks . --json 2>/dev/null \
    | python3 -c 'import json,sys; cs=json.load(sys.stdin); print("\n".join(c["command"] for c in cs if "scrub-check" in c.get("command","")))' 2>/dev/null)
  if [ -z "${wired:-}" ]; then
    bad "wiring-declared" "no declared check runs the scan"
  else
    vd=$(mktemp -d -p "$WORK") || { bad "wiring-passes-clean" "scratch dir failed"; vd=""; }
    if [ -n "$vd" ]; then
      printf '# Ticket\n' > "$vd/ticket.md"
      ( cd "$ROOT" && POSTMASTER_VERIFY=$vd bash -e -o pipefail -c "$wired" >/dev/null 2>&1 ); code=$?
      [ "$code" -eq 0 ] \
        && ok "wiring-declared-and-passes" \
        || bad "wiring-passes-clean" "declared scan command exits $code on a clean tree"
    fi
  fi
fi

# --- AC7: the raw-file contract names the script ---------------------------------
grep -q 'scrub-check' raw/README.md 2>/dev/null \
  && ok "readme-names-script" \
  || bad "readme-names-script" "raw/README.md does not name the script"

# --- AC2: no allowlist entries ship with the branch -------------------------------
if [ ! -f scripts/scrub-check.allow ] || [ ! -s scripts/scrub-check.allow ]; then
  ok "allowlist-ships-empty"
else
  bad "allowlist-ships-empty" "the branch ships allowlist entries of its own"
fi

# --- clean controls: prose mentions and no-reply addresses pass -------------------
clean_probe "prose-key-mention-passes" docs/fields.txt "The ${KEY_A} key is listed in the API reference."
clean_probe "noreply-passes" notes/contact.txt "Reach the relay at $NOREPLY_EMAIL for pings."

echo "oracle-135: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
