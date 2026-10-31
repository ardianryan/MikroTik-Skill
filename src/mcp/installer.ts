import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RouterConfig } from '../config/profile.js';

export type IdeTarget = 'antigravity' | 'claude' | 'cursor' | 'windsurf' | 'all';

export interface InstallOptions {
  target?: IdeTarget;
  useGlobal?: boolean;
  config?: RouterConfig;
}

export interface InstallResult {
  ide: string;
  configPath: string;
  success: boolean;
  error?: string;
}

export class McpInstaller {
  static getIdeConfigPaths(): Record<Exclude<IdeTarget, 'all'>, string> {
    const home = os.homedir();
    const isMac = os.platform() === 'darwin';

    const claudePath = isMac
      ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(process.env.APPDATA || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');

    return {
      antigravity: path.join(home, '.gemini', 'config', 'mcp_config.json'),
      claude: claudePath,
      cursor: path.join(home, '.cursor', 'mcp.json'),
      windsurf: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    };
  }

  static buildServerConfig(options: InstallOptions): Record<string, unknown> {
    const env: Record<string, string> = {};
    if (options.config) {
      env.ROUTEROS_HOST = options.config.host;
      env.ROUTEROS_USER = options.config.user;
      env.ROUTEROS_PASSWORD = options.config.password;
      env.ROUTEROS_REST_PORT = String(options.config.restPort);
      env.ROUTEROS_USE_SSL = String(options.config.useSsl);
      env.ROUTEROS_API_PORT = String(options.config.apiPort);
    }

    if (options.useGlobal) {
      return {
        command: 'mtik-mcp',
        args: [],
        env: Object.keys(env).length > 0 ? env : undefined,
      };
    }

    const scriptPath = path.resolve(import.meta.dirname, 'index.js');
    return {
      command: 'node',
      args: [scriptPath],
      env: Object.keys(env).length > 0 ? env : undefined,
    };
  }

  static syncAntigravitySkill(): boolean {
    try {
      const sourceDir = path.resolve(import.meta.dirname, '../../.agents/skills/mikrotik');
      const targetDir = path.join(os.homedir(), '.gemini', 'config', 'skills', 'mikrotik');

      if (fs.existsSync(sourceDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.cpSync(sourceDir, targetDir, { recursive: true });
        return true;
      }
    } catch {
      // Non-fatal if global directory cannot be written
    }
    return false;
  }

  static installForIde(ide: Exclude<IdeTarget, 'all'>, options: InstallOptions): InstallResult {
    const configPath = this.getIdeConfigPaths()[ide];

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let existingContent: Record<string, unknown> = { mcpServers: {} };
      if (fs.existsSync(configPath)) {
        const text = fs.readFileSync(configPath, 'utf-8').trim();
        if (text) {
          try {
            existingContent = JSON.parse(text) as Record<string, unknown>;
          } catch {
            throw new Error('Existing IDE configuration is invalid; refusing to overwrite it');
          }
        }
      }

      if (!existingContent.mcpServers || typeof existingContent.mcpServers !== 'object') {
        existingContent.mcpServers = {};
      }

      const mcpServers = existingContent.mcpServers as Record<string, unknown>;
      mcpServers.mikrotik = this.buildServerConfig(options);

      fs.writeFileSync(configPath, JSON.stringify(existingContent, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.chmodSync(configPath, 0o600);

      if (ide === 'antigravity') {
        this.syncAntigravitySkill();
      }

      return {
        ide,
        configPath,
        success: true,
      };
    } catch (err) {
      return {
        ide,
        configPath,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  static install(options: InstallOptions = {}): InstallResult[] {
    const target = options.target || 'all';

    if (target === 'all') {
      const ides: Exclude<IdeTarget, 'all'>[] = ['antigravity', 'cursor', 'claude', 'windsurf'];
      return ides.map((ide) => this.installForIde(ide, options));
    }

    return [this.installForIde(target, options)];
  }
}
