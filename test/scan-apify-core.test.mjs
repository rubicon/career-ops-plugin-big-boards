#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Test suite for the Apify all-jobs-scraper ingestion collector's pure
 * curation logic (lib/scan-apify-core.mjs). Run: node test/scan-apify-core.test.mjs
 *
 * Covers: term matching (word-boundary), title filter (positive/negative
 * override), location filter (DFW metro + remote), salary floor, location
 * normalization, dedup keys, slugify, pipeline-line formatting, and the
 * end-to-end curate() over a representative dataset modeled on the real
 * 75-record test run (CMO-in-Dallas keep, Chief MEDICAL Officer drop,
 * door-to-door drop, remote CMO keep, Austin on-site drop, dedup).
 */

import {
  matchesTerm,
  titleAllowed,
  isRemoteJob,
  locationAllowed,
  salaryAboveFloor,
  normalizeLocation,
  jobKey,
  dedupeJobs,
  slugify,
  toPipelineLine,
  curate,
  markKeptSeen,
} from '../lib/scan-apify-core.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
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

// ── matchesTerm (case-insensitive, word-boundary) ────────────────────
section('matchesTerm');
assert(matchesTerm('Chief Marketing Officer (CMO)', 'CMO') === true, 'CMO matches inside (CMO)');
assert(
  matchesTerm('Chief Medical Officer (CMO)', 'Chief Medical Officer') === true,
  'phrase matches',
);
assert(matchesTerm('Marketing Manager', 'Manager') === true, 'Manager whole-word match');
assert(
  matchesTerm('Marketing Management', 'Manager') === false,
  'Manager does NOT match Management',
);
assert(
  matchesTerm('VP of Marketing', 'VP Marketing') === false,
  'VP Marketing != VP of Marketing (no false sub-match)',
);
assert(
  matchesTerm('Door to Door Lead Generation', 'Door to Door') === true,
  'multi-word phrase match',
);
assert(matchesTerm('director of marketing', 'CMO') === false, 'no spurious match');

// ── titleAllowed (>=1 positive AND 0 negatives; negative overrides) ──
section('titleAllowed');
const TF = {
  positive: [
    'CMO',
    'Chief Marketing Officer',
    'VP Marketing',
    'VP of Marketing',
    'Head of Marketing',
    'VP Growth',
    'VP Demand Generation',
  ],
  negative: [
    'Chief Medical Officer',
    'Talent Sourcer',
    'Door to Door',
    'Manager',
    'Recruiter',
    'Representative',
    'Coordinator',
  ],
};
assert(titleAllowed('Chief Marketing Officer', TF) === true, 'CMO title allowed');
assert(titleAllowed('Chief Marketing Officer (CMO)', TF) === true, 'CMO with abbrev allowed');
assert(
  titleAllowed('Chief Medical Officer (CMO)', TF) === false,
  'Chief Medical Officer rejected (negative overrides positive CMO)',
);
assert(
  titleAllowed('Marketing Manager', TF) === false,
  'Marketing Manager rejected (no positive + negative)',
);
assert(
  titleAllowed('Director of Marketing', TF) === false,
  'Director of Marketing rejected (no positive matches)',
);
assert(titleAllowed('Door to Door Lead Generation', TF) === false, 'door-to-door rejected');
assert(titleAllowed('VP of Marketing', TF) === true, 'VP of Marketing allowed');

// ── isRemoteJob ──────────────────────────────────────────────────────
section('isRemoteJob');
assert(
  isRemoteJob({ is_remote: true, location: 'San Francisco, CA' }) === true,
  'is_remote flag true',
);
assert(isRemoteJob({ is_remote: false, location: 'Remote' }) === true, 'location says Remote');
assert(
  isRemoteJob({ is_remote: false, location: 'Dallas, TX' }) === false,
  'on-site Dallas not remote',
);

