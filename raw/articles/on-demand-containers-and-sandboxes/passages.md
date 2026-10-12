# Passages relied on: on-demand containers and sandboxes

Read on 2026-10-09. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the same words were seen in two separate reads, or in the provider's own source files; paraphrase means one read or a restatement), where each was read, how well it was checked, and how sure the note is. Strength: stated is on the provider's page, shown is in a data file, a repository or a third party's copy, argued is derived by the reader from the entries named, not found is a search with the searches listed. Prices are list prices for the region and currency each entry names, and prices change. These are the providers that bill a container or sandbox by the second: Fly.io, Modal, E2B, Daytona, Vercel, AWS Fargate, Google Cloud Run, Northflank, Koyeb, Railway, Render and Azure Container Instances, with Cloudflare's own rates read again; and the Herdr plugin that runs an agent in a Vercel Sandbox.

### CNT1 Vercel Sandbox: price model (Pro, default region iad1)
- finding: Pro rates are $0.128 per Active-CPU hour (I/O wait is not counted), $0.0212 per GB-hour of provisioned memory, $0.60 per million Sandbox creations; each vCPU carries 2 GB memory, memory billed in 1-minute minimum increments.
- quote: "Sandbox Active CPU | 5 hours/month | $0.128/hour | $0.128/hour" ; "Sandbox Provisioned Memory | 420 GB-hours/month | $0.0212/GB-hour" ; "Each vCPU includes 2 GB of memory." (verbatim table rows)
- source: https://vercel.com/docs/sandbox/pricing (page front matter: last_updated 2026-09-10) ; read 2026-10-09, twice (two different URL spellings and prompts, same page text) ; USD, tax not stated, region iad1 (rates vary by region, other regions not read)
- strength: stated

### CNT2 Vercel Sandbox: shapes and hourly price (arithmetic by hand, Pro, iad1)
- finding: S and M exist exactly (2 vCPU/4 GB and 4 vCPU/8 GB); L (4 vCPU, 16 GiB) does not exist because memory is fixed at 2 GB per vCPU, so the nearest is 8 vCPU/16 GB (the Pro maximum).
- arithmetic: S memory 4 GB x $0.0212 = $0.0848/h; CPU 2 x $0.128 = $0.256/h busy, x0.25 = $0.064/h. M memory 8 x 0.0212 = $0.1696/h; CPU 4 x 0.128 = $0.512/h busy, $0.128/h quarter. L' (8 vCPU/16 GB) memory 16 x 0.0212 = $0.3392/h; CPU 8 x 0.128 = $1.024/h busy, $0.256/h quarter.
- quote: "Each vCPU includes 2 GB of memory." ; "You can provision 1 or an even number of vCPUs between 2 and 32" (verbatim, same page)
- source: derived from the page above ; read 2026-10-09 ; USD, iad1
- strength: argued (from stated rates)

| Shape | Machine name | CPU kind | $ per hour (CPU idle / quarter busy / all busy) | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | Sandbox, 2 vCPU (4 GB by the 2 GB/vCPU rule) | Active CPU, billed only while used | 0.0848 / 0.1488 / 0.3408 | no cap, metered ($20/month Pro credit applies) | 64 GB ephemeral NVMe | Data downloaded is free; Pro cell for sent data reads "Included in Flat Rate CDN" (unclear) |
| M: 4 vCPU, 8 GiB | Sandbox, 4 vCPU (8 GB) | same | 0.1696 / 0.2976 / 0.6816 | no cap | 64 GB | same |
| L: 4 vCPU, 16 GiB | none; nearest Sandbox 8 vCPU (16 GB), 4 more vCPUs than asked, they cost only while busy | same | 0.3392 / 0.5952 / 1.3632 | no cap | 64 GB | same |

### CNT3 Vercel Sandbox: limits, billing, lifecycle
- finding: Pro max session is 24 hours; Hobby 45 minutes; Pro max 8 vCPU / 16 GB, concurrency 10,000 sandboxes; a persistent sandbox can be stopped and resumed, and the 24-hour limit resets at each resume so total lifetime is "effectively unbounded".
- quote: "The limit resets every time a sandbox stops and resumes, so the total lifetime of a persistent sandbox is effectively unbounded." (verbatim) ; "Max Session Duration | 45 minutes | 24 hours | 24 hours" (verbatim table row, Hobby/Pro/Enterprise)
- source: https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD
- strength: stated
- strength: stated (page), shown (the related guide titles)

### CNT4 Fly.io Machines: list price per hour and month (Ashburn, iad)
- finding: two Fly pages agree on Machine prices: performance-2x (4GB) $0.0917/h = $66.00/month, performance-4x (8GB) $0.1833/h = $132.01/month, performance-8x (16GB) $0.3667/h = $264.01/month, shared-cpu-2x (512MB) $0.0061/h = $4.39/month, shared-cpu-4x (1GB) $0.0122/h = $8.78/month; extra RAM $6.00 per GB per month on every preset.
- quote: "Every preset takes more RAM at $6.00 per GB per month, up to 128GB." ; "Only the Machine's root file system is billed while it's stopped" ; "Each 1GB of rootfs for a Machine stopped for 30 days is $0.15." (verbatim, summaries of fly.io/pricing.md and docs.fly.io/about/pricing)
- source: https://fly.io/pricing/ , https://fly.io/pricing.md , https://docs.fly.io/about/pricing (the docs page's region table is script-rendered; its static rows quote "shared-cpu-2x with 2GB RAM | $13.39/month", which equals $4.39 + 1.5 GB x $6.00) ; read 2026-10-09 ; USD, tax not stated, region iad (Ashburn); no page date shown
- strength: stated (hourly and monthly, 2 reads agree); the per-second figures ($0.000050928/s for performance-4x) come from the docs page formula via the fetch-tool summary, one read, and equal monthly/(30 x 24 x 3600) = $132.01/2,592,000 = $0.00005093/s

### CNT5 Fly.io Machines: what billing is, as far as read
- finding: Machines are "Billed by the second"; a stopped Machine pays only for its root filesystem at $0.15 per GB-month; volumes $0.15/GB-month on provisioned size; volume snapshots $0.08/GB-month with first 10 GB free; outbound data to the internet $0.02/GB (North America, Europe), $0.04/GB (Asia Pacific, Oceania, South America), $0.12/GB (Africa, India); inbound free; no plan fee.
- quote: "Only the Machine's root file system is billed while it's stopped" (verbatim)
- source: https://docs.fly.io/about/pricing , https://fly.io/pricing/ ; read 2026-10-09 ; USD
- strength: stated (2 reads agree on volumes, snapshots, egress, stopped rootfs)

### CNT6 Fly.io Sprites: price and what they are
- finding: a Sprite is a persistent Linux computer for agents, metered by use, with no plan fee on the pricing page: $0.0385 per CPU-hour (cumulative CPU usage), $0.021875 per GB-hour of memory (actual usage), hot storage $0.50/GB-month while awake, cold storage $0.02/GB-month while kept; idle Sprites cost no compute.
- quote: "a Sprite that exists but does nothing costs nothing beyond its stored data." ; "Sprites are full Linux computers designed for agents, not sandboxes." (verbatim, summaries)
- source: https://fly.io/sprites , https://fly.io/pricing.md , https://fly.io/pricing/ ; read 2026-10-09 ; USD
- strength: stated (rates: 3 reads agree); the Hero plan: one read

