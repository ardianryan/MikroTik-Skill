# RouterOS v7 Complete CLI & REST API Master Reference

This master reference provides an encyclopedic mapping between the MikroTik RouterOS v7 Command-Line Interface (CLI) and its corresponding REST API endpoints, covering syntax rules, query mechanics, and the complete subsystem hierarchy.

---

## 1. Universal CLI to REST API Architecture

In RouterOS v7, the CLI menu hierarchy maps 1:1 to REST API endpoints according to deterministic grammatical invariants:

```
CLI:   /<subsystem>/<menu>/<submenu> <command> <key>=<value>
REST:  [HTTP_VERB] https://<router_ip>/rest/<subsystem>/<menu>/<submenu>/<action>
```

### 1.1. HTTP Verb & Console Action Invariant Matrix

| Console CLI Action | HTTP Verb | Target REST URI | Request Body Payload | Response Format |
|---|---|---|---|---|
| `print` | `GET` | `/rest/<menu>` | None | Array of JSON objects |
| `print detail where .id="*1"` | `GET` | `/rest/<menu>/<id_or_name>` | None | Single JSON object |
| `print` with filters | `POST` | `/rest/<menu>/print` | `{ ".proplist": [...], ".query": [...] }` | Filtered array |
| `add <k>=<v>` | `PUT` | `/rest/<menu>` | `{ "key": "value" }` | Created JSON object with `.id` |
| `set <id> <k>=<v>` | `PATCH` | `/rest/<menu>/<id>` | `{ "key": "value" }` | Full updated JSON object |
| `remove <id>` | `DELETE` | `/rest/<menu>/<id>` | None | Empty body (`404` if not found) |
| `enable <id>` | `POST` | `/rest/<menu>/enable` | `{ "numbers": "<id>" }` | Empty body or status |
| `disable <id>` | `POST` | `/rest/<menu>/disable` | `{ "numbers": "<id>" }` | Empty body or status |
| `move <id> destination=<d>` | `POST` | `/rest/<menu>/move` | `{ ".id": "<id>", "destination": "<d>" }` | Status object |
| `reset-counters <id>` | `POST` | `/rest/<menu>/reset-counters` | `{ "numbers": "<id>" }` | Empty body |
| Arbitrary Multi-line Script | `POST` | `/rest/execute` | `{ "script": "<ros_script>" }` | Status / Execution result |
| Configuration Export | `POST` | `/rest/export` | `{ "compact": "", "file": "<name>" }` | Export status |

### 1.2. Querying & Postfix Query Stack (`.query`)
For complex filtering via REST `POST /rest/<menu>/print`:
- **Simple Equality:** `["key=value"]`
- **Inequality / Negation:** `["key=value", "#!"]`
- **Logical AND:** `["key1=val1", "key2=val2", "#&"]`
- **Logical OR:** `["key1=val1", "key2=val2", "#|"]`
- **Example:**
  ```json
  POST /rest/ip/firewall/filter/print
  {
    ".proplist": [".id", "chain", "action", "bytes"],
    ".query": ["chain=input", "action=drop", "#&"]
  }
  ```

---

## 2. RouterOS v7 CLI Scripting & Syntax Invariants

When formulating CLI commands or multi-line scripts for `/rest/execute` or terminal execution:

### 2.1. Variables & Scope
- **Local Variable:** `:local varName "value";`
- **Global Variable:** `:global globalVar 123;`
- **String Concatenation & Interpolation:**
  ```routeros
  :local iface "ether1";
  :log info ("Interface selected: " . $iface);
  ```

### 2.2. Object Lookup & Substitution (`[find ...]`)
- **Find by Property:**
  ```routeros
  /ip firewall filter set [find comment="Drop DNS"] disabled=yes
  ```
- **Find First Matching Entry:**
  ```routeros
  /ip route remove [find gateway="192.168.1.1"]
  ```

### 2.3. Control Flow & Error Trapping
- **Conditionals:**
  ```routeros
  :if ($cpuLoad > 85) do={
      /log warning "CPU Overloaded!";
  } else={
      /log info "CPU Normal";
  }
  ```
- **Try / Catch Trapping:**
  ```routeros
  :do {
      /tool fetch url="https://example.com/api" mode=https;
  } on-error={
      /log error "Failed to fetch remote API";
  }
  ```

---

