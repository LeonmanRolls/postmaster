# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Audit a repo for PII leakage, secrets, and sensitive data before commits or publishing.

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

## Home paths

> `/Users/<name>/`, `/home/<name>/`, `C:\Users\`, `/mnt/c/Users/`

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

## Host names and private addresses

> internal hostnames, VPN addresses, corporate SSO URLs

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

## Session transcripts

> session[_-]notes?

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

## Git history and commit messages

> Runs gitleaks if available, scans git history, checks working tree for known and novel patterns

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

> git log --all --oneline           # check commit messages for names, emails, paths

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked

## Scrub and recheck

> Before running any step that rewrites history, check whether `git-filter-repo` is available:

<https://github.com/clewisdev/skills/blob/bd55e7b/pii-check/SKILL.md>, 2026-06-09, checked
