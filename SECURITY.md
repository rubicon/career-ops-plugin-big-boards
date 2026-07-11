# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a
vulnerability.

- Preferred: [GitHub private vulnerability reporting](https://github.com/rubicon/career-ops-plugin-big-boards/security/advisories/new).
- Fallback: email dax@rubicontv.com.

Please include the version, a description of the issue, and steps to reproduce
it. You can expect an acknowledgement within a few days.

## What to include

- The plugin version (see `package.json` or `manifest.json`).
- A clear description of the problem and its impact.
- Reproduction steps, and a proof of concept if you have one.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Scope

This plugin makes outbound HTTPS requests to the Apify API only, through the
career-ops engine's sandboxed `ctx.fetch`, which enforces the manifest's
`allowedHosts` allowlist and an SSRF guard. It never reads `node:http`/`node:net`
directly and never spawns processes. Its only secret is the Apify API token,
supplied through `ctx.env` (a standard environment variable); it never reads
1Password or any other credential store itself. Reports about the allowlist,
token handling, or malformed scraper responses causing unexpected behavior are
in scope.
