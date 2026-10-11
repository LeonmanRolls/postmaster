# Passages relied on: Cloudflare Workers, Durable Objects, Workflows, the Agents SDK, R2, D1 and Queues

Read on 2026-10-08. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the words were seen in the repository text of the documentation and checked against it by script, and on the published page where the entry says so), where each was read, and how sure the note is. The documentation text is the cloudflare-docs repository at commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f, committed 2026-10-08T21:06:58Z; a path such as docs/workers/platform/limits.mdx is a file in it, and the published page is the same path under https://developers.cloudflare.com/.

### B1 Workers: memory
- finding: a Worker isolate has 128 MB of memory on both plans
- quote: "Each isolate can consume up to 128 MB of memory, including the JavaScript heap and WebAssembly allocations." (verbatim)
- source: workers/platform/limits/ ; docs/workers/platform/limits.mdx:122-124
- strength: stated

### B2 Workers: CPU time and duration
- finding: CPU time per HTTP request is up to 5 minutes on Workers Paid (default 30 s); wall-clock duration of an HTTP request has no limit while the client stays connected; cron, Durable Object alarm and queue consumer invocations are limited to 15 minutes of duration
- quote: "There is no hard limit on duration for HTTP-triggered Workers. As long as the client remains connected, the Worker can continue processing" (verbatim)
- source: docs/workers/platform/limits.mdx:73 (CPU), 158-163 (duration)
- strength: stated

### B3 Workers: no working process spawning
- finding: `node:child_process` exists in Workers only as a non-functional stub (enabled by default from compatibility date 2026-03-17); the other Node modules listed as supported do not include it
- quote: "A stub can be imported or required, but does not provide a working implementation of the underlying Node.js API." (verbatim)
- source: docs/workers/runtime-apis/nodejs/index.mdx:90 ; partials/workers/nodejs-compat-stub-modules.mdx:17 (child_process row)
- strength: stated

### B4 Workers: filesystem is a memory-backed virtual one
- finding: `node:fs` works on a virtual file system held in memory, with a writable `/tmp`; the bytes written count against the 128 MB memory limit; one file is at most 128 MB
- quote: "The Workers Virtual File System (VFS) is a memory-based file system" (verbatim); "total size of all temporary files and directories created count towards your Worker's memory limit" (verbatim, fs.mdx:115-116)
- source: docs/workers/runtime-apis/nodejs/fs.mdx:32, 115-117, 130
- strength: stated

### B5 Workflows: limits
- finding: a step may wait without limit on I/O; CPU per step 30 s default, up to 5 min; up to 25,000 steps per instance; sleeps up to 365 days; 1 GB of persisted state per instance on Paid; 50,000 concurrent running instances (waiting instances do not count); completed-instance state kept 30 days on Paid
- quote: "A Workflow instance can run forever, as long as each step does not take more than the CPU time limit and the maximum number of steps per Workflow is not reached." (verbatim)
- source: workflows/reference/limits/ ; docs/workflows/reference/limits.mdx:27-38, 46, 66-70
- strength: stated

### B6 Workflows: pricing and billing date
- finding: requests and CPU time as Workers; steps 500,000 included per month, then $0.80 per additional 100,000; storage 1 GB-month included, then $0.20 per GB-month; step and storage billing "starting August 10th, 2026" (already past on 2026-10-08)
- quote: "Billing for Workflows steps and storage will apply starting August 10th, 2026" (verbatim)
- source: docs/workflows/reference/pricing.mdx:15 ; partials/workflows/workflows-pricing.mdx:7-10
- strength: stated

### B7 Workers Paid plan price and rates
- finding: Workers Paid is $5 per month minimum; Standard usage: 10 million requests included then $0.30 per million; 30 million CPU ms included then $0.02 per million CPU ms; no duration charge for Workers
- quote: "The Workers Paid plan includes Workers, Pages Functions, Workers KV, Hyperdrive, and Durable Objects usage for a minimum charge of $5 USD per month for an account." (verbatim)
- source: docs/workers/platform/pricing.mdx:16, 33
- strength: stated

### B8 Durable Objects: duration billing and pending I/O
- finding: duration is 128 MB times active seconds, $12.50 per million GB-s with 400,000 GB-s included (from the worked example); inactive objects incur no duration; "Pending I/O operations keep an object in memory for up to 15 minutes each" and are billed as duration. Container-fronting detail is in the sandboxes capture (A1.13).
- quote: "Pending I/O operations keep an object in memory for up to 15 minutes each." (verbatim)
- source: docs/durable-objects/platform/pricing.mdx (worked examples, "Compute billing examples" section)
- strength: stated

