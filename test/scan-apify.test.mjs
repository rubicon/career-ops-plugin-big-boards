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
 * Covers: buildPasses' config-driven passes list (settings.passes, the
 * omitted-config single-remote-pass default, and a configured multi-pass
 * list), JD caching (cacheJobDescription), the description -> local-url
 * mapping (toJob), and the end-to-end engine (scanApify): token handling,
 * required titles, per-pass resilience, cross-title dedup, and that no
 * 1Password / raw sockets / global fetch made it into the source.
 */

import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
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
    location_filter: { cities: [], allow_remote: true },
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
  // settings.passes omitted -> a single remote-only pass, geography-agnostic
  const passes = buildPasses({}, 'VP Marketing');
  check(passes.length === 1, 'omitted passes config defaults to exactly one pass');
  check(passes[0].label === 'remote', 'default pass is labeled remote');
  check(passes[0].input.remote_only === true, 'default pass is remote_only');
  check(passes[0].input.location === undefined, 'default pass carries no location');
  check(passes[0].input.distance === undefined, 'default pass carries no distance');
  check(passes[0].input.keyword === 'VP Marketing', 'keyword threaded into the default pass');
  check(passes[0].input.country === 'United States', 'defaults country to United States');
  check(
    Array.isArray(passes[0].input.platforms) && passes[0].input.platforms.includes('LinkedIn'),
    'defaults platforms to the big boards',
  );
}
{
  // an explicit empty passes list is also treated as "no passes configured"
  const passes = buildPasses({ passes: [] }, 'VP Marketing');
  check(
    passes.length === 1 && passes[0].label === 'remote' && passes[0].input.remote_only === true,
    'an empty passes array also falls back to the single remote-only default',
  );
}
{
  // settings.passes is read verbatim: label, location, distance, remote_only
  const passes = buildPasses(
    {
      passes: [
        { label: 'local', location: 'Austin, TX', distance: 25 },
        { label: 'remote', remote_only: true },
      ],
    },
    'Head of Growth',
  );
  check(passes.length === 2, 'a configured two-pass list is honored');
  const local = passes.find((p) => p.label === 'local');
  const remote = passes.find((p) => p.label === 'remote');
  check(!!local && !!remote, 'configured labels are threaded through');
  check(
    local.input.location === 'Austin, TX',
    'configured location is threaded through verbatim, not a hardcoded default',
  );
  check(local.input.distance === 25, 'configured distance is threaded through verbatim');
  check(local.input.remote_only === false, 'a pass without remote_only: true is not remote_only');
  check(remote.input.remote_only === true, 'a pass with remote_only: true is remote_only');
  check(remote.input.location === undefined, 'the remote pass carries no location');
  check(
    local.input.keyword === 'Head of Growth' && remote.input.keyword === 'Head of Growth',
    'keyword threaded into every configured pass',
  );
}
{
  // an arbitrary three-pass list proves the shape isn't hardcoded to a
  // "local + remote" pair
  const passes = buildPasses(
    {
      passes: [
        { label: 'chicago', location: 'Chicago, IL', distance: 50 },
        { label: 'seattle', location: 'Seattle, WA', distance: 30 },
        { label: 'remote', remote_only: true },
      ],
    },
    'CMO',
  );
  check(passes.length === 3, 'a three-entry configured passes list produces three passes');
  check(
    passes.map((p) => p.label).join(',') === 'chicago,seattle,remote',
    'pass order and labels are preserved as configured',
  );
}
{
  // shared settings (country/max_results/posted_since/platforms) still apply
  // to every configured pass, on top of the passes list itself
  const passes = buildPasses(
    {
      country: 'Canada',
      max_results: 10,
      posted_since: '7 days',
      platforms: ['Indeed'],
      passes: [{ label: 'toronto', location: 'Toronto, ON', distance: 40 }],
    },
    'Head of Growth',
  );
  const toronto = passes[0];
  check(toronto.input.country === 'Canada', 'settings.country overrides default');
  check(toronto.input.max_results === 10, 'settings.max_results overrides default');
  check(toronto.input.posted_since === '7 days', 'settings.posted_since overrides default');
  check(
    toronto.input.platforms.length === 1 && toronto.input.platforms[0] === 'Indeed',
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

// ── object-shaped location (actor build 1.0.52) ─────────────────────
// Recorded shapes: test/fixtures/all-jobs-scraper-1.0.52.json. The actor now
// returns location as { raw, locality, region, ... } instead of a string.
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/all-jobs-scraper-1.0.52.json', import.meta.url), 'utf-8'),
);
section('toJob and the JD cache: object-shaped location');
await withTmpCwd(() => {
  const job = toJob(RECORDED.dfwPass[0]);
  check(job.location === 'Dallas, TX', 'toJob returns the raw location text');
  const cached = readFileSync(job.url.replace(/^local:/, ''), 'utf-8');
  check(
    cached.includes('location: "Dallas, TX"'),
    'the cached JD frontmatter carries the raw text',
  );
  check(!cached.includes('[object Object]'), 'the cached JD never contains [object Object]');
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
{
  let called = false;
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: { titles: ['CMO', null] },
    fetchJson: async () => {
      called = true;
      return [];
    },
  };
  await checkRejects(
    () => scanApify(ctx),
    /settings\.titles\[1\] must be a non-empty string/,
    'throws a clear error naming settings.titles when an entry is falsy, instead of silently dropping it',
  );
  check(called === false, 'never calls fetchJson when a titles entry is malformed');
}
{
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: { titles: ['CMO', '   '] },
    fetchJson: async () => [],
  };
  await checkRejects(
    () => scanApify(ctx),
    /settings\.titles\[1\] must be a non-empty string/,
    'whitespace-only titles entries are also rejected',
  );
}

section('scanApify: happy path');
await withTmpCwd(async () => {
  const calls = [];
  const ctx = {
    env: { APIFY_TOKEN: 'secret-token' },
    settings: {
      titles: ['VP Marketing'],
      passes: [
        { label: 'local', location: 'Somewhere, ST', distance: 50 },
        { label: 'remote', remote_only: true },
      ],
      ...permissiveConfig(['VP Marketing']),
    },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts, input: JSON.parse(opts.body) });
      if (calls.length === 1) return [rawJob()]; // local pass
      return []; // remote pass
    },
  };
  const jobs = await scanApify(ctx);

  check(calls.length === 2, 'calls fetchJson once per configured pass (local + remote)');
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

