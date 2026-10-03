#!/usr/bin/env bash
# Write the three files the doc's tabs were filled from, each uploaded to the doc and placed
# whole into its tab as Markdown. Code goes in a fence tagged with its language; the spec
# template, which holds a ``` fence of its own, goes in a four-backtick fence; the runbook
# goes in as it is, so the doc renders it.
#   tab-sources.sh <out-dir>     run from the repository root
set -euo pipefail
out=${1:?usage: tab-sources.sh <out-dir>}
base=faf18732c1281208d31ea8ee502f8287d75af3a0   # pull request 213's base
head=c84220ebcad4ddd08363a22441456b1575269647   # pull request 213's head
mkdir -p "$out"
{ printf '```ts\n'; git show "$head:scripts/summary-evidence.ts"; printf '```\n'; } > "$out/summary-evidence-ts.md"
{ printf '````markdown\n'; git show "$base:skills/postmaster/workhorse-spec-template.md"; printf '````\n'; } > "$out/workhorse-spec-template.md"
git show "$base:skills/postmaster/coachman.md" > "$out/coachman-runbook.md"
wc -c "$out"/*
