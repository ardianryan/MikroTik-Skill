import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { RouterOSAPI } from 'node-routeros';
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

export class RouterOsBinaryClient {
  private config: RouterConfig;
  private api: RouterOSAPI | null = null;
  private isConnected = false;

  constructor(config: RouterConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.api) {
      return;
    }

    const port = this.config.useSsl ? this.config.apiSslPort : this.config.apiPort;
    this.api = new RouterOSAPI({
      host: this.config.host,
      user: this.config.user,
      password: this.config.password,
      port,
      tls: this.config.useSsl ? { rejectUnauthorized: true, ...(this.config.caFile ? { ca: fs.readFileSync(this.config.caFile) } : {}) } : undefined,
      timeout: 10,
    });

    await this.api.connect();
    this.isConnected = true;
  }

  async close(): Promise<void> {
    if (this.api && this.isConnected) {
      const api = this.api;
      this.isConnected = false;
      this.api = null;
      await api.close();
    }
  }

  private async writeQuery<T>(command: string, params?: Record<string, string>): Promise<T[]> {
    await this.connect();
    if (!this.api) {
      throw new Error('RouterOS binary API is not connected');
    }

    const commandParts: string[] = [command];
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        commandParts.push(`?${key}=${value}`);
      }
    }

    const result = await this.api.write(commandParts);
    return result as T[];
  }

  async getResource(): Promise<SystemResource> {
    const res = await this.writeQuery<SystemResource>('/system/resource/print');
    return res[0] || {};
  }

  async getRouterBoard(): Promise<RouterBoard> {
    const res = await this.writeQuery<RouterBoard>('/system/routerboard/print');
    return res[0] || {};
  }

  async getMangleRules(): Promise<MangleRule[]> {
    return this.writeQuery<MangleRule>('/ip/firewall/mangle/print');
  }

  async addMangleRule(rule: Partial<MangleRule>): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    const parts: string[] = ['/ip/firewall/mangle/add'];
    for (const [key, val] of Object.entries(rule)) {
      if (val !== undefined && key !== '.id') {
        parts.push(`=${key}=${val}`);
      }
    }
    return this.api.write(parts);
  }

  async setMangleRule(id: string, patch: Partial<MangleRule>): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    const parts: string[] = ['/ip/firewall/mangle/set', `=numbers=${id}`];
    for (const [key, val] of Object.entries(patch)) {
      if (val !== undefined && key !== '.id') {
        parts.push(`=${key}=${val}`);
      }
    }
    return this.api.write(parts);
  }

  async removeMangleRule(id: string): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    return this.api.write(['/ip/firewall/mangle/remove', `=numbers=${id}`]);
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    return this.writeQuery<DhcpLease>('/ip/dhcp-server/lease/print');
  }

  async addDhcpLease(lease: Partial<DhcpLease>): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    const parts: string[] = ['/ip/dhcp-server/lease/add'];
    for (const [key, val] of Object.entries(lease)) {
      if (val !== undefined && key !== '.id') {
        parts.push(`=${key}=${val}`);
      }
    }
    return this.api.write(parts);
  }

  async getRoutingTables(): Promise<RoutingTable[]> {
    return this.writeQuery<RoutingTable>('/routing/table/print');
  }

  async getFirewallFilters(): Promise<FirewallFilterRule[]> {
    return this.writeQuery<FirewallFilterRule>('/ip/firewall/filter/print');
  }

  async getIpServices(): Promise<IpService[]> {
    return this.writeQuery<IpService>('/ip/service/print');
  }

  async getNtpClient(): Promise<NtpClient> {
    const res = await this.writeQuery<NtpClient>('/system/ntp/client/print');
    return res[0] || {};
  }

  async getDnsSettings(): Promise<DnsSettings> {
    const res = await this.writeQuery<DnsSettings>('/ip/dns/print');
    return res[0] || {};
  }

  async getInterfaces(): Promise<InterfaceItem[]> {
    return this.writeQuery<InterfaceItem>('/interface/print');
  }

  async getClock(): Promise<{ date: string; time: string }> {
    const rows = await this.writeQuery<{ date: string; time: string }>('/system/clock/print');
    if (!rows[0]) throw new Error('Router clock is unavailable');
    return rows[0];
  }

  async addScheduler(name: string, interval: string, onEvent: string, start: { 'start-date': string; 'start-time': string }): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    return this.api.write([
      '/system/scheduler/add',
      `=name=${name}`,
      `=interval=${interval}`,
      `=on-event=${onEvent}`,
      `=start-date=${start['start-date']}`,
      `=start-time=${start['start-time']}`,
    ]);
  }

  async removeScheduler(name: string): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    return this.api.write(['/system/scheduler/remove', `=numbers=${name}`]);
  }

  async exportConfig(): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    return this.api.write(['/export', '=compact=']);
  }

  async getSchedulers(): Promise<Array<{ '.id'?: string; name: string; 'on-event'?: string; disabled?: string | boolean }>> {
    return this.writeQuery('/system/scheduler/print');
  }

  async getContainers(): Promise<ContainerItem[]> {
    return this.writeQuery<ContainerItem>('/container/print');
  }

  async restartContainer(nameOrId: string): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    await this.api.write(['/container/stop', `=numbers=${nameOrId}`]);
    return this.api.write(['/container/start', `=numbers=${nameOrId}`]);
  }

  async getDnsAdlists(): Promise<AdlistItem[]> {
    return this.writeQuery<AdlistItem>('/ip/dns/adlist/print');
  }

  async addDnsAdlist(url: string, sslVerify: boolean = true): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    return this.api.write([
      '/ip/dns/adlist/add',
      `=url=${url}`,
      `=ssl-verify=${sslVerify ? 'yes' : 'no'}`,
    ]);
  }

  async getInterfaceTraffic(interfaceName: string): Promise<InterfaceTrafficMonitor> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    const res = await this.api.write([
      '/interface/monitor-traffic',
      `=interface=${interfaceName}`,
      '=once=',
    ]);
    const row = res[0] as InterfaceTrafficMonitor | undefined;
    return row || { name: interfaceName };
  }

  async getBridges(): Promise<BridgeItem[]> {
    return this.writeQuery<BridgeItem>('/interface/bridge/print');
  }

  async getIpv6Filters(): Promise<FirewallFilterRule[]> {
    return this.writeQuery<FirewallFilterRule>('/ipv6/firewall/filter/print');
  }

  async executeScript(script: string): Promise<unknown> {
    await this.connect();
    if (!this.api) throw new Error('Not connected');
    const tempName = `mtik_tmp_${randomUUID().replaceAll('-', '')}`;
    await this.api.write(['/system/script/add', `=name=${tempName}`, `=source=${script}`]);
    try {
      return await this.api.write(['/system/script/run', `=numbers=${tempName}`]);
    } finally {
      await this.api.write(['/system/script/remove', `=numbers=${tempName}`]).catch(() => {});
    }
  }
}
