#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadRouterConfig,
  sanitizeConfig,
  saveProfile,
  listProfiles,
  setActiveProfile,
  getDeviceConfig,
  listAllDevices,
} from '../config/profile.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { SecurityAuditor } from '../safety/auditor.js';
import { MangleOrderEngine } from '../safety/order-engine.js';
import { SafeModeWatchdog } from '../safety/watchdog.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';
import { formatBatchDiff, type DiffEntry } from '../safety/diff.js';
import { McpInstaller, type IdeTarget } from '../mcp/installer.js';
import { CertifiedTemplateGenerator } from '../safety/templates.js';
import { ChatPromptExporter } from '../safety/prompt-export.js';
import { PccCalculator } from '../safety/pcc-calculator.js';
import { WireGuardProvisioner } from '../safety/wireguard.js';
import { RoutingMigrator } from '../safety/routing-migrator.js';
import { RouterOsLinter } from '../safety/linter.js';
import { HotspotPortalGenerator, type HotspotAuthModel } from '../safety/hotspot-generator.js';
import { MikroTikHttpServer } from '../server/http.js';
import { OpenApiGenerator } from '../server/openapi.js';
import type { InterfaceTrafficMonitor } from '../client/types.js';

const program = new Command();

program
  .name('mtik')
  .description('MikroTik RouterOS v7 Production Automation & Management CLI')
  .version('1.1.2');

