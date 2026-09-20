import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RoutingMigrator } from '../src/safety/routing-migrator.js';

describe('RoutingMigrator', () => {
  test('transpiles legacy v6 prefix filter to v7 if-then syntax', () => {
    const v6 = `/routing filter add chain=bgp-in prefix=10.0.0.0/8 prefix-length=16-24 set-bgp-weight=50 action=accept`;
    const res = RoutingMigrator.migrateScript(v6);

    assert.equal(res.totalConverted, 1);
    const r = res.migratedRules[0]!;
    assert.equal(r.chain, 'bgp-in');
    assert.ok(r.v7Command.includes('rule="if (dst in 10.0.0.0/8 && dst-len in 16..24) { set bgp-weight 50; accept; }"'));
  });

  test('converts v6 action=discard to v7 reject;', () => {
    const v6 = `/routing filter add chain=bgp-out prefix=192.168.0.0/16 action=discard`;
    const res = RoutingMigrator.migrateScript(v6);

    assert.equal(res.totalConverted, 1);
    assert.ok(res.script.includes('reject;'));
  });

  test('converts multi-line v6 script with comments', () => {
    const v6 = `
      # Inbound BGP Filter
      /routing filter add chain=bgp-in prefix=172.16.0.0/12 set-distance=20 action=accept
      /routing filter add chain=bgp-in action=discard
    `;
    const res = RoutingMigrator.migrateScript(v6);

    assert.equal(res.totalConverted, 2);
    assert.ok(res.script.includes('/routing filter rule'));
  });
});
