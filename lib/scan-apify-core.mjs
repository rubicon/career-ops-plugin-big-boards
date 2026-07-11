// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Pure curation logic for the Apify all-jobs-scraper ingestion collector.
 *
 * The actor (agentx/all-jobs-scraper) is a strong firehose but an unreliable
 * filter — per its own Issues tab, location / freshness / keyword relevance
 * all leak. So ALL curation lives here, against portals.yml config, and is
 * unit-tested (see test/scan-apify-core.test.mjs). The engine handles the
 * network call and file I/O; this module stays pure and side-effect-free.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Case-insensitive, word-boundary match. "CMO" matches "(CMO)"; "Manager"
 *  does NOT match "Management"; "VP Marketing" does NOT match "VP of Marketing". */
export function matchesTerm(text, term) {
  if (!text || !term) return false;
  const escaped = String(term)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(text));
}

/** A title passes when it matches >=1 positive AND 0 negatives.
 *  Negatives override positives (e.g. "Chief Medical Officer (CMO)" is
 *  rejected even though it matches the positive "CMO"). */
export function titleAllowed(title, tf) {
  const positive = (tf && tf.positive) || [];
  const negative = (tf && tf.negative) || [];
  if (negative.some((t) => matchesTerm(title, t))) return false;
  return positive.some((t) => matchesTerm(title, t));
}

/** Remote if the actor flagged it OR the location string says "remote". */
export function isRemoteJob(job) {
  if (!job) return false;
  if (job.is_remote === true) return true;
  return /\bremote\b/i.test(String(job.location || ''));
}

/** Keep DFW-metro (city list, incl. suburbs) plus remote; drop on-site
 *  elsewhere. The actor's own location filter is unreliable, so this is the
 *  authoritative gate. */
export function locationAllowed(job, lf) {
  const allowRemote = lf ? lf.allow_remote !== false : true;
  if (allowRemote && isRemoteJob(job)) return true;
  const cities = (lf && lf.dfw_cities) || [];
  const loc = String((job && job.location) || '');
  return cities.some((c) => matchesTerm(loc, c));
}

/** Conservative: keep when no salary is posted (both null/0). Drop only when
 *  a real salary is present and its top of range is below the floor. */
export function salaryAboveFloor(job, floor) {
  if (!floor || floor <= 0) return true;
  const min = toNum(job && job.salary_minimum);
  const max = toNum(job && job.salary_maximum);
  if (!min && !max) return true;
  return Math.max(min, max) >= floor;
}

/** Strip a trailing US zip ("Dallas, TX 75201" -> "Dallas, TX") and trim. */
export function normalizeLocation(loc) {
  return String(loc || '')
    .replace(/\s+\d{5}(-\d{4})?\b/, '')
    .trim();
}

/** Dedup key: company + normalized title, case- and zip-insensitive. */
export function jobKey(job) {
  const company = String((job && job.company_name) || '')
    .trim()
    .toLowerCase();
  const title = String((job && job.title) || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `${company}|${title}`;
}

/** Add the kept jobs' platform_urls to the seen-set, so subsequent per-title
 *  batches in the same run dedup against roles already written. This is what
 *  makes per-title incremental writes safe and resumable (issue #17): a role
 *  surfaced under two titles is written once, and a re-run after an
 *  interruption skips everything already persisted to scan-history. */
export function markKeptSeen(seen, kept) {
  for (const j of kept || []) {
    if (j && j.platform_url) seen.add(j.platform_url);
  }
  return seen;
}

/** Dedup an array of jobs by jobKey, first occurrence wins. */
export function dedupeJobs(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs || []) {
    const k = jobKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}

/** Filesystem-safe slug for jds/{slug}.md. */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A pipeline.md checkbox line: "- [ ] {url} | {company} | {title}". */
export function toPipelineLine(job) {
  const url = (job && job.platform_url) || '';
  const company = (job && job.company_name) || '';
  const title = (job && job.title) || '';
  return `- [ ] ${url} | ${company} | ${title}`;
}

/** End-to-end curation: dedup within the batch, drop already-seen URLs
 *  (scan-history), then apply title -> location -> salary filters.
 *  Returns { kept, dropped } where each dropped item carries a reason. */
export function curate(jobs, config, seen) {
  const tf = (config && config.title_filter) || {};
  const lf = (config && config.location_filter) || {};
  const floor = (config && config.salary_floor) || 0;
  const seenUrls = seen instanceof Set ? seen : new Set(seen || []);
  const kept = [];
  const dropped = [];
  for (const job of dedupeJobs(jobs)) {
    if (seenUrls.has(job.platform_url)) {
      dropped.push({ job, reason: 'seen' });
      continue;
    }
    if (!titleAllowed(job.title, tf)) {
      dropped.push({ job, reason: 'title' });
      continue;
    }
    if (!locationAllowed(job, lf)) {
      dropped.push({ job, reason: 'location' });
      continue;
    }
    if (!salaryAboveFloor(job, floor)) {
      dropped.push({ job, reason: 'salary' });
      continue;
    }
    kept.push(job);
  }
  return { kept, dropped };
}
