import { z } from 'zod';
import { isIP } from 'node:net';

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_TEXT_BYTES = 128 * 1024;
export function validateJsonBudget(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let elements = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.depth > 16 || ++elements > 4096) throw Object.assign(new Error('JSON structure exceeds limits'), { status: 400 });
    if (entry.value && typeof entry.value === 'object') {
      for (const child of Object.values(entry.value)) pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
}
export const ScriptSchema = z.string().min(1).max(MAX_TEXT_BYTES)
  .refine((value) => Buffer.byteLength(value) <= MAX_TEXT_BYTES, 'Text exceeds 128 KiB');
export const NameSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/);
export const AddressSchema = z.string().max(64).refine((value) => {
  const [address, mask, extra] = value.split('/');
  const family = isIP(address || '');
  return !extra && family !== 0 && (mask === undefined || (/^\d+$/.test(mask) && Number(mask) <= (family === 4 ? 32 : 128)));
}, 'Invalid IP address or CIDR');
export const RateSchema = z.string().regex(/^\d+(?:[kKMGT])?$/).max(16);
export const TextLabelSchema = z.string().max(256).refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const DnsNameSchema = z.string().min(1).max(253).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/);

export const PccSchema = z.object({
  wans: z.array(z.object({
    name: NameSchema,
    gateway: AddressSchema.optional(),
    weight: z.number().int().min(1).max(10_000).optional(),
    distance: z.number().int().min(1).max(255).optional(),
  }).strict()).min(2).max(16),
  lanInterface: NameSchema.optional(),
  classifier: z.enum(['both-addresses-and-ports', 'both-addresses', 'src-address', 'dst-address']).optional(),
  localBypassList: NameSchema.optional(),
}).strict().refine((value) => new Set(value.wans.map((wan) => wan.name)).size === value.wans.length, 'WAN names must be unique');

export const WireGuardSchema = z.object({
  clientName: TextLabelSchema.min(1),
  clientIp: AddressSchema,
  serverEndpoint: z.string().max(260).regex(/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/)
    .refine((value) => { const port = Number(value.slice(value.lastIndexOf(':') + 1)); return port >= 1 && port <= 65535; }, 'Endpoint port must be between 1 and 65535'),
  serverPublicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  interfaceName: NameSchema.optional(),
  dns: z.string().max(256).refine((v) => v.split(',').every((ip) => isIP(ip.trim()) !== 0)).optional(),
  allowedIps: z.string().max(1024).refine((v) => v.split(',').every((ip) => AddressSchema.safeParse(ip.trim()).success)).optional(),
  presharedKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/).optional(),
  persistentKeepalive: z.number().int().min(0).max(65535).optional(),
}).strict();

export const HotspotSchema = z.object({
  venueName: TextLabelSchema.optional(),
  model: z.enum(['voucher', 'member', 'dual', 'all-in-one']).optional(),
  enableTrial: z.boolean().optional(),
  trialUptime: z.string().regex(/^\d+(?:[smhd])$/).max(16).optional(),
  trialRateLimit: z.string().regex(/^\d+[kKMGT]?\/\d+[kKMGT]?$/).max(32).optional(),
  voucherRateLimit: z.string().regex(/^\d+[kKMGT]?\/\d+[kKMGT]?$/).max(32).optional(),
  googleAuthUrl: z.url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }).optional(),
  paymentGateway: z.enum(['midtrans', 'xendit', 'stripe', 'none']).optional(),
  dnsName: DnsNameSchema.optional(),
}).strict();

export const RoutingMarkSchema = z.object({
  routingMark: NameSchema,
  existingTables: z.array(NameSchema).max(256).optional(),
}).strict();

export const KnowledgeSchemas = {
  mikrotik_generate_template: z.object({ track: z.string().min(1).max(32) }).strict(),
  mikrotik_get_chat_prompt: z.object({}).strict(),
  mikrotik_sanitize_config: z.object({ configText: ScriptSchema }).strict(),
  mikrotik_validate_routing_mark: RoutingMarkSchema,
  mikrotik_calculate_pcc: PccSchema,
  mikrotik_provision_wireguard: WireGuardSchema,
  mikrotik_migrate_filter: z.object({ script: ScriptSchema }).strict(),
  mikrotik_lint_config: z.object({ script: ScriptSchema }).strict(),
  mikrotik_generate_hotspot_portal: HotspotSchema,
} satisfies Record<string, z.ZodType>;

