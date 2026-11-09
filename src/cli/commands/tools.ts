import fs from 'node:fs';
import path from 'node:path';
import { type Command } from 'commander';
import chalk from 'chalk';
import type { CliContext } from '../common.js';
import { ConnectionManager } from '../../client/connection-manager.js';
import { ConfigSanitizer } from '../../safety/sanitizer.js';
import { CertifiedTemplateGenerator } from '../../safety/templates.js';
import { PccCalculator, parsePccWanSpecs } from '../../safety/pcc-calculator.js';
import { HotspotPortalGenerator, type HotspotAuthModel } from '../../safety/hotspot-generator.js';
import { WireGuardProvisioner } from '../../safety/wireguard.js';
import { RoutingMigrator } from '../../safety/routing-migrator.js';
import { RouterOsLinter } from '../../safety/linter.js';

export function registerToolCommands(program: Command, ctx: CliContext): void {
  program
    .command('backup')
    .description('Download and store timestamped configuration snapshot.')
    .option('-o, --output <dir>', 'Output directory', './backups')
    .option('--sanitize', 'Anonymize MAC addresses, serials, and passwords in the snapshot', false)
    .action(async (opts) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

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
        console.log(chalk.green('Configuration snapshot successfully saved to:'));
        console.log(`  ${chalk.bold(targetPath)}\n`);
      } catch (err) {
        console.error(chalk.red(`Backup failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });

  program
    .command('container')
    .description('Manage Docker microservices running on RouterOS v7.')
    .option('-l, --list', 'List active containers', true)
    .option('--restart <id>', 'Restart a specific container by ID or name')
    .action(async (opts) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

      try {
        if (opts.restart) {
          console.log(chalk.blue(`Restarting container ${opts.restart}...`));
          if (await ctx.reportMutation(conn.restartContainer(opts.restart))) return;
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
        console.error(chalk.red(`Container operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));

      try {
        if (opts.add) {
          console.log(chalk.blue(`Adding adlist feed: ${opts.add}...`));
          if (await ctx.reportMutation(conn.addDnsAdlist(opts.add))) return;
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
        console.error(chalk.red(`Adlist operation failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
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
    .command('pcc')
    .description('Generate mathematically normalized N-WAN asymmetric PCC load balancing configuration for RouterOS v7.')
    .requiredOption('-w, --wans <specs>', 'WAN name=weight with optional @gateway (e.g. "ISP1=2@192.0.2.1,ISP2=1@198.51.100.1")')
    .option('-l, --lan <interface>', 'LAN bridge/interface name', 'bridge-lan')
    .option('-c, --classifier <type>', 'PCC classifier type: both-addresses | both-addresses-and-ports | src-address | dst-address', 'both-addresses-and-ports')
    .option('-o, --output <file>', 'Save generated script to a file')
    .action((opts) => {
      const wanConfigs = parsePccWanSpecs(opts.wans);

      const result = PccCalculator.calculate({
        wans: wanConfigs,
        lanInterface: opts.lan,
        classifier: opts.classifier,
      });

      console.log(chalk.bold(`\n=== Asymmetric PCC Ratio Calculation ===`));
      if (wanConfigs.some((wan) => !wan.gateway)) console.log(chalk.yellow('Gateways not supplied use sample addresses; review or specify @gateway before applying.'));
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
        fs.writeFileSync(outPath, result.clientConfig, { encoding: 'utf-8', mode: 0o600 });
        fs.chmodSync(outPath, 0o600);
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
    .command('logs')
    .description('View live system and firewall logs from MikroTik router.')
    .option('-d, --device <name>', 'Target router device from inventory')
    .option('-l, --limit <count>', 'Number of log lines to show', '30')
    .option('-t, --topic <topics>', 'Comma-separated topic filters (e.g. firewall,dhcp,warning)')
    .action(async (opts) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config, opts.device));
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
        console.error(chalk.red(`Failed to fetch logs: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
        process.exitCode = 1;
      } finally {
        await conn.close();
      }
    });
}