program
  .command('test')
  .description('Test connectivity and transport detection (REST API vs Native API Port 8728).')
  .action(async () => {
    const config = loadRouterConfig();
    const safeCfg = sanitizeConfig(config);
    console.log(chalk.blue(`Target: ${safeCfg.host} (User: ${safeCfg.user})`));

    const conn = new ConnectionManager(config);
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
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);
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
      console.error(chalk.red(`Failed to fetch status: ${err instanceof Error ? err.message : String(err)}`));
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
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);
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
      console.log(`Status: ${report.overallScore === 'SECURE' ? chalk.green('SECURE') : report.overallScore === 'NEEDS_ATTENTION' ? chalk.yellow('NEEDS ATTENTION') : chalk.red('VULNERABLE')}\n`);

      for (const item of report.items) {
        let badge = chalk.green('[PASS]');
        if (item.status === 'WARN') badge = chalk.yellow('[WARN]');
        if (item.status === 'CRITICAL') badge = chalk.red('[CRIT]');
        if (item.status === 'INFO') badge = chalk.blue('[INFO]');

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
      console.error(chalk.red(`Audit execution failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('mangle')
  .description('Manage and inspect firewall mangle rules.')
  .option('-l, --list', 'List active mangle rules in order', true)
  .action(async () => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      const rules = await conn.getMangleRules();
      console.log(chalk.bold(`\nActive Mangle Rules (${rules.length} total):`));

      const analysis = MangleOrderEngine.analyzePlacement(rules, config.localBypassList);
      console.log(chalk.gray(`Hierarchy: ${analysis.bypassCount} bypass | ${analysis.dedicatedCount} dedicated priority | ${analysis.pccCount} PCC rules\n`));

      rules.forEach((rule, idx) => {
        const chain = chalk.cyan(rule.chain);
        const action = chalk.yellow(rule.action);
        const src = rule['src-address'] ? `src=${rule['src-address']} ` : '';
        const dst = rule['dst-address'] ? `dst=${rule['dst-address']} ` : '';
        const mark = rule['new-routing-mark'] ? `-> mark=${rule['new-routing-mark']} ` : '';
        const comment = rule.comment ? chalk.gray(`; ${rule.comment}`) : '';

        console.log(`[${idx.toString().padStart(2, '0')}] ${chain} ${action} ${src}${dst}${mark}${comment}`);
      });
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Failed to list mangle rules: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('route-force')
  .description('Enforce dedicated ISP routing for a specific IP address with safety validation.')
  .requiredOption('--ip <address>', 'Client IP address to route')
  .requiredOption('--table <name>', 'Target routing table mark (e.g. to_ISP1 or to_ISP2)')
  .option('--comment <text>', 'Descriptive comment for the rule', 'Forced client routing')
  .option('--dry-run', 'Simulate changes without applying to router', false)
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      const [tables, rules] = await Promise.all([
        conn.getRoutingTables(),
        conn.getMangleRules(),
      ]);

      // 1. Validate target table in RouterOS v7
      const validation = MangleOrderEngine.validateRoutingMark(opts.table, tables);
      if (!validation.valid) {
        console.error(chalk.red(`Validation error: ${validation.reason}`));
        process.exitCode = 1;
        return;
      }

      // 2. Analyze placement hierarchy
      const analysis = MangleOrderEngine.analyzePlacement(rules, config.localBypassList);
      const targetRule = {
        chain: 'prerouting',
        action: 'mark-routing',
        'src-address': opts.ip,
        'new-routing-mark': opts.table,
        passthrough: 'no',
        comment: opts.comment,
      };

      const diff: DiffEntry = {
        type: 'ADD',
        target: `/ip/firewall/mangle (Target Index: ${analysis.recommendedIndex})`,
        details: targetRule,
      };

      console.log(chalk.bold('\nProposed Changes:'));
      console.log(formatBatchDiff([diff]));

      if (opts.dryRun) {
        console.log(chalk.yellow('Dry-run mode active. No changes were applied.\n'));
        return;
      }

      // 3. Apply changes with Watchdog protection
      const watchdog = new SafeModeWatchdog(conn);
      console.log(chalk.blue(`Arming 30-second safe-mode watchdog...`));
      await watchdog.arm(`/ip/firewall/mangle/remove [find comment="${opts.comment}"]`, config.watchdogTimeout);

      console.log(chalk.blue('Injecting mangle rule...'));
      await conn.addMangleRule(targetRule);

      // Verify connection health after mutation
      const test = await conn.testConnection();
      if (test.successful) {
        await watchdog.disarm();
        console.log(chalk.green('Rule successfully applied and watchdog disarmed.\n'));
      } else {
        console.error(chalk.red('Router heartbeat check failed! Watchdog will automatically rollback.\n'));
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(chalk.red(`Operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('lease')
  .description('Manage DHCP server leases.')
  .option('-l, --list', 'List active DHCP leases', true)
  .option('--add', 'Add a static lease')
  .option('--ip <address>', 'IP address for static lease')
  .option('--mac <address>', 'MAC address for static lease')
  .option('--comment <text>', 'Client name / description')
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      if (opts.add) {
        if (!opts.ip || !opts.mac) {
          console.error(chalk.red('Both --ip and --mac are required to add a static lease.'));
          process.exitCode = 1;
          return;
        }

        const leaseData = {
          address: opts.ip,
          'mac-address': opts.mac,
          comment: opts.comment || 'Static reservation',
        };

        const diff: DiffEntry = {
          type: 'ADD',
          target: '/ip/dhcp-server/lease',
          details: leaseData,
        };

        console.log(formatBatchDiff([diff]));
        await conn.addDhcpLease(leaseData);
        console.log(chalk.green('Static DHCP lease created successfully.\n'));
      } else {
        const leases = await conn.getDhcpLeases();
        console.log(chalk.bold(`\nDHCP Leases (${leases.length} total):`));
        leases.forEach((l) => {
          const type = l.dynamic === true || l.dynamic === 'true' ? chalk.yellow('DYNAMIC') : chalk.green('STATIC ');
          const ip = l.address.padEnd(16, ' ');
          const mac = l['mac-address'].padEnd(18, ' ');
          const host = l['host-name'] || l.comment || '-';
          console.log(`[${type}] ${ip} ${mac} (${host})`);
        });
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`DHCP operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('backup')
  .description('Download and store timestamped configuration snapshot.')
  .option('-o, --output <dir>', 'Output directory', './backups')
  .option('--sanitize', 'Anonymize MAC addresses, serials, and passwords in the snapshot', false)
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      console.log(chalk.blue('Collecting router configuration data...'));
      const [resource, mangle, leases, tables, filters, services] = await Promise.all([
        conn.getResource(),
        conn.getMangleRules().catch(() => []),
        conn.getDhcpLeases().catch(() => []),
        conn.getRoutingTables().catch(() => []),
        conn.getFirewallFilters().catch(() => []),
        conn.getIpServices().catch(() => []),
      ]);

      let backupData: Record<string, unknown> = {
        meta: {
          exportedAt: new Date().toISOString(),
          router: resource.board || resource.platform || 'MikroTik',
          version: resource.version || 'v7.x',
        },
        routingTables: tables,
        mangleRules: mangle,
        firewallFilters: filters,
        dhcpLeases: leases,
        ipServices: services,
      };

      if (opts.sanitize) {
        console.log(chalk.yellow('Sanitizing sensitive identifiers (MACs, serials, passwords)...'));
        backupData = ConfigSanitizer.sanitizeObject(backupData);
      }

      const outDir = path.resolve(process.cwd(), opts.output);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const suffix = opts.sanitize ? '-sanitized' : '';
      const filename = `mikrotik-backup-${dateStr}-${Date.now()}${suffix}.json`;
      const targetPath = path.join(outDir, filename);

      fs.writeFileSync(targetPath, JSON.stringify(backupData, null, 2), 'utf-8');
      console.log(chalk.green(`Configuration snapshot successfully saved to:`));
      console.log(`  ${chalk.bold(targetPath)}\n`);
    } catch (err) {
      console.error(chalk.red(`Backup failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('monitor')
  .description('Live throughput and traffic monitor across interfaces.')
  .option('-i, --interface <name>', 'Specific interface to monitor')
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      console.log(chalk.cyan.bold('\n=== MikroTik Live Traffic Monitor (Press Ctrl+C to stop) ==='));
      const ifaces = await conn.getInterfaces();
      const targetNames = opts.interface
        ? [opts.interface]
        : ifaces.filter((i) => i.running === true || i.running === 'true').slice(0, 4).map((i) => i.name);

      console.log(`Monitoring: ${targetNames.join(', ')}\n`);

      const poll = async () => {
        const results = await Promise.all(
          targetNames.map((name) =>
            conn.getInterfaceTraffic(name).catch(() => ({ name } as InterfaceTrafficMonitor))
          )
        );

        console.clear();
        console.log(chalk.cyan.bold('=== MikroTik Real-Time Interface Throughput ==='));
        console.log(chalk.gray(`Updated: ${new Date().toLocaleTimeString()}\n`));

        for (const item of results) {
          const rxBps = Number(item['rx-bits-per-second'] || 0);
          const txBps = Number(item['tx-bits-per-second'] || 0);

          const rxFormatted = rxBps > 1000000 ? `${(rxBps / 1000000).toFixed(2)} Mbps` : `${(rxBps / 1000).toFixed(1)} Kbps`;
          const txFormatted = txBps > 1000000 ? `${(txBps / 1000000).toFixed(2)} Mbps` : `${(txBps / 1000).toFixed(1)} Kbps`;

          console.log(`${chalk.bold(item.name.padEnd(16, ' '))} | RX: ${chalk.green(rxFormatted.padStart(12, ' '))} | TX: ${chalk.blue(txFormatted.padStart(12, ' '))}`);
        }
        console.log(chalk.gray('\nPress Ctrl+C to exit.'));
      };

      await poll();
      const interval = setInterval(poll, 2000);

      process.on('SIGINT', async () => {
        clearInterval(interval);
        await conn.close();
        console.log('\nMonitor stopped.');
        process.exit(0);
      });
    } catch (err) {
      console.error(chalk.red(`Monitor error: ${err instanceof Error ? err.message : String(err)}`));
      await conn.close();
      process.exitCode = 1;
    }
  });

program
  .command('container')
  .description('Manage Docker microservices running on RouterOS v7.')
  .option('-l, --list', 'List active containers', true)
  .option('--restart <id>', 'Restart a specific container by ID or name')
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      if (opts.restart) {
        console.log(chalk.blue(`Restarting container ${opts.restart}...`));
        await conn.restartContainer(opts.restart);
        console.log(chalk.green(`Container ${opts.restart} restart command sent.\n`));
      } else {
        const containers = await conn.getContainers();
        console.log(chalk.bold(`\nDocker Containers (${containers.length} total):`));
        if (containers.length === 0) {
          console.log(chalk.gray('No containers configured.'));
        } else {
          containers.forEach((c) => {
            const status = c.status === 'running' ? chalk.green('RUNNING') : chalk.yellow(c.status?.toUpperCase() || 'STOPPED');
            const name = c.comment || c.name || c.tag || 'container';
            console.log(`[${status}] ${chalk.bold(name)} (veth: ${c.interface || '-'}, root: ${c['root-dir'] || '-'})`);
          });
        }
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`Container operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('adlist')
  .description('Inspect or add DNS adblocker feed lists (/ip dns adlist).')
  .option('-l, --list', 'Show configured adlist feeds', true)
  .option('--add <url>', 'Add new adlist feed URL')
  .action(async (opts) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);

    try {
      if (opts.add) {
        console.log(chalk.blue(`Adding adlist feed: ${opts.add}...`));
        await conn.addDnsAdlist(opts.add);
        console.log(chalk.green('Adlist feed registered successfully.\n'));
      } else {
        const adlists = await conn.getDnsAdlists();
        console.log(chalk.bold(`\nDNS Adlist Feeds (${adlists.length} total):`));
        if (adlists.length === 0) {
          console.log(chalk.gray('No adlist feeds active.'));
        } else {
          adlists.forEach((a) => {
            const status = a.disabled === true || a.disabled === 'true' ? chalk.red('DISABLED') : chalk.green('ACTIVE  ');
            console.log(`[${status}] ${a.url}`);
          });
        }
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`Adlist operation failed: ${err instanceof Error ? err.message : String(err)}`));
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
        const currentCfg = loadRouterConfig();
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
      console.error(chalk.red(`Profile operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
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
      console.error(chalk.red(`Installation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  });

program
  .command('mcp')
  .description('Start Model Context Protocol (MCP) server over STDIO for AI agent integration (Antigravity, Cursor, Claude).')
  .action(async () => {
    await import('../mcp/index.js');
  });

program
  .command('template')
  .alias('generate')
  .description('Generate standardized RouterOS v7 configuration templates for MikroTik Certification tracks.')
  .argument('[track]', 'Certification track: mtcswe | mtcine | mtcewe | mtcwe | mtcre | mtctce | mtcse | mtcipv6e | mtcume | mtcna')
  .option('-o, --output <file>', 'Save generated configuration script to file (.rsc)')
  .option('-l, --list', 'List all available certified configuration templates')
  .action((track, opts) => {
    if (opts.list || !track) {
      console.log(chalk.cyan.bold('\nAvailable MikroTik Certified Engineering Templates:\n'));
      for (const t of CertifiedTemplateGenerator.list()) {
        console.log(`  ${chalk.bold.yellow(t.track.padEnd(10, ' '))} ${chalk.white(t.title)}`);
        console.log(`  ${''.padEnd(10, ' ')} ${chalk.gray(t.description)}\n`);
      }
      console.log(chalk.gray(`Usage: mtik template <track> [-o <file.rsc>]\n`));
      return;
    }

    const tpl = CertifiedTemplateGenerator.get(track);
    if (!tpl) {
      console.error(chalk.red(`Unknown certification track: '${track}'.`));
      console.log(chalk.gray(`Run 'mtik template --list' to see available tracks.`));
      process.exitCode = 1;
      return;
    }

    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, tpl.script, 'utf-8');
      console.log(chalk.green(`\n✔ Configuration template [${tpl.track.toUpperCase()}] saved to: ${chalk.bold(outPath)}\n`));
    } else {
      console.log(chalk.cyan.bold(`\n# =========================================================`));
      console.log(chalk.cyan.bold(`# ${tpl.title}`));
      console.log(chalk.gray(`# ${tpl.description}`));
      console.log(chalk.cyan.bold(`# =========================================================\n`));
      console.log(tpl.script);
      console.log('');
    }
  });

program
  .command('exec')
  .alias('run')
  .description('Execute a raw RouterOS CLI script atomically via REST /execute or API fallback.')
  .argument('<script>', 'The RouterOS script command to execute')
  .action(async (script) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);
    try {
      console.log(chalk.blue(`Executing on router: ${chalk.bold(script)}`));
      const res = await conn.executeScript(script);
      console.log(chalk.green('✔ Command executed successfully.'));
      if (res && (typeof res !== 'object' || Object.keys(res as object).length > 0)) {
        console.log(ConfigSanitizer.sanitizeJson(res));
      }
    } catch (err) {
      console.error(chalk.red(`Execution failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('rest')
  .description('Send direct HTTP REST API requests to RouterOS v7 (/rest/<endpoint>).')
  .argument('<method>', 'HTTP method: GET | POST | PUT | PATCH | DELETE')
  .argument('<endpoint>', 'REST path (e.g. /ip/address, /system/resource, /export)')
  .argument('[data]', 'Optional JSON request body string')
  .action(async (method, endpoint, data) => {
    const config = loadRouterConfig();
    const conn = new ConnectionManager(config);
    try {
      let body: unknown = undefined;
      if (data) {
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
      }
      const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      console.log(chalk.blue(`${method.toUpperCase()} /rest${formattedEndpoint}`));
      const res = await conn.restRequest(formattedEndpoint, method.toUpperCase(), body);
      console.log(chalk.green('✔ Response:'));
      console.log(JSON.stringify(ConfigSanitizer.sanitizeJson(res), null, 2));
    } catch (err) {
      console.error(chalk.red(`REST call failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('prompt')
  .description('Export or print optimized system prompt for ChatGPT Custom GPT or Claude.ai Project.')
  .option('-t, --target <target>', 'Target platform: chatgpt | claude | generic', 'chatgpt')
  .option('-o, --output <file>', 'Save prompt to a markdown file')
  .action((opts) => {
    const prompt = ChatPromptExporter.getSystemPrompt();
    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, prompt, 'utf-8');
      console.log(chalk.green(`System prompt saved to: ${outPath}`));
    } else {
      console.log(prompt);
    }
  });

program
  .command('serve')
  .description('Start HTTP & OpenAPI Gateway Server for ChatGPT Actions and Remote MCP.')
  .option('-p, --port <number>', 'HTTP server port', '3000')
  .action((opts) => {
    const port = parseInt(opts.port, 10) || 3000;
    const server = new MikroTikHttpServer({ port });
    server.listen(port);
    console.log(chalk.blue(`MikroTik HTTP Knowledge Server listening on port ${port}`));
    console.log(chalk.gray(`- Health: http://localhost:${port}/health`));
    console.log(chalk.gray(`- OpenAPI: http://localhost:${port}/openapi.json`));
  });

program
  .command('openapi')
  .description('Generate and export OpenAPI 3.1.0 schema for ChatGPT Custom GPT Actions.')
  .option('-o, --output <file>', 'Save OpenAPI schema to a file')
  .option('-u, --url <url>', 'Base server URL for OpenAPI specification', 'https://your-deployment.vercel.app')
  .action((opts) => {
    const spec = OpenApiGenerator.getSpecification(opts.url);
    const json = JSON.stringify(spec, null, 2);
    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, json, 'utf-8');
      console.log(chalk.green(`\n✔ OpenAPI schema saved to: ${chalk.bold(outPath)}\n`));
    } else {
      console.log(json);
    }
  });

