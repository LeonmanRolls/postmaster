# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Kingfisher is licensed under the Apache License 2.0.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/README.md>, 2026-09-29, checked

> Kingfisher's scanning engine and architecture derive from Nosey Parker.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/NOTICE>, 2026-09-29, checked

> Kingfisher's three embeddable crates are prepared for their first stable 1.0.0 release.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/LIBRARY.md>, 2026-09-29, checked

## Rule format

> Kingfisher fully supports loading both the Kingfisher rule format (.yml/.yaml) and Betterleaks TOML (.toml) for custom rules.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/RULES.md>, 2026-09-29, checked

> Breaking: moved the candidate detector catalog to the Betterleaks rule format, with selected Veles detectors filling gaps, giving the community a well-designed shared format and a common place to develop generally useful rules.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/CHANGELOG.md>, v2.0.0, 2026-08-23, checked

> Hyperscan/Vectorscan does not support lookaround.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/RULES.md>, 2026-09-29, checked

## Secrets and tokens

> detect and validate credentials across cloud, AI, developer tooling, databases, SaaS, messaging, identity, and cryptographic systems through the Betterleaks- and Veles-based candidate catalog

<https://github.com/mongodb/kingfisher/blob/v2.8.0/README.md>, 2026-09-29, checked

## Personal data in plain text

> Load .toml, .yml, or .yaml custom rules with --rules-path.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/RULES.md>, 2026-09-29, checked

## Attribution lines

> Metadata about a Git commit. This is used to track the provenance of blobs found in git history.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/crates/kingfisher-core/src/git_commit_metadata.rs>, 2026-09-29, checked

## Session transcripts

> --no-base64: By default, Kingfisher finds and decodes base64 blobs and scans them for secrets.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/ADVANCED.md>, 2026-09-29, checked

## Git history and commit messages

> This includes merged history and secrets added and removed before the tip.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/USAGE.md>, 2026-09-29, checked

## Scrub and recheck

> Revocation does not remove copies from Git history, forks, logs, caches, or artifacts.

<https://github.com/mongodb/kingfisher/blob/v2.8.0/docs/DEFENDER_WORKFLOW.md>, 2026-09-29, checked