section('scanApify: timeout_ms');
for (const [configured, expected, label] of [
  [undefined, 300000, 'an unset timeout_ms reaches fetchJson as 300000'],
  [90000, 90000, 'a configured timeout_ms overrides the default'],
]) {
  await withTmpCwd(async () => {
    const seen = [];
    const ctx = {
      env: { APIFY_TOKEN: 'tok' },
      settings: {
        titles: ['VP Marketing'],
        passes: [{ label: 'remote', remote_only: true }],
        ...(configured === undefined ? {} : { timeout_ms: configured }),
        ...permissiveConfig(['VP Marketing']),
      },
      fetchJson: async (_url, opts) => {
        seen.push(opts.timeoutMs);
        return [];
      },
    };
    await scanApify(ctx);
    check(seen.length === 1 && seen[0] === expected, label);
  });
}

section('scanApify: empty dataset');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: { titles: ['VP Marketing'], ...permissiveConfig(['VP Marketing']) },
    fetchJson: async () => [], // the default remote-only pass returns nothing
  };
  const jobs = await scanApify(ctx);
  check(Array.isArray(jobs) && jobs.length === 0, 'returns [] when the pass yields no jobs');
  check(!existsSync('jds'), 'no jds/ directory created, and no throw, when nothing was kept');
});

section('scanApify: a recorded pass with object locations');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      passes: [{ label: 'dfw', location: 'Dallas, TX', distance: 75 }],
      title_filter: { positive: ['VP Marketing'], negative: [] },
      location_filter: { cities: ['Dallas', 'Plano', 'Frisco'], allow_remote: true },
      salary_floor: 0,
    },
    fetchJson: async () => RECORDED.dfwPass,
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 5, 'keeps the three city matches and the two remote-flagged jobs');
  check(
    jobs.map((j) => j.location).join('|') ===
      'Dallas, TX|Plano, TX|Frisco, TX 75034|Austin, TX|Denver, CO',
    'each returned job carries its raw location text',
  );
  check(
    jobs.every((j) => typeof j.location === 'string' && !j.location.includes('[object Object]')),
    'every returned job location is a string, never an object',
  );
});

