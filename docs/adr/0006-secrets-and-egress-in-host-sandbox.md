---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Secrets and egress stay inside the host sandbox

## Context and Problem Statement

This plugin was ported from a fork-local script that resolved its own Apify
token through 1Password and made its own HTTP calls. Neither is available to a
plugin: the career-ops registry rejects bare npm imports in plugin source, and
rejects `node:http`, `node:net`, and global `fetch`. The port had to decide
where the token comes from and how requests leave the process.

## Considered Options

- Keep the script's 1Password resolution inside the plugin
- Read the token from `ctx.env` and send every request through the host's `ctx.fetch` family
- Accept the token as plain configuration in `ctx.settings`

## Decision Outcome

Chosen option: "Read from `ctx.env`, egress through `ctx.fetchJson`", because it
is what the sandbox permits and what keeps credential sourcing out of the
plugin entirely. The token is declared in `manifest.requiredEnv`, egress is
bounded by `manifest.allowedHosts` (`api.apify.com`) plus the host's SSRF
guard, and `manifest.humanInTheLoop` is `true` so the plugin only ever proposes
roles.

Where the user sources that value locally, 1Password or otherwise, is the host
application's concern. Putting the token in `ctx.settings` was rejected because
settings are non-secret configuration and would put a credential in
`config/plugins.yml`.

### Consequences

- Good, because the plugin holds no credential store and cannot leak one.
- Good, because the allowlist and SSRF guard are enforced by the host, not by plugin discipline.
- Good, because misconfiguration surfaces before any paid call: the engine throws immediately when the token is absent, or when `settings.titles` is missing or contains a non-string.
- Bad, because the plugin cannot run outside the host at all, including in a scratch script.
- Bad, because Node built-in imports must stay within the allowlisted set, currently `node:fs`, `node:crypto`, and `node:path`.

## More Information

Token read and validation: `lib/scan-apify.mjs:166-179`.
Egress: `lib/scan-apify.mjs:82`. Manifest declarations: `manifest.json`.
Invariants restated for agents: `CLAUDE.md`, "Non-negotiable invariants".
