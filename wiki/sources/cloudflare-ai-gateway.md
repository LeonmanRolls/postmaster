---
title: "Cloudflare's AI Gateway documentation (read 2026-10-08)"
type: source
sources: [articles/cloudflare-ai-gateway]
updated: 2026-10-08
---

# How Cloudflare says a model key stays out of a coding agent's sandbox

Cloudflare, documentation at commit 6e1b964, read 2026-10-08.

**What it claims.**

- AI Gateway has a setup page each for OpenAI Codex, Claude Code and Pi, among others. Codex is given a custom provider on
  the Responses API only; Claude Code a base URL and a header; Pi has a built-in gateway provider
  [@articles/cloudflare-ai-gateway/passages.md] (B12).
- Credentials resolve in order: a provider key on the request, a stored key (Beta, kept in Secrets Store), then Cloudflare
  credits; the sidebar group of the credits page, Unified Billing, is badged Beta. Credits carry a 5% fee and a limit of
  200 requests per 60 seconds a gateway (B13, B14). Spend limits (Beta) block requests with a 429 when a budget is
  reached, and are eventually consistent (B22).
- No page lists Xiaomi or Meta as a provider; a Beta feature takes any provider with an HTTPS endpoint (B15).
- Logs hold the prompt and the response by default and can be switched off per gateway or per request (B16).

**On what evidence.** The vendor's documentation as repository text; the Unified Billing and Codex pages were also read on the
published pages (B-SECOND in the control-plane capture). Every quotation was found in its cited file. A search of the AI
Gateway, Agents, Sandbox and Containers documentation for a subscription login found none (B21).

**What it would mean here if true.** Model access for Codex, Claude Code and Pi can go through one gateway that holds the
key, with spend limits and logs, at the cost of a vendor reading the prompts and code unless logging is off. These pages cover
API credentials; none shows a subscription login, though an earlier example in Cloudflare's sandbox repository did
([the sandboxes source](cloudflare-containers-sandboxes.md), A7.7).

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
