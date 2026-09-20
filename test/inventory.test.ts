import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlInventory, getDeviceConfig, listAllDevices } from '../src/config/profile.js';

describe('Inventory & Multi-Router Management', () => {
  test('parses multi-device YAML inventory correctly', () => {
    const yaml = `
devices:
  - name: core-router
    host: 192.168.1.1
    user: admin
    password: secretpassword
    restPort: 443
    useSsl: true

  - name: edge-switch
    host: 192.168.1.2
    user: netops
    password: switchpassword
    apiPort: 8728
    preferBinary: true
`;

    const inventory = parseYamlInventory(yaml);
    assert.ok(inventory['core-router'], 'core-router should be present in inventory');
    assert.equal(inventory['core-router']?.host, '192.168.1.1');
    assert.equal(inventory['core-router']?.user, 'admin');
    assert.equal(inventory['core-router']?.preferBinary, false);

    assert.ok(inventory['edge-switch'], 'edge-switch should be present in inventory');
    assert.equal(inventory['edge-switch']?.host, '192.168.1.2');
    assert.equal(inventory['edge-switch']?.user, 'netops');
    assert.equal(inventory['edge-switch']?.preferBinary, true);
  });

  test('resolves environment variables in inventory definition', () => {
    process.env.TEST_ROUTER_HOST = '10.0.0.254';
    const yaml = `
devices:
  - name: dynamic-branch
    host: \${TEST_ROUTER_HOST}
    user: branch-admin
    password: pass
`;

    const inventory = parseYamlInventory(yaml);
    assert.ok(inventory['dynamic-branch']);
    assert.equal(inventory['dynamic-branch']?.host, '10.0.0.254');
    delete process.env.TEST_ROUTER_HOST;
  });

  test('listAllDevices returns array with valid structure', () => {
    const devices = listAllDevices();
    assert.ok(Array.isArray(devices));
    assert.ok(devices.length > 0);
    const first = devices[0];
    assert.ok(first.name);
    assert.ok(first.host);
    assert.ok(first.transport);
    assert.ok(['inventory', 'profile', 'env'].includes(first.source));
  });

  test('getDeviceConfig falls back to active default when target not found', () => {
    const fallback = getDeviceConfig('non-existent-device-xyz');
    assert.ok(fallback);
    assert.ok(fallback.host);
    assert.ok(fallback.user);
  });
});
