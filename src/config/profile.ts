import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

export const RouterConfigSchema = z.object({
  host: z.string().min(1, 'Host cannot be empty'),
  user: z.string().min(1, 'User cannot be empty'),
  password: z.string(),
  restPort: z.number().int().positive().default(443),
  useSsl: z.boolean().default(true),
  apiPort: z.number().int().positive().default(8728),
  apiSslPort: z.number().int().positive().default(8729),
  preferBinary: z.boolean().default(false),
  watchdogTimeout: z.number().int().min(10).max(300).default(30),
  wanPrimaryTable: z.string().default('to_ISP1'),
  wanSecondaryTable: z.string().default('to_ISP2'),
  localBypassList: z.string().default('LOCAL_BYPASS'),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

export function loadRouterConfig(overrides?: Partial<RouterConfig>): RouterConfig {
  const envHost = process.env.ROUTEROS_HOST || '192.168.88.1';
  const envUser = process.env.ROUTEROS_USER || 'admin';
  const envPass = process.env.ROUTEROS_PASSWORD || '';
  const envRestPort = process.env.ROUTEROS_REST_PORT ? parseInt(process.env.ROUTEROS_REST_PORT, 10) : 443;
  const envUseSsl = process.env.ROUTEROS_USE_SSL !== 'false';
  const envApiPort = process.env.ROUTEROS_API_PORT ? parseInt(process.env.ROUTEROS_API_PORT, 10) : 8728;
  const envApiSslPort = process.env.ROUTEROS_API_SSL_PORT ? parseInt(process.env.ROUTEROS_API_SSL_PORT, 10) : 8729;
  const envPreferBinary = process.env.ROUTEROS_PREFER_BINARY === 'true';
  const envWatchdogTimeout = process.env.ROUTEROS_WATCHDOG_TIMEOUT ? parseInt(process.env.ROUTEROS_WATCHDOG_TIMEOUT, 10) : 30;
  const envWanPrimary = process.env.WAN_PRIMARY_TABLE || 'to_ISP1';
  const envWanSecondary = process.env.WAN_SECONDARY_TABLE || 'to_ISP2';
  const envLocalBypass = process.env.LOCAL_BYPASS_LIST || 'LOCAL_BYPASS';

  const rawConfig = {
    host: envHost,
    user: envUser,
    password: envPass,
    restPort: envRestPort,
    useSsl: envUseSsl,
    apiPort: envApiPort,
    apiSslPort: envApiSslPort,
    preferBinary: envPreferBinary,
    watchdogTimeout: envWatchdogTimeout,
    wanPrimaryTable: envWanPrimary,
    wanSecondaryTable: envWanSecondary,
    localBypassList: envLocalBypass,
    ...overrides,
  };

  return RouterConfigSchema.parse(rawConfig);
}

export function sanitizeConfig(cfg: RouterConfig): Omit<RouterConfig, 'password'> & { password: string } {
  return {
    ...cfg,
    password: cfg.password ? '********' : '(none)',
  };
}

const PROFILES_DIR = path.join(os.homedir(), '.mtik');
const PROFILES_FILE = path.join(PROFILES_DIR, 'profiles.json');

export interface ProfilesStore {
  activeProfile?: string;
  profiles: Record<string, RouterConfig>;
}

export function loadProfilesStore(): ProfilesStore {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const content = fs.readFileSync(PROFILES_FILE, 'utf-8');
      return JSON.parse(content) as ProfilesStore;
    }
  } catch {
    // Return default empty store if unreadable
  }
  return { profiles: {} };
}

