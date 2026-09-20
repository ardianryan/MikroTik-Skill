import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WireGuardProvisioner } from '../src/safety/wireguard.js';

describe('WireGuardProvisioner', () => {
  test('generates valid x25519 Curve25519 keypairs in 44-char base64 format', () => {
    const keys = WireGuardProvisioner.generateKeypair();
    assert.ok(keys.privateKey);
    assert.ok(keys.publicKey);
    assert.equal(keys.privateKey.length, 44);
    assert.equal(keys.publicKey.length, 44);
    assert.notEqual(keys.privateKey, keys.publicKey);
  });

  test('provisions complete client config, router command, and QR code', async () => {
    const res = await WireGuardProvisioner.provisionClient({
      clientName: 'user-iphone',
      clientIp: '10.10.0.5',
      serverEndpoint: 'vpn.example.com:13231',
      serverPublicKey: 'rZ8UirUGdXxoH9rtoaDhD8iIqe8v52t+pO/JPcVnpRM=',
    });

    assert.equal(res.clientName, 'user-iphone');
    assert.ok(res.routerPeerCommand.includes('/interface wireguard peers add'));
    assert.ok(res.routerPeerCommand.includes('comment="user-iphone"'));
    assert.ok(res.routerPeerCommand.includes('allowed-address=10.10.0.5/32'));

    assert.ok(res.clientConfig.includes('[Interface]'));
    assert.ok(res.clientConfig.includes('[Peer]'));
    assert.ok(res.clientConfig.includes('Address = 10.10.0.5/32'));
    assert.ok(res.clientConfig.includes('Endpoint = vpn.example.com:13231'));

    assert.ok(res.qrTerminal.length > 50, 'Terminal QR must contain ASCII rendering');
    assert.ok(res.qrDataUrl.startsWith('data:image/png;base64,'), 'Data URL must be valid PNG base64');
  });
});
