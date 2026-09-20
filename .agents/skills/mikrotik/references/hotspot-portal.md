# Modern Captive Portal Architecture & Smart Hotspot Engineering

This reference guide provides production-grade architectural blueprints, authentication models, walled-garden configurations, and client-side templates for MikroTik RouterOS v7 Captive Portals.

---

## 1. Hotspot Subsystem Architecture & RouterOS Macros

RouterOS Hotspot intercepts client HTTP port 80 traffic prior to authentication, serving static HTML files populated dynamically with template engine variables (`$(variable)`).

### Core Template Engine Macros

| Macro | Purpose | Example Value |
| :--- | :--- | :--- |
| `$(link-login)` | Main portal login endpoint (returns HTML on error/status) | `http://wifi.venue.lan/login` |
| `$(link-login-only)` | Direct authentication POST endpoint (no HTML redirect) | `http://wifi.venue.lan/login` |
| `$(link-orig)` | Original destination URL requested by the client | `http://example.com` |
| `$(link-orig-esc)` | URL-encoded destination URL | `http%3A%2F%2Fexample.com` |
| `$(username)` | Pre-filled username if known | `guest_user` |
| `$(mac)` | Client hardware MAC address | `E4:5F:01:23:45:67` |
| `$(mac-esc)` | URL-encoded MAC address | `E4%3A5F%3A01%3A23%3A45%3A67` |
| `$(ip)` | Client assigned IPv4 address | `192.168.88.145` |
| `$(error)` | Localized human-readable error message | `invalid username or password` |
| `$(error-orig)` | Raw error key code | `invalid_credentials` |
| `$(chap-id)` | Dynamic challenge ID for HTTP-CHAP authentication | `\023` |
| `$(chap-challenge)` | Random hex challenge string for client-side MD5 | `3f8a29...` |
| `$(trial)` | Flag indicating whether free trial access is active | `yes` / `no` |
| `$(link-status)` | URL to active session status page | `http://wifi.venue.lan/status` |
| `$(link-logout)` | URL to terminate session | `http://wifi.venue.lan/logout` |

---

## 2. Authentication Models Comparison

```mermaid
graph TD
    A[Client Connects to Hotspot Wi-Fi] --> B[Captive Network Assistant / Browser Opens]
    B --> C{Choose Authentication Model}
    C -->|Model 1| D[Single Voucher PIN]
    C -->|Model 2| E[Member / Staff User & Pass]
    C -->|Model 3| F[Social OAuth: Google / Apple]
    C -->|Model 4| G[1-Click Free Trial]
    C -->|Model 5| H[Instant Paid QRIS / Stripe]
    
    D -->|JS copies code to user+pass| I[POST /login to RouterOS]
    E -->|CHAP MD5 Hash| I
    F -->|Walled Garden OAuth Broker| J[External Auth Relay API]
    J -->|REST API creates user / redirects| I
    G -->|T-MAC username| I
    H -->|Payment Webhook -> REST API| I
    
    I --> K[RouterOS Grants Internet Access]
```

### Model Matrix

| Model | Primary Use Case | User Input | Authentication Method |
| :--- | :--- | :--- | :--- |
| **1. Voucher Only** | Cafes, Hotels, Events, Coworking | 1 Field (PIN / Code) | Script sets `user=code` & `pass=code` |
| **2. Dual User/Pass** | Enterprise, Staff, Gym/Club Members | 2 Fields (Username + Password) | HTTP-CHAP MD5 or HTTPS-PAP |
| **3. Social Login (Google)** | Retail, Malls, Marketing Portals | Google Account Consent | Walled Garden + External Cloud Relay |
| **4. Free Trial** | Airports, Public Transit, Lounges | 0 Fields (Single Button Click) | `username=T-$(mac-esc)` |
| **5. Paid Instant Voucher** | Paid ISP Hotspot, Tourist Spots | QRIS / Credit Card Scan | Walled Garden + Payment Webhook + REST |

