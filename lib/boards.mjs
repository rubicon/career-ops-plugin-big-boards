// SPDX-License-Identifier: MIT
// @ts-check
/**
 * boards.mjs: one Apify actor per job board.
 *
 * Each BOARDS entry names the actor that scans one board and carries two
 * pure functions. buildInput turns a scan pass (buildPasses in
 * scan-apify.mjs) into that actor's input. mapItem turns one of the actor's
 * dataset items into the raw job shape scan-apify-core.mjs curates: title,
 * company_name, location (always a string), platform_url, platform,
 * is_remote, salary_minimum and salary_maximum (yearly), and description.
 * The engine makes the network call; this module has no side effects.
 *
 * Glassdoor has no entry: no actor tested for issue #83 returned Glassdoor
 * results.
 */

/** Two-letter codes for the country names settings.country accepts. */
const COUNTRY_CODES = {
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  canada: 'CA',
  australia: 'AU',
  ireland: 'IE',
  germany: 'DE',
  france: 'FR',
  netherlands: 'NL',
  spain: 'ES',
  italy: 'IT',
  india: 'IN',
  singapore: 'SG',
  'new zealand': 'NZ',
  mexico: 'MX',
  brazil: 'BR',
  japan: 'JP',
};

/** The two-letter code for settings.country. A two-letter value passes
 *  through uppercased, a listed country name is looked up, and anything
 *  else returns '' so the actor falls back to its own default. scanApify
 *  logs a country this can't map, once per scan. */
export function countryCode(country) {
  const s = String(country || '').trim();
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  return COUNTRY_CODES[s.toLowerCase()] || '';
}

/** The number of days in a posted_since window such as '14 days', '1 week',
 *  '2 months' or '24 hours'. Returns 0 when the window can't be read, which
 *  every board treats as no date filter. */
export function postedSinceDays(postedSince) {
  const m = /^\s*(\d+)\s*(hour|day|week|month)s?\s*$/i.exec(String(postedSince || ''));
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'hour') return n / 24;
  if (unit === 'week') return n * 7;
  if (unit === 'month') return n * 30;
  return n;
}

/** The narrowest of an actor's posted-date options that still covers
 *  posted_since, or undefined (no date filter) when none does. `options` is
 *  a list of [maxDays, value] pairs, narrowest first. */
function dateWindow(postedSince, options) {
  const days = postedSinceDays(postedSince);
  if (days <= 0) return undefined;
  const match = options.find(([maxDays]) => days <= maxDays);
  return match ? match[1] : undefined;
}

const LINKEDIN_WINDOWS = [
  [1, 'past-day'],
  [7, 'past-week'],
  [30, 'past-month'],
];
const INDEED_WINDOWS = [
  [1, 'Last 24 hours'],
  [3, 'Last 3 days'],
  [7, 'Last 7 days'],
  [14, 'Last 14 days'],
];

const SALARY_PERIODS = { YEARLY: 1, MONTHLY: 12, WEEKLY: 52, DAILY: 260, HOURLY: 2080 };

/** A posted pay figure as a yearly amount, or null when there is none.
 *  salary_floor compares yearly numbers, so an hourly, daily, weekly or
 *  monthly figure is scaled first (2080 hours, 260 days, 52 weeks, 12
 *  months). A missing or unknown period returns null rather than a wrong
 *  number: an hourly figure read as yearly would fail any salary_floor. */
