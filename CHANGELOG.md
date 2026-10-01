# Changelog

All notable changes to the **MikroTik NetDevOps Suite & MCP Server** repository will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-01

### Added
- **Fullscreen Interactive Terminal User Interface (TUI) Dashboard & Wizards:**
  - Implemented zero-dependency ANSI alternate screen buffer manager (`src/tui/screen.ts`) with graceful signal handling (`SIGINT`, `SIGTERM`, `exit`) and terminal state restoration.
  - Dual-pane layout featuring 9-category left sidebar navigation (`System Telemetry`, `10-Pillar Audit`, `Multi-WAN PCC`, `WireGuard Studio`, `Hotspot Studio`, `Traffic Monitor`, `PoE & Fleet`, `Config Linter`, and `Profiles & MCP`).
  - Interactive terminal configuration wizards:
    - **Multi-WAN PCC Calculator**: Step-by-step ratio selector generating certified RouterOS v7 Mangle & FIB rules.
    - **WireGuard Provisioning Studio**: Instant Curve25519 x25519 keypair generation with client `.conf`, router commands, and ASCII QR code.
    - **Captive Hotspot Studio**: 5-in-1 authentication model selector generating HTML5 bundles and walled garden rules.
    - **10-Pillar Security Audit**: One-button interactive audit evaluating live router security posture with severity badges (`CRITICAL`, `WARN`, `PASS`).
  - Visual resource gauges: Real-time ASCII progress meters (`[██████░░░░]`) for CPU load and RAM utilization.
  - Interactive CLI trigger: `mtik tui` / `mtik ui`, with automatic TUI launch when invoking `mtik` without arguments in an interactive TTY.
  - Comprehensive TUI test suite in `test/tui.test.ts` bringing total test coverage to **73 passing tests** across 15 test suites.

### Changed
- **Suite-Wide Rebranding to NetDevOps Toolkit & MCP Server:**
  - Elevated repository positioning from a passive "skill" to a production **NetDevOps Automation Toolkit, MCP Server, and AI Engineering Suite**.
  - Repositioned `.agents/skills/mikrotik/SKILL.md` as **The Brain** (*AI Knowledge & Engineering Engine*).
  - Updated documentation across `README.md`, `package.json`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `public/index.html`.
  - Expanded complete MCP tools table in `README.md` to cover all 22 active tools.
- **Hardware Architecture & Compatibility Matrix Accuracy:**
  - Separated new **MikroTik hEX S Refresh (`E60iUGS`)** (ARM 32-bit, MediaTek EN7562CT Dual-Core 950 MHz, 512MB RAM, 128MB NAND) from legacy **hEX S (`RB760iGS`)** (MMIPS, MT7621A).
  - Documented E60iUGS port layout (ether1 direct CPU vs ether2-5 switch chip HW offload) and `arm32v5` instruction requirements for container images.
- **CI/CD & Actions Workflows:**
  - Automated dependency upgrades: `actions/checkout@v7`, `actions/setup-node@v7`, `softprops/action-gh-release@v3`.
  - Configured dual-registry publishing supporting both `npmjs.com` (`npx mikrotik-skill`) and GitHub Packages (`@ardianryan/mikrotik-skill`).

---

## [1.1.2] - 2026-09-20

### Added
- **Fleet Inventory & Multi-Router Management:**
  - Zero-dependency YAML/JSON inventory parser (`inventory.yml`, `inventory.example.yml`) with environment variable interpolation.
  - Multi-router targeting across profiles and inventory via `mtik devices` / `mtik inventory` CLI and `mikrotik_list_devices` MCP tool.
  - Global `-d, --device <name>` CLI option and MCP `targetDevice` parameter.
- **Hardware & Live Diagnostics Operations:**
  - **PoE Power Management:** `mtik poe` CLI and `mikrotik_manage_poe` MCP tool for inspecting wattage/voltage and power-cycling connected devices.
  - **Live Log Triage:** `mtik logs` CLI and `mikrotik_get_logs` MCP tool with topic filtering (`firewall`, `dhcp`, `warning`, etc.).
  - **CAKE SQM Bufferbloat Queues:** `mtik queue` CLI and `mikrotik_manage_queues` MCP tool for low-latency CAKE queue management.
  - **Wireless Client Telemetry:** `mtik wifi` CLI and `mikrotik_get_wireless_clients` MCP tool supporting both RouterOS v7 `wifi`/`wifiwave2` and legacy wireless packages.
- **NPM Distribution & Automated Publishing Pipeline:**
  - Added dedicated GitHub Actions workflow `.github/workflows/publish.yml` with `workflow_dispatch` and release trigger using `${{ secrets.NPM_TOKEN }}`.
  - Registered `mikrotik-skill` binary alias in `package.json` for zero-setup execution via `npx mikrotik-skill` and `npx mikrotik-skill mcp`.
  - Added CLI `mcp` subcommand for direct STDIO MCP server boot.
