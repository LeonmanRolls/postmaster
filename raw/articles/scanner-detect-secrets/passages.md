# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Added a detector for IP addresses

<https://github.com/Yelp/detect-secrets/releases/tag/v1.5.0>, 2024-05-06, checked

> from detect_secrets import SecretsCollection

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/README.md>, 2024-05-06, checked

## Rule format

> All plugins MUST inherit from `detect_secrets.plugins.base.BasePlugin`.

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/docs/plugins.md>, 2024-05-06, checked

## Secrets and tokens

> This checks for private keys by determining whether the denylisted lines are present in the analyzed string.

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/detect_secrets/plugins/private_key.py>, 2024-05-06, checked

## Personal data in plain text

> To do this, you can use the `--plugin` flag in `detect-secrets scan`.

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/docs/plugins.md>, 2024-05-06, checked

## Host names and private addresses

> Some non-public ipv4 addresses are ignored, such as:

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/detect_secrets/plugins/ip_public.py>, 2024-05-06, checked

## Session transcripts

> # We require quoted strings to reduce noise.

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/detect_secrets/plugins/high_entropy_strings.py>, 2024-05-06, checked

## Git history and commit messages

> This way, it avoids the overhead of digging through all git history, as well as the need to scan the entire repository every time.

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/README.md>, 2024-05-06, checked

## Scrub and recheck

> return hashlib.sha1(secret.encode('utf-8')).hexdigest()

<https://github.com/Yelp/detect-secrets/blob/v1.5.0/detect_secrets/core/potential_secret.py>, 2024-05-06, checked
