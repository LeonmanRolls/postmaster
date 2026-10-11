---
title: "User reports in the issue trackers of Cloudflare's container repositories (read 2026-10-08)"
type: source
sources: [articles/cloudflare-containers-issue-reports]
updated: 2026-10-08
---

# What users of Containers and Sandboxes ran into

Users of Cloudflare's `containers`, `workers-sdk` and `sandbox-sdk` repositories, read through the GitHub API on 2026-10-08.

**What it claims.** Seven groups of reports: a long job killed at about ten minutes by the idle timer; a rollout shown
complete while the old image served for over an hour; a capacity error on start ("There is no container instance that can be
provided to this Durable Object"), open since 2025-07; leaked in-flight counters that keep a container running and billing;
placement constraints rejected under the newer scheduling policy; a deleted Worker whose Containers application kept running;
and a file read in Sandbox SDK 1.0.0 that can hang [@articles/cloudflare-containers-issue-reports/passages.md]. Most
are a single reporter's account; the capacity error has nine comments from several users, and the activity-tracking
group covers three issues.

**On what evidence.** Public issues, some open, most with no reply from the vendor. They show what was seen once and are not
counts. The one vendor-side reproduction is a bot's, on the placement error.

**What it would mean here if true.** The platform's edges are still being found: the lifetime and rollout behaviour a long
lane relies on has user reports against it, and cleaning up after a trial needs the application deleted as well as the Worker.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