## 3. Comprehensive Subsystem Catalog (CLI Menus & REST Endpoints)

### 3.1. System & Device Control (`/system`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/system/resource` | `print`, `cpu print` | `GET /rest/system/resource` |
| `/system/routerboard` | `print`, `upgrade` | `GET /rest/system/routerboard`, `POST /rest/system/routerboard/upgrade` |
| `/system/identity` | `get name`, `set name=...` | `GET/PATCH /rest/system/identity` |
| `/system/package` | `print`, `update check`, `update install` | `GET /rest/system/package`, `POST /rest/system/package/update/check` |
| `/system/device-mode` | `print`, `update container=yes` | `GET/POST /rest/system/device-mode` |
| `/system/ntp/client` | `print`, `set enabled=yes servers=...` | `GET/PATCH /rest/system/ntp/client` |
| `/system/ntp/server` | `print`, `set enabled=yes` | `GET/PATCH /rest/system/ntp/server` |
| `/system/scheduler` | `print`, `add name=... interval=... on-event=...` | `GET/PUT/PATCH/DELETE /rest/system/scheduler` |
| `/system/script` | `print`, `add name=... source=...`, `run <name>` | `GET/PUT/PATCH/DELETE /rest/system/script`, `POST /rest/system/script/run` |
| `/system/logging` | `print`, `add topics=... action=...` | `GET/PUT/PATCH/DELETE /rest/system/logging` |
| `/system/user` | `print`, `add name=... group=... password=...` | `GET/PUT/PATCH/DELETE /rest/system/user` |
| `/system/clock` | `print`, `set time-zone-name=...` | `GET/PATCH /rest/system/clock` |
| `/system/backup` | `save name=... password=...`, `load name=...` | `POST /rest/system/backup/save`, `POST /rest/system/backup/load` |
| `/system/reboot` | `reboot` | `POST /rest/system/reboot` |
| `/system/shutdown` | `shutdown` | `POST /rest/system/shutdown` |
| `/log` | `print`, `print where topics~"warning"` | `GET /rest/log` |

---

### 3.2. Interfaces & Layer 2 Subsystems (`/interface`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/interface` | `print`, `set <id> disabled=...` | `GET/PATCH /rest/interface` |
| `/interface/ethernet` | `print`, `set <id> mtu=... speed=...` | `GET/PATCH /rest/interface/ethernet` |
| `/interface/ethernet/monitor` | `monitor ether1 once` | `POST /rest/interface/ethernet/monitor` (`once: ""`) |
| `/interface/ethernet/poe` | `print`, `set <id> poe-out=auto-on` | `GET/PATCH /rest/interface/ethernet/poe` |
| `/interface/ethernet/poe/power-cycle` | `power-cycle <interface>` | `POST /rest/execute` (`script: "/interface ethernet poe power-cycle <iface>"`) |
| `/interface/bridge` | `print`, `add name=... vlan-filtering=yes` | `GET/PUT/PATCH/DELETE /rest/interface/bridge` |
| `/interface/bridge/port` | `add bridge=... interface=... pvid=...` | `GET/PUT/PATCH/DELETE /rest/interface/bridge/port` |
| `/interface/bridge/vlan` | `add bridge=... tagged=... vlan-ids=...` | `GET/PUT/PATCH/DELETE /rest/interface/bridge/vlan` |
| `/interface/bonding` | `add name=... slaves=... mode=802.3ad` | `GET/PUT/PATCH/DELETE /rest/interface/bonding` |
| `/interface/vlan` | `add name=... vlan-id=... interface=...` | `GET/PUT/PATCH/DELETE /rest/interface/vlan` |
| `/interface/wireguard` | `add name=... listen-port=... private-key=...` | `GET/PUT/PATCH/DELETE /rest/interface/wireguard` |
| `/interface/wireguard/peers` | `add interface=... public-key=... allowed-address=...` | `GET/PUT/PATCH/DELETE /rest/interface/wireguard/peers` |
| `/interface/vxlan` | `add name=... vni=... port=...` | `GET/PUT/PATCH/DELETE /rest/interface/vxlan` |
| `/interface/vxlan/vteps` | `add interface=... remote-ip=...` | `GET/PUT/PATCH/DELETE /rest/interface/vxlan/vteps` |
| `/interface/veth` | `add name=... address=... gateway=...` | `GET/PUT/PATCH/DELETE /rest/interface/veth` |
| `/interface/list` | `add name=...` | `GET/PUT/PATCH/DELETE /rest/interface/list` |
| `/interface/list/member` | `add list=... interface=...` | `GET/PUT/PATCH/DELETE /rest/interface/list/member` |
| `/interface/wifi` | `print`, `set <id> configuration=...` | `GET/PATCH /rest/interface/wifi` |
| `/interface/wifi/registration-table` | `print` | `GET /rest/interface/wifi/registration-table` |
| `/interface/wifi/capsman` | `set enabled=yes ...` | `GET/PATCH /rest/interface/wifi/capsman` |
| `/interface/wifi/security` | `add name=... authentication-types=...` | `GET/PUT/PATCH/DELETE /rest/interface/wifi/security` |
| `/interface/wifi/channel` | `add name=... band=... width=...` | `GET/PUT/PATCH/DELETE /rest/interface/wifi/channel` |
| `/interface/wifi/configuration` | `add name=... ssid=... security=...` | `GET/PUT/PATCH/DELETE /rest/interface/wifi/configuration` |
| `/interface/wifi/provisioning` | `add radio-mac=... action=...` | `GET/PUT/PATCH/DELETE /rest/interface/wifi/provisioning` |