---

## 3. Model 1: Single-Input Smart Voucher Portal

In hospitality and cafes, users expect to enter a single voucher code printed on their receipt without typing a separate password.

### JavaScript Single-Field Mirroring
When the user submits a single `voucher` input, client-side JavaScript populates both `username` and `password` fields before posting:

```javascript
function submitVoucherForm(e) {
  e.preventDefault();
  var voucher = document.getElementById('voucher-code').value.trim();
  if (!voucher) return false;
  
  document.getElementById('hidden-username').value = voucher;
  document.getElementById('hidden-password').value = voucher;
  document.getElementById('auth-form').submit();
}
```

### QR-Code Auto-Login URL Scheme
When printing vouchers, include a QR code pointing directly to:
`http://wifi.venue.lan/login?voucher=XYZ-9821`

A zero-friction auto-login script parses the query string on page load:
```javascript
window.addEventListener('DOMContentLoaded', function() {
  var params = new URLSearchParams(window.location.search);
  var voucher = params.get('voucher');
  if (voucher) {
    document.getElementById('voucher-code').value = voucher;
    document.getElementById('hidden-username').value = voucher;
    document.getElementById('hidden-password').value = voucher;
    document.getElementById('auth-form').submit();
  }
});
```

### RouterOS Configuration for Vouchers
```routeros
# Create Voucher User Profile (Shared-users=1, 4-hour session limit, 10M/5M rate limit)
/ip hotspot user profile
add name="uprof-voucher-4h" \
    rate-limit="10M/5M" \
    shared-users=1 \
    session-timeout=4h \
    keepalive-timeout=2m \
    status-autorefresh=1m

# Batch Generate Voucher Users (Username == Password)
/ip hotspot user
add name="VC-84192" password="VC-84192" profile="uprof-voucher-4h" comment="Table-01"
add name="VC-84193" password="VC-84193" profile="uprof-voucher-4h" comment="Table-02"
add name="VC-84194" password="VC-84194" profile="uprof-voucher-4h" comment="Table-03"
```

---

## 4. Model 2: Dual User & Password with Client-Side MD5 CHAP

When authenticating over unencrypted Wi-Fi on plain HTTP, passwords must never be sent in cleartext. RouterOS provides a challenge-response CHAP mechanism using dynamic macros `$(chap-id)` and `$(chap-challenge)`.

### Embedded MD5 CHAP Hashing Protocol
```html
<form name="login" action="$(link-login-only)" method="post" onsubmit="return doChapLogin();">
  <input type="hidden" name="dst" value="$(link-orig)" />
  <input type="hidden" name="popup" value="false" />
  <input type="hidden" name="username" id="chap-user" />
  <input type="hidden" name="password" id="chap-pass" />
  
  <input type="text" id="ui-username" placeholder="Username" required />
  <input type="password" id="ui-password" placeholder="Password" required />
  <button type="submit">Sign In</button>
</form>

<script>
function doChapLogin() {
  var u = document.getElementById('ui-username').value.trim();
  var p = document.getElementById('ui-password').value;
  document.getElementById('chap-user').value = u;
  
  // If CHAP challenge is present from RouterOS macro, hash password
  var challenge = "$(chap-challenge)";
  var chapId = "$(chap-id)";
  
  if (challenge && challenge.length > 0) {
    // hexMD5 is defined in embedded md5.js (standard RouterOS helper)
    document.getElementById('chap-pass').value = hexMD5(chapId + p + challenge);
  } else {
    document.getElementById('chap-pass').value = p;
  }
  return true;
}
</script>
```

### MAC Cookie Auto-Login
Allow returning staff or club members to bypass the portal automatically for 30 days:
```routeros
/ip hotspot profile
set [find] login-by=cookie,http-chap,mac-cookie \
    http-cookie-lifetime=30d \
    mac-cookie-timeout=30d
```

