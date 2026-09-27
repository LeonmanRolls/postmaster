#!/usr/bin/env bash
# Install each skill as a link, never a copy: from the user-level skills folder of every
# installed harness that has one, to that skill in the postmaster checkout. The checkout stays
# the one source of truth, and a session finds the repo from the link (SKILL.md, first
# section). The links go to the main checkout even when this runs from a worktree, and to this
# script's own tree when that is not a git checkout at all, as with an installed package.
#
#   link-skills.sh [--dry-run]   link every skill for every installed harness with a skills folder
#   link-skills.sh --remove      remove the links to this checkout's skills, and nothing else
#   link-skills.sh --self-test
#
# Which folder each harness reads is the "Skills folders" table in
# skills/postmaster/harnesses.md; this script is its executable form, and the self-test fails
# when the two disagree. Several harnesses reading one folder get one link there. A harness
# with no skills folder is named with the absolute path its brief gives instead.
#
# Running it again changes nothing. It replaces nothing either: a real file or folder where a
# link belongs, or a link that points anywhere else, is named, and then nothing at all is
# changed, so the user can move it and run this again.
#
#   exit 0  every link is in place, or would be (--dry-run), or is removed (--remove)
#   exit 1  usage, no skills in the checkout, a bare main checkout, or something in the way
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
HARNESSES="claude codex grok agy muse pi mimo"

skills_folder() {  # skills_folder <harness>: the user-level folder its skills are linked into; nothing if none
  case $1 in
    claude) printf '%s\n' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills" ;;
    codex|grok|mimo|muse|pi) printf '%s\n' "$HOME/.agents/skills" ;;
  esac
}

checkout_root() {  # checkout_root <tree>: the checkout whose skills are linked, for the tree at <tree>
  local tree=$1 top list
  top=$(git -C "$tree" rev-parse --show-toplevel 2>/dev/null) && top=$(cd -P "$top" && pwd) \
    || { printf '%s\n' "$tree"; return 0; }
  # A package installed inside some other project's checkout is not that project.
  [ "$top" = "$tree" ] || { printf '%s\n' "$tree"; return 0; }
  list=$(git -C "$tree" worktree list --porcelain) || { echo "link-skills: git cannot list the worktrees of $tree" >&2; return 1; }
  # The main worktree is always listed first.
  if [ "$(printf '%s\n' "$list" | sed -n 2p)" = bare ]; then
    echo "link-skills: the main checkout of $tree is bare; run this from a checkout with files" >&2; return 1
  fi
  (cd -P "$(printf '%s\n' "$list" | sed -n '1s/^worktree //p')" && pwd)
}

same_dir() { [ -d "$1" ] && [ -d "$2" ] && [ "$(CDPATH= cd -P -- "$1" && pwd)" = "$(CDPATH= cd -P -- "$2" && pwd)" ]; }

plan() {  # plan <root>: one tab-separated line per path, first field the verdict
  local root=$1 h folder key seen="" skill name path target
  set -- "$root"/skills/*/SKILL.md
  [ -f "$1" ] || { echo "link-skills: no skills/*/SKILL.md in $root" >&2; return 1; }
  for h in $HARNESSES; do
    command -v "$h" >/dev/null 2>&1 || { printf 'absent\t%s\n' "$h"; continue; }
    folder=$(skills_folder "$h")
    [ -n "$folder" ] || { printf 'no-folder\t%s\t%s\n' "$h" "$root/skills/postmaster/SKILL.md"; continue; }
    if [ -L "$folder" ] && [ ! -d "$folder" ]; then printf 'in-the-way\t%s\ta link to %s\n' "$folder" "$(readlink "$folder")"; continue; fi
    if [ -e "$folder" ] && [ ! -d "$folder" ]; then printf 'in-the-way\t%s\ta file\n' "$folder"; continue; fi
    key=$folder; [ -d "$folder" ] && key=$(CDPATH= cd -P -- "$folder" && pwd)
    case $seen in *"<$key>"*) printf 'shared\t%s\t%s\n' "$h" "$folder"; continue ;; esac
    seen="$seen<$key>"
    for skill in "$@"; do
      name=$(basename "$(dirname "$skill")"); path=$folder/$name; target=$root/skills/$name
      if [ -L "$path" ]; then
        if [ "$(readlink "$path")" = "$target" ] || same_dir "$path" "$target"; then printf 'linked\t%s\t%s\t%s\n' "$path" "$target" "$h"
        else printf 'in-the-way\t%s\ta link to %s\n' "$path" "$(readlink "$path")"; fi
      elif same_dir "$path" "$target"; then printf 'linked\t%s\t%s\t%s\n' "$path" "$target" "$h"   # the folder is a link into the checkout
      elif [ -d "$path" ]; then printf 'in-the-way\t%s\ta folder\n' "$path"
      elif [ -e "$path" ]; then printf 'in-the-way\t%s\ta file\n' "$path"
      else printf 'link\t%s\t%s\t%s\n' "$path" "$target" "$h"; fi
    done
  done
}

