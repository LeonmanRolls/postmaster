# Passages relied on: the vendors' price pages

Read on 2026-10-08. Each entry is the reader's note, the quotations with the mark the reader gave them, where each was read, and how sure the note is. Prices are US dollars per million tokens for the models the flow's lanes ran on. The pages carry no date of their own, and prices change. The entries are the price entries of the four vendor captures, brought together; the same entries stand in each vendor's capture. Second reads of the OpenAI, Anthropic and Meta pages on the same day, which agree with them, are at the end.

### H5-claude-2 Price of claude-opus-5-5 per million tokens (page: platform.claude.com/docs/en/about-claude/pricing)
- finding: The pricing page lists "Claude Opus 5.5" (the public API id in the study is `claude-opus-5-5`; the page names the model, not the id): base input $4 / MTok; 5-minute cache write $5 / MTok; 1-hour cache write $8 / MTok; cache hits and refreshes $0.20 / MTok (0.05x base input, a footnote exception to the usual 0.1x); output $20 / MTok. Batch API: input $2 / MTok, output $10 / MTok (50% off). Fast mode (research preview, Claude API only): input $8 / MTok, output $40 / MTok. Full 1M-token context at standard price. `inference_geo: "us"` adds a 1.1x multiplier on all categories. Page shows no date; it says "For the most current pricing information, visit claude.com/pricing". Claude Opus 5 (not 5.5) is $5 / $6.25 / $10 / $0.50 / $25.
- quote: "| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |"   (verbatim row of the table, one fetch; columns: base input, 5m cache writes, 1h cache writes, cache hits and refreshes, output)
- source: https://platform.claude.com/docs/en/about-claude/pricing ; no date ; read 2026-10-08 (one fetch; second read due)
- strength: stated (single read so far)

### H5-codex-2 API prices per 1M tokens for gpt-6-luna, gpt-6-sol, gpt-6-astra (USD; page https://developers.openai.com/api/docs/pricing; two reads agree on the shared columns; page shows no date except a note that "Priority processing was renamed Fast mode on July 30, 2026")
- finding: Text-token rates, short context (input up to 272K tokens; "Long context" is above 272K and has its own columns):
  | model | tier | input | cached input | cache writes | output |
  | gpt-6-luna | Standard | $0.10 | $0.01 | $0.125 | $0.50 |
  | gpt-6-sol | Standard | $2.00 | $0.20 | $2.50 | $10.00 |
  | gpt-6-astra | Standard | $10.00 | $1.00 | $12.50 | $50.00 |
  | gpt-6-luna | Batch / Flex (same) | $0.05 | $0.005 | $0.0625 | $0.25 |
  | gpt-6-sol | Batch / Flex | $1.00 | $0.10 | $1.25 | $5.00 |
  | gpt-6-astra | Batch / Flex | $5.00 | $0.50 | $6.25 | $25.00 |
  | gpt-6-luna | Fast (formerly Priority) | $0.20 | $0.02 | $0.25 | $1.00 |
  | gpt-6-sol | Fast | $4.00 | $0.40 | $5.00 | $20.00 |
  | gpt-6-astra | Fast | $20.00 | $2.00 | $25.00 | $100.00 |
  Long context (> 272K input tokens), Standard: luna $0.20 / $0.02 / $0.25 / $0.75; sol $4.00 / $0.40 / $5.00 / $15.00; astra $20.00 / $2.00 / $25.00 / $75.00 (input / cached / cache write / output). gpt-6.1-sol is also listed ($2.00 / $0.10 / $2.50 / $10.00 standard short context) and has an extra Ultrafast tier; the study's three models have no Ultrafast row except astra ($60 / $6 / $75 / $300 short context).
  Notes: "Regional processing (data residency) endpoints are charged a 10% uplift for models released on or after March 5, 2026." FedRAMP endpoints also 10% uplift.
