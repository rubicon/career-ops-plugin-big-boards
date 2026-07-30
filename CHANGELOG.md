# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-30

First published release.

### Added

- Big-board scanning for career-ops through the plugin `provider` hook, pulling roles from LinkedIn, Indeed, ZipRecruiter, Glassdoor, and other Apify-reachable sources. The job description is captured at scrape time, so a role stays usable even after the board bot-blocks a later fetch ([#20](https://github.com/rubicon/career-ops-plugin-big-boards/pull/20)).
- The Apify scan engine, which reaches the actor through `ctx.fetch` and reads its token from `ctx.env.APIFY_TOKEN` only, so the plugin carries no credential store of its own ([#18](https://github.com/rubicon/career-ops-plugin-big-boards/pull/18)).
- Configurable scan passes per title through `settings.passes`, each with its own label, location, distance, and remote-only flag ([#19](https://github.com/rubicon/career-ops-plugin-big-boards/pull/19)).
- The curation core and its unit tests, covering title and location filters, a salary floor, deduplication, and pipeline-line rendering ([#8](https://github.com/rubicon/career-ops-plugin-big-boards/pull/8)).

### Fixed

- An empty `title_filter.positive` now keeps every fetched result instead of discarding all of them ([#24](https://github.com/rubicon/career-ops-plugin-big-boards/pull/24)).

### Release pipeline

- Release automation addresses its 1Password credential item by UUID, so renaming that item no longer breaks the release run ([#34](https://github.com/rubicon/career-ops-plugin-big-boards/pull/34)).
- The release-please baseline was set so this first release could be cut at 0.1.0 rather than release-please's default first-release 1.0.0 ([#28](https://github.com/rubicon/career-ops-plugin-big-boards/pull/28)).

Contributors to this release: [Dax Davis](https://github.com/rubicon).

[Unreleased]: https://github.com/rubicon/career-ops-plugin-big-boards/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rubicon/career-ops-plugin-big-boards/releases/tag/v0.1.0
