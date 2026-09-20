# MikroTik Hardware Architecture & Switch Chip Sizing Matrix

Deploying advanced traffic engineering (CAKE QoS, WireGuard, Docker containers, BGP) without understanding the hardware architecture leads to catastrophic CPU exhaustion (100% CPU lockups). This reference defines hardware boundaries, ASIC capabilities, and sizing budgets for RouterOS v7.

---

## 1. Processor Architecture Taxonomy

| Architecture | Representative Models | Strengths | Severe Bottlenecks / Limitations |
| **ARM64** | RB5009, CCR2004, CCR2116, CCR2216, hEX refresh (`E50UG`), hAP ax2, hAP ax3, L009 | High single-core IPC, native 64-bit container support (`/container`), wire-speed WireGuard crypto. | High memory utilization if containerized microservices leak RAM. |
| **ARM / ARM32** | hEX S new (`E60iUGS`), RB1100AHx4, Chateau series | Energy efficient, modern RouterOS v7 kernel support, 512MB-1GB RAM. | EN7562CT CPU uses ARMv5TE instruction subset; containers require `arm32v5` (`linux/arm/v5`) images to avoid illegal instruction faults. |
| **MMIPS / MIPSBE** | hEX S legacy (`RB760iGS`), hEX legacy (`RB750Gr3`), RB2011, RB3011, cAP ac | Inexpensive, low power consumption, reliable for simple NAT. | **Cannot run CAKE QoS above 150-250 Mbps** without hitting 100% CPU; no container support. |
| **TILE** | CCR1009, CCR1016, CCR1036, CCR1072 | Massive core count (9 to 72 cores), high aggregate packet throughput. | Single-core performance is weak; RouterOS v7 kernel does not support containers on Tile; BGP single-thread convergence is slower than ARM64. |
| **x86 / CHR** | Cloud Hosted Router (VMware, Proxmox, AWS, Bare Metal) | Scalable vCPU and RAM; easily handles multi-gigabit BGP and CAKE if vCPUs are pinned. | Lacks hardware switch ASICs; all L2 bridging is processed in software. |

---

## 2. Switch Chip ASIC & Hardware Offloading Matrix

RouterOS v7 supports two distinct levels of hardware offloading:
1. **L2 Hardware Offload (`hw=yes`):** Switch ASIC forwards Layer 2 Ethernet frames directly between ports without involving the router CPU.
2. **L3 Hardware Offload (`l3hw=yes`):** Switch ASIC routes Layer 3 IP packets and performs inter-VLAN routing at wire speed (often 10 Gbps to 100 Gbps).

| Switch Chip Silicon | Representative Devices | L2HW Bridge | L3HW Routing | Hardware NAT / FastTrack |
|---|---|:---:|:---:|:---:|
| **Marvell Prestera 98DX3236 / 98DX3257** | CRS326, CRS328, CRS317, CCR2004 | Yes | Yes (v7.1+) | No |
| **Marvell Prestera 98DX8525 / 98DX4310** | CRS354, CCR2116, CCR2216 | Yes | Yes (Wire-speed 100G) | Partial |
| **Marvell 88E6393X** | RB5009 | Yes | Yes (v7.1+) | No |
| **Qualcomm Atheros 8327 / 8337** | RB750Gr3, RB3011, hAP ac2 | Yes | No (CPU only) | No |
| **Realtek RTL8367** | RB4011 (ports 1-10) | Yes | No (CPU only) | No |

---

## 3. Throughput & Sizing Budgeting Guide

### 3.1. CAKE / FQ-CoDel Bufferbloat Budget
- CAKE operates per-packet and calculates flow state dynamically.
- **Rule of Thumb:**
  - **MIPSBE (RB750Gr3 / hEX):** Max 150-200 Mbps aggregate shaping before CPU reaches 100%.
  - **ARM32 (hAP ax2/ax3):** Max 400-600 Mbps aggregate shaping.
  - **ARM64 (RB5009):** Handles up to 1.2-1.8 Gbps of CAKE shaping across 4 cores.
  - **x86 CHR (4+ vCPU @ 3.0GHz+):** Handles multi-gigabit (2.5G - 10G) CAKE shaping.

### 3.2. FastTrack vs Non-FastTrack Budget
- **With FastTrack:** An RB5009 or RB4011 can route ~5 to 9 Gbps of simple IPv4 traffic.
- **Without FastTrack (Full Mangle + Queue Tree):** Maximum throughput drops to ~1.5 to 2.5 Gbps due to per-packet CPU processing.

### 3.3. WireGuard VPN Crypto Budget
- RouterOS v7 runs WireGuard inside the Linux kernel.
- **RB750Gr3 (MIPSBE):** ~180-250 Mbps AES/ChaCha20 throughput.
- **RB5009 (ARM64):** ~900-1400 Mbps wire-speed throughput.
- **CCR2116 (16-core ARM64):** Exceeds 8-10 Gbps encrypted transit.

### 3.4. Docker Container RAM & Storage Constraints
- **Never deploy containers onto internal NAND flash!** Internal flash has limited write cycles (often only 16MB-128MB) and will degrade rapidly.
- **Strict Prerequisite:** Always format an external USB 3.0 SSD / NVMe drive (`/disk format-drive ... ext4`) and mount container root directories onto `/usb1-part1`.
- Container memory must be explicitly capped with `memory-limit` to prevent the RouterOS kernel from running out of memory (OOM panic).
