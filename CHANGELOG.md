# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4](https://github.com/rubicon/career-ops-plugin-big-boards/compare/v0.1.3...v0.1.4) (2026-10-23)


### Bug Fixes

* **scan:** raise the default actor timeout to 300000 ms ([#79](https://github.com/rubicon/career-ops-plugin-big-boards/issues/79)) ([d2dc8e8](https://github.com/rubicon/career-ops-plugin-big-boards/commit/d2dc8e85034b0e75e65548b4560f08389299d093)), closes [#67](https://github.com/rubicon/career-ops-plugin-big-boards/issues/67)

## [0.1.3] - 2026-10-13

LinkedIn sets no remote flag on its jobs, and the plugin read that silence as a no. A remote-only pass dropped those jobs at the city filter. They now stay in the results, tagged as unknown, so a person makes the call. Using the job description as a remote signal waits for a sample larger than five jobs.

### Changed

- A LinkedIn job from a remote-only pass with no remote signal is now kept. It carries the note `work arrangement unknown` on its `data/pipeline.md` row instead of falling to the city filter. Indeed and Glassdoor handling is unchanged ([#69](https://github.com/rubicon/career-ops-plugin-big-boards/pull/69), closes [#66](https://github.com/rubicon/career-ops-plugin-big-boards/issues/66)).

Contributors to this release: [Dax Davis](https://github.com/rubicon).

## [0.1.2] - 2026-10-12

Apify's actor build 1.0.52 started returning `location` as an object. The plugin read it as a string, so the city filter dropped every on-site job and `[object Object]` reached the host. Only remote jobs survived. One recorded 25-job run kept 3 jobs before the fix and 12 after. A free-plan limit also made passes return nothing with no signal, and that now gets a warning.

### Fixed

- Location is read from either a plain string or the actor's `location.raw`, at all four places the plugin used it. On-site jobs now pass the city filter, and the cached job-description files and the host get the real city text instead of `[object Object]` ([#64](https://github.com/rubicon/career-ops-plugin-big-boards/pull/64), closes [#63](https://github.com/rubicon/career-ops-plugin-big-boards/issues/63)).
- A pass that returns 0 items now logs a warning. The warning names the Apify free-plan limit as one known cause, because the plugin cannot read the actor log to confirm it ([#64](https://github.com/rubicon/career-ops-plugin-big-boards/pull/64)).

### Changed

- The README and `skill.md` now say `max_results` applies per platform per pass, and document `timeout_ms` ([#64](https://github.com/rubicon/career-ops-plugin-big-boards/pull/64)).

Contributors to this release: [Dax Davis](https://github.com/rubicon).

## [0.1.1] - 2026-08-15

The release config forced version 0.1.0 on every run, not just the first. Nothing had failed yet, because nothing had merged since v0.1.0. The next merge would have proposed 0.1.0 again and died on a tag that already existed. The same fault turned up in a sibling plugin first, which is how this one got checked.

### Release pipeline

- Release-please no longer pins the version to 0.1.0, so later versions are computed from commits instead of colliding with the existing tag ([#50](https://github.com/rubicon/career-ops-plugin-big-boards/pull/50), closes [#49](https://github.com/rubicon/career-ops-plugin-big-boards/issues/49)).

Contributors to this release: [Dax Davis](https://github.com/rubicon).

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

[Unreleased]: https://github.com/rubicon/career-ops-plugin-big-boards/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/rubicon/career-ops-plugin-big-boards/releases/tag/v0.1.3
[0.1.2]: https://github.com/rubicon/career-ops-plugin-big-boards/releases/tag/v0.1.2
[0.1.1]: https://github.com/rubicon/career-ops-plugin-big-boards/releases/tag/v0.1.1
[0.1.0]: https://github.com/rubicon/career-ops-plugin-big-boards/releases/tag/v0.1.0
