import fs from 'node:fs';
import path from 'node:path';
import { type Command } from 'commander';
import chalk from 'chalk';
import type { CliContext } from '../common.js';
import { ConnectionManager } from '../../client/connection-manager.js';
import { ConfigSanitizer } from '../../safety/sanitizer.js';
import { ChatPromptExporter } from '../../safety/prompt-export.js';
import { MikroTikHttpServer } from '../../server/http.js';
import { OpenApiGenerator } from '../../server/openapi.js';

export function registerServerCommands(program: Command, ctx: CliContext): void {
  program
    .command('exec')
    .alias('run')
    .description('Preview or interactively apply a RouterOS CLI script with explicit rollback.')
    .argument('<script>', 'The RouterOS script command to execute')
    .action(async (script) => {
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
      try {
        console.log(chalk.blue('Preparing guarded router execution...'));
        const res = await conn.executeScript(script);
        if (await ctx.reportMutation(Promise.resolve(res))) return;
        console.log(chalk.green('✔ Command executed successfully.'));
        if (res && (typeof res !== 'object' || Object.keys(res as object).length > 0)) {
          console.log(ConfigSanitizer.sanitizeJson(res));
        }
      } catch (err) {
        console.error(chalk.red(`Execution failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
      const config = ctx.activeConfig();
      const conn = new ConnectionManager(config, ctx.cliMutationOptions(config));
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
        console.error(chalk.red(`REST call failed: ${ConfigSanitizer.sanitizeText(err instanceof Error ? err.message : String(err))}`));
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
    .option('--host <address>', 'HTTP bind address', '127.0.0.1')
    .option('--url <url>', 'External gateway origin behind a trusted proxy')
    .action((opts) => {
      const port = parseInt(opts.port, 10) || 3000;
      const server = new MikroTikHttpServer({ port, serverUrl: opts.url });
      server.listen(port, opts.host);
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
}
