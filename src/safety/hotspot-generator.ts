export type HotspotAuthModel = 'voucher' | 'member' | 'dual' | 'all-in-one';

export interface HotspotGeneratorOptions {
  venueName?: string;
  model?: HotspotAuthModel;
  enableTrial?: boolean;
  trialUptime?: string;
  trialRateLimit?: string;
  voucherRateLimit?: string;
  googleAuthUrl?: string;
  paymentGateway?: 'midtrans' | 'xendit' | 'stripe' | 'none';
  dnsName?: string;
}

export interface HotspotGeneratedBundle {
  loginHtml: string;
  statusHtml: string;
  routerOsScript: string;
}

export class HotspotPortalGenerator {
  static generate(options: HotspotGeneratorOptions = {}): HotspotGeneratedBundle {
    const venue = options.venueName || 'High-Speed Wi-Fi';
    const model = options.model || 'all-in-one';
    const enableTrial = options.enableTrial !== false;
    const trialUptime = options.trialUptime || '30m';
    const trialRateLimit = options.trialRateLimit || '2M/1M';
    const voucherRateLimit = options.voucherRateLimit || '10M/5M';
    const dnsName = options.dnsName || 'wifi.venue.lan';
    const googleAuthUrl = options.googleAuthUrl || 'https://auth.yourvenue.com/login/google';

    const loginHtml = this.buildLoginHtml({
      venue,
      model,
      enableTrial,
      googleAuthUrl,
    });

    const statusHtml = this.buildStatusHtml({
      venue,
      dnsName,
    });

    const routerOsScript = this.buildRouterOsScript({
      model,
      enableTrial,
      trialUptime,
      trialRateLimit,
      voucherRateLimit,
      dnsName,
      paymentGateway: options.paymentGateway || 'none',
      hasGoogleAuth: model === 'all-in-one' || Boolean(options.googleAuthUrl),
    });

    return {
      loginHtml,
      statusHtml,
      routerOsScript,
    };
  }

