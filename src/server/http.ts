import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRemoteMcpServer } from './mcp.js';
import { ConfigSanitizer } from '../safety/sanitizer.js';
import { CertifiedTemplateGenerator, type CertificationTrack } from '../safety/templates.js';
import { MangleOrderEngine } from '../safety/order-engine.js';
import { ChatPromptExporter } from '../safety/prompt-export.js';
import { PccCalculator, type PccOptions } from '../safety/pcc-calculator.js';
import { WireGuardProvisioner, type WireGuardClientOptions } from '../safety/wireguard.js';
import { RoutingMigrator } from '../safety/routing-migrator.js';
import { RouterOsLinter } from '../safety/linter.js';
import { OpenApiGenerator } from './openapi.js';

export interface HttpServerOptions {
  port?: number;
  apiKey?: string;
  serverUrl?: string;
}

export class MikroTikHttpServer {
  private serverUrl: string;
  private sseTransports = new Map<string, SSEServerTransport>();

  constructor(options: HttpServerOptions = {}) {
    this.serverUrl = options.serverUrl || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    });
    res.end(JSON.stringify(data, null, 2));
  }

  private async parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.host ? `http://${req.headers.host}` : this.serverUrl;
    const reqUrl = new URL(req.url || '/', origin);
    const pathname = reqUrl.searchParams.get('path') || reqUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      });
      res.end();
      return;
    }

    if ((pathname === '/' || pathname === '/api' || pathname === '/api/') && method === 'GET') {
      this.sendJson(res, 200, {
        name: 'mikrotik-skill',
        version: '1.1.0',
        mode: 'knowledge-and-intelligence',
        description: 'MikroTik RouterOS v7 Certified Knowledge, Remote MCP & OpenAPI Gateway. Zero router credentials required.',
        mcp: {
          sse: `${origin}/sse`,
          streamableHttp: `${origin}/mcp`,
        },
        openapi: `${origin}/openapi.json`,
        health: `${origin}/health`,
        tracks: `${origin}/api/v1/knowledge/tracks`,
      });
      return;
    }

    if ((pathname === '/sse' || pathname === '/api/sse') && method === 'GET') {
      const endpoint = '/api/messages';
      const transport = new SSEServerTransport(endpoint, res);
      this.sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => {
        this.sseTransports.delete(transport.sessionId);
      };
      const mcpServer = createRemoteMcpServer();
      await mcpServer.connect(transport);
      return;
    }

    if ((pathname === '/messages' || pathname === '/api/messages') && method === 'POST') {
      const sessionId = reqUrl.searchParams.get('sessionId') || '';
      const transport = this.sseTransports.get(sessionId);
      if (!transport) {
        this.sendJson(res, 404, { error: `MCP session '${sessionId}' not found or expired.` });
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    if (pathname === '/mcp' || pathname === '/api/mcp') {
      const streamTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcpServer = createRemoteMcpServer();
      await mcpServer.connect(streamTransport);
      await streamTransport.handleRequest(req, res);
      return;
    }

    if (pathname === '/health' && method === 'GET') {
      this.sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
      return;
    }

    if (pathname === '/openapi.json' && method === 'GET') {
      const spec = OpenApiGenerator.getSpecification(origin);
      this.sendJson(res, 200, spec);
      return;
    }

    if (pathname === '/api/v1/knowledge/tracks' && method === 'GET') {
      const tracks = CertifiedTemplateGenerator.list();
      this.sendJson(res, 200, tracks);
      return;
    }

    if (pathname === '/api/v1/knowledge/template' && method === 'GET') {
      const track = (reqUrl.searchParams.get('track') || '').toLowerCase() as CertificationTrack;
      const tpl = CertifiedTemplateGenerator.get(track);
      if (!tpl) {
        this.sendJson(res, 400, {
          error: 'Invalid or missing track parameter.',
          availableTracks: CertifiedTemplateGenerator.list().map((t) => t.track),
        });
        return;
      }
      this.sendJson(res, 200, tpl);
      return;
    }

    if (pathname === '/api/v1/knowledge/prompt' && method === 'GET') {
      const systemPrompt = ChatPromptExporter.getSystemPrompt();
      this.sendJson(res, 200, { systemPrompt });
      return;
    }

    if (pathname === '/api/v1/knowledge/validate' && method === 'POST') {
      const body = await this.parseBody(req);
      const routingMark = String(body.routingMark || '');
      const existingTables = Array.isArray(body.existingTables)
        ? body.existingTables.map((t) => ({ name: String(t), fib: true }))
        : [{ name: routingMark, fib: true }];

      if (!routingMark) {
        this.sendJson(res, 400, { error: 'Parameter "routingMark" is required.' });
        return;
      }

      const result = MangleOrderEngine.validateRoutingMark(routingMark, existingTables as any);
      this.sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/knowledge/sanitize' && method === 'POST') {
      const body = await this.parseBody(req);
      const configText = String(body.configText || '');
      if (!configText) {
        this.sendJson(res, 400, { error: 'Parameter "configText" is required.' });
        return;
      }

      const sanitized = ConfigSanitizer.sanitizeText(configText);
      this.sendJson(res, 200, { sanitized });
      return;
    }

    if (pathname === '/api/v1/knowledge/pcc' && method === 'POST') {
      const body = (await this.parseBody(req)) as unknown as PccOptions;
      if (!body.wans || !Array.isArray(body.wans) || body.wans.length < 2) {
        this.sendJson(res, 400, { error: 'Parameter "wans" must be an array of at least 2 WAN definitions with name and weight.' });
        return;
      }
      const result = PccCalculator.calculate(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/knowledge/wireguard' && method === 'POST') {
      const body = (await this.parseBody(req)) as unknown as WireGuardClientOptions;
      if (!body.clientName || !body.clientIp || !body.serverEndpoint || !body.serverPublicKey) {
        this.sendJson(res, 400, { error: 'Parameters "clientName", "clientIp", "serverEndpoint", and "serverPublicKey" are required.' });
        return;
      }
      const result = await WireGuardProvisioner.provisionClient(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/knowledge/migrate-filter' && method === 'POST') {
      const body = await this.parseBody(req);
      const script = String(body.script || '');
      if (!script) {
        this.sendJson(res, 400, { error: 'Parameter "script" containing legacy v6 routing filter rules is required.' });
        return;
      }
      const result = RoutingMigrator.migrateScript(script);
      this.sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/knowledge/lint' && method === 'POST') {
      const body = await this.parseBody(req);
      const script = String(body.script || '');
      if (!script) {
        this.sendJson(res, 400, { error: 'Parameter "script" containing RouterOS commands is required.' });
        return;
      }
      const result = RouterOsLinter.lint(script);
      this.sendJson(res, 200, result);
      return;
    }

    this.sendJson(res, 404, { error: 'Endpoint not found', path: pathname });
  }

  listen(port: number = 3000): http.Server {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    server.listen(port);
    return server;
  }
}
