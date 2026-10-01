# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Titus is a Go port of NoseyParker that can scan content for secrets

<https://github.com/praetorian-inc/titus/blob/v1.2.10/titus.go>, 2026-09-28, checked

> Nosey Parker is now Replaced by Titus. Nosey Parker is Officially Retired

<https://github.com/praetorian-inc/noseyparker/blob/2e6e7f3/README.md>, 2026-02-21, checked

> Apache License 2.0 — see [LICENSE](LICENSE).

<https://github.com/praetorian-inc/titus/blob/v1.2.10/README.md>, 2026-09-28, checked

## Rule format

> NegativeExamples    []string                 `yaml:"negative_examples,omitempty"`

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/rule/yaml.go>, 2026-09-28, checked

## Secrets and tokens

> It ships with 487 detection rules covering hundreds of services and credential types, drawn from NoseyParker and Kingfisher.

<https://github.com/praetorian-inc/titus/blob/v1.2.10/README.md>, 2026-09-28, checked

## Personal data in plain text

> Remove np.pii.phone.1 and np.pii.email.1 rules (too noisy for production)

<https://github.com/praetorian-inc/titus/commit/f8fc28367a372a202877b3c944585d2d7fec418b>, 2026-09-02, checked

> All CCN rules are marked noisy: true because they have inherently higher false-positive

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/rule/rules/ccn.yml>, 2026-09-28, checked

## Home paths

> This ruleset includes rules that detect secrets, such as API tokens and user-selected passwords.

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/rule/rulesets/default.yml>, 2026-09-28, checked

## Attribution lines

> --format=%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/enum/commit_metadata.go>, 2026-09-28, checked

## Session transcripts

> ExtractText extracts text from supported binary files (xlsx, docx, pptx, pdf, zip, tar, ipynb).

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/enum/extractor.go>, 2026-09-28, checked

## Git history and commit messages

> // Phase 1: git rev-list --all --objects → collect unique blob hashes with paths.

<https://github.com/praetorian-inc/titus/blob/v1.2.10/pkg/enum/git_native.go>, 2026-09-28, checked