program
  .command('pcc')
  .description('Generate mathematically normalized N-WAN asymmetric PCC load balancing configuration for RouterOS v7.')
  .requiredOption('-w, --wans <specs>', 'Comma-separated WAN specs with weight/bandwidth (e.g. "ISP1=100,ISP2=50" or "ether1=1,ether2=1")')
  .option('-l, --lan <interface>', 'LAN bridge/interface name', 'bridge-lan')
  .option('-c, --classifier <type>', 'PCC classifier type: both-addresses | both-addresses-and-ports | src-address | dst-address', 'both-addresses-and-ports')
  .option('-o, --output <file>', 'Save generated script to a file')
  .action((opts) => {
    const wanConfigs = opts.wans.split(',').map((part: string) => {
      const [name, weightStr] = part.trim().split('=');
      const weight = parseInt(weightStr || '1', 10) || 1;
      return {
        name,
        weight,
        gateway: `gateway_${name}`,
      };
    });

    const result = PccCalculator.calculate({
      wans: wanConfigs,
      lanInterface: opts.lan,
      classifier: opts.classifier,
    });

    console.log(chalk.bold(`\n=== Asymmetric PCC Ratio Calculation ===`));
    console.log(`Total Streams : ${chalk.cyan(result.totalStreams)}`);
    console.log(`Allocations   :`);
    for (const [wan, streams] of Object.entries(result.streamsPerWan)) {
      console.log(`  - ${chalk.bold(wan)} (Streams: ${chalk.green(streams.length)}): ${streams.map((s) => `${result.totalStreams}/${s}`).join(', ')}`);
    }
    console.log('');

    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, result.script, 'utf-8');
      console.log(chalk.green(`✔ RouterOS v7 script written to: ${outPath}`));
    } else {
      console.log(chalk.gray('# RouterOS v7 Script:\n'));
      console.log(result.script);
    }
  });

