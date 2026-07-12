---
name: career-ops-plugin-big-boards
description: How to run the big-boards Apify scan as a keyed provider, what it produces, and how to configure it.
license: MIT
---

# big-boards

> This file teaches an AI agent how to drive THIS plugin. Keep it scoped to the
> plugin's own domain. It must not instruct the agent to edit core files, change
> curation logic, or act outside the plugin's declared `provider` hook.

This plugin scans LinkedIn, Indeed, ZipRecruiter, Glassdoor, and other
Apify-reachable boards through the Apify `agentx/all-jobs-scraper` actor. It
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
location }`. Each kept job's full description is cached locally to
`jds/{slug}-{hash}.md` and `url` points at the cached copy as
`local:jds/{slug}-{hash}.md`. The original board URL is preserved as
`_remote_url`, since the board itself will bot-block a later fetch. `Job`
does not carry a `description` field; the cached file is the description.

## Settings

Set under `plugins.big-boards` in the user's `config/plugins.yml` (they
arrive as `ctx.settings`):

- `titles`: array of search titles to scan. Required. The plugin throws a
  clear error if this is unset or empty.
- `passes`: array of scan passes to run per title. Optional; when omitted or
  empty, the plugin runs a single remote-only pass. Each entry is
  `{ label, location, distance, remote_only }`; `location` and `distance`
  are only meaningful when `remote_only` is not `true`.
- `title_filter`: `{ positive: [...], negative: [...] }`. A title is kept
  only when it matches at least one positive term and zero negative terms.
- `location_filter`: `{ allow_remote, dfw_cities: [...] }`. Controls which
  on-site locations are kept alongside remote roles.
- `salary_floor`: drop a job only when it posts a real salary and its top of
  range is below this number. Jobs with no posted salary are kept.
- `max_results`: per-pass result cap from the actor. Default `25`.
- `platforms`: boards to scan. Default `['LinkedIn', 'Indeed', 'ZipRecruiter', 'Glassdoor']`.
- `country`: default `'United States'`.
- `posted_since`: default `'14 days'`.

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
      - label: dfw
        location: 'Dallas, TX'
        distance: 50
    max_results: 25
```

## Cost

Every run against Apify costs real money: about $0.01 per actor start plus
about $0.0035 per result. A 5-title by 2-pass by 4-board config is
realistically $0.30 to $1.80 per run. Fewer titles, fewer passes, and a lower
`max_results` all lower the cost directly. See `README.md` for the full
disclosure and how to size a run before scheduling it.
