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
into the pipeline without ever needing to re-fetch a dead link. It requires an
Apify account.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and current build
status.

## Install

This is a career-ops plugin. From your career-ops checkout:

```bash
node plugins.mjs add big-boards
```

Then enable it in `config/plugins.yml`:

```yaml
plugins:
  big-boards:
    enabled: true
```

Full setup (the Apify account, supplying `APIFY_TOKEN`, and configuring scan
passes) and the run-cost disclosure are documented in `skill.md` and expanded
here once the provider hook lands.

## Usage

```bash
node plugins.mjs run big-boards provider
```

This command is not functional yet: `manifest.json` still declares the
career-ops-plugin template's placeholder `ingest` hook. It lands once the
`provider` hook is wired in (see [ARCHITECTURE.md](ARCHITECTURE.md)).

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