program
  .command('hotspot')
  .description('Generate modern responsive captive portal files (login.html, status.html) and RouterOS v7 walled-garden configuration.')
  .option('-m, --model <type>', 'Authentication model: voucher | member | dual | all-in-one', 'all-in-one')
  .option('-v, --venue <name>', 'Venue brand name displayed on portal', 'High-Speed Wi-Fi')
  .option('-o, --output-dir <path>', 'Directory to save portal HTML files and RouterOS script', './hotspot')
  .option('--no-trial', 'Disable one-click free trial access')
  .option('--trial-time <time>', 'Trial session limit', '30m')
  .option('--voucher-limit <rate>', 'Voucher bandwidth rate limit', '10M/5M')
  .option('--gateway <processor>', 'Payment gateway to whitelist in Walled Garden: midtrans | xendit | stripe | none', 'none')
  .option('--dns <domain>', 'Hotspot DNS name', 'wifi.venue.lan')
  .action((opts) => {
    const validModels: HotspotAuthModel[] = ['voucher', 'member', 'dual', 'all-in-one'];
    const model = (opts.model || 'all-in-one').toLowerCase() as HotspotAuthModel;
    if (!validModels.includes(model)) {
      console.error(chalk.red(`Invalid model: '${opts.model}'. Choose from: ${validModels.join(', ')}`));
      process.exitCode = 1;
      return;
    }

    const bundle = HotspotPortalGenerator.generate({
      venueName: opts.venue,
      model,
      enableTrial: opts.trial !== false,
      trialUptime: opts.trialTime,
      voucherRateLimit: opts.voucherLimit,
      paymentGateway: opts.gateway,
      dnsName: opts.dns,
    });

    const targetDir = path.resolve(process.cwd(), opts.outputDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(path.join(targetDir, 'login.html'), bundle.loginHtml, 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'status.html'), bundle.statusHtml, 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'hotspot_config.rsc'), bundle.routerOsScript, 'utf-8');

    console.log(chalk.cyan.bold(`\n✔ Modern Captive Portal Generated Successfully! (Model: ${model.toUpperCase()})`));
    console.log(chalk.gray(`Output Directory: ${targetDir}`));
    console.log(`  - ${chalk.green('login.html')}        : Mobile-first responsive captive login form`);
    console.log(`  - ${chalk.green('status.html')}       : Live session telemetry & bandwidth counter`);
    console.log(`  - ${chalk.green('hotspot_config.rsc')}: RouterOS v7 walled-garden & profiles script\n`);
    console.log(chalk.bold('To deploy to your router flash storage:'));
    console.log(chalk.yellow(`  scp -P 22 ${path.join(targetDir, 'login.html')} admin@<router-ip>:/flash/hotspot/`));
    console.log(chalk.yellow(`  scp -P 22 ${path.join(targetDir, 'status.html')} admin@<router-ip>:/flash/hotspot/\n`));
  });

