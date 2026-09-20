---
name: mikrotik
description: "Enterprise network automation, multi-WAN load balancing, security audits, and configuration runbooks for MikroTik RouterOS v7. Use when auditing RouterOS security, setting up dual-WAN failover/PCC, configuring WPA2/WPA3 Enterprise 802.1X RADIUS, deploying CAKE QoS, creating WireGuard tunnels, running containers, or managing IDE MCP integrations."
references:
  - references/mtcswe-advanced-switching.md
  - references/mtcine-mpls-vpls-vrf.md
  - references/mtcewe-enterprise-wifi.md
  - references/hardware-switch-matrix.md
  - references/doh-security.md
  - references/ipv6-dual-stack.md
  - references/monitoring-alerting.md
  - references/packet-flow-v7.md
  - references/bridge-vlan-switching.md
  - references/enterprise-routing-ospf-bgp.md
  - references/troubleshooting-protocol.md
  - references/radius-8021x.md
  - references/hotspot-portal.md
  - references/qos-cake.md
  - references/wireguard-vpn.md
  - references/docker-containers.md
  - references/rest-api.md
  - references/cli-rest-complete-reference.md
  - references/official-manual-map.md
  - references/fleet-inventory.md
  - references/poe-power-management.md
  - references/log-triage-forensics.md
---

# MikroTik RouterOS v7 Automation & Enterprise Engineering Skill

Production-grade guidance, architecture standards, and operational runbooks for managing MikroTik RouterOS v7 devices through CLI (`mtik`) and Model Context Protocol (`mtik-mcp`).

---

## 1. Core Architectural Directives

All AI agents interacting with or generating configurations for MikroTik devices must strictly comply with these six rules:

1. **RouterOS v7 Exclusivity:** Always use RouterOS v7 syntax. Never generate RouterOS v6 syntax:
   - In v7, routing tables must be explicitly registered under `/routing table add name="<NAME>" fib` before being referenced in Mangle or `/ip route`.
   - In v7, routing rules reside under `/routing rule`, not `/ip route rule`.
   - In v7, use modern CAKE (`kind=cake`) or FQ-CoDel (`kind=fq-codel`) in `/queue type` rather than legacy PCQ for interactive low-latency traffic.
2. **FastTrack vs Mangle Interaction:**
   - The default `fasttrack-connection` firewall rule bypasses Mangle prerouting and queue trees for established TCP/UDP streams.
   - When policy routing (PCC or client override) or CAKE QoS is deployed, you must exempt marked traffic from FastTrack or disable FastTrack:
     ```routeros
     # Exempt policy-routed connections from FastTrack:
     /ip firewall filter set [find action=fasttrack-connection] connection-mark=no-mark
     ```
3. **Vendor-Neutral Terminology:**
   - Never reference specific commercial ISP brand names or public IP addresses in configurations, scripts, or discussions.
   - Always standardize on `ISP1`, `ISP2`, `WAN1`, `WAN2`, `Primary ISP`, or `Secondary ISP`.
4. **Deterministic Mangle Hierarchy:**
   Packets traverse Mangle prerouting sequentially. Ordering violations cause routing loops, broken NAT, or dropped sessions. Rules must be positioned in this strict order:
   - **Tier 0 (Bypass - Indices 0..1):** `connection-nat-state=dstnat action=accept` (preserves Hairpin NAT) and destination address list bypass (`dst-address-list=LOCAL_BYPASS action=accept`).
   - **Tier 1 (Client Overrides):** Specific host/subnet routing rules (`action=mark-routing new-routing-mark=to_ISP1 passthrough=no`).
   - **Tier 2 (PCC Balancer):** Flow classifiers (`per-connection-classifier=both-addresses-and-ports:2/0`) marking connections, followed by routing marks with `passthrough=no`.
   - **Tier 3 (MSS Clamping):** Forward chain `tcp-flags=syn action=change-mss new-mss=clamp-to-pmtu`.
5. **Safe-Mode Watchdog & Visual Diff:**
   - Never execute disruptive routing table changes or firewall filter drops directly.
   - Always run with `--dry-run` or `dryRun: true` first to display an ANSI-colored diff preview.
   - When committing mutations, arm the automated 30-second watchdog rollback scheduler (`mtik_safe_watchdog`) to revert configuration if connectivity drops.
6. **Zero-Leakage Privacy Policy:**
   - Never output real MAC addresses, hardware serial numbers, software IDs, passwords, shared secrets, WireGuard private keys, ZeroTier network IDs, or Cloudflare tunnel tokens.
   - Always invoke `mikrotik_export_sanitized_config` or `mtik backup --sanitize` before sharing router output.
7. **Reference Hierarchy (Local Skill First, Web Docs as Last Resort):**
   - **Tier 1 (Utama / Primary Knowledge):** Always consult and utilize the instructions, runbooks, and architectures embedded in this skill (`SKILL.md` and `references/*.md`). Do not waste context or network bandwidth performing web scrapes if the topic is already covered locally.
   - **Tier 2 (Fallback / Opsi Terakhir):** Querying official live web documentation (`https://manual.mikrotik.com/llms.txt`, `https://manual.mikrotik.com/docs/<path>.md`, or `/docs/cli-reference/`) is strictly reserved as a fallback/last-resort mechanism when encountering unlisted hardware switch chip capabilities, emerging RouterOS v7 minor release features, or properties missing from the local skill.

---

## 2. Interactive Advisory & Confirmation-First Protocol (The Anti-Blind Execution Standard)

