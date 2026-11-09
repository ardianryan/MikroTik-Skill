import { type Command } from 'commander';
import chalk from 'chalk';
import type { CliContext } from '../common.js';
import { ConnectionManager } from '../../client/connection-manager.js';
import { ConfigSanitizer } from '../../safety/sanitizer.js';
import { MangleOrderEngine } from '../../safety/order-engine.js';
import { formatBatchDiff, type DiffEntry } from '../../safety/diff.js';
import type { InterfaceTrafficMonitor } from '../../client/types.js';

export function registerNetworkCommands(program: Command, ctx: CliContext): void {
  program
    .command('mangle')
    .description('Manage and inspect firewall mangle rules.')
    .option('-l, --list', 'List active mangle rules in order', true)
    .action(async () => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

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
        console.error(chalk.red(`Failed to list mangle rules: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

      try {
        const [tables, rules] = await Promise.all([
          conn.getRoutingTables(),
          conn.getMangleRules(),
        ]);

        const validation = MangleOrderEngine.validateRoutingMark(opts.table, tables);
        if (!validation.valid) {
          console.error(chalk.red(`Validation error: ${validation.reason}`));
          process.exitCode = 1;
          return;
        }

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

        const result = await conn.addMangleRule(targetRule);
        console.log(JSON.stringify(ConfigSanitizer.sanitizeJson(result), null, 2));
      } catch (err) {
        console.error(chalk.red(`Operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

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
          if (await ctx.reportMutation(conn.addDhcpLease(leaseData))) return;
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
        console.error(chalk.red(`DHCP operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

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
        console.error(chalk.red(`Monitor error: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        await conn.close();
        process.exitCode = 1;
      }
    });

  program
    .command('poe')
    .description('Inspect PoE port status or power-cycle a PoE-connected downstream device.')
    .option('-d, --device <name>', 'Target router device from inventory')
    .option('-l, --list', 'List PoE status across ethernet interfaces', true)
    .option('--cycle <interface>', 'Power cycle a PoE port (e.g. ether2)')
    .action(async (opts) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config, opts.device));
      try {
        if (opts.cycle) {
          console.log(chalk.blue(`Power-cycling PoE on port ${opts.cycle}...`));
          if (await ctx.reportMutation(conn.cyclePoePower(opts.cycle))) return;
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
        console.error(chalk.red(`PoE operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config, opts.device));
      try {
        if (opts.cake) {
          console.log(chalk.blue(`Provisioning CAKE SQM queue '${opts.name}' (${opts.upload}/${opts.download}) for target ${opts.target}...`));
          if (await ctx.reportMutation(conn.createCakeQueue({
            name: opts.name,
            target: opts.target,
            upload: opts.upload,
            download: opts.download,
          }))) return;
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
        console.error(chalk.red(`Queue operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config, opts.device));
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
        console.error(chalk.red(`Failed to fetch wireless clients: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });
}
