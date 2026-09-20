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
} from './types.js';

export class ConnectionManager {
  private config: RouterConfig;
  private restClient: RouterOsRestClient;
  private binaryClient: RouterOsBinaryClient;
  private preferredTransport: 'rest' | 'binary';
  private verifiedTransport: 'rest' | 'binary' | null = null;

  constructor(config: RouterConfig) {
    this.config = config;
    this.restClient = new RouterOsRestClient(config);
    this.binaryClient = new RouterOsBinaryClient(config);
    this.preferredTransport = config.preferBinary ? 'binary' : 'rest';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

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
            error: binaryErr instanceof Error ? binaryErr.message : String(binaryErr),
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
            error: binaryErr instanceof Error ? binaryErr.message : String(binaryErr),
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
    if (this.verifiedTransport === 'binary') {
      try {
        return await binaryFn(this.binaryClient);
      } catch (err) {
        return await restFn(this.restClient);
      }
    }

    try {
      return await restFn(this.restClient);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('RouterOS REST Error (4') || errMsg.includes('RouterOS REST Error (5')) {
        throw err;
      }
      this.verifiedTransport = 'binary';
      return await binaryFn(this.binaryClient);
    }
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
    return this.executeWithFallback(
      (c) => c.addMangleRule(rule),
      (c) => c.addMangleRule(rule)
    );
  }

  async setMangleRule(id: string, patch: Partial<MangleRule>): Promise<unknown> {
    return this.executeWithFallback(
      (c) => c.setMangleRule(id, patch),
      (c) => c.setMangleRule(id, patch)
    );
  }

  async removeMangleRule(id: string): Promise<unknown> {
    return this.executeWithFallback(
      (c) => c.removeMangleRule(id),
      (c) => c.removeMangleRule(id)
    );
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    return this.executeWithFallback(
      (c) => c.getDhcpLeases(),
      (c) => c.getDhcpLeases()
    );
  }

  async addDhcpLease(lease: Partial<DhcpLease>): Promise<unknown> {
    return this.executeWithFallback(
      (c) => c.addDhcpLease(lease),
      (c) => c.addDhcpLease(lease)
    );
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
    return this.executeWithFallback(
      (c) => c.addScheduler(name, interval, onEvent),
      (c) => c.addScheduler(name, interval, onEvent)
    );
  }

  async removeScheduler(idOrName: string): Promise<unknown> {
    return this.executeWithFallback(
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
    return this.executeWithFallback(
      (c) => c.restartContainer(nameOrId),
      (c) => c.restartContainer(nameOrId)
    );
  }

  async getDnsAdlists(): Promise<AdlistItem[]> {
    return this.executeWithFallback(
      (c) => c.getDnsAdlists(),
      (c) => c.getDnsAdlists()
    );
  }

  async addDnsAdlist(url: string, sslVerify?: boolean): Promise<unknown> {
    return this.executeWithFallback(
      (c) => c.addDnsAdlist(url, sslVerify),
      (c) => c.addDnsAdlist(url, sslVerify)
    );
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
    return this.executeWithFallback(
      (c) => c.executeScript(script),
      (c) => c.executeScript(script)
    );
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
        return filtered.slice(-limit);
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
    const cleanIface = interfaceName.replace(/[^a-zA-Z0-9_-]/g, '');
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
    const cmd =
      `/queue type add name=cake-default kind=cake comment="CAKE SQM"; ` +
      `/queue simple add name="${options.name}" target=${options.target} max-limit=${options.upload}/${options.download} queue=cake-default/cake-default comment="CAKE Smart Queue"`;
    return this.executeScript(cmd);
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

  async restRequest<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    return this.restClient.request<T>(endpoint, method, body);
  }

  async close(): Promise<void> {
    await this.binaryClient.close();
  }
}