AI agents operating in this repository must adopt a **consultative, confirmation-first workflow** identical to the `security-audit` and `antislop` guidelines. **Never execute live mutations blindly or assume authorization to reconfigure the user's network.**

### 2.1. The Three Operating Modes

| Mode | Trigger / Context | Agent Behavior | Mutates Router? |
|---|---|---|:---:|
| **Mode 1: Guidance & Diagnostic Audit (Default)** | General questions, troubleshooting reports, performance queries, or security reviews | Safely inspect router (`mikrotik_audit_security`, `mikrotik_get_system_status`, `mikrotik_list_mangle`). Generate an executive assessment with **Numbered Findings (`[F-01]`, `[F-02]`, ...)**, technical impacts, and copy-pasteable remediation commands. | ❌ NO |
| **Mode 2: Staged Review & Dry-Run Diff** | User selects specific findings or asks to prepare a plan | Request user selection of finding IDs. Generate an exact unified diff preview using `dryRun: true` or `--dry-run`. Prompt the user for explicit approval before proceeding. | ❌ NO |
| **Mode 3: Guarded Execution with Watchdog** | Explicit user approval received | Arm the automated 30-second safe-mode watchdog scheduler (`SafeModeWatchdog`). Apply the approved changes. Confirm post-flight device connectivity and disarm the watchdog. | ✅ YES (Guarded) |

---

### 2.2. Interactive Inquiries & Dialog Boxes (`ask_question`)

Whenever user intent is underspecified, or before progressing from an Audit to a Plan or Execution, the agent **must** use the interactive `ask_question` tool (or structured multiple-choice questions in chat) to align on scope and preferences.

#### Pattern 1: Goal Triage & Scoping
When the user gives an ambiguous prompt like "help fix my network" or "check my router":
```json
{
  "questions": [
    {
      "question": "What primary objective would you like to achieve on your MikroTik router?",
      "options": [
        "(Recommended) Run a 7-Pillar Security Audit and produce a diagnostic report",
        "Troubleshoot slow internet or bufferbloat using CAKE QoS",
        "Configure multi-WAN failover or policy routing (PCC)",
        "Deploy a WireGuard Zero-Trust VPN or Docker container"
      ],
      "is_multi_select": false
    }
  ]
}
```

#### Pattern 2: Operating Mode Confirmation
Before touching any configuration or preparing an implementation plan:
```json
{
  "questions": [
    {
      "question": "How would you like to proceed with the recommendations?",
      "options": [
        "(Recommended) Generate a detailed Audit Report with recommendations only (zero mutations)",
        "Prepare an implementation plan with a visual dry-run diff preview",
        "Apply approved remediations directly under a 30-second safe-mode watchdog"
      ],
      "is_multi_select": false
    }
  ]
}
```

#### Pattern 3: Selecting Numbered Findings for Remediation
After generating an audit report with numbered findings (`[F-01]`, `[F-02]`, etc.):
```json
{
  "questions": [
    {
      "question": "Which audit findings would you like to prepare a remediation plan for?",
      "options": [
        "(Recommended) Remediate all CRITICAL and WARN findings",
        "Remediate only CRITICAL findings (e.g. WAN Open DNS Resolver)",
        "Select specific finding IDs manually (e.g. F-01, F-02)",
        "None (keep current configuration, report only)"
      ],
      "is_multi_select": false
    }
  ]
}
```

---

### 2.3. Structured Audit Report Format

When delivering an audit or diagnostic assessment in Mode 1, agents must structure the output in this standardized format:
1. **Header & Device Health Snapshot:** Identity, firmware version, CPU utilization, free memory, and active interface counts.
2. **Executive Assessment Summary:** Clear status badge (`SECURE`, `NEEDS_ATTENTION`, or `VULNERABLE`).
3. **Numbered Findings Table:** Every finding MUST have an ID (`[F-01]`, `[F-02]`, etc.), Pillar, Severity (`CRITICAL`, `WARN`, `PASS`, `INFO`), Title, and technical consequence.
4. **Remediation Action Plan:** Proposed copy-pasteable RouterOS v7 commands for each finding, clearly mapped to finding IDs.
5. **Interactive Confirmation Prompt:** Asking the user which finding IDs they want to remediate or preview.

---

## 3. Operational Decision Trees

### Network Troubleshooting & Performance Triage
```
User reports slow connection or packet drops
├─ Check device health & CPU load
│  └─ mtik status (mikrotik_get_system_status)
│     ├─ CPU > 85% → Check /tool/profile for process hogs (networking, firewall, container)
│     └─ Memory depleted → Check container RAM allocation or large DNS cache
├─ Check link saturation & interface throughput
│  └─ mtik monitor -i WAN1,WAN2 (inspect live RX/TX rates)
│     ├─ Egress saturated → Deploy CAKE bufferbloat limiter (references/qos-cake.md)
│     └─ One WAN idle in dual-WAN → Inspect Mangle PCC counters and check-gateway status
└─ Check DNS resolution latency & open resolver risk
   └─ mtik audit (mikrotik_audit_security)
```

### Routing Modification & Traffic Steering
```
User wants to force a client IP through a specific ISP
├─ 1. Verify routing table existence & FIB flag
│  └─ /routing table print → Ensure target table (e.g. to_ISP1) has fib=yes
├─ 2. Inspect existing Mangle hierarchy
│  └─ mtik mangle (mikrotik_list_mangle)
│     └─ Identify index of last Bypass rule (insert client override immediately after)
├─ 3. Run dry-run preview
│  └─ mtik route-force --ip <IP> --table <TABLE> --dry-run
└─ 4. Apply with Watchdog protection
   └─ mtik route-force --ip <IP> --table <TABLE>
```

