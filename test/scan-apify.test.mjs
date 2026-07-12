#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Test suite for the big-boards provider engine (lib/scan-apify.mjs).
 * Run: node test/scan-apify.test.mjs
 *
 * Hermetic: every test injects a fake ctx.fetchJson (the seam the plugin
 * sandbox contract exists for) instead of calling the live Apify API. No
 * network access, no APIFY_TOKEN required. Raw actor job fixtures use the
 * field names verified against career-ops-exec's own ported curation tests
 * and its real scan-history.tsv / jds/*.md artifacts (platform_url,
 * company_name, title, location, platform, is_remote, salary_minimum,
 * salary_maximum, description); company/title values here are synthetic per
 * this repo's "no personal data in the repo" rule.
 *
 * Covers: buildPasses' two-pass shape, JD caching (cacheJobDescription),
 * the description -> local-url mapping (toJob), and the end-to-end engine
 * (scanApify): token handling, required titles, per-pass resilience,
 * cross-title dedup, and that no 1Password / raw sockets / global fetch
 * made it into the source.
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENDPOINT,
  buildPasses,
  cacheJobDescription,
  toJob,
  scanApify,
} from '../lib/scan-apify.mjs';

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

/** Await fn(), expecting it to reject with a message matching `pattern`. */
async function checkRejects(fn, pattern, testName) {
  try {
    await fn();
    check(false, testName);
  } catch (err) {
    check(pattern.test(err.message), testName);
  }
}

/** Run fn with process.cwd() pointed at a fresh temp directory, so
 *  jds/-writing tests never touch this repo's own working tree. Always
 *  awaits fn() before restoring cwd -- an un-awaited async fn would let its
 *  file writes land after cwd (and the temp dir itself) is already gone. */
