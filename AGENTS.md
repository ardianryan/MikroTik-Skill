# AI Agent Guidelines & Repository Directives — MikroTik NetDevOps Suite

This repository is a production-grade NetDevOps automation toolkit, Model Context Protocol (MCP) server, and AI engineering suite for MikroTik RouterOS v7. All AI coding assistants working in this repository must adhere strictly to the engineering rules below.

## Code and Architecture Directives
1. **Clean Architecture:** Maintain strict separation of concerns between `client/` (I/O transport), `config/` (credentials), `safety/` (validation, audit, diff), and `cli/`/`mcp/` (interfaces).
2. **Type Safety:** 100% strict TypeScript types. Avoid `any` wherever possible.
3. **Vendor-Neutral Terminology:** Never use commercial ISP brand names. Always refer to `ISP1`, `ISP2`, `WAN1`, `WAN2`, `Primary ISP`, or `Secondary ISP`.
4. **Credential Isolation:** Never log, print, or leak raw passwords, authorization tokens, or secrets. Always use `sanitizeConfig` or equivalent masking.
5. **Advisory & Confirmation-First Protocol (No Blind Mutations):**
   - Never mutate live router configurations directly without prior interactive consultation.
   - Always clarify user intent using open questions or the interactive `ask_question` dialog box.
   - Always present a diagnostic assessment or audit report with numbered findings (`[F-01]`, `[F-02]`, etc.) before suggesting mutations.
   - Require explicit user selection of which findings to remediate, preview changes with `--dry-run` visual diff, and apply mutations only under an armed 30-second safe-mode watchdog.
6. **Knowledge Retrieval Hierarchy (Local First, Live LLM Docs as Last Resort):**
   - **Tier 1 (Default & Primary):** Always utilize local knowledge, runbooks, and architectures embedded in `.agents/skills/mikrotik/SKILL.md` and `references/`. Never make unnecessary web requests if the solution is already documented locally.
   - **Tier 2 (Fallback / Last Resort):** Querying official live web documentation (`https://manual.mikrotik.com/llms.txt`, `https://manual.mikrotik.com/docs/<path>.md`, or `/docs/cli-reference/`) is strictly a fallback mechanism when encountering unlisted hardware chip capabilities, emerging RouterOS v7 minor release syntax, or parameters missing from the local skill.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy & text: `skills/antislop-copywriting/SKILL.md`
- People: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`

### Code Comment Hygiene Rules
- **No Decorative Banners:** Never write comments wrapped in `====`, `----`, or box-drawing characters.
- **No Obvious Echoing:** Do not add comments that merely restate the variable name or function signature.
- **No Step Narration:** Do not write step-by-step sequential commentary (`// Step 1:`, `// Step 2:`).
- **No Decorative Emojis:** Do not place emojis in code comments.
- **Preserve Valuable Insights:** Comments are strictly reserved for non-obvious RouterOS v7 technical decisions (such as kernel FIB requirements or Hairpin NAT accept ordering).
<!-- antislop:end -->
