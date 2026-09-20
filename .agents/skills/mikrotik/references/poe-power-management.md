# Power over Ethernet (PoE) Architecture & Power Management

This guide covers Power over Ethernet (PoE) diagnostics, power budget planning, and remote power cycling on MikroTik Cloud Router Switches (CRS series) and RouterBOARD devices.

---

## 1. MikroTik PoE Standards & Hardware Capabilities

MikroTik hardware implements two primary PoE output categories:

| PoE Type | Specification | Voltage Range | Typical Hardware | Supported Powered Devices (PD) |
|---|---|:---:|---|---|
| **Passive PoE (Low Voltage)** | Non-standard DC injection | 18V &ndash; 30V | hEX PoE, PowerBox, RB5009 (port 8) | Wireless CPE (SXT, LHG, Disc), cAP lite |
| **802.3af / 802.3at (PoE+)** | IEEE Standard (Type 1 &amp; 2) | 44V &ndash; 57V | CRS328-24P-4S+, CRS354-48P-4S+2Q+ | Wi-Fi 6 APs (cAP ax, hAP ax), IP Cameras, VoIP |
| **Auto-Sensing Dual Voltage** | Automatic sensing &amp; negotiation | 24V or 48V | CRS112-8P-4S, netPower 16P | Automatically detects 24V passive or 48V 802.3af/at |

---

## 2. Configuration & Monitoring Architecture

### 2.1. PoE Port Configuration Options (`/interface ethernet poe`)

```routeros
# Set interface ether2 to standard auto-sensing negotiation
/interface ethernet poe set ether2 poe-out=auto-on

# Set power priority (lower number = higher priority when power budget is constrained)
/interface ethernet poe set ether2 priority=1

# Configure automated ping watchdog power cycling
# If the downstream AP (192.168.1.50) stops responding to ICMP for 60s, cycle port power
/interface ethernet poe set ether2 \
    power-cycle-ping-enabled=yes \
    power-cycle-ping-address=192.168.1.50 \
    power-cycle-ping-timeout=60s
```

### 2.2. Port Modes (`poe-out`)
- **`auto-on` (Default & Recommended):** Detects whether the connected device is PoE-capable and requires power before energizing the port. Prevents frying non-PoE laptops or switches.
- **`forced-on` (Caution):** Bypasses resistive handshake and continuously injects power. Use strictly for legacy passive equipment that cannot respond to 802.3af sensing pulses.
- **`off`:** Shuts off power injection entirely.

---

## 3. Real-Time Telemetry & Status Codes

Inspect PoE status on ports via CLI:
```routeros
/interface ethernet poe monitor [find] once
```

REST API equivalent:
```http
GET /rest/interface/ethernet/poe
```

### 3.1. Telemetry Properties
- **`poe-out-status`:** Operational state of the port power controller.
- **`poe-voltage`:** Delivered voltage (e.g. `24.2V` or `53.1V`).
- **`poe-current`:** Current draw in milliamperes (mA).
- **`poe-power`:** Real-time power consumption in watts (W).

### 3.2. Status Code Diagnostics Table

| Status Code | Meaning | Root Cause | Action / Remediation |
|---|---|---|---|
| **`powered-on`** | Normal Operation | Downstream device is active and drawing power | None (Healthy) |
| **`waiting-for-load`** | Port Idle | Connected cable has no load or non-PoE device | Expected if port is disconnected |
| **`overload`** | Fault Detected | Downstream device exceeds port wattage limit | Check camera IR heater or shorted pairs; switch port to higher wattage PSU |
| **`short-circuit`** | Protection Engaged | Water ingress, damaged RJ45 crimp, or wire short | Immediately disconnect cable and inspect physical termination |
| **`voltage-too-low`** | Input Voltage Drop | Main power supply sagged below threshold | Inspect switch PSU health and input mains |

---

## 4. Remote Power Cycling Runbooks

When an Access Point, camera, or remote VoIP phone freezes, power-cycling the PoE port performs a clean cold reboot without needing a technician on-site or rebooting the main switch.

### 4.1. Via CLI (`mtik`)
```bash
# View all PoE ports status
mtik poe

# Power cycle specific port (e.g. ether2)
mtik poe --cycle ether2

# Target specific router from inventory
mtik poe -d core-switch-01 --cycle ether5
```

### 4.2. Via Direct RouterOS Script / REST API
```routeros
# Native RouterOS command
/interface ethernet poe power-cycle ether2
```

REST HTTP request:
```http
POST /rest/execute
{
  "script": "/interface ethernet poe power-cycle ether2"
}
```

### 4.3. Power Budget Planning Formula
Ensure total power drawn does not exceed the internal PSU capacity:
$$\sum P_{\text{ports}} = \sum (V_{\text{port}} \times I_{\text{port}}) \le P_{\text{PSU\_Max}} \times 0.85$$
*(Keep a 15% thermal headroom for ambient temperature spikes).*
