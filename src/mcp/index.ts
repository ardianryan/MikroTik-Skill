#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadRouterConfig } from '../config/profile.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { SecurityAuditor } from '../safety/auditor.js';
import { MangleOrderEngine } from '../safety/order-engine.js';
import { SafeModeWatchdog } from '../safety/watchdog.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';
import { CertifiedTemplateGenerator } from '../safety/templates.js';
import { ChatPromptExporter } from '../safety/prompt-export.js';
import { PccCalculator } from '../safety/pcc-calculator.js';
import { WireGuardProvisioner } from '../safety/wireguard.js';
import { RoutingMigrator } from '../safety/routing-migrator.js';
import { RouterOsLinter } from '../safety/linter.js';

const server = new Server(
  {
    name: 'mikrotik-skill',
    version: '1.0.2',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mikrotik_test_connection',
        description: 'Verify connectivity to MikroTik RouterOS v7 via REST API or Native API Port 8728 fallback.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_get_system_status',
        description: 'Get CPU utilization, memory, uptime, RouterOS version, and hardware platform overview.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_audit_security',
        description: 'Run automated 7-Pillar Security Audit covering DNS open resolvers, exposed services, NTP drift, and Hairpin NAT Mangle order.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_list_mangle',
        description: 'Retrieve all active firewall mangle rules in sequential order with hierarchy breakdown.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_force_routing',
        description: 'Safely assign a client IP to a specific routing table (ISP1/ISP2) with placement hierarchy and FIB table verification.',
        inputSchema: {
          type: 'object',
          properties: {
            ip: { type: 'string', description: 'Client IP address to route' },
            table: { type: 'string', description: 'Target routing table mark (e.g. to_ISP1 or to_ISP2)' },
            comment: { type: 'string', description: 'Descriptive comment for the rule' },
            dryRun: { type: 'boolean', description: 'If true, returns validation without applying changes' },
          },
          required: ['ip', 'table'],
        },
      },
      {
        name: 'mikrotik_manage_dhcp_lease',
        description: 'List DHCP leases or add a static DHCP reservation.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'add'], description: 'Action to perform' },
            ip: { type: 'string', description: 'IP address (required for add)' },
            mac: { type: 'string', description: 'MAC address (required for add)' },
            comment: { type: 'string', description: 'Client description or hostname' },
          },
          required: ['action'],
        },
      },
      {
        name: 'mikrotik_export_sanitized_config',
        description: 'Export router configuration with all sensitive identifiers (MACs, serials, passwords, keys) sanitized and redacted.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_manage_container',
        description: 'List active containers or restart a container on RouterOS v7.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'restart'], description: 'Container action' },
            id: { type: 'string', description: 'Container ID or name (required for restart)' },
          },
          required: ['action'],
        },
      },
      {
        name: 'mikrotik_get_adlist_status',
        description: 'List active DNS adblocker feed lists on RouterOS v7.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_generate_template',
        description: 'Generate standardized production configuration templates across the 10 MikroTik Certification tracks (MTCNA, MTCRE, MTCINE, MTCTCE, MTCSWE, MTCSE, MTCIPv6E, MTCUME, MTCEWE, MTCWE).',
        inputSchema: {
          type: 'object',
          properties: {
            track: {
              type: 'string',
              enum: ['mtcswe', 'mtcine', 'mtcewe', 'mtcwe', 'mtcre', 'mtctce', 'mtcse', 'mtcipv6e', 'mtcume', 'mtcna', 'list'],
              description: 'Target certification track (or "list" to enumerate all available templates)',
            },
          },
          required: ['track'],
        },
      },
      {
        name: 'mikrotik_execute_command',
        description: 'Execute arbitrary RouterOS CLI command or script atomically via REST /execute or binary API fallback. Sanitizes all output identifiers.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The exact RouterOS CLI command or script to execute',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'mikrotik_rest_query',
        description: 'Perform direct HTTP REST API requests to any RouterOS v7 endpoint (/rest/<endpoint>) with GET, POST, PUT, PATCH, or DELETE.',
        inputSchema: {
          type: 'object',
          properties: {
            endpoint: {
              type: 'string',
              description: 'REST endpoint path (e.g. "/ip/address", "/interface/bridge", "/system/resource")',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method (default: GET)',
            },
            body: {
              type: 'object',
              description: 'Optional JSON payload for POST, PUT, or PATCH requests',
            },
          },
          required: ['endpoint'],
        },
      },
      {
        name: 'mikrotik_get_chat_prompt',
        description: 'Get certified RouterOS v7 Senior Network Engineer system prompt tailored for ChatGPT Custom GPTs or Claude.ai Projects. Ensures AI outputs 1-click copy-pasteable CLI commands.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mikrotik_calculate_pcc',
        description: 'Calculate mathematically normalized N-WAN asymmetric PCC load balancing configuration for RouterOS v7.',
        inputSchema: {
          type: 'object',
          properties: {
            wans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  weight: { type: 'number' },
                  gateway: { type: 'string' },
                },
                required: ['name'],
              },
              description: 'Array of WAN interfaces with optional weight and gateway',
            },
            lanInterface: { type: 'string', description: 'LAN interface name (default: bridge-lan)' },
            classifier: {
              type: 'string',
              enum: ['both-addresses-and-ports', 'both-addresses', 'src-address', 'dst-address'],
              description: 'PCC classifier type',
            },
          },
          required: ['wans'],
        },
      },
      {
        name: 'mikrotik_provision_wireguard',
        description: 'Generate Curve25519 Road-Warrior WireGuard peer keys, client .conf, router CLI commands, and QR code DataURLs.',
        inputSchema: {
          type: 'object',
          properties: {
            clientName: { type: 'string', description: 'Client identifier' },
            clientIp: { type: 'string', description: 'Client VPN IP with CIDR (e.g. 10.10.0.2/24)' },
            serverEndpoint: { type: 'string', description: 'Router public IP/hostname and port' },
            serverPublicKey: { type: 'string', description: 'Router WireGuard public key' },
            interfaceName: { type: 'string', description: 'WireGuard interface name on router' },
            dns: { type: 'string', description: 'DNS server for client' },
          },
          required: ['clientName', 'clientIp', 'serverEndpoint', 'serverPublicKey'],
        },
      },
      {
        name: 'mikrotik_migrate_filter',
        description: 'Transpile legacy RouterOS v6 routing filter rules to modern RouterOS v7 rule engine syntax (if ... then).',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'Legacy RouterOS v6 /routing filter add commands' },
          },
          required: ['script'],
        },
      },
      {
        name: 'mikrotik_lint_config',
        description: 'Perform static security audit and credential leak detection on RouterOS v7 .rsc scripts completely offline.',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'RouterOS .rsc script content to inspect' },
          },
          required: ['script'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const config = loadRouterConfig();
  const conn = new ConnectionManager(config);

  try {
    switch (name) {
      case 'mikrotik_test_connection': {
        const res = await conn.testConnection();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'mikrotik_get_system_status': {
        const [res, ifaces, leases] = await Promise.all([
          conn.getResource(),
          conn.getInterfaces().catch(() => []),
          conn.getDhcpLeases().catch(() => []),
        ]);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  resource: res,
                  interfacesTotal: ifaces.length,
                  dhcpLeasesCount: leases.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'mikrotik_audit_security': {
        const auditor = new SecurityAuditor(conn);
        const report = await auditor.runFullAudit();
        const markdown = SecurityAuditor.formatMarkdownReport(report);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...report, markdownReport: markdown }, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_list_mangle': {
        const rules = await conn.getMangleRules();
        const analysis = MangleOrderEngine.analyzePlacement(rules, config.localBypassList);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ analysis, rules }, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_force_routing': {
        const ip = String(args?.ip);
        const table = String(args?.table);
        const comment = String(args?.comment || 'Forced client routing via MCP');
        const dryRun = Boolean(args?.dryRun);

        const [tables, rules] = await Promise.all([
          conn.getRoutingTables(),
          conn.getMangleRules(),
        ]);

        const validation = MangleOrderEngine.validateRoutingMark(table, tables);
        if (!validation.valid) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Validation Error: ${validation.reason}` }],
          };
        }

        const analysis = MangleOrderEngine.analyzePlacement(rules, config.localBypassList);
        const ruleData = {
          chain: 'prerouting',
          action: 'mark-routing',
          'src-address': ip,
          'new-routing-mark': table,
          passthrough: 'no',
          comment,
        };

        if (dryRun) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'DRY_RUN_SUCCESS',
                    recommendedIndex: analysis.recommendedIndex,
                    rule: ruleData,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const watchdog = new SafeModeWatchdog(conn);
        await watchdog.arm(`/ip/firewall/mangle/remove [find comment="${comment}"]`, config.watchdogTimeout);
        await conn.addMangleRule(ruleData);

        const health = await conn.testConnection();
        if (health.successful) {
          await watchdog.disarm();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ status: 'APPLIED_AND_VERIFIED', rule: ruleData }, null, 2),
              },
            ],
          };
        } else {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Mutation resulted in connectivity degradation. Watchdog triggered rollback.' }],
          };
        }
      }

      case 'mikrotik_manage_dhcp_lease': {
        const action = args?.action;
        if (action === 'add') {
          const ip = String(args?.ip);
          const mac = String(args?.mac);
          const comment = String(args?.comment || 'Static reservation via MCP');
          await conn.addDhcpLease({
            address: ip,
            'mac-address': mac,
            comment,
          });
          return {
            content: [{ type: 'text', text: `Successfully added static lease for ${ip} (${mac})` }],
          };
        } else {
          const leases = await conn.getDhcpLeases();
          return {
            content: [{ type: 'text', text: JSON.stringify(leases, null, 2) }],
          };
        }
      }

      case 'mikrotik_export_sanitized_config': {
        const [resource, mangle, leases, tables, filters, services] = await Promise.all([
          conn.getResource(),
          conn.getMangleRules().catch(() => []),
          conn.getDhcpLeases().catch(() => []),
          conn.getRoutingTables().catch(() => []),
          conn.getFirewallFilters().catch(() => []),
          conn.getIpServices().catch(() => []),
        ]);

        const rawData = {
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

        const sanitized = ConfigSanitizer.sanitizeObject(rawData);
        return {
          content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }],
        };
      }

      case 'mikrotik_manage_container': {
        const action = args?.action;
        if (action === 'restart') {
          const id = String(args?.id);
          await conn.restartContainer(id);
          return {
            content: [{ type: 'text', text: `Container ${id} restart command dispatched.` }],
          };
        } else {
          const containers = await conn.getContainers();
          return {
            content: [{ type: 'text', text: JSON.stringify(containers, null, 2) }],
          };
        }
      }

      case 'mikrotik_get_adlist_status': {
        const adlists = await conn.getDnsAdlists();
        return {
          content: [{ type: 'text', text: JSON.stringify(adlists, null, 2) }],
        };
      }

      case 'mikrotik_generate_template': {
        const track = String(args?.track || 'list').toLowerCase();
        if (track === 'list') {
          return {
            content: [{ type: 'text', text: JSON.stringify(CertifiedTemplateGenerator.list(), null, 2) }],
          };
        }
        const tpl = CertifiedTemplateGenerator.get(track);
        if (!tpl) {
          throw new Error(`Unknown certification track: '${track}'`);
        }
        return {
          content: [
            {
              type: 'text',
              text: `# ${tpl.title}\n# ${tpl.description}\n\n${tpl.script}`,
            },
          ],
        };
      }

      case 'mikrotik_execute_command': {
        const cmd = String(args?.command || '').trim();
        if (!cmd) throw new Error('Parameter "command" is required.');
        const res = await conn.executeScript(cmd);
        return {
          content: [{ type: 'text', text: JSON.stringify(ConfigSanitizer.sanitizeJson(res || { status: 'success' }), null, 2) }],
        };
      }

      case 'mikrotik_rest_query': {
        const endpoint = String(args?.endpoint || '').trim();
        const method = String(args?.method || 'GET').toUpperCase();
        const body = args?.body;
        const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const res = await conn.restRequest(formattedEndpoint, method, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(ConfigSanitizer.sanitizeJson(res), null, 2) }],
        };
      }

      case 'mikrotik_get_chat_prompt': {
        const prompt = ChatPromptExporter.getSystemPrompt();
        return {
          content: [{ type: 'text', text: prompt }],
        };
      }

      case 'mikrotik_calculate_pcc': {
        const wans = args?.wans as any;
        if (!wans || !Array.isArray(wans) || wans.length < 2) {
          throw new Error('Parameter "wans" must be an array of at least 2 WAN interface configs.');
        }
        const lanInterface = args?.lanInterface ? String(args.lanInterface) : undefined;
        const classifier = args?.classifier as any;
        const result = PccCalculator.calculate({ wans, lanInterface, classifier });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'mikrotik_provision_wireguard': {
        const clientName = String(args?.clientName || '');
        const clientIp = String(args?.clientIp || '');
        const serverEndpoint = String(args?.serverEndpoint || '');
        const serverPublicKey = String(args?.serverPublicKey || '');
        if (!clientName || !clientIp || !serverEndpoint || !serverPublicKey) {
          throw new Error('Parameters "clientName", "clientIp", "serverEndpoint", and "serverPublicKey" are required.');
        }
        const interfaceName = args?.interfaceName ? String(args.interfaceName) : undefined;
        const dns = args?.dns ? String(args.dns) : undefined;
        const result = await WireGuardProvisioner.provisionClient({
          clientName,
          clientIp,
          serverEndpoint,
          serverPublicKey,
          interfaceName,
          dns,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'mikrotik_migrate_filter': {
        const script = String(args?.script || '');
        if (!script) throw new Error('Parameter "script" is required.');
        const result = RoutingMigrator.migrateScript(script);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'mikrotik_lint_config': {
        const script = String(args?.script || '');
        if (!script) throw new Error('Parameter "script" is required.');
        const result = RouterOsLinter.lint(script);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
    };
  } finally {
    await conn.close();
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal MCP Server error:', err);
  process.exit(1);
});
