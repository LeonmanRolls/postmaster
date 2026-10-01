# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> "tag_name":"v0.21.4"

<https://api.github.com/repos/vshulcz/deja-vu/releases/latest>, 2026-09-29, checked

> One Go binary.

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/README.md>, 2026-09-29, checked

## Secrets and tokens

> Credentials are stripped as the index is built: cloud and provider keys, tokens and JWTs,

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/README.md>, 2026-09-29, checked

## Personal data in plain text

> Redaction also cannot remove sensitive prose that does not look like a credential.

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/docs/SECURITY-MODEL.md>, 2026-09-29, checked

## Home paths

> a path under a home directory, which becomes ~/…

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/internal/redact/outbound.go>, 2026-09-29, checked

## Host names and private addresses

> an internal hostname — .local, .internal, .lan, .corp, .svc and friends

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/internal/redact/outbound.go>, 2026-09-29, checked

> an IP address, except loopback and the RFC 5737 documentation ranges

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/internal/redact/outbound.go>, 2026-09-29, checked

## Email addresses

> //   - an email address

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/internal/redact/outbound.go>, 2026-09-29, checked

## Session transcripts

> agents paste nested JSON, where every quote arrives escaped

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/internal/redact/redact.go>, 2026-09-29, checked

## Scrub and recheck

> `deja secrets` names those sessions without printing a value, and `deja secrets --scrub`

<https://github.com/vshulcz/deja-vu/blob/v0.21.4/README.md>, 2026-09-29, checked
