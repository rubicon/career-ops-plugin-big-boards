# career-ops-plugin-big-boards

Scan the big consumer job boards through Apify and feed curated roles, with
full job-description text, into the [career-ops](https://github.com/santifer/career-ops)
pipeline. A career-ops community plugin.

[![CI](https://github.com/rubicon/career-ops-plugin-big-boards/actions/workflows/ci.yaml/badge.svg)](https://github.com/rubicon/career-ops-plugin-big-boards/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

career-ops-plugin-big-boards pulls roles from LinkedIn, Indeed, ZipRecruiter,
Glassdoor, and other Apify-reachable sources, using the
`agentx/all-jobs-scraper` Apify actor. Unlike a stored board URL, which the big
boards bot-block on a later fetch, the actor returns the full job description
at scrape time, so the plugin captures the content up front and curates it
into the pipeline without ever needing to re-fetch a dead link.

It is a keyed provider: it never auto-detects, and only runs when the user
adds an explicit `provider: big-boards` entry to `portals.yml`. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the design and data flow.

## Setup

1. Create an Apify account at [apify.com](https://apify.com) if you do not
   already have one, and copy your API token from the Apify console.
2. Supply that token as the `APIFY_TOKEN` environment variable wherever
   career-ops runs. The plugin reads it from `ctx.env.APIFY_TOKEN` only; it
   never reads 1Password or any other credential store, and does not care
   how you get the value into the environment.
3. Install the plugin from your career-ops checkout:

   ```bash
   node plugins.mjs add big-boards
   ```

4. Enable it and configure at least `titles` in `config/plugins.yml`:

   ```yaml
   plugins:
     big-boards:
       enabled: true
       titles:
         - 'VP Marketing'
   ```

5. Add a keyed provider entry to `portals.yml`:

   ```yaml
   tracked_companies:
     - name: 'Big boards scan'
       provider: big-boards
   ```

## Configuration

Settings live under `plugins.big-boards` in `config/plugins.yml`:

| Setting           | Default                                               | Meaning                                                                  |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `titles`          | none (required)                                       | Search titles to scan. The plugin throws if this is unset or empty.      |
| `passes`          | one remote-only pass                                  | Scan passes per title: `{ label, location, distance, remote_only }`.     |
| `title_filter`    | none                                                  | `{ positive: [...], negative: [...] }` term filters on the job title.    |
| `location_filter` | none                                                  | `{ allow_remote, cities: [...] }` filters on-site locations.             |
| `salary_floor`    | none                                                  | Drop a job only when it posts a salary whose top of range is below this. |
| `max_results`     | `25`                                                  | Per-pass result cap from the actor.                                      |
| `platforms`       | `['LinkedIn', 'Indeed', 'ZipRecruiter', 'Glassdoor']` | Boards to scan.                                                          |
| `country`         | `'United States'`                                     | Country passed to the actor.                                             |
| `posted_since`    | `'14 days'`                                           | Recency window passed to the actor.                                      |

Example:

```yaml
plugins:
  big-boards:
    enabled: true
    titles:
      - 'VP Marketing'
      - 'CMO'
    passes:
      - label: remote
        remote_only: true
      - label: onsite
        location: 'Chicago, IL'
        distance: 50
    max_results: 25
```

## Usage

```bash
node plugins.mjs run big-boards provider
```

This runs the `provider` hook once for the matching `portals.yml` entry (see
Setup above) and returns the scanned, curated `Job[]` for career-ops to write
to the pipeline.

## What it produces

`Job[]`, the standard career-ops producer shape: `{ title, url, company,
location }`. When a kept job's description is at least 50 characters and the
local write succeeds, the plugin caches it to `jds/{slug}-{hash}.md`, `url`
points at that cached copy as `local:jds/{slug}-{hash}.md`, and the original
board URL is preserved as `_remote_url`, so the pipeline row survives the
board's own bot-block. Otherwise `url` falls back to the original board URL
and `_remote_url` is omitted.

## Cost

Apify bills this actor pay-per-event: about $0.01 per actor start plus about
$0.0035 per result, per the actor's documented pricing on its Apify Store
listing, <https://apify.com/agentx/all-jobs-scraper>, as of 2026-07-12
(`agentx/all-jobs-scraper`, "All Jobs Scraper"). There is no monthly rental;
every run costs money.

For a 5-title by 2-pass by 4-board configuration, a realistic run costs about
$0.30 to $1.80. Run daily, that is about $9 to $53 per month. Actual cost
scales directly with how many results the actor returns, so the levers that
lower it are:

- `max_results`: the per-pass result cap. Lowering it caps the worst case
  directly.
- Fewer `titles`: each title runs its own set of passes.
- Fewer `passes` per title: each pass is a separate actor run, so each one
  adds its own $0.01 start cost on top of its results.
- Lower run cadence (for example weekly instead of daily), if run on a
  schedule.

Apify's own subscription tiers lower the per-result rate further (down to
about $0.00315 at their higher tiers), but the free-tier rate above is the
number to budget against before subscribing to anything. Verify current
pricing at the actor's Apify Store page before relying on these numbers for
budgeting, since Apify can change them.

## Development

```bash
npm install        # dev tooling only (Prettier, commitlint); the plugin's
                    # own runtime code stays dependency-free
npm test           # zero-network smoke test
npm run format:check
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and discussion are welcome. This
plugin is human-in-the-loop by design: it proposes roles into the pipeline, it
never submits anything anywhere.

## License

MIT. See [LICENSE](LICENSE).

## Contributors

![Contributors](https://contrib.rocks/image?repo=rubicon/career-ops-plugin-big-boards)
