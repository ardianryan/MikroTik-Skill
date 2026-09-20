import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CertifiedTemplateGenerator, type CertificationTrack } from '../safety/templates.js';
import { ChatPromptExporter } from '../safety/prompt-export.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';
import { MangleOrderEngine } from '../safety/order-engine.js';
import { PccCalculator } from '../safety/pcc-calculator.js';
import { WireGuardProvisioner } from '../safety/wireguard.js';
import { RoutingMigrator } from '../safety/routing-migrator.js';
import { RouterOsLinter } from '../safety/linter.js';
import { ConnectionManager } from '../client/connection-manager.js';
import { loadRouterConfig } from '../config/profile.js';
import { SecurityAuditor } from '../safety/auditor.js';

export function createRemoteMcpServer(): Server {
  const server = new Server(
    {
      name: 'mikrotik-skill',
      version: '1.1.0',
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
          name: 'mikrotik_generate_template',
          description:
            'Generate standardized production RouterOS v7 configuration scripts across all 10 MikroTik Certification tracks (MTCNA, MTCRE, MTCINE, MTCTCE, MTCSWE, MTCSE, MTCIPv6E, MTCUME, MTCEWE, MTCWE). Offline and air-gapped.',
          inputSchema: {
            type: 'object',
            properties: {
              track: {
                type: 'string',
                enum: ['mtcswe', 'mtcine', 'mtcewe', 'mtcwe', 'mtcre', 'mtctce', 'mtcse', 'mtcipv6e', 'mtcume', 'mtcna', 'list'],
                description: 'Target certification track (or "list" to enumerate all available tracks)',
              },
            },
            required: ['track'],
          },
        },
        {
          name: 'mikrotik_get_chat_prompt',
          description:
            'Retrieve certified RouterOS v7 Senior Network Engineer system prompt instructions for AI code generation.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'mikrotik_sanitize_config',
          description:
            'Sanitize and redact sensitive identifiers (passwords, MAC addresses, serial numbers, VPN tokens) from raw RouterOS scripts or exports.',
          inputSchema: {
            type: 'object',
            properties: {
              configText: {
                type: 'string',
                description: 'Raw configuration text to sanitize',
              },
            },
            required: ['configText'],
          },
        },
        {
          name: 'mikrotik_validate_routing_mark',
          description:
            'Validate that a proposed routing table is registered in /routing table with fib=yes before Mangle injection.',
          inputSchema: {
            type: 'object',
            properties: {
              routingMark: {
                type: 'string',
                description: 'Proposed routing mark name (e.g. to_ISP1)',
              },
              existingTables: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of already registered table names',
              },
            },
            required: ['routingMark'],
          },
        },
        {
          name: 'mikrotik_calculate_pcc',
          description:
            'Calculate mathematically normalized N-WAN asymmetric PCC load balancing configuration for RouterOS v7.',
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
                description: 'PCC matcher classifier',
              },
            },
            required: ['wans'],
          },
        },
        {
          name: 'mikrotik_provision_wireguard',
          description:
            'Generate Curve25519 Road-Warrior WireGuard peer keys, client .conf, router CLI commands, and QR code DataURLs offline.',
          inputSchema: {
            type: 'object',
            properties: {
              clientName: { type: 'string', description: 'Client identifier (e.g. laptop-alice)' },
              clientIp: { type: 'string', description: 'Client VPN IP with CIDR (e.g. 10.10.0.2/24)' },
              serverEndpoint: { type: 'string', description: 'Router public IP/hostname and port (e.g. vpn.example.com:13231)' },
              serverPublicKey: { type: 'string', description: 'Router WireGuard public key' },
              interfaceName: { type: 'string', description: 'WireGuard interface name on router (default: wg0)' },
              dns: { type: 'string', description: 'DNS server for client (default: 10.10.0.1)' },
            },
            required: ['clientName', 'clientIp', 'serverEndpoint', 'serverPublicKey'],
          },
        },
        {
          name: 'mikrotik_migrate_filter',
          description:
            'Transpile legacy RouterOS v6 routing filter rules to modern RouterOS v7 rule engine syntax (if ... then).',
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
          description:
            'Perform static security audit and credential leak detection on RouterOS v7 .rsc scripts completely offline.',
          inputSchema: {
            type: 'object',
            properties: {
              script: { type: 'string', description: 'RouterOS .rsc script content to inspect' },
            },
            required: ['script'],
          },
        },
        {
          name: 'mikrotik_test_connection',
          description: 'Verify connectivity to MikroTik RouterOS v7 (requires router reachable from runtime).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'mikrotik_audit_security',
          description: 'Run automated security audit against a live router (requires router reachable from runtime).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'mikrotik_generate_template': {
        const track = String(args?.track || 'list').toLowerCase();
        if (track === 'list') {
          return {
            content: [{ type: 'text', text: JSON.stringify(CertifiedTemplateGenerator.list(), null, 2) }],
          };
        }
        const tpl = CertifiedTemplateGenerator.get(track as CertificationTrack);
        if (!tpl) {
          throw new Error(`Unknown certification track: '${track}'. Available: ${CertifiedTemplateGenerator.list().map((t) => t.track).join(', ')}`);
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

      case 'mikrotik_get_chat_prompt': {
        const prompt = ChatPromptExporter.getSystemPrompt();
        return {
          content: [{ type: 'text', text: prompt }],
        };
      }

      case 'mikrotik_sanitize_config': {
        const text = String(args?.configText || '');
        if (!text) throw new Error('Parameter "configText" is required.');
        const sanitized = ConfigSanitizer.sanitizeText(text);
        return {
          content: [{ type: 'text', text: sanitized }],
        };
      }

      case 'mikrotik_validate_routing_mark': {
        const mark = String(args?.routingMark || '');
        if (!mark) throw new Error('Parameter "routingMark" is required.');
        const existing = Array.isArray(args?.existingTables)
          ? (args.existingTables as string[]).map((t) => ({ name: String(t), fib: true }))
          : [{ name: mark, fib: true }];
        const result = MangleOrderEngine.validateRoutingMark(mark, existing);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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

      case 'mikrotik_test_connection':
      case 'mikrotik_audit_security': {
        const host = process.env.ROUTEROS_HOST;
        if (!host || host === '192.168.88.1') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'cloud_offline_notice',
                    message:
                      'This remote MCP instance (https://mikrotik-skill.vercel.app) operates in air-gapped zero-credential knowledge mode. To execute live queries against a private router on your local network, run the local MCP server directly: npx mikrotik-skill mcp',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        try {
          const cfg = loadRouterConfig();
          const conn = new ConnectionManager(cfg);
          if (name === 'mikrotik_test_connection') {
            const res = await conn.testConnection();
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          } else {
            const auditor = new SecurityAuditor(conn);
            const rep = await auditor.runFullAudit();
            return { content: [{ type: 'text', text: JSON.stringify(rep, null, 2) }] };
          }
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Live query error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  });

  return server;
}
