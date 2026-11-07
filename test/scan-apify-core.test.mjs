#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Test suite for the Apify all-jobs-scraper ingestion collector's pure
 * curation logic (lib/scan-apify-core.mjs). Run: node test/scan-apify-core.test.mjs
 *
 * Covers: term matching (word-boundary), title filter (positive/negative
 * override), location filter (configured city list + remote), salary floor, location
 * normalization, dedup keys, slugify, pipeline-line formatting, and the
 * end-to-end curate() over a representative dataset modeled on the real
 * 75-record test run (CMO-in-Dallas keep, Chief MEDICAL Officer drop,
 * door-to-door drop, remote CMO keep, Austin on-site drop, dedup).
 */

import { readFileSync } from 'node:fs';

import {
  matchesTerm,
  titleAllowed,
  jobLocation,
  isRemoteJob,
  locationAllowed,
  salaryAboveFloor,
  normalizeLocation,
  jobKey,
  dedupeJobs,
  slugify,
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

// Empty/unset positive means "no title filtering" (allow all), not "drop
// everything". The actor's cost is already spent at fetch time, so an
// unset title_filter must not throw away every fetched result (#23).
assert(titleAllowed('anything', undefined) === true, 'unset title_filter allows any title');
assert(titleAllowed('x', { positive: [] }) === true, 'empty positive list allows any title');
assert(
  titleAllowed('X', { negative: ['X'] }) === false,
  'empty positive still honors negative filter',
);
assert(titleAllowed('X', { positive: ['X'] }) === true, 'non-empty positive matches');
assert(titleAllowed('Eng', { positive: ['VP'] }) === false, 'non-empty positive rejects non-match');

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

// ── locationAllowed (configured city list + remote) ──────────────────
section('locationAllowed');
const LF = {
  cities: [
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
  'remote-flagged out-of-list kept',
);

// ── location as the actor returns it (build 1.0.52: an object) ───────
// The shapes below are recorded in test/fixtures/all-jobs-scraper-1.0.52.json.
section('jobLocation and object-shaped location');
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/all-jobs-scraper-1.0.52.json', import.meta.url), 'utf-8'),
);
const [dallas, plano, cleveland, frisco, austinRemote, boise, denverRemote] = RECORDED.dfwPass;
assert(
  jobLocation({ location: 'Dallas, TX' }) === 'Dallas, TX',
  'a string location is returned as is',
);
assert(jobLocation(dallas) === 'Dallas, TX', 'an object location yields its raw text');
assert(jobLocation(frisco) === 'Frisco, TX 75034', 'raw text is kept as returned, zip included');
assert(
  jobLocation(cleveland) === 'Greater Cleveland',
  'an object with only locality and raw works',
);
assert(
  jobLocation({ location: { locality: 'Dallas' } }) === '',
  'an object without raw yields empty',
);
assert(jobLocation({ location: null }) === '', 'null location yields empty');
assert(jobLocation({}) === '', 'missing location yields empty');
assert(jobLocation(null) === '', 'null job yields empty');
assert(
  isRemoteJob({ is_remote: false, location: { raw: 'Remote', locality: 'Remote' } }) === true,
  'object location whose raw text says Remote is remote',
);
assert(isRemoteJob(dallas) === false, 'recorded on-site object location is not remote');
assert(isRemoteJob(austinRemote) === true, 'recorded is_remote true object location is remote');
assert(locationAllowed(dallas, LF) === true, 'recorded Dallas object location kept');
assert(locationAllowed(plano, LF) === true, 'recorded Plano object location kept');
assert(locationAllowed(frisco, LF) === true, 'recorded Frisco object location kept');
assert(locationAllowed(cleveland, LF) === false, 'recorded Cleveland on-site dropped');
assert(locationAllowed(boise, LF) === false, 'recorded Boise on-site dropped');
assert(locationAllowed(denverRemote, LF) === true, 'recorded remote out-of-list kept');

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

// ── curate (end-to-end over a representative dataset) ────────────────
section('curate (end-to-end)');
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

{
  // Regression for #23: an unset title_filter (config === {}) must not drop
  // every job. The job still needs to clear the location/salary defaults,
  // so mark it remote (the default location_filter allows remote).
  const job = {
    platform_url: 'u-empty-config',
    company_name: 'AnyCo',
    title: 'Anything At All',
    location: 'Remote',
    is_remote: true,
    salary_minimum: null,
    salary_maximum: null,
  };
  const { kept, dropped } = curate([job], {}, new Set());
  assert(
    kept.length === 1 && kept[0].platform_url === 'u-empty-config',
    'empty config keeps the job instead of dropping it as title',
  );
  assert(
    !dropped.some((d) => d.reason === 'title'),
    'no job is dropped for reason "title" under an empty config',
  );
}

// ── markKeptSeen (incremental cross-title dedup, #17) ─────────────────
section('markKeptSeen (resilient incremental writes)');
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
  // dropped as 'seen' in batch 2 after markKeptSeen. That is the invariant
  // that makes per-title incremental writes safe to resume after an
  // interruption.
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

section('curate over a recorded actor pass (object locations)');
{
  const { kept, dropped } = curate(
    RECORDED.dfwPass,
    {
      title_filter: { positive: ['VP Marketing'], negative: [] },
      location_filter: { cities: ['Dallas', 'Plano', 'Frisco'], allow_remote: true },
      salary_floor: 0,
    },
    new Set(),
  );
  assert(
    kept.map((j) => j.company_name).join(',') ===
      'Acme Robotics,Widgetco,Globex Analytics,Initech Cloud,Hooli Devices',
    'keeps the three city matches and the two remote-flagged jobs',
  );
  assert(
    dropped.length === 2 && dropped.every((d) => d.reason === 'location'),
    'drops the two out-of-list on-site jobs, both for location',
  );
}

// ── remote-only pass: LinkedIn jobs with no remote signal (issue #66) ──
// LinkedIn sets neither is_remote nor work_mode, so a remote role arrives
// with is_remote null and a city in location. Shapes follow the recorded
// LinkedIn records in the fixture above; values are synthetic. The engine
// marks each job that came from a remote_only pass with _remote_only_pass.
// ZipRecruiter rows carry no remote flag either (issue #83).
section('curate: remote-only pass, LinkedIn and ZipRecruiter jobs with no remote signal');
{
  const cfg = {
    title_filter: { positive: ['VP Marketing'], negative: [] },
    location_filter: { cities: ['Dallas', 'Plano', 'Frisco'], allow_remote: true },
    salary_floor: 0,
  };
  const linkedin = (overrides = {}) => ({
    ...RECORDED.dfwPass[2], // LinkedIn, is_remote null, city-only location
    _remote_only_pass: true,
    ...overrides,
  });

  {
    const { kept, dropped } = curate([linkedin()], cfg, new Set());
    assert(
      kept.length === 1 && dropped.length === 0,
      'keeps a remote-pass LinkedIn job the city filter would drop',
    );
    assert(
      kept.length === 1 && kept[0].work_arrangement_unknown === true,
      'tags the kept job as work arrangement unknown',
    );
  }
  {
    const { kept } = curate(
      [linkedin({ platform_url: 'u-dallas', location: { raw: 'Dallas, TX' } })],
      cfg,
      new Set(),
    );
    assert(
      kept.length === 1 && kept[0].work_arrangement_unknown === true,
      'tags a remote-pass LinkedIn job even when the city filter would have kept it',
    );
  }
  {
    const { kept } = curate(
      [linkedin({ platform_url: 'u-remote-text', location: { raw: 'Remote - United States' } })],
      cfg,
      new Set(),
    );
    assert(
      kept.length === 1 && !('work_arrangement_unknown' in kept[0]),
      'does not tag when the location text says remote',
    );
  }
  {
    const { kept } = curate(
      [linkedin({ platform_url: 'u-flagged', is_remote: true })],
      cfg,
      new Set(),
    );
    assert(
      kept.length === 1 && !('work_arrangement_unknown' in kept[0]),
      'does not tag when the actor flagged the job remote',
    );
  }
  {
    const { kept } = curate(
      [linkedin({ platform_url: 'u-lower', platform: 'linkedin' })],
      cfg,
      new Set(),
    );
    assert(
      kept.length === 1 && kept[0].work_arrangement_unknown === true,
      'matches the platform name case-insensitively',
    );
  }
  {
    const { kept, dropped } = curate([linkedin({ _remote_only_pass: undefined })], cfg, new Set());
    assert(
      kept.length === 0 && dropped.length === 1 && dropped[0].reason === 'location',
      'the on-site pass is unchanged: the same LinkedIn job is dropped for location',
    );
  }
  {
    const indeed = {
      ...RECORDED.dfwPass[3], // Indeed, is_remote false, moved out of the city list
      location: { raw: 'Tulsa, OK' },
      _remote_only_pass: true,
    };
    const glassdoor = { ...RECORDED.dfwPass[5], _remote_only_pass: true }; // Glassdoor, is_remote false
    const { kept, dropped } = curate([indeed, glassdoor], cfg, new Set());
    assert(
      kept.length === 0 && dropped.every((d) => d.reason === 'location') && dropped.length === 2,
      'Indeed and Glassdoor on-site-flagged jobs from a remote-only pass are still dropped',
    );
  }
  {
    const indeedRemote = { ...RECORDED.dfwPass[4], _remote_only_pass: true };
    const { kept } = curate([indeedRemote], cfg, new Set());
    assert(
      kept.length === 1 && !('work_arrangement_unknown' in kept[0]),
      'an Indeed job the actor flagged remote is kept untagged',
    );
  }
  {
    // A ZipRecruiter job as lib/boards.mjs maps it: no remote flag, no
    // description, no salary, and a city outside the list.
    const zipRecruiter = {
      title: 'VP Marketing',
      company_name: 'Initech Cloud',
      location: 'Tulsa, OK',
      platform_url: 'https://example.com/ziprecruiter/1',
      platform: 'ZipRecruiter',
      is_remote: null,
      salary_minimum: null,
      salary_maximum: null,
      description: '',
      _remote_only_pass: true,
    };
    const { kept } = curate([zipRecruiter], cfg, new Set());
    assert(
      kept.length === 1 && kept[0].work_arrangement_unknown === true,
      'keeps and tags a remote-pass ZipRecruiter job with no remote flag',
    );
    const flagged = curate([{ ...zipRecruiter, is_remote: false }], cfg, new Set());
    assert(
      flagged.kept.length === 0 && flagged.dropped[0]?.reason === 'location',
      'drops a remote-pass ZipRecruiter job the actor flagged as not remote',
    );
    const onSite = curate([{ ...zipRecruiter, _remote_only_pass: undefined }], cfg, new Set());
    assert(
      onSite.kept.length === 0 && onSite.dropped[0]?.reason === 'location',
      'the on-site pass is unchanged: the same ZipRecruiter job is dropped for location',
    );
  }
  {
    const { dropped } = curate([linkedin({ title: 'Marketing Coordinator' })], cfg, new Set());
    assert(
      dropped.length === 1 && dropped[0].reason === 'title',
      'the title filter still applies to a remote-pass LinkedIn job',
    );
  }
  {
    const { dropped } = curate(
      [linkedin({ salary_minimum: 50000, salary_maximum: 60000 })],
      { ...cfg, salary_floor: 200000 },
      new Set(),
    );
    assert(
      dropped.length === 1 && dropped[0].reason === 'salary',
      'the salary floor still applies to a remote-pass LinkedIn job',
    );
  }
  {
    const seen = new Set(['https://example.com/linkedin/1003']);
    const { dropped } = curate([linkedin()], cfg, seen);
    assert(
      dropped.length === 1 && dropped[0].reason === 'seen',
      'an already-seen remote-pass LinkedIn job is still dropped as seen',
    );
  }
  {
    // The same posting returned by an on-site pass and the remote-only pass
    // is one job after dedup; the remote-only marker must survive it, or the
    // on-site copy's location drop would lose the role.
    const onSiteCopy = { ...RECORDED.dfwPass[2] };
    const remoteCopy = linkedin();
    const { kept } = curate([onSiteCopy, remoteCopy], cfg, new Set());
    assert(
      kept.length === 1 && kept[0].work_arrangement_unknown === true,
      'a posting seen in an on-site pass and the remote-only pass is kept and tagged',
    );
    assert(
      !('_remote_only_pass' in onSiteCopy),
      'dedup does not mutate the job objects it was given',
    );
  }
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