---

### 3.3. IPv4 Network Services & Firewall (`/ip`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/ip/address` | `print`, `add address=... interface=...` | `GET/PUT/PATCH/DELETE /rest/ip/address` |
| `/ip/route` | `print`, `add dst-address=... gateway=...` | `GET/PUT/PATCH/DELETE /rest/ip/route` |
| `/ip/pool` | `add name=... ranges=...` | `GET/PUT/PATCH/DELETE /rest/ip/pool` |
| `/ip/dhcp-server` | `add name=... interface=... address-pool=...` | `GET/PUT/PATCH/DELETE /rest/ip/dhcp-server` |
| `/ip/dhcp-server/network` | `add address=... gateway=... dns-server=...` | `GET/PUT/PATCH/DELETE /rest/ip/dhcp-server/network` |
| `/ip/dhcp-server/lease` | `print`, `make-static`, `add address=... mac-address=...` | `GET/PUT/PATCH/DELETE /rest/ip/dhcp-server/lease` |
| `/ip/dhcp-client` | `add interface=... use-peer-dns=yes` | `GET/PUT/PATCH/DELETE /rest/ip/dhcp-client` |
| `/ip/dns` | `set servers=... allow-remote-requests=yes` | `GET/PATCH /rest/ip/dns` |
| `/ip/dns/static` | `add name=... address=... type=A` | `GET/PUT/PATCH/DELETE /rest/ip/dns/static` |
| `/ip/dns/adlist` | `add url=... ssl-verify=yes` | `GET/PUT/PATCH/DELETE /rest/ip/dns/adlist` |
| `/ip/dns/cache` | `print`, `flush` | `GET /rest/ip/dns/cache`, `POST /rest/ip/dns/cache/flush` |
| `/ip/service` | `print`, `set <id> address=... disabled=...` | `GET/PATCH /rest/ip/service` |
| `/ip/arp` | `print`, `add address=... mac-address=... interface=...` | `GET/PUT/PATCH/DELETE /rest/ip/arp` |
| `/ip/neighbor` | `print` | `GET /rest/ip/neighbor` |
| `/ip/cloud` | `set ddns-enabled=yes` | `GET/PATCH /rest/ip/cloud` |
| `/ip/hotspot` | `add name=... interface=...` | `GET/PUT/PATCH/DELETE /rest/ip/hotspot` |
| `/ip/hotspot/user` | `add name=... password=... profile=...` | `GET/PUT/PATCH/DELETE /rest/ip/hotspot/user` |
| `/ip/hotspot/walled-garden` | `add dst-host=... action=allow` | `GET/PUT/PATCH/DELETE /rest/ip/hotspot/walled-garden` |
| `/ip/firewall/filter` | `add chain=... action=... protocol=...` | `GET/PUT/PATCH/DELETE /rest/ip/firewall/filter` |
| `/ip/firewall/nat` | `add chain=srcnat action=masquerade ...` | `GET/PUT/PATCH/DELETE /rest/ip/firewall/nat` |
| `/ip/firewall/mangle` | `add chain=... action=mark-routing ...` | `GET/PUT/PATCH/DELETE /rest/ip/firewall/mangle` |
| `/ip/firewall/raw` | `add chain=prerouting action=drop ...` | `GET/PUT/PATCH/DELETE /rest/ip/firewall/raw` |
| `/ip/firewall/address-list` | `add list=... address=...` | `GET/PUT/PATCH/DELETE /rest/ip/firewall/address-list` |
| `/ip/firewall/connection` | `print`, `remove <id>` | `GET /rest/ip/firewall/connection`, `DELETE /rest/...` |

