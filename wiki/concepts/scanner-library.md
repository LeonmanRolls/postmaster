---
title: No library covers what the private-data scanner checks, so postmaster publishes one
type: concept
standing: claimed
sources: [trials/scanner-rule-format, papers/panfilov-2026-reasoning-traces, papers/richards-2026-agentlogs, articles/csa-2026-reasoning-trace-theft, articles/anthropic-thinking-encryption, articles/claude-code-attribution-setting, articles/claude-code-issue-50014, articles/gitguardian-secrets-sprawl-2026, articles/scanner-gitleaks, articles/scanner-betterleaks, articles/scanner-trufflehog, articles/scanner-kingfisher, articles/scanner-titus, articles/scanner-detect-secrets, articles/scanner-secretlint, articles/scanner-ggshield, articles/scanner-git-secrets, articles/scanner-talisman, articles/scanner-ripsecrets, articles/scanner-trivy, articles/scanner-github-secret-scanning, articles/scanner-presidio, articles/scanner-scrubadub, articles/scanner-datafog, articles/scanner-llm-guard, articles/scanner-google-sdp, articles/scanner-openredaction, articles/scanner-openai-privacy-filter, articles/scanner-entire, articles/scanner-clawjournal, articles/scanner-deja-vu, articles/scanner-ccs-sanitizer, articles/scanner-agent-archive, articles/scanner-scrub-transcripts, articles/scanner-dataclaw, articles/scanner-agentscrub, articles/scanner-git-filter-repo, articles/scanner-bfg, articles/scanner-leak-lock, articles/scanner-pii-check]
updated: 2026-10-01
---

# No library covers what the private-data scanner checks, so postmaster publishes one

**Claim.** As of 2026-10-01 no tool or library checks what #135's scanner checks: secrets and
personal data, the home paths of any user, private hosts, email addresses and attribution lines,
in agent transcripts and in the whole git history of a change with its commit messages, and then
scrubs a copy and checks it again. Secret scanners leave out personal context, and most leave out
commit messages. Personal-data tools read neither transcripts nor git. The transcript scrubbers
released in 2026 each cover part of a transcript, and none reads git history. A library
would fill a real gap, and the gap is the reason to publish it: nobody asks an individual to
publish a library that does not exist yet. Its rules are still changing under #135's review, and
#109 is about to port them to TypeScript, so the scanner is published once #135 lands, through
that port, rather than built first.

**Standing: claimed.** It rests on a survey of 32 outside tools, each cited to its documentation
or source at a dated version, and on one trial against #135's rule table
[@trials/scanner-rule-format]. No run bears on it, and outside work cannot move a standing.

## What #135's scanner checks

#135, "A gate check refuses any change that carries a harness session's private context", is in
review, and its branch is not yet pushed. This page reads it at commit `1223cc0` of 2026-10-01.
Its rule table has eight rules, `key`, `account-id`, `email`, `private-path`, `private-host`,
`token`, `dotenv` and `assistant-attribution`, built from 21 patterns and functions
[@trials/scanner-rule-format/results/table.txt]. One script scans a change's added lines, the
names of the files it adds, its commit messages, its merge resolutions and its pull-request text.
A second copies a run's records into `raw/`, replaces each finding with a placeholder, and scans
the copy again. A third rewrites unpushed commits without a finding
[@trials/scanner-rule-format/results/entry-points.txt]. Every line is stripped of terminal escape
codes and has its JSON strings decoded before the rules run.

The ticket names the kinds a survey must cover, and the tables below use them as columns:
secrets and tokens; personal data in plain text; home paths; private host names and addresses;
email addresses, other than public no-reply ones; attribution lines; session transcripts, whose
values sit in escaped JSON strings, behind terminal escape codes, or in JSON held inside a
string; git history with its commit messages; and scrubbing a copy, then checking it again.

## The survey

Thirty-two tools, read on 2026-10-01 from their documentation and source at the version named.
Each cell gives a verdict, the date of the passage it rests on, and the capture holding that
passage. `yes`: built in. `opt-in`: built in and off by default. `rule`: only through a rule,
plugin or expression the user writes. `part`: some of the kind, which the notes name.
`unstated`: the sources read say nothing either way. `no`: not at all. Passages from GitHub were
compared with the file at the pinned commit or tag; the others were read through a fetch of the
page, and each capture marks which is which.

### What each tool finds