- **Enterprise Reference Guides & 3-View Workbench Portal:**
  - Added `fleet-inventory.md`, `poe-power-management.md`, and `log-triage-forensics.md` to `.agents/skills/mikrotik/references/`.
  - Redesigned `public/index.html` into a dark titanium 3-view workbench portal (`#overview`, `#tools`, `#docs`).

---

## [1.1.0] - 2026-09-19

### Added
- **Vercel Serverless Deployment Support:**
  - Added `api/index.ts` and `vercel.json` for 1-click deployment to Vercel.
  - Allows ChatGPT Custom GPT Actions to communicate directly with MikroTik routers via HTTPS.
- **HTTP & OpenAPI Gateway Engine:**
  - Implemented `MikroTikHttpServer` (`src/server/http.ts`) using native Node.js HTTP server.
  - Implemented `OpenApiGenerator` (`src/server/openapi.ts`) generating OpenAPI 3.1.0 schema for ChatGPT Actions.
  - CLI command `mtik serve [--port 3000] [--token <secret>]` to run local gateway.
  - CLI command `mtik openapi [-o schema.json] [-u <url>]` to export OpenAPI 3.1.0 specification.
  - Bearer Token authentication (`MTIK_API_KEY` or `Authorization: Bearer <token>`) to protect router endpoints when exposed over the internet.
- **10-Track MikroTik Certified Engineer Curricula Alignment:**
  - Full reference runbooks and templates covering all 10 official certification tracks:
    - **MTCNA** (Network Associate): System health, watchdog, sanitized backup, DHCP snooping.
    - **MTCRE** (Routing Engineer): Policy-Based Routing (PBR) and recursive failover with Virtual SLA.
    - **MTCINE** (Inter-Networking Engineer): MPLS LDP loopback, transparent VPLS, and multi-tenant VRF.
    - **MTCTCE** (Traffic Control Engineer): Packet flow pipeline, Conntrack states, 4-tier Mangle, CAKE QoS.
    - **MTCSWE** (Switching Engineer): LACP 802.3ad bonding, IGMP/MLD snooping, port isolation, HW MSTP.
    - **MTCSE** (Security Engineer): 10-Pillar Security Audit, MAC-server isolation, DoH Root CA trust.
    - **MTCIPv6E** (IPv6 Engineer): DHCPv6-PD prefix delegation, SLAAC discovery, RFC 4890 ICMPv6 filter.
    - **MTCUME** (User Management Engineer): User Manager v7 local RADIUS, dynamic 802.1X VLANs, Hotspot.
    - **MTCEWE** (Enterprise Wireless Engineer): Wi-Fi 6 (802.11ax), central CAPsMAN v2, 802.11r/k/v roaming.
    - **MTCWE** (Wireless Engineer): Standalone Wi-Fi 6 AP, frequency planning, regulatory compliance.
  - Reference runbook `cli-rest-complete-reference.md` covering complete RouterOS v7 CLI menus and REST endpoints.
- **ChatGPT & Claude.ai Web AI Copy-Paste Workflow:**
  - CLI command `mtik prompt [-o file.md]` and MCP tool `mikrotik_get_chat_prompt`.
  - Enforces 1-click copy-pasteable contiguous `routeros` script blocks with `#` comments and safe-mode warnings.
- **Security Auditor Expanded to 10 Pillars:**
  - Added `F-08` (IPv6 Firewall Absence), `F-09` (Bridge Loop Protection / STP), and `F-10` (Conntrack Transit Integrity).

---

## [1.0.2] - 2026-09-18

### Added
- **Docker Microservices Management (`mtik container`):**
  - Inspect, start, stop, and restart containerized workloads (AdGuard Home, Tailscale, Cloudflare Tunnel) on RouterOS v7.
- **DNS Adblocker Feeds (`mtik adlist`):**
  - Query, reload, and verify network-wide adblocker domain lists in RouterOS v7.
- **Real-Time Interface Bandwidth Monitor (`mtik monitor`):**
  - Interactive terminal dashboard tracking RX/TX throughput across WAN and LAN interfaces.

---

## [1.0.1] - 2026-09-17

### Added
- **Dual-Transport Connection Manager:**
  - Primary transport via RouterOS v7 REST API (HTTPS/HTTP).
  - Automatic fallback to Native RouterOS API (Port 8728 / 8729 SSL).
- **30-Second Safe-Mode Watchdog:**
  - Automatic `/system schedule` rollback armed before mutations, automatically disarmed upon heartbeat confirmation.
- **Configuration Sanitizer (`mtik backup --sanitize`):**
  - Deep redaction of MAC addresses, serial numbers, passwords, preshared keys, and VPN identifiers.

---

## [1.0.0] - 2026-09-16

### Initial Release
- **Deterministic 4-Tier Mangle Order Engine.**
- **7-Pillar Security Audit Engine.**
- **Model Context Protocol (MCP) Server (`mtik-mcp`)** for Antigravity, Cursor, Claude Desktop, and Windsurf IDEs.
- **Strict TypeScript Types & Comprehensive Automated Test Suite.**
