// SPDX-License-Identifier: MIT
// @ts-check
/**
 * scan-apify.mjs: the big-boards provider engine.
 *
 * Runs one Apify actor per job board (lib/boards.mjs) for each scan pass of
 * each configured title, curates the raw results against
 * scan-apify-core.mjs, caches each kept job's description locally under
 * jds/, and returns Job[] for the career-ops engine to write to the
 * pipeline. All egress goes through ctx.fetch/ctx.fetchJson (HTTPS-only,
 * allowlisted to api.apify.com); the Apify token comes from
 * ctx.env.APIFY_TOKEN only.
 *
 * Ported from the fork-local scan-apify.mjs in career-ops-exec. That script
 * read portals.yml directly, resolved its Apify token via 1Password, and
 * wrote data/pipeline.md and data/scan-history.tsv itself. None of that
 * applies to a plugin: config arrives as ctx.settings, the token as
 * ctx.env.APIFY_TOKEN, and the career-ops engine (never the plugin) writes
 * the pipeline through its own canonical writers. The plugin still owns its
 * local jds/ cache, the same way the bundled apify plugin does.
 *
 * Job-description handling follows the bundled apify plugin's pattern
 * (career-ops-exec/plugins/apify/index.mjs), not the description-passthrough
 * hypothesis floated before this was resolved: the bundled plugin caches the
 * description to jds/ itself and returns a Job whose url is the local
 * jds/{slug}.md path, not a Job carrying a raw description field. This
 * engine follows suit, which is also what makes the returned Job's url
 * point at the cached description instead of the board's bot-blocked URL.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { curate, slugify, markKeptSeen, jobLocation } from './scan-apify-core.mjs';
import { BOARDS, boardFor, countryCode } from './boards.mjs';

/** The sync run endpoint for an actor id such as 'johnvc/linkedin-jobs-api'. */
export function endpointFor(actor) {
  return `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items`;
}
const JDS_DIR = 'jds';
const MIN_JD_BODY_CHARS = 50;
// The pipeline.md `note:` segment for a job whose remote status could not be
// told from the listing (see arrangementUnknown in scan-apify-core.mjs).
const UNKNOWN_ARRANGEMENT_NOTE = 'work arrangement unknown';
const DEFAULT_TIMEOUT_MS = 300_000;

function yamlEscape(str) {
  const s = String(str ?? '')
    .replace(/\n/g, ' ')
    .trim();
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// The default when settings.passes is omitted (or empty): a single
// remote-only pass. Geography-agnostic, so any user gets a working scan
// without configuring a location.
const DEFAULT_PASSES = [{ label: 'remote', remote_only: true }];

// The boards scanned when settings.platforms is omitted: every board that has
// a routed actor in lib/boards.mjs. Glassdoor has none (issue #83).
const DEFAULT_PLATFORMS = ['LinkedIn', 'Indeed', 'ZipRecruiter'];

/** Build the scan passes for one searched title, from settings.passes (the
 *  user's config/plugins.yml block for this plugin). Each configured pass
 *  is threaded through verbatim -- label, location, distance, remote_only --
 *  alongside the shared base fields (keyword, country, max_results,
 *  posted_since, platforms). Falls back to DEFAULT_PASSES when
 *  settings.passes is omitted or empty, and to DEFAULT_PLATFORMS when
 *  settings.platforms is. */
export function buildPasses(settings, keyword) {
  const cfg = settings || {};
  const base = {
    keyword,
    country: cfg.country || 'United States',
    max_results: cfg.max_results || 25,
    posted_since: cfg.posted_since || '14 days',
    platforms:
      Array.isArray(cfg.platforms) && cfg.platforms.length > 0 ? cfg.platforms : DEFAULT_PLATFORMS,
  };
  const passConfigs =
    Array.isArray(cfg.passes) && cfg.passes.length > 0 ? cfg.passes : DEFAULT_PASSES;
  return passConfigs.map((pass) => {
    const input = { ...base, remote_only: pass.remote_only === true };
    if (pass.location !== undefined) input.location = pass.location;
    if (pass.distance !== undefined) input.distance = pass.distance;
    return { label: pass.label, input };
  });
}

async function runActor(ctx, token, actor, input, timeoutMs) {
  const data = await ctx.fetchJson(endpointFor(actor), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    timeoutMs,
  });
  return Array.isArray(data) ? data.filter((item) => item && typeof item === 'object') : [];
}