export function saveProfilesStore(store: ProfilesStore): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(store, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function saveProfile(name: string, config: RouterConfig, setActive: boolean = false): void {
  const store = loadProfilesStore();
  store.profiles[name] = config;
  if (setActive || !store.activeProfile) {
    store.activeProfile = name;
  }
  saveProfilesStore(store);
}

export function getProfile(name?: string): RouterConfig | null {
  const store = loadProfilesStore();
  const targetName = name || store.activeProfile;
  if (targetName && store.profiles[targetName]) {
    return store.profiles[targetName] || null;
  }
  return null;
}

export function setActiveProfile(name: string): boolean {
  const store = loadProfilesStore();
  if (store.profiles[name]) {
    store.activeProfile = name;
    saveProfilesStore(store);
    return true;
  }
  return false;
}

export function listProfiles(): { name: string; active: boolean; host: string; user: string }[] {
  const store = loadProfilesStore();
  return Object.entries(store.profiles).map(([name, cfg]) => ({
    name,
    active: name === store.activeProfile,
    host: cfg.host,
    user: cfg.user,
  }));
}

export interface InventoryDevice {
  name: string;
  host: string;
  user: string;
  port: number;
  transport: 'rest' | 'api';
  source: 'inventory' | 'profile' | 'env';
}

function resolveEnvVar(val: string): string {
  if (val.startsWith('${') && val.endsWith('}')) {
    const key = val.slice(2, -1);
    return process.env[key] || '';
  }
  if (val.startsWith('$')) {
    const key = val.slice(1);
    return process.env[key] || '';
  }
  return val;
}

export function parseYamlInventory(content: string): Record<string, RouterConfig> {
  const devices: Record<string, RouterConfig> = {};
  const lines = content.split(/\r?\n/);
  let currentDevice: Partial<RouterConfig> & { name?: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- name:') || trimmed.startsWith('name:')) {
      if (currentDevice && currentDevice.name && currentDevice.host) {
        try {
          devices[currentDevice.name] = loadRouterConfig(currentDevice);
        } catch {
          // Skip invalid
        }
      }
      const nameMatch = trimmed.match(/name:\s*["']?([^"'\s]+)["']?/);
      currentDevice = { name: nameMatch ? nameMatch[1] : undefined };
      continue;
    }

    if (!currentDevice) continue;

    const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*["']?([^"']+)["']?$/);
    if (kv && kv[1] && kv[2]) {
      const key = kv[1];
      const rawVal = resolveEnvVar(kv[2].trim());

      if (key === 'host') currentDevice.host = rawVal;
      else if (key === 'user') currentDevice.user = rawVal;
      else if (key === 'password') currentDevice.password = rawVal;
      else if (key === 'restPort') currentDevice.restPort = parseInt(rawVal, 10);
      else if (key === 'apiPort') currentDevice.apiPort = parseInt(rawVal, 10);
      else if (key === 'useSsl') currentDevice.useSsl = rawVal !== 'false';
      else if (key === 'preferBinary') currentDevice.preferBinary = rawVal === 'true';
    }
  }

  if (currentDevice && currentDevice.name && currentDevice.host) {
    try {
      devices[currentDevice.name] = loadRouterConfig(currentDevice);
    } catch {
      // Skip invalid
    }
  }

  return devices;
}

export function loadInventory(): Record<string, RouterConfig> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'inventory.yml'),
    path.join(cwd, 'inventory.yaml'),
    path.join(cwd, 'inventory.json'),
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        if (file.endsWith('.json')) {
          const parsed = JSON.parse(raw);
          const devList = Array.isArray(parsed.devices) ? parsed.devices : [];
          const res: Record<string, RouterConfig> = {};
          for (const d of devList) {
            if (d.name && d.host) {
              res[d.name] = loadRouterConfig(d);
            }
          }
          return res;
        } else {
          return parseYamlInventory(raw);
        }
      } catch {
        // Ignore parsing errors
      }
    }
  }
  return {};
}

export function getDeviceConfig(deviceName?: string): RouterConfig {
  if (!deviceName) {
    const profile = getProfile();
    return profile || loadRouterConfig();
  }

  // 1. Check inventory
  const inventory = loadInventory();
  if (inventory[deviceName]) {
    return inventory[deviceName]!;
  }

  // 2. Check profile store
  const profile = getProfile(deviceName);
  if (profile) {
    return profile;
  }

  // Fallback to active default
  return loadRouterConfig();
}

export function listAllDevices(): InventoryDevice[] {
  const devices: InventoryDevice[] = [];
  const seen = new Set<string>();

  // From inventory
  const inventory = loadInventory();
  for (const [name, cfg] of Object.entries(inventory)) {
    devices.push({
      name,
      host: cfg.host,
      user: cfg.user,
      port: cfg.preferBinary ? cfg.apiPort : cfg.restPort,
      transport: cfg.preferBinary ? 'api' : 'rest',
      source: 'inventory',
    });
    seen.add(name);
  }

  // From profiles
  const profiles = listProfiles();
  for (const p of profiles) {
    if (!seen.has(p.name)) {
      const cfg = getProfile(p.name);
      devices.push({
        name: p.name,
        host: p.host,
        user: p.user,
        port: cfg?.preferBinary ? cfg.apiPort : (cfg?.restPort || 443),
        transport: cfg?.preferBinary ? 'api' : 'rest',
        source: 'profile',
      });
      seen.add(p.name);
    }
  }

  // Current default env if empty
  if (devices.length === 0) {
    const defaultCfg = loadRouterConfig();
    devices.push({
      name: 'default',
      host: defaultCfg.host,
      user: defaultCfg.user,
      port: defaultCfg.preferBinary ? defaultCfg.apiPort : defaultCfg.restPort,
      transport: defaultCfg.preferBinary ? 'api' : 'rest',
      source: 'env',
    });
  }

  return devices;
}

