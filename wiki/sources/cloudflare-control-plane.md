---
title: "Cloudflare's documentation for Workers, Durable Objects, Workflows, the Agents SDK, R2, D1 and Queues (read 2026-10-08)"
type: source
sources: [articles/cloudflare-control-plane]
updated: 2026-10-08
---

# What a Worker can and cannot be for the flow

Cloudflare, documentation at commit 6e1b964, read 2026-10-08.

**What it claims.**

- A Worker isolate has 128 MB of memory. `node:child_process` is available only as a non-working stub. `node:fs` works on a
  virtual file system held in memory, whose files count toward that 128 MB [@articles/cloudflare-control-plane/passages.md]
  (B1, B3, B4).
- CPU time is up to five minutes a request. An HTTP request has no wall-clock limit while the client stays connected; a Cron
  Trigger, Durable Object alarm or queue consumer is limited to fifteen minutes (B2).
- A Workflow step may wait on I/O without limit, an instance may sleep up to 365 days and run up to 25,000 steps, and
  50,000 instances may run at once. Billing for steps and storage began 2026-08-10 (B5, B6).
- Each Agent is one Durable Object; the Agents SDK can run the Pi agent loop in one (beta) and gives an agent a Linux
  sandbox (B9 to B11).
- R2 is strongly consistent, allows one write a second to a key and has no append call listed; D1 holds 10 GB a database; a
  queue message is 128 KB (B18 to B20).

**On what evidence.** The vendor's documentation as repository text; four entries (B1, B2, B3, B5) were also read on the published pages and
agreed (B-SECOND); the others were not (B-NOTCHECKED). Every quotation checked against the cited
file by script was found
[@trials/2026-10-08-cloudflare-run-cost/results/quote-check.md].

**What it would mean here if true.** A Worker can supervise a run and hold its state and cannot run a harness. Workflows and
Durable Objects fit the postmaster's waiting and rulings. The run folder's append-only files need segments or rows, not a
shared file.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
