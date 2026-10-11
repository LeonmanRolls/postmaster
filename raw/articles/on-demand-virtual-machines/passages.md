# Passages relied on: on-demand virtual machines

Read on 2026-10-09. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the same words were seen in two separate reads, or in the provider's own data file; paraphrase means one read or a restatement), where each was read, and how sure the note is. Strength: stated is on the provider's page, shown is in a data file, a repository or a third party's copy, argued is derived by the reader from the entries named, not found is a search with the searches listed. Prices are list prices for the region and currency each entry names, and prices change. These are hourly-billed virtual machines from Hetzner, DigitalOcean, Vultr, Linode (Akamai), AWS, Google Compute Engine, Azure and Scaleway, priced for a machine of 4 vCPU and 8 GiB where one exists.

### VMS1 Hetzner Cloud, current prices (price adjustment of 15 June 2026), Germany/Finland, EUR
- finding: Hetzner's own price-adjustment page lists new Cloud prices from 15 June 2026 (EUR, excluding VAT and IPv4): CX23 0.0088 /h, 5.49 /month; CX33 0.0136 /h, 8.49 /month; CX43 0.0256 /h, 15.99 /month; CAX11 0.0096 /h, 5.99 /month; CAX21 0.0168 /h, 10.49 /month; CAX31 0.0336 /h, 20.99 /month; CPX22 0.0312 /h, 19.49 /month; CPX32 0.0569 /h, 35.49 /month; CPX42 0.1114 /h, 69.49 /month; CCX13 0.0689 /h, 42.99 /month; CCX23 0.1378 /h, 85.99 /month; CCX33 0.2219 /h, 138.49 /month. Two fetch-tool reads agree on every EUR number above (EUR numbers confirmed).
- quote: "The price adjustment took effect for new orders and cloud instance rescales starting on the 15 June 2026; 8 AM CEST." and "All prices are excluding VAT." (verbatim, as returned by the second read)
- source: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ ; read 2026-10-09 (3 reads) ; EUR, excluding VAT and excluding IPv4, locations Germany (FSN/NBG) and Finland (HEL); the page says it was created 2026-06-15 and last changed 2026-07-08 (per the reader's summary, one read)
- strength: stated

### VMS2 Hetzner Cloud, old prices before 15 June 2026 (same page, for the size of the change)
- finding: The same page lists the old prices: CX23 0.0064 /h, 3.99 /month; CX33 0.0104 /h, 6.49 /month; CAX21 0.0128 /h, 7.99 /month; CPX22 0.0128 /h, 7.99 /month; CPX32 0.0224 /h, 13.99 /month; CPX42 0.0408 /h, 25.49 /month; CCX23 0.0505 /h, 31.49 /month. So CPX32 (4 vCPU, 8 GB) rose from EUR 13.99 to 35.49 a month (+154%), CX33 +31%, CAX21 +31%, CCX23 +173%.
- quote: "CPX32 | 0.0224 / 13.99 | 0.0569 / 35.49" (verbatim row, columns old hourly/monthly, new hourly/monthly)
- source: same page ; read 2026-10-09 (one read for the old column) ; EUR excl. VAT, excl. IPv4
- strength: stated (old column: one read)

### VMS3 Hetzner Cloud, price changes by location (same page)
- finding: Prices differ by location. Germany/Finland is the cheapest. US (ASH/HIL) lists only CCX and the older CPX types: CPX21 (3 vCPU, 4 GB) 0.0513 /h, 31.99 /month; CPX31 (4 vCPU, 8 GB) 0.1001 /h, 62.49 /month; CPX41 (8 vCPU, 16 GB) 0.1931 /h, 120.49 /month; CCX23 0.1402 /h, 87.49 /month. Singapore (SIN): CPX22 0.0425 /h, 26.49 /month; CPX32 0.0785 /h, 48.99 /month; CPX42 0.1498 /h, 93.49 /month; CCX23 0.1739 /h, 108.49 /month. CX and CAX exist only in Germany and Finland (per the page's summary, one read).
- quote: "CPX31 | 0.1001 | 62.49" (USA table row, EUR /h, EUR /month; first read only) ; paraphrase for the other rows
- source: same page ; read 2026-10-09 (US and Singapore tables: one read) ; EUR excl. VAT, excl. IPv4
- strength: stated (one read)

### VMS4 Hetzner Cloud, the cheap lines are marked unavailable
- finding: Hetzner's own cloud pages say, in the reader's summary, that the CX and CAX plans (the cheap lines) cannot be ordered: "This product is currently unavailable. Please check back later." sits under each plan; the main cloud page marks "Cost-Optimized" as "Currently not available"; the regular-performance page (CPX) carries the same sentence under each plan. The status page lists a notice "Limited availability of cloud instances", start 2026-06-26 06:00 UTC, affected system Cloud Server, no body text visible. A third-party article (findstack) reads the same label and says Hetzner has not said when or whether the plans return. It is possible that the "currently unavailable" sentence on the CPX page is the page's fallback text when its script is not run (the reader sees no prices on any page, so the pages are script-rendered). A second read of the main page later confirmed the label for the Cost-Optimized group only (see the entry "second read" below). Unresolved: whether a new account can create CPX22/CPX32 today.
- quote: "This product is currently unavailable. Please check back later." (verbatim, cost-optimized page; same sentence reported on the regular-performance page)
- source: https://www.hetzner.com/cloud/cost-optimized/ , https://www.hetzner.com/cloud/regular-performance/ , https://www.hetzner.com/cloud/ , https://status.hetzner.com/ ; read 2026-10-09 (one read each, except the main page twice with consistent wording) ; no prices were shown on these pages
- strength: shown (one read each; the CPX reading is doubtful)

### VMS5 Hetzner Cloud, billing rules
- finding: Billed hourly, rounded up to a whole hour, with a monthly cap; a powered-off server is still billed until deleted; the bill never exceeds the monthly cap; outgoing traffic only, overage in 100 MB blocks (rate not on the page); snapshots per gigabyte per month (rate not on the page); primary IPs are a separate fixed-price feature.
- quote: "We will bill you for your servers until you delete them, independent of their state." ; "If you create a server just for a few minutes, we will still bill you for one whole hour." (verbatim)
- source: https://docs.hetzner.com/cloud/billing/faq/ ; read 2026-10-09 (one read) ; no currency on this page
- strength: stated (one read)

### VMS6 Hetzner Cloud, limits and blocks that touch this workload
- finding: Each customer has a default limit on cloud resources; a limit increase is requested in the console and is only possible after one month with Hetzner and the first invoice paid. Ports 25 and 465 are blocked outbound by default (587 is not). Volumes: 10 GB to 10 TB, "monthly price cap and are billed hourly", up to 5,000 IOPS sustained; the docs page gives no per-GB price (it points to hetzner.com/cloud/block-storage).
- quote: "Please note that this is only possible if you have been with us for a month and paid your first invoice." (verbatim)
- source: https://docs.hetzner.com/cloud/servers/faq/ , https://docs.hetzner.com/cloud/volumes/overview/ ; read 2026-10-09 (one read each)
- strength: stated (one read each); default number of servers: not found on the FAQ page

### VMS7 Hetzner Cloud, new-server creation is restricted for new customers (status notice)
- finding: Hetzner's status notice "Limited availability of cloud instances" (affected system Cloud Server, start 2026-06-26 06:00 UTC on the official status page; a mirror lists updates dated 2026-04-28, 2026-05-18, 2026-06-26 and 2026-09-11) says Hetzner is restricting creation of new cloud servers for new customers and for randomly selected existing customers because of demand and a hardware shortage. This is the single biggest limit for a new account: a new Hetzner account may be unable to create servers at all.
- quote: "we are currently required to restrict the creation of new cloud servers for both new customers and some of our existing customers." (verbatim, mirror pulsetic.com, which copies the notice)
- source: https://status.hetzner.com/ (official; read 2026-10-09, shows the title, start time, no body) ; body text from mirrors https://pulsetic.com/status/hetzner/incidents/3687/ and https://pingoru.io/providers/hetzner/incidents/1006802 (both read 2026-10-09, two mirrors agree on the wording) ; no price, EU
- strength: shown (official page confirms the notice exists; wording from two third-party mirrors)

### VMS8 Hetzner Cloud, official FAQ on why a server cannot be ordered
- finding: Hetzner's FAQ lists reasons a cloud instance cannot be ordered (account limit reached, account deactivated, no free resources at a location, a location temporarily deactivated for some customers) and says restrictions are temporary and "You can try again the following day." Affected customers cannot create or rescale servers at that location; existing servers are not affected. Default is 20 projects per account. Limit increase requests are reviewed manually, in business hours, and Hetzner support does not discuss them by phone.
- quote: "A specific location has been temporarily deactivated for some customers" ; "You can try again the following day." (verbatim)
- source: https://docs.hetzner.com/cloud/general/faq/ ; read 2026-10-09 (one read) ; n/a
- strength: stated (one read)

### VMS9 Hetzner Cloud, the cheap lines CX and CAX are listed as unavailable (third-party check)
- finding: A blogger who checked the public listing on 2026-09-07 and 2026-09-08 reports every Cost-Optimized plan (CX and CAX, eight sizes) marked unavailable while the regular CPX plans had active Create buttons; a second article (findstack, checked 2026-08-17) reports the "Currently not available" label on the Cost-Optimized plans and no word from Hetzner on a return. The author says he did not try to order. The official pages' static text (read by a summarising tool) says "currently unavailable" under every plan, including CPX and CCX; that text is probably fallback text, so treat it as unreliable.
- quote: "every model in its Cost-Optimized tier marked unavailable." (paraphrase of the summary's quote of the blog, vincentschmalbach.com)
- source: https://www.vincentschmalbach.com/hetzner-cheap-cloud-unavailable-price-increases/ and https://findstack.com/resources/hetzner-price-increase-2026 ; read 2026-10-09 ; EUR excl. VAT
- strength: shown (third-party, one read each)

### VMS10 Hetzner Cloud, server specs (official product pages, text only; no prices on these pages)
- finding: Cost-optimized: CX23 2 vCPU Intel/AMD 4 GB 40 GB NVMe 20 TB; CAX11 2 vCPU Ampere 4 GB 40 GB 20 TB; CX33 4 vCPU 8 GB 80 GB 20 TB; CAX21 4 vCPU Ampere 8 GB 80 GB 20 TB; CX43 and CAX31 8 vCPU 16 GB 160 GB 20 TB. Regular performance (shared AMD): CPX22 2 vCPU 4 GB 80 GB; CPX32 4 vCPU 8 GB 160 GB; CPX42 8 vCPU 16 GB 320 GB (20 TB each in EU; Singapore 1 TB, 2 TB, 3 TB). General purpose (dedicated vCPU, AMD): CCX13 2 vCPU 8 GB 80 GB; CCX23 4 vCPU 16 GB 160 GB; CCX33 8 vCPU 32 GB 240 GB (20 TB EU, 30 TB for CCX33; US 1 to 3 TB; Singapore 1 to 3 TB).
- quote: "CCX23 | 4 | AMD | 16 GB | 160 GB NVMe | 20 TB | 2 TB | 2 TB | 2 TB" (verbatim row as reassembled by the reader, columns EU, US HIL, US ASH, AP)
- source: https://www.hetzner.com/cloud/cost-optimized/ , https://www.hetzner.com/cloud/regular-performance/ , https://www.hetzner.com/cloud/general-purpose/ ; read 2026-10-09 (one read each) ; no price on these pages (script-rendered)
- strength: shown (one read each)

### VMS11 Hetzner Cloud, ancillary prices (third-party, price-calculator site)
- finding: A third-party calculator page (updated 2026-09-05 per its text) lists, in EUR excluding VAT: extra outbound traffic EUR 1 per TB in EU and US and EUR 7.40 per TB in Singapore; volumes EUR 0.0572 per GB-month; snapshots EUR 0.0143 per GB-month; automatic backups 20% of the instance price; primary IPv4 EUR 0.50 per month. Its server prices for CX23, CAX11, CPX22, CX33, CAX21, CPX32, CX43, CAX31 and CPX42 match Hetzner's own price-adjustment page. Hetzner's own pages read here do not state these ancillary rates (the pricing pages are script-rendered).
- quote: "€1/TB in EU (Germany/Finland) and US; €7.40/TB in Singapore." (paraphrase of the reader's summary)
- source: https://costgoat.com/pricing/hetzner ; read 2026-10-09 (one read) ; EUR excl. VAT
- strength: argued (third-party, one read; not confirmed on a Hetzner page)

### VMS12 Hetzner Cloud, API and command-line tool
- finding: `hcloud server create --name <name> --type <server-type> --image <image>` creates a server (options include --location, --ssh-key, --user-data-from-file for cloud-init, --firewall, --volume, --start-after-create); `hcloud server delete <server>`, `hcloud server poweroff` and `hcloud server shutdown` exist; the default API endpoint is https://api.hetzner.cloud/v1. Root SSH with an injected SSH key is the normal access (not stated in these files).
- quote: "hcloud server create [options] --name <name> --type <server-type> --image <image>" (verbatim)
- source: https://raw.githubusercontent.com/hetznercloud/cli/main/docs/reference/manual/hcloud_server_create.md , .../hcloud_server_delete.md , .../hcloud_server_poweroff.md (open repository, read 2026-10-09 with curl) ; n/a
- strength: shown

### VMS13 Hetzner Cloud, shape table (EUR, excluding VAT and IPv4, Germany/Finland; official price-adjustment page, EUR confirmed by two reads; the machines marked * are listed as unavailable, see above)
| Shape | Machine name | CPU kind | EUR per hour | EUR per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | CX23* (exact shape) ; CAX11* (Arm, exact) ; CPX22 (exact) | shared Intel/AMD ; shared Ampere Arm ; shared AMD | 0.0088 ; 0.0096 ; 0.0312 | 5.49 ; 5.99 ; 19.49 | 40 GB ; 40 GB ; 80 GB NVMe | 20 TB each (EU) |
| M: 4 vCPU, 8 GiB | CX33* (exact) ; CAX21* (Arm, exact) ; CPX32 (exact) | shared Intel/AMD ; shared Arm ; shared AMD | 0.0136 ; 0.0168 ; 0.0569 | 8.49 ; 10.49 ; 35.49 | 80 GB ; 80 GB ; 160 GB | 20 TB each (EU) |
| L: 4 vCPU, 16 GiB | CCX23 (exact shape) | dedicated AMD vCPU | 0.1378 | 85.99 | 160 GB NVMe | 20 TB (EU) |
| L, nearest shared | CPX42 (8 vCPU, 16 GB) ; CX43* (8 vCPU, 16 GB) ; CAX31* (8 vCPU, 16 GB) | shared | 0.1114 ; 0.0256 ; 0.0336 | 69.49 ; 15.99 ; 20.99 | 320 GB ; 160 GB ; 160 GB | 20 TB |
USD column of the same page (Hetzner's own dollar prices, excluding IPv4; CX23, CX33, CAX21, CPX32 and CCX23 confirmed by two reads, the others one read): CX23 0.0104 /h, 6.49 /month; CX33 0.0160 /h, 9.99; CAX11 0.0112 /h, 6.99; CAX21 0.0200 /h, 12.49; CPX22 0.0368 /h, 22.99; CPX32 0.0673 /h, 41.99; CPX42 0.1314 /h, 81.99; CCX23 0.1626 /h, 101.49.
- Billing: hourly, rounded up to a whole hour, no per-second billing; monthly cap; a powered-off server is billed until deleted ("independent of their state"); only outgoing traffic is billed beyond the included amount. Create, power off and delete by `hcloud` and the HTTP API (above). Start time: no measured time on any Hetzner page read (the FAQ, the docs overview and the API landing page: 3 pages, 0 hits); only the marketing line "start using it in seconds" on hetzner.com/cloud. Longest run: no limit found (not found: billing FAQ, servers FAQ). Root SSH: not stated in the pages read (argued from `--ssh-key` option). Outbound: ports 25 and 465 blocked by default, 587 open; other outbound not stated.
- Charges beyond the server: snapshots EUR 0.0143 per GB-month, volumes EUR 0.0572 per GB-month, traffic over the allowance EUR 1 per TB (EU, US), EUR 7.40 per TB (Singapore): third-party only (costgoat), see above.
- Stated limits that would stop the workload: (1) new-server creation restricted for new customers (status notice, since 2026-06-26, open on 2026-10-09 per mirrors); (2) default per-account resource limit and manual increase only after one month and a paid invoice; (3) the CX and CAX lines (the cheapest) carry the label "Currently not available" on Hetzner's own main page (two reads) and are reported unavailable by two third-party checks; (4) the shapes exist in the CPX and CCX lines (CPX42/CCX23 for 16 GiB), at the higher June 2026 prices.
- Cross-check: prices in the pages above are also what a price-calculator site (costgoat.com) lists on 2026-09-05; Hetzner prices rose on 2026-06-15 (CPX32 EUR 13.99 to 35.49 a month, +154%; CX33 +31%); third-party articles also mention an earlier increase from 2026-04-01 (northflank blog headline "up to 37% starting April 1, 2026", from the search result only; not read).

### VMS14 DigitalOcean, bundled Droplet plans (pricing page, USD)
- finding: Basic (shared CPU) 2 vCPU 4 GiB is $0.03571 /h, $24.00 /month, 80 GiB SSD, 4,000 GiB transfer; Basic 4 vCPU 8 GiB is $0.07143 /h, $48.00 /month, 160 GiB SSD, 5,000 GiB; Basic 8 vCPU 16 GiB is $0.14286 /h, $96.00 /month, 320 GiB, 6,000 GiB. CPU-Optimized (dedicated) 2 vCPU 4 GiB $0.0625 /h, $42.00; 4 vCPU 8 GiB $0.125 /h, $84.00; 8 vCPU 16 GiB $0.25 /h, $168.00 (25, 50, 100 GiB SSD). General Purpose 4 vCPU 16 GiB $0.1875 /h, $126.00 /month, 50 GiB SSD, 5,000 GiB. The Basic rows with 4 and 8 GiB were read twice and agree; the CPU-Optimized 2/4 and 4/8 rows and the General Purpose 4/16 row were also read twice and agree (later entry); Basic 8/16 GiB is one read.
- quote: "8 GiB | 4 | 5,000 GiB | 160 GiB | $0.07143 | $48.00" (verbatim row, Basic: memory, vCPU, transfer, SSD, $/hour, $/month)
- source: https://www.digitalocean.com/pricing/droplets ; read 2026-10-09 (two reads) ; USD, tax not stated, no region on the table
- strength: stated (Basic 4 and 8 GiB rows: two reads; others one read)

### VMS15 DigitalOcean, new "v5" Droplets (pay per resource)
- finding: DigitalOcean also sells "v5 Droplets" on 5th-gen AMD EPYC, where vCPU, memory and storage are chosen separately and billed hourly with per-second billing, and without the 672-hour cap. The page gives only example starting prices: $0.052 /h for 2 vCPU 4 GB shared, $0.181 /h for 4 vCPU 16 GB General Purpose, $0.36 /h for 8 vCPU 32 GB General Purpose, $0.024 /h for 1 vCPU 1 GB shared. Per-resource rates are on a separate docs page that was not read.
- quote: "You pick vCPU, memory, and storage independently and pay for only the resources you use." (verbatim)
- source: https://www.digitalocean.com/pricing/droplets ; read 2026-10-09 (one read) ; USD
- strength: stated (one read)

### VMS16 DigitalOcean, billing rules
- finding: Per-second billing from 2026-01-01 with a minimum of 60 seconds or $0.01, whichever is higher; bundled plans are capped at 672 hours (28 days) a month, so the monthly price is the most paid; powered-off bundled-plan Droplets are still billed; extra outbound transfer is $0.01 per GiB; Droplet snapshots $0.06 per GB-month (minimum $0.01); volumes $0.10 per GiB-month, charged "whether or not they are attached", accruing hourly.
- quote: "Bundled-plan CPU Droplets are billed per second with a minimum charge of 60 seconds or $0.01, whichever is higher." ; "You are still billed for bundled-plan CPU Droplets that are powered off" (verbatim)
- source: https://docs.digitalocean.com/products/droplets/details/pricing/ (page says "Last verified 25 Aug 2026") ; https://www.digitalocean.com/pricing/droplets (per-second wording, cap, snapshots $0.06) ; https://docs.digitalocean.com/products/volumes/details/pricing/ ("Last verified 13 Jul 2026") ; https://docs.digitalocean.com/products/snapshots/details/pricing/ ("Last verified 8 May 2024", so older) ; read 2026-10-09 ; USD, tax not stated
- strength: stated (per-second, cap, powered-off: two pages agree on per-second and cap; powered-off: one read)

### VMS17 DigitalOcean, API, command, limits
- finding: `doctl compute droplet create <name> --size <slug> --image <image> --region <slug> --ssh-keys ... --user-data-file <cloud-init> --wait` creates a Droplet with SSH keys put in the root account; `doctl compute droplet delete` exists. At most 10 Droplets can be created at the same time through the control panel or API. Default network throughput limit is 2 Gbps for Droplets other than Premium CPU (10 Gbps). The default account Droplet limit for a new account is not in the docs read; community posts say 3 for a new account and that increases are asked for on the Settings page; the Team Limits docs page says increases are requested on the Resource Limits page.
- quote: "You can’t create more than 10 Droplets at the same time using the Control Panel or the API." (verbatim)
- source: https://docs.digitalocean.com/reference/doctl/reference/compute/droplet/create/ , https://docs.digitalocean.com/products/droplets/details/limits/ , https://docs.digitalocean.com/platform/teams/limits/ ; read 2026-10-09 (one read each) ; community numbers from digitalocean.com/community search results (not opened)
- strength: stated (create flags, concurrency); default account limit: not found (searches: 1 the search tool restricted to digitalocean.com, 10 hits, none stating a number in official docs; 2 docs pages without a number); start time: not found (not searched on a DigitalOcean page); API rate limit: not found (docs.digitalocean.com/reference/api/rate-limits/ returned 404)

### VMS18 DigitalOcean, shape table (USD, list, bundled plans)
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | Basic 2 vCPU/4 GiB (exact) ; CPU-Optimized 2 vCPU/4 GiB (exact) | shared ; dedicated | 0.03571 ; 0.0625 | 24.00 ; 42.00 | 80 GiB ; 25 GiB | 4,000 GiB each |
| M: 4 vCPU, 8 GiB | Basic 4 vCPU/8 GiB (exact) ; CPU-Optimized 4 vCPU/8 GiB (exact) | shared ; dedicated | 0.07143 ; 0.125 | 48.00 ; 84.00 | 160 GiB ; 50 GiB | 5,000 GiB each |
| L: 4 vCPU, 16 GiB | General Purpose 4 vCPU/16 GiB (exact) ; nearest cheaper: Basic 8 vCPU/16 GiB | dedicated ; shared | 0.1875 ; 0.14286 | 126.00 ; 96.00 | 50 GiB ; 320 GiB | 5,000 GiB ; 6,000 GiB |

### VMS19 Vultr, plan list and prices (public API /v2/plans, USD)
- finding: The unauthenticated Vultr API lists these plans (monthly_cost, hourly_cost in USD; the JSON states no currency): Cloud Compute regular (vc2) vc2-2c-4gb 2 vCPU 4 GB 80 GB disk 3072 GB bandwidth $20 /month, $0.027 /h; vc2-4c-8gb 4 vCPU 8 GB 160 GB 4096 GB $40, $0.055. High Frequency (vhf, NVMe) vhf-2c-4gb $24, $0.033 (128 GB); vhf-3c-8gb 3 vCPU 8 GB $48, $0.066 (256 GB); vhf-4c-16gb 4 vCPU 16 GB $96, $0.132 (384 GB, 5120 GB). High Performance (vhp, AMD or Intel) vhp-2c-4gb $24, $0.033 (100 GB); vhp-4c-8gb $48, $0.066 (180 GB, 6144 GB); vhp-4c-12gb $72, $0.099; vhp-8c-16gb $96, $0.132. Optimized Cloud Compute (voc): CPU-optimized voc-c-2c-4gb-50s-amd $40, $0.055; voc-c-4c-8gb-75s-amd $80, $0.11; general purpose voc-g-4c-16gb-80s-amd 4 vCPU 16 GB 80 GB $120, $0.164.
- quote: "vc2-4c-8gb | 4 | 8192 | 160 | 4096 | 40 | 0.055 | vc2" (verbatim row: id, vCPU, RAM MB, disk GB, bandwidth, monthly_cost, hourly_cost, type)
- source: https://api.vultr.com/v2/plans?type=vc2 , ?type=vhf , ?type=vhp , ?type=voc (public API, a fetch-tool read of the JSON, read 2026-10-09, one read per type) ; USD, tax not stated, default region price (the API response has no region field)
- strength: shown (public API; one read per type; the reader dropped plans outside the vCPU filter asked for)

### VMS20 Vultr, billing rules
- finding: Vultr bills hourly with a one-hour minimum; hourly charges begin when a server is deployed whether it is on or off; stopped servers keep incurring hourly charges; billing stops only when the server is destroyed; non-GPU servers are "billed up to 672 hours per month" (the monthly price is then the most paid; see the discrepancy entry below on how the hourly price relates to it). Per-second billing: not offered (the page says the minimum unit is one hour).
- quote: "Servers that are stopped but not destroyed continue to incur hourly charges" ; "The minimum billing unit is one hour" (verbatim, as quoted by the reader)
- source: https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers ("Updated 16 December 2025") ; read 2026-10-09 (one read; a search result summary says the same) ; USD
- strength: stated (one read)

### VMS21 Vultr, shape table (USD, list)
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | vc2-2c-4gb (exact) ; vhf-2c-4gb (exact) ; vhp-2c-4gb-amd (exact) | shared regular ; shared high-frequency NVMe ; shared AMD high performance | 0.027 ; 0.033 ; 0.033 | 20 ; 24 ; 24 | 80 GB ; 128 GB ; 100 GB | 3072 ; 3072 ; 5120 (GB, unit not stated in JSON) |
| M: 4 vCPU, 8 GiB | vc2-4c-8gb (exact) ; vhp-4c-8gb-amd (exact) ; voc-c-4c-8gb-75s-amd (CPU-optimized, exact) | shared ; shared ; "optimized" (dedicated, per Vultr naming; not read on a page) | 0.055 ; 0.066 ; 0.11 | 40 ; 48 ; 80 | 160 GB ; 180 GB ; 75 GB | 4096 ; 6144 ; 6144 |
| L: 4 vCPU, 16 GiB | vhf-4c-16gb (exact) ; voc-g-4c-16gb-80s-amd (general purpose, exact) | shared high-frequency ; optimized | 0.132 ; 0.164 | 96 ; 120 | 384 GB ; 80 GB | 5120 ; 6144 |
- Not read for Vultr (the pricing page returned HTTP 403 to the reader): snapshot price, block storage price, backup price, bandwidth overage rate, API create/delete documentation, start time. The per-account limit page was read later (see "Per-account instance limits"). A search result summary says Vultr's docs say bandwidth overage can still be billed after destroy; not confirmed. The Vultr CLI README shows `vultr-cli instance create`; its delete command is not shown.
- strength for the missing items: not found (2 searches restricted to vultr.com, 20 hits, billing and limits only; 4 fetches of vultr.com pages returned HTTP 403: pricing, FAQ, block storage, cloud compute)

### VMS22 Linode (Akamai Cloud), plan list and prices (public API /v4/linode/types and pricing page, USD)
- finding: Shared CPU: Linode 4 GB (g6-standard-2) 2 vCPU, 4 GB, 80 GB disk, 4 TB transfer, $0.036 /h, $24 /month; Linode 8 GB (g6-standard-4) 4 vCPU, 8 GB, 160 GB, 5 TB, $0.072 /h, $48 /month; Linode 16 GB (g6-standard-6) 6 vCPU, 16 GB, 320 GB, 8 TB, $0.144 /h, $96 /month. Dedicated CPU G6: Dedicated 4 GB (2 vCPU) $0.054 /h, $36; Dedicated 8 GB (4 vCPU) $0.108 /h, $72 (API only); G7 Dedicated 8 GB (4 vCPU) $0.13 /h (API $0.129), $86 /month; G8 Dedicated 16x4 (4 vCPU, 16 GB) $0.21 /h, hourly only, no bundled transfer (API). The API's region_prices raise prices in Jakarta (id-cgk) and Sao Paulo (br-gru): Linode 8 GB $0.086 /h and $0.101 /h. The pricing page and the API agree on every shared-CPU and G7 number.
- quote: "Linode 8 GB | $48.00 | $0.0720 | 8 GB | 4 | 160 GB | 5 TB | 40/5 Gbps" (verbatim row from the North America pricing page)
- source: https://www.akamai.com/cloud/pricing/north-america (shown no date, "© 2026 Akamai Technologies") ; https://api.linode.com/v4/linode/types (public API) and /types/g6-standard-4, /types/g6-standard-6 ; read 2026-10-09 (two reads agree on g6-standard-4 and the shared rows) ; USD, "We collect taxes for customers who are subject to it", North America region
- strength: stated (shared rows: two sources agree; G8 and G6-dedicated rows: one read)

### VMS23 Linode (Akamai Cloud), billing rules and other charges
- finding: Hourly billing capped at the monthly price, usage rounded up to the nearest hour, and powered-off Linodes keep accruing; G8 dedicated and GPU Linodes are billed only for hours used with no monthly cap, from 2026-07-01. Extra egress is US$0.005 per GB; block storage rows imply $0.10 per GB-month; image storage rows imply $0.10 per GB-month (100 images, 500 GB maximum per account); backups are a per-plan price (Linode 2 GB $2.50 /month).
- quote: "Charges accrue for any service present on an account, even if it's powered off or otherwise not actively being used." ; "Usage is always rounded up to the nearest hour." (verbatim, as quoted by the reader)
- source: https://techdocs.akamai.com/cloud-computing/docs/understanding-how-billing-works ("Last updated: 2026-09-25", one read) ; https://www.akamai.com/cloud/pricing/north-america (one read) ; USD
- strength: stated (billing rules; one read); shown (the per-GB numbers are implied by table rows, not stated)

### VMS24 Linode (Akamai Cloud), shape table (USD, North America, list)
| Shape | Machine name | CPU kind | $ per hour | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | Linode 4 GB (exact) ; Dedicated 4 GB G6 (exact) | shared ; dedicated | 0.036 ; 0.054 | 24 ; 36 | 80 GB ; 80 GB | 4 TB ; 4 TB |
| M: 4 vCPU, 8 GiB | Linode 8 GB (exact) ; Dedicated 8 GB G6 (exact) ; G7 Dedicated 8 GB | shared ; dedicated ; dedicated | 0.072 ; 0.108 ; 0.13 | 48 ; 72 ; 86 | 160 GB | 5 TB |
| L: 4 vCPU, 16 GiB | G8 Dedicated 16x4 (exact) ; nearest shared: Linode 16 GB (6 vCPU, 16 GB) | dedicated ; shared | 0.21 ; 0.144 | not capped (G8) ; 96 | 164 GB (G8, 167936 MB) ; 320 GB | none bundled (G8) ; 8 TB |
- Create/destroy by API: Linode has the public API at api.linode.com/v4 (read: /linode/types); the Linode CLI README (open repository) says the CLI is generated from the Linode OpenAPI spec and covers every API endpoint, but names no create or delete command, and the OpenAPI file was not found at the URL tried. Start time: not read. Per-account instance limit and quota approval: only community answers (see "Per-account instance limits").

### VMS25 AWS EC2, On-Demand price an hour (provider's pricing data file behind the pricing page)
- finding: On-Demand us-east-1 Linux, USD per hour: t3.medium (2 vCPU, 4 GiB) 0.0416; t4g.medium (2 vCPU, 4 GiB, Graviton) 0.0336; c7g.large (2 vCPU, 4 GiB, Graviton3) 0.0725; c8g.large 0.07976; c7i.large 0.08925; c6a.large 0.0765; t3.large (2 vCPU, 8 GiB) 0.0832; t4g.large 0.0672; m7g.large (2 vCPU, 8 GiB) 0.0816; for 4 vCPU 8 GiB: c6g.xlarge 0.136, c6a.xlarge 0.153, c8g.xlarge 0.15952, c7i.xlarge 0.1785, c7a.xlarge 0.20528 (c7g.xlarge was not found in the file by the reader; by the pattern c7g.large 0.0725 it would be 0.145, argued); for 4 vCPU 16 GiB: t4g.xlarge 0.1344 (burstable), t3a.xlarge 0.1504, m6g.xlarge 0.154, t3.xlarge 0.1664 (burstable), m7g.xlarge 0.1632, m6a.xlarge 0.1728, m8g.xlarge 0.17952, m7i.xlarge 0.2016, m7a.xlarge 0.23184. All from one read each (the file was read in 100,000-character pieces and each type was found in one piece only).
- quote: "m7g.xlarge: $0.1632000000/hr, 4 vCPU, 16 GiB" (reader's summary of the JSON entry, one read)
- source: https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json (the JSON the AWS pricing page loads; 695,491 characters, read in 100,000-character pieces) ; read 2026-10-09 ; USD, no tax, us-east-1
- strength: shown (one read per entry; no date field was seen in the file)

### VMS26 AWS EC2, Spot price an hour (provider's spot price data file; region attribution argued)
- finding: The spot price data file (website.spot.ec2.aws.a2z.com/spot.json, 2.7 MB) gives, for the block that follows the us-east-1 header, Linux Spot USD per hour: t3.medium 0.0146 ; t4g.medium 0.0136 ; c7g.large 0.0253 ; c7i.large 0.0291 ; c6g.xlarge 0.0648 ; c6a.xlarge 0.0709 ; c7g.xlarge 0.0554 ; c7i.xlarge 0.0513 ; c8g.xlarge 0.0582 ; t3.xlarge 0.0436 ; t4g.xlarge 0.0565 ; m6a.xlarge 0.0748 ; m7g.xlarge 0.0909 ; m7i.xlarge 0.0852 ; m8g.xlarge 0.0768. Against the On-Demand figures above these are 44% to 74% below On-Demand (t3.xlarge 74%, c7i.xlarge 71%, c7g.xlarge about 62% if On-Demand is 0.145, m7g.xlarge 44%, c6g.xlarge 52%). The region is argued: the header "us-east-1" was seen in the 100,000 characters before and the block runs on until "us-east-1-atl-1"; the reader was told to assume it. No date was seen in the file; Spot prices change continuously, so these are one snapshot.
- quote: "Save up-to 90% on On-Demand prices." (verbatim, AWS Spot page); for the numbers: paraphrase of the reader's table
- source: https://website.spot.ec2.aws.a2z.com/spot.json (read 2026-10-09, offset 2,200,000, one read) ; https://aws.amazon.com/ec2/spot/ ; USD, no tax
- strength: argued (one read; region assumed; undated)

### VMS27 AWS EC2, Spot interruption notice and how often capacity is reclaimed
- finding: AWS issues a notice two minutes before it stops or terminates a Spot Instance (as an EventBridge event and in instance metadata), "on a best effort basis"; for hibernation there is no two-minute warning. The Spot Instance Advisor defines frequency of interruption as the rate at which Spot reclaimed capacity in the trailing month, in bands <5%, 5-10%, 10-15%, 15-20% and >20%, and says "the average frequency of interruption across all Regions and Instance types has historically been <5%". The per-instance bands for the types above were read later (see "AWS Spot Instance Advisor, us-east-1 Linux"). "Spot saves": up to 90% off On-Demand according to AWS; 44% to 74% according to the snapshot above.
- quote: "A Spot Instance interruption notice is a warning that is issued two minutes before Amazon EC2 stops or terminates your Spot Instance." ; "Interruption notices are emitted on a best effort basis." (verbatim)
- source: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html ; https://aws.amazon.com/ec2/spot/instance-advisor/ ; read 2026-10-09 (one read each) ; n/a
- strength: stated

### VMS28 AWS EC2, billing, burstable credits, storage and transfer
- finding: Per-second billing with a 60-second minimum for Linux; no monthly cap (not offered). T3 and T4g launch in Unlimited mode by default: CPU above the baseline averaged over 24 hours costs $0.04 per vCPU-hour (T4g) or $0.05 per vCPU-hour (T3), Linux; the docs' example baseline for t3.large is 30% per vCPU and the breakeven against m5.large is 42.5% (t3.xlarge 52.5%). EBS gp3: the pricing page names $0.08 per GB-month only in an example "in a region that charges $0.08 per GB-month" (region not named), 3,000 IOPS and 125 MB/s included; EBS snapshots standard tier $0.05 per GB-month (example, region not named). The first 100 GB a month of data transfer out to the internet is free; the rate for the next tiers was not on the page the reader saw (known from memory, not confirmed here: $0.09 per GB for the first 10 TB in us-east-1). A public IPv4 address costs $0.005 an hour (VPC pricing page, see the later entry). EBS volumes are billed as provisioned, regardless of whether an instance is running (the page says "you pay only for what you provision"; stopped state is not addressed).
- quote: "pay for compute capacity by the hour or second (minimum of 60 seconds)" ; "AWS customers receive 100 GB of free data transfer out to the internet free each month" (verbatim)
- source: https://aws.amazon.com/ec2/pricing/on-demand/ ; https://aws.amazon.com/ebs/pricing/ ; https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html ; read 2026-10-09 (one read each) ; USD, no tax
- strength: stated (per-second, unlimited-mode rates, free 100 GB); not found (EBS and transfer rates for us-east-1: the EBS page names $0.08 only in an example; 2 pages read, 0 region-specific rows)

### VMS29 AWS EC2, shape table (us-east-1, Linux, USD; Spot from the snapshot above)
| Shape | Machine name | CPU kind | $ per hour (On-Demand) | $ per hour (Spot snapshot) | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | t3.medium (exact) ; t4g.medium (exact, Arm) ; c7g.large (exact, Arm, not burstable) ; c7i.large (exact) | burstable Intel ; burstable Graviton ; Graviton3 ; Intel | 0.0416 ; 0.0336 ; 0.0725 ; 0.08925 | 0.0146 ; 0.0136 ; 0.0253 ; 0.0291 | no cap (about 730 h x rate: t4g.medium about 24.5) | none (EBS extra) | first 100 GB out free a month, account-wide |
| M: 4 vCPU, 8 GiB | c6g.xlarge (exact, Arm) ; c8g.xlarge (exact, Arm) ; c7i.xlarge (exact) ; c7g.xlarge (not read) | Graviton2 ; Graviton4 ; Intel ; Graviton3 | 0.136 ; 0.15952 ; 0.1785 ; (0.145 argued) | 0.0648 ; 0.0582 ; 0.0513 ; 0.0554 | no cap | none | same |
| L: 4 vCPU, 16 GiB | t4g.xlarge (exact, burstable Arm) ; t3.xlarge (exact, burstable) ; m7g.xlarge (exact, Arm) ; m7i.xlarge (exact) | burstable ; burstable ; Graviton3 ; Intel | 0.1344 ; 0.1664 ; 0.1632 ; 0.2016 | 0.0565 ; 0.0436 ; 0.0909 ; 0.0852 | no cap | none | same |
- Create and destroy by API/CLI (RunInstances, TerminateInstances, `aws ec2 run-instances`, Spot via `--instance-market-options`): not read here, known to exist; not confirmed on a page in this session. Start time: not read. Limits: vCPU-based quotas, default 5 vCPUs for On-Demand standard families and 5 for Spot, adjustable (read; see "AWS EC2, default quotas for a new account").
- Cost note (argued from the numbers above): compared with the yardstick, On-Demand t4g.medium (0.0336) and t3.medium (0.0416) are about 0.44x and 0.55x of Cloudflare standard-3 idle ($0.076); Spot cuts those to 0.0136 and 0.0146.

### VMS30 GCE, prices (third-party site gcloud-compute.com, "Last Update: Sun Oct 4 2026", us-central1; currency not stated on the page)
- finding: e2-medium (2 shared vCPU, 4 GB) $0.0335 /h, $24.46 /month, Spot $0.0201 /h; e2-standard-2 (2 vCPU, 8 GB) $0.067 /h, $48.92 /month, Spot $0.0402 /h; e2-standard-4 (4 vCPU, 16 GB) $0.134 /h, $97.84 /month, Spot $0.0804 /h; t2d-standard-4 (4 vCPU, 16 GB) $0.169 /h, $123.36 /month, Spot $0.1014 /h. There is no predefined E2/T2D size of 4 vCPU and 8 GB; custom machine types (4 vCPU, 8 GB) exist but their per-vCPU and per-GB rates were not read. Google's own pricing pages were unreadable (script-rendered, or over the 10 MB fetch limit).
- quote: "Last Update: Sun Oct 4 01:50:17 2026 (GMT)" (verbatim, third-party page); prices: paraphrase of the reader's summary
- source: https://gcloud-compute.com/e2-standard-4.html , /e2-medium.html , /e2-standard-2.html , /t2d-standard-4.html ; read 2026-10-09 (one read each) ; USD presumed, us-central1, tax not stated
- strength: argued (third-party, one read each; not confirmed on a Google page)

### VMS31 GCE, Spot VMs (Google docs)
- finding: Spot VMs have no maximum runtime unless you set one (the page mentions no 24-hour limit); the preemption notice can be set to 120 seconds or 0 seconds, 0 being the default, and Google recommends 120; on preemption the VM is stopped by default (or deleted if the termination action is DELETE); discount "up to 91%"; "might not always be available". Quota details were in an unread part of the page.
- quote: "Spot VMs don't have a minimum or maximum runtime unless you specifically limit the runtime." ; "Spot VMs are finite Compute Engine resources, so they might not always be available." (verbatim, as quoted by the reader)
- source: https://docs.cloud.google.com/compute/docs/instances/spot ; read 2026-10-09 (one read; 100,000 of 105,997 characters)
- strength: stated (one read)

### VMS32 GCE, shape table (us-central1, USD presumed, third-party prices above)
| Shape | Machine name | CPU kind | $ per hour (On-Demand / Spot) | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | e2-medium (exact memory; 2 vCPU are a half-core share) | shared-core | 0.0335 / 0.0201 | 24.46 | none (persistent disk extra) | not read |
| M: 4 vCPU, 8 GiB | no predefined size; nearest e2-standard-2 (2 vCPU, 8 GB) or a custom machine type | E2 family (CPU kind not read) | 0.067 / 0.0402 (e2-standard-2) | 48.92 | none | not read |
| L: 4 vCPU, 16 GiB | e2-standard-4 (exact) ; t2d-standard-4 (exact, AMD) | E2 family ; T2D family (CPU kind not read) | 0.134 / 0.0804 ; 0.169 / 0.1014 | 97.84 ; 123.36 | none | not read |
- Billing, API, quota, disk and egress prices for Compute Engine: not read in this session (the Google pricing and billing pages were unreadable: the all-pricing page returned a title only, the Spot pricing page exceeded the 10 MB fetch limit). Start time: not read.

### VMS33 Azure, prices (Azure Retail Prices API, public, no sign-in)
- finding: Standard_B2s (2 vCPU, 4 GiB, burstable) $0.0416 /h Linux; Standard_B4ms (4 vCPU, 16 GiB, burstable) $0.166 /h; Standard_F4s_v2 (4 vCPU, 8 GiB) $0.169 /h, Spot $0.03718 /h; Standard_D4as_v5 (4 vCPU, 16 GiB) $0.172 /h, Spot $0.036309 /h; Standard_B4als_v2 (4 vCPU, 8 GiB, AMD burstable) $0.133 /h, a Spot row of $0.1197 /h dated 2025-09-01. Spot rows for F4s_v2 and D4as_v5 are effective 2026-07-01 (so about 78% and 79% below On-Demand at the time of the read). No monthly cap was shown.
- quote: "Standard_D4as_v5 Spot (Spot) | Virtual Machines Dasv5 Series | 0.036309 | 1 Hour | USD | Consumption | 2026-07-01T00:00:00Z" (verbatim row)
- source: https://prices.azure.com/api/retail/prices (OData filter by armSkuName and armRegionName eq 'eastus'; four short queries) ; read 2026-10-09 (one read each) ; USD, retail list price, no tax
- strength: shown (one read each; public API)

### VMS34 Azure, Spot rules and billing states (Microsoft Learn)
- finding: Azure evicts Spot VMs "with 30-seconds notice" (Scheduled Events, best effort), there is no SLA, the default policy deallocates (disks keep being charged) or deletes the VM; B-series sizes cannot be Spot; Spot has its own quota pool, raised through the standard quota request; eviction rates are quoted per hour from the last 7 days, bands in the portal. A stopped-but-allocated VM is billed; a deallocated VM is not billed for compute, but disks and networking continue to be charged. The page "Applies to Linux VMs".
- quote: "At any point in time when Azure needs the capacity back, the Azure infrastructure will evict Azure Spot Virtual Machines with 30-seconds notice." (verbatim)
- source: https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms (page date ms.date 2026-02-06, updated 2026-06-24) ; https://learn.microsoft.com/en-us/azure/virtual-machines/states-billing ; read 2026-10-09 (one read each)
- strength: stated

### VMS35 Azure, shape table (East US, USD, Linux, list)
| Shape | Machine name | CPU kind | $ per hour (On-Demand / Spot) | $ per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | Standard_B2s (exact) | burstable | 0.0416 / no Spot (B-series) | no cap | no, temp disk size not read | not read (first 100 GB out is free, from memory; not confirmed) |
| M: 4 vCPU, 8 GiB | Standard_F4s_v2 (exact) ; Standard_B4als_v2 (exact, burstable) | compute-optimized ; burstable | 0.169 / 0.03718 ; 0.133 / (0.1197 row) | no cap | not read | not read |
| L: 4 vCPU, 16 GiB | Standard_D4as_v5 (exact) ; Standard_B4ms (exact, burstable) | general purpose AMD ; burstable | 0.172 / 0.036309 ; 0.166 / none | no cap | not read | not read |
- Not read for Azure: per-second billing statement and minimum, disk and egress prices, create/delete API (the `az vm create` command), start time, vCPU quota defaults for new subscriptions.

### VMS36 AWS EC2, default quotas for a new account (stated, official docs)
- finding: The default On-Demand quota for "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances" is 5 vCPUs per Region, and the default Spot quota for "All Standard (A, C, D, H, I, M, R, T, Z) Spot Instance Requests" is 5 vCPUs; both are adjustable. AWS says it raises On-Demand and Spot quotas automatically based on usage and that you can request an increase. So a fresh account can run one 4-vCPU instance, not three lanes plus a coachman, until a quota rises. How long a request takes was not read.
- quote: "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances | 5 | Yes" ; "Amazon EC2 automatically increases your On-Demand Instance quotas based on your usage." (verbatim)
- source: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html ; read 2026-10-09 (one read, full text returned) ; n/a (vCPU counts, per Region)
- strength: stated

### VMS37 Scaleway Instances, prices (PAR-1, EUR, before tax) and billing
- finding: Scaleway lists, for Paris PAR-1, EUR per hour before tax (monthly is about 730 hours): Development line DEV1-M 3 vCPU 4 GB 0.0202 /h (about 14.74 /month); PLAY2-NANO 2 vCPU 4 GB 0.02754 (20.10); DEV1-L 4 vCPU 8 GB 0.04284 (31.27); PLAY2-MICRO 4 vCPU 8 GB 0.05508 (40.20). General purpose: BASIC2-A2C-4G 2 vCPU 4 GB 0.023 (16.79); BASIC2-A4C-8G 4 vCPU 8 GB 0.0517 (37.74); BASIC2-A4C-16G 4 vCPU 16 GB 0.0689 (50.29); BASIC3-X4C-8G 4 vCPU 8 GB 0.079 (57.67); BASIC3-X4C-16G 4 vCPU 16 GB 0.11845 (86.46). Compute optimized POP2-HC-2C-4G 2 vCPU 4 GB 0.0532 (38.83). Egress and IPv6 are included in the list prices; storage and a public IPv4 are not (flexible IPv4 EUR 0.004 per hour). The storage size and the CPU kind (shared or dedicated, Arm or x86) were not on the page the reader saw. CPU Instances are "Billed per hour of uptime (including startup and standby time)"; standby is charged as running; powering off avoids the compute charge, but volumes and public IPs keep billing; no minimum charge and no limit for new accounts stated on the FAQ page; startup time not stated.
- quote: "The **standby mode** is charged as a running Instance." ; "List prices include egress and IPv6 addresses. Storage (local, block) and attached public IPv4 addresses are excluded." (verbatim)
- source: https://www.scaleway.com/en/pricing/virtual-instances/ (one read, no page date) ; https://www.scaleway.com/en/docs/instances/faq/ (one read, characters 100,000 onward) ; read 2026-10-09 ; EUR, before tax, PAR-1
- strength: stated (one read each)

### VMS38 Scaleway, shape table (PAR-1, EUR before tax)
| Shape | Machine name | CPU kind | EUR per hour | EUR per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | PLAY2-NANO (exact) ; BASIC2-A2C-4G (exact) | not on page | 0.02754 ; 0.023 | about 20.10 ; 16.79 (no cap stated; monthly figure is the page's approximation) | not listed | egress included, amount not stated |
| M: 4 vCPU, 8 GiB | DEV1-L (exact) ; BASIC2-A4C-8G (exact) | not on page | 0.04284 ; 0.0517 | about 31.27 ; 37.74 | not listed | egress included |
| L: 4 vCPU, 16 GiB | BASIC2-A4C-16G (exact) | not on page | 0.0689 | about 50.29 | not listed | egress included |
- Create by command: the Scaleway CLI README (open repository) shows `scw instance server create type=DEV1-S image=ubuntu_noble zone=fr-par-1 tags.0="scw-cli"` and `scw instance server list`; a delete command is not shown in the README; the CLI needs an API key (access key and secret). Source: https://raw.githubusercontent.com/scaleway/scaleway-cli/master/README.md ; read 2026-10-09 with curl ; strength: shown.
- Not read for Scaleway: the delete command, start time, new-account quotas, whether DEV1 and PLAY2 can be ordered today (stock), volume price.

### VMS39 OVHcloud Public Cloud
- finding: Not obtained. The pricing page returned navigation only (content truncated before the tables, tried twice), and the public catalog API (api.ovh.com/1.0/order/catalog/public/cloud) is 8.3 million characters; the first 100,000 listed addon names only (b3-8.consumption, b3-16.consumption, c3-4.consumption, c3-8.consumption, no prices). Hourly billing for those flavors is suggested by the ".consumption" suffix only.
- quote: "b3-16.consumption" (verbatim addon name)
- source: https://www.ovhcloud.com/en/public-cloud/prices/ ; https://api.ovh.com/1.0/order/catalog/public/cloud?ovhSubsidiary=IE ; read 2026-10-09
- strength: not found (3 reads, 0 prices)

### VMS40 Hetzner Cloud, second read: only the Cost-Optimized group carries the "Currently not available" label
- finding: A second read of Hetzner's main cloud page returns the same result as the first: "Currently not available" appears above the Cost-Optimized group (CX and CAX) and no availability text appears for Regular Performance (CPX) or General Purpose (CCX). Two reads agree, so the label is confirmed on the main page (the "currently unavailable" sentence under every plan on the sub-pages is probably fallback text, unconfirmed). The same page says a new server can be used "in seconds" (marketing wording, not a measured start time). Hetzner's API changelog has no 2026 entry saying cost-optimized types are unavailable; it has "May 28: Update on our pricing" (new prices from 15 June 2026 for new orders and rescales; existing servers keep their prices unless rescaled) and, in October 2026, new plan CPX02 (1 vCPU, 1 GB, 20 GB) in the EU and Singapore, so Hetzner is still adding plans.
- quote: "order your new server conveniently in the Hetzner Console and start using it in seconds." (verbatim, as returned by the reader) ; "Existing servers are not affected by the price adjustment, as long as no rescaling is performed." (verbatim, changelog)
- source: https://www.hetzner.com/cloud/ (read twice, 2026-10-09) ; https://docs.hetzner.cloud/whats-new (one read) ; EUR/USD n/a
- strength: stated (label: two reads); start time "in seconds": stated as marketing, one read

### VMS41 Hetzner Cloud, was there an earlier 2026 increase?
- finding: Third-party pages say Hetzner raised cloud prices a first time on 2026-04-01 (a search-result headline: "Published 2026-03-25 · Effective April 1, 2026 · All regions, all customers"; another: "Hetzner is raising cloud prices by up to 37% starting April 1, 2026"). Hetzner's own price-adjustment page that was read lists only the 15 June 2026 change, but its "old price" column (CX23 3.99 EUR a month) is above the October 2025 launch price quoted in a third-party headline ("Starting at EUR 3.49/Month", bitdoze.com), which fits an earlier increase. Not confirmed on a Hetzner page. The current page for prices is the price-adjustment page (15 June 2026, last changed 2026-07-08 per its footer as read), and the pricing pages on hetzner.com/cloud are script-rendered and show no prices to a text reader.
- quote: "Published 2026-03-25 · Effective April 1, 2026 · All regions, all customers" (verbatim search-result title, agentdeals.dev; page not opened)
- source: search results only (https://agentdeals.dev/hetzner-pricing-2026 , https://northflank.com/blog/hetzner-cloud-server-price-increases , https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans) ; read 2026-10-09 ; EUR
- strength: argued

### VMS42 Vultr and Linode, command-line tools
- finding: `vultr-cli instance create --region <region-id> --plan <plan-id> --os <os-id> --host <hostname>` creates an instance (the README of the open repository); the README does not show the delete command. The Linode CLI README says the CLI is generated from the Linode OpenAPI spec and "provides easy access to any of the Linode API endpoints"; it lists no create or delete commands.
- quote: "vultr-cli instance create --region <region-id> --plan <plan-id> --os <os-id> --host <hostname>" (verbatim)
- source: https://raw.githubusercontent.com/vultr/vultr-cli/master/README.md , https://raw.githubusercontent.com/linode/linode-cli/main/README.md ; read 2026-10-09 with curl
- strength: shown (Vultr create); not found (delete for both, 2 READMEs searched with grep for instance/create/delete)

### VMS43 Vultr, a numbers discrepancy to keep in mind
- finding: Vultr's API hourly_cost times 672 hours is below the monthly_cost (vc2-4c-8gb: 0.055 x 672 = 36.96 against 40 a month; vhf-4c-16gb: 0.132 x 672 = 88.70 against 96), because the API hourly price is about the monthly price divided by 727 (40 / 0.055 = 727), while Vultr's billing page says servers are billed "up to 672 hours per month". So for a full 28-day month the bill by the hourly rate would be lower than the "monthly price"; for 12 or 24 hours it makes no difference. A search-result summary says Vultr's block storage page derives the hourly rate as monthly / 672; not opened.
- quote: "Billed up to 672 hours per month." (verbatim, Vultr billing page, as quoted by the reader)
- source: https://api.vultr.com/v2/plans and https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers ; read 2026-10-09 ; USD
- strength: argued (derived from the two stated sources)

### VMS44 Google Compute Engine, billing of stopped instances (Google docs)
- finding: CPU and memory are charged in RUNNING and PENDING_STOP (memory also in SUSPENDING and SUSPENDED); a TERMINATED instance is not listed as billed for CPU or memory; disks and external IP addresses are billed "while the resources exist, regardless of the compute instance state". Per-second billing and the one-minute minimum were not found on a Google page that could be read (the pricing page redirects between two hosts; 2 attempts).
- quote: "you incur charges while the resources exist, regardless of the compute instance state." (verbatim)
- source: https://docs.cloud.google.com/compute/docs/instances/instance-life-cycle ; read 2026-10-09 (one read)
- strength: stated (one read); not found (per-second billing, quotas: https://docs.cloud.google.com/compute/docs/quotas returned 404, the pricing page looped; 3 fetches, 0 hits)

### VMS45 AWS Spot Instance Advisor, us-east-1 Linux: savings and interruption band per type
- finding: The Spot Advisor data file (the file behind AWS's Spot Instance Advisor page) gives, for us-east-1 Linux, savings over On-Demand (s, percent) and the interruption band (r: 0 is <5%, 1 is 5-10%, 2 is 10-15%, 3 is 15-20%, 4 is >20%) as follows. c7g.xlarge 62%, band 5-10%; c6g.xlarge 56%, 5-10%; c6a.xlarge 56%, 5-10%; m6a.xlarge 52%, 5-10%; m7g.xlarge 53%, 10-15%; t4g.xlarge 53%, 10-15%; t4g.medium 49%, 15-20%; t3.xlarge 61%, <5%; t3.medium 60%, >20%; c7i.xlarge 61%, >20%; m7i.xlarge 56%, >20%; c8g.xlarge 63%, >20%. AWS defines the band as "the rate at which Spot has reclaimed capacity during the trailing month", and says the average across all Regions and instance types "has historically been <5%"; so several 4-vCPU types are above that average. The savings figures are close to, but not the same as, the savings computed from the spot price snapshot above (for example c7g.xlarge 62% in both; c7i.xlarge 61% against 71%; m7g.xlarge 53% against 44%), which fits the region attribution and the difference between a trailing average and a snapshot.
- quote: "\"c7g.xlarge\": {\"s\": 62, \"r\": 1}" (verbatim JSON entry as returned by the reader)
- source: https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json (1,190,579 characters; the us-east-1 Linux block was in characters 1,100,000 to 1,190,579; region key seen in that piece; band labels from the file's "ranges" list read in the first piece) ; read 2026-10-09 ; percent of On-Demand
- strength: shown (one read; the file is undated)

### VMS46 OVHcloud Public Cloud, partial prices and a price change on 1 October 2026 (conflicting readings)
- finding: OVHcloud's blog says "Our Public Cloud instance prices are changing on October 1, 2026" and lists monthly amounts, excluding tax, on a 730-hour month, with two numbers per row that could not safely be labelled old and new: b3-8 (50 GB local storage) 37 EUR and 45 EUR (+19.5%); b3-16 (100 GB) 75 and 87 (+16.9%); c3-4 (50 GB) 33 and 41 (+21.9%); c3-8 (100 GB) 67 and 79 (+18.9%); the same page says "The hourly price of instances does not change" (the reader's summary; per-second billing was not on that page). A search-result summary of OVHcloud pages gives hourly prices excluding VAT: in euro b3-16 (4 vCPU, 16 GB) 0.1023 (previous 0.093) and c3-8 (4 vCPU, 8 GB) 0.0913 (previous 0.083); in dollars b3-16 0.1208 /h (about 88.18 a month) and c3-8 0.1078 /h (about 78.69 a month) from a US price list that the summary calls about 254 days old; and says the new model bills per second for all Public Cloud VM ranges, with local storage billed separately at 0.0001458 EUR per GB-hour. 0.0913 EUR is 67 EUR / 730 h = 0.0918, so the euro hourly prices match the first monthly column, not the second. These readings conflict with each other on whether the hourly price moved; treat OVH's shape-M price as roughly EUR 0.09 to 0.11 an hour, above Scaleway and Hetzner CPX32 and similar to DigitalOcean, Linode and Vultr High Performance.
- quote: "Our Public Cloud instance prices are changing on October 1, 2026." (verbatim, OVHcloud blog, as returned by the reader)
- source: https://blog.ovhcloud.com/en/posts/public-cloud-pricing-update-october-2026/ (one read) ; search result summary naming https://www.ovhcloud.com/en/public-cloud/prices/ and https://blog.ovhcloud.com/en/posts/pricing-evolution-of-public-cloud-bare-metal-and-vps-at-ovhcloud/ (not opened) ; read 2026-10-09 ; EUR and USD, excluding VAT
- strength: argued (partial, conflicting; the OVH billing help page returned HTTP 403)

OVHcloud shape table (partial, EUR excluding VAT, hourly figures from the search summary, derived monthly in brackets; CPU kind, disk and traffic not read except the storage sizes the blog lists):

| Shape | Machine name | CPU kind | EUR per hour | EUR per month if capped | Disk included | Traffic included |
|---|---|---|---|---|---|---|
| S: 2 vCPU, 4 GiB | c3-4 (vCPU count not on the page read; "c3-4" taken as 4 GB) | not read | (33 or 41 / 730 = 0.045 or 0.056, derived, unconfirmed) | 33 or 41 | 50 GB | not read |
| M: 4 vCPU, 8 GiB | c3-8 (4 vCPU per the search summary) | not read | 0.0913 (previous 0.083) ; USD 0.1078 | 67 or 79 | 100 GB | not read |
| L: 4 vCPU, 16 GiB | b3-16 (4 vCPU per the search summary) | not read | 0.1023 (previous 0.093) ; USD 0.1208 | 75 or 87 | 100 GB | not read |

### VMS47 Billing rules confirmed by second reads (Hetzner, DigitalOcean)
- finding: Hetzner's billing FAQ, asked a second time in other words, returns the same rules: "Do you bill servers that are off? Yes, you pay for a server that has completed the creation process for as long as it exists"; a server deleted before month end is billed "only ... the hourly rate"; a few minutes of use is billed as one whole hour; the monthly price cap is the most paid; traffic over the allowance is billed in 100 MB blocks, with no per-GB or per-TB price on the page. DigitalOcean's docs page, asked a second time, returns: powered-off bundled-plan Droplets are still billed, "To end billing, destroy the Droplet", a Droplet destroyed in under 60 seconds still pays the minimum, and the 672-hour cap applies to bundled plans, not to v5 Droplets. Vultr's general billing page has no billing detail (only the specific "How am I billed" page above does).
- quote: "To end billing, destroy the Droplet." ; "Yes, you pay for a server that has completed the creation process for as long as it exists" (verbatim, as returned by the reader)
- source: https://docs.hetzner.com/cloud/billing/faq/ ; https://docs.digitalocean.com/products/droplets/details/pricing/ ; https://docs.vultr.com/platform/billing ; read 2026-10-09 (second reads)
- strength: stated (two reads agree)

### VMS48 Per-account instance limits and quota approval (what each provider says)
- quote: "The Vultr account limit defines the maximum instances and costs you can have in your account." (verbatim)
- source: https://docs.vultr.com/platform/billing/manage-account-limits ("Updated 12 September 2025") ; search results from linode.com/community and digitalocean.com/community (not opened) ; read 2026-10-09
- strength: stated (Vultr, Hetzner, AWS); argued (Linode, DigitalOcean: community reports, older)

### VMS49 DigitalOcean, transfer is pooled per team
- finding: Outbound transfer allowance is pooled across all Droplets of the team, does not roll over, and inbound transfer is free; overage is $0.01 per GiB. For this workload (outbound HTTPS only) the pooled 4,000 to 5,000 GiB per Droplet allowance is far above need.
- quote: "Transfer allowance and usage is pooled cumulatively across all Droplets at the team level, not individually per Droplet." (verbatim)
- source: https://docs.digitalocean.com/products/billing/bandwidth/ ("Last verified 14 Sep 2026") ; read 2026-10-09 (one read) ; USD
- strength: stated (one read)

### VMS50 Hetzner Cloud, backups and snapshots page gives no price
- finding: Hetzner's docs page on backups and snapshots says only "For information about the prices, see the respective info box at hetzner.com/cloud" (a script-rendered page); so snapshot and backup rates are not confirmed on a Hetzner page.
- quote: "For information about the prices, see the respective info box at hetzner.com/cloud." (verbatim)
- source: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/ ; read 2026-10-09 (one read)
- strength: not found (on Hetzner pages: 4 pages read, 0 rates for snapshots, volumes or extra traffic; they come only from the third-party page above)

### VMS51 Azure, second read of the key rows (fresh URL variant, East US, USD)
- finding: A second query with a different filter (adds priceType eq 'Consumption') returns the same numbers: Standard_F4s_v2 Linux Consumption $0.169 /h (effective 2025-10-01) and Spot $0.03718 /h (effective 2026-07-01); Standard_D4as_v5 Linux Consumption $0.172 /h (2021-12-01) and Spot $0.036309 /h (2026-07-01). Spot Windows rows are higher ($0.07788 and $0.075152). Confirmed by two reads.
- quote: "retailPrice: 0.03718 ... effectiveStartDate: 2026-07-01T00:00:00Z" (reader's summary of the JSON item for F4s v2 Spot)
- source: https://prices.azure.com/api/retail/prices (two filter variants per SKU) ; read 2026-10-09 ; USD, retail list, East US
- strength: shown (two reads agree)

### VMS52 AWS, public IPv4 charge and transfer-out example
- finding: AWS charges $0.005 per hour for a public IPv4 address, in use or idle (about $3.65 for 730 hours); the same page's NAT Gateway example uses "Data Transfer Out to Internet rate set at $0.09 per GB" for US East (Ohio), an example figure, not the tier table. A separate statement on the VPC pricing page: "The bill is calculated in one-second increments, with a minimum of 60 seconds." The EC2 On-Demand page lists the 100 GB a month free allowance but its tier table was not readable.
- quote: "Hourly charge for In-use Public IPv4 Address $0.005" (verbatim)
- source: https://aws.amazon.com/vpc/pricing/ ; read 2026-10-09 (one read) ; USD, per hour
- strength: stated (IPv4 charge); argued ($0.09 per GB for the first 10 TB is only an example figure)

### VMS-NOTCHECKED What the reading of the virtual machine pages did not cover
- Nothing was ordered, run or signed up for; no calculator that asks for a sign-in was used and no third-party code was run.
- Hetzner: whether a new account can create a CPX or CCX server today (only the status notice and page labels were read); the default server limit; a measured creation time (only the marketing line "in seconds"); the price of a primary IPv4 on a Hetzner page (EUR 0.50 a month is third-party); snapshot, volume and extra-traffic rates on a Hetzner page (third-party only); the API rate limit; whether root SSH is the default (argued from the `--ssh-key` option); the 2026-04-01 increase (third-party only).
- DigitalOcean: the default Droplet limit for a new account (not found); start time; the API rate limit (the rate-limit page returned 404); per-resource rates of v5 Droplets; which CPU-option tab (Regular or Premium) the Basic rows belong to; the docs page on powering off (404).
- Vultr: the pricing page, product pages and FAQ returned HTTP 403, so snapshot, block storage, backup and bandwidth-overage prices, start time and the API documentation for create and delete were not read (the CLI README shows `instance create` only).
- Linode (Akamai): official default account limits (only community answers); start time; create and delete API calls (the OpenAPI file was not at the URL tried); region price differences beyond the two Asia and South America regions in the API; the availability of the G8 dedicated line.
- AWS: EBS gp3 and transfer-out prices for us-east-1 (the pages gave an example price, an Ohio example of $0.09 per GB, and "100 GB free" only); RunInstances and CLI documentation; start time; the Spot price file and the Spot Advisor file have no date, and the Spot price file's region was assumed from position (the Advisor's region key was seen); c7g.xlarge On-Demand was not found in the data; other low-cost regions were not compared.
- Google Compute Engine: first-party prices (the pricing pages are script-rendered, over the 10 MB fetch limit, or redirect in a loop), per-second billing and the minimum, quotas, custom machine type rates, disk and egress prices, the API and CLI. All Compute Engine prices here are third-party (a mirror), one read each.
- Azure: regions other than East US; disk, egress and public IP prices; the per-second billing statement and any minimum; default vCPU quotas for new subscriptions; `az vm create` documentation; start time.
- Scaleway: API and CLI; start time; new-account quotas; stock status; storage size and CPU type of each instance; volume price.
- OVHcloud: no prices were obtained (the page was truncated twice and the catalog API is 8.3 million characters).
- The longest a machine may run: no maximum was found for any provider; it is stated only for Spot (Compute Engine: none unless limited; AWS and Azure: evictable at any time).
- Exchange rates: only the rate implied by Hetzner's own euro and dollar columns (about 1.18 dollars to the euro) was used; Scaleway's euro prices were not converted except where marked.
