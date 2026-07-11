# Agent Instructions

This is the canonical instruction file for AI coding agents working in this
repository. `AGENTS.md` is a pointer to this file.

## What this project is

career-ops-plugin-big-boards is a [career-ops](https://github.com/santifer/career-ops)
plugin that scans the big consumer job boards (LinkedIn, Indeed, ZipRecruiter,
Glassdoor, and other Apify-reachable sources) through the Apify
`agentx/all-jobs-scraper` actor, and feeds curated roles, with full
job-description text, into the career-ops pipeline. It uses the `provider`
hook, since it originates jobs rather than consuming them.

See `ARCHITECTURE.md` for the layout, data flow, and current build status.

## Non-negotiable invariants

- **Sandboxed network access only.** All egress goes through `ctx.fetch` /
  `ctx.fetchJson` / `ctx.fetchText`, which enforces the manifest's
  `allowedHosts` allowlist (`api.apify.com`) and an SSRF guard. Never import
  `node:http`/`node:net`, never call global `fetch`, never spawn processes.
  The career-ops plugin registry rejects any bare (npm) import in plugin
  source too: relative modules and allowlisted Node built-ins only.
- **No 1Password, no credential store, inside the plugin.** The Apify token is
  read from `ctx.env.APIFY_TOKEN` only (declared in `manifest.requiredEnv`).
  Where the user sources that value locally is their concern, not the
  plugin's.
- **Human-in-the-loop.** The plugin proposes roles into the pipeline; it never
  auto-submits anything. `manifest.json` keeps `humanInTheLoop: true`.
- **No personal data in the repo.** Tests and fixtures use non-personal sample
  data only.

## Commands

- `npm test` runs the zero-network smoke test (manifest hooks match the
  `index.mjs` exports).
- `npm run format:check` / `npm run format` (Prettier).
- In career-ops: `node plugins.mjs run big-boards provider` runs the plugin
  once the provider hook lands.

## Working conventions

- Conventional Commits; commit messages are linted in CI.
- No AI-authorship trailers, no "Generated with" lines. No em-dashes, no
  emojis, in code, comments, docs, commits, issues, or PRs.
- Run `npm test` and `npm run format:check` before opening a PR.
- Keep the network-calling engine and the pure curation logic in separate
  modules under `lib/` (see `ARCHITECTURE.md`), so curation stays unit-testable
  without a live Apify account.

## Repository process

This repository follows the maintainer's general repository process policy:
issue first, one branch per issue (`dev/<issue>-<slug>`), a git worktree per
branch, signed commits, and a PR (linking `Closes #N`) before anything merges
to `main`. Never push directly to `main`.

## Current build status

The plugin currently ships the career-ops-plugin template's placeholder
`ingest` hook while the engine port, curation port, and `provider` hook
wiring land through their own issues, ported from the fork-local `scan-apify`
implementation in `career-ops-exec` (a read-only source, not a dependency).
Do not change `manifest.json` hooks or `index.mjs` exports as part of
conformance or documentation work; that is the provider-wiring issue's scope.
