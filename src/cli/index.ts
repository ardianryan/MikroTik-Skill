#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { createCliContext } from './common.js';
import { registerCoreCommands } from './commands/core.js';
import { registerNetworkCommands } from './commands/network.js';
import { registerToolCommands } from './commands/tools.js';
import { registerServerCommands } from './commands/server.js';
import { runTui } from '../tui/index.js';
import { getFleetDevice } from '../config/fleet.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';

const program = new Command();
let commandOptions: Record<string, unknown> = {};
program.hook('preAction', (_command, action) => {
  commandOptions = action.optsWithGlobals();
});

program
  .name('mtik')
  .description('MikroTik RouterOS v7 Production Automation & Management CLI')
  .version('1.3.0')
  .option('-d, --device <name>', 'Target specific router from fleet inventory or profile')
  .option('--apply', 'Apply after interactive review', false)
  .option('--reason <text>', 'Reason for a manual mutation')
  .option('--findings <ids>', 'Comma-separated audit finding IDs')
  .option('--rollback <script>', 'Explicit RouterOS rollback script');

const ctx = createCliContext(() => commandOptions);

registerCoreCommands(program, ctx);
registerNetworkCommands(program, ctx);
registerToolCommands(program, ctx);
registerServerCommands(program, ctx);

if (process.argv.length <= 2 && process.stdin.isTTY) {
  runTui().catch((err) => {
    console.error(chalk.red(`TUI Error: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
    process.exit(1);
  });
} else if (process.argv.length === 3 && process.stdin.isTTY) {
  const candidate = process.argv[2] || '';
  const knownCommands = [
    'test', 'status', 'audit', 'mangle', 'route-force', 'lease', 'backup', 'monitor',
    'container', 'adlist', 'profile', 'install-mcp', 'mcp', 'template', 'generate',
    'exec', 'run', 'rest', 'prompt', 'serve', 'openapi', 'pcc', 'hotspot', 'wireguard',
    'migrate-filter', 'lint', 'devices', 'inventory', 'logs', 'poe', 'queue', 'wifi',
    'wireless', 'tui', 'ui', 'fleet', 'help', '--help', '-h', '--version', '-V'
  ];

  if (!candidate.startsWith('-') && !knownCommands.includes(candidate)) {
    const fleetDev = getFleetDevice(candidate);
    if (fleetDev) {
      runTui({ device: candidate }).catch((err) => {
        console.error(chalk.red(`TUI Error: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exit(1);
      });
    } else {
      program.parse(process.argv);
    }
  } else {
    program.parse(process.argv);
  }
} else {
  program.parse(process.argv);
}