report() {  # report <plan-line>: the line a person reads
  local verdict a b c
  IFS=$'\t' read -r verdict a b c <<< "$1"
  case $verdict in
    absent)     printf 'not installed   %s\n' "$a" ;;
    no-folder)  printf 'no skills folder %s: its brief names %s by absolute path\n' "$a" "$b" ;;
    shared)     printf 'shared folder   %s reads %s, linked for another harness\n' "$a" "$b" ;;
    linked)     printf 'already linked  %s -> %s (%s)\n' "$a" "$b" "$c" ;;
    link)       printf 'to link         %s -> %s (%s)\n' "$a" "$b" "$c" ;;
    in-the-way) printf 'IN THE WAY      %s is %s\n' "$a" "$b" ;;
  esac
}

make_links() {  # make_links <root> <dry>
  local root=$1 dry=$2 p line verdict path target h
  p=$(plan "$root") || return 1
  while IFS= read -r line; do report "$line"; done <<< "$p"
  if printf '%s\n' "$p" | grep -q '^in-the-way'; then
    echo "link-skills: nothing was changed; move what is in the way, or ask the user to, then run this again" >&2
    return 1
  fi
  [ "$dry" -eq 1 ] && return 0
  while IFS=$'\t' read -r verdict path target h; do
    [ "$verdict" = link ] || continue
    # -n: should the path have become a link to a folder since the plan, ln fails rather than
    # writing a link inside that folder.
    mkdir -p "$(dirname "$path")" && ln -s -n -- "$target" "$path" && [ "$(readlink "$path")" = "$target" ] \
      || { echo "link-skills: could not link $path" >&2; return 1; }
    printf 'linked          %s -> %s (%s)\n' "$path" "$target" "$h"
  done <<< "$p"
}

