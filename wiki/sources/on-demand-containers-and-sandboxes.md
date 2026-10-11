---
title: "Price pages, limits and lifecycle documents of platforms that bill a container or sandbox by the second (read 2026-10-09)"
type: source
sources: [articles/on-demand-containers-and-sandboxes]
updated: 2026-10-09
---

# What a container costs on each platform that bills it by the second, and what stops one holding a launch

Fly.io, Modal, E2B, Daytona, Vercel, Amazon Web Services, Google, Microsoft, Northflank, Koyeb, Railway and Render, with
Cloudflare's rates read again: pricing, billing, limits and lifecycle pages and public price data, read 2026-10-09.

**What it claims.**

- Per vCPU-hour and per GiB-hour, the list rates are Northflank $0.01667 and $0.00833, AWS Fargate $0.04048 and $0.004445,
  Azure Container Instances $0.0405 and $0.00445, Google Cloud Run jobs $0.0648 and $0.0072, Fly.io's performance CPUs about
  $0.0458 with 2 GB included and $0.00834 for extra memory, and Modal Functions $0.0236 and $0.00799 (a Modal "core" is two
  vCPUs) [@articles/on-demand-containers-and-sandboxes/passages.md] (CNT61, CNT69, CNT28, CNT73, CNT99, CNT63). Modal
  Sandboxes cost about three times a Function per second, E2B and Daytona $0.0504 and $0.0162, Vercel $0.128 for each hour of
  active CPU, with time spent waiting on the network or a model not counted, and $0.0212 for each provisioned GB-hour
  (CNT63, CNT103, CNT105, CNT88, CNT90).
- Session and size limits decide more than price does. E2B's Hobby plan stops a session after one hour and Pro after 24; Vercel's
  Pro plan after 24, with memory fixed at 2 GB for each vCPU and 16 GB at most; Modal's Functions and Sandboxes after at most 24;
  Daytona's organisation limit is 4 vCPU, 8 GB and 10 GB of disk; E2B's stated range is 1 to 8 vCPU and 1 to 8 GiB. A Cloud Run
  job task may run 168 hours but its file system is memory. Fargate's default quota is 6 vCPUs running at once in a Region, and
  a new account may start lower (CNT104, CNT91, CNT65, CNT106, CNT74, CNT16, CNT42).
- Fly.io Sprites bill only CPU time and memory in use, are fixed at 8 vCPUs with memory the platform manages, and pause after
  about 30 seconds without activity by one Fly page, so an agent that only waits on model calls would, by the reader's reading
  of the lifecycle pages, need a task or a service to stay awake (CNT109, CNT110, CNT111, CNT128).
- Koyeb's Eco instances are $0.0576 an hour for 4 vCPU and 8 GB, but Koyeb is joining Mistral AI and new users can join only on
  Pro and above; the page does not say whether an Eco vCPU is shared (CNT67, CNT68, CNT80). Railway and Render are not priced
  here: Railway's pages do not say whether containers are metered on use or on the size requested, and Render's own pages were
  unreadable apart from its Workflows documents, whose fixed plans cost $1.00 an hour for 4 vCPU and 8 GB (CNT20, CNT31,
  CNT21, CNT37).
- Vercel Labs publishes a Herdr plugin that gives each pane its own Vercel Sandbox: a persistent sandbox per pane, a filtered
  upload of the worktree, the agent attached over an interactive terminal, and the results returned as a Git patch, with agent
  authentication kept inside the sandbox. It is not Herdr's, has no licence file and was created on 2026-08-01. Fly.io's and
  E2B's own organisations publish Herdr plugins too, and Fly.io's README says setup transfers the local Claude or Codex login
  into the Sprite (CNT94 to CNT98, CNT125, CNT129, CNT132).
- Vercel Sandbox's firewall can add or replace request headers for listed domains, which the page calls credentials
  brokering, so a secret stays outside the sandbox; it depends on the server name in the TLS handshake and a request to a
  literal IP address in an allowed range bypasses it. The page does not say whether it can carry a subscription login (CNT135).
  A program can start a command, stream its output and read its exit code on Vercel Sandbox, Modal Sandboxes, Daytona, AWS
  Fargate, Northflank, Koyeb Sandboxes, Cloudflare Containers, Fly.io's Sprites and Machines API, and, through the Task resource,
  Cloud Run jobs (CNT131, CNT133, CNT134).
- Two figures that had been given for Fly.io Machines without being checked against the page were wrong: $0.0001386 a second for a
  performance-4x with 8 GB is 2.72 times the page's $0.000050928, and $0.00000338 a second for shared-cpu-1x with 512 MB is the
  price of a shared-cpu-4x with 1 GB (CNT100, CNT101). A Hetzner CCX23 figure of $0.1541 an hour matched neither of Hetzner's
  columns, which read $0.1626 and EUR 0.1378 (CNT66).

**On what evidence.** The providers' own pages, read through a fetch tool that returns a model's summary of a page, so most
rates have two reads that agree and a quotation, and each entry says which. Fly's page builds its price table in the browser,
so its rates come from the page's source constants. Google's pricing page and Azure's could not be read: Cloud Run's rates come
from Google's discount page and Azure's from its retail price API. AWS's Spot rates could not be confirmed. Render's pricing
pages and Modal's treatment of CPU on a Function (the request or the use) were not read. Search-tool answers are marked as such
and are not relied on for a price. Nothing was run and nothing was bought.

**What it would mean here.** Most of the platforms that can hold a launch charge within a factor of two of Cloudflare per hour,
and which is cheapest depends on how much of the CPU is busy. The platforms built for agent sandboxes cost more per hour, and
two of them are limited below the 12 GiB the gate wants. The Herdr plugin is a precedent for a session host that runs a pane in a sandbox, not
a way to run the flow's headless launches, whose marker and output files would stay inside the sandbox.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