program
  .command('wireguard')
  .description('Provision WireGuard Road-Warrior keypairs, configs, router peer commands, and QR codes.')
  .argument('[action]', 'Action to perform: client', 'client')
  .requiredOption('-n, --name <name>', 'Client identity name (e.g. laptop-alice)')
  .requiredOption('-i, --ip <ip>', 'Client VPN IP address with CIDR (e.g. 10.10.0.2/24)')
  .requiredOption('-e, --endpoint <endpoint>', 'Router public IP/FQDN and port (e.g. vpn.example.com:13231)')
  .requiredOption('-k, --server-pubkey <pubkey>', 'Router WireGuard public key (44-char base64)')
  .option('-w, --interface <name>', 'Router WireGuard interface name', 'wg0')
  .option('-d, --dns <dns>', 'DNS server pushed to client', '1.1.1.1,8.8.8.8')
  .option('-q, --qr', 'Display ASCII QR code in terminal for mobile scanning', false)
  .option('-o, --output <file>', 'Save client .conf file')
  .action(async (_action, opts) => {
    const result = await WireGuardProvisioner.provisionClient({
      clientName: opts.name,
      clientIp: opts.ip,
      serverEndpoint: opts.endpoint,
      serverPublicKey: opts.serverPubkey,
      interfaceName: opts.interface,
      dns: opts.dns,
    });

    console.log(chalk.bold(`\n=== WireGuard Peer Provisioned: ${opts.name} ===`));
    console.log(`Client Public Key : ${chalk.cyan(result.clientPublicKey)}`);
    console.log(`Client VPN IP     : ${opts.ip}`);
    console.log('');
    console.log(chalk.yellow.bold('RouterOS v7 Command to Add Peer:'));
    console.log(chalk.green(result.routerPeerCommand));
    console.log('');

    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, result.clientConfig, 'utf-8');
      console.log(chalk.green(`✔ Client configuration saved to: ${outPath}`));
    } else {
      console.log(chalk.gray('# Client .conf File:\n'));
      console.log(result.clientConfig);
    }

    if (opts.qr) {
      console.log(chalk.bold('\nScan QR Code with WireGuard Mobile App:\n'));
      console.log(result.qrTerminal);
    }
  });

