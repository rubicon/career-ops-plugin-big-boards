#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Test suite for the plugin entry point (index.mjs).
 * Run: node test/index.test.mjs
 *
 * Hermetic: injects a fake ctx.fetchJson instead of calling the live Apify
 * API. No network access, no APIFY_TOKEN required.
 *
 * The host's `provider` hook contract (career-ops-exec, read-only reference:
 * plugins/_types.js line 77, enforced by plugins/_engine.mjs importHook at
 * line 480) is `{ id: string, detect?: (entry) => (url|null), fetch: (entry,
 * ctx) => Promise<object[]> }`, invoked once per portals.yml
 * `tracked_companies` entry that sets `provider: <id>` (scan.mjs's
 * `provider.fetch(company, ctx)`). It is NOT a bare `async provider(ctx)`
 * returning Job[] directly -- that shape fails the host's own validation
 * (`typeof hook.fetch !== 'function'`). These tests assert the actual
 * contract shape, not the shape sketched in issue #2's description.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import plugin from '../index.mjs';

let passed = 0;
let failed = 0;
function check(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}
function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

async function withTmpCwd(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'big-boards-index-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));

const LONG_DESCRIPTION =
  'Reporting to the CEO, this role owns brand, demand generation, and lifecycle ' +
  'marketing across the full funnel, and partners with sales and product to turn ' +
  'strategy into measurable pipeline and revenue growth.';

function rawJob(overrides = {}) {
  return {
    platform_url: 'https://example.com/jobs/1',
    company_name: 'Acme Robotics',
    title: 'VP Marketing',
    location: 'Remote',
    platform: 'LinkedIn',
    is_remote: true,
    salary_minimum: null,
    salary_maximum: null,
    description: LONG_DESCRIPTION,
    ...overrides,
  };
}

// ── shape ────────────────────────────────────────────────────────────
section('provider hook shape (career-ops-exec host contract)');
{
  check(typeof plugin === 'object' && plugin !== null, 'default export is an object of hooks');
  check(Object.keys(plugin).join(',') === 'provider', 'exports exactly the provider hook');
  check(
    manifest.hooks.length === 1 && manifest.hooks[0] === 'provider',
    'manifest declares only the provider hook',
  );

  const provider = plugin.provider;
  check(
    typeof provider === 'object' && provider !== null,
    'provider is an object, not a bare function',
  );
  check(provider.id === manifest.id, 'provider.id matches manifest.id');
  check(typeof provider.detect === 'function', 'provider.detect is a function');
  check(
    provider.detect() === null,
    'provider.detect always returns null (keyed provider, never auto-detects)',
  );
  check(typeof provider.fetch === 'function', 'provider.fetch is a function');
}

// ── delegation to lib/scan-apify.mjs ────────────────────────────────
section('provider.fetch delegates to scanApify(ctx)');
await withTmpCwd(async () => {
  const calls = [];
  const ctx = {
    env: { APIFY_TOKEN: 'secret-token' },
    settings: {
      titles: ['VP Marketing'],
      title_filter: { positive: ['VP Marketing'], negative: [] },
      location_filter: { dfw_cities: [], allow_remote: true },
      salary_floor: 0,
    },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return [rawJob()]; // local pass
      return []; // remote pass
    },
  };

  const entry = { name: 'irrelevant portals.yml entry', provider: 'big-boards' };
  const jobs = await plugin.provider.fetch(entry, ctx);

  check(calls.length === 2, 'fetch() drove the real engine (one call per pass)');
  check(Array.isArray(jobs) && jobs.length === 1, 'fetch() returns the Job[] the engine curated');
  check(jobs[0].title === 'VP Marketing', 'returned job carries the curated title');
  check(
    jobs[0].url.startsWith('local:jds/'),
    'returned job url points at the cached JD, same as calling scanApify directly',
  );
  check(
    existsSync(jobs[0].url.slice('local:'.length)),
    'the JD file the returned url points at actually exists',
  );
});

section('provider.fetch surfaces engine errors (e.g. missing token)');
{
  const ctx = { env: {}, settings: { titles: ['VP Marketing'] }, fetchJson: async () => [] };
  let threw = false;
  try {
    await plugin.provider.fetch({}, ctx);
  } catch (err) {
    threw = /APIFY_TOKEN not set/.test(err.message);
  }
  check(threw, 'a missing APIFY_TOKEN error from scanApify propagates through fetch()');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
