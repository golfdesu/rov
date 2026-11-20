# Cloud & VPS Hosting Comparison (`minidraft.app`)

> **Reference Date:** 2026-11-20  
> **Purpose:** Compare market alternatives to the current Azure production VM (`Standard_B2als_v2`), including paid monthly rates (Singapore / Thailand regions) and all conditions/caveats for running on free tiers, trial credits, or student programs.

---

## 1. Current Production Baseline (Azure)

| Metric | Current Value (`rov-draft-vm`) |
| :--- | :--- |
| **Provider & Region** | Microsoft Azure (`East Asia` / Hong Kong) |
| **SKU & Hardware** | `Standard_B2als_v2` (2 vCPU `AMD EPYC 7763`, 4 GiB RAM) |
| **Storage & Network** | `30 GB Premium_LRS` SSD + Static Public IP (`20.2.210.230`) |
| **Estimated Monthly Cost** | ~`38.40 USD/mo` compute (`~0.0526 USD/hr`) + Disk/IP/Egress = **`~45–50 USD/mo` (~1,550–1,750 THB)** |
| **Actual App Footprint** | RAM `~1.1 GB` used (`FastAPI + PyTorch CPU + Caddy + SQLite`), Disk `~9.0 GB`, Load `~0.2` |
| **Minimum Viable Spec** | `>= 2 GB RAM` (with 2 GB swap) or **`4 GB RAM`** recommended so `docker compose build` + PyTorch CPU do not OOM |

---

## 2. Paid Cloud & VPS Comparison (Comparable Spec: 2+ vCPU / 4 GB RAM)

All non-Thai providers below are priced for their **Singapore** datacenter (approx. `30–40 ms` latency to Thailand), while local Thai providers offer `< 15 ms` latency.

| Provider | Region | Spec | Monthly Price | Included Bandwidth | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OVHcloud (VPS-1)** | Singapore | 2 vCPU / 4 GB RAM / 40 GB NVMe | **`~4.54 USD`** (`~S$5.78`, ~160 THB) | Unlimited (500 Mbps) | **Best value.** No-commitment monthly rate, daily backups included. (8 GB RAM `VPS-2` is `~S$10.88/mo`). |
| **Hetzner Cloud (CPX)** | Singapore | 2–3 vCPU AMD / 2–4 GB RAM / 40 GB NVMe | **`~7–15+ EUR`** (~260–550+ THB) | 20 TB | Budget `CX` plans are unavailable in Singapore (only `CPX` AMD). Strict KYC/ID verification on signup. |
| **HostAtom (VPS SSD2)** | Thailand | 2 vCPU / 4 GB RAM / 40 GB SSD | **`590 THB`** (~472 THB/mo annual) | Unlimited | Thai datacenter, lowest ping, easy THB payment. (8 GB RAM `SSD3` is `1,190 THB/mo`). |
| **Bangmod.Cloud** | Thailand | 4 vCPU / 4 GB RAM / 50 GB SSD | **`719 THB`** (`+7% VAT` = ~769 THB) | 8 TB | 4 vCPU (faster builds/inference), hourly billing supported (~1.07 THB/hr). |
| **Z.com Cloud (C3)** | Thailand | 4 vCPU / 4 GB RAM / 50 GB SSD | **`1,200 THB`** | Unlimited (fair use) | Enterprise Thai cloud; pricier than HostAtom/Bangmod. |
| **Contabo (Cloud VPS)** | Singapore | 4 vCPU / 4–8 GB RAM / 150 GB SSD | **`~13.50+ EUR`** (~500+ THB) | Unlimited (fair use) | Large disk space, but Singapore region adds location surcharge. |
| **AWS Lightsail** | Singapore | 2 vCPU / 4 GB RAM / 80 GB SSD | **`20.00 USD`** (~700 THB) | 4 TB | Predictable flat bundle (VM + Disk + IP + Egress). |
| **Vultr (Cloud Compute)** | Singapore | 2 vCPU / 4 GB RAM / 65–80 GB SSD | **`20.00 USD`** (~700 THB) | 3–4 TB | Hourly billing; High Frequency NVMe tier is `24.00 USD/mo`. |
| **DigitalOcean** | Singapore | 2 vCPU / 4 GB RAM / 80 GB SSD | **`24.00 USD`** (~840 THB) | 4 TB | Clean UI, but ~5x more expensive than OVHcloud. |
| **Akamai Linode** | Singapore | 2 vCPU / 4 GB RAM / 80 GB SSD | **`24.00 USD`** (~840 THB) | 4 TB | Identical pricing/spec to DigitalOcean. |
| **Google Cloud (`e2-medium`)** | Singapore | 2 shared vCPU / 4 GB RAM | **`~30.17 USD`** compute (`~38–45+ USD` total) | **Billed per GB** (`~0.12 USD/GB` in Asia) | Disk, Static IP, and Egress are billed separately; total cost is close to Azure. |
| **Microsoft Azure (`B2als_v2`)** | East Asia | 2 vCPU / 4 GB RAM | **`~34.46–38.40 USD`** compute (`~45–50 USD` total) | **Billed per GB** | Current production host. |

---

## 3. Free Tiers, Trial Credits & Conditions (How to Run for Free)

### A. Always Free (Permanent `0 USD` — With Conditions)

