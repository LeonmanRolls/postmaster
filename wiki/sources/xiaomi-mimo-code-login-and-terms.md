---
title: "Xiaomi's documentation on MiMo Code keys and the Token Plan (read 2026-10-08)"
type: source
sources: [articles/xiaomi-mimo-code-login-and-terms]
updated: 2026-10-08
---

# What Xiaomi says about running MiMo Code headless on a plan

Xiaomi's Token Plan and pay-as-you-go documentation, the MiMo Code repository at commit 6babeb0 and the MiMo privacy policy, read
2026-10-08.

**What it claims.**

- MiMo Code reads the variable its provider catalog names, `XIAOMI_API_KEY` (the name comes from the models.dev provider
  file, not from a Xiaomi page), from the environment at each process start, or a whole `auth.json` from
  `MIMOCODE_AUTH_CONTENT`; `mimo run` is the headless form. A provider block takes `baseURL` and an `apiKey` that may be
  `{env:NAME}` [@articles/xiaomi-mimo-code-login-and-terms/passages.md] (XMI, entries H1, H3).
- A Token Plan is a prepaid package of credits with its own key (`tp-`), separate from a pay-as-you-go key (`sk-`). The suffix
  `sgp` names the Singapore cluster (H2).
- "The quota of the Token Plan package is only available for use in programming tools ... and it is prohibited to use it in the
  form of API calls for request behaviors in obvious non-coding scenarios such as automated scripts and custom application
  backends." MiMo Code is a listed tool (H4 a, H4 d).
- Pay-as-you-go list prices per million tokens: `mimo-v2.6-pro` $0.435 input, $0.0036 cached, $0.87 output; `mimo-v2.6-flash`
  $0.14, $0.0028, $0.28 (H5).

**On what evidence.** Xiaomi's pages, some as raw markdown, and the repository read as text. The user agreement renders by script
and was not read. Nothing was run.

**What it would mean here if true.** A Token Plan key may not be usable for an unattended agent in a container, and the documents do
not say; a pay-as-you-go key has no such sentence in the pages that could be read. The page gives "automated scripts" as an
example of an obvious non-coding scenario, not as a use named apart.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