| tool | Secrets and tokens | Personal data | Home paths | Private hosts | Email addresses |
|---|---|---|---|---|---|
| **#135's own check, for comparison** | | | | | |
| #135 at `1223cc0` | yes, 2026-10-01 [@trials/scanner-rule-format] | part, 2026-10-01 [@trials/scanner-rule-format] | yes, 2026-10-01 [@trials/scanner-rule-format] | yes, 2026-10-01 [@trials/scanner-rule-format] | yes, 2026-10-01 [@trials/scanner-rule-format] |
| **Secret scanners** | | | | | |
| gitleaks 8.30.1 | yes, 2026-03-12 [@articles/scanner-gitleaks] | rule, 2026-03-12 [@articles/scanner-gitleaks] | rule, 2026-03-12 [@articles/scanner-gitleaks] | rule, 2026-03-12 [@articles/scanner-gitleaks] | rule, 2026-03-12 [@articles/scanner-gitleaks] |
| Betterleaks 1.9.0, 2.0.0-rc.1 | yes, 2026-09-29 [@articles/scanner-betterleaks] | rule, 2026-09-29 [@articles/scanner-betterleaks] | rule, 2026-09-29 [@articles/scanner-betterleaks] | rule, 2026-09-29 [@articles/scanner-betterleaks] | rule, 2026-09-29 [@articles/scanner-betterleaks] |
| TruffleHog 3.97.9 | yes, 2026-09-24 [@articles/scanner-trufflehog] | rule, 2026-09-24 [@articles/scanner-trufflehog] | rule, 2026-09-24 [@articles/scanner-trufflehog] | rule, 2026-09-24 [@articles/scanner-trufflehog] | rule, 2024-04-25 [@articles/scanner-trufflehog] |
| Kingfisher 2.8.0 | yes, 2026-09-29 [@articles/scanner-kingfisher] | rule, 2026-09-29 [@articles/scanner-kingfisher] | rule, 2026-09-29 [@articles/scanner-kingfisher] | rule, 2026-09-29 [@articles/scanner-kingfisher] | rule, 2026-09-29 [@articles/scanner-kingfisher] |
| Titus 1.2.10 | yes, 2026-09-28 [@articles/scanner-titus] | part, 2026-09-02 [@articles/scanner-titus] | rule, 2026-09-28 [@articles/scanner-titus] | rule, 2026-09-28 [@articles/scanner-titus] | rule, 2026-09-02 [@articles/scanner-titus] |
| detect-secrets 1.5.0 | yes, 2024-05-06 [@articles/scanner-detect-secrets] | rule, 2024-05-06 [@articles/scanner-detect-secrets] | rule, 2024-05-06 [@articles/scanner-detect-secrets] | no, 2024-05-06 [@articles/scanner-detect-secrets] | rule, 2024-05-06 [@articles/scanner-detect-secrets] |
| secretlint 13.0.6 | yes, 2026-09-25 [@articles/scanner-secretlint] | rule, 2026-09-25 [@articles/scanner-secretlint] | part, 2026-09-25 [@articles/scanner-secretlint] | rule, 2026-09-25 [@articles/scanner-secretlint] | rule, 2026-09-25 [@articles/scanner-secretlint] |
| ggshield 1.55.0 | yes, 2026-09-24 [@articles/scanner-ggshield] | no, 2026-09-25 [@articles/scanner-ggshield] | no, 2026-09-25 [@articles/scanner-ggshield] | no, 2026-09-25 [@articles/scanner-ggshield] | no, 2026-09-25 [@articles/scanner-ggshield] |
| git-secrets 1.3.0 and later commits | part, 2025-09-17 [@articles/scanner-git-secrets] | rule, 2025-09-17 [@articles/scanner-git-secrets] | rule, 2025-09-17 [@articles/scanner-git-secrets] | rule, 2025-09-17 [@articles/scanner-git-secrets] | rule, 2025-09-17 [@articles/scanner-git-secrets] |
| Talisman 1.37.0 | part, 2025-05-02 [@articles/scanner-talisman] | part, 2025-05-02 [@articles/scanner-talisman] | rule, 2025-05-02 [@articles/scanner-talisman] | rule, 2025-05-02 [@articles/scanner-talisman] | rule, 2025-05-02 [@articles/scanner-talisman] |
| ripsecrets 0.1.11 | yes, 2025-05-27 [@articles/scanner-ripsecrets] | rule, 2025-05-27 [@articles/scanner-ripsecrets] | rule, 2025-05-27 [@articles/scanner-ripsecrets] | rule, 2025-05-27 [@articles/scanner-ripsecrets] | rule, 2025-05-27 [@articles/scanner-ripsecrets] |
| Trivy 0.74.0 | yes, 2026-08-14 [@articles/scanner-trivy] | rule, 2026-08-14 [@articles/scanner-trivy] | rule, 2026-08-14 [@articles/scanner-trivy] | rule, 2026-08-14 [@articles/scanner-trivy] | rule, 2026-08-14 [@articles/scanner-trivy] |
| GitHub secret scanning | yes, read 2026-10-01 [@articles/scanner-github-secret-scanning] | rule, read 2026-10-01 [@articles/scanner-github-secret-scanning] | rule, read 2026-10-01 [@articles/scanner-github-secret-scanning] | rule, read 2026-10-01 [@articles/scanner-github-secret-scanning] | part, read 2026-10-01 [@articles/scanner-github-secret-scanning] |
| **Personal-data detectors and redactors** | | | | | |
| Presidio 2.2.364 | rule, 2024-04-29 [@articles/scanner-presidio] | yes, 2026-07-22 [@articles/scanner-presidio] | rule, 2026-07-22 [@articles/scanner-presidio] | part, 2026-07-22 [@articles/scanner-presidio] | yes, 2026-07-22 [@articles/scanner-presidio] |
| scrubadub 2.0.1 | no, 2023-09-01 [@articles/scanner-scrubadub] | yes, 2023-09-01 [@articles/scanner-scrubadub] | no, 2023-09-01 [@articles/scanner-scrubadub] | no, 2023-09-01 [@articles/scanner-scrubadub] | yes, 2023-09-01 [@articles/scanner-scrubadub] |
| DataFog 4.9.0, Core 0.4.1 | part, 2026-09-29 [@articles/scanner-datafog] | yes, 2026-09-29 [@articles/scanner-datafog] | no, 2026-09-29 [@articles/scanner-datafog] | part, 2026-09-29 [@articles/scanner-datafog] | yes, 2026-09-29 [@articles/scanner-datafog] |
| LLM Guard 0.3.16, archived | yes, 2025-05-19 [@articles/scanner-llm-guard] | yes, 2025-05-19 [@articles/scanner-llm-guard] | no, 2025-05-19 [@articles/scanner-llm-guard] | part, 2025-05-19 [@articles/scanner-llm-guard] | yes, 2025-05-19 [@articles/scanner-llm-guard] |
| Google Sensitive Data Protection | yes, read 2026-10-01 [@articles/scanner-google-sdp] | yes, read 2026-10-01 [@articles/scanner-google-sdp] | rule, 2026-09-30 [@articles/scanner-google-sdp] | part, read 2026-10-01 [@articles/scanner-google-sdp] | yes, read 2026-10-01 [@articles/scanner-google-sdp] |
| OpenRedaction 1.1.5 | yes, 2026-07-26 [@articles/scanner-openredaction] | yes, 2026-07-26 [@articles/scanner-openredaction] | no, 2026-07-26 [@articles/scanner-openredaction] | part, 2026-07-26 [@articles/scanner-openredaction] | yes, 2026-07-26 [@articles/scanner-openredaction] |
| OpenAI Privacy Filter | part, 2026-04-22 [@articles/scanner-openai-privacy-filter] | yes, 2026-04-22 [@articles/scanner-openai-privacy-filter] | no, 2026-04-22 [@articles/scanner-openai-privacy-filter] | no, 2026-04-22 [@articles/scanner-openai-privacy-filter] | yes, 2026-04-22 [@articles/scanner-openai-privacy-filter] |
| **Agent-transcript scrubbers** | | | | | |
| Entire CLI 0.11.3 | yes, 2026-09-25 [@articles/scanner-entire] | opt-in, 2026-09-25 [@articles/scanner-entire] | no, 2026-09-25 [@articles/scanner-entire] | no, 2026-09-25 [@articles/scanner-entire] | opt-in, 2026-09-25 [@articles/scanner-entire] |
| ClawJournal at `e6184a1` | yes, 2026-09-19 [@articles/scanner-clawjournal] | part, 2026-09-19 [@articles/scanner-clawjournal] | yes, 2026-09-19 [@articles/scanner-clawjournal] | part, 2026-09-19 [@articles/scanner-clawjournal] | yes, 2026-09-19 [@articles/scanner-clawjournal] |
| deja-vu 0.21.4 | yes, 2026-09-29 [@articles/scanner-deja-vu] | no, 2026-09-29 [@articles/scanner-deja-vu] | part, 2026-09-29 [@articles/scanner-deja-vu] | part, 2026-09-29 [@articles/scanner-deja-vu] | part, 2026-09-29 [@articles/scanner-deja-vu] |
| claude-code-sessions-sanitizer 0.3.1 | yes, 2026-09-26 [@articles/scanner-ccs-sanitizer] | part, 2026-09-26 [@articles/scanner-ccs-sanitizer] | yes, 2026-09-26 [@articles/scanner-ccs-sanitizer] | part, 2026-09-26 [@articles/scanner-ccs-sanitizer] | part, 2026-09-26 [@articles/scanner-ccs-sanitizer] |
| agent-archive 0.1.1 | yes, 2026-09-28 [@articles/scanner-agent-archive] | no, 2026-09-28 [@articles/scanner-agent-archive] | no, 2026-09-28 [@articles/scanner-agent-archive] | no, 2026-09-28 [@articles/scanner-agent-archive] | no, 2026-09-28 [@articles/scanner-agent-archive] |
| scrub-transcripts at `c5e1644` | yes, 2026-09-30 [@articles/scanner-scrub-transcripts] | no, 2026-09-30 [@articles/scanner-scrub-transcripts] | no, 2026-09-30 [@articles/scanner-scrub-transcripts] | no, 2026-09-30 [@articles/scanner-scrub-transcripts] | no, 2026-09-30 [@articles/scanner-scrub-transcripts] |
| DataClaw 0.5.1 | yes, 2026-06-05 [@articles/scanner-dataclaw] | opt-in, 2026-06-05 [@articles/scanner-dataclaw] | part, 2026-06-05 [@articles/scanner-dataclaw] | unstated, 2026-06-05 [@articles/scanner-dataclaw] | yes, 2026-06-05 [@articles/scanner-dataclaw] |
| agentscrub 1.1.43 | yes, 2026-09-29 [@articles/scanner-agentscrub] | opt-in, 2026-09-29 [@articles/scanner-agentscrub] | no, 2026-09-29 [@articles/scanner-agentscrub] | no, 2026-09-29 [@articles/scanner-agentscrub] | opt-in, 2026-09-29 [@articles/scanner-agentscrub] |
| **Git-history rewriters** | | | | | |
| git-filter-repo 2.47.0 | rule, 2024-12-04 [@articles/scanner-git-filter-repo] | rule, 2024-12-04 [@articles/scanner-git-filter-repo] | rule, 2024-12-04 [@articles/scanner-git-filter-repo] | rule, 2024-12-04 [@articles/scanner-git-filter-repo] | rule, 2024-12-04 [@articles/scanner-git-filter-repo] |
| BFG Repo-Cleaner 1.15.0 | rule, read 2026-10-01 [@articles/scanner-bfg] | rule, 2025-01-18 [@articles/scanner-bfg] | rule, 2025-01-18 [@articles/scanner-bfg] | rule, 2025-01-18 [@articles/scanner-bfg] | rule, 2025-01-18 [@articles/scanner-bfg] |
| Leak Lock 0.9.1 | yes, 2026-09-04 [@articles/scanner-leak-lock] | no, 2026-09-04 [@articles/scanner-leak-lock] | no, 2026-09-04 [@articles/scanner-leak-lock] | no, 2026-09-04 [@articles/scanner-leak-lock] | no, 2026-09-04 [@articles/scanner-leak-lock] |
| pii-check skill at `bd55e7b` | yes, 2026-06-09 [@articles/scanner-pii-check] | yes, 2026-06-09 [@articles/scanner-pii-check] | yes, 2026-06-09 [@articles/scanner-pii-check] | yes, 2026-06-09 [@articles/scanner-pii-check] | yes, 2026-06-09 [@articles/scanner-pii-check] |