// ── locationAllowed (DFW metro cities + remote) ──────────────────────
section('locationAllowed');
const LF = {
  dfw_cities: [
    'Dallas',
    'Fort Worth',
    'Plano',
    'Irving',
    'McKinney',
    'Frisco',
    'Arlington',
    'Richardson',
    'North Richland Hills',
  ],
  allow_remote: true,
};
assert(
  locationAllowed({ location: 'Dallas, TX 75201', is_remote: false }, LF) === true,
  'Dallas kept',
);
assert(
  locationAllowed({ location: 'Plano, TX', is_remote: false }, LF) === true,
  'Plano suburb kept',
);
assert(
  locationAllowed({ location: 'North Richland Hills, TX 76180', is_remote: false }, LF) === true,
  'NRH suburb kept',
);
assert(
  locationAllowed({ location: 'Austin, TX', is_remote: false }, LF) === false,
  'Austin on-site dropped',
);
assert(
  locationAllowed({ location: 'Oklahoma City, OK', is_remote: false }, LF) === false,
  'OKC dropped',
);
assert(locationAllowed({ location: 'Remote', is_remote: true }, LF) === true, 'remote kept');
assert(
  locationAllowed({ location: 'San Francisco, CA', is_remote: true }, LF) === true,
  'remote-flagged non-DFW kept',
);

// ── salaryAboveFloor (conservative: keep when no salary posted) ──────
section('salaryAboveFloor');
assert(
  salaryAboveFloor({ salary_minimum: 200000, salary_maximum: 215000 }, 180000) === true,
  'in-range salary kept',
);
assert(
  salaryAboveFloor({ salary_minimum: 68664, salary_maximum: 82692 }, 180000) === false,
  'below-floor salary dropped',
);
assert(
  salaryAboveFloor({ salary_minimum: null, salary_maximum: null }, 180000) === true,
  'no salary → kept (conservative)',
);
assert(
  salaryAboveFloor({ salary_minimum: 0, salary_maximum: 0 }, 180000) === true,
  'zero salary treated as no-data → kept',
);
assert(
  salaryAboveFloor({ salary_minimum: 150000, salary_maximum: 250000 }, 180000) === true,
  'range straddling floor kept',
);

// ── normalizeLocation (strip zip) ───────────────────────────────────
section('normalizeLocation');
assert(normalizeLocation('Dallas, TX 75201') === 'Dallas, TX', 'strips 5-digit zip');
assert(normalizeLocation('Plano, TX') === 'Plano, TX', 'no zip unchanged');
assert(normalizeLocation('  Remote  ') === 'Remote', 'trims whitespace');

// ── jobKey + dedupeJobs ─────────────────────────────────────────────
section('jobKey + dedupeJobs');
const a = { company_name: 'PopStroke', title: 'Director of Social Media', location: 'Plano, TX' };
const b = {
  company_name: 'popstroke',
  title: 'Director of Social Media',
  location: 'Plano, TX 75024',
};
assert(jobKey(a) === jobKey(b), 'same company+title different zip → same key');
const deduped = dedupeJobs([
  a,
  b,
  { company_name: 'Qualitest', title: 'CMO', location: 'Dallas, TX' },
]);
assert(deduped.length === 2, 'dedupes the PopStroke pair to one');

// ── slugify ─────────────────────────────────────────────────────────
section('slugify');
assert(
  slugify('TruStage Chief Marketing & Digital Officer') ===
    'trustage-chief-marketing-digital-officer',
  'slugifies with & and spaces',
);
assert(slugify('CodePath.org') === 'codepath-org', 'slugifies a dot');

// ── toPipelineLine ──────────────────────────────────────────────────
section('toPipelineLine');
{
  const line = toPipelineLine({
    platform_url: 'https://x.co/j/1',
    company_name: 'Qualitest',
    title: 'Chief Marketing Officer',
  });
  assert(
    line === '- [ ] https://x.co/j/1 | Qualitest | Chief Marketing Officer',
    'pipeline checkbox line format',
  );
}

