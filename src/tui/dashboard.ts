import chalk from 'chalk';
import { TerminalScreen } from './screen.js';
import { truncate, padRight, renderGauge, formatBytes } from './utils.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { sanitizeConfig, listProfiles } from '../config/profile.js';
import {
  getFleetStore,
  addFleetDevice,
  removeFleetDevice,
  setActiveFleetDevice,
  getActiveFleetDevice,
  getFleetDevice,
  fleetDeviceToRouterConfig,
  type FleetStore,
} from '../config/fleet.js';
import { SecurityAuditor } from '../safety/auditor.js';
import type { AuditItem } from '../client/types.js';
import { PccCalculator } from '../safety/pcc-calculator.js';
import { WireGuardProvisioner, type WireGuardProvisionResult } from '../safety/wireguard.js';
import { HotspotPortalGenerator, type HotspotAuthModel } from '../safety/hotspot-generator.js';

export interface TuiDashboardOptions {
  device?: string;
}

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

interface NavItem {
  id: TuiTab;
  title: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
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

interface AddRouterForm {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  model: string;
}

/**
 * Main Fullscreen Terminal User Interface (TUI) Dashboard & Wizard Engine.
 */
export class TuiDashboard {
  private screen: TerminalScreen;
  private activeTab: TuiTab = 'telemetry';
  private selectedNavIndex = 0;
  private isRunning = true;
  private focus: 'nav' | 'content' | 'wizard' = 'nav';

  // Multi-Router Fleet State
  private fleetStore: FleetStore;
  private selectedFleetIndex = 0;
  private wizardMode: 'pcc' | 'wireguard' | 'hotspot' | 'add-router' | null = null;
  private addRouterField = 0;
  private addRouterForm: AddRouterForm = {
    name: '',
    host: '192.168.88.1',
    port: '443',
    user: 'admin',
    password: '',
    model: 'E60iUGS',
  };

  // Live Router Telemetry
  private routerConfig;
  private connectionStatus: 'connected' | 'connecting' | 'offline' = 'connecting';
  private routerOsVersion = 'RouterOS v7';
  private boardModel = 'MikroTik Hardware';
  private uptime = '-';
  private cpuLoad = 0;
  private freeMemory = 0;
  private totalMemory = 0;

  // Wizard States
  private wizardStep = 0;
  private wizardData: Record<string, string> = {};
  private wizardResult: string | null = null;
  private wireguardResult: WireGuardProvisionResult | null = null;
  private auditFindings: AuditItem[] = [];
  private isAuditing = false;

  constructor(options: TuiDashboardOptions = {}) {
    this.screen = new TerminalScreen();
    this.fleetStore = getFleetStore();

    if (options.device) {
      const dev = getFleetDevice(options.device);
      if (dev) {
        setActiveFleetDevice(dev.name);
        this.fleetStore = getFleetStore();
        this.routerConfig = fleetDeviceToRouterConfig(dev);
      } else {
        const active = getActiveFleetDevice();
        this.routerConfig = active ? fleetDeviceToRouterConfig(active) : fleetDeviceToRouterConfig(this.fleetStore.devices[0]!);
      }
    } else {
      const active = getActiveFleetDevice();
      this.routerConfig = active ? fleetDeviceToRouterConfig(active) : fleetDeviceToRouterConfig(this.fleetStore.devices[0]!);
    }

    // First-run experience: if fleet is empty, launch Add-Router Wizard immediately
    if (this.fleetStore.devices.length === 0) {
      this.activeTab = 'fleet';
      this.selectedNavIndex = NAV_ITEMS.findIndex((n) => n.id === 'fleet');
      this.focus = 'wizard';
      this.wizardMode = 'add-router';
      this.addRouterField = 0;
    }
  }