### Where it looks, and what it does with a finding

| tool | Attribution lines | Session transcripts | Git history and messages | Scrub and recheck |
|---|---|---|---|---|
| **#135's own check, for comparison** | | | | |
| #135 at `1223cc0` | part, 2026-10-01 [@trials/scanner-rule-format] | part, 2026-10-01 [@trials/scanner-rule-format] | yes, 2026-10-01 [@trials/scanner-rule-format] | yes, 2026-10-01 [@trials/scanner-rule-format] |
| **Secret scanners** | | | | |
| gitleaks 8.30.1 | no, 2026-03-12 [@articles/scanner-gitleaks] | part, 2026-03-12 [@articles/scanner-gitleaks] | part, 2022-03-02 [@articles/scanner-gitleaks] | no, 2026-03-12 [@articles/scanner-gitleaks] |
| Betterleaks 1.9.0, 2.0.0-rc.1 | rule, 2026-09-30 [@articles/scanner-betterleaks] | part, 2026-09-29 [@articles/scanner-betterleaks] | part, 2026-09-30 [@articles/scanner-betterleaks] | no, 2026-09-30 [@articles/scanner-betterleaks] |
| TruffleHog 3.97.9 | rule, 2026-09-24 [@articles/scanner-trufflehog] | part, 2026-09-24 [@articles/scanner-trufflehog] | part, 2026-09-24 [@articles/scanner-trufflehog] | no, 2024-11-01 [@articles/scanner-trufflehog] |
| Kingfisher 2.8.0 | no, 2026-09-29 [@articles/scanner-kingfisher] | no, 2026-09-29 [@articles/scanner-kingfisher] | part, 2026-09-29 [@articles/scanner-kingfisher] | no, 2026-09-29 [@articles/scanner-kingfisher] |
| Titus 1.2.10 | no, 2026-09-28 [@articles/scanner-titus] | no, 2026-09-28 [@articles/scanner-titus] | part, 2026-09-28 [@articles/scanner-titus] | no, 2026-09-28 [@articles/scanner-titus] |
| detect-secrets 1.5.0 | no, 2024-05-06 [@articles/scanner-detect-secrets] | no, 2024-05-06 [@articles/scanner-detect-secrets] | no, 2024-05-06 [@articles/scanner-detect-secrets] | no, 2024-05-06 [@articles/scanner-detect-secrets] |
| secretlint 13.0.6 | rule, 2026-09-25 [@articles/scanner-secretlint] | part, 2026-09-25 [@articles/scanner-secretlint] | no, 2020-02-17 [@articles/scanner-secretlint] | part, 2026-09-25 [@articles/scanner-secretlint] |
| ggshield 1.55.0 | no, 2026-09-24 [@articles/scanner-ggshield] | part, 2026-09-25 [@articles/scanner-ggshield] | part, 2026-09-25 [@articles/scanner-ggshield] | no, 2026-09-25 [@articles/scanner-ggshield] |
| git-secrets 1.3.0 and later commits | rule, 2025-09-17 [@articles/scanner-git-secrets] | no, 2025-09-17 [@articles/scanner-git-secrets] | part, 2025-09-17 [@articles/scanner-git-secrets] | no, 2025-09-17 [@articles/scanner-git-secrets] |
| Talisman 1.37.0 | no, 2025-05-02 [@articles/scanner-talisman] | no, 2025-05-02 [@articles/scanner-talisman] | part, 2025-05-02 [@articles/scanner-talisman] | no, 2025-05-02 [@articles/scanner-talisman] |
| ripsecrets 0.1.11 | no, 2025-05-27 [@articles/scanner-ripsecrets] | no, 2025-05-27 [@articles/scanner-ripsecrets] | no, 2025-05-27 [@articles/scanner-ripsecrets] | no, 2025-05-27 [@articles/scanner-ripsecrets] |
| Trivy 0.74.0 | no, 2026-08-14 [@articles/scanner-trivy] | no, 2026-08-14 [@articles/scanner-trivy] | no, 2023-10-05 [@articles/scanner-trivy] | no, 2026-08-14 [@articles/scanner-trivy] |
| GitHub secret scanning | no, read 2026-10-01 [@articles/scanner-github-secret-scanning] | part, 2025-11-12 [@articles/scanner-github-secret-scanning] | part, read 2026-10-01 [@articles/scanner-github-secret-scanning] | no, read 2026-10-01 [@articles/scanner-github-secret-scanning] |
| **Personal-data detectors and redactors** | | | | |
| Presidio 2.2.364 | rule, 2026-07-22 [@articles/scanner-presidio] | part, 2026-07-22 [@articles/scanner-presidio] | no, 2026-07-22 [@articles/scanner-presidio] | part, 2026-07-22 [@articles/scanner-presidio] |
| scrubadub 2.0.1 | no, 2023-09-01 [@articles/scanner-scrubadub] | no, 2023-09-01 [@articles/scanner-scrubadub] | no, 2023-09-01 [@articles/scanner-scrubadub] | part, 2023-09-01 [@articles/scanner-scrubadub] |
| DataFog 4.9.0, Core 0.4.1 | no, 2026-09-29 [@articles/scanner-datafog] | part, 2026-09-29 [@articles/scanner-datafog] | no, 2026-09-29 [@articles/scanner-datafog] | part, 2026-09-29 [@articles/scanner-datafog] |
| LLM Guard 0.3.16, archived | no, 2025-05-19 [@articles/scanner-llm-guard] | no, 2025-05-19 [@articles/scanner-llm-guard] | no, 2025-05-19 [@articles/scanner-llm-guard] | part, 2025-05-19 [@articles/scanner-llm-guard] |
| Google Sensitive Data Protection | rule, 2026-09-30 [@articles/scanner-google-sdp] | part, 2026-09-30 [@articles/scanner-google-sdp] | no, 2026-09-30 [@articles/scanner-google-sdp] | part, 2026-09-30 [@articles/scanner-google-sdp] |
| OpenRedaction 1.1.5 | no, 2026-07-26 [@articles/scanner-openredaction] | part, 2026-07-26 [@articles/scanner-openredaction] | no, 2026-07-26 [@articles/scanner-openredaction] | part, 2026-07-26 [@articles/scanner-openredaction] |
| OpenAI Privacy Filter | no, 2026-04-22 [@articles/scanner-openai-privacy-filter] | part, 2026-04-22 [@articles/scanner-openai-privacy-filter] | no, 2026-04-22 [@articles/scanner-openai-privacy-filter] | part, 2026-04-22 [@articles/scanner-openai-privacy-filter] |
| **Agent-transcript scrubbers** | | | | |
| Entire CLI 0.11.3 | no, 2026-09-25 [@articles/scanner-entire] | part, 2026-09-25 [@articles/scanner-entire] | part, 2026-09-25 [@articles/scanner-entire] | part, 2026-09-25 [@articles/scanner-entire] |
| ClawJournal at `e6184a1` | no, 2026-09-19 [@articles/scanner-clawjournal] | part, 2026-09-19 [@articles/scanner-clawjournal] | no, 2026-09-19 [@articles/scanner-clawjournal] | yes, 2026-09-19 [@articles/scanner-clawjournal] |
| deja-vu 0.21.4 | no, 2026-09-29 [@articles/scanner-deja-vu] | part, 2026-09-29 [@articles/scanner-deja-vu] | no, 2026-09-29 [@articles/scanner-deja-vu] | part, 2026-09-29 [@articles/scanner-deja-vu] |
| claude-code-sessions-sanitizer 0.3.1 | no, 2026-09-26 [@articles/scanner-ccs-sanitizer] | part, 2026-09-26 [@articles/scanner-ccs-sanitizer] | no, 2026-09-26 [@articles/scanner-ccs-sanitizer] | yes, 2026-09-26 [@articles/scanner-ccs-sanitizer] |
| agent-archive 0.1.1 | no, 2026-09-28 [@articles/scanner-agent-archive] | part, 2026-09-28 [@articles/scanner-agent-archive] | no, 2026-09-28 [@articles/scanner-agent-archive] | unstated, 2026-09-28 [@articles/scanner-agent-archive] |
| scrub-transcripts at `c5e1644` | no, 2026-09-30 [@articles/scanner-scrub-transcripts] | part, 2026-09-30 [@articles/scanner-scrub-transcripts] | no, 2026-09-30 [@articles/scanner-scrub-transcripts] | yes, 2026-09-30 [@articles/scanner-scrub-transcripts] |
| DataClaw 0.5.1 | no, 2026-06-05 [@articles/scanner-dataclaw] | part, 2026-06-05 [@articles/scanner-dataclaw] | no, 2026-06-05 [@articles/scanner-dataclaw] | part, 2026-06-05 [@articles/scanner-dataclaw] |
| agentscrub 1.1.43 | no, 2026-09-29 [@articles/scanner-agentscrub] | part, 2026-09-29 [@articles/scanner-agentscrub] | no, 2026-09-29 [@articles/scanner-agentscrub] | part, 2026-09-29 [@articles/scanner-agentscrub] |
| **Git-history rewriters** | | | | |
| git-filter-repo 2.47.0 | rule, 2024-12-04 [@articles/scanner-git-filter-repo] | no, 2024-12-04 [@articles/scanner-git-filter-repo] | yes, 2024-12-04 [@articles/scanner-git-filter-repo] | part, 2024-12-04 [@articles/scanner-git-filter-repo] |
| BFG Repo-Cleaner 1.15.0 | no, 2025-01-18 [@articles/scanner-bfg] | no, 2025-01-18 [@articles/scanner-bfg] | part, 2025-01-18 [@articles/scanner-bfg] | part, read 2026-10-01 [@articles/scanner-bfg] |
| Leak Lock 0.9.1 | no, 2026-09-04 [@articles/scanner-leak-lock] | no, 2026-09-04 [@articles/scanner-leak-lock] | part, 2026-09-04 [@articles/scanner-leak-lock] | yes, 2026-09-04 [@articles/scanner-leak-lock] |
| pii-check skill at `bd55e7b` | no, 2026-06-09 [@articles/scanner-pii-check] | part, 2026-06-09 [@articles/scanner-pii-check] | yes, 2026-06-09 [@articles/scanner-pii-check] | part, 2026-06-09 [@articles/scanner-pii-check] |

