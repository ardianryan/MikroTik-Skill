import fs from 'node:fs';
import { ConfigSanitizer } from '../safety/sanitizer.js';
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
  WebServerSettings,
} from './types.js';

export class RouterOsRestClient {
  private config: RouterConfig;
  private activeProtocol: 'https' | 'http';
  private activePort: number;
  private pending = new Set<AbortController>();
  private closed = false;

  constructor(config: RouterConfig) {
    this.config = config;
    this.activeProtocol = config.useSsl ? 'https' : 'http';
    this.activePort = config.restPort;
  }

  private getAuthHeader(): string {
    const creds = `${this.config.user}:${this.config.password}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  async request<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    if (this.closed) throw new Error('Router connection is closed');
    const controller = new AbortController();
    this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 6000);
    timeout.unref();
    const execute = async (protocol: 'https' | 'http', port: number): Promise<T> => {
      const url = `${protocol}://${this.config.host}:${port}/rest${endpoint}`;
      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      };

      const options: RequestInit = {
        method,
        redirect: 'error',
        headers,
        signal: controller.signal,
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = JSON.stringify(body);
      }

      if (protocol === 'https' && this.config.caFile) {
        return new Promise<T>((resolve, reject) => {
          const request = https.request(url, { method, headers, signal: controller.signal, ca: fs.readFileSync(this.config.caFile!), rejectUnauthorized: true }, (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4 * 1024 * 1024) response.destroy(new Error('Router response exceeds limit')); else chunks.push(chunk); });
            response.on('error', reject);
            response.on('end', () => {
              if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { reject(new Error(`RouterOS REST Error (${response.statusCode})`)); return; }
              try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve((response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text) as T);
              } catch { reject(new Error('Invalid router response')); }
            });
          });
          request.setTimeout(6000, () => request.destroy(new Error('Router request timed out')));
          request.on('error', reject);
          if (options.body) request.write(options.body);
          request.end();
        });
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('401 Unauthorized: Invalid Username or Password');
        }
        const errorText = await response.text();
        throw new Error(`RouterOS REST Error (${response.status}): ${ConfigSanitizer.sanitizeText(errorText)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      const text = await response.text();
      return text as unknown as T;
    };

    try {
      if (!/^\/[a-zA-Z0-9_/*?.=,&%:-]*$/.test(endpoint) || endpoint.includes('..') || /%2e|%2f|%5c/i.test(endpoint)) throw new Error('Invalid RouterOS endpoint');
      return await execute(this.activeProtocol, this.activePort);
    } finally { clearTimeout(timeout); this.pending.delete(controller); }
  }

  close(): void {
    this.closed = true;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
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

  async getClock(): Promise<{ date: string; time: string }> {
    return this.request('/system/clock');
  }

  async addScheduler(name: string, interval: string, onEvent: string, start: { 'start-date': string; 'start-time': string }): Promise<unknown> {
    return this.request('/system/scheduler', 'PUT', {
      name,
      interval,
      'on-event': onEvent,
      ...start,
    });
  }

  async removeScheduler(id: string): Promise<unknown> {
    return this.request(`/system/scheduler/${id}`, 'DELETE');
  }

  async getSchedulers(): Promise<Array<{ '.id'?: string; name: string; 'on-event'?: string; disabled?: string | boolean }>> {
    return this.request('/system/scheduler');
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

  async addDnsAdlist(url: string, sslVerify: boolean = true): Promise<unknown> {
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

  async getWebServerSettings(): Promise<WebServerSettings | null> {
    const res = await this.request<WebServerSettings | WebServerSettings[]>('/ip/service/webserver');
      if (Array.isArray(res)) {
        return res[0] ?? null;
      }
      return res ?? null;
  }
}

