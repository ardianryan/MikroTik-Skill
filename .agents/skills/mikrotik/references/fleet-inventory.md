# Multi-Router Fleet Inventory & Infrastructure Automation

This reference provides architectural standards, data models, and runbooks for orchestrating fleets of MikroTik RouterOS v7 devices across enterprise campuses, multi-site branches, and WISP topologies.

---

## 1. Fleet Architecture & The Zero-Trust Inventory Model

Managing multiple routers manually causes configuration drift, security lapses, and credential sprawl. The `inventory.yml` declarative model allows centralized management of core routers, aggregation switches, and edge branch gateways with strict credential isolation.

### 1.1. Declarative Inventory Specification (`inventory.yml`)

The inventory file resides in the root of the workspace or operations repository:

```yaml
# MikroTik RouterOS v7 Fleet Inventory
devices:
  # Core Aggregation Router (CCR2004 / CCR2116)
  - name: core-router-01
    host: 10.0.0.1
    user: ${CORE_ROUTER_USER:-admin}
    password: ${CORE_ROUTER_PASS}
    restPort: 443
    useSsl: true
    preferBinary: false
    tags: [core, datacenter, bgp]

  # Distribution Switch (CRS328 / CRS354)
  - name: switch-dist-01
    host: 10.0.0.2
    user: ${SWITCH_USER:-netops}
    password: ${SWITCH_PASS}
    restPort: 443
    useSsl: true
    preferBinary: false
    tags: [switching, vlan, poe]

  # Branch Gateway (RB5009 / hEX)
  - name: branch-west-gw
    host: 192.168.10.1
    user: ${BRANCH_USER:-branchops}
    password: ${BRANCH_PASS}
    apiPort: 8728
    useSsl: true
    preferBinary: true
    tags: [branch, wireguard, dual-wan]
```

### 1.2. Environment Variable Interpolation Rules
- **Syntax:** `${VARIABLE_NAME}` or `${VARIABLE_NAME:-defaultValue}`.
- **Credential Storage:** Real passwords and tokens **must never** be committed to version control. Passwords must be sourced from `.env`, CI/CD secrets (e.g. GitHub Actions Secrets), or vault runners.
- **Explicit targets:** Resolve the requested name in inventory, profiles, then fleet. An unknown name is an error; never silently connect to another router.
- **Default target:** Without an explicit name, use the stored active fleet device, then active profile, then environment. Public HTTP/SSE cannot enumerate or connect to any of these targets.

---

## 2. Dual-Transport Selection Strategy

| Transport Mode | Port | Protocol | Best Use Case | Considerations |
|---|:---:|---|---|---|
| **REST API (`preferBinary: false`)** | 443 (HTTPS) | HTTP/1.1 JSON | Modern RouterOS v7.1+, cloud automation, webhooks | Requires `www-ssl` service enabled with trusted certificate. Use `ROUTEROS_CA_FILE` for private trust; validation is mandatory. |
| **Native API (`preferBinary: true`)** | 8728 (Plain) / 8729 (SSL) | Binary ROS Socket | High-throughput bulk telemetry, low-latency loops | Bypasses HTTP parsing overhead. Ideal for resource-constrained devices (e.g. hEX, mAP, cAP lite). |

---

## 3. Fleet Operations Runbooks

### 3.1. Fleet Inventory Enumeration
List all registered devices and verify metadata:
```bash
mtik devices
# or via MCP tool: mikrotik_list_devices
```

### 3.2. Configuration Snapshots and Audits

Select and verify one stored fleet target before commands that use the default target. Audit and backup CLI commands do not provide a `--device` option; do not automate them by parsing a human-readable devices table.

```bash
mtik fleet list
mtik fleet switch branch-west-gw
mtik test
mtik backup --sanitize -o ./backups/branch-west-gw
mtik audit --format markdown --output ./audit-branch-west-gw.md
```

The name passed to `fleet switch` must already exist in the fleet store; inventory/profile entries are separate sources. For explicit per-device diagnostics, use supported flags such as `mtik logs --device branch-west-gw` or local MCP `targetDevice` arguments. Never assume every CLI command accepts `--device`.

Backups and audits contain operational context even after secret masking. Review exports before sharing. Audits report UNKNOWN/INCOMPLETE for unverified data and do not establish absence of firmware CVEs.

---

## 4. Multi-Router Fleet Topology Guidelines

1. **Management VRF / Out-of-Band (OOB):**
   - Place REST API and WinBox services in a dedicated management VRF (`MGMT`) isolated from customer routing tables:
   ```routeros
   /ip vrf add name=MGMT interfaces=ether8
   /ip route add dst-address=0.0.0.0/0 gateway=172.16.100.1 routing-table=MGMT
   ```
2. **Standardized Admin User Role:**
   - Use a dedicated group with minimal required permissions rather than sharing the root `full` group across non-admin automations:
   ```routeros
   /user group add name=automation policy=api,rest-ssl,read,write,!policy,!password
   /user add name=netops-bot group=automation password="${BOT_PASS}"
   ```
3. **Automated Rollback Safeguard:**
   - Toolkit router writes are local and require selected audit findings or a manual reason, reviewed preview/recovery, and interactive approval. Arm/read back the 30-second watchdog before applying. Recheck target/configuration, verify health afterward, and report recovery as uncertain until verified; do not promise prevention of every lockout.
