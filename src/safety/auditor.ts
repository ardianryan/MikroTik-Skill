import { ConfigSanitizer } from './sanitizer.js';
import type { ConnectionManager } from '../client/connection-manager.js';
import type { AuditItem, AuditReport, SystemResource, DnsSettings, NtpClient } from '../client/types.js';

export class SecurityAuditor {
  private conn: ConnectionManager;

  constructor(conn: ConnectionManager) {
    this.conn = conn;
  }

  async runFullAudit(): Promise<AuditReport> {
    const items: AuditItem[] = [];
    const failedReads: string[] = [];
    const missing = <T>(name: string, fallback: T) => () => { failedReads.push(name); return fallback; };
    const enabled = (value: boolean | string | undefined) => value === true || value === 'true' || value === 'yes';

    const [resource, dns, services, filters, mangle, tables, ntp, bridges, ipv6Filters, webserver] = await Promise.all([
      this.conn.getResource().catch(missing('resource', ({} as SystemResource))),
      this.conn.getDnsSettings().catch(missing('dns', ({} as DnsSettings))),
      this.conn.getIpServices().catch(missing('services', [])),
      this.conn.getFirewallFilters().catch(missing('filters', [])),
      this.conn.getMangleRules().catch(missing('mangle', [])),
      this.conn.getRoutingTables().catch(missing('tables', [])),
      this.conn.getNtpClient().catch(missing('ntp', ({} as NtpClient))),
      typeof this.conn.getBridges === 'function' ? this.conn.getBridges().catch(missing('bridges', [])) : Promise.resolve([]),
      typeof this.conn.getIpv6Filters === 'function' ? this.conn.getIpv6Filters().catch(missing('ipv6Filters', [])) : Promise.resolve([]),
      typeof this.conn.getWebServerSettings === 'function' ? this.conn.getWebServerSettings().catch(missing('webserver', null)) : Promise.resolve(null),
    ]);

    if (!resource || (!resource.version && !resource.platform && !resource.board)) {
      throw new Error('Router unreachable or returned empty system resources. Verify device connectivity, port, and credentials.');
    }

    // Pillar 1: DNS Open Resolver Check
    const allowRemote = dns['allow-remote-requests'] === true || dns['allow-remote-requests'] === 'true' || dns['allow-remote-requests'] === 'yes';
    if (allowRemote) {
      const dropsWanDns = filters.some(
        (f) =>
          f.chain === 'input' &&
          f.action === 'drop' &&
          (f.protocol === 'udp' || !f.protocol) &&
          f['dst-port'] === '53' &&
          !enabled(f.disabled) && f['in-interface-list'] === 'WAN' && !f['src-address'] && !f['src-address-list'] &&
          !filters.slice(0, filters.findIndex((entry) => entry === f)).some((earlier) => !enabled(earlier.disabled) && earlier.chain === 'input' && ['accept', 'jump', 'return'].includes(earlier.action))
      );

      if (dropsWanDns) {
        items.push({
          pillar: 'Pillar 1: DNS Protection',
          title: 'DNS Open Resolver',
          status: 'PASS',
          detail: 'Remote DNS queries are allowed, but WAN UDP/53 is explicitly blocked in firewall filters.',
        });
      } else {
        items.push({
          pillar: 'Pillar 1: DNS Protection',
          title: 'DNS Open Resolver',
          status: 'CRITICAL',
          detail: 'Router allows remote DNS requests with NO firewall filter blocking WAN UDP/53! Vulnerable to DNS amplification attacks.',
          recommendation: 'Add firewall filter to drop input on UDP port 53 from WAN interfaces.',
          remediationCommand: '/ip firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop comment="Drop WAN DNS"',
        });
      }
    } else {
      items.push({
        pillar: 'Pillar 1: DNS Protection',
        title: 'DNS Open Resolver',
        status: 'PASS',
        detail: 'Remote DNS queries are disabled (/ip dns allow-remote-requests=no).',
      });
    }

    // Pillar 2: Sensitive Services Exposure
    const sensitiveServices = ['winbox', 'api', 'api-ssl', 'ssh', 'www', 'www-ssl'];
    for (const sName of sensitiveServices) {
      const srv = services.find((s) => s.name === sName);
      if (srv && srv.disabled !== true && srv.disabled !== 'true') {
        const hasAddressRestriction = Boolean(srv.address && srv.address.trim() !== '' && srv.address !== '0.0.0.0/0');
        if (hasAddressRestriction) {
          items.push({
            pillar: 'Pillar 2: Service Hardening',
            title: `Service [${sName}] Access`,
            status: 'PASS',
            detail: `Service '${sName}' (port ${srv.port}) is restricted to IP subnet: ${srv.address}`,
          });
        } else {
          items.push({
            pillar: 'Pillar 2: Service Hardening',
            title: `Service [${sName}] Exposure`,
            status: 'WARN',
            detail: `Service '${sName}' (port ${srv.port}) is active with NO address restriction. Anyone who reaches this port can attempt authentication.`,
            recommendation: `Restrict '${sName}' to trusted management subnets using 'address=' parameter.`,
            remediationCommand: `/ip service set ${sName} address=192.168.88.0/24`,
          });
        }
      }
    }

    // RouterOS v7 REST API Transport Hardening
    if (webserver) {
      const isPlainRest = webserver['rest-plain'] === true || webserver['rest-plain'] === 'true' || webserver['rest-plain'] === 'yes';
      const wwwService = services.find((s) => s.name === 'www');
      const wwwActive = wwwService && wwwService.disabled !== true && wwwService.disabled !== 'true';

      if (isPlainRest && wwwActive) {
        items.push({
          pillar: 'Pillar 2: Service Hardening',
          title: 'REST API Cleartext Transport (rest-plain)',
          status: 'WARN',
          detail: 'RouterOS v7 webserver has rest-plain=yes enabled while HTTP WWW service is active. REST API queries and credentials can be intercepted in cleartext.',
          recommendation: 'Disable cleartext REST API via /ip/service/webserver set rest-plain=no to enforce HTTPS for REST operations.',
          remediationCommand: '/ip service webserver set rest-plain=no',
        });
      } else if (!isPlainRest) {
        items.push({
          pillar: 'Pillar 2: Service Hardening',
          title: 'REST API Transport Security',
          status: 'PASS',
          detail: 'RouterOS v7 cleartext REST API is disabled (rest-plain=no). REST queries require TLS encryption.',
        });
      }
    }

    // Pillar 3: Hairpin NAT & Mangle Prerouting
    const dstnatMangleIndex = mangle.findIndex((m) => m['connection-nat-state'] === 'dstnat' && m.action === 'accept');
    if (dstnatMangleIndex === 0) {
      items.push({
        pillar: 'Pillar 3: Mangle Hierarchy',
        title: 'Hairpin NAT Mangle Bypass',
        status: 'PASS',
        detail: 'Mangle rule for DST-NAT bypass is correctly placed at index 0 in prerouting chain.',
      });
    } else if (dstnatMangleIndex > 0) {
      items.push({
        pillar: 'Pillar 3: Mangle Hierarchy',
        title: 'Hairpin NAT Mangle Position',
        status: 'WARN',
        detail: `DST-NAT bypass mangle rule is at index ${dstnatMangleIndex} instead of 0. Forwarded port traffic might be misrouted by earlier rules.`,
        recommendation: 'Move DST-NAT accept mangle rule to index 0.',
        remediationCommand: `/ip firewall mangle move ${dstnatMangleIndex} destination=0`,
      });
    } else {
      items.push({
        pillar: 'Pillar 3: Mangle Hierarchy',
        title: 'Hairpin NAT Mangle Bypass',
        status: 'INFO',
        detail: 'No DST-NAT bypass rule found in Mangle prerouting. If port forwarding with Hairpin NAT is used, add bypass rule.',
        recommendation: 'Add connection-nat-state=dstnat action=accept rule at top of prerouting.',
        remediationCommand: '/ip firewall mangle add chain=prerouting connection-nat-state=dstnat action=accept place-before=0 comment="Hairpin NAT Bypass"',
      });
    }

    // Pillar 4: Routing Table FIB Integrity
    const routingMarksUsed = new Set<string>();
    for (const m of mangle) {
      if (m['new-routing-mark']) {
        routingMarksUsed.add(m['new-routing-mark']);
      }
    }

    for (const mark of routingMarksUsed) {
      const table = tables.find((t) => t.name === mark);
      if (!table) {
        items.push({
          pillar: 'Pillar 4: Routing FIB Integrity',
          title: `Routing Mark '${mark}' Registration`,
          status: 'CRITICAL',
          detail: `Routing mark '${mark}' is used in Mangle, but is NOT defined in '/routing table'! Packets will use the main table instead.`,
          recommendation: `Register table '${mark}' with fib=yes in RouterOS v7.`,
          remediationCommand: `/routing table add name="${mark}" fib`,
        });
      } else {
        const isFib = table.fib === true || table.fib === 'true' || table.fib === 'yes';
        if (!isFib) {
          items.push({
            pillar: 'Pillar 4: Routing FIB Integrity',
            title: `Routing Table '${mark}' FIB Status`,
            status: 'CRITICAL',
            detail: `Table '${mark}' exists, but has 'fib=no'. RouterOS v7 cannot forward packets through this table.`,
            recommendation: `Enable FIB on table '${mark}'.`,
            remediationCommand: `/routing table set [find name="${mark}"] fib`,
          });
        } else {
          items.push({
            pillar: 'Pillar 4: Routing FIB Integrity',
            title: `Routing Table '${mark}' FIB`,
            status: 'PASS',
            detail: `Table '${mark}' is properly registered with FIB enabled in RouterOS v7.`,
          });
        }
      }
    }

    // Pillar 5: NTP Synchronization
    const ntpEnabled = ntp.enabled === true || ntp.enabled === 'true' || ntp.enabled === 'yes';
    if (ntpEnabled) {
      items.push({
        pillar: 'Pillar 5: Time Synchronization',
        title: 'NTP Client Status',
        status: 'PASS',
        detail: `NTP client is enabled with servers configured: ${ntp.servers || ntp['primary-ntp'] || 'dynamic'}`,
      });
    } else {
      items.push({
        pillar: 'Pillar 5: Time Synchronization',
        title: 'NTP Client Status',
        status: 'WARN',
        detail: 'NTP client is disabled. Router clock drift may cause TLS handshake errors, invalid certificate checks, and incorrect logs.',
        recommendation: 'Enable NTP client with standard pool servers.',
        remediationCommand: '/system ntp client set enabled=yes servers=0.pool.ntp.org,1.pool.ntp.org',
      });
    }

    // Pillar 6: Firewall Filter Input Protection
    const dropsInvalidInput = filters.some(
      (f) => !enabled(f.disabled) && f.chain === 'input' && f.action === 'drop' && f['connection-state']?.split(',').includes('invalid')
    );
    if (dropsInvalidInput) {
      items.push({
        pillar: 'Pillar 6: Firewall Integrity',
        title: 'Drop Invalid Connections',
        status: 'PASS',
        detail: 'Firewall filter input chain drops invalid connection states.',
      });
    } else {
      items.push({
        pillar: 'Pillar 6: Firewall Integrity',
        title: 'Drop Invalid Connections',
        status: 'WARN',
        detail: 'No rule found dropping invalid connection state in input chain.',
        recommendation: 'Add drop rule for invalid connections at top of input chain.',
        remediationCommand: '/ip firewall filter add chain=input connection-state=invalid action=drop comment="Drop Invalid Input"',
      });
    }

    // Pillar 7: Resource & Health Metrics
    const cpuLoad = typeof resource['cpu-load'] === 'string' ? parseInt(resource['cpu-load'], 10) : Number(resource['cpu-load'] || 0);
    if (cpuLoad > 85) {
      items.push({
        pillar: 'Pillar 7: System Health',
        title: 'CPU Utilization',
        status: 'WARN',
        detail: `CPU utilization is elevated at ${cpuLoad}%.`,
      });
    } else {
      items.push({
        pillar: 'Pillar 7: System Health',
        title: 'CPU Utilization',
        status: 'PASS',
        detail: `CPU utilization is normal at ${cpuLoad}%.`,
      });
    }

    // Pillar 8: IPv6 Firewall Protection (MTCIPv6E)
    if (ipv6Filters.length === 0) {
      items.push({
        pillar: 'Pillar 8: IPv6 Security',
        title: 'IPv6 Firewall Filter Absence',
        status: 'WARN',
        detail: 'No IPv6 firewall filter rules found (/ipv6/firewall/filter is empty). If IPv6 is active, router and local clients are exposed directly to the Internet.',
        recommendation: 'Deploy RFC 4890 compliant IPv6 firewall filter dropping unsolicited inbound traffic from WAN.',
        remediationCommand: '/ipv6 firewall filter add chain=input connection-state=established,related action=accept; /ipv6 firewall filter add chain=input in-interface-list=!LAN action=drop comment="Drop WAN IPv6 Input"',
      });
    } else {
      const hasIpv6Drop = ipv6Filters.some((f) => !enabled(f.disabled) && f.action === 'drop' && (f.chain === 'input' || f.chain === 'forward'));
      if (hasIpv6Drop) {
        items.push({
          pillar: 'Pillar 8: IPv6 Security',
          title: 'IPv6 Firewall Protection',
          status: 'PASS',
          detail: 'IPv6 firewall filter rules are configured with active drop policies.',
        });
      } else {
        items.push({
          pillar: 'Pillar 8: IPv6 Security',
          title: 'IPv6 Firewall Drop Policy',
          status: 'WARN',
          detail: 'IPv6 firewall filter rules exist, but no explicit drop rules were found for input or forward chains.',
          recommendation: 'Add drop rules for non-LAN input and unsolicited WAN forward.',
          remediationCommand: '/ipv6 firewall filter add chain=forward in-interface-list=WAN action=drop comment="Drop unsolicited WAN IPv6"',
        });
      }
    }

    // Pillar 9: Layer 2 Loop Protection (MTCSWE)
    if (bridges.length > 0) {
      const unprotBridges = bridges.filter((b) => b['protocol-mode'] === 'none');
      if (unprotBridges.length > 0) {
        const names = unprotBridges.map((b) => b.name).join(', ');
        items.push({
          pillar: 'Pillar 9: Layer 2 Loop Protection',
          title: 'Bridge Spanning Tree Protocol (STP/RSTP)',
          status: 'CRITICAL',
          detail: `Bridge(s) [${names}] have 'protocol-mode=none'. Spanning Tree is disabled, leaving the network vulnerable to catastrophic broadcast loops.`,
          recommendation: 'Enable RSTP on all bridges.',
          remediationCommand: '/interface bridge set [find protocol-mode=none] protocol-mode=rstp',
        });
      } else {
        items.push({
          pillar: 'Pillar 9: Layer 2 Loop Protection',
          title: 'Bridge Spanning Tree Protocol',
          status: 'PASS',
          detail: 'All configured bridges have active Spanning Tree Protocol (RSTP/MSTP) enabled.',
        });
      }

      // Dynamic ARP Inspection (DAI) & DHCP Snooping Validation (RouterOS v7.25+ MTCSWE)
      for (const b of bridges) {
        const dhcpSnooping = b['dhcp-snooping'] === true || b['dhcp-snooping'] === 'true' || b['dhcp-snooping'] === 'yes';
        const arpInspection = b['arp-inspection'] === true || b['arp-inspection'] === 'true' || b['arp-inspection'] === 'yes';

        if (dhcpSnooping) {
          if (!arpInspection) {
            items.push({
              pillar: 'Pillar 9: Layer 2 Loop Protection',
              title: `Bridge [${b.name}] Dynamic ARP Inspection (DAI)`,
              status: 'WARN',
              detail: `Bridge '${b.name}' has DHCP snooping enabled, but Dynamic ARP Inspection (arp-inspection) is disabled. Hosts remain vulnerable to ARP spoofing/poisoning.`,
              recommendation: 'Enable Dynamic ARP Inspection (DAI) on the snooped bridge.',
              remediationCommand: `/interface bridge set [find name="${b.name}"] arp-inspection=yes`,
            });
          } else {
            items.push({
              pillar: 'Pillar 9: Layer 2 Loop Protection',
              title: `Bridge [${b.name}] Dynamic ARP Inspection (DAI)`,
              status: 'PASS',
              detail: `Bridge '${b.name}' has Dynamic ARP Inspection (DAI) active with DHCP snooping.`,
            });
          }
        }
      }
    } else {
      items.push({
        pillar: 'Pillar 9: Layer 2 Loop Protection',
        title: 'Bridge Spanning Tree Protocol',
        status: 'INFO',
        detail: 'No software bridges configured on this router.',
      });
    }

    // Pillar 10: Conntrack Transit Integrity (MTCTCE)
    const dropsInvalidForward = filters.some(
      (f) => !enabled(f.disabled) && f.chain === 'forward' && f.action === 'drop' && f['connection-state']?.split(',').includes('invalid')
    );
    if (dropsInvalidForward) {
      items.push({
        pillar: 'Pillar 10: Conntrack Transit Integrity',
        title: 'Drop Invalid Forward Packets',
        status: 'PASS',
        detail: 'Firewall filter forward chain drops invalid connection states.',
      });
    } else {
      items.push({
        pillar: 'Pillar 10: Conntrack Transit Integrity',
        title: 'Drop Invalid Forward Packets',
        status: 'WARN',
        detail: 'No rule found dropping invalid connection states in forward chain. Malformed or out-of-order packets can traverse the router.',
        recommendation: 'Add drop rule for invalid connections in forward chain.',
        remediationCommand: '/ip firewall filter add chain=forward connection-state=invalid action=drop comment="Drop Invalid Forward"',
      });
    }

    const dependencies: Record<string, string[]> = {
      'Pillar 1': ['dns', 'filters'], 'Pillar 2': ['services'], 'Pillar 3': ['mangle'],
      'Pillar 4': ['tables', 'mangle'], 'Pillar 5': ['ntp'], 'Pillar 6': ['filters'],
      'Pillar 8': ['ipv6Filters'], 'Pillar 9': ['bridges'], 'Pillar 10': ['filters'],
    };
    for (const item of items) {
      const names = dependencies[item.pillar.split(':')[0] || ''] || [];
      if (names.some((name) => failedReads.includes(name))) {
        item.status = 'UNKNOWN';
        item.detail = 'Required configuration could not be read; this check is incomplete.';
        delete item.remediationCommand;
        delete item.recommendation;
      }
    }
    for (const item of items) {
      if (item.status !== 'PASS') continue;
      if (item.title === 'IPv6 Firewall Protection') {
        const guarded = ['input', 'forward'].every((chain) => ipv6Filters.some((rule) => !enabled(rule.disabled) && rule.chain === chain && rule.action === 'drop' && ['WAN', '!LAN'].includes(rule['in-interface-list'] || '') && !rule.protocol && !rule['dst-port'] && !rule['connection-state']));
        if (!guarded) { item.status = 'UNKNOWN'; item.detail = 'Existing IPv6 drops do not establish complete input and forward protection.'; }
      }
      if (['Drop Invalid Connections', 'Drop Invalid Forward Packets'].includes(item.title)) {
        const chain = item.title === 'Drop Invalid Connections' ? 'input' : 'forward';
        const index = filters.findIndex((rule) => !enabled(rule.disabled) && rule.chain === chain && rule.action === 'drop' && rule['connection-state']?.split(',').includes('invalid'));
        const rule = filters[index];
        if (!rule || rule['in-interface'] || rule['in-interface-list'] || rule.protocol || rule['dst-port'] || rule['src-address'] || rule['dst-address'] || filters.slice(0, index).some((earlier) => !enabled(earlier.disabled) && earlier.chain === chain && ['accept', 'jump', 'return'].includes(earlier.action) && (!earlier['connection-state'] || earlier['connection-state'].includes('invalid')))) {
          item.status = 'UNKNOWN'; item.detail = 'Rule scope and ordering do not establish complete invalid-packet protection.';
        }
      }
    }
    for (const name of failedReads) items.push({ pillar: 'Data collection', title: `Read unavailable: ${name}`, status: 'UNKNOWN', detail: 'The audit could not inspect this subsystem.' });
    const hasCritical = items.some((i) => i.status === 'CRITICAL');
    const hasWarn = items.some((i) => i.status === 'WARN');
    const incomplete = failedReads.some((name) => name !== 'webserver') || items.some((item) => item.status === 'UNKNOWN' && item.pillar !== 'Data collection');
    const overallScore = hasCritical ? 'VULNERABLE' : incomplete ? 'INCOMPLETE' : hasWarn ? 'NEEDS_ATTENTION' : 'SECURE';

    // Assign stable numbered finding IDs (F-01, F-02, ...)
    items.forEach((item, index) => {
      item.id = `F-${String(index + 1).padStart(2, '0')}`;
    });

    return ConfigSanitizer.sanitizeJson({
      completeness: { complete: !incomplete, failedReads },
      timestamp: new Date().toISOString(),
      routerIdentity: resource.board || resource.platform || 'MikroTik RouterOS',
      firmwareVersion: resource.version || 'v7.x',
      overallScore,
      items,
    });
  }