- quote: "| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.20 | $0.02 | $0.25 | $0.75 |"   (verbatim row, second fetch, Standard tab: short input, short cached, short cache write, short output, long input, long cached, long cache write, long output)
- source: https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing answers 301 to it) ; read 2026-10-08 (two fetches)
- strength: stated. Caveat, RESOLVED later in this file (H5-codex-4): the API Models overview page (https://developers.openai.com/api/docs/models, one fetch) did not list gpt-6-sol, but each of the three models has its own page (.../api/docs/models/gpt-6-sol, -luna, -astra, one fetch each) and those pages give the same three prices as the pricing page.

### H5-codex-3 Codex's own credit table (plan credits, not dollars) for the three models, per 1M tokens
- finding: Credits per 1M tokens (input | cached input | output): GPT-6 Luna 2.5 | 0.25 | 12.5; GPT-6 Sol 50 | 5 | 250; GPT-6 Astra 250 | 25 | 1,250. Price per credit is not on the page.
- quote: "GPT-6 Luna | 2.5 credits | 0.25 credits | 12.5 credits"   (verbatim: two fetches of https://learn.chatgpt.com/docs/pricing)
- source: https://learn.chatgpt.com/docs/pricing ; no date ; read 2026-10-08
- strength: stated

### H5-claude-3 The study's model id is on the pricing and models pages
- finding: The models overview lists "Claude Opus 5.5" with Claude API ID `claude-opus-5-5`, base price "$4 / input MTok, $20 / output MTok", context window 1M tokens, max output 128K tokens, default effort `medium`, reliable knowledge cutoff Jun 2026, retirement "Not sooner than September 22, 2027". So `claude-opus-5-5` is on the pricing page under the name Claude Opus 5.5 (H5-claude-2 / 2b); no substitute model is needed.
- quote: "Claude API ID | `claude-fable-5-1` | `claude-opus-5-5` | `claude-sonnet-5-5` | `claude-haiku-5-5`"   (verbatim row, one fetch of https://platform.claude.com/docs/en/about-claude/models/overview, which redirects to /docs/en/models/overview)
- source: https://platform.claude.com/docs/en/about-claude/models/overview ; no date ; read 2026-10-08
- strength: stated
### H5 Muse: API price per million tokens (Meta Model API)
- finding: muse-spark-1.3-contributor is listed. Per 1M tokens: input $0.10, cached input $0.002, output $0.20 (Contributor tier, context window 1,048,576 tokens, rate limit 100 RPM and 3,000,000 TPM per team). For contrast, muse-spark-1.3 (Standard): input $1.25, cached input $0.15, output $4.25. Web search grounding costs $2.50 per 1,000 queries on top. "There is no long-context premium." The product page repeats the same numbers. A Muse Code subscription replaces per-token charges with a flat monthly fee ($5, $15, $50) and a per-period allowance; the contributor model gives no discount under a subscription (Terms 13.4).
- quote: "Heavily discounted token pricing in exchange for permission to use your prompts and completions to train future Meta models." / table rows Contributor: Cached input $0.002, Input $0.10, Output $0.20 (verbatim, curl and the fetch tool; the product page table agrees)
- source: https://dev.meta.ai/docs/pricing-rate-limits ; https://dev.meta.ai/products/muse-code (Models and pricing table) ; read 2026-10-08 (neither page shows a date)
- strength: stated
### H5 MiMo: API price per million tokens (pay-as-you-go, overseas USD)
- finding: Both named models are listed. mimo-v2.6-pro: cache-hit input $0.0036, cache-miss input $0.435, output $0.87. mimo-v2.6-flash: cache-hit input $0.0028, cache-miss input $0.14, output $0.28. Batch API is half: pro $0.0018 / $0.2175 / $0.435; flash $0.0014 / $0.07 / $0.14. China list prices (CNY per M tokens): pro 0.025 / 3 / 6; flash 0.02 / 1 / 2. Context 1M tokens, maximum output 128K tokens, listed rate limit 100 RPM and 10M TPM. The pay-as-you-go prices are the same numbers models.dev stores for the `xiaomi` provider; the token-plan providers carry cost 0 because quota is in Credits (see H2).
- quote: "Billing Unit: China：RMB / M tokens;  Overseas: dollar / M tokens" (a fetch-tool read of static pay-as-you-go.md, "API Pricing", no date shown) ; table row "Real-time API | mimo-v2.6-pro | $0.0036 | $0.435 | $0.87" (as returned; agrees with the model page https://mimo.mi.com/models/en-US/mimo-v2.6-pro read separately and with models.dev xiaomi/mimo-v2.6-pro.toml cost input = 0.435, output = 0.87, cache_read = 0.0036) -> numbers verbatim, three reads
- source: https://mimo.mi.com/static/docs/price/pay-as-you-go.md ; https://mimo.mi.com/models/en-US/mimo-v2.6-pro ; https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash ; https://github.com/anomalyco/models.dev @9dd85fa149e284d3dba7d0ff8b4a9924efff6e4d providers/xiaomi/models/mimo-v2.6-{pro,flash}.toml ; read 2026-10-08 (the vendor pages show no date; models.dev lists release_date 2026-09-22)
- strength: stated

### Second reads of three price pages, 2026-10-08

- OpenAI, https://developers.openai.com/api/docs/pricing, fetch tool: gpt-6-luna input $0.10, cached input $0.01, output $0.50; gpt-6-sol $2.00, $0.20, $10.00; gpt-6-astra $10.00, $1.00, $50.00, "Standard, short context, per 1M tokens". The page shows no date except a note that "Priority processing was renamed Fast mode on July 30, 2026". Agrees with the entry above, which also lists cache-write prices.
- Anthropic, https://platform.claude.com/docs/en/about-claude/pricing, fetch tool, whole page returned: "Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok" (base input, 5-minute cache writes, 1-hour cache writes, cache hits, output), with the note that cache hits on Opus 5.5 are priced at 0.05x the base input price. Agrees with the entry above.
- Meta, https://dev.meta.ai/docs/pricing-rate-limits, the page's HTML text downloaded and read: Contributor tier (muse-spark-1.3-contributor, muse-spark-1.2-contributor) cached input $0.002, input $0.10, output $0.20; Standard tier (muse-spark-1.3, -1.2, -1.1) cached input $0.15, input $1.25, output $4.25. Agrees with the entry above.