section('scanApify: a pass that returns 0 items is reported');
await withTmpCwd(async () => {
  // freePlanLimitPass is the recorded response of a run that hit the actor's
  // free-plan limit: HTTP 201, run SUCCEEDED, body [].
  const logs = [];
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      passes: [
        { label: 'dfw', location: 'Dallas, TX', distance: 75 },
        { label: 'remote', remote_only: true },
      ],
      ...permissiveConfig(['VP Marketing']),
    },
    log: (msg) => logs.push(msg),
    fetchJson: async () => RECORDED.freePlanLimitPass,
  };
  const jobs = await scanApify(ctx);
  check(Array.isArray(jobs) && jobs.length === 0, 'still returns [] for an all-empty run');
  check(logs.length === 2, 'logs one warning per empty pass');
  check(
    logs[0]?.includes('VP Marketing') && logs[0].includes('[dfw]'),
    'the first warning names the title and the pass',
  );
  check(logs[1]?.includes('[remote]'), 'the second warning names its own pass');
  check(
    logs.length > 0 && logs.every((l) => /returned 0 items/.test(l)),
    'each warning says the pass returned 0 items',
  );
  check(
    logs.length > 0 && logs.every((l) => /free-plan limit/i.test(l)),
    'each warning names the free-plan limit as a known cause',
  );
});
await withTmpCwd(async () => {
  // Negative control: a pass that returns jobs must not warn.
  const logs = [];
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      passes: [
        { label: 'dfw', location: 'Dallas, TX', distance: 75 },
        { label: 'remote', remote_only: true },
      ],
      ...permissiveConfig(['VP Marketing']),
    },
    log: (msg) => logs.push(msg),
    fetchJson: async (url, opts) =>
      JSON.parse(opts.body).remote_only ? RECORDED.freePlanLimitPass : RECORDED.dfwPass,
  };
  await scanApify(ctx);
  check(logs.length === 1, 'warns only for the empty pass, not for the pass that returned jobs');
  check(logs[0]?.includes('[remote]'), 'the warning is for the empty remote pass');
});

section('scanApify: resilience, one failed pass does not abort the run');
await withTmpCwd(async () => {
  const logs = [];
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      passes: [
        { label: 'local', location: 'Somewhere, ST', distance: 50 },
        { label: 'remote', remote_only: true },
      ],
      ...permissiveConfig(['VP Marketing']),
    },
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

section('scanApify: per-title incremental JD caching survives a later abort');
await withTmpCwd(async () => {
  // Title 1 ("VP Marketing") completes fully and its one kept job should be
  // JD-cached to disk as part of processing *that* title. Title 2 ("Head of
  // Marketing") then hits an uncaught, non-Error rejection from fetchJson:
  // the per-pass try/catch in scanApify only guards the network call, so
  // its own `err.message` access throws (err is null) and that TypeError
  // escapes uncaught, aborting the run before scanApify ever reaches its
  // final return. This simulates "interrupted mid-run" without mocking any
  // engine logic -- fetchJson is the same injected seam every other test
  // here uses, and the interruption is a real, unhandled exception that
  // really propagates out of scanApify.
  //
  // If JD caching were still deferred to a trailing `allKept.map(toJob)`
  // (the bug this test guards against), title 1's job would never be
  // written to disk, because the function never reaches that line. Caching
  // per-title, inside the loop, means title 1's JD is already on disk by
  // the time title 2 blows up.
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing', 'Head of Marketing'],
      passes: [
        { label: 'local', location: 'Somewhere, ST', distance: 50 },
        { label: 'remote', remote_only: true },
      ],
      ...permissiveConfig(['VP Marketing', 'Head of Marketing']),
    },
    log: () => {},
    fetchJson: async (url, opts) => {
      const input = JSON.parse(opts.body);
      if (input.keyword === 'VP Marketing') {
        return input.remote_only ? [] : [rawJob()];
      }
      // eslint-disable-next-line no-throw-literal
      throw null; // non-Error rejection: escapes the per-pass try/catch uncaught
    },
  };

  let threw = false;
  try {
    await scanApify(ctx);
  } catch {
    threw = true;
  }
  check(threw, 'the simulated title-2 abort actually propagates out of scanApify');

  const jdsExists = existsSync('jds');
  check(jdsExists, "title 1's JD cache directory exists even though the run aborted on title 2");
  if (jdsExists) {
    const files = readdirSync('jds');
    check(
      files.length === 1,
      "exactly title 1's JD file was written before the abort (per-title incremental caching)",
    );
  }
});

