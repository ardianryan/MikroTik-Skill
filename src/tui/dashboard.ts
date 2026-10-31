import { ConfigSanitizer } from '../safety/sanitizer.js';
import { PccSchema, HotspotSchema, WireGuardSchema } from '../safety/validation.js';
import chalk from 'chalk';
import { TextForm, type FormKey } from './form.js';
import { exportLocalArtifacts, lintLocalFile, lintReport, type LocalArtifact } from '../safety/local-artifacts.js';
import type { LintResult } from '../safety/linter.js';
import { z } from 'zod';
import { TerminalScreen } from './screen.js';
import { truncate, padRight, renderGauge, formatBytes, stringWidth, center, terminalLink } from './utils.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { sanitizeConfig, listProfiles, getDeviceConfig, loadRouterConfig, RouterConfigSchema, type RouterConfig } from '../config/profile.js';
import {
  getFleetStore,
  addFleetDevice,
  removeFleetDevice,
  setActiveFleetDevice,
  getActiveFleetDevice,
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
  offline?: boolean;
  screen?: TerminalScreen;
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
  preferBinary: boolean;
}

/**
 * Main Fullscreen Terminal User Interface (TUI) Dashboard & Wizard Engine.
 */
export class TuiDashboard {
  private screen: TerminalScreen;
  private offline: boolean;
  private form: TextForm | null = null;
  private submitForm: ((values: Record<string, string>) => void | Promise<void>) | null = null;
  private artifacts: LocalArtifact[] = [];
  private exportMessage: string | null = null;
  private lintResult: LintResult | null = null;
  private lintIndex = 0;
  private activeTab: TuiTab = 'telemetry';
  private selectedNavIndex = 0;
  private isRunning = false;
  private finish: (() => void) | null = null;
  private revision = 0;
  private uiError: string | null = null;
  private isGenerating = false;
  private telemetryPending: number | null = null;
  private targetName: string;
  private connections = new Set<ConnectionManager>();
  private focus: 'nav' | 'content' | 'wizard' = 'nav';

