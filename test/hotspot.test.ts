import test from 'node:test';
import assert from 'node:assert/strict';
import { HotspotPortalGenerator } from '../src/safety/hotspot-generator.js';

test('HotspotPortalGenerator - generates single voucher portal', () => {
  const bundle = HotspotPortalGenerator.generate({
    venueName: 'Cafe Retro',
    model: 'voucher',
    enableTrial: false,
  });

  assert.ok(bundle.loginHtml.includes('Cafe Retro'));
  assert.ok(bundle.loginHtml.includes('Voucher PIN / Code'));
  assert.ok(bundle.loginHtml.includes('handleVoucherSubmit'));
  assert.ok(bundle.loginHtml.includes('new URLSearchParams')); // QR code auto login
  assert.ok(!bundle.loginHtml.includes('tab-bar')); // No tabs in voucher-only
  assert.ok(bundle.statusHtml.includes('Cafe Retro'));
  assert.ok(bundle.routerOsScript.includes('uprof-voucher'));
});

test('HotspotPortalGenerator - generates all-in-one smart portal with social & trial', () => {
  const bundle = HotspotPortalGenerator.generate({
    venueName: 'Airport Lounge',
    model: 'all-in-one',
    enableTrial: true,
    trialUptime: '45m',
    paymentGateway: 'midtrans',
  });

  assert.ok(bundle.loginHtml.includes('Airport Lounge'));
  assert.ok(bundle.loginHtml.includes('tab-bar'));
  assert.ok(bundle.loginHtml.includes('Voucher Code'));
  assert.ok(bundle.loginHtml.includes('Member Login'));
  assert.ok(bundle.loginHtml.includes('Continue with Google'));
  assert.ok(bundle.loginHtml.includes('Free 30-Minute Trial Access'));

  assert.ok(bundle.routerOsScript.includes('trial-uptime-limit=45m'));
  assert.ok(bundle.routerOsScript.includes('accounts.google.com'));
  assert.ok(bundle.routerOsScript.includes('*.midtrans.com'));
  assert.ok(bundle.routerOsScript.includes('*.qris.id'));
});

test('HotspotPortalGenerator - generates dual member & voucher with custom limits', () => {
  const bundle = HotspotPortalGenerator.generate({
    model: 'dual',
    voucherRateLimit: '15M/10M',
    dnsName: 'hotspot.hotel.com',
  });

  assert.ok(bundle.routerOsScript.includes('rate-limit="15M/10M"'));
  assert.ok(bundle.routerOsScript.includes('dns-name="hotspot.hotel.com"'));
  assert.ok(bundle.statusHtml.includes('$(bytes-out-nice)'));
});
