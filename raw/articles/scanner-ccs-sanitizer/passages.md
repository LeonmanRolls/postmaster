# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Scrub Claude Code session JSONL files for safe publication

<https://pypi.org/pypi/claude-code-sessions-sanitizer/0.3.1/json>, 2026-09-26, checked

## Secrets and tokens

> It catches **structured** leaks: filesystem paths, the identifiers you configure (name, email, usernames, hostnames, project slugs), and secrets that match a known pattern library.

<https://github.com/frederick-douglas-pearce/claude-code-sessions/blob/sanitizer-v0.3.1/tooling/sanitizer/README.md>, 2026-09-26, checked

## Personal data in plain text

> It does not read prose.

<https://github.com/frederick-douglas-pearce/claude-code-sessions/blob/sanitizer-v0.3.1/tooling/sanitizer/README.md>, 2026-09-26, checked

## Home paths

> Layer 1: path scrubbing (home directory, project slug, configured paths).

<https://github.com/frederick-douglas-pearce/claude-code-sessions/blob/sanitizer-v0.3.1/tooling/sanitizer/src/ccs_sanitize/rules/paths.py>, 2026-09-26, checked

## Session transcripts

> Parses each line, strips by ``type``, walks survivors through the transform, re-serializes with the pinned settings.

<https://github.com/frederick-douglas-pearce/claude-code-sessions/blob/sanitizer-v0.3.1/tooling/sanitizer/src/ccs_sanitize/pipeline.py>, 2026-09-26, checked

## Scrub and recheck

> output was not written

<https://github.com/frederick-douglas-pearce/claude-code-sessions/blob/sanitizer-v0.3.1/tooling/sanitizer/src/ccs_sanitize/residual.py>, 2026-09-26, checked

> ccs-sanitize 0.3.0 leaves the git branch name unscrubbed at serverClassifierContext.context.git_state.branch while reporting the output clean

<https://github.com/frederick-douglas-pearce/claude-code-sessions/security/advisories/GHSA-6c7q-jvmj-96cv>, 2026-09-27
