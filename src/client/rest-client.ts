import https from 'node:https';
import type { RouterConfig } from '../config/profile.js';
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
  ContainerItem,
  AdlistItem,
  InterfaceTrafficMonitor,
} from './types.js';

export class RouterOsRestClient {
  private config: RouterConfig;
  private httpsAgent: https.Agent;
  private activeProtocol: 'https' | 'http';
  private activePort: number;

  constructor(config: RouterConfig) {
    this.config = config;
    this.activeProtocol = config.useSsl ? 'https' : 'http';
    this.activePort = config.restPort;
    this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  private getAuthHeader(): string {
    const creds = `${this.config.user}:${this.config.password}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  async request<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    const execute = async (protocol: 'https' | 'http', port: number): Promise<T> => {
      const url = `${protocol}://${this.config.host}:${port}/rest${endpoint}`;
      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      };

      const options: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(6000),
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = JSON.stringify(body);
      }

      if (protocol === 'https') {
        (options as RequestInit & { agent?: https.Agent }).agent = this.httpsAgent;
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('401 Unauthorized: Username atau Password Salah');
        }
        const errorText = await response.text();
        throw new Error(`RouterOS REST Error (${response.status}): ${errorText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      const text = await response.text();
      return text as unknown as T;
    };

    try {
      return await execute(this.activeProtocol, this.activePort);
    } catch (primaryErr) {
      if (this.activeProtocol === 'https' && (this.activePort === 443 || this.activePort === 8443)) {
        try {
          const fallbackPort = 80;
          const result = await execute('http', fallbackPort);
          this.activeProtocol = 'http';
          this.activePort = fallbackPort;
          return result;
        } catch {
          throw primaryErr;
        }
      }
      throw primaryErr;
    }
  }

  async getResource(): Promise<SystemResource> {
    return this.request<SystemResource>('/system/resource');
  }

  async getRouterBoard(): Promise<RouterBoard> {
    return this.request<RouterBoard>('/system/routerboard');
  }

  async getMangleRules(): Promise<MangleRule[]> {
    return this.request<MangleRule[]>('/ip/firewall/mangle');
  }

  async addMangleRule(rule: Partial<MangleRule>): Promise<unknown> {
    return this.request('/ip/firewall/mangle', 'PUT', rule);
  }

  async setMangleRule(id: string, patch: Partial<MangleRule>): Promise<unknown> {
    return this.request(`/ip/firewall/mangle/${id}`, 'PATCH', patch);
  }

  async removeMangleRule(id: string): Promise<unknown> {
    return this.request(`/ip/firewall/mangle/${id}`, 'DELETE');
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    return this.request<DhcpLease[]>('/ip/dhcp-server/lease');
  }

  async addDhcpLease(lease: Partial<DhcpLease>): Promise<unknown> {
    return this.request('/ip/dhcp-server/lease', 'PUT', lease);
  }

  async getRoutingTables(): Promise<RoutingTable[]> {
    return this.request<RoutingTable[]>('/routing/table');
  }

  async getFirewallFilters(): Promise<FirewallFilterRule[]> {
    return this.request<FirewallFilterRule[]>('/ip/firewall/filter');
  }

  async getIpServices(): Promise<IpService[]> {
    return this.request<IpService[]>('/ip/service');
  }

  async getNtpClient(): Promise<NtpClient> {
    return this.request<NtpClient>('/system/ntp/client');
  }

  async getDnsSettings(): Promise<DnsSettings> {
    return this.request<DnsSettings>('/ip/dns');
  }

  async getInterfaces(): Promise<InterfaceItem[]> {
    return this.request<InterfaceItem[]>('/interface');
  }

  async addScheduler(name: string, interval: string, onEvent: string): Promise<unknown> {
    return this.request('/system/scheduler', 'PUT', {
      name,
      interval,
      'on-event': onEvent,
    });
  }

  async removeScheduler(id: string): Promise<unknown> {
    return this.request(`/system/scheduler/${id}`, 'DELETE');
  }

  async getContainers(): Promise<ContainerItem[]> {
    return this.request<ContainerItem[]>('/container');
  }

  async restartContainer(id: string): Promise<unknown> {
    await this.request(`/container/stop`, 'POST', { numbers: id });
    return this.request(`/container/start`, 'POST', { numbers: id });
  }

  async getDnsAdlists(): Promise<AdlistItem[]> {
    return this.request<AdlistItem[]>('/ip/dns/adlist');
  }

  async addDnsAdlist(url: string, sslVerify: boolean = false): Promise<unknown> {
    return this.request('/ip/dns/adlist', 'PUT', {
      url,
      'ssl-verify': sslVerify ? 'yes' : 'no',
    });
  }

  async getInterfaceTraffic(interfaceName: string): Promise<InterfaceTrafficMonitor> {
    const res = await this.request<InterfaceTrafficMonitor[]>('/interface/monitor-traffic', 'POST', {
      interface: interfaceName,
      once: true,
    });
    return res[0] || { name: interfaceName };
  }

  async executeScript(script: string): Promise<unknown> {
    return this.request('/execute', 'POST', { script });
  }

  async exportConfig(options?: { compact?: boolean; file?: string }): Promise<unknown> {
    const payload: Record<string, string> = {};
    if (options?.compact !== false) {
      payload.compact = '';
    }
    if (options?.file) {
      payload.file = options.file;
    }
    return this.request('/export', 'POST', payload);
  }

  async moveRule(menu: string, id: string, destinationId: string): Promise<unknown> {
    const formattedMenu = menu.startsWith('/') ? menu : `/${menu}`;
    return this.request(`${formattedMenu}/move`, 'POST', {
      '.id': id,
      destination: destinationId,
    });
  }

  async queryMenu<T>(menu: string, options?: { proplist?: string[]; query?: string[] }): Promise<T[]> {
    const formattedMenu = menu.startsWith('/') ? menu : `/${menu}`;
    const payload: Record<string, unknown> = {};
    if (options?.proplist && options.proplist.length > 0) {
      payload['.proplist'] = options.proplist;
    }
    if (options?.query && options.query.length > 0) {
      payload['.query'] = options.query;
    }
    return this.request<T[]>(`${formattedMenu}/print`, 'POST', payload);
  }

  async getBridges(): Promise<BridgeItem[]> {
    return this.request<BridgeItem[]>('/interface/bridge');
  }

  async getIpv6Filters(): Promise<FirewallFilterRule[]> {
    return this.request<FirewallFilterRule[]>('/ipv6/firewall/filter');
  }
}

