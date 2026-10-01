# Passages

Quoted from the pages named under each passage, read 2026-10-01. Only the passages the wiki
relies on are kept, under the kind of private data they bear on. Each names its page and the
page's own date. A passage marked *checked* was compared with the file at the pinned commit or
tag; the others were read through a text-extracting fetch of the page.

## Version, licence and packaging

> Apache License

<https://github.com/rayward-external/clawjournal/blob/e6184a1/LICENSE>, 2026-09-19, checked

> It works with Claude Code, Claude Desktop, Claude Science, Codex, Gemini CLI, OpenCode, OpenClaw, Kimi CLI, WorkBuddy, Cursor, Copilot, and Aider.

<https://github.com/rayward-external/clawjournal/blob/e6184a1/README.md>, 2026-09-19, checked

## Secrets and tokens

> is the primary detection layer: ~380 rules plus token-efficiency and entropy filters.

<https://github.com/rayward-external/clawjournal/blob/e6184a1/PRIVACY.md>, 2026-09-19, checked

## Home paths

> Replaced with `[REDACTED_PATH]`

<https://github.com/rayward-external/clawjournal/blob/e6184a1/PRIVACY.md>, 2026-09-19, checked

> # Absolute home-directory paths (leaks username and directory structure)

<https://github.com/rayward-external/clawjournal/blob/e6184a1/clawjournal/redaction/pii.py>, 2026-09-19, checked

## Host names and private addresses

> A personal device-name candidate

<https://github.com/rayward-external/clawjournal/blob/e6184a1/PRIVACY.md>, 2026-09-19, checked

## Email addresses

> Replaced with `[REDACTED_EMAIL]`

<https://github.com/rayward-external/clawjournal/blob/e6184a1/PRIVACY.md>, 2026-09-19, checked

## Session transcripts

> Terminal output captured in agent sessions carries ANSI/VT escape sequences

<https://github.com/rayward-external/clawjournal/blob/e6184a1/clawjournal/redaction/normalize.py>, 2026-09-19, checked

> Works on session dicts directly, returns the redacted copy plus a metadata-only log.

<https://github.com/rayward-external/clawjournal/blob/e6184a1/clawjournal/redaction/secrets.py>, 2026-09-19, checked

## Scrub and recheck

> Every share export runs two independent secret scanners on the already-redacted `sessions.jsonl` before the export is considered complete

<https://github.com/rayward-external/clawjournal/blob/e6184a1/PRIVACY.md>, 2026-09-19, checked
