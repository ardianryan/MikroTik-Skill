export interface SystemResource {
  uptime?: string;
  version?: string;
  'build-time'?: string;
  'factory-software'?: string;
  'free-memory'?: number | string;
  'total-memory'?: number | string;
  'cpu-load'?: number | string;
  'cpu-count'?: number | string;
  'free-hdd-space'?: number | string;
  'total-hdd-space'?: number | string;
  board?: string;
  platform?: string;
}

export interface RouterBoard {
  routerboard?: boolean | string;
  model?: string;
  'serial-number'?: string;
  'current-firmware'?: string;
  'upgrade-firmware'?: string;
}

export interface MangleRule {
  '.id'?: string;
  chain: string;
  action: string;
  comment?: string;
  disabled?: boolean | string;
  'src-address'?: string;
  'dst-address'?: string;
  'src-address-list'?: string;
  'dst-address-list'?: string;
  'connection-state'?: string;
  'connection-nat-state'?: string;
  'connection-mark'?: string;
  'new-connection-mark'?: string;
  'routing-mark'?: string;
  'new-routing-mark'?: string;
  passthrough?: boolean | string;
  'per-connection-classifier'?: string;
  'in-interface'?: string;
  'out-interface'?: string;
  'in-interface-list'?: string;
  'out-interface-list'?: string;
  protocol?: string;
  'dst-port'?: string;
}

export interface DhcpLease {
  '.id'?: string;
  address: string;
  'mac-address': string;
  'client-id'?: string;
  server?: string;
  'active-address'?: string;
  'active-mac-address'?: string;
  status?: string;
  dynamic?: boolean | string;
  disabled?: boolean | string;
  comment?: string;
  'host-name'?: string;
}

export interface RoutingTable {
  '.id'?: string;
  name: string;
  fib?: boolean | string;
  disabled?: boolean | string;
  comment?: string;
}

export interface FirewallFilterRule {
  '.id'?: string;
  chain: string;
  action: string;
  comment?: string;
  disabled?: boolean | string;
  protocol?: string;
  'dst-port'?: string;
  'in-interface'?: string;
  'in-interface-list'?: string;
  'connection-state'?: string;
}

export interface IpService {
  '.id'?: string;
  name: string;
  port: number | string;
  disabled?: boolean | string;
  address?: string;
}

export interface NtpClient {
  enabled?: boolean | string;
  mode?: string;
  servers?: string;
  'primary-ntp'?: string;
  'secondary-ntp'?: string;
  status?: string;
  synced?: boolean;
}

export interface DnsSettings {
  servers?: string;
  'allow-remote-requests'?: boolean | string;
  'cache-size'?: string;
}

export interface InterfaceItem {
  '.id'?: string;
  name: string;
  type?: string;
  running?: boolean | string;
  disabled?: boolean | string;
  comment?: string;
  macAddress?: string;
}

export interface BridgeItem {
  '.id'?: string;
  name: string;
  'protocol-mode'?: string;
  'vlan-filtering'?: boolean | string;
  disabled?: boolean | string;
  comment?: string;
}

export interface ContainerItem {
  '.id'?: string;
  name?: string;
  tag?: string;
  status?: string;
  interface?: string;
  'root-dir'?: string;
  comment?: string;
}

export interface AdlistItem {
  '.id'?: string;
  url: string;
  'ssl-verify'?: boolean | string;
  file?: string;
  disabled?: boolean | string;
}

export interface InterfaceTrafficMonitor {
  name: string;
  'rx-bits-per-second'?: number | string;
  'tx-bits-per-second'?: number | string;
  'rx-packets-per-second'?: number | string;
  'tx-packets-per-second'?: number | string;
}

export interface ConnectionTestResult {
  successful: boolean;
  transport: 'rest' | 'binary';
  host: string;
  port: number;
  routerOsVersion?: string;
  boardModel?: string;
  uptime?: string;
  latencyMs: number;
  error?: string;
}

export type AuditSeverity = 'PASS' | 'INFO' | 'WARN' | 'CRITICAL';

export interface AuditItem {
  id?: string;
  pillar: string;
  title: string;
  status: AuditSeverity;
  detail: string;
  recommendation?: string;
  remediationCommand?: string;
}

export interface AuditReport {
  timestamp: string;
  routerIdentity: string;
  firmwareVersion: string;
  overallScore: 'SECURE' | 'NEEDS_ATTENTION' | 'VULNERABLE';
  items: AuditItem[];
}

export interface LogItem {
  '.id'?: string;
  time?: string;
  topics?: string;
  message: string;
}

export interface PoeItem {
  '.id'?: string;
  name?: string;
  'poe-out'?: string;
  'poe-out-status'?: string;
  'poe-voltage'?: string;
  'poe-current'?: string | number;
  'poe-power'?: string | number;
  status?: string;
}

export interface QueueItem {
  '.id'?: string;
  name: string;
  target?: string;
  'max-limit'?: string;
  'queue'?: string;
  disabled?: boolean | string;
}

export interface WirelessClientItem {
  '.id'?: string;
  interface?: string;
  'mac-address'?: string;
  'signal-strength'?: string | number;
  'signal-to-noise'?: string | number;
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
  comment?: string;
}
