import chalk from 'chalk';
import { truncate, padRight, renderGauge, formatBytes } from './utils.js';
import { listProfiles } from '../config/profile.js';
import type { FleetStore } from '../config/fleet.js';
import type { AuditItem } from '../client/types.js';
import type { LintResult } from '../safety/linter.js';
import type { WireGuardProvisionResult } from '../safety/wireguard.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';
import { renderAttributionFooter, type AddRouterForm } from './gateway-view.js';
import { TerminalScreen } from './screen.js';

export type TuiTab =
  | 'telemetry'
  | 'audit'
  | 'pcc'
  | 'wireguard'
  | 'hotspot'
  | 'monitor'
  | 'fleet'
  | 'linter'
  | 'profiles';

export interface NavItem {
  id: TuiTab;
  title: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'telemetry', title: 'System Telemetry', icon: '📊' },
  { id: 'audit', title: '10-Pillar Audit', icon: '🛡️' },
  { id: 'pcc', title: 'Multi-WAN PCC', icon: '🔀' },
  { id: 'wireguard', title: 'WireGuard Studio', icon: '🔑' },
  { id: 'hotspot', title: 'Hotspot Studio', icon: '📶' },
  { id: 'monitor', title: 'Traffic Monitor', icon: '📈' },
  { id: 'fleet', title: 'Fleet & Multi-Router', icon: '🖧' },
  { id: 'linter', title: 'Config Linter', icon: '🔍' },
  { id: 'profiles', title: 'Profiles & MCP', icon: '⚙️' },
];

export function renderHeader(
  screen: TerminalScreen,
  cols: number,
  host: string,
  connectionStatus: 'connected' | 'connecting' | 'offline',
  targetName: string,
  boardModel: string,
  routerOsVersion: string
): void {
  const title = ' MikroTik NetDevOps Suite v1.3.0 ';
  const connBadge =
    connectionStatus === 'connected'
      ? chalk.bgGreen.black(' ONLINE ')
      : connectionStatus === 'connecting'
      ? chalk.bgYellow.black(' CONNECTING ')
      : chalk.bgRed.white(' OFFLINE ');

  const activeRouterName = chalk.bold.cyan(`[${targetName.toUpperCase()}]`);
  const hardwareBadge = chalk.gray(`| HW: ${chalk.cyan(boardModel)} | OS: ${chalk.cyan(routerOsVersion)}`);
  const targetBadge = chalk.gray(`| Target: ${activeRouterName} ${chalk.white(host)}`);

  screen.moveTo(1, 1);
  screen.drawBox(1, 1, 3, cols, {
    borderColor: chalk.cyan,
    lines: [`${chalk.bold.cyan(title)} ${targetBadge} ${hardwareBadge}  ${connBadge}`],
  });
}

export function renderNavigation(
  screen: TerminalScreen,
  width: number,
  height: number,
  selectedNavIndex: number,
  focused: boolean
): void {
  const lines: string[] = [];
  NAV_ITEMS.forEach((item, idx) => {
    const isSelected = idx === selectedNavIndex;
    const prefix = isSelected ? chalk.cyan.bold(' ▶ ') : '   ';
    const label = `${item.icon} ${item.title}`;
    if (isSelected) {
      lines.push(chalk.bgCyan.black(` ${prefix}${padRight(label, width - 8)} `));
    } else {
      lines.push(chalk.white(`${prefix}${padRight(label, width - 8)}`));
    }
    lines.push('');
  });

  screen.drawBox(4, 1, height, width, {
    title: 'NAVIGATION',
    focused,
    lines,
  });
}

export function renderFooter(screen: TerminalScreen, rows: number, cols: number): void {
  screen.moveTo(rows - 1, 1);
  const navHelp = chalk.cyan('[↑/↓/1-9] Navigate');
  const tabHelp = chalk.yellow('[Tab] Focus');
  const actionHelp = chalk.green('[Enter] Action');
  const switchHelp = chalk.magenta.bold('[l] Switch Router');
  const refreshHelp = chalk.blue('[r] Refresh');
  const quitHelp = chalk.red('[q] Quit');

  const footerText = ` ${navHelp}  ${tabHelp}  ${actionHelp}  ${switchHelp}  ${refreshHelp}  ${quitHelp} `;
  const paddedFooter = padRight(footerText, cols);
  screen.write(chalk.bgGray.black(paddedFooter));

  renderAttributionFooter(screen, rows, cols);
}