### Notes on the tables

**Secret scanners.** They find provider tokens well and leave personal context to rules the user
writes.

- gitleaks decodes `\u` escapes but not `\n`. It scans the added lines of every commit, but not
  commit messages, which a request open since 2022 asks for, and not merge resolutions. It finds a
  private key only as a whole block. Its default allowlist drops any finding shaped like a home
  path, so a home-path rule has to work around it. It has taken no new features since 2026-05
  [@articles/scanner-gitleaks].
- Betterleaks, by gitleaks's author, scans commit messages on request from 2.0.0-rc.1 of
  2026-09-30. No version scans merge diffs [@articles/scanner-betterleaks].
- TruffleHog has scanned each commit's message, author and committer since 2024, merges
  excepted, and cannot redact a log, an open request [@articles/scanner-trufflehog].
- Kingfisher and Titus scan every blob, merges included, but no messages. Titus dropped its email
  and phone rules as too noisy [@articles/scanner-kingfisher] [@articles/scanner-titus].
- detect-secrets reports public addresses and skips private ranges, the reverse of what #135
  needs [@articles/scanner-detect-secrets].
- secretlint is the one JavaScript library here. Its home-path rule matches only the scanning
  user's own home. It can rewrite a file with each secret masked, and leaves checking it again to
  a second run [@articles/scanner-secretlint].
