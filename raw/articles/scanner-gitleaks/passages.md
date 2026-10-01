# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> "tag_name": "v8.30.1"

<https://api.github.com/repos/gitleaks/gitleaks/releases/latest>, 2026-03-21, checked

> "spdx_id": "MIT"

<https://api.github.com/repos/gitleaks/gitleaks>, read 2026-10-01, checked

> Gitleaks is feature complete. I'm not merging new features into Gitleaks. Future releases will be security patches only.

<https://github.com/gitleaks/gitleaks/blob/80093b8a7b600e52d96ec5d49e9657f5c74b77fa/README.md>, 2026-05-21, checked

> DetectString scans the given string and returns a list of findings

<https://pkg.go.dev/github.com/zricethezav/gitleaks/v8@v8.30.1/detect>, 2026-03-12

## Rule format

> Golang regular expression used to detect secrets. Note Golang's regex engine

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md>, 2026-03-12, checked

> Int used to extract secret from regex match and used as the group that will have

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md>, 2026-03-12, checked

> In v8.28.0 Gitleaks introduced composite rules, which are made up of a single "primary" rule and one or more auxiliary or `required` rules.

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md>, 2026-03-12, checked

## Secrets and tokens

> id = "anthropic-api-key"

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml>, 2026-03-12, checked

> [\s\S-]{64,}?KEY(?: BLOCK)?-----

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml>, 2026-03-12, checked

## Personal data in plain text

> Gitleaks is a tool for detecting secrets like passwords, API keys, and tokens in git repos, files, and whatever else you wanna throw at it via `stdin`.

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md>, 2026-03-12, checked

## Home paths

> '''^/Users/(?i)[a-z0-9]+/[\w .-/]+$''',

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml>, 2026-03-12, checked

> '''^/(?:bin|etc|home|opt|tmp|usr|var)/[\w ./-]+$''',

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml>, 2026-03-12, checked

## Email addresses

> A finding will be ignored if _ANY_ `[[rules.allowlists]]` matches.

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md>, 2026-03-12, checked

## Attribution lines

> Message: gitdiffFile.PatchHeader.Message(),

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/sources/git.go>, 2026-03-12, checked

## Session transcripts

> pattern: `(?:(?:U\+[a-fA-F0-9]{4}(?:\s|$))+|(?i)(?:\\{1,2}u[a-fA-F0-9]{4})+)`,

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/detect/codec/encodings.go>, 2026-03-12, checked

> (?:[\x60'"\s;]|\\[nr]|$)

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml>, 2026-03-12, checked

> normalizedRaw := strings.ToLower(currentRaw)

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/detect/detect.go>, 2026-03-12, checked

## Git history and commit messages

> There have been several cases where folks were looking to open source their repositories where we wanted to scan not only the codebase but also their commit messages for secrets.

<https://github.com/gitleaks/gitleaks/issues/800>, 2022-03-02, open, checked

> cmd = exec.CommandContext(ctx, "git", "-C", sourceClean, "log", "-p", "-U0", "--full-history", "--all", "--diff-filter=tuxdb")

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/sources/git.go>, 2026-03-12, checked

> Gitleaks is unable to detect secrets when they were added during a merge

<https://github.com/gitleaks/gitleaks/issues/1028>, 2022-11-10, open, checked

## Scrub and recheck

> redact secrets from logs and stdout. To redact only parts of the secret just apply a percent value from 0..100. For example --redact=20 (default 100%)

<https://github.com/gitleaks/gitleaks/blob/v8.30.1/cmd/root.go>, 2026-03-12, checked
