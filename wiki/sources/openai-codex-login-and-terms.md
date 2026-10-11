---
title: "OpenAI's documentation and terms on Codex logins in automation (read 2026-10-08)"
type: source
sources: [articles/openai-codex-login-and-terms]
updated: 2026-10-08
---

# What OpenAI says about running Codex headless on a login

OpenAI's Codex documentation (now at learn.chatgpt.com), the Codex source at commit 2c3156a, and OpenAI's terms, read 2026-10-08.

**What it claims.**

- Headless routes are `codex login --device-auth`, an API key, a copied `~/.codex/auth.json`, and on Business and Enterprise
  workspaces access tokens and service accounts. "The right way to authenticate automation is with an API key"
  [@articles/openai-codex-login-and-terms/passages.md] (OAI, entries H1-codex-1 to H1-codex-5, H4-codex-1).
- A ChatGPT-managed login on a CI runner is "an advanced workflow for enterprise and other trusted private automation", one
  `auth.json` per runner, not for public or open-source repositories, and "Do not share the same file across concurrent jobs or
  multiple machines" (H2-codex-3, H4-codex-1).
- The refresh token is used once: the second copy to refresh is told "your refresh token was already used" (H2-codex-2). API keys
  and access tokens do not refresh (H2-codex-7).
- A custom endpoint takes only the Responses API; a ChatGPT login talks to `chatgpt.com/backend-api/codex`, and OpenAI documents a
  gateway for that on its Enterprise pages (H3-codex-1, H3-codex-3).
- The consumer terms bar sharing credentials or making the account available "to anyone else" and list "Automatically or
  programmatically extract data or Output" among prohibited acts. The Services Agreement for Business and Enterprise bars sharing
  login credentials between users and gives each account one end user. App-server sign-in "has never been permitted for
  commercial or hosted services" (H4-codex-2b, H4-codex-2c, H4-codex-9).
- Prices per million tokens: `gpt-6-luna` $0.10 input, $0.01 cached, $0.50 output; `gpt-6-sol` $2, $0.20, $10; `gpt-6-astra`
  $10, $1, $50 (H5-codex-2).

**On what evidence.** The vendor's pages and open-source code, two reads for each sentence quoted as verbatim. OpenAI's policy
pages answered 403 to the fetch tool, so its consumer terms are a third party's capture (Open Terms Archive), and the
rest-of-world Terms of Use was read through a public text converter that fetches the vendor's page, twice with two
wordings; both are marked in the entries (H4-codex-2b, H4-codex-2e). The archive's EU copy says "extracting" where the
rest-of-world page says "extract". The code was read, not run.

**What it would mean here if true.** Parallel codex lanes need either an API key or one login each, and the documents allow
a login on a trusted private runner without saying whether a Plus or Pro login may sit in a vendor-neutral cloud container.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
