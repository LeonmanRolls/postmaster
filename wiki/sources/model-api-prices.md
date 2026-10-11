---
title: "The vendors' price pages for the models the flow's lanes run on (read 2026-10-08)"
type: source
sources: [articles/model-api-prices]
updated: 2026-10-08
---

# What a million tokens cost on each lane's model

OpenAI, Anthropic, Meta and Xiaomi, from their own price pages, read 2026-10-08.

**What it claims.** Dollars per million tokens, as input, cached input, output:

| Model | Input | Cached input | Output |
| --- | --- | --- | --- |
| `gpt-6-luna` | 0.10 | 0.01 | 0.50 |
| `gpt-6-sol` | 2.00 | 0.20 | 10.00 |
| `gpt-6-astra` | 10.00 | 1.00 | 50.00 |
| `claude-opus-5-5` | 4 | 0.20 | 20 |
| `muse-spark-1.3-contributor` | 0.10 | 0.002 | 0.20 |
| `mimo-v2.6-pro` | 0.435 | 0.0036 | 0.87 |
| `muse-spark-1.3` (standard tier, used only to ask what the coachman would cost off the contributor tier) | 1.25 | 0.15 | 4.25 |
| `mimo-v2.6-flash` | 0.14 | 0.0028 | 0.28 |

OpenAI and Anthropic also price cache writes (OpenAI $0.125 to $12.50; Anthropic $5 for five minutes, $8 for an hour for Opus 5.5)
[@articles/model-api-prices/passages.md].

**On what evidence.** Each page was read at least twice: OpenAI's by two fetches, Anthropic's by two reads, Meta's by a download
of the page text and a fetch, Xiaomi's by three reads. The Opus rates are also reproduced by the fleet's data: Claude Code's
reported dollars for 61 of 61 single-model Opus launches fall between the five-minute and the one-hour cache-write price
[@trials/2026-10-08-cloudflare-run-cost/results/controls.md]. The pages carry no date.

**What it would mean here if true.** At API prices a cache read costs 1% to 10% of a plain input token, which is why the lanes,
whose input is about 95% cache reads, cost little and the Opus security review does not.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