#### 1. Oracle Cloud Infrastructure (OCI) — **Best Permanent Free Option**
- **Free Quota:** Up to **2 OCPUs ARM (Ampere A1) + 12 GB RAM + 200 GB Block/Boot Storage + 10 TB/month outbound traffic** (halved from the older 4 OCPU / 24 GB quota for new accounts). Also includes 2x AMD `VM.Standard.E2.1.Micro` (1 GB RAM each).
- **Conditions & Gotchas:**
  1. **Home Region Lock:** Always Free resources can **only** be created in the Home Region chosen at signup (choose `ap-singapore-1`).
  2. **Singapore Capacity Shortage:** Free-tier accounts frequently hit `"Out of host capacity"` when creating ARM instances in Singapore.
  3. **7-Day Idle Reclamation Policy:** Pure Free Tier accounts will automatically have instances stopped/reclaimed if **CPU < 20% AND Network < 20% AND Memory < 20%** (95th percentile over 7 days).
  4. **PAYG Bypass (Recommended Trick):** Upgrading the account to **Pay-As-You-Go (PAYG)** with a valid credit card **exempts you from idle reclamation** and gives much higher priority for ARM capacity, while remaining **`0 USD`** as long as usage stays strictly inside the Always Free limits (2 OCPU / 12 GB RAM / 200 GB storage).
  5. **Architecture:** Ampere A1 is **ARM64** (`aarch64`). Docker images must be built for `linux/arm64` (supported by Python, PyTorch CPU wheels, Caddy, and SQLite).

#### 2. Google Cloud Platform (GCP) Always Free — **Not Suitable for `minidraft.app`**
- **Free Quota:** 1x `e2-micro` (2 shared vCPU, **1 GB RAM**, 30 GB Standard PD, 1 GB egress/month).
- **Why It Fails Here:**
  1. **US Regions Only:** Valid only in `us-west1`, `us-central1`, `us-east1` (high latency to Thailand).
  2. **1 GB RAM Limit:** Insufficient for PyTorch CPU + FastAPI + Docker builds without frequent OOM crashes.

---

### B. Time-Limited Free Trials & Promotional Credits

| Provider | Free Offer | Duration | Conditions & Gotchas for `minidraft.app` |
| :--- | :--- | :--- | :--- |
| **Google Cloud (GCP)** | **`300 USD` Credit** | 90 days | New billing account + credit card required. Can run `e2-medium` in `asia-southeast1` (Singapore) or `asia-southeast3` (Bangkok) completely free for 3 months, then must migrate or pay `~38–45 USD/mo`. |
| **AWS (Free Tier + Lightsail)** | **`100+ USD` Startup Credits** + **Lightsail 3-Month Free Trial** + **EC2 12-Month Free (`t3.micro`/`t4g.micro`)** | 3–12 months | Lightsail 3-month free trial covers entry bundles (`3.50–5 USD/mo`, 512 MB–1 GB RAM — too small without swap). Stopping a Lightsail instance **does not stop billing**; it must be deleted before day 90. `100 USD` account credits can cover a 4 GB Lightsail (`20 USD/mo`) for ~5 months. |
| **Microsoft Azure (Free Account)** | **`200 USD` Credit** + 12 months `B1s` (1 GB RAM) | 30 days (credit) / 12 months (`B1s`) | New account + credit card. `200 USD` credit expires after 30 days. |
| **Alibaba Cloud (Singapore)** | **Free Trial ECS** (select `t5`/`t6` or new-user credits) | 1–12 months (promo-dependent) | Requires new account, real-name verification, and international credit/debit card. Select `Singapore` region explicitly at checkout. |
| **Huawei Cloud (Singapore)** | **Free Trial ECS Package** (up to 2 vCPU / 4 GiB RAM, ~1 month / 1,500 hrs) | ~1 month | New international account + card verification (temporary auth hold). Must delete/cancel before trial hours/days expire to avoid PAYG charges. |

---

### C. Student Programs (No Credit Card or Extended Credits)

| Program | Offer | Conditions & Status (2026) |
| :--- | :--- | :--- |
| **Azure for Students** | **`100 USD` Credit / 12 months** (renewable annually while enrolled) | University email / academic verification, **no credit card required**. Covers ~2 months of `B2als_v2` (`~45–50 USD/mo`), or ~4–5 months if downsized to `B1ms` (`1 vCPU / 2 GB RAM`) + `StandardSSD_LRS`. |
| **GitHub Student Developer Pack — Heroku** | **`13 USD/month` for 24 months** (`312 USD` total) | Verified student aged 18+. Note: Heroku Dynos have ephemeral filesystems, so SQLite (`rov_app.db`) cannot live on local Dyno disk (would require Heroku Postgres). |
| **GitHub Student Developer Pack — DigitalOcean** | **Discontinued** | DigitalOcean exited the GitHub Student Pack; final redemption was **July 31, 2026** and remaining credits expired **August 1, 2026**. |

---

## 4. Practical Recommendations for `minidraft.app`

1. **Cheapest Reliable Paid Migration (Drop-in x86 Docker):**
   - **OVHcloud Singapore `VPS-1`** (`~4.54 USD/mo`, ~160 THB) — Keeps the exact same Docker + Caddy + SQLite (`rov_app.db`) + Cloudflare architecture with zero code changes.
2. **Best Local Thai Support & Lowest Latency:**
   - **HostAtom `VPS SSD2`** (`590 THB/mo`, or `~472 THB/mo` paid annually) or **Bangmod.Cloud** (`719 THB/mo` + VAT).
3. **True `0 USD` Long-Term Hosting:**
   - **Oracle Cloud Always Free (`ap-singapore-1`)** upgraded to **PAYG** (staying strictly inside 2 OCPU ARM / 12 GB RAM / 200 GB storage), with Docker rebuilt for `linux/arm64`.
4. **Short-Term Free Runway (3–5 Months):**
   - Use **GCP `300 USD` / 90-day trial** (`e2-medium` in Bangkok/Singapore) or **AWS new account credits** on Lightsail (`20 USD/mo`), while keeping `rov_app.db` backed up for easy migration afterward.
