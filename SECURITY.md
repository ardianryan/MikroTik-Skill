# Security Policy — MikroTik NetDevOps Toolkit & MCP Server

## Reporting a Vulnerability

Security and integrity are paramount when interacting with core network routing equipment. If you discover a vulnerability or security flaw in this project, please report it privately.

**Do not file a public issue.**

Please send security reports directly to:
**Ardian Ryan**: [me@ardianryan.com](mailto:me@ardianryan.com)

### What to Include in Your Report
- A detailed description of the vulnerability.
- Steps to reproduce the vulnerability (including proof of concept or sample API request).
- The potential impact on the host system or target MikroTik router.
- Any suggested mitigations or patches.

### Response Commitment
- **Initial Response:** Within 48 hours of report receipt.
- **Triage & Status Update:** Within 5 business days.
- **Fix Delivery:** As quickly as practical, followed by an advisory release.

## Supported Versions

| Version | Supported          |
| :------ | :----------------- |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Design Principles
- **Zero Credential Leakage:** Sensitive parameters (passwords, auth tokens) are masked across console outputs and error stacks.
- **Transport Security:** Default preference for TLS-encrypted endpoints (HTTPS port 443 and API-SSL port 8729).
- **Safe Execution Guards:** All mutation subcommands provide `--dry-run` and visual diff verification before applying changes to physical routers.