program
  .command('migrate-filter')
  .description('Transpile legacy RouterOS v6 routing filters to RouterOS v7 rule engine syntax.')
  .argument('<file>', 'Path to file containing legacy v6 routing filter commands')
  .option('-o, --output <file>', 'Save converted v7 script to a file')
  .action((file, opts) => {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found: ${filePath}`));
      process.exitCode = 1;
      return;
    }

    const legacyScript = fs.readFileSync(filePath, 'utf-8');
    const result = RoutingMigrator.migrateScript(legacyScript);

    console.log(chalk.bold(`\n=== RouterOS Routing Filter Migration ===`));
    console.log(`Converted Rules: ${chalk.green(result.migratedRules.length)}`);
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`Warnings (${result.warnings.length}):`));
      for (const warn of result.warnings) {
        console.log(`  - ${warn}`);
      }
    }
    console.log('');

    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      fs.writeFileSync(outPath, result.script, 'utf-8');
      console.log(chalk.green(`✔ Transpiled v7 script saved to: ${outPath}`));
    } else {
      console.log(chalk.gray('# RouterOS v7 Script:\n'));
      console.log(result.script);
    }
  });

program
  .command('lint')
  .description('Run static security audit and credential leak detection on RouterOS v7 .rsc configuration files.')
  .argument('<file>', 'Path to RouterOS .rsc script file')
  .action((file) => {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found: ${filePath}`));
      process.exitCode = 1;
      return;
    }

    const script = fs.readFileSync(filePath, 'utf-8');
    const result = RouterOsLinter.lint(script);

    console.log(chalk.bold(`\n=== NetDevOps Script Linter: ${path.basename(filePath)} ===`));
    console.log(`Status: ${result.passed ? chalk.green.bold('PASSED') : chalk.red.bold('FAILED')}`);
    console.log(`Summary: ${chalk.red(result.summary.critical + ' Critical')}, ${chalk.magenta(result.summary.high + ' High')}, ${chalk.yellow(result.summary.warn + ' Warning')}, ${chalk.blue(result.summary.info + ' Info')}\n`);

    for (const f of result.findings) {
      let badge = chalk.blue('[INFO]');
      if (f.severity === 'WARN') badge = chalk.yellow('[WARN]');
      if (f.severity === 'HIGH') badge = chalk.magenta('[HIGH]');
      if (f.severity === 'CRITICAL') badge = chalk.red.bold('[CRITICAL]');

      console.log(`${badge} ${chalk.bold(f.id)} (Line ${f.line}): ${f.rule}`);
      console.log(`  Detail : ${f.message}`);
      console.log(`  Source : ${chalk.gray(f.rawLine.trim())}`);
      console.log(`  Fix    : ${chalk.green(f.remediation)}\n`);
    }

    if (!result.passed) {
      process.exitCode = 1;
    }
  });