### IDE MCP Server Integration
```
User wants to use MikroTik tools inside their AI coding environment
├─ Check target IDE
│  ├─ Antigravity → ~/.gemini/config/mcp_config.json
│  ├─ Cursor → ~/.cursor/mcp.json
│  ├─ Claude Desktop → ~/Library/Application Support/Claude/claude_desktop_config.json
│  ├─ Windsurf → ~/.codeium/windsurf/mcp_config.json
│  └─ All IDEs → --target all
└─ Execute installer
   ├─ Use global binary: mtik install-mcp -t <ide>
   └─ Include current router credentials: mtik install-mcp -t <ide> --with-env
```

---

## 4. Agent Triage & Execution Workflows

### Workflow A: 7-Pillar Security Audit & Hardening
When asked to inspect, harden, or audit router security:
1. **Execute Audit:** Call `mikrotik_audit_security` (or run `mtik audit`).
2. **Evaluate 7 Pillars:**
   - *Pillar 1: DNS Open Resolver:* If `allow-remote-requests=yes`, verify WAN input drop rule for UDP/TCP 53.
   - *Pillar 2: Administrative Service Exposure:* Verify `api`, `winbox`, `ssh`, `www-ssl` are bound to trusted IP ranges (`address=192.168.0.0/16`) or disabled.
   - *Pillar 3: Mangle Hierarchy Integrity:* Verify `connection-nat-state=dstnat action=accept` is at index 0.
   - *Pillar 4: FIB Table Registration:* Verify every `new-routing-mark` has a corresponding `/routing table` entry with `fib=yes`.
   - *Pillar 5: Time Synchronization:* Verify `/system ntp client` is enabled with active servers.
   - *Pillar 6: Firewall Filter Hygiene:* Verify invalid connection drop rule exists in input and forward chains.
   - *Pillar 7: Resource Saturation:* Verify CPU load < 85% and disk usage < 90%.
3. **Generate Remediation Plan:** Output exact, copy-pasteable RouterOS v7 commands for any failing pillars.

### Workflow B: Safe Multi-WAN Traffic Steering
When asked to direct specific devices or traffic through a secondary WAN:
1. Call `mikrotik_list_mangle` to verify rule count and index positions.
2. Confirm the target routing table exists in `/routing table`. If missing, output:
   ```routeros
   /routing table add name="to_ISP2" fib
   /ip route add dst-address=0.0.0.0/0 gateway=<ISP2_GATEWAY> routing-table=to_ISP2 check-gateway=ping
   ```
3. Execute `mikrotik_force_routing` with `dryRun: true`. Show the unified diff to the user.
4. With user confirmation, call `mikrotik_force_routing` with `dryRun: false`. This arms the 30-second rollback watchdog, injects the rule at the correct Tier 1 index, and verifies connectivity.

### Workflow C: Dual-WAN PCC & Recursive Failover Setup
When provisioning multi-WAN load balancing from scratch:
1. Define routing tables with `fib=yes`:
   ```routeros
   /routing table add name="to_ISP1" fib
   /routing table add name="to_ISP2" fib
   ```
2. Configure recursive failover using independent canary DNS hosts:
   ```routeros
   # Canaries (scope 10)
   /ip route add dst-address=1.1.1.1/32 gateway=<ISP1_GW> scope=10 comment="Canary ISP1"
   /ip route add dst-address=8.8.8.8/32 gateway=<ISP2_GW> scope=10 comment="Canary ISP2"

   # Default recursive routes (target-scope 11)
   /ip route add distance=1 gateway=1.1.1.1 check-gateway=ping target-scope=11 comment="Default Primary"
   /ip route add distance=2 gateway=8.8.8.8 check-gateway=ping target-scope=11 comment="Default Secondary"

   # Table specific recursive routes
   /ip route add distance=1 gateway=1.1.1.1 routing-table=to_ISP1 check-gateway=ping target-scope=11
   /ip route add distance=2 gateway=8.8.8.8 routing-table=to_ISP1 target-scope=11

   /ip route add distance=1 gateway=8.8.8.8 routing-table=to_ISP2 check-gateway=ping target-scope=11
   /ip route add distance=2 gateway=1.1.1.1 routing-table=to_ISP2 target-scope=11
   ```
3. Apply PCC Mangle rules with Hairpin NAT protection at index 0 (see Section 4).

### Workflow D: Configuration Export & Public Sanitization
When the user shares configuration snippets or asks to export a backup:
1. Call `mikrotik_export_sanitized_config` or run `mtik backup --sanitize`.
2. Inspect output to ensure:
   - MAC addresses are replaced with `XX:XX:XX:XX:XX:XX`.
   - Serial numbers and software IDs are replaced with `[REDACTED_SERIAL]`.
   - All secret fields (`password=`, `preshared-key=`, `private-key=`, `tunnel-token=`) are masked with `********`.
3. Never store or output unredacted `.rsc` files in public logs.

### Workflow E: Multi-Router Fleet Inventory Orchestration
When managing multiple MikroTik routers or switches across campus/branches:
1. Define devices declaratively in `inventory.yml` using `${ENV_VARS}` for credentials (refer to [`fleet-inventory.md`](./references/fleet-inventory.md)).
2. Enumerate active inventory devices: `mtik devices` or `mikrotik_list_devices`.
3. Pass `targetDevice: "<name>"` (or CLI `-d <name>`) to target operations at a specific device rather than the default router.
4. Execute synchronized fleet audits and sanitized backups using batch loops.

