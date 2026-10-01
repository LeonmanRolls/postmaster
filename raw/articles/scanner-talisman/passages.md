# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> The MIT License (MIT)

<https://github.com/thoughtworks/talisman/blob/v1.37.0/LICENSE>, 2025-05-02, checked

## Secrets and tokens

> (?s)(BEGIN RSA PRIVATE KEY.*END RSA PRIVATE KEY)

<https://github.com/thoughtworks/talisman/blob/v1.37.0/detector/pattern/pattern_detector.go>, 2025-05-02, checked

## Personal data in plain text

> Credit card numbers - scans for content that could be potential credit card numbers

<https://github.com/thoughtworks/talisman/blob/v1.37.0/README.md>, 2025-05-02, checked

## Home paths

> You can specify custom regex patterns to look for in the current repository

<https://github.com/thoughtworks/talisman/blob/v1.37.0/README.md>, 2025-05-02, checked

## Attribution lines

> Talisman is a tool that scans git changesets to ensure that potential secrets or sensitive information do not leave the developer's workstation.

<https://github.com/thoughtworks/talisman/blob/v1.37.0/README.md>, 2025-05-02, checked

## Git history and commit messages

> blobDetailsBytes, _ := exec.Command("git", "ls-tree", "-r", commit).CombinedOutput()

<https://github.com/thoughtworks/talisman/blob/v1.37.0/scanner/scanner.go>, 2025-05-02, checked