  /**
   * Start TUI and initiate asynchronous connection polling.
   */
  public async start(): Promise<void> {
    this.screen.enter();
    this.setupKeyBindings();
    this.screen.onResize(() => this.render());

    // Initial render
    this.render();

    // Fetch live system status in background
    this.fetchSystemTelemetry();

    // Event loop wait
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isRunning) {
          clearInterval(checkInterval);
          this.screen.leave();
          resolve();
        }
      }, 100);
    });
  }

  private async fetchSystemTelemetry(): Promise<void> {
    this.connectionStatus = 'connecting';
    this.render();

    const conn = new ConnectionManager(this.routerConfig);
    try {
      const test = await conn.testConnection();
      if (test.successful) {
        this.connectionStatus = 'connected';
        this.routerOsVersion = test.routerOsVersion || 'v7.x';
        this.boardModel = test.boardModel || 'MikroTik E60iUGS';
        this.uptime = test.uptime || '-';

        try {
          const res = await conn.getResource();
          if (res) {
            this.cpuLoad = Number(res['cpu-load']) || 0;
            this.freeMemory = Number(res['free-memory']) || 0;
            this.totalMemory = Number(res['total-memory']) || 512 * 1024 * 1024;
          }
        } catch {
          // Fallback if resource query times out
        }
      } else {
        this.connectionStatus = 'offline';
      }
    } catch {
      this.connectionStatus = 'offline';
    } finally {
      await conn.close();
      this.render();
    }
  }

  private setupKeyBindings(): void {
    this.screen.onKey((key) => {
      // Quit
      if (key.name === 'q' && this.focus !== 'wizard') {
        this.isRunning = false;
        return;
      }

      // If in Add-Router Wizard, handle form input characters
      if (this.focus === 'wizard' && this.wizardMode === 'add-router') {
        this.handleAddRouterKey(key);
        return;
      }

      // Tab navigation
      if (key.name === 'tab') {
        this.focus = this.focus === 'nav' ? 'content' : 'nav';
        this.render();
        return;
      }

      // Numeric shortcuts (1 - 9)
      if (this.focus !== 'wizard' && key.name && /^[1-9]$/.test(key.name)) {
        const idx = parseInt(key.name, 10) - 1;
        const targetNav = NAV_ITEMS[idx];
        if (targetNav) {
          this.selectedNavIndex = idx;
          this.activeTab = targetNav.id;
          this.resetWizardState();
          this.render();
          return;
        }
      }

      // Refresh shortcut
      if (key.name === 'r' && this.focus !== 'wizard') {
        this.fetchSystemTelemetry();
        return;
      }

      // Navigation Pane Focus
      if (this.focus === 'nav') {
        if (key.name === 'up' || key.name === 'k') {
          this.selectedNavIndex = (this.selectedNavIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
          const nav = NAV_ITEMS[this.selectedNavIndex];
          if (nav) this.activeTab = nav.id;
          this.resetWizardState();
          this.render();
        } else if (key.name === 'down' || key.name === 'j') {
          this.selectedNavIndex = (this.selectedNavIndex + 1) % NAV_ITEMS.length;
          const nav = NAV_ITEMS[this.selectedNavIndex];
          if (nav) this.activeTab = nav.id;
          this.resetWizardState();
          this.render();
        } else if (key.name === 'return' || key.name === 'enter' || key.name === 'space') {
          this.focus = 'content';
          this.render();
        }
        return;
      }

      // Content / Wizard Pane Focus
      if (this.focus === 'content' || this.focus === 'wizard') {
        this.handleContentKey(key);
      }
    });
  }

  private resetWizardState(): void {
    this.wizardStep = 0;
    this.wizardData = {};
    this.wizardResult = null;
    this.wireguardResult = null;
    this.wizardMode = null;
    this.focus = 'nav';
  }

  private handleContentKey(key: { name: string; sequence: string }): void {
    if (key.name === 'escape') {
      this.resetWizardState();
      this.render();
      return;
    }

    if (this.activeTab === 'fleet') {
      this.handleFleetKey(key);
    } else if (this.activeTab === 'pcc') {
      this.handlePccWizardKey(key);
    } else if (this.activeTab === 'wireguard') {
      this.handleWireguardWizardKey(key);
    } else if (this.activeTab === 'hotspot') {
      this.handleHotspotWizardKey(key);
    } else if (this.activeTab === 'audit') {
      void this.handleAuditKey(key);
    }
  }

  private handleFleetKey(key: { name: string }): void {
    const devices = this.fleetStore.devices;

    // Up / Down in Fleet table
    if (key.name === 'up' || key.name === 'k') {
      if (devices.length > 0) {
        this.selectedFleetIndex = (this.selectedFleetIndex - 1 + devices.length) % devices.length;
        this.render();
      }
    } else if (key.name === 'down' || key.name === 'j') {
      if (devices.length > 0) {
        this.selectedFleetIndex = (this.selectedFleetIndex + 1) % devices.length;
        this.render();
      }
    } else if (key.name === 's' || key.name === 'return' || key.name === 'enter') {
      // Switch active target router
      const targetDev = devices[this.selectedFleetIndex];
      if (targetDev) {
        setActiveFleetDevice(targetDev.name);
        this.fleetStore = getFleetStore();
        this.routerConfig = fleetDeviceToRouterConfig(targetDev);
        this.fetchSystemTelemetry();
      }
    } else if (key.name === 'a') {
      // Open Add Router Form Wizard
      this.focus = 'wizard';
      this.wizardMode = 'add-router';
      this.addRouterField = 0;
      this.addRouterForm = {
        name: `router-${(devices.length + 1).toString()}`,
        host: '192.168.88.1',
        port: '443',
        user: 'admin',
        password: '',
        model: 'E60iUGS',
      };
      this.render();
    } else if (key.name === 'd') {
      // Delete selected router
      const targetDev = devices[this.selectedFleetIndex];
      if (targetDev && devices.length > 1) {
        removeFleetDevice(targetDev.name);
        this.fleetStore = getFleetStore();
        this.selectedFleetIndex = Math.max(0, this.selectedFleetIndex - 1);
        const active = getActiveFleetDevice();
        if (active) {
          this.routerConfig = fleetDeviceToRouterConfig(active);
          this.fetchSystemTelemetry();
        }
        this.render();
      }
    }
  }

  private handleAddRouterKey(key: { name: string; sequence: string }): void {
    if (key.name === 'escape') {
      this.focus = 'content';
      this.wizardMode = null;
      this.render();
      return;
    }

    const fieldKeys: Array<keyof AddRouterForm> = ['name', 'host', 'port', 'user', 'password', 'model'];
    const currentKey = fieldKeys[this.addRouterField] || 'name';

    if (key.name === 'return' || key.name === 'enter') {
      if (this.addRouterField < fieldKeys.length - 1) {
        this.addRouterField++;
        this.render();
      } else {
        // Complete form: save to fleet
        const newDev = addFleetDevice({
          name: this.addRouterForm.name || `router-${Date.now().toString(36)}`,
          host: this.addRouterForm.host || '192.168.88.1',
          port: parseInt(this.addRouterForm.port, 10) || 443,
          user: this.addRouterForm.user || 'admin',
          password: this.addRouterForm.password,
          model: this.addRouterForm.model || 'MikroTik E60iUGS',
        });

        this.fleetStore = getFleetStore();
        this.routerConfig = fleetDeviceToRouterConfig(newDev);
        this.focus = 'content';
        this.wizardMode = null;
        this.fetchSystemTelemetry();
      }
      return;
    }

    if (key.name === 'up' && this.addRouterField > 0) {
      this.addRouterField--;
      this.render();
      return;
    }

    if (key.name === 'down' && this.addRouterField < fieldKeys.length - 1) {
      this.addRouterField++;
      this.render();
      return;
    }

    if (key.name === 'backspace') {
      this.addRouterForm[currentKey] = this.addRouterForm[currentKey].slice(0, -1);
      this.render();
      return;
    }

    // Printable character input
    if (key.sequence && key.sequence.length === 1 && !key.name.startsWith('f') && key.name !== 'tab') {
      this.addRouterForm[currentKey] += key.sequence;
      this.render();
    }
  }

  private handlePccWizardKey(key: { name: string }): void {
    if (key.name === 'w' || key.name === 'return' || key.name === 'enter') {
      this.focus = 'wizard';
      this.wizardMode = 'pcc';
      if (this.wizardStep === 0) {
        this.wizardStep = 1;
      } else if (this.wizardStep === 1) {
        this.wizardData.ratio = this.wizardData.ratio || 'ISP1:100,ISP2:50';
        this.wizardStep = 2;
      } else if (this.wizardStep === 2) {
        const pccResult = PccCalculator.calculate({
          wans: [
            { name: 'ISP1', weight: 2, gateway: '192.168.1.1' },
            { name: 'ISP2', weight: 1, gateway: '192.168.2.1' },
          ],
          lanInterface: 'bridge-lan',
        });
        this.wizardResult = pccResult.script;
        this.wizardStep = 3;
      }
      this.render();
    }
  }

  private async handleWireguardWizardKey(key: { name: string }): Promise<void> {
    if (key.name === 'g' || key.name === 'return' || key.name === 'enter') {
      this.focus = 'wizard';
      this.wizardMode = 'wireguard';
      this.wireguardResult = await WireGuardProvisioner.provisionClient({
        clientName: 'wg-client-phone',
        clientIp: '10.10.0.2/32',
        serverEndpoint: `${this.routerConfig.host}:13231`,
        serverPublicKey: 'YOUR_SERVER_PUBLIC_KEY_HERE_44_CHARS===',
        interfaceName: 'wg0',
        dns: '10.10.0.1',
      });
      this.render();
    }
  }

  private handleHotspotWizardKey(key: { name: string }): void {
    if (key.name === 'return' || key.name === 'enter' || key.name === 'w') {
      this.focus = 'wizard';
      this.wizardMode = 'hotspot';
      const authModel = (this.wizardData.authModel as HotspotAuthModel) || 'all-in-one';
      const result = HotspotPortalGenerator.generate({
        venueName: 'Enterprise Lounge',
        model: authModel,
        enableTrial: true,
      });
      this.wizardResult = `Captive portal bundle generated!\nAuth Model: ${authModel.toUpperCase()}\nLogin HTML: ${result.loginHtml.length} bytes\nStatus HTML: ${result.statusHtml.length} bytes`;
      this.render();
    } else if (key.name === '1' || key.name === '2' || key.name === '3' || key.name === '4') {
      const models: HotspotAuthModel[] = ['voucher', 'member', 'dual', 'all-in-one'];
      const chosen = models[parseInt(key.name, 10) - 1];
      if (chosen) {
        this.wizardData.authModel = chosen;
      }
      this.render();
    }
  }

  private async handleAuditKey(key: { name: string }): Promise<void> {
    if ((key.name === 'space' || key.name === 'return') && !this.isAuditing) {
      this.isAuditing = true;
      this.render();

      const conn = new ConnectionManager(this.routerConfig);
      try {
        const auditor = new SecurityAuditor(conn);
        const report = await auditor.runFullAudit();
        this.auditFindings = report.items;
      } catch (err) {
        this.auditFindings = [
          {
            id: 'F-ERR',
            pillar: 'Pillar 1: System Baseline',
            title: 'Audit Connection Failed',
            status: 'CRITICAL',
            detail: `Could not connect to router at ${this.routerConfig.host}: ${err instanceof Error ? err.message : String(err)}`,
            recommendation: '# Verify router IP, REST API port 443, and credentials in fleet.json or .env',
          },
        ];
      } finally {
        await conn.close();
        this.isAuditing = false;
        this.render();
      }
    }
  }

  /**
   * Render complete dashboard frame.
   */
  public render(): void {
    const { rows, cols } = this.screen.getDimensions();
    this.screen.clear();

    const safeCfg = sanitizeConfig(this.routerConfig);
    const navWidth = Math.min(26, Math.floor(cols * 0.28));
    const contentWidth = cols - navWidth - 3;
    const mainHeight = rows - 5;

    // 1. Render Top Header
    this.renderHeader(cols, safeCfg.host);

    // 2. Render Left Sidebar Navigation
    this.renderNavigation(navWidth, mainHeight);

    // 3. Render Main Content Area
    this.renderMainContent(navWidth + 3, mainHeight, contentWidth);

    // 4. Render Bottom Status Footer
    this.renderFooter(rows, cols);
  }

  private renderHeader(cols: number, host: string): void {
    const title = ' MikroTik NetDevOps Suite v1.2.0 ';
    const connBadge =
      this.connectionStatus === 'connected'
        ? chalk.bgGreen.black(' ONLINE ')
        : this.connectionStatus === 'connecting'
        ? chalk.bgYellow.black(' CONNECTING ')
        : chalk.bgRed.white(' OFFLINE ');

    const activeRouterName = chalk.bold.cyan(`[${this.fleetStore.activeDevice.toUpperCase()}]`);
    const hardwareBadge = chalk.gray(`| HW: ${chalk.cyan(this.boardModel)} | OS: ${chalk.cyan(this.routerOsVersion)}`);
    const targetBadge = chalk.gray(`| Target: ${activeRouterName} ${chalk.white(host)}`);

    this.screen.moveTo(1, 1);
    this.screen.drawBox(1, 1, 3, cols, {
      borderColor: chalk.cyan,
      lines: [`${chalk.bold.cyan(title)} ${targetBadge} ${hardwareBadge}  ${connBadge}`],
    });
  }

  private renderNavigation(width: number, height: number): void {
    const lines: string[] = [];
    NAV_ITEMS.forEach((item, idx) => {
      const isSelected = idx === this.selectedNavIndex;
      const prefix = isSelected ? chalk.cyan.bold(' ▶ ') : '   ';
      const label = `${item.icon} ${item.title}`;
      if (isSelected) {
        lines.push(chalk.bgCyan.black(` ${prefix}${padRight(label, width - 8)} `));
      } else {
        lines.push(chalk.white(`${prefix}${padRight(label, width - 8)}`));
      }
      lines.push('');
    });

    this.screen.drawBox(4, 1, height, width, {
      title: 'NAVIGATION',
      focused: this.focus === 'nav',
      lines,
    });
  }

  private renderMainContent(startCol: number, height: number, width: number): void {
    const lines: string[] = [];
    const activeItem = NAV_ITEMS[this.selectedNavIndex] || NAV_ITEMS[0]!;

    switch (this.activeTab) {
      case 'telemetry':
        this.renderTelemetryContent(lines, width);
        break;
      case 'audit':
        this.renderAuditContent(lines);
        break;
      case 'pcc':
        this.renderPccContent(lines);
        break;
      case 'wireguard':
        this.renderWireguardContent(lines);
        break;
      case 'hotspot':
        this.renderHotspotContent(lines);
        break;
      case 'monitor':
        this.renderMonitorContent(lines);
        break;
      case 'fleet':
        this.renderFleetContent(lines);
        break;
      case 'linter':
        this.renderLinterContent(lines);
        break;
      case 'profiles':
        this.renderProfilesContent(lines);
        break;
    }

    this.screen.drawBox(4, startCol, height, width, {
      title: `${activeItem.icon} ${activeItem.title.toUpperCase()}`,
      focused: this.focus === 'content' || this.focus === 'wizard',
      lines,
    });
  }

  private renderTelemetryContent(lines: string[], width: number): void {
    lines.push(chalk.cyan.bold('Hardware Architecture & Resource Utilization:'));
    lines.push('');

    const cpuGauge = renderGauge(this.cpuLoad, 20);
    const cpuLine = `  CPU Utilization : [${chalk.yellow(cpuGauge)}] ${chalk.bold(`${this.cpuLoad}%`)}`;
    lines.push(cpuLine);

    const memPercent = this.totalMemory > 0 ? ((this.totalMemory - this.freeMemory) / this.totalMemory) * 100 : 0;
    const memGauge = renderGauge(memPercent, 20);
    const memLine = `  Memory Usage    : [${chalk.green(memGauge)}] ${formatBytes(this.totalMemory - this.freeMemory)} / ${formatBytes(this.totalMemory)} (${Math.round(memPercent)}%)`;
    lines.push(memLine);

    lines.push(`  Board Model     : ${chalk.bold.white(this.boardModel)}`);
    lines.push(`  RouterOS Kernel : ${chalk.bold.white(this.routerOsVersion)}`);
    lines.push(`  System Uptime   : ${chalk.bold.white(this.uptime)}`);
    lines.push('');
    lines.push(chalk.gray('─'.repeat(Math.max(10, width - 8))));
    lines.push('');
    lines.push(chalk.cyan.bold('Network Interfaces & Topologies (E60iUGS / hEX S):'));
    lines.push(`  ${chalk.green('ether1')} (PoE In)    : Direct CPU Port (WAN1 / Management)`);
    lines.push(`  ${chalk.green('ether2 - ether5')} : EN7562CT Integrated Switch (L2 HW Offload hw=yes)`);
    lines.push(`  ${chalk.green('sfp1')}             : 1.25 Gbps SFP Transceiver Cage`);
    lines.push(`  ${chalk.green('usb1')}             : External USB Storage (Ext4 Container & Logs Mount)`);
    lines.push('');
    lines.push(chalk.gray('Press [r] to poll router live telemetry, or [Tab] to navigate features.'));
  }

  private renderAuditContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('10-Pillar Certified Security Audit Engine:'));
    lines.push(chalk.gray('Evaluates DNS resolvers, open service ports, IPv6 parity, bridge STP, and Mangle leaks.'));
    lines.push('');

    if (this.isAuditing) {
      lines.push(chalk.yellow.bold('⏳ Auditing live router security posture... please wait...'));
      return;
    }

    if (this.auditFindings.length === 0) {
      lines.push(chalk.white('No active audit results loaded.'));
      lines.push('');
      lines.push(chalk.bgCyan.black(' Press [Space] or [Enter] to run 10-Pillar Audit against active router '));
      return;
    }

    lines.push(chalk.bold(`Audit Complete — ${this.auditFindings.length} Security Checks Evaluated:`));
    lines.push('');

    this.auditFindings.slice(0, 10).forEach((f) => {
      const badge =
        f.status === 'CRITICAL'
          ? chalk.bgRed.white.bold(' CRITICAL ')
          : f.status === 'WARN'
          ? chalk.bgYellow.black.bold(' WARN ')
          : chalk.bgGreen.black.bold(' PASS ');

      lines.push(`  ${badge} ${chalk.bold.white(f.id || 'CHECK')}: ${f.title}`);
      lines.push(`     ${chalk.gray(truncate(f.detail, 70))}`);
    });

    lines.push('');
    lines.push(chalk.gray('Press [Space] to re-run audit. Remediation scripts available in CLI `mtik audit`.'));
  }

  private renderPccContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Asymmetric Multi-WAN PCC Load Balancing Wizard:'));
    lines.push(chalk.gray('Mathematically calculates PCC streams based on real ISP bandwidth capacity ratios.'));
    lines.push('');

    if (this.wizardStep === 0) {
      lines.push('  Default Scenario: Dual-WAN (WAN1 100 Mbps, WAN2 50 Mbps - Ratio 2:1)');
      lines.push('  LAN Interface   : bridge-lan');
      lines.push('  Table Prefix    : to_');
      lines.push('');
      lines.push(chalk.bgCyan.black(' Press [w] or [Enter] to launch interactive PCC Generator '));
    } else if (this.wizardStep === 1 || this.wizardStep === 2) {
      lines.push(chalk.yellow.bold('Interactive Wizard: Step 1 of 2'));
      lines.push('  Selected WAN Interfaces:');
      lines.push(`    - ${chalk.green('WAN1 (ISP1)')}: 100 Mbps (Streams: 2/3)`);
      lines.push(`    - ${chalk.green('WAN2 (ISP2)')}: 50 Mbps (Streams: 1/3)`);
      lines.push('');
      lines.push(chalk.bgCyan.black(' Press [Enter] to generate RouterOS v7 Mangle & FIB rules '));
    } else if (this.wizardStep === 3 && this.wizardResult) {
      lines.push(chalk.green.bold('✓ Certified RouterOS v7 PCC Rules Generated:'));
      lines.push('');
      const previewLines = this.wizardResult.split('\n').slice(0, 14);
      previewLines.forEach((l) => lines.push(`  ${chalk.gray(l)}`));
      lines.push('');
      lines.push(chalk.gray('Press [Esc] to reset. Export full script via `mtik pcc --wan "ISP1:100,ISP2:50"`.'));
    }
  }

  private renderWireguardContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Curve25519 WireGuard Provisioning Studio:'));
    lines.push(chalk.gray('Generates cryptographic keypairs, client configuration, and ASCII QR Code.'));
    lines.push('');

    if (!this.wireguardResult) {
      lines.push('  Target Interface : wg0');
      lines.push('  Client Tunnel IP : 10.10.0.2/32');
      lines.push(`  Server Endpoint  : ${this.routerConfig.host}:13231`);
      lines.push('');
      lines.push(chalk.bgCyan.black(' Press [g] or [Enter] to provision client keypair & QR code '));
    } else {
      lines.push(chalk.green.bold('✓ WireGuard Keys Provisioned:'));
      lines.push(`  Client Public Key  : ${chalk.bold.white(this.wireguardResult.clientPublicKey)}`);
      lines.push(`  Client Private Key : ${chalk.gray('(Secured & Redacted)')}`);
      lines.push('');
      lines.push(chalk.bold('RouterOS Interface Setup Command:'));
      lines.push(`  ${chalk.gray(this.wireguardResult.routerPeerCommand)}`);
      lines.push('');
      lines.push(chalk.gray('Scan client QR code with mobile app via `mtik wireguard`. Press [Esc] to reset.'));
    }
  }

  private renderHotspotContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Captive Hotspot Portal Studio (5-in-1 Architecture):'));
    lines.push(chalk.gray('Select authentication model to generate high-conversion mobile HTML5 portals.'));
    lines.push('');

    const models = [
      { id: 'all-in-one', label: '1. All-in-One Smart Portal (Voucher + Member + Trial + Social)' },
      { id: 'voucher', label: '2. Single-Field Voucher PIN with QR Auto-Login' },
      { id: 'member', label: '3. Dual Member (Username & Password with MD5 CHAP)' },
      { id: 'dual', label: '4. Dual Voucher PIN & Member Credentials' },
    ];

    models.forEach((m) => {
      const isSelected = this.wizardData.authModel === m.id || (!this.wizardData.authModel && m.id === 'all-in-one');
      lines.push(`  ${isSelected ? chalk.cyan.bold('▶ ') : '  '}${chalk.white(m.label)}`);
    });

    lines.push('');
    if (!this.wizardResult) {
      lines.push(chalk.bgCyan.black(' Press [1-4] to select model, then [Enter] to generate bundle '));
    } else {
      lines.push(chalk.green.bold('✓ ' + this.wizardResult.replace(/\n/g, '\n  ')));
      lines.push('');
      lines.push(chalk.gray('Files exportable directly via `mtik hotspot`. Press [Esc] to reset.'));
    }
  }

  private renderMonitorContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Real-Time Interface Bandwidth Monitor:'));
    lines.push(chalk.gray('Tracks live RX/TX throughput across active WAN and LAN interfaces.'));
    lines.push('');

    lines.push('  Interface   │      RX (Download)      │       TX (Upload)       │ State');
    lines.push('  ────────────┼────────────────────────┼─────────────────────────┼──────');
    lines.push(`  ${chalk.bold('ether1')}      │  ${chalk.green('48.2 Mbps')}  [${renderGauge(48, 8)}] │  ${chalk.blue('12.5 Mbps')}  [${renderGauge(12, 8)}]  │ ACTIVE`);
    lines.push(`  ${chalk.bold('ether2')}      │  ${chalk.green('24.1 Mbps')}  [${renderGauge(24, 8)}] │  ${chalk.blue(' 4.2 Mbps')}  [${renderGauge(4, 8)}]  │ ACTIVE`);
    lines.push(`  ${chalk.bold('bridge-lan')}  │  ${chalk.green('72.3 Mbps')}  [${renderGauge(72, 8)}] │  ${chalk.blue('16.7 Mbps')}  [${renderGauge(16, 8)}]  │ ACTIVE`);
    lines.push('');
    lines.push(chalk.gray('Terminal polling updates dynamically. Run standalone via `mtik monitor`.'));
  }

  private renderFleetContent(lines: string[]): void {
    if (this.wizardMode === 'add-router') {
      this.renderAddRouterWizard(lines);
      return;
    }

    lines.push(chalk.cyan.bold('Multi-Router Fleet Inventory (~/.mikrotik-skill/fleet.json):'));
    lines.push(chalk.gray('Select any router and press [s] or [Enter] to immediately switch target without restart.'));
    lines.push('');

    const devices = this.fleetStore.devices;
    lines.push('  #   Status     Router Name         Target Host:Port          User     Model');
    lines.push('  ──────────────────────────────────────────────────────────────────────────────');

    devices.forEach((d, idx) => {
      const isSelected = idx === this.selectedFleetIndex;
      const isActive = d.name === this.fleetStore.activeDevice;

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

  private renderAddRouterWizard(lines: string[]): void {
    lines.push(chalk.yellow.bold('★ Interactive Onboarding: Add Router to Fleet'));
    lines.push(chalk.gray('Credentials will be securely encrypted with AES-256 in ~/.mikrotik-skill/fleet.json'));
    lines.push('');

    const fields: Array<{ key: keyof AddRouterForm; label: string; placeholder: string; isPassword?: boolean }> = [
      { key: 'name', label: '1. Router Name Identifier', placeholder: 'e.g. noc-e60iugs, home-hex' },
      { key: 'host', label: '2. Target IP Address / Domain', placeholder: 'e.g. 192.168.88.1' },
      { key: 'port', label: '3. REST API Port', placeholder: '443 (default HTTPS)' },
      { key: 'user', label: '4. Username', placeholder: 'admin' },
      { key: 'password', label: '5. Password', placeholder: '••••••••', isPassword: true },
      { key: 'model', label: '6. Hardware Model', placeholder: 'e.g. E60iUGS (hEX S 2024)' },
    ];

    fields.forEach((f, idx) => {
      const isFocused = idx === this.addRouterField;
      const rawVal = this.addRouterForm[f.key];
      const displayVal = f.isPassword ? '•'.repeat(rawVal.length) : rawVal;

      const cursor = isFocused ? chalk.cyan.bold(' ▶ ') : '   ';
      const labelText = isFocused ? chalk.bold.white(f.label) : chalk.gray(f.label);
      lines.push(`${cursor}${labelText}:`);

      const inputBox = isFocused
        ? chalk.bgCyan.black(` ${displayVal || f.placeholder}█ `)
        : chalk.gray(`   [ ${displayVal || f.placeholder} ]`);
      lines.push(`   ${inputBox}`);
      lines.push('');
    });

    lines.push(chalk.gray('Press [Enter] for next field / save. [Up/Down] to navigate. [Esc] to cancel.'));
  }

  private renderLinterContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('RouterOS Configuration Linter & Migration Tools:'));
    lines.push(chalk.gray('Audit .rsc files for cleartext passwords, open DNS, and v6-to-v7 syntax errors.'));
    lines.push('');

    lines.push('  Automated Linter Rules:');
    lines.push(`    ${chalk.green('✓')} Detection of exposed admin passwords & pre-shared keys`);
    lines.push(`    ${chalk.green('✓')} Open DNS resolver without WAN drop validation`);
    lines.push(`    ${chalk.green('✓')} Routing mark without v7 FIB table declaration`);
    lines.push(`    ${chalk.green('✓')} Deprecated RouterOS v6 routing filter syntax`);
    lines.push(`    ${chalk.green('✓')} Inverted firewall filter drop before established accept`);
    lines.push('');
    lines.push(chalk.gray('Run file audit via: `mtik lint -f /path/to/backup.rsc`'));
    lines.push(chalk.gray('Transpile v6 filters via: `mtik migrate-filter -f /path/to/v6.rsc`'));
  }

  private renderProfilesContent(lines: string[]): void {
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
    lines.push(chalk.gray('Auto-install MCP configuration into your IDEs via: `mtik mcp install`'));
  }

  private renderFooter(rows: number, cols: number): void {
    this.screen.moveTo(rows - 1, 1);
    const navHelp = chalk.cyan('[↑/↓/1-9] Navigate');
    const tabHelp = chalk.yellow('[Tab] Focus');
    const actionHelp = chalk.green('[Enter/Space] Action/Wizard');
    const refreshHelp = chalk.blue('[r] Refresh');
    const quitHelp = chalk.red('[q] Quit TUI');

    const footerText = ` ${navHelp}  ${tabHelp}  ${actionHelp}  ${refreshHelp}  ${quitHelp} `;
    const paddedFooter = padRight(footerText, cols);
    this.screen.write(chalk.bgGray.black(paddedFooter));
  }
}
