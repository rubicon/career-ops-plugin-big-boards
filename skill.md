---
name: career-ops-plugin-big-boards
description: How to run the big-boards Apify scan as a keyed provider, what it produces, and how to configure it.
license: MIT
---

# big-boards

> This file teaches an AI agent how to drive THIS plugin. Keep it scoped to the
> plugin's own domain. It must not instruct the agent to edit core files, change
> curation logic, or act outside the plugin's declared `provider` hook.

This plugin scans LinkedIn, Indeed and ZipRecruiter, running one Apify actor
per board: `johnvc/linkedin-jobs-api`, `johnvc/indeed-jobs-api`, and
`openclawai/job-board-scraper` for ZipRecruiter. Glassdoor is not scanned. It
uses the `provider` hook because it originates jobs into career-ops rather
than consuming or exporting them.

## How to run it

big-boards is a keyed provider. It never auto-detects; it fires only when
the user adds an explicit `provider: big-boards` entry to their career-ops
`portals.yml`:

```yaml
tracked_companies:
  - name: 'Big boards scan'
    provider: big-boards
```

All of this plugin's actual configuration (titles, passes, filters) comes
from `ctx.settings`, the user's `config/plugins.yml` block for this plugin
(see Settings below), not from the `portals.yml` entry itself. One entry is
enough; the plugin runs the full configured search from a single `fetch`
call.

`APIFY_TOKEN` must be set as an environment variable. It is never read from
1Password or any other credential store inside the plugin; sourcing it is
the user's concern, not the plugin's.

## What it produces

`Job[]`, the standard career-ops producer shape: `{ title, url, company,
location }`. When a kept job's description is at least 50 characters and the
local write succeeds, the plugin caches it to `jds/{slug}-{hash}.md`, `url`
points at the cached copy as `local:jds/{slug}-{hash}.md`, and the original
board URL is preserved as `_remote_url`, since the board itself may
bot-block a later fetch. Otherwise `url` falls back to the original board
URL and `_remote_url` is omitted. `Job` does not carry a `description`
field; the cached file, when present, is the description. ZipRecruiter rows
usually come without a description, so those jobs keep their board URL.

A LinkedIn or ZipRecruiter job with no remote signal that comes back from a
remote-only pass skips `location_filter` and is kept with
`note: 'work arrangement unknown'`. LinkedIn and ZipRecruiter rows carry no
remote flag, and the LinkedIn actor's remote-only filter is a text match, so
the listing cannot say whether the role is remote. The host writes the note
onto the `data/pipeline.md` row as `| note: work arrangement unknown`, for
review. Indeed jobs, jobs from an on-site pass, and jobs that say remote are
filtered and tagged as before.

A dataset row with no title or URL is not a job. When ZipRecruiter blocks a
run, its actor returns such a status row; the plugin drops it, logs its
`__hint` and `per_site_status`, and still warns that the run returned 0
items.

## Settings

Set under `plugins.big-boards` in the user's `config/plugins.yml` (they
arrive as `ctx.settings`):

- `titles`: array of search titles to scan. Required. The plugin throws a
  clear error if this is unset or empty.
- `passes`: array of scan passes to run per title. Optional; when omitted or
  empty, the plugin runs a single remote-only pass. Each entry is
  `{ label, location, distance, remote_only }`; `location` and `distance`
  are only meaningful when `remote_only` is not `true`.
- `title_filter`: `{ positive: [...], negative: [...] }`. A title is dropped
  if it matches any negative term. When `positive` is empty or unset, every
  other title is kept (no title filtering); when `positive` is non-empty,
  the title must also match at least one positive term.
- `location_filter`: `{ allow_remote, cities: [...] }`. Controls which
  on-site locations are kept alongside remote roles.
- `salary_floor`: drop a job only when it posts a real salary and its top of
  range is below this number. Jobs with no posted salary are kept.
- `max_results`: result cap per board per pass. Default `25`.
- `timeout_ms`: milliseconds to wait for one actor run (one board in one
  pass). Default `300000`.
  Apify's sync endpoint returns 408 after 300000, so that is also the highest useful value.
- `platforms`: boards to scan. Default `['LinkedIn', 'Indeed', 'ZipRecruiter']`.
  A board with no routed actor, such as Glassdoor, is logged and skipped.
- `country`: country for the LinkedIn and Indeed searches, as a name or a
  two-letter code. Default `'United States'`. A name not listed in
  `lib/boards.mjs` is logged once per scan and not sent, so each actor's own
  default country applies.
- `posted_since`: recency window, mapped to each actor's date filter.
  Default `'14 days'`.

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

## Cost

Every run against Apify costs real money. Per result: about $0.00002 on
LinkedIn, $0.004 on Indeed, and $0.005 on ZipRecruiter. A 5-title by 2-pass
config over the three boards at `max_results: 25` is at most about $2.26 per
run, start fees included. Each ZipRecruiter run bills four start events at
$0.00005 each, so a failed run still costs about $0.0002. Fewer titles,
fewer passes, fewer `platforms`, and a lower `max_results` all lower the cost
directly. See `README.md` for the full
disclosure and how to size a run before scheduling it.