- ggshield sends content to GitGuardian, which refuses custom detectors for personal data
  [@articles/scanner-ggshield]. git-secrets checks a new commit's message through a hook, with
  patterns the user supplies [@articles/scanner-git-secrets]. GitHub's secret scanning covers the
  whole history and has no alert location for a commit message
  [@articles/scanner-github-secret-scanning].

**Personal-data tools.** They find names, phone numbers and email addresses in text. None reads
git, and none checks its own output again. Their address recognisers are no help with private
hosts: Presidio's only parses the address, and OpenRedaction deliberately leaves two private
ranges alone [@articles/scanner-presidio] [@articles/scanner-openredaction]. DataFog Core walks every string
value of a JSON document [@articles/scanner-datafog].

**Transcript scrubbers.** The tables show eight, each released or changed in 2026. ClawJournal
comes closest for transcripts: it strips terminal escape codes, finds email
addresses, any user's home path and device names, and runs two scanners over the redacted export
before it is shared [@articles/scanner-clawjournal]. The Entire CLI finds secrets, and email
addresses, phone numbers and street addresses on request, but skips path fields and every field
whose name ends in "signature" [@articles/scanner-entire]. deja-vu finds home paths, internal
hosts, private addresses and email addresses in what it shares; its sources do not say that its
rewrite of the transcripts themselves does the same [@articles/scanner-deja-vu]. claude-code-sessions-sanitizer matches the names, email
addresses and hosts the user configures, which #135's ticket rules out, and its 0.3.0 was
withdrawn for reporting clean output that still held a branch name
[@articles/scanner-ccs-sanitizer]. Of the eight, only agent-archive says it decodes JSON held inside strings
[@articles/scanner-agent-archive]. None of them reads git history or looks for attribution lines.

