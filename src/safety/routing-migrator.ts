export interface MigrationRule {
  v6Command: string;
  v7Command: string;
  chain: string;
}

export interface RoutingMigrationResult {
  totalConverted: number;
  migratedRules: MigrationRule[];
  script: string;
  warnings: string[];
}

export class RoutingMigrator {
  /**
   * Transpiles RouterOS v6 legacy routing filter commands into RouterOS v7 conditional rules.
   */
  static migrateScript(v6Script: string): RoutingMigrationResult {
    const lines = v6Script.split('\n');
    const migratedRules: MigrationRule[] = [];
    const warnings: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (!line.includes('/routing filter') && !line.includes('routing filter add')) {
        continue;
      }

      try {
        const parsed = this.parseV6Filter(line);
        if (parsed) {
          migratedRules.push(parsed);
        }
      } catch (err) {
        warnings.push(`Could not parse rule: "${line}" (${(err as Error).message})`);
      }
    }

    const scriptLines = [
      `# MikroTik RouterOS v7 Migrated Routing Filter Rules`,
      `# Converted ${migratedRules.length} legacy v6 rule(s) to v7 if-then syntax`,
      ``,
      `/routing filter rule`,
    ];

    for (const r of migratedRules) {
      scriptLines.push(r.v7Command);
    }

    return {
      totalConverted: migratedRules.length,
      migratedRules,
      script: scriptLines.join('\n'),
      warnings,
    };
  }

  private static parseV6Filter(line: string): MigrationRule | null {
    // Extract key-value pairs or tokens
    const tokens = line.replace(/^\/routing filter\s+add\s+/, '').replace(/^add\s+/, '').trim();
    if (!tokens) return null;

    const parts = tokens.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const params: Record<string, string> = {};

    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > -1) {
        const k = part.substring(0, eqIdx);
        const v = part.substring(eqIdx + 1).replace(/^"|"$/g, '');
        params[k] = v;
      }
    }

    const chain = params['chain'] || 'dynamic-in';
    const conditions: string[] = [];
    const actions: string[] = [];

    // Prefix condition
    if (params['prefix']) {
      const pfx = params['prefix'];
      if (params['prefix-length']) {
        const len = params['prefix-length'].replace('-', '..');
        conditions.push(`dst in ${pfx} && dst-len in ${len}`);
      } else {
        conditions.push(`dst in ${pfx}`);
      }
    }

    // Protocol condition
    if (params['protocol']) {
      conditions.push(`protocol == ${params['protocol']}`);
    }

    // Actions & Setters
    if (params['set-bgp-weight']) {
      actions.push(`set bgp-weight ${params['set-bgp-weight']};`);
    }
    if (params['set-distance']) {
      actions.push(`set distance ${params['set-distance']};`);
    }
    if (params['set-bgp-local-pref']) {
      actions.push(`set bgp-local-pref ${params['set-bgp-local-pref']};`);
    }
    if (params['set-route-comment']) {
      actions.push(`set comment "${params['set-route-comment']}";`);
    }

    // Terminal Action
    const act = (params['action'] || 'accept').toLowerCase();
    if (act === 'discard' || act === 'drop' || act === 'reject') {
      actions.push('reject;');
    } else if (act === 'passthrough') {
      actions.push('continue;');
    } else {
      actions.push('accept;');
    }

    const condStr = conditions.length > 0 ? conditions.join(' && ') : '';
    const bodyStr = actions.join(' ');

    const v7Rule = condStr ? `if (${condStr}) { ${bodyStr} }` : bodyStr;
    const v7Command = `add chain=${chain} rule="${v7Rule}"`;

    return {
      v6Command: line,
      v7Command,
      chain,
    };
  }
}
