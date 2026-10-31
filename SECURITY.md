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
| Current main / Unreleased | Security fixes under verification; not yet a published release |
| Published versions through 1.3.0 | Do not assume these contain the Unreleased fixes |

## Security Design Principles
- **Zero Credential Leakage:** Sensitive parameters (passwords, auth tokens) are masked across console outputs and error stacks.
- **Transport Security:** Certificate verification with explicit private-CA trust for TLS endpoints (HTTPS port 443 and API-SSL port 8729).
- **Safe Execution Guards:** Local mutations default to dry-run. Applying requires interactive approval, a reviewed target/state, and a verified 30-second watchdog. Raw writes require explicit rollback; arbitrary scripts do not become atomic transactions.

## Repository incident follow-up

Two workflows containing secret-exfiltration commands were removed during this maintenance. Their removal does not establish whether previous runs leaked credentials. The repository owner must inspect historical Actions runs, revoke/rotate tokens available to those runs (especially the npm publishing token), and review published artifacts and account activity. Preserve evidence before deleting historical logs. No account tokens were rotated and no remote workflows or releases were changed by this patch.

## Current boundaries

Public HTTP MCP is knowledge-only. Router writes are local, preview-first, and require interactive approval plus a verified 30-second watchdog. Raw writes require an operator-supplied rollback. Unknown audit data is never reported as PASS. WireGuard provisioning artifacts intentionally contain client secrets and must be handled separately from ordinary sanitized diagnostics.

## Offline tools and exported files

`mtik tui --offline` does not resolve a router target or open a router connection. Static linting only covers supported patterns; a clean lint report is not a security certification. Traffic Monitor displays no illustrative rates; live TUI monitoring remains deferred.

TUI exports require a new directory and refuse existing paths, including symlinks. Directories use mode `0700` and files `0600`. WireGuard `client.conf` and `router-peer.rsc` intentionally retain provisioning secrets; screenshots, logs, and review reports must not contain those secrets. Checksums detect accidental content changes, not authenticity.

The fleet store uses locally derived encryption material; it is not an OS keychain or a defense against an attacker controlling the same user account. Protect the account, local storage, and backups. Repository tests use dummy credentials and temporary stores; physical router recovery has not been validated by this maintenance.