**History rewriters.** They replace what they are told to. git-filter-repo rewrites contents and
messages and can limit itself to some refs, but detects nothing and leaves checking to the user
[@articles/scanner-git-filter-repo]. BFG never filters commit messages [@articles/scanner-bfg].
Leak Lock finds secrets with three scanners, rewrites, and checks every branch again after the
push [@articles/scanner-leak-lock]. The pii-check skill has a model audit the tree and the
history, commit messages included, and guides a rewrite [@articles/scanner-pii-check].

### Does a library covering these kinds exist?

No. No surveyed tool covers home paths, private hosts and attribution lines together, and none
scans both transcripts and git history. A TypeScript project can call secretlint for secrets, and
OpenRedaction or DataFog's Node package for personal data in text, but none of those reads a
transcript's nested JSON or a commit. The transcript scrubbers are written in Python and Go; the
Entire CLI's redaction is a Go package and the rest are commands [@articles/scanner-entire]
[@articles/scanner-clawjournal] [@articles/scanner-deja-vu]. The nearest are
ClawJournal for transcripts, with no history; the pii-check skill, a model following steps rather
than a check; and TruffleHog with rules the user writes, which reads history and messages and
knows nothing of transcripts.

#135's own row has gaps of its own, each found next to a control the scanner does find
[@trials/scanner-rule-format/results/probes.txt]:

