# What other on-demand providers charge

List prices read on 2026-10-08 and 2026-10-09; each row names its page, its date and how well the rate was checked, in
`providers.json` and `machines.json`. Two kinds of work are priced. A **gate hour** is 4 vCPU and 12 GiB with every
vCPU busy. A **waiting-agent hour** is 1 vCPU and 4 GiB with a fifth of the CPU busy, the rest spent waiting on model
calls. Neither profile was measured: [#363](https://github.com/brindlewick/postmaster/issues/363) is the ticket that
would. The disk is 20 GB and 10 GB where a provider charges for it by the hour, in the first table only; egress, plan fees and, for machines billed whole, the disk and the address are left out.

A typical run, built from the median hours of each role in the instance-time tables, is 6.2 to 21.5 waiting-agent hours (lanes,
reviewers and the coachman at its floor and its ceiling, less the gate) and 2.5 gate hours. A provider
whose longest session is shorter than 19 hours, about the coachman's median ceiling over a whole run (18.8 hours), is left out of the first table.

## Containers and sandboxes billed by the second

| Provider | Agent hour, $ | Gate hour, $ | One run, low to high, $ | Checked | Longest session |
| --- | --- | --- | --- | --- | --- |
| Northflank | 0.052 | 0.171 | 0.747 to 1.54 | two reads | none stated |
| Modal Functions | 0.056 | 0.190 | 0.818 to 1.66 | two reads | 24 h |
| AWS Fargate (Linux x86, US East) | 0.058 | 0.215 | 0.896 to 1.78 | two reads | none stated |
| Azure Container Instances (Linux, East US) | 0.058 | 0.215 | 0.897 to 1.79 | one read | none stated |
| Fly.io Machines, performance CPUs | 0.063 | 0.217 | 0.927 to 1.88 | two reads | none stated |
| Cloudflare Containers | 0.053 | 0.401 | 1.32 to 2.13 | two reads | none stated |
| Google Cloud Run jobs (instance-based) | 0.094 | 0.346 | 1.44 to 2.87 | two reads | 168 h |
| Fly.io Sprites | 0.095 | 0.416 | 1.63 to 3.08 | two reads | none stated |
| Modal Sandboxes | 0.167 | 0.572 | 2.46 to 5.00 | two reads | 24 h |
| Vercel Sandbox (Pro) | 0.110 | 0.766 | 2.59 to 4.27 | two reads | 24 h |
| E2B (Pro) | 0.115 | over the size limit | n/a | two reads | 24 h |
| Daytona | 0.116 | over the size limit | n/a | two reads | none stated |

## Machines billed whole

A machine of 4 vCPU and 8 GiB kept up for a run's whole life: the median run's life is 27.7 hours, the
mean 33.3, taken from the first to the last timestamp in each run's record, waits included.

| Machine | $ an hour | Median run | All 18 runs | $ a month, kept up | Median runs a month that cost that | Stopped machine billed | Checked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Azure Spot, F4s v2 (East US) | 0.037 | 1.04 | 22.6 | not entered | n/a | no | two reads |
| Scaleway DEV1-L (Paris) | 0.051 | 1.42 | 30.8 | not entered | n/a | no | one read |
| Oracle Arm A1, pay-as-you-go (4 OCPU, 8 GB) | 0.052 | 1.44 | 31.2 | not entered | n/a | no | two reads |
| Vultr vc2-4c-8gb | 0.055 | 1.54 | 33.5 | 40.0 | 26 | yes | two reads |
| Koyeb Eco, eco-xlarge (4 vCPU, 8 GB) | 0.058 | 1.60 | 34.6 | 42.9 | 27 | no | two reads |
| Hetzner CPX32 (Germany, Finland) | 0.067 | 1.88 | 41.0 | 42.0 | 22 | yes | two reads |
| DigitalOcean Basic, 4 vCPU and 8 GiB | 0.071 | 1.98 | 42.9 | 48.0 | 24 | yes | two reads |
| Linode 8 GB | 0.072 | 2.02 | 43.8 | 48.0 | 24 | yes | one read |
| AWS On-Demand, c6g.xlarge (US East) | 0.136 | 3.77 | 81.6 | not entered | n/a | no | one read |
| Hetzner CCX23 (4 dedicated vCPU, 16 GB) | 0.163 | 4.55 | 99.0 | 101.5 | 22 | yes | two reads |

## All 18 runs together on Cloudflare, with agents sized to what they use

615 waiting-agent hours and 50 gate hours: $2.92 an average run, against
$6.83 when every launch is a standard-4. The runs a month at which a flat monthly price costs the same as that
(plan fee $5 plus the average run for each run):

| Flat price a month | Runs a month |
| --- | --- |
| $25 | 7 |
| $50 | 15 |
| $100 | 33 |
| $200 | 67 |
