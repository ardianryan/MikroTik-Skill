import { ConfigSanitizer } from '../safety/sanitizer.js';
import { PccSchema, HotspotSchema, WireGuardSchema } from '../safety/validation.js';
import chalk from 'chalk';
import { TextForm, type FormKey } from './form.js';
import { exportLocalArtifacts, lintLocalFile, lintReport, type LocalArtifact } from '../safety/local-artifacts.js';
import type { LintResult } from '../safety/linter.js';
import { z } from 'zod';
import { TerminalScreen } from './screen.js';
import { truncate } from './utils.js';
import { renderGatewayView, handleGatewayKey, type AddRouterForm, type GatewayRenderContext } from './gateway-view.js';
import {
  renderHeader,
  renderNavigation,
  renderFooter,
  renderTelemetryContent,
  renderAuditContent,
  renderPccContent,
  renderWireguardContent,
  renderHotspotContent,
  renderMonitorContent,
  renderFleetContent,
  renderLinterContent,
  renderProfilesContent,
  NAV_ITEMS,
  type TuiTab,
  type TabViewsContext,
} from './tab-views.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { sanitizeConfig, getDeviceConfig, loadRouterConfig, RouterConfigSchema, type RouterConfig } from '../config/profile.js';
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
    this.gatewayMode = 'select';

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
    const self = this;
    handleGatewayKey({
      get gatewayMode() { return self.gatewayMode; },
      set gatewayMode(v) { self.gatewayMode = v; },
      get fleetStore() { return self.fleetStore; },
      set fleetStore(v) { self.fleetStore = v; },
      get selectedFleetIndex() { return self.selectedFleetIndex; },
      set selectedFleetIndex(v) { self.selectedFleetIndex = v; },
      get gatewayError() { return self.gatewayError; },
      set gatewayError(v) { self.gatewayError = v; },
      get addRouterField() { return self.addRouterField; },
      set addRouterField(v) { self.addRouterField = v; },
      get addRouterForm() { return self.addRouterForm; },
      set addRouterForm(v) { self.addRouterForm = v; },
      get isConnecting() { return self.isConnecting; },
      set isConnecting(v) { self.isConnecting = v; },
      stop: () => self.stop(),
      render: () => self.render(),
      runAction: (action) => self.runAction(action),
      attemptConnectDevice: (dev) => self.attemptConnectDevice(dev),
      submitAddRouterForm: () => self.submitAddRouterForm(),
    }, key);
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
        this.gatewayMode = 'select';
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
  private getGatewayContext(): GatewayRenderContext {
    return {
      gatewayMode: this.gatewayMode,
      fleetStore: this.fleetStore,
      selectedFleetIndex: this.selectedFleetIndex,
      isConnecting: this.isConnecting,
      connectingTargetName: this.connectingTargetName,
      gatewayError: this.gatewayError,
      addRouterForm: this.addRouterForm,
      addRouterField: this.addRouterField,
    };
  }

  private getTabContext(): TabViewsContext {
    return {
      offline: this.offline,
      cpuLoad: this.cpuLoad,
      totalMemory: this.totalMemory,
      freeMemory: this.freeMemory,
      boardModel: this.boardModel,
      routerOsVersion: this.routerOsVersion,
      uptime: this.uptime,
      isAuditing: this.isAuditing,
      auditFindings: this.auditFindings,
      wizardResult: this.wizardResult,
      wireguardResult: this.wireguardResult,
      wizardData: this.wizardData,
      wizardMode: this.wizardMode,
      fleetStore: this.fleetStore,
      selectedFleetIndex: this.selectedFleetIndex,
      addRouterForm: this.addRouterForm,
      addRouterField: this.addRouterField,
      lintResult: this.lintResult,
      lintIndex: this.lintIndex,
    };
  }

  public render(): void {
    if (!this.isRunning) return;
    const { rows, cols } = this.screen.getDimensions();
    this.screen.clear();
    if (cols < 60 || rows < 24) { this.screen.write(truncate('Terminal too small: use at least 60 columns and 24 rows. Ctrl+C exits.', cols)); return; }

    if (this.currentView === 'gateway') {
      renderGatewayView(this.screen, this.getGatewayContext(), rows, cols);
      return;
    }

    const safeCfg = sanitizeConfig(this.routerConfig);
    const navWidth = Math.min(26, Math.floor(cols * 0.28));
    const contentWidth = cols - navWidth - 3;
    const mainHeight = rows - 5;

    renderHeader(
      this.screen,
      cols,
      safeCfg.host,
      this.connectionStatus,
      this.targetName,
      this.boardModel,
      this.routerOsVersion
    );
    renderNavigation(this.screen, navWidth, mainHeight, this.selectedNavIndex, this.focus === 'nav');
    this.renderMainContent(navWidth + 3, mainHeight, contentWidth);
    renderFooter(this.screen, rows, cols);
  }

  private renderMainContent(startCol: number, height: number, width: number): void {
    const lines: string[] = [];
    if (this.uiError) lines.push(chalk.red(truncate(this.uiError, width - 4)));
    if (this.exportMessage) lines.push(chalk.yellow(truncate(this.exportMessage, width - 4)));
    if (this.artifacts.length && !this.form) lines.push('[e] Export bundle  [Enter] Edit/generate  [Esc] Reset');
    const activeItem = NAV_ITEMS[this.selectedNavIndex] || NAV_ITEMS[0]!;

    if (this.form) lines.push(...this.form.lines(Math.max(1, height - lines.length - 7), width - 4));
    else {
      const ctx = this.getTabContext();
      switch (this.activeTab) {
        case 'telemetry':
          renderTelemetryContent(lines, width, ctx);
          break;
        case 'audit':
          renderAuditContent(lines, ctx);
          break;
        case 'pcc':
          renderPccContent(lines, ctx);
          break;
        case 'wireguard':
          renderWireguardContent(lines, ctx);
          break;
        case 'hotspot':
          renderHotspotContent(lines, ctx);
          break;
        case 'monitor':
          renderMonitorContent(lines, ctx);
          break;
        case 'fleet':
          renderFleetContent(lines, ctx);
          break;
        case 'linter':
          renderLinterContent(lines, ctx);
          break;
        case 'profiles':
          renderProfilesContent(lines);
          break;
      }
    }

    this.screen.drawBox(4, startCol, height, width, {
      title: `${activeItem.icon} ${activeItem.title.toUpperCase()}`,
      focused: this.focus === 'content' || this.focus === 'wizard',
      lines,
    });
  }
}
