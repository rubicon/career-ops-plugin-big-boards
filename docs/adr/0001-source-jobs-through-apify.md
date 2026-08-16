---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Source jobs through Apify rather than fetching the boards directly

## Context and Problem Statement

The plugin needs postings from LinkedIn, Indeed, ZipRecruiter, and Glassdoor,
with enough of each posting to evaluate it later. Those boards bot-block
automated fetches with Cloudflare challenges and 403s, so a board URL captured
today is frequently unusable by the time anything tries to fetch it again.
Storing a URL and re-fetching on demand is therefore not a viable design.

## Considered Options

- Fetch board pages directly from the plugin, storing the URL for a later re-fetch
- Source through the Apify `agentx/all-jobs-scraper` actor, capturing the description at scrape time
- Use each board's official API where one exists

## Decision Outcome

Chosen option: "Source through the Apify actor", because it is the only option
that captures the full job description at the moment of the scrape, which
removes any later dependency on the board URL still being fetchable. Direct
fetching fails on the bot-blocking described above. Official APIs do not exist
for these consumer boards at the access tier this plugin needs, and each would
be a separate integration to build and maintain.

### Consequences

- Good, because the description is captured once and never needs re-fetching, so a bot-blocked or expired URL costs nothing.
- Good, because one integration covers four boards.
- Bad, because every scan costs money per actor run. Anything that narrows results after the fetch must never be able to zero out a paid run, which is why an empty positive title filter means allow-all (see 0004).
- Bad, because the plugin inherits the actor's reliability and its filtering defects (see 0004).

## More Information

Actor id and endpoint: `lib/scan-apify.mjs:36-37`.
