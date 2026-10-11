# The model bill at pay-per-token prices

18 audited real runs, 358 launches (the coachman as one row per run, from its
session exports). Tokens by kind are read from each launch's own stream (tokens-by-kind.json); the
rates are in prices.json with where each was read. "As measured" prices each kind at its own rate;
"if no cache hit" prices every input token at the plain input rate, which brackets what the vendor's
cache does. "Reported" is the dollars the harness itself wrote, at list price where it says so.
Input in total: 2972.1 M tokens.

| Role | Lane | Model | Launches | Uncached in, M | Cache reads, M | Cache writes, M | Out, M | $ as measured | $ if no cache hit | Reported $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coachman | coachman | muse-spark-1.3-contributor | 14 | 79.0 | 1399.1 | 0.0 | 5.3 | 11.75 | 149 | – |
| reviewer | astra | gpt-6-astra | 4 | 0.1 | 1.0 | 0.0 | 0.0 | 2.67 | 12.06 | – |
| reviewer | luna | gpt-6-luna | 107 | 11.1 | 225.6 | 0.0 | 2.9 | 4.81 | 25.12 | – |
| reviewer | mimo | xiaomi-token-plan-sgp/mimo-v2.6-pro | 118 | 17.1 | 269.0 | 0.0 | 4.5 | 12.31 | 128 | 0.00 |
| reviewer | opus | claude-opus-5-5 | 71 | 0.0 | 82.8 | 8.2 | 3.1 | 644 | 2909 | 644 |
| reviewer | sol | gpt-6-sol | 8 | 0.2 | 2.2 | 0.0 | 0.0 | 1.18 | 5.09 | – |
| workhorse | astra | gpt-6-astra | 1 | 0.1 | 3.4 | 0.0 | 0.0 | 5.44 | 36.37 | – |
| workhorse | luna | gpt-6-luna | 15 | 9.0 | 393.0 | 0.0 | 2.5 | 6.07 | 41.43 | – |
| workhorse | mimo | xiaomi-token-plan-sgp/mimo-v2.6-pro | 18 | 7.8 | 430.8 | 0.0 | 2.7 | 7.27 | 193 | 0.00 |
| workhorse | sol | gpt-6-sol | 2 | 0.4 | 32.2 | 0.0 | 0.1 | 8.17 | 66.13 | – |
| **all priced** | | | | | | | | **704** | **3566** | |
| **per run** (18) | | | | | | | | **39.10** | **198** | |

Per run (18 runs with priced launches), dollars as measured:

| | Opus security review | Everything else | Total |
| --- | --- | --- | --- |
| mean | 35.79 | 3.31 | 39.10 |
| median | 14.56 | 2.12 | 16.13 |
| most | 294 | 9.24 | 301 |
| share of all dollars | 92% | 8% | |

## If the coachman ran on Meta's standard tier

The coachman ran on `muse-spark-1.3-contributor` ($0.1 / $0.002 / $0.2 per million tokens: input, cached input, output),
the tier that lets Meta train on what is sent. The standard tier, `muse-spark-1.3`, is $1.25 / $0.15 / $4.25.
The coachman's tokens come to $11.75 at the contributor tier and
$331 at the standard tier. Everything else as above.

Per run (18 runs with priced launches), coachman at the standard tier, dollars as measured:

| | Opus security review | Everything else | Total |
| --- | --- | --- | --- |
| mean | 35.79 | 21.04 | 56.83 |
| median | 14.56 | 19.05 | 34.63 |
| most | 294 | 81.35 | 301 |
| share of all dollars | 63% | 37% | |