---

### 3.4. IPv6 Subsystems (`/ipv6`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/ipv6/address` | `add address=... interface=... advertise=yes` | `GET/PUT/PATCH/DELETE /rest/ipv6/address` |
| `/ipv6/route` | `add dst-address=... gateway=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/route` |
| `/ipv6/dhcp-client` | `add interface=... request=prefix pool-name=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/dhcp-client` |
| `/ipv6/dhcp-server` | `add name=... address-pool=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/dhcp-server` |
| `/ipv6/nd` | `add interface=... advertise-dns=yes` | `GET/PUT/PATCH/DELETE /rest/ipv6/nd` |
| `/ipv6/firewall/filter` | `add chain=... action=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/firewall/filter` |
| `/ipv6/firewall/nat` | `add chain=srcnat action=masquerade` | `GET/PUT/PATCH/DELETE /rest/ipv6/firewall/nat` |
| `/ipv6/firewall/mangle` | `add chain=... action=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/firewall/mangle` |
| `/ipv6/firewall/address-list` | `add list=... address=...` | `GET/PUT/PATCH/DELETE /rest/ipv6/firewall/address-list` |

---

### 3.5. Dynamic Routing & Policies (`/routing`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/routing/table` | `add name=... fib` | `GET/PUT/PATCH/DELETE /rest/routing/table` |
| `/routing/rule` | `add src-address=... table=... action=lookup` | `GET/PUT/PATCH/DELETE /rest/routing/rule` |
| `/routing/filter/rule` | `add chain=... rule="if (...) { ... }"` | `GET/PUT/PATCH/DELETE /rest/routing/filter/rule` |
| `/routing/bgp/template` | `add name=... as=... router-id=...` | `GET/PUT/PATCH/DELETE /rest/routing/bgp/template` |
| `/routing/bgp/connection` | `add name=... template=... remote.address=...` | `GET/PUT/PATCH/DELETE /rest/routing/bgp/connection` |
| `/routing/bgp/session` | `print`, `resend <id>` | `GET /rest/routing/bgp/session` |
| `/routing/ospf/instance` | `add name=... router-id=... version=3` | `GET/PUT/PATCH/DELETE /rest/routing/ospf/instance` |
| `/routing/ospf/area` | `add name=... area-id=... instance=...` | `GET/PUT/PATCH/DELETE /rest/routing/ospf/area` |
| `/routing/ospf/interface-template` | `add area=... networks=... type=ptp` | `GET/PUT/PATCH/DELETE /rest/routing/ospf/interface-template` |
| `/routing/bfd/configuration` | `add min-rx=... min-tx=...` | `GET/PUT/PATCH/DELETE /rest/routing/bfd/configuration` |

---

### 3.6. Traffic Control & QoS Queues (`/queue`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/queue/type` | `add name=... kind=cake cake-diffserv=diffserv4` | `GET/PUT/PATCH/DELETE /rest/queue/type` |
| `/queue/tree` | `add name=... parent=... queue=... max-limit=...` | `GET/PUT/PATCH/DELETE /rest/queue/tree` |
| `/queue/simple` | `add name=... target=... max-limit=...` | `GET/PUT/PATCH/DELETE /rest/queue/simple` |

---

