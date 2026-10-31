import { createHash, randomUUID } from 'node:crypto';
import type { ConnectionManager } from '../client/connection-manager.js';
import type { RouterConfig } from '../config/profile.js';
import { SecurityAuditor } from './auditor.js';
import { ConfigSanitizer } from './sanitizer.js';
import { SafeModeWatchdog } from './watchdog.js';
import { ScriptSchema, TextLabelSchema } from './validation.js';

export interface MutationOptions {
  dryRun?: boolean;
  reason?: string;
  findingIds?: string[];
  rollback?: string;
  confirm?: (preview: string) => Promise<boolean>;
  checkTarget?: () => void;
}

export interface MutationSpec {
  operation: string;
  parameters: unknown;
  rollback?: string;
}

const targetLocks = new Map<string, Promise<void>>();

async function withTargetLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = targetLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  targetLocks.set(key, current);
  await previous;
  try { return await action(); }
  finally { release(); if (targetLocks.get(key) === current) targetLocks.delete(key); }
}

export async function guardMutation(
  conn: ConnectionManager,
  config: RouterConfig,
  options: MutationOptions,
  spec: MutationSpec,
  apply: () => Promise<unknown>,
  privileged: (action: () => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
  if (options.reason !== undefined) TextLabelSchema.parse(options.reason);
  const rollback = spec.rollback || options.rollback;
  if (rollback) ScriptSchema.parse(rollback);
  const audit = await new SecurityAuditor(conn).runFullAudit();
  const selected = options.findingIds ?? [];
  if (selected.some((id) => !audit.items.some((item) => item.id === id))) throw new Error('Selected audit finding does not exist');
  const state = await conn.getConfigurationSnapshot();
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const before = digest(state);
  const binding = digest({ config, spec, rollback, before });
  const preview = JSON.stringify(ConfigSanitizer.sanitizeJson({
    audit,
    selectedFindings: selected,
    reason: options.reason,
    target: { host: config.host, user: config.user, port: config.preferBinary ? (config.useSsl ? config.apiSslPort : config.apiPort) : config.restPort },
    operation: spec.operation,
    parameters: spec.parameters,
    rollback,
    reviewId: randomUUID(),
    warning: 'Raw script rollback is supplied by the operator; execution is not an atomic transaction.',
  }), null, 2);
  if (options.dryRun !== false) return { status: 'DRY_RUN_SUCCESS', preview };
  if (!rollback) throw new Error('A rollback script is required before applying this operation');
  if (!selected.length && !options.reason?.trim()) throw new Error('Select audit findings or provide a manual operation reason');
  if (audit.overallScore === 'INCOMPLETE') throw new Error('Required audit reads failed; apply is blocked');
  if (!options.confirm || !await options.confirm(preview)) throw new Error('Interactive approval was not granted; use dry-run or an interactive CLI');
  return withTargetLock(JSON.stringify([config.host, config.restPort, config.apiPort, config.apiSslPort]), async () => {
  options.checkTarget?.();
  if (before !== digest(await conn.getConfigurationSnapshot()) || binding !== digest({ config, spec, rollback, before })) {
    throw new Error('Router state or operation changed after review; generate a new preview');
  }
  return privileged(async () => {
    const watchdog = new SafeModeWatchdog(conn);
    await watchdog.arm(rollback, 30);
    let result: unknown;
    try { result = await apply(); }
    catch { throw new Error('Mutation failed or its result is uncertain; armed rollback remains pending and has not been verified'); }
    if (!(await conn.testConnection()).successful) throw new Error('Post-flight health check failed; rollback is pending, not verified');
    if (!await watchdog.disarm()) throw new Error('Watchdog disarm failed; rollback may still execute');
    return ConfigSanitizer.sanitizeJson(result);
  });
  });
}
