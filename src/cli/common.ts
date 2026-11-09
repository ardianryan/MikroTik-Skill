import { createInterface } from 'node:readline/promises';
import { getDeviceConfig } from '../config/profile.js';
import type { MutationOptions } from '../safety/mutation.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';

export interface CliContext {
  getCommandOptions: () => Record<string, unknown>;
  activeConfig: () => ReturnType<typeof getDeviceConfig>;
  cliMutationOptions: (config: ReturnType<typeof getDeviceConfig>, device?: string) => MutationOptions;
  reportMutation: (result: Promise<unknown>) => Promise<boolean>;
}

export function createCliContext(getCommandOptions: () => Record<string, unknown>): CliContext {
  const activeConfig = () => getDeviceConfig(getCommandOptions().device as string | undefined);

  const cliMutationOptions = (config: ReturnType<typeof getDeviceConfig>, device?: string): MutationOptions => {
    const options = getCommandOptions();
    return {
      dryRun: options.apply !== true || options.dryRun === true,
      reason: options.reason as string | undefined,
      findingIds: typeof options.findings === 'string' ? options.findings.split(',').map((id: string) => id.trim()) : undefined,
      rollback: options.rollback as string | undefined,
      checkTarget: () => {
        if (JSON.stringify(getDeviceConfig(device)) !== JSON.stringify(config)) {
          throw new Error('Selected target changed during review');
        }
      },
      confirm: async (preview) => {
        console.log(preview);
        if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try {
          return (await terminal.question('Apply this exact operation? Type APPLY: ')).trim() === 'APPLY';
        } finally {
          terminal.close();
        }
      },
    };
  };

  const reportMutation = async (result: Promise<unknown>): Promise<boolean> => {
    const value = await result;
    console.log(JSON.stringify(ConfigSanitizer.sanitizeJson(value), null, 2));
    return typeof value === 'object' && value !== null && 'status' in value && value.status === 'DRY_RUN_SUCCESS';
  };

  return {
    getCommandOptions,
    activeConfig,
    cliMutationOptions,
    reportMutation,
  };
}
