# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> The core is written by Pure JavaScript. It work on Browser and Node.js.

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/core/README.md>, 2026-09-25, checked

> Require Node.js 22+.

<https://github.com/secretlint/secretlint/blob/v13.0.6/README.md>, 2026-09-25, checked

> MIT © azu

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/secretlint-rule-preset-recommend/README.md>, 2026-09-25, checked

> export const lintSource = ({ source, options }: SecretLintSourceOptions): Promise<SecretLintCoreResult> => {

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/core/src/index.ts>, 2026-09-25, checked

## Rule format

> Secretlint Rule is a npm package.

<https://github.com/secretlint/secretlint/blob/v13.0.6/docs/secretlint-rule.md>, 2026-09-25, checked

## Secrets and tokens

> // ASN.1 format (PKCS#1, PKCS#8, SEC1): 0x30 (SEQUENCE) → "MI*"

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/secretlint-rule-privatekey/src/index.ts>, 2026-09-25, checked

## Personal data in plain text

> Array of RegExp-like strings to match against file content

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/secretlint-rule-pattern/README.md>, 2026-09-25, checked

## Home paths

> const userHomeDirPattern = multiplatformPath(options._debugHomeDir ?? os.homedir());

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/secretlint-rule-no-homedir/src/index.ts>, 2026-09-25, checked

## Attribution lines

> --stdinFileName [String] filename to process STDIN content. Some rules depend on filename to check content.

<https://github.com/secretlint/secretlint/blob/v13.0.6/README.md>, 2026-09-25, checked

## Session transcripts

> Backslash included to handle JSON escape sequences (\n, \r, \t)

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/secretlint-rule-privatekey/src/index.ts>, 2026-09-25, checked

## Git history and commit messages

> we need to think masking(fixing) for credential.

<https://github.com/secretlint/secretlint/issues/34>, 2020-02-17, open, checked

## Scrub and recheck

> Secretlint can not fix the secrets automatically. However, It is useful that `--format=mask-result` mask the secrets of input file.

<https://github.com/secretlint/secretlint/blob/v13.0.6/README.md>, 2026-09-25, checked

> tmp = replaceRange(tmp, message.range, "*".repeat(length));

<https://github.com/secretlint/secretlint/blob/v13.0.6/packages/%40secretlint/formatter/src/formatters/mask-result.ts>, 2026-09-25, checked