section('scanApify: curation filters are applied');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: {
      titles: ['VP Marketing'],
      title_filter: { positive: ['VP Marketing'], negative: [] },
      location_filter: { cities: [], allow_remote: true },
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

// ── LinkedIn jobs with no remote signal in the remote-only pass (issue #66) ──
// LinkedIn sets neither is_remote nor work_mode. The recorded LinkedIn record
// below (is_remote null, city-only location) is what a remote LinkedIn role
// looks like to the plugin; its values are synthetic.
const UNKNOWN_ARRANGEMENT_NOTE = 'work arrangement unknown';
const LINKEDIN_CITY_ONLY = RECORDED.dfwPass[2];
const dfwSettings = (passes) => ({
  titles: ['VP Marketing'],
  passes,
  title_filter: { positive: ['VP Marketing'], negative: [] },
  location_filter: { cities: ['Dallas', 'Plano', 'Frisco'], allow_remote: true },
  salary_floor: 0,
});

section('toJob: work arrangement unknown');
await withTmpCwd(() => {
  const tagged = toJob({ ...LINKEDIN_CITY_ONLY, work_arrangement_unknown: true });
  check(tagged.note === UNKNOWN_ARRANGEMENT_NOTE, 'a flagged job carries the note');
  check(tagged.location === 'Greater Cleveland', 'the tagged job keeps its location text');
  check(!('note' in toJob(LINKEDIN_CITY_ONLY)), 'an unflagged job carries no note');
  check(!('note' in toJob(rawJob())), 'a remote job carries no note');
});

section('scanApify: remote-only pass keeps and tags LinkedIn jobs with no remote signal');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: dfwSettings([{ label: 'remote', remote_only: true }]),
    fetchJson: async () => [LINKEDIN_CITY_ONLY],
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 1, 'keeps the LinkedIn job the city filter would have dropped');
  check(jobs[0]?.note === UNKNOWN_ARRANGEMENT_NOTE, 'tags it work arrangement unknown');
  check(
    jobs[0]?.location === 'Greater Cleveland',
    'the location text is left as the board gave it',
  );
});

section('scanApify: on-site pass is unchanged');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: dfwSettings([{ label: 'dfw', location: 'Dallas, TX', distance: 75 }]),
    fetchJson: async () => [LINKEDIN_CITY_ONLY],
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 0, 'the same LinkedIn job is still dropped for location');
});

section('scanApify: Indeed and Glassdoor handling is unchanged');
await withTmpCwd(async () => {
  const indeedOnSite = {
    ...RECORDED.dfwPass[3],
    location: { raw: 'Tulsa, OK' },
    company_name: 'Tulsa Indeed Co',
  };
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: dfwSettings([{ label: 'remote', remote_only: true }]),
    fetchJson: async () => [indeedOnSite, RECORDED.dfwPass[5], RECORDED.dfwPass[4]],
  };
  const jobs = await scanApify(ctx);
  check(
    jobs.length === 1 && jobs[0].company === 'Initech Cloud',
    'on-site-flagged Indeed and Glassdoor jobs leaking into the remote-only pass are dropped',
  );
  check(!('note' in jobs[0]), 'the remote-flagged Indeed job carries no note');
});

section('scanApify: jobs that already carry a remote signal are not tagged');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: dfwSettings([{ label: 'remote', remote_only: true }]),
    fetchJson: async () => [
      {
        ...LINKEDIN_CITY_ONLY,
        platform_url: 'https://example.com/linkedin/1004',
        company_name: 'Remote Text Co',
        location: { raw: 'Remote - United States' },
      },
      {
        ...LINKEDIN_CITY_ONLY,
        platform_url: 'https://example.com/linkedin/1005',
        company_name: 'Flagged Co',
        is_remote: true,
      },
    ],
  };
  const jobs = await scanApify(ctx);
  check(jobs.length === 2, 'both remote-signalled LinkedIn jobs are kept');
  check(
    jobs.every((j) => !('note' in j)),
    'neither carries a note',
  );
});

section('scanApify: one LinkedIn posting returned by both passes');
await withTmpCwd(async () => {
  const ctx = {
    env: { APIFY_TOKEN: 'tok' },
    settings: dfwSettings([
      { label: 'dfw', location: 'Dallas, TX', distance: 75 },
      { label: 'remote', remote_only: true },
    ]),
    fetchJson: async () => [LINKEDIN_CITY_ONLY],
  };
  const jobs = await scanApify(ctx);
  check(
    jobs.length === 1 && jobs[0].note === UNKNOWN_ARRANGEMENT_NOTE,
    'is returned once and tagged, instead of being lost to the on-site pass copy',
  );
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
  check(
    !/Dallas|DFW/.test(src),
    'no hardcoded city default remains in the engine (settings.passes is geography-agnostic)',
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
