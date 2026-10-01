# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> license = { text = "MIT" }

<https://github.com/GitGuardian/ggshield/blob/v1.55.0/pyproject.toml>, 2026-09-24, checked

> `ggshield` uses our public API through py-gitguardian to scan and detect potential vulnerabilities in files and other text content.

<https://github.com/GitGuardian/ggshield/blob/v1.55.0/README.md>, 2026-09-24, checked

## Secrets and tokens

> help you detect more than 500+ types of secrets

<https://github.com/GitGuardian/ggshield/blob/v1.55.0/README.md>, 2026-09-24, checked

## Personal data in plain text

> All requests for detecting patterns like Personal Identifiable Information (PII) or Protected Health Information (PHI) will be rejected.

<https://docs.gitguardian.com/secrets-detection/customize-detection/detector-settings>, 2026-09-25

## Home paths

> This feature is only available for workspaces under our Business plan (or in Business trial).

<https://docs.gitguardian.com/secrets-detection/customize-detection/detector-settings>, 2026-09-25

## Attribution lines

> yield CommitScannable(sha, file_info.path, content, filemode=file_info.mode)

<https://github.com/GitGuardian/ggshield/blob/v1.55.0/ggshield/core/scan/commit_utils.py>, 2026-09-24, checked

## Session transcripts

> Scan docset JSONL files.

<https://docs.gitguardian.com/ggshield-docs/reference/secret/scan/docset>, 2026-09-25

> the assistant reads the `ggshield` message instead, so the secret stays out of the model and out of the session transcript for Claude Code.

<https://docs.gitguardian.com/releases/saas/tags/ggshield>, 2026-09-25

## Git history and commit messages

> Scan a REPOSITORY's commits at the given URL or path.

<https://docs.gitguardian.com/ggshield-docs/reference/secret/scan/repo>, 2026-09-25

## Scrub and recheck

> Show secrets in plaintext instead of hiding them.

<https://docs.gitguardian.com/ggshield-docs/reference/secret/scan/repo>, 2026-09-25
