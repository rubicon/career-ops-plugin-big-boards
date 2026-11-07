#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Test suite for the per-board actor routes (lib/boards.mjs).
 * Run: node test/boards.test.mjs
 *
 * Pure: no network, no APIFY_TOKEN. Item fixtures use the field names each
 * actor returned for issue #83; every company, title, URL and description
 * here is synthetic, per this repo's "no personal data in the repo" rule.
 *
 * Covers: countryCode, postedSinceDays, yearlySalary, boardFor, and each
 * board's buildInput and mapItem.
 */

import { BOARDS, boardFor, countryCode, postedSinceDays, yearlySalary } from '../lib/boards.mjs';

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

const RAW_JOB_KEYS = [
  'title',
  'company_name',
  'location',
  'platform_url',
  'platform',
  'is_remote',
  'salary_minimum',
  'salary_maximum',
  'description',
].join(',');

// A pass as buildPasses in lib/scan-apify.mjs builds it.
function pass(overrides = {}) {
  return {
    keyword: 'VP Marketing',
    country: 'United States',
    max_results: 25,
    posted_since: '14 days',
    platforms: ['LinkedIn', 'Indeed', 'ZipRecruiter'],
    remote_only: false,
    location: 'Austin, TX',
    distance: 25,
    ...overrides,
  };
}
const REMOTE_PASS = {
  keyword: 'VP Marketing',
  country: 'United States',
  max_results: 10,
  posted_since: '7 days',
  platforms: ['LinkedIn', 'Indeed', 'ZipRecruiter'],
  remote_only: true,
};

const DESCRIPTION =
  'Owns brand, demand generation and lifecycle marketing, and partners with sales ' +
  'and product to turn strategy into measurable pipeline.';

// ── countryCode ──────────────────────────────────────────────────────
section('countryCode');
check(countryCode('United States') === 'US', 'maps the default country name to US');
check(countryCode('canada') === 'CA', 'matches a country name case-insensitively');
check(countryCode('gb') === 'GB', 'passes a two-letter code through uppercased');
check(countryCode('Atlantis') === '', 'returns an empty string for an unknown name');
check(countryCode(undefined) === '', 'returns an empty string when unset');

// ── postedSinceDays ──────────────────────────────────────────────────
section('postedSinceDays');
check(postedSinceDays('14 days') === 14, "reads '14 days'");
check(postedSinceDays('1 week') === 7, "reads '1 week'");
check(postedSinceDays('24 hours') === 1, "reads '24 hours'");
check(postedSinceDays('2 months') === 60, "reads '2 months'");
check(postedSinceDays('recently') === 0, 'returns 0 for a window it cannot read');
check(postedSinceDays(undefined) === 0, 'returns 0 when unset');

// ── yearlySalary ─────────────────────────────────────────────────────
section('yearlySalary');
check(yearlySalary(150000, 'YEARLY') === 150000, 'keeps a yearly figure');
check(yearlySalary(50, 'HOURLY') === 104000, 'scales an hourly figure by 2080 hours');
check(yearlySalary(10000, 'monthly') === 120000, 'scales a monthly figure, any case');
check(yearlySalary(150000) === null, 'returns null when no period is posted');
check(yearlySalary(90, '') === null, 'returns null for an empty period');
check(yearlySalary(null, 'YEARLY') === null, 'returns null when no amount is posted');
check(yearlySalary(0, 'YEARLY') === null, 'returns null for a zero amount');
check(yearlySalary('n/a', 'YEARLY') === null, 'returns null for a non-numeric amount');
check(yearlySalary(100, 'FORTNIGHTLY') === null, 'returns null for an unknown period');

// ── boardFor ─────────────────────────────────────────────────────────
section('boardFor');
check(boardFor('linkedin')?.name === 'LinkedIn', 'matches a board name case-insensitively');
check(boardFor('LinkedIn')?.actor === 'johnvc/linkedin-jobs-api', 'LinkedIn routes to its actor');
check(boardFor('Indeed')?.actor === 'johnvc/indeed-jobs-api', 'Indeed routes to its actor');
check(
  boardFor('ZipRecruiter')?.actor === 'openclawai/job-board-scraper',
  'ZipRecruiter routes to its actor',
);
check(boardFor('Glassdoor') === null, 'Glassdoor has no routed actor');
check(
  !Object.values(BOARDS).some((b) => b.actor.includes('agentx')),
  'no board routes to agentx/all-jobs-scraper',
);

