import { ConfigSanitizer } from '../safety/sanitizer.js';
import { schedulerStart } from '../safety/watchdog.js';
import { MangleOrderEngine } from '../safety/order-engine.js';
import { randomUUID } from 'node:crypto';
import { guardMutation, type MutationOptions, type MutationSpec } from '../safety/mutation.js';
import { AddressSchema, NameSchema, RateSchema, TextLabelSchema, ScriptSchema, quoteRouterOs } from '../safety/validation.js';
import type { RouterConfig } from '../config/profile.js';
import { RouterOsRestClient } from './rest-client.js';
import { RouterOsBinaryClient } from './binary-client.js';
import type {
  SystemResource,
  RouterBoard,
  MangleRule,
  DhcpLease,
  RoutingTable,
  FirewallFilterRule,
  IpService,
  NtpClient,
  DnsSettings,
  InterfaceItem,
  BridgeItem,
  ConnectionTestResult,
  ContainerItem,
  AdlistItem,
  InterfaceTrafficMonitor,
  LogItem,
  PoeItem,
  QueueItem,
  WirelessClientItem,
  WebServerSettings,
} from './types.js';

export class ConnectionManager {
  private config: RouterConfig;
  private mutationOptions: MutationOptions;
  private applying = false;
  private closed = false;
  private restClient: RouterOsRestClient;
  private binaryClient: RouterOsBinaryClient;
  private preferredTransport: 'rest' | 'binary';
  private verifiedTransport: 'rest' | 'binary' | null = null;

  constructor(config: RouterConfig, mutationOptions: MutationOptions = {}) {
    this.mutationOptions = mutationOptions;
    this.config = config;
    this.restClient = new RouterOsRestClient(config);
    this.binaryClient = new RouterOsBinaryClient(config);
    this.preferredTransport = config.preferBinary ? 'binary' : 'rest';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const closedResult = (): ConnectionTestResult => ({ successful: false, transport: this.preferredTransport, host: this.config.host, port: this.config.restPort, latencyMs: Date.now() - startTime, error: 'Router connection is closed' });
    if (this.closed) return closedResult();

    if (this.preferredTransport === 'rest') {
      try {
        const resource = await this.restClient.getResource();
        const latency = Date.now() - startTime;
        this.verifiedTransport = 'rest';
        return {
          successful: true,
          transport: 'rest',
          host: this.config.host,
          port: this.config.restPort,
          routerOsVersion: resource.version,
          boardModel: resource.board || resource.platform,
          uptime: resource.uptime,
          latencyMs: latency,
        };
      } catch {
        if (this.closed) return closedResult();
        // Fallback to binary API socket
        try {
          await this.binaryClient.connect();
          const resource = await this.binaryClient.getResource();
          const latency = Date.now() - startTime;
          this.verifiedTransport = 'binary';
          return {
            successful: true,
            transport: 'binary',
            host: this.config.host,
            port: this.config.useSsl ? this.config.apiSslPort : this.config.apiPort,
            routerOsVersion: resource.version,
            boardModel: resource.board || resource.platform,
            uptime: resource.uptime,
            latencyMs: latency,
          };
        } catch (binaryErr) {
          const latency = Date.now() - startTime;
          return {
            successful: false,
            transport: 'rest',
            host: this.config.host,
            port: this.config.restPort,
            latencyMs: latency,
            error: ConfigSanitizer.sanitizeText(binaryErr instanceof Error ? binaryErr.message : String(binaryErr)),
          };
        }
      }
    } else {
      try {
        await this.binaryClient.connect();
        const resource = await this.binaryClient.getResource();
        const latency = Date.now() - startTime;
        this.verifiedTransport = 'binary';
        return {
          successful: true,
          transport: 'binary',
          host: this.config.host,
          port: this.config.useSsl ? this.config.apiSslPort : this.config.apiPort,
          routerOsVersion: resource.version,
          boardModel: resource.board || resource.platform,
          uptime: resource.uptime,
          latencyMs: latency,
        };
      } catch (binaryErr) {
        if (this.closed) return closedResult();
        try {
          const resource = await this.restClient.getResource();
          const latency = Date.now() - startTime;
          this.verifiedTransport = 'rest';
          return {
            successful: true,
            transport: 'rest',
            host: this.config.host,
            port: this.config.restPort,
            routerOsVersion: resource.version,
            boardModel: resource.board || resource.platform,
            uptime: resource.uptime,
            latencyMs: latency,
          };
        } catch {
          const latency = Date.now() - startTime;
          return {
            successful: false,
            transport: 'binary',
            host: this.config.host,
            port: this.config.apiPort,
            latencyMs: latency,
            error: ConfigSanitizer.sanitizeText(binaryErr instanceof Error ? binaryErr.message : String(binaryErr)),
          };
        }
      }
    }
  }

