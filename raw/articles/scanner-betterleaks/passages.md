# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Betterleaks is a configurable, fast, and thorough secrets scanner. It is maintained by the folks who made Gitleaks, including the original author.

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/README.md>, 2026-09-29, checked

> Betterleaks v1.9.0 expands secret detection coverage and improves performance.

<https://github.com/betterleaks/betterleaks/releases/tag/v1.9.0>, 2026-09-29, checked

> This is a prerelease. Breaking changes to the CLI, configuration, report formats, and Go API may still land before v2.0.0.

<https://github.com/betterleaks/betterleaks/releases/tag/v2.0.0-rc.1>, 2026-09-30, checked

> MIT License

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/LICENSE>, 2026-09-29, checked

> To be transparent, I don't have full control over the Gitleaks repo and name anymore.

<https://www.aikido.dev/blog/betterleaks-gitleaks-successor>, 2026-03-12

> HTTP 404 Not Found

<https://registry.npmjs.org/betterleaks>, read 2026-10-01

> Betterleaks can also be embedded as a Go library. Scanners and analyzers are silent by default and safe to reuse across scans.

<https://github.com/betterleaks/betterleaks/blob/v2.0.0-rc.1/README.md>, 2026-09-30, checked

## Rule format

> It is TOML because rules are mostly flat data plus Expr expressions.

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/docs/config.md>, 2026-09-29, checked

> Unknown TOML fields now fail loading, including fields in inherited configs.

<https://github.com/betterleaks/betterleaks/blob/v2.0.0-rc.1/docs/v2_migration.md>, 2026-09-30, checked

## Secrets and tokens

> Added 46 detection rules, including Miro, VoyageAI, and Bitbucket Data Center tokens.

<https://github.com/betterleaks/betterleaks/releases/tag/v1.9.0>, 2026-09-29, checked

> We added 87 new rules, and increased rules with validation from 106 to 187 while dropping scan times.

<https://github.com/betterleaks/betterleaks/releases/tag/v1.7.0>, 2026-07-23, checked

> Regex: regexp.MustCompile(`(?i)-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----`),

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/cmd/generate/config/rules/privatekey.go>, 2026-09-29, checked

## Personal data in plain text

> `regex`: regular expression used to detect the secret.

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/docs/config.md>, 2026-09-29, checked

## Home paths

> `^/Users/(?i)[a-z0-9]+/[\w .-/]+$`, `^/(?:bin|etc|home|opt|tmp|usr|var)/[\w ./-]+$`

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/config/betterleaks.toml>, 2026-09-29, checked

## Email addresses

> Returns `true` if the string matches any regex pattern in the list.

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/docs/config.md>, 2026-09-29, checked

## Attribution lines

> commitAttrs[AttrGitMessage] = gitdiffFile.PatchHeader.Message()

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/sources/git.go>, 2026-09-29, checked

## Session transcripts

> var encodingNames = []string{ "percent", "unicode", "hex", "base64", }

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/detect/codec/encodings.go>, 2026-09-29, checked

> JSONLContent parses each line as JSON to determine which string values need redaction, then performs targeted replacements on the raw JSON bytes.

<https://pkg.go.dev/github.com/entireio/cli/redact>, v0.11.3, 2026-09-25

## Git history and commit messages

> `--include=commit-messages` adds message scanning to the default patch scan. Each selected commit's full message is scanned once, including empty commits and merge commits with no patch.

<https://github.com/betterleaks/betterleaks/blob/v2.0.0-rc.1/docs/scanning.md>, 2026-09-30, checked

> cmd = exec.CommandContext(ctx, "git", "-C", sourceClean, "log", "-p", "-U0", "--full-history", "--all", "--diff-filter=tuxdb")

<https://github.com/betterleaks/betterleaks/blob/v1.9.0/sources/git.go>, 2026-09-29, checked

## Scrub and recheck

> Reporting and redaction belong to your application; use `Finding.RedactedCopy` when exporting findings that should hide credentials.

<https://github.com/betterleaks/betterleaks/blob/v2.0.0-rc.1/docs/v2_migration.md>, 2026-09-30, checked

> `betterleaks git -v --redact` reports it twice for the exact same commit/file/line/rule: once correctly redacted (with the `^^^^^^^^` underline marker), and once as the raw, unredacted secret value, with no underline marker at all.

<https://github.com/betterleaks/betterleaks/issues/350>, 2026-09-12, open, checked