### CNT7 Fly.io Machines: CPU kinds (shared is throttled)
- finding: a shared vCPU gets a baseline quota of 6.25% of a CPU (5 ms per 80 ms period), with a burst balance that starts at 5 s and is capped at 500 s; a performance vCPU gets the full period with no burst balance. Shared is therefore a poor fit for a 12-minute CPU-heavy gate (2 vCPU x 12 min = 1,440 vCPU-s of work against 1,000 s of burst balance for two vCPUs), fine for idle-heavy lanes.
- quote: "a quota of 5ms" per 80ms period ; "Unused CPU time accrues as a balance, starting at 5s and capped at 500s" (second quote is the fetch-tool summary's paraphrase of the page, so paraphrase)
- source: https://docs.fly.io/machines/cpu-performance ; read 2026-10-09 ; no price on this page
- strength: stated (one read; the 500 s cap and 6.25% each came from the same read)

### CNT8 Fly.io Machines: billing, lifecycle, access (answers)
- finding: a Fly Machine is a Firecracker microVM with a root shell, billed per second while started, created and ended by REST API or `fly machine`, starts "well under a second", and no maximum run time was found.
- quote: "Started Machines are billed per second that they're running (the time they spend in the `started` state)." (verbatim, docs.fly.io/about/billing via the fetch-tool summary)
- source: the three pages named ; read 2026-10-09 ; USD
- strength: stated, each one read.

| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | performance-2x (2 vCPU, 4 GB) exact | performance (full vCPU) | 0.0917 (flat, not CPU-metered) | $66.00 listed (= 720 h, cap not stated) | rootfs only (image size); volume extra $0.15/GB-month | none stated; outbound $0.02/GB NA and EU |
| S alt | shared-cpu-2x + 3.5 GB extra RAM (4 GB is the 2 GB/vCPU ceiling) | shared, 6.25% baseline per vCPU | 0.0061 + 3.5 x 6.00/720 = 0.0353 | 4.39 + 3.5 x 6.00 = $25.39 | same | same |
| M: 4 vCPU, 8 GiB | performance-4x (4 vCPU, 8 GB) exact | performance | 0.1833 | $132.01 | same | same |
| M alt | shared-cpu-4x + 7 GB extra RAM (8 GB is the ceiling) | shared | 0.0122 + 7 x 6.00/720 = 0.0705 | 8.78 + 42.00 = $50.78 | same | same |
| L: 4 vCPU, 16 GiB | performance-4x + 8 GB extra RAM (ceiling 32 GB) | performance | 0.1833 + 8 x 6.00/720 = 0.2500 | 132.01 + 48.00 = $180.01 | same | same |
| L alt | none shared with 4 vCPU; shared-cpu-8x + 14 GB extra (8 vCPU, 16 GB) | shared | 0.0244 + 14 x 6.00/720 = 0.1411 | 17.55 + 84.00 = $101.55 | same | same |

Hour arithmetic uses extra RAM $6.00 per GB per month / 720 h = $0.008333 per GB-hour. Fly bills provisioned CPU, so idle and busy cost the same; the yardstick's range does not apply (flat figure shown). Strength of the table: stated for the presets and RAM rate, argued for the sums.

Sprites (Fly), from https://docs.fly.io/sprites (one read): "Every Sprite has a persistent, standard ext4 filesystem." Isolation "Hardware-level" via a "dedicated microVM" (hypervisor not named, so Firecracker is not confirmed for Sprites). Billing "Per-second" with "compute free when idle". "Sprites become `warm` immediately when idle, and may eventually go `cold`." The page does not give vCPU/RAM per Sprite, shell/SSH, or maximum duration; https://fly.io/sprites shows `sprite exec` and `sprite console -s my-sprite`.

### CNT9 Modal Sandbox: price per core-second and GiB-second
- finding: Sandbox CPU is $0.00003942 per physical core per second (a core equals 2 vCPU) and memory $0.00000667 per GiB per second, about 3x the Function rates ($0.0000131 and $0.00000222); billing is the higher of what is requested and what is used, minimum 0.125 core and 128 MiB per container, so an idle Sandbox pays for its request.
- quote: "Physical core (2 vCPU equivalent)" ; "$0.00003942 0.00003942 / core / sec" ; "$0.00000667 0.00000667 / GiB / sec" ; "For CPU and memory, you'll be charged based on whichever is higher: your request or actual usage." (verbatim from page text and guide/resources)
- source: https://modal.com/pricing (2 reads agree), https://modal.com/docs/guide/resources (1 read) ; read 2026-10-09 ; USD, tax not stated, region not stated (page has no date, shows "© Modal 2026")
- strength: stated

Arithmetic: per core-hour 0.00003942 x 3600 = $0.141912; per vCPU-hour $0.070956; per GiB-hour 0.00000667 x 3600 = $0.024012.
S (1 core = 2 vCPU, 4 GiB): 0.141912 + 4 x 0.024012 = $0.2380/h. M (2 cores, 8 GiB): 2 x 0.141912 + 8 x 0.024012 = 0.283824 + 0.192096 = $0.4759/h. L (2 cores, 16 GiB): 0.283824 + 16 x 0.024012 = 0.283824 + 0.384192 = $0.6680/h.
Idle and busy are the same at the request ("whichever is higher"), so no idle discount; usage above the request is billed extra. Not cheaper than the yardstick at any shape (standard-3 busy $0.220 for 2 vCPU/8 GiB).

| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | Sandbox cpu=1.0 core (2 vCPU), memory=4096 MiB | physical core hyperthreads, billed on request or use | 0.2380 | no cap, metered | per-container disk quota 512 GiB default, 3.0 TiB max (guide/resources, 1 read) | egress $0.04/GiB, 1 TiB/month included on Starter (1 read) |
| M: 4 vCPU, 8 GiB | cpu=2.0, memory=8192 | same | 0.4759 | no cap | same | same |
| L: 4 vCPU, 16 GiB | cpu=2.0, memory=16384 | same | 0.6680 | no cap | same | same |

### CNT10 Modal Sandbox: plans, limits, lifecycle, shell
- finding: a Modal Sandbox may live up to 24 hours (5-minute default), can be entered with `modal shell sb-...` or `sandbox.exec`, has open outbound access by default, and the Starter plan is $0 plus usage with $30 a month of free credit.
- quote: "You can change this by passing a `timeout` of up to 24 hours to the `Sandbox.create(...)` function." (verbatim)
- source: https://modal.com/docs/guide/sandbox ; https://modal.com/docs/reference/cli/shell ; https://modal.com/docs/guide/sandbox-networking ; https://modal.com/pricing ; read 2026-10-09 ; USD, tax not stated
- strength: stated for each quoted line, one read each except the pricing page.

### CNT11 E2B: sandbox rates and plans
- finding: E2B charges $0.000014 per vCPU-second and $0.0000045 per GiB-second while a sandbox runs, storage free; Hobby is $0 with a one-time $100 credit, 1-hour sessions, 20 concurrent; Pro is $150/month, 24-hour sessions, 100 concurrent (add-ons Pro+ $650/month for 600, Pro++ $1,150/month for 1,100).
- quote: "vCPU | $0.000014 per vCPU-second" ; "RAM | $0.0000045 per GiB-second" ; "Up to 24 hours per sandbox session." ; "Sandboxes can be configured with 1 to 8 vCPUs and 1 to 8 GiB of RAM." (verbatim)
- source: https://e2b.dev/pricing (2 reads), https://docs.e2b.dev/billing (1 read; it gives no rates, only plan limits) ; read 2026-10-09 ; USD, tax not stated, no region price difference stated; no page date
- strength: stated

### CNT12 E2B: pause and resume, lifetime, API
- finding: a sandbox pauses with filesystem and memory (running processes included), is kept indefinitely with no time-to-live, pauses at about 4 s per GiB of RAM and resumes in about 1 s, and the continuous-runtime limit (1 hour Hobby, 24 hours Pro) resets after a pause and resume.
- quote: "A paused sandbox is kept indefinitely. There is no time-to-live and no automatic deletion." ; "the continuous runtime limit is reset." ; pause "approximately 4 seconds per 1 GiB of RAM", resume "approximately 1 second" (fetch-tool summary quotes, one read)
- source: https://docs.e2b.dev/sandbox/persistence ; https://docs.e2b.dev/sandbox ; read 2026-10-09
- strength: stated (one read)

### CNT13 Daytona: rates, billing states, limits
- finding: Daytona charges $0.0504 per vCPU-hour, $0.0162 per GiB of memory per hour and $0.000108 per GiB of disk per hour (the same vCPU and memory rates as E2B), billed per second, no plan fee, $200 free compute; a stopped sandbox pays for disk only, an archived one nothing; but an organisation's default maximum per sandbox is 4 vCPU, 8 GB RAM and 10 GB disk, which is below the workload's 20 GB disk and 16 GiB cases.
- quote: "Compute, vCPU, $0.0504/h, Memory, GiB, $0.0162/h, Storage, GiB, $0.000108/h" ; "Billed for reserved disk only." (stopped) ; "Organizations get a maximum sandbox resource limit of 4 vCPUs, 8GB RAM, and 10GB disk." (verbatim/fetch-tool summary)
- source: https://www.daytona.io/pricing (front matter "Oct 2, 2026, 9:12 PM UTC", 1 read) ; https://www.daytona.io/docs/en/billing (1 read) ; https://www.daytona.io/docs/en/sandboxes (2 reads agree on the resource numbers: this page twice with different prompts) ; https://www.daytona.io/docs/en/limits (1 read) ; read 2026-10-09 ; USD, tax not stated, region not stated
- strength: stated; "Price per GiB after first 5 free" is a footnote whose scope (memory, storage or both) the page does not say.

### CNT14 Fargate: on-demand rates
- finding: Linux/x86 is $0.000011244 per vCPU-second and $0.000001235 per GB-second; Linux/ARM is $0.0000089944 per vCPU-second and $0.0000009889 per GB-second; storage beyond 20 GB is $0.0000000308 per GB-second; "Pricing is calculated per second with a 1-minute minimum."; Spot runs "at up to a 70% discount off the regular Fargate price."
- quote: "Pricing is calculated per second with a 1-minute minimum." (verbatim, fetch-tool summary quote); "at up to a 70% discount off the regular Fargate price." (verbatim)
- source: https://aws.amazon.com/fargate/pricing/ ; read 2026-10-09 (the page read 4 times with different prompts; the on-demand numbers came twice and agree, the Spot table values are not in the page text any of the times) ; USD sign used but currency and tax not stated on the page ; US East (N. Virginia)
- strength: stated for on-demand (two reads agree); Spot percentage stated; Spot price values: not found (table values missing from the extracted text, 3 attempts)

### CNT15 Fargate: task sizes and storage (AWS docs, one read)
- finding: Linux tasks allow 2 vCPU with 4 to 16 GB and 4 vCPU with 8 to 30 GB (1 GB steps), up to 16 vCPU/120 GB and a 32 vCPU/244 GB row; so shapes S, M and L all exist exactly. Persistent storage options: EBS volumes, EFS volumes, bind mounts for ephemeral storage. `privileged` and `gpu` parameters are not valid on Fargate.
- quote: "4096 (4 vCPU) | Between 8 GB and 30 GB in 1 GB increments | Linux, Windows" (verbatim table row)
- source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html ; read 2026-10-09
- strength: stated

### CNT16 Cloud Run: limits that matter
- finding: Cloud Run jobs allow task timeouts "up to 168 hours (7 days)" (default 10 minutes); maximum memory is 32 GiB; 2 vCPU takes up to 8 GiB, 4 vCPU takes 2 to 16 GiB, 8 vCPU takes 4 to 32 GiB, so S, M and L all exist; BUT the container file system is in-memory: "It is an in-memory file system, so writing to it uses the instance's memory." with no size limit and no persistence, and the page has no SSH or exec guidance in its body.
- quote: "It is an in-memory file system, so writing to it uses the instance's memory." ; "Data written to the file system doesn't persist when the instance stops." (verbatim, fetch-tool summary quotes) ; "a longer time up to 168 hours (7 days)" (verbatim)
- source: https://docs.cloud.google.com/run/docs/container-contract ; https://docs.cloud.google.com/run/docs/configuring/task-timeout ; https://docs.cloud.google.com/run/docs/configuring/services/memory-limits ; read 2026-10-09, one read each
- strength: stated

### CNT17 Cloud Run: price (the official page could not be read; figures come from a web-search summary of it)
- finding: a web-search answer quoting "the official pricing table" gives Tier 1 (us-central1) instance-based billing, which is what jobs and "CPU always allocated" use, at $0.00001800 per vCPU-second and $0.00000200 per GiB-second (free: first 240,000 vCPU-seconds and 450,000 GiB-seconds a month); request-based is $0.000024 per vCPU-second and $0.0000025 per GiB-second.
- quote: "$0.00001800 / vCPU-second" ; "$0.00000200 / GiB-second" (search-answer paraphrase of the pricing table, not a page read)
- source: web search 2026-10-09 whose results are cloud.google.com/run/pricing in several languages; a fetch-tool read of https://cloud.google.com/run/pricing and its ?hl=cs variant returned only the title (73 characters, script-rendered), and the fetch tool's summary then offered figures "from training data", which were not counted as a read ; USD ; Tier 1 region ; tax not stated
- strength: two reads, both web-search answers quoting the official table (a second search later returned the same numbers); the official page itself was never readable. The rates also agree with the reader's memory, which is not counted as a source.

### CNT18 Fargate Spot: price from third parties
- finding: third-party sites give us-east-1 Linux/x86 Fargate Spot at $0.0124419 per vCPU-hour and $0.00136621 per GB-hour (one source) and $0.01246287 and $0.00136851 (a source dated January 2024), roughly 69% under on-demand; AWS's own page names a Spot table but its values did not come through.
- quote: paraphrase of a search answer; no exact words
- source: web search results listing vantage.sh/blog/fargate-pricing, cloudchipr.com, wring.co; the vantage.sh page was opened later (see the next Fargate Spot entry) ; read 2026-10-09 ; USD ; us-east-1 ; Spot rates change, so these may not be October 2026 rates
- strength: argued (third-party, undated, not opened)
Arithmetic on the first pair: S 2 x 0.0124419 + 4 x 0.00136621 = 0.0248838 + 0.0054648 = $0.0303/h. M 0.0497676 + 8 x 0.00136621 = 0.0497676 + 0.0109297 = $0.0607/h. L 0.0497676 + 16 x 0.00136621 = 0.0497676 + 0.0218594 = $0.0716/h.

### CNT19 Northflank: price (pricing page, one read so far)
- finding: Northflank lists compute at $0.01667 per vCPU-hour and $0.00833 per GB-hour of memory, billed "down to the second", disk $0.15/GB-month, network egress $0.06/GB, ingress free; the listed plan nf-compute-200-8 (2 dedicated vCPU, 8192 MB) is $0.1000/h ($72.00/month), which equals 2 x 0.01667 + 8 x 0.00833 = 0.09998.
- quote: "nf-compute-200-8 | 2 dedicated | 8192 MB | $72.00/month ($0.1000/hr)" (table row, fetch-tool summary, verbatim)
- source: https://northflank.com/pricing ; read 2026-10-09 once ; USD ; region and tax not stated
- strength: stated (one read; the arithmetic cross-check agrees with the plan row)
Arithmetic: S (2 vCPU, 4 GB) 2 x 0.01667 + 4 x 0.00833 = 0.03334 + 0.03332 = $0.0667/h. M (4 vCPU, 8 GB) 0.06668 + 0.06664 = $0.1333/h. L (4 vCPU, 16 GB) 0.06668 + 0.13328 = $0.2000/h. Billed on provisioned plan size; idle = busy. Free tier: "Sandbox" with 2 free services, 1 free database, 2 free cron jobs, "Always-on-compute". Maximum job run time: not stated on the page.

### CNT20 Railway: price (pricing page, one read so far)
- finding: Railway charges a plan fee (Hobby $5/month with $5 of usage included; Pro $20/month per workspace with $20 included) plus usage billed per second at $0.00000772 per vCPU-second (about $20 per vCPU-month) and $0.00000386 per GB-second (about $10 per GB-month), volumes $0.00000006 per GB-second (about $0.15 per GB-month), egress $0.05/GB; maximum per service Hobby 48 vCPU / 48 GB, Pro 1,000 vCPU / 1 TB.
- quote: "$0.00000772 per vCPU/s" ; "$0.00000386 per GB/s" ; "Hobby: 48 vCPU / 48 GB" (verbatim, fetch-tool summary)
- source: https://railway.com/pricing ; read 2026-10-09 once ; USD ; tax and region not stated
- strength: stated (one read). Whether container usage is metered on what a service uses or on what is allocated: not stated (the docs plans page says only "You are only charged for the resources you actually use", see below).

### CNT21 Render: price (pricing page returned headings only)
- finding: the Render pricing page text had no instance table, no plan fees and no per-second statement in the extracted text; only "Get up to $10K in migration credits."
- quote: "Get up to $10K in migration credits." (verbatim; the only figure in the extracted page text)
- source: https://render.com/pricing ; read 2026-10-09 once
- strength: not found (one read, script-rendered)

### CNT22 Koyeb: price (pricing page, one read)
- finding: the Koyeb pricing text lists Serverless Postgres, GPU instances and plan fees (Pro $29/month, Scale $299/month) but no CPU-only instance types at all; bandwidth 1 TB/month included on Pro, Scale and Enterprise, then $0.02/GB (EU/US) and $0.04/GB (Asia); billing "by the second"; Pro "$10 included compute".
- quote: "Only pay for what you use, by the second." ; "Processing is accounted per second and billing is rounded up to the nearest unit." (verbatim, fetch-tool summary)
- source: https://www.koyeb.com/pricing ; read 2026-10-09 once ; USD
- strength: stated for the billing statements; CPU instance types: not found on that page (one read)

### CNT23 Azure Container Instances: price (pricing page rates show "$-")
- finding: the ACI page's rates were placeholders in the extracted text; stated limits: "You can allocate up to 4 vCPU to each container group you deploy" with a minimum of 1 vCPU and 1 GB and up to 7 GB of memory per vCPU (fetch-tool summary paraphrase).
- quote: "You can allocate up to 4 vCPU to each container group you deploy" (verbatim, fetch-tool summary)
- source: https://azure.microsoft.com/en-us/pricing/details/container-instances/ ; read 2026-10-09 once ; prices in USD, converted for other currencies, estimates, tax not stated
- strength: not found for the rates (script-rendered); stated for the 4 vCPU limit (one read)

### CNT24 Vercel Sandbox: lifecycle, shell, persistence, agents (docs page last_updated 2026-09-15)
- finding: Sandboxes are persistent by default (the SDK snapshots the filesystem on stop and restores it on resume, by name), are created with Sandbox.create() and stopped with sandbox.stop() or `sandbox remove`, and `sandbox connect <name>` gives "full shell access" with "an SSH-like experience"; the docs show timeouts of 3 hours in an example and extension with extendTimeout; coding agents are an explicit use (guides for Claude Agent SDK, OpenCode, Cursor Cloud Agents, Devin Outposts).
- quote: "Sandboxes are **persistent by default**: when a sandbox stops, the SDK automatically snapshots its filesystem and restores it on the next resume." ; "Connect to a running sandbox for interactive debugging with an SSH-like experience: sandbox connect <name>" (verbatim)
- source: https://vercel.com/docs/sandbox/working-with-sandbox ; read 2026-10-09 once ; no price on this page
- strength: stated (create, stop, delete, connect, persistence); shown (agent guides listed by title only, not opened)

### CNT25 E2B docs front page (one read)
- finding: the docs describe a sandbox as "A fast, secure Linux VM created on demand for your agent, which you can pause and resume as needed."; the page shows only the SDK (Sandbox.create(), sandbox.commands.run()); Firecracker, a start time, a CLI, SSH/terminal, root and internet access are not on that page.
- quote: "A fast, secure Linux VM created on demand for your agent, which you can pause and resume as needed." (verbatim)
- source: https://docs.e2b.dev/ ; read 2026-10-09 once
- strength: stated for the quote; not found for the rest (this page only; other E2B pages were not searched)

### CNT26 Fargate: storage and quotas
- finding: platform version 1.4.0 or later gives each Linux task a minimum of 20 GiB of ephemeral storage, configurable up to 200 GiB; persistent options are EBS and EFS volumes; the Fargate quotas page (ECS service quotas) carries no numbers, only a pointer to "Amazon ECS endpoints and quotas".
- quote: "receive a minimum of 20 GiB of ephemeral storage. The total amount of ephemeral storage can be increased, up to a maximum of 200 GiB." (verbatim)
- source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html ; https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-quotas.html ; read 2026-10-09 once each
- strength: stated (storage); the quotas page itself carries no numbers (the default vCPU quota was found in the General Reference page, section 11)

### CNT27 Fargate Spot: interruption
- finding: "When AWS needs the capacity back, your tasks are interrupted with a two-minute warning," delivered as an EventBridge event and a SIGTERM; stopTimeout up to 120 s; "Fargate doesn't replace Spot capacity with on-demand capacity."; a Spot task can be delayed when capacity is short.
- quote: "When tasks using Fargate Spot capacity are stopped due to a Spot interruption, a two-minute warning is sent before a task is stopped." (verbatim)
- source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html ; read 2026-10-09 once
- strength: stated

### CNT28 Azure Container Instances: price (first-party retail price API, East US, USD)
- finding: Linux "Standard" ACI is $0.0405 per vCPU-hour and $0.00445 per GB-hour; "Standard Spot" is $0.01215 per vCPU-hour and $0.001335 per GB-hour; there is a separate Windows software meter, so the Standard vCPU and memory meters are the Linux price (the API does not label them Linux).
- quote: "Standard vCPU Duration | 0.0405 | 1 Hour" ; "Standard Memory Duration | 0.00445 | 1 GB Hour" ; "Standard Spot vCPU Duration | 0.01215 | 1 Hour" ; "Standard Spot Memory Duration | 0.001335 | 1 GB Hour" (table rows as read)
- source: https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Container Instances' and armRegionName eq 'eastus' and priceType eq 'Consumption' (Microsoft's public retail prices API) ; read 2026-10-09 once ; USD, retail price, tax not included in the API's figures (tax status not stated by it), East US
- strength: stated (one read); the pricing page itself was unreadable.

### CNT29 Koyeb: instance table (docs page, one read; the pricing page lacked CPU instances)
- finding: Koyeb's instance reference lists Standard instances (large 4 vCPU/4 GB/40 GB SSD $0.0576/h; 2xlarge 16 vCPU/16 GB $0.2304/h) and Eco instances in Washington D.C., Frankfurt and Singapore (eco-large 2 vCPU/4 GB/20 GB $0.0288/h = $21.43/month; eco-xlarge 4 vCPU/8 GB/20 GB $0.0576/h = $42.85/month; eco-2xlarge 8 vCPU/16 GB/20 GB $0.1152/h = $85.71/month); per-second rates are shown in a column; the page does not say whether Eco or Standard vCPUs are shared or dedicated.
- quote: "eco-xlarge | 4 | 8GB | 20GB SSD | $0.0576 | $42.85" ; "eco-large | 2 | 4GB | 20GB SSD | $0.0288 | $21.43" (table rows, fetch-tool summary, as read)
- source: https://www.koyeb.com/docs/reference/instances ; read 2026-10-09 once ; USD ; tax not stated
- strength: stated (docs page read once; the Eco blog and a search answer list the same Eco prices, so three sources agree on the Eco table)

### CNT30 Northflank: price detail (second read)
- finding: no platform fee for pay-as-you-go ("Self-service with minimal restrictions, no salesperson needed"); costs "Pro-rated to the second"; ingress free, egress $0.06/GB, SSD $0.15/GB/month; Sandbox tier is free but compute is "Limited".
- quote: "Self-service with minimal restrictions, no salesperson needed" ; "Pro-rated to the second" (verbatim, fetch-tool summary)
- source: https://northflank.com/pricing ; read 2026-10-09, second read agrees with the first on egress, disk and per-second billing
- strength: stated (2 reads)

### CNT31 Railway: usage metering, Sandboxes, run time (docs plans page one read; sandbox facts from a search answer)
- finding: container services are $10 per GB-month of memory and $20 per vCPU-month (per-second rates $0.00000386 and $0.00000772), "You are only charged for the resources you actually use"; Railway also sells Sandboxes (VMs) at "VM rates" of $50 per GB-month and $50 per vCPU-month, metered per second on CPU used, memory in use (OS and filesystem cache included) and outbound traffic; plans: Free $0 with $1 credit, Hobby $5/month (includes $5 usage, max 48 vCPU/48 GB per service, 6 replicas), Pro $20/month (includes $20, max 1,000 vCPU/1 TB, 42 replicas); egress $0.05/GB; no run-time limit mentioned on the plans page.
- quote: "charges follow measured CPU use, memory in use (including the operating system and filesystem cache), and outbound traffic" (verbatim from the docs summary for VMs)
- source: https://docs.railway.com/reference/pricing/plans ; https://railway.com/pricing (2 reads agree on container rates and plan fees) ; sandbox rates from a web search answer citing https://docs.railway.com/sandboxes and the pricing page (not opened) ; read 2026-10-09 ; USD
- strength: stated (container rates, 2 reads); sandbox rates one read via search answer; "container memory billed on use or allocation" not stated.
Arithmetic: container per vCPU-hour 0.00000772 x 3600 = $0.027792; per GB-hour 0.00000386 x 3600 = $0.013896. Full-use equivalents: S 2 x 0.027792 + 4 x 0.013896 = $0.1112/h; M 4 x 0.027792 + 8 x 0.013896 = $0.2223/h; L 0.111168 + 16 x 0.013896 = $0.3335/h. Sandbox/VM per vCPU-hour 50/720 = $0.06944 (the search answer gives $0.00001929 per second, 0.00001929 x 3600 = 0.06944); memory the same per GB-hour. Sandbox S with CPU quarter busy (0.5 vCPU used) and 4 GB in use: 0.5 x 0.06944 + 4 x 0.06944 = 0.0347 + 0.2778 = $0.3125/h; all CPU busy: 2 x 0.06944 + 0.2778 = $0.4167/h.

### CNT32 Render: compute plans (from a search answer; Render's own pages not readable)
- finding: Render renamed instance types to compute plans in August 2026; a search answer lists Pro 2 CPU/4 GB $85/month, Pro Plus 4 CPU/8 GB $175/month, Pro Max 4 CPU/16 GB $225/month, prorated by the second while running; cron jobs are hard-stopped after 12 hours with a $1/month minimum per cron service; Render Workflows tasks time out after 2 hours by default, up to 24 hours per task.
- quote: Render "renamed its instance types to compute plans in August 2026" (paraphrase of a search answer)
- source: web search 2026-10-09 whose results are render.com/docs/compute-plans, render.com/docs/cronjobs, render.com/docs/workflows-limits (pages not opened); render.com/pricing and render.com/docs/pricing could not be read (headings only; 404)
- strength: argued (one read via search answer; the answer itself says the pricing table is about 192 days old)
Arithmetic at a 720-hour month: Pro $85/720 = $0.1181/h; Pro Plus $175/720 = $0.2431/h; Pro Max $225/720 = $0.3125/h. Not a per-launch machine (always-on services and cron jobs); Workflows is the nearest launch-and-bill product.

### CNT33 Fargate: shell, retirement, longest task
- finding: ECS Exec gives a shell in a running Fargate container, run as root, through SSM Session Manager and `aws ecs execute-command`; it must be turned on when the task is launched (`--enable-execute-command` on run-task), needs a task IAM role with SSM permissions, and its session has a 20-minute idle timeout that cannot be changed. AWS retires platform revisions: standalone RunTask tasks are stopped on or after a retirement date given by notice, the default wait is 7 days (configurable to 14), and AWS does not start a replacement; no maximum task duration is stated on the pages read.
- quote: "When a user runs commands on a container using ECS Exec, these commands are run as the `root` user." ; "The ECS Exec session has an idle timeout time of 20 minutes. This value can't be changed." ; "No. AWS can't create a replacement task for standalone tasks which are started by `RunTask`" (verbatim)
- source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html ; https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-maintenance.html ; read 2026-10-09 once each
- strength: stated. Maximum task duration: not found on these two pages (the retirement page implies a task can be stopped after 7 days' notice, longer than the workload's 19 hours).

