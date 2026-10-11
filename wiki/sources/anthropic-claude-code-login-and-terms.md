---
title: "Anthropic's documentation and terms on Claude Code logins in automation (read 2026-10-08)"
type: source
sources: [articles/anthropic-claude-code-login-and-terms]
updated: 2026-10-08
---

# What Anthropic says about running Claude Code headless on a login

Anthropic's Claude Code and API documentation, support articles and legal pages, read 2026-10-08.

**What it claims.**

- Headless routes are `ANTHROPIC_API_KEY`, and `CLAUDE_CODE_OAUTH_TOKEN`, a one-year token from `claude setup-token` that
  "authenticates with your Claude subscription", documented "for CI pipelines and scripts" and as a GitHub Actions secret on Pro,
  Max, Team and Enterprise [@articles/anthropic-claude-code-login-and-terms/passages.md] (ANT, entries H1-claude-1,
  H1-claude-3, H4-claude-9). `--bare` mode never reads OAuth credentials (H1-claude-6).
- A gateway can carry a subscription login if it forwards the `anthropic-beta` header; setting a gateway credential replaces
  the subscription (H3-claude-3).
- "Anthropic does not permit third-party developers to ... route requests through Free, Pro, or Max plan credentials on
  behalf of their users", and developers "may not collect, store, or intermediate Claude.ai credentials or session tokens". An
  end user signing in to the unmodified binary with their own subscription "including where a platform hosts Claude Code" is
  not prevented (H4-claude-1). The same page says that running Claude Code "in hosted sandboxes or other agent
  infrastructure" requires agreeing to the Commercial Terms, with the binary unmodified and each end user authenticating with
  their own credentials, and that customers may not pay for, resell or intermediate usage on end users' behalf
  (H4-claude-2). Whether one person's own sandbox counts as offering Claude Code is not defined.
- The consumer terms bar "automated or non-human means" except with an API key or "where we otherwise explicitly permit
  it" (H4-claude-3). A usage policy page showing "Effective November 12, 2026" adds a bar on reselling, proxying or otherwise
  providing access "through unauthorized means, including services that route requests through consumer subscriptions"; the
  page does not define "unauthorized", and no announcement was found (H4-claude-7, H4-claude-14).
- Plan limits are shared across Claude and Claude Code; no cap on concurrent sessions or devices is stated (H6-claude-1,
  H6-claude-2). Cloud sessions (Pro, Max, Team, and Enterprise with premium seats) and self-hosted environments (public beta,
  Team and Enterprise) are Anthropic's own cloud routes on a subscription (H6-claude-3, H1-claude-8).
- `claude-opus-5-5` costs $4 per million input tokens, $0.20 for a cache read, $5 or $8 for a cache write (five minutes or an
  hour) and $20 for output (H5-claude-2).

**On what evidence.** The vendor's pages, two reads for each sentence quoted as verbatim, and the Consumer and Commercial
Terms also as Open Terms Archive copies, which agreed. Claude Code is closed source, so refresh behaviour is known from the
documents and the public changelog only.

**What it would mean here if true.** An API key is the safe route in a cloud container. A subscription token is documented
for CI, and whether a Worker may hold and inject one for its owner's own containers is not answered by the page, which bars
third parties from doing it for others.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
