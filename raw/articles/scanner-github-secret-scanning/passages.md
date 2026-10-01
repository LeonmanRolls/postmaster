# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Organization-owned private and internal repositories: Available with GitHub Secret Protection enabled on GitHub Team or GitHub Enterprise Cloud.

<https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning>, read 2026-10-01

## Rule format

> Secret scanning custom patterns are defined using the Hyperscan library and only support Hyperscan regex constructs, which are a subset of PCRE syntax. Hyperscan option modifiers are not supported.

<https://docs.github.com/en/code-security/reference/secret-security/custom-patterns>, read 2026-10-01

## Secrets and tokens

> HTTP Bearer tokens used for API authentication

<https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns>, read 2026-10-01

## Email addresses

> each time you push to GitHub, we'll check the most recent commit. If the author email on that commit is a private email on your GitHub account, we will block the push

<https://docs.github.com/en/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address>, read 2026-10-01

## Attribution lines

> commit, wiki_commit, issue_title, issue_body, issue_comment, discussion_title, discussion_body, discussion_comment, pull_request_title, pull_request_body, pull_request_comment, pull_request_review, pull_request_review_comment

<https://docs.github.com/en/rest/secret-scanning/secret-scanning?apiVersion=2022-11-28>, read 2026-10-01

## Session transcripts

> the following private key patterns will also detect keys that contain escaped newlines (`\n`), a common format in configuration files and environment variables.

<https://github.blog/changelog/2025-11-12-secret-scanning-improves-private-key-detection/>, 2025-11-12

## Git history and commit messages

> Secret scanning scans your entire Git history on all branches of your repository for hardcoded credentials, including API keys, passwords, tokens, and other known secret types.

<https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning>, read 2026-10-01

## Scrub and recheck

> Secret scanning doesn't automatically close alerts when the corresponding token has been removed from the repository.

<https://docs.github.com/en/code-security/secret-scanning/managing-alerts-from-secret-scanning/resolving-alerts>, read 2026-10-01