remove_links() {  # remove_links <root>: remove the links that point at <root>'s skills; leave everything else
  local root=$1 h folder seen="" skill name path
  for h in $HARNESSES; do
    folder=$(skills_folder "$h"); [ -n "$folder" ] || continue
    case $seen in *"<$folder>"*) continue ;; esac
    seen="$seen<$folder>"
    for skill in "$root"/skills/*/SKILL.md; do
      name=$(basename "$(dirname "$skill")"); path=$folder/$name
      [ -L "$path" ] || continue
      if [ "$(readlink "$path")" = "$root/skills/$name" ] || same_dir "$path" "$root/skills/$name"; then
        rm -- "$path" && printf 'removed         %s\n' "$path"
      else
        printf 'left alone      %s, a link to %s\n' "$path" "$(readlink "$path")"
      fi
    done
  done
}

case ${1:-} in
  "") ROOT=$(checkout_root "$(dirname "$HERE")") || exit 1; make_links "$ROOT" 0; exit $? ;;
  --dry-run) ROOT=$(checkout_root "$(dirname "$HERE")") || exit 1; make_links "$ROOT" 1; exit $? ;;
  --remove) ROOT=$(checkout_root "$(dirname "$HERE")") || exit 1; remove_links "$ROOT"; exit $? ;;
  --self-test) ;;
  *) echo "usage: link-skills.sh [--dry-run] | --remove | --self-test" >&2; exit 1 ;;
esac

# --- self-test ----------------------------------------------------------------------------
# Hermetic: a temporary HOME, and a PATH holding only stub harnesses, a stub gh and the tools
# the scripts use, so no real skills folder, harness or network is touched. The checkout under
# test is linked directly; which checkout a real run links is tested last, on fixtures.
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
TOOL=$(dirname "$HERE")
mkdir -p "$tmp/bin" "$tmp/home" "$tmp/elsewhere" || exit 1
for t in bash sh env git python3 readlink dirname basename mkdir ln rm sed grep cat mktemp cmp sort awk head tr ls cut chmod cp; do
  p=$(type -P "$t") || { echo "self-test: $t is not on PATH" >&2; exit 1; }
  ln -s "$p" "$tmp/bin/$t"
done
for h in claude codex pi agy; do printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/$h"; chmod +x "$tmp/bin/$h"; done
export PATH="$tmp/bin" HOME="$tmp/home"
unset CLAUDE_CONFIG_DIR
C=$HOME/.claude/skills; A=$HOME/.agents/skills
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
state() { ls -A "$HOME"; for p in "$C"/* "$A"/*; do if [ -e "$p" ] || [ -L "$p" ]; then printf '%s %s\n' "$p" "$(readlink "$p")"; fi; done; }
links_to() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }

echo "installing: every skill, for every installed harness with a skills folder"
out=$(make_links "$TOOL" 0 2>&1); rc=$?
if [ $rc -eq 0 ] && links_to "$C/postmaster" "$TOOL/skills/postmaster" && links_to "$C/wiki" "$TOOL/skills/wiki" \
   && links_to "$A/postmaster" "$TOOL/skills/postmaster" && links_to "$A/wiki" "$TOOL/skills/wiki"; then
  ok "each skill is a link from claude's folder and from ~/.agents/skills to the checkout"
else fail "each skill is a link from claude's folder and from ~/.agents/skills to the checkout (exit $rc)" "$out"; fi
[ "$(ls -A "$HOME" | tr '\n' ' ')" = ".agents .claude " ] \
  && ok "nothing else is made, for a harness not installed or with no skills folder" || fail "nothing else is made" "$(ls -A "$HOME")"
printf '%s\n' "$out" | grep -qF "shared folder   pi reads $A, linked for another harness" \
  && ok "harnesses that read one folder get one link there" || fail "harnesses that read one folder get one link there" "$out"
printf '%s\n' "$out" | grep -qF "no skills folder agy: its brief names $TOOL/skills/postmaster/SKILL.md by absolute path" \
  && ok "a harness with no skills folder is named with the absolute path its brief gives" || fail "a harness with no skills folder is named" "$out"
copies=$(for p in "$C"/* "$A"/*; do [ -L "$p" ] || printf '%s\n' "$p"; done)
[ -z "$copies" ] && ok "nothing in a skills folder is a copy" || fail "nothing in a skills folder is a copy" "$copies"
before=$(state); out=$(make_links "$TOOL" 0 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(state)" = "$before" ] && ! printf '%s\n' "$out" | grep -q '^linked ' \
  && ok "running it again changes nothing" || fail "running it again changes nothing (exit $rc)" "$out"
CLAUDE_CONFIG_DIR="$tmp/cfg" make_links "$TOOL" 0 >/dev/null 2>&1
links_to "$tmp/cfg/skills/postmaster" "$TOOL/skills/postmaster" && ok "claude's folder moves with CLAUDE_CONFIG_DIR" \
  || fail "claude's folder moves with CLAUDE_CONFIG_DIR"

echo "positive control: from an unrelated directory, a documented command resolves through the link and runs"
resolver=$(grep -F 'test -f "$t/scripts/link-skills.sh"' "$TOOL/skills/postmaster/SKILL.md" | head -1)
documented=$(grep -E '^<tool>/scripts/github\.sh <repo> board +#' "$TOOL/skills/postmaster/trackers.md" | head -1 | sed 's/ *#.*//')
[ -n "$resolver" ] && [ -n "$documented" ] && ok "SKILL.md documents how <tool> is found, and trackers.md the board command" \
  || fail "SKILL.md documents how <tool> is found, and trackers.md the board command" "found: [$resolver] [$documented]"