- **Attribution.** It finds an assistant co-author trailer, but not Claude Code's documented
  default pull-request line [@articles/claude-code-attribution-setting], and not the "Generated
  with" footer Claude Code has long written, with or without its emoji.
- **Nested JSON.** It finds a home path after an escaped newline in a JSON string, but not the
  same path one level deeper, in a JSON document held inside a string.
- **Encrypted reasoning.** Claude's full reasoning travels encrypted in each thinking block's
  `signature`, and on current models the readable thinking is empty by default
  [@articles/anthropic-thinking-encryption]. Neither that nor a codex reasoning item's
  `encrypted_content` gives a text scan anything to read. Researchers decrypted such blocks from
  published transcripts and found credentials and personal data in them; the providers have
  since mitigated the attack, and the Cloud Security Alliance advises stripping the blocks before
  publishing [@papers/panfilov-2026-reasoning-traces] [@articles/csa-2026-reasoning-trace-theft].
  A copy into `raw/` keeps them.

## The case for and against publishing one

### Who would use it

- **People who publish agent transcripts.** Researchers collected 6,708 agent transcripts that
  people had published on GitHub and Hugging Face with their reasoning blocks still attached
  [@papers/panfilov-2026-reasoning-traces]. Public repositories hold the logs of 549,239 sessions
  of GitHub's own cloud agent [@papers/richards-2026-agentlogs]. The Entire CLI keeps transcripts
  in the repository's own git store [@articles/scanner-entire]. A request that Claude Code scrub
  its own session logs was closed as not planned [@articles/claude-code-issue-50014].
- **People who build transcript tools.** Each of the 2026 scrubbers assembled its own detection,
  some on top of gitleaks, Betterleaks or TruffleHog, and none has a tested rule set for personal
  context (the survey above). They are the users a library could save the most work.
- **Projects whose agents commit and open pull requests.** Claude Code adds attribution to
  commits and pull requests by default [@articles/claude-code-attribution-setting], and GitGuardian
  reports that commits Claude Code co-authored leak secrets at about twice the baseline
  [@articles/gitguardian-secrets-sprawl-2026]. A check over messages and pull-request text serves
  them.
- **Not served better here.** Provider secrets, which gitleaks, Betterleaks, TruffleHog and
  GitHub's push protection cover, and personal data in prose, which Presidio, DataFog and Google's
  service cover.

How many would take up a TypeScript library is not known. Most of the transcript scrubbers are
written in Python or Go, so they would call it as a command, not import it (unverified).

### What it would cost to maintain

- **Formats change under it.** Claude's reasoning moved into an encrypted field, with the
  readable thinking empty by default on current models [@articles/anthropic-thinking-encryption].
  A transcript sanitizer was withdrawn for one missed field [@articles/scanner-ccs-sanitizer].
  The Entire CLI shipped a redaction fix on the day of this survey [@articles/scanner-entire].
- **Rules change too.** Round 5 of #135 changed three of its eight rules in one commit, while this
  research ran [@trials/scanner-rule-format/results/table-later.txt]. Betterleaks adds dozens of
  rules a release [@articles/scanner-betterleaks].
- **A miss is a leak, and a scanner is a target.** In one case Betterleaks prints a secret's raw
  value beside its redacted copy, an open report [@articles/scanner-betterleaks]. Trivy's GitHub
  Action was compromised for twelve hours in 2026 [@articles/scanner-trivy]. A published scanner
  needs signed releases, a security contact, and answers to reports from strangers.
- **Ownership.** gitleaks's author lost control of its repository and name and started again as
  Betterleaks [@articles/scanner-betterleaks].
- **It moves code more than it removes it.** The scanner would live in another repository the
  same user keeps, with a release process added. This project carries less code once it uses the
  published package, but the user still keeps both, and the survey found no one else's library
  that would take the load.

### What it would look like

- **Name.** `unspill`, `scrubline` or `transcript-scrub`, each free on npm on 2026-10-01 (a
  registry lookup; nothing was claimed).
