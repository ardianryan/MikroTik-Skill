import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { RouterConfig } from './profile.js';
import { loadRouterConfig } from './profile.js';

export interface FleetDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  passwordEncrypted: string;
  useSsl: boolean;
  preferBinary: boolean;
  model?: string;
  tags?: string[];
  lastSeen?: string;
}

export interface FleetStore {
  activeDevice: string;
  devices: FleetDevice[];
}

const FLEET_DIR = path.join(os.homedir(), '.mikrotik-skill');
const FLEET_FILE = path.join(FLEET_DIR, 'fleet.json');

// Derive a host-local encryption key so credentials are never plain on disk
function getEncryptionKey(): Buffer {
  const machineId = `${os.hostname()}-${os.userInfo().username}-mikrotik-fleet-v1`;
  return crypto.createHash('sha256').update(machineId).digest();
}

/**
 * Encrypt a plaintext password using AES-256-GCM.
 */
export function encryptPassword(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an encrypted password.
 */
export function decryptPassword(ciphertext: string): string {
  if (!ciphertext) return '';
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return ciphertext; // Fallback if plain
    }
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = decipher.update(encryptedText, 'hex', 'utf8') + decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}

/**
 * Ensure storage directory exists with restricted user-only permissions (0700).
 */
function ensureStorageDir(): void {
  try {
    if (!fs.existsSync(FLEET_DIR)) {
      fs.mkdirSync(FLEET_DIR, { recursive: true, mode: 0o700 });
    }
  } catch {
    // Fallback if home directory is read-only
  }
}

/**
 * Load fleet store from disk, or initialize from environment variables.
 */
export function getFleetStore(): FleetStore {
  ensureStorageDir();

  if (fs.existsSync(FLEET_FILE)) {
    try {
      const raw = fs.readFileSync(FLEET_FILE, 'utf8');
      const parsed = JSON.parse(raw) as FleetStore;
      if (Array.isArray(parsed.devices)) {
        return parsed;
      }
    } catch {
      // Fallback on corrupt file
    }
  }

  // Seed default device from current .env if available
  const defaultCfg = loadRouterConfig();
  const defaultDevice: FleetDevice = {
    id: 'dev-default',
    name: 'default',
    host: defaultCfg.host,
    port: defaultCfg.restPort,
    user: defaultCfg.user,
    passwordEncrypted: encryptPassword(defaultCfg.password),
    useSsl: defaultCfg.useSsl,
    preferBinary: defaultCfg.preferBinary,
    model: 'MikroTik Router',
    tags: ['default'],
  };

  const initialStore: FleetStore = {
    activeDevice: 'default',
    devices: [defaultDevice],
  };

  saveFleetStore(initialStore);
  return initialStore;
}

/**
 * Persist fleet store to disk with restricted permissions (0600).
 */
export function saveFleetStore(store: FleetStore): void {
  ensureStorageDir();
  try {
    fs.writeFileSync(FLEET_FILE, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ignore write errors in read-only environments
  }
}

/**
 * Register a new router device into the fleet.
 */
export function addFleetDevice(device: {
  name: string;
  host: string;
  port?: number;
  user: string;
  password?: string;
  useSsl?: boolean;
  preferBinary?: boolean;
  model?: string;
  tags?: string[];
}): FleetDevice {
  const store = getFleetStore();
  const cleanName = device.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  // Check duplicate
  const existingIdx = store.devices.findIndex((d) => d.name === cleanName);
  const newDevice: FleetDevice = {
    id: `dev-${Date.now().toString(36)}`,
    name: cleanName,
    host: device.host.trim(),
    port: device.port || 443,
    user: device.user.trim(),
    passwordEncrypted: encryptPassword(device.password || ''),
    useSsl: device.useSsl !== false,
    preferBinary: Boolean(device.preferBinary),
    model: device.model || 'MikroTik E60iUGS',
    tags: device.tags || ['noc'],
    lastSeen: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    store.devices[existingIdx] = newDevice;
  } else {
    store.devices.push(newDevice);
  }

  // Set as active device
  store.activeDevice = cleanName;
  saveFleetStore(store);
  return newDevice;
}

/**
 * Delete a router from fleet.
 */
export function removeFleetDevice(name: string): boolean {
  const store = getFleetStore();
  const target = name.trim().toLowerCase();
  const initialLen = store.devices.length;
  store.devices = store.devices.filter((d) => d.name !== target);

  if (store.devices.length < initialLen) {
    if (store.activeDevice === target) {
      store.activeDevice = store.devices[0]?.name || '';
    }
    saveFleetStore(store);
    return true;
  }
  return false;
}

/**
 * Switch active target router in fleet.
 */
export function setActiveFleetDevice(name: string): boolean {
  const store = getFleetStore();
  const target = name.trim().toLowerCase();
  const exists = store.devices.some((d) => d.name === target);
  if (exists) {
    store.activeDevice = target;
    saveFleetStore(store);
    return true;
  }
  return false;
}

/**
 * Retrieve currently active router device.
 */
export function getActiveFleetDevice(): FleetDevice | null {
  const store = getFleetStore();
  return store.devices.find((d) => d.name === store.activeDevice) || store.devices[0] || null;
}

/**
 * Retrieve specific device by name.
 */
export function getFleetDevice(name: string): FleetDevice | null {
  const store = getFleetStore();
  const target = name.trim().toLowerCase();
  return store.devices.find((d) => d.name === target) || null;
}

/**
 * Convert FleetDevice into standard RouterConfig for ConnectionManager.
 */
export function fleetDeviceToRouterConfig(device: FleetDevice): RouterConfig {
  return loadRouterConfig({
    host: device.host,
    user: device.user,
    password: decryptPassword(device.passwordEncrypted),
    restPort: device.port,
    useSsl: device.useSsl,
    preferBinary: device.preferBinary,
  });
}
