# MikroTik RouterOS Official Manual Architecture & AI Retrieval Guide

This guide details the structural taxonomy of the official MikroTik RouterOS documentation (`manual.mikrotik.com`), its machine-readable endpoints for AI agents, and indexing guidelines.

---

## 1. Documentation Platform Architecture

MikroTik has migrated its official documentation from the legacy frozen Confluence wiki (`help.mikrotik.com`) to a modern Docusaurus platform at `manual.mikrotik.com`.

The documentation is organized in a progressive hierarchy from initial onboarding to deep protocol implementations:
1. **Getting Started:** First contact, WinBox/WebFig access, default configurations, licensing, package upgrades, and baseline security.
2. **Topic Sections:** Focused engineering domains (management tools, diagnostics, bridging/switching, routing, firewall/QoS, VPN, user management, containers, IoT, storage).
3. **Developer Guides:** Scripting language, programming interfaces, and REST API specification.
4. **CLI Reference:** Software-extracted command tree detailing console menus, arguments, types, and defaults directly from the RouterOS kernel.

---

## 2. Machine-Readable AI Retrieval Endpoints

MikroTik officially provides native, unauthenticated endpoints tailored for LLMs and AI retrieval pipelines:

| Endpoint | URL | Purpose | Recommended Agent Pattern |
|---|---|---|---|
| **LLM Index (`llms.txt`)** | `https://manual.mikrotik.com/llms.txt` | llmstxt.org-standard index of every published page with summaries | Fetch first to locate exact topic URLs |
| **Full Manual (`llms-full.txt`)** | `https://manual.mikrotik.com/llms-full.txt` | Complete documentation concatenated into a single plain-text file | Bulk ingestion or offline indexing |
| **Direct Markdown (`.md`)** | `https://manual.mikrotik.com/docs/<path>.md` | Raw Markdown source of any documentation article | Fetch targeted `.md` files on demand |
| **Sitemap XML** | `https://manual.mikrotik.com/sitemap.xml` | Standard sitemap for crawlers | URL discovery and freshness checks |

### Retrieval Pattern for AI Agents (Fallback Protocol / Last Resort)
> [!IMPORTANT]
> **Priority Directive:** Always prioritize local skill runbooks and embedded specifications in `SKILL.md`. Fetching from live `manual.mikrotik.com` endpoints is **strictly an option of last resort (opsi terakhir)** when encountering an unlisted hardware ASIC chip capability, emerging RouterOS v7 minor release feature, or property missing from the skill.

When fallback retrieval is required:
1. Fetch `https://manual.mikrotik.com/llms.txt` to identify the precise sub-path.
2. Request the specific page in Markdown by appending `.md` (e.g. `https://manual.mikrotik.com/docs/developer-guides/rest-api.md`).
3. Trust the `.md` documentation source over pre-trained heuristics.
4. Integrate the verified configuration and propose updating the local skill documentation.

---

## 3. Topic Domain & Console Path Taxonomy

| Category | Primary Console Paths | Key Concepts & Directives |
|---|---|---|
| **System Security & Control** | `/system/device-mode`<br>`/ip/service`<br>`/system/resource` | `device-mode` restricts dangerous commands in hardware; management services require restricted `address=` subnets. |
| **Management & REST API** | `/ip/service`<br>`/rest/*` | REST API requires `www-ssl` or `www` service; supports standard CRUD plus `/rest/execute` and `/rest/export`. |
| **Bridging & Switching** | `/interface/bridge`<br>`/interface/bridge/vlan`<br>`/interface/bridge/port` | Bridge VLAN filtering (`vlan-filtering=yes`); L3 Hardware Offloading (`l3hw=yes`) offloads routing to switch chips. |
| **Multi-WAN & Policy Routing** | `/routing/table`<br>`/routing/rule`<br>`/ip/route` | RouterOS v7 requires custom tables registered with `fib=yes`. Recursive routes use `scope=10` and `target-scope=11`. |
| **Firewall & Traffic Shaping** | `/ip/firewall/filter`<br>`/ip/firewall/mangle`<br>`/ip/firewall/nat`<br>`/queue/type` | Mangle hierarchy (Tier 0 Bypass $\rightarrow$ Tier 1 Client $\rightarrow$ Tier 2 PCC); CAKE and FQ-CoDel for bufferbloat elimination. |
| **Virtual Private Networks** | `/interface/wireguard`<br>`/interface/vxlan`<br>`/ip/ipsec` | Native kernel WireGuard tunnels; VXLAN Layer 2 overlays over Layer 3 networks. |
| **AAA & Enterprise Wireless** | `/user`<br>`/user-manager`<br>`/certificate`<br>`/interface/wifi` | Local CA and server cert generation; 802.1X EAP-TLS / PEAP with User Manager dynamic VLAN injection. |
| **Containers & Virtualization** | `/container`<br>`/interface/veth`<br>`/container/mounts` | Docker microservices on ARM/x86; isolated VETH bridges; USB rootfs to protect internal flash NAND. |
| **DNS & Sinkholing** | `/ip/dns`<br>`/ip/dns/adlist`<br>`/ip/dns/static` | Native URL blocklist sinkholing via `adlist`; open resolver protection on WAN interfaces. |

---

## 4. The Self-Generated CLI Reference

Unlike hand-authored articles, the CLI Reference section (`https://manual.mikrotik.com/docs/cli-reference/`) is generated directly from the RouterOS software binaries.

- Menu structure directly mirrors console commands (e.g. `/docs/cli-reference/interface/bridge/port.md` maps to `/interface bridge port`).
- Every property documents:
  - Exact property name
  - Allowed value types (`IP prefix`, `integer`, `string`, `boolean`, `time`)
  - Default factory value
  - Read-only vs read-write flags