- **Scope.** Personal context in agent transcripts and git changes: the eight rule kinds; transcript
  decoding, with escapes at any depth, terminal escape codes, and encrypted reasoning dropped as
  unreadable; the range scan over added lines, added file names, commit messages and merge
  resolutions; inline markers that name a rule and a reason; and scrub-and-recheck. Provider
  tokens stay at the generic shapes #135 has, and the long tail is left to Betterleaks, gitleaks
  or GitHub.
- **API.** TypeScript, as ES modules. `scanText(text)` and `scanLines(lines)` return findings as
  rule, line and span, never the value. `scanRange({ repo, base, head })` adds the commit and the
  place: a line, a file name, a message or a merge. `scrub(text)` returns the copy and its
  replacements, and throws when the copy still scans dirty. The rules are data, in the format
  checked below. A command line offers `check`, `files` and `scrub`.
- **Packaging.** One npm package with its types and no runtime dependency, needing git on the
  path for history, for Node and for Bun. The trial's format engine found the same spans under
  Node 24.21 and Bun 1.4.2 [@trials/scanner-rule-format/method.md].
- **Licence.** MIT, as gitleaks, Betterleaks, secretlint, Presidio and the Entire CLI use, or
  Apache-2.0, as Kingfisher, Titus and ClawJournal do. This repository has no licence file at the
  time of writing.

### What it would take from #135, and what stays

It would take the rule table, as data; the line pipeline that strips escape codes and decodes JSON
strings; the markers; the range scan; and the span protocol, placeholders and recheck at the heart
of the copy into `raw/`, with the redaction of paths in its own messages.

The detections log stays, with what the status poll and the ship card do with it. So do the
check that nothing under `.postmaster/` is committed, the wiki's own lint, and the rules for where
a copy into `raw/` may go. The rewrite of unpushed commits stays too: it rewrites a user's branch,
and should not leave this project until a second user needs it.

### Extract after #135 settles, or build it first

After. #135 is in its fifth review round, its table changed during this research, and the probes
above found three more gaps. Building first would mean designing an interface around rules that
are still moving, and keeping it in step with #135 by hand. #109 is porting the scripts to
TypeScript, and a library would be TypeScript. Extracting before that port writes the scanner a
third time; extracting during it costs one rewrite, the one #109 makes anyway.

## The rule format, checked against #135

A trial wrote #135's rule table in a proposed format and compared the two on the same lines
[@trials/scanner-rule-format/method.md]. A rule is a TOML table shaped like a gitleaks rule, with
ECMAScript regular expressions, plus two additions: `requires`, regular expressions that must
match for a finding to stand, and `check`, one name from a closed list of checks a regular
expression cannot make. The list holds one, `ip-private`.

All eight rules were expressed. 21 entries agreed with the table on all 50,093 lines compared, the
scanner's own 92 fixture lines and 50,000 generated ones, under Bun and under Node alike
[@trials/scanner-rule-format/results/table.txt]. A rule written to need a check outside the
list, a check digit, was listed, as were one the format cannot compile and one with no entry; the
control the format can express was not [@trials/scanner-rule-format/results/controls.txt].
Dropping a field from four of the real entries made each disagree
[@trials/scanner-rule-format/results/mutations.txt].

What it took: the one named check; `requires`; lists of value groups; lookahead captures for the
path rule; and Python's meaning of `\s`, `\b` and `.` spelled out, since ECMAScript's differ. The
dotenv function, 36 lines of Python, became one regular expression of 1,098 characters that
agrees on every line. Whether anyone would maintain it in that form is a judgement the trial
does not make.

Against round 5's table, the same entries disagree on three rules, which is the table changing,
not the format failing [@trials/scanner-rule-format/results/table-later.txt]. Whether a
gitleaks-compatible format, without lookaround, could express the same rules was not tried.

## Recommendation

Publish it. The survey found the gap, and a gap is the case for publishing: nobody asks an
individual to publish a library that does not exist yet, so waiting for a request would mean never
publishing. This is the user's word of 2026-10-02 on #208.

The order is what keeps it from being written three times:

1. **Close #135's gaps** in its last round or the first change after it lands: Claude Code's
   pull-request attribution, JSON nested more than one level deep, and encrypted reasoning blocks,
   which a copy into `raw/` should drop rather than keep, since no scan can read them.
2. **Port it as a self-contained module** when #109 ports the scripts to TypeScript: its rules as
   data in the format checked above, an engine that imports nothing else from postmaster, and the
   same fixtures and probes passing under Bun and Node.
3. **Publish the module as a package** under the project's account name, with the name, the
   licence and the API set out above, and have postmaster use the published package in place of
   its own copy. Only then does this project carry less code.

## What would change it

- **An existing tool closes the gap first.** If gitleaks, Betterleaks, TruffleHog or one of the
  transcript scrubbers adds the home paths of any user, private hosts, attribution lines and
  commit messages, contributing there and adopting it would serve both aims better than a new
  package.
- **The rules keep changing after #135 lands.** That delays the first release, so that it does not
  carry an interface that breaks at once; it does not cancel it.
- **The maintenance proves heavier than accepted.** A scanner other people rely on has to keep up
  with new transcript formats and answer reports of misses. If that cannot be kept up, the
  package should say so plainly and point to the alternatives, rather than drift.