### Workflow F: Remote PoE Port Diagnostics & Power-Cycling
When an IP camera, VoIP phone, or downstream Access Point is unresponsive:
1. Check port power status: `mtik poe` (or call `mikrotik_manage_poe` with `action: "status"`).
2. Inspect `poe-out-status`, `poe-voltage`, and `poe-power` (refer to [`poe-power-management.md`](./references/poe-power-management.md)).
3. If the device is frozen, cold-reboot it without rebooting the main switch:
   ```bash
   mtik poe --cycle ether2
   # or via MCP: mikrotik_manage_poe with action: "power-cycle", interface: "ether2"
   ```
4. Verify port returns to `poe-out-status=powered-on` and device reconnects.

### Workflow G: Forensic Log Analysis & Threat Triage
When investigating authentication failures, rogue DHCP servers, or drops:
1. Query system logs filtered by relevant topics:
   ```bash
   # Investigate brute-force attempts
   mtik logs -t account,warning -l 50
   # Investigate rogue DHCP servers
   mtik logs -t dhcp,warning -l 30
   # or via MCP: mikrotik_get_logs with topics: ["account", "warning"], limit: 50
   ```
2. For brute force attempts, cross-reference source IP against active firewall address lists (refer to [`log-triage-forensics.md`](./references/log-triage-forensics.md)).
3. Never write high-frequency firewall logs to NAND flash (`action=disk`); always use `memory` or forward to a remote SIEM syslog host (`action=remote`).

### Workflow H: Wi-Fi 6 Client Diagnostic & SNR Triage
When troubleshooting poor wireless coverage, roaming drops, or low throughput:
1. Inspect live client registrations: `mtik wifi` or `mikrotik_get_wireless_clients`.
2. Evaluate signal metrics:
   - **Signal Strength:** Best: `-45 dBm` to `-65 dBm`. Unacceptable: `< -75 dBm`.
   - **Signal-to-Noise Ratio (SNR):** Should be `>= 25 dB` for reliable Wi-Fi 6 OFDMA throughput.
3. If clients are "sticky" to distant APs, tune CAPsMAN access list reject thresholds (`signal-range=-120..-78 action=reject`) to force roaming.

---

## 5. RouterOS v7 Production Mangle Blueprint

```routeros
# ==========================================================
# TIER 0: BYPASS & HAIRPIN NAT PROTECTION (Index 0..1)
# ==========================================================
/ip firewall mangle add chain=prerouting action=accept connection-nat-state=dstnat \
    comment="[TIER 0] Hairpin NAT Bypass - Must remain at Index 0"
/ip firewall mangle add chain=prerouting action=accept dst-address-list=LOCAL_BYPASS \
    comment="[TIER 0] Local Inter-VLAN Bypass"

# ==========================================================
# TIER 1: CLIENT POLICY ROUTING OVERRIDES (Index 2..N)
# ==========================================================
/ip firewall mangle add chain=prerouting src-address=192.168.88.50 dst-address-type=!local \
    action=mark-routing new-routing-mark=to_ISP1 passthrough=no \
    comment="[TIER 1] Dedicated Workstation -> ISP1"

# ==========================================================
# TIER 2: PCC CONNECTION & ROUTING CLASSIFIERS
# ==========================================================
# Connection Marking (hash: both-addresses-and-ports)
/ip firewall mangle add chain=prerouting in-interface-list=LAN dst-address-type=!local connection-state=new \
    per-connection-classifier=both-addresses-and-ports:2/0 action=mark-connection new-connection-mark=ISP1_conn passthrough=yes \
    comment="[TIER 2] PCC Stream 1/2 -> ISP1"
/ip firewall mangle add chain=prerouting in-interface-list=LAN dst-address-type=!local connection-state=new \
    per-connection-classifier=both-addresses-and-ports:2/1 action=mark-connection new-connection-mark=ISP2_conn passthrough=yes \
    comment="[TIER 2] PCC Stream 2/2 -> ISP2"

# Routing Marking based on Connection Mark
/ip firewall mangle add chain=prerouting connection-mark=ISP1_conn in-interface-list=LAN \
    action=mark-routing new-routing-mark=to_ISP1 passthrough=no comment="[TIER 2] Route ISP1 Stream"
/ip firewall mangle add chain=prerouting connection-mark=ISP2_conn in-interface-list=LAN \
    action=mark-routing new-routing-mark=to_ISP2 passthrough=no comment="[TIER 2] Route ISP2 Stream"

# ==========================================================
# TIER 3: MSS CLAMPING (Path MTU Discovery Fix)
# ==========================================================
/ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn action=change-mss \
    new-mss=clamp-to-pmtu comment="[TIER 3] Clamp MSS to PMTU"
```

---

## 6. RouterOS v7 vs v6 Critical Compatibility Matrix

