import { z } from 'zod';
import { MAX_BODY_BYTES, parseKnowledgeArgs, validateJsonBudget } from '../safety/validation.js';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
import { HotspotPortalGenerator } from '../safety/hotspot-generator.js';
import { OpenApiGenerator } from './openapi.js';

export interface HttpServerOptions {
  port?: number;
  allowedOrigins?: string[];
  serverUrl?: string;
}

export class MikroTikHttpServer {
  private serverUrl: string;
  private allowedOrigins: string[];
  private externalUrl: boolean;
  private sseTransports = new Map<string, SSEServerTransport>();

  constructor(options: HttpServerOptions = {}) {
    this.externalUrl = Boolean(options.serverUrl || process.env.VERCEL_URL);
    this.allowedOrigins = (options.allowedOrigins ?? []).map((origin) => new URL(origin).origin);
    this.serverUrl = options.serverUrl || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    this.serverUrl = new URL(this.serverUrl).origin;
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    });
    res.end(JSON.stringify(data, null, 2));
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body exceeds 256 KiB'), { status: 413 });
      chunks.push(bytes);
    }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
    validateJsonBudget(data);
    return data;
  }

  private async parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const data = await this.readJsonBody(req);
    const url = new URL(req.url || '/', this.serverUrl);
    const route = url.searchParams.get('path') || url.pathname;
    const tool = ({
      validate: 'mikrotik_validate_routing_mark', sanitize: 'mikrotik_sanitize_config',
      pcc: 'mikrotik_calculate_pcc', wireguard: 'mikrotik_provision_wireguard',
      'migrate-filter': 'mikrotik_migrate_filter', lint: 'mikrotik_lint_config',
      hotspot: 'mikrotik_generate_hotspot_portal',
    } as Record<string, string>)[route.split('/').at(-1) || ''];
    if (!tool) throw Object.assign(new Error('Unknown endpoint'), { status: 404 });
    return parseKnowledgeArgs(tool, data);
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try { await this.dispatch(req, res); }
    catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof z.ZodError ? 400 :
        typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
      this.sendJson(res, status, { error: status === 500 ? 'Request could not be processed' : status === 413 ? 'Request body exceeds 256 KiB' : 'Invalid request parameters' });
    }
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host || '';
    const configuredHost = new URL(this.serverUrl).host;
    if (host !== configuredHost) {
      this.sendJson(res, 403, { error: 'Untrusted Host header' });
      return;
    }
    const requestOrigin = req.headers.origin;
    if (requestOrigin && ![this.serverUrl, ...this.allowedOrigins].includes(requestOrigin)) {
      this.sendJson(res, 403, { error: 'Untrusted Origin header' });
      return;
    }
    if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    const origin = this.serverUrl;
    const reqUrl = new URL(req.url || '/', origin);
    const pathname = reqUrl.searchParams.get('path') || reqUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      });
      res.end();
      return;
    }

    if ((pathname === '/' || pathname === '/index.html') && method === 'GET') {
      const isHtmlRequest = req.headers.accept?.includes('text/html') || pathname === '/index.html';
      if (isHtmlRequest) {
        const publicPath = path.resolve(process.cwd(), 'public', 'index.html');
        if (fs.existsSync(publicPath)) {
          const html = fs.readFileSync(publicPath, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
          });
          res.end(html);
          return;
        }
      }
    }

    if ((pathname === '/' || pathname === '/api' || pathname === '/api/') && method === 'GET') {
      this.sendJson(res, 200, {
        name: 'mikrotik-skill',
        version: '1.3.0',
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
      if (this.sseTransports.size >= 100) { this.sendJson(res, 503, { error: 'Session capacity reached' }); return; }
      const transport = new SSEServerTransport(endpoint, res, { enableDnsRebindingProtection: true, allowedHosts: [host], allowedOrigins: [this.serverUrl, ...this.allowedOrigins] });
      this.sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => {
        this.sseTransports.delete(transport.sessionId);
      };
      const mcpServer = createRemoteMcpServer();
      const expiry = setTimeout(() => { void mcpServer.close().catch(() => {}); this.sseTransports.delete(transport.sessionId); }, 15 * 60 * 1000);
      expiry.unref();
      res.once('close', () => { clearTimeout(expiry); this.sseTransports.delete(transport.sessionId); void mcpServer.close().catch(() => {}); });
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
      await transport.handlePostMessage(req, res, await this.readJsonBody(req));
      return;
    }

    if (pathname === '/mcp' || pathname === '/api/mcp') {
      const streamTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        maxRequestBodySize: MAX_BODY_BYTES,
        enableDnsRebindingProtection: true,
        allowedHosts: [host],
        allowedOrigins: [this.serverUrl, ...this.allowedOrigins],
      });
      const mcpServer = createRemoteMcpServer();
      const close = () => { void mcpServer.close().catch(() => {}); };
      res.once('close', close);
      await mcpServer.connect(streamTransport);
      await streamTransport.handleRequest(req, res, method === 'POST' ? await this.readJsonBody(req) : undefined);
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

      const result = MangleOrderEngine.validateRoutingMark(routingMark, existingTables);
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

    if (pathname === '/api/v1/knowledge/hotspot' && method === 'POST') {
      const body = await this.parseBody(req);
      const result = HotspotPortalGenerator.generate({
        venueName: body.venueName as string | undefined,
        model: body.model as import('../safety/hotspot-generator.js').HotspotAuthModel | undefined,
        enableTrial: body.enableTrial as boolean | undefined,
        trialUptime: body.trialUptime as string | undefined,
        trialRateLimit: body.trialRateLimit as string | undefined,
        voucherRateLimit: body.voucherRateLimit as string | undefined,
        paymentGateway: body.paymentGateway as import('../safety/hotspot-generator.js').HotspotGeneratorOptions['paymentGateway'],
        dnsName: body.dnsName as string | undefined,
        googleAuthUrl: body.googleAuthUrl as string | undefined,
      });
      this.sendJson(res, 200, result);
      return;
    }

    this.sendJson(res, 404, { error: 'Endpoint not found', path: pathname });
  }

  listen(port: number = 3000, host: string = '127.0.0.1'): http.Server {
    const server = http.createServer((req, res) => { void this.handleRequest(req, res); });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.on('close', () => { for (const transport of this.sseTransports.values()) void transport.close().catch(() => {}); this.sseTransports.clear(); });
    server.listen(port, host, () => {
      const address = server.address();
      if (!this.externalUrl && address && typeof address !== 'string') this.serverUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${address.port}`;
    });
    return server;
  }
}
