# Forensic Log Analysis, Threat Triage & Syslog Architecture

This reference provides operational runbooks for log collection, threat detection, and forensic triage across RouterOS v7 systems while protecting internal flash memory.

---

## 1. RouterOS v7 Logging Architecture

RouterOS decouples event producers from destinations using two core menus:
1. **`/system logging action` (Destinations):** Defines *where* logs are delivered (`memory`, `disk`, `echo`, `remote`, `email`).
2. **`/system logging` (Rules):** Defines *what* events trigger logging based on topic classifications.

### 1.1. Protecting Flash Memory (The Disk Wear Hazard)
> [!CAUTION]
> Never log high-frequency events (e.g. `firewall`, `dhcp`, `connection`) to the `disk` action on devices with onboard NAND flash (such as hEX, RB5009, or CRS switches). Doing so can permanently wear out and corrupt the router's internal storage within weeks. Always use `memory` or `remote` syslog destinations.

### 1.2. Recommended Logging Configuration

```routeros
# 1. Expand RAM buffer to 5000 lines for deep terminal triage
/system logging action set memory memory-lines=5000

# 2. Configure RFC 5424 Remote Syslog forwarding (SIEM / Grafana Loki / ELK)
/system logging action add name=siem target=remote remote=192.168.100.50 remote-port=514 src-address=192.168.1.1 syslog-facility=daemon

# 3. Route security and authentication events to SIEM and memory
/system logging add topics=account action=siem
/system logging add topics=firewall action=siem
/system logging add topics=critical action=memory
/system logging add topics=warning action=memory
/system logging add topics=error action=memory
```

---

## 2. Topic Taxonomy & Event Signatures

| Topic Filter | Severity / Scope | Event Signatures & Diagnostics |
|---|---|---|
| **`account`** | Audit / Auth | User logins, failed authentications, privilege escalations, REST API sessions |
| **`firewall`** | Security | Packets hitting firewall rules with `log=yes log-prefix="..."` |
| **`dhcp`** | Addressing | DHCP discovery, lease allocation, duplicate IP detection, rogue server alerts |
| **`wireguard`** | VPN Transport | Handshake negotiation, keepalive timeouts, key mismatches, endpoint updates |
| **`wireless`** | 802.11 Layer 2 | Client associations, 802.11r roaming events, low SNR deauthentication, radar DFS events |
| **`ospf` / `bgp`** | Routing | Neighbor adjacency state changes, routeflap, BGP hold timer expiration |

---

## 3. Incident Triage Runbooks

### 3.1. Brute-Force Authentication Detection
- **Signature:** Repeated `login failure for user <X> from <IP> via <winbox|ssh|api|rest>` within seconds.
- **Triage Command:**
  ```bash
  mtik logs -t account,warning -l 50
  ```
- **Automated Drop Rule (Tar-pit / Blacklist):**
  ```routeros
  /ip firewall filter add chain=input protocol=tcp dst-port=22,8291,443 connection-state=new \
      src-address-list=SSH_BLOCKED action=drop comment="Drop Brute Force Attackers"

  /ip firewall filter add chain=input protocol=tcp dst-port=22,8291,443 connection-state=new \
      src-address-list=SSH_STAGE3 action=add-src-to-address-list address-list=SSH_BLOCKED address-list-timeout=7d comment="Stage 3 -> 7-Day Block"

  /ip firewall filter add chain=input protocol=tcp dst-port=22,8291,443 connection-state=new \
      src-address-list=SSH_STAGE2 action=add-src-to-address-list address-list=SSH_STAGE3 address-list-timeout=1m

  /ip firewall filter add chain=input protocol=tcp dst-port=22,8291,443 connection-state=new \
      action=add-src-to-address-list address-list=SSH_STAGE2 address-list-timeout=1m
  ```

### 3.2. Rogue DHCP Server Detection
- **Signature:** `dhcp,warning: DHCP alert on <bridge>: offered IP <X> from rogue server <MAC>`.
- **Triage Command:**
  ```bash
  mtik logs -t dhcp,warning
  ```
- **Remediation:**
  Enable DHCP snooping on the bridge and declare only the official uplink as trusted:
  ```routeros
  /interface bridge set bridge1 dhcp-snooping=yes
  /interface bridge port set [find interface=ether1] trusted=yes
  ```

### 3.3. WireGuard VPN Handshake Failures
- **Signature:** `wireguard: peer(<pubkey>) handshake timed out` or `wireguard: received packet with invalid source`.
- **Root Cause Matrix:**
  1. *Public Key Mismatch:* Ensure client's `.conf` references router's public key, and router's peer list contains client's public key.
  2. *Firewall UDP 13231 Dropped:* Ensure WAN input rule allows WireGuard listening port.
  3. *Allowed-IPs Collision:* The client VPN IP must match the peer's `allowed-address` on the router.

### 3.4. Wi-Fi Deauthentication Storms & DFS Radar Triage
- **Signature:** `wireless,info: <MAC> disconnected, extensive data loss` or `radar detected on 5500MHz`.
- **Triage Command:**
  ```bash
  mtik logs -t wireless -l 40
  ```
- **Remediation:**
  1. If radar is detected, 5GHz AP moves to an alternative frequency for 30 minutes (CAC timeout). Switch channel to a non-DFS frequency (e.g. 5180MHz / Band 1).
  2. If clients suffer extensive data loss, inspect client SNR via `mtik wifi` or adjust Tx power / basic rates.