export interface TabViewsContext {
  offline: boolean;
  cpuLoad: number;
  totalMemory: number;
  freeMemory: number;
  boardModel: string;
  routerOsVersion: string;
  uptime: string;
  isAuditing: boolean;
  auditFindings: AuditItem[];
  wizardResult: string | null;
  wireguardResult: WireGuardProvisionResult | null;
  wizardData: Record<string, string>;
  wizardMode: 'pcc' | 'wireguard' | 'hotspot' | 'add-router' | null;
  fleetStore: FleetStore;
  selectedFleetIndex: number;
  addRouterForm: AddRouterForm;
  addRouterField: number;
  lintResult: LintResult | null;
  lintIndex: number;
}

export function renderTelemetryContent(lines: string[], width: number, ctx: TabViewsContext): void {
  if (ctx.offline) {
    lines.push('Offline tools — no router connection is opened.', 'Choose PCC, WireGuard, Hotspot, or Config Linter.', 'Router telemetry is unavailable in offline mode.');
    return;
  }
  lines.push(chalk.cyan.bold('Hardware Architecture & Resource Utilization:'));
  lines.push('');

  const cpuGauge = renderGauge(ctx.cpuLoad, 20);
  const cpuLine = `  CPU Utilization : [${chalk.yellow(cpuGauge)}] ${chalk.bold(`${ctx.cpuLoad}%`)}`;
  lines.push(cpuLine);

  const memPercent = ctx.totalMemory > 0 ? ((ctx.totalMemory - ctx.freeMemory) / ctx.totalMemory) * 100 : 0;
  const memGauge = renderGauge(memPercent, 20);
  const memLine = `  Memory Usage    : [${chalk.green(memGauge)}] ${formatBytes(ctx.totalMemory - ctx.freeMemory)} / ${formatBytes(ctx.totalMemory)} (${Math.round(memPercent)}%)`;
  lines.push(memLine);

  lines.push(`  Board Model     : ${chalk.bold.white(ctx.boardModel)}`);
  lines.push(`  RouterOS Kernel : ${chalk.bold.white(ctx.routerOsVersion)}`);
  lines.push(`  System Uptime   : ${chalk.bold.white(ctx.uptime)}`);
  lines.push('');
  lines.push(chalk.gray('─'.repeat(Math.max(10, width - 8))));
  lines.push('');
  lines.push('Interface topology is not inferred from a hardware example.');
  lines.push(chalk.gray('Press [r] to poll router live telemetry, or [Tab] to navigate features.'));
}

export function renderAuditContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('10-Pillar Certified Security Audit Engine:'));
  lines.push(chalk.gray('Evaluates DNS resolvers, open service ports, IPv6 parity, bridge STP, and Mangle leaks.'));
  lines.push('');

  if (ctx.isAuditing) {
    lines.push(chalk.yellow.bold('⏳ Auditing live router security posture... please wait...'));
    return;
  }

  if (ctx.auditFindings.length === 0) {
    lines.push(chalk.white('No active audit results loaded.'));
    lines.push('');
    lines.push(chalk.bgCyan.black(' Press [Space] or [Enter] to run 10-Pillar Audit against active router '));
    return;
  }

  lines.push(chalk.bold(`Audit Complete — ${ctx.auditFindings.length} Security Checks Evaluated:`));
  lines.push('');

  ctx.auditFindings.slice(0, 10).forEach((f) => {
    const badge =
      f.status === 'CRITICAL'
        ? chalk.bgRed.white.bold(' CRITICAL ')
        : f.status === 'WARN'
        ? chalk.bgYellow.black.bold(' WARN ')
        : f.status === 'PASS' ? chalk.bgGreen.black.bold(' PASS ') : f.status === 'UNKNOWN' ? chalk.bgYellow.black.bold(' UNKNOWN ') : chalk.bgBlue.white.bold(' INFO ');

    lines.push(`  ${badge} ${chalk.bold.white(f.id || 'CHECK')}: ${f.title}`);
    lines.push(`     ${chalk.gray(truncate(f.detail, 70))}`);
  });

  lines.push('');
  lines.push(chalk.gray('Press [Space] to re-run audit. Remediation scripts available in CLI `mtik audit`.'));
}