### CNT34 Azure Container Instances: billing, Spot, scale (FAQ page ms.date 2026-07-25, one read)
- finding: duration is billed "from the time that we start to pull your first container's image ... until the container group is stopped"; meters stop once the entire group is stopped; Spot containers are "billed for per-second memory/core usage", default Spot quota is 10 vCPU and 10 container groups, "up to 70% discounted"; ACI "runs on sets of Azure VMs"; there is no scaling, "use our API to automate and create more requests for container group creation"; port 22 is reserved by the service; maximum with big containers is 32 vCPU and 256 GB per standard group (the limits page says 31 and 240; the two Microsoft pages differ).
- quote: "Container group duration is calculated from the time that we start to pull your first container's image" (verbatim, first half of the sentence)
- source: https://learn.microsoft.com/en-us/azure/container-instances/container-instances-faq ; read 2026-10-09
- strength: stated. Shell (az container exec), start time, longest run: not found in the FAQ.

### CNT35 Daytona: SSH
- finding: SSH works with a token: `ssh <token>@ssh.app.daytona.io` or `daytona ssh <sandbox> --expires 60`; tokens expire after 60 minutes by default and can be revoked; the page does not say which user you log in as, or whether root and sudo exist.
- quote: tokens "expire automatically after 60 minutes by default" (paraphrase of the fetch summary)
- source: https://www.daytona.io/docs/en/ssh-access ; read 2026-10-09 once
- strength: stated; root: not found.