---

## 5. Model 3: Social Login (Google OAuth 2.0 / Apple / Facebook)

### Architectural Constraints & The Cloud Relay Solution
RouterOS has a lightweight embedded web server that **cannot** execute server-side Node.js, Python, or PHP. It cannot store private OAuth client secrets, exchange auth codes, or verify JWT signatures directly.

**The Solution:** The Captive Cloud Auth Broker (e.g., Cloudflare Worker or Vercel Serverless Function).

```mermaid
sequenceDiagram
    autonumber
    participant C as Client Browser
    participant R as MikroTik RouterOS
    participant B as Cloud Auth Broker (Cloudflare Worker)
    participant G as Google OAuth 2.0

    Note over C,R: Client connects, Walled Garden allows Google & Broker
    C->>R: HTTP GET /login.html
    R-->>C: Returns login.html with "Sign in with Google" button
    C->>B: GET https://auth.venue.com/google/login?ip=$(ip)&mac=$(mac)&router=$(link-login-only-esc)
    B-->>C: HTTP 302 Redirect to accounts.google.com/o/oauth2/v2/auth
    C->>G: User consents with Google Account
    G-->>B: HTTP 302 Redirect to callback with ?code=...
    B->>G: POST /token (Exchanges code + client_secret)
    G-->>B: Returns id_token & user info (email, name)
    Note over B: Broker verifies JWT & records lead in CRM
    B->>R: REST API: POST /rest/ip/hotspot/user (Generates temporary token user)
    B-->>C: Returns Auto-Submit HTML Form targeting http://router.venue.lan/login
    C->>R: POST /login (username=google_token, password=google_token)
    R-->>C: Authenticated! Internet Unlocked.
```

### Required Walled Garden Rules for Social OAuth
For Google, Apple, and Microsoft authentication to load in the captive state, their domains and CDNs must be whitelisted:

```routeros
# Google OAuth & Identity Infrastructure
/ip hotspot walled-garden
add dst-host=accounts.google.com action=allow comment="Google OAuth"
add dst-host=accounts.youtube.com action=allow comment="Google Identity"
add dst-host=*.googleapis.com action=allow comment="Google API Gateway"
add dst-host=*.gstatic.com action=allow comment="Google Static Assets"
add dst-host=*.googleusercontent.com action=allow comment="Google Avatar / CDN"

# Apple Captive Network Assistant & Apple ID
add dst-host=appleid.apple.com action=allow comment="Sign in with Apple"
add dst-host=appleid.cdn-apple.com action=allow comment="Apple ID CDN"
add dst-host=captive.apple.com action=allow comment="Apple CNA Detection"

# Cloud Auth Broker Hostname
add dst-host=auth.yourvenue.com action=allow comment="Venue Cloud Auth Broker"
```

---

## 6. Model 4: One-Click Free Trial with Rate-Limiting

Allow visitors 30 minutes of free complimentary internet access with bandwidth capping:

### Portal HTML Button
```html
<div class="trial-box">
  <p>Need quick access? Connect instantly for 30 minutes.</p>
  <a href="$(link-login-only)?dst=$(link-orig-esc)&username=T-$(mac-esc)" class="btn-trial">
    Free 30-Min Access
  </a>
</div>
```

### RouterOS Configuration
```routeros
# Create Trial User Profile (2M Download / 1M Upload)
/ip hotspot user profile
add name="uprof-trial-30m" \
    rate-limit="2M/1M" \
    shared-users=1 \
    status-autorefresh=1m

# Configure Hotspot Profile for Trial Access
/ip hotspot profile
set [find] trial-uptime-limit=30m \
    trial-uptime-reset=1d \
    trial-user-profile="uprof-trial-30m"
```

---

## 7. Model 5: Instant Paid Voucher with Payment Gateways (QRIS, Midtrans, Stripe)