cat > "$tmp/bin/gh" <<'GH'
#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql") echo '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}' ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
GH
chmod +x "$tmp/bin/gh"
git init -q "$tmp/target" && git -C "$tmp/target" remote add origin https://github.com/o/r.git
through() {  # through <skill-dir>: what a session runs, from an unrelated directory: find <tool>, then the command
  local find_tool=${resolver//<skill>/$1} command=${documented//<repo>/$tmp/target}
  command=${command//<tool>/'$tool'}
  (cd "$tmp/elsewhere" && bash -c "tool=\$($find_tool) && $command") 2>&1
}
found=$(cd "$tmp/elsewhere" && bash -c "${resolver//<skill>/$C/postmaster}" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$found" = "$TOOL" ] && ok "<tool> is the checkout the link leads to" || fail "<tool> is the checkout the link leads to (exit $rc)" "$found"
out=$(through "$C/postmaster"); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qF 'https://github.com/users/o/projects/1' \
  && ok "the board command runs through the link" || fail "the board command runs through the link (exit $rc)" "$out"
found=$(cd "$TOOL" && bash -c "${resolver//<skill>/skills/postmaster}" 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$found" = "$TOOL" ] && ok "a session in the checkout itself, sent to skills/postmaster, finds that checkout" \
  || fail "a session in the checkout itself, sent to skills/postmaster, finds that checkout (exit $rc)" "$found"

echo "negative controls: the same command fails, naming the link, never a bare 'no such file'"
link=$C/postmaster
named_failure() {  # named_failure <label>
  local out rc
  out=$(through "$link"); rc=$?
  if [ $rc -ne 0 ] && printf '%s\n' "$out" | grep -qF "$link" && ! printf '%s\n' "$out" | grep -qi 'no such file' \
     && ! printf '%s\n' "$out" | grep -qF 'projects/1'; then ok "$1"
  else fail "$1 (exit $rc)" "$out"; fi
}
rm -- "$link"
named_failure "with the link missing"
ln -s "$tmp/elsewhere" "$link"
named_failure "with the link pointing elsewhere"
rm -- "$link"; mkdir -p "$tmp/copy"; cp -R "$TOOL/skills/postmaster" "$tmp/copy/postmaster"; ln -s "$tmp/copy/postmaster" "$link"
named_failure "with the link pointing at a copy of the skill"
rm -- "$link"; ln -s "$TOOL/skills/postmaster" "$link"

echo "negative controls: nothing in the way is replaced, and nothing else changes"
in_the_way() {  # in_the_way <label> <path>: the install refuses, names <path>, and changes nothing
  local out rc before
  before=$(state)
  out=$(make_links "$TOOL" 0 2>&1); rc=$?
  if [ $rc -eq 1 ] && printf '%s\n' "$out" | grep -qF "IN THE WAY      $2" && [ "$(state)" = "$before" ]; then ok "$1"
  else fail "$1 (exit $rc)" "$out"; fi
}
rm -- "$A/wiki"                          # a link still to make, so a refusal that links anyway shows
rm -- "$link"; mkdir -p "$link"
in_the_way "a real folder where a link belongs is named" "$link"
[ ! -e "$A/wiki" ] && ok "a refusal makes no other link either" || fail "a refusal makes no other link either"
rm -r -- "$link"; printf 'x\n' > "$link"
in_the_way "a real file where a link belongs is named" "$link"
rm -- "$link"; ln -s "$tmp/elsewhere" "$link"
in_the_way "a link that points elsewhere is named" "$link"
rm -- "$link"; ln -s "$tmp/nowhere" "$link"
in_the_way "a link that points nowhere is named" "$link"
rm -- "$link"
out=$(make_links "$TOOL" 1 2>&1); rc=$?
[ $rc -eq 0 ] && [ ! -L "$link" ] && [ ! -L "$A/wiki" ] && printf '%s\n' "$out" | grep -qF "to link         $link" \
  && ok "--dry-run names the links it would make, and makes none" || fail "--dry-run names the links it would make, and makes none (exit $rc)" "$out"

echo "a skills folder that is itself a link into a checkout's skills"
mkdir -p "$tmp/fixture/skills/postmaster" "$tmp/fixture/skills/wiki" "$tmp/fhome"
printf -- '---\nname: postmaster\n---\n' > "$tmp/fixture/skills/postmaster/SKILL.md"
printf -- '---\nname: wiki\n---\n' > "$tmp/fixture/skills/wiki/SKILL.md"
fixture=$(cd -P "$tmp/fixture" && pwd); before=$(ls -AR "$fixture")
mkdir -p "$tmp/fhome/.claude" "$tmp/fhome/.agents/skills"; ln -s "$fixture/skills" "$tmp/fhome/.claude/skills"
out=$(HOME="$tmp/fhome" make_links "$fixture" 0 2>&1); rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -qF "already linked  $tmp/fhome/.claude/skills/postmaster" && [ "$(ls -AR "$fixture")" = "$before" ] \
  && ok "counts as linked, and nothing is written into the checkout" || fail "counts as linked, and nothing is written into the checkout (exit $rc)" "$out"
out=$(HOME="$tmp/fhome" remove_links "$fixture" 2>&1)
[ -d "$fixture/skills/postmaster" ] && [ "$(ls -AR "$fixture")" = "$before" ] && [ -L "$tmp/fhome/.claude/skills" ] \
  && ok "--remove leaves it, and the checkout, alone" || fail "--remove leaves it, and the checkout, alone" "$out"

echo "--remove: only the links to this checkout's skills"
make_links "$TOOL" 0 >/dev/null 2>&1
ln -s "$tmp/elsewhere" "$C/other"; rm -- "$A/wiki"; mkdir "$A/wiki"
out=$(remove_links "$TOOL" 2>&1)
if [ ! -L "$C/postmaster" ] && [ ! -L "$C/wiki" ] && [ ! -L "$A/postmaster" ] && [ -L "$C/other" ] && [ -d "$A/wiki" ]; then
  ok "its own links go; a link elsewhere and a real folder stay"
else fail "its own links go; a link elsewhere and a real folder stay" "$out"; fi

echo "which checkout is linked"
git init -q -b main "$tmp/repo" && git -C "$tmp/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m first \
  && git -C "$tmp/repo" worktree add -q "$tmp/repo/.worktrees/wt" -b wt 2>/dev/null
repo=$(cd -P "$tmp/repo" && pwd)
[ "$(checkout_root "$repo/.worktrees/wt")" = "$repo" ] && ok "from a worktree: the main checkout, never the worktree" \
  || fail "from a worktree: the main checkout, never the worktree" "$(checkout_root "$repo/.worktrees/wt" 2>&1)"
[ "$(checkout_root "$repo")" = "$repo" ] && ok "from the main checkout: itself" || fail "from the main checkout: itself"
mkdir -p "$tmp/pkg" "$repo/node_modules/pkg"; pkg=$(cd -P "$tmp/pkg" && pwd); nested=$(cd -P "$repo/node_modules/pkg" && pwd)
[ "$(checkout_root "$pkg")" = "$pkg" ] && ok "from a tree outside git, such as an installed package: itself" \
  || fail "from a tree outside git, such as an installed package: itself"
[ "$(checkout_root "$nested")" = "$nested" ] && ok "from a package inside another project's checkout: the package, not the project" \
  || fail "from a package inside another project's checkout: the package, not the project" "$(checkout_root "$nested" 2>&1)"
git clone -q --bare "$repo" "$tmp/bare.git" 2>/dev/null && git -C "$tmp/bare.git" worktree add -q "$tmp/bare-wt" main 2>/dev/null
checkout_root "$(cd -P "$tmp/bare-wt" && pwd)" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a bare main checkout is refused" || fail "a bare main checkout is refused (exit $rc)"

echo "this script and harnesses.md's Skills folders table agree"
table=$(awk '/^## Skills folders/ { on = 1; next } on && /^## / { exit } on && /^\| [a-z]+ \|/' "$TOOL/skills/postmaster/harnesses.md")
[ -n "$table" ] && ok "harnesses.md has a Skills folders table" || fail "harnesses.md has a Skills folders table"
for h in $HARNESSES; do
  cell=$(printf '%s\n' "$table" | awk -F'|' -v h="$h" '{ name = $2; gsub(/ /, "", name) } name == h { print $3; exit }')
  want=$(printf '%s\n' "$cell" | sed -n 's/^ *`\([^`]*\)`.*/\1/p'); want=${want/#\~/$HOME}
  [ -n "$cell" ] && [ "$(skills_folder "$h")" = "$want" ] && ok "$h: ${want:-no skills folder}" \
    || fail "$h: the script says '$(skills_folder "$h")', harnesses.md says '${cell:-no row}'"
done

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
