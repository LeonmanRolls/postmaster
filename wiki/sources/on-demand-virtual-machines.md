---
title: "Price lists and billing rules of hourly-billed virtual machine providers (read 2026-10-09)"
type: source
sources: [articles/on-demand-virtual-machines]
updated: 2026-10-09
---

# What an hour of a plain virtual machine costs, and what stops one being bought

Hetzner, DigitalOcean, Vultr, Akamai (Linode), Amazon Web Services, Google, Microsoft and Scaleway: price lists, billing rules and
quota pages, read 2026-10-09.

**What it claims.**

- For a machine of 4 vCPU and 8 GiB the list prices an hour are Vultr $0.055, Hetzner CPX32 EUR 0.0569 (USD 0.0673 in Hetzner's
  own dollar column), DigitalOcean $0.07143 and Linode $0.072 [@articles/on-demand-virtual-machines/passages.md] (VMS13, VMS18,
  VMS21, VMS24), and Scaleway DEV1-L EUR 0.04284 (VMS38). Azure Spot is $0.03718 (VMS35). One AWS Spot figure was read, from an
  undated file of argued region, and AWS's Spot Advisor file gives a lower saving for the same type, so it is not relied on
  (VMS26, VMS45).
- Hetzner raised its prices on 2026-06-15 (CPX32 from EUR 13.99 to 35.49 a month, for new orders and rescales) and lists its
  cheapest lines, CX and CAX, as "Currently not available". Two third-party mirrors of its status notice say creation of new
  cloud servers is restricted for new customers; the official status page shows only the notice's title and start
  (VMS1, VMS2, VMS4, VMS7, VMS40).
- Hetzner, Vultr, Linode and DigitalOcean bill a powered-off machine until it is deleted. Hetzner, Vultr and Linode bill by the
  whole hour; DigitalOcean bills by the second with a 60-second minimum since 2026-01-01 (VMS5, VMS16, VMS20, VMS23).
- Spot machines are reclaimed with two minutes' notice on AWS, 30 seconds' on Azure and none or 120 seconds' on Google, and a new
  AWS account has a default quota of 5 vCPUs (VMS27, VMS34, VMS31, VMS36).
- Hetzner and DigitalOcean document a command-line tool that creates and deletes a machine, and Vultr's shows `instance create`
  only; the tooling of AWS, Azure, Scaleway and Compute Engine, and Linode's create and delete calls, were not read (VMS12,
  VMS17, VMS42).

**On what evidence.** The providers' own pages and public data files, mostly one or two reads. Hetzner's price list, Vultr's plan
data and DigitalOcean's price page were read again by a second reader and agreed. Google's prices come from a third party's mirror
(one read) because its pages could not be read, and OVHcloud's readings conflict, so no OVHcloud figure is relied on. Nothing was
ordered.

**What it would mean here.** A virtual machine made for one ticket's run costs its hourly price for the run's whole life, a median
of about 28 hours in the audit, and only deleting it stops the charge. At $0.055 to $0.072 an hour that is about $1.50 to $2 a
run, before the disk and a public address.

Bears on [running the flow on Cloudflare](../concepts/running-the-flow-on-cloudflare.md).
