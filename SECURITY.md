# Security Policy

## Supported versions

Only the latest published version on the VS Code Marketplace is supported. There are no
maintained LTS branches — please upgrade before reporting an issue.

## What this extension touches

Copilot Pixel Agents runs an HTTP server bound to `127.0.0.1` (default port `7823`,
auto-incrementing if taken) to receive hook events from GitHub Copilot / Claude Code, and
it writes hook scripts and configuration under the user's home directory:

- `~/.copilot-pixel-agents/` (hook scripts, port file)
- `~/.vscode/agent-hooks.json` and `~/.claude/settings.json` (hook registration)
- `~/.copilot/hooks/` (Copilot user-level hooks directory)

The hook endpoint only accepts `POST` requests, enforces a body size limit
(`MAX_HTTP_BODY_BYTES`, see `src/hookPayload.ts`), and validates/normalizes every field
against an allowlist (`normalizeHookEvent`) before it reaches application state — it never
spreads or trusts arbitrary incoming JSON. Tool inputs/outputs are only retained in memory
when the opt-in `copilotPixelAgents.captureTaskDetails` setting is enabled (off by
default), go through best-effort secret redaction, and are never persisted to disk or
logged; enabling it can still surface source code or sensitive data pulled from your own
tool calls into the in-memory task inspector, so treat it accordingly.

The optional browser view is served from the same loopback listener under a random,
per-activation capability path. Static assets and the Server-Sent Events stream require
that path, responses do not enable CORS, and the browser view is read-only. The hook POST
endpoint remains unauthenticated, so the listener must never be exposed beyond loopback.
Do not share the browser URL because it can display any task details retained in memory.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for a suspected vulnerability. Instead, use
GitHub's private reporting flow:

[github.com/khalango02/copilot-pixel-agents/security/advisories/new](https://github.com/khalango02/copilot-pixel-agents/security/advisories/new)

Include:

- The extension version and OS
- Steps to reproduce, or a minimal example payload
- The impact you believe it has (e.g. arbitrary file write, code execution, information
  disclosure)

We aim to acknowledge reports within a few days. There is no bug bounty program.

## Dependencies

Production and webview dependencies are audited on every CI run
(`.github/workflows/ci.yml`) via `npm audit --omit=dev`. Dependabot
(`.github/dependabot.yml`) opens weekly update PRs for both npm workspaces and for the
GitHub Actions used in this repo; a PR is only merged once CI (typecheck + tests) passes.
