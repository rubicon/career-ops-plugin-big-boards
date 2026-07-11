# Architecture

career-ops-plugin-big-boards is a [career-ops](https://github.com/santifer/career-ops)
plugin that scans the big consumer job boards (LinkedIn, Indeed, ZipRecruiter,
Glassdoor, and other Apify-reachable sources) through the
[Apify](https://apify.com) `agentx/all-jobs-scraper` actor and feeds curated
roles, with full job-description text, into the career-ops pipeline. It uses
the `provider` hook, since it originates jobs rather than consuming them.

## Why Apify

The big job boards bot-block automated fetches (Cloudflare challenges, 403s),
which makes a stored board URL unusable later: the page can no longer be
fetched to evaluate it. Apify's scraper returns the full job description at
scrape time, so the plugin captures the content up front and never needs to
re-fetch a dead URL.

## Layout

```
career-ops-plugin-big-boards/
  manifest.json          # plugin manifest (provider hook, requiredEnv: APIFY_TOKEN,
                          # allowedHosts: api.apify.com)
  index.mjs               # the provider hook: calls the engine, returns Job[]
  lib/
    scan-apify-core.mjs   # curation logic: title/location/salary filters, slugify,
                           # pipeline-row formatting, scan-history dedup
    scan-apify.mjs         # engine: Apify actor call, multi-pass scan, JD caching
  test/
    smoke.mjs             # zero-network smoke test (manifest/hooks match)
  skill.md                 # agent-facing usage doc for this plugin
```

The `lib/` engine and curation core are ported from the fork-local
`scan-apify` implementation that previously lived directly in
[`career-ops-exec`](https://github.com/rubicon/career-ops-exec); that repo is
a read-only source for the port, not a dependency.

## Design boundary: curation and the network call are separate

The engine (`lib/scan-apify.mjs`) is responsible for calling the Apify actor
and assembling raw results across one or more scan passes. The curation core
(`lib/scan-apify-core.mjs`) is pure: it filters, dedupes against scan history,
slugifies job identifiers, and formats pipeline rows, all without touching the
network. Keeping curation pure makes it unit-testable without any live Apify
account or network access.

## Sandbox constraints

As a career-ops plugin, this repo runs inside the engine's sandbox:

- Egress only through `ctx.fetch` / `ctx.fetchJson` / `ctx.fetchText`, which
  enforces the manifest's `allowedHosts` allowlist and an SSRF guard. No
  `node:http`/`node:net`, no global `fetch`.
- Secrets (the Apify API token) come from `ctx.env`, declared in
  `manifest.requiredEnv`. The plugin never reads 1Password or any other
  credential store directly; that is the host application's concern, not the
  plugin's.
- Non-secret configuration (the location `passes:` list, result limits) comes
  from `ctx.settings`, the user's `config/plugins.yml` block for this plugin.
- `humanInTheLoop: true` in the manifest: the plugin only proposes roles into
  the pipeline. It never auto-submits anything.

## Data flow (target shape)

```
ctx.settings (passes:) ──> engine ──> Apify actor run ──> raw job results
                                                              │
                                                              ▼
                                            curation core (filter, dedupe, slugify)
                                                              │
                                                              ▼
                              Job[] { title, url, company, location, description }
                                                              │
                                                              ▼
                                    JD text cached locally; pipeline row references
                                    the local cached copy, not the bot-blocked board URL
```

## Current status

The plugin currently ships the career-ops-plugin template's placeholder hook
while the engine port, curation port, and provider wiring land through their
own issues. This document describes the target shape; `README.md` and
`skill.md` are updated to describe actual runtime behavior once the provider
hook lands.