export function renderPccContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('Multi-WAN PCC generator (offline)'));
  lines.push('Enter WAN names, positive weights, gateways, and LAN interface.');
  if (!ctx.wizardResult) lines.push('[Enter] Configure WANs and generate a local script');
  else {
    lines.push('Generated configuration — review before applying to a router.');
    lines.push(...ctx.wizardResult.split('\n').slice(0, 9).map((line) => ConfigSanitizer.sanitizeText(line)));
  }
}

export function renderWireguardContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('WireGuard client provisioning (offline)'));
  if (!ctx.wireguardResult) lines.push('[Enter] Configure client and server public key');
  else {
    lines.push('WireGuard Keys Provisioned');
    lines.push(`Client public key: ${ctx.wireguardResult.clientPublicKey}`);
    lines.push('Private and preshared keys: hidden; export provisioning files to use.');
    lines.push(ConfigSanitizer.sanitizeText(ctx.wireguardResult.routerPeerCommand));
  }
}

export function renderHotspotContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('Hotspot portal generator (offline)'));
  lines.push('[1] All-in-one  [2] Voucher  [3] Member  [4] Dual');
  lines.push(`Selected: ${ctx.wizardData.authModel || 'all-in-one'}`);
  lines.push('[Enter] Edit venue, model, portal DNS, authentication URL, and trial');
  if (ctx.wizardResult) lines.push(...ctx.wizardResult.split('\n'));
}

export function renderMonitorContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('Interface traffic monitor'));
  lines.push('No traffic samples available in this TUI yet.');
  lines.push('Live router monitoring is deferred; no example rates are displayed.');
  if (!ctx.offline) lines.push('Use `mtik monitor` with a configured router for live samples.');
}

export function renderAddRouterWizard(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.yellow.bold('★ Interactive Onboarding: Add Router to Fleet'));
  lines.push(chalk.gray('Credentials will be securely encrypted with AES-256 in ~/.mikrotik-skill/fleet.json'));
  lines.push('');

  const fields: Array<{ key: keyof AddRouterForm; label: string; placeholder: string; isPassword?: boolean }> = [
    { key: 'name', label: '1. Router Name Identifier', placeholder: 'e.g. noc-e60iugs, home-hex' },
    { key: 'host', label: '2. Target IP Address / Domain', placeholder: 'e.g. 192.168.88.1' },
    { key: 'preferBinary', label: '3. Transport', placeholder: 'Space toggles REST / Binary API' },
    { key: 'port', label: '4. Router Port', placeholder: '443 (HTTPS) or 8729 (API TLS)' },
    { key: 'user', label: '5. Username', placeholder: 'admin' },
    { key: 'password', label: '6. Password', placeholder: '••••••••', isPassword: true },
    { key: 'model', label: '7. Hardware Model', placeholder: 'e.g. E60iUGS (hEX S 2024)' },
  ];

  fields.forEach((f, idx) => {
    const isFocused = idx === ctx.addRouterField;
    const rawVal = f.key === 'preferBinary' ? (ctx.addRouterForm.preferBinary ? 'Binary API' : 'REST API') : String(ctx.addRouterForm[f.key] || '');
    const displayVal = f.isPassword ? '•'.repeat(rawVal.length) : rawVal;

    const cursor = isFocused ? chalk.cyan.bold(' ▶ ') : '   ';
    const labelText = isFocused ? chalk.bold.white(f.label) : chalk.gray(f.label);
    lines.push(`${cursor}${labelText}: ${displayVal || f.placeholder}${isFocused ? '█' : ''}`);
  });

  lines.push(chalk.gray('Press [Enter] for next field / save. [Up/Down] to navigate. [Esc] to cancel.'));
}

