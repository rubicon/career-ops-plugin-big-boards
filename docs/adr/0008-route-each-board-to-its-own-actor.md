---
status: accepted
date: 2026-10-27
decision-makers: Dax Davis
---

# Route each board to its own Apify actor

## Context and Problem Statement

0001 chose Apify as the source and `agentx/all-jobs-scraper` as the one actor
covering every board. On 2026-10-26 that actor refused every run on a free
Apify plan: each pass ended with 0 items and the log line "Free-plan limit
reached for this Actor", the new billing cycle did not reset it, and every
refused pass still billed its start fee (issue #83). A scan on that plan
returned nothing while still costing money.

## Considered Options

- Keep `agentx/all-jobs-scraper` and require a paid Apify plan
- `openclawai/job-board-scraper` for all four boards in one run
- One actor per board: `johnvc/linkedin-jobs-api` for LinkedIn,
  `johnvc/indeed-jobs-api` for Indeed, and `openclawai/job-board-scraper`
  with `sites: ["zip_recruiter"]` for ZipRecruiter

## Decision Outcome

Chosen option: "One actor per board", because each of the three returned
results on a free plan in the test runs recorded in #83, and a board that fails
no longer takes the other boards in its pass down with it. Apify stays the
source, so 0001's reasoning about bot-blocking still holds; only the actor
changes. The single multi-board run was rejected because it cost about $0.011
per job, returned no Glassdoor results and took 181 seconds. A paid plan was
rejected as an ongoing cost for an actor that had worked on 25 results.

Glassdoor gets no default route, since no tested actor returned Glassdoor
results. `settings.platforms` can still name it; the engine logs that no actor
is routed for it and skips it.

### Consequences

- Good, because a scan works on a free Apify plan.
- Good, because failure isolation moves from the pass to the board within a pass (extends 0007).
- Good, because each actor returns `location` as a string.
- Bad, because a pass is now one actor run per board, so a scan makes more runs, each with its own small start fee.
- Bad, because the plugin maps three actors' item shapes into the raw job shape the curation core reads, and a change to any of them needs a change in `lib/boards.mjs`.
- Bad, because the ZipRecruiter rows tested carried no description, so those jobs are not cached locally and keep their board URL (see 0005).
- Bad, because the ZipRecruiter rows tested carried no remote flag either, so in a remote-only pass a ZipRecruiter job is kept and tagged work arrangement unknown, as a LinkedIn job is.
- Bad, because Glassdoor is no longer scanned by default.

## More Information

Issue #83, including its test runs on 2026-10-26.
Board routes, input builders and item mappers: `BOARDS` and `boardFor` in `lib/boards.mjs`.
Per-board loop, status-row handling and error handling: `scanApify` in `lib/scan-apify.mjs`.
Unknown work arrangement for LinkedIn and ZipRecruiter: `arrangementUnknown` in `lib/scan-apify-core.mjs`.
Tests: `test/boards.test.mjs`, and `test/scan-apify.test.mjs`, "one actor run per routed board, and no agentx run".