  getRestClient(): RouterOsRestClient {
    return this.restClient;
  }

  getBinaryClient(): RouterOsBinaryClient {
    return this.binaryClient;
  }

  private async executeWithFallback<T>(
    restFn: (client: RouterOsRestClient) => Promise<T>,
    binaryFn: (client: RouterOsBinaryClient) => Promise<T>
  ): Promise<T> {
    if (this.closed) throw new Error('Router connection is closed');
    if (this.verifiedTransport === 'binary') {
      try {
        return await binaryFn(this.binaryClient);
      } catch (err) {
        if (this.closed) throw new Error('Router connection is closed');
        return await restFn(this.restClient);
      }
    }

    try {
      return await restFn(this.restClient);
    } catch (err) {
      if (this.closed) throw new Error('Router connection is closed');
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('RouterOS REST Error (4') || errMsg.includes('RouterOS REST Error (5')) {
        throw err;
      }
      this.verifiedTransport = 'binary';
      return await binaryFn(this.binaryClient);
    }
  }

  private async writeOnce<T>(restFn: (client: RouterOsRestClient) => Promise<T>, binaryFn: (client: RouterOsBinaryClient) => Promise<T>): Promise<T> {
    if (!this.applying) throw new Error('Mutations require the guarded approval workflow');
    return (this.verifiedTransport ?? this.preferredTransport) === 'binary' ? binaryFn(this.binaryClient) : restFn(this.restClient);
  }

  private async mutate(spec: MutationSpec, apply: () => Promise<unknown>): Promise<unknown> {
    if (this.applying) return apply();
    return guardMutation(this, this.config, this.mutationOptions, spec, apply, async (action) => {
      this.applying = true;
      try { return await action(); } finally { this.applying = false; }
    });
  }

  async getConfigurationSnapshot(): Promise<unknown> {
    const rows = await this.executeWithFallback(
      (client) => client.exportConfig({ compact: true }),
      (client) => client.exportConfig(),
    );
    const canonical = (value: unknown): unknown => {
      if (typeof value === 'string') return value.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n');
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
      return value;
    };
    return canonical(rows);
  }

  async getSchedulers(): Promise<Array<{ '.id'?: string; name: string; 'on-event'?: string; disabled?: string | boolean }>> {
    return this.executeWithFallback((client) => client.getSchedulers(), (client) => client.getSchedulers());
  }

  async getResource(): Promise<SystemResource> {
    return this.executeWithFallback(
      (c) => c.getResource(),
      (c) => c.getResource()
    );
  }

  async getRouterBoard(): Promise<RouterBoard> {
    return this.executeWithFallback(
      (c) => c.getRouterBoard(),
      (c) => c.getRouterBoard()
    );
  }

  async getMangleRules(): Promise<MangleRule[]> {
    return this.executeWithFallback(
      (c) => c.getMangleRules(),
      (c) => c.getMangleRules()
    );
  }

  async addMangleRule(rule: Partial<MangleRule>): Promise<unknown> {
    rule = { ...rule };
    AddressSchema.parse(rule['src-address']);
    NameSchema.parse(rule['new-routing-mark']);
    TextLabelSchema.parse(rule.comment || '');
    const marker = `mtik_${randomUUID().replaceAll('-', '')}`;
    rule.comment = `${rule.comment || ''} [${marker}]`;
    const tables = await this.getRoutingTables();
    const valid = MangleOrderEngine.validateRoutingMark(rule['new-routing-mark']!, tables);
    if (!valid.valid) throw new Error(valid.reason);
    const rules = await this.getMangleRules();
    const position = MangleOrderEngine.analyzePlacement(rules, this.config.localBypassList).recommendedIndex;
    if (rules[position]?.['.id']) rule['place-before'] = rules[position]!['.id']!;
    return this.mutate({ operation: 'addMangleRule', parameters: rule, rollback: `/ip firewall mangle remove [find where comment=${quoteRouterOs(rule.comment!)}]` }, () => this.writeOnce(
      (c) => c.addMangleRule(rule),
      (c) => c.addMangleRule(rule)
    ));
  }

  async setMangleRule(id: string, patch: Partial<MangleRule>): Promise<unknown> {
    return this.mutate({ operation: 'setMangleRule', parameters: Array.from(arguments) }, () => this.writeOnce(
      (c) => c.setMangleRule(id, patch),
      (c) => c.setMangleRule(id, patch)
    ));
  }

  async removeMangleRule(id: string): Promise<unknown> {
    return this.mutate({ operation: 'removeMangleRule', parameters: Array.from(arguments) }, () => this.writeOnce(
      (c) => c.removeMangleRule(id),
      (c) => c.removeMangleRule(id)
    ));
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    return this.executeWithFallback(
      (c) => c.getDhcpLeases(),
      (c) => c.getDhcpLeases()
    );
  }

  async addDhcpLease(lease: Partial<DhcpLease>): Promise<unknown> {
    lease = { ...lease };
    AddressSchema.parse(lease.address);
    if (!/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(lease['mac-address'] || '')) throw new Error('Invalid MAC address');
    TextLabelSchema.parse(lease.comment || '');
    const marker = `mtik_${randomUUID().replaceAll('-', '')}`;
    lease.comment = `${lease.comment || ''} [${marker}]`;
    return this.mutate({ operation: 'addDhcpLease', parameters: lease, rollback: `/ip dhcp-server lease remove [find where comment=${quoteRouterOs(lease.comment!)}]` }, () => this.writeOnce(
      (c) => c.addDhcpLease(lease),
      (c) => c.addDhcpLease(lease)
    ));
  }

  async getRoutingTables(): Promise<RoutingTable[]> {
    return this.executeWithFallback(
      (c) => c.getRoutingTables(),
      (c) => c.getRoutingTables()
    );
  }

  async getFirewallFilters(): Promise<FirewallFilterRule[]> {
    return this.executeWithFallback(
      (c) => c.getFirewallFilters(),
      (c) => c.getFirewallFilters()
    );
  }

  async getIpServices(): Promise<IpService[]> {
    return this.executeWithFallback(
      (c) => c.getIpServices(),
      (c) => c.getIpServices()
    );
  }

  async getNtpClient(): Promise<NtpClient> {
    return this.executeWithFallback(
      (c) => c.getNtpClient(),
      (c) => c.getNtpClient()
    );
  }

  async getDnsSettings(): Promise<DnsSettings> {
    return this.executeWithFallback(
      (c) => c.getDnsSettings(),
      (c) => c.getDnsSettings()
    );
  }

  async getInterfaces(): Promise<InterfaceItem[]> {
    return this.executeWithFallback(
      (c) => c.getInterfaces(),
      (c) => c.getInterfaces()
    );
  }

  async addScheduler(name: string, interval: string, onEvent: string): Promise<unknown> {
    if (!this.applying) throw new Error('Watchdog writes require approval');
    const clock = await this.executeWithFallback((client) => client.getClock(), (client) => client.getClock());
    const start = schedulerStart(clock.date, clock.time);
    return this.writeOnce(
      (c) => c.addScheduler(name, interval, onEvent, start),
      (c) => c.addScheduler(name, interval, onEvent, start)
    );
  }

  async removeScheduler(idOrName: string): Promise<unknown> {
    return this.writeOnce(
      (c) => c.removeScheduler(idOrName),
      (c) => c.removeScheduler(idOrName)
    );
  }

  async getContainers(): Promise<ContainerItem[]> {
    return this.executeWithFallback(
      (c) => c.getContainers(),
      (c) => c.getContainers()
    );
  }

  async restartContainer(nameOrId: string): Promise<unknown> {
    return this.mutate({ operation: 'restartContainer', parameters: Array.from(arguments) }, () => this.writeOnce(
      (c) => c.restartContainer(nameOrId),
      (c) => c.restartContainer(nameOrId)
    ));
  }

  async getDnsAdlists(): Promise<AdlistItem[]> {
    return this.executeWithFallback(
      (c) => c.getDnsAdlists(),
      (c) => c.getDnsAdlists()
    );
  }

  async addDnsAdlist(url: string, sslVerify: boolean = true): Promise<unknown> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Adlist feed requires an HTTPS URL without credentials');
    const existing = await this.getDnsAdlists();
    if (existing.some((entry) => entry.url === url)) throw new Error('Adlist feed already exists');
    return this.mutate({ operation: 'addDnsAdlist', parameters: { url, sslVerify }, rollback: `/ip dns adlist remove [find where url=${quoteRouterOs(url)}]` }, () => this.writeOnce(
      (client) => client.addDnsAdlist(url, sslVerify), (client) => client.addDnsAdlist(url, sslVerify),
    ));
  }

  async getInterfaceTraffic(interfaceName: string): Promise<InterfaceTrafficMonitor> {
    return this.executeWithFallback(
      (c) => c.getInterfaceTraffic(interfaceName),
      (c) => c.getInterfaceTraffic(interfaceName)
    );
  }

  async getBridges(): Promise<BridgeItem[]> {
    return this.executeWithFallback(
      (c) => c.getBridges(),
      (c) => c.getBridges()
    );
  }

  async getIpv6Filters(): Promise<FirewallFilterRule[]> {
    return this.executeWithFallback(
      (c) => c.getIpv6Filters(),
      (c) => c.getIpv6Filters()
    );
  }

  async executeScript(script: string): Promise<unknown> {
    script = ScriptSchema.parse(script);
    return this.mutate({ operation: 'executeScript', parameters: { script } }, () => this.writeOnce(
      (client) => client.executeScript(script), (client) => client.executeScript(script),
    ));
  }

  async getLogs(options?: { topics?: string[]; limit?: number }): Promise<LogItem[]> {
    try {
      const limit = options?.limit || 50;
      const res = await this.restRequest<LogItem[]>('/log', 'GET');
      if (Array.isArray(res)) {
        let filtered = res;
        if (options?.topics && options.topics.length > 0) {
          const matchTopics = options.topics.map((t) => t.toLowerCase());
          filtered = filtered.filter((item) =>
            matchTopics.some((t) => (item.topics || '').toLowerCase().includes(t))
          );
        }
        return ConfigSanitizer.sanitizeJson(filtered.slice(-limit));
      }
    } catch {
      // Fallback
    }
    return [];
  }

  async getPoeStatus(): Promise<PoeItem[]> {
    try {
      const res = await this.restRequest<PoeItem[]>('/interface/ethernet/poe', 'GET');
      if (Array.isArray(res)) return res;
    } catch {
      // Fallback
    }
    return [];
  }

  async cyclePoePower(interfaceName: string): Promise<unknown> {
    const cleanIface = NameSchema.parse(interfaceName);
    return this.executeScript(`/interface ethernet poe power-cycle ${cleanIface}`);
  }

  async getQueues(): Promise<QueueItem[]> {
    try {
      const res = await this.restRequest<QueueItem[]>('/queue/simple', 'GET');
      if (Array.isArray(res)) return res;
    } catch {
      // Fallback
    }
    return [];
  }

  async createCakeQueue(options: { name: string; target: string; upload: string; download: string }): Promise<unknown> {
    NameSchema.parse(options.name); AddressSchema.parse(options.target); RateSchema.parse(options.upload); RateSchema.parse(options.download);
    const identity = `mtik_${randomUUID().replaceAll('-', '')}`;
    const queueType = `${identity}_cake`;
    const command = `/queue type add name=${quoteRouterOs(queueType)} kind=cake; ` +
      `/queue simple add name=${quoteRouterOs(options.name)} target=${options.target} max-limit=${options.upload}/${options.download} queue=${queueType}/${queueType} comment=${quoteRouterOs(identity)}`;
    const rollback = `/queue simple remove [find where comment=${quoteRouterOs(identity)}]; /queue type remove [find where name=${quoteRouterOs(queueType)}]`;
    return this.mutate({ operation: 'createCakeQueue', parameters: { ...options, command }, rollback }, () => this.executeScript(command));
  }

  async getWirelessClients(): Promise<WirelessClientItem[]> {
    // Try v7 wifiwave2/wifi package first, then fallback to legacy wireless
    try {
      const wifiRes = await this.restRequest<WirelessClientItem[]>('/interface/wifi/registration-table', 'GET');
      if (Array.isArray(wifiRes) && wifiRes.length > 0) return wifiRes;
    } catch {
      // Fallback to legacy
    }

    try {
      const legRes = await this.restRequest<WirelessClientItem[]>('/interface/wireless/registration-table', 'GET');
      if (Array.isArray(legRes)) return legRes;
    } catch {
      // None
    }
    return [];
  }

  async getWebServerSettings(): Promise<WebServerSettings | null> {
    return this.restClient.getWebServerSettings();
  }

  async restRequest<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported REST method');
    if (!/^\/[a-zA-Z0-9_/*?.=,&%:-]*$/.test(endpoint) || endpoint.includes('..') || /%2e|%2f|%5c/i.test(endpoint)) throw new Error('Invalid RouterOS endpoint');
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body)) > 128 * 1024) throw new Error('REST body exceeds 128 KiB');
    if (method === 'GET') return this.restClient.request<T>(endpoint, method, body);
    return this.mutate({ operation: 'restRequest', parameters: { endpoint, method, body } }, async () => this.restClient.request<T>(endpoint, method, body)) as Promise<T>;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.restClient.close();
    await this.binaryClient.close();
  }
}
