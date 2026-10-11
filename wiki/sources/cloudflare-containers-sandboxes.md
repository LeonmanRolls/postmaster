---
title: "Cloudflare's documentation for Containers and Sandboxes (read 2026-10-08)"
type: source
sources: [articles/cloudflare-containers-sandboxes]
updated: 2026-10-08
---

# What Cloudflare says a container for a lane would be

Cloudflare, documentation at commit 6e1b964 of its documentation repository, read 2026-10-08.

**What it claims.**

- Each container instance is a microVM with its own kernel and network, up to 4 vCPU, 12 GiB and 20 GB self-serve (larger
  sizes by asking Cloudflare), with 6 TiB, 1,500 vCPU and 30 TB at most for an account
  [@articles/cloudflare-containers-sandboxes/passages.md] (A6.2, A3.1, A3.2).
- Code running inside an instance is not activity. The instance runs while its Durable Object is active, and a Durable
  Object alarm that fires more often than the inactivity timeout, at most six hours, is the documented way to keep a long
  task alive. Cloudflare does not guarantee that an instance runs for a set period (A1.15, A1.5).
- The ten-minute idle sleep is the `Container` class's default, not a platform rule; the Durable Object Container API has no
  default timeout. The stop on a rollout, with `SIGTERM` and a fifteen-minute wait before `SIGKILL`, belongs to the `default`
  scheduling policy, and the same drain precedes a host move under either policy. Under the `durable_object` policy, a public
  beta that the documents list as best for sandboxes and agent environments, a deploy does not restart a running instance
  (A1.6, A1.18).
- The disk is ephemeral; snapshots of the root filesystem are a beta feature of the newer policy (A2.1, A2.2).
- A Worker can intercept an instance's HTTPS traffic and add a credential, so the sandbox never holds it; this is shown for
  Git over HTTPS, fetch only, with a push refused. SSH and other ports cannot be intercepted (A4.3 to A4.5, A6.4).
- Tutorials run Claude Code, Codex, Pi and OpenCode headless in a sandbox with a placeholder key, and show no subscription
  login (A7.1 to A7.6). An earlier example in Cloudflare's sandbox repository did, for Claude Code: a Claude subscription
  token held in the Worker, a placeholder in the container, from 2026-04-20 to 2026-09-02 (A7.7).
- Containers and Sandboxes were announced generally available on 2026-04-13. The newer scheduling policy and snapshots are
  in public beta; Sandbox SDK 1.0, which uses both, is "available" (A9.1).

**On what evidence.** The vendor's own documentation, read as repository text and, for ten claims that decide most, again
on the published page (A-CHECK). Every quotation in an entry that cites a file of the repository text was checked against
that file by script: 122 of 123 found, the other read by hand
[@trials/2026-10-08-cloudflare-run-cost/results/quote-check.md]. The entry for the sandbox repository's example (A7.7)
quotes GitHub text, read through the GitHub API. Nothing was run. A documentation page states what the vendor intends, not
what happens; the user reports in [the issue-report source](cloudflare-containers-issue-reports.md) show some of what
happens.

**What it would mean here if true.** A lane, a reviewer or a coachman leg can each be a container, isolated from the others,
with the model key held in a Worker. The work is in keeping a long task alive, resuming it after a stop and moving the run
folder's files and processes behind a network.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
