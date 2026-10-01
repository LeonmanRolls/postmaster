# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> 1.3.0

<https://github.com/awslabs/git-secrets/tags>, 2019-02-10

> #!/usr/bin/env bash

<https://github.com/awslabs/git-secrets/blob/7d6b970/git-secrets>, 2025-09-17, checked

## Secrets and tokens

> Adds common AWS patterns to the git config and ensures that keys present in ~/.aws/credentials are not found in any commit.

<https://github.com/awslabs/git-secrets/blob/7d6b970/README.rst>, 2025-09-17, checked

## Personal data in plain text

> You can add prohibited regular expression patterns to your git config using git secrets --add <pattern>.

<https://github.com/awslabs/git-secrets/blob/7d6b970/README.rst>, 2025-09-17, checked

## Attribution lines

> commit-msg: Used to determine if a commit message contains a prohibited patterns.

<https://github.com/awslabs/git-secrets/blob/7d6b970/README.rst>, 2025-09-17, checked

## Session transcripts

> Each matched line will be written with the name of the file that matched, a colon, the line number that matched, a colon, and then the line of text that matched.

<https://github.com/awslabs/git-secrets/blob/7d6b970/README.rst>, 2025-09-17, checked

## Git history and commit messages

> local to_scan=$(git log --all -G"${combined_patterns}" --pretty=%H)

<https://github.com/awslabs/git-secrets/blob/7d6b970/git-secrets>, 2025-09-17, checked

## Scrub and recheck

> When a file contains a secret, the matched text from the file being scanned will be written to stdout and the script will exit with a non-zero status.

<https://github.com/awslabs/git-secrets/blob/7d6b970/README.rst>, 2025-09-17, checked
