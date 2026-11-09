import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { type Command } from 'commander';
import chalk from 'chalk';
import type { CliContext } from '../common.js';
import { loadRouterConfig, sanitizeConfig, saveProfile, listProfiles, setActiveProfile, listAllDevices } from '../../config/profile.js';
import { ConnectionManager } from '../../client/connection-manager.js';
import { SecurityAuditor } from '../../safety/auditor.js';
import { ConfigSanitizer } from '../../safety/sanitizer.js';
import { formatBatchDiff, type DiffEntry } from '../../safety/diff.js';
import { McpInstaller, type IdeTarget } from '../../mcp/installer.js';
import { runTui } from '../../tui/index.js';
import { getFleetStore, addFleetDevice, removeFleetDevice, setActiveFleetDevice } from '../../config/fleet.js';

export function registerCoreCommands(program: Command, ctx: CliContext): void {
  program
    .command('login')
    .description('Verify credentials and test connection to the active router.')
    .action(async () => {
      const config = ctx.activeConfig();
      const safeCfg = sanitizeConfig(config);
      console.log(chalk.blue(`Authenticating to: ${safeCfg.host} (User: ${safeCfg.user})...`));

      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      try {
        const result = await conn.testConnection();
        if (result.successful) {
          console.log(chalk.green('✓ Authentication successful!'));
          console.log(`  Transport : ${chalk.bold(result.transport.toUpperCase())} (Port ${result.port})`);
          console.log(`  RouterOS  : ${result.routerOsVersion || 'v7.x'}`);
          console.log(`  Hardware  : ${result.boardModel || 'Unknown'}`);
          console.log(`  Uptime    : ${result.uptime || 'Unknown'}`);
          console.log(`  Latency   : ${result.latencyMs} ms`);
        } else {
          console.error(chalk.red(`✗ Authentication failed: ${result.error || 'Unknown error'}`));
          process.exitCode = 1;
        }
      } finally {
        await conn.close();
      }
    });

  program
    .command('test')
    .description('Test connectivity and transport detection (REST API vs Native API Port 8728).')
    .action(async () => {
      const config = ctx.activeConfig();
      const safeCfg = sanitizeConfig(config);
      console.log(chalk.blue(`Target: ${safeCfg.host} (User: ${safeCfg.user})`));

      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      try {
        const result = await conn.testConnection();
        if (result.successful) {
          console.log(chalk.green('Connection verified:'));
          console.log(`  Transport : ${chalk.bold(result.transport.toUpperCase())} (Port ${result.port})`);
          console.log(`  RouterOS  : ${result.routerOsVersion || 'v7.x'}`);
          console.log(`  Hardware  : ${result.boardModel || 'Unknown'}`);
          console.log(`  Uptime    : ${result.uptime || 'Unknown'}`);
          console.log(`  Latency   : ${result.latencyMs} ms`);
        } else {
          console.error(chalk.red(`Connection failed: ${result.error || 'Unknown error'}`));
          process.exitCode = 1;
        }
      } finally {
        await conn.close();
      }
    });

  program
    .command('status')
    .description('Show router health, resource utilization, and interface overview.')
    .action(async () => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      try {
        const [resource, ifaces, leases] = await Promise.all([
          conn.getResource(),
          conn.getInterfaces().catch(() => []),
          conn.getDhcpLeases().catch(() => []),
        ]);

        console.log(chalk.cyan.bold('\n=== MikroTik RouterOS v7 Status ==='));
        console.log(`Router Model  : ${resource.board || resource.platform || 'MikroTik'}`);
        console.log(`Firmware Ver  : ${resource.version || 'v7.x'}`);
        console.log(`Uptime        : ${resource.uptime || 'N/A'}`);
        console.log(`CPU Load      : ${resource['cpu-load'] || 0}% (${resource['cpu-count'] || 1} cores)`);
        console.log(`Memory Free   : ${Math.round(Number(resource['free-memory'] || 0) / 1024 / 1024)} MB / ${Math.round(Number(resource['total-memory'] || 0) / 1024 / 1024)} MB`);
        console.log(`Interfaces    : ${ifaces.length} total (${ifaces.filter((i) => i.running === true || i.running === 'true').length} running)`);
        console.log(`DHCP Leases   : ${leases.length} active leases\n`);
      } catch (err) {
        console.error(chalk.red(`Failed to fetch status: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });

  program
    .command('audit')
    .description('Execute automated 7-Pillar Security & Configuration Audit on RouterOS v7.')
    .option('-f, --format <type>', 'Report format: text or markdown', 'text')
    .option('-o, --output <file>', 'Save audit report to file')
    .action(async (options: { format?: string; output?: string }) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      const auditor = new SecurityAuditor(conn);

      try {
        if (options.format !== 'markdown') {
          console.log(chalk.blue('Running 7-Pillar Security Audit...'));
        }
        const report = await auditor.runFullAudit();

        if (options.format === 'markdown') {
          const md = SecurityAuditor.formatMarkdownReport(report);
          if (options.output) {
            fs.writeFileSync(options.output, md, 'utf8');
            console.log(chalk.green(`Audit report saved to: ${options.output}`));
          } else {
            console.log(md);
          }
          return;
        }

        console.log(chalk.bold(`\nAudit Report for ${report.routerIdentity} (${report.firmwareVersion})`));
        console.log(`Status: ${report.overallScore === 'SECURE' ? chalk.green('SECURE') : report.overallScore === 'VULNERABLE' ? chalk.red('VULNERABLE') : chalk.yellow(report.overallScore.replaceAll('_', ' '))}\n`);

        for (const item of report.items) {
          let badge = chalk.green('[PASS]');
          if (item.status === 'WARN') badge = chalk.yellow('[WARN]');
          if (item.status === 'CRITICAL') badge = chalk.red('[CRIT]');
          if (item.status === 'INFO') badge = chalk.blue('[INFO]');
          if (item.status === 'UNKNOWN') badge = chalk.yellow('[UNKNOWN]');

          const idPrefix = item.id ? chalk.cyan(`[${item.id}] `) : '';
          console.log(`${idPrefix}${badge} ${chalk.bold(item.title)}: ${item.detail}`);
          if (item.remediationCommand) {
            console.log(`       ${chalk.gray('Fix: ' + item.remediationCommand)}`);
          }
        }
        console.log('');

        if (options.output) {
          const md = SecurityAuditor.formatMarkdownReport(report);
          fs.writeFileSync(options.output, md, 'utf8');
          console.log(chalk.green(`Audit report markdown copy saved to: ${options.output}`));
        }
      } catch (err) {
        console.error(chalk.red(`Audit execution failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });

  program
    .command('use <name>')
    .description('Switch active router target in fleet store (~/.mikrotik-skill/fleet.json).')
    .action((name: string) => {
      const success = setActiveFleetDevice(name) || setActiveProfile(name);
      if (success) {
        console.log(chalk.green(`✓ Switched active router target to '${name}'.`));
      } else {
        console.error(chalk.red(`Error: Router '${name}' not found in fleet store.`));
        process.exitCode = 1;
      }
    });

  program
    .command('fix [findingId]')
    .description('Interactively review and apply remediation for a specific audit finding (e.g. F-14).')
    .option('--dry-run', 'Preview changes without executing', false)
    .action(async (findingId?: string, options?: { dryRun?: boolean }) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      const auditor = new SecurityAuditor(conn);

      try {
        console.log(chalk.blue('Running security audit to discover remediations...'));
        const report = await auditor.runFullAudit();

        if (!findingId) {
          const actionable = report.items.filter((i) => i.remediationCommand && (i.status === 'CRITICAL' || i.status === 'WARN'));
          if (actionable.length === 0) {
            console.log(chalk.green('✓ All audited pillars are compliant! No remediation needed.'));
            return;
          }
          console.log(chalk.bold(`\nActionable Findings (${actionable.length} available):`));
          for (const item of actionable) {
            const badge = item.status === 'CRITICAL' ? chalk.red('[CRIT]') : chalk.yellow('[WARN]');
            console.log(`  ${chalk.cyan(item.id || '-')} ${badge} ${chalk.bold(item.title)}: ${item.detail}`);
            console.log(`       ${chalk.gray('Remediation: ' + item.remediationCommand)}\n`);
          }
          console.log(chalk.gray('To fix a specific finding, run: mtik fix <ID> (e.g. mtik fix F-14)'));
          return;
        }

        const item = report.items.find((i) => i.id?.toLowerCase() === findingId.toLowerCase());
        if (!item) {
          console.error(chalk.red(`Finding ID '${findingId}' not found in audit report.`));
          process.exitCode = 1;
          return;
        }

        if (!item.remediationCommand) {
          console.log(chalk.yellow(`Finding [${item.id}] "${item.title}" does not have an automated remediation command.`));
          return;
        }

        console.log(chalk.cyan.bold(`\nTarget Finding: [${item.id}] ${item.title} (${item.status})`));
        console.log(`Detail: ${item.detail}`);
        console.log(`Proposed Command: ${chalk.green(item.remediationCommand)}\n`);

        const diff: DiffEntry[] = [
          {
            type: 'MODIFY',
            target: `/remediation/${item.id}`,
            details: { command: item.remediationCommand },
            previous: { status: item.status, detail: item.detail },
          },
        ];
        console.log(formatBatchDiff(diff));

        if (options?.dryRun) {
          console.log(chalk.yellow('Dry-run mode: mutation simulated safely. No changes applied.'));
          return;
        }

        if (!process.stdin.isTTY) {
          console.error(chalk.red('Interactive TTY required to confirm remediation.'));
          process.exitCode = 1;
          return;
        }

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question(chalk.yellow.bold('Apply this remediation with 30s safe-mode watchdog? Type APPLY: '))).trim();
        rl.close();

        if (answer !== 'APPLY') {
          console.log(chalk.gray('Remediation aborted by user.'));
          return;
        }

        console.log(chalk.blue('Arming 30-second watchdog and applying remediation...'));
        await conn.executeScript(item.remediationCommand);
        console.log(chalk.green(`✓ Successfully applied remediation for [${item.id}]!`));
      } catch (err) {
        console.error(chalk.red(`Remediation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });

  program
    .command('profile')
    .description('Manage and switch multiple router target profiles.')
    .option('-l, --list', 'List stored router profiles', true)
    .option('--switch <name>', 'Switch active target profile')
    .option('--save <name>', 'Save current environment as a named profile')
    .action(async (opts) => {
      try {
        if (opts.save) {
          const currentCfg = ctx.activeConfig();
          saveProfile(opts.save, currentCfg, true);
          console.log(chalk.green(`Profile '${opts.save}' saved successfully as active profile.\n`));
        } else if (opts.switch) {
          const success = setActiveProfile(opts.switch);
          if (success) {
            console.log(chalk.green(`Switched active profile to '${opts.switch}'.\n`));
          } else {
            console.error(chalk.red(`Profile '${opts.switch}' not found.`));
            process.exitCode = 1;
          }
        } else {
          const profiles = listProfiles();
          console.log(chalk.bold(`\nStored Router Profiles (${profiles.length} total):`));
          if (profiles.length === 0) {
            console.log(chalk.gray('No stored profiles. Run: mtik profile --save <name> to store one.'));
          } else {
            profiles.forEach((p) => {
              const marker = p.active ? chalk.green('★ [ACTIVE]') : chalk.gray('  [INACTIVE]');
              console.log(`${marker} ${chalk.bold(p.name.padEnd(16, ' '))} -> ${p.host} (${p.user})`);
            });
          }
          console.log('');
        }
      } catch (err) {
        console.error(chalk.red(`Profile operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      }
    });

  program
    .command('fleet')
    .description('Manage multi-router fleet inventory (~/.mikrotik-skill/fleet.json).')
    .argument('[action]', 'Action: list, add, switch, remove', 'list')
    .argument('[name]', 'Router name identifier')
    .argument('[host]', 'Router IP or domain')
    .action((action, name, host) => {
      const store = getFleetStore();

      if (action === 'list') {
        console.log(chalk.cyan.bold('\n=== Multi-Router Fleet Inventory (~/.mikrotik-skill/fleet.json) ===\n'));
        if (store.devices.length === 0) {
          console.log(chalk.gray('No routers registered yet. Run `mtik` to launch TUI wizard or `mtik fleet add <name> <host>`.'));
        } else {
          store.devices.forEach((d) => {
            const isActive = d.name === store.activeDevice;
            const badge = isActive ? chalk.bgGreen.black.bold(' ACTIVE ') : chalk.gray(' IDLE   ');
            console.log(`  ${badge} ${chalk.white.bold(d.name.padEnd(16, ' '))} ${chalk.cyan(`${d.host}:${d.port}`)} (user: ${d.user}) [${d.model || 'MikroTik'}]`);
          });
        }
        console.log('');
        return;
      }

      if (action === 'add') {
        if (!name || !host) {
          console.error(chalk.red('Usage: mtik fleet add <name> <host>'));
          process.exitCode = 1;
          return;
        }
        const dev = addFleetDevice({ name, host, user: 'admin', port: 443 });
        console.log(chalk.green(`✓ Router '${dev.name}' added to fleet and set as active target!`));
        return;
      }

      if (action === 'switch') {
        if (!name) {
          console.error(chalk.red('Usage: mtik fleet switch <name>'));
          process.exitCode = 1;
          return;
        }
        const success = setActiveFleetDevice(name);
        if (success) {
          console.log(chalk.green(`✓ Switched active router to '${name}'.`));
        } else {
          console.error(chalk.red(`Error: Router '${name}' not found in fleet.`));
          process.exitCode = 1;
        }
        return;
      }

      if (action === 'remove') {
        if (!name) {
          console.error(chalk.red('Usage: mtik fleet remove <name>'));
          process.exitCode = 1;
          return;
        }
        const success = removeFleetDevice(name);
        if (success) {
          console.log(chalk.green(`✓ Router '${name}' removed from fleet.`));
        } else {
          console.error(chalk.red(`Error: Router '${name}' not found in fleet.`));
          process.exitCode = 1;
        }
        return;
      }

      console.error(chalk.red(`Unknown action: ${action}. Use: list, add, switch, remove`));
      process.exitCode = 1;
    });

  program
    .command('devices')
    .description('List all available router targets across fleet, inventory, and profiles.')
    .action(() => {
      const devices = listAllDevices();
      console.log(chalk.cyan.bold('\n=== Available MikroTik Router Targets ===\n'));
      if (devices.length === 0) {
        console.log(chalk.gray('No router devices discovered in inventory or profiles.'));
      } else {
        devices.forEach((d) => {
          const srcBadge = chalk.magenta(`[${d.source.toUpperCase()}]`);
          console.log(`  ${srcBadge} ${chalk.white.bold(d.name.padEnd(16, ' '))} ${chalk.cyan(`${d.host}:${d.port}`)} (${d.user}) via ${d.transport}`);
        });
      }
      console.log('');
    });

  program
    .command('install-mcp')
    .description('Install and configure MikroTik MCP server into your IDE (Antigravity, Cursor, Claude, Windsurf, or all).')
    .option('-t, --target <ide>', 'Target IDE: antigravity | cursor | claude | windsurf | all', 'all')
    .option('--no-global', 'Use direct node script path instead of global mtik-mcp binary')
    .option('--with-env', 'Include credentials from current .env in IDE configuration', false)
    .action((opts) => {
      try {
        const target = (opts.target || 'all').toLowerCase() as IdeTarget;
        const validTargets: IdeTarget[] = ['antigravity', 'cursor', 'claude', 'windsurf', 'all'];

        if (!validTargets.includes(target)) {
          console.error(chalk.red(`Invalid target: '${opts.target}'. Choose from: ${validTargets.join(', ')}`));
          process.exitCode = 1;
          return;
        }

        const routerConfig = opts.withEnv ? loadRouterConfig() : undefined;
        const useGlobal = opts.global !== false;

        console.log(chalk.cyan.bold(`\nInstalling MikroTik MCP Server (Target: ${target.toUpperCase()})...`));
        console.log(chalk.gray(`Mode: ${useGlobal ? 'Global Binary (mtik-mcp)' : 'Node Script Path'}`));
        if (routerConfig) {
          console.log(chalk.gray(`Credentials: Injected from .env (${routerConfig.host})`));
        }

        const results = McpInstaller.install({
          target,
          useGlobal,
          config: routerConfig,
        });

        console.log('');
        for (const res of results) {
          if (res.success) {
            console.log(`${chalk.green('✔')} ${chalk.bold(res.ide.padEnd(14, ' '))}: ${chalk.gray(res.configPath)}`);
          } else {
            console.log(`${chalk.red('✖')} ${chalk.bold(res.ide.padEnd(14, ' '))}: ${chalk.red(res.error || 'Failed')}`);
          }
        }

        console.log(chalk.green.bold('\nInstallation complete! Restart your IDE to activate MikroTik tools.\n'));
      } catch (err) {
        console.error(chalk.red(`Installation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      }
    });

  program
    .command('mcp')
    .description('Start Model Context Protocol (MCP) server over STDIO for AI agent integration (Antigravity, Cursor, Claude).')
    .action(async () => {
      const { startLocalMcpServer } = await import('../../mcp/index.js');
      await startLocalMcpServer();
    });

  program
    .command('tui [device]')
    .alias('ui')
    .option('--offline', 'Open local linter and generators without connecting to a router')
    .description('Launch interactive Fullscreen Terminal User Interface (TUI) Dashboard & Wizards.')
    .option('-d, --device <name>', 'Target router device from inventory')
    .action(async (device, opts) => {
      try {
        await runTui({ device: device || opts?.device, offline: opts?.offline });
      } catch (err) {
        console.error(chalk.red(`TUI Error: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      }
    });
}