| Feature | RouterOS v6 (Legacy) | RouterOS v7 (Production Standard) | Agent Action |
|---|---|---|---|
| **Routing Tables** | Implicitly created when routing mark used | Must be explicitly added in `/routing table add name=X fib` | Always check `/routing table` before marking |
| **Routing Rules** | `/ip route rule` | `/routing rule` | Use `/routing rule` syntax |
| **Failover Check** | `check-gateway=ping` on direct gateway | Recursive routing with `scope=10` and `target-scope=11` | Avoid pinging local gateway; ping upstream canaries |
| **QoS Queuing** | Simple Queues (FIFO / PCQ) | CAKE (`kind=cake`) & FQ-CoDel | Deploy CAKE for anti-bufferbloat |
| **Containers** | Not supported | Supported via native `/container` on ARM/x86 | Mount rootfs on USB/SSD storage |
| **DNS Adblocking** | Complex static regex lists | Native `/ip dns adlist` | Use `/ip dns adlist add url=...` |
| **API Transport** | Port 8728 / 8729 proprietary binary socket | REST API over HTTPS 443 + Binary fallback | Use REST API primarily; fall back to 8728 |

---

## 7. Troubleshooting & Recovery Matrix

| Symptom / Error Signature | Root Cause | Remediation Command |
|---|---|---|
| `failure: already have such routing mark` | Custom routing table not declared in v7 kernel FIB | `/routing table add name="<NAME>" fib` |
| Policy routed clients lose internal LAN access | Missing `dst-address-type=!local` or Tier 0 bypass | Add `dst-address-type=!local` to mark-routing rules |
| Hairpin NAT loop / cannot open local port forwards | Mangle prerouting marks packet before DST-NAT | Place `action=accept connection-nat-state=dstnat` at index 0 |
| QoS queue shows 0 bps despite heavy traffic | FastTrack is bypassing Mangle and Queue trees | Set `connection-mark=no-mark` on FastTrack rule |
| Container fails to start (`error: disk full`) | Container written to internal NAND flash | Set `root-dir=usb1/...` and `tmpdir=usb1/tmp` |
| CLI connection refused | REST API service (`www` or `www-ssl`) disabled | `/ip service enable www-ssl` or use port 8728 binary API |
| PoE port shows `overload` or `short-circuit` | Downstream camera/AP exceeding port wattage or shorted cable | Inspect cable termination, check power budget, run `mtik poe --cycle <iface>` |
| Wi-Fi 6 client deauthentications / low SNR | Sticky client associated to distant AP with SNR < 20 dB | Run `mtik wifi`, tune CAPsMAN access-list `signal-range=-120..-78 action=reject` |
| NAND flash write exhaustion | Logging firewall packets directly to `disk` action | Set `/system logging action set memory memory-lines=5000` or forward to remote syslog |
| Device name not resolved in fleet | Missing inventory entry or unresolved `${ENV_VAR}` | Check `inventory.yml` and test resolution with `mtik devices` |

---

## 8. Tooling & Integration Reference

### Global CLI (`mtik`)
```bash
# Connectivity & Diagnostics
mtik test                                     # Test REST / Port 8728 connection and measure latency
mtik status                                   # Inspect CPU load, memory, active interfaces, DHCP leases
mtik monitor -i ether1,ether2                 # Live terminal throughput and packet rate monitor
mtik profile [--save <name>|--switch <name>]  # Manage multiple router connection profiles

# Fleet Inventory & Multi-Device Orchestration
mtik devices                                  # List managed fleet routers from inventory.yml & profiles
mtik logs [-d <dev>] [-t <topics>] [-l <num>] # Stream and filter live router/firewall event logs
mtik poe [-d <dev>] [-l|--cycle <iface>]      # Inspect PoE voltage/power or power-cycle downstream port
mtik queue [-d <dev>] [-l|--cake]             # Inspect simple queues or provision low-latency CAKE SQM
mtik wifi [-d <dev>]                          # Inspect connected Wi-Fi 6 / wifiwave2 client registrations

# Security & Safety
mtik audit                                    # Execute 7-Pillar Security Audit
mtik backup [--sanitize]                      # Structured backup (with optional sanitization)

# Routing & Traffic Steering
mtik mangle                                   # Display mangle rules with hierarchy index analysis
mtik route-force --ip <IP> --table <TABLE>    # Apply policy routing with dry-run diff & watchdog

# Network Services & Containers
mtik lease --add --ip <IP> --mac <MAC>        # Add static DHCP lease reservation
mtik container [list|--restart <id>]          # List and manage Docker containers
mtik adlist [list|--add <url>]                # Inspect or register DNS sinkhole blocklists

# Hotspot & Captive Portal Studio
mtik hotspot [--model voucher|member|dual|all-in-one] [-o ./hotspot] # Generate modern captive portal & config

# Certification Templates Generator (10 Tracks)
mtik template --list                          # List all 10 certified configuration templates
mtik template <track>                         # Print certified production configuration
mtik template <track> -o <file.rsc>           # Save configuration script to RouterOS .rsc file

# Universal CLI & REST Execution (Omnipotent Tooling)
mtik exec "<ros_script>"                      # Execute arbitrary RouterOS CLI script atomically
mtik rest <GET|POST|PUT|PATCH|DELETE> <path>  # Perform direct REST API request to RouterOS v7

# IDE MCP Setup
mtik install-mcp -t <antigravity|cursor|claude|windsurf|all> [--with-env]
```

