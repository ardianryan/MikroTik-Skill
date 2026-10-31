import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { RouterOSAPI } from 'node-routeros';
import { RouterOsBinaryClient } from '../src/client/binary-client.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MikroTikHttpServer } from '../src/server/http.js';
import { createRemoteMcpServer } from '../src/server/mcp.js';
import { createLocalMcpServer } from '../src/mcp/index.js';
import { ConnectionManager } from '../src/client/connection-manager.js';
import { RouterOsRestClient } from '../src/client/rest-client.js';
import { loadRouterConfig } from '../src/config/profile.js';
import { ConfigSanitizer } from '../src/safety/sanitizer.js';
import { PccCalculator } from '../src/safety/pcc-calculator.js';
import { HotspotPortalGenerator } from '../src/safety/hotspot-generator.js';
import { SecurityAuditor } from '../src/safety/auditor.js';
import { schedulerStart } from '../src/safety/watchdog.js';
import { guardMutation } from '../src/safety/mutation.js';
import { MAX_BODY_BYTES, parseLocalArgs, quoteRouterOs } from '../src/safety/validation.js';
import type { MutationOptions } from '../src/safety/mutation.js';

const fixtureConfig = () => loadRouterConfig({ host: '127.0.0.1', restPort: 9, apiPort: 9, apiSslPort: 9, user: 'fixture', password: 'fixture', useSsl: false });

function fixtureConnection(options: MutationOptions = {}) {
  const conn = new ConnectionManager(fixtureConfig(), options);
  const schedulers: Array<{ name: string; 'on-event': string }> = [];
  let mutations = 0;
  let snapshot = 'configuration-before';
  conn.getResource = async () => ({ version: '7.25', board: 'fixture' });
  conn.getDnsSettings = async () => ({ 'allow-remote-requests': false });
  conn.getIpServices = async () => [];
  conn.getFirewallFilters = async () => [];
  conn.getMangleRules = async () => [];
  conn.getRoutingTables = async () => [{ name: 'to_ISP1', fib: true }];
  conn.getNtpClient = async () => ({ enabled: true });
  conn.getBridges = async () => [];
  conn.getIpv6Filters = async () => [];
  conn.getWebServerSettings = async () => ({ 'rest-plain': false });
  conn.getConfigurationSnapshot = async () => snapshot;
  conn.addScheduler = async (name, _interval, script) => { mutations++; schedulers.push({ name, 'on-event': script }); };
  conn.getSchedulers = async () => [...schedulers];
  conn.removeScheduler = async (name) => { mutations++; const index = schedulers.findIndex((entry) => entry.name === name); if (index !== -1) schedulers.splice(index, 1); };
  conn.testConnection = async () => ({ successful: true, transport: 'rest', host: '127.0.0.1', port: 9, latencyMs: 0 });
  return { conn, schedulers, count: () => mutations, changeSnapshot: () => { snapshot = 'configuration-after'; } };
}