async function withTmpCwd(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'big-boards-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

// A realistic-length, plainly-worded (non-verbatim) description body -- long
// enough to clear MIN_JD_BODY_CHARS and to exercise the local-JD-cache path.
const LONG_DESCRIPTION =
  'Reporting to the CEO, this role owns brand, demand generation, and lifecycle ' +
  'marketing across the full funnel, and partners with sales and product to turn ' +
  'strategy into measurable pipeline and revenue growth.';

// A permissive curation config -- keeps anything positively title-matched,
// since scan-apify-core.mjs's own filters are already exhaustively covered
// by test/scan-apify-core.test.mjs; these engine tests only need to prove
// the wiring, not re-litigate the filter logic.
function permissiveConfig(titles) {
  return {
    title_filter: { positive: titles, negative: [] },
    location_filter: { dfw_cities: [], allow_remote: true },
    salary_floor: 0,
  };
}

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

// ── buildPasses ──────────────────────────────────────────────────────
section('buildPasses');
{
  const passes = buildPasses({}, 'VP Marketing');
  check(passes.length === 2, 'returns exactly two passes');
  const local = passes.find((p) => p.label === 'local');
  const remote = passes.find((p) => p.label === 'remote');
  check(!!local && !!remote, 'labels are local and remote');
  check(local.input.location === 'Dallas, TX', 'local pass defaults location to Dallas, TX');
  check(local.input.distance === 75, 'local pass defaults distance to 75');
  check(local.input.remote_only === false, 'local pass is not remote_only');
  check(remote.input.remote_only === true, 'remote pass is remote_only');
  check(local.input.keyword === 'VP Marketing', 'keyword threaded into local pass');
  check(remote.input.keyword === 'VP Marketing', 'keyword threaded into remote pass');
  check(
    local.input.country === 'United States' && remote.input.country === 'United States',
    'defaults country to United States',
  );
  check(
    Array.isArray(local.input.platforms) && local.input.platforms.includes('LinkedIn'),
    'defaults platforms to the big boards',
  );
}
{
  const passes = buildPasses(
    {
      location: 'Austin, TX',
      distance: 25,
      country: 'Canada',
      max_results: 10,
      posted_since: '7 days',
      platforms: ['Indeed'],
    },
    'Head of Growth',
  );
  const local = passes.find((p) => p.label === 'local');
  check(local.input.location === 'Austin, TX', 'settings.location overrides default');
  check(local.input.distance === 25, 'settings.distance overrides default');
  check(local.input.country === 'Canada', 'settings.country overrides default');
  check(local.input.max_results === 10, 'settings.max_results overrides default');
  check(local.input.posted_since === '7 days', 'settings.posted_since overrides default');
  check(
    local.input.platforms.length === 1 && local.input.platforms[0] === 'Indeed',
    'settings.platforms overrides default',
  );
}

// ── cacheJobDescription ─────────────────────────────────────────────
section('cacheJobDescription');
await withTmpCwd(() => {
  const short = cacheJobDescription(rawJob({ description: 'too short' }));
  check(short === null, 'short description is not cached');
  check(!existsSync('jds'), 'no jds/ directory created for an uncached job');

  const path1 = cacheJobDescription(rawJob());
  check(
    typeof path1 === 'string' && path1.startsWith('jds/'),
    'long description cached under jds/',
  );
  check(existsSync(path1), 'cached file actually exists on disk');
  const content = readFileSync(path1, 'utf-8');
  check(content.includes('title: "VP Marketing"'), 'frontmatter carries the title');
  check(content.includes('company: "Acme Robotics"'), 'frontmatter carries the company');
  check(content.includes('# VP Marketing - Acme Robotics'), 'body has the heading');
  check(content.includes(LONG_DESCRIPTION), 'body has the description text');

  const path2 = cacheJobDescription(rawJob());
  check(path1 === path2, 're-caching the same job is idempotent (same path, no throw)');

  const otherJob = rawJob({ platform_url: 'https://example.com/jobs/2', company_name: 'Widgetco' });
  const path3 = cacheJobDescription(otherJob);
  check(path3 !== path1, 'a different job gets a different cache path');
});

// ── toJob ─────────────────────────────────────────────────────────────
section('toJob');
await withTmpCwd(() => {
  const job = toJob(rawJob());
  check(job.title === 'VP Marketing', 'title carried through');
  check(job.company === 'Acme Robotics', 'company carried through');
  check(job.location === 'Remote', 'location carried through');
  check(job.url.startsWith('local:jds/'), 'url points at the local JD cache when caching succeeds');
  check(job._remote_url === 'https://example.com/jobs/1', 'original board url kept as _remote_url');

  const uncachedJob = toJob(rawJob({ description: '' }));
  check(
    uncachedJob.url === 'https://example.com/jobs/1',
    'falls back to the remote url when nothing is cached',
  );
  check(!('_remote_url' in uncachedJob), 'no _remote_url field when nothing is cached');
});

// ── scanApify (end-to-end, hermetic) ────────────────────────────────
section('scanApify: token and settings validation');
{
  let called = false;
  const ctx = {
    env: {},
    settings: { titles: ['VP Marketing'] },
    fetchJson: async () => {
      called = true;
      return [];
    },
  };
  await checkRejects(
    () => scanApify(ctx),
    /APIFY_TOKEN not set/,
    'throws when APIFY_TOKEN is missing',
  );
  check(called === false, 'never calls fetchJson before the token check');
}
{
  const ctx = { env: { APIFY_TOKEN: 'tok' }, settings: {}, fetchJson: async () => [] };
  await checkRejects(
    () => scanApify(ctx),
    /settings\.titles is required/,
    'throws when settings.titles is missing',
  );
}

section('scanApify: happy path');
await withTmpCwd(async () => {
  const calls = [];
  const ctx = {
    env: { APIFY_TOKEN: 'secret-token' },
    settings: { titles: ['VP Marketing'], ...permissiveConfig(['VP Marketing']) },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts, input: JSON.parse(opts.body) });
      if (calls.length === 1) return [rawJob()]; // local pass
      return []; // remote pass
    },
  };
  const jobs = await scanApify(ctx);

  check(calls.length === 2, 'calls fetchJson once per pass (local + remote)');
  check(
    calls.every((c) => c.url === ENDPOINT),
    'every call hits the documented sync endpoint',
  );
  check(
    calls.every((c) => c.opts.method === 'POST'),
    'every call is a POST',
  );
  check(
    calls.every((c) => c.opts.headers.authorization === 'Bearer secret-token'),
    'the Apify token is sent as an Authorization header, never a query string',
  );
  check(
    !calls.some((c) => c.url.includes('secret-token')),
    'the token never appears in the request URL',
  );
  check(calls[0].input.remote_only === false, 'first call is the local pass');
  check(calls[1].input.remote_only === true, 'second call is the remote pass');

  check(jobs.length === 1, 'returns exactly one curated job');
  check(jobs[0].title === 'VP Marketing', 'job title carried through end to end');
  check(jobs[0].url.startsWith('local:jds/'), 'job url points at the cached JD end to end');
});