export function renderFleetContent(lines: string[], ctx: TabViewsContext): void {
  if (ctx.wizardMode === 'add-router') {
    renderAddRouterWizard(lines, ctx);
    return;
  }

  lines.push(chalk.cyan.bold('Multi-Router Fleet Inventory (~/.mikrotik-skill/fleet.json):'));
  lines.push(chalk.gray('Select any router and press [s] or [Enter] to immediately switch target without restart.'));
  lines.push('');

  const devices = ctx.fleetStore.devices;
  lines.push('  #   Status     Router Name         Target Host:Port          User     Model');
  lines.push('  ──────────────────────────────────────────────────────────────────────────────');

  devices.forEach((d, idx) => {
    const isSelected = idx === ctx.selectedFleetIndex;
    const isActive = d.name === ctx.fleetStore.activeDevice;

    const cursor = isSelected ? chalk.cyan.bold('▶ ') : '  ';
    const statusBadge = isActive ? chalk.bgGreen.black.bold(' ACTIVE ') : chalk.gray(' IDLE   ');
    const nameCol = padRight(d.name, 18);
    const hostCol = padRight(`${d.host}:${d.port}`, 24);
    const userCol = padRight(d.user, 8);
    const modelCol = chalk.gray(d.model || 'MikroTik');

    const rowText = `${cursor}${statusBadge}  ${chalk.white.bold(nameCol)}  ${chalk.cyan(hostCol)}  ${userCol} ${modelCol}`;
    if (isSelected) {
      lines.push(chalk.bgGray.black(rowText));
    } else {
      lines.push(rowText);
    }
  });

  lines.push('');
  lines.push(chalk.gray('──────────────────────────────────────────────────────────────────────────────'));
  lines.push(`  ${chalk.green.bold('[s] / [Enter]')} Switch Active   ${chalk.cyan.bold('[a]')} Add Router   ${chalk.red.bold('[d]')} Delete Router   ${chalk.yellow.bold('[r]')} Refresh`);
  lines.push('');
  lines.push(chalk.gray('Quick CLI launch shortcut: run `mtik <router-name>` anytime in your shell!'));
}

export function renderLinterContent(lines: string[], ctx: TabViewsContext): void {
  lines.push(chalk.cyan.bold('Offline RouterOS configuration linter'));
  lines.push('[Enter/o] Open .rsc file  [↑/↓] Findings  [e] Export report');
  lines.push('Static checks do not replace a live router audit.');
  if (!ctx.lintResult) {
    lines.push('No file reviewed. Choose a local configuration (maximum 128 KiB).');
    return;
  }
  const { summary, findings } = ctx.lintResult;
  lines.push(`${summary.total} findings: ${summary.critical} critical, ${summary.high} high, ${summary.warn} warnings`);
  if (!findings.length) {
    lines.push('No findings detected by the supported static checks.');
    return;
  }
  const finding = findings[ctx.lintIndex]!;
  lines.push(`Finding ${ctx.lintIndex + 1}/${findings.length}: ${finding.id} [${finding.severity}]`);
  lines.push(`Line ${finding.line}: ${finding.rule}`, finding.message, finding.rawLine, `Suggested action: ${finding.remediation}`);
}

export function renderProfilesContent(lines: string[]): void {
  lines.push(chalk.cyan.bold('Router Profiles & Model Context Protocol (MCP) Setup:'));
  lines.push(chalk.gray('Manage multi-router credentials and register MCP server in local IDEs.'));
  lines.push('');

  const profiles = listProfiles();
  lines.push(chalk.bold(`Saved Profiles (${profiles.length}):`));
  profiles.forEach((p) => {
    lines.push(`  • ${chalk.bold.white(p.name)} (${p.host})`);
  });

  lines.push('');
  lines.push(chalk.bold('IDE MCP Integrations Supported:'));
  lines.push(`  ${chalk.cyan('Cursor')}       : Add to .cursor/mcp.json -> command: npx -y mikrotik-skill mcp`);
  lines.push(`  ${chalk.cyan('Claude Desktop')} : Add to claude_desktop_config.json`);
  lines.push(`  ${chalk.cyan('Windsurf')}     : Add to ~/.codeium/windsurf/mcp_config.json`);
  lines.push(`  ${chalk.cyan('VS Code')}      : Cline / Roo Code settings`);
  lines.push('');
  lines.push(chalk.gray('Auto-install MCP configuration into your IDEs via: `mtik install-mcp`'));
}