### Model Context Protocol (`mtik-mcp`) Tools
- `mikrotik_test_connection`: Verifies device connectivity, authentication, and transport mode (REST HTTPS or Binary 8728).
- `mikrotik_get_system_status`: Returns CPU load, memory usage, RouterOS version, uptime, and active interface link status.
- `mikrotik_audit_security`: Performs automated 7-pillar security audit and returns findings with remediation commands.
- `mikrotik_list_mangle`: Fetches all firewall mangle rules with index ordering and tier classifications.
- `mikrotik_force_routing`: Directs an IP address to a routing table. Supports `dryRun: true` for unified diff preview and automated 30s watchdog rollback.
- `mikrotik_manage_dhcp_lease`: Queries active leases and registers static IP/MAC bindings.
- `mikrotik_export_sanitized_config`: Exports full router configuration with all MACs, passwords, serials, and private tokens redacted.
- `mikrotik_manage_container`: Lists running container status and initiates container restarts.
- `mikrotik_get_adlist_status`: Queries status of `/ip dns adlist` malware/adblocker feeds.
- `mikrotik_generate_template`: Generates standardized production configuration templates across all 10 certification tracks.
- `mikrotik_generate_hotspot_portal`: Generates responsive mobile-first login.html, status.html, and RouterOS v7 walled-garden configuration supporting Voucher PINs, Member logins, Google OAuth relay, and Free Trial access.
- `mikrotik_execute_command`: Executes arbitrary RouterOS CLI command or script atomically with output sanitization.
- `mikrotik_rest_query`: Sends direct HTTP REST API calls (GET, POST, PUT, PATCH, DELETE) to any `/rest/<menu>` endpoint.
- `mikrotik_list_devices`: Enumerates all managed routers from `inventory.yml`, stored profiles, or active environment.
- `mikrotik_get_logs`: Retrieves live system and firewall logs with optional topic filtering and limit.
- `mikrotik_manage_poe`: Inspects PoE port power metrics or executes clean cold power cycling on stuck downstream devices.
- `mikrotik_manage_queues`: Queries simple queues or provisions low-latency CAKE SQM queue trees to defeat bufferbloat.
- `mikrotik_get_wireless_clients`: Inspects connected wireless clients with SNR, signal strength, and transmission rates.

---

## 9. Enterprise Reference Architecture Guides

For detailed, step-by-step implementation templates, refer to:
- [Multi-Router Fleet Inventory & Infrastructure Automation](./references/fleet-inventory.md)
- [Power over Ethernet (PoE) Architecture & Power Management](./references/poe-power-management.md)
- [Forensic Log Analysis, Threat Triage & Syslog Architecture](./references/log-triage-forensics.md)
- [RouterOS v7 Complete CLI & REST API Master Reference](./references/cli-rest-complete-reference.md)
- [MTCSWE: Advanced Switching, LACP Bonding & Multicast](./references/mtcswe-advanced-switching.md)
- [MTCINE: Enterprise Inter-Networking, MPLS, VPLS & VRF](./references/mtcine-mpls-vpls-vrf.md)
- [MTCEWE & MTCWE: Enterprise Wireless, Wi-Fi 6 & CAPsMAN v2](./references/mtcewe-enterprise-wifi.md)
- [Hardware Architecture & Switch Chip Sizing Matrix](./references/hardware-switch-matrix.md)
- [DNS-over-HTTPS (DoH) & Root CA Trust Store Security](./references/doh-security.md)
- [Enterprise IPv6 Dual-Stack & RFC 4890 Firewall](./references/ipv6-dual-stack.md)
- [Real-Time Incident Alerting, Webhooks & IPFIX Telemetry](./references/monitoring-alerting.md)
- [RouterOS v7 Packet Flow & Conntrack Invariants](./references/packet-flow-v7.md)
- [Enterprise Bridge VLAN Filtering & L3HW Offloading](./references/bridge-vlan-switching.md)
- [RouterOS v7 Enterprise Routing (OSPFv3 & BGP Multi-Homing)](./references/enterprise-routing-ospf-bgp.md)
- [Certified Engineer 5-Layer Troubleshooting Protocol](./references/troubleshooting-protocol.md)
- [RouterOS v7 REST API Architecture & Semantics](./references/rest-api.md)
- [Official Manual Architecture & LLM Retrieval Map](./references/official-manual-map.md)
- [WPA2/WPA3-Enterprise 802.1X & Dynamic VLAN Assignment](./references/radius-8021x.md)
- [Responsive Captive Portal & Walled Garden](./references/hotspot-portal.md)
- [Modern CAKE & FQ-CoDel Anti-Bufferbloat QoS](./references/qos-cake.md)
- [WireGuard Remote-Access & Site-to-Site VPN](./references/wireguard-vpn.md)
- [Docker Microservices & Container Networking](./references/docker-containers.md)

---

## 10. MikroTik Certified Engineering Framework (10-Track Standard)

This automation toolkit and AI agent skill are strictly standardized against the 10 official MikroTik Certified Engineering curricula:

