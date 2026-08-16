---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Curate in the plugin, because the actor's own filters leak

## Context and Problem Statement

The `agentx/all-jobs-scraper` actor accepts location, freshness, and keyword
parameters, so the obvious design is to pass the user's filters straight
through and trust the results. The actor's own issue tracker reports that all
three leak: results come back outside the requested location, older than the
requested window, and only loosely related to the keyword. Trusting them puts
irrelevant roles into the pipeline, which is the one thing the pipeline exists
to prevent.

## Considered Options

- Pass filters to the actor and trust its results
- Pass filters to the actor for a narrower fetch, then re-apply them locally as the authoritative gate
- Fetch broadly with no actor-side filtering and filter entirely locally

## Decision Outcome

Chosen option: "Re-apply locally as the authoritative gate", because the actor
parameters still reduce how much gets fetched, while the local gate decides
what is actually kept. `curate` applies dedupe, the seen-URL drop, then title,
location, and salary in that order.

Every gate fails open rather than silently emptying a paid scan:

- An empty or unset positive title list means allow all. Negatives still override positives, so "Chief Medical Officer (CMO)" is dropped despite matching the positive term "CMO".
- Term matching is a case-insensitive word-boundary regex with the term escaped before interpolation, so "Manager" does not match "Management".
- Location allows the configured cities plus remote, where remote is detected from either the actor's flag or a remote token in the location string.
- A job with no posted salary is kept. Only a posted range whose top is below the floor is dropped.

### Consequences

- Good, because filter behavior is deterministic, unit-tested, and independent of whatever the actor does this week.
- Good, because every dropped job carries a reason, so scan output is auditable.
- Good, because no filter can zero out a run that was already paid for.
- Bad, because filtering after the fetch means paying to retrieve jobs that are then discarded.
- Bad, because the actor's parameters and the local gate can disagree, and the local gate silently wins.

## More Information

Curation entry point: `lib/scan-apify-core.mjs:127`.
Filter semantics: `titleAllowed`, `matchesTerm`, `locationAllowed`,
`salaryAboveFloor`, `jobKey` in the same file.
The unreliability of the actor's filters is reported on the actor's own
Issues tab, noted at `lib/scan-apify-core.mjs:4-11`.