section('scanApify: resilience, one failed pass does not abort the run');
await withTmpCwd(async () => {
  const logs = [];
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: { titles: ['VP Marketing'], ...permissiveConfig(['VP Marketing']) },
    log: (msg) => logs.push(msg),
    fetchJson: async (url, opts) => {
      const input = JSON.parse(opts.body);
      if (input.remote_only) throw new Error('Apify 500: actor timed out');
      return [rawJob()];
    },
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 1, 'still returns the jobs from the pass that succeeded');
  check(
    logs.some((l) => l.includes('remote') && l.includes('actor timed out')),
    'logs the failed pass instead of throwing',
  );
});

section('scanApify: cross-title dedup');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing', 'Head of Marketing'],
      ...permissiveConfig(['VP Marketing', 'Head of Marketing']),
    },
    fetchJson: async () => [rawJob()], // same job surfaces under every pass/title
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 1, 'a role surfaced under two searched titles is returned once');
});

section('scanApify: curation filters are applied');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      title_filter: { positive: ['VP Marketing'], negative: [] },
      location_filter: { dfw_cities: [], allow_remote: true },
      salary_floor: 0,
    },
    fetchJson: async () => [
      rawJob(),
      rawJob({ platform_url: 'https://example.com/jobs/3', title: 'Marketing Coordinator' }),
    ],
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 1, 'non-matching titles are curated out before being cached/returned');
  check(jobs[0].title === 'VP Marketing', 'the matching job is the one that survives');
});

// ── Non-negotiable invariants (static source checks) ────────────────
section('source invariants');
{
  const here = fileURLToPath(new URL('.', import.meta.url));
  const src = readFileSync(join(here, '..', 'lib', 'scan-apify.mjs'), 'utf-8');
  check(!/op read|op:\/\/|token_op_ref/.test(src), 'no 1Password reference in the engine source');
  check(!/from ['"]node:http['"]|from ['"]node:net['"]/.test(src), 'no raw socket imports');
  const bareFetchCalls = (src.match(/[^.\w]fetch\(/g) || []).filter(
    (m) => !m.includes('ctx.fetch'),
  );
  check(bareFetchCalls.length === 0, 'no global fetch() call in the source');
  check(src.includes('ctx.fetchJson('), 'egress goes through ctx.fetchJson');
  check(
    ENDPOINT === 'https://api.apify.com/v2/acts/agentx~all-jobs-scraper/run-sync-get-dataset-items',
    'the documented sync-get-dataset-items endpoint is the one actually used',
  );
  check(
    src.includes('ctx.env.APIFY_TOKEN') ||
      /ctx\s*&&\s*ctx\.env\s*&&\s*ctx\.env\.APIFY_TOKEN/.test(src),
    'token is read from ctx.env.APIFY_TOKEN only',
  );
}

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} tests passed!`);
}
