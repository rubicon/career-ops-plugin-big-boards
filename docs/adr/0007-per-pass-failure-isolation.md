---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Per-pass failure isolation, within-run dedupe only

## Context and Problem Statement

A scan runs one or more Apify passes per configured title, so a single run
makes many network calls. Two questions follow. First, what happens when one
pass fails partway through a multi-title scan. Second, how a role that surfaces
under two different searched titles avoids being cached and returned twice.
The script this was ported from answered the second question with a persisted
`scan-history.tsv` that it wrote itself, which a plugin cannot do.

## Considered Options

- Let any failed pass abort the run
- Wrap each pass, log the failure, and continue with the remaining passes
- Retry failed passes before continuing

## Decision Outcome

Chosen option: "Wrap each pass and continue", because a partial result is worth
more than no result when each pass costs money and the failures are typically
per-request. A failed pass is logged through `ctx.log` and skipped.

For dedupe, the plugin keeps a run-local `Set` seeded across titles by
`markKeptSeen`, not a persisted file. The host owns `pipeline.md` and
`scan-history.tsv` through its own canonical writers once the hook returns, so
cross-run dedupe is not the plugin's to do. Retries were not added because
nothing has yet shown that the failures are transient, and a retry multiplies a
paid call.

### Consequences

- Good, because a partial network failure yields a smaller scan rather than a dead one.
- Good, because a role surfacing under two searched titles is cached and returned once.
- Bad, because a systematically failing pass looks like a thin scan rather than an error, visible only in the log.
- Bad, because cross-run dedupe depends entirely on the host, so running the hook outside the normal pipeline can re-propose roles already seen.

## More Information

Pass loop and error handling: `lib/scan-apify.mjs:190-205`.
Cross-title seen-set: `markKeptSeen` in `lib/scan-apify-core.mjs`.
Resilience test: `test/scan-apify.test.mjs`, "one failed pass does not abort the run".