program
  .command('devices')
  .alias('inventory')
  .description('List all managed MikroTik routers from inventory.yml, profiles, or environment.')
  .action(() => {
    const devices = listAllDevices();
    console.log(chalk.cyan.bold('\n=== Managed MikroTik Routers & Fleet Inventory ===\n'));
    if (devices.length === 0) {
      console.log(chalk.gray('No devices found in inventory.yml or profiles.'));
    } else {
      devices.forEach((d) => {
        const srcBadge = chalk.yellow(`[${d.source.toUpperCase()}]`);
        const portStr = chalk.gray(`:${d.port} (${d.transport.toUpperCase()})`);
        console.log(`  ${srcBadge} ${chalk.bold(d.name.padEnd(16, ' '))} -> ${d.host}${portStr} (user: ${d.user})`);
      });
    }
    console.log('');
  });

program
  .command('logs')
  .description('View live system and firewall logs from MikroTik router.')
  .option('-d, --device <name>', 'Target router device from inventory')
  .option('-l, --limit <count>', 'Number of log lines to show', '30')
  .option('-t, --topic <topics>', 'Comma-separated topic filters (e.g. firewall,dhcp,warning)')
  .action(async (opts) => {
    const config = getDeviceConfig(opts.device);
    const conn = new ConnectionManager(config);
    try {
      const limit = parseInt(opts.limit, 10) || 30;
      const topics = opts.topic ? opts.topic.split(',').map((s: string) => s.trim()) : undefined;
      const logs = await conn.getLogs({ limit, topics });

      console.log(chalk.cyan.bold(`\n=== Router Logs (${logs.length} entries) [${config.host}] ===\n`));
      if (logs.length === 0) {
        console.log(chalk.gray('No matching log entries found.'));
      } else {
        logs.forEach((item) => {
          const timeStr = chalk.gray(item.time || '');
          const topicsStr = chalk.yellow(`[${item.topics || ''}]`);
          console.log(`${timeStr} ${topicsStr} ${item.message || ''}`);
        });
      }
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Failed to fetch logs: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('poe')
  .description('Inspect PoE port status or power-cycle a PoE-connected downstream device.')
  .option('-d, --device <name>', 'Target router device from inventory')
  .option('-l, --list', 'List PoE status across ethernet interfaces', true)
  .option('--cycle <interface>', 'Power cycle a PoE port (e.g. ether2)')
  .action(async (opts) => {
    const config = getDeviceConfig(opts.device);
    const conn = new ConnectionManager(config);
    try {
      if (opts.cycle) {
        console.log(chalk.blue(`Power-cycling PoE on port ${opts.cycle}...`));
        await conn.cyclePoePower(opts.cycle);
        console.log(chalk.green(`✔ Successfully dispatched power-cycle to ${opts.cycle}.\n`));
      } else {
        const poe = await conn.getPoeStatus();
        console.log(chalk.cyan.bold(`\n=== PoE Port Status [${config.host}] ===\n`));
        if (poe.length === 0) {
          console.log(chalk.gray('No PoE-capable ports detected or information unavailable.'));
        } else {
          poe.forEach((p) => {
            const name = chalk.bold((p.name || 'eth').padEnd(12, ' '));
            const status = p['poe-out-status'] ? chalk.green(p['poe-out-status']) : chalk.gray('off');
            const voltage = p['poe-voltage'] ? `${p['poe-voltage']}V` : '-';
            const current = p['poe-current'] ? `${p['poe-current']}mA` : '-';
            const power = p['poe-power'] ? `${p['poe-power']}W` : '-';
            console.log(`  ${name} Status: ${status} | Voltage: ${voltage} | Current: ${current} | Power: ${power}`);
          });
        }
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`PoE operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('queue')
  .description('Inspect Simple Queues or provision low-latency CAKE SQM queues.')
  .option('-d, --device <name>', 'Target router device from inventory')
  .option('-l, --list', 'List active simple queues', true)
  .option('--cake', 'Create a CAKE SQM queue')
  .option('--name <name>', 'Queue name', 'cake-sqm')
  .option('--target <subnet>', 'Target CIDR or interface', '0.0.0.0/0')
  .option('--upload <rate>', 'Max upload bandwidth (e.g. 50M)', '50M')
  .option('--download <rate>', 'Max download bandwidth (e.g. 100M)', '100M')
  .action(async (opts) => {
    const config = getDeviceConfig(opts.device);
    const conn = new ConnectionManager(config);
    try {
      if (opts.cake) {
        console.log(chalk.blue(`Provisioning CAKE SQM queue '${opts.name}' (${opts.upload}/${opts.download}) for target ${opts.target}...`));
        await conn.createCakeQueue({
          name: opts.name,
          target: opts.target,
          upload: opts.upload,
          download: opts.download,
        });
        console.log(chalk.green(`✔ Successfully configured CAKE Smart Queue Management on ${config.host}.\n`));
      } else {
        const queues = await conn.getQueues();
        console.log(chalk.cyan.bold(`\n=== Simple Queues (${queues.length} total) [${config.host}] ===\n`));
        if (queues.length === 0) {
          console.log(chalk.gray('No simple queues configured.'));
        } else {
          queues.forEach((q) => {
            const name = chalk.bold((q.name || '').padEnd(16, ' '));
            const target = chalk.yellow((q.target || '').padEnd(18, ' '));
            const maxLimit = chalk.green((q['max-limit'] || '').padEnd(16, ' '));
            const type = chalk.gray(q.queue || 'default');
            console.log(`  ${name} Target: ${target} Max: ${maxLimit} Type: ${type}`);
          });
        }
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`Queue operation failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program
  .command('wifi')
  .alias('wireless')
  .description('Inspect connected WiFi clients and signal metrics across registration tables.')
  .option('-d, --device <name>', 'Target router device from inventory')
  .action(async (opts) => {
    const config = getDeviceConfig(opts.device);
    const conn = new ConnectionManager(config);
    try {
      const clients = await conn.getWirelessClients();
      console.log(chalk.cyan.bold(`\n=== Connected WiFi Clients (${clients.length} active) [${config.host}] ===\n`));
      if (clients.length === 0) {
        console.log(chalk.gray('No active wireless clients associated.'));
      } else {
        clients.forEach((c) => {
          const mac = chalk.bold((c['mac-address'] || '').padEnd(18, ' '));
          const iface = chalk.cyan((c.interface || '').padEnd(14, ' '));
          const signal = c['signal-strength'] ? chalk.green(`${c['signal-strength']} dBm`) : '-';
          const uptime = chalk.gray(c.uptime || '-');
          console.log(`  ${mac} Interface: ${iface} Signal: ${signal} Uptime: ${uptime}`);
        });
      }
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Failed to fetch wireless clients: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      await conn.close();
    }
  });

program.parse(process.argv);
