---
title: "Hosted CI machines, free tiers, Tailscale, phones and owned hardware as places to run the flow (read 2026-10-09)"
type: source
sources: [articles/ci-runners-free-tiers-and-phones]
updated: 2026-10-09
---

# What else could run a ticket's work, and what stops it

GitHub, Oracle, Tailscale, Anthropic, OpenAI, Bun, the Termux project, Android, Apple and Raspberry Pi: price, limit and platform
pages, and public issues on the vendors' trackers, read 2026-10-09.

**What it claims.**

- A GitHub-hosted runner for a private repository costs $0.36 an hour (2 vCPU, 8 GB, 14 GB of disk) or $0.72 (4 vCPU, 16 GB), and
  a job on it stops after 6 hours; the 4 vCPU runner is a larger runner, open only to organisations on the Team or Enterprise
  Cloud plan, and included minutes do not cover it [@articles/ci-runners-free-tiers-and-phones/passages.md] (CIP1, CIP2, CIP3,
  CIP5, CIP48). A self-hosted runner is free from GitHub, a job may run 5 days, the docs list only outbound HTTPS as a
  requirement (so no inbound port is needed, argued), and a `workflow_dispatch` call can start one; a charge for self-hosted
  runners announced for 2026-03-01 was postponed with no new date (CIP5, CIP7, CIP8). GitHub's terms for Actions and Codespaces
  bear on running coding agents and were not put to GitHub (CIP10, CIP14).
- Codespaces cost $0.09 a core-hour and stop after 12 hours of a session (CIP11, CIP13).
- Oracle's pay-as-you-go Arm machine costs $0.01 per OCPU-hour and $0.0015 per GB-hour, $0.052 an hour for 4 vCPU and 8 GB; its
  Always Free Arm allowance is now 2 OCPUs and 12 GB by its documentation, while its price data still shows the old 4 OCPUs and
  24 GB; idle Always Free instances may be reclaimed, and an account idle for 30 days or more may be treated as abandoned, by two
  search summaries of its FAQ (CIP21, CIP23, CIP16, CIP18, CIP44).
- Tailscale's free plan allows up to 6 users and unlimited devices and lists Basic Tailscale SSH for up to 5 hosts; auth keys
  expire in 1 to 90 days and node keys after 180 days unless expiry is disabled (CIP25, CIP26, CIP29).
- Claude Code's setup page lists no Android or iOS; it has been broken on Termux since v2.1.113 by user reports, with a community
  build reported working on one phone; Codex's login fails on native Termux by user reports; Bun has no official Android build;
  Android 12 and later kills process trees over 32; an unplugged phone in Doze loses network access outside short windows (CIP31
  to CIP38).
- A Mac mini with an M6 chip and 16 GB starts at $899 and a Raspberry Pi 5 with 8 GB is $175 after three price rises; at 18.31 cents
  per kilowatt-hour a Mac mini at full load costs about 1.3 cents an hour to run (CIP39 to CIP43).

**On what evidence.** The providers' own pages, one or two reads each, and public issues and repositories read through the GitHub
API, which are users' reports and are marked so. Oracle's marketing pages answered 403, so its termination wording comes from two
search-tool summaries of its FAQ. Nothing was run and nothing was bought.

**What it would mean here.** The hosted runners and Codespaces cost more an hour than a plain hourly virtual machine and stop
before a long coachman does. Oracle's Always Free allowance and owned hardware cost less an hour, and a self-hosted runner adds no
GitHub charge to either. A phone is a control surface, not a place to run a gate.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
