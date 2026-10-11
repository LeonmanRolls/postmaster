# Passages relied on: hosted CI machines, free tiers, Tailscale, phones and owned hardware

Read on 2026-10-09. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the same words were seen in two separate reads, or in the provider's own data file; paraphrase means one read or a restatement), where each was read, and how sure the note is. Strength: stated is on the provider's page, shown is in a data file, a repository or a third party's copy, argued is derived by the reader from the entries named, not found is a search with the searches listed. Prices are list prices for the region and currency each entry names, and prices change. These are GitHub Actions and Codespaces, Oracle Cloud's free and pay-as-you-go Arm machines, Tailscale's plan and SSH, what documents and users say about running coding-agent command-line programs on a phone, and the cost of owned machines.

### CIP1 GitHub Actions: hosted runner per-minute prices (private repositories)
- finding: Standard Linux 2-core x64 is $0.006 per minute ($0.36 an hour); larger Linux x64 4-core is $0.012 ($0.72 an hour), 8-core $0.022 ($1.32), 16-core $0.042 ($2.52); arm64 Linux 2-core $0.005 ($0.30), 4-core $0.008 ($0.48), 8-core $0.014, 16-core $0.026 per minute. Two reads agree (a fetch-tool read of the page and the page source).
- quote: "Linux 2-core (x64) | actions_linux | $0.006" and "Linux 4-core | linux_4_core | $0.012" (verbatim table rows)
- source: https://docs.github.com/en/billing/reference/actions-runner-pricing ; read 2026-10-09 ; USD per minute, list, no tax stated, no region
- strength: stated

### CIP2 GitHub Actions: how minutes are billed
- finding: Each job is rounded up to a whole minute; larger runners are billed only for the time workflows run on them, with no cost for an idle configured runner; included minutes cannot be used for larger runners; larger runners are only for organizations on the Team or Enterprise Cloud plan.
- quote: "GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute." / "Included minutes cannot be used for larger runners." (verbatim)
- source: https://docs.github.com/en/billing/reference/actions-runner-pricing ; https://docs.github.com/en/actions/reference/runners/github-hosted-runners (larger runners "available for organizations and enterprises on Team and Enterprise Cloud plans") ; read 2026-10-09 ; USD
- strength: stated

### CIP3 GitHub Actions: memory, CPU and disk of each hosted size
- finding: For private repositories the standard Linux runner is 2 CPU, 8 GB RAM, 14 GB SSD (x64 and arm64). Larger Ubuntu runners: 2 CPU 8 GB 75 GB SSD; 4 CPU 16 GB 150 GB; 8 CPU 32 GB 300 GB; 16 CPU 64 GB 600 GB; 32 CPU 128 GB 1200 GB. The 14 GB disk of the standard runner is below the 20 GB the workload needs; the larger runners have it.
- quote: "| 4 | 16 GB | 150 GB | x64, arm64 | Ubuntu, Windows |" (verbatim row of the larger-runner table); standard: "Linux | 2 | 8 GB | 14 GB | x64" (verbatim)
- source: https://docs.github.com/en/actions/reference/runners/larger-runners ; https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; read 2026-10-09 (page source via github/docs) ; GB as written
- strength: stated (larger-runner rows: two reads, page source and rendered page, agree; the standard-runner row 2 / 8 GB / 14 GB: one read of the page source)

### CIP4 GitHub Actions: free minutes by plan (private repositories, standard runners only)
- finding: Included minutes a month for standard hosted runners: Free 2,000; Pro 3,000; Free for organizations 2,000; Team 3,000; Enterprise Cloud 50,000. Standard runners are free and unlimited on public repositories; larger runners are never free, even on public repositories. Without a payment method on file usage is blocked once the quota is used up.
- quote: "Minutes (per month) | 2,000 | 3,000 | 2,000 | 3,000 | 50,000" (verbatim row, columns Free, Pro, Free org, Team, Enterprise Cloud)
- source: https://docs.github.com/en/billing/reference/product-usage-included ; https://docs.github.com/en/billing/concepts/product-billing/github-actions ; read 2026-10-09 ; page source via github/docs
- strength: stated (two reads: page source and rendered page agree)

### CIP5 GitHub Actions: how long a job or workflow may run
- finding: A job on a GitHub-hosted runner may run at most 6 hours, and Support cannot raise it; a job on a self-hosted runner at most 5 days; a workflow run at most 35 days including waiting; a job may wait in the queue for a self-hosted runner 24 hours. Two reads agree (a fetch-tool read of the page and the page source). So the coachman (4 to 19 hours) and the longest lane (15 hours) do not fit one hosted job; they fit a self-hosted one.
- quote: "Each job in a workflow can run for up to 6 hours of execution time. If a job reaches this limit, the job is terminated and fails." (verbatim)
- source: https://docs.github.com/en/actions/reference/limits ; read 2026-10-09 ; no price
- strength: stated

### CIP6 GitHub Actions: concurrency by plan, other limits
- finding: Concurrent jobs on standard hosted runners: Free 20, Pro 40, Team 60, Enterprise 500; larger runners 1,000 on Team and Enterprise; Support can raise them. Workflow trigger rate 1,500 events per 10 seconds per repository; matrix at most 256 jobs. No "5-minute" workflow limit on the limits page: the only 5-minute figure is runner registration (1,500 runners per 5 minutes per repository). A single-CPU `ubuntu-slim` hosted runner has a 15-minute job timeout and a container with no privileged mode.
- quote: "Standard GitHub-hosted runner | Team | 60 | 5 | Not applicable" (verbatim row: total, macOS, GPU)
- source: https://docs.github.com/en/actions/reference/limits ; https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; read 2026-10-09
- strength: stated

