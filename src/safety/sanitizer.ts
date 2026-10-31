export class ConfigSanitizer {
  private static readonly MAC_REGEX = /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g;
  private static readonly SERIAL_REGEX = /(["']?(?:serial(?:-|\s*)number|serial)["']?\s*[:=]\s*"?)([A-Za-z0-9]+)("?)/gi;
  private static readonly SOFTWARE_ID_REGEX = /(["']?(?:software(?:-|\s*)id)["']?\s*[:=]\s*"?)([A-Za-z0-9-]+)("?)/gi;
  private static readonly PASSWORD_REGEX = /(?<![\w-])(["']?([\w-]+)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;,}]+)/g;
  private static readonly ZEROTIER_ID_REGEX = /(["']?network["']?\s*[:=]\s*"?)([0-9a-fA-F]{16})("?)/gi;
  private static readonly CERTIFICATE_REGEX = /(["']?certificate["']?\s*[:=]\s*"?)([^"\s;]+)("?)/gi;
  private static readonly TUNNEL_TOKEN_REGEX = /(["']?TUNNEL_TOKEN["']?\s*[:=]\s*"?)([^"\s;]+)("?)/gi;

  static sanitizeText(rawConfig: string): string {
    let sanitized = rawConfig;

    // 1. Redact MAC addresses
    sanitized = sanitized.replace(this.MAC_REGEX, 'XX:XX:XX:XX:XX:XX');

    // 2. Redact serial numbers and software IDs
    sanitized = sanitized.replace(this.SERIAL_REGEX, '$1[REDACTED_SERIAL]$3');
    sanitized = sanitized.replace(this.SOFTWARE_ID_REGEX, '$1[REDACTED_ID]$3');

    // 3. Redact passwords, secrets, pre-shared keys
    sanitized = sanitized.replace(this.PASSWORD_REGEX, (match, prefix: string, key: string, value: string) => /password|passwd|secret|private[-_]?key|preshared[-_]?key|pre[-_]?shared[-_]?key|passphrase|token|authorization|api[-_]?key/i.test(key) ? `${prefix}${value.startsWith('"') ? '"********"' : value.startsWith("'") ? "'********'" : '********'}` : match);
    sanitized = sanitized.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '[REDACTED_AUTH]');
    sanitized = sanitized.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

    // 4. Redact ZeroTier network IDs
    sanitized = sanitized.replace(this.ZEROTIER_ID_REGEX, '$1[REDACTED_ZT_NETWORK]$3');

    // 5. Redact certificate and token values
    sanitized = sanitized.replace(this.CERTIFICATE_REGEX, '$1server_cert$3');
    sanitized = sanitized.replace(this.TUNNEL_TOKEN_REGEX, '$1********$3');

    return sanitized;
  }

  static sanitizeOutput(text: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return this.sanitizeText(text); }
    return JSON.stringify(this.sanitizeJson(parsed), null, 2);
  }

  static sanitizeObject<T extends Record<string, unknown>>(data: T): T {
    return this.sanitizeJson(data);
  }

  static sanitizeJson<T>(data: T): T {
    const visited = new WeakSet<object>();
    const visit = (value: unknown, depth: number): unknown => {
      if (depth > 64) throw new Error('Sanitization depth exceeded');
      if (typeof value === 'string') return this.sanitizeText(value);
      if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
      if (typeof value !== 'object') throw new Error('Unsupported value for sanitization');
      if (visited.has(value)) throw new Error('Cyclic value cannot be sanitized');
      visited.add(value);
      try {
        if (Array.isArray(value)) return value.map((entry) => visit(entry, depth + 1));
        const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const [key, entry] of Object.entries(value)) {
          output[key] = /password|passwd|secret|private[-_]?key|preshared[-_]?key|pre[-_]?shared[-_]?key|passphrase|token|authorization|api[-_]?key/i.test(key) ? '********' : /serial/i.test(key) ? '[REDACTED_SERIAL]' : /software[-_ ]?id/i.test(key) ? '[REDACTED_ID]' : visit(entry, depth + 1);
        }
        return output;
      } finally { visited.delete(value); }
    };
    return visit(data, 0) as T;
  }
}
