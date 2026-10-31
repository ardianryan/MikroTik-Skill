import { after, afterEach, describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

const previousHome = process.env.HOME;
const previousCwd = process.cwd();
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtik-tui-fixture-'));
process.env.HOME = fixtureDirectory;
process.chdir(fixtureDirectory);
const { TuiDashboard } = await import('../src/tui/dashboard.js');
const { TerminalScreen } = await import('../src/tui/screen.js');
const { ConnectionManager } = await import('../src/client/connection-manager.js');
const { SecurityAuditor } = await import('../src/safety/auditor.js');
const { saveProfile } = await import('../src/config/profile.js');
const { addFleetDevice } = await import('../src/config/fleet.js');
const { loadRouterConfig } = await import('../src/config/profile.js');
const { stringWidth, truncate, renderGauge, formatBytes } = await import('../src/tui/utils.js');
type Key = Parameters<import('../src/tui/screen.js').KeyPressHandler>[0];

after(() => { process.env.HOME = previousHome; process.chdir(previousCwd); fs.rmSync(fixtureDirectory, { recursive: true, force: true }); });
afterEach(() => mock.restoreAll());

const fixtureConfig = () => loadRouterConfig({ host: '127.0.0.1', user: 'fixture', password: 'fixture-password', restPort: 9, apiPort: 9, apiSslPort: 9, useSsl: false });
async function settle() { for (let i = 0; i < 8; i++) await nextTurn(); }

function harness(device?: string, offline = false) {
  const screen = new TerminalScreen();
  let onKey: (key: Key) => void = () => {};
  let interrupt = () => {};
  let resize = () => {};
  let dimensions = { rows: 24, cols: 100 };
  const frames: string[] = [];
  const enter = mock.method(screen, 'enter', () => {});
  const leave = mock.method(screen, 'leave', () => {});
  mock.method(screen, 'onKey', (handler) => { onKey = handler; });
  mock.method(screen, 'onInterrupt', (handler) => { interrupt = handler; });
  mock.method(screen, 'onResize', (handler) => { resize = () => handler(dimensions); });
  mock.method(screen, 'getDimensions', () => dimensions);
  mock.method(screen, 'clear', () => { frames.push('<clear>'); });
  mock.method(screen, 'moveTo', () => {});
  mock.method(screen, 'write', (text) => { frames.push(text); });
  mock.method(screen, 'drawBox', (_row, _col, _height, _width, options = {}) => { frames.push(options.title || '', ...(options.lines || [])); });
  const dashboard = new TuiDashboard({ device, screen, offline });
  const running = dashboard.start();
  return {
    dashboard, running, enter, leave, frames,
    key: async (name: string, sequence = name, ctrl = false, shift = false) => { onKey({ name, sequence, ctrl, shift, meta: false }); await settle(); },
    interrupt: async () => { interrupt(); await running; },
    resize: async (cols: number, rows: number) => { dimensions = { cols, rows }; resize(); await settle(); },
    text: () => frames.join('\n').replace(/\x1b\[[0-9;]*m/g, ''),
  };
}

describe('TUI interactions with dummy routers', () => {
  test('explicit profile starts telemetry without any saved fleet and all tabs render', async () => {
    saveProfile('fixture-profile', fixtureConfig());
    const connection = mock.method(ConnectionManager.prototype, 'testConnection', async () => ({ successful: true, host: '127.0.0.1', port: 9, transport: 'rest' as const, latencyMs: 0, boardModel: 'Fixture Board' }));
    mock.method(ConnectionManager.prototype, 'getResource', async () => ({ version: 'fixture', 'cpu-load': '15', 'free-memory': '128', 'total-memory': '256' }));
    const view = harness('fixture-profile');
    try {
      await settle();
      assert.equal(connection.mock.callCount(), 1);
      assert.match(view.text(), /Fixture Board/);
      for (const number of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) await view.key(number);
      assert.match(view.text(), /CONFIG LINTER/);
      assert.match(view.text(), /PROFILES & MCP/);
      await view.key('q'); await view.running;
      assert.ok(view.leave.mock.callCount() > 0);
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('gateway form accepts f, masks passwords, and reports an invalid port without saving', async () => {
    const view = harness();
    try {
      await view.key('a');
      await view.key('f');
      assert.match(view.text(), /router-\d+f/);
      await view.key('tab'); await view.key('tab'); await view.key('tab');
      for (let i = 0; i < 5; i++) await view.key('backspace');
      await view.key('9'); await view.key('9'); await view.key('9'); await view.key('9'); await view.key('9');
      await view.key('tab'); await view.key('tab');
      for (const letter of 'never-print-this') await view.key(letter);
      assert.ok(!view.text().includes('never-print-this'));
      await view.key('tab'); await view.key('return');
      assert.match(view.text(), /65535|Too big|Invalid/);
      await view.key('q', '\x11', true); await view.running;
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('WireGuard validation errors stay in the form and a valid public key generates safely', async () => {
    saveProfile('wireguard-fixture', fixtureConfig());
    mock.method(ConnectionManager.prototype, 'testConnection', async () => ({ successful: false, host: '127.0.0.1', port: 9, transport: 'rest' as const, latencyMs: 0, error: 'fixture offline' }));
    const view = harness('wireguard-fixture');
    try {
      await view.key('4'); await view.key('tab'); await view.key('return');
      assert.match(view.text(), /Server public key/);
      await view.key('return');
      assert.match(view.text(), /Enter a valid 44-character base64 server public key/);
      await view.key('paste', Buffer.alloc(32, 7).toString('base64'));
      await view.key('return');
      for (let i = 0; i < 50 && !view.text().includes('WireGuard Keys Provisioned'); i++) await settle();
      assert.match(view.text(), /WireGuard Keys Provisioned/);
      const commands = view.frames.filter((line) => line.includes('/interface wireguard peers add'));
      assert.ok(commands.length > 0);
      assert.match(commands.at(-1)!, /preshared-key="\*{8}"/);
      await view.key('escape'); await view.key('q'); await view.running;
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('hotspot number keys select the displayed model instead of switching tabs', async () => {
    saveProfile('hotspot-fixture', fixtureConfig());
    mock.method(ConnectionManager.prototype, 'testConnection', async () => ({ successful: false, host: '127.0.0.1', port: 9, transport: 'rest' as const, latencyMs: 0 }));
    const view = harness('hotspot-fixture');
    try {
      await view.key('5'); await view.key('tab'); await view.key('2'); await view.key('return'); await view.key('return');
      assert.match(view.text(), /Auth Model: VOUCHER/);
      await view.key('escape'); await view.key('q'); await view.running;
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('unknown and informational audit findings retain their own labels', async () => {
    saveProfile('audit-fixture', fixtureConfig());
    mock.method(ConnectionManager.prototype, 'testConnection', async () => ({ successful: false, host: '127.0.0.1', port: 9, transport: 'rest' as const, latencyMs: 0 }));
    mock.method(SecurityAuditor.prototype, 'runFullAudit', async () => ({ timestamp: 'fixture', routerIdentity: 'fixture', firmwareVersion: 'fixture', overallScore: 'INCOMPLETE' as const, completeness: { complete: false, failedReads: ['dns'] }, items: [
      { id: 'F-01', pillar: 'DNS', title: 'Unverified fixture', status: 'UNKNOWN' as const, detail: 'Fixture read denied' },
      { id: 'F-02', pillar: 'DNS', title: 'Informational fixture', status: 'INFO' as const, detail: 'Fixture notice' },
    ] }));
    const view = harness('audit-fixture');
    try {
      await view.key('2'); await view.key('tab'); await view.key('return');
      assert.match(view.text(), /UNKNOWN/); assert.match(view.text(), /INFO/);
      assert.ok(!view.frames.some((line) => line.includes('PASS') && line.includes('Unverified fixture')));
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('late telemetry cannot redraw a closed screen', async () => {
    saveProfile('slow-fixture', fixtureConfig());
    let complete!: (value: import('../src/client/types.js').ConnectionTestResult) => void;
    mock.method(ConnectionManager.prototype, 'testConnection', () => new Promise((resolve) => { complete = resolve; }));
    const view = harness('slow-fixture'); await settle();
    await view.interrupt();
    const frameCount = view.frames.length;
    complete({ successful: false, host: '127.0.0.1', port: 9, transport: 'rest', latencyMs: 0 });
    await settle(); assert.equal(view.frames.length, frameCount);
  });

  test('closing a pending REST request aborts it without trying binary fallback', async () => {
    const conn = new ConnectionManager(fixtureConfig());
    let requestSignal: AbortSignal | null | undefined;
    const request = mock.method(globalThis, 'fetch', (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = options?.signal;
      requestSignal?.addEventListener('abort', () => reject(new Error('fixture request cancelled')), { once: true });
    }));
    const binary = mock.method(conn.getBinaryClient(), 'connect', async () => { throw new Error('Unexpected binary reconnect'); });
    const pending = conn.testConnection();
    await settle(); await conn.close();
    const result = await pending;
    assert.equal(requestSignal?.aborted, true);
    assert.equal(result.successful, false);
    assert.match(result.error || '', /closed/);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(binary.mock.callCount(), 0);
  });

  test('failed connections remain recoverable and small terminals can be resized and quit', async () => {
    addFleetDevice({ name: 'offline-fixture', host: '127.0.0.1', port: 9, user: 'fixture', password: 'fixture', useSsl: false });
    const connection = mock.method(ConnectionManager.prototype, 'testConnection', async () => { throw new Error('password="fixture secret" connection refused'); });
    const view = harness();
    try {
      await view.key('return'); await view.key('return');
      assert.equal(connection.mock.callCount(), 2);
      assert.ok(!view.text().includes('fixture secret'));
      await view.resize(20, 6); assert.match(view.text(), /Terminal too small/);
      await view.resize(100, 24); assert.match(view.frames.at(-1) || '', /Ryan|ardian/);
      await view.key('q'); await view.running;
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('offline entry opens no router connections and monitor never displays example rates', async () => {
    const connection = mock.method(ConnectionManager.prototype, 'testConnection', async () => { throw new Error('Offline mode attempted a connection'); });
    const view = harness(undefined, true);
    try {
      await view.key('r'); await view.key('6'); await view.key('2'); await view.key('tab'); await view.key('return');
      assert.match(view.text(), /Offline tools/);
      assert.match(view.text(), /No traffic samples/);
      assert.match(view.text(), /audit requires a connection/);
      assert.ok(!view.text().includes('48.2 Mbps'));
      assert.equal(connection.mock.callCount(), 0);
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('offline linter navigates sanitized findings and recovers from an export failure', async () => {
    const source = path.join(fixtureDirectory, 'review.rsc');
    fs.writeFileSync(source, '/user add name=fixture password="do not expose this"\n/ip dns set allow-remote-requests=yes');
    const target = path.join(fixtureDirectory, 'lint-export');
    const view = harness(undefined, true);
    try {
      await view.key('8'); await view.key('tab'); await view.key('return');
      await view.key('paste', source); await view.key('return');
      assert.match(view.text(), /LINT-SEC-01/);
      await view.key('down'); assert.match(view.text(), /Finding 2/);
      assert.ok(!view.text().includes('do not expose this'));
      await view.key('e'); await view.key('paste', fixtureDirectory); await view.key('return');
      assert.match(view.text(), /EEXIST/);
      await view.key('u', '\x15', true); await view.key('paste', target); await view.key('return');
      assert.match(view.text(), /Saved 1 files/);
      const report = JSON.parse(fs.readFileSync(path.join(target, 'lint-report.json'), 'utf8'));
      assert.equal(report.findings.length, 2);
      assert.ok(!JSON.stringify(report).includes('do not expose this'));
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('editable PCC validates weights, preserves its form, and exports chosen parameters', async () => {
    const target = path.join(fixtureDirectory, 'pcc-export');
    const view = harness(undefined, true);
    try {
      await view.key('3'); await view.key('tab'); await view.key('return');
      await view.key('u', '\x15', true); await view.key('paste', 'WAN1:0:192.0.2.1,WAN2:1:198.51.100.1'); await view.key('return');
      assert.match(view.text(), /Too small|>=1/);
      await view.key('u', '\x15', true); await view.key('paste', 'WAN1:3:192.0.2.1,WAN2:1:198.51.100.1');
      await view.key('tab'); await view.key('u', '\x15', true); await view.key('paste', 'bridge-office'); await view.key('return');
      assert.match(view.text(), /4 streams: WAN1=3, WAN2=1/);
      await view.key('e'); await view.key('paste', target); await view.key('return');
      const script = fs.readFileSync(path.join(target, 'pcc.rsc'), 'utf8');
      assert.match(script, /in-interface=bridge-office/);
      assert.match(script, /gateway=192.0.2.1/);
      assert.match(script, /both-addresses-and-ports:4\/2/);
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('WireGuard exports usable private artifacts while its UI keeps secrets masked', async () => {
    const target = path.join(fixtureDirectory, 'wireguard-export');
    const view = harness(undefined, true);
    try {
      await view.key('4'); await view.key('tab'); await view.key('return');
      await view.key('paste', Buffer.alloc(32, 9).toString('base64'));
      await view.key('tab'); await view.key('u', '\x15', true); await view.key('paste', 'office-phone');
      await view.key('return');
      for (let i = 0; i < 50 && !view.text().includes('WireGuard Keys Provisioned'); i++) await settle();
      await view.key('e'); await view.key('paste', target); await view.key('return');
      const config = fs.readFileSync(path.join(target, 'client.conf'), 'utf8');
      const peer = fs.readFileSync(path.join(target, 'router-peer.rsc'), 'utf8');
      assert.match(peer, /office-phone/);
      const privateKey = /^PrivateKey = (.+)$/m.exec(config)![1]!;
      const presharedKey = /^PresharedKey = (.+)$/m.exec(config)![1]!;
      assert.ok(!view.text().includes(privateKey)); assert.ok(!view.text().includes(presharedKey));
      assert.equal(fs.statSync(path.join(target, 'client.conf')).mode & 0o777, 0o600);
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('hotspot validates auth URLs and exports all three files with edited venue', async () => {
    const target = path.join(fixtureDirectory, 'hotspot-export');
    const view = harness(undefined, true);
    try {
      await view.key('5'); await view.key('tab'); await view.key('return');
      await view.key('return'); assert.match(view.text(), /requires your HTTPS/);
      await view.key('u', '\x15', true); await view.key('paste', 'Office <Guest>');
      await view.key('tab'); await view.key('u', '\x15', true); await view.key('paste', 'voucher');
      await view.key('return');
      await view.key('e'); await view.key('paste', target); await view.key('return');
      const html = fs.readFileSync(path.join(target, 'login.html'), 'utf8');
      assert.match(html, /Office &lt;Guest&gt;/);
      for (const name of ['login.html', 'status.html', 'hotspot_config.rsc']) assert.ok(fs.existsSync(path.join(target, name)));
    } finally { view.dashboard.stop(); await view.running; }
  });

  test('wide glyphs, combining marks, and nonfinite metrics stay within terminal cells', () => {
    assert.equal(stringWidth('界🙂'), 4);
    assert.equal(stringWidth('e\u0301'), 1);
    assert.ok(stringWidth(truncate('界🙂 example', 4)) <= 4);
    assert.equal(formatBytes(-1), '0 B'); assert.equal(formatBytes(Infinity), '0 B');
    assert.equal(renderGauge(NaN, 5), '░░░░░'); assert.equal(renderGauge(50, -1), '');
  });

  test('terminal lifecycle restores raw mode and removes its key, resize, and signal listeners', () => {
    const changes: Array<() => void> = [];
    function property(object: object, key: string, value: unknown) {
      const original = Object.getOwnPropertyDescriptor(object, key);
      Object.defineProperty(object, key, { value, configurable: true, writable: true });
      changes.push(() => { if (original) Object.defineProperty(object, key, original); else Reflect.deleteProperty(object, key); });
    }
    property(process.stdin, 'isTTY', true); property(process.stdout, 'isTTY', true);
    property(process.stdin, 'isRaw', false);
    const rawModes: boolean[] = [];
    property(process.stdin, 'setRawMode', (mode: boolean) => { rawModes.push(mode); return process.stdin; });
    mock.method(process.stdin, 'resume', () => process.stdin);
    mock.method(process.stdin, 'pause', () => process.stdin);
    mock.method(process.stdin, 'isPaused', () => true);
    mock.method(process.stdout, 'write', () => true);
    const keys = process.stdin.listenerCount('keypress');
    const resizes = process.stdout.listenerCount('resize');
    const signals = process.listenerCount('SIGINT');
    const screen = new TerminalScreen(); let interrupts = 0;
    screen.onInterrupt(() => { interrupts++; });
    try {
      screen.enter(); screen.enter();
      assert.equal(process.stdin.listenerCount('keypress'), keys + 1);
      assert.equal(process.stdout.listenerCount('resize'), resizes + 1);
      process.stdin.emit('keypress', '\x03', { name: 'c', ctrl: true, sequence: '\x03' });
      assert.equal(interrupts, 1);
      assert.equal(process.stdin.listenerCount('keypress'), keys);
      assert.equal(process.stdout.listenerCount('resize'), resizes);
      assert.equal(process.listenerCount('SIGINT'), signals);
      assert.deepEqual(rawModes, [true, false]);
      screen.enter(); screen.leave();
      assert.equal(process.stdin.listenerCount('keypress'), keys);
    } finally { screen.leave(); changes.reverse().forEach((restore) => restore()); }
  });

  test('non-interactive launches fail promptly without alternate-screen output', async () => {
    const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const output = mock.method(process.stdout, 'write', () => true);
    try {
      await assert.rejects(new TuiDashboard().start(), /interactive terminal/);
      assert.equal(output.mock.callCount(), 0);
    } finally { if (original) Object.defineProperty(process.stdin, 'isTTY', original); else Reflect.deleteProperty(process.stdin, 'isTTY'); }
  });
});
