---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Cache the job description locally and point the Job url at the cache

## Context and Problem Statement

0001 establishes that the description must be captured at scrape time, because
the board URL will not be fetchable later. That leaves the question of where
the captured text goes. The `Job` contract the host consumes is
`{ title, url, company, location }`, so the natural first guess is to add a
`description` field and let the host decide what to do with it. That guess was
never verified against how the host's own bundled plugin behaves.

## Considered Options

- Add a `description` field to the returned `Job` and pass the text through
- Cache the description to a local file and point the `Job` url at that file, following the bundled `apify` plugin
- Return the board URL and let a later stage fetch the description

## Decision Outcome

Chosen option: "Cache locally and point the url at the cache", because it is
what the bundled `apify` reference plugin already does. That was settled by
reading `career-ops-exec/plugins/apify/index.mjs` rather than by picking the
shape that seemed cleanest. Following the established pattern beats inventing a
third one.

`cacheJobDescription` writes to `jds/{slug}-{sha1_10}.md` with YAML front
matter using an atomic `wx` write. `toJob` returns `url: local:jds/{...}.md`
and preserves the original board URL as `_remote_url`. The third option is
excluded by 0001: a later fetch is exactly what bot-blocking defeats.

### Consequences

- Good, because the pipeline row references text that exists on disk instead of a URL that will 403.
- Good, because it matches the host's own bundled plugin, so it behaves the way the host's other providers do.
- Good, because the URL-hash suffix keeps two postings sharing a company and title from colliding, and an `EEXIST` race resolves to the existing path.
- Bad, because the plugin writes files, which is why this lives in the engine and not the pure core (see 0002).
- Bad, because descriptions shorter than 50 characters are not cached at all, so those rows fall back to the remote URL and lose the protection above.

## More Information

Caching: `lib/scan-apify.mjs:98`. Job mapping: `lib/scan-apify.mjs:146`.
Pattern source, read to settle this and not a dependency:
career-ops-exec `plugins/apify/index.mjs`.