  static formatMarkdownReport(report: AuditReport): string {
    const lines: string[] = [];
    lines.push(`# RouterOS v7 Security & Configuration Audit Report`);
    lines.push(`\n**Target Device:** \`${report.routerIdentity}\` | **Firmware:** \`${report.firmwareVersion}\` | **Timestamp:** \`${report.timestamp}\``);
    lines.push(`**Overall Assessment:** **${report.overallScore}**\n`);

    const criticalCount = report.items.filter((i) => i.status === 'CRITICAL').length;
    const warnCount = report.items.filter((i) => i.status === 'WARN').length;
    const passCount = report.items.filter((i) => i.status === 'PASS').length;
    const infoCount = report.items.filter((i) => i.status === 'INFO').length;
    const unknownCount = report.items.filter((i) => i.status === 'UNKNOWN').length;

    lines.push(`| Severity | Count | Status Summary |`);
    lines.push(`|---|:---:|---|`);
    lines.push(`| 🔴 CRITICAL | ${criticalCount} | Immediate security risk or packet misrouting |`);
    lines.push(`| 🟡 WARN | ${warnCount} | Unhardened service or suboptimal configuration |`);
    lines.push(`| 🟢 PASS | ${passCount} | Compliant with RouterOS v7 security standard |`);
    lines.push(`| 🔵 INFO | ${infoCount} | Informational advisory |`);
    lines.push(`| UNKNOWN | ${unknownCount} | Configuration could not be verified |`);
    lines.push(`\n---`);

    lines.push(`\n## Detailed Numbered Findings\n`);
    lines.push(`| ID | Pillar | Severity | Title | Finding & Recommendation |`);
    lines.push(`|---|---|:---:|---|---|`);

    for (const item of report.items) {
      const badge = item.status === 'CRITICAL' ? '🔴 CRITICAL' : item.status === 'WARN' ? '🟡 WARN' : item.status === 'PASS' ? '🟢 PASS' : item.status === 'UNKNOWN' ? 'UNKNOWN' : '🔵 INFO';
      const rec = item.recommendation ? `<br>👉 *Rec: ${item.recommendation}*` : '';
      lines.push(`| **${item.id || '-'}** | ${item.pillar} | ${badge} | **${item.title}** | ${item.detail}${rec} |`);
    }

    const remediations = report.items.filter((i) => i.remediationCommand && (i.status === 'CRITICAL' || i.status === 'WARN'));
    if (remediations.length > 0) {
      lines.push(`\n---`);
      lines.push(`\n## Proposed Remediation Runbook\n`);
      lines.push(`> [!IMPORTANT]\n> Review proposed commands before applying. In interactive mode, select specific finding IDs to generate a targeted dry-run.\n`);
      lines.push('```routeros');
      for (const r of remediations) {
        lines.push(`# [${r.id}] ${r.title} (${r.status})`);
        lines.push(`${r.remediationCommand}`);
      }
      lines.push('```');
    }

    return ConfigSanitizer.sanitizeText(lines.join('\n'));
  }
}

