export type LintSeverity = 'CRITICAL' | 'HIGH' | 'WARN' | 'INFO';

export interface LintFinding {
  id: string;
  severity: LintSeverity;
  line: number;
  rawLine: string;
  rule: string;
  message: string;
  remediation: string;
}

export interface LintResult {
  passed: boolean;
  findings: LintFinding[];
  summary: {
    critical: number;
    high: number;
    warn: number;
    info: number;
    total: number;
  };
}

export class RouterOsLinter {
  /**
   * Performs static analysis and security linting on RouterOS v7 .rsc configuration scripts.
   * Runs completely offline with zero router credentials.
   */
  public static lint(script: string): LintResult {
    const findings: LintFinding[] = [];
    const lines = script.split(/\r?\n/);

    let allowRemoteDnsSeen = false;
    let allowRemoteDnsLine = -1;
    let dropsWanDns = false;

    const usedRoutingMarks = new Set<{ mark: string; line: number; raw: string }>();
    const definedFibTables = new Set<string>();

    let seenEstablishedFilter = false;
    let seenDropFilterBeforeEst = false;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const raw = lines[i] ?? '';
      const trimmed = raw.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Check 1: Hardcoded Secrets / Credentials
      // Plain text user passwords
      const userPwMatch = trimmed.match(/\/user\s+add\b.*?\bpassword=["']?([^"'\s]+)["']?/i);
      if (userPwMatch && userPwMatch[1] && !userPwMatch[1].startsWith('$') && userPwMatch[1] !== '***') {
        findings.push({
          id: 'LINT-SEC-01',
          severity: 'CRITICAL',
          line: lineNum,
          rawLine: raw,
          rule: 'Hardcoded Plaintext User Password',
          message: 'Hardcoded router administrative password detected in configuration script.',
          remediation: 'Remove the hardcoded password and assign credentials interactively via terminal or secure automation vault.',
        });
      }

      // Plain text WireGuard private key
      const wgPrivMatch = trimmed.match(/private-key=["']?([A-Za-z0-9+/=]{44})["']?/i);
      if (wgPrivMatch && wgPrivMatch[1] !== '********************************************') {
        findings.push({
          id: 'LINT-SEC-02',
          severity: 'CRITICAL',
          line: lineNum,
          rawLine: raw,
          rule: 'Exposed WireGuard Private Key',
          message: 'Raw WireGuard private key exposed in cleartext inside configuration script.',
          remediation: 'Generate WireGuard keys dynamically on the device or pass via secure environment variables.',
        });
      }

      // Plain text pre-shared secrets (IPSec / L2TP / PPP / Wireless)
      const pskMatch = trimmed.match(/\b(secret|pre-shared-key|wpa2-pre-shared-key|passphrase)=["']?([^"'\s]+)["']?/i);
      if (pskMatch && pskMatch[2] && pskMatch[2] !== '***' && !pskMatch[2].startsWith('$') && pskMatch[2].length > 1) {
        findings.push({
          id: 'LINT-SEC-03',
          severity: 'HIGH',
          line: lineNum,
          rawLine: raw,
          rule: 'Plaintext Pre-Shared Secret',
          message: `Plaintext credential found for parameter "${pskMatch[1]}".`,
          remediation: 'Mask or tokenize pre-shared keys prior to storing configuration in version control.',
        });
      }

      // Check 2: DNS Open Resolver
      if (/allow-remote-requests=(yes|true)/i.test(trimmed)) {
        allowRemoteDnsSeen = true;
        allowRemoteDnsLine = lineNum;
      }
      if (/chain=input\b/i.test(trimmed) && /action=drop\b/i.test(trimmed) && /dst-port=53\b/i.test(trimmed)) {
        dropsWanDns = true;
      }

      // Check 3: Deprecated RouterOS v6 Syntax
      if (/^\/routing\s+filter\s+add\b/i.test(trimmed)) {
        findings.push({
          id: 'LINT-SYN-01',
          severity: 'WARN',
          line: lineNum,
          rawLine: raw,
          rule: 'Legacy v6 Routing Filter Syntax',
          message: 'Legacy RouterOS v6 "/routing filter add" command detected. RouterOS v7 requires "/routing filter rule add".',
          remediation: 'Transpile to RouterOS v7 syntax: /routing filter rule add chain=... rule="if (...) { ... }".',
        });
      }

      // Gateway route interface scoping (e.g. gateway=192.168.1.1%ether1)
      if (/\/ip\s+route\s+add\b.*?\bgateway=[^\s]+%/i.test(trimmed)) {
        findings.push({
          id: 'LINT-SYN-02',
          severity: 'WARN',
          line: lineNum,
          rawLine: raw,
          rule: 'Deprecated Gateway Interface Scoping',
          message: 'Route gateway uses deprecated v6 percent-interface scoping syntax.',
          remediation: 'In RouterOS v7, specify target interface explicitly or use routing table binding.',
        });
      }

      // Check 4: FIB Routing Tables
      const tableMatch = trimmed.match(/\/routing\s+table\s+add\b.*?\bname=["']?([^"'\s]+)["']?.*?\bfib\b/i);
      if (tableMatch && tableMatch[1]) {
        definedFibTables.add(tableMatch[1]);
      }

      const markMatch = trimmed.match(/new-routing-mark=["']?([^"'\s]+)["']?/i);
      if (markMatch && markMatch[1] && markMatch[1] !== 'main') {
        usedRoutingMarks.add({ mark: markMatch[1], line: lineNum, raw });
      }

      // Check 5: Firewall Filter Rule Ordering
      if (/\/ip\s+firewall\s+filter\s+add\b/i.test(trimmed)) {
        if (/connection-state=.*established.*action=accept/i.test(trimmed)) {
          seenEstablishedFilter = true;
        } else if (/action=drop/i.test(trimmed) && !seenEstablishedFilter && !seenDropFilterBeforeEst) {
          seenDropFilterBeforeEst = true;
          findings.push({
            id: 'LINT-FW-01',
            severity: 'HIGH',
            line: lineNum,
            rawLine: raw,
            rule: 'Firewall Inverted FastPath / Established Drop Order',
            message: 'Firewall drop rule occurs before accepting established/related connection states. This may sever valid traffic.',
            remediation: 'Ensure "/ip firewall filter add chain=input/forward connection-state=established,related,untracked action=accept" is placed before general drop rules.',
          });
        }
      }

      // Check 6: Insecure Plaintext Services
      if (/\/ip\s+service\s+set\s+(telnet|ftp)\b.*?\bdisabled=no/i.test(trimmed)) {
        findings.push({
          id: 'LINT-SEC-04',
          severity: 'WARN',
          line: lineNum,
          rawLine: raw,
          rule: 'Insecure Plaintext Management Service Enabled',
          message: `Insecure plaintext service enabled (${trimmed.includes('telnet') ? 'Telnet' : 'FTP'}).`,
          remediation: 'Disable unencrypted services in favor of SSH and HTTPS/Winbox with TLS.',
        });
      }

      // Check 7: Mangle mark-routing missing local bypass
      if (/\/ip\s+firewall\s+mangle\s+add\b.*?\baction=mark-routing\b/i.test(trimmed)) {
        if (!/dst-address-type=!local/i.test(trimmed) && !/dst-address-list=!/i.test(trimmed)) {
          findings.push({
            id: 'LINT-RT-01',
            severity: 'WARN',
            line: lineNum,
            rawLine: raw,
            rule: 'Routing Mark Without Local Destination Exclusion',
            message: 'Mangle mark-routing rule does not exclude local router destinations (dst-address-type=!local), which may break router self-traffic.',
            remediation: 'Add "dst-address-type=!local" to the mark-routing mangle rule.',
          });
        }
      }
    }

    // Post-scan checks
    // DNS open resolver check
    if (allowRemoteDnsSeen && !dropsWanDns) {
      findings.push({
        id: 'LINT-DNS-01',
        severity: 'CRITICAL',
        line: allowRemoteDnsLine,
        rawLine: lines[allowRemoteDnsLine - 1] ?? '',
        rule: 'Unprotected DNS Open Resolver',
        message: 'allow-remote-requests=yes is enabled without a firewall filter dropping incoming WAN UDP 53 packets.',
        remediation: 'Add: /ip firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop comment="Drop WAN DNS"',
      });
    }

    // Missing FIB tables check
    for (const item of usedRoutingMarks) {
      if (!definedFibTables.has(item.mark)) {
        findings.push({
          id: 'LINT-RT-02',
          severity: 'HIGH',
          line: item.line,
          rawLine: item.raw,
          rule: 'Missing RouterOS v7 FIB Routing Table',
          message: `Routing mark "${item.mark}" is assigned in mangle, but no corresponding "/routing table add name=${item.mark} fib" was defined. In RouterOS v7, traffic with undefined tables falls back to main.`,
          remediation: `Add: /routing table add name="${item.mark}" fib comment="FIB table for ${item.mark}"`,
        });
      }
    }

    const summary = {
      critical: findings.filter((f) => f.severity === 'CRITICAL').length,
      high: findings.filter((f) => f.severity === 'HIGH').length,
      warn: findings.filter((f) => f.severity === 'WARN').length,
      info: findings.filter((f) => f.severity === 'INFO').length,
      total: findings.length,
    };

    return {
      passed: summary.critical === 0 && summary.high === 0,
      findings,
      summary,
    };
  }
}