### B9 Agents SDK: limits
- finding: each Agent is one Durable Object; 1 GB of state per agent; 30 s of compute per agent, refreshed on each request, scheduled task or WebSocket message; wall-clock per step unlimited
- quote: "Max compute time per Agent | 30 seconds (refreshed per HTTP request / incoming WebSocket message)" (verbatim table row)
- source: agents/platform/limits/ ; docs/agents/platform/limits.mdx:19-23, 31
- strength: stated

### B10 Agents SDK: a Pi harness runs inside a Durable Object (beta)
- finding: the Agents SDK has first-class support for running the Pi agent loop (the library `pi-durable`, not the pi command-line program) inside an Agent or Durable Object, with transcript and inbox in the object's SQLite and recovery after eviction; labelled Beta, API "will likely change"
- quote: "`PiHarness` is in beta. Pi Durable is a new, experimental package, and the `PiHarness` API will likely change as Pi Durable matures." (verbatim)
- source: agents/harnesses/pi/ ; docs/agents/harnesses/pi/index.mdx:24-26, 35-37 ; docs/agents/harnesses/index.mdx:32
- strength: stated. Whether the pi program the flow runs is the same code base: not checked

### B11 Agents SDK: sandbox tool
- finding: an agent gets a Linux sandbox that is a Container attached to its Durable Object; "The sandbox runs in its own virtual machine. It cannot read the storage, environment variables, or bindings of the agent. It reaches the Internet only when you allow it."; the example keeps the container 10 minutes after the agent becomes inactive
- quote: "The sandbox runs in its own virtual machine. It cannot read the storage, environment variables, or bindings of the agent. It reaches the Internet only when you allow it." (verbatim)
- source: agents/tools/sandbox/ ; docs/agents/tools/sandbox.mdx:13, 28-30, 46-47
- strength: stated

### B18 R2
- finding: strongly consistent; 5 TiB per object; one write per second to the same key before HTTP 429; storage $0.015 per GB-month, Class A $4.50 per million, Class B $0.36 per million, egress free; no append call listed
- quote: "Concurrent writes to the same object name (key) at a higher rate return HTTP 429 (rate limited) responses." (verbatim footnote 5)
- source: r2/platform/limits/ ; docs/r2/platform/limits.mdx:20-23, 33 ; r2/pricing.mdx:32-36 ; r2/reference/consistency.mdx:13-19, 30-33
- strength: stated; "no append" is not found (grep for append, 0 relevant hits in docs/r2)

### B19 D1
- finding: 10 GB per database and 50,000 databases per account on Paid; 2 MB per row; a query lasts at most 30 s
- quote: "Maximum database size | 10 GB (Workers Paid) / 500 MB (Free)" (verbatim, table row)
- source: docs/d1/platform/limits.mdx:14-16, 25
- strength: stated

### B20 Queues
- finding: message size 128 KB, retention configurable up to 14 days, consumer wall-clock 15 minutes, 5,000 messages per second per queue
- quote: "Consumer duration (wall clock time) | 15 minutes" (verbatim, table row) ; "Message size | 128 KB" (verbatim, table row)
- source: docs/queues/platform/limits.mdx:20, 26, 29
- strength: stated

### B-SECOND Second reads of the control-plane and AI Gateway pages on the published site through the fetch tool (2026-10-08; the tool allows quotes of about 125 characters)
- Agreed with the repository text: B1, B2 (CPU row, memory row, duration sentence start, 15-minute rows), B3 (child_process in the stub table, 2026-03-17, first sentence), B5 (six table rows), B14 (5% fee sentence), B13 (credential precedence), B12 (Codex wire API note).
- Differed: the rendered Unified Billing page is not marked Beta, while the source file's sidebar group is (see B13).

### B-NOTCHECKED What the reading of the control-plane and AI Gateway pages did not cover
- The published pages through the fetch tool (second read) for B4, B6-B11, B15-B20.
- Workers Logs pricing and retention (referenced by AI Gateway pricing for new customers).
- Pricing of Secrets Store, KV, Hyperdrive.
- Durable Object limits beyond the front-door topics, which the sandboxes capture covers.
