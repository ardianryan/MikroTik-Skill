import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { lintLocalFile, lintReport, exportLocalArtifacts } from '../src/safety/local-artifacts.js';
import { TextForm } from '../src/tui/form.js';
import { WireGuardSchema } from '../src/safety/validation.js';

test('offline file linter rejects oversized, empty, invalid UTF-8, symlink and nonregular inputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtik-artifacts-'));
  try {
    const source = path.join(directory, 'config.rsc');
    fs.writeFileSync(source, 'x'.repeat(128 * 1024 + 1));
    assert.throws(() => lintLocalFile(source), /128 KiB/);
    fs.writeFileSync(source, ''); assert.throws(() => lintLocalFile(source));
    fs.writeFileSync(source, Buffer.from([0xff, 0xff])); assert.throws(() => lintLocalFile(source), /encoded|encoding/i);
    fs.writeFileSync(source, '/user add name=fixture password="quoted secret value"');
    const result = lintLocalFile(source);
    const report = lintReport(result);
    assert.doesNotThrow(() => JSON.parse(report));
    assert.ok(!report.includes('quoted secret value'));
    const link = path.join(directory, 'link.rsc'); fs.symlinkSync(source, link);
    assert.throws(() => lintLocalFile(link));
    const folder = path.join(directory, 'folder.rsc'); fs.mkdirSync(folder);
    assert.throws(() => lintLocalFile(folder), /regular/);
    assert.throws(() => lintLocalFile(path.join(directory, 'config.txt')), /\.rsc/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exports preserve secrets only in private artifacts and reject existing paths and invalid names', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtik-export-'));
  try {
    const target = path.join(directory, 'bundle');
    const content = 'PrivateKey = dummy-provisioning-secret\n';
    exportLocalArtifacts(target, [{ name: 'client.conf', content }]);
    assert.equal(fs.readFileSync(path.join(target, 'client.conf'), 'utf8'), content);
    assert.equal(fs.statSync(target).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(target, 'client.conf')).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(path.join(target, 'SHA256SUMS'), 'utf8'), new RegExp(crypto.createHash('sha256').update(content).digest('hex')));
    assert.throws(() => exportLocalArtifacts(target, [{ name: 'client.conf', content: 'replace' }]));
    const symlink = path.join(directory, 'symlink'); fs.symlinkSync(target, symlink);
    assert.throws(() => exportLocalArtifacts(symlink, [{ name: 'client.conf', content }]));
    for (const name of ['../outside', '/absolute', 'sub/file']) assert.throws(() => exportLocalArtifacts(path.join(directory, 'bad'), [{ name, content }]), /Invalid/);
    assert.throws(() => exportLocalArtifacts(path.join(directory, 'bad'), [{ name: 'same', content }, { name: 'same', content }]), /Invalid/);
    assert.equal(fs.existsSync(path.join(directory, 'bad')), false);
    assert.equal(fs.readFileSync(path.join(target, 'client.conf'), 'utf8'), content);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('text forms accept pasted paths, retain visible focus, support cancellation, and reject controls', () => {
  const form = new TextForm('Local file', [{ key: 'path', label: 'File', value: '' }, { key: 'extra', label: 'Other', value: 'default' }]);
  form.handle({ name: 'paste', sequence: '/tmp/folder with spaces/config.rsc' });
  assert.equal(form.values().path, '/tmp/folder with spaces/config.rsc');
  form.handle({ name: 'paste', sequence: '\x1b[31m' });
  assert.equal(form.values().path, '/tmp/folder with spaces/config.rsc');
  form.handle({ name: 'tab', sequence: '\t' });
  assert.match(form.lines(1).join('\n'), /> Other: default/);
  form.handle({ name: 'u', sequence: '', ctrl: true }); assert.equal(form.values().extra, '');
  form.handle({ name: 'tab', sequence: '', shift: true }); assert.equal(form.index, 0);
  assert.equal(form.handle({ name: 'return', sequence: '\r' }), 'submit');
  assert.equal(form.handle({ name: 'escape', sequence: '' }), 'cancel');
  form.fields[0]!.value = '界'.repeat(200) + 'tail';
  assert.match(form.lines(1, 30).join('\n'), /tail█/);
});

test('export write failures remove only the new incomplete bundle', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtik-export-failure-'));
  const target = path.join(directory, 'new-bundle');
  const original = fs.writeFileSync;
  const write = mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
    if (typeof args[0] === 'number') throw new Error('Fixture disk full');
    return original(...args);
  });
  try {
    assert.throws(() => exportLocalArtifacts(target, [{ name: 'client.conf', content: 'fixture' }]), /disk full/);
    assert.equal(fs.existsSync(target), false);
    assert.ok(fs.existsSync(directory));
  } finally { write.mock.restore(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('WireGuard endpoint ports respect actual UDP port bounds', () => {
  for (const endpoint of ['vpn.example.com:0', 'vpn.example.com:65536', '[2001:db8::1]:99999']) assert.equal(WireGuardSchema.shape.serverEndpoint.safeParse(endpoint).success, false);
  for (const endpoint of ['vpn.example.com:13231', '[2001:db8::1]:65535']) assert.equal(WireGuardSchema.shape.serverEndpoint.safeParse(endpoint).success, true);
});