  private static buildLoginHtml(opts: {
    venue: string;
    model: HotspotAuthModel;
    enableTrial: boolean;
    googleAuthUrl: string;
  }): string {
    const isVoucherOnly = opts.model === 'voucher';
    const isMemberOnly = opts.model === 'member';
    const isDualOrAll = opts.model === 'dual' || opts.model === 'all-in-one';
    const showSocial = opts.model === 'all-in-one';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${opts.venue} - Wi-Fi Portal</title>
  <style>
    :root {
      --bg: #090c10;
      --card-bg: #121824;
      --border: #21293a;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.25rem; }
    .portal-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 400px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .brand-header { text-align: center; margin-bottom: 1.75rem; }
    .brand-header h1 { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.35rem; }
    .brand-header p { font-size: 0.85rem; color: var(--text-muted); }
    .error-alert { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; padding: 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1.25rem; text-align: center; }
    ${isDualOrAll ? `
    .tab-bar { display: flex; background: #0c1017; padding: 4px; border-radius: 10px; margin-bottom: 1.5rem; border: 1px solid var(--border); }
    .tab-btn { flex: 1; padding: 8px 12px; background: transparent; border: none; color: var(--text-muted); font-size: 0.82rem; font-weight: 600; border-radius: 7px; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { background: var(--border); color: #fff; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    ` : ''}
    .field-group { margin-bottom: 1.1rem; }
    .field-group label { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.4rem; font-weight: 600; }
    .field-group input { width: 100%; padding: 0.8rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: #090c10; color: #fff; font-size: 0.95rem; }
    .field-group input:focus { outline: none; border-color: var(--primary); }
    .btn-submit { width: 100%; padding: 0.85rem; border-radius: 8px; border: none; background: var(--primary); color: #090c10; font-weight: 700; font-size: 0.92rem; cursor: pointer; transition: background 0.2s; margin-top: 0.5rem; }
    .btn-submit:hover { background: var(--primary-hover); }
    .divider { display: flex; align-items: center; text-align: center; margin: 1.5rem 0; color: #475569; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--border); }
    .divider span { padding: 0 10px; }
    .btn-social { width: 100%; padding: 0.8rem; border-radius: 8px; border: 1px solid var(--border); background: #161f30; color: #fff; font-weight: 600; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; transition: background 0.2s; }
    .btn-social:hover { background: #1c283e; }
    .btn-trial-link { display: block; width: 100%; text-align: center; padding: 0.75rem; border-radius: 8px; border: 1px dashed #334155; color: var(--text-muted); font-size: 0.82rem; text-decoration: none; margin-top: 1rem; transition: all 0.2s; }
    .btn-trial-link:hover { border-color: var(--primary); color: var(--primary); }
    .footer-meta { margin-top: 1.5rem; font-size: 0.72rem; color: #475569; text-align: center; }
  </style>
</head>
<body>
  <div class="portal-card">
    <div class="brand-header">
      <h1>${opts.venue}</h1>
      <p>Connect your device to access the Internet</p>
    </div>

    $(if error)
      <div class="error-alert">$(error)</div>
    $(endif)

    ${isDualOrAll ? `
    <div class="tab-bar">
      <button type="button" class="tab-btn active" onclick="switchTab('voucher')">Voucher Code</button>
      <button type="button" class="tab-btn" onclick="switchTab('member')">Member Login</button>
    </div>
    ` : ''}

    ${isVoucherOnly || isDualOrAll ? `
    <div id="tab-voucher" class="${isDualOrAll ? 'tab-pane active' : ''}">
      <form id="voucher-form" action="$(link-login-only)" method="post" onsubmit="return handleVoucherSubmit(event);">
        <input type="hidden" name="dst" value="$(link-orig)" />
        <input type="hidden" name="popup" value="false" />
        <input type="hidden" name="username" id="v-user" />
        <input type="hidden" name="password" id="v-pass" />
        <div class="field-group">
          <label for="voucher-input">Voucher PIN / Code</label>
          <input type="text" id="voucher-input" placeholder="e.g. VC-98214" required autocomplete="off" autocapitalize="characters" />
        </div>
        <button type="submit" class="btn-submit">Connect with Voucher</button>
      </form>
    </div>
    ` : ''}

    ${isMemberOnly || isDualOrAll ? `
    <div id="tab-member" class="${isDualOrAll ? 'tab-pane' : ''}">
      <form id="member-form" action="$(link-login-only)" method="post">
        <input type="hidden" name="dst" value="$(link-orig)" />
        <input type="hidden" name="popup" value="false" />
        <div class="field-group">
          <label for="m-user">Username</label>
          <input type="text" id="m-user" name="username" value="$(username)" required autocomplete="username" />
        </div>
        <div class="field-group">
          <label for="m-pass">Password</label>
          <input type="password" id="m-pass" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn-submit">Sign In as Member</button>
      </form>
    </div>
    ` : ''}

    ${showSocial ? `
    <div class="divider"><span>Or</span></div>
    <a href="${opts.googleAuthUrl}?ip=$(ip)&mac=$(mac)&router=$(link-login-only-esc)" class="btn-social">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2s.7 5.5 1.9 7.9l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.3-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"/></svg>
      Continue with Google
    </a>
    ` : ''}

    ${opts.enableTrial ? `
    $(if trial == 'yes')
      <a href="$(link-login-only)?dst=$(link-orig-esc)&username=T-$(mac-esc)" class="btn-trial-link">
        ⚡ Free 30-Minute Trial Access
      </a>
    $(endif)
    ` : ''}

    <div class="footer-meta">
      IP: $(ip) &bull; MAC: $(mac)<br />
      Protected by MikroTik RouterOS v7
    </div>
  </div>

  <script>
    ${isDualOrAll ? `
    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      if (tab === 'voucher') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tab-voucher').classList.add('active');
      } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tab-member').classList.add('active');
      }
    }
    ` : ''}

    ${isVoucherOnly || isDualOrAll ? `
    function handleVoucherSubmit(e) {
      e.preventDefault();
      var code = document.getElementById('voucher-input').value.trim();
      if (!code) return false;
      document.getElementById('v-user').value = code;
      document.getElementById('v-pass').value = code;
      document.getElementById('voucher-form').submit();
    }

    // Auto-login from QR-code scan with ?voucher=CODE query string
    window.addEventListener('DOMContentLoaded', function() {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('voucher');
      if (code) {
        var inp = document.getElementById('voucher-input');
        if (inp) inp.value = code;
        document.getElementById('v-user').value = code;
        document.getElementById('v-pass').value = code;
        document.getElementById('voucher-form').submit();
      }
    });
    ` : ''}
  </script>
</body>
</html>`;
  }

  private static buildStatusHtml(opts: { venue: string; dnsName: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.venue} - Active Session</title>
  <style>
    :root {
      --bg: #090c10;
      --card-bg: #121824;
      --border: #21293a;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.25rem; }
    .status-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 380px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: center; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.12); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; margin-bottom: 1.2rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.35rem; }
    p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem; }
    .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 1.5rem; }
    .metric-box { background: #090c10; border: 1px solid var(--border); border-radius: 10px; padding: 12px; text-align: left; }
    .metric-box .label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .metric-box .val { font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 4px; word-break: break-all; }
    .btn-logout { display: block; width: 100%; padding: 0.8rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.12); color: #fca5a5; font-weight: 600; font-size: 0.88rem; cursor: pointer; text-decoration: none; transition: background 0.2s; }
    .btn-logout:hover { background: rgba(239, 68, 68, 0.25); }
  </style>
</head>
<body>
  <div class="status-card">
    <div class="status-badge">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; display: inline-block;"></span> Connected
    </div>
    <h1>Internet Active</h1>
    <p>Logged in as: <strong>$(username)</strong></p>

    <div class="metric-grid">
      <div class="metric-box">
        <div class="label">IP Address</div>
        <div class="val">$(ip)</div>
      </div>
      <div class="metric-box">
        <div class="label">Session Time</div>
        <div class="val">$(uptime)</div>
      </div>
      <div class="metric-box">
        <div class="label">Downloaded</div>
        <div class="val">$(bytes-out-nice)</div>
      </div>
      <div class="metric-box">
        <div class="label">Uploaded</div>
        <div class="val">$(bytes-in-nice)</div>
      </div>
    </div>

    $(if session-time-left)
      <p style="font-size: 0.8rem; color: #38bdf8; margin-bottom: 1rem;">Time Remaining: $(session-time-left)</p>
    $(endif)

    <form action="$(link-logout)" method="post">
      <input type="hidden" name="erase-cookie" value="on" />
      <button type="submit" class="btn-logout">Disconnect / Log Out</button>
    </form>
  </div>
</body>
</html>`;
  }

  private static buildRouterOsScript(opts: {
    model: HotspotAuthModel;
    enableTrial: boolean;
    trialUptime: string;
    trialRateLimit: string;
    voucherRateLimit: string;
    dnsName: string;
    paymentGateway: string;
    hasGoogleAuth: boolean;
  }): string {
    const lines: string[] = [
      `# MikroTik RouterOS v7 Smart Hotspot Provisioning Script`,
      `# Generated automatically by HotspotPortalGenerator`,
      ``,
      `# 1. Hotspot User Profiles`,
      `/ip hotspot user profile`,
      `add name="uprof-voucher" rate-limit="${opts.voucherRateLimit}" shared-users=1 status-autorefresh=1m keepalive-timeout=2m session-timeout=12h`,
      `add name="uprof-member" rate-limit="20M/10M" shared-users=2 status-autorefresh=1m mac-cookie-timeout=30d`,
    ];

    if (opts.enableTrial) {
      lines.push(
        `add name="uprof-trial" rate-limit="${opts.trialRateLimit}" shared-users=1 status-autorefresh=1m`,
        ``,
        `# 2. Configure Hotspot Server Profile with Trial & Cookie Support`,
        `/ip hotspot profile`,
        `set [find] dns-name="${opts.dnsName}" \\`,
        `    login-by=cookie,http-chap,mac-cookie \\`,
        `    http-cookie-lifetime=30d \\`,
        `    trial-uptime-limit=${opts.trialUptime} \\`,
        `    trial-uptime-reset=1d \\`,
        `    trial-user-profile="uprof-trial"`
      );
    } else {
      lines.push(
        ``,
        `# 2. Configure Hotspot Server Profile`,
        `/ip hotspot profile`,
        `set [find] dns-name="${opts.dnsName}" \\`,
        `    login-by=cookie,http-chap,mac-cookie \\`,
        `    http-cookie-lifetime=30d`
      );
    }

    lines.push(
      ``,
      `# 3. Walled Garden Configurations (Allowed Prior to Login)`,
      `/ip hotspot walled-garden`
    );

    if (opts.hasGoogleAuth) {
      lines.push(
        `add dst-host=accounts.google.com action=allow comment="Google OAuth"`,
        `add dst-host=accounts.youtube.com action=allow comment="Google Identity"`,
        `add dst-host=*.googleapis.com action=allow comment="Google API Services"`,
        `add dst-host=*.gstatic.com action=allow comment="Google Static CDNs"`,
        `add dst-host=*.googleusercontent.com action=allow comment="Google Identity Avatars"`,
        `add dst-host=captive.apple.com action=allow comment="Apple CNA Detection"`,
        `add dst-host=appleid.apple.com action=allow comment="Apple ID Authentication"`
      );
    }

    if (opts.paymentGateway === 'midtrans') {
      lines.push(
        `add dst-host=*.midtrans.com action=allow comment="Midtrans Payment Gateway"`,
        `add dst-host=*.veritrans.co.id action=allow comment="Midtrans Core"`,
        `add dst-host=*.qris.id action=allow comment="National QRIS Network"`
      );
    } else if (opts.paymentGateway === 'xendit') {
      lines.push(
        `add dst-host=*.xendit.co action=allow comment="Xendit Payment Gateway"`,
        `add dst-host=*.qris.id action=allow comment="National QRIS Network"`
      );
    } else if (opts.paymentGateway === 'stripe') {
      lines.push(
        `add dst-host=api.stripe.com action=allow comment="Stripe API"`,
        `add dst-host=checkout.stripe.com action=allow comment="Stripe Checkout"`,
        `add dst-host=*.stripe.network action=allow comment="Stripe Assets"`
      );
    }

    lines.push(
      ``,
      `# 4. Sample Voucher Provisioning`,
      `/ip hotspot user`,
      `add name="VC-TEST01" password="VC-TEST01" profile="uprof-voucher" comment="Sample Voucher"`,
      `add name="admin-staff" password="StaffSecurePassword123" profile="uprof-member" comment="Staff Account"`
    );

    return lines.join('\n');
  }
}
