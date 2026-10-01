# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> "tag_name": "v3.97.9"

<https://api.github.com/repos/trufflesecurity/trufflehog/releases?per_page=6>, 2026-09-24, checked

> Since v3.0, TruffleHog is released under a AGPL 3 license, included in [`LICENSE`](LICENSE).

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/README.md>, 2026-09-24, checked

> Currently, trufflehog is in heavy development and no guarantees can be made on the stability of the public APIs at this time.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/README.md>, 2026-09-24, checked

## Rule format

> **NB:** This feature is alpha and subject to change.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/README.md>, 2026-09-24, checked

## Secrets and tokens

> TruffleHog classifies over 800 secret types, mapping them back to the specific identity they belong to.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/README.md>, 2026-09-24, checked

## Personal data in plain text

> TruffleHog supports detection and verification of custom regular expressions.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/README.md>, 2026-09-24, checked

## Email addresses

> It scans the commit author, committer (which is typically `GitHub <noreply@github.com>` for GitHub, but can be different), and message.

<https://github.com/trufflesecurity/trufflehog/pull/2713>, 2024-04-25, checked

## Attribution lines

> // Scan the commit metadata.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/pkg/sources/git/git.go>, 2026-09-24, checked

## Session transcripts

> // Common escape sequence used in programming languages.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/pkg/decoders/escaped_unicode.go>, 2026-09-24, checked

> in = strings.ReplaceAll(in, `\n`, "\n")

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/pkg/detectors/privatekey/normalize.go>, 2026-09-24, checked

## Git history and commit messages

> // We only care about additions.

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/pkg/gitparse/gitparse.go>, 2026-09-24, checked

> [Request] Scan the Commit Metadata (email, name and commit message) for secrets

<https://github.com/trufflesecurity/trufflehog/issues/2683>, 2024-04-07, closed 2024-04-25, checked

## Scrub and recheck

> I couldn't find an option to auto redact detected secrets from logfiles.

<https://github.com/trufflesecurity/trufflehog/issues/3545>, 2024-11-01, open, checked

> RawV2 string

<https://github.com/trufflesecurity/trufflehog/blob/v3.97.9/pkg/output/json.go>, 2026-09-24, checked