// ── curate (end-to-end over a representative dataset) ────────────────
section('curate — end-to-end');
const CONFIG = {
  title_filter: TF,
  location_filter: LF,
  salary_floor: 180000,
};
const sample = [
  {
    platform_url: 'u1',
    company_name: 'Qualitest',
    title: 'Chief Marketing Officer (CMO)',
    location: 'Dallas, TX 75201',
    is_remote: false,
    salary_minimum: 200000,
    salary_maximum: 215000,
  },
  {
    platform_url: 'u2',
    company_name: 'CodePath',
    title: 'Chief Marketing Officer',
    location: 'Remote',
    is_remote: true,
    salary_minimum: 240000,
    salary_maximum: 350000,
  },
  {
    platform_url: 'u3',
    company_name: 'Quality of Life Health',
    title: 'Chief Medical Officer (CMO)',
    location: 'Gadsden, AL',
    is_remote: false,
    salary_minimum: null,
    salary_maximum: null,
  },
  {
    platform_url: 'u4',
    company_name: 'SomeCo',
    title: 'Door to Door Lead Generation',
    location: 'Macedonia, OH',
    is_remote: false,
    salary_minimum: null,
    salary_maximum: null,
  },
  {
    platform_url: 'u5',
    company_name: 'BigCo',
    title: 'VP Marketing',
    location: 'Austin, TX',
    is_remote: false,
    salary_minimum: null,
    salary_maximum: null,
  },
  {
    platform_url: 'u6',
    company_name: 'Noble Elk Farm',
    title: 'Chief Marketing Officer',
    location: 'Remote',
    is_remote: true,
    salary_minimum: 68664,
    salary_maximum: 82692,
  },
  {
    platform_url: 'u1',
    company_name: 'Qualitest',
    title: 'Chief Marketing Officer (CMO)',
    location: 'Dallas, TX 75240',
    is_remote: false,
    salary_minimum: 200000,
    salary_maximum: 215000,
  }, // dup of u1
];
{
  const { kept } = curate(sample, CONFIG, new Set());
  const keptUrls = kept.map((j) => j.platform_url).sort();
  assert(kept.length === 2, `keeps exactly 2 (got ${kept.length}: ${keptUrls.join(',')})`);
  assert(keptUrls.join(',') === 'u1,u2', 'keeps Qualitest (Dallas) and CodePath (remote)');
}
{
  // scan-history dedup: u2 already seen → only u1 kept
  const { kept } = curate(sample, CONFIG, new Set(['u2']));
  assert(
    kept.length === 1 && kept[0].platform_url === 'u1',
    'drops already-seen url2 via scan-history',
  );
}

// ── markKeptSeen — incremental cross-title dedup (#17) ──────────────
section('markKeptSeen — resilient incremental writes');
{
  const seen = new Set();
  markKeptSeen(seen, [{ platform_url: 'a' }, { platform_url: 'b' }]);
  assert(seen.has('a') && seen.has('b'), 'marks kept platform_urls as seen');
  assert(seen.size === 2, 'adds exactly the kept urls');
  markKeptSeen(seen, [{ platform_url: 'a' }]);
  assert(seen.size === 2, 're-marking an existing url is a no-op');
}
{
  // A role appearing under two titles must be written once: kept in batch 1,
  // dropped as 'seen' in batch 2 after markKeptSeen — the invariant that makes
  // per-title incremental writes safe to resume after an interruption.
  const cfg2 = { title_filter: TF, location_filter: LF, salary_floor: 180000 };
  const role = {
    platform_url: 'dup1',
    company_name: 'Qualitest',
    title: 'Chief Marketing Officer (CMO)',
    location: 'Dallas, TX',
    is_remote: false,
    salary_minimum: 200000,
    salary_maximum: 215000,
  };
  const seen = new Set();
  const b1 = curate([role], cfg2, seen);
  markKeptSeen(seen, b1.kept);
  const b2 = curate([role], cfg2, seen);
  assert(b1.kept.length === 1, 'batch 1 keeps the role');
  assert(
    b2.kept.length === 0 && b2.dropped[0]?.reason === 'seen',
    'batch 2 drops the cross-title duplicate as seen',
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
