---
name: career-ops-plugin-example
description: How to use the example plugin and the data it produces.
license: MIT
---

# example

> This file teaches an AI agent how to drive THIS plugin. Keep it scoped to the
> plugin's own domain — it must not instruct the agent to edit core files, change
> scoring, or act outside the plugin's declared hooks.

## How to run it

- `node plugins.mjs run example` — runs the plugin's hook.

## What it produces

TODO: describe the data structure. For a producer hook, the `Job[]` fields you
emit (title, url, company, location). For an export hook, what you push and where.

## Settings

TODO: any non-secret options the user sets in `config/plugins.yml` under
`plugins.example` (these arrive as `ctx.settings`).