/** The __hint and per_site_status of a dataset row that is not a job, as one
 *  log fragment, or '' when it has neither. openclawai/job-board-scraper
 *  returns such a status row, with no title or job_url, when ZipRecruiter's
 *  anti-bot check blocks the run. */
export function statusRowNote(item) {
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const parts = [];
  if (item.__hint !== undefined) parts.push(`__hint: ${show(item.__hint)}`);
  if (item.per_site_status !== undefined) {
    parts.push(`per_site_status: ${show(item.per_site_status)}`);
  }
  return parts.join('; ');
}

/** Cache a kept job's description to jds/{slug}-{hash}.md, following the
 *  bundled apify plugin's own convention: a company+title slug suffixed with
 *  a short hash of the source URL (collision-safe across postings that
 *  share a company and title), an atomic 'wx' write, and a YAML frontmatter
 *  block. Returns the relative path, or null when there's no description
 *  worth caching or the write fails (the caller falls back to the remote
 *  URL either way). */
export function cacheJobDescription(job) {
  const description = String((job && job.description) || '').trim();
  if (description.length < MIN_JD_BODY_CHARS) return null;
  const company = (job && job.company_name) || '';
  const title = (job && job.title) || '';
  let relPath = null;
  try {
    mkdirSync(JDS_DIR, { recursive: true });
    const baseSlug = slugify(`${company} ${title}`).slice(0, 80) || 'jd';
    const urlHash = createHash('sha1')
      .update(String((job && job.platform_url) || `${company}-${title}`))
      .digest('hex')
      .slice(0, 10);
    const filename = `${baseSlug}-${urlHash}.md`;
    const filepath = join(JDS_DIR, filename);
    relPath = `${JDS_DIR}/${filename}`;
    if (existsSync(filepath)) return relPath;
    const scraped = new Date().toISOString().slice(0, 10);
    const content = `---
title: ${yamlEscape(title)}
company: ${yamlEscape(company)}
url: ${yamlEscape(job.platform_url)}
location: ${yamlEscape(jobLocation(job))}
platform: ${yamlEscape(job.platform)}
scraped: "${scraped}"
source: ${yamlEscape(job.source_actor || 'apify')}
---

# ${title} - ${company}

${description}
`;
    writeFileSync(filepath, content, { encoding: 'utf-8', flag: 'wx' });
    return relPath;
  } catch (err) {
    if (err && err.code === 'EEXIST' && relPath) return relPath;
    console.warn(
      `scan-apify: JD cache write failed for ${title} (${err.code || err.name}: ${err.message}); falling back to remote URL`,
    );
    return null;
  }
}

/** Map a curated raw actor job into the plugin's Job contract
 *  ({ title, url, company, location }). Caches the description locally and
 *  points url at the cached copy when caching succeeds, so the pipeline row
 *  survives the board's bot-block instead of orphaning the cached JD; falls
 *  back to the remote board URL when there's nothing to cache. */
export function toJob(job) {
  const remoteUrl = (job && job.platform_url) || '';
  const jdPath = cacheJobDescription(job);
  return {
    title: (job && job.title) || '',
    company: (job && job.company_name) || '',
    location: jobLocation(job),
    url: jdPath ? `local:${jdPath}` : remoteUrl,
    ...(jdPath ? { _remote_url: remoteUrl } : {}),
    ...(job && job.work_arrangement_unknown ? { note: UNKNOWN_ARRANGEMENT_NOTE } : {}),
  };
}