For paid hotspots (airports, tourist zones, rural WISPs), guests purchase access via QRIS or Credit Card directly on the captive portal.

### Walled Garden Rules for Payment Gateways
```routeros
# Payment Processors & QRIS Acquirers
/ip hotspot walled-garden
add dst-host=*.midtrans.com action=allow comment="Midtrans Payment Gateway"
add dst-host=*.xendit.co action=allow comment="Xendit Payment Gateway"
add dst-host=api.stripe.com action=allow comment="Stripe API"
add dst-host=checkout.stripe.com action=allow comment="Stripe Checkout"
add dst-host=*.qris.id action=allow comment="National QRIS Network"
```

### Payment Webhook Architecture
1. Client selects package: "1 Day High-Speed - $2.00".
2. Portal displays dynamic QRIS code or payment iframe (allowed via Walled Garden).
3. Client pays on phone banking app.
4. Payment gateway sends webhook to Cloud Broker (`https://auth.venue.com/webhook/payment`).
5. Cloud Broker calls MikroTik REST API:
   ```http
   POST /rest/ip/hotspot/user
   Authorization: Basic YWRtaW46cGFzc3dvcmQ=
   Content-Type: application/json

   {
     "name": "PAID-98214",
     "password": "PIN-SECRET-98214",
     "profile": "uprof-paid-1day",
     "limit-uptime": "24:00:00",
     "comment": "PaymentID: TRX-88219"
   }
   ```
6. Broker broadcasts success to client via WebSocket or long-polling, automatically submitting login form.

---

## 8. Modern CNA (Captive Network Assistant) & SSL Handling

### Understanding CNA Detection
Modern smartphones test connectivity immediately upon Wi-Fi association by pinging known probe endpoints:
- **Apple iOS / macOS:** `http://captive.apple.com/hotspot-detect.html` (expects `Success`)
- **Android / ChromeOS:** `http://connectivitycheck.gstatic.com/generate_204` (expects HTTP 204)
- **Windows:** `http://www.msftconnecttest.com/connecttest.txt` (expects `Microsoft Connect Test`)

When RouterOS intercepts these plain HTTP probes and returns a 302 redirect to `login.html`, the OS automatically launches the popup Captive Portal browser.

### The HTTPS / SSL Dilemma
If a user immediately opens a bookmarked HTTPS website (`https://google.com` or `https://bank.com`):
- Intercepting port 443 with a self-signed router certificate triggers an alarming **HSTS / SSL Certificate Warning** on the client's screen.
- **Best Practice 1:** Configure a valid Let's Encrypt Wildcard certificate on the router for its Hotspot DNS hostname (e.g., `wifi.venue.com`).
- **Best Practice 2:** Never intercept HTTPS for unauthenticated clients; rely strictly on HTTP port 80 CNA redirection. All modern devices trigger CNA over HTTP before user opens browser.

```routeros
# Secure DNS Name & HTTPS Redirection Configuration
/ip hotspot profile
set [find] dns-name="wifi.venue.com" \
    ssl-certificate="letsencrypt-hotspot" \
    https=yes
```

---

## 9. Complete Smart `login.html` Production Template