export function yearlySalary(amount, period) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = SALARY_PERIODS[String(period || '').toUpperCase()];
  return factor ? Math.round(n * factor) : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const BOARDS = {
  LinkedIn: {
    actor: 'johnvc/linkedin-jobs-api',
    /** Keyword search with an optional location and country. The actor has
     *  no radius input, so pass.distance is not sent. With remote: true it
     *  keeps only jobs whose title, location or description says remote. */
    buildInput(pass) {
      const input = {
        keyword: pass.keyword,
        maxJobs: pass.max_results,
        remote: pass.remote_only === true,
      };
      const country = countryCode(pass.country);
      if (country) input.country = country;
      if (pass.location) input.location = pass.location;
      const timeRange = dateWindow(pass.posted_since, LINKEDIN_WINDOWS);
      if (timeRange) input.timeRange = timeRange;
      return input;
    },
    /** LinkedIn rows carry no salary and no remote flag, which is what
     *  arrangementUnknown in scan-apify-core.mjs expects of LinkedIn. */
    mapItem(item) {
      return {
        title: text(item.title),
        company_name: text(item.companyName),
        location: text(item.location),
        platform_url: text(item.jobUrl),
        platform: 'LinkedIn',
        is_remote: null,
        salary_minimum: null,
        salary_maximum: null,
        description: text(item.description),
      };
    },
  },
  Indeed: {
    actor: 'johnvc/indeed-jobs-api',
    buildInput(pass) {
      const input = {
        mode: 'search',
        keywords: [pass.keyword],
        maxResultsPerInput: pass.max_results,
        remote: pass.remote_only === true ? 'remote' : 'any',
      };
      const country = countryCode(pass.country);
      if (country) input.country = country;
      if (pass.location) input.location = pass.location;
      if (pass.distance !== undefined) input.locationRadiusMiles = pass.distance;
      const datePosted = dateWindow(pass.posted_since, INDEED_WINDOWS);
      if (datePosted) input.datePosted = datePosted;
      return input;
    },
    /** Indeed sets isRemote on hybrid roles too. workModel tells them apart,
     *  and a hybrid role is left to location_filter like an on-site one. */
    mapItem(item) {
      const hybrid = /hybrid/i.test(text(item.workModel));
      return {
        title: text(item.jobTitle),
        company_name: text(item.companyName),
        location: text(item.location) || text(item.jobLocation),
        platform_url: text(item.jobUrl),
        platform: 'Indeed',
        is_remote: item.isRemote === true && !hybrid,
        salary_minimum: yearlySalary(item.salaryMin, item.salaryPeriod),
        salary_maximum: yearlySalary(item.salaryMax, item.salaryPeriod),
        description: text(item.descriptionMarkdown) || text(item.description),
      };
    },
  },
  ZipRecruiter: {
    actor: 'openclawai/job-board-scraper',
    /** ZipRecruiter only, through this multi-board actor. It loads the board
     *  in a real browser, so a run takes one to three minutes. */
    buildInput(pass) {
      const input = {
        searchTerm: pass.keyword,
        sites: ['zip_recruiter'],
        maxResults: pass.max_results,
        isRemote: pass.remote_only === true,
        enforceAnnualSalary: true,
      };
      if (pass.location) input.location = pass.location;
      if (pass.distance !== undefined) input.distance = pass.distance;
      const days = postedSinceDays(pass.posted_since);
      if (days > 0) input.hoursOld = Math.round(days * 24);
      return input;
    },
    /** The ZipRecruiter rows tested for issue #83 carried no description,
     *  salary or remote flag, so a ZipRecruiter job is not cached to jds/
     *  and keeps its board URL (see toJob). With no remote flag, is_remote
     *  is null, as for LinkedIn, and arrangementUnknown in
     *  scan-apify-core.mjs keeps the job in a remote_only pass. The optional
     *  fields are still read in case the actor starts returning them.
     *  enforceAnnualSalary makes any amount yearly.
     *
     *  When ZipRecruiter blocks the run, the actor returns a status row
     *  (__hint, per_site_status, search_term, location, scraped_at) with no
     *  title or job_url. It maps to a job with no title or URL, which
     *  scanApify drops and logs. */
    mapItem(item) {
      return {
        title: text(item.title),
        company_name: text(item.company),
        location: text(item.location),
        platform_url: text(item.job_url),
        platform: 'ZipRecruiter',
        is_remote: typeof item.is_remote === 'boolean' ? item.is_remote : null,
        salary_minimum: yearlySalary(item.min_amount, 'YEARLY'),
        salary_maximum: yearlySalary(item.max_amount, 'YEARLY'),
        description: text(item.description),
      };
    },
  },
};

/** The BOARDS entry for a settings.platforms name, matched
 *  case-insensitively ('linkedin' finds LinkedIn), with its name added.
 *  Returns null when no actor is routed for that board. */
export function boardFor(platform) {
  const wanted = String(platform || '')
    .trim()
    .toLowerCase();
  const name = Object.keys(BOARDS).find((n) => n.toLowerCase() === wanted);
  return name ? { name, ...BOARDS[name] } : null;
}
