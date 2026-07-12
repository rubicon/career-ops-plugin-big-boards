// SPDX-License-Identifier: MIT
// @ts-check
// big-boards — a career-ops plugin.
// Guide: https://github.com/santifer/career-ops/blob/main/docs/PLUGINS.md
//
// Rules the engine enforces for you:
//  - Egress ONLY through ctx.fetch / ctx.fetchJson / ctx.fetchText (your manifest
//    `allowedHosts` is applied + SSRF-guarded). Do NOT import node:http/net or
//    call global fetch — community plugins are rejected for that.
//  - Producers (provider/ingest/search) RETURN Job[] = { title, url, company, location };
//    the engine writes them to the pipeline. Consumers (export/notify) push to
//    the user's own store. There is no auto-submit hook.
//  - Keys come from ctx.env (declare them in manifest.requiredEnv); non-secret
//    settings come from ctx.settings (the user's config/plugins.yml block).
//
// The `provider` hook is the KEYED-PROVIDER shape from career-ops-exec's
// plugins/_types.js (read-only reference; not a dependency of this repo):
// `{ id, detect?, fetch(entry, ctx) }`, byte-identical to a core
// providers/*.mjs Provider plus ctx.env. The engine forces detect() to null
// (a keyed provider never auto-detects; it fires only on an explicit
// `provider: big-boards` portals.yml entry) and invokes fetch(entry, ctx)
// once per such entry. All of this plugin's configuration comes from
// ctx.settings (config/plugins.yml), not from the portals.yml entry, so
// `entry` is accepted (to satisfy the contract) and otherwise unused.
//
// scanApify(ctx) (lib/scan-apify.mjs) is self-contained: it reads
// ctx.settings.titles and runs one local + one remote Apify pass per title,
// so a single portals.yml entry with `provider: big-boards` is enough to
// drive the whole configured search.

import { scanApify } from './lib/scan-apify.mjs';

export default {
  provider: {
    id: 'big-boards',
    detect() {
      return null;
    },
    async fetch(_entry, ctx) {
      return scanApify(ctx);
    },
  },
};
