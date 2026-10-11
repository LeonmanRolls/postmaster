---
title: "Login and terms pages for pi, Grok Build and the Antigravity CLI (read 2026-10-08)"
type: source
sources: [articles/other-harnesses-login-and-terms]
updated: 2026-10-08
---

# What the other three supported harnesses document for headless logins

pi (repository at commit 6fb2e78), xAI's Grok Build CLI and Google's Antigravity CLI, read 2026-10-08.

**What it claims.**

- pi takes a provider's key from the environment, a stored `auth.json` or a `!command`, and has a built-in AI Gateway provider. It
  offers subscription logins for several vendors, so the terms that apply are those of the provider; on a headless machine an OAuth
  login needs the redirect pasted back [@articles/other-harnesses-login-and-terms/passages.md] (OTH, entries H1, H3).
- Grok Build runs headless with `grok -p`, with `XAI_API_KEY` or `grok login --device-auth`, and takes a custom `base_url` with an
  `env_key`. xAI's legal pages answered 403.
- The Antigravity CLI's headless runs use cached credentials from an interactive sign-in, or `GEMINI_API_KEY` with
  `GOOGLE_GEMINI_BASE_URL`. Its Additional Terms call using third-party software with Antigravity OAuth "a breach of this
  Agreement" and say nothing found about CI or cloud machines.

**On what evidence.** Repository text and documentation pages, one fetch-tool read for most of the xAI and Google sentences.

**What it would mean here if true.** All three can sit behind a placeholder key and a Worker; none of them settles a
subscription login in a cloud container.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
