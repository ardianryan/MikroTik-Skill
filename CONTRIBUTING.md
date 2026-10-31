# Contributing to MikroTik NetDevOps Toolkit & MCP Server

Thank you for your interest in contributing to this MikroTik RouterOS v7 NetDevOps automation toolkit, MCP server, and AI engineering suite!

## Project Context
This project was authored by **Ardian Ryan** (<me@ardianryan.com>) to streamline network operations, multi-WAN load balancing, automated security auditing, and safe rule deployment on MikroTik RouterOS v7 devices. It is open-sourced to provide a reliable, modular, and safe foundation for network engineers and AI agent tool calling via the Model Context Protocol (MCP) and CLI.

## Development Setup

1. **Clone and install the lockfile without lifecycle scripts:**
   ```bash
   git clone https://github.com/ardianryan/MikroTik-Skill.git
   cd MikroTik-Skill
   npm ci --ignore-scripts
   ```

2. **Use offline tools first:**
   ```bash
   npm run mtik -- tui --offline
   ```
   Offline linting and configuration generation need no router or `.env`. Tests must use dummy credentials and temporary HOME/work directories. Never point verification at production routers or your personal profile/fleet store.

3. **Run isolated checks on macOS:**
   ```bash
   python3 -I scripts/verify-isolated.py typecheck
   python3 -I scripts/verify-isolated.py build
   python3 -I scripts/verify-isolated.py test
   python3 -I scripts/verify-isolated.py tui-smoke
   ```
   The runner creates a disposable HOME/build directory, restricts writes, and permits only loopback networking. It caps CPU time, child processes, file size, wall time, and Node heap. Native-memory and total disk quotas are not enforced; use a resource-limited VM/container when those limits are required.

   On other platforms, run `npm run typecheck`, `npm run build`, and `npm test` inside a disposable container with dummy environment variables and no router access. The pseudo-terminal runner currently requires macOS.

4. **Check dependencies when changing the lockfile:**
   ```bash
   npm audit --audit-level=moderate
   ```
   Advisory checks require registry access and report the advisory state at the time they run. Do not force incompatible dependency majors to silence an advisory.

## Development Standards
- **Language:** Code, comments, documentation, and error strings must be written in English.
- **Strict Layering:** Keep transport code in `src/client/`, configuration in `src/config/`, and logic in `src/safety/`.
- **Anti-Slop Comments:** Do not write decorative separators, obvious restatements, or workflow step commentary. Refer to `AGENTS.md`.
- **Zero Secrets:** Ensure tests and logs never expose plaintext passwords.
- **Vendor-Agnostic:** Always use generic identifiers (`ISP1`, `ISP2`, `WAN1`, `WAN2`).

## Submitting Pull Requests
1. Create a feature branch: `git checkout -b feature/my-feature`.
2. Run the applicable isolated checks above. Include verification evidence and identify any checks blocked by unavailable hardware or services.
3. Keep pull requests focused on a single concern.
4. Update `CHANGELOG.md` under `[Unreleased]` with a summary of your changes.

## Interface and safety changes

- Public HTTP/SSE must remain independent of router clients and credential/inventory storage. Test it with dummy credentials present to enforce that boundary.
- Local writes require audit context, a sanitized preview, interactive approval, state/target revalidation, and a verified 30-second watchdog. Dry-run must not create a scheduler or mutate router state.
- TUI form failures must leave input editable. Test keyboard focus, cancellation, resizing, and terminal restoration with a fake screen and the pseudo-terminal runner.
- Provisioning exports may contain required secrets; use private directories/files and never include their raw content in ordinary diagnostic output. New-directory TUI exports must refuse existing paths.
- Changes to router behavior require separate hardware validation. Mock tests do not prove device compatibility or successful recovery on a physical router.
