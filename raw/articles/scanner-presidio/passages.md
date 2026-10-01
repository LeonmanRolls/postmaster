# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> 2026-07-22T07:54:34

<https://pypi.org/pypi/presidio-analyzer/2.2.364/json>, 2026-07-22, checked

> Presidio will continue to be open source under the MIT license.

<https://presidio.dataprivacystack.org/project_transition/>, read 2026-10-01

> Presidio can expose REST endpoints for each service using Flask and Docker.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/installation.md>, 2026-07-22, checked

## Rule format

> The `PatternRecognizer` is an class for supporting regex and deny-list based recognition logic, including validation (e.g., with checksum) and context support.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/analyzer/adding_recognizers.md>, 2026-07-22, checked

> Custom: custom created pattern recognizers that are created based on the fields provided in the configuration file.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/analyzer/recognizer_registry_provider.md>, 2026-07-22, checked

## Secrets and tokens

> This is not currently supported, but integrating something like detect-secrets would be a great contribution into Presidio.

<https://github.com/microsoft/presidio/discussions/1370>, 2024-04-29

## Personal data in plain text

> A full person name, which can include first names, middle names or initials, and last names.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/supported_entities.md>, 2026-07-22, checked

## Home paths

> Presidio contains predefined recognizers for PII entities. This page describes the different entities Presidio can detect and the method Presidio employs to detect those.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/supported_entities.md>, 2026-07-22, checked

## Host names and private addresses

> ipaddress.ip_interface(pattern_text)

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/presidio-analyzer/presidio_analyzer/predefined_recognizers/generic/ip_recognizer.py>, 2026-07-22, checked

## Email addresses

> :param allow_list_match: How the allow_list should be interpreted; either as "exact" or as "regex".

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/presidio-analyzer/presidio_analyzer/analyzer_engine.py>, 2026-07-22, checked

## Session transcripts

> Analyze a dictionary of keys (strings) and values/iterable of values. Non-string values are returned as is.

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/presidio-analyzer/presidio_analyzer/batch_analyzer_engine.py>, 2026-07-22, checked

> Nesting objects in lists is not supported in JsonAnalysisBuilder for now

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/structured/index.md>, 2026-07-22, checked

## Git history and commit messages

> It is recommended to ignore `Version Control` files, for example `.git`

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/presidio-cli/README.md>, 2026-07-22, checked

## Scrub and recheck

> If `new_value` is not supplied or empty, default behavior will be:

<https://github.com/data-privacy-stack/presidio/blob/2.2.364/docs/anonymizer/index.md>, 2026-07-22, checked