  // Top-Level View State: 'gateway' (Login / Router Selector) vs 'dashboard' (Full Sidebar TUI)
  private currentView: 'gateway' | 'dashboard' = 'gateway';
  private gatewayMode: 'select' | 'add' = 'select';
  private gatewayError: string | null = null;
  private isConnecting = false;
  private connectingTargetName = '';

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
    preferBinary: false,
  };

  // Live Router Telemetry
  private routerConfig: RouterConfig;
  private connectionStatus: 'connected' | 'connecting' | 'offline' = 'connecting';
  private routerOsVersion = 'RouterOS v7';
  private boardModel = 'MikroTik Hardware';
  private uptime = '-';
  private cpuLoad = 0;
  private freeMemory = 0;
  private totalMemory = 0;

  // Wizard States
  private wizardData: Record<string, string> = {};
  private wizardResult: string | null = null;
  private wireguardResult: WireGuardProvisionResult | null = null;
  private auditFindings: AuditItem[] = [];
  private isAuditing = false;

  constructor(options: TuiDashboardOptions = {}) {
    this.screen = options.screen ?? new TerminalScreen();
    this.offline = options.offline === true;
    if (this.offline && options.device) throw new Error('Offline mode cannot select a router target');
    this.fleetStore = this.offline ? { devices: [], activeDevice: '' } : getFleetStore();

    this.routerConfig = this.offline ? RouterConfigSchema.parse({ host: 'localhost', user: 'offline', password: '' }) : getDeviceConfig(options.device);
    this.targetName = this.offline ? 'Offline tools' : options.device || this.routerConfig.host;
    this.currentView = options.device || this.offline ? 'dashboard' : 'gateway';
    if (this.offline) this.connectionStatus = 'offline';
    this.gatewayMode = this.fleetStore.devices.length === 0 ? 'add' : 'select';

  }

  /**
   * Start TUI and initiate asynchronous connection polling.
   */
  public async start(): Promise<void> {
    if (this.isRunning) throw new Error('TUI is already running');
    this.isRunning = true;
    const finished = new Promise<void>((resolve) => { this.finish = resolve; });
    try {
      this.screen.enter();
      this.screen.onInterrupt(() => this.stop());
      this.setupKeyBindings();
      this.screen.onResize(() => this.render());
      this.render();
      if (this.currentView === 'dashboard' && !this.offline) this.runAction(() => this.fetchSystemTelemetry());
      await finished;
    } finally { this.stop(); }
  }

  public stop(): void {
    this.isRunning = false;
    this.revision++;
    this.screen.leave();
    this.finish?.();
    this.finish = null;
    for (const conn of this.connections) void conn.close().catch(() => {});
    this.connections.clear();
  }

  private runAction(action: () => void | Promise<void>): void {
    const revision = this.revision;
    void Promise.resolve().then(action).catch((error: unknown) => {
      if (!this.isRunning || revision !== this.revision) return;
      this.uiError = ConfigSanitizer.sanitizeText(error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : String(error));
      this.gatewayError = this.uiError;
      this.isConnecting = false;
      this.isGenerating = false;
      this.render();
    });
  }

  private async closeConnection(conn: ConnectionManager): Promise<void> {
    this.connections.delete(conn);
    await conn.close().catch(() => {});
  }

  private async fetchSystemTelemetry(): Promise<void> {
    if (this.offline || this.telemetryPending === this.revision || !this.isRunning) return;
    const revision = this.revision;
    this.telemetryPending = revision;
    const config = this.routerConfig;
    this.connectionStatus = 'connecting';
    this.render();
    const conn = new ConnectionManager(config);
    this.connections.add(conn);
    try {
      const test = await conn.testConnection();
      if (!this.isRunning || revision !== this.revision) return;
      this.connectionStatus = test.successful ? 'connected' : 'offline';
      if (test.successful) {
        this.routerOsVersion = test.routerOsVersion || 'v7.x';
        this.boardModel = test.boardModel || 'MikroTik';
        this.uptime = test.uptime || '-';
        const resource = await conn.getResource();
        if (!this.isRunning || revision !== this.revision) return;
        this.cpuLoad = Number(resource['cpu-load']) || 0;
        this.freeMemory = Number(resource['free-memory']) || 0;
        this.totalMemory = Number(resource['total-memory']) || 0;
      } else this.uiError = ConfigSanitizer.sanitizeText(test.error || 'Router is offline');
    } catch (error) {
      if (this.isRunning && revision === this.revision) {
        this.connectionStatus = 'offline';
        this.uiError = ConfigSanitizer.sanitizeText(error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : String(error));
      }
    } finally {
      await this.closeConnection(conn);
      if (this.telemetryPending === revision) this.telemetryPending = null;
      if (revision === this.revision) this.render();
    }
  }

  private async attemptConnectDevice(dev: { name: string; host: string; port: number; user: string; model?: string; preferBinary?: boolean }): Promise<void> {
    if (this.offline) throw new Error('Restart TUI without --offline to connect to a router');
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.gatewayError = null;
    this.connectingTargetName = `${dev.name} (${dev.host}:${dev.port})`;
    const revision = ++this.revision;
    this.render();
    let conn: ConnectionManager | undefined;
    try {
      const config = getDeviceConfig(dev.name);
      conn = new ConnectionManager(config);
      this.connections.add(conn);
      const result = await conn.testConnection();
      if (!this.isRunning || revision !== this.revision) return;
      if (!result.successful) throw new Error(result.error || 'Router connection failed');
      setActiveFleetDevice(dev.name);
      this.fleetStore = getFleetStore();
      this.routerConfig = config;
      this.targetName = dev.name;
      this.auditFindings = [];
      this.isAuditing = false;
      this.currentView = 'dashboard';
      this.resetWizardState();
      this.activeTab = 'telemetry';
      this.selectedNavIndex = 0;
      this.focus = 'content';
      this.connectionStatus = 'connected';
      this.uiError = null;
      this.runAction(() => this.fetchSystemTelemetry());
    } catch (error) {
      if (this.isRunning && revision === this.revision) {
        this.gatewayError = ConfigSanitizer.sanitizeText(error instanceof Error ? error.message : String(error));
        this.uiError = this.gatewayError;
        this.connectionStatus = 'offline';
      }
    } finally {
      if (conn) await this.closeConnection(conn);
      if (revision === this.revision) this.isConnecting = false;
      this.render();
    }
  }

  private async submitAddRouterForm(): Promise<void> {
    const name = (this.addRouterForm.name || `router-${Date.now().toString(36)}`).trim();
    const host = (this.addRouterForm.host || '192.168.88.1').trim();
    const preferBinary = Boolean(this.addRouterForm.preferBinary);
    const portText = this.addRouterForm.port.trim();
    if (!/^\d+$/.test(portText)) throw new Error('Port must be an integer between 1 and 65535');
    const port = Number(portText);
    loadRouterConfig({ host, user: (this.addRouterForm.user || 'admin').trim(), password: this.addRouterForm.password, restPort: port });
    const user = (this.addRouterForm.user || 'admin').trim();
    const password = this.addRouterForm.password;
    const model = (this.addRouterForm.model || 'MikroTik E60iUGS').trim();

    const newDev = addFleetDevice({
      name,
      host,
      port,
      user,
      password,
      model,
      preferBinary,
      useSsl: preferBinary ? port === 8729 : port === 443 || port === 8443,
    });

    this.fleetStore = getFleetStore();
    if (this.wizardMode === 'add-router') { this.wizardMode = null; this.focus = 'content'; }
    await this.attemptConnectDevice(newDev);
  }

  private handleGatewayKey(key: { name: string; sequence: string; ctrl?: boolean; shift?: boolean }): void {
    if (key.ctrl && key.name === 'q') { this.stop(); return; }
    if (this.isConnecting) return;

    const keyName = key.name || '';
    const devices = this.fleetStore.devices;

    if (this.gatewayMode === 'select') {
      if (keyName === 'q') {
        this.stop();
        return;
      }

      // Select previous device
      if (keyName === 'up' || keyName === 'k') {
        if (devices.length > 0) {
          this.selectedFleetIndex = (this.selectedFleetIndex - 1 + devices.length) % devices.length;
          this.gatewayError = null;
          this.render();
        }
        return;
      }

      // Select next device
      if (keyName === 'down' || keyName === 'j') {
        if (devices.length > 0) {
          this.selectedFleetIndex = (this.selectedFleetIndex + 1) % devices.length;
          this.gatewayError = null;
          this.render();
        }
        return;
      }

      // Connect to selected device
      if (keyName === 'return' || keyName === 'enter' || keyName === 'space') {
        const targetDev = devices[this.selectedFleetIndex];
        if (targetDev) {
          this.runAction(() => this.attemptConnectDevice(targetDev));
        }
        return;
      }

      // Switch to Add Router mode
      if (keyName === 'a' || keyName === 'n' || keyName === '2') {
        this.gatewayMode = 'add';
        this.gatewayError = null;
        this.addRouterField = 0;
        this.addRouterForm = {
          name: `router-${(devices.length + 1).toString()}`,
          host: '192.168.88.1',
          port: '443',
          user: 'admin',
          password: '',
          model: 'E60iUGS',
          preferBinary: false,
        };
        this.render();
        return;
      }

      // Delete device from fleet
      if (keyName === 'd') {
        const targetDev = devices[this.selectedFleetIndex];
        if (targetDev && devices.length > 0) {
          removeFleetDevice(targetDev.name);
          this.fleetStore = getFleetStore();
          this.selectedFleetIndex = Math.max(0, this.selectedFleetIndex - 1);
          if (this.fleetStore.devices.length === 0) {
            this.gatewayMode = 'add';
          }
          this.render();
        }
        return;
      }
    } else if (this.gatewayMode === 'add') {
      // Escape returns to select mode if devices exist
      if (keyName === 'escape') {
        if (devices.length === 0) { this.stop(); return; }
        if (devices.length > 0) {
          this.gatewayMode = 'select';
          this.gatewayError = null;
          this.render();
        }
        return;
      }

      // Key '1' switches to select mode
      if (keyName === '1' && (this.addRouterField === 0 || key.ctrl)) {
        if (devices.length > 0) {
          this.gatewayMode = 'select';
          this.gatewayError = null;
          this.render();
          return;
        }
      }

      const fieldKeys: Array<keyof AddRouterForm> = [
        'name',
        'host',
        'preferBinary',
        'port',
        'user',
        'password',
        'model',
      ];
      const currentKey = fieldKeys[this.addRouterField] || 'name';

      // Toggle Protocol on space
      if (currentKey === 'preferBinary') {
        if (keyName === 'space' || keyName === 'left' || keyName === 'right') {
          this.addRouterForm.preferBinary = !this.addRouterForm.preferBinary;
          this.addRouterForm.port = this.addRouterForm.preferBinary ? '8729' : '443';
          this.render();
          return;
        }
      }

      // Enter key
      if (keyName === 'return' || keyName === 'enter') {
        if (this.addRouterField < fieldKeys.length - 1) {
          this.addRouterField++;
          this.render();
        } else {
          // Submit form
          this.runAction(() => this.submitAddRouterForm());
        }
        return;
      }

      // Up navigation
      if (keyName === 'up' && this.addRouterField > 0) {
        this.addRouterField--;
        this.render();
        return;
      }

      // Down navigation
      if (keyName === 'down' && this.addRouterField < fieldKeys.length - 1) {
        this.addRouterField++;
        this.render();
        return;
      }

      // Tab navigation
      if (keyName === 'tab') {
        if (key.shift || key.sequence === '\x1b[Z') {
          this.addRouterField = (this.addRouterField - 1 + fieldKeys.length) % fieldKeys.length;
        } else {
          this.addRouterField = (this.addRouterField + 1) % fieldKeys.length;
        }
        this.render();
        return;
      }

      // Backspace
      if (keyName === 'backspace' && currentKey !== 'preferBinary') {
        const val = this.addRouterForm[currentKey];
        this.addRouterForm[currentKey] = [...val].slice(0, -1).join('');
        this.render();
        return;
      }

      // Printable character typing
      if (
        currentKey !== 'preferBinary' &&
        key.sequence &&
        key.sequence.length === 1 &&
                keyName !== 'tab' &&
        keyName !== 'enter' &&
        keyName !== 'return' &&
        keyName !== 'escape'
      ) {
        if (!key.ctrl && !/[\x00-\x1f\x7f-\x9f]/.test(key.sequence) && this.addRouterForm[currentKey].length < 256) this.addRouterForm[currentKey] += key.sequence;
        this.render();
      }
    }
  }

  private setupKeyBindings(): void {
    this.screen.onKey((key) => this.runAction(async () => {
      if (key.ctrl && key.name === 'q') { this.stop(); return; }
      if (this.form) { await this.handleFormKey(key); return; }
      if (this.currentView === 'gateway' && key.ctrl && key.name === 'o') {
        this.offline = true; this.revision++; this.connectionStatus = 'offline'; this.targetName = 'Offline tools';
        this.currentView = 'dashboard'; this.render(); return;
      }
      // If currently on Gateway screen, route all keystrokes to Gateway handler!
      if (this.currentView === 'gateway') {
        this.handleGatewayKey(key);
        return;
      }

      // Quit from Dashboard
      if (key.name === 'q' && this.focus !== 'wizard') {
        this.stop();
        return;
      }

      // Switch Router / Logout back to Gateway screen
      if ((key.name === 'l' || key.name === 'L') && this.focus !== 'wizard') {
        if (this.offline) { this.uiError = 'Restart without --offline to connect to a router.'; this.render(); return; }
        this.revision++;
        this.auditFindings = [];
        this.isAuditing = false;
        this.currentView = 'gateway';
        this.gatewayMode = this.fleetStore.devices.length === 0 ? 'add' : 'select';
        this.gatewayError = null;
        this.render();
        return;
      }

      // If in Add-Router Wizard, handle form input characters
      if (this.focus === 'wizard' && this.wizardMode === 'add-router') {
        this.handleAddRouterKey(key);
        return;
      }


      if (this.focus === 'content' && this.activeTab === 'hotspot' && /^[1-4]$/.test(key.name)) { this.handleHotspotWizardKey(key); return; }

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
        this.runAction(() => this.fetchSystemTelemetry());
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
    }));
  }

  private resetWizardState(): void {
    this.artifacts = []; this.exportMessage = null; this.form = null; this.submitForm = null;
    this.lintResult = null; this.lintIndex = 0;
    this.wizardData = {};
    this.wizardResult = null;
    this.wireguardResult = null;
    this.wizardMode = null;
    this.uiError = null;
    this.focus = 'nav';
  }

  private handleContentKey(key: { name: string; sequence: string }): void {
    if (key.name === 'escape') {
      this.resetWizardState();
      this.render();
      return;
    }

    if (key.name === 'e' && this.artifacts.length) { this.openExportForm(); return; }
    if (this.activeTab === 'linter') { this.handleLinterKey(key); return; }
    if (this.activeTab === 'fleet') {
      this.handleFleetKey(key);
    } else if (this.activeTab === 'pcc') {
      this.handlePccWizardKey(key);
    } else if (this.activeTab === 'wireguard') {
      this.runAction(() => this.handleWireguardWizardKey(key));
    } else if (this.activeTab === 'hotspot') {
      this.handleHotspotWizardKey(key);
    } else if (this.activeTab === 'audit') {
      this.runAction(() => this.handleAuditKey(key));
    }
  }

  private handleFleetKey(key: { name: string }): void {
    if (this.offline) { this.uiError = 'Restart without --offline to manage router credentials.'; this.render(); return; }
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
      // Switch active target router and open Telemetry Dashboard
      const targetDev = devices[this.selectedFleetIndex];
      if (targetDev) {
        this.runAction(() => this.attemptConnectDevice(targetDev));
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
        preferBinary: false,
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
          this.runAction(() => this.fetchSystemTelemetry());
        }
        this.render();
      }
    }
  }

  private handleAddRouterKey(key: { name: string; sequence: string; ctrl?: boolean; shift?: boolean }): void {
    if (key.name === 'escape') { this.focus = 'content'; this.wizardMode = null; this.uiError = null; this.render(); return; }
    this.handleGatewayFormKey(key);
  }

  private handleGatewayFormKey(key: { name: string; sequence: string; ctrl?: boolean; shift?: boolean }): void {
    const previousMode = this.gatewayMode;
    this.gatewayMode = 'add';
    try { this.handleGatewayKey(key); } finally { this.gatewayMode = previousMode; }
  }

  private openForm(title: string, fields: Array<{ key: string; label: string; value: string }>, submit: (values: Record<string, string>) => void | Promise<void>): void {
    this.form = new TextForm(title, fields); this.submitForm = submit; this.focus = 'wizard'; this.uiError = null; this.render();
  }

  private async handleFormKey(key: FormKey): Promise<void> {
    const form = this.form;
    if (!form || this.isGenerating) return;
    const action = form.handle(key);
    this.uiError = null;
    if (action === 'cancel') { this.form = null; this.submitForm = null; this.focus = 'content'; }
    if (action === 'submit' && this.submitForm) {
      this.isGenerating = true;
      try {
        await this.submitForm(form.values());
        if (this.form === form) { this.form = null; this.submitForm = null; this.focus = 'content'; }
      } finally { this.isGenerating = false; }
    }
    this.render();
  }

  private openExportForm(): void {
    this.openForm('Export to a NEW directory (existing paths are never overwritten)', [
      { key: 'path', label: 'Directory', value: '' },
    ], (values) => {
      if (!values.path) throw new Error('Enter a destination directory');
      this.exportMessage = `Saved ${this.artifacts.length} files to ${exportLocalArtifacts(values.path, this.artifacts)}`;
    });
  }

  private handlePccWizardKey(key: { name: string }): void {
    if (!['w', 'return', 'enter'].includes(key.name)) return;
    this.openForm('PCC generator — WAN rows: name:weight:gateway, separated by commas', [
      { key: 'wans', label: 'WANs', value: this.wizardData.wans || 'ISP1:2:192.168.1.1,ISP2:1:192.168.2.1' },
      { key: 'lan', label: 'LAN interface', value: this.wizardData.lan || 'bridge-lan' },
      { key: 'classifier', label: 'Classifier', value: this.wizardData.classifier || 'both-addresses-and-ports' },
    ], (values) => {
      const wans = (values.wans || '').split(',').map((row) => {
        const match = /^([^:]+):(\d+):(.+)$/.exec(row.trim());
        if (!match) throw new Error('WAN format: ISP1:2:192.168.1.1,ISP2:1:192.168.2.1');
        return { name: match[1], weight: Number(match[2]), gateway: match[3] };
      });
      const options = PccSchema.parse({ wans, lanInterface: values.lan, classifier: values.classifier });
      const result = PccCalculator.calculate(options);
      this.wizardData = values;
      this.wizardResult = result.script;
      this.artifacts = [{ name: 'pcc.rsc', content: result.script }];
      this.exportMessage = `${result.totalStreams} streams: ${Object.entries(result.streamsPerWan).map(([name, streams]) => `${name}=${streams.length}`).join(', ')}`;
    });
  }

  private async handleWireguardWizardKey(key: { name: string }): Promise<void> {
    if (!['g', 'return', 'enter'].includes(key.name)) return;
    this.openForm('WireGuard client — local provisioning only', [
      { key: 'serverPublicKey', label: 'Server public key', value: this.wizardData.serverPublicKey || '' },
      { key: 'clientName', label: 'Client name', value: this.wizardData.clientName || 'wg-client-phone' },
      { key: 'clientIp', label: 'Client IP/CIDR', value: this.wizardData.clientIp || '10.10.0.2/32' },
      { key: 'serverEndpoint', label: 'Server host:port', value: this.wizardData.serverEndpoint || 'vpn.example.com:13231' },
      { key: 'interfaceName', label: 'Router interface', value: this.wizardData.interfaceName || 'wg0' },
      { key: 'dns', label: 'DNS IPs', value: this.wizardData.dns || '10.10.0.1' },
      { key: 'allowedIps', label: 'Allowed IPs', value: this.wizardData.allowedIps || '0.0.0.0/0, ::/0' },
    ], async (values) => {
      if (!WireGuardSchema.shape.serverPublicKey.safeParse(values.serverPublicKey).success) throw new Error('Enter a valid 44-character base64 server public key.');
      const options = WireGuardSchema.parse(values);
      const revision = this.revision;
      const result = await WireGuardProvisioner.provisionClient(options);
      if (!this.isRunning || revision !== this.revision) return;
      this.wizardData = values; this.wireguardResult = result;
      this.artifacts = [{ name: 'client.conf', content: result.clientConfig }, { name: 'router-peer.rsc', content: result.routerPeerCommand }];
      this.exportMessage = 'Provisioning files contain private/preshared keys; stored with permission 0600.';
    });
  }

  private handleHotspotWizardKey(key: { name: string }): void {
    if (['1', '2', '3', '4'].includes(key.name)) {
      const models: HotspotAuthModel[] = ['all-in-one', 'voucher', 'member', 'dual'];
      this.wizardData.authModel = models[Number(key.name) - 1]!;
      this.render(); return;
    }
    if (!['w', 'return', 'enter'].includes(key.name)) return;
    this.openForm('Hotspot portal bundle', [
      { key: 'venueName', label: 'Venue name', value: this.wizardData.venueName || 'Guest Wi-Fi' },
      { key: 'model', label: 'Auth model', value: this.wizardData.authModel || 'all-in-one' },
      { key: 'dnsName', label: 'Portal DNS name', value: this.wizardData.dnsName || 'wifi.venue.lan' },
      { key: 'googleAuthUrl', label: 'HTTPS auth URL', value: this.wizardData.googleAuthUrl || '' },
      { key: 'enableTrial', label: 'Trial (yes/no)', value: this.wizardData.enableTrial || 'no' },
    ], (values) => {
      if (!['yes', 'no'].includes(values.enableTrial || '')) throw new Error('Trial must be yes or no');
      if (values.model === 'all-in-one' && !values.googleAuthUrl) throw new Error('All-in-one requires your HTTPS authentication URL; choose voucher/member/dual otherwise');
      const options = HotspotSchema.parse({ ...values, googleAuthUrl: values.googleAuthUrl || undefined, enableTrial: values.enableTrial === 'yes' });
      const result = HotspotPortalGenerator.generate(options);
      this.wizardData = { ...values, authModel: options.model || 'all-in-one' };
      this.wizardResult = `Auth Model: ${options.model?.toUpperCase()}\nLogin HTML: ${Buffer.byteLength(result.loginHtml)} bytes\nStatus HTML: ${Buffer.byteLength(result.statusHtml)} bytes`;
      this.artifacts = [{ name: 'login.html', content: result.loginHtml }, { name: 'status.html', content: result.statusHtml }, { name: 'hotspot_config.rsc', content: result.routerOsScript }];
      this.exportMessage = null;
    });
  }

  private handleLinterKey(key: { name: string }): void {
    if (key.name === 'down') this.lintIndex = Math.min((this.lintResult?.findings.length || 1) - 1, this.lintIndex + 1);
    else if (key.name === 'up') this.lintIndex = Math.max(0, this.lintIndex - 1);
    else if (['return', 'enter', 'o'].includes(key.name)) {
      this.openForm('Offline configuration linter (maximum 128 KiB)', [{ key: 'path', label: '.rsc file', value: '' }], (values) => {
        const result = lintLocalFile(values.path || '');
        this.lintResult = result; this.lintIndex = 0;
        this.artifacts = [{ name: 'lint-report.json', content: lintReport(result) }];
        this.exportMessage = null;
      });
    }
    this.render();
  }

  private async handleAuditKey(key: { name: string }): Promise<void> {
    if (this.offline) { this.uiError = 'Router audit requires a connection; use Config Linter for offline files.'; this.render(); return; }
    if ((key.name === 'space' || key.name === 'return') && !this.isAuditing) {
      this.isAuditing = true;
      const revision = this.revision;
      this.render();

      const conn = new ConnectionManager(this.routerConfig);
      this.connections.add(conn);
      try {
        const auditor = new SecurityAuditor(conn);
        const report = await auditor.runFullAudit();
        if (this.isRunning && revision === this.revision) this.auditFindings = report.items;
      } catch (err) {
        if (!this.isRunning || revision !== this.revision) return;
        this.auditFindings = [
          {
            id: 'F-ERR',
            pillar: 'Pillar 1: System Baseline',
            title: 'Audit Connection Failed',
            status: 'UNKNOWN',
            detail: `Could not connect to router at ${this.routerConfig.host}: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`,
            recommendation: '# Verify router IP, REST API port 443, and credentials in fleet.json or .env',
          },
        ];
      } finally {
        await this.closeConnection(conn);
        if (revision === this.revision) this.isAuditing = false;
        this.render();
      }
    }
  }

  /**
   * Render complete dashboard frame.
   */
  public render(): void {
    if (!this.isRunning) return;
    const { rows, cols } = this.screen.getDimensions();
    this.screen.clear();
    if (cols < 60 || rows < 24) { this.screen.write(truncate('Terminal too small: use at least 60 columns and 24 rows. Ctrl+C exits.', cols)); return; }

    if (this.currentView === 'gateway') {
      this.renderGateway(rows, cols);
      return;
    }

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

  private renderGateway(rows: number, cols: number): void {
    const boxWidth = Math.min(84, Math.max(50, cols - 4));
    const boxHeight = Math.min(24, Math.max(16, rows - 2));
    const startRow = Math.max(2, Math.floor((rows - boxHeight) / 2));
    const startCol = Math.max(2, Math.floor((cols - boxWidth) / 2));

    const lines: string[] = [];

    // Header title
    const bannerTitle = ' MIKROTIK NETDEVOPS SUITE • ROUTER GATEWAY & LOGIN ';
    lines.push(chalk.bold.cyan(bannerTitle));
    lines.push(chalk.gray('[Ctrl+O] Offline linter & generators (no router needed)'));

    // Mode tabs
    const isSelect = this.gatewayMode === 'select';
    const tab1 = isSelect
      ? chalk.bgCyan.black.bold(' [1] SELECT SAVED ROUTER ')
      : chalk.white(' [1] Select Saved Router ');
    const tab2 = !isSelect
      ? chalk.bgCyan.black.bold(' [2] + ADD NEW ROUTER ')
      : chalk.white(' [2] + Add New Router ');
    lines.push(`${tab1}   ${tab2}`);
    lines.push('');

    if (this.gatewayMode === 'select') {
      lines.push(chalk.bold.white('REGISTERED FLEET ROUTERS:'));
      lines.push(chalk.gray('Select a router and press [Enter] to authenticate and open the dashboard.'));
      lines.push('');

      const devices = this.fleetStore.devices;
      if (devices.length === 0) {
        lines.push(chalk.yellow('  (No routers stored yet. Press [A] or [2] to add a new router)'));
        lines.push('');
      } else {
        devices.forEach((dev, idx) => {
          const isSelected = idx === this.selectedFleetIndex;
          const arrow = isSelected ? chalk.cyan.bold(' ▶ ') : '   ';
          const namePart = padRight(dev.name, 16);
          const hostPart = padRight(`${dev.host}:${dev.port}`, 18);
          const userPart = padRight(dev.user, 10);
          const typePart = padRight(dev.preferBinary ? 'API (8728)' : 'REST (443/80)', 14);
          const modelPart = chalk.gray(`[${dev.model || 'MikroTik'}]`);

          const lineContent = `${arrow}${namePart} ${hostPart} ${userPart} ${typePart} ${modelPart}`;
          if (isSelected) {
            lines.push(chalk.bgCyan.black(padRight(lineContent, boxWidth - 6)));
          } else {
            lines.push(chalk.white(lineContent));
          }
        });
      }

      // Connecting state or error message
      lines.push('');
      if (this.isConnecting) {
        lines.push(chalk.bgYellow.black(` ⏳ Connecting & authenticating to ${this.connectingTargetName}... Please wait. `));
      } else if (this.gatewayError) {
        lines.push(chalk.bgRed.white(` ${this.gatewayError} `));
      } else {
        lines.push('');
      }

      // Bottom instruction
      lines.push('');
      lines.push(chalk.gray('─'.repeat(boxWidth - 4)));
      lines.push(
        chalk.gray(
          `${chalk.cyan('[↑/↓]')} Select  ${chalk.green('[Enter]')} Login & Launch Dashboard  ${chalk.yellow('[A]')} Add  ${chalk.red('[D]')} Delete  ${chalk.magenta('[Ctrl+Q]')} Quit`
        )
      );
    } else {
      // Add Router Form
      lines.push(chalk.bold.white('ONBOARDING: ENTER ROUTER CREDENTIALS:'));
      lines.push(chalk.gray('Fill in router details. Press [Enter] to proceed to the next field or submit.'));
      lines.push('');

      const fields: Array<{ label: string; value: string; hint?: string }> = [
        { label: 'Router Name', value: this.addRouterForm.name || chalk.gray('(e.g. core-router)') },
        { label: 'Host / IP', value: this.addRouterForm.host || chalk.gray('(e.g. 192.168.88.1)') },
        {
          label: 'Protocol / Mode',
          value: this.addRouterForm.preferBinary
            ? chalk.cyan.bold('Binary API Port 8728 (Native, No SSL)')
            : chalk.cyan.bold('REST API Port 443/80 (HTTPS/HTTP)'),
          hint: chalk.yellow('[Space to toggle]'),
        },
        { label: 'Port', value: this.addRouterForm.port },
        { label: 'Username', value: this.addRouterForm.user },
        {
          label: 'Password',
          value: this.addRouterForm.password
            ? '•'.repeat(this.addRouterForm.password.length)
            : chalk.gray('(leave empty if no password)'),
        },
        { label: 'Hardware Model', value: this.addRouterForm.model },
      ];

      fields.forEach((f, idx) => {
        const isCurrent = idx === this.addRouterField;
        const pointer = isCurrent ? chalk.cyan.bold(' ▶ ') : '   ';
        const labelStr = padRight(`${f.label}:`, 18);
        const valBox = `[ ${f.value} ]`;
        const hintStr = f.hint ? ` ${f.hint}` : '';
        const lineStr = `${pointer}${chalk.bold(labelStr)} ${valBox}${hintStr}`;

        if (isCurrent) {
          lines.push(chalk.bgCyan.black(padRight(lineStr, boxWidth - 6)));
        } else {
          lines.push(chalk.white(lineStr));
        }
      });

      lines.push('');
      if (this.isConnecting) {
        lines.push(chalk.bgYellow.black(` ⏳ Testing connection & saving router... Please wait. `));
      } else if (this.gatewayError) {
        lines.push(chalk.bgRed.white(` ${this.gatewayError} `));
      } else {
        lines.push('');
      }

      lines.push(chalk.gray('─'.repeat(boxWidth - 4)));
      lines.push(
        chalk.gray(
          `${chalk.cyan('[Tab/↑/↓]')} Move Field  ${chalk.green('[Enter]')} Save & Connect  ${chalk.yellow('[Esc]')} Cancel  ${chalk.magenta('[Ctrl+Q]')} Quit`
        )
      );
    }

    this.screen.drawBox(startRow, startCol, boxHeight, boxWidth, {
      title: 'ROUTER ONBOARDING & LOGIN GATEWAY',
      borderColor: chalk.cyan,
      focused: true,
      lines,
    });

    this.renderAttributionFooter(rows, cols);
  }

  private renderHeader(cols: number, host: string): void {
    const title = ' MikroTik NetDevOps Suite v1.3.0 ';
    const connBadge =
      this.connectionStatus === 'connected'
        ? chalk.bgGreen.black(' ONLINE ')
        : this.connectionStatus === 'connecting'
        ? chalk.bgYellow.black(' CONNECTING ')
        : chalk.bgRed.white(' OFFLINE ');

    const activeRouterName = chalk.bold.cyan(`[${this.targetName.toUpperCase()}]`);
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
    if (this.uiError) lines.push(chalk.red(truncate(this.uiError, width - 4)));
    if (this.exportMessage) lines.push(chalk.yellow(truncate(this.exportMessage, width - 4)));
    if (this.artifacts.length && !this.form) lines.push('[e] Export bundle  [Enter] Edit/generate  [Esc] Reset');
    const activeItem = NAV_ITEMS[this.selectedNavIndex] || NAV_ITEMS[0]!;

    if (this.form) lines.push(...this.form.lines(Math.max(1, height - lines.length - 7), width - 4));
    else switch (this.activeTab) {
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
    if (this.offline) { lines.push('Offline tools — no router connection is opened.', 'Choose PCC, WireGuard, Hotspot, or Config Linter.', 'Router telemetry is unavailable in offline mode.'); return; }
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
    lines.push('Interface topology is not inferred from a hardware example.');
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
          : f.status === 'PASS' ? chalk.bgGreen.black.bold(' PASS ') : f.status === 'UNKNOWN' ? chalk.bgYellow.black.bold(' UNKNOWN ') : chalk.bgBlue.white.bold(' INFO ');

      lines.push(`  ${badge} ${chalk.bold.white(f.id || 'CHECK')}: ${f.title}`);
      lines.push(`     ${chalk.gray(truncate(f.detail, 70))}`);
    });

    lines.push('');
    lines.push(chalk.gray('Press [Space] to re-run audit. Remediation scripts available in CLI `mtik audit`.'));
  }

  private renderPccContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Multi-WAN PCC generator (offline)'));
    lines.push('Enter WAN names, positive weights, gateways, and LAN interface.');
    if (!this.wizardResult) lines.push('[Enter] Configure WANs and generate a local script');
    else {
      lines.push('Generated configuration — review before applying to a router.');
      lines.push(...this.wizardResult.split('\n').slice(0, 9).map((line) => ConfigSanitizer.sanitizeText(line)));
    }
  }

  private renderWireguardContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('WireGuard client provisioning (offline)'));
    if (!this.wireguardResult) lines.push('[Enter] Configure client and server public key');
    else {
      lines.push('WireGuard Keys Provisioned');
      lines.push(`Client public key: ${this.wireguardResult.clientPublicKey}`);
      lines.push('Private and preshared keys: hidden; export provisioning files to use.');
      lines.push(ConfigSanitizer.sanitizeText(this.wireguardResult.routerPeerCommand));
    }
  }

  private renderHotspotContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Hotspot portal generator (offline)'));
    lines.push('[1] All-in-one  [2] Voucher  [3] Member  [4] Dual');
    lines.push(`Selected: ${this.wizardData.authModel || 'all-in-one'}`);
    lines.push('[Enter] Edit venue, model, portal DNS, authentication URL, and trial');
    if (this.wizardResult) lines.push(...this.wizardResult.split('\n'));
  }

  private renderMonitorContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Interface traffic monitor'));
    lines.push('No traffic samples available in this TUI yet.');
    lines.push('Live router monitoring is deferred; no example rates are displayed.');
    if (!this.offline) lines.push('Use `mtik monitor` with a configured router for live samples.');
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
      { key: 'preferBinary', label: '3. Transport', placeholder: 'Space toggles REST / Binary API' },
      { key: 'port', label: '4. Router Port', placeholder: '443 (HTTPS) or 8729 (API TLS)' },
      { key: 'user', label: '5. Username', placeholder: 'admin' },
      { key: 'password', label: '6. Password', placeholder: '••••••••', isPassword: true },
      { key: 'model', label: '7. Hardware Model', placeholder: 'e.g. E60iUGS (hEX S 2024)' },
    ];

    fields.forEach((f, idx) => {
      const isFocused = idx === this.addRouterField;
      const rawVal = f.key === 'preferBinary' ? (this.addRouterForm.preferBinary ? 'Binary API' : 'REST API') : String(this.addRouterForm[f.key] || '');
      const displayVal = f.isPassword ? '•'.repeat(rawVal.length) : rawVal;

      const cursor = isFocused ? chalk.cyan.bold(' ▶ ') : '   ';
      const labelText = isFocused ? chalk.bold.white(f.label) : chalk.gray(f.label);
      lines.push(`${cursor}${labelText}: ${displayVal || f.placeholder}${isFocused ? '█' : ''}`);

    });

    lines.push(chalk.gray('Press [Enter] for next field / save. [Up/Down] to navigate. [Esc] to cancel.'));
  }

  private renderLinterContent(lines: string[]): void {
    lines.push(chalk.cyan.bold('Offline RouterOS configuration linter'));
    lines.push('[Enter/o] Open .rsc file  [↑/↓] Findings  [e] Export report');
    lines.push('Static checks do not replace a live router audit.');
    if (!this.lintResult) { lines.push('No file reviewed. Choose a local configuration (maximum 128 KiB).'); return; }
    const { summary, findings } = this.lintResult;
    lines.push(`${summary.total} findings: ${summary.critical} critical, ${summary.high} high, ${summary.warn} warnings`);
    if (!findings.length) { lines.push('No findings detected by the supported static checks.'); return; }
    const finding = findings[this.lintIndex]!;
    lines.push(`Finding ${this.lintIndex + 1}/${findings.length}: ${finding.id} [${finding.severity}]`);
    lines.push(`Line ${finding.line}: ${finding.rule}`, finding.message, finding.rawLine, `Suggested action: ${finding.remediation}`);
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
    lines.push(chalk.gray('Auto-install MCP configuration into your IDEs via: `mtik install-mcp`'));
  }

  private renderFooter(rows: number, cols: number): void {
    this.screen.moveTo(rows - 1, 1);
    const navHelp = chalk.cyan('[↑/↓/1-9] Navigate');
    const tabHelp = chalk.yellow('[Tab] Focus');
    const actionHelp = chalk.green('[Enter] Action');
    const switchHelp = chalk.magenta.bold('[l] Switch Router');
    const refreshHelp = chalk.blue('[r] Refresh');
    const quitHelp = chalk.red('[q] Quit');

    const footerText = ` ${navHelp}  ${tabHelp}  ${actionHelp}  ${switchHelp}  ${refreshHelp}  ${quitHelp} `;
    const paddedFooter = padRight(footerText, cols);
    this.screen.write(chalk.bgGray.black(paddedFooter));

    this.renderAttributionFooter(rows, cols);
  }

  private renderAttributionFooter(rows: number, cols: number): void {
    this.screen.moveTo(rows, 1);
    const brand = chalk.gray(' MikroTik NetDevOps Suite v1.3.0');
    const authorLink = terminalLink('Ardian Ryan', 'https://github.com/ardianryan');
    const authorFull = `${chalk.gray('Engineered by ')}${chalk.cyan.bold(authorLink)}${chalk.gray(' (https://github.com/ardianryan) ')}`;
    const authorCompact = `${chalk.gray('Engineered by ')}${chalk.cyan.bold(authorLink)} `;

    const authorText = cols >= 88 ? authorFull : authorCompact;
    const authorLen = stringWidth(authorText);
    const brandLen = stringWidth(brand);

    if (cols >= 68) {
      const spaceLen = Math.max(1, cols - brandLen - authorLen);
      const fullLine = `${brand}${' '.repeat(spaceLen)}${authorText}`;
      this.screen.write(fullLine);
    } else {
      const compactLine = center(authorCompact, cols);
      this.screen.write(compactLine);
    }
  }
}
