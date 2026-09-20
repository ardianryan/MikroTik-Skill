import crypto from 'node:crypto';
import QRCode from 'qrcode';

export interface WireGuardClientOptions {
  clientName: string;
  clientIp: string;
  serverEndpoint: string;
  serverPublicKey: string;
  interfaceName?: string;
  dns?: string;
  allowedIps?: string;
  presharedKey?: string;
  persistentKeepalive?: number;
}

export interface WireGuardProvisionResult {
  clientName: string;
  clientPrivateKey: string;
  clientPublicKey: string;
  presharedKey?: string;
  routerPeerCommand: string;
  clientConfig: string;
  qrTerminal: string;
  qrDataUrl: string;
}

export class WireGuardProvisioner {
  static generateKeypair(): { privateKey: string; publicKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' });

    return {
      privateKey: privRaw.subarray(privRaw.length - 32).toString('base64'),
      publicKey: pubRaw.subarray(pubRaw.length - 32).toString('base64'),
    };
  }

  static generatePresharedKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }

  static async provisionClient(options: WireGuardClientOptions): Promise<WireGuardProvisionResult> {
    const { privateKey, publicKey } = this.generateKeypair();
    const psk = options.presharedKey || this.generatePresharedKey();
    const wgInterface = options.interfaceName || 'wg0';
    const dns = options.dns || '10.10.0.1';
    const allowedIps = options.allowedIps || '0.0.0.0/0, ::/0';
    const keepalive = options.persistentKeepalive ?? 25;

    // Ensure client IP has proper mask
    const clientAddress = options.clientIp.includes('/') ? options.clientIp : `${options.clientIp}/32`;
    const routerAllowedAddress = clientAddress.endsWith('/32') ? clientAddress : `${clientAddress.split('/')[0]}/32`;

    // 1. RouterOS v7 CLI peer command
    const routerPeerCommand =
      `/interface wireguard peers add interface=${wgInterface} public-key="${publicKey}" ` +
      `preshared-key="${psk}" allowed-address=${routerAllowedAddress} comment="${options.clientName}"`;

    // 2. Client .conf format (standard WireGuard syntax)
    const clientConfigLines = [
      `[Interface]`,
      `PrivateKey = ${privateKey}`,
      `Address = ${clientAddress}`,
      `DNS = ${dns}`,
      ``,
      `[Peer]`,
      `PublicKey = ${options.serverPublicKey}`,
      `PresharedKey = ${psk}`,
      `Endpoint = ${options.serverEndpoint}`,
      `AllowedIPs = ${allowedIps}`,
      `PersistentKeepalive = ${keepalive}`,
    ];
    const clientConfig = clientConfigLines.join('\n');

    // 3. Generate QR codes (Terminal string & Web DataURL)
    const qrTerminal = await QRCode.toString(clientConfig, {
      type: 'terminal',
      small: true,
    });

    const qrDataUrl = await QRCode.toDataURL(clientConfig, {
      errorCorrectionLevel: 'M',
      margin: 2,
    });

    return {
      clientName: options.clientName,
      clientPrivateKey: privateKey,
      clientPublicKey: publicKey,
      presharedKey: psk,
      routerPeerCommand,
      clientConfig,
      qrTerminal,
      qrDataUrl,
    };
  }
}