A production-ready, mobile-first captive portal featuring tab switching between Voucher PIN, Member Login, One-Click Free Trial, and Google Social Sign-In:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Wi-Fi Access Portal</title>
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
    
    /* Tabs */
    .tab-bar { display: flex; background: #0c1017; padding: 4px; border-radius: 10px; margin-bottom: 1.5rem; border: 1px solid var(--border); }
    .tab-btn { flex: 1; padding: 8px 12px; background: transparent; border: none; color: var(--text-muted); font-size: 0.82rem; font-weight: 600; border-radius: 7px; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { background: var(--border); color: #fff; }
    
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    
    .field-group { margin-bottom: 1.1rem; }
    .field-group label { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.4rem; font-weight: 600; }
    .field-group input { width: 100%; padding: 0.8rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: #090c10; color: #fff; font-size: 0.95rem; transition: border-color 0.2s; }
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
      <h1>High-Speed Wi-Fi</h1>
      <p>Connect your device to access the Internet</p>
    </div>

    <!-- Error message injected by RouterOS if authentication fails -->
    $(if error)
      <div class="error-alert">$(error)</div>
    $(endif)

    <div class="tab-bar">
      <button type="button" class="tab-btn active" onclick="switchTab('voucher')">Voucher Code</button>
      <button type="button" class="tab-btn" onclick="switchTab('member')">Member / Staff</button>
    </div>

    <!-- Tab 1: Single-Input Voucher Code -->
    <div id="tab-voucher" class="tab-pane active">
      <form id="voucher-form" action="$(link-login-only)" method="post" onsubmit="return handleVoucherSubmit(event);">
        <input type="hidden" name="dst" value="$(link-orig)" />
        <input type="hidden" name="popup" value="false" />
        <input type="hidden" name="username" id="v-user" />
        <input type="hidden" name="password" id="v-pass" />
        
        <div class="field-group">
          <label for="voucher-input">Voucher PIN / Code</label>
          <input type="text" id="voucher-input" placeholder="e.g. VC-98214" required autocomplete="off" autocorrect="off" autocapitalize="characters" />
        </div>
        <button type="submit" class="btn-submit">Connect with Voucher</button>
      </form>
    </div>

    <!-- Tab 2: Dual User & Password -->
    <div id="tab-member" class="tab-pane">
      <form id="member-form" action="$(link-login-only)" method="post">
        <input type="hidden" name="dst" value="$(link-orig)" />
        <input type="hidden" name="popup" value="false" />
        <div class="field-group">
          <label for="m-user">Username / Email</label>
          <input type="text" id="m-user" name="username" value="$(username)" required autocomplete="username" />
        </div>
        <div class="field-group">
          <label for="m-pass">Password</label>
          <input type="password" id="m-pass" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn-submit">Sign In as Member</button>
      </form>
    </div>

    <!-- Social OAuth & Free Trial Options -->
    <div class="divider"><span>Or</span></div>

    <!-- Google OAuth via Cloud Auth Relay -->
    <a href="https://auth.yourvenue.com/login/google?ip=$(ip)&mac=$(mac)&router=$(link-login-only-esc)" class="btn-social">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2s.7 5.5 1.9 7.9l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.3-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"/></svg>
      Continue with Google
    </a>

    <!-- 1-Click Free Trial (Rendered conditionally if trial is enabled in profile) -->
    $(if trial == 'yes')
      <a href="$(link-login-only)?dst=$(link-orig-esc)&username=T-$(mac-esc)" class="btn-trial-link">
        ⚡ Free 30-Minute Trial Access
      </a>
    $(endif)

    <div class="footer-meta">
      IP: $(ip) &bull; MAC: $(mac)<br />
      Protected by MikroTik RouterOS v7
    </div>
  </div>

  <script>
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
        document.getElementById('voucher-input').value = code;
        document.getElementById('v-user').value = code;
        document.getElementById('v-pass').value = code;
        document.getElementById('voucher-form').submit();
      }
    });
  </script>
</body>
</html>
```

---

## 10. Summary & Deployment Checklist

1. **Test Portals Offline:** Always ensure zero external CSS/JS dependencies (no un-whitelisted CDNs) so portal displays cleanly on the first connection.
2. **Whitelist All OAuth Endpoints:** When offering Google, Apple, or QRIS payment, test walled garden thoroughly before rolling out to guests.
3. **Set Idle & Session Timeouts:** Prevent stale connections from exhausting DHCP pools by configuring `keepalive-timeout=2m` and `idle-timeout=15m` in user profiles.
4. **Deploy via SFTP:**
   ```bash
   scp -P 22 login.html admin@192.168.88.1:/flash/hotspot/login.html
   ```