### 3.7. Diagnostic & Management Tools (`/tool`)
| CLI Menu | Primary CLI Commands | REST API Endpoint & Bounding Rules |
|---|---|---|
| `/tool/ping` | `ping address=... count=4` | `POST /rest/ping` (Must include `count: "4"`) |
| `/tool/traceroute` | `traceroute address=... count=3` | `POST /rest/tool/traceroute` (`count: "3"`) |
| `/tool/profile` | `profile cpu=all duration=5s` | `POST /rest/tool/profile` (`duration: "5s"`) |
| `/tool/torch` | `torch interface=... duration=5s` | `POST /rest/tool/torch` (`duration: "5s"`) |
| `/tool/sniffer` | `sniffer start`, `sniffer stop` | `POST /rest/tool/sniffer/start`, `POST /rest/.../stop` |
| `/tool/fetch` | `fetch url=... http-method=post ...` | `POST /rest/tool/fetch` |
| `/tool/netwatch` | `add host=... type=icmp interval=5s` | `GET/PUT/PATCH/DELETE /rest/tool/netwatch` |
| `/tool/bandwidth-test` | `bandwidth-test address=... duration=3s` | `POST /rest/tool/bandwidth-test` (`duration: "3s"`) |
| `/tool/mac-server` | `set allowed-interface-list=LAN` | `GET/PATCH /rest/tool/mac-server` |
| `/tool/mac-server/mac-winbox`| `set allowed-interface-list=LAN` | `GET/PATCH /rest/tool/mac-server/mac-winbox` |
| `/tool/e-mail` | `set server=... from=...` | `GET/PATCH /rest/tool/e-mail` |

---

### 3.8. Containerization & Storage (`/container` & `/disk`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/container/config` | `set registry-url=... tmpdir=...` | `GET/PATCH /rest/container/config` |
| `/container` | `print`, `add file=... interface=... root-dir=...` | `GET/PUT/PATCH/DELETE /rest/container` |
| `/container/start` | `start <id>` | `POST /rest/container/start` (`numbers: "<id>"`) |
| `/container/stop` | `stop <id>` | `POST /rest/container/stop` (`numbers: "<id>"`) |
| `/container/mounts` | `add name=... src=... dst=...` | `GET/PUT/PATCH/DELETE /rest/container/mounts` |
| `/container/envs` | `add name=... key=... value=...` | `GET/PUT/PATCH/DELETE /rest/container/envs` |
| `/disk` | `print`, `format-drive <id> file-system=ext4` | `GET /rest/disk`, `POST /rest/disk/format-drive` |

---

### 3.9. AAA, User Manager & Certificates (`/user-manager` & `/certificate`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/user-manager` | `set enabled=yes ...` | `GET/PATCH /rest/user-manager` |
| `/user-manager/router` | `add name=... address=... shared-secret=...` | `GET/PUT/PATCH/DELETE /rest/user-manager/router` |
| `/user-manager/user` | `add name=... password=... group=...` | `GET/PUT/PATCH/DELETE /rest/user-manager/user` |
| `/user-manager/user-group` | `add name=... attributes=...` | `GET/PUT/PATCH/DELETE /rest/user-manager/user-group` |
| `/radius` | `add service=... address=... secret=...` | `GET/PUT/PATCH/DELETE /rest/radius` |
| `/certificate` | `print`, `import file-name=...` | `GET /rest/certificate`, `POST /rest/certificate/import` |
| `/certificate/sign` | `sign <id>` | `POST /rest/certificate/sign` |

---

### 3.10. Service Provider MPLS & Telemetry (`/mpls` & `/ip traffic-flow`)
| CLI Menu | Primary CLI Commands | REST API Endpoint |
|---|---|---|
| `/mpls` | `set dynamic-label-range-start=100` | `GET/PATCH /rest/mpls` |
| `/mpls/ldp` | `add lsr-id=... transport-address=...` | `GET/PUT/PATCH/DELETE /rest/mpls/ldp` |
| `/mpls/ldp/interface` | `add interface=...` | `GET/PUT/PATCH/DELETE /rest/mpls/ldp/interface` |
| `/interface/vpls` | `add name=... remote-peer=... vpls-id=...` | `GET/PUT/PATCH/DELETE /rest/interface/vpls` |
| `/ip/traffic-flow` | `set enabled=yes cache-entries=128k` | `GET/PATCH /rest/ip/traffic-flow` |
| `/ip/traffic-flow/target` | `add dst-address=... port=2055 version=ipfix` | `GET/PUT/PATCH/DELETE /rest/ip/traffic-flow/target` |
| `/snmp` | `set enabled=yes ...` | `GET/PATCH /rest/snmp` |
| `/snmp/community` | `add name=... security=private ...` | `GET/PUT/PATCH/DELETE /rest/snmp/community` |
