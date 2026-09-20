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
    preferBinary: true
    tags: [branch, wireguard, dual-wan]
```

### 1.2. Environment Variable Interpolation Rules
- **Syntax:** `${VARIABLE_NAME}` or `${VARIABLE_NAME:-defaultValue}`.
- **Credential Storage:** Real passwords and tokens **must never** be committed to version control. Passwords must be sourced from `.env`, CI/CD secrets (e.g. GitHub Actions Secrets), or vault runners.
- **Fail-Safe Fallback:** If an inventory entry cannot resolve a target device name, the automation engine automatically falls back to active CLI profiles or the default local environment (`ROUTEROS_HOST`).

---

## 2. Dual-Transport Selection Strategy

| Transport Mode | Port | Protocol | Best Use Case | Considerations |
|---|:---:|---|---|---|
| **REST API (`preferBinary: false`)** | 443 (HTTPS) | HTTP/1.1 JSON | Modern RouterOS v7.1+, cloud automation, webhooks | Requires `www-ssl` service enabled with trusted certificate or relaxed TLS validation for self-signed certificates. |
| **Native API (`preferBinary: true`)** | 8728 (Plain) / 8729 (SSL) | Binary ROS Socket | High-throughput bulk telemetry, low-latency loops | Bypasses HTTP parsing overhead. Ideal for resource-constrained devices (e.g. hEX, mAP, cAP lite). |

---

## 3. Fleet Operations Runbooks

### 3.1. Fleet Inventory Enumeration
List all registered devices and verify metadata:
```bash
mtik devices
# or via MCP tool: mikrotik_list_devices
```

### 3.2. Synchronized Configuration Snapshots
Export sanitized configuration across the entire router fleet for disaster recovery:
```bash
# Bash batch backup script
for device in $(mtik devices | awk '{print $2}'); do
  echo "Backing up $device..."
  mtik backup --sanitize -o "./backups/${device}"
done
```

### 3.3. Batch Firmware & Security Audit
Run the 7-Pillar Security Audit sequentially against every fleet member:
```bash
for device in $(mtik devices | awk '{print $2}'); do
  echo "Auditing $device..."
  mtik audit -f markdown -o "./reports/audit-${device}.md"
done
```

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
   - Any remote fleet mutation applied over WAN tunnels or routing links must be guarded by `SafeModeWatchdog` with a 30-second ping heartbeat to prevent unrecoverable link severance.
