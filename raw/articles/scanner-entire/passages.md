# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> "tag_name":"v0.11.3"

<https://api.github.com/repos/entireio/cli/releases/latest>, 2026-09-25, checked

> Your session transcripts are stored in your git repository

<https://github.com/entireio/cli/blob/v0.11.3/README.md>, 2026-09-25, checked

> "spdx_id":"MIT"

<https://api.github.com/repos/entireio/cli>, read 2026-10-01, checked

## Secrets and tokens

> String replaces secrets and PII in s using layered detection:

<https://github.com/entireio/cli/blob/v0.11.3/redact/redact.go>, 2026-09-25, checked

> Entire automatically redacts detected secrets (API keys, tokens, credentials) from transcripts and metadata before writing a checkpoint, but redaction is best-effort.

<https://github.com/entireio/cli/blob/v0.11.3/README.md>, 2026-09-25, checked

## Personal data in plain text

> When false, no PII patterns are checked (secrets still redacted).

<https://github.com/entireio/cli/blob/v0.11.3/redact/pii.go>, 2026-09-25, checked

## Home paths

> Skip common path and directory fields from agent transcripts.

<https://github.com/entireio/cli/blob/v0.11.3/redact/redact.go>, 2026-09-25, checked

> case "filepath", "file_path", "cwd", "root", "directory", "dir", "path":

<https://github.com/entireio/cli/blob/v0.11.3/redact/redact.go>, 2026-09-25, checked

## Email addresses

> "@users.noreply.github.com", // GitHub user noreply

<https://github.com/entireio/cli/blob/v0.11.3/redact/pii.go>, 2026-09-25, checked

## Session transcripts

> JSONLContent parses each line as JSON to determine which string values need redaction, then performs targeted replacements on the raw JSON bytes.

<https://github.com/entireio/cli/blob/v0.11.3/redact/redact.go>, 2026-09-25, checked

> Skip signature fields: cryptographic attestations, not secrets.

<https://github.com/entireio/cli/blob/v0.11.3/redact/redact.go>, 2026-09-25, checked

## Git history and commit messages

> the hook re-reads each not-yet-OPF'd commit, runs the OpenAI Privacy Filter over its blobs

<https://github.com/entireio/cli/blob/v0.11.3/docs/security-and-privacy.md>, 2026-09-25, checked

> their **code-file snapshots are raw blobs of your working tree**, so a secret hardcoded in your source appears unredacted there.

<https://github.com/entireio/cli/blob/v0.11.3/README.md>, 2026-09-25, checked

## Scrub and recheck

> split OPF spans that cross a batch separator instead of dropping them

<https://github.com/entireio/cli/releases/tag/v0.11.4-nightly.202610010628.ba41caf7b>, 2026-10-01, checked