// ── LinkedIn ─────────────────────────────────────────────────────────
section('LinkedIn buildInput');
{
  const input = BOARDS.LinkedIn.buildInput(pass());
  check(input.keyword === 'VP Marketing', 'sends the title as keyword');
  check(input.maxJobs === 25, 'sends max_results as maxJobs');
  check(input.remote === false, 'an on-site pass is not remote');
  check(input.country === 'US', 'sends the country as a two-letter code');
  check(input.location === 'Austin, TX', 'sends the pass location');
  check(!('distance' in input), 'sends no distance, which the actor does not take');
  check(input.timeRange === 'past-month', "covers '14 days' with past-month");
}
{
  const input = BOARDS.LinkedIn.buildInput(REMOTE_PASS);
  check(input.remote === true, 'a remote-only pass asks for remote jobs');
  check(!('location' in input), 'a pass without a location sends none');
  check(input.timeRange === 'past-week', "covers '7 days' with past-week");
  check(input.maxJobs === 10, 'carries a configured max_results');
}
check(
  !('timeRange' in BOARDS.LinkedIn.buildInput(pass({ posted_since: '45 days' }))),
  'sends no date filter for a window longer than a month',
);
check(
  !('country' in BOARDS.LinkedIn.buildInput(pass({ country: 'Atlantis' }))),
  'leaves country unset when it cannot be mapped',
);

section('LinkedIn mapItem');
{
  const job = BOARDS.LinkedIn.mapItem({
    title: 'VP Marketing',
    companyName: 'Acme Robotics',
    location: 'Austin, TX',
    jobUrl: 'https://example.com/linkedin/1',
    description: DESCRIPTION,
    employmentType: 'Full-time',
  });
  check(Object.keys(job).join(',') === RAW_JOB_KEYS, 'returns the raw job shape');
  check(job.title === 'VP Marketing', 'maps title');
  check(job.company_name === 'Acme Robotics', 'maps companyName to company_name');
  check(job.location === 'Austin, TX', 'keeps the location string');
  check(job.platform_url === 'https://example.com/linkedin/1', 'maps jobUrl to platform_url');
  check(job.platform === 'LinkedIn', 'sets platform to LinkedIn');
  check(job.is_remote === null, 'sets no remote flag, as LinkedIn gives none');
  check(job.salary_minimum === null && job.salary_maximum === null, 'sets no salary');
  check(job.description === DESCRIPTION, 'maps description');
}
{
  const job = BOARDS.LinkedIn.mapItem({});
  check(
    job.title === '' && job.location === '' && job.description === '',
    'missing fields become empty strings',
  );
}

// ── Indeed ───────────────────────────────────────────────────────────
section('Indeed buildInput');
{
  const input = BOARDS.Indeed.buildInput(pass());
  check(input.mode === 'search', 'runs a search');
  check(
    Array.isArray(input.keywords) && input.keywords.join() === 'VP Marketing',
    'sends the title as its one keyword',
  );
  check(input.maxResultsPerInput === 25, 'sends max_results as maxResultsPerInput');
  check(input.remote === 'any', 'an on-site pass takes any work arrangement');
  check(input.country === 'US', 'sends the country as a two-letter code');
  check(input.location === 'Austin, TX', 'sends the pass location');
  check(input.locationRadiusMiles === 25, 'sends distance as locationRadiusMiles');
  check(input.datePosted === 'Last 14 days', "covers '14 days' with Last 14 days");
}
{
  const input = BOARDS.Indeed.buildInput(REMOTE_PASS);
  check(input.remote === 'remote', 'a remote-only pass asks for remote jobs');
  check(!('location' in input), 'a pass without a location sends none');
  check(!('locationRadiusMiles' in input), 'a pass without a distance sends no radius');
  check(input.datePosted === 'Last 7 days', "covers '7 days' with Last 7 days");
}
check(
  BOARDS.Indeed.buildInput(pass({ posted_since: '2 days' })).datePosted === 'Last 3 days',
  "covers '2 days' with the next wider window, Last 3 days",
);
check(
  !('datePosted' in BOARDS.Indeed.buildInput(pass({ posted_since: '30 days' }))),
  'sends no date filter for a window longer than 14 days',
);

section('Indeed mapItem');
{
  const job = BOARDS.Indeed.mapItem({
    jobTitle: 'VP Marketing',
    companyName: 'Globex Analytics',
    location: 'Frisco, TX 75034',
    jobUrl: 'https://example.com/indeed/1',
    isRemote: false,
    salaryMin: 190000,
    salaryMax: 240000,
    salaryPeriod: 'YEARLY',
    descriptionMarkdown: DESCRIPTION,
  });
  check(Object.keys(job).join(',') === RAW_JOB_KEYS, 'returns the raw job shape');
  check(job.title === 'VP Marketing', 'maps jobTitle to title');
  check(job.company_name === 'Globex Analytics', 'maps companyName to company_name');
  check(job.location === 'Frisco, TX 75034', 'keeps the location string');
  check(job.platform_url === 'https://example.com/indeed/1', 'maps jobUrl to platform_url');
  check(job.platform === 'Indeed', 'sets platform to Indeed');
  check(job.is_remote === false, 'maps isRemote');
  check(job.salary_minimum === 190000 && job.salary_maximum === 240000, 'maps a yearly salary');
  check(job.description === DESCRIPTION, 'maps descriptionMarkdown to description');
}
{
  const job = BOARDS.Indeed.mapItem({
    jobTitle: 'VP Marketing',
    jobLocation: 'Remote',
    isRemote: true,
    salaryMin: 90,
    salaryMax: 110,
    salaryPeriod: 'HOURLY',
  });
  check(job.location === 'Remote', 'falls back to jobLocation when location is empty');
  check(job.is_remote === true, 'a remote role is remote');
  check(
    job.salary_minimum === 187200 && job.salary_maximum === 228800,
    'scales an hourly salary to yearly for salary_floor',
  );
}
check(
  BOARDS.Indeed.mapItem({ isRemote: true, workModel: 'Hybrid work' }).is_remote === false,
  'a hybrid role is not treated as remote',
);
{
  // An hourly figure with no period must not read as $90 a year, which any
  // salary_floor would drop.
  const job = BOARDS.Indeed.mapItem({ jobTitle: 'VP Marketing', salaryMin: 90, salaryMax: 110 });
  check(
    job.salary_minimum === null && job.salary_maximum === null,
    'a salary with no period is left unset',
  );
}