### CIP7 GitHub Actions: starting a job by API
- finding: A workflow with a `workflow_dispatch` trigger can be started with `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with a branch or tag as `ref` and at most 25 `inputs`; the fetch-tool summary says the response now carries the run id (status 200) instead of an empty 204.
- quote: "The maximum number of properties is 25." (verbatim, as relayed by the fetch tool) / "Response including the workflow run ID and URLs." (verbatim, as relayed)
- source: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event ; read 2026-10-09
- strength: stated (two fetch-tool reads agree on status 200 with the run id; both are summaries of the rendered page, the page source being generated from the API description and not read)

### CIP8 GitHub Actions: self-hosted runner cost, limits, network
- finding: GitHub's billing page says Actions usage is free for self-hosted runners; the docs say the user pays for the machine. A planned $0.002-per-minute "Actions cloud platform charge" for self-hosted runners (announced 2025-12-16 for 2026-03-01) was postponed and the changelog notice gives no new date. A runner needs only outbound HTTPS on port 443 and at least 70 kilobits per second; the docs name no inbound requirement for github.com. A job on a self-hosted runner may run 5 days. An assigned job not picked up within 60 seconds is re-queued; a job queued over 24 hours fails. Ephemeral just-in-time runners can be created with the REST API. If auto-update is turned off the runner must be updated within 30 days of a release. Registration limit 1,500 runners per 5 minutes per repository.
- quote: "We’re postponing the announced billing change for self-hosted GitHub Actions to take time to re-evaluate our approach." (verbatim, changelog banner) ; "Are free to use with GitHub Actions, but you are responsible for the cost of maintaining your runner machines." (verbatim, docs)
- source: https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/ ; https://docs.github.com/en/actions/concepts/runners/self-hosted-runners ; https://docs.github.com/en/actions/reference/runners/self-hosted-runners ; read 2026-10-09 ; USD
- strength: stated (billing, limits, ports). "No inbound access needed" is argued: the docs list only outbound requirements for github.com.

### CIP9 GitHub Actions: shape table (private repositories; no monthly cap exists, price is per minute only)
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | nearest: standard Linux 2-core (label `ubuntu-latest`), 2 vCPU, 8 GiB (4 GiB more) | VM on Azure; sharing not stated | $0.36 ($0.006 per minute) | none; 6 h job cap | 14 GB SSD | not stated |
| M: 4 vCPU, 8 GiB | nearest: larger runner Linux 4-core, 4 vCPU, 16 GiB (8 GiB more) | VM on Azure; sharing not stated | $0.72 ($0.012 per minute) | none; 6 h job cap | 150 GB SSD | not stated |
| L: 4 vCPU, 16 GiB | larger runner Linux 4-core, 4 vCPU, 16 GiB | VM on Azure; sharing not stated | $0.72 ($0.012 per minute) | none; 6 h job cap | 150 GB SSD | not stated |
- arm64 alternatives: standard Linux 2-core arm64 $0.30 an hour; larger Linux 4-core arm64 $0.48 an hour (16 GB, 150 GB).
- yardstick comparison (argued from the list rates above): standard-3 (2 vCPU 8 GiB) costs $0.076 to $0.220 an hour on Cloudflare, so the Actions standard runner at $0.36 is 1.6 to 4.7 times that; Cloudflare standard-4 $0.113 to $0.401 against the Actions 4-core $0.72 is 1.8 to 6.4 times.
- other answers: billed per minute, rounded up per job; nothing billed when no job runs; start, stop and destroy are not separate calls: a job exists for as long as the workflow run and is created by the dispatch API; a root shell exists inside a job (passwordless `sudo` on Linux, stated) but no interactive SSH is documented; outbound internet open (stated indirectly: runners "must establish connections to GitHub-owned endpoints" and "may require access to additional networks"); start-up time: not found; disk that persists, snapshots, traffic: runner disks do not persist after the job; artifact storage beyond the plan costs $0.25 per GB-month, cache $0.07 per GB-month; no charge for traffic is listed on the Actions billing page (grep for bandwidth, data transfer, egress: no hits in the page source).
- source: pages above ; strength: shown for the table values (derived from stated rates), stated for the quotes above.

### CIP10 GitHub Actions: terms of use that bear on running coding agents
- finding: GitHub's additional-products terms say that, even on self-hosted runners, Actions must not be used for cryptomining, for offering Actions as a commercial service, or for activity placing a burden disproportionate to its benefit, and that on GitHub-hosted runners it must not be used for activity unrelated to the production, testing, deployment or publication of the repository's software project. Another sentence, under the heading "Use for Development and Testing", is stricter: "You may only access and use GitHub Actions to develop and test your application(s)." Misuse can end jobs or suspend the account. Whether agent lanes writing the repository's code count is not decided by the text (argued: it is development of the repository's own project, so likely inside; not confirmed by GitHub).
- quote: "If using GitHub-hosted runners, any other activity unrelated to the production, testing, deployment, or publication of the software project associated with the repository where GitHub Actions are used." (verbatim)
- source: https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features ; read 2026-10-09 (page source via github/docs)
- strength: stated (the terms); argued (how they apply to the workload)

---

### CIP11 GitHub Codespaces: price per core-hour and storage
- finding: Compute is $0.18 an hour for 2 cores, $0.36 for 4, $0.72 for 8, $1.44 for 16 and $2.88 for 32 (so $0.09 a core-hour); storage is $0.07 per GB-month. Free allowance a month: GitHub Free personal accounts 120 core-hours and 15 GB-month; Pro 180 core-hours and 20 GB-month; none for organizations on Free or Team. Two reads agree (page source and the fetch tool).
- quote: "Codespaces compute | 4 core | 1 hour | 4 | $0.36" and "Codespaces storage | Storage | 1 GB-month | Not applicable | $0.07" (verbatim rows)
- source: https://docs.github.com/en/billing/concepts/product-billing/github-codespaces ; https://docs.github.com/en/billing/reference/product-usage-included ; read 2026-10-09 ; USD, list, no tax stated, no region
- strength: stated

### CIP12 GitHub Codespaces: machine sizes
- finding: GitHub states the range as 2 cores, 8 GB RAM, 32 GB storage up to 32 cores, 128 GB RAM, 128 GB storage. The intermediate rows are not on GitHub's pages that were read; a third-party blog and a skills page give 4 cores 16 GB RAM 32 GB storage, 8 cores 32 GB 64 GB, 16 cores 64 GB 128 GB (search-tool summary, third party, not the provider). The VM is dedicated to the user and gives "full root access to your container". Hosted on Azure VMs, Linux.
- quote: "from 2 cores, 8 GB RAM, and 32 GB storage, up to 32 cores, 128 GB RAM, and 128 GB storage." (verbatim)
- source: https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces ; read 2026-10-09 (page source via github/docs)
- strength: stated (end points); not found (provider table for the middle sizes; one search-tool, third-party only)

### CIP13 GitHub Codespaces: how long it runs, auto-stop, billing while stopped
- finding: A codespace stops after 30 minutes without activity by default; the user can set 5 to 240 minutes (also `gh codespace create --idle-timeout 90m`). Terminal input or output counts as activity and resets the timer. Whatever the idle setting, a codespace has a maximum lifetime of 12 hours even while in use; it saves, stops, and can be restarted. Compute is billed while the codespace is active; storage is billed for as long as the codespace exists, running or stopped. Stopped codespaces are deleted after 30 days by default. So the coachman (4 to 19 hours) does not fit one codespace session.
- quote: "A codespace has a maximum lifetime of 12 hours, regardless of your idle timeout policy or settings. This limit applies even while you are actively using the codespace." (verbatim)
- source: https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle ; https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces ; read 2026-10-09 (page source via github/docs) ; no price
- strength: stated

### CIP14 GitHub Codespaces: API and command-line control, limits, terms
- finding: Codespaces can be created, listed, stopped, deleted and entered with `gh codespace create | list | stop | delete | ssh` (stated); the REST API has a codespaces group with a machines endpoint (schema read; no example values). Start-up time: not found in the pages read. The number of codespaces a user may create and run at once is limited, with the numbers not given ("These limits vary based on a number of factors"). Terms: Codespaces "should not be used for" activity "unrelated to the development or testing of the software project associated with the repository" where the codespace is started; misuse can end access.
- quote: "gh codespace stop -c CODESPACE-NAME" (verbatim command) ; "Any other activity unrelated to the development or testing of the software project associated with the repository where GitHub Codespaces is initiated." (verbatim, terms)
- source: https://docs.github.com/en/codespaces/developing-in-a-codespace/using-github-codespaces-with-github-cli ; https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features ; https://docs.github.com/en/rest/codespaces/machines ; read 2026-10-09
- strength: stated (commands, terms, idle and 12 h limits); not found (start time, concurrent-codespace numbers: grep of the lifecycle and CLI pages, 0 hits for a number)

### CIP15 GitHub Codespaces: shape table
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | nearest: 2-core (8 GB RAM; 4 GiB more) | dedicated Azure VM (stated "dedicated and private") | $0.18 | none (usage billed hourly, 12 h lifetime cap per session) | 32 GB storage (stated), then $0.07 per GB-month | not stated |
| M: 4 vCPU, 8 GiB | nearest: 4-core (16 GB RAM per third parties; 8 GB more) | same | $0.36 | none | 32 GB (third party) | not stated |
| L: 4 vCPU, 16 GiB | 4-core, 16 GB RAM (RAM third party, price stated) | same | $0.36 | none | 32 GB (third party) | not stated |
- Core counts are called "cores"; whether a core is a vCPU or a hyper-thread is not stated on the pages read.
- Free allowance: a 2-core codespace spends 2 core-hours per hour, so 120 core-hours is 60 hours of 2-core a month on a free personal account, 90 hours on Pro (argued from "Included usage multiplier").
- yardstick comparison (argued): 4-core codespace at $0.36 an hour against Cloudflare standard-4 at $0.113 to $0.401: the same order of size as the busiest Cloudflare case; the 2-core $0.18 sits inside Cloudflare standard-3's $0.076 to $0.220 range. Hours are billed by wall-clock activity, not by CPU use.
---

### CIP16 Oracle Always Free: Ampere A1 allowance (now half of what it was)
- finding: (Oracle) Oracle's Always Free documentation now gives the Arm shape VM.Standard.A1.Flex 1,500 OCPU hours and 9,000 GB hours a month, equal to 2 OCPUs and 12 GB of memory, as one instance of 2 OCPUs or two of 1 OCPU. Earlier the allowance was 3,000 OCPU hours and 18,000 GB hours (4 OCPUs and 24 GB); (third party) InfoQ dated 2026-07-03 says the cut took effect on 2026-06-15 without an announcement, and a forum post quotes an Oracle notice with 2026-08-18; the dates are not reconciled. Two reads of Oracle's page agree on the new numbers (two fetch-tool calls with different wording); third parties agree.
- quote: "All tenancies get the first 1,500 OCPU hours and 9,000 GB hours per month for free for VM instances using the VM.Standard.A1.Flex shape" ; "For Always Free tenancies, this is equivalent to 2 OCPUs and 12 GB of memory." (verbatim, Oracle docs via the fetch tool)
- source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm ; https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/ (third party, 2026-07-03) ; read 2026-10-09 ; USD, no charge
- strength: stated (Oracle's page); the change's date is third-party only

### CIP17 Oracle Always Free: AMD micro, storage, traffic, region
- finding: (Oracle) Up to two AMD VM.Standard.E2.1.Micro instances, each 1/8 OCPU (burstable) with 1 GB memory and up to 50 Mbps; 200 GB of Always Free block volume in total (minimum boot volume 47 GB, one place on the page says 50 GB); 10 TB of outbound data a month; the instances must be in the tenancy's home region; Always Free is not available in US Government Cloud regions. The 1 GB micro is too small for any lane.
- quote: "Processor: 1/8th of an OCPU with the ability to use additional CPU resources" ; "you get 10 TB per month of outbound data." ; "You must create the Always Free compute instances in your home region." (verbatim, Oracle docs via the fetch tool)
- source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm ; https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm ; read 2026-10-09
- strength: stated (one read for the boot-volume 47 GB versus 50 GB conflict, both on the same page)

### CIP18 Oracle Always Free: idle reclamation
- finding: (Oracle) "Idle Always Free compute instances may be reclaimed by Oracle." An instance is idle if, over a 7-day period, the 95th percentile of CPU use is under 20%, network use is under 20%, and (A1 shapes only) memory use is under 20%. The page does not say whether the rule applies to Pay As You Go accounts. A coding-agent box that waits on APIs is close to idle by this test unless memory use is over 20% of 12 GB (about 2.4 GB), which a real lane would exceed.
- quote: "Oracle will deem virtual machine and bare metal compute instances as idle if, during a 7-day period, the following are true:" then "CPU utilization for the 95th percentile is less than 20%" ; "Network utilization is less than 20%" (verbatim, Oracle docs via the fetch tool)
- source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm ; read 2026-10-09
- strength: stated; the last sentence is argued

### CIP19 Oracle Always Free: over-limit instances, trial end, account closure
- finding: (Oracle) If more A1 instances are provisioned than an Always Free tenancy allows, "all existing OCI Ampere A1 Compute instances are disabled and then deleted after 30 days, unless you upgrade to a paid account." After the Free Trial the account stays active and Always Free resources keep running. Most users need a phone number and a credit card; the card is not charged unless the account is upgraded. (Oracle) The pages read say nothing on inactivity or on termination of the account itself ("Not on this page"; two pages, one read each). (third party) Forum posts say A1 instances were disabled after the limit change and when trials ended, that some were terminated with no reason given, and that free accounts cannot ask support to raise limits; InfoQ says support emails told some Pay As You Go users the new limits apply only to free-tier accounts, which Oracle's docs do not say.
- quote: "all existing OCI Ampere A1 Compute instances are disabled and then deleted after 30 days, unless you upgrade to a paid account." (verbatim, Oracle docs via the fetch tool)
- source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm ; InfoQ above ; Oracle community posts via the search tool (anecdotes) ; read 2026-10-09
- strength: stated (the disable-and-delete rule); not found on the two docs pages (Oracle's text on account termination: 0 hits; the FAQ on oracle.com gave HTTP 403 to the fetch tool, but see the later entry "Oracle: account-level inactivity and termination" for what two search summaries of the FAQ say); anecdotes are third-party and unverified

### CIP20 Oracle Always Free: capacity ("out of host capacity")
- finding: (third party) New Arm capacity is often unavailable in busy regions; resizing an instance behaves like a fresh launch and may fail for lack of capacity; one user could not upgrade to Pay As You Go for three days because of capacity errors. Oracle's pages read do not mention it ("Out-of-capacity messages: Not on this page").
- quote: paraphrase of a search-tool summary of Oracle community posts; no exact text kept
- source: https://community.oracle.com/customerconnect/categories/oci-arm-compute ; https://terminalbytes.com/oracle-cloud-free-tier-changes-2026 (listed by search, not fetched) ; read 2026-10-09
- strength: not found in Oracle's docs (the compute troubleshooting page has 0 hits on "out of host capacity"); anecdotes only (two the search tooles, results all community posts or blogs)

### CIP21 Oracle OCI: pay-as-you-go list prices (the free tier's paid counterpart), from Oracle's public cost-estimator data
- finding: Oracle's public price data (the JSON behind its cost estimator, no sign-in) lists, in USD: Arm A1 OCPU $0.01 per OCPU-hour and A1 memory $0.0015 per GB-hour; x86 AMD E4 OCPU $0.025 per OCPU-hour and E4 memory $0.0015 per GB-hour; block volume storage $0.0255 per GB-month plus $0.0017 per performance unit per GB-month; outbound data $0 for the first 10,240 GB a month, then $0.0085 per GB (origin North America, Europe, UK). The A1 price rows still carry a free range of 0 to 3,000 OCPU-hours and 0 to 18,000 GB-hours a month on pay-as-you-go, which is the OLD free allowance and disagrees with the docs page's 1,500 and 9,000. Both are recorded: the docs page says 2 OCPUs and 12 GB, the price data says 4 OCPUs and 24 GB for pay-as-you-go. InfoQ (third party) reports support emails saying pay-as-you-go accounts keep the old amount. Every row was read twice, with different prompts, with the same result.
- quote: {"displayName": "Compute - Standard - A1 - OCPU", "metricName": "OCPU Per Hour", PAY_AS_YOU_GO value 0 rangeMin 0 rangeMax 3000; value 0.01 rangeMin 3000} (paraphrase of JSON)
- source: https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD&partNumber=B93297 (also B93298 A1 memory, B93113 E4 OCPU, B93114 E4 memory, B91961 block volume, B88327 outbound) ; read 2026-10-09 via the fetch tool ; USD, list pay-as-you-go, excluding tax, no region qualifier except the transfer row
- strength: stated (two reads of Oracle's published cost-estimator data, all rows); the disagreement with the docs page is itself a finding (stated on both sides)

### CIP22 Oracle OCI: how a core is counted, billing granularity, limits
- finding: (Oracle) 1 OCPU on Arm A1 is one core, one vCPU; 1 OCPU on x86 is 2 vCPUs. VM.Standard.A1.Flex goes from 1 to 76 OCPUs and up to 472 GB, 1 Gbps network per OCPU up to 40 Gbps. Resources "are billed at a per-second granularity with a one-minute minimum". Billing of a stopped instance: not on the two pages read; see the later entry "Oracle: billing of a stopped instance".
- quote: "1 OCPU on Arm A1 (Compute) = 1 core on Arm A1 (Compute) or 1 vCPU" ; "These resources are billed at a per-second granularity with a one-minute minimum." (verbatim, via the fetch tool, one read)
- source: https://docs.oracle.com/en-us/iaas/Content/Compute/References/computeshapes.htm ; read 2026-10-09
- strength: stated (one read); not found (stopped-instance billing: 2 pages, 0 hits)

### CIP23 Oracle OCI: shape table (pay-as-you-go list rates, before any free allowance; computed from the rows above)
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
| S: 2 vCPU, 4 GiB | VM.Standard.A1.Flex 2 OCPU + 4 GB (exact); x86 E4.Flex 1 OCPU (2 vCPU) + 4 GB | Ampere A1 Arm core (1 OCPU = 1 vCPU); E4 is AMD, 1 OCPU = 2 vCPU | A1 $0.026 (2x0.01 + 4x0.0015); E4 $0.031 (0.025 + 4x0.0015) | none; 730 h is $18.98 on A1, $22.63 on E4 | none; boot volume extra: $0.0255 per GB-month plus $0.0017 per performance unit per GB-month (10 units assumed), minimum 47 GB | first 10 TB a month outbound |
| M: 4 vCPU, 8 GiB | A1.Flex 4 OCPU + 8 GB; E4.Flex 2 OCPU (4 vCPU) + 8 GB | same | A1 $0.052; E4 $0.062 | 730 h: $37.96 A1, $45.26 E4 | same | same |
| L: 4 vCPU, 16 GiB | A1.Flex 4 OCPU + 16 GB; E4.Flex 2 OCPU + 16 GB | same | A1 $0.064; E4 $0.074 | 730 h: $46.72 A1, $54.02 E4 | same | same |
- yardstick comparison (argued): Cloudflare standard-3 is $0.076 to $0.220 an hour for 2 vCPU 8 GiB; the same on A1 is 2x0.01 + 8x0.0015 = $0.032 an hour, 42% of Cloudflare's idle rate and 15% of its busy rate. Cloudflare standard-4 (4 vCPU 12 GiB) is $0.113 to $0.401; A1 4 OCPU + 12 GB is $0.058 an hour. Oracle bills the reservation whether busy or not.
- free allowance (Oracle docs): 2 OCPUs and 12 GB of A1 (one instance of 2 OCPUs, or two of 1 OCPU) plus 200 GB block volume: this is one lane-sized machine, not several, and 12 GB is below the 12 to 16 GiB the coachman and gate have needed.
- not read: launch and terminate commands; root on a new instance; start-up time; longest run. See Not checked and "Consolidated answers".

### CIP24 Oracle OCI: command-line control
- finding: (Oracle) `oci compute instance action` powers an instance on or off with `--action START | STOP | SOFTSTOP | RESET | SOFTRESET ...`; SOFTSTOP waits up to 15 minutes for the OS before powering off. So an Oracle instance can be started and stopped by command; launch and terminate commands were not read.
- quote: "STOP - Powers off the instance." ; "SOFTSTOP - Gracefully shuts down the instance by sending a shutdown command to the operating system." (verbatim, one read)
- source: https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/instance/action.html ; read 2026-10-09
- strength: stated

---

### CIP25 Tailscale: free Personal plan limits
- finding: The Personal plan is "$0 Free forever" with up to 6 users and unlimited user devices; up to 3 ACL groups; up to 50 tagged resources "to start"; 1,000 minutes a month for ephemeral resources; and "Basic Tailscale SSH: Up to 5 hosts". The cheapest paid plan shown is Standard at $8 per user per month. Two reads agree.
- quote: "Basic Tailscale SSH" / "Up to 5 hosts" ; "Up to 6 users" ; "Unlimited user devices" (verbatim, the page's text as relayed by the fetch tool)
- source: https://tailscale.com/pricing ; read 2026-10-09 ; USD, per user per month for paid plans, tax not stated
- strength: stated (two reads). The 5-host limit on Tailscale SSH is the figure that matters for the study: more than five machines accepting Tailscale SSH needs a paid plan, argued from the table row.

### CIP26 Tailscale SSH: what it does and what it needs
- finding: Tailscale SSH lets Tailscale manage authentication and authorization of SSH connections inside the tailnet: no SSH keys are needed, access follows the tailnet policy, and it works on port 22 only over the tailnet. The destination runs `tailscale set --ssh` (or `tailscale up --ssh`); servers are Linux and the open-source macOS build; Windows is not listed as a server. A policy needs a network grant and an `ssh` rule with `src`, `dst`, `users` and `action` (`accept`, or `check`, which makes the user re-authenticate through the identity provider, every 12 hours by default). Only existing host accounts are used; root is allowed by default policy. Restarting `tailscaled` ends sessions.
- quote: "Tailscale SSH lets Tailscale manage the authentication and authorization of SSH connections in your tailnet." ; "An SSH access rule from a tagged device cannot be in check mode." (verbatim, via the fetch tool, one read)
- source: https://tailscale.com/kb/1193/tailscale-ssh ; read 2026-10-09
- strength: stated (two reads agree on the tagged-device and check-mode rule, accept versus check, and the server platforms; one read for the rest)

### CIP27 Tailscale: what can stop a program on one machine starting a process on another over Tailscale SSH
- finding: (all from the pages read; the list is the author's reading of them) 1) no `ssh` rule in the policy from the caller's identity or tag to the target, or the target account not in `users`; 2) the target is not running with SSH enabled, or is a Windows host; 3) the rule is in `check` mode, which needs a person to re-authenticate in a browser, and a rule from a tagged device cannot be `check`, so unattended callers must be covered by an `accept` rule; 4) the free plan allows Tailscale SSH on 5 hosts; 5) the target's node key has expired, after which "connections to/from the given endpoint will stop working" until it is re-authenticated; 6) the target is asleep or offline (argued; see the laptop entry).
- quote: "If reauthentication does not occur, keys expire and connections to/from the given endpoint will stop working." (verbatim, via the fetch tool)
- source: https://tailscale.com/kb/1193/tailscale-ssh ; https://tailscale.com/kb/1028/key-expiry ; https://tailscale.com/pricing ; read 2026-10-09
- strength: stated for items 1 to 5; argued for 6

### CIP28 Tailscale: names, ACLs and how one machine reaches another
- finding: MagicDNS registers a name for each device: a machine called `monitoring` is reachable by that short name or by a full name made of the machine name, the tailnet's own name and `ts.net` (the short name works through the search domain); tailnets created on or after 2022-10-20 have it on by default; it is on all plans and needs no DNS nameserver on client 1.20 or later. Access is decided by the tailnet policy file (ACLs, grants, `ssh` rules).
- quote: "Tailnets created on or after October 20, 2022 have MagicDNS enabled by default." (verbatim, via the fetch tool)
- source: https://tailscale.com/kb/1081/magicdns ; read 2026-10-09
- strength: stated (one read)

### CIP29 Tailscale: headless servers, auth keys, key expiry
- finding: A headless server joins with an auth key (a pre-authentication key), so no browser sign-in is needed. Auth keys expire in 1 to 90 days, default 90; options are reusable, ephemeral (removed after the device goes offline), pre-approved and tagged; keys can be created by the API with an OAuth client. A device authorized by a key "remains authorized until its node key expires". Node keys expire after 180 days by default (1 to 180 days can be set); tagged devices have key expiry disabled by default; an admin can also disable expiry for a device.
- quote: "If an auth key expires, any device authorized by it remains authorized until its node key expires." ; "By default, new domains are set with an expiry period of 180 days." (verbatim, via the fetch tool, two reads each)
- source: https://tailscale.com/kb/1085/auth-keys ; https://tailscale.com/kb/1028/key-expiry ; read 2026-10-09
- strength: stated (two reads each, agree)

### CIP30 Tailscale: a sleeping laptop
- finding: No Tailscale page that was found says in so many words that a sleeping laptop is unreachable. It follows from the device not running (argued): Tailscale cannot wake a sleeping device itself; its blog shows waking one with Wake-on-LAN through an always-on helper on the same network. On Windows and macOS the client by default runs inside the user's login session; Tailscale's own guidance for a connection that does not return after wake is `tailscale down` then `tailscale up`.
- quote: paraphrase of search results; the pages are https://tailscale.com/blog/wake-on-lan-tailscale-upsnap and https://tailscale.com/docs/how-to/run-unattended (listed by the search tool, not fetched)
- source: The search tool limited to tailscale.com ; read 2026-10-09
- strength: argued; not found as an explicit sentence (1 search, 10 hits, none stating it)

---

### CIP31 Claude Code on Android: not a supported platform (DOCUMENTED) and broken on Termux since v2.1.113 (ISSUE)
- finding: Anthropic's setup page lists macOS 13+, Windows 10 1809+, Ubuntu 20.04+, Debian 10+ and Alpine 3.19+, x64 or ARM64, 4 GB+ RAM; it names no Android, Termux or iOS, and its list of npm platform binaries has no android entry (stated by absence). Open issue anthropics/claude-code #50270 (opened 2026-04-18, updated 2026-10-06, 72 comments): from v2.1.113 Claude Code ships a native glibc Linux binary instead of a JavaScript entry point, Termux reports `process.platform` as `android` and uses bionic libc, so the install step skips the binary and the glibc ELF is rejected ("has unexpected e_type: 2"); v2.1.112 (JavaScript) works; running under `proot-distro` Ubuntu works but "too slow for interactive use" per the reporter; a later comment (2026-08-22) says proot has "a real filesystem-I/O penalty". A community build (`gtbuchanan/claude-code-termux` with `termux-exec`) is reported working end to end on a Pixel 2, Android 11, with Claude Code 2.1.280, including login and an Opus request (2026-09-23). Also open: #15637, `/tmp/claude` paths hard-coded, `/tmp` not writable in Termux.
- quote: "Starting with v2.1.113, Claude Code switched from a JavaScript entry point (cli.js) to a native glibc Linux binary (bin/claude.exe). This completely breaks Claude Code on Termux (Android)" (verbatim, issue body, reporter's words)
- source: https://code.claude.com/docs/en/setup (docs, read 2026-10-09, full page text) ; https://github.com/anthropics/claude-code/issues/50270 ; https://github.com/anthropics/claude-code/issues/15637 ; read 2026-10-09
- strength: stated (supported platforms, by absence); shown (user reports with versions and error text). An Anthropic collaborator replied on 2026-04-23 that Android "may" be added; see the later entry "Anthropic's reply on Android support".

### CIP32 Codex CLI on Android/Termux (ISSUE)
- finding: openai/codex #11809 (open, reopened; opened 2026-02-14, updated 2026-07-07): on native Termux, login by ChatGPT and by device code both fail with "Stream disconnected before completion"; the reporter traces DNS to 127.0.0.1:53 because Android has no `/etc/resolv.conf`; copying `~/.codex/auth.json` from another machine lets Codex start, but requests still fail in use. Comments (2026-05 and 2026-07) report a working native Termux setup with pnpm settings and a proot setup with a bound `/etc/resolv.conf` and `CODEX_CA_CERTIFICATE`; one user says under proot every tool call makes Codex wait about 40 seconds. A third party mirrors Codex releases with Termux fixes (`wallentx/codex-termux`). #2951 (closed 2026-04-10): `npm i -g @openai/codex` fails on Android ("Unknown platform: android" from a ripgrep dependency); a commenter said the installed Linux musl build runs "enough to launch" but some network operations fail on bionic, and building from source works.
- quote: "Codex CLI does not function correctly on native Termux / Android. There are multiple related failure modes." (verbatim, issue body, reporter's words, backslashes removed)
- source: https://github.com/openai/codex/issues/11809 ; https://github.com/openai/codex/issues/2951 ; read 2026-10-09
- strength: shown (user reports); no OpenAI documentation of Android support was found: the Codex CLI docs page was read afterwards and has no Android, Termux or iOS text (see "Supported platforms by the vendors" below)

### CIP33 Bun on Android/Termux (ISSUE + PR)
- finding: Bun has no official Android build. Pull request oven-sh/bun #29675 "Add aarch64-linux-android target" was opened by a Bun maintainer's account on 2026-04-24 and was closed on 2026-04-26 without being merged (checked: merged=false). Issue #30859 (opened 2026-05-15, Bun 1.3.14 on Termux aarch64): `bun run` and `bun x` failed with "CouldntReadCurrentDirectory", `bun build` with "Cannot read directory /data/"; closed 2026-08-13 by the bot as fixed by #33119 (the resolver treated an unreadable parent directory as fatal); the fix is in canary builds (`bun upgrade --canary`), and one commenter could not get a canary on their device. So Bun runs on Termux in some builds, with filesystem bugs that were fixed in canary in August 2026.
- quote: "Closing as fixed by #33119 ... the resolver walked every ancestor of the working directory and treated an unreadable one as fatal. On Termux the ancestors are /data and /data/data" (verbatim excerpt, bot comment 2026-08-13)
- source: https://github.com/oven-sh/bun/issues/30859 ; https://github.com/oven-sh/bun/pull/29675 ; read 2026-10-09
- strength: shown (issue and PR text); Bun's installation page was read afterwards and lists no Android (see "Supported platforms by the vendors" below)

### CIP34 Android kills background processes: the phantom process limit (DOCUMENTED by Termux, source-linked)
- finding: The Termux README warns "Termux may be unstable on Android 12+": the system kills phantom (child) processes over 32, the limit being for all apps combined, and kills processes using excessive CPU, shown in the shell as `[Process completed (signal 9)]`. A Termux maintainer's document (with Android source links) says Android 12 added the monitor and a default of 32 (`DEFAULT_MAX_PHANTOM_PROCESSES = 32`); the excessive-CPU check runs every 5 minutes (`POWER_CHECK_INTERVAL`); on Android 12 no setting can switch off the CPU killing, only the 32 limit through `adb`/root (`max_phantom_processes`); from Android 12L beta 3 the flag `settings_enable_monitor_phantom_procs` turns off both; on Android 14 and later the toggle is Settings > System > Developer options > "Disable child process restrictions", and it switches back on if Developer options are turned off. A coding agent that spawns many shell and test processes (a gate run) is the shape of workload this limit hits. Unrooted: the toggle needs a person at the phone, or `adb` over Wireless debugging.
- quote: "Android OS will kill any (phantom) processes greater than 32 (limit is for all apps combined) and also kill any processes using excessive CPU." (verbatim, termux-app README)
- source: https://github.com/termux/termux-app (README, read with gh api) ; https://github.com/agnostic-apollo/Android-Docs/blob/master/en/docs/apps/processes/phantom-cached-and-empty-processes.md ; Google issue 205156966 (cited, not read) ; read 2026-10-09
- strength: stated (README, maintainer's document citing Android source); the toggle name on Android 14 is in the maintainer's document, not a Google page (Google's documentation not found: not searched beyond one search-tool)

### CIP35 Android: battery optimisation and doze
- finding: The Termux README tells users to make sure "battery optimizations are disabled for the app" and links dontkillmyapp.com (it says this about the F-Droid updater app, not about running agents). Android's own Doze and App Standby page was read later; see the next entry for it. Termux's acquire-wakelock notification and its effect on Doze were not read.
- quote: "Make sure battery optimizations are disabled for the app, check https://dontkillmyapp.com/ for details on how to do that." (verbatim, termux-app README)
- source: https://github.com/termux/termux-app (README) ; read 2026-10-09
- strength: stated (the instruction)

### CIP36 Android Doze and App Standby (DOCUMENTED by Android)
- finding: Android's own page: when a device is left unplugged and stationary with the screen off it enters Doze, which suspends network access and ignores wake locks, defers alarms, and stops JobScheduler and sync; a periodic maintenance window lets apps run and reach the network for a short time. App Standby treats an app as idle unless it is in the foreground (activity or foreground service) or shows a notification; plugging in a charger releases apps and ends Doze. So a phone running an agent in a terminal app, unplugged on a desk with the screen off, loses network access outside the windows; plugged in, it does not (stated). Whether a foreground service (Termux's notification) is enough to stay out of Doze is not stated on the page: it exempts foreground services from App Standby but says Doze "ignores wake locks".
- quote: "If a user leaves a device unplugged and stationary for a period of time, with the screen off, the device enters Doze mode." ; Doze "Suspends network access." and "Ignores wake locks." (verbatim, via the fetch tool, two reads)
- source: https://developer.android.com/training/monitoring-device-state/doze-standby ; read 2026-10-09
- strength: stated (two reads agree)

### CIP37 iPhone and iPad: no native coding-agent CLI (DOCUMENTED tools, ANECDOTE for the verdicts)
- finding: None of the three iOS tools hosts a Linux x64 or arm64 binary natively. iSH is "a Linux shell running on iOS, using usermode x86 emulation and syscall translation" (README); its tracker has closed issues titled "32 bit architecture is obsolete" (#1455), "64 architecture" (#1383), "Illegal Instruction in NodeJS" (#917) and "Nodejs not working on latest version (Illegal instruction)" (#1482), "node/npm needs SSE" (#90): the emulator is 32-bit x86 (argued from these titles; not confirmed on a doc page), so a 64-bit Bun or Claude Code binary cannot run on it (argued). a-Shell runs commands built for iOS and WebAssembly programs with "no sockets, no forks"; it ships Python, Lua, JS, C and C++ through clang to WebAssembly, and has no mention of Node or git-worktree workloads in the README text searched. UTM (QEMU) runs full virtual machines on iPhone and iPad; the README says it needs JIT for speed, which "on iOS devices require[s] either a jailbroken device, or one of the various workarounds"; UTM SE ("slow edition") uses a threaded interpreter and "does not require jailbreaking or any JIT workarounds" and can be sideloaded. So a Linux VM with root, git, Bun and the CLIs is possible in UTM SE at interpreter speed (argued; not tested by anyone read).
- quote: "UTM/QEMU requires dynamic code generation (JIT) for maximum performance. JIT on iOS devices require either a jailbroken device, or one of the various workarounds" (verbatim, UTM README) ; "We have the limitations of WebAssembly: no sockets, no forks" (verbatim, a-Shell README)
- source: https://github.com/ish-app/ish ; https://github.com/holzschu/a-shell ; https://github.com/utmapp/UTM ; iSH issues #1455 #1383 #917 #1482 #90 ; read 2026-10-09 with gh api
- strength: stated (what each tool is); shown (issue titles); argued (the verdict that no coding-agent CLI runs on them)

### CIP38 Supported platforms by the vendors (second look): Bun and Codex CLI
- finding: Bun's installation page lists macOS, Linux (x64 and arm64, glibc and musl) and Windows, kernel 5.6 or newer recommended (3.10 tolerated), x64 CPUs need SSE4.2; it does not mention Android or Termux (stated by absence, one read). Codex CLI's page (moved from developers.openai.com to learn.chatgpt.com) says "Install the Codex CLI with the standalone installer for macOS and Linux", with npm, Homebrew and Windows tabs; Android, Termux and iOS are not on the page, and "ChatGPT mobile app" appears as a separate surface under "Available on" (one read each).
- quote: "Install the Codex CLI with the standalone installer for macOS and Linux." (verbatim, Codex docs via the fetch tool) ; Bun: "Install it with the install script, a package manager, or Docker on macOS, Linux, and Windows." (verbatim)
- source: https://bun.sh/docs/installation ; https://learn.chatgpt.com/docs/codex/cli (redirect from https://developers.openai.com/codex/cli, a 308 to a different host, followed on purpose) ; read 2026-10-09
- strength: stated (by absence); not found (any Android statement: 2 pages, 0 hits)

---

### CIP39 Electricity tariff (yardstick)
- finding: US average residential electricity price, July 2026: 18.31 cents per kWh (July 2025: 17.45), a preliminary estimate.
- quote: "Table 5.6.A. Average Price of Electricity to Ultimate Customers by End-Use Sector, by State, July 2026 and 2025 (Cents per Kilowatthour)" ; Residential July 2026 "18.31" (verbatim title; value as relayed by the fetch tool)
- source: https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a ; read 2026-10-09 ; US cents per kWh, taxes included as the survey defines them (not checked), national average
- strength: stated (two reads agree)

### CIP40 Raspberry Pi 5 8 GB: price to buy
- finding: The maker's price for the 8 GB Pi 5 has risen with memory costs: $80 at launch; $95 from 2025-12-01 (+$15); then a published increase of $30 for 8 GB products (post dated 2026-02-02, so $125); then $50 more for 8 GB (post dated 2026-04-01, so $175). The $175 is the sum of three posts (the December post read once, the February and April posts twice each), not a price read off a product page. Cross-check: the same three posts take the 16 GB board from $120 to $145 to $205 to $305, and the maker's product page, read once, says "Raspberry Pi 5 16GB is available now for $305". A community forum summary (third party) lists $175 for the 8 GB as of 2026-04-12. Nothing newer than 2026-04-01 was found in one search, so a later change is not excluded. Power supply (5 V at 5 A, 25 W per the docs table) and storage are extra and were not priced.
- quote: "Raspberry Pi 5 | 8GB | $80 | $95" (verbatim, 2025-12-01 post) ; "| Raspberry Pi 4 and 5 | 8GB | $50 |" (verbatim, 2026-04-01 post, column "Price increase")
- source: https://www.raspberrypi.com/news/1gb-raspberry-pi-5-now-available-at-45-and-memory-driven-price-rises/ ; https://www.raspberrypi.com/news/more-memory-driven-price-rises/ ; https://www.raspberrypi.com/news/a-new-3gb-raspberry-pi-4-for-83-75-and-more-memory-driven-price-increases/ ; https://www.raspberrypi.com/products/raspberry-pi-5/ ; read 2026-10-09 ; USD, before local taxes
- strength: stated for each increase (December one read, February and April two reads each); argued for the $175 total

### CIP41 Raspberry Pi 5: power draw and cost to run
- finding: The maker's pages read give no consumption figure (product page and docs page: "not on page"). Third-party measurements (Jeff Geerling, 2024, and raspberry.tips, 2026): about 3.2 to 3.3 W idle and about 9.8 W under a stress-ng CPU load for the 4 GB and 8 GB boards; raspberry.tips reports about 8.8 W for its 4 GB board at full load, and a separate table with 12 to 25 W for 8 GB that its own text does not explain. At $0.1831 per kWh: 3.3 W costs $0.0006 an hour ($0.44 for 730 hours), 9.8 W costs $0.0018 an hour ($1.31 for 730 hours). CPU: 4 cores, Cortex-A76 at 2.4 GHz; up to 16 GB RAM, so the 8 GB board covers one lane, not the 12 to 16 GiB the coachman and gate have needed (the 16 GB board costs $305).
- quote: "Broadcom BCM2712 2.4GHz quad-core 64-bit Arm Cortex-A76 CPU" (verbatim, maker's product page) ; third-party figures are paraphrased from a search-tool summary
- source: https://www.raspberrypi.com/products/raspberry-pi-5/ ; https://www.jeffgeerling.com/blog/2024/new-2gb-pi-5-has-33-smaller-die-30-idle-power-savings/ ; https://raspberry.tips/en/?p=9083 (both listed by search, not fetched) ; read 2026-10-09
- strength: stated (CPU, RAM, supply); not found in the maker's pages (consumption); third-party only for the watts

### CIP42 Mac mini (M6): price to buy and power draw
- finding: Apple's newsroom (2026-08-25): "Mac mini with M6 starts at $899 (U.S.) and $799 (U.S.) for education"; with M5 Pro $1,699 ($1,599 education); on sale from 2026-09-22. M6 has 16 GB standard unified memory, configurable to 32 GB; the store page lists M6 with a 12-core CPU and 12-core GPU, 16 GB and 256 GB as one configuration. Apple's support page (power at the wall; idle means only Finder open): Mac mini M6, 16 GB/256 GB: idle 4 W, maximum 70 W; M4: 4 W and 65 W; M2: 7 W and 50 W. At $0.1831 per kWh: M6 idle $0.0007 an hour ($0.53 for 730 hours), at the 70 W maximum $0.0128 an hour ($9.36 for 730 hours). Apple's own Mac mini and store pages showed no price to the fetch tool (script-rendered); the price is from the newsroom, read twice (search-tool summary, then a fetch-tool read of the page).
- quote: "Mac mini with M6 starts at $899 (U.S.) and $799 (U.S.) for education." (verbatim, Apple newsroom, 2026-08-25) ; support page rows relayed by the fetch tool: Mac mini (M6) "Idle 4 W, Max 70 W"
- source: https://www.apple.com/newsroom/2026/08/apple-unveils-a-more-powerful-mac-mini-featuring-the-all-new-m6-and-m5-pro/ ; https://support.apple.com/en-us/103253 ; https://www.apple.com/shop/buy-mac/mac-mini ; read 2026-10-09 ; USD, before sales tax
- strength: stated (price twice; power twice)

### CIP43 Owned hardware as a yardstick (computed, assumptions stated)
- Assumptions: price spread over 3 years of 24-hour use (26,280 hours), no resale, no interest, plus electricity at $0.1831 per kWh; accessories not counted. These are the reader's, not a source's.
- Pi 5 8 GB ($175): $0.0067 an hour of purchase price plus $0.0006 to $0.0018 of electricity, so about $0.007 to $0.009 an hour. Pi 5 16 GB ($305): $0.0116 plus the same power, about $0.012 to $0.014.
- Mac mini M6 16 GB ($899): $0.0342 an hour plus $0.0007 (idle) to $0.0128 (full load) of electricity, so about $0.035 to $0.047 an hour. The Mac mini is the one that fits the coachman's 12 to 16 GiB.
- Against Cloudflare's rates (argued): Cloudflare standard-3 is $0.076 to $0.220 an hour and standard-4 is $0.113 to $0.401. The Mac mini ($0.035 to $0.047) is 16% to 62% of standard-3's $0.076 to $0.220 (lowest over highest, highest over lowest), and the Pi 5 8 GB ($0.007 to $0.009) is under 12% of even its idle rate, but only while the machine runs 24 hours a day for three years; used a few hours a day, the purchase price per hour of use is several times higher.
---

### CIP44 Oracle: account-level inactivity and termination (the provider's FAQ)
- finding: Oracle's Free Tier FAQ is reported, in two search-tool summaries of the same page (the fetch tool got HTTP 403, so the page itself was not read), to say that accounts left idle for 30 days or more may be deemed abandoned and become eligible for suspension or termination, and that reclaimed resources cannot be recovered. A third party's forum reports (Oracle's own Customer Connect board) of Free Tier instances terminated "without warning" or "by internal system without notice" exist; those are individual reports. The same FAQ is reported to say that a paid (Pay As You Go) account keeps access to Always Free resources.
- quote: "Accounts left idle for 30 days or more may be deemed abandoned and become eligible for suspension or termination." (verbatim as relayed by the search tool's summary; the page text was not read)
- source: https://www.oracle.com/cloud/free/faq/ (via the search tool only) ; https://community.oracle.com/customerconnect/discussion/875400/free-tier-instance-terminated-without-warning-need-urgent-help-recovering-data (listed, not fetched) ; read 2026-10-09
- strength: stated (two search-summary reads agree; not a direct read of the page)

### CIP45 Oracle: billing of a stopped instance
- finding: (Oracle, "Resource Billing for Stopped Instances", via a search summary) for standard shapes, stopping an instance pauses billing for the instance, but stopped instances still count toward service limits; Dense I/O, most GPU and HPC shapes keep being billed until terminated. Boot volumes and network traffic are "billed separately from the compute instance". The page is about 22 months old by its metadata. Whether the A1.Flex shape counts as a "standard shape" there was not shown in the summary (argued yes: its name is VM.Standard.A1.Flex).
- quote: "Standard shapes: Stopping an instance pauses billing. However, stopped instances continue to count toward your service limits." (verbatim as relayed by the search summary)
- source: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/resource-billing-stopped-instances.htm (via the search tool only) ; read 2026-10-09
- strength: stated (one read, search summary)

### CIP46 Codespaces: REST endpoints to create, stop, start and delete
- finding: The REST API has `POST /repos/{owner}/{repo}/codespaces` (create in a repository), `POST /user/codespaces` (create for the authenticated user), `POST /user/codespaces/{codespace_name}/stop`, `POST /user/codespaces/{codespace_name}/start` and `DELETE /user/codespaces/{codespace_name}`. So a codespace can be driven by an API as well as by `gh codespace`.
- quote: "Stop a codespace for the authenticated user POST /user/codespaces/{codespace_name}/stop" (verbatim, as relayed by the fetch tool)
- source: https://docs.github.com/en/rest/codespaces/codespaces ; read 2026-10-09
- strength: stated (one read)

### CIP47 Anthropic's reply on Android support (a vendor staff comment on the public tracker)
- finding: On issue #50270 an account with the COLLABORATOR association on anthropics/claude-code, 2026-04-23, wrote that the switch to a native executable "drops support for some platforms", that Anthropic "may add support for Android in the future", that this "requires either a bun target for android-arm64 or static musl", and that users can pin 2.1.112, the last JavaScript bundle. The issue is labelled `platform:android`, `regression`, `area:packaging` and is still open (updated 2026-10-06). Bun's own android target pull request (#29675) was closed without merging on 2026-04-26. On the Codex issue #11809 (labels bug, auth, CLI) no comment by an organisation member or collaborator was found among those fetched.
- quote: "We may add support for Android in the future - this requires either a bun target for android-arm64 or static musl." (verbatim, vendor staff, issue comment)
- source: https://github.com/anthropics/claude-code/issues/50270 ; https://github.com/openai/codex/issues/11809 ; read 2026-10-09 with gh api
- strength: stated (a vendor's staff on its own tracker; not a documentation page)

### CIP48 GitHub plan prices that gate the larger runners
- finding: Larger runners need an organisation on the Team or Enterprise Cloud plan. GitHub's pricing page labels Team "$4 USD per user/month for the first 12 months*" and Enterprise "$21 USD per user/month for the first 12 months*"; the footnote the asterisk points to, and any price after the first 12 months, was not in the text the fetch tool returned (two reads, same labels, no footnote). Free is $0 with 2,000 Actions minutes a month; Team lists 3,000 and Enterprise 50,000.
- quote: "$ 4 USD per user/month for the first 12 months*" (verbatim, as relayed by the fetch tool)
- source: https://github.com/pricing ; read 2026-10-09 ; USD per user per month, tax not stated
- strength: stated for the labels (two reads); not found for the price after 12 months

### CIP49 Oracle Always Free: availability domains
- finding: (Oracle) A1 instances can be created "in any availability domain, except South Korea North (Chuncheon)"; the Always Free instances must be in the tenancy's home region, chosen at sign-up ("choose the home region carefully").
- quote: "You can create OCI Ampere A1 Compute instances in any availability domain, except South Korea North (Chuncheon)." (verbatim, via the fetch tool, one read)
- source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm ; https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm ; read 2026-10-09
- strength: stated (one read)

### CIP-NOTCHECKED What the reading of the hosted-runner, Tailscale, phone and hardware pages did not cover
- Nothing was run, ordered or signed up for. Issue-tracker items are users' reports and are marked as such.
- Oracle's marketing pages (`oracle.com/cloud/free/` and its FAQ) answered HTTP 403 twice, so the termination and inactivity wording comes from two search-tool summaries of the FAQ, not from the page text.
- Oracle: start-up time, the longest an instance may run, the default user and root on a new Linux instance, the launch and terminate commands (only `instance action` START and STOP were read), the default performance-unit setting of a boot volume (10 per GB was assumed), per-region A1 capacity, and which of the docs (1,500 OCPU-hours) and the price data (3,000 OCPU-hours free) governs a pay-as-you-go account. The two disagree and no Oracle statement settles it.
- GitHub Actions: how long a hosted runner takes to start, any published service level, any charge for outbound traffic from runners (a grep of the billing page source found none), the fine-grained token permission needed for the dispatch call, and whether a personal Free or Pro account can create larger runners (the docs say they are for organizations on Team and Enterprise Cloud; read as no).
- GitHub terms: whether running coding agents inside Actions or Codespaces is acceptable was not asked of GitHub or found in a GitHub statement; only the terms text was read.
- Codespaces: start-up time, the numbers behind the per-user limits on codespaces created and running, the middle machine sizes' RAM and disk from GitHub itself, and charges for outbound traffic.
- Tailscale: any Tailscale text on sleeping devices (none found), behaviour in containers without a TUN device, and the paid plans beyond the Standard price ($8 per user per month) shown on the pricing page.
- Phones: OpenAI documentation of Android or iOS support (none found on the Codex page), Google's own page for the Android 14 "Disable child process restrictions" toggle (read only in a Termux maintainer's document), phone RAM, core counts, sustained-load throttling, proot speed measurements, and iPadOS-specific options on iPads with desktop-class chips. The later history of the Bun-on-Android pull request after 2026-04-26.
- Spare machines: prices of the Pi's power supply, cooling and storage; any Raspberry Pi price change after 2026-04-01 (one search found none); the Pi 5's power draw from the maker (none published on the pages read); non-US electricity tariffs; used or refurbished Mac mini prices; sustained-load wattage of the Mac mini in an agent workload (Apple's figures are idle and CPU maximum only).
