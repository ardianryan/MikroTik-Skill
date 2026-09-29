# Contributing to MikroTik NetDevOps Toolkit & MCP Server

Thank you for your interest in contributing to this MikroTik RouterOS v7 NetDevOps automation toolkit, MCP server, and AI engineering suite!

## Project Context
This project was authored by **Ardian Ryan** (<me@ardianryan.com>) to streamline network operations, multi-WAN load balancing, automated security auditing, and safe rule deployment on MikroTik RouterOS v7 devices. It is open-sourced to provide a reliable, modular, and safe foundation for network engineers and AI agent tool calling via the Model Context Protocol (MCP) and CLI.

## Development Setup

1. **Clone and Install:**
   ```bash
   git clone https://github.com/ardianryan/MikroTik-Skill.git
   cd MikroTik-Skill
   npm install
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Update with test router IP, credentials, and ports
   ```

3. **Compile & Typecheck:**
   ```bash
   npm run typecheck
   npm run build
   ```

4. **Run Tests:**
   ```bash
   npm test
   ```

## Development Standards
- **Language:** Code, comments, documentation, and error strings must be written in English.
- **Strict Layering:** Keep transport code in `src/client/`, configuration in `src/config/`, and logic in `src/safety/`.
- **Anti-Slop Comments:** Do not write decorative separators, obvious restatements, or workflow step commentary. Refer to `AGENTS.md`.
- **Zero Secrets:** Ensure tests and logs never expose plaintext passwords.
- **Vendor-Agnostic:** Always use generic identifiers (`ISP1`, `ISP2`, `WAN1`, `WAN2`).

## Submitting Pull Requests
1. Create a feature branch: `git checkout -b feature/my-feature`.
2. Ensure `npm run typecheck` and `npm test` pass with zero errors.
3. Keep pull requests focused on a single concern.
4. Update `CHANGELOG.md` under `[Unreleased]` with a summary of your changes.