// ── ZipRecruiter ─────────────────────────────────────────────────────
section('ZipRecruiter buildInput');
{
  const input = BOARDS.ZipRecruiter.buildInput(pass());
  check(input.searchTerm === 'VP Marketing', 'sends the title as searchTerm');
  check(
    Array.isArray(input.sites) && input.sites.join() === 'zip_recruiter',
    'scans ZipRecruiter only',
  );
  check(input.maxResults === 25, 'sends max_results as maxResults');
  check(input.isRemote === false, 'an on-site pass is not remote');
  check(input.enforceAnnualSalary === true, 'asks for yearly salary figures');
  check(input.location === 'Austin, TX', 'sends the pass location');
  check(input.distance === 25, 'sends the pass distance');
  check(input.hoursOld === 336, "sends '14 days' as 336 hours");
}
{
  const input = BOARDS.ZipRecruiter.buildInput(REMOTE_PASS);
  check(input.isRemote === true, 'a remote-only pass asks for remote jobs');
  check(!('location' in input) && !('distance' in input), 'sends no location or distance');
  check(input.hoursOld === 168, "sends '7 days' as 168 hours");
}
check(
  !('hoursOld' in BOARDS.ZipRecruiter.buildInput(pass({ posted_since: 'recently' }))),
  'sends no date filter for a window it cannot read',
);

section('ZipRecruiter mapItem');
{
  // The fields the actor returned for a ZipRecruiter row: no description,
  // salary or remote flag.
  const job = BOARDS.ZipRecruiter.mapItem({
    title: 'VP Marketing',
    company: 'Initech Cloud',
    location: 'Plano, TX',
    job_url: 'https://example.com/ziprecruiter/1',
    site: 'zip_recruiter',
  });
  check(Object.keys(job).join(',') === RAW_JOB_KEYS, 'returns the raw job shape');
  check(job.company_name === 'Initech Cloud', 'maps company to company_name');
  check(job.location === 'Plano, TX', 'keeps the location string');
  check(job.platform_url === 'https://example.com/ziprecruiter/1', 'maps job_url to platform_url');
  check(job.platform === 'ZipRecruiter', 'sets platform to ZipRecruiter');
  check(job.is_remote === null, 'no remote flag means is_remote null, as for LinkedIn');
  check(job.salary_minimum === null && job.salary_maximum === null, 'no salary means null');
  check(job.description === '', 'no description means an empty one');
}
{
  const job = BOARDS.ZipRecruiter.mapItem({
    title: 'VP Marketing',
    is_remote: true,
    min_amount: 180000,
    max_amount: 220000,
    description: DESCRIPTION,
  });
  check(job.is_remote === true, 'maps is_remote when present');
  check(job.salary_minimum === 180000 && job.salary_maximum === 220000, 'maps a salary');
  check(job.description === DESCRIPTION, 'maps a description when present');
}
check(
  BOARDS.ZipRecruiter.mapItem({ title: 'VP Marketing', is_remote: false }).is_remote === false,
  'keeps an is_remote of false when the actor sends one',
);
{
  // The status row the actor returns when ZipRecruiter's anti-bot check
  // blocks the run. Values are synthetic.
  const job = BOARDS.ZipRecruiter.mapItem({
    __hint: 'ZipRecruiter blocked the request',
    per_site_status: { zip_recruiter: 'blocked' },
    search_term: 'VP Marketing',
    location: 'Dallas, TX',
    scraped_at: '2026-10-27T00:00:00Z',
  });
  check(
    job.title === '' && job.platform_url === '',
    'a status row maps to a job with no title or URL, which the engine drops',
  );
}

// ── Every board ──────────────────────────────────────────────────────
section('every board');
for (const [name, board] of Object.entries(BOARDS)) {
  const job = board.mapItem({ location: { raw: 'Dallas, TX' } });
  check(typeof job.location === 'string', `${name} never returns a non-string location`);
  const input = board.buildInput(pass());
  check(JSON.stringify(input) !== '{}', `${name} builds a non-empty input`);
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
