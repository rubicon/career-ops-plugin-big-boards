# Architecture

career-ops-plugin-big-boards is a [career-ops](https://github.com/santifer/career-ops)
plugin that scans the big consumer job boards (LinkedIn, Indeed, ZipRecruiter,
Glassdoor, and other Apify-reachable sources) through the
[Apify](https://apify.com) `agentx/all-jobs-scraper` actor and feeds curated
roles, with full job-description text, into the career-ops pipeline. It uses
the `provider` hook, since it originates jobs rather than consuming them.

## Decisions

This document covers what the code does and where it lives. Why it is shaped
this way, what was rejected, and what each choice costs are in
[`docs/adr/`](docs/adr/README.md):

- [0001](docs/adr/0001-source-jobs-through-apify.md) Source jobs through Apify rather than fetching the boards directly
- [0002](docs/adr/0002-separate-engine-from-curation-core.md) Keep the network engine and the pure curation core in separate modules
- [0003](docs/adr/0003-keyed-provider-hook-shape.md) Implement the provider hook as the keyed-provider object, not a bare function
- [0004](docs/adr/0004-curate-in-the-plugin.md) Curate in the plugin, because the actor's own filters leak
- [0005](docs/adr/0005-cache-job-descriptions-locally.md) Cache the job description locally and point the Job url at the cache
- [0006](docs/adr/0006-secrets-and-egress-in-host-sandbox.md) Secrets and egress stay inside the host sandbox
- [0007](docs/adr/0007-per-pass-failure-isolation.md) Per-pass failure isolation, within-run dedupe only

## Layout

```
career-ops-plugin-big-boards/
  manifest.json          # plugin manifest (provider hook, requiredEnv: APIFY_TOKEN,
                          # allowedHosts: api.apify.com)
  index.mjs               # the provider hook: calls the engine, returns Job[]
  lib/
    scan-apify-core.mjs   # curation logic: title/location/salary filters, slugify,
                           # scan-history dedup
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

The engine (`lib/scan-apify.mjs`) calls the Apify actor and assembles raw
results across one or more scan passes. The curation core
(`lib/scan-apify-core.mjs`) is pure: it filters, dedupes against scan history,
and slugifies job identifiers, without touching the network. The engine imports
three symbols from the core (`curate`, `slugify`, `markKeptSeen`); nothing flows
the other way.

Rationale and trade-offs:
[0002](docs/adr/0002-separate-engine-from-curation-core.md), and
[0004](docs/adr/0004-curate-in-the-plugin.md) for why curation happens here at
all rather than in the actor.

## Sandbox constraints

As a career-ops plugin, this repo runs inside the engine's sandbox:

- Egress only through `ctx.fetch` / `ctx.fetchJson` / `ctx.fetchText`, which
  enforces the manifest's `allowedHosts` allowlist and an SSRF guard. No
  `node:http`/`node:net`, no global `fetch`.
- Secrets (the Apify API token) come from `ctx.env`, declared in
  `manifest.requiredEnv`. The plugin never reads 1Password or any other
  credential store directly.
- Non-secret configuration (the location `passes:` list, result limits) comes
  from `ctx.settings`, the user's `config/plugins.yml` block for this plugin.
- `humanInTheLoop: true` in the manifest: the plugin only proposes roles into
  the pipeline. It never auto-submits anything.

Rationale: [0006](docs/adr/0006-secrets-and-egress-in-host-sandbox.md).

## Data flow

```
ctx.settings (titles, passes) ──> engine ──> Apify actor run ──> raw job results
                                                                       │
                                                                       ▼
                                                     curation core (filter, dedupe, slugify)
                                                                       │
                                                                       ▼
                                                description cached to jds/{slug}.md locally
                                                                       │
                                                                       ▼
                                      Job[] { title, url, company, location, _remote_url? }
```

The engine caches each kept job's description to `jds/` itself and returns a
`url` of `local:jds/{slug}.md`, keeping the original board URL as
`_remote_url`. `Job` does not carry a `description` field. The pipeline row
therefore references the cached JD, not the board's bot-blocked URL, directly
out of the engine.

Rationale, including the shape that was rejected:
[0005](docs/adr/0005-cache-job-descriptions-locally.md).

## Current status

The curation core, the engine (`lib/scan-apify.mjs`), and the `provider` hook
(`index.mjs`) are all wired. `manifest.json` declares `hooks: ["provider"]`,
and a `provider: big-boards` entry in `portals.yml` is enough to drive a full
configured scan. `README.md` and `skill.md` describe the actual runtime
behavior.