### CNT36 Northflank jobs
- finding: jobs run manually or on a cron schedule and take a time limit "(in seconds)" per run with no upper bound stated; resources can be chosen per run; the page does not describe an API or CLI trigger and does not cover billing of job runs.
- quote: a time limit "(in seconds)" for a run applies "whether it has failed or not" (paraphrase of the fetch summary)
- source: https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule ; read 2026-10-09 once
- strength: stated; maximum run time: not found (no upper bound stated); API/CLI: not found on that page (Northflank has an API and CLI according to the reader's memory; not read).

### CNT37 Render Workflows (first-party docs, one read): per-task prices
- finding: Workflows tasks time out after 2 hours by default, extendable to 24 hours per task; fixed plans are billed by the second at 2c-4g $0.40/h, 2c-8g $0.70/h, 4c-8g $1.00/h, 4c-16g $1.50/h, 8c-32g $2.50/h; the default `flex` plan (up to 1 CPU, 4 GB) is billed on actual use at $0.20 per CPU-hour and $0.05 per GB-hour; task state kept 30 days at $0.25 per GB-month; limits on new compute per minute (Hobby 16 CPU, Pro 32 CPU) and root run API requests (50/min Hobby, 1,500/min Pro).
- quote: "`4c-8g` $1.00/hour, `4c-16g` $1.50/hour" ; "Fixed plans are prorated by the second." (fetch-tool summary, verbatim-ish)
- source: https://render.com/docs/workflows-limits ; plans table https://render.com/docs/compute-plans (CPU/RAM only, no prices) ; read 2026-10-09 once ; USD
- strength: stated (one read)
Shapes on Workflows: S 2c-4g $0.40/h; M 4c-8g $1.00/h; L 4c-16g $1.50/h (exact matches). These are 3 to 6 times the Fargate figures; Workflows tasks are the launch-and-bill product, the monthly web-service plans ($85/$175/$225 from the search answer) are for always-on services.

### CNT38 Railway Sandboxes (docs.railway.com/sandboxes, one read)
- finding: Sandboxes are "isolated Linux VMs you create on demand, run commands in, and destroy" (microVM or container not stated), created with `railway sandbox create` or `Sandbox.create()` or the `sandboxCreate` mutation, destroyed with `railway sandbox destroy`; `railway sandbox ssh` gives a shell (root not stated); sizes: Free 2 vCPU/2 GB max, Hobby default 4/4 and max 8 vCPU/8 GB, Pro default 8/8 and max 32 vCPU/32 GB; an idle timeout destroys a sandbox (default 30 min on Hobby and Pro, 1 to 120 min or disabled; 5 min on Free); no maximum lifetime stated; no pause; outbound internet open through a NAT gateway; billed "at VM rates, metered per second, for CPU used, memory in use, and outbound traffic": $50 per GB-month, $50 per vCPU-month, $0.05/GB egress; checkpoints are disk snapshots (processes and memory do not carry over).
- quote: "bill at VM rates, metered per second, for CPU used, memory in use, and outbound traffic" (verbatim, fetch-tool summary)
- source: https://docs.railway.com/sandboxes ; read 2026-10-09 once ; USD
- strength: stated. Disk size: not found.
Shapes: S (2 vCPU, 4 GB) fits Hobby (max 8/8): $0.3125/h with 0.5 vCPU used and 4 GB in use, $0.4167/h with both vCPUs busy; M (4 vCPU, 8 GB) fits Hobby: 1 vCPU used + 8 GB in use = 9 x 0.06944 = $0.6250/h, all 4 busy + 8 GB = 12 x 0.06944 = $0.8333/h; L (16 GB) needs Pro (max 32): 1 vCPU + 16 GB = 17 x 0.06944 = $1.1806/h, 4 busy + 16 GB = 20 x 0.06944 = $1.3889/h. Memory dominates (memory in use counts page cache). All well above the yardstick. Argued from the stated rates and the stated metering.

### CNT39 Koyeb Sandboxes (from a search answer citing Koyeb pages; pages not opened)
- finding: Koyeb has "Koyeb Sandboxes", microVMs on bare metal, for CPU and GPU, reached by the Koyeb Python SDK, available on every pay-as-you-go plan, with a starting rate of $0.000001/second ($0.0036/h) equal to the smallest eco instance; the instance docs call instances Firecracker microVMs; the Koyeb pricing page notes that Koyeb is joining Mistral AI, so pricing may change; the eco-large per-second rate is $0.000008 ($0.0288/h), eco-xlarge $0.000016 ($0.0576/h), eco-2xlarge $0.000032 ($0.1152/h).
- quote: "starting at $0.000001/second ($0.0036/hr)" (verbatim, Koyeb Sandboxes blog via fetch summary)
- source: web search results listing koyeb.com/blog/koyeb-sandboxes-..., koyeb.com/docs/reference/instances, koyeb.com/docs/faqs/pricing (not opened) ; read 2026-10-09 ; USD
- strength: one read via search answer (the instance table itself was read once from the docs page, section above); eco vCPUs shared or dedicated: not confirmed.

### CNT40 Fly.io Sprites: sizes, lifetime, idle rule (from a search answer citing fly.io pages; pages not opened)
- finding: the search answer says Fly's Sprites page lets a run use "up to 8 CPUs and 16GB of RAM" with memory billed as used, that a Sprite is a Firecracker microVM with a 100 GB ext4 disk and no lifetime cap, that idle Sprites suspend (memory snapshotted) and wake in about a second, and that four things reset the idle timer (an in-flight HTTP or API request, stdout output of a session or exec'd process, an open TCP connection, or an active `sprite-env tasks` task, max 1 hour, renewable); for an agent that must stay connected Fly's own article suggests Machines instead; a Fly community post (about 259 days old) reports a user unable to get more than 8 GB.
- quote: "up to 8 CPUs and 16GB of RAM for any given run" (search-answer quote of Fly's page, so treat as paraphrase)
- source: web search 2026-10-09 (results fly.io/sprites/, fly.io/sprites/yolo-mode/, community.fly.io/t/more-ram-in-sprites/26921, fly.io/learn/claude-code-sandbox-cost/, fly.io/learn/fly-vs-cloudflare/) ; pages not opened
- strength: one read via search answer; Sprites docs page (read directly) confirms "dedicated microVM", "Per-second" billing and warm/cold sleep.

### CNT41 E2B: isolation and tools (search answer, pages not opened)
- finding: the answer says E2B's site states every sandbox runs on its own MicroVM runtime built on Firecracker with dedicated kernels, the CLI has `e2b sandbox connect <id>` (terminal attach, disconnect does not kill) and `e2b sandbox create <template>` (kills on exit), authentication is by E2B_API_KEY (access tokens stopped working on 2026-08-01), and E2B has a docs page for running Codex (e2b.dev/docs/agents/codex); ~150 ms start comes from a customer case study and third parties, not E2B's docs.
- quote: every sandbox runs on E2B's own MicroVM runtime "built on Firecracker with dedicated kernels" (paraphrase of a search answer)
- source: web search 2026-10-09 (results e2b.dev/docs/cli/connect-to-sandbox, e2b.dev/docs/agents/codex, e2b.dev/blog/firecracker-vs-qemu, e2b.dev/customers/how-manus-uses-e2b...) ; pages not opened
- strength: one read via search answer

### CNT42 Fargate: default vCPU quota (a quota that needs raising)
- finding: the default Fargate On-Demand vCPU quota is 6 vCPUs running at once per Region (and 6 for Spot), adjustable by request; new accounts "might have initial lower quotas that can increase over time"; launch rates are 100 burst and 20 per second sustained (500 per minute per service for service tasks); RunTask launches at most 10 tasks per call; a task definition holds at most 10 containers; ECS Exec allows 1,000 sessions per container.
- quote: "Fargate On-Demand vCPU resource count | Each supported Region: 6 | Yes" ; "New AWS accounts might have initial lower quotas that can increase over time." (table row and sentence, verbatim)
- source: https://docs.aws.amazon.com/general/latest/gr/ecs-service.html ; read 2026-10-09 once
- strength: stated

### CNT43 Fargate: second read of the on-demand rates
- finding: the pricing page's own worked examples repeat the per-second rates: x86 $0.000011244 per vCPU-second, $0.000001235 per GB-second, ephemeral storage $0.0000000308 per GB-second; ARM $0.0000089944 and $0.0000009889; "20 GB of ephemeral storage is available for all Fargate Tasks and Pods by default".
- quote: "20 GB of ephemeral storage is available for all Fargate Tasks and Pods by default" (verbatim)
- source: https://aws.amazon.com/fargate/pricing/ ; read 2026-10-09 (second read, different prompt) ; US East (N. Virginia)
- strength: stated, two reads agree (now confirmed)

### CNT44 Fargate Spot: a third-party page opened
- finding: an undated-in-body vantage.sh article (header date APR 21, 2021, says its Spot price is "at the time of this post (January 2024)") gives us-east-1 Spot $0.01246287 per vCPU-hour and $0.00136851 per GB-hour; a first search answer gave $0.0124419 and $0.00136621.
- quote: "The pricing at the time of this post (January 2024)" (verbatim, fetch summary of the article)
- source: https://www.vantage.sh/blog/fargate-pricing (third party) ; read 2026-10-09 ; USD
- strength: argued (third-party, 2024 figures; Spot rates move)

### CNT45 Cloud Run: second read of the price, and quotas
- finding: a second, differently worded web search gives the same Tier 1 numbers for instance-based (CPU always allocated) billing: $0.00001800 per vCPU-second and $0.00000200 per GiB-second, free 240,000 vCPU-seconds and 450,000 GiB-seconds a month, and says a 2024 third-party blog (hamy.xyz) reports the same; request-based $0.000024 and $0.0000025 is confirmed by a third-party page (cloudchipr.com, dated November 14, 2025: "on the order of $0.000024 per vCPU-second and $0.0000025 per GiB-second for active usage"). Quotas: CPU and memory allocation per project and region "Depends on selected region", increase "subject to review"; 10,000 tasks per job; 1,000 running job executions; 180 executions per 60 seconds.
- quote: "Cloud Quotas adjustment requests are subject to review." (verbatim, quotas page via the fetch-tool summary)
- source: web searches (2) whose results are cloud.google.com/run/pricing ; https://docs.cloud.google.com/run/quotas (1 read) ; https://cloudchipr.com/blog/cloud-run-pricing (third party) ; read 2026-10-09 ; USD ; Tier 1
- strength: two reads (search answers) of the official table for the instance-based rate; the official page itself still unread.

### CNT46 Azure Container Instances: shell
- finding: `az container exec --resource-group <g> --name <n> --exec-command "/bin/bash"` opens a shell as root in a running Linux container; it runs a single process and takes no arguments.
- quote: az container exec --resource-group myResourceGroup --name mynginx --exec-command "/bin/bash" (verbatim command from the page)
- source: https://learn.microsoft.com/en-us/azure/container-instances/container-instances-exec (ms.date 2025-11-17) ; read 2026-10-09 once
- strength: stated

### CNT47 Northflank: API
- finding: Northflank's API has endpoints to create, update, get and delete services and jobs and a "Run job" endpoint to start a run; a Northflank CLI and a JavaScript client exist; the page names no token or rate-limit details.
- quote: "Trigger a job run" with "a simple API call." (verbatim, fetch summary)
- source: https://northflank.com/docs/v1/api/introduction ; read 2026-10-09 once
- strength: stated; authentication and rate limits: not found on that page.

### CNT48 Daytona: auto-stop and VM sandboxes
- finding: container sandboxes auto-stop after 15 minutes of inactivity by default and "the auto-stop triggers even if there are internal processes running"; set the interval to 0 to disable; VM sandboxes (Linux VM and Windows) default to auto-pause after 60 minutes with auto-stop disabled, and pausing keeps memory and processes; pause is not supported for container sandboxes.
- quote: "VM sandboxes default to auto-pause with auto-stop disabled." ; container sandboxes "Pause is not supported." (verbatim, https://www.daytona.io/docs/en/persistence/) ; the 15-minute and "internal processes" wording come from a web-search answer citing Daytona's SDK reference (paraphrase)
- source: https://www.daytona.io/docs/en/persistence/ (1 read) ; web search answer citing daytona.io SDK pages (not opened) ; read 2026-10-09
- strength: stated (persistence page); one read via search (15-minute default). Maximum resources for VM sandboxes: not found. Whether the pricing-page rates apply to VM sandboxes: not stated.

### CNT49 Modal: runtimes and start time
- finding: gVisor is the default Sandbox runtime; `runtime="vm"` selects a full Linux VM (built on Cloud Hypervisor, per a search answer), with the same APIs, images and "usage-based pricing" (the article does not say the price is identical); Modal claims sub-second cold starts; the CPU soft limit is 16 physical cores above the request (search answer); no numeric maximum CPU or memory found; Linear is named as running coding sessions in VM Sandboxes.
- quote: "gVisor remains the default runtime" (paraphrase of the blog via fetch summary) ; "sub-second cold-starts" (blog)
- source: https://modal.com/blog/vm-sandboxes-agent-computers (1 read) ; web search answer citing modal.com/docs/guide/resources (not opened) ; https://modal.com/docs/reference/modal.Sandbox (1 read: `timeout` default 300 s, "Maximum lifetime of the sandbox in seconds.", no stated maximum on that page) ; read 2026-10-09
- strength: stated for the blog sentences; one read for the rest. Claude Code example page: "sandbox = modal.Sandbox.create(app=app, image=image)" with no timeout, CPU or memory argument (https://modal.com/docs/examples/sandbox_agent, 1 read) -- so that example uses the 5-minute default lifetime, not a long run.

### CNT50 E2B: running Codex
- finding: E2B documents running the Codex CLI in a sandbox: "provides a pre-built `codex` template with Codex already installed", created with `Sandbox.create('codex', ...)` or `e2b sbx create codex`, headless with `codex exec --full-auto`; "sandboxes can reach the internet by default" (page note); its cloned-repo example sets a 600-second timeout.
- quote: "provides a pre-built `codex` template with Codex already installed" (verbatim, fetch summary)
- source: https://docs.e2b.dev/agents/codex ; read 2026-10-09 once
- strength: shown (coding-agent CLIs are an intended use); the page states no maximum session length.

### CNT51 Vercel Sandbox: isolation, root, start, network (concepts page, last_updated 2026-08-25)
- finding: each sandbox "runs in its own Firecracker microVM with a dedicated kernel", boots in "Milliseconds", gives "full root access" (sudo), can make outbound HTTP requests by default (restrictable by a sandbox firewall policy), and can be driven by `sandbox create`, `sandbox exec --interactive --tty <name> -- bash` and `sandbox stop`; the docs also say sandboxes "are not designed to run continuously" and are not for "Permanent hosting".
- quote: "Provides full root access to install any package or binary" ; "Sandboxes are not designed to run continuously." (verbatim)
- source: https://vercel.com/docs/sandbox/concepts ; read 2026-10-09 once
- strength: stated

### CNT52 Koyeb: Eco instances and a banner
- finding: Eco instances are "Half the price of the original Instances for the same amount of RAM", have "half the cores" of Standard, use "eCPU" units, run on AMD EPYC Milan, have "limited local ephemeral storage", and (per that older blog) no scale-to-zero yet; the page does not say whether eCPUs are shared or dedicated. Koyeb's pricing page carries the banner "Koyeb is joining Mistral AI to Build The Future of AI Infrastructure." and lists sandbox use only in a footer blurb, no sandbox price; the Koyeb Sandboxes blog gives "starting at $0.000001/second ($0.0036/hr)" and Python and JavaScript SDKs, startup, limits and duration not stated.
- quote: "Half the price of the original Instances for the same amount of RAM." ; "Koyeb is joining Mistral AI to Build The Future of AI Infrastructure." (verbatim, fetch summaries)
- source: https://www.koyeb.com/blog/new-eco-instances-the-most-affordable-way-to-deploy-apps-globally ; https://www.koyeb.com/pricing ; https://www.koyeb.com/blog/koyeb-sandboxes-fast-scalable-fully-isolated-environments-for-ai-agents ; read 2026-10-09 once each
- strength: stated

### CNT53 Fly.io Sprites: second read of fly.io/sprites
- finding: the page lists plans with allowances ("Hero ($100/mo) includes 1,200 CPU-hours, 4,800 RAM GB-hours, and 150 GB of storage"; "Plans bundle an allowance of CPU-hours, RAM GB-hours, and storage GB, not unlimited usage"), so it disagrees with fly.io/pricing.md ("No plans and no tiers"); it works an example "A 4-hour coding session with bursts to 100% of 8 CPUs and 8 GB RAM, averaging 30% of 2 CPUs and 1.5 GB"; it says "Four things reset the idle timer: an in-flight HTTP/API request," (the other three come from the search answer: stdout output of a session or exec'd process, an open TCP connection, an active task), "Running → warm happens within seconds of the idle monitor seeing no activity", and "RAM is almost always the line that dominates".
- quote: "Hero ($100/mo) includes 1,200 CPU-hours, 4,800 RAM GB-hours, and 150 GB of storage;" (verbatim)
- source: https://fly.io/sprites ; read 2026-10-09 (second read) ; USD
- strength: stated (two reads agree on the rates; plans: contradiction between two Fly pages recorded)

### CNT54 A vendor article as a cross-check of the reader's arithmetic (Fly.io's own, so biased)
- finding: Fly.io's article prices a Claude Code or Codex session on 2 vCPU/4 GiB at 30% CPU and 1.5 GB resident: 4-hour totals E2B $0.66, Daytona $0.66, Modal $0.95, Vercel $0.65, Cloudflare standard-3 $0.48, Fly Sprites $0.23, i.e. per hour 0.165, 0.165, 0.2375, 0.1625, 0.12, 0.0575. My own per-hour S figures (E2B/Daytona 0.1656, Modal 0.2380, Vercel at 30% CPU 0.1616, Sprites 0.0559) agree with them.
- quote: "A four-hour Claude Code or Codex session in a cloud sandbox costs about $0.23 on Fly.io Sprites and $0.48 to $0.95 on Cloudflare Sandbox, Vercel Sandbox, E2B, Daytona and Modal Sandboxes." (verbatim)
- source: https://fly.io/learn/claude-code-sandbox-cost/ (vendor, checked by the author 2026-10-05) ; read 2026-10-09 once
- strength: argued (third-party arithmetic on published rates; the article's gap to others rests on its own 30% CPU and 1.5 GB assumptions)

### CNT55 Koyeb: pricing FAQ (second read of billing)
- finding: Koyeb bills compute per second as instances x seconds x the instance-size price, does not bill paused services, gives each organisation one free 0.1 vCPU / 512 MB service, lists 100 GB of free outbound bandwidth a month then $0.04/GB "not yet charged", says spending limits are "not yet available", and again does not say whether Eco vCPUs are shared or dedicated.
- quote: "We charge compute usage cost per second with the following formula:" ; "You will only be charged for unpaused Services." (verbatim, fetch summary)
- source: https://www.koyeb.com/docs/faqs/pricing ; read 2026-10-09 once ; USD
- strength: stated (billing, paused, free instance); not found (shared or dedicated; per-instance quota)

### CNT56 Fargate on-demand rates: third-party 2026 corroboration
- finding: a web search over third-party pages dated 2026 gives the same us-east-1 Linux/x86 on-demand rates ($0.04048 per vCPU-hour, $0.004445 per GB-hour), one of them saying they still held in June 2026, and a rounded Spot rate of $0.013 per vCPU-hour and $0.0014 per GB-hour (spot.io), close to the 2024 figures.
- quote: paraphrase of a search answer (no exact words)
- source: web search 2026-10-09, results vantage.sh, cloudchipr.com, spot.io (not opened beyond the vantage.sh article) ; USD ; us-east-1
- strength: argued (third-party)

### CNT57 Modal Sandbox resources page (second first-party read of the billing rule)
- finding: Modal's Sandbox resources page repeats the billing rule, "You pay for `max(request, actual)`", billed by the second; 1 core is 2 vCPU; a Sandbox's disk "cannot be increased" beyond the limits of other Modal containers; on the VM runtime the root file system is a fixed 512 GiB; and "Unlike CPU Sandboxes, GPU Sandboxes are subject to preemption", so CPU Sandboxes are not preempted (argued from that sentence). The page lists no CPU/memory maximum and no rates; it points to the pricing page.
- quote: "Modal Sandboxes are billed by the second based on whichever is higher:" your resource request or your actual usage. "You pay for `max(request, actual)`." (verbatim, fetch summary)
- source: https://modal.com/docs/guide/sandbox-resources ; read 2026-10-09 once ; no price on this page
- strength: stated (billing rule now read on two Modal pages); maximum CPU and memory per Sandbox: not found (3 Modal pages and 1 search)

### CNT58 Koyeb Sandboxes docs page
- finding: Koyeb's sandbox docs call sandboxes "ephemeral compute environments designed for isolated code execution", available on the Starter, Pro and Scale plans, driven by Python (sync and async) and JavaScript SDKs that launch instances, expose ports, run and terminate processes, reach the file system and clean up automatically; the page does not give sizes, timeouts or idle auto-delete, a shell, persistence or billing. An announcement page tried (koyeb.com/blog/koyeb-joins-mistral-ai) returned 404, so the effect of the Mistral AI move on the service is unread.
- quote: "ephemeral compute environments designed for isolated code execution on the Koyeb platform." (verbatim, fetch summary)
- source: https://www.koyeb.com/docs/sandboxes ; read 2026-10-09 once
- strength: stated; sizes, lifetime, shell, persistence and continuity of the service after the Mistral AI announcement: not found

### CNT59 Vercel Pro plan fee and included transfer
- finding: Pro is a $20/month platform fee with one deploying seat and $20/month of usage credit (extra seats $20/month each; viewers free; the credit expires monthly); prices are "in USD and exclude value-added tax"; Pro includes the lowest Flat Rate CDN tier with 1 TB of data transfer a month, which is what the Sandbox table's Pro cell "Included in Flat Rate CDN" refers to (argued from the two pages).
- quote: "$20/month Pro platform fee ... 1 deploying team seat included ... $20/month in usage credit" (the page's list, paraphrased from three bullets) ; "All prices shown are in USD and exclude value-added tax (VAT), goods and services tax (GST), and other applicable taxes." (verbatim)
- source: https://vercel.com/docs/plans/pro-plan (last_updated 2026-09-15) ; read 2026-10-09 once ; USD, excluding tax
- strength: stated

### CNT60 Fly.io disks
- finding: a Machine's root file system is ephemeral ("should only be used for temporary data"), can be enlarged with `fly machine update --rootfs-size <GB>` (default size not stated in current docs; old community posts say about 8 GB), and has an I/O cap of 2,000 IOPS and 8 MiB/s per a search answer; volumes are $0.15/GB-month, default 1 GB, maximum 500 GB, one volume per Machine, tied to one server in one region ("It is not network storage"), with daily block-level snapshots kept 5 days by default (1 to 60 configurable) and billed $0.08/GB-month after the first 10 GB.
- quote: "The maximum volume size is 500GB." ; "A Machine can only mount one volume at a time." ; "Each volume exists on one server in a single region. It is not network storage." (verbatim, https://docs.fly.io/volumes/overview)
- source: https://docs.fly.io/volumes/overview (1 read) ; web search answer citing fly.io docs and community.fly.io threads about rootfs (not opened) ; read 2026-10-09 ; USD
- strength: stated (volumes); one read via search (rootfs flag, I/O cap, 8 GB history)

### CNT61 Northflank, compute, disk and egress prices
- finding: The page gives $0.01667 per vCPU-hour, $0.00833 per GB-hour, SSD disk $0.15 per GB-month, egress $0.06 per GB; billed down to the second; the page states no minimum charge.
- checked: yes (two reads agree)
- quote: "$0.01667 / vCPU / hour" ; "$0.00833 / GB / hour" ; "$0.15 / GB / month" ; "$0.06 / GB" ; "Resources are billed by usage down to the second." (verbatim; same strings in both reads)
- arithmetic (not on the page): gate container 4 vCPU + 12 GB = 4 x 0.01667 + 12 x 0.00833 = $0.16664 per hour; waiting-agent container 1 vCPU + 4 GB = 0.01667 + 4 x 0.00833 = $0.04999 per hour
- source: https://northflank.com/pricing ; read 2026-10-09 ; USD ("You will be charged in US dollars"), section "Compute (Northflank Cloud)", no region stated on the lines, estimates "exclusive of VAT and GST" ; no date on the page

### CNT62 Northflank, plan fee, free allowance, billing minimum
- finding: No plan fee for pay-as-you-go ("Only pay for consumption"); a free Sandbox tier gives 2 free services, 1 free database and 2 free cron jobs ("Starts at $0/mo"); the page names no minimum charge and says charges are prorated to the second.
- checked: yes for the free tier and the per-second proration (two reads agree); one read for "Only pay for consumption"
- quote: "Only pay for consumption." ; "2x free services," "1x free database," "2x free cron jobs." ; "prorated to the second of usage" (verbatim; second read gave the same text plus "Always-on-compute - no sleeping")
- source: https://northflank.com/pricing ; read 2026-10-09 ; USD, excl. VAT/GST

### CNT63 Modal, Function and Sandbox compute rates
- finding: Functions $0.0000131 per core-second and $0.00000222 per GiB-second; Sandboxes $0.00003942 per core-second and $0.00000667 per GiB-second (about 3x the Function rates); a "core" is a physical core, 2 vCPU.
- checked: yes (two reads agree)
- quote: "CPU $0.0000131 0.0000131 / core / sec" ; "Memory $0.00000222 0.00000222 / GiB / sec" ; Sandbox: "$0.00003942 0.00003942 / core / sec" ; "$0.00000667 0.00000667 / GiB / sec" ; core: "Physical core (2 vCPU equivalent)" (verbatim)
- arithmetic (not on the page): Function, 1 vCPU = 0.5 core, 4 GiB, 3600 s: 0.5 x 0.0000131 x 3600 + 4 x 0.00000222 x 3600 = $0.02358 + $0.031968 = $0.0555 per hour; Sandbox, same shape: 0.5 x 0.00003942 x 3600 + 4 x 0.00000667 x 3600 = $0.07096 + $0.09605 = $0.1670 per hour (if CPU is billed at the reserved 0.5 core)
- source: https://modal.com/pricing ; read 2026-10-09 ; USD, no region on the lines, tax not stated ; no date on the page

### CNT64 Modal, free credit, plan fee, egress
- finding: Starter has no monthly fee and includes $30 of compute per month; Team is $250 plus compute; egress is $0.04 per GiB with 1 TiB per month free on Starter (10 TiB Team, 100 TiB Enterprise). The $0.04 per GiB egress figure matches the page; the free allowance is on the same page.
- checked: yes (two reads agree on $30 and on $0.04/GiB)
- quote: "Starter has no monthly fee and includes $30 of compute (GPUs, CPUs, Memory) per month." ; "Network Egress $0.04 0.04 / GiB" ; "1 TiB / month free network egress" (verbatim)
- source: https://modal.com/pricing ; read 2026-10-09 ; USD

### CNT65 Modal, Function timeout and preemption
- finding: A Modal Function has a default execution timeout of 300 seconds and can be given a timeout of 1 second to 24 hours, so a 19-hour subprocess fits inside one Function call; but Functions are preemptible by default (restarted on the same input), and the page says the likelihood rises with run duration; Sandboxes are not preempted unless they ask for a GPU.
- checked: yes for the timeout range (two reads of the timeouts guide give the same sentence; a search answer repeats it); preemption: yes (two reads of the preemption guide agree)
- quote: "users may specify timeout durations between 1 second and 24 hours" ; "All Modal Functions are subject to preemption by default." ; "Modal Sandboxes are not subject to preemption, except in the case where a `gpu` requirement is specified." (verbatim)
- source: https://modal.com/docs/guide/timeouts and https://modal.com/docs/guide/preemption ; read 2026-10-09

### CNT66 Hetzner Cloud CCX23, price on Hetzner's price-adjustment page
- finding: On Hetzner's own page the CCX23 (Germany FSN/NBG and Finland HEL) costs EUR 0.1378 per hour (EUR 85.99 per month) and USD 0.1626 per hour (USD 101.49 per month) from 15 June 2026; a figure of $0.1541 an hour, given for it in an earlier comparison that had not been checked against the page, matches neither column, nor any other CCX23 number on the page.
- checked: yes (three reads agree)
- quote: header cells "Old price excl. IPv4 in EUR (hourly/monthly)", "New price excl. IPv4 in EUR ...", "Old price excl. IPv4 in $ ...", "New price excl. IPv4 in $ ..." ; CCX23 row: "0.0505 / 31.49 | 0.1378 / 85.99 | 0.0593 / 36.99 | 0.1626 / 101.49" (paraphrase of the table layout; numbers as given)
- arithmetic: the last two columns are the dollar columns (the page's headers say "in $"). 0.1541 / 0.1378 = 1.118 (the figure equals the euro price at an exchange rate of 1.118, which suggests a currency conversion by a comparison site, not a Hetzner price); 0.1541 / 0.1626 = 0.948. The old (pre-June) dollar price was 0.0593, so it is not the old price either.
- source: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ ; page says new prices apply from "15 June 2026; 8 AM CEST" ; read 2026-10-09 ; EUR and USD columns, excl. VAT, excl. IPv4

### CNT67 Koyeb Eco instances, prices
- finding: eco-large (2 vCPU, 4 GB) is $0.0288 per hour, eco-xlarge (4 vCPU, 8 GB) $0.0576 per hour, eco-2xlarge (8 vCPU, 16 GB) $0.1152 per hour; per second $0.000008, $0.000016, $0.000032; the instance page does not say whether the vCPU is shared or dedicated.
- checked: yes (two reads agree on the per-hour prices; per-second prices one read)
- quote: table rows "eco-large | 2 | 4GB | 20GB SSD | $0.000008 | $0.0288 | $21.43" ; "eco-xlarge | 4 | 8GB | 20GB SSD | $0.000016 | $0.0576 | $42.85" ; "eco-2xlarge | 8 | 16GB | 20GB SSD | $0.000032 | $0.1152 | $85.71" (paraphrase of the table layout)
- arithmetic: 0.000016 x 3600 = 0.0576 (the per-second and per-hour columns agree)
- source: https://www.koyeb.com/docs/reference/instances ; read 2026-10-09 ; USD, tax not stated

### CNT68 Koyeb, billing, plan fee, Mistral AI
- finding: Billing is per second ("Processing is accounted per second and billing is rounded up to the nearest unit"); Pro is $29 per month plus compute with $10 of compute included; Koyeb announced on 17 February 2026 that it is joining Mistral AI; existing plans are unchanged, the Starter plan "will soon be removed" for new users, and completion of the deal is "subject to closing conditions".
- checked: yes (the blog post was read twice with different questions and both reads agree; the $29 Pro price appears on the pricing page and in the pricing FAQ; the pricing-page banner was one read)
- quote: "If you have an existing organization on an existing plan, nothing will change for you." ; "Koyeb will continue to operate without disruption and will gradually transition to become a core part of Mistral Compute." ; "The Starter plan will soon be removed and new users will instead need to subscribe to the Pro, Scale, or Enterprise plan." (verbatim) ; pricing-page banner "Koyeb is joining Mistral AI to Build The Future of AI Infrastructure." (verbatim)
- source: https://www.koyeb.com/pricing and https://www.koyeb.com/blog/koyeb-is-joining-mistral-ai-to-build-the-future-of-ai-infrastructure (dated February 17, 2026) ; read 2026-10-09 ; USD

### CNT69 AWS Fargate on-demand, Linux x86, US East (N. Virginia)
- finding: $0.000011244 per vCPU-second and $0.000001235 per GB-second, one-minute minimum, per second billing. AWS's published price list gives the same in hours: $0.04048 per vCPU-hour and $0.004445 per GB-hour.
- checked: yes (two reads of the pricing page agree; the price-list file agrees)
- quote: "CPU cost: $0.000011244 per vCPU second, memory cost: $0.000001235 per GB per second" (Example 1, Linux/x86, "based on price in US East (N. Virginia)") ; "Pricing is calculated per second with a 1-minute minimum." ; price list rows: USE1-Fargate-vCPU-Hours:perCPU 0.0404800000 USD hours (SKU 8CESGAFWKAJ98PME), USE1-Fargate-GB-Hours 0.0044450000 USD hours (SKU PBZNQUSEXZUC34C9)
- arithmetic: 0.04048 / 3600 = 0.0000112444 per second; 0.004445 / 3600 = 0.0000012347 per second. The rate table cells on the page itself came back empty from the fetch; the rates above are from the page's worked examples and from AWS's price-list file.
- source: https://aws.amazon.com/fargate/pricing/ (page shows no price date, only "(c) 2026, Amazon Web Services") and https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/us-east-1/index.csv (price list version 20260911124425, published 2026-09-11T12:44:25Z) ; read 2026-10-09 ; USD, region us-east-1, tax not included

### CNT70 AWS Fargate Spot, Linux x86, US East (N. Virginia)
- finding: AWS's own Spot rates could NOT be read. The pricing page gives only "up to a 70% discount" (two reads agree); its rate table cells come back empty, and AWS's price-list file for ECS (version 20260911124425) showed on-demand, ARM and Windows Fargate rows but no row containing the word "Spot" in the four chunks scanned. Third-party snapshots exist but are not AWS's.
- checked: unchecked for the dollar rate (search answer, third-party copy); yes (two reads) for the "up to 70%" wording
- quote: "Fargate Spot allows customers to run interrupt-tolerant Amazon ECS Tasks* on spare capacity at up to a 70% discount" (verbatim, as returned) ; second read: Spot "at up to a 70% discount off the regular Fargate price"
- arithmetic: 70% off the on-demand $0.04048 per vCPU-hour = $0.012144; 70% off $0.004445 per GB-hour = $0.0013335. Third-party snapshots (NOT AWS): Vantage January 2024 $0.01246287 per vCPU-hour and $0.00136851 per GB-hour (69.2% off); Cloudchipr 2025 about $0.0124419 and $0.00136621 (search answer). AWS's ECS pricing page (read, see the entry below) says Spot prices "fluctuate based on available capacity", so a single Spot figure would also be a moving one.
- source: https://aws.amazon.com/fargate/pricing/ ; read 2026-10-09 ; USD, US East (N. Virginia)

### CNT71 AWS Fargate ARM on-demand (extra, from the price list)
- finding: The price list gives Linux ARM at $0.03238 per vCPU-hour and $0.00356 per GB-hour; the pricing page's Example 2 gives $0.0000089944 per vCPU-second and $0.0000009889 per GB-second, which times 3600 is $0.032380 and $0.003560. They agree.
- checked: yes (page example and price-list file agree)
- quote: price-list rows "AWS Fargate - ARM - vCPU - US East (N. Virginia)","2026-07-01",... "0.0323800000","USD" ... "USE1-Fargate-ARM-vCPU-Hours:perCPU" ; "AWS Fargate - ARM - Memory ..." "0.0035600000" ... "USE1-Fargate-ARM-GB-Hours" (verbatim; the price-list row carries effective date 2026-07-01)
- source: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/us-east-1/index.csv and https://aws.amazon.com/fargate/pricing/ ; read 2026-10-09 ; USD, us-east-1

### CNT72 AWS Fargate, agent-shaped use (start with a command, stream output, read exit code)
- finding: Yes. RunTask accepts a per-container command override; stdout and stderr go to CloudWatch Logs through the awslogs driver; the container's exit code is in the task description; ECS Exec runs a command or shell in a running Fargate container.
- checked: yes (AWS docs read directly, four pages)
- quote: "The command to send to the container that overrides the default command from the Docker image or the task definition." (ContainerOverride.command) ; "The exit code returned from the container." (Container.exitCode) ; "By default, the logs that are captured show the command output ... which are the STDOUT and STDERR I/O streams." ; "You can use ECS Exec to run commands in or get a shell to a container running on an Amazon EC2 instance or on AWS Fargate." ; "The ECS Exec session has an idle timeout time of 20 minutes. This value can't be changed."
- source: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerOverride.html , .../API_Container.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html , .../ecs-exec.html ; read 2026-10-09

### CNT73 Google Cloud Run, instance-based rates (pricing page unreadable)
- finding: cloud.google.com/run/pricing cannot be read through the fetch tool: four fetches returned only the title and a truncation notice ("this page's text is 73 characters long"), and the Wayback Machine is blocked. Google's own committed-use-discount docs page states the on-demand instance-based rates in us-central1 as $0.000018 per vCPU-second and $0.000002 per GiB-second.
- checked: pricing page: page unreadable. Rates: yes (two reads of Google's docs page https://docs.cloud.google.com/run/cud agree; it is a docs page about discounts, not the pricing page)
- quote: "$0.000018 per vCPU-second ($0.0648 per hour)" ; "$0.000002 per GiB-second for memory ($0.0072 per hour)" ; introduced by "While the on-demand (non-commitment) rate for the same is higher:" ; 3-year committed: "$0.00000972 per vCPU-second ($0.035 per hour)" and "$0.00000108 per GiB-second" ; "28% discount" one year, "46% discount" three years ; "using one vCPU and one GiB in us-central1 (Tier 1 region)" (verbatim as returned)
- arithmetic: 0.000018 x 3600 = 0.0648 ; 0.000002 x 3600 = 0.0072 ; 0.000018 x 0.54 = 0.00000972 and 0.000002 x 0.54 = 0.00000108 (46% off). A search answer on the pricing page (an index copy about 444 days old) also gave $0.000018 / $0.000002, a free tier of 240,000 vCPU-seconds and 450,000 GiB-seconds per month, and a one-minute minimum for instance-based billing: unchecked.
- source: https://docs.cloud.google.com/run/cud ; read 2026-10-09 ; USD, us-central1 (Tier 1), tax not stated ; the pricing page https://cloud.google.com/run/pricing is unreadable

### CNT74 Google Cloud Run jobs, limits
- finding: A Cloud Run job task can run up to 168 hours (7 days) (default 10 minutes; 1 hour if it uses a GPU); a job task can have up to 8 vCPU and 32 GiB; a request to a service can take at most 60 minutes. A 4 vCPU / 12 GiB container and a 1 vCPU / 4 GiB container are both allowed combinations.
- checked: yes (timeout: two pages agree; memory 32 GiB: two pages agree; CPU 8: two pages agree)
- quote: "By default, each task runs for a maximum of 10 minutes" ; "a longer time up to 168 hours (7 days)" ; "the maximum available timeout is 1 hour" (GPU) ; quotas page "Maximum tasks timeout value | 168 hours (7 days), or 1 hour if using GPUs" ; "The maximum amount of memory you can configure is 32 gibibyte (32 Gi)." ; "The maximum amount of vCPU you can configure is 8 vCPU." ; table "4 vCPU: 2 to 16 GiB", "1 vCPU: 512 MiB to 4 GiB" (verbatim as returned)
- source: https://docs.cloud.google.com/run/docs/configuring/task-timeout , https://docs.cloud.google.com/run/quotas , https://docs.cloud.google.com/run/docs/configuring/jobs/memory-limits , https://docs.cloud.google.com/run/docs/configuring/jobs/cpu ; read 2026-10-09

### CNT75 Google Cloud Run jobs, agent-shaped use
- finding: Partly. `gcloud run jobs execute JOB --args ... --wait` starts an execution with overridden arguments and waits; logs go to Cloud Logging and `gcloud beta run jobs execute JOB --tail` streams them; the execute page covers argument overrides only (it does not mention overriding the command) and does not say an exit code is returned, only that "all tasks must run to completion successfully in order for the job execution to be successful".
- checked: one read of the execute page; the create-jobs page was also read and does not state an exit-code rule either, only "If any tasks failed, the job execution is marked as failed after Cloud Run has tried all of the tasks."
- quote: "You can override the arguments, environment variables, number of tasks, and task timeout configured for a job" ; "Job executions write logs to Cloud Logging" ; "all tasks must run to completion successfully in order for the job execution to be successful" (verbatim as returned)
- source: https://docs.cloud.google.com/run/docs/execute/jobs ; read 2026-10-09

### CNT76 AWS, price-list effective date and Spot wording on the ECS pricing page
- finding: The two Linux x86 on-demand rows in AWS's price-list file (vCPU and GB) both carry EffectiveDate 2026-07-01 and the values 0.0404800000 and 0.0044450000 USD per hour (so the per-second rates above were current on that date). AWS's ECS pricing page says Spot prices "fluctuate based on available capacity" and sends the reader to the Fargate pricing page for current Spot prices.
- checked: price-list rows: yes (two reads agree on value and date); ECS pricing page wording: one read
- quote: "Fargate Spot prices fluctuate based on available capacity." ; "Current spot prices by region are available on the AWS Fargate pricing page." ; "Fargate Spot uses spare Fargate capacity and can be interrupted with a 2-minute warning when AWS needs the capacity back." ; "A minimum charge of one minute applies." (verbatim as returned)
- source: https://aws.amazon.com/ecs/pricing/ and the price-list CSV (version 20260911124425, published 2026-09-11) ; read 2026-10-09 ; USD, US East (N. Virginia)

### CNT77 Modal, Sandbox lifetime
- finding: A Sandbox has a default maximum lifetime of 5 minutes and a `timeout` of up to 24 hours; beyond 24 hours the docs advise Filesystem Snapshots. A 19-hour agent fits; a 24-hour session is at the limit.
- checked: yes (two reads of the Sandbox guide agree; the reference page confirms the default of 300 seconds and states no maximum)
- quote: "Sandboxes have a default maximum lifetime of 5 minutes." ; "You can change this by passing a `timeout` of up to 24 hours to the `Sandbox.create(...)` function." ; "If you need a Sandbox to run for more than 24 hours, we recommend using Filesystem Snapshots to preserve its state" (verbatim)
- source: https://modal.com/docs/guide/sandbox and https://modal.com/docs/reference/modal.Sandbox ; read 2026-10-09

### CNT78 Northflank, job time limit and longest run
- finding: Northflank documents a per-job "time limit" (API field activeDeadlineSeconds, integer or null, minimum 1) and states no maximum and no default; a 2021 changelog entry says jobs have "Unlimited execution time". So a 20-hour job is not ruled out by any page read, and no page confirms it. For services and sandboxes the pages read mention no runtime limit.
- checked: one read per page (docs page, API reference, changelog); the absence of a stated maximum is not proof that none exists
- quote: "You can specify (in seconds) the maximum amount of time for a job to run, whether it has failed or not." ; API: "The maximum amount of time, in seconds, for a job to run before it is marked as failed." (Type integer | null, Minimum 1) ; changelog dated 13 September 2021: "Unlimited execution time billed by the second of execution" (verbatim as returned)
- source: https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule , https://northflank.com/docs/v1/api/project/jobs/create-cron-job , https://northflank.com/changelog/dynamic-runtime-configuration-for-jobs-improvements-to-api-addons-and-templates ; read 2026-10-09

### CNT79 Northflank, shell or exec into a running container, and agent-shaped use
- finding: Yes. `northflank exec service|job` opens a shell, or runs one command with `--cmd`; the JavaScript client streams stdout and stderr and returns exitCode and status; a manual job run can be started with a custom command. The exec page warns that when stdout is not a TTY (CI, automation harnesses, coding agents) the remote command's output can be silently discarded, and suggests a pseudo-TTY via script(1).
- checked: yes (two reads of the exec page agree on the warning and on exitCode)
- quote: "start a shell session directly in your container, similar to an SSH connection." ; `northflank exec service|job --cmd "ls -lah"` ; "When stdout is not a TTY - for example in CI pipelines, automation harnesses, coding agents" ... "the remote command's stdout and stderr can be silently discarded." ; "This will return a command result with `exitCode` and `status`" ; job runs: "You can configure the entrypoint, set a custom command, or select a process to run for" (verbatim as returned)
- source: https://northflank.com/docs/v1/api/execute-command , https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule , https://northflank.com/docs/v1/application/sandboxes/sandboxes-on-northflank ; read 2026-10-09

### CNT80 Koyeb, CPU shared or dedicated for Eco
- finding: Not stated. The instances page, the pricing page, the pricing FAQ and the Eco launch post (12 December 2023) do not say whether Eco vCPUs are shared or dedicated. The general FAQ describes paid containers as getting "a share of CPU with at least 0.25 dedicated vCPU per GB of memory" that can burst, without naming Eco; the launch post says Eco is "Designed for development and non-production environments" and that Standard gets "double the number of cores".
- checked: page does not say (five pages read; the pricing page was read again for the words "shared" and "dedicated" and has neither next to any instance type)
- quote: "Paid containers receive a share of CPU with at least 0.25 dedicated vCPU per GB of memory" ; "can burst to full speed with all the cores exposed to the container." ; "Designed for development and non-production environments." ; "Backed by AMD EPYC Milan processors." (verbatim as returned)
- arithmetic: if the 0.25-per-GB floor applied to Eco, eco-xlarge (8 GB) would have 2 dedicated vCPU of 4, and eco-2xlarge (16 GB) 4 of 8; the pages do not say it applies.
- source: https://www.koyeb.com/docs/faqs/general , https://www.koyeb.com/blog/new-eco-instances-the-most-affordable-way-to-deploy-apps-globally , https://www.koyeb.com/docs/reference/instances ; read 2026-10-09

### CNT81 Koyeb, agent-shaped use
- finding: Yes, through Koyeb Sandboxes, which the docs call "currently in public preview": `sandbox.exec(...)` returns the result with `exit_code`, `on_stdout`/`on_stderr` callbacks stream output, and `koyeb sandbox run --stream` exists (the CLI flag is from a search answer). The run-commands page states no maximum runtime; the lifecycle page mentions auto-deletion of between 60 seconds and 24 hours after scale-to-zero, not a maximum run time.
- checked: one read (run-commands page); CLI flag unchecked (search answer)
- quote: "Koyeb Sandboxes are currently in public preview." ; `print(f"\nExit code: {result.exit_code}")` ; "auto-deletion can be configured with a minimum delay of 60 seconds and a maximum of 24 hours" (verbatim as returned)
- source: https://www.koyeb.com/docs/sandboxes/sandbox-run-commands and https://www.koyeb.com/docs/sandboxes/sandbox-lifecycle ; read 2026-10-09

### CNT82 Hetzner Cloud, billing rule and agent-shaped use
- finding: Servers are billed per hour up to a monthly cap, and the IPv4 address is a separate charge: Hetzner's IP pricing page lists a Cloud Primary IPv4 at "EUR 0.50 (USD 0.60) monthly" (page last changed 2023-04-13, no hourly price, one read; 0.60 / 730 = about USD 0.0008 per hour). Hetzner is a virtual-machine provider: the documented way to run a command at creation is cloud-init user data (32 KiB limit); no container or exec API was found.
- checked: billing rule: one read; user data: one read of the docs page plus a search answer; the absence of an exec API: unchecked
- quote: "Servers have both a monthly price cap and a price per hour." ; "Your server's bill will never exceed its monthly price cap." ; "Primary IPs are now a separate feature with a fixed price that is billed separately from cloud servers." ; "Please note that this field is limited to 32KiB." (verbatim as returned)
- source: https://docs.hetzner.com/cloud/billing/faq/ , https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/ ; read 2026-10-09 ; the price-adjustment page's CCX23 numbers were read three times and agree; its metadata says created 2026-06-15, last change 2026-07-08; "Orders placed before 15 June 2026 but delivered after it: the previous prices apply."; the number 0.1541 does not appear on the page.

### CNT83 Google Cloud Run, jobs are always instance-based
- finding: Cloud Run jobs are always billed with instance-based billing, so the instance-based rates are the ones that apply to a job; the billing-settings page names no minimum billing duration.
- checked: one read
- quote: "Unlike Cloud Run services, all Cloud Run jobs have instance-based billing." ; "If you choose instance-based billing, you are charged for the entire lifecycle of the instance." (verbatim as returned)
- source: https://docs.cloud.google.com/run/docs/configuring/billing-settings ; read 2026-10-09

### CNT84 Northflank, predefined plans cross-check and shared or dedicated CPU
- finding: Northflank's predefined plan table equals the per-unit rates: nf-compute-100-4 (1 vCPU, 4096 MB) $0.0500 per hour, nf-compute-400 (4 vCPU, 8192 MB) $0.1333, nf-compute-400-16 (4 vCPU, 16384 MB) $0.2000. Plans from 1 vCPU up are labelled "dedicated"; the three smallest (0.1, 0.2, 0.5 vCPU) are labelled "shared". No predefined plan has 4 vCPU and 12 GB; the formula gives $0.16664 per hour for that shape (custom plans exist per a search answer, unchecked).
- checked: one read of the plan table (the per-unit prices behind it have two reads); the plan prices reproduce from the rates
- quote: "nf-compute-100-4 | 1 | 4096 MB | $36.00 | $0.0500 | dedicated" ; "nf-compute-400-16 | 4 | 16384 MB | $144.00 | $0.2000 | dedicated" ; "nf-compute-10 | 0.1 | 256 MB | $2.70 | $0.0038 | shared" (paraphrase of the table layout; numbers as given)
- source: https://northflank.com/pricing ; read 2026-10-09 ; USD, excl. VAT/GST

### CNT85 Hetzner product page, CCX availability (flag, probably a page artefact)
- finding: Hetzner's general-purpose product page, as fetched, shows the CCX23 spec (4 dedicated AMD vCPU, 16 GB RAM, 160 GB NVMe, 20 TB traffic in EU, 2 TB each in US and Singapore) but no price numbers, and each of the six CCX types carries the text "This product is currently unavailable. Please check back later." The price fields were also blank, so this may be the page's no-script fallback and not a real stock-out.
- checked: two reads agree on the text; its meaning is unchecked
- quote: "This product is currently unavailable. Please check back later." ; "Dedicated vCPUs: 4 (AMD)" ; "RAM: 16 GB" ; "SSD: 160 GB NVMe" (verbatim as returned)
- source: https://www.hetzner.com/cloud/general-purpose/ ; read 2026-10-09

### CNT86 AWS Fargate Spot, third and fourth reads of the pricing page
- finding: The Spot table on aws.amazon.com/fargate/pricing/ has the row labels "Spot Linux/X86" and "Spot Linux/ARM" but a blank body in every read (English twice more, Japanese once). The page says Spot prices "adjust gradually based on long-term supply and demand" and that "You pay the Spot price in effect while your tasks run."
- checked: page unreadable for the Spot rates (blank table body in four reads)
- quote: "Fargate Spot for Amazon ECS is currently only available for Linux Operating System and x86 /ARM CPU Architecture." (verbatim as returned)
- source: https://aws.amazon.com/fargate/pricing/ and https://aws.amazon.com/jp/fargate/pricing/ ; read 2026-10-09 ; USD

### CNT87 Koyeb Eco, cross-checks of the instance prices
- finding: Two other Koyeb pages agree with the instances table: the pricing FAQ says Eco instances "allow you to deploy for as little as $1.61 a month in select regions" (eco-nano is $1.61 per month in the table) and the December 2023 launch post gives Eco eSmall "$5.36 per month" and "$0.000002 per second" (eco-small is $0.000002 per second and $5.36 per month in the table). The Eco regions listed are now Washington D.C., Frankfurt and Singapore (the launch post said Frankfurt and Washington D.C. only).
- checked: yes (three pages agree)
- quote: "allow you to deploy for as little as $1.61 a month in select regions." ; "costs $5.36 per month" (verbatim as returned)
- source: https://www.koyeb.com/docs/faqs/pricing , https://www.koyeb.com/blog/new-eco-instances-the-most-affordable-way-to-deploy-apps-globally , https://www.koyeb.com/docs/reference/instances ; read 2026-10-09 ; USD

### CNT88 Vercel Sandbox: Active CPU rate and what "active" means
- finding: Active CPU is $0.128 per hour on Pro and Enterprise (default region iad1), and time waiting on network or model calls is NOT counted.
- checked: yes (two reads agree; the tool returned the page text itself both times)
- quote: "Sandbox Active CPU | 5 hours/month | $0.128/hour | $0.128/hour" (Hobby | Pro | Enterprise) ; "Time spent waiting for I/O (such as network requests, database queries, or AI model calls) does not count toward Active CPU." (verbatim)
- source: https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD, region iad1, tax not stated (assume excluded)

### CNT89 Vercel Sandbox: Active CPU definition (exact words)
- finding: "Active CPU" is the time the code actively uses the CPU, in hours; I/O wait does not count; the page's own cost examples assume 10% CPU use while "waiting for LLM calls".
- checked: yes (two reads agree)
- quote: "The amount of time your code actively uses the CPU, measured in hours. Time spent waiting for I/O (such as network requests, database queries, or AI model calls) does not count toward Active CPU." (verbatim)
- source: https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD, iad1

### CNT90 Vercel Sandbox: provisioned memory rate and the memory-per-vCPU rule
- finding: Provisioned memory is $0.0212 per GB-hour, memory is fixed at 2 GB per vCPU, billed for the time the sandbox runs in 1-minute minimum increments.
- checked: yes (two reads agree)
- quote: "Sandbox Provisioned Memory | 420 GB-hours/month | $0.0212/GB-hour | $0.0212/GB-hour" ; "Each vCPU includes 2 GB of memory. Provisioned memory is billed in 1 minute minimum increments" (verbatim)
- source: https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD, iad1

### CNT91 Vercel Sandbox: plan limits (size, session, concurrency)
- finding: Pro maximum is 8 vCPU and 16 GB with 64 GB disk and 24-hour sessions; Hobby is 4 vCPU, 8 GB and 45-minute sessions; Enterprise is 32 vCPU, 64 GB.
- checked: yes (two reads agree)
- quote: "Pro | 8 | 16GB | 15 | 64 GB" (plan, max vCPUs, max memory, open ports, disk) ; "Max Session Duration | 45 minutes | 24 hours | 24 hours" (verbatim)
- source: https://vercel.com/docs/sandbox/pricing ; https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours ; read 2026-10-09 ; USD

### CNT92 Vercel Sandbox: Pro $20 credit
- finding: Sandbox usage on Pro is charged against the Pro plan's $20 per month credit, then billed at the listed rates.
- checked: yes (pricing page three identical reads + the Pro plan page, see the entry 'Pro $20 credit (second read, Pro plan page)' below)
- quote: "All Sandbox usage on Pro plans is charged against your $20/month credit. After the credit is exhausted, usage is billed at the rates shown above." (verbatim)
- source: https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD

### CNT93 Vercel Sandbox: stop, resume, and cost while stopped
- finding: Persistent sandboxes are the default; stopping snapshots the filesystem (not running processes), a call to a stopped sandbox starts a new session from that snapshot with a fresh session timeout, and while stopped only Snapshot Storage ($0.08/GB-month on Pro) accrues.
- checked: yes for the quotes (pricing page twice; persistence page once)
- quote: "When you stop a persistent sandbox, the SDK automatically snapshots the filesystem. When you resume it, a new session boots from that snapshot with a fresh session timeout." and "The limit resets every time a sandbox stops and resumes, so the total lifetime of a persistent sandbox is effectively unbounded." (verbatim) ; "Each automatic snapshot consumes Snapshot Storage, which is billed separately from compute." (verbatim)
- source: https://vercel.com/docs/sandbox/concepts/persistent-sandboxes (last_updated 2026-09-15 in front matter) ; https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD

### CNT94 Herdr plugin: the changelog entry and docs page exist
- finding: Vercel's changelog "Give every agent in Herdr its own Vercel Sandbox" (published August 6, 2026 per the page) and the docs page vercel.com/docs/sandbox/ecosystem/herdr (front matter `last_updated: 2026-08-10`) exist and describe a plugin for Claude Code, Codex and OpenCode, one Vercel Sandbox per agent.
- checked: yes (changelog summary, docs page text, a search-tool answer and the repo README all agree; the date August 6, 2026 comes from the changelog summary and is repeated by the search answer)
- quote: "Terminal coding agents (Claude Code, Codex, and OpenCode) can each run in their own isolated Vercel Sandbox, managed from Herdr" (paraphrase of the changelog by the fetch tool; the fetch tool would not quote the whole entry). Docs page, verbatim: "The Vercel plugin runs each agent in its own persistent Vercel Sandbox: the pane becomes a live terminal into the sandbox, and the agent's changes come back as a Git patch you review and apply locally."
- source: https://vercel.com/changelog/give-every-agent-in-herdr-its-own-vercel-sandbox ; https://vercel.com/docs/sandbox/ecosystem/herdr ; read 2026-10-09 ; no price figure

### CNT95 Herdr plugin: what it does and how an agent is started
- finding: It is a Herdr plugin (id `vercel.sandbox`, manifest `herdr-plugin.toml`, version 0.6.0) that drives the local Vercel CLI: Start creates one named persistent sandbox per Herdr pane (`sandbox create --name`), uploads a filtered copy of the Git worktree, installs the chosen agent CLI, and attaches the pane to it with `vercel sandbox exec --interactive`.
- checked: yes (README in the repo and the Vercel docs page agree; manifest read directly)
- quote: "The agent pane is a local terminal connected through `vercel sandbox exec --interactive` to a coding-agent CLI running inside an isolated Linux Sandbox. Your keystrokes go into the Sandbox and the agent's terminal output comes back into the Herdr pane." (verbatim, README)
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin (README.md, herdr-plugin.toml) ; https://vercel.com/docs/sandbox/ecosystem/herdr ; read 2026-10-09 ; no price figure

### CNT96 Herdr plugin: what it needs
- finding: A local Herdr 0.7.5+, macOS or Linux, Node.js 20+, Git, the Vercel CLI logged in (`vercel login`, `vercel link`) to a Vercel account with a team and project; no token is put in the plugin's config; a Pro or Enterprise plan is needed only for sessions longer than 45 minutes.
- checked: yes (README and docs page agree except for one number, below)
- quote: "A Vercel account with access to the team and project that should own the Sandbox" and "Do not put tokens in this file. Agent authentication happens inside its persistent Sandbox; this plugin does not copy coding-agent credentials from the host." (verbatim, README) ; docs page: "The example config sets a one-hour `timeout`, which requires a Pro or Enterprise plan. On Hobby, set `timeout` to `45m` or less."
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin ; https://vercel.com/docs/sandbox/ecosystem/herdr ; read 2026-10-09

### CNT97 Herdr plugin: where the agent's files live, and can the agent be reached from a Herdr pane
- finding: The files live in the Vercel Sandbox's own filesystem (a persistent microVM; workspace under /vercel/sandbox); the local worktree is only uploaded once as a filtered snapshot ("not a live filesystem mount"), and results come back as a Git patch the user applies with "Apply Sandbox changes locally". The agent IS reachable from a Herdr pane, because the pane is a TTY attached to it.
- checked: yes (README, manifest and docs page agree)
- quote: "The initial upload is a filtered snapshot, not a live filesystem mount. It excludes `.git` and host GitHub/SSH credentials. Changes made remotely remain in the Sandbox until you explicitly apply a conflict-checked Git patch locally." (verbatim, README)
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin (README.md) ; read 2026-10-09

### CNT98 Herdr plugin: repository, dates, licence, who owns it
- finding: Repository is github.com/vercel-labs/herdr-vercel-sandbox-plugin, created 2026-08-01, last pushed 2026-08-09, 14 commits, version 0.6.0, 13 stars, 0 open issues, no releases or tags, no LICENSE file (GitHub licence API returns 404; package.json is `"private": true`). It is published by Vercel (the `vercel-labs` org, "Vercel Labs", linked from Vercel's own changelog and docs); it is NOT first-party for Herdr.
- checked: yes (GitHub API data read directly; Herdr's site read once)
- quote: Herdr docs: "Third-party plugins come from their authors, not Herdr;" and "does not review or sandbox plugin code" (the fetch tool paraphrase of herdr.dev/docs/plugins, Latest 0.9.3). Herdr's plugin index (herdr.dev/plugins) per the fetch tool: plugins are "discovered automatically from the `herdr-plugin` topic", "No submission, no review queue", "Listings aren't reviewed by Herdr, so install at your own discretion." The repo has topic `herdr-plugin`. Herdr's home page shows "1,548 community plugins" and Apache 2.0, repo github.com/herdrdev/herdr.
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin ; https://herdr.dev/plugins ; https://herdr.dev/docs/plugins ; read 2026-10-09

### CNT99 Fly Machines: the constants behind the price table
- finding: Ashburn (iad) rates in USD per second: shared CPU $0.0000008465 per vCPU, performance CPU $0.000012732 per vCPU, extra RAM $0.000002316 per GB; each shared vCPU includes 0.25 GB, each performance vCPU includes 2 GB. Other regions are marked up (iad and ewr 1.00, ord and dfw 1.25, fra 1.1538, lhr and cdg 1.1346, sin and syd 1.2692, gru 1.6154).
- checked: yes (the page via the fetch tool and the page source agree on every typed row; the source reproduces them)
- quote: "const PRICE_PER_VCPU_SECOND = { shared: 0.0000008465, performance: 0.000012732 };" and "const RAM_PRICE_PER_GB_SECOND = 0.000002316;" (verbatim, RegionPricingSelector.jsx) ; table text "Machines are billed by the second while they're running" (verbatim, pricing.mdx line 16)
- source: https://docs.fly.io/about/pricing/ (source: https://github.com/superfly/docs/blob/main/about/pricing.mdx and snippets/RegionPricingSelector.jsx) ; read 2026-10-09 ; USD, Ashburn iad, tax not stated

### CNT100 Fly Machines: performance-4x (4 vCPU, 8 GB), and a figure given for it that is 2.72 times too high
- finding: performance-4x with 8 GB is $0.000050928 per second = $0.1833 per hour = $132.01 per 30 days in Ashburn; a figure of $0.0001386 per second, given for it in an earlier comparison that had not been checked against the page, is 2.72 times too high and is within 0.2 percent of the performance-8x/32GB row ($0.00013891).
- checked: yes (two reads agree: a fetch-tool read of the page computed "$0.00005093/second, $0.1833/hour, $132.01/month" from the page formula, and the reader's arithmetic from the page source constants gives the same)
- arithmetic: 4 x $0.000012732 = $0.000050928 per second; RAM above the included 4 x 2 = 8 GB is 8 - 8 = 0 GB, so no extra; x 3600 = $0.18334 per hour; x 2,592,000 s (30 days) = $132.01. Cross-check on a typed row: performance-1x 2GB = $0.000012732 x 2,592,000 = $33.00 (page table: "$33.00/month") and performance-2x 4GB = $66.00 (page: "$66.00/month"). Both reproduce.
- quote: no typed performance-4x row exists; typed rows are "Started Machine, `performance-1x` with 2GB RAM | $33.00/month" and "Started Machine, `performance-2x` with 4GB RAM | $66.00/month" (verbatim, pricing.mdx)
- source: https://docs.fly.io/about/pricing/ ; read 2026-10-09 ; USD, Ashburn (iad) and Secaucus (ewr); other regions cost more (table above)

### CNT101 Fly Machines: shared-cpu-1x (256 MB and 512 MB), and a figure given for it that belongs to another size
- finding: shared-cpu-1x with 256 MB is $0.0000008465 per second ($2.19 per month); with 512 MB it is $0.0000014255 per second ($3.69 per month); a figure of $0.00000338 per second, given for 512 MB in the same earlier comparison, is the shared-cpu-4x/1GB price.
- checked: yes (typed table rows on the page: "$2.19/month" and "$3.69/month"; fetch-tool summary and page source agree)
- arithmetic: 256 MB = 1 x $0.0000008465 + (0.25 - 0.25) GB extra = $0.0000008465 per second; x 2,592,000 = $2.194 (page "$2.19/month"). 512 MB = $0.0000008465 + (0.5 - 0.25) x $0.000002316 = $0.0000008465 + $0.000000579 = $0.0000014255 per second; x 2,592,000 = $3.695 (page "$3.69/month"); per hour $0.00513.
- quote: "Started Machine, `shared-cpu-1x` with 512MB RAM | $3.69/month" (verbatim)
- source: https://docs.fly.io/about/pricing/ ; read 2026-10-09 ; USD, Ashburn

### CNT102 Fly Machines: stopped Machines, other billing rules
- finding: A stopped or suspended Machine is billed only for its root filesystem at $0.15 per GB per month; a started Machine is billed by the second; extra RAM is $6.00 per GB per month (30 days); volumes are $0.15 per GB per month and billed also while detached; no free tier, free trial of "up to 2 hours of Machine runtime or 7 days".
- checked: yes (page via the fetch tool and page source agree)
- quote: "Stopped or suspended Machine | $0.15/GB/month of rootfs | Only the Machine's root file system is billed while it's stopped" ; "Additional Machine RAM | $6.00/GB/month | RAM added beyond the amount included with the CPU preset" (verbatim, pricing.mdx)
- source: https://docs.fly.io/about/pricing/ ; read 2026-10-09 ; USD

### CNT103 E2B: usage rates
- finding: $0.000014 per vCPU-second and $0.0000045 per GiB-second of RAM; storage line says "Free" in the rates table.
- checked: yes (two reads of e2b.dev/pricing, asked with different wording, return the same two rates; docs.e2b.dev/billing does not repeat the rates and points to the calculator)
- quote: "$0.000014 per vCPU-second" ; "$0.0000045 per GiB-second" (verbatim in both reads)
- arithmetic per hour (the reader's): vCPU $0.000014 x 3600 = $0.0504 per vCPU-hour; RAM $0.0000045 x 3600 = $0.0162 per GiB-hour. These equal Daytona's published hourly rates exactly ($0.0504 and $0.0162).
  Waiting-agent hour 1 vCPU/4 GiB billed all the time: $0.0504 + 4 x $0.0162 = $0.1152. Gate hour 4 vCPU/12 GiB: 4 x $0.0504 + 12 x $0.0162 = $0.2016 + $0.1944 = $0.3960.
- source: https://e2b.dev/pricing ; read 2026-10-09 (twice) ; USD, no date on page, tax not stated

### CNT104 E2B: plans, session limits, size limits
- finding: Hobby $0 per month with a one-time $100 credit, 1-hour sessions, 20 concurrent sandboxes, 10 GiB disk; Pro $150 per month plus usage, no extra credit, 24-hour sessions, 100 concurrent (up to 1,100 with add-ons), 20+ GiB disk. Sandbox size: "1 to 8 vCPUs and 1 to 8 GiB of RAM"; the billing docs say Hobby max is 8 vCPU and 8 GiB and Pro shows "8+" for both; so 12 GiB (the gate profile) is not available without a custom template and E2B support.
- checked: yes for plan fee, credit, session length, concurrency, disk (pricing page twice + billing docs once, all agree); size: pricing page twice says 1 to 8 vCPU and 1 to 8 GiB, the billing docs say Hobby 8 and 8, Pro "8+" (no number), so the Pro ceiling is unchecked
- quote: "$150 monthly plan fee, plus usage." ; "Up to 24 hours per sandbox session." ; "Up to 1 hour per sandbox session." ; "Sandboxes can be configured with 1 to 8 vCPUs and 1 to 8 GiB of RAM." ; "Once a sandbox is paused, killed or times out, billing stops immediately." (verbatim, tool answers)
- source: https://e2b.dev/pricing ; https://docs.e2b.dev/billing ; read 2026-10-09 ; USD

### CNT105 Daytona: rates, credit, page date
- finding: $0.0504 per vCPU-hour, $0.0162 per GiB-hour of memory, $0.000108 per GiB-hour of storage (first 5 GiB free), billed per second, $200 free compute; page metadata date Oct 2, 2026.
- checked: yes (second read of the pricing page agrees word for word, see 'Daytona: rates, credit, date (second read)' below)
- quote: "Compute, vCPU, $0.0504/h" ; "Memory, GiB, $0.0162/h" ; "Storage, GiB, $0.000108/h" ; "$200 in free compute included." ; "All billing is calculated per second." (verbatim, tool answer) ; "Price per GiB after first 5 free."
- source: https://www.daytona.io/pricing ; read 2026-10-09 ; USD

### CNT106 Daytona: default and maximum sandbox size
- finding: Default sandbox is 1 vCPU, 1 GB RAM, 3 GiB disk; the maximum for an organization is 4 vCPU, 8 GB RAM, 10 GB disk (so the gate profile's 12 GiB does not fit without a limit increase); minimums are 1 vCPU, 1 GiB memory, 1 GiB disk.
- checked: yes (two reads of daytona.io/docs/en/sandboxes/ and /docs/en/sandbox-management/ agree word for word)
- quote: "Sandboxes have 1 vCPU, 1GB RAM, and 3GiB disk by default." ; "Organizations get a maximum sandbox resource limit of 4 vCPUs, 8GB RAM, and 10GB disk." (verbatim, tool answer)
- source: https://www.daytona.io/docs/en/sandboxes/ ; https://www.daytona.io/docs/en/sandbox-management/ ; read 2026-10-09 ; no date on page

### CNT107 Cloudflare Containers: the three rates and the allowance
- finding: $0.000020 per additional vCPU-second (CPU billed on active use only), $0.0000025 per additional GiB-second of memory and $0.00000007 per additional GB-second of disk (memory and disk billed on the provisioned size), per 10 ms; Workers Paid ($5 per month) includes 375 vCPU-minutes, 25 GiB-hours and 200 GB-hours per month; Free plan has none.
- checked: yes (two reads with different wording agree on all three rates and all three allowances)
- quote: "+ $0.000020 per additional vCPU-second" ; "+$0.0000025 per additional GiB-second" ; "+ $0.00000007 per additional GB-second" ; "375 vCPU-minutes/month", "25 GiB-hours/month included", "200 GB-hours/month" (verbatim, first read) ; second read paraphrase: "375 vCPU-minutes/month included, then $0.000020 per additional vCPU-second".
- source: https://developers.cloudflare.com/containers/pricing/ ; read 2026-10-09 (twice) ; USD, tax not stated, no region split on the page

### CNT108 Cloudflare Containers: does the clock stop when the instance sleeps
- finding: Yes. The page says charges stop after the instance goes to sleep, which can happen automatically after a timeout; it does not say what happens to memory and disk charges when an instance is stopped but not asleep.
- checked: yes (two reads agree)
- quote: "Charges stop after the container instance goes to sleep, which can happen automatically after a timeout." and "charges start when a request is sent to the container or when it is manually started." (verbatim in both reads)
- source: https://developers.cloudflare.com/containers/pricing/ ; read 2026-10-09

### CNT109 Fly Sprites: price per CPU-hour, per GB-hour of memory, storage, and what "used" means
- finding: CPU $0.0385 per CPU-hour of cumulative CPU time (measured by cpu.stat), memory $0.021875 per GB-hour of actual memory use, hot storage $0.000683 per GB-hour (about $0.50 per GB-month, only while awake), cold storage $0.000027 per GB-hour (about $0.02 per GB-month, kept until destroyed). "All resources are billed hourly, based on actual usage."
- checked: yes (five reads agree: fly.io/sprites twice and fly.io/pricing.md twice with the same four rows, and the comparison page once for CPU and memory)
- quote: "CPU time | Cumulative CPU usage measured by cpu.stat | $0.0385 / CPU-hour" ; "Memory time | Actual memory usage | $0.021875 / GB-hour" ; "Hot storage | Bills while the Sprite is awake (≈ $0.50 / GB-month) | $0.000683 / GB-hour" ; "Cold storage | Bills for as long as you keep it (≈ $0.02 / GB-month) | $0.000027 / GB-hour" (verbatim, tool-printed rows)
- source: https://fly.io/sprites ; https://fly.io/pricing.md ; read 2026-10-09 ; USD, tax not stated, no region on the page

### CNT110 Fly Sprites: when billing stops, and the idle rule
- finding: A Sprite has three states, running (billed), warm (not billed) and cold (not billed). It goes from running to warm "within seconds" after the idle monitor sees no activity (the lifecycle page says the idle window is "about 30 seconds today"). Compute billing stops when it goes warm. Four things reset the idle timer: an in-flight HTTP/API request; output to a session or exec'd process's stdout (redirecting to a file or detaching tmux does not count); an open TCP connection; an active task (max 1 hour, renewable).
- checked: yes (fly.io/sprites read twice, lifecycle page read three times; the two Fly pages agree on the states, the 30 seconds comes from the lifecycle page only)
- quote: "Sprites have three states: running (billed), warm (not billed), and cold (not billed)." ; "Running → warm happens within seconds of the idle monitor seeing no activity." ; "Four things reset the idle timer:" "an in-flight HTTP/API request," "output to a session or exec'd process's stdout (redirecting to a file or detaching tmux doesn't count)," "an open TCP connection, or an active task (`sprite-env tasks create`, max 1 hour, renewable)." (verbatim, fly.io/sprites, second read) ; lifecycle page: "When the activity stops, a short idle window passes (about 30 seconds today) and the Sprite pauses." (docs.fly.io/sprites/concepts/lifecycle)
- source: https://fly.io/sprites ; https://docs.fly.io/sprites/concepts/lifecycle ; https://docs.fly.io/sprites/working-with-sprites ; read 2026-10-09

### CNT111 Fly Sprites: would a long coding-agent process that mostly waits on network calls be treated as idle
- finding: It depends on how the agent is attached. A process that is only waiting on outbound HTTPS calls, with no output to a live session, no inbound connection and no registered task, is not listed as activity on any page, so after about 30 seconds the Sprite pauses (warm) and stops billing. A coding agent that keeps painting a terminal (output to a session or TTY) or that holds a task stays running. When a Sprite pauses, its open TCP connections (including the call to the model API) are dropped.
- checked: one read for each sentence below (lifecycle, keeping-running, working-with-sprites, fly.io/sprites twice); the conclusion is the reader's reading of those sentences, not a sentence on any page. No page addresses "outbound API calls with no output" directly (the keeping-sprites-running page's fetch answer said so).
- quote: "Open TCP connections drop on the pause, even on warm." and "A warm-paused agent loop resumes its work on wake; a cold one starts over." and "The model: a task is a hold on the current run." and "While at least one task is live, the Sprite runs." and "Maximum is 1 hour; longer holds require refreshing" and "If the process crashes without cleaning up, the task expires on its own and the Sprite pauses." (verbatim, docs.fly.io/sprites/keeping-sprites-running) ; lifecycle: "open TCP connections do not survive a pause, warm or cold." ; working-with-sprites: "any process started with `sprite exec` or `sprite console` stops when the Sprite sleeps." (lifecycle section, verbatim per tool; this conflicts with "a warm wake preserves your running processes" unless "sleeps" means cold; flagged)
- source: https://docs.fly.io/sprites/keeping-sprites-running ; https://docs.fly.io/sprites/concepts/lifecycle ; https://docs.fly.io/sprites/working-with-sprites ; https://fly.io/sprites ; read 2026-10-09

### CNT112 Fly Sprites: resume time
- finding: Warm wake takes 100 to 500 ms and keeps running processes (frozen, not killed); cold wake takes 1 to 2 s and starts processes fresh; a wake is triggered by "the next request" (an incoming request to the Sprite's URL).
- checked: yes (lifecycle page and keeping-sprites-running page agree on both numbers)
- quote: "The next request resumes it in 100–500ms, and processes pick up mid-thought, exactly where they were." and "The next wake takes 1–2s and starts processes fresh." (verbatim, lifecycle page)
- source: https://docs.fly.io/sprites/concepts/lifecycle ; read 2026-10-09

### CNT113 Fly Sprites: size, storage, run time (SUPERSEDED: the last Sprites entry, 'size, exact words from the lifecycle page', has the page's own wording: 8 vCPUs and 100 GB fixed, memory platform-managed)
- finding: Storage is a 100 GB volume billed only on bytes used; maximum CPU and RAM were not found on the pages first read; a Fly community thread says the default RAM cap is 8 GB, raised to 16 GB on request; no maximum run time is stated except that an active task hold is capped at 1 hour per refresh.
- checked: storage: yes (fly.io/sprites and lifecycle page agree); CPU/RAM: unchecked (forum and search answers only)
- quote: "The volume is 100 GB, and you're billed on the storage you actually use." (fly.io/sprites) ; lifecycle: "Storage is billed by bytes written, not the full 100 GB." (paraphrase by the tool) ; the search tool answer (unchecked, third party): "The Sprites website has also advertised up to 8 CPUs and 16GB of RAM", forum: default "up to 8GB of memory", 16 GB on request via support.
- source: https://fly.io/sprites ; https://docs.fly.io/sprites/concepts/lifecycle ; community.fly.io threads (titles only, not read) ; read 2026-10-09

### CNT114 Fly Sprites: the two Fly pages that disagree on plans
- finding: fly.io/sprites describes plan tiers with bundled allowances and a trial credit; fly.io/pricing.md says there are no plans or tiers.
- checked: yes (fly.io/sprites read twice, fly.io/pricing.md once)
- quote A (fly.io/sprites, first read): "new organizations get $30 in trial credit." and "Plans bundle an allowance of CPU-hours, RAM GB-hours, and storage GB, not unlimited usage." and "Hero ($100/mo) includes 1,200 CPU-hours, 4,800 RAM GB-hours, and 150 GB of storage." ; second read: tiers named "Pay-as-you-go, Adventurer, Veteran, Hero, Champion, Legend, Epic, Mythic", prices given only for "Hero at $100/mo and Mythic at $2,000/mo", and "Pay-as-you-go and the plans below Hero (Adventurer, Veteran) have community support." and "For full tier details, it points to https://fly.io/pricing.md".
- quote B (fly.io/pricing.md Sprites section): "No plans and no tiers, and nothing charged per Sprite." (tool's quote) ; "a Sprite that exists but does nothing costs nothing beyond its stored data." ; "Hot storage stops billing when the Sprite goes to sleep;" ; "cold storage bills for as long as the data exists, so a Sprite that is asleep all month still accrues it."
- source: https://fly.io/sprites ; https://fly.io/pricing.md ; read 2026-10-09 ; USD

### CNT115 Fly Sprites: what the program interface gives (start a process, stream output, exit code)
- finding: `sprite exec` runs a command, "Blocks until the command completes", "Returns stdout/stderr"; TTY sessions are detachable. The page as read does not cover streaming or exit codes.
- checked: one read; exit-code and streaming behaviour: unchecked (not on the page as returned)
- quote: "Run a single command, wait for it to finish, get the output." and "All TTY sessions are automatically detachable." (verbatim per tool, working-with-sprites)
- source: https://docs.fly.io/sprites/working-with-sprites ; read 2026-10-09

### CNT116 Daytona: rates, credit, date (second read)
- finding: Second read of daytona.io/pricing, asked with different wording, gives the same three rates, the same "first 5 free" storage footnote, "$200 in free compute included.", "All billing is calculated per second." and the metadata date "Oct 2, 2026, 9:12 PM UTC".
- checked: yes (two reads agree word for word)
- quote: "Compute, vCPU, $0.0504/h" ; "Memory, GiB, $0.0162/h" ; "Storage, GiB, $0.000108/h" ; "Price per GiB after first 5 free" (verbatim, both reads)
- arithmetic (the reader's): the hourly rates are exactly E2B's per-second rates times 3600 ($0.000014 x 3600 = $0.0504; $0.0000045 x 3600 = $0.0162). Waiting-agent hour 1 vCPU/4 GiB: $0.0504 + 4 x $0.0162 = $0.1152 (running all hour). Gate hour 4 vCPU/12 GiB: 4 x $0.0504 + 12 x $0.0162 = $0.3960, but see the size limit below.
- source: https://www.daytona.io/pricing ; read 2026-10-09 (twice) ; USD, tax not stated

### CNT117 Daytona: auto-stop, auto-archive, auto-delete defaults; what counts as activity
- finding: Auto-stop default is 15 minutes of inactivity (0 disables it); auto-archive default is 7 days after being stopped (0 means the 30-day maximum); auto-delete default is off. Fire-and-forget background scripts do not count as activity.
- checked: yes (live docs page daytona.io/docs/en/sandboxes.md read once; the older docs source in github.com/daytonaio/docs `sandbox-management.mdx` (2025) says the same; Fly's comparison page, a third party for Daytona, says the same)
- quote: "By default, Daytona sandboxes auto-stop after 15 minutes of inactivity." ; "if not set, the default interval of 7 days is used" ; "if not set, the sandbox is not deleted automatically" ; activity that resets the timer per the tool: "Network requests through sandbox previews", "Active SSH connections", "API requests to the Daytona Toolbox SDK"; not counted: "background scripts such as `npm run dev` run as fire-and-forget commands" (tool's wording). Older docs source: "To keep the Sandbox running indefinitely without interruption, set the auto-stop value to `0` during creation." (verbatim)
- source: https://www.daytona.io/docs/en/sandboxes.md ; https://www.daytona.io/docs/en/limits.md ; https://github.com/daytonaio/docs (src/content/docs/sandbox-management.mdx, commit 0e1bd58, 2025-07-02; STALE: its limits.mdx says Tier 2 $10 top-up while the live page says $25) ; read 2026-10-09

### CNT118 Daytona: size limits (second page agreeing) and tiers
- finding: Default 1 vCPU, 1 GB RAM, 3 GiB disk. Maximum per sandbox for an organization: 4 vCPU, 8 GB RAM, 10 GB disk. So the gate profile (4 vCPU, 12 GiB) does not fit; the waiting-agent profile (1 vCPU, 4 GiB) does. Organization pools: Tier 1 is 10 vCPU / 10 GiB / 30 GiB, Tier 2 100 / 200 GiB / 300 GiB, Tier 3 250 / 500 GiB / 2000 GiB, Tier 4 500 / 1000 GiB / 5000 GiB; the live limits page contradicts itself on Tier 1 memory (10 GiB in one table, 20 GiB in another).
- checked: per-sandbox numbers: yes (daytona.io/docs/en/sandboxes/ and /sandbox-management/ agree word for word); tiers: one read, internally inconsistent
- quote: "Organizations get a maximum sandbox resource limit of 4 vCPUs, 8GB RAM, and 10GB disk." (verbatim) ; "Tier 2 | 100 / 200GiB / 300GiB | Credit card linked, $25 top-up" (tool, limits.md)
- source: https://www.daytona.io/docs/en/sandboxes/ ; https://www.daytona.io/docs/en/limits.md ; read 2026-10-09

### CNT119 Vercel Sandbox: Pro $20 credit (second read, Pro plan page)
- finding: The Pro plan costs $20 per month per deploying seat and that platform fee "includes $20 in usage credit"; the credit covers all managed infrastructure resources, applies "from the first unit you use", expires at the end of each month if unused, and after it is spent Vercel "bills additional usage on-demand". Sandbox usage is charged against it (sandbox pricing page).
- checked: yes (pricing page twice + Pro plan page once agree on $20 credit)
- quote: "Every Pro plan has $20 in monthly credit." ; "$20/month Pro platform fee" "1 deploying team seat included" "$20/month in usage credit" ; "Your credit expires at the end of the month if you don't use it, and resets at the beginning of the following month." (verbatim) ; "All prices shown are in USD and exclude value-added tax (VAT), goods and services tax (GST), and other applicable taxes."
- source: https://vercel.com/docs/plans/pro-plan (last_updated 2026-09-15 in front matter) ; https://vercel.com/docs/sandbox/pricing ; read 2026-10-09 ; USD, taxes excluded

### CNT120 E2B: size limits, second read of the billing docs (Pro ceiling)
- finding: The billing docs table gives max vCPUs Hobby 8, Pro "8+", Enterprise custom; max memory Hobby 8 GiB, Pro "8+ GiB", custom; disk 10 GiB, "20+ GiB", custom; and the Pro cells carry tooltips "Contact support@e2b.dev if you need more vCPUs." and "Contact support@e2b.dev if you need more memory." So anything above 8 vCPU or 8 GiB (the 12 GiB gate profile) is by request to E2B, not self-service; the pricing page itself says "1 to 8 vCPUs and 1 to 8 GiB of RAM".
- checked: yes (docs.e2b.dev/billing read twice with different wording, e2b.dev/pricing read twice; they agree that 8/8 is the stated range and that more needs a request)
- quote: "Max vCPUs: 8 | 8+ | Custom" ; "Max memory: 8 GiB | 8+ GiB | Custom" (tool's rendering of the plans table) ; "Max continuous runtime is the time a sandbox can run without being paused, not a cap on how long a sandbox can exist." ; "a paused sandbox is kept indefinitely with no time-to-live." ; "Once a sandbox is paused, killed or times out, billing stops immediately." (verbatim per tool)
- source: https://docs.e2b.dev/billing (e2b.dev/docs/billing redirects here, 308) ; https://e2b.dev/pricing ; read 2026-10-09 ; USD

### CNT121 Vercel Sandbox: duration versus persistence, one more Vercel page
- finding: Vercel's own KB says "Duration limits a single session, while persistence carries a sandbox from one session to the next"; files are snapshotted at stop and a new session boots from the snapshot; memory is billed "for the full time it runs, even while idle"; running processes are not stated to survive a stop (the doc's `onResume` example restarts a dev server).
- checked: one read of this page; agrees with the persistence page
- quote: "A session is billed for the full time it runs, even while idle." (verbatim per tool) ; "up to 24 hours on Pro and Enterprise plans" ; "up to 45 minutes on Hobby"
- source: https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence ; read 2026-10-09

### CNT122 Fly Sprites: Fly staff in the community forum (older and current statements)
- finding: In January 2026 Fly staff said Sprites idle to warm "more or less as soon as they can", suspended "After ~10 mins", and that billing was turned off at running -> warm; the current lifecycle page says the idle window is "about 30 seconds today". Staff also said in June 2026 the default RAM cap is 8 GB, raised to 16 GB on request via support.
- checked: one read each of two forum threads; staff statements, not documentation
- quote: "we now completely turn of billing when a Sprite moves from `running` to `warm`." (a Fly staff member, Jan 27, 2026, per the tool) ; "Currently the default is up to 8GB of memory." and "write in to support to request up to 16GB" (Fly support staff, June 17, 2026, per the tool) ; sprites.dev advertised "up to 8 CPUs and 16GB of RAM for any given run" (the original poster of a forum thread quoting the site, June 17, 2026)
- source: https://community.fly.io/t/sprite-constantly-stays-warm-also-any-way-to-reboot/26926 ; https://community.fly.io/t/16gb-ram-advertised-for-sprites-but-not-actually-available/28123 ; read 2026-10-09

### CNT123 Fly Sprites: second read of the lifecycle and idle-detection pages (the two Fly docs pages differ)
- finding: A second read of docs.fly.io/sprites/concepts/lifecycle (asked as "every sentence with idle, activity, billed...") repeats the first: idle window "about 30 seconds today", compute billed only while active, warm wake 100-500 ms, cold wake 1-2 s. It adds that the page "does not mention outbound connections or API calls from a Sprite to other services". The docs page "working with sprites" (second read) says activity "includes active exec/console commands, open TCP connections, running TTY sessions, and active Services with open connections" and, in its lifecycle part, "RAM does not persist, so running processes stop and in-memory data is lost" and that TTY sessions and any process started with `sprite exec` or `sprite console` stop when the Sprite sleeps.
- checked: yes for the 30 seconds, the wake times and the billing rule (two reads of the lifecycle page agree); the two Fly docs pages DISAGREE on whether a warm wake keeps running processes (lifecycle: "a warm wake preserves your running processes, a cold wake does not"; working-with-sprites: running processes stop when the Sprite sleeps)
- quote: "When the activity stops, a short idle window passes (about 30 seconds today) and the Sprite pauses." ; "One thing drops either way: open TCP connections do not survive a pause, warm or cold." ; "But a process you started by hand, a dev server, a database you launched in a shell, an agent, is gone after a cold wake" ; "Compute is billed only while the Sprite is active, which is the whole point of pausing." (verbatim, lifecycle page) ; "Activity includes: Active exec/console commands, Open TCP connections (like your app's URL), Running TTY sessions, Active Services with open connections" (verbatim, working-with-sprites)
- source: https://docs.fly.io/sprites/concepts/lifecycle ; https://docs.fly.io/sprites/working-with-sprites ; read 2026-10-09 (twice each) ; no page date

### CNT124 Daytona: auto-stop and archive defaults, second live read
- finding: A second read of the live docs (daytona.io/docs/en/sandboxes.md, different wording) repeats: auto-stop 15 minutes, auto-archive 7 days (0 means the 30-day maximum), auto-delete not set by default, and adds "Merely having a script or background task running is not sufficient to keep the sandbox alive."
- checked: yes (two live reads agree; the 2025 docs source and Fly's comparison page agree too)
- quote: "if not set, the default interval of 15 minutes is used" ; "if not set, the default interval of 7 days is used" ; "if not set, the sandbox is not deleted automatically" ; "Merely having a script or background task running is not sufficient to keep the sandbox alive." (verbatim per tool)
- source: https://www.daytona.io/docs/en/sandboxes.md ; read 2026-10-09 (twice)

### CNT125 Herdr plugin: remote workspace path and the Vercel CLI calls (from the plugin's source)
- finding: The plugin's source fixes the remote workspace at `/vercel/sandbox/workspace` and drives only the Vercel CLI: `sandbox create --name <name> [--image ...]`, `sandbox exec <name> -- sh -lc ...`, `sandbox copy` (workspace archive up, patch down), `sandbox exec --interactive --workdir <cwd> ...` for the pane, `sandbox stop`, `sandbox remove`. Default image `vercel/sandbox/universal:latest`. It refuses to run if `sandbox create --help` lacks `--image` ("Install Vercel CLI 58.7.1 or newer.").
- checked: yes (read directly from the repository at head be8393a; README agrees)
- quote: `export const REMOTE_ROOT = "/vercel/sandbox/workspace";` ; `export const DEFAULT_SANDBOX_IMAGE = "vercel/sandbox/universal:latest";` (verbatim, src/lib.mjs lines 8-9) ; "does not support Sandbox images. Install Vercel CLI 58.7.1 or newer." (src/bridge.mjs line 99)
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin (src/lib.mjs, src/bridge.mjs) ; read 2026-10-09 with `gh api`

### CNT126 Fly Sprites: the plans disagreement, second read of fly.io/pricing.md
- finding: A second read of fly.io/pricing.md (asked for "every mention of Sprite") returns the same: "No plans and no tiers, and nothing charged per Sprite." and the same four rates; it mentions no bundle, allowance or trial credit for Sprites. fly.io/sprites (two reads) still lists tiers (Pay-as-you-go, Adventurer, Veteran, Hero $100/mo, ... Mythic $2,000/mo) and a $30 trial credit. The disagreement is real, not a summary artefact.
- checked: yes (two reads of each page)
- quote: "No plans and no tiers, and nothing charged per Sprite." (fly.io/pricing.md, both reads) vs "Hero ($100/mo) includes 1,200 CPU-hours, 4,800 RAM GB-hours, and 150 GB of storage." (fly.io/sprites, first read)
- source: https://fly.io/pricing.md ; https://fly.io/sprites ; read 2026-10-09

### CNT127 Fly Sprites: size per the lifecycle page (new)
- finding: The lifecycle page says every Sprite starts with 100 GB of storage that "does not autoscale yet", and (in a separate "Resources" section, per the tool) each Sprite runs with 8 vCPUs and platform-managed memory; it gives no memory number. Fly staff on the forum (June 2026) said the default memory cap is 8 GB, 16 GB on request. Its "What persists" table lists running processes, in-memory state and open network connections on the side that does not persist.
- checked: storage and 8 vCPU: one read of the lifecycle page (the 8 vCPU line came from the tool's description of another section, so unchecked wording); memory: forum staff statement only
- quote: "Every Sprite starts with 100 GB of storage." and "It does not autoscale yet, so plan around that ceiling." (verbatim per tool)
- source: https://docs.fly.io/sprites/concepts/lifecycle ; read 2026-10-09

### CNT128 Fly Sprites: size, exact words from the lifecycle page's "Resources" section (replaces the unchecked wording above)
- finding: Every Sprite has 8 vCPUs and 100 GB of storage, both fixed, and platform-managed memory that is not a published number; the user cannot set or resize any of it. Disk persists, memory does not.
- checked: one read of this section, verbatim (earlier summary reads of the same page gave the 100 GB and, second-hand, 8 vCPU); memory cap of 8 GB default is a Fly staff forum statement
- quote: "Each Sprite runs with:" "8 vCPUs" "Memory the platform manages for you, sized per Sprite and able to scale up under pressure" "100 GB of storage" ; "You don't set or resize these yourself. The vCPU count and the storage ceiling are fixed; memory is handled automatically." ; "A Sprite doesn't run with one published RAM figure." ; "The split is simple: disk persists, memory does not." (verbatim per tool)
- source: https://docs.fly.io/sprites/concepts/lifecycle ; read 2026-10-09 ; community.fly.io thread June 17, 2026 (staff)

### CNT129 Other Herdr plugins: Fly Sprites, E2B and the rest
- finding: The topic `herdr-plugin` lists, for the providers in this study, `superfly/herdr-sprites-plugin` (Fly.io's own organisation; description "Official Herdr plugin for Fly.io Sprites"; MIT; created 2026-09-08, last push 2026-09-09, 2 stars) and `e2b-dev/herdr-e2b-sandbox` (E2B's own organisation; Apache-2.0; created 2026-08-18, last push 2026-09-29, 12 stars), plus an older third-party `tomasvarga/herdr-e2b` (2026-07). No plugin turned up for Daytona or for Cloudflare Containers (a search for those words returned only unrelated tunnel plugins). Others under the topic: `blaxel-ai/herdr-blaxel-sandbox-plugin`, `upstash/herdr-upstash-box`, `dirien/herdr-sbx-plugin` and `dvdksn/sbx-herdr` (Docker Sandboxes), `madarco/agentbox`.
- checked: yes for existence, owners, licences and dates (GitHub API, read directly); README lines read directly from the repositories
- quote (Sprites plugin README): "Run Claude Code, Codex, OpenCode, or a custom coding-agent CLI in a persistent Sprite, controlled from a local Herdr pane. Each agent pane gets its own Sprite." ; requirements "Linux or macOS, Node.js 22+, Git, the authenticated `sprite` CLI, and Herdr 0.9.0+" ; action `stop`: "Kill interactive sessions in this pane's dedicated Sprite. Preserve the Sprite and checkpoints. Idle Sprites suspend automatically; services may keep them running." ; credentials: "`\"auth\": \"auto\"` is the default. For the selected standard `claude` or `codex` command, setup transfers the local login once before the first agent launch." (verbatim)
- quote (E2B plugin README): "Needs **herdr >= 0.7.0**, **Node >= 22**, **jq**, the `e2b` CLI on PATH, and an E2B API key." ; "Boxes pause at the idle timeout (`[sandbox].timeout_ms`, default 1h - the free-tier cap): a full memory snapshot, so billing stops and `open` puts you back with everything still running." ; it also has `e2b-box run` with outcome kinds such as "`agent-failed` (exited non-zero)" and a fleet mode that races several agents (names Claude Code, Codex, Grok, OpenCode, Amp, Droid, Prime and Muse Code) (verbatim/paraphrase of the README)
- source: https://github.com/superfly/herdr-sprites-plugin ; https://github.com/e2b-dev/herdr-e2b-sandbox ; GitHub search API ; read 2026-10-09 ; these plugins were not checked beyond their READMEs

### CNT130 Fly Sprites: maximum run time and resume, Fly's comparison page (one more Fly page)
- finding: Fly's own comparison page (fly.io/learn/fly-vs-daytona.md) says a Sprite has no duration cap and resumes in about a second; this agrees with the docs pages (no maximum run time found; warm wake 100-500 ms, cold wake 1-2 s). It is a Fly marketing page that also makes claims about Daytona, so its Daytona statements are a third party's copy (they matched Daytona's own docs: auto-stop 15 minutes, auto-archive 7 days, auto-delete off).
- checked: one read
- quote: "There is no duration cap and no archival timer." ; "Idle Sprites suspend with their memory snapshotted and come back in about a second." ; "A Fly.io Sprite gets 100 GB of ext4." ; "Sprites bill what a Sprite actually uses: $0.0385 per CPU-hour of CPU time and $0.021875 per GB-hour of memory in use." (verbatim per tool)
- source: https://fly.io/learn/fly-vs-daytona.md ; read 2026-10-09 ; USD

### CNT131 Starting a command, streaming its output and reading its exit code: Vercel, Modal, Daytona, E2B, Cloudflare and Fly.io
- finding: Vercel Sandbox can do all three (`runCommand` returns `exitCode`, `stdout()` and `stderr()`; with `detached: true`, `command.logs()` streams lines tagged stdout or stderr and `command.wait()` gives `exitCode`). Modal Sandboxes can (`sb.exec`, `p.wait()`, `p.returncode`, and line-by-line reading of `p.stdout`; a Sandbox `timeout` of up to 24 hours). Daytona can (`process.exec`, with a default timeout of 10 seconds; session commands with log callbacks; `get_session_command` reads the exit code). E2B can (`commands.run`, `onStdout`, a background handle with `wait()`; a default command timeout of 60 seconds that kills the process even in the background; the exit-code field name was not shown on the pages read). Cloudflare Containers can since 2026-06-18 (`exec()` gives a process with `pid`, stdout and stderr streams and an `exitCode` promise; it has no built-in timeout, does not start a stopped container, and is called from code in the Worker or Durable Object that owns the container). Fly.io Machines can run a command and read its exit code: `fly machine exec` takes `--timeout`, and the Machines API's exec endpoint returns `stdout`, `stderr`, `exit_code` and `exit_signal` in one response; the page does not say whether output is streamed (CNT134). Fly.io Sprites can: `sprite exec` runs one command and waits, and the WebSocket exec endpoint delivers standard output and standard error as frames and the exit code as a frame and a JSON message (CNT134). Google Cloud Run jobs can start an execution with overridden arguments, stream logs and read an exit code from the Task resource (CNT75, CNT133).
- checked: one read of each provider's page (Vercel's working-with-sandbox page, last_updated 2026-09-15; Modal's sandbox guide; Daytona's process-execution page; E2B's background-commands page; Cloudflare's execute-commands guide; Fly's flyctl and Sprites pages); E2B's exit-code field is unchecked
- quote: "const finished = await command.wait(); console.log(finished.exitCode);" (Vercel, verbatim) ; "`exec()` has no built-in timeout." and "`exec()` does not start a stopped Container." (Cloudflare, verbatim) ; "The default is 60 seconds, and when it expires the process is killed in the sandbox, even when `background` is set." (E2B, verbatim) ; "Run a single command, wait for it to finish, get the output." (Fly.io Sprites) ; "Wait for the Sandbox to finish running." and "Return code of the Sandbox process if it has finished running, else None." (Modal reference page, verbatim)
- source: https://vercel.com/docs/sandbox/working-with-sandbox ; https://modal.com/docs/guide/sandbox ; https://www.daytona.io/docs/en/process-code-execution.md ; https://docs.e2b.dev/commands/background ; https://developers.cloudflare.com/containers/guides/execute-commands/ ; https://docs.fly.io/flyctl/machine-exec ; https://docs.fly.io/sprites ; read 2026-10-09
- strength: stated

### CNT132 The Herdr plugin for Vercel Sandbox: what a program driving it can see
- finding: The plugin's pane is an interactive terminal for a person (`vercel sandbox exec --interactive`). A program can drive the pane through Herdr (`herdr agent prompt --wait`, `agent wait --until idle`, `agent read`), and every plugin action prints a first line `HERDR_SANDBOX_RESULT: {...}` with an `ok` field. The README names no exit code for a program that drives the pane; only the screen state (working, waiting, finished) is shown. The plugin's bridge runs `vercel sandbox exec --interactive --workdir <dir> <name> -- sh -lc <launch>` and sets its own process exit code to that command's status (`process.exitCode = result.status ?? 0`, src/bridge.mjs), so the remote status reaches the pane's process; whether Herdr exposes a pane process's status to a driver is not shown. The workspace lives inside the sandbox and comes back to the local repository as a Git patch, so files that a command typed into the pane writes would be created inside the sandbox.
- checked: one read of the README, the manifest and the source files, read directly from the repository
- source: https://github.com/vercel-labs/herdr-vercel-sandbox-plugin ; read 2026-10-09
- strength: stated for the commands and the first line; argued for the last sentence, from the plugin's design, not tried

### CNT133 Google Cloud Run: the exit code of a job task
- finding: The Task resource of the Cloud Run Admin API (v2, jobs executions tasks) has a field `lastAttemptResult.exitCode`, described as "Output only. The exit code of this attempt." The execute and create pages read earlier (CNT75) do not say how an exit code is reported.
- checked: three reads of the reference page agree (fetch-tool summaries asked the same narrow question)
- quote: "lastAttemptResult.exitCode" ; "Output only. The exit code of this attempt." (verbatim)
- source: https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions.tasks ; read 2026-10-09
- strength: stated

### CNT134 Fly.io: what the Machines exec API and the Sprites exec WebSocket return
- finding: The Machines API's exec endpoint has a response schema (`ExecResponse`) with `exit_code`, `exit_signal`, `stdout` and `stderr`, all returned in one response; the page does not say whether output is streamed, and the request schema has a `timeout` integer with no description, units or default. The Sprites WebSocket exec endpoint delivers standard output in frames with prefix 0x01, standard error with 0x02 and the exit code as a single byte with 0x03, and also sends a JSON message of type "exit" with `exit_code`.
- checked: yes (two reads of each page agree)
- quote: "stdout, stderr, exit code, and exit signal are returned." (Machines API, verbatim) ; "stdout data. Frame prefix: `0x01`." and "exit code (single byte). Frame prefix: `0x03`." (Sprites, verbatim) ; "Process exit code" (the `exit_code` field of the `exit` message)
- source: https://docs.fly.io/api/machines/machines/execute-command ; https://docs.fly.io/sprites/api/websockets/execute-command ; read 2026-10-09
- strength: stated

### CNT135 Vercel Sandbox: the firewall, and credentials injected outside the sandbox
- finding: A sandbox has one of three network policies, `allow-all` (the default), `deny-all` or a user-defined list of allowed domains and address ranges, and the policy can be changed on a running sandbox. A rule on an allowed domain can add or replace request headers (`transform`), which the page calls credentials brokering, or forward requests to a proxy (`forwardURL`). The firewall terminates TLS only for those domains, with a per-sandbox certificate authority added to the sandbox's system certificates. Limits stated on the page: brokering depends on the server name sent in the TLS handshake; traffic sent to a literal IP address in an allowed range, or through a custom DNS resolver, bypasses it; under a catch-all rule a connection with no detectable domain, such as SSH, passes unmodified; Postgres connections do not support it.
- checked: one read of the full page text (last_updated 2026-09-16); a search answer describing the same page agrees
- quote: "Credentials brokering injects credentials into egressing traffic. The secrets never enter the sandbox, so code running inside it cannot exfiltrate them." ; "Code can reach any IP in an allowed range by using a literal IP address or a custom DNS resolver, and this traffic bypasses SNI filtering, credentials brokering, and requests proxying." ; "A unique, per-sandbox CA is added to the system certificates." (verbatim)
- source: https://vercel.com/docs/sandbox/concepts/firewall ; read 2026-10-09
- strength: stated. Whether a subscription login can be carried this way was not tried; the plugin entries (CNT96, CNT97) say agent authentication happens inside the sandbox.

### CNT-NOTCHECKED What the reading of the container and sandbox pages did not cover
- Nothing was run, ordered or signed up for, no account was opened and no third-party code was run. Prices are list prices for the region and currency each entry names.
- AWS Fargate Spot dollar rates: AWS's rate table is blank in the fetched text and the ECS price-list file had no Spot row in the parts scanned; only third-party figures exist and they are not used.
- Google Cloud Run: the pricing page text was unreadable (73 characters in four fetches), so the rates were read on Google's committed-use discount page; the free tier and the one-minute minimum are from a search answer only; whether a job's command (not only its arguments) can be overridden. The execute and create pages do not say how an exit code is reported; the Task resource of the Admin API has a field for it (CNT133).
- Azure Container Instances: the pricing page showed no rates; the rates are from the retail price API, one read.
- Northflank: a documented maximum job or service runtime (none stated); whether a 20-hour job runs in practice; a single API call that starts a run with a command and returns its exit code; egress and prices outside "Northflank Cloud".
- Modal: whether a subprocess started in a Function is killed when the Function times out; whether a Function's CPU is billed at the reserved or the used cores; the Team plan's included credit.
- Koyeb: whether Eco vCPUs are shared or dedicated (no page says); the Starter plan's end date; the closing of the Mistral AI deal; Koyeb Sandboxes' maximum runtime and price; the CLI flag `koyeb sandbox run --stream` (search answer).
- Railway: whether container usage is metered on use or on the size requested; the Sandbox rates (search answer).
- Render: its pricing and instance pages (script-rendered, unreadable); the compute plans come from a search answer and are not relied on.
- Hetzner: the price of the primary IPv4 address; whether the CCX products are really out of stock; whether any exec-style API exists (absence not proven); the egress overage price.
- Vercel Sandbox: rates in regions other than iad1 (the regional table is rendered by script).
- E2B: the exit-code field name; the Pro ceiling above 8 vCPU and 8 GiB (by request to E2B); network and storage rates; the credit used each month on Pro.
- Daytona: how long a stopped or archived sandbox takes to resume; whether a stopped sandbox pays for disk at the live rates (older docs say yes, the live page says archiving stops billing); the Tier 1 memory pool (10 or 20 GiB, both on one page).
- Fly.io Machines: whether the exec endpoint streams or returns once the command ends, and its time limit (the schema has a `timeout` field with no description; a 60-second ceiling is a forum answer only); whether a memory size outside the tiers, such as 12 GB, is accepted on performance-4x.
- Fly.io Sprites: whether an outbound connection counts as activity; the memory ceiling beyond a staff statement on a forum, and so whether a 12 GiB gate fits; the plan tiers (two Fly pages disagree); a search answer's rates of $0.07 per CPU-hour and $0.04375 per GB-hour, which are not used.
- Herdr: a dedicated Herdr page for the Vercel plugin (the plugin index loads by script); Vercel's changelog text in full (the date 2026-08-06 is from the tool's summary and a search answer, which agree). The Fly.io and E2B plugins were read to their README only.
- Cloudflare Containers: the `exec()` changelog page itself (the date is taken from its URL and a search answer); the default container sleep timeout.
- Tax: only Hetzner (excluding VAT), Northflank (excluding VAT and GST) and AWS (price list, excluding tax) state it; the Modal, Koyeb and Cloud Run pages read do not.