export function parseKnowledgeArgs(name: string, args: unknown): Record<string, unknown> {
  validateJsonBudget(args);
  const schema = Object.hasOwn(KnowledgeSchemas, name) ? KnowledgeSchemas[name as keyof typeof KnowledgeSchemas] : undefined;
  if (!schema) throw new Error('Unknown knowledge tool');
  return schema.parse(args ?? {}) as Record<string, unknown>;
}

export function quoteRouterOs(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Control characters are not allowed in RouterOS values');
  return '"' + value.replace(/[\\"$]/g, '\\$&') + '"';
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const Controls = {
  targetDevice: NameSchema.optional(), dryRun: z.boolean().default(true),
  reason: TextLabelSchema.optional(), rollback: ScriptSchema.optional(),
  findingIds: z.array(z.string().regex(/^F-\d+$/)).max(100).optional(),
};
const MacSchema = z.string().regex(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/);
export const LocalSchemas = {
  mikrotik_test_connection: z.object({ ...Controls }).strict(),
  mikrotik_get_system_status: z.object({ ...Controls }).strict(),
  mikrotik_audit_security: z.object({ ...Controls }).strict(),
  mikrotik_list_mangle: z.object({ ...Controls }).strict(),
  mikrotik_export_sanitized_config: z.object({ ...Controls }).strict(),
  mikrotik_get_adlist_status: z.object({ ...Controls }).strict(),
  mikrotik_list_devices: z.object({ ...Controls }).strict(),
  mikrotik_get_wireless_clients: z.object({ ...Controls }).strict(),
  mikrotik_force_routing: z.object({ ...Controls, ip: AddressSchema, table: NameSchema, comment: TextLabelSchema.optional() }).strict(),
  mikrotik_manage_dhcp_lease: z.object({ ...Controls, action: z.enum(['list', 'add']), ip: AddressSchema.optional(), mac: MacSchema.optional(), comment: TextLabelSchema.optional() }).strict()
    .refine((v) => v.action !== 'add' || Boolean(v.ip && v.mac), 'IP and MAC are required for add'),
  mikrotik_manage_container: z.object({ ...Controls, action: z.enum(['list', 'restart']), id: NameSchema.optional() }).strict()
    .refine((v) => v.action !== 'restart' || Boolean(v.id), 'Container ID is required'),
  mikrotik_execute_command: z.object({ ...Controls, command: ScriptSchema }).strict(),
  mikrotik_rest_query: z.object({ ...Controls, endpoint: z.string().min(1).max(512), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'), body: z.unknown().optional() }).strict(),
  mikrotik_get_logs: z.object({ ...Controls, topics: z.array(z.string().min(1).max(64)).max(20).optional(), limit: z.number().int().min(1).max(500).optional() }).strict(),
  mikrotik_manage_poe: z.object({ ...Controls, action: z.enum(['status', 'power-cycle']), interface: NameSchema.optional() }).strict()
    .refine((v) => v.action !== 'power-cycle' || Boolean(v.interface), 'Interface is required'),
  mikrotik_manage_queues: z.object({ ...Controls, action: z.enum(['list', 'create-cake']), name: NameSchema.optional(), target: AddressSchema.optional(), upload: RateSchema.optional(), download: RateSchema.optional() }).strict()
    .refine((v) => v.action !== 'create-cake' || Boolean(v.name && v.target && v.upload && v.download), 'Queue parameters are required'),
} satisfies Record<string, z.ZodType>;

export function parseLocalArgs(name: string, args: unknown): Record<string, unknown> {
  validateJsonBudget(args);
  if (Object.hasOwn(KnowledgeSchemas, name)) {
    const record = z.object(Controls).passthrough().parse(args ?? {});
    const knowledge = Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(Controls, key)));
    return { ...parseKnowledgeArgs(name, knowledge), ...Object.fromEntries(Object.entries(record).filter(([key]) => Object.hasOwn(Controls, key))) };
  }
  if (!Object.hasOwn(LocalSchemas, name)) throw new Error('Unknown local tool');
  return LocalSchemas[name as keyof typeof LocalSchemas].parse(args ?? {}) as Record<string, unknown>;
}

export function toolInputSchema(name: string, local: boolean = false): { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown } {
  const schema = Object.hasOwn(KnowledgeSchemas, name) ? KnowledgeSchemas[name as keyof typeof KnowledgeSchemas] : local && Object.hasOwn(LocalSchemas, name) ? LocalSchemas[name as keyof typeof LocalSchemas] : undefined;
  if (!schema) throw new Error('Unknown tool schema');
  const json = z.toJSONSchema(schema, { io: 'input' });
  const controls = local ? z.toJSONSchema(z.object(Controls), { io: 'input' }) : undefined;
  return { ...json, type: 'object', properties: { ...json.properties, ...controls?.properties } };
}