describe('Security boundaries', () => {
  test('public MCP excludes router tools and refuses legacy calls despite router credentials', async () => {
    const server = createRemoteMcpServer();
    const client = new Client({ name: 'fixture', version: '1' });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    const connect = mock.method(ConnectionManager.prototype, 'testConnection', async () => { throw new Error('Router must not be contacted'); });
    try {
      await server.connect(remote); await client.connect(local);
      const catalog = await client.listTools();
      assert.ok(!catalog.tools.some((tool) => /list_devices|manage_|get_logs|test_connection/.test(tool.name)));
      const result = await client.callTool({ name: 'mikrotik_manage_queues', arguments: { action: 'create-cake', name: 'unsafe' } });
      assert.equal(result.isError, true);
      assert.equal(connect.mock.callCount(), 0);
    } finally { connect.mock.restore(); await client.close(); await server.close(); }
  });

  test('HTTP rejects malformed bodies, oversized work, and untrusted origins while remaining healthy', async () => {
    const server = new MikroTikHttpServer().listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    try {
      for (const value of ['null', '[]', '{', '42', '{"script":123}']) assert.equal((await post('/api/v1/knowledge/lint', value)).status, 400);
      assert.equal((await post('/api/v1/knowledge/lint', ' '.repeat(MAX_BODY_BYTES + 1))).status, 413);
      assert.equal((await post('/api/v1/knowledge/pcc', JSON.stringify({ wans: [{ name: 'ISP1', weight: 9999 }, { name: 'ISP2', weight: 1 }] }))).status, 400);
      const untrustedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(base + '/health', { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject); request.end();
      });
      assert.equal(untrustedHostStatus, 403);
      assert.equal((await fetch(base + '/mcp', { headers: { Origin: 'https://attacker.example' } })).status, 403);
      assert.equal((await fetch(base + '/health')).status, 200);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  test('sanitizes quoted and nested secrets and refuses cyclic data', () => {
    const input = { password: 'fixture password with spaces', peer: { 'private-key': 'dummy-private', 'preshared-key': 'dummy-psk', passphrase: 'dummy-pass', authorization: 'dummy-auth' } };
    const output = JSON.stringify(ConfigSanitizer.sanitizeJson(input));
    for (const secret of ['fixture password', 'dummy-private', 'dummy-psk', 'dummy-pass', 'dummy-auth']) assert.ok(!output.includes(secret));
    const text = ConfigSanitizer.sanitizeText('password="dummy password with spaces" private-key="dummy-private" token=fixturetoken');
    assert.ok(!text.includes('dummy')); assert.ok(!text.includes('fixturetoken'));
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    assert.throws(() => ConfigSanitizer.sanitizeJson(cyclic), /Cyclic/);
  });

  test('sanitizes JSON-escaped diagnostic strings and bounded long identifiers', () => {
    const output = ConfigSanitizer.sanitizeOutput(JSON.stringify({ message: 'password="fixture spaced secret"' }));
    assert.ok(!output.includes('fixture spaced secret'));
    const identifier = 'token'.repeat(12_000);
    assert.equal(ConfigSanitizer.sanitizeText(identifier), identifier);
    assert.equal(ConfigSanitizer.sanitizeText('ordinary=value'), 'ordinary=value');
  });

  test('rejects script injection in structured arguments and escapes literal RouterOS values', () => {
    assert.throws(() => PccCalculator.calculate({ wans: [{ name: 'ISP1; /system reboot' }, { name: 'ISP2' }] }));
    assert.throws(() => PccCalculator.calculate({ wans: [{ name: 'ISP1', weight: 9999 }, { name: 'ISP2', weight: 1 }] }));
    assert.throws(() => parseLocalArgs('mikrotik_manage_queues', { action: 'create-cake', name: 'bad";', target: '0.0.0.0/0', upload: '1M', download: '1M' }));
    assert.throws(() => parseLocalArgs('mikrotik_execute_command', { command: '/log info ok', confirmed: true }));
    assert.equal(quoteRouterOs('literal$"\\'), '"literal\\$\\"\\\\"');
  });

  test('hotspot outputs escape venue HTML and contain no default accounts', () => {
    const bundle = HotspotPortalGenerator.generate({ venueName: '<img src=x onerror=alert(1)>' });
    assert.ok(!bundle.loginHtml.includes('<img src=x'));
    assert.ok(bundle.loginHtml.includes('&lt;img'));
    assert.ok(!bundle.routerOsScript.includes('password='));
    assert.throws(() => HotspotPortalGenerator.generate({ googleAuthUrl: 'javascript:alert(1)' }));
  });

  test('TLS failure never retries through HTTP', async () => {
    const requests: string[] = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url: string | URL | Request) => { requests.push(String(url)); throw new Error('certificate rejected'); });
    try {
      await assert.rejects(new RouterOsRestClient({ ...fixtureConfig(), useSsl: true, restPort: 443 }).getResource(), /certificate/);
      assert.equal(requests.length, 1); assert.ok(requests[0]?.startsWith('https://'));
    } finally { fetchMock.mock.restore(); }
  });

  test('private TLS requires an explicit CA and retains certificate verification', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtik-tls-fixture-'));
    const key = path.join(directory, 'key.pem'); const certificate = path.join(directory, 'certificate.pem');
    const configuration = path.join(directory, 'openssl.cnf');
    fs.writeFileSync(configuration, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
    execFileSync(process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', configuration, '-keyout', key, '-out', certificate], { stdio: 'ignore', timeout: 15_000 });
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(certificate) }, (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"version":"fixture"}'); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const config = { ...fixtureConfig(), useSsl: true, restPort: (server.address() as AddressInfo).port };
    try {
      await assert.rejects(new RouterOsRestClient(config).getResource());
      assert.equal((await new RouterOsRestClient({ ...config, caFile: certificate }).getResource()).version, 'fixture');
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('binary TLS verifies peer identity and remove parameters retain API assignment syntax', async () => {
    let verified: boolean | undefined;
    const connect = mock.method(RouterOSAPI.prototype, 'connect', async function (this: RouterOSAPI) { verified = this.tls.rejectUnauthorized; return this; });
    const close = mock.method(RouterOSAPI.prototype, 'close', () => undefined);
    const write = mock.method(RouterOSAPI.prototype, 'write', async () => []);
    const client = new RouterOsBinaryClient({ ...fixtureConfig(), useSsl: true });
    try {
      await client.connect(); assert.equal(verified, true);
      await client.removeScheduler('fixture-scheduler');
      assert.deepEqual(write.mock.calls[0]?.arguments[0], ['/system/scheduler/remove', '=numbers=fixture-scheduler']);
    } finally { await client.close(); connect.mock.restore(); close.mock.restore(); write.mock.restore(); }
  });

  test('CLI mcp entrypoint starts a local protocol server without contacting a router', async () => {
    const client = new Client({ name: 'fixture', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', path.resolve('src/cli/index.ts'), 'mcp'], stderr: 'pipe', env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', ROUTEROS_HOST: '127.0.0.1', ROUTEROS_PASSWORD: 'fixture' } });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const raw = tools.tools.find((tool) => tool.name === 'mikrotik_execute_command');
      assert.ok(raw?.inputSchema.properties?.rollback);
      assert.equal((raw?.inputSchema.properties?.dryRun as { default?: boolean }).default, true);
    } finally { await client.close(); }
  });

  test('partial audit reads and disabled DNS drops never produce a false PASS', async () => {
    const { conn } = fixtureConnection();
    conn.getDnsSettings = async () => { throw new Error('fixture denied'); };
    const incomplete = await new SecurityAuditor(conn).runFullAudit();
    assert.equal(incomplete.overallScore, 'INCOMPLETE');
    assert.equal(incomplete.items.find((item) => item.title === 'DNS Open Resolver')?.status, 'UNKNOWN');
    conn.getDnsSettings = async () => ({ 'allow-remote-requests': true });
    conn.getFirewallFilters = async () => [{ chain: 'input', action: 'drop', protocol: 'udp', 'dst-port': '53', 'in-interface-list': 'WAN', disabled: true }];
    const unsafe = await new SecurityAuditor(conn).runFullAudit();
    assert.notEqual(unsafe.items.find((item) => item.title === 'DNS Open Resolver')?.status, 'PASS');
  });

  test('watchdog deadline follows router local clock across midnight', () => {
    assert.deepEqual(schedulerStart('2026-10-31', '23:59:45'), { 'start-date': '2026-11-01', 'start-time': '00:00:15' });
    assert.deepEqual(schedulerStart('oct/31/2026', '23:59:45'), { 'start-date': '2026-11-01', 'start-time': '00:00:15' });
    assert.throws(() => schedulerStart('invalid', '00:00:00'));
  });
});

describe('Guarded mutations', () => {
  async function execute(options: MutationOptions, fixture = fixtureConnection()) {
    let applied = 0;
    const result = guardMutation(fixture.conn, fixtureConfig(), options,
      { operation: 'fixture', parameters: { script: '/log info "fixture"' } },
      async () => { applied++; return { status: 'fixture-applied' }; }, (action) => action());
    return { result, fixture, applied: () => applied };
  }

  test('defaults to dry-run without creating a scheduler or applying changes', async () => {
    const run = await execute({});
    assert.equal((await run.result as { status: string }).status, 'DRY_RUN_SUCCESS');
    assert.equal(run.fixture.count(), 0); assert.equal(run.applied(), 0);
  });

  test('requires rollback, reason, and interactive approval', async () => {
    for (const options of [
      { dryRun: false, reason: 'fixture' },
      { dryRun: false, rollback: '/log info "rollback"' },
      { dryRun: false, reason: 'fixture', rollback: '/log info "rollback"' },
      { dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => false },
    ]) {
      const run = await execute(options);
      await assert.rejects(run.result);
      assert.equal(run.fixture.count(), 0); assert.equal(run.applied(), 0);
    }
  });

  test('rejects state drift and target changes after approval', async () => {
    const fixture = fixtureConnection();
    const run = await execute({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => { fixture.changeSnapshot(); return true; } }, fixture);
    await assert.rejects(run.result, /changed after review/); assert.equal(fixture.count(), 0);
    const changedTarget = await execute({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => true, checkTarget: () => { throw new Error('target changed'); } });
    await assert.rejects(changedTarget.result, /target changed/); assert.equal(changedTarget.fixture.count(), 0);
  });

  test('blocks apply when watchdog creation cannot be verified', async () => {
    const fixture = fixtureConnection(); fixture.conn.getSchedulers = async () => [];
    const run = await execute({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => true }, fixture);
    await assert.rejects(run.result, /could not be verified/); assert.equal(run.applied(), 0);
  });

  test('reports disarm failure instead of falsely reporting success', async () => {
    const fixture = fixtureConnection(); fixture.conn.removeScheduler = async () => { throw new Error('fixture failed'); };
    const run = await execute({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => true }, fixture);
    await assert.rejects(run.result, /disarm failed/); assert.equal(run.applied(), 1);
    assert.equal(fixture.schedulers.length, 1);
  });

  test('approved operations arm before apply and verify scheduler removal', async () => {
    const run = await execute({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => true });
    await run.result; assert.equal(run.applied(), 1); assert.equal(run.fixture.count(), 2); assert.equal(run.fixture.schedulers.length, 0);
  });

  test('an uncertain write is never retried through the binary transport', async () => {
    const fixture = fixtureConnection({ dryRun: false, reason: 'fixture', rollback: '/log info "rollback"', confirm: async () => true });
    const rest = mock.method(fixture.conn.getRestClient(), 'executeScript', async () => { throw new Error('fixture timeout after write'); });
    const binary = mock.method(fixture.conn.getBinaryClient(), 'executeScript', async () => ({ status: 'unexpected retry' }));
    try {
      await assert.rejects(fixture.conn.executeScript('/log info "fixture"'), /result is uncertain/);
      assert.equal(rest.mock.callCount(), 1); assert.equal(binary.mock.callCount(), 0);
    } finally { rest.mock.restore(); binary.mock.restore(); }
  });

  test('structured rollback uses a generated identity instead of the user comment', async () => {
    const fixture = fixtureConnection();
    const preview = await fixture.conn.addMangleRule({ chain: 'prerouting', action: 'mark-routing', 'src-address': '10.0.0.2', 'new-routing-mark': 'to_ISP1', comment: 'shared user comment' }) as { preview: string };
    const data = JSON.parse(preview.preview);
    assert.match(data.rollback, /shared user comment \[mtik_[a-f0-9]+\]/);
    assert.ok(!data.rollback.includes('comment="shared user comment"'));
    assert.equal(fixture.count(), 0);
  });

  test('local MCP refuses apply without client elicitation', async () => {
    const fixture = fixtureConnection();
    const originals: Array<() => void> = [];
    for (const name of ['getResource', 'getDnsSettings', 'getIpServices', 'getFirewallFilters', 'getMangleRules', 'getRoutingTables', 'getNtpClient', 'getBridges', 'getIpv6Filters', 'getWebServerSettings', 'getConfigurationSnapshot'] as const) {
      const replacement = mock.method(ConnectionManager.prototype, name, fixture.conn[name]);
      originals.push(() => replacement.mock.restore());
    }
    const client = new Client({ name: 'fixture', version: '1' });
    const server = createLocalMcpServer(); const [local, remote] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(remote); await client.connect(local);
      const result = await client.callTool({ name: 'mikrotik_execute_command', arguments: { command: '/log info "fixture"', dryRun: false, reason: 'fixture', rollback: '/log info "rollback"' } });
      assert.equal(result.isError, true); assert.match(JSON.stringify(result), /Interactive approval/);
    } finally { originals.forEach((restore) => restore()); await client.close(); await server.close(); }
  });
});
