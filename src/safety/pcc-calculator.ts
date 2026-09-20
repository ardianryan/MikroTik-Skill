export interface WanInput {
  name: string;
  gateway?: string;
  weight?: number;
  distance?: number;
}

export interface PccOptions {
  wans: WanInput[];
  lanInterface?: string;
  classifier?: 'both-addresses-and-ports' | 'both-addresses' | 'src-address' | 'dst-address';
  localBypassList?: string;
}

export interface PccResult {
  totalStreams: number;
  streamsPerWan: Record<string, number[]>;
  script: string;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export class PccCalculator {
  static calculate(options: PccOptions): PccResult {
    const wans = options.wans && options.wans.length >= 2 ? options.wans : [
      { name: 'ISP1', weight: 1, gateway: '192.168.1.1' },
      { name: 'ISP2', weight: 1, gateway: '192.168.2.1' },
    ];

    const lanInterface = options.lanInterface || 'bridge-lan';
    const classifier = options.classifier || 'both-addresses-and-ports';
    const localBypass = options.localBypassList || 'LOCAL_BYPASS';

    // Normalize weights by GCD
    const rawWeights = wans.map((w) => Math.max(1, Math.round(w.weight || 1)));
    const overallGcd = rawWeights.reduce((acc, curr) => gcd(acc, curr), rawWeights[0] || 1);
    const normalizedWeights = rawWeights.map((w) => w / overallGcd);
    const totalStreams = normalizedWeights.reduce((sum, w) => sum + w, 0);

    const streamsPerWan: Record<string, number[]> = {};
    let streamIndex = 0;

    for (let i = 0; i < wans.length; i++) {
      const wan = wans[i]!;
      const count = normalizedWeights[i]!;
      streamsPerWan[wan.name] = [];
      for (let s = 0; s < count; s++) {
        streamsPerWan[wan.name]!.push(streamIndex);
        streamIndex++;
      }
    }

    const lines: string[] = [
      `# MikroTik RouterOS v7 Multi-WAN PCC Load Balancing Script`,
      `# Generated for ${wans.length} WAN Interfaces (${totalStreams} Total Balanced Streams)`,
      `# Hierarchy: RFC1918 & DSTNAT Bypass at Index 0 -> PCC Rules -> Routing Marks`,
      ``,
      `# 1. Routing Tables (v7 requires fib=yes)`,
    ];

    for (const wan of wans) {
      lines.push(`/routing table add name=to_${wan.name} fib`);
    }

    lines.push(``, `# 2. RFC1918 Local Subnets Bypass List`);
    lines.push(`/ip firewall address-list`);
    lines.push(`add address=192.168.0.0/16 list=${localBypass}`);
    lines.push(`add address=10.0.0.0/8 list=${localBypass}`);
    lines.push(`add address=172.16.0.0/12 list=${localBypass}`);

    lines.push(``, `# 3. Mangle Rules (Strict Hierarchy Enforcement)`);
    lines.push(`/ip firewall mangle`);
    lines.push(`add chain=prerouting action=accept connection-nat-state=dstnat comment="Bypass DSTNAT / Port Forwarding"`);
    lines.push(`add chain=prerouting action=accept dst-address-list=${localBypass} comment="Bypass Inter-VLAN / Local RFC1918"`);

    lines.push(``, `# 4. Inbound Connection Marking (Preserves reply path for incoming WAN connections)`);
    for (const wan of wans) {
      lines.push(`add chain=prerouting in-interface=${wan.name} connection-state=new action=mark-connection new-connection-mark=${wan.name}_conn passthrough=yes comment="Inbound ${wan.name}"`);
    }

    lines.push(``, `# 5. Prerouting PCC Stream Classification (Weight Distribution: ${normalizedWeights.join(':')})`);
    for (const wan of wans) {
      const streams = streamsPerWan[wan.name] || [];
      for (const s of streams) {
        lines.push(
          `add chain=prerouting in-interface=${lanInterface} connection-mark=no-mark dst-address-type=!local ` +
          `per-connection-classifier=${classifier}:${totalStreams}/${s} ` +
          `action=mark-connection new-connection-mark=${wan.name}_conn passthrough=yes comment="${wan.name} Stream ${s + 1}/${totalStreams}"`
        );
      }
    }

    lines.push(``, `# 6. Routing Marks Assignment`);
    for (const wan of wans) {
      lines.push(`add chain=prerouting in-interface=${lanInterface} connection-mark=${wan.name}_conn action=mark-routing new-routing-mark=to_${wan.name} passthrough=no comment="Route to ${wan.name}"`);
      lines.push(`add chain=output connection-mark=${wan.name}_conn action=mark-routing new-routing-mark=to_${wan.name} passthrough=no comment="Router Local to ${wan.name}"`);
    }

    lines.push(``, `# 7. Default Routing & Failover Tables`);
    lines.push(`/ip route`);
    for (let i = 0; i < wans.length; i++) {
      const wan = wans[i]!;
      const gw = wan.gateway || `192.168.${i + 1}.1`;
      const dist = wan.distance || (i + 1);
      lines.push(`add dst-address=0.0.0.0/0 gateway=${gw} routing-table=to_${wan.name} check-gateway=ping comment="Default Gateway for ${wan.name}"`);
      lines.push(`add dst-address=0.0.0.0/0 gateway=${gw} distance=${dist} check-gateway=ping comment="Failover Distance ${dist} via ${wan.name}"`);
    }

    return {
      totalStreams,
      streamsPerWan,
      script: lines.join('\n'),
    };
  }
}
