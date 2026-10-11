# Passages relied on: Cloudflare AI Gateway

Read on 2026-10-08. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the words were seen in the repository text of the documentation and checked against it by script, and on the published page where the entry says so), where each was read, and how sure the note is. The documentation text is the cloudflare-docs repository at commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f, committed 2026-10-08T21:06:58Z; a path such as docs/workers/platform/limits.mdx is a file in it, and the published page is the same path under https://developers.cloudflare.com/.

### B12 AI Gateway: documented routes for three of the flow's harnesses
- finding: AI Gateway has a setup page each for OpenAI Codex (custom provider in `config.toml`, `wire_api = "responses"`, credential from an environment variable `CLOUDFLARE_API_KEY`), Claude Code (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` set to any value when the gateway holds the credential, custom header `cf-aig-authorization`) and Pi (built-in `cloudflare-ai-gateway` provider). No page for Muse Code or MiMo Code. All three pages use an API key or Cloudflare credits; none shows a subscription login.
- quote: "Codex custom providers only support the OpenAI Responses API (`wire_api = \"responses\"`)." (verbatim)
- quote: "When AI Gateway already holds the Anthropic credentials ... the `ANTHROPIC_API_KEY` value is ignored. Claude Code still requires the variable to be set" (verbatim, ellipsis mine)
- source: ai-gateway/integrations/coding-agents/{openai-codex,claude-code,pi}/ ; docs/ai-gateway/integrations/coding-agents/openai-codex.mdx:13-16, 31-47 ; docs/ai-gateway/integrations/coding-agents/claude-code.mdx:19-27, 40-42 ; docs/ai-gateway/integrations/coding-agents/pi.mdx:13, 23-25 ; docs/ai-gateway/integrations/coding-agents/index.mdx:29-37 (list of supported agents)
- strength: stated / shown (setup pages)

### B13 AI Gateway: where the provider credential lives
- finding: credential precedence is: a provider key on the request is forwarded unchanged; else a stored key (BYOK, Beta, kept in Secrets Store); else Cloudflare-managed credentials billed to credits (Unified Billing; the rendered page does not mark it Beta, while the source's sidebar group carries a Beta badge, so its status is not stated on the page). A switch "Require provider credentials" stops the fall-through to Cloudflare credits.
- quote: "if the request carries provider authentication (for example, an `Authorization` header), AI Gateway forwards it to the provider unchanged." (verbatim)
- source: ai-gateway/features/unified-billing/ ; docs/ai-gateway/features/unified-billing.mdx:7 (sidebar group badge: Beta), 59-65, 73-75 ; configuration/bring-your-own-keys.mdx:7 (page badge: Beta), 16-18
- strength: stated

### B14 AI Gateway: Unified Billing fee and rate limit
- finding: 5% fee on credits bought, provider rates passed through "with no markup"; 200 requests per 60 seconds per gateway on Cloudflare-managed credentials (not on BYOK); gateways per account: 10 free, 20 paid
- quote: "A 5% fee is applied to all credits purchased through Unified Billing." (verbatim)
- source: docs/ai-gateway/features/unified-billing.mdx:18 ; docs/ai-gateway/reference/limits.mdx:22-31 ; reference/pricing.mdx:50
- strength: stated

### B15 AI Gateway: providers, custom providers
- finding: the native provider list has no Xiaomi or Meta entry (anthropic, azureopenai, baseten, bedrock, cartesia, cerebras, cohere, deepgram, deepseek, elevenlabs, fal, google-ai-studio, grok, groq, huggingface, ideogram, mistral, openai, openrouter, parallel, perplexity, replicate, vertex, workersai); a Beta feature, Custom Providers, takes "any AI provider that has an HTTPS API endpoint"
- quote: "enables you to use AI Gateway's observability, caching, rate limiting, and other features with any AI provider that has an HTTPS API endpoint" (verbatim)
- source: docs/ai-gateway/usage/providers/ (file list) ; docs/ai-gateway/configuration/custom-providers.mdx:6 (Beta), 16
- strength: stated for the list; "not found" for Xiaomi and Meta (file list of usage/providers/, 0 hits by name)

### B16 AI Gateway: logs hold prompts and responses by default
- finding: each log "can include the prompt, response, provider, timestamp, status, token usage, cost, duration, and user agent"; logging is on by default and can be turned off per gateway or per request (`cf-aig-collect-log`, `cf-aig-collect-log-payload`); gateways created from 2026-09-24 follow Workers Logs pricing and retention
- quote: "Each log can include the prompt, response, provider, timestamp, status, token usage, cost, duration, and user agent." (verbatim)
- source: docs/ai-gateway/observability/logging/index.mdx:13, 29-31, 41, 65 ; reference/pricing.mdx:23-36
- strength: stated

### B17 AI Gateway: free core features
- finding: dashboard analytics, caching and rate limiting are free; a DLP scan of prompts and responses for secrets is offered
- quote: "AI Gateway's core features available today are offered for free" (verbatim, partial)
- source: docs/ai-gateway/reference/pricing.mdx:13 ; integrations/coding-agents/index.mdx:23, 41-47
- strength: stated

### B21 AI Gateway, Agents, Sandbox and Containers documentation: no subscription login shown
- finding: a search of the documentation source for a Claude or ChatGPT subscription login, an OAuth sign-in of a coding agent, or a plan name found nothing that shows one; the two files that matched are incidental (a download link in the Claude Desktop setup page, and a description of MCP hosts)
- quote: n/a
- source: grep -r -i -E "claude (pro|max)|max plan|pro plan|chatgpt (plus|pro)|subscription login|sign in with chatgpt|claude\.ai|chatgpt\.com|codex login|claude login" over docs/ai-gateway (1 file), docs/agents (1 file), docs/sandbox (0), docs/containers (0), docs/workers/platform (0) and partials (0) @6e1b964 ; docs/ai-gateway/integrations/coding-agents/claude-desktop.mdx:13 and docs/agents/model-context-protocol/index.mdx:21 are the two hits ; run 2026-10-08
- strength: not found

### B22 AI Gateway: spend limits (Beta)
- finding: Spend limits set cost-based budgets, scoped by provider, model or a custom metadata key, and block further requests with a `429` when the budget for the window is reached. They apply to Unified Billing requests and to stored-key (BYOK) requests for models with known pricing. They are eventually consistent: a burst of concurrent requests can briefly exceed the limit. The page's sidebar entry carries a Beta badge.
- quote: "When cumulative spend reaches the limit within a time window, AI Gateway blocks further requests with a `429` response until the window resets." (verbatim, repository text, line 14) ; "Spend limits are eventually consistent." (verbatim, repository text, line 28)
- source: docs/ai-gateway/features/spend-limits.mdx@6e1b964 lines 7, 14, 18, 28 ; the same page on the published documentation site ; read 2026-10-08 (repository text only)
- strength: stated
