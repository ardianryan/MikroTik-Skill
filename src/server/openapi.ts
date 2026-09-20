export class OpenApiGenerator {
  static getSpecification(serverUrl: string = 'https://your-deployment.vercel.app'): Record<string, unknown> {
    return {
      openapi: '3.1.0',
      info: {
        title: 'MikroTik RouterOS v7 Certified Knowledge & Intelligence API',
        description: 'Zero-credential certified knowledge engine for MikroTik RouterOS v7. Provides 10-track certification runbooks, template generation, mangle order validation, configuration sanitization, and system prompt intelligence for ChatGPT & Claude.',
        version: '1.1.0',
      },
      servers: [
        {
          url: serverUrl,
          description: 'Production Knowledge Server',
        },
      ],
      paths: {
        '/api/v1/knowledge/tracks': {
          get: {
            operationId: 'listCertificationTracks',
            summary: 'List all 10 official MikroTik Certification tracks and curriculum topics',
            description: 'Returns available certification tracks including MTCNA, MTCRE, MTCINE, MTCTCE, MTCSWE, MTCSE, MTCIPv6E, MTCUME, MTCEWE, and MTCWE.',
            responses: {
              '200': {
                description: 'List of all 10 certification tracks',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          track: { type: 'string' },
                          title: { type: 'string' },
                          description: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/template': {
          get: {
            operationId: 'generateTemplate',
            summary: 'Generate production configuration script for any of the 10 MikroTik Certification tracks',
            description: 'Produces certified, vendor-neutral RouterOS v7 configuration scripts adhering to official best practices.',
            parameters: [
              {
                name: 'track',
                in: 'query',
                required: true,
                schema: {
                  type: 'string',
                  enum: [
                    'mtcna',
                    'mtcre',
                    'mtcine',
                    'mtctce',
                    'mtcswe',
                    'mtcse',
                    'mtcipv6e',
                    'mtcume',
                    'mtcewe',
                    'mtcwe',
                  ],
                },
                description: 'Certification track code (e.g. mtcswe, mtcine, mtctce)',
              },
            ],
            responses: {
              '200': {
                description: 'Certified configuration template script',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        track: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        script: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/validate': {
          post: {
            operationId: 'validateMangleOrder',
            summary: 'Validate firewall mangle placement and FIB table registration offline',
            description: 'Analyzes proposed firewall mangle placement against the deterministic 4-tier hierarchy (Bypass -> Client Overrides -> PCC -> MSS Clamping) without connecting to a router.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['routingMark'],
                    properties: {
                      routingMark: { type: 'string', description: 'Proposed routing table name (e.g. to_ISP1)' },
                      existingTables: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of registered routing tables with fib=yes',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Validation result',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        valid: { type: 'boolean' },
                        reason: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/sanitize': {
          post: {
            operationId: 'sanitizeConfiguration',
            summary: 'Sanitize and redact sensitive identifiers from any raw RouterOS configuration text',
            description: 'Redacts MAC addresses, serial numbers, passwords, preshared keys, and VPN identifiers offline so configurations can be safely shared with AI.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['configText'],
                    properties: {
                      configText: { type: 'string', description: 'Raw RouterOS configuration text or script' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Sanitized configuration text',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        sanitized: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/prompt': {
          get: {
            operationId: 'getCertifiedPrompt',
            summary: 'Retrieve certified RouterOS v7 Senior Network Engineer system prompt',
            description: 'Returns the optimized engineering system prompt enforcing 1-click copy-pasteable script blocks and vendor-neutral naming.',
            responses: {
              '200': {
                description: 'System prompt content',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        systemPrompt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/pcc': {
          post: {
            operationId: 'calculatePcc',
            summary: 'Calculate N-WAN asymmetric PCC load balancing configuration for RouterOS v7',
            description: 'Computes GCD-normalized PCC streams, strict bypass ordering, and complete copy-pasteable RouterOS v7 configuration.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['wans'],
                    properties: {
                      wans: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['name'],
                          properties: {
                            name: { type: 'string' },
                            weight: { type: 'number' },
                            gateway: { type: 'string' },
                          },
                        },
                      },
                      lanInterface: { type: 'string' },
                      classifier: {
                        type: 'string',
                        enum: ['both-addresses-and-ports', 'both-addresses', 'src-address', 'dst-address'],
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'PCC calculation and RouterOS v7 script',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        totalStreams: { type: 'number' },
                        streamsPerWan: { type: 'object' },
                        script: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/wireguard': {
          post: {
            operationId: 'provisionWireGuard',
            summary: 'Provision Curve25519 Road-Warrior WireGuard peer keys, client .conf, and QR codes',
            description: 'Generates client Curve25519 keypairs, client .conf with keepalive, RouterOS v7 CLI commands, and web/terminal QR codes offline.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['clientName', 'clientIp', 'serverEndpoint', 'serverPublicKey'],
                    properties: {
                      clientName: { type: 'string' },
                      clientIp: { type: 'string' },
                      serverEndpoint: { type: 'string' },
                      serverPublicKey: { type: 'string' },
                      interfaceName: { type: 'string' },
                      dns: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Provisioned WireGuard peer data',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        clientPublicKey: { type: 'string' },
                        routerPeerCommand: { type: 'string' },
                        clientConfig: { type: 'string' },
                        qrDataUrl: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/migrate-filter': {
          post: {
            operationId: 'migrateRoutingFilter',
            summary: 'Transpile legacy RouterOS v6 routing filters to RouterOS v7 if-then syntax',
            description: 'Converts legacy v6 /routing filter add prefix/action rules to modern v7 /routing filter rule add rule="if (...) { ... }".',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['script'],
                    properties: {
                      script: { type: 'string', description: 'Legacy RouterOS v6 filter script' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Transpiled RouterOS v7 filter rules',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        convertedRules: { type: 'array', items: { type: 'string' } },
                        v7Script: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/v1/knowledge/lint': {
          post: {
            operationId: 'lintConfiguration',
            summary: 'Static security audit and credential leak detection for RouterOS .rsc scripts',
            description: 'Checks scripts for cleartext passwords, exposed keys, DNS open resolvers, deprecated syntax, and missing FIB routing tables.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['script'],
                    properties: {
                      script: { type: 'string', description: 'RouterOS .rsc script content' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Lint findings and pass/fail summary',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        passed: { type: 'boolean' },
                        findings: { type: 'array' },
                        summary: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }
}