| # | Certification Track | Core Engineering Domain | Standardized Tooling / Runbook |
|---|---|---|---|
| **1** | **MTCNA** (*Network Associate*) | RouterOS basics, safe mode, sanitized backup, DHCP snooping, bridge setup | `mtik status`, `mtik backup --sanitize`, `SafeModeWatchdog`, `mtik template mtcna` |
| **2** | **MTCRE** (*Routing Engineer*) | Policy-Based Routing (PBR), recursive route failover with Virtual SLA, point-to-point addressing | `mikrotik_force_routing`, recursive target-scope, [`enterprise-routing-ospf-bgp.md`](./references/enterprise-routing-ospf-bgp.md), `mtik template mtcre` |
| **3** | **MTCINE** (*Inter-Networking Engineer*) | MPLS LDP, transparent VPLS L2VPN, multi-tenant VRF, BGP v7 Communities & Route Reflectors | [`mtcine-mpls-vpls-vrf.md`](./references/mtcine-mpls-vpls-vrf.md), `mtik template mtcine` |
| **4** | **MTCTCE** (*Traffic Control Engineer*) | Strict Packet Flow v7 pipeline, Conntrack states, 4-tier Mangle ordering, CAKE/FQ-CoDel | `MangleOrderEngine`, [`packet-flow-v7.md`](./references/packet-flow-v7.md), [`qos-cake.md`](./references/qos-cake.md), `mtik template mtctce` |
| **5** | **MTCSWE** (*Switching Engineer*) | LACP 802.3ad bonding, IGMP/MLD multicast snooping, port isolation, L3HW offload, hardware MSTP | [`mtcswe-advanced-switching.md`](./references/mtcswe-advanced-switching.md), [`bridge-vlan-switching.md`](./references/bridge-vlan-switching.md), `mtik template mtcswe` |
| **6** | **MTCSE** (*Security Engineer*) | 7-Pillar Security Audit, MAC-Server isolation, DNS-over-HTTPS (DoH) CA trust, DNS adlist sinkholing | `SecurityAuditor`, `mikrotik_audit_security`, `mikrotik_get_adlist_status`, [`doh-security.md`](./references/doh-security.md), `mtik template mtcse` |
| **7** | **MTCIPv6E** (*IPv6 Engineer*) | DHCPv6-PD prefix delegation, SLAAC neighbor discovery, RFC 4890 compliant ICMPv6 firewall | [`ipv6-dual-stack.md`](./references/ipv6-dual-stack.md), `mtik template mtcipv6e` |
| **8** | **MTCUME** (*User Management Engineer*) | User Manager v7 dynamic VLAN assignment, 802.1X EAP-TLS / PEAP, Hotspot captive portal | [`radius-8021x.md`](./references/radius-8021x.md), [`hotspot-portal.md`](./references/hotspot-portal.md), `mtik template mtcume` |
| **9** | **MTCEWE** (*Enterprise Wireless Engineer*) | Wi-Fi 6 / 802.11ax central CAPsMAN v2 on RouterOS v7 (`/interface wifi`), 802.11r/k/v fast roaming | [`mtcewe-enterprise-wifi.md`](./references/mtcewe-enterprise-wifi.md), `mtik template mtcewe` |
| **10** | **MTCWE** (*Wireless Engineer*) | Standalone Wi-Fi 6 AP, frequency channel planning, bridge wireless, regulatory domain compliance | [`mtcewe-enterprise-wifi.md`](./references/mtcewe-enterprise-wifi.md), `mtik template mtcwe` |
| **NOC** | **Operations & Observability** | Telemetry, Netwatch v7 failover alerts, Telegram webhooks, 5-layer troubleshooting protocol | [`monitoring-alerting.md`](./references/monitoring-alerting.md), [`troubleshooting-protocol.md`](./references/troubleshooting-protocol.md) |

---

## 11. RouterOS v7 REST API Engineering Specification

The RouterOS v7 REST API (introduced in v7.1beta4, with HTTP `www` support added in v7.9) provides a JSON wrapper over the console API, accessible via `https://<router_ip>/rest` (HTTPS 443) or `http://<router_ip>/rest` (HTTP 80).

### 11.1. Authentication & JSON Serialization Invariants
- **Authentication:** Standard HTTP Basic Auth (`Authorization: Basic <base64(user:pass)>`), matching `/user` database credentials.
- **Stringified Values:** All returned property values in JSON replies are strictly string-encoded (`"true"`, `"false"`, `"1200"`, `"10.0.0.1/24"`), regardless of internal type.
- **Accepted Numbers:** Numeric values in payloads accept decimal, octal (starts with `0`), or hexadecimal (starts with `0x`). Exponential notation (e.g. `1e6`) is rejected.

### 11.2. HTTP Verbs & Console Mapping
| Verb | ROS CLI Command | Target Scope | Request Body | Response Payload |
|---|---|---|---|---|
| **GET** | `print` | `/rest/<menu>` or `/rest/<menu>/<id_or_name>` | None | Array of objects or single object |
| **PUT** | `add` | `/rest/<menu>` | Single JSON object | Created object with `.id` |
| **PATCH** | `set` | `/rest/<menu>/<id>` | Partial JSON object | Full updated object |
| **DELETE** | `remove` | `/rest/<menu>/<id>` | None | Empty body (`404` if not found) |
| **POST** | Arbitrary CLI | `/rest/<menu>/<command>` or endpoints | JSON parameters | Result array or status object |

### 11.3. Query Filtering & Projections
- **URL Parameter Filter:** `GET /rest/ip/address?network=10.0.0.0&dynamic=false`
- **Property Projection (`.proplist`):**
  - Via URL: `GET /rest/ip/address?.proplist=address,interface,disabled`
  - Via POST payload: `POST /rest/interface/print` with `{".proplist": ["name", "type", "running"]}`
- **Postfix Query Stack (`.query`):**
  Complex boolean queries are executed via query stacks in POST requests:
  ```json
  POST /rest/interface/print
  {
    ".proplist": [".id", "name", "type"],
    ".query": ["type=ether", "type=vlan", "#|!"]
  }
  ```
  *(Equivalent to CLI: `/interface print where type!=ether && type!=vlan`)*

