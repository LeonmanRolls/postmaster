---
title: "Meta's documentation and terms on Muse Code logins in automation (read 2026-10-08)"
type: source
sources: [articles/meta-muse-code-login-and-terms]
updated: 2026-10-08
---

# What Meta says about running Muse Code headless

Meta's Muse Code documentation, launcher script, SDK repository, Terms of Service (last updated 2026-10-02), Acceptable Use Policy
and price page, read 2026-10-08.

**What it claims.**

- `muse exec` is the headless mode of the same binary. "For scripts and CI, use an API key": `META_API_KEY` beats a stored key
  and a stored browser session, and the docs show CI and `--yolo` "in a disposable, isolated container"
  [@articles/meta-muse-code-login-and-terms/passages.md] (MET, entries H1 and H4 a).
- A Muse Code subscription ($5, $15 or $50 a month) applies to the key the CLI onboarding connects. The credential "is for use
  only with the coding harness under your Coding Harness Subscription". Keys made in the dashboard are pay-as-you-go, may be used in
  other tools, and may not be shared with a third party, including through "any model aggregator, API gateway, proxy, or similar
  offering" (H2, H4 b, H4 d).
- The public docs give no setting for another base URL ("It needs no provider config"). Meta's own SDK quickstart, a sample
  program, writes `endpoint_transport.base_url` into `settings.json` (H3, entry "Muse (source)"). Access is limited to
  the jurisdictions Meta has enabled, and no binding of a key to a machine or address is stated (H2).
- `muse-spark-1.3-contributor` is the discounted tier "in exchange for permission to use your prompts and completions to train future
  Meta models"; Terms 6.2 bar sending it code or other information that must stay confidential, and "sensitive, confidential, or
  personal information". Its limits are 100 requests and 3,000,000 tokens a minute for a team (H2, H4 e).
- The contributor tier costs $0.10 per million input tokens, $0.002 cached and $0.20 output; the standard tier $1.25, $0.15 and
  $4.25 (H5).
- By the code of a third-party harness, a subscription login gives an identity token that cannot be renewed, exchanged for a
  key that lives about a day and is minted again from the token; the token's own lifetime is not stated
  [@articles/other-harnesses-login-and-terms/passages.md].

**On what evidence.** The vendor's pages downloaded as text and read again through the fetch tool, the vendor's launcher script and
SDK quickstart, at commit 537cc8d. Nothing was run, and the binary was not downloaded.

**What it would mean here if true.** The coachman's route in a cloud container is a pay-as-you-go key, not a subscription, and the
contributor tier is a choice about who may train on the code it is sent.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
