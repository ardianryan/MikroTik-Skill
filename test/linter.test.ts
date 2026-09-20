import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RouterOsLinter } from '../src/safety/linter.js';

describe('RouterOsLinter', () => {
  it('detects cleartext administrative passwords in .rsc script', () => {
    const script = `
/user add name=admin group=full password="SuperSecret123!"
/ip address add address=192.168.88.1/24 interface=bridge
    `;
    const res = RouterOsLinter.lint(script);
    assert.strictEqual(res.passed, false);
    assert.strictEqual(res.summary.critical, 1);
    const finding = res.findings.find((f) => f.id === 'LINT-SEC-01');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'CRITICAL');
  });

  it('detects exposed WireGuard private keys', () => {
    const script = `
/interface wireguard add name=wg-client listen-port=13231 private-key="4O4c3g7zO6Qx3fW4uN0sL9r1v2w3x4y5z6a7b8c9d0E="
    `;
    const res = RouterOsLinter.lint(script);
    assert.strictEqual(res.passed, false);
    const finding = res.findings.find((f) => f.id === 'LINT-SEC-02');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'CRITICAL');
  });

  it('detects DNS open resolver without WAN drop rule', () => {
    const script = `
/ip dns set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8
/ip firewall filter add chain=input connection-state=established,related action=accept
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-DNS-01');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'CRITICAL');
  });

  it('passes DNS check when WAN drop rule is present', () => {
    const script = `
/ip dns set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8
/ip firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-DNS-01');
    assert.strictEqual(finding, undefined);
  });

  it('detects deprecated RouterOS v6 routing filter syntax', () => {
    const script = `
/routing filter add chain=bgp-in prefix=10.0.0.0/8 action=accept
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-SYN-01');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'WARN');
  });

  it('detects missing RouterOS v7 FIB routing table for mangle mark-routing', () => {
    const script = `
/ip firewall mangle add chain=prerouting action=mark-routing new-routing-mark=to_ISP1 passthrough=yes dst-address-type=!local
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-RT-02');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'HIGH');
    assert.strictEqual(res.passed, false);
  });

  it('passes when FIB routing table is properly declared in v7', () => {
    const script = `
/routing table add name=to_ISP1 fib
/ip firewall mangle add chain=prerouting action=mark-routing new-routing-mark=to_ISP1 passthrough=yes dst-address-type=!local
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-RT-02');
    assert.strictEqual(finding, undefined);
  });

  it('detects inverted firewall filter drop before established accept', () => {
    const script = `
/ip firewall filter add chain=input action=drop comment="Drop all input"
/ip firewall filter add chain=input connection-state=established,related action=accept
    `;
    const res = RouterOsLinter.lint(script);
    const finding = res.findings.find((f) => f.id === 'LINT-FW-01');
    assert.ok(finding);
    assert.strictEqual(finding?.severity, 'HIGH');
  });
});
