# RouterOS v7 REST API Architecture & Developer Reference

This reference details the internal architecture, authentication, HTTP verb mappings, query mechanics, and command semantics of the native MikroTik RouterOS v7 REST API.

---

## 1. Overview & Protocol Architecture

Starting with **RouterOS v7.1beta4**, MikroTik introduced a native REST API implemented as a JSON wrapper over the internal RouterOS console API.

- **HTTPS Service (`www-ssl`):** Default endpoint `https://<router_ip>/rest` (Port 443 or custom SSL port). Recommended for all environments.
- **HTTP Service (`www`):** Available starting with **RouterOS v7.9** at `http://<router_ip>/rest` (Port 80). Disabled or restricted in production due to cleartext transmission risks.
- **Underlying Engine:** Exposes all RouterOS menus, configuration items, and operational commands as resource-oriented URLs.

---

## 2. Authentication & Data Encoding

### Authentication
- Uses standard **HTTP Basic Authentication** (`Authorization: Basic <base64(user:password)>`).
- Credentials correspond to local RouterOS users (`/user`) or RADIUS-authenticated console accounts.
- HTTPS connections require a certificate configured under `/ip service set www-ssl certificate=<CERT_NAME>`. Toolkit clients always verify certificates. Configure `ROUTEROS_CA_FILE` with the private CA or explicitly trusted self-signed certificate; do not disable validation. HTTPS failures never downgrade to HTTP. Plain transport requires `ROUTEROS_USE_SSL=false`.

### JSON Representation (ECMA-404 Compliance)
- **Stringified Values:** In all JSON responses, object property values are encoded as strings (`"true"`, `"false"`, `"1200"`, `"10.0.0.1/24"`), regardless of whether the internal type is a boolean, integer, or IP address.
- **Input Numbers:** The API accepts integers in decimal, octal (prefix `0`), or hexadecimal (prefix `0x`). Exponential notation (e.g. `1e6`) is not supported.

---

## 3. HTTP Methods & CRUD Mapping

| HTTP Verb | CRUD Action | Equivalent ROS CLI | Description | Body Schema |
|---|---|---|---|---|
| **GET** | Read | `print` | Retrieve all items or a single item from a menu | Empty |
| **PUT** | Create | `add` | Create a single new record | JSON object of properties |
| **PATCH** | Update | `set` | Modify properties of an existing record | JSON object of properties to update |
| **DELETE** | Delete | `remove` | Remove an existing record | Empty |
| **POST** | Command | Arbitrary CLI command | Execute operational commands, scripts, or queries | JSON object of command arguments |

### 3.1. GET (Read Records)
- **List all records:**
  ```http
  GET /rest/ip/address
  ```
- **Get single record by internal ID:**
  ```http
  GET /rest/ip/address/*1
  ```
- **Get single record by name:**
  ```http
  GET /rest/interface/ether1
  ```
- **Filter with query parameters:**
  ```http
  GET /rest/ip/address?network=10.0.0.0&dynamic=false
  ```
- **Property projection with `.proplist`:**
  ```http
  GET /rest/ip/address?.proplist=address,interface,disabled
  ```

### 3.2. PUT (Create Record)
- Only one resource can be created per request.
- The router returns the newly created object including its assigned `.id`.
  ```http
  PUT /rest/ip/address
  Content-Type: application/json

  {
    "address": "192.168.100.1/24",
    "interface": "bridge-LAN",
    "comment": "Management Gateway"
  }
  ```

### 3.3. PATCH (Update Record)
- Targets a specific `.id` in the URL.
- Returns the full updated record upon success.
  ```http
  PATCH /rest/ip/address/*1
  Content-Type: application/json

  {
    "comment": "Primary WAN Gateway"
  }
  ```

### 3.4. DELETE (Remove Record)
- Returns an empty body (`200 OK` or `204 No Content`) on success.
- If the item does not exist or has already been removed, returns `404 Not Found`.
  ```http
  DELETE /rest/ip/address/*1
  ```

---

## 4. Advanced POST Command Semantics

All operational console commands that do not map directly to CRUD operations are accessed via `POST`.

### 4.1. Universal Query Stack (`.query`)
Complex filtering can be submitted to any `/print` endpoint via a query stack array mimicking the native API sentence structure:
```http
POST /rest/interface/print
Content-Type: application/json

{
  ".proplist": [".id", "name", "type", "running"],
  ".query": ["type=ether", "type=vlan", "#|!"]
}
```

### 4.2. Timeout Constraints & Continuous Commands
- **Standard Timeout:** RouterOS imposes a default **60-second** timeout on REST requests.
- **Continuous Commands Prohibition:** Commands that stream indefinitely (such as `/ping`, `/tool/bandwidth-test`, or `/interface/monitor-traffic`) will terminate with an HTTP 400 `{"detail":"Session closed","error":400,"message":"Bad Request"}` unless bounded by a stopping parameter:
  - **Ping:** Add `"count": "4"`
  - **Bandwidth Test:** Add `"duration": "3s"`
  - **Traffic Monitor:** Add `"once": ""` (or `true`)

### 4.3. Script Execution (`/rest/execute`)
Execute RouterOS script blocks. Execution is not atomic: earlier commands may remain applied after a later command fails. These protocol examples describe the native router API, not public MCP endpoints. Toolkit raw writes require a reviewed recovery script, interactive approval, and a verified 30-second watchdog:
```http
POST /rest/execute
Content-Type: application/json

{
  "script": "/log info \"Automated audit triggered by AI Agent\""
}
```

### 4.4. Configuration Export (`/rest/export`)
Generate compact configuration files. A filename containing “sanitized” does not sanitize router output: run exports through `ConfigSanitizer` and review them before sharing. Setting `file` writes on the router and requires the mutation workflow:
```http
POST /rest/export
Content-Type: application/json

{
  "compact": "",
  "file": "backup-sanitized.rsc"
}
```

### 4.5. Rule Reordering (`/rest/<menu>/move`)
Rearrange order-dependent rules (such as Mangle or Firewall Filter):
```http
POST /rest/ip/firewall/mangle/move
Content-Type: application/json

{
  ".id": "*15",
  "destination": "*2"
}
```

---

## 5. Error Schema & Handling

When an error occurs (HTTP status $\ge 400$), RouterOS returns a structured JSON payload:
```json
{
  "error": 406,
  "message": "Not Acceptable",
  "detail": "no such command or directory (remove)"
}
```

Common status codes:
- `400 Bad Request`: Parameter validation failed, missing required fields, or unconstrained continuous command timeout.
- `401 Unauthorized`: Missing or invalid Basic Authentication credentials.
- `404 Not Found`: Targeted item `.id` or menu does not exist.
- `406 Not Acceptable`: Unsupported command verb on targeted menu.

---

## 6. RouterOS v7 Webserver Sub-Service Hardening (`/ip service webserver`)

Starting with RouterOS v7, REST API transport behavior is governed independently from static WebFig through the `/ip/service/webserver` configuration menu:

| Property | Default | Production Standard | Purpose |
|---|:---:|:---:|---|
| `rest-plain` | `yes` | `no` | Accepts unencrypted REST API requests over HTTP (`www` port 80). Disabling prevents credential and payload interception. |
| `rest-secure` | `yes` | `yes` | Accepts encrypted REST API requests over HTTPS (`www-ssl` port 443). |
| `ssl-certificate` | none | `<CERT_NAME>` | TLS certificate utilized for HTTPS REST endpoints. |

### Hardening Command:
```routeros
# Disable plain HTTP REST API while retaining HTTPS REST API
/ip service webserver set rest-plain=no rest-secure=yes
```