/** Run the full scan: one actor run per board for each pass of each
 *  configured title, curated against scan-apify-core.mjs and deduped within
 *  this run. There's no persisted scan-history available to a plugin (the
 *  host's own pipeline and scan-history writers own that once this returns);
 *  the within-run seen-set plus markKeptSeen still prevents a role surfaced
 *  under two searched titles from being cached and returned twice. Resilient
 *  per board: a failed actor call is logged and skipped, not fatal to the
 *  pass or the run. A board with no routed actor is logged once and skipped.
 *  A row with no title or URL is not a job: it is dropped before the
 *  0-items check, and its __hint and per_site_status are logged. */
export async function scanApify(ctx) {
  const settings = (ctx && ctx.settings) || {};
  const token = ctx && ctx.env && ctx.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN not set');
  const titles = Array.isArray(settings.titles) ? settings.titles : [];
  if (titles.length === 0) {
    throw new Error('settings.titles is required (at least one search title)');
  }
  titles.forEach((title, i) => {
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error(
        `settings.titles[${i}] must be a non-empty string (got ${JSON.stringify(title)})`,
      );
    }
  });

  const config = {
    title_filter: settings.title_filter,
    location_filter: settings.location_filter,
    salary_floor: settings.salary_floor,
  };
  const timeoutMs = settings.timeout_ms || DEFAULT_TIMEOUT_MS;
  const seen = new Set();
  const allKept = [];
  const unrouted = new Set();

  // countryCode maps a two-letter code or one of the country names listed in
  // lib/boards.mjs. Any other name is not sent, and the LinkedIn and Indeed
  // actors fall back to their own default country, so say so once.
  if (settings.country && !countryCode(settings.country) && typeof ctx.log === 'function') {
    ctx.log(
      `scan-apify: country ${JSON.stringify(settings.country)} is not a two-letter code or a country name lib/boards.mjs lists, so the LinkedIn and Indeed actors use their own default country.`,
    );
  }

  for (const title of titles) {
    const titleJobs = [];
    for (const { label, input } of buildPasses(settings, title)) {
      for (const platform of input.platforms) {
        const board = boardFor(platform);
        if (!board) {
          if (!unrouted.has(platform) && typeof ctx.log === 'function') {
            ctx.log(
              `scan-apify: no actor is routed for ${platform}, so it is skipped. Routed boards: ${Object.keys(BOARDS).join(', ')}.`,
            );
          }
          unrouted.add(platform);
          continue;
        }
        try {
          const items = await runActor(ctx, token, board.actor, board.buildInput(input), timeoutMs);
          const jobs = [];
          for (const item of items) {
            const job = board.mapItem(item);
            if (job.title && job.platform_url) {
              jobs.push({ ...job, source_actor: board.actor });
              continue;
            }
            // Not a job, so it is not counted below.
            const note = statusRowNote(item);
            if (note && typeof ctx.log === 'function') {
              ctx.log(
                `scan-apify: ${title} [${label}] ${board.name} returned a status row, not a job: ${note}`,
              );
            }
          }
          titleJobs.push(
            ...(input.remote_only ? jobs.map((j) => ({ ...j, _remote_only_pass: true })) : jobs),
          );
          // On Apify's free plan an actor ends SUCCEEDED with 0 items once its
          // free-plan limit is reached, and the sync endpoint exposes no run ID
          // to read the log with. An empty run is the only signal there is.
          if (jobs.length === 0 && typeof ctx.log === 'function') {
            ctx.log(
              `scan-apify: ${title} [${label}] ${board.name} returned 0 items. On Apify's free plan this also happens once an actor's free-plan limit is reached. Check the run log in the Apify console.`,
            );
          }
        } catch (err) {
          if (typeof ctx.log === 'function') {
            ctx.log(`scan-apify: ${title} [${label}] ${board.name} error: ${err.message}`);
          }
        }
      }
    }
    const { kept } = curate(titleJobs, config, seen);
    markKeptSeen(seen, kept);
    allKept.push(...kept.map(toJob));
  }

  return allKept;
}
