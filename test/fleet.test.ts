import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptPassword,
  decryptPassword,
  addFleetDevice,
  removeFleetDevice,
  setActiveFleetDevice,
  getActiveFleetDevice,
  getFleetDevice,
  fleetDeviceToRouterConfig,
  getFleetStore,
} from '../src/config/fleet.js';

test('Fleet Store & Multi-Router Management', async (t) => {
  await t.test('encrypts and decrypts passwords reliably using AES-256-GCM', () => {
    const rawSecret = 'P@ssw0rd!SuperSecret#2026';
    const encrypted = encryptPassword(rawSecret);

    assert.notEqual(encrypted, rawSecret);
    assert.match(encrypted, /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

    const decrypted = decryptPassword(encrypted);
    assert.equal(decrypted, rawSecret);
  });

  await t.test('handles empty and plaintext fallback gracefully', () => {
    assert.equal(encryptPassword(''), '');
    assert.equal(decryptPassword(''), '');
    assert.equal(decryptPassword('plain-fallback'), 'plain-fallback');
  });

  await t.test('adds, switches, and removes router devices in fleet store', () => {
    const testDevice = {
      name: 'test-hq-core',
      host: '10.255.0.1',
      port: 443,
      user: 'admin',
      password: 'encrypted-or-plain-pass',
      useTls: true,
      model: 'CCR2004-16G-2S+',
    };

    // Add device
    const newDevice = addFleetDevice(testDevice);
    assert.equal(newDevice.name, 'test-hq-core');

    const storeAfterAdd = getFleetStore();
    assert.ok(storeAfterAdd.devices.some(d => d.name === 'test-hq-core'));

    // Verify lookup
    const found = getFleetDevice('test-hq-core');
    assert.ok(found);
    assert.equal(found.host, '10.255.0.1');

    // Convert to RouterConfig
    const config = fleetDeviceToRouterConfig(found);
    assert.equal(config.host, '10.255.0.1');
    assert.equal(config.user, 'admin');

    // Set active
    const switchSuccess = setActiveFleetDevice('test-hq-core');
    assert.equal(switchSuccess, true);

    const active = getActiveFleetDevice();
    assert.ok(active);
    assert.equal(active.name, 'test-hq-core');

    // Remove device
    const removeSuccess = removeFleetDevice('test-hq-core');
    assert.equal(removeSuccess, true);

    const storeAfterRemove = getFleetStore();
    assert.ok(!storeAfterRemove.devices.some(d => d.name === 'test-hq-core'));
    assert.equal(getFleetDevice('test-hq-core'), null);
  });
});