### 11.4. Timeout Limits & Continuous Commands
- **60-Second Hard Timeout:** Indefinite commands terminate with HTTP 400 `{"detail":"Session closed","error":400,"message":"Bad Request"}`.
- **Mandatory Bounding Parameters:**
  - `/rest/ping`: Must include `{"address": "1.1.1.1", "count": "4"}`
  - `/rest/tool/bandwidth-test`: Must include `{"address": "...", "duration": "3s"}`
  - `/rest/interface/monitor-traffic`: Must include `{"interface": "ether1", "once": ""}`
  - `/rest/interface/lte/monitor` or `wifi/monitor`: Must include `{"numbers": "...", "once": ""}`

### 11.5. Core Management Endpoints
- **Atomic Script Execution:**
  ```http
  POST /rest/execute
  {"script": "/log info \"Audit automated via REST\"; /system ntp client set enabled=yes"}
  ```
- **Configuration Export:**
  ```http
  POST /rest/export
  {"compact": "", "file": "backup-sanitized.rsc"}
  ```
- **Rule Re-indexing (Move):**
  ```http
  POST /rest/ip/firewall/mangle/move
  {".id": "*15", "destination": "*0"}
  ```
- **Inter-Router API Calling (`/tool/fetch`):**
  ```routeros
  /tool fetch http-method=post url="https://192.168.88.2/rest/execute" \
      http-data="{\"script\":\"/log info synced\"}" \
      http-header-field="Content-Type:application/json" \
      user=admin password=secret output=user
  ```

---

## 12. RouterOS v7 Subsystems Architecture & Standards

Directly derived from the official documentation at `manual.mikrotik.com`:

### 12.1. Bridging & L3 Hardware Offloading (`l3hw`)
- **Bridge VLAN Filtering:**
  Always configure VLANs using the unified bridge VLAN table rather than legacy master-port setups:
  ```routeros
  /interface bridge add name=bridge1 vlan-filtering=yes
  /interface bridge vlan add bridge=bridge1 tagged=ether1,ether2 untagged=ether3 vlan-ids=10
  ```
- **L3 Hardware Offloading (ASIC Forwarding):**
  On Marvell Prestera devices (CRS3xx, CCR2004, RB5009), route wire-speed inter-VLAN traffic in switch silicon without loading the main CPU:
  ```routeros
  /interface ethernet switch set 0 l3-hw-offloading=yes
  /ip route add dst-address=0.0.0.0/0 gateway=192.168.1.1
  ```

### 12.2. Device Mode Hardening (`/system/device-mode`)
RouterOS v7 includes a hardware security profile restricting dangerous features (`advanced`, `home`, `basic`, `ros`):
- **Container Pre-requisite:** Running Docker containers requires:
  ```routeros
  /system/device-mode/update container=yes
  ```
  *(Requires physical reset button press or cold power cycle within 5 minutes to confirm).*

### 12.3. Management Access & MAC Server Isolation
- **Service Subnet Restrictions (`/ip service`):**
  Never expose management services to `0.0.0.0/0`:
  ```routeros
  /ip service set winbox address=192.168.88.0/24 disabled=no
  /ip service set ssh address=192.168.88.0/24 disabled=no
  /ip service set www-ssl address=192.168.88.0/24 disabled=no
  /ip service set api address=192.168.88.0/24 disabled=no
  /ip service set telnet disabled=yes
  /ip service set ftp disabled=yes
  /ip service set www disabled=yes
  ```
- **MAC Server Isolation (`/tool mac-server`):**
  Prevent Layer 2 rogue console access by restricting WinBox and MAC-Telnet to internal LAN interfaces:
  ```routeros
  /tool mac-server set allowed-interface-list=LAN
  /tool mac-server mac-winbox set allowed-interface-list=LAN
  /tool mac-server ping set enabled=no
  ```

### 12.4. Native DNS Sinkhole (`/ip dns adlist`)
In RouterOS v7.12+, malware and ad domains are blocked natively without bloated static regex tables:
```routeros
/ip dns adlist add url="https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" ssl-verify=yes
/ip dns set cache-size=8192KiB
```

### 12.5. Reference Retrieval Hierarchy (Local First, Live LLMs as Fallback)

All AI agents must strictly observe the two-tier knowledge hierarchy:

1. **Tier 1 — Embedded Local Skill (Default & Primary Priority):**
   - Always rely first on the substantive guidelines, architecture rules, and operational runbooks already embedded in `SKILL.md` and `references/*.md` (PCC, Cake QoS, 802.1X, WireGuard, Docker Containers, REST API, Hardening, Mangle Order).
   - Never initiate unnecessary web queries or scraping if the task, syntax, or configuration is already solved in the local skill.

2. **Tier 2 — Live Official Manual Fallback (Strictly as Last Resort):**
   - Reserved **ONLY** as a fallback when encountering:
     - Unlisted hardware switch chip capabilities (e.g. newly released CRS/CCR series switch ASIC differences).
     - Emerging RouterOS v7 minor release features/syntax not yet documented in the local skill.
     - Ambiguous kernel property defaults missing from the local references.
   - When fallback is required, use MikroTik's native machine-readable endpoints:
     - **TOC Discovery:** Query `https://manual.mikrotik.com/llms.txt` (or `/llms-full.txt`) to locate exact documentation paths.
     - **Raw Markdown Ingestion:** Append `.md` to documentation paths (e.g. `https://manual.mikrotik.com/docs/developer-guides/rest-api.md`) to ingest unformatted Markdown source directly.
     - **Kernel CLI Reference:** Inspect `https://manual.mikrotik.com/docs/cli-reference/` for machine-extracted parameter types, valid ranges, and factory defaults.
   - Once retrieved, provide the solution to the user and consider proposing an update to the local skill so future invocations stay local.


